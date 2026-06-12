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
 *   'queue' | 'transactions'
 *
 * ================================================================
 * PŘIDAT/ODEBRAT záložku: stačí upravit pole PAGES níže.
 * ================================================================
 */
(function () {
'use strict';

/* ══════════════════════════════════════════════════════════════
   0. RATE-LIMIT MODAL — auto-inject na každé stránce která načítá
   topbar.js. Modal se aktivuje globálně přes window.showRateLimitModal.
   Pokud už je načtený, neduplikujeme.
   ══════════════════════════════════════════════════════════════ */
if (!window.showRateLimitModal && !document.querySelector('script[src*="rate-limit-modal.js"]')) {
  var _rlmScript = document.createElement('script');
  _rlmScript.src = 'rate-limit-modal.js';
  _rlmScript.defer = true;
  document.head.appendChild(_rlmScript);
}

/* ══════════════════════════════════════════════════════════════
   1. NAVIGACE — záložky horní lišty
   Přidej/odeber řádek zde a propíše se na všechny stránky.
   ══════════════════════════════════════════════════════════════ */
var PAGES = [
  { href: 'marketplace.html',  icon: 'energi/obchod.png',          labelKey: 'nav.marketplace', label: 'Obchod',            id: 'marketplace' },
  { href: 'moje-album.html',   icon: 'energi/moje alba.png',        labelKey: 'nav.myAlbum',     label: 'Moje alba',         id: 'moje-album'  },
  { href: 'compare.html',      icon: 'energi/porovnat.png',         labelKey: 'nav.compare',     label: 'Porovnat alba',     id: 'compare'     },
  { href: 'share-album.html',  icon: 'energi/sdilet.png',           labelKey: 'nav.share',       label: 'Sdílet album',      id: 'share'  },
  { href: 'queue.html',        icon: 'energi/ceka_na_zarazeni.png', labelKey: 'nav.queue',       label: 'Čeká na zařazení',  id: 'queue'       },
  { href: 'deck-builder.html', icon: 'energi/moje alba.png',        labelKey: 'nav.deckBuilder', label: 'Deck Builder',      id: 'deck-builder'},
  { href: 'statistiky.html',   icon: 'energi/porovnat.png',         labelKey: 'nav.stats',       label: 'Statistiky',        id: 'stats'       },
];

/* VIP/Admin emaily — shodné s bulk-scan.html a admin-loyd.html */
var _VIP_EMAILS   = ['adelka.papezova@gmail.com','james.t.kirk1933@gmail.com','lasovlas@seznam.cz','loydtest@gmail.com','pan.spock30@gmail.com','pokecards.app.info@gmail.com','papez.ondrej@gmail.com'];
var _ADMIN_EMAILS = ['papez.ondrej@gmail.com','loydtest@gmail.com','lasovlas@seznam.cz'];

/* Vrátí email přihlášeného uživatele z localStorage (lowercase), nebo '' */
function _getLocalEmail() {
  try {
    // 1) přímý klíč sb_email
    var direct = localStorage.getItem('sb_email');
    if (direct && direct.includes('@')) return direct.toLowerCase();
    // 2) sb_user objekt — email nebo user_metadata.email
    var u = JSON.parse(localStorage.getItem('sb_user') || 'null');
    if (u) {
      var e = u.email || (u.user_metadata && u.user_metadata.email) || '';
      if (e && e.includes('@')) return e.toLowerCase();
    }
    // 3) pkc_online_session (username může být prefix emailu — nelze použít)
    return '';
  } catch(e) { return ''; }
}

/* Sestav finální pole stránek dle role — volá se v renderNav */
function _buildPages() {
  var pages = PAGES.slice();
  var email = _getLocalEmail();
  // Admin: hardcoded seznam NEBO is_admin=true uložené z Supabase profiles
  var isAdminEmail = email && _ADMIN_EMAILS.indexOf(email) !== -1;
  var isAdminDb    = localStorage.getItem('pkc_is_admin') === '1';
  if (isAdminEmail || isAdminDb) {
    pages.push({ href: 'pokedb.html',     icon: 'energi/scanner.png', labelKey: 'nav.pokedb', label: 'PokéDB', id: 'pokedb' });
    pages.push({ href: 'admin-loyd.html', icon: 'energi/obchod.png', label: 'Admin', id: 'admin-loyd' });
  }
  return pages;
}

/* Globálně dostupný helper pro ostatní stránky (pokedb.html, moje-album.html…) */
window._isAdmin = function() {
  try {
    var email = _getLocalEmail();
    if (email && _ADMIN_EMAILS.indexOf(email) !== -1) return true;
    if (localStorage.getItem('pkc_is_admin') === '1') return true;
    // Fallback: sb_user app_metadata
    var u = JSON.parse(localStorage.getItem('sb_user') || 'null');
    return !!(u && (u.app_metadata && u.app_metadata.is_admin));
  } catch(e) { return false; }
};

/* ══════════════════════════════════════════════════════════════
   2. STYLY — navigace + nastavení + notifikace
   ══════════════════════════════════════════════════════════════ */
function injectStyles() {
  if (document.getElementById('topbar-unified-style')) return;
  var s = document.createElement('style');
  s.id = 'topbar-unified-style';
  s.textContent = `
    /* ── Base topbar structure — automaticky na všech stránkách ── */
    .app-topbar {
      position: sticky; top: 0; z-index: 200;
      background: rgba(8,8,12,0.92);
      border-bottom: 1px solid rgba(255,255,255,0.06);
      backdrop-filter: blur(16px);
      display: flex; align-items: center;
      height: 56px; padding: 0 20px; gap: 0;
    }
    .app-logo {
      font-family: 'Unbounded', sans-serif; font-size: 14px; font-weight: 800;
      color: #fff; display: flex; align-items: center; gap: 6px;
      text-decoration: none; margin-right: 28px; white-space: nowrap; flex-shrink: 0;
    }
    .app-logo strong { color: var(--yellow, #f5c842); }
    .topbar-right { display: flex; align-items: center; gap: 10px; margin-left: auto; min-width: 0; flex-shrink: 0; }
    .chat-icon-btn {
      position: relative; display: flex; align-items: center; justify-content: center;
      width: 36px; height: 36px; border-radius: 8px;
      background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08);
      color: var(--text2, rgba(240,236,228,0.65));
      text-decoration: none; transition: all .15s; cursor: pointer; font-family: inherit;
    }
    .chat-icon-btn:hover { background: rgba(255,255,255,0.1); color: var(--text, #f0ece4); border-color: rgba(255,255,255,0.14); }
    .chat-badge {
      position: absolute; top: -5px; right: -5px; min-width: 18px; height: 18px;
      border-radius: 9px; background: #f87171; color: #fff;
      font-size: 10px; font-weight: 800; display: flex; align-items: center;
      justify-content: center; padding: 0 5px; line-height: 1;
      box-shadow: 0 0 0 2px rgba(8,8,12,0.92);
    }
    .user-chip {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 5px 10px 5px 5px; border-radius: 10px;
      background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
      text-decoration: none; color: rgba(240,236,228,0.8);
      font-size: 13px; font-weight: 500; transition: all .15s;
      max-width: 160px; overflow: hidden;
    }
    .user-chip:hover { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.18); }
    .user-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .user-avatar {
      width: 28px; height: 28px; border-radius: 7px; flex-shrink: 0;
      background: var(--yellow, #f5c842); color: #000;
      display: flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: 800;
      background-size: cover; background-position: center;
    }
    .btn-nav-outline {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 5px 12px; border-radius: 9px; font-size: 13px;
      background: transparent; border: 1px solid rgba(255,255,255,0.18);
      color: rgba(240,236,228,0.65); cursor: pointer;
      font-family: inherit; font-weight: 500; text-decoration: none;
      transition: all .15s; white-space: nowrap;
    }
    .btn-nav-outline:hover { background: rgba(255,255,255,0.07); color: rgba(240,236,228,0.9); }

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
    /* ── Ikonky v desktop nav — KRITICKÉ: bez tohoto se energi/*.png zobrazí v plné velikosti ── */
    .nav-lnks img.nav-icon {
      width: 18px !important; height: 18px !important;
      flex-shrink: 0 !important; object-fit: contain !important;
      opacity: 0.8; margin-right: 3px;
    }
    .nav-lnks a.active img.nav-icon { opacity: 1; }
    .btn-nav-outline img.nav-icon {
      width: 18px !important; height: 18px !important;
      flex-shrink: 0 !important; object-fit: contain !important;
      opacity: 0.8;
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

    /* ── Groq AI panel ── */
    .sdrop-acc-item.open .sdrop-acc-body.sdrop-acc-body-groq { max-height: 900px; }
    .sp-pass-btn { width:100%; padding:10px 14px; border-radius:10px; margin-bottom:8px; border:1.5px solid rgba(79,142,247,0.35); background:rgba(79,142,247,0.07); color:#60a5fa; font-family:inherit; font-size:13px; font-weight:700; cursor:pointer; transition:all .15s; text-align:left; display:block; box-sizing:border-box; }
    .sp-pass-btn:hover { background:rgba(79,142,247,0.15); border-color:rgba(79,142,247,0.6); }
    .sp-pass-btn-red { border-color:rgba(248,113,113,0.35); background:rgba(248,113,113,0.07); color:#f87171; }
    .sp-pass-btn-red:hover { background:rgba(248,113,113,0.15); border-color:rgba(248,113,113,0.6); }

    /* ── xAI Preferovat tlačítko ── */
    .xai-prefer-btn {
      width: 100%; padding: 10px 14px; border-radius: 10px; margin-top: 2px; margin-bottom: 4px;
      border: 1.5px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.05);
      color: rgba(240,236,228,0.65); font-family: inherit; font-size: 13px; font-weight: 600;
      cursor: pointer; transition: all .2s; display: flex; align-items: center; justify-content: center; gap: 7px;
      box-sizing: border-box; text-align: center;
    }
    .xai-prefer-btn:hover { background: rgba(245,200,66,0.1); border-color: rgba(245,200,66,0.4); color: #f5c842; }
    .xai-prefer-btn.xai-preferred {
      background: rgba(245,200,66,0.16); border-color: rgba(245,200,66,0.5);
      color: #f5c842; font-weight: 700;
      box-shadow: 0 0 0 1px rgba(245,200,66,0.2);
    }
    .xai-prefer-badge {
      display: inline-block; background: rgba(74,222,128,0.18); border: 1px solid rgba(74,222,128,0.35);
      color: #4ade80; font-size: 10px; font-weight: 700; border-radius: 20px; padding: 1px 7px;
      letter-spacing: 0.04em;
    }
    .sp-pass-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,.78); z-index:9999; align-items:center; justify-content:center; padding:20px; }
    .sp-pass-overlay.open { display:flex; }
    .sp-pass-box { background:rgba(14,12,20,.98); border:1px solid rgba(255,255,255,.12); border-radius:16px; padding:28px 24px; width:100%; max-width:380px; backdrop-filter:blur(20px); box-shadow:0 20px 60px rgba(0,0,0,.7); }
    .sp-pass-title { font-size:15px; font-weight:800; color:#fff; margin-bottom:6px; }
    .sp-pass-sub { font-size:12px; color:rgba(240,236,228,.45); margin-bottom:20px; line-height:1.5; }
    .sp-pass-inp { width:100%; padding:11px 14px; border-radius:10px; box-sizing:border-box; border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.05); color:#f0ece4; font-family:inherit; font-size:13px; outline:none; transition:border-color .2s; margin-bottom:10px; display:block; }
    .sp-pass-inp:focus { border-color:rgba(79,142,247,.5); }
    .sp-pass-save { width:100%; padding:12px; border:none; border-radius:10px; margin-top:4px; background:linear-gradient(135deg,#3b82f6,#1d4ed8); color:#fff; font-family:inherit; font-size:14px; font-weight:700; cursor:pointer; transition:opacity .15s; }
    .sp-pass-save:hover { opacity:.88; }
    .sp-pass-cancel { width:100%; padding:10px; border:1px solid rgba(255,255,255,.1); border-radius:10px; margin-top:8px; background:transparent; color:rgba(240,236,228,.45); font-family:inherit; font-size:13px; cursor:pointer; }
    .sp-pass-cancel:hover { border-color:rgba(255,255,255,.25); color:rgba(240,236,228,.7); }
    .sp-pass-fb { font-size:12px; min-height:16px; margin-top:10px; }
    .sp-pass-fb.ok { color:#4ade80; }
    .sp-pass-fb.err { color:#f87171; }
    .groq-status { display:flex;align-items:center;gap:9px;font-size:13px;color:rgba(240,236,228,.65);margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,.08); }
    .groq-dot { width:9px;height:9px;border-radius:50%;background:rgba(240,236,228,.35);flex-shrink:0;transition:background .3s; }
    .groq-dot.active  { background:#4ade80;box-shadow:0 0 8px rgba(74,222,128,.5); }
    .groq-dot.error   { background:#f87171; }
    .groq-dot.loading { background:#f5c842;animation:groqPulse .8s infinite; }
    @keyframes groqPulse { 0%,100%{opacity:1}50%{opacity:.4} }
    .groq-info-box { background:rgba(116,180,255,.07);border:1px solid rgba(116,180,255,.15);border-radius:10px;padding:12px 14px;font-size:12px;color:rgba(240,236,228,.65);line-height:1.6;margin-bottom:14px; }
    .groq-info-box a { color:#74b4ff;text-decoration:none; }
    .groq-info-box a:hover { text-decoration:underline; }
    .groq-label-sm { display:block;font-size:11px;font-weight:700;color:rgba(240,236,228,.35);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px; }
    .groq-key-row { display:flex;gap:8px;align-items:center;margin-bottom:10px; }
    .groq-inp { flex:1;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:9px 12px;font-size:13px;font-family:monospace;color:#f0ece4;outline:none;transition:border-color .2s;min-width:0; }
    .groq-inp:focus { border-color:rgba(245,200,66,.4); }
    .groq-inp::placeholder { color:rgba(240,236,228,.35); }
    .btn-groq-add { background:linear-gradient(135deg,#f5c842 0%,#ff8c00 100%);color:#0a0608;font-weight:700;font-size:12px;border:none;border-radius:10px;padding:9px 14px;cursor:pointer;white-space:nowrap;transition:all .2s;flex-shrink:0; }
    .btn-groq-add:disabled { opacity:.5;cursor:not-allowed; }
    .btn-groq-del-all { background:transparent;border:1px solid rgba(248,113,113,.3);color:#f87171;font-size:12px;border-radius:10px;padding:8px 12px;cursor:pointer;transition:all .2s;font-family:inherit; }
    .btn-groq-del-all:hover { background:rgba(248,113,113,.08);border-color:rgba(248,113,113,.5); }
    .groq-select-sm { width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:9px 12px;font-size:13px;color:#f0ece4;outline:none;cursor:pointer;appearance:none;-webkit-appearance:none;color-scheme:dark; }
    .groq-select-sm option { background:#0e0c14;color:#f0ece4; }
    .groq-fb { margin-top:10px;font-size:12px;min-height:18px;line-height:1.5; }
    .groq-fb.ok  { color:#4ade80; }
    .groq-fb.err { color:#f87171; }

    /* ══════════════════════════════════════════════════════════
       MOBILNÍ MENU (hamburger)
    ══════════════════════════════════════════════════════════ */
    .mob-menu-btn {
      display: none;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 9px;
      color: rgba(240,236,228,0.8);
      cursor: pointer;
      padding: 7px 10px;
      line-height: 1;
      font-size: 18px;
      transition: background .15s;
      margin-right: 6px;
      flex-shrink: 0;
    }
    .mob-menu-btn:hover { background: rgba(255,255,255,0.12); }

    /* Mobilní drawer — překryv */
    .mob-nav-overlay {
      display: none;
      position: fixed; inset: 0; z-index: 9000;
      background: rgba(0,0,0,0.6);
      backdrop-filter: blur(4px);
    }
    .mob-nav-overlay.open { display: block; }

    /* Mobilní drawer — panel */
    .mob-nav-drawer {
      position: fixed; top: 0; left: 0; bottom: 0;
      width: min(80vw, 280px);
      background: #0e0c14;
      border-right: 1px solid rgba(245,200,66,0.15);
      z-index: 9001;
      transform: translateX(-100%);
      transition: transform .25s cubic-bezier(0.4,0,0.2,1);
      display: flex; flex-direction: column;
      overflow: hidden;
    }
    .mob-nav-overlay.open .mob-nav-drawer {
      transform: translateX(0);
    }
    .mob-nav-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 16px 14px;
      border-bottom: 1px solid rgba(255,255,255,0.07);
      flex-shrink: 0;
    }
    .mob-nav-logo {
      font-family: 'Unbounded', sans-serif; font-size: 13px; font-weight: 800;
      color: #fff; text-decoration: none;
    }
    .mob-nav-logo strong { color: #f5c842; }
    .mob-nav-close {
      background: transparent; border: none;
      color: rgba(240,236,228,0.5); font-size: 20px;
      cursor: pointer; padding: 2px 6px; border-radius: 6px;
      transition: color .15s;
    }
    .mob-nav-close:hover { color: #f0ece4; }
    .mob-nav-links {
      flex: 1; overflow-y: auto; padding: 10px 8px;
    }
    .mob-nav-links a {
      display: flex; align-items: center; gap: 12px;
      padding: 11px 12px; border-radius: 10px;
      color: rgba(240,236,228,0.65); text-decoration: none;
      font-size: 14px; font-weight: 500;
      transition: all .15s; margin-bottom: 2px;
      border: 1px solid transparent;
    }
    .mob-nav-links a:hover {
      background: rgba(255,255,255,0.07);
      color: #f0ece4;
      border-color: rgba(255,255,255,0.08);
    }
    .mob-nav-links a.active {
      background: rgba(245,200,66,0.12);
      color: #f5c842;
      border-color: rgba(245,200,66,0.2);
    }
    .mob-nav-links img.nav-icon { width: 18px; height: 18px; opacity: .75; }
    .mob-nav-links a.active img.nav-icon { opacity: 1; }

    /* ── Tablet landscape 1024px ── */
    @media (max-width: 1024px) {
      .nav-lnks a { padding: 5px 9px !important; font-size: 12px !important; }
      .app-logo { font-size: 13px !important; margin-right: 12px !important; }
      .app-topbar { padding: 0 14px !important; gap: 4px !important; }
      .settings-drop { width: 360px !important; right: 0 !important; }
      .notif-drop { width: 300px !important; right: 0 !important; }
    }
    /* ── Tablet portrait 900px ── */
    @media (max-width: 900px) {
      .nav-lnks a { padding: 5px 8px !important; font-size: 11.5px !important; }
      .app-logo { font-size: 12px !important; margin-right: 8px !important; }
    }
    /* ── Telefon 768px — zobrazit hamburger ── */
    @media (max-width: 768px) {
      .mob-menu-btn { display: flex !important; align-items: center; justify-content: center; }
      .nav-lnks { display: none !important; }
      .app-logo { font-size: 12px !important; margin-right: 4px !important; }
      .app-topbar { padding: 0 12px !important; gap: 6px !important; height: 52px !important; }
      .chat-icon-btn, .notif-bell-btn { padding: 8px !important; min-width: 36px !important; min-height: 36px !important; }
      .notif-drop { width: calc(100vw - 20px) !important; right: -8px !important; }
      .settings-drop { width: calc(100vw - 20px) !important; right: -8px !important; max-height: 80vh !important; }
    }
    /* ── Malý telefon 480px ── */
    @media (max-width: 480px) {
      .app-topbar { padding: 0 10px !important; gap: 4px !important; }
      .app-logo { font-size: 11px !important; }
      .user-chip { padding: 4px 6px !important; }
      #logoutBtn { font-size: 0 !important; padding: 6px 8px !important; min-width: 36px !important; min-height: 36px !important; }
    }
    /* ── Fold složený 320px ── */
    @media (max-width: 320px) {
      .app-topbar { padding: 0 8px !important; gap: 3px !important; height: 48px !important; }
      .app-logo { font-size: 10px !important; gap: 3px !important; }
      .chat-icon-btn, .notif-bell-btn { padding: 5px !important; min-width: 30px !important; min-height: 30px !important; }
      .notif-drop, .settings-drop { width: 100vw !important; right: 0 !important; left: 0 !important; position: fixed !important; top: 48px !important; border-radius: 0 0 14px 14px !important; }
      .mob-menu-btn { padding: 5px 7px !important; }
    }
  `;
  document.head.appendChild(s);
}

/* ══════════════════════════════════════════════════════════════
   3. NAVIGACE — render
   ══════════════════════════════════════════════════════════════ */
function renderNav() {
  var nav = document.getElementById('mainNav');
  if (!nav) return;
  var active = window.TOPBAR_ACTIVE || '';

  /* ── Desktop nav pills ── */
  var pages = _buildPages();
  nav.innerHTML = pages.map(function (p) {
    var cls   = (p.id === active) ? ' class="active"' : '';
    var label = (window.pt && p.labelKey) ? window.pt(p.labelKey, p.label) : p.label;
    return '<a href="' + p.href + '"' + cls + '>'
         + '<img src="' + p.icon + '" class="nav-icon"> '
         + label + '</a>';
  }).join('');

  /* ── Hamburger tlačítko (vkládá se PŘED nav) ── */
  if (!document.getElementById('mobMenuBtn')) {
    var btn = document.createElement('button');
    btn.id = 'mobMenuBtn';
    btn.className = 'mob-menu-btn';
    btn.setAttribute('aria-label', 'Otevřít menu');
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
    btn.onclick = function() { openMobNav(); };
    nav.parentNode.insertBefore(btn, nav);
  }

  /* ── Mobilní drawer overlay ── */
  var _mobLinksHtml = pages.map(function(p) {
    var cls   = (p.id === active) ? ' active' : '';
    var label = (window.pt && p.labelKey) ? window.pt(p.labelKey, p.label) : p.label;
    return '<a href="' + p.href + '" class="' + cls + '">'
         + '<img src="' + p.icon + '" class="nav-icon"> '
         + label + '</a>';
  }).join('');

  var existingOverlay = document.getElementById('mobNavOverlay');
  if (existingOverlay) {
    // Re-render linky při každém volání renderNav (nové stránky pro VIP/admin)
    var lc = existingOverlay.querySelector('.mob-nav-links');
    if (lc) lc.innerHTML = _mobLinksHtml;
  } else {
    var overlay = document.createElement('div');
    overlay.id = 'mobNavOverlay';
    overlay.className = 'mob-nav-overlay';
    overlay.innerHTML =
      '<div class="mob-nav-drawer">'
    +   '<div class="mob-nav-header">'
    +     '<a href="/" class="mob-nav-logo">Poké<strong>Trade</strong></a>'
    +     '<button class="mob-nav-close" onclick="closeMobNav()" aria-label="Zavřít">&#x2715;</button>'
    +   '</div>'
    +   '<div class="mob-nav-links">' + _mobLinksHtml + '</div>'
    + '</div>';
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeMobNav();
    });
    document.body.appendChild(overlay);
  }
}

