/**
 * The nearest ancestor that scrolls `el` — the box `position: sticky` sticks inside, and the region a
 * `scrollIntoView` will move. Returns `null` when nothing above `el` scrolls, i.e. the scroller is the
 * viewport itself.
 *
 * Walks the **flattened** tree, not the DOM tree, and that distinction is the whole point of this
 * helper. A page component is a light-DOM child of the app shell but RENDERS inside a `<slot>` in the
 * shell's shadow root, so the scrolling pane around it is not on its `parentNode` chain at all: a naive
 * `parentNode` walk sails straight past the pane and lands on `<html>`. Measured in Symbio's shell —
 * the pane it should find is `.app-content` (`overflow-y: auto`, viewport minus the header/ribbon);
 * the `parentNode` walk returned `documentElement` instead, a box a whole header taller that never
 * scrolls. Hence `assignedSlot ?? parentNode`, and a `ShadowRoot` hop to its host.
 *
 * "Scrolls" follows CSS: any computed `overflow-y` other than `visible` / `clip` establishes a scroll
 * container, so an `overflow: hidden` wrapper counts. It is where sticky positioning would be trapped
 * even though it shows no scrollbar, and treating it as transparent would measure against a region the
 * content can never reach.
 */
export function findScrollParent(el: Element): HTMLElement | null {
  let node: Node = el;
  for (;;) {
    const next: Node | null = (node as Element).assignedSlot ?? node.parentNode;
    if (!next) return null;
    if (next instanceof ShadowRoot) { node = next.host; continue; }
    if (!(next instanceof HTMLElement)) return null;   // reached the document
    const overflowY = getComputedStyle(next).overflowY;
    if (overflowY !== 'visible' && overflowY !== 'clip') return next;
    node = next;
  }
}

/**
 * The rectangle a reader can actually see `el` in: its scrolling pane, or the viewport when nothing
 * above it scrolls. Use this rather than `innerHeight` before deciding whether something is on screen —
 * inside an app shell the pane starts below a header and ends above a status bar, so viewport maths
 * counts pixels hidden behind the chrome as visible.
 */
export function visibleBounds(el: Element): { top: number; bottom: number } {
  const parent = findScrollParent(el);
  if (!parent || parent === document.documentElement || parent === document.body) {
    return { top: 0, bottom: window.innerHeight || document.documentElement.clientHeight };
  }
  const rect = parent.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom };
}
