/**
 * i18n.js — PokéTrade lokalizační engine
 * ========================================
 * Jak přidat nový text:
 *   1. Přidej klíč do locales/cs.json  →  "muj.klic": "Český text"
 *   2. Přidej překlad do locales/en.json →  "muj.klic": "English text"
 *   3. V HTML použij:  <span data-i18n="muj.klic"></span>
 *      nebo v JS:       t('muj.klic', 'Fallback text')
 *
 * Nic jiného není potřeba. Obnovením stránky se změna projeví.
 * ========================================
 */
(function () {
'use strict';

var SUPPORTED = ['cs', 'en', 'de', 'jp', 'fr', 'it', 'es'];
var DEFAULT   = 'cs';
var STORAGE_KEY = 'pt_lang';

/* ── Aktivní jazyk ── */
var _lang    = localStorage.getItem(STORAGE_KEY) || DEFAULT;
var _strings = {};
var _ready   = false;
var _queue   = [];

/* ── Načtení JSON souboru ── */
function loadLocale(lang, cb) {
  // cache: 'no-store' → vždy načte aktuální verzi souboru
  fetch('locales/' + lang + '.json', { cache: 'no-store' })
    .then(function(r) {
      if (!r.ok) throw new Error('Locale ' + lang + ' not found');
      return r.json();
    })
    .then(function(data) {
      _strings = data;
      _ready = true;
      cb && cb();
    })
    .catch(function(err) {
      console.warn('[i18n] ' + err.message + '. Falling back to keys.');
      _strings = {};
      _ready = true;
      cb && cb();
    });
}

/* ── Přeložit klíč ──────────────────────────────────────────
 *  t('offer.sell')              → "💰 Prodej" / "💰 Sell"
 *  t('offer.sell', 'Prodej')    → fallback pokud klíč chybí
 *  ──────────────────────────────────────────────────────── */
function t(key, fallback) {
  if (_strings[key] !== undefined) return _strings[key];
  return (fallback !== undefined) ? fallback : key;
}

/* ── Přeložit všechny [data-i18n] elementy v kontejneru ── */
function applyToNode(root) {
  var els = (root || document).querySelectorAll('[data-i18n]');
  for (var i = 0; i < els.length; i++) {
    var el  = els[i];
    var key = el.getAttribute('data-i18n');
    var val = t(key);
    if (val === key) continue; // klíč nenalezen, nechej jak je

    var attr = el.getAttribute('data-i18n-attr');
    if (attr) {
      // Přeložit atribut (placeholder, title, aria-label…)
      el.setAttribute(attr, val);
    } else if (el.children.length === 0) {
      // Leaf element — bezpečně přepsat text
      el.textContent = val;
    } else {
      // Element má child elementy — najdi první textový uzel a přepiš jen ten
      var replaced = false;
      for (var j = 0; j < el.childNodes.length; j++) {
        var node = el.childNodes[j];
        if (node.nodeType === 3 && node.textContent.trim() !== '') {
          node.textContent = val;
          replaced = true;
          break;
        }
      }
      // Pokud žádný textový uzel nenašel, vlož před první child
      if (!replaced) {
        el.insertBefore(document.createTextNode(val), el.firstChild);
      }
    }
  }
}

/* ── MutationObserver — přeloží i dynamicky přidané elementy ── */
var _observer = null;
function startObserver() {
  if (_observer || typeof MutationObserver === 'undefined') return;
  _observer = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var added = mutations[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var node = added[j];
        if (node.nodeType === 1) {  // ELEMENT_NODE
          if (node.hasAttribute && node.hasAttribute('data-i18n')) applyToNode(node.parentNode);
          else if (node.querySelector) applyToNode(node);
        }
      }
    }
  });
  _observer.observe(document.body, { childList: true, subtree: true });
}

/* ── Změna jazyka ── */
function setLang(lang) {
  if (!SUPPORTED.includes(lang)) {
    console.warn('[i18n] Nepodporovaný jazyk: ' + lang);
    return;
  }
  localStorage.setItem(STORAGE_KEY, lang);
  location.reload();
}

/* ── Spuštění po načtení DOM ── */
function onReady(fn) {
  if (_ready) { fn(); return; }
  _queue.push(fn);
}

/* ── Veřejné API ── */
window.t = t;
window.setLang = setLang;            // alias pro topbar.js
window.getLang = function() { return _lang; };
window.i18n = {
  get lang() { return _lang; },
  get ready() { return _ready; },
  setLang:  setLang,
  apply:    applyToNode,
  onReady:  onReady,
  supported: SUPPORTED
};

/* ── Init ── */
loadLocale(_lang, function() {
  // Přeložit statické elementy hned jak je DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      applyToNode(document);
      startObserver();
      _queue.forEach(function(fn) { fn(); });
      _queue = [];
      document.dispatchEvent(new Event('i18n:ready'));
    });
  } else {
    applyToNode(document);
    startObserver();
    _queue.forEach(function(fn) { fn(); });
    _queue = [];
    document.dispatchEvent(new Event('i18n:ready'));
  }
});

})();