function openMobNav() {
  var o = document.getElementById('mobNavOverlay');
  if (o) { o.classList.add('open'); document.body.style.overflow = 'hidden'; }
}
function closeMobNav() {
  var o = document.getElementById('mobNavOverlay');
  if (o) { o.classList.remove('open'); document.body.style.overflow = ''; }
}
// Vystavit globálně — inline onclick je volá jako window.*
window.openMobNav  = openMobNav;
window.closeMobNav = closeMobNav;

/* ══════════════════════════════════════════════════════════════
   4. NASTAVENÍ PANEL
   ══════════════════════════════════════════════════════════════ */
var SETTINGS_HTML = [
  '<div class="settings-drop-wrap" id="settingsDropWrap">',
  '  <button class="chat-icon-btn" id="settingsBtn" onclick="location.href=\'nastaveni.html\'" title="Nastavení">',
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
  '          <label class="acc-label" data-i18n="settings.uiLanguage">Jazyk rozhraní</label>',
  '          <div style="display:flex;gap:6px;flex-wrap:wrap">',
  '            <button id="profileLangBtnCZ" class="curr-btn" onclick="albumSettingsSetLang(\'cs\')">🇨🇿 CZ</button>',
  '            <button id="profileLangBtnEN" class="curr-btn" onclick="albumSettingsSetLang(\'en\')">🇬🇧 EN</button>',
  '          </div>',
  '          <label class="acc-label" style="margin-top:10px;font-size:11px;opacity:.6">Připravujeme:</label>',
  '          <div style="display:flex;gap:6px;flex-wrap:wrap;opacity:.4">',
  '            <button class="curr-btn" disabled style="cursor:not-allowed" title="Brzy">🇩🇪 DE</button>',
  '            <button class="curr-btn" disabled style="cursor:not-allowed" title="Brzy">🇯🇵 JP</button>',
  '            <button class="curr-btn" disabled style="cursor:not-allowed" title="Brzy">🇫🇷 FR</button>',
  '            <button class="curr-btn" disabled style="cursor:not-allowed" title="Brzy">🇮🇹 IT</button>',
  '            <button class="curr-btn" disabled style="cursor:not-allowed" title="Brzy">🇪🇸 ES</button>',
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

  '      <div class="sdrop-acc-item" id="sdAccGroq">',
  '        <div class="sdrop-acc-header" onclick="toggleSdAcc(\'sdAccGroq\')">',
  '          <div class="sdrop-acc-left"><span class="sdrop-acc-icon">🤖</span>',
  '            <div><div class="sdrop-acc-title">Groq AI</div><div class="sdrop-acc-sub" id="accGroqSub">Načítám…</div></div>',
  '          </div><span class="sdrop-acc-chevron">▼</span>',
  '        </div>',
  '        <div class="sdrop-acc-body sdrop-acc-body-groq">',
  '          <div class="sdrop-acc-inner">',
  '            <div class="groq-status" id="groqStatus">',
  '              <span class="groq-dot loading" id="groqDot"></span>',
  '              <span id="groqStatusText">Načítám…</span>',
  '            </div>',
  '            <div class="groq-info-box">',
  '              <strong>🔒 Soukromé – jen ty vidíš své klíče</strong><br>',
  '              Klíče jsou uloženy v databázi s Row-Level Security. Můžeš přidat více klíčů',
  '              z různých Groq účtů — při selhání jednoho se automaticky použije záložní.',
  '              <a href="https://console.groq.com/keys" target="_blank" rel="noopener">Získat klíč zdarma →</a>',
  '            </div>',
  '            <label class="groq-label-sm">Groq API klíče</label>',
  '            <div id="groqKeysList" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px"></div>',
  '            <div class="groq-key-row">',
  '              <input type="text" id="groqKeyInput" class="groq-inp" placeholder="gsk_… (vlož nový klíč)" autocomplete="off" spellcheck="false">',
  '              <button class="btn-groq-add" id="groqAddBtn" type="button">+ Přidat</button>',
  '            </div>',
  '            <label class="groq-label-sm" style="margin-top:12px">Model</label>',
  '            <select class="groq-select-sm" id="groqModelSelect">',
  '              <option value="llama-3.3-70b-versatile">Llama 3.3 70B (text)</option>',
  '              <option value="llama-3.1-70b-versatile">Llama 3.1 70B</option>',
  '              <option value="llama-3.1-8b-instant">Llama 3.1 8B (rychlý)</option>',
  '              <option value="mixtral-8x7b-32768">Mixtral 8×7B</option>',
  '              <option value="gemma2-9b-it">Gemma 2 9B</option>',
  '            </select>',
  '            <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">',
  '              <button class="btn-groq-del-all" id="groqDeleteBtn" type="button" style="display:none">🗑 Odebrat vše</button>',
  '              <button class="btn-groq-add" id="groqTestBtn" type="button" style="display:none">⚡ Otestovat</button>',
  '            </div>',
  '            <div class="groq-fb" id="groqFeedback"></div>',
  '            <div id="groqTestResult" style="display:none;margin-top:10px;padding:10px;background:rgba(255,255,255,.04);border-radius:8px;font-size:12px;white-space:pre-wrap;max-height:140px;overflow:auto"></div>',
  '          </div>',
  '        </div>',
  '      </div>',
  '      <!-- Cerebras -->',
  '      <div class="sdrop-acc-item" id="sdAccCerebras">',
  '        <div class="sdrop-acc-header" onclick="toggleSdAcc(\'sdAccCerebras\')">',
  '          <div class="sdrop-acc-left"><span class="sdrop-acc-icon">⚡</span>',
  '            <div><div class="sdrop-acc-title">Cerebras AI</div><div class="sdrop-acc-sub" id="accCerebrasSub">Načítám…</div></div>',
  '          </div><span class="sdrop-acc-chevron">▼</span>',
  '        </div>',
  '        <div class="sdrop-acc-body sdrop-acc-body-groq">',
  '          <div class="sdrop-acc-inner">',
  '            <div class="groq-status" id="cerebrasStatus">',
  '              <span class="groq-dot loading" id="cerebrasDot"></span>',
  '              <span id="cerebrasStatusText">Načítám…</span>',
  '            </div>',
  '            <div class="groq-info-box">',
  '              <strong>⚡ Ultra-rychlý – stejné modely jako Groq</strong><br>',
  '              Cerebras používá Llama 4 Scout (vision) a Llama 3.3 70B (text). Free tier = 1M tokenů/den/klíč — přidej více klíčů z různých účtů pro větší kapacitu. Rotace a fallback stejně jako u Groqu.',
  '              <a href="https://cloud.cerebras.ai" target="_blank" rel="noopener">Získat klíč zdarma →</a>',
  '            </div>',
  '            <label class="groq-label-sm">Cerebras API klíče</label>',
  '            <div id="cerebrasKeysList" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px"></div>',
  '            <div class="groq-key-row">',
  '              <input type="text" id="cerebrasKeyInput" class="groq-inp" placeholder="csk-… (vlož nový klíč)" autocomplete="off" spellcheck="false">',
  '              <button class="btn-groq-add" id="cerebrasAddBtn" type="button">+ Přidat</button>',
  '            </div>',
  '            <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">',
  '              <button class="btn-groq-del-all" id="cerebrasDeleteBtn" type="button" style="display:none">🗑 Odebrat vše</button>',
  '              <button class="btn-groq-add" id="cerebrasTestBtn" type="button" style="display:none">⚡ Otestovat</button>',
  '            </div>',
  '            <div class="groq-fb" id="cerebrasFeedback"></div>',
  '            <div id="cerebrasTestResult" style="display:none;margin-top:10px;padding:10px;background:rgba(255,255,255,.04);border-radius:8px;font-size:12px;white-space:pre-wrap;max-height:140px;overflow:auto"></div>',
  '          </div>',
  '        </div>',
  '      </div>',
  '      <!-- OpenRouter -->',
  '      <div class="sdrop-acc-item" id="sdAccOpenRouter">',
  '        <div class="sdrop-acc-header" onclick="toggleSdAcc(\'sdAccOpenRouter\')">',
  '          <div class="sdrop-acc-left"><span class="sdrop-acc-icon">🌐</span>',
  '            <div><div class="sdrop-acc-title">OpenRouter AI</div><div class="sdrop-acc-sub" id="accOpenRouterSub">Načítám…</div></div>',
  '          </div><span class="sdrop-acc-chevron">▼</span>',
  '        </div>',
  '        <div class="sdrop-acc-body sdrop-acc-body-groq">',
  '          <div class="sdrop-acc-inner">',
  '            <div class="groq-status" id="openrouterStatus">',
  '              <span class="groq-dot loading" id="openrouterDot"></span>',
  '              <span id="openrouterStatusText">Načítám…</span>',
  '            </div>',
  '            <div class="groq-info-box">',
  '              <strong>🌐 Nejlepší pro asijské karty (JP/ZH)</strong><br>',
  '              OpenRouter dává přístup ke Qwen 2.5-VL 32B (nativní čínský vision model) — výrazně přesnější na JP/ZH znaky než Llama. Free tier = 200 req/den/klíč/model. Pro JP/ZH karty se automaticky preferuje před Groqem.',
  '              <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">Získat klíč zdarma →</a>',
  '            </div>',
  '            <label class="groq-label-sm">OpenRouter API klíče</label>',
  '            <div id="openrouterKeysList" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px"></div>',
  '            <div class="groq-key-row">',
  '              <input type="text" id="openrouterKeyInput" class="groq-inp" placeholder="sk-or-v1-… (vlož nový klíč)" autocomplete="off" spellcheck="false">',
  '              <button class="btn-groq-add" id="openrouterAddBtn" type="button">+ Přidat</button>',
  '            </div>',
  '            <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">',
  '              <button class="btn-groq-del-all" id="openrouterDeleteBtn" type="button" style="display:none">🗑 Odebrat vše</button>',
  '              <button class="btn-groq-add" id="openrouterTestBtn" type="button" style="display:none">⚡ Otestovat</button>',
  '            </div>',
  '            <div class="groq-fb" id="openrouterFeedback"></div>',
  '            <div id="openrouterTestResult" style="display:none;margin-top:10px;padding:10px;background:rgba(255,255,255,.04);border-radius:8px;font-size:12px;white-space:pre-wrap;max-height:140px;overflow:auto"></div>',
  '          </div>',
  '        </div>',
  '      </div>',
  '      <!-- Mistral -->',
  '      <div class="sdrop-acc-item" id="sdAccMistral">',
  '        <div class="sdrop-acc-header" onclick="toggleSdAcc(\'sdAccMistral\')">',
  '          <div class="sdrop-acc-left"><span class="sdrop-acc-icon">🇫🇷</span>',
  '            <div><div class="sdrop-acc-title">Mistral AI</div><div class="sdrop-acc-sub" id="accMistralSub">Načítám…</div></div>',
  '          </div><span class="sdrop-acc-chevron">▼</span>',
  '        </div>',
  '        <div class="sdrop-acc-body sdrop-acc-body-groq">',
  '          <div class="sdrop-acc-inner">',
  '            <div class="groq-status" id="mistralStatus">',
  '              <span class="groq-dot loading" id="mistralDot"></span>',
  '              <span id="mistralStatusText">Načítám…</span>',
  '            </div>',
  '            <div class="groq-info-box">',
  '              <strong>🇫🇷 Mistral OCR — nejlepší na JP/ZH/KO znaky</strong><br>',
  '              Mistral OCR 3 a Pixtral 12B čtou CJK znaky výrazně přesněji než Llama. Free tier = 1 miliarda tokenů/měsíc, jen ověření telefonem (žádná kreditka). Použije se primárně pro asijské karty.',
  '              <a href="https://console.mistral.ai" target="_blank" rel="noopener">Získat klíč zdarma →</a>',
  '            </div>',
  '            <label class="groq-label-sm">Mistral API klíče</label>',
  '            <div id="mistralKeysList" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px"></div>',
  '            <div class="groq-key-row">',
  '              <input type="text" id="mistralKeyInput" class="groq-inp" placeholder="… (vlož nový klíč)" autocomplete="off" spellcheck="false">',
  '              <button class="btn-groq-add" id="mistralAddBtn" type="button">+ Přidat</button>',
  '            </div>',
  '            <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">',
  '              <button class="btn-groq-del-all" id="mistralDeleteBtn" type="button" style="display:none">🗑 Odebrat vše</button>',
  '              <button class="btn-groq-add" id="mistralTestBtn" type="button" style="display:none">⚡ Otestovat</button>',
  '            </div>',
  '            <div class="groq-fb" id="mistralFeedback"></div>',
  '            <div id="mistralTestResult" style="display:none;margin-top:10px;padding:10px;background:rgba(255,255,255,.04);border-radius:8px;font-size:12px;white-space:pre-wrap;max-height:140px;overflow:auto"></div>',
  '          </div>',
  '        </div>',
  '      </div>',
  '      <!-- xAI Grok -->',
  '      <div class="sdrop-acc-item" id="sdAccXai">',
  '        <div class="sdrop-acc-header" onclick="toggleSdAcc(\'sdAccXai\')">',
  '          <div class="sdrop-acc-left"><span class="sdrop-acc-icon">🔮</span>',
  '            <div><div class="sdrop-acc-title">xAI Grok</div><div class="sdrop-acc-sub" id="accXaiSub">Načítám…</div></div>',
  '          </div><span class="sdrop-acc-chevron">▼</span>',
  '        </div>',
  '        <div class="sdrop-acc-body sdrop-acc-body-groq">',
  '          <div class="sdrop-acc-inner">',
  '            <div class="groq-status" id="xaiStatus">',
  '              <span class="groq-dot loading" id="xaiDot"></span>',
  '              <span id="xaiStatusText">Načítám…</span>',
  '            </div>',
  '            <div class="groq-info-box">',
  '              <strong>💡 xAI Grok — pro budoucí chat funkce</strong><br>',
  '              Grok-2-vision je horší než Llama 4 Scout pro rozpoznávání Pokémon karet a Grok 4 Vision je drahý. Pro karty doporučujeme Cerebras / Groq / Mistral (vše zdarma) — xAI klíč si zde můžeš nechat pro <strong>chat funkce</strong> co teprve plánujeme. Máš $150/měs free credits přes <em>data sharing program</em> v xAI konzoli.',
  '              <a href="https://console.x.ai" target="_blank" rel="noopener">Spravovat klíče →</a>',
  '            </div>',
  '            <label class="groq-label-sm" style="margin-top:10px">xAI API klíče</label>',
  '            <div id="xaiKeysList" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px"></div>',
  '            <div class="groq-key-row">',
  '              <input type="text" id="xaiKeyInput" class="groq-inp" placeholder="xai-… (vlož nový klíč)" autocomplete="off" spellcheck="false">',
  '              <button class="btn-groq-add" id="xaiAddBtn" type="button">+ Přidat</button>',
  '            </div>',
  '            <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">',
  '              <button class="btn-groq-del-all" id="xaiDeleteBtn" type="button" style="display:none">🗑 Odebrat vše</button>',
  '              <button class="btn-groq-add" id="xaiTestBtn" type="button" style="display:none">⚡ Otestovat</button>',
  '            </div>',
  '            <div class="groq-fb" id="xaiFeedback"></div>',
  '            <div id="xaiTestResult" style="display:none;margin-top:10px;padding:10px;background:rgba(255,255,255,.04);border-radius:8px;font-size:12px;white-space:pre-wrap;max-height:140px;overflow:auto"></div>',
  '          </div>',
  '        </div>',
  '      </div>',
  '      <!-- Google Gemini -->',
  '      <div class="sdrop-acc-item" id="sdAccGemini">',
  '        <div class="sdrop-acc-header" onclick="toggleSdAcc(\'sdAccGemini\')">',
  '          <div class="sdrop-acc-left"><span class="sdrop-acc-icon">♊</span>',
  '            <div><div class="sdrop-acc-title">Google Gemini</div><div class="sdrop-acc-sub" id="accGeminiSub">Načítám…</div></div>',
  '          </div><span class="sdrop-acc-chevron">▼</span>',
  '        </div>',
  '        <div class="sdrop-acc-body sdrop-acc-body-groq">',
  '          <div class="sdrop-acc-inner">',
  '            <div class="groq-status" id="geminiStatus">',
  '              <span class="groq-dot loading" id="geminiDot"></span>',
  '              <span id="geminiStatusText">Načítám…</span>',
  '            </div>',
  '            <div class="groq-info-box">',
  '              <strong>♊ Gemini 1.5 Flash — nativní multimodální vision zdarma</strong><br>',
  '              Jeden klíč zvládne text i obrázky (karty). Free tier: 15 req/min, 100 req/den, 2 obrázky/min — žádná platební karta. Tlačítko Preferovat zařadí Gemini jako první provider.',
  '              <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">Získat klíč zdarma →</a>',
  '            </div>',
  '            <button class="xai-prefer-btn" id="geminiPreferBtn" type="button" onclick="geminiTogglePrefer()">☆ Preferovat — použít jako první</button>',
  '            <label class="groq-label-sm" style="margin-top:10px">Gemini API klíče</label>',
  '            <div id="geminiKeysList" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px"></div>',
  '            <div class="groq-key-row">',
  '              <input type="text" id="geminiKeyInput" class="groq-inp" placeholder="AIza… (vlož nový klíč)" autocomplete="off" spellcheck="false">',
  '              <button class="btn-groq-add" id="geminiAddBtn" type="button">+ Přidat</button>',
  '            </div>',
  '            <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">',
  '              <button class="btn-groq-del-all" id="geminiDeleteBtn" type="button" style="display:none">🗑 Odebrat vše</button>',
  '              <button class="btn-groq-add" id="geminiTestBtn" type="button" style="display:none">⚡ Otestovat</button>',
  '            </div>',
  '            <div class="groq-fb" id="geminiFeedback"></div>',
  '            <div id="geminiTestResult" style="display:none;margin-top:10px;padding:10px;background:rgba(255,255,255,.04);border-radius:8px;font-size:12px;white-space:pre-wrap;max-height:140px;overflow:auto"></div>',
  '          </div>',
  '        </div>',
  '      </div>',
  '      <!-- Cloudflare Workers AI -->',
  '      <div class="sdrop-acc-item" id="sdAccCloudflare">',
  '        <div class="sdrop-acc-header" onclick="toggleSdAcc(\'sdAccCloudflare\')">',
  '          <div class="sdrop-acc-left"><span class="sdrop-acc-icon">☁️</span>',
  '            <div><div class="sdrop-acc-title">Cloudflare Workers AI</div><div class="sdrop-acc-sub" id="accCloudflareSub">Načítám…</div></div>',
  '          </div><span class="sdrop-acc-chevron">▼</span>',
  '        </div>',
  '        <div class="sdrop-acc-body sdrop-acc-body-groq">',
  '          <div class="sdrop-acc-inner">',
  '            <div class="groq-status" id="cloudflareStatus">',
  '              <span class="groq-dot loading" id="cloudflareDot"></span>',
  '              <span id="cloudflareStatusText">Načítám…</span>',
  '            </div>',
  '            <div class="groq-info-box">',
  '              <strong>☁️ Cloudflare Llama 3.2 11B Vision — 10 000 Neuronů/den zdarma</strong><br>',
  '              Žádná kreditka. ~1000+ scanů karet denně. Vyžaduje <strong>Account ID + API Token</strong> (oba najdeš v Cloudflare dashboard).<br>',
  '              <strong>Formát klíče:</strong> <code style="background:rgba(0,0,0,.4);padding:1px 5px;border-radius:3px;font-size:11px">account_id:token</code><br>',
  '              <strong>Důležité:</strong> Při prvním použití Llama Vision modelu Cloudflare vyžaduje souhlas s <a href="https://www.llama.com/llama3/license/" target="_blank" rel="noopener">Meta License</a> — potvrď v Cloudflare dashboardu.',
  '              <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener" style="display:block;margin-top:6px">Vytvořit API Token →</a>',
  '            </div>',
  '            <label class="groq-label-sm" style="margin-top:10px">Cloudflare klíče</label>',
  '            <div id="cloudflareKeysList" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px"></div>',
  '            <div class="groq-key-row">',
  '              <input type="text" id="cloudflareKeyInput" class="groq-inp" placeholder="account_id:token (oba spojené dvojtečkou)" autocomplete="off" spellcheck="false">',
  '              <button class="btn-groq-add" id="cloudflareAddBtn" type="button">+ Přidat</button>',
  '            </div>',
  '            <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">',
  '              <button class="btn-groq-del-all" id="cloudflareDeleteBtn" type="button" style="display:none">🗑 Odebrat vše</button>',
  '              <button class="btn-groq-add" id="cloudflareTestBtn" type="button" style="display:none">⚡ Otestovat</button>',
  '            </div>',
  '            <div class="groq-fb" id="cloudflareFeedback"></div>',
  '            <div id="cloudflareTestResult" style="display:none;margin-top:10px;padding:10px;background:rgba(255,255,255,.04);border-radius:8px;font-size:12px;white-space:pre-wrap;max-height:140px;overflow:auto"></div>',
  '          </div>',
  '        </div>',
  '      </div>',
  '      <!-- Účet -->',
  '      <div class="sdrop-acc-item" id="sdAccAccount">',
  '        <div class="sdrop-acc-header" onclick="toggleSdAcc(\'sdAccAccount\')">',
  '          <div class="sdrop-acc-left"><span class="sdrop-acc-icon">👤</span>',
  '            <div><div class="sdrop-acc-title">Účet</div><div class="sdrop-acc-sub">Heslo a přihlášení</div></div>',
  '          </div><span class="sdrop-acc-chevron">▼</span>',
  '        </div>',
  '        <div class="sdrop-acc-body"><div class="sdrop-acc-inner">',
  '          <button class="sp-pass-btn" onclick="spOpenChangePass()">🔑 Změnit heslo</button>',
  '          <button class="sp-pass-btn sp-pass-btn-red" onclick="spOpenForgotPass()">📧 Zapomenuté heslo</button>',
  '        </div></div>',
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
  // Použij i18n.js storage key (pt_lang) jako primární zdroj
  _spUpdateLangUI((window.getLang && window.getLang()) || localStorage.getItem('pt_lang') || localStorage.getItem('pkc_lang') || 'cs');
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
  // Normalizuj kód
  if (lang === 'cz') lang = 'cs';
  // Přečti aktuální jazyk z i18n.js (zdroj pravdy)
  var current = (window.getLang && window.getLang()) || lang || localStorage.getItem('pt_lang') || 'cs';
  var btnCZ = document.getElementById('profileLangBtnCZ');
  var btnEN = document.getElementById('profileLangBtnEN');
  if (btnCZ) btnCZ.classList.toggle('curr-active', current === 'cs');
  if (btnEN) btnEN.classList.toggle('curr-active', current === 'en');
  var sub = document.getElementById('accLangSub');
  if (sub) sub.textContent = current === 'en' ? 'EN' : 'CZ';
}

