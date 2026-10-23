// BillBlitz — lightweight service worker (installability only).
// No caching, no interception: every request goes straight to the network.
// Used for clients WITHOUT the Offline Mode add-on so Chrome/Edge still
// offer "Install app". Offline clients use service-worker.js instead.
self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function(){ /* pass-through */ });
