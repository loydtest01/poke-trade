/* ══════════════════════════════════════════════════════════════
   demo-cards.js — tři ukázkové karty pro nového uživatele
   ------------------------------------------------------------
   • Spustí se jen když má uživatel 0 karet a ještě to neproběhlo
   • Karty se tahají z tvojí PokéDB, takže mají skutečná data i obrázky
   • Označené "_demo": true → nejdou prodat (hlídá DB trigger),
     nepočítají se do hodnoty sbírky a jdou smazat jedním klikem

   Použití v moje-album.html, za načtení alba:
     <script src="demo-cards.js"></script>
     …
     await DemoCards.seedIfEmpty();     // založí
     DemoCards.renderBanner();          // lišta s "Odstranit ukázky"
══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const POKEDB   = 'https://pokedb-api.poketrade.workers.dev/v1';
  const FLAG_KEY = 'pkc_demo_seeded';
  const MAIN_ALBUM = 'main';

  // Tři karty, které vypadají dobře a každý je zná.
  const PICKS = [
    { q: 'Charizard', lang: 'en' },
    { q: 'Pikachu',   lang: 'en' },
    { q: 'Mewtwo',    lang: 'en' },
  ];

  function token() { return localStorage.getItem('sb_token') || ''; }

  function uid() {
    try { return JSON.parse(atob(token().split('.')[1])).sub || ''; }
    catch { return ''; }
  }

  async function sb(path, method = 'GET', body = null) {
    const opts = {
      method,
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: 'Bearer ' + token(),
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
    };
    if (body) opts.body = JSON.stringify(body);
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, opts);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.status === 204 ? null : r.json();
  }

  // ── Načti jednu hezkou kartu z PokéDB ────────────────────────
  async function fetchDemoCard(pick) {
    const p = new URLSearchParams({ q: pick.q, lang: pick.lang, limit: '5' });
    const r = await fetch(`${POKEDB}/cards?${p}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const d = await r.json();
    // Ber jen kartu, která má obrázek — jinak by demo vypadalo hůř než prázdno
    const c = (d.data || []).find(x => x.image_url || x.image_thumb_url);
    if (!c) return null;
    return {
      _demo:      true,
      id:         c.id,
      apiId:      c.id,
      name:       c.name,
      nameEN:     c.name_en || c.name,
      number:     c.number,
      hp:         c.hp,
      types:      c.types || [],
      rarity:     c.rarity,
      supertype:  c.supertype,
      set:        c.set_name || '',
      setId:      c.set_id || '',
      lang:       c.lang || 'en',
      images:     { small: c.image_thumb_url || c.image_url, large: c.image_url || c.image_thumb_url },
      imageUrl:   c.image_url || c.image_thumb_url,
      condition:  'NM',
    };
  }

  // ── Založ demo karty, pokud je album prázdné ─────────────────
  async function seedIfEmpty() {
    const userId = uid();
    if (!userId) return { skipped: 'nepřihlášen' };
    if (localStorage.getItem(FLAG_KEY + '_' + userId) === '1') return { skipped: 'už proběhlo' };

    // Má už nějakou kartu? Pak demo nechceme.
    const existing = await sb(`user_cards?user_id=eq.${userId}&select=local_id&limit=1`).catch(() => null);
    if (existing === null) return { skipped: 'chyba čtení' };
    if (existing.length) {
      localStorage.setItem(FLAG_KEY + '_' + userId, '1');
      return { skipped: 'už má karty' };
    }

    const cards = (await Promise.all(PICKS.map(fetchDemoCard))).filter(Boolean);
    if (!cards.length) return { skipped: 'PokéDB nevrátila nic' };

    const rows = cards.map((c, i) => ({
      user_id:   userId,
      local_id:  `demo_${i + 1}_${Date.now().toString(36)}`,
      card_data: c,
      for_trade: false,
      for_sell:  false,
    }));

    await sb('user_cards', 'POST', rows);

    // Zařaď je do Hlavního alba
    const albums = await sb(`user_albums?user_id=eq.${userId}&id=eq.${MAIN_ALBUM}&select=card_ids`).catch(() => []);
    if (albums.length) {
      const ids = [...(albums[0].card_ids || []), ...rows.map(r => r.local_id)];
      await sb(`user_albums?user_id=eq.${userId}&id=eq.${MAIN_ALBUM}`, 'PATCH',
        { card_ids: ids, updated_at: new Date().toISOString() }).catch(() => {});
    }

    localStorage.setItem(FLAG_KEY + '_' + userId, '1');
    return { created: rows.length };
  }

  // ── Lišta "tohle jsou jen ukázky" ────────────────────────────
  function renderBanner(containerId = 'demoBanner') {
    let el = document.getElementById(containerId);
    if (!el) {
      el = document.createElement('div');
      el.id = containerId;
      const grid = document.getElementById('cardsGrid');
      if (grid && grid.parentNode) grid.parentNode.insertBefore(el, grid);
      else document.body.appendChild(el);
    }
    el.innerHTML =
      '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;' +
      'background:rgba(245,200,66,.08);border:1px solid rgba(245,200,66,.22);' +
      'border-radius:12px;padding:12px 14px;margin-bottom:14px;font-size:13px;' +
      'color:rgba(240,236,228,.72)">' +
        '<span style="font-size:18px">👋</span>' +
        '<div style="flex:1;min-width:180px;line-height:1.5">' +
          '<b style="color:#f5c842">Tohle jsou ukázkové karty.</b> ' +
          'Ať vidíš, jak album vypadá. Nepočítají se do hodnoty sbírky ' +
          'a nejdou prodat.' +
        '</div>' +
        '<a href="scanner.html" style="background:#f5c842;color:#1a1712;font-weight:600;' +
        'font-size:12.5px;padding:8px 14px;border-radius:8px;text-decoration:none;' +
        'white-space:nowrap">📷 Přidat vlastní</a>' +
        '<button onclick="DemoCards.removeAll()" style="background:transparent;' +
        'border:1px solid rgba(255,255,255,.16);color:rgba(240,236,228,.55);' +
        'font-size:12.5px;padding:8px 14px;border-radius:8px;cursor:pointer;' +
        'font-family:inherit;white-space:nowrap">Odstranit ukázky</button>' +
      '</div>';
  }

  function hideBanner(containerId = 'demoBanner') {
    const el = document.getElementById(containerId);
    if (el) el.remove();
  }

  // ── Smazání všech demo karet ─────────────────────────────────
  async function removeAll() {
    const userId = uid();
    if (!userId) return;

    const rows = await sb(`user_cards?user_id=eq.${userId}&select=local_id,card_data`).catch(() => []);
    const demoIds = rows.filter(r => r.card_data && r.card_data._demo === true)
                        .map(r => r.local_id);
    if (!demoIds.length) { hideBanner(); return; }

    const list = demoIds.map(encodeURIComponent).join(',');
    await sb(`user_cards?user_id=eq.${userId}&local_id=in.(${list})`, 'DELETE').catch(() => {});

    const albums = await sb(`user_albums?user_id=eq.${userId}&select=id,card_ids`).catch(() => []);
    for (const a of albums) {
      const kept = (a.card_ids || []).filter(id => !demoIds.includes(id));
      if (kept.length !== (a.card_ids || []).length) {
        await sb(`user_albums?user_id=eq.${userId}&id=eq.${encodeURIComponent(a.id)}`, 'PATCH',
          { card_ids: kept, updated_at: new Date().toISOString() }).catch(() => {});
      }
    }

    hideBanner();
    if (typeof loadAlbum === 'function') loadAlbum();
    else if (typeof render === 'function') render();
    else location.reload();
  }

  /** Je karta ukázková? Použij ve statistikách i všude, kde se počítá hodnota. */
  function isDemo(card) {
    const d = card?.card_data || card || {};
    return d._demo === true;
  }

  /** Kolik ukázkových karet uživatel ještě má (pro zobrazení lišty). */
  function countIn(cards) {
    return (cards || []).filter(isDemo).length;
  }

  global.DemoCards = { seedIfEmpty, renderBanner, hideBanner, removeAll, isDemo, countIn };

})(typeof window !== 'undefined' ? window : globalThis);
