-- ══════════════════════════════════════════════════════
-- HOMEPAGE STATS RPC — vrátí 4 čísla pro hero sekci
-- Spusť v Supabase SQL Editoru (Pokemon Cards projekt)
-- ══════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_homepage_stats()
RETURNS JSON
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    -- Celkový počet karet ve všech albech (sečteme qty/count z card_data)
    'total_cards',    COALESCE(
                        (SELECT SUM(
                          COALESCE(
                            (card_data->>'count')::int,
                            (card_data->>'qty')::int,
                            1
                          )
                        ) FROM user_cards),
                        0
                      ),
    -- Registrovaní sběratelé
    'total_users',    COALESCE((SELECT COUNT(*) FROM profiles), 0),
    -- Dokončené výměny
    'total_trades',   COALESCE((SELECT COUNT(*) FROM offers WHERE status = 'accepted'), 0)
  );
$$;

-- Povol anonymní přístup (homepage je veřejná)
GRANT EXECUTE ON FUNCTION get_homepage_stats() TO anon;
GRANT EXECUTE ON FUNCTION get_homepage_stats() TO authenticated;

-- Test — měl by vrátit JSON s total_cards, total_users, total_trades:
-- SELECT get_homepage_stats();
