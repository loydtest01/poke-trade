/**
 * pwa-init.js — Centrální PWA inicializace pro PokéTrade
 * Načítej jako PRVNÍ script v každém HTML souboru.
 * Zajišťuje: service worker, install prompt, standalone detekci.
 */
(function () {
  'use strict';

  /* ── Service Worker registrace ─────────────────────────────── */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then(function (reg) {
          // Tichá registrace

          // ── updatefound → nová verze SW dostupná ─────────────
          reg.addEventListener('updatefound', function () {
            var newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', function () {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                _showSwUpdateBanner();
              }
            });
          });
        })
        .catch(function () { /* SW nedostupný */ });

      // ── Zpráva od SW (SW_UPDATED při aktivaci nové verze) ──────
      navigator.serviceWorker.addEventListener('message', function (e) {
        if (e.data && e.data.type === 'SW_UPDATED') {
          _showSwUpdateBanner();
        }
      });
    });
  }

  /* ── Detekce prostředí ────────────────────────────────────── */
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  var isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  /* ── Standalone mód — přidej třídu na <html> ─────────────── */
  // Umožní CSS přizpůsobení: html.pwa-standalone .element { ... }
  if (isStandalone) {
    document.documentElement.classList.add('pwa-standalone');
  }

  /* ── Install Prompt — Android Chrome ─────────────────────── */
  window._installPrompt = null;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    window._installPrompt = e;
    // Zobraz tlačítka "Přidat na plochu"
    document.querySelectorAll('[data-pwa-install], #chipInstall, .btn-pwa-install')
      .forEach(function (el) { el.style.removeProperty('display'); });
    document.documentElement.classList.add('pwa-installable');
  });

  window.addEventListener('appinstalled', function () {
    window._installPrompt = null;
    document.documentElement.classList.remove('pwa-installable');
    document.documentElement.classList.add('pwa-standalone');
    document.querySelectorAll('[data-pwa-install], #chipInstall, .btn-pwa-install')
      .forEach(function (el) { el.style.display = 'none'; });
    if (typeof toast === 'function') toast('✅ PokéTrade přidán na plochu!');
  });

  /* ── iOS instrukční modal ─────────────────────────────────── */
  function _injectIOSModal() {
    if (document.getElementById('_pwaIOSModal')) return;
    var m = document.createElement('div');
    m.id = '_pwaIOSModal';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-label', 'Přidat na plochu');
    m.style.cssText = [
      'display:none;position:fixed;inset:0;',
      'background:rgba(0,0,0,.78);z-index:99999;',
      'align-items:flex-end;justify-content:center;',
      'padding:0 0 env(safe-area-inset-bottom,0) 0'
    ].join('');
    m.innerHTML = [
      '<div style="background:#1c1a26;border-radius:20px 20px 0 0;',
        'padding:28px 24px 40px;width:100%;max-width:500px;',
        'border-top:1px solid rgba(255,255,255,.1);text-align:center;">',
        '<div style="font-size:32px;margin-bottom:12px">📲</div>',
        '<div style="font-size:18px;font-weight:800;color:#fff;margin-bottom:8px">',
          'Přidat PokéTrade na plochu',
        '</div>',
        '<div style="font-size:14px;color:rgba(255,255,255,.55);line-height:1.7;margin-bottom:24px">',
          'Klepni na <strong style="color:#fff">□↑ Sdílet</strong> (ikona dole ve Safari)<br>',
          'a vyber <strong style="color:#fff">Přidat na plochu</strong>.',
        '</div>',
        '<button onclick="document.getElementById(\'_pwaIOSModal\').style.display=\'none\'"',
          ' style="width:100%;padding:14px;border:none;border-radius:14px;',
          'background:linear-gradient(135deg,#f5c842,#ff8c00);color:#000;',
          'font-size:16px;font-weight:800;cursor:pointer;font-family:inherit;">',
          'Rozumím',
        '</button>',
      '</div>'
    ].join('');
    m.addEventListener('click', function (e) {
      if (e.target === m) m.style.display = 'none';
    });
    document.body.appendChild(m);
  }

  /* ── Globální installPWA() ────────────────────────────────── */
  window.installPWA = function () {
    if (isIOS) {
      var m = document.getElementById('_pwaIOSModal');
      if (m) m.style.display = 'flex';
      return;
    }
    if (window._installPrompt) {
      window._installPrompt.prompt();
      window._installPrompt.userChoice.then(function (r) {
        if (r.outcome === 'accepted') {
          if (typeof toast === 'function') toast('✅ Přidáno na plochu!');
        }
        window._installPrompt = null;
      });
    } else {
      if (typeof toast === 'function') toast('Otevři stránku v Chrome a zkus znovu', 'info');
    }
  };

  /* ── Init po DOMContentLoaded ─────────────────────────────── */
  function _init() {
    _injectIOSModal();

    // Na iOS zobraz install tlačítko hned (prompt nikdy nepřijde)
    if (isIOS && !isStandalone) {
      document.querySelectorAll('[data-pwa-install], #chipInstall, .btn-pwa-install')
        .forEach(function (el) { el.style.removeProperty('display'); });
    }

    // Pokud jsme ve standalone, schovej install tlačítka
    if (isStandalone) {
      document.querySelectorAll('[data-pwa-install], #chipInstall, .btn-pwa-install')
        .forEach(function (el) { el.style.display = 'none'; });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

  /* ── SW Update Banner ─────────────────────────────────────── */
  var _swBannerShown = false;
  function _showSwUpdateBanner() {
    if (_swBannerShown) return;
    _swBannerShown = true;
    var banner = document.createElement('div');
    banner.id  = '_sw-update-banner';
    banner.style.cssText = [
      'position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);',
      'background:#1a1424;border:1px solid rgba(245,200,66,.35);',
      'border-radius:12px;padding:.7rem 1.2rem;z-index:99999;',
      'display:flex;align-items:center;gap:.8rem;',
      'box-shadow:0 8px 32px rgba(0,0,0,.5);',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
      'font-size:.84rem;color:#f0ece4;max-width:calc(100vw - 2rem);'
    ].join('');
    banner.innerHTML = [
      '<span>🚀 Nová verze PokéTrade je připravena</span>',
      '<button id="_sw-update-btn" style="',
        'background:rgba(245,200,66,.18);border:1px solid rgba(245,200,66,.4);',
        'color:#f5c842;border-radius:8px;padding:.35rem .9rem;cursor:pointer;',
        'font-size:.82rem;font-weight:600;white-space:nowrap;',
      '">Aktualizovat</button>',
      '<button id="_sw-dismiss-btn" style="',
        'background:none;border:none;color:rgba(240,236,228,.4);',
        'cursor:pointer;font-size:1rem;padding:0 .2rem;',
      '">✕</button>',
    ].join('');
    document.body.appendChild(banner);
    document.getElementById('_sw-update-btn').onclick = function () {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
      }
      window.location.reload();
    };
    document.getElementById('_sw-dismiss-btn').onclick = function () {
      banner.remove();
    };
    setTimeout(function () { if (banner.parentNode) banner.remove(); }, 30000);
  }
  window.showUpdateToast = _showSwUpdateBanner;

})();
