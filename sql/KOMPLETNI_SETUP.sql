-- ═══════════════════════════════════════════════════════════════
--  PokéTrade – KOMPLETNÍ DATABÁZOVÉ SCHÉMA  v2.0  (opraveno)
--  ─────────────────────────────────────────────────────────────
--  Supabase → SQL Editor → New Query → Vlož celý soubor → Run
--
--  ⚠️  Bezpečné opakovat – používá IF NOT EXISTS / OR REPLACE
--  ⚠️  Pořadí je důležité – tabulky závisejí na sobě
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
  is_banned   BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ✅ OPRAVA: přidá is_banned i na existující tabulky bez tohoto sloupce
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT false;

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
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  username       TEXT NOT NULL,
  title          TEXT,
  cards_data     JSONB NOT NULL DEFAULT '[]',
  exchange_map   JSONB DEFAULT '{}',
  status         TEXT DEFAULT 'active' CHECK (status IN ('active','closed','deleted')),
  offer_count    INT DEFAULT 0,
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
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Vlastní nabídky vidí vlastník' AND tablename='listings') THEN
    CREATE POLICY "Vlastní nabídky vidí vlastník" ON listings FOR SELECT USING (auth.uid() = user_id);
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
-- 5. ZPRÁVY (starý systém – marketplace + profil)
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
-- 6. KONVERZACE (nový chat systém)
--    Používá: chat.html + chat dropdown na všech stránkách
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conversations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user1_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user2_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user1_username    TEXT NOT NULL DEFAULT '',
  user2_username    TEXT NOT NULL DEFAULT '',
  unread_user1      INT NOT NULL DEFAULT 0,
  unread_user2      INT NOT NULL DEFAULT 0,
  last_message_text TEXT,
  last_message_at   TIMESTAMPTZ,
  last_sender_id    UUID,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user1_id, user2_id)
);

