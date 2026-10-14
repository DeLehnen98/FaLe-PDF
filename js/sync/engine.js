// FaLe Sync – end-to-end encrypted, offline-first sync engine.
//
// Data flow (all requests go straight to Supabase with the user's access token; RLS = own rows only):
//   check   sync_status          → quota, key id (a changed/missing key stops sync and asks the user)
//   pull    sync_pull(cursor)    → decrypt metadata, download + decrypt chunks, write locally
//   push    local scan vs. map   → encrypt, sync_reserve (quota), upload chunks, sync_commit(base version)
//                                  deletions → sync_delete (tombstone, kept 30 days)
//   clean   sync_garbage         → delete replaced/abandoned chunk objects, sync_blob_gone
// Conflicts: every item carries a version; a commit with an outdated base version is refused and the
// remote version is applied first. Files changed on both sides → the local version is kept as a copy
// "(Konflikt von <Gerät>)"; metadata-only conflicts → last writer wins (by change time); folder and tag
// lists → three-way merge. Everything runs in the background and never blocks the UI; changes made
// offline are picked up by the next scan.
import * as db from '../db.js';
import * as A from '../account/auth.js';
import { kv, map } from '../account/kv.js';
import * as K from './crypto.js';
import { ADAPTERS, byKind, GROUPS, INLINE_MAX } from './local.js';
import { isNative, plugin } from '../platform.js';

const STORE_TO_KIND = { docs: 'file', reminders: 'reminder', signatures: 'sig', vault: 'vault' };
const SETTING_TO_KIND = { folders: 'folders', tags: 'tags', profile: 'profile', vault: 'vaultkey', defaultZoom: 'settings' };
const DEFAULT_GROUPS = Object.fromEntries(GROUPS.map(g => [g.id, true]));

const S = {
  phase: 'off',        // off | idle | checking | pulling | pushing | cleaning
  needs: null,         // null | 'setup' | 'unlock' | 'keychange'
  last: 0, error: null, offline: false, waitingWifi: false, quotaFull: false, vaultConflict: false,
  paused: false, pausedReason: null, wifiOnly: false, groups: { ...DEFAULT_GROUPS },
  usage: null,         // { used, quota, plus, items }
  progress: null,      // { label, done, total }
  decryptErrors: 0,
};
let mk = null, keyId = null, userId = null, devId = null, devName = '';
let chunkPlain = K.CHUNK_PLAIN;
let timer = 0, running = false, again = false, started = false, intervalId = 0, touchedAt = 0;
let dirty = {}; // '<kind>:<localId>' → { t, c }   (c = file content changed)
const listeners = new Set();

export function status() { return { ...S, groups: { ...S.groups }, usage: S.usage && { ...S.usage }, progress: S.progress && { ...S.progress }, enabled: !!mk }; }
export function onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() {
  const s = status();
  listeners.forEach(fn => { try { fn(s); } catch {} });
  try { window.dispatchEvent(new CustomEvent('fale:sync', { detail: s })); } catch {}
}
const userErr = (msg, code) => Object.assign(new Error(msg), { userMessage: msg, code });

// ------------------------------------------------------------------ lifecycle
async function loadState() {
  const ses = await A.session();
  if (!ses) return false;
  userId = ses.user.id; devId = ses.device; devName = ses.deviceName || A.defaultDeviceName();
  const st = await kv.get('sync.settings', null);
  if (st) { S.paused = !!st.paused; S.pausedReason = st.pausedReason || null; S.wifiOnly = !!st.wifiOnly; S.groups = { ...DEFAULT_GROUPS, ...(st.groups || {}) }; }
  S.last = await kv.get('sync.last', 0);
  S.vaultConflict = !!(await kv.get('sync.vaultConflict', false));
  dirty = (await kv.get('sync.dirty', null)) || {};
  const key = await kv.get('sync.mk', null);
  const kid = await kv.get('sync.keyId', null);
  if (key && kid) { mk = key; keyId = kid; S.phase = 'idle'; } else { mk = null; S.phase = 'off'; }
  return true;
}
const saveSettings = () => kv.set('sync.settings', { paused: S.paused, pausedReason: S.pausedReason, wifiOnly: S.wifiOnly, groups: S.groups });
let dirtySaveT = 0;
function saveDirtySoon() { clearTimeout(dirtySaveT); dirtySaveT = setTimeout(() => kv.set('sync.dirty', dirty).catch(() => {}), 300); }

