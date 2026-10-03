# PokéTrade — seznam úkolů

Pořadí: **1. bezpečnost → 2. funkčnost → 3. vylepšení.** Uvnitř skupiny shora dolů.
Na začátku nového chatu nahraj tento soubor, ať se navazuje, kde jsme skončili.
Soubor se na web nenasazuje (`.vercelignore` skrývá `*.md`).

Aktualizováno: 2. 10. 2026 — vše k nasazení v balíku `poketrade-nasazeni-2026-10-02.zip`

---

## 🔴 1. Bezpečnost

- [ ] *(volitelné)* **Service klíč v triggeru push notifikací** — standardní chování webhooků Supabase. CSV export nikam nesdílet; při podezření na únik přejít na nové API klíče Supabase.

## 🟠 2. Funkčnost

- [ ] **📅 9. 10. — DEN NEONU + CAPTCHA (připomenout!)**
  1. Neon: `export_struktury.sql` → poslat výsledek; `obrazky_z_variant.sql` KROK 0+1 → poslat čísla (KROK 2 až po kontrole).
  2. Nasadit `worker.js` (záloha v R2), pokud ještě není.
  3. CAPTCHA: admin → Logy → kategorie **api-auth** (bylo něco?) → Turnstile widget (https://dash.cloudflare.com/?to=/:account/turnstile) → Site Key do `captcha.js` → nasadit → Secret Key do Supabase (Authentication → Attack Protection).
  4. Pak kolektivní paměť, fronta ověření, české překlady v PokéDB.

- [ ] **⚠️ ŠPATNÉ CENY Z ZÁLOHY TCGdex — OPRAVA, NASADIT V POŘADÍ:** 1) nahrát opravený `tcg-zdroj.js` → 2) `oprava_cen_tcgdex.sql` KROK 1 (náhled) → KROK 2. Příčina: při nenalezené sadě nebo jménu se vracela karta stejného jména z jiné sady a „Rayquaza ★" = „Rayquaza" (porovnání mazalo symboly). Album pak uložilo její cenu (Rayquaza ★ ~20 000 € → 4 €).
- [ ] **Album: koruny, vlastní cena, pojistka cen — PŘIPRAVENO, NASADIT:** `moje-album.html` (obsahuje i demo).
  - Koruny: album se po načtení kurzu překreslí; kurz uložen v prohlížeči + záložní zdroj ECB.
  - **Vlastní cena (Kč) má přednost** pro hodnotu sbírky, řazení, filtr drahých karet i cenovku.
  - **Pojistka:** automatické načtení nesrazí cenu pod 1/4 (od 20 €) a nezahodí známou cenu, když zdroj nic nenajde.
  - Ručně zadaný odkaz na Cardmarket se už nepřepisuje.
  - **Měna:** Nastavení ukládalo `czk` malými písmeny → stránky ho nepoznaly. Opraveno v `nastaveni.html` + sjednocení v `topbar.js` + album čte bez ohledu na velikost.
  - **Odkaz:** přesměrování přes prices.pokemontcg.io vede po Scrydexu na „Invalid product" → album nabídne hledání na Cardmarketu; pro přesný odkaz zadat ručně.
  - 2. 10. z logu: pokemontcg.io vrací 502 na všechno → vše přes TCGdex. `tcg-zdroj.js`: číslo karty se filtruje lokálně (serverový filtr TCGdex nic nevracel). Album: interní ID řádku (UUID) se už nepoužívá jako ID karty; bez platného odkazu → hledání na Cardmarketu.
  - **Kontrola čísla karty** při hledání ceny, ID a obrázku — žádná jiná verze stejné karty (běžná/duhová/alt art) se už nepřijme.
  - Příčina u Rayquazy VMAX 218 (alt art): moje `oprava_cen_tcgdex.sql` vynulovala cenu → album ji načetlo znovu a přitom (stará slabina: hledání bez čísla) vzalo verzi 111 a přepsalo jí ID i odkaz. Oprava dat: `oprava_verzi_karet.sql` vrátí ID/odkaz/obrázek na správné číslo (KROK 1 náhled → KROK 2) — AŽ PO nahrání `moje-album.html`.
