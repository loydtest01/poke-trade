// SUPABASE_URL a SUPABASE_ANON jsou načteny z app.js

async function sbReq(path, method='GET', body=null, token=null) {
  const headers = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON,
    'Authorization': 'Bearer ' + (token || SUPABASE_ANON),
  };
  if (['POST','PATCH'].includes(method) && !path.startsWith('auth/'))
    headers['Prefer'] = 'return=representation';
  const res  = await fetch(`${SUPABASE_URL}/${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) return { _err: data.message || data.error || 'HTTP '+res.status };
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
let tradeViewMode='img', selectedTradeIds=new Set();

// ── Load listings ─────────────────────────────────────────────
(async function loadListings(){
  document.getElementById('listingsWrap').innerHTML =
    Array(5).fill('<div class="skeleton-row"></div>').join('');
  const res = await sbReq('rest/v1/listings?status=eq.active&select=*&order=created_at.desc&limit=100');
  if(!Array.isArray(res) || res._err){
    document.getElementById('listingsWrap').innerHTML =
      '<div class="empty-state"><div class="icon">⚠️</div><h3>Chyba načítání</h3></div>';
    return;
  }
  allListings = res;
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
  // Stav karty
  ['fNM','fLP','fMP'].forEach(id => { const el = document.getElementById(id); if(el) el.checked = true; });
  ['fHP'].forEach(id => { const el = document.getElementById(id); if(el) el.checked = false; });
  // Elementy
  ['fFire','fWater','fGrass','fElec','fPsychic','fDark','fDragon','fOther'].forEach(id => { const el = document.getElementById(id); if(el) el.checked = false; });
  // Vzácnost
  ['fCommon','fRare','fUltra'].forEach(id => { const el = document.getElementById(id); if(el) el.checked = false; });
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
        const res  = await fetch('https://api.pokemontcg.io/v2/cards/' + idMatch[1]);
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
  const c = { sell:0, trade:0, NM:0, LP:0, MP:0, HP:0 };
  baseListings.forEach(l => {
    if (l.allow_trade === false || l.price_czk > 0) c.sell++;
    if (l.allow_trade === true) c.trade++;
    const cond = l.card_condition || 'NM';
    if      (cond==='NM')            c.NM++;
    else if (cond==='LP')            c.LP++;
    else if (cond==='MP')            c.MP++;
    else if (cond==='HP'||cond==='D') c.HP++;
  });
  const upd = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = val;
    el.classList.toggle('has-val', val > 0);
  };
  upd('sbCountSell',  c.sell);
  upd('sbCountTrade', c.trade);
  upd('sbCountNM',    c.NM);
  upd('sbCountLP',    c.LP);
  upd('sbCountMP',    c.MP);
  upd('sbCountHP',    c.HP);
}

// ── Filters + Sort ────────────────────────────────────────────
function applyFilters(){
  const q       = (document.getElementById('searchInput').value||'').toLowerCase();
  const fSell   = document.getElementById('fSell').checked;
  const fTrade  = document.getElementById('fTrade').checked;
  const fNM     = document.getElementById('fNM').checked;
  const fLP     = document.getElementById('fLP').checked;
  const fMP     = document.getElementById('fMP').checked;
  const fHP     = document.getElementById('fHP').checked;
  const prMin   = parseFloat(document.getElementById('fPriceMin').value)||0;
  const prMax   = parseFloat(document.getElementById('fPriceMax').value)||Infinity;

  // Element filters
  const elFilters = [];
  if(document.getElementById('fFire').checked)    elFilters.push('fire');
  if(document.getElementById('fWater').checked)   elFilters.push('water');
  if(document.getElementById('fGrass').checked)   elFilters.push('grass');
  if(document.getElementById('fElec').checked)    elFilters.push('lightning','electric');
  if(document.getElementById('fPsychic').checked) elFilters.push('psychic');
  if(document.getElementById('fDark').checked)    elFilters.push('darkness','dark');
  if(document.getElementById('fDragon').checked)  elFilters.push('dragon');
  if(document.getElementById('fOther').checked)   elFilters.push('other');
  const anyEl = elFilters.length === 0;

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
          <span>Prodejce: <b>${esc(l.username||'?')}</b></span>
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
          ? `<div class="price-big">${price.toLocaleString('cs')} Kč<small>~ ${(price/25).toFixed(0)} €</small></div>`
          : `<div class="price-trade">Výměna</div>`}
        <div class="offer-count">${l.offer_count||0} nabídek</div>
        <div class="action-btns">
          ${price>0 ? `<button class="btn-buy" onclick="event.stopPropagation();openDetail('${esc(l.id)}')">Koupit</button>` : ''}
          <button class="btn-offer" onclick="event.stopPropagation();openDetail('${esc(l.id)}')">Nabídnout</button>
          ${isTrade ? `<button class="btn-trade-sm" onclick="event.stopPropagation();openDetail('${esc(l.id)}')">Vyměnit</button>` : ''}
        </div>
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
  document.getElementById('dSeller').innerHTML=`Prodejce: <span>${esc(l.username||'?')}</span> · ${timeAgo(l.created_at)} · ${l.view_count||0} zobrazení`;

  // Price
  if(price>0){
    document.getElementById('dPrice').textContent=price.toLocaleString('cs')+' Kč';
    document.getElementById('dPriceEur').textContent='~ '+(price/25).toFixed(0)+' €';
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
  if(l.description){ descEl.textContent=l.description; descEl.style.display=''; }
  else descEl.style.display='none';

  // Buttons
  document.getElementById('dBtnBuy').style.display=price>0?'':'none';
  if(price>0) document.getElementById('dBtnBuy').textContent='Koupit za '+price.toLocaleString('cs')+' Kč';
  document.getElementById('dBtnTrade').style.display=isTrade?'':'none';

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
  sbReq(`rest/v1/rpc/increment_view_count`,'POST',{listing_uuid:l.id});
}

function buildGallery(l, firstCard){
  const apiImg = l.api_image_url || firstCard?.images?.large || firstCard?.images?.small || firstCard?.imageUrl || firstCard?.apiSmall || '';
  const photos = []; // would load from listing_photos table in production

  const allImgs = [apiImg, ...photos].filter(Boolean);
  const mainEl  = document.getElementById('galleryMain');
  const thumbsEl= document.getElementById('galleryThumbs');

  if(allImgs.length){
    mainEl.innerHTML=`<img src="${esc(allImgs[0])}" id="mainGalleryImg" style="width:100%;height:100%;object-fit:contain">`;
  } else {
    mainEl.innerHTML=`<div style="text-align:center;color:var(--text3);padding:20px"><div style="font-size:40px;margin-bottom:8px">🃏</div>${esc(firstCard?.name||'?')}</div>`;
  }

  thumbsEl.innerHTML = allImgs.map((src,i)=>
    `<div class="gallery-thumb ${i===0?'act':''}" onclick="setGalleryImg('${esc(src)}',${i})">
      <img src="${esc(src)}" loading="lazy">
    </div>`
  ).join('') + (allImgs.length===0?'':'');
}

function setGalleryImg(src, idx){
  const img = document.getElementById('mainGalleryImg');
  if(img) img.src=src;
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
function doBuy(){
  if(!token){ alert('Pro koupi se přihlas.'); return; }
  if(!currentListing) return;
  // Otevře panel pro potvrzení + zprávu
  togglePanel('offerPanel');
  document.getElementById('offerPrice').value=currentListing.price_czk||'';
  document.getElementById('offerMsg').placeholder='Potvrzuji zájem o koupi za '+currentListing.price_czk+' Kč. Domluvme se na předání.';
}

async function sendOffer(){
  if(!token){ alert('Přihlas se pro odeslání nabídky.'); return; }
  const price = parseInt(document.getElementById('offerPrice').value)||0;
  const msg   = document.getElementById('offerMsg').value.trim();
  if(!price && !msg){ alert('Zadej cenu nebo zprávu.'); return; }
  const l = currentListing;
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
  if(res._err){ alert('Chyba: '+res._err); return; }
  alert('Nabídka odeslána!');
  togglePanel('offerPanel');
}

async function sendTrade(){
  if(!token){ alert('Přihlas se pro odeslání výměny.'); return; }
  const selCards = myCards.filter(c=>selectedTradeIds.has(String(c.id)));
  if(!selCards.length){ alert('Vyber alespoň jednu kartu k výměně.'); return; }
  const l=currentListing;
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
  if(res._err){ alert('Chyba: '+res._err); return; }
  alert('Výměna navržena!');
  togglePanel('tradePanel');
  selectedTradeIds.clear();
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
  // Reset product form
  selectedProdType='booster'; selectedProdLang='EN'; selectedSealCond='sealed';
  selectedProdSet=null; prodPhotos=[];
  const pi = document.getElementById('prodSetInput'); if(pi) pi.value='';
  const ps = document.getElementById('prodSetSelected'); if(ps) ps.style.display='none';
  const pr = document.getElementById('prodSetResults'); if(pr) pr.style.display='none';
  const strip = document.getElementById('prodPhotoStrip'); if(strip) strip.innerHTML='';
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
    fill.style.width='15%';
    stat.textContent='Analyzuji obraz...';

    try {
      // Step 1: Claude AI vision
      fill.style.width='35%';
      stat.textContent='AI rozpoznává kartu...';
      const aiResult = await callClaudeVision(aiPhotoBase64, aiPhotoMime);

      fill.style.width='60%';
      stat.textContent='Hledám v databázi pokemontcg.io...';

      // Step 2: Search pokemontcg.io
      const candidates = await searchPokemonTcg(aiResult);

      fill.style.width='90%';
      stat.textContent='Zpracovávám výsledky...';

      await new Promise(r=>setTimeout(r,300));
      fill.style.width='100%';
      prog.style.display='none';
      zone.classList.remove('scanning');

      if(!candidates.length){
        // Nothing found – show manual fallback
        showAiFailure(zone, imgSrc, aiResult);
      } else if(candidates.length === 1 || (aiResult.confidence === 'high' && candidates.length <= 2)){
        // Auto-select best match
        applyAiCard(candidates[0], imgSrc, aiResult.confidence || 'med');
        showAiSuccess(zone, imgSrc, candidates[0], aiResult.confidence || 'med');
      } else {
        // Multiple candidates – show picker
        showAiSuccess(zone, imgSrc, candidates[0], aiResult.confidence || 'med');
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

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
          { type: 'text', text: prompt }
        ]
      }]
    })
  });
  const data = await response.json();
  const raw = data.content?.map(b=>b.text||'').join('') || '{}';
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
      const res  = await fetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=8&orderBy=-set.releaseDate`);
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
  addCardData = card;
  // Also store user photo
  addCardData._userPhoto = photoSrc;
  document.getElementById('addCardImg').src   = card.images?.small || photoSrc;
  document.getElementById('addCardName').textContent = card.name;
  document.getElementById('addCardMeta').textContent = (card.set?.name||'')+(card.number?' · #'+card.number:'')+(card.rarity?' · '+card.rarity:'');
  document.getElementById('addCardPreview').style.display='flex';
}

