/**
 * fake-detector.js – PokéTrade AI detektor falzifikátů
 *
 * Používá Claude vision API (stejný pattern jako marketplace.html).
 * Volej FakeDetector.analyze(imageSource, cardInfo) kde:
 *   imageSource  = URL stringu nebo base64 data URI
 *   cardInfo     = { name, set, number, hp, rarity } (volitelné – upřesní analýzu)
 *
 * Vrací Promise<FakeResult>:
 *   { verdict, score, confidence, flags, summary, rawResponse }
 *   verdict    = 'real' | 'fake' | 'suspicious' | 'unknown'
 *   score      = 0–100 (100 = jistě pravá)
 *   confidence = 'high' | 'med' | 'low'
 *   flags      = pole problémů, každý { label, severity: 'ok'|'warn'|'fail' }
 */

(function (global) {
  'use strict';

  // ── Prompt pro Claude ────────────────────────────────────────
  function buildPrompt(cardInfo) {
    const hint = cardInfo
      ? `Karta by měla být: ${cardInfo.name || '?'}${cardInfo.set ? ' · ' + cardInfo.set : ''}${cardInfo.number ? ' #' + cardInfo.number : ''}${cardInfo.hp ? ' · ' + cardInfo.hp + ' HP' : ''}${cardInfo.rarity ? ' · ' + cardInfo.rarity : ''}.`
      : '';

    return `You are an expert Pokémon TCG card authenticator with deep knowledge of printing artifacts, card stock, and design standards across all sets.

${hint}

Carefully examine this card photo for authenticity. Check ALL of the following:

TYPOGRAPHY & TEXT:
- Font matches official Pokémon TCG fonts (Futura-like for names, specific fonts per era)
- HP value is plausible (not absurdly high like 9999, 9900 etc.)
- Attack names, damage values and energy costs are consistent
- Ability/move descriptions use correct official grammar and phrasing
- Set number format correct (e.g. 025/198 not 025/199)

VISUAL DESIGN:
- Card border width and color correct for the era/set
- Type symbols (energy icons) look sharp and correctly colored
- Rarity symbol (circle/diamond/star) matches claimed rarity
- Evolution stage banner (Basic/Stage 1/Stage 2) present and correct
- Weakness/Resistance/Retreat cost section looks right
- Illustrator credit visible and plausible

PRINT QUALITY:
- Colors look saturated correctly (not too dull, not oversaturated)
- No visible pixel artifacts, blur or JPEG compression on text
- Holographic foil pattern (if applicable) matches official patterns
- Card texture seems consistent (not glossy where it should be matte)
- No misalignment between layers
- Copyright line at bottom (© Nintendo/Creatures/GAME FREAK + year)

CARD STOCK INDICATORS (if visible):
- Card thickness appears normal (single layer, no peeling)
- Edges appear clean, not rough or home-cut

Respond ONLY with this JSON (no explanation, no markdown):
{
  "verdict": "real|fake|suspicious|unknown",
  "score": 0-100,
  "confidence": "high|med|low",
  "summary": "1-2 sentence verdict in Czech",
  "flags": [
    { "label": "...", "severity": "ok|warn|fail", "detail": "..." }
  ]
}

verdict meanings:
- real: card appears genuine (score ≥ 75)
- suspicious: some red flags but not conclusive (score 40-74)
- fake: clear indicators of counterfeit (score < 40)
- unknown: image too blurry/small/partial to assess

Include 4-8 flags covering the most important checks. Always include at least the HP check, font check, and print quality check.
severity meanings: ok = passed, warn = minor issue, fail = serious red flag.`;
  }

  // ── Hlavní funkce ────────────────────────────────────────────
  async function analyze(imageSource, cardInfo = null) {
    // Získej base64 + mimeType
    let base64, mimeType;

    if (imageSource.startsWith('data:')) {
      // Data URI
      const [header, data] = imageSource.split(',');
      base64   = data;
      mimeType = header.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
    } else if (imageSource.startsWith('http')) {
      // URL – fetch a převeď na base64
      try {
        const resp = await fetch(imageSource);
        const blob = await resp.blob();
        mimeType   = blob.type || 'image/jpeg';
        base64     = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload  = () => res(r.result.split(',')[1]);
          r.onerror = rej;
          r.readAsDataURL(blob);
        });
      } catch (e) {
        return _errorResult('Nepodařilo se načíst obrázek: ' + e.message);
      }
    } else {
      return _errorResult('Nepodporovaný formát obrázku');
    }

    // Zavolej Claude vision
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 600,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
              { type: 'text',  text: buildPrompt(cardInfo) }
            ]
          }]
        })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err?.error?.message || 'HTTP ' + response.status);
      }

      const data    = await response.json();
      const rawText = data.content?.map(b => b.text || '').join('') || '{}';
      const clean   = rawText.replace(/```json|```/g, '').trim();
      const result  = JSON.parse(clean);

      // Sanitize
      result.verdict    = ['real','fake','suspicious','unknown'].includes(result.verdict) ? result.verdict : 'unknown';
      result.score      = Math.max(0, Math.min(100, parseInt(result.score) || 50));
      result.confidence = ['high','med','low'].includes(result.confidence) ? result.confidence : 'low';
      result.flags      = Array.isArray(result.flags) ? result.flags : [];
      result.summary    = result.summary || '';

      return result;

    } catch (e) {
      if (e.message?.includes('JSON')) {
        return _errorResult('AI vrátila neplatnou odpověď – zkus znovu');
      }
      return _errorResult('Chyba AI analýzy: ' + e.message);
    }
  }

  function _errorResult(msg) {
    return {
      verdict: 'unknown', score: 50, confidence: 'low',
      summary: msg,
      flags: [{ label: 'Chyba analýzy', severity: 'warn', detail: msg }],
      error: true,
    };
  }

  // ── Render výsledku do HTML elementu ────────────────────────
  function renderResult(result, containerEl) {
    if (!containerEl) return;

    const verdictCfg = {
      real:       { emoji: '✅', label: 'Pravá karta',   color: '#22c55e', bg: 'rgba(34,197,94,.12)',   border: 'rgba(34,197,94,.3)'  },
      fake:       { emoji: '❌', label: 'FALZUM',         color: '#f87171', bg: 'rgba(248,113,113,.12)', border: 'rgba(248,113,113,.4)'},
      suspicious: { emoji: '⚠️', label: 'Podezřelá',     color: '#f59e0b', bg: 'rgba(245,158,11,.12)',  border: 'rgba(245,158,11,.3)' },
      unknown:    { emoji: '❓', label: 'Nelze určit',   color: '#94a3b8', bg: 'rgba(148,163,184,.1)',  border: 'rgba(148,163,184,.2)'},
    };
    const v    = verdictCfg[result.verdict] || verdictCfg.unknown;
    const conf = { high: 'Vysoká', med: 'Střední', low: 'Nízká' }[result.confidence] || '';

    const severityIcon = { ok: '✓', warn: '⚠', fail: '✗' };
    const severityColor = { ok: '#22c55e', warn: '#f59e0b', fail: '#f87171' };

    const scoreBar = `
      <div style="margin:10px 0 4px;font-size:10px;color:rgba(240,232,208,.4);letter-spacing:.06em;text-transform:uppercase">Skóre pravosti</div>
      <div style="background:rgba(255,255,255,.07);border-radius:8px;height:8px;overflow:hidden">
        <div style="height:100%;width:${result.score}%;background:${v.color};border-radius:8px;transition:width .6s ease"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:10px;color:rgba(240,232,208,.4);margin-top:3px">
        <span>Falzum</span><span style="color:${v.color};font-weight:700">${result.score}/100</span><span>Pravá</span>
      </div>`;

    const flagsHtml = result.flags.map(f => `
      <div style="display:flex;gap:8px;align-items:flex-start;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04)">
        <span style="color:${severityColor[f.severity]||'#94a3b8'};font-size:12px;flex-shrink:0;font-weight:700">${severityIcon[f.severity]||'?'}</span>
        <div>
          <div style="font-size:12px;color:rgba(240,232,208,.8);font-weight:600">${esc(f.label||'')}</div>
          ${f.detail ? `<div style="font-size:11px;color:rgba(240,232,208,.4);margin-top:1px">${esc(f.detail)}</div>` : ''}
        </div>
      </div>`).join('');

    containerEl.innerHTML = `
      <div style="border:1px solid ${v.border};background:${v.bg};border-radius:12px;padding:14px;margin-top:10px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <span style="font-size:24px">${v.emoji}</span>
          <div style="flex:1">
            <div style="font-size:15px;font-weight:800;color:${v.color};font-family:'Unbounded',sans-serif">${v.label}</div>
            <div style="font-size:11px;color:rgba(240,232,208,.45);margin-top:2px">Spolehlivost: ${conf}</div>
          </div>
        </div>
        ${scoreBar}
        ${result.summary ? `<div style="font-size:12px;color:rgba(240,232,208,.7);margin:10px 0 8px;line-height:1.5">${esc(result.summary)}</div>` : ''}
        <div style="margin-top:8px">${flagsHtml}</div>
        <div style="font-size:10px;color:rgba(240,232,208,.25);margin-top:10px;text-align:right">🤖 Analýza: Claude AI · Vždy zkontroluj fyzicky</div>
      </div>`;
  }

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Export ───────────────────────────────────────────────────
  const FakeDetector = { analyze, renderResult };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = FakeDetector;
  } else {
    global.FakeDetector = FakeDetector;
  }

})(typeof window !== 'undefined' ? window : globalThis);
