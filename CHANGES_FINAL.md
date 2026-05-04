# PokéTrade — Finální balík (3-vrstvé VIP + admin VIP správa + API consolidace)

## 🎯 VIP systém — finální podoba

| Tier | Kdo | Doba | AI limit | Featured | Free funkce |
|------|-----|------|----------|----------|-------------|
| **whitelist** | Loyd, rodina (10 účtů) | navždy | bez limitu | 3 | ano |
| **lifetime_first_10** | prvních 10 reálných uživatelů | navždy | bez limitu | 3 | ano |
| **first_100** | uživatelé 11-110 | 30 dní | **80% lifetime kvóty** | 3 | ano |
| **standard** | uživatelé 111+ | 14 dní | **80% lifetime kvóty** | 3 | ano |
| **extended** | kdokoliv s referrals | bonus +30 dní | 80% kvóty | 3 | ano |
| **manual** | admin grant | dle volby | 80% kvóty | 3 | ano |
| **free** | po expiraci | — | **20 search + 5 fake/den** | 0 | omezené |

**Klíčový princip:**
- **Lifetime** dostává tolik kolik se vejde do dynamic poolu (fairShare = pool × share / activeUsers)
- **Regular VIP** dostává **80% lifetime kvóty** — pořád výrazně víc než free, ale s pojistkou pro pool
- **Free** má pevné minimum 20+5 nezávisle na poolu (nemůže si vyčerpat sdílené zdroje)

## 🆕 Co je nového vs předchozí balík

### ⭐ Lifetime VIP — prvních 10 (ne 20)
- Counter `lifetime_vip_granted` jde 0→10
- vip_source: `lifetime_first_10`
- Hlavní stránka: "⭐ Prvních 10 uživatelů dostane VIP NAVŽDY!"

### 🎚️ 3-vrstvé rate limity v `groq.js`
- Nová funkce `getUserVipTier(userId, email)` → 'lifetime' / 'regular' / 'free'
- Lifetime → `proxyToProviderWithRotation` přímo (bez rate check)
- Regular → fairShare × 0.80
- Free → fixed 20/5 (nezávisle na poolu)
- Vylepšená error hláška na 429 (referral hint pro free, tip na vlastní klíč pro regular)

### 🛡️ Admin panel — VIP správa
- Záložka "⭐ VIP správa" v `/admin-loyd.html`
- Seznam s spotřebou (dnes / 7 dní / total)
- Hledání, manuální grant/revoke
- Stat card "X/10 lifetime"

### 🔧 API consolidace (12 → 11 funkcí)
- `groq-key.js` → `groq.js?action=get-key`
- `admin-suspicious.js` → `v1/[...path].js` admin routy
- `groq.js` má DB-based VIP cache (z `vip_users` tabulky)

## 🚀 Deploy postup

### 1) SQL migrace (POŘADÍ DŮLEŽITÉ)

```sql
-- V Supabase SQL Editoru postupně:
\i sql/migration_vip_referral.sql              -- 1. (z předchozí session)
\i sql/migration_vip_all_featured_cloudflare.sql -- 2. (z předchozí session)
\i sql/migration_lifetime_vip_admin.sql        -- 3. (NOVÉ — finální verze s 10 lifetime)
```

Migrace #3 je **idempotentní** — můžeš ji bezpečně spustit i kdyby předchozí verze (s 20 sloty) byla použita. Přepíše funkce.

### 2) Smaž 2 staré API soubory

```bash
git rm api/groq-key.js api/admin-suspicious.js
```

### 3) Vercel ENV — `SUPABASE_SERVICE_KEY`

### 4) `vercel.json` rewrite pro `/r/:code`
```json
{ "rewrites": [{ "source": "/r/:code", "destination": "/index.html?ref=:code" }] }
```

### 5) Upload souborů z balíku

## 🧪 Test checklist

1. ✅ `SELECT * FROM lifetime_vip_status;` → granted=0, remaining=10, total=10
2. ✅ `api/groq-key.js` SMAZÁNO
3. ✅ `api/admin-suspicious.js` SMAZÁNO
4. ✅ Hlavní stránka jako nepřihlášený zobrazí "⭐ Prvních 10 uživatelů dostane VIP NAVŽDY"
5. ✅ V admin panelu záložka "VIP správa" zobrazuje seznam + grant formulář
6. ✅ Stat card v dashboardu: "0/10 lifetime"
7. ✅ Manuální grant: vyber Lifetime → klik Udělit → success
8. ✅ AI scan jako free user: GET /api/groq?info=usage vrátí `tier: 'free', search.limit: 20, fake.limit: 5`
9. ✅ AI scan jako regular VIP: vrátí `tier: 'regular', search.limit: ~240` (80% z lifetime)
10. ✅ AI scan jako lifetime: vrátí `tier: 'lifetime', message: 'Bez limitu (Lifetime VIP)'`

## 📊 Provider kapacita (znovu pro úplnost)

Tvůj pool: 7 Groq + 9 OpenRouter + 10 Cerebras + 3 Mistral + 6 Cloudflare + 1 Gemini + 1 Grok

Pro **120 VIP účtů** (10 whitelist + 10 lifetime + 100 first_100):
- Reálně aktivních (8 Loydových účtů neaktivní): ~12 lifetime + 100 regular = **112 aktivních**
- Při průměru 50 scanů/den/aktivní VIP = ~5600 scanů/den
- Cerebras pool: 10M tokens/den = **bezpečná rezerva 10×**
- Cloudflare pool: 60k Neuronů/den = ~6000 scanů/den = **OK**
- Free uživatelé (po expiraci 14 dní): pevné 20+5/den nečerpá pool

## ⚙️ Co se děje při změně počtu klíčů

`getDailyPool()` automaticky čte `process.env.GROQ_API_KEY` (split podle čárky) — když přidáš víc klíčů do Vercelu (bez deploye, jen ENV var update), pool naroste a:
- Lifetime tier: dostane víc requestů (fairShare × 1.0)
- Regular tier: dostane víc requestů (fairShare × 0.80)
- Free tier: zůstává 20+5 (nezávislý na poolu)

## ⏳ Co zbývá pro příští session

- Resend migrace v `email-digest.js`
- VIP gating v scanner.html / queue.html
- Wishlist + Price Drop Alerts
- Verified Seller systém
