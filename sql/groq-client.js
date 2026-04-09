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
    model: 'llama-3.3-70b-versatile',
    enabled: false,
    loaded: false,
  };

  // ── Dostupné Groq modely ─────────────────────────────────────
  const GROQ_MODELS = [
    { id: 'llama-3.3-70b-versatile',   label: 'Llama 3.3 70B (doporučeno)' },
    { id: 'llama-3.1-8b-instant',      label: 'Llama 3.1 8B (rychlý)' },
    { id: 'mixtral-8x7b-32768',        label: 'Mixtral 8x7B' },
    { id: 'gemma2-9b-it',              label: 'Gemma 2 9B' },
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

      _state.apiKey  = data.groq_key;
      _state.model   = data.groq_model || 'llama-3.3-70b-versatile';
      _state.enabled = data.groq_enabled !== false;
      _state.loaded  = true;

      console.log('[Groq] Klíč načten ✓ | Model:', _state.model);
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

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${_state.apiKey}`,
        'Content-Type':  'application/json',
      },
      body,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err?.error?.message || `HTTP ${res.status}`;
      throw new Error(`Groq API chyba: ${msg}`);
    }

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
