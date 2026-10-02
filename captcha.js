/* ═══════════════════════════════════════════════════════════════
   captcha.js — Cloudflare Turnstile pro přihlášení, registraci a reset hesla
   ───────────────────────────────────────────────────────────────
   Dokud je SITE_KEY prázdný, nedělá nic (web funguje jako dosud).

   ZAPNUTÍ (v tomto pořadí):
     1. Cloudflare → Turnstile → Add widget (poke-trade.eu, režim Managed)
     2. Site Key vlož níže do SITE_KEY a nasaď web
     3. Až pak: Supabase → Authentication → Attack Protection →
        Enable CAPTCHA protection, poskytovatel Turnstile, Secret Key
        (obráceně by se nikdo nepřihlásil)

   Použití v kódu:
     body: { email, password, ...(await PT_Captcha.pole()) }        // přihlášení, registrace
     body: { email, gotrue_meta_security: await PT_Captcha.bezpecnost() }  // reset hesla
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.PT_Captcha) return;

  var SITE_KEY = '';   // ← sem vlož Site Key z Cloudflare Turnstile (veřejný, ne Secret!)

  var nacitani = null;
  function nactiSkript() {
    if (window.turnstile) return Promise.resolve();
    if (nacitani) return nacitani;
    nacitani = new Promise(function (ok, ko) {
      var s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = function () { ok(); };
      s.onerror = function () { nacitani = null; ko(new Error('Ověření se nepodařilo načíst. Zkontroluj připojení.')); };
      document.head.appendChild(s);
    });
    return nacitani;
  }

  // Okno s ověřením. V režimu Managed většinou projde samo za vteřinu.
  function token() {
    if (!SITE_KEY) return Promise.resolve(null);
    return nactiSkript().then(function () {
      return new Promise(function (ok, ko) {
        var ov = document.createElement('div');
        ov.setAttribute('style', 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.6);' +
          'display:flex;align-items:center;justify-content:center;padding:16px');
        ov.innerHTML =
          '<div style="background:#1c1915;border:1px solid rgba(245,200,66,.3);border-radius:14px;padding:18px 18px 14px;' +
            'max-width:340px;width:100%;text-align:center;color:#f0ece4;font-family:inherit">' +
            '<div style="font-size:14px;margin-bottom:12px">🛡️ Ověřujeme, že nejsi robot…</div>' +
            '<div class="ptc-widget" style="display:flex;justify-content:center;min-height:65px"></div>' +
            '<button type="button" class="ptc-zrusit" style="margin-top:12px;background:none;border:none;' +
              'color:rgba(240,236,228,.55);font-size:12px;cursor:pointer">Zrušit</button>' +
          '</div>';
        document.body.appendChild(ov);
        var hotovo = false, id = null;
        function konec() {
          hotovo = true;
          try { if (id !== null) window.turnstile.remove(id); } catch (e) {}
          ov.remove();
        }
        ov.querySelector('.ptc-zrusit').onclick = function () {
          if (hotovo) return; konec(); ko(new Error('Ověření bylo zrušeno.'));
        };
        try {
          id = window.turnstile.render(ov.querySelector('.ptc-widget'), {
            sitekey: SITE_KEY, theme: 'dark', language: 'cs',
            callback: function (t) { if (hotovo) return; konec(); ok(t); },
            'error-callback': function () { if (hotovo) return; konec(); ko(new Error('Ověření se nezdařilo, zkus to znovu.')); },
            'expired-callback': function () { if (hotovo) return; konec(); ko(new Error('Ověření vypršelo, zkus to znovu.')); },
          });
        } catch (e) { konec(); ko(e); }
      });
    });
  }

  // Pro reset hesla: hodnota pole gotrue_meta_security
  function bezpecnost() {
    return token().then(function (t) { return t ? { captcha_token: t } : {}; });
  }
  // Pro přihlášení a registraci: pole k přidání do těla požadavku
  function pole() {
    return token().then(function (t) { return t ? { gotrue_meta_security: { captcha_token: t } } : {}; });
  }

  window.PT_Captcha = { token: token, bezpecnost: bezpecnost, pole: pole,
                        aktivni: function () { return !!SITE_KEY; } };
})();
