/* ══════════════════════════════════════════════════════════════
   QR BRIDGE – trvalý panel vpravo dole na všech stránkách
   ------------------------------------------------------------
   • Vygeneruje QR kód na mobile.html (mobilní appka pro focení)
   • Dá se minimalizovat na malou bublinu; stav si pamatuje
   • Na mobilu QR nezobrazuje (nemá smysl skenovat vlastní displej)
     → místo něj přímé tlačítko "Otevřít v mobilní aplikaci"
   • Nezobrazuje se na mobile.html a scanner.html (tam už QR je)

   Použití: <script src="qr-bridge.js" defer></script>
            nebo se načte automaticky z topbar.js
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var LS_STATE   = 'pkc_qrbridge_state';   // 'open' | 'min' | 'hidden'
  var LS_QRCDN   = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
  var SKIP_PAGES = ['mobile.html', 'scanner.html', 'login.html', 'register.html'];

  /* ── Na kterých stránkách vůbec neběžet ─────────────────── */
  var page = location.pathname.split('/').pop() || 'index.html';
  if (SKIP_PAGES.indexOf(page) !== -1) return;
  if (document.getElementById('qrBridge')) return;   // už běží

  /* ── URL mobilní aplikace ───────────────────────────────── */
  function mobileUrl() {
    var dir = location.pathname.substring(0, location.pathname.lastIndexOf('/') + 1);
    return location.origin + dir + 'mobile.html';
  }

  var isMobile = window.matchMedia('(max-width: 700px)').matches;
  var state    = localStorage.getItem(LS_STATE) || 'open';
  if (state === 'hidden') return;

  /* ── Styly ──────────────────────────────────────────────── */
  var css = document.createElement('style');
  css.textContent = [
    '#qrBridge{position:fixed;right:18px;bottom:18px;z-index:9500;font-family:inherit;',
    '  transition:transform .18s ease,opacity .18s ease}',
    '#qrBridge.qrb-hidden{opacity:0;pointer-events:none;transform:translateY(8px)}',

    '.qrb-card{width:250px;background:#1c1915;border:1px solid rgba(245,200,66,.28);',
    '  border-radius:16px;padding:16px;box-shadow:0 10px 34px rgba(0,0,0,.55)}',

    '.qrb-head{display:flex;align-items:flex-start;gap:8px;margin-bottom:10px}',
    '.qrb-title{flex:1;min-width:0;font-size:13px;font-weight:600;color:#f0ece4;line-height:1.35}',
    '.qrb-min{background:none;border:none;color:rgba(240,236,228,.45);font-size:18px;',
    '  cursor:pointer;line-height:1;padding:0 2px;flex-shrink:0}',
    '.qrb-min:hover{color:#f5c842}',

    '.qrb-sub{font-size:11.5px;line-height:1.5;color:rgba(240,236,228,.5);margin-bottom:12px}',

    '.qrb-qr{background:#fff;border-radius:10px;padding:8px;display:flex;',
    '  align-items:center;justify-content:center;min-height:150px;cursor:pointer}',
    '.qrb-qr img,.qrb-qr canvas{display:block;width:134px;height:134px}',

    '.qrb-hint{text-align:center;font-size:10.5px;color:rgba(240,236,228,.38);margin-top:9px}',
    '.qrb-link{display:block;width:100%;margin-top:10px;background:#f5c842;color:#1a1712;',
    '  border:none;border-radius:9px;padding:10px;font-size:12.5px;font-weight:600;',
    '  cursor:pointer;text-align:center;text-decoration:none;font-family:inherit}',
    '.qrb-copy{display:block;width:100%;margin-top:6px;background:transparent;',
    '  color:rgba(240,236,228,.55);border:1px solid rgba(255,255,255,.14);border-radius:9px;',
    '  padding:8px;font-size:11.5px;cursor:pointer;font-family:inherit}',
    '.qrb-copy:hover{color:#f5c842;border-color:rgba(245,200,66,.4)}',

    '.qrb-bubble{display:flex;align-items:center;gap:8px;background:#1c1915;',
    '  border:1px solid rgba(245,200,66,.28);border-radius:999px;padding:10px 16px 10px 13px;',
    '  box-shadow:0 6px 22px rgba(0,0,0,.5);cursor:pointer;color:#f0ece4;font-size:12.5px;',
    '  font-weight:600;white-space:nowrap}',
    '.qrb-bubble:hover{border-color:rgba(245,200,66,.6)}',
    '.qrb-bubble span.ic{font-size:17px;line-height:1}',

    '@media(max-width:700px){#qrBridge{right:12px;bottom:76px}.qrb-card{width:min(88vw,270px)}}',
    '@media print{#qrBridge{display:none}}'
  ].join('');
  document.head.appendChild(css);

  /* ── Kostra ─────────────────────────────────────────────── */
  var root = document.createElement('div');
  root.id = 'qrBridge';
  document.body.appendChild(root);

  function renderMinimized() {
    root.innerHTML =
      '<div class="qrb-bubble" id="qrbOpen" title="Nahrát kartičky z mobilu">' +
        '<span class="ic">📱</span><span>Nahrát z mobilu</span>' +
      '</div>';
    document.getElementById('qrbOpen').onclick = function () { setState('open'); };
  }

  function renderOpen() {
    var url = mobileUrl();

    if (isMobile) {
      // Na telefonu QR nedává smysl – rovnou odkaz
      root.innerHTML =
        '<div class="qrb-card">' +
          '<div class="qrb-head">' +
            '<div class="qrb-title">📱 Nahraj kartičky z mobilu</div>' +
            '<button class="qrb-min" id="qrbMin" title="Minimalizovat">−</button>' +
          '</div>' +
          '<div class="qrb-sub">Vyfoť kartu a AI z fotky sama pozná jméno, sadu, číslo i cenu.</div>' +
          '<a class="qrb-link" href="' + url + '">Otevřít mobilní aplikaci →</a>' +
        '</div>';
    } else {
      root.innerHTML =
        '<div class="qrb-card">' +
          '<div class="qrb-head">' +
            '<div class="qrb-title">📱 Nahraj kartičky z mobilu<br>' +
              '<span style="font-weight:400;font-size:11.5px;color:rgba(240,236,228,.5)">Naskenuj kód telefonem</span>' +
            '</div>' +
            '<button class="qrb-min" id="qrbMin" title="Minimalizovat">−</button>' +
          '</div>' +
          '<div class="qrb-qr" id="qrbCode" title="Klikni pro zvětšení">…</div>' +
          '<div class="qrb-hint">Vyfoť kartu → objeví se ti tady</div>' +
          '<button class="qrb-copy" id="qrbCopy">📋 Zkopírovat odkaz</button>' +
        '</div>';
    }

    var minBtn = document.getElementById('qrbMin');
    if (minBtn) minBtn.onclick = function () { setState('min'); };

    var copyBtn = document.getElementById('qrbCopy');
    if (copyBtn) copyBtn.onclick = function () { copyUrl(url, copyBtn); };

    if (!isMobile) drawQr(url);
  }

  /* ── QR generování (qrcodejs, načte se z CDN jen jednou) ─── */
  function drawQr(url) {
    var box = document.getElementById('qrbCode');
    if (!box) return;

    function paint() {
      box.innerHTML = '';
      try {
        new window.QRCode(box, {
          text: url, width: 134, height: 134,
          colorDark: '#000000', colorLight: '#ffffff',
          correctLevel: window.QRCode.CorrectLevel.M
        });
        box.onclick = function () { enlarge(url); };
      } catch (e) {
        box.innerHTML = '<span style="font-size:11px;color:#888">QR se nepodařilo vytvořit</span>';
      }
    }

    if (window.QRCode) { paint(); return; }

    var s = document.querySelector('script[data-qrb-lib]');
    if (!s) {
      s = document.createElement('script');
      s.src = LS_QRCDN;
      s.setAttribute('data-qrb-lib', '1');
      document.head.appendChild(s);
    }
    s.addEventListener('load', paint);
    s.addEventListener('error', function () {
      box.innerHTML = '<a href="' + url + '" style="font-size:11px;color:#333">Otevřít odkaz</a>';
    });
  }

  /* ── Zvětšený QR přes celou obrazovku ───────────────────── */
  function enlarge(url) {
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:9600;background:rgba(0,0,0,.82);' +
      'display:flex;align-items:center;justify-content:center;padding:24px';
    ov.innerHTML = '<div style="background:#fff;padding:20px;border-radius:18px;text-align:center">' +
      '<div id="qrbBig"></div>' +
      '<div style="margin-top:10px;font-size:12px;color:#444">Naskenuj telefonem</div></div>';
    ov.onclick = function () { ov.remove(); };
    document.body.appendChild(ov);
    try {
      new window.QRCode(document.getElementById('qrbBig'), {
        text: url, width: 260, height: 260,
        colorDark: '#000000', colorLight: '#ffffff',
        correctLevel: window.QRCode.CorrectLevel.M
      });
    } catch (e) { /* tiše */ }
  }

  /* ── Kopírování odkazu ──────────────────────────────────── */
  function copyUrl(url, btn) {
    var done = function () {
      var old = btn.textContent;
      btn.textContent = '✅ Zkopírováno';
      setTimeout(function () { btn.textContent = old; }, 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(fallback);
    } else { fallback(); }

    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = url;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* tiše */ }
      document.body.removeChild(ta);
    }
  }

  /* ── Přepínání stavu ────────────────────────────────────── */
  function setState(next) {
    state = next;
    localStorage.setItem(LS_STATE, next);
    root.classList.add('qrb-hidden');
    setTimeout(function () {
      if (next === 'min') renderMinimized(); else renderOpen();
      root.classList.remove('qrb-hidden');
    }, 160);
  }

  /* Veřejné API – např. pro tlačítko "Skrýt napořád" v Nastavení */
  window.qrBridge = {
    show:  function () { localStorage.setItem(LS_STATE, 'open'); location.reload(); },
    hide:  function () { localStorage.setItem(LS_STATE, 'hidden'); root.remove(); },
    state: function () { return state; }
  };

  /* ── Start ──────────────────────────────────────────────── */
  if (state === 'min') renderMinimized(); else renderOpen();
})();
