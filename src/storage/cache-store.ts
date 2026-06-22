/**
 * Ergonomic wrapper over the Cache API (`caches.open(name)`), for caching
 * HTTP responses / assets keyed by Request or URL. Zero dependencies.
 *
 * The Cache API stores `Response` objects, so this is the right tool for
 * network payloads and static assets — not arbitrary structured data (use
 * `IndexedDbStore`) or small flags (use `persistSet` / `sessionSet`).
 *
 * Requires a secure context (https or localhost). Note: `Cache.put` only
 * accepts GET requests — non-GET requests are skipped by `fetch()`.
 *
 * @example
 * const cache = new CacheStore('api-v1');
 *
 * // Cache-first fetch with a 5-minute freshness window:
 * const res = await cache.fetch('/api/config', { maxAgeMs: 5 * 60_000 });
 * const config = await res.json();
 *
 * // Store / read a value as JSON directly:
 * await cache.putJson('/api/profile', { name: 'Alice' });
 * const profile = await cache.matchJson<{ name: string }>('/api/profile');
 */

/** Header stamped on cached responses so `fetch`/`matchJson` can judge staleness. */
const CACHED_AT_HEADER = 'x-birko-cached-at';

export interface CacheFetchOptions {
  /** Max age of a cached entry, in ms. Older entries are refetched. Omit = never stale. */
  maxAgeMs?: number;
  /** Bypass the cache and always go to the network (the fresh result is still stored). */
  forceRefresh?: boolean;
  /** Passed through to the network `fetch` when a request is made. */
  init?: RequestInit;
}

export class CacheStore {
  private readonly _name: string;
  private _cachePromise: Promise<Cache> | null = null;

  constructor(name = 'birko-cache') {
    this._name = name;
  }

  /** True when the Cache API is available (secure context, supported browser). */
  static isSupported(): boolean {
    return typeof caches !== 'undefined';
  }

  // ── Core Cache API ──

  /** Return the cached response for a request, or `undefined`. */
  async match(request: RequestInfo | URL, options?: CacheQueryOptions): Promise<Response | undefined> {
    const cache = await this._cache();
    return cache.match(request, options);
  }

  /** Store a response under a request key. Request must be GET. */
  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    const cache = await this._cache();
    await cache.put(request, response);
  }

  /** Fetch a request from the network and store the response. */
  async add(request: RequestInfo | URL): Promise<void> {
    const cache = await this._cache();
    await cache.add(request);
  }

  /** Fetch several requests from the network and store all responses. */
  async addAll(requests: Array<RequestInfo | URL>): Promise<void> {
    const cache = await this._cache();
    await cache.addAll(requests as RequestInfo[]);
  }

  /** Delete a cached entry. Resolves `true` if something was removed. */
  async delete(request: RequestInfo | URL, options?: CacheQueryOptions): Promise<boolean> {
    const cache = await this._cache();
    return cache.delete(request, options);
  }

  /** List the request keys currently in the cache. */
  async keys(request?: RequestInfo | URL, options?: CacheQueryOptions): Promise<readonly Request[]> {
    const cache = await this._cache();
    return cache.keys(request, options);
  }

  /** True when an entry exists for the request. */
  async has(request: RequestInfo | URL, options?: CacheQueryOptions): Promise<boolean> {
    return (await this.match(request, options)) !== undefined;
  }

  /** Remove every entry but keep the cache. */
  async clear(): Promise<void> {
    const cache = await this._cache();
    const keys = await cache.keys();
    await Promise.all(keys.map(k => cache.delete(k)));
  }

  /** Close and delete the entire named cache. */
  async destroy(): Promise<void> {
    this._cachePromise = null;
    if (CacheStore.isSupported()) await caches.delete(this._name);
  }

  // ── JSON convenience ──

  /** Read a cached entry and parse its body as JSON. `undefined` if absent. */
  async matchJson<T>(request: RequestInfo | URL, options?: CacheQueryOptions): Promise<T | undefined> {
    const res = await this.match(request, options);
    if (!res) return undefined;
    return await res.clone().json() as T;
  }

  /** Serialize a value to a JSON Response and store it under a request key. */
  async putJson(request: RequestInfo | URL, data: unknown, init?: ResponseInit): Promise<void> {
    const headers = new Headers(init?.headers);
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    headers.set(CACHED_AT_HEADER, String(Date.now()));
    await this.put(request, new Response(JSON.stringify(data), { ...init, headers }));
  }

  // ── Cache-first fetch ──

  /**
   * Cache-first fetch: return a fresh-enough cached response if present,
   * otherwise hit the network and store the result. Always resolves a usable
   * `Response` (the caller can `.json()` / `.text()` it).
   */
  async fetch(request: RequestInfo | URL, options: CacheFetchOptions = {}): Promise<Response> {
    const { maxAgeMs, forceRefresh, init } = options;

    if (!forceRefresh) {
      const cached = await this.match(request);
      if (cached && !this._isStale(cached, maxAgeMs)) return cached.clone();
    }

    const fresh = await fetch(request as RequestInfo, init);
    if (fresh.ok && this._isGet(request, init)) {
      await this.put(request, await this._stamp(fresh.clone()));
    }
    return fresh;
  }

  // ── Internal ──

  private _cache(): Promise<Cache> {
    if (!CacheStore.isSupported()) {
      return Promise.reject(new Error('Cache API unavailable (requires a secure context).'));
    }
    if (!this._cachePromise) {
      this._cachePromise = caches.open(this._name);
      this._cachePromise.catch(() => { this._cachePromise = null; });
    }
    return this._cachePromise;
  }

  /** Rebuild a response carrying a `cached-at` stamp (headers are otherwise immutable). */
  private async _stamp(res: Response): Promise<Response> {
    const headers = new Headers(res.headers);
    headers.set(CACHED_AT_HEADER, String(Date.now()));
    return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers });
  }

  private _isStale(res: Response, maxAgeMs?: number): boolean {
    if (maxAgeMs == null) return false;
    const ts = Number(res.headers.get(CACHED_AT_HEADER));
    if (!ts) return true; // unknown age, but a freshness window was requested
    return Date.now() - ts > maxAgeMs;
  }

  private _isGet(request: RequestInfo | URL, init?: RequestInit): boolean {
    const method = request instanceof Request ? request.method : (init?.method ?? 'GET');
    return method.toUpperCase() === 'GET';
  }
}
