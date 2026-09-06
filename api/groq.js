/**
 * api/groq.js – Univerzální AI proxy s dynamickými limity a admin alerty
 * ─────────────────────────────────────────────────────────────────────
 *
 * POZNÁMKA: Soubor zůstává pojmenovaný "groq.js" pro zpětnou kompatibilitu
 * (34+ míst v projektu volá /api/groq). Nový alias /api/ai je nastaven přes
 * vercel.json rewrites — oba vedou na tento handler.
 *
 *   GET  /api/groq                → ping  { ok, ts }
 *   GET  /api/groq?info=usage     → vrátí limit info pro přihlášeného usera
 *                                    (pro UI badge "AI: 142/200 dnes")
 *   POST /api/groq                → AI proxy
 *
 * BODY:
 *   {
 *     provider: 'groq' | 'cerebras' | 'openrouter' | 'mistral'  // default: 'groq'
 *     model, messages, temperature, max_tokens, response_format,
 *     usage_type: 'search' | 'fake'  // pro rate limit tracking
 *   }
 *
 * HEADERS:
 *   Authorization: Bearer <sb_token>     (auth)
 *   X-AI-Key:      <personal_key>        (univerzální override)
 *   X-Groq-Key:    <personal_key>        (legacy, jen pro provider='groq')
 *
 * RATE LIMITS:
 *   VIP/owner          → bez limitu
 *   Non-VIP            → POOL-AWARE dynamický limit per usage_type:
 *                        dynamic_max = min(abs_max, pool × max_per_pool_pct)
 *                        fair_share  = pool × share / (active_users + buffer)
 *                        limit       = clamp(fair_share, min, dynamic_max)
 *                        → Když přidáš klíče → pool roste → max roste automaticky
 *                        → 20 % poolu zůstává jako rezerva pro VIP/špičky
 *
 * ADMIN ALERTY (pro OWNER_EMAIL):
 *   - Per-provider keys exhausted → notifikace v notifications table
 *   - Pool < 30 % a active_users > 50 → varovná notifikace
 *   - Limit per user klesl pod kritickou úroveň → notifikace
 *   Dedupe per den per typ — admin nedostane spam.
 */

const MAX_BODY = 20 * 1024 * 1024;

export const config = {
  api: { bodyParser: { sizeLimit: '20mb' } },
};

const SUPABASE_URL  = 'https://xrduqwrinzvmpixgmqta.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyZHVxd3Jpbnp2bXBpeGdtcXRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDI0MjksImV4cCI6MjA5MDk3ODQyOX0.2p404Vy77CH_MsvQlnpxaO0H-KlSSt_oJlaFrmttFXs';

// ── Konfigurace providerů ──────────────────────────────────────────
// daily_text   = realistický počet textových req/den/klíč (free tier)
// daily_vision = realistický počet vision req/den/klíč (vision je výrazně dražší
//                v tokenech, takže pool je menší než pro text)
//                Cerebras vision nemá → daily_vision = 0
//                OpenRouter free models mají striktní limit 50/den oba typy
const PROVIDERS = {
  gemini: {
    endpoint:        'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    modelsUrl:       'https://generativelanguage.googleapis.com/v1beta/openai/models',
    envKey:          'GEMINI_API_KEY',
    defaultModel:    'gemini-2.5-flash',
    // Pořadí náhrad, když požadovaný model zmizí. První živý vyhraje.
    preferText:      ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-pro'],
    preferVision:    ['gemini-2.5-flash', 'gemini-flash-latest'],
    signupHost:      'aistudio.google.com',
    daily_text:      1500,     // 1500 req/den free tier
    daily_vision:    500,      // vision výrazně dražší na tokenech
    vision:          true,
    extraHeaders:    null,
  },
  groq: {
    endpoint:        'https://api.groq.com/openai/v1/chat/completions',
    modelsUrl:       'https://api.groq.com/openai/v1/models',
    envKey:          'GROQ_API_KEY',
    defaultModel:    'qwen/qwen3.6-27b',
    preferText:      ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.6-27b'],
    preferVision:    ['qwen/qwen3.6-27b', 'openai/gpt-oss-120b'],
    signupHost:      'console.groq.com',
    daily_text:      800,      // 500k tokens/den / ~600 tokens/req
    daily_vision:    60,       // 500k tokens/den / ~8000 tokens/vision req
    vision:          true,
    extraHeaders:    null,
  },
  cerebras: {
    endpoint:        'https://api.cerebras.ai/v1/chat/completions',
    modelsUrl:       'https://api.cerebras.ai/v1/models',
    envKey:          'CEREBRAS_API_KEY',
    defaultModel:    'gpt-oss-120b',
    preferText:      ['gpt-oss-120b', 'gpt-oss-20b'],
    preferVision:    [],
    signupHost:      'cloud.cerebras.ai',
    daily_text:      200,      // 1M tokens/den / ~5000 tokens/req (gpt-oss-120b)
    daily_vision:    0,        // Cerebras vision nemá
    vision:          false,
    extraHeaders:    null,
  },
  openrouter: {
    endpoint:        'https://openrouter.ai/api/v1/chat/completions',
    modelsUrl:       'https://openrouter.ai/api/v1/models',
    envKey:          'OPENROUTER_API_KEY',
    defaultModel:    'meta-llama/llama-3.3-70b-instruct:free',
    preferText:      ['meta-llama/llama-3.3-70b-instruct:free', 'qwen/qwen3-30b-a3b:free'],
    preferVision:    ['qwen/qwen2.5-vl-72b-instruct:free'],
    signupHost:      'openrouter.ai',
    daily_text:      50,       // free models striktní 50/den/klíč
    daily_vision:    50,
    vision:          true,
    extraHeaders: (req) => ({
      'HTTP-Referer': req.headers.origin || req.headers.referer || 'https://poke-trade-ruddy.vercel.app',
      'X-Title':      'PokéTrade',
    }),
  },
  mistral: {
    endpoint:        'https://api.mistral.ai/v1/chat/completions',
    modelsUrl:       'https://api.mistral.ai/v1/models',
    envKey:          'MISTRAL_API_KEY',
    defaultModel:    'mistral-small-latest',
    preferText:      ['mistral-small-latest', 'mistral-medium-latest'],
    preferVision:    ['pixtral-12b-latest', 'mistral-small-latest'],
    signupHost:      'console.mistral.ai',
    daily_text:      1000,     // 1B tokens/měsíc = 33M/den; ~30k tokens/text req → ~1100/den, conservatively 1000
    daily_vision:    500,      // vision ~10k tokens/req → ~3000/den, conservatively 500
    vision:          true,
    extraHeaders:    null,
  },
};

