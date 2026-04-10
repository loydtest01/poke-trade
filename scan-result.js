/**
 * api/scan-result.js  –  PokéTrade
 *
 * Přijme fotku z mobilní aplikace (mobile.html) a:
 *   1. Ověří Supabase token z query parametru ?t=
 *   2. Nahraje obrázek do Supabase Storage (bucket "card-photo")
 *   3. Vloží řádek do tabulky photo_queue
 *
 * Mobil volá:  POST /api/scan-result?t=<supabase_access_token>
 * Body (JSON):
 *   {
 *     photo:        "data:image/jpeg;base64,..."   ← zkomprimovaná fotka (dataURL)
 *     side:         "front" | "back" | "detail"
 *     cardIndex:    1
 *     totalCards:   3
 *     batchId:      "abc123"
 *     batchComplete: false
 *   }
 */

const SUPABASE_URL  = 'https://xrduqwrinzvmpixgmqta.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyZHVxd3Jpbnp2bXBpeGdtcXRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDI0MjksImV4cCI6MjA5MDk3ODQyOX0.2p404Vy77CH_MsvQlnpxaO0H-KlSSt_oJlaFrmttFXs';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async function handler(req, res) {
  // ── Preflight ────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return res.status(200).set(CORS).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).set(CORS).json({ error: 'Method not allowed' });
  }

  // ── 1. Ověř token ────────────────────────────────────
  const token = req.query.t || req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).set(CORS).json({ error: 'Chybí token' });
  }

  let userId;
  try {
    const userRes = await sbFetch('auth/v1/user', 'GET', null, token);
    if (!userRes?.id) {
      return res.status(401).set(CORS).json({ error: 'Neplatný token' });
    }
    userId = userRes.id;
  } catch (e) {
    return res.status(401).set(CORS).json({ error: 'Chyba ověření tokenu' });
  }

  // ── 2. Zpracuj tělo požadavku ────────────────────────
  const body = req.body;
  const { photo, side = 'front', cardIndex = 1, batchId } = body || {};

  if (!photo) {
    return res.status(400).set(CORS).json({ error: 'Chybí pole photo' });
  }

  // photo může být:  "data:image/jpeg;base64,/9j/..."  nebo čisté base64
  let base64Data, mimeType;
  if (photo.startsWith('data:')) {
    const [header, data] = photo.split(',');
    base64Data = data;
    mimeType   = header.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
  } else {
    base64Data = photo;
    mimeType   = 'image/jpeg';
  }

  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const timestamp = Date.now();
  const filename  = `karta-${cardIndex}-${side}-${timestamp}.${ext}`;

  // Supabase Storage cesta:  <userId>/<batchId>/<filename>
  // RLS politika vyžaduje, aby první segment = auth.uid()
  const batchSegment = batchId ? batchId.replace(/[^a-zA-Z0-9_-]/g, '') : timestamp;
  const storagePath  = `${userId}/${batchSegment}/${filename}`;

  // ── 3. Nahraj do Supabase Storage ────────────────────
  try {
    const imageBuffer = Buffer.from(base64Data, 'base64');

    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/card-photo/${storagePath}`,
      {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'apikey':         SUPABASE_ANON,
          'Content-Type':   mimeType,
          'x-upsert':       'false',
        },
        body: imageBuffer,
      }
    );

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error('[scan-result] Storage upload failed:', errText);
      return res.status(500).set(CORS).json({
        error: 'Nepodařilo se nahrát fotku do Storage',
        detail: errText,
      });
    }
  } catch (e) {
    console.error('[scan-result] Storage fetch error:', e);
    return res.status(500).set(CORS).json({ error: 'Chyba při nahrávání do Storage' });
  }

  // ── 4. Vlož řádek do photo_queue ─────────────────────
  try {
    const queueRes = await sbFetch(
      'rest/v1/photo_queue',
      'POST',
      {
        user_id:      userId,
        storage_path: storagePath,
        filename:     filename,
        processed:    false,
      },
      token  // uživatelský token (RLS: auth.uid() = user_id)
    );

    if (queueRes?.error) {
      console.error('[scan-result] photo_queue insert error:', queueRes.error);
      return res.status(500).set(CORS).json({
        error: 'Nepodařilo se zapsat do photo_queue',
        detail: queueRes.error.message,
      });
    }
  } catch (e) {
    console.error('[scan-result] photo_queue fetch error:', e);
    return res.status(500).set(CORS).json({ error: 'Chyba při zápisu do photo_queue' });
  }

  // ── 5. Hotovo ─────────────────────────────────────────
  return res.status(200).set(CORS).json({
    ok:          true,
    storagePath,
    filename,
    message: 'Fotka přijata a zařazena do fronty',
  });
}

// ── Supabase REST helper ──────────────────────────────
async function sbFetch(path, method, body, token) {
  const headers = {
    'Content-Type':  'application/json',
    'apikey':         SUPABASE_ANON,
    'Authorization': `Bearer ${token || SUPABASE_ANON}`,
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
