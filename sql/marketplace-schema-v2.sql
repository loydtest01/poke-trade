-- ═══════════════════════════════════════════════════════════════
--  PokéTrade – Schema v2: Hodnocení + Poptávky
--  Spusť v Supabase → SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════════

-- ── 1. POPTÁVKY (demands) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS demands (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  username     TEXT NOT NULL,
  card_name    TEXT NOT NULL,
  card_set     TEXT,
  card_type    TEXT,
  card_rarity  TEXT,
  max_price_czk INT,
  description  TEXT,
  status       TEXT DEFAULT 'active' CHECK (status IN ('active','fulfilled','closed')),
  response_count INT DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS demands_user_id_idx  ON demands(user_id);
CREATE INDEX IF NOT EXISTS demands_status_idx   ON demands(status);
CREATE INDEX IF NOT EXISTS demands_card_name_idx ON demands(card_name);

ALTER TABLE demands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Aktivní poptávky vidí všichni" ON demands
  FOR SELECT USING (status = 'active');

CREATE POLICY "Přihlášený může přidat poptávku" ON demands
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Vlastník může upravit poptávku" ON demands
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Vlastník může smazat poptávku" ON demands
  FOR DELETE USING (auth.uid() = user_id);

-- ── 2. HODNOCENÍ (ratings) ────────────────────────────────────
-- Hodnocení je vždy vázáno na konkrétní offer (dokončenou transakci)
CREATE TABLE IF NOT EXISTS ratings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id           UUID REFERENCES offers(id) ON DELETE CASCADE,
  reviewer_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  reviewed_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  reviewer_username  TEXT,
  reviewed_username  TEXT,
  role               TEXT CHECK (role IN ('buyer','seller')),
  -- Seller hodnotí kupujícího (role='seller'):
  --   payment_speed, item_pickup
  -- Kupující hodnotí prodejce (role='buyer'):
  --   communication, delivery_speed, description_accuracy
  communication         INT CHECK (communication BETWEEN 1 AND 5),
  delivery_speed        INT CHECK (delivery_speed BETWEEN 1 AND 5),
  description_accuracy  INT CHECK (description_accuracy BETWEEN 1 AND 5),
  payment_speed         INT CHECK (payment_speed BETWEEN 1 AND 5),
  item_pickup           INT CHECK (item_pickup BETWEEN 1 AND 5),
  overall               INT GENERATED ALWAYS AS (
    CASE role
      WHEN 'buyer' THEN ROUND((communication + delivery_speed + description_accuracy)::numeric / 3)
      WHEN 'seller' THEN ROUND((COALESCE(payment_speed,3) + COALESCE(item_pickup,3))::numeric / 2)
      ELSE 3
    END
  ) STORED,
  comment    TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(offer_id, reviewer_id)
);

CREATE INDEX IF NOT EXISTS ratings_reviewed_idx ON ratings(reviewed_id);
CREATE INDEX IF NOT EXISTS ratings_reviewer_idx ON ratings(reviewer_id);
CREATE INDEX IF NOT EXISTS ratings_offer_idx    ON ratings(offer_id);

ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hodnocení jsou veřejná" ON ratings
  FOR SELECT USING (true);

CREATE POLICY "Přihlášený může hodnotit" ON ratings
  FOR INSERT WITH CHECK (auth.uid() = reviewer_id);

-- ── 3. POHLED – statistiky hodnocení uživatele ────────────────
CREATE OR REPLACE VIEW user_rating_stats AS
SELECT
  reviewed_id AS user_id,
  reviewed_username AS username,
  COUNT(*) AS total_ratings,
  ROUND(AVG(overall)::numeric, 1)                   AS avg_overall,
  ROUND(AVG(communication)::numeric * 20, 0)        AS pct_communication,
  ROUND(AVG(delivery_speed)::numeric * 20, 0)       AS pct_delivery_speed,
  ROUND(AVG(description_accuracy)::numeric * 20, 0) AS pct_description_accuracy,
  ROUND(AVG(payment_speed)::numeric * 20, 0)        AS pct_payment_speed,
  ROUND(AVG(item_pickup)::numeric * 20, 0)          AS pct_item_pickup,
  COUNT(*) FILTER (WHERE overall = 5) AS five_star,
  COUNT(*) FILTER (WHERE overall = 4) AS four_star,
  COUNT(*) FILTER (WHERE overall = 3) AS three_star,
  COUNT(*) FILTER (WHERE overall <= 2) AS low_star
FROM ratings
GROUP BY reviewed_id, reviewed_username;

-- ── 4. ROZŠÍŘENÍ PROFILES ─────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS bio         TEXT,
  ADD COLUMN IF NOT EXISTS location    TEXT,
  ADD COLUMN IF NOT EXISTS member_since TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS listing_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trade_count   INT DEFAULT 0;

-- ── 5. FUNKCE – statistiky profilu ───────────────────────────
CREATE OR REPLACE FUNCTION get_profile_stats(p_user_id UUID)
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'listing_count',  (SELECT COUNT(*) FROM listings WHERE user_id = p_user_id AND status = 'active'),
    'trade_count',    (SELECT COUNT(*) FROM offers   WHERE (seller_id = p_user_id OR buyer_id = p_user_id) AND status = 'accepted'),
    'demand_count',   (SELECT COUNT(*) FROM demands  WHERE user_id = p_user_id AND status = 'active'),
    'rating_count',   (SELECT COUNT(*) FROM ratings  WHERE reviewed_id = p_user_id),
    'avg_rating',     (SELECT ROUND(AVG(overall)::numeric,1) FROM ratings WHERE reviewed_id = p_user_id)
  ) INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 6. ZPRÁVY – přidej index pro konverzace ───────────────────
CREATE INDEX IF NOT EXISTS messages_conversation_idx
  ON messages(listing_id, sender_id, receiver_id);

-- ── 7. NABÍDKY – přidej možnost označit jako splněnou ─────────
ALTER TABLE offers
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS buyer_rated  BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS seller_rated BOOLEAN DEFAULT false;

-- ═══════════════════════════════════════════════════════════════
--  ✅ HOTOVO!
-- ═══════════════════════════════════════════════════════════════
