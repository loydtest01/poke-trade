/* ═══════════════════════════════════════════════════════════════════════════
   TRADE UI  –  Badge na kartách + panel v detailu karty
   
   Jak to funguje:
   • MutationObserver sleduje grid karet → přidá badge 🔄/💰 každé kartě
   • Naslouchá na otevření detailu → přidá sekci „K výměně / K prodeji"
   • Používá setTradeStatus() z album-sync.js pro ukládání + sync
   
   Integrace do main.js:
     import { initTradeUI } from './trade-ui.js';
     // po inicializaci alba (kde se renderují karty):
     initTradeUI();
═══════════════════════════════════════════════════════════════════════════ */

import { setTradeStatus, getSyncMode } from './album-sync.js';

// ── CSS badge styly (injektuje se jednou) ────────────────────────────────────
const BADGE_CSS = `
  .trade-ui-badge {
    position: absolute; top: 5px; right: 5px; z-index: 10;
    display: flex; flex-direction: column; gap: 3px; align-items: flex-end;
    pointer-events: none;
  }
  .trade-ui-pill {
    font-size: 8px; font-weight: 800; padding: 2px 6px; border-radius: 6px;
    letter-spacing: .04em; line-height: 1.5; backdrop-filter: blur(6px);
    white-space: nowrap; border: 1px solid transparent;
  }
  .trade-ui-pill.trade { background: rgba(74,158,255,0.9); color: #fff; border-color: rgba(74,158,255,.5); }
  .trade-ui-pill.sell  { background: rgba(34,197,94,0.9);  color: #fff; border-color: rgba(34,197,94,.5); }
  .trade-ui-pill.price { background: rgba(0,0,0,0.8); color: #f5c842; border-color: rgba(245,200,66,.3); }

  /* ── Sekce v detailu karty ─── */
  .trade-detail-section {
    margin-top: 16px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 14px;
    padding: 14px 16px;
  }
  .trade-detail-title {
    font-size: 10px; font-weight: 800; letter-spacing: .1em;
    text-transform: uppercase; color: rgba(255,255,255,.4);
    margin-bottom: 12px;
  }
  .trade-toggle-row {
    display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap;
  }
  .trade-toggle-btn {
    flex: 1; min-width: 120px;
    display: flex; align-items: center; justify-content: center; gap: 7px;
    padding: 9px 14px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.04); color: rgba(255,255,255,0.5);
    font-family: inherit; font-size: 13px; font-weight: 600;
    cursor: pointer; transition: all .18s; user-select: none;
  }
  .trade-toggle-btn:hover { border-color: rgba(255,255,255,0.2); color: rgba(255,255,255,0.8); }
  .trade-toggle-btn.active-trade {
    background: rgba(74,158,255,0.15); border-color: rgba(74,158,255,0.5);
    color: #4a9eff;
  }
  .trade-toggle-btn.active-sell {
    background: rgba(34,197,94,0.15); border-color: rgba(34,197,94,0.5);
    color: #4ade80;
  }
  .trade-price-row {
    display: flex; align-items: center; gap: 8px;
    margin-top: 6px; transition: opacity .2s;
  }
  .trade-price-row.hidden { opacity: 0; pointer-events: none; }
  .trade-price-label {
    font-size: 12px; color: rgba(255,255,255,.4); white-space: nowrap;
  }
  .trade-price-input {
    flex: 1; background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1); border-radius: 8px;
    padding: 7px 10px; color: #f5c842; font-family: inherit;
    font-size: 13px; font-weight: 700; outline: none; width: 100%;
    transition: border-color .15s;
  }
  .trade-price-input:focus { border-color: rgba(245,200,66,0.5); }
  .trade-price-input::placeholder { color: rgba(255,255,255,.2); font-weight: 400; }
  .trade-save-btn {
    display: flex; align-items: center; justify-content: center; gap: 6px;
    width: 100%; padding: 9px; border-radius: 10px; margin-top: 12px;
    background: rgba(245,200,66,0.12); border: 1px solid rgba(245,200,66,0.3);
    color: #f5c842; font-family: inherit; font-size: 13px; font-weight: 700;
    cursor: pointer; transition: all .18s;
  }
  .trade-save-btn:hover { background: rgba(245,200,66,0.22); }
  .trade-save-btn:disabled { opacity: .4; cursor: not-allowed; }
  .trade-save-btn.saved { background: rgba(34,197,94,0.15); border-color: rgba(34,197,94,0.4); color: #4ade80; }
  .trade-sync-note {
    font-size: 10px; color: rgba(255,255,255,.25); text-align: center;
    margin-top: 6px;
  }
`;

