-- ═══════════════════════════════════════════════════════════════════
--  MIGRACE: Blokování uživatelů v chatu
--  Spusť v Supabase: SQL Editor → New query → paste → Run
-- ═══════════════════════════════════════════════════════════════════

-- ──────────────────────────────────────────────────────────────────
-- 1. TABULKA blocked_users
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS blocked_users (
  blocker_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE INDEX IF NOT EXISTS blocked_users_blocker_idx ON blocked_users(blocker_id);
CREATE INDEX IF NOT EXISTS blocked_users_blocked_idx ON blocked_users(blocked_id);

ALTER TABLE blocked_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Uživatel spravuje své blokace" ON blocked_users;
CREATE POLICY "Uživatel spravuje své blokace" ON blocked_users FOR ALL
  USING (auth.uid() = blocker_id);


-- ──────────────────────────────────────────────────────────────────
-- 2. SOFT DELETE konverzace — přidat sloupce hidden_for
--    (nevymažeme konverzaci, jen ji skryjeme pro daného uživatele)
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS hidden_user1 BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hidden_user2 BOOLEAN NOT NULL DEFAULT false;


-- ──────────────────────────────────────────────────────────────────
-- 3. OVĚŘENÍ
-- ──────────────────────────────────────────────────────────────────
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('blocked_users', 'conversations')
ORDER BY table_name, ordinal_position;
