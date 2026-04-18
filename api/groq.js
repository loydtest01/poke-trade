/**
 * api/groq.js — Groq AI proxy pro PokéTrade
 *
 * PRIORITA KLÍČE:
 *   1. X-Groq-Key header  → uživatelův vlastní klíč (bez limitů)
 *   2. Bearer token       → ověř identitu, zkontroluj limity, použij sdílený klíč
 *
 * SDÍLENÉ KLÍČE (env proměnné):
 *   GROQ_API_KEY   = klíč1,klíč2,klíč3,klíč4,klíč5   (čárkou oddělené)
 *   nebo GROQ_API_KEY_1 … GROQ_API_KEY_5              (individuální proměnné)
 *   → při 429 se automaticky rotuje na další klíč
 *
 * LIMITY sdíleného klíče (běžný uživatel):
 *   - 20 volání/den  pro usage_type='search'
 *   - 10 volání/den  pro usage_type='fake'
 *
 * VIP účty: bez limitů
 * OWNER účet: bez limitů
 */

const GROQ_API      = 'https://api.groq.com/openai/v1/chat/completions';
const MAX_BODY_BYTES = 20 * 1024 * 1024; // 20 MB (base64 obrázky)

const SUPABASE_URL     = 'https://xrduqwrinzvmpixgmqta.supabase.co';
const SUPABASE_ANON    = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyZHVxd3Jpbnp2bXBpeGdtcXRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDI0MjksImV4cCI6MjA5MDk3ODQyOX0.2p404Vy77CH_MsvQlnpxaO0H-KlSSt_oJlaFrmttFXs';
// Service key – čte tabulku vip_users (RLS obchází). Nastav jako env proměnnou SUPABASE_SERVICE_KEY.
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY || SUPABASE_ANON;

const OWNER_EMAIL = 'papez.ondrej@gmail.com';
const LIMITS = { search: 20, fake: 10 };

// ── Cache VIP emailů (platí 5 minut, aby se nequeroval Supabase při každém volání) ──
let _vipCache = null;
let _vipCacheTime = 0;
const VIP_CACHE_TTL = 5 * 60 * 1000; // 5 minut

