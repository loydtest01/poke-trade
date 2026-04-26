
// ── TCG Proxy Helper ─────────────────────────────────────────────
// Přesměruje api.pokemontcg.io → Supabase Edge Function (X-Api-Key bezpečně na serveru)
// Lokální název _MKT_TCG_PROXY zabraňuje konfliktu s případnou const _TCG_PROXY v app.js
var _MKT_TCG_PROXY = 'https://xrduqwrinzvmpixgmqta.supabase.co/functions/v1/tcg-proxy';
function tcgFetch(url) {
  const m = url.match(/api\.pokemontcg\.io\/v2\/([^?]+)(\?.*)?$/);
  if (!m) return fetch(url);
  const segment = m[1]; const qs = m[2] || '';
  const idM = segment.match(/^cards\/(.+)$/);
  if (idM) return fetch(_MKT_TCG_PROXY+'?id='+encodeURIComponent(idM[1]));
  const p = new URLSearchParams(qs.replace(/^\?/,'')); p.set('path', segment);
  return fetch(_MKT_TCG_PROXY+'?'+p.toString());
}
// ─────────────────────────────────────────────────────────────────
// SUPABASE_URL a SUPABASE_ANON jsou načteny z app.js

async function sbReq(path, method='GET', body=null, token=null) {
  const headers = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON,
    'Authorization': 'Bearer ' + (token || SUPABASE_ANON),
  };
  if (['POST','PATCH','DELETE'].includes(method) && !path.startsWith('auth/'))
    headers['Prefer'] = 'return=representation';
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined
    });
  } catch (netErr) {
    return { _err: 'Síťová chyba: ' + (netErr.message || 'fetch selhal') };
  }
  const text = await res.text().catch(() => '');
  let data = {};
  if (text) {
    try { data = JSON.parse(text); }
    catch (parseErr) {
      // Server vrátil ne-JSON (např. HTML chybovou stránku)
      if (!res.ok) return { _err: 'HTTP ' + res.status + ': ' + text.slice(0, 100) };
      return { _err: 'Neplatný JSON v odpovědi' };
    }
  }
  if (!res.ok) {
    // 401/403 = token vyčerpán/neplatný → vyčisti session
    if (res.status === 401 || res.status === 403) {
      // Pouze pokud uživatel přišel o session (ne když chybí klíč pro RLS na public listing)
      if (token && data.message && /jwt|expired|invalid/i.test(data.message)) {
        localStorage.removeItem('sb_token');
        try { window.dispatchEvent(new CustomEvent('sb:auth-expired')); } catch(_){}
      }
    }
    return { _err: data.message || data.error || 'HTTP '+res.status };
  }
  return data;
}

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Auth ──────────────────────────────────────────────────────
let token=null, userId=null, username=null, myCards=[];

(function initAuth(){
  const sbUser = (() => { try { return JSON.parse(localStorage.getItem('sb_user')||'null'); } catch { return null; } })();
  token  = localStorage.getItem('sb_token');
  userId = sbUser?.id;
  username = sbUser?.user_metadata?.username || sbUser?.email?.split('@')[0] || '';
  if (token && userId) {
    document.getElementById('userChip').style.display='';
    document.getElementById('loginLink').style.display='none';
    document.getElementById('logoutBtn').style.display='';
    document.getElementById('userName').textContent=username;
    document.getElementById('userAvatar').textContent=(username[0]||'?').toUpperCase();
    // Load avatar from localStorage
    (function(){
      try {
        var av=localStorage.getItem('pkc_avatar_local');
        var el=document.getElementById('userAvatar');
        if(av&&el){el.textContent='';el.style.backgroundImage='url('+av+')';el.style.backgroundSize='cover';el.style.backgroundPosition='center';}
      } catch(e){}
    })();
    loadMyCards();
  }
})();

function doLogout(){
  ['sb_token','sb_user','sb_refresh_token','sb_user_id'].forEach(k=>localStorage.removeItem(k));
  location.href='login.html';
}

async function loadMyCards(){
  if(!token||!userId) return;
  const res = await sbReq(`rest/v1/user_cards?user_id=eq.${userId}&select=local_id,card_data,for_trade`,'GET',null,token);
  if(Array.isArray(res)) myCards = res.map(r=>({...r.card_data,id:r.local_id,for_trade:r.for_trade}));
}

// ── State ─────────────────────────────────────────────────────
let allListings=[], filteredListings=[], currentListing=null;
let viewMode='list', addType='sell', addCardData=null;
let salePhotos=[];
let tradeViewMode='img', selectedTradeIds=new Set();

// ── Load listings ─────────────────────────────────────────────
const MY_LISTINGS_MODE = new URLSearchParams(location.search).get('my') === '1';

(async function loadListings(){
  document.getElementById('listingsWrap').innerHTML =
    Array(5).fill('<div class="skeleton-row"></div>').join('');

  // Správa inzerátů — načti i reserved/sold vlastní inzeráty
  let url = MY_LISTINGS_MODE && userId
    ? `rest/v1/listings?user_id=eq.${userId}&select=*&order=created_at.desc&limit=200`
    : 'rest/v1/listings?status=eq.active&select=*&order=created_at.desc&limit=100';

  const res = await sbReq(url, 'GET', null, MY_LISTINGS_MODE ? token : null);
  if(!Array.isArray(res) || res._err){
    document.getElementById('listingsWrap').innerHTML =
      '<div class="empty-state"><div class="icon">⚠️</div><h3>Chyba načítání</h3></div>';
    return;
  }
  allListings = res;

  if (MY_LISTINGS_MODE) {
    // Aktivuj banner
    const banner = document.getElementById('myListingsBanner');
    banner.style.display = 'flex';
    document.getElementById('navMyListings')?.classList.add('active');
    document.querySelector('a[href="marketplace.html"]')?.classList.remove('active');
  }

  applyFilters();
})();

// ── Advanced filter state ─────────────────────────────────────
let advFilterData = {};
let advFilterActive = false;

function toggleAdvFilter() {
  const panel = document.getElementById('advFilterPanel');
  const btn   = document.getElementById('advFilterBtn');
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  btn.classList.toggle('active', !isOpen);
}

function applyAdvancedFilter() {
  advFilterData = {
    name:   (document.getElementById('afName')?.value||'').trim().toLowerCase(),
    set:    (document.getElementById('afSet')?.value||'').trim().toLowerCase(),
    number: (document.getElementById('afNumber')?.value||'').trim().toLowerCase(),
    type:   (document.getElementById('afType')?.value||'').trim().toLowerCase(),
    rarity: (document.getElementById('afRarity')?.value||'').trim().toLowerCase(),
    cond:   (document.getElementById('afCond')?.value||'').trim(),
  };
  advFilterActive = Object.values(advFilterData).some(v => v !== '');
  const badge = document.getElementById('advFilterActiveBadge');
  if (badge) badge.style.display = advFilterActive ? '' : 'none';
  applyFilters();
}

function clearAdvancedFilter() {
  ['afName','afSet','afNumber','afUrl'].forEach(id => {
    const el = document.getElementById(id); if(el) el.value = '';
  });
  ['afType','afRarity','afCond'].forEach(id => {
    const el = document.getElementById(id); if(el) el.selectedIndex = 0;
  });
  const prev = document.getElementById('afUrlPreview');
  if(prev) prev.style.display = 'none';
  advFilterData = {};
  advFilterActive = false;
  const badge = document.getElementById('advFilterActiveBadge');
  if(badge) badge.style.display = 'none';
  applyFilters();
}

function clearAllFilters() {
  // Typ položek → obě checkboxy zaškrtnuty
  ['itCards','itSealed'].forEach(id => { const el = document.getElementById(id); if(el) el.checked = true; });
  currentItemType = 'all';
  // Typ nabídky
  ['fSell','fTrade'].forEach(id => { const el = document.getElementById(id); if(el) el.checked = true; });
  // Cena
  ['fPriceMin','fPriceMax'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
  // Stav karty — vše zaškrtnuto
  ['fNM','fLP','fMP','fHP'].forEach(id => { const el = document.getElementById(id); if(el) el.checked = true; });
  // Elementy — vše zaškrtnuto
  ['fNormal','fFire','fWater','fElec','fGrass','fIce','fFighting','fPoison','fGround','fFlying','fPsychic','fBug','fRock','fGhost','fDragon','fDark','fMetal','fFairy'].forEach(id => { const el = document.getElementById(id); if(el) el.checked = true; });
  // Vzácnost — vše zaškrtnuto
  ['fCommon','fRare','fUltra'].forEach(id => { const el = document.getElementById(id); if(el) el.checked = true; });
  // Vyhledávání
  const si = document.getElementById('searchInput'); if(si) si.value = '';
  // Pokročilý filtr
  clearAdvancedFilter();
}

async function importFromUrl() {
  const url = (document.getElementById('afUrl')?.value||'').trim();
  if (!url) return;
  const preview = document.getElementById('afUrlPreview');
  const content = document.getElementById('afUrlPreviewContent');
  preview.style.display = '';
  content.innerHTML = '<span style="color:var(--blue)">⏳ Načítám...</span>';
  try {
    let name = '', setName = '', number = '';
    if (url.includes('pokemontcg.io')) {
      const idMatch = url.match(/cards\/([a-zA-Z0-9]+-[a-zA-Z0-9]+)/);
      if (idMatch) {
        const res  = await tcgFetch('https://api.pokemontcg.io/v2/cards/' + idMatch[1]);
        const json = await res.json();
        if (json.data) {
          name    = json.data.name || '';
          setName = json.data.set?.name || '';
          number  = json.data.number || '';
        }
      } else {
        const qMatch = url.match(/[?&]q=([^&]+)/);
        if (qMatch) {
          const q = decodeURIComponent(qMatch[1]);
          const nameM = q.match(/name:"?([^"&]+)"?/i); if(nameM) name = nameM[1];
          const setM  = q.match(/set\.name:"?([^"&]+)"?/i); if(setM) setName = setM[1];
        }
      }
    } else if (url.includes('cardmarket.com')) {
      const parts    = url.replace(/\/$/, '').split('/');
      const cardSlug = parts[parts.length - 1];
      const setSlug  = parts[parts.length - 2];
      let cleanSlug = cardSlug
        .replace(/[_-][a-z]{1,3}\d+[A-Z]?\d{3,4}$/i, '')  // JP kód: -s10D007
        .replace(/[_-][A-Za-z]{2,5}\d{2,4}$/i, '')          // EN kód: -CEL005, -PR003
        .replace(/-\d{2,4}$/, '')                            // čisté číslo: -014
        .replace(/[_-](V\d+|SR|CHR|HR|UR|CSR|SAR|AR|Secret|Rainbow|RR|PR|K)$/i, ''); // varianta: -V1
      name    = cleanSlug.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
      setName = setSlug.replace(/-and-/gi,' & ').replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
    }
    if (name || setName) {
      if (name)    document.getElementById('afName').value   = name;
      if (setName) document.getElementById('afSet').value    = setName;
      if (number)  document.getElementById('afNumber').value = number;
      content.innerHTML = '✅ Extrahováno: <strong>' + esc(name) + '</strong>' + (setName ? ' · ' + esc(setName) : '') + (number ? ' #' + esc(number) : '');
      applyAdvancedFilter();
    } else {
      content.innerHTML = '<span style="color:var(--red)">Karta nenalezena v URL. Zkus URL přímo na kartičku.</span>';
    }
  } catch(e) {
    content.innerHTML = '<span style="color:var(--red)">Chyba: ' + esc(e.message) + '</span>';
  }
}

function updateSidebarCounts(baseListings) {
  const c = { sell:0, trade:0, NM:0, LP:0, MP:0, HP:0, cards:0, sealed:0 };
  baseListings.forEach(l => {
    if (l.allow_trade === false || l.price_czk > 0) c.sell++;
    if (l.allow_trade === true) c.trade++;
    const cond = l.card_condition || 'NM';
    if      (cond==='NM')             c.NM++;
    else if (cond==='LP')             c.LP++;
    else if (cond==='MP')             c.MP++;
    else if (cond==='HP'||cond==='D') c.HP++;
    if ((l.listing_type || 'card') === 'product') c.sealed++; else c.cards++;
  });
  const upd = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = val;
    el.classList.toggle('has-val', val > 0);
  };
  upd('sbCountSell',   c.sell);
  upd('sbCountTrade',  c.trade);
  upd('sbCountNM',     c.NM);
  upd('sbCountLP',     c.LP);
  upd('sbCountMP',     c.MP);
  upd('sbCountHP',     c.HP);
  upd('sbCountCards',  c.cards);
  upd('sbCountSealed', c.sealed);
}

// ── Filters + Sort ────────────────────────────────────────────
function applyFilters(){
  // Also update demands if in demand mode
  if (typeof marketMode !== 'undefined' && marketMode === 'demand' && typeof applyDemandFilters === 'function') {
    applyDemandFilters();
  }
  const q       = (document.getElementById('searchInput').value||'').toLowerCase();
  const fSell   = document.getElementById('fSell').checked;
  const fTrade  = document.getElementById('fTrade').checked;
  const fNM     = document.getElementById('fNM').checked;
  const fLP     = document.getElementById('fLP').checked;
  const fMP     = document.getElementById('fMP').checked;
  const fHP     = document.getElementById('fHP').checked;
  const prMin   = parseFloat(document.getElementById('fPriceMin').value)||0;
  const prMax   = parseFloat(document.getElementById('fPriceMax').value)||Infinity;

  // Element filters — všechny zaškrtnuté = zobraz vše
  const ALL_EL_IDS = ['fNormal','fFire','fWater','fElec','fGrass','fIce','fFighting','fPoison','fGround','fFlying','fPsychic','fBug','fRock','fGhost','fDragon','fDark','fMetal','fFairy'];
  const elFilters = [];
  if(document.getElementById('fNormal')?.checked)   elFilters.push('colorless','normal');
  if(document.getElementById('fFire')?.checked)     elFilters.push('fire');
  if(document.getElementById('fWater')?.checked)    elFilters.push('water');
  if(document.getElementById('fElec')?.checked)     elFilters.push('lightning','electric');
  if(document.getElementById('fGrass')?.checked)    elFilters.push('grass');
  if(document.getElementById('fIce')?.checked)      elFilters.push('ice');
  if(document.getElementById('fFighting')?.checked) elFilters.push('fighting');
  if(document.getElementById('fPoison')?.checked)   elFilters.push('poison');
  if(document.getElementById('fGround')?.checked)   elFilters.push('ground');
  if(document.getElementById('fFlying')?.checked)   elFilters.push('flying');
  if(document.getElementById('fPsychic')?.checked)  elFilters.push('psychic');
  if(document.getElementById('fBug')?.checked)      elFilters.push('bug');
  if(document.getElementById('fRock')?.checked)     elFilters.push('rock');
  if(document.getElementById('fGhost')?.checked)    elFilters.push('ghost');
  if(document.getElementById('fDragon')?.checked)   elFilters.push('dragon');
  if(document.getElementById('fDark')?.checked)     elFilters.push('darkness','dark');
  if(document.getElementById('fMetal')?.checked)    elFilters.push('metal','steel');
  if(document.getElementById('fFairy')?.checked)    elFilters.push('fairy');
  // Všechny zaškrtnuté = žádný filtr; none = žádný filtr (nesmysl); jinak filtruj
  const checkedElCount = ALL_EL_IDS.filter(id => document.getElementById(id)?.checked).length;
  const anyEl = checkedElCount === 0 || checkedElCount === ALL_EL_IDS.length;

  const af = advFilterData || {};

  // Base match: text search + advanced filter (without sidebar checkboxes)
  function matchesBase(l) {
    const cards = l.cards_data || [];
    const hasName = cards.some(c =>
      (c.name||'').toLowerCase().includes(q) ||
      (c.set ||'').toLowerCase().includes(q)
    ) || (l.username||'').toLowerCase().includes(q) ||
      (l.card_name||'').toLowerCase().includes(q) ||
      (l.title||'').toLowerCase().includes(q);
    if(q && !hasName) return false;

    if(af.name) {
      const n = (l.card_name||(cards[0]?.name)||'').toLowerCase();
      if(!n.includes(af.name)) return false;
    }
    if(af.set) {
      const s = (l.card_set||(cards[0]?.set)||'').toLowerCase();
      if(!s.includes(af.set)) return false;
    }
    if(af.number) {
      const num = (l.card_number||(cards[0]?.number)||'').toLowerCase();
      if(!num.includes(af.number)) return false;
    }
    if(af.type) {
      const t = (l.card_type||'').toLowerCase();
      if(!t.includes(af.type)) return false;
    }
    if(af.rarity) {
      const r = (l.card_rarity||(cards[0]?.rarity)||'').toLowerCase();
      if(!r.includes(af.rarity)) return false;
    }
    if(af.cond) {
      if((l.card_condition||'NM') !== af.cond) return false;
    }
    // Item type filter (Karty / Sealed)
    const ltype = l.listing_type || 'card';
    if(currentItemType === 'card'    && ltype !== 'card')    return false;
    if(currentItemType === 'product' && ltype !== 'product') return false;

    return true;
  }

  // Compute base (for sidebar counts) — text + advanced, no sidebar checkboxes
  const baseListings = allListings.filter(matchesBase);
  updateSidebarCounts(baseListings);

  filteredListings = baseListings.filter(l => {
    const isSell  = l.allow_trade === false || l.price_czk > 0;
    const isTrade = l.allow_trade === true;
    if(!fSell  && isSell && !isTrade) return false;
    if(!fTrade && isTrade && !isSell) return false;

    const cond = l.card_condition || 'NM';
    if(!fNM && cond==='NM') return false;
    if(!fLP && cond==='LP') return false;
    if(!fMP && cond==='MP') return false;
    if(!fHP && (cond==='HP'||cond==='D')) return false;

    const price = l.price_czk||0;
    if(price > 0 && (price < prMin || price > prMax)) return false;

    if(!anyEl) {
      const type = (l.card_type||'').toLowerCase();
      if(!elFilters.some(e => type.includes(e))) return false;
    }

    return true;
  });

  // Sort
  const sort = document.getElementById('sortSel').value;
  if(sort==='price_asc')  filteredListings.sort((a,b)=>(a.price_czk||0)-(b.price_czk||0));
  if(sort==='price_desc') filteredListings.sort((a,b)=>(b.price_czk||0)-(a.price_czk||0));
  if(sort==='offers')     filteredListings.sort((a,b)=>(b.offer_count||0)-(a.offer_count||0));

  document.getElementById('countInfo').textContent = filteredListings.length + ' nabídek';
  _syncSidebarToAdvDropdowns();
  renderListings();
}

function renderListings(){
  // Album compare filter — remove cards already in the selected album
  if (activeCompareAlbumId) {
    const albumNames = albumCardsCache[activeCompareAlbumId];
    if (albumNames) {
      filteredListings = filteredListings.filter(l => {
        if (l.listing_type === 'product') return true;
        const cardName = (l.card_name || (l.cards_data?.[0]?.name) || '').toLowerCase();
        return !cardName || !albumNames.has(cardName);
      });
      const bannerCount = document.getElementById('compareBannerCount');
      const badge = document.getElementById('acBadge');
      if (bannerCount) bannerCount.textContent = `· ${filteredListings.length} nabídek s kartami, které nemáš`;
      if (badge) { badge.textContent = filteredListings.length; badge.style.display = filteredListings.length ? '' : 'none'; }
    }
  }

  const wrap = document.getElementById('listingsWrap');
  if(!filteredListings.length){
    wrap.innerHTML='<div class="empty-state"><div class="icon">🔍</div><h3>Žádné nabídky</h3><p>Zkus jiné filtry nebo hledání.</p></div>';
    return;
  }

  // Aktualizuj počet v banneru správy
  if (MY_LISTINGS_MODE) {
    const cnt = document.getElementById('myListingsCount');
    if (cnt) cnt.textContent = `${filteredListings.length} inzerátů`;
  }

  wrap.innerHTML = filteredListings.map(l => {
    const cards = l.cards_data||[];
    const first = cards[0]||{};
    const img   = l.api_image_url || first.imageUrl || first.apiSmall || first.images?.small || '';
    const name  = l.card_name || first.name || l.title || 'Neznámá karta';
    const set   = l.card_set  || first.set  || '';
    const num   = l.card_number|| first.number||first.num||'';
    const cond  = l.card_condition||'NM';
    const isTrade = l.allow_trade;
    const price   = l.price_czk;

    const condColor = cond==='NM'?'tag-cond':cond==='LP'?'tag-warn':'tag-warn';

    return `<div class="listing-row" onclick="openDetail('${esc(l.id)}')">
      <div class="card-thumb" style="${l.listing_type==='product'?'background:rgba(168,85,247,0.08);border-color:rgba(168,85,247,0.2)':''}">
        ${img
          ? `<img src="${esc(img)}" alt="${esc(name)}" loading="lazy" style="${l.listing_type==='product'?'object-fit:contain;padding:4px':''}">`
          : l.listing_type==='product'
            ? `<div class="card-thumb-placeholder" style="font-size:24px">📦</div>`
            : `<div class="card-thumb-placeholder">${esc(name)}</div>`}
      </div>
      <div class="listing-info">
        <div class="listing-title">${esc(name)}${num?' · #'+esc(num):''}</div>
        <div class="listing-meta">
          <span>Prodejce: <a class="seller-link" href="profile.html?user=${encodeURIComponent(l.user_id||''  )}" onclick="event.stopPropagation()">${esc(l.username||'?')}</a></span>
          ${set?`<span>${esc(set)}</span>`:''}
          <span>${timeAgo(l.created_at)}</span>
        </div>
        <div class="listing-tags">
          ${l.listing_type==='product' ? '<span class="tag tag-product">📦 '+esc(l.product_type_label||'Produkt')+'</span>' : ''}
          ${price>0 && l.listing_type!=='product' ? '<span class="tag tag-sell">Prodej</span>' : ''}
          ${price>0 && l.listing_type==='product' ? '<span class="tag tag-sell">Prodej</span>' : ''}
          ${isTrade  ? '<span class="tag tag-trade">Výměna</span>' : ''}
          ${l.listing_type==='product' ? '<span class="tag tag-sealed">'+(l.product_sealed_cond==='sealed'?'🔒 Sealed':l.product_sealed_cond==='damaged'?'⚠️ Poškozený obal':'📂 Otevřený')+'</span>' : ''}
          ${l.listing_type==='product' && l.product_lang ? '<span class="tag tag-lang">'+esc(l.product_lang)+'</span>' : ''}
          ${l.listing_type!=='product' ? '<span class="tag '+condColor+'">'+esc(cond)+'</span>' : ''}
        </div>
      </div>
      <div class="listing-right">
        ${price>0
          ? `<div class="price-big">${price.toLocaleString('cs')} Kč<small>~ ${(p25=>(p25<1?p25.toFixed(2):p25<10?p25.toFixed(1):p25.toFixed(0)))(price/25)} €</small></div>`
          : `<div class="price-trade">Výměna</div>`}
        ${MY_LISTINGS_MODE ? `
          <div class="my-listing-status-badge status-${esc(l.status||'active')}">
            ${ l.status==='reserved' ? '🔒 Rezervováno: '+esc(l.reserved_by_username||'?')
             : l.status==='sold'     ? '✅ Prodáno'
             : '🟢 Aktivní' }
          </div>
          <div class="action-btns" style="flex-direction:column;gap:5px">
            <button class="btn-offer" onclick="event.stopPropagation();openDetail('${esc(l.id)}')">✏️ Detail</button>
            ${l.status==='reserved' ? `
              <button class="btn-trade-sm" style="border-color:rgba(74,222,128,0.4);color:#4ade80" onclick="event.stopPropagation();quickConfirmSale('${esc(l.id)}')">✅ Prodáno</button>
              <button class="btn-trade-sm" style="border-color:rgba(245,200,66,0.35);color:#f5c842" onclick="event.stopPropagation();quickRelist('${esc(l.id)}')">↩️ Znovu</button>
            ` : l.status==='active' ? `
              <button class="btn-trade-sm" style="border-color:rgba(255,80,80,0.35);color:#ff6060" onclick="event.stopPropagation();quickCancel('${esc(l.id)}')">🗑️ Zrušit</button>
            ` : ''}
          </div>
        ` : `
          <div class="offer-count">${l.offer_count||0} nabídek</div>
          <div class="action-btns">
            ${price>0 ? `<button class="btn-buy" onclick="event.stopPropagation();openDetail('${esc(l.id)}')">Koupit</button>` : ''}
            <button class="btn-offer" onclick="event.stopPropagation();openDetail('${esc(l.id)}')">Nabídnout</button>
            ${isTrade ? `<button class="btn-trade-sm" onclick="event.stopPropagation();openDetail('${esc(l.id)}')">Vyměnit</button>` : ''}
          </div>
        `}
      </div>
    </div>`;
  }).join('');
}

function timeAgo(iso){
  if(!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff/60000);
  if(m<60)   return m+'m';
  if(m<1440) return Math.floor(m/60)+'h';
  return Math.floor(m/1440)+'d';
}

// ── View mode ─────────────────────────────────────────────────
function setViewMode(mode){
  viewMode=mode;
  document.getElementById('vtList').classList.toggle('act',mode==='list');
  document.getElementById('vtGrid').classList.toggle('act',mode==='grid');
}

function showList(){
  document.getElementById('listView').style.display='';
  document.getElementById('detailView').classList.remove('show');
  currentListing=null;
}

// ── Detail ────────────────────────────────────────────────────
async function openDetail(id){
  currentListing = allListings.find(l=>l.id===id);
  if(!currentListing) return;
  const l = currentListing;
  const cards = l.cards_data||[];
  const first = cards[0]||{};
  const name  = l.card_name||first.name||l.title||'?';
  const set   = l.card_set||first.set||'';
  const num   = l.card_number||first.number||first.num||'';
  const cond  = l.card_condition||'NM';
  const isTrade = l.allow_trade;
  const price   = l.price_czk;

  document.getElementById('listView').style.display='none';
  document.getElementById('detailView').classList.add('show');
  document.getElementById('breadTitle').textContent=name;
  document.getElementById('dTitle').textContent=name;
  const sellerUrl = `profile.html?user=${encodeURIComponent(l.user_id||'')}`;
  document.getElementById('dSeller').innerHTML=`Prodejce: <a class="seller-link" href="${sellerUrl}">${esc(l.username||'?')}</a><span id="dSellerStars" class="seller-stars-inline"></span> · ${timeAgo(l.created_at)} · ${l.view_count||0} zobrazení`;
  loadSellerRating(l.user_id);

  // Price
  if(price>0){
    document.getElementById('dPrice').textContent=price.toLocaleString('cs')+' Kč';
    const eurVal = price/25; document.getElementById('dPriceEur').textContent='~ '+(eurVal<1?eurVal.toFixed(2):eurVal<10?eurVal.toFixed(1):eurVal.toFixed(0))+' €';
    const pt = first.pTrend;
    if(pt>0) document.getElementById('dTrend').innerHTML='Trend: <span>'+Number(pt).toFixed(2)+' €</span>';
  } else {
    document.getElementById('dPrice').textContent='Výměna';
    document.getElementById('dPrice').style.color='var(--blue)';
  }

  // Tags
  document.getElementById('dTags').innerHTML=`
    ${price>0?'<span class="tag tag-sell">💰 Prodej</span>':''}
    ${isTrade?'<span class="tag tag-trade">🔄 Výměna</span>':''}
    <span class="tag tag-cond">${esc(cond)}</span>
    ${first.rarity?`<span class="tag tag-cond">${esc(first.rarity)}</span>`:''}`;

  // Meta
  document.getElementById('dMeta').innerHTML=[
    ['HP',      first.hp||l.card_hp||'—'],
    ['Číslo',   num||'—'],
    ['Typ',     (first.types||[]).join(', ')||first.type||l.card_type||'—'],
    ['Série',   set||'—'],
    ['Stav',    cond],
    ['Vzácnost',first.rarity||l.card_rarity||'—'],
  ].map(([label,val])=>`
    <div class="meta-row">
      <div class="meta-label">${label}</div>
      <div class="meta-val">${esc(String(val))}</div>
    </div>`).join('');

  // Description
  const descEl=document.getElementById('dDesc');
  const descText = l.condition_description || l.description || '';
  if(descText){ descEl.textContent=descText; descEl.style.display=''; }
  else descEl.style.display='none';

  // Buttons — owner / buyer / reserved logic
  const isOwner    = !!(userId && l.user_id === userId);
  const isReserved = l.status === 'reserved';
  const reservedForMe = isReserved && userId && l.reserved_by_user_id === userId;
  const reservedForOther = isReserved && !reservedForMe && !isOwner;

  // Skryj celý detail pokud ji někdo jiný rezervoval (není vlastník ani rezervující)
  if (reservedForOther) {
    showList();
    showMktToast('⚠️ Tato karta je právě rezervována pro jiného uživatele.');
    return;
  }

  document.getElementById('dBtnBuy').style.display = (!isOwner && !isReserved && price>0) ? '' : 'none';
  if(price>0) document.getElementById('dBtnBuy').textContent='Koupit za '+price.toLocaleString('cs')+' Kč';
  document.getElementById('dBtnTrade').style.display = (!isOwner && !isReserved && isTrade) ? '' : 'none';

  // Owner panel
  const ownerEl = document.getElementById('ownerActions');
  ownerEl.style.display = isOwner ? 'flex' : 'none';
  if (isOwner) {
    document.getElementById('dBtnOffer').style.display = 'none';
    document.getElementById('dBtnMsg').style.display   = 'none';
    document.getElementById('dBtnBuy').style.display   = 'none';
    document.getElementById('dBtnTrade').style.display = 'none';
    // Pokud je rezervováno — změň tlačítka
    document.getElementById('ownerBtnSold').style.display   = isReserved ? '' : 'none';
    document.getElementById('ownerBtnRelist').style.display = isReserved ? '' : 'none';
    document.getElementById('ownerBtnMarkSold').style.display = isReserved ? 'none' : '';
    // Edit jen když není rezervováno (změna ceny po rezervaci by buyera mátla)
    const editBtn = document.getElementById('ownerBtnEdit');
    if (editBtn) editBtn.style.display = isReserved ? 'none' : '';
    document.getElementById('ownerBtnCancel').style.display   = isReserved ? 'none' : '';
    if (isReserved) {
      document.getElementById('ownerReservedInfo').style.display = '';
      document.getElementById('ownerReservedText').textContent = `🔒 Rezervováno pro: ${esc(l.reserved_by_username||'?')}`;
    } else {
      document.getElementById('ownerReservedInfo').style.display = 'none';
    }
  }

  // Buyer reserved state
  document.getElementById('reservedForMeBanner').style.display = reservedForMe ? '' : 'none';
  document.getElementById('dBtnOffer').style.display = (isOwner || reservedForMe) ? 'none' : '';
  document.getElementById('dBtnMsg').style.display   = isOwner ? 'none' : '';

  // Trade wants - show tags + compute matches
  currentTradeMatches = new Set();
  const wantsBox = document.getElementById('tradeWantsBox');
  const wantsTags = document.getElementById('tradeWantsTags');
  if(isTrade && l.trade_wants){
    const keywords = parseTradeWants(l.trade_wants);
    wantsTags.innerHTML = keywords.map(k=>`<span class="trade-want-tag">${esc(k)}</span>`).join('');
    wantsBox.style.display='';
    currentTradeMatches = computeTradeMatches(keywords, myCards);
  } else {
    wantsBox.style.display='none';
  }

  // Gallery — API image first, then user photos
  buildGallery(l, first);

  // Trade cards — load my tradeable cards
  buildTradeCards();

  // Messages
  document.getElementById('msgHead').textContent='Zprávy s '+l.username;
  loadMessages(l);

  // Close open panels
  ['offerPanel','tradePanel','msgPanel'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) { el.classList.remove('show'); el.style.display=''; }
  });
  document.getElementById('msgPanel').classList.remove('show');

  // Increment view count silently
  if (!userId || l.user_id !== userId) {
    sbReq(`rest/v1/rpc/increment_view_count`,'POST',{listing_uuid:l.id});
  }
}

