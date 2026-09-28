/* ══════════════════════════════════════════════════════════════
   PokéTrade — centrální log z prohlížeče
   ------------------------------------------------------------
   Načítá se na všech stránkách přes topbar.js. Zachytává:
     • chyby JavaScriptu a neošetřené chyby v async kódu
     • neúspěšné dotazy fetch (stav, doba, adresa)
     • console.error / console.warn
     • nenačtené skripty a styly
     • události aplikace přes window.PTLog.udalost(...)
   a posílá je v dávkách do Supabase (tabulka client_logs).

   Adminům loguje vše, ostatním uživatelům jen chyby.
   Tokeny, klíče a e-maily se před uložením vymažou.
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.PTLog) return;

  var VERZE_LOGGERU = '1.1';
  var SBU = 'https://xrduqwrinzvmpixgmqta.supabase.co';
  var SBA = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyZHVxd3Jpbnp2bXBpeGdtcXRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDI0MjksImV4cCI6MjA5MDk3ODQyOX0.2p404Vy77CH_MsvQlnpxaO0H-KlSSt_oJlaFrmttFXs';
  var CIL = '/rest/v1/client_logs';

  var puvodniFetch = window.fetch ? window.fetch.bind(window) : null;
  var puvodniError = console.error, puvodniWarn = console.warn;
  var relace = Math.random().toString(36).slice(2, 10);
  var fronta = [];
  var casovac = null;
  var pamet = [];            // posledních 300 záznamů v paměti (PTLog.posledni)
  var nenactenychObrazku = 0;
  var odesilam = false;

  /* ── Kdo je přihlášený a jestli je admin ─────────────────── */
  function email() {
    try {
      var d = localStorage.getItem('sb_email');
      if (d && d.indexOf('@') > 0) return d.toLowerCase();
      var u = JSON.parse(localStorage.getItem('sb_user') || 'null');
      var e = u && (u.email || (u.user_metadata && u.user_metadata.email)) || '';
      return e.toLowerCase();
    } catch (_) { return ''; }
  }
  /* Podrobný log na tomhle zařízení — zapne se jednou adresou
     ?logvse=1 (a vypne ?logvse=0). Hodí se na telefonu, kde se admin
     jinak nepozná: mobil se přihlašuje tokenem z QR kódu a topbar.js,
     který admina určuje, tam neběží. Čtení logů zůstává jen pro admina. */
  try {
    var pq = new URLSearchParams(location.search).get('logvse');
    if (pq === '1') localStorage.setItem('pt_log_vse', '1');
    if (pq === '0') localStorage.removeItem('pt_log_vse');
  } catch (_) {}

  function jeAdmin() {
    try {
      if (localStorage.getItem('pt_log_vse') === '1') return true;
      if (typeof window._isAdmin === 'function' && window._isAdmin()) return true;   // helper z topbar.js
      if (localStorage.getItem('pkc_is_admin') === '1') return true;
      var seznam = window._ADMIN_EMAILS || [];
      var e = email();
      return !!e && seznam.indexOf(e) !== -1;
    } catch (_) { return false; }
  }
  function token() {
    // Stránka může token předat sama (mobil ho má z QR kódu)
    if (window.PT_LOG_TOKEN) return window.PT_LOG_TOKEN;
    try { return localStorage.getItem('sb_token') || localStorage.getItem('sb_access_token') || ''; }
    catch (_) { return ''; }
  }

  /* ── Vymazání citlivých údajů ─────────────────────────────── */
  function zacisti(t) {
    if (t == null) return '';
    var s = String(t);
    return s
      // parametry v adresách: ?t=…, &token=…, api_key=… atd.
      .replace(/([?&](?:t|token|access_token|refresh_token|api_key|apikey|key|jwt|code|secret)=)[^&#\s"'<>]+/gi, '$1[skryto]')
      // JWT (Supabase tokeny)
      .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, '[jwt]')
      // API klíče poskytovatelů AI
      .replace(/\bgsk_[A-Za-z0-9]{12,}/g, '[groq-klic]')
      .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, '[google-klic]')
      .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, '[klic]')
      .replace(/\bcsk-[A-Za-z0-9]{12,}/g, '[cerebras-klic]')
      // Bearer hlavičky
      .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/gi, 'Bearer [skryto]')
      // e-maily: ponechat první znak a doménu
      .replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, '$1***@$2');
  }
  function kratce(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; }

  function adresa(u) {
    try {
      var x = new URL(u, location.href);
      var zaklad = x.origin === location.origin ? x.pathname : x.origin + x.pathname;
      return kratce(zacisti(zaklad + x.search), 300);
    } catch (_) { return kratce(zacisti(u), 300); }
  }

  function doTextu(v) {
    if (v instanceof Error) return v.message + (v.stack ? '\n' + v.stack.split('\n').slice(1, 4).join('\n') : '');
    if (typeof v === 'object' && v !== null) {
      try { return JSON.stringify(v).slice(0, 600); } catch (_) { return String(v); }
    }
    return String(v);
  }

  /* ── Zápis do fronty ──────────────────────────────────────── */
  function zapis(uroven, kategorie, zprava, detail) {
    try {
      var admin = jeAdmin();
      // Běžným uživatelům jen chyby — ať se neukládá jejich běžné procházení
      if (!admin && uroven !== 'error') return;

      var z = kratce(zacisti(zprava), 2000);
      var zaznam = {
        uroven: uroven,
        kategorie: kratce(kategorie, 40),
        zprava: z,
        detail: detail ? JSON.parse(zacisti(JSON.stringify(detail)).slice(0, 7000) || 'null') : null,
        stranka: kratce(zacisti(location.pathname + location.search), 300),
        session_id: relace,
        ua: kratce(navigator.userAgent, 300),
        opakovani: 1,
      };

      pamet.push(new Date().toLocaleTimeString('cs-CZ') + ' ' + uroven.toUpperCase() + ' [' + kategorie + '] ' + z);
      if (pamet.length > 300) pamet.shift();

      // Stejná zpráva ještě neodeslaná → jen zvýšit počítadlo
      for (var i = 0; i < fronta.length; i++) {
        var f = fronta[i];
        if (f.uroven === zaznam.uroven && f.kategorie === zaznam.kategorie && f.zprava === zaznam.zprava) {
          f.opakovani++; return;
        }
      }
      fronta.push(zaznam);
      if (fronta.length >= 20) odesli(false);
      else if (!casovac) casovac = setTimeout(function () { casovac = null; odesli(false); }, 5000);
    } catch (_) { /* logger nesmí nikdy shodit stránku */ }
  }

  /* ── Odeslání dávky ───────────────────────────────────────── */
  function odesli(pripojit) {
    if (!puvodniFetch || !fronta.length || odesilam) return;
    var davka = fronta.splice(0, pripojit ? 20 : 50);  // keepalive má limit velikosti
    odesilam = true;
    var tok = token();
    var posli = function (autorizace) {
      return puvodniFetch(SBU + CIL, {
        method: 'POST',
        keepalive: !!pripojit,
        headers: {
          apikey: SBA,
          Authorization: 'Bearer ' + autorizace,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(davka),
      });
    };
    posli(tok || SBA)
      .then(function (r) {
        // Prošlý token → pošli anonymně, ať se log neztratí
        if (r.status === 401 && tok) return posli(SBA);
        return r;
      })
      .catch(function () { /* bez sítě log zahodíme, jinak by se kupil */ })
      .then(function () {
        odesilam = false;
        if (fronta.length && !casovac) casovac = setTimeout(function () { casovac = null; odesli(false); }, 2000);
      });
  }

  /* ── Zachycení chyb JavaScriptu a nenačtených zdrojů ─────── */
  window.addEventListener('error', function (e) {
    var cil = e && e.target;
    if (cil && cil !== window && (cil.src || cil.href)) {
      var tag = (cil.tagName || '').toLowerCase();
      // Obrázky karet selhávají běžně (záloha → zadní strana) — jen počítat
      if (tag === 'img') { nenactenychObrazku++; return; }
      zapis('error', 'zdroj', 'Nenačteno <' + tag + '>: ' + adresa(cil.src || cil.href));
      return;
    }
    zapis('error', 'js', (e && e.message) || 'neznámá chyba', {
      soubor: e && e.filename ? adresa(e.filename) : null,
      radek: e && e.lineno, sloupec: e && e.colno,
      stack: e && e.error && e.error.stack ? String(e.error.stack).split('\n').slice(0, 6).join('\n') : null,
    });
  }, true);

  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    zapis('error', 'promise', r && r.message ? r.message : doTextu(r), {
      stack: r && r.stack ? String(r.stack).split('\n').slice(0, 6).join('\n') : null,
    });
  });

  /* ── Konzole ──────────────────────────────────────────────── */
  console.error = function () {
    try { zapis('error', 'konzole', Array.prototype.map.call(arguments, doTextu).join(' ')); } catch (_) {}
    return puvodniError.apply(console, arguments);
  };
  console.warn = function () {
    try { zapis('warn', 'konzole', Array.prototype.map.call(arguments, doTextu).join(' ')); } catch (_) {}
    return puvodniWarn.apply(console, arguments);
  };

  /* ── fetch: neúspěšné a pomalé dotazy ────────────────────── */
  if (puvodniFetch) {
    window.fetch = function (vstup, nastaveni) {
      var url = typeof vstup === 'string' ? vstup : (vstup && vstup.url) || '';
      var metoda = ((nastaveni && nastaveni.method) || (vstup && vstup.method) || 'GET').toUpperCase();
      if (url.indexOf(CIL) !== -1) return puvodniFetch(vstup, nastaveni);   // vlastní odesílání nelogovat
      var t0 = performance.now();
      return puvodniFetch(vstup, nastaveni).then(function (r) {
        var ms = Math.round(performance.now() - t0);
        if (!r.ok) {
          zapis(r.status >= 500 ? 'error' : 'warn', 'fetch',
            'HTTP ' + r.status + ' ' + metoda + ' ' + adresa(url), { ms: ms, status: r.status });
        } else if (ms > 4000) {
          zapis('info', 'fetch', 'pomalý dotaz ' + ms + ' ms: ' + metoda + ' ' + adresa(url), { ms: ms });
        }
        return r;
      }, function (err) {
        if (!err || err.name !== 'AbortError') {
          zapis('error', 'fetch', 'síťová chyba ' + metoda + ' ' + adresa(url) + ': ' + (err && err.message),
            { ms: Math.round(performance.now() - t0) });
        }
        throw err;
      });
    };
  }

  /* ── Otevření stránky a odchod (jen admin) ───────────────── */
  window.addEventListener('load', function () {
    setTimeout(function () {
      var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
      zapis('info', 'stranka', 'otevřeno ' + location.pathname,
        { nacteni_ms: nav ? Math.round(nav.loadEventEnd || nav.duration) : null, logger: VERZE_LOGGERU });
    }, 0);
  });

  function priOdchodu() {
    if (nenactenychObrazku) {
      zapis('info', 'obrazky', 'na stránce se nenačetlo ' + nenactenychObrazku +
        ' obrázků (u karet bez obrázku je to normální — nahradí je zadní strana)');
      nenactenychObrazku = 0;
    }
    odesli(true);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') priOdchodu();
  });
  window.addEventListener('pagehide', priOdchodu);

  /* ── Veřejné rozhraní ─────────────────────────────────────── */
  window.PTLog = {
    verze: VERZE_LOGGERU,
    error:   function (kat, zprava, detail) { zapis('error', kat, zprava, detail); },
    warn:    function (kat, zprava, detail) { zapis('warn',  kat, zprava, detail); },
    info:    function (kat, zprava, detail) { zapis('info',  kat, zprava, detail); },
    udalost: function (kat, zprava, detail) { zapis('info',  kat, zprava, detail); },
    odeslat: function () { odesli(false); },
    posledni: function () { return pamet.slice(); },   // v konzoli: PTLog.posledni()
  };
})();
