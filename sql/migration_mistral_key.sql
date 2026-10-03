-- ═══════════════════════════════════════════════════════════════════
--  PokéTrade — Mistral AI Key Migration
--  ─────────────────────────────────────────────────────────────────
--  Přidává do user_api_keys sloupec mistral_key pro Mistral OCR
--  a Pixtral vision modely.
--
--  Použití: čtení textu z karet (OCR) — primárně pro JP/ZH karty
--  kde Mistral OCR 3 vrací mnohem přesnější CJK znaky než Llama.
--
--  Free tier: 1 miliarda tokenů/měsíc (registrace na console.mistral.ai,
--  jen telefonní ověření, žádná kreditka).
--
--  Bezpečné spustit vícekrát.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE user_api_keys
  ADD COLUMN IF NOT EXISTS mistral_key TEXT;

COMMENT ON COLUMN user_api_keys.mistral_key IS
  'Čárkami oddělený seznam Mistral API klíčů (pro OCR a Pixtral vision; preferován pro CJK karty)';

-- ═══════════════════════════════════════════════════════════════════
--  HOTOVO.
--
--  Po spuštění bude aplikace umět:
--   • ukládat Mistral klíče přes UI v profile.html
--   • používat je v api/mistral-ocr.js (Fáze 2) pro čtení textu z karet
--
--  UI pro přidávání klíčů: ai-providers-ui.js (patch v této session)
-- ═══════════════════════════════════════════════════════════════════
