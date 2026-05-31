-- ═══════════════════════════════════════════════════════════════
--  RODINA — oprava RLS: zobrazení karet ze sdílených rodinných alb
--  Spusť v: Supabase Dashboard → SQL Editor → New query → Run
--
--  PROBLÉM: člen rodiny vidí v seznamu sdílené album, ale album je
--  prázdné (0 karet). Příčina: RLS na user_albums a user_cards pouští
--  čtení jen vlastníkovi (auth.uid() = user_id). Rodinný flow čte
--  cizí řádky → vrátí se [] → 0 karet.
--
--  ŘEŠENÍ: přidat SELECT policy, které pustí čtení alba/karet, pokud
--  mezi přihlášeným a vlastníkem existuje 'accepted' rodinné spojení
--  a album je v family_shared_albums označené is_shared = true.
--  Karty jsou navíc omezené jen na ty, které ve sdíleném albu reálně
--  jsou (local_id = ANY(card_ids)) — ostatní karty zůstávají skryté.
--
--  POZN.: Obě policy musí být aktivní současně — policy na user_cards
--  vnitřně čte user_albums, což podléhá user_albums RLS.
-- ═══════════════════════════════════════════════════════════════

-- ── user_albums: rodina vidí sdílené album člena ────────────────
DROP POLICY IF EXISTS "Rodina vidí sdílená alba" ON user_albums;
CREATE POLICY "Rodina vidí sdílená alba" ON user_albums FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM family_shared_albums fsa
    JOIN family_connections fc
      ON fc.status = 'accepted'
     AND (
          (fc.user_id   = fsa.owner_id AND fc.member_id = auth.uid()) OR
          (fc.member_id = fsa.owner_id AND fc.user_id   = auth.uid())
         )
    WHERE fsa.owner_id  = user_albums.user_id
      AND fsa.album_id  = user_albums.id
      AND fsa.is_shared = true
  )
);

-- ── user_cards: rodina vidí karty, které jsou ve sdíleném albu ───
DROP POLICY IF EXISTS "Rodina vidí karty ve sdílených albech" ON user_cards;
CREATE POLICY "Rodina vidí karty ve sdílených albech" ON user_cards FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM family_shared_albums fsa
    JOIN family_connections fc
      ON fc.status = 'accepted'
     AND (
          (fc.user_id   = fsa.owner_id AND fc.member_id = auth.uid()) OR
          (fc.member_id = fsa.owner_id AND fc.user_id   = auth.uid())
         )
    JOIN user_albums ua
      ON ua.user_id = fsa.owner_id
     AND ua.id      = fsa.album_id
    WHERE fsa.owner_id      = user_cards.user_id
      AND fsa.is_shared     = true
      AND user_cards.local_id = ANY (ua.card_ids)
  )
);

-- ═══════════════════════════════════════════════════════════════
--  KONTROLA (volitelné) — spusť jako přihlášený Loyd přes app,
--  nebo v SQL editoru (běží jako postgres = obejde RLS, takže
--  tady uvidíš data vždy; reálný test dělej z aplikace).
--
--  Kolik karet je reálně ve sdíleném albu Lama13:
--    SELECT count(*)
--    FROM user_cards uc
--    JOIN user_albums ua
--      ON ua.user_id = uc.user_id
--     AND uc.local_id = ANY(ua.card_ids)
--    WHERE uc.user_id = 'a160014c-eafe-4ebc-8483-74d2c42b8732'
--      AND ua.id      = 'alb_1777480933523';
-- ═══════════════════════════════════════════════════════════════
