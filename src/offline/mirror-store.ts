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
