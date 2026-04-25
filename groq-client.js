// ═══════════════════════════════════════════════════════════════════
//  groq-client.js – Multi-provider AI modul pro PokéTrade web
//  Vyžaduje: app.js (supabaseRequest + getUser)
//
//  HISTORIE:
//    v1: Jen Groq, pole klíčů, rotace při 429
//    v2: Multi-provider (Groq + Cerebras + OpenRouter + DeepSeek)
//        Zpětně kompatibilní API: window.GroqClient funguje jako před
//
//  BEZPEČNOST:
//    - API klíče načteny ze Supabase (user_api_keys), chráněno RLS
//    - Klíče drženy jen v paměti (never localStorage)
//    - Každý uživatel má jen své klíče
//
//  ROTACE:
//    - Při 429 (rate limit) → další klíč stejného providera
//    - Při vyčerpání všech klíčů jednoho providera → další provider v řetězci
//    - Chain default: groq → cerebras → openrouter → deepseek
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
      visionModel:      'qwen/qwen2.5-vl-32b-instruct:free',  // nejlepší zdarma pro CJK
      visionFallbacks:  [
        'qwen/qwen2.5-vl-7b-instruct:free',
        'google/gemma-4-31b-it:free',                    // Gemma 4 vision (duben 2026)
        'nvidia/nemotron-nano-2-vl-12b:free',            // NVIDIA OCR/vision
        'mistralai/mistral-small-3.1-24b-instruct:free', // Mistral vision fallback
        'meta-llama/llama-3.2-11b-vision-instruct:free', // poslední záchrana
      ],
    },
    deepseek: {
      name:         'DeepSeek',
      endpoint:     'https://api.deepseek.com/chat/completions',
      validateUrl:  'https://api.deepseek.com/models',
      textModel:    'deepseek-chat',
      visionModel:  'deepseek-chat',  // V4 multimodal (pokud dostupné)
    },
  };

  // DEFAULT_CHAIN: Cerebras jde první.
  // Důvod: Groq free tier má jen 500k tokenů/den, což vision rychle vyčerpá
  // (každý obrázek ~6-10k tokenů → po 50-80 skenech je Groq mimo pro celý den).
  // Cerebras má 1M tokenů/den/klíč a je srovnatelně rychlý.
  // Pro CJK karty se OpenRouter (Qwen) stále posouvá na první místo.
  const DEFAULT_CHAIN = ['cerebras', 'groq', 'openrouter', 'deepseek'];

  // ── Stav modulu ──────────────────────────────────────────────────
  const _state = {
    keys: {        // pole klíčů per provider
      groq:       [],
      cerebras:   [],
      openrouter: [],
      deepseek:   [],
    },
    keyIdx: {      // aktuální aktivní klíč per provider
      groq:       0,
      cerebras:   0,
      openrouter: 0,
      deepseek:   0,
    },
    model:     'meta-llama/llama-4-scout-17b-16e-instruct',  // user preferred text model (kompat)
    enabled:   false,
    loaded:    false,
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

  // Vrať celkový počet klíčů napříč všemi providery
  function _totalKeys() {
    return Object.values(_state.keys).reduce((sum, arr) => sum + arr.length, 0);
  }

  // ── Načti všechny klíče ze Supabase ─────────────────────────────
  async function loadKey() {
    const user = typeof getUser === 'function' ? getUser() : null;
    if (!user) { _state.loaded = true; return false; }

    try {
      const res = await _req(
        `rest/v1/user_api_keys?user_id=eq.${user.id}&select=groq_key,groq_model,groq_enabled,cerebras_key,openrouter_key,deepseek_key`
      );
      const data = Array.isArray(res) ? res[0] : null;

      if (!data) {
        _state.loaded = true;
        _state.enabled = false;
        return false;
      }

      _state.keys.groq       = _parseKeys(data.groq_key);
      _state.keys.cerebras   = _parseKeys(data.cerebras_key);
      _state.keys.openrouter = _parseKeys(data.openrouter_key);
      _state.keys.deepseek   = _parseKeys(data.deepseek_key);

      // Zpětná kompatibilita: model pro text volání zůstává z Groq
      _state.model   = data.groq_model || 'meta-llama/llama-4-scout-17b-16e-instruct';
      _state.enabled = (data.groq_enabled !== false) && _totalKeys() > 0;
      _state.loaded  = true;

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
                  : 'groq_key';
      const payload = { user_id: user.id, [field]: valid };
      if (provider === 'groq' && model) payload.groq_model = model;
      if (provider === 'groq') payload.groq_enabled = enabled;

      const existing = await _req(`rest/v1/user_api_keys?user_id=eq.${user.id}&select=id`);
      const hasRow = Array.isArray(existing) && existing.length > 0;

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
    if (!_state.enabled || _totalKeys() === 0) {
      throw new Error('Žádné AI klíče nejsou nakonfigurované. Přidej klíč v nastavení profilu.');
    }

    const isVision = _isVision(messages);
    const hasCjk   = isVision && _hasCjkContext(messages);

    // Chain: pokud je vision + CJK → preferuj OpenRouter (Qwen) jako první
    let chain = options.providerChain || DEFAULT_CHAIN.slice();
    if (hasCjk) {
      chain = chain.filter(p => p !== 'openrouter');
      chain.unshift('openrouter');
    }

    const max_tokens  = options.max_tokens  ?? 1024;
    const temperature = options.temperature ?? 0.7;
    const stream      = options.stream      ?? false;

    const errors = [];

    for (const providerName of chain) {
      const provider = PROVIDERS[providerName];
      const keys     = _state.keys[providerName];
      if (!provider || !keys || !keys.length) continue;

      // Přeskoč providera pokud nepodporuje vision (visionModel === null)
      if (isVision && !options.model && provider.visionModel === null) {
        console.log(`[AI] ${provider.name} nepodporuje vision – přeskočen`);
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

      for (let modelIdx = 0; modelIdx < modelsToTry.length; modelIdx++) {
        const model = modelsToTry[modelIdx];
        const isModelFallback = modelIdx > 0;
        if (providerDone) break;

        const body = JSON.stringify({ model, messages, temperature, max_tokens, stream });

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

    throw new Error(`Všechny AI providery selhaly:\n${errors.join('\n')}`);
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
  function isReady()      { return _state.enabled && _totalKeys() > 0; }
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

  // ── Public API ───────────────────────────────────────────────────
  const GroqClient = {
    // Multi-provider
    loadKey, saveKey, deleteKey, validateKey,
    chat, ask,
    // Status / info
    isReady, isLoaded, getModel, getModels,
    getProviders, getKeyCounts, getKeysFor,
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