// ── VIP allowlist ──────────────────────────────────────────────────
// Hardcoded fallback — používá se pokud DB tabulka vip_users není dostupná
// nebo selže. Skutečný zdroj pravdy je tabulka `vip_users` (viz isVipDb()).
const VIP_EMAILS = new Set([
  'adelka.papezova@gmail.com',
  'james.t.kirk1933@gmail.com',
  'lasovlas@seznam.cz',
  'loydtest@gmail.com',
  'pan.spock30@gmail.com',
  'pokecards.app.info@gmail.com',
]);
const OWNER_EMAIL = 'papez.ondrej@gmail.com';

// ── DB-based VIP cache (5 minut) — preferovaný zdroj pravdy ────────
// Dříve byl jen hardcoded VIP_EMAILS Set. Teď čteme z `vip_users` tabulky aby
// admin mohl přidávat VIP účty bez deploye. Hardcoded set zůstává jako fallback
// (pokud DB query selže, čteme z něj).
let _vipDbCache = null;
let _vipDbCacheTime = 0;
const VIP_DB_CACHE_TTL = 5 * 60 * 1000;

async function isVipDb(email) {
  if (!email) return false;
  // Owner je vždy VIP, nemusí čekat na DB
  if (email === OWNER_EMAIL) return true;
  const now = Date.now();
  if (!_vipDbCache || now - _vipDbCacheTime > VIP_DB_CACHE_TTL) {
    try {
      const svcKey = process.env.SUPABASE_SERVICE_KEY || SUPABASE_ANON;
      const r = await fetch(`${SUPABASE_URL}/rest/v1/vip_users?select=email`, {
        headers: { 'apikey': svcKey, 'Authorization': `Bearer ${svcKey}` },
      });
      if (r.ok) {
        const rows = await r.json();
        _vipDbCache = new Set((rows || []).map(row => String(row.email || '').toLowerCase()));
        _vipDbCacheTime = now;
      }
    } catch (e) {
      console.error('[groq] VIP DB cache chyba:', e.message);
    }
  }
  if (_vipDbCache?.has(email.toLowerCase())) return true;
  // Fallback: hardcoded set (pokud DB nefunguje)
  return VIP_EMAILS.has(email);
}

// ── User VIP tier detection ────────────────────────────────────────
// 3 tiers:
//   1. 'lifetime' — whitelist (vip_users) NEBO vip_source IN (whitelist, lifetime_first_10)
//      → BEZ limitů (proxy direct)
//   2. 'regular'  — aktivní VIP s vip_source IN (first_100, standard, extended, manual...)
//      → 80% lifetime fairShare limitu
//   3. 'free'     — bez VIP nebo expirovaný
//      → fixed 20 search/5 fake denní limit (LIMITS_CONFIG.min)
//
// Tato funkce vrací typ tieru pro daného user_id. Lookup do profiles tabulky.
async function getUserVipTier(userId, userEmail) {
  // Lifetime přes vip_users tabulku (whitelist) — fastpath, žádný DB query do profiles
  if (await isVipDb(userEmail)) return 'lifetime';

  // Načti vip_source a vip_until z profiles
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=vip_source,vip_until`,
      { headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}` } }
    );
    if (!r.ok) return 'free';
    const rows = await r.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row || !row.vip_until) return 'free';
    // VIP expirovaný?
    if (new Date(row.vip_until) <= new Date()) return 'free';
    // Lifetime přes vip_source (např. 'lifetime_first_10')
    if (row.vip_source === 'lifetime_first_10' || row.vip_source === 'whitelist') return 'lifetime';
    // Vše ostatní s aktivním vip_until = regular tier (first_100, standard, extended, manual)
    return 'regular';
  } catch (e) {
    console.error('[groq] getUserVipTier error:', e.message);
    return 'free';
  }
}

