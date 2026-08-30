// AtithiBook Service Worker — v2.2
// Offline support + background sync
// IMPORTANT: bump this version number EVERY time index.html changes —
// otherwise the "cache-first" strategy below serves the OLD cached app
// shell forever, even after a fresh deploy (exactly what caused devices
// to keep showing an outdated version despite redeploying).

const CACHE = 'atithibook-v2.2';
const OFFLINE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  'https://unpkg.com/react@18.3.1/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js',
  'https://unpkg.com/jsqr@1.4.0/dist/jsQR.js',
  'https://fonts.googleapis.com/css2?family=Josefin+Sans:wght@400;600;700&family=Hind:wght@300;400;500;600;700&display=swap',
];

// Install — cache core assets
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => {
      console.log('[SW] Caching app shell');
      return cache.addAll(OFFLINE_URLS.map(url => new Request(url, { mode: 'no-cors' })));
    }).then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Lets the page force an already-installed-but-waiting new version to take
// over IMMEDIATELY, instead of waiting for the browser's own (sometimes
// slow/inconsistent) update-check timing — this is what index.html calls
// as soon as it detects a new worker is ready.
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Fetch — NETWORK-FIRST for page navigation (always get the latest app
// when online — offline fallback to cache only if genuinely disconnected).
// CACHE-FIRST for static libraries/fonts (faster, rarely change).
// This protects against ever again silently serving a stale app version
// just because someone forgot to bump the CACHE version number above.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Never cache Firebase, Groq, Gemini API calls
  if (url.hostname.includes('googleapis') ||
      url.hostname.includes('firebase') ||
      url.hostname.includes('groq.com') ||
      url.hostname.includes('generativelanguage') ||
      url.hostname.includes('netlify') && url.pathname.startsWith('/.netlify/functions')) {
    return; // Let network handle
  }

  // Page navigations (the app shell itself) — network-first
  if (e.request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('/index.html')) {
    e.respondWith(
      fetch(e.request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(e.request).then(cached => cached || caches.match('/index.html')))
    );
    return;
  }

  // Everything else (JS libraries, fonts, icons) — cache-first for speed
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request)
        .then(response => {
          // Cache successful responses
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return response;
        })
        .catch(() => {
          // Offline fallback for navigation requests
          if (e.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
    })
  );
});

// Background sync for when connection returns
self.addEventListener('sync', e => {
  if (e.tag === 'sync-data') {
    console.log('[SW] Background sync triggered');
  }
});

// Push notifications (future use)
self.addEventListener('push', e => {
  const data = e.data?.json() || { title: 'AtithiBook', body: 'New notification' };
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-72.png',
      vibrate: [100, 50, 100]
    })
  );
});