function buildGallery(l, firstCard){
  const apiImg = l.api_image_url || firstCard?.images?.large || firstCard?.images?.small || firstCard?.imageUrl || firstCard?.apiSmall || '';
  // Načti reálné fotky prodejce uložené při vystavení
  const photos = (l.user_photos || []).map(p => (typeof p === 'string' ? p : (p.src || p.croppedUrl || ''))).filter(Boolean);

  const allImgs = [apiImg, ...photos].filter(Boolean);
  const mainEl  = document.getElementById('galleryMain');
  const thumbsEl= document.getElementById('galleryThumbs');

  if(allImgs.length){
    mainEl.innerHTML=`<img src="${esc(allImgs[0])}" id="mainGalleryImg" style="width:100%;height:100%;object-fit:contain;cursor:zoom-in" onclick="openCardZoom(0)" title="Klikni pro detail se lupou">`;
  } else {
    mainEl.innerHTML=`<div style="text-align:center;color:var(--text3);padding:20px"><div style="font-size:40px;margin-bottom:8px">🃏</div>${esc(firstCard?.name||'?')}</div>`;
  }

  thumbsEl.innerHTML = allImgs.map((src,i)=>
    `<div class="gallery-thumb ${i===0?'act':''}" onclick="setGalleryImg('${esc(src)}',${i})" ondblclick="openCardZoom(${i})" title="2× klik → detail se lupou">
      <img src="${esc(src)}" loading="lazy">
    </div>`
  ).join('') + (allImgs.length===0?'':'');
}

let _galleryActiveIdx = 0;   // tracks which thumb is active

function setGalleryImg(src, idx){
  const img = document.getElementById('mainGalleryImg');
  if(img) {
    img.src = src;
    img.onclick = () => openCardZoom(idx);   // always open the right photo
  }
  _galleryActiveIdx = idx;
  document.querySelectorAll('.gallery-thumb').forEach((t,i)=>t.classList.toggle('act',i===idx));
}

// ── Trade match detection ─────────────────────────────────────
let currentTradeMatches = new Set();

function parseTradeWants(text){
  if(!text) return [];
  return text.split(/[,;|/\n]+/)
    .map(s=>s.trim())
    .filter(s=>s.length>1);
}

function computeTradeMatches(keywords, cards){
  const matched = new Set();
  if(!keywords.length || !cards.length) return matched;
  const lkw = keywords.map(k=>k.toLowerCase());
  cards.forEach(c=>{
    const cardStr = [
      c.name||'', c.set||'',
      (c.types||[]).join(' '),
      c.supertype||'', c.rarity||''
    ].join(' ').toLowerCase();
    const isMatch = lkw.some(k=>{
      if(k.length < 3) return false;
      if(cardStr.includes(k)) return true;
      // Pokud keyword je delší, zkus začátek
      const nameLc = (c.name||'').toLowerCase();
      if(nameLc.startsWith(k.substring(0,4))) return true;
      return false;
    });
    if(isMatch) matched.add(String(c.id));
  });
  return matched;
}

function buildTradeCards(){
  const tradeCards = myCards.filter(c=>c.for_trade);
  const imgWrap  = document.getElementById('tradeCardsImg');
  const listWrap = document.getElementById('tradeCardsList');
  const matchSec = document.getElementById('tradeMatchSection');
  const matchWrap= document.getElementById('tradeMatchCards');

  // Build match section
  const matchCards = tradeCards.filter(c=>currentTradeMatches.has(String(c.id)));
  if(matchCards.length && matchSec){
    matchSec.style.display='';
    matchWrap.innerHTML = matchCards.map(c=>{
      const img=c.images?.small||c.apiSmall||c.imageUrl||'';
      const sel=selectedTradeIds.has(String(c.id));
      return `<div class="trade-card-item match ${sel?'sel':''}" onclick="toggleTradeCard('${esc(String(c.id))}')" title="${esc(c.name||'?')}">
        ${img?`<img src="${esc(img)}" alt="${esc(c.name||'')}">`:esc(c.name||'?')}
      </div>`;
    }).join('');
  } else if(matchSec){
    matchSec.style.display='none';
  }

  // Non-match trade cards
  const otherCards = tradeCards.filter(c=>!currentTradeMatches.has(String(c.id)));
  const labelEl = document.getElementById('tradeOtherLabel');
  if(labelEl) labelEl.style.display = (matchCards.length && otherCards.length) ? '' : (tradeCards.length ? '' : 'none');

  if(!tradeCards.length){
    imgWrap.innerHTML='<div class="trade-no-match">Nemáte žádné karty označené k výměně.<br><a href="moje-album.html" style="color:var(--blue)">Označte je v Moje album →</a></div>';
    listWrap.innerHTML='';
    return;
  }

  const displayCards = otherCards.length ? otherCards : tradeCards;
  imgWrap.innerHTML = displayCards.map(c=>{
    const img=c.images?.small||c.apiSmall||c.imageUrl||'';
    const sel=selectedTradeIds.has(String(c.id));
    const isMatch=currentTradeMatches.has(String(c.id));
    return `<div class="trade-card-item ${sel?'sel':''} ${isMatch?'match':''}" onclick="toggleTradeCard('${esc(String(c.id))}')" title="${esc(c.name||'?')}">
      ${img?`<img src="${esc(img)}" alt="${esc(c.name||'')}">`:esc(c.name||'?')}
    </div>`;
  }).join('');
  listWrap.innerHTML = tradeCards.map(c=>
    `<label class="trade-list-item">
      <input type="checkbox" ${selectedTradeIds.has(String(c.id))?'checked':''} onchange="toggleTradeCard('${esc(String(c.id))}')">
      ${currentTradeMatches.has(String(c.id))?'<span style="color:var(--blue)">★ </span>':''}
      ${esc(c.name||'?')} · ${esc(c.set||'')} ${c.number||c.num?'#'+(c.number||c.num):''}
    </label>`
  ).join('');
}

function toggleTradeCard(id){
  if(selectedTradeIds.has(id)) selectedTradeIds.delete(id);
  else selectedTradeIds.add(id);
  buildTradeCards();
}

function setTradeView(mode){
  tradeViewMode=mode;
  document.getElementById('tvImg').classList.toggle('act',mode==='img');
  document.getElementById('tvList').classList.toggle('act',mode==='list');
  document.getElementById('tradeCardsImg').style.display=mode==='img'?'flex':'none';
  document.getElementById('tradeCardsList').classList.toggle('show',mode==='list');
}

function togglePanel(id){
  const panels=['offerPanel','tradePanel'];
  panels.forEach(p=>{
    const el=document.getElementById(p);
    if(el){el.classList.remove('show'); el.style.display='';}
  });
  const msgEl=document.getElementById('msgPanel');
  const target=document.getElementById(id);
  if(id==='msgPanel'){
    const show=!msgEl.classList.contains('show');
    msgEl.classList.toggle('show',show);
  } else {
    if(target) target.classList.toggle('show');
    msgEl.classList.remove('show');
  }
}

// ── Actions ───────────────────────────────────────────────────
async function doBuy(){
  if(!token){ showMktToast('🔒 Pro rezervaci se přihlas.'); return; }
  if(!currentListing) return;
  if(userId && currentListing.user_id === userId){ showMktToast('⚠️ Nemůžeš koupit vlastní inzerát.'); return; }
  const name = currentListing.card_name || 'kartu';
  const priceStr = currentListing.price_czk ? currentListing.price_czk.toLocaleString('cs') + ' Kč' : '';
  if(!confirm(`Rezervovat ${name}${priceStr?' za '+priceStr:''}?\n\nKarta bude skryta pro ostatní. Domluv se s prodejcem na předání — pak prodejce potvrdí prodej nebo kartu znovu vystaví.`)) return;
  const res = await sbReq(`rest/v1/listings?id=eq.${currentListing.id}`, 'PATCH', {
    status: 'reserved',
    reserved_by_user_id: userId,
    reserved_by_username: username,
    reserved_at: new Date().toISOString()
  }, token);
  if(res && res._err){ showMktToast('❌ Chyba rezervace: '+res._err); return; }
  currentListing = { ...currentListing, status:'reserved', reserved_by_user_id: userId, reserved_by_username: username };
  showMktToast('🔒 Rezervováno! Napiš prodejci a domluvte se.');
  document.getElementById('dBtnBuy').style.display = 'none';
  document.getElementById('dBtnTrade').style.display = 'none';
  document.getElementById('dBtnOffer').style.display = 'none';
  document.getElementById('reservedForMeBanner').style.display = '';
  // Automaticky otevři chat
  setTimeout(() => openChat(), 300);
}

async function sendOffer(){
  if(!token){ showMktToast('🔒 Přihlas se pro odeslání nabídky.'); return; }
  if(userId && currentListing?.user_id === userId){ showMktToast('⚠️ Nemůžeš si sám sobě navrhovat cenu.'); return; }
  const price = parseInt(document.getElementById('offerPrice').value)||0;
  const msg   = document.getElementById('offerMsg').value.trim();
  if(!price && !msg){ showMktToast('⚠️ Zadej cenu nebo zprávu.'); return; }
  const l = currentListing;
  // Rezervuj kartu
  const patch = await sbReq(`rest/v1/listings?id=eq.${l.id}`, 'PATCH', {
    status: 'reserved',
    reserved_by_user_id: userId,
    reserved_by_username: username,
    reserved_at: new Date().toISOString()
  }, token);
  if(patch && patch._err){ showMktToast('❌ Chyba rezervace: '+patch._err); return; }
  currentListing = { ...currentListing, status:'reserved', reserved_by_user_id: userId, reserved_by_username: username };
  // Ulož nabídku
  const res = await sbReq('rest/v1/offers','POST',{
    listing_id: l.id,
    seller_id:  l.user_id,
    buyer_id:   userId,
    buyer_username: username,
    offer_type: 'price',
    offered_price_czk: price||null,
    message: msg||null,
    status: 'pending',
  },token);
  if(res._err){ showMktToast('❌ Chyba: '+res._err); return; }
  togglePanel('offerPanel');
  document.getElementById('dBtnBuy').style.display = 'none';
  document.getElementById('dBtnTrade').style.display = 'none';
  document.getElementById('dBtnOffer').style.display = 'none';
  document.getElementById('reservedForMeBanner').style.display = '';
  showMktToast('💸 Nabídka odeslána! Karta je rezervována.');
  var _price = price, _msg = msg;
  setTimeout(() => openChat(_price, _msg, 'price', null), 300);
}

async function sendTrade(){
  if(!token){ showMktToast('🔒 Přihlas se pro odeslání výměny.'); return; }
  if(userId && currentListing?.user_id === userId){ showMktToast('⚠️ Nemůžeš si sám sobě navrhovat výměnu.'); return; }
  const selCards = myCards.filter(c=>selectedTradeIds.has(String(c.id)));
  if(!selCards.length){ showMktToast('⚠️ Vyber alespoň jednu kartu k výměně.'); return; }
  const l=currentListing;
  // Rezervuj kartu
  const patch = await sbReq(`rest/v1/listings?id=eq.${l.id}`, 'PATCH', {
    status: 'reserved',
    reserved_by_user_id: userId,
    reserved_by_username: username,
    reserved_at: new Date().toISOString()
  }, token);
  if(patch && patch._err){ showMktToast('❌ Chyba rezervace: '+patch._err); return; }
  currentListing = { ...currentListing, status:'reserved', reserved_by_user_id: userId, reserved_by_username: username };
  // Ulož nabídku výměny
  const res = await sbReq('rest/v1/offers','POST',{
    listing_id: l.id,
    seller_id:  l.user_id,
    buyer_id:   userId,
    buyer_username: username,
    offer_type: 'trade',
    trade_card_ids: selCards.map(c=>String(c.id)),
    trade_card_names: selCards.map(c=>c.name).join(', '),
    message: document.getElementById('tradeMsg').value||null,
    status: 'pending',
  },token);
  if(res._err){ showMktToast('❌ Chyba: '+res._err); return; }
  togglePanel('tradePanel');
  selectedTradeIds.clear();
  document.getElementById('dBtnBuy').style.display = 'none';
  document.getElementById('dBtnTrade').style.display = 'none';
  document.getElementById('dBtnOffer').style.display = 'none';
  document.getElementById('reservedForMeBanner').style.display = '';
  showMktToast('🔄 Výměna navržena! Karta je rezervována.');
  var _cards = selCards.map(c => c.name).join(', ');
  var _msg   = document.getElementById('tradeMsg').value.trim() || null;
  setTimeout(() => openChat(null, _msg, 'trade', _cards), 300);
}

// ── Messages ──────────────────────────────────────────────────
let msgPolling=null;

async function loadMessages(l){
  if(!token||!userId) return;
  const res = await sbReq(
    `rest/v1/messages?listing_id=eq.${l.id}&order=created_at.asc&limit=50`,
    'GET',null,token
  );
  if(!Array.isArray(res)) return;
  const list=document.getElementById('msgList');
  if(!res.length){
    list.innerHTML='<div style="font-size:12px;color:var(--text3);text-align:center;padding:8px">Zatím žádné zprávy. Buďte první!</div>';
    return;
  }
  list.innerHTML=res.map(m=>`
    <div class="msg-bbl ${m.sender_id===userId?'me':'them'}">
      ${m.sender_id!==userId?`<div style="font-size:10px;color:var(--text3);margin-bottom:3px">${esc(m.sender_username||'?')}</div>`:''}
      ${esc(m.text)}
    </div>`).join('');
  list.scrollTop=list.scrollHeight;
}

async function sendMsg(){
  if(!token){ alert('Přihlas se pro odesílání zpráv.'); return; }
  const inp=document.getElementById('msgInput');
  const text=inp.value.trim();
  if(!text||!currentListing) return;
  const l=currentListing;
  const res=await sbReq('rest/v1/messages','POST',{
    listing_id:       l.id,
    sender_id:        userId,
    receiver_id:      l.user_id,
    sender_username:  username,
    receiver_username:l.username,
    text,
  },token);
  if(res._err){ alert('Chyba: '+res._err); return; }
  inp.value='';
  loadMessages(l);
}

// ── Add listing ───────────────────────────────────────────────
function openAddListing(){
  if(!token){ alert('Přihlas se pro přidání nabídky.'); return; }
  document.getElementById('addModal').style.display='flex';
  setListingTab('card');
  resetAiZone();
  // Generate QR code after a short delay (library may still be loading)
  setTimeout(generateInlineQr, 300);
}
function closeAddListing(){
  document.getElementById('addModal').style.display='none';
  addCardData=null;
  document.getElementById('addCardPreview').style.display='none';
  document.getElementById('addCardUrl').value='';
  resetAiZone();
  resetQrInline();
  // Reset sale photos
  salePhotos = [];
  renderSalePhotos();
  // Hide official card thumb
  const ow = document.getElementById('officialCardWrap');
  if(ow) ow.style.display = 'none';
  // Reset product form
  selectedProdType='booster'; selectedProdLang='EN'; selectedSealCond='sealed';
  selectedProdSet=null; prodPhotos=[];
  const pi = document.getElementById('prodSetInput'); if(pi) pi.value='';
  const ps = document.getElementById('prodSetSelected'); if(ps) ps.style.display='none';
  const pr = document.getElementById('prodSetResults'); if(pr) pr.style.display='none';
  const strip = document.getElementById('prodSalePhotosStrip'); if(strip) renderProdPhotoStrip();
  const pc = document.getElementById('prodPhotoContent'); if(pc) pc.style.display='';
  // Pending queue cleanup
  if(typeof closeAddListing_pendingCleanup === 'function') closeAddListing_pendingCleanup();
}

// ── AI Photo Recognition ──────────────────────────────────────
let aiPhotoBase64 = null;
let aiPhotoMime   = 'image/jpeg';

function resetAiZone(){
  aiPhotoBase64 = null;
  const zone = document.getElementById('aiDropZone');
  if(zone){
    zone.classList.remove('scanning');
    // Obnov původní styl zóny
    zone.style.padding   = '';
    zone.style.cursor    = '';
    zone.style.textAlign = '';
    zone.setAttribute('onclick', "document.getElementById('aiPhotoInput').click()");
    zone.innerHTML=`<input type="file" id="aiPhotoInput" accept="image/*" style="display:none" onchange="handleAiPhoto(this.files[0])">
    <div id="aiDropContent">
      <div class="ai-drop-icon">📸</div>
      <div class="ai-drop-title" style="font-size:12px">Přetáhni nebo vyber</div>
      <div class="ai-drop-hint" style="font-size:11px">AI rozezná kartu</div>
    </div>`;
  }
  const prog = document.getElementById('aiScanProgress');
  if(prog) prog.style.display='none';
}

function handleAiDrop(e){
  e.preventDefault();
  document.getElementById('aiDropZone').classList.remove('drag-over');
  const file = e.dataTransfer.files?.[0];
  if(file && file.type.startsWith('image/')) handleAiPhoto(file);
}

async function handleAiPhoto(file){
  if(!file) return;
  aiPhotoMime = file.type || 'image/jpeg';

  // Show preview of uploaded image + scanning overlay
  const zone = document.getElementById('aiDropZone');
  const reader = new FileReader();
  reader.onload = async (ev) => {
    aiPhotoBase64 = ev.target.result.split(',')[1];
    const imgSrc  = ev.target.result;

    // Show scanning animation inside drop zone
    zone.classList.add('scanning');
    zone.innerHTML = `
      <div style="position:relative;width:100%;display:flex;align-items:center;justify-content:center;min-height:110px">
        <img src="${imgSrc}" style="max-height:110px;max-width:100%;border-radius:9px;object-fit:contain;opacity:0.5">
        <div class="ai-scanning-overlay" style="border-radius:9px">
          <div class="ai-scanner-line"></div>
          <div class="ai-scanning-text">🤖 AI skenuje...</div>
          <div class="ai-scanner-line" style="animation-delay:.4s"></div>
        </div>
      </div>`;

    // Show progress bar
    const prog = document.getElementById('aiScanProgress');
    const fill = document.getElementById('aiScanFill');
    const stat = document.getElementById('aiScanStatus');
    prog.style.display='';
    fill.style.width='10%';
    stat.textContent='Analyzuji obraz...';

    try {
      // Step 1: Claude AI vision – card identification + condition in parallel
      fill.style.width='25%';
      stat.textContent='AI rozpoznává kartu a hodnotí stav...';
      const [aiResult, condResult] = await Promise.all([
        callClaudeVision(aiPhotoBase64, aiPhotoMime),
        callClaudeCondition(aiPhotoBase64, aiPhotoMime),
      ]);

      fill.style.width='60%';
      stat.textContent='Hledám v databázi pokemontcg.io...';

      // Step 2: Search pokemontcg.io
      const candidates = await searchPokemonTcg(aiResult);

      fill.style.width='90%';
      stat.textContent='Zpracovávám výsledky...';

      // Apply AI condition grading to the dropdown
      if (condResult?.grade) {
        const condSel = document.getElementById('addCond');
        if (condSel) {
          for (let opt of condSel.options) {
            if (opt.value === condResult.grade) { opt.selected = true; break; }
          }
        }
        // Store condition result for display
        window._lastCondResult = condResult;
      }

      await new Promise(r=>setTimeout(r,300));
      fill.style.width='100%';
      prog.style.display='none';
      zone.classList.remove('scanning');

      if(!candidates.length){
        // Nothing found – show manual fallback
        showAiFailure(zone, imgSrc, aiResult, condResult);
      } else if(candidates.length === 1 || (aiResult.confidence === 'high' && candidates.length <= 2)){
        // Auto-select best match
        applyAiCard(candidates[0], imgSrc, aiResult.confidence || 'med');
        showAiSuccess(zone, imgSrc, candidates[0], aiResult.confidence || 'med', condResult);
      } else {
        // Multiple candidates – show picker
        showAiSuccess(zone, imgSrc, candidates[0], aiResult.confidence || 'med', condResult);
        openAiPick(candidates, aiResult, imgSrc);
      }
    } catch(err){
      prog.style.display='none';
      zone.classList.remove('scanning');
      showAiError(zone, imgSrc, err.message);
    }
  };
  reader.readAsDataURL(file);
}

/** Call Claude to assess physical condition of the card in the photo */
async function callClaudeCondition(base64, mimeType) {
  const prompt = `You are a Pokémon TCG card grading expert. Carefully inspect this card photo and assess its physical condition.

Look for:
- Surface scratches or scuffs on the front
- Whitening on edges and corners
- Centering (how well-centered the artwork is)
- Creases or bends
- Print defects or damage
- Overall wear level

Respond ONLY with a JSON object, no explanation:
{
  "grade": "NM",
  "label": "NM – Nová / Mint",
  "confidence": "high|med|low",
  "issues": ["list of specific issues found, empty if none"],
  "summary": "Stručný popis stavu v češtině (1-2 věty)"
}

Grade scale:
- NM (Near Mint): No visible wear, possibly only very light handling marks
- LP (Lightly Played): Minor edge/corner wear, light surface scratches, good centering
- MP (Moderately Played): Visible edge whitening, surface scratches, possible slight crease
- HP (Heavily Played): Heavy wear, significant scratches, creases, poor centering  
- D (Damaged): Tears, deep creases, water damage, unplayable condition

If photo quality is too poor to assess, return {"grade":"NM","confidence":"low","issues":[],"summary":"Foto není dostatečně kvalitní pro hodnocení stavu."}`;

  try {
    const response = await fetch('/api/groq', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json',
                 ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        max_tokens: 300,
        usage_type: 'search',
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });
    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '{}';
    try {
      const clean = raw.replace(/```json|```/g,'').trim();
      return JSON.parse(clean);
    } catch { return null; }
  } catch { return null; }
}

async function callClaudeVision(base64, mimeType){
  const prompt = `You are a Pokémon TCG card recognition expert. Analyze this card image and extract:
1. Pokemon name (exactly as printed on card)
2. Card number (e.g. "025/198" or "SV001")
3. Set name (e.g. "Scarlet & Violet", "Paldea Evolved", "Temporal Forces")
4. Set code if visible (e.g. "SVI", "PAL", "TEF")
5. Rarity (Common, Uncommon, Rare, Holo Rare, Ultra Rare, Special Illustration Rare, etc.)
6. Card type/subtype (Pokémon, Trainer, Energy; and V, VMAX, ex, GX, etc.)
7. HP value if visible

Respond ONLY with a JSON object, no explanation:
{
  "name": "...",
  "number": "...",
  "setName": "...",
  "setCode": "...",
  "rarity": "...",
  "subtype": "...",
  "hp": "...",
  "confidence": "high|med|low",
  "notes": "any uncertainty"
}

If you cannot identify the card at all, return {"confidence":"low","name":"","notes":"reason"}`;

  const response = await fetch('/api/groq', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json',
               ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
    body: JSON.stringify({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      max_tokens: 400,
      usage_type: 'search',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
          { type: 'text', text: prompt }
        ]
      }]
    })
  });
  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || '{}';
  try {
    const clean = raw.replace(/```json|```/g,'').trim();
    return JSON.parse(clean);
  } catch { return { confidence:'low', name:'', notes:'Parse error' }; }
}

