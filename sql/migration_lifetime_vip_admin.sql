-- ════════════════════════════════════════════════════════════════════
-- Lifetime VIP system + admin VIP tools — PokéTrade
-- Spustit po migration_vip_all_featured_cloudflare.sql.
-- Bezpečné spouštět opakovaně (idempotent).
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Counter "lifetime VIP granted" ────────────────────────────────
-- Prvních 10 nových uživatelů (po whitelistu — 8 Loydových účtů) dostanou
-- LIFETIME VIP. Whitelist se nepočítá — ten zůstává mimo systém.
-- Po dosažení 20 nový uživatel dostává 30 dní (first_100) nebo 14 dní (standard).

INSERT INTO app_counters (key, value)
  VALUES ('lifetime_vip_granted', 0)
  ON CONFLICT (key) DO NOTHING;

-- View pro hlavní stránku — kolik míst zbývá z prvních 10 lifetime
-- Každý si může načíst tento view (RLS allows).
CREATE OR REPLACE VIEW lifetime_vip_status AS
SELECT
  value AS granted,
  GREATEST(10 - value, 0) AS remaining,
  10 AS total,
  (value < 10) AS available
FROM app_counters
WHERE key = 'lifetime_vip_granted';

GRANT SELECT ON lifetime_vip_status TO anon, authenticated;


-- ── 2. UPDATE claim_welcome_vip — přidat lifetime fork ─────────────
-- Nová logika (prioritou shora dolů):
--   1. Whitelist (vip_users tabulka) → lifetime VIP, NEZAPOČÍTÁ se do counterů
--   2. Lifetime counter < 10 → lifetime VIP, vip_source = 'lifetime_first_10', counter +1
--   3. First-100 counter < 100 → 30 dní VIP, vip_source = 'first_100', counter +1
--   4. Jinak → 14 dní VIP, vip_source = 'standard'
--
-- Counter "lifetime_vip_granted" je oddělený od "first_100_vip_granted" — oba běží paralelně.
-- Když uživatel dostane lifetime, NEZABERE místo z prvních 100 (ani naopak).

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
  v_first_100_count INTEGER;
  v_lifetime_count  INTEGER;
  v_vip_days        INTEGER;
  v_vip_source      TEXT;
  v_vip_until       TIMESTAMPTZ;
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

  SELECT email INTO v_user_email FROM auth.users WHERE id = p_user_id;

  -- Whitelist check (vip_users) → lifetime + VRACÍME (nepočítá se nikam)
  v_is_whitelist := EXISTS (SELECT 1 FROM vip_users WHERE LOWER(email) = LOWER(v_user_email));

  IF v_is_whitelist THEN
    UPDATE profiles
      SET vip_until    = '9999-12-31'::timestamptz,
          vip_source   = 'whitelist',
          browser_fp   = COALESCE(p_browser_fp, browser_fp)
      WHERE id = p_user_id;
    PERFORM generate_referral_code(p_user_id) FROM profiles
      WHERE id = p_user_id AND referral_code IS NULL;
    RETURN jsonb_build_object(
      'success',     true,
      'vip_days',    -1,
      'vip_source',  'whitelist',
      'lifetime',    true
    );
  END IF;

  -- Already claimed?
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

  -- Counter checks (lifetime → first_100 → standard)
  SELECT value INTO v_lifetime_count  FROM app_counters WHERE key = 'lifetime_vip_granted';
  SELECT value INTO v_first_100_count FROM app_counters WHERE key = 'first_100_vip_granted';

  IF v_lifetime_count < 10 THEN
    -- LIFETIME VIP — prvních 10 (mimo whitelist)
    v_vip_until  := '9999-12-31'::timestamptz;
    v_vip_source := 'lifetime_first_10';
    UPDATE app_counters SET value = value + 1, updated_at = NOW()
      WHERE key = 'lifetime_vip_granted';
    v_vip_days   := -1;
  ELSIF v_first_100_count < 100 THEN
    v_vip_until  := NOW() + INTERVAL '30 days';
    v_vip_source := 'first_100';
    UPDATE app_counters SET value = value + 1, updated_at = NOW()
      WHERE key = 'first_100_vip_granted';
    v_vip_days   := 30;
  ELSE
    v_vip_until  := NOW() + INTERVAL '14 days';
    v_vip_source := 'standard';
    v_vip_days   := 14;
  END IF;

  UPDATE profiles
    SET vip_until    = v_vip_until,
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
    'lifetime',    v_vip_source IN ('whitelist', 'lifetime_first_10'),
    'referrer_id', v_referrer_id
  );
