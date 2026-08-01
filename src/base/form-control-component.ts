import { BaseComponent } from './base-component.js';

/**
 * Base class for **form-associated** Birko components — controls that participate in a native
 * `<form>`: their value lands in `FormData`, `form.reportValidity()` sees them, `form.reset()` restores
 * them, and `<fieldset disabled>` reaches them.
 *
 * ## Why this is a separate class and not part of `BaseComponent`
 *
 * `static formAssociated = true` is read by the custom-element registry **per class at definition
 * time**, and `attachInternals()` must be called in the constructor and only ever once. Putting either
 * on `BaseComponent` would make every component — `b-card`, `b-modal`, `b-table` — a form control, and
 * a form-associated element is not free: it becomes a submittable listed element, `:invalid` starts
 * matching it, and a surrounding `<fieldset disabled>` starts disabling it. So form participation is
 * opt-in: extend this instead of `BaseComponent`.
 *
 * ## What a subclass must do
 *
 * 1. Call {@link syncFormState} whenever its value changes — the same places it already emits `change`,
 *    plus once after the first render so the initial value is submittable.
 * 2. Override {@link formValue} if its submitted shape is not "the `value` property as a string" —
 *    a checkbox submits only when checked, a multi-value control submits one entry per value.
 * 3. Override {@link formAnchor} to point at the inner control, so the browser's validation bubble
 *    appears on the control rather than on the host's top-left corner.
 *
 * ## Validity
 *
 * {@link syncFormState} mirrors, in order of precedence:
 * 1. the `error` attribute → `customError` with that message (this is what `b-form` and page-level
 *    validation set, and it must win — it is the app's considered verdict);
 * 2. otherwise the **inner native control's own `validity`**, verbatim. That is deliberate: it means
 *    `type="email"`, `min`, `max`, `step`, `pattern` and `required` on the inner `<input>` — which were
 *    previously invisible to any wrapping form — are enforced by the form for free, instead of being
 *    reimplemented here and drifting from the browser's own rules.
 */
export abstract class FormControlComponent extends BaseComponent {
  static formAssociated = true;

  private _internals: ElementInternals;
  /**
   * State at first sync, restored by `form.reset()`. `unknown` because the shape is per-control — a
   * string for value-backed controls, a boolean for toggles, a `string[]` for multi-value ones. See
   * {@link captureInitialState}.
   */
  private _initialState: unknown = null;
  private _initialCaptured = false;
  /** Disabled by an ancestor `<fieldset disabled>` — kept separate from the host's own attribute. */
  private _formDisabled = false;

  constructor() {
    super();
    this._internals = this.attachInternals();
  }

  /**
   * The control's current value as a string — the unified accessor every Birko input exposes.
   *
   * Declared **abstract** so the requirement is enforced at compile time. {@link formValue} and
   * {@link restoreInitialState} both depend on it, and before this was abstract they reached it through a
   * structural cast, which meant a subclass that forgot `value` compiled fine and failed at runtime.
   *
   * A subclass may widen the setter (e.g. also accepting a range object) — only the string form is
   * required.
   */
  abstract get value(): string;
  abstract set value(v: string);

  // ── Native form-control surface, forwarded from ElementInternals ──

  /** The form this control belongs to, or null. */
  get form(): HTMLFormElement | null { return this._internals.form; }
  /** Labels associated with this control via `<label for>`. */
  get labels(): NodeList { return this._internals.labels; }
  get validity(): ValidityState { return this._internals.validity; }
  get validationMessage(): string { return this._internals.validationMessage; }
  get willValidate(): boolean { return this._internals.willValidate; }
  checkValidity(): boolean { return this._internals.checkValidity(); }
  reportValidity(): boolean { return this._internals.reportValidity(); }

  /** Escape hatch for subclasses that need the raw internals (e.g. custom ARIA reflection). */
  protected get internals(): ElementInternals { return this._internals; }

  // ── Overridables ──

  /**
   * The value submitted with the form. Default: the `value` property as a string, or `null` when empty
   * so an untouched control contributes **no** `FormData` entry (matching native behaviour — an empty
   * `<select multiple>` submits nothing rather than an empty string).
   *
   * Return a `FormData` to contribute several entries under the control's own name (the native
   * `<select multiple>` shape), or `null` to contribute nothing.
   */
  protected formValue(): string | File | FormData | null {
    const v: unknown = this.value;
    const s = v == null ? '' : String(v);
    return s === '' ? null : s;
  }

