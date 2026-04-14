/**
 * api/tcg.js – Proxy pro api.pokemontcg.io (řeší CORS)
 *
 * Použití:
 *   Místo: https://api.pokemontcg.io/v2/cards?q=name:"Pikachu"
 *   Volej: /api/tcg?q=name:"Pikachu"
 *          /api/tcg?id=swsh12pt5-4          ← konkrétní karta
 *          /api/tcg?path=sets               ← jiné endpointy
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).set(CORS_HEADERS).end();
  }

  try {
    const { id, path, ...rest } = req.query;

    // Sestav URL na pokemontcg.io
    let tcgUrl;
    if (id) {
      // /api/tcg?id=swsh12pt5-4  →  /v2/cards/swsh12pt5-4
      tcgUrl = `https://api.pokemontcg.io/v2/cards/${encodeURIComponent(id)}`;
    } else {
      // /api/tcg?q=name:"Pikachu"&pageSize=20  →  /v2/cards?q=...
      const endpoint = path || 'cards';
      const params = new URLSearchParams(rest).toString();
      tcgUrl = `https://api.pokemontcg.io/v2/${endpoint}${params ? '?' + params : ''}`;
    }

    const upstream = await fetch(tcgUrl, {
      headers: { 'User-Agent': 'PokeTrade-Proxy/1.0' },
    });

    const data = await upstream.json();

    return res
      .status(upstream.status)
      .set({ ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 's-maxage=300' })
      .json(data);

  } catch (err) {
    return res
      .status(502)
      .set(CORS_HEADERS)
      .json({ error: true, message: 'TCG API proxy chyba: ' + err.message });
  }
}