// ── Inject CSS jednou ─────────────────────────────────────────────────────────
function injectStyles() {
  if (document.getElementById('trade-ui-styles')) return;
  const el = document.createElement('style');
  el.id = 'trade-ui-styles';
  el.textContent = BADGE_CSS;
  document.head.appendChild(el);
}

// ── Pomocná: najdi kartu v localStorage podle id ──────────────────────────────
function findCard(cardId) {
  try {
    const cards = JSON.parse(localStorage.getItem('pkc_cards') || '[]');
    return cards.find(c => String(c.id) === String(cardId)) || null;
  } catch { return null; }
}

// ── Přidej badge na slot karty ────────────────────────────────────────────────
function attachBadge(slot) {
  if (slot.querySelector('.trade-ui-badge')) return; // už přidáno
  const cardId = slot.dataset?.cardId;
  if (!cardId) return;

  const card = findCard(cardId);
  if (!card) return;

  if (!card.for_trade && !card.for_sell) return; // nic nezobrazovat

  const wrap = document.createElement('div');
  wrap.className = 'trade-ui-badge';

  if (card.for_trade) {
    const p = document.createElement('span');
    p.className = 'trade-ui-pill trade';
    p.textContent = '🔄 Výměna';
    wrap.appendChild(p);
  }
  if (card.for_sell) {
    const p = document.createElement('span');
    p.className = 'trade-ui-pill sell';
    p.textContent = '💰 Prodej';
    wrap.appendChild(p);
  }
  if (card.for_sell && card.price_czk) {
    const p = document.createElement('span');
    p.className = 'trade-ui-pill price';
    p.textContent = card.price_czk + ' Kč';
    wrap.appendChild(p);
  }

  // Slot musí mít position:relative (css třídy to obvykle mají)
  slot.style.position = 'relative';
  slot.appendChild(wrap);
}

// ── Znovu aplikuj badge na všechny viditelné sloty ────────────────────────────
function refreshAllBadges() {
  document.querySelectorAll('.card-slot.filled[data-card-id]').forEach(attachBadge);
}

// ── MutationObserver pro živý grid ────────────────────────────────────────────
function observeCardGrid() {
  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      if (m.type === 'childList') {
        m.addedNodes.forEach(node => {
          if (node.nodeType !== 1) return;
          // Přímý slot
          if (node.classList?.contains('card-slot') && node.classList.contains('filled')) {
            attachBadge(node);
          }
          // Slots uvnitř přidaného nodu (bulk render)
          node.querySelectorAll?.('.card-slot.filled[data-card-id]').forEach(attachBadge);
        });
      }
      if (m.type === 'attributes' && m.target.classList?.contains('filled')) {
        attachBadge(m.target);
      }
    }
  });

  // Sleduj celý document (gridy bývají v různých containerech)
  observer.observe(document.body, {
    childList: true,
    subtree:   true,
    attributeFilter: ['class'],
  });

  return observer;
}

