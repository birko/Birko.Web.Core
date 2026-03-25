/**
 * Typed wrapper around EventSource (SSE) with auto-reconnect.
 */
export interface SseOptions {
  url: string;
  getToken?: () => string | null;
  onMessage?: (event: MessageEvent) => void;
  onError?: (event: Event) => void;
  reconnectMs?: number;
}

export class SseClient {
  private _source: EventSource | null = null;
  private _options: SseOptions;
  private _handlers = new Map<string, Set<(data: unknown) => void>>();
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;

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

    this._source.onmessage = (event) => {
      this._options.onMessage?.(event);
      this._dispatch('message', event.data);
    };

    this._source.onerror = (event) => {
      this._options.onError?.(event);
      this._scheduleReconnect();
    };
  }

  /** Listen for a named event type. */
  on(event: string, handler: (data: unknown) => void): () => void {
    if (!this._handlers.has(event)) {
      this._handlers.set(event, new Set());

      this._source?.addEventListener(event, (e: Event) => {
        const me = e as MessageEvent;
        try {
          this._dispatch(event, JSON.parse(me.data));
        } catch {
          this._dispatch(event, me.data);
        }
      });
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

  private _dispatch(event: string, data: unknown): void {
    const handlers = this._handlers.get(event);
    if (handlers) {
      for (const h of handlers) h(data);
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
