/**
 * api/jp-card.js — Vercel Serverless Function (verze 3 — surgical fix)
 * ════════════════════════════════════════════════════════════════════════
 *  Proxy pro non-EN Pokémon karty (JP, ZH-TW, ZH-CN, KO, TH, DE, FR, ...).
 *
 *  HISTORIE:
 *    v1: pokemon-card.com (přepracováno → 404)
 *    v2: TCGdex s probing stormem (3 locales × 3 nums × 2-4 sets = 36 reqs/karta)
 *    v3: TCGdex jednorázově — 1 pokus, padá tiše (žádný spam v konzoli)
 *
 *  PRINCIP v3:
 *    • Vezmi (set, num, lang) → spočti JEDNU URL → fetch → vrať/redirect.
 *    • Žádné fallbacky, žádné variants. Klient (card-search.js) si pak
 *      sám zařídí EN fallback z pokemontcg.io.
 *    • Pro `lang=ZH/TW/CN/JP` mapujeme set kód z `S8F` → `s8` (JA namespace).
 *    • Pro `lang=DE/FR/IT/ES/PT` zachováme set kód a použijeme TCGdex DE/FR/...
 *
 *  Příklady:
 *    /api/jp-card?set=S8F&num=016&lang=ZH&mode=image  → 302 na TCGdex JA
 *    /api/jp-card?set=swsh8&num=41&lang=DE&mode=image → 302 na TCGdex DE
 *    /api/jp-card?set=S8F&num=016&lang=ZH&mode=data   → JSON (nebo 404)
 * ════════════════════════════════════════════════════════════════════════
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ─── Mapování lang → TCGdex locale ──────────────────────────────────────
function langToLocale(lang) {
  const l = String(lang || '').toUpperCase();
  // Asia: vše sdílí JP artwork → JA locale
  if (!l || l === 'JP' || l === 'JA') return 'ja';
  if (l === 'ZH' || l === 'TW' || l === 'CN'
   || l === 'ZH-HANS' || l === 'ZH-HANT')   return 'ja';
  if (l === 'KO') return 'ko';
  if (l === 'TH') return 'th';
  // Latinka: vlastní locale (TCGdex má dobré pokrytí pro de/fr/it/es/pt)
  if (l === 'EN') return 'en';
  if (l === 'DE') return 'de';
  if (l === 'FR') return 'fr';
  if (l === 'IT') return 'it';
  if (l === 'ES') return 'es';
  if (l === 'PT') return 'pt';
  if (l === 'PT-BR' || l === 'PT-PT') return l.toLowerCase();
  // Fallback (nevíme)
  return 'ja';
}

// ─── Normalizace set kódu pro JA namespace ──────────────────────────────
// `S8F` (TW/HK) → `s8` (JP)
// `S8aF`         → `s8a`
// `SV1sF`        → `sv1s`
// Pro non-JA locale (de/fr/...) ponecháme původní set ID jen v lowercase.
function normalizeSetId(raw, locale) {
  if (!raw) return '';
  const lower = String(raw).trim().toLowerCase();
  if (locale === 'ja') return lower.replace(/f$/, '');
  return lower;
}

// ─── Hlavní handler ─────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  const { set, num, lang = 'JP', mode = 'image' } = req.query;

  if (!set || !num) {
    res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Chybí parametry set a num' }));
  }

  const locale = langToLocale(lang);
  const setId  = normalizeSetId(set, locale);
  // Číslo: `016/100` → `016`, padded na min. 3 číslice
  const numClean = String(num).split('/')[0].trim().padStart(3, '0');

  // JEDEN POKUS — žádné variants, žádné loops
  const url = `https://api.tcgdex.net/v2/${locale}/sets/${setId}/${numClean}`;

  let card = null;
  try {
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (r.ok) card = await r.json();
  } catch (_) { /* tichý pád */ }

  // Karta neexistuje v TCGdex → 404 a klient padne na EN fallback
  if (!card?.image) {
    res.writeHead(404, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      error: `Card not in TCGdex`,
      tried: { locale, setId, num: numClean },
    }));
  }

  // ── mode=image → 302 redirect na TCGdex CDN ─────────────────────────
  if (mode === 'image') {
    res.writeHead(302, {
      ...CORS,
      'Location':      `${card.image}/high.webp`,
      'Cache-Control': 'public, max-age=604800, immutable',  // 7 dní
    });
    return res.end();
  }

  // ── mode=data → JSON ────────────────────────────────────────────────
  if (mode === 'data') {
    res.writeHead(200, {
      ...CORS,
      'Content-Type':  'application/json',
      'Cache-Control': 'public, max-age=86400',
    });
    return res.end(JSON.stringify({
      name:          card.name        || '',
      hp:            card.hp          || null,
      types:         card.types       || [],
      rarity:        card.rarity      || '',
      illustrator:   card.illustrator || '',
      category:      card.category    || 'Pokemon',
      localId:       card.localId     || numClean,
      setId:         card.set?.id     || setId,
      setName:       card.set?.name   || '',
      imageUrl:      `${card.image}/high.webp`,
      imageUrlSmall: `${card.image}/low.webp`,
      sourceLocale:  locale,
      sourceUrl:     `https://tcgdex.net/database/${setId}/${card.localId || numClean}/${locale}`,
      dexId:         card.dexId       || [],
    }));
  }

  res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Neznámý mode (použij image|data)' }));
}
