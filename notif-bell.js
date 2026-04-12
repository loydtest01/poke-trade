/**
 * notif-bell.js — Notifikační zvoneček pro PokéCards / PokéTrade
 * Automaticky se vloží do .topbar-right na všech stránkách.
 * Závisí na: app.js (SUPABASE_URL, SUPABASE_ANON, VERCEL_URL)
 * Fáze 4
 */
(function () {

  // ── CSS ──────────────────────────────────────────────────────────
  const CSS = `
  .notif-bell-wrap {
    position: relative;
    display: flex;
    align-items: center;
    margin-right: 4px;
  }
  .notif-bell-btn {
    position: relative;
    background: none;
    border: none;
    cursor: pointer;
    padding: 6px 8px;
    border-radius: 10px;
    color: rgba(240,236,228,.75);
    font-size: 17px;
    line-height: 1;
    transition: background .15s, color .15s;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .notif-bell-btn:hover { background: rgba(255,255,255,.08); color: #f0ece4; }
  .notif-bell-btn.has-unread { color: #f5c842; }
  .notif-badge {
    position: absolute;
    top: 1px; right: 1px;
    min-width: 16px; height: 16px;
    background: #f5c842;
    color: #0d0d1a;
    font-size: 10px;
    font-weight: 800;
    border-radius: 99px;
    display: flex; align-items: center; justify-content: center;
    padding: 0 3px;
    pointer-events: none;
  }
  /* Dropdown */
  .notif-drop {
    display: none;
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    width: 320px;
    background: #1a1a2e;
    border: 1px solid rgba(255,255,255,.12);
    border-radius: 14px;
    box-shadow: 0 8px 32px rgba(0,0,0,.55);
    z-index: 500;
    overflow: hidden;
  }
  .notif-drop.open { display: block; }
  .notif-drop-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px 10px;
    border-bottom: 1px solid rgba(255,255,255,.08);
  }
  .notif-drop-title { font-size: 13px; font-weight: 700; color: #f0ece4; }
  .notif-read-all-btn {
    background: none; border: none; cursor: pointer;
    font-size: 11px; color: rgba(245,200,66,.8);
    font-family: inherit; padding: 0;
  }
  .notif-read-all-btn:hover { color: #f5c842; }
  .notif-drop-list { max-height: 320px; overflow-y: auto; }
  .notif-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 11px 14px;
    border-bottom: 1px solid rgba(255,255,255,.05);
    cursor: pointer;
    transition: background .12s;
    text-decoration: none;
  }
  .notif-item:last-child { border-bottom: none; }
  .notif-item:hover { background: rgba(255,255,255,.04); }
  .notif-item.unread { background: rgba(245,200,66,.05); }
  .notif-item.unread:hover { background: rgba(245,200,66,.09); }
  .notif-dot {
    width: 7px; height: 7px;
    border-radius: 50%;
    background: #f5c842;
    flex-shrink: 0;
    margin-top: 5px;
  }
  .notif-dot.read { background: transparent; border: 1px solid rgba(255,255,255,.15); }
  .notif-body { flex: 1; min-width: 0; }
  .notif-item-title { font-size: 12px; font-weight: 600; color: #f0ece4; margin-bottom: 2px; }
  .notif-item-body  { font-size: 11px; color: rgba(240,236,228,.5); line-height: 1.4;
                       white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .notif-item-time  { font-size: 10px; color: rgba(240,236,228,.3); margin-top: 3px; }
  .notif-empty {
    text-align: center; padding: 28px 14px;
    font-size: 13px; color: rgba(240,236,228,.35);
  }
  .notif-drop-footer {
    border-top: 1px solid rgba(255,255,255,.08);
    padding: 9px 14px;
    text-align: center;
  }
  .notif-drop-footer a {
    font-size: 12px; color: rgba(245,200,66,.75); text-decoration: none;
  }
  .notif-drop-footer a:hover { color: #f5c842; }
  `;

  // Inject CSS
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  // ── State ────────────────────────────────────────────────────────
  let _open = false;
  let _pollTimer = null;
  let _lastCount = 0;

  // ── Build HTML ───────────────────────────────────────────────────
  function buildBell() {
    const wrap = document.createElement('div');
    wrap.className = 'notif-bell-wrap';
    wrap.id = 'notifBellWrap';
    wrap.innerHTML = `
      <button class="notif-bell-btn" id="notifBellBtn" title="Notifikace">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        <span class="notif-badge" id="notifBadge" style="display:none">0</span>
      </button>
      <div class="notif-drop" id="notifDrop">
        <div class="notif-drop-head">
          <span class="notif-drop-title">🔔 Notifikace</span>
          <button class="notif-read-all-btn" id="notifReadAllBtn">Vše přečteno</button>
        </div>
        <div class="notif-drop-list" id="notifDropList">
          <div class="notif-empty">⏳ Načítám…</div>
        </div>
        <div class="notif-drop-footer">
          <a href="share-album.html">Sdílení alb →</a>
        </div>
      </div>
    `;
    return wrap;
  }

  // ── Insert into nav ──────────────────────────────────────────────
  function insertBell() {
    const token = localStorage.getItem('sb_token');
    if (!token) return; // nepřihlášen

    const topbarRight = document.querySelector('.topbar-right');
    if (!topbarRight || document.getElementById('notifBellWrap')) return;

    const wrap = buildBell();

    // Vlož před chat nebo před user-chip
    const chatWrap = document.getElementById('chatDropWrap');
    const userChip = document.getElementById('userChip');
    if (chatWrap) {
      topbarRight.insertBefore(wrap, chatWrap);
    } else if (userChip) {
      topbarRight.insertBefore(wrap, userChip);
    } else {
      topbarRight.prepend(wrap);
    }

    // Event listeners
    document.getElementById('notifBellBtn').addEventListener('click', toggleDrop);
    document.getElementById('notifReadAllBtn').addEventListener('click', markAllRead);
    document.addEventListener('click', function (e) {
      const w = document.getElementById('notifBellWrap');
      if (w && !w.contains(e.target) && _open) closeDrop();
    });

    // Start polling
    fetchCount();
    _pollTimer = setInterval(fetchCount, 30000);

    // Supabase Realtime (pokud je klient dostupný)
    initRealtime();
  }

  // ── API helpers ──────────────────────────────────────────────────
  function apiHeaders() {
    return {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + localStorage.getItem('sb_token')
    };
  }

  function apiBase() {
    return (typeof VERCEL_URL !== 'undefined' ? VERCEL_URL : '') + '/api/v1';
  }

  async function fetchCount() {
    try {
      const r = await fetch(apiBase() + '/notifications/count', { headers: apiHeaders() });
      if (!r.ok) return;
      const d = await r.json();
      updateBadge(d.unread_count || 0);
    } catch (e) { /* sítová chyba — tiché selhání */ }
  }

  async function fetchNotifications() {
    try {
      const r = await fetch(apiBase() + '/notifications?limit=10', { headers: apiHeaders() });
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d) ? d : (d.notifications || []);
    } catch { return []; }
  }

  async function markRead(id) {
    try {
      await fetch(apiBase() + '/notifications/' + id, {
        method: 'PATCH',
        headers: apiHeaders()
      });
    } catch { /* tichá chyba */ }
  }

  async function markAllRead() {
    try {
      await fetch(apiBase() + '/notifications/read-all', {
        method: 'PATCH',
        headers: apiHeaders()
      });
      updateBadge(0);
      renderList([]);   // přerendruje jako vše přečtené
      fetchNotifications().then(renderList);
    } catch { /* tichá chyba */ }
  }

  // ── UI ───────────────────────────────────────────────────────────
  function updateBadge(count) {
    _lastCount = count;
    const badge = document.getElementById('notifBadge');
    const btn   = document.getElementById('notifBellBtn');
    if (!badge || !btn) return;
    if (count > 0) {
      badge.style.display = 'flex';
      badge.textContent = count > 99 ? '99+' : count;
      btn.classList.add('has-unread');
    } else {
      badge.style.display = 'none';
      btn.classList.remove('has-unread');
    }
  }

  function fmtTime(iso) {
    if (!iso) return '';
    const d = new Date(iso), n = new Date();
    const diff = n - d;
    if (diff < 60000)    return 'teď';
    if (diff < 3600000)  return Math.floor(diff / 60000) + ' min';
    if (d.toDateString() === n.toDateString()) return d.toLocaleTimeString('cs', { hour: '2-digit', minute: '2-digit' });
    const yest = new Date(n); yest.setDate(yest.getDate() - 1);
    if (d.toDateString() === yest.toDateString()) return 'včera';
    return d.toLocaleDateString('cs', { day: 'numeric', month: 'numeric' });
  }

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function renderList(items) {
    const list = document.getElementById('notifDropList');
    if (!list) return;
    if (!items.length) {
      list.innerHTML = '<div class="notif-empty">📭 Žádné notifikace</div>';
      return;
    }
    list.innerHTML = items.map(n => {
      const unread = !n.read_at;
      const href   = n.link || '#';
      return `
        <div class="notif-item ${unread ? 'unread' : ''}"
             data-id="${esc(n.id)}" data-href="${esc(href)}"
             onclick="window._notifClick && window._notifClick(this)">
          <div class="notif-dot ${unread ? '' : 'read'}"></div>
          <div class="notif-body">
            <div class="notif-item-title">${esc(n.title || 'Notifikace')}</div>
            <div class="notif-item-body">${esc(n.body || '')}</div>
            <div class="notif-item-time">${fmtTime(n.created_at)}</div>
          </div>
        </div>
      `;
    }).join('');

    // Global click handler — označí jako přečtenou a přesměruje
    window._notifClick = async function (el) {
      const id   = el.dataset.id;
      const href = el.dataset.href;
      el.classList.remove('unread');
      el.querySelector('.notif-dot').classList.add('read');
      await markRead(id);
      const newCount = Math.max(0, _lastCount - 1);
      updateBadge(newCount);
      if (href && href !== '#') { location.href = href; }
    };
  }

  function toggleDrop() {
    _open ? closeDrop() : openDrop();
  }

  function openDrop() {
    _open = true;
    document.getElementById('notifDrop')?.classList.add('open');
    fetchNotifications().then(renderList);
  }

  function closeDrop() {
    _open = false;
    document.getElementById('notifDrop')?.classList.remove('open');
  }

  // ── Supabase Realtime ────────────────────────────────────────────
  function initRealtime() {
    try {
      // Supabase JS v2 klient musí být dostupný jako window.supabase nebo window._supabaseClient
      const client = window.supabase || window._supabaseClient;
      if (!client) return;
      const userId = localStorage.getItem('sb_user_id');
      if (!userId) return;

      client
        .channel('notif_bell_' + userId)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`
        }, () => {
          fetchCount();
        })
        .subscribe();
    } catch (e) { /* Realtime nedostupné — polling postačí */ }
  }

  // ── Init ─────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', insertBell);
  } else {
    insertBell();
  }

})();
