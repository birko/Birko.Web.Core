export interface RegisterServiceWorkerOptions {
  /** Registration scope (defaults to the SW script's directory). */
  scope?: string;
}

/**
 * Registers a service worker, best-effort: resolves to the registration on success, or `null` when
 * service workers are unsupported / the context is insecure / registration fails (so callers never
 * have to guard). Pair with a SW emitted by `birko-web-core/pwa/build-sw.mjs`.
 */
export async function registerServiceWorker(
  url = '/sw.js',
  options: RegisterServiceWorkerOptions = {},
): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(url, options.scope ? { scope: options.scope } : undefined);
  } catch {
    return null;
  }
}
