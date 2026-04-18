/**
 * topbar.js — Jeden soubor vládne celému hornímu panelu PokéTrade
 * ================================================================
 * Obsahuje: navigace, nastavení panel, notifikační zvonek, userChip
 *
 * Jak použít na každé stránce (nic jiného nepotřebuješ):
 *
 *  1) V <head> přidej:
 *       <script>window.TOPBAR_ACTIVE = 'moje-album';</script>
 *       <script src="topbar.js"></script>
 *
 *  2) V HTML místo celého <nav class="nav-lnks">...</nav> dej:
 *       <nav class="nav-lnks" id="mainNav"></nav>
 *
 * Hodnoty TOPBAR_ACTIVE:
 *   'marketplace' | 'moje-album' | 'compare' | 'share' | 'scanner'
 *   'queue' | 'download' | 'transactions'
 *
 * ================================================================
 * PŘIDAT/ODEBRAT záložku: stačí upravit pole PAGES níže.
 * ================================================================
 */
(function () {
'use strict';

/* ══════════════════════════════════════════════════════════════
   1. NAVIGACE — záložky horní lišty
   Přidej/odeber řádek zde a propíše se na všechny stránky.
   ══════════════════════════════════════════════════════════════ */
var PAGES = [
  { href: 'marketplace.html',  icon: 'energi/obchod.png',          label: 'Obchod',            id: 'marketplace' },
  { href: 'moje-album.html',   icon: 'energi/moje alba.png',        label: 'Moje alba',         id: 'moje-album'  },
  { href: 'compare.html',      icon: 'energi/porovnat.png',         label: 'Porovnat alba',     id: 'compare'     },
  { href: 'compare.html?tab=share', icon: 'energi/sdilet.png',      label: 'Sdílet album',      id: 'share'  },
  { href: 'scanner.html',      icon: 'energi/scanner.png',          label: 'Skener',            id: 'scanner'     },
  { href: 'queue.html',        icon: 'energi/ceka_na_zarazeni.png', label: 'Čeká na zařazení',  id: 'queue'       },
  { href: 'download.html',     icon: 'energi/ke_stazeni.png',       label: 'Ke stažení',        id: 'download'    },
];

/* ══════════════════════════════════════════════════════════════
   2. STYLY — navigace + nastavení + notifikace
   ══════════════════════════════════════════════════════════════ */
function injectStyles() {
  if (document.getElementById('topbar-unified-style')) return;
  var s = document.createElement('style');
  s.id = 'topbar-unified-style';
  s.textContent = `
    /* ── Navigační pills ── */
    .nav-lnks a {
      background: rgba(255,255,255,0.06) !important;
      border: 1px solid rgba(255,255,255,0.07) !important;
      border-radius: 8px !important;
      color: var(--text2, rgba(240,236,228,0.65)) !important;
      padding: 5px 13px !important;
      font-size: 13px !important;
      font-weight: 500 !important;
      text-decoration: none !important;
      transition: all .15s !important;
      display: inline-flex !important;
      align-items: center !important;
    }
    .nav-lnks a:hover {
      background: rgba(255,255,255,0.11) !important;
      color: var(--text, #f0ece4) !important;
      border-color: rgba(255,255,255,0.13) !important;
    }
    .nav-lnks a.active {
      background: rgba(245,200,66,0.15) !important;
      color: var(--yellow, #f5c842) !important;
      border-color: rgba(245,200,66,0.25) !important;
    }

    /* ── Nastavení panel ── */
    .settings-drop-wrap { position: relative; }
    .settings-drop {
      display: none; position: absolute; top: calc(100% + 8px); right: 0;
      width: 400px; max-height: 82vh;
      background: rgba(14,12,20,0.97);
      border: 1px solid rgba(255,255,255,0.1); border-radius: 14px;
      backdrop-filter: blur(20px); box-shadow: 0 12px 48px rgba(0,0,0,0.6);
      z-index: 300; overflow: hidden; flex-direction: column;
    }
    .settings-drop.open { display: flex; }
    .settings-drop-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 16px 12px; border-bottom: 1px solid rgba(255,255,255,0.07);
      flex-shrink: 0;
    }
    .settings-drop-title { font-family: "Unbounded", sans-serif; font-size: 13px; font-weight: 800; color: #fff; }
    .settings-drop-body { overflow-y: auto; padding: 8px; flex: 1; }
    .settings-drop-body::-webkit-scrollbar { width: 4px; }
    .settings-drop-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
    .sdrop-acc-item {
      border-radius: 10px; margin-bottom: 4px; overflow: hidden;
      border: 1px solid rgba(255,255,255,0.07);
      background: rgba(255,255,255,0.03);
      transition: border-color .15s;
    }
    .sdrop-acc-item:hover { border-color: rgba(255,255,255,0.13); }
    .sdrop-acc-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 11px 14px; cursor: pointer; user-select: none; gap: 8px;
    }
    .sdrop-acc-left { display: flex; align-items: center; gap: 9px; }
    .sdrop-acc-icon { font-size: 16px; display: inline-flex; align-items: center; justify-content: center; width: 24px; flex-shrink: 0; }
    .sdrop-acc-title { font-size: 13px; font-weight: 600; color: var(--text2, rgba(240,236,228,0.65)); }
    .sdrop-acc-sub { font-size: 11px; color: var(--text3, rgba(240,236,228,0.35)); margin-top: 1px; }
    .sdrop-acc-chevron { font-size: 11px; color: var(--text3, rgba(240,236,228,0.35)); transition: transform .22s cubic-bezier(0.34,1.56,0.64,1); flex-shrink: 0; }
    .sdrop-acc-item.open .sdrop-acc-chevron { transform: rotate(180deg); }
    .sdrop-acc-body { max-height: 0; overflow: hidden; transition: max-height .3s ease; padding: 0 14px; }
    .sdrop-acc-item.open .sdrop-acc-body { max-height: 520px; }
    .sdrop-acc-inner { padding-bottom: 14px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 14px; }
    .acc-label { display: block; font-size: 11px; font-weight: 600; color: var(--text3, rgba(240,236,228,0.35)); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 8px; }
    .acc-sync-select {
      width: 100%; padding: 9px 12px; border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05);
      color: var(--text2, rgba(240,236,228,0.65)); font-family: inherit; font-size: 13px; cursor: pointer;
      appearance: none; -webkit-appearance: none; color-scheme: dark;
    }
    .acc-sync-select option { background: #0e0c14; color: #f0ece4; }
    .acc-last-sync { font-size: 11px; color: var(--text3, rgba(240,236,228,0.35)); margin-top: 7px; }
    .curr-btn {
      flex: 1; padding: 7px 0; border-radius: 8px;
      border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.05);
      color: var(--text2, rgba(240,236,228,0.65)); font-family: inherit; font-size: 12px; cursor: pointer; transition: all .15s;
    }
    .curr-btn:hover { background: rgba(255,255,255,0.1); color: var(--text, #f0ece4); }
    .curr-btn.curr-active { background: rgba(245,200,66,0.18); border-color: rgba(245,200,66,0.45); color: #f5c842; font-weight: 700; }
    .acc-rate-info { font-size: 11px; color: var(--text3, rgba(240,236,228,0.35)); margin-top: 7px; }
    .price-alert-banner {
      display: flex; align-items: flex-start; gap: 10px;
      background: linear-gradient(135deg, rgba(245,200,66,0.07) 0%, rgba(255,140,0,0.05) 100%);
      border: 1px solid rgba(245,200,66,0.18); border-radius: 10px; padding: 12px 14px;
      font-size: 12px; color: var(--text2, rgba(240,236,228,0.65)); line-height: 1.6;
    }
    .price-alert-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
    .price-alert-text strong { color: var(--yellow, #f5c842); display: block; margin-bottom: 3px; font-size: 11.5px; }
    .price-alert-input-row { display: flex; gap: 8px; align-items: center; margin-top: 4px; }
    .price-alert-input-wrap { position: relative; display: flex; align-items: center; flex: 1; max-width: 180px; }
    .price-alert-currency-icon { position: absolute; left: 11px; font-size: 13px; color: var(--yellow, #f5c842); font-weight: 700; pointer-events: none; }
    .price-alert-inp { padding-left: 26px !important; padding-right: 40px !important; }
    .price-alert-unit { position: absolute; right: 11px; font-size: 11px; color: var(--text3, rgba(240,236,228,0.35)); pointer-events: none; }
    .price-alert-presets { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin-top: 10px; }
    .price-alert-preset-label { font-size: 11px; color: var(--text3, rgba(240,236,228,0.35)); }
    .preset-chip {
      background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 20px; padding: 3px 10px; font-size: 11.5px; color: var(--text2, rgba(240,236,228,0.65));
      cursor: pointer; transition: all .15s; font-family: inherit;
    }
    .preset-chip:hover { background: rgba(245,200,66,0.12); border-color: rgba(245,200,66,0.35); color: var(--yellow, #f5c842); }
    .price-alert-feedback { font-size: 12px; min-height: 18px; margin-top: 8px; line-height: 1.5; }
    .price-alert-feedback.ok    { color: #4ade80; }
    .price-alert-feedback.error { color: #f87171; }
    .sp-groq-input {
      flex: 1; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12);
      border-radius: 10px; padding: 10px 14px; font-size: 13px;
      color: var(--text, #f0ece4); outline: none; transition: border-color .2s; width: 100%; box-sizing: border-box;
    }
    .sp-groq-input:focus { border-color: rgba(245,200,66,0.4); }
    .btn-groq-save {
      background: linear-gradient(135deg, var(--yellow, #f5c842) 0%, #ff8c00 100%);
      color: #0a0608; font-weight: 700; font-size: 13px;
      border: none; border-radius: 10px; padding: 10px 20px;
      cursor: pointer; transition: all .2s;
    }
    .btn-groq-save:hover { transform: translateY(-1px); }

    /* ── Notifikační zvonek ── */
    .notif-bell-wrap { position:relative;display:flex;align-items:center;margin-right:4px; }
    .notif-bell-btn { position:relative;cursor:pointer;color:rgba(240,236,228,.75);line-height:1;transition:background .15s,color .15s; }
    .notif-bell-btn:hover { background:rgba(255,255,255,.08);color:#f0ece4; }
    .notif-bell-btn.has-unread { color:#f5c842; }
    .notif-badge { position:absolute;top:1px;right:1px;min-width:16px;height:16px;background:#f5c842;color:#0d0d1a;font-size:10px;font-weight:800;border-radius:99px;display:flex;align-items:center;justify-content:center;padding:0 3px;pointer-events:none; }
    .notif-drop { display:none;position:absolute;top:calc(100% + 8px);right:0;width:320px;background:#1a1a2e;border:1px solid rgba(255,255,255,.12);border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,.55);z-index:500;overflow:hidden; }
    .notif-drop.open { display:block; }
    .notif-drop-head { display:flex;align-items:center;justify-content:space-between;padding:12px 14px 10px;border-bottom:1px solid rgba(255,255,255,.08); }
    .notif-drop-title { font-size:13px;font-weight:700;color:#f0ece4; }
    .notif-read-all-btn { background:none;border:none;cursor:pointer;font-size:11px;color:rgba(245,200,66,.8);font-family:inherit;padding:0; }
    .notif-read-all-btn:hover { color:#f5c842; }
    .notif-drop-list { max-height:320px;overflow-y:auto; }
    .notif-item { display:flex;align-items:flex-start;gap:10px;padding:11px 14px;border-bottom:1px solid rgba(255,255,255,.05);cursor:pointer;transition:background .12s; }
    .notif-item:last-child { border-bottom:none; }
    .notif-item:hover { background:rgba(255,255,255,.04); }
    .notif-item.unread { background:rgba(245,200,66,.05); }
    .notif-item.unread:hover { background:rgba(245,200,66,.09); }
    .notif-dot { width:7px;height:7px;border-radius:50%;background:#f5c842;flex-shrink:0;margin-top:5px; }
    .notif-dot.read { background:transparent;border:1px solid rgba(255,255,255,.15); }
    .notif-body { flex:1;min-width:0; }
    .notif-item-title { font-size:12px;font-weight:600;color:#f0ece4;margin-bottom:2px; }
    .notif-item-body { font-size:11px;color:rgba(240,236,228,.5);line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
    .notif-item-time { font-size:10px;color:rgba(240,236,228,.3);margin-top:3px; }
    .notif-empty { text-align:center;padding:28px 14px;font-size:13px;color:rgba(240,236,228,.35); }
    .notif-drop-footer { border-top:1px solid rgba(255,255,255,.08);padding:9px 14px;text-align:center; }
    .notif-drop-footer a { font-size:12px;color:rgba(245,200,66,.75);text-decoration:none; }
    .notif-drop-footer a:hover { color:#f5c842; }

    /* ── Notifikační přepínače ── */
    .notif-pref-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 9px 0; border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    .notif-pref-row:last-child { border-bottom: none; }
    .notif-pref-label { font-size: 12.5px; color: var(--text2, rgba(240,236,228,0.65)); flex: 1; }
    .notif-pref-sub { font-size: 11px; color: var(--text3, rgba(240,236,228,0.35)); margin-top: 1px; }
    .notif-toggle {
      position: relative; width: 36px; height: 20px; flex-shrink: 0; cursor: pointer;
    }
    .notif-toggle input { opacity: 0; width: 0; height: 0; position: absolute; }
    .notif-toggle-track {
      position: absolute; inset: 0; background: rgba(255,255,255,0.1);
      border-radius: 20px; transition: background .2s;
      border: 1px solid rgba(255,255,255,0.12);
    }
    .notif-toggle input:checked ~ .notif-toggle-track {
      background: rgba(245,200,66,0.35); border-color: rgba(245,200,66,0.5);
    }
    .notif-toggle-thumb {
      position: absolute; top: 2px; left: 2px; width: 14px; height: 14px;
      background: rgba(240,236,228,0.5); border-radius: 50%; transition: all .2s;
    }
    .notif-toggle input:checked ~ .notif-toggle-track .notif-toggle-thumb {
      transform: translateX(16px); background: #f5c842;
    }
    .notif-category-row { display: flex; gap: 6px; margin-top: 8px; margin-bottom: 4px; flex-wrap: wrap; }
    .notif-cat-btn {
      flex: 1; min-width: 60px; padding: 5px 0; border-radius: 7px;
      border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.04);
      color: var(--text2, rgba(240,236,228,0.65)); font-size: 11.5px; cursor: pointer;
      transition: all .15s; font-family: inherit; text-align: center;
    }
    .notif-cat-btn.active {
      background: rgba(245,200,66,0.15); border-color: rgba(245,200,66,0.35); color: #f5c842; font-weight: 700;
    }
    .notif-freq-row { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
    .notif-freq-btn {
      flex: 1; padding: 6px 4px; border-radius: 7px;
      border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.04);
      color: var(--text2, rgba(240,236,228,0.65)); font-size: 11px; cursor: pointer;
      transition: all .15s; font-family: inherit; text-align: center;
    }
    .notif-freq-btn.active {
      background: rgba(245,200,66,0.15); border-color: rgba(245,200,66,0.35); color: #f5c842; font-weight: 700;
    }
    .notif-save-btn {
      width: 100%; margin-top: 12px; padding: 9px; border-radius: 9px;
      background: linear-gradient(135deg, rgba(245,200,66,0.2) 0%, rgba(255,140,0,0.15) 100%);
      border: 1px solid rgba(245,200,66,0.3); color: #f5c842; font-weight: 700; font-size: 12px;
      cursor: pointer; transition: all .15s; font-family: inherit;
    }
    .notif-save-btn:hover { background: linear-gradient(135deg, rgba(245,200,66,0.3) 0%, rgba(255,140,0,0.25) 100%); }
    .notif-save-feedback { font-size: 11px; text-align: center; min-height: 16px; margin-top: 6px; color: #4ade80; }
  `;
  document.head.appendChild(s);
}

/* ══════════════════════════════════════════════════════════════
   3. NAVIGACE — render
   ══════════════════════════════════════════════════════════════ */
function renderNav() {
  var nav = document.getElementById('mainNav');
  if (!nav) return;
  var active    = window.TOPBAR_ACTIVE || '';
  nav.innerHTML = PAGES.map(function (p) {
    var href  = p.href;
    var extra = '';
    var cls   = (p.id === active) ? ' class="active"' : '';
    return '<a href="' + href + '"' + extra + cls + '>'
         + '<img src="' + p.icon + '" class="nav-icon"> '
         + p.label
         + '</a>';
  }).join('');
}

/* ══════════════════════════════════════════════════════════════
   4. NASTAVENÍ PANEL
   ══════════════════════════════════════════════════════════════ */
var SETTINGS_HTML = [
  '<div class="settings-drop-wrap" id="settingsDropWrap">',
  '  <button class="chat-icon-btn" id="settingsBtn" onclick="toggleSettingsDrop()" title="Nastavení">',
  '    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">',
  '      <circle cx="12" cy="12" r="3"/>',
  '      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  '    </svg>',
  '  </button>',
  '  <div class="settings-drop" id="settingsDrop">',
  '    <div class="settings-drop-head"><span class="settings-drop-title">⚙️ Nastavení</span></div>',
  '    <div class="settings-drop-body" id="settingsDropBody">',
  '      <div class="sdrop-acc-item" id="sdAccSync">',
  '        <div class="sdrop-acc-header" onclick="toggleSdAcc(\'sdAccSync\')">',
  '          <div class="sdrop-acc-left"><span class="sdrop-acc-icon">🔄</span>',
  '            <div><div class="sdrop-acc-title">Sync mód</div><div class="sdrop-acc-sub" id="accSyncSub">Každou hodinu</div></div>',
  '          </div><span class="sdrop-acc-chevron">▼</span>',
  '        </div>',
  '        <div class="sdrop-acc-body"><div class="sdrop-acc-inner">',
  '          <label class="acc-label">Frekvence synchronizace alba</label>',
  '          <select class="acc-sync-select" id="profileSyncSelect" onchange="albumSettingsChangeSyncMode(this.value)">',
  '            <option value="hourly">Každou hodinu</option>',
  '            <option value="realtime">Real-time (30s)</option>',
  '            <option value="manual">Manuálně</option>',
  '          </select>',
  '          <div class="acc-last-sync" id="profileLastSyncInfo"></div>',
  '        </div></div>',
  '      </div>',
  '      <div class="sdrop-acc-item" id="sdAccCurrency">',
  '        <div class="sdrop-acc-header" onclick="toggleSdAcc(\'sdAccCurrency\')">',
  '          <div class="sdrop-acc-left"><span class="sdrop-acc-icon">💱</span>',
  '            <div><div class="sdrop-acc-title">Měna</div><div class="sdrop-acc-sub" id="accCurrencySub">EUR</div></div>',
  '          </div><span class="sdrop-acc-chevron">▼</span>',
  '        </div>',
  '        <div class="sdrop-acc-body"><div class="sdrop-acc-inner">',
  '          <label class="acc-label">Zobrazovat ceny v</label>',
  '          <div style="display:flex;gap:8px">',
  '            <button id="profileCurrBtnEUR" class="curr-btn" onclick="albumSettingsSetCurrency(\'EUR\')">€ EUR</button>',
  '            <button id="profileCurrBtnCZK" class="curr-btn" onclick="albumSettingsSetCurrency(\'CZK\')">Kč CZK</button>',
  '          </div>',
  '          <div class="acc-rate-info" id="profileEurRateInfo">Načítám kurz…</div>',
  '        </div></div>',
  '      </div>',
  '      <div class="sdrop-acc-item" id="sdAccLang">',
  '        <div class="sdrop-acc-header" onclick="toggleSdAcc(\'sdAccLang\')">',
  '          <div class="sdrop-acc-left"><span class="sdrop-acc-icon">🌐</span>',
  '            <div><div class="sdrop-acc-title">Jazyk</div><div class="sdrop-acc-sub" id="accLangSub">CZ</div></div>',
  '          </div><span class="sdrop-acc-chevron">▼</span>',
  '        </div>',
  '        <div class="sdrop-acc-body"><div class="sdrop-acc-inner">',
  '          <label class="acc-label">Jazyk rozhraní</label>',
  '          <div style="display:flex;gap:8px">',
  '            <button id="profileLangBtnCZ" class="curr-btn" onclick="albumSettingsSetLang(\'cz\')">🇨🇿 CZ</button>',
  '            <button id="profileLangBtnEN" class="curr-btn" onclick="albumSettingsSetLang(\'en\')">🇬🇧 EN</button>',
  '          </div>',
  '        </div></div>',
  '      </div>',
  '      <div class="sdrop-acc-item" id="sdAccPriceAlert">',
  '        <div class="sdrop-acc-header" onclick="toggleSdAcc(\'sdAccPriceAlert\')">',
  '          <div class="sdrop-acc-left"><span class="sdrop-acc-icon">⭐</span>',
  '            <div><div class="sdrop-acc-title">Upozornění na cenu</div>',
  '            <div class="sdrop-acc-sub">Hranice: <span id="accPriceAlertVal">20</span> EUR</div></div>',
  '          </div><span class="sdrop-acc-chevron">▼</span>',
  '        </div>',
  '        <div class="sdrop-acc-body"><div class="sdrop-acc-inner">',
  '          <div class="price-alert-banner">',
  '            <div class="price-alert-icon">⭐</div>',
  '            <div class="price-alert-text"><strong>Jak to funguje?</strong>Karty s cenou vyšší než hranice budou v albu označeny hvězdičkou ⭐.</div>',
  '          </div>',
  '          <label class="acc-label" style="margin-top:14px">Hranice upozornění</label>',
  '          <div class="price-alert-input-row">',
  '            <div class="price-alert-input-wrap">',
  '              <span class="price-alert-currency-icon">€</span>',
  '              <input id="expThresholdInp" type="number" min="0" step="1" value="20" class="sp-groq-input price-alert-inp" placeholder="20">',
  '              <span class="price-alert-unit">EUR</span>',
  '            </div>',
  '            <button class="btn-groq-save" onclick="albumSaveExpThreshold()">Uložit</button>',
  '          </div>',
  '          <div class="price-alert-presets">',
  '            <span class="price-alert-preset-label">Rychlé:</span>',
  '            <button class="preset-chip" onclick="albumSetThresholdPreset(10)">10 €</button>',
  '            <button class="preset-chip" onclick="albumSetThresholdPreset(20)">20 €</button>',
  '            <button class="preset-chip" onclick="albumSetThresholdPreset(50)">50 €</button>',
  '            <button class="preset-chip" onclick="albumSetThresholdPreset(100)">100 €</button>',
  '          </div>',
  '          <div id="expThresholdFeedback" class="price-alert-feedback"></div>',
  '        </div></div>',
  '      </div>',
  '      <!-- ── 📧 Emailová upozornění ── -->',
  '      <div class="sdrop-acc-item" id="sdAccNotif">',
  '        <div class="sdrop-acc-header" onclick="toggleSdAcc(\'sdAccNotif\')">',
  '          <div class="sdrop-acc-left"><span class="sdrop-acc-icon">📧</span>',
  '            <div><div class="sdrop-acc-title">Emailová upozornění</div>',
  '            <div class="sdrop-acc-sub" id="accNotifSub">Načítám…</div></div>',
  '          </div><span class="sdrop-acc-chevron">▼</span>',
  '        </div>',
  '        <div class="sdrop-acc-body"><div class="sdrop-acc-inner">',
  '          <div class="notif-pref-row">',
  '            <div><div class="notif-pref-label">🛒 Nové nabídky</div>',
  '            <div class="notif-pref-sub">Email při nových kartičkách nebo sealech</div></div>',
  '            <label class="notif-toggle"><input type="checkbox" id="npNewListings" onchange="npSave()">',
  '            <span class="notif-toggle-track"><span class="notif-toggle-thumb"></span></span></label>',
  '          </div>',
  '          <div id="npCategoryWrap" style="padding:4px 0 8px">',
  '            <div style="font-size:11px;color:rgba(240,236,228,0.35);margin-bottom:5px">Kategorie:</div>',
  '            <div class="notif-category-row">',
  '              <button class="notif-cat-btn active" id="npCatAll"    onclick="npSetCat(\'all\')">🃏+📦 Vše</button>',
  '              <button class="notif-cat-btn"        id="npCatCards"  onclick="npSetCat(\'cards\')">🃏 Kartičky</button>',
  '              <button class="notif-cat-btn"        id="npCatSealed" onclick="npSetCat(\'sealed\')">📦 Sealed</button>',
  '            </div>',
  '          </div>',
  '          <div class="notif-pref-row">',
  '            <div><div class="notif-pref-label">⭐ Cenné karty</div>',
  '            <div class="notif-pref-sub">Nabídky nad nastavenou cenovou hranici</div></div>',
  '            <label class="notif-toggle"><input type="checkbox" id="npPriceAlert" onchange="npSave()">',
  '            <span class="notif-toggle-track"><span class="notif-toggle-thumb"></span></span></label>',
  '          </div>',
  '          <div class="notif-pref-row">',
  '            <div><div class="notif-pref-label">🎯 Wishlist k dispozici</div>',
  '            <div class="notif-pref-sub">Karta z wishlistu se objevila na trhu</div></div>',
  '            <label class="notif-toggle"><input type="checkbox" id="npWishlist" onchange="npSave()">',
  '            <span class="notif-toggle-track"><span class="notif-toggle-thumb"></span></span></label>',
  '          </div>',
  '          <div class="notif-pref-row">',
  '            <div><div class="notif-pref-label">🔄 Nabídky k výměně</div>',
  '            <div class="notif-pref-sub">Někdo nabízí kartičku k výměně</div></div>',
  '            <label class="notif-toggle"><input type="checkbox" id="npTrade" onchange="npSave()">',
  '            <span class="notif-toggle-track"><span class="notif-toggle-thumb"></span></span></label>',
  '          </div>',
  '          <div class="notif-pref-row">',
  '            <div><div class="notif-pref-label">📰 Týdenní přehled</div>',
  '            <div class="notif-pref-sub">Souhrn nejlepších nabídek každý týden</div></div>',
  '            <label class="notif-toggle"><input type="checkbox" id="npWeekly" onchange="npSave()">',
  '            <span class="notif-toggle-track"><span class="notif-toggle-thumb"></span></span></label>',
  '          </div>',
  '          <div class="notif-pref-row">',
  '            <div><div class="notif-pref-label">💬 Nové zprávy</div>',
  '            <div class="notif-pref-sub">Email při přijaté zprávě (když nejsi online)</div></div>',
  '            <label class="notif-toggle"><input type="checkbox" id="npMessages" onchange="npSave()">',
  '            <span class="notif-toggle-track"><span class="notif-toggle-thumb"></span></span></label>',
  '          </div>',
  '          <div style="margin-top:12px">',
  '            <div style="font-size:11px;font-weight:600;color:rgba(240,236,228,0.35);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Frekvence emailů</div>',
  '            <div class="notif-freq-row">',
  '              <button class="notif-freq-btn" id="npFreqInstant" onclick="npSetFreq(\'instant\')">⚡ Ihned</button>',
  '              <button class="notif-freq-btn active" id="npFreqDaily" onclick="npSetFreq(\'daily\')">📅 Denně</button>',
  '              <button class="notif-freq-btn" id="npFreqWeekly"  onclick="npSetFreq(\'weekly\')">📆 Týdně</button>',
  '            </div>',
  '          </div>',
  '          <div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06)">',
  '            <div style="font-size:11px;font-weight:600;color:rgba(240,236,228,0.35);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">In-app notifikace (zvoneček)</div>',
  '            <div class="notif-pref-row">',
  '              <div class="notif-pref-label">🔔 Nové nabídky</div>',
  '              <label class="notif-toggle"><input type="checkbox" id="npInAppListings" onchange="npSave()">',
  '              <span class="notif-toggle-track"><span class="notif-toggle-thumb"></span></span></label>',
  '            </div>',
  '            <div class="notif-pref-row">',
  '              <div class="notif-pref-label">🎯 Wishlist</div>',
  '              <label class="notif-toggle"><input type="checkbox" id="npInAppWishlist" onchange="npSave()">',
  '              <span class="notif-toggle-track"><span class="notif-toggle-thumb"></span></span></label>',
  '            </div>',
  '            <div class="notif-pref-row">',
  '              <div class="notif-pref-label">💬 Zprávy</div>',
  '              <label class="notif-toggle"><input type="checkbox" id="npInAppMessages" onchange="npSave()">',
  '              <span class="notif-toggle-track"><span class="notif-toggle-thumb"></span></span></label>',
  '            </div>',
  '          </div>',
  '          <button class="notif-save-btn" onclick="npSaveToServer()">💾 Uložit nastavení upozornění</button>',
  '          <div class="notif-save-feedback" id="npSaveFeedback"></div>',
  '        </div></div>',
  '      </div>',

  '      <div class="sdrop-acc-item">',
  '        <div class="sdrop-acc-header" onclick="window.location.href=\'profile.html\'">',
  '          <div class="sdrop-acc-left"><span class="sdrop-acc-icon">🤖</span>',
  '            <div><div class="sdrop-acc-title">Groq AI</div><div class="sdrop-acc-sub">Nastavit v profilu →</div></div>',
  '          </div><span class="sdrop-acc-chevron" style="opacity:0.5">›</span>',
  '        </div>',
  '      </div>',
  '    </div>',
  '  </div>',
  '</div>',
].join('\n');

function injectSettings() {
  if (document.getElementById('settingsDropWrap')) return; // stránka má vlastní
  var tr = document.querySelector('.topbar-right');
  if (!tr) return;
  var ref = document.getElementById('userChip') || document.getElementById('loginLink');
  var tmp = document.createElement('div');
  tmp.innerHTML = SETTINGS_HTML;
  var node = tmp.firstElementChild;
  if (ref) tr.insertBefore(node, ref);
  else tr.appendChild(node);
}

function initSettingsValues() {
  var savedMode = localStorage.getItem('pkc_album_sync_mode') || 'hourly';
  var sel = document.getElementById('profileSyncSelect');
  if (sel) sel.value = savedMode;
  var labels = { hourly: 'Každou hodinu', realtime: 'Real-time (30s)', manual: 'Manuálně' };
  var sub = document.getElementById('accSyncSub');
  if (sub) sub.textContent = labels[savedMode] || savedMode;
  var lastSync = localStorage.getItem('pkc_last_sync');
  var lastEl = document.getElementById('profileLastSyncInfo');
  if (lastEl && lastSync) {
    try { lastEl.textContent = 'Naposledy: ' + new Date(lastSync).toLocaleTimeString('cs-CZ'); } catch(e) {}
  }
  _spUpdateCurrencyUI();
  _spUpdateLangUI(localStorage.getItem('pkc_lang') || 'cz');
  var savedThreshold = localStorage.getItem('pkc_exp_threshold');
  var threshInp = document.getElementById('expThresholdInp');
  if (threshInp && savedThreshold !== null) threshInp.value = savedThreshold;
  var alertVal = document.getElementById('accPriceAlertVal');
  if (alertVal && savedThreshold) alertVal.textContent = savedThreshold;
}

function _spUpdateCurrencyUI() {
  var cur = localStorage.getItem('pkc_currency') || 'EUR';
  window._pkc_currency = cur;
  var btnEUR = document.getElementById('profileCurrBtnEUR');
  var btnCZK = document.getElementById('profileCurrBtnCZK');
  if (btnEUR) btnEUR.classList.toggle('curr-active', cur === 'EUR');
  if (btnCZK) btnCZK.classList.toggle('curr-active', cur === 'CZK');
  var sub = document.getElementById('accCurrencySub');
  if (sub) sub.textContent = cur === 'CZK' ? 'Kč CZK' : '€ EUR';
  var rateEl = document.getElementById('profileEurRateInfo');
  if (rateEl) {
    if (window._albumEurRate) {
      rateEl.textContent = '1 € = ' + window._albumEurRate.toFixed(2) + ' Kč';
    } else {
      rateEl.textContent = 'Načítám kurz…';
      fetch('https://open.er-api.com/v6/latest/EUR')
        .then(function(r) { return r.json(); })
        .then(function(d) {
          window._albumEurRate = d && d.rates && d.rates.CZK ? d.rates.CZK : null;
          if (rateEl && window._albumEurRate) rateEl.textContent = '1 € = ' + window._albumEurRate.toFixed(2) + ' Kč';
        }).catch(function() { if (rateEl) rateEl.textContent = ''; });
    }
  }
}

function _spUpdateLangUI(lang) {
  var btnCZ = document.getElementById('profileLangBtnCZ');
  var btnEN = document.getElementById('profileLangBtnEN');
  if (btnCZ) btnCZ.classList.toggle('curr-active', lang === 'cz');
  if (btnEN) btnEN.classList.toggle('curr-active', lang === 'en');
  var sub = document.getElementById('accLangSub');
  if (sub) sub.textContent = lang === 'en' ? 'EN' : 'CZ';
}

/* ── Globální funkce pro settings panel ── */
window.toggleSettingsDrop = function () {
  var d = document.getElementById('settingsDrop');
  if (d) d.classList.toggle('open');
};
window.toggleSdAcc = function (id) {
  var item = document.getElementById(id);
  if (!item) return;
  var wasOpen = item.classList.contains('open');
  document.querySelectorAll('.sdrop-acc-item.open').forEach(function(el) { el.classList.remove('open'); });
  if (!wasOpen) item.classList.add('open');
};
window.albumSettingsChangeSyncMode = window.albumSettingsChangeSyncMode || function(mode) {
  localStorage.setItem('pkc_album_sync_mode', mode);
  var labels = { hourly: 'Každou hodinu', realtime: 'Real-time (30s)', manual: 'Manuálně' };
  var sub = document.getElementById('accSyncSub');
  if (sub) sub.textContent = labels[mode] || mode;
  if (typeof changeSyncMode === 'function') changeSyncMode(mode);
};
window.albumSettingsSetCurrency = window.albumSettingsSetCurrency || function(cur) {
  localStorage.setItem('pkc_currency', cur);
  window._pkc_currency = cur;
  _spUpdateCurrencyUI();
};
window.albumSettingsSetLang = window.albumSettingsSetLang || function(lang) {
  localStorage.setItem('pkc_lang', lang);
  _spUpdateLangUI(lang);
  if (typeof setLang === 'function') setLang(lang);
};
window.albumSetThresholdPreset = window.albumSetThresholdPreset || function(val) {
  var inp = document.getElementById('expThresholdInp');
  if (inp) inp.value = val;
};
window.albumSaveExpThreshold = window.albumSaveExpThreshold || function() {
  var inp = document.getElementById('expThresholdInp');
  var fb  = document.getElementById('expThresholdFeedback');
  var val = parseFloat(inp ? inp.value : '');
  if (isNaN(val) || val < 0) {
    if (fb) { fb.textContent = '❌ Zadej platné číslo'; fb.className = 'price-alert-feedback error'; }
    return;
  }
  localStorage.setItem('pkc_exp_threshold', val);
  var alertVal = document.getElementById('accPriceAlertVal');
  if (alertVal) alertVal.textContent = val;
  if (fb) {
    fb.textContent = '✅ Uloženo – karty nad ' + val + ' EUR budou označeny ⭐';
    fb.className = 'price-alert-feedback ok';
    setTimeout(function() { fb.textContent = ''; fb.className = 'price-alert-feedback'; }, 3500);
  }
};

/* Settings zavřít kliknutím mimo */
document.addEventListener('click', function(e) {
  var wrap = document.getElementById('settingsDropWrap');
  if (wrap && !wrap.contains(e.target)) {
    var d = document.getElementById('settingsDrop');
    if (d) d.classList.remove('open');
  }
});

/* ══════════════════════════════════════════════════════════════
   5. NOTIFIKAČNÍ ZVONEK
   Závisí na: app.js (SUPABASE_URL, SUPABASE_ANON)
   ══════════════════════════════════════════════════════════════ */
var _notifOpen = false, _lastNotifCount = 0;

function _getToken()  { return localStorage.getItem('sb_token') || localStorage.getItem('sb_access_token') || null; }
function _getUid()    { return localStorage.getItem('sb_user_id') || (function(){ try { var u=JSON.parse(localStorage.getItem('sb_user')||'null'); return u&&u.id||null; } catch(e){ return null; } })() || null; }
function _getSbUrl()  { return typeof SUPABASE_URL  !== 'undefined' ? SUPABASE_URL  : null; }
function _getSbAnon() { return typeof SUPABASE_ANON !== 'undefined' ? SUPABASE_ANON : null; }
function _sbH(token)  { return { 'apikey': _getSbAnon(), 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }; }

function injectBell() {
  if (!_getToken() || !_getSbUrl() || !_getSbAnon()) return;
  if (document.getElementById('notifBellWrap')) return;
  var tr = document.querySelector('.topbar-right');
  if (!tr) return;
  var wrap = document.createElement('div');
  wrap.className = 'notif-bell-wrap'; wrap.id = 'notifBellWrap';
  wrap.innerHTML = '<button class="notif-bell-btn chat-icon-btn" id="notifBellBtn" title="Notifikace">'
    + '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'
    + '</svg><span class="notif-badge" id="notifBadge" style="display:none">0</span></button>'
    + '<div class="notif-drop" id="notifDrop">'
    + '<div class="notif-drop-head"><span class="notif-drop-title">🔔 Notifikace</span>'
    + '<button class="notif-read-all-btn" id="notifReadAllBtn">Vše přečteno</button></div>'
    + '<div class="notif-drop-list" id="notifDropList"><div class="notif-empty">📭 Žádné notifikace</div></div>'
    + '<div class="notif-drop-footer"><a href="share-album.html">Sdílení alb →</a></div></div>';
  var ref = document.getElementById('chatDropWrap') || document.getElementById('settingsDropWrap') || document.getElementById('userChip');
  if (ref) tr.insertBefore(wrap, ref);
  else tr.prepend(wrap);
  document.getElementById('notifBellBtn').addEventListener('click', _toggleNotif);
  document.getElementById('notifReadAllBtn').addEventListener('click', _markAllRead);
  document.addEventListener('click', function(e) {
    if (_notifOpen && !document.getElementById('notifBellWrap').contains(e.target)) _closeNotif();
  });
  _fetchNotifCount();
  setInterval(_fetchNotifCount, 30000);
}

async function _fetchNotifCount() {
  var t=_getToken(), uid=_getUid(), url=_getSbUrl();
  if (!t||!uid||!url) return;
  try {
    var r = await fetch(url+'/rest/v1/notifications?user_id=eq.'+uid+'&read=eq.false&select=id', { headers: _sbH(t) });
    if (!r.ok) return;
    var d = await r.json();
    _updateNotifBadge(Array.isArray(d) ? d.length : 0);
  } catch(e) {}
}

async function _fetchNotifications() {
  var t=_getToken(), uid=_getUid(), url=_getSbUrl();
  if (!t||!uid||!url) return [];
  try {
    var r = await fetch(url+'/rest/v1/notifications?user_id=eq.'+uid+'&order=created_at.desc&limit=10&select=id,title,body,link,read,created_at', { headers: _sbH(t) });
    if (!r.ok) return [];
    return await r.json() || [];
  } catch { return []; }
}

async function _markRead(id) {
  var t=_getToken(), uid=_getUid(), url=_getSbUrl();
  if (!t||!uid||!url) return;
  try {
    await fetch(url+'/rest/v1/notifications?id=eq.'+id+'&user_id=eq.'+uid,
      { method:'PATCH', headers:{..._sbH(t),'Prefer':'return=minimal'}, body:JSON.stringify({read:true}) });
  } catch {}
}

async function _markAllRead() {
  var t=_getToken(), uid=_getUid(), url=_getSbUrl();
  if (!t||!uid||!url) return;
  try {
    await fetch(url+'/rest/v1/notifications?user_id=eq.'+uid+'&read=eq.false',
      { method:'PATCH', headers:{..._sbH(t),'Prefer':'return=minimal'}, body:JSON.stringify({read:true}) });
    _updateNotifBadge(0);
    _fetchNotifications().then(_renderNotifList);
  } catch {}
}

function _updateNotifBadge(count) {
  _lastNotifCount = count;
  var badge=document.getElementById('notifBadge'), btn=document.getElementById('notifBellBtn');
  if (!badge||!btn) return;
  if (count>0) { badge.style.display='flex'; badge.textContent=count>99?'99+':count; btn.classList.add('has-unread'); }
  else         { badge.style.display='none'; btn.classList.remove('has-unread'); }
}

function _fmtTime(iso) {
  if (!iso) return '';
  var d=new Date(iso), n=new Date(), diff=n-d;
  if (diff<60000) return 'teď';
  if (diff<3600000) return Math.floor(diff/60000)+' min';
  if (d.toDateString()===n.toDateString()) return d.toLocaleTimeString('cs',{hour:'2-digit',minute:'2-digit'});
  var y=new Date(n); y.setDate(y.getDate()-1);
  if (d.toDateString()===y.toDateString()) return 'včera';
  return d.toLocaleDateString('cs',{day:'numeric',month:'numeric'});
}
function _esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function _renderNotifList(items) {
  var list=document.getElementById('notifDropList');
  if (!list) return;
  if (!items||!items.length) { list.innerHTML='<div class="notif-empty">📭 Žádné notifikace</div>'; return; }
  list.innerHTML=items.map(function(n) { return '<div class="notif-item '+(n.read?'':'unread')+'" data-id="'+_esc(n.id)+'" data-href="'+_esc(n.link||'#')+'" onclick="window._notifClick&&window._notifClick(this)">'
    +'<div class="notif-dot '+(n.read?'read':'')+'"></div>'
    +'<div class="notif-body"><div class="notif-item-title">'+_esc(n.title||'Notifikace')+'</div>'
    +'<div class="notif-item-body">'+_esc(n.body||'')+'</div>'
    +'<div class="notif-item-time">'+_fmtTime(n.created_at)+'</div></div></div>'; }).join('');
  window._notifClick = async function(el) {
    var id=el.dataset.id, href=el.dataset.href;
    el.classList.remove('unread'); el.querySelector('.notif-dot').classList.add('read');
    await _markRead(id);
    _updateNotifBadge(Math.max(0,_lastNotifCount-1));
    if (href&&href!=='#') location.href=href;
  };
}

function _toggleNotif() { _notifOpen ? _closeNotif() : _openNotif(); }
function _openNotif() {
  _notifOpen=true; document.getElementById('notifDrop')?.classList.add('open');
  document.getElementById('notifDropList').innerHTML='<div class="notif-empty">⏳ Načítám…</div>';
  _fetchNotifications().then(_renderNotifList);
}
function _closeNotif() { _notifOpen=false; document.getElementById('notifDrop')?.classList.remove('open'); }

/* ══════════════════════════════════════════════════════════════
   6. USERSHIP / LOGIN / LOGOUT
   ══════════════════════════════════════════════════════════════ */
function injectAuthChip() {
  var tr = document.querySelector('.topbar-right');
  if (!tr) return;
  if (!document.getElementById('userChip')) {
    tr.insertAdjacentHTML('beforeend',
      '<a href="profile.html" class="user-chip" id="userChip" style="display:none" title="Můj profil">'
      + '<div class="user-avatar" id="userAvatar">?</div><span id="userName"></span></a>'
      + '<a href="login.html" id="loginLink" class="btn-nav-outline" style="display:none;font-size:13px">Přihlásit se</a>'
      + '<button id="logoutBtn" onclick="if(typeof doLogout===\'function\')doLogout()" class="btn-nav-outline"'
      + ' style="display:none;font-size:13px;background:transparent;color:rgba(240,236,228,0.65);border:1px solid rgba(255,255,255,0.18);font-family:inherit;-webkit-appearance:none;appearance:none;cursor:pointer">'
      + '<img src="energi/odhlasit_se.png" class="nav-icon"> Odhlásit</button>');
  }
}

/* ══════════════════════════════════════════════════════════════
   7. INIT
   ══════════════════════════════════════════════════════════════ */
function init() {
  injectStyles();
  renderNav();
  injectSettings();
  initSettingsValues();
  injectBell();
  injectAuthChip();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

/* ══════════════════════════════════════════════════════════════
   8. NOTIFICATION PREFERENCES
   Ukládá do localStorage (okamžitě) + Supabase profiles (server)
   ══════════════════════════════════════════════════════════════ */
var _npCat  = 'all';
var _npFreq = 'daily';
var _npSaveTimer = null;

var NP_DEFAULTS = {
  email_new_listings: true,
  email_listings_cat: 'all',
  email_price_alert:  true,
  email_wishlist:     false,
  email_trade:        false,
  email_weekly:       false,
  email_messages:     false,
  email_frequency:    'daily',
  inapp_listings:     true,
  inapp_wishlist:     true,
  inapp_messages:     true
};

function npLoad() {
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem('pkc_notif_prefs') || '{}'); } catch(e) {}
  var p = Object.assign({}, NP_DEFAULTS, saved);
  _npCat  = p.email_listings_cat || 'all';
  _npFreq = p.email_frequency    || 'daily';
  function setChk(id, val) { var el = document.getElementById(id); if (el) el.checked = !!val; }
  setChk('npNewListings',   p.email_new_listings);
  setChk('npPriceAlert',    p.email_price_alert);
  setChk('npWishlist',      p.email_wishlist);
  setChk('npTrade',         p.email_trade);
  setChk('npWeekly',        p.email_weekly);
  setChk('npMessages',      p.email_messages);
  setChk('npInAppListings', p.inapp_listings);
  setChk('npInAppWishlist', p.inapp_wishlist);
  setChk('npInAppMessages', p.inapp_messages);
  npSetCat(_npCat, true);
  npSetFreq(_npFreq, true);
  npUpdateSub(p);
}

function npGetPrefs() {
  function chk(id) { var el = document.getElementById(id); return el ? el.checked : false; }
  return {
    email_new_listings: chk('npNewListings'),
    email_listings_cat: _npCat,
    email_price_alert:  chk('npPriceAlert'),
    email_wishlist:     chk('npWishlist'),
    email_trade:        chk('npTrade'),
    email_weekly:       chk('npWeekly'),
    email_messages:     chk('npMessages'),
    email_frequency:    _npFreq,
    inapp_listings:     chk('npInAppListings'),
    inapp_wishlist:     chk('npInAppWishlist'),
    inapp_messages:     chk('npInAppMessages')
  };
}

window.npSave = function () {
  var p = npGetPrefs();
  localStorage.setItem('pkc_notif_prefs', JSON.stringify(p));
  npUpdateSub(p);
  clearTimeout(_npSaveTimer);
  _npSaveTimer = setTimeout(window.npSaveToServer, 1500);
};

window.npSaveToServer = function () {
  var p = npGetPrefs();
  localStorage.setItem('pkc_notif_prefs', JSON.stringify(p));
  npUpdateSub(p);
  var SBU = typeof SUPABASE_URL  !== 'undefined' ? SUPABASE_URL  : '';
  var SBA = typeof SUPABASE_ANON !== 'undefined' ? SUPABASE_ANON : '';
  var tok = localStorage.getItem('sb_token') || localStorage.getItem('sb_access_token');
  var uid = localStorage.getItem('sb_user_id');
  var fb  = document.getElementById('npSaveFeedback');
  if (!tok || !uid || !SBU) {
    if (fb) { fb.textContent = '⚠️ Přihlas se pro uložení na server'; setTimeout(function(){ fb.textContent=''; }, 3000); }
    return;
  }
  if (fb) fb.textContent = '⏳ Ukládám…';
  fetch(SBU + '/rest/v1/profiles?id=eq.' + uid, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'apikey': SBA, 'Authorization': 'Bearer ' + tok, 'Prefer': 'return=minimal' },
    body: JSON.stringify({ notification_prefs: p })
  })
  .then(function(r) {
    if (fb) { fb.textContent = r.ok ? '✅ Uloženo' : '❌ Chyba uložení'; setTimeout(function(){ fb.textContent=''; }, 2500); }
  })
  .catch(function() { if (fb) { fb.textContent = '❌ Chyba sítě'; setTimeout(function(){ fb.textContent=''; }, 2500); } });
};

