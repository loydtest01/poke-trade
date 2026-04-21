// PokéTrade PhotoBridge – Service Worker
// Verze: 1.0.0
// Nutný pro zobrazení notifikací na Android Chrome / PWA

const SW_VERSION = 'pkt-sw-v1';

self.addEventListener('install', e => {
  console.log('[SW] install', SW_VERSION);
  self.skipWaiting();  // okamžitá aktivace bez čekání
});

self.addEventListener('activate', e => {
  console.log('[SW] activate', SW_VERSION);
  e.waitUntil(clients.claim());  // převezme kontrolu nad všemi tabs
});

// ── Push události (pro budoucí Web Push od serveru) ──────────
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch {}

  const title = data.title || 'PokéTrade';
  const options = {
    body:      data.body  || '',
    icon:      'icon-aipc-192.png',
    badge:     'icon-aipc-192.png',
    tag:       data.tag   || 'pkt-push',
    renotify:  false,
    data: { url: data.url || self.registration.scope }
  };

  e.waitUntil(self.registration.showNotification(title, options));
});

// ── Klik na notifikaci → otevři / zaměř appku ───────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const targetUrl = e.notification.data?.url || self.registration.scope;

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // Pokud je appka už otevřená, jen ji zaměř
      for (const c of list) {
        if (c.url.startsWith(self.registration.scope) && 'focus' in c) {
          return c.focus();
        }
      }
      // Jinak otevři nové okno
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// ── Fetch – network-first (SW neblokuje žádné requesty) ─────
self.addEventListener('fetch', e => {
  // Nechej vše projít normálně – SW je jen kvůli notifikacím
  // (bez fetch handleru by Chrome mohl odmítnout showNotification)
});
