// PokéTrade PhotoBridge – Service Worker v1.4
// Nutný pro notifikace na Android Chrome PWA

self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e  => e.waitUntil(clients.claim()));

// ── Pomocník: vytáhni conv_id z dat notifikace nebo URL ──────
function _extractConvId(data) {
  if (data.conv_id) return data.conv_id;
  const url = data.url || '';
  const m = url.match(/[?&]open_conv=([0-9a-f-]{36})/i)
         || url.match(/conversations\/([0-9a-f-]{36})/i)
         || url.match(/[?&]conv(?:_id)?=([0-9a-f-]{36})/i);
  return m ? m[1] : null;
}

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
    data: {
      url:     data.url    || self.registration.scope,
      conv_id: data.conv_id || _extractConvId(data)
    }
  };

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const scope = self.registration.scope;
      const appVisible = list.some(c => c.url.startsWith(scope) && c.visibilityState === 'visible');
      const combined   = ((title || '') + ' ' + (data.body || '')).toLowerCase();
      const isChat     = combined.includes('zpráv') || combined.includes('message') || combined.includes('chat') || combined.includes('píše');
      if (isChat && appVisible) return;
      return self.registration.showNotification(title, opts);
    })
  );
});

// ── Klik na notifikaci ───────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();

  const data   = e.notification.data || {};
  const convId = _extractConvId(data);
  const scope  = self.registration.scope;

  // Deep-link URL s conv_id pokud ho máme
  const targetUrl = convId ? scope + '?open_conv=' + convId : scope;

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const appClient = list.find(c => c.url.startsWith(scope));

      if (appClient) {
        // Fokusuj existující okno a pošli mu conv_id přes postMessage
        return appClient.focus().then(focused => {
          if (convId && focused) {
            focused.postMessage({ type: 'open_conv', conv_id: convId });
          }
        }).catch(() => clients.openWindow(targetUrl));
      }

      // Žádné okno není otevřené
      // scope URL (ne data.url) = PWA se otevře místo prohlížeče
      return clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener('fetch', () => {});
