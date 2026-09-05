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
  'lasovlas@seznam.cz',
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

function setCorsHeaders(res) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
}

// ═══════════════════════════════════════════════════════
// Vercel serverless handler  (api/v1/[...path].js)
// ═══════════════════════════════════════════════════════
export default async function handler(req, res) {
  // Preflight
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    return res.status(200).end();
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

    // ── PING (debug) ─────────────────────────────────────
    if (path.startsWith('/ping')) {
      return jsonOk(res, { ok: true, path, query: req.query });
    }

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
    // ADMIN ROUTES
    // ═══════════════════════════════════════════════════════
    if (path.startsWith('/admin/suspicious')) {
      // Auth — token z Authorization header NEBO z ?t= query parametru
      const adminToken = token !== SUPABASE_ANON ? token : (req.query?.t || '');
      const user = await getUserFromToken(adminToken);
      const isAdminEmail = user?.email && ADMIN_EMAILS.includes(user.email.toLowerCase());
      let isAdminDb = false;
      if (user && !isAdminEmail) {
        try {
          const dbR = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=is_admin`, {
            headers: { 'apikey': process.env.SUPABASE_SERVICE_KEY || SUPABASE_ANON, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY || SUPABASE_ANON}` }
          });
          const dbD = await dbR.json();
          isAdminDb = dbD?.[0]?.is_admin === true;
        } catch(_) {}
      }
      if (!user || (!isAdminEmail && !isAdminDb)) {
        return jsonError(res, 403, 'Přístup odepřen');
      }

      const SVC_KEY = process.env.SUPABASE_SERVICE_KEY || SUPABASE_ANON;
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
        if (action === 'list') {
          const limit = Math.min(parseInt(req.query?.limit) || 100, 500);
          const onlyUnreviewed = req.query?.unreviewed === '1';
          let url = `suspicious_events?select=*,profiles(username,email)&order=created_at.desc&limit=${limit}`;
          if (onlyUnreviewed) url += '&reviewed=eq.false';
          const r = await dbAdminQuery(url);
          return jsonOk(res, { events: await r.json() });
        }

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

        if (action === 'recent_signups') {
          const r = await dbAdminQuery('profiles?select=id,username,email,created_at,vip_until,vip_source,referred_by,suspicious_score,is_banned&order=created_at.desc&limit=50');
          return jsonOk(res, { signups: await r.json() });
        }

        if (action === 'vip_list') {
          const q = (req.query?.q || '').trim().toLowerCase();
          let url = 'admin_vip_overview?select=*&order=requests_7d.desc.nullslast,vip_until.desc';
          if (q) {
            const enc = encodeURIComponent(`%${q}%`);
            url = `admin_vip_overview?select=*&or=(username.ilike.${enc},email.ilike.${enc})&order=requests_7d.desc.nullslast,vip_until.desc`;
          }
          const r = await dbAdminQuery(url);
          return jsonOk(res, { vips: await r.json() });
        }

        if (action === 'vip_grant' && method === 'POST') {
          const { user_id, email, days, reason } = body || {};
          if (typeof days !== 'number') return jsonError(res, 400, 'Missing days (number, -1 = lifetime)');
          if (!user_id && !email) return jsonError(res, 400, 'Missing user_id or email');

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
          // Kdyz RPC selze, PostgREST vrati {code, message, details, hint} -
          // bez success/reason, takze admin panel drive ukazal jen "unknown".
          if (!r.ok || (result && result.code && !('success' in result))) {
            return jsonOk(res, {
              success: false,
              reason:  result?.message || result?.code || `RPC HTTP ${r.status}`,
              pg_code: result?.code || null,
              pg_hint: result?.hint || result?.details || null,
              rpc:     rpcName,
            });
          }
          return jsonOk(res, result);
        }

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
          // Kdyz RPC selze, PostgREST vrati {code, message, details, hint} -
          // bez success/reason, takze admin panel drive ukazal jen "unknown".
          if (!r.ok || (result && result.code && !('success' in result))) {
            return jsonOk(res, {
              success: false,
              reason:  result?.message || result?.code || `RPC HTTP ${r.status}`,
              pg_code: result?.code || null,
              pg_hint: result?.hint || result?.details || null,
              rpc:     'admin_revoke_vip',
            });
          }
          return jsonOk(res, result);
        }

        if (action === 'lifetime_status') {
          const r = await dbAdminQuery('lifetime_vip_status?select=*');
          const data = await r.json();
          return jsonOk(res, data[0] || { granted: 0, remaining: 20, total: 20, available: true });
        }

        if (action === 'search_user') {
          const q = (req.query?.q || '').trim();
          if (q.length < 2) return jsonOk(res, { users: [] });
          const enc = encodeURIComponent(`%${q.toLowerCase()}%`);
          const r = await dbAdminQuery(`profiles?select=id,username,email,vip_until,vip_source&or=(username.ilike.${enc},email.ilike.${enc})&limit=20`);
          return jsonOk(res, { users: await r.json() });
        }

        // ── migrate_photos_list: účty s nezmigrovanými fotkami ──
        if (action === 'migrate_photos_list') {
          const r = await dbAdminQuery(`user_card_photos?select=user_id,storage_path&limit=10000`);
          const rows = await r.json();
          const perUser = {};
          (rows || []).forEach(row => {
            const sp = row.storage_path || '';
            if (sp && !sp.startsWith('http') && !sp.startsWith('DEAD:')) perUser[row.user_id] = (perUser[row.user_id] || 0) + 1;
          });
          const ids = Object.keys(perUser);
          let names = {};
          if (ids.length) {
            const pr = await dbAdminQuery(`profiles?id=in.(${ids.join(',')})&select=id,username,email`);
            (await pr.json() || []).forEach(p => { names[p.id] = p.username || p.email || p.id; });
          }
          const accounts = ids.map(id => ({ user_id: id, name: names[id] || id, pending: perUser[id] }))
                              .sort((a,b) => b.pending - a.pending);
          return jsonOk(res, { accounts, total_pending: accounts.reduce((s,a)=>s+a.pending,0) });
        }

        // ── migrate_account_photos: přemigruj jeden účet (dávka) ──
        if (action === 'migrate_account_photos' && req.method === 'POST') {
          const targetUser = req.body?.user_id;
          const batch = Math.min(parseInt(req.body?.batch) || 50, 200);
          if (!targetUser) return jsonError(res, 400, 'Missing user_id');
          const R2_WORKER = 'https://pokedb-api.poketrade.workers.dev';
          // Bereme JEN nezmigrované: storage_path není null a NEzačíná na http
          // (zmigrované mají v storage_path plnou R2 URL; mrtvé jsou označené 'DEAD:' a taky http-/non-null nejsou → vypadnou níže).
          // PostgREST: like používá '*' jako wildcard (server si ho přeloží na %).
          // not.like.http* → vyřadí už zmigrované (R2 URL začínají http); not.like.DEAD:* → vyřadí mrtvé.
          const r = await dbAdminQuery(`user_card_photos?user_id=eq.${targetUser}&select=id,storage_path,url&storage_path=not.is.null&storage_path=not.like.http*&storage_path=not.like.DEAD:*&limit=${batch}`);
          const rows = await r.json();
          const todo = Array.isArray(rows) ? rows : [];
          let done = 0, failed = 0, dead = 0, lastErr = null;
          for (const row of todo) {
            try {
              const srcUrl = `${SUPABASE_URL}/storage/v1/object/public/card-photo/${row.storage_path}`;
              const img = await fetch(srcUrl);
              if (!img.ok) {
                // Soubor už v Supabase není → mrtvý záznam. Označíme, ať příště neblokuje dávku.
                failed++; dead++;
                if (!lastErr) lastErr = `stažení ${img.status} (mrtvý záznam, soubor už v Supabase není)`;
                await dbAdminQuery(`user_card_photos?id=eq.${row.id}`, {
                  method: 'PATCH', body: JSON.stringify({ storage_path: 'DEAD:' + row.storage_path }),
                }).catch(()=>{});
                continue;
              }
              const arrBuf = await img.arrayBuffer();
              const ct = img.headers.get('content-type') || 'image/jpeg';
              const fname = row.storage_path.split('/').pop();
              const up = await fetch(`${R2_WORKER}/admin/upload-user-photo?user_id=${targetUser}&filename=${encodeURIComponent(fname)}`, {
                method: 'POST',
                headers: { 'X-Admin-Secret': process.env.POKEDB_ADMIN_SECRET || process.env.ADMIN_SECRET || '', 'Content-Type': ct },
                body: Buffer.from(arrBuf),
              });
              const upData = await up.json().catch(() => ({}));
              if (!up.ok || !upData.url) {
                failed++;
                if (!lastErr) lastErr = `R2 upload HTTP ${up.status}: ${upData.error || JSON.stringify(upData).slice(0,80)}`;
                continue;
              }
              await dbAdminQuery(`user_card_photos?id=eq.${row.id}`, {
                method: 'PATCH', body: JSON.stringify({ storage_path: upData.url, url: upData.url }),
              });
              await dbAdminQuery(`photo_queue?storage_path=eq.${encodeURIComponent(row.storage_path)}`, {
                method: 'PATCH', body: JSON.stringify({ storage_path: upData.url }),
              }).catch(()=>{});
              done++;
            } catch (e) {
              failed++;
              if (!lastErr) lastErr = 'výjimka: ' + (e?.message || String(e)).slice(0, 80);
            }
          }
          // done_all = dotaz vrátil míň nezmigrovaných než batch → už nic nezbývá.
          // Mrtvé záznamy jsme označili 'DEAD:', takže příští dotaz je nevrátí → smyčka nikdy nezablokuje.
          return jsonOk(res, { user_id: targetUser, done, failed, dead, batch_size: todo.length, done_all: todo.length < batch, last_error: lastErr });
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

/* ─── JWT helpers ──────────────────────────────────────────────────────── */

function decodeJwtParts(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const fix = s => s.replace(/-/g, '+').replace(/_/g, '/');
    const header  = JSON.parse(Buffer.from(fix(parts[0]), 'base64').toString());
    const payload = JSON.parse(Buffer.from(fix(parts[1]), 'base64').toString());
    return { header, payload, parts };
  } catch { return null; }
}

