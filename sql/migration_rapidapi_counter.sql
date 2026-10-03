-- ════════════════════════════════════════════════════════════════
-- migration_rapidapi_counter.sql
-- Denní limit volání pro RapidAPI Cardmarket free tier (max 99/den)
--
-- SPUSTIT V: Supabase Dashboard → SQL Editor
-- ════════════════════════════════════════════════════════════════

-- ── 1. Tabulka denních counterů ──────────────────────────────
CREATE TABLE IF NOT EXISTS api_usage_counter (
  api_name      text        NOT NULL,             -- 'rapidapi_cardmarket'
  day           date        NOT NULL,             -- den (UTC)
  call_count    integer     NOT NULL DEFAULT 0,   -- počet volání toho dne
  last_call_at  timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  PRIMARY KEY (api_name, day)
);

-- ── 2. Index pro rychlý lookup ────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_api_usage_day
  ON api_usage_counter (day DESC);

-- ── 3. RLS: jen service_role smí měnit ────────────────────────
ALTER TABLE api_usage_counter ENABLE ROW LEVEL SECURITY;

-- Authenticated user smí READ pro debug (zjistit kolik zbývá)
DROP POLICY IF EXISTS "api_usage_read" ON api_usage_counter;
CREATE POLICY "api_usage_read"
  ON api_usage_counter FOR SELECT
  TO authenticated
  USING (true);

-- ── 4. Atomická funkce pro inkrementaci s limitem ──────────
-- Použití (z API endpointu):
--   SELECT increment_api_usage('rapidapi_cardmarket', 99);
-- Vrací:
--   { allowed: true,  count: 5,   limit: 99 }   ← může volat
--   { allowed: false, count: 99,  limit: 99 }   ← limit dosažen
CREATE OR REPLACE FUNCTION increment_api_usage(
  p_api_name text,
  p_limit    integer DEFAULT 99
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_today    date    := (now() AT TIME ZONE 'UTC')::date;
  v_count    integer := 0;
  v_allowed  boolean := false;
BEGIN
  -- Atomický INSERT nebo UPDATE
  INSERT INTO api_usage_counter (api_name, day, call_count, last_call_at, updated_at)
  VALUES (p_api_name, v_today, 1, now(), now())
  ON CONFLICT (api_name, day)
  DO UPDATE SET
    call_count   = CASE
      WHEN api_usage_counter.call_count < p_limit
        THEN api_usage_counter.call_count + 1
        ELSE api_usage_counter.call_count   -- nepřekročit limit
      END,
    last_call_at = CASE
      WHEN api_usage_counter.call_count < p_limit
        THEN now()
        ELSE api_usage_counter.last_call_at
      END,
    updated_at   = now()
  RETURNING call_count INTO v_count;

  v_allowed := v_count <= p_limit;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'count',   v_count,
    'limit',   p_limit,
    'day',     v_today
  );
END;
$$;

-- Kdokoliv smí číst counter (pro UI ukazatel "zbývá X volání")
GRANT EXECUTE ON FUNCTION increment_api_usage(text, integer) TO authenticated, anon;

-- ── 5. Helper view: dnešní stav ──────────────────────────────
CREATE OR REPLACE VIEW api_usage_today AS
  SELECT
    api_name,
    call_count,
    last_call_at,
    -- Pomocný sloupec: kolik zbývá z 99 (free tier)
    GREATEST(0, 99 - call_count) AS remaining
  FROM api_usage_counter
  WHERE day = (now() AT TIME ZONE 'UTC')::date;

-- ════════════════════════════════════════════════════════════════
-- Hotovo. Ověř:
--   SELECT increment_api_usage('rapidapi_cardmarket', 99);
--   SELECT * FROM api_usage_today;
-- ════════════════════════════════════════════════════════════════
