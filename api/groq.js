/**
 * api/groq.js — Groq AI proxy pro PokéTrade scanner
 *
 * Vercel serverless funkce. Nasadit jako: api/groq.js
 * Scanner volá: POST /api/groq s hlavičkou X-Groq-Key
 *
 * Proč proxy místo přímého volání z klienta?
 *   - Groq API nemá CORS hlavičky pro browser (volání by selhalo)
 *   - Klíč přijde v X-Groq-Key, nikdy ho nelogujeme
 *   - Rate limiting a validace na serveru
 *
 * Vstup (body): standardní Groq /v1/chat/completions request
 * Výstup:       přeposlaná Groq odpověď nebo { error }
 */

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';

// Maximální velikost body (ochrana před zneužitím — base64 obrázky jsou velké)
const MAX_BODY_BYTES = 8 * 1024 * 1024; // 8 MB

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Groq-Key, Authorization',
  'Content-Type': 'application/json',
};

export default async function handler(req, res) {
  // Nastav CORS hlavičky vždy
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  // Preflight
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Pouze POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Použij POST' });
  }

  // Získej Groq klíč z hlavičky
  const groqKey = req.headers['x-groq-key'] || '';
  if (!groqKey || groqKey.trim().length < 10) {
    return res.status(401).json({ error: 'Chybí nebo neplatný X-Groq-Key header' });
  }

  // Kontrola velikosti těla
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Request příliš velký (max 8 MB)' });
  }

  // Body — Vercel ho parsuje automaticky jako JSON
  const body = req.body;
  if (!body || !body.model || !body.messages) {
    return res.status(400).json({ error: 'Chybí model nebo messages v těle požadavku' });
  }

  // Sanitizace — neumožníme stream (komplikuje proxy)
  const safeBody = {
    model:       body.model,
    messages:    body.messages,
    temperature: body.temperature ?? 0.1,
    max_tokens:  Math.min(body.max_tokens ?? 500, 2000), // max 2000 tokenů
    stream:      false, // vždy vypnout stream přes proxy
  };

  try {
    const groqRes = await fetch(GROQ_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqKey.trim()}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(safeBody),
    });

    const data = await groqRes.json();

    if (!groqRes.ok) {
      // Přeposli Groq chybu klientovi se správným HTTP statusem
      return res.status(groqRes.status).json({
        error:   data?.error?.message || `Groq API chyba: HTTP ${groqRes.status}`,
        code:    data?.error?.code,
        status:  groqRes.status,
      });
    }

    return res.status(200).json(data);

  } catch (err) {
    console.error('[api/groq] Fetch error:', err.message);
    return res.status(502).json({ error: 'Nepodařilo se spojit s Groq API: ' + err.message });
  }
}
