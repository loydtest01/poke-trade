/**
 * notif-bell.js — Notifikační zvoneček pro PokéCards / PokéTrade
 * Volá Supabase REST přímo (žádný serverless endpoint = žádná 500 chyba).
 * Závisí na: app.js (SUPABASE_URL, SUPABASE_ANON)
 */
(function () {

  const CSS = `
  .notif-bell-wrap { position:relative;display:flex;align-items:center;margin-right:4px; }
  .notif-bell-btn { position:relative;cursor:pointer;color:rgba(240,236,228,.75);line-height:1;transition:background .15s,color .15s; }
  .notif-bell-btn:hover { background:rgba(255,255,255,.08);color:#f0ece4; }
  .notif-bell-btn.has-unread { color:#f5c842; }
  .notif-badge { position:absolute;top:1px;right:1px;min-width:16px;height:16px;background:#f5c842;color:#0d0d1a;font-size:10px;font-weight:800;border-radius:99px;display:flex;align-items:center;justify-content:center;padding:0 3px;pointer-events:none; }
  .notif-drop { display:none;position:absolute;top:calc(100% + 8px);right:0;width:320px;background:#1a1a2e;border:1px solid rgba(255,255,255,.12);border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,.55);z-index:500;overflow:hidden; }
  .notif-drop.open { display:block; }
  .notif-drop-head { display:flex;align-items:center;justify-content:space-between;padding:12px 14px 10px;border-bottom:1px solid rgba(255,255,255,.08); }
  .notif-drop-title { font-size:13px;font-weight:700;color:#f0ece4; }
  .notif-read-all-btn { background:none;border:none;cursor:pointer;font-size:11px;color:rgba(245,200,66,.8);font-family:inherit;padding:0; }
  .notif-read-all-btn:hover { color:#f5c842; }
  .notif-drop-list { max-height:320px;overflow-y:auto; }
  .notif-item { display:flex;align-items:flex-start;gap:10px;padding:11px 14px;border-bottom:1px solid rgba(255,255,255,.05);cursor:pointer;transition:background .12s; }
  .notif-item:last-child { border-bottom:none; }
  .notif-item:hover { background:rgba(255,255,255,.04); }
  .notif-item.unread { background:rgba(245,200,66,.05); }
  .notif-item.unread:hover { background:rgba(245,200,66,.09); }
  .notif-dot { width:7px;height:7px;border-radius:50%;background:#f5c842;flex-shrink:0;margin-top:5px; }
  .notif-dot.read { background:transparent;border:1px solid rgba(255,255,255,.15); }
  .notif-body { flex:1;min-width:0; }
  .notif-item-title { font-size:12px;font-weight:600;color:#f0ece4;margin-bottom:2px; }
  .notif-item-body { font-size:11px;color:rgba(240,236,228,.5);line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
  .notif-item-time { font-size:10px;color:rgba(240,236,228,.3);margin-top:3px; }
  .notif-item-link { font-size:10px;color:rgba(245,200,66,.7);margin-top:2px;font-weight:600; }
  .notif-empty { text-align:center;padding:28px 14px;font-size:13px;color:rgba(240,236,228,.35); }
  .notif-drop-footer { border-top:1px solid rgba(255,255,255,.08);padding:9px 14px;text-align:center; }
  .notif-drop-footer a { font-size:12px;color:rgba(245,200,66,.75);text-decoration:none; }
  .notif-drop-footer a:hover { color:#f5c842; }
  `;

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  let _open = false, _lastCount = 0;

  function getToken() {
    return localStorage.getItem('sb_token') || localStorage.getItem('sb_access_token') || null;
  }
  function getUid() { return localStorage.getItem('sb_user_id') || (function(){try{var u=JSON.parse(localStorage.getItem('sb_user')||'null');return u&&u.id||null}catch(e){return null}})() || null; }
  function getSbUrl()  { return typeof SUPABASE_URL  !== 'undefined' ? SUPABASE_URL  : null; }
  function getSbAnon() { return typeof SUPABASE_ANON !== 'undefined' ? SUPABASE_ANON : null; }

  function sbH(token) {
    return { 'apikey': getSbAnon(), 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
  }

  function buildBell() {
    const wrap = document.createElement('div');
    wrap.className = 'notif-bell-wrap'; wrap.id = 'notifBellWrap';
    wrap.innerHTML = `
      <button class="notif-bell-btn chat-icon-btn" id="notifBellBtn" title="Notifikace">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        <span class="notif-badge" id="notifBadge" style="display:none">0</span>
      </button>
      <div class="notif-drop" id="notifDrop">
        <div class="notif-drop-head">
          <span class="notif-drop-title">🔔 Notifikace</span>
          <button class="notif-read-all-btn" id="notifReadAllBtn">Vše přečteno</button>
        </div>
        <div class="notif-drop-list" id="notifDropList"><div class="notif-empty">📭 Žádné notifikace</div></div>
        <div class="notif-drop-footer"><a href="share-album.html">Sdílení alb →</a></div>
      </div>`;
    return wrap;
  }

  function insertBell() {
    if (!getToken() || !getSbUrl() || !getSbAnon()) return;
    if (document.getElementById('notifBellWrap')) return;
    const topbarRight = document.querySelector('.topbar-right');
    if (!topbarRight) return;
    const wrap = buildBell();
    const ref = document.getElementById('chatDropWrap') || document.getElementById('userChip');
    if (ref) topbarRight.insertBefore(wrap, ref);
    else topbarRight.prepend(wrap);
    document.getElementById('notifBellBtn').addEventListener('click', toggleDrop);
    document.getElementById('notifReadAllBtn').addEventListener('click', markAllRead);
    document.addEventListener('click', function(e) {
      if (_open && !document.getElementById('notifBellWrap').contains(e.target)) closeDrop();
    });
    fetchCount();
    setInterval(fetchCount, 30000);
  }

  async function fetchCount() {
    const t = getToken(), uid = getUid(), url = getSbUrl();
    if (!t || !uid || !url) return;
    try {
      const r = await fetch(`${url}/rest/v1/notifications?user_id=eq.${uid}&read=eq.false&type=neq.message&select=id`, { headers: sbH(t) });
      if (!r.ok) return;
      const d = await r.json();
      updateBadge(Array.isArray(d) ? d.length : 0);
    } catch(e) {}
  }

  async function fetchNotifications() {
    const t = getToken(), uid = getUid(), url = getSbUrl();
    if (!t || !uid || !url) return [];
    try {
      const r = await fetch(`${url}/rest/v1/notifications?user_id=eq.${uid}&order=created_at.desc&limit=10&type=neq.message&select=id,title,body,link,read,created_at`, { headers: sbH(t) });
      if (!r.ok) return [];
      return await r.json() || [];
    } catch { return []; }
  }

  async function markRead(id) {
    const t = getToken(), uid = getUid(), url = getSbUrl();
    if (!t || !uid || !url) return;
    try {
      await fetch(`${url}/rest/v1/notifications?id=eq.${id}&user_id=eq.${uid}`,
        { method:'PATCH', headers:{...sbH(t),'Prefer':'return=minimal'}, body:JSON.stringify({read:true}) });
    } catch {}
  }

  async function markAllRead() {
    const t = getToken(), uid = getUid(), url = getSbUrl();
    if (!t || !uid || !url) return;
    try {
      await fetch(`${url}/rest/v1/notifications?user_id=eq.${uid}&read=eq.false`,
        { method:'PATCH', headers:{...sbH(t),'Prefer':'return=minimal'}, body:JSON.stringify({read:true}) });
      updateBadge(0);
      fetchNotifications().then(renderList);
    } catch {}
  }

  function updateBadge(count) {
    _lastCount = count;
    const badge = document.getElementById('notifBadge');
    const btn   = document.getElementById('notifBellBtn');
    if (!badge || !btn) return;
    if (count > 0) { badge.style.display='flex'; badge.textContent=count>99?'99+':count; btn.classList.add('has-unread'); }
    else           { badge.style.display='none'; btn.classList.remove('has-unread'); }
  }

  function fmtTime(iso) {
    if (!iso) return '';
    const d=new Date(iso),n=new Date(),diff=n-d;
    if (diff<60000) return 'teď';
    if (diff<3600000) return Math.floor(diff/60000)+' min';
    if (d.toDateString()===n.toDateString()) return d.toLocaleTimeString('cs',{hour:'2-digit',minute:'2-digit'});
    const y=new Date(n); y.setDate(y.getDate()-1);
    if (d.toDateString()===y.toDateString()) return 'včera';
    return d.toLocaleDateString('cs',{day:'numeric',month:'numeric'});
  }
  function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function notifIcon(title, body) {
    const t = (title || '').toLowerCase() + ' ' + (body || '').toLowerCase();
    if (t.includes('zakoupil') || t.includes('prodej') || t.includes('koupil') || t.includes('purchase') || t.includes('sold')) return '🛒';
    if (t.includes('zpráv') || t.includes('message') || t.includes('chat')) return '💬';
    if (t.includes('wishlist') || t.includes('wish')) return '⭐';
    if (t.includes('nabídka') || t.includes('listing') || t.includes('offer')) return '🃏';
    if (t.includes('výměna') || t.includes('trade')) return '🔄';
    return '🔔';
  }

  function renderList(items) {
    const list = document.getElementById('notifDropList');
    if (!list) return;
    if (!items||!items.length) { list.innerHTML='<div class="notif-empty">📭 Žádné notifikace</div>'; return; }
    list.innerHTML = items.map(n=>`
      <div class="notif-item ${!n.read?'unread':''}" data-id="${esc(n.id)}" data-href="${esc(n.link||'#')}" onclick="window._notifClick&&window._notifClick(this)">
        <div class="notif-dot ${n.read?'read':''}"></div>
        <div class="notif-body">
          <div class="notif-item-title">${notifIcon(n.title,n.body)} ${esc(n.title||'Notifikace')}</div>
          <div class="notif-item-body">${esc(n.body||'')}</div>
          ${n.link && n.link !== '#' ? `<div class="notif-item-link">🔗 Zobrazit →</div>` : ''}
          <div class="notif-item-time">${fmtTime(n.created_at)}</div>
        </div>
      </div>`).join('');
    window._notifClick = async function(el) {
      const id=el.dataset.id, href=el.dataset.href;
      el.classList.remove('unread'); el.querySelector('.notif-dot').classList.add('read');
      await markRead(id);
      updateBadge(Math.max(0,_lastCount-1));
      if (href&&href!=='#') location.href=href;
    };
  }

  function toggleDrop() { _open ? closeDrop() : openDrop(); }
  function openDrop() {
    _open=true; document.getElementById('notifDrop')?.classList.add('open');
    document.getElementById('notifDropList').innerHTML='<div class="notif-empty">⏳ Načítám…</div>';
    fetchNotifications().then(renderList);
  }
  function closeDrop() { _open=false; document.getElementById('notifDrop')?.classList.remove('open'); }

  /* Expose pro volání po přihlášení (scanner.html, mobile.html apod.) */
  window._notifBellInit = insertBell;

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',insertBell);
  else insertBell();

})();
