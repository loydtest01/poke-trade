-- ══════════════════════════════════════════════════════════════════
-- migration_reset_cardmarket_urls.sql
-- 
-- Resetuje uložené cardmarketUrl a pricesFetchedAt pro všechny karty,
-- aby se při příštím otevření detailu načetly znovu přes opravenou logiku.
--
-- Důvod: Bugfix v fetchLivePrices – čísla s leading zeros (001, 009...)
-- mohla najít špatnou kartu (např. POP Series místo Celebrations).
-- ══════════════════════════════════════════════════════════════════

-- 1. Reset POUZE karet které mají uložený cardmarketUrl (byly fetchnuty)
UPDATE user_cards 
SET 
  card_data    = card_data || '{"cardmarketUrl": "", "pricesFetchedAt": null}'::jsonb,
  updated_at   = NOW()
WHERE 
  card_data->>'cardmarketUrl' IS NOT NULL 
  AND card_data->>'cardmarketUrl' != '';

-- Výsledek: kolik karet bylo resetováno
SELECT 
  COUNT(*) AS resetovano_karet,
  NOW()    AS cas_migrace
FROM user_cards 
WHERE card_data->>'cardmarketUrl' = ''
  AND (card_data->>'pricesFetchedAt') IS NULL;

-- ══════════════════════════════════════════════════════════════════
-- Volitelně: reset VŠECH karet (i těch bez uloženého URL)
-- Odkomentuj pokud chceš re-fetch úplně všech cen:
-- ══════════════════════════════════════════════════════════════════
-- UPDATE user_cards 
-- SET 
--   card_data  = card_data || '{"cardmarketUrl": "", "pricesFetchedAt": null}'::jsonb,
--   updated_at = NOW();
