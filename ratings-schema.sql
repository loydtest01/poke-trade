-- ═══════════════════════════════════════════════════════════════
--  PokéTrade – Systém hodnocení uživatelů
--  Spusť v Supabase → SQL Editor → New Query
--  NEZÁVISLÉ na ostatních částech – propojitelné přes user_id
-- ═══════════════════════════════════════════════════════════════

-- ── 1. HODNOCENÍ (reviews) ─────────────────────────────────────
-- Každý completed trade/obchod umožní oběma stranám zanechat hodnocení.
-- reviewer_id  = ten, kdo hodnocení píše
-- reviewed_id  = ten, koho hodnotí
-- role         = 'seller' (prodávající hodnotí kupujícího)
--              | 'buyer'  (kupující hodnotí prodávajícího)

CREATE TABLE IF NOT EXISTS reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Propojení na transakci (volitelné – lze propojit s listings/offers)
  listing_id      UUID REFERENCES listings(id) ON DELETE SET NULL,
  offer_id        UUID,  -- volné napojení na offers.id, bez FK kvůli flexibilitě

  -- Účastníci
  reviewer_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reviewed_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reviewer_username TEXT,
  reviewed_username TEXT,

  -- Kdo hodnotí koho (z pohledu recenzenta)
  reviewer_role   TEXT NOT NULL CHECK (reviewer_role IN ('buyer','seller')),
  -- 'buyer'  = reviewer byl kupující, hodnotí prodávajícího
  -- 'seller' = reviewer byl prodávající, hodnotí kupujícího

  -- ── Hvězdičky (1–5) ────────────────────────────────────────
  -- Sdílené pro oba (overall)
  stars_overall   SMALLINT NOT NULL CHECK (stars_overall BETWEEN 1 AND 5),

  -- Kategorie PRO PRODÁVAJÍCÍHO (vyplňuje kupující → role='buyer')
  stars_communication   SMALLINT CHECK (stars_communication   BETWEEN 1 AND 5),
  stars_delivery_speed  SMALLINT CHECK (stars_delivery_speed  BETWEEN 1 AND 5),
  stars_item_accuracy   SMALLINT CHECK (stars_item_accuracy   BETWEEN 1 AND 5),
  -- item_accuracy = přesnost popisu stavu karty

  -- Kategorie PRO KUPUJÍCÍHO (vyplňuje prodávající → role='seller')
  stars_payment_speed   SMALLINT CHECK (stars_payment_speed   BETWEEN 1 AND 5),
  stars_pickup          SMALLINT CHECK (stars_pickup          BETWEEN 1 AND 5),
  -- pickup = zda kupující převzal zásilku / reagoval po odeslání

  -- ── Textový komentář ───────────────────────────────────────
  comment         TEXT CHECK (char_length(comment) <= 1000),

  -- ── Metadata ───────────────────────────────────────────────
  is_positive     BOOLEAN GENERATED ALWAYS AS (stars_overall >= 4) STORED,
  is_neutral      BOOLEAN GENERATED ALWAYS AS (stars_overall = 3)  STORED,
  is_negative     BOOLEAN GENERATED ALWAYS AS (stars_overall <= 2) STORED,

  created_at      TIMESTAMPTZ DEFAULT NOW(),

  -- Jeden pár reviewer+listing může hodnotit jen jednou
  UNIQUE (reviewer_id, listing_id)
);

CREATE INDEX IF NOT EXISTS reviews_reviewed_idx  ON reviews(reviewed_id);
CREATE INDEX IF NOT EXISTS reviews_reviewer_idx  ON reviews(reviewer_id);
CREATE INDEX IF NOT EXISTS reviews_listing_idx   ON reviews(listing_id);
CREATE INDEX IF NOT EXISTS reviews_role_idx      ON reviews(reviewer_role);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hodnocení vidí všichni"
  ON reviews FOR SELECT USING (true);

CREATE POLICY "Přihlášený může hodnotit"
  ON reviews FOR INSERT
  WITH CHECK (auth.uid() = reviewer_id);

