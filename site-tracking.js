/**
 * site-tracking.js – návštěvnost PokéTrade
 * Přidej na každou stránku: <script src="site-tracking.js"></script>
 * - Sleduje VŠECHNY stránky
 * - Panel se zobrazí POUZE adminovi a POUZE na index.html
 */
(async function siteTracking() {
  var SBU          = 'https://xrduqwrinzvmpixgmqta.supabase.co';
  var SBA          = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyZHVxd3Jpbnp2bXBpeGdtcXRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDI0MjksImV4cCI6MjA5MDk3ODQyOX0.2p404Vy77CH_MsvQlnpxaO0H-KlSSt_oJlaFrmttFXs';
  var ADMIN_EMAIL  = 'papez.ondrej@gmail.com';
  var EXCLUDED_IPS = ['192.168.0.88'];
  var TABLE        = 'site_visits';

  /* ── 1. Přečti email z Supabase session (v2 formát) ── */
  var userEmail = '';
  var tk = SBA;
  try {
    var sbKey = Object.keys(localStorage).find(function(k) {
      return k.startsWith('sb-') && k.endsWith('-auth-token');
    });
    if (sbKey) {
      var sess = JSON.parse(localStorage.getItem(sbKey) || 'null');
      if (sess && sess.user) {
        userEmail = sess.user.email || '';
        tk = sess.access_token || SBA;
      }
    }
  } catch(e) {}

  /* ── 2. Zaznamenej návštěvu 1x za session ── */
  if (!sessionStorage.getItem('pkc_visit_recorded')) {
    try {
      var myIP = 'unknown';
      try {
        var ipR = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(4000) });
        myIP = (await ipR.json()).ip || 'unknown';
      } catch(e) {}

      if (!EXCLUDED_IPS.includes(myIP)) {
        var res = await fetch(SBU + '/rest/v1/' + TABLE, {
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
        if (res.ok || res.status === 201) {
          sessionStorage.setItem('pkc_visit_recorded', '1');
        }
      }
    } catch(e) {}
  }

  /* ── 3. Panel jen pro admina, jen na index.html ── */
  var page = location.pathname.replace(/.*\//, '');
  var isIndex = (page === 'index.html' || page === '' || page === '/');
  if (userEmail !== ADMIN_EMAIL || !isIndex) return;

  var panel = document.getElementById('adminVisitorPanel');
  if (!panel) return;
  panel.style.display = 'block';

  /* ── 4. Statistiky ── */
  async function getUniqueIPs(filter) {
    try {
      var url = SBU + '/rest/v1/' + TABLE + '?' + (filter ? filter + '&' : '') + 'select=ip';
      var r = await fetch(url, { headers: { 'apikey': SBA, 'Authorization': 'Bearer ' + tk } });
      var rows = await r.json();
      if (!Array.isArray(rows)) return '!';
      return new Set(rows.map(function(x) { return x.ip; })).size;
    } catch(e) { return '?'; }
  }

  var now        = new Date();
  var todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  var weekStart  = new Date(now); weekStart.setDate(weekStart.getDate() - 7); weekStart.setHours(0, 0, 0, 0);

  var results = await Promise.all([
    getUniqueIPs('visited_at=gte.' + todayStart.toISOString()),
    getUniqueIPs('visited_at=gte.' + weekStart.toISOString()),
    getUniqueIPs('')
  ]);

  document.getElementById('visitorToday').textContent = results[0];
  document.getElementById('visitorWeek').textContent  = results[1];
  document.getElementById('visitorTotal').textContent = results[2];
})();