/** App start (only when the account flag is set): restore keys, hook into writes, schedule a sync. */
export async function init() {
  if (started) return;
  if (!(await loadState())) return;
  started = true;
  if (mk) attach();
  else S.needs = null; // decided when the account screen asks the server
  emit();
}
export async function onSignedIn() {
  started = false;
  await init();
  try { await refreshRemote(); } catch {}
}

function attach() {
  db.syncHooks.fn = onLocalChange;
  if (intervalId) return;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(1500); });
  window.addEventListener('online', () => schedule(1000));
  window.addEventListener('offline', () => { S.offline = true; emit(); });
  intervalId = setInterval(() => { if (document.visibilityState === 'visible') schedule(0); }, 5 * 60 * 1000);
  const app = isNative() ? plugin('App') : null;
  if (app) { try { const r = app.addListener('resume', () => schedule(1500)); if (r && r.catch) r.catch(() => {}); } catch {} }
  try { navigator.connection && navigator.connection.addEventListener('change', () => schedule(1500)); } catch {}
  schedule(1200);
}

function onLocalChange(store, id, op) {
  if (!mk) return;
  if (store === '*' && op === 'clear') { onLocalClear(); return; }
  let kind = STORE_TO_KIND[store];
  if (store === 'settings') kind = SETTING_TO_KIND[id];
  if (!kind) return;
  const ad = byKind[kind];
  const key = `${kind}:${ad && ad.singleton ? ad.singleton : id}`;
  const prev = dirty[key];
  dirty[key] = { t: Date.now(), c: !!(prev && prev.c) || op === 'content' || op === 'put' };
  saveDirtySoon();
  schedule(4000);
}

/** "Alles löschen" on this device: keep the cloud as it is, pause sync (resuming downloads everything again). */
async function onLocalClear() {
  S.paused = true; S.pausedReason = 'cleared';
  emit();
  for (const m of await map.all()) if (m.kind === 'file' || m.kind === 'sig') await map.del(m.k);
  await kv.set('sync.cursor', 0);
  await saveSettings();
}

export function schedule(ms = 2000) {
  if (!mk) return;
  clearTimeout(timer);
  timer = setTimeout(() => { cycle().catch(e => console.warn('sync', e)); }, ms);
}

// ------------------------------------------------------------------ remote key / setup / unlock
/** Ask the server whether sync is set up for the account (→ S.needs) and refresh the usage meter. */
export async function refreshRemote() {
  if (!userId && !(await loadState())) return null;
  const st = await A.rpc('sync_status');
  S.usage = { used: Number(st.usage.total) || 0, quota: Number(st.quota) || 0, plus: !!st.plus, items: Number(st.items) || 0 };
  if (!st.key) S.needs = 'setup';
  else if (!mk) S.needs = 'unlock';
  else if (st.key.key_id !== keyId) S.needs = 'keychange';
  else S.needs = null;
  emit();
  return st;
}

async function storeKey(key, kid) {
  await kv.set('sync.mk', key);   // non-extractable CryptoKey – IndexedDB keeps it, nobody can export it
  await kv.set('sync.keyId', kid);
  mk = key; keyId = kid; S.needs = null; S.phase = 'idle';
}

/** First device: create the keys. Returns the recovery key text (show once!). Sync starts with start(). */
export async function setup(password) {
  if (String(password || '').length < 10) throw userErr('Das Sync-Passwort muss mindestens 10 Zeichen lang sein.', 'short');
  await loadState();
  const k = await K.createKeys(userId, password);
  const r = await A.rpc('sync_keys_put', { p_key_id: k.record.key_id, p_kdf: k.record.kdf, p_wrapped_pw: k.record.wrapped_pw, p_wrapped_rk: k.record.wrapped_rk, p_mode: 'create' });
  if (!r || !r.ok) {
    if (r && r.reason === 'exists') throw userErr('FaLe Sync ist für dein Konto schon eingerichtet. Entsperre es mit deinem Sync-Passwort.', 'exists');
    if (r && r.reason === 'not_empty') throw userErr('In der Cloud liegen noch alte Daten. Lösche zuerst alle Cloud-Daten.', 'not_empty');
    throw userErr('FaLe Sync konnte nicht eingerichtet werden. Bitte versuche es erneut.', 'failed');
  }
  await map.clear();
  await kv.set('sync.cursor', 0);
  await storeKey(k.key, k.keyId);
  emit();
  return k.recoveryText;
}

