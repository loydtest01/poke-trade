// ═══════════════════════════════════════════════════════════════════
//  groq-client.js – Multi-provider AI modul pro PokéTrade web
//  Vyžaduje: app.js (supabaseRequest + getUser)
//
//  HISTORIE:
//    v1: Jen Groq, pole klíčů, rotace při 429
//    v2: Multi-provider (Groq + Cerebras + OpenRouter + Mistral)
//        Zpětně kompatibilní API: window.GroqClient funguje jako před
//        + nový alias window.AIClient
//
//        DeepSeek schéma (deepseek_key v user_api_keys) ponecháno pro načtení
//        starých klíčů uživatelů, ale modul je nikdy nepoužívá k volání.
//
//  BEZPEČNOST:
//    - API klíče načteny ze Supabase (user_api_keys), chráněno RLS
//    - Klíče drženy jen v paměti (never localStorage)
//    - Každý uživatel má jen své klíče
//
//  ROTACE:
//    - Při 429 (rate limit) → další klíč stejného providera
//    - Při vyčerpání všech klíčů jednoho providera → další provider v řetězci
//    - Při vyčerpání všech osobních klíčů → fallback na sdílený serverový
//      proxy /api/groq?provider=X (VIP bez limitu, non-VIP 20/10 denně)
//    - Chain default: cerebras → groq → openrouter → mistral
//
//  VISION:
//    - Pro CJK karty automaticky preferuje OpenRouter Qwen (nejlepší CJK)
//    - Ostatní providery jako fallback
// ═══════════════════════════════════════════════════════════════════

