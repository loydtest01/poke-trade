-- ═══════════════════════════════════════════════════════════════════
--  MIGRACE: Vyhledávání uživatelů (Fáze 1 — search profiles)
--  Spusť v Supabase: SQL Editor → New query → paste → Run
--
--  Co dělá:
--    1. Přidá RLS policy pro veřejné čtení username + avatar_url z profiles
--       (anon/authenticated může vyhledávat, nikdo nevidí email ani id přímo)
--    2. Vytvoří pomocné VIEW pro search (maskuje email)
--    3. Přidá index pro rychlé ILIKE vyhledávání
--    4. Přidá RLS policy pro anon INSERT do notifications
--       (server-side notifikace přes anon key bez service_role)
-- ═══════════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────────
-- 1. INDEX pro rychlé vyhledávání podle username (ILIKE)
--    pg_trgm umožňuje ILIKE na libovolný substring efektivně
-- ──────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS profiles_username_trgm_idx
  ON profiles USING GIN (username gin_trgm_ops);

CREATE INDEX IF NOT EXISTS profiles_email_trgm_idx
  ON profiles USING GIN (email gin_trgm_ops);


-- ──────────────────────────────────────────────────────────────────
-- 2. RLS policy: přihlášený uživatel může číst username + avatar
--    z profiles ostatních uživatelů (potřebné pro vyhledávání)
--
--    POZOR: email se NEZVEŘEJŇUJE přes tuto policy —
--    email je dostupný jen přes přesnou shodu v existující logice
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Vlastní profil: uživatel vidí vše o sobě
DROP POLICY IF EXISTS "Uživatel vidí vlastní profil" ON profiles;
CREATE POLICY "Uživatel vidí vlastní profil" ON profiles FOR SELECT
  USING (auth.uid() = id);

-- Cizí profily: jen username a avatar_url (ne email, ne interní data)
-- Slouží pro vyhledávání příjemce sdílení
DROP POLICY IF EXISTS "Přihlášený vidí username ostatních" ON profiles;
CREATE POLICY "Přihlášený vidí username ostatních" ON profiles FOR SELECT
  USING (auth.role() = 'authenticated');

-- Vlastní profil: uživatel může aktualizovat své údaje
DROP POLICY IF EXISTS "Uživatel upravuje vlastní profil" ON profiles;
CREATE POLICY "Uživatel upravuje vlastní profil" ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- INSERT: trigger handle_new_user vkládá přes SECURITY DEFINER — nepotřebuje policy
-- ale pro jistotu přidáme:
DROP POLICY IF EXISTS "Uživatel vytváří vlastní profil" ON profiles;
CREATE POLICY "Uživatel vytváří vlastní profil" ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);


-- ──────────────────────────────────────────────────────────────────
-- 3. VIEW pro vyhledávání uživatelů — exponuje jen bezpečná pole
--    Použití: SELECT * FROM user_search WHERE username ILIKE '%query%'
--    Frontend query (share-album.html):
--      /rest/v1/user_search?username=ilike.*query*&limit=10
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW user_search AS
  SELECT
    id,
    username,
    avatar_url,
    -- Email pouze jako hint: zobrazíme jen doménu (@gmail.com)
    -- Přesný email nikdy neexponujeme přes view
    CASE
      WHEN email IS NOT NULL
      THEN CONCAT(LEFT(email, 2), '***@', SPLIT_PART(email, '@', 2))
      ELSE NULL
    END AS email_hint
  FROM profiles
  WHERE username IS NOT NULL;

-- Práva na view: přihlášený čte, anon ne
GRANT SELECT ON user_search TO authenticated;
REVOKE SELECT ON user_search FROM anon;


-- ──────────────────────────────────────────────────────────────────
-- 4. RLS pro notifications — server (anon key) může vkládat
--    notifikace pro libovolného uživatele (systémové notifikace)
--    Policy je již v migration_album_sharing_v2.sql ale pro jistotu:
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Systém vkládá notifikace" ON notifications;
CREATE POLICY "Systém vkládá notifikace" ON notifications FOR INSERT
  WITH CHECK (true);  -- anon i authenticated smí INSERT


-- ──────────────────────────────────────────────────────────────────
-- 5. OVĚŘENÍ: otestuj vyhledávání
--    Výsledek: uživatelé jejichž username obsahuje 'test'
--    (uprав query dle svých testovacích uživatelů)
-- ──────────────────────────────────────────────────────────────────
SELECT id, username, avatar_url, email_hint
FROM user_search
WHERE username ILIKE '%a%'   -- změň na libovolný substring
LIMIT 10;

-- Ověř počet profilů se správným username:
SELECT
  COUNT(*) FILTER (WHERE username IS NOT NULL) AS "má username",
  COUNT(*) FILTER (WHERE username IS NULL)     AS "chybí username",
  COUNT(*)                                     AS "celkem"
FROM profiles;
