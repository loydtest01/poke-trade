-- ═══════════════════════════════════════════════════════════════════
--  MIGRACE v2: Sdílení alb mezi uživateli
--  Soubory: album_shares, user_wishlist, notifications
--  Spusť v Supabase: SQL Editor → New query → paste → Run
--
--  OPRAVA OPROTI v1:
--    Stará tabulka album_shares (link-based) se bezpečně přejmenuje
--    na album_shares_old_backup a vytvoří se nová s user-to-user
--    schématem. Pokud stará tabulka neexistuje, vytvoří se rovnou.
-- ═══════════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────────
-- 1. TRIGGER: automatické vytvoření profilu po registraci
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ──────────────────────────────────────────────────────────────────
-- 2. ALBUM_SHARES — upgrade existující nebo vytvoření nové tabulky
-- ──────────────────────────────────────────────────────────────────
DO $$
DECLARE
  has_receiver_id BOOLEAN;
BEGIN
  -- Zjistíme jestli album_shares existuje
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'album_shares'
  ) THEN
    -- Zjistíme jestli má receiver_id (nové schéma)
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'album_shares'
        AND column_name = 'receiver_id'
    ) INTO has_receiver_id;

    IF NOT has_receiver_id THEN
      -- Stará tabulka (link-based) — zálohujeme a zahodíme
      RAISE NOTICE 'Stará tabulka album_shares nalezena (bez receiver_id). Přejmenovávám na album_shares_old_backup...';
      ALTER TABLE public.album_shares RENAME TO album_shares_old_backup;
    ELSE
      RAISE NOTICE 'Tabulka album_shares již existuje se správným schématem. Přeskakuji CREATE.';
    END IF;
  END IF;
END $$;

-- Teď vytvoříme novou tabulku (pokud ještě neexistuje)
CREATE TABLE IF NOT EXISTS album_shares (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  receiver_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_username  TEXT        NOT NULL,
  album_id         TEXT        NOT NULL,
  album_name       TEXT        NOT NULL,
  -- Snapshot: kompletní data karet v momentě odeslání (nezávislé na živém albu)
  cards_snapshot   JSONB       NOT NULL DEFAULT '[]',
  status           TEXT        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending','accepted','declined','expired')),
  expires_at       TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at      TIMESTAMPTZ
);

-- Indexy (CREATE INDEX IF NOT EXISTS je bezpečné)
CREATE INDEX IF NOT EXISTS album_shares_receiver_idx ON album_shares(receiver_id, status);
CREATE INDEX IF NOT EXISTS album_shares_sender_idx   ON album_shares(sender_id);
CREATE INDEX IF NOT EXISTS album_shares_expires_idx  ON album_shares(expires_at) WHERE status = 'pending';

ALTER TABLE album_shares ENABLE ROW LEVEL SECURITY;

-- Policies — nejprve smaž staré (pro případ přejmenování)
DROP POLICY IF EXISTS "Vidí vlastní sdílení"       ON album_shares;
DROP POLICY IF EXISTS "Odesílatel vytváří sdílení" ON album_shares;
DROP POLICY IF EXISTS "Příjemce aktualizuje status" ON album_shares;

CREATE POLICY "Vidí vlastní sdílení" ON album_shares FOR SELECT
  USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

CREATE POLICY "Odesílatel vytváří sdílení" ON album_shares FOR INSERT
  WITH CHECK (auth.uid() = sender_id);

CREATE POLICY "Příjemce aktualizuje status" ON album_shares FOR UPDATE
  USING (auth.uid() = receiver_id OR auth.uid() = sender_id);


-- ──────────────────────────────────────────────────────────────────
-- 3. USER_WISHLIST — karty které uživatel hledá / chce
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_wishlist (
  user_id     UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_id     TEXT    NOT NULL,
  card_data   JSONB   NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, card_id)
);

CREATE INDEX IF NOT EXISTS user_wishlist_user_idx ON user_wishlist(user_id);

ALTER TABLE user_wishlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Uživatel spravuje svůj wishlist" ON user_wishlist;
CREATE POLICY "Uživatel spravuje svůj wishlist" ON user_wishlist FOR ALL
  USING (auth.uid() = user_id);


-- ──────────────────────────────────────────────────────────────────
-- 4. NOTIFICATIONS — in-app notifikace (zvoneček)
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type        TEXT    NOT NULL,
  -- Typy: album_share_invite | share_accepted | share_declined | share_expiring | compare_done
  title       TEXT    NOT NULL,
  body        TEXT,
  link        TEXT,
  metadata    JSONB   DEFAULT '{}',
  read        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx ON notifications(user_id, read) WHERE read = false;
CREATE INDEX IF NOT EXISTS notifications_created_idx     ON notifications(created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Uživatel vidí vlastní notifikace" ON notifications;
DROP POLICY IF EXISTS "Uživatel označuje přečtené"       ON notifications;
DROP POLICY IF EXISTS "Systém vkládá notifikace"         ON notifications;

CREATE POLICY "Uživatel vidí vlastní notifikace" ON notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Uživatel označuje přečtené" ON notifications FOR UPDATE
  USING (auth.uid() = user_id);

-- INSERT přes service_role nebo anon pro systémové notifikace
CREATE POLICY "Systém vkládá notifikace" ON notifications FOR INSERT
  WITH CHECK (true);


-- ──────────────────────────────────────────────────────────────────
-- 5. FUNKCE: automatická expirace sdílení
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION expire_old_shares()
RETURNS void AS $$
BEGIN
  UPDATE album_shares
  SET status = 'expired'
  WHERE status = 'pending'
    AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Pokud máš pg_cron (Supabase Pro), odkomentuj:
-- SELECT cron.schedule('expire-shares', '0 * * * *', 'SELECT expire_old_shares()');


-- ──────────────────────────────────────────────────────────────────
-- 6. OVĚŘENÍ
-- ──────────────────────────────────────────────────────────────────

-- 6a. Uživatelé bez username
SELECT u.id, u.email, p.username
FROM auth.users u
LEFT JOIN profiles p ON p.id = u.id
WHERE p.username IS NULL OR p.id IS NULL
ORDER BY u.created_at;

-- 6b. Kontrola schématu album_shares (měla by vrátit receiver_id)
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'album_shares'
ORDER BY ordinal_position;
