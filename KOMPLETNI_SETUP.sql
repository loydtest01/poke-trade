-- ═══════════════════════════════════════════════════════════════
--  PokéTrade – KOMPLETNÍ DATABÁZOVÉ SCHÉMA
--  Vše v jednom souboru: Supabase → SQL Editor → New Query → Run
--
--  Pořadí spuštění je důležité – nespouštěj po částech!
--  Pokud databáze již existuje, bezpečné opakovat (IF NOT EXISTS / OR REPLACE)
-- ═══════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────
-- 1. PROFILY UŽIVATELŮ
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username    TEXT NOT NULL UNIQUE,
  email       TEXT,
  avatar_url  TEXT,
  bio         TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Profily jsou veřejné' AND tablename='profiles') THEN
    CREATE POLICY "Profily jsou veřejné" ON profiles FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Uživatel může upravit svůj profil' AND tablename='profiles') THEN
    CREATE POLICY "Uživatel může upravit svůj profil" ON profiles FOR ALL USING (auth.uid() = id);
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────────
-- 2. NABÍDKY (listings)
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS listings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  username     TEXT NOT NULL,
  title        TEXT,
  cards_data   JSONB NOT NULL DEFAULT '[]',
  exchange_map JSONB DEFAULT '{}',
  status       TEXT DEFAULT 'active' CHECK (status IN ('active','closed','deleted')),
  offer_count  INT DEFAULT 0,
  -- Marketplace rozšíření
  description    TEXT,
  price_czk      INT,
  price_eur      NUMERIC(8,2),
  allow_trade    BOOLEAN DEFAULT false,
  allow_offer    BOOLEAN DEFAULT true,
  trade_wants    TEXT,
  card_name      TEXT,
  card_set       TEXT,
  card_number    TEXT,
  card_hp        TEXT,
  card_type      TEXT,
  card_rarity    TEXT,
  card_condition TEXT DEFAULT 'NM',
  api_image_url  TEXT,
  view_count     INT DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS listings_user_id_idx ON listings(user_id);
CREATE INDEX IF NOT EXISTS listings_status_idx  ON listings(status);
CREATE INDEX IF NOT EXISTS listings_cards_gin   ON listings USING gin(cards_data);

ALTER TABLE listings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Aktivní nabídky vidí všichni' AND tablename='listings') THEN
    CREATE POLICY "Aktivní nabídky vidí všichni" ON listings FOR SELECT USING (status = 'active');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Přihlášený uživatel může přidat nabídku' AND tablename='listings') THEN
    CREATE POLICY "Přihlášený uživatel může přidat nabídku" ON listings FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Uživatel může upravit svou nabídku' AND tablename='listings') THEN
    CREATE POLICY "Uživatel může upravit svou nabídku" ON listings FOR UPDATE USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Uživatel může smazat svou nabídku' AND tablename='listings') THEN
    CREATE POLICY "Uživatel může smazat svou nabídku" ON listings FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────────
