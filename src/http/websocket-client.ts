/**
 * Typed WebSocket client with auto-reconnect, heartbeat, and JSON message dispatch.
 */

export type WsReadyState = 'connecting' | 'open' | 'closing' | 'closed';

export interface WsClientOptions {
  /** WebSocket endpoint URL (ws:// or wss://). */
  url: string;
  /** Called to obtain the current auth token. Appended as `?token=` query param. */
  getToken?: () => string | null;
  /** Reconnect delay in ms (0 to disable). Default: 5000. */
  reconnectMs?: number;
  /** Heartbeat/ping interval in ms (0 to disable). Default: 30000. */
  heartbeatMs?: number;
  /** Message sent as heartbeat ping. Default: `{"type":"ping"}`. */
  heartbeatPayload?: string;
  /** Max reconnect attempts before giving up (0 = unlimited). Default: 0. */
  maxReconnectAttempts?: number;
  /** Called on every successful (re)connection. */
  onOpen?: () => void;
  /** Called on connection close (after reconnect logic decides not to retry). */
  onClose?: (event: CloseEvent) => void;
  /** Called on WebSocket error. */
  onError?: (event: Event) => void;
}

export class WsClient {
  private _socket: WebSocket | null = null;
  private _options: WsClientOptions;
  private _handlers = new Map<string, Set<(data: unknown) => void>>();
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _reconnectAttempts = 0;
  private _intentionalClose = false;

  constructor(options: WsClientOptions) {
    this._options = options;
  }

  // ── Connection lifecycle ──────────────────────────────────────────────────

  connect(): void {
    this.disconnect();
    this._intentionalClose = false;
    this._reconnectAttempts = 0;

    let url = this._options.url;
    const token = this._options.getToken?.();
    if (token) {
      const sep = url.includes('?') ? '&' : '?';
      url += `${sep}token=${encodeURIComponent(token)}`;
    }

    this._socket = new WebSocket(url);

    this._socket.onopen = () => {
      this._reconnectAttempts = 0;
      this._startHeartbeat();
      this._dispatch('_open', null);
      this._options.onOpen?.();
    };

    this._socket.onmessage = (event: MessageEvent) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data as string);
      } catch {
        parsed = event.data;
      }

      // Dispatch to typed handler if message has a `type` field
      if (parsed && typeof parsed === 'object' && 'type' in (parsed as Record<string, unknown>)) {
        const msg = parsed as Record<string, unknown>;
        const type = msg['type'] as string;

        // Skip pong heartbeat responses
        if (type === 'pong') return;

        this._dispatch(type, msg['data'] ?? msg);
      }

      // Always dispatch to wildcard 'message' handlers
      this._dispatch('message', parsed);
    };

    this._socket.onclose = (event: CloseEvent) => {
      this._stopHeartbeat();
      this._dispatch('_close', event);

      if (!this._intentionalClose) {
        this._scheduleReconnect();
      } else {
        this._options.onClose?.(event);
      }
    };

    this._socket.onerror = (event: Event) => {
      this._options.onError?.(event);
      this._dispatch('_error', event);
    };
  }

  disconnect(): void {
    this._intentionalClose = true;
    this._stopHeartbeat();

    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    if (this._socket) {
      this._socket.onopen = null;
      this._socket.onmessage = null;
      this._socket.onclose = null;
      this._socket.onerror = null;
      if (this._socket.readyState === WebSocket.OPEN ||
          this._socket.readyState === WebSocket.CONNECTING) {
        this._socket.close(1000, 'Client disconnect');
      }
      this._socket = null;
    }
  }

  // ── State ─────────────────────────────────────────────────────────────────

  get connected(): boolean {
    return this._socket?.readyState === WebSocket.OPEN;
  }

  get state(): WsReadyState {
    switch (this._socket?.readyState) {
      case WebSocket.CONNECTING: return 'connecting';
      case WebSocket.OPEN:       return 'open';
      case WebSocket.CLOSING:    return 'closing';
      default:                   return 'closed';
    }
  }

  // ── Send ──────────────────────────────────────────────────────────────────

  /** Send a raw string or ArrayBuffer. */
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this._socket?.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
    this._socket.send(data);
  }

  /** Send a typed JSON message with `{ type, data }` envelope. */
  sendJson(type: string, data?: unknown): void {
    this.send(JSON.stringify({ type, data }));
  }

  // ── Event subscription ────────────────────────────────────────────────────

  /**
   * Listen for messages with a given `type` field.
   * Special types: `_open`, `_close`, `_error`, `message` (all raw messages).
   * Returns an unsubscribe function.
   */
  on(event: string, handler: (data: unknown) => void): () => void {
    if (!this._handlers.has(event)) {
      this._handlers.set(event, new Set());
    }
    this._handlers.get(event)!.add(handler);
    return () => this._handlers.get(event)?.delete(handler);
  }

  /** Remove all handlers for an event type, or all handlers if no event specified. */
  off(event?: string): void {
    if (event) {
      this._handlers.delete(event);
    } else {
      this._handlers.clear();
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _dispatch(event: string, data: unknown): void {
    const handlers = this._handlers.get(event);
    if (handlers) {
      for (const h of handlers) {
        try { h(data); } catch (err) { console.error(`[WsClient] Handler error for "${event}":`, err); }
      }
    }
  }

  private _scheduleReconnect(): void {
    const ms = this._options.reconnectMs ?? 5000;
    const max = this._options.maxReconnectAttempts ?? 0;

    if (ms <= 0) return;
    if (max > 0 && this._reconnectAttempts >= max) {
      this._options.onClose?.(new CloseEvent('close', { code: 1006, reason: 'Max reconnect attempts reached' }));
      return;
    }

    if (!this._reconnectTimer) {
      // Exponential backoff: base * 2^attempt, capped at 30s
      const delay = Math.min(ms * Math.pow(2, this._reconnectAttempts), 30_000);
      this._reconnectAttempts++;

      this._reconnectTimer = setTimeout(() => {
        this._reconnectTimer = null;
        this._intentionalClose = false;
        this.connect();
      }, delay);
    }
  }

  private _startHeartbeat(): void {
    const ms = this._options.heartbeatMs ?? 30_000;
    if (ms <= 0) return;

    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      if (this._socket?.readyState === WebSocket.OPEN) {
        this._socket.send(this._options.heartbeatPayload ?? '{"type":"ping"}');
      }
    }, ms);
  }

  private _stopHeartbeat(): void {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }
}
