# Birko.Web.Core

Lightweight Web Component framework. No dependencies, no virtual DOM, no build-time magic. Shadow DOM, reactive state, HTTP client, SSE, and hash router — everything needed to build a modern SPA.

## Packages

```
birko-web-core           # main
birko-web-core/state     # Signal, Store
birko-web-core/http      # ApiClient, SseClient
birko-web-core/router    # Router, link
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
