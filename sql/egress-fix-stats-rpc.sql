-- ══════════════════════════════════════════════════════
-- OPTIMALIZACE EGRESS: RPC funkce pro homepage stats
-- Spusť v Supabase SQL Editoru
-- ══════════════════════════════════════════════════════
-- 
-- Problém: app.js stahoval VŠECHNY card_data pro VŠECHNY uživatele
-- při každém načtení homepage → obrovský PostgREST egress
--
-- Řešení: Tato funkce vrátí jen 3 čísla (pár bytů) místo MB dat
-- ══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_homepage_stats()
RETURNS JSON
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'total_cards',  COALESCE(
                      (SELECT SUM(
                        COALESCE(
                          (card_data->>'count')::int,
                          (card_data->>'qty')::int,
                          1
                        )
                      ) FROM user_cards),
                      0
                    ),
    'total_users',  COALESCE((SELECT COUNT(*) FROM profiles), 0),
    'total_trades', COALESCE((SELECT COUNT(*) FROM offers WHERE status = 'accepted'), 0)
  );
$$;

-- Povol anonymní přístup (homepage stats jsou veřejné)
GRANT EXECUTE ON FUNCTION get_homepage_stats() TO anon;
GRANT EXECUTE ON FUNCTION get_homepage_stats() TO authenticated;

-- Test:
-- SELECT get_homepage_stats();