/* ── Globální funkce pro settings panel ── */
window.toggleSettingsDrop = function () {
  var d = document.getElementById('settingsDrop');
  if (!d) return;
  var willOpen = !d.classList.contains('open');
  d.classList.toggle('open');

  // Při otevření refresh klíčů všech AI providerů — řeší race condition kdy se
  // topbar inicializuje DŘÍV než dorazí Supabase session response. Bez tohoto
  // by uživatel viděl prázdný panel "Přidej první klíč" dokud nedá Ctrl+Shift+R.
  // Refresh běží na pozadí, neblokuje otevření dropdownu.
  if (willOpen) {
    var providers = ['groq', 'cerebras', 'openrouter', 'mistral', 'xai', 'gemini', 'cloudflare'];
    providers.forEach(function(p) {
      var fn = window['_' + p + 'Reload'];
      if (typeof fn === 'function') {
        try { fn(); } catch(e) { console.warn('[settings reload ' + p + ']', e); }
      }
    });
  }
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
  // Normalizuj kód: starý kód používal 'cz' ale i18n.js používá 'cs' (ISO 639-1)
  if (lang === 'cz') lang = 'cs';
  localStorage.setItem('pkc_lang', lang);
  _spUpdateLangUI(lang);
  // Volá globální setLang z i18n.js, který trvale uloží volbu a reloadne stránku
  if (typeof setLang === 'function') setLang(lang);
  else if (typeof window.setLang === 'function') window.setLang(lang);
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
    + '</div>';
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
function injectLangSwitch() {
  var tr = document.querySelector('.topbar-right');
  if (!tr || document.getElementById('langSwitchWrap')) return;

  var wrap = document.createElement('div');
  wrap.id = 'langSwitchWrap';
  wrap.style.cssText = 'position:relative;display:flex;align-items:center;';

  var btn = document.createElement('button');
  btn.id = 'langSwitchBtn';
  btn.className = 'chat-icon-btn';
  btn.title = 'Language / Jazyk';
  btn.style.cssText = 'font-size:15px;padding:5px 8px;letter-spacing:.5px;';
  btn.onclick = function(e) { e.stopPropagation(); _toggleLangDrop(); };

  var drop = document.createElement('div');
  drop.id = 'langDrop';
  drop.style.cssText = 'display:none;position:absolute;top:calc(100% + 8px);right:0;'
    + 'background:#1a1a2e;border:1px solid rgba(255,255,255,.12);border-radius:12px;'
    + 'box-shadow:0 8px 32px rgba(0,0,0,.55);z-index:600;overflow:hidden;min-width:130px;';

  var langs = [
    { code: 'cs', label: '🇨🇿 Čeština' },
    { code: 'en', label: '🇬🇧 English'  },
    { code: 'de', label: '🇩🇪 Deutsch'  },
    { code: 'jp', label: '🇯🇵 日本語'   },
    { code: 'fr', label: '🇫🇷 Français' },
    { code: 'it', label: '🇮🇹 Italiano' },
    { code: 'es', label: '🇪🇸 Español'  }
  ];

  drop.innerHTML = langs.map(function(l) {
    return '<button onclick="window.setLang&&window.setLang(\'' + l.code + '\');_closeLangDrop()" '
      + 'id="langOpt_' + l.code + '" '
      + 'style="display:block;width:100%;padding:10px 14px;background:none;border:none;'
      + 'color:rgba(240,236,228,.75);font-size:13px;font-family:inherit;cursor:pointer;'
      + 'text-align:left;transition:background .12s;" '
      + 'onmouseover="this.style.background=\'rgba(255,255,255,.07)\'" '
      + 'onmouseout="this.style.background=\'none\'">'
      + l.label + '</button>';
  }).join('');

  wrap.appendChild(btn);
  wrap.appendChild(drop);
  tr.insertBefore(wrap, tr.firstChild);

  _updateLangBtn();

  document.addEventListener('click', function(e) {
    if (!wrap.contains(e.target)) _closeLangDrop();
  });
}

function _getLangFlag() {
  var lang = (window.getLang && window.getLang()) || localStorage.getItem('pt_lang') || 'cs';
  var flags = { cs:'🇨🇿', en:'🇬🇧', de:'🇩🇪', jp:'🇯🇵', fr:'🇫🇷', it:'🇮🇹', es:'🇪🇸' };
  return flags[lang] || '🌐';
}

function _updateLangBtn() {
  var btn = document.getElementById('langSwitchBtn');
  if (btn) btn.textContent = _getLangFlag();
  var lang = (window.getLang && window.getLang()) || localStorage.getItem('pt_lang') || 'cs';
  ['cs','en','de','jp','fr','it','es'].forEach(function(c) {
    var el = document.getElementById('langOpt_' + c);
    if (el) el.style.color = (c === lang) ? '#f5c842' : 'rgba(240,236,228,.75)';
  });
}

function _toggleLangDrop() {
  var d = document.getElementById('langDrop');
  if (!d) return;
  d.style.display = d.style.display === 'none' ? 'block' : 'none';
}

function _closeLangDrop() {
  var d = document.getElementById('langDrop');
  if (d) d.style.display = 'none';
}
// Vystavit globálně — inline onclick atributy v HTML je potřebují jako window.*
window._closeLangDrop  = _closeLangDrop;
window._toggleLangDrop = _toggleLangDrop;

// Reagovat na změnu jazyka
document.addEventListener('i18n:changed', function() { _updateLangBtn(); renderNav(); });
document.addEventListener('i18n:ready',   function() { _updateLangBtn(); renderNav(); });

/* ══════════════════════════════════════════════════════════════
   UNIVERSAL USER CHIP INIT — funguje na všech stránkách
   ══════════════════════════════════════════════════════════════ */
function _initUserChip() {
  var chip      = document.getElementById('userChip');
  var nameEl    = document.getElementById('userName');
  var avatarEl  = document.getElementById('userAvatar');
  var loginLink = document.getElementById('loginLink');
  var logoutBtn = document.getElementById('logoutBtn');
  if (!chip && !avatarEl) return;

  var token = localStorage.getItem('sb_token') || localStorage.getItem('sb_access_token') || null;
  var userObj = null;
  try { userObj = JSON.parse(localStorage.getItem('sb_user') || 'null'); } catch(e) {}
  var uid = localStorage.getItem('sb_user_id') || (userObj && userObj.id) || null;

  if (!token || !uid) {
    if (chip)      chip.style.display      = 'none';
    if (loginLink) loginLink.style.display = '';
    if (logoutBtn) logoutBtn.style.display = 'none';
    return;
  }

  if (chip)      chip.style.display      = '';
  if (loginLink) loginLink.style.display = 'none';
  if (logoutBtn) logoutBtn.style.display = '';

  // Ulož email do sb_email pro _getLocalEmail() — záloha pro _buildPages()
  var _confirmedEmail = (userObj && (userObj.email || (userObj.user_metadata && userObj.user_metadata.email))) || '';
  if (_confirmedEmail && !localStorage.getItem('sb_email')) {
    try { localStorage.setItem('sb_email', _confirmedEmail); } catch(e) {}
    // Re-renderuj nav — poprvé mohl být rendernut bez emailu
    try { renderNav(); } catch(e) {}
  }

  var uname = (userObj && ((userObj.user_metadata && userObj.user_metadata.username) || userObj.email))
              || localStorage.getItem('sb_username') || uid.slice(0, 6);
  if (nameEl)   nameEl.textContent   = uname;
  if (avatarEl) avatarEl.textContent = (uname[0] || '?').toUpperCase();

  // Okamžitě z cache
  var cached = null;
  try { cached = localStorage.getItem('pkc_avatar_local'); } catch(e) {}
  if (cached && avatarEl) {
    avatarEl.textContent = '';
    avatarEl.style.backgroundImage    = 'url(' + cached + ')';
    avatarEl.style.backgroundSize     = 'cover';
    avatarEl.style.backgroundPosition = 'center';
  }

  // Čerstvá data ze Supabase (async, potichu)
  (function() {
    var SBU = (typeof SUPABASE_URL  !== 'undefined' ? SUPABASE_URL  : '') || 'https://xrduqwrinzvmpixgmqta.supabase.co';
    var SBA = (typeof SUPABASE_ANON !== 'undefined' ? SUPABASE_ANON : '') || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyZHVxd3Jpbnp2bXBpeGdtcXRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDI0MjksImV4cCI6MjA5MDk3ODQyOX0.2p404Vy77CH_MsvQlnpxaO0H-KlSSt_oJlaFrmttFXs';
    if (!SBU || !SBA) return;
    fetch(SBU + '/rest/v1/profiles?id=eq.' + uid + '&select=username,avatar_url,is_admin', {
      headers: { 'apikey': SBA, 'Authorization': 'Bearer ' + token }
    })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(d) {
      if (!d || !d[0]) return;
      var p = d[0];
      if (p.username) {
        if (nameEl)   nameEl.textContent = p.username;
        if (avatarEl && !cached) avatarEl.textContent = (p.username[0] || '?').toUpperCase();
        try { localStorage.setItem('sb_username', p.username); } catch(e) {}
      }
      if (p.avatar_url && avatarEl) {
        avatarEl.textContent = '';
        avatarEl.style.backgroundImage    = 'url(' + p.avatar_url + ')';
        avatarEl.style.backgroundSize     = 'cover';
        avatarEl.style.backgroundPosition = 'center';
        try { localStorage.setItem('pkc_avatar_local', p.avatar_url); } catch(e) {}
      }
      // ── is_admin sync ──────────────────────────────────────────
      // Uložíme do localStorage aby _buildPages() a _isAdmin() fungovaly
      // okamžitě bez dalšího API volání.
      var wasAdmin = localStorage.getItem('pkc_is_admin') === '1';
      var isAdminNow = p.is_admin === true;
      try { localStorage.setItem('pkc_is_admin', isAdminNow ? '1' : '0'); } catch(e) {}
      // Pokud se stav změnil → re-renderuj nav (zobrazí/skryje Admin link)
      if (wasAdmin !== isAdminNow) {
        try { renderNav(); } catch(e) {}
      }
    })
    .catch(function() {});
  })();
}

