/* ═══════════════════════════════════════════════════════════════════════════
   ALBUM SYNC  –  Obousměrná synchronizace alba app ↔ Supabase
   Conflict resolution: vyhrává novější updated_at
   Módy: 'realtime' | 'hourly' (default) | 'manual'
═══════════════════════════════════════════════════════════════════════════ */

import { getOnlineUser } from './online-market.js';
import { toast } from './ui.js';

// getOnlineSession je privátní v online-market.js – getOnlineUser je její veřejný alias
function getOnlineSession() { return getOnlineUser(); }

const SUPABASE_URL  = 'https://xrduqwrinzvmpixgmqta.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhyZHVxd3Jpbnp2bXBpeGdtcXRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDI0MjksImV4cCI6MjA5MDk3ODQyOX0.2p404Vy77CH_MsvQlnpxaO0H-KlSSt_oJlaFrmttFXs';

const LS_CARDS       = 'pkc_cards';
const LS_SYNC_MODE   = 'pkc_album_sync_mode';
const LS_SYNC_STATUS = 'pkc_album_sync_status';
const LS_LAST_SYNC   = 'pkc_album_last_sync';
const HOUR_MS        = 60 * 60 * 1000;

let _timer = null, _pending = null, _lock = false;

// ── Activity timeout (30 min neaktivity → varování 5 min → odpojení) ──
const INACTIVITY_LIMIT_MS = 30 * 60 * 1000;  // 30 minut
const WARNING_BEFORE_MS   =  5 * 60 * 1000;  // varování 5 minut před odpojením
let _lastActivity   = Date.now();
let _inactivityTimer = null;
let _warningTimer    = null;
let _countdownTimer  = null;
let _warningCallback = null;  // volitelný callback pro UI odpočet

// Zaregistruj aktivitu uživatele
function registerActivity() {
  _lastActivity = Date.now();
  // Pokud jsme ve stavu varování – zruš ho a restartuj ochranu
  if (_warningTimer === null && _inactivityTimer === null) return; // sync already stopped
  _dismissWarning();
  _scheduleInactivityCheck();
}

// Nastav callback pro UI odpočet: fn(secondsLeft) nebo fn(null) = skryj
export function onSyncWarning(fn) { _warningCallback = fn; }

function _scheduleInactivityCheck() {
  clearTimeout(_inactivityTimer);
  clearTimeout(_warningTimer);
  _stopCountdown();
  // Za (INACTIVITY_LIMIT_MS - WARNING_BEFORE_MS) zobraz varování
  _inactivityTimer = setTimeout(_showWarning, INACTIVITY_LIMIT_MS - WARNING_BEFORE_MS);
}

function _showWarning() {
  _inactivityTimer = null;
  // Spusť odpočet 5 minut
  let secondsLeft = WARNING_BEFORE_MS / 1000;
  if (_warningCallback) _warningCallback(secondsLeft);
  _countdownTimer = setInterval(() => {
    secondsLeft--;
    if (_warningCallback) _warningCallback(secondsLeft);
    if (secondsLeft <= 0) {
      _stopCountdown();
      _doDisconnect();
    }
  }, 1000);
}

function _stopCountdown() {
  if (_countdownTimer) { clearInterval(_countdownTimer); _countdownTimer = null; }
}

function _dismissWarning() {
  _stopCountdown();
  if (_warningCallback) _warningCallback(null); // skryj varování v UI
}

function _doDisconnect() {
  stopAutoSync();
  if (_warningCallback) _warningCallback(null);
  window.dispatchEvent(new CustomEvent('album-sync-disconnected'));
  console.log('[album-sync] Odpojeno kvůli neaktivitě (30 min)');
}

// Sleduj aktivitu uživatele na stránce
const _activityEvents = ['mousemove','keydown','click','scroll','touchstart','visibilitychange'];
function _attachActivityListeners() {
  _activityEvents.forEach(ev => window.addEventListener(ev, registerActivity, { passive: true }));
}
function _detachActivityListeners() {
  _activityEvents.forEach(ev => window.removeEventListener(ev, registerActivity));
}

