/**
 * api/scan-result.js – PokéTrade
 *
 * Přijme fotku + AI metadata z mobilní aplikace (mobile.html) a:
 *   1. Ověří Supabase access token z query parametru ?t=
 *   2. Nahraje obrázek do Supabase Storage (bucket "card-photo")
 *      s názvem  ${userId}/${batchId}_card${cardIndex}_${side}_${timestamp}.jpg
 *   3. Vloží řádek do tabulky photo_queue (metadata = JSONB se vším AI payloadem)
 *
 * Mobil (mobile.html → postPhoto) volá:
 *   POST /api/scan-result?t=<supabase_access_token>
 *   Content-Type: application/json
 *
 * Payload obsahuje minimálně:
 *   { photo | photoDataUrl, side, cardIndex, totalCards, batchId, batchComplete }
 *
 * A pro přední stranu dále AI data:
 *   name, set, number, type, hp, category, subtype, variant,
 *   condition, conditionNotes, confidence, notes, lang
 *
 * Pro zadní stranu navíc:
 *   backCondition, backIssues, backNotes
 *
 * Pro detaily navíc:
 *   detailIndex
 *
 * Poznámka: Tělo může být velké (komprimovaný base64 ~ 200–400 KB / fotka).
 * Vercel defaultně omezuje JSON body parser na 1 MB; kvůli tomu posouváme
 * limit na 10 MB pomocí `export const config`.
 */

const SUPABASE_URL  = 'https://xrduqwrinzvmpixgmqta.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyZHVxd3Jpbnp2bXBpeGdtcXRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDI0MjksImV4cCI6MjA5MDk3ODQyOX0.2p404Vy77CH_MsvQlnpxaO0H-KlSSt_oJlaFrmttFXs';

// ─── Zvětšení JSON body limitu (defaultní 1 MB nestačí) ─────────
export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
  },
};

// ─── CORS helper ────────────────────────────────────────────────
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export default async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  // ── 1. Token ───────────────────────────────────────────
  const token = req.query.t || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Chybí token' });

  let userId;
  try {
    const userRes = await sbFetch('auth/v1/user', 'GET', null, token);
    if (!userRes?.id) return res.status(401).json({ error: 'Neplatný token' });
    userId = userRes.id;
  } catch (e) {
    return res.status(401).json({ error: 'Chyba ověření tokenu' });
  }

  // ── 2. Rozbal payload ──────────────────────────────────
  const body = req.body || {};
  const {
    photo,
    photoDataUrl,
    side          = 'front',
    cardIndex     = 1,
    totalCards    = 1,
    batchId:      rawBatchId,
    batchComplete = false,
    isFakeTraining = false,
    detailIndex,

    // AI pole (front)
    name = null, set = null, number = null, type = null, hp = null,
    category = null, subtype = null, variant = null,
    condition = 'NM', conditionNotes = '',
    confidence = null, notes = '', lang = 'EN',

    // AI pole (back)
    backCondition = null, backIssues = [], backNotes = '',
  } = body;

  const rawPhoto = photo || photoDataUrl;
  if (!rawPhoto) return res.status(400).json({ error: 'Chybí pole photo' });

  // ── 3. Dekóduj base64 ─────────────────────────────────
  let base64Data, mimeType;
  if (typeof rawPhoto === 'string' && rawPhoto.startsWith('data:')) {
    const commaIdx = rawPhoto.indexOf(',');
    const header   = rawPhoto.slice(0, commaIdx);
    base64Data     = rawPhoto.slice(commaIdx + 1);
    mimeType       = header.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
  } else {
    base64Data = rawPhoto;
    mimeType   = 'image/jpeg';
  }

  const ext       = mimeType === 'image/png'  ? 'png'
                  : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const timestamp = Date.now();

  // Sanitize batchId – v DB vidíme jen 8-znakové base36 hodnoty jako "mnsswygh"
  const batchId = String(rawBatchId || `batch${timestamp.toString(36)}`)
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 32);

  // ── 4. Naming odpovídá formátu z DB ───────────────────
  //    ${batchId}_card${cardIndex}_${side}[_dX]_${timestamp}.${ext}
  const sidePart = side === 'detail' && detailIndex
    ? `detail_d${detailIndex}`
    : side;
  const filename    = `${batchId}_card${cardIndex}_${sidePart}_${timestamp}.${ext}`;
  const storagePath = `${userId}/${filename}`;

  // ── 5. Upload do Storage ──────────────────────────────
  try {
    const imageBuffer = Buffer.from(base64Data, 'base64');
    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/card-photo/${storagePath}`,
      {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'apikey':        SUPABASE_ANON,
          'Content-Type':  mimeType,
          'x-upsert':      'true',
        },
        body: imageBuffer,
      }
    );

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error('[scan-result] Storage upload failed:', uploadRes.status, errText);
      return res.status(500).json({
        error:  'Nepodařilo se nahrát fotku do Storage',
        status: uploadRes.status,
        detail: errText,
      });
    }
  } catch (e) {
    console.error('[scan-result] Storage error:', e);
    return res.status(500).json({ error: 'Chyba při nahrávání do Storage' });
  }

  // ── 6. Sestav metadata (shodné s tím, co už máš v DB) ─
  const metadata = {
    // základní info o dávce
    side, cardIndex, totalCards, batchId, batchComplete,

    // AI data (front)
    name, set, number, type, hp, category, subtype, variant,
    condition, conditionNotes, confidence, notes, lang,
  };
  if (isFakeTraining) metadata.isFakeTraining = true;
  if (detailIndex !== undefined) metadata.detailIndex = detailIndex;
  if (side === 'back') {
    if (backCondition) metadata.backCondition = backCondition;
    if (backIssues?.length) metadata.backIssues = backIssues;
    if (backNotes) metadata.backNotes = backNotes;
  }

  // ── 7. Insert do photo_queue ──────────────────────────
  try {
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

    if (queueRes?.error || queueRes?.code) {
      console.error('[scan-result] photo_queue insert error:', queueRes);
      return res.status(500).json({
        error:  'Nepodařilo se zapsat do photo_queue',
        detail: queueRes.error?.message || queueRes.message || 'unknown',
      });
    }
  } catch (e) {
    console.error('[scan-result] photo_queue error:', e);
    return res.status(500).json({ error: 'Chyba při zápisu do photo_queue' });
  }

  // ── 8. Hotovo ─────────────────────────────────────────
  return res.status(200).json({
    ok: true,
    storagePath,
    filename,
    message: 'Fotka přijata a zařazena do fronty',
  });
}

// ─── Supabase REST helper ──────────────────────────────
async function sbFetch(path, method, body, token) {
  const headers = {
    'Content-Type':  'application/json',
    'apikey':        SUPABASE_ANON,
    'Authorization': `Bearer ${token || SUPABASE_ANON}`,
  };
  if (method === 'POST' || method === 'PATCH') {
    headers['Prefer'] = 'return=minimal';
  }
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const r    = await fetch(`${SUPABASE_URL}/${path}`, opts);
  const text = await r.text();
  if (!r.ok) {
    try { return JSON.parse(text); }
    catch { return { error: { message: text, status: r.status } }; }
  }
  return text ? JSON.parse(text) : {};
}
