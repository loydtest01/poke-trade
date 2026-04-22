/**
 * card-search.js – Centralizovaný modul pro vyhledávání Pokémon karet
 * =======================================================================
 * Používání ze všech stránek:
 *
 *   <script src="card-search.js"></script>
 *
 *   // Základní hledání
 *   const results = await PkSearch.search('Dragonite');
 *   const results = await PkSearch.search('Dragonite', { set: 'M24EN', number: '012' });
 *   const results = await PkSearch.search('ドラゴナイト', { lang: 'JP', hp: '180' });
 *
 *   // Fetch konkrétní karty
 *   const card = await PkSearch.fetchById('mcd24-12');
 *
 *   // Výsledek je vždy pole karet v unified formátu:
 *   // { apiId, name, set, setCode, number, imageUrl, apiSmall, apiLarge,
 *   //   hp, types, supertype, rarity, price, sourceUrl, _source }
 *
 * Zdroje (v pořadí priority):
 *   1. pokemontcg.io přes /api/tcg proxy  (EN karty, ceny z Cardmarketu)
 *   2. TCGdex (api.tcgdex.net)             (JP / DE / FR originály, překlady)
 * =======================================================================
 */

(function (global) {
  'use strict';

  // ─── Konfigurace ────────────────────────────────────────────────────────────

  /** Proxy pro pokemontcg.io (řeší CORS + skrývá API klíč) */
  const TCG_PROXY = '/api/tcg';

  /** Přímý fallback pokud proxy neběží (např. lokální vývoj) */
  const TCG_DIRECT = 'https://api.pokemontcg.io/v2';

  /** TCGdex base URL */
  const TCGDEX_BASE = 'https://api.tcgdex.net/v2';

  /** Timeout pro každý fetch v ms */
  const FETCH_TIMEOUT = 8000;

  // ─── Detekce typu set stringu ────────────────────────────────────────────────
  //
  // pokemontcg.io umí hledat podle:
  //   set.name:"McDonald's Match Battle"    → plný název
  //   set.ptcgoCode:"M24"                   → PTCGO/PTCGL kód (krátký kód)
  //   set.id:"mcd24"                        → interní ID setu
  //
  // TCGdex:
  //   /v2/en/sets/mcd24/12                  → přímý lookup
  //   /v2/en/cards?name=Dragonite           → hledání dle jména
  //
  // Pravidla pro detekci:
  //   - obsahuje mezeru                     → plný název (set.name)
  //   - ≤10 znaků, jen [A-Z0-9]            → PTCGO kód (set.ptcgoCode)
  //   - obsahuje malá písmena + číslice     → set ID (set.id)

  function _detectSetType(setStr) {
    if (!setStr) return null;
    const s = setStr.trim();
    if (s.includes(' ')) return 'name';                   // "McDonald's Match Battle"
    if (/^[A-Z0-9]{2,10}$/.test(s)) return 'ptcgoCode';  // "M24EN", "BRS", "PAL"
    if (/^[a-z0-9A-Z]{2,12}$/.test(s)) return 'id';      // "mcd24", "sv1a", "s10D"
    return 'name';
  }

  /**
   * Sestaví q= string pro pokemontcg.io API.
   * Správně použije set.name / set.ptcgoCode / set.id podle formátu.
   */
  function _buildTcgQuery(name, set, number) {
    const parts = [];
    if (name)   parts.push(`name:"${name.replace(/"/g, '')}"`);
    if (set) {
      const t = _detectSetType(set);
      if (t === 'ptcgoCode') parts.push(`set.ptcgoCode:"${set}"`);
      else if (t === 'id')   parts.push(`set.id:"${set}"`);
      else                   parts.push(`set.name:"${set.replace(/"/g, '')}"`);
    }
    if (number) {
      const n = String(number).split('/')[0].replace(/\D/g, '');
      if (n) parts.push(`number:${n}`);
    }
    return parts.join(' ');
  }

  // ─── Nízkoúrovňový fetch s timeoutem a retry ────────────────────────────────

  async function _fetch(url, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
        const r = await fetch(url, { signal: ctrl.signal });
        clearTimeout(timer);
        if (r.status === 429 || r.status === 503) {
          const wait = 800 * Math.pow(2, attempt);
          console.warn(`[PkSearch] ${r.status} na ${url} — čekám ${wait}ms`);
          await new Promise(res => setTimeout(res, wait));
          continue;
        }
        if (!r.ok) return null;
        return await r.json();
      } catch (e) {
        if (attempt === retries) console.warn('[PkSearch] Fetch selhalo:', url, e.message);
      }
    }
    return null;
  }

  // ─── pokemontcg.io helpers ──────────────────────────────────────────────────

  /**
   * Zavolá /api/tcg proxy. Pokud proxy vrátí 404 / selhání, zkusí přímý TCG endpoint.
   */
  async function _tcgProxyFetch(path) {
    // Převeď "https://api.pokemontcg.io/v2/cards?q=..." na "/api/tcg?q=..."
    const m = path.match(/api\.pokemontcg\.io\/v2\/([^?]+)(\?.*)?$/);
    let proxyUrl;
    if (m) {
      const segment = m[1];
      const qs = m[2] || '';
      const idM = segment.match(/^cards\/(.+)$/);
      if (idM) {
        proxyUrl = `${TCG_PROXY}?id=${encodeURIComponent(idM[1])}`;
      } else {
        const p = new URLSearchParams(qs.replace(/^\?/, ''));
        p.set('path', segment);
        proxyUrl = `${TCG_PROXY}?${p.toString()}`;
      }
    } else {
      proxyUrl = path; // je to už relativní /api/tcg?...
    }

    const data = await _fetch(proxyUrl);
    if (data) return data;
    // Fallback: přímý pokemontcg.io
    return await _fetch(path.startsWith('http') ? path : `${TCG_DIRECT}/${path}`);
  }

  /** Hledá na pokemontcg.io. Vrátí pole raw karet nebo []. */
  async function _searchTcgIo(q, pageSize = 20) {
    if (!q) return [];
    const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(q)}&pageSize=${pageSize}&orderBy=-set.releaseDate`;
    const data = await _tcgProxyFetch(url);
    return data?.data || [];
  }

  // ─── TCGdex helpers ─────────────────────────────────────────────────────────

  const LANG_TO_TCGDEX = {
    EN: 'en', JP: 'ja', JA: 'ja', DE: 'de', FR: 'fr',
    ES: 'es', IT: 'it', PT: 'pt', KO: 'ko',
    ZH: 'zh-Hans', CN: 'zh-Hans', TW: 'zh-Hant',
  };

  /**
   * Hledá na TCGdex dle jména. Vrátí pole nebo null.
   * Zkouší: /v2/{lang}/cards?name=... s fallbackem na /v2/en/cards?name=...
   */
  async function _tcgdexByName(name, lang = 'en', hp = null) {
    if (!name) return [];
    const l = (LANG_TO_TCGDEX[lang?.toUpperCase()] || 'en');

    // Zkus ve zdrojovém jazyce
    let results = await _fetch(`${TCGDEX_BASE}/${l}/cards?name=${encodeURIComponent(name)}`);

    // Fallback na EN pokud jazyk nenašel nic
    if ((!Array.isArray(results) || !results.length) && l !== 'en') {
      results = await _fetch(`${TCGDEX_BASE}/en/cards?name=${encodeURIComponent(name)}`);
    }

    if (!Array.isArray(results)) return [];

    // Filtruj dle HP (volitelné zpřesnění)
    if (hp) {
      const hpNum = parseInt(hp, 10);
      const byHp = results.filter(c => parseInt(c.hp, 10) === hpNum);
      if (byHp.length) return byHp;
    }

    return results;
  }

  /**
   * Přímý lookup na TCGdex přes setId + číslo.
   * Zkusí varianty: s paddingem (012), bez (12), s originálním číslem.
   */
  async function _tcgdexDirect(setId, localId, lang = 'en') {
    if (!setId || !localId) return null;
    const l = LANG_TO_TCGDEX[lang?.toUpperCase()] || 'en';
    const num = String(localId).split('/')[0];
    const padded = num.padStart(3, '0');

    for (const id of [...new Set([padded, num])]) {
      const data = await _fetch(`${TCGDEX_BASE}/${l}/sets/${setId.toLowerCase()}/${id}`);
      if (data?.name) return data;
    }
    return null;
  }

  /**
   * Hledá na TCGdex v jazyce karty, pak načte EN verzi → vrátí { enName, enCard, origImage }.
   * Používá se pro překlad JP/DE/FR karet.
   */
  async function _tcgdexTranslate(origName, lang, hp = null) {
    if (!origName || !lang) return null;
    const l = LANG_TO_TCGDEX[lang.toUpperCase()];
    if (!l || l === 'en') return null;

    const results = await _fetch(`${TCGDEX_BASE}/${l}/cards?name=${encodeURIComponent(origName)}`);
    if (!Array.isArray(results) || !results.length) return null;

    let matches = results;
    if (hp) {
      const hpNum = parseInt(hp, 10);
      const byHp = results.filter(c => parseInt(c.hp, 10) === hpNum);
      if (byHp.length) matches = byHp;
    }

    const best = matches[0];
    const cardId = best.id || (best.set?.id ? `${best.set.id}-${best.localId}` : null);
    if (!cardId) return null;

    const enCard = await _fetch(`${TCGDEX_BASE}/en/cards/${cardId}`);
    if (!enCard?.name) return null;

    // Načti originální obrázek
    const origCard = await _fetch(`${TCGDEX_BASE}/${l}/cards/${cardId}`);
    return {
      enName:        enCard.name,
      enCard,
      origImage:      origCard?.image ? origCard.image + '/high.webp' : null,
      origImageSmall: origCard?.image ? origCard.image + '/low.webp'  : null,
    };
  }

  // ─── Normalizace na unified formát ──────────────────────────────────────────

  /**
   * Převede raw kartu z pokemontcg.io na unified formát.
   */
  function _normalizeTcgIo(c) {
    if (!c || !c.id) return null;
    const cm = c.cardmarket?.prices || {};
    return {
      _source:    'pokemontcg',
      apiId:      c.id,
      name:       c.name       || '',
      set:        c.set?.name  || '',
      setCode:    c.set?.ptcgoCode || c.set?.id || '',
      setId:      c.set?.id    || '',
      setSeries:  c.set?.series || '',
      setSymbol:  c.set?.images?.symbol || '',
      setLogo:    c.set?.images?.logo   || '',
      setTotal:   c.set?.total || null,
      setReleaseDate: c.set?.releaseDate || '',
      number:     c.number     || '',
      imageUrl:   c.images?.large || c.images?.small || '',
      apiSmall:   c.images?.small || '',
      apiLarge:   c.images?.large || '',
      hp:         c.hp         || '',
      types:      Array.isArray(c.types) ? c.types : [],
      supertype:  c.supertype  || '',
      subtype:    (c.subtypes || []).join(', '),
      rarity:     c.rarity     || '',
      artist:     c.artist     || '',
      evolvesFrom: c.evolvesFrom || '',
      regulationMark: c.regulationMark || '',
      price:      cm.trendPrice || cm.averageSellPrice || null,
      pMin:       cm.lowPrice   || null,
      pTrend:     cm.trendPrice || null,
      p30d:       cm.avg30      || null,
      cardmarketUrl: c.cardmarket?.url || '',
      sourceUrl:  `https://www.pokemontcg.io/cards/${c.id}`,
    };
  }

  /**
   * Převede raw kartu z TCGdex na unified formát.
   */
  function _normalizeTcgdex(c) {
    if (!c) return null;
    const imgBase = c.image || '';
    return {
      _source:    'tcgdex',
      apiId:      c.id || `${c.set?.id || 'unk'}-${c.localId || '0'}`,
      name:       c.name    || '',
      set:        c.set?.name || c.set?.id || '',
      setCode:    c.set?.id  || '',
      setId:      c.set?.id  || '',
      number:     c.localId  || '',
      imageUrl:   imgBase ? imgBase + '/high.webp' : '',
      apiSmall:   imgBase ? imgBase + '/low.webp'  : '',
      apiLarge:   imgBase ? imgBase + '/high.webp' : '',
      hp:         c.hp  ? String(c.hp) : '',
      types:      Array.isArray(c.types)    ? c.types    : [],
      supertype:  c.category || 'Pokémon',
      subtype:    '',
      rarity:     c.rarity   || '',
      artist:     c.illustrator || '',
      price:      null,
      sourceUrl:  `https://www.tcgdex.net/database/${c.set?.id || ''}/${c.localId || ''}`,
    };
  }

  // ─── Veřejné API ────────────────────────────────────────────────────────────

  const PkSearch = {

    /**
     * Hlavní vyhledávací funkce.
     *
     * @param {string} name  - Název karty (EN nebo původní jazyk)
     * @param {object} opts  - Volitelné parametry:
     *   set      {string}  - Set kód/název jak je na kartě (např. "M24EN", "Obsidian Flames")
     *   number   {string}  - Číslo karty (např. "012/015" nebo "012")
     *   lang     {string}  - Jazyk karty: "EN" | "JP" | "DE" | "FR" | ...
     *   hp       {string}  - HP pro zpřesnění JP/DE/FR vyhledávání
     *   pageSize {number}  - Max počet výsledků (default 20)
     *   onStatus {fn}      - Callback pro stavové zprávy: onStatus("⏳ Hledám…")
     *
     * @returns {Promise<Array>} Pole karet v unified formátu, seřazené: nejlepší shoda první
     */
    async search(name, opts = {}) {
      const {
        set       = '',
        number    = '',
        lang      = 'EN',
        hp        = null,
        pageSize  = 20,
        onStatus  = null,
      } = opts;

      const status = msg => { if (onStatus) onStatus(msg); };
      const isNonEn = (lang && lang !== 'EN') || /[\u3000-\u9fff\uff00-\uffef]/.test(name || '');

      let cards = [];

      // ── VĚTEV A: ne-anglická karta (JP, DE, FR, KO, …) ────────────────────
      if (isNonEn) {
        let enName = '';

        // A1: Přeložíme pomocí TCGdex (zdrojový jazyk → EN)
        status(`🌐 Překládám pomocí TCGdex (${lang})…`);
        const translated = await _tcgdexTranslate(name, lang, hp);
        if (translated?.enName) {
          enName = translated.enName;
          console.log(`[PkSearch] Překlad: "${name}" (${lang}) → "${enName}" (EN)`);
        }

        // A2: Fallback – hledej přímo v TCGdex v EN
        if (!enName) {
          status(`🔍 Hledám v TCGdex…`);
          const dexEN = await _tcgdexByName(name, 'en', hp);
          if (dexEN.length) enName = dexEN[0].name;
        }

        // A3: Přímý TCGdex lookup pokud máme set kód + číslo
        if (set && number) {
          const setId = set.replace(/EN$|JP$|DE$|FR$/i, '').toLowerCase();
          const dexCard = await _tcgdexDirect(setId, number, lang);
          if (dexCard) {
            cards.push(_normalizeTcgdex(dexCard));
            if (!enName && dexCard.name) enName = dexCard.name;
          }
        }

        // A4: Hledej EN karty na pokemontcg.io (bez čísla – JP čísla nejsou EN čísla)
        if (enName) {
          status(`🔍 Hledám EN ekvivalent: ${enName}…`);
          const q = _buildTcgQuery(enName, '', ''); // bez čísla pro JP!
          const tcgCards = await _searchTcgIo(q, pageSize);
          const normalized = tcgCards.map(_normalizeTcgIo).filter(Boolean);
          cards = [...cards, ...normalized.filter(c => !cards.find(x => x.apiId === c.apiId))];
        }

        // A5: Wildcard fallback
        if (!cards.length && enName) {
          const firstWord = enName.split(' ')[0];
          status(`🔍 Zkouším ${firstWord}*…`);
          const tcgCards = await _searchTcgIo(`name:${firstWord}*`, pageSize);
          cards = tcgCards.map(_normalizeTcgIo).filter(Boolean);
        }
      }

      // ── VĚTEV B: anglická karta ────────────────────────────────────────────
      else {
        const enName = (name || '').trim();

        // B1: Přesný dotaz (jméno + set + číslo)
        // KLÍČOVÁ OPRAVA: Pro set kódy jako "M24EN" použij set.ptcgoCode, ne set.name!
        if (enName && (set || number)) {
          const q = _buildTcgQuery(enName, set, number);
          status(`🔍 Hledám: ${q}…`);
          let tcgCards = await _searchTcgIo(q, pageSize);

          // B1b: Pokud nic, zkus shodný set jako set.id (mcd24 apod.)
          if (!tcgCards.length && set) {
            const setLower = set.replace(/EN$|JP$/i, '').toLowerCase();
            const q2 = _buildTcgQuery(enName, setLower, number);
            if (q2 !== q) {
              status(`🔍 Zkouším set.id: ${setLower}…`);
              tcgCards = await _searchTcgIo(q2, pageSize);
            }
          }

          cards = tcgCards.map(_normalizeTcgIo).filter(Boolean);
        }

        // B2: Jen jméno
        if (!cards.length && enName) {
          status(`🔍 Hledám: ${enName}…`);
          const q = `name:"${enName}"`;
          const tcgCards = await _searchTcgIo(q, pageSize);
          cards = tcgCards.map(_normalizeTcgIo).filter(Boolean);
        }

        // B3: Wildcard na první slovo
        if (!cards.length && enName) {
          const firstWord = enName.split(' ')[0];
          status(`🔍 Zkouším ${firstWord}*…`);
          const tcgCards = await _searchTcgIo(`name:${firstWord}*`, pageSize);
          cards = tcgCards.map(_normalizeTcgIo).filter(Boolean);
        }

        // B4: TCGdex fallback (pokud pokemontcg.io vrátí prázdno – promo sety apod.)
        if (!cards.length && enName) {
          status(`🔍 Zkouším TCGdex…`);
          const dexCards = await _tcgdexByName(enName, 'en', hp);
          // Filtruj dle čísla pokud máme
          let best = dexCards;
          if (number) {
            const n = String(number).split('/')[0];
            const byNum = dexCards.filter(c => String(c.localId) === n || String(c.localId) === n.padStart(3, '0'));
            if (byNum.length) best = byNum;
          }
          cards = best.map(_normalizeTcgdex).filter(Boolean);
        }
      }

      return cards;
    },

    /**
     * Rychlé hledání pouze na pokemontcg.io proxy (bez TCGdex).
     * Vhodné pro Marketplace a situace kde nepotřebuješ JP podporu.
     *
     * @param {string} name
     * @param {string} set    - Set kód nebo název
     * @param {string} number - Číslo karty
     * @returns {Promise<Array>}
     */
    async searchTcgIo(name, set = '', number = '') {
      const results = [];

      // Zkus přesný dotaz
      if (name && (set || number)) {
        const q = _buildTcgQuery(name, set, number);
        const r = await _searchTcgIo(q, 20);
        results.push(...r.map(_normalizeTcgIo).filter(Boolean));
      }

      // Fallback: jen jméno
      if (!results.length && name) {
        const r = await _searchTcgIo(`name:"${name}"`, 20);
        results.push(...r.map(_normalizeTcgIo).filter(Boolean));
      }

      // Wildcard fallback
      if (!results.length && name) {
        const r = await _searchTcgIo(`name:${name.split(' ')[0]}*`, 20);
        results.push(...r.map(_normalizeTcgIo).filter(Boolean));
      }

      return results;
    },

    /**
     * Načte konkrétní kartu podle ID z pokemontcg.io.
     * @param {string} id  - Např. "mcd24-12" nebo "swsh12pt5-4"
     * @returns {Promise<object|null>} Unified karta nebo null
     */
    async fetchById(id) {
      if (!id) return null;
      const data = await _tcgProxyFetch(`https://api.pokemontcg.io/v2/cards/${encodeURIComponent(id)}`);
      return data?.data ? _normalizeTcgIo(data.data) : null;
    },

    /**
     * Načte konkrétní kartu z TCGdex.
     * @param {string} setId   - Např. "mcd24"
     * @param {string} localId - Např. "12" nebo "012"
     * @param {string} lang    - "en" | "ja" | ...
     * @returns {Promise<object|null>}
     */
    async fetchFromTcgdex(setId, localId, lang = 'en') {
      const raw = await _tcgdexDirect(setId, localId, lang);
      return raw ? _normalizeTcgdex(raw) : null;
    },

    /**
     * Hledá přes TCGdex v originálním jazyce a překládá do EN.
     * Vrátí { enName, enCard (unified), origImage, origImageSmall } nebo null.
     */
    async translateViaLang(name, lang, hp = null) {
      const r = await _tcgdexTranslate(name, lang, hp);
      if (!r) return null;
      return {
        enName:         r.enName,
        enCard:         r.enCard ? _normalizeTcgdex(r.enCard) : null,
        origImage:      r.origImage,
        origImageSmall: r.origImageSmall,
      };
    },

    /**
     * Normalizuje raw kartu z pokemontcg.io nebo TCGdex na unified formát.
     * Detekuje zdroj automaticky.
     */
    normalize(rawCard) {
      if (!rawCard) return null;
      if (rawCard._source) return rawCard; // już normalizovaná
      // Pokud má 'localId' → TCGdex
      if ('localId' in rawCard || 'category' in rawCard) return _normalizeTcgdex(rawCard);
      // Jinak pokemontcg.io
      return _normalizeTcgIo(rawCard);
    },

    /** Pomocná funkce: detekuje typ set stringu */
    detectSetType: _detectSetType,

    /** Pomocná funkce: sestaví q= dotaz */
    buildQuery: _buildTcgQuery,
  };

  // ─── Export ─────────────────────────────────────────────────────────────────
  global.PkSearch = PkSearch;

})(typeof window !== 'undefined' ? window : global);