-- 3. NABÍDKY OD KUPUJÍCÍCH (offers)
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS offers (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id         UUID REFERENCES listings(id) ON DELETE CASCADE,
  seller_id          UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  buyer_id           UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  buyer_username     TEXT,
  wanted_card_ids    TEXT[] DEFAULT '{}',
  offer_type         TEXT DEFAULT 'price' CHECK (offer_type IN ('price','trade')),
  offered_price_czk  INT,
  trade_description  TEXT,
  message            TEXT,
  status             TEXT DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','cancelled')),
  -- Výměnné karty
  trade_card_ids     JSONB DEFAULT '[]',
  trade_card_names   TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS offers_listing_id_idx ON offers(listing_id);
CREATE INDEX IF NOT EXISTS offers_seller_id_idx  ON offers(seller_id);
CREATE INDEX IF NOT EXISTS offers_buyer_id_idx   ON offers(buyer_id);

ALTER TABLE offers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Prodávající vidí nabídky na své listingy' AND tablename='offers') THEN
    CREATE POLICY "Prodávající vidí nabídky na své listingy" ON offers FOR SELECT USING (auth.uid() = seller_id OR auth.uid() = buyer_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Přihlášený uživatel může odeslat nabídku' AND tablename='offers') THEN
    CREATE POLICY "Přihlášený uživatel může odeslat nabídku" ON offers FOR INSERT WITH CHECK (auth.uid() = buyer_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Prodávající může aktualizovat stav nabídky' AND tablename='offers') THEN
    CREATE POLICY "Prodávající může aktualizovat stav nabídky" ON offers FOR UPDATE USING (auth.uid() = seller_id OR auth.uid() = buyer_id);
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────────
-- 4. FOTKY K NABÍDKÁM
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS listing_photos (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id   UUID REFERENCES listings(id) ON DELETE CASCADE,
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  order_index  INT DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE listing_photos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Fotky vidí všichni' AND tablename='listing_photos') THEN
    CREATE POLICY "Fotky vidí všichni" ON listing_photos FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Vlastník může přidávat fotky' AND tablename='listing_photos') THEN
    CREATE POLICY "Vlastník může přidávat fotky" ON listing_photos FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Vlastník může mazat fotky' AND tablename='listing_photos') THEN
    CREATE POLICY "Vlastník může mazat fotky" ON listing_photos FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────────
-- 5. ZPRÁVY
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS messages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id        UUID REFERENCES listings(id) ON DELETE CASCADE,
  sender_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  receiver_id       UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_username   TEXT,
  receiver_username TEXT,
  text              TEXT NOT NULL,
  read              BOOLEAN DEFAULT false,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_listing_idx  ON messages(listing_id);
CREATE INDEX IF NOT EXISTS messages_sender_idx   ON messages(sender_id);
CREATE INDEX IF NOT EXISTS messages_receiver_idx ON messages(receiver_id);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Zprávy vidí jen účastníci' AND tablename='messages') THEN
    CREATE POLICY "Zprávy vidí jen účastníci" ON messages FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Přihlášený může posílat zprávy' AND tablename='messages') THEN
    CREATE POLICY "Přihlášený může posílat zprávy" ON messages FOR INSERT WITH CHECK (auth.uid() = sender_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Příjemce může označit jako přečtené' AND tablename='messages') THEN
    CREATE POLICY "Příjemce může označit jako přečtené" ON messages FOR UPDATE USING (auth.uid() = receiver_id);
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────────
-- 6. ALBUM KARET (user_cards)
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_cards (
  id         BIGSERIAL,
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  local_id   TEXT        NOT NULL,
  card_data  JSONB       NOT NULL DEFAULT '{}',
  for_trade  BOOLEAN     NOT NULL DEFAULT false,
  for_sell   BOOLEAN     NOT NULL DEFAULT false,
  price_czk  INT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, local_id)
);

CREATE INDEX IF NOT EXISTS user_cards_user_id_idx   ON user_cards(user_id);
CREATE INDEX IF NOT EXISTS user_cards_for_trade_idx ON user_cards(for_trade) WHERE for_trade = true;
CREATE INDEX IF NOT EXISTS user_cards_for_sell_idx  ON user_cards(for_sell)  WHERE for_sell  = true;
CREATE INDEX IF NOT EXISTS user_cards_updated_at_idx ON user_cards(updated_at DESC);

ALTER TABLE user_cards ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Uživatel vidí vlastní album' AND tablename='user_cards') THEN
    CREATE POLICY "Uživatel vidí vlastní album" ON user_cards FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='K výměně/prodeji vidí všichni' AND tablename='user_cards') THEN
    CREATE POLICY "K výměně/prodeji vidí všichni" ON user_cards FOR SELECT USING (for_trade = true OR for_sell = true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Uživatel vkládá vlastní karty' AND tablename='user_cards') THEN
    CREATE POLICY "Uživatel vkládá vlastní karty" ON user_cards FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Uživatel upravuje vlastní karty' AND tablename='user_cards') THEN
    CREATE POLICY "Uživatel upravuje vlastní karty" ON user_cards FOR UPDATE USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Uživatel maže vlastní karty' AND tablename='user_cards') THEN
    CREATE POLICY "Uživatel maže vlastní karty" ON user_cards FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────────
-- 7. ALBA (user_albums)
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_albums (
  id         TEXT        NOT NULL,
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL DEFAULT 'Album',
  color      TEXT        NOT NULL DEFAULT '#4f8ef7',
  icon       TEXT        NOT NULL DEFAULT '📁',
  owner_id   TEXT,
  card_ids   TEXT[]      NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS user_albums_user_id_idx    ON user_albums(user_id);
CREATE INDEX IF NOT EXISTS user_albums_updated_at_idx ON user_albums(updated_at DESC);

ALTER TABLE user_albums ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Uživatel vidí vlastní alba' AND tablename='user_albums') THEN
    CREATE POLICY "Uživatel vidí vlastní alba" ON user_albums FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Uživatel vkládá vlastní alba' AND tablename='user_albums') THEN
    CREATE POLICY "Uživatel vkládá vlastní alba" ON user_albums FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Uživatel upravuje vlastní alba' AND tablename='user_albums') THEN
    CREATE POLICY "Uživatel upravuje vlastní alba" ON user_albums FOR UPDATE USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Uživatel maže vlastní alba' AND tablename='user_albums') THEN
    CREATE POLICY "Uživatel maže vlastní alba" ON user_albums FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────────
-- 8. IP TRACKING – ochrana proti podvodníkům
-- ────────────────────────────────────────────────────────────────

-- Logy přihlášení (kdo, odkud, kdy)
CREATE TABLE IF NOT EXISTS user_ip_logs (
  id         UUID     DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID     REFERENCES auth.users(id) ON DELETE CASCADE,
  ip_address INET     NOT NULL,
  logged_at  TIMESTAMPTZ DEFAULT NOW(),
  user_agent TEXT,
  action     TEXT     DEFAULT 'login' CHECK (action IN ('login','register','failed')),
  success    BOOLEAN  DEFAULT true
);

CREATE INDEX IF NOT EXISTS ip_logs_user_id_idx  ON user_ip_logs(user_id);
CREATE INDEX IF NOT EXISTS ip_logs_ip_idx       ON user_ip_logs(ip_address);
CREATE INDEX IF NOT EXISTS ip_logs_logged_at_idx ON user_ip_logs(logged_at DESC);

ALTER TABLE user_ip_logs ENABLE ROW LEVEL SECURITY;

-- Blokované IP adresy
CREATE TABLE IF NOT EXISTS blocked_ips (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ip_address INET NOT NULL UNIQUE,
  reason     TEXT,
  blocked_at TIMESTAMPTZ DEFAULT NOW(),
  blocked_by UUID REFERENCES auth.users(id)
);

ALTER TABLE blocked_ips ENABLE ROW LEVEL SECURITY;

-- Blokovaní uživatelé (přidáno do profiles)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT false;

-- RLS polícy pro IP tabulky
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Vlastní IP logy' AND tablename='user_ip_logs') THEN
    CREATE POLICY "Vlastní IP logy" ON user_ip_logs FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Logovat může kdokoli' AND tablename='user_ip_logs') THEN
    CREATE POLICY "Logovat může kdokoli" ON user_ip_logs FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Blocked IP čte kdokoli' AND tablename='blocked_ips') THEN
    CREATE POLICY "Blocked IP čte kdokoli" ON blocked_ips FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Blocked IP přidává jen admin' AND tablename='blocked_ips') THEN
    -- Uprav podmínku pokud máš admin roli; prozatím jen pro přihlášené uživatele
    CREATE POLICY "Blocked IP přidává jen admin" ON blocked_ips FOR INSERT WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;


-- ── Funkce: zkontroluj zda je IP blokovaná ──────────────────
CREATE OR REPLACE FUNCTION is_ip_blocked(p_ip TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM blocked_ips WHERE ip_address = p_ip::inet
  );
$$;

-- ── Funkce: zaloguj přihlášení ──────────────────────────────
CREATE OR REPLACE FUNCTION log_user_login(
  p_user_id  UUID,
  p_ip       TEXT,
  p_agent    TEXT    DEFAULT NULL,
  p_action   TEXT    DEFAULT 'login',
  p_success  BOOLEAN DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO user_ip_logs (user_id, ip_address, user_agent, action, success)
  VALUES (p_user_id, p_ip::inet, p_agent, p_action, p_success);
EXCEPTION WHEN OTHERS THEN
  -- Chyba při logování nemá zastavit přihlášení
  NULL;
END;
$$;

-- ── View pro admina: podezřelé IP (stejná IP, více účtů) ───
CREATE OR REPLACE VIEW suspicious_ips AS
SELECT
  ip_address,
  COUNT(DISTINCT user_id)    AS pocet_uctu,
  COUNT(*)                   AS pocet_pokusu,
  MIN(logged_at)             AS prvni_prihlaseni,
  MAX(logged_at)             AS posledni_prihlaseni,
  COUNT(*) FILTER (WHERE success = false) AS neuspesne_pokusy,
  array_agg(DISTINCT user_id) AS user_ids
FROM user_ip_logs
GROUP BY ip_address
HAVING COUNT(DISTINCT user_id) > 1
ORDER BY pocet_uctu DESC;

GRANT SELECT ON suspicious_ips TO authenticated;

-- ── View pro admina: kompletní přehled přihlášení ──────────
CREATE OR REPLACE VIEW login_history AS
SELECT
  l.logged_at,
  l.ip_address,
  l.action,
  l.success,
  l.user_agent,
  p.username,
  p.email,
  p.is_banned,
  CASE WHEN b.ip_address IS NOT NULL THEN true ELSE false END AS ip_blocked
FROM user_ip_logs l
JOIN profiles p ON p.id = l.user_id
LEFT JOIN blocked_ips b ON b.ip_address = l.ip_address
ORDER BY l.logged_at DESC;

GRANT SELECT ON login_history TO authenticated;


-- ────────────────────────────────────────────────────────────────
-- 9. RPC FUNKCE
-- ────────────────────────────────────────────────────────────────

-- Automaticky vytvořit profil po registraci
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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Hromadný upsert karet
CREATE OR REPLACE FUNCTION upsert_user_cards(p_user_id UUID, p_cards JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_card    JSONB;
  v_updated INT := 0;
BEGIN
  IF auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Neautorizovaný přístup';
  END IF;
  FOR v_card IN SELECT * FROM jsonb_array_elements(p_cards)
  LOOP
    INSERT INTO user_cards (user_id, local_id, for_trade, for_sell, price_czk, card_data, updated_at)
    VALUES (
      p_user_id, v_card->>'local_id',
      COALESCE((v_card->>'for_trade')::boolean, false),
      COALESCE((v_card->>'for_sell')::boolean,  false),
      (v_card->>'price_czk')::int,
      COALESCE(v_card->'card_data', '{}'::jsonb),
      COALESCE((v_card->>'updated_at')::timestamptz, NOW())
    )
    ON CONFLICT (user_id, local_id) DO UPDATE SET
      for_trade  = EXCLUDED.for_trade,
      for_sell   = EXCLUDED.for_sell,
      price_czk  = EXCLUDED.price_czk,
      card_data  = EXCLUDED.card_data,
      updated_at = EXCLUDED.updated_at
    WHERE user_cards.updated_at <= EXCLUDED.updated_at;
    v_updated := v_updated + 1;
  END LOOP;
  RETURN jsonb_build_object('updated', v_updated);
END;
$$;

-- Hromadný upsert alb
CREATE OR REPLACE FUNCTION upsert_user_albums(p_user_id UUID, p_albums JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_album   JSONB;
  v_updated INT := 0;
BEGIN
  IF auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Neautorizovaný přístup';
  END IF;
  FOR v_album IN SELECT * FROM jsonb_array_elements(p_albums)
  LOOP
    INSERT INTO user_albums (user_id, id, name, color, icon, owner_id, card_ids, updated_at)
    VALUES (
      p_user_id, v_album->>'id',
      COALESCE(v_album->>'name', 'Album'),
      COALESCE(v_album->>'color', '#4f8ef7'),
      COALESCE(v_album->>'icon', '📁'),
      v_album->>'owner_id',
      ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_album->'card_ids', '[]'::jsonb))),
      COALESCE((v_album->>'updated_at')::timestamptz, NOW())
    )
    ON CONFLICT (user_id, id) DO UPDATE SET
      name       = EXCLUDED.name,
      color      = EXCLUDED.color,
      icon       = EXCLUDED.icon,
      owner_id   = EXCLUDED.owner_id,
      card_ids   = EXCLUDED.card_ids,
      updated_at = EXCLUDED.updated_at
    WHERE user_albums.updated_at <= EXCLUDED.updated_at;
    v_updated := v_updated + 1;
  END LOOP;
  DELETE FROM user_albums
  WHERE user_id = p_user_id
    AND id NOT IN (SELECT v->>'id' FROM jsonb_array_elements(p_albums) v);
  RETURN jsonb_build_object('updated', v_updated);
END;
$$;

-- Zvýšit počet zobrazení
CREATE OR REPLACE FUNCTION increment_view_count(listing_uuid UUID)
RETURNS void AS $$
  UPDATE listings SET view_count = view_count + 1 WHERE id = listing_uuid;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp;


-- ────────────────────────────────────────────────────────────────
-- 10. VIEW a bezpečnostní opravy
-- ────────────────────────────────────────────────────────────────

-- Veřejné karty k výměně/prodeji (SECURITY INVOKER = dodržuje RLS)
DROP VIEW IF EXISTS public_trade_cards;
CREATE VIEW public_trade_cards
  WITH (security_invoker = true)
AS
SELECT
  uc.user_id, p.username, p.avatar_url,
  uc.local_id, uc.card_data,
  uc.for_trade, uc.for_sell, uc.price_czk, uc.updated_at
FROM user_cards uc
JOIN profiles p ON p.id = uc.user_id
WHERE uc.for_trade = true OR uc.for_sell = true;

GRANT SELECT ON public_trade_cards TO anon, authenticated;

-- Nabídky se statistikami
CREATE OR REPLACE VIEW listings_with_stats AS
SELECT
  l.*,
  COUNT(DISTINCT m.id) AS message_count,
  COUNT(DISTINCT o.id) AS offer_count_real,
  COUNT(DISTINCT ph.id) AS photo_count
FROM listings l
LEFT JOIN messages m  ON m.listing_id = l.id
LEFT JOIN offers   o  ON o.listing_id = l.id AND o.status = 'pending'
LEFT JOIN listing_photos ph ON ph.listing_id = l.id
WHERE l.status = 'active'
GROUP BY l.id;


-- ═══════════════════════════════════════════════════════════════


-- ────────────────────────────────────────────────────────────────
-- 11. HODNOCENÍ UŽIVATELŮ (reviews)
--     Používá: profile.html – hvězdičkové hodnocení kupující/prodávající
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reviews (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reviewed_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reviewer_username   TEXT,
  reviewed_username   TEXT,
  reviewer_role       TEXT NOT NULL CHECK (reviewer_role IN ('buyer','seller')),
  stars_overall       INT  NOT NULL CHECK (stars_overall BETWEEN 1 AND 5),
  comment             TEXT,
  listing_id          UUID REFERENCES listings(id) ON DELETE SET NULL,
  -- Kupující hodnotí prodávajícího
  stars_communication   INT CHECK (stars_communication   BETWEEN 1 AND 5),
  stars_delivery_speed  INT CHECK (stars_delivery_speed  BETWEEN 1 AND 5),
  stars_item_accuracy   INT CHECK (stars_item_accuracy   BETWEEN 1 AND 5),
  -- Prodávající hodnotí kupujícího
  stars_payment_speed   INT CHECK (stars_payment_speed   BETWEEN 1 AND 5),
  stars_pickup          INT CHECK (stars_pickup           BETWEEN 1 AND 5),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  -- každý může hodnotit každého jen jednou
  UNIQUE (reviewer_id, reviewed_id)
);

CREATE INDEX IF NOT EXISTS reviews_reviewed_id_idx ON reviews(reviewed_id);
CREATE INDEX IF NOT EXISTS reviews_reviewer_id_idx ON reviews(reviewer_id);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Hodnocení jsou veřejná' AND tablename='reviews') THEN
    CREATE POLICY "Hodnocení jsou veřejná" ON reviews FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Přihlášený může hodnotit' AND tablename='reviews') THEN
    CREATE POLICY "Přihlášený může hodnotit" ON reviews FOR INSERT WITH CHECK (auth.uid() = reviewer_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Autor může smazat své hodnocení' AND tablename='reviews') THEN
    CREATE POLICY "Autor může smazat své hodnocení" ON reviews FOR DELETE USING (auth.uid() = reviewer_id);
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────────
-- 12. FRONTA FOTEK Z TELEFONU (photo_queue)
--     Používá: scanner.html + mobile.html – QR bridge pro mobilní skenování
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS photo_queue (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  filename     TEXT,
  processed    BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE photo_queue ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='photo_queue_own' AND tablename='photo_queue') THEN
    CREATE POLICY "photo_queue_own" ON photo_queue FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────────
-- 13. GROQ AI API KLÍČE (user_api_keys)
--     Používá: profile.html (správa klíče) + scanner.html (auto-sync)
--     Klíč je chráněn RLS – vidí ho POUZE majitel
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  groq_key     TEXT NOT NULL,
  groq_model   TEXT DEFAULT 'llama-3.3-70b-versatile',
  groq_enabled BOOLEAN DEFAULT TRUE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_api_keys ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Vlastní API klíč – jen majitel čte' AND tablename='user_api_keys') THEN
    CREATE POLICY "Vlastní API klíč – jen majitel čte"    ON user_api_keys FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Vlastní API klíč – jen majitel přidává' AND tablename='user_api_keys') THEN
    CREATE POLICY "Vlastní API klíč – jen majitel přidává" ON user_api_keys FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Vlastní API klíč – jen majitel upravuje' AND tablename='user_api_keys') THEN
    CREATE POLICY "Vlastní API klíč – jen majitel upravuje" ON user_api_keys FOR UPDATE USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Vlastní API klíč – jen majitel maže' AND tablename='user_api_keys') THEN
    CREATE POLICY "Vlastní API klíč – jen majitel maže"    ON user_api_keys FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;

-- Trigger: auto-update updated_at
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_api_keys_updated ON user_api_keys;
CREATE TRIGGER user_api_keys_updated
  BEFORE UPDATE ON user_api_keys
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Pomocná funkce: má uživatel aktivní Groq klíč? (nesdílí samotný klíč)
CREATE OR REPLACE FUNCTION has_groq_key()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_api_keys
    WHERE user_id = auth.uid() AND groq_enabled = TRUE AND char_length(groq_key) > 10
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Pomocná funkce: načti model bez odhalení klíče
CREATE OR REPLACE FUNCTION get_groq_model()
RETURNS TEXT AS $$
  SELECT COALESCE(groq_model, 'llama-3.3-70b-versatile')
  FROM user_api_keys WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;


-- ────────────────────────────────────────────────────────────────
-- 14. STORAGE POLICIES pro bucket "card-photo"
--     Používá: scanner.html + mobile.html – upload fotek karet
--     ⚠️  Bucket "card-photo" musíš vytvořit ručně v Supabase → Storage
--         (Private bucket, max doporučená velikost souboru: 10 MB)
-- ────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname='card_photo_insert' AND tablename='objects'
  ) THEN
    CREATE POLICY "card_photo_insert" ON storage.objects FOR INSERT
      WITH CHECK (
        bucket_id = 'card-photo' AND
        auth.uid()::text = (string_to_array(name, '/'))[1]
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname='card_photo_select' AND tablename='objects'
  ) THEN
    CREATE POLICY "card_photo_select" ON storage.objects FOR SELECT
      USING (
        bucket_id = 'card-photo' AND
        auth.uid()::text = (string_to_array(name, '/'))[1]
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname='card_photo_delete' AND tablename='objects'
  ) THEN
    CREATE POLICY "card_photo_delete" ON storage.objects FOR DELETE
      USING (
        bucket_id = 'card-photo' AND
        auth.uid()::text = (string_to_array(name, '/'))[1]
      );
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════
--  ✅ HOTOVO! Kompletní databáze je připravena.
--
--  Tabulky:
--  ✔ profiles            – uživatelé (+ is_banned)
--  ✔ listings            – nabídky na tržišti
--  ✔ offers              – nabídky kupujících
--  ✔ listing_photos      – fotky k nabídkám
--  ✔ messages            – zprávy mezi uživateli
--  ✔ user_cards          – alba karet
--  ✔ user_albums         – složky alb
--  ✔ user_ip_logs        – IP ochrana proti podvodníkům
--  ✔ blocked_ips         – blokované IP
--  ✔ reviews             – hvězdičkové hodnocení (NOVÉ)
--  ✔ photo_queue         – fronta fotek pro mobilní skener (NOVÉ)
--  ✔ user_api_keys       – Groq AI klíče (NOVÉ)
--
--  Funkce a Views:
--  ✔ handle_new_user()   – auto-profil po registraci
--  ✔ upsert_user_cards() – hromadný sync karet
--  ✔ upsert_user_albums()– hromadný sync alb
--  ✔ increment_view_count()
--  ✔ log_user_login()    – logování přihlášení
--  ✔ is_ip_blocked()     – check blokované IP
--  ✔ has_groq_key()      – check Groq klíče (bezpečný)
--  ✔ get_groq_model()    – načti Groq model
--  ✔ public_trade_cards  – veřejné karty k výměně
--  ✔ listings_with_stats – nabídky se statistikami
--  ✔ suspicious_ips      – podezřelé IP (admin)
--  ✔ login_history       – přehled přihlášení (admin)
--
--  Nutné ruční kroky v Supabase Dashboard:
--  • Authentication → Settings → Enable "Leaked password protection"
--  • Storage → New bucket "listing-photos" (Public,  max 5 MB)
--  • Storage → New bucket "card-photo"     (Private, max 10 MB)
-- ═══════════════════════════════════════════════════════════════