/** New device: unlock with the Sync-Passwort or the recovery key. */
export async function unlock({ password = null, recovery = null }) {
  await loadState();
  const st = await A.rpc('sync_status');
  if (!st.key) throw userErr('FaLe Sync ist für dein Konto noch nicht eingerichtet.', 'no_key');
  const raw = await K.unwrapMaster(userId, st.key, password != null ? { password } : { recovery });
  let imported;
  try { imported = await K.importMaster(raw); } finally { raw.fill(0); }
  if (imported.keyId !== st.key.key_id) throw userErr('Der Schlüssel passt nicht zu diesem Konto.', 'mismatch');
  if (keyId && keyId !== imported.keyId) { await map.clear(); await kv.set('sync.cursor', 0); }
  if (!keyId) { await map.clear(); await kv.set('sync.cursor', 0); }
  await storeKey(imported.key, imported.keyId);
  start();
  return true;
}

/** Start syncing on this device (after setup + recovery key confirmation, or after unlock). */
export function start() {
  if (!mk) return;
  S.paused = false; S.pausedReason = null;
  saveSettings();
  attach();
  emit();
  schedule(300);
}

async function withMaster(secret, fn) {
  const st = await A.rpc('sync_status');
  if (!st.key) throw userErr('FaLe Sync ist nicht eingerichtet.', 'no_key');
  const raw = await K.unwrapMaster(userId, st.key, secret);
  try { return await fn(raw, st.key); } finally { raw.fill(0); }
}
/** Change the Sync-Passwort (needs the current password or the recovery key). The recovery key stays valid. */
export async function changePassword(secret, newPassword) {
  if (String(newPassword || '').length < 10) throw userErr('Das Sync-Passwort muss mindestens 10 Zeichen lang sein.', 'short');
  await loadState();
  return withMaster(secret, async (raw, rec) => {
    const { record } = await K.rewrap(userId, rec, raw, { password: newPassword });
    const r = await A.rpc('sync_keys_put', { p_key_id: record.key_id, p_kdf: record.kdf, p_wrapped_pw: record.wrapped_pw, p_wrapped_rk: record.wrapped_rk, p_mode: 'update' });
    if (!r || !r.ok) throw userErr('Das Passwort konnte nicht geändert werden.', 'failed');
    return true;
  });
}
/** Create a new recovery key (the old one stops working). Returns the new key text. */
export async function newRecoveryKey(secret) {
  await loadState();
  return withMaster(secret, async (raw, rec) => {
    const { record, recoveryText } = await K.rewrap(userId, rec, raw, { newRecovery: true });
    const r = await A.rpc('sync_keys_put', { p_key_id: record.key_id, p_kdf: record.kdf, p_wrapped_pw: record.wrapped_pw, p_wrapped_rk: record.wrapped_rk, p_mode: 'update' });
    if (!r || !r.ok) throw userErr('Der Schlüssel konnte nicht erneuert werden.', 'failed');
    return recoveryText;
  });
}

// ------------------------------------------------------------------ settings
export async function setPaused(on) { S.paused = !!on; S.pausedReason = null; await saveSettings(); emit(); if (!on) schedule(300); }
export async function setWifiOnly(on) { S.wifiOnly = !!on; await saveSettings(); emit(); schedule(500); }
export async function setGroup(id, on) {
  S.groups[id] = !!on;
  if (on) await kv.set('sync.cursor', 0); // fetch what was skipped while it was off
  await saveSettings(); emit(); schedule(500);
}
export async function syncNow() { if (!mk) return; clearTimeout(timer); await cycle(); }

/** Forget the key and bookkeeping on this device only (local files stay). */
export async function turnOffHere() {
  clearTimeout(timer);
  db.syncHooks.fn = null;
  await kv.del('sync.mk'); await kv.del('sync.keyId'); await kv.del('sync.cursor'); await kv.del('sync.dirty');
  await map.clear();
  mk = null; keyId = null; dirty = {};
  S.phase = 'off'; S.needs = 'unlock'; S.progress = null;
  K.forgetItemKeys();
  emit();
}
/** Sign-out: stop immediately (auth.js wipes the database afterwards). */
export function stopAndForget() {
  clearTimeout(timer);
  db.syncHooks.fn = null;
  mk = null; keyId = null; userId = null; dirty = {}; started = false;
  Object.assign(S, { phase: 'off', needs: null, progress: null, usage: null, error: null, quotaFull: false });
  K.forgetItemKeys();
  emit();
}