function showAiSuccess(zone, photoSrc, card, confidence){
  const confClass = confidence==='high'?'high':confidence==='med'?'med':'low';
  const confLabel = confidence==='high'?'✓ Vysoká jistota':confidence==='med'?'~ Střední jistota':'? Nízká jistota';
  zone.innerHTML = `
    <input type="file" id="aiPhotoInput" accept="image/*" style="display:none" onchange="handleAiPhoto(this.files[0])">
    <div class="ai-preview-wrap" onclick="event.stopPropagation()">
      <img class="ai-preview-img" src="${esc(card.images?.small||photoSrc)}" onerror="this.src='${esc(photoSrc)}'">
      <div class="ai-preview-info">
        <div class="ai-preview-name">${esc(card.name)}</div>
        <div class="ai-preview-meta">${esc(card.set?.name||'')}${card.number?' · #'+esc(card.number):''}${card.rarity?' · '+esc(card.rarity):''}</div>
        <div class="ai-preview-conf ${confClass}">${confLabel}</div>
      </div>
      <button class="ai-preview-change" onclick="document.getElementById('aiPhotoInput').click()">📸 Změnit</button>
    </div>`;
}

function showAiFailure(zone, photoSrc, aiResult){
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
}

function showAiError(zone, photoSrc, errMsg){
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
  if(zone) showAiSuccess(zone, aiPickPhoto, c, 'high');
  closeAiPick();
}

