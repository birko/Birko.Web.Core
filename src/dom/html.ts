/**
 * Escape a string for safe interpolation into HTML — an attribute value or a text node. Components that
 * build markup with template strings (the common `render()` / `renderContent()` pattern) must escape any
 * value that can carry user input, or a name like `A & B` / `<b>x</b>` breaks layout or injects markup.
 *
 * Escapes the five characters that are unsafe in element text and double-quoted attributes. It is NOT a
 * substitute for a full sanitizer when inserting rich/third-party HTML — use it on plain values only.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Schemes a link may use. An **allow-list**, deliberately — a `javascript:` blocklist loses to encoding and
 * whitespace tricks (`java\tscript:`, `JaVaScRiPt:`, `&#106;avascript:`), because the browser normalises the
 * URL after your check has run.
 */
const SAFE_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];

/**
 * Validate a URL for use in an `href`/`src` attribute, returning a safe value or `null`.
 *
 * <p>Accepts relative URLs (`/x`, `./x`, `#x`, `?x=1`) and absolute URLs on {@link SAFE_SCHEMES}. Rejects
 * everything else — notably `javascript:`, `data:` and `vbscript:`, each of which executes script when a
 * user clicks a link built from untrusted input.</p>
 *
 * <p>Escaping alone does **not** make a URL safe: `escapeHtml('javascript:alert(1)')` is unchanged, because
 * none of its characters need escaping. Attribute escaping stops a caller breaking *out* of the attribute;
 * this stops the value inside it being executable. Rendering user-authored links needs both.</p>
 *
 * @returns the URL when safe, otherwise `null` — render a non-link (plain text) rather than substituting
 *          something like `#`, so a rejected link is visible rather than silently inert.
 */
export function safeHref(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  // Relative forms carry no scheme and cannot execute.
  if (/^[/#?]/.test(trimmed) || /^\.{1,2}\//.test(trimmed)) return trimmed;

  // Strip control characters and whitespace before testing: browsers ignore them inside a scheme, so
  // "java\tscript:x" and "\njavascript:x" both execute while naively failing a plain string comparison.
  const collapsed = Array.from(trimmed).filter((c) => c.charCodeAt(0) > 0x20).join('').toLowerCase();

  // No colon before the first '/', '?' or '#' → no scheme → treat as relative.
  const colon = collapsed.indexOf(':');
  if (colon < 0) return trimmed;
  const firstDelimiter = collapsed.search(/[/?#]/);
  if (firstDelimiter >= 0 && firstDelimiter < colon) return trimmed;

  return SAFE_SCHEMES.includes(collapsed.slice(0, colon + 1)) ? trimmed : null;
}
