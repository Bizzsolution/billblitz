// AtithiBook Service Worker — v2.3
// Offline support + background sync
// IMPORTANT: bump this version number EVERY time index.html changes —
// otherwise the "cache-first" strategy below serves the OLD cached app
// shell forever, even after a fresh deploy (exactly what caused devices
// to keep showing an outdated version despite redeploying).
//
// AUDIT-2 (F11) — cache policy hardening:
//  • Only GET requests are ever answered from or written to the cache.
//  • Nothing under /api/ or /.netlify/ is cached, on ANY hostname. The old
//    exclusion only matched hostnames containing "netlify" AND the
//    /.netlify/functions path, so on a custom domain an authenticated GET
//    such as /api/manage-keys (sent with x-admin-key) was stored
//    cache-first and later served to anyone on that device without the
//    key. /api/* (the path the apps actually call) was never excluded.
//  • Requests carrying credentials (Authorization / x-admin-key) bypass the
//    worker entirely.
//  • admin.html is network-only: it must never be served stale after a
//    security fix is deployed, and admin data must not persist offline on
//    whatever device the admin last used.
//  • Cross-origin assets are precached in CORS mode, so the cached copy is
//    a readable response that satisfies the integrity="" attributes on
//    the React <script> tags. An opaque (no-cors) cached copy cannot be
//    used for a CORS/SRI request.

const CACHE = 'atithibook-v5.21.1';
const OFFLINE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/jsQR.js',
  '/html2canvas.min.js',
  '/jspdf.umd.min.js',
  'https://unpkg.com/react@18.3.1/umd/react.production.min.js',
  'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js',
  'https://fonts.googleapis.com/css2?family=Josefin+Sans:wght@400;600;700&family=Hind:wght@300;400;500;600;700&display=swap',
];

// Hosts whose traffic is live data / authenticated APIs — never cached.
const NETWORK_ONLY_HOST = /(^|\.)(googleapis\.com|firebaseio\.com|firebaseapp\.com|groq\.com|qrserver\.com)$/i;

function isCacheable(request) {
  if (request.method !== 'GET') return false;
  if (request.headers.has('authorization') || request.headers.has('x-admin-key')) return false;
  let url;
  try { url = new URL(request.url); } catch (e) { return false; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return false;
    if (url.pathname === '/admin.html' || url.pathname.startsWith('/admin')) return false;
    return true;
  }
  if (NETWORK_ONLY_HOST.test(url.hostname) && url.hostname !== 'fonts.googleapis.com') return false;
  return url.hostname === 'unpkg.com' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
}

// Install — cache core assets. Each entry is cached independently so one
// unreachable CDN file cannot fail the whole install (and leave the app
// with no offline shell at all).
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => Promise.all(OFFLINE_URLS.map(url => {
      const crossOrigin = /^https?:\/\//.test(url);
      const req = new Request(url, crossOrigin ? { mode: 'cors', credentials: 'omit' } : {});
      return fetch(req)
        .then(res => (res && res.ok && res.type !== 'opaque') ? cache.put(url, res) : undefined)
        .catch(() => undefined);
    }))).then(() => self.skipWaiting())
  );
});

// Activate — clean old caches (including any opaque entries from v5.12).
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Allow index.html to trigger immediate activation of a waiting SW
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function putIfSafe(request, response) {
  if (!response || response.status !== 200 || response.type === 'opaque') return;
  if (!isCacheable(request)) return;
  const clone = response.clone();
  caches.open(CACHE).then(c => c.put(request, clone)).catch(() => {});
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (!isCacheable(req)) return; // network handles it, untouched

  const url = new URL(req.url);
  const isShell = req.mode === 'navigate' || (url.origin === self.location.origin && (url.pathname === '/' || url.pathname.endsWith('/index.html')));

  // NETWORK FIRST for the app shell — always try to get the latest
  // index.html; fall back to cache only when offline.
  if (isShell) {
    e.respondWith(
      fetch(req)
        .then(response => { putIfSafe(req, response); return response; })
        .catch(() => caches.match(req).then(cached => cached || caches.match('/index.html')))
    );
    return;
  }

  // CACHE FIRST for static assets.
  e.respondWith(
    caches.match(req).then(cached => {
      if (cached && cached.type !== 'opaque') return cached;
      return fetch(req).then(response => { putIfSafe(req, response); return response; });
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
