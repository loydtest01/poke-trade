/**
 * card-images.js — Multi-source Pokémon card image loader
 * =========================================================
 * Pokud primární URL obrázku selže, automaticky zkouší alternativní
 * zdroje (pokemontcg.io, TCGdex, Limitless) paralelně.
 *
 * Použití:
 *   <script src="card-images.js"></script>
 *   <img data-card-src="sv3-125" data-card-name="Charizard ex"
 *        data-set-id="sv3" data-number="125"
 *        src="placeholder.png" onload="CardImages.load(this)">
 *
 *   Nebo z JS:
 *   const url = await CardImages.resolve(card); // card = { image_url, set_id, number }
 *   img.src = url;
 */
(function (window) {
'use strict';

/* ── Konfigurace zdrojů ─────────────────────────────────── */
var SOURCES = {
  /* pokemontcg.io CDN — EN karty */
  pokemontcg: function (setId, number) {
    if (!setId || !number) return null;
    var s = (setId || '').toLowerCase().replace(/\s+/g, '');
    var n = (number || '').replace(/\//g, '-');
    return [
      'https://images.pokemontcg.io/' + s + '/' + n + '_hires.png',
      'https://images.pokemontcg.io/' + s + '/' + n + '.png',
    ];
  },

  /* TCGdex CDN — všechny jazyky */
  tcgdex: function (setId, number, lang) {
    if (!setId || !number) return null;
    var s = (setId || '').toLowerCase().replace(/-/g, '/');
    var n = (number || '').split('/')[0];
    var l = lang || 'en';
    var urls = [];
    // Nejdřív zkus v daném jazyce
    if (l !== 'en') {
      urls.push('https://assets.tcgdex.net/' + l + '/' + s + '/' + n + '/high.webp');
    }
    // Pak v angličtině (většina karet existuje i v EN)
    urls.push('https://assets.tcgdex.net/en/' + s + '/' + n + '/high.webp');
    urls.push('https://assets.tcgdex.net/en/' + s + '/' + n + '/high.png');
    return urls;
  },

  /* Limitless TCG CDN */
  limitless: function (setId, number) {
    if (!setId || !number) return null;
    var n = (number || '').split('/')[0];
    return [
      'https://limitlesstcg.s3.amazonaws.com/cards/' + (setId || '') + '/' + n + '.png',
    ];
  },
};

/* ── Cache úspěšných URL ────────────────────────────────── */
var _cache = {};
try {
  var stored = JSON.parse(localStorage.getItem('pkc_img_cache_v1') || '{}');
  // Starší než 7 dní zahodíme
  var week = 7 * 24 * 3600 * 1000;
  Object.keys(stored).forEach(function (k) {
    if (stored[k] && stored[k].ts && (Date.now() - stored[k].ts < week)) {
      _cache[k] = stored[k].url;
    }
  });
} catch (e) {}

function _saveCache() {
  try {
    var obj = {};
    Object.keys(_cache).forEach(function (k) { obj[k] = { url: _cache[k], ts: Date.now() }; });
    localStorage.setItem('pkc_img_cache_v1', JSON.stringify(obj));
  } catch (e) {}
}

/* ── Placeholder SVG (šedý obrys karty) ─────────────────── */
var PLACEHOLDER = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="279" viewBox="0 0 200 279"><rect width="200" height="279" rx="14" fill="%23201830"/><rect x="10" y="10" width="180" height="259" rx="10" fill="none" stroke="%23ffffff14" stroke-width="1"/><text x="100" y="145" font-family="sans-serif" font-size="36" fill="%23ffffff18" text-anchor="middle">🎴</text></svg>';

/* ── Zkus načíst URL (Promise<string|null>) ─────────────── */
function _tryUrl(url) {
  return new Promise(function (resolve) {
    var img = new Image();
    var done = false;
    img.onload = function () { if (!done) { done = true; resolve(url); } };
    img.onerror = function () { if (!done) { done = true; resolve(null); } };
    setTimeout(function () { if (!done) { done = true; resolve(null); img.src = ''; } }, 5000);
    img.src = url;
  });
}

/* ── Sesbírá všechny možné URL pro kartu ────────────────── */
function _buildUrls(card) {
  var urls = [];
  if (card.image_url)       urls.push(card.image_url);
  if (card.image_hires_url) urls.push(card.image_hires_url);
  if (card.image_thumb_url) urls.push(card.image_thumb_url);

  var sid = card.set_id || '';
  var num = card.number || '';

  // pokemontcg.io
  var ptcg = SOURCES.pokemontcg(sid, num);
  if (ptcg) urls = urls.concat(ptcg);

  // TCGdex (s jazykem pokud je k dispozici)
  var tcd = SOURCES.tcgdex(sid, num, card.lang);
  if (tcd) urls = urls.concat(tcd);

  // Limitless
  var lim = SOURCES.limitless(sid, num);
  if (lim) urls = urls.concat(lim);

  // Deduplicate
  var seen = {};
  return urls.filter(function (u) {
    if (!u || seen[u]) return false;
    seen[u] = true;
    return true;
  });
}

/* ── Hlavní funkce: resolve(card) → URL ─────────────────── */
/**
 * @param {Object} card  { id?, image_url?, image_hires_url?, set_id, number }
 * @returns {Promise<string>}  URL obrázku (nikdy nerejectuje, fallback = placeholder)
 */
function resolve(card) {
  var cacheKey = card.id || (card.set_id + '-' + card.number);

  // 1. Cache hit
  if (cacheKey && _cache[cacheKey]) {
    return Promise.resolve(_cache[cacheKey]);
  }

  var urls = _buildUrls(card);
  if (!urls.length) return Promise.resolve(PLACEHOLDER);

  // 2. Zkouší URL postupně (první primární, pak alternativy)
  // Primární (první 2) zkouší paralelně pro rychlost
  var primary = urls.slice(0, 2);
  var fallbacks = urls.slice(2);

  return Promise.all(primary.map(_tryUrl)).then(function (results) {
    var found = results.find(function (r) { return r !== null; });
    if (found) {
      if (cacheKey) { _cache[cacheKey] = found; _saveCache(); }
      return found;
    }
    // Žádná paralela neprošla — zkus zálohy
    // Zkoušet zálohy postupně
    return _tryFallbacks(fallbacks, cacheKey);
  });
}

function _tryFallbacks(urls, cacheKey) {
  if (!urls.length) return Promise.resolve(PLACEHOLDER);
  return _tryUrl(urls[0]).then(function (result) {
    if (result) {
      if (cacheKey) { _cache[cacheKey] = result; _saveCache(); }
      return result;
    }
    return _tryFallbacks(urls.slice(1), cacheKey);
  });
}

/* ── Lazy loading pro img elementy ──────────────────────── */
/**
 * Volej jako: <img data-card='{"id":"sv3-125","set_id":"sv3","number":"125",...}'
 *                  src="placeholder" class="pki-lazy">
 * Pak: CardImages.initLazy();
 */
var _observer = null;

function _loadImgEl(img) {
  var cardData;
  try { cardData = JSON.parse(img.dataset.card || '{}'); } catch (e) { cardData = {}; }

  // Alternativně z data atributů
  if (!cardData.set_id) {
    cardData.set_id  = img.dataset.setId  || img.dataset.cardSet || '';
    cardData.number  = img.dataset.number || img.dataset.cardNum || '';
    cardData.id      = img.dataset.cardId || (cardData.set_id + '-' + cardData.number);
    cardData.image_url       = img.dataset.imgUrl       || null;
    cardData.image_hires_url = img.dataset.imgHiresUrl  || null;
    cardData.image_thumb_url = img.dataset.imgThumbUrl  || null;
  }

  if (img.dataset.loaded) return;
  img.dataset.loaded = '1';

  resolve(cardData).then(function (url) {
    if (url !== img.src) {
      img.src = url;
    }
  });
}

function initLazy() {
  var imgs = document.querySelectorAll('img.pki-lazy:not([data-loaded])');

  if ('IntersectionObserver' in window) {
    if (_observer) _observer.disconnect();
    _observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          _loadImgEl(e.target);
          _observer.unobserve(e.target);
        }
      });
    }, { rootMargin: '200px' });
    imgs.forEach(function (img) { _observer.observe(img); });
  } else {
    // Fallback: načíst vše najednou
    imgs.forEach(function (img) { _loadImgEl(img); });
  }
}

