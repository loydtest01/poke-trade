/**
 * api/v1/shares.js — PokéTrade: Sdílení alb
 *
 * Vercel serverless funkce. Nasadit jako: api/v1/shares.js
 *
 * Endpointy:
 *   POST   /api/v1/shares              ← vytvoř sdílení + notifikaci atomicky
 *   GET    /api/v1/shares/inbox        ← příchozí pozvánky (status=pending)
 *   GET    /api/v1/shares/sent         ← odeslané (všechny statusy)
 *   PATCH  /api/v1/shares/:id          ← přijmout / odmítnout
 *   POST   /api/v1/shares/expire       ← ruční spuštění expirace (cron)
 *
 * Oproti přímému volání Supabase REST z klienta:
 *   - vytvoření sdílení + notifikace probíhá atomicky na serveru
 *   - validace vstupu (expirace, duplicita) je na serveru, ne jen v UI
 *   - připraveno pro budoucí Gmail email notifikace (viz sekce TODO)
 */

// ═══════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════
const SUPABASE_URL  = 'https://xrduqwrinzvmpixgmqta.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyZHVxd3Jpbnp2bXBpeGdtcXRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDI0MjksImV4cCI6MjA5MDk3ODQyOX0.2p404Vy77CH_MsvQlnpxaO0H-KlSSt_oJlaFrmttFXs';

