const CACHE_VERSION = '2026-07-14';
const CACHE_NAME = `hypercity-cache-${CACHE_VERSION}`;
const MAX_CACHE_ITEMS = 200;
const CORE_ASSETS = ['/', '/offline.html', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(CORE_ASSETS.map(url => cache.add(url).catch(err => console.warn(`[SW] Failed cache ${url}`, err)))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => enforceCacheLimit())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/socket.io/')) {
    return event.respondWith(fetch(event.request));
  }
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response && response.ok && response.type === 'basic' && isStaticAsset(url) && !hasNoStoreCacheControl(response)) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone).then(() => enforceCacheLimit()));
      }
      return response;
    }).catch(() => {
      if (isImageRequest(url)) return caches.match('/icons/placeholder-image.png').then(fallback => fallback || new Response('', { status: 404 }));
      return new Response('Resource not available', { status: 404 });
    }))
  );
});

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