// ── Limit konfigurace per usage_type ───────────────────────────────
// share = jaké procento z poolu si daný typ může vzít (zbytek je rezerva pro VIP)
// vision = jestli typ vyžaduje vision-capable providera
// max_per_pool_pct = 1 uživatel nesmí utratit víc než X % poolu (safety)
// abs_max = absolutní strop (proti runaway loops / attackům)
//
// Per-user limit se počítá DYNAMICKY z velikosti poolu:
//   dynamic_max = min(abs_max, floor(pool × max_per_pool_pct))
//   fair_share  = floor(pool × share / (active_users + buffer))
//   limit       = clamp(fair_share, min, dynamic_max)
//
// Když přidáš klíče do env vars → pool roste → dynamic_max roste automaticky.
// Žádné manuální tuning. Notifikace přijde když pool klesne pod kritickou úroveň.
// ── Limit konfigurace per usage_type ───────────────────────────────
// share = jaké procento z poolu si daný typ může vzít (zbytek je rezerva)
// vision = jestli typ vyžaduje vision-capable providera (ovlivní pool)
// min/max = clamp limit per user (po fair-share výpočtu)
//
// Aktuální pool s tvými klíči (6×Groq + 5×Cerebras + 9×OpenRouter + 1×Mistral):
//   search: 6×800 + 5×200 + 9×50 + 1×1000 = 7250 req/den (text)
//   fake:   6×60  + 9×50  + 1×500          = 1310 req/den (vision)
//
// Pool se přepočítá AUTOMATICKY když změníš počet klíčů ve Vercel ENV
// (cache TTL 1 minuta, žádný restart/deploy nepotřeba).
//
// Když je málo userů → user dostane skoro plný share-cap (ten max).
// Když je hodně userů → klesá ke min, plus přijde admin notifikace.
const LIMITS_CONFIG = {
  search: { min: 20, max: 300, share: 0.50, vision: false },
  fake:   { min:  5, max: 100, share: 0.30, vision: true  },
};

const ACTIVE_USERS_BUFFER_PCT    = 0.20;
const POOL_WARNING_THRESHOLD     = 0.30;
const ACTIVE_USERS_WARNING_THRES = 50;
const PER_USER_CRITICAL          = 50;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Groq-Key, X-AI-Key, Authorization',
};

// ── Pool kapacity helper (cached per warm start) ───────────────────
let _cachedKeyCounts = null;
let _cachedAt        = 0;
const KEY_CACHE_TTL  = 60_000;

/* ══════════════════════════════════════════════════════════════
   AUTOMATICKÉ ŘEŠENÍ MODELŮ
   ------------------------------------------------------------
   Poskytovatelé ruší modely v řádu měsíců (Groq vypnul llama-4-scout
   17.7.2026 a llama-3.3-70b 16.8.2026). Když se název modelu píše
   natvrdo do kódu, celá aplikace spadne na HTTP 404 a nikdo neví proč.

   Řešení: server si vytáhne od poskytovatele seznam živých modelů
   (endpoint /models, který mají všechna OpenAI-kompatibilní API),
   nechá si ho hodinu v paměti a neexistující model tiše nahradí
   nejbližším živým podle pořadí v preferText / preferVision.
══════════════════════════════════════════════════════════════ */
const MODEL_CACHE_TTL = 60 * 60 * 1000;   // 1 hodina
const _modelCache = {};                   // provider → { list:Set, at:number }

async function ziskejZiveModely(provider, providerName, key) {
  const c = _modelCache[providerName];
  if (c && Date.now() - c.at < MODEL_CACHE_TTL) return c.list;
  if (!provider.modelsUrl || !key) return null;

  try {
    const r = await fetch(provider.modelsUrl, {
      headers: { Authorization: `Bearer ${key}` },
      signal:  AbortSignal.timeout(6000),
    });
    if (!r.ok) return c?.list || null;      // při chybě raději starý seznam
    const d = await r.json();
    const ids = (d?.data || d?.models || [])
      .map(m => m?.id || m?.name || '')
      .filter(Boolean)
      .map(id => String(id).replace(/^models\//, ''));   // Gemini vrací "models/xxx"
    if (!ids.length) return c?.list || null;
    const list = new Set(ids);
    _modelCache[providerName] = { list, at: Date.now() };
    return list;
  } catch {
    return c?.list || null;
  }
}

/**
 * Vrátí model, který u poskytovatele opravdu existuje.
 * Když je požadovaný model živý, nechá ho být.
 * Když ne, projde preferovaný seznam a pak cokoli, co odpovídá rodině.
 */
async function vyresModel(provider, providerName, key, pozadovany, jeVision) {
  const zive = await ziskejZiveModely(provider, providerName, key);
  // Seznam se nepodařilo načíst → nech požadavek projít beze změny
  if (!zive) return { model: pozadovany, zmeneno: false };
  if (pozadovany && zive.has(pozadovany)) return { model: pozadovany, zmeneno: false };

  const preferovane = (jeVision ? provider.preferVision : provider.preferText) || [];
  for (const kandidat of [...preferovane, provider.defaultModel]) {
    if (kandidat && zive.has(kandidat)) {
      console.warn(`[modely] ${providerName}: "${pozadovany}" neexistuje → "${kandidat}"`);
      return { model: kandidat, zmeneno: true, puvodni: pozadovany };
    }
  }

  // Poslední záchrana: cokoli, co nevypadá na embedding/whisper/guard
  const vhodny = [...zive].find(id =>
    !/embed|whisper|tts|guard|moderation|rerank/i.test(id));
  if (vhodny) {
    console.warn(`[modely] ${providerName}: nouzová volba "${vhodny}"`);
    return { model: vhodny, zmeneno: true, puvodni: pozadovany };
  }
  return { model: pozadovany, zmeneno: false };
}

/** Poznal poskytovatel, že model neexistuje? Pak zahoď cache. */
function jeChybaModelu(status, data) {
  if (status !== 404 && status !== 400) return false;
  const t = JSON.stringify(data || '').toLowerCase();
  return t.includes('does not exist')
      || t.includes('model_not_found')
      || t.includes('is not found')
      || t.includes('decommissioned')
      || t.includes('unknown model');
}

function zapomenModely(providerName) {
  delete _modelCache[providerName];
}

function parseKeys(raw) {
  if (!raw) return [];
  return String(raw).split(',').map(k => k.trim()).filter(k => k.length > 10);
}

function getKeyCounts() {
  if (_cachedKeyCounts && Date.now() - _cachedAt < KEY_CACHE_TTL) return _cachedKeyCounts;
  _cachedKeyCounts = {
    gemini:     parseKeys(process.env.GEMINI_API_KEY).length,
    groq:       parseKeys(process.env.GROQ_API_KEY).length,
    cerebras:   parseKeys(process.env.CEREBRAS_API_KEY).length,
    openrouter: parseKeys(process.env.OPENROUTER_API_KEY).length,
    mistral:    parseKeys(process.env.MISTRAL_API_KEY).length,
  };
  _cachedAt = Date.now();
  return _cachedKeyCounts;
}

function getDailyPool(forVision = false) {
  const counts = getKeyCounts();
  let pool = 0;
  for (const [name, cfg] of Object.entries(PROVIDERS)) {
    const capacity = forVision ? cfg.daily_vision : cfg.daily_text;
    pool += counts[name] * capacity;
  }
  return pool;
}

// ── Owner user_id cache (1 hod TTL) ────────────────────────────────
let _cachedOwnerId   = null;
let _ownerCachedAt   = 0;
const OWNER_CACHE_TTL = 60 * 60 * 1000;

async function getOwnerId() {
  if (_cachedOwnerId && Date.now() - _ownerCachedAt < OWNER_CACHE_TTL) return _cachedOwnerId;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(OWNER_EMAIL)}&select=id&limit=1`,
      { headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}` } }
    );
    const rows = await r.json().catch(() => []);
    if (Array.isArray(rows) && rows[0]?.id) {
      _cachedOwnerId = rows[0].id;
      _ownerCachedAt = Date.now();
      return _cachedOwnerId;
    }
  } catch (e) {
    console.warn('[admin-notify] getOwnerId failed:', e.message);
  }
  return null;
}

