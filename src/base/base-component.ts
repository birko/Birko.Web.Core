import { t, onI18nChange } from '../i18n/global.js';

/**
 * Base class for all Birko web components.
 * Provides: Shadow DOM, adopted stylesheets, reactive observed attributes,
 * lifecycle hooks, and template rendering.
 */
export abstract class BaseComponent extends HTMLElement {
  private _initialized = false;
  private _listenerAC: AbortController | null = null;

  // ── Global broadcast — re-render all live components ──

  private static _liveInstances = new Set<BaseComponent>();
  private static _broadcastUnsubs: (() => void)[] = [];

  /**
   * Register a global trigger that re-renders all mounted components.
   * Uses DOM morphing to preserve custom element state (tables, forms, etc.).
   * Typical use: `BaseComponent.onGlobalChange(i18n.onLocaleChange.bind(i18n))`
   * @param subscribe A function that accepts a callback and returns an unsubscribe fn.
   */
  static onGlobalChange(subscribe: (cb: () => void) => () => void): void {
    const unsub = subscribe(() => {
      for (const instance of BaseComponent._liveInstances) {
        try {
          // Only soft-update components in the document (not inside shadow DOMs).
          // Shadow-DOM children are preserved by the parent's morph; their observed
          // attributes trigger attributeChangedCallback → update() if needed.
          // This avoids duplicate event listeners and stripping dynamic CSS classes.
          const root = instance.getRootNode();
          if (root instanceof Document) {
            instance.softUpdate();
          }
        } catch { /* don't let one broken component stop the rest */ }
      }
    });
    BaseComponent._broadcastUnsubs.push(unsub);
  }

  /** Override to declare observed attributes for reactive updates. */
  static get observedAttributes(): string[] {
    return [];
  }

  /** Override to provide component CSS (adopted into Shadow DOM). */
  static get styles(): string {
    return '';
  }

  /** Override to prepend shared CSSStyleSheet objects (parsed once, reused across components). */
  static get sharedStyles(): CSSStyleSheet[] {
    return [];
  }

  /** Override to return the component's HTML template. */
  abstract render(): string;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  async connectedCallback(): Promise<void> {
    BaseComponent._liveInstances.add(this);
    this._applyStyles();
    // Initial render — populate shadow DOM but skip onUpdated() until after onMount
    try {
      if (this.shadowRoot) {
        this.shadowRoot.innerHTML = this.render();
      }
    } catch (err) {
      console.error(`${this.constructor.name}: render() threw`, err);
      if (this.shadowRoot) {
        const msg = err instanceof Error ? err.message : String(err);
        this.shadowRoot.innerHTML = `<div style="padding:var(--b-space-md, .75rem);color:var(--b-color-danger, #b91c1c);font:var(--b-text-xs, 0.6875rem)/1.4 var(--b-font-mono, monospace)"><b>${this.constructor.name}</b>: ${msg}</div>`;
      }
      BaseComponent._liveInstances.delete(this);
      return;
    }
    this._initialized = true;
    this._listenerAC = new AbortController();
    try {
      await this.onMount();
    } catch (err) {
      console.error(`${this.constructor.name}: onMount() threw`, err);
    }
    // Now that onMount has completed (async data loaded), run the first onUpdated
    this.onUpdated();
  }

  disconnectedCallback(): void {
    BaseComponent._liveInstances.delete(this);
    this._listenerAC?.abort();
    this._listenerAC = null;
    this.onUnmount();
  }

  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void {
    if (this._initialized && oldValue !== newValue) {
      this.update();
    }
  }

  /** Called after first render. Override for setup logic. */
  protected onMount(): void {}

  /** Called on disconnect. Override for cleanup. */
  protected onUnmount(): void {}

  /**
   * Re-render the component.
   * First render uses innerHTML (fast, no existing DOM to preserve).
   * Subsequent renders use DOM morphing to preserve child custom elements,
   * their internal state (expanded nodes, form values, event listeners), and
   * shadow DOM subtrees.
   */
  protected update(): void {
    if (!this.shadowRoot) return;
    try {
      if (!this._initialized) {
        this.shadowRoot.innerHTML = this.render();
      } else {
        const tpl = document.createElement('template');
        tpl.innerHTML = this.render();
        BaseComponent._morphChildren(this.shadowRoot, tpl.content);
      }
    } catch (err) {
      console.error(`${this.constructor.name}: render() threw during update`, err);
      return;
    }
    // Abort previous listeners registered via listen(), then create fresh signal
    this._listenerAC?.abort();
    this._listenerAC = new AbortController();
    this.onUpdated();
  }

  /**
   * Soft-update: morph the DOM in place instead of replacing innerHTML.
   * Preserves custom elements and their internal state (table data, form values, event listeners).
   * Used by onGlobalChange (e.g. locale switch) to avoid destroying component trees.
   */
  protected softUpdate(): void {
    if (!this.shadowRoot) return;
    try {
      const tpl = document.createElement('template');
      tpl.innerHTML = this.render();
      BaseComponent._morphChildren(this.shadowRoot, tpl.content);
    } catch (err) {
      console.error(`${this.constructor.name}: render() threw during softUpdate`, err);
      return;
    }
    this._listenerAC?.abort();
    this._listenerAC = new AbortController();
    this.onUpdated();
  }

  /** Called after each re-render. Override to bind events. */
  protected onUpdated(): void {}

  /** Query an element inside the shadow DOM. */
  protected $<T extends HTMLElement>(selector: string): T | null {
    return this.shadowRoot?.querySelector<T>(selector) ?? null;
  }

  /** Query all elements inside the shadow DOM. */
  protected $$<T extends HTMLElement>(selector: string): T[] {
    return Array.from(this.shadowRoot?.querySelectorAll<T>(selector) ?? []);
  }

