import { signal, type Unsubscribe } from '../state/signal.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface QueuedAction {
  id: string;
  timestamp: number;
  method: 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  metadata: ActionMetadata;
  status: 'pending' | 'syncing' | 'failed' | 'conflict';
  retries: number;
  lastError?: string;
}

export interface ActionMetadata {
  moduleId: string;
  description: string;
  entityType?: string;
  entityId?: string;
}

export interface SyncResult {
  synced: number;
  failed: number;
  conflicts: number;
}

export interface ActionQueueOptions {
  /** IndexedDB database name. */
  dbName?: string;
  /** IndexedDB version. */
  dbVersion?: number;
}

// ── IndexedDB helpers ──────────────────────────────────────────────────────

const STORE_NAME = 'actions';

function openDb(dbName: string, dbVersion: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('status', 'status', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── ActionQueue ────────────────────────────────────────────────────────────

export class ActionQueue {
  private _pendingCount = signal(0);
  private _changeListeners = new Set<(count: number) => void>();
  private _dbName: string;
  private _dbVersion: number;

  constructor(options: ActionQueueOptions = {}) {
    this._dbName = options.dbName ?? 'birko_offline';
    this._dbVersion = options.dbVersion ?? 1;
  }

  /** Reactive pending count. */
  get pendingCount(): number { return this._pendingCount.value; }

  /** Add an action to the offline queue. Returns the action ID. */
  async enqueue(action: Omit<QueuedAction, 'id' | 'timestamp' | 'status' | 'retries'>): Promise<string> {
    const entry: QueuedAction = {
      ...action,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      status: 'pending',
      retries: 0,
    };

    const db = await this._open();
    await idbRequest(tx(db, 'readwrite').add(entry));
    db.close();

    await this._refreshCount();
    return entry.id;
  }

  /** Get all queued actions, ordered by timestamp. */
  async getAll(): Promise<QueuedAction[]> {
    const db = await this._open();
    const store = tx(db, 'readonly');
    const items = await idbRequest(store.index('timestamp').getAll()) as QueuedAction[];
    db.close();
    return items;
  }

  /** Get only pending actions (FIFO order). */
  async getPending(): Promise<QueuedAction[]> {
    const all = await this.getAll();
    return all.filter(a => a.status === 'pending' || a.status === 'failed');
  }

  /** Update an action in the queue. */
  async update(action: QueuedAction): Promise<void> {
    const db = await this._open();
    await idbRequest(tx(db, 'readwrite').put(action));
    db.close();
    await this._refreshCount();
  }

  /** Remove a completed/cancelled action. */
  async remove(id: string): Promise<void> {
    const db = await this._open();
    await idbRequest(tx(db, 'readwrite').delete(id));
    db.close();
    await this._refreshCount();
  }

  /** Clear all actions from the queue. */
  async clear(): Promise<void> {
    const db = await this._open();
    await idbRequest(tx(db, 'readwrite').clear());
    db.close();
    this._pendingCount.value = 0;
    this._notifyChange();
  }

  /** Subscribe to count changes. */
  onChange(fn: (count: number) => void): Unsubscribe {
    this._changeListeners.add(fn);
    return () => this._changeListeners.delete(fn);
  }

  // ── Internal ──

  private _open(): Promise<IDBDatabase> {
    return openDb(this._dbName, this._dbVersion);
  }

  private async _refreshCount(): Promise<void> {
    const pending = await this.getPending();
    this._pendingCount.value = pending.length;
    this._notifyChange();
  }

  private _notifyChange(): void {
    const count = this._pendingCount.value;
    for (const fn of this._changeListeners) {
      fn(count);
    }
  }
}