- [ ] **Reset hesla** — adresa v Supabase přidána 30. 9.; zbývá vyzkoušet odkaz z e-mailu (odloženo).
- [ ] **GitHub Desktop:** naklonovat repozitář na obou PC, pak přidat `synchronizovat.bat` a `.gitignore` (hotové soubory z 30. 9.).
- [ ] **Neon (nejspíš od 9. 10. — fakturační období od 9. do 9., projekt vznikl 9. 5.):** `export_struktury.sql` → `obrazky_z_variant.sql` po krocích (0 → 1 → poslat čísla → 2) → admin záložka Obrázky (nejdřív „Jen zkouška").
- [ ] **Kolektivní paměť rozpoznávání (Neon, nejspíš od 9. 10.)** — celá běží přes Worker v Neonu (`/v1/hash-cache`), cizí klíč tam není. Problém: `card_hashes` v Neonu je prázdná → nejdřív databáze otisků, pak `card-matcher.js` (otisk z vyříznuté karty přes CardVision). Tabulka `card_match_cache` v Supabase je stará, nepoužívá se.
- [ ] **Fronta ověření (Neon, nejspíš od 9. 10.)** — admin nástroj PokéDB (karty s `verified = false`). Zjistit, proč je prázdná — nejspíš import vkládá rovnou `verified = true`.
- [ ] **Limity přihlašování** — zkontrolovat Supabase → Authentication → Rate Limits (skutečná ochrana proti zkoušení hesel). Blokaci IP v prohlížeči NEPROGRAMOVAT: IP hlásí prohlížeč → útočník ji obejde a šlo by s ní blokovat cizí IP.
- [ ] **České překlady v PokéDB** — `translated: 0`.

## 🟢 3. Vylepšení

- [ ] **Párování vzájemných výměn — PŘIPRAVENO, NASADIT:** `vymeny_parovani.sql` + `profile.html`. Seznam shod na profilu, notifikace oběma (max 1× za 7 dní na dvojici), jen pro lidi se zapnutým párováním.
  - Navazuje: trade kruhy A→B→C→A (na profilu označeno „připravujeme"); zmínit párování v příručce.
- [ ] **CAPTCHA (Turnstile) — PŘIPRAVENO, ZATÍM VYPNUTÁ.** Nasadit hned (nic se nezmění): `captcha.js`, `login.html`, `register.html`, `reset-password.html`, `mobile.html`, `settings-panel.js`, `topbar.js`, `api/v1/[...path].js`.
  - Serverové `/api/v1/auth/login` a `/register` teď zapisují každé použití do Logů (kategorie **api-auth**). Opraveno: serverové přihlášení od 30. 9. nenacházelo e-mail (skryté profily).
  - **Zapnutí (až po ~týdnu bez záznamů api-auth):** 1) Cloudflare → Turnstile → Add widget (poke-trade.eu + www, Managed) → 2) Site Key do `captcha.js` (SITE_KEY), nasadit → 3) Supabase → Authentication → Attack Protection → CAPTCHA, Turnstile, Secret Key. Pořadí NEMĚNIT, jinak se nikdo nepřihlásí.
- [ ] **Demo alba = skutečné album — PŘIPRAVENO, NASADIT:** `moje-album.html` + `demo-karty.js`. Nepřihlášený dostane skutečné album s 9 ukázkovými kartami a 2 alby v paměti: filtry, hledání, řazení, detail se šipkami, mřížka i kniha, počítadla. Razítko DEMO na kartách. Nic se neukládá do databáze ani do prohlížeče (jinak by album-sync po přihlášení nahrál demo karty do účtu).
  - **Demo na dalších stránkách — PŘIPRAVENO, NASADIT:** nový `demo-karty.js` + `statistiky.html` (ukázkové grafy), `share-album.html`, `profile.html`, `transactions.html` (výzva s náhledem DEMO karet), `compare.html`, `queue.html` (návrat po přihlášení).
  - Původní poznámka: — album: 3 ukázkové karty; obchod: jen prohlížení (`demo-cards.js` existuje, není zapojený).
