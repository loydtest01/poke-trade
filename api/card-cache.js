/**
 * api/card-cache.js — Community card cache s RapidAPI fallbackem
 * ════════════════════════════════════════════════════════════════
 *
 * FLOW:
 *   1. Zkontroluj Supabase card_cache (sdílená pro všechny uživatele)
 *   2. HIT  → vrať cache (ceny refresh max 1× za 7 dní)
 *   3. MISS → zavolej RapidAPI (cardmarket-api.com) → ulož → vrať
 *
 * Použití pro non-EN karty (JP/ZH/KO) kde TCGdex vrátí 404.
 * EN karty obsluhuje pokemontcg.io → tento endpoint se pro ně nevolá.
 *
 * GET /api/card-cache?name=Toxic+Spikes&set=S8F&number=012&lang=JP&token=...
 *
 * Env proměnné (Vercel):
 *   RAPIDAPI_KEY    — klíč z rapidapi.com (zdarma 100 req/den)
 *   SUPABASE_URL    — (nepovinné, fallback na hardcoded)
 *   SUPABASE_ANON   — (nepovinné)
 */

const SB_URL  = process.env.SUPABASE_URL  || 'https://xrduqwrinzvmpixgmqta.supabase.co';
const SB_ANON = process.env.SUPABASE_ANON || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyZHVxd3Jpbnp2bXBpeGdtcXRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDI0MjksImV4cCI6MjA5MDk3ODQyOX0.2p404Vy77CH_MsvQlnpxaO0H-KlSSt_oJlaFrmttFXs';

// AI facts ENV (sloučeno do card-cache.js kvůli Vercel limitu 12 funkcí)
const SB_SVC      = process.env.SUPABASE_SERVICE_KEY; // pro INSERT bypass RLS na ai_facts
const GROQ_KEY    = process.env.GROQ_API_KEY;
const CRON_SECRET = process.env.CRON_SECRET || 'dev-secret-change-me';

// RapidAPI: CardMarket API TCG (by TCG API / TCGGO)
// Odkaz: https://rapidapi.com/tcggopro/api/cardmarket-api-tcg
// Free tier: 100 req/den
// Host z curl příkazu v RapidAPI playground:
const RAPID_HOST = 'cardmarket-api-tcg.p.rapidapi.com';
const RAPID_BASE = `https://${RAPID_HOST}`;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ── Cache TTL ─────────────────────────────────────────────────────────────
const CARD_TTL_DAYS  = 30;  // metadata karty (název, obrázek) – relativně stálé
const PRICE_TTL_DAYS =  7;  // ceny – refresh každý týden

// ── Helpers ───────────────────────────────────────────────────────────────

function norm(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function cacheKey(name, set, number, lang) {
  // Číslo bez lomítka: "012/153" → "012"
  const num = String(number || '').split('/')[0].trim().replace(/^0+/, '') || '0';
  return `${norm(name)}|${norm(set)}|${num}|${norm(lang)}`;
}

function isExpired(isoDate, days) {
  if (!isoDate) return true;
  return (Date.now() - new Date(isoDate).getTime()) > days * 86_400_000;
}

// ── Supabase helpers ──────────────────────────────────────────────────────

async function sbGet(path, token) {
  const r = await fetch(`${SB_URL}/${path}`, {
    headers: {
      'apikey':        SB_ANON,
      'Authorization': `Bearer ${token}`,
    },
  });
  if (!r.ok) return null;
  const j = await r.json();
  return Array.isArray(j) ? j[0] || null : j;
}

async function sbUpsert(table, data, token) {
  await fetch(`${SB_URL}/rest/v1/${table}`, {
    method:  'POST',
    headers: {
      'apikey':        SB_ANON,
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
      'Prefer':        'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(data),
  });
}

async function sbPatch(table, match, data, token) {
  const qs = Object.entries(match).map(([k, v]) => `${k}=eq.${encodeURIComponent(v)}`).join('&');
  await fetch(`${SB_URL}/rest/v1/${table}?${qs}`, {
    method:  'PATCH',
    headers: {
      'apikey':        SB_ANON,
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(data),
  });
}

// ── Hard limit: kolik volání RapidAPI denně (free tier = 100, držíme 99 pro bezpečí)
const RAPIDAPI_DAILY_LIMIT = 99;

// ── Rate limit check + increment přes Supabase RPC ─────────────────────
// Atomické: vrací true pokud je volání povoleno (a counter byl inkrementován),
// false pokud byl limit pro dnešek dosažen.
async function checkAndIncrementApiUsage() {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/increment_api_usage`, {
      method:  'POST',
      headers: {
        'apikey':        SB_ANON,
        'Authorization': `Bearer ${SB_ANON}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        p_api_name: 'rapidapi_cardmarket',
        p_limit:    RAPIDAPI_DAILY_LIMIT,
      }),
    });
    if (!r.ok) {
      console.warn('[card-cache] rate limit RPC failed:', r.status);
      // Pokud RPC selže, raději nenechat volat RapidAPI (drop na safe side)
      return { allowed: false, count: 0, limit: RAPIDAPI_DAILY_LIMIT, error: 'RPC failed' };
    }
    const result = await r.json();
    return result || { allowed: false };
  } catch (e) {
    console.error('[card-cache] rate limit check error:', e.message);
    return { allowed: false, count: 0, limit: RAPIDAPI_DAILY_LIMIT, error: e.message };
  }
}