  /** Query a child component inside the shadow DOM with typed access to its API. */
  protected child<T extends BaseComponent>(selector: string): T | null {
    return this.shadowRoot?.querySelector<HTMLElement>(selector) as T | null;
  }

  /**
   * Add an event listener that is automatically removed on the next update() cycle.
   * Use this in onUpdated() instead of raw addEventListener to prevent duplicate
   * listeners when DOM morphing preserves elements across re-renders.
   *
   * Generic over the event type so consumers can pass `(e: KeyboardEvent) => void`
   * without losing strict typing.
   */
  protected listen<T extends Event = Event>(
    target: EventTarget,
    event: string,
    handler: (e: T) => void,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(event, handler as EventListener, { ...options, signal: this._listenerAC?.signal });
  }

  /** Dispatch a typed custom event that bubbles through Shadow DOM. */
  protected emit<T>(name: string, detail?: T): void {
    this.dispatchEvent(new CustomEvent(name, {
      detail,
      bubbles: true,
      composed: true,
    }));
  }

  /** Read an attribute as string, with fallback. */
  protected attr(name: string, fallback = ''): string {
    return this.getAttribute(name) ?? fallback;
  }

  /** Read an attribute as boolean (present = true). */
  protected boolAttr(name: string): boolean {
    return this.hasAttribute(name);
  }

  /** Read an attribute as number, with fallback. */
  protected numAttr(name: string, fallback = 0): number {
    const v = this.getAttribute(name);
    return v !== null ? Number(v) : fallback;
  }

  /**
   * Resolve a user-facing label with explicit override > global i18n > English fallback.
   * Priority:
   *   1. If `attrName` is set on the element, that attribute value wins (back-compat).
   *   2. Otherwise, look up `key` via the global i18n singleton.
   *   3. If the key is missing, interpolate params into `fallback`.
   *
   * @param attrName Attribute name consumers may set for a per-instance override.
   * @param key      Canonical translation key (e.g. `bwc.common.close`).
   * @param fallback English fallback used when no attribute and no translation.
   * @param params   Optional interpolation parameters (`{name}` → value).
   */
  protected label(
    attrName: string,
    key: string,
    fallback: string,
    params?: Record<string, string | number>,
  ): string {
    const raw = this.getAttribute(attrName);
    if (raw !== null) {
      if (params) {
        return raw.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`));
      }
      return raw;
    }
    return t(key, params, fallback);
  }

  private _applyStyles(): void {
    const ctor = this.constructor as typeof BaseComponent;
    const shared = ctor.sharedStyles;
    const css = ctor.styles;
    if (!this.shadowRoot) return;
    const sheets: CSSStyleSheet[] = [...shared];
    if (css) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      sheets.push(sheet);
    }
    if (sheets.length) {
      this.shadowRoot.adoptedStyleSheets = sheets;
    }
  }

  // ── DOM morphing — update in place without destroying custom elements ──

  private static _morphChildren(parent: ParentNode, fresh: ParentNode): void {
    const oldCh = Array.from(parent.childNodes);
    const newCh = Array.from(fresh.childNodes);
    const min = Math.min(oldCh.length, newCh.length);

    for (let i = 0; i < min; i++) {
      BaseComponent._morphNode(parent, oldCh[i], newCh[i]);
    }
    // Append new nodes
    for (let i = min; i < newCh.length; i++) {
      parent.appendChild(newCh[i].cloneNode(true));
    }
    // Remove excess old nodes (reverse order to avoid index shift)
    for (let i = oldCh.length - 1; i >= min; i--) {
      parent.removeChild(oldCh[i]);
    }
  }

  private static _morphNode(parent: ParentNode, old: ChildNode, fresh: ChildNode): void {
    // Different node types → replace
    if (old.nodeType !== fresh.nodeType) {
      parent.replaceChild(fresh.cloneNode(true), old);
      return;
    }
    // Text / comment → update content
    if (old.nodeType === Node.TEXT_NODE || old.nodeType === Node.COMMENT_NODE) {
      if (old.textContent !== fresh.textContent) old.textContent = fresh.textContent;
      return;
    }
    if (old.nodeType !== Node.ELEMENT_NODE) return;

    const oldEl = old as Element;
    const freshEl = fresh as Element;

    // Different tag → replace entire subtree
    if (oldEl.tagName !== freshEl.tagName) {
      parent.replaceChild(fresh.cloneNode(true), old);
      return;
    }
    // Same tag — sync attributes
    for (const a of Array.from(oldEl.attributes)) {
      if (!freshEl.hasAttribute(a.name)) oldEl.removeAttribute(a.name);
    }
    for (const a of Array.from(freshEl.attributes)) {
      if (oldEl.getAttribute(a.name) !== a.value) oldEl.setAttribute(a.name, a.value);
    }
    // Self-rendering custom elements (shadow DOM, no light DOM children from parent)
    // manage their own rendering — only sync attributes, don't recurse.
    // Container components (b-card, b-modal, etc.) have light DOM children via slots
    // and MUST be recursed into so the parent can update slotted content.
    if (oldEl.shadowRoot && !freshEl.childNodes.length) return;
    // Recurse into light DOM children (plain elements + container components)
    BaseComponent._morphChildren(oldEl, freshEl);
  }
}

/** Register a web component with its tag name. */
export function define(tag: string, ctor: CustomElementConstructor): void {
  if (!customElements.get(tag)) {
    customElements.define(tag, ctor);
  }
}

// Auto re-render all mounted components when the global i18n locale changes.
BaseComponent.onGlobalChange((cb) => onI18nChange(() => cb()));
