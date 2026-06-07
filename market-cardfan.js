/* ════════════════════════════════════════════════════════════════
   market-cardfan.js
   - Card-fan náhled karet u BULKU (fotky leží přes sebe, levá navrchu,
     hover = karta vyjede nahoru, plynulý přejezd zleva doprava)
   - Watchlist (srdíčko) přes Supabase tabulku `watchlist`
   - Grid / Seznam přepínač (zprovoznění viewMode)
   Načítat AŽ ZA marketplace.js (přepisuje _renderSingleListing a renderListings).
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── Watchlist state ──────────────────────────────────────────
  const _watched = new Set();      // listing_id, které sleduju
  const _watchCount = {};          // listing_id -> počet sledujících

  async function loadWatchlist() {
    if (typeof userId === 'undefined' || !userId || !token) return;
    try {
      const res = await sbReq(`rest/v1/watchlist?user_id=eq.${userId}&select=listing_id`, 'GET', null, token);
      if (Array.isArray(res)) { _watched.clear(); res.forEach(r => _watched.add(r.listing_id)); }
    } catch (e) { console.warn('[watchlist] load', e); }
  }

  async function loadWatchCounts(ids) {
    if (!ids || !ids.length) return;
    try {
      const res = await sbReq('rest/v1/rpc/watch_counts', 'POST', { p_listing_ids: ids }, token || null);
      if (Array.isArray(res)) res.forEach(r => { _watchCount[r.listing_id] = Number(r.cnt) || 0; });
    } catch (e) { console.warn('[watchlist] counts', e); }
  }

  window.toggleWatch = async function (id, ev) {
    if (ev) ev.stopPropagation();
    if (typeof userId === 'undefined' || !userId || !token) {
      alert('Pro sledování se přihlas.');
      return;
    }
    const on = _watched.has(id);
    // optimistic UI
    if (on) { _watched.delete(id); _watchCount[id] = Math.max(0, (_watchCount[id] || 1) - 1); }
    else    { _watched.add(id);    _watchCount[id] = (_watchCount[id] || 0) + 1; }
    _refreshHeart(id);
    try {
      if (on) {
        await sbReq(`rest/v1/watchlist?user_id=eq.${userId}&listing_id=eq.${id}`, 'DELETE', null, token);
      } else {
        await sbReq('rest/v1/watchlist', 'POST', { user_id: userId, listing_id: id }, token);
      }
    } catch (e) {
      console.warn('[watchlist] toggle', e);
      // revert při chybě
      if (on) { _watched.add(id); _watchCount[id] = (_watchCount[id] || 0) + 1; }
      else    { _watched.delete(id); _watchCount[id] = Math.max(0, (_watchCount[id] || 1) - 1); }
      _refreshHeart(id);
    }
  };

  function _refreshHeart(id) {
    document.querySelectorAll(`.wl-heart[data-wl="${id}"]`).forEach(el => {
      const on = _watched.has(id);
      el.classList.toggle('on', on);
      el.querySelector('.wl-ico').textContent = on ? '♥' : '♡';
      const c = el.querySelector('.wl-cnt');
      if (c) c.textContent = _watchCount[id] || 0;
    });
    updateFavCount();
  }

  // ── Oblíbené: počet + přepínač zobrazení ─────────────────────
  function updateFavCount() {
    const b = document.getElementById('favCountBadge');
    if (b) b.textContent = _watched.size;
  }
  window._wlUpdateFavCount = updateFavCount;

  let _favView = false;
  window.toggleFavView = function () {
    _favView = !_favView;
    const btn = document.getElementById('favToggleBtn');
    if (btn) {
      btn.style.background = _favView ? '#ff5a78' : 'rgba(255,90,120,0.08)';
      btn.style.color = _favView ? '#fff' : '#ff7088';
    }
    if (typeof applyFilters === 'function') applyFilters();
    else if (typeof renderListings === 'function') renderListings();
  };
  window._isFavView = () => _favView;
  window._isWatched = (id) => _watched.has(id);

  function heartHTML(id) {
    const on = _watched.has(id);
    const cnt = _watchCount[id] || 0;
    return `<button class="wl-heart${on ? ' on' : ''}" data-wl="${id}" title="Sledovat nabídku"
      onclick="toggleWatch('${id}',event)">
      <span class="wl-ico">${on ? '♥' : '♡'}</span><span class="wl-cnt">${cnt}</span>
    </button>`;
  }
  window._wlHeartHTML = heartHTML;

  // ── Card-fan (bulk fotky přes sebe) ──────────────────────────
  // Vrátí pole URL fotek bulku z listingu.
  function bulkPhotoUrls(l) {
    const arr = l.user_photos || [];
    return arr.map(p => (typeof p === 'string' ? p : (p.src || p.url || p.croppedUrl || ''))).filter(Boolean);
  }

  // size: 'sm' (seznam) | 'lg' (mřížka)
  function fanHTML(urls, size) {
    if (!urls || !urls.length) return '';
    const w = size === 'lg' ? 60 : 50;
    const h = size === 'lg' ? 84 : 70;
    const step = size === 'lg' ? 24 : 20;
    const n = urls.length;
    const MAX = 8; // víc než 8 už nemá smysl, zbytek skryjeme jako "+N"
    const show = urls.slice(0, MAX);
    const extra = n - show.length;
    const cards = show.map((u, i) => `
      <div class="fan-card" style="left:${i * step}px;z-index:${n - i}"
           onmouseenter="this.style.zIndex=99" onmouseleave="this.style.zIndex=${n - i}">
        <img src="${esc(u)}" alt="" loading="lazy"
          style="width:${w}px;height:${h}px;object-fit:cover;border-radius:6px;border:1.5px solid rgba(255,255,255,0.25);background:#1c1726;display:block">
      </div>`).join('');
    const plus = extra > 0
      ? `<div class="fan-more" style="left:${show.length * step}px;height:${h}px;width:${w}px;z-index:0">+${extra}</div>`
      : '';
    const totalW = (show.length - (extra > 0 ? 0 : 1)) * step + w;
    return `<div class="fan-wrap" style="position:relative;height:${h + 16}px;width:${totalW}px;max-width:100%">${cards}${plus}</div>`;
  }
  window._bulkFanHTML = (l, size) => fanHTML(bulkPhotoUrls(l), size);

  // ── Override bulk render: použij card-fan místo placeholderu ──
  const _origSingle = window._renderSingleListing;
  window._renderSingleListing = function (l) {
    // Necháme původní render proběhnout
    let html = _origSingle(l);

    // Vlož srdíčko do .listing-right (před první dítě) — jen mimo MY_LISTINGS_MODE
    if (!MY_LISTINGS_MODE) {
      html = html.replace('<div class="listing-right">',
        `<div class="listing-right"><div class="wl-row">${heartHTML(l.id)}</div>`);
    }

    // U bulku: za .listing-meta přidej card-fan náhled, pokud jsou fotky
    if (l.listing_type === 'bulk') {
      const fan = fanHTML(bulkPhotoUrls(l), 'sm');
      if (fan) {
        const block = `<div class="bulk-fan"><div class="fan-label">Obsah bulku:</div>${fan}</div>`;
        // Vlož PŘED první výskyt .listing-tags (toleruje libovolný whitespace)
        html = html.replace(/(<div class="listing-tags">)/, block + '$1');
      }
    }
    return html;
  };

  // ── Grid view ────────────────────────────────────────────────
  function gridCard(l) {
    const cards = l.cards_data || [];
    const first = cards[0] || {};
    const isBulk = l.listing_type === 'bulk';
    const isProduct = l.listing_type === 'product';
    const img = l.api_image_url || first.imageUrl || first.apiSmall || (first.images && first.images.small) || '';
    const name = isBulk ? (l.title || 'Bulk karet') : (l.card_name || first.name || l.title || 'Karta');
    const num = l.card_number || first.number || '';
    const price = l.price_czk;
    const isTrade = l.allow_trade;
    const cond = l.card_condition || 'NM';

    let visual;
    if (isBulk) {
      const fan = fanHTML(bulkPhotoUrls(l), 'lg');
      visual = fan || `<div class="grid-bulk-ph">${l.bulk_count ? l.bulk_count + '×' : '🎲'}<small>BULK</small></div>`;
    } else if (img) {
      visual = `<img src="${esc(img)}" alt="${esc(name)}" loading="lazy" style="height:130px;border-radius:8px;border:1px solid rgba(255,255,255,0.12);${isProduct ? 'object-fit:contain' : ''}">`;
    } else {
      visual = `<div class="grid-bulk-ph">${isProduct ? '📦' : '🃏'}</div>`;
    }

    const badge = isBulk
      ? '<span class="tag" style="background:rgba(167,139,250,0.16);color:#b9a6f7;border-color:rgba(167,139,250,0.3)">Bulk</span>'
      : isProduct
        ? '<span class="tag tag-product">📦 ' + esc(l.product_type_label || 'Produkt') + '</span>'
        : isTrade && !(price > 0)
          ? '<span class="tag tag-trade">Výměna</span>'
          : '<span class="tag tag-sell">Prodej</span>';

    const priceHtml = price > 0
      ? `<span class="grid-price">${price.toLocaleString('cs')} Kč</span>`
      : `<span class="grid-price trade">Výměna</span>`;

    return `<div class="grid-card" onclick="openDetail('${esc(l.id)}')">
      <div class="grid-visual">
        ${visual}
        <span class="grid-badge">${badge}</span>
        ${!MY_LISTINGS_MODE ? `<span class="grid-heart">${heartHTML(l.id)}</span>` : ''}
      </div>
      <div class="grid-body">
        <div class="grid-name">${esc(name)}${num ? ' · #' + esc(num) : ''}</div>
        <div class="grid-seller">Prodejce: <b>${esc(l.username || '?')}</b>
          ${!isBulk && !isProduct ? `<span class="grid-cond">${esc(cond)}</span>` : ''}</div>
        <div class="grid-foot">
          ${priceHtml}
          <div class="grid-acts">
            ${price > 0 ? `<button class="btn-buy" onclick="event.stopPropagation();openDetail('${esc(l.id)}')">Koupit</button>` : ''}
            <button class="btn-offer" onclick="event.stopPropagation();openDetail('${esc(l.id)}')">Nabídnout</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  // Přepiš renderListings tak, aby respektoval grid režim.
  // POZN: `viewMode` v marketplace.js je `let` (není na window), proto si
  // držíme vlastní stav _gridView, který přepíná setViewMode override.
  let _gridView = false;
  const _origRender = window.renderListings;
  window.renderListings = function () {
    if (!_gridView) { return _origRender(); }

    // GRID režim — vlastní vykreslení
    const wrap = document.getElementById('listingsWrap');
    if (!typeof filteredListings!=="undefined"&&filteredListings || !filteredListings.length) {
      wrap.innerHTML = '<div class="empty-state"><div class="icon">🔍</div><h3>Žádné nabídky</h3><p>Zkus jiné filtry nebo hledání.</p></div>';
      return;
    }
    wrap.innerHTML = `<div class="grid-wrap">${filteredListings.map(gridCard).join('')}</div>`;
  };

  // ── setViewMode: zavolej re-render po přepnutí ───────────────
  const _origSetView = window.setViewMode;
  window.setViewMode = function (mode) {
    _gridView = (mode === 'grid');
    if (typeof _origSetView === 'function') _origSetView(mode);
    else {
      document.getElementById('vtList')?.classList.toggle('act', mode === 'list');
      document.getElementById('vtGrid')?.classList.toggle('act', mode === 'grid');
    }
    if (typeof renderListings === 'function') renderListings();
  };

  // ── Hook do načítání: po loadu listingů dotáhni watchlist ────
  // marketplace.js volá applyFilters() na konci loadListings.
  // Obalíme applyFilters tak, aby při prvním běhu doplnil watchlist data.
  let _wlReady = false;
  const _origApply = window.applyFilters;
  window.applyFilters = function () {
    const r = _origApply ? _origApply.apply(this, arguments) : undefined;
    // Filtr "jen oblíbené" — aplikuje se na filteredListings po standardních filtrech
    if (_favView && Array.isArray(window.filteredListings || filteredListings)) {
      try {
        filteredListings = filteredListings.filter(l => _watched.has(l.id));
        if (typeof renderListings === 'function') _origRender ? _origRender() : renderListings();
      } catch (e) { console.warn('[fav filter]', e); }
    }
    if (!_wlReady && Array.isArray(allListings) && allListings.length) {
      _wlReady = true;
      const ids = allListings.map(l => l.id).filter(Boolean);
      Promise.all([loadWatchlist(), loadWatchCounts(ids)]).then(() => {
        ids.forEach(_refreshHeart);
        updateFavCount();
        if (typeof renderListings === 'function') renderListings();
      });
    }
    updateFavCount();
    return r;
  };

  // ── Styly ────────────────────────────────────────────────────
  const css = document.createElement('style');
  css.textContent = `
  .fan-card{position:absolute;top:8px;transition:transform .22s cubic-bezier(.34,1.4,.5,1);cursor:pointer}
  .fan-card:hover{transform:translateY(-13px) scale(1.06)}
  .fan-wrap:hover .fan-card{filter:brightness(.78)}
  .fan-wrap .fan-card:hover{filter:brightness(1.08)}
  .fan-more{position:absolute;top:8px;display:flex;align-items:center;justify-content:center;
    border-radius:6px;border:1.5px dashed rgba(255,255,255,0.25);background:rgba(255,255,255,0.05);
    color:#cbc6d4;font-weight:700;font-size:13px}
  .bulk-fan{margin:6px 0 2px}
  .fan-label{font-size:11px;color:var(--text3,#6f6a7d);margin-bottom:4px}

  .wl-row{display:flex;justify-content:flex-end;margin-bottom:4px}
  .wl-heart{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:20px;
    border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.04);color:#a7a2b3;
    font-size:12px;cursor:pointer;transition:all .15s;line-height:1}
  .wl-heart:hover{border-color:rgba(255,90,120,0.5);color:#ff7088}
  .wl-heart.on{border-color:rgba(255,90,120,0.55);background:rgba(255,90,120,0.12);color:#ff5a78}
  .wl-heart .wl-ico{font-size:13px}

  /* GRID */
  .grid-wrap{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
  .grid-card{border:1px solid rgba(255,255,255,0.08);border-radius:14px;background:rgba(255,255,255,0.025);
    overflow:hidden;display:flex;flex-direction:column;cursor:pointer;transition:transform .14s,border-color .14s}
  .grid-card:hover{transform:translateY(-2px);border-color:rgba(245,200,66,0.35)}
  .grid-visual{position:relative;background:#15111e;padding:14px;display:flex;justify-content:center;
    align-items:center;min-height:130px}
  .grid-badge{position:absolute;top:10px;left:10px}
  .grid-heart{position:absolute;top:10px;right:10px}
  .grid-bulk-ph{display:flex;flex-direction:column;align-items:center;justify-content:center;
    font-size:26px;font-weight:800;color:#b9a6f7;gap:2px}
  .grid-bulk-ph small{font-size:10px;letter-spacing:1px;color:#8e8a98}
  .grid-body{padding:11px 13px;display:flex;flex-direction:column;gap:6px;flex:1}
  .grid-name{font-size:14px;font-weight:600;color:#f0ece4;line-height:1.3}
  .grid-seller{font-size:12px;color:#8e8a98}
  .grid-seller b{color:#f5c842}
  .grid-cond{margin-left:6px;font-size:10px;padding:1px 6px;border-radius:5px;background:rgba(255,255,255,0.06);color:#a7a2b3}
  .grid-foot{margin-top:auto;display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:6px;flex-wrap:wrap}
  .grid-price{font-size:16px;font-weight:700;color:#f0ece4}
  .grid-price.trade{color:#7bb3ef;font-size:14px}
  .grid-acts{display:flex;gap:6px}
  `;
  document.head.appendChild(css);

})();
