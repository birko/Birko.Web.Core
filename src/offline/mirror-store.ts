import { IndexedDbStore } from '../storage/idb-store.js';

// The read-side companion to ActionQueue. ActionQueue makes *writes* durable offline, but nothing
// bridges *reads*: an offline GET returns nothing, so any screen that needs to read before it can
// write (a picker, a detail view) is dead in a no-signal environment. A MirrorStore keeps a local
// IndexedDB copy of a server-owned collection; the readThrough helpers below implement the
// network-first-with-offline-fallback pattern over it.

export interface MirrorStoreOptions {
  /** IndexedDB database name. */
  dbName?: string;
  /** Object store name. */
  storeName?: string;
  /** The property on each item used as its key (e.g. `"guid"`, `"id"`). */
  keyPath: string;
}

/**
 * A local mirror of a server-owned collection, backed by {@link IndexedDbStore}. Small, rarely
 * changing collections are cheapest to keep coherent by replacing the whole set on refresh
 * ({@link MirrorStore.replaceAll}) — which also drops items removed server-side; single-entity reads
 * use {@link MirrorStore.upsert} / {@link MirrorStore.evict}.
 */
export class MirrorStore<T> {
  private readonly store: IndexedDbStore<T>;

  constructor(options: MirrorStoreOptions) {
    this.store = new IndexedDbStore<T>({
      dbName: options.dbName,
      storeName: options.storeName,
      keyPath: options.keyPath,
    });
  }

  /** Every mirrored item (empty when nothing has been cached yet). */
  readAll(): Promise<T[]> {
    return this.store.getAll();
  }

  /** Replace the whole mirrored collection from an authoritative fetch (clear + bulk put). */
  async replaceAll(items: T[]): Promise<void> {
    await this.store.clear();
    if (items.length) {
      await this.store.setMany(items.map((value) => ({ value })));
    }
  }

  /** A single mirrored item by key, or `undefined` when not cached. */
  get(key: string): Promise<T | undefined> {
    return this.store.get(key);
  }

  /** Insert or update a single mirrored item (key read from its `keyPath`). */
  async upsert(item: T): Promise<void> {
    await this.store.set(item);
  }

  /**
   * Insert or update many mirrored items in **one** transaction, without clearing the rest of the store —
   * the merge counterpart to {@link MirrorStore.replaceAll}.
   *
   * For a mirror refreshed a *window* at a time rather than wholesale (a dated collection read over a rolling
   * range, where replacing everything would discard the rows outside the window that a wider range still
   * needs). Looping `upsert` does the same thing at one IndexedDB transaction per row, which is what makes it
   * worth having: a 90-row window refresh costs 90 transactions instead of 1, on a path that runs every time
   * the range changes.
   */
  async upsertMany(items: readonly T[]): Promise<void> {
    if (!items.length) return;
    await this.store.setMany(items.map((value) => ({ value })));
  }

  /** Remove a single mirrored item (e.g. after the server reports it gone). */
  async evict(key: string): Promise<void> {
    await this.store.delete(key);
  }

  /** Drop the entire mirror. */
  clear(): Promise<void> {
    return this.store.clear();
  }
}

/**
 * The minimal response shape {@link readThrough}/{@link readAllThrough} need — a structural subset
 * of `ApiResponse<T>`, so it works without importing the HTTP layer. `status === 0` signals an
 * offline / network failure.
 */
export interface ReadThroughResponse<T> {
  ok: boolean;
  status: number;
  data: T | null;
}

/**
 * Network-first read of a single entity with mirror fallback: returns the fresh value and refreshes
 * the mirror on success; returns the mirrored copy when offline (or on a non-gone server error, so a
 * transient 500 doesn't blank the screen); evicts and returns `undefined` when the server reports it
 * gone. A thrown fetch (hard offline) also falls back to the mirror.
 */
export async function readThrough<T>(params: {
  key: string;
  fetch: () => Promise<ReadThroughResponse<T>>;
  mirror: MirrorStore<T>;
  /** Statuses that mean "gone" → evict from the mirror. Default `[404, 410]`. */
  goneStatuses?: number[];
}): Promise<T | undefined> {
  const { key, fetch, mirror, goneStatuses = [404, 410] } = params;
  let res: ReadThroughResponse<T>;
  try {
    res = await fetch();
  } catch {
    return mirror.get(key);
  }
  if (res.status === 0) return mirror.get(key);
  if (goneStatuses.includes(res.status)) {
    await mirror.evict(key);
    return undefined;
  }
  if (res.ok && res.data != null) {
    await mirror.upsert(res.data);
    return res.data;
  }
  return mirror.get(key);
}

/**
 * Network-first read of a whole collection with mirror fallback: refreshes the mirror and returns the
 * fresh list on success; returns the mirrored list when offline or on any non-ok response.
 */
export async function readAllThrough<T>(params: {
  fetch: () => Promise<ReadThroughResponse<T[]>>;
  mirror: MirrorStore<T>;
}): Promise<T[]> {
  const { fetch, mirror } = params;
  let res: ReadThroughResponse<T[]>;
  try {
    res = await fetch();
  } catch {
    return mirror.readAll();
  }
  if (res.status === 0 || !res.ok || res.data == null) {
    return mirror.readAll();
  }
  await mirror.replaceAll(res.data);
  return res.data;
}

