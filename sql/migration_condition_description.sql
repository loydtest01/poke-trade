-- ────────────────────────────────────────────────────────────────
-- MIGRACE: condition_description
-- Přidá sloupec condition_description do tabulky listings.
-- Používá se pro AI popis stavu karty v lightboxu (lupa).
-- Spustit v Supabase → SQL Editor.
-- ────────────────────────────────────────────────────────────────

-- 1. Přidat sloupec (bezpečně – pokud už existuje, nic se nestane)
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS condition_description TEXT;

-- 2. Komentář pro přehlednost
COMMENT ON COLUMN listings.condition_description IS
  'AI popis stavu karty (NM/LP/MP/HP/D + detaily). Zobrazuje se v lightboxu, uživatel ho může upravit.';

-- 3. Zkopírovat starý description → condition_description u nabídek,
--    kde condition_description je prázdný a description vypadá jako stav karty
--    (obsahuje slova jako NM, LP, rohů, povrch, škrábance apod.)
UPDATE listings
SET    condition_description = description
WHERE  condition_description IS NULL
  AND  description IS NOT NULL
  AND  (
         description ILIKE '%NM%'
      OR description ILIKE '%LP%'
      OR description ILIKE '%MP%'
      OR description ILIKE '%HP%'
      OR description ILIKE '% stav%'
      OR description ILIKE '%povrch%'
      OR description ILIKE '%rohy%'
      OR description ILIKE '%škrábance%'
      OR description ILIKE '%opotřeben%'
  );

-- ────────────────────────────────────────────────────────────────
-- Ověření – spusť po migraci, měl by vrátit seznam sloupců listings
-- ────────────────────────────────────────────────────────────────
-- SELECT column_name, data_type
-- FROM   information_schema.columns
-- WHERE  table_name = 'listings'
-- ORDER  BY ordinal_position;
