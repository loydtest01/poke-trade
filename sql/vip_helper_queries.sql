-- ════════════════════════════════════════════════════════════════════
-- VIP Management Helper Queries
-- Užitečné pro Loyda, můžeš si je uložit jako bookmark v Supabase SQL Editoru
-- ════════════════════════════════════════════════════════════════════

-- ── 1. Přehled VIP situace ─────────────────────────────────────────
-- Kolik máš v každé kategorii?
SELECT
  vip_source,
  COUNT(*) AS pocet_uctu,
  COUNT(*) FILTER (WHERE vip_until > NOW()) AS aktivni
FROM profiles
WHERE vip_until IS NOT NULL
GROUP BY vip_source
ORDER BY pocet_uctu DESC;

-- Očekávaný výstup např.:
-- whitelist           | 7 | 7    (Loyd, rodina, beta-testeři — lifetime)
-- lifetime_first_20   | X | X    (prvních 20 reálných uživatelů)
-- first_100           | X | X    (uživatelé 21-120 — 30 dní)
-- standard            | X | X    (uživatelé 121+ — 14 dní)
-- extended            | X | X    (kdokoliv s referrals)


-- ── 2. Lifetime sloty status ───────────────────────────────────────
SELECT * FROM lifetime_vip_status;
SELECT * FROM first_100_status;


-- ── 3. Top 10 nejaktivnějších VIP (kandidáti na lifetime upgrade) ──
SELECT
  username, email, vip_source,
  vip_until::date AS expiruje,
  requests_7d AS pos7d,
  requests_total AS celkem,
  referrals_count AS doporucil
FROM admin_vip_overview
ORDER BY requests_7d DESC NULLS LAST
LIMIT 10;


-- ── 4. Manuálně udělit lifetime VIP konkrétnímu uživateli ──────────
-- Nahraď email tím správným:
SELECT admin_grant_vip_by_email('user@example.com', -1, 'manual_lifetime_promotion');

-- Nebo skrz user_id pokud znáš:
-- SELECT admin_grant_vip('00000000-0000-0000-0000-000000000000'::uuid, -1, 'manual_lifetime');


-- ── 5. Hromadně upgradnout TOP 5 aktivních userů na lifetime ───────
-- POZOR: použij JEN pokud opravdu chceš odměnit nejaktivnější
DO $$
DECLARE
  u RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR u IN
    SELECT id, email FROM admin_vip_overview
    WHERE NOT is_lifetime
    ORDER BY requests_7d DESC NULLS LAST
    LIMIT 5
  LOOP
    UPDATE profiles SET
      vip_until = '9999-12-31'::timestamptz,
      vip_source = 'lifetime_first_20'
    WHERE id = u.id;
    v_count := v_count + 1;
    RAISE NOTICE 'Upgraded: %', u.email;
  END LOOP;
  -- Zvedni counter podle počtu upgradnutých
  UPDATE app_counters SET value = value + v_count
    WHERE key = 'lifetime_vip_granted';
END $$;


-- ── 6. Zjistit kdo má duplicitní fingerprint (potenciální abuse) ───
SELECT
  p.username, p.email, p.created_at::date AS registrace,
  p.vip_source, p.is_banned,
  fp_dupes.dup_count AS pocet_uctu_se_stejn_fp
FROM profiles p
JOIN (
  SELECT browser_fp, COUNT(*) AS dup_count
  FROM profiles
  WHERE browser_fp IS NOT NULL AND LENGTH(browser_fp) > 16
  GROUP BY browser_fp
  HAVING COUNT(*) > 1
) fp_dupes ON fp_dupes.browser_fp = p.browser_fp
ORDER BY fp_dupes.dup_count DESC, p.created_at DESC;


-- ── 7. Reset counterů (např. pro test, NEPOUŽÍVAT v produkci) ──────
-- UPDATE app_counters SET value = 0 WHERE key = 'lifetime_vip_granted';
-- UPDATE app_counters SET value = 0 WHERE key = 'first_100_vip_granted';


-- ── 8. Backfill: existující VIP účty bez referral kódu ─────────────
DO $$
DECLARE u RECORD;
BEGIN
  FOR u IN SELECT id FROM profiles WHERE referral_code IS NULL LOOP
    PERFORM generate_referral_code(u.id);
  END LOOP;
END $$;


-- ── 9. Audit log: poslední admin akce (granty/revoke) ──────────────
SELECT
  e.created_at,
  e.event_type,
  p.username AS dotcen_uzivatel,
  p.email   AS email_dotcenehoo,
  e.details
FROM suspicious_events e
LEFT JOIN profiles p ON p.id = e.user_id
WHERE e.event_type IN ('admin_vip_grant', 'admin_vip_revoke')
ORDER BY e.created_at DESC
LIMIT 20;


-- ── 10. AI spotřeba TOP 20 userů za posledních 7 dní ───────────────
SELECT
  p.username, p.email, p.vip_source,
  SUM(g.search_count) AS searches,
  SUM(g.fake_count)   AS fake_checks,
  SUM(g.search_count + g.fake_count) AS celkem
FROM groq_usage g
JOIN profiles p ON p.id = g.user_id
WHERE g.date >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY p.id, p.username, p.email, p.vip_source
ORDER BY celkem DESC
LIMIT 20;