CREATE POLICY "Vlastní hodnocení lze upravit do 48h"
  ON reviews FOR UPDATE
  USING (
    auth.uid() = reviewer_id
    AND created_at > NOW() - INTERVAL '48 hours'
  );

CREATE POLICY "Vlastní hodnocení lze smazat do 48h"
  ON reviews FOR DELETE
  USING (
    auth.uid() = reviewer_id
    AND created_at > NOW() - INTERVAL '48 hours'
  );

-- ── 2. AGREGOVANÉ STATISTIKY – VIEW ───────────────────────────
-- Výkonnostní pohled: průměry a procenta pro každého uživatele
-- Zvlášť jako PRODÁVAJÍCÍ a jako KUPUJÍCÍ

CREATE OR REPLACE VIEW user_seller_stats AS
SELECT
  reviewed_id                                               AS user_id,
  COUNT(*)                                                  AS total_reviews,
  ROUND(AVG(stars_overall)::NUMERIC, 2)                    AS avg_overall,
  ROUND(AVG(stars_communication)::NUMERIC, 2)              AS avg_communication,
  ROUND(AVG(stars_delivery_speed)::NUMERIC, 2)             AS avg_delivery_speed,
  ROUND(AVG(stars_item_accuracy)::NUMERIC, 2)              AS avg_item_accuracy,
  -- Procenta (podíl kladných hodnocení v dané kategorii, 4-5 hvězd = kladné)
  ROUND(100.0 * SUM(CASE WHEN stars_overall       >= 4 THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0), 1) AS pct_positive,
  ROUND(100.0 * SUM(CASE WHEN stars_communication >= 4 THEN 1 ELSE 0 END) / NULLIF(COUNT(stars_communication),0), 1) AS pct_communication,
  ROUND(100.0 * SUM(CASE WHEN stars_delivery_speed >= 4 THEN 1 ELSE 0 END) / NULLIF(COUNT(stars_delivery_speed),0), 1) AS pct_delivery,
  ROUND(100.0 * SUM(CASE WHEN stars_item_accuracy >= 4 THEN 1 ELSE 0 END) / NULLIF(COUNT(stars_item_accuracy),0), 1) AS pct_accuracy,
  -- Rozdělení 1–5 hvězd
  SUM(CASE WHEN stars_overall = 5 THEN 1 ELSE 0 END)       AS stars_5,
  SUM(CASE WHEN stars_overall = 4 THEN 1 ELSE 0 END)       AS stars_4,
  SUM(CASE WHEN stars_overall = 3 THEN 1 ELSE 0 END)       AS stars_3,
  SUM(CASE WHEN stars_overall = 2 THEN 1 ELSE 0 END)       AS stars_2,
  SUM(CASE WHEN stars_overall = 1 THEN 1 ELSE 0 END)       AS stars_1
FROM reviews
WHERE reviewer_role = 'buyer'   -- kupující hodnotí prodávajícího
GROUP BY reviewed_id;

CREATE OR REPLACE VIEW user_buyer_stats AS
SELECT
  reviewed_id                                               AS user_id,
  COUNT(*)                                                  AS total_reviews,
  ROUND(AVG(stars_overall)::NUMERIC, 2)                    AS avg_overall,
  ROUND(AVG(stars_payment_speed)::NUMERIC, 2)              AS avg_payment_speed,
  ROUND(AVG(stars_pickup)::NUMERIC, 2)                     AS avg_pickup,
  ROUND(100.0 * SUM(CASE WHEN stars_overall       >= 4 THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0), 1) AS pct_positive,
  ROUND(100.0 * SUM(CASE WHEN stars_payment_speed >= 4 THEN 1 ELSE 0 END) / NULLIF(COUNT(stars_payment_speed),0), 1) AS pct_payment,
  ROUND(100.0 * SUM(CASE WHEN stars_pickup        >= 4 THEN 1 ELSE 0 END) / NULLIF(COUNT(stars_pickup),0), 1) AS pct_pickup,
  SUM(CASE WHEN stars_overall = 5 THEN 1 ELSE 0 END)       AS stars_5,
  SUM(CASE WHEN stars_overall = 4 THEN 1 ELSE 0 END)       AS stars_4,
  SUM(CASE WHEN stars_overall = 3 THEN 1 ELSE 0 END)       AS stars_3,
  SUM(CASE WHEN stars_overall = 2 THEN 1 ELSE 0 END)       AS stars_2,
  SUM(CASE WHEN stars_overall = 1 THEN 1 ELSE 0 END)       AS stars_1
