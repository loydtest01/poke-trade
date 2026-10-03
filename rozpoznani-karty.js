/* ═══════════════════════════════════════════════════════════════
   rozpoznani-karty.js — určení karty z fotky: NEJDŘÍV BEZ AI, AI až jako záloha
   ───────────────────────────────────────────────────────────────
   Stejný postup jako ve frontě (queue.html), jen jako společný modul:
     1. Kolektivní paměť  — fotka, kterou už někdo potvrdil (CardMatcher, cache)
     2. Otisk obrázku     — pHash proti databázi otisků (CardMatcher)
     3. Text / nápověda   — když volající zná jméno/číslo (CardMatcher fuzzy)
     4. AI                — ai-rozpoznani.js, jen když 1–3 nic nenajdou
   Výsledek z AI se pak dohledává bodovacím vyhledáváním (PkSearch) u volajícího.

   PT_ROZPOZNANI.rozpoznej(zdroj, volby) → Promise<{
       zdroj: 'pamet' | 'otisk' | 'text' | 'ai' | 'nic',
       karta: { apiId, name, set, number, imageUrl } | null,   // 1–3
       ai:    výsledek PT_AI.rozpoznejKartu | null,              // 4
       jistota: 0–1, phash, chyba?: text }
     zdroj: URL obrázku nebo dataURL
     volby: { napoveda: {name,set,number,lang,hp}, token, bezAI, minJistota (0.85) }
   PT_ROZPOZNANI.potvrd(phash, apiId) — uživatel potvrdil kartu → učí kolektivní paměť
   Nikdy nevyhodí výjimku.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.PT_ROZPOZNANI) return;

  const _nacitani = {};
  function nactiSkript(src, hotovo) {
    if (hotovo()) return Promise.resolve(true);
    if (_nacitani[src]) return _nacitani[src];
    _nacitani[src] = new Promise(resolve => {
      const sc = document.createElement('script');
      sc.src = src;
      sc.onload  = () => resolve(hotovo());
      sc.onerror = () => { delete _nacitani[src]; resolve(false); };
      document.head.appendChild(sc);
    });
    return _nacitani[src];
  }

  async function naBase64(zdroj) {
    if (typeof zdroj === 'string' && zdroj.startsWith('data:')) {
      const m = zdroj.match(/^data:([^;]+);base64,(.+)$/);
      return m ? { base64: m[2], mimeType: m[1] } : null;
    }
    const blob = await (await fetch(zdroj)).blob();
    return await new Promise((ok, ko) => {
      const r = new FileReader();
      r.onload = () => { const m = String(r.result).match(/^data:([^;]+);base64,(.+)$/); ok(m ? { base64: m[2], mimeType: m[1] } : null); };
      r.onerror = ko;
      r.readAsDataURL(blob);
    });
  }

  async function rozpoznej(zdroj, volby) {
    volby = volby || {};
    const min = volby.minJistota || 0.85;
    const vysledek = { zdroj: 'nic', karta: null, ai: null, jistota: 0, phash: null };

    // ── 1–3: bez AI ──────────────────────────────────────────────
    try {
      const ok = await nactiSkript('/card-matcher.js', () => !!window.CardMatcher);
      if (ok) {
        const m = await window.CardMatcher.match(zdroj, volby.napoveda || {}, { skipGroq: true });
        if (m && m.phash) vysledek.phash = m.phash;
        if (m && m.cardId && m.source !== 'none' && m.confidence >= min) {
          vysledek.zdroj   = { cache: 'pamet', phash: 'otisk', fuzzy: 'text' }[m.source] || m.source;
          vysledek.jistota = m.confidence;
          vysledek.karta   = { apiId: m.cardId, name: m.name || '', set: m.setId || '', number: m.number || '', imageUrl: m.imageUrl || '' };
          return vysledek;
        }
      }
    } catch (e) { console.warn('[rozpoznani] bez AI selhalo:', e && e.message); }

    if (volby.bezAI) return vysledek;

    // ── 4: AI jako záloha ────────────────────────────────────────
    try {
      const ok = await nactiSkript('/ai-rozpoznani.js', () => !!window.PT_AI);
      if (!ok) { vysledek.chyba = 'Modul AI se nenačetl'; return vysledek; }
      const obr = await naBase64(zdroj);
      if (!obr) { vysledek.chyba = 'Fotku se nepodařilo načíst'; return vysledek; }
      const k = await window.PT_AI.rozpoznejKartu(obr.base64, obr.mimeType, { token: volby.token, usage: 'search' });
      vysledek.ai = k;
      if (k.chyba || !k.name) { vysledek.chyba = k.notes || 'AI kartu nerozpoznala'; return vysledek; }
      vysledek.zdroj   = 'ai';
      vysledek.jistota = { high: 0.8, med: 0.6, low: 0.3 }[k.confidence] || 0.5;
    } catch (e) {
      vysledek.chyba = 'Rozpoznání selhalo: ' + (e && e.message ? e.message : e);
    }
    return vysledek;
  }

  async function potvrd(phash, apiId) {
    if (!phash || !apiId || !window.CardMatcher || typeof window.CardMatcher.confirm !== 'function') return;
    try { await window.CardMatcher.confirm(phash, apiId); } catch (e) { console.warn('[rozpoznani] potvrzení:', e && e.message); }
  }

  const POPISKY = { pamet: '🧠 Kolektivní paměť', otisk: '🖼 Shoda podle obrázku', text: '🔤 Shoda podle textu', ai: '🤖 AI', nic: '—' };

  window.PT_ROZPOZNANI = { rozpoznej, potvrd, popisek: z => POPISKY[z] || z };
})();
