-- ═══════════════════════════════════════════════════════════════
--  PokéTrade – Supabase databázové schéma
--  Zkopíruj a spusť v Supabase → SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════════

-- ── 1. PROFILY UŽIVATELŮ ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username    TEXT NOT NULL UNIQUE,
  email       TEXT,
  avatar_url  TEXT,
  bio         TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- RLS (Row Level Security) – každý vidí profily, ale upravit může jen svůj
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profily jsou veřejné" ON profiles
  FOR SELECT USING (true);

CREATE POLICY "Uživatel může upravit svůj profil" ON profiles
  FOR ALL USING (auth.uid() = id);

-- ── 2. NABÍDKY (listings) ─────────────────────────────────────
-- Jedna nabídka = jeden nahraný .pkte soubor
CREATE TABLE IF NOT EXISTS listings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  username     TEXT NOT NULL,
  title        TEXT,
  cards_data   JSONB NOT NULL DEFAULT '[]',   -- pole karet (bez fotek)
  exchange_map JSONB DEFAULT '{}',             -- {cardId: {priceCzk, priceEur, count}}
  status       TEXT DEFAULT 'active' CHECK (status IN ('active','closed','deleted')),
  offer_count  INT DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Index pro rychlé hledání
CREATE INDEX IF NOT EXISTS listings_user_id_idx ON listings(user_id);
CREATE INDEX IF NOT EXISTS listings_status_idx  ON listings(status);
CREATE INDEX IF NOT EXISTS listings_cards_gin   ON listings USING gin(cards_data);

-- RLS
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Aktivní nabídky vidí všichni" ON listings
  FOR SELECT USING (status = 'active');

CREATE POLICY "Přihlášený uživatel může přidat nabídku" ON listings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Uživatel může upravit svou nabídku" ON listings
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Uživatel může smazat svou nabídku" ON listings
  FOR DELETE USING (auth.uid() = user_id);

-- ── 3. NABÍDKY OD KUPUJÍCÍCH (offers) ────────────────────────
CREATE TABLE IF NOT EXISTS offers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id         UUID REFERENCES listings(id) ON DELETE CASCADE,
  seller_id          UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  buyer_id           UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  buyer_username     TEXT,
  wanted_card_ids    TEXT[] DEFAULT '{}',      -- ID karet o které má zájem
  offer_type         TEXT DEFAULT 'price' CHECK (offer_type IN ('price','trade')),
  offered_price_czk  INT,
  trade_description  TEXT,
  message            TEXT,
  status             TEXT DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','cancelled')),
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Index
CREATE INDEX IF NOT EXISTS offers_listing_id_idx ON offers(listing_id);
CREATE INDEX IF NOT EXISTS offers_seller_id_idx  ON offers(seller_id);
CREATE INDEX IF NOT EXISTS offers_buyer_id_idx   ON offers(buyer_id);

-- RLS
ALTER TABLE offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Prodávající vidí nabídky na své listingy" ON offers
  FOR SELECT USING (auth.uid() = seller_id OR auth.uid() = buyer_id);

CREATE POLICY "Přihlášený uživatel může odeslat nabídku" ON offers
  FOR INSERT WITH CHECK (auth.uid() = buyer_id);

CREATE POLICY "Prodávající může aktualizovat stav nabídky" ON offers
  FOR UPDATE USING (auth.uid() = seller_id OR auth.uid() = buyer_id);

-- ── 4. AUTOMATICKY VYTVOŘIT PROFIL PO REGISTRACI ─────────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, username, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', split_part(NEW.email, '@', 1)),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ── 5. STATISTIKY (volitelné – pro homepage) ──────────────────
-- CREATE VIEW stats AS
-- SELECT
--   (SELECT COUNT(*) FROM profiles)  AS user_count,
--   (SELECT COUNT(*) FROM listings WHERE status='active') AS listing_count,
--   (SELECT COUNT(*) FROM offers WHERE status='accepted') AS trade_count;

-- ═══════════════════════════════════════════════════════════════
--  ✅ HOTOVO! Databáze je připravena.
-- ═══════════════════════════════════════════════════════════════