  /**
   * Build a multi-entry `FormData` under this control's `name` — the native `<select multiple>` /
   * checkbox-group shape, where the server receives a list rather than one delimited string. Returns
   * `null` for an empty list so nothing is submitted.
   *
   * Helper for {@link formValue} overrides on multi-value controls.
   */
  protected multiFormValue(values: readonly string[]): FormData | null {
    if (values.length === 0) return null;
    const name = this.getAttribute('name') ?? '';
    const fd = new FormData();
    for (const v of values) fd.append(name, v);
    return fd;
  }

  /**
   * Build a `FormData` whose entries are named `${name}-${suffix}` — for a control holding **two
   * distinct values** (a numeric range, a date range) where there is no native single control to
   * imitate. A server then binds two ordinary fields (`period-from`, `period-to`) instead of parsing a
   * delimiter out of one.
   *
   * Empty parts are omitted; returns `null` when every part is empty, so an untouched control submits
   * nothing. Contrast {@link multiFormValue}, which is for *lists* of like values under one name.
   */
  protected suffixedFormValue(parts: readonly (readonly [suffix: string, value: string])[]): FormData | null {
    const name = this.getAttribute('name') ?? '';
    const fd = new FormData();
    let any = false;
    for (const [suffix, value] of parts) {
      if (value === '') continue;
      fd.append(`${name}-${suffix}`, value);
      any = true;
    }
    return any ? fd : null;
  }

  /**
   * The element the validation bubble anchors to — return the inner control. Default: the first native
   * control in the shadow root, which is right for every wrapper around a single `<input>` / `<select>`
   * / `<textarea>`; override for div-based controls.
   */
  protected formAnchor(): HTMLElement | undefined {
    return this.shadowRoot?.querySelector<HTMLElement>('input, select, textarea') ?? undefined;
  }

  /**
   * Whether the generic `required` check (used when {@link validationSource} is `undefined`) applies.
   *
   * Set `false` where `required` is a property of a **group** rather than of one element — radio buttons,
   * whose members share a `name` and are collectively satisfied by any one being checked. Evaluating it
   * per element there would mark every unchecked member invalid and surface N validation bubbles for one
   * logical field.
   */
  protected get supportsRequiredValidation(): boolean {
    return true;
  }

  /**
   * Message for the generic `required` check applied to controls with no native primitive. The label is
   * included when one is set, matching the browser's own phrasing style.
   *
   * Resolved through the library's standard three-step path — per-instance `label-required` attribute >
   * global i18n > English fallback — because this message is **user-visible**: `b-form.validate()` now
   * consults the control's verdict, so an untranslated string here lands in a form whose other errors are
   * translated. Overriding the method still works and still wins; i18n is an additional layer, not a
   * replacement (and subclassing is not a real escape hatch — the reference consumers define no `b-*`
   * subclass at all).
   *
   * **Key choice.** The labelled form reuses `common.required` — the *same* key `b-form` uses for its own
   * `required` rule. One condition, one key: a consumer who has translated the rule message has, by that
   * act, translated this one too, and the two can no longer disagree. That also settles the cosmetic
   * divergence between the two layers' fallbacks (`… is required.` here, `… is required` in `b-form`):
   * once anything is registered under the key both layers say the same thing. The fallbacks themselves are
   * left alone — they are the observable behaviour for a consumer with no i18n configured, and asserted
   * downstream as such.
   */
  protected requiredMessage(): string {
    const label = this.getAttribute('label');
    return label
      ? this.label('label-required', 'common.required', '{label} is required.', { label })
      : this.label('label-required', 'common.requiredNoLabel', 'Please fill out this field.');
  }

  /**
   * The inner native control whose `validity` is mirrored onto the host. Defaults to
   * {@link formAnchor}'s element when it is a native control. Return `undefined` for controls with no
   * native primitive (div-based combos) — validity then comes from the `error` attribute alone.
   */
  protected validationSource(): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | undefined {
    const el = this.formAnchor();
    const native = el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;
    return native ? el : undefined;
  }

  // ── State sync ──

  /**
   * Push the current value and validity into the form. Call this after every value change, and once
   * after the first render.
   */
  protected syncFormState(): void {
    // Computed once and threaded through: `formValue()` is an overridable that may build a FormData or
    // walk a selection, and the validity pass needs the same answer. Calling it twice per sync was
    // wasteful and left room for the two calls to disagree.
    const value = this.formValue();
    this._internals.setFormValue(value);
    this._syncValidity(value);
    if (!this._initialCaptured) {
      this._initialCaptured = true;
      this._initialState = this.captureInitialState();
    }
  }

