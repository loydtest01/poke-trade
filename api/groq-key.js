/**
 * GET /api/groq-key?t=<supabase_token>
 * Vrací Groq API klíč uložený v Supabase pro přihlášeného uživatele.
 * Mobilní aplikace ho volá při startu pro ověření AI dostupnosti.
 */

const SUPABASE_URL  = 'https://xrduqwrinzvmpixgmqta.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyZHVxd3Jpbnp2bXBpeGdtcXRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDI0MjksImV4cCI6MjA5MDk3ODQyOX0.2p404Vy77CH_MsvQlnpxaO0H-KlSSt_oJlaFrmttFXs';

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
    // Ověř token → získej user id
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}` }
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Neplatný token' });
    const user = await userRes.json();
    if (!user?.id) return res.status(401).json({ error: 'Neplatný token' });

    // Načti groq klíč
    const keyRes = await fetch(
      `${SUPABASE_URL}/rest/v1/user_api_keys?user_id=eq.${user.id}&select=groq_key,groq_enabled`,
      { headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}` } }
    );
    const rows = await keyRes.json();
    const row = Array.isArray(rows) ? rows[0] : null;

    if (!row || !row.groq_enabled || !row.groq_key) {
      return res.status(200).json({ key: null, enabled: false });
    }

    return res.status(200).json({ key: row.groq_key, enabled: true });
  } catch (err) {
    console.error('groq-key error:', err);
    return res.status(500).json({ error: 'Interní chyba' });
  }
}
