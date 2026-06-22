import { signal, type Unsubscribe } from '../state/signal.js';
import { openDatabase, idbRequest, txComplete, deleteDatabase, type IdbUpgrade } from './idb.js';

// ── Types ──────────────────────────────────────────────────────────────────

/** An index to create on the object store. */
export interface IdbIndexConfig {
  /** Index name, used in `getAllByIndex` / `getByIndex` / `keysByIndex`. */
  name: string;
  /** Property path(s) the index keys on. */
  keyPath: string | string[];
  /** Reject writes that would duplicate an index key. */
  unique?: boolean;
  /** Index each element when the keyPath resolves to an array. */
  multiEntry?: boolean;
}

export interface IndexedDbStoreOptions {
  /**
   * Database name. Defaults to `birko_${storeName}` so each logical store gets
   * its own database — the simplest model and free of the multi-store version
   * gotcha. Pass an explicit `dbName` only when you deliberately want several
   * object stores in one database.
   */
  dbName?: string;
  /** Object store name. Defaults to `keyval`. */
  storeName?: string;
  /** Schema version. Bump when adding indexes. Defaults to `1`. */
  version?: number;
  /**
   * In-line key path — the key lives on the value (e.g. `'id'`). Omit (or pass
   * `null`) for out-of-line keys, where the key is passed explicitly to
   * `set` / `add`.
   */
  keyPath?: string | string[] | null;
  /** Auto-generate keys (only meaningful with out-of-line or no keyPath). */
  autoIncrement?: boolean;
  /** Indexes to create on first open / version bump. */
  indexes?: IdbIndexConfig[];
}

/** A change to the store, delivered to `onChange` listeners. */
export interface IdbChange<K extends IDBValidKey> {
  type: 'set' | 'delete' | 'clear';
  /** Affected key — absent for `clear`. */
  key?: K;
}

// ── IndexedDbStore ───────────────────────────────────────────────────────────

/**
 * Generic, promisified IndexedDB object store — a reusable building block for
 * caching read data, persisting large/structured app state, or any keyed
 * collection too big for `localStorage`. One instance manages one object store.
 *
 * For small UI flags / preferences prefer `Signal({ persist })` or
 * `persistSet`/`persistGet` (localStorage) — IndexedDB is overkill there.
 *
 * @example
 * interface Product { id: string; name: string; price: number; }
 *
 * const products = new IndexedDbStore<Product>({
 *   storeName: 'products',
 *   keyPath: 'id',
 *   indexes: [{ name: 'price', keyPath: 'price' }],
 * });
 *
 * await products.set({ id: 'p1', name: 'Widget', price: 9.99 });
 * const p = await products.get('p1');
 * const cheap = await products.getAllByIndex('price', IDBKeyRange.upperBound(10));
 */
export class IndexedDbStore<T, K extends IDBValidKey = string> {
  private readonly _dbName: string;
  private readonly _storeName: string;
  private readonly _version: number;
  private readonly _keyPath: string | string[] | null;
  private readonly _autoIncrement: boolean;
  private readonly _indexes: IdbIndexConfig[];

  private _dbPromise: Promise<IDBDatabase> | null = null;
  private _closed = false;

  private _size = signal(0);
  private _changeListeners = new Set<(change: IdbChange<K>) => void>();

  constructor(options: IndexedDbStoreOptions = {}) {
    this._storeName = options.storeName ?? 'keyval';
    this._dbName = options.dbName ?? `birko_${this._storeName}`;
    this._version = options.version ?? 1;
    this._keyPath = options.keyPath ?? null;
    this._autoIncrement = options.autoIncrement ?? false;
    this._indexes = options.indexes ?? [];
  }

  /** Reactive entry count, refreshed after every mutation through this instance. */
  get size(): number { return this._size.value; }

  // ── Reads ──

  /** Read one value by key. Resolves `undefined` when absent. */
  async get(key: K): Promise<T | undefined> {
    return this._read(store => store.get(key));
  }

  /** Read several values by key, preserving input order (`undefined` for misses). */
  async getMany(keys: K[]): Promise<(T | undefined)[]> {
    const db = await this._db();
    const tx = db.transaction(this._storeName, 'readonly');
    const store = tx.objectStore(this._storeName);
    const results = await Promise.all(keys.map(k => idbRequest<T | undefined>(store.get(k))));
    await txComplete(tx);
    return results;
  }

