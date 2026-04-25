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
      fetchFromRapidApi(cached.name_en || name, set, number, lang).then(fresh => {
        if (!fresh) return;
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
