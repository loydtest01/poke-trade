// PokéTrade – Service Worker v3.2
// ⚡ JS/CSS: network-first s krátkým timeoutem (dřív stale-while-revalidate,
//    což po deployi servírovalo starou verzi a mátlo při ladění)
// 🔔 Nová verze: zobrazí uživateli tlačítko "Aktualizovat"
// ♾️  Automatický skip waiting – nový SW se aktivuje hned bez čekání

// ── VERZE: změň při každém deployi ───────────────────────────────────────────
const SW_VERSION = '3.2';
const CACHE_STATIC = `poketrade-static-v${SW_VERSION}`;
const CACHE_PAGES  = `poketrade-pages-v${SW_VERSION}`;
const CACHE_IMGS   = `poketrade-imgs-v${SW_VERSION}`;

// Kolik ms čekáme na síť u JS/CSS, než sáhneme do cache
const NET_TIMEOUT = 3000;

// Statické assety které předkešujeme při instalaci
const PRECACHE_ASSETS = [
  '/offline.html',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/badge-96.png',
  '/app-manifest.json',
];

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_STATIC).then(cache =>
      Promise.allSettled(PRECACHE_ASSETS.map(url => cache.add(url).catch(() => {})))
    )
  );
});

// ── Activate: vymaž staré verze cache ────────────────────────────────────────
self.addEventListener('activate', e => {
  const validCaches = new Set([CACHE_STATIC, CACHE_PAGES, CACHE_IMGS]);
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !validCaches.has(k)).map(k => caches.delete(k))
      ))
      .then(() => clients.claim())
      .then(() => notifyClientsNewVersion())
  );
});

function notifyClientsNewVersion() {
  return clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    list.forEach(client => client.postMessage({ type: 'SW_UPDATED', version: SW_VERSION }));
  });
}

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;
  if (url.hostname !== self.location.hostname) return;
  if (url.pathname.startsWith('/api/')) return;

  const ext = url.pathname.split('.').pop().toLowerCase();

  // ── HTML stránky → Network-first ──────────────────────────────────────────
  if (req.headers.get('Accept')?.includes('text/html') || ext === 'html' || ext === '') {
    e.respondWith(networkFirst(req, CACHE_PAGES));
    return;
  }

  // ── JS a CSS → Network-first s timeoutem ──────────────────────────────────
  // ZMĚNA v3.2: dřív tu byl stale-while-revalidate, který po nasazení vždycky
  // jednou vrátil STAROU verzi. Kombinace nové HTML + starého JS způsobovala
  // chyby, které vypadaly jako by oprava nefungovala. Teď se čeká na síť
  // (max 3 s) a cache slouží jen jako záchrana při výpadku.
  if (ext === 'js' || ext === 'css') {
    e.respondWith(networkFirstTimeout(req, CACHE_STATIC, NET_TIMEOUT));
    return;
  }

  // ── Obrázky a fonty → Cache-first ─────────────────────────────────────────
  if (['png','jpg','jpeg','webp','svg','ico','woff','woff2'].includes(ext)) {
    e.respondWith(cacheFirst(req, CACHE_IMGS));
    return;
  }

  e.respondWith(networkFirst(req, CACHE_STATIC));
});

// ── Strategie ─────────────────────────────────────────────────────────────────

async function networkFirst(req, cacheName) {
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaqueredirect') {
      const cache = await caches.open(cacheName);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    return cached || await caches.match('/offline.html');
  }
}

// Network-first, ale nečeká donekonečna — po timeoutu vrátí cache.
// Síť přesto doběhne a cache se aktualizuje.
async function networkFirstTimeout(req, cacheName, ms) {
  const cache = await caches.open(cacheName);

  const network = fetch(req).then(res => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });

  const cached = await cache.match(req);
  if (!cached) return network.catch(() => new Response('', { status: 504 }));

  // Máme cache → dáme síti šanci, ale jen na chvíli
  return Promise.race([
    network.catch(() => cached),
    new Promise(resolve => setTimeout(() => resolve(cached), ms)),
  ]);
}

async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) {
      const cache = await caches.open(cacheName);
      cache.put(req, res.clone());
    }
    return res;
  } catch {
    return new Response('Not available offline', { status: 503 });
  }
}

// ── Zprávy od klienta ─────────────────────────────────────────────────────────
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// ── Push notifikace ────────────────────────────────────────────────────────────
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
