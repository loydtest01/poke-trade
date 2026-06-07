/* ════════════════════════════════════════════════════════════════
   listing-preview.js
   Náhled nabídky před vystavením. „👁 Náhled nabídky →" otevře přehled
   (řádek v seznamu + detail), odkud jde Vystavit nebo Zpět na editaci.
   Načítat ZA marketplace.js.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function val(id){ const e=document.getElementById(id); return e ? e.value : ''; }
  function checked(id){ const e=document.getElementById(id); return e ? e.checked : false; }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  // Posbírá data z aktuálního formuláře (karta / produkt / bulk)
  function gather() {
    const tab = (typeof currentListingTab !== 'undefined') ? currentListingTab : 'card';
    const type = (typeof addType !== 'undefined') ? addType : null;

    // Fotky: official + sale (card), nebo bulkPhotos
    let photos = [];
    if (tab === 'bulk' && typeof bulkPhotos !== 'undefined') {
      photos = bulkPhotos.map(p => p.src).filter(Boolean);
    } else if (typeof salePhotos !== 'undefined') {
      photos = salePhotos.map(p => p.src).filter(Boolean);
    }
    const mainImg = photos[0]
      || (typeof addCardData !== 'undefined' && addCardData
          ? (addCardData.images?.large || addCardData.images?.small || addCardData.apiSmall || '')
          : '');

    let name, meta;
    if (tab === 'product') {
      name = val('prodSetName') || document.getElementById('prodSetName')?.textContent || 'Produkt';
      meta = (document.getElementById('prodSetMeta')?.textContent) || '';
    } else if (tab === 'bulk') {
      const cnt = val('bulkCount') || (typeof bulkPhotos!=='undefined'?bulkPhotos.length:'');
      name = 'Bulk' + (cnt ? ' — ' + cnt + ' karet' : '');
      meta = val('bulkSets') || '';
    } else {
      name = (typeof addCardData!=='undefined' && addCardData ? addCardData.name : '')
             || document.getElementById('addCardName')?.textContent || 'Karta';
      const setN = (typeof addCardData!=='undefined' && addCardData ? (addCardData.set?.name||'') : '');
      const num  = (typeof addCardData!=='undefined' && addCardData ? addCardData.number : '');
      meta = [setN, num?('#'+num):''].filter(Boolean).join(' · ');
    }

    return {
      tab, type, name, meta, mainImg, photos,
      price: parseInt(val('addPrice')) || null,
      cond: val('addCond') || 'NM',
      desc: (val('addDesc')||'').trim(),
      tradeWants: (val('addTradeWants')||'').trim(),
      location: (val('addLocation')||'').trim(),
      post: checked('addDeliveryPost'),
      personal: checked('addDeliveryPersonal'),
      seller: (typeof username !== 'undefined' ? username : 'Já'),
    };
  }

  function typeBadge(d){
    const sell = d.type==='sell'||d.type==='both';
    const trade= d.type==='trade'||d.type==='both';
    if (sell && trade) return '<span class="lp-badge" style="background:rgba(245,200,66,.16);color:#f5c842">Prodej i výměna</span>';
    if (trade) return '<span class="lp-badge" style="background:rgba(53,138,221,.16);color:#7bb3ef">Výměna</span>';
    return '<span class="lp-badge" style="background:rgba(74,222,128,.14);color:#5fd98a">Prodej</span>';
  }

  function priceHtml(d){
    if (d.price > 0) return '<span style="font-size:19px;font-weight:800;color:#f5c842">'+d.price.toLocaleString('cs')+' Kč</span>';
    return '<span style="font-size:16px;font-weight:700;color:#7bb3ef">Výměna</span>';
  }

  window.openListingPreview = function(){
    // Validace typu (stejně jako submit)
    if (typeof addType !== 'undefined' && !addType && (typeof currentListingTab==='undefined'||currentListingTab==='card')) {
      alert('Vyber prosím typ nabídky: Prodej, Výměna nebo Obojí.'); return;
    }
    const d = gather();

    // Řádek v seznamu
    const img = d.mainImg ? '<img src="'+esc(d.mainImg)+'" style="width:58px;height:81px;object-fit:cover;border-radius:8px;border:1px solid rgba(255,255,255,.12)">'
                          : '<div style="width:58px;height:81px;border-radius:8px;background:rgba(255,255,255,.05);display:flex;align-items:center;justify-content:center;font-size:22px">🃏</div>';
    document.getElementById('lpListRow').innerHTML =
      '<div style="display:flex;gap:14px;padding:14px;border:1px solid rgba(255,255,255,.08);border-radius:14px;background:rgba(255,255,255,.025);align-items:flex-start">'
      + img
      + '<div style="flex:1;min-width:0">'
        + '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
          + '<span style="font-size:15px;font-weight:800;color:#f0ece4">'+esc(d.name)+'</span>'
          + typeBadge(d)
          + '<span style="font-size:11px;padding:2px 7px;border-radius:6px;background:rgba(255,255,255,.06);color:#a7a2b3">'+esc(d.cond)+'</span>'
        + '</div>'
        + '<div style="margin-top:4px;font-size:12px;color:#8b8794">Prodejce: <b style="color:#f5c842">'+esc(d.seller)+'</b>'+(d.meta?' · '+esc(d.meta):'')+'</div>'
      + '</div>'
      + '<div style="text-align:right">'+priceHtml(d)+'</div>'
      + '</div>';

    // Detail
    const detImg = d.mainImg ? '<img src="'+esc(d.mainImg)+'" style="width:160px;border-radius:10px;border:1px solid rgba(255,255,255,.12);align-self:flex-start">'
                             : '<div style="width:160px;height:224px;border-radius:10px;background:rgba(255,255,255,.05);display:flex;align-items:center;justify-content:center;font-size:40px">🃏</div>';
    const extraPhotos = d.photos.length>1
      ? '<div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">'+d.photos.slice(1,6).map(p=>'<img src="'+esc(p)+'" style="width:46px;height:64px;object-fit:cover;border-radius:6px;border:1px solid rgba(255,255,255,.1)">').join('')+'</div>'
      : '';
    const delivery = [d.post?'📬 Poštou':'', d.personal?'🤝 Osobně':''].filter(Boolean).join(' · ');
    const tradeBlock = (d.type==='trade'||d.type==='both') && d.tradeWants
      ? '<div style="margin-top:10px;font-size:13px;color:#cbc6d4"><span style="color:#7bb3ef;font-weight:700">Výměnou chce:</span> '+esc(d.tradeWants)+'</div>' : '';

    document.getElementById('lpDetail').innerHTML =
      '<div style="display:flex;gap:18px;padding:18px;border:1px solid rgba(255,255,255,.08);border-radius:14px;background:rgba(255,255,255,.025)">'
      + '<div>'+detImg+extraPhotos+'</div>'
      + '<div style="flex:1">'
        + '<div style="font-size:20px;font-weight:800;color:#f0ece4">'+esc(d.name)+'</div>'
        + '<div style="font-size:13px;color:#8b8794;margin-bottom:10px">'+(d.meta?esc(d.meta)+' · ':'')+esc(d.cond)+'</div>'
        + '<div style="margin-bottom:10px">'+priceHtml(d)+'</div>'
        + (d.desc ? '<div style="font-size:13px;color:#cbc6d4;line-height:1.6;background:#15111e;border:1px solid rgba(255,255,255,.08);border-radius:9px;padding:12px">'+esc(d.desc)+'</div>'
                  : '<div style="font-size:12px;color:#5b5667;font-style:italic">(Bez popisu)</div>')
        + tradeBlock
        + (d.location?'<div style="margin-top:10px;font-size:12px;color:#8b8794">📍 '+esc(d.location)+'</div>':'')
        + (delivery?'<div style="margin-top:4px;font-size:12px;color:#8b8794">'+delivery+'</div>':'')
        + ((d.personal && window._pickupGeo)
            ? '<div id="lpPickupMap" style="height:200px;border-radius:10px;overflow:hidden;margin-top:10px;border:1px solid rgba(255,255,255,.1)"></div>'
              + '<button onclick="planRoute('+window._pickupGeo.lat+','+window._pickupGeo.lng+')" style="margin-top:8px;padding:8px 14px;border-radius:8px;border:1px solid rgba(245,200,66,.4);background:rgba(245,200,66,.12);color:#f5c842;font-weight:700;font-size:12px;cursor:pointer">🧭 Naplánovat trasu</button>'
            : '')
      + '</div>'
      + '</div>';

    // Vykreslit mapu v náhledu, pokud je osobní předání + souřadnice
    if (d.personal && window._pickupGeo && typeof window.renderPickupMap === 'function') {
      setTimeout(() => window.renderPickupMap('lpPickupMap', {
        pickup_lat: window._pickupGeo.lat,
        pickup_lng: window._pickupGeo.lng,
        pickup_precision: window._pickupGeo.precision
      }), 150);
    }

    document.getElementById('addModal').style.display = 'none';
    document.getElementById('listingPreviewModal').style.display = 'flex';
  };

  window.closeListingPreview = function(){
    document.getElementById('listingPreviewModal').style.display = 'none';
    document.getElementById('addModal').style.display = 'flex'; // zpět na editaci
  };

  window.confirmListingFromPreview = function(){
    document.getElementById('listingPreviewModal').style.display = 'none';
    if (typeof submitCurrentListing === 'function') submitCurrentListing();
  };

  // styl badge
  const css=document.createElement('style');
  css.textContent='.lp-badge{font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px}';
  document.head.appendChild(css);
})();