// Vystav globálně — stránky si mohou refreshnout chip po přihlášení
window._topbarRefreshUser = _initUserChip;

function init() {
  console.log('[topbar] v2-multi-provider loading…');
  // Každá funkce v try/catch — aby chyba v jedné nezabila ostatní
  try { injectStyles(); }       catch(e) { console.error('[topbar] injectStyles:', e); }
  try { renderNav(); }          catch(e) { console.error('[topbar] renderNav:', e); }
  try { injectSettings(); }     catch(e) { console.error('[topbar] injectSettings:', e); }
  try { initSettingsValues(); } catch(e) { console.error('[topbar] initSettingsValues:', e); }
  try { injectBell(); }         catch(e) { console.error('[topbar] injectBell:', e); }
  try { injectAuthChip(); }     catch(e) { console.error('[topbar] injectAuthChip:', e); }
  try { _initUserChip(); }      catch(e) { console.error('[topbar] _initUserChip:', e); }
  // FIX: Topbar dropdown přepínač jazyků zrušen — Loyd chtěl jeden přepínač
  // pouze v Settings panelu (žádné dva oddělené widgety pro to samé).
  // Funkce injectLangSwitch zůstává v souboru pro případnou budoucí potřebu.
  // try { injectLangSwitch(); }   catch(e) { console.error('[topbar] injectLangSwitch:', e); }
  try { initGroqPanel(); }      catch(e) { console.error('[topbar] initGroqPanel:', e); }
  try { initCerebrasPanel(); }  catch(e) { console.error('[topbar] initCerebrasPanel:', e); }
  try { initOpenRouterPanel(); }catch(e) { console.error('[topbar] initOpenRouterPanel:', e); }
  try { initMistralPanel(); }   catch(e) { console.error('[topbar] initMistralPanel:', e); }
  try { initXaiPanel(); }       catch(e) { console.error('[topbar] initXaiPanel:', e); }
  try { initGeminiPanel(); }    catch(e) { console.error('[topbar] initGeminiPanel:', e); }
  try { initCloudflarePanel(); } catch(e) { console.error('[topbar] initCloudflarePanel:', e); }
  console.log('[topbar] v2.3 loaded (Groq + Cerebras + OpenRouter + Mistral + xAI + Gemini)');
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
  var uid = localStorage.getItem('sb_user_id');
  if (!uid || !SBU) { npLoad(); return; }  // bez serveru aspoň zobraz lokální/výchozí
  // Zajisti čerstvý token (auto-refresh), ať dotaz nepadne na 401 a nezůstane „Načítám…"
  var p = (typeof window.ensureFreshToken === 'function')
    ? window.ensureFreshToken()
    : Promise.resolve(localStorage.getItem('sb_token') || localStorage.getItem('sb_access_token'));
  p.then(function(tok) {
    tok = tok || localStorage.getItem('sb_token') || localStorage.getItem('sb_access_token');
    if (!tok) { npLoad(); return; }
    return fetch(SBU + '/rest/v1/profiles?id=eq.' + uid + '&select=notification_prefs', {
      headers: { 'apikey': SBA, 'Authorization': 'Bearer ' + tok }
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var row = Array.isArray(d) ? d[0] : null;
      if (row && row.notification_prefs) {
        localStorage.setItem('pkc_notif_prefs', JSON.stringify(row.notification_prefs));
      }
      npLoad();  // vždy vykresli — i když server nic nevrátil (výchozí prefs)
    });
  }).catch(function(){ npLoad(); });  // i při chybě zobraz lokální/výchozí, ne „Načítám…"
}