async function sbReq(path, method = 'GET', body = null, token = null) {
  const headers = {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON,
    'Authorization': 'Bearer ' + (token || SUPABASE_ANON),
  };
  if (['POST','PATCH'].includes(method) && !path.startsWith('auth/'))
    headers['Prefer'] = 'return=representation';
  try {
    const res  = await fetch(`${SUPABASE_URL}/${path}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) return { _err: data.message || data.error || 'HTTP ' + res.status };
    return data;
  } catch(e) { return { _err: e.message }; }
}

function getLocal()       { try { return JSON.parse(localStorage.getItem(LS_CARDS) || '[]'); } catch { return []; } }
function saveLocal(cards) { try { localStorage.setItem(LS_CARDS, JSON.stringify(cards)); } catch {} }
function nowIso()         { return new Date().toISOString(); }

export async function syncAlbum(silent = false) {
  if (_lock) return { skipped: true };
  const session = getOnlineSession();
  if (!session?.token) return { skipped: true, reason: 'not logged in' };
  _lock = true;
  const t0 = Date.now();

  try {
    const local    = getLocal();
    const lastSync = localStorage.getItem(LS_LAST_SYNC);

    // 1. Stahni ze serveru novinky
    let q = 'rest/v1/user_cards?user_id=eq.' + session.userId +
            '&select=local_id,card_data,for_trade,for_sell,price_czk,updated_at';
    if (lastSync) q += '&updated_at=gt.' + encodeURIComponent(lastSync);
    const server = await sbReq(q, 'GET', null, session.token);
    if (server._err) throw new Error(server._err);

    // 2. Merge server -> lokál (vyhrává novější razítko)
    let localUpdated = 0;
    if (Array.isArray(server) && server.length > 0) {
      const map = new Map(local.map(c => [String(c.id), c]));
      for (const sc of server) {
        const ex = map.get(sc.local_id);
        const serverTs = new Date(sc.updated_at).getTime();
        const localTs  = ex?.updated_at ? new Date(ex.updated_at).getTime() : 0;
        if (!ex || serverTs > localTs) {
          map.set(sc.local_id, {
            ...(ex || {}), ...sc.card_data,
            id: sc.local_id,
            for_trade:  sc.for_trade,
            for_sell:   sc.for_sell,
            price_czk:  sc.price_czk,
            updated_at: sc.updated_at,
          });
          localUpdated++;
        }
      }
      if (localUpdated > 0) saveLocal([...map.values()]);
    }

    // 3. Pošli lokální změny na server (batch 200)
    const dirty = lastSync
      ? local.filter(c => c.updated_at && new Date(c.updated_at) > new Date(lastSync))
      : local;
    let serverUpdated = 0;
    for (let i = 0; i < dirty.length; i += 200) {
      const payload = dirty.slice(i, i + 200).map(c => ({
        local_id:  String(c.id),
        updated_at: c.updated_at || nowIso(),
        for_trade:  c.for_trade  || false,
        for_sell:   c.for_sell   || false,
        price_czk:  c.price_czk  || null,
        card_data: {
          name: c.name || '', set: c.set || '', number: c.number || '',
          condition: c.condition || 'NM', category: c.category || 'pokemon',
          type: c.type || '', types: c.types || [], supertype: c.supertype || '',
          imageUrl: c.imageUrl || null, apiSmall: c.apiSmall || null,
          images: c.images || null, pTrend: c.pTrend || null,
          count: c.count || 1, note: c.note || '', tags: c.tags || [],
        },
      }));
      const res = await sbReq('rest/v1/rpc/upsert_user_cards', 'POST',
        { p_user_id: session.userId, p_cards: payload }, session.token);
      if (!res._err) serverUpdated += res.updated || 0;
    }

    const at = nowIso();
    localStorage.setItem(LS_LAST_SYNC, at);
    const status = { at, localUpdated, serverUpdated, ms: Date.now() - t0 };
    localStorage.setItem(LS_SYNC_STATUS, JSON.stringify(status));
    console.log('[album-sync] done', status);
    if (!silent) toast('Album synchronizováno', '🔄', 'success');
    if (localUpdated > 0)
      window.dispatchEvent(new CustomEvent('album-synced', { detail: status }));
    // Sync alb (pojmenovaných kolekcí) na pozadí
    syncAlbumsList(true).catch(e => console.warn('[album-sync] albums sync:', e));
    return status;

  } catch(err) {
    console.error('[album-sync]', err);
    if (!silent) toast('Sync selhal: ' + err.message, '🔄', 'error');
    return { error: err.message };
  } finally { _lock = false; }
}

// Označí kartu jako změněnou (volej po každé editaci karty)
export function markCardDirty(cardId) {
  const cards = getLocal();
  const c = cards.find(x => String(x.id) === String(cardId));
  if (c) { c.updated_at = nowIso(); saveLocal(cards); }
  if (getSyncMode() === 'realtime') scheduleSync(2000);
}

// Nastav stav výměny/prodeje + okamžitý sync
export async function setTradeStatus(cardId, { forTrade, forSell, priceCzk } = {}) {
  const cards = getLocal();
  const c = cards.find(x => String(x.id) === String(cardId));
  if (!c) return;
  if (forTrade  !== undefined) c.for_trade  = forTrade;
  if (forSell   !== undefined) c.for_sell   = forSell;
  if (priceCzk  !== undefined) c.price_czk  = priceCzk;
  c.updated_at = nowIso();
  saveLocal(cards);
  await syncAlbum(true);
  window.dispatchEvent(new CustomEvent('card-trade-changed', {
    detail: { cardId, forTrade: c.for_trade, forSell: c.for_sell }
  }));
}

export function getSyncMode()   { return localStorage.getItem(LS_SYNC_MODE) || 'hourly'; }
export function getSyncStatus() { try { return JSON.parse(localStorage.getItem(LS_SYNC_STATUS)); } catch { return null; } }
export function getLastSync()   { const t = localStorage.getItem(LS_LAST_SYNC); return t ? new Date(t) : null; }

export function setSyncMode(mode) {
  localStorage.setItem(LS_SYNC_MODE, mode);
  stopAutoSync();
  startAutoSync();
}

function scheduleSync(ms = 0) {
  if (_pending) clearTimeout(_pending);
  _pending = setTimeout(() => syncAlbum(true), ms);
}

export function startAutoSync() {
  stopAutoSync();
  _lastActivity = Date.now();
  syncAlbum(true); // vždy sync při startu
  const mode = getSyncMode();
  if (mode === 'hourly')   _timer = setInterval(() => syncAlbum(true), HOUR_MS);
  if (mode === 'realtime') _timer = setInterval(() => syncAlbum(true), 30_000);
  _attachActivityListeners();
  _scheduleInactivityCheck();
}

export function stopAutoSync() {
  if (_timer)   { clearInterval(_timer);  _timer   = null; }
  if (_pending) { clearTimeout(_pending); _pending = null; }
  clearTimeout(_inactivityTimer); _inactivityTimer = null;
  clearTimeout(_warningTimer);    _warningTimer    = null;
  _stopCountdown();
  _detachActivityListeners();
}

// Znovu připojit sync po odpojení (volej z UI tlačítka "Znovu připojit")
export function reconnectSync() {
  startAutoSync();
  window.dispatchEvent(new CustomEvent('album-sync-reconnected'));
}

// ═══════════════════════════════════════════════════════════════════════════
//  ROZŠÍŘENÍ – Sync alb (pkc_albums ↔ user_albums v Supabase)
//  Volá se automaticky v rámci syncAlbum() a startAutoSync()
// ═══════════════════════════════════════════════════════════════════════════

const LS_ALBUMS      = 'pkc_albums';
const LS_ALBUMS_SYNC = 'pkc_albums_last_sync';

function getLocalAlbums()        { try { return JSON.parse(localStorage.getItem(LS_ALBUMS) || '[]'); } catch { return []; } }
function saveLocalAlbums(albums) { try { localStorage.setItem(LS_ALBUMS, JSON.stringify(albums)); } catch {} }

export async function syncAlbumsList(silent = false) {
  const session = getOnlineSession();
  if (!session?.token) return { skipped: true };

  try {
    const local    = getLocalAlbums();
    const lastSync = localStorage.getItem(LS_ALBUMS_SYNC);

    // 1. Stahni alba ze serveru
    let q = 'rest/v1/user_albums?user_id=eq.' + session.userId +
            '&select=id,name,color,icon,owner_id,card_ids,updated_at&order=updated_at.desc';
    if (lastSync) q += '&updated_at=gt.' + encodeURIComponent(lastSync);
    const server = await sbReq(q, 'GET', null, session.token);
    if (server._err) throw new Error(server._err);

    // 2. Merge server → lokál
    let localUpdated = 0;
    if (Array.isArray(server) && server.length > 0) {
      const map = new Map(local.map(a => [a.id, a]));
      for (const sa of server) {
        const ex      = map.get(sa.id);
        const serverTs = new Date(sa.updated_at).getTime();
        const localTs  = ex?.updated_at ? new Date(ex.updated_at).getTime() : 0;
        if (!ex || serverTs > localTs) {
          map.set(sa.id, {
            id:        sa.id,
            name:      sa.name,
            color:     sa.color,
            icon:      sa.icon,
            ownerId:   sa.owner_id,
            cardIds:   sa.card_ids || [],
            updated_at: sa.updated_at,
          });
          localUpdated++;
        }
      }
      if (localUpdated > 0) saveLocalAlbums([...map.values()]);
    }

    // 3. Pošli lokální alba na server
    if (local.length > 0) {
      const payload = local.map(a => ({
        id:         a.id,
        name:       a.name  || 'Album',
        color:      a.color || '#4f8ef7',
        icon:       a.icon  || '📁',
        owner_id:   a.ownerId || null,
        card_ids:   a.cardIds || [],
        updated_at: a.updated_at || nowIso(),
      }));
      await sbReq('rest/v1/rpc/upsert_user_albums', 'POST',
        { p_user_id: session.userId, p_albums: payload }, session.token);
    }

    localStorage.setItem(LS_ALBUMS_SYNC, nowIso());
    if (localUpdated > 0)
      window.dispatchEvent(new CustomEvent('albums-synced', { detail: { localUpdated } }));
    return { localUpdated };

  } catch(err) {
    console.error('[album-sync] albums:', err);
    return { error: err.message };
  }
}

// syncAlbumsList() se volá z moje-album.html a album-sync webu
