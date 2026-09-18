// ── BillBlitz Service Worker ──────────────────────────────────────
// Makes the app OPENABLE and USABLE with no internet connection.
//
// Two different caching strategies, deliberately:
//
// 1. The app shell (index.html, manifest, icons) — NETWORK FIRST.
//    This app gets updated often. If we cached it "cache first", staff
//    could get permanently stuck on an old, possibly-buggy version even
//    with perfect internet, since the cache would always win. Network
//    First means: whenever there IS internet, the latest deployed version
//    always loads (and re-caches itself for next time) — the cache is
//    only ever used as a fallback when there's truly no connection.
//
// 2. CDN libraries (jsPDF, face-api, xlsx, qrcode + face model files) —
//    CACHE FIRST. These are pinned to specific versions and essentially
//    never change, so once fetched once, reuse the cached copy forever —
//    faster, and works offline after the first use (e.g. the first time
//    someone registers a face or prints a PDF while online).
//
// Firebase/Firestore network calls are NEVER intercepted — the Firebase
// SDK has its own, more sophisticated offline queue (enablePersistence)
// and this service worker must stay out of its way entirely.

var SHELL_CACHE = 'billblitz-shell-v1';
var LIB_CACHE   = 'billblitz-libs-v1';

var SHELL_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Any request to one of these hosts is a versioned library/asset — safe to
// cache-first and reuse indefinitely.
var LIB_HOSTS = [
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net'
];

// Anything to these hosts must NEVER be touched by this service worker —
// Firebase manages its own offline behaviour.
var PASSTHROUGH_HOSTS = [
  'firestore.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebasestorage.googleapis.com',
  'www.googleapis.com'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(function(cache) { return cache.addAll(SHELL_URLS); })
      .catch(function(){ /* first install without a network — fine, shell just isn't cached yet */ })
  );
  self.skipWaiting(); // new version takes over as soon as it's installed
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names
          .filter(function(n){ return n !== SHELL_CACHE && n !== LIB_CACHE; })
          .map(function(n){ return caches.delete(n); }) // drop old versions
      );
    }).then(function(){ return self.clients.claim(); })
  );
});

function isLibRequest(url) {
  return LIB_HOSTS.some(function(h){ return url.hostname === h; });
}

function isPassthrough(url) {
  return PASSTHROUGH_HOSTS.some(function(h){ return url.hostname.indexOf(h) !== -1; });
}

self.addEventListener('fetch', function(event) {
  var req = event.request;
  if (req.method !== 'GET') return; // never intercept writes

  var url;
  try { url = new URL(req.url); } catch(e) { return; }

  // Let Firebase handle its own traffic completely untouched.
  if (isPassthrough(url)) return;

  // CDN libraries — cache first.
  if (isLibRequest(url)) {
    event.respondWith(
      caches.open(LIB_CACHE).then(function(cache) {
        return cache.match(req).then(function(cached) {
          if (cached) return cached;
          return fetch(req).then(function(res) {
            if (res && res.status === 200) cache.put(req, res.clone());
            return res;
          }).catch(function(){ return cached; }); // still nothing if offline + never cached
        });
      })
    );
    return;
  }

  // Same-origin app shell (HTML/manifest/icons) — network first.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req).then(function(res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(SHELL_CACHE).then(function(cache){ cache.put(req, copy); });
        }
        return res;
      }).catch(function() {
        return caches.match(req).then(function(cached) {
          return cached || caches.match('./index.html');
        });
      })
    );
    return;
  }

  // Anything else (other third-party requests) — just let it happen normally.
});