/* Exportuj prefs pro použití v jiných souborech */
window.getNotifPrefs = function() {
  try { return JSON.parse(localStorage.getItem('pkc_notif_prefs') || '{}'); } catch(e) { return {}; }
};

/* ══════════════════════════════════════════════════════════════
   9. GROQ AI — správa klíčů přímo v settings panelu
   ══════════════════════════════════════════════════════════════ */
var _groqKeys = [];

async function _groqSbReq(path, method, body) {
  var url = _getSbUrl(); var anon = _getSbAnon(); var tok = _getToken();
  if (!url || !anon) return null;
  var headers = { 'apikey': anon, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' };
  if (tok) headers['Authorization'] = 'Bearer ' + tok;
  var opts = { method: method, headers: headers };
  if (body) opts.body = JSON.stringify(body);
  try {
    var r = await fetch(url + '/' + path, opts);
    if (r.status === 204 || r.headers.get('content-length') === '0') return null;
    return await r.json();
  } catch(e) { return null; }
}

function _groqMaskKey(k) {
  return k.slice(0, 8) + '•'.repeat(Math.min(24, k.length - 8));
}
function _groqParseKeys(raw) {
  if (!raw) return [];
  return raw.split(',').map(function(k){ return k.trim(); }).filter(function(k){ return k.length > 10; });
}

/* ══════════════════════════════════════════════════════════════
   _tbReveal — sdílený "👁 oko toggle" stav pro topbar API klíče
   ──────────────────────────────────────────────────────────────
   Mapa: "${prefix}:${idx}" → expirační timestamp (ms).
   Když uživatel klikne 👁, klíč se zobrazí v plné podobě po 24 hod
   (jen v této záložce — zavřením tabu se reset). Není to perzistentní
   úmyslně, aby se klíče samy schovaly i kdyby jsi zapomněl.
   ══════════════════════════════════════════════════════════════ */
var _tbRevealUntil = new Map();
var _tbRevealCheckInterval = null;
var _TB_REVEAL_MS = 24 * 60 * 60 * 1000;

function _tbIsRevealed(prefix, idx) {
  var key = prefix + ':' + idx;
  var exp = _tbRevealUntil.get(key);
  if (!exp) return false;
  if (Date.now() >= exp) {
    _tbRevealUntil.delete(key);
    return false;
  }
  return true;
}

function _tbRevealRemainingHours(prefix, idx) {
  var exp = _tbRevealUntil.get(prefix + ':' + idx);
  if (!exp) return 0;
  var ms = exp - Date.now();
  if (ms <= 0) return 0;
  return Math.max(1, Math.round(ms / (60 * 60 * 1000)));
}

// Najde live re-render funkci pro daný provider
function _tbProviderRerender(prefix) {
  if (prefix === 'groq') {
    if (typeof _groqRenderKeys === 'function' && Array.isArray(_groqKeys)) {
      _groqRenderKeys(_groqKeys);
    }
  } else {
    // Cerebras / OpenRouter / Mistral — factory ukládá rerender hook na window
    var fn = window['_' + prefix + 'Rerender'];
    if (typeof fn === 'function') fn();
  }
}

window._tbRevealKey = function(prefix, idx) {
  _tbRevealUntil.set(prefix + ':' + idx, Date.now() + _TB_REVEAL_MS);
  // Spusť kontrolní interval (každou minutu mažeme expirované)
  if (!_tbRevealCheckInterval) {
    _tbRevealCheckInterval = setInterval(function() {
      var anyExpired = false;
      var prefixes = new Set();
      _tbRevealUntil.forEach(function(exp, k) {
        if (Date.now() >= exp) {
          _tbRevealUntil.delete(k);
          anyExpired = true;
          prefixes.add(k.split(':')[0]);
        }
      });
      if (_tbRevealUntil.size === 0) {
        clearInterval(_tbRevealCheckInterval);
        _tbRevealCheckInterval = null;
      }
      if (anyExpired) {
        prefixes.forEach(function(p) { _tbProviderRerender(p); });
      }
    }, 60000);
  }
  _tbProviderRerender(prefix);
};

window._tbHideKey = function(prefix, idx) {
  _tbRevealUntil.delete(prefix + ':' + idx);
  _tbProviderRerender(prefix);
};

window._tbCopyKey = function(prefix, idx) {
  // Najde plný klíč podle prefixu
  var fullKey = null;
  if (prefix === 'groq' && Array.isArray(_groqKeys)) {
    fullKey = _groqKeys[idx];
  } else {
    var keysGetter = window['_' + prefix + 'GetKeys'];
    if (typeof keysGetter === 'function') {
      var arr = keysGetter();
      if (Array.isArray(arr)) fullKey = arr[idx];
    }
  }
  if (!fullKey) {
    console.warn('[topbar reveal] Nelze najít klíč ' + prefix + ':' + idx);
    return;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(fullKey).then(function() {
      // Krátká zpětná vazba — najde feedback element pro daný provider
      var fb = document.getElementById(prefix + 'Feedback');
      if (fb) {
        fb.textContent = '📋 Klíč zkopírován do schránky';
        fb.className = 'groq-fb ok';
        setTimeout(function() { fb.textContent = ''; fb.className = 'groq-fb'; }, 2500);
      }
    }).catch(function() {
      try { window.prompt('Zkopíruj klíč:', fullKey); } catch(_) {}
    });
  } else {
    try { window.prompt('Zkopíruj klíč:', fullKey); } catch(_) {}
  }
};

// Helper pro render řádku s klíčem — používá ho Groq i factory providery.
// Vrátí HTML řetězec pro jeden klíč (bez wrapperu).
function _tbRenderKeyRow(prefix, idx, fullKey, maskedKey) {
  var revealed = _tbIsRevealed(prefix, idx);
  var hours    = _tbRevealRemainingHours(prefix, idx);
  var display  = revealed ? fullKey : maskedKey;
  var displayStyle = revealed
    ? 'font-family:monospace;font-size:12px;flex:1;color:#f0ece4;background:rgba(245,200,66,.08);padding:3px 6px;border-radius:4px;word-break:break-all;'
    : 'font-family:monospace;font-size:12px;flex:1;color:#f0ece4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  var statusBadge = idx === 0
    ? '<span style="font-size:10px;color:rgba(34,197,94,.85);margin-right:2px;white-space:nowrap" title="Hlavní klíč pro tohoto providera">🟢 aktivní</span>'
    : '<span style="font-size:10px;color:rgba(240,236,228,.35);margin-right:2px;white-space:nowrap" title="Použije se když selže klíč #1">⏳ záloha</span>';
  var revealBtn = revealed
    ? '<button onclick="window._tbHideKey(\'' + prefix + '\',' + idx + ')" style="background:transparent;border:none;color:rgba(245,200,66,.7);font-size:14px;cursor:pointer;padding:0 4px;flex-shrink:0" title="Skrýt klíč (zbývá ' + hours + 'h)">🙈</button>'
    : '<button onclick="window._tbRevealKey(\'' + prefix + '\',' + idx + ')" style="background:transparent;border:none;color:rgba(245,200,66,.7);font-size:14px;cursor:pointer;padding:0 4px;flex-shrink:0" title="Zobrazit klíč na 24 hodin">👁</button>';
  var copyBtn = revealed
    ? '<button onclick="window._tbCopyKey(\'' + prefix + '\',' + idx + ')" style="background:transparent;border:none;color:rgba(116,180,255,.8);font-size:14px;cursor:pointer;padding:0 4px;flex-shrink:0" title="Zkopírovat do schránky">📋</button>'
    : '';
  var hoursLabel = revealed
    ? '<span style="font-size:9px;color:rgba(245,200,66,.6);margin-right:2px" title="Auto-skryje se za ' + hours + ' h">⏱ ' + hours + 'h</span>'
    : '';
  return '<div style="display:flex;align-items:center;gap:6px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:8px 12px">'
    + '<span style="font-size:11px;color:rgba(240,236,228,.35);min-width:20px;font-weight:700">#' + (idx+1) + '</span>'
    + '<span style="' + displayStyle + '">' + display + '</span>'
    + hoursLabel
    + revealBtn
    + copyBtn
    + statusBadge
    + '<button onclick="window._' + prefix + 'RemoveKey(' + idx + ')" style="background:transparent;border:none;color:#f87171;font-size:16px;cursor:pointer;padding:0 4px;flex-shrink:0" title="Odebrat">✕</button>'
    + '</div>';
}

function _groqRenderKeys(keys) {
  var list = document.getElementById('groqKeysList');
  if (!list) return;
  if (!keys.length) {
    list.innerHTML = '<div style="font-size:12px;color:rgba(240,236,228,.35);padding:4px 0">Zatím žádné klíče – přidej první výše</div>';
    return;
  }
  list.innerHTML = keys.map(function(k, i) {
    return _tbRenderKeyRow('groq', i, k, _groqMaskKey(k));
  }).join('');
}

function _groqUpdateStatus(keys) {
  var n = keys.length;
  var dot    = document.getElementById('groqDot');
  var txt    = document.getElementById('groqStatusText');
  var sub    = document.getElementById('accGroqSub');
  var delBtn = document.getElementById('groqDeleteBtn');
  var testBtn= document.getElementById('groqTestBtn');
  if (!dot) return;
  if (n > 0) {
    dot.className = 'groq-dot active';
    if (txt) txt.textContent = 'Groq AI aktivní – ' + n + ' klíč' + (n === 1 ? '' : n < 5 ? 'e' : 'ů');
    if (sub) sub.textContent = 'Aktivní (' + n + '×)';
    if (delBtn) delBtn.style.display = '';
    if (testBtn) testBtn.style.display = '';
  } else {
    dot.className = 'groq-dot';
    if (txt) txt.textContent = 'Groq AI není nakonfigurováno';
    if (sub) sub.textContent = 'Nekonfigurováno';
    if (delBtn) delBtn.style.display = 'none';
    if (testBtn) testBtn.style.display = 'none';
  }
}

function _groqSetFb(msg, type) {
  var fb = document.getElementById('groqFeedback');
  if (!fb) return;
  fb.textContent = msg;
  fb.className = 'groq-fb' + (type ? ' ' + type : '');
}

async function _groqSaveAll() {
  var uid = _getUid();
  if (!uid) throw new Error('Nepřihlášen');
  var keyStr = _groqKeys.join(',');
  var modelSel = document.getElementById('groqModelSelect');
  var model = modelSel ? modelSel.value : 'llama-3.3-70b-versatile';
  var existing = await _groqSbReq('rest/v1/user_api_keys?user_id=eq.' + uid + '&select=id', 'GET');
  var hasRow = Array.isArray(existing) && existing.length > 0;
  var res = await _groqSbReq(
    hasRow ? 'rest/v1/user_api_keys?user_id=eq.' + uid : 'rest/v1/user_api_keys',
    hasRow ? 'PATCH' : 'POST',
    { user_id: uid, groq_key: keyStr, groq_model: model, groq_enabled: true }
  );
  if (res && res.error) throw new Error(res.error.message || 'Chyba uložení');
  if (window.GroqClient && typeof GroqClient.loadKey === 'function') GroqClient.loadKey();
}

async function _groqLoad() {
  var uid = _getUid();
  var dot = document.getElementById('groqDot');
  var txt = document.getElementById('groqStatusText');
  if (!dot) return;
  dot.className = 'groq-dot loading';
  if (txt) txt.textContent = 'Načítám nastavení…';

  // Naplň modely z GroqClient pokud je k dispozici
  var modelSel = document.getElementById('groqModelSelect');
  if (modelSel && window.GroqClient && typeof GroqClient.getModels === 'function') {
    modelSel.innerHTML = '';
    GroqClient.getModels().forEach(function(m) {
      var opt = document.createElement('option');
      opt.value = m.id; opt.textContent = m.label;
      modelSel.appendChild(opt);
    });
  }

  if (!uid) { _groqUpdateStatus([]); _groqRenderKeys([]); return; }
  try {
    var res = await _groqSbReq('rest/v1/user_api_keys?user_id=eq.' + uid + '&select=groq_key,groq_model', 'GET');
    var data = Array.isArray(res) ? res[0] : null;
    if (data && data.groq_key) {
      _groqKeys = _groqParseKeys(data.groq_key);
      if (data.groq_model && modelSel) modelSel.value = data.groq_model;
    } else {
      _groqKeys = [];
    }
  } catch(e) { console.warn('[Groq topbar] Chyba načítání:', e); _groqKeys = []; }
  _groqRenderKeys(_groqKeys);
  _groqUpdateStatus(_groqKeys);
}

window._groqRemoveKey = async function(idx) {
  if (!confirm('Odebrat klíč #' + (idx+1) + '?')) return;
  _groqKeys.splice(idx, 1);
  try {
    await _groqSaveAll();
    _groqRenderKeys(_groqKeys);
    _groqUpdateStatus(_groqKeys);
    _groqSetFb(_groqKeys.length ? '✅ Klíč odebrán' : 'Všechny klíče odebrány', 'ok');
  } catch(e) { _groqSetFb('❌ ' + e.message, 'err'); }
};

function _groqInitEvents() {
  var addBtn = document.getElementById('groqAddBtn');
  var delBtn = document.getElementById('groqDeleteBtn');
  if (addBtn && !addBtn._groqBound) {
    addBtn._groqBound = true;
    addBtn.addEventListener('click', async function() {
      var keyInput = document.getElementById('groqKeyInput');
      var key = keyInput ? keyInput.value.trim() : '';
      if (!key || key.length < 20) { _groqSetFb('Zadej platný Groq API klíč (začíná gsk_…)', 'err'); return; }
      if (_groqKeys.indexOf(key) !== -1) { _groqSetFb('Tento klíč už je přidán.', 'err'); return; }
      addBtn.disabled = true; addBtn.textContent = '⏳'; _groqSetFb('', '');
      try {
        _groqKeys.push(key);
        await _groqSaveAll();
        _groqRenderKeys(_groqKeys);
        _groqUpdateStatus(_groqKeys);
        if (keyInput) keyInput.value = '';
        _groqSetFb('✅ Klíč #' + _groqKeys.length + ' přidán', 'ok');
      } catch(e) { _groqKeys.pop(); _groqSetFb('❌ ' + e.message, 'err'); }
      finally { addBtn.disabled = false; addBtn.textContent = '+ Přidat'; }
    });
  }
  if (delBtn && !delBtn._groqBound) {
    delBtn._groqBound = true;
    delBtn.addEventListener('click', async function() {
      if (!confirm('Odebrat všechny Groq klíče? Groq funkce přestanou fungovat.')) return;
      var uid = _getUid(); if (!uid) return;
      try {
        await _groqSbReq('rest/v1/user_api_keys?user_id=eq.' + uid, 'DELETE');
        _groqKeys = []; _groqRenderKeys([]); _groqUpdateStatus([]);
        _groqSetFb('Všechny klíče byly odebrány.', 'ok');
      } catch(e) { _groqSetFb('❌ ' + e.message, 'err'); }
    });
  }

  var testBtn = document.getElementById('groqTestBtn');
  if (testBtn && !testBtn._groqBound) {
    testBtn._groqBound = true;
    testBtn.addEventListener('click', async function() {
      if (!_groqKeys.length) { _groqSetFb('Nejdřív přidej aspoň jeden klíč.', 'err'); return; }
      var resDiv = document.getElementById('groqTestResult');
      if (resDiv) { resDiv.style.display = 'block'; resDiv.textContent = '⏳ Testuji…'; }
      testBtn.disabled = true; testBtn.textContent = '⏳ Testuji…';
      _groqSetFb('', '');

      var results = [];
      for (var i = 0; i < _groqKeys.length; i++) {
        var key = _groqKeys[i];
        var label = '#' + (i+1) + ' ' + key.slice(0, 10) + '…';
        try {
          var r = await _testProviderKey('groq', key);
          results.push('✓ ' + label + ' → ' + r.model + ' (' + r.time + 'ms)');
        } catch(e) {
          results.push('✗ ' + label + ' → ' + e.message);
        }
      }
      var okCount = results.filter(function(r) { return r.startsWith('✓'); }).length;
      if (resDiv) resDiv.textContent = '📊 ' + okCount + '/' + _groqKeys.length + ' klíčů funguje:\n\n' + results.join('\n');
      _groqSetFb(okCount === _groqKeys.length ? '✅ Všechny klíče fungují' : (okCount > 0 ? '⚠️ Některé klíče selhaly' : '❌ Žádný klíč nefunguje'), okCount > 0 ? 'ok' : 'err');
      testBtn.disabled = false; testBtn.textContent = '⚡ Otestovat';
    });
  }
}

function initGroqPanel() {
  _groqLoad().then(function() { _groqInitEvents(); }).catch(function(e) { console.warn('[Groq topbar init]', e); });
}

/* ══════════════════════════════════════════════════════════════
   9b. Generická továrna pro další AI providery (Cerebras, OpenRouter)
   Sdílí styly a chování s Groq sekcí, ale ukládá do vlastních
   sloupců (cerebras_key, openrouter_key) tabulky user_api_keys.
   ══════════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════════
   _testProviderKey — ověří že daný klíč funguje u providera
   Pošle minimální request ("Say OK" / max_tokens 5) a vrátí výsledek.
   ══════════════════════════════════════════════════════════════ */
async function _testProviderKey(providerName, apiKey, cfg) {
  // Pro OpenRouter použijeme GET /models endpoint — ověří klíč bez konzumace kvóty
  // a bez závislosti na dostupnosti konkrétního modelu. Pro Groq/Cerebras použijeme
  // malý chat request (nemají spolehlivý GET endpoint pro ověření).
  var validators = {
    groq: {
      method:   'POST',
      url:      'https://api.groq.com/openai/v1/chat/completions',
      body:     JSON.stringify({ model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: 'Say OK' }], max_tokens: 5, temperature: 0 }),
      testType: 'chat',
    },
    cerebras: {
      method:   'POST',
      url:      'https://api.cerebras.ai/v1/chat/completions',
      body:     JSON.stringify({ model: 'llama-3.1-8b', messages: [{ role: 'user', content: 'Say OK' }], max_tokens: 5, temperature: 0 }),
      testType: 'chat',
    },
    openrouter: {
      method:   'GET',
      url:      'https://openrouter.ai/api/v1/auth/key',  // Returns info o klíči, jen 1 request
      body:     null,
      testType: 'auth',
    },
    mistral: {
      method:   'GET',
      url:      'https://api.mistral.ai/v1/models',
      body:     null,
      testType: 'auth',
    },
    xai: {
      method:   'POST',
      url:      'https://api.x.ai/v1/chat/completions',
      body:     JSON.stringify({ model: 'grok-3-mini', messages: [{ role: 'user', content: 'Say OK' }], max_tokens: 5, temperature: 0 }),
      testType: 'chat',
    },
    gemini: {
      method:   'POST',
      url:      null,
      body:     JSON.stringify({ contents: [{ parts: [{ text: 'Say OK' }] }], generationConfig: { maxOutputTokens: 5 } }),
      testType: 'gemini',
    },
    cloudflare: {
      method:   'POST',
      url:      null,
      body:     JSON.stringify({ messages: [{ role: 'user', content: 'Say OK' }], max_tokens: 5 }),
      testType: 'cloudflare',
    },
  };
  var cfg2 = validators[providerName];
  if (!cfg2) throw new Error('Neznámý provider: ' + providerName);

  // Gemini používá ?key= query param místo Bearer tokenu
  var fetchUrl = cfg2.url;
  var headers = {};
  if (providerName === 'gemini') {
    fetchUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey;
    headers['Content-Type'] = 'application/json';
  } else if (providerName === 'cloudflare') {
    // Cloudflare CORS: přímý fetch z prohlížeče blokuje CORS → validujeme jen formát klíče
    var cfParts = apiKey.split(':');
    if (cfParts.length < 2) throw new Error('Cloudflare klíč musí být ve formátu account_id:token');
    var cfAccountId = cfParts[0];
    var cfToken = cfParts.slice(1).join(':');
    if (cfAccountId.length < 8) throw new Error('Account ID je příliš krátký');
    if (cfToken.length < 16) throw new Error('API Token je příliš krátký');
    // Formát OK — vrátíme výsledek přímo bez API volání (CORS blokuje)
    return { model: 'format-ok', time: 0, reply: 'Formát klíče OK — bude ověřen při prvním scanu' };
  } else {
    headers['Authorization'] = 'Bearer ' + apiKey;
    if (cfg2.method === 'POST') headers['Content-Type'] = 'application/json';
  }
  if (providerName === 'openrouter') {
    headers['HTTP-Referer'] = window.location.origin;
    headers['X-Title']      = 'PokéTrade Test';
  }

  var t0 = Date.now();
  var r;
  try {
    var fetchOpts = {
      method:  cfg2.method,
      headers: headers,
      signal:  AbortSignal.timeout(10000),
    };
    if (cfg2.body) fetchOpts.body = cfg2.body;
    r = await fetch(fetchUrl, fetchOpts);
  } catch(e) {
    throw new Error('síťová chyba: ' + e.message);
  }
  var t1 = Date.now();

  if (!r.ok) {
    var errBody = {};
    try { errBody = await r.json(); } catch(_) {}
    var msg = errBody?.error?.message || errBody?.message || ('HTTP ' + r.status);
    throw new Error(msg);
  }

  var data = await r.json();
  if (cfg2.testType === 'cloudflare') {
    // Cloudflare Workers AI: { result: { response: '...' } } nebo { result: { response: '...' } }
    var cfReply = data?.result?.response || data?.choices?.[0]?.message?.content || '?';
    return { model: 'llama-3.3-70b-fp8', time: t1 - t0, reply: cfReply.slice(0, 30) };
  }
  if (cfg2.testType === 'gemini') {
    // Gemini: { candidates: [{ content: { parts: [{ text: '...' }] } }] }
    var geminiText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '?';
    return { model: 'gemini-2.5-flash-preview-05-20', time: t1 - t0, reply: geminiText.slice(0, 30) };
  }
  if (cfg2.testType === 'auth') {
    // OpenRouter auth/key endpoint → { data: { label, usage, limit, ... } }
    var info = data?.data || data;
    var usage = info?.usage || 0;
    var limit = info?.limit;
    return {
      model: 'auth_ok',
      time:  t1 - t0,
      reply: limit != null ? ('spotř: $' + usage.toFixed(4) + '/' + limit) : ('spotř: $' + (usage || 0)),
    };
  }
  var content = data?.choices?.[0]?.message?.content || '?';
  return {
    model: (cfg2.body ? JSON.parse(cfg2.body).model : '').split('/').pop(),
    time:  t1 - t0,
    reply: content.slice(0, 30),
  };
}

