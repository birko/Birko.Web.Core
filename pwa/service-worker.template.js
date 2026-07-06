/*
 * Birko.Web PWA service-worker template.
 *
 * Stamped at build time by `writeServiceWorker()` (pwa/build-sw.mjs): the cache prefix, a content
 * hash of the whole shell (so the cache name changes exactly when something it caches changes → the
 * browser sees a new worker and `activate` prunes old caches), and the precache list are injected
 * into the placeholders below.
 *
 * Behaviour: shell-first for navigations (cache-first, instant offline boot), cache-first for static
 * assets, and it deliberately NEVER touches `/api/*` — those fall through to the network so an
 * offline write queue (Birko `ActionQueue`) owns offline writes. Caching API responses here would
 * defeat that. Only GET, same-origin, non-API requests are handled.
 */

const CACHE_VERSION = '__BUILD_HASH__';
const CACHE_PREFIX = '__CACHE_PREFIX__-';
const CACHE = CACHE_PREFIX + CACHE_VERSION;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(PRECACHE);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Drop every previous cache for this app so a new deploy can't serve a stale shell.
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // mutations always hit the network (and the offline queue)

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // third-party: leave to the network
  if (url.pathname.startsWith('/api/')) return;    // API: never cache — the write queue owns offline

  if (request.mode === 'navigate') {
    event.respondWith(shellFirst(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});

async function shellFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = (await cache.match('/index.html')) ?? (await cache.match('/'));
  if (cached) return cached;
  try {
    return await fetch(request);
  } catch {
    return Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') cache.put(request, response.clone());
    return response;
  } catch {
    return cached ?? Response.error();
  }
}
