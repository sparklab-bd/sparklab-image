const CACHE_VERSION = 'spark-image-v1';
const APP_SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png',
  '/apple-touch-icon.png'
];

const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      await Promise.allSettled(
        APP_SHELL_ASSETS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined)
        )
      );
      await Promise.allSettled(
        CDN_ASSETS.map((url) =>
          fetch(url, { mode: 'cors', credentials: 'omit' })
            .then((res) => {
              if (res && res.ok) {
                return cache.put(url, res);
              }
              return undefined;
            })
            .catch(() => undefined)
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isAllowedCdn = url.href.startsWith('https://cdnjs.cloudflare.com/');

  if (!isSameOrigin && !isAllowedCdn) return;

  // Navigation requests: Network-first with cached fallback for 100% offline support
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(request);
          if (networkResponse && networkResponse.ok) {
            const cache = await caches.open(CACHE_VERSION);
            cache.put('/index.html', networkResponse.clone());
          }
          return networkResponse;
        } catch {
          const cached = await caches.match('/index.html');
          return cached || (await caches.match('/')) || Response.error();
        }
      })()
    );
    return;
  }

  // Static & CDN assets: Stale-while-revalidate for self-updating offline readiness
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cachedResponse = await cache.match(request);

      const networkPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(() => undefined);

      if (cachedResponse) {
        event.waitUntil(networkPromise);
        return cachedResponse;
      }

      const freshResponse = await networkPromise;
      return freshResponse || Response.error();
    })()
  );
});
