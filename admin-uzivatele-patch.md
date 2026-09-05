# Admin panel — záložka „👥 Uživatelé"

Tři úpravy v `admin-loyd.html` + jeden SQL soubor. Celé to jede přes RPC,
takže to **nesahá na `/api/` a nepřidává žádnou serverless funkci.**

Pořadí: nejdřív pusť `admin_user_overview.sql`, pak uprav HTML.

---

## 1) Tlačítko záložky

`admin-loyd.html:255` — najdi:

```html
      <button class="adm-tab" data-tab="vips">⭐ VIP správa</button>
```

Nahraď:

```html
      <button class="adm-tab" data-tab="users">👥 Uživatelé</button>
      <button class="adm-tab" data-tab="vips">⭐ VIP správa</button>
```

---

## 2) Obsah záložky

`admin-loyd.html:297` — najdi konec bloku `tab-signups`:

```html
          <div id="signupsTable" style="margin-top: .8rem"><div class="loading">Načítám…</div></div>
        </div>
      </div>
```

Nahraď:

```html
          <div id="signupsTable" style="margin-top: .8rem"><div class="loading">Načítám…</div></div>
        </div>
      </div>

      <!-- TAB: Uživatelé -->
      <div id="tab-users">
        <div class="adm-section">
          <h3>👥 Přehled uživatelů</h3>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:.8rem">
            <button class="btn btn-sm" onclick="loadUsers()">🔄 Načíst</button>
            <input id="usrFilter" placeholder="Hledat jméno / e-mail…"
                   oninput="renderUsers()"
                   style="flex:1;min-width:180px;padding:7px 11px;border-radius:8px;
                          border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.25);
                          color:var(--text);font-size:13px">
            <label style="font-size:12px;color:var(--muted);display:flex;align-items:center;gap:5px">
              <input type="checkbox" id="usrActiveOnly" onchange="renderUsers()"> jen aktivní
            </label>
            <button class="btn btn-sm" onclick="exportUsersCsv()">⬇️ CSV</button>
          </div>
          <div id="usersSummary" style="margin-bottom:.7rem"></div>
          <div id="usersTable"><div class="loading">Klikni na „Načíst"…</div></div>
        </div>
      </div>
```

---

## 3) Registrace do přepínače záložek

`admin-loyd.html:859` — najdi:

```js
      if (t.dataset.tab === 'clusters') loadClusters();
```

Nahraď:

```js
      if (t.dataset.tab === 'clusters') loadClusters();
      else if (t.dataset.tab === 'users') loadUsers();
```

---

## 4) Logika

Vlož kamkoliv mezi ostatní funkce — třeba hned za `escapeHtml()`:

