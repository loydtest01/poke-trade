/**
 * api/cron/email-digest.js — PokéTrade: Emailová upozornění na nové nabídky
 * ═══════════════════════════════════════════════════════════════════════════
 * Vercel Cron Job — spouští se automaticky dle vercel.json:
 *   - Denní digest:   každý den v 8:00 ráno
 *   - Týdenní digest: každé pondělí v 8:00 ráno (filtruje dle user preference)
 *
 * Env vars (nastav v Vercel → Settings → Environment Variables):
 *   GMAIL_USER         = pokecards.app.info@gmail.com
 *   GMAIL_PASS         = tvůj App Password (16 znaků)
 *   SUPABASE_SERVICE_KEY = service_role klíč ze Supabase → Settings → API
 *   CRON_SECRET        = libovolný tajný řetězec pro ochranu endpointu
 *
 * Endpoint lze také ručně spustit:
 *   GET /api/cron/email-digest?secret=CRON_SECRET&mode=daily
 *   GET /api/cron/email-digest?secret=CRON_SECRET&mode=weekly
 */

import nodemailer from 'nodemailer';

// ═══════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════
const SUPABASE_URL     = 'https://xrduqwrinzvmpixgmqta.supabase.co';
const SUPABASE_ANON    = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyZHVxd3Jpbnp2bXBpeGdtcXRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDI0MjksImV4cCI6MjA5MDk3ODQyOX0.2p404Vy77CH_MsvQlnpxaO0H-KlSSt_oJlaFrmttFXs';
const APP_URL          = 'https://poke-trade-ruddy.vercel.app';

function getServiceKey() { return process.env.SUPABASE_SERVICE_KEY || SUPABASE_ANON; }
function getGmailUser()  { return process.env.GMAIL_USER || ''; }
function getGmailPass()  { return process.env.GMAIL_PASS || ''; }
function getCronSecret() { return process.env.CRON_SECRET || ''; }

