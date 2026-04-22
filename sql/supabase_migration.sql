-- ════════════════════════════════════════════════════════════════
-- CardMatcher – Supabase SQL migrace
-- Spusť v: Supabase → SQL Editor → New query → Run
-- ════════════════════════════════════════════════════════════════

-- ── Tabulka předpočítaných pHashů z pokemontcg.io ──────────────
CREATE TABLE IF NOT EXISTS card_hashes (
  card_id   TEXT PRIMARY KEY,   -- pokemontcg.io ID, např. "sv3pt5-054"
  phash     TEXT NOT NULL,      -- 16-char hex (64-bit pHash)
  name      TEXT,               -- EN jméno, pro fallback text search
  set_id    TEXT,               -- set ID, např. "sv3pt5"
  number    TEXT,               -- číslo karty, např. "054"
  image_url TEXT                -- URL obrázku (nepovinné)
);

CREATE INDEX IF NOT EXISTS idx_card_hashes_phash ON card_hashes (phash);
CREATE INDEX IF NOT EXISTS idx_card_hashes_name  ON card_hashes USING GIN (to_tsvector('english', coalesce(name, '')));

-- ── Tabulka potvrzení od uživatelů (kolektivní paměť) ──────────
CREATE TABLE IF NOT EXISTS card_match_cache (
  phash              TEXT PRIMARY KEY,   -- pHash naskenované karty
  card_id            TEXT NOT NULL,      -- potvrzené card ID
  confirmed_count    INT  DEFAULT 1,
  confirmed_by       UUID,               -- UUID prvního uživatele
  last_confirmed_at  TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (card_id) REFERENCES card_hashes (card_id) ON DELETE CASCADE
);

-- ── RLS (Row Level Security) ────────────────────────────────────
ALTER TABLE card_hashes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_match_cache ENABLE ROW LEVEL SECURITY;

-- card_hashes: čtení pro všechny, zápis jen pro service_role (import CSV)
CREATE POLICY "card_hashes_read"  ON card_hashes FOR SELECT USING (true);
CREATE POLICY "card_hashes_write" ON card_hashes FOR ALL    USING (auth.role() = 'service_role');

-- card_match_cache: čtení pro všechny, zápis pro přihlášené uživatele
CREATE POLICY "cache_read"   ON card_match_cache FOR SELECT USING (true);
CREATE POLICY "cache_write"  ON card_match_cache FOR INSERT USING (auth.uid() IS NOT NULL);
CREATE POLICY "cache_update" ON card_match_cache FOR UPDATE USING (auth.uid() IS NOT NULL);

-- ── Postgres funkce pro atomický upsert potvrzení ───────────────
CREATE OR REPLACE FUNCTION increment_card_confirmation(
  p_phash   TEXT,
  p_card_id TEXT,
  p_user_id UUID
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO card_match_cache (phash, card_id, confirmed_count, confirmed_by, last_confirmed_at)
  VALUES (p_phash, p_card_id, 1, p_user_id, NOW())
  ON CONFLICT (phash) DO UPDATE SET
    confirmed_count   = card_match_cache.confirmed_count + 1,
    last_confirmed_at = NOW();
END;
$$;
