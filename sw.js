// PokéTrade PhotoBridge – Service Worker v1.1
// Nutný pro notifikace na Android Chrome PWA

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e  => e.waitUntil(clients.claim()));

// ── Push přijatý ze serveru (push-sender.js) ─────────────────
self.addEventListener('push', e => {
  let data = {};
  try {
    const text = e.data?.text();
    if (text) data = JSON.parse(text);
  } catch {}

  const title = data.title || 'PokéTrade';
  const opts = {
    body:      data.body  || '',
    icon:      'icon-aipc-192.png',
    badge:     'icon-aipc-192.png',
    tag:       data.tag   || 'pkt',
    renotify:  false,
    vibrate:   [200, 100, 200],
    data: { url: data.url || self.registration.scope }
  };

  e.waitUntil(self.registration.showNotification(title, opts));
});

// ── Klik na notifikaci → otevři / zaměř appku ───────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = e.notification.data?.url || self.registration.scope;

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});

// Fetch handler – musí být přítomen aby Chrome povolil showNotification přes SW
self.addEventListener('fetch', () => {});
