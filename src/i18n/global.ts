import { I18n } from './i18n.js';
import { createFormatter, type Formatter } from './fmt.js';

// ── Global singleton ───────────────────────────────────────────────────────
//
// Components call `t(key, params, fallback)` directly. By default the singleton
// is a blank I18n instance — keys resolve to the English fallback string.
// Apps that already own an I18n instance call `useI18n(mine)` once at bootstrap
// to swap the singleton, so components read from their translation bundle.
//
// Locale changes propagate via `onI18nChange` — subscribers are re-wired
// automatically when the singleton is swapped via `useI18n`.

let _i18n: I18n = new I18n();
let _formatter: Formatter = createFormatter(_i18n);
let _subscribers: Array<(locale: string) => void> = [];
let _localeUnsub: (() => void) | null = null;

function _rewireLocaleBridge(): void {
  _localeUnsub?.();
  _localeUnsub = _i18n.onLocaleChange((locale) => {
    for (const fn of _subscribers) {
      try { fn(locale); } catch { /* isolate subscriber errors */ }
    }
  });
}
_rewireLocaleBridge();

/** Replace the global i18n instance (e.g. with an app-owned I18n). One-line bootstrap. */
export function useI18n(instance: I18n): void {
  _i18n = instance;
  _formatter = createFormatter(instance);
  _rewireLocaleBridge();
  // Broadcast once so components refresh against the new instance.
  const locale = instance.locale;
  for (const fn of _subscribers) {
    try { fn(locale); } catch { /* isolate */ }
  }
}

/** Access the current global I18n instance. */
export function getI18n(): I18n {
  return _i18n;
}

/** Access the current locale-bound formatter. */
export function getFormatter(): Formatter {
  return _formatter;
}

/**
 * Translate a key via the global i18n instance.
 * If the key is missing, returns the interpolated `fallback` (or the key itself).
 *
 * @param key       Translation key (e.g. `bwc.common.close`).
 * @param params    Optional interpolation parameters (`{name}` → value).
 * @param fallback  Optional English fallback when the key is missing.
 */
export function t(key: string, params?: Record<string, string | number>, fallback?: string): string {
  const result = _i18n.t(key, params);
  if (result === key && fallback !== undefined) {
    if (params) {
      return fallback.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`));
    }
    return fallback;
  }
  return result;
}

/** Subscribe to locale changes on the current (and future) global i18n instance. */
export function onI18nChange(fn: (locale: string) => void): () => void {
  _subscribers.push(fn);
  return () => {
    _subscribers = _subscribers.filter(f => f !== fn);
  };
}
