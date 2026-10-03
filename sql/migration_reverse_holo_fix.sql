-- ══════════════════════════════════════════════════════════════════════
-- MIGRACE: Reverse Holo URL fix
-- Problém: karty s variant='Reverse Holo' měly cardmarketUrl bez ?isReverseHolo=Y
--          → zobrazovaly se ceny jako Normal karta
-- Řešení:  přidáme ?isReverseHolo=Y ke stávajícím Reverse Holo URL
-- Spustit: jednorázově v Supabase SQL editoru
-- ══════════════════════════════════════════════════════════════════════

-- 1. Přidej param k existujícím Reverse Holo kartám kde URL chybí param
UPDATE user_cards
SET card_data = jsonb_set(
  card_data,
  '{cardmarketUrl}',
  to_jsonb(
    -- Odstraň starý param (pro jistotu) a přidej nový
    regexp_replace(
      card_data->>'cardmarketUrl',
      '\?isReverseHolo=.*$',
      ''
    ) || '?isReverseHolo=Y'
  )
)
WHERE
  -- pouze Reverse Holo karty
  lower(card_data->>'variant') LIKE '%reverse%'
  -- pouze ty co mají cardmarketUrl (ne prázdné)
  AND card_data->>'cardmarketUrl' IS NOT NULL
  AND card_data->>'cardmarketUrl' != ''
  -- a ještě nemají param
  AND card_data->>'cardmarketUrl' NOT LIKE '%isReverseHolo%';

-- 2. Výsledek – kolik karet bylo opraveno
-- (spusť zvlášť jako SELECT před UPDATE pokud chceš náhled)
-- SELECT count(*) FROM user_cards
-- WHERE lower(card_data->>'variant') LIKE '%reverse%'
--   AND card_data->>'cardmarketUrl' IS NOT NULL
--   AND card_data->>'cardmarketUrl' != ''
--   AND card_data->>'cardmarketUrl' NOT LIKE '%isReverseHolo%';
