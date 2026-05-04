-- ════════════════════════════════════════════════════════════════════
-- VIP + REFERRAL + ADMIN SYSTEM — PokéTrade
-- Spustit v Supabase SQL Editoru jako celý blok.
-- Bezpečné spustit opakovaně (idempotent migrace).
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Rozšíření profiles tabulky ───────────────────────────────────
-- Přidává VIP status, referral tracking a fraud signals.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS vip_until         TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS vip_source        TEXT DEFAULT NULL,        -- 'first_100', 'referral', 'manual', 'extended'
  ADD COLUMN IF NOT EXISTS referral_code     TEXT UNIQUE,              -- vlastní kód uživatele (např. 'loyd-a3f9')
  ADD COLUMN IF NOT EXISTS referred_by       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referrals_count   INTEGER DEFAULT 0,        -- kolik lidí ho doporučilo (denormalizace pro rychlost)
  ADD COLUMN IF NOT EXISTS browser_fp        TEXT,                     -- browser fingerprint (anti-abuse, ne IP — GDPR friendly)
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ,              -- kdy uživatel klikl na verifikační email
  ADD COLUMN IF NOT EXISTS first_card_at     TIMESTAMPTZ,              -- první nahraná karta (=aktivace)
  ADD COLUMN IF NOT EXISTS suspicious_score  INTEGER DEFAULT 0;        -- 0-100, počítá auto-detection (admin panel)

-- Index pro rychlé hledání podle referral kódu
CREATE INDEX IF NOT EXISTS idx_profiles_referral_code ON profiles(referral_code) WHERE referral_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_referred_by   ON profiles(referred_by) WHERE referred_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_browser_fp    ON profiles(browser_fp) WHERE browser_fp IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_vip_until     ON profiles(vip_until) WHERE vip_until IS NOT NULL;


-- ── 2. Counter prvních 100 uživatelů ────────────────────────────────
-- Globální counter — kolik lidí už dostalo "first 100" VIP. Když dosáhne 100,
-- nový uživatel dostane jen 14 dní (nebo nic — viz politika níže).

CREATE TABLE IF NOT EXISTS app_counters (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO app_counters (key, value)
  VALUES ('first_100_vip_granted', 0)
  ON CONFLICT (key) DO NOTHING;

-- RLS — jen čtení pro authenticated, zápis přes RPC funkci
ALTER TABLE app_counters ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE policyname = 'Counters – kdokoliv čte' AND tablename = 'app_counters') THEN
    CREATE POLICY "Counters – kdokoliv čte" ON app_counters FOR SELECT USING (true);
  END IF;
END $$;


-- ── 3. Referral tracking tabulka ────────────────────────────────────
-- Audit log pro každý referral event (pro admin panel + anti-fraud).

CREATE TABLE IF NOT EXISTS referral_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  referee_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'qualified', 'rewarded', 'rejected'
  reject_reason   TEXT,                              -- 'same_fingerprint', 'no_email_verify', 'no_5_cards', 'self_referral'
  referee_fp      TEXT,                              -- fingerprint nového uživatele (snapshot v době eventu)
  referrer_fp     TEXT,                              -- fingerprint doporučitele (snapshot)
  cards_uploaded  INTEGER DEFAULT 0,                 -- kolik karet referee nahrál (pro qualification check)
  qualified_at    TIMESTAMPTZ,                       -- kdy splnil podmínky
  rewarded_at     TIMESTAMPTZ,                       -- kdy byl udělen reward (+30 dní VIP referrerovi)
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (referrer_id, referee_id)
);

