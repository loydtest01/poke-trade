-- ══════════════════════════════════════════════════════════════
-- migration_notification_prefs.sql
-- Přidá notification_prefs do profiles a listing_category do listings
-- Spusť v Supabase → SQL Editor
-- ══════════════════════════════════════════════════════════════

-- 1. Přidat notification_prefs do profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS notification_prefs JSONB DEFAULT '{
    "email_new_listings": true,
    "email_listings_cat": "all",
    "email_price_alert":  true,
    "email_wishlist":     false,
    "email_trade":        false,
    "email_weekly":       false,
    "email_messages":     false,
    "email_frequency":    "daily",
    "inapp_listings":     true,
    "inapp_wishlist":     true,
    "inapp_messages":     true
  }'::jsonb;

-- 2. Přidat listing_category do listings
--    Hodnoty: 'card' | 'sealed' | 'other'
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS listing_category TEXT DEFAULT 'card'
  CHECK (listing_category IN ('card', 'sealed', 'other'));

-- Index pro rychlé filtrování dle kategorie
CREATE INDEX IF NOT EXISTS listings_category_idx ON listings(listing_category);

-- 3. RLS — profil může číst vlastní notification_prefs (SELECT již existuje)
--    Update prefs — zajistí existující policy "Uživatel může upravit svůj profil"

-- 4. Service role může číst notification_prefs všech uživatelů pro cron
--    (Cron používá SUPABASE_SERVICE_KEY, který obchází RLS automaticky)

-- Hotovo ✅
