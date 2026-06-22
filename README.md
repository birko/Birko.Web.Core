# Birko.Web.Core

Lightweight Web Component framework. No dependencies, no virtual DOM, no build-time magic. Shadow DOM, reactive state, HTTP client, SSE, hash router, and unified i18n — everything needed to build a modern SPA.

## Packages

```
birko-web-core           # main (exports i18n singleton, t, useI18n, onI18nChange, BaseComponent.label)
birko-web-core/state     # Signal, Store, persistSet/Get/Remove (local), sessionSet/Get/Remove (session)
birko-web-core/http      # ApiClient, SseClient, unwrapList, apiErrorMessage, PagedResult
birko-web-core/router    # Router, link
birko-web-core/storage   # IndexedDbStore, CacheStore + low-level IDB helpers (openDatabase, idbRequest, …)
```

## Quick start

```typescript
import { BaseComponent, define } from 'birko-web-core';

export class MyWidget extends BaseComponent {
  private _count = 0;

  static get styles() {
    return `:host { display: block; } button { cursor: pointer; }`;
  }

  render() {
    return `
      <section>
        <p>Count: ${this._count}</p>
        <button id="inc">+1</button>
      </section>
    `;
  }

  protected onMount() {
    this.$('#inc')?.addEventListener('click', () => {
      this._count++;
      this.update();
    });
  }
}

define('my-widget', MyWidget);
```

```html
<my-widget></my-widget>
```

---

## BaseComponent

```typescript
class BaseComponent extends HTMLElement
```

### Lifecycle

| Method | When | Use for |
|--------|------|---------|
| `onMount()` | After first render | Setup: fetch data, subscribe to stores, attach global listeners |
| `onUpdated()` | After every `update()` | Re-bind event listeners (DOM is replaced on re-render) |
| `onUnmount()` | On disconnect | Teardown: unsubscribe, disconnect observers, remove global listeners |

### Rendering

```typescript
abstract render(): string       // return HTML string
protected update(): void        // re-render + call onUpdated()
```

### Querying

```typescript
protected $<T>(selector: string): T | null                     // querySelector inside shadow root
protected $$<T>(selector: string): T[]                         // querySelectorAll inside shadow root
protected child<T extends BaseComponent>(selector: string): T | null  // typed child component access
```

`child<T>()` provides typed access to child web components — use it instead of `this.$() as any`:

```typescript
// ❌ untyped — no autocomplete, error-prone
const table = this.$('#table') as any;
table?.setColumns([...]);

// ✅ typed — autocomplete, compile-time safety
const table = this.child<BTable>('#table');
table?.setColumns([...]);

const form = this.child<BForm>('#form');
const { valid, data } = form?.validate() ?? { valid: false, data: {} };

const modal = this.child<BModal>('#modal');
modal?.open();
```

### Events

```typescript
protected emit<T>(name: string, detail?: T): void  // CustomEvent (bubbles, composed)
```

### Attributes

```typescript
protected attr(name: string, fallback = ''): string
protected boolAttr(name: string): boolean
protected numAttr(name: string, fallback = 0): number
static get observedAttributes(): string[]   // triggers re-render on change
```

### Styles

```typescript
static get styles(): string                   // component CSS string
static get sharedStyles(): CSSStyleSheet[]    // pre-parsed shared sheets (from Birko.Web.Components)
```

### Helper

```typescript
function define(tag: string, ctor: CustomElementConstructor): void
// Registers only if not already defined — safe to call multiple times
```

### `label()` — i18n-aware string resolution

`BaseComponent` exposes a single helper for every user-facing string in a component template. Resolution order is **explicit attribute > global i18n key > English fallback**, so per-instance overrides keep working while every component automatically picks up app-wide locale changes.

```typescript
class BPagination extends BaseComponent {
  render() {
    return `
      <button aria-label="${this.label('label-prev', 'bwc.pagination.prev', 'Previous page')}">‹</button>
      <button aria-label="${this.label('label-next', 'bwc.pagination.next', 'Next page')}">›</button>
    `;
  }
}
```

