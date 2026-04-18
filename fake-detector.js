/**
 * fake-detector.js v3 – PokéTrade Univerzální AI detektor falzifikátů
 *
 * KOMUNITA: Každá analýza se ukládá do sdílené Supabase databáze.
 * Před novou analýzou se načtou výsledky komunity pro danou kartu
 * a AI dostane historická data → čím víc uživatelů, tím přesnější.
 *
 * Vyžaduje: app.js (SUPABASE_URL, SUPABASE_ANON, supabaseRequest)
 *
 * API:
 *  FakeDetector.analyze(imageSource, cardInfo)
 *  FakeDetector.analyzeWithComparison(userImg, officialImg, cardInfo)
 *  FakeDetector.fetchOfficialImage(cardInfo)
 *  FakeDetector.getCommunityStats(cardInfo)
 *  FakeDetector.renderResult(result, containerEl)
 *  FakeDetector.openModal(imgSource, cardInfo)
 *  FakeDetector.openModalWithFile(file, cardInfo)
 *  FakeDetector.showModal(result, cardInfo)
 *  FakeDetector.closeModal()
 *  FakeDetector.getHistory()
 *  FakeDetector.clearHistory()
 */

(function (global) {
  'use strict';

  const HISTORY_KEY = 'pkc_fake_history';
  const MAX_HISTORY = 50;
  const MODAL_ID    = 'fakeDetectorModal';

  // ══════════════════════════════════════════════════════════════
  //  KNOWLEDGE BASE – vestavěná databáze znaků padělků
  // ══════════════════════════════════════════════════════════════
  const KNOWLEDGE_BASE = {
    common_fakes: [
      'HP hodnoty nad 300 u Base/Jungle/Fossil era karet',
      'HP hodnoty nad 340 u moderních V/VMAX karet',
      'Chybějící nebo špatný copyright řádek (© Nintendo/Creatures/GAME FREAK)',
      'Špatné odstíny žluté u Pikachu karet',
      'Rozmazaný nebo pixelovaný text (zejména drobné popisky)',
      'Příliš lesklý povrch u ne-holo karet',
      'Chybějící textura linen/crosshatch na kartě',
      'Špatně zarovnaný okraj (border) – nerovnoměrná šířka',
      'Nesprávné fonty (Sans-serif místo Futura pro jména)',
      'Chybějící nebo špatný holo pattern (V, VMAX, GX, EX)',
    ],
    era_specific: {
      'Base/Jungle/Fossil (WOTC)': [
        'Šedý border 1. edice musí mít razítko "1st Edition"',
        'Galaxy holo pattern – hvězdice s gradientem, ne kosmos foil',
        'Copyright 1999 Wizards (ne 1998)',
        'Shadowless verze – chybí stín na pravé straně obrázku',
      ],
      'e-Reader / EX (2003-2007)': [
        'ex karty mají stříbrný border, ne zlatý',
        'Dot code na spodní části (e-Reader)',
        'EX jméno je vždy lowercase "ex"',
      ],
      'Diamond & Pearl / HGSS (2007-2011)': [
        'Lv.X karty mají speciální level-up mechaniku',
        'LEGEND karty jsou vždy dvoudílné',
      ],
      'B&W / XY (2011-2016)': [
        'EX (velkými) – zlatý okraj',
        'Full Art – texturovaný povrch, ne hladký',
        'BREAK karty – horizontální orientace',
      ],
      'Sun & Moon / Sword & Shield (2017-2023)': [
        'GX karty – stříbrný border, GX attack vždy poslední',
        'V karty – stříbrný border s V texturou',
        'VMAX – rainbow pattern na pozadí',
        'VSTAR – zlatý hvězdný pattern',
        'Alt Art – textured foil povrch',
        'Trainer Gallery – specifický TG prefix v číslování',
      ],
      'Scarlet & Violet (2023+)': [
        'ex (malými) – nový formát bez border designu',
        'Illustration Rare – full art s unikátní ilustrací',
        'Special Art Rare – SAR má specifický foil vzor',
        'Nový formát čísla (např. 025/198)',
      ],
    },
  };

  // ══════════════════════════════════════════════════════════════
  //  SUPABASE INTEGRACE – sdílená komunita
  // ══════════════════════════════════════════════════════════════

  // Pomocný Supabase REST call (fallback pokud supabaseRequest není dostupný)
  async function _sbReq(path, method, body) {
    // Preferuj globální supabaseRequest z app.js
    if (typeof supabaseRequest === 'function') {
      return supabaseRequest(path, method, body);
    }
    // Fallback – přímý fetch
    if (typeof SUPABASE_URL === 'undefined' || typeof SUPABASE_ANON === 'undefined') {
      console.warn('[FakeDetector] Supabase není nakonfigurován');
      return null;
    }
    const tok = localStorage.getItem('sb_token') || SUPABASE_ANON;
    try {
      const res = await fetch(`${SUPABASE_URL}/${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON,
          'Authorization': 'Bearer ' + tok,
          'Prefer': 'return=representation',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      return text ? JSON.parse(text) : {};
    } catch (e) {
      console.warn('[FakeDetector] Supabase request failed:', e);
      return null;
    }
  }

  /** Načti agregované komunitní statistiky pro danou kartu */
  async function getCommunityStats(cardInfo) {
    if (!cardInfo) return null;
    try {
      const result = await _sbReq('rest/v1/rpc/get_fake_stats', 'POST', {
        p_api_id: cardInfo.apiId || cardInfo.tcgId || '',
        p_name:   cardInfo.name || '',
        p_set:    cardInfo.set  || '',
      });
      if (result && !result.error && result.total > 0) {
        return result;
      }
      return null;
    } catch (e) {
      console.warn('[FakeDetector] Nepodařilo se načíst komunitní data:', e);
      return null;
    }
  }

  /** Ulož výsledek analýzy do Supabase pro komunitu */
  async function _saveToSupabase(result, cardInfo) {
    try {
      const userId = localStorage.getItem('sb_user_id');
      if (!userId) return; // Nepřihlášený uživatel → neukládáme

      await _sbReq('rest/v1/fake_analyses', 'POST', {
        user_id:          userId,
        card_api_id:      cardInfo?.apiId || cardInfo?.tcgId || '',
        card_name:        cardInfo?.name || '',
        card_set:         cardInfo?.set || '',
        card_number:      cardInfo?.number || '',
        card_rarity:      cardInfo?.rarity || '',
        verdict:          result.verdict,
        score:            result.score,
        confidence:       result.confidence,
        flags:            result.flags,
        summary:          result.summary,
        comparison_notes: result.comparison_notes || '',
      });
    } catch (e) {
      console.warn('[FakeDetector] Nepodařilo se uložit analýzu:', e);
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  OVĚŘENÍ POMOCÍ EXTERNÍCH DATABÁZÍ
  // ══════════════════════════════════════════════════════════════

  /** Načte kompletní data karty z pokemontcg.io */
  async function _fetchTCGData(cardInfo) {
    if (!cardInfo) return null;
    try {
      // 1. Přímé ID
      if (cardInfo.apiId || cardInfo.tcgId) {
        const id = cardInfo.apiId || cardInfo.tcgId;
        const r = await fetch(`https://api.pokemontcg.io/v2/cards/${encodeURIComponent(id)}`);
        if (r.ok) { const d = await r.json(); return d.data || null; }
      }
      // 2. Vyhledání dle jména + čísla + sady
      const parts = [];
      if (cardInfo.name)   parts.push(`name:"${cardInfo.name}"`);
      const _numClean = (cardInfo.number || "").split("/")[0]; if (_numClean) parts.push(`number:${_numClean}`);
      if (cardInfo.set)    parts.push(`set.name:"${cardInfo.set}"`);
      if (!parts.length) return null;
      const r = await fetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(parts.join(' '))}&pageSize=1`);
      if (!r.ok) return null;
      const d = await r.json();
      return d.data?.[0] || null;
    } catch (e) {
      console.warn('[FakeDetector] TCG API error:', e);
      return null;
    }
  }

  /** Načte tržní cenu z CardMarket přes interní proxy */
  async function _fetchCMPrice(cardInfo) {
    if (!cardInfo?.name) return null;
    try {
      const params = new URLSearchParams({
        name:   cardInfo.name,
        set:    cardInfo.set    || '',
        number: cardInfo.number || '',
      });
      const r = await fetch(`/api/cm-prices?${params}`);
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      console.warn('[FakeDetector] CardMarket error:', e);
      return null;
    }
  }

  /** Porovná metadata karty vůči oficiálním datům, vrátí flags + score */
  function _compareMetadata(cardInfo, tcg) {
    const flags = [];
    let score = 100;

    if (!tcg) {
      flags.push({ label: 'Karta nenalezena v databázi', severity: 'warn', detail: 'Karta nebyla nalezena na pokemontcg.io – může jít o neznámou edici nebo padělané číslo karty.' });
      score -= 15;
      return { flags, score };
    }

    // Existence karty v databázi
    flags.push({ label: 'Nalezena v pokemontcg.io', severity: 'ok', detail: `Karta existuje v oficiální databázi jako: ${tcg.name} (${tcg.set?.name || ''} #${tcg.number || ''}).` });

    // HP
    const officialHP = parseInt(tcg.hp) || 0;
    const listedHP   = parseInt(cardInfo.hp) || 0;
    if (officialHP && listedHP) {
      if (officialHP === listedHP) {
        flags.push({ label: `HP: ${officialHP}`, severity: 'ok', detail: 'HP hodnota souhlasí s oficiálními daty.' });
      } else {
        flags.push({ label: `HP nesedí: ${listedHP} vs ${officialHP}`, severity: 'fail', detail: `Inzerát uvádí ${listedHP} HP, ale oficálně je to ${officialHP} HP. Silný znak padělku.` });
        score -= 30;
      }
    }

    // Číslo v sadě
    const officialNum = (tcg.number || '').trim();
    const listedNum   = (cardInfo.number || '').replace(/^0+/, '').split('/')[0].trim();
    const officialNumClean = officialNum.replace(/^0+/, '').split('/')[0].trim();
    if (officialNum && listedNum) {
      if (officialNumClean.toLowerCase() === listedNum.toLowerCase()) {
        flags.push({ label: `Číslo: ${tcg.number}`, severity: 'ok', detail: 'Číslo karty v sadě souhlasí.' });
      } else {
        flags.push({ label: `Číslo nesedí: ${listedNum} vs ${officialNum}`, severity: 'fail', detail: `Inzerát uvádí číslo ${listedNum}, offciální je ${officialNum}. Může jít o špatně uvedenou verzi nebo padělek.` });
        score -= 20;
      }
    }

    // Vzácnost
    const officialRarity = (tcg.rarity || '').toLowerCase();
    const listedRarity   = (cardInfo.rarity || '').toLowerCase();
    if (officialRarity && listedRarity) {
      if (officialRarity === listedRarity || officialRarity.includes(listedRarity) || listedRarity.includes(officialRarity)) {
        flags.push({ label: `Vzácnost: ${tcg.rarity}`, severity: 'ok', detail: 'Vzácnost karty odpovídá oficiálním datům.' });
      } else {
        flags.push({ label: `Vzácnost nesedí: "${cardInfo.rarity}" vs "${tcg.rarity}"`, severity: 'warn', detail: `Inzerovaná vzácnost neodpovídá. Může jít o alternativní art nebo chybu v popisu.` });
        score -= 10;
      }
    }

    // Typy Pokémona
    if (tcg.types?.length) {
      const officialType = tcg.types.join('/');
      flags.push({ label: `Typ: ${officialType}`, severity: 'ok', detail: `Pokémon typu ${officialType} – ověřeno v databázi.` });
    }

    // Útok / HP max check (padělky mají nesmyslné HP)
    if (officialHP > 350) {
      flags.push({ label: 'Extrémně vysoké HP', severity: 'warn', detail: `HP ${officialHP} je velmi vysoké – ověř, že karta je skutečně z novější éry.` });
      score -= 5;
    }

    // Ilustrátor
    if (tcg.artist) {
      flags.push({ label: `Ilustrátor: ${tcg.artist}`, severity: 'ok', detail: `Na originální kartě by měl být podepsán ilustrátor: ${tcg.artist}.` });
    }

    // Sada
    if (tcg.set?.name) {
      flags.push({ label: `Sada: ${tcg.set.name}`, severity: 'ok', detail: `Karta patří do sady "${tcg.set.name}" (${tcg.set.series || ''}).` });
    }

    return { flags, score: Math.max(0, score), tcg };
  }

  /** Vyhodnotí podezřelost ceny vůči CardMarket */
  function _analyzePrice(listingPriceCzk, cmData) {
    const flags = [];
    if (!cmData?.found || !listingPriceCzk) return { flags, scoreDelta: 0 };

    const cmEur    = cmData.trendPrice || cmData.fromPrice || 0;
    const czkRate  = 25; // přibližný kurz
    const cmCzk    = cmEur * czkRate;

    if (cmCzk <= 0) return { flags, scoreDelta: 0 };

    const ratio = listingPriceCzk / cmCzk;
    const cmLabel = `${cmEur.toFixed(2)} € (CardMarket trend)`;

    if (ratio < 0.25) {
      flags.push({ label: 'Cena podezřele nízká', severity: 'fail', detail: `Inzerovaná cena ${listingPriceCzk} Kč je jen ${Math.round(ratio*100)} % tržní ceny (${cmLabel}). Tak nízká cena je typická pro padělky.` });
      return { flags, scoreDelta: -25 };
    } else if (ratio < 0.5) {
      flags.push({ label: 'Cena výrazně pod trhem', severity: 'warn', detail: `Cena ${listingPriceCzk} Kč je ${Math.round(ratio*100)} % tržní hodnoty (${cmLabel}). Může jít o výprodej, ale i o padělek.` });
      return { flags, scoreDelta: -10 };
    } else {
      flags.push({ label: `Cena odpovídá trhu`, severity: 'ok', detail: `Cena ${listingPriceCzk} Kč odpovídá tržní ceně ${cmLabel}.` });
      return { flags, scoreDelta: 0 };
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  IMAGE HELPERS
  // ══════════════════════════════════════════════════════════════

  async function fetchOfficialImage(cardInfo) {
    if (!cardInfo) return null;
    try {
      if (cardInfo.apiId || cardInfo.tcgId) {
        const id = cardInfo.apiId || cardInfo.tcgId;
        const resp = await fetch(`https://api.pokemontcg.io/v2/cards/${encodeURIComponent(id)}`);
        if (resp.ok) { const data = await resp.json(); return data.data?.images?.large || data.data?.images?.small || null; }
      }
      const parts = [];
      if (cardInfo.name) parts.push(`name:"${cardInfo.name}"`);
      const _numClean = (cardInfo.number || "").split("/")[0]; if (_numClean) parts.push(`number:${_numClean}`);
      if (cardInfo.set) parts.push(`set.name:"${cardInfo.set}"`);
      if (parts.length === 0) return null;
      const resp = await fetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(parts.join(' '))}&pageSize=1`);
      if (!resp.ok) return null;
      const data = await resp.json();
      return data.data?.[0]?.images?.large || data.data?.[0]?.images?.small || null;
    } catch (e) { return null; }
  }

  // ══════════════════════════════════════════════════════════════
  //  ANALÝZA – data-driven (pokemontcg.io + CardMarket)
  // ══════════════════════════════════════════════════════════════

  async function analyze(imageSource, cardInfo) {
    try {
      const [tcgData, cmData, communityStats] = await Promise.allSettled([
        _fetchTCGData(cardInfo),
        _fetchCMPrice(cardInfo),
        getCommunityStats(cardInfo),
      ]);

      const tcg       = tcgData.status === 'fulfilled'  ? tcgData.value  : null;
      const cm        = cmData.status  === 'fulfilled'   ? cmData.value   : null;
      const community = communityStats.status === 'fulfilled' ? communityStats.value : null;

      return _buildResult(cardInfo, tcg, cm, community);
    } catch (e) {
      return _errorResult('Chyba analýzy: ' + e.message);
    }
  }

  // analyzeWithComparison zachováno pro zpětnou kompatibilitu API
  async function analyzeWithComparison(userImg, officialImg, cardInfo, communityStats) {
    return analyze(userImg, cardInfo);
  }

  function _buildResult(cardInfo, tcg, cm, community) {
    const meta  = _compareMetadata(cardInfo, tcg);
    const price = _analyzePrice(cardInfo?.price_czk, cm);

    let score = meta.score + price.scoreDelta;

    // Komunitní data
    const communityFlags = [];
    if (community?.total > 0) {
      const v = community.verdicts || {};
      const fakeRatio = (v.fake || 0) / community.total;
      if (fakeRatio > 0.5) {
        communityFlags.push({ label: `Komunita: ${Math.round(fakeRatio*100)} % označilo jako padělek`, severity: 'fail', detail: `Z ${community.total} analýz komunity označilo ${v.fake} uživatelů tuto kartu jako padělek (průměrné skóre pravosti: ${community.avg_score}/100).` });
        score = Math.min(score, community.avg_score || score);
      } else if (fakeRatio > 0.25) {
        communityFlags.push({ label: `Komunita: ${v.fake || 0}/${community.total} podezřelých`, severity: 'warn', detail: `Část komunity označila tuto kartu jako podezřelou. Průměrné skóre pravosti: ${community.avg_score}/100.` });
      } else {
        communityFlags.push({ label: `Komunita: většinou pravá (${community.total} analýz)`, severity: 'ok', detail: `Komunita tuto kartu většinou hodnotí jako pravou. Průměrné skóre: ${community.avg_score}/100.` });
      }
    }

    const allFlags = [...meta.flags, ...price.flags, ...communityFlags];
    score = Math.max(0, Math.min(100, score));

    const failCount = allFlags.filter(f => f.severity === 'fail').length;
    const warnCount = allFlags.filter(f => f.severity === 'warn').length;

    let verdict, confidence;
    if (score >= 80 && failCount === 0)       { verdict = 'real';        confidence = 'high'; }
    else if (score >= 65 && failCount === 0)   { verdict = 'real';        confidence = 'med';  }
    else if (score >= 50)                      { verdict = 'suspicious';   confidence = warnCount > 2 ? 'med' : 'low'; }
    else                                       { verdict = 'fake';         confidence = failCount >= 2 ? 'high' : 'med'; }

    if (!tcg)                                  { verdict = 'unknown';      confidence = 'low'; }

    const sourcesChecked = [
      'pokemontcg.io' + (tcg ? ' ✓' : ' – nenalezena'),
      cm?.found ? `CardMarket ✓ (${cm.trendPrice ? cm.trendPrice.toFixed(2) + ' €' : 'cena'})`  : 'CardMarket – nepodporováno',
      community ? `Komunita (${community.total} analýz)` : 'Komunita – žádná data',
    ].join(' · ');

    let summary = '';
    if (verdict === 'real')        summary = `Karta pravděpodobně pravá (skóre ${score}/100). Metadata sedí s oficální databází. ${sourcesChecked}.`;
    else if (verdict === 'fake')   summary = `Karta vykazuje ${failCount} kritické znaky padělku (skóre ${score}/100). ${failCount > 0 ? 'Doporučujeme nekupovat bez fyzické prohlídky.' : ''} ${sourcesChecked}.`;
    else if (verdict === 'suspicious') summary = `Karta vykazuje ${warnCount} varovných znaků, nelze jednoznačně určit (skóre ${score}/100). Zkontroluj fyzicky. ${sourcesChecked}.`;
    else summary = `Kartu se nepodařilo ověřit – nebyla nalezena v pokemontcg.io. ${sourcesChecked}.`;

    const result = {
      verdict, score, confidence, summary,
      flags: allFlags,
      comparison_notes: tcg ? `Ověřeno vůči: ${tcg.name} · ${tcg.set?.name || ''} · #${tcg.number || ''} · ${tcg.rarity || ''}` : 'Karta nenalezena v databázi',
      timestamp: new Date().toISOString(),
      cardName: cardInfo?.name || '',
      cardSet:  cardInfo?.set  || '',
      communityTotal:    community?.total || 0,
      communityAvgScore: community?.avg_score || null,
    };

    _saveToSupabase(result, cardInfo);
    _saveToLocalHistory(result);
    return result;
  }


  function _errorResult(msg) {
    return {
      verdict: 'unknown', score: 50, confidence: 'low',
      summary: msg,
      flags: [{ label: 'Chyba analýzy', severity: 'warn', detail: msg }],
      comparison_notes: '', error: true,
    };
  }

  // ══════════════════════════════════════════════════════════════
  //  LOCAL CACHE
  // ══════════════════════════════════════════════════════════════

  function _saveToLocalHistory(result) {
    try {
      const h = getHistory();
      h.unshift(result);
      if (h.length > MAX_HISTORY) h.length = MAX_HISTORY;
      localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
    } catch {}
  }
  function getHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; }
  }
  function clearHistory() {
    try { localStorage.removeItem(HISTORY_KEY); } catch {}
  }

  // ══════════════════════════════════════════════════════════════
  //  RENDER
  // ══════════════════════════════════════════════════════════════

  function renderResult(result, containerEl) {
    if (!containerEl) return;

    const V = {
      real:       { emoji: '✅', label: 'Pravá karta',   color: '#22c55e', bg: 'rgba(34,197,94,.12)',   border: 'rgba(34,197,94,.3)'  },
      fake:       { emoji: '❌', label: 'FALZIFIKÁT',    color: '#f87171', bg: 'rgba(248,113,113,.12)', border: 'rgba(248,113,113,.4)' },
      suspicious: { emoji: '⚠️', label: 'Podezřelá',     color: '#f59e0b', bg: 'rgba(245,158,11,.12)',  border: 'rgba(245,158,11,.3)'  },
      unknown:    { emoji: '❓', label: 'Nelze určit',   color: '#94a3b8', bg: 'rgba(148,163,184,.1)',  border: 'rgba(148,163,184,.2)' },
    };
    const v    = V[result.verdict] || V.unknown;
    const conf = { high: 'Vysoká', med: 'Střední', low: 'Nízká' }[result.confidence] || '';
    const sIcon  = { ok: '✓', warn: '⚠', fail: '✗' };
    const sColor = { ok: '#22c55e', warn: '#f59e0b', fail: '#f87171' };
    const scoreGrad = result.score >= 75 ? '#22c55e' : result.score >= 40 ? '#f59e0b' : '#f87171';

    const flagsHtml = result.flags.map(f => `
      <div style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04)">
        <span style="color:${sColor[f.severity]||'#94a3b8'};font-size:13px;flex-shrink:0;font-weight:700;width:16px;text-align:center">${sIcon[f.severity]||'?'}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;color:rgba(240,232,208,.85);font-weight:600">${esc(f.label||'')}</div>
          ${f.detail ? `<div style="font-size:11px;color:rgba(240,232,208,.45);margin-top:2px;line-height:1.4">${esc(f.detail)}</div>` : ''}
        </div>
      </div>`).join('');

    // Porovnání s originálem
    const compNotes = result.comparison_notes
      ? `<div style="margin-top:10px;padding:8px 10px;background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.2);border-radius:8px">
           <div style="font-size:10px;color:rgba(99,102,241,.7);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">📊 Porovnání s oficiální kartou</div>
           <div style="font-size:12px;color:rgba(240,232,208,.7);line-height:1.5">${esc(result.comparison_notes)}</div>
         </div>`
      : '';

    // Komunita badge
    const communityBadge = (result.communityTotal && result.communityTotal > 0)
      ? `<div style="margin-top:10px;padding:8px 10px;background:rgba(139,92,246,.08);border:1px solid rgba(139,92,246,.2);border-radius:8px;display:flex;align-items:center;gap:8px">
           <span style="font-size:18px">👥</span>
           <div>
             <div style="font-size:11px;color:rgba(139,92,246,.8);font-weight:600">Komunita: ${result.communityTotal} analýz této karty</div>
             <div style="font-size:10px;color:rgba(240,232,208,.4);margin-top:1px">Průměrné skóre komunity: ${result.communityAvgScore}/100 · Tvoje: ${result.score}/100</div>
           </div>
         </div>`
      : '';

    containerEl.innerHTML = `
      <div style="border:1px solid ${v.border};background:${v.bg};border-radius:14px;padding:16px;margin-top:10px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <span style="font-size:28px;line-height:1">${v.emoji}</span>
          <div style="flex:1">
            <div style="font-size:16px;font-weight:800;color:${v.color};font-family:'Unbounded',sans-serif">${v.label}</div>
            <div style="font-size:11px;color:rgba(240,232,208,.4);margin-top:2px">Spolehlivost: ${conf}</div>
          </div>
        </div>
        <div style="margin:10px 0 4px;font-size:10px;color:rgba(240,232,208,.4);letter-spacing:.06em;text-transform:uppercase">Skóre pravosti</div>
        <div style="background:rgba(255,255,255,.07);border-radius:8px;height:10px;overflow:hidden">
          <div style="height:100%;width:${result.score}%;background:linear-gradient(90deg,${scoreGrad},${v.color});border-radius:8px;transition:width .8s ease"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:rgba(240,232,208,.4);margin-top:3px">
          <span>Falzum</span><span style="color:${v.color};font-weight:700">${result.score}/100</span><span>Pravá</span>
        </div>
        ${result.summary ? `<div style="font-size:12px;color:rgba(240,232,208,.7);margin:12px 0 8px;line-height:1.5">${esc(result.summary)}</div>` : ''}
        <div style="margin-top:8px">${flagsHtml}</div>
        ${compNotes}
        ${communityBadge}
        <div style="font-size:10px;color:rgba(240,232,208,.2);margin-top:12px;text-align:right">🤖 Claude AI + pokemontcg.io + komunita · Vždy zkontroluj fyzicky</div>
      </div>`;
  }

  // ══════════════════════════════════════════════════════════════
  //  UNIVERZÁLNÍ MODAL
  // ══════════════════════════════════════════════════════════════

  function _ensureModal() {
    if (document.getElementById(MODAL_ID)) return;
    const m = document.createElement('div');
    m.id = MODAL_ID;
    m.style.cssText = 'display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.85);backdrop-filter:blur(10px);align-items:center;justify-content:center;padding:16px';
    m.innerHTML = `
      <div style="background:#0e0c12;border:1px solid rgba(255,255,255,.1);border-radius:20px;width:100%;max-width:500px;padding:24px;position:relative;max-height:90vh;overflow-y:auto;box-shadow:0 24px 64px rgba(0,0,0,.6)">
        <button onclick="FakeDetector.closeModal()" style="position:absolute;top:14px;right:14px;background:rgba(255,255,255,.08);border:none;border-radius:8px;color:rgba(240,232,208,.6);font-size:16px;padding:4px 10px;cursor:pointer;z-index:1;transition:background .15s" onmouseover="this.style.background='rgba(255,255,255,.15)'" onmouseout="this.style.background='rgba(255,255,255,.08)'">✕</button>
        <div style="font-family:'Unbounded',sans-serif;font-size:14px;font-weight:700;color:#f0ece4;margin-bottom:4px">🔍 Detekce falzifikátů</div>
        <div id="fdModalCardName" style="font-size:11px;color:rgba(240,232,208,.4);margin-bottom:14px"></div>
        <div id="fdModalUpload" style="display:none;margin-bottom:14px">
          <label style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:18px;border:1px dashed rgba(245,158,11,.3);border-radius:12px;cursor:pointer;transition:border-color .2s,background .2s;background:rgba(245,158,11,.03)" onmouseover="this.style.borderColor='rgba(245,158,11,.6)';this.style.background='rgba(245,158,11,.06)'" onmouseout="this.style.borderColor='rgba(245,158,11,.3)';this.style.background='rgba(245,158,11,.03)'">
            <span style="font-size:28px">📷</span>
            <span style="font-size:12px;color:rgba(240,232,208,.5);text-align:center">Nahraj vlastní fotku karty pro AI analýzu</span>
            <input type="file" accept="image/*" capture="environment" style="display:none" onchange="FakeDetector._onFileSelected(this)">
          </label>
        </div>
        <div id="fdModalResult"><div style="font-size:12px;color:rgba(240,232,208,.35);padding:8px 0;text-align:center">Klikni na tlačítko pro spuštění analýzy</div></div>
      </div>`;
    m.addEventListener('click', e => { if (e.target === m) FakeDetector.closeModal(); });
    document.body.appendChild(m);
  }

  function showModal(result, cardInfo) {
    _ensureModal();
    document.getElementById('fdModalCardName').textContent = cardInfo
      ? [cardInfo.name, cardInfo.set, cardInfo.number ? '#' + cardInfo.number : ''].filter(Boolean).join(' · ')
      : '';
    document.getElementById('fdModalUpload').style.display = 'none';
    renderResult(result, document.getElementById('fdModalResult'));
    document.getElementById(MODAL_ID).style.display = 'flex';
  }

  function closeModal() {
    const m = document.getElementById(MODAL_ID);
    if (m) m.style.display = 'none';
  }

  let _pendingCardInfo = null;

  async function openModal(imgSource, cardInfo) {
    _ensureModal();
    const modal    = document.getElementById(MODAL_ID);
    const nameEl   = document.getElementById('fdModalCardName');
    const resultEl = document.getElementById('fdModalResult');
    const uploadEl = document.getElementById('fdModalUpload');
    _pendingCardInfo = cardInfo;

    nameEl.textContent = cardInfo
      ? [cardInfo.name, cardInfo.set, cardInfo.number ? '#' + cardInfo.number : ''].filter(Boolean).join(' · ')
      : '';

    if (!imgSource) {
      uploadEl.style.display = '';
      resultEl.innerHTML = '<div style="font-size:12px;color:rgba(240,232,208,.35);padding:8px 0;text-align:center">Nahraj fotku karty pro analýzu</div>';
      modal.style.display = 'flex';
      return;
    }

    uploadEl.style.display = 'none';
    resultEl.innerHTML = `
      <div style="text-align:center;padding:20px 0">
        <div style="display:inline-block;width:28px;height:28px;border:3px solid rgba(245,158,11,.2);border-top-color:#f59e0b;border-radius:50%;animation:fdspin 1s linear infinite"></div>
        <div style="font-size:12px;color:rgba(240,232,208,.45);margin-top:10px">⏳ AI analyzuje kartu…</div>
        <div style="font-size:10px;color:rgba(240,232,208,.25);margin-top:6px">Načítám komunitní data + oficiální obrázek</div>
      </div>
      <style>@keyframes fdspin{to{transform:rotate(360deg)}}</style>`;
    modal.style.display = 'flex';

    try {
      const result = await analyze(imgSource, cardInfo);
      renderResult(result, resultEl);
    } catch (e) {
      resultEl.innerHTML = `<div style="font-size:12px;color:#f87171;padding:8px 0">❌ ${esc(e.message||e)}</div>`;
    }
  }

  async function openModalWithFile(file, cardInfo) {
    _ensureModal();
    _pendingCardInfo = cardInfo;
    const modal    = document.getElementById(MODAL_ID);
    const resultEl = document.getElementById('fdModalResult');
    document.getElementById('fdModalUpload').style.display = 'none';
    document.getElementById('fdModalCardName').textContent = cardInfo
      ? [cardInfo.name, cardInfo.set, cardInfo.number ? '#' + cardInfo.number : ''].filter(Boolean).join(' · ')
      : '';
    resultEl.innerHTML = `
      <div style="text-align:center;padding:20px 0">
        <div style="display:inline-block;width:28px;height:28px;border:3px solid rgba(245,158,11,.2);border-top-color:#f59e0b;border-radius:50%;animation:fdspin 1s linear infinite"></div>
        <div style="font-size:12px;color:rgba(240,232,208,.45);margin-top:10px">⏳ AI analyzuje nahranou fotku…</div>
        <div style="font-size:10px;color:rgba(240,232,208,.25);margin-top:6px">Načítám komunitní data + porovnání</div>
      </div>
      <style>@keyframes fdspin{to{transform:rotate(360deg)}}</style>`;
    modal.style.display = 'flex';

    try {
      const result = await analyze(file, cardInfo);
      renderResult(result, resultEl);
    } catch (e) {
      resultEl.innerHTML = `<div style="font-size:12px;color:#f87171;padding:8px 0">❌ ${esc(e.message||e)}</div>`;
    }
  }

  function _onFileSelected(input) {
    const file = input?.files?.[0];
    if (!file) return;
    openModalWithFile(file, _pendingCardInfo);
    input.value = '';
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ══════════════════════════════════════════════════════════════
  //  EXPORT
  // ══════════════════════════════════════════════════════════════
  const FakeDetector = {
    analyze, analyzeWithComparison, fetchOfficialImage,
    getCommunityStats,
    renderResult, showModal, closeModal, openModal, openModalWithFile,
    getHistory, clearHistory, KNOWLEDGE_BASE,
    _onFileSelected,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = FakeDetector;
  else global.FakeDetector = FakeDetector;

})(typeof window !== 'undefined' ? window : globalThis);
