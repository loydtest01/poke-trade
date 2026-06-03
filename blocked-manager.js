/* ════════════════════════════════════════════════════════════════
   blocked-manager.js
   Sekce „Moje blokace" do profilu — výpis zablokovaných + odblokování.
   Načítat na profile.html (po app.js / topbar.js).
   Předpokládá globální: SUPABASE_URL, SUPABASE_ANON (z app.js) a token/userId
   v localStorage (sb_token / sb_user_id).
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const SBU = typeof SUPABASE_URL  !== 'undefined' ? SUPABASE_URL  : '';
  const SBA = typeof SUPABASE_ANON !== 'undefined' ? SUPABASE_ANON : '';

  function tok() { return localStorage.getItem('sb_token') || null; }
  function uid() { return localStorage.getItem('sb_user_id') || null; }

  async function sb(path, method = 'GET', body = null) {
    const headers = { 'apikey': SBA, 'Authorization': `Bearer ${tok() || SBA}`, 'Content-Type': 'application/json' };
    if (method !== 'GET') headers['Prefer'] = 'return=representation';
    const res = await fetch(`${SBU}/${path}`, { method, headers, body: body ? JSON.stringify(body) : null });
    if (res.status === 204) return [];
    try { return await res.json(); } catch { return []; }
  }

  async function loadBlocked() {
    const me = uid();
    if (!me) return [];
    // blocked_users + jméno blokovaného z profiles
    const rows = await sb(`rest/v1/blocked_users?blocker_id=eq.${me}&select=blocked_id,created_at`);
    if (!Array.isArray(rows) || !rows.length) return [];
    const ids = rows.map(r => r.blocked_id);
    const profs = await sb(`rest/v1/profiles?id=in.(${ids.join(',')})&select=id,username,avatar_url`);
    const pmap = {};
    (Array.isArray(profs) ? profs : []).forEach(p => { pmap[p.id] = p; });
    return rows.map(r => ({
      id: r.blocked_id,
      username: pmap[r.blocked_id]?.username || 'Neznámý uživatel',
      avatar: pmap[r.blocked_id]?.avatar_url || null,
      since: r.created_at,
    }));
  }

  async function unblock(id, username) {
    const me = uid();
    if (!me || !tok()) return;
    if (!confirm(`Odblokovat uživatele @${username}?\n\nBude ti zase moct psát a sdílet.`)) return;
    await fetch(`${SBU}/rest/v1/blocked_users?blocker_id=eq.${me}&blocked_id=eq.${id}`, {
      method: 'DELETE',
      headers: { 'apikey': SBA, 'Authorization': `Bearer ${tok()}` },
    });
    render(); // překresli
  }
  window._unblockUser = unblock;

  function row(b) {
    const av = b.avatar
      ? `<img src="${b.avatar}" alt="" style="width:34px;height:34px;border-radius:50%;object-fit:cover">`
      : `<div class="blk-av-ph">${(b.username[0] || '?').toUpperCase()}</div>`;
    const since = b.since ? new Date(b.since).toLocaleDateString('cs') : '';
    return `<div class="blk-row">
      <div class="blk-user">${av}<div><div class="blk-name">@${b.username}</div>
        ${since ? `<div class="blk-since">zablokován ${since}</div>` : ''}</div></div>
      <button class="blk-unblock" onclick="_unblockUser('${b.id}','${(b.username || '').replace(/'/g, "\\'")}')">Odblokovat</button>
    </div>`;
  }

  async function render() {
    const host = document.getElementById('blockedSection');
    if (!host) return;
    host.querySelector('.blk-list').innerHTML = '<div class="blk-loading">Načítám…</div>';
    const list = await loadBlocked();
    const wrap = host.querySelector('.blk-list');
    if (!list.length) {
      wrap.innerHTML = '<div class="blk-empty">Nikoho nemáš zablokovaného. 👍</div>';
    } else {
      wrap.innerHTML = list.map(row).join('');
    }
  }
  window._renderBlockedSection = render;

  function inject() {
    const content = document.getElementById('profileContent');
    if (!content || document.getElementById('blockedSection')) return;
    const sec = document.createElement('section');
    sec.id = 'blockedSection';
    sec.className = 'profile-section blk-section';
    sec.innerHTML = `
      <h3 class="blk-title">🚫 Moje blokace</h3>
      <p class="blk-sub">Zablokovaní ti nemůžou psát ani sdílet alba. Můžeš je kdykoliv odblokovat.</p>
      <div class="blk-list"><div class="blk-loading">Načítám…</div></div>`;
    content.appendChild(sec);
    render();
  }

  const css = document.createElement('style');
  css.textContent = `
  .blk-section{margin-top:18px;padding:16px;border:1px solid rgba(255,255,255,0.08);border-radius:14px;background:rgba(255,255,255,0.025)}
  .blk-title{font-family:'Unbounded',sans-serif;font-size:16px;font-weight:800;color:#f0ece4;margin:0 0 4px}
  .blk-sub{font-size:12px;color:rgba(240,236,228,0.5);margin:0 0 12px}
  .blk-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,0.03);margin-bottom:8px}
  .blk-user{display:flex;align-items:center;gap:10px}
  .blk-av-ph{width:34px;height:34px;border-radius:50%;background:rgba(245,200,66,0.18);color:#f5c842;display:flex;align-items:center;justify-content:center;font-weight:800}
  .blk-name{font-size:14px;font-weight:600;color:#f0ece4}
  .blk-since{font-size:11px;color:rgba(240,236,228,0.4)}
  .blk-unblock{padding:6px 14px;border-radius:8px;border:1px solid rgba(74,222,128,0.4);background:rgba(74,222,128,0.12);color:#4ade80;font-weight:600;font-size:12px;cursor:pointer;font-family:inherit;transition:all .15s}
  .blk-unblock:hover{background:rgba(74,222,128,0.22)}
  .blk-empty,.blk-loading{font-size:13px;color:rgba(240,236,228,0.45);padding:10px 4px;text-align:center}
  `;
  document.head.appendChild(css);

  // Po načtení profilu vlož sekci. profileContent se odkrývá async,
  // tak zkoušíme dokud se neobjeví (max ~10 s).
  let tries = 0;
  const iv = setInterval(() => {
    tries++;
    const c = document.getElementById('profileContent');
    if (c && c.style.display !== 'none') { inject(); clearInterval(iv); }
    else if (tries > 50) { clearInterval(iv); }
  }, 200);

})();