// ── Active users count (15s cache) ─────────────────────────────────
let _cachedActiveUsers = { count: 0, date: '', at: 0 };
const ACTIVE_CACHE_TTL = 15_000;

async function getActiveUsersToday(today) {
  if (_cachedActiveUsers.date === today &&
      Date.now() - _cachedActiveUsers.at < ACTIVE_CACHE_TTL) {
    return _cachedActiveUsers.count;
  }
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/groq_usage?date=eq.${today}&select=user_id`,
      { headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${SUPABASE_ANON}` } }
    );
    const rows = await r.json().catch(() => []);
    const count = new Set((rows || []).map(r => r.user_id)).size;
    _cachedActiveUsers = { count, date: today, at: Date.now() };
    return count;
  } catch (e) {
    console.warn('[limits] getActiveUsersToday failed:', e.message);
    return 1;
  }
}

// ── Dynamic limit calculator ───────────────────────────────────────
async function calculateDynamicLimit(usageType, today) {
  const config = LIMITS_CONFIG[usageType] || LIMITS_CONFIG.search;
  const pool = getDailyPool(config.vision);

  if (pool === 0) {
    return { limit: 0, pool: 0, activeUsers: 0, share: config.share };
  }

  const activeUsers = await getActiveUsersToday(today);
  const buffer      = Math.max(1, Math.ceil(activeUsers * ACTIVE_USERS_BUFFER_PCT));
  const usable      = pool * config.share;
  const fairShare   = Math.floor(usable / Math.max(1, activeUsers + buffer));
  const limit       = Math.max(config.min, Math.min(config.max, fairShare));

  return { limit, pool, activeUsers, share: config.share };
}