END $$;


-- ── 3. RPC: admin_grant_vip(target_user_id, days, reason) ─────────
-- Admin manuálně udělí VIP konkrétnímu uživateli na X dní (nebo lifetime když days=-1).
-- Bezpečnost: SECURITY DEFINER + kontrola že volající je v ADMIN_EMAILS.

CREATE OR REPLACE FUNCTION admin_grant_vip(
  p_target_user_id UUID,
  p_days           INTEGER,    -- -1 = lifetime, jinak počet dní
  p_reason         TEXT DEFAULT 'manual'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_email TEXT;
  v_new_until    TIMESTAMPTZ;
  v_target_email TEXT;
BEGIN
  -- Auth check — volající musí být admin
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'unauthorized');
  END IF;
  SELECT email INTO v_caller_email FROM auth.users WHERE id = auth.uid();
  IF LOWER(v_caller_email) NOT IN ('papez.ondrej@gmail.com', 'loydtest@gmail.com') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'forbidden');
  END IF;

  -- Najdi cíl
  SELECT email INTO v_target_email FROM auth.users WHERE id = p_target_user_id;
  IF v_target_email IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'user_not_found');
  END IF;

  -- Spočítej nový vip_until: -1 = lifetime, jinak NOW() + days
  -- Pokud user už má aktivní VIP, prodlužujeme od current vip_until (extend, ne reset)
  IF p_days = -1 THEN
    v_new_until := '9999-12-31'::timestamptz;
  ELSE
    SELECT GREATEST(COALESCE(vip_until, NOW()), NOW()) + (p_days || ' days')::interval
      INTO v_new_until FROM profiles WHERE id = p_target_user_id;
  END IF;

  UPDATE profiles
    SET vip_until  = v_new_until,
        vip_source = COALESCE(p_reason, 'manual')
    WHERE id = p_target_user_id;

  -- Log do suspicious_events jako audit (jen INFO severity)
  INSERT INTO suspicious_events (user_id, event_type, severity, details)
    VALUES (p_target_user_id, 'admin_vip_grant', 'low',
      jsonb_build_object(
        'admin', v_caller_email,
        'days', p_days,
        'until', v_new_until,
        'reason', p_reason
      ));

  RETURN jsonb_build_object(
    'success',  true,
    'until',    v_new_until,
    'lifetime', p_days = -1,
    'email',    v_target_email
  );
END $$;

GRANT EXECUTE ON FUNCTION admin_grant_vip(UUID, INTEGER, TEXT) TO authenticated;


-- ── 4. RPC: admin_revoke_vip(target_user_id) ──────────────────────
-- Admin odebere VIP — nastaví vip_until = NOW()-1s (efektivně expired).
-- Pokud byl whitelist user → odebrat ze vip_users tabulky (jinak by se znovu obnovil
-- při dalším loginu z claim_welcome_vip).

CREATE OR REPLACE FUNCTION admin_revoke_vip(p_target_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_email TEXT;
  v_target_email TEXT;
  v_was_whitelist BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'unauthorized');
  END IF;
  SELECT email INTO v_caller_email FROM auth.users WHERE id = auth.uid();
  IF LOWER(v_caller_email) NOT IN ('papez.ondrej@gmail.com', 'loydtest@gmail.com') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'forbidden');
  END IF;

  SELECT email INTO v_target_email FROM auth.users WHERE id = p_target_user_id;
  IF v_target_email IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'user_not_found');
  END IF;

  -- Whitelist check — odeber z vip_users aby se neobnovil
  SELECT EXISTS (SELECT 1 FROM vip_users WHERE LOWER(email) = LOWER(v_target_email))
    INTO v_was_whitelist;
  IF v_was_whitelist THEN
    DELETE FROM vip_users WHERE LOWER(email) = LOWER(v_target_email);
  END IF;

  UPDATE profiles
    SET vip_until  = NOW() - INTERVAL '1 second',
        vip_source = 'revoked'
    WHERE id = p_target_user_id;

  INSERT INTO suspicious_events (user_id, event_type, severity, details)
    VALUES (p_target_user_id, 'admin_vip_revoke', 'low',
      jsonb_build_object('admin', v_caller_email, 'was_whitelist', v_was_whitelist));

  RETURN jsonb_build_object(
    'success',       true,
    'email',         v_target_email,
    'was_whitelist', v_was_whitelist
  );