function closeAiPick(){
  document.getElementById('aiPickModal').style.display='none';
}

async function fetchCardForListing(){
  const url=document.getElementById('addCardUrl').value.trim();
  if(!url) return;
  const q=`name:"${url}"`;
  const apiUrl=url.includes('pokemontcg.io')
    ? url
    : `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=1`;
  try {
    const res  = await fetch(apiUrl);
    const json = await res.json();
    const card = json?.data?.[0] || json;
    if(!card?.name) { alert('Karta nenalezena.'); return; }
    addCardData=card;
    document.getElementById('addCardImg').src   = card.images?.small||'';
    document.getElementById('addCardName').textContent = card.name;
    document.getElementById('addCardMeta').textContent = (card.set?.name||'')+(card.number?' #'+card.number:'');
    document.getElementById('addCardPreview').style.display='flex';
  } catch(e){ alert('Chyba načítání: '+e.message); }
}

function setAddType(type){
  addType=type;
  ['sell','trade','both'].forEach(t=>{
    document.getElementById('addType'+t.charAt(0).toUpperCase()+t.slice(1)).classList.toggle('act',t===type);
  });
  document.getElementById('addPriceRow').style.display=(type==='sell'||type==='both')?'':'none';
  document.getElementById('addTradeRow').style.display=(type==='trade'||type==='both')?'':'none';
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
  } : {};

  const payload = {
    user_id:        userId,
    username:       username,
    title:          card?.name || 'Nabídka',
    cards_data:     [cardData],
    card_name:      card?.name||'',
    card_set:       card?.set?.name||'',
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
    const res  = await fetch('https://api.pokemontcg.io/v2/sets?q=name:"'+encodeURIComponent(q)+'"&pageSize=10&orderBy=-releaseDate');
    const json = await res.json();
    const sets = json.data || [];
    if(!sets.length) {
      // Fallback: search without quotes
      const res2  = await fetch('https://api.pokemontcg.io/v2/sets?q=name:'+encodeURIComponent(q)+'&pageSize=8&orderBy=-releaseDate');
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
  const strip = document.getElementById('prodPhotoStrip');
  if(!strip) return;
  strip.innerHTML = prodPhotos.map((p,i) =>
    `<div style="position:relative">
      <img class="photo-thumb" src="${p.src}">
      <button onclick="removeProdPhoto(${i})" style="position:absolute;top:-4px;right:-4px;background:rgba(248,113,113,0.9);border:none;border-radius:50%;width:16px;height:16px;color:#fff;font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1">✕</button>
    </div>`).join('');
  document.getElementById('prodPhotoContent').style.display = prodPhotos.length ? 'none' : '';
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
  const q = getPendingQueue().filter(c => c._pendingId !== pendingId);
  savePendingQueue(q);
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

function renderPendingList() {
  const wrap = document.getElementById('pendingList');
  if (!wrap) return;
  const q = getPendingQueue();
  if (!q.length) {
    wrap.innerHTML = '<div class="pending-empty">Žádné karty nečekají na vystavení.<br><a href="moje-album.html" style="color:var(--blue)">Označ karty v Moje album →</a></div>';
    return;
  }
  wrap.innerHTML = q.map(card => {
    // DEBUG – zobrazí klíče karty v konzoli aby bylo vidět pod jakým polem je obrázek
    console.log('[PendingQueue] card keys:', Object.keys(card), '| images:', card.images, '| apiSmall:', card.apiSmall, '| imageUrl:', card.imageUrl);
    const img    = card.images?.small || card.images?.large || card.apiSmall || card.imageUrl || card.api_image_url || card.image || card.img || card.smallImage || card.cardImage || '';

    const name   = esc(card.name || '—');
    const set    = esc(card.set?.name || (typeof card.set === 'string' ? card.set : '') || '');
    const num    = card.number ? ' · #' + esc(card.number) : '';
    const cond   = esc(card.condition || card.card_condition || 'NM');
    const price  = card.album_price ? card.album_price + ' Kč' : '—';
    const pid    = esc(card._pendingId || card.id || '');
    return `<div class="pending-row" onclick="openListingFromQueue(${JSON.stringify(JSON.stringify(card))})">
      ${img ? `<img class="pending-row-img" src="${esc(img)}" loading="lazy">` : '<div class="pending-row-img"></div>'}
      <div class="pending-row-info">
        <div class="pending-row-name">${name}</div>
        <div class="pending-row-meta">${set}${num}</div>
      </div>
      <div class="pending-row-cond">${cond}</div>
      <div class="pending-row-price">${price}</div>
      <button class="pending-row-del" title="Odebrat z fronty" onclick="event.stopPropagation();removePendingCard('${pid}')">✕</button>
    </div>`;
  }).join('');
}

/** Open the listing modal pre-filled from a pending queue card */
function openListingFromQueue(jsonStr) {
  const card = JSON.parse(jsonStr);
  _pendingFromQueue = card;
  if (!token) { alert('Přihlas se pro přidání nabídky.'); return; }

  // Close pending modal and open the listing modal
  togglePendingPanel(false);
  document.getElementById('addModal').style.display = 'flex';
  resetAiZone();
  setTimeout(generateInlineQr, 300);

  // Pre-fill card data
  addCardData = card;
  document.getElementById('addCardImg').src = card.images?.small || card.images?.large || card.apiSmall || card.imageUrl || card.api_image_url || '';
  document.getElementById('addCardName').textContent = card.name || '';
  const setName = card.set?.name || (typeof card.set === 'string' ? card.set : '') || '';
  const num = card.number ? ' #' + card.number : '';
  document.getElementById('addCardMeta').textContent = setName + num;
  document.getElementById('addCardPreview').style.display = 'flex';
  if (card.id && !card.id.startsWith('search_')) {
    document.getElementById('addCardUrl').value = card.id;
  }

  // Pre-fill condition
  const condSel = document.getElementById('addCond');
  const cond = card.condition || card.card_condition || 'NM';
  if (condSel) {
    for (let opt of condSel.options) { if (opt.value === cond) { opt.selected = true; break; } }
  }

  // Show album price as info
  const priceInfo = document.getElementById('albumPriceInfo');
  const priceVal  = document.getElementById('albumPriceVal');
  if (card.album_price && priceInfo && priceVal) {
    priceVal.textContent = card.album_price;
    priceInfo.style.display = 'flex';
    // Suggest the price in the input but user can change it
    document.getElementById('addPrice').value = card.album_price;
  } else if (priceInfo) {
    priceInfo.style.display = 'none';
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
  if (_qrInlineGenerated) return; // already generated
  _qrInlineGenerated = true;

  const base = window.location.origin + window.location.pathname;
  const url  = base + '?newlisting=1&mode=camera';
  window._qrInlineUrl = url;

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
    if (panel) { panel.style.borderColor='rgba(116,180,255,0.35)'; panel.style.cursor='default'; }
  } else {
    container.innerHTML = '<div style="color:#f87171;font-size:9px;text-align:center;padding:8px">QR knihovna<br>se načítá…</div>';
    setTimeout(() => { _qrInlineGenerated = false; generateInlineQr(); }, 1500);
  }
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
  if (panel) { panel.style.borderColor=''; panel.style.cursor='pointer'; }
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

function openChat() {
  if(!token){ alert('Přihlas se pro psaní zpráv.'); return; }
  if(!currentListing) return;
  var l = currentListing;
  var sellerId = l.user_id;
  var sellerName = encodeURIComponent(l.username || '');
  window.location.href = 'chat.html?with=' + sellerId + '&username=' + sellerName + '&listing=' + l.id;
}

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

  try {
    let q = '';
    if(name) q += `name:"${name}"`;
    if(set)  q += (q?' ':'') + `set.name:"${set}"`;

    // Also try partial match if exact fails
    let url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=20&orderBy=name`;

    let res = await fetch(url);
    let json = await res.json();

    // Fallback: pokud nic, zkus bez uvozovek
    if(!json.data?.length && name){
      const q2 = name + (set ? ` set.name:${set}` : '');
      res = await fetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q2)}&pageSize=20`);
      json = await res.json();
    }

    const cards = json.data || [];
    if(!cards.length){
      wrap.innerHTML='<div class="csb-empty">Žádné karty nenalezeny. Zkus jiné jméno nebo sérii.</div>';
      return;
    }

    wrap.innerHTML = cards.map(c=>{
      const img = c.images?.small || '';
      const setName = c.set?.name || '';
      const num  = c.number || '';
      const rarity = c.rarity || '';
      return `<div class="csb-card-row" id="csr-${esc(c.id)}" onclick="selectSearchCard(${JSON.stringify(JSON.stringify(c))})">
        ${img ? `<img class="csb-card-img" src="${esc(img)}" loading="lazy">` : '<div style="width:40px;height:55px;background:rgba(255,255,255,0.05);border-radius:5px;flex-shrink:0"></div>'}
        <div class="csb-card-info">
          <div class="csb-card-name">${esc(c.name)}</div>
          <div class="csb-card-meta">${esc(setName)}${num?' · #'+esc(num):''}${rarity?' · '+esc(rarity):''}</div>
        </div>
        <button class="csb-card-select" onclick="event.stopPropagation();useSearchCard(${JSON.stringify(JSON.stringify(c))})">
          ${cardSearchMode==='trade' ? 'Nabídnout' : 'Vybrat'}
        </button>
      </div>`;
    }).join('');
  } catch(e){
    wrap.innerHTML=`<div class="csb-empty">Chyba: ${esc(e.message)}</div>`;
  }
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
    // Naplní formulář pro novou nabídku
    addCardData = c;
    document.getElementById('addCardImg').src  = c.images?.small||'';
    document.getElementById('addCardName').textContent = c.name;
    document.getElementById('addCardMeta').textContent = (c.set?.name||'')+(c.number?' #'+c.number:'');
    document.getElementById('addCardPreview').style.display='flex';
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
  // Uncheck all element checkboxes first
  ['fFire','fWater','fGrass','fElec','fPsychic','fDark','fDragon','fOther'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.checked = false;
  });
  if (!val) return; // "Všechny typy" → uncheck all (= no filter = show all)
  const map = {
    fire:      'fFire',
    water:     'fWater',
    grass:     'fGrass',
    lightning: 'fElec',
    psychic:   'fPsychic',
    darkness:  'fDark',
    dragon:    'fDragon',
    fighting:  'fOther',
    metal:     'fOther',
    colorless: 'fOther',
  };
  const cbId = map[val];
  if (cbId) {
    const cb = document.getElementById(cbId);
    if (cb) cb.checked = true;
  }
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
    const checks = {
      fire:     document.getElementById('fFire')?.checked,
      water:    document.getElementById('fWater')?.checked,
      grass:    document.getElementById('fGrass')?.checked,
      lightning:document.getElementById('fElec')?.checked,
      psychic:  document.getElementById('fPsychic')?.checked,
      darkness: document.getElementById('fDark')?.checked,
      dragon:   document.getElementById('fDragon')?.checked,
      other:    document.getElementById('fOther')?.checked,
    };
    const active = Object.entries(checks).filter(([,v])=>v).map(([k])=>k);
    if (active.length === 0) typSel.value = '';
    else if (active.length === 1) typSel.value = active[0] === 'other' ? 'fighting' : active[0];
    else typSel.value = ''; // multiple → reset
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
