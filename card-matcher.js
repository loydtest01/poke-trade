/**
 * card-matcher.js – Hybridní matcher Pokémon karet s kolektivní pamětí
 * =====================================================================
 * Samostatný modul, naroubujte vedle card-search.js a groq-client.js
 *
 * PIPELINE (v pořadí priority):
 *   1. Confirmed cache  – co uživatelé již potvrdili (Supabase)
 *   2. pHash matching   – perceptual hash obrázku karty vs. DB hashů
 *   3. Fuzzy text       – Levenshtein distance na name + tolerantní set/number
 *   4. Groq vision      – fallback na AI (volitelné, jen pokud GroqClient dostupný)
 *
 * POUŽITÍ:
 *   <script src="app.js"></script>
 *   <script src="groq-client.js"></script>   ← volitelné, pro fallback
 *   <script src="card-matcher.js"></script>
 *
 *   // Matchuj kartičku
 *   const result = await CardMatcher.match(imageUrl, {
 *     name: 'Charizard ex', set: 'OBF', number: '223', lang: 'EN', hp: '330'
 *   });
 *   // result = { cardId, name, setId, number, imageUrl, source, confidence, candidates }
 *
 *   // Uživatel potvrdí správný výsledek
 *   await CardMatcher.confirm(result.phash, cardId);
 *
 * SUPABASE TABULKY (spusť migration níže v SQL editoru):
 *   viz CardMatcher.SQL_MIGRATION
 *
 * IMPORT pHash databáze z em4go:
 *   viz CardMatcher.importHashesFromCsv(csvText)
 *
 * Závislosti: žádné externí npm. Jen Canvas API (prohlížeč).
 * =====================================================================
 */

