/**
 * api/jp-card.js — Vercel Serverless Function  (verze 2 — TCGdex)
 * ════════════════════════════════════════════════════════════════════════
 *  Proxy pro ne-anglické Pokémon karty (JP, ZH-TW, ZH-CN, KO, TH).
 *
 *  Stará verze volala pokemon-card.com (stránka přepracovaná → 404).
 *  Nová verze používá TCGdex (https://tcgdex.dev) — open-source, zdarma,
 *  bez API klíče, podporuje 14+ jazyků a má CORS povolený na assetech.
 *
 *  Princip:
 *    • ZH/TW/CN karty = překlady JP → sdílí artwork → mapujeme na JA locale
 *      (S8F → s8, S8aF → s8a …). Uživatel uvidí JP obrázek (stejná ilustrace).
 *    • JP karty → JA locale přímo.
 *    • KO/TH karty → vlastní locale s fallbackem na JA.
 *
 *  Příklady:
 *    /api/jp-card?set=S8F&num=016&lang=ZH&mode=image   → 302 na TCGdex JA image
 *    /api/jp-card?set=S8&num=016&mode=image            → 302 (backward-compat, default lang=JP)
 *    /api/jp-card?set=S8F&num=016&lang=ZH&mode=data    → JSON s daty karty
 *
 *  Zpětná kompatibilita:
 *    Staré URL `?set=S8&num=016&mode=image` bez `lang` parametru
 *    defaultují na `lang=JP` → funguje beze změny (fix pro staré záznamy v DB).
 * ════════════════════════════════════════════════════════════════════════
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ─── Lookup tabulka pro ZH/TW edge-case sety ────────────────────────────
// Pokud nějaký ZH/TW set kód nekoresponduje s JP setem po pouhém "strip F",
// přidej ho sem. Klíč = lowercase ZH/TW set kód bez mezer. Hodnota = JP set ID.
//
// Většina sad ale funguje automaticky:
//   S8F → s8, S8aF → s8a, SV1sF → sv1s, …
const ZH_SET_ALIAS = {
  // Př. edge-case mapping (zatím prázdné, doplň dle potřeby):
  // 's8f-premium': 's8b',   // Pokud by ZH Premium Bundle používal JP VMAX Climax kartu
};

/**
 * Normalizuje libovolný set kód (ZH/TW/CN/JP/en) na TCGdex JA set ID.
 *
 *   'S8F'   → 's8'        (ZH Fusion Arts → JP Fusion Arts)
 *   'S8'    → 's8'
 *   's8a'   → 's8a'
 *   'S10aF' → 's10a'
 *   'SV1sF' → 'sv1s'
 */
function normalizeJpSetId(raw) {
  if (!raw) return '';
  const trimmed = String(raw).trim();

  // Přesná shoda v alias mapě (pro výjimky)
  const lookup = trimmed.toLowerCase().replace(/\s+/g, '');
  if (ZH_SET_ALIAS[lookup]) return ZH_SET_ALIAS[lookup];

  // Standardní normalizace: lowercase + odstranění koncového F (ZH suffix)
  return trimmed.toLowerCase().replace(/f$/, '');
}

/**
 * Mapuje uživatelský jazykový kód na TCGdex locale.
 * ZH/TW/CN/JP → 'ja' (JP artwork platí pro všechny)
 * KO           → 'ko'
 * TH           → 'th'
 * Ostatní      → 'ja' jako default
 */
function langToLocale(lang) {
  const l = String(lang || '').toUpperCase();
  if (!l || l === 'JP' || l === 'JA') return 'ja';
  if (l === 'ZH' || l === 'TW' || l === 'CN')        return 'ja';   // sdílí artwork s JP
  if (l === 'ZH-HANS' || l === 'ZH-HANT')            return 'ja';
  if (l === 'KO') return 'ko';
  if (l === 'TH') return 'th';
  if (l === 'EN') return 'en';
  if (l === 'FR') return 'fr';
  if (l === 'DE') return 'de';
  if (l === 'ES') return 'es';
  if (l === 'IT') return 'it';
  if (l === 'PT') return 'pt';
  if (l === 'PT-BR' || l === 'PT-PT') return l.toLowerCase();
  return 'ja';
}

/**
 * Stáhne JSON z TCGdex. Vrací null na 404/chybu.
 * TCGdex akceptuje číslo karty jak padded ("016") tak unpadded ("16"),
 * zkouším oba.
 */
async function tcgdexFetch(locale, setId, num) {
  if (!locale || !setId || !num) return null;
  const n = String(num).trim();
  const unpadded = String(parseInt(n, 10)) || n;
  const padded   = n.padStart(3, '0');
  const variants = [...new Set([unpadded, padded, n])];

  for (const v of variants) {
    const url = `https://api.tcgdex.net/v2/${locale}/sets/${setId}/${v}`;
    try {
      const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (r.ok) {
        const data = await r.json();
        if (data && data.name) return data;
      }
    } catch (_) { /* zkus další variant */ }
  }
  return null;
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

  const setId   = normalizeJpSetId(set);
  const primary = langToLocale(lang);

  // Vyzkoušej preferovaný locale, pak fallback na 'ja', pak 'en'
  const localesToTry = [...new Set([primary, 'ja', 'en'])];
  let card = null;
  let usedLocale = null;

  for (const loc of localesToTry) {
    card = await tcgdexFetch(loc, setId, num);
    if (card) { usedLocale = loc; break; }
  }

  // Pokud set má ZH F-suffix a selhal i 'ja', zkus i původní kód (bez strip)
  if (!card) {
    const rawLower = String(set).toLowerCase();
    if (rawLower !== setId) {
      for (const loc of localesToTry) {
        card = await tcgdexFetch(loc, rawLower, num);
        if (card) { usedLocale = loc; break; }
      }
    }
  }

  if (!card || !card.image) {
    res.writeHead(404, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      error: `Karta nenalezena v TCGdex`,
      set:   setId,
      num:   String(num),
      lang:  primary,
      tried: localesToTry,
    }));
  }

  // ── mode=image → 302 redirect na TCGdex CDN ─────────────────────────
  // Browser cachuje a vykresluje přímo z assets.tcgdex.net (CORS OK).
  if (mode === 'image') {
    const imageUrl = `${card.image}/high.webp`;
    res.writeHead(302, {
      ...CORS,
      'Location':      imageUrl,
      'Cache-Control': 'public, max-age=604800, immutable',  // 7 dní
    });
    return res.end();
  }

  // ── mode=data → JSON s detaily karty ────────────────────────────────
  if (mode === 'data') {
    const payload = {
      name:           card.name         || '',
      hp:             card.hp           || null,
      types:          card.types        || [],
      rarity:         card.rarity       || '',
      illustrator:    card.illustrator  || '',
      category:       card.category     || 'Pokemon',
      localId:        card.localId      || String(num),
      setId:          card.set?.id      || setId,
      setName:        card.set?.name    || '',
      imageUrl:       `${card.image}/high.webp`,
      imageUrlSmall:  `${card.image}/low.webp`,
      imageUrlPng:    `${card.image}/high.png`,
      sourceLocale:   usedLocale,
      sourceUrl:      `https://tcgdex.net/database/${setId}/${card.localId || num}/${usedLocale}`,
      dexId:          card.dexId        || [],
    };
    res.writeHead(200, {
      ...CORS,
      'Content-Type':  'application/json',
      'Cache-Control': 'public, max-age=86400',  // 1 den
    });
    return res.end(JSON.stringify(payload));
  }

  res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Neznámý mode. Použij mode=image nebo mode=data' }));
}
