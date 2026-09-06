/**
 * POST /api/translate-jp
 *
 * Přeloží japonský název Pokémon karty na anglický ekvivalent.
 *
 * Priorita klíče:
 *   1. Uživatelův vlastní Groq klíč (user_api_keys v Supabase)
 *      → groq_key může být "gsk_key1,gsk_key2,..." (více klíčů)
 *      → používáme první aktivní klíč (rotace při chybě)
 *   2. Systémový klíč z GROQ_API_KEY env proměnné (Vercel)
 *
 * Body: { jpName, category, hp, token }
 * Odpověď: { enName } nebo { error }
 */

const SUPABASE_URL  = 'https://xrduqwrinzvmpixgmqta.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyZHVxd3Jpbnp2bXBpeGdtcXRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDI0MjksImV4cCI6MjA5MDk3ODQyOX0.2p404Vy77CH_MsvQlnpxaO0H-KlSSt_oJlaFrmttFXs';
const GROQ_API      = 'https://api.groq.com/openai/v1/chat/completions';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

// Parsuje groq_key string (může být "key1,key2,key3") → pole klíčů
function parseGroqKeys(raw) {
  if (!raw) return [];
  return raw.split(',').map(k => k.trim()).filter(k => k.length > 10);
}

// Zavolá Groq API s daným klíčem, vrátí přeložené jméno nebo null
async function callGroq(groqKey, prompt) {
  const groqRes = await fetch(GROQ_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${groqKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-120b',
      max_tokens: 40,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!groqRes.ok) return null;
  const data = await groqRes.json();
  const raw = data?.choices?.[0]?.message?.content?.trim() || '';
  const enName = raw.replace(/^["'「」『』]|["'「」『』]$/g, '').split('\n')[0].trim();
  return enName || null;
}

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Použij POST' });

  const { jpName, category, hp, token } = req.body || {};
  if (!jpName) return res.status(400).json({ error: 'Chybí jpName' });
  if (!token)  return res.status(401).json({ error: 'Chybí token' });

  // ── 1. Ověř token + načti klíče ze Supabase ────────────────
  let groqKeys = [];
  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}` },
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Neplatný token' });
    const user = await userRes.json();
    if (!user?.id) return res.status(401).json({ error: 'Neplatný token' });

    const keyRes = await fetch(
      `${SUPABASE_URL}/rest/v1/user_api_keys?user_id=eq.${user.id}&select=groq_key,groq_enabled`,
      { headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}` } }
    );
    const rows = await keyRes.json();
    const row  = Array.isArray(rows) ? rows[0] : null;
    // groq_key může být "gsk_key1,gsk_key2,..." → parsujeme
    if (row?.groq_enabled && row?.groq_key) {
      groqKeys = parseGroqKeys(row.groq_key);
    }
  } catch (e) {
    return res.status(500).json({ error: 'Chyba ověření' });
  }

  // ── 2. Fallback na systémový klíč z Vercel env ─────────────
  if (!groqKeys.length && process.env.GROQ_API_KEY) {
    groqKeys = parseGroqKeys(process.env.GROQ_API_KEY);
  }

  if (!groqKeys.length) {
    return res.status(200).json({ enName: null, reason: 'no_groq_key' });
  }

  // ── 3. Prompt pro překlad ───────────────────────────────────
  const prompt = [
    'You are a Pokémon TCG expert. Translate the Japanese card name to its official English name.',
    `Japanese name: ${jpName}`,
    category ? `Card category: ${category}` : '',
    hp       ? `HP: ${hp}` : '',
    '',
    'Rules:',
    '- Return ONLY the English card name (e.g. "Hisuian Lilligant V")',
    '- No explanation, no quotes, no extra text',
    '- If the Pokémon has a regional form prefix (Hisuian, Galarian, Alolan, Paldean), include it',
    '- Keep the card subtype suffix (V, VMAX, VSTAR, ex, GX, EX, etc.)',
  ].filter(Boolean).join('\n');

  // ── 4. Zkus klíče postupně (rotace při selhání) ────────────
  for (const key of groqKeys) {
    try {
      const enName = await callGroq(key, prompt);
      if (enName) return res.status(200).json({ enName });
    } catch (e) {
      console.warn('[translate-jp] Klíč selhal, zkouším další…', e.message);
    }
  }

  // Všechny klíče selhaly
  console.error('[translate-jp] Všechny Groq klíče selhaly');
  return res.status(200).json({ enName: null, reason: 'groq_error' });
}