// ── Admin notifikace (dedupe per den per typ) ──────────────────────
async function notifyAdmin({ alertType, title, body, metadata }) {
  const SVC = process.env.SUPABASE_SERVICE_KEY;
  if (!SVC) {
    console.warn('[admin-notify] SUPABASE_SERVICE_KEY není nastavený');
    return false;
  }
  const ownerId = await getOwnerId();
  if (!ownerId) return false;

  const today = new Date().toISOString().slice(0, 10);
  const dedupeKey = `${alertType}:${metadata?.provider || 'global'}:${today}`;

  try {
    const exRes = await fetch(
      `${SUPABASE_URL}/rest/v1/notifications?user_id=eq.${ownerId}` +
      `&type=eq.${alertType}` +
      `&metadata->>dedupe_key=eq.${encodeURIComponent(dedupeKey)}` +
      `&select=id&limit=1`,
      { headers: { 'apikey': SVC, 'Authorization': `Bearer ${SVC}` } }
    );
    const existing = await exRes.json().catch(() => []);
    if (Array.isArray(existing) && existing.length > 0) {
      console.log(`[admin-notify] dedupe hit pro ${dedupeKey}`);
      return false;
    }

    const insRes = await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
      method: 'POST',
      headers: {
        'apikey': SVC,
        'Authorization': `Bearer ${SVC}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        user_id:  ownerId,
        type:     alertType,
        title,
        body,
        link:     '/profile.html#ai-providers',
        metadata: { ...metadata, dedupe_key: dedupeKey, ts: new Date().toISOString() },
      }),
    });
    if (insRes.ok) {
      console.log(`[admin-notify] ✓ ${alertType}`);
      return true;
    }
    console.warn(`[admin-notify] insert failed: ${insRes.status}`);
  } catch (e) {
    console.warn('[admin-notify] error:', e.message);
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════
//  HANDLER
// ═══════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    // Sub-routes podle query stringu (router pattern — uvolňuje funkční slot na Vercelu)
    if (req.query.action === 'models') return handleModelsInfo(req, res);
    if (req.query?.action === 'get-key') return handleGetKey(req, res);
    if (req.query?.info   === 'usage')   return handleUsageInfo(req, res);
    return res.status(200).json({ ok: true, ts: Date.now() });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Použij POST' });

  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > MAX_BODY) return res.status(413).json({ error: 'Request příliš velký' });

  const body = req.body;
  if (!body?.messages) return res.status(400).json({ error: 'Chybí messages' });

  const providerName = String(body.provider || 'gemini').toLowerCase();
  const provider = PROVIDERS[providerName];
  if (!provider) {
    return res.status(400).json({
      error:           `Neznámý provider: ${providerName}`,
      validProviders:  Object.keys(PROVIDERS),
    });
  }

  const safeBody = {
    model:       body.model || provider.defaultModel,
    messages:    body.messages,
    temperature: body.temperature ?? 0.1,
    max_tokens:  Math.min(body.max_tokens ?? 800, 4000),
    stream:      false,
  };
  if (body.response_format && typeof body.response_format === 'object') {
    safeBody.response_format = body.response_format;
  }

  const personalKey = (
    req.headers['x-ai-key'] ||
    (providerName === 'groq' ? req.headers['x-groq-key'] : '') ||
    ''
  ).trim();

  if (personalKey.length > 10) {
    // BEZPEČNOST: dřív se tenhle blok vykonal BEZ ověření tokenu, takže
    // /api/groq fungovala jako otevřená AI proxy pro kohokoli na internetu
    // (stačilo poslat hlavičku X-AI-Key). Šlo o cizí provoz na tvém Vercelu
    // bez logování i bez limitů. Teď musí být uživatel přihlášený i tady.
    const tokPersonal = (req.headers.authorization || '').replace('Bearer ', '').trim()
                      || (req.query.t || '').trim();
    if (!tokPersonal) {
      return res.status(401).json({ error: 'Nejsi přihlášen', code: 'NO_AUTH' });
    }
    try {
      const uRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${tokPersonal}` },
        signal: AbortSignal.timeout(6000),
      });
      if (!uRes.ok) {
        return res.status(401).json({ error: 'Neplatný token', code: 'BAD_TOKEN' });
      }
    } catch (e) {
      return res.status(503).json({ error: 'Ověření se nezdařilo, zkus to znovu' });
    }
    return proxyToProvider(res, req, provider, providerName, personalKey, safeBody);
  }

  const sharedKeys = parseKeys(process.env[provider.envKey]);
  if (!sharedKeys.length) {
    // Pokud Gemini klíč chybí → automaticky fallback na Groq
    if (providerName === 'gemini') {
      const groqProvider = PROVIDERS['groq'];
      const groqKeys = parseKeys(process.env[groqProvider.envKey]);
      if (groqKeys.length) {
        const fallbackBody = { ...safeBody, model: groqProvider.defaultModel };
        return proxyToProviderWithRotation(res, req, groqProvider, 'groq', groqKeys, fallbackBody);
      }
    }
    return res.status(503).json({
      error:    `${provider.envKey} env var není na serveru nastaven.`,
      code:     'NO_SHARED_KEY',
      provider: providerName,
      hint:     `Admin musí přidat ${provider.envKey} ve Vercel env vars, nebo uživatel musí mít vlastní klíč.`,
    });
  }

  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Nejsi přihlášen.', code: 'NO_AUTH' });

  let userEmail, userId;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}` },
    });
    if (!r.ok) throw new Error('bad token');
    const u = await r.json();
    userEmail = u?.email || '';
    userId    = u?.id    || '';
  } catch {
    return res.status(401).json({ error: 'Neplatný token.', code: 'BAD_TOKEN' });
  }

  // ── VIP tier detection ──────────────────────────────────────────
  // 3 vrstvy: lifetime (žádný limit) / regular (80% kvóta) / free (20+5/den).
  const tier = await getUserVipTier(userId, userEmail);

  // Lifetime = whitelist + prvních 10 reálných uživatelů → bez limitu
  if (tier === 'lifetime') {
    return proxyToProviderWithRotation(res, req, provider, providerName, sharedKeys, safeBody);
  }

  const usageType = body.usage_type || 'search';
  const today     = new Date().toISOString().slice(0, 10);

  // Spočítej fair-share limit (lifetime tier limit) — to je 100% pro reference
  const { limit: lifetimeLimit, pool, activeUsers, share } = await calculateDynamicLimit(usageType, today);

  // Tier multipliery:
  //   regular VIP (first_100/standard/extended/manual) = 80% lifetime kvóty
  //   free        = pevné minimum z LIMITS_CONFIG (20 search / 5 fake) — neovlivněno poolem
  let limit;
  if (tier === 'regular') {
    limit = Math.max(LIMITS_CONFIG[usageType]?.min || 20, Math.floor(lifetimeLimit * 0.80));
  } else {
    // free — pevné denní minimum
    limit = LIMITS_CONFIG[usageType]?.min || (usageType === 'fake' ? 5 : 20);
  }

  const usageRes = await fetch(
    `${SUPABASE_URL}/rest/v1/groq_usage?user_id=eq.${userId}&date=eq.${today}&select=id,search_count,fake_count`,
    { headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}` } }
  );
  const usageRows = await usageRes.json().catch(() => []);
  const usage     = Array.isArray(usageRows) ? usageRows[0] : null;
  const currentCount = usage ? (usageType === 'fake' ? usage.fake_count : usage.search_count) : 0;

  if (currentCount >= limit) {
    const tierLabel = tier === 'regular' ? 'VIP' : 'free';
    const upgrade = tier === 'free'
      ? 'Zaregistruj se a získej 14 dní VIP zdarma (5× větší limit). Nebo přidej vlastní AI klíč v profilu pro neomezené použití.'
      : 'Pro neomezené hledání přidej vlastní klíč v profilu nebo pozvi 1 kámoše a získej +30 dní VIP zdarma.';
    return res.status(429).json({
      error: `Denní limit vyčerpán (${currentCount}/${limit}, ${tierLabel}). ${upgrade}`,
      code:  'RATE_LIMITED',
      tier,
      limit, used: currentCount, remaining: 0,
      reset: 'půlnoc CET',
      providerHint: `Klíč zdarma získáš na ${provider.signupHost}`,
    });
  }

  const result = await proxyToProviderWithRotation(
    res, req, provider, providerName, sharedKeys, safeBody, true
  );

  // FIX: s returnMeta=true rotace sama neodesílá odpověď. Když všechny
  // sdílené klíče selhaly, request dřív zůstal viset až do Vercel timeoutu
  // (klient viděl 504 / nekonečné načítání). Teď vždy odpovíme.
  if (!result?.ok) {
    if (res.headersSent) return;
    const st = result?.status || 502;
    return res.status(st).json({
      error: result?.error
        || `Všechny sdílené klíče pro ${providerName} selhaly (HTTP ${st}). Zkus to za chvíli, nebo si v Nastavení přidej vlastní klíč.`,
      code:  st === 429 ? 'RATE_LIMITED' : 'PROVIDER_FAILED',
      provider: providerName,
      providerHint: `Klíč zdarma získáš na ${provider.signupHost}`,
    });
  }

  if (result?.ok) {
    const patch = usageType === 'fake'
      ? { fake_count:   (usage?.fake_count   || 0) + 1 }
      : { search_count: (usage?.search_count || 0) + 1 };

    if (usage?.id) {
      await fetch(`${SUPABASE_URL}/rest/v1/groq_usage?id=eq.${usage.id}`, {
        method: 'PATCH',
        headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify(patch),
      }).catch(() => {});
    } else {
      await fetch(`${SUPABASE_URL}/rest/v1/groq_usage`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ user_id: userId, date: today, search_count: 0, fake_count: 0, ...patch }),
      }).catch(() => {});
    }

    if (activeUsers > ACTIVE_USERS_WARNING_THRES) {
      const usagePct = currentCount / Math.max(1, pool * share);
      if (usagePct > (1 - POOL_WARNING_THRESHOLD)) {
        notifyAdmin({
          alertType: 'admin_pool_low',
          title:     `⚠️ AI pool ${usageType} klesl pod 30 %`,
          body:      `Aktivních userů dnes: ${activeUsers}, pool: ${pool} req/den. Zvážuj přidání klíčů.`,
          metadata:  { provider: 'pool', usageType, activeUsers, pool, share },
        }).catch(() => {});
      }
      if (limit < PER_USER_CRITICAL) {
        notifyAdmin({
          alertType: 'admin_per_user_low',
          title:     `📈 Limit per user pro ${usageType} klesl na ${limit}`,
          body:      `Aktivních userů: ${activeUsers}. Per-user limit je již na minimu — uživatelé budou frustrovaní. Přidej klíče.`,
          metadata:  { provider: 'pool', usageType, activeUsers, limit },
        }).catch(() => {});
      }
    }
  }
}

