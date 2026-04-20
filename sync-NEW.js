/* ═══════════════════════════════════════════════════════════════════════
   SYNC  –  Synchronizace assetů z vlastního webu

   🔧 Po nasazení webu na Vercel nahraď MANIFEST_URL:
   Příklad: 'https://pokemon-trade-abc123.vercel.app/pkc-manifest.json'
═══════════════════════════════════════════════════════════════════════ */

import { saveAsset, listAssets } from './asset-store.js';

// ── Konfigurace ───────────────────────────────────────────────────────────
// ⚠️ Vyplň URL svého Vercel projektu:
const MANIFEST_URL = 'https://pokemon-trade-ruddy.vercel.app/pkc-manifest.json';

const LS_KEY_LAST_SYNC   = 'pkc_sync_last_updated';
const LS_KEY_SYNC_STATUS = 'pkc_sync_status';

const BRIDGE = window.pokemonBridge;

function _lsGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function _lsSet(key, val) { try { localStorage.setItem(key, val); } catch {} }

export async function checkForUpdates(onProgress) {
  if (!MANIFEST_URL || MANIFEST_URL.includes('TVUJ-PROJEKT')) {
    return { skipped: true, reason: 'manifest url not configured' };
  }
  if (!BRIDGE?.webSyncFetchManifest) {
    return { skipped: true, reason: 'bridge unavailable' };
  }

  let manifest;
  try {
    const res = await BRIDGE.webSyncFetchManifest(MANIFEST_URL);
    if (!res.ok) return { error: res.err };
    manifest = res.manifest;
  } catch(e) {
    return { error: e.message };
  }

  const lastUpdated = _lsGet(LS_KEY_LAST_SYNC);
  if (lastUpdated && lastUpdated === String(manifest.updated)) {
    return { upToDate: true };
  }

  const types = ['symbols', 'logos', 'custom'];
  let downloaded = 0, skipped = 0, failed = 0;

  for (const type of types) {
    const entries = manifest[type];
    if (!entries || typeof entries !== 'object') continue;

    const existing = new Set(await listAssets(type));
    const ids = Object.keys(entries);

    for (let i = 0; i < ids.length; i++) {
      const id  = ids[i];
      const url = entries[id];

      if (onProgress) onProgress(downloaded + skipped + failed, ids.length, id);
      if (existing.has(id)) { skipped++; continue; }

      try {
        const res = await BRIDGE.webSyncDownloadAsset(url, type, id);
        if (res.ok) {
          downloaded++;
          if (res.base64) saveAsset(res.base64, url, id, type).catch(() => {});
        } else {
          console.warn(`[sync] Failed ${type}/${id}: ${res.err}`);
          failed++;
        }
      } catch(e) {
        console.warn(`[sync] Error ${type}/${id}:`, e);
        failed++;
      }

      if (i % 5 === 4) await new Promise(r => setTimeout(r, 50));
    }
  }

  _lsSet(LS_KEY_LAST_SYNC, String(manifest.updated));
  _lsSet(LS_KEY_SYNC_STATUS, JSON.stringify({
    downloaded, skipped, failed,
    at: new Date().toISOString(),
    manifestUpdated: manifest.updated,
  }));

  return { downloaded, skipped, failed };
}

export function getSyncStatus() {
  try {
    const raw = _lsGet(LS_KEY_SYNC_STATUS);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function getManifestUrl() { return MANIFEST_URL; }

export function resetSyncCache() {
  _lsSet(LS_KEY_LAST_SYNC, '');
  _lsSet(LS_KEY_SYNC_STATUS, '');
}