- [ ] **Záloha PokéDB v R2 — PŘIPRAVENO, NASADIT:** `worker.js`. Úspěšné odpovědi (karty, sady, detail, varianty, ceny) se ukládají do R2 (max 1× za 6 h na dotaz); při výpadku Neonu se vrátí poslední kopie s hlavičkou `X-PokeDB-Zdroj: zaloha-r2`. Plnit se začne, až Neon poběží (9. 10.).
- [ ] **PokéDB jako hlavní zdroj vyhledávání** (teď až jako záloha).
- [ ] **Společný modul pro AI rozpoznání** — `ai-rozpoznani.js`: jedno zadání (jazyk, anglický název, volitelně stav), odolné čtení odpovědi (přemýšlení qwen3, text okolo, čárky navíc).
  - **Pilot PŘIPRAVEN, NASADIT:** `ai-rozpoznani.js`, `marketplace.html`, `marketplace.js` (přidání nabídky + poptávka). → Vyzkoušet na pár skutečných kartách (anglická i japonská).
  - Pak postupně: `image-search.js`, `moje-album.html`, `card-search.js`, `bulk-scan.html`, `mobile.html`, nakonec `queue.html` (hlavní cesta do alba).
- [ ] **Přeložit zbylé stránky** — fronta, profil, PokéDB, příručka, přihlášení, mobil.
- [ ] **Bulk-scan** — hledání rohů přes CardVision místo AI.
- [ ] **Databáze otisků** v R2 (generátor ve worker.js) → zapojit do `card-matcher.js`.
- [ ] **Detektor padělků v4 — PŘIPRAVENO, NASADIT:** `fake-detector.js` (používají chat, compare, marketplace, queue). Opravená znalostní báze, komunita jen jako tip (ne váha verdiktu), srovnávací obrázek jen se stejným číslem karty, volitelná zadní strana, pojistky verdiktu (nikdy „FALZIFIKÁT" s nízkou jistotou nebo bez vážného nálezu), ruční testy, odolné čtení odpovědi.
  - Nápad dál: objektivní srovnání otiskem (CardVision) uživatelovy karty s oficiálním obrázkem — bez AI, jako další signál.
- [ ] **Obrys v hledáčku mobilu** pro stojanový i ruční sken.
- [ ] **Stojan + podavač na webu — PŘIPRAVENO, NASADIT:** složka `stojan/` (STL stojan 150/200, podavač, SCAD, náhledy) + `queue.html` (záložka 📐 Stojan & podavač, `?tab=stojan`, přístupná i bez přihlášení) + `mobile.html` (odkaz z režimu stojanu). Podavač = gravitační skluzavka s kapsou, karty se skládají na sebe (~45 na dávku). Zbývá: vytisknout a vyzkoušet (sklon, dopad karty).
  - 2. 10.: + lehká lepená verze (−47 % materiálu: deska s drážkami + rámové nohy; podavač kapsa + skluz), podpis poke-trade.eu na modelech i v hlavičce STL, licence CC BY-NC-SA 4.0 (`stojan/LICENCE.txt`). Opraveno: tisková verze stojanu se otáčela zrcadlením (nápis by byl zrcadlově).
- [ ] Klíče AI poskytovatelů se načítají 7 samostatnými dotazy na `user_api_keys` — sloučit do jednoho.
- [ ] **Převod domény k WEDOS** do dubna 2027 (platí do 1. 5. 2027; úspora ~170 Kč/rok). Předem si opsat DNS záznamy z FORPSI.

## ❓ Čeká na tvoje rozhodnutí

- [ ] VIP pro LordLukona a Czeczika (mají doživotní z akce „prvních 10").
- [ ] Potvrdit, že **Beast** má mít admina (admin + whitelist).
- [ ] Rodina vidí **všechny** karty ostatních členů, ne jen ve sdílených albech — je to záměr?

## 🧹 Úklid

- [ ] Smazat `scanner.html` (jen přesměrovává).
- [ ] Starý sloupec `profiles.groq_api_key` — klíče už ostatní nevidí; zjistit dotazem (b) z `bezpecnost_oprava.sql`, jestli tam něco je, a přesunout do `user_api_keys`.
- [ ] Smazat `shares.js` a `notifications.js` v kořeni — staré serverové soubory, nikdo je nevolá.
- [ ] Smazat tabulku `album_shares_old_backup`.
- [ ] Smazat prázdný trigger `on_chat_message_insert` na `chat_messages`.

---

## ✅ Hotovo

- **30. 9.** Bezpečnostní oprava Supabase: sebepovýšení na admina/VIP, veřejné pohledy s e-maily a IP, whitelist VIP, blokace IP jen adminem, funkční odměny za doporučení, odstraněna překážka kolektivní paměti, odkazy notifikací na novou doménu, výchozí AI model.
- **30. 9.** Záloha pokemontcg.io přes TCGdex (`tcg-zdroj.js` + 8 souborů). NASAZENO — 1. 10. nalezena chyba se špatnými kartami, viz Funkčnost.
- **30. 9.** `vercel.json`: serverové funkce ve Frankfurtu. NASAZENO.
- **30. 9.** Upozornění na hlídané karty a nové nabídky rozesílá databáze (dřív nepřišlo nic). NASAZENO.
- **30. 9.** Párování vzájemných výměn. NASAZENO.
- **30. 9.** Hero sekce úvodní stránky na TCGdex (zásobník 24 h). NASAZENO.
- **30. 9.** Přepínač párování ukládá správně; Bulk Scan pouští všechny VIP. NASAZENO.
- **30. 9.** Hodnocení prodejců a kupujících se přepočítává automaticky. NASAZENO.
- **30. 9.** Security Advisor: 0 chyb, varování 46 → 26. Zbylá jsou záměrná: `current_user_is_admin`, `je_admin_nebo_server`, `je_ip_blokovana`, `get_homepage_stats`, `watch_counts`, `match_card_watches`, `is_blocked_pair`, `_report_mass_block` (volané bez přihlášení nebo uvnitř pravidel), admin funkce pro přihlášené, `pg_trgm` v public, kontrola uniklých hesel (nastavení / placený plán). NASAZENO.
- **30. 9.** Obnova přihlášení opravena (`topbar.js`) — po vypršení tokenu padala. NASAZENO.
- **30. 9.** Seznam blokovaných IP jen pro admina, stránky se ptají funkcí ano/ne. NASAZENO.
- **30. 9.** Cache cen (`card_cache`) a počítadlo RapidAPI: zapisuje jen server. NASAZENO.
- **30. 9.** Kontrola po opravě: žádný neoprávněný admin ani VIP (admini: Loyd, Ash, Beast).
- **30. 9.** Soukromí profilů NASAZENO (i dodatečně zrušené pravidlo „Přihlášený vidí username ostatních"): cizí profily jen přes `public_profiles` (bez e-mailu), pozvánka do rodiny jen podle celého e-mailu, opravena kontrola obsazené přezdívky při registraci.
- **30. 9.** Upomínka „FORPSI" ověřena jako phishing — doména v pořádku.
- **29. 9.** Úsporný režim Neonu, card-vision.js, logger, VIP po 5 kartách, stojan-mode na mobilu, jazykové vyhledávání, doplňování obrázků v adminu, oprava odkazu na reset hesla.
