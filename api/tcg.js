/**
 * api/tcg.js – Proxy pro api.pokemontcg.io (řeší CORS)
 *
 * Použití z frontendu:
 *   /api/tcg?q=name:"Pikachu"&pageSize=20
 *   /api/tcg?id=swsh12pt5-4
 */

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { id, path: endpoint, ...rest } = req.query;

    let tcgUrl;
    if (id) {
      // /api/tcg?id=swsh12pt5-4  →  GET /v2/cards/swsh12pt5-4
      tcgUrl = `https://api.pokemontcg.io/v2/cards/${encodeURIComponent(id)}`;
    } else {
      // /api/tcg?q=name:"Pikachu"&pageSize=20  →  GET /v2/cards?q=...
      const ep = endpoint || 'cards';
      const params = new URLSearchParams(rest).toString();
      tcgUrl = `https://api.pokemontcg.io/v2/${ep}${params ? '?' + params : ''}`;
    }

    const tcgHeaders = { 'User-Agent': 'PokeTrade-Proxy/1.0' };
    if (process.env.POKEMONTCG_API_KEY) {
      tcgHeaders['X-Api-Key'] = process.env.POKEMONTCG_API_KEY;
    }
    const upstream = await fetch(tcgUrl, { headers: tcgHeaders });

    const data = await upstream.json();

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 's-maxage=300');
    return res.status(upstream.status).json(data);

  } catch (err) {
    return res.status(502).json({ error: true, message: 'TCG proxy chyba: ' + err.message });
  }
}
