-- ════════════════════════════════════════════════════════════════
--  HLÍDANÉ KARTY — e-mail/notifikace když se karta objeví v obchodě
--  Spustit v Supabase SQL editoru. Idempotentní.
-- ════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.card_watches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  card_name    text NOT NULL,            -- název karty (pro shodu)
  card_number  text,                     -- volitelně číslo (přesnější shoda)
  set_name     text,                     -- volitelně set
  notify_email boolean DEFAULT true,     -- poslat i e-mail
  created_at   timestamptz DEFAULT now(),
  UNIQUE (user_id, card_name, card_number)
);

CREATE INDEX IF NOT EXISTS card_watches_user_idx ON public.card_watches(user_id);
-- Pro rychlé hledání shody dle názvu (case-insensitive)
CREATE INDEX IF NOT EXISTS card_watches_name_idx ON public.card_watches(lower(card_name));

ALTER TABLE public.card_watches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "watch_select_own" ON public.card_watches;
CREATE POLICY "watch_select_own" ON public.card_watches
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "watch_insert_own" ON public.card_watches;
CREATE POLICY "watch_insert_own" ON public.card_watches
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "watch_delete_own" ON public.card_watches;
CREATE POLICY "watch_delete_own" ON public.card_watches
  FOR DELETE USING (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────────
--  RPC: najdi hlídače, kterým se shoduje karta z nové nabídky.
--  Volá klient po vystavení nabídky (SECURITY DEFINER obejde RLS,
--  ale vrací jen user_id + notify_email, žádná citlivá data).
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.match_card_watches(
  p_card_name text, p_card_number text DEFAULT NULL
)
RETURNS TABLE(user_id uuid, notify_email boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT w.user_id, bool_or(w.notify_email) AS notify_email
  FROM card_watches w
  WHERE lower(w.card_name) = lower(p_card_name)
    AND (w.card_number IS NULL OR p_card_number IS NULL OR w.card_number = p_card_number)
  GROUP BY w.user_id;
$$;

GRANT EXECUTE ON FUNCTION public.match_card_watches(text, text) TO anon, authenticated;

-- Ověření
SELECT 'card_watches OK' AS status;
