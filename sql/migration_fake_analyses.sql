-- ════════════════════════════════════════════════════════════════
-- PokéTrade – Fake Detector: sdílená databáze analýz
-- Verze: 1.0
-- ════════════════════════════════════════════════════════════════
-- Tato tabulka ukládá VŠECHNY analýzy od všech uživatelů.
-- Čím víc analýz, tím přesnější budou budoucí výsledky.
-- ════════════════════════════════════════════════════════════════

-- ── Tabulka analýz ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fake_analyses (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Identifikace karty
  card_api_id      TEXT,                    -- pokemontcg.io ID (sv4-84, swsh1-1, …)
  card_name        TEXT NOT NULL DEFAULT '',
  card_set         TEXT DEFAULT '',
  card_number      TEXT DEFAULT '',
  card_rarity      TEXT DEFAULT '',
  -- Výsledek analýzy
  verdict          TEXT NOT NULL CHECK (verdict IN ('real','fake','suspicious','unknown')),
  score            INT  NOT NULL CHECK (score BETWEEN 0 AND 100),
  confidence       TEXT CHECK (confidence IN ('high','med','low')),
  flags            JSONB DEFAULT '[]'::jsonb,
  summary          TEXT DEFAULT '',
  comparison_notes TEXT DEFAULT '',
  -- Metadata
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- ── Indexy pro rychlé vyhledávání ────────────────────────────
CREATE INDEX IF NOT EXISTS idx_fake_card_api_id ON fake_analyses(card_api_id) WHERE card_api_id IS NOT NULL AND card_api_id != '';
CREATE INDEX IF NOT EXISTS idx_fake_card_name   ON fake_analyses(card_name, card_set);
CREATE INDEX IF NOT EXISTS idx_fake_created     ON fake_analyses(created_at DESC);

-- ── RLS: všichni čtou, přihlášení zapisují ───────────────────
ALTER TABLE fake_analyses ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Analýzy falzifikátů jsou veřejné' AND tablename='fake_analyses') THEN
    CREATE POLICY "Analýzy falzifikátů jsou veřejné"
      ON fake_analyses FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='Přihlášený uživatel může přidat analýzu' AND tablename='fake_analyses') THEN
    CREATE POLICY "Přihlášený uživatel může přidat analýzu"
      ON fake_analyses FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;


-- ── RPC: agregované statistiky pro konkrétní kartu ───────────
-- Vrátí JSON s počtem analýz, průměrným skóre, rozložením verdiktů
-- a nejčastějšími flagy od komunity.
-- Volání: SELECT get_fake_stats('sv4-84');
--    nebo: SELECT get_fake_stats(NULL, 'Charizard ex', 'Paldean Fates');

CREATE OR REPLACE FUNCTION get_fake_stats(
  p_api_id   TEXT DEFAULT NULL,
  p_name     TEXT DEFAULT NULL,
  p_set      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  WITH matched AS (
    SELECT *
    FROM fake_analyses
    WHERE
      (p_api_id IS NOT NULL AND p_api_id != '' AND card_api_id = p_api_id)
      OR
      (p_name IS NOT NULL AND p_name != '' AND lower(card_name) = lower(p_name)
       AND (p_set IS NULL OR p_set = '' OR lower(card_set) = lower(p_set)))
  ),
  stats AS (
    SELECT
      count(*)::int AS total,
      ROUND(AVG(score))::int AS avg_score,
      count(*) FILTER (WHERE verdict = 'real')::int AS v_real,
      count(*) FILTER (WHERE verdict = 'fake')::int AS v_fake,
      count(*) FILTER (WHERE verdict = 'suspicious')::int AS v_suspicious,
      count(*) FILTER (WHERE verdict = 'unknown')::int AS v_unknown
    FROM matched
  ),
  top_flags AS (
    SELECT jsonb_agg(sub.flag_obj ORDER BY sub.cnt DESC) AS flags
    FROM (
      SELECT
        jsonb_build_object(
          'label', f->>'label',
          'severity', f->>'severity',
          'count', count(*)::int
        ) AS flag_obj,
        count(*) AS cnt
      FROM matched, jsonb_array_elements(flags) AS f
      GROUP BY f->>'label', f->>'severity'
      ORDER BY count(*) DESC
      LIMIT 12
    ) sub
  ),
  recent_summaries AS (
    SELECT jsonb_agg(sub.s) AS summaries
    FROM (
      SELECT summary AS s
      FROM matched
      WHERE summary IS NOT NULL AND summary != ''
      ORDER BY created_at DESC
      LIMIT 5
    ) sub
  )
  SELECT jsonb_build_object(
    'total',    COALESCE(s.total, 0),
    'avg_score', COALESCE(s.avg_score, 0),
    'verdicts', jsonb_build_object(
      'real',       COALESCE(s.v_real, 0),
      'fake',       COALESCE(s.v_fake, 0),
      'suspicious', COALESCE(s.v_suspicious, 0),
      'unknown',    COALESCE(s.v_unknown, 0)
    ),
    'common_flags',     COALESCE(tf.flags, '[]'::jsonb),
    'recent_summaries', COALESCE(rs.summaries, '[]'::jsonb)
  ) INTO result
  FROM stats s
  CROSS JOIN top_flags tf
  CROSS JOIN recent_summaries rs;

  RETURN COALESCE(result, '{}'::jsonb);
END;
$$;
