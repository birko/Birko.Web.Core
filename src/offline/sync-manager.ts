import type { ActionQueue, QueuedAction, SyncResult } from './action-queue.js';
import type { ApiClient } from '../http/api-client.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface SyncManagerOptions {
  /** Interval in milliseconds for periodic sync attempts (default: 30000). */
  syncInterval?: number;
  /** HTTP status code treated as conflict (default: 409). */
  conflictStatus?: number;
}

// ── SyncManager ────────────────────────────────────────────────────────────

export class SyncManager {
  private _syncing = false;
  private _conflictListeners = new Set<(action: QueuedAction, serverResponse: unknown) => void>();
  private _completeListeners = new Set<(result: SyncResult) => void>();
  private _queue: ActionQueue;
  private _api: ApiClient;
  private _conflictStatus: number;
  private _intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(queue: ActionQueue, api: ApiClient, options: SyncManagerOptions = {}) {
    this._queue = queue;
    this._api = api;
    this._conflictStatus = options.conflictStatus ?? 409;

    // Auto-sync when coming back online
    window.addEventListener('online', () => this.sync());

    // Periodic sync attempt (catches edge cases)
    const interval = options.syncInterval ?? 30_000;
    this._intervalId = setInterval(() => {
      if (navigator.onLine && this._queue.pendingCount > 0) {
        this.sync();
      }
    }, interval);
  }

  get isSyncing(): boolean { return this._syncing; }

  /** Process all pending actions in FIFO order. */
  async sync(): Promise<SyncResult> {
    if (this._syncing) return { synced: 0, failed: 0, conflicts: 0 };
    this._syncing = true;

    const pending = await this._queue.getPending();
    let synced = 0;
    let failed = 0;
    let conflicts = 0;

    for (const action of pending) {
      action.status = 'syncing';
      await this._queue.update(action);

      try {
        const resp = action.method === 'POST'
          ? await this._api.post(action.path, action.body)
          : action.method === 'PUT'
            ? await this._api.put(action.path, action.body)
            : await this._api.delete(action.path);

        if (resp.ok) {
          await this._queue.remove(action.id);
          synced++;
        } else if (resp.status === this._conflictStatus) {
          action.status = 'conflict';
          await this._queue.update(action);
          conflicts++;
          this._notifyConflict(action, resp.data);
        } else {
          action.status = 'failed';
          action.retries++;
          action.lastError = `HTTP ${resp.status}`;
          await this._queue.update(action);
          failed++;
        }
      } catch (e) {
        action.status = 'failed';
        action.retries++;
        action.lastError = (e as Error).message;
        await this._queue.update(action);
        failed++;
      }
    }

    this._syncing = false;
    const result = { synced, failed, conflicts };
    this._notifyComplete(result);
    return result;
  }

  /** Subscribe to conflict events. */
  onConflict(fn: (action: QueuedAction, serverResponse: unknown) => void): () => void {
    this._conflictListeners.add(fn);
    return () => this._conflictListeners.delete(fn);
  }

  /** Subscribe to sync completion. */
  onSyncComplete(fn: (result: SyncResult) => void): () => void {
    this._completeListeners.add(fn);
    return () => this._completeListeners.delete(fn);
  }

  /** Stop periodic sync. */
  dispose(): void {
    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
  }

  private _notifyConflict(action: QueuedAction, serverResponse: unknown): void {
    for (const fn of this._conflictListeners) fn(action, serverResponse);
  }

  private _notifyComplete(result: SyncResult): void {
    for (const fn of this._completeListeners) fn(result);
  }
}
