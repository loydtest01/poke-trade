-- ══════════════════════════════════════════════════════════
--  user_search view – vyhledávání uživatelů podle přezdívky
--  nebo emailu v chatu
--  Spusť v Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════

-- View joinuje profiles + auth.users
-- SECURITY DEFINER = spouští se s právy vlastníka (postgres),
-- takže přes RLS lze omezit čtení na přihlášené uživatele

-- Nejdřív smaž starou verzi (i s jinými sloupci)
DROP VIEW IF EXISTS public.user_search;

CREATE VIEW public.user_search
AS
SELECT
  p.id,
  p.username,
  p.avatar_url,
  u.email AS email_hint
FROM public.profiles p
JOIN auth.users u ON p.id = u.id;

-- Přístup: pouze přihlášení uživatelé (authenticated role)
ALTER VIEW public.user_search OWNER TO postgres;
GRANT SELECT ON public.user_search TO authenticated;
REVOKE SELECT ON public.user_search FROM anon;

-- RLS na view nefunguje přímo – zajistíme přes GRANT výše
-- (anon nemůže číst emaily cizích uživatelů)
