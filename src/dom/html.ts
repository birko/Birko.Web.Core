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