```js
// ══════════════════════════════════════════════════════════════
// PŘEHLED UŽIVATELŮ
// ══════════════════════════════════════════════════════════════
let _usersData = [];
let _usersSort = { key: 'registrace', dir: -1 };

async function loadUsers() {
  const cont = document.getElementById('usersTable');
  cont.innerHTML = '<div class="loading">Načítám…</div>';
  try {
    _usersData = await sbAdmin('POST', 'rpc/admin_user_overview', {});
    renderUsers();
  } catch (e) {
    cont.innerHTML = `<div class="error">Chyba: ${escapeHtml(e.message)}<br>
      <small>Pustil jsi admin_user_overview.sql?</small></div>`;
  }
}

function sortUsers(key) {
  _usersSort = (_usersSort.key === key)
    ? { key, dir: -_usersSort.dir }
    : { key, dir: -1 };
  renderUsers();
}

function renderUsers() {
  const cont = document.getElementById('usersTable');
  const q    = (document.getElementById('usrFilter')?.value || '').toLowerCase().trim();
  const only = document.getElementById('usrActiveOnly')?.checked;

  let rows = _usersData.slice();
  if (q)    rows = rows.filter(u => (u.username || '').toLowerCase().includes(q)
                                 || (u.email    || '').toLowerCase().includes(q));
  if (only) rows = rows.filter(u => u.fotek_nahranych > 0 || u.karet_v_albu > 0);

  const k = _usersSort.key, d = _usersSort.dir;
  rows.sort((a, b) => {
    const va = a[k], vb = b[k];
    if (typeof va === 'string') return va.localeCompare(vb || '') * d;
    return ((va ?? 0) - (vb ?? 0)) * d;
  });

  // Souhrn
  const sum = (f) => _usersData.reduce((s, u) => s + Number(u[f] || 0), 0);
  document.getElementById('usersSummary').innerHTML =
    `<div style="display:flex;gap:18px;flex-wrap:wrap;font-size:12.5px;color:var(--muted)">
       <span><b style="color:var(--text)">${_usersData.length}</b> uživatelů</span>
       <span><b style="color:var(--text)">${_usersData.filter(u => u.fotek_nahranych > 0).length}</b> něco nahrálo</span>
       <span><b style="color:var(--text)">${sum('fotek_nahranych')}</b> fotek celkem</span>
       <span><b style="color:var(--text)">${sum('prodano')}</b> prodejů
             (${sum('prodano_czk').toLocaleString('cs')} Kč)</span>
     </div>`;

  if (!rows.length) { cont.innerHTML = '<div class="empty">Nic nenalezeno.</div>'; return; }

  const th = (label, key, title) =>
    `<th style="cursor:pointer;white-space:nowrap" onclick="sortUsers('${key}')"
         ${title ? `title="${title}"` : ''}>${label}${_usersSort.key === key ? (_usersSort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;

  let html = '<div style="overflow-x:auto"><table><thead><tr>' +
    th('Uživatel', 'username') +
    th('Registrace', 'registrace') +
    th('📸 Fotek', 'fotek_nahranych', 'Nahráno celkem do fronty') +
    th('⏳ Čeká', 'fotek_ceka', 'Nezpracované fotky ve frontě') +
    th('🎴 Karet', 'karet_v_albu') +
    th('🏷 K prodeji', 'k_prodeji', 'Aktivní + rezervované inzeráty') +
    th('💰 Prodal', 'prodano') +
    th('🛒 Koupil', 'koupeno') +
    th('Naposledy', 'posledni_aktivita') +
    '<th>Stav</th></tr></thead><tbody>';

  const dt = (v) => v ? new Date(v).toLocaleDateString('cs-CZ') : '–';
  const num = (v, hi) => `<td style="text-align:right${Number(v) > 0 && hi ? ';color:var(--text);font-weight:600' : ';color:var(--muted)'}">${Number(v || 0)}</td>`;

  rows.forEach(u => {
    const dead = !u.fotek_nahranych && !u.karet_v_albu;
    html += `<tr style="${dead ? 'opacity:.5' : ''}">
      <td><a href="profile.html?user=${u.user_id}" style="color:var(--text)">${escapeHtml(u.username || '–')}</a>
          <div style="font-size:10.5px;color:var(--muted)">${escapeHtml(u.email || '')}</div></td>
      <td style="white-space:nowrap">${dt(u.registrace)}
          <div style="font-size:10.5px;color:var(--muted)">před ${u.dni_od_registrace} dny</div></td>
      ${num(u.fotek_nahranych, true)}
      ${num(u.fotek_ceka)}
      ${num(u.karet_v_albu, true)}
      ${num(u.k_prodeji, true)}
      <td style="text-align:right">${Number(u.prodano || 0)}
          ${Number(u.prodano_czk) > 0 ? `<div style="font-size:10.5px;color:var(--muted)">${Number(u.prodano_czk).toLocaleString('cs')} Kč</div>` : ''}</td>
      <td style="text-align:right">${Number(u.koupeno || 0)}
          ${Number(u.koupeno_czk) > 0 ? `<div style="font-size:10.5px;color:var(--muted)">${Number(u.koupeno_czk).toLocaleString('cs')} Kč</div>` : ''}</td>
      <td style="white-space:nowrap;font-size:12px">${dt(u.posledni_aktivita)}</td>
      <td>${u.je_banned ? '<span class="badge badge-high">BAN</span>'
            : u.je_vip ? '<span class="badge badge-vip">VIP</span>'
            : '<span class="badge badge-ok">OK</span>'}</td>
    </tr>`;
  });

  cont.innerHTML = html + '</tbody></table></div>';
}

function exportUsersCsv() {
  if (!_usersData.length) return;
  const cols = ['username','email','registrace','fotek_nahranych','fotek_ceka',
                'karet_v_albu','k_prodeji','prodano','prodano_czk','koupeno',
                'koupeno_czk','posledni_aktivita'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.join(';')]
    .concat(_usersData.map(u => cols.map(c => esc(u[c])).join(';')))
    .join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `poketrade-uzivatele-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
```

---

## Co uvidíš

Jeden řádek na uživatele: jméno + e-mail, datum registrace („před X dny"),
nahrané fotky, kolik jich ještě čeká ve frontě, karty v albu, aktivní
inzeráty, prodeje a nákupy včetně obratu v Kč, poslední aktivita a stav
(OK / VIP / BAN).

Kliknutím na hlavičku se řadí, nahoře je souhrn („kolik uživatelů vůbec
něco nahrálo") a tlačítko na CSV. Uživatelé, kteří nenahráli vůbec nic,
jsou ztlumení — přesně ti, o kterých potřebuješ vědět.

## Kdyby SQL spadlo

Nejpravděpodobnější chyba je `column ... does not exist` — schéma tabulek
nemám, sloupce (`is_banned`, `vip_until`, `price_czk`, `listings.status`)
jsem odvodil z frontend kódu. Dole v SQL souboru je zakomentovaný dotaz na
skutečné sloupce; podle něj chybějící řádek z funkce vyhoď a pusť znovu.
