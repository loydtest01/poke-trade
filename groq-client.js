// ═══════════════════════════════════════════════════════════════
//  groq-client.js – Groq AI modul pro PokéTrade web
//  Vyžaduje: app.js (supabaseRequest + getUser)
//
//  BEZPEČNOST:
//  - API klíč se načte ze Supabase (user_api_keys), chráněno RLS
//  - Klíč se drží v paměti session – nikdy se neukládá do localStorage
//  - Každý uživatel má jen svůj klíč
// ═══════════════════════════════════════════════════════════════

(function (global) {
  'use strict';

  // ── Stav modulu ─────────────────────────────────────────────
  const _state = {
    apiKey: null,      // načteno ze Supabase, jen v RAM
    apiKeys: [],       // pole klíčů pro rotaci
    keyIndex: 0,       // aktuální aktivní klíč
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    enabled: false,
    loaded: false,
  };

  // ── Dostupné Groq modely ─────────────────────────────────────
  const GROQ_MODELS = [
    { id: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout 17B (vision, doporučeno)' },
    { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', label: 'Llama 4 Maverick 17B (vision)' },
    { id: 'llama-3.3-70b-versatile',   label: 'Llama 3.3 70B (text)' },
    { id: 'llama-3.1-8b-instant',      label: 'Llama 3.1 8B (rychlý, text)' },
  ];

  // ── Interní REST helper ──────────────────────────────────────
  // Používá supabaseRequest z app.js (musí být načteno dříve)
  function _req(path, method = 'GET', body = null) {
    const token = localStorage.getItem('sb_token');
    if (typeof supabaseRequest === 'function') {
      return supabaseRequest(path, method, body, token);
    }
    throw new Error('[Groq] supabaseRequest není dostupný – načti app.js před groq-client.js');
  }

  // ── Načti klíč ze Supabase ───────────────────────────────────
  async function loadKey() {
    const user = typeof getUser === 'function' ? getUser() : null;
    if (!user) { _state.loaded = true; return false; }

    try {
      const res = await _req(
        `rest/v1/user_api_keys?user_id=eq.${user.id}&select=groq_key,groq_model,groq_enabled`
      );
      const data = Array.isArray(res) ? res[0] : null;

      if (!data || !data.groq_key) {
        _state.loaded = true;
        _state.enabled = false;
        return false;
      }

      const keys = data.groq_key.split(',').map(k => k.trim()).filter(k => k.length > 10);
      _state.apiKeys = keys;
      _state.apiKey  = keys[0] || null;
      _state.keyIndex = 0;
      _state.model   = data.groq_model || 'meta-llama/llama-4-scout-17b-16e-instruct';
      _state.enabled = data.groq_enabled !== false && keys.length > 0;
      _state.loaded  = true;

      console.log('[Groq] Klíčů načteno:', keys.length, '| Model:', _state.model);
      return true;
    } catch (e) {
      console.error('[Groq] Chyba načítání klíče:', e);
      _state.loaded = true;
      return false;
    }
  }

  // ── Ulož / aktualizuj klíč v Supabase ───────────────────────
  async function saveKey({ apiKey, model, enabled = true }) {
    const user = typeof getUser === 'function' ? getUser() : null;
    if (!user) throw new Error('Uživatel není přihlášen');
    if (!apiKey || apiKey.trim().length < 10) throw new Error('Neplatný API klíč');

    const payload = {
      user_id:      user.id,
      groq_key:     apiKey.trim(),
      groq_model:   model || _state.model,
      groq_enabled: enabled,
    };

    const res = await _req('rest/v1/user_api_keys', 'POST', payload);
    if (res && res.error) throw new Error(res.error.message || 'Chyba uložení');

    _state.apiKey  = payload.groq_key;
    _state.model   = payload.groq_model;
    _state.enabled = payload.groq_enabled;

    console.log('[Groq] Klíč uložen ✓');
    return true;
  }

  // ── Smaž klíč ze Supabase ───────────────────────────────────
  async function deleteKey() {
    const user = typeof getUser === 'function' ? getUser() : null;
    if (!user) throw new Error('Uživatel není přihlášen');

    const res = await _req(
      `rest/v1/user_api_keys?user_id=eq.${user.id}`,
      'DELETE'
    );
    if (res && res.error) throw new Error(res.error.message || 'Chyba mazání');

    _state.apiKey  = null;
    _state.enabled = false;
    console.log('[Groq] Klíč smazán');
  }

  // ── Ověř platnost Groq klíče (ping) ─────────────────────────
  async function validateKey(apiKey) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── Hlavní funkce: pošli zprávu do Groq ─────────────────────
  async function chat(messages, options = {}) {
    if (!_state.enabled || !_state.apiKey) {
      throw new Error('Groq AI není nakonfigurováno. Přidej svůj API klíč v nastavení profilu.');
    }

    const model       = options.model       || _state.model;
    const temperature = options.temperature ?? 0.7;
    const max_tokens  = options.max_tokens  ?? 1024;
    const stream      = options.stream      ?? false;

    const body = JSON.stringify({ model, messages, temperature, max_tokens, stream });

    // Key rotation – zkus každý klíč při 429
    const keys = _state.apiKeys.length ? _state.apiKeys : [_state.apiKey];
    let res, lastErr;
    for (let attempt = 0; attempt < keys.length; attempt++) {
      const keyToUse = keys[(_state.keyIndex + attempt) % keys.length];
      res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${keyToUse}`, 'Content-Type': 'application/json' },
        body,
      });
      if (res.ok) { _state.keyIndex = (_state.keyIndex + attempt) % keys.length; break; }
      const err = await res.json().catch(() => ({}));
      lastErr = err?.error?.message || `HTTP ${res.status}`;
      if (res.status !== 429) break; // jen 429 přepíná klíč
      console.warn('[Groq] Rate limit na klíči', attempt + 1, '– zkouším další…');
    }
    if (!res || !res.ok) throw new Error(`Groq API chyba: ${lastErr || 'Neznámá chyba'}`);

    if (stream && options.onChunk) {
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
            if (delta) { full += delta; options.onChunk(delta, full); }
          } catch { /* přeskoč neplatný chunk */ }
        }
      }
      return full;
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  // ── Rychlý helper ─────────────────────────────────────────────
  async function ask(prompt, systemPrompt) {
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });
    return chat(messages);
  }

  function isReady()   { return _state.enabled && !!_state.apiKey; }
  function isLoaded()  { return _state.loaded; }
  function getModel()  { return _state.model; }
  function getModels() { return GROQ_MODELS; }

  const GroqClient = {
    loadKey, saveKey, deleteKey, validateKey,
    chat, ask,
    isReady, isLoaded, getModel, getModels,
    MODELS: GROQ_MODELS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = GroqClient;
  } else {
    global.GroqClient = GroqClient;
  }

})(typeof window !== 'undefined' ? window : globalThis);