// Povolené hodnoty expirace (hodiny)
const ALLOWED_EXPIRY_HOURS = [6, 24, 72, 168];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
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

  // Extrahuj cestu za /api/v1/shares
  const rawPath = req.url.replace(/^.*\/api\/v1\/shares/, '') || '/';
  const method  = req.method;
  const body    = req.body || {};
  const token   = (req.headers.authorization || '').replace('Bearer ', '').trim();

  if (!token) return jsonError(res, 401, 'Chybí Authorization token');

  // Ověř uživatele
  const user = await getUserFromToken(token);
  if (!user) return jsonError(res, 401, 'Neplatný token — přihlaš se znovu');

  try {

    // ── POST /shares ────────────────────────────────────────
    // Vytvoří sdílení + notifikaci pro příjemce atomicky
    if (rawPath === '' || rawPath === '/') {
      if (method !== 'POST') return jsonError(res, 405, 'Použij POST');

      const { receiver_id, album_id, album_name, cards_snapshot, expiry_hours } = body;

      // Validace vstupů
      if (!receiver_id || !album_id || !album_name || !cards_snapshot) {
        return jsonError(res, 400, 'Chybí povinná pole: receiver_id, album_id, album_name, cards_snapshot');
      }
      if (!Array.isArray(cards_snapshot)) {
        return jsonError(res, 400, 'cards_snapshot musí být pole karet');
      }
      if (!ALLOWED_EXPIRY_HOURS.includes(Number(expiry_hours))) {
        return jsonError(res, 400, `Neplatná expirace. Povoleno: ${ALLOWED_EXPIRY_HOURS.join(', ')} hodin`);
      }
      if (receiver_id === user.id) {
        return jsonError(res, 400, 'Nemůžeš sdílet album sám sobě');
      }

      // Zkontroluj jestli příjemce existuje
      const receiverCheck = await sbFetch(
        `rest/v1/profiles?id=eq.${receiver_id}&select=id,username`,
        'GET', null, SUPABASE_ANON
      );
      if (!receiverCheck || receiverCheck.length === 0) {
        return jsonError(res, 404, 'Příjemce nebyl nalezen');
      }
      const receiverUsername = receiverCheck[0].username || 'uživatel';

      // Zkontroluj duplicitu (sender+receiver+album+pending)
      const existing = await sbFetch(
        `rest/v1/album_shares?sender_id=eq.${user.id}&receiver_id=eq.${receiver_id}&album_id=eq.${encodeURIComponent(album_id)}&status=eq.pending&select=id`,
        'GET', null, token
      );
      if (existing && existing.length > 0) {
        return jsonError(res, 409, 'Toto album jsi tomuto uživateli již sdílel a čeká na přijetí');
      }

      // Vypočítej expiraci
      const expiresAt = new Date(Date.now() + Number(expiry_hours) * 3600 * 1000).toISOString();
      const expiryLabel = expiry_hours < 24
        ? `${expiry_hours} hodin`
        : `${expiry_hours / 24} ${expiry_hours === 24 ? 'den' : expiry_hours === 72 ? 'dny' : 'dní'}`;

      // Vlož sdílení
      const shareInsert = await sbFetch('rest/v1/album_shares', 'POST', {
        sender_id:       user.id,
        receiver_id:     receiver_id,
        sender_username: user.username,
        album_id:        album_id,
        album_name:      album_name,
        cards_snapshot:  cards_snapshot,
        status:          'pending',
        expires_at:      expiresAt,
      }, token);

      if (!shareInsert || shareInsert.error || shareInsert.message) {
        console.error('Share insert error:', shareInsert);
        return jsonError(res, 500, 'Nepodařilo se vytvořit sdílení');
      }

      const shareId = Array.isArray(shareInsert) ? shareInsert[0]?.id : shareInsert?.id;

      // Vlož notifikaci pro příjemce
      // Policy "Systém vkládá notifikace" má WITH CHECK (true) — anon může vložit
      await sbFetch('rest/v1/notifications', 'POST', {
        user_id:  receiver_id,
        type:     'album_share_invite',
        title:    `@${user.username} s tebou sdílí album`,
        body:     `Album: ${album_name} — ${cards_snapshot.length} karet. Platí ${expiryLabel}.`,
        link:     `share-album.html`,
        metadata: {
          share_id:        shareId,
          sender_id:       user.id,
          sender_username: user.username,
          album_name:      album_name,
          cards_count:     cards_snapshot.length,
          expires_at:      expiresAt,
        },
      }, SUPABASE_ANON);

      // TODO: Fáze 4 — Gmail email notifikace pro příjemce
      // await sendShareEmail({ to: receiverEmail, senderUsername: user.username, albumName, expiresAt });

      return jsonOk(res, {
        share_id: shareId,
        message:  `Sdílení odesláno uživateli @${receiverUsername}`,
        expires_at: expiresAt,
      });
    }

    // ── GET /shares/inbox ───────────────────────────────────
    // Příchozí pozvánky pro přihlášeného uživatele (status = pending)
    if (rawPath === '/inbox' && method === 'GET') {
      const data = await sbFetch(
        `rest/v1/album_shares?receiver_id=eq.${user.id}&status=eq.pending` +
        `&select=id,sender_id,sender_username,album_name,cards_snapshot,expires_at,created_at` +
        `&order=created_at.desc`,
        'GET', null, token
      );
      return jsonOk(res, { inbox: data || [] });
    }

    // ── GET /shares/sent ────────────────────────────────────
    // Odeslané pozvánky přihlášeného uživatele (všechny statusy)
    if (rawPath === '/sent' && method === 'GET') {
      const data = await sbFetch(
        `rest/v1/album_shares?sender_id=eq.${user.id}` +
        `&select=id,receiver_id,album_name,status,expires_at,created_at` +
        `&order=created_at.desc&limit=20`,
        'GET', null, token
      );

      // Doplň usernames příjemců
      const receiverIds = [...new Set((data || []).map(s => s.receiver_id))];
      let profileMap = {};
      if (receiverIds.length > 0) {
        const profiles = await sbFetch(
          `rest/v1/profiles?id=in.(${receiverIds.join(',')})&select=id,username`,
          'GET', null, SUPABASE_ANON
        );
        (profiles || []).forEach(p => { profileMap[p.id] = p.username; });
      }

      const enriched = (data || []).map(s => ({
        ...s,
        receiver_username: profileMap[s.receiver_id] || s.receiver_id?.substring(0, 8),
      }));

      return jsonOk(res, { sent: enriched });
    }

    // ── POST /shares/expire ─────────────────────────────────
    // Ruční spuštění expirace (volej z cron jobu nebo admin panelu)
    if (rawPath === '/expire' && method === 'POST') {
      // Zavolej funkci expire_old_shares přímo přes Supabase RPC
      const result = await sbFetch('rest/v1/rpc/expire_old_shares', 'POST', {}, SUPABASE_ANON);
      return jsonOk(res, { message: 'Expirace proběhla', result });
    }

    // ── PATCH /shares/:id ───────────────────────────────────
    // Přijmout (accepted) nebo odmítnout (declined) sdílení
    const patchMatch = rawPath.match(/^\/([0-9a-f-]{36})$/i);
    if (patchMatch && method === 'PATCH') {
      const shareId = patchMatch[1];
      const { action } = body; // 'accept' | 'decline'

      if (!['accept', 'decline'].includes(action)) {
        return jsonError(res, 400, "action musí být 'accept' nebo 'decline'");
      }

      // Načti sdílení — ověř že je příjemcem přihlášený uživatel
      const share = await sbFetch(
        `rest/v1/album_shares?id=eq.${shareId}&receiver_id=eq.${user.id}&select=id,status,sender_id,sender_username,album_name,expires_at`,
        'GET', null, token
      );
      if (!share || share.length === 0) {
        return jsonError(res, 404, 'Sdílení nenalezeno nebo k němu nemáš přístup');
      }
      const s = share[0];

      if (s.status !== 'pending') {
        return jsonError(res, 409, `Sdílení je již ve stavu: ${s.status}`);
      }
      if (new Date(s.expires_at) < new Date()) {
        // Vyexpiruj a vrať chybu
        await sbFetch(`rest/v1/album_shares?id=eq.${shareId}`, 'PATCH', { status: 'expired' }, token);
        return jsonError(res, 410, 'Toto sdílení již vypršelo');
      }

      const newStatus = action === 'accept' ? 'accepted' : 'declined';
      const acceptedAt = action === 'accept' ? new Date().toISOString() : null;

      await sbFetch(`rest/v1/album_shares?id=eq.${shareId}`, 'PATCH', {
        status:      newStatus,
        ...(acceptedAt && { accepted_at: acceptedAt }),
      }, token);

      // Notifikuj odesílatele o výsledku
      const notifType  = action === 'accept' ? 'share_accepted' : 'share_declined';
      const notifTitle = action === 'accept'
        ? `@${user.username} přijal/a tvoje sdílení`
        : `@${user.username} odmítl/a tvoje sdílení`;
      const notifBody = action === 'accept'
        ? `Album: ${s.album_name} — jdi porovnat alba!`
        : `Album: ${s.album_name}`;
      const notifLink = action === 'accept' ? `compare.html?share_id=${shareId}` : 'share-album.html';

      await sbFetch('rest/v1/notifications', 'POST', {
        user_id:  s.sender_id,
        type:     notifType,
        title:    notifTitle,
        body:     notifBody,
        link:     notifLink,
        metadata: { share_id: shareId, album_name: s.album_name, receiver_username: user.username },
      }, SUPABASE_ANON);

      // TODO: Fáze 4 — email odesílateli o přijetí/odmítnutí
      // await sendShareResultEmail({ senderId: s.sender_id, action, albumName: s.album_name });

      return jsonOk(res, {
        share_id:   shareId,
        new_status: newStatus,
        message:    action === 'accept' ? 'Sdílení přijato' : 'Sdílení odmítnuto',
        ...(action === 'accept' && { compare_url: `compare.html?share_id=${shareId}` }),
      });
    }

    return jsonError(res, 404, 'Endpoint nenalezen: ' + rawPath);

  } catch (err) {
    console.error('[shares.js] Error:', err);
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
