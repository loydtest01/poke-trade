/* ═══════════════════════════════════════════════════════════════════════════
   ONLINE TRŽIŠTĚ – přihlášení k webovému účtu + odesílání karet na výměnu/prodej
   Účet je zcela oddělený od lokálních profilů.

   🔧 NASTAVENÍ: Vyplň API_BASE URL svého Vercel projektu po nasazení webu.
═══════════════════════════════════════════════════════════════════════════ */

import { allCards, activeProfileId } from './state.js';
import { toast, openModal, closeModal } from './ui.js';

// ─── KONFIGURACE API ─────────────────────────────────────────────────────────
// Po nasazení webu na Vercel sem vlož svoji URL:
// Příklad: 'https://pokemon-trade-abc123.vercel.app/v1'
const API_BASE = 'https://TVUJ-PROJEKT.vercel.app/v1';

// ─── LOKÁLNÍ STAV ONLINE ÚČTU ────────────────────────────────────────────────
function getOnlineSession() {
  try {
    return JSON.parse(localStorage.getItem('pkc_online_session') || 'null');
  } catch { return null; }
}

function saveOnlineSession(session) {
  if (session) {
    localStorage.setItem('pkc_online_session', JSON.stringify(session));
  } else {
    localStorage.removeItem('pkc_online_session');
  }
}

export function getOnlineUser() {
  return getOnlineSession();
}

export function isOnlineLoggedIn() {
  const s = getOnlineSession();
  return !!(s && s.token);
}

// ─── RENDER STAVU TLAČÍTKA V NAVBARU ─────────────────────────────────────────
export function renderOnlineStatus() {
  const btn     = document.getElementById('btnOnlineMarket');
  const dot     = document.getElementById('onlineDot');
  const label   = document.getElementById('onlineUserLabel');
  const session = getOnlineSession();

  if (!btn) return;

  if (session) {
    if (dot)   { dot.style.background = '#22c55e'; dot.title = 'Přihlášen: ' + session.username; }
    if (label) label.textContent = session.username;
    btn.title = 'Tržiště – přihlášen jako ' + session.username;
  } else {
    if (dot)   { dot.style.background = '#6b7280'; dot.title = 'Nepřihlášen'; }
    if (label) label.textContent = '';
    btn.title = 'Tržiště – nepřihlášen';
  }
}

// ─── OTEVŘÍT DROPDOWN TRŽIŠTĚ ────────────────────────────────────────────────
export function openOnlineMenu(anchorEl) {
  document.getElementById('transportDropdown')?.classList.remove('open');

  const dd = document.getElementById('onlineMarketDropdown');
  if (!dd) return;

  const isOpen = dd.classList.contains('open');
  dd.classList.toggle('open', !isOpen);

  if (!isOpen) {
    renderOnlineDropdown();
    setTimeout(() => {
      document.addEventListener('click', function onOut(e) {
        if (!dd.contains(e.target) && e.target !== anchorEl) {
          dd.classList.remove('open');
          document.removeEventListener('click', onOut);
        }
      });
    }, 0);
  }
}

