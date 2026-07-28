/**
 * Text folding for **user-facing search boxes** — the filter behind a searchable select, a picker, a palette.
 *
 * A plain `haystack.toLowerCase().includes(needle.toLowerCase())` is accent-blind in the wrong direction: it
 * matches only when the typed accents are identical to the stored ones. In practice nobody types diacritics
 * into a search field in a hurry — least of all on a phone keyboard — so `pritahy` must find `Príťahy` and
 * `muller` must find `Müller`. Folding both sides makes the match insensitive to accents *and* case.
 *
 * NFD splits an accented letter into its base letter plus a combining mark, and `\p{Diacritic}` then removes
 * the marks. This is deliberately a *search* fold, not a general transliteration: it does not touch letters
 * that are their own character rather than an accented base (German ß, Nordic ø, Polish ł), because those are
 * distinct letters whose users type them directly.
 */

/** Case- and accent-insensitive search key for a string. */
export function foldForSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/**
 * Whether `needle` occurs in `haystack`, ignoring case and accents. An empty needle matches everything, so a
 * caller can pass the raw filter box value without special-casing "nothing typed yet".
 */
export function matchesSearch(haystack: string, needle: string): boolean {
  const query = foldForSearch(needle).trim();
  return query === '' || foldForSearch(haystack).includes(query);
}