// ── GET ?action=get-key handler ───────────────────────────────────
// Sloučeno z bývalého /api/groq-key.js endpointu — uvolnili jsme tím 1 slot
// z 12 Vercel serverless funkcí. Stejné chování jako dřív, jen jiná URL.
//
// Volá se z mobile.html (Electron flow) přes:
//   GET /api/groq?action=get-key&t=<supabase_token>
// Vrací JSON s: groq_key, cerebras_key, openrouter_key, source, vip
// ── GET ?action=models — co poskytovatelé právě nabízejí ──────────
// Rychlá diagnostika: uvidíš, které modely jsou živé a co by se
// použilo místo zrušeného. Hodí se, až zase něco vypnou.
async function handleModelsInfo(req, res) {
  const out = {};
  for (const [name, p] of Object.entries(PROVIDERS)) {
    const keys = parseKeys(process.env[p.envKey]);
    if (!keys.length) { out[name] = { klicu: 0, modely: null }; continue; }
    const zive = await ziskejZiveModely(p, name, keys[0]);
    const text   = await vyresModel(p, name, keys[0], null, false);
    const vision = p.vision ? await vyresModel(p, name, keys[0], null, true) : null;
    out[name] = {
      klicu:       keys.length,
      pocetModelu: zive ? zive.size : null,
      proText:     text.model,
      proVision:   vision ? vision.model : null,
      modely:      zive ? [...zive].sort().slice(0, 40) : null,
    };
  }
  return res.status(200).json({ ts: new Date().toISOString(), providers: out });
}

