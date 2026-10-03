// © 2026 PokéTrade · https://www.poke-trade.eu
// Licence: Creative Commons BY-NC-SA 4.0 — smíš sdílet a upravovat s uvedením
// autora (poke-trade.eu), NE pro komerční účely (prodej modelu ani výtisků),
// úpravy pod stejnou licencí. https://creativecommons.org/licenses/by-nc-sa/4.0/deed.cs
// ═══════════════════════════════════════════════════════════════
// PokéTrade — stojan pro skenování karet (režim stojanu v aplikaci)
// ───────────────────────────────────────────────────────────────
// Telefon leží na desce displejem nahoru, fotoaparát míří štěrbinou
// dolů na kartu. Nohy jsou po stranách mimo záběr, předek i zadek volný.
//
// TISK: vzhůru nohama (deskou na podložce) — bez podpěr.
//       PLA/PETG, 0,2 mm vrstva, 3 obvody, výplň 15–20 %.
//       Nejlépe ČERNÝM nebo tmavým filamentem (nesvítí do záběru).
//
// Úprava: změň „vyska_kamery" (13–20 cm). Šířka mezi nohami se
// dopočítá sama tak, aby nohy nebyly v záběru.
// ═══════════════════════════════════════════════════════════════

/* [Hlavní rozměry] */
// Výška fotoaparátu nad kartou (mm). 150 = doporučeno; iPhony Pro ~200
vyska_kamery = 150;   // [130:5:200]
// Hloubka stojanu odpředu dozadu (mm) — musí se vejít na tiskárnu
hloubka = 200;        // [160:5:220]
// Šířka štěrbiny pro fotoaparát (mm) — větší ostrůvky fotoaparátů až ~45 mm
sterbina_sirka = 52;  // [40:2:70]

/* [Konstrukce] */
sila_desky = 5;       // tloušťka desky (mm)
sila_nohy  = 6;       // tloušťka nohou (mm)
vyztuha    = 14;      // výztuha v rohu deska–noha (mm), tiskne se pod 45°
pro_tisk   = true;    // true = otočeno deskou dolů (pro tisk), false = jak stojí na stole

/* [Podpis] */
podpis = "poke-trade.eu";   // vystouplý nápis na vnějších stranách nohou
podpis_velikost = 12;       // výška písma (mm)
podpis_vystupek = 0.8;      // o kolik nápis vystupuje (mm)

/* [Hidden] */
// Záběr hlavního fotoaparátu (ekvivalent 26 mm, video 16:9): kratší strana ≈ 0,78 × výška.
// Mezi nohami necháme záběr + 25 mm rezervu, ale aspoň 160 mm.
vnitrni_sirka = max(160, ceil(0.78 * vyska_kamery + 25));
vyska_nohy    = vyska_kamery - sila_desky;      // fotoaparát leží na horní ploše desky
sirka         = vnitrni_sirka + 2 * sila_nohy;
sterbina_delka = hloubka / 2 + 35;              // od předního okraje kousek za střed

echo(str("Vnitřní šířka mezi nohami: ", vnitrni_sirka, " mm, celkem ",
         hloubka, " × ", sirka, " × ", vyska_kamery, " mm"));

module deska() {
  difference() {
    translate([0, 0, vyska_nohy]) cube([hloubka, sirka, sila_desky]);
    // štěrbina pro fotoaparát, otevřená dopředu (x = 0 je předek)
    translate([-1, sirka / 2 - sterbina_sirka / 2, vyska_nohy - 1])
      cube([sterbina_delka + 1, sterbina_sirka, sila_desky + 2]);
    // zaoblený konec štěrbiny
    translate([sterbina_delka, sirka / 2, vyska_nohy - 1])
      cylinder(d = sterbina_sirka, h = sila_desky + 2, $fn = 64);
    // značka středu místa pro kartu (rýha 0,6 mm na okraji desky)
    for (y = [0.8, sirka - 0.8])
      translate([hloubka / 2 - 0.6, y - 0.8, vyska_nohy + sila_desky - 0.6]) cube([1.2, 1.6, 1]);
  }
}

module noha(y0) {
  translate([0, y0, 0]) cube([hloubka, sila_nohy, vyska_nohy]);
}

// výztuha: trojúhelník v rohu mezi deskou a nohou (na vnitřní straně)
module vyztuha_roh(vnitrni_y, smer) {
  translate([0, vnitrni_y, vyska_nohy])
    rotate([0, 90, 0])
      linear_extrude(height = hloubka)
        polygon([[0, 0], [vyztuha, 0], [0, smer * vyztuha]]);
}

// Podpis na vnějších stranách obou nohou (mimo záběr fotoaparátu)
module podpis_nohy() {
  for (strana = [0, 1])
    translate([hloubka / 2, strana == 0 ? 0 : sirka, vyska_nohy / 2])
      rotate([90, 0, strana == 0 ? 0 : 180])
        linear_extrude(height = podpis_vystupek)
          text(podpis, size = podpis_velikost, font = "DejaVu Sans:style=Bold",
               halign = "center", valign = "center");
}

module stojan() {
  podpis_nohy();
  deska();
  noha(0);
  noha(sirka - sila_nohy);
  vyztuha_roh(sila_nohy, 1);
  vyztuha_roh(sirka - sila_nohy, -1);
}

if (pro_tisk)   // OTOČENÍ (ne zrcadlení — to by obrátilo i nápis): deska na podložce
  translate([0, sirka, vyska_kamery]) rotate([180, 0, 0]) stojan();
else
  stojan();
