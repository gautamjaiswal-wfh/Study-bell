// ============================================================
//  StudyBell Service Worker
//  - Caches app shell for offline use
//  - Handles Web Push notifications (VAPID)
//  - Fixed: icon paths now .png (was .svg — bug fix)
// ============================================================

const CACHE_NAME = 'studybell-v3';

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',       // ✅ Fixed (was .svg)
  './icon-512.png',       // ✅ Fixed (was .svg)
  './icon-192-maskable.png',
  './icon-512-maskable.png',
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Nunito:wght@300;400;500;600;700&display=swap',
  'https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore-compat.js'
];

// ============================================================
//  INSTALL — pre-cache app shell
// ============================================================
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Cache install error:', err))
  );
});

// ============================================================
//  ACTIVATE — remove old caches
// ============================================================
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ============================================================
//  FETCH — cache-first for app shell, network-first for Firebase
// ============================================================
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Always go network for Firestore API calls
  if (url.includes('firestore.googleapis.com') ||
      url.includes('firebase') ||
      url.includes('/send-push') ||
      url.includes('/vapid-public-key')) {
    event.respondWith(
      fetch(event.request).catch(() => new Response('', { status: 503 }))
    );
    return;
  }

  // Cache-first for everything else (app shell, fonts, icons)
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(resp => {
        // Only cache same-origin or known CDN responses
        if (resp && resp.status === 200 &&
           (event.request.url.startsWith(self.location.origin) ||
            event.request.url.includes('gstatic.com') ||
            event.request.url.includes('googleapis.com'))) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return resp;
      }).catch(() => caches.match('./index.html'));
    })
  );
});

// ============================================================
//  PUSH — receive and show rich notification
// ============================================================
self.addEventListener('push', event => {
  let payload = {
    title:   '🔔 StudyBell',
    body:    'You have a new signal!',
    icon:    './icon-192.png',    // ✅ Fixed (was .svg)
    badge:   './icon-192.png',    // ✅ Fixed (was .svg)
    vibrate: [200, 100, 200],
    tag:     'studybell-signal',
    renotify: true,
    requireInteraction: true,
    data:    { url: self.registration.scope }
  };

  if (event.data) {
    try {
      const incoming = event.data.json();
      payload = {
        ...payload,
        title:   incoming.title   || payload.title,
        body:    incoming.body    || payload.body,
        icon:    incoming.icon    || payload.icon,
        badge:   incoming.badge   || payload.badge,
        vibrate: incoming.vibrate || payload.vibrate,
        tag:     incoming.tag     || payload.tag
      };
    } catch(e) {
      // If JSON parse fails, try plain text
      payload.body = event.data.text() || payload.body;
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body:               payload.body,
      icon:               payload.icon,
      badge:              payload.badge,
      vibrate:            payload.vibrate,
      tag:                payload.tag,
      renotify:           payload.renotify,
      requireInteraction: payload.requireInteraction,
      silent:             false,
      data:               payload.data
    })
  );
});

// ============================================================
//  NOTIFICATION CLICK — open / focus app
// ============================================================
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : self.registration.scope;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // If app already open, focus it
      for (const client of list) {
        if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// ============================================================
//  PUSH SUBSCRIPTION CHANGE — re-register if subscription expires
// ============================================================
self.addEventListener('pushsubscriptionchange', event => {
  // Tell the app to re-subscribe; the page handles re-saving to Firestore
  event.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: event.oldSubscription?.options?.applicationServerKey
    }).then(sub => {
      // Broadcast new subscription to all open clients
      return self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(c => c.postMessage({
          type: 'PUSH_SUBSCRIPTION_CHANGED',
          subscription: JSON.stringify(sub.toJSON())
        }));
      });
    }).catch(err => console.warn('[SW] Subscription renewal failed:', err))
  );
});
