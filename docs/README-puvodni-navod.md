# ⚡ PokéTrade – Návod k spuštění

## KROK 1 – Supabase databáze
Jdi na supabase.com → New project → Frankfurt → po vytvoření spusť supabase_setup.sql v SQL Editoru.
Zkopíruj Project URL a anon key ze Settings → API.

## KROK 2 – Vyplň údaje
V app.js a api/v1/[...path].js nahraď:
  SUPABASE_URL  = 'https://TVOJE_ID.supabase.co'
  SUPABASE_ANON = 'TVUJ_ANON_KEY'

## KROK 3 – Vercel
Jdi na vercel.com → Add New → Project → Deploy without Git → přetáhni tuto složku → Deploy.
Dostaneš URL jako https://pokemon-trade-xyz.vercel.app

## KROK 4 – Doplň Vercel URL
V app.js: VERCEL_URL = 'https://pokemon-trade-xyz.vercel.app'
Znovu nahraj na Vercel.

## KROK 5 – Propoj aplikaci
V online-market-NEW.js: API_BASE = 'https://pokemon-trade-xyz.vercel.app/v1'
V sync-NEW.js: MANIFEST_URL = 'https://pokemon-trade-xyz.vercel.app/pkc-manifest.json'
Nahraď app/js/online-market.js a app/js/sync.js těmito soubory.

## KROK 6 – Otestuj
1. Registrace na webu: /register.html
2. V aplikaci: ikona tržiště → Přihlásit se → stejné údaje
3. Vyber karty K výměně → Odeslat
4. Web → Nabídky → vidíš je!
