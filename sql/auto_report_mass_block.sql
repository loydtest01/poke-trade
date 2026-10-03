-- ════════════════════════════════════════════════════════════════
--  AUTO-REPORT: uživatel blokovaný více lidmi → podezřelé chování
--  Při každé nové blokaci spočítáme, kolika RŮZNÝMI lidmi je daný
--  uživatel blokovaný. Při překročení prahu (default 3) založíme
--  (nebo aktualizujeme) záznam v suspicious_events typu 'mass_blocked'.
--  Admin panel ho rovnou zobrazí (čte suspicious_events).
--
--  Spustit v Supabase SQL editoru. Idempotentní.
-- ════════════════════════════════════════════════════════════════

-- Práh: od kolika různých blokujících to hlásit adminovi
-- (měň podle potřeby; 3 = rozumný začátek)
CREATE OR REPLACE FUNCTION public._report_mass_block()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER          -- obejde RLS na suspicious_events (klient tam nesmí)
SET search_path = public
AS $$
DECLARE
  v_threshold   INT := 3;
  v_block_count INT;
  v_blockers    JSONB;
  v_existing    UUID;
  v_severity    TEXT;
BEGIN
  -- Kolik RŮZNÝCH lidí zablokovalo tohoto uživatele
  SELECT COUNT(DISTINCT blocker_id) INTO v_block_count
  FROM blocked_users
  WHERE blocked_id = NEW.blocked_id;

  IF v_block_count < v_threshold THEN
    RETURN NEW;  -- ještě pod prahem, nic nehlásíme
  END IF;

  -- Závažnost podle počtu
  v_severity := CASE
    WHEN v_block_count >= 10 THEN 'high'
    WHEN v_block_count >= 5  THEN 'medium'
    ELSE 'low'
  END;

  -- Seznam blokujících (id + username + kdy) pro výčet adminovi
  SELECT jsonb_agg(jsonb_build_object(
           'blocker_id', b.blocker_id,
           'username',   p.username,
           'at',         b.created_at
         ) ORDER BY b.created_at DESC)
    INTO v_blockers
  FROM blocked_users b
  LEFT JOIN profiles p ON p.id = b.blocker_id
  WHERE b.blocked_id = NEW.blocked_id;

  -- Je už nevyřízený 'mass_blocked' event pro tohoto uživatele?
  SELECT id INTO v_existing
  FROM suspicious_events
  WHERE user_id = NEW.blocked_id
    AND event_type = 'mass_blocked'
    AND reviewed = false
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    -- Aktualizuj existující (zvýš počet, obnov výčet)
    UPDATE suspicious_events
    SET severity = v_severity,
        details  = jsonb_build_object(
                     'block_count', v_block_count,
                     'blockers',    v_blockers,
                     'updated_at',  NOW()
                   ),
        created_at = NOW()      -- vyplave nahoru v seznamu
    WHERE id = v_existing;
  ELSE
    -- Založ nový event
    INSERT INTO suspicious_events (user_id, event_type, severity, details)
    VALUES (
      NEW.blocked_id,
      'mass_blocked',
      v_severity,
      jsonb_build_object(
        'block_count', v_block_count,
        'blockers',    v_blockers,
        'reason',      'Uživatel byl zablokován ' || v_block_count || ' různými lidmi'
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger na nové blokace
DROP TRIGGER IF EXISTS trg_report_mass_block ON blocked_users;
CREATE TRIGGER trg_report_mass_block
  AFTER INSERT ON blocked_users
  FOR EACH ROW
  EXECUTE FUNCTION public._report_mass_block();


-- ────────────────────────────────────────────────────────────────
--  OVĚŘENÍ
-- ────────────────────────────────────────────────────────────────
SELECT tgname, tgrelid::regclass AS table_name
FROM pg_trigger
WHERE tgname = 'trg_report_mass_block';

-- Po nasazení: až bude někdo blokovaný 3+ lidmi, objeví se v admin panelu
-- v sekci „Nedávné podezřelé události" jako 'mass_blocked' s výčtem blokujících.