/** "Alle Cloud-Daten löschen": every object under <uid>/, then items + keys. Local files stay. */
export async function wipeCloud(onProgress) {
  await loadState();
  clearTimeout(timer);
  let n = 0;
  for (let round = 0; round < 100; round++) {
    const top = await storageList(`${userId}/`);
    if (!top.length) break;
    for (const f of top) {
      const files = await storageList(`${userId}/${f.name}/`);
      const names = files.map(x => `${userId}/${f.name}/${x.name}`);
      if (names.length) { await storageDelete(names); n += names.length; onProgress && onProgress(n); }
    }
  }
  const r = await A.rpc('sync_wipe');
  await turnOffHere();
  S.needs = 'setup'; S.usage = null;
  emit();
  return { deleted: n, remaining: r && r.remaining_objects };
}

// ------------------------------------------------------------------ storage (Supabase Storage, bucket "sync")
const objPath = name => `/storage/v1/object/sync/${name.split('/').map(encodeURIComponent).join('/')}`;
async function storagePut(name, bytes, signal) {
  const r = await A.sbFetch(objPath(name), { method: 'POST', raw: bytes, contentType: 'application/octet-stream', headers: { 'x-upsert': 'false', 'cache-control': 'no-store' }, signal });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw Object.assign(new Error('upload ' + r.status), { code: 'upload', status: Number(j.statusCode) || r.status }); }
}
async function storageGet(name) {
  const r = await A.sbFetch(`/storage/v1/object/authenticated/sync/${name.split('/').map(encodeURIComponent).join('/')}`, { method: 'GET' });
  if (!r.ok) throw Object.assign(new Error('download ' + r.status), { code: 'download' });
  return new Uint8Array(await r.arrayBuffer());
}
async function storageList(prefix) {
  const out = [];
  for (let off = 0; off < 100000; off += 1000) {
    const r = await A.sbFetch('/storage/v1/object/list/sync', { json: { prefix, limit: 1000, offset: off, sortBy: { column: 'name', order: 'asc' } } });
    if (!r.ok) throw Object.assign(new Error('list ' + r.status), { code: 'list' });
    const j = await r.json();
    out.push(...(Array.isArray(j) ? j : []));
    if (!Array.isArray(j) || j.length < 1000) break;
  }
  return out.filter(x => x && typeof x.name === 'string' && x.name && x.name !== '.emptyFolderPlaceholder');
}
async function storageDelete(names) {
  for (let i = 0; i < names.length; i += 900) {
    const r = await A.sbFetch('/storage/v1/object/sync', { method: 'DELETE', json: { prefixes: names.slice(i, i + 900) } });
    if (!r.ok) throw Object.assign(new Error('delete ' + r.status), { code: 'delete' });
  }
}

async function uploadBlob(itemId, blob, onBytes) {
  const cb = chunkPlain;
  const chunks = Math.max(1, Math.ceil(blob.size / cb));
  const size = blob.size + chunks * K.CHUNK_OVERHEAD;
  const blobId = K.randomId();
  const r = await A.rpc('sync_reserve', { p_blob_id: blobId, p_size: size, p_chunks: chunks });
  if (!r || !r.ok) throw Object.assign(new Error('reserve'), { code: (r && r.reason) || 'reserve', info: r });
  const tree = new Uint8Array(32 * chunks);
  try {
    for (let i = 0; i < chunks; i++) {
      const plain = new Uint8Array(await blob.slice(i * cb, Math.min(blob.size, (i + 1) * cb)).arrayBuffer());
      const sealed = await K.sealChunk(mk, userId, itemId, blobId, i, chunks, plain);
      tree.set(await K.sha256(sealed), i * 32);
      await storagePut(`${userId}/${blobId}/${i}`, sealed);
      onBytes && onBytes(sealed.length);
    }
  } catch (e) {
    // abandon the reservation (objects of a failed upload are removed by the garbage step later)
    try { await storageDelete(Array.from({ length: chunks }, (_, i) => `${userId}/${blobId}/${i}`)); await A.rpc('sync_blob_gone', { p_blob_ids: [blobId] }); } catch {}
    throw e;
  }
  return { blobId, chunks, size, sha: K.hex(await K.sha256(tree)) };
}

