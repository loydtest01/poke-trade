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
const VERCEL_URL    = 'https://pokemon-trade-ruddy.vercel.app'; // ← URL tvého Vercel projektu
// ═══════════════════════════════════════════════════════

// ── Supabase REST request ────────────────────────────
async function supabaseRequest(path, method = 'GET', body = null, token = null, redirectTo = null) {
  // Použij getValidToken() pokud je dostupný (čeká na probíhající refresh)
  const tok = token || (window.getValidToken ? await window.getValidToken() : null) || SUPABASE_ANON;
  const _buildHeaders = (t) => {
    const h = {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_ANON,
      'Authorization': 'Bearer ' + t,
    };
    if (method === 'POST' || method === 'PATCH') h['Prefer'] = 'return=representation';
    return h;
  };
  const _buildOpts = (t) => {
    const opts = { method, headers: _buildHeaders(t) };
    if (body) {
      const b = redirectTo ? { ...body, redirect_to: redirectTo } : body;
      opts.body = JSON.stringify(b);
    }
    return opts;
  };
  try {
    const res = await fetch(`${SUPABASE_URL}/${path}`, _buildOpts(tok));
    // 401 → refresh a jeden retry
    if (res.status === 401 && window.getValidToken) {
      const newTok = await window.getValidToken();
      if (newTok && newTok !== tok) {
        const retry = await fetch(`${SUPABASE_URL}/${path}`, _buildOpts(newTok));
        const rt = await retry.text();
        return rt ? JSON.parse(rt) : {};
      }
    }
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
  localStorage.removeItem('sb_email');
  localStorage.removeItem('pkc_is_admin');   // smaž admin příznak při odhlášení
  localStorage.removeItem('pkc_avatar_local');
  window.location.href = 'login.html';
}

// ── Auto-refresh tokenu (každých 9 min) ─────────────
// window.getValidToken() – vždy vrátí čerstvý token; bezpečné pro uploady
(function autoRefreshToken() {
  var _refreshPromise = null;

  function _doRefresh() {
    const rt = localStorage.getItem('sb_refresh_token');
    if (!rt) { _refreshPromise = null; return Promise.resolve(null); }
    _refreshPromise = fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON },
      body: JSON.stringify({ refresh_token: rt })
    })
    .then(r => r.json())
    .then(d => {
      if (d?.access_token && d?.user?.id) {
        localStorage.setItem('sb_token', d.access_token);
        if (d.refresh_token) localStorage.setItem('sb_refresh_token', d.refresh_token);
        localStorage.setItem('sb_user', JSON.stringify(d.user));
        // Aktualizuj pkc_online_session při refreshi tokenu
        try { var _u=d.user; localStorage.setItem('pkc_online_session', JSON.stringify({ token: d.access_token, userId: _u.id, username: (_u.user_metadata&&_u.user_metadata.username)||(_u.email?_u.email.split('@')[0]:'') })); } catch(e) {}
        return d.access_token;
      }
      return null;
    })
    .catch(e => { console.warn('[PokéTrade] Refresh failed:', e); return null; })
    .finally(() => { _refreshPromise = null; });
    return _refreshPromise;
  }

  // Veřejná funkce – používej před každým DB voláním vyžadujícím auth
  window.getValidToken = function() {
    if (_refreshPromise) return _refreshPromise;
    return Promise.resolve(localStorage.getItem('sb_token'));
  };

  if (localStorage.getItem('sb_token')) setTimeout(_doRefresh, 1500);
  setInterval(_doRefresh, 9 * 60 * 1000);

  // Při návratu na záložku – refresh pokud byl tab schovaný > 5 min
  var _lastHidden = 0;
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      _lastHidden = Date.now();
    } else if (localStorage.getItem('sb_token')) {
      if (Date.now() - _lastHidden > 5 * 60 * 1000) _doRefresh();
      else _doRefresh();
    }
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
    // ✅ OPTIMALIZACE: RPC funkce vrací jen 3 čísla místo tisíců řádků
    // Snižuje PostgREST egress o ~95% oproti původnímu select=card_data
    const stats = await supabaseRequest('rest/v1/rpc/get_homepage_stats', 'POST', {});
    if (stats && typeof stats === 'object') {
      sCards.textContent  = stats.total_cards  > 0 ? Number(stats.total_cards).toLocaleString('cs')  : '0';
      sUsers.textContent  = stats.total_users  > 0 ? Number(stats.total_users).toLocaleString('cs')  : '–';
      sTrades.textContent = stats.total_trades > 0 ? Number(stats.total_trades).toLocaleString('cs') : '0';
    }
  } catch(e) {
    console.warn('Stats load error:', e);
  }
})();

