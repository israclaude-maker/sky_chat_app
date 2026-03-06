// SkyChat Service Worker - Final Version (No Cache for App Files)
const CACHE_NAME = 'skychat-v4';

// Sirf icons aur fonts cache honge
const STATIC_ASSETS = [
  '/static/icons/icon-72x72.png',
  '/static/icons/icon-192x192.png',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'
];

// Install - sirf icons/fonts cache karo
self.addEventListener('install', function(e) {
  console.log('[SW] Install');
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS).catch(function(err) {
        console.log('[SW] Cache addAll error (ignored):', err);
      });
    })
  );
});

// Activate - purane SAARE cache delete karo
self.addEventListener('activate', function(e) {
  console.log('[SW] Activate');
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) {
              console.log('[SW] Deleting old cache:', k);
              return caches.delete(k);
            })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// Fetch - smart caching strategy
self.addEventListener('fetch', function(e) {
  // Skip non-GET
  if (e.request.method !== 'GET') return;

  var url = e.request.url;

  // 1. WebSocket - skip karo
  if (url.includes('/ws/')) return;

  // 2. API calls - HAMESHA network se, kabhi cache nahi
  if (url.includes('/api/')) {
    e.respondWith(
      fetch(e.request).catch(function() {
        return new Response(JSON.stringify({ error: 'Offline' }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // 3. HTML pages - HAMESHA network se (fresh data)
  if (e.request.headers.get('accept') &&
      e.request.headers.get('accept').includes('text/html')) {
    e.respondWith(
      fetch(e.request).catch(function() {
        return caches.match(e.request);
      })
    );
    return;
  }

  // 4. CSS aur JS - HAMESHA network se (version query se handle hota hai)
  if (url.includes('.css') || url.includes('.js')) {
    e.respondWith(
      fetch(e.request).catch(function() {
        return caches.match(e.request);
      })
    );
    return;
  }

  // 5. Media files (images, audio, video) - network first, cache fallback
  if (url.includes('/media/')) {
    e.respondWith(
      fetch(e.request).catch(function() {
        return caches.match(e.request);
      })
    );
    return;
  }

  // 6. Baaki sab (icons, fonts) - cache first, network fallback
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      return fetch(e.request).then(function(response) {
        if (!response || response.status !== 200) return response;
        return caches.open(CACHE_NAME).then(function(cache) {
          cache.put(e.request, response.clone());
          return response;
        });
      });
    })
  );
});

// Push Notifications
self.addEventListener('push', function(e) {
  console.log('[SW] Push received');
  var data = { title: 'SkyChat', body: 'New message received' };
  if (e.data) {
    try { data = e.data.json(); }
    catch(err) { data.body = e.data.text(); }
  }
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/static/icons/icon-192x192.png',
      badge: '/static/icons/icon-72x72.png',
      vibrate: [100, 50, 100],
      data: { url: data.url || '/' },
      actions: [
        { action: 'open', title: 'Open' },
        { action: 'close', title: 'Close' }
      ]
    })
  );
});

// Notification Click
self.addEventListener('notificationclick', function(e) {
  console.log('[SW] Notification click');
  e.notification.close();
  if (e.action === 'close') return;
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function(clientList) {
        for (var i = 0; i < clientList.length; i++) {
          if ('focus' in clientList[i]) return clientList[i].focus();
        }
        if (clients.openWindow) {
          return clients.openWindow(e.notification.data.url || '/');
        }
      })
  );
});