  /** Read all values, optionally bounded by a key range and/or count. */
  async getAll(query?: IDBValidKey | IDBKeyRange | null, count?: number): Promise<T[]> {
    return this._read(store => store.getAll(query ?? null, count));
  }

  /** Read all keys, optionally bounded by a key range and/or count. */
  async getAllKeys(query?: IDBValidKey | IDBKeyRange | null, count?: number): Promise<K[]> {
    return this._read(store => store.getAllKeys(query ?? null, count) as unknown as IDBRequest<K[]>);
  }

  /** True when a value exists for the key. */
  async has(key: K): Promise<boolean> {
    const c = await this._read(store => store.count(key));
    return c > 0;
  }

  /** Count entries, optionally within a key range. */
  async count(query?: IDBValidKey | IDBKeyRange | null): Promise<number> {
    return this._read(store => store.count(query ?? undefined));
  }

  /** Read the first value matching an index key (or range). */
  async getByIndex(indexName: string, key: IDBValidKey | IDBKeyRange): Promise<T | undefined> {
    return this._read(store => store.index(indexName).get(key));
  }

  /** Read all values matching an index key (or range). */
  async getAllByIndex(indexName: string, query?: IDBValidKey | IDBKeyRange | null, count?: number): Promise<T[]> {
    return this._read(store => store.index(indexName).getAll(query ?? null, count));
  }

  /** Read all primary keys matching an index key (or range). */
  async keysByIndex(indexName: string, query?: IDBValidKey | IDBKeyRange | null, count?: number): Promise<K[]> {
    return this._read(store => store.index(indexName).getAllKeys(query ?? null, count) as unknown as IDBRequest<K[]>);
  }

