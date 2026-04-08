/**
 * api.js – PokéTrade REST API handler
 *
 * Tento soubor obsluhuje volání z Electron aplikace (online-market.js).
 * Nasazuje se na Vercel jako serverless funkce NEBO běží jako statický
 * proxy přes Supabase Edge Functions.
 *
 * Endpointy které aplikace volá:
 *   POST /v1/auth/login          ← doOnlineLogin()
 *   POST /v1/auth/register       ← (registrace přes web)
 *   POST /v1/listings            ← submitPublish()
 *   GET  /v1/listings/mine       ← openMyListingsModal()
 *   DELETE /v1/listings/:id      ← removeListing()
 *
 * Protože Vercel + Supabase nemají /v1 prefix, použijeme
 * jednoduchý router který mapuje volání na Supabase REST API.
 */

// ═══════════════════════════════════════════════════════
// CONFIG – vyplň po registraci na Supabase
// ═══════════════════════════════════════════════════════
const SUPABASE_URL  = 'https://xrduqwrinzvmpixgmqta.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyZHVxd3Jpbnp2bXBpeGdtcXRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDI0MjksImV4cCI6MjA5MDk3ODQyOX0.2p404Vy77CH_MsvQlnpxaO0H-KlSSt_oJlaFrmttFXs';

// ═══════════════════════════════════════════════════════
// CORS helper – přijímáme volání z Electron app
// ═══════════════════════════════════════════════════════
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  'Content-Type': 'application/json',
};