```html
<!-- App-wide locale: shows whatever 'bwc.pagination.prev' resolves to -->
<b-pagination></b-pagination>

<!-- Per-instance override (wins over global i18n): -->
<b-pagination label-prev="Späť" label-next="Ďalej"></b-pagination>
```

```typescript
protected label(
  attrName: string,
  i18nKey: string,
  fallback: string,
  params?: Record<string, string>,
): string
```

`BaseComponent` auto-subscribes to `onI18nChange` and re-renders affected instances when the global locale changes — no per-component plumbing.

---

## Internationalization

A single global `I18n` singleton drives every `BaseComponent.label()` call across `birko-web-core`, `birko-web-components`, and `birko-web-shell`. Swap the singleton at app bootstrap, load locale bundles, and every subscribed component re-renders automatically.

```typescript
import { i18n, t, useI18n, onI18nChange, I18n } from 'birko-web-core';

// 1. Quick: use the default instance and load bundles into it
await i18n.loadBundle('en', enBundle);
await i18n.loadBundle('sk', skBundle);
i18n.setLocale('sk');

// 2. Or replace it with an app-owned instance (subscribers auto re-wire)
const myI18n = new I18n('sk');
await myI18n.loadBundle('sk', skBundle);
useI18n(myI18n);

// Render-side
const label = t('bwc.common.close');             // 'Zavrieť'
const greeting = t('bws.hello', { name: 'Alice' }, 'Hello {name}');  // interpolation + fallback

// Subscribe outside a component (rarely needed)
const unsub = onI18nChange(() => console.log('locale changed'));
unsub();
```

**API surface:**

| Export | Purpose |
|--------|---------|
| `i18n` | The default `I18n` instance — preloaded with English fallback. |
| `t(key, params?, fallback?)` | Resolve against the current singleton; interpolates `{param}` placeholders. |
| `useI18n(instance)` | Replace the active singleton with an app-owned one. All subscribers auto re-wire. |
| `onI18nChange(fn)` | Subscribe to locale or singleton changes (auto-called from `BaseComponent`). |
| `I18n` | Class — instantiate to own a separate i18n scope (tests, isolated micro-apps). |
| `createFormatter(locale)` / `getFormatter(locale)` | Cached `Intl.NumberFormat` / `Intl.DateTimeFormat` factories. |

**Key namespaces in the ecosystem:**

- `bwc.*` — Birko.Web.Components (shipped at `birko-web-components/locales/en.json`)
- `bws.*` — Birko.Web.Shell (e.g. `bws.common.new`, `bws.pagination.items`); `t()` from the shell auto-interpolates `{entity}` with the page's `entityLabel`
- `common.*` — `BForm` validation messages (`common.required`, `common.minLength`)

---

## State

### Signal\<T\>

Reactive value holder.

```typescript
import { signal, computed } from 'birko-web-core/state';

const count = signal(0);

count.subscribe(v => console.log('value:', v));   // immediate emit
count.onChange(v => console.log('changed:', v));  // only on change

count.value = 5;
count.update(n => n + 1);

const double = computed(() => count.value * 2, [count]);
```

### localStorage helpers

```typescript
import { persistSet, persistGet, persistRemove } from 'birko-web-core/state';

// Store any JSON-serializable value:
persistSet('app.theme', 'dark');
persistSet('app.filters', { status: 'active', page: 1 });

// Retrieve (typed), returns null if missing or parse fails:
const theme = persistGet<string>('app.theme');
const filters = persistGet<{ status: string; page: number }>('app.filters');

// Remove:
persistRemove('app.theme');
```

Use these instead of `localStorage.getItem/setItem` directly — they handle `JSON.stringify/parse` and swallow parse errors gracefully.

### sessionStorage helpers

Same API, backed by `sessionStorage` (per-tab, cleared when the tab closes) — for transient state that shouldn't outlive the session, like a multi-step wizard's progress:

```typescript
import { sessionSet, sessionGet, sessionRemove } from 'birko-web-core/state';

sessionSet('wizard.step', 2);
const step = sessionGet<number>('wizard.step') ?? 0;
sessionRemove('wizard.step');
```