function _initProviderPanel(cfg) {
  // cfg = { prefix, name, field, keyPrefix, minLen, countNoun: [jeden, málo, mnoho] }
  var state = { keys: [] };

  function $(id) { return document.getElementById(id); }
  function el(idSuffix) { return $(cfg.prefix + idSuffix); }

  function mask(k) { return k.slice(0, 8) + '•'.repeat(Math.min(24, k.length - 8)); }
  function parse(raw) {
    if (!raw) return [];
    return raw.split(',').map(function(k){ return k.trim(); }).filter(function(k){ return k.length > 10; });
  }

  function render() {
    var list = el('KeysList');
    if (!list) return;
    if (!state.keys.length) {
      list.innerHTML = '<div style="font-size:12px;color:rgba(240,236,228,.35);padding:4px 0">Zatím žádné klíče – přidej první výše</div>';
      return;
    }
    list.innerHTML = state.keys.map(function(k, i) {
      return _tbRenderKeyRow(cfg.prefix, i, k, mask(k));
    }).join('');
  }

  // Vystav rerender + getKeys helpers na window — sdílený eye-toggle handler
  // (`_tbRevealKey`/`_tbCopyKey`) je potřebuje ke svému callbacku.
  window['_' + cfg.prefix + 'Rerender'] = render;
  window['_' + cfg.prefix + 'GetKeys']  = function() { return state.keys.slice(); };
  // Vystav i load() — voláno z toggleSettingsDrop() pro refresh klíčů při otevření
  // dropdown panelu (race condition: init běží před login, klíče by zůstaly prázdné
  // a uživatel viděl "Přidej první klíč" dokud nedá Ctrl+Shift+R).
  window['_' + cfg.prefix + 'Reload']   = function() {
    return load().catch(function(e) { console.warn('[' + cfg.name + ' reload]', e); });
  };

  function updateStatus() {
    var n = state.keys.length;
    var dot    = el('Dot');
    var txt    = el('StatusText');
    // ID sekce sub (v HTML) nesedí přesně s cfg.prefix kapitalizací.
    // Openrouter → accOpenRouterSub (s 'R' uvnitř), ne accOpenrouterSub.
    // Použijeme cfg.subId pokud je definovaný, jinak fallback přes capitalize.
    var subId = cfg.subId || ('acc' + cfg.prefix.charAt(0).toUpperCase() + cfg.prefix.slice(1) + 'Sub');
    var sub    = $(subId);
    var delBtn = el('DeleteBtn');
    var testBtn= el('TestBtn');
    if (!dot) return;
    if (n > 0) {
      dot.className = 'groq-dot active';
      var nounForm = n === 1 ? cfg.countNoun[0] : (n < 5 ? cfg.countNoun[1] : cfg.countNoun[2]);
      if (txt) txt.textContent = cfg.name + ' aktivní – ' + n + ' ' + nounForm;
      if (sub) sub.textContent = 'Aktivní (' + n + '×)';
      if (delBtn) delBtn.style.display = '';
      if (testBtn) testBtn.style.display = '';
    } else {
      dot.className = 'groq-dot';
      if (txt) txt.textContent = cfg.name + ' není nakonfigurováno';
      if (sub) sub.textContent = 'Nekonfigurováno';
      if (delBtn) delBtn.style.display = 'none';
      if (testBtn) testBtn.style.display = 'none';
    }
  }

  function setFb(msg, type) {
    var fb = el('Feedback');
    if (!fb) return;
    fb.textContent = msg;
    fb.className = 'groq-fb' + (type ? ' ' + type : '');
  }

  async function saveAll() {
    var uid = _getUid();
    if (!uid) throw new Error('Nepřihlášen');
    var keyStr = state.keys.join(',');
    var patch = {};
    patch[cfg.field] = keyStr;
    patch.user_id   = uid;
    var existing = await _groqSbReq('rest/v1/user_api_keys?user_id=eq.' + uid + '&select=id', 'GET');
    var hasRow = Array.isArray(existing) && existing.length > 0;
    var res = await _groqSbReq(
      hasRow ? 'rest/v1/user_api_keys?user_id=eq.' + uid : 'rest/v1/user_api_keys',
      hasRow ? 'PATCH' : 'POST',
      patch
    );
    if (res && res.error) throw new Error(res.error.message || 'Chyba uložení');
    if (window.GroqClient && typeof GroqClient.loadKey === 'function') GroqClient.loadKey();
  }

  async function load() {
    var uid = _getUid();
    var dot = el('Dot');
    var txt = el('StatusText');
    if (!dot) return;
    dot.className = 'groq-dot loading';
    if (txt) txt.textContent = 'Načítám nastavení…';
    if (!uid) { state.keys = []; render(); updateStatus(); return; }
    try {
      var res = await _groqSbReq('rest/v1/user_api_keys?user_id=eq.' + uid + '&select=' + cfg.field, 'GET');
      var data = Array.isArray(res) ? res[0] : null;
      if (data && data[cfg.field]) {
        state.keys = parse(data[cfg.field]);
      } else {
        state.keys = [];
      }
    } catch(e) {
      console.warn('[' + cfg.name + ' topbar] Chyba načítání:', e);
      state.keys = [];
    }
    render();
    updateStatus();
  }

  window['_' + cfg.prefix + 'RemoveKey'] = async function(idx) {
    if (!confirm('Odebrat klíč #' + (idx+1) + '?')) return;
    state.keys.splice(idx, 1);
    try {
      await saveAll();
      render(); updateStatus();
      setFb(state.keys.length ? '✅ Klíč odebrán' : 'Všechny klíče odebrány', 'ok');
    } catch(e) { setFb('❌ ' + e.message, 'err'); }
  };

  function initEvents() {
    var addBtn = el('AddBtn');
    var delBtn = el('DeleteBtn');
    if (addBtn && !addBtn._providerBound) {
      addBtn._providerBound = true;
      addBtn.addEventListener('click', async function() {
        var keyInput = el('KeyInput');
        var key = keyInput ? keyInput.value.trim() : '';
        if (!key || key.length < (cfg.minLen || 20)) {
          var hintMsg = cfg.keyPrefix
            ? 'Zadej platný ' + cfg.name + ' API klíč (začíná ' + cfg.keyPrefix + '…)'
            : 'Zadej platný ' + cfg.name + ' API klíč (alespoň ' + (cfg.minLen || 20) + ' znaků)';
          setFb(hintMsg, 'err'); return;
        }
        // Volitelná custom validace — pro Cloudflare ověříme account_id:token formát
        if (typeof cfg.validateFormat === 'function') {
          var err = cfg.validateFormat(key);
          if (err) { setFb(err, 'err'); return; }
        }
        if (state.keys.indexOf(key) !== -1) { setFb('Tento klíč už je přidán.', 'err'); return; }
        addBtn.disabled = true; addBtn.textContent = '⏳'; setFb('', '');
        try {
          state.keys.push(key);
          await saveAll();
          render(); updateStatus();
          if (keyInput) keyInput.value = '';
          setFb('✅ Klíč #' + state.keys.length + ' přidán', 'ok');
        } catch(e) { state.keys.pop(); setFb('❌ ' + e.message, 'err'); }
        finally { addBtn.disabled = false; addBtn.textContent = '+ Přidat'; }
      });
    }
    if (delBtn && !delBtn._providerBound) {
      delBtn._providerBound = true;
      delBtn.addEventListener('click', async function() {
        if (!confirm('Odebrat všechny ' + cfg.name + ' klíče? Tato služba přestane fungovat.')) return;
        var uid = _getUid(); if (!uid) return;
        try {
          var payload = {}; payload[cfg.field] = null;
          await _groqSbReq('rest/v1/user_api_keys?user_id=eq.' + uid, 'PATCH', payload);
          state.keys = []; render(); updateStatus();
          setFb('Všechny klíče byly odebrány.', 'ok');
          if (window.GroqClient && typeof GroqClient.loadKey === 'function') GroqClient.loadKey();
        } catch(e) { setFb('❌ ' + e.message, 'err'); }
      });
    }

    var testBtn = el('TestBtn');
    if (testBtn && !testBtn._providerBound) {
      testBtn._providerBound = true;
      testBtn.addEventListener('click', async function() {
        if (!state.keys.length) {
          setFb('Nejdřív přidej aspoň jeden klíč.', 'err');
          return;
        }
        var resDiv = $(cfg.prefix + 'TestResult');
        if (resDiv) { resDiv.style.display = 'block'; resDiv.textContent = '⏳ Testuji…'; }
        testBtn.disabled = true; testBtn.textContent = '⏳ Testuji…';
        setFb('', '');

        var results = [];
        for (var i = 0; i < state.keys.length; i++) {
          var key = state.keys[i];
          var label = '#' + (i+1) + ' ' + key.slice(0, 10) + '…';
          try {
            var response = await _testProviderKey(cfg.prefix, key, cfg);
            var resultLine = response.model === 'format-ok'
              ? ('✓ ' + label + ' → ' + response.reply)
              : ('✓ ' + label + ' → ' + response.model + ' (' + response.time + 'ms)');
            results.push(resultLine);
          } catch(e) {
            results.push('✗ ' + label + ' → ' + e.message);
          }
        }
        var okCount = results.filter(function(r) { return r.startsWith('✓'); }).length;
        if (resDiv) {
          resDiv.textContent = '📊 ' + okCount + '/' + state.keys.length + ' klíčů funguje:\n\n' + results.join('\n');
        }
        setFb(okCount === state.keys.length ? '✅ Všechny klíče fungují' : (okCount > 0 ? '⚠️ Některé klíče selhaly' : '❌ Žádný klíč nefunguje'), okCount > 0 ? 'ok' : 'err');
        testBtn.disabled = false; testBtn.textContent = '⚡ Otestovat';
      });
    }
  }

  load().then(function() { initEvents(); }).catch(function(e) { console.warn('[' + cfg.name + ' topbar init]', e); });
}

