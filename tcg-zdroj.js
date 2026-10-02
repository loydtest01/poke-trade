/* ═══════════════════════════════════════════════════════════════
   tcg-zdroj.js — společný zdroj karet ve tvaru pokemontcg.io
   ───────────────────────────────────────────────────────────────
   pokemontcg.io (přes tcg-proxy) po přechodu na Scrydex často vrací
   502 nebo odpovídá až 13 s. Tento soubor:
     1. zkusí původní tcg-proxy, ale nejvýš 5 s,
     2. při selhání přeloží stejný dotaz do TCGdex (zdarma, bez klíče)
        a odpověď převede do tvaru pokemontcg.io — stránky nic nepoznají,
     3. po selhání proxy ji 10 min přeskakuje (jde rovnou na TCGdex).

   Použití: window.PT_tcgFetch(url) → Promise<Response>
   url = původní adresa https://api.pokemontcg.io/v2/...
   Podporuje: cards/{id}, cards?q=…, sets?…
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.PT_tcgFetch) return;

  var PROXY = 'https://xrduqwrinzvmpixgmqta.supabase.co/functions/v1/tcg-proxy';
  var TCGDEX = 'https://api.tcgdex.net/v2/en';
  var PROXY_LIMIT_MS = 5000;
  var TCGDEX_LIMIT_MS = 8000;
  var PAUZA_KLIC = 'pt_tcgproxy_down_until';
  var PAUZA_MS = 10 * 60 * 1000;
  var MAX_DETAILU = 12;          // kolik karet z hledání doplnit o ceny (1 dotaz na kartu)

  // ── Pomocné ─────────────────────────────────────────────────────
  function sCasovacem(url, ms, opts) {
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, ms);
    var o = opts || {};
    if (ctl) o.signal = ctl.signal;
    return fetch(url, o).then(function (r) { clearTimeout(t); return r; },
                              function (e) { clearTimeout(t); throw e; });
  }
  function jsonOdpoved(telo, status) {
    return new Response(JSON.stringify(telo), {
      status: status || 200, headers: { 'Content-Type': 'application/json' }
    });
  }
  function proxyPozastavena() {
    try { return Number(sessionStorage.getItem(PAUZA_KLIC) || 0) > Date.now(); } catch (e) { return false; }
  }
  function pozastavProxy() {
    try { sessionStorage.setItem(PAUZA_KLIC, String(Date.now() + PAUZA_MS)); } catch (e) {}
  }
  async function tcgdexJson(cesta) {
    var r = await sCasovacem(TCGDEX + cesta, TCGDEX_LIMIT_MS);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('TCGdex HTTP ' + r.status);
    return r.json();
  }

  // ── Převod karty TCGdex → tvar pokemontcg.io ─────────────────────
  var SUPERTYPE = { Pokemon: 'Pokémon', Trainer: 'Trainer', Energy: 'Energy' };
  function tcgplayerVarianta(v) {
    if (!v) return undefined;
    return { low: v.lowPrice, mid: v.midPrice, high: v.highPrice,
             market: v.marketPrice, directLow: v.directLowPrice };
  }
  function prevedKartu(k) {
    if (!k) return null;
    var obr = k.image || '';
    var sada = k.set || {};
    var karta = {
      id: k.id,
      name: k.name,
      number: String(k.localId != null ? k.localId : ''),
      supertype: SUPERTYPE[k.category] || k.category,
      subtypes: [k.stage, k.suffix, k.trainerType, k.energyType].filter(Boolean),
      hp: k.hp != null ? String(k.hp) : undefined,
      types: k.types,
      rarity: k.rarity,
      artist: k.illustrator,
      evolvesFrom: k.evolveFrom,
      set: { id: sada.id || String(k.id || '').split('-')[0], name: sada.name,
             total: sada.cardCount && sada.cardCount.total,
             printedTotal: sada.cardCount && sada.cardCount.official },
      images: obr ? { small: obr + '/low.webp', large: obr + '/high.webp' } : {},
      _zdroj: 'tcgdex'
    };
    var p = k.pricing || {};
    if (p.cardmarket) {
      var cm = p.cardmarket;
      karta.cardmarket = {
        updatedAt: cm.updated,
        prices: {
          averageSellPrice: cm.avg, lowPrice: cm.low, trendPrice: cm.trend,
          avg1: cm.avg1, avg7: cm.avg7, avg30: cm.avg30,
          reverseHoloSell: cm['avg-holo'], reverseHoloLow: cm['low-holo'],
          reverseHoloTrend: cm['trend-holo'],
          reverseHoloAvg1: cm['avg1-holo'], reverseHoloAvg7: cm['avg7-holo'],
          reverseHoloAvg30: cm['avg30-holo']
        }
      };
    }
    if (p.tcgplayer) {
      var tp = p.tcgplayer;
      karta.tcgplayer = {
        updatedAt: tp.updated,
        prices: {
          normal: tcgplayerVarianta(tp.normal),
          holofoil: tcgplayerVarianta(tp.holofoil),
          reverseHolofoil: tcgplayerVarianta(tp['reverse-holofoil'] || tp.reverse),
          '1stEditionHolofoil': tcgplayerVarianta(tp['1st-edition-holofoil']),
          unlimitedHolofoil: tcgplayerVarianta(tp['unlimited-holofoil'])
        }
      };
    }
    return karta;
  }

  // ── Rozbor dotazu pokemontcg.io (q=…) ────────────────────────────
  // Rozumí: name:"X" / name:X / name:X*, number:N, set.name:"S", set.id:S
  // Ostatní podmínky (rarity, subtypes…) ignoruje — TCGdex je neumí filtrovat.
  function rozeberQ(q) {
    var v = {};
    var re = /(-?)([\w.]+):("([^"]*)"|\S+)/g, m;
    while ((m = re.exec(q || ''))) {
      if (m[1] === '-') continue;
      var klic = m[2].toLowerCase();
      var hodnota = m[4] != null ? m[4] : m[3];
      if (!(klic in v)) v[klic] = hodnota;
    }
    return v;
  }

  // Seznam sad (pro převod názvu sady na ID) — v paměti po dobu návštěvy
  var _sady = null;
  async function sadyTcgdex() {
    if (!_sady) _sady = (await tcgdexJson('/sets')) || [];
    return _sady;
  }
  // Názvy sad se mezi pokemontcg.io a TCGdex liší („EX Deoxys" × „Deoxys",
  // „Pokémon GO" × „Pokemon GO"). Přesná shoda má přednost; jinak jedna obsahuje
  // druhou s rozdílem nejvýš 4 znaky (aby „Base" nesplynulo s „Base Set 2").
  function najdiSady(sady, nazev) {
    var n = normalizuj(nazev);
    if (!n) return [];
    var presne = sady.filter(function (s) { return normalizuj(s.name) === n; });
    var vyber = presne.length ? presne : sady.filter(function (s) {
      var m = normalizuj(s.name);
      return m && (m.indexOf(n) !== -1 || n.indexOf(m) !== -1) && Math.abs(m.length - n.length) <= 4;
    });
    return vyber.map(function (s) { return String(s.id).toLowerCase() + '-'; });
  }
  // Jméno karty: symboly ★ δ ◇ ex GX… MUSÍ zůstat — „Rayquaza ★" je jiná
  // (a řádově dražší) karta než „Rayquaza". Sjednotí se jen ☆→★, diakritika a mezery.
  function normalizujJmeno(t) {
    return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/☆/g, '★').replace(/\s+/g, ' ').trim();
  }
  // „218/203" → „218", „004" → „4", „SWSH136" → „swsh136"
  function normCislo(n) {
    return String(n == null ? '' : n).toLowerCase().split('/')[0].trim().replace(/^0+(?=[0-9a-z])/, '');
  }
  function normalizuj(t) {
    return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  async function hledejKarty(parametry) {
    var q = rozeberQ(parametry.get('q'));
    var velikost = Math.max(1, Math.min(250, Number(parametry.get('pageSize')) || 20));
    var dotaz = [];
    var jmeno = q.name;
    var presne = false;
    if (jmeno) {
      jmeno = jmeno.replace(/\*+$/, '');
      presne = !/\*$/.test(q.name);
      // „like" a přesnou shodu dořešíme sami — eq: v TCGdex může rozlišovat velikost písmen
      dotaz.push('name=' + encodeURIComponent(jmeno));
    }
    // Číslo filtrujeme sami: serverový filtr localId u TCGdex nevracel nic (Rayquaza VMAX 218).
    // Jen když chybí jméno, pošle se na server (jinak by se stahovalo všechno).
    if (q.number && !jmeno) dotaz.push('localId=eq:' + encodeURIComponent(q.number));
    if (!dotaz.length) return jsonOdpoved({ data: [], page: 1, pageSize: velikost, count: 0, totalCount: 0 });

    var seznam = (await tcgdexJson('/cards?' + dotaz.join('&'))) || [];

    if (presne && jmeno) {
      // Přesné jméno jako u pokemontcg.io. Bez přesné shody NIC — podobná karta
      // (např. „Rayquaza" místo „Rayquaza ★") by se ke kartě uložila se špatnou cenou.
      var nj = normalizujJmeno(jmeno);
      seznam = seznam.filter(function (k) { return normalizujJmeno(k.name) === nj; });
    }
    if (q.number && jmeno) {
      var nc = normCislo(q.number);
      seznam = seznam.filter(function (k) { return normCislo(k.localId) === nc; });
    }
    if (q['set.id']) {
      var sid = String(q['set.id']).toLowerCase();
      seznam = seznam.filter(function (k) { return String(k.id).toLowerCase().indexOf(sid + '-') === 0; });
    }
    if (q['set.name']) {
      // Sada zadaná → MUSÍ sedět. Nenajde-li se, výsledek je prázdný
      // (dřív se filtr vynechal a vrátila se karta z jiné sady).
      var ids = najdiSady(await sadyTcgdex(), q['set.name']);
      seznam = seznam.filter(function (k) {
        var id = String(k.id).toLowerCase();
        return ids.some(function (p) { return id.indexOf(p) === 0; });
      });
    }
    // pokemontcg.io řadí -set.releaseDate (nejnovější první); TCGdex vrací od nejstarších
    if (/-set\.releaseDate/.test(parametry.get('orderBy') || '')) seznam = seznam.slice().reverse();

    var celkem = seznam.length;
    seznam = seznam.slice(0, velikost);

    // Prvních pár karet doplníme o plný detail (ceny, sada, vzácnost)
    var detaily = await Promise.all(seznam.slice(0, MAX_DETAILU).map(function (k) {
      return tcgdexJson('/cards/' + encodeURIComponent(k.id)).catch(function () { return null; });
    }));
    var data = seznam.map(function (k, i) {
      return prevedKartu(detaily[i] || k);
    }).filter(Boolean);
    return jsonOdpoved({ data: data, page: 1, pageSize: velikost, count: data.length, totalCount: celkem });
  }

  async function sadyPokemontcg(parametry) {
    var sady = (await sadyTcgdex()).slice();
    var q = rozeberQ(parametry.get('q'));
    if (q.name) {
      var nn = normalizuj(q.name.replace(/\*+$/, ''));
      sady = sady.filter(function (s) { return normalizuj(s.name).indexOf(nn) !== -1; });
    }
    if (/-releaseDate/.test(parametry.get('orderBy') || '')) sady.reverse();
    var velikost = Number(parametry.get('pageSize')) || 250;
    var data = sady.slice(0, velikost).map(function (s) {
      return { id: s.id, name: s.name,
               total: s.cardCount && s.cardCount.total,
               printedTotal: s.cardCount && s.cardCount.official,
               images: { logo: s.logo ? s.logo + '.webp' : undefined,
                         symbol: s.symbol ? s.symbol + '.webp' : undefined },
               _zdroj: 'tcgdex' };
    });
    return jsonOdpoved({ data: data, page: 1, pageSize: velikost, count: data.length, totalCount: sady.length });
  }

  // ── Náhradní cesta přes TCGdex ──────────────────────────────────
  async function pres_tcgdex(url) {
    var m = String(url).match(/api\.pokemontcg\.io\/v2\/([^?]+)(\?.*)?$/);
    if (!m) throw new Error('neznámá adresa');
    var cesta = m[1].replace(/\/+$/, '');
    var parametry = new URLSearchParams((m[2] || '').replace(/^\?/, ''));

    var idM = cesta.match(/^cards\/(.+)$/);
    if (idM) {
      var k = await tcgdexJson('/cards/' + encodeURIComponent(decodeURIComponent(idM[1])));
      if (!k) return jsonOdpoved({ error: { message: 'Not Found', code: 404 } }, 404);
      return jsonOdpoved({ data: prevedKartu(k) });
    }
    if (cesta === 'cards') return hledejKarty(parametry);
    if (cesta === 'sets')  return sadyPokemontcg(parametry);
    throw new Error('nepodporovaná cesta ' + cesta);
  }

  // ── Původní cesta přes tcg-proxy ────────────────────────────────
  function adresaProxy(url) {
    var m = String(url).match(/api\.pokemontcg\.io\/v2\/([^?]+)(\?.*)?$/);
    if (!m) return url;
    var idM = m[1].match(/^cards\/(.+)$/);
    if (idM) return PROXY + '?id=' + encodeURIComponent(decodeURIComponent(idM[1]));
    var p = new URLSearchParams((m[2] || '').replace(/^\?/, ''));
    p.set('path', m[1]);
    return PROXY + '?' + p.toString();
  }

  window.PT_tcgFetch = async function (url) {
    if (!/api\.pokemontcg\.io\/v2\//.test(String(url))) return fetch(url);

    if (!proxyPozastavena()) {
      try {
        var r = await sCasovacem(adresaProxy(url), PROXY_LIMIT_MS);
        if (r.ok || r.status === 404) return r;
        throw new Error('HTTP ' + r.status);
      } catch (e) {
        pozastavProxy();
        console.warn('[tcg-zdroj] tcg-proxy selhala (' + (e.name === 'AbortError' ? 'timeout' : e.message) +
                     '), 10 min používám TCGdex');
      }
    }
    try {
      return await pres_tcgdex(url);
    } catch (e) {
      console.warn('[tcg-zdroj] TCGdex selhal: ' + e.message);
      return jsonOdpoved({ error: { message: e.message, code: 502 } }, 502);
    }
  };

  // Pro testy
  window.PT_tcgFetch._interni = { rozeberQ: rozeberQ, prevedKartu: prevedKartu };
})();