async function downloadBlob(item, env) {
  if (!item.blob_id || item.blob_id !== env.blob || !env.chunks) throw Object.assign(new Error('blob mismatch'), { code: 'decrypt' });
  const parts = [];
  const tree = new Uint8Array(32 * env.chunks);
  for (let i = 0; i < env.chunks; i++) {
    const sealed = await storageGet(`${userId}/${item.blob_id}/${i}`);
    tree.set(await K.sha256(sealed), i * 32);
    parts.push(await K.openChunk(mk, userId, item.item_id, item.blob_id, i, env.chunks, sealed));
    setProgress({ bytes: sealed.length });
  }
  if (item.sha256 && K.hex(await K.sha256(tree)) !== item.sha256) throw Object.assign(new Error('hash'), { code: 'decrypt' });
  const blob = new Blob(parts, { type: env.type || 'application/octet-stream' });
  if (Number.isFinite(env.size) && blob.size !== env.size) throw Object.assign(new Error('size'), { code: 'decrypt' });
  return blob;
}

const b64ToBlob = (s, type) => new Blob([K.unb64u(s)], { type: type || 'application/octet-stream' });
async function blobToB64(blob) { return K.b64u(new Uint8Array(await blob.arrayBuffer())); }

// ------------------------------------------------------------------ helpers
const groupOn = ad => S.groups[ad.group] !== false;
function setProgress(p) {
  if (!S.progress) return;
  if (p.bytes) S.progress.bytes = (S.progress.bytes || 0) + p.bytes;
  if (p.done != null) S.progress.done = p.done;
  if (p.total != null) S.progress.total = p.total;
  if (p.label) S.progress.label = p.label;
  emit();
}
async function muted(ad, localId, fn) {
  const keys = [];
  const add = k => { db.syncHooks.mute.add(k); keys.push(k); };
  if (ad.store === 'settings') add(`settings:${ad.hookKey}`);
  else if (localId != null) add(`${ad.store}:${localId}`);
  try { return await fn(); } finally { setTimeout(() => keys.forEach(k => db.syncHooks.mute.delete(k)), 50); }
}
const inv = new Map(); // kind → Map(localId → { fp, rec, empty })
async function localIndex(ad, fresh = false) {
  if (!fresh && inv.has(ad.kind)) return inv.get(ad.kind);
  const m = new Map((await ad.list()).map(x => [String(x.id), x]));
  inv.set(ad.kind, m);
  return m;
}
async function localOf(ad, lid) { return lid == null ? null : (await localIndex(ad)).get(String(lid)) || null; }
async function refreshLocal(ad) { inv.delete(ad.kind); return localIndex(ad, true); }
function deviceOnline() { return typeof navigator === 'undefined' || navigator.onLine !== false; }
function onCellular() { try { const c = navigator.connection; return !!(c && (c.type === 'cellular')); } catch { return false; } }
async function lockSync(fn) {
  if (navigator.locks && navigator.locks.request) return navigator.locks.request('fale-sync', { ifAvailable: true }, lock => (lock ? fn() : null));
  return fn();
}
const keyOf = (ad, lid) => `${ad.kind}:${lid}`;

// ------------------------------------------------------------------ the cycle
async function cycle() {
  if (!mk) return;
  if (running) { again = true; return; }
  if (S.paused) { emit(); return; }
  if (!deviceOnline()) { S.offline = true; emit(); return; }
  S.offline = false;
  if (S.wifiOnly && isNative() && onCellular()) { S.waitingWifi = true; emit(); return; }
  S.waitingWifi = false;
  running = true;
  try {
    await lockSync(async () => {
      S.phase = 'checking'; S.error = null; emit();
      const st = await refreshRemote();
      if (!st || S.needs) { if (S.needs === 'setup' || S.needs === 'keychange') await turnOffHereKeepNeeds(); return; }
      chunkPlain = Math.max(65536, (Number(st.chunk_bytes) || (K.CHUNK_PLAIN + K.CHUNK_OVERHEAD)) - K.CHUNK_OVERHEAD);
      if (Date.now() - touchedAt > 3600e3) {
        touchedAt = Date.now();
        const t = await A.touchDevice().catch(() => null);
        if (t && t.revoked) return;
      }
      inv.clear();
      S.quotaFull = false;
      for (let round = 0; round < 3; round++) {
        S.phase = 'pulling'; S.progress = { label: 'Lade Änderungen …', done: 0, total: 0, bytes: 0 }; emit();
        await pull();
        S.phase = 'pushing'; S.progress = { label: 'Sende Änderungen …', done: 0, total: 0, bytes: 0 }; emit();
        const conflicted = await push();
        if (!conflicted) break;
      }
      S.phase = 'cleaning'; S.progress = null; emit();
      await cleanup().catch(e => console.warn('sync cleanup', e));
      await refreshRemote().catch(() => null);
      S.last = Date.now();
      await kv.set('sync.last', S.last);
    });
  } catch (e) {
    console.warn('sync', e);
    S.error = (e && e.userMessage) || (e && e.code === 'network' ? 'Keine Verbindung zum Sync-Server.' : 'Die Synchronisierung ist fehlgeschlagen. Sie wird später erneut versucht.');
    if (e && e.code === 'signed_out') { S.phase = 'off'; }
    clearTimeout(timer);
    timer = setTimeout(() => cycle().catch(() => {}), 60000);
  } finally {
    running = false;
    if (S.phase !== 'off') S.phase = mk ? 'idle' : 'off';
    S.progress = null;
    emit();
    if (again) { again = false; schedule(1500); }
  }
}
async function turnOffHereKeepNeeds() { const n = S.needs; await turnOffHere(); S.needs = n; emit(); }

