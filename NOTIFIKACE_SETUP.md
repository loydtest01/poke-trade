# 📧 Nastavení emailových upozornění — PokéTrade

## 1. Supabase — spusť SQL migraci

Otevři **Supabase → SQL Editor** a spusť soubor:
```
sql/migration_notification_prefs.sql
```

Přidá:
- sloupec `notification_prefs` (JSONB) do tabulky `profiles`
- sloupec `listing_category` do tabulky `listings`

---

## 2. Vercel — nastav Environment Variables

Otevři **Vercel → tvůj projekt → Settings → Environment Variables** a přidej:

| Proměnná | Hodnota |
|---|---|
| `GMAIL_USER` | `pokecards.app.info@gmail.com` |
| `GMAIL_PASS` | Tvůj Gmail App Password (16 znaků bez mezer) |
| `SUPABASE_SERVICE_KEY` | Service role klíč — Supabase → Settings → API → `service_role` |
| `CRON_SECRET` | Libovolný tajný řetězec, např. `moje-tajne-heslo-123` |

> ⚠️ `SUPABASE_SERVICE_KEY` je citlivý klíč — nikdy ho nedávej do kódu, jen do Vercel env vars!

---

## 3. Ověř Gmail App Password

Pokud ho ještě nemáš:
1. Google účet → Bezpečnost → Dvoufázové ověření (musí být zapnuto)
2. Hledat „App passwords" → vygeneruj pro „Mail"
3. Zkopíruj 16znakový kód (bez mezer)

---

## 4. Cron — automatické spouštění

`vercel.json` je nastaveno na:
- **Denní digest**: každý den v **7:00 UTC** (8:00 nebo 9:00 CZ dle letního času)
- **Týdenní digest**: každé **pondělí v 7:00 UTC**

> Cron joby fungují pouze na **Vercel Hobby planu a výše** (Hobby má 2 cron joby zdarma ✅)

### Ruční spuštění (testování):
```
https://tvuj-projekt.vercel.app/api/cron/email-digest?secret=CRON_SECRET&mode=daily
https://tvuj-projekt.vercel.app/api/cron/email-digest?secret=CRON_SECRET&mode=weekly
```

---

## 5. Jak to funguje end-to-end

```
Uživatel vytvoří nabídku na marketplace.html
    ↓
dispatchListingNotifications() — okamžitě
    ↓
In-app notifikace (zvoneček) pro uživatele s inapp_listings=true
    ↓
Emailový digest — cron každý den/týden
    ↓
Email přes Gmail SMTP (Nodemailer) s přehledem nabídek
```

### Co si uživatel nastaví v Settings panelu:
- ✅/❌ Nové nabídky (kategorie: vše / kartičky / sealed)
- ✅/❌ Cenné karty (nad nastavenou hranici EUR)
- ✅/❌ Wishlist k dispozici
- ✅/❌ Nabídky k výměně
- ✅/❌ Týdenní přehled
- ✅/❌ Nové zprávy
- ⚡/📅/📆 Frekvence: ihned / denně / týdně
- In-app notifikace zvlášť pro: nabídky / wishlist / zprávy

Nastavení se ukládá do `localStorage` (okamžitě) i do Supabase `profiles.notification_prefs` (při kliknutí Uložit).

---

## 6. Soubory co byly změněny

| Soubor | Co se změnilo |
|---|---|
| `topbar.js` | Nová sekce „Emailová upozornění" v settings panelu |
| `marketplace.js` | Po vytvoření nabídky volá `dispatchListingNotifications()` |
| `api/cron/email-digest.js` | **Nový** — Vercel cron, Nodemailer, HTML email šablona |
| `vercel.json` | Přidány 2 cron scheduly |
| `sql/migration_notification_prefs.sql` | **Nový** — DB migrace |