// ── Windowed reads: a dated collection fetched one rolling range at a time ───────────────────────
//
// `readThrough` covers one entity and `readAllThrough` a whole collection. Neither fits a **dated
// collection read a window at a time** — a history behind a 30 / 90 / all range switch — and
// `readAllThrough` is actively WRONG for it: it refreshes with `replaceAll`, so reading 30 days would
// replace the mirror with 30 days and destroy the 90-day history the next range tap needs. Offline,
// the wider range would then hold *less* data than the narrower one.
//
// So these refresh with a **window-scoped replace** instead: upsert what came back, evict what
// vanished from inside the fetched window, leave everything outside it alone. The mirror accumulates
// into the union of every window ever read.
//
// **Dates are `yyyy-MM-dd` strings, compared lexicographically — that is a precondition, not an
// accident.** Zero-padded ISO days sort chronologically as text, so no `Date` is constructed and no
// timezone can shift a boundary day. Passing a `Date`, an instant, or any other format breaks the
// comparison; serialize the day first (a .NET `DateOnly` already arrives in exactly this shape).

/**
 * Whether a `yyyy-MM-dd` day falls in an inclusive window; an omitted bound is unbounded on that side,
 * so omitting both means "all".
 */
export function inWindow(date: string, from?: string, to?: string): boolean {
  return (from === undefined || date >= from) && (to === undefined || date <= to);
}

/**
 * Refresh a mirror from an authoritative fetch of ONE window: upsert what came back, evict what
 * disappeared from inside that window, leave everything outside it alone.
 *
 * `keyOf` and `dateOf` are separate on purpose. They coincide for a one-row-per-day collection (keyed
 * by the day itself) and differ for one that permits several rows a day (keyed by id, dated by a
 * field); collapsing them into one accessor breaks whichever case it wasn't written for.
 */
export async function syncWindow<T>(
  mirror: MirrorStore<T>,
  fresh: readonly T[],
  keyOf: (row: T) => string,
  dateOf: (row: T) => string,
  from?: string,
  to?: string,
): Promise<void> {
  const freshKeys = new Set(fresh.map(keyOf));
  // Evictions are rare (a row deleted server-side), so one transaction each is fine; the upserts are
  // the hot part — every range change refreshes a whole window — so they go in one via `upsertMany`.
  for (const row of await mirror.readAll()) {
    if (inWindow(dateOf(row), from, to) && !freshKeys.has(keyOf(row))) await mirror.evict(keyOf(row));
  }
  await mirror.upsertMany(fresh);
}

/**
 * The outcome of a {@link readWindowThrough} read.
 *
 * `source` is reported rather than swallowed (unlike {@link readAllThrough}, which returns a bare
 * array) because a caller cannot otherwise tell live data from a cache — needed both to show a
 * "last synced" banner and, more importantly, for `primed`.
 *
 * **`primed` is the one that prevents a lie.** An empty `rows` is ambiguous: it can mean "nothing was
 * recorded in this range", which is true and fine, or "this device has never synced", which is not
 * the same thing at all. Rendering the second as an empty chart tells the user they never did
 * anything. `primed: false` means the mirror holds nothing *at all* — show a "connect once" state,
 * not an empty result. On the server path it is always `true`: the answer is live.
 */
export interface WindowRead<T> {
  rows: T[];
  source: 'server' | 'mirror';
  primed: boolean;
}

/**
 * Network-first read of one **day window** of a dated collection, falling back to the mirror filtered
 * to the same window. Refreshes with {@link syncWindow} rather than `replaceAll` — see the block
 * comment above for why that distinction is load-bearing.
 *
 * Rows come back oldest-first. The mirror path sorts explicitly because IndexedDB hands rows back in
 * key order, which is arbitrary for anything not keyed by its own date.
 */
export async function readWindowThrough<T>(params: {
  fetch: () => Promise<ReadThroughResponse<T[]>>;
  mirror: MirrorStore<T>;
  keyOf: (row: T) => string;
  dateOf: (row: T) => string;
  from?: string;
  to?: string;
}): Promise<WindowRead<T>> {
  const { fetch, mirror, keyOf, dateOf, from, to } = params;

  const fromMirror = async (): Promise<WindowRead<T>> => {
    const all = await mirror.readAll();
    return {
      rows: all.filter((r) => inWindow(dateOf(r), from, to)).sort((a, b) => dateOf(a).localeCompare(dateOf(b))),
      source: 'mirror',
      // Free here: `all` is already in hand, so "has this device ever cached anything" costs no extra
      // read — which is why the check belongs in this helper rather than in each caller.
      primed: all.length > 0,
    };
  };

  let res: ReadThroughResponse<T[]>;
  try {
    res = await fetch();
  } catch {
    return fromMirror();
  }
  if (res.ok && res.data != null) {
    await syncWindow(mirror, res.data, keyOf, dateOf, from, to);
    return { rows: res.data, source: 'server', primed: true };
  }
  return fromMirror();
}