// JWKS cache (1 hod)
let _jwks = null, _jwksAt = 0;
async function fetchJWKS() {
  if (_jwks && Date.now() - _jwksAt < 3_600_000) return _jwks;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
    if (!r.ok) return null;
    _jwks = await r.json();
    _jwksAt = Date.now();
    return _jwks;
  } catch { return null; }
}

async function verifyJWTLocally(token) {
  const decoded = decodeJwtParts(token);
  if (!decoded) return null;
  const { header, payload, parts } = decoded;

  if (!payload.sub || payload.role === 'anon') return null;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now - 86400) return null;

  const alg = header.alg;
  const sigInput = parts[0] + '.' + parts[1];
  const fix = s => s.replace(/-/g, '+').replace(/_/g, '/');

  if (alg === 'HS256') {
    const secret = process.env.SUPABASE_JWT_SECRET;
    if (!secret) return payload;
    try {
      const { createHmac } = await import('node:crypto');
      const expected = createHmac('sha256', secret)
        .update(sigInput).digest('base64url');
      if (expected !== parts[2]) return null;
      return payload;
    } catch { return payload; }
  }

  if (alg === 'ES256') {
    const jwks = await fetchJWKS();
    if (!jwks?.keys?.length) return payload;

    const jwk = jwks.keys.find(k => k.kid === header.kid) ?? jwks.keys[0];
    if (!jwk) return payload;

    try {
      const { webcrypto } = await import('node:crypto');
      const key = await webcrypto.subtle.importKey(
        'jwk', jwk,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false, ['verify']
      );
      const sigBuf  = Buffer.from(fix(parts[2]), 'base64');
      const dataBuf = Buffer.from(sigInput);
      const valid   = await webcrypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        key, sigBuf, dataBuf
      );
      if (!valid) return null;
      return payload;
    } catch { return payload; }
  }

  return payload;
}

