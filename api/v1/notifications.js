/**
 * api/v1/notifications.js — PokéTrade: Notifikační centrum
 *
 * Vercel serverless funkce. Nasadit jako: api/v1/notifications.js
 *
 * Endpointy:
 *   GET    /api/v1/notifications          ← seznam notifikací (s paginací)
 *   GET    /api/v1/notifications/count    ← počet nepřečtených (pro badge)
 *   PATCH  /api/v1/notifications/:id      ← označ jednu jako přečtenou
 *   PATCH  /api/v1/notifications/read-all ← označ všechny jako přečtené
 *   DELETE /api/v1/notifications/:id      ← smaž jednu notifikaci
 *
 * Klient (UI) volá tyto endpointy místo přímého Supabase REST,
 * takže logika "co se stane po přečtení" je na jednom místě.
 *
 * Supabase Realtime (pro live badge) se napojuje přímo z klienta —
 * viz share-album.html nebo budoucí notifications-bell.js widget.
 */

// ═══════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════
const SUPABASE_URL  = 'https://xrduqwrinzvmpixgmqta.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyZHVxd3Jpbnp2bXBpeGdtcXRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDI0MjksImV4cCI6MjA5MDk3ODQyOX0.2p404Vy77CH_MsvQlnpxaO0H-KlSSt_oJlaFrmttFXs';

// Kolik notifikací vrátit v jednom požadavku
const PAGE_SIZE = 20;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
  'Content-Type': 'application/json',
};

// ═══════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).set(CORS_HEADERS).end();
  }

  const rawPath = req.url.replace(/^.*\/api\/v1\/notifications/, '') || '/';
  const method  = req.method;
  const body    = req.body || {};
  const token   = (req.headers.authorization || '').replace('Bearer ', '').trim();

  if (!token) return jsonError(res, 401, 'Chybí Authorization token');

  const user = await getUserFromToken(token);
  if (!user) return jsonError(res, 401, 'Neplatný token');

  try {

    // ── GET /notifications ──────────────────────────────────
    // Vrátí seznam notifikací pro přihlášeného uživatele
    // Query params: ?unread_only=true&offset=0
    if ((rawPath === '' || rawPath === '/') && method === 'GET') {
      const url        = new URL(req.url, 'http://localhost');
      const unreadOnly = url.searchParams.get('unread_only') === 'true';
      const offset     = parseInt(url.searchParams.get('offset') || '0', 10);

      let query = `rest/v1/notifications?user_id=eq.${user.id}` +
        `&order=created_at.desc&limit=${PAGE_SIZE}&offset=${offset}` +
        `&select=id,type,title,body,link,metadata,read,created_at`;

      if (unreadOnly) query += '&read=eq.false';

      const data = await sbFetch(query, 'GET', null, token);

      // Celkový počet nepřečtených pro badge
      const countRes = await sbFetch(
        `rest/v1/notifications?user_id=eq.${user.id}&read=eq.false&select=id`,
        'GET', null, token
      );
      const unreadCount = Array.isArray(countRes) ? countRes.length : 0;

      return jsonOk(res, {
        notifications: data || [],
        unread_count:  unreadCount,
        has_more:      (data || []).length === PAGE_SIZE,
        offset,
      });
    }

    // ── GET /notifications/count ────────────────────────────
    // Rychlý endpoint jen pro badge — vrátí jen číslo
    if (rawPath === '/count' && method === 'GET') {
      const countRes = await sbFetch(
        `rest/v1/notifications?user_id=eq.${user.id}&read=eq.false&select=id`,
        'GET', null, token
      );
      return jsonOk(res, {
        unread_count: Array.isArray(countRes) ? countRes.length : 0,
      });
    }

    // ── PATCH /notifications/read-all ───────────────────────
    // Označ všechny notifikace uživatele jako přečtené
    if (rawPath === '/read-all' && method === 'PATCH') {
      await sbFetch(
        `rest/v1/notifications?user_id=eq.${user.id}&read=eq.false`,
        'PATCH', { read: true }, token
      );
      return jsonOk(res, { message: 'Všechny notifikace označeny jako přečtené' });
    }

    // ── PATCH /notifications/:id ────────────────────────────
    // Označ jednu notifikaci jako přečtenou (kliknutí na notifikaci)
    // Vrátí link pro přesměrování
    const patchMatch = rawPath.match(/^\/([0-9a-f-]{36})$/i);
    if (patchMatch && method === 'PATCH') {
      const notifId = patchMatch[1];

      // Načti notifikaci — ověř vlastnictví
      const notif = await sbFetch(
        `rest/v1/notifications?id=eq.${notifId}&user_id=eq.${user.id}&select=id,link,read,type`,
        'GET', null, token
      );
      if (!notif || notif.length === 0) {
        return jsonError(res, 404, 'Notifikace nenalezena');
      }

      // Označ jako přečtenou (i pokud již byla přečtená — idempotentní)
      await sbFetch(
        `rest/v1/notifications?id=eq.${notifId}&user_id=eq.${user.id}`,
        'PATCH', { read: true }, token
      );

      return jsonOk(res, {
        id:   notifId,
        read: true,
        link: notif[0].link || null,
        type: notif[0].type,
      });
    }

    // ── DELETE /notifications/:id ───────────────────────────
    // Smaž jednu notifikaci (uživatel zavřel)
    const deleteMatch = rawPath.match(/^\/([0-9a-f-]{36})$/i);
    if (deleteMatch && method === 'DELETE') {
      const notifId = deleteMatch[1];

      await sbFetch(
        `rest/v1/notifications?id=eq.${notifId}&user_id=eq.${user.id}`,
        'DELETE', null, token
      );

      return jsonOk(res, { deleted: true, id: notifId });
    }

    return jsonError(res, 404, 'Endpoint nenalezen: ' + rawPath);

  } catch (err) {
    console.error('[notifications.js] Error:', err);
    return jsonError(res, 500, 'Interní chyba serveru');
  }
}

// ═══ HELPERS ════════════════════════════════════════════

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
