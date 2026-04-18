// api/imgproxy.js  –  Vercel Serverless Function
// Proxies images from images.pokemontcg.io so canvas/crossOrigin works.
// Deploy this file to /api/imgproxy.js in your Vercel project root.

export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing ?url= parameter' });
  }

  // Only allow pokemontcg.io images – never expose an open proxy
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  if (!parsed.hostname.endsWith('pokemontcg.io')) {
    return res.status(403).json({ error: 'Only pokemontcg.io URLs are allowed' });
  }

  try {
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'PokeTradeProxy/1.0' },
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: 'Upstream error' });
    }

    const contentType = upstream.headers.get('content-type') || 'image/png';
    const buffer = await upstream.arrayBuffer();

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
