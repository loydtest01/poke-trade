// ═══════════════════════════════════════════════════════════════════
//  ai-providers-ui.js  – UI pro správu klíčů více AI providerů
//  ─────────────────────────────────────────────────────────────────
//  Co to dělá:
//    • Najde v profile.html sekci s Groq nastavením (#groqSection, .sdrop-acc-body-groq)
//    • Vloží pod ni novou sekci "Další AI poskytovatelé"
//    • Pro každý provider (Cerebras / OpenRouter / DeepSeek) nabídne:
//        - seznam klíčů s maskovaným zobrazením
//        - tlačítko + pro přidání, × pro smazání
//    • Uloží je do user_api_keys.{cerebras_key,openrouter_key,mistral_key}
//    • GroqClient.loadKey() pak načte všechny klíče a rotuje mezi providery
//
//  Instalace: přidej <script src="ai-providers-ui.js"></script> do profile.html
//             (těsně po <script src="groq-client.js"></script>)
// ═══════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  const PROVIDERS = [
    {
      key:          'cerebras',
      name:         'Cerebras',
      signupUrl:    'https://cloud.cerebras.ai',
      docsUrl:      'https://inference-docs.cerebras.ai',
      description:  'Ultra-rychlý, stejné modely jako Groq (Llama 4 Scout). 1M tokenů/den zdarma.',
      placeholder:  'csk-xxxxxxxxxxxxxxxxxxxx',
      color:        '#8b5cf6',
      icon:         '⚡',
    },
    {
      key:          'openrouter',
      name:         'OpenRouter',
      signupUrl:    'https://openrouter.ai',
      docsUrl:      'https://openrouter.ai/docs',
      description:  'Přístup ke Qwen VL 72B (nejlepší pro JP/ZH karty) + desítky dalších modelů.',
      placeholder:  'sk-or-v1-xxxxxxxxxxxxxxxx',
      color:        '#14b8a6',
      icon:         '🌐',
    },
    {
      key:          'mistral',
      name:         'Mistral',
      signupUrl:    'https://console.mistral.ai',
      docsUrl:      'https://docs.mistral.ai',
      description:  'Francouzský model. Mistral OCR 3 čte CJK znaky (JP/ZH/KO) lépe než Llama. 1 mld. tokenů/měsíc zdarma, jen ověření telefonem.',
      placeholder:  'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      color:        '#fa7300',
      icon:         '🇫🇷',
    },
  ];

  // ── Čekej na DOM + GroqClient + currentUser ────────────────────
  function waitFor(pred, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        if (pred()) return resolve(true);
        if (Date.now() - started > timeout) return reject(new Error('timeout'));
        setTimeout(check, 200);
      };
      check();
    });
  }

  function maskKey(k) {
    if (!k) return '';
    const s = String(k).trim();
    if (s.length < 14) return s;
    return s.slice(0, 7) + '…' + s.slice(-5);
  }

  // ── Reveal toggle stav (per-tab session, RAM only) ─────────────
  // Mapa: "${provider}:${index}" → expirační timestamp (ms).
  // Když uživatel klikne na 👁, klíč se zobrazí v plné podobě po 24 hodin
  // (jen v této záložce — zavřením tabu se reset). Není to perzistentní úmyslně,
  // aby se klíče samy schovaly i kdyby Loyd zapomněl.
  const REVEAL_MS = 24 * 60 * 60 * 1000;
  const _revealUntil = new Map();
  let _revealCheckInterval = null;

  function revealKey(provider, idx) {
    _revealUntil.set(`${provider}:${idx}`, Date.now() + REVEAL_MS);
  }
  function hideKey(provider, idx) {
    _revealUntil.delete(`${provider}:${idx}`);
  }
  function isRevealed(provider, idx) {
    const exp = _revealUntil.get(`${provider}:${idx}`);
    if (!exp) return false;
    if (Date.now() >= exp) {
      _revealUntil.delete(`${provider}:${idx}`);
      return false;
    }
    return true;
  }
  function revealRemainingHours(provider, idx) {
    const exp = _revealUntil.get(`${provider}:${idx}`);
    if (!exp) return 0;
    const ms = exp - Date.now();
    if (ms <= 0) return 0;
    return Math.max(1, Math.round(ms / (60 * 60 * 1000)));
  }

  function getToken() {
    return localStorage.getItem('sb_token');
  }

  async function loadAllKeys(userId) {
    const token = getToken();
    if (!token) return {};
    // Resilient načtení: pokud sloupec mistral_key v DB neexistuje (migrace
    // nebyla spuštěna), zkusíme fallback bez něj. Tím UI funguje i bez migrace.
    const trySelect = async (cols) => {
      try {
        const res = await supabaseRequest(
          `rest/v1/user_api_keys?user_id=eq.${userId}&select=${cols}`,
          'GET', null, token
        );
        if (res && (res.code === '42703' || (res.message || '').includes('column'))) {
          return null; // sloupec neexistuje
        }
        return Array.isArray(res) ? res[0] || {} : null;
      } catch (e) {
        console.warn('[AIProviders] select selhal pro', cols, e);
        return null;
      }
    };

    let row = await trySelect('cerebras_key,openrouter_key,mistral_key');
    if (row === null) {
      console.warn('[AIProviders] Sloupec mistral_key neexistuje — spusť migration_mistral_key.sql v Supabase! Fallback bez něj…');
      row = await trySelect('cerebras_key,openrouter_key') || {};
    }

    const out = {};
    for (const p of PROVIDERS) {
      const raw = row?.[`${p.key}_key`] || '';
      out[p.key] = raw.split(',').map(k => k.trim()).filter(k => k.length > 10);
    }
    return out;
  }

  async function saveKeysForProvider(userId, provider, keys) {
    const token = getToken();
    if (!token) throw new Error('Chybí token');

    const existing = await supabaseRequest(
      `rest/v1/user_api_keys?user_id=eq.${userId}&select=id`,
      'GET', null, token
    );
    const hasRow = Array.isArray(existing) && existing.length > 0;
    const payload = { user_id: userId, [`${provider}_key`]: keys.join(',') };

    // Nový řádek (žádné klíče dosud): groq_key má po migraci DEFAULT '',
    // ale pro jistotu ho explicitně zahrneme + nastavíme groq_enabled=true
    // aby has_groq_key() fungovalo (nyní kontroluje všechny providery).
    if (!hasRow && provider !== 'groq') {
      payload.groq_key     = '';
      payload.groq_enabled = true;
    }

    const res = await supabaseRequest(
      hasRow ? `rest/v1/user_api_keys?user_id=eq.${userId}` : 'rest/v1/user_api_keys',
      hasRow ? 'PATCH' : 'POST',
      payload,
      token
    );
    if (res && res.error) throw new Error(res.error.message || 'Chyba uložení');

    // Synchronizuj runtime stav v GroqClient
    if (window.GroqClient && typeof window.GroqClient.loadKey === 'function') {
      await window.GroqClient.loadKey();
    }
  }

  // ── Vygeneruj HTML jedné provider sekce ─────────────────────────
  function buildProviderCard(p, keys) {
    const safeDesc = p.description.replace(/</g, '&lt;');
    let keysHtml = '';
    if (keys.length === 0) {
      keysHtml = `<div style="padding:10px 12px;background:rgba(255,255,255,0.03);border-radius:8px;color:var(--text3);font-size:13px">Žádné klíče. Přidej svůj první klíč níže.</div>`;
    } else {
      keysHtml = keys.map((k, i) => {
        const revealed = isRevealed(p.key, i);
        const remaining = revealRemainingHours(p.key, i);
        const display = revealed ? k : maskKey(k);
        const eyeIcon = revealed ? '🙈' : '👁';
        const eyeTitle = revealed
          ? `Skrýt klíč (zbývá ${remaining}h)`
          : 'Zobrazit klíč na 24 hodin';
        return `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;margin-bottom:6px">
          <span style="font-size:11px;color:var(--text3);min-width:20px;font-weight:700">#${i + 1}</span>
          <span style="font-family:monospace;font-size:13px;flex:1;color:var(--text);word-break:break-all;${revealed ? 'background:rgba(245,200,66,0.08);padding:3px 6px;border-radius:4px' : ''}">${display}</span>
          ${revealed ? `<span style="font-size:9px;color:rgba(245,200,66,0.7);margin-right:2px" title="Auto-skryje se za ${remaining}h">⏱ ${remaining}h</span>` : ''}
          <button data-aip-action="${revealed ? 'hide' : 'reveal'}" data-aip-provider="${p.key}" data-aip-idx="${i}"
                  style="background:transparent;border:none;color:rgba(245,200,66,0.7);font-size:14px;cursor:pointer;padding:0 4px"
                  title="${eyeTitle}">${eyeIcon}</button>
          ${revealed ? `<button data-aip-action="copy" data-aip-provider="${p.key}" data-aip-idx="${i}"
                  style="background:transparent;border:none;color:rgba(116,180,255,0.8);font-size:14px;cursor:pointer;padding:0 4px"
                  title="Zkopírovat do schránky">📋</button>` : ''}
          <span style="font-size:10px;color:var(--text3);margin-right:4px">${i === 0 ? '🟢 aktivní' : '⏳ záloha'}</span>
          <button data-aip-action="remove" data-aip-provider="${p.key}" data-aip-idx="${i}"
                  style="background:transparent;border:none;color:var(--red);font-size:16px;cursor:pointer;padding:0 4px"
                  title="Odebrat">✕</button>
        </div>
        `;
      }).join('');
    }

    return `
      <div style="border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px;margin-bottom:14px;background:rgba(255,255,255,0.02)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:22px">${p.icon}</span>
            <div>
              <div style="font-weight:700;font-size:15px;color:${p.color}">${p.name}</div>
              <div style="font-size:11px;color:var(--text3)">${keys.length} klíč${keys.length === 1 ? '' : keys.length < 5 ? 'e' : 'ů'}</div>
            </div>
          </div>
          <a href="${p.signupUrl}" target="_blank" rel="noopener"
             style="padding:6px 12px;border:1px solid ${p.color};border-radius:8px;color:${p.color};text-decoration:none;font-size:12px;font-weight:600">
             Registrovat →
          </a>
        </div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:12px;line-height:1.5">${safeDesc}</div>
        <div id="aip-keys-${p.key}">${keysHtml}</div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <input type="text" id="aip-input-${p.key}" placeholder="${p.placeholder}"
                 style="flex:1;padding:8px 12px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--text);font-family:monospace;font-size:13px">
          <button data-aip-action="add" data-aip-provider="${p.key}"
                  style="padding:8px 16px;background:${p.color};border:none;border-radius:8px;color:white;font-weight:600;cursor:pointer">
            + Přidat
          </button>
        </div>
        <div id="aip-feedback-${p.key}" style="margin-top:8px;font-size:12px;min-height:16px"></div>
      </div>
    `;
  }

  function feedback(providerKey, msg, isError = false) {
    const el = document.getElementById(`aip-feedback-${providerKey}`);
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? 'var(--red)' : 'var(--green)';
    if (!isError) setTimeout(() => { el.textContent = ''; }, 3000);
  }

  // ── Hlavní render ────────────────────────────────────────────────
  async function init() {
    try {
      await waitFor(() => typeof supabaseRequest === 'function' && typeof window.currentUser !== 'undefined');
      const user = window.currentUser;
      if (!user?.id) {
        console.log('[AIProviders] uživatel nepřihlášen, UI se nevkládá');
        return;
      }

      // Zkus najít kontejner (preferenčně po Groq sekci)
      let container = document.querySelector('.sdrop-acc-body-groq .groq-form')
                   || document.querySelector('.acc-body-groq .groq-form')
                   || document.querySelector('#groqForm')
                   || document.querySelector('[id*="roqForm"]');

      if (!container) {
        console.warn('[AIProviders] Groq form kontejner nenalezen, UI se nevkládá');
        return;
      }

      // Vytvoř wrapper a vlož ho jako sourozence za groq-form
      const wrapper = document.createElement('div');
      wrapper.id = 'ai-providers-wrapper';
      wrapper.style.marginTop = '24px';
      wrapper.style.paddingTop = '20px';
      wrapper.style.borderTop = '1px solid rgba(255,255,255,0.1)';

      wrapper.innerHTML = `
        <div style="margin-bottom:14px">
          <div style="font-weight:700;font-size:16px;margin-bottom:4px;color:var(--text)">
            🤝 Další AI poskytovatelé <span style="font-size:11px;color:var(--text3);font-weight:400">(volitelné)</span>
          </div>
          <div style="font-size:12px;color:var(--text3);line-height:1.5">
            Přidej klíče z dalších poskytovatelů pro lepší pokrytí a kvalitu. Systém automaticky rotuje mezi všemi klíči napříč poskytovateli. Pro JP/ZH karty preferuje OpenRouter (Qwen VL), který čte asijské znaky lépe než Llama.
          </div>
        </div>
        <div id="aip-providers-list"></div>
      `;
      container.parentNode.insertBefore(wrapper, container.nextSibling);

      const listEl = document.getElementById('aip-providers-list');
      const allKeys = await loadAllKeys(user.id);

      function rerender() {
        listEl.innerHTML = PROVIDERS.map(p => buildProviderCard(p, allKeys[p.key] || [])).join('');
      }
      rerender();

      // Event delegation na celý wrapper
      wrapper.addEventListener('click', async (e) => {
        const target = e.target;
        if (!target) return;

        const action   = target.getAttribute('data-aip-action');
        const provider = target.getAttribute('data-aip-provider');
        if (!action || !provider) return;
        e.preventDefault();

        if (action === 'add') {
          const input = document.getElementById(`aip-input-${provider}`);
          const val   = (input?.value || '').trim();
          if (!val || val.length < 10) {
            feedback(provider, '❌ Klíč musí mít aspoň 10 znaků', true);
            return;
          }
          if ((allKeys[provider] || []).includes(val)) {
            feedback(provider, 'ℹ️ Tento klíč už existuje', true);
            return;
          }
          feedback(provider, '⏳ Ukládám…');
          try {
            const newKeys = [...(allKeys[provider] || []), val];
            await saveKeysForProvider(user.id, provider, newKeys);
            allKeys[provider] = newKeys;
            if (input) input.value = '';
            rerender();
            feedback(provider, '✅ Klíč přidán');
          } catch (err) {
            console.error('[AIProviders] add failed:', err);
            feedback(provider, '❌ ' + (err.message || 'Chyba uložení'), true);
          }
        }

        if (action === 'remove') {
          const idx = parseInt(target.getAttribute('data-aip-idx'), 10);
          if (isNaN(idx)) return;
          if (!confirm(`Odebrat ${PROVIDERS.find(p => p.key === provider).name} klíč #${idx + 1}?`)) return;
          try {
            const newKeys = (allKeys[provider] || []).filter((_, i) => i !== idx);
            await saveKeysForProvider(user.id, provider, newKeys);
            allKeys[provider] = newKeys;
            // Po smazání jednoho klíče se posunou indexy → vyresetujeme reveal stavy pro tohoto providera
            for (const k of Array.from(_revealUntil.keys())) {
              if (k.startsWith(provider + ':')) _revealUntil.delete(k);
            }
            rerender();
            feedback(provider, '✅ Klíč odebrán');
          } catch (err) {
            console.error('[AIProviders] remove failed:', err);
            feedback(provider, '❌ ' + (err.message || 'Chyba mazání'), true);
          }
        }

        if (action === 'reveal') {
          const idx = parseInt(target.getAttribute('data-aip-idx'), 10);
          if (isNaN(idx)) return;
          revealKey(provider, idx);
          // Spustí auto-refresh interval pokud ještě neběží (každou minutu zkontroluje expiraci)
          if (!_revealCheckInterval) {
            _revealCheckInterval = setInterval(() => {
              let anyExpired = false;
              for (const [key, exp] of _revealUntil.entries()) {
                if (Date.now() >= exp) {
                  _revealUntil.delete(key);
                  anyExpired = true;
                }
              }
              if (_revealUntil.size === 0) {
                clearInterval(_revealCheckInterval);
                _revealCheckInterval = null;
              }
              if (anyExpired) rerender();
            }, 60_000);
          }
          rerender();
        }

        if (action === 'hide') {
          const idx = parseInt(target.getAttribute('data-aip-idx'), 10);
          if (isNaN(idx)) return;
          hideKey(provider, idx);
          rerender();
        }

        if (action === 'copy') {
          const idx = parseInt(target.getAttribute('data-aip-idx'), 10);
          if (isNaN(idx)) return;
          const fullKey = (allKeys[provider] || [])[idx];
          if (!fullKey) return;
          try {
            await navigator.clipboard.writeText(fullKey);
            feedback(provider, '📋 Klíč zkopírován do schránky');
          } catch (err) {
            console.warn('[AIProviders] clipboard failed:', err);
            // Fallback: prompt s klíčem (user si ho zkopíruje ručně)
            try { window.prompt('Zkopíruj klíč:', fullKey); } catch (_) {}
            feedback(provider, '📋 Klíč připraven (manuální kopie)', true);
          }
        }
      });

      console.log('[AIProviders] UI připraveno');
    } catch (e) {
      console.warn('[AIProviders] init failed:', e.message);
    }
  }

  // Poběh po full page load (profile.html má async setup)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1500));
  } else {
    setTimeout(init, 1500);
  }
})();
