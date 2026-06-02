/* ═══════════════════════════════════════════════════════════════════════
   listing-photos-r2.js  —  Fotky nabídek POUZE na Cloudflare R2
   ───────────────────────────────────────────────────────────────────────
   CÍL: base64 se v ukládaných nabídkách NEPOUŽÍVÁ VŮBEC. Každá nově přidaná
   fotka se HNED po výběru zkomprimuje (max 2000 px, JPEG 90 %) a nahraje na
   R2 přes worker /v1/user-photo. V polích salePhotos/prodPhotos/bulkPhotos
   je pak rovnou veřejná R2 URL (žádný base64). Do DB tedy jdou jen URL.

   Pozn.: base64 pro AI ROZPOZNÁNÍ karty (callClaudeVision apod.) zůstává
   nedotčen — to je dočasný přenos do AI API, nic se neukládá.

   NAHRAZUJE přidávací funkce: handleSalePhotos, handleBulkPhotos,
   _aiAddPhotoToSalePhotos, handleProdPhotos. Přidává "📒 Z alba" pro BULK.
   Rollback = smazat <script> tag z marketplace.html.
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const R2_WORKER = 'https://pokedb-api.poketrade.workers.dev';
  const MAX_DIM   = 2000;
  const JPEG_Q    = 0.90;
  const MAX_BYTES = 8 * 1024 * 1024;

  function getAuth() {
    const tok = (typeof token !== 'undefined' && token)
      || localStorage.getItem('sb_token')
      || localStorage.getItem('sb_access_token');
    const uid = (typeof userId !== 'undefined' && userId)
      || localStorage.getItem('sb_user_id');
    return { tok, uid };
  }

  function compressToJpegBlob(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (!w || !h) return reject(new Error('Neplatné rozměry obrázku'));
        if (w > MAX_DIM || h > MAX_DIM) {
          if (w >= h) { h = Math.round(h * (MAX_DIM / w)); w = MAX_DIM; }
          else        { w = Math.round(w * (MAX_DIM / h)); h = MAX_DIM; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('Komprese selhala')), 'image/jpeg', JPEG_Q);
      };
      img.onerror = () => reject(new Error('Nelze načíst obrázek'));
      img.src = src;
    });
  }

  async function uploadBlobToR2(blob) {
    const { tok } = getAuth();
    if (!tok) throw new Error('Nepřihlášen');
    if (blob.size > MAX_BYTES) throw new Error('Fotka je i po kompresi příliš velká (max 8 MB)');
    const fname = `listing_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    const res = await fetch(`${R2_WORKER}/v1/user-photo?filename=${encodeURIComponent(fname)}`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + tok, 'Content-Type': 'image/jpeg' },
      body: blob,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error('R2 upload ' + res.status + ' ' + t.slice(0, 120));
    }
    const data = await res.json().catch(() => ({}));
    if (!data.ok || !data.url) throw new Error('R2 nevrátil URL');
    return data.url;
  }

  async function fileToR2Url(file) {
    const objUrl = URL.createObjectURL(file);
    try { return await uploadBlobToR2(await compressToJpegBlob(objUrl)); }
    finally { URL.revokeObjectURL(objUrl); }
  }
  async function dataUrlToR2Url(dataUrl) {
    return await uploadBlobToR2(await compressToJpegBlob(dataUrl));
  }

  function isHttpUrl(s) { return typeof s === 'string' && /^https?:\/\//i.test(s); }
  function isDataUrl(s) { return typeof s === 'string' && s.startsWith('data:'); }

  function flashNote(stripId, text, color) {
    const strip = document.getElementById(stripId);
    if (!strip) return;
    let note = strip.parentNode.querySelector('.r2-note');
    if (!note) {
      note = document.createElement('div');
      note.className = 'r2-note';
      note.style.cssText = 'font-size:11px;margin-top:4px;min-height:14px;transition:opacity .2s';
      strip.parentNode.appendChild(note);
    }
    note.textContent = text || '';
    note.style.color = color || '#9aa';
    if (text && /✓|hotovo/i.test(text)) setTimeout(() => { if (note.textContent === text) note.textContent = ''; }, 2500);
  }

  function anyUploading(arr) {
    return Array.isArray(arr) && arr.some(p => p && typeof p === 'object' && p._uploading);
  }

  // Obecný "přidej soubory → R2" handler pro libovolné pole + render
  async function addFilesToArray(files, arr, renderFn, stripId) {
    if (!files || !files.length || !Array.isArray(arr)) return;
    for (const file of Array.from(files)) {
      const tempUrl = URL.createObjectURL(file);
      const slot = { src: tempUrl, mime: 'image/jpeg', _uploading: true };
      arr.push(slot);
      if (typeof renderFn === 'function') renderFn();
      flashNote(stripId, '📤 Nahrávám na R2…', '#f5c842');
      try {
        const url = await fileToR2Url(file);
        slot.src = url; slot._uploading = false;
        URL.revokeObjectURL(tempUrl);
        if (typeof renderFn === 'function') renderFn();
        flashNote(stripId, 'Hotovo ✓', '#4ade80');
      } catch (e) {
        const idx = arr.indexOf(slot);
        if (idx >= 0) arr.splice(idx, 1);
        URL.revokeObjectURL(tempUrl);
        if (typeof renderFn === 'function') renderFn();
        flashNote(stripId, 'Chyba: ' + (e.message || e), '#e88');
      }
    }
  }

  /* ── 1) KARTA ── */
  function installSalePhotos() {
    if (typeof window.renderSalePhotos !== 'function') return;
    window.handleSalePhotos = function (files) {
      return addFilesToArray(files, salePhotos, window.renderSalePhotos, 'salePhotosStrip');
    };
    window.handleSalePhotoDrop = function (e) {
      e.preventDefault();
      if (e.dataTransfer?.files) window.handleSalePhotos(e.dataTransfer.files);
    };
    window._aiAddPhotoToSalePhotos = async function (photoSrc) {
      if (!photoSrc) return;
      if (salePhotos.some(p => (p.src || p.croppedUrl) === photoSrc)) return;
      if (isHttpUrl(photoSrc)) { salePhotos.push({ src: photoSrc, mime: 'image/jpeg' }); window.renderSalePhotos(); return; }
      if (isDataUrl(photoSrc)) {
        const slot = { src: photoSrc, mime: 'image/jpeg', _uploading: true };
        salePhotos.push(slot); window.renderSalePhotos();
        flashNote('salePhotosStrip', '📤 Nahrávám na R2…', '#f5c842');
        try { slot.src = await dataUrlToR2Url(photoSrc); slot._uploading = false; window.renderSalePhotos(); flashNote('salePhotosStrip', 'Hotovo ✓', '#4ade80'); }
        catch (e) { const i = salePhotos.indexOf(slot); if (i>=0) salePhotos.splice(i,1); window.renderSalePhotos(); flashNote('salePhotosStrip', 'Chyba: '+(e.message||e), '#e88'); }
      }
    };
  }

  /* ── 2) PRODUKT / SEALED ── */
  function installProdPhotos() {
    window.handleProdPhotos = function (files) {
      if (typeof prodPhotos === 'undefined') return;
      const r = (typeof renderProdPhotoStrip === 'function') ? renderProdPhotoStrip : null;
      return addFilesToArray(files, prodPhotos, r, 'prodSalePhotosStrip');
    };
    window.handleProdPhotoDrop = function (e) {
      e.preventDefault();
      if (e.dataTransfer?.files) window.handleProdPhotos(e.dataTransfer.files);
    };
    const orig = window.submitProductListing;
    if (typeof orig === 'function') {
      window.submitProductListing = async function (...args) {
        const arr = (typeof prodPhotos !== 'undefined') ? prodPhotos : [];
        if (anyUploading(arr)) { alert('Počkej, fotky se ještě nahrávají na R2…'); return; }
        try { await flushBase64InArray(arr, 'prodSalePhotosStrip'); }
        catch (e) { alert('Nahrání fotky na R2 selhalo: ' + (e.message || e) + '\nNabídka nebyla odeslána.'); return; }
        const _sbReq = window.sbReq; let patched = false;
        window.sbReq = async function (path, method, body, tok) {
          if (!patched && method === 'POST' && /rest\/v1\/listings(\?|$)/.test(path)) {
            patched = true;
            const photos = (typeof prodPhotos !== 'undefined' ? prodPhotos : [])
              .map(p => (typeof p === 'string' ? p : (p.src || p.croppedUrl)))
              .filter(isHttpUrl).map(src => ({ src, mime: 'image/jpeg' }));
            if (photos.length && body && typeof body === 'object') body = { ...body, user_photos: photos };
          }
          return _sbReq.call(this, path, method, body, tok);
        };
        try { return await orig.apply(this, args); } finally { window.sbReq = _sbReq; }
      };
    }
  }

  /* ── 3) BULK ── */
  function installBulkPhotos() {
    window.handleBulkPhotos = function (files) {
      if (typeof bulkPhotos === 'undefined') return;
      const r = (typeof renderBulkPhotos === 'function') ? renderBulkPhotos : null;
      return addFilesToArray(files, bulkPhotos, r, 'bulkPhotosStrip');
    };
    window.handleBulkPhotoDrop = function (e) {
      e.preventDefault();
      e.currentTarget?.classList?.remove('drag-over');
      if (e.dataTransfer?.files) window.handleBulkPhotos(e.dataTransfer.files);
    };
    const orig = window.submitBulkListing;
    if (typeof orig === 'function') {
      window.submitBulkListing = async function (...args) {
        const arr = (typeof bulkPhotos !== 'undefined') ? bulkPhotos : [];
        if (anyUploading(arr)) { alert('Počkej, fotky se ještě nahrávají na R2…'); return; }
        try { await flushBase64InArray(arr, 'bulkPhotosStrip'); }
        catch (e) { alert('Nahrání fotky na R2 selhalo: ' + (e.message || e) + '\nNabídka nebyla odeslána.'); return; }
        return orig.apply(this, args);
      };
    }
  }

  // Záchranná síť: nahraj na R2 jakýkoli zbylý base64 v poli (např. album crop)
  async function flushBase64InArray(arr, stripId) {
    if (!Array.isArray(arr)) return;
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      const src = (typeof p === 'string') ? p : (p && (p.croppedUrl || p.src) || '');
      if (!isDataUrl(src)) continue;
      flashNote(stripId, '📤 Dokončuji nahrávání na R2…', '#f5c842');
      const url = await dataUrlToR2Url(src);
      if (typeof p === 'string') arr[i] = url;
      else arr[i] = { ...p, src: url, croppedUrl: undefined, base64: undefined, mime: 'image/jpeg' };
    }
  }

  function installCardSubmitGuard() {
    const orig = window.submitListing;
    if (typeof orig !== 'function') return;
    window.submitListing = async function (...args) {
      const arr = (typeof salePhotos !== 'undefined') ? salePhotos : [];
      if (anyUploading(arr)) { alert('Počkej, fotky se ještě nahrávají na R2…'); return; }
      try { await flushBase64InArray(arr, 'salePhotosStrip'); }
      catch (e) { alert('Nahrání fotky na R2 selhalo: ' + (e.message || e) + '\nNabídka nebyla odeslána.'); return; }
      return orig.apply(this, args);
    };
  }

  /* ── "📒 Z alba" pro BULK ── */
  let _rows = [], _sel = new Set();
  async function openBulkAlbumPicker() {
    const { tok, uid } = getAuth();
    if (!tok || !uid) { alert('Přihlas se.'); return; }
    const modal = document.getElementById('bulkAlbumModal') || buildModal();
    modal.style.display = 'flex';
    const grid = document.getElementById('bulkAlbumGrid');
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#9aa;padding:24px">Načítám fotky z alba…</div>';
    _sel.clear();
    try {
      const rows = await sbReq(`rest/v1/user_card_photos?user_id=eq.${uid}&order=created_at.desc&limit=500`, 'GET', null, tok);
      _rows = (Array.isArray(rows) ? rows : []).filter(r => (r.side === 'front' || !r.side) && isHttpUrl(r.url));
      if (!_rows.length) { grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#9aa;padding:24px">V albu nejsou žádné fotky karet.</div>'; return; }
      renderGrid();
    } catch (e) { grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#e88;padding:24px">Chyba: ' + (e.message || e) + '</div>'; }
  }
  function renderGrid() {
    const grid = document.getElementById('bulkAlbumGrid');
    grid.innerHTML = _rows.map((r, i) => {
      const s = _sel.has(i);
      return `<div onclick="window.__bulkAlbumToggle(${i})" style="position:relative;cursor:pointer;aspect-ratio:3/4;border-radius:8px;overflow:hidden;border:2px solid ${s ? '#4ade80' : 'transparent'}">
        <img src="${r.url}" style="width:100%;height:100%;object-fit:cover" loading="lazy">
        ${s ? '<div style="position:absolute;top:4px;right:4px;background:#4ade80;color:#000;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:900">✓</div>' : ''}
      </div>`;
    }).join('');
    const c = document.getElementById('bulkAlbumCount');
    if (c) c.textContent = _sel.size ? `${_sel.size} vybráno` : '';
  }
  window.__bulkAlbumToggle = function (i) { _sel.has(i) ? _sel.delete(i) : _sel.add(i); renderGrid(); };
  window.__bulkAlbumConfirm = function () {
    if (typeof bulkPhotos === 'undefined') { closeModal(); return; }
    let added = 0;
    _sel.forEach(i => { const r = _rows[i]; if (!r) return; if (!bulkPhotos.some(p => (p.src || p) === r.url)) { bulkPhotos.push({ src: r.url, mime: 'image/jpeg' }); added++; } });
    closeModal();
    if (typeof renderBulkPhotos === 'function') renderBulkPhotos();
    if (added) flashNote('bulkPhotosStrip', `Přidáno ${added} z alba ✓`, '#4ade80');
  };
  window.__bulkAlbumClose = closeModal;
  window.openBulkAlbumPicker = openBulkAlbumPicker;
  function closeModal() { const m = document.getElementById('bulkAlbumModal'); if (m) m.style.display = 'none'; }
  function buildModal() {
    const m = document.createElement('div');
    m.id = 'bulkAlbumModal';
    m.style.cssText = 'display:none;position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.7);align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(2px)';
    m.innerHTML =
      '<div style="background:#15182a;border:1px solid rgba(255,255,255,0.12);border-radius:16px;width:min(680px,96vw);max-height:88vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 16px 50px rgba(0,0,0,0.55)">' +
        '<div style="padding:16px 18px;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:space-between">' +
          '<div style="font-size:15px;font-weight:800;color:#e6e8f0">📒 Vyber karty z alba do bulku</div>' +
          '<div id="bulkAlbumCount" style="font-size:12px;color:#4ade80;font-weight:700"></div>' +
        '</div>' +
        '<div id="bulkAlbumGrid" style="padding:14px;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:8px;flex:1"></div>' +
        '<div style="padding:12px 16px;border-top:1px solid rgba(255,255,255,0.08);display:flex;gap:10px;justify-content:flex-end">' +
          '<button onclick="window.__bulkAlbumClose()" style="padding:8px 16px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:transparent;color:#cdd;cursor:pointer;font-size:13px">Zrušit</button>' +
          '<button onclick="window.__bulkAlbumConfirm()" style="padding:8px 18px;border-radius:8px;border:none;background:linear-gradient(135deg,#4ade80,#22c55e);color:#062a12;font-weight:800;cursor:pointer;font-size:13px">Přidat vybrané</button>' +
        '</div>' +
      '</div>';
    m.addEventListener('click', e => { if (e.target === m) closeModal(); });
    document.body.appendChild(m);
    return m;
  }
  function injectBulkAlbumButton() {
    const strip = document.getElementById('bulkPhotosStrip');
    if (!strip || document.getElementById('bulkAlbumBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'bulkAlbumBtn'; btn.type = 'button'; btn.textContent = '📒 Z alba';
    btn.onclick = openBulkAlbumPicker;
    btn.style.cssText = 'margin-bottom:8px;padding:6px 12px;border-radius:8px;border:1px solid rgba(74,222,128,0.3);background:rgba(74,222,128,0.12);color:#4ade80;font-size:12px;font-weight:700;cursor:pointer';
    strip.parentNode.insertBefore(btn, strip);
  }

  function init() {
    installSalePhotos();
    installProdPhotos();
    installBulkPhotos();
    installCardSubmitGuard();
    injectBulkAlbumButton();
    document.addEventListener('click', () => setTimeout(injectBulkAlbumButton, 100), true);
    console.log('[listing-photos-r2] aktivní — fotky nabídek jen na R2 (2000px/90%), base64 se neukládá.');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0));
  else setTimeout(init, 0);
})();