async function isVip(email) {
  if (!email) return false;
  const now = Date.now();
  if (!_vipCache || now - _vipCacheTime > VIP_CACHE_TTL) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/vip_users?select=email`, {
        headers: { 'apikey': SUPABASE_SERVICE, 'Authorization': `Bearer ${SUPABASE_SERVICE}` },
      });
      if (r.ok) {
        const rows = await r.json();
        _vipCache = new Set((rows || []).map(row => row.email));
        _vipCacheTime = now;
        console.log('[api/groq] VIP cache načtena:', _vipCache.size, 'emailů');
      }
    } catch(e) {
      console.error('[api/groq] Chyba načítání VIP cache:', e.message);
      // Pokud selže → vrať false (neriskujeme odepření přístupu z technické chyby)
    }
  }
  return _vipCache?.has(email) ?? false;
}

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Groq-Key, Authorization',
};

// ── Načti všechny sdílené klíče z env proměnných ──────────────
// Podporuje:
//   GROQ_API_KEY=klíč1,klíč2,klíč3
//   nebo GROQ_API_KEY_1, GROQ_API_KEY_2, … GROQ_API_KEY_5
function loadSharedKeys() {
  const keys = [];

  // Možnost A: čárkou oddělené v jedné proměnné
  const combined = (process.env.GROQ_API_KEY || '').trim();
  if (combined) {
    combined.split(',').forEach(k => {
      const t = k.trim();
      if (t.length > 10) keys.push(t);
    });
  }

  // Možnost B: individuální proměnné GROQ_API_KEY_1 … GROQ_API_KEY_5
  for (let i = 1; i <= 5; i++) {
    const k = (process.env[`GROQ_API_KEY_${i}`] || '').trim();
    if (k.length > 10 && !keys.includes(k)) keys.push(k);
  }

  return keys;
}

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Použij POST' });

  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > MAX_BODY_BYTES) return res.status(413).json({ error: 'Request příliš velký' });

  const body = req.body;
  if (!body?.messages) return res.status(400).json({ error: 'Chybí messages' });

  const safeBody = {
    model:       body.model || 'meta-llama/llama-4-scout-17b-16e-instruct',
    messages:    body.messages,
    temperature: body.temperature ?? 0.1,
    max_tokens:  Math.min(body.max_tokens ?? 800, 2000),
    stream:      false,
  };

  // ── 1. Osobní klíč přes X-Groq-Key ────────────────────────────
  const personalKey = (req.headers['x-groq-key'] || '').trim();
  if (personalKey.length > 10) {
    return proxyToGroq(res, [personalKey], safeBody);
  }

  // ── 2. Sdílený klíč přes Bearer token ─────────────────────────
  const sharedKeys = loadSharedKeys();
  if (sharedKeys.length === 0) {
    return res.status(503).json({
      error: 'Groq klíče nejsou nastaveny na serveru. Zadej vlastní klíč v nastavení.',
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

  // Ověř token → zjisti email a userId
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
  if (userEmail === OWNER_EMAIL || await isVip(userEmail)) {
    return proxyToGroq(res, sharedKeys, safeBody);
  }

  // ── 3. Rate limiting pro běžné uživatele ───────────────────────
  const usageType = body.usage_type || 'search';
  const limit     = LIMITS[usageType] ?? LIMITS.search;
  const today     = new Date().toISOString().slice(0, 10);

  const usageRes = await fetch(
    `${SUPABASE_URL}/rest/v1/groq_usage?user_id=eq.${userId}&date=eq.${today}&select=id,search_count,fake_count`,
    { headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}` } }
  );
  const usageRows = await usageRes.json().catch(() => []);
  const usage     = Array.isArray(usageRows) ? usageRows[0] : null;
  const currentCount = usage ? (usageType === 'fake' ? usage.fake_count : usage.search_count) : 0;

  if (currentCount >= limit) {
    return res.status(429).json({
      error: `Denní limit vyčerpán (${limit} ${usageType === 'fake' ? 'detekcí falzifikátů' : 'hledání'}/den). Zadej vlastní Groq klíč zdarma na console.groq.com.`,
      code:  'RATE_LIMITED',
      limit, used: currentCount, reset: 'půlnoc CET',
    });
  }

  // Proveď volání (s rotací klíčů)
  const groqResult = await proxyToGroq(res, sharedKeys, safeBody, true);

  // Inkrementuj počítadlo po úspěšném volání
  if (groqResult?.ok) {
    const patch = usageType === 'fake'
      ? { fake_count:   (usage?.fake_count   || 0) + 1 }
      : { search_count: (usage?.search_count || 0) + 1 };

    if (usage?.id) {
      await fetch(`${SUPABASE_URL}/rest/v1/groq_usage?id=eq.${usage.id}`, {
        method: 'PATCH',
        headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}`,
                   'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify(patch),
      }).catch(() => {});
    } else {
      await fetch(`${SUPABASE_URL}/rest/v1/groq_usage`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}`,
                   'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ user_id: userId, date: today, search_count: 0, fake_count: 0, ...patch }),
      }).catch(() => {});
    }
  }
}

// ── Helper: zavolá Groq s rotací klíčů při 429 ────────────────
async function proxyToGroq(res, keys, body, returnMeta = false) {
  let lastError = null;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    try {
      const r = await fetch(GROQ_API, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await r.json();

      if (r.ok) {
        res.status(200).json(data);
        return { ok: true, keyIndex: i };
      }

      // 429 = rate limit → zkus další klíč
      if (r.status === 429 && i < keys.length - 1) {
        console.warn(`[api/groq] Klíč ${i + 1}/${keys.length} rate limitován, zkouším další…`);
        lastError = data?.error?.message || 'Rate limit';
        continue;
      }

      // Jiná chyba nebo poslední klíč
      if (!returnMeta) res.status(r.status).json({ error: data?.error?.message || 'Groq error' });
      return { ok: false };

    } catch (err) {
      lastError = err.message;
      if (i < keys.length - 1) continue;
    }
  }

  // Všechny klíče selhaly
  if (!returnMeta) res.status(429).json({
    error: `Všechny Groq klíče jsou dočasně vyčerpány. Zkus to za chvíli. (${lastError})`,
    code: 'ALL_KEYS_EXHAUSTED',
  });
  return { ok: false };
}
