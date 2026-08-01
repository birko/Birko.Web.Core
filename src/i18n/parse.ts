/**
 * Locale-tolerant parsing of user-typed numbers.
 *
 * The inverse of {@link createFormatter}, and here for the same reason: locales disagree. A Slovak (or
 * Czech, German, French, Spanish…) keyboard puts a **comma** on the decimal keypad, and neither of the
 * obvious ways of reading that back works:
 *
 * - `<input type="number">` implements the HTML "valid floating-point number" grammar, which accepts only
 *   `.`. WebKit therefore **refuses to insert the comma at all** — typing `81,8` leaves the field holding
 *   `818`, which then parses perfectly and stores a hundredfold-wrong value with no error anywhere. That
 *   shipped as an 81.8 kg weigh-in recorded as 818 kg.
 * - `parseFloat('81,8')` returns **81**: it stops at the first character it cannot read instead of
 *   failing. Silent truncation — the same class of bug, one digit quieter.
 *
 * So a comma-locale decimal field must be `type="text" inputmode="decimal"` (text accepts the separator,
 * inputmode still summons the numeric keypad) and every read of it must come through {@link parseDecimal}.
 * `b-input type="decimal"` packages exactly that; this function is the half a hand-rolled control needs,
 * since a page cannot always use a shadow-DOM component.
 */

/**
 * Parses a user-typed decimal, accepting **either** `,` or `.` as the separator.
 *
 * Returns `null` for anything unusable as a number — **including a blank string**, so a caller that must
 * distinguish "left blank" from "typed nonsense" has to check for empty first.
 *
 * Deliberately stricter than `parseFloat`: trailing junk (`12abc`), two separators (`1.2.3`) and a lone
 * separator all yield `null` rather than a plausible-looking wrong number. A wrong number that looks right
 * is worse than a refusal, because nothing downstream can tell it was wrong.
 *
 * Note it does **not** accept group separators (`1 234,5`), because they are ambiguous against the decimal
 * separator across locales — `1.234` is one thousand two hundred thirty four in German and one-point-two-
 * three-four in English. Refusing is the honest answer; a caller that needs grouped input should strip it
 * with knowledge of its own locale first.
 */
export function parseDecimal(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  // One separator at most; normalise it to the '.' that Number() understands.
  if ((trimmed.match(/[.,]/g) ?? []).length > 1) return null;
  const normalised = trimmed.replace(',', '.');

  // Number() rejects trailing junk where parseFloat would silently accept a prefix. A bare '.' or '-'
  // becomes NaN here, and Number('') is 0 — which is why the blank case is handled above.
  const n = Number(normalised);
  return Number.isFinite(n) ? n : null;
}