  /**
   * Snapshot the state that `form.reset()` should return to. Called once, at the first
   * {@link syncFormState}.
   *
   * Default: the `value` attribute — native-faithful, since a native control resets to its
   * markup-declared default and ignores script-assigned values. **Override whenever the control's state
   * does not live in that attribute**, or reset will feed the wrong thing back through the `value` setter:
   * a checkbox resets its *checkedness*, a multi-value control its list.
   *
   * Must round-trip with {@link restoreInitialState}.
   */
  protected captureInitialState(): unknown {
    return this.getAttribute('value');
  }

  /** Inverse of {@link captureInitialState}. */
  protected restoreInitialState(state: unknown): void {
    const initial = (state as string | null) ?? '';
    this.value = initial;
    if (initial) this.setAttribute('value', initial);
    else this.removeAttribute('value');
  }

  /**
   * Re-take the reset baseline from the control's current state.
   *
   * The baseline is captured at first sync, which is markup-declared state — right for a native control,
   * but a control populated **imperatively after mount** (`setOptions()` + `setSelected()`, `setTags()`)
   * has no markup to declare, so its baseline would be "empty". Call this once the control has been
   * populated if `form.reset()` should return to that populated state rather than to empty.
   */
  resetFormBaseline(): void {
    this._initialState = this.captureInitialState();
    this._initialCaptured = true;
  }

  private _syncValidity(value: string | File | FormData | null): void {
    const anchor = this.formAnchor();
    const error = this.getAttribute('error');
    // The app's verdict wins over the browser's: `b-form` / page validation set `error`, and a control
    // showing a message must not simultaneously report itself as valid to the form.
    if (error) {
      this._internals.setValidity({ customError: true }, error, anchor);
      return;
    }
    const src = this.validationSource();
    if (!src) {
      // No native primitive to borrow validity from (div-based combos, tag inputs, pickers whose inner
      // input shows a formatted display string rather than the value). `required` still has to mean
      // something, so enforce just that one rule here — the rest are type-specific and belong to the
      // browser, which cannot see these controls.
      if (this.supportsRequiredValidation && this.hasAttribute('required') && value === null) {
        this._internals.setValidity({ valueMissing: true }, this.requiredMessage(), anchor);
        return;
      }
      this._internals.setValidity({}, '', anchor);
      return;
    }
    // Mirror the inner control's own validity verbatim — `type`, `min`/`max`/`step`, `pattern` and
    // `required` are the browser's job, not ours. ValidityState is a live object, not a flags dict, so
    // it has to be copied field by field.
    const v = src.validity;
    this._internals.setValidity({
      badInput: v.badInput,
      customError: v.customError,
      patternMismatch: v.patternMismatch,
      rangeOverflow: v.rangeOverflow,
      rangeUnderflow: v.rangeUnderflow,
      stepMismatch: v.stepMismatch,
      tooLong: v.tooLong,
      tooShort: v.tooShort,
      typeMismatch: v.typeMismatch,
      valueMissing: v.valueMissing,
    }, src.validationMessage, anchor);
  }

  // ── Form lifecycle callbacks (called by the browser) ──

  /** `form.reset()` — restore the state captured at first sync. */
  formResetCallback(): void {
    this.restoreInitialState(this._initialState);
    this.syncFormState();
  }

  /**
   * `<fieldset disabled>` / ancestor-disabled propagation.
   *
   * Deliberately **not** reflected onto the host's own `disabled` attribute. An element's disabled state
   * is the union of its own attribute and its ancestors', so writing the attribute here makes the
   * element *self*-disabled: re-enabling the fieldset then leaves the computed state unchanged, this
   * callback never fires with `false`, and the control is stuck disabled forever. (Found exactly that
   * way — the "re-enabling propagates back" check failed.)
   *
   * Instead the flag is held separately and folded into {@link boolAttr}, so every component's existing
   * `this.boolAttr('disabled')` in `render()` honours it — inner `disabled`, `.disabled` classes and
   * styling all follow with no per-component work.
   */
  formDisabledCallback(disabled: boolean): void {
    if (this._formDisabled === disabled) return;
    this._formDisabled = disabled;
    this.update();
  }

  /**
   * `disabled` reads true when the host says so **or** an ancestor `<fieldset disabled>` does — see
   * {@link formDisabledCallback}. Every other attribute is unchanged.
   */
  protected boolAttr(name: string): boolean {
    if (name === 'disabled' && this._formDisabled) return true;
    return super.boolAttr(name);
  }

  /** True when disabled by the host's own attribute or by an ancestor fieldset. */
  get disabled(): boolean {
    return this._formDisabled || this.hasAttribute('disabled');
  }
}