CREATE INDEX IF NOT EXISTS idx_referral_events_referrer ON referral_events(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referral_events_referee  ON referral_events(referee_id);
CREATE INDEX IF NOT EXISTS idx_referral_events_status   ON referral_events(status);

ALTER TABLE referral_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  -- Referrer/referee mohou číst své eventy
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE policyname = 'Referral – účastník čte' AND tablename = 'referral_events') THEN
    CREATE POLICY "Referral – účastník čte" ON referral_events FOR SELECT
      USING (auth.uid() = referrer_id OR auth.uid() = referee_id);
  END IF;
  -- Insert jen přes RPC (bezpečnostní vrstva — anti-fraud kontroly)
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE policyname = 'Referral – jen RPC zapisuje' AND tablename = 'referral_events') THEN
    CREATE POLICY "Referral – jen RPC zapisuje" ON referral_events FOR INSERT
      WITH CHECK (false);  -- klient nemůže zapsat přímo, jen přes SECURITY DEFINER funkci
  END IF;
END $$;


-- ── 4. Suspicious activity log (pro admin panel) ────────────────────
-- Loguje podezřelé eventy které admin (Loyd) může prohlížet.

CREATE TABLE IF NOT EXISTS suspicious_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES profiles(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,         -- 'duplicate_fingerprint', 'mass_referral', 'rapid_signups', 'rejected_referral', 'ban_evasion'
  severity    TEXT NOT NULL DEFAULT 'low',  -- 'low', 'medium', 'high'
  details     JSONB DEFAULT '{}'::jsonb,    -- volný JSON s detaily eventu
  reviewed    BOOLEAN DEFAULT false,         -- admin si event prohlédl
  reviewed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suspicious_user_id     ON suspicious_events(user_id);
CREATE INDEX IF NOT EXISTS idx_suspicious_severity    ON suspicious_events(severity);
CREATE INDEX IF NOT EXISTS idx_suspicious_unreviewed  ON suspicious_events(reviewed, created_at DESC) WHERE reviewed = false;

ALTER TABLE suspicious_events ENABLE ROW LEVEL SECURITY;

-- Tahle tabulka MÁ smysl jen pro Loyda — RLS zakazuje všem.
-- Loyd k ní přistupuje přes admin panel s service_role klíčem (přes /api).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE policyname = 'Suspicious – nikdo nečte' AND tablename = 'suspicious_events') THEN
    CREATE POLICY "Suspicious – nikdo nečte" ON suspicious_events FOR SELECT USING (false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE policyname = 'Suspicious – nikdo nezapisuje' AND tablename = 'suspicious_events') THEN
    CREATE POLICY "Suspicious – nikdo nezapisuje" ON suspicious_events FOR INSERT WITH CHECK (false);
  END IF;
END $$;


-- ── 5. RPC: Generuj referral kód při registraci ─────────────────────
-- Volá se z handleru po registraci. Vytvoří unikátní kód typu 'username-a3f9'.

