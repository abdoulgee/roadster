/*
 * Drive Roadster service worker.
 *
 * The app shell is cached on install so the game opens offline. Everything else is cached as it
 * is used: the hashed JS/CSS bundles, the app icons and the Google fonts. Navigations go to the
 * network first (so a new build is picked up) and fall back to the cached shell when offline.
 *
 * Register with ?dev=1 to leave the dev server alone: Vite's module graph must never be cached.
 */
const VERSION = 'roadster-v3';
const SHELL = `${VERSION}-shell`;
const RUNTIME = `${VERSION}-runtime`;
const DEV = new URL(self.location.href).searchParams.has('dev');

const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  const precache = DEV
    ? Promise.resolve()
    : (async () => {
        const cache = await caches.open(SHELL);
        // One missing file must not block the install; the rest still work offline.
        await Promise.all(
          SHELL_URLS.map(async (url) => {
            try {
              await cache.add(new Request(url, { cache: 'reload' }));
            } catch {
              /* keep going */
            }
          }),
        );
      })();
  event.waitUntil(precache.then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('roadster-') && key !== SHELL && key !== RUNTIME)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  if (DEV) return;

  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  // Analytics/admin API responses must always be live (and are not part of the app shell).
  if (url.pathname.startsWith('/api/')) return;
  // Belt and braces: never cache Vite's dev module graph, even if a dev worker slips through.
  if (/^\/(@|src\/|node_modules\/)/.test(url.pathname)) return;

  const sameOrigin = url.origin === self.location.origin;
  const fontHost = url.hostname === 'fonts.gstatic.com';
  const styleHost = url.hostname === 'fonts.googleapis.com';
  if (!sameOrigin && !fontHost && !styleHost) return;

  if (request.mode === 'navigate') {
    // Only the game is the cached app shell. /admin.html is a separate page and always goes to
    // the network, so opening it never overwrites the offline shell with admin HTML.
    if (url.pathname === '/' || url.pathname === '/index.html') {
      event.respondWith(networkFirst(request));
    }
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

/** Newest shell when online; the cached app when the network is gone. */
async function networkFirst(request) {
  const cache = await caches.open(SHELL);
  try {
    const response = await fetch(request);
    if (response && response.ok) await cache.put('/', response.clone());
    return response;
  } catch {
    return (await cache.match('/')) || (await cache.match('/index.html')) || Response.error();
  }
}

/** Serve from cache at once and refresh it in the background. */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === 'opaque')) return cache.put(request, response.clone()).then(() => response);
      return response;
    })
    .catch(() => null);

  if (cached) {
    void network;
    return cached;
  }

  const response = await network;
  return response || Response.error();
}
