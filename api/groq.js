/**
 * api/groq.js – Groq AI proxy s rate limitingem
 *
 * PRIORITA KLÍČE:
 *   1. X-Groq-Key header  → uživatelův vlastní klíč (bez limitů)
 *   2. Bearer token       → ověř identitu, zkontroluj limity, použij sdílený klíč
 *
 * LIMITY sdíleného klíče (běžný uživatel):
 *   - 20 volání/den  pro usage_type='search'
 *   - 10 volání/den  pro usage_type='fake'
 *
 * VIP účty: bez limitů (klíč nevidí)
 * OWNER účet: bez limitů (klíč vidí v nastavení)
 */

const GROQ_API     = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_BODY     = 20 * 1024 * 1024; // 20 MB (base64 obrázky)

// ── Vercel: zvýši default body limit z 1 MB na 20 MB pro base64 obrázky ──
//    Bez tohoto Vercel ořeže body → req.body je undefined → 400 "Chybí messages"
export const config = {
  api: {
    bodyParser: { sizeLimit: '20mb' },
  },
};

const SUPABASE_URL  = 'https://xrduqwrinzvmpixgmqta.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyZHVxd3Jpbnp2bXBpeGdtcXRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDI0MjksImV4cCI6MjA5MDk3ODQyOX0.2p404Vy77CH_MsvQlnpxaO0H-KlSSt_oJlaFrmttFXs';

// VIP = bez limitů, klíč nevidí
const VIP_EMAILS = new Set([
  'adelka.papezova@gmail.com',
  'james.t.kirk1933@gmail.com',
  'lasovlas@seznam.cz',
  'loydtest@gmail.com',
  'pan.spock30@gmail.com',
  'pokecards.app.info@gmail.com',
]);
// OWNER = bez limitů, klíč vidí v nastavení
const OWNER_EMAIL = 'papez.ondrej@gmail.com';

const LIMITS = { search: 20, fake: 10 };

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Groq-Key, Authorization',
};

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Použij POST' });

  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > MAX_BODY) return res.status(413).json({ error: 'Request příliš velký' });

  const body = req.body;
  if (!body?.messages) return res.status(400).json({ error: 'Chybí messages' });

  const safeBody = {
    model:       body.model || 'meta-llama/llama-4-scout-17b-16e-instruct',
    messages:    body.messages,
    temperature: body.temperature ?? 0.1,
    max_tokens:  Math.min(body.max_tokens ?? 800, 2000),
    stream:      false,
  };

  // ── 1. Uživatelův vlastní klíč ──────────────────────────────
  const personalKey = (req.headers['x-groq-key'] || '').trim();
  if (personalKey.length > 10) {
    return proxyToGroq(res, personalKey, safeBody);
  }

  // ── 2. Sdílený klíč – ověř uživatele ───────────────────────
  const sharedKey = (process.env.GROQ_API_KEY || '').trim();
  if (!sharedKey) {
    return res.status(503).json({
      error: 'Groq klíč není nastaven. Zadej si vlastní klíč v nastavení Scanneru.',
      code: 'NO_SHARED_KEY',
    });
  }

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) {
    return res.status(401).json({
      error: 'Nejsi přihlášen. Přihlas se nebo zadej vlastní Groq klíč.',
      code: 'NO_AUTH',
    });
  }

  // Ověř token → zjisti email
  let userEmail, userId;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}` },
    });
    if (!r.ok) throw new Error('bad token');
    const u = await r.json();
    userEmail = u?.email || '';
    userId    = u?.id    || '';
  } catch {
    return res.status(401).json({ error: 'Neplatný přihlašovací token.', code: 'BAD_TOKEN' });
  }

  // VIP nebo owner → bez limitů
  if (userEmail === OWNER_EMAIL || VIP_EMAILS.has(userEmail)) {
    return proxyToGroq(res, sharedKey, safeBody);
  }

  // ── 3. Rate limiting pro běžné uživatele ───────────────────
  const usageType = body.usage_type || 'search'; // 'search' | 'fake'
  const limit     = LIMITS[usageType] ?? LIMITS.search;
  const today     = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Načti dnešní použití
  const usageRes = await fetch(
    `${SUPABASE_URL}/rest/v1/groq_usage?user_id=eq.${userId}&date=eq.${today}&select=id,search_count,fake_count`,
    { headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}` } }
  );
  const usageRows = await usageRes.json().catch(() => []);
  const usage     = Array.isArray(usageRows) ? usageRows[0] : null;

  const currentCount = usage ? (usageType === 'fake' ? usage.fake_count : usage.search_count) : 0;

  if (currentCount >= limit) {
    return res.status(429).json({
      error: `Denní limit vyčerpán (${limit} ${usageType === 'fake' ? 'falzum detekcí' : 'hledání'}/den). Zadej si vlastní Groq klíč zdarma na console.groq.com.`,
      code:  'RATE_LIMITED',
      limit, used: currentCount, reset: 'půlnoc CET',
    });
  }

  // Proveď volání
  const groqResult = await proxyToGroq(res, sharedKey, safeBody, true);

  // Inkrementuj počítadlo až po úspěšném volání
  if (groqResult?.ok) {
    const patch = usageType === 'fake'
      ? { fake_count:   (usage?.fake_count   || 0) + 1 }
      : { search_count: (usage?.search_count || 0) + 1 };

    if (usage?.id) {
      // UPDATE
      await fetch(`${SUPABASE_URL}/rest/v1/groq_usage?id=eq.${usage.id}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json', 'Prefer': 'return=minimal',
        },
        body: JSON.stringify(patch),
      }).catch(() => {});
    } else {
      // INSERT
      await fetch(`${SUPABASE_URL}/rest/v1/groq_usage`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json', 'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ user_id: userId, date: today, search_count: 0, fake_count: 0, ...patch }),
      }).catch(() => {});
    }
  }
}

// ── Helper: zavolá Groq API ────────────────────────────────────
async function proxyToGroq(res, key, body, returnMeta = false) {
  try {
    const r = await fetch(GROQ_API, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) {
      if (!returnMeta) res.status(r.status).json({ error: data?.error?.message || 'Groq error', status: r.status });
      return { ok: false };
    }
    if (!returnMeta) res.status(200).json(data);
    else             res.status(200).json(data);
    return { ok: true };
  } catch (err) {
    if (!returnMeta) res.status(502).json({ error: 'Nepodařilo se spojit s Groq: ' + err.message });
    return { ok: false };
  }
}