async function searchPokemonTcg(aiResult){
  const { name, number, setName, setCode, confidence } = aiResult;
  const candidates = [];

  // Build queries from most specific to least
  const queries = [];

  if(name && (number || setCode)){
    if(number && setCode) queries.push(`name:"${name}" number:"${number}" set.id:"${setCode.toLowerCase()}"`);
    if(number && setName) queries.push(`name:"${name}" number:"${number}" set.name:"${setName}"`);
    if(number)            queries.push(`name:"${name}" number:"${number}"`);
    if(setName)           queries.push(`name:"${name}" set.name:"${setName}"`);
    if(setCode)           queries.push(`name:"${name}" set.id:"${setCode.toLowerCase()}"`);
  }
  if(name) queries.push(`name:"${name}"`);

  for(const q of queries){
    try {
      const res  = await tcgFetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=8&orderBy=-set.releaseDate`);
      const json = await res.json();
      if(json.data?.length){
        json.data.forEach(c=>{ if(!candidates.find(x=>x.id===c.id)) candidates.push(c); });
        if(candidates.length >= 2 && confidence === 'high') break;
        if(candidates.length >= 4) break;
      }
    } catch{}
  }

  // Sort: exact number match first
  if(number){
    candidates.sort((a,b)=>{
      const aMatch = a.number === number ? 0 : 1;
      const bMatch = b.number === number ? 0 : 1;
      return aMatch - bMatch;
    });
  }
  return candidates.slice(0,8);
}

function applyAiCard(card, photoSrc, confidence){
  applyCardToListing(card);
  if(addCardData) addCardData._userPhoto = photoSrc;
}

/** Po AI skenu automaticky přidá reálnou fotku do sekce Fotky k prodeji */
function _aiAddPhotoToSalePhotos(photoSrc) {
  if (!photoSrc) return;
  // Nekopíruj pokud stejná fotka je tam už (např. při druhém volání)
  const alreadyIn = salePhotos.some(p => (p.src || p.croppedUrl) === photoSrc);
  if (alreadyIn) return;
  if (photoSrc.startsWith('data:')) {
    const parts = photoSrc.split(',');
    const mime  = parts[0]?.match(/:(.*?);/)?.[1] || 'image/jpeg';
    salePhotos.push({ src: photoSrc, base64: parts[1] || '', mime });
  } else {
    salePhotos.push({ src: photoSrc, mime: 'image/jpeg' });
  }
  renderSalePhotos();
}

function showAiSuccess(zone, photoSrc, card, confidence, condResult){
  const confClass = confidence==='high'?'high':confidence==='med'?'med':'low';
  const confLabel = confidence==='high'?'✓ Vysoká jistota':confidence==='med'?'~ Střední jistota':'? Nízká jistota';

  // Kompaktní zobrazení — stav karty je již vyplněn v dropdownu, nepřetéká zónou
  zone.style.padding   = '8px';
  zone.style.cursor    = 'default';
  zone.style.textAlign = 'left';
  zone.removeAttribute('onclick');
  zone.innerHTML = `
    <input type="file" id="aiPhotoInput" accept="image/*" style="display:none" onchange="handleAiPhoto(this.files[0])">
    <div class="ai-preview-wrap" onclick="event.stopPropagation()">
      <img class="ai-preview-img" src="${esc(card.images?.small||photoSrc)}" onerror="this.src='${esc(photoSrc)}'">
      <div class="ai-preview-info" style="flex:1">
        <div class="ai-preview-name">${esc(card.name)}</div>
        <div class="ai-preview-meta">${esc(card.set?.name||'')}${card.number?' · #'+esc(card.number):''}${card.rarity?' · '+esc(card.rarity):''}</div>
        <div class="ai-preview-conf ${confClass}">${confLabel}</div>
      </div>
      <button class="ai-preview-change" onclick="document.getElementById('aiPhotoInput').click()">📸 Změnit</button>
    </div>`;

  // Automaticky přidej reálnou fotku do sekce "Fotky k prodeji"
  _aiAddPhotoToSalePhotos(photoSrc);
}

function showAiFailure(zone, photoSrc, aiResult, condResult){
  zone.style.padding   = '8px';
  zone.style.cursor    = 'default';
  zone.style.textAlign = 'left';
  zone.removeAttribute('onclick');
  zone.innerHTML = `
    <input type="file" id="aiPhotoInput" accept="image/*" style="display:none" onchange="handleAiPhoto(this.files[0])">
    <div class="ai-preview-wrap" onclick="event.stopPropagation()">
      <img class="ai-preview-img" src="${esc(photoSrc)}" style="opacity:0.5">
      <div class="ai-preview-info">
        <div class="ai-preview-name" style="color:var(--text3)">Karta nenalezena v databázi</div>
        <div class="ai-preview-meta">${aiResult.name ? 'AI odhaduje: '+esc(aiResult.name) : 'Zkus lepší foto nebo ruční hledání'}</div>
        <div style="display:flex;gap:6px;margin-top:6px">
          <button onclick="openCardSearch('listing')" style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid rgba(245,200,66,0.3);background:transparent;color:var(--yellow);cursor:pointer">🔍 Hledat ručně</button>
          <button onclick="document.getElementById('aiPhotoInput').click()" style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text3);cursor:pointer">📸 Znovu</button>
        </div>
      </div>
    </div>`;
  // Keep photo stored for listing
  aiPhotoBase64 && (addCardData = addCardData || {});
  if(addCardData) addCardData._userPhoto = photoSrc;

  // Automaticky přidej reálnou fotku do sekce "Fotky k prodeji"
  _aiAddPhotoToSalePhotos(photoSrc);
}

function showAiError(zone, photoSrc, errMsg){
  zone.style.padding   = '8px';
  zone.style.cursor    = 'default';
  zone.style.textAlign = 'left';
  zone.removeAttribute('onclick');
  zone.innerHTML=`
    <input type="file" id="aiPhotoInput" accept="image/*" style="display:none" onchange="handleAiPhoto(this.files[0])">
    <div class="ai-preview-wrap" onclick="event.stopPropagation()">
      <img class="ai-preview-img" src="${esc(photoSrc)}" style="opacity:0.4">
      <div class="ai-preview-info">
        <div class="ai-preview-name" style="color:var(--red)">Chyba AI skenování</div>
        <div class="ai-preview-meta" style="font-size:10px">${esc(errMsg||'Neznámá chyba')}</div>
        <div style="display:flex;gap:6px;margin-top:6px">
          <button onclick="openCardSearch('listing')" style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid rgba(245,200,66,0.3);background:transparent;color:var(--yellow);cursor:pointer">🔍 Hledat ručně</button>
          <button onclick="document.getElementById('aiPhotoInput').click()" style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text3);cursor:pointer">📸 Zkusit znovu</button>
        </div>
      </div>
    </div>`;

  // I při chybě přidej fotku do salePhotos — uživatel ji tam chce mít
  _aiAddPhotoToSalePhotos(photoSrc);
}

// ── AI Pick Modal ─────────────────────────────────────────────
let aiPickPhoto = null;

function openAiPick(candidates, aiResult, photoSrc){
  aiPickPhoto = photoSrc;
  const modal = document.getElementById('aiPickModal');
  modal.style.display='flex';

  const title   = document.getElementById('aiPickTitle');
  const subtitle= document.getElementById('aiPickSubtitle');
  const detected= document.getElementById('aiPickDetected');
  const list    = document.getElementById('aiPickList');

  title.textContent   = `AI rozpoznalo: ${aiResult.name || '?'}`;
  subtitle.textContent= `Nalezeno ${candidates.length} možných karet – vyber správnou`;

  const parts = [aiResult.name, aiResult.setName, aiResult.number && '#'+aiResult.number].filter(Boolean);
  detected.textContent = parts.join(' · ') || 'Neznámé';

  list.innerHTML = candidates.map((c, i) => `
    <div class="ai-candidate ${i===0?'best-match':''}" onclick="pickAiCandidate('${esc(c.id)}')">
      ${i===0 ? '<div class="ai-candidate-badge">⭐ Nejlepší shoda</div>' : ''}
      <img class="ai-candidate-img" src="${esc(c.images?.small||'')}" loading="lazy" onerror="this.style.display='none'">
      <div class="ai-candidate-name">${esc(c.name)}</div>
      <div class="ai-candidate-meta">${esc(c.set?.name||'')}${c.number?' · #'+esc(c.number):''}${c.rarity?'<br>'+esc(c.rarity):''}</div>
    </div>`).join('');

  // Store candidates for lookup
  window._aiCandidates = candidates;
}

function pickAiCandidate(cardId){
  const c = window._aiCandidates?.find(x=>x.id===cardId);
  if(!c) return;
  applyAiCard(c, aiPickPhoto, 'high');
  // Also update drop zone
  const zone = document.getElementById('aiDropZone');
  if(zone) showAiSuccess(zone, aiPickPhoto, c, 'high', window._lastCondResult || null);
  closeAiPick();
}

function closeAiPick(){
  document.getElementById('aiPickModal').style.display='none';
}

async function fetchCardForListing(){
  const url=document.getElementById('addCardUrl').value.trim();
  if(!url) return;

  // ── Cardmarket URL ────────────────────────────────────────────
  if(url.includes('cardmarket.com')){
    const parts = url.replace(/\/$/, '').split('/');
    const cardSlug = parts[parts.length - 1];
    const setSlug  = parts[parts.length - 2];
    let cleanSlug = cardSlug
      .replace(/[_-][a-z]{1,3}\d+[A-Z]?\d{3,4}$/i, '')
      .replace(/[_-][A-Za-z]{2,5}\d{2,4}$/i, '')
      .replace(/-\d{2,4}$/, '')
      .replace(/[_-](V\d+|SR|CHR|HR|UR|CSR|SAR|AR|Secret|Rainbow|RR|PR|K)$/i, '');
    const name    = cleanSlug.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
    const setName = setSlug.replace(/-and-/gi,' & ').replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
    // Search pokemontcg.io with parsed name
    try {
      const q = `name:"${name}"` + (setName ? ` set.name:"${setName}"` : '');
      const res  = await tcgFetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=5`);
      const json = await res.json();
      const card = json?.data?.[0];
      if(card){ applyCardToListing(card); return; }
      // Fallback without set
      const res2  = await tcgFetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent('name:"'+name+'"')}&pageSize=1`);
      const json2 = await res2.json();
      const card2 = json2?.data?.[0];
      if(card2){ applyCardToListing(card2); return; }
    } catch(e){}
    alert('Karta z Cardmarket URL nenalezena v pokemontcg.io databázi.');
    return;
  }

  // ── pokemontcg.io URL or name ────────────────────────────────
  const q=`name:"${url}"`;
  const apiUrl=url.includes('pokemontcg.io')
    ? url
    : `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=1`;
  try {
    const res  = await fetch(apiUrl);
    const json = await res.json();
    const card = json?.data?.[0] || json;
    if(!card?.name) { alert('Karta nenalezena.'); return; }
    applyCardToListing(card);
  } catch(e){ alert('Chyba načítání: '+e.message); }
}

function applyCardToListing(card, fromAlbum) {
  addCardData = card;
  const large = card.images?.large || card.apiLarge || '';
  const small = card.images?.small || card.apiSmall || card.imageUrl || '';
  document.getElementById('addCardImg').src = small;
  document.getElementById('addCardName').textContent = card.name;
  document.getElementById('addCardMeta').textContent = (card.set?.name||card.set||'')+(card.number?' #'+card.number:'');
  document.getElementById('addCardPreview').style.display='flex';
  // Store large for hover zoom
  const largeEl = document.getElementById('addCardLargeImg');
  if(largeEl) largeEl.src = large || small;
  // Official card thumb for sale photos section
  const ot = document.getElementById('officialCardThumb');
  const ow = document.getElementById('officialCardWrap');
  if(ot && small){ ot.src = small; }
  if(ow){ ow.style.display = small ? '' : 'none'; }
  // Album badge
  const badge = document.getElementById('addCardAlbumBadge');
  if(badge) badge.style.display = fromAlbum ? 'inline-flex' : 'none';
  // Auto-fill condition from album card
  if(fromAlbum && card.condition){
    const condSel = document.getElementById('addCond');
    if(condSel){ for(let o of condSel.options) if(o.value===card.condition){o.selected=true;break;} }
  }
  // Auto-fill price from album
  if(fromAlbum && card.price_czk){
    const priceInp = document.getElementById('addPrice');
    if(priceInp) priceInp.value = card.price_czk;
    const albumInfo = document.getElementById('albumPriceInfo');
    const albumVal  = document.getElementById('albumPriceVal');
    if(albumInfo && albumVal){ albumVal.textContent = card.price_czk; albumInfo.style.display=''; }
  }
}

function clearAddCard() {
  addCardData = null;
  document.getElementById('addCardPreview').style.display = 'none';
  document.getElementById('addCardImg').src = '';
  document.getElementById('addCardUrl').value = '';
  const ow = document.getElementById('officialCardWrap');
  if(ow) ow.style.display = 'none';
}

function setAddType(type){
  addType=type;
  ['sell','trade','both'].forEach(t=>{
    document.getElementById('addType'+t.charAt(0).toUpperCase()+t.slice(1)).classList.toggle('act',t===type);
  });
  document.getElementById('addPriceRow').style.display=(type==='sell'||type==='both')?'':'none';
  document.getElementById('addTradeRow').style.display=(type==='trade'||type==='both')?'':'none';
  // Label fotek se mění podle typu — sekce je vždy viditelná
  const photoLabel = document.querySelector('#salePhotosSection .fs-label');
  if(photoLabel){
    if(type==='trade') photoLabel.textContent='Fotky k výměně';
    else if(type==='both') photoLabel.textContent='Fotky k prodeji / výměně';
    else photoLabel.textContent='Fotky k prodeji';
  }
}

async function submitListing(){
  if(!token){ alert('Přihlas se.'); return; }
  const price = parseInt(document.getElementById('addPrice').value)||null;
  const desc  = document.getElementById('addDesc').value.trim()||null;
  const cond  = document.getElementById('addCond').value;
  const wants = document.getElementById('addTradeWants').value.trim()||null;
  const card  = addCardData;

  const cardData = card ? {
    name: card.name, set: card.set?.name||'', number: card.number||'',
    hp: card.hp||'', types: card.types||[], supertype: card.supertype||'',
    images: card.images||null, rarity: card.rarity||'',
    pTrend: card.cardmarket?.prices?.trendPrice||null,
    pMin:   card.cardmarket?.prices?.lowPrice||null,
    cardmarketUrl: card.cardmarket?.url||'',
    apiId: card.id||card.apiId||card.tcgId||'',  // pokemontcg.io ID pro přímý lookup
  } : {};

  const payload = {
    user_id:        userId,
    username:       username,
    title:          card?.name || 'Nabídka',
    cards_data:     [cardData],
    card_name:      card?.name||'',
    card_set:       card?.set?.name||card?.set||'',
    card_number:    card?.number||'',
    card_hp:        card?.hp||'',
    card_type:      card?.types?.[0]||'',
    card_rarity:    card?.rarity||'',
    card_condition: cond,
    api_image_url:  card?.images?.large || card?.images?.small || '',
    price_czk:      (addType==='trade') ? null : price,
    allow_trade:    (addType==='trade'||addType==='both'),
    allow_offer:    true,
    trade_wants:    wants,
    description:    desc,
    status:         'active',
    // Sale photos: uložit jen reálné fotky (isOfficial=true je už v api_image_url)
    user_photos:    salePhotos.filter(p => !p.isOfficial).length ? salePhotos.filter(p => !p.isOfficial).map(p => ({
      src: p.croppedUrl || p.src,
      mime: p.mime,
      cropped: !!p.croppedUrl
    })) : undefined,
  };

  const res = await sbReq('rest/v1/listings','POST',payload,token);
  if(res._err){ alert('Chyba: '+res._err); return; }
  alert('Nabídka zveřejněna!');
  // Remove from pending queue if came from there
  if (_pendingFromQueue?._pendingId) {
    removePendingCard(_pendingFromQueue._pendingId);
    _pendingFromQueue = null;
  }
  closeAddListing();
  // Reload
  allListings.unshift(Array.isArray(res)?res[0]:res);
  applyFilters();
}

// ── Item type filter (Karty / Sealed produkty) ───────────────
let currentItemType = 'all';

function setItemType(type) {
  // Legacy button-based call — map to checkbox state
  const cbCards  = document.getElementById('itCards');
  const cbSealed = document.getElementById('itSealed');
  if (cbCards && cbSealed) {
    cbCards.checked  = (type === 'all' || type === 'card');
    cbSealed.checked = (type === 'all' || type === 'product');
  }
  currentItemType = type;
  applyFilters();
}

function applyItemTypeCheckboxes() {
  const cbCards  = document.getElementById('itCards');
  const cbSealed = document.getElementById('itSealed');
  const cards  = cbCards  ? cbCards.checked  : true;
  const sealed = cbSealed ? cbSealed.checked : true;
  if (cards && sealed)   currentItemType = 'all';
  else if (cards)        currentItemType = 'card';
  else if (sealed)       currentItemType = 'product';
  else                   currentItemType = 'all'; // nothing checked → show all
  applyFilters();
}

// ── Listing type tab (modal) ──────────────────────────────────
let currentListingTab = 'card';

function setListingTab(tab) {
  currentListingTab = tab;
  document.getElementById('tabCard').classList.toggle('active', tab==='card');
  document.getElementById('tabProduct').classList.toggle('active', tab==='product');
  document.getElementById('cardListingForm').style.display    = tab==='card'    ? 'flex' : 'none';
  document.getElementById('productListingForm').style.display = tab==='product' ? 'flex' : 'none';
}

// ── Product type selection ─────────────────────────────────────
const PROD_TYPES = {
  booster:    { label:'Booster Pack',       hint:'1 balíček – standardně 10 karet. Uveď počet kusů.', qty:1 },
  boosterbox: { label:'Booster Box',        hint:'Celý display – standardně 36 boosterů v krabici.', qty:1 },
  etb:        { label:'Elite Trainer Box',  hint:'ETB obsahuje 9 boosterů + sběratelské doplňky.', qty:1 },
  tin:        { label:'Tin',                hint:'Kovová krabička s 3–4 boostery a promo kartou.', qty:1 },
  blister:    { label:'Blister Pack',       hint:'1–3 boostery v blister balení.', qty:1 },
  bundle:     { label:'Bundle',             hint:'Balíček obsahující více různých produktů.', qty:1 },
  deck:       { label:'Starter/Theme Deck', hint:'Kompletní hrací balíček ~60 karet.', qty:1 },
  other:      { label:'Jiný produkt',       hint:'Ostatní sealed produkty, promo balení, kolekce...', qty:1 },
};
let selectedProdType = 'booster';
let selectedProdLang = 'EN';
let selectedSealCond = 'sealed';
let selectedProdSet  = null;
let prodPhotos = [];

function setProdType(type) {
  selectedProdType = type;
  Object.keys(PROD_TYPES).forEach(t => {
    const el = document.getElementById('pt_'+t);
    if(el) el.classList.toggle('active', t===type);
  });
  const hint = document.getElementById('prodTypeHint');
  if(hint) hint.textContent = PROD_TYPES[type]?.hint || '';
}

function setProdLang(lang) {
  selectedProdLang = lang;
  ['EN','CZ','JP','DE','FR','IT'].forEach(l => {
    const el = document.getElementById('lang'+l);
    if(el) el.classList.toggle('active', l===lang);
  });
}

function setSealCond(cond) {
  selectedSealCond = cond;
  ['Sealed','Damaged','Open'].forEach(c => {
    const id = 'seal' + c.charAt(0).toUpperCase() + c.slice(1);
    const el = document.getElementById(id);
    if(el) el.classList.toggle('active', c.toLowerCase()===cond||
      (c==='Sealed'&&cond==='sealed')||(c==='Damaged'&&cond==='damaged')||(c==='Open'&&cond==='open'));
  });
}

// ── Product set search ─────────────────────────────────────────
let prodSetSearchTimeout = null;

function prodSetInputChange() {
  clearTimeout(prodSetSearchTimeout);
  prodSetSearchTimeout = setTimeout(searchProdSet, 600);
}

async function searchProdSet() {
  const q = (document.getElementById('prodSetInput')?.value||'').trim();
  if(!q) return;
  const wrap = document.getElementById('prodSetResults');
  if(!wrap) return;
  wrap.style.display = '';
  wrap.innerHTML = '<div style="font-size:12px;color:var(--text3);padding:8px">⏳ Hledám série...</div>';
  try {
    const res  = await tcgFetch('https://api.pokemontcg.io/v2/sets?q=name:"'+encodeURIComponent(q)+'"&pageSize=10&orderBy=-releaseDate');
    const json = await res.json();
    const sets = json.data || [];
    if(!sets.length) {
      // Fallback: search without quotes
      const res2  = await tcgFetch('https://api.pokemontcg.io/v2/sets?q=name:'+encodeURIComponent(q)+'&pageSize=8&orderBy=-releaseDate');
      const json2 = await res2.json();
      sets.push(...(json2.data||[]));
    }
    if(!sets.length) { wrap.innerHTML='<div style="font-size:12px;color:var(--text3);padding:8px">Žádná série nenalezena.</div>'; return; }
    wrap.innerHTML = sets.slice(0,8).map(s=>`
      <div class="prod-set-result" onclick="selectProdSet(${JSON.stringify(JSON.stringify(s))})">
        <img class="prod-set-logo" src="${esc(s.images?.logo||s.images?.symbol||'')}" onerror="this.style.display='none'">
        <div>
          <div class="prod-set-name">${esc(s.name)}</div>
          <div class="prod-set-meta">${esc(s.series||'')} · ${esc(s.releaseDate||'')} · ${s.printedTotal||'?'} karet</div>
        </div>
      </div>`).join('');
  } catch(e) {
    wrap.innerHTML = '<div style="font-size:12px;color:var(--red);padding:8px">Chyba: '+esc(e.message)+'</div>';
  }
}

function selectProdSet(jsonStr) {
  const s = JSON.parse(jsonStr);
  selectedProdSet = s;
  document.getElementById('prodSetResults').style.display = 'none';
  document.getElementById('prodSetInput').value = s.name;
  const sel = document.getElementById('prodSetSelected');
  if(sel) {
    sel.style.display = 'flex';
    document.getElementById('prodSetLogo').src  = s.images?.logo || '';
    document.getElementById('prodSetName').textContent = s.name;
    document.getElementById('prodSetMeta').textContent = (s.series||'') + (s.releaseDate?' · '+s.releaseDate:'') + (s.printedTotal?' · '+s.printedTotal+' karet':'');
  }
}

function clearProdSet() {
  selectedProdSet = null;
  document.getElementById('prodSetInput').value = '';
  document.getElementById('prodSetSelected').style.display = 'none';
}

// ── Product photos ─────────────────────────────────────────────
function handleProdPhotos(files) {
  if(!files?.length) return;
  Array.from(files).forEach(file => {
    const reader = new FileReader();
    reader.onload = ev => {
      prodPhotos.push({ base64: ev.target.result.split(',')[1], mime: file.type, src: ev.target.result });
      renderProdPhotoStrip();
    };
    reader.readAsDataURL(file);
  });
}

function handleProdPhotoDrop(e) {
  e.preventDefault();
  if(e.dataTransfer?.files) handleProdPhotos(e.dataTransfer.files);
}

function renderProdPhotoStrip() {
  const strip = document.getElementById('prodSalePhotosStrip');
  if (!strip) return;
  // Find the add tile (always keep it)
  let html = '';
  prodPhotos.forEach((p, i) => {
    const src = p.croppedUrl || p.src;
    html += `<div class="sale-photo-tile" id="prodTile-${i}">
      <img src="${src}" class="sale-photo-img" onclick="openMktLightbox('${src.replace(/'/g,"\\'")}')">
      <div class="sale-photo-actions">
        <button onclick="openProdCrop(${i})" class="spt-crop-btn" title="Oříznout">✂️</button>
        <button onclick="removeProdPhoto(${i})" class="spt-del-btn" title="Smazat">✕</button>
      </div>
      ${p.croppedUrl ? '<div class="spt-cropped-badge">✂️</div>' : ''}
    </div>`;
  });
  html += `<div class="sale-photo-add" onclick="document.getElementById('prodPhotoInput').click()" ondragover="event.preventDefault();this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="handleProdPhotoDrop(event)">
    <input type="file" id="prodPhotoInput" accept="image/*" multiple style="display:none" onchange="handleProdPhotos(this.files)">
    <div style="font-size:22px">➕</div>
    <div style="font-size:10px;color:var(--text3);margin-top:2px">Přidat foto</div>
  </div>`;
  strip.innerHTML = html;
}

function removeProdPhoto(idx) {
  prodPhotos.splice(idx, 1);
  renderProdPhotoStrip();
}

// ── Submit product listing ────────────────────────────────────
async function submitProductListing() {
  if(!token) { alert('Přihlas se.'); return; }
  const price = parseInt(document.getElementById('prodPrice').value)||null;
  const qty   = parseInt(document.getElementById('prodQty').value)||1;
  const ean   = document.getElementById('prodEan').value.trim()||null;
  const desc  = document.getElementById('prodDesc').value.trim()||null;
  const setData = selectedProdSet;
  const prodTypeLabel = PROD_TYPES[selectedProdType]?.label || selectedProdType;
  const title = (setData?.name||'Neznámý set') + ' – ' + prodTypeLabel + (qty>1?' ('+qty+'×)':'');

  if(!price) { alert('Zadej cenu produktu.'); return; }
  if(!setData && !(document.getElementById('prodSetInput')?.value||'').trim()) {
    alert('Zadej nebo vyber sérii/set.'); return;
  }

  const payload = {
    user_id:        userId,
    username:       username,
    title:          title,
    listing_type:   'product',
    product_type:   selectedProdType,
    product_type_label: prodTypeLabel,
    product_set_id: setData?.id || null,
    product_set_name: setData?.name || document.getElementById('prodSetInput').value.trim(),
    product_lang:   selectedProdLang,
    product_sealed_cond: selectedSealCond,
    product_qty:    qty,
    product_ean:    ean,
    api_image_url:  setData?.images?.logo || setData?.images?.symbol || '',
    cards_data:     [],
    card_name:      title,
    card_set:       setData?.name || '',
    card_condition: selectedSealCond === 'sealed' ? 'NM' : selectedSealCond === 'damaged' ? 'LP' : 'MP',
    price_czk:      price,
    allow_trade:    false,
    description:    desc,
    status:         'active',
  };

  const res = await sbReq('rest/v1/listings','POST',payload,token);
  if(res._err) { alert('Chyba: '+res._err); return; }
  alert('Produkt zveřejněn!');
  closeAddListing();
  allListings.unshift(Array.isArray(res)?res[0]:res);
  prodPhotos = [];
  setListingTab('card');
  applyFilters();
}

// Reset product form on modal close
const _origCloseAddListing = closeAddListing;

// ── Pending Queue (Čeká na vystavení) ─────────────────────────
const PENDING_KEY = 'pkt_pending_listings';
let _pendingFromQueue = null;   // card being listed from the queue
let _pendingPanelOpen = false;

function getPendingQueue() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); }
  catch { return []; }
}
function savePendingQueue(arr) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(arr));
}

/** Add a card to the pending queue (called from album page) */
window.addToPendingQueue = function(card) {
  const q = getPendingQueue();
  if (!q.find(c => c._pendingId === card._pendingId)) {
    q.push(card);
    savePendingQueue(q);
  }
  updatePendingBadge();
};

/** Remove one card from queue by _pendingId */
function removePendingCard(pendingId) {
  const q = getPendingQueue();
  // Zapamatuj si id karty, aby ji reconcilePendingQueue v albu znovu nepřidala
  const card = q.find(c => c._pendingId === pendingId);
  if (card?.id) {
    try {
      const dismissed = JSON.parse(localStorage.getItem('pkt_dismissed_ids') || '[]');
      if (!dismissed.includes(String(card.id))) {
        dismissed.push(String(card.id));
        localStorage.setItem('pkt_dismissed_ids', JSON.stringify(dismissed));
      }
    } catch {}
  }
  savePendingQueue(q.filter(c => c._pendingId !== pendingId));
  updatePendingBadge();
  renderPendingList();
}

/** Update badge counts and show/hide button */
function updatePendingBadge() {
  const count = getPendingQueue().length;
  const btn   = document.getElementById('btnPendingQueue');
  const b1    = document.getElementById('pendingBadgeBtn');
  const b2    = document.getElementById('pendingBadgePanel');
  if (b1) b1.textContent = count;
  if (b2) b2.textContent = count;
  if (btn) {
    btn.classList.toggle('empty', count === 0);
  }
  if (count === 0 && _pendingPanelOpen) togglePendingPanel(false);
}

function togglePendingPanel(forceOpen) {
  _pendingPanelOpen = forceOpen !== undefined ? forceOpen : !_pendingPanelOpen;
  const modal = document.getElementById('pendingModal');
  const btn   = document.getElementById('btnPendingQueue');
  if (!modal) return;
  if (_pendingPanelOpen) {
    modal.style.display = 'flex';
    renderPendingList();
    if (btn) btn.classList.add('active');
    // Close when clicking outside the inner box
    modal.onclick = function(e) { if (e.target === modal) togglePendingPanel(false); };
  } else {
    modal.style.display = 'none';
    if (btn) btn.classList.remove('active');
  }
}

// Global map used by renderPendingList so onclick can pass only the ID (avoids HTML-attr escaping issues)
const _pendingCardMap = {};

function _getPendingImg(card) {
  // Try all known image field names
  const direct = card._userPhoto                           // ← fotka z alba má přednost
    || (card.allPhotos?.length ? (card.allPhotos.find(p => p.side === 'front') || card.allPhotos[0])?.url : null)
    || card.photoUrl
    || card.images?.small || card.images?.large
    || card.apiSmall || card.apiLarge
    || card.imageUrl || card.image_url
    || card.api_image_url
    || card.image || card.img
    || card.smallImage || card.cardImage
    || card.thumbnail || card.photo
    || card.tcgImage || card.tcg_image
    || card.imgUrl || card.imgSmall || card.imgLarge
    || card.cardImg || card.cardUrl
    || '';
  if (direct) return direct;
  // Fallback: construct pokemontcg.io URL from TCG ID (e.g. "cel-1" → images.pokemontcg.io/cel/1.png)
  // DULEZITE: card.id je vzdy Supabase UUID – tcgId/apiId MUSI byt kontrolovany samostatne,
  // protoze "card.id || card.tcgId" zkratuje na UUID a tcgId by se nikdy nekontrolovalo!
  const tcgCid = card.tcgId || card.apiId || card.tcg_id || '';
  if (tcgCid && /^[a-zA-Z0-9]+-[a-zA-Z0-9]/.test(tcgCid)) {
    const tcgParts = tcgCid.split('-');
    return `https://images.pokemontcg.io/${tcgParts[0]}/${tcgParts.slice(1).join('-')}.png`;
  }
  // Pokud tcgId neni, zkusit card.id jen pokud NENI UUID (stary format dat)
  const rawId = card.id || card.card_id || '';
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId);
  if (rawId && !isUUID && /^[a-zA-Z0-9]+-[a-zA-Z0-9]/.test(rawId)) {
    const rawParts = rawId.split('-');
    return `https://images.pokemontcg.io/${rawParts[0]}/${rawParts.slice(1).join('-')}.png`;
  }
  return '';
}

