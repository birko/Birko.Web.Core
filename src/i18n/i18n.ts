import { Signal, signal, type Unsubscribe } from '../state/signal.js';

// ── Types ──────────────────────────────────────────────────────────────────

export type Messages = Record<string, unknown>;

export interface I18nOptions {
  /** Default locale to use on first load. */
  defaultLocale?: string;
  /** Fallback locale when a key is missing in the active locale. */
  fallbackLocale?: string;
  /** LocalStorage key to persist the chosen locale. Empty string disables persistence. */
  storageKey?: string;
}

// ── I18n ───────────────────────────────────────────────────────────────────

export class I18n {
  private _locale: Signal<string>;
  private _messages = new Map<string, Messages>();
  private _fallbackLocale: string;
  private _storageKey: string;
  private _loadedModules = new Set<string>();
  private _basePath = '/locales';

  constructor(options: I18nOptions = {}) {
    const { defaultLocale = 'en', fallbackLocale = 'en', storageKey = '' } = options;
    this._fallbackLocale = fallbackLocale;
    this._storageKey = storageKey;
    this._locale = signal(defaultLocale);
  }

  // ── Locale management ──

  get locale(): string { return this._locale.value; }

  /** Configure base path for locale JSON files (default: '/locales'). */
  setBasePath(path: string): void {
    this._basePath = path.replace(/\/$/, '');
  }

  async setLocale(locale: string): Promise<void> {
    // Load core translations
    await this._loadBundle(locale, `${this._basePath}/${locale}.json`);
    if (locale !== this._fallbackLocale) {
      await this._loadBundle(this._fallbackLocale, `${this._basePath}/${this._fallbackLocale}.json`);
    }

    // Reload already-loaded module translations for new locale
    await Promise.all(
      [...this._loadedModules].map(id =>
        this._loadBundle(locale, `${this._basePath}/modules/${id}/${locale}.json`)
      )
    );

    this._locale.update(() => locale);

    if (this._storageKey) {
      localStorage.setItem(this._storageKey, locale);
    }

    document.documentElement.setAttribute('lang', locale);
  }

  /** Subscribe to locale changes (triggers component re-render). */
  onLocaleChange(fn: (locale: string) => void): Unsubscribe {
    return this._locale.onChange(fn);
  }

  // ── Translation ──

  t(key: string, params?: Record<string, string | number>): string {
    const locale = this._locale.value;

    // Try plural resolution first (when params has 'count')
    let value: string | null = null;
    if (params && 'count' in params) {
      value = this._resolvePlural(key, locale, Number(params.count))
           ?? this._resolvePlural(key, this._fallbackLocale, Number(params.count));
    }

    // Standard resolution
    if (value === null) {
      value = this._resolve(key, locale)
           ?? this._resolve(key, this._fallbackLocale)
           ?? key;
    }

    // Parameter interpolation: {name} → value
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }

    return value;
  }

  // ── Module lazy loading ──

  async loadModule(moduleId: string): Promise<void> {
    if (this._loadedModules.has(moduleId)) return;
    this._loadedModules.add(moduleId);

    const locale = this._locale.value;
    await this._loadBundle(locale, `${this._basePath}/modules/${moduleId}/${locale}.json`);
    if (locale !== this._fallbackLocale) {
      await this._loadBundle(this._fallbackLocale, `${this._basePath}/modules/${moduleId}/${this._fallbackLocale}.json`);
    }
  }

  // ── Manual message injection ──

  /** Merge messages into a locale bundle (useful for testing or embedded translations). */
  addMessages(locale: string, messages: Messages): void {
    const existing = this._messages.get(locale) ?? {};
    this._messages.set(locale, this._deepMerge(existing, messages));
  }

  // ── Internal ──

  private _resolve(key: string, locale: string): string | null {
    const bundle = this._messages.get(locale);
    if (!bundle) return null;

    const parts = key.split('.');
    let current: unknown = bundle;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return null;
      current = (current as Record<string, unknown>)[part];
    }
    return typeof current === 'string' ? current : null;
  }

  private _resolvePlural(key: string, locale: string, count: number): string | null {
    const bundle = this._messages.get(locale);
    if (!bundle) return null;

    const parts = key.split('.');
    let current: unknown = bundle;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return null;
      current = (current as Record<string, unknown>)[part];
    }

    if (current && typeof current === 'object' && !Array.isArray(current)) {
      const rules = new Intl.PluralRules(locale);
      const form = rules.select(count); // 'one', 'few', 'many', 'other'
      return (current as Record<string, string>)[form]
        ?? (current as Record<string, string>)['other']
        ?? null;
    }
    return null;
  }

  private async _loadBundle(locale: string, url: string): Promise<void> {
    try {
      const resp = await fetch(url);
      if (!resp.ok) return;
      const data = await resp.json();
      const existing = this._messages.get(locale) ?? {};
      this._messages.set(locale, this._deepMerge(existing, data));
    } catch {
      // Translation file may not exist for all locales — silent fail
    }
  }

  private _deepMerge(target: Messages, source: Messages): Messages {
    const result = { ...target };
    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this._deepMerge(
          (result[key] as Messages) ?? {},
          value as Messages,
        );
      } else {
        result[key] = value;
      }
    }
    return result;
  }
}