// ═══════════════════════════════════════════════════════════
// HANDLER
// ═══════════════════════════════════════════════════════════
export default async function handler(req, res) {
  // Ochrana — pouze Vercel Cron nebo manuální volání se secret
  const secret = req.query.secret || req.headers['x-cron-secret'];
  const cronHeader = req.headers['x-vercel-cron'];
  if (!cronHeader && secret !== getCronSecret()) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Zjisti mode: daily nebo weekly
  const today = new Date();
  const isMonday = today.getDay() === 1;
  const mode = req.query.mode || 'daily';

  try {
    const result = await runDigest(mode);
    return res.status(200).json({ ok: true, mode, ...result });
  } catch (err) {
    console.error('[email-digest] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}

// ═══════════════════════════════════════════════════════════
// HLAVNÍ LOGIKA
// ═══════════════════════════════════════════════════════════
async function runDigest(mode) {
  const hoursBack = mode === 'weekly' ? 168 : 24; // 7 dní nebo 24h
  const since = new Date(Date.now() - hoursBack * 3600 * 1000).toISOString();

  // 1. Načti nové listingy
  const listings = await fetchNewListings(since);
  if (!listings.length) {
    return { sent: 0, skipped: 0, reason: 'Žádné nové nabídky' };
  }

  // 2. Načti uživatele s emailovými preferencemi
  const users = await fetchUsersWithEmailPrefs(mode);
  if (!users.length) {
    return { sent: 0, skipped: 0, reason: 'Žádní uživatelé s aktivními preferencemi' };
  }

  // 3. Nodemailer transport
  const transport = createTransport();

  let sent = 0, skipped = 0, inappCreated = 0;

  for (const user of users) {
    const prefs = user.notification_prefs || {};
    if (!user.email) { skipped++; continue; }

    // Filtruj listingy dle preferencí uživatele
    const filtered = filterListingsForUser(listings, prefs);
    if (!filtered.length) { skipped++; continue; }

    // Pošli email
    try {
      await sendDigestEmail(transport, user.email, user.username, filtered, prefs, mode);
      sent++;
    } catch (e) {
      console.error('[email-digest] Email failed for', user.email, e.message);
      skipped++;
    }

    // Vytvoř in-app notifikaci (pokud má zapnuté inapp_listings)
    if (prefs.inapp_listings !== false) {
      try {
        await createInAppNotification(user.id, filtered.length, mode);
        inappCreated++;
      } catch(e) {}
    }
  }

  return { sent, skipped, inappCreated, listings: listings.length, users: users.length };
}

// ═══════════════════════════════════════════════════════════
// SUPABASE HELPERS
// ═══════════════════════════════════════════════════════════
async function sbFetch(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      'Content-Type':  'application/json',
      'apikey':        getServiceKey(),
      'Authorization': 'Bearer ' + getServiceKey(),
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${SUPABASE_URL}/${path}`, opts);
  const text = await r.text();
  return text ? JSON.parse(text) : {};
}

async function fetchNewListings(since) {
  const data = await sbFetch(
    `rest/v1/listings?status=eq.active&created_at=gte.${since}` +
    `&select=id,title,username,card_name,card_set,card_rarity,price_eur,price_czk,` +
    `listing_category,allow_trade,allow_offer,api_image_url,created_at` +
    `&order=created_at.desc&limit=50`
  );
  return Array.isArray(data) ? data : [];
}

async function fetchUsersWithEmailPrefs(mode) {
  // Načti všechny profily s email preferencemi
  const data = await sbFetch(
    `rest/v1/profiles?select=id,email,username,notification_prefs` +
    `&notification_prefs->>email_new_listings=eq.true&is_banned=eq.false`
  );
  if (!Array.isArray(data)) return [];

  // Filtruj dle mode (weekly digest = jen ti kdo mají weekly nebo mají weekly digest zapnutý)
  return data.filter(u => {
    const p = u.notification_prefs || {};
    if (mode === 'weekly') {
      // Pošli weekly digest těm, kdo mají email_weekly nebo email_frequency=weekly
      return p.email_weekly || p.email_frequency === 'weekly';
    }
    // Daily — těm co nemají weekly frekvenci
    return p.email_frequency !== 'weekly';
  });
}

async function createInAppNotification(userId, count, mode) {
  const label = mode === 'weekly' ? 'týden' : 'den';
  await sbFetch('rest/v1/notifications', 'POST', {
    user_id:    userId,
    type:       'new_listings_digest',
    title:      `🛒 ${count} nových nabídek za ${label}`,
    body:       `Podívej se na nové nabídky na PokéTrade marketplace`,
    link:       `${APP_URL}/marketplace.html`,
    metadata:   { count, mode },
    read:       false
  });
}

// ═══════════════════════════════════════════════════════════
// FILTROVÁNÍ NABÍDEK DLE PREFERENCÍ
// ═══════════════════════════════════════════════════════════
function filterListingsForUser(listings, prefs) {
  return listings.filter(l => {
    // Kategorie
    const cat = prefs.email_listings_cat || 'all';
    if (cat === 'cards'  && l.listing_category !== 'card')   return false;
    if (cat === 'sealed' && l.listing_category !== 'sealed') return false;

    // Typ nabídky (výměna)
    if (prefs.email_trade === false && l.allow_trade && !l.allow_offer) return false;

    // Cenová hranice (price alert)
    if (prefs.email_price_alert) {
      const threshold = parseFloat(
        typeof localStorage !== 'undefined'
          ? localStorage.getItem('pkc_exp_threshold') || '20'
          : '20'
      );
      // Na serveru threshold neznáme, zahrneme vše
    }

    return true;
  });
}

// ═══════════════════════════════════════════════════════════
// NODEMAILER
// ═══════════════════════════════════════════════════════════
function createTransport() {
  return nodemailer.createTransport({
    host:   'smtp.gmail.com',
    port:   465,
    secure: true,
    auth: {
      user: getGmailUser(),
      pass: getGmailPass(),
    },
  });
}

async function sendDigestEmail(transport, email, username, listings, prefs, mode) {
  const subject = mode === 'weekly'
    ? `📦 Týdenní přehled PokéTrade — ${listings.length} nových nabídek`
    : `🛒 Nové nabídky na PokéTrade — ${listings.length} ${listings.length === 1 ? 'nabídka' : 'nabídek'}`;

  const html = buildEmailHtml(username, listings, prefs, mode);

  await transport.sendMail({
    from:    `"PokéTrade" <${getGmailUser()}>`,
    to:      email,
    subject,
    html,
  });
}

// ═══════════════════════════════════════════════════════════
// EMAIL HTML ŠABLONA
// ═══════════════════════════════════════════════════════════
function buildEmailHtml(username, listings, prefs, mode) {
  const catLabel = {
    all:    '🃏+📦 Vše',
    cards:  '🃏 Kartičky',
    sealed: '📦 Sealed produkty'
  }[prefs.email_listings_cat || 'all'] || 'Vše';

  const listingRows = listings.slice(0, 12).map(l => {
    const price = l.price_eur
      ? `€ ${parseFloat(l.price_eur).toFixed(2)}`
      : (l.price_czk ? `${l.price_czk} Kč` : '—');
    const cat = l.listing_category === 'sealed' ? '📦 Sealed' : '🃏 Karta';
    const type = l.allow_trade && !l.allow_offer ? '🔄 Výměna' : (l.allow_trade ? '💰🔄 Prodej+Výměna' : '💰 Prodej');
    const name = l.card_name || l.title || 'Nabídka';
    const set  = l.card_set  ? ` · ${l.card_set}` : '';
    const link = `${APP_URL}/marketplace.html`;

    return `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #1e1b2e;">
        <div style="font-size:13px;font-weight:600;color:#f0ece4;">${escHtml(name)}${escHtml(set)}</div>
        <div style="font-size:11px;color:rgba(240,236,228,0.45);margin-top:2px;">${cat} · ${type} · ${escHtml(l.username)}</div>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #1e1b2e;text-align:right;white-space:nowrap;">
        <span style="font-size:14px;font-weight:700;color:#f5c842;">${price}</span>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #1e1b2e;text-align:right;">
        <a href="${link}" style="background:rgba(245,200,66,0.15);color:#f5c842;border:1px solid rgba(245,200,66,0.3);border-radius:6px;padding:4px 10px;font-size:11px;text-decoration:none;font-weight:600;">Zobrazit →</a>
      </td>
    </tr>`;
  }).join('');

  const moreCount = listings.length > 12 ? listings.length - 12 : 0;

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0812;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">

    <!-- Header -->
    <div style="text-align:center;padding:28px 0 20px;">
      <div style="font-size:28px;margin-bottom:8px;">🃏</div>
      <div style="font-family:'Arial Black',Arial,sans-serif;font-size:22px;font-weight:900;color:#f5c842;letter-spacing:-0.5px;">PokéTrade</div>
      <div style="font-size:12px;color:rgba(240,236,228,0.4);margin-top:4px;">
        ${mode === 'weekly' ? 'Týdenní přehled nabídek' : 'Nové nabídky dnes'}
      </div>
    </div>

    <!-- Intro -->
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:18px 20px;margin-bottom:16px;">
      <p style="margin:0;font-size:14px;color:rgba(240,236,228,0.75);line-height:1.6;">
        Ahoj <strong style="color:#f0ece4;">${escHtml(username || 'obchodníku')}</strong>! 👋<br>
        Za ${mode === 'weekly' ? 'poslední týden' : 'posledních 24 hodin'} přibylo
        <strong style="color:#f5c842;">${listings.length} nových nabídek</strong>
        (kategorie: ${catLabel}).
      </p>
    </div>

    <!-- Tabulka nabídek -->
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:14px;overflow:hidden;margin-bottom:16px;">
      <div style="padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.07);">
        <span style="font-size:13px;font-weight:700;color:#f0ece4;">🛒 Nové nabídky</span>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        ${listingRows}
      </table>
      ${moreCount > 0 ? `<div style="text-align:center;padding:12px;font-size:12px;color:rgba(240,236,228,0.4);">… a ${moreCount} dalších nabídek</div>` : ''}
    </div>

    <!-- CTA -->
    <div style="text-align:center;margin-bottom:24px;">
      <a href="${APP_URL}/marketplace.html" style="display:inline-block;background:linear-gradient(135deg,#f5c842,#ff8c00);color:#0a0608;font-weight:800;font-size:14px;padding:13px 32px;border-radius:12px;text-decoration:none;">
        Přejít na Marketplace →
      </a>
    </div>

    <!-- Footer -->
    <div style="text-align:center;font-size:11px;color:rgba(240,236,228,0.25);line-height:1.7;padding-top:16px;border-top:1px solid rgba(255,255,255,0.06);">
      Tato zpráva byla odeslána protože máš zapnutá emailová upozornění.<br>
      Nastavení upravíš v <a href="${APP_URL}/marketplace.html" style="color:rgba(245,200,66,0.6);">PokéTrade → Nastavení → Emailová upozornění</a>.
    </div>

  </div>
</body>
</html>`;
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