(function (global) {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  //  KONFIGURACE
  // ═══════════════════════════════════════════════════════════════════════════

  const CFG = {
    /** Maximální Hamming distance pro pHash shodu (0 = identické, 64 = zcela jiné) */
    PHASH_THRESHOLD: 12,

    /** Minimální Levenshtein skóre (0–1) pro fuzzy text match */
    FUZZY_NAME_MIN_SCORE: 0.72,

    /** Jak moc bonifikovat shodu set kódu (0–1 váha) */
    FUZZY_SET_WEIGHT: 0.25,

    /** Jak moc bonifikovat shodu čísla karty (0–1 váha) */
    FUZZY_NUMBER_WEIGHT: 0.20,

    /** Minimální počet potvrzení pro to, aby byl cache výsledek vrácen bez ověření */
    CACHE_MIN_CONFIRMATIONS: 1,

    /** Supabase tabulky */
    TABLE_HASHES:    'card_hashes',
    TABLE_CACHE:     'card_match_cache',

    /** URL Supabase projektu (přečte se z window.SUPABASE_URL nebo app.js) */
    get SUPABASE_URL() {
      return (typeof window !== 'undefined' && window.SUPABASE_URL)
        || 'https://xrduqwrinzvmpixgmqta.supabase.co';
    },
  };

  // ═══════════════════════════════════════════════════════════════════════════
  //  SQL MIGRACE – zkopíruj do Supabase SQL editoru
  // ═══════════════════════════════════════════════════════════════════════════

  const SQL_MIGRATION = `
-- ── Tabulka předpočítaných pHashů z pokemontcg.io ──────────────────────────
CREATE TABLE IF NOT EXISTS card_hashes (
  card_id   TEXT PRIMARY KEY,   -- pokemontcg.io ID, např. "sv3pt5-054"
  phash     TEXT NOT NULL,      -- 16-char hex (64-bit pHash)
  name      TEXT,               -- EN jméno, pro fallback text search
  set_id    TEXT,               -- set ID, např. "sv3pt5"
  number    TEXT,               -- číslo karty, např. "054"
  image_url TEXT                -- URL obrázku (nepovinné)
);
CREATE INDEX IF NOT EXISTS idx_card_hashes_phash ON card_hashes (phash);
CREATE INDEX IF NOT EXISTS idx_card_hashes_name  ON card_hashes USING GIN (to_tsvector('english', coalesce(name, '')));

-- ── Tabulka potvrzení od uživatelů (kolektivní paměť) ──────────────────────
CREATE TABLE IF NOT EXISTS card_match_cache (
  phash              TEXT PRIMARY KEY,   -- pHash naskenované karty
  card_id            TEXT NOT NULL,      -- potvrzené card ID
  confirmed_count    INT  DEFAULT 1,
  confirmed_by       UUID,               -- UUID prvního uživatele
  last_confirmed_at  TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (card_id) REFERENCES card_hashes (card_id) ON DELETE CASCADE
);

-- ── RLS (Row Level Security) ────────────────────────────────────────────────
ALTER TABLE card_hashes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_match_cache ENABLE ROW LEVEL SECURITY;

-- card_hashes: čtení pro všechny, zápis jen pro service_role
CREATE POLICY "card_hashes_read"  ON card_hashes     FOR SELECT USING (true);
CREATE POLICY "card_hashes_write" ON card_hashes     FOR ALL    USING (auth.role() = 'service_role');

-- card_match_cache: čtení pro všechny, zápis pro přihlášené
CREATE POLICY "cache_read"  ON card_match_cache FOR SELECT USING (true);
CREATE POLICY "cache_write" ON card_match_cache FOR INSERT USING (auth.uid() IS NOT NULL);
CREATE POLICY "cache_update" ON card_match_cache FOR UPDATE USING (auth.uid() IS NOT NULL);

-- ── Postgres funkce pro inkrementaci potvrzení ──────────────────────────────
CREATE OR REPLACE FUNCTION increment_card_confirmation(p_phash TEXT, p_card_id TEXT, p_user_id UUID)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO card_match_cache (phash, card_id, confirmed_count, confirmed_by, last_confirmed_at)
  VALUES (p_phash, p_card_id, 1, p_user_id, NOW())
  ON CONFLICT (phash) DO UPDATE SET
    confirmed_count   = card_match_cache.confirmed_count + 1,
    last_confirmed_at = NOW();
END;
$$;
  `.trim();

  // ═══════════════════════════════════════════════════════════════════════════
  //  PERCEPTUAL HASH (pHash) – čistý JS, Canvas API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Načte obrázek z URL do HTMLImageElement (CORS-safe přes crossOrigin).
   * @param {string} url
   * @returns {Promise<HTMLImageElement>}
   */
  function _loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload  = () => resolve(img);
      img.onerror = () => reject(new Error(`[CardMatcher] Nelze načíst obrázek: ${url}`));
      img.src = url;
    });
  }

  /**
   * Převede ImageData na grayscale pole (Float32Array délky w*h).
   */
  function _toGrayscale(imageData) {
    const { data, width, height } = imageData;
    const gray = new Float32Array(width * height);
    for (let i = 0; i < gray.length; i++) {
      const r = data[i * 4];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
    return gray;
  }

  /**
   * 1D DCT-II na poli hodnot.
   * Výstup: pole DCT koeficientů stejné délky.
   */
  function _dct1d(values) {
    const N = values.length;
    const out = new Float32Array(N);
    const scale0 = Math.sqrt(1 / N);
    const scaleN = Math.sqrt(2 / N);
    for (let k = 0; k < N; k++) {
      let sum = 0;
      const coeff = Math.PI * k / N;
      for (let n = 0; n < N; n++) {
        sum += values[n] * Math.cos(coeff * (n + 0.5));
      }
      out[k] = (k === 0 ? scale0 : scaleN) * sum;
    }
    return out;
  }

  /**
   * 2D DCT na poli [size × size] (row-major).
   * Aplikuje 1D DCT na řádky, pak na sloupce.
   */
  function _dct2d(gray, size) {
    const tmp = new Float32Array(size * size);
    // DCT po řádcích
    for (let row = 0; row < size; row++) {
      const rowData = gray.slice(row * size, row * size + size);
      const dctRow  = _dct1d(rowData);
      for (let col = 0; col < size; col++) tmp[row * size + col] = dctRow[col];
    }
    // DCT po sloupcích
    const out = new Float32Array(size * size);
    for (let col = 0; col < size; col++) {
      const colData = new Float32Array(size);
      for (let row = 0; row < size; row++) colData[row] = tmp[row * size + col];
      const dctCol  = _dct1d(colData);
      for (let row = 0; row < size; row++) out[row * size + col] = dctCol[row];
    }
    return out;
  }

  /**
   * Vypočítá 64-bitový perceptual hash (pHash) obrázku.
   * Algoritmus: resize → grayscale → DCT 32×32 → top-left 8×8 → median → bity
   *
   * @param {string|HTMLImageElement} src  URL nebo již načtený Image element
   * @returns {Promise<string>}  16-char hex string (64 bits)
   */
  async function computePHash(src) {
    const DCT_SIZE  = 32;  // resize target
    const HASH_SIZE = 8;   // použijeme jen top-left 8×8 DCT koeficientů

    const img = typeof src === 'string' ? await _loadImage(src) : src;

    const canvas = document.createElement('canvas');
    canvas.width  = DCT_SIZE;
    canvas.height = DCT_SIZE;
    const ctx = canvas.getContext('2d');

    // Oříznutí: použij jen střední 80 % výšky (ignoruj horní/dolní okraj karty)
    // Tím se snížíme citlivost na HP bar, jméno setu apod.
    const cropY = Math.round(img.height * 0.1);
    const cropH = Math.round(img.height * 0.8);
    ctx.drawImage(img, 0, cropY, img.width, cropH, 0, 0, DCT_SIZE, DCT_SIZE);

    const imageData = ctx.getImageData(0, 0, DCT_SIZE, DCT_SIZE);
    const gray = _toGrayscale(imageData);

    // 2D DCT
    const dct = _dct2d(gray, DCT_SIZE);

    // Vezmi top-left 8×8 (64 koeficientů), přeskoč [0,0] (DC component)
    const vals = [];
    for (let row = 0; row < HASH_SIZE; row++) {
      for (let col = 0; col < HASH_SIZE; col++) {
        if (row === 0 && col === 0) continue; // přeskočit DC
        vals.push(dct[row * DCT_SIZE + col]);
      }
    }

    // Median (lépe než mean pro robustnost)
    const sorted = [...vals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    // Binární hash
    const bits = vals.map(v => v > median ? 1 : 0);

    // Převod na hex (každých 4 bity = 1 hex char)
    let hex = '';
    for (let i = 0; i < bits.length; i += 4) {
      const nibble = (bits[i] << 3) | (bits[i+1] << 2) | (bits[i+2] << 1) | (bits[i+3] || 0);
      hex += nibble.toString(16);
    }
    return hex.padEnd(16, '0');
  }

  /**
   * Hamming distance mezi dvěma hex stringy (musí být stejně dlouhé).
   * Počítá počet různých bitů.
   */
  function hammingDistance(hexA, hexB) {
    if (!hexA || !hexB || hexA.length !== hexB.length) return 64;
    let dist = 0;
    for (let i = 0; i < hexA.length; i++) {
      const xor = parseInt(hexA[i], 16) ^ parseInt(hexB[i], 16);
      // Počítej nastavené bity (popcount)
      let n = xor;
      while (n) { dist += n & 1; n >>= 1; }
    }
    return dist;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  FUZZY TEXT MATCHING – Levenshtein + normalizace
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Levenshtein distance (edit distance) dvou stringů.
   */
  function levenshtein(a, b) {
    a = String(a || '').toLowerCase().trim();
    b = String(b || '').toLowerCase().trim();
    if (a === b) return 0;
    if (!a) return b.length;
    if (!b) return a.length;
    const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
    for (let j = 1; j <= b.length; j++) {
      let prev = dp[0];
      dp[0] = j;
      for (let i = 1; i <= a.length; i++) {
        const temp = dp[i];
        dp[i] = b[j-1] === a[i-1]
          ? prev
          : 1 + Math.min(prev, dp[i], dp[i-1]);
        prev = temp;
      }
    }
    return dp[a.length];
  }

  /**
   * Normalizované Levenshtein skóre (0 = zcela jiné, 1 = identické).
   */
  function strSimilarity(a, b) {
    a = String(a || '').toLowerCase().trim();
    b = String(b || '').toLowerCase().trim();
    if (a === b) return 1;
    if (!a || !b) return 0;
    const maxLen = Math.max(a.length, b.length);
    return 1 - levenshtein(a, b) / maxLen;
  }

  /**
   * Normalizuje kód setu: odstraní přípony EN/JP, převede na lowercase.
   * "M24EN" → "m24", "sv3pt5" → "sv3pt5"
   */
  function _normalizeSetCode(s) {
    return String(s || '').replace(/EN$|JP$/i, '').toLowerCase().trim();
  }

  /**
   * Normalizuje číslo karty: vezme jen číselnou část.
   * "054/198" → "54", "054" → "54", "TG54" → "54"
   */
  function _normalizeNumber(n) {
    const m = String(n || '').match(/\d+/);
    return m ? String(parseInt(m[0], 10)) : '';
  }

  /**
   * Skóre shody (0–1) pro kandidáta z pokemontcg.io search.
   * Kombinuje name similarity + set + number bonus.
   *
   * @param {object} candidate  – unified karta z PkSearch
   * @param {object} query      – { name, set, number }
   */
  function scoreFuzzyCandidate(candidate, query) {
    const nameSim = strSimilarity(candidate.name, query.name);
    let score = nameSim;

    if (query.set && candidate.setCode) {
      const setMatch = _normalizeSetCode(candidate.setCode) === _normalizeSetCode(query.set) ? 1 : 0;
      score += setMatch * CFG.FUZZY_SET_WEIGHT;
    }
    if (query.number && candidate.number) {
      const numMatch = _normalizeNumber(candidate.number) === _normalizeNumber(query.number) ? 1 : 0;
      score += numMatch * CFG.FUZZY_NUMBER_WEIGHT;
    }

    return score / (1 + CFG.FUZZY_SET_WEIGHT + CFG.FUZZY_NUMBER_WEIGHT);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  SUPABASE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  function _sbUrl() {
    return CFG.SUPABASE_URL;
  }

  function _sbToken() {
    return localStorage.getItem('sb_token') || '';
  }

  async function _sbFetch(path, method = 'GET', body = null) {
    // Pokud je dostupný supabaseRequest z app.js, použij ho
    if (typeof supabaseRequest === 'function') {
      return supabaseRequest(path, method, body, _sbToken());
    }
    // Fallback: přímý fetch
    const url = `${_sbUrl()}/${path}`;
    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${_sbToken()}`,
        'apikey': (typeof window !== 'undefined' && window.SUPABASE_ANON) || '',
        'Prefer': 'return=minimal',
      },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`[CardMatcher] Supabase ${method} ${path} → ${res.status}: ${err}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  1. CONFIRMED CACHE – kolektivní paměť
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Hledá potvrzenou shodu v Supabase cache.
   * @param {string} phash
   * @returns {Promise<object|null>}  { cardId, confirmedCount } nebo null
   */
  async function _lookupCache(phash) {
    if (!phash) return null;
    try {
      const rows = await _sbFetch(
        `rest/v1/${CFG.TABLE_CACHE}?phash=eq.${encodeURIComponent(phash)}&confirmed_count=gte.${CFG.CACHE_MIN_CONFIRMATIONS}&select=card_id,confirmed_count`
      );
      if (Array.isArray(rows) && rows.length > 0) {
        return { cardId: rows[0].card_id, confirmedCount: rows[0].confirmed_count };
      }
    } catch (e) {
      console.warn('[CardMatcher] Cache lookup selhalo:', e.message);
    }
    return null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  2. pHash MATCHING – porovnání s databází hashů
  // ═══════════════════════════════════════════════════════════════════════════

  /** In-memory cache načtených hashů (aby se nestahovaly znovu při každém matchi) */
  let _hashCache = null;
  let _hashCacheTs = 0;
  const HASH_CACHE_TTL = 5 * 60 * 1000; // 5 minut

  /**
   * Načte všechny pHash záznamy ze Supabase (nebo vrátí in-memory cache).
   * @returns {Promise<Array<{card_id, phash, name, set_id, number}>>}
   */
  async function _loadHashes() {
    const now = Date.now();
    if (_hashCache && now - _hashCacheTs < HASH_CACHE_TTL) return _hashCache;

    try {
      // Supabase REST vrací max 1000 řádků, proto použijeme range pagination
      const allRows = [];
      const PAGE = 1000;
      let offset = 0;
      while (true) {
        const rows = await _sbFetch(
          `rest/v1/${CFG.TABLE_HASHES}?select=card_id,phash,name,set_id,number&limit=${PAGE}&offset=${offset}`
        );
        if (!Array.isArray(rows) || rows.length === 0) break;
        allRows.push(...rows);
        if (rows.length < PAGE) break;
        offset += PAGE;
      }
      _hashCache = allRows;
      _hashCacheTs = now;
      console.log(`[CardMatcher] pHash databáze načtena: ${allRows.length} karet`);
      return allRows;
    } catch (e) {
      console.warn('[CardMatcher] Načítání hashů selhalo:', e.message);
      return [];
    }
  }

  /**
   * Hledá nejbližší kartu v pHash databázi.
   * @param {string} phash  – hex hash naskenované karty
   * @returns {Promise<{cardId, name, setId, number, distance}|null>}
   */
  async function _matchByPHash(phash) {
    if (!phash) return null;
    const hashes = await _loadHashes();
    if (!hashes.length) return null;

    let best = null;
    let bestDist = Infinity;

    for (const row of hashes) {
      const dist = hammingDistance(phash, row.phash);
      if (dist < bestDist) {
        bestDist = dist;
        best = row;
      }
    }

    if (!best || bestDist > CFG.PHASH_THRESHOLD) {
      console.log(`[CardMatcher] pHash: žádná shoda (nejlepší distance: ${bestDist})`);
      return null;
    }

    console.log(`[CardMatcher] pHash: shoda "${best.name}" (distance: ${bestDist})`);
    return {
      cardId:   best.card_id,
      name:     best.name,
      setId:    best.set_id,
      number:   best.number,
      distance: bestDist,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  3. FUZZY TEXT MATCHING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Hledá kartu přes PkSearch (card-search.js) a ohodnotí výsledky fuzzy skórem.
   * @param {object} query  – { name, set, number, lang, hp }
   * @returns {Promise<{cardId, name, setId, number, score}|null>}
   */
  async function _matchByFuzzyText(query) {
    if (typeof PkSearch === 'undefined') {
      console.warn('[CardMatcher] PkSearch není dostupný – přeskakuji fuzzy match');
      return null;
    }

    const { name, set, number, lang, hp } = query;
    if (!name) return null;

    let candidates = [];
    try {
      candidates = await PkSearch.search(name, { set, number, lang, hp });
    } catch (e) {
      console.warn('[CardMatcher] PkSearch.search selhalo:', e.message);
      return null;
    }

    if (!candidates.length) return null;

    // Ohodnoť každého kandidáta
    const scored = candidates.map(c => ({
      cardId: c.apiId,
      name:   c.name,
      setId:  c.setCode || c.set,
      number: c.number,
      imageUrl: c.apiLarge || c.apiSmall || c.imageUrl,
      score:  scoreFuzzyCandidate(c, query),
    }));

    // Seřaď sestupně dle skóre
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    if (best.score < CFG.FUZZY_NAME_MIN_SCORE) {
      console.log(`[CardMatcher] Fuzzy: skóre ${best.score.toFixed(2)} je pod prahem ${CFG.FUZZY_NAME_MIN_SCORE}`);
      return null;
    }

    console.log(`[CardMatcher] Fuzzy: shoda "${best.name}" (skóre: ${best.score.toFixed(2)})`);
    return best;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  4. GROQ VISION FALLBACK
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Pošle obrázek karty do Groq vision a požádá o přesné ID.
   * Vrátí výsledek nebo null pokud Groq není dostupný / selhal.
   *
   * @param {string} imageUrl
   * @param {object} hint  – { name, set, number } – nápověda pro AI
   * @returns {Promise<{cardId, name, setId, number}|null>}
   */
  async function _matchByGroqVision(imageUrl, hint = {}) {
    if (typeof GroqClient === 'undefined' || !GroqClient.isReady()) {
      console.log('[CardMatcher] GroqClient není dostupný nebo není nakonfigurován');
      return null;
    }

    const hintStr = [
      hint.name   ? `Jméno (z OCR): "${hint.name}"` : '',
      hint.set    ? `Set kód (z OCR): "${hint.set}"` : '',
      hint.number ? `Číslo (z OCR): "${hint.number}"` : '',
    ].filter(Boolean).join('\n');

    const prompt = `You are a Pokemon TCG card identification expert.
Look at this Pokemon card image and identify it precisely on pokemontcg.io.

${hintStr ? `OCR hints (may be inaccurate):\n${hintStr}\n` : ''}

Return ONLY a valid JSON object, nothing else, no markdown:
{
  "card_id": "exact pokemontcg.io card ID like sv3pt5-054",
  "name": "exact English card name",
  "set_id": "set ID like sv3pt5",
  "number": "card number like 054",
  "confidence": 0.0
}

If you cannot identify the card with confidence > 0.6, return: {"card_id": null}`;

    try {
      const messages = [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: prompt },
        ],
      }];

      const raw = await GroqClient.chat(messages, { temperature: 0.1, max_tokens: 200 });
      const json = JSON.parse(raw.replace(/```json?|```/g, '').trim());

      if (!json.card_id) return null;

      console.log(`[CardMatcher] Groq vision: "${json.name}" (${json.card_id})`);
      return {
        cardId:     json.card_id,
        name:       json.name,
        setId:      json.set_id,
        number:     json.number,
        confidence: json.confidence || 0,
      };
    } catch (e) {
      console.warn('[CardMatcher] Groq vision selhal:', e.message);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  HLAVNÍ FUNKCE: match()
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @typedef {Object} MatchResult
   * @property {string|null} cardId      – pokemontcg.io ID nebo null pokud nenalezeno
   * @property {string}      name        – EN jméno karty
   * @property {string}      setId       – set ID
   * @property {string}      number      – číslo karty
   * @property {string}      imageUrl    – URL obrázku karty (z pokemontcg.io)
   * @property {string}      source      – "cache"|"phash"|"fuzzy"|"groq"|"none"
   * @property {number}      confidence  – 0–1
   * @property {string}      phash       – pHash naskenované karty (pro confirm())
   * @property {Array}       candidates  – další kandidáti z fuzzy searche
   */

  /**
   * Matchuje kartičku pomocí hybridní pipeline.
   *
   * @param {string|null}  imageUrl  – URL karty v Supabase Storage (nebo null pro jen text match)
   * @param {object}       query     – { name, set, number, lang, hp }
   * @param {object}       options   – { skipPHash, skipGroq, skipCache }
   * @returns {Promise<MatchResult>}
   */
  async function match(imageUrl, query = {}, options = {}) {
    const result = {
      cardId: null, name: '', setId: '', number: '',
      imageUrl: '', source: 'none', confidence: 0,
      phash: null, candidates: [],
    };

    // ── Výpočet pHash naskenované karty ──────────────────────────────────────
    if (imageUrl && !options.skipPHash) {
      try {
        result.phash = await computePHash(imageUrl);
        console.log(`[CardMatcher] pHash naskenované karty: ${result.phash}`);
      } catch (e) {
        console.warn('[CardMatcher] computePHash selhalo:', e.message);
      }
    }

    // ── 1. Confirmed cache ───────────────────────────────────────────────────
    if (result.phash && !options.skipCache) {
      const cached = await _lookupCache(result.phash);
      if (cached) {
        // Načti detaily karty z pokemontcg.io
        let details = null;
        if (typeof PkSearch !== 'undefined') {
          try { details = await PkSearch.fetchById(cached.cardId); } catch {}
        }
        result.cardId     = cached.cardId;
        result.name       = details?.name       || '';
        result.setId      = details?.setCode    || '';
        result.number     = details?.number     || '';
        result.imageUrl   = details?.apiLarge   || details?.imageUrl || '';
        result.source     = 'cache';
        result.confidence = Math.min(0.95, 0.7 + cached.confirmedCount * 0.05);
        console.log(`[CardMatcher] ✓ Cache hit (${cached.confirmedCount}× potvrzeno): ${cached.cardId}`);
        return result;
      }
    }

    // ── 2. pHash matching ────────────────────────────────────────────────────
    if (result.phash && !options.skipPHash) {
      const phashMatch = await _matchByPHash(result.phash);
      if (phashMatch) {
        // Doplň imageUrl z pokemontcg.io
        let details = null;
        if (typeof PkSearch !== 'undefined') {
          try { details = await PkSearch.fetchById(phashMatch.cardId); } catch {}
        }
        result.cardId     = phashMatch.cardId;
        result.name       = phashMatch.name    || details?.name    || '';
        result.setId      = phashMatch.setId   || details?.setCode || '';
        result.number     = phashMatch.number  || details?.number  || '';
        result.imageUrl   = details?.apiLarge  || details?.imageUrl || '';
        result.source     = 'phash';
        result.confidence = Math.max(0, 1 - phashMatch.distance / 64);
        return result;
      }
    }

    // ── 3. Fuzzy text matching ───────────────────────────────────────────────
    const fuzzyMatch = await _matchByFuzzyText(query);
    if (fuzzyMatch) {
      result.cardId     = fuzzyMatch.cardId;
      result.name       = fuzzyMatch.name;
      result.setId      = fuzzyMatch.setId;
      result.number     = fuzzyMatch.number;
      result.imageUrl   = fuzzyMatch.imageUrl || '';
      result.source     = 'fuzzy';
      result.confidence = fuzzyMatch.score;
      return result;
    }

    // ── 4. Groq vision fallback ──────────────────────────────────────────────
    if (imageUrl && !options.skipGroq) {
      const groqMatch = await _matchByGroqVision(imageUrl, query);
      if (groqMatch && groqMatch.cardId) {
        let details = null;
        if (typeof PkSearch !== 'undefined') {
          try { details = await PkSearch.fetchById(groqMatch.cardId); } catch {}
        }
        result.cardId     = groqMatch.cardId;
        result.name       = groqMatch.name    || details?.name    || '';
        result.setId      = groqMatch.setId   || details?.setCode || '';
        result.number     = groqMatch.number  || details?.number  || '';
        result.imageUrl   = details?.apiLarge || details?.imageUrl || '';
        result.source     = 'groq';
        result.confidence = groqMatch.confidence;
        return result;
      }
    }

    // ── Nenalezeno ───────────────────────────────────────────────────────────
    console.warn('[CardMatcher] Kartička nenalezena žádnou metodou:', query);
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  confirm() – uživatel potvrdí správný výsledek → uloží do kolektivní paměti
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Uloží potvrzení uživatele do Supabase (card_match_cache).
   * Příště kartička s stejným pHashem dostane tuto shodu jako první.
   *
   * @param {string} phash    – pHash naskenované karty (z MatchResult.phash)
   * @param {string} cardId   – potvrzené pokemontcg.io card ID
   * @returns {Promise<boolean>}
   */
  async function confirm(phash, cardId) {
    if (!phash || !cardId) {
      console.warn('[CardMatcher] confirm(): chybí phash nebo cardId');
      return false;
    }

    const user = typeof getUser === 'function' ? getUser() : null;
    const userId = user?.id || null;

    try {
      // Zkus RPC funkci (inkrementuje počítadlo)
      await _sbFetch('rest/v1/rpc/increment_card_confirmation', 'POST', {
        p_phash:   phash,
        p_card_id: cardId,
        p_user_id: userId,
      });
      console.log(`[CardMatcher] ✓ Potvrzení uloženo: ${cardId} (phash: ${phash})`);

      // Invaliduj in-memory cache hashů (mohlo se přidat nové potvrzení)
      _hashCacheTs = 0;

      return true;
    } catch (e) {
      console.error('[CardMatcher] confirm() selhalo:', e.message);
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  IMPORT pHash DATABÁZE z em4go CSV
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Importuje pHash databázi z em4go/PokeCard-TCG-detector CSV souboru.
   * Voláno jednorázově ze správcovské stránky.
   *
   * Formát CSV z em4go:
   *   card_id,hash
   *   base1-1,a3c4e5f600000000
   *   ...
   *
   * Pokud CSV obsahuje jiné sloupce, funkce je automaticky přeskočí.
   *
   * @param {string}   csvText    – obsah CSV jako string
   * @param {object}   options    – { batchSize: 100, onProgress: fn }
   * @returns {Promise<{imported, errors}>}
   */
  async function importHashesFromCsv(csvText, options = {}) {
    const { batchSize = 100, onProgress = null } = options;

    const lines = csvText.split('\n').filter(l => l.trim());
    const header = lines[0].split(',').map(h => h.trim().toLowerCase());

    const idIdx   = header.indexOf('card_id') !== -1 ? header.indexOf('card_id') : 0;
    const hashIdx = header.indexOf('hash')    !== -1 ? header.indexOf('hash')    : 1;
    const nameIdx = header.indexOf('name');
    const setIdx  = header.indexOf('set_id');
    const numIdx  = header.indexOf('number');

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const card_id = cols[idIdx]?.trim();
      const phash   = cols[hashIdx]?.trim();
      if (!card_id || !phash) continue;

      rows.push({
        card_id,
        phash,
        name:   nameIdx >= 0 ? (cols[nameIdx]?.trim() || null) : null,
        set_id: setIdx  >= 0 ? (cols[setIdx]?.trim()  || null) : card_id.split('-')[0] || null,
        number: numIdx  >= 0 ? (cols[numIdx]?.trim()  || null) : card_id.split('-')[1] || null,
      });
    }

    let imported = 0;
    let errors   = 0;

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      try {
        await _sbFetch(
          `rest/v1/${CFG.TABLE_HASHES}`,
          'POST',
          batch
        );
        imported += batch.length;
        if (onProgress) onProgress(imported, rows.length);
      } catch (e) {
        errors += batch.length;
        console.error(`[CardMatcher] Import batch ${i}–${i+batchSize} selhal:`, e.message);
      }
    }

    // Invaliduj cache
    _hashCache = null;
    _hashCacheTs = 0;

    console.log(`[CardMatcher] Import hotov: ${imported} importováno, ${errors} chyb`);
    return { imported, errors };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  UTILITY
  // ═══════════════════════════════════════════════════════════════════════════

  /** Invaliduje in-memory cache hashů (např. po importu nových dat) */
  function invalidateHashCache() {
    _hashCache = null;
    _hashCacheTs = 0;
  }

  /** Vrátí počet načtených hashů (0 pokud cache ještě není načtena) */
  function getHashCount() {
    return _hashCache ? _hashCache.length : 0;
  }

  /** Vrátí aktuální konfiguraci (pro ladění) */
  function getConfig() {
    return { ...CFG };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

  const CardMatcher = {
    // Hlavní funkce
    match,
    confirm,

    // Import databáze
    importHashesFromCsv,

    // Nízkoúrovňové funkce (přístupné pro debugging / custom use)
    computePHash,
    hammingDistance,
    strSimilarity,
    scoreFuzzyCandidate,

    // Utility
    invalidateHashCache,
    getHashCount,
    getConfig,

    // SQL migrace (zkopíruj do Supabase SQL editoru)
    SQL_MIGRATION,

    // Konfigurace (lze přepsat před použitím)
    CFG,
  };

  // ── Export ─────────────────────────────────────────────────────────────────
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CardMatcher;
  } else {
    global.CardMatcher = CardMatcher;
  }

})(typeof window !== 'undefined' ? window : globalThis);


/* =============================================================================
   RYCHLÝ START – příklady použití
   =============================================================================

   // 1. ZÁKLADNÍ MATCH (z queue.html po scanu)
   const result = await CardMatcher.match(
     card.photoUrl,                              // URL karty v Supabase Storage
     { name: card.name, set: card.set,
       number: card.number, lang: card.lang }
   );

   if (result.source !== 'none') {
     console.log(`Nalezeno přes ${result.source}: ${result.name} (${result.cardId})`);
     showCardPreview(result);
   } else {
     showManualSearch();
   }

   // 2. UŽIVATEL POTVRDÍ VÝSLEDEK (voláno při kliknutí "Toto je správná kartička")
   await CardMatcher.confirm(result.phash, selectedCardId);

   // 3. JEDNORÁZOVÝ IMPORT em4go hashů (voláno z admin stránky)
   const response = await fetch('/card_hashes_32b.csv');
   const csvText  = await response.text();
   const stats = await CardMatcher.importHashesFromCsv(csvText, {
     onProgress: (done, total) => updateProgressBar(done / total)
   });
   console.log(`Importováno: ${stats.imported} / ${stats.errors} chyb`);

   // 4. PŘESKOČENÍ KONKRÉTNÍCH KROKŮ (např. pro rychlý text-only fallback)
   const textOnly = await CardMatcher.match(null, query, { skipPHash: true, skipGroq: true });

   // 5. SQL MIGRACE – spusť jednou v Supabase SQL editoru:
   console.log(CardMatcher.SQL_MIGRATION);

============================================================================= */
