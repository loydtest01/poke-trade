// PokéTrade PhotoBridge – Service Worker v1.3
// Nutný pro notifikace na Android Chrome PWA

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e  => e.waitUntil(clients.claim()));

// ── Push přijatý ze serveru ──────────────────────────────────
self.addEventListener('push', e => {
  let data = {};
  try {
    const text = e.data?.text();
    if (text) data = JSON.parse(text);
  } catch {}

  const title = data.title || 'PokéTrade';
  const opts = {
    body:      data.body  || '',
    icon:      data.icon  || 'https://pokemon-trade-ruddy.vercel.app/icon-aipc-192.png',
    badge:     'https://pokemon-trade-ruddy.vercel.app/badge-96.png',
    tag:       data.tag   || 'pkt',
    renotify:  false,
    vibrate:   [200, 100, 200],
    data: { url: data.url || self.registration.scope }
  };

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Je appka vůbec otevřena?
      const appOpen = windowClients.some(c => c.url.startsWith(self.registration.scope));
      if (!appOpen) {
        // Appka zavřená → vždy zobraz notifikaci
        return self.registration.showNotification(title, opts);
      }

      // Appka je otevřená – zjisti jestli je aktivní (viditelná)
      const appVisible = windowClients.some(c =>
        c.url.startsWith(self.registration.scope) && c.visibilityState === 'visible'
      );

      // Je to chatová notifikace?
      const combined = ((title || '') + ' ' + (data.body || '')).toLowerCase();
      const isChatNotif = combined.includes('zpráv') || combined.includes('message') || combined.includes('chat') || combined.includes('píše');

      if (isChatNotif && appVisible) {
        // Chat je otevřený a viditelný → uživatel zprávu vidí přímo, notifikaci nezobrazuj
        return;
      }

      // Jiná notifikace (prodej, výměna...) nebo appka je na pozadí → zobraz
      return self.registration.showNotification(title, opts);
    })
  );
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

self.addEventListener('fetch', () => {});
