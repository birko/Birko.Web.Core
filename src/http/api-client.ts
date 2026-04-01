/**
 * Minimal fetch-based HTTP client with interceptors and auth support.
 */

/** Metadata for offline-queueable write actions. */
export interface ActionMeta {
  moduleId: string;
  description: string;
  entityType?: string;
  entityId?: string;
}

export interface ApiClientOptions {
  baseUrl: string;
  getToken?: () => string | null;
  getTenant?: () => string | null;
  onUnauthorized?: () => void;
  /**
   * Called on 401 before onUnauthorized. Should attempt to refresh the token
   * and return the new access token, or null if refresh failed.
   * When this returns a new token, the original request is retried automatically.
   */
  onRefreshToken?: () => Promise<string | null>;
  /**
   * Called when a write action is made while offline and `meta` is provided.
   * Should persist the action for later sync. Returns the queue entry ID.
   */
  onQueueAction?: (
    method: 'POST' | 'PUT' | 'DELETE',
    path: string,
    body: unknown,
    meta: ActionMeta,
  ) => Promise<string>;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
  headers: Headers;
  /** True when the action was queued offline instead of sent. */
  queued?: boolean;
  /** ID of the queued action (set when `queued` is true). */
  queueId?: string;
  /** True when the response was served from the service worker cache. */
  fromCache?: boolean;
  /** Timestamp (ms) when the cached response was stored. */
  cachedAt?: number;
}

export class ApiClient {
  private _options: ApiClientOptions;
  private _refreshPromise: Promise<string | null> | null = null;

  constructor(options: ApiClientOptions) {
    this._options = options;
  }

  get baseUrl(): string {
    return this._options.baseUrl;
  }

  async get<T = unknown>(path: string, params?: Record<string, string>): Promise<ApiResponse<T>> {
    let url = path;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += '?' + qs;
    }
    return this._fetch<T>(url, { method: 'GET' });
  }

  async post<T = unknown>(path: string, body?: unknown, meta?: ActionMeta): Promise<ApiResponse<T>> {
    if (!navigator.onLine && meta) return this._queue<T>('POST', path, body, meta);
    return this._fetch<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async put<T = unknown>(path: string, body?: unknown, meta?: ActionMeta): Promise<ApiResponse<T>> {
    if (!navigator.onLine && meta) return this._queue<T>('PUT', path, body, meta);
    return this._fetch<T>(path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async delete<T = unknown>(path: string, meta?: ActionMeta): Promise<ApiResponse<T>> {
    if (!navigator.onLine && meta) return this._queue<T>('DELETE', path, undefined, meta);
    return this._fetch<T>(path, { method: 'DELETE' });
  }

  private async _queue<T>(
    method: 'POST' | 'PUT' | 'DELETE',
    path: string,
    body: unknown,
    meta: ActionMeta,
  ): Promise<ApiResponse<T>> {
    const queueId = await this._options.onQueueAction?.(method, path, body, meta);
    return { ok: true, status: 0, data: null as T, headers: new Headers(), queued: true, queueId };
  }

  private async _fetch<T>(path: string, init: RequestInit): Promise<ApiResponse<T>> {
    const url = this._options.baseUrl.replace(/\/$/, '') + '/' + path.replace(/^\//, '');

    const headers = new Headers(init.headers);

    const token = this._options.getToken?.();
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const tenant = this._options.getTenant?.();
    if (tenant) {
      headers.set('X-Tenant-Id', tenant);
    }

    let response: Response;
    try {
      response = await fetch(url, { ...init, headers });
    } catch (err) {
      // Network error (server unreachable, DNS failure, CORS, etc.)
      console.error(`[ApiClient] Network error: ${init.method ?? 'GET'} ${path}`, err);
      return { ok: false, status: 0, data: null as T, headers: new Headers() };
    }

    if (response.status === 401 && this._options.onRefreshToken) {
      // Deduplicate concurrent refresh attempts
      if (!this._refreshPromise) {
        this._refreshPromise = this._options.onRefreshToken().finally(() => {
          this._refreshPromise = null;
        });
      }
      const newToken = await this._refreshPromise;
      if (newToken) {
        // Retry original request with new token
        headers.set('Authorization', `Bearer ${newToken}`);
        try {
          response = await fetch(url, { ...init, headers });
        } catch {
          return { ok: false, status: 0, data: null as T, headers: new Headers() };
        }
      }
      // If still 401 after refresh (or refresh returned null), log out
      if (response.status === 401) {
        this._options.onUnauthorized?.();
      }
    } else if (response.status === 401) {
      this._options.onUnauthorized?.();
    }

    let data: T;
    try {
      const contentType = response.headers.get('Content-Type') ?? '';
      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        const text = await response.text();
        data = text as unknown as T;
      }
    } catch {
      // Malformed response body
      data = null as T;
    }

    if (!response.ok) {
      const method = init.method ?? 'GET';
      const detail = data && typeof data === 'object' && 'Detail' in (data as any)
        ? (data as any).Detail
        : undefined;
      const error = data && typeof data === 'object' && 'Error' in (data as any)
        ? (data as any).Error
        : undefined;
      console.error(
        `[API ${response.status}] ${method} ${path}` +
        (error ? `\n  Error: ${error}` : '') +
        (detail ? `\n  Detail: ${detail}` : ''),
      );
    }

    return {
      ok: response.ok,
      status: response.status,
      data,
      headers: response.headers,
    };
  }
}