async function getUserFromToken(token) {
  if (!token || token === SUPABASE_ANON) return null;

  const decoded = decodeJwtParts(token);
  const rawPayload = decoded?.payload;

  if (rawPayload?.sub && rawPayload?.role === 'authenticated') {
    const email = rawPayload.email
               || rawPayload.user_metadata?.email
               || rawPayload.app_metadata?.email;
    if (email) {
      try {
        const profileRes = await sbFetch(
          `rest/v1/profiles?id=eq.${rawPayload.sub}&select=username`,
          'GET', null, SUPABASE_ANON
        );
        const username = profileRes?.[0]?.username || email;
        return { id: rawPayload.sub, email, username };
      } catch {
        return { id: rawPayload.sub, email, username: email };
      }
    }
  }

  try {
    const userRes = await sbFetch('auth/v1/user', 'GET', null, token);
    if (userRes?.id) {
      const profileRes = await sbFetch(
        `rest/v1/profiles?id=eq.${userRes.id}&select=username`,
        'GET', null, SUPABASE_ANON
      );
      return { id: userRes.id, email: userRes.email,
               username: profileRes?.[0]?.username || userRes.email };
    }
  } catch { /* pokračuj */ }

  try {
    const SVC_KEY = process.env.SUPABASE_SERVICE_KEY;
    if (!SVC_KEY || SVC_KEY === SUPABASE_ANON) return null;
    const userId = rawPayload?.sub;
    if (!userId || !/^[0-9a-f-]{36}$/.test(userId)) return null;

    const adminRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      headers: { 'apikey': SVC_KEY, 'Authorization': 'Bearer ' + SVC_KEY }
    });
    if (!adminRes.ok) return null;
    const u = await adminRes.json();
    if (!u?.id) return null;

    return { id: u.id, email: u.email, username: u.email };
  } catch { return null; }
}

function jsonOk(res, data) {
  setCorsHeaders(res);
  return res.status(200).json(data);
}

function jsonError(res, status, message) {
  setCorsHeaders(res);
  return res.status(status).json({ error: true, message });
}