Reactive persistence (`Signal({ persist })` / `Store({ persist })`) is localStorage-backed; for reactive session-scoped state, read/write these helpers yourself.

### Store\<T\>

Key-value store where every key is a Signal.

```typescript
import { Store } from 'birko-web-core/state';

interface AppState {
  user: User | null;
  theme: 'light' | 'dark';
}

const appStore = new Store<AppState>({ user: null, theme: 'light' });

appStore.set('theme', 'dark');
const theme = appStore.get('theme');

const unsub = appStore.onChange('user', user => { /* ... */ });
// Call unsub() in onUnmount()
```

---

## Storage (IndexedDB + Cache API)

### IndexedDbStore

For keyed collections too large or too structured for `localStorage` — cached
read data, large app state, anything you'd scan or query — use `IndexedDbStore`.
It's a generic, promisified wrapper over a single IndexedDB object store with
zero dependencies. (For small flags / preferences, stick with
`Signal({ persist })` or `persistSet`/`persistGet` — IndexedDB is overkill there.)

```typescript
import { IndexedDbStore } from 'birko-web-core/storage';

interface Product { id: string; name: string; price: number; }

const products = new IndexedDbStore<Product>({
  storeName: 'products',         // db defaults to `birko_products`
  keyPath: 'id',                 // in-line key; omit for out-of-line keys passed to set()
  indexes: [{ name: 'price', keyPath: 'price' }],
});

await products.set({ id: 'p1', name: 'Widget', price: 9.99 });
await products.setMany([{ value: a }, { value: b }]);   // one transaction

const p = await products.get('p1');
const all = await products.getAll();
const cheap = await products.getAllByIndex('price', IDBKeyRange.upperBound(10));
const n = await products.count();

await products.update('p1', cur => cur ? { ...cur, price: 8.99 } : undefined); // atomic RMW
await products.delete('p1');

// Reactive: size signal + change notifications
console.log(products.size);
const unsub = products.onChange(({ type, key }) => { /* 'set' | 'delete' | 'clear' */ });
```

**Model:** one `IndexedDbStore` = one database with one object store. Each
logical store gets its own database by default (`birko_${storeName}`), which
sidesteps the multi-store version gotcha. Pass an explicit `dbName` only when
you deliberately want several object stores sharing one database.

**Out-of-line keys:** omit `keyPath` and pass the key explicitly —
`store.set(value, key)`. With `autoIncrement: true` the key is generated.

**Scanning large stores:** `forEach((value, key) => …)` walks a cursor without
loading everything into memory. The callback is synchronous (the read
transaction auto-commits between microtasks) — collect keys in it, act after.

**Escape hatch / lifecycle:** `transaction(mode, store => …)` for operations
not covered above; `close()` releases the connection (reopens lazily);
`destroy()` deletes the whole database.

Low-level helpers (`openDatabase`, `idbRequest`, `txComplete`, `deleteDatabase`)
are exported too — the same promisified IDB primitives the offline `ActionQueue`
is built on, for hand-rolling a custom store.

### CacheStore (Cache API)

For caching HTTP responses and assets — `Request`/`Response` pairs — use
`CacheStore`, a wrapper over the Cache API. Its headline feature is a cache-first
`fetch` with a freshness window; it also exposes the raw cache ops and JSON
convenience methods. Requires a secure context (https / localhost).

```typescript
import { CacheStore } from 'birko-web-core/storage';

const cache = new CacheStore('api-v1');

// Cache-first fetch — serve from cache if younger than 5 min, else network (and re-cache):
const res = await cache.fetch('/api/config', { maxAgeMs: 5 * 60_000 });
const config = await res.json();
await cache.fetch('/api/config', { forceRefresh: true }); // bypass cache, still re-cache

// Store / read a value as JSON directly:
await cache.putJson('/api/profile', { name: 'Alice' });
const profile = await cache.matchJson<{ name: string }>('/api/profile');

// Raw ops + lifecycle:
await cache.add('/assets/logo.svg');                 // fetch + store
await cache.addAll(['/a.js', '/b.css']);
const hit = await cache.has('/api/config');
await cache.delete('/api/config');
await cache.clear();                                  // empty the cache
await cache.destroy();                                // delete the named cache
if (!CacheStore.isSupported()) { /* fall back to network-only */ }
```