// ── RapidAPI volání ───────────────────────────────────────────────────────
//
// CardMarket API TCG (TCGGO) — endpoint: GET /pokemon/cards/search?search={name}&sort=relevance
//
// Ukázka odpovědi:
// {
//   "id": 3852, "name": "Giratina VSTAR", "card_number": "GG69",
//   "rarity": "Rare Secret",
//   "prices": {
//     "cardmarket": { "lowest_near_mint": 157.21, "30d_average": 192.79, "7d_average": 189.26 },
//     "tcg_player": { "market_price": 146.69 }
//   },
//   "episode": { "name": "Crown Zenith", "code": "CRZ" },
//   "image": "https://images.tcggo.com/..."
// }

async function fetchFromRapidApi(name, set, number, lang) {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) return null;

  // ── Rate limit check (před každým RapidAPI voláním) ────────────────
  // Atomická operace přes Supabase RPC — i kdyby současně přišlo 10 requestů,
  // jen prvních 99/den projde.
  const usage = await checkAndIncrementApiUsage();
  if (!usage.allowed) {
    console.warn(`[card-cache] ⛔ Denní limit ${RAPIDAPI_DAILY_LIMIT} dosažen (${usage.count}/${usage.limit}). Skip RapidAPI.`);
    return { _rateLimited: true, _usage: usage };
  }
  console.log(`[card-cache] RapidAPI volání ${usage.count}/${usage.limit}: "${name}"`);

  const params = new URLSearchParams({ search: name, sort: "relevance" });

  try {
    const r = await fetch(`${RAPID_BASE}/pokemon/cards/search?${params}`, {
      headers: {
        'X-RapidAPI-Key':  key,
        'X-RapidAPI-Host': RAPID_HOST,
      },
    });

    if (!r.ok) {
      console.warn(`[card-cache] RapidAPI ${r.status} pro "${name}"`);
      return null;
    }

    const data = await r.json();

    // API vrací pole nebo { data: [...] } nebo { cards: [...] }
    const cards = Array.isArray(data)
      ? data
      : (data.data || data.cards || data.results || []);

    if (!cards.length) return null;

    // Filtruj přesné číslo karty pokud ho máme
    const qNum = String(number || '').split('/')[0].replace(/^0+/, '');
    const card = (qNum
      ? cards.find(c => {
          const cNum = String(c.card_number || c.number || '').split('/')[0].replace(/^0+/, '');
          return cNum === qNum;
        })
      : null) || cards[0];

    // Ceny z cardmarket větve
    const cm = card.prices?.cardmarket || {};

    // Cardmarket URL — API ji nevrací přímo, sestavíme z episode.code + card_number
    const epCode  = card.episode?.code  || set || '';
    const epName  = card.episode?.name  || '';
    const nameSlug = (s) => String(s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
    const cmUrl = epCode
      ? `https://www.cardmarket.com/en/Pokemon/Products/Singles/${nameSlug(epName)}/${nameSlug(card.name)}`
      : '';

    return {
      name:           card.name             || name,
      name_en:        card.name             || name,   // API indexuje EN jména
      set_code:       epCode.toLowerCase()  || norm(set),
      set_name:       epName                || '',
      card_number:    card.card_number      || card.number || number || '',
      image_url:      card.image            || '',
      cardmarket_url: cmUrl,
      // Ceny: EUR z Cardmarket větve
      price_trend:    cm['7d_average']      || cm['30d_average'] || 0,
      price_min:      cm.lowest_near_mint   || 0,
      price_30d:      cm['30d_average']     || 0,
      source:         'rapidapi',
      raw_data:       card,
    };
  } catch (e) {
    console.error('[card-cache] RapidAPI error:', e.message);
    return null;
  }
}

