/**
 * card-search.js – Centralizovaný modul pro vyhledávání Pokémon karet
 * =======================================================================
 * Verze 2.0 – Vylepšení:
 *   • Skórovací systém: výsledky seřazeny od nejlepší shody
 *   • Přepínatelné zdroje: TCGio / TCGdex / Foto shoda
 *   • Vyhledávání podle fotky (Groq vision API)
 *   • AI učení: zapamatuje si správné shody a při příštím hledání je upřednostní
 *
 * Používání:
 *   const results = await PkSearch.search('Dragonite', { set: 'M24EN', number: '012' });
 *   await PkSearch.scoreByImage(photoUrl, results, '/api/groq', groqKey);
 *   PkSearch.recordMatch('Dragonite', 'M24EN', '012', selectedCard);
 *   PkSearch.config.toggle('imageSearch'); // vypne/zapne zdroj
 * =======================================================================
 */

(function (global) {
  'use strict';

  // ─── Konfigurace ────────────────────────────────────────────────────────────

  const TCG_PROXY    = '/api/tcg';
  const TCG_DIRECT   = 'https://api.pokemontcg.io/v2';
  const TCGDEX_BASE  = 'https://api.tcgdex.net/v2';
  const FETCH_TIMEOUT = 8000;

  // ─── Konfigurace zdrojů (přepínatelné, persist v localStorage) ──────────────

  const SOURCES_KEY = 'pkc_search_sources_v2';

  function _loadSources() {
    try {
      const s = JSON.parse(localStorage.getItem(SOURCES_KEY) || '{}');
      return {
        tcgio:       s.tcgio       !== false,
        tcgdex:      s.tcgdex      !== false,
        imageSearch: s.imageSearch !== false,
      };
    } catch (e) {
      return { tcgio: true, tcgdex: true, imageSearch: true };
    }
  }

  function _saveSources(sources) {
    try { localStorage.setItem(SOURCES_KEY, JSON.stringify(sources)); } catch (e) {}
  }

  // ─── AI učení – zapamatování správných shod ─────────────────────────────────

  const LEARN_KEY  = 'pkc_learned_v2';
  const LEARN_MAX  = 500;

  function _learnKey(name, set, number) {
    return [name, set, number].map(s => (s || '').toLowerCase().trim()).join('||');
  }

  function _recordLearn(name, set, number, card) {
    try {
      const db = JSON.parse(localStorage.getItem(LEARN_KEY) || '{}');
      const k  = _learnKey(name, set, number);
      db[k]    = {
        apiId:  card.apiId,
        name:   card.name,
        set:    card.set,
        number: card.number,
        rarity: card.rarity,
        hp:     card.hp,
        ts:     Date.now(),
        count:  ((db[k]?.count) || 0) + 1,
      };
      // Prořez nejstarší záznamy
      const keys = Object.keys(db);
      if (keys.length > LEARN_MAX) {
        keys.sort((a, b) => (db[a].ts || 0) - (db[b].ts || 0))
            .slice(0, keys.length - LEARN_MAX)
            .forEach(k2 => delete db[k2]);
      }
      localStorage.setItem(LEARN_KEY, JSON.stringify(db));
      console.log(`[PkSearch] ✅ Zapamatováno: "${card.name}" pro dotaz "${name}|${set}|${number}" (${db[k].count}x)`);
    } catch (e) {}
  }

  function _getLearn(name, set, number) {
    try {
      const db = JSON.parse(localStorage.getItem(LEARN_KEY) || '{}');
      return db[_learnKey(name, set, number)] || null;
    } catch (e) { return null; }
  }

  function _getLearnStats() {
    try {
      const db = JSON.parse(localStorage.getItem(LEARN_KEY) || '{}');
      return { count: Object.keys(db).length, max: LEARN_MAX };
    } catch (e) { return { count: 0, max: LEARN_MAX }; }
  }

  // ─── Skórovací systém ───────────────────────────────────────────────────────
  //
  // Skóre = součet bodů za jednotlivé shody:
  //   Jméno:      0–50   (přesná shoda > začíná > obsahuje > word overlap)
  //   Číslo:      0–35   (přesná shoda čísla = nejvyšší priorita)
  //   Set:        0–20   (shoda set kódu/id)
  //   HP:         0–15   (přesná shoda; ±10 dostane 5 bodů)
  //   Varianta:   ±25    (shoda rarity/varianty; neshoda = penalizace)
  //   Typ:        0–10   (shoda typů)
  //   Zdroj:       0–3   (pokemontcg.io bonus pro EN karty)
  //   Naučeno:    +100   (bonus pro dříve potvrzené shody)

  function _scoreCard(card, ctx) {
    let score = 0;

    // ── Jméno ──────────────────────────────────────────────────────────────
    const cn = (card.name || '').toLowerCase().trim();
    const sn = (ctx.name  || '').toLowerCase().trim();
    if (cn && sn) {
      if (cn === sn)                                score += 50;
      else if (cn.startsWith(sn) || sn.startsWith(cn)) score += 32;
      else if (cn.includes(sn)   || sn.includes(cn))   score += 18;
      else {
        const cw = cn.split(/\s+/);
        const sw = sn.split(/\s+/);
        const overlap = sw.filter(w => w.length > 2 && cw.includes(w)).length;
        score += Math.min(overlap * 7, 14);
      }
    }

    // ── Číslo ──────────────────────────────────────────────────────────────
    if (ctx.number) {
      const qn = String(ctx.number).split('/')[0].replace(/\D/g, '').replace(/^0+/, '') || '';
      const rn = String(card.number || '').split('/')[0].replace(/\D/g, '').replace(/^0+/, '') || '';
      if (qn && rn) {
        if (qn === rn) score += 35;
        else if (qn.length >= 2 && (rn.endsWith(qn) || qn.endsWith(rn))) score += 18;
      }
    }

    // ── HP ─────────────────────────────────────────────────────────────────
    if (ctx.hp) {
      const qhp = parseInt(String(ctx.hp).replace(/\D/g, ''), 10);
      const rhp = parseInt(String(card.hp || '0').replace(/\D/g, ''), 10);
      if (qhp > 0 && qhp === rhp) score += 15;
      else if (qhp > 0 && rhp > 0 && Math.abs(qhp - rhp) <= 10) score += 5;
    }

    // ── Set ────────────────────────────────────────────────────────────────
    if (ctx.set) {
      const qs = ctx.set.toLowerCase().replace(/en$|jp$|de$|fr$/i, '').trim();
      const rs = (card.setCode || card.setId || '').toLowerCase();
      const rsName = (card.set || '').toLowerCase();
      if (qs && (rs || rsName)) {
        if (rs === qs || rsName.includes(qs) || qs.includes(rs)) score += 20;
        else if (rs.includes(qs) || qs.includes(rs)) score += 10;
        else score -= 12; // ← penalizace za jasnou neshodu série
      }
    }

    // ── Varianta / Rarity ──────────────────────────────────────────────────
    const vrStr = ((ctx.variant || '') + ' ' + (ctx.rarity || '')).toLowerCase();
    const crStr = (card.rarity || '').toLowerCase();
    if (vrStr.trim() && crStr) {
      const variantMap = [
        { keys: ['special illustration', 'alt art'],       vals: ['special illustration rare', 'alt art'] },
        { keys: ['full art'],                              vals: ['illustration rare', 'full art', 'ultra rare'] },
        { keys: ['rainbow', 'hyper'],                     vals: ['rainbow rare', 'hyper rare', 'rare rainbow'] },
        { keys: ['gold', 'secret rare'],                  vals: ['gold rare', 'rare secret', 'secret rare'] },
        { keys: ['reverse holo'],                         vals: ['reverse holo'] },
        { keys: ['holo v-max', 'vmax'],                   vals: ['rare holo vmax'] },
        { keys: ['holo v', ' vstar'],                     vals: ['rare holo v', 'rare holo vstar'] },
        { keys: ['holo'],                                 vals: ['holo rare', 'rare holo'] },
        { keys: ['promo'],                                vals: ['promo'] },
        { keys: ['common', 'basic', 'regular', 'normal'], vals: ['common', 'uncommon'] },
      ];
      let handled = false;
      for (const { keys, vals } of variantMap) {
        if (keys.some(k => vrStr.includes(k))) {
          if (vals.some(v => crStr.includes(v))) score += 25;
          else score -= 5; // mismatch penalty
          handled = true;
          break;
        }
      }
      // Generic holo check pokud žádná specifická varianta
      if (!handled && (vrStr.includes('holo') || vrStr.includes('shine'))) {
        if (crStr.includes('holo') || crStr.includes('rare')) score += 8;
      }
    }

    // ── Typ ────────────────────────────────────────────────────────────────
    if (ctx.types?.length && card.types?.length) {
      const qTypes = ctx.types.map(t => t.toLowerCase());
      const cTypes = card.types.map(t => t.toLowerCase());
      const matches = qTypes.filter(t => cTypes.includes(t)).length;
      score += Math.min(matches * 5, 10);
    }

    // ── Zdroj bonus ────────────────────────────────────────────────────────
    if (card._source === 'pokemontcg' && (!ctx.lang || ctx.lang === 'EN')) score += 3;
    if (card._source === 'tcgdex'    &&   ctx.lang && ctx.lang !== 'EN')   score += 3;

    return score;
  }

  /** Seřadí karty od nejlepší shody (skóre desc), vloží _score do každé karty */
  function _rankCards(cards, ctx) {
    if (!cards.length) return cards;
    return cards.map(c => ({ ...c, _score: _scoreCard(c, ctx) }))
                .sort((a, b) => b._score - a._score);
  }

  // ─── Vyhledávání podle fotky (Groq vision) ──────────────────────────────────

  async function _scoreByImage(photoUrl, candidates, { groqProxy, groqKey, onStatus } = {}) {
    if (!photoUrl || !candidates.length || !groqKey) return candidates;

    onStatus?.('🖼 Porovnávám s fotkou…');

    const TOP = Math.min(candidates.length, 8);
    const subset = candidates.slice(0, TOP);

    const candidateDesc = subset.map((c, i) =>
      `[${i}] ${c.name || '?'} | Set: ${c.set || '?'} #${c.number || '?'} | HP: ${c.hp || '?'} | ${c.rarity || '?'}`
    ).join('\n');

    const prompt = `You are a Pokémon TCG card identification expert.
Look at the photo carefully and identify which of these ${TOP} candidate cards it is:

${candidateDesc}

Compare based on:
- Pokémon name visible on the card
- Card number and set symbol
- HP value
- Illustration style and rarity (holo pattern, full art, etc.)
- Background color/texture

Return ONLY a JSON array of indices sorted best→worst match. Example: [2,0,5,1,3,4,6,7]
No explanation. Just the JSON array.`;

    try {
      const body = {
        model: localStorage.getItem('groqModel') || 'meta-llama/llama-4-scout-17b-16e-instruct',
        max_tokens: 80,
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: photoUrl } },
            { type: 'text', text: prompt },
          ],
        }],
      };

      const res = await fetch(groqProxy || '/api/groq', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Groq-Key': groqKey },
        body:    JSON.stringify(body),
      });

      if (!res.ok) {
        console.warn('[PkSearch] Image score API failed:', res.status);
        return candidates;
      }

      const data = await res.json();
      const text = (data?.choices?.[0]?.message?.content || '').trim();
      const m = text.match(/\[[\d,\s]+\]/);
      if (!m) {
        console.warn('[PkSearch] Image score: nelze parsovat odpověď:', text);
        return candidates;
      }

      const order = JSON.parse(m[0]);
      console.log('[PkSearch] 🖼 Image ranking:', order);

      // Přiřaď imageScore dle pořadí (vyšší = lepší shoda)
      const scored = subset.map(c => ({ ...c }));
      order.forEach((origIdx, newPos) => {
        if (origIdx >= 0 && origIdx < scored.length) {
          scored[origIdx]._imageScore = (TOP - newPos) * 12;
          scored[origIdx]._imagePick  = newPos === 0;
        }
      });

      // Kombinuj _score + _imageScore (pokud existuje)
      const merged = scored.map(c => ({
        ...c,
        _score: (c._score || 0) + (c._imageScore || 0),
      })).sort((a, b) => b._score - a._score);

      const rest = candidates.slice(TOP);
      return [...merged, ...rest];

    } catch (e) {
      console.warn('[PkSearch] Image score error:', e);
      return candidates;
    }
  }

  // ─── Detekce a query builder ─────────────────────────────────────────────────

  function _detectSetType(setStr) {
    if (!setStr) return null;
    const s = setStr.trim();
    if (s.includes(' '))                  return 'name';
    if (/^[A-Z0-9]{2,10}$/.test(s))      return 'ptcgoCode';
    if (/^[a-z0-9A-Z]{2,12}$/.test(s))   return 'id';
    return 'name';
  }

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

  // ─── Nízkoúrovňový fetch ─────────────────────────────────────────────────────

  async function _fetch(url, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
        const r = await fetch(url, { signal: ctrl.signal });
        clearTimeout(timer);
        if (r.status === 429 || r.status === 503) {
          const wait = 800 * Math.pow(2, attempt);
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

  async function _tcgProxyFetch(path) {
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
      proxyUrl = path;
    }
    const data = await _fetch(proxyUrl);
    if (data) return data;
    return await _fetch(path.startsWith('http') ? path : `${TCG_DIRECT}/${path}`);
  }

  async function _searchTcgIo(q, pageSize = 24) {
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

  async function _tcgdexByName(name, lang = 'en', hp = null) {
    if (!name) return [];
    const l = (LANG_TO_TCGDEX[lang?.toUpperCase()] || 'en');
    let results = await _fetch(`${TCGDEX_BASE}/${l}/cards?name=${encodeURIComponent(name)}`);
    if ((!Array.isArray(results) || !results.length) && l !== 'en') {
      results = await _fetch(`${TCGDEX_BASE}/en/cards?name=${encodeURIComponent(name)}`);
    }
    if (!Array.isArray(results)) return [];
    if (hp) {
      const hpNum = parseInt(hp, 10);
      const byHp = results.filter(c => parseInt(c.hp, 10) === hpNum);
      if (byHp.length) return byHp;
    }
    return results;
  }

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

  async function _tcgdexTranslate(origName, lang, hp = null) {
    if (!origName || !lang) return null;
    const l = LANG_TO_TCGDEX[lang.toUpperCase()];
    if (!l || l === 'en') return null;
    const results = await _fetch(`${TCGDEX_BASE}/${l}/cards?name=${encodeURIComponent(origName)}`);
    if (!Array.isArray(results) || !results.length) return null;
    let matches = results;
    if (hp) {
      const hpNum = parseInt(hp, 10);
      const byHp  = results.filter(c => parseInt(c.hp, 10) === hpNum);
      if (byHp.length) matches = byHp;
    }
    const best   = matches[0];
    const cardId = best.id || (best.set?.id ? `${best.set.id}-${best.localId}` : null);
    if (!cardId) return null;
    const enCard   = await _fetch(`${TCGDEX_BASE}/en/cards/${cardId}`);
    if (!enCard?.name) return null;
    const origCard = await _fetch(`${TCGDEX_BASE}/${l}/cards/${cardId}`);
    return {
      enName:         enCard.name,
      enCard,
      origImage:       origCard?.image ? origCard.image + '/high.webp' : null,
      origImageSmall:  origCard?.image ? origCard.image + '/low.webp'  : null,
    };
  }

  // ─── Normalizace ─────────────────────────────────────────────────────────────

  function _normalizeTcgIo(c) {
    if (!c || !c.id) return null;
    const cm = c.cardmarket?.prices || {};
    return {
      _source:        'pokemontcg',
      apiId:          c.id,
      name:           c.name        || '',
      set:            c.set?.name   || '',
      setCode:        c.set?.ptcgoCode || c.set?.id || '',
      setId:          c.set?.id     || '',
      setSeries:      c.set?.series || '',
      setSymbol:      c.set?.images?.symbol || '',
      setLogo:        c.set?.images?.logo   || '',
      setTotal:       c.set?.total  || null,
      setReleaseDate: c.set?.releaseDate || '',
      number:         c.number      || '',
      imageUrl:       c.images?.large || c.images?.small || '',
      apiSmall:       c.images?.small || '',
      apiLarge:       c.images?.large || '',
      hp:             c.hp          || '',
      types:          Array.isArray(c.types) ? c.types : [],
      supertype:      c.supertype   || '',
      subtype:        (c.subtypes || []).join(', '),
      rarity:         c.rarity      || '',
      artist:         c.artist      || '',
      evolvesFrom:    c.evolvesFrom || '',
      regulationMark: c.regulationMark || '',
      price:          cm.trendPrice || cm.averageSellPrice || null,
      pMin:           cm.lowPrice   || null,
      pTrend:         cm.trendPrice || null,
      p30d:           cm.avg30      || null,
      cardmarketUrl:  c.cardmarket?.url || '',
      sourceUrl:      `https://www.pokemontcg.io/cards/${c.id}`,
    };
  }

  function _normalizeTcgdex(c) {
    if (!c) return null;
    const imgBase = c.image || '';
    return {
      _source:   'tcgdex',
      apiId:     c.id || `${c.set?.id || 'unk'}-${c.localId || '0'}`,
      name:      c.name      || '',
      set:       c.set?.name || c.set?.id || '',
      setCode:   c.set?.id   || '',
      setId:     c.set?.id   || '',
      number:    c.localId   || '',
      imageUrl:  imgBase ? imgBase + '/high.webp' : '',
      apiSmall:  imgBase ? imgBase + '/low.webp'  : '',
      apiLarge:  imgBase ? imgBase + '/high.webp' : '',
      hp:        c.hp  ? String(c.hp) : '',
      types:     Array.isArray(c.types) ? c.types : [],
      supertype: c.category || 'Pokémon',
      subtype:   '',
      rarity:    c.rarity      || '',
      artist:    c.illustrator || '',
      price:     null,
      pMin:      null,
      pTrend:    null,
      p30d:      null,
      sourceUrl: `https://www.tcgdex.net/database/${c.set?.id || ''}/${c.localId || ''}`,
    };
  }

  // ─── Deduplikace ─────────────────────────────────────────────────────────────

  function _dedup(cards) {
    const seen = new Set();
    return cards.filter(c => {
      if (!c?.apiId) return true;
      if (seen.has(c.apiId)) return false;
      seen.add(c.apiId);
      return true;
    });
  }

  // ─── Veřejné API ─────────────────────────────────────────────────────────────

  const PkSearch = {

    /**
     * Konfigurace přepínatelných zdrojů.
     * Automaticky načtena z localStorage.
     *
     * PkSearch.config.toggle('imageSearch')  → zapne/vypne
     * PkSearch.config.isEnabled('tcgio')     → boolean
     * PkSearch.config.sources                → { tcgio, tcgdex, imageSearch }
     */
    config: (function () {
      let _s = _loadSources();
      return {
        get sources() { return { ..._s }; },
        isEnabled(key) { return _s[key] !== false; },
        toggle(key) {
          _s[key] = !_s[key];
          _saveSources(_s);
          // Aktualizuj všechna tlačítka v UI
          document.querySelectorAll(`[data-src-toggle="${key}"]`).forEach(btn => {
            btn.classList.toggle('src-on',  _s[key]);
            btn.classList.toggle('src-off', !_s[key]);
            btn.title = _s[key] ? 'Klikni pro vypnutí' : 'Klikni pro zapnutí';
          });
          console.log(`[PkSearch] Zdroj "${key}" → ${_s[key] ? 'ZAPNUTO' : 'VYPNUTO'}`);
          return _s[key];
        },
        setAll(sources) {
          _s = { ..._s, ...sources };
          _saveSources(_s);
        },
      };
    }()),

    /**
     * Hlavní vyhledávací funkce s kompletním skórovacím systémem.
     *
     * @param {string} name
     * @param {object} opts  – set, number, lang, hp, variant, rarity, types, pageSize, onStatus
     * @returns {Promise<Array>} Seřazené karty (nejlepší shoda první), každá má _score
     */
    async search(name, opts = {}) {
      const {
        set       = '',
        number    = '',
        lang      = 'EN',
        hp        = null,
        variant   = '',
        rarity    = '',
        types     = [],
        pageSize  = 24,
        onStatus  = null,
      } = opts;

      const status  = msg => { if (onStatus) onStatus(msg); };
      const src     = this.config.sources;
      const isNonEn = (lang && lang !== 'EN') || /[\u3000-\u9fff\uff00-\uffef]/.test(name || '');
      const ctx     = { name, set, number, hp, variant, rarity, types, lang };

      // ── Naučená shoda? Vrátíme ji s velkým bonusem ─────────────────────
      const learned = _getLearn(name, set, number);

      let cards = [];

      // ── VĚTEV A: ne-anglická karta ──────────────────────────────────────
      if (isNonEn) {
        let enName = '';

        if (src.tcgdex) {
          // A1: Přeložit přes TCGdex
          status('🌐 Překládám přes TCGdex…');
          const translated = await _tcgdexTranslate(name, lang, hp);
          if (translated?.enName) {
            enName = translated.enName;
            console.log(`[PkSearch] Překlad: "${name}" (${lang}) → "${enName}"`);
          }

          // A2: Fallback hledání v TCGdex EN
          if (!enName) {
            const dexEN = await _tcgdexByName(name, 'en', hp);
            if (dexEN.length) enName = dexEN[0].name;
          }

          // A3: Přímý lookup TCGdex (set + číslo)
          if (set && number) {
            const setId = set.replace(/EN$|JP$|DE$|FR$/i, '').toLowerCase();
            const dexCard = await _tcgdexDirect(setId, number, lang);
            if (dexCard) {
              cards.push(_normalizeTcgdex(dexCard));
              if (!enName && dexCard.name) enName = dexCard.name;
            }
          }
        }

        // A4: Hledej EN ekvivalent na pokemontcg.io
        if (src.tcgio && enName) {
          status(`🔍 Hledám EN ekvivalent: ${enName}…`);
          const q = _buildTcgQuery(enName, '', '');
          const tcgCards = await _searchTcgIo(q, pageSize);
          const normalized = tcgCards.map(_normalizeTcgIo).filter(Boolean);
          cards = _dedup([...cards, ...normalized]);
        }

        // A5: Wildcard fallback
        if (!cards.length && src.tcgio && enName) {
          const firstWord = enName.split(' ')[0];
          status(`🔍 Zkouším ${firstWord}*…`);
          const tcgCards = await _searchTcgIo(`name:${firstWord}*`, pageSize);
          cards = _dedup([...cards, ...tcgCards.map(_normalizeTcgIo).filter(Boolean)]);
        }
      }

      // ── VĚTEV B: anglická karta ─────────────────────────────────────────
      else {
        const enName = (name || '').trim();

        if (src.tcgio) {
          // B1: Přesný dotaz (jméno + set + číslo)
          if (enName && (set || number)) {
            const q = _buildTcgQuery(enName, set, number);
            status(`🔍 Hledám: ${q}…`);
            let tcgCards = await _searchTcgIo(q, pageSize);

            // B1b: zkus set jako set.id
            if (!tcgCards.length && set) {
              const setLower = set.replace(/EN$|JP$/i, '').toLowerCase();
              const q2 = _buildTcgQuery(enName, setLower, number);
              if (q2 !== q) {
                status(`🔍 Zkouším set.id: ${setLower}…`);
                tcgCards = await _searchTcgIo(q2, pageSize);
              }
            }

            // B1c: zkus jen jméno + číslo bez série
            // Důvod: AI může napsat "Obsidian Flames" ale API set se jmenuje jinak.
            // Bez B1c spadneme na B2 (jen jméno) a scoring vybere kartu z jiné populárnější série.
            if (!tcgCards.length && number && enName) {
              const numClean = String(number).split('/')[0].replace(/\D/g, '');
              if (numClean) {
                const q3 = `name:"${enName.replace(/"/g, '')}" number:${numClean}`;
                status(`🔍 Zkouším jméno + číslo (bez série)…`);
                tcgCards = await _searchTcgIo(q3, pageSize);
              }
            }

            // B1d: zkus set.ptcgoCode přes zkratku (např. "OBF", "MEW", "PAL")
            // AI někdy vrátí set jako zkratku místo plného názvu
            if (!tcgCards.length && set && /^[A-Z0-9]{2,6}$/.test(set.trim())) {
              const q4 = `name:"${enName.replace(/"/g, '')}" set.ptcgoCode:${set.trim()}`;
              status(`🔍 Zkouším ptcgoCode: ${set.trim()}…`);
              tcgCards = await _searchTcgIo(q4, pageSize);
            }
            cards = _dedup([...cards, ...tcgCards.map(_normalizeTcgIo).filter(Boolean)]);
          }

          // B2: Jen jméno (přesné)
          if (!cards.length && enName) {
            status(`🔍 Hledám: ${enName}…`);
            const tcgCards = await _searchTcgIo(`name:"${enName}"`, pageSize);
            cards = _dedup([...cards, ...tcgCards.map(_normalizeTcgIo).filter(Boolean)]);
          }

          // B3: Wildcard
          if (!cards.length && enName) {
            const firstWord = enName.split(' ')[0];
            status(`🔍 Zkouším ${firstWord}*…`);
            const tcgCards = await _searchTcgIo(`name:${firstWord}*`, pageSize);
            cards = _dedup([...cards, ...tcgCards.map(_normalizeTcgIo).filter(Boolean)]);
          }
        }

        // B4: TCGdex fallback
        if (!cards.length && src.tcgdex && enName) {
          status('🔍 Zkouším TCGdex…');
          const dexCards = await _tcgdexByName(enName, 'en', hp);
          let best = dexCards;
          if (number) {
            const n = String(number).split('/')[0];
            const byNum = dexCards.filter(c =>
              String(c.localId) === n || String(c.localId) === n.padStart(3, '0')
            );
            if (byNum.length) best = byNum;
          }
          cards = _dedup([...cards, ...best.map(_normalizeTcgdex).filter(Boolean)]);
        }
      }

      // ── Seřadit dle skórovacího systému ──────────────────────────────────
      cards = _rankCards(cards, ctx);

      // ── Aplikuj naučenou shodu (velký bonus na top pozici) ───────────────
      if (learned) {
        const learnedIdx = cards.findIndex(c => c.apiId === learned.apiId);
        if (learnedIdx > 0) {
          // Přesuň na pozici 0 s bonusem
          const learnedCard = { ...cards[learnedIdx], _score: (cards[learnedIdx]._score || 0) + 100, _learned: true };
          cards.splice(learnedIdx, 1);
          cards.unshift(learnedCard);
          console.log(`[PkSearch] 🧠 Naučená shoda: "${learned.name}" přesunuta na 1. místo`);
        } else if (learnedIdx === 0) {
          cards[0] = { ...cards[0], _learned: true };
        }
      }

      return cards;
    },

    /**
     * Seřadí existující kandidáty podle fotky pomocí Groq vision.
     * Volejte AFTER search(), předejte výsledky a foto URL.
     *
     * @param {string}   photoUrl   – Veřejná URL fotky (nebo data URL)
     * @param {Array}    candidates – Pole karet z PkSearch.search()
     * @param {string}   groqProxy  – Proxy endpoint pro Groq, default '/api/groq'
     * @param {string}   groqKey    – Groq API klíč
     * @param {Function} onStatus   – Status callback
     * @returns {Promise<Array>} Nově seřazení kandidáti s _imageScore
     */
    async scoreByImage(photoUrl, candidates, groqProxy = '/api/groq', groqKey = '', onStatus = null) {
      if (!this.config.isEnabled('imageSearch')) return candidates;
      return await _scoreByImage(photoUrl, candidates, { groqProxy, groqKey, onStatus });
    },

    /**
     * Zaznamenaj správnou shodu. Volej když uživatel ručně vybere kartu.
     * Při příštím hledání stejného dotazu bude tato karta upřednostněna.
     *
     * @param {string} name   – AI rozpoznaný název karty
     * @param {string} set    – AI rozpoznaný set
     * @param {string} number – AI rozpoznané číslo
     * @param {object} card   – Vybraná karta (unified formát z PkSearch)
     */
    recordMatch(name, set, number, card) {
      if (!card?.apiId) return;
      _recordLearn(name, set, number, card);
    },

    /**
     * Vrátí statistiky o naučených shodách.
     * @returns {{ count: number, max: number }}
     */
    learnStats: _getLearnStats,

    /**
     * Vymaže všechny naučené shody.
     */
    clearLearnedMatches() {
      try {
        localStorage.removeItem(LEARN_KEY);
        console.log('[PkSearch] Naučené shody vymazány.');
      } catch (e) {}
    },

    /**
     * Rychlé hledání pouze na pokemontcg.io (bez TCGdex).
     */
    async searchTcgIo(name, set = '', number = '') {
      const results = [];
      if (name && (set || number)) {
        const q = _buildTcgQuery(name, set, number);
        const r = await _searchTcgIo(q, 24);
        results.push(...r.map(_normalizeTcgIo).filter(Boolean));
      }
      if (!results.length && name) {
        const r = await _searchTcgIo(`name:"${name}"`, 24);
        results.push(...r.map(_normalizeTcgIo).filter(Boolean));
      }
      if (!results.length && name) {
        const r = await _searchTcgIo(`name:${name.split(' ')[0]}*`, 24);
        results.push(...r.map(_normalizeTcgIo).filter(Boolean));
      }
      const ctx = { name, set, number };
      return _rankCards(_dedup(results), ctx);
    },

    /**
     * Načte konkrétní kartu dle ID.
     */
    async fetchById(id) {
      if (!id) return null;
      const data = await _tcgProxyFetch(`https://api.pokemontcg.io/v2/cards/${encodeURIComponent(id)}`);
      return data?.data ? _normalizeTcgIo(data.data) : null;
    },

    /**
     * Načte kartu z TCGdex.
     */
    async fetchFromTcgdex(setId, localId, lang = 'en') {
      const raw = await _tcgdexDirect(setId, localId, lang);
      return raw ? _normalizeTcgdex(raw) : null;
    },

    /**
     * Přeloží non-EN název do EN přes TCGdex.
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
     * Normalizuje raw kartu z libovolného zdroje.
     */
    normalize(rawCard) {
      if (!rawCard) return null;
      if (rawCard._source) return rawCard;
      if ('localId' in rawCard || 'category' in rawCard) return _normalizeTcgdex(rawCard);
      return _normalizeTcgIo(rawCard);
    },

    /** Helpers */
    detectSetType: _detectSetType,
    buildQuery:    _buildTcgQuery,
    scoreCard:     _scoreCard,
  };

  global.PkSearch = PkSearch;

})(typeof window !== 'undefined' ? window : global);


/* =============================================================================
   ZPĚTNÁ KOMPATIBILITA – shims pro starý kód
============================================================================= */

if (typeof window !== 'undefined') {

  window.fetchTcgCard = async function (name, set, number) {
    const results = await PkSearch.search(name, { set, number });
    if (!results.length) return null;
    const c = results[0];
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

  window.fetchPokemontcgImage = async function (name, number, set) {
    const results = await PkSearch.searchTcgIo(name, set, number);
    if (!results.length) return null;
    return results[0].apiLarge || results[0].apiSmall || null;
  };
}
