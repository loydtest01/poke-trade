// © 2026 PokéTrade · https://www.poke-trade.eu
// Licence: Creative Commons BY-NC-SA 4.0 — smíš sdílet a upravovat s uvedením
// autora (poke-trade.eu), NE pro komerční účely (prodej modelu ani výtisků),
// úpravy pod stejnou licencí. https://creativecommons.org/licenses/by-nc-sa/4.0/deed.cs
// ═══════════════════════════════════════════════════════════════
// PokéTrade — LEHKÝ stojan (lepený ze 3 dílů, asi o třetinu materiálu méně)
// ───────────────────────────────────────────────────────────────
// Díly:  1× deska (dil = "deska")   2× noha (dil = "noha")
// Všechny díly se tisknou NAPLOCHO, bez podpěr.
// Spoj: horní příčka nohy se vlepí do drážky mezi dvěma žebry na spodku
//       desky — drážka nohu sevře z obou stran, spoj drží i do stran.
// Lepidlo: vteřinové (kyanoakrylát) nebo dvousložkové epoxidové.
// Dimenzováno s rezervou i pro těžké odolné telefony (~500 g).
// ═══════════════════════════════════════════════════════════════

/* [Co vygenerovat] */
dil = "sestava";      // [deska, noha, sestava]

/* [Hlavní rozměry] */
vyska_kamery   = 150; // výška fotoaparátu nad kartou (mm) [130:5:200]
hloubka        = 200; // odpředu dozadu (mm)
sterbina_sirka = 52;  // štěrbina pro fotoaparát (mm)

/* [Konstrukce] */
deska_t   = 4;     // tloušťka desky (mm)
noha_t    = 8;     // tloušťka rámu nohy (mm)
prut      = 14;    // šířka prutů rámu (mm)
zebro_t   = 3;     // tloušťka žeber drážky (mm)
zebro_h   = 8;     // hloubka drážky = výška žeber (mm)
vule      = 0.4;   // vůle v drážce (mm) — tiskárny tisknou o chlup větší

/* [Podpis] */
podpis = "poke-trade.eu";

/* [Hidden] */
vnitrni = max(160, ceil(0.78 * vyska_kamery + 25));   // mezi nohami (mimo záběr)
noha_h  = vyska_kamery - deska_t;                      // noha sahá až pod desku
drazka  = noha_t + vule;
// osy noh (střed tloušťky) a celková šířka desky
y_noha1 = zebro_t + drazka / 2;
y_noha2 = y_noha1 + drazka / 2 + vnitrni + drazka / 2;
sirka   = y_noha2 + drazka / 2 + zebro_t;
sterbina_delka = hloubka / 2 + 35;

echo(str("Deska ", hloubka, " × ", sirka, " mm, noha ", hloubka, " × ", noha_h, " mm, mezi nohami ", vnitrni, " mm"));

// ── Deska (tiskne se horní plochou na podložce, žebra nahoru) ──
module deska() {
  difference() {
    union() {
      cube([hloubka, sirka, deska_t]);
      // žebra drážek pro nohy (po celé délce)
      for (yn = [y_noha1, y_noha2])
        for (s = [-1, 1])
          translate([0, yn + s * (drazka / 2) + (s < 0 ? -zebro_t : 0), deska_t])
            cube([hloubka, zebro_t, zebro_h]);
      // výztužná žebra podél štěrbiny (deska se neprohne ani pod těžkým telefonem)
      for (s = [-1, 1])
        translate([0, sirka / 2 + s * (sterbina_sirka / 2 + 4) - 2, deska_t])
          cube([hloubka, 4, 6]);
    }
    // štěrbina pro fotoaparát, otevřená dopředu
    translate([-1, sirka / 2 - sterbina_sirka / 2, -1]) cube([sterbina_delka + 1, sterbina_sirka, 20]);
    translate([sterbina_delka, sirka / 2, -1]) cylinder(d = sterbina_sirka, h = 20, $fn = 64);
    // rýhy uprostřed délky = střed místa pro kartu (na horní ploše = straně u podložky)
    for (y = [0, sirka - 1.2]) translate([hloubka / 2 - 0.6, y, -1]) cube([1.2, 1.2, 1.6]);
    // podpis vyrytý do spodní strany desky (při tisku nahoře)
    // ve volném pásu mezi drážkou nohy a žebrem u štěrbiny
    translate([hloubka / 2, (y_noha1 + drazka / 2 + zebro_t + sirka / 2 - sterbina_sirka / 2 - 6) / 2, deska_t - 0.6])
      linear_extrude(height = 1) text(podpis, size = 7, font = "DejaVu Sans:style=Bold", halign = "center", valign = "center");
  }
}

// ── Noha: rám (tiskne se naplocho, vnější strana s podpisem nahoru) ──
module noha() {
  difference() {
    cube([hloubka, noha_h, noha_t]);
    // okna rámu (dvě trojúhelníková pole kolem úhlopříčky)
    w = hloubka - 2 * prut; h = noha_h - 2 * prut; d = prut * 0.85;   // d = polovina šířky úhlopříčky
    translate([prut, prut, -1]) linear_extrude(height = noha_t + 2)
      polygon([[0, 0], [w - d * w / h * 1.4, 0], [0, h - d * h / w * 1.4]]);
    translate([prut, prut, -1]) linear_extrude(height = noha_t + 2)
      polygon([[w, h], [d * w / h * 1.4, h], [w, d * h / w * 1.4]]);
  }
  // podpis na dolní příčce (vnější strana)
  translate([hloubka / 2, prut / 2, noha_t])
    linear_extrude(height = 0.8)
      text(podpis, size = 8, font = "DejaVu Sans:style=Bold", halign = "center", valign = "center");
}

// ── Sestava (jen náhled, jak to stojí na stole) ──
module sestava() {
  translate([0, 0, noha_h]) deska_na_stole();
  // obě nohy jsou stejný díl; druhá je jen otočená o 180° (nápis ven, ne zrcadlově)
  translate([0, y_noha1 + noha_t / 2, 0]) rotate([90, 0, 0]) noha();
  translate([hloubka, y_noha2 - noha_t / 2, 0]) rotate([0, 0, 180]) rotate([90, 0, 0]) noha();
}
module deska_na_stole() { translate([0, sirka, deska_t]) rotate([180, 0, 0]) deska(); }

if (dil == "deska") deska();
else if (dil == "noha") noha();
else sestava();
