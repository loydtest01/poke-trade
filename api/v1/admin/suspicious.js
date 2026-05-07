/**
 * api/v1/admin/suspicious.js
 * Dedicated handler for admin suspicious events routes.
 */

const SUPABASE_URL  = 'https://xrduqwrinzvmpixgmqta.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyZHVxd3Jpbnp2bXBpeGdtcXRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDI0MjksImV4cCI6MjA5MDk3ODQyOX0.2p404Vy77CH_MsvQlnpxaO0H-KlSSt_oJlaFrmttFXs';

const ADMIN_EMAILS = [
  'papez.ondrej@gmail.com',
  'loydtest@gmail.com',
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  'Content-Type': 'application/json',
};

function setCorsHeaders(res) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
}

function jsonOk(res, data) {
  setCorsHeaders(res);
  return res.status(200).json(data);
}

function jsonError(res, status, message) {
  setCorsHeaders(res);
  return res.status(status).json({ error: true, message });
}

function decodeJwtParts(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const fix = s => s.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(fix(parts[1]), 'base64').toString());
    return payload;
  } catch { return null; }
}

async function getUserFromToken(token) {
  if (!token || token === SUPABASE_ANON) return null;
  try {
    const payload = decodeJwtParts(token);
    if (payload?.sub && payload?.role === 'authenticated') {
      const email = payload.email
                 || payload.user_metadata?.email
                 || payload.app_metadata?.email;
      if (email) return { id: payload.sub, email, username: email };
    }
  } catch { /* pokračuj */ }
  return null;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    return res.status(200).end();
  }

  // Auth — token z Authorization header NEBO z ?t= query parametru
  const authHeader = req.headers.authorization || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const adminToken = bearerToken || req.query?.t || '';

  const user = await getUserFromToken(adminToken);
  if (!user || !ADMIN_EMAILS.includes((user.email || '').toLowerCase())) {
    return jsonError(res, 403, 'Přístup odepřen');
  }

  const SVC_KEY = process.env.SUPABASE_SERVICE_KEY || SUPABASE_ANON;
  const method  = req.method;
  const body    = req.body;
  const action  = req.query?.action || 'list';

  async function dbQuery(qpath, init = {}) {
    const headers = {
      'apikey': SVC_KEY,
      'Authorization': `Bearer ${SVC_KEY}`,
      'Content-Type': 'application/json',
    };
    if (init.method === 'PATCH') headers['Prefer'] = 'return=representation';
    return fetch(`${SUPABASE_URL}/rest/v1/${qpath}`, { ...init, headers });
  }

  try {
    // ── list ─────────────────────────────────────────────
    if (action === 'list') {
      const limit = Math.min(parseInt(req.query?.limit) || 100, 500);
      const onlyUnreviewed = req.query?.unreviewed === '1';
      let url = `suspicious_events?select=*,profiles(username,email)&order=created_at.desc&limit=${limit}`;
      if (onlyUnreviewed) url += '&reviewed=eq.false';
      const r = await dbQuery(url);
      return jsonOk(res, { events: await r.json() });
    }

    // ── review ───────────────────────────────────────────
    if (action === 'review') {
      const id = req.query?.id;
      if (!id) return jsonError(res, 400, 'Missing id');
      const r = await dbQuery(`suspicious_events?id=eq.${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ reviewed: true, reviewed_at: new Date().toISOString() }),
      });
      return jsonOk(res, { event: (await r.json())[0] || null });
    }

    // ── user_summary ──────────────────────────────────────
    if (action === 'user_summary') {
      const userId = req.query?.user_id;
      if (!userId) return jsonError(res, 400, 'Missing user_id');
      const [profileR, refSentR, refReceivedR, suspR] = await Promise.all([
        dbQuery(`profiles?id=eq.${userId}&select=*`),
        dbQuery(`referral_events?referrer_id=eq.${userId}&select=*,profiles!referee_id(username,email)&order=created_at.desc`),
        dbQuery(`referral_events?referee_id=eq.${userId}&select=*,profiles!referrer_id(username,email)`),
        dbQuery(`suspicious_events?user_id=eq.${userId}&select=*&order=created_at.desc&limit=20`),
      ]);
      const profile     = (await profileR.json())[0] || null;
      const refSent     = await refSentR.json();
      const refReceived = await refReceivedR.json();
      const suspicious  = await suspR.json();
      let fpMatches = [];
      if (profile?.browser_fp) {
        const r = await dbQuery(`profiles?browser_fp=eq.${encodeURIComponent(profile.browser_fp)}&select=id,username,email,created_at,vip_until,is_banned`);
        fpMatches = (await r.json()).filter(p => p.id !== userId);
      }
      return jsonOk(res, { profile, refSent, refReceived, suspicious, fpMatches });
    }

    // ── stats ─────────────────────────────────────────────
    if (action === 'stats') {
      const [allR, unreviewedR, last24R] = await Promise.all([
        dbQuery('suspicious_events?select=event_type,severity'),
        dbQuery('suspicious_events?reviewed=eq.false&select=id'),
        dbQuery(`suspicious_events?created_at=gte.${new Date(Date.now() - 86400000).toISOString()}&select=id`),
      ]);
      const all    = await allR.json();
      const unrev  = await unreviewedR.json();
      const last24 = await last24R.json();
      const allFps = await dbQuery('profiles?select=browser_fp').then(r => r.json());
      const fpCounts = {};
      allFps.forEach(p => {
        if (p.browser_fp && p.browser_fp.length > 16)
          fpCounts[p.browser_fp] = (fpCounts[p.browser_fp] || 0) + 1;
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

    // ── fingerprint_clusters ──────────────────────────────
    if (action === 'fingerprint_clusters') {
      const r = await dbQuery('profiles?browser_fp=not.is.null&select=id,username,email,browser_fp,created_at,vip_until,is_banned&order=created_at.desc');
      const profiles = await r.json();
      const clusters = {};
      profiles.forEach(p => {
        if (!p.browser_fp || p.browser_fp.length < 16) return;
        if (!clusters[p.browser_fp]) clusters[p.browser_fp] = [];
        clusters[p.browser_fp].push(p);
      });
      const result = Object.entries(clusters)
        .filter(([_, a]) => a.length > 1)
        .map(([fp, accounts]) => ({ fp, count: accounts.length, accounts }))
        .sort((a, b) => b.count - a.count);
      return jsonOk(res, { clusters: result });
    }

    // ── recent_signups ────────────────────────────────────
    if (action === 'recent_signups') {
      const r = await dbQuery('profiles?select=id,username,email,created_at,vip_until,vip_source,referred_by,suspicious_score,is_banned&order=created_at.desc&limit=50');
      return jsonOk(res, { signups: await r.json() });
    }

    // ── vip_list ──────────────────────────────────────────
    if (action === 'vip_list') {
      const q = (req.query?.q || '').trim().toLowerCase();
      let url = 'admin_vip_overview?select=*&order=requests_7d.desc.nullslast,vip_until.desc';
      if (q) {
        const enc = encodeURIComponent(`%${q}%`);
        url = `admin_vip_overview?select=*&or=(username.ilike.${enc},email.ilike.${enc})&order=requests_7d.desc.nullslast,vip_until.desc`;
      }
      return jsonOk(res, { vips: await (await dbQuery(url)).json() });
    }

    // ── vip_grant ─────────────────────────────────────────
    if (action === 'vip_grant' && method === 'POST') {
      const { user_id, email, days, reason } = body || {};
      if (typeof days !== 'number') return jsonError(res, 400, 'Missing days');
      if (!user_id && !email) return jsonError(res, 400, 'Missing user_id or email');
      const rpcName = email ? 'admin_grant_vip_by_email' : 'admin_grant_vip';
      const rpcBody = email
        ? { p_target_email: email, p_days: days, p_reason: reason || 'manual' }
        : { p_target_user_id: user_id, p_days: days, p_reason: reason || 'manual' };
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpcName}`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(rpcBody),
      });
      return jsonOk(res, await r.json());
    }

    // ── vip_revoke ────────────────────────────────────────
    if (action === 'vip_revoke' && method === 'POST') {
      const { user_id } = body || {};
      if (!user_id) return jsonError(res, 400, 'Missing user_id');
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_revoke_vip`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_target_user_id: user_id }),
      });
      return jsonOk(res, await r.json());
    }

    // ── lifetime_status ───────────────────────────────────
    if (action === 'lifetime_status') {
      const r = await dbQuery('lifetime_vip_status?select=*');
      const data = await r.json();
      return jsonOk(res, data[0] || { granted: 0, remaining: 20, total: 20, available: true });
    }

    // ── search_user ───────────────────────────────────────
    if (action === 'search_user') {
      const q = (req.query?.q || '').trim();
      if (q.length < 2) return jsonOk(res, { users: [] });
      const enc = encodeURIComponent(`%${q.toLowerCase()}%`);
      const r = await dbQuery(`profiles?select=id,username,email,vip_until,vip_source&or=(username.ilike.${enc},email.ilike.${enc})&limit=20`);
      return jsonOk(res, { users: await r.json() });
    }

    return jsonError(res, 400, 'Unknown action: ' + action);

  } catch (e) {
    console.error('[admin/suspicious]', e);
    return jsonError(res, 500, 'Internal error: ' + e.message);
  }
}
