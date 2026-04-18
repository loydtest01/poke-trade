/**
 * site-tracking.js – návštěvnost pro PokéTrade
 *
 * Přidej na každou stránku kde chceš počítat návštěvy:
 *   <script src="site-tracking.js"></script>
 *
 * Session logika:
 *   - 1 session = 1 návštěva (i když uživatel projde 10 stránek)
 *   - Zavření/nový tab = nová session = nová návštěva
 *   - sessionStorage klíč: pkc_visit_recorded
 */
(async function siteTracking() {
  if (sessionStorage.getItem('pkc_visit_recorded')) return; // již v této session zaznamenáno

  var SBU = 'https://xrduqwrinzvmpixgmqta.supabase.co';
  var SBA = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyZHVxd3Jpbnp2bXBpeGdtcXRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDI0MjksImV4cCI6MjA5MDk3ODQyOX0.2p404Vy77CH_MsvQlnpxaO0H-KlSSt_oJlaFrmttFXs';
  var EXCLUDED_IPS = ['192.168.0.88'];

  try {
    var ipResp = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(3000) });
    var myIP   = (await ipResp.json()).ip;
    if (!myIP || EXCLUDED_IPS.includes(myIP)) return;

    await fetch(SBU + '/rest/v1/site_visits', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SBA,
        'Authorization': 'Bearer ' + SBA,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        ip:         myIP,
        page:       location.pathname.replace(/.*\//, '').replace('.html', '') || 'index',
        visited_at: new Date().toISOString()
      })
    });

    sessionStorage.setItem('pkc_visit_recorded', '1');
  } catch(e) { /* potichu ignoruj */ }
})();
