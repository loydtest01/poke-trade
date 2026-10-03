-- ═══════════════════════════════════════════════════════════════
--  Oprava bezpečnostních varování – Supabase Security Advisor
--  Supabase → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════

-- ── FIX 1: Security Definer View (public_trade_cards) ─────────
-- Problém: VIEW používá SECURITY DEFINER – přepíše RLS toho kdo view vytvořil
-- Řešení:  Smazat a znovu vytvořit jako SECURITY INVOKER (výchozí pro view)

DROP VIEW IF EXISTS public_trade_cards;

CREATE VIEW public_trade_cards
  WITH (security_invoker = true)   -- dodržuje RLS volajícího uživatele
AS
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
JOIN profiles   p ON p.id = uc.user_id
WHERE uc.for_trade = true OR uc.for_sell = true;

-- Přístup k view pro anonymní i přihlášené uživatele
GRANT SELECT ON public_trade_cards TO anon, authenticated;

-- ── FIX 2: Function Search Path Mutable (upsert_user_cards) ───
-- Problém: Funkce nemá SET search_path – potenciální schema injection
-- Řešení:  Přidat SET search_path = public, pg_temp

CREATE OR REPLACE FUNCTION upsert_user_cards(
  p_user_id UUID,
  p_cards   JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp   -- ← FIX: explicitní search_path
AS $$
DECLARE
  v_card    JSONB;
  v_updated INT := 0;
BEGIN
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
    WHERE user_cards.updated_at <= EXCLUDED.updated_at;

    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object('updated', v_updated);
END;
$$;

-- ── FIX 3: Leaked Password Protection ─────────────────────────
-- Zapne ochranu proti únikům hesel v Supabase Auth
-- Toto se nedá opravit přes SQL – musí se zapnout v dashboardu:
-- Authentication → Settings → Enable leaked password protection ✓
-- (Supabase to kontroluje oproti databázi známých uniklých hesel)

-- ═══════════════════════════════════════════════════════════════
--  ✅ SQL opravy hotovy (FIX 1 + FIX 2).
--  FIX 3: Authentication → Settings → Enable "Leaked password protection"
-- ═══════════════════════════════════════════════════════════════