function renderPendingList() {
  const wrap = document.getElementById('pendingList');
  if (!wrap) return;
  const q = getPendingQueue();
  if (!q.length) {
    wrap.innerHTML = '<div class="pending-empty">Žádné karty nečekají na vystavení.<br><a href="moje-album.html" style="color:var(--blue)">Označ karty v Moje album →</a></div>';
    return;
  }

  // Store cards in global map keyed by _pendingId so onclick can reference by ID (safe, no JSON-in-HTML)
  q.forEach(card => {
    const key = card._pendingId || card.id || String(Math.random());
    if (!card._pendingId) card._pendingId = key;
    _pendingCardMap[key] = card;
  });

  wrap.innerHTML = q.map(card => {
    const img    = _getPendingImg(card);
    const name   = esc(card.name || '—');
    const set    = esc(card.set?.name || (typeof card.set === 'string' ? card.set : '') || '');
    const num    = card.number ? ' · #' + esc(card.number) : '';
    const cond   = esc(card.condition || card.card_condition || 'NM');
    const price  = card.album_price ? card.album_price + ' Kč' : '—';
    const pid    = esc(card._pendingId || '');
    const ltype  = card.listing_type || 'sell';
    const typeBadge = ltype === 'trade'
      ? '<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:rgba(96,165,250,0.15);color:#60a5fa;font-weight:600;white-space:nowrap">🔄 Výměna</span>'
      : ltype === 'both'
      ? '<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:rgba(167,139,250,0.15);color:#a78bfa;font-weight:600;white-space:nowrap">💰🔄 Obojí</span>'
      : '<span style="font-size:10px;padding:2px 7px;border-radius:10px;background:rgba(74,222,128,0.15);color:#4ade80;font-weight:600;white-space:nowrap">💰 Prodej</span>';

    return `<div class="pending-row" onclick="openListingFromQueue('${pid}')">
      <img class="pending-row-img" id="prow-img-${pid}" src="${img ? esc(img) : ''}" loading="lazy"
        style="${img ? '' : 'display:none'}"
        onerror="this.style.display='none';document.getElementById('prow-ph-${pid}').style.display='flex'">
      <div class="pending-row-img pending-row-img-placeholder" id="prow-ph-${pid}"
        style="${img ? 'display:none' : 'display:flex'};align-items:center;justify-content:center;font-size:20px;background:rgba(255,255,255,0.04);border-radius:8px;color:rgba(255,255,255,0.2)">🃏</div>
      <div class="pending-row-info">
        <div class="pending-row-name">${name}</div>
        <div class="pending-row-meta">${set}${num}</div>
      </div>
      <div class="pending-row-cond">${cond}</div>
      ${typeBadge}
      <div class="pending-row-price">${price}</div>
      <button class="pending-row-del" title="Odebrat z fronty" onclick="event.stopPropagation();removePendingCard('${pid}')">✕</button>
    </div>`;
  }).join('');

  // Async: pro karty bez obrázku zkusit dohledat z TCG API podle jména
  q.forEach(card => {
    const pid = card._pendingId || '';
    if (_getPendingImg(card)) return; // má obrázek, skip
    const name = card.name || '';
    if (!name) return;
    const imgEl = document.getElementById('prow-img-' + pid);
    const phEl  = document.getElementById('prow-ph-'  + pid);
    if (!imgEl || !phEl) return;
    // Fetch z TCG API na pozadí
    const setName = card.set?.name || (typeof card.set === 'string' ? card.set : '') || '';
    const number  = card.number || '';
    let q2 = `name:"${name}"`;
    if (number && setName) q2 = `name:"${name}" number:"${number}" set.name:"${setName}"`;
    else if (number)       q2 = `name:"${name}" number:"${number}"`;
    else if (setName)      q2 = `name:"${name}" set.name:"${setName}"`;
    tcgFetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q2)}&pageSize=1`)
      .then(r => r.json())
      .then(j => {
        const c = j?.data?.[0];
        if (!c) return;
        const url = c.images?.small || c.images?.large || '';
        if (!url) return;
        // Uložit zpět do mapy i do localStorage fronty pro příští render
        if (_pendingCardMap[pid]) {
          _pendingCardMap[pid].images = c.images;
          _pendingCardMap[pid].tcgId  = c.id;
        }
        const savedQ = getPendingQueue();
        const idx = savedQ.findIndex(x => x._pendingId === pid);
        if (idx !== -1) { savedQ[idx].images = c.images; savedQ[idx].tcgId = c.id; savePendingQueue(savedQ); }
        // Zobrazit obrázek
        imgEl.src = url;
        imgEl.style.display = '';
        phEl.style.display  = 'none';
      })
      .catch(() => {});
  });
}

/** Open the listing modal pre-filled from a pending queue card */
function openListingFromQueue(pendingId) {
  // Look up card from the global map populated by renderPendingList
  const card = _pendingCardMap[pendingId];
  if (!card) { console.error('[openListingFromQueue] card not found for id:', pendingId); return; }
  _pendingFromQueue = card;
  if (!token) { alert('Přihlas se pro přidání nabídky.'); return; }

  // Close pending modal and open the listing modal
  togglePendingPanel(false);
  document.getElementById('addModal').style.display = 'flex';
  resetAiZone();
  setTimeout(generateInlineQr, 300);

  // Nastav typ nabídky dle toho, co bylo vybráno v albu (sell/trade/both)
  const listingType = card.listing_type || 'sell';
  setAddType(listingType);

  // Pre-fill basic card data immediately
  addCardData = card;
  const imgEl   = document.getElementById('addCardImg');
  const nameEl  = document.getElementById('addCardName');
  const metaEl  = document.getElementById('addCardMeta');
  const preview = document.getElementById('addCardPreview');

  const existingImg = _getPendingImg(card);
  imgEl.src = existingImg || '';
  imgEl.onerror = () => { imgEl.style.display = 'none'; };
  imgEl.onload  = () => { imgEl.style.display = ''; };
  if (!existingImg) imgEl.style.display = 'none';
  // Nastavit large img pro lightbox zoom (oprava: prázdné src se jinak resolve na URL stránky)
  const largeImgEl = document.getElementById('addCardLargeImg');
  if (largeImgEl) largeImgEl.src = existingImg || '';

  nameEl.textContent = card.name || '';
  const setName = card.set?.name || (typeof card.set === 'string' ? card.set : '') || '';
  const num = card.number ? ' #' + card.number : '';
  metaEl.textContent = setName + num || 'Načítám data…';
  preview.style.display = 'flex';

  // Nastavit official card thumb (obrázek v sekci "Fotky k prodeji")
  const ot = document.getElementById('officialCardThumb');
  const ow = document.getElementById('officialCardWrap');
  if (ot && existingImg) { ot.src = existingImg; }
  if (ow) { ow.style.display = existingImg ? '' : 'none'; }

  if (card.id && !card.id.startsWith('search_')) {
    document.getElementById('addCardUrl').value = card.id;
  }

  // Pre-fill condition
  const condSel = document.getElementById('addCond');
  const cond = card.condition || card.card_condition || 'NM';
  if (condSel) {
    for (let opt of condSel.options) { if (opt.value === cond) { opt.selected = true; break; } }
  }

  // Předplnit salePhotos: 1) oficiální obrázek, 2) reálné foto z alba
  salePhotos = [];
  // Slot 0 — oficiální karta (může se updatovat po auto-fetch)
  if (existingImg) {
    salePhotos.push({ src: existingImg, mime: 'image/jpeg', isOfficial: true });
  }
  // Slot 1+ — reálné fotky z alba (allPhotos = celý batch přední+zadní, photoUrl = jen přední)
  const albumPhotos = card._userPhotos
    || (card.allPhotos?.length
        ? card.allPhotos.map(p => (typeof p === 'string' ? p : (p.url || p.croppedUrl || p.src || ''))).filter(Boolean)
        : null)
    || (card._userPhoto ? [card._userPhoto] : (card.photoUrl ? [card.photoUrl] : []));
  if (albumPhotos.length) {
    albumPhotos.forEach(src => {
      if (typeof src === 'string' && src.startsWith('data:')) {
        const parts2 = src.split(',');
        const mime = parts2[0]?.match(/:(.*?);/)?.[1] || 'image/jpeg';
        salePhotos.push({ src, base64: parts2[1] || '', mime });
      } else if (typeof src === 'object' && src && src.src) {
        salePhotos.push(src);
      } else if (typeof src === 'string' && src) {
        // Remote URL (např. Supabase storage)
        salePhotos.push({ src, mime: 'image/jpeg' });
      }
    });
  }
  renderSalePhotos();

  // Show album price as info
  const priceInfo = document.getElementById('albumPriceInfo');
  const priceVal  = document.getElementById('albumPriceVal');
  if (card.album_price && priceInfo && priceVal) {
    priceVal.textContent = card.album_price;
    priceInfo.style.display = 'flex';
    document.getElementById('addPrice').value = card.album_price;
  } else if (priceInfo) {
    priceInfo.style.display = 'none';
  }

  // Auto-fetch full TCG data if image or complete info is missing
  const needsFetch = !existingImg || !card.hp || !card.types?.length || !card.rarity;
  if (needsFetch && card.name) {
    _autoFetchFullCardData(card);
  }
}

/** Fetch complete card data from pokemontcg.io and update the modal */
async function _autoFetchFullCardData(pendingCard) {
  const nameEl = document.getElementById('addCardName');
  const metaEl = document.getElementById('addCardMeta');
  const imgEl  = document.getElementById('addCardImg');

  try {
    // Build the best query we can from available fields
    const name   = pendingCard.name || '';
    const number = pendingCard.number || '';
    const setName = pendingCard.set?.name || (typeof pendingCard.set === 'string' ? pendingCard.set : '') || '';
    const tcgApiId = pendingCard.tcgId || pendingCard.apiId || pendingCard.tcg_id || '';

    let card = null;

    // 1. Try exact TCG API id first (e.g. "sv3pt5-197")
    if (tcgApiId && !tcgApiId.includes('-') === false && !/^[0-9a-f]{8}-/.test(tcgApiId)) {
      try {
        const r = await tcgFetch(`https://api.pokemontcg.io/v2/cards/${encodeURIComponent(tcgApiId)}`);
        const j = await r.json();
        if (j?.data?.name) card = j.data;
      } catch {}
    }

    // 2. Try name + number + set
    if (!card && name) {
      const queries = [];
      if (number && setName) queries.push(`name:"${name}" number:"${number}" set.name:"${setName}"`);
      if (number)            queries.push(`name:"${name}" number:"${number}"`);
      if (setName)           queries.push(`name:"${name}" set.name:"${setName}"`);
      queries.push(`name:"${name}"`);

      for (const q of queries) {
        try {
          const r = await tcgFetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=1&orderBy=-set.releaseDate`);
          const j = await r.json();
          if (j?.data?.[0]?.name) { card = j.data[0]; break; }
        } catch {}
      }
    }

    if (!card) return;

    // Update addCardData with full TCG data, keep pending-specific fields
    addCardData = { ...pendingCard, ...card, _pendingId: pendingCard._pendingId, _userPhoto: pendingCard._userPhoto };

    // Update preview image
    const img = card.images?.large || card.images?.small || '';
    if (img) {
      imgEl.style.display = '';
      imgEl.src = img;
      // Nastavit large img pro lightbox zoom
      const largeImgEl2 = document.getElementById('addCardLargeImg');
      if (largeImgEl2) largeImgEl2.src = card.images?.large || img;
      // Také updatovat officialCardWrap v sekci "Fotky k prodeji"
      const ot2 = document.getElementById('officialCardThumb');
      const ow2 = document.getElementById('officialCardWrap');
      if (ot2) { ot2.src = img; }
      if (ow2) { ow2.style.display = ''; }
      // Aktualizovat nebo přidat oficialní obrázek jako první v salePhotos
      if (salePhotos.length > 0 && salePhotos[0].isOfficial) {
        salePhotos[0].src = img;
      } else if (!salePhotos.some(p => p.isOfficial)) {
        salePhotos.unshift({ src: img, mime: 'image/jpeg', isOfficial: true });
      }
      renderSalePhotos();
    }

    // Update name + meta with full info
    if (nameEl) nameEl.textContent = card.name || pendingCard.name || '';
    if (metaEl) {
      const parts = [
        card.set?.name || '',
        card.number ? '#' + card.number : '',
        card.rarity || '',
        card.hp ? card.hp + ' HP' : '',
      ].filter(Boolean);
      metaEl.textContent = parts.join(' · ');
    }

    // Also update addCardUrl for reference
    const urlEl = document.getElementById('addCardUrl');
    if (urlEl && card.id) urlEl.value = card.id;

  } catch (err) {
    console.warn('[_autoFetchFullCardData] failed:', err);
  }
}

// After successful listing, remove the card from queue — handled inside submitListing above
// and closeAddListing below resets queue state too

function closeAddListing_pendingCleanup() {
  _pendingFromQueue = null;
  const priceInfo = document.getElementById('albumPriceInfo');
  if (priceInfo) priceInfo.style.display = 'none';
}

// Init on load
document.addEventListener('DOMContentLoaded', function() {
  updatePendingBadge();
});
// Also update badge when localStorage changes (album tab writes to it)
window.addEventListener('storage', function(e) {
  if (e.key === PENDING_KEY) {
    updatePendingBadge();
    if (_pendingPanelOpen) renderPendingList();
  }
});

// ── Handle ?sell=1&cards=... URL from album page ───────────────
(function checkSellParam() {
  const p = new URLSearchParams(location.search);
  if (p.get('sell') !== '1') return;
  history.replaceState({}, '', location.pathname);
  // Cards may be passed as JSON in ?cards=...
  try {
    const raw = p.get('cards');
    if (raw) {
      const cards = JSON.parse(decodeURIComponent(raw));
      const arr = Array.isArray(cards) ? cards : [cards];
      const q = getPendingQueue();
      let added = 0;
      arr.forEach(card => {
        if (!card._pendingId) card._pendingId = card.id + '_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
        if (!q.find(c => c._pendingId === card._pendingId)) { q.push(card); added++; }
      });
      if (added) savePendingQueue(q);
    }
  } catch(e) { /* ignore */ }
  // Open panel after listings load
  setTimeout(() => { updatePendingBadge(); togglePendingPanel(true); }, 800);
})();


let _qrInlineGenerated = false;

function generateInlineQr() {
  const container = document.getElementById('qrInlineCanvas');
  if (!container) return;

  const base = window.location.origin + window.location.pathname;
  const url  = base + '?newlisting=1&mode=camera';
  window._qrInlineUrl = url;

  if (_qrInlineGenerated) {
    // Already generated → open fullscreen
    openQrFull();
    return;
  }
  _qrInlineGenerated = true;

  container.innerHTML = '';
  container.style.width  = '90px';
  container.style.height = '90px';

  if (typeof QRCode !== 'undefined') {
    new QRCode(container, {
      text: url, width: 74, height: 74,
      colorDark: '#000000', colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
    const copyBtn = document.getElementById('qrCopyBtn');
    if (copyBtn) copyBtn.style.display = '';
    const panel = document.getElementById('qrInlinePanel');
    if (panel) {
      panel.style.borderColor='rgba(116,180,255,0.35)';
      panel.style.cursor='pointer';
      panel.title = 'Klikni pro zvětšení QR';
    }
    // Replace onclick to open fullscreen
    if (panel) panel.onclick = function(){ openQrFull(); };
  } else {
    container.innerHTML = '<div style="color:#f87171;font-size:9px;text-align:center;padding:8px">QR knihovna<br>se načítá…</div>';
    setTimeout(() => { _qrInlineGenerated = false; generateInlineQr(); }, 1500);
  }
}

function openQrFull() {
  const url = window._qrInlineUrl;
  if (!url) return;
  const modal = document.getElementById('qrFullModal');
  const canvas = document.getElementById('qrFullCanvas');
  if (!modal || !canvas) return;
  canvas.innerHTML = '';
  if (typeof QRCode !== 'undefined') {
    new QRCode(canvas, {
      text: url, width: 240, height: 240,
      colorDark: '#000000', colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  }
  modal.style.display = 'flex';
}

function closeQrFull() {
  const modal = document.getElementById('qrFullModal');
  if (modal) modal.style.display = 'none';
}

function copyInlineQrUrl() {
  const url = window._qrInlineUrl;
  if (!url) return;
  navigator.clipboard.writeText(url).then(() => {
    const btn = document.getElementById('qrCopyBtn');
    if (btn) { const orig = btn.textContent; btn.textContent = '✅ Zkopírováno!'; setTimeout(()=>btn.textContent=orig, 2000); }
  }).catch(() => { prompt('Zkopíruj odkaz:', url); });
}

function resetQrInline() {
  _qrInlineGenerated = false;
  const container = document.getElementById('qrInlineCanvas');
  if (container) container.innerHTML = '<div style="font-size:22px">📱</div>';
  const copyBtn = document.getElementById('qrCopyBtn');
  if (copyBtn) copyBtn.style.display = 'none';
  const panel = document.getElementById('qrInlinePanel');
  if (panel) {
    panel.style.borderColor='';
    panel.style.cursor='pointer';
    panel.onclick = function(){ generateInlineQr(); };
  }
  window._qrInlineUrl = null;
}

// ── Handle ?mode=camera (from QR scan on mobile) ───────────────
window.addEventListener('load', function() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('newlisting') !== '1' || params.get('mode') !== 'camera') return;
  history.replaceState({}, '', window.location.pathname);
  const tryLaunch = () => {
    if (!token) { setTimeout(tryLaunch, 300); return; }
    openAddListing();
    setTimeout(() => {
      const input = document.getElementById('aiPhotoInput');
      if (input) { input.setAttribute('capture', 'environment'); input.click(); }
    }, 600);
  };
  setTimeout(tryLaunch, 800);
});

function openChat(offerPrice, offerMsg, offerType, tradeCards) {
  if(!token){ showMktToast('🔒 Přihlas se pro psaní zpráv.'); return; }
  if(!currentListing) return;
  var l = currentListing;
  if(l.user_id === userId){ showMktToast('⚠️ Nemůžeš si psát sám sobě.'); return; }
  var sellerId   = l.user_id;
  var sellerName = l.username || '';
  var url = 'chat.html?with=' + encodeURIComponent(sellerId)
    + '&username=' + encodeURIComponent(sellerName)
    + '&listing='  + encodeURIComponent(l.id)
    + '&embedded=1';
  // Pokud voláno z sendOffer/sendTrade, předej parametry pro auto-odeslání
  if (offerPrice || offerMsg || offerType || tradeCards) {
    url += '&auto_send=1';
    if (offerPrice) url += '&offer_price=' + encodeURIComponent(offerPrice);
    if (offerMsg)   url += '&offer_msg='   + encodeURIComponent(offerMsg);
    if (offerType)  url += '&offer_type='  + encodeURIComponent(offerType);
    if (tradeCards) url += '&trade_cards=' + encodeURIComponent(tradeCards);
  }
  document.getElementById('chatIframeTitle').textContent = 'Chat s ' + sellerName;
  document.getElementById('chatIframe').src = url;
  document.getElementById('chatIframeModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeChatModal() {
  document.getElementById('chatIframeModal').style.display = 'none';
  document.getElementById('chatIframe').src = '';
  document.body.style.overflow = '';
}

// Zavřít modal klikem na pozadí
(function(){
  var m = document.getElementById('chatIframeModal');
  if(m) m.addEventListener('click', function(e){ if(e.target===this) closeChatModal(); });
})();

// Auto-open listing from chat link (?open=LISTING_ID)
(function checkOpenParam() {
  var p = new URLSearchParams(location.search);
  var openId = p.get('open');
  if (openId) {
    var check = setInterval(function() {
      var listing = allListings.find(function(l){ return l.id === openId; });
      if (listing) { clearInterval(check); showDetail(listing); }
    }, 200);
    setTimeout(function(){ clearInterval(check); }, 5000);
  }
})();

// ── Card Search Modal ─────────────────────────────────────────
let cardSearchMode = 'trade'; // 'trade' | 'listing'
let cardSearchSelected = null;

function openCardSearch(mode){
  cardSearchMode = mode || 'trade';
  cardSearchSelected = null;
  document.getElementById('cardSearchModal').classList.add('open');
  document.getElementById('csbName').value='';
  document.getElementById('csbSet').value='';
  document.getElementById('csbResults').innerHTML=
    '<div class="csb-empty">Zadej název Pokémona nebo sérii a stiskni Hledat.</div>';
  setTimeout(()=>document.getElementById('csbName').focus(), 80);
}

function closeCardSearch(){
  document.getElementById('cardSearchModal').classList.remove('open');
}

// Kliknutí mimo modal zavře
document.addEventListener('click', e=>{
  const modal = document.getElementById('cardSearchModal');
  if(modal && modal.classList.contains('open') && e.target === modal){
    closeCardSearch();
  }
});

async function searchCards(){
  const name = document.getElementById('csbName').value.trim();
  const set  = document.getElementById('csbSet').value.trim();
  if(!name && !set){ alert('Zadej alespoň název nebo sérii.'); return; }

  const wrap = document.getElementById('csbResults');
  wrap.innerHTML = '<div class="csb-loading">⏳ Hledám...</div>';

  // Zdroj: 'tcgio' nebo 'tcgdex'
  const forceSrc = document.getElementById('csbSourceToggle')?.dataset?.src || 'tcgio';

  try {
    let cards = [];
    let usedSrc = forceSrc;

    if (forceSrc !== 'tcgdex') {
      // ── pokemontcg.io ──
      const _buildQ = (n, s) => {
        let q = n ? `name:"${n.replace(/"/g,'')}"` : '';
        if (s) {
          const t = (typeof PkSearch !== 'undefined') ? PkSearch.detectSetType(s) : 'name';
          if (t === 'ptcgoCode') q += (q?' ':'') + `set.ptcgoCode:"${s}"`;
          else if (t === 'id')   q += (q?' ':'') + `set.id:"${s}"`;
          else                   q += (q?' ':'') + `set.name:"${s.replace(/"/g,'')}"`;
        }
        return q;
      };
      const q = _buildQ(name, set);
      const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=20&orderBy=name`;
      let res = await fetch(url);
      let json = await res.json();
      if (!json.data?.length && name) {
        const q2 = name + (set ? ` set.name:${set}` : '');
        const res2 = await tcgFetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q2)}&pageSize=20`);
        const json2 = await res2.json();
        json = json2;
      }
      cards = json.data || [];
      // Auto-fallback na TCGdex pokud nic
      if (!cards.length && name) {
        usedSrc = 'tcgdex';
      }
    }

    if (usedSrc === 'tcgdex') {
      // ── TCGdex ──
      const dexRes = await fetch(`https://api.tcgdex.net/v2/en/cards?name=${encodeURIComponent(name || set)}`);
      if (dexRes.ok) {
        const dexJson = await dexRes.json();
        if (Array.isArray(dexJson)) {
          cards = dexJson.slice(0, 20).map(c => ({
            _src: 'tcgdex',
            id:     c.id || `${c.set?.id}-${c.localId}`,
            name:   c.name || '',
            number: c.localId || '',
            rarity: c.rarity || '',
            images: { small: c.image ? c.image + '/low.webp' : '', large: c.image ? c.image + '/high.webp' : '' },
            set:    { name: c.set?.name || c.set?.id || '', id: c.set?.id || '' },
            hp:     c.hp ? String(c.hp) : '',
            types:  c.types || [],
          }));
        }
      }
    }

    if(!cards.length){
      // ── FALLBACK: Komunitní cache pro non-EN karty ─────────────────────
      // Pokud query obsahuje CJK znaky, zkus card-cache (RapidAPI Cardmarket).
      // Sdílí cache mezi všemi uživateli, hard limit 99 RapidAPI volání/den.
      const _hasCjk = /[\u3000-\u9fff\uff00-\uffef]/.test(name || '');
      const _looksJp = _hasCjk || /^(jp|jap|jp-)/i.test(set || '');
      if (_looksJp && typeof PkSearch !== 'undefined' && PkSearch.searchCardCache) {
        try {
          const cc = await PkSearch.searchCardCache(name, { set, lang: _hasCjk ? 'JP' : 'JP' });
          if (cc && cc.imageUrl) {
            // Adapt unified PkSearch tvar → marketplace tvar
            cards = [{
              _src:    'card-cache',
              id:      cc.apiId,
              name:    cc.name,
              number:  cc.number,
              rarity:  '',
              hp:      cc.hp || '',
              types:   cc.types || [],
              set:     { id: cc.setCode || '', name: cc.set || '' },
              images:  { small: cc.imageUrl, large: cc.imageUrl },
              cardmarket: cc.cardmarketUrl ? { url: cc.cardmarketUrl } : null,
              tcgplayer:  null,
            }];
            usedSrc = 'card-cache';
            console.log('[csb] card-cache hit:', cc.name);
          }
        } catch (e) {
          console.warn('[csb] card-cache fallback selhal:', e.message);
        }
      }
    }

    if(!cards.length){
      wrap.innerHTML='<div class="csb-empty">Žádné karty nenalezeny ani v pokemontcg.io ani v TCGdex.</div>';
      _renderCsbToggle(name, usedSrc);
      return;
    }

    wrap.innerHTML = [
      // Zdroj toggle
      `<div id="csbSourceToggle" data-src="${usedSrc}" style="display:flex;align-items:center;gap:6px;padding:6px 0 10px;flex-wrap:wrap;">
        <span style="font-size:10px;color:rgba(240,232,208,.35);letter-spacing:.06em;">ZDROJ:</span>
        <button onclick="_csbSwitch('tcgio')"  style="${_csbBtnStyle(usedSrc==='tcgio')}" >pokemontcg.io</button>
        <button onclick="_csbSwitch('tcgdex')" style="${_csbBtnStyle(usedSrc==='tcgdex')}">🔵 TCGdex</button>
        ${usedSrc==='tcgdex' && forceSrc!=='tcgdex' ? '<span style="font-size:10px;color:rgba(100,200,255,.6);">← pokemontcg.io nic nenašlo</span>' : ''}
      </div>`,
      ...cards.map(c=>{
        const img = c.images?.small || '';
        const setName = c.set?.name || '';
        const num  = c.number || '';
        const rarity = c.rarity || '';
        const isTcgdex = c._src === 'tcgdex' || usedSrc === 'tcgdex';
        return `<div class="csb-card-row" id="csr-${esc(c.id)}" onclick="selectSearchCard(${JSON.stringify(JSON.stringify(c))})">
          ${img ? `<img class="csb-card-img" src="${esc(img)}" loading="lazy">` : '<div style="width:40px;height:55px;background:rgba(255,255,255,0.05);border-radius:5px;flex-shrink:0"></div>'}
          <div class="csb-card-info">
            <div class="csb-card-name">${esc(c.name)}${isTcgdex?'<span style="margin-left:5px;font-size:9px;background:rgba(30,150,255,.2);color:rgba(100,200,255,.9);border-radius:3px;padding:1px 4px;font-weight:700;">TCGdex</span>':''}</div>
            <div class="csb-card-meta">${esc(setName)}${num?' · #'+esc(num):''}${rarity?' · '+esc(rarity):''}</div>
          </div>
          <button class="csb-card-select" onclick="event.stopPropagation();useSearchCard(${JSON.stringify(JSON.stringify(c))})">
            ${cardSearchMode==='trade' ? 'Nabídnout' : 'Vybrat'}
          </button>
        </div>`;
      })
    ].join('');

  } catch(e){
    wrap.innerHTML=`<div class="csb-empty">Chyba: ${esc(e.message)}</div>`;
  }
}

function _csbBtnStyle(active) {
  return `padding:4px 11px;border-radius:7px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;border:1px solid ${active?'rgba(245,200,66,.5)':'rgba(255,255,255,.1)'};background:${active?'rgba(245,200,66,.15)':'rgba(255,255,255,.04)'};color:${active?'#f5c842':'rgba(240,236,228,.4)'};`;
}

function _renderCsbToggle(name, usedSrc) {
  const wrap = document.getElementById('csbResults');
  const toggle = document.getElementById('csbSourceToggle');
  if (!toggle && wrap) {
    const div = document.createElement('div');
    div.id = 'csbSourceToggle';
    div.dataset.src = usedSrc;
    div.style.cssText = 'display:flex;align-items:center;gap:6px;padding:0 0 10px;flex-wrap:wrap;';
    div.innerHTML =
      `<span style="font-size:10px;color:rgba(240,232,208,.35);">ZDROJ:</span>` +
      `<button onclick="_csbSwitch('tcgio')"  style="${_csbBtnStyle(usedSrc==='tcgio')}" >pokemontcg.io</button>` +
      `<button onclick="_csbSwitch('tcgdex')" style="${_csbBtnStyle(usedSrc==='tcgdex')}">🔵 TCGdex</button>`;
    wrap.prepend(div);
  }
}

function _csbSwitch(src) {
  let toggle = document.getElementById('csbSourceToggle');
  if (!toggle) {
    toggle = document.createElement('div');
    toggle.id = 'csbSourceToggle';
    const wrap = document.getElementById('csbResults');
    if (wrap) wrap.prepend(toggle);
  }
  toggle.dataset.src = src;
  searchCards();
}

function selectSearchCard(jsonStr){
  const c = JSON.parse(jsonStr);
  // Highlight
  document.querySelectorAll('.csb-card-row').forEach(el=>el.classList.remove('selected'));
  const row = document.getElementById('csr-'+c.id);
  if(row) row.classList.add('selected');
  cardSearchSelected = c;
}

function useSearchCard(jsonStr){
  const c = JSON.parse(jsonStr);
  if(cardSearchMode === 'listing'){
    applyCardToListing(c);
    document.getElementById('addCardUrl').value = c.id;
    closeCardSearch();
  } else {
    // Přidá kartu do výměnného návrhu jako dočasnou kartu
    const tempId = 'search_'+c.id;
    // Přidej do myCards pokud tam ještě není
    if(!myCards.find(mc=>String(mc.id)===tempId)){
      myCards.push({
        id: tempId,
        name: c.name,
        set: c.set?.name||'',
        number: c.number||'',
        types: c.types||[],
        rarity: c.rarity||'',
        images: c.images||null,
        for_trade: true,
        _searched: true,
      });
    }
    selectedTradeIds.add(tempId);
    buildTradeCards();
    closeCardSearch();
  }
}

// Rovněž přepojíme tlačítko v add modal aby šlo přes search modal
function openCardSearchForListing(){
  openCardSearch('listing');
}

// ── Advanced filter → Sidebar sync ───────────────────────────
// When user picks in the dropdown panel, the left sidebar reacts.

function syncAdvTypeToSidebar(val) {
  const ALL_EL = ['fNormal','fFire','fWater','fElec','fGrass','fIce','fFighting','fPoison','fGround','fFlying','fPsychic','fBug','fRock','fGhost','fDragon','fDark','fMetal','fFairy'];
  if (!val) {
    // "Všechny typy" → zaškrtni vše
    ALL_EL.forEach(id => { const el = document.getElementById(id); if(el) el.checked = true; });
    return;
  }
  // Odškrtni vše, zaškrtni jen vybraný
  ALL_EL.forEach(id => { const el = document.getElementById(id); if(el) el.checked = false; });
  const map = {
    fire:      'fFire',
    water:     'fWater',
    grass:     'fGrass',
    lightning: 'fElec',
    electric:  'fElec',
    psychic:   'fPsychic',
    darkness:  'fDark',
    dark:      'fDark',
    dragon:    'fDragon',
    fighting:  'fFighting',
    metal:     'fMetal',
    steel:     'fMetal',
    colorless: 'fNormal',
    normal:    'fNormal',
    fairy:     'fFairy',
    ice:       'fIce',
    poison:    'fPoison',
    ground:    'fGround',
    flying:    'fFlying',
    bug:       'fBug',
    rock:      'fRock',
    ghost:     'fGhost',
  };
  const cbId = map[val];
  if (cbId) { const cb = document.getElementById(cbId); if(cb) cb.checked = true; }
  applyFilters();
}

function syncAdvRarityToSidebar(val) {
  ['fCommon','fRare','fUltra'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.checked = false;
  });
  if (!val) return;
  const map = {
    'common':                    'fCommon',
    'uncommon':                  'fCommon',
    'rare':                      'fRare',
    'rare holo':                 'fRare',
    'rare ultra':                'fUltra',
    'special illustration rare': 'fUltra',
    'hyper rare':                'fUltra',
    'illustration rare':         'fUltra',
  };
  const cbId = map[val];
  if (cbId) {
    const cb = document.getElementById(cbId);
    if (cb) cb.checked = true;
  }
  applyFilters();
}

function syncAdvCondToSidebar(val) {
  if (!val) {
    // "Všechny stavy" → restore all checkboxes to checked
    ['fNM','fLP','fMP','fHP'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = true;
    });
  } else {
    // Uncheck all, then check only the selected one
    ['fNM','fLP','fMP','fHP'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = false;
    });
    const map = { NM:'fNM', LP:'fLP', MP:'fMP', HP:'fHP', D:'fHP' };
    const cbId = map[val];
    if (cbId) {
      const cb = document.getElementById(cbId);
      if (cb) cb.checked = true;
    }
  }
  applyFilters();
}