/* ── Přímé použití z onload/onerror ─────────────────────── */
/**
 * <img src="{{ card.image_url }}"
 *      onerror="CardImages.fallback(this, '{{ card.set_id }}', '{{ card.number }}')"
 *      data-set-id="{{ card.set_id }}" data-number="{{ card.number }}">
 */
function fallback(imgEl, setId, number, lang) {
  if (imgEl._pfTried) return;
  imgEl._pfTried = true;

  var card = {
    id: (setId || '') + '-' + (number || ''),
    set_id: setId,
    number: number,
    lang: lang || 'en',
    image_url: null, // primární selhal
  };

  resolve(card).then(function (url) {
    if (url && url !== PLACEHOLDER) {
      imgEl.style.display = '';
      imgEl.src = url;
      // Skryj případný placeholder sibling
      var ph = imgEl.nextElementSibling;
      if (ph && (ph.classList.contains('poke-card-img-placeholder') || ph.classList.contains('modal-card-img-placeholder'))) {
        ph.style.display = 'none';
      }
    } else {
      // Nic nenalezeno - zobraz placeholder
      imgEl.style.display = 'none';
      var ph2 = imgEl.nextElementSibling;
      if (ph2 && (ph2.classList.contains('poke-card-img-placeholder') || ph2.classList.contains('modal-card-img-placeholder'))) {
        ph2.style.display = 'flex';
      }
    }
  });
}

/* ── Hromadný pre-fetch pro seznam karet ────────────────── */
/**
 * Spustí paralelní fetch pro až `concurrency` karet najednou
 */
function prefetch(cards, concurrency) {
  concurrency = concurrency || 4;
  var queue = (cards || []).slice();
  var active = 0;
  var results = {};

  return new Promise(function (resolveAll) {
    function pump() {
      while (active < concurrency && queue.length) {
        active++;
        var card = queue.shift();
        resolve(card).then(function (url) {
          results[card.id || (card.set_id + '-' + card.number)] = url;
          active--;
          if (!queue.length && active === 0) resolveAll(results);
          else pump();
        });
      }
      if (!queue.length && active === 0) resolveAll(results);
    }
    pump();
  });
}

/* ── Public API ─────────────────────────────────────────── */
window.CardImages = {
  resolve:   resolve,
  fallback:  fallback,
  initLazy:  initLazy,
  prefetch:  prefetch,
  PLACEHOLDER: PLACEHOLDER,

  // Zkus vytvořit URL ručně bez fetche (rychlé)
  buildUrls: _buildUrls,
};

// Auto-init lazy images při DOMContentLoaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLazy);
} else {
  setTimeout(initLazy, 0);
}

})(window);
