// ============================================================
//  StudyBell Service Worker v4
//  - Strong vibration patterns
//  - requireInteraction so notification stays on screen
//  - Fixed icon paths (.png)
// ============================================================

const CACHE_NAME = 'studybell-v4';

const ASSETS = [
  './',
  './sender.html',
  './receiver.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-192-maskable.png',
  './icon-512-maskable.png'
];

// ── INSTALL ────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Cache install error:', err))
  );
});

// ── ACTIVATE ───────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── FETCH ──────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Always network for Firebase / push server
  if (url.includes('firestore.googleapis.com') ||
      url.includes('firebase') ||
      url.includes('onrender.com')) {
    event.respondWith(
      fetch(event.request).catch(() => new Response('', { status: 503 }))
    );
    return;
  }

  // Cache-first for app shell
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(resp => {
        if (resp && resp.status === 200) {
          caches.open(CACHE_NAME).then(c => c.put(event.request, resp.clone()));
        }
        return resp;
      }).catch(() => caches.match('./receiver.html'));
    })
  );
});

// ── PUSH ───────────────────────────────────────────────────
// Strong vibration: long-short-long pattern repeated twice
// requireInteraction = true → notification stays until she taps it
// renotify = true → always re-vibrate even if same tag
self.addEventListener('push', event => {

  let data = {
    title:   '🔔 StudyBell',
    body:    'He sent you a signal!',
    icon:    './icon-192.png',
    badge:   './icon-192.png',
    vibrate: [500,200,500,200,800,200,800], // strong default
    tag:     'studybell-signal'
  };

  if (event.data) {
    try {
      const inc = event.data.json();
      data.title   = inc.title   || data.title;
      data.body    = inc.body    || data.body;
      data.icon    = inc.icon    || data.icon;
      data.badge   = inc.badge   || data.badge;
      data.vibrate = inc.vibrate || data.vibrate;
      data.tag     = inc.tag     || data.tag;
    } catch(e) {
      data.body = event.data.text() || data.body;
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:               data.body,
      icon:               data.icon,
      badge:              data.badge,

      // ── The 3 most important lines for Android ──────────
      vibrate:            data.vibrate,
      requireInteraction: true,   // stays on screen until tapped
      renotify:           true,   // re-vibrates every time
      // ────────────────────────────────────────────────────

      silent:             false,
      tag:                data.tag,
      data:               { url: self.registration.scope }
    })
  );
});

// ── NOTIFICATION CLICK ─────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url)
    ? event.notification.data.url
    : self.registration.scope;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});

// ── SUBSCRIPTION CHANGE ────────────────────────────────────
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: event.oldSubscription?.options?.applicationServerKey
    }).then(sub => {
      return self.clients.matchAll({ type: 'window' }).then(clients => {
        clients.forEach(c => c.postMessage({
          type: 'PUSH_SUBSCRIPTION_CHANGED',
          subscription: JSON.stringify(sub.toJSON())
        }));
      });
    }).catch(err => console.warn('[SW] Subscription renewal failed:', err))
  );
});