function _syncSidebarToAdvDropdowns() {
  // Sync condition dropdown
  const condSel = document.getElementById('afCond');
  if (condSel) {
    const nm = document.getElementById('fNM')?.checked;
    const lp = document.getElementById('fLP')?.checked;
    const mp = document.getElementById('fMP')?.checked;
    const hp = document.getElementById('fHP')?.checked;
    const allOn = nm && lp && mp && hp;
    if (allOn) {
      condSel.value = '';
    } else if (nm && !lp && !mp && !hp) {
      condSel.value = 'NM';
    } else if (!nm && lp && !mp && !hp) {
      condSel.value = 'LP';
    } else if (!nm && !lp && mp && !hp) {
      condSel.value = 'MP';
    } else if (!nm && !lp && !mp && hp) {
      condSel.value = 'HP';
    } else {
      condSel.value = ''; // mixed selection → reset dropdown
    }
  }

  // Sync rarity dropdown
  const rarSel = document.getElementById('afRarity');
  if (rarSel) {
    const cm = document.getElementById('fCommon')?.checked;
    const ra = document.getElementById('fRare')?.checked;
    const ul = document.getElementById('fUltra')?.checked;
    if (!cm && !ra && !ul) rarSel.value = '';
    else if (cm && !ra && !ul)  rarSel.value = 'common';
    else if (!cm && ra && !ul)  rarSel.value = 'rare';
    else if (!cm && !ra && ul)  rarSel.value = 'rare ultra';
    else rarSel.value = ''; // multiple checked → reset
  }

  // Sync element/type dropdown
  const typSel = document.getElementById('afType');
  if (typSel) {
    const elMap = {
      fire:      document.getElementById('fFire')?.checked,
      water:     document.getElementById('fWater')?.checked,
      grass:     document.getElementById('fGrass')?.checked,
      lightning: document.getElementById('fElec')?.checked,
      psychic:   document.getElementById('fPsychic')?.checked,
      darkness:  document.getElementById('fDark')?.checked,
      dragon:    document.getElementById('fDragon')?.checked,
      metal:     document.getElementById('fMetal')?.checked,
      fairy:     document.getElementById('fFairy')?.checked,
      fighting:  document.getElementById('fFighting')?.checked,
      colorless: document.getElementById('fNormal')?.checked,
    };
    const active = Object.entries(elMap).filter(([,v])=>v).map(([k])=>k);
    if (active.length === 1) typSel.value = active[0];
    else typSel.value = '';
  }
}

// ── Album Compare ─────────────────────────────────────────────
let userAlbums = [];          // [{id, name, card_count}]
let albumCardsCache = {};     // albumId → Set of card names (lowercase)
let activeCompareAlbumId = null;
let albumPickerOpen = false;
let albumsLoaded = false;

async function loadUserAlbums() {
  if (!token || !userId || albumsLoaded) return;
  albumsLoaded = true;
  try {
    // Try user_albums table first
    const res = await sbReq(`rest/v1/user_albums?user_id=eq.${userId}&select=id,name,card_count&order=created_at.asc`, 'GET', null, token);
    if (Array.isArray(res) && !res._err && res.length > 0) {
      userAlbums = res;
    } else {
      // Fallback: treat myCards as single "Moje sbírka" album
      userAlbums = [{ id: '__mycards__', name: 'Moje sbírka', card_count: myCards.length }];
    }
  } catch(e) {
    userAlbums = [{ id: '__mycards__', name: 'Moje sbírka', card_count: myCards.length }];
  }
  renderAlbumPickerList();
  renderTapAlbumBtns();
}

function renderAlbumPickerList() {
  const wrap = document.getElementById('albumPickerList');
  if (!wrap) return;
  if (!userAlbums.length) {
    wrap.innerHTML = '<div class="album-picker-item" style="color:var(--text3);font-size:11px;pointer-events:none">Žádná alba nenalezena</div>';
    return;
  }
  // "All albums" option + each album
  const allItem = `<div class="album-picker-item ${activeCompareAlbumId === '__all__' ? 'sel' : ''}" onclick="selectCompareAlbum('__all__')">
    <span class="album-picker-icon">📚</span>
    <span>Všechna alba</span>
  </div>`;
  const items = userAlbums.map(a =>
    `<div class="album-picker-item ${activeCompareAlbumId === String(a.id) ? 'sel' : ''}" onclick="selectCompareAlbum('${esc(String(a.id))}')">
      <span class="album-picker-icon">📒</span>
      <span style="flex:1">${esc(a.name)}</span>
      ${a.card_count ? `<span style="font-size:10px;color:var(--text3)">${a.card_count} karet</span>` : ''}
    </div>`
  ).join('');
  wrap.innerHTML = allItem + items;
}

function toggleAlbumPicker() {
  albumPickerOpen = !albumPickerOpen;
  const drop = document.getElementById('albumPickerDrop');
  const btn  = document.getElementById('btnAlbumCompare');
  if (drop) drop.style.display = albumPickerOpen ? '' : 'none';
  if (btn)  btn.classList.toggle('active', albumPickerOpen || !!activeCompareAlbumId);
  if (albumPickerOpen) loadUserAlbums();
}

async function getAlbumCardNames(albumId) {
  if (albumCardsCache[albumId]) return albumCardsCache[albumId];
  const names = new Set();
  try {
    if (albumId === '__all__') {
      // Merge all album cards
      for (const a of userAlbums) {
        const sub = await getAlbumCardNames(String(a.id));
        sub.forEach(n => names.add(n));
      }
    } else if (albumId === '__mycards__') {
      myCards.forEach(c => {
        if (c.name) names.add(c.name.toLowerCase());
      });
    } else {
      // Load from user_cards for this album
      const res = await sbReq(`rest/v1/user_cards?user_id=eq.${userId}&album_id=eq.${albumId}&select=card_data`, 'GET', null, token);
      if (Array.isArray(res)) {
        res.forEach(r => {
          const n = r.card_data?.name;
          if (n) names.add(n.toLowerCase());
        });
      }
      // Fallback: if empty try without album_id filter (use myCards)
      if (!names.size) {
        myCards.forEach(c => { if (c.name) names.add(c.name.toLowerCase()); });
      }
    }
  } catch(e) {
    myCards.forEach(c => { if (c.name) names.add(c.name.toLowerCase()); });
  }
  albumCardsCache[albumId] = names;
  return names;
}

async function selectCompareAlbum(albumId) {
  activeCompareAlbumId = albumId;
  albumPickerOpen = false;
  const drop = document.getElementById('albumPickerDrop');
  const btn  = document.getElementById('btnAlbumCompare');
  if (drop) drop.style.display = 'none';

  // Load cards for this album
  const albumNames = await getAlbumCardNames(albumId);

  // Show banner
  const banner = document.getElementById('compareBanner');
  const bannerLabel = document.getElementById('compareBannerLabel');
  const bannerCount = document.getElementById('compareBannerCount');
  const badge = document.getElementById('acBadge');

  let albumName = albumId === '__all__' ? 'Všechna alba' : (userAlbums.find(a=>String(a.id)===albumId)?.name || 'Alba');
  if (btn) btn.classList.add('active');

  // Re-render picker list with selection
  renderAlbumPickerList();
  // Apply the compare filter
  applyFilters();

  // Count how many filtered listings are missing
  const missing = filteredListings.filter(l => {
    const cardName = (l.card_name || (l.cards_data?.[0]?.name) || '').toLowerCase();
    return cardName && !albumNames.has(cardName);
  }).length;

  if (banner) banner.style.display = '';
  if (bannerLabel) bannerLabel.textContent = 'Karty chybějící v: ' + albumName;
  if (bannerCount) bannerCount.textContent = `· ${missing} nabídek s kartami, které nemáš`;
  if (badge) { badge.textContent = missing; badge.style.display = missing ? '' : 'none'; }
}

function clearAlbumCompare() {
  activeCompareAlbumId = null;
  albumPickerOpen = false;
  const banner = document.getElementById('compareBanner');
  const badge  = document.getElementById('acBadge');
  const btn    = document.getElementById('btnAlbumCompare');
  const drop   = document.getElementById('albumPickerDrop');
  if (banner) banner.style.display = 'none';
  if (badge)  badge.style.display = 'none';
  if (btn)    btn.classList.remove('active');
  if (drop)   drop.style.display = 'none';
  renderAlbumPickerList();
  applyFilters();
}

// ── Trade: Album card finder ──────────────────────────────────
let tradeAlbumPickerOpen = false;
let selectedTradeAlbumId = null;
let tradeAlbumQueuedIds = new Set(); // cards queued to offer

function renderTapAlbumBtns() {
  const wrap = document.getElementById('tapAlbumBtns');
  if (!wrap) return;
  const allBtn = `<button class="tap-album-btn ${selectedTradeAlbumId === '__all__' ? 'sel' : ''}" onclick="selectTradeAlbum('__all__')">📚 Všechna alba</button>`;
  const albumBtns = userAlbums.map(a =>
    `<button class="tap-album-btn ${selectedTradeAlbumId === String(a.id) ? 'sel' : ''}" onclick="selectTradeAlbum('${esc(String(a.id))}')">📒 ${esc(a.name)}</button>`
  ).join('');
  wrap.innerHTML = allBtn + albumBtns;
}

async function toggleTradeAlbumPicker() {
  tradeAlbumPickerOpen = !tradeAlbumPickerOpen;
  const wrap = document.getElementById('tradeAlbumPicker');
  if (wrap) wrap.style.display = tradeAlbumPickerOpen ? '' : 'none';
  if (tradeAlbumPickerOpen) {
    await loadUserAlbums();
    renderTapAlbumBtns();
    // Auto-select first album if only one
    if (!selectedTradeAlbumId && userAlbums.length === 1) {
      await selectTradeAlbum(String(userAlbums[0].id));
    }
  }
}

async function selectTradeAlbum(albumId) {
  selectedTradeAlbumId = albumId;
  renderTapAlbumBtns();
  await renderTradeAlbumMatches();
}

async function renderTradeAlbumMatches() {
  const wrap = document.getElementById('tradeAlbumResults');
  if (!wrap || !currentListing) return;
  wrap.innerHTML = '<div class="tam-empty">⏳ Hledám shody...</div>';

  const keywords = parseTradeWants(currentListing.trade_wants || '');
  if (!keywords.length) {
    wrap.innerHTML = '<div class="tam-empty">Prodejce nespecifikoval, co chce za výměnu.</div>';
    return;
  }

  // Get cards from selected album
  let albumCards = [];
  try {
    if (selectedTradeAlbumId === '__all__') {
      albumCards = myCards;
    } else if (selectedTradeAlbumId === '__mycards__') {
      albumCards = myCards;
    } else {
      const res = await sbReq(`rest/v1/user_cards?user_id=eq.${userId}&album_id=eq.${selectedTradeAlbumId}&select=local_id,card_data,for_trade`, 'GET', null, token);
      if (Array.isArray(res) && res.length > 0) {
        albumCards = res.map(r => ({ ...r.card_data, id: r.local_id, for_trade: r.for_trade }));
      } else {
        albumCards = myCards; // fallback
      }
    }
  } catch(e) {
    albumCards = myCards;
  }

  // Find matches
  const matchIds = computeTradeMatches(keywords, albumCards);
  const matched = albumCards.filter(c => matchIds.has(String(c.id)));

  if (!matched.length) {
    wrap.innerHTML = '<div class="tam-empty">😔 Žádná shoda v tomto albu s tím, co prodejce chce.</div>';
    return;
  }

  wrap.innerHTML = matched.slice(0, 20).map(c => {
    const img = c.images?.small || c.apiSmall || c.imageUrl || '';
    const isQueued = tradeAlbumQueuedIds.has(String(c.id));
    return `<div class="trade-album-match-row ${isQueued ? 'queued' : ''}" id="tam-${esc(String(c.id))}">
      ${img ? `<img class="tam-img" src="${esc(img)}" loading="lazy">` : '<div class="tam-img" style="display:flex;align-items:center;justify-content:center;font-size:18px">🃏</div>'}
      <div class="tam-info">
        <div class="tam-name">${esc(c.name || '?')}</div>
        <div class="tam-meta">${esc(c.set || '')}${c.number ? ' #'+esc(c.number||c.num||'') : ''}${c.for_trade ? ' · <span style="color:#4ade80">k výměně</span>' : ''}</div>
      </div>
      <button class="tam-add ${isQueued ? 'done' : ''}" onclick="queueTradeAlbumCard(${JSON.stringify(JSON.stringify(c))})">
        ${isQueued ? '✓ Přidáno' : 'Nabídnout'}
      </button>
    </div>`;
  }).join('');

  if (matched.length > 0) {
    wrap.innerHTML += renderTradeOfferConfirmUI();
  }
}

function renderTradeOfferConfirmUI() {
  if (tradeAlbumQueuedIds.size === 0) return '';
  return `<div class="trade-offer-confirm">
    <span style="font-size:12px;color:var(--text2)">📬 ${tradeAlbumQueuedIds.size} karet připraveno k nabídnutí</span>
    <button class="trade-offer-confirm-btn" onclick="sendTradeAlbumOffer()">Poslat nabídku</button>
  </div>`;
}

function queueTradeAlbumCard(jsonStr) {
  const c = JSON.parse(jsonStr);
  const id = String(c.id);
  if (tradeAlbumQueuedIds.has(id)) {
    tradeAlbumQueuedIds.delete(id);
  } else {
    tradeAlbumQueuedIds.add(id);
    // Also add to selectedTradeIds so sendTrade() works
    selectedTradeIds.add(id);
    // Add to myCards if not there
    if (!myCards.find(mc => String(mc.id) === id)) {
      myCards.push({ ...c, for_trade: true });
    }
  }
  // Re-render matches and confirm UI
  renderTradeAlbumMatches();
}

async function sendTradeAlbumOffer() {
  if (tradeAlbumQueuedIds.size === 0) { alert('Vyber alespoň jednu kartu k nabídnutí.'); return; }
  // Confirm dialog
  const confirmed = confirm(`Opravdu odeslat nabídku výměny s ${tradeAlbumQueuedIds.size} kartami prodejci ${esc(currentListing?.username || '?')}?`);
  if (!confirmed) return;

  const selCards = myCards.filter(c => tradeAlbumQueuedIds.has(String(c.id)));
  const l = currentListing;
  const res = await sbReq('rest/v1/offers', 'POST', {
    listing_id: l.id,
    seller_id:  l.user_id,
    buyer_id:   userId,
    buyer_username: username,
    offer_type: 'trade',
    trade_card_ids: selCards.map(c => String(c.id)),
    trade_card_names: selCards.map(c => c.name).join(', '),
    message: `Nabídka z Alba: ${selCards.map(c=>c.name).join(', ')}`,
    status: 'pending',
  }, token);

  if (res._err) { alert('Chyba: ' + res._err); return; }
  alert('✅ Nabídka výměny odeslána!');
  tradeAlbumQueuedIds.clear();
  document.getElementById('tradeAlbumPicker').style.display = 'none';
  tradeAlbumPickerOpen = false;
}

// ══════════════════════════════════════════════════════════════
// POPTÁVKY – DEMAND SYSTEM
// ══════════════════════════════════════════════════════════════

var marketMode = 'offer'; // 'offer' | 'demand'
let allDemands = [], filteredDemands = [];
let demandCardData = null;
let currentDemandId = null;
let demandsLoaded = false;

// ── Mode switcher ─────────────────────────────────────────────
function setMarketMode(mode) {
  marketMode = mode;
  const isOffer  = mode === 'offer';
  const isDemand = mode === 'demand';

  document.getElementById('mmtOffer').classList.toggle('active', isOffer);
  document.getElementById('mmtDemand').classList.toggle('active', isDemand);

  document.getElementById('listView').style.display      = isOffer  ? '' : 'none';
  document.getElementById('demandsView').style.display   = isDemand ? '' : 'none';
  document.getElementById('detailView').style.display    = 'none';

  document.getElementById('btnAddOffer').style.display   = isOffer  ? '' : 'none';
  document.getElementById('btnAddDemand').style.display  = isDemand ? '' : 'none';
  document.getElementById('btnPendingQueue').style.display = isOffer ? '' : 'none';

  // Sidebar filters that don't apply to demands
  ['fSell','fTrade','fNM','fLP','fMP','fHP'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.closest('.filter-opt').style.opacity = isDemand ? '0.35' : '1';
  });

  if (isDemand && !demandsLoaded) {
    loadDemands();
  } else if (isDemand) {
    applyDemandFilters();
  }
}

// ── Load demands ──────────────────────────────────────────────
async function loadDemands() {
  document.getElementById('demandsWrap').innerHTML =
    Array(4).fill('<div class="skeleton-row" style="height:100px;margin-bottom:10px"></div>').join('');
  const res = await sbReq('rest/v1/demands?status=eq.active&select=*&order=created_at.desc&limit=100');
  if (!Array.isArray(res) || res._err) {
    document.getElementById('demandsWrap').innerHTML =
      '<div class="empty-state"><div class="icon">⚠️</div><h3>Chyba načítání poptávek</h3><p>Zkus obnovit stránku</p></div>';
    return;
  }
  allDemands = res;
  demandsLoaded = true;
  applyDemandFilters();
}

// ── Apply demand filters ──────────────────────────────────────
function applyDemandFilters() {
  // Use both demand-specific search AND main toolbar search
  const dq   = (document.getElementById('demandSearch')?.value || '').toLowerCase().trim();
  const mq   = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
  const q    = dq || mq;
  const sort = document.getElementById('demandSortSel')?.value || 'newest';

  // Sidebar condition filters
  const condChecks = {
    NM: document.getElementById('fNM')?.checked ?? true,
    LP: document.getElementById('fLP')?.checked ?? true,
    MP: document.getElementById('fMP')?.checked ?? true,
    HP: document.getElementById('fHP')?.checked || false,
    D:  document.getElementById('fHP')?.checked || false,
  };

  let list = allDemands.filter(d => {
    // Text filter
    if (q) {
      const name = (d.card_name || d.title || '').toLowerCase();
      const user = (d.username || '').toLowerCase();
      const set  = (d.card_set || '').toLowerCase();
      const notes = (d.notes || '').toLowerCase();
      if (!name.includes(q) && !user.includes(q) && !set.includes(q) && !notes.includes(q)) return false;
    }
    // Condition filter (min_condition)
    const mc = d.min_condition || 'NM';
    if (!condChecks[mc]) return false;
    return true;
  });

  list.sort((a, b) => {
    if (sort === 'price_desc') return (b.max_price_czk || 0) - (a.max_price_czk || 0);
    if (sort === 'price_asc')  return (a.max_price_czk || 0) - (b.max_price_czk || 0);
    if (sort === 'responses')  return (b.response_count || 0) - (a.response_count || 0);
    return new Date(b.created_at) - new Date(a.created_at);
  });

  filteredDemands = list;
  document.getElementById('demandCountInfo').textContent = `${list.length} poptávek`;
  renderDemands(list);
}

