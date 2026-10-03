-- ═══════════════════════════════════════════════════════════════
-- MIGRACE: Přidání sloupce metadata do tabulky photo_queue
-- Spusť v Supabase → SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- Přidej sloupec metadata (JSONB) pokud ještě neexistuje
ALTER TABLE photo_queue
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Přidej index pro rychlejší dotazy
CREATE INDEX IF NOT EXISTS photo_queue_metadata_idx
  ON photo_queue USING gin(metadata);

-- Ověř strukturu tabulky
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'photo_queue'
ORDER BY ordinal_position;
