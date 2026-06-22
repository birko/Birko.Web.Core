/**
 * Typed Web Storage helpers for simple key-value persistence.
 *
 * Two backends with identical APIs:
 * - `persistSet` / `persistGet` / `persistRemove` → `localStorage` (survives
 *   browser restarts; per-origin)
 * - `sessionSet` / `sessionGet` / `sessionRemove` → `sessionStorage` (cleared
 *   when the tab closes; per-tab)
 *
 * All keys are stored as-is (no prefix added here — prefix in the calling
 * code, or use Signal/Store `persist` option for reactive persistence).
 *
 * These helpers are intentionally non-reactive. For reactive persistence
 * use Signal({ persist: 'key' }) or Store({ persist: 'prefix' }) instead
 * (localStorage-backed).
 *
 * @example
 * persistSet('theme', 'dark');                 // localStorage
 * const theme = persistGet<string>('theme') ?? 'light';
 * persistRemove('theme');
 *
 * sessionSet('wizard.step', 2);                // sessionStorage (this tab only)
 * const step = sessionGet<number>('wizard.step') ?? 0;
 * sessionRemove('wizard.step');
 */

/** Lazily resolve the backing Storage so a throwing global access stays inside try/catch. */
type StorageGetter = () => Storage;

const localStore: StorageGetter = () => localStorage;
const sessionStore: StorageGetter = () => sessionStorage;

function writeTo(getStore: StorageGetter, key: string, value: unknown): void {
  try {
    getStore().setItem(key, JSON.stringify(value));
  } catch { /* quota exceeded or storage unavailable — ignore */ }
}

function readFrom<T>(getStore: StorageGetter, key: string): T | null {
  try {
    const raw = getStore().getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function removeFrom(getStore: StorageGetter, key: string): void {
  try {
    getStore().removeItem(key);
  } catch { /* storage unavailable — ignore */ }
}

// ── localStorage ─────────────────────────────────────────────────────────────

/** Serialize and write a value to localStorage. Silently ignores quota errors. */
export function persistSet(key: string, value: unknown): void {
  writeTo(localStore, key, value);
}

/**
 * Read and deserialize a value from localStorage.
 * Returns `null` when the key is absent or the stored JSON is malformed.
 */
export function persistGet<T>(key: string): T | null {
  return readFrom<T>(localStore, key);
}

/** Remove a key from localStorage. No-ops if the key does not exist. */
export function persistRemove(key: string): void {
  removeFrom(localStore, key);
}

// ── sessionStorage ───────────────────────────────────────────────────────────

/** Serialize and write a value to sessionStorage (cleared when the tab closes). */
export function sessionSet(key: string, value: unknown): void {
  writeTo(sessionStore, key, value);
}

/**
 * Read and deserialize a value from sessionStorage.
 * Returns `null` when the key is absent or the stored JSON is malformed.
 */
export function sessionGet<T>(key: string): T | null {
  return readFrom<T>(sessionStore, key);
}

/** Remove a key from sessionStorage. No-ops if the key does not exist. */
export function sessionRemove(key: string): void {
  removeFrom(sessionStore, key);
}