/* =============================================================================
   MIGRACE – zpětná kompatibilita
   =============================================================================
   Pokud stávající stránky volají starý `fetchTcgCard(name, set, number)` nebo
   `fetchPokemontcgImage(name, number, set)`, zachytíme je tady.

   POSTUP MIGRACE:
   1. Přidej <script src="card-search.js"></script> do každé stránky
      PŘED vlastními skripty.
   2. Starý kód funguje beze změny díky shimům níže.
   3. Postupně přepiš volání na PkSearch.search() pro lepší výsledky.
============================================================================= */

// Shim pro scanner.html a queue.html
if (typeof window !== 'undefined') {

  /** Nahrazuje starý fetchTcgCard z scanner.html */
  window.fetchTcgCard = async function (name, set, number) {
    const results = await PkSearch.search(name, { set, number });
    if (!results.length) return null;
    const c = results[0];
    // Vrátí objekt kompatibilní se starým formátem (tcgCard)
    return {
      id:       c.apiId,
      name:     c.name,
      set:      { name: c.set, id: c.setId },
      localId:  c.number,
      hp:       c.hp,
      image:    c.imageUrl.replace(/\/high\.webp$|\/low\.webp$/, ''),
      images:   { small: c.apiSmall, large: c.apiLarge },
      rarity:   c.rarity,
      types:    c.types,
      _unified: c,
    };
  };

  /** Nahrazuje starý fetchPokemontcgImage z scanner.html */
  window.fetchPokemontcgImage = async function (name, number, set) {
    const results = await PkSearch.searchTcgIo(name, set, number);
    if (!results.length) return null;
    return results[0].apiLarge || results[0].apiSmall || null;
  };
}
