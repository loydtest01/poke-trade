/* ════════════════════════════════════════════════════════════════
   price-compare.js
   Záložka „Porovnání cen" v marketu. Najde kartu v PokéDB → vizuální
   výběr → porovná ceny z eBay (přes Worker /v1/market-compare, jen Buy
   Now, BEZ aukcí) + odkazy do Cardmarket/TCGPlayer/eBay/PriceCharting.
   Načítat ZA marketplace.js.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const PCDB = 'https://pokedb-api.poketrade.workers.dev/v1';
  const EUR_TO_CZK = 25; // orientační kurz pro zobrazení v Kč
  let _selectedCard = null;

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
  function czk(eur){ return Math.round(eur * EUR_TO_CZK).toLocaleString('cs') + ' Kč'; }

  // ── 1) Najdi kartu v PokéDB ──────────────────────────────────
  window.cmpSearchCards = async function () {
    const name = (document.getElementById('cmpName')?.value || '').trim();
    const num  = (document.getElementById('cmpNumber')?.value || '').trim();
    const pick = document.getElementById('cmpCardPick');
    const res  = document.getElementById('cmpCardResults');
    if (!name && !num) { return; }
    pick.style.display = '';
    res.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:12px">Hledám karty…</div>';
    let q = '/cards?limit=16';
    if (name) q += '&q=' + encodeURIComponent(name);
    if (num)  q += '&number=' + encodeURIComponent(num);
    try {
      const r = await fetch(PCDB + q);
      const d = await r.json();
      const cards = d.data || d || [];
      if (!cards.length) { res.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:12px">Nic nenalezeno.</div>'; return; }
      res.innerHTML = cards.map((c, i) => {
        const img = c.image_small || c.images?.small || c.imageUrl || '';
        const setN = c.set_name || c.set?.name || '';
        return `<div onclick="cmpSelectCard(${i})" data-cmp-idx="${i}" class="cmp-card" style="flex-shrink:0;width:108px;cursor:pointer;text-align:center">
          <img src="${esc(img)}" style="width:100%;border-radius:8px;border:2px solid transparent" loading="lazy">
          <div style="font-size:11px;font-weight:700;margin-top:5px;color:var(--text)">${esc(c.name)}</div>
          <div style="font-size:10px;color:var(--text3)">${esc(setN)}${c.number?' · #'+esc(c.number):''}</div>
        </div>`;
      }).join('');
      window._cmpCards = cards;
    } catch (e) {
      res.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:12px">Chyba hledání.</div>';
    }
  };

  // ── 2) Vyber kartu vizuálně ──────────────────────────────────
  window.cmpSelectCard = function (idx) {
    const c = (window._cmpCards || [])[idx];
    if (!c) return;
    _selectedCard = c;
    document.querySelectorAll('.cmp-card img').forEach(im => im.style.borderColor = 'transparent');
    const el = document.querySelector(`.cmp-card[data-cmp-idx="${idx}"] img`);
    if (el) el.style.borderColor = '#f5c842';
    document.getElementById('cmpFilters').style.display = 'flex';
    cmpRunCompare();
  };

  // ── 3) Porovnej ceny ─────────────────────────────────────────
  window.cmpRunCompare = async function () {
    if (!_selectedCard) return;
    const c = _selectedCard;
    const out = document.getElementById('cmpResults');
    out.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:16px;text-align:center">Načítám ceny z obchodů…</div>';

    const sort   = document.getElementById('cmpSort')?.value || 'price';
    const cond   = document.getElementById('cmpCond')?.value || '';
    const region = document.getElementById('cmpRegion')?.value || '';
    const max    = document.getElementById('cmpMax')?.value || '';

    let q = '/market-compare?q=' + encodeURIComponent(c.name);
    if (c.number) q += '&number=' + encodeURIComponent(c.number);
    q += '&sort=' + sort;
    if (cond)   q += '&condition=' + cond;
    if (region) q += '&region=' + region;
    if (max)    q += '&max=' + encodeURIComponent(max);

    let data;
    try {
      const r = await fetch(PCDB + q);
      data = await r.json();
    } catch (e) {
      out.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:16px">Chyba při načítání cen.</div>';
      return;
    }

    const img = c.image_small || c.images?.small || c.imageUrl || '';
    const setN = c.set_name || c.set?.name || '';
    let html = '';

    // Vybraná karta
    html += `<div style="display:flex;gap:12px;align-items:center;padding:12px;background:rgba(245,200,66,.07);border:1px solid rgba(245,200,66,.2);border-radius:12px;margin-bottom:14px">
      <img src="${esc(img)}" style="width:46px;border-radius:6px">
      <div style="flex:1"><div style="font-size:14px;font-weight:800;color:var(--text)">${esc(c.name)} · ${esc(setN)}${c.number?' #'+esc(c.number):''}</div>
      <div style="font-size:11px;color:var(--text3)">Porovnání cen napříč obchody</div></div>
    </div>`;

    // eBay výsledky
    if (data.ebay_available && data.items && data.items.length) {
      html += `<div style="font-size:11px;color:var(--text3);margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px;display:flex;align-items:center;gap:6px">
        <span style="width:8px;height:8px;border-radius:50%;background:#4ade80;display:inline-block"></span> eBay — živé nabídky (Buy Now)</div>`;
      html += '<div style="display:flex;flex-direction:column;gap:8px">';
      html += data.items.map(it => {
        const fb = it.seller && it.seller.feedback_pct != null
          ? ` · ⭐ ${it.seller.feedback_pct}%${it.seller.feedback_count?' ('+it.seller.feedback_count+')':''}` : '';
        const loc = it.location ? ` · ${it.location}` : '';
        const shipTxt = it.shipping_eur > 0 ? ` + ${it.shipping_eur}€ doprava` : ' · doprava zdarma';
        return `<div style="display:flex;gap:10px;align-items:center;padding:10px 12px;border:1px solid var(--border);border-radius:11px;background:rgba(255,255,255,.025)">
          <img src="${esc(it.image)}" style="width:38px;height:53px;object-fit:cover;border-radius:5px">
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(it.title)}</div>
            <div style="font-size:11px;color:var(--text3)">${esc(it.condition||'')}${loc}${fb}${shipTxt}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:15px;font-weight:800;color:var(--text)">${czk(it.total_eur)}</div>
            <div style="font-size:10px;color:var(--text3)">${it.total_eur} €</div>
            <a href="${esc(it.url)}" target="_blank" rel="noopener" style="font-size:11px;color:#74b4ff;text-decoration:none">Otevřít →</a>
          </div>
        </div>`;
      }).join('');
      html += '</div>';
    } else {
      html += `<div style="font-size:13px;color:var(--text3);padding:12px;background:rgba(255,255,255,.03);border-radius:10px;margin-bottom:8px">
        ${data.note ? esc(data.note) : 'eBay nabídky se nepodařilo načíst.'}</div>`;
    }

    // Odkazy do obchodů
    const links = data.shop_links || {};
    html += `<div style="font-size:11px;color:var(--text3);margin:18px 0 8px;text-transform:uppercase;letter-spacing:.5px">Hledat dál v obchodech</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${links.cardmarket ? `<a href="${esc(links.cardmarket)}" target="_blank" rel="noopener" class="cmp-shop">🟦 Cardmarket →</a>`:''}
        ${links.tcgplayer ? `<a href="${esc(links.tcgplayer)}" target="_blank" rel="noopener" class="cmp-shop">🟧 TCGPlayer →</a>`:''}
        ${links.ebay ? `<a href="${esc(links.ebay)}" target="_blank" rel="noopener" class="cmp-shop">🔍 eBay (vše) →</a>`:''}
        ${links.pricecharting ? `<a href="${esc(links.pricecharting)}" target="_blank" rel="noopener" class="cmp-shop">📊 PriceCharting →</a>`:''}
      </div>
      <div style="font-size:11px;color:var(--text3);margin-top:12px;line-height:1.5">
        💡 Ceny z eBay živě (přepočet ~${EUR_TO_CZK} Kč/€, vč. dopravy). Hodnocení = % kladných + počet recenzí prodejce. Aukce se nezobrazují. Facebook nelze (blokuje).
      </div>`;

    out.innerHTML = html;
  };

  // styly
  const css = document.createElement('style');
  css.textContent = '.cmp-shop{padding:9px 14px;border-radius:9px;border:1px solid var(--border);background:rgba(255,255,255,.04);color:var(--text2);font-weight:700;font-size:12px;text-decoration:none}.cmp-shop:hover{border-color:rgba(245,200,66,.4);color:var(--yellow)}';
  document.head.appendChild(css);
})();
