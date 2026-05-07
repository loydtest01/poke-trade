// PokéTrade – Service Worker v2.0
// Offline-ready + Push notifikace + Background sync

const CACHE_NAME = 'poketrade-v2';
const STATIC_ASSETS = [
  '/',
  '/',
  '/marketplace.html',
  '/moje-album.html',
  '/style.css',
  '/marketplace.css',
  '/mobile-responsive.css',
  '/topbar.js',
  '/pwa-init.js',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/app-manifest.json',
  '/offline.html'
];

/* ── Install: předkešuj statické assety ─────────────────────── */
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Ignoruj chyby pro jednotlivé soubory
      return Promise.allSettled(
        STATIC_ASSETS.map(url => cache.add(url).catch(() => {}))
      );
    })
  );
});

/* ── Activate: vyčisti staré cache ─────────────────────────── */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => clients.claim())
  );
});

/* ── Fetch: Network-first pro API, Cache-first pro statiku ─── */
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Ignoruj: non-GET, chrome-extension, supabase API, external
  if (e.request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;
  if (url.hostname.includes('supabase.co')) return;
  if (url.hostname.includes('googleapis.com')) return;
  if (url.hostname.includes('groq.com')) return;
  if (url.hostname !== self.location.hostname) return;

  // API endpointy — network only
  if (url.pathname.startsWith('/api/')) return;

  // HTML stránky — Network-first (vždy čerstvý obsah)
  if (e.request.headers.get('Accept')?.includes('text/html')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() =>
          caches.match(e.request)
            .then(cached => cached || caches.match('/offline.html'))
        )
    );
    return;
  }

  // CSS/JS/obrázky — Cache-first
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok && res.type !== 'opaque') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});

/* ── Push notifikace ────────────────────────────────────────── */
function _extractConvId(data) {
  if (data.conv_id) return data.conv_id;
  const url = data.url || '';
  const m = url.match(/[?&]open_conv=([0-9a-f-]{36})/i)
         || url.match(/conversations\/([0-9a-f-]{36})/i)
         || url.match(/[?&]conv(?:_id)?=([0-9a-f-]{36})/i);
  return m ? m[1] : null;
}

self.addEventListener('push', e => {
  let data = {};
  try { data = e.data?.json() || {}; } catch {}

  const title = data.title || 'PokéTrade';
  const opts = {
    body:     data.body   || '',
    icon:     data.icon   || '/icon-192.png',
    badge:    '/badge-96.png',
    tag:      data.tag    || 'pkt',
    renotify: false,
    vibrate:  [200, 100, 200],
    data: {
      url:     data.url    || self.registration.scope,
      conv_id: _extractConvId(data)
    }
  };

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const scope = self.registration.scope;
      const appVisible = list.some(c => c.url.startsWith(scope) && c.visibilityState === 'visible');
      const isChat = ((title + ' ' + (data.body || '')).toLowerCase()).match(/zpráv|message|chat|píše/);
      if (isChat && appVisible) return;
      return self.registration.showNotification(title, opts);
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const data   = e.notification.data || {};
  const convId = _extractConvId(data);
  const scope  = self.registration.scope;
  const target = convId ? scope + '?open_conv=' + convId : scope;

  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const app = list.find(c => c.url.startsWith(scope));
      if (app) {
        return app.focus().then(w => {
          if (convId && w) w.postMessage({ type: 'open_conv', conv_id: convId });
        }).catch(() => clients.openWindow(target));
      }
      return clients.openWindow(target);
    })
  );
});