// ═══════════════════════════════════════════════════════
// Vercel serverless handler  (api/v1/[...path].js)
// ═══════════════════════════════════════════════════════
export default async function handler(req, res) {
  // Preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).set(CORS_HEADERS).end();
  }

  const path   = req.url.replace('/api/v1', '').replace('/v1', '');
  const method = req.method;
  const body   = req.body;
  const authHeader = req.headers.authorization || '';
  const token  = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : SUPABASE_ANON;

  // Získej reálnou IP ze serverových hlaviček (spolehlivější než client-side)
  const clientIP = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown')
    .split(',')[0].trim();
  const userAgent = (req.headers['user-agent'] || '').slice(0, 250);

  // ── Pomocná funkce: zaloguj přihlášení ──────────────────
  async function logIP(userId, action = 'login', success = true) {
    if (!userId || clientIP === 'unknown') return;
    try {
      await sbFetch('rest/v1/user_ip_logs', 'POST', {
        user_id: userId, ip_address: clientIP,
        user_agent: userAgent, action, success
      }, SUPABASE_ANON);
    } catch { /* logování nesmí blokovat přihlášení */ }
  }

  // ── Zkontroluj zda je IP blokovaná ──────────────────────
  async function isIPBlocked() {
    if (clientIP === 'unknown') return false;
    try {
      const r = await sbFetch(`rest/v1/blocked_ips?ip_address=eq.${encodeURIComponent(clientIP)}&select=id`, 'GET', null, SUPABASE_ANON);
      return Array.isArray(r) && r.length > 0;
    } catch { return false; }
  }

  try {

    // ── POST /auth/login ─────────────────────────────
    if (path === '/auth/login' && method === 'POST') {
      // Zkontroluj blokaci IP
      if (await isIPBlocked()) {
        return jsonError(res, 403, 'Přístup z této IP adresy byl zablokován');
      }

      const { username, password } = body;

      // Najdi uživatele podle username
      const profileRes = await sbFetch(
        `rest/v1/profiles?username=eq.${encodeURIComponent(username)}&select=email`,
        'GET', null, SUPABASE_ANON
      );
      if (!profileRes.length) {
        return jsonError(res, 401, 'Neznámé uživatelské jméno');
      }

      // Přihlas se přes Supabase Auth
      const authRes = await sbFetch('auth/v1/token?grant_type=password', 'POST', {
        email: profileRes[0].email,
        password
      }, SUPABASE_ANON);

      if (authRes.error) {
        await logIP(null, 'failed', false);
        return jsonError(res, 401, 'Špatné heslo');
      }

      // Zaloguj úspěšné přihlášení ze serveru (IP je ze skutečných hlaviček)
      await logIP(authRes.user.id, 'login', true);

      return jsonOk(res, {
        token:    authRes.access_token,
        userId:   authRes.user.id,
        username: username,
        email:    authRes.user.email,
      });
    }

    // ── POST /auth/register ──────────────────────────
    if (path === '/auth/register' && method === 'POST') {
      // Zkontroluj blokaci IP i při registraci
      if (await isIPBlocked()) {
        return jsonError(res, 403, 'Registrace z této IP adresy je zablokována');
      }

      const { username, email, password } = body;

      const signupRes = await sbFetch('auth/v1/signup', 'POST', {
        email, password,
        data: { username }
      }, SUPABASE_ANON);

      if (signupRes.error) {
        return jsonError(res, 400, signupRes.error.message);
      }

      // Zaloguj registraci
      if (signupRes.user?.id) {
        await logIP(signupRes.user.id, 'register', true);
      }

      return jsonOk(res, { message: 'Účet vytvořen, zkontroluj e-mail.' });
    }

    // ── POST /listings ───────────────────────────────
    if (path === '/listings' && method === 'POST') {
      const { cards, mode } = body;

      // Ověř token → získej userId
      const user = await getUserFromToken(token);
      if (!user) return jsonError(res, 401, 'Nepřihlášen');

      const listing = {
        user_id:    user.id,
        username:   user.username,
        cards_data: cards,
        mode:       mode,  // 'trade' | 'sell'
        status:     'active',
        created_at: new Date().toISOString(),
        offer_count: 0,
      };

      const insertRes = await sbFetch('rest/v1/listings', 'POST', listing, token);
      if (insertRes.error) return jsonError(res, 500, insertRes.error.message);

      return jsonOk(res, { id: insertRes[0]?.id, message: 'Nabídka zveřejněna' });
    }

    // ── GET /listings/mine ───────────────────────────
    if (path === '/listings/mine' && method === 'GET') {
      const user = await getUserFromToken(token);
      if (!user) return jsonError(res, 401, 'Nepřihlášen');

      const listingsRes = await sbFetch(
        `rest/v1/listings?user_id=eq.${user.id}&status=eq.active&order=created_at.desc`,
        'GET', null, token
      );

      return jsonOk(res, { listings: listingsRes || [] });
    }

    // ── DELETE /listings/:id ─────────────────────────
    if (path.startsWith('/listings/') && method === 'DELETE') {
      const id   = path.split('/').pop();
      const user = await getUserFromToken(token);
      if (!user) return jsonError(res, 401, 'Nepřihlášen');

      await sbFetch(`rest/v1/listings?id=eq.${id}&user_id=eq.${user.id}`, 'DELETE', null, token);
      return jsonOk(res, { message: 'Nabídka stažena' });
    }

    return jsonError(res, 404, 'Endpoint nenalezen: ' + path);

  } catch (err) {
    console.error('API error:', err);
    return jsonError(res, 500, 'Interní chyba serveru');
  }
}

// ═══ HELPERS ═══════════════════════════════════════════

async function sbFetch(path, method, body, token) {
  const headers = {
    'Content-Type':  'application/json',
    'apikey':        SUPABASE_ANON,
    'Authorization': 'Bearer ' + (token || SUPABASE_ANON),
  };
  if (method === 'POST' || method === 'PATCH') {
    headers['Prefer'] = 'return=representation';
  }
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const r    = await fetch(`${SUPABASE_URL}/${path}`, opts);
  const text = await r.text();
  return text ? JSON.parse(text) : {};
}

async function getUserFromToken(token) {
  try {
    const userRes = await sbFetch('auth/v1/user', 'GET', null, token);
    if (!userRes.id) return null;

    const profileRes = await sbFetch(
      `rest/v1/profiles?id=eq.${userRes.id}&select=username`,
      'GET', null, SUPABASE_ANON
    );

    return {
      id:       userRes.id,
      email:    userRes.email,
      username: profileRes[0]?.username || userRes.email,
    };
  } catch { return null; }
}

function jsonOk(res, data) {
  return res.status(200).set(CORS_HEADERS).json(data);
}
function jsonError(res, status, message) {
  return res.status(status).set(CORS_HEADERS).json({ error: true, message });
}
