/**
 * Coerce a value into a valid CSS length.
 *
 * A bare number — whether numeric (`160`) or a unitless string (`"160"`) — has `unit`
 * appended, producing `"160px"`. Without this, interpolating a unitless value into an
 * inline style (`style="height:160"`) yields an invalid declaration the browser silently
 * drops, leaving the element with no resolved size — which makes a `height:100%`/`width:100%`
 * child stretch unboundedly in a flex/grid parent.
 *
 * Anything already carrying a unit (`"20rem"`, `"50%"`, `"300px"`), a keyword (`"auto"`,
 * `"inherit"`), or a `var()`/`calc()` expression is returned unchanged. `null`/`undefined`
 * become `''`.
 *
 * @param value the raw length (attribute string, number, or nullish)
 * @param unit  the unit to append to a bare number (default `px`)
 */
export function coerceCssLength(value: string | number | null | undefined, unit = 'px'): string {
  if (value == null) return '';
  const raw = String(value).trim();
  return /^\d+(\.\d+)?$/.test(raw) ? `${raw}${unit}` : raw;
}