window.npSetCat = function (cat, silent) {
  _npCat = cat;
  ['all','cards','sealed'].forEach(function(c) {
    var btn = document.getElementById('npCat' + c.charAt(0).toUpperCase() + c.slice(1));
    if (btn) btn.classList.toggle('active', c === cat);
  });
  if (!silent) window.npSave();
};

window.npSetFreq = function (freq, silent) {
  _npFreq = freq;
  ['instant','daily','weekly'].forEach(function(f) {
    var btn = document.getElementById('npFreq' + f.charAt(0).toUpperCase() + f.slice(1));
    if (btn) btn.classList.toggle('active', f === freq);
  });
  if (!silent) window.npSave();
};

function npUpdateSub(p) {
  var sub = document.getElementById('accNotifSub');
  if (!sub) return;
  var active = [];
  if (p.email_new_listings) active.push('nabídky');
  if (p.email_price_alert)  active.push('ceny');
  if (p.email_wishlist)     active.push('wishlist');
  if (p.email_weekly)       active.push('digest');
  sub.textContent = active.length
    ? active.join(', ') + ' · ' + ({instant:'ihned',daily:'denně',weekly:'týdně'}[p.email_frequency]||'denně')
    : 'Vypnuto';
}

/* Načti ze serveru při otevření settings dropdownu */
var _npOrigToggle = window.toggleSettingsDrop;
window.toggleSettingsDrop = function() {
  if (_npOrigToggle) _npOrigToggle();
  var drop = document.getElementById('settingsDrop');
  if (drop && drop.classList.contains('open')) { npLoadFromServer(); }
};

function npLoadFromServer() {
  var SBU = typeof SUPABASE_URL  !== 'undefined' ? SUPABASE_URL  : '';
  var SBA = typeof SUPABASE_ANON !== 'undefined' ? SUPABASE_ANON : '';
  var tok = localStorage.getItem('sb_token') || localStorage.getItem('sb_access_token');
  var uid = localStorage.getItem('sb_user_id');
  if (!tok || !uid || !SBU) return;
  fetch(SBU + '/rest/v1/profiles?id=eq.' + uid + '&select=notification_prefs', {
    headers: { 'apikey': SBA, 'Authorization': 'Bearer ' + tok }
  })
  .then(function(r) { return r.json(); })
  .then(function(d) {
    var row = Array.isArray(d) ? d[0] : null;
    if (row && row.notification_prefs) {
      localStorage.setItem('pkc_notif_prefs', JSON.stringify(row.notification_prefs));
      npLoad();
    }
  }).catch(function(){});
}

/* Exportuj prefs pro použití v jiných souborech */
window.getNotifPrefs = function() {
  try { return JSON.parse(localStorage.getItem('pkc_notif_prefs') || '{}'); } catch(e) { return {}; }
};

})();