// ------------------------------------------------------------------ pull
async function pull() {
  let cursor = await kv.get('sync.cursor', 0);
  const ctx = { vaultConflict: false, kinds: new Set() };
  for (let page = 0; page < 1000; page++) {
    const r = await A.rpc('sync_pull', { p_after: cursor, p_limit: 100 });
    const items = (r && r.items) || [];
    if (items.length) setProgress({ total: (S.progress.total || 0) + items.length });
    for (const item of items) {
      try { await applyRemote(item, ctx); }
      catch (e) {
        if (e && e.code === 'decrypt') { S.decryptErrors++; console.warn('sync: cannot decrypt', item.item_id); }
        else throw e;
      }
      setProgress({ done: (S.progress.done || 0) + 1 });
    }
    cursor = r.cursor;
    await kv.set('sync.cursor', cursor);
    if (!r.more) break;
  }
  if (ctx.vaultConflict || ctx.vaultOk) {
    S.vaultConflict = !!ctx.vaultConflict && !ctx.vaultOk;
    await kv.set('sync.vaultConflict', S.vaultConflict);
  }
  for (const k of ctx.kinds) { const ad = byKind[k]; if (ad && ad.after) await ad.after().catch(() => {}); }
}

async function applyRemote(item, ctx) {
  const ad = byKind[item.kind];
  if (!ad || !groupOn(ad)) return;
  let m = await map.byItem(item.item_id);
  if (m && m.version >= item.version) return;
  if (ad.kind === 'vault' && (S.vaultConflict || ctx.vaultConflict)) return; // a different Tresor lives on this device
  if (item.deleted) {
    if (!m) return;
    const loc = await localOf(ad, m.lid);
    if (loc && (loc.fp !== m.fp || (dirty[m.k] && dirty[m.k].c))) { await map.del(m.k); return; } // edited here → stays, syncs again as a new entry
    if (loc) { await muted(ad, m.lid, () => ad.remove(m.lid)); await refreshLocal(ad); ctx.kinds.add(ad.kind); }
    await map.del(m.k);
    return;
  }
  const env = await K.openMeta(mk, userId, item.item_id, item.kind, item.meta);
  const content = async () => (env.inl != null ? b64ToBlob(env.inl, env.type) : item.blob_id ? downloadBlob(item, env) : null);

  let lid = m ? m.lid : null;
  let loc = m ? await localOf(ad, lid) : null;
  if (!m) {
    if (ad.singleton) { lid = ad.singleton; loc = await localOf(ad, lid); if (loc && loc.empty) loc = null; }
    else if (ad.kind === 'file') {
      // the same file may already exist here (imported on both devices before syncing) → link instead of duplicating
      const mapped = new Set((await map.all()).filter(x => x.kind === 'file').map(x => String(x.lid)));
      for (const x of (await localIndex(ad)).values()) {
        if (mapped.has(String(x.rec.id)) || x.rec.name !== env.name || x.rec.size !== env.size) continue;
        const blob = await db.getFile(x.rec.id);
        if (blob && await K.contentHash(blob) === env.h) { lid = x.rec.id; loc = x; break; }
      }
      if (lid == null) lid = item.item_id;
    } else if (ad.kind === 'vault') lid = env.vid || item.item_id;
    else if (ad.kind === 'reminder') lid = item.item_id;
  }
  const k = lid != null ? keyOf(ad, lid) : null;
  const d = k ? dirty[k] : null;
  const changedHere = !!(loc && (!m || loc.fp !== m.fp || (d && d.c)));
  const remoteTime = Number(env.mtime) || 0, localTime = (d && d.t) || Date.now();
  let base = env.list;

  if (changedHere) {
    if (ad.merge) {
      const merged = ad.merge(m ? m.base : [], loc.rec, env.list);
      await muted(ad, lid, () => ad.apply(lid, { list: merged }, null, ctx));
      const after = await refreshLocal(ad);
      await map.put({ k: keyOf(ad, lid), kind: ad.kind, lid, item: item.item_id, version: item.version, fp: '(merged)', base: env.list, mt: remoteTime });
      void after;
      ctx.kinds.add(ad.kind);
      return; // fp differs → the merged list is pushed in this cycle
    }
    if (ad.kind === 'file' && m) {
      const blobNow = await db.getFile(lid);
      const localH = blobNow && (d && d.c || loc.rec.size !== m.z || (loc.rec.modifiedAt || 0) !== (m.mt || 0)) ? await K.contentHash(blobNow) : m.h;
      const localContent = localH !== m.h, remoteContent = env.h !== m.h;
      if (localContent && remoteContent) {
        await ad.conflictCopy(lid, devName); // local version survives as "(Konflikt von <dieses Gerät>)"
        ctx.kinds.add(ad.kind);
      } else if (!remoteContent && remoteTime < localTime) {
        await map.put({ ...m, version: item.version, h: env.h, blob: item.blob_id, mt: m.mt }); // local metadata is newer → keep, push overwrites
        return;
      } else if (localContent && !remoteContent) {
        // only metadata changed remotely, content here → newer wins for the metadata, keep our content
        if (remoteTime >= localTime) await muted(ad, lid, () => db.updateDoc(lid, { name: env.name, starred: !!env.starred, folder: env.folder || null, tags: env.tags || [] }));
        await map.put({ ...m, version: item.version, blob: item.blob_id, h: env.h });
        await refreshLocal(ad);
        return;
      }
    } else if (m && remoteTime < localTime) {
      await map.put({ ...m, version: item.version }); // local is newer → keep it, the push overwrites
      return;
    } else if (!m && ad.singleton && !ad.merge) {
      // first sync on this device and both sides have data → the cloud wins (it is what the other devices use)
    }
  }
  // apply the remote version
  const needContent = !(m && env.h && env.h === m.h && ad.kind === 'file' && loc);
  const blob = needContent ? await content() : null;
  if (ad.kind === 'file' && !blob && !loc) throw Object.assign(new Error('no content'), { code: 'decrypt' });
  const newLid = await muted(ad, lid, () => ad.apply(lid, env, blob, ctx));
  if (newLid == null) return; // not applied (e.g. a different Tresor on this device)
  if (ad.kind === 'vaultkey') ctx.vaultOk = true;
  ctx.kinds.add(ad.kind);
  const now = (await refreshLocal(ad)).get(String(newLid));
  const rec = now && now.rec;
  await map.put({ k: keyOf(ad, newLid), kind: ad.kind, lid: newLid, item: item.item_id, version: item.version, fp: now ? now.fp : '', h: env.h || null,
    blob: item.blob_id || null, z: rec && rec.size, mt: rec && rec.modifiedAt, base });
  if (dirty[keyOf(ad, newLid)]) { delete dirty[keyOf(ad, newLid)]; saveDirtySoon(); }
}

