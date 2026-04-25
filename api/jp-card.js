/**
 * api/jp-card.js — Vercel Serverless Function (verze 4 — multi-locale fallback)
 * ════════════════════════════════════════════════════════════════════════════════
 *  Proxy pro non-EN Pokémon karty (JP, ZH-TW, ZH-CN, KO, TH, DE, FR, ...).
 *
 *  KLÍČOVÁ OPRAVA v4:
 *    ZH/TW karty (např. S8F) jsou v TCGdex v locale `zh-Hant` s PŮVODNÍM set ID.
 *    v3 chybně volalo `ja/s8` (bez F) → 404.
 *    v4 zkouší v pořadí: zh-Hant/s8f → ja/s8 → vrátí první úspěšný.
 *
 *  Příklady:
 *    /api/jp-card?set=S8F&num=016&lang=ZH&mode=image → 302 TCGdex zh-Hant CDN
 *    /api/jp-card?set=S8F&num=016&lang=ZH&mode=data  → JSON s imageUrl
 *    /api/jp-card?set=swsh8&num=41&lang=DE&mode=image → 302 TCGdex DE CDN
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function buildAttempts(lang, rawSet) {
  const l      = String(lang || '').toUpperCase();
  const set    = String(rawSet || '').trim().toLowerCase();
  const setNoF = set.replace(/f$/, '');

  if (!l || l === 'JP' || l === 'JA')
    return [{ locale: 'ja', setId: setNoF }];

  if (l === 'ZH' || l === 'TW' || l === 'ZH-HANT')
    return [
      { locale: 'zh-Hant', setId: set    },
      { locale: 'ja',      setId: setNoF },
    ];

  if (l === 'CN' || l === 'ZH-HANS')
    return [
      { locale: 'zh-Hans', setId: set    },
      { locale: 'ja',      setId: setNoF },
    ];

  if (l === 'KO') return [{ locale: 'ko', setId: set }, { locale: 'ja', setId: setNoF }];
  if (l === 'TH') return [{ locale: 'th', setId: set }, { locale: 'ja', setId: setNoF }];

  const latinMap = { EN:'en', DE:'de', FR:'fr', IT:'it', ES:'es', PT:'pt', 'PT-BR':'pt-br', 'PT-PT':'pt-pt' };
  if (latinMap[l]) return [{ locale: latinMap[l], setId: set }];

  return [{ locale: 'ja', setId: setNoF }];
}

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

  const numClean = String(num).split('/')[0].trim().padStart(3, '0');
  const attempts = buildAttempts(lang, set);

  let card = null, usedLocale = null, usedSetId = null;

  for (const { locale, setId } of attempts) {
    const url = `https://api.tcgdex.net/v2/${locale}/sets/${setId}/${numClean}`;
    try {
      const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (r.ok) {
        const data = await r.json();
        if (data?.image) { card = data; usedLocale = locale; usedSetId = setId; break; }
      }
    } catch (_) {}
  }

  if (!card?.image) {
    res.writeHead(404, { ...CORS, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      error: 'Card not found in TCGdex',
      tried: attempts.map(a => `${a.locale}/sets/${a.setId}/${numClean}`),
    }));
  }

  if (mode === 'image') {
    res.writeHead(302, {
      ...CORS,
      Location:      `${card.image}/high.webp`,
      'Cache-Control': 'public, max-age=604800, immutable',
    });
    return res.end();
  }

  if (mode === 'data') {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' });
    return res.end(JSON.stringify({
      name:          card.name        || '',
      hp:            card.hp          || null,
      types:         card.types       || [],
      rarity:        card.rarity      || '',
      illustrator:   card.illustrator || '',
      category:      card.category    || 'Pokemon',
      localId:       card.localId     || numClean,
      setId:         card.set?.id     || usedSetId,
      setName:       card.set?.name   || '',
      imageUrl:      `${card.image}/high.webp`,
      imageUrlSmall: `${card.image}/low.webp`,
      sourceLocale:  usedLocale,
      sourceUrl:     `https://tcgdex.net/database/${usedSetId}/${card.localId || numClean}/${usedLocale}`,
      dexId:         card.dexId       || [],
    }));
  }

  res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Neznámý mode (použij image|data)' }));
}
