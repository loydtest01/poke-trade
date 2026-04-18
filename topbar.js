/**
 * topbar.js — Sdílená navigace PokéTrade
 * =========================================
 * Jak použít na každé stránce:
 *
 *  1) V <head> přidej:
 *       <script>window.TOPBAR_ACTIVE = 'moje-album';</script>
 *       <script src="topbar.js"></script>
 *
 *  2) V HTML místo celého <nav class="nav-lnks">...</nav> dej:
 *       <nav class="nav-lnks" id="mainNav"></nav>
 *
 * Hodnoty TOPBAR_ACTIVE:
 *   'marketplace' | 'moje-album' | 'compare' | 'share' | 'scanner' | 'queue' | 'download'
 *
 * Na compare.html záložka „Sdílet album" přepne tab lokálně (switchTab),
 * na ostatních stránkách odkáže na compare.html.
 */
(function () {
  var PAGES = [
    { href: 'marketplace.html',            icon: 'energi/obchod.png',           label: 'Obchod',              id: 'marketplace' },
    { href: 'moje-album.html',             icon: 'energi/moje alba.png',         label: 'Moje alba',           id: 'moje-album'  },
    { href: 'compare.html',                icon: 'energi/porovnat.png',          label: 'Porovnat alba',       id: 'compare'     },
    { href: 'compare.html',                icon: 'energi/sdilet.png',            label: 'Sdílet album',        id: 'share', shareTab: true },
    { href: 'scanner.html',                icon: 'energi/scanner.png',           label: 'Skener',              id: 'scanner'     },
    { href: 'queue.html',                  icon: 'energi/ceka_na_zarazeni.png',  label: 'Čeká na zařazení',   id: 'queue'       },
    { href: 'download.html',               icon: 'energi/ke_stazeni.png',        label: 'Ke stažení',          id: 'download'    },
  ];

  /* ── Inject nav pill styles globally ── */
  (function injectNavStyle() {
    if (document.getElementById('topbar-nav-style')) return;
    var s = document.createElement('style');
    s.id = 'topbar-nav-style';
    s.textContent = `
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
    `;
    document.head.appendChild(s);
  })();

  function render() {
    var nav = document.getElementById('mainNav');
    if (!nav) return;

    var active    = window.TOPBAR_ACTIVE || '';
    var onCompare = (active === 'compare');

    nav.innerHTML = PAGES.map(function (p) {
      var href  = p.href;
      var extra = '';
      var cls   = (p.id === active) ? ' class="active"' : '';

      if (p.shareTab) {
        if (onCompare) {
          // jsme na compare.html → přepni záložku
          href  = '#';
          extra = ' onclick="if(typeof switchTab===\'function\')switchTab(\'share\');return false"';
          cls   = ''; // „Sdílet album" nemá svůj vlastní active stav na compare
        }
        // Na ostatních stránkách prostě odkáže na compare.html (výchozí tab)
        cls = '';
      }

      return '<a href="' + href + '"' + extra + cls + '>'
           + '<img src="' + p.icon + '" class="nav-icon"> '
           + p.label
           + '</a>';
    }).join('');
  }

  /** Doplní chybějící prvky do .topbar-right (settings, userChip, login/logout) */
  function injectTopbarRight() {
    var tr = document.querySelector('.topbar-right');
    if (!tr) return;

    // Settings tlačítko — přidat pokud chybí
    if (!document.getElementById('settingsBtn')) {
      var settingsWrap = document.createElement('div');
      settingsWrap.style.cssText = 'position:relative;display:flex;align-items:center';
      settingsWrap.innerHTML = '<a href="profile.html" class="chat-icon-btn" title="Nastavení & Profil">'
        + '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<circle cx="12" cy="12" r="3"/>'
        + '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'
        + '</svg></a>';
      // Vložit před userChip nebo na konec
      var ref = document.getElementById('userChip') || document.getElementById('loginLink');
      if (ref) tr.insertBefore(settingsWrap, ref);
      else tr.appendChild(settingsWrap);
    }

    // userChip + login + logout — přidat pokud chybí
    if (!document.getElementById('userChip')) {
      var authHtml = '<a href="profile.html" class="user-chip" id="userChip" style="display:none" title="Můj profil">'
        + '<div class="user-avatar" id="userAvatar">?</div>'
        + '<span id="userName"></span></a>'
        + '<a href="login.html" id="loginLink" class="btn-nav-outline" style="display:none;font-size:13px">Přihlásit se</a>'
        + '<button id="logoutBtn" onclick="if(typeof doLogout==='function')doLogout()" class="btn-nav-outline" style="display:none;font-size:13px;background:transparent;color:rgba(240,236,228,0.65);border:1px solid rgba(255,255,255,0.18);font-family:inherit;-webkit-appearance:none;appearance:none;cursor:pointer">'
        + '<img src="energi/odhlasit_se.png" class="nav-icon"> Odhlásit</button>';
      tr.insertAdjacentHTML('beforeend', authHtml);
    }
  }


  // Spusť hned nebo po DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ render(); injectTopbarRight(); });
  } else {
    render(); injectTopbarRight();
  }
})();