(function (global) {
  'use strict';

  // ── Konfigurace providerů ────────────────────────────────────────
  const PROVIDERS = {
    groq: {
      name:         'Groq',
      endpoint:     'https://api.groq.com/openai/v1/chat/completions',
      validateUrl:  'https://api.groq.com/openai/v1/models',
      textModel:    'llama-3.3-70b-versatile',
      visionModel:  'meta-llama/llama-4-scout-17b-16e-instruct',
    },
    cerebras: {
      name:         'Cerebras',
      endpoint:     'https://api.cerebras.ai/v1/chat/completions',
      validateUrl:  'https://api.cerebras.ai/v1/models',
      // Aktuální modely Cerebras public API (duben 2026):
      // Production: llama3.1-8b, gpt-oss-120b
      // llama-3.3-70b a llama-4-scout-17b-16e-instruct na shared API NEEXISTUJÍ → 404
      textModel:    'gpt-oss-120b',
      visionModel:  null,  // Cerebras nepodporuje vision/multimodal
    },
    openrouter: {
      name:             'OpenRouter',
      endpoint:         'https://openrouter.ai/api/v1/chat/completions',
      validateUrl:      'https://openrouter.ai/api/v1/models',
      textModel:        'meta-llama/llama-3.3-70b-instruct:free',
      visionModel:      'nvidia/nemotron-nano-2-vl-12b:free',  // OCR/multi-image, CJK (duben 2026)
      visionFallbacks:  [
        'baidu/qianfan-ocr-fast:free',                   // OCR specializovaný, výborný pro CN/JP text
        'google/gemma-4-31b-it:free',                    // Gemma 4 vision, text+image
        'google/gemma-4-26b-a4b-it:free',                // Gemma 4 MoE vision (duben 2026)
        'google/gemma-3-27b-it:free',                    // Gemma 3 vision fallback
        'meta-llama/llama-3.2-11b-vision-instruct:free', // poslední záchrana
      ],
    },
    deepseek: {
      // ZACHOVÁNO pro zpětnou kompatibilitu — pokud má někdo uložený starý klíč
      // v user_api_keys.deepseek_key, modul ho načte ale nikdy nepoužije
      // (nedáme do DEFAULT_CHAIN). Lze v budoucnu úplně vypnout.
      name:         'DeepSeek',
      endpoint:     'https://api.deepseek.com/chat/completions',
      validateUrl:  'https://api.deepseek.com/models',
      textModel:    'deepseek-chat',
      visionModel:  null,
      deprecated:   true,
    },
    mistral: {
      name:         'Mistral',
      endpoint:     'https://api.mistral.ai/v1/chat/completions',
      validateUrl:  'https://api.mistral.ai/v1/models',
      textModel:    'mistral-small-latest',
      visionModel:  'pixtral-12b-2409',  // Mistral Pixtral vision
    },
    xai: {
      name:             'xAI (Grok)',
      endpoint:         'https://api.x.ai/v1/chat/completions',
      validateUrl:      'https://api.x.ai/v1/models',
      textModel:        'grok-3-mini',
      // grok-4 je nejschopnější xAI model pro vision (obrázky). Jako fallback
      // grok-2-vision-1212 – starší dedicated vision model.
      // xAI podporuje POUZE jpg/jpeg a png — webp automaticky konvertujeme níže.
      visionModel:      'grok-4',
      visionFallbacks:  ['grok-2-vision-1212'],
      requiresJpeg:     true,   // xAI nepodporuje webp → konvertuj na jpeg
    },
    gemini: {
      name:           'Google Gemini',
      // Gemini používá jiný URL formát — endpointBase slouží jako základ,
      // skutečný URL se sestaví v _geminiChat(): base/model:generateContent?key=KEY
      endpointBase:   'https://generativelanguage.googleapis.com/v1/models',
      validateUrl:    null,   // Gemini nemá /models endpoint bez klíče — validate přes chat
      textModel:      'gemini-1.5-flash-latest',
      visionModel:    'gemini-1.5-flash-latest',  // stejný model dělá text i vision
      isGemini:       true,   // příznak pro speciální API handling
      // Free tier: 15 req/min, 100 req/den, 2 img/min — žádná platební karta
    },
  };

  // DEFAULT_CHAIN: Cerebras jde první.
  // Důvod: Groq free tier má jen 500k tokenů/den, což vision rychle vyčerpá
  // (každý obrázek ~6-10k tokenů → po 50-80 skenech je Groq mimo pro celý den).
  // Cerebras má 1M tokenů/den/klíč a je srovnatelně rychlý.
  // Pro CJK karty se OpenRouter (Qwen) stále posouvá na první místo.
  // Mistral je poslední — má vlastní specializovaný OCR endpoint pro CJK
  // (volá se zvlášť, ne přes chat() funkci).
  const DEFAULT_CHAIN = ['cerebras', 'groq', 'openrouter', 'mistral', 'xai', 'gemini'];

  // Providery, které mohou padnout zpět na sdílený serverový proxy (/api/groq?provider=...)
  // když uživatel nemá vlastní klíč. Groq už má přímou podporu v /api/groq.
  const SHARED_FALLBACK_PROVIDERS = ['groq', 'cerebras', 'openrouter', 'mistral', 'xai'];

  // ── Stav modulu ──────────────────────────────────────────────────
  const _state = {
    keys: {        // pole klíčů per provider (osobní klíče uživatele)
      groq:       [],
      cerebras:   [],
      openrouter: [],
      deepseek:   [],   // ponecháno pro načtení starých klíčů, ale nepoužívá se
      mistral:    [],
      xai:        [],
      gemini:     [],
    },
    keyIdx: {      // aktuální aktivní klíč per provider
      groq:       0,
      cerebras:   0,
      openrouter: 0,
      deepseek:   0,
      mistral:    0,
      xai:        0,
      gemini:     0,
    },
    model:           'meta-llama/llama-4-scout-17b-16e-instruct',  // user preferred text model (kompat)
    enabled:         false,
    loaded:          false,
    xaiPreferred:    false,  // xAI jde jako první v chainu (uloženo v localStorage)
    geminiPreferred: false,  // Gemini jde jako první v chainu (uloženo v localStorage)
  };

  // ── GROQ_MODELS (zpětná kompatibilita) ────────────────────────────
  const GROQ_MODELS = [
    { id: 'meta-llama/llama-4-scout-17b-16e-instruct',       label: 'Llama 4 Scout 17B (vision, doporučeno)' },
    { id: 'meta-llama/llama-4-maverick-17b-128e-instruct',   label: 'Llama 4 Maverick 17B (vision)' },
    { id: 'llama-3.3-70b-versatile',                         label: 'Llama 3.3 70B (text)' },
    { id: 'llama-3.1-8b-instant',                            label: 'Llama 3.1 8B (rychlý, text)' },
  ];

  // ── Interní REST helper ──────────────────────────────────────────
  function _req(path, method = 'GET', body = null) {
    const token = localStorage.getItem('sb_token');
    if (typeof supabaseRequest === 'function') {
      return supabaseRequest(path, method, body, token);
    }
    throw new Error('[AI] supabaseRequest není dostupný – načti app.js před groq-client.js');
  }

  // Rozparsovat "key1,key2,key3" nebo null → array
  function _parseKeys(str) {
    if (!str) return [];
    return String(str).split(',').map(k => k.trim()).filter(k => k.length > 10);
  }

  // Detekuj vision request (obrázek v messages)
  function _isVision(messages) {
    return Array.isArray(messages) && messages.some(m =>
      Array.isArray(m.content) && m.content.some(c => c.type === 'image_url')
    );
  }

  // Detekuj CJK obsah ve zprávě (vizuální karta z Asie → preferuj Qwen)
  function _hasCjkContext(messages) {
    try {
      const text = JSON.stringify(messages);
      return /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(text);
    } catch { return false; }
  }

  // Konvertuj webp obrázky na jpeg pro providery s requiresJpeg=true (xAI)
  // Funguje jen v browser kontextu (canvas API). Na serveru se přeskočí.
  async function _convertImagesForProvider(messages, provider) {
    if (!provider.requiresJpeg) return messages;
    if (typeof document === 'undefined' || typeof HTMLCanvasElement === 'undefined') return messages;

    const converted = JSON.parse(JSON.stringify(messages));  // deep clone
    for (const msg of converted) {
      if (!Array.isArray(msg.content)) continue;
      for (const part of msg.content) {
        if (part.type !== 'image_url') continue;
        const url = part.image_url?.url || '';
        // Pokud je to data URL s webp → konvertuj na jpeg přes canvas
        if (url.startsWith('data:image/webp')) {
          try {
            const jpegUrl = await new Promise((resolve, reject) => {
              const img = new Image();
              img.onload = () => {
                const canvas  = document.createElement('canvas');
                canvas.width  = img.naturalWidth;
                canvas.height = img.naturalHeight;
                canvas.getContext('2d').drawImage(img, 0, 0);
                resolve(canvas.toDataURL('image/jpeg', 0.92));
              };
              img.onerror = reject;
              img.src = url;
            });
            part.image_url.url = jpegUrl;
            console.log('[AI] webp → jpeg konverze pro xAI (canvas)');
          } catch (convErr) {
            console.warn('[AI] webp konverze selhala, zkouším bez konverze:', convErr);
          }
        }
      }
    }
    return converted;
  }

  // Vrať celkový počet klíčů napříč všemi providery
  function _totalKeys() {
    return Object.values(_state.keys).reduce((sum, arr) => sum + arr.length, 0);
  }

  // ── Načti všechny klíče ze Supabase ─────────────────────────────
  async function loadKey() {
    const user = typeof getUser === 'function' ? getUser() : null;
    if (!user) { _state.loaded = true; return false; }

    // Resilient načtení: pokud mistral_key sloupec ještě neexistuje (migrace
    // nebyla spuštěna), fallback bez něj. Tím modul funguje i před migrací.
    const trySelect = async (cols) => {
      try {
        const res = await _req(`rest/v1/user_api_keys?user_id=eq.${user.id}&select=${cols}`);
        if (res && (res.code === '42703' || (res.message || '').includes('column'))) return null;
        return Array.isArray(res) ? res[0] : null;
      } catch (e) {
        return null;
      }
    };

    try {
      let data = await trySelect('groq_key,groq_model,groq_enabled,cerebras_key,openrouter_key,deepseek_key,mistral_key,xai_key,gemini_key');
      if (data === null) {
        // Zkus bez gemini_key (migrace zatím nespuštěna)
        data = await trySelect('groq_key,groq_model,groq_enabled,cerebras_key,openrouter_key,deepseek_key,mistral_key,xai_key');
      }
      if (data === null) {
        console.warn('[AI] Sloupec mistral_key/xai_key neexistuje — spusť migrace! Fallback bez nich.');
        data = await trySelect('groq_key,groq_model,groq_enabled,cerebras_key,openrouter_key,deepseek_key');
      }

      if (!data) {
        _state.loaded = true;
        _state.enabled = false;
        return false;
      }

      _state.keys.groq       = _parseKeys(data.groq_key);
      _state.keys.cerebras   = _parseKeys(data.cerebras_key);
      _state.keys.openrouter = _parseKeys(data.openrouter_key);
      _state.keys.deepseek   = _parseKeys(data.deepseek_key);
      _state.keys.mistral    = _parseKeys(data.mistral_key);   // undefined → []
      _state.keys.xai        = _parseKeys(data.xai_key);       // undefined → []
      _state.keys.gemini     = _parseKeys(data.gemini_key);    // undefined → []

      _state.model   = data.groq_model || 'meta-llama/llama-4-scout-17b-16e-instruct';
      _state.enabled = (data.groq_enabled !== false);
      _state.loaded  = true;

      // Načti preference z localStorage
      _state.xaiPreferred    = localStorage.getItem('xai_preferred')    === '1';
      _state.geminiPreferred = localStorage.getItem('gemini_preferred') === '1';

      const counts = Object.entries(_state.keys)
        .filter(([, arr]) => arr.length)
        .map(([name, arr]) => `${name}:${arr.length}`)
        .join(', ');
      console.log(`[AI] Klíče načteny → ${counts || '(žádné)'}`);

      return true;
    } catch (e) {
      console.error('[AI] Chyba načítání klíčů:', e);
      _state.loaded = true;
      return false;
    }
  }

  // ── Ulož/aktualizuj klíč (provider specific) ─────────────────────
  async function saveKey({ apiKey, model, enabled = true, provider = 'groq', keys = null }) {
    const user = typeof getUser === 'function' ? getUser() : null;
    if (!user) throw new Error('Uživatel není přihlášen');

    // Nový formát: { provider, keys: ['k1','k2',...] }
    if (keys) {
      const valid = keys.filter(k => k && k.trim().length > 10).join(',');
      const field = provider === 'groq' ? 'groq_key'
                  : provider === 'cerebras' ? 'cerebras_key'
                  : provider === 'openrouter' ? 'openrouter_key'
                  : provider === 'deepseek' ? 'deepseek_key'
                  : provider === 'mistral' ? 'mistral_key'
                  : provider === 'xai' ? 'xai_key'
                  : provider === 'gemini' ? 'gemini_key'
                  : 'groq_key';
      const payload = { user_id: user.id, [field]: valid };
      if (provider === 'groq' && model) payload.groq_model = model;
      if (provider === 'groq') payload.groq_enabled = enabled;

      const existing = await _req(`rest/v1/user_api_keys?user_id=eq.${user.id}&select=id`);
      const hasRow = Array.isArray(existing) && existing.length > 0;

      // Nový řádek (uživatel nemá žádné klíče): groq_key má DEFAULT '' takže
      // INSERT projde i bez Groq klíče. groq_enabled=true aby has_groq_key() fungovalo.
      if (!hasRow && provider !== 'groq') {
        payload.groq_key     = '';
        payload.groq_enabled = true;
      }

      const res = await _req(
        hasRow ? `rest/v1/user_api_keys?user_id=eq.${user.id}` : 'rest/v1/user_api_keys',
        hasRow ? 'PATCH' : 'POST',
        payload
      );
      if (res && res.error) throw new Error(res.error.message || 'Chyba uložení');

      _state.keys[provider] = _parseKeys(valid);
      _state.enabled = _totalKeys() > 0;
      console.log(`[AI] ${PROVIDERS[provider].name} klíče uloženy (${_state.keys[provider].length}×) ✓`);
      return true;
    }

    // Starý formát (zpětně kompatibilní): { apiKey, model }
    if (!apiKey || apiKey.trim().length < 10) throw new Error('Neplatný API klíč');
    const payload = {
      user_id:      user.id,
      groq_key:     apiKey.trim(),
      groq_model:   model || _state.model,
      groq_enabled: enabled,
    };
    const res = await _req('rest/v1/user_api_keys', 'POST', payload);
    if (res && res.error) throw new Error(res.error.message || 'Chyba uložení');

    _state.keys.groq = [apiKey.trim()];
    _state.model   = payload.groq_model;
    _state.enabled = payload.groq_enabled;
    console.log('[AI] Groq klíč uložen ✓');
    return true;
  }

  // ── Smaž klíč ────────────────────────────────────────────────────
  async function deleteKey() {
    const user = typeof getUser === 'function' ? getUser() : null;
    if (!user) throw new Error('Uživatel není přihlášen');

    const res = await _req(`rest/v1/user_api_keys?user_id=eq.${user.id}`, 'DELETE');
    if (res && res.error) throw new Error(res.error.message || 'Chyba mazání');

    _state.keys = { groq: [], cerebras: [], openrouter: [], deepseek: [] };
    _state.enabled = false;
    console.log('[AI] Všechny klíče smazány');
  }

  // ── Ověř platnost klíče (ping na /models) ───────────────────────
  async function validateKey(apiKey, provider = 'groq') {
    const p = PROVIDERS[provider];
    if (!p) return false;
    try {
      const headers = { 'Authorization': `Bearer ${apiKey}` };
      // OpenRouter vyžaduje HTTP-Referer header
      if (provider === 'openrouter') {
        headers['HTTP-Referer'] = window.location.origin;
        headers['X-Title'] = 'PokéTrade';
      }
      const res = await fetch(p.validateUrl, { headers });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── Hlavní chat funkce s multi-provider rotací ──────────────────
  async function chat(messages, options = {}) {
    if (!_state.enabled) {
      throw new Error('AI je vypnuté v nastavení profilu.');
    }

    const isVision = _isVision(messages);
    const hasCjk   = isVision && _hasCjkContext(messages);

    // Chain: pokud je vision + CJK → preferuj OpenRouter (Qwen) jako první
    let chain = options.providerChain || DEFAULT_CHAIN.slice();

    // xAI preferováno → posuň na první místo v chainu
    if (_state.xaiPreferred && _state.keys.xai && _state.keys.xai.length > 0) {
      chain = chain.filter(p => p !== 'xai');
      chain.unshift('xai');
    }

    // Gemini preferováno → posuň na první místo v chainu (před xAI pokud není xAI preferred)
    if (_state.geminiPreferred && _state.keys.gemini && _state.keys.gemini.length > 0) {
      chain = chain.filter(p => p !== 'gemini');
      chain.unshift('gemini');
    }

    if (hasCjk) {
      chain = chain.filter(p => p !== 'openrouter');
      chain.unshift('openrouter');
    }

    const max_tokens  = options.max_tokens  ?? 1024;
    const temperature = options.temperature ?? 0.7;
    const stream      = options.stream      ?? false;

    const errors = [];

    // ── Nejprve zkus osobní klíče přes přímé volání ──
    for (const providerName of chain) {
      const provider = PROVIDERS[providerName];
      const keys     = _state.keys[providerName];
      if (!provider || provider.deprecated || !keys || !keys.length) continue;

      // Přeskoč providera pokud nepodporuje vision (visionModel === null)
      if (isVision && !options.model && provider.visionModel === null) {
        console.log(`[AI] ${provider.name} nepodporuje vision – přeskočen`);
        continue;
      }

      // ── Gemini: speciální API (jiný URL, jiný auth, jiný formát) ──
      if (provider.isGemini) {
        const geminiKeys = keys;
        const geminiModel = options.model || (isVision ? provider.visionModel : provider.textModel);
        for (let attempt = 0; attempt < geminiKeys.length; attempt++) {
          const keyIdx = (_state.keyIdx['gemini'] + attempt) % geminiKeys.length;
          const key    = geminiKeys[keyIdx];
          try {
            const result = await _geminiChat(key, geminiModel, messages, { max_tokens, temperature });
            _state.keyIdx['gemini'] = keyIdx;
            console.log(`[AI] ✓ Gemini klíč #${keyIdx + 1} (${isVision ? 'vision' : 'text'})`);
            return result;
          } catch (gemErr) {
            const msg = gemErr.message || String(gemErr);
            errors.push(`[Gemini #${keyIdx + 1}] ${msg}`);
            // 429 → zkus další klíč; ostatní chyby → přeruš
            if (!msg.includes('429') && !msg.includes('RATE')) break;
            console.warn(`[AI] Gemini klíč #${keyIdx + 1} rate limited, zkouším další…`);
          }
        }
        console.warn('[AI] Všechny Gemini klíče vyčerpány, zkouším další provider');
        continue;
      }

      // Vyber model: options.model má přednost, jinak vision/text default
      const primaryModel = options.model
        || (isVision ? provider.visionModel : provider.textModel);
      // Pokud primary model 404/429, postupně zkus visionFallbacks (seřazené od nejlepšího)
      const fallbacks = !options.model && isVision ? (provider.visionFallbacks || []) : [];
      // modelsToTry je seřazený seznam: [primary, fallback1, fallback2, ...]
      const modelsToTry = [primaryModel, ...fallbacks];

      let providerDone = false;

      // xAI nepodporuje webp → konvertuj na jpeg pokud je potřeba
      const messagesForProvider = isVision && provider.requiresJpeg
        ? await _convertImagesForProvider(messages, provider)
        : messages;

      for (let modelIdx = 0; modelIdx < modelsToTry.length; modelIdx++) {
        const model = modelsToTry[modelIdx];
        const isModelFallback = modelIdx > 0;
        if (providerDone) break;

        const body = JSON.stringify({ model, messages: messagesForProvider, temperature, max_tokens, stream });

        // Rotace klíčů v rámci providera (při 429)
        for (let attempt = 0; attempt < keys.length; attempt++) {
          const keyIdx = (_state.keyIdx[providerName] + attempt) % keys.length;
          const key    = keys[keyIdx];

          const headers = {
            'Authorization': `Bearer ${key}`,
            'Content-Type':  'application/json',
          };
          // OpenRouter vyžaduje HTTP-Referer
          if (providerName === 'openrouter') {
            headers['HTTP-Referer'] = window.location.origin;
            headers['X-Title'] = 'PokéTrade';
          }

          let res;
          try {
            res = await fetch(provider.endpoint, { method: 'POST', headers, body });
          } catch (netErr) {
            errors.push(`[${provider.name} #${keyIdx + 1}] síťová chyba: ${netErr.message}`);
            continue;
          }

          if (res.ok) {
            _state.keyIdx[providerName] = keyIdx;
            const modelLabel = isModelFallback ? ' (fallback model: ' + model.split('/').pop() + ')' : '';
            console.log(`[AI] ✓ ${provider.name} klíč #${keyIdx + 1} (${isVision ? 'vision' : 'text'})${modelLabel}`);

            if (stream && options.onChunk) {
              return await _handleStream(res, options.onChunk);
            }
            const data = await res.json();
            return data.choices?.[0]?.message?.content || '';
          }

          const errBody = await res.json().catch(() => ({}));
          const errMsg  = errBody?.error?.message || `HTTP ${res.status}`;
          errors.push(`[${provider.name} #${keyIdx + 1}/${model.split('/').pop().slice(0,30)}] ${errMsg}`);

          // 404 na model → zkus další model (pokud existuje) se stejným klíčem
          if (res.status === 404 && modelIdx < modelsToTry.length - 1) {
            console.warn(`[AI] ${provider.name} model ${model} 404, zkouším další fallback`);
            break; // přeruš keys loop, skoč na další model
          }

          // 429 → zkus další klíč stejného providera a stejného modelu
          // 4xx jiné → chybná konfigurace, nemá smysl zkoušet další klíč; ale můžeme fallback model
          // 5xx → pokračuj na další provider
          if (res.status !== 429) {
            if (res.status >= 500 && attempt === 0) {
              console.warn(`[AI] ${provider.name} server error ${res.status}, zkouším další provider`);
              providerDone = true;
            }
            break;
          }

          console.warn(`[AI] ${provider.name} klíč #${keyIdx + 1} rate limited, zkouším další klíč…`);
        }
      }

      console.warn(`[AI] Všechny ${provider.name} klíče/modely vyčerpány, zkouším další provider`);
    }

    // ── Fallback: žádný osobní klíč nefunguje (nebo žádný není) →
    //    zkus sdílený serverový proxy /api/groq?provider=X
    //    VIP/owner: bez limitu | non-VIP: 20 search + 10 fake / den
    if (stream) {
      // Sdílený proxy zatím nepodporuje SSE → vrátíme chybu
      throw new Error('Streaming přes sdílený proxy zatím není podporován. Zadej vlastní klíč v profilu.');
    }
    const sbToken = (typeof localStorage !== 'undefined') ? localStorage.getItem('sb_token') : null;
    if (!sbToken) {
      throw new Error('Pro použití sdílených AI klíčů musíš být přihlášen.');
    }

    for (const providerName of chain) {
      const provider = PROVIDERS[providerName];
      if (!provider || provider.deprecated) continue;
      if (!SHARED_FALLBACK_PROVIDERS.includes(providerName)) continue;
      if (isVision && !options.model && provider.visionModel === null) continue;

      const sharedModel = options.model
        || (isVision ? provider.visionModel : provider.textModel);

      try {
        console.log(`[AI] Sdílený proxy → ${provider.name} (${sharedModel})`);
        const r = await fetch('/api/groq', {
          method: 'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${sbToken}`,
          },
          body: JSON.stringify({
            provider:    providerName,
            model:       sharedModel,
            messages, temperature, max_tokens,
            usage_type:  options.usage_type || (isVision ? 'fake' : 'search'),
            ...(options.response_format ? { response_format: options.response_format } : {}),
          }),
        });
        const data = await r.json();
        if (!r.ok) {
          // 429 RATE_LIMITED → ukaž modal "Přidej klíč" + ukonči
          // 503 NO_SHARED_KEY → admin nezadal env var pro tohoto providera
          // jiné chyby → log a pokračuj na dalšího providera
          errors.push(`[shared/${provider.name}] ${data?.error || 'HTTP ' + r.status}`);
          if (data?.code === 'RATE_LIMITED') {
            // Globální modal (pokud je rate-limit-modal.js načtený na stránce)
            if (typeof global.showRateLimitModal === 'function') {
              global.showRateLimitModal({
                used:      data.used,
                limit:     data.limit,
                reset:     data.reset,
                usageType: data.usageType || data.usage_type,
              });
            }
            // Vrať okamžitě — jiní providery nepomůžou (limit je per usage_type)
            throw new Error(data.error || 'Denní limit vyčerpán');
          }
          continue;
        }
        console.log(`[AI] ✓ Sdílený proxy ${provider.name} OK`);
        return data.choices?.[0]?.message?.content || '';
      } catch (err) {
        if (err.message?.includes('limit') || err.message?.includes('vyčerpán')) throw err;
        errors.push(`[shared/${provider.name}] ${err.message}`);
      }
    }

    throw new Error(`Všechny AI providery selhaly (osobní i sdílené):\n${errors.join('\n')}`);
  }

  // ── Streaming helper ─────────────────────────────────────────────
  async function _handleStream(res, onChunk) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '));
      for (const line of lines) {
        const raw = line.replace('data: ', '').trim();
        if (raw === '[DONE]') continue;
        try {
          const parsed = JSON.parse(raw);
          const delta = parsed.choices?.[0]?.delta?.content || '';
          if (delta) { full += delta; onChunk(delta, full); }
        } catch { /* přeskoč neplatný chunk */ }
      }
    }
    return full;
  }

  // ── Rychlý helper ─────────────────────────────────────────────────
  async function ask(prompt, systemPrompt) {
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });
    return chat(messages);
  }

  // ── Getters / info ────────────────────────────────────────────────
  // isReady: dříve vyžadoval osobní klíč. Nyní stačí přihlášený uživatel,
  // protože fallback na sdílený serverový proxy je vždy možný.
  function isReady() {
    if (!_state.enabled) return false;
    if (_totalKeys() > 0) return true;
    return (typeof localStorage !== 'undefined') && !!localStorage.getItem('sb_token');
  }
  function hasOwnKeys()   { return _totalKeys() > 0; }
  function isLoaded()     { return _state.loaded; }
  function getModel()     { return _state.model; }
  function getModels()    { return GROQ_MODELS; }
  function getProviders() { return PROVIDERS; }
  function getKeyCounts() {
    const out = {};
    for (const p of Object.keys(PROVIDERS)) out[p] = _state.keys[p].length;
    return out;
  }
  function getKeysFor(provider) {
    return (_state.keys[provider] || []).slice();
  }

  // ── Gemini API helper ────────────────────────────────────────────
  // Gemini nepoužívá Bearer token ani OpenAI formát. Konvertuje OpenAI messages
  // (role: user/assistant/system, content: string|array) na Gemini contents[].
  async function _geminiChat(apiKey, model, messages, opts = {}) {
    const { max_tokens = 1024, temperature = 0.7 } = opts;

    // Konverze OpenAI messages → Gemini contents
    const contents = [];
    let systemInstruction = null;

    for (const msg of messages) {
      // System message → systemInstruction (Gemini 1.5 feature)
      if (msg.role === 'system') {
        systemInstruction = { parts: [{ text: msg.content }] };
        continue;
      }

      const role = msg.role === 'assistant' ? 'model' : 'user';
      const parts = [];

      if (typeof msg.content === 'string') {
        parts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text') {
            parts.push({ text: part.text });
          } else if (part.type === 'image_url') {
            const url = part.image_url?.url || '';
            if (url.startsWith('data:')) {
              // base64 data URL → inline_data
              const [header, data] = url.split(',');
              const mimeType = (header.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
              parts.push({ inline_data: { mime_type: mimeType, data } });
            } else {
              // Externý URL → file_data (může selhat bez Files API klíče)
              parts.push({ file_data: { mime_type: 'image/jpeg', file_uri: url } });
            }
          }
        }
      }

      if (parts.length > 0) contents.push({ role, parts });
    }

    const reqBody = {
      contents,
      generationConfig: {
        maxOutputTokens: max_tokens,
        temperature,
      },
    };
    if (systemInstruction) reqBody.system_instruction = systemInstruction;

    const url = `${PROVIDERS.gemini.endpointBase}/${model}:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const errMsg  = errBody?.error?.message || `HTTP ${res.status}`;
      throw new Error(errMsg);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text === undefined || text === null) {
      // Blocked / no candidates
      const reason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason || 'prázdná odpověď';
      throw new Error(`Gemini: ${reason}`);
    }
    return text;
  }

  // ── xAI Preference ───────────────────────────────────────────────
  function setXaiPreferred(val) {
    _state.xaiPreferred = !!val;
    try {
      if (val) {
        localStorage.setItem('xai_preferred', '1');
      } else {
        localStorage.removeItem('xai_preferred');
      }
    } catch (_) {}
    console.log(`[AI] xAI preferováno: ${_state.xaiPreferred}`);
  }
  function isXaiPreferred() { return _state.xaiPreferred; }

  // ── Gemini Preference ────────────────────────────────────────────
  function setGeminiPreferred(val) {
    _state.geminiPreferred = !!val;
    try {
      if (val) {
        localStorage.setItem('gemini_preferred', '1');
      } else {
        localStorage.removeItem('gemini_preferred');
      }
    } catch (_) {}
    console.log(`[AI] Gemini preferováno: ${_state.geminiPreferred}`);
  }
  function isGeminiPreferred() { return _state.geminiPreferred; }

  // ── Public API ───────────────────────────────────────────────────
  const GroqClient = {
    // Multi-provider
    loadKey, saveKey, deleteKey, validateKey,
    chat, ask,
    // Status / info
    isReady, hasOwnKeys, isLoaded, getModel, getModels,
    getProviders, getKeyCounts, getKeysFor,
    // xAI preference
    setXaiPreferred, isXaiPreferred,
    // Gemini preference
    setGeminiPreferred, isGeminiPreferred,
    // Aliasy / backward compat
    MODELS:    GROQ_MODELS,
    PROVIDERS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GroqClient;
  } else {
    global.GroqClient = GroqClient;
    global.AIClient   = GroqClient;   // nový alias
  }

})(typeof window !== 'undefined' ? window : globalThis);