// ── Hlavní handler ────────────────────────────────────────────────────────

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET')     return res.status(405).json({ error: 'Použij GET' });

  // ── ?action=stats → vrať aktuální stav RapidAPI counteru ─────────────
  // (sloučeno do card-cache.js kvůli Vercel Hobby limitu 12 funkcí)
  // Použití z UI: fetch('/api/card-cache?action=stats')
  if (req.query.action === 'stats') {
    try {
      const r = await fetch(
        `${SB_URL}/rest/v1/api_usage_today?api_name=eq.rapidapi_cardmarket&select=*`,
        {
          headers: {
            'apikey':        SB_ANON,
            'Authorization': `Bearer ${SB_ANON}`,
          },
        }
      );
      if (!r.ok) return res.status(500).json({ error: 'Supabase error', status: r.status });
      const rows = await r.json();
      const row  = Array.isArray(rows) ? rows[0] : null;
      const count     = row?.call_count || 0;
      const remaining = Math.max(0, RAPIDAPI_DAILY_LIMIT - count);
      res.setHeader('Cache-Control', 's-maxage=60');
      return res.status(200).json({
        rapidapi_cardmarket: {
          count:        count,
          limit:        RAPIDAPI_DAILY_LIMIT,
          remaining:    remaining,
          last_call_at: row?.last_call_at || null,
          ok:           remaining > 0,
        },
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── ?action=facts → vrať všechny AI fakty (frontend rotace) ─────────
  // Sloučeno sem (místo separátního /api/ai-facts) kvůli Vercel limitu funkcí.
  if (req.query.action === 'facts') {
    try {
      const r = await fetch(
        `${SB_URL}/rest/v1/ai_facts?select=kind,emoji,title,body&order=created_at.desc&limit=500`,
        {
          headers: {
            'apikey':        SB_ANON,
            'Authorization': `Bearer ${SB_ANON}`,
          },
        }
      );
      if (!r.ok) return res.status(500).json({ error: 'Supabase error', status: r.status });
      const facts = await r.json();
      res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
      return res.status(200).json({
        facts: Array.isArray(facts) ? facts : [],
        count: Array.isArray(facts) ? facts.length : 0,
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── ?action=facts-generate → spusť AI generaci 5 nových faktů ──────
  // Pouze pro autorizované volání (Vercel cron + Bearer header).
  if (req.query.action === 'facts-generate') {
    const auth = req.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (token !== CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });
    return await runFactsGenerate(res);
  }

  const { name, set, number, lang = 'JP', token } = req.query;

  if (!name)  return res.status(400).json({ error: 'Chybí parametr name' });
  if (!token) return res.status(401).json({ error: 'Chybí token' });

  // ── 1. Ověření tokenu ────────────────────────────────────────────────
  const userRes = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { 'apikey': SB_ANON, 'Authorization': `Bearer ${token}` },
  }).catch(() => null);
  if (!userRes?.ok) return res.status(401).json({ error: 'Neplatný token' });
  const user = await userRes.json();
  if (!user?.id) return res.status(401).json({ error: 'Neplatný token' });

  const key = cacheKey(name, set, number, lang);

  // ── 2. Zkontroluj cache ──────────────────────────────────────────────
  const cached = await sbGet(
    `rest/v1/card_cache?cache_key=eq.${encodeURIComponent(key)}&select=*`,
    token
  );

  if (cached) {
    const cardStale  = isExpired(cached.fetched_at,       CARD_TTL_DAYS);
    const priceStale = isExpired(cached.price_updated_at, PRICE_TTL_DAYS);

    // Metadata karty platná, ceny ještě čerstvé → vrať rovnou
    if (!cardStale && !priceStale) {
      res.setHeader('Cache-Control', 's-maxage=3600');
      return res.status(200).json({ ...cached, _source: 'cache' });
    }

    // Ceny jsou staré → refresh na pozadí, ale vrať cache okamžitě
    if (!cardStale && priceStale) {
      // Async refresh (fire & forget) — neblokuje odpověď
      // Pozn: fetchFromRapidApi sám ošetří rate limit, takže pokud je dosažen,
      // refresh tichý se přeskočí. Použijeme to k šetrnosti — fresh cache miss má
      // přednost před refresh staré ceny.
      fetchFromRapidApi(cached.name_en || name, set, number, lang).then(fresh => {
        if (!fresh || fresh._rateLimited) return;
        sbPatch('card_cache', { cache_key: key }, {
          price_trend:      fresh.price_trend,
          price_min:        fresh.price_min,
          price_30d:        fresh.price_30d,
          cardmarket_url:   fresh.cardmarket_url || cached.cardmarket_url,
          price_updated_at: new Date().toISOString(),
        }, SB_ANON); // použijeme anon key pro price update (RLS to povolí)
      }).catch(() => {});

      res.setHeader('Cache-Control', 's-maxage=3600');
      return res.status(200).json({ ...cached, _source: 'cache', _priceStale: true });
    }
  }

  // ── 3. Cache miss → RapidAPI ─────────────────────────────────────────
  const fresh = await fetchFromRapidApi(name, set, number, lang);

  // Rate limit: vrátíme 429 + (pokud je) zastaralá cache
  if (fresh?._rateLimited) {
    if (cached) {
      // Máme starou cache → vrať tu i když ceny zastaralé (lepší než nic)
      res.setHeader('Cache-Control', 's-maxage=300');
      return res.status(200).json({
        ...cached,
        _source:      'cache_stale_rate_limited',
        _rateLimit:   fresh._usage,
        _priceStale:  true,
      });
    }
    // Žádná cache → 429 Too Many Requests
    return res.status(429).json({
      error:     'Denní limit RapidAPI volání dosažen. Zkus to zítra po půlnoci UTC.',
      _source:   'rate_limited',
      _usage:    fresh._usage,
    });
  }

  if (!fresh) {
    // RapidAPI taky nenašlo → vrať not_found (ale neuložíme do cache)
    return res.status(404).json({
      error:   'Karta nenalezena',
      tried:   { name, set, number, lang },
      _source: 'miss',
    });
  }

  // ── 4. Ulož do Supabase card_cache ──────────────────────────────────
  const now = new Date().toISOString();
  const row = {
    cache_key:        key,
    name:             fresh.name,
    name_en:          fresh.name_en,
    set_code:         fresh.set_code  || norm(set),
    set_name:         fresh.set_name  || '',
    card_number:      fresh.card_number || number || '',
    lang:             lang.toUpperCase(),
    image_url:        fresh.image_url       || '',
    cardmarket_url:   fresh.cardmarket_url  || '',
    price_trend:      fresh.price_trend     || 0,
    price_min:        fresh.price_min       || 0,
    price_30d:        fresh.price_30d       || 0,
    source:           fresh.source          || 'rapidapi',
    raw_data:         fresh.raw_data        || null,
    fetched_at:       now,
    price_updated_at: now,
    added_by:         user.id,
  };

  // upsert = ON CONFLICT (cache_key) DO UPDATE
  await sbUpsert('card_cache', row, token).catch(e => {
    console.warn('[card-cache] Upsert selhal:', e.message);
  });

  res.setHeader('Cache-Control', 's-maxage=3600');
  return res.status(200).json({ ...row, _source: 'rapidapi' });
}

// ════════════════════════════════════════════════════════════════════════
// AI FACTS — sloučeno z původního api/ai-facts.js
// ════════════════════════════════════════════════════════════════════════

// Hlavní generační flow (volá ho ?action=facts-generate s Bearer CRON_SECRET)
async function runFactsGenerate(res) {
  if (!GROQ_KEY) return res.status(500).json({ error: 'GROQ_API_KEY není nastaveno' });
  if (!SB_SVC)   return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY není nastaveno' });

  try {
    const newFacts = await generateFactsViaAI();
    if (!newFacts || !newFacts.length) {
      return res.status(500).json({ error: 'AI nevrátila validní fakty' });
    }

    const inserted = [];
    const skipped  = [];
    for (const f of newFacts) {
      const ok = await insertAiFact(f);
      if (ok) inserted.push(f.title);
      else    skipped.push(f.title);
    }

    return res.status(200).json({
      ok:             true,
      generated:      newFacts.length,
      inserted:       inserted.length,
      skipped:        skipped.length,
      insertedTitles: inserted,
    });
  } catch (e) {
    console.error('[facts-generate] error:', e);
    return res.status(500).json({ error: e.message });
  }
}

// Volá Groq Llama 3.3 70B → 5 unikátních faktů (mix kind: fact/tip)
async function generateFactsViaAI() {
  const prompt = `Jsi expert na Pokémon TCG svět a UX writer pro web PokéTrade (česká aplikace pro správu sběratelských karet).

Vygeneruj 5 unikátních krátkých příspěvků pro rotující "Profesor Oak" box na hlavní stránce.

PRAVIDLA:
- 3 položky typu "fact" (zajímavost o Pokémonech, anime, hrách, designérech)
- 2 položky typu "tip" (návod jak používat web PokéTrade — sdílení alb, ceny z Cardmarketu, rodinné propojení, skener karet, nabídky, výměny)
- Každý "title" max 4 slova, "body" max 200 znaků (1-2 věty)
- Pro "fact" volj méně známé zajímavosti, ne triviální (NE "Pikachu je žlutý", NE "Pokémon je z Japonska")
- Pro "tip" buď konkrétní funkce webu: skener, ceny Cardmarketu, sdílení s časovým limitem, rodinný klan, výměny, protinabídky, JP/CN karty, porovnání alb
- Český jazyk
- Hravý ale věcný tón, vyhni se klišé

VRAŤ POUZE JSON pole, žádný markdown ani komentář:
[
  {"kind":"fact","emoji":"⚡","title":"Krátký název","body":"Tělo věty 1-2."},
  {"kind":"tip","emoji":"📸","title":"Krátký název","body":"Tělo věty 1-2."}
]`;

  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${GROQ_KEY}`,
    },
    body: JSON.stringify({
      model:       'llama-3.3-70b-versatile',
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.9,
      max_tokens:  1500,
    }),
  });

  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    throw new Error(`Groq HTTP ${r.status}: ${errText.slice(0, 200)}`);
  }

  const data = await r.json();
  const content = data.choices?.[0]?.message?.content || '';
  const cleaned = content.replace(/```json\s*/gi, '').replace(/```\s*$/g, '').trim();
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('AI nevrátila JSON pole');

  let parsed;
  try { parsed = JSON.parse(match[0]); }
  catch (e) { throw new Error('AI vrátila nevalidní JSON: ' + e.message); }

  if (!Array.isArray(parsed)) throw new Error('AI nevrátila pole');

  const valid = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const kind  = (item.kind || '').toString().toLowerCase();
    const title = (item.title || '').toString().trim().slice(0, 60);
    const body  = (item.body || '').toString().trim().slice(0, 280);
    const emoji = (item.emoji || '🌟').toString().slice(0, 4);
    if (!['fact', 'tip'].includes(kind)) continue;
    if (!title || title.length < 3) continue;
    if (!body  || body.length  < 10) continue;
    valid.push({ kind, title, body, emoji });
  }
  return valid;
}

// Vlož 1 fakt do DB (skip duplicit přes UNIQUE text_hash)
async function insertAiFact(f) {
  const text_hash = await sha256Hex(f.title + '|' + f.body);
  const r = await fetch(`${SB_URL}/rest/v1/ai_facts`, {
    method: 'POST',
    headers: {
      'apikey':        SB_SVC,
      'Authorization': `Bearer ${SB_SVC}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify({
      kind:      f.kind,
      emoji:     f.emoji,
      title:     f.title,
      body:      f.body,
      text_hash: text_hash,
      source:    'ai',
    }),
  });
  if (r.status === 409) return false; // duplicita
  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    console.warn(`[insertAiFact] ${r.status}: ${errText.slice(0, 150)}`);
    return false;
  }
  return true;
}

// SHA-256 hex (Node 16+ Web Crypto)
async function sha256Hex(input) {
  const buf  = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}