// ── Render demands ────────────────────────────────────────────
function renderDemands(list) {
  const wrap = document.getElementById('demandsWrap');
  if (!list.length) {
    wrap.innerHTML = `
      <div class="empty-state">
        <div class="icon">🔍</div>
        <h3>Žádné poptávky</h3>
        <p>Buď první, kdo zadá co hledá!</p>
      </div>`;
    return;
  }

  wrap.innerHTML = list.map(d => {
    const img      = d.api_image_url || '';
    const name     = esc(d.card_name || d.title || 'Neznámá karta');
    const setInfo  = d.card_set ? `<span class="demand-set">${esc(d.card_set)}${d.card_number ? ' · #' + esc(d.card_number) : ''}</span>` : '';
    const price    = d.max_price_czk ? `<span class="demand-max-price">Max ${d.max_price_czk.toLocaleString('cs-CZ')} Kč</span>` : '<span class="demand-max-price-any">Dohodou</span>';
    const cond     = d.min_condition || 'NM';
    const condMap  = { NM: '🟢', LP: '🟡', MP: '🟠', HP: '🔴', D: '⚫' };
    const condDot  = condMap[cond] || '🟢';
    const tradeTag = d.accept_trade ? '<span class="demand-tag trade-tag">🔄 Výměna OK</span>' : '';
    const respCnt  = d.response_count || 0;
    const isOwn    = userId && d.user_id === userId;
    const ago      = timeAgo(d.created_at);
    const notes    = d.notes ? `<div class="demand-notes">"${esc(d.notes)}"</div>` : '';
    const sealedTag = d.item_type === 'sealed' ? `<span class="demand-tag" style="background:rgba(168,85,247,0.15);color:#a855f7;border:1px solid rgba(168,85,247,0.25)">📦 Sealed${d.product_type ? ' · ' + esc(d.product_type) : ''}</span>` : '';
    const locTag   = d.location ? `<span class="demand-tag" style="background:rgba(255,255,255,0.05);color:var(--text3);border:1px solid var(--border)">📍 ${esc(d.location)}</span>` : '';
    const delTags  = [];
    if (d.delivery_post) delTags.push('📬');
    if (d.delivery_personal) delTags.push('🤝');
    const delStr   = delTags.length ? `<span class="demand-tag" style="background:rgba(255,255,255,0.05);color:var(--text3);border:1px solid var(--border)">${delTags.join(' ')}</span>` : '';
    // Trade cards previews
    const tc = d.trade_cards || [];
    const tradeImgs = tc.length ? `<div style="display:flex;gap:3px;margin-top:5px">${tc.slice(0,4).map(c =>
      c.imgSmall ? `<img src="${esc(c.imgSmall)}" style="width:28px;height:38px;border-radius:4px;object-fit:cover;border:1px solid rgba(255,255,255,0.1)" title="${esc(c.name)}" loading="lazy">` : ''
    ).join('')}${tc.length > 4 ? `<span style="font-size:10px;color:var(--text3);align-self:center">+${tc.length-4}</span>` : ''}</div>` : '';

    return `
    <div class="demand-card" onclick="openDemandDetail('${d.id}')">
      <div class="demand-card-img-wrap">
        ${img
          ? `<img src="${esc(img)}" class="demand-card-img" loading="lazy" onerror="this.style.display='none'">`
          : `<div class="demand-card-placeholder">${d.item_type === 'sealed' ? '📦' : '🔍'}</div>`}
        <div class="demand-card-overlay">${d.item_type === 'sealed' ? 'Hledám sealed' : 'Hledám'}</div>
      </div>
      <div class="demand-card-body">
        <div class="demand-card-top">
          <div class="demand-card-name">${name}</div>
          ${setInfo}
        </div>
        ${notes}
        ${tradeImgs}
        <div class="demand-card-tags">
          ${sealedTag}
          ${tradeTag}
          <span class="demand-tag cond-tag">${condDot} Min. ${cond}</span>
          ${d.card_type ? `<span class="demand-tag type-tag">${esc(d.card_type)}</span>` : ''}
          ${locTag}${delStr}
        </div>
        <div class="demand-card-footer">
          <div class="demand-card-price">${price}</div>
          <div class="demand-card-meta">
            <span class="demand-user">@${esc(d.username)}</span>
            <span class="demand-dot">·</span>
            <span class="demand-ago">${ago}</span>
            ${respCnt > 0 ? `<span class="demand-dot">·</span><span class="demand-resp-cnt">${respCnt} reakcí</span>` : ''}
          </div>
        </div>
      </div>
      <div class="demand-card-actions" onclick="event.stopPropagation()">
        ${isOwn
          ? `<button class="btn-demand-own" onclick="deleteDemand('${d.id}')">🗑️ Smazat</button>`
          : `<button class="btn-demand-respond" onclick="openDemandRespond('${d.id}','${name.replace(/'/g,"\\'")}')" ${!token ? 'title="Přihlaš se"' : ''}>✉️ Nabídnout kartu</button>`}
      </div>
    </div>`;
  }).join('');
}

// ── Detail / expanded view for demand ────────────────────────
function openDemandDetail(id) {
  // For now scroll to and highlight – a full detail page can be added later
  // Focus response button
  const card = document.querySelector(`[onclick*="openDemandDetail('${id}')"]`);
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ── Open / close demand respond ───────────────────────────────
async function openDemandRespond(demandId, cardName) {
  if (!token) { alert('Přihlaš se pro reakci na poptávku.'); return; }
  currentDemandId = demandId;
  document.getElementById('drModalCardName').textContent = `Poptávka: ${cardName}`;
  document.getElementById('drPrice').value = '';
  document.getElementById('drMessage').value = '';
  document.getElementById('drCond').selectedIndex = 0;

  // Load my active listings for this card (or all)
  const pickWrap = document.getElementById('drMyListingsPick');
  pickWrap.innerHTML = '<div style="font-size:11px;color:var(--text3);padding:4px">⏳ Načítám tvé nabídky...</div>';
  document.getElementById('demandRespondModal').style.display = 'flex';

  const res = await sbReq(`rest/v1/listings?user_id=eq.${userId}&status=eq.active&select=id,card_name,card_set,price_czk,card_condition&order=created_at.desc&limit=20`, 'GET', null, token);
  if (Array.isArray(res) && res.length) {
    pickWrap.innerHTML = res.map(l => `
      <label class="dr-listing-pick-item">
        <input type="radio" name="drLinkedListing" value="${l.id}" style="accent-color:#22d3ee">
        <span class="dr-listing-label">
          <strong>${esc(l.card_name||'—')}</strong>
          ${l.card_set ? `<span style="color:var(--text3)"> · ${esc(l.card_set)}</span>` : ''}
          ${l.price_czk ? `<span class="dr-listing-price">${l.price_czk.toLocaleString('cs-CZ')} Kč</span>` : ''}
        </span>
      </label>`).join('');
  } else {
    pickWrap.innerHTML = '<div style="font-size:11px;color:var(--text3);padding:4px">Nemáš žádné aktivní nabídky – zadej cenu ručně níže.</div>';
  }
}

function closeDemandRespond() {
  document.getElementById('demandRespondModal').style.display = 'none';
  currentDemandId = null;
}

async function submitDemandResponse() {
  if (!token) { alert('Přihlaš se.'); return; }
  if (!currentDemandId) return;

  const price   = parseInt(document.getElementById('drPrice').value) || null;
  const cond    = document.getElementById('drCond').value;
  const message = document.getElementById('drMessage').value.trim() || null;
  const picked  = document.querySelector('input[name="drLinkedListing"]:checked');
  const listingId = picked ? picked.value : null;

  const payload = {
    demand_id:    currentDemandId,
    user_id:      userId,
    username:     username,
    listing_id:   listingId,
    price_czk:    price,
    card_condition: cond,
    message:      message,
    status:       'pending',
  };

  const res = await sbReq('rest/v1/demand_responses', 'POST', payload, token);
  if (res._err) { alert('Chyba: ' + res._err); return; }

  // Bump response count locally
  const d = allDemands.find(x => x.id === currentDemandId);
  if (d) d.response_count = (d.response_count || 0) + 1;

  alert('✅ Tvá nabídka byla odeslána hledači!');
  closeDemandRespond();
  applyDemandFilters();
}

// ── Open / close demand creation ─────────────────────────────
function openAddDemand() {
  if (!token) { alert('Přihlaš se pro přidání poptávky.'); return; }
  document.getElementById('addDemandModal').style.display = 'flex';
  document.getElementById('demandCardUrl').value = '';
  document.getElementById('demandMaxPrice').value = '';
  document.getElementById('demandNotes').value = '';
  document.getElementById('demandAcceptTrade').checked = false;
  document.getElementById('demandMinCond').selectedIndex = 0;
  clearDemandCard();
}

function closeAddDemand() {
  document.getElementById('addDemandModal').style.display = 'none';
  demandCardData = null;
}

function clearDemandCard() {
  demandCardData = null;
  document.getElementById('demandCardPreview').style.display = 'none';
  document.getElementById('demandCardImg').src = '';
  document.getElementById('demandCardName').textContent = '';
  document.getElementById('demandCardMeta').textContent = '';
}

async function fetchCardForDemand() {
  const url = document.getElementById('demandCardUrl').value.trim();
  if (!url) return;
  const q      = `name:"${url}"`;
  const apiUrl = url.includes('pokemontcg.io')
    ? url
    : `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=1`;
  try {
    const res  = await fetch(apiUrl);
    const json = await res.json();
    const card = json?.data?.[0] || json;
    if (!card?.name) { alert('Karta nenalezena.'); return; }
    applyDemandCard(card);
  } catch(e) { alert('Chyba: ' + e.message); }
}

function applyDemandCard(card) {
  demandCardData = card;
  document.getElementById('demandCardImg').src  = card.images?.small || '';
  document.getElementById('demandCardName').textContent = card.name;
  document.getElementById('demandCardMeta').textContent =
    (card.set?.name || '') + (card.number ? ' #' + card.number : '');
  document.getElementById('demandCardPreview').style.display = 'flex';
}

async function submitDemand() {
  if (!token) { alert('Přihlaš se.'); return; }
  const card     = demandCardData;
  const maxPrice = parseInt(document.getElementById('demandMaxPrice').value) || null;
  const minCond  = document.getElementById('demandMinCond').value;
  const notes    = document.getElementById('demandNotes').value.trim() || null;
  const trade    = document.getElementById('demandAcceptTrade').checked;

  if (!card) { alert('Vyber kartu, kterou hledáš.'); return; }

  const payload = {
    user_id:       userId,
    username:      username,
    card_name:     card.name,
    card_set:      card.set?.name || '',
    card_number:   card.number || '',
    card_type:     card.types?.[0] || '',
    card_rarity:   card.rarity || '',
    api_image_url: card.images?.large || card.images?.small || '',
    cards_data:    [card],
    max_price_czk: maxPrice,
    min_condition: minCond,
    accept_trade:  trade,
    notes:         notes,
    status:        'active',
    response_count: 0,
  };

  const res = await sbReq('rest/v1/demands', 'POST', payload, token);
  if (res._err) { alert('Chyba: ' + res._err); return; }

  alert('✅ Poptávka zveřejněna!');
  closeAddDemand();
  const newDemand = Array.isArray(res) ? res[0] : res;
  if (newDemand) allDemands.unshift(newDemand);
  demandsLoaded = true;
  applyDemandFilters();
}

async function deleteDemand(id) {
  if (!token) return;
  if (!confirm('Opravdu smazat tuto poptávku?')) return;
  const res = await sbReq(`rest/v1/demands?id=eq.${id}`, 'DELETE', null, token);
  if (res._err) { alert('Chyba: ' + res._err); return; }
  allDemands = allDemands.filter(d => d.id !== id);
  applyDemandFilters();
}

// ── AI photo scan for demand modal ───────────────────────────
function handleDemandAiDrop(e) {
  e.preventDefault();
  document.getElementById('demandAiDropZone').classList.remove('drag-over');
  const file = e.dataTransfer.files?.[0];
  if (file && file.type.startsWith('image/')) handleDemandAiPhoto(file);
}

async function handleDemandAiPhoto(file) {
  if (!file) return;
  const zone = document.getElementById('demandAiDropZone');
  const reader = new FileReader();
  reader.onload = async (ev) => {
    const base64  = ev.target.result.split(',')[1];
    const mime    = file.type || 'image/jpeg';
    const imgSrc  = ev.target.result;
    zone.innerHTML = `
      <div style="position:relative;width:100%;display:flex;align-items:center;justify-content:center;min-height:90px">
        <img src="${imgSrc}" style="max-height:90px;max-width:100%;border-radius:9px;object-fit:contain;opacity:0.45">
        <div class="ai-scanning-overlay" style="border-radius:9px">
          <div class="ai-scanner-line"></div>
          <div class="ai-scanning-text">🤖 AI identifikuje...</div>
        </div>
      </div>`;
    try {
      const aiResult = await callClaudeVision(base64, mime);
      if (aiResult?.name) {
        const q   = `name:"${aiResult.name}"${aiResult.setName ? ` set.name:"${aiResult.setName}"` : ''}`;
        const res = await tcgFetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=1`);
        const json = await res.json();
        const card = json?.data?.[0];
        if (card) {
          applyDemandCard(card);
          zone.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:8px">
            <img src="${esc(card.images?.small||imgSrc)}" style="height:60px;border-radius:6px;object-fit:contain">
            <div>
              <div style="font-size:13px;font-weight:700;color:#22d3ee">✅ ${esc(card.name)}</div>
              <div style="font-size:11px;color:var(--text3)">${esc(card.set?.name||'')}${card.number?' · #'+card.number:''}</div>
              <button onclick="document.getElementById('demandAiPhotoInput').click()" style="font-size:10px;color:var(--text3);background:none;border:1px solid var(--border);border-radius:5px;padding:2px 8px;cursor:pointer;margin-top:4px">📸 Znovu</button>
            </div>
          </div>`;
          return;
        }
      }
      // Fallback: show manual hint
      zone.innerHTML = `<div style="padding:10px;font-size:12px;color:var(--text3);text-align:center">
        ❓ AI nenašla kartu – zkus hledat ručně<br>
        <button onclick="document.getElementById('demandAiPhotoInput').click()" style="margin-top:6px;font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text3);cursor:pointer">📸 Zkusit znovu</button>
      </div>`;
    } catch (err) {
      zone.innerHTML = `<div style="padding:10px;font-size:12px;color:var(--red);text-align:center">AI chyba: ${esc(err.message)}</div>`;
    }
  };
  reader.readAsDataURL(file);
}

// ── Card search for demand ────────────────────────────────────
// Extend the existing openCardSearch to support 'demand' mode
const _origOpenCardSearch = typeof openCardSearch === 'function' ? openCardSearch : null;
function openCardSearch(mode) {
  window._cardSearchMode = mode;
  document.getElementById('cardSearchModal').style.display = 'flex';
  document.getElementById('csbResults').innerHTML =
    '<div class="csb-empty">Zadej název Pokémona nebo sérii a stiskni Hledat.</div>';
}

// Patch pickCard to also handle demand mode
const _origPickCard = typeof pickCard === 'function' ? pickCard : null;
const _origCsbPickCard = window.csbPickCard;

// Override csbPickCard to handle demand mode
window.csbPickCard = function(cardId) {
  const mode = window._cardSearchMode || 'listing';
  if (!window._csbCardCache) window._csbCardCache = {};
  const card = window._csbCardCache[cardId];
  if (!card) return;

  if (mode === 'demand') {
    applyDemandCard(card);
    closeCardSearch();
  } else if (mode === 'listing') {
    applyAiCard(card, null, 'high');
    closeCardSearch();
  } else if (mode === 'trade') {
    // existing trade behavior
    if (_origCsbPickCard) _origCsbPickCard(cardId);
    else closeCardSearch();
  } else {
    if (_origCsbPickCard) _origCsbPickCard(cardId);
    else closeCardSearch();
  }
};

// ── Helper: time ago ──────────────────────────────────────────
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60)   return 'před chvílí';
  if (diff < 3600) return `před ${Math.floor(diff/60)} min`;
  if (diff < 86400)return `před ${Math.floor(diff/3600)} h`;
  if (diff < 604800) return `před ${Math.floor(diff/86400)} dny`;
  return new Date(dateStr).toLocaleDateString('cs-CZ');
}


// ══════════════════════════════════════════════════════════════
// MKT LIGHTBOX
// ══════════════════════════════════════════════════════════════
function openMktLightbox(src) {
  const modal = document.getElementById('mktLightbox');
  const img   = document.getElementById('mktLightboxImg');
  if (!modal || !img) return;
  img.src = src;
  modal.style.display = 'flex';
}
function closeMktLightbox() {
  const modal = document.getElementById('mktLightbox');
  if (modal) modal.style.display = 'none';
}
function openCardImgZoom(smallSrc, largeSrc) {
  openMktLightbox(largeSrc || smallSrc);
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeMktLightbox(); closeQrFull(); cancelMktCrop(); }
});

// ══════════════════════════════════════════════════════════════
// SALE PHOTOS (card listing) – with lightbox + crop
// ══════════════════════════════════════════════════════════════

function handleSalePhotos(files) {
  if (!files || !files.length) return;
  Array.from(files).forEach(file => {
    const reader = new FileReader();
    reader.onload = ev => {
      salePhotos.push({ src: ev.target.result, base64: ev.target.result.split(',')[1], mime: file.type });
      renderSalePhotos();
    };
    reader.readAsDataURL(file);
  });
}

function handleSalePhotoDrop(e) {
  e.preventDefault();
  if (e.dataTransfer?.files) handleSalePhotos(e.dataTransfer.files);
}

function removeSalePhoto(idx) {
  salePhotos.splice(idx, 1);
  renderSalePhotos();
}

function renderSalePhotos() {
  const strip = document.getElementById('salePhotosStrip');
  if (!strip) return;
  // Skrýt officialCardWrap – official obrázek je teď první v stripu
  const ow = document.getElementById('officialCardWrap');
  if (ow) ow.style.display = 'none';
  let html = '';
  salePhotos.forEach((p, i) => {
    const src = p.croppedUrl || p.src;
    const srcEsc = src.replace(/'/g, "\\'");
    if (p.isOfficial) {
      // Nemazatelný slot – jen lupa, žádný crop ani delete
      html += `<div class="sale-photo-tile" id="saleTile-${i}" title="Oficialní obrázek z API">
        <img src="${src}" class="sale-photo-img" style="object-fit:contain" onclick="openMktLightbox('${srcEsc}')">
        <div class="sale-photo-actions">
          <button onclick="openMktLightbox('${srcEsc}')" class="spt-zoom-btn" title="Zvětšit">🔍</button>
        </div>
        <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.72);font-size:8px;color:rgba(255,255,255,0.65);text-align:center;padding:2px 0;letter-spacing:.04em;pointer-events:none">Ofic. API</div>
      </div>`;
    } else {
      html += `<div class="sale-photo-tile" id="saleTile-${i}">
        <img src="${src}" class="sale-photo-img" onclick="openMktLightbox('${srcEsc}')">
        <div class="sale-photo-actions">
          <button onclick="openMktLightbox('${srcEsc}')" class="spt-zoom-btn" title="Zvětšit">🔍</button>
          <button onclick="openSaleCrop(${i})" class="spt-crop-btn" title="Oříznout">✂️</button>
          <button onclick="removeSalePhoto(${i})" class="spt-del-btn" title="Smazat">✕</button>
        </div>
        ${p.croppedUrl ? '<div class="spt-cropped-badge">✂️</div>' : ''}
      </div>`;
    }
  });
  html += `<div class="sale-photo-add" onclick="document.getElementById('salePhotoInput').click()" ondragover="event.preventDefault();this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="handleSalePhotoDrop(event)">
    <input type="file" id="salePhotoInput" accept="image/*" multiple style="display:none" onchange="handleSalePhotos(this.files)">
    <div style="font-size:22px">➕</div>
    <div style="font-size:10px;color:var(--text3);margin-top:2px">Přidat foto</div>
  </div>`;
  strip.innerHTML = html;
}

// ══════════════════════════════════════════════════════════════
// MKT CROP ENGINE  (ported from queue.html)
// ══════════════════════════════════════════════════════════════
const MKT_CROP = {
  img: null, mode: 'loupe', drag: null, dragPos: null, scale: 1,
  corners: [{x:0,y:0},{x:0,y:0},{x:0,y:0},{x:0,y:0}],
  targetArr: null,  // salePhotos | prodPhotos
  targetIdx: null,
};
const MKT_HANDLE_R = 22;

function setMktCropMode(mode) {
  MKT_CROP.mode = mode;
  const lb = document.getElementById('mktModeLoupeBtn');
  const pb = document.getElementById('mktModePreciseBtn');
  const hint = document.getElementById('mktCropModeHint');
  if (mode === 'loupe') {
    lb.style.background='rgba(245,200,66,0.25)'; lb.style.color='#f5c842';
    pb.style.background='transparent'; pb.style.color='rgba(255,255,255,0.45)';
    hint.textContent='Přetáhni roh – lupa ukáže přesnou pozici';
  } else {
    pb.style.background='rgba(245,200,66,0.25)'; pb.style.color='#f5c842';
    lb.style.background='transparent'; lb.style.color='rgba(255,255,255,0.45)';
    hint.textContent='Rohové zarážky – přesné přichycení';
  }
  _mktDrawCrop();
}

function openSaleCrop(idx) { _openMktCrop(salePhotos, idx); }
function openProdCrop(idx)  { _openMktCrop(prodPhotos, idx); }

function _openMktCrop(arr, idx) {
  const p = arr[idx];
  const src = p.src; // always use original
  const load = (cors) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.onload = () => {
      MKT_CROP.img = img;
      MKT_CROP.targetArr = arr;
      MKT_CROP.targetIdx = idx;
      _mktInitCorners(img.naturalWidth, img.naturalHeight);
      _mktSetupCanvas();
      const modal = document.getElementById('mktCropModal');
      if (modal) modal.style.display = 'flex';
    };
    img.onerror = () => cors ? load(false) : alert('Nelze načíst obrázek');
    img.src = src;
  };
  load(true);
}

function _mktInitCorners(iw, ih) {
  const m = Math.min(iw, ih) * 0.06;
  MKT_CROP.corners = [
    {x:m, y:m}, {x:iw-m, y:m}, {x:iw-m, y:ih-m}, {x:m, y:ih-m}
  ];
}

function _mktSetupCanvas() {
  const canvas = document.getElementById('mktCropCanvas');
  const img = MKT_CROP.img;
  const maxW = Math.min(window.innerWidth - 24, 920);
  const maxH = window.innerHeight - 150;
  const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
  MKT_CROP.scale = scale;
  const pw = Math.round(img.naturalWidth  * scale);
  const ph = Math.round(img.naturalHeight * scale);
  canvas.width = pw; canvas.height = ph;
  canvas.style.width = pw + 'px'; canvas.style.height = ph + 'px';
  canvas.removeEventListener('pointerdown', _mktOnCropDown);
  canvas.addEventListener('pointerdown', _mktOnCropDown);
  _mktDrawCrop();
}

function _mktDrawCrop() {
  const canvas = document.getElementById('mktCropCanvas');
  if (!canvas || !MKT_CROP.img) return;
  const ctx = canvas.getContext('2d');
  const s = MKT_CROP.scale;
  const { img, corners, mode } = MKT_CROP;
  const pts = corners.map(c => ({x: c.x*s, y: c.y*s}));

  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.fillStyle='rgba(0,0,0,0.6)';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.globalCompositeOperation='destination-out';
  ctx.beginPath();
  pts.forEach((p,i) => i===0 ? ctx.moveTo(p.x,p.y) : ctx.lineTo(p.x,p.y));
  ctx.closePath(); ctx.fill(); ctx.restore();

  ctx.save();
  ctx.beginPath();
  pts.forEach((p,i) => i===0 ? ctx.moveTo(p.x,p.y) : ctx.lineTo(p.x,p.y));
  ctx.closePath(); ctx.clip();
  ctx.drawImage(img,0,0,canvas.width,canvas.height);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle='#f5c842'; ctx.lineWidth=2;
  ctx.setLineDash([6,4]);
  ctx.beginPath();
  pts.forEach((p,i) => i===0 ? ctx.moveTo(p.x,p.y) : ctx.lineTo(p.x,p.y));
  ctx.closePath(); ctx.stroke(); ctx.setLineDash([]); ctx.restore();

  if (mode==='loupe') {
    pts.forEach((p,i) => {
      ctx.save();
      ctx.shadowColor='rgba(0,0,0,0.8)'; ctx.shadowBlur=8;
      ctx.beginPath(); ctx.arc(p.x,p.y,MKT_HANDLE_R,0,Math.PI*2);
      ctx.fillStyle='rgba(10,8,6,0.65)'; ctx.fill();
      ctx.strokeStyle='#f5c842'; ctx.lineWidth=2.5; ctx.stroke();
      ctx.restore();
      ctx.save(); ctx.strokeStyle='#f5c842'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(p.x-3,p.y-3,7,0,Math.PI*2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p.x+2,p.y+2); ctx.lineTo(p.x+9,p.y+9); ctx.stroke();
      ctx.restore();
    });
    if (MKT_CROP.drag !== null && MKT_CROP.dragPos) {
      _mktDrawLoupe(ctx, canvas, MKT_CROP.dragPos, pts[MKT_CROP.drag]);
    }
  } else {
    const ARM=20, T=3;
    const dirs=[{ax:1,ay:0,bx:0,by:1},{ax:-1,ay:0,bx:0,by:1},{ax:-1,ay:0,bx:0,by:-1},{ax:1,ay:0,bx:0,by:-1}];
    pts.forEach((p,i) => {
      const d=dirs[i];
      ctx.save(); ctx.strokeStyle='rgba(0,0,0,0.6)'; ctx.lineWidth=T+3; ctx.lineCap='square';
      ctx.beginPath(); ctx.moveTo(p.x+d.ax*ARM,p.y+d.ay*ARM); ctx.lineTo(p.x,p.y); ctx.lineTo(p.x+d.bx*ARM,p.y+d.by*ARM); ctx.stroke(); ctx.restore();
      ctx.save(); ctx.strokeStyle='#f5c842'; ctx.lineWidth=T; ctx.lineCap='square';
      ctx.beginPath(); ctx.moveTo(p.x+d.ax*ARM,p.y+d.ay*ARM); ctx.lineTo(p.x,p.y); ctx.lineTo(p.x+d.bx*ARM,p.y+d.by*ARM); ctx.stroke(); ctx.restore();
      ctx.save(); ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(p.x,p.y,3,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle='#f5c842'; ctx.lineWidth=1.5; ctx.stroke(); ctx.restore();
    });
  }
}

function _mktDrawLoupe(ctx, canvas, dragPos, cornerPt) {
  const img=MKT_CROP.img, s=MKT_CROP.scale;
  const LOUPE_R=70, ZOOM=3.5;
  let lx=cornerPt.x, ly=cornerPt.y-LOUPE_R-20;
  if(ly<LOUPE_R+10) ly=cornerPt.y+LOUPE_R+20;
  lx=Math.max(LOUPE_R+5,Math.min(canvas.width-LOUPE_R-5,lx));
  const srcW=(LOUPE_R*2)/(s*ZOOM), srcH=(LOUPE_R*2)/(s*ZOOM);
  const srcX=(cornerPt.x/s)-srcW/2, srcY=(cornerPt.y/s)-srcH/2;
  ctx.save(); ctx.beginPath(); ctx.arc(lx,ly,LOUPE_R,0,Math.PI*2); ctx.clip();
  ctx.fillStyle='#111'; ctx.fillRect(lx-LOUPE_R,ly-LOUPE_R,LOUPE_R*2,LOUPE_R*2);
  ctx.drawImage(img,srcX,srcY,srcW,srcH,lx-LOUPE_R,ly-LOUPE_R,LOUPE_R*2,LOUPE_R*2);
  ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.arc(lx,ly,LOUPE_R,0,Math.PI*2); ctx.clip();
  ctx.strokeStyle='rgba(245,200,66,0.75)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(lx-LOUPE_R,ly); ctx.lineTo(lx+LOUPE_R,ly);
  ctx.moveTo(lx,ly-LOUPE_R); ctx.lineTo(lx,ly+LOUPE_R); ctx.stroke();
  ctx.fillStyle='#f5c842'; ctx.beginPath(); ctx.arc(lx,ly,2.5,0,Math.PI*2); ctx.fill(); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.arc(lx,ly,LOUPE_R,0,Math.PI*2);
  ctx.strokeStyle='#f5c842'; ctx.lineWidth=2; ctx.stroke(); ctx.restore();
}

function _mktOnCropDown(e) {
  e.preventDefault();
  const canvas = document.getElementById('mktCropCanvas');
  const r = canvas.getBoundingClientRect();
  const cl = e.touches ? e.touches[0] : e;
  const pos = {
    x: (cl.clientX-r.left)*(canvas.width/r.width),
    y: (cl.clientY-r.top)*(canvas.height/r.height)
  };
  const s = MKT_CROP.scale;
  const hitR = MKT_CROP.mode==='precise' ? 28 : MKT_HANDLE_R*2.5;
  let best=-1, bestD=hitR;
  MKT_CROP.corners.forEach((c,i) => {
    const dx=c.x*s-pos.x, dy=c.y*s-pos.y, d=Math.sqrt(dx*dx+dy*dy);
    if(d<bestD){ bestD=d; best=i; }
  });
  if(best<0) return;
  MKT_CROP.drag=best; MKT_CROP.dragPos=pos;
  canvas.setPointerCapture(e.pointerId);
  canvas.addEventListener('pointermove', _mktOnCropMove);
  canvas.addEventListener('pointerup',   _mktOnCropUp);
}
function _mktOnCropMove(e) {
  e.preventDefault();
  if(MKT_CROP.drag===null) return;
  const canvas=document.getElementById('mktCropCanvas');
  const r=canvas.getBoundingClientRect();
  const cl=e.touches?e.touches[0]:e;
  const pos={x:(cl.clientX-r.left)*(canvas.width/r.width),y:(cl.clientY-r.top)*(canvas.height/r.height)};
  const s=MKT_CROP.scale;
  const iw=MKT_CROP.img.naturalWidth, ih=MKT_CROP.img.naturalHeight;
  MKT_CROP.corners[MKT_CROP.drag]={x:Math.max(0,Math.min(iw,pos.x/s)),y:Math.max(0,Math.min(ih,pos.y/s))};
  MKT_CROP.dragPos=pos; _mktDrawCrop();
}
function _mktOnCropUp() {
  MKT_CROP.drag=null; MKT_CROP.dragPos=null;
  const canvas=document.getElementById('mktCropCanvas');
  canvas.removeEventListener('pointermove',_mktOnCropMove);
  canvas.removeEventListener('pointerup',_mktOnCropUp);
  _mktDrawCrop();
}
function resetMktCrop() { _mktInitCorners(MKT_CROP.img.naturalWidth,MKT_CROP.img.naturalHeight); _mktDrawCrop(); }
function cancelMktCrop() {
  const m=document.getElementById('mktCropModal');
  if(m){ m.style.display='none'; }
  MKT_CROP.img=null;
}
function confirmMktCrop() {
  const img=MKT_CROP.img; if(!img) return;
  const btn=document.getElementById('mktCropConfirmBtn');
  if(btn){ btn.disabled=true; btn.textContent='⏳ Ořezávám…'; }
  requestAnimationFrame(()=>setTimeout(()=>{
    const c=MKT_CROP.corners;
    const outW=Math.round((Math.hypot(c[1].x-c[0].x,c[1].y-c[0].y)+Math.hypot(c[2].x-c[3].x,c[2].y-c[3].y))/2);
    const outH=Math.round((Math.hypot(c[3].x-c[0].x,c[3].y-c[0].y)+Math.hypot(c[2].x-c[1].x,c[2].y-c[1].y))/2);
    const dst=[{x:0,y:0},{x:outW,y:0},{x:outW,y:outH},{x:0,y:outH}];
    let dataUrl;
    try { dataUrl=_mktPerspectiveWarp(img,c,dst,outW,outH).toDataURL('image/jpeg',0.93); }
    catch(err){ alert('Ořez selhal – CORS omezení'); cancelMktCrop(); if(btn){btn.disabled=false;btn.textContent='✂️ Oříznout';} return; }
    const arr=MKT_CROP.targetArr, idx=MKT_CROP.targetIdx;
    if(arr&&idx!=null){ arr[idx].croppedUrl=dataUrl; }
    // Re-render
    if(arr===salePhotos) renderSalePhotos();
    else if(arr===prodPhotos) renderProdPhotoStrip();
    if(btn){btn.disabled=false;btn.textContent='✂️ Oříznout';}
    cancelMktCrop();
  },0));
}

function _mktPerspectiveWarp(img,src,dst,outW,outH){
  const out=document.createElement('canvas'); out.width=outW; out.height=outH;
  const ctx=out.getContext('2d');
  ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high';
  const G=64;
  for(let gy=0;gy<G;gy++) for(let gx=0;gx<G;gx++){
    const u0=gx/G,v0=gy/G,u1=(gx+1)/G,v1=(gy+1)/G;
    const s00=_mktBilerp(src,u0,v0),s10=_mktBilerp(src,u1,v0),s11=_mktBilerp(src,u1,v1),s01=_mktBilerp(src,u0,v1);
    const d00=_mktBilerp(dst,u0,v0),d10=_mktBilerp(dst,u1,v0),d11=_mktBilerp(dst,u1,v1),d01=_mktBilerp(dst,u0,v1);
    _mktDrawTri(ctx,img,s00,s10,s01,d00,d10,d01,img.naturalWidth,img.naturalHeight);
    _mktDrawTri(ctx,img,s10,s11,s01,d10,d11,d01,img.naturalWidth,img.naturalHeight);
  }
  return out;
}
function _mktBilerp(pts,u,v){return{x:pts[0].x*(1-u)*(1-v)+pts[1].x*u*(1-v)+pts[2].x*u*v+pts[3].x*(1-u)*v,y:pts[0].y*(1-u)*(1-v)+pts[1].y*u*(1-v)+pts[2].y*u*v+pts[3].y*(1-u)*v};}
function _mktMat3inv(m){const[[a,b,c],[d,e,f],[g,h,k]]=m;const det=a*(e*k-f*h)-b*(d*k-f*g)+c*(d*h-e*g);if(Math.abs(det)<1e-9)return null;return[[(e*k-f*h)/det,(c*h-b*k)/det,(b*f-c*e)/det],[(f*g-d*k)/det,(a*k-c*g)/det,(c*d-a*f)/det],[(d*h-e*g)/det,(b*g-a*h)/det,(a*e-b*d)/det]];}
function _mktDrawTri(ctx,img,s0,s1,s2,d0,d1,d2,iw,ih){
  const S=[[s0.x,s0.y,1],[s1.x,s1.y,1],[s2.x,s2.y,1]];
  const inv=_mktMat3inv(S); if(!inv)return;
  const mv=(col)=>[inv[0][0]*col[0]+inv[0][1]*col[1]+inv[0][2]*col[2],inv[1][0]*col[0]+inv[1][1]*col[1]+inv[1][2]*col[2],inv[2][0]*col[0]+inv[2][1]*col[1]+inv[2][2]*col[2]];
  const[a,c,e]=mv([d0.x,d1.x,d2.x]);const[b,df,f]=mv([d0.y,d1.y,d2.y]);
  const OVERLAP=0.5,cx=(d0.x+d1.x+d2.x)/3,cy=(d0.y+d1.y+d2.y)/3;
  const exp=p=>{const dx=p.x-cx,dy=p.y-cy;const L=Math.sqrt(dx*dx+dy*dy)||1;return{x:p.x+dx/L*OVERLAP,y:p.y+dy/L*OVERLAP};};
  const ep0=exp(d0),ep1=exp(d1),ep2=exp(d2);
  ctx.save();
  ctx.beginPath();ctx.moveTo(ep0.x,ep0.y);ctx.lineTo(ep1.x,ep1.y);ctx.lineTo(ep2.x,ep2.y);ctx.closePath();ctx.clip();
  ctx.transform(a,b,c,df,e,f);
  ctx.drawImage(img,0,0,iw,ih);
  ctx.restore();
}

// ══════════════════════════════════════════════════════════════
// ALBUM PICKER (pre-fill card from user's album)
// ══════════════════════════════════════════════════════════════
let _albumPickerCards = [];

async function openAlbumPicker() {
  if (!token) { alert('Přihlas se pro přístup k albu.'); return; }
  const modal = document.getElementById('albumPickerModal');
  if (!modal) return;
  modal.style.display = 'flex';
  document.getElementById('albumPickerSearch').value = '';

  if (_albumPickerCards.length) { renderAlbumPickerGrid(_albumPickerCards); return; }

  document.getElementById('albumPickerGrid').innerHTML =
    '<div style="grid-column:1/-1;text-align:center;color:var(--text3);font-size:13px;padding:30px 0">⏳ Načítám karty z alba...</div>';

  const res = await sbReq(
    `rest/v1/user_cards?user_id=eq.${userId}&select=local_id,card_data,for_trade,for_sell,price_czk&order=updated_at.desc&limit=200`,
    'GET', null, token
  );
  if (!Array.isArray(res) || res._err) {
    document.getElementById('albumPickerGrid').innerHTML =
      '<div style="grid-column:1/-1;text-align:center;color:var(--red);font-size:13px;padding:20px">Chyba načítání alba.</div>';
    return;
  }
  _albumPickerCards = res.map(r => {
    const d = r.card_data || {};
    return { ...d, id: r.local_id, price_czk: r.price_czk, for_trade: r.for_trade };
  });
  renderAlbumPickerGrid(_albumPickerCards);
}

function filterAlbumPickerCards() {
  const q = (document.getElementById('albumPickerSearch')?.value || '').toLowerCase();
  const filtered = q ? _albumPickerCards.filter(c =>
    (c.name||'').toLowerCase().includes(q) || (c.set||'').toLowerCase().includes(q)
  ) : _albumPickerCards;
  renderAlbumPickerGrid(filtered);
}

function renderAlbumPickerGrid(cards) {
  const grid = document.getElementById('albumPickerGrid');
  if (!grid) return;
  if (!cards.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text3);font-size:13px;padding:20px">Žádné karty nenalezeny.</div>';
    return;
  }
  grid.innerHTML = cards.slice(0, 120).map((c, i) => {
    const img = c.images?.small || c.apiSmall || c.imageUrl || '';
    const cond = c.condition || c.cond || 'NM';
    const condColor = {NM:'#4ade80',LP:'#a3e635',MP:'#facc15',HP:'#fb923c',D:'#f87171'}[cond]||'#9ca3af';
    return `<div class="album-picker-card" onclick="pickAlbumCard(${i})" title="${esc(c.name||'')} · ${esc(c.set||'')}">
      ${img
        ? `<img src="${esc(img)}" class="apc-img" loading="lazy">`
        : `<div class="apc-img-placeholder">🃏</div>`}
      <div class="apc-name">${esc(c.name||'?')}</div>
      <div class="apc-meta">${esc(c.set||'')} ${c.number?'#'+esc(c.number):''}</div>
      <div class="apc-cond" style="color:${condColor}">${cond}</div>
      ${c.price_czk ? `<div class="apc-price">${c.price_czk} Kč</div>` : ''}
    </div>`;
  }).join('');
  // Store filtered order for click lookup
  grid._filteredCards = cards;
}

function pickAlbumCard(gridIdx) {
  const grid = document.getElementById('albumPickerGrid');
  const arr = grid._filteredCards || _albumPickerCards;
  const c = arr[gridIdx];
  if (!c) return;
  // Build a card object compatible with applyCardToListing
  const cardObj = {
    name: c.name || '',
    number: c.number || c.num || '',
    set: { name: c.set || '' },
    types: c.types || [],
    rarity: c.rarity || '',
    hp: c.hp || '',
    images: { small: c.images?.small||c.apiSmall||c.imageUrl||'', large: c.images?.large||c.apiLarge||'' },
    cardmarket: { prices: { trendPrice: c.pTrend||null, lowPrice: c.pMin||null }, url: c.cardmarketUrl||'' },
    supertype: c.supertype || '',
    // Pass-through album-specific fields
    condition: c.condition || c.cond || 'NM',
    price_czk: c.price_czk || null,
  };
  applyCardToListing(cardObj, true);
  closeAlbumPicker();
}

function closeAlbumPicker() {
  const m = document.getElementById('albumPickerModal');
  if (m) m.style.display = 'none';
}

// ══════════════════════════════════════════════════════════════
// CARDMARKET IMPORT FOR SEALED PRODUCTS
// ══════════════════════════════════════════════════════════════
async function importProdFromCardmarket() {
  const url = (document.getElementById('prodCmUrl')?.value || '').trim();
  if (!url) { alert('Zadej Cardmarket URL produktu.'); return; }
  if (!url.includes('cardmarket.com')) { alert('Prosím vlož URL z cardmarket.com'); return; }

  const parts = url.replace(/\/$/, '').split('/');
  // CM URL pattern: .../Pokemon/Products/Singles/<set-slug>/<product-slug>
  // or .../Pokemon/Products/<category>/<set-slug>/<product-slug>
  const productSlug = parts[parts.length - 1];
  const setSlug     = parts[parts.length - 2];

  // Clean slug → human readable
  const setName = setSlug
    .replace(/-and-/gi,' & ')
    .replace(/-/g,' ')
    .replace(/\b\w/g, c => c.toUpperCase());

  // Fill set search input and trigger search
  const setInp = document.getElementById('prodSetInput');
  if (setInp) {
    setInp.value = setName;
    await searchProdSet();
  }

  // Also try to extract product name for title
  const cleanProd = productSlug
    .replace(/-\d{4}$/, '')
    .replace(/-/g,' ')
    .replace(/\b\w/g, c => c.toUpperCase());

  const desc = document.getElementById('prodDesc');
  if (desc && !desc.value) {
    desc.placeholder = `${cleanProd} · Importováno z Cardmarket`;
  }

  // Show quick feedback
  const btn = event?.target || document.activeElement;
  if (btn) {
    const orig = btn.textContent;
    btn.textContent = '✅ Importováno';
    btn.style.background = 'rgba(74,222,128,0.2)';
    btn.style.color = '#4ade80';
    setTimeout(() => { btn.textContent = orig; btn.style.background=''; btn.style.color=''; }, 2200);
  }
}

// ══════════════════════════════════════════════════════════════
// Card search also for card listing (pass-through for demand mode, already handled above)
// ══════════════════════════════════════════════════════════════
// Patch searchCards to also search Cardmarket via pokemontcg.io
// (already done by pokemontcg.io, but add CM URL parse to csbName)
const _origSearchCards = searchCards;
async function searchCards() {
  const nameInp = document.getElementById('csbName');
  const val = (nameInp?.value || '').trim();
  // If it looks like a Cardmarket URL, parse it first
  if (val.includes('cardmarket.com')) {
    const parts = val.replace(/\/$/, '').split('/');
    const cardSlug = parts[parts.length - 1];
    let cleanSlug = cardSlug
      .replace(/[_-][a-z]{1,3}\d+[A-Z]?\d{3,4}$/i,'')
      .replace(/[_-][A-Za-z]{2,5}\d{2,4}$/i,'')
      .replace(/-\d{2,4}$/,'')
      .replace(/[_-](V\d+|SR|CHR|HR|UR|CSR|SAR|AR|Secret|Rainbow|RR|PR|K)$/i,'');
    const name = cleanSlug.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
    const setSlug = parts[parts.length-2];
    const set = setSlug.replace(/-and-/gi,' & ').replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
    if (nameInp) nameInp.value = name;
    const setInp = document.getElementById('csbSet');
    if (setInp && set) setInp.value = set;
  }
  return _origSearchCards();
}


// ══════════════════════════════════════════════════════════════
// FULL-SCREEN MODAL ENHANCEMENTS
// ══════════════════════════════════════════════════════════════

// ── ESC key handler ──────────────────────────────────────────
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    const addModal = document.getElementById('addModal');
    const demModal = document.getElementById('addDemandModal');
    if (addModal && addModal.style.display !== 'none') {
      closeAddListing();
    } else if (demModal && demModal.style.display !== 'none') {
      closeAddDemand();
    }
  }
});

// ── submitCurrentListing — routes to card or sealed ──────────
function submitCurrentListing() {
  if (currentListingTab === 'product') {
    submitProductListing();
  } else {
    submitListing();
  }
}

// ── Trade Card URL Management ────────────────────────────────
let offerTradeCards = [];
let demandTradeCards = [];

async function addTradeCardUrl(mode) {
  const inputId = mode === 'offer' ? 'addTradeCardUrl' : 'demTradeCardUrl';
  const wrapId  = mode === 'offer' ? 'addTradeCardsWrap' : 'demTradeCardsWrap';
  const arr     = mode === 'offer' ? offerTradeCards : demandTradeCards;
  const input   = document.getElementById(inputId);
  const url     = (input?.value || '').trim();
  if (!url) return;

  const wrap = document.getElementById(wrapId);
  // Show loading placeholder
  const loadDiv = document.createElement('div');
  loadDiv.className = 'trade-url-card-loading';
  loadDiv.textContent = '⏳';
  wrap.appendChild(loadDiv);
  input.value = '';

  try {
    let card = null;
    if (url.includes('pokemontcg.io')) {
      // Direct API URL or pokemontcg.io page
      let apiUrl = url;
      if (!url.includes('/v2/cards/')) {
        // Convert page URL to API — extract card ID from path
        const m = url.match(/cards\/([^/?#]+)/);
        if (m) apiUrl = 'https://api.pokemontcg.io/v2/cards/' + m[1];
      }
      const res = await fetch(apiUrl);
      const json = await res.json();
      card = json?.data || json;
    } else if (url.includes('cardmarket.com')) {
      // Try searching by name extracted from URL
      const parts = url.split('/');
      const rawName = parts[parts.length - 1]?.replace(/-/g, ' ') || '';
      const q = `name:"${rawName}"`;
      const res = await tcgFetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=1`);
      const json = await res.json();
      card = json?.data?.[0] || null;
    } else {
      // Treat as name search
      const q = `name:"${url}"`;
      const res = await tcgFetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=1`);
      const json = await res.json();
      card = json?.data?.[0] || null;
    }

    if (!card || !card.name) {
      alert('Karta nenalezena. Zkus jiný URL nebo název.');
      loadDiv.remove();
      return;
    }

    const entry = {
      id: card.id || Date.now(),
      name: card.name,
      set: card.set?.name || '',
      number: card.number || '',
      imgSmall: card.images?.small || '',
      imgLarge: card.images?.large || '',
      cardData: card,
    };
    arr.push(entry);
    loadDiv.remove();
    renderTradeUrlCards(mode);
  } catch(e) {
    console.error('[addTradeCardUrl]', e);
    alert('Chyba načítání: ' + e.message);
    loadDiv.remove();
  }
}

function removeTradeCard(mode, idx) {
  const arr = mode === 'offer' ? offerTradeCards : demandTradeCards;
  arr.splice(idx, 1);
  renderTradeUrlCards(mode);
}

function renderTradeUrlCards(mode) {
  const arr    = mode === 'offer' ? offerTradeCards : demandTradeCards;
  const wrapId = mode === 'offer' ? 'addTradeCardsWrap' : 'demTradeCardsWrap';
  const wrap   = document.getElementById(wrapId);
  if (!wrap) return;

  wrap.innerHTML = arr.map((c, i) => `
    <div class="trade-url-card" title="${esc(c.name)} · ${esc(c.set)}">
      ${c.imgSmall
        ? `<img src="${esc(c.imgSmall)}" alt="${esc(c.name)}" loading="lazy">`
        : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:20px">🃏</div>`}
      <button class="tuc-del" onclick="event.stopPropagation();removeTradeCard('${mode}',${i})">✕</button>
      <div class="tuc-name">${esc(c.name)}</div>
    </div>
  `).join('');
}

// ── Demand Tab: Card vs Sealed ───────────────────────────────
let currentDemandTab = 'card';

function setDemandTab(tab) {
  currentDemandTab = tab;
  const tabCard   = document.getElementById('demTabCard');
  const tabSealed = document.getElementById('demTabSealed');
  const secCard   = document.getElementById('demCardSection');
  const secSealed = document.getElementById('demSealedSection');
  const condLabel = document.getElementById('demCondLabel');

  if (tabCard)   tabCard.classList.toggle('active', tab === 'card');
  if (tabSealed) tabSealed.classList.toggle('active', tab === 'sealed');
  if (secCard)   secCard.style.display   = tab === 'card'   ? '' : 'none';
  if (secSealed) secSealed.style.display = tab === 'sealed' ? '' : 'none';
  if (condLabel) condLabel.textContent   = tab === 'card'
    ? 'Požadovaný stav karty (minimum)'
    : 'Požadovaný stav obalu';
}

// ── Demand Type: Buy / Trade / Both ──────────────────────────
let demandType = 'buy';

function setDemandType(type) {
  demandType = type;
  const btnBuy   = document.getElementById('demTypeBuy');
  const btnTrade = document.getElementById('demTypeTrade');
  const btnBoth  = document.getElementById('demTypeBoth');
  const priceRow = document.getElementById('demPriceRow');
  const tradeRow = document.getElementById('demTradeRow');

  [btnBuy, btnTrade, btnBoth].forEach(b => b && b.classList.remove('act'));
  if (type === 'buy')   { btnBuy?.classList.add('act'); }
  if (type === 'trade') { btnTrade?.classList.add('act'); }
  if (type === 'both')  { btnBoth?.classList.add('act'); }

  if (priceRow) priceRow.style.display = (type === 'trade') ? 'none' : '';
  if (tradeRow) tradeRow.style.display = (type === 'buy')   ? 'none' : '';
}

// ── Demand Sealed product type/lang/cond ─────────────────────
let demProdType = 'booster';
let demProdLang = 'EN';
let demSealCond = 'sealed';

function setDemProdType(type) {
  demProdType = type;
  document.querySelectorAll('[id^="dpt_"]').forEach(b => b.classList.remove('active'));
  const el = document.getElementById('dpt_' + type);
  if (el) el.classList.add('active');
}
function setDemLang(lang) {
  demProdLang = lang;
  document.querySelectorAll('[id^="dlang"]').forEach(b => b.classList.remove('active'));
  const el = document.getElementById('dlang' + lang);
  if (el) el.classList.add('active');
}
function setDemSealCond(cond) {
  demSealCond = cond;
  document.querySelectorAll('[id^="dseal"]').forEach(b => b.classList.remove('active'));
  const el = document.getElementById('dseal' + cond.charAt(0).toUpperCase() + cond.slice(1));
  if (el) el.classList.add('active');
}

// ── Save Draft (Uložit rozdělanou) ───────────────────────────
function saveDraftListing() {
  if (!token) { alert('Přihlaš se.'); return; }

  const card = addCardData;
  const draft = {
    _pendingId: 'draft_' + Date.now(),
    _isDraft: true,
    _draftType: currentListingTab, // 'card' or 'product'
    name: card?.name || document.getElementById('prodSetInput')?.value || 'Rozdělaná nabídka',
    set: card?.set || (typeof card?.set === 'string' ? card.set : undefined),
    number: card?.number || '',
    images: card?.images || null,
    condition: document.getElementById('addCond')?.value || 'NM',
    album_price: parseInt(document.getElementById('addPrice')?.value) || null,
    _addType: addType,
    _description: document.getElementById('addDesc')?.value || '',
    _tradeWants: document.getElementById('addTradeWants')?.value || '',
    _tradeCards: offerTradeCards.slice(),
    _location: document.getElementById('addLocation')?.value || '',
    _deliveryPost: document.getElementById('addDeliveryPost')?.checked ?? true,
    _deliveryPersonal: document.getElementById('addDeliveryPersonal')?.checked ?? false,
    _cardData: card,
    // Sealed fields
    _prodType: selectedProdType,
    _prodLang: selectedProdLang,
    _sealCond: selectedSealCond,
    _prodPrice: document.getElementById('prodPrice')?.value || '',
    _prodDesc: document.getElementById('prodDesc')?.value || '',
    _prodLocation: document.getElementById('addProdLocation')?.value || '',
  };

  // Add to pending queue
  const q = getPendingQueue();
  q.push(draft);
  savePendingQueue(q);
  updatePendingBadge();

  alert('💾 Rozpracovaná nabídka uložena do „Čeká na vystavení".');
  closeAddListing();
}

function saveDraftDemand() {
  if (!token) { alert('Přihlaš se.'); return; }

  const card = demandCardData;
  const draft = {
    _pendingId: 'demdraft_' + Date.now(),
    _isDemandDraft: true,
    _demandTab: currentDemandTab,
    _demandType: demandType,
    name: card?.name || document.getElementById('demProdSet')?.value || 'Rozdělaná poptávka',
    images: card?.images || null,
    _cardData: card,
    _maxPrice: document.getElementById('demandMaxPrice')?.value || '',
    _minCond: document.getElementById('demandMinCond')?.value || 'NM',
    _notes: document.getElementById('demandNotes')?.value || '',
    _tradeCards: demandTradeCards.slice(),
    _location: document.getElementById('demLocation')?.value || '',
    _deliveryPost: document.getElementById('demDeliveryPost')?.checked ?? true,
    _deliveryPersonal: document.getElementById('demDeliveryPersonal')?.checked ?? false,
    // Sealed fields
    _prodType: demProdType,
    _prodLang: demProdLang,
    _sealCond: demSealCond,
    _prodSet: document.getElementById('demProdSet')?.value || '',
  };

  const q = getPendingQueue();
  q.push(draft);
  savePendingQueue(q);
  updatePendingBadge();

  alert('💾 Rozpracovaná poptávka uložena do „Čeká na vystavení".');
  closeAddDemand();
}

// ── Updated openAddDemand ────────────────────────────────────
// Override the old one
window.openAddDemand = function() {
  if (!token) { alert('Přihlaš se pro přidání poptávky.'); return; }
  document.getElementById('addDemandModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  // Reset form
  document.getElementById('demandCardUrl').value = '';
  document.getElementById('demandMaxPrice').value = '';
  document.getElementById('demandNotes').value = '';
  const locEl = document.getElementById('demLocation');
  if (locEl) locEl.value = localStorage.getItem('mkt_location') || '';
  clearDemandCard();
  demandTradeCards = [];
  renderTradeUrlCards('demand');
  setDemandType('buy');
  setDemandTab('card');
};

// ── Updated closeAddDemand ───────────────────────────────────
window.closeAddDemand = function() {
  document.getElementById('addDemandModal').style.display = 'none';
  document.body.style.overflow = '';
  demandCardData = null;
  demandTradeCards = [];
};

// ── Updated openAddListing ───────────────────────────────────
window.openAddListing = function() {
  if (!token) { alert('Přihlas se pro přidání nabídky.'); return; }
  document.getElementById('addModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  setListingTab('card');
  resetAiZone();
  offerTradeCards = [];
  renderTradeUrlCards('offer');
  // Pre-fill location from memory
  const locEl = document.getElementById('addLocation');
  if (locEl) locEl.value = localStorage.getItem('mkt_location') || '';
  setTimeout(generateInlineQr, 300);
};

// ── Updated closeAddListing ──────────────────────────────────
// closeAddListing override below
window.closeAddListing = function() {
  document.getElementById('addModal').style.display = 'none';
  document.body.style.overflow = '';
  addCardData = null;
  offerTradeCards = [];
  document.getElementById('addCardPreview').style.display = 'none';
  document.getElementById('addCardUrl').value = '';
  resetAiZone();
  resetQrInline();
  salePhotos = [];
  renderSalePhotos();
  const ow = document.getElementById('officialCardWrap');
  if (ow) ow.style.display = 'none';
  // Reset product form
  selectedProdType = 'booster'; selectedProdLang = 'EN'; selectedSealCond = 'sealed';
  selectedProdSet = null; prodPhotos = [];
  const pi = document.getElementById('prodSetInput'); if (pi) pi.value = '';
  const ps = document.getElementById('prodSetSelected'); if (ps) ps.style.display = 'none';
  const pr = document.getElementById('prodSetResults'); if (pr) pr.style.display = 'none';
  const strip = document.getElementById('prodSalePhotosStrip');
  if (strip && typeof renderProdPhotoStrip === 'function') renderProdPhotoStrip();
  if (typeof closeAddListing_pendingCleanup === 'function') closeAddListing_pendingCleanup();
};

// ── Updated submitListing — include new fields ───────────────
// _origSubmitListing override below
window.submitListing = async function() {
  if (!token) { alert('Přihlas se.'); return; }
  const price = parseInt(document.getElementById('addPrice').value) || null;
  const desc  = document.getElementById('addDesc').value.trim() || null;
  const cond  = document.getElementById('addCond').value;
  const wants = document.getElementById('addTradeWants').value.trim() || null;
  const card  = addCardData;
  const loc   = document.getElementById('addLocation')?.value.trim() || null;
  const dPost = document.getElementById('addDeliveryPost')?.checked ?? true;
  const dPers = document.getElementById('addDeliveryPersonal')?.checked ?? false;

  // Save location for next time
  if (loc) localStorage.setItem('mkt_location', loc);

  const cardData = card ? {
    name: card.name, set: card.set?.name || '', number: card.number || '',
    hp: card.hp || '', types: card.types || [], supertype: card.supertype || '',
    images: card.images || null, rarity: card.rarity || '',
    pTrend: card.cardmarket?.prices?.trendPrice || null,
    pMin: card.cardmarket?.prices?.lowPrice || null,
    cardmarketUrl: card.cardmarket?.url || '',
  } : {};

  const payload = {
    user_id:        userId,
    username:       username,
    title:          card?.name || 'Nabídka',
    cards_data:     [cardData],
    card_name:      card?.name || '',
    card_set:       card?.set?.name || card?.set || '',
    card_number:    card?.number || '',
    card_hp:        card?.hp || '',
    card_type:      card?.types?.[0] || '',
    card_rarity:    card?.rarity || '',
    card_condition: cond,
    api_image_url:  card?.images?.large || card?.images?.small || '',
    price_czk:      (addType === 'trade') ? null : price,
    allow_trade:    (addType === 'trade' || addType === 'both'),
    allow_offer:    true,
    trade_wants:    wants,
    trade_cards:    offerTradeCards.length ? offerTradeCards.map(c => ({
      name: c.name, set: c.set, number: c.number,
      imgSmall: c.imgSmall, imgLarge: c.imgLarge,
    })) : null,
    description:    desc,
    location:       loc,
    delivery_post:     dPost,
    delivery_personal: dPers,
    status:         'active',
    user_photos:    salePhotos.filter(p => !p.isOfficial).length ? salePhotos.filter(p => !p.isOfficial).map(p => ({
      src: p.croppedUrl || p.src, mime: p.mime, cropped: !!p.croppedUrl
    })) : undefined,
  };

  const res = await sbReq('rest/v1/listings', 'POST', payload, token);
  if (res._err) { alert('Chyba: ' + res._err); return; }
  alert('✅ Nabídka zveřejněna!');
  if (_pendingFromQueue?._pendingId) {
    removePendingCard(_pendingFromQueue._pendingId);
    _pendingFromQueue = null;
  }
  closeAddListing();
  const _newListing = Array.isArray(res) ? res[0] : res;
  if (_newListing?.id) dispatchListingNotifications(_newListing).catch(() => {});
  allListings.unshift(_newListing);
  applyFilters();
};

// ── Updated submitDemand — include new fields ────────────────
window.submitDemand = async function() {
  if (!token) { alert('Přihlaš se.'); return; }
  const card     = demandCardData;
  const maxPrice = parseInt(document.getElementById('demandMaxPrice').value) || null;
  const minCond  = document.getElementById('demandMinCond').value;
  const notes    = document.getElementById('demandNotes').value.trim() || null;
  const loc      = document.getElementById('demLocation')?.value.trim() || null;
  const dPost    = document.getElementById('demDeliveryPost')?.checked ?? true;
  const dPers    = document.getElementById('demDeliveryPersonal')?.checked ?? false;

  if (loc) localStorage.setItem('mkt_location', loc);

  const isSealed = currentDemandTab === 'sealed';

  if (!isSealed && !card) { alert('Vyber kartu, kterou hledáš.'); return; }
  if (isSealed && !document.getElementById('demProdSet')?.value.trim()) {
    alert('Zadej sérii sealed produktu.'); return;
  }

  const payload = {
    user_id:       userId,
    username:      username,
    card_name:     isSealed ? (document.getElementById('demProdSet')?.value || '') : (card?.name || ''),
    card_set:      isSealed ? '' : (card?.set?.name || ''),
    card_number:   isSealed ? '' : (card?.number || ''),
    card_type:     isSealed ? '' : (card?.types?.[0] || ''),
    card_rarity:   isSealed ? '' : (card?.rarity || ''),
    api_image_url: isSealed ? '' : (card?.images?.large || card?.images?.small || ''),
    cards_data:    isSealed ? null : [card],
    max_price_czk: maxPrice,
    min_condition: minCond,
    accept_trade:  (demandType === 'trade' || demandType === 'both'),
    demand_type:   demandType,
    trade_cards:   demandTradeCards.length ? demandTradeCards.map(c => ({
      name: c.name, set: c.set, number: c.number,
      imgSmall: c.imgSmall, imgLarge: c.imgLarge,
    })) : null,
    notes:         notes,
    location:      loc,
    delivery_post:     dPost,
    delivery_personal: dPers,
    item_type:     isSealed ? 'sealed' : 'card',
    product_type:  isSealed ? demProdType : null,
    product_lang:  isSealed ? demProdLang : null,
    seal_condition: isSealed ? demSealCond : null,
    status:        'active',
    response_count: 0,
  };

  const res = await sbReq('rest/v1/demands', 'POST', payload, token);
  if (res._err) { alert('Chyba: ' + res._err); return; }

  alert('✅ Poptávka zveřejněna!');
  closeAddDemand();
  const newDemand = Array.isArray(res) ? res[0] : res;
  if (newDemand) allDemands.unshift(newDemand);
  demandsLoaded = true;
  applyDemandFilters();
};

// ── Updated setMarketMode — sidebar works for demands ────────
// _origSetMarketMode override below
window.setMarketMode = function(mode) {
  marketMode = mode;
  const isOffer  = mode === 'offer';
  const isDemand = mode === 'demand';

  document.getElementById('mmtOffer').classList.toggle('active', isOffer);
  document.getElementById('mmtDemand').classList.toggle('active', isDemand);

  // Show/hide list vs demand view — keep listView visible for toolbar
  document.getElementById('listView').style.display       = '';  // Always visible (has toolbar)
  document.getElementById('listingsWrap').style.display    = isOffer  ? '' : 'none';
  document.getElementById('demandsView').style.display     = isDemand ? '' : 'none';
  document.getElementById('detailView').style.display      = 'none';

  // Toolbar buttons
  document.getElementById('btnAddOffer').style.display     = isOffer  ? '' : 'none';
  document.getElementById('btnAddDemand').style.display    = isDemand ? '' : 'none';
  document.getElementById('btnPendingQueue').style.display = isOffer  ? '' : 'none';

  // Keep sidebar FULLY functional for demands too — just update label
  const sellLabel = document.getElementById('fSell')?.closest('.filter-opt');
  const tradeLabel = document.getElementById('fTrade')?.closest('.filter-opt');
  if (sellLabel) sellLabel.style.opacity = '1';
  if (tradeLabel) tradeLabel.style.opacity = '1';

  // Show search input for both modes
  document.getElementById('searchInput').placeholder = isDemand
    ? 'Hledat poptávku, kartu, uživatele...'
    : 'Hledat kartu, prodejce, sérii...';

  if (isDemand && !demandsLoaded) {
    loadDemands();
  } else if (isDemand) {
    applyDemandFilters();
  }
};

// ── Updated setAddType — show/hide trade cards section ───────
// _origSetAddType override below
window.setAddType = function(type) {
  addType = type;
  ['addTypeSell','addTypeTrade','addTypeBoth'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('act', id === 'addType' + type.charAt(0).toUpperCase() + type.slice(1));
  });
  document.getElementById('addTypeSell').classList.toggle('act', type === 'sell');
  document.getElementById('addTypeTrade').classList.toggle('act', type === 'trade');
  document.getElementById('addTypeBoth').classList.toggle('act', type === 'both');

  const priceRow = document.getElementById('addPriceRow');
  const tradeRow = document.getElementById('addTradeRow');
  if (priceRow) priceRow.style.display = (type === 'trade') ? 'none' : '';
  if (tradeRow) tradeRow.style.display = (type === 'sell') ? 'none' : '';
};

// ── Updated setListingTab for full-screen form ───────────────
window.setListingTab = function(tab) {
  currentListingTab = tab;
  document.getElementById('tabCard').classList.toggle('active', tab === 'card');
  document.getElementById('tabProduct').classList.toggle('active', tab === 'product');
  document.getElementById('cardListingForm').style.display    = tab === 'card'    ? '' : 'none';
  document.getElementById('productListingForm').style.display = tab === 'product' ? '' : 'none';
};

// ── Listing tab styling ──────────────────────────────────────
// Make listing-tab class work with fs-tab
(function(){
  const style = document.createElement('style');
  style.textContent = '.listing-tab { display: none !important; }';
  document.head.appendChild(style);
})();

// ── Seller rating helpers ────────────────────────────────────
async function loadSellerRating(sellerId) {
  if (!sellerId) return;
  const el = document.getElementById('dSellerStars');
  if (!el) return;
  try {
    const res = await sbReq(`rest/v1/reviews?reviewed_id=eq.${sellerId}&reviewer_role=eq.buyer&select=stars_overall`);
    if (!Array.isArray(res) || !res.length) { el.innerHTML = ''; return; }
    const avg = res.reduce((s,r) => s+(r.stars_overall||0), 0) / res.length;
    const full = Math.round(avg);
    el.innerHTML = `<span class="seller-stars-tiny" title="${avg.toFixed(1)}/5 (${res.length}×)">${'★'.repeat(full)}${'☆'.repeat(5-full)}</span><span class="seller-stars-count">${avg.toFixed(1)}</span>`;
  } catch(e) { el.innerHTML = ''; }
}

// ── Owner actions ─────────────────────────────────────────────
async function markListingAsSold() {
  if (!currentListing) return;
  if (!confirm('Označit jako prodáno?\nInzerát zmizí z nabídek.')) return;
  const res = await sbReq(`rest/v1/listings?id=eq.${currentListing.id}`, 'PATCH', { status: 'sold' }, token);
  if (res && res._err) { alert('Chyba: ' + res._err); return; }
  showMktToast('✅ Označeno jako prodáno.');
  showList(); loadListings();
}

// ── Edit existujícího inzerátu (cena, stav, popis) ─────────────────────
function openEditListing() {
  if (!currentListing) return;
  const l = currentListing;

  // Naplň formulář aktuálními hodnotami
  const nameEl  = document.getElementById('editLstName');
  const typeBg  = document.getElementById('editLstTypeBadge');
  const priceEl = document.getElementById('editLstPrice');
  const condEl  = document.getElementById('editLstCondition');
  const descEl  = document.getElementById('editLstDescription');
  const counter = document.getElementById('editLstDescCounter');
  const wrap    = document.getElementById('editLstPriceWrap');
  const modal   = document.getElementById('editListingModal');
  if (!modal) { showMktToast('⚠️ Edit modal nenalezen.'); return; }

  if (nameEl)  nameEl.textContent  = l.card_name || l.title || 'Inzerát';
  if (priceEl) priceEl.value       = (typeof l.price === 'number' ? l.price : (parseInt(l.price) || 0));
  if (condEl)  condEl.value        = l.condition || '';
  if (descEl)  descEl.value        = l.description || '';
  if (counter) counter.textContent = (l.description || '').length;

  // Typ inzerátu (info badge)
  if (typeBg) {
    const t = (l.listing_type || (l.is_trade ? 'trade' : 'sale')).toLowerCase();
    if (t === 'trade') {
      typeBg.textContent = '🔄 Výměna';
      typeBg.style.background = 'rgba(79,142,247,.15)';
      typeBg.style.color = '#4f8ef7';
      typeBg.style.border = '1px solid rgba(79,142,247,.4)';
      // U pure-trade nemá smysl měnit cenu — schovat
      if (wrap) wrap.style.display = (l.price > 0) ? '' : 'none';
    } else {
      typeBg.textContent = '💰 Prodej';
      typeBg.style.background = 'rgba(245,200,66,.15)';
      typeBg.style.color = '#f5c842';
      typeBg.style.border = '1px solid rgba(245,200,66,.4)';
      if (wrap) wrap.style.display = '';
    }
  }

  // Live counter pro popis
  if (descEl && counter) {
    descEl.oninput = function() { counter.textContent = (descEl.value || '').length; };
  }

  modal.style.display = 'flex';
}

function closeEditListing() {
  const modal = document.getElementById('editListingModal');
  if (modal) modal.style.display = 'none';
}

async function saveEditListing() {
  if (!currentListing) return;
  const l = currentListing;
  const saveBtn = document.getElementById('editLstSaveBtn');
  const priceEl = document.getElementById('editLstPrice');
  const condEl  = document.getElementById('editLstCondition');
  const descEl  = document.getElementById('editLstDescription');

  // Sestav patch
  const patch = {};
  const newPrice = priceEl ? parseInt(priceEl.value) : null;
  const newCond  = condEl  ? (condEl.value || null) : null;
  const newDesc  = descEl  ? (descEl.value || '').trim() : '';

  if (newPrice !== null && !isNaN(newPrice) && newPrice >= 0) patch.price = newPrice;
  if (newCond !== null) patch.condition = newCond;
  if (descEl) patch.description = newDesc.slice(0, 500);

  if (Object.keys(patch).length === 0) {
    showMktToast('Není co uložit.');
    return;
  }

  // Validace: záporná cena nebo extrémně vysoká
  if (typeof patch.price === 'number' && (patch.price < 0 || patch.price > 9999999)) {
    alert('Neplatná cena. Zadej hodnotu mezi 0 a 9 999 999 Kč.');
    return;
  }

  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ Ukládám…'; }
  try {
    const res = await sbReq(`rest/v1/listings?id=eq.${l.id}`, 'PATCH', patch, token);
    if (res && res._err) {
      alert('Chyba při ukládání: ' + res._err);
      return;
    }

    // Aktualizuj lokální currentListing + allListings
    Object.assign(currentListing, patch);
    const idx = (allListings || []).findIndex(x => x.id === l.id);
    if (idx >= 0) Object.assign(allListings[idx], patch);

    showMktToast('✅ Inzerát byl upraven.');
    closeEditListing();
    // Re-render detail i seznam
    if (typeof openListing === 'function') {
      openListing(l.id);
    } else {
      renderListings && renderListings();
    }
  } catch (e) {
    alert('Chyba: ' + e.message);
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 Uložit změny'; }
  }
}

async function cancelListing() {
  if (!currentListing) return;
  if (!confirm('Zrušit inzerát? Tato akce je nevratná.')) return;
  const id = currentListing.id;
  // Zkus DELETE
  let res = await sbReq(`rest/v1/listings?id=eq.${id}`, 'DELETE', null, token);
  if (res && res._err) {
    // Záloha: nastav status na 'sold' (skryje inzerát)
    res = await sbReq(`rest/v1/listings?id=eq.${id}`, 'PATCH', { status: 'sold' }, token);
    if (res && res._err) { alert('Chyba při rušení inzerátu: ' + res._err); return; }
  }
  // Okamžitě odstraň z lokálního pole a překresli
  allListings = allListings.filter(l => l.id !== id);
  showMktToast('🗑️ Inzerát byl zrušen.');
  showList();
  renderListings();
}

// Seller potvrdí prodej rezervované karty → vytvoří transakci
async function confirmSale() {
  if (!currentListing) return;
  const l = currentListing;
  if (!l.reserved_by_user_id) { alert('Karta není rezervována.'); return; }
  if (!confirm(`Potvrdit prodej pro ${l.reserved_by_username||'kupujícího'}?\nVytvoří se záznam o transakci a oba budete moci ohodnotit.`)) return;

  // 1. Patch listing na sold
  const patchRes = await sbReq(`rest/v1/listings?id=eq.${l.id}`, 'PATCH', { status: 'sold' }, token);
  if (patchRes && patchRes._err) { alert('Chyba: ' + patchRes._err); return; }

  // 2. Vytvoř transakci
  const first = (l.cards_data||[])[0] || {};
  const cardName = l.card_name || first.name || l.title || '?';
  const cardImg  = l.api_image_url || first?.images?.small || first?.images?.large || '';
  const txRes = await sbReq('rest/v1/transactions', 'POST', {
    listing_id:        l.id,
    seller_id:         l.user_id,
    buyer_id:          l.reserved_by_user_id,
    seller_username:   l.username,
    buyer_username:    l.reserved_by_username,
    card_name:         cardName,
    card_image_url:    cardImg,
    price_czk:         l.price_czk || null,
    status:            'completed',
    seller_reviewed:   false,
    buyer_reviewed:    false,
  }, token);
  if (txRes && txRes._err) { console.warn('Transakce se neuložila:', txRes._err); }

  // 3. Pošli kupujícímu chat zprávu s odkazem na přidání do alba
  try {
    const buyerLink = `${location.origin}${location.pathname.replace('marketplace.html','moje-album.html')}?add_from_listing=${encodeURIComponent(l.id)}`;
    const notifText = `✅ Prodej potvrzen! Karta „${cardName}" je tvoje 🎉\nPřidej ji do své sbírky: ${buyerLink}`;
    await sbReq('rest/v1/messages', 'POST', {
      listing_id:        l.id,
      sender_id:         userId,
      receiver_id:       l.reserved_by_user_id,
      sender_username:   username,
      receiver_username: l.reserved_by_username || '',
      text:              notifText,
    }, token);
  } catch(e) { console.warn('[notif buyer]', e); }

  // 5. Auto-cleanup karty z alba "Obchod" (i kdyby seller zavřel picker)
  //    Bez tohoto by karta zůstala visut v albu "Obchod" s for_sell=false
  //    a vypadala by zatuchle. Pokud seller v pickeru vybere konkrétní album,
  //    showSellerAlbumPicker() to vyřeší samo (řádky 5193+).
  try {
    if (l.card_local_id) {
      // Odeber for_sell/for_trade flag z karty
      await sbReq(
        `rest/v1/user_cards?user_id=eq.${userId}&local_id=eq.${l.card_local_id}`,
        'PATCH',
        { for_sell: false, for_trade: false },
        token
      );
      // Odeber kartu z alb "Obchod" a "Výměna" (stále zůstává ve "Vše")
      const allAlbs = await sbReq(`rest/v1/user_albums?user_id=eq.${userId}`, 'GET', null, token);
      if (Array.isArray(allAlbs)) {
        for (const sName of ['Obchod', 'Výměna']) {
          const alb = allAlbs.find(a => a.name === sName);
          if (alb && Array.isArray(alb.card_ids)) {
            const cleaned = alb.card_ids.filter(id => String(id) !== String(l.card_local_id));
            if (cleaned.length !== alb.card_ids.length) {
              await sbReq(`rest/v1/user_albums?id=eq.${alb.id}`, 'PATCH',
                { card_ids: cleaned, updated_at: new Date().toISOString() }, token);
            }
          }
        }
      }
    }
  } catch (e) { console.warn('[confirmSale auto-cleanup]', e); }

  showList(); loadListings();
  // 6. Zobraz album picker prodejci — nabízí přesun do alba "Prodáno"
  setTimeout(() => showSellerAlbumPicker(l), 400);
}

