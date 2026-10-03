-- ============================================================
-- MIGRACE: Systém poptávek (Demands)
-- PokéTrade – marketplace.html
-- ============================================================

-- ── Tabulka poptávek ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS demands (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  username        TEXT NOT NULL,

  -- Karta
  card_name       TEXT NOT NULL,
  card_set        TEXT,
  card_number     TEXT,
  card_type       TEXT,
  card_rarity     TEXT,
  api_image_url   TEXT,
  cards_data      JSONB,          -- celý objekt z pokemontcg.io

  -- Podmínky poptávky
  max_price_czk   INTEGER,        -- maximum, co chce zaplatit (NULL = dohodou)
  min_condition   TEXT DEFAULT 'NM',  -- NM | LP | MP | HP
  accept_trade    BOOLEAN DEFAULT false,
  notes           TEXT,

  -- Status
  status          TEXT DEFAULT 'active' CHECK (status IN ('active','closed','deleted')),
  response_count  INTEGER DEFAULT 0,

  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ── Tabulka odpovědí na poptávku ──────────────────────────────
CREATE TABLE IF NOT EXISTS demand_responses (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  demand_id       UUID NOT NULL REFERENCES demands(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  username        TEXT NOT NULL,

  -- Volitelné propojení s existující nabídkou
  listing_id      UUID REFERENCES listings(id) ON DELETE SET NULL,

  -- Nabídka
  price_czk       INTEGER,
  card_condition  TEXT,
  message         TEXT,
  api_image_url   TEXT,

  -- Status
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','cancelled')),

  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ── Indexy ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_demands_status       ON demands(status);
CREATE INDEX IF NOT EXISTS idx_demands_user_id      ON demands(user_id);
CREATE INDEX IF NOT EXISTS idx_demands_created_at   ON demands(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_demand_responses_demand ON demand_responses(demand_id);
CREATE INDEX IF NOT EXISTS idx_demand_responses_user   ON demand_responses(user_id);

-- ── RLS (Row Level Security) ──────────────────────────────────
ALTER TABLE demands          ENABLE ROW LEVEL SECURITY;
ALTER TABLE demand_responses ENABLE ROW LEVEL SECURITY;

-- demands: číst může kdokoli, vkládat/mazat jen vlastník
CREATE POLICY demands_select  ON demands FOR SELECT USING (true);
CREATE POLICY demands_insert  ON demands FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY demands_update  ON demands FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY demands_delete  ON demands FOR DELETE USING (auth.uid() = user_id);

-- demand_responses: číst může vlastník poptávky i odpovídající
CREATE POLICY dr_select ON demand_responses FOR SELECT
  USING (
    auth.uid() = user_id
    OR auth.uid() = (SELECT user_id FROM demands WHERE id = demand_id)
  );
CREATE POLICY dr_insert ON demand_responses FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY dr_update ON demand_responses FOR UPDATE
  USING (
    auth.uid() = user_id
    OR auth.uid() = (SELECT user_id FROM demands WHERE id = demand_id)
  );

-- ── Trigger: automaticky aktualizovat response_count ────────
CREATE OR REPLACE FUNCTION increment_demand_response_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE demands
  SET response_count = response_count + 1,
      updated_at     = now()
  WHERE id = NEW.demand_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_demand_response_count ON demand_responses;
CREATE TRIGGER trg_demand_response_count
  AFTER INSERT ON demand_responses
  FOR EACH ROW EXECUTE FUNCTION increment_demand_response_count();

-- ── Trigger: updated_at ──────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_demands_updated_at ON demands;
CREATE TRIGGER trg_demands_updated_at
  BEFORE UPDATE ON demands
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