function initCerebrasPanel() {
  _initProviderPanel({
    prefix:    'cerebras',
    name:      'Cerebras AI',
    field:     'cerebras_key',
    keyPrefix: 'csk-',
    minLen:    20,
    countNoun: ['klíč', 'klíče', 'klíčů'],
    subId:     'accCerebrasSub',  // explicitní ID sub elementu v HTML
  });
}

function initOpenRouterPanel() {
  _initProviderPanel({
    prefix:    'openrouter',
    name:      'OpenRouter AI',
    field:     'openrouter_key',
    keyPrefix: 'sk-or-v1-',
    minLen:    30,
    countNoun: ['klíč', 'klíče', 'klíčů'],
    subId:     'accOpenRouterSub',  // POZOR: velké R — kapitalizace `charAt(0)` by selhala
  });
}

function initMistralPanel() {
  _initProviderPanel({
    prefix:    'mistral',
    name:      'Mistral AI',
    field:     'mistral_key',
    keyPrefix: '',           // Mistral klíče nemají specifický prefix (jen alfanumerické)
    minLen:    20,
    countNoun: ['klíč', 'klíče', 'klíčů'],
    subId:     'accMistralSub',
  });
}

function initXaiPanel() {
  _initProviderPanel({
    prefix:    'xai',
    name:      'xAI Grok',
    field:     'xai_key',
    keyPrefix: 'xai-',
    minLen:    20,
    countNoun: ['klíč', 'klíče', 'klíčů'],
    subId:     'accXaiSub',
  });
  // Init stavu tlačítka Preferovat
  _xaiUpdatePreferBtn();
}