CREATE INDEX IF NOT EXISTS conversations_user1_idx    ON conversations(user1_id);
CREATE INDEX IF NOT EXISTS conversations_user2_idx    ON conversations(user2_id);
CREATE INDEX IF NOT EXISTS conversations_last_msg_idx ON conversations(last_message_at DESC);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Konverzace vidí jen účastníci' AND tablename='conversations') THEN
    CREATE POLICY "Konverzace vidí jen účastníci" ON conversations FOR SELECT
      USING (auth.uid() = user1_id OR auth.uid() = user2_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Konverzaci vytváří účastník' AND tablename='conversations') THEN
    CREATE POLICY "Konverzaci vytváří účastník" ON conversations FOR INSERT
      WITH CHECK (auth.uid() = user1_id OR auth.uid() = user2_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Konverzaci upravuje účastník' AND tablename='conversations') THEN
    CREATE POLICY "Konverzaci upravuje účastník" ON conversations FOR UPDATE
      USING (auth.uid() = user1_id OR auth.uid() = user2_id);
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────────
-- 7. CHAT ZPRÁVY (nový chat systém)
--    Používá: chat.html – odesílání a načítání zpráv
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chat_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_username  TEXT,
  text             TEXT,
  listing_refs     JSONB DEFAULT '[]',
  is_read          BOOLEAN DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_messages_conv_idx    ON chat_messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS chat_messages_sender_idx  ON chat_messages(sender_id);
CREATE INDEX IF NOT EXISTS chat_messages_created_idx ON chat_messages(created_at DESC);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Chat zprávy vidí účastníci konverzace' AND tablename='chat_messages') THEN
    CREATE POLICY "Chat zprávy vidí účastníci konverzace" ON chat_messages FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM conversations c
          WHERE c.id = chat_messages.conversation_id
            AND (c.user1_id = auth.uid() OR c.user2_id = auth.uid())
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Odesílatel může vložit zprávu' AND tablename='chat_messages') THEN
    CREATE POLICY "Odesílatel může vložit zprávu" ON chat_messages FOR INSERT
      WITH CHECK (
        auth.uid() = sender_id
        AND EXISTS (
          SELECT 1 FROM conversations c
          WHERE c.id = conversation_id
            AND (c.user1_id = auth.uid() OR c.user2_id = auth.uid())
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Účastník může aktualizovat zprávu' AND tablename='chat_messages') THEN
    CREATE POLICY "Účastník může aktualizovat zprávu" ON chat_messages FOR UPDATE
      USING (
        EXISTS (
          SELECT 1 FROM conversations c
          WHERE c.id = chat_messages.conversation_id
            AND (c.user1_id = auth.uid() OR c.user2_id = auth.uid())
        )
      );
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────────
-- 8. ALBUM KARET (user_cards)
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

CREATE INDEX IF NOT EXISTS user_cards_user_id_idx    ON user_cards(user_id);
CREATE INDEX IF NOT EXISTS user_cards_for_trade_idx  ON user_cards(for_trade)  WHERE for_trade = true;
CREATE INDEX IF NOT EXISTS user_cards_for_sell_idx   ON user_cards(for_sell)   WHERE for_sell  = true;
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
-- 9. ALBA (user_albums)
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
-- 10. HODNOCENÍ UŽIVATELŮ (reviews)
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reviews (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewer_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reviewed_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reviewer_username     TEXT,
  reviewed_username     TEXT,
  reviewer_role         TEXT NOT NULL CHECK (reviewer_role IN ('buyer','seller')),
  stars_overall         INT  NOT NULL CHECK (stars_overall BETWEEN 1 AND 5),
  comment               TEXT,
  listing_id            UUID REFERENCES listings(id) ON DELETE SET NULL,
  stars_communication   INT CHECK (stars_communication   BETWEEN 1 AND 5),
  stars_delivery_speed  INT CHECK (stars_delivery_speed  BETWEEN 1 AND 5),
  stars_item_accuracy   INT CHECK (stars_item_accuracy   BETWEEN 1 AND 5),
  stars_payment_speed   INT CHECK (stars_payment_speed   BETWEEN 1 AND 5),
  stars_pickup          INT CHECK (stars_pickup           BETWEEN 1 AND 5),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
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
-- 11. FRONTA FOTEK Z TELEFONU (photo_queue)
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
-- 12. GROQ AI API KLÍČE (user_api_keys)
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
    CREATE POLICY "Vlastní API klíč – jen majitel čte"     ON user_api_keys FOR SELECT USING (auth.uid() = user_id);
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


-- ────────────────────────────────────────────────────────────────
-- 13. IP TRACKING
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_ip_logs (
  id         UUID     DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID     REFERENCES auth.users(id) ON DELETE CASCADE,
  ip_address INET     NOT NULL,
  logged_at  TIMESTAMPTZ DEFAULT NOW(),
  user_agent TEXT,
  action     TEXT     DEFAULT 'login' CHECK (action IN ('login','register','failed')),
  success    BOOLEAN  DEFAULT true
);

CREATE INDEX IF NOT EXISTS ip_logs_user_id_idx   ON user_ip_logs(user_id);
CREATE INDEX IF NOT EXISTS ip_logs_ip_idx        ON user_ip_logs(ip_address);
CREATE INDEX IF NOT EXISTS ip_logs_logged_at_idx ON user_ip_logs(logged_at DESC);

ALTER TABLE user_ip_logs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS blocked_ips (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ip_address INET NOT NULL UNIQUE,
  reason     TEXT,
  blocked_at TIMESTAMPTZ DEFAULT NOW(),
  blocked_by UUID REFERENCES auth.users(id)
);

ALTER TABLE blocked_ips ENABLE ROW LEVEL SECURITY;

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
    CREATE POLICY "Blocked IP přidává jen admin" ON blocked_ips FOR INSERT WITH CHECK (auth.role() = 'authenticated');
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════
--  FUNKCE, TRIGGERY, RPC
-- ═══════════════════════════════════════════════════════════════


-- ── F1. Auto-profil po registraci ─────────────────────────────

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


-- ── F2. Hromadný upsert karet ─────────────────────────────────

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


-- ── F3. Hromadný upsert alb ───────────────────────────────────

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


-- ── F4. Zvýšit počet zobrazení nabídky ────────────────────────

CREATE OR REPLACE FUNCTION increment_view_count(listing_uuid UUID)
RETURNS void AS $$
  UPDATE listings SET view_count = view_count + 1 WHERE id = listing_uuid;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp;


-- ── F5. Najdi nebo vytvoř konverzaci ──────────────────────────

CREATE OR REPLACE FUNCTION get_or_create_conversation(
  p_user_a     UUID,
  p_user_b     UUID,
  p_username_a TEXT DEFAULT '',
  p_username_b TEXT DEFAULT ''
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conv_id UUID;
  v_u1      UUID;
  v_u2      UUID;
  v_un1     TEXT;
  v_un2     TEXT;
BEGIN
  -- Menší UUID vždy jako user1 → zabrání duplicitám
  IF p_user_a < p_user_b THEN
    v_u1 := p_user_a;  v_u2 := p_user_b;
    v_un1 := p_username_a; v_un2 := p_username_b;
  ELSE
    v_u1 := p_user_b;  v_u2 := p_user_a;
    v_un1 := p_username_b; v_un2 := p_username_a;
  END IF;

  -- Hledej existující
  SELECT id INTO v_conv_id
  FROM conversations
  WHERE user1_id = v_u1 AND user2_id = v_u2
  LIMIT 1;

  IF v_conv_id IS NOT NULL THEN
    UPDATE conversations
    SET user1_username = COALESCE(NULLIF(v_un1,''), user1_username),
        user2_username = COALESCE(NULLIF(v_un2,''), user2_username)
    WHERE id = v_conv_id;
    RETURN v_conv_id;
  END IF;

  -- Vytvoř novou
  INSERT INTO conversations (user1_id, user2_id, user1_username, user2_username)
  VALUES (v_u1, v_u2, v_un1, v_un2)
  RETURNING id INTO v_conv_id;

  RETURN v_conv_id;
END;
$$;


-- ── F6. Označ konverzaci jako přečtenou ───────────────────────

CREATE OR REPLACE FUNCTION mark_conversation_read(
  p_conversation_id UUID,
  p_user_id         UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE conversations
  SET
    unread_user1 = CASE WHEN user1_id = p_user_id THEN 0 ELSE unread_user1 END,
    unread_user2 = CASE WHEN user2_id = p_user_id THEN 0 ELSE unread_user2 END
  WHERE id = p_conversation_id
    AND (user1_id = p_user_id OR user2_id = p_user_id);

  UPDATE chat_messages
  SET is_read = true
  WHERE conversation_id = p_conversation_id
    AND sender_id <> p_user_id
    AND is_read = false;
END;
$$;


-- ── F7. Trigger: nová zpráva → aktualizuj konverzaci ──────────

CREATE OR REPLACE FUNCTION on_new_chat_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_conv conversations%ROWTYPE;
BEGIN
  SELECT * INTO v_conv FROM conversations WHERE id = NEW.conversation_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  UPDATE conversations
  SET
    last_message_text = LEFT(NEW.text, 200),
    last_message_at   = NEW.created_at,
    last_sender_id    = NEW.sender_id,
    unread_user1 = CASE
      WHEN v_conv.user1_id = NEW.sender_id THEN unread_user1
      ELSE unread_user1 + 1
    END,
    unread_user2 = CASE
      WHEN v_conv.user2_id = NEW.sender_id THEN unread_user2
      ELSE unread_user2 + 1
    END
  WHERE id = NEW.conversation_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_new_chat_message ON chat_messages;
CREATE TRIGGER trg_new_chat_message
  AFTER INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION on_new_chat_message();


-- ── F8. Auto-update updated_at ────────────────────────────────

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_api_keys_updated ON user_api_keys;
CREATE TRIGGER user_api_keys_updated
  BEFORE UPDATE ON user_api_keys
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();


-- ── F9. IP ochrana ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION is_ip_blocked(p_ip TEXT)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM blocked_ips WHERE ip_address = p_ip::inet);
$$;

CREATE OR REPLACE FUNCTION log_user_login(
  p_user_id UUID, p_ip TEXT, p_agent TEXT DEFAULT NULL,
  p_action TEXT DEFAULT 'login', p_success BOOLEAN DEFAULT true
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO user_ip_logs (user_id, ip_address, user_agent, action, success)
  VALUES (p_user_id, p_ip::inet, p_agent, p_action, p_success);
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;


-- ── F10. Groq AI helpery ──────────────────────────────────────

CREATE OR REPLACE FUNCTION has_groq_key()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_api_keys
    WHERE user_id = auth.uid() AND groq_enabled = TRUE AND char_length(groq_key) > 10
  );
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_groq_model()
RETURNS TEXT AS $$
  SELECT COALESCE(groq_model, 'llama-3.3-70b-versatile')
  FROM user_api_keys WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;


-- ═══════════════════════════════════════════════════════════════
--  VIEWS
-- ═══════════════════════════════════════════════════════════════

DROP VIEW IF EXISTS public_trade_cards;
CREATE VIEW public_trade_cards WITH (security_invoker = true) AS
SELECT uc.user_id, p.username, p.avatar_url,
       uc.local_id, uc.card_data,
       uc.for_trade, uc.for_sell, uc.price_czk, uc.updated_at
FROM user_cards uc
JOIN profiles p ON p.id = uc.user_id
WHERE uc.for_trade = true OR uc.for_sell = true;
GRANT SELECT ON public_trade_cards TO anon, authenticated;

DROP VIEW IF EXISTS listings_with_stats;
CREATE VIEW listings_with_stats AS
SELECT l.*,
  COUNT(DISTINCT m.id)  AS message_count,
  COUNT(DISTINCT o.id)  AS offer_count_real,
  COUNT(DISTINCT ph.id) AS photo_count
FROM listings l
LEFT JOIN messages       m  ON m.listing_id  = l.id
LEFT JOIN offers         o  ON o.listing_id  = l.id AND o.status = 'pending'
LEFT JOIN listing_photos ph ON ph.listing_id = l.id
WHERE l.status = 'active'
GROUP BY l.id;

DROP VIEW IF EXISTS suspicious_ips;
CREATE VIEW suspicious_ips AS
SELECT ip_address,
  COUNT(DISTINCT user_id)    AS pocet_uctu,
  COUNT(*)                   AS pocet_pokusu,
  MIN(logged_at)             AS prvni_prihlaseni,
  MAX(logged_at)             AS posledni_prihlaseni,
  COUNT(*) FILTER (WHERE success = false) AS neuspesne_pokusy,
  array_agg(DISTINCT user_id) AS user_ids
FROM user_ip_logs GROUP BY ip_address
HAVING COUNT(DISTINCT user_id) > 1
ORDER BY pocet_uctu DESC;
GRANT SELECT ON suspicious_ips TO authenticated;

DROP VIEW IF EXISTS login_history;
CREATE VIEW login_history AS
SELECT l.logged_at, l.ip_address, l.action, l.success, l.user_agent,
  p.username, p.email, p.is_banned,
  CASE WHEN b.ip_address IS NOT NULL THEN true ELSE false END AS ip_blocked
FROM user_ip_logs l
JOIN profiles p ON p.id = l.user_id
LEFT JOIN blocked_ips b ON b.ip_address = l.ip_address
ORDER BY l.logged_at DESC;
GRANT SELECT ON login_history TO authenticated;


-- ═══════════════════════════════════════════════════════════════
--  STORAGE POLICIES – bucket "card-photo"
-- ═══════════════════════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='card_photo_insert' AND tablename='objects') THEN
    CREATE POLICY "card_photo_insert" ON storage.objects FOR INSERT
      WITH CHECK (bucket_id = 'card-photo' AND auth.uid()::text = (string_to_array(name, '/'))[1]);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='card_photo_select' AND tablename='objects') THEN
    CREATE POLICY "card_photo_select" ON storage.objects FOR SELECT
      USING (bucket_id = 'card-photo' AND auth.uid()::text = (string_to_array(name, '/'))[1]);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='card_photo_delete' AND tablename='objects') THEN
    CREATE POLICY "card_photo_delete" ON storage.objects FOR DELETE
      USING (bucket_id = 'card-photo' AND auth.uid()::text = (string_to_array(name, '/'))[1]);
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════
--  ✅ HOTOVO – PokéTrade v2.0 (opraveno)
--
--  TABULKY (14):
--    profiles, listings, offers, listing_photos, messages,
--    conversations ★, chat_messages ★,
--    user_cards, user_albums, reviews, photo_queue,
--    user_api_keys, user_ip_logs, blocked_ips
--
--  FUNKCE (10):
--    handle_new_user, upsert_user_cards, upsert_user_albums,
--    increment_view_count, get_or_create_conversation ★,
--    mark_conversation_read ★, on_new_chat_message ★,
--    log_user_login, is_ip_blocked,
--    has_groq_key, get_groq_model
--
--  VIEWS (4):
--    public_trade_cards, listings_with_stats,
--    suspicious_ips, login_history
--
--  ★ = nové v v2.0
--  ✅ = oprava: ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_banned
--
--  ⚠️  RUČNÍ KROK: Storage → New bucket "card-photo" (Private)
-- ═══════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════
--  DOPLŇKY v2.1 – security fixes + extra funkce
-- ═══════════════════════════════════════════════════════════════

-- ✅ SECURITY FIX: odstranění "Logovat může kdokoli" WITH CHECK (true)
DO $$ BEGIN
  DROP POLICY IF EXISTS "Logovat může kdokoli" ON user_ip_logs;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Authenticated může logovat sebe' AND tablename='user_ip_logs') THEN
    CREATE POLICY "Authenticated může logovat sebe" ON user_ip_logs FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- ── F11. Statistiky profilu ───────────────────────────────────
CREATE OR REPLACE FUNCTION get_profile_stats(p_user_id UUID)
RETURNS JSONB
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'listings_count', (SELECT COUNT(*) FROM listings WHERE user_id = p_user_id AND status = 'active'),
    'reviews_count',  (SELECT COUNT(*) FROM reviews  WHERE reviewed_id = p_user_id),
    'avg_stars',      (SELECT ROUND(AVG(stars_overall)::numeric, 1) FROM reviews WHERE reviewed_id = p_user_id)
  );
$$;

-- ── F12. Celkový počet nepřečtených zpráv ────────────────────
CREATE OR REPLACE FUNCTION get_total_unread()
RETURNS INT
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT SUM(CASE WHEN user1_id = auth.uid() THEN unread_user1 ELSE unread_user2 END)
     FROM conversations
     WHERE user1_id = auth.uid() OR user2_id = auth.uid()),
  0)::int;
$$;

-- ── F13. Placeholder trigger na messages ──────────────────────
CREATE OR REPLACE FUNCTION update_conversation_on_message()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN RETURN NEW; END;
$$;

-- ── F14. Může zanechat hodnocení? ─────────────────────────────
CREATE OR REPLACE FUNCTION can_leave_review(p_reviewer_id UUID, p_reviewed_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM reviews
    WHERE reviewer_id = p_reviewer_id AND reviewed_id = p_reviewed_id
  );
$$;

-- ── F15. Placeholder pro review cache ─────────────────────────
CREATE OR REPLACE FUNCTION update_profile_review_cache()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN RETURN NEW; END;
$$;