async function handleGetKey(req, res) {
  const token = req.query.t || (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Chybí token' });

  try {
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}` }
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Neplatný token' });
    const user = await userRes.json();
    if (!user?.id) return res.status(401).json({ error: 'Neplatný token' });

    const userEmail = user.email || '';
    const vip = await isVipDb(userEmail);

    // 1. Vlastní klíče uživatele → priorita (načti všechny 3 providery)
    const keyRes = await fetch(
      `${SUPABASE_URL}/rest/v1/user_api_keys?user_id=eq.${user.id}&select=groq_key,groq_enabled,cerebras_key,openrouter_key`,
      { headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}` } }
    );
    const rows = await keyRes.json();
    const row  = Array.isArray(rows) ? rows[0] : null;

    const hasPersonal = row && ((row.groq_key && row.groq_enabled !== false) || row.cerebras_key || row.openrouter_key);

    if (hasPersonal) {
      return res.status(200).json({
        groq_key:       (row.groq_enabled !== false) ? (row.groq_key || null) : null,
        cerebras_key:   row.cerebras_key   || null,
        openrouter_key: row.openrouter_key || null,
        // Legacy kompatibilita pro starší klienty:
        key:            (row.groq_enabled !== false) ? (row.groq_key || null) : null,
        enabled:        true,
        source:         'personal',
        vip,
      });
    }

    // 2. BEZ vlastního klíče → klient jede přes sdílenou proxy.
    //
    // BEZPEČNOST: dřív se tady vracely SDÍLENÉ serverové klíče
    // (process.env.GROQ_API_KEY) každému přihlášenému uživateli.
    // Klíče pak putovaly do prohlížeče, kde je kdokoli viděl
    // v DevTools → Network, a šlo je použít mimo aplikaci.
    //
    // Server teď neposílá žádný klíč, který nepatří uživateli.
    // Klient s odpovědí `use_proxy: true` posílá AI požadavky
    // na POST /api/groq, kde se klíč doplní až na serveru —
    // mobile.html tuhle cestu už umí (useSharedProxy).
    const sdileneKDispozici = (process.env.GROQ_API_KEY || '')
      .split(',').map(k => k.trim()).filter(k => k.length > 10).length;

    return res.status(200).json({
      groq_key:       null,
      cerebras_key:   null,
      openrouter_key: null,
      key:            null,
      enabled:        sdileneKDispozici > 0,
      use_proxy:      sdileneKDispozici > 0,
      proxy_url:      '/api/groq',
      source:         sdileneKDispozici > 0 ? 'proxy' : 'none',
      vip,
    });

  } catch (err) {
    console.error('[groq get-key]', err);
    return res.status(500).json({ error: 'Interní chyba' });
  }
}