// Seller vrátí kartu zpět do nabídky (zruší rezervaci)
async function relistListing() {
  if (!currentListing) return;
  if (!confirm('Zrušit rezervaci a vystavit kartu znova?')) return;
  const res = await sbReq(`rest/v1/listings?id=eq.${currentListing.id}`, 'PATCH', {
    status: 'active',
    reserved_by_user_id: null,
    reserved_by_username: null,
    reserved_at: null,
  }, token);
  if (res && res._err) { alert('Chyba: ' + res._err); return; }
  showMktToast('↩️ Karta znovu vystavena v nabídkách.');
  showList(); loadListings();
}

function showMktToast(msg) {
  let t = document.getElementById('mktToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'mktToast';
    t.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#1e1b2e;border:1px solid rgba(255,255,255,0.15);color:#f0ece4;font-size:13px;font-weight:600;padding:10px 22px;border-radius:10px;z-index:9999;pointer-events:none;opacity:0;transition:opacity .2s';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; }, 3000);
}

// ── Share modal ────────────────────────────────────────────────
function getShareUrl() {
  const id = currentListing?.id;
  return window.location.origin + window.location.pathname + (id ? '?listing=' + encodeURIComponent(id) : '');
}
function getShareText() {
  const l = currentListing || {};
  const name = l.card_name || l.title || 'Nabídka';
  const price = l.price_czk ? l.price_czk.toLocaleString('cs') + ' Kč' : 'Výměna';
  return `${name} – ${price}`;
}
function openShareModal() {
  const l = currentListing || {};
  const name = l.card_name || l.title || '';
  const price = l.price_czk ? l.price_czk.toLocaleString('cs') + ' Kč' : 'Výměna';
  document.getElementById('shareModalName').textContent = name ? `${name} · ${price}` : '';
  document.getElementById('btnNativeShare').style.display = navigator.share ? '' : 'none';
  document.getElementById('copyLinkLabel').textContent = 'Kopírovat odkaz';
  document.getElementById('btnCopyLink').classList.remove('copied');
  document.getElementById('shareModal').classList.add('open');
}
function closeShareModal(e) {
  if (e && e.target !== document.getElementById('shareModal')) return;
  document.getElementById('shareModal').classList.remove('open');
}
function shareToFacebook() {
  window.open('https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(getShareUrl()), '_blank');
}
function shareToWhatsApp() {
  window.open('https://wa.me/?text=' + encodeURIComponent(getShareText() + '\n' + getShareUrl()), '_blank');
}
function shareToMessenger() {
  window.open('https://www.facebook.com/dialog/send?link=' + encodeURIComponent(getShareUrl()) + '&app_id=291494419107518&redirect_uri=' + encodeURIComponent(getShareUrl()), '_blank');
}
function shareToX() {
  window.open('https://x.com/intent/tweet?text=' + encodeURIComponent(getShareText()) + '&url=' + encodeURIComponent(getShareUrl()), '_blank');
}
function shareToTelegram() {
  window.open('https://t.me/share/url?url=' + encodeURIComponent(getShareUrl()) + '&text=' + encodeURIComponent(getShareText()), '_blank');
}
function shareByEmail() {
  window.location.href = 'mailto:?subject=' + encodeURIComponent(getShareText()) + '&body=' + encodeURIComponent(getShareText() + '\n\n' + getShareUrl());
}
function shareNative() {
  if (navigator.share) navigator.share({ title: getShareText(), url: getShareUrl() });
}
async function copyShareLink() {
  const url = getShareUrl();
  try {
    await navigator.clipboard.writeText(url);
    document.getElementById('copyLinkLabel').textContent = '✓ Zkopírováno!';
    document.getElementById('btnCopyLink').classList.add('copied');
    setTimeout(() => {
      document.getElementById('copyLinkLabel').textContent = 'Kopírovat odkaz';
      document.getElementById('btnCopyLink').classList.remove('copied');
    }, 2500);
  } catch {
    showMktToast('Odkaz: ' + url);
  }
}
// Close modal on Escape key
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.getElementById('shareModal')?.classList.remove('open');
});