// ── Detail panel: přidej sekci výměna/prodej ─────────────────────────────────
function buildTradeDetailSection(cardId, card) {
  const section = document.createElement('div');
  section.className = 'trade-detail-section';
  section.id = 'tradeDetailSection';

  let forTrade = card.for_trade || false;
  let forSell  = card.for_sell  || false;
  let priceCzk = card.price_czk || '';

  function render() {
    section.innerHTML = `
      <div class="trade-detail-title">🔄 Výměna / Prodej</div>
      <div class="trade-toggle-row">
        <button class="trade-toggle-btn ${forTrade ? 'active-trade' : ''}" id="tdTradeBtn">
          🔄 K výměně
        </button>
        <button class="trade-toggle-btn ${forSell ? 'active-sell' : ''}" id="tdSellBtn">
          💰 K prodeji
        </button>
      </div>
      <div class="trade-price-row ${forSell ? '' : 'hidden'}">
        <span class="trade-price-label">Cena:</span>
        <input class="trade-price-input" id="tdPriceInput" type="number"
          min="0" step="1" placeholder="Zadej cenu Kč"
          value="${priceCzk}">
        <span class="trade-price-label">Kč</span>
      </div>
      <button class="trade-save-btn" id="tdSaveBtn">
        💾 Uložit a synchronizovat
      </button>
      <div class="trade-sync-note" id="tdSyncNote">
        Sync: ${getSyncMode() === 'realtime' ? 'real-time' : getSyncMode() === 'hourly' ? 'každou hodinu' : 'manuální'}
      </div>
    `;

    // Eventy
    section.querySelector('#tdTradeBtn').onclick = () => {
      forTrade = !forTrade;
      render();
    };
    section.querySelector('#tdSellBtn').onclick = () => {
      forSell = !forSell;
      render();
    };
    const priceInput = section.querySelector('#tdPriceInput');
    if (priceInput) {
      priceInput.onchange = e => { priceCzk = parseInt(e.target.value) || null; };
      priceInput.oninput  = e => { priceCzk = parseInt(e.target.value) || null; };
    }

    const saveBtn = section.querySelector('#tdSaveBtn');
    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = '⏳ Ukládám…';
      try {
        await setTradeStatus(cardId, {
          forTrade,
          forSell,
          priceCzk: forSell ? (priceCzk || null) : null,
        });
        saveBtn.textContent = '✅ Uloženo!';
        saveBtn.classList.add('saved');
        // Obnov badge v gridu
        setTimeout(() => {
          refreshAllBadges();
          // Aktualizuj badge na konkrétním slotu
          const slot = document.querySelector(`.card-slot[data-card-id="${cardId}"]`);
          if (slot) {
            slot.querySelector('.trade-ui-badge')?.remove();
            attachBadge(slot);
          }
        }, 300);
        setTimeout(() => {
          saveBtn.disabled = false;
          saveBtn.textContent = '💾 Uložit a synchronizovat';
          saveBtn.classList.remove('saved');
        }, 2500);
      } catch (err) {
        saveBtn.textContent = '❌ Chyba: ' + err.message;
        saveBtn.disabled = false;
      }
    };
  }

  render();
  return section;
}

// ── Hook do detailu karty ─────────────────────────────────────────────────────
function hookDetailModal() {
  // Karty.js volá openModal('cardDetailModal') nakonec openCardDetail()
  // Sledujeme změnu visibility modálu nebo používáme window event
  const targetId = 'cardDetailModal';

  const attachTradeSection = () => {
    const modal = document.getElementById(targetId);
    if (!modal || modal.style.display === 'none' || modal.classList.contains('hidden')) return;

    // Najdi ID karty – cards.js ji ukládá do state.js jako detailCardId
    // nebo ji přečteme z window
    const cardId = window.__tradeDetailCardId || window.detailCardId;
    if (!cardId) return;

    // Vymaž předchozí sekci
    document.getElementById('tradeDetailSection')?.remove();

    const card = findCard(cardId);
    if (!card) return;

    // Najdi vhodné místo: za edit tlačítko nebo za cdDescBox
    const anchor = document.getElementById('cdDescBox')
      || document.getElementById('cdEditBtn')?.closest('.modal-footer')
      || modal.querySelector('.modal-footer');

    if (anchor) {
      const section = buildTradeDetailSection(cardId, card);
      if (anchor.id === 'cdDescBox') {
        anchor.after(section);
      } else {
        anchor.before(section);
      }
    }
  };

  // MutationObserver na modal
  const modalArea = document.getElementById(targetId) || document.body;
  const obs = new MutationObserver(() => {
    const modal = document.getElementById(targetId);
    if (!modal) return;
    const isOpen = !modal.classList.contains('hidden') && modal.style.display !== 'none';
    if (isOpen && !document.getElementById('tradeDetailSection')) {
      // Krátká prodleva – cards.js potřebuje dokončit render
      setTimeout(attachTradeSection, 80);
    }
  });
  obs.observe(document.body, { childList: true, subtree: true, attributeFilter: ['class', 'style'] });

  // Naslouchej na custom event který vydá cards.js po otevření detailu
  // (nebo zachyť kliknutí na karty a ulož id)
  document.addEventListener('click', e => {
    const slot = e.target.closest('.card-slot.filled[data-card-id]');
    if (slot) {
      window.__tradeDetailCardId = slot.dataset.cardId;
    }
  }, true);

  // Naslouchej na card-trade-changed event
  window.addEventListener('card-trade-changed', () => {
    refreshAllBadges();
  });
}

// ── Veřejné API ───────────────────────────────────────────────────────────────
export function initTradeUI() {
  injectStyles();
  observeCardGrid();
  hookDetailModal();
  // Prvotní sken (karty již mohly být vyrendrované)
  setTimeout(refreshAllBadges, 500);
  setTimeout(refreshAllBadges, 1500);
  console.log('[trade-ui] inicializováno');
}

// Umožni volání i bez ES modulu
window.initTradeUI      = initTradeUI;
window.refreshTradeBadges = refreshAllBadges;