FROM reviews
WHERE reviewer_role = 'seller'  -- prodávající hodnotí kupujícího
GROUP BY reviewed_id;

-- ── 3. PROFILES – rozšíření (pokud tabulka již existuje) ───────
-- Přidá cached statistiky pro rychlé načítání bez JOIN
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS seller_avg_stars    NUMERIC(3,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seller_review_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buyer_avg_stars     NUMERIC(3,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buyer_review_count  INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bio                 TEXT,
  ADD COLUMN IF NOT EXISTS location            TEXT,
  ADD COLUMN IF NOT EXISTS joined_at           TIMESTAMPTZ DEFAULT NOW();

-- ── 4. TRIGGER – aktualizuje cache v profiles po každém review ─
CREATE OR REPLACE FUNCTION update_profile_review_cache()
RETURNS TRIGGER AS $$
BEGIN
  -- Aktualizuj cache pro reviewed_id
  IF NEW.reviewer_role = 'buyer' THEN
    UPDATE profiles SET
      seller_avg_stars    = (SELECT ROUND(AVG(stars_overall)::NUMERIC,2) FROM reviews WHERE reviewed_id = NEW.reviewed_id AND reviewer_role = 'buyer'),
      seller_review_count = (SELECT COUNT(*) FROM reviews WHERE reviewed_id = NEW.reviewed_id AND reviewer_role = 'buyer')
    WHERE id = NEW.reviewed_id;
  ELSE
    UPDATE profiles SET
      buyer_avg_stars    = (SELECT ROUND(AVG(stars_overall)::NUMERIC,2) FROM reviews WHERE reviewed_id = NEW.reviewed_id AND reviewer_role = 'seller'),
      buyer_review_count = (SELECT COUNT(*) FROM reviews WHERE reviewed_id = NEW.reviewed_id AND reviewer_role = 'seller')
    WHERE id = NEW.reviewed_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER reviews_cache_trigger
  AFTER INSERT OR UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION update_profile_review_cache();

-- ── 5. FUNKCE – může uživatel hodnotit? ───────────────────────
-- Vrátí true pokud reviewer_id a reviewed_id sdíleli dokončenou transakci
-- Použij na frontendu pro zobrazení tlačítka "Ohodnotit"
CREATE OR REPLACE FUNCTION can_leave_review(
  p_reviewer UUID,
  p_reviewed UUID,
  p_listing  UUID DEFAULT NULL
) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM offers o
    JOIN listings l ON l.id = o.listing_id
    WHERE o.status = 'accepted'
      AND (
        -- Kupující hodnotí prodávajícího
        (o.buyer_id = p_reviewer AND l.user_id = p_reviewed)
        OR
        -- Prodávající hodnotí kupujícího
        (l.user_id = p_reviewer AND o.buyer_id = p_reviewed)
      )
      AND (p_listing IS NULL OR l.id = p_listing)
      -- Ještě nehodnotil
      AND NOT EXISTS (
        SELECT 1 FROM reviews r
        WHERE r.reviewer_id = p_reviewer
          AND r.reviewed_id = p_reviewed
          AND (p_listing IS NULL OR r.listing_id = p_listing)
      )
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- ═══════════════════════════════════════════════════════════════
--  ✅ HOTOVO!
--  Tabulky: reviews
--  Views:   user_seller_stats, user_buyer_stats
--  Funkce:  can_leave_review(), update_profile_review_cache()
-- ═══════════════════════════════════════════════════════════════
