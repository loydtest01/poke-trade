/* ═══════════════════════════════════════════════════════════════════
   rate-limit-modal.js · PokéTrade
   ───────────────────────────────────────────────────────────────────
   Globální modal "Přidej AI klíč" co se zobrazí když user dosáhne
   denního limitu sdílených klíčů (HTTP 429 + code: 'RATE_LIMITED').

   Použití:
     window.showRateLimitModal({ used: 200, limit: 200, providerHint: '...' });

   Auto-close při Esc, kliknutí mimo, nebo na ✕. Modal je singleton —
   pokud se zavolá vícekrát rychle za sebou, druhé volání aktualizuje
   data prvního místo otevření nového.
═══════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const MODAL_ID = 'pkt-rate-limit-modal';
  const STYLE_ID = 'pkt-rate-limit-modal-style';

  const PROVIDER_LINKS = [
    { icon: '⚡',  name: 'Cerebras',   url: 'https://cloud.cerebras.ai',     desc: '1M tokenů/den, ultra-rychlý' },
    { icon: '🌐', name: 'OpenRouter', url: 'https://openrouter.ai',         desc: 'Qwen, Gemma, vision modely' },
    { icon: '🇫🇷', name: 'Mistral',    url: 'https://console.mistral.ai',    desc: '1 mld. tokenů/měsíc, OCR' },
    { icon: '🚀', name: 'Groq',       url: 'https://console.groq.com',      desc: 'Llama 4 Scout vision' },
  ];

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const css = `
      #${MODAL_ID}-overlay {
        position: fixed; inset: 0; z-index: 99999;
        background: rgba(0,0,0,0.65); backdrop-filter: blur(4px);
        display: flex; align-items: center; justify-content: center;
        animation: pktRlmFade .2s ease;
      }
      @keyframes pktRlmFade { from { opacity: 0; } to { opacity: 1; } }
      #${MODAL_ID} {
        max-width: 460px; width: calc(100% - 32px);
        background: #15101a; border: 1px solid rgba(255,255,255,0.10);
        border-radius: 16px; color: #f0ece4;
        font-family: 'DM Sans', system-ui, sans-serif;
        padding: 28px 28px 24px;
        animation: pktRlmSlide .25s ease;
        box-shadow: 0 24px 60px rgba(0,0,0,0.5);
      }
      @keyframes pktRlmSlide {
        from { opacity: 0; transform: translateY(20px) scale(0.96); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
      #${MODAL_ID} h2 {
        font-family: 'Unbounded', sans-serif;
        font-size: 20px; font-weight: 700;
        margin: 0 0 12px; color: #f5c842;
        display: flex; align-items: center; gap: 10px;
      }
      #${MODAL_ID} .pkt-rlm-close {
        position: absolute; top: 12px; right: 14px;
        background: transparent; border: none; cursor: pointer;
        color: rgba(240,236,228,0.5); font-size: 22px; padding: 4px 10px;
        border-radius: 6px; transition: all .15s;
      }
      #${MODAL_ID} .pkt-rlm-close:hover {
        background: rgba(255,255,255,0.05); color: #f0ece4;
      }
      #${MODAL_ID} p { margin: 0 0 14px; line-height: 1.55; font-size: 14px; color: rgba(240,236,228,0.85); }
      #${MODAL_ID} .pkt-rlm-stats {
        display: flex; align-items: center; gap: 12px;
        padding: 12px 14px; background: rgba(245,200,66,0.08);
        border: 1px solid rgba(245,200,66,0.2); border-radius: 10px;
        margin-bottom: 18px; font-size: 13px;
      }
      #${MODAL_ID} .pkt-rlm-bar {
        flex: 1; height: 6px; background: rgba(255,255,255,0.08);
        border-radius: 3px; overflow: hidden;
      }
      #${MODAL_ID} .pkt-rlm-bar > div {
        height: 100%; background: linear-gradient(90deg, #f5c842, #ff8c00);
        width: 100%; transition: width .3s;
      }
      #${MODAL_ID} h3 {
        font-size: 12px; font-weight: 600;
        text-transform: uppercase; letter-spacing: 0.8px;
        color: #f5c842; margin: 0 0 10px;
      }
      #${MODAL_ID} .pkt-rlm-providers {
        display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
        margin-bottom: 18px;
      }
      #${MODAL_ID} .pkt-rlm-provider {
        display: flex; align-items: center; gap: 10px;
        padding: 10px 12px; background: #1d1726;
        border: 1px solid rgba(255,255,255,0.08); border-radius: 8px;
        text-decoration: none; color: #f0ece4; transition: all .15s;
      }
      #${MODAL_ID} .pkt-rlm-provider:hover {
        background: #261d33; border-color: rgba(245,200,66,0.4);
        transform: translateY(-1px);
      }
      #${MODAL_ID} .pkt-rlm-provider .ic { font-size: 20px; flex-shrink: 0; }
      #${MODAL_ID} .pkt-rlm-provider .nm { font-weight: 600; font-size: 13px; }
      #${MODAL_ID} .pkt-rlm-provider .ds { font-size: 11px; color: rgba(240,236,228,0.55); margin-top: 2px; }
      #${MODAL_ID} .pkt-rlm-actions { display: flex; gap: 10px; }
      #${MODAL_ID} button.pkt-rlm-btn {
        flex: 1; padding: 11px 16px; border: none; border-radius: 8px;
        font-family: inherit; font-weight: 600; font-size: 13px;
        cursor: pointer; transition: all .15s;
      }
      #${MODAL_ID} .pkt-rlm-btn.primary {
        background: linear-gradient(135deg, #f5c842, #ff8c00); color: #1a1208;
      }
      #${MODAL_ID} .pkt-rlm-btn.primary:hover {
        background: linear-gradient(135deg, #ffd460, #f5c842);
      }
      #${MODAL_ID} .pkt-rlm-btn.ghost {
        background: transparent; color: rgba(240,236,228,0.7);
        border: 1px solid rgba(255,255,255,0.10);
      }
      #${MODAL_ID} .pkt-rlm-btn.ghost:hover {
        background: rgba(255,255,255,0.05); color: #f0ece4;
      }
      @media (max-width: 480px) {
        #${MODAL_ID} { padding: 22px 18px; }
        #${MODAL_ID} .pkt-rlm-providers { grid-template-columns: 1fr; }
      }
    `;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  function close() {
    const overlay = document.getElementById(`${MODAL_ID}-overlay`);
    if (overlay) overlay.remove();
  }

  function show(data = {}) {
    injectStyles();

    const used         = data.used ?? 0;
    const limit        = data.limit ?? 0;
    const reset        = data.reset || 'půlnoc CET';
    const usageType    = data.usageType || data.usage_type || 'AI';

    let overlay = document.getElementById(`${MODAL_ID}-overlay`);
    if (overlay) {
      const stats = overlay.querySelector('.pkt-rlm-stats span');
      if (stats) stats.textContent = `${used}/${limit} dnes využito · resetuje se v ${reset}`;
      return;
    }

    overlay = document.createElement('div');
    overlay.id = `${MODAL_ID}-overlay`;

    const providersHtml = PROVIDER_LINKS.map(p => `
      <a href="${p.url}" target="_blank" rel="noopener" class="pkt-rlm-provider">
        <span class="ic">${p.icon}</span>
        <span><span class="nm">${p.name}</span><br><span class="ds">${p.desc}</span></span>
      </a>
    `).join('');

    const usageLabel = usageType === 'fake' ? 'falešných karet'
                     : usageType === 'search' ? 'hledání karet'
                     : 'AI volání';

    overlay.innerHTML = `
      <div id="${MODAL_ID}" role="dialog" aria-modal="true" aria-labelledby="${MODAL_ID}-title" style="position:relative;">
        <button class="pkt-rlm-close" aria-label="Zavřít">×</button>
        <h2 id="${MODAL_ID}-title">🔑 Denní limit AI vyčerpán</h2>
        <p>
          Dnes jsi využil <strong>${used}/${limit}</strong> ${usageLabel} ze sdílených AI klíčů admina.
          Limit se obnoví v <strong>${reset}</strong>.
        </p>
        <div class="pkt-rlm-stats">
          <div class="pkt-rlm-bar"><div></div></div>
          <span>${used}/${limit} dnes využito</span>
        </div>
        <h3>Pro NEOMEZENÉ hledání si přidej vlastní klíč zdarma:</h3>
        <div class="pkt-rlm-providers">${providersHtml}</div>
        <div class="pkt-rlm-actions">
          <button type="button" class="pkt-rlm-btn ghost pkt-rlm-cancel">Později</button>
          <button type="button" class="pkt-rlm-btn primary pkt-rlm-open">Otevřít nastavení →</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('.pkt-rlm-close').addEventListener('click', close);
    overlay.querySelector('.pkt-rlm-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('.pkt-rlm-open').addEventListener('click', () => {
      window.location.href = 'profile.html#ai-providers';
    });
    function escHandler(e) {
      if (e.key === 'Escape') {
        close();
        document.removeEventListener('keydown', escHandler);
      }
    }
    document.addEventListener('keydown', escHandler);
  }

  // Helper: zachytit 429 RATE_LIMITED ve fetch flow
  // Použití:
  //   const r = await fetch('/api/groq', ...);
  //   if (await window.maybeShowRateLimitModal(r)) return;  // modal byl zobrazen
  //   const data = await r.json();
  // Pokud volající už má parsed JSON, předá ho jako 2. argument.
  async function maybeShow(response, errorData = null) {
    if (!response || response.status !== 429) return false;
    const data = errorData || await response.clone().json().catch(() => ({}));
    if (data?.code !== 'RATE_LIMITED') return false;
    show({
      used:      data.used,
      limit:     data.limit,
      reset:     data.reset,
      usageType: data.usageType || data.usage_type,
    });
    return true;
  }

  global.showRateLimitModal     = show;
  global.closeRateLimitModal    = close;
  global.maybeShowRateLimitModal = maybeShow;

})(typeof window !== 'undefined' ? window : globalThis);
