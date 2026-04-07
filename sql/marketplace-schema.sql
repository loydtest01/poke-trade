-- ═══════════════════════════════════════════════════════════════
--  PokéTrade – Marketplace rozšíření
--  Spusť v Supabase → SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════════

-- ── 1. ROZŠÍŘENÍ TABULKY LISTINGS ─────────────────────────────
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS description    TEXT,
  ADD COLUMN IF NOT EXISTS price_czk      INT,
  ADD COLUMN IF NOT EXISTS price_eur      NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS allow_trade    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_offer    BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS trade_wants    TEXT,
  ADD COLUMN IF NOT EXISTS card_name      TEXT,
  ADD COLUMN IF NOT EXISTS card_set       TEXT,
  ADD COLUMN IF NOT EXISTS card_number    TEXT,
  ADD COLUMN IF NOT EXISTS card_hp        TEXT,
  ADD COLUMN IF NOT EXISTS card_type      TEXT,
  ADD COLUMN IF NOT EXISTS card_rarity    TEXT,
  ADD COLUMN IF NOT EXISTS card_condition TEXT DEFAULT 'NM',
  ADD COLUMN IF NOT EXISTS api_image_url  TEXT,
  ADD COLUMN IF NOT EXISTS view_count     INT DEFAULT 0;

-- ── 2. FOTKY K NABÍDKÁM ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS listing_photos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  UUID REFERENCES listings(id) ON DELETE CASCADE,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  order_index  INT DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE listing_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Fotky vidí všichni" ON listing_photos
  FOR SELECT USING (true);

CREATE POLICY "Vlastník může přidávat fotky" ON listing_photos
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Vlastník může mazat fotky" ON listing_photos
  FOR DELETE USING (auth.uid() = user_id);

-- ── 3. ZPRÁVY ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id   UUID REFERENCES listings(id) ON DELETE CASCADE,
  sender_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  receiver_id  UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_username   TEXT,
  receiver_username TEXT,
  text         TEXT NOT NULL,
  read         BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_listing_idx   ON messages(listing_id);
CREATE INDEX IF NOT EXISTS messages_sender_idx    ON messages(sender_id);
CREATE INDEX IF NOT EXISTS messages_receiver_idx  ON messages(receiver_id);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Zprávy vidí jen účastníci" ON messages
  FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

CREATE POLICY "Přihlášený může posílat zprávy" ON messages
  FOR INSERT WITH CHECK (auth.uid() = sender_id);

CREATE POLICY "Příjemce může označit jako přečtené" ON messages
  FOR UPDATE USING (auth.uid() = receiver_id);

-- ── 4. ROZŠÍŘENÍ OFFERS O VÝMĚNNÉ KARTY ──────────────────────
ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS trade_card_ids   JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS trade_card_names TEXT;

-- ── 5. SUPABASE STORAGE – bucket pro fotky ────────────────────
-- Spusť ručně v Supabase Dashboard → Storage → New bucket:
-- Název: listing-photos
-- Public: ANO
-- Max file size: 5 MB
-- Allowed MIME: image/jpeg, image/png, image/webp

-- ── 6. POMOCNÉ VIEW – nabídky s počtem zpráv ──────────────────
CREATE OR REPLACE VIEW listings_with_stats AS
SELECT
  l.*,
  COUNT(DISTINCT m.id) AS message_count,
  COUNT(DISTINCT o.id) AS offer_count_real,
  COUNT(DISTINCT p.id) AS photo_count
FROM listings l
LEFT JOIN messages m ON m.listing_id = l.id
LEFT JOIN offers   o ON o.listing_id = l.id AND o.status = 'pending'
LEFT JOIN listing_photos p ON p.listing_id = l.id
WHERE l.status = 'active'
GROUP BY l.id;

-- ── 7. FUNKCE – zvýšit počet zobrazení ────────────────────────
CREATE OR REPLACE FUNCTION increment_view_count(listing_uuid UUID)
RETURNS void AS $$
  UPDATE listings SET view_count = view_count + 1 WHERE id = listing_uuid;
$$ LANGUAGE sql SECURITY DEFINER;

-- ═══════════════════════════════════════════════════════════════
--  ✅ HOTOVO!
-- ═══════════════════════════════════════════════════════════════
