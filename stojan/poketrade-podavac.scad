// © 2026 PokéTrade · https://www.poke-trade.eu
// Licence: Creative Commons BY-NC-SA 4.0 — smíš sdílet a upravovat s uvedením
// autora (poke-trade.eu), NE pro komerční účely (prodej modelu ani výtisků),
// úpravy pod stejnou licencí. https://creativecommons.org/licenses/by-nc-sa/4.0/deed.cs
// ═══════════════════════════════════════════════════════════════
// PokéTrade — podavač karet ke stojanu (gravitační skluzavka s kapsou)
// ───────────────────────────────────────────────────────────────
// Kartu polož nahoru na skluzavku a pusť. Sjede a dopadne do kapsy
// přímo pod fotoaparátem. Další karta dopadne na ni a přesně ji zakryje,
// takže fotoaparát vidí vždy jen nejnovější kartu a aplikace ji sama vyfotí.
// Po dávce (≈ 45 karet) vyndej celý komínek za výřezy po stranách.
//
// Podsouvá se pod stojan (mezi nohy, vnitřní šířka stojanu 160 mm).
// Střed kapsy (rýhy na bocích) zarovnej s rýhami na desce stojanu.
//
// TISK: tak, jak je (dnem na podložce), bez podpěr. ČERNÝ nebo tmavý
//       filament, 0,2 mm, 3 obvody, výplň 10–15 %.
// ═══════════════════════════════════════════════════════════════

/* [Karta a kapsa] */
karta_delka = 88;     // mm
karta_sirka = 63;     // mm
vule        = 1.2;    // mm navíc v kapse (karty v obalech: 3–4)
vyska_kapsy = 22;     // výška stěn kapsy nad dnem (mm)
pad         = 15;     // konec skluzavky nad dnem kapsy (mm) ≈ 45 karet

/* [Skluzavka] */
uhel          = 28;   // sklon (°) — klouže-li karta špatně, zvyš na 32
delka_skluzu  = 105;  // délka šikmé plochy (mm)
vyska_bocnic  = 7;    // boční vedení nad plochou skluzavky (mm)

/* [Základna] */
sirka_zakladny = 130; // mm, musí se vejít mezi nohy stojanu (160 mm)
predni_presah  = 28;  // základna před kapsou (mm) — tmavé pozadí i v rozích záběru

/* [Podpis] */
podpis = "poke-trade.eu";   // vystouplý nápis na bocích skluzavky
podpis_velikost = 8;        // výška písma (mm)
podpis_vystupek = 0.8;

/* [Hidden] */
stena = 2.4; dno = 2;
kapsa_d = karta_delka + vule;          // ve směru jízdy karty (x)
kapsa_s = karta_sirka + vule;          // napříč (y)
kanal   = kapsa_s + 1.3;               // vnitřek skluzavky
x0 = predni_presah;                    // přední stěna kapsy
x1 = x0 + stena + kapsa_d;             // zadní stěna kapsy = čelo skluzavky
dx = delka_skluzu * cos(uhel);
dz = delka_skluzu * sin(uhel);
x2 = x1 + dx;                          // horní konec skluzavky
zA = dno + pad;                        // výška konce skluzavky
zB = zA + dz;
yc = sirka_zakladny / 2;
delka_celkem = x2 + 2;

echo(str("Podavač ", round(delka_celkem), " × ", sirka_zakladny, " × ", round(zB + vyska_bocnic),
         " mm; střed kapsy ", round(x0 + stena + kapsa_d / 2), " mm od předního okraje"));

module kapsa() {
  sir = kapsa_s + 2 * stena;
  difference() {
    translate([x0, yc - sir / 2, 0]) cube([stena + kapsa_d, sir, dno + vyska_kapsy]);
    // vnitřek kapsy (zezadu otevřený do skluzavky)
    translate([x0 + stena, yc - kapsa_s / 2, dno]) cube([kapsa_d + 1, kapsa_s, vyska_kapsy + 1]);
    // zkosení horních vnitřních hran (trychtýř 3 mm) — padající kartu navede dovnitř
    hull() {
      translate([x0 + stena, yc - kapsa_s / 2, dno + vyska_kapsy - 3]) cube([kapsa_d + 1, kapsa_s, 0.01]);
      translate([x0 + stena - 3, yc - kapsa_s / 2 - 3, dno + vyska_kapsy + 0.01]) cube([kapsa_d + 4, kapsa_s + 6, 0.01]);
    }
    // výřezy po stranách na vyndání komínku
    for (s = [-1, 1])
      translate([x0 + stena + kapsa_d / 2 - 15, yc + s * (kapsa_s / 2 + stena / 2) - stena, dno + 6])
        cube([30, 2 * stena, vyska_kapsy]);
  }
}

module skluzavka() {
  sir = kanal + 2 * stena;
  difference() {
    // plné těleso pod šikmou plochou + boční vedení (tiskne se bez podpěr)
    translate([0, yc + sir / 2, 0]) rotate([90, 0, 0])
      linear_extrude(height = sir)
        polygon([[x1, 0], [x2, 0], [x2, zB + vyska_bocnic], [x1, zA + vyska_bocnic]]);
    // kanál pro kartu nad šikmou plochou
    translate([0, yc + kanal / 2, 0]) rotate([90, 0, 0])
      linear_extrude(height = kanal)
        polygon([[x1 - 1, zA], [x2 + 1, zB + (1 * tan(uhel))], [x2 + 1, zB + 50], [x1 - 1, zA + 50]]);
  }
}

module zakladna() {
  difference() {
    cube([delka_celkem, sirka_zakladny, dno]);
    // rýhy na bocích = střed kapsy (zarovnat s rýhami na desce stojanu)
    for (y = [0, sirka_zakladny - 1.2])
      translate([x0 + stena + kapsa_d / 2 - 0.6, y, -1]) cube([1.2, 1.2, dno + 2]);
  }
}

// Podpis na obou bocích skluzavky (svislé stěny, mimo pohled fotoaparátu)
module podpis_skluzu() {
  sir = kanal + 2 * stena;
  xs = (x1 + x2) / 2;
  zs = dno + 8;
  for (strana = [0, 1])
    translate([xs, strana == 0 ? yc - sir / 2 : yc + sir / 2, zs])
      rotate([90, 0, strana == 0 ? 0 : 180])
        linear_extrude(height = podpis_vystupek)
          text(podpis, size = podpis_velikost, font = "DejaVu Sans:style=Bold",
               halign = "center", valign = "center");
}

zakladna();
kapsa();
skluzavka();
podpis_skluzu();