function renderOnlineDropdown() {
  const dd = document.getElementById('onlineMarketDropdown');
  if (!dd) return;

  const session = getOnlineSession();

  if (session) {
    dd.innerHTML = `
      <div class="transport-dropdown-header">
        🌐 Tržiště
        <span style="font-weight:400;color:var(--success);margin-left:6px">● ${session.username}</span>
      </div>
      <div class="transport-dropdown-item" onclick="window.openPublishModal&&window.openPublishModal();document.getElementById('onlineMarketDropdown').classList.remove('open')">
        <span class="tdi-icon">🔄</span>
        <div>
          <div class="tdi-label">Odeslat na výměnu</div>
          <div class="tdi-sub">Karty označené K výměně</div>
        </div>
      </div>
      <div class="transport-dropdown-item" onclick="window.openSellModal&&window.openSellModal();document.getElementById('onlineMarketDropdown').classList.remove('open')">
        <span class="tdi-icon">💰</span>
        <div>
          <div class="tdi-label">Nabídnout k prodeji</div>
          <div class="tdi-sub">Nastav cenu a publikuj</div>
        </div>
      </div>
      <div class="transport-dropdown-item" onclick="window.openMyListingsModal&&window.openMyListingsModal();document.getElementById('onlineMarketDropdown').classList.remove('open')">
        <span class="tdi-icon">📋</span>
        <div>
          <div class="tdi-label">Moje nabídky</div>
          <div class="tdi-sub">Správa aktivních nabídek</div>
        </div>
      </div>
      <div class="transport-dropdown-item" style="border-top:1px solid var(--border);margin-top:4px;padding-top:8px" onclick="window.onlineLogout&&window.onlineLogout()">
        <span class="tdi-icon">🚪</span>
        <div>
          <div class="tdi-label" style="color:var(--danger)">Odhlásit se</div>
          <div class="tdi-sub">${session.email || ''}</div>
        </div>
      </div>
    `;
  } else {
    dd.innerHTML = `
      <div class="transport-dropdown-header">🌐 Online tržiště</div>
      <div style="padding:12px 14px;color:var(--text-muted);font-size:12px;line-height:1.5">
        Přihlas se k webovému účtu a nabídni karty na výměnu nebo prodej ostatním hráčům.
      </div>
      <div class="transport-dropdown-item" onclick="window.openOnlineLoginModal&&window.openOnlineLoginModal();document.getElementById('onlineMarketDropdown').classList.remove('open')">
        <span class="tdi-icon">🔑</span>
        <div>
          <div class="tdi-label">Přihlásit se</div>
          <div class="tdi-sub">Webový účet (PokéTrade)</div>
        </div>
      </div>
      <div class="transport-dropdown-item" onclick="window.openOnlineRegisterInfo&&window.openOnlineRegisterInfo();document.getElementById('onlineMarketDropdown').classList.remove('open')">
        <span class="tdi-icon">✨</span>
        <div>
          <div class="tdi-label">Vytvořit účet</div>
          <div class="tdi-sub">Registrace na webu</div>
        </div>
      </div>
    `;
  }
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
export function openOnlineLoginModal() {
  const el = document.getElementById('olUsernameInput');
  if (el) el.value = '';
  const pe = document.getElementById('olPasswordInput');
  if (pe) pe.value = '';
  const errEl = document.getElementById('olLoginError');
  if (errEl) errEl.style.display = 'none';
  openModal('onlineLoginModal');
}

export async function doOnlineLogin() {
  const username = document.getElementById('olUsernameInput')?.value.trim();
  const password = document.getElementById('olPasswordInput')?.value;
  const errEl    = document.getElementById('olLoginError');
  const btn      = document.getElementById('olLoginBtn');

  if (!username || !password) {
    if (errEl) { errEl.textContent = 'Vyplň uživatelské jméno a heslo.'; errEl.style.display = 'block'; }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Přihlašuji…'; }
  if (errEl) errEl.style.display = 'none';

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.message || 'Chyba přihlášení');

    saveOnlineSession(data);
    closeModal('onlineLoginModal');
    renderOnlineStatus();
    toast('Přihlášen na tržiště jako ' + data.username, '🌐', 'success');

  } catch (err) {
    if (errEl) { errEl.textContent = err.message || 'Přihlášení selhalo.'; errEl.style.display = 'block'; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Přihlásit se'; }
  }
}

export function onlineLogout() {
  saveOnlineSession(null);
  renderOnlineStatus();
  toast('Odhlášen z tržiště', '🌐');
}

export function openOnlineRegisterInfo() {
  // Otevři web v prohlížeči
  const url = API_BASE.replace('/v1', '') + '/register.html';
  if (window.pokemonBridge?.openExternal) {
    window.pokemonBridge.openExternal(url);
  } else {
    window.open(url, '_blank');
  }
  toast('Otevírám registraci v prohlížeči…', '🌐');
}

// ─── ODESLÁNÍ NA VÝMĚNU / PRODEJ ─────────────────────────────────────────────
export function openPublishModal() {
  if (!isOnlineLoggedIn()) { openOnlineLoginModal(); return; }

  const tradeCards = allCards.filter(c =>
    (c.owner === activeProfileId || (activeProfileId === 'vse' && c.owner !== 'demo')) &&
    c.trading
  );

  renderPublishModal(tradeCards, 'trade');
  openModal('onlinePublishModal');
}

export function openSellModal() {
  if (!isOnlineLoggedIn()) { openOnlineLoginModal(); return; }

  const myCards = allCards.filter(c =>
    c.owner === activeProfileId && c.owner !== 'demo'
  );

  renderPublishModal(myCards, 'sell');
  openModal('onlinePublishModal');
}

function renderPublishModal(cards, mode) {
  const title     = document.getElementById('publishModalTitle');
  const body      = document.getElementById('publishCardList');
  const submitBtn = document.getElementById('publishSubmitBtn');
  if (!body) return;

  const isSell = mode === 'sell';
  if (title)     title.textContent     = isSell ? '💰 Nabídnout k prodeji' : '🔄 Odeslat na výměnu';
  if (submitBtn) submitBtn.textContent = isSell ? 'Publikovat k prodeji' : 'Publikovat na výměnu';

  body.dataset.mode = mode;

  if (cards.length === 0) {
    body.innerHTML = `<div class="ol-empty">
      ${isSell
        ? 'Nemáš žádné karty v profilu k prodeji.'
        : 'Nemáš žádné karty označené <strong>K výměně</strong>.<br>Označ karty přepínačem „K výměně" v detailu karty.'}
    </div>`;
    if (submitBtn) submitBtn.disabled = true;
    return;
  }

  if (submitBtn) submitBtn.disabled = false;

  body.innerHTML = `
    <div class="ol-list-header">
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px">
        <input type="checkbox" id="publishSelectAll" onchange="window.publishToggleAll(this.checked)" />
        Vybrat vše (${cards.length})
      </label>
      ${isSell ? '<span style="font-size:11px;color:var(--text-muted)">Nastav cenu v € za kus</span>' : ''}
    </div>
    ${cards.map(c => `
      <div class="ol-card-row" data-id="${c.id}">
        <input type="checkbox" class="ol-card-check" value="${c.id}" checked />
        <div class="ol-card-thumb" style="background:${_typeColor(c.type)}">
          ${c.imageUrl ? `<img src="${c.imageUrl}" onerror="this.style.display='none'" />` : ''}
        </div>
        <div class="ol-card-info">
          <div class="ol-card-name">${c.name || '?'}</div>
          <div class="ol-card-sub">${c.set || ''} · ${c.condition || 'NM'} · ${c.pTrend ? c.pTrend.toFixed(2) + ' €' : '–'}</div>
        </div>
        ${isSell ? `
          <div class="ol-price-wrap">
            <input type="number" class="ol-price-input" placeholder="${c.pTrend ? c.pTrend.toFixed(2) : '0.00'}"
              step="0.01" min="0.01" value="${c.pTrend ? c.pTrend.toFixed(2) : ''}"
              data-id="${c.id}" />
            <span class="ol-price-unit">€</span>
          </div>
        ` : `<div class="ol-trade-badge">🔄 Výměna</div>`}
      </div>
    `).join('')}
  `;
}

window.publishToggleAll = function(checked) {
  document.querySelectorAll('.ol-card-check').forEach(cb => cb.checked = checked);
};

export async function submitPublish() {
  const body    = document.getElementById('publishCardList');
  const btn     = document.getElementById('publishSubmitBtn');
  const mode    = body?.dataset.mode || 'trade';
  const session = getOnlineSession();
  if (!session) return;

  const checked = [...document.querySelectorAll('.ol-card-check:checked')].map(cb => cb.value);
  if (checked.length === 0) { toast('Nevybral(a) jsi žádnou kartu', '⚠️'); return; }

  const cards = checked.map(id => {
    const card = allCards.find(c => c.id === id);
    if (!card) return null;
    const payload = {
      localId:   card.id,
      name:      card.name,
      set:       card.set,
      number:    card.number,
      condition: card.condition || 'NM',
      category:  card.category || 'pokemon',
      type:      card.type,
      types:     card.types || (card.type ? [card.type] : []),
      imageUrl:  card.imageUrl || card.images?.small || null,
      apiSmall:  card.images?.small || null,
      pTrend:    card.pTrend || null,
      rarity:    card.rarity || null,
      mode,
    };
    if (mode === 'sell') {
      const priceEl = document.querySelector(`.ol-price-input[data-id="${id}"]`);
      payload.askPrice    = priceEl ? parseFloat(priceEl.value) || card.pTrend || null : null;
      payload.askPriceCzk = payload.askPrice ? Math.round(payload.askPrice * 25) : null;
    }
    return payload;
  }).filter(Boolean);

  if (btn) { btn.disabled = true; btn.textContent = 'Odesílám…'; }

  try {
    const res = await fetch(`${API_BASE}/listings`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + session.token,
      },
      body: JSON.stringify({ cards, mode }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.message || 'Chyba serveru');

    closeModal('onlinePublishModal');
    toast(
      `${cards.length} karet odesláno na ${mode === 'sell' ? 'prodej' : 'výměnu'} ✅`,
      '🌐', 'success'
    );
  } catch (err) {
    toast('Odeslání selhalo: ' + (err.message || 'chyba'), '❌', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = mode === 'sell' ? 'Publikovat k prodeji' : 'Publikovat na výměnu'; }
  }
}

// ─── MOJE NABÍDKY ─────────────────────────────────────────────────────────────
export async function openMyListingsModal() {
  if (!isOnlineLoggedIn()) { openOnlineLoginModal(); return; }
  openModal('onlineListingsModal');
  await refreshMyListings();
}

async function refreshMyListings() {
  const body = document.getElementById('myListingsBody');
  if (!body) return;
  body.innerHTML = '<div class="ol-empty">Načítám nabídky…</div>';

  const session = getOnlineSession();

  try {
    const res  = await fetch(`${API_BASE}/listings/mine`, {
      headers: { 'Authorization': 'Bearer ' + session.token },
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.message || 'Chyba');

    const listings = data.listings || [];

    if (listings.length === 0) {
      body.innerHTML = '<div class="ol-empty">Zatím nemáš žádné aktivní nabídky.</div>';
      return;
    }

    body.innerHTML = listings.map(l => `
      <div class="ol-card-row">
        <div class="ol-card-info">
          <div class="ol-card-name">${l.title || 'Nabídka'}</div>
          <div class="ol-card-sub">${(l.cards_data || []).length} karet · ${l.mode === 'sell' ? '💰 Prodej' : '🔄 Výměna'}</div>
        </div>
        <button class="btn btn-secondary" style="font-size:11px;padding:4px 10px"
          onclick="window.removeListing('${l.id}')">Stáhnout</button>
      </div>
    `).join('');
  } catch (err) {
    body.innerHTML = `<div class="ol-empty">Nepodařilo se načíst nabídky: ${err.message}</div>`;
  }
}

window.removeListing = async function(listingId) {
  const session = getOnlineSession();
  if (!session) return;
  try {
    await fetch(`${API_BASE}/listings/${listingId}`, {
      method:  'DELETE',
      headers: { 'Authorization': 'Bearer ' + session.token },
    });
    toast('Nabídka stažena', '✅', 'success');
    await refreshMyListings();
  } catch {
    toast('Nepodařilo se stáhnout nabídku', '❌', 'error');
  }
};

// ─── HELPER ───────────────────────────────────────────────────────────────────
function _typeColor(type) {
  const map = {
    fire:'#ef4444', water:'#3b82f6', grass:'#22c55e', electric:'#eab308',
    psychic:'#a855f7', fighting:'#f97316', dark:'#374151', metal:'#6b7280',
    dragon:'#6366f1', fairy:'#ec4899', colorless:'#9ca3af',
  };
  return map[type] || '#374151';
}
