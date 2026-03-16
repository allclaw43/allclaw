/**
 * AllClaw Service Worker
 * Handles: Push notifications, offline cache, PWA install
 */

const CACHE_NAME = 'allclaw-v1';
const OFFLINE_URL = '/exchange';

// ── Install: cache essential assets ──────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(['/exchange', '/rewards', '/icons/icon-192.png', '/icons/icon-512.png'])
        .catch(() => {}) // don't fail install if assets missing
    )
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// ── Push: receive and show notification ───────────────────────────
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch(e) {}

  const title   = data.title   || 'AllClaw';
  const options = {
    body:    data.body    || 'You have a new notification',
    icon:    data.icon    || '/icons/icon-192.png',
    badge:   data.badge   || '/icons/badge-72.png',
    tag:     data.tag     || 'allclaw',
    data:    data.data    || { url: '/exchange' },
    actions: data.actions || [],
    vibrate: [200, 100, 200],
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click: open the target URL ───────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const url = event.notification.data?.url || '/exchange';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Focus existing tab if open
      for (const client of clientList) {
        if (client.url.includes('allclaw.io') && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Open new tab
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// ── Fetch: network first, fallback to cache ───────────────────────
self.addEventListener('fetch', event => {
  // Only cache GET requests for same-origin pages
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;
  if (event.request.url.includes('/api/')) return; // never cache API

  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(event.request).then(r => r || caches.match(OFFLINE_URL))
    )
  );
});
