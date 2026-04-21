/**
 * PokéTrade – Push Notification Sender
 * ──────────────────────────────────────────────────────────────
 * Přidej do svého Node.js serveru (require/import tento soubor).
 * Sleduje tabulku `notifications` v Supabase a odesílá Web Push
 * na všechna zaregistrovaná zařízení uživatele.
 *
 * Závislosti (přidej do package.json):
 *   npm install web-push @supabase/supabase-js
 *
 * Supabase SQL (spusť jednou v Supabase SQL editoru):
 * ──────────────────────────────────────────────────
 *   CREATE TABLE IF NOT EXISTS push_subscriptions (
 *     id         uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
 *     user_id    uuid    REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
 *     endpoint   text    NOT NULL,
 *     sub_json   jsonb   NOT NULL,
 *     created_at timestamptz DEFAULT now(),
 *     UNIQUE(user_id, endpoint)
 *   );
 *   ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "user can manage own subscriptions"
 *     ON push_subscriptions FOR ALL
 *     USING (auth.uid() = user_id);
 *
 * Použití v serveru (např. server.js nebo index.js):
 * ──────────────────────────────────────────────────
 *   require('./push-sender');   // nebo: const pushSender = require('./push-sender');
 */

'use strict';

const webpush   = require('web-push');
const { createClient } = require('@supabase/supabase-js');

// ── Konfigurace ───────────────────────────────────────────────
const SB_URL        = 'https://xrduqwrinzvmpixgmqta.supabase.co';

// !! DŮLEŽITÉ: použij SERVICE ROLE KEY (ne anon key) – ten má přístup ke všem řádkům
// Najdeš ho v Supabase → Project Settings → API → service_role key
const SB_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'ZDE_VLOZ_SERVICE_ROLE_KEY';

// VAPID klíče – vygenerované pro tento projekt (neměň!)
const VAPID_PUBLIC  = 'BJQQ3j0RLJKmhZR7_EdpnRWF-rSblz9w5HhAbtKGZoX7OyeJjNC2HuCL-jrhmtbFq6cS2FJAW8gUvV0R8xBZncQ';
const VAPID_PRIVATE = '99fqdYcGiCjCePnTzf6WY2K8ghqz-pwKdrHaRf33D3E';
const VAPID_EMAIL   = 'mailto:admin@poketrade.cz';  // změň na svůj mail

// ── Init ─────────────────────────────────────────────────────
webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);

const supabase = createClient(SB_URL, SB_SERVICE_KEY);

// ── Odešli push na všechna zařízení uživatele ─────────────────
async function sendPushToUser(userId, title, body, url) {
  if (!userId) return;

  // Načti všechny push subscriptions daného uživatele
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, sub_json')
    .eq('user_id', userId);

  if (error || !subs?.length) return;

  const payload = JSON.stringify({ title, body, url: url || '/', tag: 'pkt-' + Date.now() });

  for (const row of subs) {
    try {
      await webpush.sendNotification(row.sub_json, payload);
      console.log('[Push] odesláno →', row.endpoint.slice(0, 60) + '…');
    } catch(e) {
      console.warn('[Push] chyba pro endpoint:', e.statusCode, e.message);
      // Pokud endpoint neexistuje (410 Gone) – smaž subscription
      if (e.statusCode === 410 || e.statusCode === 404) {
        await supabase.from('push_subscriptions').delete().eq('id', row.id);
        console.log('[Push] neplatná subscription smazána');
      }
    }
  }
}

// ── Naslouchání tabulce notifications (Supabase Realtime) ─────
let _channel = null;

function startPushListener() {
  if (_channel) _channel.unsubscribe();

  _channel = supabase
    .channel('push-sender-notifications')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications' },
      async (payload) => {
        const n = payload.new;
        if (!n?.user_id) return;

        console.log('[Push] nová notifikace pro', n.user_id, '–', n.title);
        await sendPushToUser(
          n.user_id,
          n.title || 'PokéTrade',
          n.body  || '',
          n.link  || '/'
        );
      }
    )
    .subscribe(status => {
      console.log('[Push] Realtime status:', status);
    });

  console.log('[Push Sender] Naslouchám tabulce notifications…');
}

// ── Spusť po připojení ────────────────────────────────────────
startPushListener();

// Exportuj pro případ přímého volání z jiného kódu
module.exports = { sendPushToUser, startPushListener };
