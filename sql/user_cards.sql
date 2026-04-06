-- ═══════════════════════════════════════════════════════════════
--  PŘIDEJ DO SUPABASE: user_cards tabulka + RPC funkce
--  Supabase → SQL Editor → New Query → spusť celý tento soubor
-- ═══════════════════════════════════════════════════════════════

-- ── 6. ALBUM KARET (synchronizace app ↔ web) ─────────────────
-- Každý řádek = 1 karta v albu uživatele
-- Primární klíč: (user_id, local_id) – local_id je ID z lokálního úložiště

CREATE TABLE IF NOT EXISTS user_cards (
  id          BIGSERIAL,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  local_id    TEXT        NOT NULL,            -- ID karty z app (localStorage)
  card_data   JSONB       NOT NULL DEFAULT '{}', -- name, set, number, type, images, …
  for_trade   BOOLEAN     NOT NULL DEFAULT false,
  for_sell    BOOLEAN     NOT NULL DEFAULT false,
  price_czk   INT,                             -- cena v Kč (jen pokud for_sell=true)
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (user_id, local_id)
);

-- Indexy pro rychlé dotazy
CREATE INDEX IF NOT EXISTS user_cards_user_id_idx     ON user_cards(user_id);
CREATE INDEX IF NOT EXISTS user_cards_for_trade_idx   ON user_cards(for_trade) WHERE for_trade = true;
CREATE INDEX IF NOT EXISTS user_cards_for_sell_idx    ON user_cards(for_sell)  WHERE for_sell  = true;
CREATE INDEX IF NOT EXISTS user_cards_updated_at_idx  ON user_cards(updated_at DESC);

-- ── RLS (Row Level Security) ──────────────────────────────────
ALTER TABLE user_cards ENABLE ROW LEVEL SECURITY;

-- Každý uživatel vidí svůj vlastní album
CREATE POLICY "Uživatel vidí vlastní album" ON user_cards
  FOR SELECT USING (auth.uid() = user_id);

-- Ostatní vidí jen karty označené k výměně nebo prodeji
-- (pro web tržiště / album jiného uživatele)
CREATE POLICY "K výměně/prodeji vidí všichni" ON user_cards
  FOR SELECT USING (for_trade = true OR for_sell = true);

-- INSERT: jen vlastní karty
CREATE POLICY "Uživatel vkládá vlastní karty" ON user_cards
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- UPDATE: jen vlastní karty
CREATE POLICY "Uživatel upravuje vlastní karty" ON user_cards
  FOR UPDATE USING (auth.uid() = user_id);

-- DELETE: jen vlastní karty
CREATE POLICY "Uživatel maže vlastní karty" ON user_cards
  FOR DELETE USING (auth.uid() = user_id);

-- ── RPC funkce: hromadný upsert karet (batch sync z app) ─────
-- Volá album-sync.js metodou POST /rpc/upsert_user_cards
-- p_user_id: UUID přihlášeného uživatele
-- p_cards:   pole objektů { local_id, for_trade, for_sell, price_czk, card_data, updated_at }

CREATE OR REPLACE FUNCTION upsert_user_cards(
  p_user_id UUID,
  p_cards   JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER   -- běží s právy vlastníka funkce, obchází RLS pro zápis
AS $$
DECLARE
  v_card    JSONB;
  v_updated INT := 0;
BEGIN
  -- Ověř, že volající je skutečně p_user_id
  IF auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Neautorizovaný přístup';
  END IF;

  FOR v_card IN SELECT * FROM jsonb_array_elements(p_cards)
  LOOP
    INSERT INTO user_cards (
      user_id, local_id, for_trade, for_sell, price_czk, card_data, updated_at
    ) VALUES (
      p_user_id,
      v_card->>'local_id',
      COALESCE((v_card->>'for_trade')::boolean, false),
      COALESCE((v_card->>'for_sell')::boolean,  false),
      (v_card->>'price_czk')::int,
      COALESCE(v_card->'card_data', '{}'::jsonb),
      COALESCE((v_card->>'updated_at')::timestamptz, NOW())
    )
    ON CONFLICT (user_id, local_id) DO UPDATE SET
      for_trade  = EXCLUDED.for_trade,
      for_sell   = EXCLUDED.for_sell,
      price_czk  = EXCLUDED.price_czk,
      card_data  = EXCLUDED.card_data,
      updated_at = EXCLUDED.updated_at
    -- Aktualizuj jen pokud server data jsou novější nebo stejně stará
    WHERE user_cards.updated_at <= EXCLUDED.updated_at;

    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object('updated', v_updated);
END;
$$;

-- ── VIEW: veřejné album (pro webové tržiště) ──────────────────
-- Vrátí karty k výměně/prodeji s username uživatele
CREATE OR REPLACE VIEW public_trade_cards AS
SELECT
  uc.user_id,
  p.username,
  p.avatar_url,
  uc.local_id,
  uc.card_data,
  uc.for_trade,
  uc.for_sell,
  uc.price_czk,
  uc.updated_at
FROM user_cards uc
JOIN profiles   p  ON p.id = uc.user_id
WHERE uc.for_trade = true OR uc.for_sell = true;

-- Přístup k view pro anonymní uživatele
GRANT SELECT ON public_trade_cards TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════
--  ✅ HOTOVO! Tabulka user_cards je připravena.
--
--  Dále:
--  1. Zkontroluj v Table Editor že tabulka existuje
--  2. V app/js/main.js přidej:
--       import { initTradeUI } from './trade-ui.js';
--       initTradeUI(); // volat po inicializaci alba
--  3. Zkopíruj trade-ui.js do app/js/
-- ═══════════════════════════════════════════════════════════════
