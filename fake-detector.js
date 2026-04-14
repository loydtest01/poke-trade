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
  //  PROMPT BUILDER
  // ══════════════════════════════════════════════════════════════

  function buildPrompt(cardInfo, hasComparison, communityStats) {
    const hint = cardInfo
      ? `Analyzovaná karta: ${cardInfo.name || '?'}${cardInfo.set ? ' · sada: ' + cardInfo.set : ''}${cardInfo.number ? ' #' + cardInfo.number : ''}${cardInfo.hp ? ' · ' + cardInfo.hp + ' HP' : ''}${cardInfo.rarity ? ' · vzácnost: ' + cardInfo.rarity : ''}.`
      : '';

    // Éra
    let eraHints = '';
    if (cardInfo?.set) {
      const s = (cardInfo.set || '').toLowerCase();
      for (const [era, hints] of Object.entries(KNOWLEDGE_BASE.era_specific)) {
        const e = era.toLowerCase();
        if ((s.includes('base')||s.includes('jungle')||s.includes('fossil')) && e.includes('base')) { eraHints = hints.join('\n- '); break; }
        if ((s.includes('sv')||s.includes('scarlet')||s.includes('violet')||s.includes('paldea')) && e.includes('scarlet')) { eraHints = hints.join('\n- '); break; }
        if ((s.includes('swsh')||s.includes('sword')||s.includes('shield')||s.includes('sm')||s.includes('sun')||s.includes('moon')) && (e.includes('sun')||e.includes('sword'))) { eraHints = hints.join('\n- '); break; }
        if ((s.includes('xy')||s.includes('bw')||s.includes('black')||s.includes('white')) && e.includes('b&w')) { eraHints = hints.join('\n- '); break; }
      }
    }

    // Komunitní data
    let communitySection = '';
    if (communityStats && communityStats.total > 0) {
      const cs = communityStats;
      const v = cs.verdicts || {};
      communitySection = `

COMMUNITY DATA (${cs.total} previous analyses of this card by other users):
- Average authenticity score: ${cs.avg_score}/100
- Verdicts: real=${v.real||0}, fake=${v.fake||0}, suspicious=${v.suspicious||0}, unknown=${v.unknown||0}`;

      // Nejčastější flagy od komunity
      if (cs.common_flags && cs.common_flags.length > 0) {
        communitySection += '\n- Most common flags from community:';
        for (const f of cs.common_flags.slice(0, 8)) {
          communitySection += `\n  · [${f.severity}] ${f.label} (reported ${f.count}x)`;
        }
      }

      // Nedávné shrnutí
      if (cs.recent_summaries && cs.recent_summaries.length > 0) {
        communitySection += '\n- Recent community summaries:';
        for (const s of cs.recent_summaries.slice(0, 3)) {
          communitySection += `\n  · "${s}"`;
        }
      }

      communitySection += `\n\nUse this community data to inform your analysis. If the community consistently found this card to be fake/real, give extra weight to that signal. If the community flagged specific issues, check those areas carefully.`;
    }

    // Porovnání
    const comparisonNote = hasComparison
      ? `\n\nIMPORTANT: You are receiving TWO images:
1. FIRST image = the user's photo of the card being checked
2. SECOND image = the OFFICIAL card image from the Pokémon TCG database

Compare them carefully:
- Does the artwork match exactly? (colors, positioning, details)
- Is the card layout identical? (borders, text placement, symbol positions)
- Are there any differences in typography or font weight?
- Does the holo/foil pattern match what the official version should have?
- Are energy symbols, HP, and damage values identical?`
      : '';

    return `You are an expert Pokémon TCG card authenticator. You have been trained on thousands of real and fake cards.

${hint}
${eraHints ? `\nEra-specific checks for this card:\n- ${eraHints}` : ''}

Known common fake indicators:
${KNOWLEDGE_BASE.common_fakes.map(f => '- ' + f).join('\n')}
${communitySection}
${comparisonNote}

Carefully examine this card photo for authenticity. Perform ALL of these checks:

TYPOGRAPHY & TEXT:
- Font matches official Pokémon TCG fonts (Futura-like for names, specific fonts per era)
- HP value is plausible for the card's era and type
- Attack names, damage values and energy costs are consistent with official data
- Ability/move descriptions use correct official grammar
- Set number format correct (e.g. 025/198)

VISUAL DESIGN:
- Card border width and color correct for the era/set
- Type symbols (energy icons) look sharp and correctly colored
- Rarity symbol (circle/diamond/star) matches claimed rarity
- Evolution stage banner present and correct
- Weakness/Resistance/Retreat cost section correct
- Illustrator credit visible and plausible

PRINT QUALITY:
- Colors saturated correctly (not too dull, not oversaturated)
- No visible pixel artifacts, blur or JPEG compression on text
- Holographic foil pattern (if applicable) matches official patterns
- Card texture consistent
- No misalignment between layers
- Copyright line at bottom (© Nintendo/Creatures/GAME FREAK + year)

CARD STOCK (if visible):
- Card thickness normal
- Edges clean, not rough or home-cut

Respond ONLY with this JSON (no explanation, no markdown fences):
{
  "verdict": "real|fake|suspicious|unknown",
  "score": 0-100,
  "confidence": "high|med|low",
  "summary": "2-3 sentence verdict in Czech",
  "flags": [
    { "label": "short check name", "severity": "ok|warn|fail", "detail": "Czech explanation" }
  ],
  "comparison_notes": "If comparing with official image, note key differences here in Czech. Otherwise empty string."
}

verdict meanings:
- real: card appears genuine (score >= 75)
- suspicious: some red flags but not conclusive (score 40-74)
- fake: clear indicators of counterfeit (score < 40)
- unknown: image too blurry/small/partial to assess

Include 5-8 flags. severity: ok = passed, warn = minor concern, fail = serious red flag.`;
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
        if (resp.ok) {
          const data = await resp.json();
          return data.data?.images?.large || data.data?.images?.small || null;
        }
      }
      const parts = [];
      if (cardInfo.name) parts.push(`name:"${cardInfo.name}"`);
      if (cardInfo.number) parts.push(`number:${cardInfo.number}`);
      if (cardInfo.set) parts.push(`set.name:"${cardInfo.set}"`);
      if (parts.length === 0) return null;
      const resp = await fetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(parts.join(' '))}&pageSize=1`);
      if (!resp.ok) return null;
      const data = await resp.json();
      return data.data?.[0]?.images?.large || data.data?.[0]?.images?.small || null;
    } catch (e) {
      console.warn('[FakeDetector] Nepodařilo se načíst oficiální obrázek:', e);
      return null;
    }
  }

  async function toBase64(imageSource) {
    if (!imageSource) throw new Error('Chybí obrázek');
    if (imageSource instanceof File || imageSource instanceof Blob) {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => {
          const [header, data] = r.result.split(',');
          resolve({ base64: data, mimeType: header.match(/data:([^;]+)/)?.[1] || 'image/jpeg' });
        };
        r.onerror = reject;
        r.readAsDataURL(imageSource);
      });
    }
    if (typeof imageSource === 'string') {
      if (imageSource.startsWith('data:')) {
        const [header, data] = imageSource.split(',');
        return { base64: data, mimeType: header.match(/data:([^;]+)/)?.[1] || 'image/jpeg' };
      }
      if (imageSource.startsWith('http')) {
        const resp = await fetch(imageSource);
        const blob = await resp.blob();
        return toBase64(blob);
      }
    }
    throw new Error('Nepodporovaný formát obrázku');
  }

  // ══════════════════════════════════════════════════════════════
  //  ANALÝZA
  // ══════════════════════════════════════════════════════════════

  async function analyze(imageSource, cardInfo) {
    try {
      // 1. Načti komunitní data paralelně s oficiálním obrázkem
      const [communityStats, officialImgFromApi] = await Promise.all([
        getCommunityStats(cardInfo).catch(() => null),
        cardInfo ? _resolveOfficialImage(cardInfo) : Promise.resolve(null),
      ]);

      const officialImg = officialImgFromApi;

      if (officialImg) {
        return analyzeWithComparison(imageSource, officialImg, cardInfo, communityStats);
      }

      // Single image
      const { base64, mimeType } = await toBase64(imageSource);
      return await _callClaude([
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
        { type: 'text', text: buildPrompt(cardInfo, false, communityStats) }
      ], cardInfo, communityStats);
    } catch (e) {
      return _errorResult('Chyba analýzy: ' + e.message);
    }
  }

  /** Resolve official image – z cardInfo nebo z API */
  async function _resolveOfficialImage(cardInfo) {
    if (!cardInfo) return null;
    const direct = cardInfo.apiLarge || cardInfo.apiSmall || cardInfo.officialImage;
    if (direct) return direct;
    return fetchOfficialImage(cardInfo);
  }

  async function analyzeWithComparison(userImg, officialImg, cardInfo, communityStats) {
    try {
      const user = await toBase64(userImg);
      const official = await toBase64(officialImg);
      // Pokud nemáme community stats, zkus je načíst
      if (!communityStats && cardInfo) {
        communityStats = await getCommunityStats(cardInfo).catch(() => null);
      }
      return await _callClaude([
        { type: 'image', source: { type: 'base64', media_type: user.mimeType, data: user.base64 } },
        { type: 'image', source: { type: 'base64', media_type: official.mimeType, data: official.base64 } },
        { type: 'text', text: buildPrompt(cardInfo, true, communityStats) }
      ], cardInfo, communityStats);
    } catch (e) {
      // Fallback na single image
      console.warn('[FakeDetector] Comparison failed, fallback:', e);
      try {
        const user = await toBase64(userImg);
        return await _callClaude([
          { type: 'image', source: { type: 'base64', media_type: user.mimeType, data: user.base64 } },
          { type: 'text', text: buildPrompt(cardInfo, false, communityStats) }
        ], cardInfo, communityStats);
      } catch (e2) {
        return _errorResult('Chyba analýzy: ' + e2.message);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  CLAUDE API
  // ══════════════════════════════════════════════════════════════

  async function _callClaude(content, cardInfo, communityStats) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        messages: [{ role: 'user', content }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || 'HTTP ' + response.status);
    }

    const data    = await response.json();
    const rawText = data.content?.map(b => b.text || '').join('') || '{}';
    const clean   = rawText.replace(/```json|```/g, '').trim();

    let result;
    try { result = JSON.parse(clean); } catch { throw new Error('AI vrátila neplatnou odpověď'); }

    // Sanitize
    result.verdict          = ['real','fake','suspicious','unknown'].includes(result.verdict) ? result.verdict : 'unknown';
    result.score            = Math.max(0, Math.min(100, parseInt(result.score) || 50));
    result.confidence       = ['high','med','low'].includes(result.confidence) ? result.confidence : 'low';
    result.flags            = Array.isArray(result.flags) ? result.flags : [];
    result.summary          = result.summary || '';
    result.comparison_notes = result.comparison_notes || '';
    result.timestamp        = new Date().toISOString();
    result.cardName         = cardInfo?.name || '';
    result.cardSet          = cardInfo?.set || '';

    // Přidej info o komunitě do výsledku
    if (communityStats && communityStats.total > 0) {
      result.communityTotal    = communityStats.total;
      result.communityAvgScore = communityStats.avg_score;
    }

    // Ulož do Supabase (sdílená komunita) + localStorage (local cache)
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
