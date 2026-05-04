-- ════════════════════════════════════════════════════════════════════
-- VIP ALL whitelist + Featured listings + Cloudflare provider — PokéTrade
-- Spustit po migration_vip_referral.sql.
-- Bezpečné spustit opakovaně.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. vip_users tabulka (pokud zatím neexistuje) ────────────────────
-- Toto je whitelist účtů s LIFETIME VIP (Loyd, rodina, beta-testeři).
-- Tihle uživatelé:
--   - Nepotřebují prvních 100 ani referral systém
--   - vip_until = '9999-12-31' (efektivně navždy)
--   - vip_source = 'whitelist'

CREATE TABLE IF NOT EXISTS vip_users (
  email      TEXT PRIMARY KEY,
  reason     TEXT DEFAULT 'whitelist',  -- 'whitelist', 'family', 'beta_tester', 'manual_grant'
  added_at   TIMESTAMPTZ DEFAULT NOW(),
  added_by   TEXT
);

ALTER TABLE vip_users ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- Jen čtení pro authenticated (kvůli client-side checku)
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE policyname = 'VIP users – přihlášený čte' AND tablename = 'vip_users') THEN
    CREATE POLICY "VIP users – přihlášený čte" ON vip_users FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- ── 2. Seed VIP whitelist ────────────────────────────────────────────
-- Tihle uživatelé mají všechno bez omezení.

INSERT INTO vip_users (email, reason, added_by) VALUES
  ('papez.ondrej@gmail.com',     'owner',       'system'),
  ('loydtest@gmail.com',          'owner',       'system'),
  ('pan.spock30@gmail.com',       'family',      'system'),
  ('adelka.papezova@gmail.com',   'family',      'system'),
  ('pokecards.app.info@gmail.com','admin_alt',   'system'),
  ('lasovlas@seznam.cz',          'beta_tester', 'system'),
  ('james.t.kirk1933@gmail.com',  'beta_tester', 'system')
ON CONFLICT (email) DO NOTHING;


-- ── 3. is_vip_user(email) RPC — server-side helper ───────────────────
CREATE OR REPLACE FUNCTION is_vip_user(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM vip_users WHERE LOWER(email) = LOWER(p_email));
$$;

GRANT EXECUTE ON FUNCTION is_vip_user(TEXT) TO authenticated, anon;


-- ── 4. UPDATE claim_welcome_vip — whitelist check ───────────────────
-- Stejná funkce z migration_vip_referral.sql, jen přidává whitelist check.
-- Pokud user je ve vip_users → dostane LIFETIME VIP, vip_source = 'whitelist'
-- (a NEZAPOČÍTÁ se do prvních 100 counter-u — to je důležité aby beta testeři
-- nezabrali místa, která mají dostat skuteční noví uživatelé).

