/* ═══════════════════════════════════════════════════════════════
   demo-karty.js — ukázka pro nepřihlášené návštěvníky
   ───────────────────────────────────────────────────────────────
   Stránky jen pro přihlášené místo vyhození na přihlášení ukážou,
   co umí: buď s ukázkovými daty (statistiky), nebo přívětivou výzvou
   s náhledem karet. Karty jsou označené DEMO a nikam se neukládají.

   PT_DEMO.karty            — 9 ukázkových karet
   PT_DEMO.radky()          — karty ve tvaru řádků user_cards (pro grafy)
   PT_DEMO.lista(el, text, navrat)          — lišta „Ukázka" nahoru do el
   PT_DEMO.vyzva(el, { ikona, titulek, popis, vyhody, navrat })
                            — celá stránka: výzva + náhled karet + tlačítka
   navrat = stránka, kam se po přihlášení vrátit (např. 'statistiky.html')
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.PT_DEMO) return;

  var T = 'https://assets.tcgdex.net/en/';
  // mesicu = před kolika měsíci karta „přibyla" (pro graf vývoje sbírky)
  var karty = [
    { name: 'Umbreon VMAX', set: 'Evolving Skies', number: '215/203', supertype: 'Pokémon', types: ['Darkness'],  p30d: 890, img: T + 'swsh/swsh7/215', stitek: '⭐ Alt Art',    mesicu: 1 },
    { name: 'Charizard',    set: 'Base Set',       number: '4/102',   supertype: 'Pokémon', types: ['Fire'],      p30d: 420, img: T + 'base/base1/4',   stitek: '🔄 K výměně',  mesicu: 5 },
    { name: 'Blastoise',    set: 'Base Set',       number: '2/102',   supertype: 'Pokémon', types: ['Water'],     p30d: 165, img: T + 'base/base1/2',   stitek: '',             mesicu: 5 },
    { name: 'Charizard ex', set: '151',            number: '199/165', supertype: 'Pokémon', types: ['Fire'],      p30d: 118, img: T + 'sv/sv03.5/199',  stitek: '💶 Na prodej', mesicu: 2 },
    { name: 'Mewtwo',       set: 'Base Set',       number: '10/102',  supertype: 'Pokémon', types: ['Psychic'],   p30d: 58,  img: T + 'base/base1/10',  stitek: '',             mesicu: 4 },
    { name: 'Mew ex',       set: '151',            number: '151/165', supertype: 'Pokémon', types: ['Psychic'],   p30d: 6.5, img: T + 'sv/sv03.5/151',  stitek: '🔄 K výměně',  mesicu: 2 },
    { name: 'Pikachu',      set: 'Base Set',       number: '58/102',  supertype: 'Pokémon', types: ['Lightning'], p30d: 3.2, img: T + 'base/base1/58',  stitek: '',             mesicu: 6 },
    { name: 'Bill',         set: 'Base Set',       number: '91/102',  supertype: 'Trainer', types: [],            p30d: 1.4, img: T + 'base/base1/91',  stitek: '',             mesicu: 3 },
    { name: 'Fire Energy',  set: 'Base Set',       number: '98/102',  supertype: 'Energy',  types: [],            p30d: 0.6, img: T + 'base/base1/98',  stitek: '',             mesicu: 3 },
  ];

  function radky() {
    var ted = new Date();
    return karty.map(function (k, i) {
      var d = new Date(ted.getFullYear(), ted.getMonth() - k.mesicu, 3 + i * 2);
      return {
        local_id: 'demo-' + (i + 1),
        created_at: d.toISOString(),
        card_data: { name: k.name, set: k.set, number: k.number, supertype: k.supertype, types: k.types,
                     p30d: k.p30d, pTrend: k.p30d, count: 1, apiSmall: k.img + '/low.webp', _demo: true }
      };
    });
  }

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function odkazPrihlaseni(navrat) {
    return 'login.html' + (navrat ? '?return=' + encodeURIComponent(navrat) : '');
  }

  var cssVlozeno = false;
  function css() {
    if (cssVlozeno) return;
    cssVlozeno = true;
    var s = document.createElement('style');
    s.textContent =
      '.ptd-lista{display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:space-between;' +
        'background:rgba(250,204,21,.08);border:1px solid rgba(250,204,21,.3);border-radius:14px;padding:12px 16px;margin:0 0 16px;' +
        'font-size:13px;color:var(--text2,#cbd5e1)}' +
      '.ptd-lista b{color:var(--text,#f3f4f6)}' +
      '.ptd-lista a{color:var(--text2,#cbd5e1);font-size:13px}' +
      '.ptd-vyzva{max-width:760px;margin:24px auto;padding:8px 4px 32px;text-align:center}' +
      '.ptd-ikona{font-size:46px;margin-bottom:6px}' +
      '.ptd-vyzva h2{font-family:Unbounded,sans-serif;font-weight:800;font-size:20px;color:var(--text,#f3f4f6);margin:0 0 8px}' +
      '.ptd-popis{font-size:14px;color:var(--text2,#cbd5e1);margin:0 auto 20px;max-width:560px;line-height:1.55}' +
      '.ptd-karty{display:flex;justify-content:center;gap:12px;margin:0 0 20px;flex-wrap:wrap}' +
      '.ptd-karta{position:relative;width:110px;aspect-ratio:63/88;border-radius:8px;overflow:hidden;' +
        'background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08)}' +
      '.ptd-karta img{width:100%;height:100%;object-fit:cover;display:block}' +
      '.ptd-nahrada{width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:6px;' +
        'font-family:Unbounded,sans-serif;font-weight:800;font-size:12px;color:var(--text2,#cbd5e1)}' +
      '.ptd-razitko{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-28deg);' +
        'font-family:Unbounded,sans-serif;font-weight:900;font-size:15px;letter-spacing:2px;color:rgba(255,255,255,.9);' +
        'border:2px solid rgba(239,68,68,.85);background:rgba(239,68,68,.55);padding:1px 8px;border-radius:6px;' +
        'text-shadow:0 1px 3px rgba(0,0,0,.6);pointer-events:none;white-space:nowrap}' +
      '.ptd-vyhody{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px 16px;' +
        'margin:0 auto 20px;max-width:620px;font-size:13px;color:var(--text2,#cbd5e1);text-align:left}' +
      '.ptd-tlacitka{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}' +
      '.ptd-btn{display:inline-block;padding:10px 18px;border-radius:10px;font-weight:700;text-decoration:none;font-size:14px}' +
      '.ptd-btn-hl{background:#facc15;color:#111}' +
      '.ptd-btn-ved{border:1px solid rgba(255,255,255,.2);color:var(--text,#f3f4f6)}';
    document.head.appendChild(s);
  }

  function lista(el, text, navrat) {
    if (!el) return;
    css();
    var d = document.createElement('div');
    d.className = 'ptd-lista';
    d.innerHTML = '<span>👀 <b>Ukázka</b> — ' + esc(text) + ' Karty i čísla jsou jen ukázkové.</span>' +
      '<a href="' + odkazPrihlaseni(navrat) + '">Přihlásit se →</a>';
    el.insertBefore(d, el.firstChild);
  }

  function nahledKaret(pocet) {
    return karty.slice(0, pocet || 4).map(function (k) {
      return '<div class="ptd-karta"><img src="' + k.img + '/low.webp" alt="' + esc(k.name) + '" loading="lazy" ' +
        'onerror="this.replaceWith(Object.assign(document.createElement(\'div\'),{className:\'ptd-nahrada\',textContent:\'' +
        esc(k.name).replace(/'/g, '') + '\'}))"><div class="ptd-razitko">DEMO</div></div>';
    }).join('');
  }

  function vyzva(el, o) {
    if (!el) return;
    o = o || {};
    css();
    el.style.display = '';
    el.innerHTML =
      '<div class="ptd-vyzva">' +
        '<div class="ptd-ikona">' + esc(o.ikona || '🔐') + '</div>' +
        '<h2>' + esc(o.titulek || 'Tahle stránka je pro přihlášené') + '</h2>' +
        '<p class="ptd-popis">' + esc(o.popis || '') + '</p>' +
        '<div class="ptd-karty">' + nahledKaret(4) + '</div>' +
        (o.vyhody && o.vyhody.length
          ? '<div class="ptd-vyhody">' + o.vyhody.map(function (v) { return '<div>' + esc(v) + '</div>'; }).join('') + '</div>'
          : '') +
        '<div class="ptd-tlacitka">' +
          '<a class="ptd-btn ptd-btn-hl" href="register.html">Založit účet zdarma →</a>' +
          '<a class="ptd-btn ptd-btn-ved" href="' + odkazPrihlaseni(o.navrat) + '">Přihlásit se</a>' +
        '</div>' +
      '</div>';
  }

  window.PT_DEMO = { karty: karty, radky: radky, lista: lista, vyzva: vyzva };
})();
