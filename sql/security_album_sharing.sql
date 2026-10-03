-- ════════════════════════════════════════════════════════════════
--  ZABEZPEČENÍ SDÍLENÍ ALB — model „žádost ke schválení" (FB/Messenger)
--  + odstřižení blokovaných uživatelů (sdílení i notifikace)
--
--  Spustit v Supabase: SQL Editor → New query → paste → Run
--  Bezpečné spustit opakovaně (idempotentní).
-- ════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────
--  Helper: je dvojice (a,b) blokovaná v jakémkoliv směru?
--  SECURITY DEFINER aby viděl do blocked_users i pod RLS volajícího.
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_blocked_pair(a UUID, b UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM blocked_users
    WHERE (blocker_id = a AND blocked_id = b)
       OR (blocker_id = b AND blocked_id = a)
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_blocked_pair(UUID, UUID) TO authenticated;


-- ════════════════════════════════════════════════════════════════
--  1) ALBUM_SHARES — sdílet smí kdokoliv, ale:
--       • jen sám za sebe (sender = já)
--       • NE pokud je s příjemcem blokace (kterýmkoliv směrem)
--       • nové sdílení MUSÍ být 'pending' (žádost ke schválení)
--       • nesmíš sdílet sám sobě
-- ════════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Odesílatel vytváří sdílení" ON album_shares;
CREATE POLICY "Odesílatel vytváří sdílení" ON album_shares
  FOR INSERT
  WITH CHECK (
    auth.uid() = sender_id
    AND receiver_id <> sender_id
    AND status = 'pending'
    AND NOT public.is_blocked_pair(sender_id, receiver_id)
  );

-- SELECT: jen účastníci (beze změny, pro jistotu znovu)
DROP POLICY IF EXISTS "Vidí vlastní sdílení" ON album_shares;
CREATE POLICY "Vidí vlastní sdílení" ON album_shares
  FOR SELECT
  USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

-- UPDATE: status (přijmout/odmítnout) smí MĚNIT jen příjemce;
--         odesílatel smí měnit jen své (např. zrušit) — ale ne „za příjemce".
DROP POLICY IF EXISTS "Příjemce aktualizuje status" ON album_shares;
CREATE POLICY "Příjemce aktualizuje status" ON album_shares
  FOR UPDATE
  USING (auth.uid() = receiver_id OR auth.uid() = sender_id)
  WITH CHECK (auth.uid() = receiver_id OR auth.uid() = sender_id);

-- DELETE: jen odesílatel své (beze změny)
DROP POLICY IF EXISTS "Odesílatel maže vlastní sdílení" ON album_shares;
CREATE POLICY "Odesílatel maže vlastní sdílení" ON album_shares
  FOR DELETE
  USING (auth.uid() = sender_id);


-- ════════════════════════════════════════════════════════════════
--  2) NOTIFICATIONS — anti-spam
--     Problém: INSERT byl WITH CHECK (true) → kdokoliv komukoliv.
--     Nově: uživatel smí vytvořit notifikaci JEN když:
--       • cílí na NĚKOHO JINÉHO (klasická akce: „sdílel jsem ti album")
--       • a NENÍ s adresátem blokace
--     Systémové notifikace (triggery / service_role) RLS obchází automaticky,
--     takže tahle politika je jen pro klientské INSERTy.
-- ════════════════════════════════════════════════════════════════
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Systém vkládá notifikace" ON notifications;
DROP POLICY IF EXISTS "Klient vkládá notifikace bezpečně" ON notifications;
CREATE POLICY "Klient vkládá notifikace bezpečně" ON notifications
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND user_id <> auth.uid()                       -- notifikace cílí na druhého (akce)
    AND NOT public.is_blocked_pair(auth.uid(), user_id)
  );

-- SELECT/UPDATE jen vlastní (pro jistotu znovu, idempotentně)
DROP POLICY IF EXISTS "Uživatel vidí vlastní notifikace" ON notifications;
CREATE POLICY "Uživatel vidí vlastní notifikace" ON notifications
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Uživatel označuje přečtené" ON notifications;
CREATE POLICY "Uživatel označuje přečtené" ON notifications
  FOR UPDATE USING (auth.uid() = user_id);


-- ════════════════════════════════════════════════════════════════
--  3) OVĚŘENÍ
-- ════════════════════════════════════════════════════════════════
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN ('album_shares','notifications')
ORDER BY tablename, cmd;

-- Test helperu (vrátí true/false):
-- SELECT public.is_blocked_pair('<uuid_A>','<uuid_B>');
