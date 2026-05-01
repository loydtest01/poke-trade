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
          // Tichá registrace — žádný console.log v produkci
          reg.addEventListener('updatefound', function () {
            var newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', function () {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // Nová verze dostupná — volitelně informuj uživatele
                if (typeof window.showUpdateToast === 'function') {
                  window.showUpdateToast();
                }
              }
            });
          });
        })
        .catch(function () { /* SW nedostupný — app funguje bez něj */ });
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
})();
