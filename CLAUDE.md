# Birko.Web.Core — AI Instructions

## What this project is

Minimal Web Component framework — Shadow DOM base class, reactive state (Signal/Store), fetch-based HTTP client, SSE client, and hash router. No dependencies. Used by `Birko.Web.Components` and all Symbio UI pages.

## Directory structure

```
src/
├── base/
│   └── base-component.ts   # BaseComponent + define()
├── state/
│   ├── signal.ts            # Signal<T>, computed(), signal()
│   └── store.ts             # Store<T>
├── http/
│   ├── api-client.ts        # ApiClient, ApiResponse<T>
│   └── event-source.ts      # SseClient
├── i18n/
│   ├── i18n.ts              # I18n class (locale switching, JSON bundles, plurals)
│   ├── fmt.ts               # createFormatter — date/time/number/currency
│   └── global.ts            # Global singleton: i18n, t(), useI18n(), onI18nChange()
├── storage/
│   ├── idb.ts               # Low-level promisified IndexedDB helpers (openDatabase, idbRequest, txComplete, deleteDatabase)
│   ├── idb-store.ts         # IndexedDbStore<T> — generic object store
│   └── cache-store.ts       # CacheStore — Cache API wrapper (cache-first fetch, JSON put/get)
├── offline/
│   ├── action-queue.ts      # ActionQueue — offline mutation queue (built on storage/idb)
│   └── sync-manager.ts      # SyncManager — drains the queue when back online
└── router/
    └── router.ts            # Router, Route, link()
```

## Key rules

### BaseComponent lifecycle order
```
connectedCallback → _applyStyles → render → onMount
update()          →              → render → onUpdated
disconnectedCallback             →          onUnmount
```

- `render()` returns a raw HTML string — NOT virtual DOM, NOT JSX
- `onMount()` — one-time setup (event listeners, async fetch, subscriptions)
- `onUpdated()` — re-bind after every `update()` call (listeners detach on re-render)
- `onUnmount()` — teardown subscriptions, observers, global listeners

### Rendering rules
- Never manipulate `shadowRoot.innerHTML` directly — call `this.update()` instead
- Never use `document.querySelector` — use `this.$('#id')` (queries inside Shadow DOM)
- Escape user data in templates: `str.replace(/&/g,'&amp;').replace(/</g,'&lt;')`
- Use `aria-hidden="true"` on decorative elements (icons, dots)
- Use semantic HTML: `<header>`, `<footer>`, `<section>`, `<article>`, `<time>`, `<p>` — not `<div>` for everything

### Styles rules
- `static get styles()` — component-specific CSS as a string
- `static get sharedStyles()` — array of pre-parsed `CSSStyleSheet` objects from Birko.Web.Components
- All values via `--b-*` CSS custom properties — never hardcode `#hex`, `px`, or `rem` literals
- `BaseComponent._applyStyles()` sets `shadowRoot.adoptedStyleSheets`; styles load in order: shared → component (component wins)

### State rules
- `Signal<T>` — single reactive value; `subscribe()` for immediate emit, `onChange()` without
- `Store<T>` — key-value where every key is a Signal; `store.on('key', fn)` / `store.onChange('key', fn)`
- Always call `unsub()` in `onUnmount()` — memory leaks if skipped
- `computed(fn, deps)` — derived Signal, auto-updates when deps change

### HTTP rules
- `ApiClient` adds `Authorization: Bearer` and `X-Tenant-Id` headers automatically
- All methods return `ApiResponse<T>` — always check `resp.ok` before using `resp.data`
- If `meta` is provided and the device is offline, the request is queued via `onQueueAction`
- Never throw from a response handler — API errors are in `resp.data?.error?.message`

### Router rules
- Hash-based (`#/path`): `window.location.hash = '#/path'` to navigate
- `guard?: () => boolean | string` — return `true` to allow, return a path string to redirect
- `:param` segments extracted to `match.params`
- `router.onNavigate()` fires on every route change — clean up on `onUnmount()`

### i18n rules
- A blank `I18n` instance is created at module load — components pick it up via `t(key, params?, fallback?)`
- Apps that own their own `I18n` instance swap it in with `useI18n(instance)` once at bootstrap
- `t(key)` returns the key itself when missing (standard i18n convention); pass `fallback` to get an English string back instead
- `BaseComponent` subscribes to `onI18nChange` at module load → all mounted components re-render on `setLocale()`
- Components emit user-facing text via `this.label(attrName, i18nKey, fallback, params?)` — explicit attribute wins > global i18n > English fallback

### SseClient rules
- Token is appended as a query param (SSE cannot send headers)
- Subscribe per event type: `const unsub = sse.on('device-update', handler)`
- Call `sse.disconnect()` in `onUnmount()`

