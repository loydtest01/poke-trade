/* ═══════════════════════════════════════════════════════════════
   ai-rozpoznani.js — společné rozpoznání Pokémon karty z fotky přes AI
   ───────────────────────────────────────────────────────────────
   Jedno zadání a jedno zpracování odpovědi pro všechna místa webu
   (dřív 6 různých verzí). Volá /api/groq (server vybere funkční model).

   PT_AI.rozpoznejKartu(base64, mimeType, volby) → Promise<karta>
     volby: { token, model, stav (true = i stav karty), usage }
     karta: { name, nameEN, lang, number, setName, setCode, rarity,
              supertype, subtype, hp, condition, conditionReason,
              confidence: 'high'|'med'|'low', notes, chyba? }
   Nikdy nevyhodí výjimku — při chybě vrátí confidence 'low' a chyba: true.

   PT_AI.precti(text) — zpracuje surovou odpověď modelu (pro testy)
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.PT_AI) return;

  var VYCHOZI_MODEL = 'qwen/qwen3.6-27b';
  var JAZYKY = ['EN', 'JP', 'DE', 'FR', 'IT', 'ES', 'PT', 'KO', 'ZH'];

  function zadani(stav) {
    return 'You are a Pokémon TCG card recognition expert. Analyze this card image and extract:\n' +
      '1. Name EXACTLY as printed on the card (in the card\'s own language), including symbols like ★, δ, ex, V, VMAX, GX\n' +
      '2. The English name of the card\n' +
      '3. Language of the printed text: EN, JP, DE, FR, IT, ES, PT, KO or ZH. Judge by the printed text itself, ' +
        'not by the Pokémon\'s English name. Japanese has kana/kanji, Korean has hangul, Chinese has only hanzi.\n' +
      '4. Card number exactly as printed, bottom of the card (e.g. "025/198", "SV001", "TG05/TG30")\n' +
      '5. Set name in English (e.g. "Paldea Evolved", "Evolving Skies") and set code if visible (e.g. "PAL", "EVS")\n' +
      '6. Rarity (Common, Uncommon, Rare, Holo Rare, Ultra Rare, Illustration Rare, Special Illustration Rare, ...)\n' +
      '7. Supertype (Pokémon, Trainer or Energy) and subtype (Basic, Stage 1, V, VMAX, ex, GX, Item, Supporter, ...)\n' +
      '8. HP if visible\n' +
      (stav ? '9. Physical condition: NM, LP, MP, HP or DMG, with a short reason\n' : '') +
      '\nRespond ONLY with one JSON object, no explanation, no markdown:\n' +
      '{"name":"...","nameEN":"...","lang":"EN","number":"...","setName":"...","setCode":"...",' +
      '"rarity":"...","supertype":"Pokémon","subtype":"...","hp":"...",' +
      (stav ? '"condition":"NM","conditionReason":"...",' : '') +
      '"confidence":"high|med|low","notes":"any uncertainty"}\n\n' +
      'If you cannot identify the card at all, return {"confidence":"low","name":"","notes":"reason"}';
  }

  // ── Odolné čtení odpovědi modelu ─────────────────────────────────
  function najdiJson(text) {
    var t = String(text || '');
    t = t.replace(/<think>[\s\S]*?<\/think>/gi, '');      // „přemýšlení" qwen3 apod.
    t = t.replace(/```(?:json)?/gi, '');
    // první vyvážený blok {...}
    var start = t.indexOf('{');
    while (start !== -1) {
      var hloubka = 0, vRetezci = false, unik = false;
      for (var i = start; i < t.length; i++) {
        var ch = t[i];
        if (vRetezci) {
          if (unik) unik = false;
          else if (ch === '\\') unik = true;
          else if (ch === '"') vRetezci = false;
          continue;
        }
        if (ch === '"') vRetezci = true;
        else if (ch === '{') hloubka++;
        else if (ch === '}') { hloubka--; if (hloubka === 0) return t.slice(start, i + 1); }
      }
      start = t.indexOf('{', start + 1);
    }
    return null;
  }

  function rozparsuj(kus) {
    try { return JSON.parse(kus); } catch (e) {}
    try {                                                   // běžné chyby modelů
      return JSON.parse(kus
        .replace(/,\s*([}\]])/g, '$1')                      // čárka před }
        .replace(/[\u201C\u201D]/g, '"'));                  // typografické uvozovky
    } catch (e) { return null; }
  }

  function text(v) { return v == null ? '' : String(v).trim(); }

  function normalizuj(o) {
    var lang = text(o.lang || o.language).toUpperCase();
    if (lang === 'JA' || lang === 'JPN') lang = 'JP';
    if (lang === 'KR') lang = 'KO';
    if (lang === 'CN' || lang === 'ZH-TW' || lang === 'ZH-CN') lang = 'ZH';
    if (JAZYKY.indexOf(lang) === -1) lang = '';   // neznámý jazyk raději prázdný než špatný
    var jistota = text(o.confidence).toLowerCase();
    if (jistota === 'medium' || jistota === 'mid') jistota = 'med';
    if (['high', 'med', 'low'].indexOf(jistota) === -1) jistota = text(o.name) ? 'med' : 'low';
    var supertype = text(o.supertype || o.type);
    if (/^pok/i.test(supertype)) supertype = 'Pokémon';
    else if (/^trainer|^trenér/i.test(supertype)) supertype = 'Trainer';
    else if (/^energ/i.test(supertype)) supertype = 'Energy';
    var hp = text(o.hp).replace(/[^0-9]/g, '');
    return {
      name: text(o.name || o.cardName),
      nameEN: text(o.nameEN || o.name_en || o.englishName) || text(o.name || o.cardName),
      lang: lang,
      number: text(o.number || o.cardNumber),
      setName: text(o.setName || o.set || o.set_name),
      setCode: text(o.setCode || o.set_code),
      rarity: text(o.rarity),
      supertype: supertype,
      subtype: text(o.subtype),
      hp: hp,
      condition: text(o.condition).toUpperCase(),
      conditionReason: text(o.conditionReason || o.condition_reason),
      confidence: jistota,
      notes: text(o.notes),
    };
  }

  function precti(odpoved) {
    var kus = najdiJson(odpoved);
    var o = kus ? rozparsuj(kus) : null;
    if (!o || typeof o !== 'object') {
      return { name: '', nameEN: '', lang: '', number: '', setName: '', setCode: '', rarity: '', supertype: '',
               subtype: '', hp: '', condition: '', conditionReason: '', confidence: 'low',
               notes: 'AI vrátila nečitelnou odpověď', chyba: true };
    }
    return normalizuj(o);
  }

  function chybnaKarta(zprava) {
    var k = precti('');
    k.notes = zprava; k.chyba = true;
    return k;
  }

  async function rozpoznejKartu(base64, mimeType, volby) {
    volby = volby || {};
    try {
      var hlavicky = { 'Content-Type': 'application/json' };
      if (volby.token) hlavicky.Authorization = 'Bearer ' + volby.token;
      var res = await fetch('/api/groq', {
        method: 'POST',
        headers: hlavicky,
        body: JSON.stringify({
          model: volby.model || VYCHOZI_MODEL,
          max_tokens: volby.stav ? 500 : 400,
          usage_type: volby.usage || 'search',
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: 'data:' + (mimeType || 'image/jpeg') + ';base64,' + base64 } },
              { type: 'text', text: zadani(!!volby.stav) },
            ],
          }],
        }),
      });
      if (!res.ok) {
        var k = chybnaKarta(res.status === 429 ? 'Vyčerpaný denní limit AI' : 'AI služba vrátila chybu ' + res.status);
        k.status = res.status;
        return k;
      }
      var data = await res.json();
      var obsah = data && data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content : '';
      if (Array.isArray(obsah)) obsah = obsah.map(function (c) { return c.text || ''; }).join('');
      return precti(obsah);
    } catch (e) {
      return chybnaKarta('Rozpoznání selhalo: ' + (e && e.message ? e.message : e));
    }
  }

  window.PT_AI = { rozpoznejKartu: rozpoznejKartu, precti: precti, zadani: zadani };
})();
