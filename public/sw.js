// Service worker for United Traffic Tickets Defense (PWA)
const CACHE = 'utt-cache-v15';
const CORE = [
  '/',
  '/index.html',
  '/style.css',
  '/home-polish.css?v=20261126',
  '/app.js',
  '/quiz.css',
  '/quiz.js',
  '/assistant.html',
  '/assistant.css',
  '/assistant.js',
  '/scanner-browser-fallback.js',
  '/scanner-ui.js',
  '/scan-guard.js',
  '/scanner-preprocess.js',
  '/scanner-client.js',
  '/score-ui.js',
  '/scan-stage.js',
  '/scan-pay.js',
  '/scan-progress.js',
  '/consent-banner.js',
  '/scanner-upload.js',
  '/manifest.webmanifest',
  '/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for navigation, cache-first for static assets, runtime cache for images.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Don't intercept API or cross-origin (fonts, Stripe, etc.) for caching.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  const scannerAsset = /^(\/(assistant|scan-guard|scan-progress|scanner-preprocess|scanner-client|scanner-browser-fallback|scanner-ui|consent-banner)\.js|\/assistant\.css)$/.test(url.pathname);
  if (scannerAsset) {
    event.respondWith(fetch(req, { cache: 'no-store' }).catch(() => caches.match(url.pathname)));
    return;
  }

  if (req.mode === 'navigate') {
    // Cache only known public pages. A case URL can include a tracking code.
    const page = !url.search && ({
      '/': '/', '/index.html': '/', '/assistant': '/assistant.html', '/assistant.html': '/assistant.html',
    })[url.pathname];
    if (!page) return;
    event.respondWith(fetch(req).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then((cache) => cache.put(page, copy)));
      }
      return response;
    }).catch(() => caches.match(page)));
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});

// photo-free hero variant cache marker