// ── GET ?info=usage handler ───────────────────────────────────────
async function handleUsageInfo(req, res) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Nejsi přihlášen', code: 'NO_AUTH' });

  let userEmail, userId;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}` },
    });
    if (!r.ok) throw new Error('bad token');
    const u = await r.json();
    userEmail = (u?.email || '').toLowerCase();
    userId    = u?.id || '';
  } catch {
    return res.status(401).json({ error: 'Neplatný token', code: 'BAD_TOKEN' });
  }

  const tier = await getUserVipTier(userId, userEmail);
  if (tier === 'lifetime') {
    return res.status(200).json({
      isVip: true, isOwner: userEmail === OWNER_EMAIL,
      tier: 'lifetime',
      message: 'Bez limitu (Lifetime VIP)',
    });
  }

  const today = new Date().toISOString().slice(0, 10);

  const [searchInfo, fakeInfo, usageRows] = await Promise.all([
    calculateDynamicLimit('search', today),
    calculateDynamicLimit('fake',   today),
    fetch(
      `${SUPABASE_URL}/rest/v1/groq_usage?user_id=eq.${userId}&date=eq.${today}&select=search_count,fake_count`,
      { headers: { 'apikey': SUPABASE_ANON, 'Authorization': `Bearer ${token}` } }
    ).then(r => r.json()).catch(() => []),
  ]);

  const usage = Array.isArray(usageRows) ? usageRows[0] : null;
  const used  = { search: usage?.search_count || 0, fake: usage?.fake_count || 0 };

  // Aplikuj tier multiplier na limit (regular = 80%, free = pevné minimum)
  const applyTier = (info, type) => {
    if (tier === 'regular') {
      return Math.max(LIMITS_CONFIG[type]?.min || 20, Math.floor(info.limit * 0.80));
    }
    // free
    return LIMITS_CONFIG[type]?.min || (type === 'fake' ? 5 : 20);
  };

  const searchLimit = applyTier(searchInfo, 'search');
  const fakeLimit   = applyTier(fakeInfo,   'fake');

  return res.status(200).json({
    isVip:       tier !== 'free',
    isOwner:     false,
    tier,         // 'regular' nebo 'free'
    today,
    activeUsers: searchInfo.activeUsers,
    search: {
      limit:     searchLimit,
      used:      used.search,
      remaining: Math.max(0, searchLimit - used.search),
      pool:      searchInfo.pool,
    },
    fake: {
      limit:     fakeLimit,
      used:      used.fake,
      remaining: Math.max(0, fakeLimit - used.fake),
      pool:      fakeInfo.pool,
    },
    keysCount: getKeyCounts(),
  });
}

// ── Single-key proxy (osobní klíč) ─────────────────────────────────
async function proxyToProvider(res, req, provider, providerName, key, body, returnMeta = false) {
  try {
    const headers = {
      'Authorization': `Bearer ${key}`,
      'Content-Type':  'application/json',
    };
    if (provider.extraHeaders) Object.assign(headers, provider.extraHeaders(req));

    // Zjisti, jestli požadovaný model u poskytovatele ještě existuje.
    // Vision poznáme podle toho, že zpráva obsahuje obrázek.
    const jeVision = JSON.stringify(body?.messages || '').includes('image_url');
    let telo = body;
    const reseni = await vyresModel(provider, providerName, key, body?.model, jeVision);
    if (reseni.zmeneno) telo = { ...body, model: reseni.model };

    let r = await fetch(provider.endpoint, {
      method: 'POST', headers, body: JSON.stringify(telo),
    });
    let data = await r.json();

    // Poskytovatel hlásí neexistující model → seznam byl zastaralý.
    // Zahoď cache, načti znovu a zkus to ještě jednou.
    if (!r.ok && jeChybaModelu(r.status, data)) {
      zapomenModely(providerName);
      const znovu = await vyresModel(provider, providerName, key, null, jeVision);
      if (znovu.model && znovu.model !== telo.model) {
        console.warn(`[modely] ${providerName}: opakuji s "${znovu.model}"`);
        r = await fetch(provider.endpoint, {
          method: 'POST', headers,
          body: JSON.stringify({ ...telo, model: znovu.model }),
        });
        data = await r.json();
      }
    }

    if (!r.ok) {
      if (!returnMeta) {
        res.status(r.status).json({
          error:    data?.error?.message || `${providerName} error`,
          status:   r.status,
          provider: providerName,
        });
      }
      return { ok: false };
    }
    res.status(200).json(data);
    return { ok: true };
  } catch (err) {
    if (!returnMeta) {
      res.status(502).json({
        error:    `Nepodařilo se spojit s ${providerName}: ${err.message}`,
        provider: providerName,
      });
    }
    return { ok: false };
  }
}

// ── Multi-key rotation (sdílené klíče) ─────────────────────────────
// Při 401/429 → další klíč. Po vyčerpání všech → admin alert.
async function proxyToProviderWithRotation(res, req, provider, providerName, keys, body, returnMeta = false) {
  let lastErrorStatus  = 502;
  let lastErrorMessage = `Žádný ${providerName} klíč nefunguje`;
  let exhaustedByLimit = false;

  const jeVision = JSON.stringify(body?.messages || '').includes('image_url');

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    try {
      const headers = {
        'Authorization': `Bearer ${key}`,
        'Content-Type':  'application/json',
      };
      if (provider.extraHeaders) Object.assign(headers, provider.extraHeaders(req));

      // Ověř model proti živému seznamu poskytovatele (viz vyresModel).
      // Bez toho by zrušený model shodil postupně všechny klíče v rotaci.
      let telo = body;
      const reseni = await vyresModel(provider, providerName, key, body?.model, jeVision);
      if (reseni.zmeneno) telo = { ...body, model: reseni.model };

      let r = await fetch(provider.endpoint, {
        method: 'POST', headers, body: JSON.stringify(telo),
      });

      // Model mezitím zmizel → obnov seznam a zkus jednou znovu
      if (!r.ok && r.status !== 401 && r.status !== 429) {
        const peek = await r.clone().json().catch(() => ({}));
        if (jeChybaModelu(r.status, peek)) {
          zapomenModely(providerName);
          const znovu = await vyresModel(provider, providerName, key, null, jeVision);
          if (znovu.model && znovu.model !== telo.model) {
            console.warn(`[modely] ${providerName}: opakuji s "${znovu.model}"`);
            r = await fetch(provider.endpoint, {
              method: 'POST', headers,
              body: JSON.stringify({ ...telo, model: znovu.model }),
            });
          }
        }
      }

      if (r.status === 401 || r.status === 429) {
        const errData = await r.json().catch(() => ({}));
        lastErrorStatus  = r.status;
        lastErrorMessage = errData?.error?.message || `HTTP ${r.status}`;
        exhaustedByLimit = true;
        console.warn(`[${providerName}] Klíč #${i+1}/${keys.length}: ${lastErrorStatus} — další`);
        continue;
      }

      const data = await r.json();
      if (!r.ok) {
        if (!returnMeta) {
          res.status(r.status).json({
            error:    data?.error?.message || `${providerName} error`,
            status:   r.status,
            provider: providerName,
          });
        }
        return { ok: false, status: r.status, error: data?.error?.message || `${providerName} error` };
      }
      console.log(`[${providerName}] ✓ klíč #${i+1}/${keys.length}`);
      res.status(200).json(data);
      return { ok: true };
    } catch (err) {
      lastErrorMessage = err.message;
      console.warn(`[${providerName}] Klíč #${i+1}/${keys.length}: ${err.message} — další`);
    }
  }

  if (exhaustedByLimit) {
    notifyAdmin({
      alertType: 'admin_keys_exhausted',
      title:     `🔑 ${providerName.toUpperCase()} klíče dnes vyčerpány`,
      body:      `Všech ${keys.length} ${providerName} klíčů dosáhlo rate limitu nebo selhalo (${lastErrorStatus}). Přidej nový na ${provider.signupHost} a doplň do Vercel env ${provider.envKey}.`,
      metadata:  { provider: providerName, keysCount: keys.length, lastError: lastErrorMessage },
    }).catch(() => {});
  }

  if (!returnMeta) {
    res.status(lastErrorStatus).json({
      error:         `Všech ${keys.length} ${providerName} klíčů selhalo: ${lastErrorMessage}`,
      code:          lastErrorStatus === 429 ? 'ALL_KEYS_RATE_LIMITED' : 'ALL_KEYS_FAILED',
      provider:      providerName,
      keysAvailable: keys.length,
    });
  }
  return {
    ok:     false,
    status: lastErrorStatus,
    error:  `Všech ${keys.length} ${providerName} klíčů selhalo: ${lastErrorMessage}`,
  };
}
