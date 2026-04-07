/**
 * api/groq.js – Vercel serverless proxy pro Groq API
 * Obchází CORS omezení browseru, schová API klíč na serveru
 * nebo přeposílá klíč uživatele ze záhlaví X-Groq-Key
 *
 * Deploy: nasadit jako součást pokemon-market-v2 na Vercel
 * URL po nasazení: /api/groq
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Groq-Key',
};

export default async function handler(req, res) {
  // Preflight CORS
  if (req.method === 'OPTIONS') {
    return res.status(200).set(CORS).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).set(CORS).json({ error: 'Method not allowed' });
  }

  // API klíč: buď ze záhlaví (uživatelův vlastní), nebo ze serverové env proměnné
  const apiKey = req.headers['x-groq-key'] || process.env.GROQ_API_KEY;

  if (!apiKey) {
    return res.status(400).set(CORS).json({
      error: 'Chybí Groq API klíč. Nastav ho v Nastavení aplikace nebo přidej GROQ_API_KEY do Vercel environment variables.'
    });
  }

  try {
    const body = req.body;

    const groqRes = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify(body),
    });

    const text = await groqRes.text();
    const data = text ? JSON.parse(text) : {};

    return res.status(groqRes.status).set(CORS).json(data);

  } catch (err) {
    console.error('[groq proxy] Error:', err);
    return res.status(500).set(CORS).json({ error: 'Proxy chyba: ' + err.message });
  }
}
