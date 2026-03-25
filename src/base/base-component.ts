/**
 * Base class for all Birko web components.
 * Provides: Shadow DOM, adopted stylesheets, reactive observed attributes,
 * lifecycle hooks, and template rendering.
 */
export abstract class BaseComponent extends HTMLElement {
  private _initialized = false;

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
    this._applyStyles();
    this.update();
    this._initialized = true;
    this.onMount();
  }

  disconnectedCallback(): void {
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

  /** Re-render the component. */
  protected update(): void {
    if (!this.shadowRoot) return;
    this.shadowRoot.innerHTML = this.render();
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
}

/** Register a web component with its tag name. */
export function define(tag: string, ctor: CustomElementConstructor): void {
  if (!customElements.get(tag)) {
    customElements.define(tag, ctor);
  }
}
