// PokéTrade – Service Worker v3.1
// ⚡ Opraveno: JS/CSS nyní stale-while-revalidate (nepotřebuješ Ctrl+Shift+R)
// 🔔 Nová verze: zobrazí uživateli tlačítko "Aktualizovat"
// ♾️  Automatický skip waiting – nový SW se aktivuje hned bez čekání na zavření

// ── VERZE: změň při každém deployi (nebo automatizuj přes build skript) ──────
const SW_VERSION = '3.1';
const CACHE_STATIC = `poketrade-static-v${SW_VERSION}`;
const CACHE_PAGES  = `poketrade-pages-v${SW_VERSION}`;
const CACHE_IMGS   = `poketrade-imgs-v${SW_VERSION}`;

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
  // skipWaiting = nový SW se okamžitě aktivuje (nepotřebuješ Ctrl+Shift+R)
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
      // Oznám všem otevřeným tabům že je nová verze
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

  // Přeskoč: non-GET, devtools, externe domény, API endpointy
  if (req.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;
  if (url.hostname !== self.location.hostname) return;
  if (url.pathname.startsWith('/api/')) return;

  const ext = url.pathname.split('.').pop().toLowerCase();

  // ── HTML stránky → Network-first (vždy čerstvý obsah) ─────────────────────
  if (req.headers.get('Accept')?.includes('text/html') || ext === 'html' || ext === '') {
    e.respondWith(networkFirst(req, CACHE_PAGES));
    return;
  }

  // ── JS a CSS → Stale-While-Revalidate ─────────────────────────────────────
  // Okamžitě vrátí z cache (rychlé načtení) + paralelně aktualizuje cache na pozadí.
  // Příští načtení stránky bude mít novou verzi → bez potřeby Ctrl+Shift+R
  if (ext === 'js' || ext === 'css') {
    e.respondWith(staleWhileRevalidate(req, CACHE_STATIC));
    return;
  }

  // ── Obrázky a fonty → Cache-first (mění se zřídka) ────────────────────────
  if (['png','jpg','jpeg','webp','svg','ico','woff','woff2'].includes(ext)) {
    e.respondWith(cacheFirst(req, CACHE_IMGS));
    return;
  }

  // ── Ostatní → Network-first ────────────────────────────────────────────────
  e.respondWith(networkFirst(req, CACHE_STATIC));
});

// ── Strategie ─────────────────────────────────────────────────────────────────

// Network-first: pokusí se stáhnout ze sítě, fallback na cache, fallback offline.html
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

// Stale-While-Revalidate: okamžitě z cache, aktualizuje na pozadí
async function staleWhileRevalidate(req, cacheName) {
  const cache   = await caches.open(cacheName);
  const cached  = await cache.match(req);

  // Vždy spusť fetch na pozadí
  const fetchPromise = fetch(req).then(res => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);

  // Pokud máme cache → vrátíme ji okamžitě, síť jede na pozadí
  return cached || fetchPromise;
}

// Cache-first: pokud v cache → vrátí okamžitě, jinak síť
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

// ── Zprávy od klienta (např. "skipWaiting" po kliknutí na aktualizovat) ───────
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
