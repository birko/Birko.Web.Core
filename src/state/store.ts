import { Signal, signal, type Subscriber, type Unsubscribe } from './signal.js';

/**
 * Simple key-value store backed by signals.
 * Each key is an independent signal — subscribers only fire for their slice.
 */
export class Store<T extends object> {
  private _signals = new Map<string, Signal<unknown>>();
  private _initial: T;

  constructor(initial: T) {
    this._initial = { ...initial };
    for (const [key, value] of Object.entries(initial)) {
      this._signals.set(key, signal(value));
    }
  }

  /** Get current value of a key. */
  get<K extends keyof T>(key: K): T[K] {
    return this._getSignal(key as string).value as T[K];
  }

  /** Set value for a key. Notifies subscribers of that key. */
  set<K extends keyof T>(key: K, value: T[K]): void {
    this._getSignal(key as string).value = value;
  }

  /** Subscribe to changes on a specific key. */
  on<K extends keyof T>(key: K, fn: Subscriber<T[K]>): Unsubscribe {
    return this._getSignal(key as string).subscribe(fn as Subscriber<unknown>);
  }

  /** Subscribe to changes without immediate emission. */
  onChange<K extends keyof T>(key: K, fn: Subscriber<T[K]>): Unsubscribe {
    return this._getSignal(key as string).onChange(fn as Subscriber<unknown>);
  }

  /** Reset all keys to initial values. */
  reset(): void {
    for (const [key, value] of Object.entries(this._initial)) {
      this.set(key as keyof T, value as T[keyof T]);
    }
  }

  /** Get a snapshot of the entire state. */
  snapshot(): T {
    const result = {} as Record<string, unknown>;
    for (const [key, sig] of this._signals) {
      result[key] = sig.value;
    }
    return result as T;
  }

  private _getSignal(key: string): Signal<unknown> {
    let s = this._signals.get(key);
    if (!s) {
      s = signal<unknown>(undefined);
      this._signals.set(key, s);
    }
    return s;
  }
}