END $$;

GRANT EXECUTE ON FUNCTION admin_revoke_vip(UUID) TO authenticated;


-- ── 5. Migrace existujících VIP účtů na lifetime ──────────────────
-- Loyd má potřebu některé existující účty (ze sessions kde first_100 fungoval)
-- převést na lifetime. Tato migrace TO NEDĚLÁ AUTOMATICKY — čeká se ruční výběr.
-- Ale připravme RPC pro hromadný grant podle emailu:

CREATE OR REPLACE FUNCTION admin_grant_vip_by_email(
  p_target_email TEXT,
  p_days         INTEGER,
  p_reason       TEXT DEFAULT 'manual_email'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE LOWER(email) = LOWER(p_target_email);
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'email_not_found');
  END IF;
  RETURN admin_grant_vip(v_user_id, p_days, p_reason);
END $$;

GRANT EXECUTE ON FUNCTION admin_grant_vip_by_email(TEXT, INTEGER, TEXT) TO authenticated;


-- ── 6. View pro admin: VIP přehled se spotřebou ───────────────────
-- Vrátí všechny aktuální VIP uživatele se spotřebou za posledních 7 dní + total.
-- Spotřeba = sum(search_count + fake_count) z groq_usage tabulky.

CREATE OR REPLACE VIEW admin_vip_overview AS
SELECT
  p.id,
  p.username,
  au.email,
  p.vip_until,
  p.vip_source,
  p.referrals_count,
  p.created_at,
  p.is_banned,
  -- Spotřeba za posledních 7 dní
  COALESCE(usage_7d.requests_7d, 0) AS requests_7d,
  COALESCE(usage_7d.search_7d, 0)   AS search_7d,
  COALESCE(usage_7d.fake_7d, 0)     AS fake_7d,
  -- Spotřeba za vše (od založení účtu)
  COALESCE(usage_total.requests_total, 0) AS requests_total,
  -- Spotřeba dnes
  COALESCE(usage_today.search_today, 0) AS search_today,
  COALESCE(usage_today.fake_today, 0)   AS fake_today,
  -- Lifetime flag (vip_source IN whitelist nebo lifetime_first_10)
  (p.vip_source IN ('whitelist', 'lifetime_first_10')) AS is_lifetime
FROM profiles p
JOIN auth.users au ON au.id = p.id
LEFT JOIN (
  SELECT user_id,
         SUM(search_count + fake_count) AS requests_7d,
         SUM(search_count) AS search_7d,
         SUM(fake_count)   AS fake_7d
    FROM groq_usage
    WHERE date >= CURRENT_DATE - INTERVAL '7 days'
    GROUP BY user_id
) usage_7d ON usage_7d.user_id = p.id
LEFT JOIN (
  SELECT user_id, SUM(search_count + fake_count) AS requests_total
    FROM groq_usage
    GROUP BY user_id
) usage_total ON usage_total.user_id = p.id
LEFT JOIN (
  SELECT user_id, search_count AS search_today, fake_count AS fake_today
    FROM groq_usage
    WHERE date = CURRENT_DATE
) usage_today ON usage_today.user_id = p.id
WHERE p.vip_until IS NOT NULL AND p.vip_until > NOW();


-- ── HOTOVO ──────────────────────────────────────────────────────────
-- Po spuštění:
--   1. Ověř lifetime counter:    SELECT * FROM lifetime_vip_status;
--   2. Ověř že se RPC načetly:   SELECT proname FROM pg_proc WHERE proname LIKE 'admin_%vip%';
--   3. Test view:                SELECT * FROM admin_vip_overview LIMIT 5;
