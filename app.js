/**
 * app.js – PokéTrade
 * Supabase klient, ZIP čtečka, sdílené helpery
 *
 * ⚠️  Po nasazení na Vercel sem vlož tvoje údaje:
 */

// ═══════════════════════════════════════════════════════
//  🔧 NASTAVENÍ – VYPLŇ PO REGISTRACI
// ═══════════════════════════════════════════════════════
const SUPABASE_URL  = 'https://xrduqwrinzvmpixgmqta.supabase.co';   // ← Project URL ze Supabase Settings → API
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyZHVxd3Jpbnp2bXBpeGdtcXRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDI0MjksImV4cCI6MjA5MDk3ODQyOX0.2p404Vy77CH_MsvQlnpxaO0H-KlSSt_oJlaFrmttFXs';                   // ← anon public klíč
const VERCEL_URL    = 'https://TVUJ-PROJEKT.vercel.app'; // ← URL tvého Vercel projektu
// ═══════════════════════════════════════════════════════

// ── Supabase REST request ────────────────────────────
async function supabaseRequest(path, method = 'GET', body = null, token = null, redirectTo = null) {
  const headers = {
    'Content-Type':  'application/json',
    'apikey':        SUPABASE_ANON,
    'Authorization': 'Bearer ' + (token || SUPABASE_ANON),
  };
  if (method === 'POST' || method === 'PATCH') {
    headers['Prefer'] = 'return=representation';
  }
  const opts = { method, headers };
  if (body) {
    if (redirectTo) body.redirect_to = redirectTo;
    opts.body = JSON.stringify(body);
  }
  try {
    const res  = await fetch(`${SUPABASE_URL}/${path}`, opts);
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  } catch (err) {
    console.error('Supabase error:', err);
    return { error: { message: err.message } };
  }
}

// ── Přečíst přihlášeného uživatele ──────────────────
function getUser() {
  try {
    const token = localStorage.getItem('sb_token');
    const raw   = localStorage.getItem('sb_user');
    if (!token || !raw || raw === 'null' || raw === 'undefined') return null;
    const user = JSON.parse(raw);
    if (!user || !user.id) return null;
    return user;
  } catch { return null; }
}

// ── Odhlásit ─────────────────────────────────────────
function logout() {
  localStorage.removeItem('sb_token');
  localStorage.removeItem('sb_refresh_token');
  localStorage.removeItem('sb_user');
  window.location.href = 'login.html';
}

// ── Auto-refresh tokenu (každých 10 min) ─────────────
(function autoRefreshToken() {
  async function refreshSession() {
    const rt = localStorage.getItem('sb_refresh_token');
    if (!rt) return;
    try {
      const r = await supabaseRequest('auth/v1/token?grant_type=refresh_token', 'POST', { refresh_token: rt });
      if (r?.access_token && r?.user?.id) {
        localStorage.setItem('sb_token', r.access_token);
        if (r.refresh_token) localStorage.setItem('sb_refresh_token', r.refresh_token);
        localStorage.setItem('sb_user', JSON.stringify(r.user));
      }
    } catch (e) { console.warn('[PokéTrade] Refresh failed:', e); }
  }
  if (localStorage.getItem('sb_token')) setTimeout(refreshSession, 2000);
  setInterval(refreshSession, 10 * 60 * 1000);
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden && localStorage.getItem('sb_token')) refreshSession();
  });
})();

// ── ZIP čtečka (kompatibilní s .pktr / .pkte) ───────
async function readZip(buffer) {
  const view  = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  let eocdOff = -1;
  const from  = Math.max(0, buffer.byteLength - 65558);
  for (let i = buffer.byteLength - 22; i >= from; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocdOff = i; break; }
  }
  if (eocdOff < 0) throw new Error('Neplatný ZIP soubor');

  const cdCount  = view.getUint16(eocdOff + 8,  true);
  const cdOffset = view.getUint32(eocdOff + 16, true);
  const files    = {};
  let pos = cdOffset;

  for (let i = 0; i < cdCount; i++) {
    if (view.getUint32(pos, true) !== 0x02014b50) break;

    const compression = view.getUint16(pos + 10, true);
    const compSize    = view.getUint32(pos + 20, true);
    const nameLen     = view.getUint16(pos + 28, true);
    const extraLen    = view.getUint16(pos + 30, true);
    const commentLen  = view.getUint16(pos + 32, true);
    const localOff    = view.getUint32(pos + 42, true);
    const name        = new TextDecoder().decode(bytes.slice(pos + 46, pos + 46 + nameLen));

    pos += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;

    const lhNameLen  = view.getUint16(localOff + 26, true);
    const lhExtraLen = view.getUint16(localOff + 28, true);
    const dataStart  = localOff + 30 + lhNameLen + lhExtraLen;
    const compData   = bytes.slice(dataStart, dataStart + compSize);

    files[name] = compression === 8 ? await inflate(compData) : compData;
  }
  return files;
}

