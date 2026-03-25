import type { I18n } from './i18n.js';

// ── Formatting — locale-aware ──────────────────────────────────────────────

export interface Formatter {
  /** Date formatting. */
  date(value: Date | string | number, style?: 'short' | 'long' | 'full'): string;
  /** Time formatting. */
  time(value: Date | string | number, seconds?: boolean): string;
  /** Date + time. */
  datetime(value: Date | string | number): string;
  /** Relative time (e.g., "5 minutes ago"). */
  relative(value: Date | string | number): string;
  /** Number formatting with locale separators. */
  number(value: number, decimals?: number): string;
  /** Currency formatting. */
  currency(value: number, currency?: string): string;
  /** Percentage (input: 0–100, e.g., percent(85) → "85 %"). */
  percent(value: number, decimals?: number): string;
}

/**
 * Create a locale-aware formatter bound to an I18n instance.
 * All formatting uses the current locale from the I18n instance.
 */
export function createFormatter(i18n: I18n): Formatter {
  return {
    date(value: Date | string | number, style: 'short' | 'long' | 'full' = 'short'): string {
      const d = new Date(value);
      const locale = i18n.locale;
      switch (style) {
        case 'short': return d.toLocaleDateString(locale);
        case 'long':  return d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
        case 'full':  return d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      }
    },

    time(value: Date | string | number, seconds = false): string {
      const d = new Date(value);
      return d.toLocaleTimeString(i18n.locale, {
        hour: '2-digit', minute: '2-digit',
        ...(seconds ? { second: '2-digit' } : {}),
      });
    },

    datetime(value: Date | string | number): string {
      return `${this.date(value)} ${this.time(value)}`;
    },

    relative(value: Date | string | number): string {
      const rtf = new Intl.RelativeTimeFormat(i18n.locale, { numeric: 'auto' });
      const diff = Date.now() - new Date(value).getTime();
      const seconds = Math.round(diff / 1000);
      if (Math.abs(seconds) < 60) return rtf.format(-seconds, 'second');
      const minutes = Math.round(seconds / 60);
      if (Math.abs(minutes) < 60) return rtf.format(-minutes, 'minute');
      const hours = Math.round(minutes / 60);
      if (Math.abs(hours) < 24) return rtf.format(-hours, 'hour');
      const days = Math.round(hours / 24);
      return rtf.format(-days, 'day');
    },

    number(value: number, decimals?: number): string {
      return value.toLocaleString(i18n.locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    },

    currency(value: number, currency = 'EUR'): string {
      return value.toLocaleString(i18n.locale, { style: 'currency', currency });
    },

    percent(value: number, decimals = 0): string {
      return (value / 100).toLocaleString(i18n.locale, {
        style: 'percent',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    },
  };
}
