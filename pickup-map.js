/* ════════════════════════════════════════════════════════════════
   pickup-map.js
   Mapa místa vyzvednutí (Leaflet + OpenStreetMap, zdarma).
   - Ve formuláři: zadání adresy → geokódování (Nominatim) → náhled mapy,
     přepínač přesnosti (přesná adresa / jen oblast = kruh ~1 km).
   - V nabídce: mapa s místem + „Naplánovat trasu" (mapy.cz/Google/Waze).
   Načítat ZA marketplace.js (a Leaflet z CDN v <head>).
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // Globální stav místa vyzvednutí (čte ho marketplace.js do payloadu)
  window._pickupGeo = null;            // { lat, lng, precision }
  let _formMap = null, _formLayer = null, _precision = 'exact';

  // ── Zobrazit/skrýt blok mapy podle "osobní předání" ──────────
  function syncPickupVisibility() {
    const personal = document.getElementById('addDeliveryPersonal');
    const block = document.getElementById('pickupMapBlock');
    if (!block) return;
    block.style.display = (personal && personal.checked) ? '' : 'none';
  }
  document.addEventListener('change', e => {
    if (e.target && e.target.id === 'addDeliveryPersonal') syncPickupVisibility();
  });

  // ── Přepínač přesnosti ───────────────────────────────────────
  window._setPickupPrecision = function (p) {
    _precision = p;
    document.getElementById('precExact')?.classList.toggle('act', p === 'exact');
    document.getElementById('precArea')?.classList.toggle('act', p === 'area');
    if (window._pickupGeo) { window._pickupGeo.precision = p; drawFormMarker(); }
  };

  // ── Geokódování přes Nominatim (zdarma) ──────────────────────
  window._geocodePickup = async function () {
    const addr = (document.getElementById('pickupAddr')?.value || '').trim();
    const hint = document.getElementById('pickupHint');
    if (!addr) { if (hint) hint.textContent = 'Zadej adresu nebo místo.'; return; }
    if (hint) hint.textContent = 'Hledám…';
    try {
      const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=cz,sk&q=' + encodeURIComponent(addr);
      const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
      const d = await r.json();
      if (!Array.isArray(d) || !d.length) { if (hint) hint.textContent = 'Místo nenalezeno, zkus jinak.'; return; }
      const lat = parseFloat(d[0].lat), lng = parseFloat(d[0].lon);
      window._pickupGeo = { lat, lng, precision: _precision };
      if (hint) hint.textContent = d[0].display_name || '';
      drawFormMarker();
    } catch (e) {
      console.warn('[pickup geocode]', e);
      if (hint) hint.textContent = 'Chyba při hledání. Zkus znovu.';
    }
  };

  function drawFormMarker() {
    const geo = window._pickupGeo;
    const mapEl = document.getElementById('pickupMap');
    if (!geo || !mapEl || typeof L === 'undefined') return;
    mapEl.style.display = '';
    if (!_formMap) {
      _formMap = L.map(mapEl).setView([geo.lat, geo.lng], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© OpenStreetMap'
      }).addTo(_formMap);
    }
    if (_formLayer) { _formMap.removeLayer(_formLayer); _formLayer = null; }
    if (geo.precision === 'area') {
      _formLayer = L.circle([geo.lat, geo.lng], { radius: 1000, color: '#f5c842', fillColor: '#f5c842', fillOpacity: 0.15 });
    } else {
      _formLayer = L.marker([geo.lat, geo.lng]);
    }
    _formLayer.addTo(_formMap);
    _formMap.setView([geo.lat, geo.lng], geo.precision === 'area' ? 12 : 15);
    setTimeout(() => _formMap.invalidateSize(), 100);
  }

  // ── Mapa v nabídce (detail) + plánování trasy ────────────────
  // Volat z renderu detailu nabídky: renderPickupMap(containerId, listing)
  window.renderPickupMap = function (containerId, listing) {
    const el = document.getElementById(containerId);
    if (!el || typeof L === 'undefined') return;
    const lat = listing.pickup_lat, lng = listing.pickup_lng;
    if (lat == null || lng == null) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.style.height = el.style.height || '220px';
    const map = L.map(el).setView([lat, lng], listing.pickup_precision === 'area' ? 12 : 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    if (listing.pickup_precision === 'area') {
      L.circle([lat, lng], { radius: 1000, color: '#f5c842', fillColor: '#f5c842', fillOpacity: 0.15 }).addTo(map);
    } else {
      L.marker([lat, lng]).addTo(map);
    }
    setTimeout(() => map.invalidateSize(), 120);
  };

  // ── „Naplánovat trasu" → nabídka aplikací ────────────────────
  window.planRoute = function (lat, lng) {
    if (lat == null || lng == null) return;
    const dest = lat + ',' + lng;
    const opts = [
      { name: '🗺️ Mapy.cz',     url: 'https://mapy.cz/zakladni?planovani-trasy&end=' + lng + ',' + lat },
      { name: '🌐 Google Maps', url: 'https://www.google.com/maps/dir/?api=1&destination=' + dest },
      { name: '🚗 Waze',        url: 'https://waze.com/ul?ll=' + dest + '&navigate=yes' },
    ];
    showRouteChooser(opts);
  };

  function showRouteChooser(opts) {
    let m = document.getElementById('routeChooser');
    if (m) m.remove();
    m = document.createElement('div');
    m.id = 'routeChooser';
    m.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:20px';
    m.onclick = (e) => { if (e.target === m) m.remove(); };
    m.innerHTML =
      '<div style="background:#0d0a14;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:20px;max-width:300px;width:100%">'
      + '<div style="font-size:16px;font-weight:800;color:#f5c842;margin-bottom:4px">Otevřít trasu v…</div>'
      + '<div style="font-size:12px;color:#8b8794;margin-bottom:14px">Vyber si oblíbenou navigaci</div>'
      + opts.map(o => '<a href="' + o.url + '" target="_blank" rel="noopener" onclick="document.getElementById(\'routeChooser\').remove()" style="display:block;padding:11px 14px;margin-bottom:8px;border-radius:10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#e8e4ef;font-weight:700;font-size:14px;text-decoration:none">' + o.name + '</a>').join('')
      + '<button onclick="document.getElementById(\'routeChooser\').remove()" style="width:100%;margin-top:6px;padding:9px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:transparent;color:#cbc6d4;font-weight:700;cursor:pointer">Zavřít</button>'
      + '</div>';
    document.body.appendChild(m);
  }

  // init
  setTimeout(syncPickupVisibility, 500);
})();
