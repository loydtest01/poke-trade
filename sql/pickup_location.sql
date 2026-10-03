-- ════════════════════════════════════════════════════════════════
--  MÍSTO VYZVEDNUTÍ — sloupce pro mapu u osobního předání
--  Spustit v Supabase SQL editoru. Idempotentní.
-- ════════════════════════════════════════════════════════════════

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS pickup_lat        DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS pickup_lng        DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS pickup_precision  TEXT,   -- 'exact' | 'area'
  ADD COLUMN IF NOT EXISTS delivery_personal BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_post     BOOLEAN DEFAULT true;

-- (location sloupec už existuje; pokud ne, odkomentuj:)
-- ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS location TEXT;

-- Ověření
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'listings'
  AND column_name IN ('pickup_lat','pickup_lng','pickup_precision','delivery_personal','delivery_post','location')
ORDER BY column_name;
