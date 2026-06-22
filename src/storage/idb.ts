/**
 * Low-level IndexedDB Promise helpers — the thin "wrapper" the native
 * callback-based API needs to be usable with async/await. Zero dependencies.
 *
 * Shared by `IndexedDbStore` (generic object store) and the offline
 * `ActionQueue` (offline mutation queue) so there is one promisified IDB
 * surface, not a copy per consumer.
 */

/** Schema-creation callback run inside the `versionchange` transaction. */
export type IdbUpgrade = (
  db: IDBDatabase,
  oldVersion: number,
  newVersion: number | null,
  transaction: IDBTransaction,
) => void;

/**
 * Open (and, on a version bump, upgrade) an IndexedDB database.
 * The `upgrade` callback runs inside the `versionchange` transaction — create
 * object stores and indexes there, never afterwards.
 */
export function openDatabase(name: string, version: number, upgrade?: IdbUpgrade): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = (event) => {
      upgrade?.(request.result, event.oldVersion, event.newVersion, request.transaction!);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`IndexedDB "${name}" open blocked by another connection`));
  });
}

/** Promisify a single `IDBRequest` (get/put/add/delete/count/cursor open). */
export function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Resolve when a transaction commits (durability) and reject on error/abort.
 * Await this after issuing writes so the caller knows the data is on disk.
 */
export function txComplete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
  });
}

/** Delete an entire database by name. */
export function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error(`IndexedDB "${name}" delete blocked by another connection`));
  });
}
