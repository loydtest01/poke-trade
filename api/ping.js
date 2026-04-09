/**
 * GET /api/ping
 * Jednoduchý ping – mobilní aplikace ho volá pro ověření spojení se serverem.
 */
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.status(200).json({ ok: true, ts: Date.now() });
}
