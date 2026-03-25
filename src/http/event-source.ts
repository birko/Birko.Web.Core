/**
 * Typed wrapper around EventSource (SSE) with auto-reconnect.
 *
 * Special internal events (subscribe via `on()`):
 * - `_open`      — connection established (first or reconnect)
 * - `_error`     — connection error (before reconnect attempt)
 * - `_reconnect` — successfully reconnected after a drop
 */
export interface SseOptions {
  url: string;
  getToken?: () => string | null;
  onMessage?: (event: MessageEvent) => void;
  onError?: (event: Event) => void;
  reconnectMs?: number;
}

export type SseReadyState = 'connecting' | 'open' | 'closed';

export class SseClient {
  private _source: EventSource | null = null;
  private _options: SseOptions;
  private _handlers = new Map<string, Set<(data: unknown) => void>>();
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _wasConnected = false;

  constructor(options: SseOptions) {
    this._options = options;
  }

  connect(): void {
    this.disconnect();

    let url = this._options.url;
    const token = this._options.getToken?.();
    if (token) {
      const sep = url.includes('?') ? '&' : '?';
      url += `${sep}token=${encodeURIComponent(token)}`;
    }

    this._source = new EventSource(url);

    // Re-register named event listeners on the new EventSource
    for (const event of this._handlers.keys()) {
      if (event.startsWith('_') || event === 'message') continue;
      this._attachSourceListener(event);
    }

    this._source.onopen = () => {
      const isReconnect = this._wasConnected;
      this._wasConnected = true;
      this._dispatch('_open', null);
      if (isReconnect) {
        this._dispatch('_reconnect', null);
      }
    };

    this._source.onmessage = (event) => {
      this._options.onMessage?.(event);
      this._dispatch('message', event.data);
    };

    this._source.onerror = (event) => {
      this._options.onError?.(event);
      this._dispatch('_error', event);
      this._scheduleReconnect();
    };
  }

  /** Listen for a named event type (or internal: `_open`, `_error`, `_reconnect`). */
  on(event: string, handler: (data: unknown) => void): () => void {
    if (!this._handlers.has(event)) {
      this._handlers.set(event, new Set());

      // Attach to the current EventSource (if connected)
      if (!event.startsWith('_') && event !== 'message') {
        this._attachSourceListener(event);
      }
    }

    this._handlers.get(event)!.add(handler);
    return () => this._handlers.get(event)?.delete(handler);
  }

  disconnect(): void {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._source?.close();
    this._source = null;
  }

  get connected(): boolean {
    return this._source?.readyState === EventSource.OPEN;
  }

  get state(): SseReadyState {
    switch (this._source?.readyState) {
      case EventSource.CONNECTING: return 'connecting';
      case EventSource.OPEN:       return 'open';
      default:                     return 'closed';
    }
  }

  /** Reset the wasConnected flag (e.g. on intentional disconnect + fresh connect). */
  resetReconnectState(): void {
    this._wasConnected = false;
  }

  private _attachSourceListener(event: string): void {
    this._source?.addEventListener(event, (e: Event) => {
      const me = e as MessageEvent;
      try {
        this._dispatch(event, JSON.parse(me.data));
      } catch {
        this._dispatch(event, me.data);
      }
    });
  }

  private _dispatch(event: string, data: unknown): void {
    const handlers = this._handlers.get(event);
    if (handlers) {
      for (const h of handlers) {
        try { h(data); } catch (err) { console.error(`[SseClient] Handler error for "${event}":`, err); }
      }
    }
  }

  private _scheduleReconnect(): void {
    const ms = this._options.reconnectMs ?? 5000;
    if (ms > 0 && !this._reconnectTimer) {
      this._reconnectTimer = setTimeout(() => {
        this._reconnectTimer = null;
        this.connect();
      }, ms);
    }
  }
}
