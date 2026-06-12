/**
 * translate-local.js — Slovníkový překlad PŘED voláním AI
 * ════════════════════════════════════════════════════════════════
 * 1) Překlad jmen Pokémonů (JP/KO/ZH/DE/FR/ES/RU/TH → EN)
 *    pomocí pokemon-names.json (mapy `n` jména a `p` prefixy
 *    regionálních forem: ヒスイ→Hisuian, ガラル→Galarian…).
 *    Přípony V / VMAX / VSTAR / ex / GX se zachovají.
 *
 * 2) Mapa japonských setů → mezinárodní set ID (pokemontcg.io).
 *    JP čísluje jinak (s10D 007/067 ≠ ASR 017/189), proto se
 *    NEPŘEKLÁDÁ číslo, ale SET — jméno pak kartu najde.
 *
 * 3) Automaticky obalí window.PkSearch.search(), takže queue,
 *    scanner i ostatní stránky dostanou překlad zadarmo.
 *
 * INTEGRACE: <script src="translate-local.js"></script>
 *            vložit ZA card-search.js (na queue.html, scanner.html,
 *            bulk-scan.html, moje-album.html).
 * ════════════════════════════════════════════════════════════════
 */
(function (global) {
  'use strict';

  // ─── JP set → EN set (pokemontcg.io id) ──────────────────────
  // Hodnota = primární EN set; pole = karta může být ve více EN setech
  // (JP sety se na Západě slučují). Doplňuj dle potřeby.
  const JP_SET_MAP = {
    // ── Sword & Shield éra ──
    's1w': 'swsh1',  's1h': 'swsh1',                    // Sword / Shield
    's1a': ['swsh2', 'swsh1'],                          // VMAX Rising
    's2':  'swsh2',                                     // Rebellion Crash → Rebel Clash
    's2a': 'swsh3',                                     // Explosive Walker
    's3':  'swsh3',                                     // Infinity Zone → Darkness Ablaze
    's3a': ['swsh35', 'swsh4'],                         // Legendary Heartbeat → Champion's Path
    's4':  'swsh4',                                     // Astonishing Volt Tackle → Vivid Voltage
    's4a': 'swsh45',                                    // Shiny Star V → Shining Fates
    's5i': 'swsh5',  's5r': 'swsh5',                    // Single/Rapid Strike → Battle Styles
    's5a': 'swsh6',                                     // Matchless Fighters
    's6h': 'swsh6',  's6k': 'swsh6',                    // Silver Lance / Jet-Black → Chilling Reign
    's6a': 'swsh7',                                     // Eevee Heroes → Evolving Skies
    's7d': 'swsh7',  's7r': 'swsh7',                    // Skyscraping / Blue Sky Stream
    's8':  'swsh8',                                     // Fusion Arts → Fusion Strike
    's8a': 'cel25',                                     // 25th Anniversary → Celebrations
    's8b': ['swsh9', 'swsh8'],                          // VMAX Climax (→ Trainer Gallery BRS)
    's9':  'swsh9',                                     // Star Birth → Brilliant Stars
    's9a': 'swsh10',                                    // Battle Region
    's10d': 'swsh10', 's10p': 'swsh10',                 // Time Gazer / Space Juggler → Astral Radiance
    's10a': 'swsh11',                                   // Dark Phantasma → Lost Origin
    's11': 'swsh11',                                    // Lost Abyss → Lost Origin
    's11a': 'swsh12',                                   // Incandescent Arcana → Silver Tempest
    's12': 'swsh12',                                    // Paradigm Trigger → Silver Tempest
    's12a': 'swsh12pt5',                                // VSTAR Universe → Crown Zenith
    // ── Scarlet & Violet éra ──
    'sv1s': 'sv1',   'sv1v': 'sv1',                     // Scarlet ex / Violet ex
    'sv1a': 'sv2',                                      // Triplet Beat → Paldea Evolved
    'sv2d': 'sv2',   'sv2p': 'sv2',                     // Snow Hazard / Clay Burst
    'sv2a': 'sv3pt5',                                   // Pokémon 151
    'sv3': 'sv3',                                       // Ruler of the Black Flame → Obsidian Flames
    'sv3a': 'sv4',                                      // Raging Surf → Paradox Rift
    'sv4k': 'sv4',   'sv4m': 'sv4',                     // Ancient Roar / Future Flash
    'sv4a': 'sv4pt5',                                   // Shiny Treasure ex → Paldean Fates
    'sv5k': 'sv5',   'sv5m': 'sv5',                     // Wild Force / Cyber Judge → Temporal Forces
    'sv5a': 'sv6',                                      // Crimson Haze → Twilight Masquerade
    'sv6': 'sv6',                                       // Mask of Change
    'sv6a': 'sv6pt5',                                   // Night Wanderer → Shrouded Fable
    'sv7': 'sv7',                                       // Stellar Miracle → Stellar Crown
    'sv7a': 'sv8',                                      // Paradise Dragona → Surging Sparks
    'sv8': 'sv8',                                       // Super Electric Breaker
    'sv8a': 'sv8pt5',                                   // Terastal Festival → Prismatic Evolutions
    'sv9': 'sv9',                                       // Battle Partners → Journey Together
    'sv9a': 'sv10',                                     // Hot Air Arena
    'sv10': 'sv10',                                     // Glory of Team Rocket → Destined Rivals
  };

  // Přípony karet, které se nepřekládají, jen zachovají (case-insensitive)
  const SUFFIX_RE = /\s*(VMAX|VSTAR|V-UNION|V|ex|EX|GX|BREAK|☆|◇|Prism Star|LV\.?X)\s*$/i;

  let _names = null;        // mapa cizí jméno → EN
  let _prefixes = null;     // mapa prefix (ヒスイ, Galar-, …) → EN prefix
  let _loadPromise = null;

  function _load() {
    if (_names) return Promise.resolve();
    if (_loadPromise) return _loadPromise;
    _loadPromise = fetch('pokemon-names.json')
      .then(r => r.json())
      .then(d => {
        _names    = d.n || {};
        _prefixes = d.p || {};
        console.log(`[PkLocal] slovník načten: ${Object.keys(_names).length} jmen, ${Object.keys(_prefixes).length} prefixů`);
      })
      .catch(e => {
        console.warn('[PkLocal] pokemon-names.json se nepodařilo načíst:', e.message);
        _names = {}; _prefixes = {};
      })
      .finally(() => { _loadPromise = null; });
    return _loadPromise;
  }

  /** Je řetězec pravděpodobně už anglicky? (jen latinka bez diakritiky JP/KO/ZH/TH/RU) */
  function looksEnglish(s) {
    return !/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0e00-\u0e7f\u0400-\u04ff]/.test(s || '');
  }

  /**
   * Přeloží jméno karty do EN. Vrací { name, translated, prefix }.
   * Např. "ヒスイドレディアV" → { name: "Hisuian Lilligant V", translated: true }
   */
  function translateName(raw) {
    const input = String(raw || '').trim();
    if (!input || !_names) return { name: input, translated: false };

    // 1) Oddělit příponu (V, VMAX, ex…)
    let base = input, suffix = '';
    const sm = input.match(SUFFIX_RE);
    if (sm) { suffix = sm[1]; base = input.slice(0, sm.index).trim(); }

    // 2) Oddělit prefix regionální formy (nejdelší shoda)
    let prefixEn = '';
    if (_prefixes) {
      const keys = Object.keys(_prefixes).sort((a, b) => b.length - a.length);
      for (const p of keys) {
        if (base.startsWith(p)) { prefixEn = _prefixes[p]; base = base.slice(p.length).trim(); break; }
        // varianta s mezerou/pomlčkou na konci prefixu už je v mapě (Galar-, de Hisui…)
      }
    }

    // 3) Samotné jméno — přímá shoda, pak shoda bez mezer
    let en = _names[base] || _names[base.replace(/\s+/g, '')] || null;

    // 4) Nic? Zkusit celé původní jméno (pro jednoslovné záznamy)
    if (!en && !prefixEn && !suffix) en = _names[input] || null;

    if (!en) {
      // Nepřeloženo — vrátit původní (volající může zkusit LLM fallback)
      return { name: input, translated: false, prefix: prefixEn || null };
    }

    const out = [prefixEn, en, suffix].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    return { name: out, translated: true, prefix: prefixEn || null };
  }

  /** Přeloží JP set kód na EN set id. Vrací { setId, all, translated }. */
  function jpSetToEn(rawSet) {
    const key = String(rawSet || '').trim().toLowerCase();
    if (!key) return { setId: '', all: [], translated: false };
    const hit = JP_SET_MAP[key];
    if (!hit) return { setId: key, all: [key], translated: false };
    const arr = Array.isArray(hit) ? hit : [hit];
    return { setId: arr[0], all: arr, translated: true };
  }

  /**
   * Obohatí dotaz pro hledání: přeloží jméno i set, NEPŘENÁŠÍ číslo
   * mezi regiony (JP číslování ≠ EN). Vrací nový objekt + _pkLocal info.
   */
  function enrichQuery(q) {
    const out = Object.assign({}, q);
    const info = { nameTranslated: false, setTranslated: false };

    if (out.name && !looksEnglish(out.name)) {
      const t = translateName(out.name);
      if (t.translated) { out.name = t.name; info.nameTranslated = true; }
    }
    const isJpLang = String(out.lang || '').toUpperCase().startsWith('JP')
                  || String(out.lang || '').toUpperCase() === 'JA';
    if (out.set && (isJpLang || /^s(v)?\d/i.test(out.set))) {
      const s = jpSetToEn(out.set);
      if (s.translated) {
        out.set = s.setId;
        out._setCandidates = s.all;
        info.setTranslated = true;
        // JP číslo v EN setu neplatí → nepoužívat jako filtr, jen jako tiebreak
        if (isJpLang && out.number) { out._jpNumber = out.number; delete out.number; }
      }
    }
    out._pkLocal = info;
    return out;
  }

  // ─── Neinvazivní integrace: obalit PkSearch.search ───────────
  function wrapPkSearch() {
    const PS = global.PkSearch;
    if (!PS || typeof PS.search !== 'function' || PS.__pkLocalWrapped) return false;
    const orig = PS.search.bind(PS);
    PS.search = async function (name, opts = {}) {
      await _load();
      const enriched = enrichQuery(Object.assign({ name }, opts));
      const newName = enriched.name;
      delete enriched.name;
      if (enriched._pkLocal.nameTranslated || enriched._pkLocal.setTranslated) {
        console.log(`[PkLocal] "${name}" (${opts.set || '–'}) → "${newName}" (${enriched.set || '–'})`);
      }
      return orig(newName, enriched);
    };
    PS.__pkLocalWrapped = true;
    console.log('[PkLocal] PkSearch.search obalen slovníkovým překladem');
    return true;
  }

  // Pokusit se hned + po DOMContentLoaded (kdyby se card-search načetl později)
  _load();
  if (!wrapPkSearch()) {
    document.addEventListener('DOMContentLoaded', wrapPkSearch);
    setTimeout(wrapPkSearch, 1500);
  }

  global.PkLocal = { translateName, jpSetToEn, enrichQuery, looksEnglish, ready: _load, JP_SET_MAP };
})(window);
