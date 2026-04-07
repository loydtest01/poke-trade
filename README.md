# PokéScanner – webová aplikace

Malá standalone webová aplikace pro skenování a ukládání Pokémon karet.

## Soubory

```
scanner-app/
├── scanner.html      ← celá aplikace (SPA)
├── api/
│   └── groq.js       ← Vercel serverless proxy pro Groq API
└── vercel.json       ← Vercel konfigurace
```

## Deploy na Vercel

1. Zkopíruj `scanner.html`, `api/groq.js` a `vercel.json` do tvého `pokemon-market-v2` projektu
2. Zkopíruj tam i `wallpaper.png` a `pokemon.png` ze stávajícího projektu (kvůli pozadí)
3. Push na GitHub → Vercel automaticky nasadí
4. Přístup přes: `https://tvuj-projekt.vercel.app/scanner.html`

## Jak to funguje

### Přihlášení
- Stejný Supabase účet jako web (PokéTrade)
- Funguje username i e-mail
- Odkaz na registraci → pokemon-trade-ruddy.vercel.app/register.html

### Nastavení Groq
1. Jdi na https://console.groq.com → Sign Up (zdarma, bez karty)
2. API Keys → Create API Key (začíná `gsk_`)
3. Vlož klíč v ⚙️ Nastavení v aplikaci
4. Klíč se uloží jen do localStorage tvého prohlížeče

### Skenování karet
1. Klikni na upload zónu nebo přetáhni fotky
2. Na mobilu → otevře kameru nebo galerii
3. Klikni "🤖 Rozpoznat kartičky" → Groq AI identifikuje
4. Stáhnou se data z TCGdex (název, HP, typy, obrázek)
5. Uprav případné chyby v editovatelných polích
6. Zaškrtni karty k uložení → "💾 Uložit do alba"

### Groq proxy
Vercel funkce `/api/groq.js` přijímá Groq API klíč v záhlaví `X-Groq-Key`
a přeposílá requesty na api.groq.com. Obchází CORS a schovává klíč mimo frontend URL.

Volitelně lze nastavit serverový klíč přes Vercel env proměnnou `GROQ_API_KEY`
(pak uživatelé nemusí zadávat vlastní – ale platíš za všechny).
