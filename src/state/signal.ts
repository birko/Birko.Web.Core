/**
 * Minimal reactive signal implementation.
 * A signal holds a value and notifies subscribers when it changes.
 */
export type Subscriber<T> = (value: T) => void;
export type Unsubscribe = () => void;

export class Signal<T> {
  private _value: T;
  private _subscribers = new Set<Subscriber<T>>();

  constructor(initialValue: T) {
    this._value = initialValue;
  }

  /** Get the current value. */
  get value(): T {
    return this._value;
  }

  /** Set a new value. Notifies subscribers only if value changed. */
  set value(newValue: T) {
    if (this._value !== newValue) {
      this._value = newValue;
      this._notify();
    }
  }

  /** Update value using a function (useful for objects/arrays). Always notifies. */
  update(fn: (current: T) => T): void {
    this._value = fn(this._value);
    this._notify();
  }

  /** Subscribe to changes. Returns an unsubscribe function. */
  subscribe(fn: Subscriber<T>): Unsubscribe {
    this._subscribers.add(fn);
    fn(this._value); // Emit current value immediately
    return () => this._subscribers.delete(fn);
  }

  /** Subscribe without immediate emission. */
  onChange(fn: Subscriber<T>): Unsubscribe {
    this._subscribers.add(fn);
    return () => this._subscribers.delete(fn);
  }

  private _notify(): void {
    for (const fn of this._subscribers) {
      fn(this._value);
    }
  }
}

/** Create a signal with an initial value. */
export function signal<T>(value: T): Signal<T> {
  return new Signal(value);
}

/**
 * Derived signal — computes value from one or more source signals.
 * Re-computes whenever any source changes.
 */
export function computed<T>(fn: () => T, deps: Signal<unknown>[]): Signal<T> {
  const s = new Signal<T>(fn());
  for (const dep of deps) {
    dep.onChange(() => {
      s.value = fn();
    });
  }
  return s;
}
