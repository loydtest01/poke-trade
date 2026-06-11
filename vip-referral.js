/* ════════════════════════════════════════════════════════════════════
 * vip-referral.js — VIP + Referral klientská logika pro PokéTrade
 * ════════════════════════════════════════════════════════════════════
 *
 * Co dělá:
 *   1. Při příchodu z /r/{code} URL — uloží referral kód do localStorage
 *   2. Po prvním loginu (claim) — pošle browser fingerprint + referral kód
 *      do RPC `claim_welcome_vip`, dostane VIP status (30 dní pro prvních
 *      100, pak 14 dní)
 *   3. Po každém uploadu karty — kontroluje jestli referee splnil 5+ karet
 *      a triggeruje qualify_referrals_for_user
 *   4. Vystavuje `window.VIP.isVIP()` a `window.VIP.daysLeft()` pro UI
 *
 * Závislosti: app.js (supabaseRequest, getUser, getToken)
 * Závislosti: SQL migrace migration_vip_referral.sql musí být spuštěná.
 *
 * Použití (v každé stránce):
 *   <script src="app.js"></script>
 *   <script src="vip-referral.js"></script>
 *   <!-- Modul se sám initnu na DOMContentLoaded -->
 */

(function() {
  'use strict';

  if (window.VIP) {
    console.log('[VIP] Modul už načten, přeskakuji.');
    return;
  }

  const REFERRAL_KEY    = 'pkc_referral_code';   // v localStorage
  const FP_KEY          = 'pkc_browser_fp';      // v localStorage (cache)
  const CLAIM_DONE_KEY  = 'pkc_vip_claimed';     // 1× per účet flag

  let _vipState = {
    isVip:      false,
    until:      null,
    daysLeft:   0,
    source:     null,
    loaded:     false,
  };

  // ── 1. Browser fingerprint ─────────────────────────────────────
  // Lehký fingerprint — kombinace screen, timezone, jazyka, font canvasu.
  // Záměrně ne tak agresivní jako fingerprintjs library — nechceme tracking,
  // jen detekci stejného zařízení pro anti-abuse VIP.

  async function _getFingerprint() {
    // Cache aby se nepočítalo při každém pageloadu
    const cached = localStorage.getItem(FP_KEY);
    if (cached && cached.length > 16) return cached;

    const parts = [];

    // 1. Screen
    parts.push(`${screen.width}x${screen.height}x${screen.colorDepth}`);

    // 2. Timezone
    try {
      parts.push(Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown');
    } catch (_) { parts.push('tz-unknown'); }

    // 3. Jazyk
    parts.push(navigator.language || 'lang-unknown');

    // 4. Platform + UA hash (zkrácený)
    parts.push(navigator.platform || 'pf-unknown');
    parts.push((navigator.userAgent || '').slice(0, 80));

    // 5. Canvas fingerprint — kreslení textu, jeho hash
    try {
      const c = document.createElement('canvas');
      c.width = 200; c.height = 50;
      const ctx = c.getContext('2d');
      ctx.font = "16px 'Arial'";
      ctx.fillStyle = '#a3f';
      ctx.fillText('PokéTrade-fp-202X', 2, 18);
      ctx.strokeStyle = '#3fa';
      ctx.beginPath(); ctx.arc(100, 30, 15, 0, Math.PI * 2); ctx.stroke();
      parts.push(c.toDataURL().slice(-32));
    } catch (_) { parts.push('canvas-fail'); }

    // SHA256 přes všechny části
    const raw = parts.join('|');
    let hash;
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
      hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
    } catch (_) {
      // Fallback bez crypto API
      let h = 0;
      for (let i = 0; i < raw.length; i++) h = ((h << 5) - h + raw.charCodeAt(i)) | 0;
      hash = 'fallback-' + Math.abs(h).toString(16);
    }

    localStorage.setItem(FP_KEY, hash);
    return hash;
  }

  // ── 2. Capture referral z URL ───────────────────────────────────
  // /r/{code} → uloží do localStorage. Volá se na každém pageloadu.

  function _captureReferralFromUrl() {
    // Cesta může být /r/{code} nebo /index.html?ref={code}
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);

    let code = null;

    // /r/{code}
    const m = path.match(/^\/r\/([a-zA-Z0-9_-]{4,32})\/?$/);
    if (m) code = m[1];

    // ?ref={code}
    if (!code && params.has('ref')) {
      const r = params.get('ref');
      if (r && /^[a-zA-Z0-9_-]{4,32}$/.test(r)) code = r;
    }

    if (code) {
      // Ulož jen pokud ještě nemá nebo má jiný (poslední vyhrává — last-touch attribution)
      const existing = localStorage.getItem(REFERRAL_KEY);
      if (existing !== code) {
        localStorage.setItem(REFERRAL_KEY, code);
        console.log(`[VIP] Referral kód uložen: ${code}`);
      }

      // Pokud je na /r/{code}, redirect na / (čistá URL)
      if (m) {
        window.location.replace('/');
      }
    }
  }

  // ── 3. Claim welcome VIP (1× per účet) ─────────────────────────
  // Volá se po loginu. Pokud uživatel už claimnul, RPC vrátí 'already_claimed'.

  async function _claimWelcomeVip() {
    const user = (typeof getUser === 'function') ? getUser() : null;
    if (!user) return null;

    // Local cache: claimnul už?
    const localFlag = localStorage.getItem(CLAIM_DONE_KEY + '_' + user.id);
    if (localFlag === '1') {
      console.log('[VIP] Lokálně označeno jako claimed, přeskakuji.');
      return null;
    }

    const fp = await _getFingerprint();
    const refCode = localStorage.getItem(REFERRAL_KEY) || null;

    try {
      const resp = await supabaseRequest('rest/v1/rpc/claim_welcome_vip', 'POST', {
        p_user_id:       user.id,
        p_browser_fp:    fp,
        p_referral_code: refCode,
      });

      // Mark jako claimed lokálně bez ohledu na výsledek (server řeší duplicity)
      localStorage.setItem(CLAIM_DONE_KEY + '_' + user.id, '1');
      // Vyčisti referral kód po použití
      localStorage.removeItem(REFERRAL_KEY);

      if (resp && resp.success) {
        console.log(`[VIP] Welcome VIP uděleno: ${resp.vip_days === -1 ? 'LIFETIME' : resp.vip_days + ' dní'} (${resp.vip_source})`);
        if (resp.lifetime || resp.vip_source === 'lifetime_first_10' || resp.vip_source === 'whitelist') {
          _showLifetimeToast(resp.vip_source);
        } else if (resp.first_100) {
          _showFirst100Toast(resp.vip_days);
        } else {
          _showWelcomeToast(resp.vip_days);
        }
        return resp;
      } else {
        console.log(`[VIP] Welcome VIP NE uděleno: ${resp?.reason || 'unknown'}`);
        if (resp?.reason === 'duplicate_fingerprint') {
          // Tichý fail — neukazujeme nic uživateli aby nevěděl jak to obejít
        }
        return resp;
      }
    } catch (e) {
      console.error('[VIP] claim_welcome_vip selhal:', e);
      return null;
    }
  }

  function _showLifetimeToast(source) {
    var msg = source === 'whitelist'
      ? '⭐ Vítej zpátky! Tvůj účet má LIFETIME VIP — všechny prémiové funkce navždy zdarma.'
      : '🌟 Gratulujeme! Patříš mezi prvních 10 uživatelů — máš VIP NAVŽDY zdarma!';
    _toast(msg, 'success', 9000);
  }

  function _showFirst100Toast(days) {
    _toast(`🎉 Gratulujeme! Patříš mezi prvních 100 uživatelů — máš VIP na ${days} dní zdarma!`, 'success', 7000);
  }

  function _showWelcomeToast(days) {
    _toast(`✨ Vítej v PokéTradě! Dostal jsi VIP na ${days} dní zdarma.`, 'success', 5000);
  }

  function _toast(msg, type = 'info', duration = 4000) {
    // Použije sdílenou toast funkci pokud existuje, jinak custom
    if (typeof window.showToast === 'function') {
      return window.showToast(msg, type, duration);
    }
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;top:80px;right:20px;background:${type==='success'?'#1e3a2e':'#1e2a3a'};color:#fff;padding:14px 18px;border-radius:8px;border:1px solid ${type==='success'?'#3a7a52':'#3a5a8a'};z-index:9999;max-width:380px;box-shadow:0 4px 16px rgba(0,0,0,.4);font-size:14px;line-height:1.4`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), duration);
  }

  // ── 4. Load VIP status z DB ─────────────────────────────────────

  async function _loadVipStatus() {
    const user = (typeof getUser === 'function') ? getUser() : null;
    if (!user) {
      _vipState = { isVip: false, until: null, daysLeft: 0, source: null, loaded: true };
      return _vipState;
    }

    try {
      const data = await supabaseRequest(
        `rest/v1/profiles?id=eq.${user.id}&select=vip_until,vip_source,referral_code,referrals_count`
      );
      const row = Array.isArray(data) ? data[0] : null;
      if (!row) return _vipState;

      const until    = row.vip_until ? new Date(row.vip_until) : null;
      const isVip    = until && until > new Date();
      const daysLeft = isVip ? Math.max(0, Math.ceil((until - new Date()) / 86400000)) : 0;
      // Lifetime VIP = whitelist (vip_until = '9999-12-31') nebo vip_source === 'whitelist'
      // nebo vip_source === 'lifetime_first_10' (prvních 10 reálných uživatelů).
      // Detekujeme to z vip_source aby UI mohlo zobrazit "VIP navždy" místo počtu dní.
      const isLifetime = row.vip_source === 'whitelist'
                       || row.vip_source === 'lifetime_first_10'
                       || (until && until.getFullYear() >= 9000);

      _vipState = {
        isVip,
        isLifetime,
        until:    until ? until.toISOString() : null,
        daysLeft,
        source:   row.vip_source,
        referralCode:    row.referral_code,
        referralsCount:  row.referrals_count || 0,
        loaded:   true,
      };
      return _vipState;
    } catch (e) {
      console.error('[VIP] Load status failed:', e);
      return _vipState;
    }
  }

  // ── 5. Referral qualification po uploadu karet ──────────────────
  // Volá se po každém uploadu. Pokud máme pending referral a nahráli jsme 5+ karet,
  // server přepne event na 'rewarded' a referrerovi přibude 30 dní VIP.

  async function _checkReferralQualification(cardCount) {
    const user = (typeof getUser === 'function') ? getUser() : null;
    if (!user) return null;
    if (!cardCount || cardCount < 5) return null;  // pod prahem nezatěžuj DB

    try {
      const resp = await supabaseRequest('rest/v1/rpc/qualify_referrals_for_user', 'POST', {
        p_user_id:    user.id,
        p_card_count: cardCount,
      });
      if (resp && resp.qualified > 0) {
        console.log(`[VIP] Referral kvalifikován! Referrer ${resp.referrer_id} dostal +30 dní VIP.`);
      }
      return resp;
    } catch (e) {
      console.warn('[VIP] qualify_referrals_for_user fail:', e);
      return null;
    }
  }

  // ── 6. First 100 status (pro index banner) ──────────────────────

  async function _getFirst100Status() {
    try {
      const data = await supabaseRequest('rest/v1/first_100_status?select=*');
      const row = Array.isArray(data) ? data[0] : null;
      return row || { granted: 0, remaining: 100, total: 100, available: true };
    } catch (e) {
      return { granted: 0, remaining: 100, total: 100, available: true };
    }
  }

  // ── 6b. Lifetime status (prvních 10 dostane VIP navždy) ─────────
  async function _getLifetimeStatus() {
    try {
      const data = await supabaseRequest('rest/v1/lifetime_vip_status?select=*');
      const row = Array.isArray(data) ? data[0] : null;
      return row || { granted: 0, remaining: 10, total: 10, available: true };
    } catch (e) {
      return { granted: 0, remaining: 10, total: 10, available: true };
    }
  }

  // ── 7. Init flow ────────────────────────────────────────────────

  async function init() {
    // 1) Vždy capture referral z URL (i pro nepřihlášené)
    _captureReferralFromUrl();

    // 2) Pokud user přihlášen → claim + load status
    const user = (typeof getUser === 'function') ? getUser() : null;
    if (user) {
      // Counter běží jen pokud je login. Claim je idempotentní (1× per účet).
      await _claimWelcomeVip();
      await _loadVipStatus();
    }
  }

  // ── 8. Public API ───────────────────────────────────────────────

  window.VIP = {
    init,
    isVIP:        () => _vipState.isVip,
    isLifetime:   () => !!_vipState.isLifetime,    // whitelist accounts (Loyd, family, beta-testers)
    daysLeft:     () => _vipState.daysLeft,
    source:       () => _vipState.source,
    referralCode: () => _vipState.referralCode,
    referralUrl:  () => _vipState.referralCode ? `https://poke-trade.eu/r/${_vipState.referralCode}` : null,
    referralsCount: () => _vipState.referralsCount || 0,
    state:        () => Object.assign({}, _vipState),
    refresh:      _loadVipStatus,
    getFirst100Status: _getFirst100Status,
    getLifetimeStatus: _getLifetimeStatus,
    checkReferralQualification: _checkReferralQualification,
    getFingerprint:    _getFingerprint,
  };

  // Auto-init na DOMContentLoaded (po app.js)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      // Pauza 200ms aby app.js stihl načíst usera
      setTimeout(() => init(), 200);
    });
  } else {
    setTimeout(() => init(), 200);
  }
})();