// Globální funkce — volána z onclick v HTML
window.xaiTogglePrefer = function() {
  var preferred = localStorage.getItem('xai_preferred') === '1';
  var next = !preferred;
  localStorage.setItem('xai_preferred', next ? '1' : '0');
  // Předat do GroqClient, pokud je dostupný
  if (window.GroqClient && typeof GroqClient.setXaiPreferred === 'function') {
    GroqClient.setXaiPreferred(next);
  }
  _xaiUpdatePreferBtn();
};

function _xaiUpdatePreferBtn() {
  var preferred = localStorage.getItem('xai_preferred') === '1';
  var btn = document.getElementById('xaiPreferBtn');
  if (!btn) return;
  if (preferred) {
    btn.classList.add('xai-preferred');
    btn.innerHTML = '⭐ Preferováno — jede jako první &nbsp;<span class="xai-prefer-badge">AKTIVNÍ</span>';
  } else {
    btn.classList.remove('xai-preferred');
    btn.innerHTML = '☆ Preferovat — použít jako první';
  }
}

function initGeminiPanel() {
  _initProviderPanel({
    prefix:    'gemini',
    name:      'Google Gemini',
    field:     'gemini_key',
    keyPrefix: 'AIza',
    minLen:    20,
    countNoun: ['klíč', 'klíče', 'klíčů'],
    subId:     'accGeminiSub',
  });
  _geminiUpdatePreferBtn();
}

window.geminiTogglePrefer = function() {
  var preferred = localStorage.getItem('gemini_preferred') === '1';
  var next = !preferred;
  localStorage.setItem('gemini_preferred', next ? '1' : '0');
  if (window.GroqClient && typeof GroqClient.setGeminiPreferred === 'function') {
    GroqClient.setGeminiPreferred(next);
  }
  _geminiUpdatePreferBtn();
};

function _geminiUpdatePreferBtn() {
  var preferred = localStorage.getItem('gemini_preferred') === '1';
  var btn = document.getElementById('geminiPreferBtn');
  if (!btn) return;
  if (preferred) {
    btn.classList.add('xai-preferred');
    btn.innerHTML = '⭐ Preferováno — jede jako první &nbsp;<span class="xai-prefer-badge">AKTIVNÍ</span>';
  } else {
    btn.classList.remove('xai-preferred');
    btn.innerHTML = '☆ Preferovat — použít jako první';
  }
}

function initCloudflarePanel() {
  _initProviderPanel({
    prefix:    'cloudflare',
    name:      'Cloudflare Workers AI',
    field:     'cloudflare_key',
    // Cloudflare klíč má speciální formát 'account_id:token' — minLen je tedy mírně vyšší.
    // Validace formátu se dělá ve _initProviderPanel přes addBtn handler (níže).
    keyPrefix: '',     // klíč není čistě prefixovaný (account_id může být cokoliv hex)
    minLen:    25,     // ~ 32 hex chars + ':' + 40 chars token
    countNoun: ['klíč', 'klíče', 'klíčů'],
    subId:     'accCloudflareSub',
    validateFormat: function(key) {
      // Musí obsahovat ':' a obě části musí mít smysl
      var colon = key.indexOf(':');
      if (colon < 8) return 'Chybí Account ID před dvojtečkou';
      if (key.length - colon < 16) return 'Token (po dvojtečce) je příliš krátký';
      return null; // OK
    },
  });
}

})();


/* ── Heslo: Změnit / Zapomenuté ─────────────────────────────── */
function _spSb() {
  return {
    url:  window.SB_URL  || window.SUPABASE_URL  || '',
    anon: window.SB_ANON || window.SUPABASE_ANON || ''
  };
}

function _spModal(id, html) {
  if (document.getElementById(id)) return;
  var el = document.createElement('div');
  el.id = id;
  el.className = 'sp-pass-overlay';
  el.innerHTML = '<div class="sp-pass-box">' + html + '</div>';
  el.addEventListener('click', function(e) { if (e.target === el) el.classList.remove('open'); });
  document.body.appendChild(el);
}

window.spOpenChangePass = function () {
  _spModal('_spPassModal',
    '<div class="sp-pass-title">🔑 Změnit heslo</div>' +
    '<div class="sp-pass-sub">Zadej nové heslo pro svůj účet.</div>' +
    '<input id="_spP1" class="sp-pass-inp" type="password" placeholder="Nové heslo (min. 6 znaků)">' +
    '<input id="_spP2" class="sp-pass-inp" type="password" placeholder="Znovu nové heslo">' +
    '<div id="_spPFb" class="sp-pass-fb"></div>' +
    '<button class="sp-pass-save" onclick="spDoChangePass()">Uložit nové heslo</button>' +
    '<button class="sp-pass-cancel" onclick="spCloseChangePass()">Zrušit</button>'
  );
  document.getElementById('_spP1').value = '';
  document.getElementById('_spP2').value = '';
  document.getElementById('_spPFb').textContent = '';
  document.getElementById('_spPassModal').classList.add('open');
  setTimeout(function () { document.getElementById('_spP1').focus(); }, 80);
};

window.spCloseChangePass = function () {
  var m = document.getElementById('_spPassModal');
  if (m) m.classList.remove('open');
};

window.spDoChangePass = async function () {
  var p1  = document.getElementById('_spP1').value;
  var p2  = document.getElementById('_spP2').value;
  var fb  = document.getElementById('_spPFb');
  var err = function(msg) { fb.textContent = '⚠️ ' + msg; fb.className = 'sp-pass-fb err'; };

  if (!p1)           return err('Zadej nové heslo');
  if (p1.length < 6) return err('Heslo musí mít alespoň 6 znaků');
  if (p1 !== p2)     return err('Hesla se neshodují');

  var token = localStorage.getItem('sb_token') || localStorage.getItem('supabase_token');
  if (!token) return err('Nejsi přihlášen');

  var sb = _spSb();
  try {
    var res  = await fetch(sb.url + '/auth/v1/user', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'apikey': sb.anon, 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ password: p1 })
    });
    var data = await res.json();
    if (!res.ok || data.error) throw new Error((data.error && data.error.message) || 'Chyba při změně hesla');
    fb.textContent = '✅ Heslo úspěšně změněno!';
    fb.className = 'sp-pass-fb ok';
    setTimeout(spCloseChangePass, 1800);
  } catch (e) { err(e.message); }
};

window.spOpenForgotPass = function () {
  _spModal('_spForgotModal',
    '<div class="sp-pass-title">📧 Zapomenuté heslo</div>' +
    '<div class="sp-pass-sub">Pošleme ti e-mail s odkazem pro reset hesla.</div>' +
    '<input id="_spFE" class="sp-pass-inp" type="email" placeholder="Tvůj e-mail">' +
    '<div id="_spFFb" class="sp-pass-fb"></div>' +
    '<button class="sp-pass-save" onclick="spDoForgotPass()">Odeslat reset e-mail</button>' +
    '<button class="sp-pass-cancel" onclick="spCloseForgotPass()">Zrušit</button>'
  );
  var email = localStorage.getItem('sb_email') || '';
  var inp   = document.getElementById('_spFE');
  if (email) inp.value = email;
  document.getElementById('_spFFb').textContent = '';
  document.getElementById('_spForgotModal').classList.add('open');
  setTimeout(function () { inp.focus(); }, 80);
};

window.spCloseForgotPass = function () {
  var m = document.getElementById('_spForgotModal');
  if (m) m.classList.remove('open');
};

window.spDoForgotPass = async function () {
  var email = document.getElementById('_spFE').value.trim();
  var fb    = document.getElementById('_spFFb');
  if (!email) { fb.textContent = '⚠️ Zadej e-mail'; fb.className = 'sp-pass-fb err'; return; }
  var sb = _spSb();
  try {
    await fetch(sb.url + '/auth/v1/recover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': sb.anon },
      body: JSON.stringify({ email: email, gotrue_meta_security: {} })
    });
    fb.textContent = '✅ E-mail odeslán! Zkontroluj schránku.';
    fb.className = 'sp-pass-fb ok';
    setTimeout(spCloseForgotPass, 2200);
  } catch (e) {
    fb.textContent = '⚠️ Chyba: ' + e.message;
    fb.className = 'sp-pass-fb err';
  }
};

/* ═══════════════════════════════════════════════════════════════
   GLOBÁLNÍ AUTO-REFRESH SUPABASE TOKENU
   Token vyprší po čase → bez obnovy padají požadavky na 401.
   Tohle běží na každé stránce s topbar.js: po načtení a pak
   periodicky zkontroluje token a včas ho obnoví přes refresh_token.
   Vystaveno jako window.ensureFreshToken() — fetch volání si ho
   mohou zavolat před požadavkem, aby měla jistě platný token.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  // Dekóduje 'exp' (ms) z JWT; 0 když nejde přečíst
  function _jwtExp(token) {
    if (!token || token.indexOf('.') < 0) return 0;
    try {
      var p = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      return p.exp ? p.exp * 1000 : 0;
    } catch (e) { return 0; }
  }
  // Token je prošlý nebo vyprší do 5 minut?
  function _expiredOrSoon(token) {
    if (!token) return true;
    var exp = _jwtExp(token);
    return exp === 0 || (exp - Date.now()) < 5 * 60 * 1000;
  }
  function _getRefreshToken() {
    var rt = localStorage.getItem('sb_refresh_token');
    if (rt) return rt;
    // Fallback: hledej v JSON session klíčích (supabase-js formát)
    for (var i = 0; i < localStorage.length; i++) {
      var v = localStorage.getItem(localStorage.key(i));
      if (v && v.charAt(0) === '{') {
        try {
          var o = JSON.parse(v);
          var r = (o && o.refresh_token) || (o && o.currentSession && o.currentSession.refresh_token);
          if (r) return r;
        } catch (e) {}
      }
    }
    return null;
  }

  var _refreshing = null; // sdílený slib, ať neběží víc refreshů naráz

  async function _doRefresh() {
    var url = _getSbUrl(), anon = _getSbAnon(), rt = _getRefreshToken();
    if (!url || !anon || !rt) return null;
    try {
      var r = await fetch(url + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: { 'apikey': anon, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: rt })
      });
      if (!r.ok) return null;
      var data = await r.json();
      if (!data.access_token) return null;
      localStorage.setItem('sb_token', data.access_token);
      if (data.refresh_token) localStorage.setItem('sb_refresh_token', data.refresh_token);
      if (data.user) {
        try { localStorage.setItem('sb_user', JSON.stringify(data.user)); } catch (e) {}
        localStorage.setItem('sb_email', data.user.email || '');
        localStorage.setItem('sb_user_id', data.user.id || '');
      }
      return data.access_token;
    } catch (e) { return null; }
  }

  // Hlavní vstup: zajistí platný token. Vrací aktuální (případně obnovený) token.
  window.ensureFreshToken = async function () {
    var tok = localStorage.getItem('sb_token') || localStorage.getItem('sb_access_token');
    if (!_expiredOrSoon(tok)) return tok;
    if (!_refreshing) {
      _refreshing = _doRefresh().finally(function () { _refreshing = null; });
    }
    var fresh = await _refreshing;
    return fresh || tok;
  };

  // Po načtení stránky hned zkontroluj + pak periodicky na pozadí.
  // Interval 4 min < 5min práh, takže token se obnoví dřív, než vyprší.
  function _startAutoRefresh() {
    if (!localStorage.getItem('sb_token')) return; // nepřihlášený → nic
    window.ensureFreshToken();
    setInterval(function () {
      if (localStorage.getItem('sb_token')) window.ensureFreshToken();
    }, 4 * 60 * 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _startAutoRefresh);
  } else {
    _startAutoRefresh();
  }
})();