CREATE OR REPLACE FUNCTION generate_referral_code(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username TEXT;
  v_suffix   TEXT;
  v_code     TEXT;
  v_attempts INTEGER := 0;
BEGIN
  -- Najdi username, sanitize na alphanum (max 12 znaků)
  SELECT regexp_replace(LOWER(username), '[^a-z0-9]', '', 'g')
    INTO v_username
    FROM profiles WHERE id = p_user_id;

  v_username := SUBSTRING(COALESCE(v_username, 'user'), 1, 12);
  IF v_username = '' THEN v_username := 'user'; END IF;

  -- Generuj suffix dokud není unikátní (max 5 pokusů)
  LOOP
    v_attempts := v_attempts + 1;
    v_suffix := SUBSTRING(MD5(random()::text || clock_timestamp()::text), 1, 4);
    v_code := v_username || '-' || v_suffix;

    IF NOT EXISTS (SELECT 1 FROM profiles WHERE referral_code = v_code) THEN
      UPDATE profiles SET referral_code = v_code WHERE id = p_user_id;
      RETURN v_code;
    END IF;

    IF v_attempts >= 5 THEN
      -- Failsafe: použij jen UUID prefix
      v_code := 'u-' || SUBSTRING(REPLACE(p_user_id::text, '-', ''), 1, 8);
      UPDATE profiles SET referral_code = v_code WHERE id = p_user_id;
      RETURN v_code;
    END IF;
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION generate_referral_code(UUID) TO authenticated;


-- ── 6. RPC: Apply welcome VIP (volá se při první návštěvě po registraci) ──
-- Logika:
--   - Pokud user přišel přes referral kód → uloží referred_by, vytvoří referral event
--   - Zkontroluje counter "first_100":
--     - Pokud < 100 → uděleno 30 dní VIP (vip_source = 'first_100')
--     - Pokud >= 100 → uděleno 14 dní VIP (vip_source = 'standard')
--   - Anti-abuse: pokud browser_fp už existuje u jiného non-banned účtu, VIP NEUDĚLEN
--     a vytvoří se suspicious_event 'duplicate_fingerprint'

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
  v_existing        RECORD;
  v_referrer_id     UUID;
  v_already_claimed BOOLEAN;
  v_dup_fp_count    INTEGER;
BEGIN
  -- Bezpečnost: jen owner může claimovat (NESMÍ jít volat za cizího uživatele)
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RETURN jsonb_build_object('success', false, 'reason', 'unauthorized');
  END IF;

  -- Už claimnul? (vip_until vyplněno → druhé volání ignoruj)
  SELECT vip_until IS NOT NULL INTO v_already_claimed FROM profiles WHERE id = p_user_id;
  IF v_already_claimed THEN
    RETURN jsonb_build_object('success', false, 'reason', 'already_claimed');
  END IF;

  -- Anti-abuse: stejný fingerprint u JINÉHO non-banned účtu
  -- → VIP neudělíme + log do suspicious_events (jen pokud fp je smysluplný — > 16 znaků)
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
      -- Ulož fingerprint na uživatele i tak (pro budoucí detection), ale VIP neudělíme
      UPDATE profiles SET browser_fp = p_browser_fp, suspicious_score = COALESCE(suspicious_score, 0) + 50
        WHERE id = p_user_id;
      RETURN jsonb_build_object('success', false, 'reason', 'duplicate_fingerprint');
    END IF;
  END IF;

  -- Najdi referrera (pokud kód je platný a není to self-referral)
  IF p_referral_code IS NOT NULL AND p_referral_code <> '' THEN
    SELECT id INTO v_referrer_id FROM profiles
      WHERE referral_code = p_referral_code AND id <> p_user_id;

    IF v_referrer_id IS NOT NULL THEN
      -- Vytvoř referral event (status='pending', čeká na qualification)
      INSERT INTO referral_events (referrer_id, referee_id, status, referee_fp)
        VALUES (v_referrer_id, p_user_id, 'pending', p_browser_fp)
        ON CONFLICT (referrer_id, referee_id) DO NOTHING;
    END IF;
  END IF;

  -- Counter check
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

  -- Aplikuj VIP + ulož fingerprint + referral
  UPDATE profiles
    SET vip_until    = NOW() + (v_vip_days || ' days')::interval,
        vip_source   = v_vip_source,
        browser_fp   = COALESCE(p_browser_fp, browser_fp),
        referred_by  = COALESCE(referred_by, v_referrer_id)
    WHERE id = p_user_id;

  -- Vygeneruj referral kód pokud ještě nemá
  PERFORM generate_referral_code(p_user_id) FROM profiles
    WHERE id = p_user_id AND referral_code IS NULL;

  RETURN jsonb_build_object(
    'success',     true,
    'vip_days',    v_vip_days,
    'vip_source',  v_vip_source,
    'first_100',   v_vip_source = 'first_100',
    'referrer_id', v_referrer_id
  );
END $$;

GRANT EXECUTE ON FUNCTION claim_welcome_vip(UUID, TEXT, TEXT) TO authenticated;


-- ── 7. RPC: Qualify referral (volá se po každém uploadu karty) ──────
-- Když referee nahraje 5+ karet, jeho referral event se přepne na 'qualified'
-- a referrerovi se přidá +30 dní VIP.

CREATE OR REPLACE FUNCTION qualify_referrals_for_user(p_user_id UUID, p_card_count INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event       RECORD;
  v_email_ok    BOOLEAN;
  v_age_ok      BOOLEAN;
  v_qualified   INTEGER := 0;
BEGIN
  -- Najdi pending referral event pro tohoto referee
  SELECT * INTO v_event FROM referral_events
    WHERE referee_id = p_user_id AND status = 'pending'
    LIMIT 1;

  IF v_event IS NULL THEN
    RETURN jsonb_build_object('qualified', 0, 'reason', 'no_pending_referral');
  END IF;

  -- Podmínky:
  --   1. Email musí být verified (auth.users.email_confirmed_at NOT NULL)
  --   2. Účet starý alespoň 24h (cooldown proti instant fake účtům)
  --   3. Aspoň 5 karet nahráno (p_card_count >= 5)
  IF p_card_count < 5 THEN
    RETURN jsonb_build_object('qualified', 0, 'reason', 'not_enough_cards', 'have', p_card_count, 'need', 5);
  END IF;

  SELECT email_confirmed_at IS NOT NULL INTO v_email_ok
    FROM auth.users WHERE id = p_user_id;
  IF NOT v_email_ok THEN
    RETURN jsonb_build_object('qualified', 0, 'reason', 'email_not_verified');
  END IF;

  SELECT (NOW() - created_at) > INTERVAL '24 hours' INTO v_age_ok
    FROM profiles WHERE id = p_user_id;
  IF NOT v_age_ok THEN
    RETURN jsonb_build_object('qualified', 0, 'reason', 'account_too_young');
  END IF;

  -- VŠECHNY PODMÍNKY OK → kvalifikuj a odměň referrera
  UPDATE referral_events
    SET status = 'rewarded',
        cards_uploaded = p_card_count,
        qualified_at = NOW(),
        rewarded_at = NOW()
    WHERE id = v_event.id;

  -- Přidej referrerovi +30 dní VIP (nastav vip_until na max(NOW, current_until) + 30 days)
  UPDATE profiles
    SET vip_until = GREATEST(COALESCE(vip_until, NOW()), NOW()) + INTERVAL '30 days',
        vip_source = 'extended',
        referrals_count = COALESCE(referrals_count, 0) + 1
    WHERE id = v_event.referrer_id;

  v_qualified := 1;

  RETURN jsonb_build_object('qualified', v_qualified, 'referrer_id', v_event.referrer_id);
END $$;

GRANT EXECUTE ON FUNCTION qualify_referrals_for_user(UUID, INTEGER) TO authenticated;


-- ── 8. View: First 100 stav (pro index lákadlo) ─────────────────────
-- Veřejná view co vrací kolik míst zbývá z prvních 100. RLS allows.

CREATE OR REPLACE VIEW first_100_status AS
SELECT
  value AS granted,
  GREATEST(100 - value, 0) AS remaining,
  100 AS total,
  (value < 100) AS available
FROM app_counters
WHERE key = 'first_100_vip_granted';

GRANT SELECT ON first_100_status TO anon, authenticated;


-- ── 9. Helper: is_vip(user_id) — používá se v RLS politikách ────────
CREATE OR REPLACE FUNCTION is_vip(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(vip_until > NOW(), false) FROM profiles WHERE id = p_user_id;
$$;

GRANT EXECUTE ON FUNCTION is_vip(UUID) TO authenticated, anon;


-- ── HOTOVO ──────────────────────────────────────────────────────────
-- Po spuštění:
--   1. Ověř `SELECT * FROM first_100_status;` → měl bys vidět granted=0, remaining=100
--   2. Ověř že existuje referral_code v profiles: `SELECT count(*) FROM profiles WHERE referral_code IS NOT NULL;`
--      (zatím 0 protože staří uživatelé ho nemají — vygenerují si ho při příštím přihlášení přes claim_welcome_vip)
--   3. Pro stávající uživatele ho můžeš vygenerovat hromadně:
--      DO $$ DECLARE u RECORD; BEGIN
--        FOR u IN SELECT id FROM profiles WHERE referral_code IS NULL LOOP
--          PERFORM generate_referral_code(u.id);
--        END LOOP;
--      END $$;
