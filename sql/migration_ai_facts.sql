-- ════════════════════════════════════════════════════════════════
-- migration_ai_facts.sql
-- Tabulka pro AI-generované zajímavosti + tipy zobrazené na index.html
-- Strop 500 záznamů — při překročení se mažou nejstarší
--
-- SPUSTIT V: Supabase Dashboard → SQL Editor
-- ════════════════════════════════════════════════════════════════

-- ── 1. Tabulka ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_facts (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  kind        text        NOT NULL CHECK (kind IN ('fact', 'tip')),
  emoji       text        DEFAULT '🌟',
  title       text        NOT NULL,
  body        text        NOT NULL,
  text_hash   text        NOT NULL UNIQUE,  -- SHA-256 hash pro deduplikaci
  source      text        DEFAULT 'ai',     -- 'ai' nebo 'manual' nebo 'seed'
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- ── 2. Index pro rychlé čtení (frontend bere ORDER BY created_at DESC) ──
CREATE INDEX IF NOT EXISTS idx_ai_facts_created
  ON ai_facts (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_facts_kind
  ON ai_facts (kind);

-- ── 3. RLS — public read (anon may SELECT), insert jen service_role ──
ALTER TABLE ai_facts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_facts_public_read" ON ai_facts;
CREATE POLICY "ai_facts_public_read"
  ON ai_facts FOR SELECT
  TO anon, authenticated
  USING (true);

-- INSERT/UPDATE/DELETE jen přes service_role (cron endpoint)
DROP POLICY IF EXISTS "ai_facts_service_write" ON ai_facts;
CREATE POLICY "ai_facts_service_write"
  ON ai_facts FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── 4. Trigger: po INSERTu udrž max 500 záznamů ─────────────────
-- Když překročíme 500, smaž nejstarší (FIFO).
CREATE OR REPLACE FUNCTION ai_facts_enforce_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
  v_max   integer := 500;
BEGIN
  SELECT count(*) INTO v_count FROM ai_facts;
  IF v_count > v_max THEN
    DELETE FROM ai_facts
    WHERE id IN (
      SELECT id FROM ai_facts
      ORDER BY created_at ASC
      LIMIT (v_count - v_max)
    );
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_facts_limit ON ai_facts;
CREATE TRIGGER trg_ai_facts_limit
  AFTER INSERT ON ai_facts
  FOR EACH STATEMENT
  EXECUTE FUNCTION ai_facts_enforce_limit();

-- ── 5. Seed: počáteční obsah (24 hardcoded faktů + tipů) ────────
-- Aby frontend hned po deploji měl co rotovat. Při kolizích (UNIQUE text_hash)
-- se nevloží duplicita.
INSERT INTO ai_facts (kind, emoji, title, body, text_hash, source) VALUES
  ('tip',  '🔒', 'Soukromé sdílení',          'Žádné veřejné odkazy! Album nasdílíš jen konkrétnímu registrovanému trenérovi přes jeho jméno nebo e-mail.',                              md5('Soukromé sdílení'),         'seed'),
  ('tip',  '⏳', 'Časový zámek',               'Sdílení není navždy. Nastav si dobu (od pár hodin po 7 dní), po které se přístup automaticky zruší.',                                     md5('Časový zámek'),             'seed'),
  ('tip',  '👨‍👩‍👧', 'Rodinný klan',         'Propoj profily s rodinou — každý má vlastní album, ale vidíte své karty navzájem jako jeden tým.',                                       md5('Rodinný klan'),             'seed'),
  ('tip',  '💰', 'Reálné ceny z Cardmarketu', 'U každé karty vidíš aktuální tržní hodnotu. Žádné odhady, jen čistá data — a žádný Rakeťák tě nenapálí!',                                  md5('Reálné ceny'),              'seed'),
  ('tip',  '📸', 'Skener karet',              'Vyfoť kartičku přes mobil a AI ji během chvíle rozpozná. Rychlejší než Quick Attack od Pikachu!',                                          md5('Skener karet'),             'seed'),
  ('tip',  '🔄', 'Výměny i protinabídky',     'Kartu za kartu, nebo férová cena. Pod každou nabídkou je chat, kde se můžete domluvit na detailech.',                                     md5('Výměny i protinabídky'),   'seed'),
  ('tip',  '✨', 'Vždycky zdarma',            'Žádné poplatky, žádné předplatné. Děláme to z lásky ke kartičkám — peníze od uživatelů nikdy nevybíráme.',                              md5('Vždycky zdarma'),           'seed'),
  ('tip',  '🌍', 'JP a CN karty taky',        'AI rozpozná i japonské a tchajwanské karty. Stačí vyfotit a najdeme český nebo anglický ekvivalent.',                                     md5('JP a CN karty'),            'seed'),
  ('tip',  '📊', 'Sledování hodnoty',         'Vidíš trend, minimum a 30denní průměr ceny. Tvá sbírka je investice — měj o ní přehled.',                                                md5('Sledování hodnoty'),       'seed'),
  ('tip',  '🃏', 'Moje album',                'V „Moje album" najdeš všechny své karty seřazené podle setů, vzácnosti nebo abecedně. Funguje i offline jako digitální Pokédex.',         md5('Moje album'),               'seed'),
  ('tip',  '🛒', 'Obchod',                    'Sekce „Obchod" zobrazuje karty které jsi vystavil k prodeji nebo výměně. Filtruj podle stavu a ceny pro rychlý přehled.',                  md5('Obchod sekce'),             'seed'),
  ('tip',  '⚖️', 'Porovnání alb',             'V „Porovnat alba" zjistíš co máte společné s kamarádem a co ti chybí. Skvělé pro plánování výměn.',                                       md5('Porovnání alb'),            'seed'),
  ('fact', '🌊', 'Telepatický Lapras',        'Ashův Lapras dokázal mluvit s lidmi pomocí telepatie. Ukázal to při cestě s Jynx na severní pól, když pomáhal zachránit Vánoce!',          md5('Lapras telepatie'),        'seed'),
  ('fact', '🐱', 'Mluvící Meowth',            'Meowth z Rakeťáků se naučil mluvit lidskou řečí, aby zapůsobil na kočičí dámu Meowzie. Stálo ho to ale schopnost bojovat a vyvíjet se.',  md5('Mluvící Meowth'),           'seed'),
  ('fact', '⚡', 'Pikachu = jiskra + myš',    'Jméno Pikachu vzniklo spojením japonských slov „pika" (zvuk jiskry) a „chu" (pípnutí myši). Doslova „Elektrické pípnutí"!',                md5('Pikachu jméno'),            'seed'),
  ('fact', '🦏', 'První kreslený byl Rhydon', 'I když má Bulbasaur číslo 001, prvním nakresleným Pokémonem byl Rhydon. Proto najdeš jeho sochy v každém Gymu v původních hrách.',         md5('Rhydon první'),             'seed'),
  ('fact', '🐿️', 'Pikachu měl být veverka',   'Designérka Atsuko Nishida prozradila, že Pikachu byl původně inspirován veverkou. Chtěla si v té době jednu pořídit jako mazlíčka!',     md5('Pikachu veverka'),         'seed'),
  ('fact', '🎬', 'Připravte se na potíže!',   'Slavné motto Rakeťáků „Připravte se na potíže… a na dvojité!" zaznělo v původním seriálu více než 700×. Jednou z nejcitovanějších hlášek anime všech dob.', md5('Rakeťáci motto'), 'seed'),
  ('fact', '👑', 'Stanu se Pokémon Mistrem!', 'Ashovi trvalo 25 let, než se konečně stal Pokémon Světovým Šampionem. V dílu z roku 2022 porazil Leona a vyhrál Mistrovský Turnaj.',       md5('Ash mistr'),                'seed'),
  ('fact', '🥚', 'Mew uvnitř Mewtwo',         'Podle původních příběhů byl Mewtwo vytvořen z DNA Mewa. Vědci ale museli použít několik desítek vzorků, než se klonování povedlo.',       md5('Mewtwo DNA'),               'seed'),
  ('fact', '🌟', 'Super účinné!',             'Hláška „It''s super effective!" se stala internetovým memem dlouho předtím, než internet měl meme jméno. Z her na Game Boy do běžného slovníku!', md5('Super effective'),         'seed'),
  ('fact', '🍙', 'Brockovy „koblížky"',       'V americkém dabingu Brock tvrdil, že jí koblížky — i když v animaci jasně držel japonské rýžové koule onigiri. Klasický překladatelský úlet 90. let!', md5('Brock koblížky'),         'seed'),
  ('fact', '🎶', 'Téma seriálu = hit',        '„Gotta catch ''em all!" píseň z prvního seriálu se stala kulturní ikonou. Zazpívalo si ji s ní celá generace 90. let.',                  md5('Theme song'),               'seed'),
  ('fact', '📺', 'Kdo je tenhle Pokémon?',    'Kultovní hádanka uprostřed dílu, kdy se ze siluety mělo poznat o jakého Pokémona jde. Často to byl velmi nečekaný kandidát!',             md5('Kdo je tenhle'),            'seed')
ON CONFLICT (text_hash) DO NOTHING;

-- ════════════════════════════════════════════════════════════════
-- Hotovo. Ověř:
--   SELECT count(*), kind FROM ai_facts GROUP BY kind;
--   SELECT * FROM ai_facts ORDER BY created_at DESC LIMIT 10;
-- ════════════════════════════════════════════════════════════════