  /**
   * Walk entries with a cursor — the memory-friendly way to scan large stores.
   * The callback runs synchronously inside the read transaction; return `false`
   * to stop early. Do not `await` non-IndexedDB work inside it (the transaction
   * auto-commits between microtasks) — collect keys here, act on them after.
   */
  async forEach(
    callback: (value: T, key: K) => void | boolean,
    query?: IDBValidKey | IDBKeyRange | null,
    direction?: IDBCursorDirection,
  ): Promise<void> {
    const db = await this._db();
    const tx = db.transaction(this._storeName, 'readonly');
    const store = tx.objectStore(this._storeName);
    await new Promise<void>((resolve, reject) => {
      const req = store.openCursor(query ?? null, direction);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) { resolve(); return; }
        if (callback(cursor.value as T, cursor.key as K) === false) { resolve(); return; }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  // ── Writes ──

  /** Insert or replace a value. Returns its key. */
  async set(value: T, key?: K): Promise<K> {
    const out = await this._write<IDBValidKey>(store => this._put(store, value, key));
    this._emit({ type: 'set', key: out as K });
    return out as K;
  }

  /** Insert or replace many values in one transaction. */
  async setMany(entries: Array<{ value: T; key?: K }>): Promise<void> {
    const db = await this._db();
    const tx = db.transaction(this._storeName, 'readwrite');
    const store = tx.objectStore(this._storeName);
    for (const { value, key } of entries) this._put(store, value, key);
    await txComplete(tx);
    await this._refreshSize();
    for (const { key } of entries) this._notify({ type: 'set', key });
  }

  /** Insert a value, rejecting if its key already exists. Returns its key. */
  async add(value: T, key?: K): Promise<K> {
    const out = await this._write<IDBValidKey>(store => this._add(store, value, key));
    this._emit({ type: 'set', key: out as K });
    return out as K;
  }

  /** Delete one value by key. No-op if absent. */
  async delete(key: K): Promise<void> {
    await this._write(store => store.delete(key));
    this._emit({ type: 'delete', key });
  }

  /** Remove every entry. */
  async clear(): Promise<void> {
    await this._write(store => store.clear());
    this._emit({ type: 'clear' });
  }

  /**
   * Read-modify-write a single value atomically inside one transaction.
   * The updater receives the current value (or `undefined`) and returns the
   * next value, or `undefined` to delete it.
   */
  async update(key: K, updater: (current: T | undefined) => T | undefined): Promise<void> {
    const db = await this._db();
    const tx = db.transaction(this._storeName, 'readwrite');
    const store = tx.objectStore(this._storeName);
    const current = await idbRequest<T | undefined>(store.get(key));
    const next = updater(current);
    if (next === undefined) {
      store.delete(key);
    } else {
      this._put(store, next, key);
    }
    await txComplete(tx);
    await this._refreshSize();
    this._notify(next === undefined ? { type: 'delete', key } : { type: 'set', key });
  }

  // ── Lifecycle / escape hatch ──

  /** Subscribe to mutations made through this instance. Returns an unsubscribe fn. */
  onChange(listener: (change: IdbChange<K>) => void): Unsubscribe {
    this._changeListeners.add(listener);
    return () => this._changeListeners.delete(listener);
  }

  /**
   * Run a custom transaction over this object store — the escape hatch for
   * operations not covered above (multi-index cursors, etc.). The transaction
   * commits when the callback's returned promise settles.
   */
  async transaction<R>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => Promise<R>): Promise<R> {
    const db = await this._db();
    const tx = db.transaction(this._storeName, mode);
    const result = await fn(tx.objectStore(this._storeName));
    await txComplete(tx);
    if (mode === 'readwrite') await this._refreshSize();
    return result;
  }

  /** Close the underlying connection (a new one opens lazily on next use). */
  async close(): Promise<void> {
    const pending = this._dbPromise;
    this._dbPromise = null;
    if (pending) {
      try { (await pending).close(); } catch { /* already closing */ }
    }
  }

  /** Close and delete the entire database. */
  async destroy(): Promise<void> {
    this._closed = true;
    await this.close();
    await deleteDatabase(this._dbName);
    this._size.value = 0;
  }

  // ── Internal ──

  private _upgrade: IdbUpgrade = (db, _old, _new, tx) => {
    const store = db.objectStoreNames.contains(this._storeName)
      ? tx.objectStore(this._storeName)
      : db.createObjectStore(this._storeName, {
          keyPath: this._keyPath ?? undefined,
          autoIncrement: this._autoIncrement,
        });
    for (const idx of this._indexes) {
      if (!store.indexNames.contains(idx.name)) {
        store.createIndex(idx.name, idx.keyPath, { unique: idx.unique, multiEntry: idx.multiEntry });
      }
    }
  };

  private _db(): Promise<IDBDatabase> {
    if (this._closed) return Promise.reject(new Error(`IndexedDbStore "${this._storeName}" was destroyed`));
    if (!this._dbPromise) {
      this._dbPromise = openDatabase(this._dbName, this._version, this._upgrade).then(db => {
        // Another tab requested an upgrade — release our connection so it can proceed.
        db.onversionchange = () => { db.close(); this._dbPromise = null; };
        return db;
      });
      // A failed open must not poison every later call.
      this._dbPromise.catch(() => { this._dbPromise = null; });
    }
    return this._dbPromise;
  }

  private async _read<R>(fn: (store: IDBObjectStore) => IDBRequest<R>): Promise<R> {
    const db = await this._db();
    const tx = db.transaction(this._storeName, 'readonly');
    const result = await idbRequest(fn(tx.objectStore(this._storeName)));
    await txComplete(tx);
    return result;
  }

  private async _write<R>(fn: (store: IDBObjectStore) => IDBRequest<R>): Promise<R> {
    const db = await this._db();
    const tx = db.transaction(this._storeName, 'readwrite');
    const result = await idbRequest(fn(tx.objectStore(this._storeName)));
    await txComplete(tx);
    await this._refreshSize();
    return result;
  }

  private _put(store: IDBObjectStore, value: T, key?: K): IDBRequest<IDBValidKey> {
    return this._keyPath != null ? store.put(value) : store.put(value, this._resolveKey(key));
  }

  private _add(store: IDBObjectStore, value: T, key?: K): IDBRequest<IDBValidKey> {
    return this._keyPath != null ? store.add(value) : store.add(value, this._resolveKey(key));
  }

  /** Validate the explicit key required for out-of-line stores. */
  private _resolveKey(key?: K): K | undefined {
    if (key === undefined && !this._autoIncrement) {
      throw new Error(`IndexedDbStore "${this._storeName}" uses out-of-line keys — pass a key to set/add.`);
    }
    return key;
  }

  private async _refreshSize(): Promise<void> {
    try {
      const db = await this._db();
      const tx = db.transaction(this._storeName, 'readonly');
      this._size.value = await idbRequest(tx.objectStore(this._storeName).count());
    } catch { /* connection torn down mid-flight — leave last known size */ }
  }

  private _emit(change: IdbChange<K>): void {
    // size already refreshed by the _write that preceded this
    this._notify(change);
  }

  private _notify(change: IdbChange<K>): void {
    for (const fn of this._changeListeners) fn(change);
  }
}
