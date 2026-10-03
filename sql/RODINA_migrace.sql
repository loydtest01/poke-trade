-- ═══════════════════════════════════════════════════════════════
--  RODINA — SQL migrace pro Supabase
--  Spusť v: Supabase Dashboard → SQL Editor → New query
-- ═══════════════════════════════════════════════════════════════

-- 1) Propojení rodinných účtů
CREATE TABLE IF NOT EXISTS family_connections (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, member_id)
);

-- 2) Sdílená alba (trvalé, bez vypršení)
CREATE TABLE IF NOT EXISTS family_shared_albums (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  album_id   text NOT NULL,
  album_name text NOT NULL DEFAULT 'Album',
  is_shared  boolean NOT NULL DEFAULT false,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(owner_id, album_id)
);

-- 3) Row Level Security
ALTER TABLE family_connections    ENABLE ROW LEVEL SECURITY;
ALTER TABLE family_shared_albums  ENABLE ROW LEVEL SECURITY;

-- Policies: family_connections
CREATE POLICY "family_conn_select" ON family_connections FOR SELECT
  USING (auth.uid() = user_id OR auth.uid() = member_id);

CREATE POLICY "family_conn_insert" ON family_connections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "family_conn_update" ON family_connections FOR UPDATE
  USING (auth.uid() = member_id OR auth.uid() = user_id);

CREATE POLICY "family_conn_delete" ON family_connections FOR DELETE
  USING (auth.uid() = user_id OR auth.uid() = member_id);

-- Policies: family_shared_albums
CREATE POLICY "family_shared_select" ON family_shared_albums FOR SELECT
  USING (
    auth.uid() = owner_id OR
    EXISTS (
      SELECT 1 FROM family_connections
      WHERE status = 'accepted'
      AND (
        (user_id  = owner_id AND member_id = auth.uid()) OR
        (member_id = owner_id AND user_id  = auth.uid())
      )
    )
  );

CREATE POLICY "family_shared_all" ON family_shared_albums
  FOR ALL USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- 4) Indexy pro výkon
CREATE INDEX IF NOT EXISTS idx_famconn_user    ON family_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_famconn_member  ON family_connections(member_id);
CREATE INDEX IF NOT EXISTS idx_famconn_status  ON family_connections(status);
CREATE INDEX IF NOT EXISTS idx_famshared_owner ON family_shared_albums(owner_id);
CREATE INDEX IF NOT EXISTS idx_famshared_album ON family_shared_albums(album_id);

-- ═══════════════════════════════════════════════════════════════
--  HOTOVO — po spuštění zmizí 404 chyby v konzoli
-- ═══════════════════════════════════════════════════════════════