// ------------------------------------------------------------------ push
async function push() {
  let conflicted = false;
  const maps = await map.all();
  for (const ad of ADAPTERS) {
    if (!groupOn(ad) || (ad.group === 'vault' && S.vaultConflict)) continue;
    const local = await localIndex(ad, true);
    const mine = maps.filter(x => x.kind === ad.kind);
    const byLid = new Map(mine.map(x => [String(x.lid), x]));
    const todo = [];
    for (const x of local.values()) {
      const m = byLid.get(String(x.id));
      const d = dirty[keyOf(ad, x.id)];
      if (!m && x.empty) continue;
      if (m && m.fp === x.fp && !(d && d.c && ad.kind === 'file')) {
        if (d) { delete dirty[keyOf(ad, x.id)]; saveDirtySoon(); }
        continue;
      }
      todo.push([x, m]);
    }
    const gone = ad.singleton ? [] : mine.filter(m => !local.has(String(m.lid)));
    if (!todo.length && !gone.length) continue;
    setProgress({ total: (S.progress.total || 0) + todo.length + gone.length });
    for (const [x, m] of todo) {
      try {
        const r = await pushOne(ad, x, m);
        if (r === 'conflict') conflicted = true;
      } catch (e) {
        if (e && e.code === 'quota') { S.quotaFull = true; emit(); continue; }
        if (e && (e.code === 'too_many_pending' || e.code === 'upload' || e.code === 'incomplete')) { console.warn('sync push', e); continue; }
        throw e;
      }
      setProgress({ done: (S.progress.done || 0) + 1 });
    }
    for (const m of gone) {
      const r = await A.rpc('sync_delete', { p_item_id: m.item, p_base_version: m.version, p_device: devId });
      if (r && r.ok) await map.del(m.k);
      else if (r && r.reason === 'conflict') { conflicted = true; await map.del(m.k); if (r.item) await applyRemote(r.item, { kinds: new Set() }).catch(() => {}); }
      setProgress({ done: (S.progress.done || 0) + 1 });
    }
  }
  return conflicted;
}

