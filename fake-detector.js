
// ── TCG Proxy Helper ─────────────────────────────────────────────
// Přesměruje api.pokemontcg.io → Supabase Edge Function (X-Api-Key bezpečně na serveru)
const _TCG_PROXY = 'https://xrduqwrinzvmpixgmqta.supabase.co/functions/v1/tcg-proxy';
function tcgFetch(url) {
  if (window.PT_tcgFetch) return window.PT_tcgFetch(url); // tcg-zdroj.js: proxy → záloha TCGdex
  const m = url.match(/api\.pokemontcg\.io\/v2\/([^?]+)(\?.*)?$/);
  if (!m) return fetch(url);
  const segment = m[1]; const qs = m[2] || '';
  const idM = segment.match(/^cards\/(.+)$/);
  if (idM) return fetch(_TCG_PROXY+'?id='+encodeURIComponent(idM[1]));
  const p = new URLSearchParams(qs.replace(/^\?/,'')); p.set('path', segment);
  return fetch(_TCG_PROXY+'?'+p.toString());
}
// ─────────────────────────────────────────────────────────────────
/**
 * fake-detector.js v4 – PokéTrade AI detektor falzifikátů (ověřené znaky, zadní strana, bezpečné srovnání, pojistky verdiktu)
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
  // Jen znaky, které platí obecně a dají se ověřit. Nepřesná „pravidla" by AI vedla
  // k označení pravé karty za padělek (v3 obsahovala např. „V karty mají stříbrný okraj").
  const KNOWLEDGE_BASE = {
    common_fakes: [
      'HP není násobek 10 (pravé karty mají HP vždy po desítkách)',
      'Nesmyslně vysoké HP pro danou éru (karty z let 1999–2003 mají nejvýš kolem 120 HP)',
      'Pravopisné chyby, „Pokemon" bez é, nesmyslná gramatika v textu útoků a schopností',
      'Chybějící nebo podivný řádek s copyrightem (Pokémon / Nintendo / Creatures / GAME FREAK a rok)',
      'Rozmazaný nebo rozpitý drobný text, neostré symboly energie',
      'Celá karta nepřirozeně lesklá, přestože karta nemá být holo',
      'Holo efekt na špatném místě (celá karta místo ilustrace, nebo naopak chybí)',
      'Barvy vybledlé nebo přesycené oproti oficiálnímu obrázku',
      'Okraje výrazně nerovnoměrné, rámeček posunutý, okraje karty roztřepené nebo ručně stříhané',
      'Číslo karty, symbol nebo kód sady či symbol rarity neodpovídají sadě',
      'Písmo jména, HP a útoků nesedí s ostatními kartami ze stejné série',
      'Zadní strana: jiný odstín modré, rozmazaný Poké Ball nebo logo',
    ],
    era_specific: {
      'WOTC (1999–2003: Base Set, Jungle, Fossil, Team Rocket, Gym, Neo)': [
        'Maximální HP kolem 120',
        'Razítko 1st Edition se často padělá — zkontroluj jeho ostrost a umístění',
        'Shadowless a Unlimited jsou různé tisky, ne znaky padělku',
      ],
      'Sword & Shield (2020–2023)': [
        'Anglické karty mají žlutý okraj',
        'U čísla karty je kód regulace (D, E nebo F)',
      ],
      'Scarlet & Violet (2023+)': [
        'Anglické karty mají stříbrnošedý okraj; žlutý okraj u karty z této série je silné varování',
        'Vlevo dole je kód regulace (G, H, I…) a kód sady s číslem karty',
      ],
    },
  };

  // Éra karty podle ID (swsh7-218, sv3pt5-6, base1-4…) nebo podle názvu sady
  function eraKarty(cardInfo) {
    if (!cardInfo) return null;
    const id = String(cardInfo.apiId || cardInfo.tcgId || '').toLowerCase();
    const sada = String(cardInfo.set || '').toLowerCase();
    if (/^(base|gym|neo|si|ecard|basep)\d*/.test(id) || /\b(base set|jungle|fossil|team rocket|gym (heroes|challenge)|neo )/.test(sada))
      return 'WOTC (1999–2003: Base Set, Jungle, Fossil, Team Rocket, Gym, Neo)';
    if (/^sv/.test(id) || /scarlet|violet|paldea|obsidian|151|paradox|temporal|twilight|stellar|surging|prismatic|journey together|destined rivals/.test(sada))
      return 'Scarlet & Violet (2023+)';
    if (/^swsh/.test(id) || /sword|shield|rebel clash|darkness ablaze|vivid voltage|battle styles|chilling reign|evolving skies|fusion strike|brilliant stars|astral radiance|lost origin|silver tempest|crown zenith/.test(sada))
      return 'Sword & Shield (2020–2023)';
    return null;
  }

  // „218/203" → „218", „004" → „4"
  function normCislo(n) {
    return String(n == null ? '' : n).toLowerCase().split('/')[0].trim().replace(/^0+(?=[0-9a-z])/, '');
  }

  // Odolné čtení odpovědi modelu: přemýšlení <think>, ozdoby ```, text okolo
  function najdiJson(text) {
    let t = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '');
    let start = t.indexOf('{');
    while (start !== -1) {
      let hl = 0, str = false, esc = false;
      for (let i = start; i < t.length; i++) {
        const ch = t[i];
        if (str) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') str = false; continue; }
        if (ch === '"') str = true;
        else if (ch === '{') hl++;
        else if (ch === '}' && --hl === 0) {
          const kus = t.slice(start, i + 1);
          try { return JSON.parse(kus); } catch (e) {}
          try { return JSON.parse(kus.replace(/,\s*([}\]])/g, '$1').replace(/[\u201C\u201D]/g, '"')); } catch (e) {}
          break;
        }
      }
      start = t.indexOf('{', start + 1);
    }
    return null;
  }

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

  function buildPrompt(cardInfo, hasComparison, communityStats, hasBack) {
    const hint = cardInfo
      ? `Analyzovaná karta: ${cardInfo.name || '?'}${cardInfo.set ? ' · sada: ' + cardInfo.set : ''}${cardInfo.number ? ' #' + cardInfo.number : ''}${cardInfo.hp ? ' · HP ' + cardInfo.hp : ''}${cardInfo.lang ? ' · jazyk ' + cardInfo.lang : ''}`
      : '';
    const era = eraKarty(cardInfo);
    const eraHints = era ? KNOWLEDGE_BASE.era_specific[era] : null;

    // Komunita: jen na co se zaměřit. Jiní uživatelé hodnotili JINÉ kusy této karty —
    // jejich verdikt o tomto kusu nic neříká (a výsledek AI se do komunity ukládá zpět,
    // takže by se chybný verdikt sám posiloval).
    let communitySection = '';
    if (communityStats && communityStats.common_flags && communityStats.common_flags.length) {
      communitySection = '\n\nOther users checking OTHER copies of this card most often flagged these points. ' +
        'Use them only as hints where to look closely — they say nothing about THIS copy:\n' +
        communityStats.common_flags.slice(0, 6).map(f => `- ${f.label}`).join('\n');
    }

    let images = 'IMAGES YOU RECEIVE (in this order):\n1. the user\'s photo of the FRONT of the card being checked';
    let n = 1;
    if (hasBack) images += `\n${++n}. the user's photo of the BACK of the same card`;
    if (hasComparison) images += `\n${++n}. an OFFICIAL reference image of this card from a card database`;

    const comparisonNote = hasComparison ? `

Comparing with the official reference image:
- The reference may be a DIFFERENT LANGUAGE or edition (e.g. English reference, Japanese card). Different language of the text is NOT a sign of a fake.
- If the artwork is completely different, the reference is probably another version of the card (e.g. regular vs. alternate art). Say so in comparison_notes and do NOT count it as a fake sign.
- Do compare: layout and proportions, border, positions of symbols and text boxes, colors and print sharpness, holo area.` : '';

    const backNote = hasBack ? `

Back of the card: check the shade of blue and its gradients, sharpness of the Poké Ball and the Pokémon logo, centering and print quality. A wrong or flat blue and a blurry logo are strong fake signs.` : '';

    return `You are an expert Pokémon TCG card authenticator. Judge ONLY what is visible in the photos.

${images}

${hint}
${eraHints ? `\nEra-specific checks (${era}):\n- ${eraHints.join('\n- ')}` : ''}

Known fake indicators:
${KNOWLEDGE_BASE.common_fakes.map(f => '- ' + f).join('\n')}${communitySection}${comparisonNote}${backNote}

Check: text and typography (spelling, HP plausibility, attack text), layout (border color and width for the era, symbols, rarity and set symbol, number format, copyright line, illustrator), print quality (sharpness, colors, holo area, alignment), visible edges.

Be careful with accusations: many things (card thickness, texture, light test) CANNOT be judged from a photo. If the photo is blurry, small, partial or glare hides details, use verdict "unknown" or lower confidence. Never return "fake" without at least one concrete "fail" flag.

Respond ONLY with this JSON (no explanation, no markdown fences):
{
  "verdict": "real|fake|suspicious|unknown",
  "score": 0-100,
  "confidence": "high|med|low",
  "summary": "2-3 sentence verdict in Czech",
  "flags": [
    { "label": "short check name in Czech", "severity": "ok|warn|fail", "detail": "Czech explanation" }
  ],
  "comparison_notes": "If comparing with the reference, key differences in Czech. Otherwise empty string."
}

verdict: real = looks genuine (score >= 75), suspicious = some red flags (40-74), fake = clear counterfeit signs (< 40), unknown = cannot be assessed from these photos.
Include 5-8 flags. severity: ok = passed, warn = minor concern, fail = serious red flag.`;
  }

  // ══════════════════════════════════════════════════════════════
  //  IMAGE HELPERS
  // ══════════════════════════════════════════════════════════════

  async function fetchOfficialImage(cardInfo) {
    if (!cardInfo) return null;
    try {
      // 1. Přímý lookup přes API ID (nejspolehlivější)
      if (cardInfo.apiId || cardInfo.tcgId) {
        const id = cardInfo.apiId || cardInfo.tcgId;
        const resp = await tcgFetch(`https://api.pokemontcg.io/v2/cards/${encodeURIComponent(id)}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.data?.images) return data.data.images.large || data.data.images.small || null;
        }
      }

      // pokemontcg.io chce jen číslo bez "/celkový-počet" — "030/163" → "030"
      const cleanNum = (cardInfo.number || '').split('/')[0].replace(/^0+/, '') || '';
      const cleanNumPadded = (cardInfo.number || '').split('/')[0].trim();

      // 2. Hledání přes jméno + číslo + sada
      // Srovnání s JINOU kartou (jiné číslo = jiná verze) by vypadalo jako padělek → jen stejné číslo
      const chciCislo = normCislo(cardInfo.number);
      const trySearch = async (parts) => {
        if (!parts.length) return null;
        const resp = await tcgFetch(`https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(parts.join(' '))}&pageSize=5`);
        if (!resp.ok) return null;
        const data = await resp.json();
        const card = (data.data || []).find(c => !chciCislo || normCislo(c.number) === chciCislo);
        return card?.images?.large || card?.images?.small || null;
      };

      // Pokus 1: jméno + číslo (padded) + sada
      if (cardInfo.name && cleanNumPadded && cardInfo.set) {
        const r = await trySearch([`name:"${cardInfo.name}"`, `number:${cleanNumPadded}`, `set.name:"${cardInfo.set}"`]);
        if (r) return r;
      }

      // Pokus 2: jméno + číslo (bez leading zeros) + sada
      if (cardInfo.name && cleanNum && cardInfo.set) {
        const r = await trySearch([`name:"${cardInfo.name}"`, `number:${cleanNum}`, `set.name:"${cardInfo.set}"`]);
        if (r) return r;
      }

      // Pokus 3: jen jméno + číslo (bez sady — sada může mít jiný název v API)
      if (cardInfo.name && cleanNumPadded) {
        const r = await trySearch([`name:"${cardInfo.name}"`, `number:${cleanNumPadded}`]);
        if (r) return r;
      }

      // (Dřívější „Pokus 4: jen jméno" vracel libovolnou verzi karty → falešné „padělek".
      //  Bez čísla raději srovnání vynecháme.)

      return null;
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

  // backSource = volitelná fotka zadní strany (zpřesní výsledek)
  async function analyze(imageSource, cardInfo, backSource) {
    try {
      const [communityStats, officialImg] = await Promise.all([
        getCommunityStats(cardInfo).catch(() => null),
        cardInfo ? _resolveOfficialImage(cardInfo).catch(() => null) : Promise.resolve(null),
      ]);
      if (officialImg) {
        return analyzeWithComparison(imageSource, officialImg, cardInfo, communityStats, backSource);
      }
      const content = [await _obrazek(imageSource)];
      if (backSource) content.push(await _obrazek(backSource));
      content.push({ type: 'text', text: buildPrompt(cardInfo, false, communityStats, !!backSource) });
      return await _callClaude(content, cardInfo, communityStats);
    } catch (e) {
      return _errorResult('Chyba analýzy: ' + e.message);
    }
  }

  async function _obrazek(zdroj) {
    const { base64, mimeType } = await toBase64(zdroj);
    return { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } };
  }

  /** Resolve official image – z cardInfo nebo z API */
  async function _resolveOfficialImage(cardInfo) {
    if (!cardInfo) return null;
    const direct = cardInfo.apiLarge || cardInfo.apiSmall || cardInfo.officialImage;
    if (direct) return direct;
    return fetchOfficialImage(cardInfo);
  }

  async function analyzeWithComparison(userImg, officialImg, cardInfo, communityStats, backImg) {
    if (!communityStats && cardInfo) communityStats = await getCommunityStats(cardInfo).catch(() => null);
    const predni = await _obrazek(userImg);
    const zadni = backImg ? await _obrazek(backImg) : null;
    try {
      const content = [predni];
      if (zadni) content.push(zadni);
      content.push(await _obrazek(officialImg));
      content.push({ type: 'text', text: buildPrompt(cardInfo, true, communityStats, !!zadni) });
      return await _callClaude(content, cardInfo, communityStats);
    } catch (e) {
      // Srovnávací obrázek nejde načíst → bez něj
      console.warn('[FakeDetector] Srovnání selhalo, zkouším bez něj:', e);
      try {
        const content = [predni];
        if (zadni) content.push(zadni);
        content.push({ type: 'text', text: buildPrompt(cardInfo, false, communityStats, !!zadni) });
        return await _callClaude(content, cardInfo, communityStats);
      } catch (e2) {
        return _errorResult('Chyba analýzy: ' + e2.message);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  CLAUDE API
  // ══════════════════════════════════════════════════════════════

  async function _callClaude(content, cardInfo, communityStats) {
    // Převod z Anthropic formátu na Groq/OpenAI formát
    const groqContent = content.map(item => {
      if (item.type === 'image' && item.source?.type === 'base64') {
        return {
          type: 'image_url',
          image_url: { url: `data:${item.source.media_type};base64,${item.source.data}` }
        };
      }
      return item;
    });

    const token = localStorage.getItem('sb_token') || '';
    const response = await fetch('/api/groq', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        model: 'qwen/qwen3.6-27b',
        max_tokens: 800,
        usage_type: 'fake',
        messages: [{ role: 'user', content: groqContent }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error || err?.message || 'HTTP ' + response.status);
    }

    const data = await response.json();
    let obsah = data.choices?.[0]?.message?.content || '';
    if (Array.isArray(obsah)) obsah = obsah.map(c => c.text || '').join('');
    const result = najdiJson(obsah);
    if (!result || typeof result !== 'object') throw new Error('AI vrátila nečitelnou odpověď, zkus to znovu');

    // Úklid a pojistky
    result.score      = Math.max(0, Math.min(100, parseInt(result.score, 10) || 50));
    result.confidence = ({ medium: 'med', mid: 'med' }[String(result.confidence).toLowerCase()]) || result.confidence;
    result.confidence = ['high', 'med', 'low'].includes(result.confidence) ? result.confidence : 'low';
    result.flags = (Array.isArray(result.flags) ? result.flags : []).slice(0, 10).map(f => ({
      label: String(f?.label || '').slice(0, 80),
      severity: ['ok', 'warn', 'fail'].includes(f?.severity) ? f.severity : 'warn',
      detail: String(f?.detail || '').slice(0, 300),
    }));
    // Verdikt musí odpovídat skóre (AI občas vrátí „fake" se skóre 80)
    if (result.verdict !== 'unknown') {
      result.verdict = result.score >= 75 ? 'real' : result.score >= 40 ? 'suspicious' : 'fake';
    }
    // Obvinit z padělku jen s doloženým vážným nálezem a ne s nízkou jistotou
    if (result.verdict === 'fake' && (result.confidence === 'low' || !result.flags.some(f => f.severity === 'fail'))) {
      result.verdict = 'suspicious';
      result.score = Math.max(result.score, 40);
    }
    result.summary          = String(result.summary || '');
    result.comparison_notes = String(result.comparison_notes || '');
    result.timestamp        = new Date().toISOString();
    result.cardName         = cardInfo?.name || '';
    result.cardSet          = cardInfo?.set || '';
    result.sZadniStranou    = /BACK of the same card/.test(content[content.length - 1]?.text || '');

    if (communityStats && communityStats.total > 0) {
      result.communityTotal    = communityStats.total;
      result.communityAvgScore = communityStats.avg_score;
    }

    // Do komunity jen použitelné výsledky (nejisté by zkreslily tipy pro ostatní)
    if (result.verdict !== 'unknown' && result.confidence !== 'low') _saveToSupabase(result, cardInfo);
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
             <div style="font-size:11px;color:rgba(139,92,246,.8);font-weight:600">Komunita: ${result.communityTotal} analýz jiných kusů této karty</div>
             <div style="font-size:10px;color:rgba(240,232,208,.4);margin-top:1px">Průměrné skóre komunity: ${result.communityAvgScore}/100 · Tvoje: ${result.score}/100</div>
           </div>
         </div>`
      : '';

    // Zadní strana: nejspolehlivější vizuální znak padělku — nabídnout, pokud chyběla
    const zadniHtml = (!result.sZadniStranou && !result.error && _posledni.predni)
      ? `<button type="button" onclick="FakeDetector._pridatZadniStranu()" style="margin-top:10px;width:100%;padding:9px;border-radius:10px;border:1px dashed rgba(245,158,11,.4);background:rgba(245,158,11,.06);color:#f59e0b;font-size:12px;cursor:pointer">📷 Přidat fotku zadní strany a zkontrolovat znovu (přesnější)</button>`
      : '';
    // Co z fotky poznat nejde
    const rucneHtml = `<details style="margin-top:10px;padding:8px 10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:8px">
        <summary style="font-size:11px;color:rgba(240,232,208,.6);cursor:pointer">🔦 Ověř ručně — tohle z fotky poznat nejde</summary>
        <ul style="margin:8px 0 0 16px;padding:0;font-size:11px;color:rgba(240,232,208,.55);line-height:1.6">
          <li><b>Světlo:</b> posviť zezadu baterkou mobilu. Pravá karta má uvnitř tmavou vrstvu a propustí jen málo světla, padělek často prosvítá.</li>
          <li><b>Srovnání s pravou kartou</b> ze stejné doby: tloušťka, tuhost, povrch (pravé bývají matnější) a odstín modré na zadní straně.</li>
          <li><b>Lupa:</b> pravé karty mají ostrý tiskový rastr z drobných teček, padělky bývají rozmazané nebo vytištěné jinak.</li>
          <li><b>Okraje:</b> pravé karty jsou čistě vyseknuté, padělky mívají roztřepené nebo nerovné hrany.</li>
        </ul>
      </details>`;

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
        ${zadniHtml}
        ${rucneHtml}
        <div style="font-size:10px;color:rgba(240,232,208,.25);margin-top:12px;text-align:right">🤖 AI odhad z fotky + srovnání s databází · není to certifikát pravosti</div>
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
  const _posledni = { predni: null, cardInfo: null };   // pro dodatečné přidání zadní strany

  function _ukazNacitani(resultEl, text) {
    resultEl.innerHTML = `
      <div style="text-align:center;padding:20px 0">
        <div style="display:inline-block;width:28px;height:28px;border:3px solid rgba(245,158,11,.2);border-top-color:#f59e0b;border-radius:50%;animation:fdspin 1s linear infinite"></div>
        <div style="font-size:12px;color:rgba(240,232,208,.45);margin-top:10px">${text}</div>
      </div>
      <style>@keyframes fdspin{to{transform:rotate(360deg)}}</style>`;
  }

  function _pridatZadniStranu() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*'; inp.setAttribute('capture', 'environment');
    inp.onchange = async () => {
      const zadni = inp.files && inp.files[0];
      if (!zadni || !_posledni.predni) return;
      const resultEl = document.getElementById('fdModalResult');
      if (resultEl) _ukazNacitani(resultEl, '⏳ AI porovnává přední i zadní stranu…');
      const result = await analyze(_posledni.predni, _posledni.cardInfo, zadni);
      if (resultEl) renderResult(result, resultEl);
    };
    inp.click();
  }

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
      _posledni.predni = imgSource; _posledni.cardInfo = cardInfo;
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
      _posledni.predni = file; _posledni.cardInfo = cardInfo;
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
    _onFileSelected, _pridatZadniStranu,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = FakeDetector;
  else global.FakeDetector = FakeDetector;

})(typeof window !== 'undefined' ? window : globalThis);
