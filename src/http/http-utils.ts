import type { ApiResponse } from './api-client.js';

/**
 * Standard paginated response envelope returned by Birko API endpoints.
 * Endpoints may return either a raw array or this wrapper — use unwrapList()
 * to handle both transparently.
 */
export interface PagedResult<T> {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
}

/**
 * Extract the item array from an API response that returns either:
 *  - a raw array:            T[]
 *  - a paged envelope:       PagedResult<T>  ({ items, totalCount, page, pageSize })
 *  - a keyed object:         { [dataKey]: T[] }  (pass dataKey as second arg)
 *
 * Returns [] on missing / null data so callers never have to null-check.
 *
 * @example
 * const resp = await api.get<Product[]>('api/products');
 * const items = unwrapList(resp);
 *
 * @example
 * const resp = await api.get('api/products');
 * const items = unwrapList<Product>(resp, 'results');
 */
export function unwrapList<T>(
  response: ApiResponse<unknown>,
  dataKey?: string,
): T[] {
  const data = response.data;
  if (!data) return [];
  if (Array.isArray(data)) return data as T[];
  if (typeof data !== 'object') return [];

  // Named key override (e.g. { results: [...] })
  if (dataKey) {
    const keyed = (data as Record<string, unknown>)[dataKey];
    return Array.isArray(keyed) ? (keyed as T[]) : [];
  }

  // Standard PagedResult envelope
  const paged = data as Partial<PagedResult<T>>;
  if (Array.isArray(paged.items)) return paged.items;

  return [];
}

/**
 * Extract a human-readable error message from an API error response body.
 *
 * Handles the following formats (in order):
 *  1. ASP.NET ProblemDetails — `{ title, detail }`
 *  2. Custom error wrapper  — `{ error: { message } }` or `{ error: string }`
 *  3. Flat message field    — `{ message }`
 *  4. Plain string body
 *  5. Fallback              — `fallback` parameter (default: 'An unexpected error occurred')
 *
 * @example
 * const resp = await api.post('api/items', payload);
 * if (!resp.ok) toast.error(apiErrorMessage(resp.data));
 */
export function apiErrorMessage(
  data: unknown,
  fallback = 'An unexpected error occurred',
): string {
  if (!data) return fallback;
  if (typeof data === 'string' && data.trim()) return data;
  if (typeof data !== 'object') return fallback;

  const obj = data as Record<string, unknown>;

  // ASP.NET ProblemDetails: detail > title
  if (typeof obj['detail'] === 'string' && obj['detail']) return obj['detail'];
  if (typeof obj['title'] === 'string' && obj['title']) return obj['title'];

  // { error: { message } }
  if (obj['error'] && typeof obj['error'] === 'object') {
    const err = obj['error'] as Record<string, unknown>;
    if (typeof err['message'] === 'string' && err['message']) return err['message'];
  }

  // { error: string }
  if (typeof obj['error'] === 'string' && obj['error']) return obj['error'];

  // { message: string }
  if (typeof obj['message'] === 'string' && obj['message']) return obj['message'];

  return fallback;
}