CREATE OR REPLACE FUNCTION claim_welcome_vip(
  p_user_id      UUID,
  p_browser_fp   TEXT,
  p_referral_code TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count           INTEGER;
  v_vip_days        INTEGER;
  v_vip_source      TEXT;
  v_user_email      TEXT;
  v_is_whitelist    BOOLEAN;
  v_referrer_id     UUID;
  v_already_claimed BOOLEAN;
  v_dup_fp_count    INTEGER;
BEGIN
  -- Bezpečnost: jen owner může claimovat
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RETURN jsonb_build_object('success', false, 'reason', 'unauthorized');
  END IF;

  -- Email uživatele (potřeba pro whitelist check)
  SELECT email INTO v_user_email FROM auth.users WHERE id = p_user_id;

  -- Whitelist check — beta testeři & rodina dostávají vše navždy
  v_is_whitelist := EXISTS (SELECT 1 FROM vip_users WHERE LOWER(email) = LOWER(v_user_email));

  IF v_is_whitelist THEN
    -- Aktualizuj profil: lifetime VIP. Idempotent — i kdyby se zavolalo opakovaně.
    UPDATE profiles
      SET vip_until    = '9999-12-31'::timestamptz,
          vip_source   = 'whitelist',
          browser_fp   = COALESCE(p_browser_fp, browser_fp)
      WHERE id = p_user_id;

    -- Vygeneruj referral kód pokud ještě nemá (i whitelist user může doporučovat)
    PERFORM generate_referral_code(p_user_id) FROM profiles
      WHERE id = p_user_id AND referral_code IS NULL;

    RETURN jsonb_build_object(
      'success',     true,
      'vip_days',    -1,           -- -1 = lifetime
      'vip_source',  'whitelist',
      'lifetime',    true,
      'first_100',   false
    );
  END IF;

  -- Už claimnul? (jen pro non-whitelist; whitelist je idempotent výše)
  SELECT vip_until IS NOT NULL INTO v_already_claimed FROM profiles WHERE id = p_user_id;
  IF v_already_claimed THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_claimed');
  END IF;

  -- Anti-abuse: stejný fingerprint u jiného non-banned účtu
  IF p_browser_fp IS NOT NULL AND LENGTH(p_browser_fp) > 16 THEN
    SELECT COUNT(*) INTO v_dup_fp_count
      FROM profiles
      WHERE browser_fp = p_browser_fp
        AND id <> p_user_id
        AND COALESCE(is_banned, false) = false;

    IF v_dup_fp_count > 0 THEN
      INSERT INTO suspicious_events (user_id, event_type, severity, details)
        VALUES (p_user_id, 'duplicate_fingerprint', 'high',
          jsonb_build_object('fp', p_browser_fp, 'matches', v_dup_fp_count));
      UPDATE profiles SET browser_fp = p_browser_fp,
                          suspicious_score = COALESCE(suspicious_score, 0) + 50
        WHERE id = p_user_id;
      RETURN jsonb_build_object('success', false, 'reason', 'duplicate_fingerprint');
    END IF;
  END IF;

  -- Referral
  IF p_referral_code IS NOT NULL AND p_referral_code <> '' THEN
    SELECT id INTO v_referrer_id FROM profiles
      WHERE referral_code = p_referral_code AND id <> p_user_id;
    IF v_referrer_id IS NOT NULL THEN
      INSERT INTO referral_events (referrer_id, referee_id, status, referee_fp)
        VALUES (v_referrer_id, p_user_id, 'pending', p_browser_fp)
        ON CONFLICT (referrer_id, referee_id) DO NOTHING;
    END IF;
  END IF;

  -- Counter check (bez whitelist)
  SELECT value INTO v_count FROM app_counters WHERE key = 'first_100_vip_granted';

  IF v_count < 100 THEN
    v_vip_days   := 30;
    v_vip_source := 'first_100';
    UPDATE app_counters SET value = value + 1, updated_at = NOW()
      WHERE key = 'first_100_vip_granted';
  ELSE
    v_vip_days   := 14;
    v_vip_source := 'standard';
  END IF;

  UPDATE profiles
    SET vip_until    = NOW() + (v_vip_days || ' days')::interval,
        vip_source   = v_vip_source,
        browser_fp   = COALESCE(p_browser_fp, browser_fp),
        referred_by  = COALESCE(referred_by, v_referrer_id)
    WHERE id = p_user_id;

  PERFORM generate_referral_code(p_user_id) FROM profiles
    WHERE id = p_user_id AND referral_code IS NULL;

  RETURN jsonb_build_object(
    'success',     true,
    'vip_days',    v_vip_days,
    'vip_source',  v_vip_source,
    'first_100',   v_vip_source = 'first_100',
    'lifetime',    false,
    'referrer_id', v_referrer_id
  );
END $$;


-- ── 5. Featured listings — sloupec v listings tabulce ────────────────
-- VIP uživatelé mohou označit některé své listingy jako "featured" → zobrazí se
-- v sekci "⭐ Featured" nahoře v marketplace. Limit 3 per VIP per čas.
--
-- last_featured_at — kdy byl listing naposledy zobrazený v marketplace rotaci.
-- Server-side rotace seřadí všechny featured listingy podle tohoto pole vzestupně
-- (nejdéle se nezobrazoval = první) a vrátí první 3 → fair distribution.

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS is_featured       BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS featured_until    TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS last_featured_at  TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_listings_featured ON listings(is_featured, featured_until)
  WHERE is_featured = true;
CREATE INDEX IF NOT EXISTS idx_listings_featured_rotation
  ON listings(last_featured_at NULLS FIRST) WHERE is_featured = true;


-- ── 6. RPC: toggle_featured(listing_id) — VIP-only ───────────────────
-- VIP zaškrtne listing jako featured. Limity:
--   - Max 3 současně featured per uživatel (přepsatelné níže)
--   - Featured zmizí po 30 dnech (featured_until)
--   - Jen pokud user je aktivní VIP (is_vip nebo whitelist)

CREATE OR REPLACE FUNCTION toggle_featured_listing(p_listing_id UUID, p_max_featured INTEGER DEFAULT 3)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id        UUID;
  v_is_vip         BOOLEAN;
  v_is_owner       BOOLEAN;
  v_currently_featured BOOLEAN;
  v_active_count   INTEGER;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'unauthorized');
  END IF;

  -- VIP check (lifetime nebo aktivní)
  SELECT COALESCE(vip_until > NOW(), false) INTO v_is_vip FROM profiles WHERE id = v_user_id;
  IF NOT v_is_vip THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_vip');
  END IF;

  -- Owner check (jen vlastník listingu může togglovat)
  SELECT EXISTS (SELECT 1 FROM listings WHERE id = p_listing_id AND user_id = v_user_id)
    INTO v_is_owner;
  IF NOT v_is_owner THEN
    RETURN jsonb_build_object('success', false, 'reason', 'not_owner');
  END IF;

  -- Aktuální stav
  SELECT COALESCE(is_featured, false) INTO v_currently_featured
    FROM listings WHERE id = p_listing_id;

  IF v_currently_featured THEN
    -- UN-feature
    UPDATE listings SET is_featured = false, featured_until = NULL
      WHERE id = p_listing_id;
    RETURN jsonb_build_object('success', true, 'featured', false);
  ELSE
    -- FEATURE — limit check
    SELECT COUNT(*) INTO v_active_count FROM listings
      WHERE user_id = v_user_id
        AND is_featured = true
        AND (featured_until IS NULL OR featured_until > NOW());
    IF v_active_count >= p_max_featured THEN
      RETURN jsonb_build_object('success', false, 'reason', 'limit_reached',
        'limit', p_max_featured, 'current', v_active_count);
    END IF;

    UPDATE listings
      SET is_featured = true,
          featured_until = NOW() + INTERVAL '30 days'
      WHERE id = p_listing_id;
    RETURN jsonb_build_object('success', true, 'featured', true,
      'until', (NOW() + INTERVAL '30 days')::text);
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION toggle_featured_listing(UUID, INTEGER) TO authenticated;