// ── Správa inzerátů — rychlé akce ─────────────────────────────
async function quickCancel(id) {
  if (!confirm('Zrušit inzerát? Tato akce je nevratná.')) return;
  let res = await sbReq(`rest/v1/listings?id=eq.${id}`, 'DELETE', null, token);
  if (res?._err) {
    res = await sbReq(`rest/v1/listings?id=eq.${id}`, 'PATCH', { status: 'sold' }, token);
    if (res?._err) { alert('Chyba: ' + res._err); return; }
  }
  allListings = allListings.filter(l => l.id !== id);
  showMktToast('🗑️ Inzerát zrušen.');
  renderListings();
}

async function quickConfirmSale(id) {
  if (!confirm('Označit jako prodáno?')) return;
  const res = await sbReq(`rest/v1/listings?id=eq.${id}`, 'PATCH', { status: 'sold' }, token);
  if (res?._err) { alert('Chyba: ' + res._err); return; }
  const l = allListings.find(x => x.id === id);
  if (l) l.status = 'sold';
  showMktToast('✅ Označeno jako prodáno.');
  renderListings();
}

async function quickRelist(id) {
  if (!confirm('Zrušit rezervaci a vystavit znova?')) return;
  const res = await sbReq(`rest/v1/listings?id=eq.${id}`, 'PATCH', {
    status: 'active',
    reserved_by_user_id: null,
    reserved_by_username: null,
    reserved_at: null,
  }, token);
  if (res?._err) { alert('Chyba: ' + res._err); return; }
  const l = allListings.find(x => x.id === id);
  if (l) { l.status = 'active'; l.reserved_by_user_id = null; l.reserved_by_username = null; }
  showMktToast('↩️ Inzerát znovu vystaven.');
  renderListings();
}

/* ══════════════════════════════════════════════════════════════
   DISPATCH LISTING NOTIFICATIONS
   Voláno po každém úspěšném vytvoření nabídky.
   Vytvoří in-app notifikaci uživatelům dle jejich preferencí.
   Emailový digest řeší Vercel cron (api/cron/email-digest.js).
   ══════════════════════════════════════════════════════════════ */
async function dispatchListingNotifications(listing) {
  const SBU = typeof SUPABASE_URL  !== 'undefined' ? SUPABASE_URL  : '';
  const SBA = typeof SUPABASE_ANON !== 'undefined' ? SUPABASE_ANON : '';
  if (!SBU) return;

  const r = await fetch(
    `${SBU}/rest/v1/profiles?select=id,notification_prefs&is_banned=eq.false`,
    { headers: { 'apikey': SBA, 'Authorization': `Bearer ${SBA}` } }
  );
  if (!r.ok) return;
  const profiles = await r.json();
  if (!Array.isArray(profiles)) return;

  const cat      = listing.listing_category || (listing.listing_type === 'product' ? 'sealed' : 'card');
  const isSealed = cat === 'sealed';
  const isTrade  = listing.allow_trade && !listing.allow_offer;
  const price    = listing.price_eur ? parseFloat(listing.price_eur) : null;
  const cardName = listing.card_name || listing.title || 'Nová nabídka';
  const priceStr = listing.price_eur
    ? `€ ${parseFloat(listing.price_eur).toFixed(2)}`
    : (listing.price_czk ? `${listing.price_czk} Kč` : isTrade ? 'Výměna' : '—');
  const notifLink = `${typeof VERCEL_URL !== 'undefined' ? VERCEL_URL : ''}/marketplace.html`;

  const toNotify = [];

  for (const profile of profiles) {
    if (profile.id === userId) continue;
    const p = profile.notification_prefs || {};
    if (p.inapp_listings === false) continue;

    const prefCat = p.email_listings_cat || 'all';
    if (prefCat === 'cards'  && isSealed)  continue;
    if (prefCat === 'sealed' && !isSealed) continue;
    if (isTrade && p.email_trade === false) continue;

    const threshold = parseFloat(p.price_threshold || '0') || 0;
    const isPricey  = price && threshold > 0 && price >= threshold;

    toNotify.push({
      user_id:  profile.id,
      type:     isPricey ? 'price_alert_listing' : 'new_listing',
      title:    isPricey ? `⭐ Cenná nabídka: ${cardName}` : `🛒 Nová nabídka: ${cardName}`,
      body:     `${listing.username} nabízí${isTrade ? ' k výměně' : ''} za ${priceStr}`,
      link:     notifLink,
      metadata: { listing_id: listing.id, category: cat, price_eur: listing.price_eur, is_trade: isTrade },
      read:     false,
    });

    if (toNotify.length >= 50) break;
  }

  if (!toNotify.length) return;

  await fetch(`${SBU}/rest/v1/notifications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SBA, 'Authorization': `Bearer ${SBA}`, 'Prefer': 'return=minimal' },
    body: JSON.stringify(toNotify),
  });
}

// ══════════════════════════════════════════════════════════════
//  CARD ZOOM LIGHTBOX WITH LOUPE  (přidáno)
// ══════════════════════════════════════════════════════════════

let czlImgs = [];         // list of image srcs in current gallery
let czlIdx  = 0;          // currently shown index
let czlZoomFactor = 3.5;  // magnification

/* ── Open ──────────────────────────────────────────────────── */
function openCardZoom(startIdx) {
  // Collect all gallery images
  const thumbImgs = Array.from(document.querySelectorAll('.gallery-thumb img'));
  const mainImg   = document.getElementById('mainGalleryImg');

  if (thumbImgs.length > 0) {
    czlImgs = thumbImgs.map(t => t.src);
  } else if (mainImg?.src) {
    czlImgs = [mainImg.src];
  } else { return; }

  czlIdx = (startIdx !== undefined) ? Math.max(0, Math.min(startIdx, czlImgs.length - 1)) : 0;

  // Title + meta from detail panel
  const title = document.getElementById('dTitle')?.textContent || '';
  const tagsEl= document.getElementById('dTags');
  document.getElementById('czlTitle').textContent = title;
  document.getElementById('czlMeta').innerHTML = tagsEl ? tagsEl.innerHTML : '';

  // Nav visibility
  const multi = czlImgs.length > 1;
  document.getElementById('czlNavL').style.display = multi ? '' : 'none';
  document.getElementById('czlNavR').style.display = multi ? '' : 'none';

  // Load existing condition description if any
  const _savedDescs = JSON.parse(localStorage.getItem('pkc_cond_desc') || '{}');
  document.getElementById('czlDesc').value = _savedDescs[currentListing?.id] || currentListing?.condition_description || currentListing?.description || '';

  czlLoadImg(czlIdx);

  const lb = document.getElementById('cardZoomLightbox');
  lb.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeCardZoom() {
  document.getElementById('cardZoomLightbox').style.display = 'none';
  document.getElementById('czlLoupe').style.display = 'none';
  document.body.style.overflow = '';
}

function czlBgClick(e) {
  if (e.target === document.getElementById('cardZoomLightbox')) closeCardZoom();
}

/* ── Image loading ─────────────────────────────────────────── */
function czlLoadImg(idx) {
  czlIdx = Math.max(0, Math.min(idx, czlImgs.length - 1));
  const img = document.getElementById('czlImg');
  img.style.opacity = 0;
  img.src = czlImgs[czlIdx];
  document.getElementById('czlPhotoIdx').textContent = `${czlIdx + 1} / ${czlImgs.length}`;
  document.getElementById('czlPhotoIdx').style.display = czlImgs.length > 1 ? '' : 'none';
  czlHideLoupe();
}

function czlImgLoaded() {
  document.getElementById('czlImg').style.opacity = 1;
}

function czlNav(dir) { czlLoadImg(czlIdx + dir); }

/* ── Loupe logic ────────────────────────────────────────────── */
function czlShowLoupe() {
  document.getElementById('czlLoupe').style.display = 'block';
}
function czlHideLoupe() {
  document.getElementById('czlLoupe').style.display = 'none';
}

function czlOnMove(e) {
  const img   = document.getElementById('czlImg');
  const loupe = document.getElementById('czlLoupe');
  const iRect = img.getBoundingClientRect();
  const LSIZE = 210;

  const relX = e.clientX - iRect.left;
  const relY = e.clientY - iRect.top;

  // 16px přesah – lupa zmizí až ~1cm za okrajem fotky
  const EDGE = 16;
  if (relX < -EDGE || relY < -EDGE || relX > iRect.width + EDGE || relY > iRect.height + EDGE) {
    czlHideLoupe(); return;
  }
  // Clamp – zoom se "zmrazí" na okraji, nevyleze mimo obrázek
  const clampedX = Math.max(0, Math.min(relX, iRect.width));
  const clampedY = Math.max(0, Math.min(relY, iRect.height));
  loupe.style.display = 'block';

  // Position loupe: prefer top-right of cursor, flip if near edge
  const OX = 28, OY = 28;
  let lx = e.clientX - LSIZE / 2;   // centered on cursor X
  let ly = e.clientY - LSIZE / 2;   // centered on cursor Y
  // Clamp to viewport
  lx = Math.max(4, Math.min(lx, window.innerWidth  - LSIZE - 4));
  ly = Math.max(4, Math.min(ly, window.innerHeight - LSIZE - 4));

  loupe.style.left = lx + 'px';
  loupe.style.top  = ly + 'px';

  // Background zoom
  const z   = czlZoomFactor;
  const bgX = -(clampedX * z - LSIZE / 2);
  const bgY = -(clampedY * z - LSIZE / 2);
  loupe.style.backgroundImage    = `url('${img.src}')`;
  loupe.style.backgroundSize     = `${iRect.width * z}px ${iRect.height * z}px`;
  loupe.style.backgroundPosition = `${bgX}px ${bgY}px`;
}

function czlUpdateZoom(val) {
  czlZoomFactor = parseFloat(val);
  document.getElementById('czlZoomVal').textContent = czlZoomFactor + '×';
}

/* ── Keyboard nav ───────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  const lb = document.getElementById('cardZoomLightbox');
  if (!lb || lb.style.display === 'none') return;
  if (e.key === 'Escape')      { closeCardZoom(); }
  if (e.key === 'ArrowLeft')   { czlNav(-1); }
  if (e.key === 'ArrowRight')  { czlNav(1); }
});

/* ── AI condition analysis ─────────────────────────────────── */
async function czlAnalyze() {
  const img     = document.getElementById('czlImg');
  const btn     = document.getElementById('czlAiBtn');
  const loading = document.getElementById('czlAiLoading');
  const textarea= document.getElementById('czlDesc');

  if (!img?.src) return;

  btn.disabled = true;
  loading.style.display = 'flex';
  textarea.value = '';
  textarea.placeholder = '';

  const cardName = document.getElementById('czlTitle')?.textContent || 'Pokémon karta';
  const condTag  = (currentListing?.condition || '').toUpperCase();

  // Try to fetch image as base64 (works for Supabase/uploaded photos)
  let base64Data = null, mediaType = 'image/jpeg';
  try {
    const r = await fetch(img.src);
    const blob = await r.blob();
    mediaType = blob.type || 'image/jpeg';
    base64Data = await new Promise((res, rej) => {
      const rd = new FileReader();
      rd.onload = () => res(rd.result.split(',')[1]);
      rd.onerror = rej;
      rd.readAsDataURL(blob);
    });
  } catch (_) { /* CORS – pokusíme se bez obrázku */ }

  const systemPrompt = `Jsi expert na grading a hodnocení stavu sběratelských Pokémon karet. 
Hodnotíš karty pro prodej na českém tržišti. Odpovídáš vždy česky, věcně a konkrétně.
Grading škála: NM (Near Mint – jako nová), LP (Lightly Played – lehce hraná), 
MP (Moderately Played – středně hraná), HP (Heavily Played – hodně hraná), D (Damaged – poškozená).`;

  const userMsg = base64Data
    ? [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
        { type: 'text',  text: `Toto je fotografie karty "${cardName}"${condTag ? ` (inzerována jako ${condTag})` : ''}.

Popiš detailně stav karty z fotografie. Uveď:
1. Celkový grading (NM/LP/MP/HP/D) s odůvodněním
2. Viditelné poškození: škrábance, ohyby, white spotting, vrypy, opotřebení rohů
3. Stav povrchu (lesk, matnost, stopy dotyků)
4. Stav rohů a hran
5. Krátké doporučení pro kupujícího

Odpověz přirozeně v 4–6 větách česky. Buď konkrétní – pokud poškození nevidíš, řekni to.` }
      ]
    : [
        { type: 'text', text: `Karta "${cardName}" je inzerována jako ${condTag || 'NM'}. Fotografie není dostupná (CORS omezení). 
Napiš typický popis stavu karty v gradingu ${condTag || 'NM'} – co kupující může očekávat, na co si dát pozor, jak vypadá karta tohoto stavu obecně. Odpověz v češtině, 4–5 vět.` }
      ];

  try {
    // Převod Anthropic image formátu → Groq/OpenAI image_url formát
    const groqUserContent = base64Data
      ? [
          { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64Data}` } },
          { type: 'text', text: userMsg.find?.(m => m.type === 'text')?.text || (typeof userMsg === 'string' ? userMsg : '') }
        ]
      : (typeof userMsg === 'string' ? userMsg : userMsg[0]?.text || '');

    const resp = await fetch('/api/groq', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json',
                 ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        max_tokens: 1000,
        usage_type: 'search',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: groqUserContent }
        ]
      })
    });

    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || '';

    if (text) {
      textarea.value = text;
    } else {
      textarea.value = 'AI analýza nevrátila výsledek. Zkuste to znovu nebo napište popis ručně.';
    }
  } catch (err) {
    textarea.value = 'Chyba při komunikaci s AI: ' + err.message;
  } finally {
    btn.disabled = false;
    loading.style.display = 'none';
    textarea.placeholder = 'Klikni na tlačítko Analyzovat pro AI popis stavu karty…';
  }
}

/* ── Save description ──────────────────────────────────────── */
async function czlSave() {
  const desc    = (document.getElementById('czlDesc')?.value || '').trim();
  const saveBtn = document.getElementById('czlSaveBtn');

  if (!currentListing?.id) {
    alert('Nelze uložit – nabídka není načtena.'); return;
  }

  saveBtn.textContent = '⏳ Ukládám…';
  saveBtn.disabled = true;

  // Save to DB condition_description column if owner and logged in
  let savedToDb = false;
  if (token && userId && currentListing.user_id === userId) {
    try {
      await sbReq(
        `rest/v1/listings?id=eq.${currentListing.id}`,
        'PATCH',
        { condition_description: desc },
        token
      );
      savedToDb = true;
    } catch (_) { /* silently ignore if column issues */ }
  }

  // Update local state + visible description panel
  currentListing.condition_description = desc;
  const descEl = document.getElementById('dDesc');
  if (descEl) {
    descEl.textContent = desc;
    descEl.style.display = desc ? '' : 'none';
  }

  saveBtn.textContent = savedToDb ? '✅ Uloženo do nabídky!' : '✅ Uloženo lokálně!';
  saveBtn.style.background = 'rgba(74,222,128,0.18)';
  setTimeout(() => {
    saveBtn.textContent = '💾 Uložit popis do nabídky';
    saveBtn.style.background = '';
    saveBtn.disabled = false;
  }, 2200);
}

// ── Album picker po potvrzení prodeje (prodejce) ──────────────
let _apmCallback = null;

async function showSellerAlbumPicker(l) {
  const first     = (l.cards_data||[])[0] || {};
  const cardLocalId = first.id || first.local_id || null;
  const cardName  = l.card_name || first.name || '?';
  const cardImg   = l.api_image_url || first?.images?.small || '';

  // Načti alba prodejce
  let albums = [];
  try {
    const res = await sbReq(`rest/v1/user_albums?user_id=eq.${userId}&select=id,name,card_ids&order=created_at.asc`, 'GET', null, token);
    if (Array.isArray(res)) albums = res;
  } catch(e) {}

  const modal = document.getElementById('albumPickerModal');
  if (!modal) { console.warn('[sellerAlbumPicker] modal nenalezen'); return; }

  document.getElementById('alpTitle').textContent    = '✅ Prodej potvrzen!';
  document.getElementById('alpSubtitle').textContent = `Chceš přesunout „${cardName}" do jiného alba?`;

  const imgEl = document.getElementById('alpCardImg');
  if (imgEl) { imgEl.src = cardImg; imgEl.style.display = cardImg ? '' : 'none'; }
  document.getElementById('alpCardName').textContent = cardName;

  const userAlbsFilt = albums.filter(a => !['Obchod','Výměna'].includes(a.name));
  const list = document.getElementById('alpAlbumList');
  list.innerHTML = [
    ...userAlbsFilt.map(a =>
      `<label style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:9px;border:1.5px solid rgba(255,255,255,0.07);background:rgba(255,255,255,0.03);cursor:pointer;transition:border-color .15s" onmouseover="this.style.borderColor='rgba(245,200,66,0.3)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.07)'">
        <input type="radio" name="alpAlbum" value="${esc(String(a.id))}" style="accent-color:#f5c842;width:15px;height:15px;flex-shrink:0">
        <span style="font-size:13px;color:rgba(240,236,228,0.85)">📒 ${esc(a.name)}</span>
      </label>`),
    `<label style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:9px;border:1.5px solid rgba(255,255,255,0.07);background:rgba(255,255,255,0.03);cursor:pointer">
      <input type="radio" name="alpAlbum" value="__prodano__" style="accent-color:#f5c842;width:15px;height:15px;flex-shrink:0">
      <span style="font-size:13px;color:rgba(240,236,228,0.85)">🏷️ Album „Prodáno" (vytvořit / použít)</span>
    </label>`,
    `<label style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:9px;border:1.5px solid rgba(255,255,255,0.07);background:rgba(255,255,255,0.03);cursor:pointer">
      <input type="radio" name="alpAlbum" value="__none__" checked style="accent-color:#f5c842;width:15px;height:15px;flex-shrink:0">
      <span style="font-size:13px;color:rgba(240,236,228,0.5)">🚫 Nechat bez změny</span>
    </label>`,
  ].join('');

  _apmCallback = async (albumId) => {
    if (!albumId || albumId === '__none__' || !cardLocalId) return;
    const allAlbs = await sbReq(`rest/v1/user_albums?user_id=eq.${userId}&select=id,name,card_ids`, 'GET', null, token);
    if (!Array.isArray(allAlbs)) return;

    // Odeber z Obchod + Výměna
    for (const sName of ['Obchod','Výměna']) {
      const alb = allAlbs.find(a => a.name === sName);
      if (alb && Array.isArray(alb.card_ids)) {
        const cleaned = alb.card_ids.filter(id => String(id) !== String(cardLocalId));
        if (cleaned.length !== alb.card_ids.length)
          await sbReq(`rest/v1/user_albums?id=eq.${alb.id}`, 'PATCH', { card_ids: cleaned }, token);
      }
    }
    // Odeber for_sell/for_trade z karty
    await sbReq(`rest/v1/user_cards?user_id=eq.${userId}&local_id=eq.${cardLocalId}`, 'PATCH', { for_sell: false, for_trade: false }, token);

    if (albumId === '__prodano__') {
      let prodano = allAlbs.find(a => a.name === 'Prodáno');
      if (!prodano) {
        await sbReq('rest/v1/user_albums', 'POST', {
          user_id: userId, name: 'Prodáno', color: '#22c55e', icon: '✅',
          card_ids: [String(cardLocalId)]
        }, token);
      } else {
        const newIds = [...new Set([...(prodano.card_ids||[]), String(cardLocalId)])];
        await sbReq(`rest/v1/user_albums?id=eq.${prodano.id}`, 'PATCH', { card_ids: newIds }, token);
      }
      showMktToast('✅ Karta přesunuta do alba „Prodáno"');
    } else {
      const tgt = allAlbs.find(a => String(a.id) === String(albumId));
      if (tgt) {
        const newIds = [...new Set([...(tgt.card_ids||[]), String(cardLocalId)])];
        await sbReq(`rest/v1/user_albums?id=eq.${tgt.id}`, 'PATCH', { card_ids: newIds }, token);
        showMktToast(`✅ Karta přesunuta do alba „${tgt.name}"`);
      }
    }
  };

  modal.style.display = 'flex';
}

function closeAlbumPicker() {
  const m = document.getElementById('albumPickerModal');
  if (m) m.style.display = 'none';
  _apmCallback = null;
}

async function confirmAlbumPick() {
  const sel = document.querySelector('input[name="alpAlbum"]:checked');
  if (!sel) { showMktToast('Vyber album nebo „Bez změny"'); return; }
  closeAlbumPicker();
  if (_apmCallback) await _apmCallback(sel.value);
}
