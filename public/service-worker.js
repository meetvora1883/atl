const CACHE_VERSION = '2026-07-15';
const CACHE_NAME = `hypercity-cache-${CACHE_VERSION}`;
const MAX_CACHE_ITEMS = 200;

// Only cache the offline page and manifest – NOT the root
const CORE_ASSETS = [
  '/offline.html',
  '/manifest.json'
];

// ----------------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(
        CORE_ASSETS.map(url => cache.add(url).catch(err => console.warn(`[SW] Failed cache ${url}`, err)))
      ))
      .then(() => self.skipWaiting())
  );
});

// ----------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => enforceCacheLimit())
  );
});

// ----------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Never cache API, auth, or WebSocket traffic
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname.startsWith('/socket.io/')
  ) {
    return event.respondWith(fetch(event.request));
  }

  // 2. Navigation (HTML pages) – network first, fallback to offline.html
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match('/offline.html'))
    );
    return;
  }

  // 3. Static assets – cache first, with dynamic caching
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response && response.ok && response.type === 'basic' && isStaticAsset(url) && !hasNoStoreCacheControl(response)) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone).then(() => enforceCacheLimit()));
      }
      return response;
    }).catch(() => {
      if (isImageRequest(url)) {
        return caches.match('/icons/placeholder-image.png').then(fallback => fallback || new Response('', { status: 404 }));
      }
      return new Response('Resource not available', { status: 404 });
    }))
  );
});

// ----------------------------------------------------------------------
// Helpers (unchanged)
function isStaticAsset(url) {
  if (url.pathname === '/manifest.json') return true;
  if (url.pathname.endsWith('.json')) return false;
  const ext = url.pathname.split('.').pop()?.toLowerCase() || '';
  return ['css', 'js', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'woff', 'woff2', 'ttf', 'eot'].includes(ext);
}
function isImageRequest(url) {
  const ext = url.pathname.split('.').pop()?.toLowerCase() || '';
  return ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext);
}
function hasNoStoreCacheControl(response) {
  const cc = response.headers.get('Cache-Control');
  return cc ? cc.includes('no-store') : false;
}
function enforceCacheLimit() {
  return caches.open(CACHE_NAME).then(cache => cache.keys().then(keys => {
    if (keys.length > MAX_CACHE_ITEMS) {
      return Promise.all(keys.slice(0, keys.length - MAX_CACHE_ITEMS).map(req => cache.delete(req)));
    }
  }));
}
