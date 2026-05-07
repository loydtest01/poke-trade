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

// Admin emaily — JEN tito uživatelé mají přístup k /admin/* routes
const ADMIN_EMAILS = [
  'papez.ondrej@gmail.com',
  'loydtest@gmail.com',
];

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

    // ═══════════════════════════════════════════════════════
    // ADMIN ROUTES — sloučeno z bývalého /api/admin-suspicious.js
    // (uvolnili jsme tím funkční slot na Vercelu — limit 12)
    //
    // Routes:
    //   GET    /admin/suspicious?action=list[&unreviewed=1][&limit=N]
    //   PATCH  /admin/suspicious?action=review&id=<event_id>
    //   GET    /admin/suspicious?action=user_summary&user_id=<uuid>
    //   GET    /admin/suspicious?action=stats
    //   GET    /admin/suspicious?action=fingerprint_clusters
    //   GET    /admin/suspicious?action=recent_signups
    //
    // Bezpečnost:
    //   - Volající musí mít platný token (getUserFromToken)
    //   - Email musí být v ADMIN_EMAILS (jinak vrací 404 — neprozradí endpoint)
    //   - Použije service_role klíč pro přístup k tabulkám s RLS=false
    // ═══════════════════════════════════════════════════════
    if (path.startsWith('/admin/suspicious')) {
      // Auth — token z Authorization header NEBO z ?t= query parametru (kvůli starým klientům)
      const adminToken = token !== SUPABASE_ANON ? token : (req.query?.t || '');
      const user = await getUserFromToken(adminToken);
      if (!user || !user.email || !ADMIN_EMAILS.includes(user.email.toLowerCase())) {
        // Tichý 404 — neprozradí non-adminům že endpoint existuje
        return jsonError(res, 404, 'Endpoint nenalezen');
      }

      const SVC_KEY = process.env.SUPABASE_SERVICE_KEY || SUPABASE_ANON;
      // Helper s service_role klíčem (umí číst tabulky s RLS=false)
      async function dbAdminQuery(qpath, init = {}) {
        const headers = {
          'apikey': SVC_KEY,
          'Authorization': `Bearer ${SVC_KEY}`,
          'Content-Type': 'application/json',
        };
        if (init.method === 'PATCH') headers['Prefer'] = 'return=representation';
        return fetch(`${SUPABASE_URL}/rest/v1/${qpath}`, { ...init, headers });
      }

      const action = req.query?.action || 'list';

      try {
        // ── list: všechny eventy seřazené od nejnovějších ─────────
        if (action === 'list') {
          const limit = Math.min(parseInt(req.query?.limit) || 100, 500);
          const onlyUnreviewed = req.query?.unreviewed === '1';
          let url = `suspicious_events?select=*,profiles(username,email)&order=created_at.desc&limit=${limit}`;
          if (onlyUnreviewed) url += '&reviewed=eq.false';
          const r = await dbAdminQuery(url);
          return jsonOk(res, { events: await r.json() });
        }

        // ── review: označí event jako prozkoumaný ──────────────────
        if (action === 'review') {
          const id = req.query?.id;
          if (!id) return jsonError(res, 400, 'Missing id');
          const r = await dbAdminQuery(`suspicious_events?id=eq.${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ reviewed: true, reviewed_at: new Date().toISOString() }),
          });
          const data = await r.json();
          return jsonOk(res, { event: data[0] || null });
        }

        // ── user_summary: detail uživatele pro investigace ─────────
        if (action === 'user_summary') {
          const userId = req.query?.user_id;
          if (!userId) return jsonError(res, 400, 'Missing user_id');
          const [profileR, refSentR, refReceivedR, suspR] = await Promise.all([
            dbAdminQuery(`profiles?id=eq.${userId}&select=*`),
            dbAdminQuery(`referral_events?referrer_id=eq.${userId}&select=*,profiles!referee_id(username,email)&order=created_at.desc`),
            dbAdminQuery(`referral_events?referee_id=eq.${userId}&select=*,profiles!referrer_id(username,email)`),
            dbAdminQuery(`suspicious_events?user_id=eq.${userId}&select=*&order=created_at.desc&limit=20`),
          ]);
          const profile     = (await profileR.json())[0] || null;
          const refSent     = await refSentR.json();
          const refReceived = await refReceivedR.json();
          const suspicious  = await suspR.json();
          let fpMatches = [];
          if (profile && profile.browser_fp) {
            const r = await dbAdminQuery(`profiles?browser_fp=eq.${encodeURIComponent(profile.browser_fp)}&select=id,username,email,created_at,vip_until,is_banned`);
            fpMatches = (await r.json()).filter(p => p.id !== userId);
          }
          return jsonOk(res, { profile, refSent, refReceived, suspicious, fpMatches });
        }

        // ── stats: dashboard čísla ──────────────────────────────────
        if (action === 'stats') {
          const [allR, unreviewedR, last24R] = await Promise.all([
            dbAdminQuery('suspicious_events?select=event_type,severity'),
            dbAdminQuery('suspicious_events?reviewed=eq.false&select=id'),
            dbAdminQuery(`suspicious_events?created_at=gte.${new Date(Date.now() - 86400000).toISOString()}&select=id`),
          ]);
          const all     = await allR.json();
          const unrev   = await unreviewedR.json();
          const last24  = await last24R.json();
          const allFps  = await dbAdminQuery('profiles?select=browser_fp').then(r => r.json());
          const fpCounts = {};
          allFps.forEach(p => {
            if (p.browser_fp && p.browser_fp.length > 16) fpCounts[p.browser_fp] = (fpCounts[p.browser_fp] || 0) + 1;
          });
          const duplicateFps = Object.values(fpCounts).filter(c => c > 1).length;
          const byType = {}, bySeverity = {};
          all.forEach(e => {
            byType[e.event_type] = (byType[e.event_type] || 0) + 1;
            bySeverity[e.severity] = (bySeverity[e.severity] || 0) + 1;
          });
          return jsonOk(res, {
            total: all.length, unreviewed: unrev.length, last24h: last24.length,
            duplicateFingerprints: duplicateFps, byType, bySeverity,
          });
        }

        // ── fingerprint_clusters: účty se stejným FP ────────────────
        if (action === 'fingerprint_clusters') {
          const r = await dbAdminQuery('profiles?browser_fp=not.is.null&select=id,username,email,browser_fp,created_at,vip_until,is_banned&order=created_at.desc');
          const profiles = await r.json();
          const clusters = {};
          profiles.forEach(p => {
            if (!p.browser_fp || p.browser_fp.length < 16) return;
            if (!clusters[p.browser_fp]) clusters[p.browser_fp] = [];
            clusters[p.browser_fp].push(p);
          });
          const result = Object.entries(clusters)
            .filter(([_, accounts]) => accounts.length > 1)
            .map(([fp, accounts]) => ({ fp, count: accounts.length, accounts }))
            .sort((a, b) => b.count - a.count);
          return jsonOk(res, { clusters: result });
        }

        // ── recent_signups: posledních 50 registrací ────────────────
        if (action === 'recent_signups') {
          const r = await dbAdminQuery('profiles?select=id,username,email,created_at,vip_until,vip_source,referred_by,suspicious_score,is_banned&order=created_at.desc&limit=50');
          return jsonOk(res, { signups: await r.json() });
        }

        // ── vip_list: všichni aktivní VIP s spotřebou ───────────────
        // Optionally filter by query: ?q=<email_or_username_substr>
        if (action === 'vip_list') {
          const q = (req.query?.q || '').trim().toLowerCase();
          let url = 'admin_vip_overview?select=*&order=requests_7d.desc.nullslast,vip_until.desc';
          if (q) {
            // OR filter: username ilike OR email ilike
            const enc = encodeURIComponent(`%${q}%`);
            url = `admin_vip_overview?select=*&or=(username.ilike.${enc},email.ilike.${enc})&order=requests_7d.desc.nullslast,vip_until.desc`;
          }
          const r = await dbAdminQuery(url);
          return jsonOk(res, { vips: await r.json() });
        }

        // ── vip_grant: udělit / prodloužit VIP konkrétnímu uživateli ─
        // Tělo: { user_id?: UUID, email?: string, days: number, reason?: string }
        // days = -1 znamená lifetime
        if (action === 'vip_grant' && method === 'POST') {
          const { user_id, email, days, reason } = body || {};
          if (typeof days !== 'number') return jsonError(res, 400, 'Missing days (number, -1 = lifetime)');
          if (!user_id && !email) return jsonError(res, 400, 'Missing user_id or email');

          // Použijeme RPC s service_role klíčem aby SECURITY DEFINER fungoval
          // (admin RPC ověří caller-a přes auth.uid() — proto musíme volat RPC s tokenem
          // Loyda, ne service_role. Použijeme proto fetch s tokenem volajícího.)
          const callerToken = adminToken;
          const rpcName = email ? 'admin_grant_vip_by_email' : 'admin_grant_vip';
          const rpcBody = email
            ? { p_target_email: email, p_days: days, p_reason: reason || 'manual' }
            : { p_target_user_id: user_id, p_days: days, p_reason: reason || 'manual' };

          const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpcName}`, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_ANON,
              'Authorization': `Bearer ${callerToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(rpcBody),
          });
          const result = await r.json();
          return jsonOk(res, result);
        }

        // ── vip_revoke: odebrat VIP ──────────────────────────────────
        // Tělo: { user_id: UUID }
        if (action === 'vip_revoke' && method === 'POST') {
          const { user_id } = body || {};
          if (!user_id) return jsonError(res, 400, 'Missing user_id');

          const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_revoke_vip`, {
            method: 'POST',
            headers: {
              'apikey': SUPABASE_ANON,
              'Authorization': `Bearer ${adminToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ p_target_user_id: user_id }),
          });
          const result = await r.json();
          return jsonOk(res, result);
        }

        // ── lifetime_status: kolik míst zbývá z prvních 20 ──────────
        if (action === 'lifetime_status') {
          const r = await dbAdminQuery('lifetime_vip_status?select=*');
          const data = await r.json();
          return jsonOk(res, data[0] || { granted: 0, remaining: 20, total: 20, available: true });
        }

        // ── search_user: najdi uživatele podle email/username (pro grant UI) ─
        if (action === 'search_user') {
          const q = (req.query?.q || '').trim();
          if (q.length < 2) return jsonOk(res, { users: [] });
          const enc = encodeURIComponent(`%${q.toLowerCase()}%`);
          const r = await dbAdminQuery(`profiles?select=id,username,email,vip_until,vip_source&or=(username.ilike.${enc},email.ilike.${enc})&limit=20`);
          return jsonOk(res, { users: await r.json() });
        }

        return jsonError(res, 400, 'Unknown action: ' + action);
      } catch (e) {
        console.error('[admin/suspicious]', e);
        return jsonError(res, 500, 'Internal error: ' + e.message);
      }
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

/* Dekóduje JWT payload bez externích knihoven */
function decodeJwtPayload(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch { return null; }
}

async function getUserFromToken(token) {
  try {
    // Pokus 1: standardní ověření přes Supabase Auth API (platný token)
    const userRes = await sbFetch('auth/v1/user', 'GET', null, token);
    if (userRes && userRes.id) {
      const profileRes = await sbFetch(
        `rest/v1/profiles?id=eq.${userRes.id}&select=username`,
        'GET', null, SUPABASE_ANON
      );
      return {
        id:       userRes.id,
        email:    userRes.email,
        username: profileRes[0]?.username || userRes.email,
      };
    }
  } catch { /* pokračuj na fallback */ }

  // Pokus 2: token je expirovaný — dekóduj sub claim a ověř přes service key
  try {
    const SVC_KEY = process.env.SUPABASE_SERVICE_KEY;
    if (!SVC_KEY || SVC_KEY === SUPABASE_ANON) return null;

    const payload = decodeJwtPayload(token);
    const userId = payload?.sub;
    if (!userId || !/^[0-9a-f-]{36}$/.test(userId)) return null;

    // Admin API vyžaduje service_role key — vrací uživatele bez ohledu na expiry
    const adminRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      headers: {
        'apikey': SVC_KEY,
        'Authorization': 'Bearer ' + SVC_KEY,
      }
    });
    if (!adminRes.ok) return null;
    const adminUser = await adminRes.json();
    if (!adminUser.id) return null;

    const profileRes = await sbFetch(
      `rest/v1/profiles?id=eq.${adminUser.id}&select=username`,
      'GET', null, SUPABASE_ANON
    );
    return {
      id:       adminUser.id,
      email:    adminUser.email,
      username: profileRes[0]?.username || adminUser.email,
    };
  } catch { return null; }
}

function jsonOk(res, data) {
  return res.status(200).set(CORS_HEADERS).json(data);
}
function jsonError(res, status, message) {
  return res.status(status).set(CORS_HEADERS).json({ error: true, message });
}
