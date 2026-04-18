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
    { href: 'marketplace.html?my=1',       icon: 'energi/obchod.png',           label: 'Správa inzerátů',     id: 'my-listings' },
    { href: 'transactions.html',           icon: 'energi/obchod.png',           label: 'Transakce',            id: 'transactions'},
  ];

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
