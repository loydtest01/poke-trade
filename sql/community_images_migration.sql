-- ══════════════════════════════════════════════════════════════
-- Community Card Images — tabulky pro Supabase
-- ══════════════════════════════════════════════════════════════

-- 1) Tabulka community obrázků karet
CREATE TABLE IF NOT EXISTS community_card_images (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  api_id text NOT NULL,              -- pokemontcg.io card ID (e.g. "swsh10-163")
  lang text NOT NULL,                -- "JP", "DE", "FR", "KO", "ZH" atd.
  storage_path text NOT NULL,        -- cesta v Supabase Storage
  url text NOT NULL,                 -- veřejná URL obrázku
  uploaded_by uuid REFERENCES auth.users(id),
  card_name text,                    -- EN název karty
  card_set text,                     -- název setu
  card_number text,                  -- číslo karty v setu
  verified boolean DEFAULT false,    -- AI ověřeno
  reports integer DEFAULT 0,         -- počet nahlášení
  blocked boolean DEFAULT false,     -- zablokováno (auto po 3 reportech)
  created_at timestamptz DEFAULT now()
);

-- Index pro rychlé vyhledávání
CREATE INDEX IF NOT EXISTS idx_cci_lookup 
  ON community_card_images(api_id, lang) 
  WHERE NOT blocked;

-- RLS politiky
ALTER TABLE community_card_images ENABLE ROW LEVEL SECURITY;

-- Kdokoliv přihlášený může číst nezablokované obrázky
CREATE POLICY "community_card_images_select" ON community_card_images
  FOR SELECT USING (NOT blocked);

-- Přihlášený uživatel může vkládat
CREATE POLICY "community_card_images_insert" ON community_card_images
  FOR INSERT WITH CHECK (auth.uid() = uploaded_by);

-- Přihlášený uživatel může aktualizovat reports/blocked
CREATE POLICY "community_card_images_update" ON community_card_images
  FOR UPDATE USING (true)
  WITH CHECK (true);


-- 2) Tabulka nahlášení
CREATE TABLE IF NOT EXISTS community_image_reports (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  reporter_id uuid REFERENCES auth.users(id),
  image_api_id text NOT NULL,        -- api_id obrázku
  image_lang text NOT NULL,          -- jazyk obrázku
  reason text,                       -- důvod nahlášení
  created_at timestamptz DEFAULT now()
);

ALTER TABLE community_image_reports ENABLE ROW LEVEL SECURITY;

-- Přihlášený uživatel může vkládat reporty
CREATE POLICY "community_image_reports_insert" ON community_image_reports
  FOR INSERT WITH CHECK (auth.uid() = reporter_id);

-- Číst může jen admin (volitelně)
CREATE POLICY "community_image_reports_select" ON community_image_reports
  FOR SELECT USING (auth.uid() = reporter_id);
