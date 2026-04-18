-- ═══════════════════════════════════════════════════════════════════
--  OPRAVY – Sdílení alba (share-album.html nefunguje)
--  Spusť v Supabase → SQL Editor → New query → Run
--
--  Co opravuje:
--    1. handle_new_user trigger — přidá username při registraci
--    2. user_search view       — bezpečná verze bez JOIN auth.users
--    3. RLS policies           — ověření že search funguje
-- ═══════════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────────
-- 1. OPRAVA TRIGGER handle_new_user
--    Problém: migration_album_sharing_v2.sql přepsal trigger na
--    verzi která NEukládá username → NOT NULL constraint selže
--    → nová registrace vytvoří auth.users ale NE profiles záznam
--    → uživatel není nalezitelný při hledání
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, username, email)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'username',
      split_part(NEW.email, '@', 1)
    ),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Ujisti se že trigger existuje
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ──────────────────────────────────────────────────────────────────
-- 2. OPRAVA user_search VIEW
--    Problém: stará verze dělala JOIN auth.users — authenticated
--    role nemá přístup do auth schématu → search vracel chybu/0
--    Nová verze čte email přímo z profiles (kam ho trigger ukládá)
-- ──────────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.user_search;

CREATE VIEW public.user_search AS
  SELECT
    id,
    username,
    avatar_url,
    CASE
      WHEN email IS NOT NULL
      THEN CONCAT(LEFT(email, 2), '***@', SPLIT_PART(email, '@', 2))
      ELSE NULL
    END AS email_hint
  FROM public.profiles
  WHERE username IS NOT NULL;

-- Přístup: jen přihlášení, anon nemůže searchovat emaily
GRANT SELECT ON public.user_search TO authenticated;
REVOKE SELECT ON public.user_search FROM anon;


-- ──────────────────────────────────────────────────────────────────
-- 3. OVĚŘENÍ RLS na profiles
--    Přihlášení uživatelé musí mít SELECT na profiles ostatních
--    (jinak search v profiles fallbacku taky nefunguje)
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Smaž případné duplicitní/konfliktní policies
DROP POLICY IF EXISTS "Uživatel vidí vlastní profil" ON public.profiles;
DROP POLICY IF EXISTS "Přihlášený vidí username ostatních" ON public.profiles;
DROP POLICY IF EXISTS "Profily jsou veřejné" ON public.profiles;

-- Vlastní profil: plný přístup
CREATE POLICY "Uživatel vidí vlastní profil"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

-- Cizí profily: authenticated uživatel vidí všechny (pro search)
CREATE POLICY "Přihlášený vidí username ostatních"
  ON public.profiles FOR SELECT
  USING (auth.role() = 'authenticated');

-- UPDATE: jen vlastní profil
DROP POLICY IF EXISTS "Uživatel upravuje vlastní profil" ON public.profiles;
CREATE POLICY "Uživatel upravuje vlastní profil"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- INSERT: jen vlastní (trigger používá SECURITY DEFINER, nepotřebuje tuto policy)
DROP POLICY IF EXISTS "Uživatel vytváří vlastní profil" ON public.profiles;
CREATE POLICY "Uživatel vytváří vlastní profil"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);


-- ──────────────────────────────────────────────────────────────────
-- 4. OVĚŘENÍ RLS na user_albums
--    Pokud tabulka existuje ale policy chybí, alba se nenačtou
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE public.user_albums ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Uživatel vidí vlastní alba" ON public.user_albums;
CREATE POLICY "Uživatel vidí vlastní alba"
  ON public.user_albums FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Uživatel vkládá vlastní alba" ON public.user_albums;
CREATE POLICY "Uživatel vkládá vlastní alba"
  ON public.user_albums FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Uživatel upravuje vlastní alba" ON public.user_albums;
CREATE POLICY "Uživatel upravuje vlastní alba"
  ON public.user_albums FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Uživatel maže vlastní alba" ON public.user_albums;
CREATE POLICY "Uživatel maže vlastní alba"
  ON public.user_albums FOR DELETE
  USING (auth.uid() = user_id);


-- ──────────────────────────────────────────────────────────────────
-- 5. KONTROLNÍ DOTAZY — spusť ručně a zkontroluj výsledky
-- ──────────────────────────────────────────────────────────────────

-- Kolik profilů má username?
SELECT
  COUNT(*) FILTER (WHERE username IS NOT NULL) AS "má username",
  COUNT(*) FILTER (WHERE username IS NULL)     AS "chybí username (problém!)",
  COUNT(*)                                     AS "celkem"
FROM public.profiles;

-- Funguje view?
SELECT id, username, email_hint
FROM public.user_search
LIMIT 5;

-- Kolik alb je v databázi?
SELECT user_id, COUNT(*) AS pocet_alb
FROM public.user_albums
GROUP BY user_id
LIMIT 10;