async function inflate(compData) {
  const ds     = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  writer.write(compData);
  writer.close();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out   = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

// ── Typ emoji ────────────────────────────────────────
function getTypeEmoji(type) {
  const map = {
    fire:'fire', water:'water', grass:'grass',
    lightning:'electric', electric:'electric',
    psychic:'psychic', dark:'dark', darkness:'dark',
    dragon:'dragon', steel:'steel', metal:'steel',
    fighting:'fighting', fairy:'fairy',
    bug:'bug', poison:'poison', ground:'ground',
    ghost:'ghost', ice:'ice', normal:'normal',
    flying:'flying', rock:'rock',
    colorless:'normal', pokemon:'normal',
  };
  const key = map[(type||'').toLowerCase()];
  if (key) return `<img src="elements/${key}.png" style="width:18px;height:18px;object-fit:contain;vertical-align:middle;">`;
  return '🃏';
}

// ── Auto navbar ──────────────────────────────────────
(function initNavAuth() {
  const el   = document.getElementById('navAuth');
  const user = getUser();
  if (!el || !user) return;
  el.innerHTML = `
    <a href="profile.html" class="btn-nav-outline">Můj profil</a>
    <span class="nav-username">${user.user_metadata?.username || user.email || ''}</span>
  `;
})();

// ── Homepage stats ───────────────────────────────────
(async function loadStats() {
  const sCards  = document.getElementById('statCards');
  const sUsers  = document.getElementById('statUsers');
  const sTrades = document.getElementById('statTrades');
  if (!sCards) return;

  try {
    // Počet karet: celkový součet ze všech kolekcí (user_cards)
    // Supabase vrací počet řádků v hlavičce Content-Range při Prefer: count=exact
    const [cardsRes, profilesRes, offersRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/user_cards?select=id`, {
        headers: {
          'apikey': SUPABASE_ANON,
          'Authorization': `Bearer ${SUPABASE_ANON}`,
          'Prefer': 'count=exact',
          'Range-Unit': 'items',
          'Range': '0-0',
        }
      }),
      supabaseRequest('rest/v1/profiles?select=id'),
      supabaseRequest('rest/v1/offers?select=id&status=eq.accepted'),
    ]);

    // Počet karet z Content-Range hlavičky: "0-0/1234" → 1234
    let totalCards = 0;
    const contentRange = cardsRes.headers.get('Content-Range');
    if (contentRange) {
      const parts = contentRange.split('/');
      totalCards = parseInt(parts[1] || '0', 10) || 0;
    }
    // Fallback: zkus spočítat přímo z JSON (pokud Prefer nefunguje)
    if (!totalCards) {
      try {
        const rows = await cardsRes.json();
        if (Array.isArray(rows)) totalCards = rows.length;
      } catch {}
    }

    sCards.textContent  = totalCards > 0 ? totalCards.toLocaleString('cs') : '0';
    sUsers.textContent  = Array.isArray(profilesRes) ? profilesRes.length : '–';
    sTrades.textContent = Array.isArray(offersRes)   ? offersRes.length   : '0';
  } catch(e) {
    console.warn('Stats load error:', e);
    // Fallback: původní metoda přes listings
    try {
      const listings = await supabaseRequest('rest/v1/listings?select=cards_data&status=eq.active');
      const totalCards = Array.isArray(listings)
        ? listings.reduce((s, l) => s + (l.cards_data?.length || 0), 0) : 0;
      sCards.textContent = totalCards > 0 ? totalCards.toLocaleString('cs') : '0';
    } catch {}
  }
})();

