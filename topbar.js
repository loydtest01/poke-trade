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

  // Spusť hned nebo po DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})();