async function pushOne(ad, x, m) {
  const k = keyOf(ad, x.id);
  const built = await ad.build(x.rec);
  if (!built) return 'skip';
  const itemId = m ? m.item : ad.singleton ? await K.singletonId(mk, ad.singleton) : K.randomId();
  const d = dirty[k];
  const env = { ...built.env, mtime: (d && d.t) || Date.now(), dev: devName };
  let blobId = null, sha = null, h = null;
  if (built.content) {
    const c = built.content;
    const unchanged = m && m.h && !(d && d.c) && x.rec && x.rec.size === m.z && (x.rec.modifiedAt || 0) === (m.mt || 0);
    h = unchanged ? m.h : await K.contentHash(c);
    env.h = h; env.type = c.type || env.type || ''; env.size = c.size;
    if (m && h === m.h && m.blob) { blobId = m.blob; env.blob = m.blob; env.chunks = m.chunks; sha = m.sha || null; }
    else if (m && h === m.h && !m.blob && c.size <= INLINE_MAX) env.inl = await blobToB64(c);
    else if (c.size <= INLINE_MAX) env.inl = await blobToB64(c);
    else {
      setProgress({ label: 'Lade hoch …' });
      const up = await uploadBlob(itemId, c, n => setProgress({ bytes: n }));
      blobId = up.blobId; sha = up.sha; env.blob = up.blobId; env.chunks = up.chunks;
    }
  }
  const meta = await K.sealMeta(mk, userId, itemId, ad.kind, env);
  const r = await A.rpc('sync_commit', { p_item_id: itemId, p_kind: ad.kind, p_base_version: m ? m.version : 0, p_meta: meta, p_blob_id: blobId, p_sha256: sha, p_device: devId });
  if (!r || !r.ok) {
    const reason = r && r.reason;
    if (reason === 'conflict') { if (r.item) await applyRemote(r.item, { kinds: new Set([ad.kind]) }).catch(e => console.warn(e)); return 'conflict'; }
    if (reason === 'quota') throw Object.assign(new Error('quota'), { code: 'quota' });
    throw Object.assign(new Error(reason || 'commit'), { code: reason || 'commit' });
  }
  await map.put({ k, kind: ad.kind, lid: x.id, item: itemId, version: r.version, fp: x.fp, h, blob: blobId, chunks: env.chunks || null, sha,
    z: x.rec && x.rec.size, mt: x.rec && x.rec.modifiedAt, base: ad.merge ? built.env.list : undefined });
  if (dirty[k]) { delete dirty[k]; saveDirtySoon(); }
  return 'ok';
}

// ------------------------------------------------------------------ garbage
async function cleanup() {
  const g = await A.rpc('sync_garbage');
  const blobs = (g && g.blobs) || [];
  if (!blobs.length) return;
  const names = [];
  for (const b of blobs) for (let i = 0; i < b.chunks; i++) names.push(`${userId}/${b.blob_id}/${i}`);
  await storageDelete(names);
  await A.rpc('sync_blob_gone', { p_blob_ids: blobs.map(b => b.blob_id) });
}

// test hooks
export const _test = { cycle, pull, push, state: S };
