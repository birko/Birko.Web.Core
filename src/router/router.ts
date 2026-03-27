/**
 * Simple hash-based SPA router.
 * Supports nested routes, route params, guards, and lazy loading.
 */
export interface Route {
  path: string;
  component: () => HTMLElement | Promise<HTMLElement>;
  guard?: () => boolean | string; // Return true to allow, string to redirect
  children?: Route[];
}

export interface RouteMatch {
  route: Route;
  params: Record<string, string>;
  path: string;
}

export class Router {
  private _routes: Route[] = [];
  private _outlet: HTMLElement | null = null;
  private _currentMatch: RouteMatch | null = null;
  private _onNavigate: ((match: RouteMatch | null) => void) | null = null;

  constructor(routes: Route[], outlet: HTMLElement | string) {
    this._routes = routes;
    this._outlet = typeof outlet === 'string'
      ? document.querySelector(outlet)
      : outlet;

    window.addEventListener('hashchange', () => this._resolve());
  }

  /** Programmatic navigation. */
  navigate(path: string): void {
    window.location.hash = '#' + path;
  }

  /** Get the current route match. */
  get current(): RouteMatch | null {
    return this._currentMatch;
  }

  /** Set callback for route changes. */
  onNavigate(fn: (match: RouteMatch | null) => void): void {
    this._onNavigate = fn;
  }

  /** Replace the route table and re-resolve the current hash. */
  setRoutes(routes: Route[]): void {
    this._routes = routes;
  }

  /** Force resolve the current hash. */
  resolve(): void {
    this._resolve();
  }

  private async _resolve(): Promise<void> {
    const raw = window.location.hash.slice(1) || '/';
    const qIdx = raw.indexOf('?');
    const hash = qIdx === -1 ? raw : raw.slice(0, qIdx);
    const match = this._match(hash, this._routes);

    if (!match) {
      this._currentMatch = null;
      this._onNavigate?.(null);
      if (this._outlet) this._outlet.innerHTML = '<slot name="not-found">Page not found</slot>';
      return;
    }

    // Guard check
    if (match.route.guard) {
      const result = match.route.guard();
      if (result !== true) {
        const redirect = typeof result === 'string' ? result : '/';
        this.navigate(redirect);
        return;
      }
    }

    this._currentMatch = match;
    this._onNavigate?.(match);

    if (this._outlet) {
      const el = await match.route.component();
      // Skip DOM replacement if the component is already mounted in the outlet
      // (e.g. a persistent shell that only swaps its children internally)
      if (el.parentNode !== this._outlet) {
        this._outlet.innerHTML = '';
        this._outlet.appendChild(el);
      }
    }
  }

  private _match(path: string, routes: Route[]): RouteMatch | null {
    let wildcard: Route | null = null;

    for (const route of routes) {
      // Wildcard catch-all — remember but keep looking for exact match
      if (route.path === '*') {
        wildcard = route;
        continue;
      }

      const params: Record<string, string> = {};
      const routeParts = route.path.split('/').filter(Boolean);
      const pathParts = path.split('/').filter(Boolean);

      // Check children first for nested routes
      if (route.children && path.startsWith(route.path.replace(/\/$/, ''))) {
        const childPath = '/' + pathParts.slice(routeParts.length).join('/');
        const childMatch = this._match(childPath, route.children);
        if (childMatch) return childMatch;
      }

      if (routeParts.length !== pathParts.length) continue;

      let matched = true;
      for (let i = 0; i < routeParts.length; i++) {
        if (routeParts[i].startsWith(':')) {
          params[routeParts[i].slice(1)] = pathParts[i];
        } else if (routeParts[i] !== pathParts[i]) {
          matched = false;
          break;
        }
      }

      if (matched) {
        return { route, params, path };
      }
    }

    // No exact match — fall back to wildcard if present
    if (wildcard) {
      return { route: wildcard, params: {}, path };
    }

    return null;
  }
}

/** Helper to create a link that navigates via hash. */
export function link(path: string, text: string, className?: string): string {
  return `<a href="#${path}"${className ? ` class="${className}"` : ''}>${text}</a>`;
}
