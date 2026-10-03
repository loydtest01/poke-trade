-- ═══════════════════════════════════════════════════════════════════
--  OPRAVA album_shares: chybějící DELETE policy + sloupec viewed_at
--  Spusť v Supabase: SQL Editor → New query → paste → Run
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. DELETE policy (chyběla → zrušení sdílení nefungovalo) ──────
DROP POLICY IF EXISTS "Odesílatel maže vlastní sdílení" ON album_shares;

CREATE POLICY "Odesílatel maže vlastní sdílení" ON album_shares
  FOR DELETE
  USING (auth.uid() = sender_id);


-- ── 2. Sloupec viewed_at (chyběl → 400 chyba při načítání seznamu) ─
ALTER TABLE album_shares
  ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ DEFAULT NULL;


-- ── 3. Ověření ─────────────────────────────────────────────────────

-- Zkontroluj policies na tabulce (měl by být i DELETE)
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'album_shares'
ORDER BY cmd;

-- Zkontroluj že viewed_at existuje
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'album_shares'
ORDER BY ordinal_position;
