/**
 * Typed localStorage helpers for simple key-value persistence.
 *
 * All keys are stored as-is (no prefix added here — prefix in the calling
 * code, or use Signal/Store `persist` option for reactive persistence).
 *
 * These helpers are intentionally non-reactive. For reactive persistence
 * use Signal({ persist: 'key' }) or Store({ persist: 'prefix' }) instead.
 *
 * @example
 * persistSet('theme', 'dark');
 * const theme = persistGet<string>('theme') ?? 'light';
 * persistRemove('theme');
 */

/** Serialize and write a value to localStorage. Silently ignores quota errors. */
export function persistSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* quota exceeded or storage unavailable — ignore */ }
}

/**
 * Read and deserialize a value from localStorage.
 * Returns `null` when the key is absent or the stored JSON is malformed.
 */
export function persistGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Remove a key from localStorage. No-ops if the key does not exist. */
export function persistRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch { /* storage unavailable — ignore */ }
}
