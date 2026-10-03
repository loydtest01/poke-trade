// © 2026 PokéTrade · https://www.poke-trade.eu
// Licence: Creative Commons BY-NC-SA 4.0 — smíš sdílet a upravovat s uvedením
// autora (poke-trade.eu), NE pro komerční účely (prodej modelu ani výtisků),
// úpravy pod stejnou licencí. https://creativecommons.org/licenses/by-nc-sa/4.0/deed.cs
// ═══════════════════════════════════════════════════════════════
// PokéTrade — LEHKÝ podavač (lepený ze 2 dílů, ~3× méně materiálu než plný)
// ───────────────────────────────────────────────────────────────
// Díly:  1× kapsa (dil = "kapsa")  — základna, kapsa a dvě šikmé bočnice
//        1× skluz (dil = "skluz")  — deska skluzavky s vedením
// Skluz se nalepí na šikmé hrany bočnic (drážky na spodku skluzu je
// přesně navedou). Spodní hranu skluzu zarovnej se zadní stěnou kapsy.
// Oba díly se tisknou bez podpěr: kapsa dnem dolů, skluz vedením nahoru.
// ═══════════════════════════════════════════════════════════════

/* [Co vygenerovat] */
dil = "sestava";      // [kapsa, skluz, sestava]

/* [Karta a kapsa] */
karta_delka = 88;
karta_sirka = 63;
vule        = 1.2;    // karty v obalech: 3–4
vyska_kapsy = 22;
pad         = 15;     // konec skluzavky nad dnem kapsy ≈ 45 karet

/* [Skluzavka] */
uhel         = 28;    // sklon (°); klouže-li karta pomalu, 32
delka_skluzu = 105;
vyska_bocnic = 7;     // vedení karty na skluzu

/* [Konstrukce] */
stena   = 2.4;        // stěny kapsy
bocnice = 4;          // tloušťka šikmých bočnic (nosí skluz)
skluz_t = 3;          // tloušťka desky skluzu
dno     = 2;

/* [Podpis] */
podpis = "poke-trade.eu";

/* [Hidden] */
kapsa_d = karta_delka + vule;
kapsa_s = karta_sirka + vule;
kanal   = kapsa_s + 1.3;
sir     = kanal + 2 * stena;              // šířka skluzu i kapsy zvenku
x0 = 0;                                   // přední stěna kapsy
x1 = x0 + stena + kapsa_d;                // zadní okraj kapsy = začátek skluzu
dx = delka_skluzu * cos(uhel);
dz = delka_skluzu * sin(uhel);
x2 = x1 + dx;
zA = dno + pad;                           // horní plocha skluzu u kapsy
y_boc = [stena, sir - stena - bocnice];   // polohy bočnic (pod okraji skluzu)
drazka_h = 1.2;                           // hloubka drážek na spodku skluzu
h0 = zA - skluz_t + drazka_h;             // výška horní hrany bočnic u kapsy

// ── Díl 1: kapsa + základna + šikmé bočnice ─────────────────────
module kapsa() {
  difference() {
    union() {
      // základna pod kapsou i pod bočnicemi
      cube([x2, sir, dno]);
      // stěny kapsy (přední, boční, zadní nízká — přes ni karta padá)
      translate([x0, 0, 0]) cube([stena, sir, dno + vyska_kapsy]);
      for (y = [0, sir - stena]) translate([x0, y, 0]) cube([stena + kapsa_d, stena, dno + vyska_kapsy]);
      translate([x1 - stena, 0, 0]) cube([stena, sir, zA - skluz_t]);
      // šikmé bočnice: horní hrana nese spodek skluzu
      for (y = y_boc)
        translate([0, y + bocnice, 0]) rotate([90, 0, 0]) linear_extrude(height = bocnice)
          polygon([[x1 - stena, 0], [x2, 0], [x2, h0 + dz], [x1, h0], [x1 - stena, h0]]);
    }
    // trychtýř nahoře v kapse — padající kartu navede dovnitř
    hull() {
      translate([x0 + stena, stena, dno + vyska_kapsy - 3]) cube([kapsa_d - stena, kapsa_s, 0.01]);
      translate([x0 + stena - 3, stena - 3, dno + vyska_kapsy + 0.01]) cube([kapsa_d - stena + 6, kapsa_s + 6, 0.01]);
    }
    // výřezy po stranách na vyndání komínku
    for (y = [-1, sir - stena - 1])
      translate([x0 + stena + kapsa_d / 2 - 15, y, dno + 6]) cube([30, stena + 2, vyska_kapsy]);
    // rýhy = střed kapsy (zarovnat s rýhami na desce stojanu)
    for (y = [-0.01, sir - 1.2]) translate([x0 + stena + kapsa_d / 2 - 0.6, y, -1]) cube([1.2, 1.21, dno + 2]);
  }
  // podpis na vnějších stranách bočnic
  for (i = [0, 1]) {
    y = i == 0 ? y_boc[0] : y_boc[1] + bocnice;
    translate([(x1 + x2) / 2, y, dno + 8]) rotate([90, 0, i == 0 ? 0 : 180])
      linear_extrude(height = 0.8)
        text(podpis, size = 7, font = "DejaVu Sans:style=Bold", halign = "center", valign = "center");
  }
}

// ── Díl 2: skluz (tiskne se naplocho, vedení nahoru) ────────────
module skluz() {
  difference() {
    union() {
      cube([delka_skluzu, sir, skluz_t]);
      for (y = [0, sir - stena]) translate([0, y, skluz_t]) cube([delka_skluzu, stena, vyska_bocnic]);
    }
    // drážky na spodku pro horní hrany bočnic (vůle 0,4 mm)
    for (y = y_boc) translate([-1, y - 0.2, -1]) cube([delka_skluzu + 2, bocnice + 0.4, 1 + drazka_h]);
    // zkosená spodní hrana, ať karta plynule sjede přes okraj
    translate([0, -1, skluz_t]) rotate([0, 45, 0]) translate([-2, 0, -2]) cube([2.8, sir + 2, 2.8]);
  }
}

module sestava() {
  color([0.2, 0.2, 0.22]) kapsa();
  // skluz na bočnicích (drážky 1,2 mm hluboké → skluz sedí o 1,2 mm níž)
  // spodek skluzu = horní hrana bočnic − hloubka drážky → horní plocha skluzu přesně v zA
  color([0.3, 0.3, 0.34]) translate([x1, 0, zA - skluz_t]) rotate([0, -uhel, 0]) skluz();
}

echo(str("Kapsa+bočnice ", round(x2), " × ", round(sir), " × ", round(zA + dz), " mm; skluz ", delka_skluzu, " × ", round(sir), " mm"));

if (dil == "kapsa") kapsa();
else if (dil == "skluz") skluz();
else sestava();
