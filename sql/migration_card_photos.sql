-- ────────────────────────────────────────────────────────────────
-- MIGRACE: user_card_photos
-- Ukládá reálné fotky (z telefonu/QR) k jednotlivým kartám v albu.
-- Spustit v Supabase SQL editoru.
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS user_card_photos (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_card_local_id TEXT      NOT NULL,   -- odkazuje na user_cards.local_id
  storage_path     TEXT        NOT NULL,   -- cesta v bucketu card-photo
  url              TEXT        NOT NULL,   -- veřejná URL (uložena při insertu)
  side             TEXT        NOT NULL DEFAULT 'front',  -- front | back | detail | name
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ucp_user_id_idx    ON user_card_photos(user_id);
CREATE INDEX IF NOT EXISTS ucp_local_id_idx   ON user_card_photos(user_card_local_id);

ALTER TABLE user_card_photos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname='Vlastník vidí vlastní fotky karty'
      AND tablename='user_card_photos'
  ) THEN
    CREATE POLICY "Vlastník vidí vlastní fotky karty"
      ON user_card_photos FOR SELECT USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname='Vlastník přidává fotky karty'
      AND tablename='user_card_photos'
  ) THEN
    CREATE POLICY "Vlastník přidává fotky karty"
      ON user_card_photos FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname='Vlastník maže fotky karty'
      AND tablename='user_card_photos'
  ) THEN
    CREATE POLICY "Vlastník maže fotky karty"
      ON user_card_photos FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;

-- Přidat local_id default (pokud ještě chybí) pro starší záznamy
-- Toto zajistí, že user_cards.local_id je vždy vyplněné
ALTER TABLE user_cards ALTER COLUMN local_id SET DEFAULT gen_random_uuid()::text;