`Cache.put` only accepts GET requests, so `fetch()` skips caching non-GET
responses. Use distinct cache names (`api-v1`, `assets`) and bump the suffix to
invalidate a whole generation at once.

---

## ApiClient

```typescript
import { ApiClient } from 'birko-web-core/http';

const api = new ApiClient({
  baseUrl: '/api',
  getToken: () => localStorage.getItem('token'),
  getTenant: () => localStorage.getItem('tenantId'),
  onUnauthorized: () => { window.location.hash = '#/login'; },
});

const resp = await api.get<User[]>('users', { role: 'admin' });
if (resp.ok) {
  console.log(resp.data);  // User[]
}

const created = await api.post<User>('users', { name: 'Alice' }, {
  moduleId: 'users',
  description: 'Create user Alice',   // shown in offline queue UI
});
```

**ApiResponse\<T\>:**

| Field | Type | Description |
|-------|------|-------------|
| `ok` | `boolean` | HTTP 2xx |
| `status` | `number` | HTTP status code |
| `data` | `T` | Parsed JSON or null |
| `headers` | `Headers` | Response headers |
| `queued` | `boolean?` | Action was queued (offline) |
| `fromCache` | `boolean?` | Service worker cache hit |

### HTTP utilities

```typescript
import { unwrapList, apiErrorMessage, type PagedResult } from 'birko-web-core/http';
```

**PagedResult\<T\>** — the standard server envelope returned by paginated endpoints:

```typescript
interface PagedResult<T> {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
}
```

**unwrapList\<T\>** — extract an item array from any API response shape without boilerplate:

```typescript
// Handles: { items: T[] }, { data: T[] }, { [dataKey]: T[] }, or raw T[]
const items = unwrapList<Device>(response);

// Custom key (e.g. response.devices):
const items = unwrapList<Device>(response, 'devices');
```

Returns `[]` when the response is not ok or has no matching data.

**apiErrorMessage** — extract a human-readable error from ASP.NET ProblemDetails or ModelState responses:

```typescript
// Returns the first validation message, detail, or title it finds:
const msg = apiErrorMessage(resp.data);

// With custom fallback:
const msg = apiErrorMessage(resp.data, 'Could not save device');
```

Handles `{ errors: { field: ['msg'] } }`, `{ detail: '...' }`, `{ title: '...' }`, and plain strings.

---

## SseClient

```typescript
import { SseClient } from 'birko-web-core/http';

const sse = new SseClient({
  url: '/api/events/stream',
  getToken: () => localStorage.getItem('token'),
  reconnectMs: 5000,
});

sse.connect();

const unsub = sse.on('device-update', (data: unknown) => {
  console.log(data);
});

// In onUnmount:
unsub();
sse.disconnect();
```

Token is appended as `?token=...` query param (SSE cannot send headers).

---

## Router

```typescript
import { Router, link } from 'birko-web-core/router';

const router = new Router([
  { path: '/',         component: () => new HomePage() },
  { path: '/login',    component: () => new LoginPage() },
  { path: '/devices',  component: () => new DevicesPage(), guard: () => !!getToken() || '/login' },
  { path: '/devices/:id', component: () => new DeviceDetailPage() },
], '#outlet');

router.onNavigate(match => {
  if (match) console.log('params:', match.params);  // { id: '...' }
});

router.navigate('/devices/123');

// In templates:
link('/devices', 'All Devices', 'nav-link');
// → <a href="#/devices" class="nav-link">All Devices</a>
```

**Route:**

```typescript
interface Route {
  path: string;
  component: () => HTMLElement | Promise<HTMLElement>;
  guard?: () => boolean | string;   // true = allow, string = redirect path
  children?: Route[];
}
```
