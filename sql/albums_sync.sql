-- ═══════════════════════════════════════════════════════════════
--  ALBA – tabulka pro obousměrný sync app ↔ web
--  Supabase → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════

-- ── Tabulka alb ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_albums (
  id          TEXT        NOT NULL,            -- 'alb_1234567890' (z app)
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL DEFAULT 'Album',
  color       TEXT        NOT NULL DEFAULT '#4f8ef7',
  icon        TEXT        NOT NULL DEFAULT '📁',
  owner_id    TEXT,                            -- profileId v app (null = hlavní)
  card_ids    TEXT[]      NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS user_albums_user_id_idx    ON user_albums(user_id);
CREATE INDEX IF NOT EXISTS user_albums_updated_at_idx ON user_albums(updated_at DESC);

ALTER TABLE user_albums ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Uživatel vidí vlastní alba" ON user_albums
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Uživatel vkládá vlastní alba" ON user_albums
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Uživatel upravuje vlastní alba" ON user_albums
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Uživatel maže vlastní alba" ON user_albums
  FOR DELETE USING (auth.uid() = user_id);

-- ── RPC: hromadný upsert alb ──────────────────────────────────
CREATE OR REPLACE FUNCTION upsert_user_albums(
  p_user_id UUID,
  p_albums  JSONB
)
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
      p_user_id,
      v_album->>'id',
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

  -- Smaž alba která nejsou v p_albums (uživatel je smazal)
  DELETE FROM user_albums
  WHERE user_id = p_user_id
    AND id NOT IN (
      SELECT v->>'id' FROM jsonb_array_elements(p_albums) v
    );

  RETURN jsonb_build_object('updated', v_updated);
END;
$$;

-- ═══════════════════════════════════════════════════════════════
--  ✅ HOTOVO! Tabulka user_albums je připravena.
-- ═══════════════════════════════════════════════════════════════
