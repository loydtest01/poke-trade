-- ============================================================
-- Migrace: přidat batch_id do user_card_photos
-- Spusť v Supabase → SQL editor
-- ============================================================

-- 1. Přidat sloupec batch_id (text, nullable)
ALTER TABLE user_card_photos
  ADD COLUMN IF NOT EXISTS batch_id text;

-- 2. Index pro rychlé dotazy dle batch_id
CREATE INDEX IF NOT EXISTS idx_user_card_photos_batch_id
  ON user_card_photos (batch_id)
  WHERE batch_id IS NOT NULL;

-- 3. Hotovo – ověření
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'user_card_photos'
ORDER BY ordinal_position;
