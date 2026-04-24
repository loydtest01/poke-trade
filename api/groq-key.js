/**
 * GET /api/groq-key?t=<supabase_token>
 * Vrací Groq API klíč pro mobilní aplikaci.
 *
 * PRIORITA:
 *   1. Vlastní klíč uživatele z user_api_keys (groq_enabled=true)
 *   2. Sdílený klíč ze serveru (GROQ_API_KEY env) pro přihlášené uživatele
 *      → VIP (tabulka vip_users) a owner dostanou shared klíč bez limitů
 *      → Ostatní přihlášení dostanou shared klíč s rate limitem (hlídá api/groq.js)
 */

const SUPABASE_URL     = 'https://xrduqwrinzvmpixgmqta.supabase.co';
const SUPABASE_ANON    = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyZHVxd3Jpbnp2bXBpeGdtcXRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDI0MjksImV4cCI6MjA5MDk3ODQyOX0.2p404Vy77CH_MsvQlnpxaO0H-KlSSt_oJlaFrmttFXs';
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY || SUPABASE_ANON;

const OWNER_EMAIL = 'papez.ondrej@gmail.com';

// Cache VIP emailů (5 minut) — stejná logika jako v api/groq.js
let _vipCache = null;
let _vipCacheTime = 0;
const VIP_CACHE_TTL = 5 * 60 * 1000;

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
      }
    } catch(e) {
      console.error('[groq-key] VIP cache chyba:', e.message);
    }
  }
  return _vipCache?.has(email) ?? false;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.query.t || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Chybí token' });

  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}` }
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Neplatný token' });
    const user = await userRes.json();
    if (!user?.id) return res.status(401).json({ error: 'Neplatný token' });

    const userEmail = user.email || '';
    const vip = userEmail === OWNER_EMAIL || await isVip(userEmail);

    // 1. Vlastní klíče uživatele → priorita (načti všechny 3 providery)
    const keyRes = await fetch(
      `${SUPABASE_URL}/rest/v1/user_api_keys?user_id=eq.${user.id}&select=groq_key,groq_enabled,cerebras_key,openrouter_key`,
      { headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}` } }
    );
    const rows = await keyRes.json();
    const row  = Array.isArray(rows) ? rows[0] : null;

    const hasPersonal = row && ((row.groq_key && row.groq_enabled !== false) || row.cerebras_key || row.openrouter_key);

    if (hasPersonal) {
      return res.status(200).json({
        // Nový formát: všechny 3 providery
        groq_key:       (row.groq_enabled !== false) ? (row.groq_key || null) : null,
        cerebras_key:   row.cerebras_key   || null,
        openrouter_key: row.openrouter_key || null,
        // Legacy kompatibilita pro starší klienty:
        key:            (row.groq_enabled !== false) ? (row.groq_key || null) : null,
        enabled:        true,
        source:         'personal',
        vip,
      });
    }

    // 2. Sdílený klíč pro všechny přihlášené (jen Groq v env)
    const sharedKey = (process.env.GROQ_API_KEY || '').trim();
    if (sharedKey) {
      return res.status(200).json({
        groq_key:       sharedKey,
        cerebras_key:   null,
        openrouter_key: null,
        key:            sharedKey,  // legacy
        enabled:        true,
        source:         'shared',
        vip,
      });
    }

    return res.status(200).json({
      groq_key:       null,
      cerebras_key:   null,
      openrouter_key: null,
      key:            null,
      enabled:        false,
      vip,
    });

  } catch (err) {
    console.error('groq-key error:', err);
    return res.status(500).json({ error: 'Interní chyba' });
  }
}
