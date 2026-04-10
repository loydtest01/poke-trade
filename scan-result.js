/**
 * api/scan-result.js  –  PokéTrade
 *
 * Přijme fotku z mobilní aplikace (mobile.html) a:
 *   1. Ověří Supabase token z query parametru ?t=
 *   2. Nahraje obrázek do Supabase Storage (bucket "card-photo")
 *   3. Vloží řádek do tabulky photo_queue (včetně sloupce metadata)
 *
 * Mobil volá:  POST /api/scan-result?t=<supabase_access_token>
 * Body (JSON):
 *   {
 *     photo:         "data:image/jpeg;base64,..."
 *     photoDataUrl:  "data:image/jpeg;base64,..."  (alias)
 *     side:          "front" | "back" | "detail"
 *     cardIndex:     1
 *     totalCards:    3
 *     batchId:       "abc123"
 *     batchComplete: false
 *     isFakeTraining: false
 *   }
 */

const SUPABASE_URL  = 'https://xrduqwrinzvmpixgmqta.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyZHVxd3Jpbnp2bXBpeGdtcXRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDI0MjksImV4cCI6MjA5MDk3ODQyOX0.2p404Vy77CH_MsvQlnpxaO0H-KlSSt_oJlaFrmttFXs';

// ── CORS helper ───────────────────────────────────────
// res.set() je Express metoda – Vercel ji NEMÁ.
// Používáme res.setHeader() pro každý header zvlášť.
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export default async function handler(req, res) {
  // CORS hlavičky nastavíme hned na začátku – platí pro VŠECHNY odpovědi
  setCors(res);

  // ── Preflight ────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── 1. Ověř token ────────────────────────────────────
  const token = req.query.t || req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Chybí token' });
  }

  let userId;
  try {
    const userRes = await sbFetch('auth/v1/user', 'GET', null, token);
    if (!userRes?.id) {
      return res.status(401).json({ error: 'Neplatný token' });
    }
    userId = userRes.id;
  } catch (e) {
    return res.status(401).json({ error: 'Chyba ověření tokenu' });
  }

  // ── 2. Zpracuj tělo požadavku ────────────────────────
  const body = req.body;
  const {
    photo,
    photoDataUrl,
    side          = 'front',
    cardIndex     = 1,
    totalCards    = 1,
    batchId,
    batchComplete = false,
    isFakeTraining = false,
    detailIndex,
  } = body || {};

  const rawPhoto = photo || photoDataUrl;
  if (!rawPhoto) {
    return res.status(400).json({ error: 'Chybí pole photo' });
  }

  // Dekóduj base64
  let base64Data, mimeType;
  if (rawPhoto.startsWith('data:')) {
    const [header, data] = rawPhoto.split(',');
    base64Data = data;
    mimeType   = header.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
  } else {
    base64Data = rawPhoto;
    mimeType   = 'image/jpeg';
  }

  const ext        = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const timestamp  = Date.now();
  const filename   = `karta-${cardIndex}-${side}${detailIndex ? `-d${detailIndex}` : ''}-${timestamp}.${ext}`;
  const batchSeg   = batchId ? batchId.replace(/[^a-zA-Z0-9_-]/g, '') : `batch-${timestamp}`;
  const storagePath = `${userId}/${batchSeg}/${filename}`;

  // ── 3. Nahraj do Supabase Storage ────────────────────
  try {
    const imageBuffer = Buffer.from(base64Data, 'base64');
    const uploadRes   = await fetch(
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
      return res.status(500).json({
        error:  'Nepodařilo se nahrát fotku do Storage',
        detail: errText,
      });
    }
  } catch (e) {
    console.error('[scan-result] Storage error:', e);
    return res.status(500).json({ error: 'Chyba při nahrávání do Storage' });
  }

  // ── 4. Vlož řádek do photo_queue ─────────────────────
  try {
    const metadata = {
      side,
      cardIndex,
      totalCards,
      batchId:       batchSeg,
      batchComplete,
      isFakeTraining,
      ...(detailIndex !== undefined ? { detailIndex } : {}),
    };

    const queueRes = await sbFetch(
      'rest/v1/photo_queue',
      'POST',
      {
        user_id:      userId,
        storage_path: storagePath,
        filename:     filename,
        processed:    false,
        metadata:     metadata,
      },
      token
    );

    if (queueRes?.error) {
      console.error('[scan-result] photo_queue insert error:', queueRes.error);
      return res.status(500).json({
        error:  'Nepodařilo se zapsat do photo_queue',
        detail: queueRes.error.message,
      });
    }
  } catch (e) {
    console.error('[scan-result] photo_queue error:', e);
    return res.status(500).json({ error: 'Chyba při zápisu do photo_queue' });
  }

  // ── 5. Hotovo ─────────────────────────────────────────
  return res.status(200).json({
    ok:      true,
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
