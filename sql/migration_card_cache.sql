-- ════════════════════════════════════════════════════════════════
-- migration_card_cache.sql
-- Komunitní cache karet pro non-EN varianty (JP, ZH, KO, ...)
--
-- SPUSTIT V: Supabase Dashboard → SQL Editor
-- ════════════════════════════════════════════════════════════════

-- ── 1. Tabulka ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS card_cache (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Unikátní klíč pro lookup: "toxic spikes|s8f|12|jp"
  cache_key        text        NOT NULL UNIQUE,

  -- Základní identifikace
  name             text,          -- původní název (JP/ZH/KO)
  name_en          text,          -- anglický ekvivalent
  set_code         text,          -- např. "s8f", "swsh8"
  set_name         text,
  card_number      text,          -- číslo bez lomítka a bez úvodních nul
  lang             text,          -- "JP", "ZH", "KO", ...

  -- Obrázek + odkaz
  image_url        text,
  cardmarket_url   text,

  -- Ceny (EUR, z Cardmarket)
  price_trend      numeric(10,2) DEFAULT 0,
  price_min        numeric(10,2) DEFAULT 0,
  price_30d        numeric(10,2) DEFAULT 0,

  -- Metadata
  source           text          DEFAULT 'rapidapi',  -- 'rapidapi' | 'manual'
  raw_data         jsonb,                             -- celá odpověď z API
  added_by         uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  fetched_at       timestamptz   DEFAULT now(),       -- kdy byla karta poprvé stažena
  price_updated_at timestamptz   DEFAULT now()        -- kdy byly ceny naposledy refreshnuty
);

-- ── 2. Indexy ─────────────────────────────────────────────────
-- Primární lookup
CREATE INDEX IF NOT EXISTS idx_card_cache_key     ON card_cache (cache_key);
-- Vyhledávání podle jména (full-text nebo LIKE)
CREATE INDEX IF NOT EXISTS idx_card_cache_name_en ON card_cache (name_en);
CREATE INDEX IF NOT EXISTS idx_card_cache_lang    ON card_cache (lang);
-- Pro price refresh cron job (WHERE price_updated_at < now() - interval '7 days')
CREATE INDEX IF NOT EXISTS idx_card_cache_price_age
  ON card_cache (price_updated_at)
  WHERE source = 'rapidapi';

-- ── 3. RLS ───────────────────────────────────────────────────
ALTER TABLE card_cache ENABLE ROW LEVEL SECURITY;

-- Číst smí každý přihlášený uživatel (komunitní databáze)
CREATE POLICY "card_cache_read"
  ON card_cache FOR SELECT
  TO authenticated
  USING (true);

-- Vkládat smí každý přihlášený (první kdo najde kartu ji sdílí)
CREATE POLICY "card_cache_insert"
  ON card_cache FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = added_by);

-- Aktualizovat ceny smí kdokoliv (price refresh je sdílený)
CREATE POLICY "card_cache_update_prices"
  ON card_cache FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ── 4. Pomocná view pro queue.html ───────────────────────────
-- Jednoduché API: SELECT * FROM card_cache_public WHERE cache_key = '...'
CREATE OR REPLACE VIEW card_cache_public AS
  SELECT
    cache_key, name, name_en, set_code, set_name,
    card_number, lang, image_url, cardmarket_url,
    price_trend, price_min, price_30d, source,
    fetched_at, price_updated_at
  FROM card_cache;

-- ── 5. Funkce pro vyhledávání bez přesného klíče ─────────────
-- Použití: SELECT * FROM search_card_cache('toxic spikes', 'JP', 5);
CREATE OR REPLACE FUNCTION search_card_cache(
  p_name text,
  p_lang text DEFAULT NULL,
  p_limit int DEFAULT 10
)
RETURNS SETOF card_cache_public
LANGUAGE sql STABLE
AS $$
  SELECT *
  FROM card_cache_public
  WHERE
    (name_en ILIKE '%' || p_name || '%' OR name ILIKE '%' || p_name || '%')
    AND (p_lang IS NULL OR lang = upper(p_lang))
  ORDER BY
    -- Přesná shoda jde první
    CASE WHEN lower(name_en) = lower(p_name) THEN 0 ELSE 1 END,
    fetched_at DESC
  LIMIT p_limit;
$$;

-- ════════════════════════════════════════════════════════════════
-- Hotovo. Ověř spuštěním:
--   SELECT * FROM card_cache LIMIT 1;
--   SELECT search_card_cache('Pikachu', 'JP', 3);
-- ════════════════════════════════════════════════════════════════