### Storage rules
- Pick the backend by data shape: small flags/preferences → `localStorage` (`persistSet`/`persistGet`, `Signal({ persist })`); transient per-tab state → `sessionStorage` (`sessionSet`/`sessionGet`); keyed structured collections → `IndexedDbStore`; HTTP responses / assets → `CacheStore` (Cache API)
- `persist.ts` exposes both Web Storage backends through one shared internal (`writeTo`/`readFrom`/`removeFrom` over a `Storage` getter) — add a backend there, don't copy the JSON-safe try/catch a third time. Reactive persistence (`Signal`/`Store` `persist`) is localStorage-only by design
- One `IndexedDbStore` = one database with one object store; the db name defaults to `birko_${storeName}` so distinct stores never collide on version. Only pass an explicit `dbName` to deliberately co-locate object stores
- Create object stores / indexes **only** inside the `versionchange` transaction (the `openDatabase` upgrade callback) — never afterwards; bump `version` to add an index
- All IndexedDB code goes through `storage/idb.ts` (`openDatabase`, `idbRequest`, `txComplete`, `deleteDatabase`) — do not re-promisify the raw API per consumer (`ActionQueue` reuses these)
- `forEach` cursor callbacks are synchronous — the read transaction auto-commits between microtasks, so collect keys inside and do async work after
- `CacheStore` needs a secure context — guard optional caching with `CacheStore.isSupported()`; `Cache.put` is GET-only, so `fetch()` skips non-GET responses. Use generation-suffixed cache names (`api-v1`) to invalidate in bulk

## Adding a new module

1. Create `src/{module}/{name}.ts` — no barrel re-export needed, each consumer imports directly
2. Export from `src/{module}/index.ts`
3. Re-export from `src/index.ts`

## Modern HTML & JavaScript

### Use native modern HTML elements

Do not default to `<div>` and `<span>`. Use the element that matches the content:

| Element | Use for |
|---------|---------|
| `<header>` | Title row of a component or page section |
| `<footer>` | Action row / bottom bar of a component, `slot="footer"` content |
| `<main>` | Primary content area (once per page, in app-shell) |
| `<section>` | Named content region — always add `aria-label` |
| `<article>` | Self-contained item (notification row, feed card, list item) |
| `<nav>` | Navigation container |
| `<aside>` | Secondary content (sidebars, supplemental panels) |
| `<dialog>` | Modal / confirmation dialogs |
| `<p>` | Text paragraphs — add `margin: 0` in CSS to override browser default |
| `<h2>`–`<h6>` | Headings inside components — add `margin: 0` in CSS |
| `<time datetime="ISO">` | All dates and timestamps |
| `<output>` | Live values (counters, metric readings, calculation results) |
| `<kbd>` | Keyboard shortcut display |
| `<picture>` | Responsive images (multiple sources / densities) |
| `<figure>` + `<figcaption>` | Charts, diagrams, screenshots with captions |
| `<details>` + `<summary>` | Expand/collapse sections (instead of custom accordion divs) |
| `<mark>` | Highlighted text (search matches) |
| `<meter>` | Scalar gauge (battery, storage fill) |
| `<progress>` | Task completion |

**Margin reset rule:** switching from `<div>` to `<p>`, `<h*>`, or `<ul>` introduces browser-default margins. Always add `margin: 0` (or the correct override) to those selectors in the component's CSS.

**Decorative elements:** add `aria-hidden="true"` to icons, dots, and visual-only decorations.

### Use modern JavaScript — no polyfills or legacy patterns

| Pattern | Use |
|---------|-----|
| Optional chaining | `obj?.prop?.value` instead of `obj && obj.prop && obj.prop.value` |
| Nullish coalescing | `value ?? 'default'` instead of `value !== null && value !== undefined ? value : 'default'` |
| Logical assignment | `x ??= 'default'`, `x ||= fallback`, `x &&= transform(x)` |
| Destructuring | `const { ok, data } = resp` |
| Array methods | `items.at(-1)`, `items.flatMap()`, `items.findLast()`, `Object.fromEntries()` |
| Async/await | Always over `.then()` chains |
| `structuredClone()` | Deep clone instead of `JSON.parse(JSON.stringify(...))` |
| `AbortController` | Cancel fetch requests (pass `signal` to fetch) |
| `queueMicrotask()` | Defer work within the current task without `setTimeout(fn, 0)` |
| `globalThis` | Instead of `window` or `self` for cross-context code |
| Class fields | `private _state = {}` instead of constructor assignments |
| `#privateField` | Private class fields when encapsulation matters more than reflection |
| `crypto.randomUUID()` | Generate IDs instead of custom UUID functions |
| Template literals | Always over string concatenation |

**Avoid:**
- `var` — use `const` / `let`
- `arguments` — use rest params `...args`
- `function` declarations inside methods — use arrow functions
- Manual deep clone — use `structuredClone()`
- `new Promise(resolve => setTimeout(resolve, 0))` — use `queueMicrotask()`
- `for...in` on arrays — use `for...of` or array methods
- `===` / `!==` comparisons to `null` AND `undefined` separately — use `?? null` checks

## What NOT to do

- Do not add external dependencies — this project has none by design
- Do not use `document.` APIs — always scope to `shadowRoot` / `this.$`
- Do not store DOM references across renders — DOM is rebuilt on every `update()`
- Do not call `update()` in a loop — batching is the consumer's responsibility
- Do not use `innerHTML` on the shadow root — use `render()` return value
