/**
 * POST /api/scan-result?t=<supabase_token>
 *
 * Přijme fotku z mobilní aplikace (jako base64 data URL),
 * nahraje ji do Supabase Storage (bucket: card-photo)
 * a vloží záznam do tabulky photo_queue.
 *
 * PC verze (scanner.html) pak polluje photo_queue a zpracovává fotky.
 *
 * Body (JSON):
 *   photoDataUrl   string  – base64 data:image/jpeg;base64,...
 *   photo          string  – alias pro photoDataUrl
 *   side           string  – 'front' | 'back' | 'detail'
 *   cardIndex      number
 *   totalCards     number
 *   batchId        string
 *   batchComplete  boolean
 *   name           string  – AI výsledek (volitelné)
 *   set            string
 *   number         string
 *   condition      string
 *   confidence     number
 *   ... (ostatní AI pole jsou uložena do metadata JSONB)
 */

const SUPABASE_URL  = 'https://xrduqwrinzvmpixgmqta.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyZHVxd3Jpbnp2bXBpeGdtcXRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDI0MjksImV4cCI6MjA5MDk3ODQyOX0.2p404Vy77CH_MsvQlnpxaO0H-KlSSt_oJlaFrmttFXs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.query.t || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Chybí token' });

  try {
    // ── 1. Ověř token ───────────────────────────────────────────
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}` }
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Neplatný token' });
    const user = await userRes.json();
    if (!user?.id) return res.status(401).json({ error: 'Neplatný token' });

    const body = req.body || {};
    const dataUrl = body.photoDataUrl || body.photo || '';
    if (!dataUrl) return res.status(400).json({ error: 'Chybí photoDataUrl' });

    // ── 2. Dekóduj base64 ───────────────────────────────────────
    const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) return res.status(400).json({ error: 'Neplatný formát obrázku' });

    const mimeType  = matches[1];                           // image/jpeg nebo image/png
    const base64    = matches[2];
    const buffer    = Buffer.from(base64, 'base64');
    const ext       = mimeType.includes('png') ? 'png' : 'jpg';

    // ── 3. Nahraj do Cloudflare R2 (přes worker) místo Supabase Storage ──
    //    Kvůli egressu: fotky se servírují z R2, ne ze Supabase.
    //    Do photo_queue uložíme plnou R2 URL jako storage_path — queue.html
    //    ji pozná podle http prefixu a použije rovnou (umí R2 i staré Supabase).
    const batchId   = body.batchId   || Date.now().toString(36);
    const side      = body.side      || 'front';
    const cardIdx   = body.cardIndex || 1;
    const timestamp = Date.now();
    const filename  = `${batchId}_card${cardIdx}_${side}_${timestamp}.${ext}`;

    const R2_WORKER = 'https://pokedb-api.poketrade.workers.dev';
    const uploadRes = await fetch(
      `${R2_WORKER}/v1/user-photo?filename=${encodeURIComponent(filename)}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type':  mimeType,
        },
        body: buffer,
      }
    );

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error('R2 upload error:', errText);
      return res.status(500).json({ error: 'Nepodařilo se nahrát fotku do R2', detail: errText });
    }
    const uploadData = await uploadRes.json().catch(() => ({}));
    if (!uploadData.ok || !uploadData.url) {
      return res.status(500).json({ error: 'R2 upload nevrátil URL' });
    }
    // storage_path = plná R2 URL (queue.html ji použije přímo)
    const storagePath = uploadData.url;

    // ── 4. Metadata z AI výsledku ───────────────────────────────
    const metadata = {
      side,
      cardIndex:      body.cardIndex   || 1,
      totalCards:     body.totalCards  || 1,
      batchId,
      batchComplete:  body.batchComplete || false,
      name:           body.name        || null,
      set:            body.set         || null,
      number:         body.number      || null,
      type:           body.type        || null,
      hp:             body.hp          || null,
      category:       body.category    || null,
      subtype:        body.subtype     || null,
      variant:        body.variant     || null,
      condition:      body.condition   || 'NM',
      conditionNotes: body.conditionNotes || '',
      confidence:     body.confidence  || null,
      notes:          body.notes       || '',
      lang:           body.lang        || 'EN',
    };

    // ── 5. Vlož záznam do photo_queue ──────────────────────────
    const queueRes = await fetch(`${SUPABASE_URL}/rest/v1/photo_queue`, {
      method: 'POST',
      headers: {
        'apikey':        SUPABASE_ANON,
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=representation',
      },
      body: JSON.stringify({
        user_id:      user.id,
        storage_path: storagePath,
        filename:     filename,
        processed:    false,
        metadata:     metadata,
      }),
    });

    if (!queueRes.ok) {
      // Pokud tabulka nemá sloupec metadata, zkus bez něj
      const fallbackRes = await fetch(`${SUPABASE_URL}/rest/v1/photo_queue`, {
        method: 'POST',
        headers: {
          'apikey':        SUPABASE_ANON,
          'Authorization': `Bearer ${token}`,
          'Content-Type':  'application/json',
          'Prefer':        'return=representation',
        },
        body: JSON.stringify({
          user_id:      user.id,
          storage_path: storagePath,
          filename:     filename,
          processed:    false,
        }),
      });
      if (!fallbackRes.ok) {
        const errText = await fallbackRes.text();
        console.error('photo_queue insert error:', errText);
        return res.status(500).json({ error: 'Nepodařilo se uložit do fronty', detail: errText });
      }
    }

    return res.status(200).json({
      ok:           true,
      storagePath,
      filename,
      batchComplete: body.batchComplete || false,
    });

  } catch (err) {
    console.error('scan-result error:', err);
    return res.status(500).json({ error: 'Interní chyba serveru', detail: err.message });
  }
}