-- ── 7a. RPC: get_featured_rotation(limit) — fair rotation ───────────
-- Vrátí N (default 3) featured listingů s "fair rotation" algoritmem:
--   1. Filtruje aktivní featured (is_featured=true, featured_until > NOW())
--   2. Seřadí vzestupně podle last_featured_at (NULL nejdřív = nikdy nezobrazené)
--      Při stejném čase deterministický tie-breaker přes id (ne random aby se
--      v jednom request batchu nezdvojily).
--   3. Vezme prvních N
--   4. Aktualizuje jejich last_featured_at = NOW()
--
-- Tím se zajistí že každý featured listing dostane podobný počet zobrazení,
-- bez "rich-get-richer" efektu náhodného výběru. Když máš 10 featured a slot 3:
-- za 4 stránky shlédnutí jsi viděl všech 10 ± 1.
--
-- Pozor: SECURITY DEFINER aby šlo updatovat last_featured_at i bez owner přístupu
-- (kdokoliv si zobrazí marketplace → server může updatovat svým privilegiem).

CREATE OR REPLACE FUNCTION get_featured_rotation(p_limit INTEGER DEFAULT 3)
RETURNS SETOF listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids UUID[];
BEGIN
  -- Vyber p_limit listingů s nejstarším last_featured_at (fair rotation).
  -- COALESCE → NULL se rovná epoch, takže "nikdy nezobrazené" mají nejvyšší prioritu.
  SELECT ARRAY_AGG(id ORDER BY rn) INTO v_ids
  FROM (
    SELECT id, ROW_NUMBER() OVER (
      ORDER BY COALESCE(last_featured_at, '1970-01-01'::timestamptz) ASC, id ASC
    ) AS rn
    FROM listings
    WHERE is_featured = true
      AND COALESCE(featured_until, NOW() + INTERVAL '1 second') > NOW()
      AND status = 'active'
    LIMIT p_limit
  ) sub;

  -- Žádné featured? Vrať prázdný set.
  IF v_ids IS NULL OR cardinality(v_ids) = 0 THEN
    RETURN;
  END IF;

  -- Touch last_featured_at na vybraných (jen těchto, ne všech)
  UPDATE listings SET last_featured_at = NOW() WHERE id = ANY(v_ids);

  -- Vrať listingy ve stejném pořadí (=ROW_NUMBER pořadí)
  RETURN QUERY
    SELECT l.* FROM listings l
    JOIN unnest(v_ids) WITH ORDINALITY AS u(id, ord) ON u.id = l.id
    ORDER BY u.ord;
END $$;

GRANT EXECUTE ON FUNCTION get_featured_rotation(INTEGER) TO anon, authenticated;


-- ── 8. Cloudflare Workers AI — sloupec v user_api_keys ───────────────
-- Cloudflare API klíč má speciální formát: potřebuje BOTH account_id AND token.
-- Uložíme jako 'account_id:token' v jednom sloupci.

ALTER TABLE user_api_keys
  ADD COLUMN IF NOT EXISTS cloudflare_key TEXT;

COMMENT ON COLUMN user_api_keys.cloudflare_key IS
  'Cloudflare Workers AI klíč ve formátu account_id:token. Free tier 10000 Neuronů/den. Vision: Llama 3.2 11B Vision.';


-- ── HOTOVO ──────────────────────────────────────────────────────────
-- Po spuštění:
--   1. Ověř whitelist: SELECT * FROM vip_users;
--   2. Pro existujícího Loyda spusť claim ručně (idempotent):
--      Loyd se musí přihlásit — vip-referral.js zavolá claim_welcome_vip
--      a uvidí lifetime VIP. Nebo ručně:
--      UPDATE profiles SET vip_until = '9999-12-31', vip_source = 'whitelist'
--        WHERE id IN (SELECT id FROM auth.users WHERE email IN (SELECT email FROM vip_users));
--   3. Test featured: SELECT * FROM listings WHERE is_featured = true;
