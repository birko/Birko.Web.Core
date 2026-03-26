/**
 * Base class for all Birko web components.
 * Provides: Shadow DOM, adopted stylesheets, reactive observed attributes,
 * lifecycle hooks, and template rendering.
 */
export abstract class BaseComponent extends HTMLElement {
  private _initialized = false;

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

  connectedCallback(): void {
    BaseComponent._liveInstances.add(this);
    this._applyStyles();
    this.update();
    this._initialized = true;
    this.onMount();
  }

  disconnectedCallback(): void {
    BaseComponent._liveInstances.delete(this);
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

  /** Re-render the component (full innerHTML replacement). */
  protected update(): void {
    if (!this.shadowRoot) return;
    this.shadowRoot.innerHTML = this.render();
    this.onUpdated();
  }

  /**
   * Soft-update: morph the DOM in place instead of replacing innerHTML.
   * Preserves custom elements and their internal state (table data, form values, event listeners).
   * Used by onGlobalChange (e.g. locale switch) to avoid destroying component trees.
   */
  protected softUpdate(): void {
    if (!this.shadowRoot) return;
    const tpl = document.createElement('template');
    tpl.innerHTML = this.render();
    BaseComponent._morphChildren(this.shadowRoot, tpl.content);
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
    // Recurse into light DOM children
    BaseComponent._morphChildren(oldEl, freshEl);
  }
}

/** Register a web component with its tag name. */
export function define(tag: string, ctor: CustomElementConstructor): void {
  if (!customElements.get(tag)) {
    customElements.define(tag, ctor);
  }
}
