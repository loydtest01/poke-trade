/* ══════════════════════════════════════════════════════════════
   card-vision.js — detekce karty ve fotce, narovnání a otisk
   ------------------------------------------------------------
   Sdílené mezi mobilem (režim stojanu) a testem hash-test-tcgdex.html,
   ať se detekce nevyvíjí na dvou místech zvlášť.

   Veřejné rozhraní (window.CardVision):
     detekuj(zdroj)            → { ok, jistota, rohy:[{x,y}×4], info }
                                  zdroj = <img>, <canvas> nebo <video>
     narovnej(zdroj, rohy, w, h, kvalitne)
                               → <canvas> s narovnanou kartou w×h
     otisk(canvas)             → { jemny, art, cela, jmeno, spod } (BigInt)
     vzdalenost(a, b)          → počet rozdílných bitů
     ostrost(canvas)           → rozptyl Laplaciánu (vyšší = ostřejší)
     nastavLog(fn)             → kam posílat diagnostické zprávy
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.CardVision) return;

  let _logFn = null;
  function _log(m) { try { if (_logFn) _logFn(m); } catch (_) {} }
  const _sirka = o => o.naturalWidth || o.videoWidth || o.width || 0;
  const _vyska = o => o.naturalHeight || o.videoHeight || o.height || 0;
  const _cvHash = document.createElement('canvas');

  // Výřezy stejné jako v testovacím nástroji
  const ART        = { x: 0.07, y: 0.10, w: 0.86, h: 0.45 };
  const TEXT_JMENO = { x: 0.04, y: 0.025, w: 0.72, h: 0.075 };
  const TEXT_SPOD  = { x: 0.05, y: 0.56,  w: 0.90, h: 0.33 };

function detekujKartu(obr) {
  const MAX = 400;
  const k = Math.min(1, MAX / Math.max(_sirka(obr), _vyska(obr)));
  const W = Math.max(2, Math.round(_sirka(obr) * k));
  const H = Math.max(2, Math.round(_vyska(obr) * k));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(obr, 0, 0, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  _log(`--- DETEKCE: fotka ${_sirka(obr)}×${_vyska(obr)}, zpracovávám ve ${W}×${H}`);

  // 2) Pozadí odhadneme z ROHŮ fotky, ne z celého okraje.
  //    Když karta vyplní skoro celou šířku, okrajový pás vlevo a vpravo
  //    zasáhne rámeček i ilustraci a odhad pozadí se rozhodí. Rohy fotky
  //    bývají volné i tehdy. Ze 4 rohů vezmeme medián, takže jeden
  //    zakrytý roh výsledek nerozbije.
  const p = Math.max(3, Math.round(Math.min(W, H) * 0.08));
  const rohyPatch = [[0, 0], [W - p, 0], [0, H - p], [W - p, H - p]];
  const med = a => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
  const medRohu = rohyPatch.map(([x0, y0]) => {
    const r = [], g = [], b = [];
    for (let y = y0; y < y0 + p; y++) for (let x = x0; x < x0 + p; x++) {
      const i = (y * W + x) * 4; r.push(px[i]); g.push(px[i + 1]); b.push(px[i + 2]);
    }
    return [med(r), med(g), med(b)];
  });
  const bR = med(medRohu.map(c => c[0])), bG = med(medRohu.map(c => c[1])), bB = med(medRohu.map(c => c[2]));
  _log(`pozadí z rohů: rgb(${bR},${bG},${bB}); jednotlivé rohy: ` + medRohu.map(c => `(${c.join(',')})`).join(' '));

  // 3) Odlišnost od pozadí + rozmazání 5×5 (potlačí kresbu dřeva)
  const d = new Float32Array(W * H);
  for (let i = 0, q = 0; i < d.length; i++, q += 4)
    d[i] = Math.abs(px[q] - bR) + Math.abs(px[q + 1] - bG) + Math.abs(px[q + 2] - bB);
  const ds = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < W && yy >= 0 && yy < H) { s += d[yy * W + xx]; n++; }
    }
    ds[y * W + x] = s / n;
  }

  // Práh podle šumu pozadí: medián + násobek MAD (robustní rozptyl),
  // měřeno jen v rozích. Cokoli výrazně nad kolísáním stolu = karta.
  const vzorky = [];
  for (const [x0, y0] of rohyPatch)
    for (let y = y0; y < y0 + p; y++) for (let x = x0; x < x0 + p; x++) vzorky.push(ds[y * W + x]);
  const mS = med(vzorky);
  const mad = med(vzorky.map(v => Math.abs(v - mS))) * 1.4826;
  const prah = Math.max(mS + Math.max(mad, 3) * 4.5, 15);
  const maska = new Uint8Array(W * H);
  let pokryti = 0;
  for (let i = 0; i < ds.length; i++) { maska[i] = ds[i] > prah ? 1 : 0; pokryti += maska[i]; }
  _log(`šum pozadí: medián ${mS.toFixed(1)}, MAD ${mad.toFixed(1)} → práh ${prah.toFixed(1)}; ` +
    `nad prahem ${(pokryti / ds.length * 100).toFixed(0)} % fotky`);

  // 4) Největší souvislá oblast (BFS)
  const oznac = new Int32Array(W * H).fill(-1);
  let nejId = -1, nejVel = 0, id = 0;
  const fronta = new Int32Array(W * H);
  for (let start = 0; start < maska.length; start++) {
    if (!maska[start] || oznac[start] !== -1) continue;
    let hl = 0, ko = 0, vel = 0;
    fronta[ko++] = start; oznac[start] = id;
    while (hl < ko) {
      const i = fronta[hl++]; vel++;
      const x = i % W, y = (i / W) | 0;
      const sous = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const n of sous) if (n >= 0 && maska[n] && oznac[n] === -1) { oznac[n] = id; fronta[ko++] = n; }
    }
    if (vel > nejVel) { nejVel = vel; nejId = id; }
    id++;
  }
  _log(`souvislých oblastí: ${id}, největší ${nejVel} px = ${(nejVel / (W * H) * 100).toFixed(1)} % fotky`);
  if (nejId < 0 || nejVel < W * H * 0.06) {
    _log(`✗ největší oblast je menší než 6 % fotky → vzdávám`);
    return { ok: false, duvod: 'karta nenalezena (příliš malá oblast)' };
  }

  // 5) Body obrysu → konvexní obal
  const body = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (oznac[i] !== nejId) continue;
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1 ||
        oznac[i - 1] !== nejId || oznac[i + 1] !== nejId || oznac[i - W] !== nejId || oznac[i + W] !== nejId)
      body.push({ x, y });
  }
  const obal = konvexniObal(body);
  if (obal.length < 4) return { ok: false, duvod: 'obrys nemá tvar karty' };

  // 6) Čtyři rohy = krajní body obalu, pak zpřesnění přes proložené strany
  const hrube = seradRohy(obal);
  const upr = upresniRohy(body, hrube);
  _log(`zpřesnění rohů (zaoblení): bodů na stranách ${upr.pocty.join('/')}, ` +
    `posun rohů o ${upr.posun.map(v => (v / k).toFixed(0)).join('/')} px`);
  const jem = hranaNaPolovine(ds, W, H, upr.rohy, mS);
  const rohy = jem.rohy;
  _log(`hrana na polovině signálu: bodů na stranách ${jem.pocty.join('/')}`);
  const plQuad = plocha(rohy), plObal = plocha(obal);
  const vyplneni = plQuad / plObal;                 // blízko 1 = opravdu čtyřúhelník
  const [lh, ph, pd, ld] = rohy;
  const sirka = (dist(lh, ph) + dist(ld, pd)) / 2, vyska = (dist(lh, ld) + dist(ph, pd)) / 2;
  const pomer = Math.min(sirka, vyska) / Math.max(sirka, vyska);   // karta ≈ 0,716
  const podilFotky = plQuad / (W * H);

  const jistota = vyplneni >= 0.88 && pomer > 0.55 && pomer < 0.88 && podilFotky > 0.08;
  _log(`obrys: ${body.length} bodů, konvexní obal ${obal.length} bodů`);
  _log(`rohy (v plné velikosti): ` + rohy.map(p => `(${Math.round(p.x / k)},${Math.round(p.y / k)})`).join(' '));
  _log(`vyplnění ${(vyplneni * 100).toFixed(1)} % (chci ≥ 88), poměr stran ${pomer.toFixed(3)} (karta 0,716, chci 0,55–0,88), ` +
    `zabírá ${(podilFotky * 100).toFixed(1)} % fotky (chci > 8) → ${jistota ? 'JISTÉ' : 'NEJISTÉ'}`);
  return {
    ok: true, jistota,
    rohy: rohy.map(p => ({ x: p.x / k, y: p.y / k })),
    info: `vyplnění ${(vyplneni * 100).toFixed(0)} %, poměr stran ${pomer.toFixed(2)} (karta 0,72), ` +
          `zabírá ${(podilFotky * 100).toFixed(0)} % fotky`,
  };
}

function upresniRohy(body, rohy) {
  const [lh, ph, pd, ld] = rohy;
  const strany = [[lh, ph], [ph, pd], [pd, ld], [ld, lh]];   // horní, pravá, dolní, levá
  const primky = [];
  const pocty = [];

  // Střed čtyřúhelníku — podle něj poznáme, kterým směrem je "ven"
  const cx = (lh.x + ph.x + pd.x + ld.x) / 4, cy = (lh.y + ph.y + pd.y + ld.y) / 4;

  for (const [A, B] of strany) {
    const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
    const dx = (B.x - A.x) / len, dy = (B.y - A.y) / len;
    let nx = -dy, ny = dx;
    if ((cx - A.x) * nx + (cy - A.y) * ny > 0) { nx = -nx; ny = -ny; }   // normála ven z karty
    const tol = len * 0.06;

    // Z každého místa podél strany jen NEJVZDÁLENĚJŠÍ bod směrem ven.
    // Hranice masky obsahuje i okraje děr uvnitř karty (kde ilustrace
    // u rámečku splývá se stolem) — ty leží kousek uvnitř a stáhly by
    // proloženou přímku dovnitř. Vnější obrys je vždycky ten nejdál.
    const nejvic = new Map();
    for (const p of body) {
      const t = (p.x - A.x) * dx + (p.y - A.y) * dy;
      const n = (p.x - A.x) * nx + (p.y - A.y) * ny;
      if (t <= len * 0.15 || t >= len * 0.85 || Math.abs(n) > tol) continue;
      const kos = Math.round(t);
      const bylo = nejvic.get(kos);
      if (!bylo || n > bylo.n) nejvic.set(kos, { x: p.x, y: p.y, n });
    }
    const vybrane = [...nejvic.values()];
    pocty.push(vybrane.length);
    if (vybrane.length < 8) { primky.push({ px: A.x, py: A.y, dx, dy }); continue; }

    // Proložení přímky metodou hlavních komponent (zvládne i svislou stranu)
    let mx = 0, my = 0;
    for (const p of vybrane) { mx += p.x; my += p.y; }
    mx /= vybrane.length; my /= vybrane.length;
    let sxx = 0, syy = 0, sxy = 0;
    for (const p of vybrane) { const a = p.x - mx, b = p.y - my; sxx += a * a; syy += b * b; sxy += a * b; }
    const uhel = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    primky.push({ px: mx, py: my, dx: Math.cos(uhel), dy: Math.sin(uhel) });
  }

  // Průsečík dvou přímek
  const prusecik = (a, b) => {
    const det = a.dx * b.dy - a.dy * b.dx;
    if (Math.abs(det) < 1e-6) return null;
    const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / det;
    return { x: a.px + t * a.dx, y: a.py + t * a.dy };
  };

  // Roh = průsečík jeho dvou stran: LH = levá∩horní, PH = horní∩pravá, …
  const nove = [
    prusecik(primky[3], primky[0]),
    prusecik(primky[0], primky[1]),
    prusecik(primky[1], primky[2]),
    prusecik(primky[2], primky[3]),
  ];

  // Pojistka: nový roh nesmí uletět dál než o 8 % velikosti karty
  const velikost = Math.max(Math.hypot(pd.x - lh.x, pd.y - lh.y), 1);
  const vysledek = nove.map((p, i) =>
    p && Math.hypot(p.x - rohy[i].x, p.y - rohy[i].y) < velikost * 0.08 ? p : rohy[i]);
  const posun = vysledek.map((p, i) => Math.hypot(p.x - rohy[i].x, p.y - rohy[i].y));
  return { rohy: vysledek, pocty, posun };
}

function hranaNaPolovine(ds, W, H, rohy, urovenPozadi) {
  const smp = (x, y) => {                       // bilineární vzorek
    if (x < 0 || y < 0 || x >= W - 1 || y >= H - 1) return urovenPozadi;
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * W + x0;
    return ds[i] * (1 - fx) * (1 - fy) + ds[i + 1] * fx * (1 - fy) +
           ds[i + W] * (1 - fx) * fy + ds[i + W + 1] * fx * fy;
  };
  const [lh, ph, pd, ld] = rohy;
  const cx = (lh.x + ph.x + pd.x + ld.x) / 4, cy = (lh.y + ph.y + pd.y + ld.y) / 4;
  const strany = [[lh, ph], [ph, pd], [pd, ld], [ld, lh]];
  const primky = [], pocty = [];

  for (const [A, B] of strany) {
    const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
    const dx = (B.x - A.x) / len, dy = (B.y - A.y) / len;
    let nx = -dy, ny = dx;
    if ((cx - A.x) * nx + (cy - A.y) * ny > 0) { nx = -nx; ny = -ny; }
    const body = [];
    for (let t = len * 0.15; t < len * 0.85; t += 1.5) {
      const qx = A.x + dx * t, qy = A.y + dy * t;
      // úroveň karty = kousek uvnitř, úroveň stolu = kousek venku
      const uvnitr = (smp(qx - nx * 5, qy - ny * 5) + smp(qx - nx * 6, qy - ny * 6)) / 2;
      const venku  = Math.min(smp(qx + nx * 5, qy + ny * 5), urovenPozadi * 2);
      if (uvnitr - venku < 6) continue;                 // hrana tu není zřetelná
      const pul = (uvnitr + venku) / 2;
      // od vnitřku ven najdi přechod přes polovinu
      let pred = smp(qx - nx * 4, qy - ny * 4), nalez = null;
      for (let o = -3.75; o <= 4; o += 0.25) {
        const v = smp(qx + nx * o, qy + ny * o);
        if (pred >= pul && v < pul) { nalez = o - 0.25 * (pul - v) / (pred - v || 1); break; }
        pred = v;
      }
      if (nalez !== null) body.push({ x: qx + nx * nalez, y: qy + ny * nalez });
    }
    pocty.push(body.length);
    if (body.length < 8) { primky.push({ px: A.x, py: A.y, dx, dy }); continue; }
    let mx = 0, my = 0;
    for (const p of body) { mx += p.x; my += p.y; }
    mx /= body.length; my /= body.length;
    let sxx = 0, syy = 0, sxy = 0;
    for (const p of body) { const a = p.x - mx, b = p.y - my; sxx += a * a; syy += b * b; sxy += a * b; }
    const u = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    primky.push({ px: mx, py: my, dx: Math.cos(u), dy: Math.sin(u) });
  }
  const pr = (a, b) => {
    const det = a.dx * b.dy - a.dy * b.dx;
    if (Math.abs(det) < 1e-6) return null;
    const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / det;
    return { x: a.px + t * a.dx, y: a.py + t * a.dy };
  };
  const nove = [pr(primky[3], primky[0]), pr(primky[0], primky[1]), pr(primky[1], primky[2]), pr(primky[2], primky[3])];
  const vel = Math.max(Math.hypot(pd.x - lh.x, pd.y - lh.y), 1);
  const vys = nove.map((p, i) => p && Math.hypot(p.x - rohy[i].x, p.y - rohy[i].y) < vel * 0.05 ? p : rohy[i]);
  return { rohy: vys, pocty };
}

function konvexniObal(b) {
  const p = b.slice().sort((a, c) => a.x - c.x || a.y - c.y);
  const kr = (o, a, c) => (a.x - o.x) * (c.y - o.y) - (a.y - o.y) * (c.x - o.x);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && kr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i];
    while (hi.length >= 2 && kr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

function plocha(b) { let s = 0; for (let i = 0; i < b.length; i++) { const a = b[i], c = b[(i + 1) % b.length]; s += a.x * c.y - c.x * a.y; } return Math.abs(s) / 2; }

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function seradRohy(b) {
  const sum  = b.map(p => p.x + p.y), diff = b.map(p => p.y - p.x);
  return [
    b[sum.indexOf(Math.min(...sum))],
    b[diff.indexOf(Math.min(...diff))],
    b[sum.indexOf(Math.max(...sum))],
    b[diff.indexOf(Math.max(...diff))],
  ];
}

function homografie(cil, zdroj) {
  const A = [], bv = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = cil[i], { x: u, y: v } = zdroj[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); bv.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); bv.push(v);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [bv[c], bv[p]] = [bv[p], bv[c]];
    for (let r = c + 1; r < 8; r++) {
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      bv[r] -= f * bv[c];
    }
  }
  const h = new Array(8);
  for (let r = 7; r >= 0; r--) {
    let s = bv[r]; for (let k = r + 1; k < 8; k++) s -= A[r][k] * h[k]; h[r] = s / A[r][r];
  }
  return [...h, 1];
}

function zmensi(obr, sx, sy, sw, sh, w, h) {
  let cw = sw, ch = sh;
  let cur = document.createElement('canvas');
  cur.width = Math.max(1, Math.round(cw)); cur.height = Math.max(1, Math.round(ch));
  cur.getContext('2d').drawImage(obr, sx, sy, sw, sh, 0, 0, cur.width, cur.height);
  while (cur.width / 2 >= w && cur.height / 2 >= h) {
    const dalsi = document.createElement('canvas');
    dalsi.width = Math.max(w, cur.width >> 1); dalsi.height = Math.max(h, cur.height >> 1);
    const c = dalsi.getContext('2d');
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.drawImage(cur, 0, 0, dalsi.width, dalsi.height);
    cur = dalsi;
  }
  const fin = _cvHash; fin.width = w; fin.height = h;
  const fc = fin.getContext('2d', { willReadFrequently: true });
  fc.imageSmoothingEnabled = true; fc.imageSmoothingQuality = 'high';
  fc.drawImage(cur, 0, 0, w, h);
  return fc;
}

function dHash(obr, w, h, vyrez) {
  const iw = _sirka(obr) || obr.width, ih = _vyska(obr) || obr.height;
  const ctx = vyrez
    ? zmensi(obr, iw*vyrez.x, ih*vyrez.y, iw*vyrez.w, ih*vyrez.h, w, h)
    : zmensi(obr, 0, 0, iw, ih, w, h);
  const d = ctx.getImageData(0, 0, w, h).data, s = [];
  for (let i = 0; i < d.length; i += 4) s.push(0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2]);
  let hash = 0n;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w - 1; x++)
      hash = (hash << 1n) | (s[y*w+x] > s[y*w+x+1] ? 1n : 0n);
  return hash;
}

function vzdal(a, b) { let x = a ^ b, n = 0; while (x) { n += Number(x & 1n); x >>= 1n; } return n; }

  function otisk(obr) {
    return {
      cela:  dHash(obr, 9, 8, null),
      art:   dHash(obr, 9, 8, ART),
      jemny: dHash(obr, 17, 16, ART),
      jmeno: dHash(obr, 25, 6, TEXT_JMENO),
      spod:  dHash(obr, 17, 12, TEXT_SPOD),
    };
  }

  /* Narovnání karty. kvalitne=true → bilineární vzorkování (pro uložení
     fotky), jinak nejbližší bod (rychlé, na otisk a náhled stačí). */
  function narovnej(zdroj, rohy, W, H, kvalitne) {
    const [lh, ph, pd, ld] = rohy;
    const Hm = homografie([{x:0,y:0},{x:W,y:0},{x:W,y:H},{x:0,y:H}], [lh, ph, pd, ld]);
    const SW = _sirka(zdroj), SH = _vyska(zdroj);
    const src = document.createElement('canvas'); src.width = SW; src.height = SH;
    const sctx = src.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(zdroj, 0, 0, SW, SH);
    const sd = sctx.getImageData(0, 0, SW, SH).data;
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const octx = out.getContext('2d');
    const od = octx.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const w = Hm[6] * x + Hm[7] * y + 1;
      const u = (Hm[0] * x + Hm[1] * y + Hm[2]) / w;
      const v = (Hm[3] * x + Hm[4] * y + Hm[5]) / w;
      const oi = (y * W + x) * 4;
      if (kvalitne) {
        const x0 = Math.max(0, Math.min(SW - 2, u | 0)), y0 = Math.max(0, Math.min(SH - 2, v | 0));
        const fx = Math.min(1, Math.max(0, u - x0)), fy = Math.min(1, Math.max(0, v - y0));
        const i00 = (y0 * SW + x0) * 4, i10 = i00 + 4, i01 = i00 + SW * 4, i11 = i01 + 4;
        for (let c = 0; c < 3; c++)
          od.data[oi + c] = sd[i00 + c] * (1 - fx) * (1 - fy) + sd[i10 + c] * fx * (1 - fy) +
                            sd[i01 + c] * (1 - fx) * fy + sd[i11 + c] * fx * fy;
      } else {
        const ui = Math.max(0, Math.min(SW - 1, u | 0)), vi = Math.max(0, Math.min(SH - 1, v | 0));
        const si = (vi * SW + ui) * 4;
        od.data[oi] = sd[si]; od.data[oi + 1] = sd[si + 1]; od.data[oi + 2] = sd[si + 2];
      }
      od.data[oi + 3] = 255;
    }
    octx.putImageData(od, 0, 0);
    return out;
  }

  /* Ostrost = rozptyl Laplaciánu ve výřezu ilustrace. Rozmazaná fotka
     (karta se ještě hýbe) má výrazně nižší hodnotu. */
  function ostrost(cv) {
    const W = 120, H = 90;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(cv, cv.width * ART.x, cv.height * ART.y, cv.width * ART.w, cv.height * ART.h, 0, 0, W, H);
    const d = x.getImageData(0, 0, W, H).data, g = new Float32Array(W * H);
    for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
    let s = 0, s2 = 0, n = 0;
    for (let y = 1; y < H - 1; y++) for (let x2 = 1; x2 < W - 1; x2++) {
      const i = y * W + x2;
      const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - W] - g[i + W];
      s += l; s2 += l * l; n++;
    }
    const m = s / n;
    return s2 / n - m * m;
  }

  window.CardVision = {
    verze: '1.0',
    detekuj: detekujKartu,
    narovnej, otisk, ostrost,
    vzdalenost: vzdal,
    seradRohy,
    nastavLog: fn => { _logFn = fn; },
  };
})();
