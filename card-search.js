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

  // Pomocná: stáhne URL → vrátí data:image/...;base64,...
  // Když je URL už data: URL, vrátí ji nezměněnou.
  async function _toDataUrl(url) {
    if (!url) return null;
    if (url.startsWith('data:')) return url;
    try {
      const r = await fetch(url);
      if (!r.ok) return null;
      const blob = await r.blob();
      // Limit: cap na ~6 MB raw → ~8 MB base64 (Vercel body limit je 20 MB)
      if (blob.size > 6 * 1024 * 1024) {
        console.warn('[PkSearch] Foto > 6 MB, neposílám do Groq:', blob.size);
        return null;
      }
      return await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload  = () => res(reader.result);
        reader.onerror = () => rej(new Error('FileReader chyba'));
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      console.warn('[PkSearch] _toDataUrl chyba:', e.message);
      return null;
    }
  }

  async function _scoreByImage(photoUrl, candidates, { groqProxy, groqKey, onStatus } = {}) {
    if (!photoUrl || !candidates.length || !groqKey) return candidates;

    onStatus?.('🖼 Porovnávám s fotkou…');

    // ── KRITICKÝ FIX: Groq přes /api/groq vyžaduje base64 data URL.
    //    Supabase Storage signed URL Groq odmítá (nebo Vercel ořeže body
    //    při HTTP URL → server-side req.body je undefined → 400).
    //    Pošleme rovnou base64.
    const dataUrl = await _toDataUrl(photoUrl);
    if (!dataUrl) {
      console.warn('[PkSearch] Image score: nepodařilo se získat foto, vracím původní pořadí');
      return candidates;
    }

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
        // Vision MUSÍ být vision-capable model. User model z localStorage
        // může být text-only (např. llama-3.3-70b-versatile) → 400 Bad Request.
        // Hardcode na llama-4-scout, který je vision a má free tier.
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        max_tokens: 80,
        temperature: 0,           // deterministika
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: dataUrl } },
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


  // ══════════════════════════════════════════════════════════════
  //  SET ALIAS MAP – mapování AI názvů → pokemontcg.io set.id
  //
  //  Proč: AI čte sadu ze skenované karty a může napsat
  //  "Dragon Majesty", "Forbidden Light", "Obsidian Flames" apod.
  //  API používá krátké ID (drm, sm6, sv3). Tato tabulka překládá
  //  všechny běžné varianty → správné ID, takže vyhledávání najde
  //  kartu i když AI napíše název sady "po lidsku".
  //
  //  Klíče: lowercase, bez diakritiky, bez interpunkce.
  //  Hodnoty: pokemontcg.io set.id (použito v set.id:"..." query).
  // ══════════════════════════════════════════════════════════════

  const SET_ALIAS_MAP = {
    // ── Scarlet & Violet ────────────────────────────────────────
    'scarlet violet':                          'sv1',
    'scarlet and violet':                      'sv1',
    'scarlet & violet':                        'sv1',
    'scarlet violet base':                     'sv1',
    'sv base':                                 'sv1',
    'sv1':                                     'sv1',

    'paldea evolved':                          'sv2',
    'sv2':                                     'sv2',

    'obsidian flames':                         'sv3',
    'sv3':                                     'sv3',

    '151':                                     'sv3pt5',
    'pokemon 151':                             'sv3pt5',
    'scarlet violet 151':                      'sv3pt5',
    'sv3pt5':                                  'sv3pt5',

    'paradox rift':                            'sv4',
    'sv4':                                     'sv4',

    'paldean fates':                           'sv4pt5',
    'sv4pt5':                                  'sv4pt5',

    'temporal forces':                         'sv5',
    'sv5':                                     'sv5',

    'twilight masquerade':                     'sv6',
    'sv6':                                     'sv6',

    'shrouded fable':                          'sv6pt5',
    'sv6pt5':                                  'sv6pt5',

    'stellar crown':                           'sv7',
    'sv7':                                     'sv7',

    'surging sparks':                          'sv8',
    'sv8':                                     'sv8',

    'prismatic evolutions':                    'sv8pt5',
    'sv8pt5':                                  'sv8pt5',

    // ── Sword & Shield ─────────────────────────────────────────
    'sword shield':                            'swsh1',
    'sword and shield':                        'swsh1',
    'sword & shield':                          'swsh1',
    'swsh1':                                   'swsh1',

    'rebel clash':                             'swsh2',
    'swsh2':                                   'swsh2',

    'darkness ablaze':                         'swsh3',
    'swsh3':                                   'swsh3',

    'champions path':                          'swsh35',
    "champion's path":                         'swsh35',
    'swsh35':                                  'swsh35',

    'vivid voltage':                           'swsh4',
    'swsh4':                                   'swsh4',

    'shining fates':                           'swsh45',
    'swsh45':                                  'swsh45',

    'battle styles':                           'swsh5',
    'swsh5':                                   'swsh5',

    'chilling reign':                          'swsh6',
    'swsh6':                                   'swsh6',

    'evolving skies':                          'swsh7',
    'swsh7':                                   'swsh7',

    'fusion strike':                           'swsh8',
    'swsh8':                                   'swsh8',
    's8f':                                     'swsh8',   // ZH Fusion Strike bundle → TCGdex/pokemontcg.io swsh8

    'brilliant stars':                         'swsh9',
    'swsh9':                                   'swsh9',

    'astral radiance':                         'swsh10',
    'swsh10':                                  'swsh10',

    'pokemon go':                              'swsh10pt5',
    'pokémon go':                              'swsh10pt5',
    'swsh10pt5':                               'swsh10pt5',

    'lost origin':                             'swsh11',
    'swsh11':                                  'swsh11',

    'silver tempest':                          'swsh12',
    'swsh12':                                  'swsh12',

    'crown zenith':                            'swsh12pt5',
    'swsh12pt5':                               'swsh12pt5',

    // ── Sun & Moon ─────────────────────────────────────────────
    'sun moon':                                'sm1',
    'sun and moon':                            'sm1',
    'sun & moon':                              'sm1',
    'sun moon base':                           'sm1',
    'sm1':                                     'sm1',

    'guardians rising':                        'sm2',
    'sm2':                                     'sm2',

    'burning shadows':                         'sm3',
    'sm3':                                     'sm3',

    'shining legends':                         'sm35',
    'sm35':                                    'sm35',

    'crimson invasion':                        'sm4',
    'sm4':                                     'sm4',

    'ultra prism':                             'sm5',
    'sm5':                                     'sm5',

    'forbidden light':                         'sm6',
    'sm6':                                     'sm6',
    'fli':                                     'sm6',

    'celestial storm':                         'sm7',
    'sm7':                                     'sm7',

    'dragon majesty':                          'sm75',
    'sm75':                                    'sm75',
    'drm':                                     'sm75',

    'lost thunder':                            'sm8',
    'sm8':                                     'sm8',

    'team up':                                 'sm9',
    'sm9':                                     'sm9',

    'unbroken bonds':                          'sm10',
    'sm10':                                    'sm10',

    'unified minds':                           'sm11',
    'sm11':                                    'sm11',

    'hidden fates':                            'sm115',
    'sm115':                                   'sm115',

    'cosmic eclipse':                          'sm12',
    'sm12':                                    'sm12',

    // ── XY ─────────────────────────────────────────────────────
    'xy':                                      'xy1',
    'xy base':                                 'xy1',
    'xy1':                                     'xy1',

    'flashfire':                               'xy2',
    'xy2':                                     'xy2',

    'furious fists':                           'xy3',
    'xy3':                                     'xy3',

    'phantom forces':                          'xy4',
    'xy4':                                     'xy4',

    'primal clash':                            'xy5',
    'xy5':                                     'xy5',

    'roaring skies':                           'xy6',
    'xy6':                                     'xy6',

    'ancient origins':                         'xy7',
    'xy7':                                     'xy7',

    'breakthrough':                            'xy8',
    'breakpoint':                              'xy9',
    'xy8':                                     'xy8',
    'xy9':                                     'xy9',

    'fates collide':                           'xy10',
    'xy10':                                    'xy10',

    'steam siege':                             'xy11',
    'xy11':                                    'xy11',

    'evolutions':                              'xy12',
    'pokemon evolutions':                      'xy12',
    'xy12':                                    'xy12',

    // ── Black & White ──────────────────────────────────────────
    'black white':                             'bw1',
    'black and white':                         'bw1',
    'black & white':                           'bw1',
    'bw1':                                     'bw1',

    'emerging powers':                         'bw2',
    'noble victories':                         'bw3',
    'next destinies':                          'bw4',
    'dark explorers':                          'bw5',
    'dragons exalted':                         'bw6',
    'dragon vault':                            'bw62',
    'boundaries crossed':                      'bw7',
    'plasma storm':                            'bw8',
    'plasma freeze':                           'bw9',
    'plasma blast':                            'bw10',
    'legendary treasures':                     'bw11',

    // ── Base / WotC ────────────────────────────────────────────
    'base set':                                'base1',
    'base':                                    'base1',
    'jungle':                                  'jungle',
    'fossil':                                  'fossil',
    'base set 2':                              'base2',
    'team rocket':                             'rocket',
    'gym heroes':                              'gym1',
    'gym challenge':                           'gym2',
    'neo genesis':                             'neo1',
    'neo discovery':                           'neo2',
    'neo revelation':                          'neo3',
    'neo destiny':                             'neo4',
    'expedition':                              'ecard1',
    'aquapolis':                               'ecard2',
    'skyridge':                                'ecard3',
  };

  /**
   * Normalizuje název sady z AI výstupu na pokemontcg.io set.id.
   * Odstraní "Sun & Moon -", "Sword & Shield -" prefixes, lowercase, atd.
   * Vrátí { id, ptcgoCode } nebo null pokud shoda nenalezena.
   */
  function _normalizeSet(setStr) {
    if (!setStr) return null;

    // Odstraň běžné prefixes které AI přidává
    let s = setStr
      .replace(/^sun\s*[&and]+\s*moon\s*[-–—:]\s*/i, '')
      .replace(/^sword\s*[&and]+\s*shield\s*[-–—:]\s*/i, '')
      .replace(/^scarlet\s*[&and]+\s*violet\s*[-–—:]\s*/i, '')
      .replace(/^sm\s*[-–—]\s*/i, '')
      .replace(/^swsh\s*[-–—]\s*/i, '')
      .replace(/^sv\s*[-–—]\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      // Odstranit interpunkci kromě & a apostrofu
      .replace(/[.,!?;]/g, '');

    // Přímá shoda
    if (SET_ALIAS_MAP[s]) return { id: SET_ALIAS_MAP[s] };

    // Fuzzy: zkus originál bez normalizace
    const orig = setStr.trim().toLowerCase().replace(/[.,!?;]/g, '');
    if (SET_ALIAS_MAP[orig]) return { id: SET_ALIAS_MAP[orig] };

    // Zkus odebrat koncovky jako "en", "jp", "de", "fr"
    const stripped = s.replace(/\s*(en|jp|de|fr|cz|it|es|pt|ko)$/i, '').trim();
    if (SET_ALIAS_MAP[stripped]) return { id: SET_ALIAS_MAP[stripped] };

    // Zkus ptcgoCode (krátké kódy jako OBF, FLI, PAL, MEW...)
    const upper = setStr.trim().toUpperCase();
    const PTCGO_MAP = {
      OBF: 'sv3', PAL: 'sv2', MEW: 'sv3pt5', PAR: 'sv4', TEF: 'sv5', TWM: 'sv6',
      SFA: 'sv6pt5', SCR: 'sv7', SSP: 'sv8', PRE: 'sv8pt5',
      CRZ: 'swsh12pt5', SIT: 'swsh12', LOR: 'swsh11', PGO: 'swsh10pt5',
      ASR: 'swsh10', BST: 'swsh5', CRE: 'swsh6', EVS: 'swsh7', FST: 'swsh8',
      BRS: 'swsh9', SHF: 'swsh45', VIV: 'swsh4', CPA: 'swsh35', DAA: 'swsh3',
      RCL: 'swsh2', SSH: 'swsh1', CEC: 'sm12', HIF: 'sm115', UNM: 'sm11',
      UNB: 'sm10', TEU: 'sm9', LOT: 'sm8', DRM: 'sm75', CES: 'sm7',
      FLI: 'sm6', UPR: 'sm5', CIN: 'sm4', SHL: 'sm35', BUS: 'sm3',
      GRI: 'sm2', SUM: 'sm1', XY: 'xy1', FLF: 'xy2', FFI: 'xy3',
      PHF: 'xy4', PRC: 'xy5', ROS: 'xy6', AOR: 'xy7', BKT: 'xy8',
      BKP: 'xy9', FCO: 'xy10', STS: 'xy11', EVO: 'xy12',
    };
    if (PTCGO_MAP[upper]) return { id: PTCGO_MAP[upper], ptcgoCode: upper };

    return null;
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
    if (name) parts.push(`name:"${name.replace(/"/g, '')}"`);
    if (set) {
      // Nejprve zkus normalizovat přes SET_ALIAS_MAP
      const norm = _normalizeSet(set);
      if (norm?.ptcgoCode) {
        parts.push(`set.ptcgoCode:"${norm.ptcgoCode}"`);
      } else if (norm?.id) {
        parts.push(`set.id:"${norm.id}"`);
      } else {
        // Fallback: původní logika
        const t = _detectSetType(set);
        if (t === 'ptcgoCode') parts.push(`set.ptcgoCode:"${set}"`);
        else if (t === 'id')   parts.push(`set.id:"${set}"`);
        else                   parts.push(`set.name:"${set.replace(/"/g, '')}"`);
      }
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
    const lRaw = LANG_TO_TCGDEX[lang?.toUpperCase()] || 'en';
    // zh-Hans / zh-Hant: TCGdex nemá data pro japonské/čínské sety → rovnou EN
    const l = (lRaw === 'zh-Hans' || lRaw === 'zh-Hant') ? 'en' : lRaw;
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

  // ── _tcgdexDirect (v3 — single shot, žádný probing storm) ─────────────
  async function _tcgdexDirect(setId, localId, lang = 'en') {
    if (!setId || !localId) return null;
    const lRaw = LANG_TO_TCGDEX[lang?.toUpperCase()] || 'en';
    const l = (lRaw === 'zh-Hans' || lRaw === 'zh-Hant') ? 'ja' : lRaw;
    const sid = (l === 'ja')
      ? setId.toLowerCase().replace(/f$/, '')
      : setId.toLowerCase();
    const num = String(localId).split('/')[0].padStart(3, '0');
    try {
      const data = await _fetch(`${TCGDEX_BASE}/${l}/sets/${sid}/${num}`);
      return (data && data.name) ? data : null;
    } catch (_) {
      return null;
    }
  }

  // ── _tcgdexTranslate (v3 — single shot, žádný cross-namespace ID lookup) ─
  async function _tcgdexTranslate(origName, lang, hp = null, setHint = '', numberHint = '') {
    if (!origName || !lang) return null;
    const l = LANG_TO_TCGDEX[lang.toUpperCase()];
    if (!l || l === 'en') return null;
    const isZh = l === 'zh-Hans' || l === 'zh-Hant';

    // KROK 1: Pro ZH/JP karty se set+number → 1 přímý JA pokus
    if ((isZh || l === 'ja') && setHint && numberHint) {
      const jaSetId = String(setHint).toLowerCase().replace(/f$/, '');
      const num     = String(numberHint).split('/')[0].padStart(3, '0');

      try {
        const jaCard = await _fetch(`${TCGDEX_BASE}/ja/sets/${jaSetId}/${num}`);
        if (jaCard?.name) {
          console.log(`[PkSearch] ✓ TCGdex JA hit: ${jaSetId}/${num} → ${jaCard.name}`);

          // EN ekvivalent jen přes dexId (ne cross-namespace by ID, to vždy 404)
          let enCard = null;
          if (Array.isArray(jaCard.dexId) && jaCard.dexId.length) {
            const searchHp = hp || jaCard.hp;
            const q = `dexId=${jaCard.dexId[0]}${searchHp ? `&hp=${searchHp}` : ''}`;
            const enList = await _fetch(`${TCGDEX_BASE}/en/cards?${q}`);
            if (Array.isArray(enList) && enList.length) {
              enCard = await _fetch(`${TCGDEX_BASE}/en/cards/${enList[0].id}`);
            }
          }

          return {
            enName:         enCard?.name || jaCard.name,
            enCard:         enCard || null,
            origImage:      jaCard.image ? jaCard.image + '/high.webp' : null,
            origImageSmall: jaCard.image ? jaCard.image + '/low.webp'  : null,
          };
        }
      } catch (_) { /* tiše */ }
      // miss → pokračuj na KROK 2
    }

    // KROK 2: Hledej podle jména v primárním locale (de/fr/it)
    const searchLocale = isZh ? 'ja' : l;
    let results = await _fetch(`${TCGDEX_BASE}/${searchLocale}/cards?name=${encodeURIComponent(origName)}`);

    if ((!Array.isArray(results) || !results.length) && searchLocale !== 'en') {
      results = await _fetch(`${TCGDEX_BASE}/en/cards?name=${encodeURIComponent(origName)}`);
    }

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

    const enCard = await _fetch(`${TCGDEX_BASE}/en/cards/${cardId}`);
    if (!enCard?.name) return null;

    const origCard = (l !== 'en' && !isZh)
      ? await _fetch(`${TCGDEX_BASE}/${l}/cards/${cardId}`)
      : null;

    return {
      enName:         enCard.name,
      enCard,
      origImage:      origCard?.image ? origCard.image + '/high.webp' : null,
      origImageSmall: origCard?.image ? origCard.image + '/low.webp'  : null,
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
      _imageSource:   'en_official',
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
      _imageSource: 'tcgdex_native',
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
        set           = '',
        number        = '',
        lang          = 'EN',
        hp            = null,
        variant       = '',
        rarity        = '',
        types         = [],
        pageSize      = 24,
        onStatus      = null,
        pokedexNumber = '',
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
        let enName = opts._preResolvedEnName || '';  // může být předvyplněno z queue.html (PokéAPI)

        if (src.tcgdex) {
          // A1: Přeložit přes TCGdex – přeskoč pokud nameEN již ověřen přes PokéAPI
          if (!enName) {
            status('🌐 Překládám přes TCGdex…');
            const translated = await _tcgdexTranslate(name, lang, hp);
            if (translated?.enName) {
              enName = translated.enName;
              console.log(`[PkSearch] Překlad: "${name}" (${lang}) → "${enName}"`);
            }
          } else {
            console.log(`[PkSearch] Překlad přeskočen – nameEN již znám: "${enName}"`);
          }

          // A2: Fallback hledání v TCGdex EN
          if (!enName) {
            const dexEN = await _tcgdexByName(name, 'en', hp);
            if (dexEN.length) enName = dexEN[0].name;
          }

          // A3: Přímý lookup TCGdex (set + číslo) — JEDEN POKUS
          if (set && number) {
            const dexCard = await _tcgdexDirect(set, number, lang);
            if (dexCard) {
              cards.push(_normalizeTcgdex(dexCard));
              if (!enName && dexCard.name) enName = dexCard.name;
              console.log(`[PkSearch] A3: TCGdex hit → ${dexCard.name}`);
            }
          }
        }

        // A4: Hledej EN ekvivalent na pokemontcg.io
        if (src.tcgio && enName) {
          // A4a: Nejdřív zkus hledat s původním číslem karty (pokud ZH set indexován)
          // Pokud ne, hledej bez set filtru ale se jménem
          status(`🔍 Hledám EN ekvivalent: ${enName}…`);
          const q = _buildTcgQuery(enName, '', '');
          const tcgCards = await _searchTcgIo(q, pageSize);
          const normalized = tcgCards.map(_normalizeTcgIo).filter(Boolean);
          cards = _dedup([...cards, ...normalized]);

          // A4b: Zkus přímý lookup s originálním set kódem (ZH sety jsou někdy indexovány)
          if (set && number && !cards.length) {
            status(`🔍 Zkouším originální set ${set}…`);
            const qOrig = _buildTcgQuery(enName, set, number);
            const origCards = await _searchTcgIo(qOrig, 5);
            if (origCards.length) {
              cards = _dedup([...cards, ...origCards.map(_normalizeTcgIo).filter(Boolean)]);
              console.log(`[Branch A] Nalezena karta přes originální set ${set}: ${origCards[0].name}`);
            }
          }
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
     *
     * Pokud poskytneš set + number hint (doporučeno pro ZH/JP karty), použije
     * se přímý lookup v TCGdex JA namespace — dostaneš skutečný JP obrázek
     * pro ZH/TW karty (sdílí artwork s JP originálem).
     *
     * @param {string} name        – Originální název (JP/ZH/KO/TH)
     * @param {string} lang        – Kód jazyka (JP, ZH, TW, KO, TH …)
     * @param {string|null} hp     – HP karty (pomáhá při disambiguaci)
     * @param {string} set         – Set kód (např. S8F, S8, s8a) — optional hint
     * @param {string} number      – Číslo karty (např. 016, 16/100) — optional hint
     */
    async translateViaLang(name, lang, hp = null, set = '', number = '') {
      const r = await _tcgdexTranslate(name, lang, hp, set, number);
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
    normalizeSet:  _normalizeSet,
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
