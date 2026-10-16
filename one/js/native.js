// FaLe One – Android app layer (Capacitor). Loaded lazily by js/app.js ONLY inside the native app
// (isNativeApp() in js/config.js); the web app never loads this file.
//
//   init()                                            back button (dialogs first), system bar colours, session hooks
//   appStarted({ userId, mk, deviceId, deviceName })  after sign-in + unlock: background backup armed, run on start
//   appStopped({ step })                              signed out / locked: the background backup stops and forgets its keys
//   backupCard({ compact })                           the „Automatische Sicherung“ card (Fotos view and Settings)
//
// Automatic backup runs in the background, also while the app is closed: the FaleBackup plugin
// (one-android/native) schedules WorkManager jobs (every few hours, shortly after new photos, „Jetzt sichern“)
// that encrypt and upload in Java – byte-compatible with the web worker (FaleCrypto, cross-tested in CI). For that
// the plugin keeps, sealed with an Android Keystore key: the account keys KEK / DK / DVK (derived here from the
// master key, which never leaves this WebView), the session and the endpoints. Turning the switch off, signing
// out, a locked app or a removed device wipe them at once. While the plugin holds the session it is the only
// one that refreshes it (auth.js asks it), so a rotated refresh token is never reused.
// Fallback when the background part cannot be set up: the in-app run of the first version (originals through
// Capacitor's local server into the engine's backup path) with the same checkpoint and single-writer lock.
import { el, clear, icon, toast, openDialog, confirmDialog } from './dom.js';
import { t, tp, fmtNum, ago, getLang } from './i18n.js';
import * as E from './engine.js';
import * as A from './auth.js';
import { apiBase } from './config.js';
import { isMedia, mimeOf } from './media.js';

const PAGE = 60;                      // MediaStore rows per list() call
const BATCH_FILES = 12;               // files per engine batch (memory stays bounded)
const BATCH_BYTES = 160 * 1024 * 1024;
const MIN_GAP = 60 * 1000;            // automatic runs at most once a minute
const TIMER = 10 * 60 * 1000;         // while visible: look for new photos every 10 minutes
const ACTIVE = new Set(['waiting', 'hashing', 'queued', 'uploading', 'committing']);
const PERMANENT = new Set(['too_large', 'read', 'bad_input', 'unsupported']); // retrying would never help
const QUOTA_MSG = () => t('Dein Speicher ist voll. Alles bleibt lesbar – lösche etwas, leere den Papierkorb oder exportiere.');

// ---------------------------------------------------------------- native bridge
const cap = () => window.Capacitor;
const pluginCache = new Map();
/** Plugin handle: Capacitor.Plugins[name] (exported by the native bridge), else a proxy over nativePromise. */
export function plugin(name) {
  if (pluginCache.has(name)) return pluginCache.get(name);
  const c = cap();
  let p = c && c.Plugins && c.Plugins[name] ? c.Plugins[name] : null;
  if (!p && c && typeof c.nativePromise === 'function') {
    p = new Proxy({}, { get: (_, m) => (m === 'then' || typeof m !== 'string' ? undefined : (opts) => c.nativePromise(name, m, opts || {})) });
  }
  pluginCache.set(name, p);
  return p;
}
const media = () => plugin('FaleMedia');
const system = () => plugin('FaleSystem');
const bg = () => plugin('FaleBackup');
function listen(name, event, cb) {
  try {
    const p = plugin(name);
    if (p && typeof p.addListener === 'function') return p.addListener(event, cb);
    const c = cap();
    if (c && typeof c.addListener === 'function') return c.addListener(name, event, cb);
  } catch (e) { console.warn('listener', name, event, e); }
  return null;
}

// ---------------------------------------------------------------- init: back button, system bars
let inited = false;
export function init() {
  if (inited) return;
  inited = true;
  // one session refresher: while the background backup holds the session, auth.js refreshes through it
  A.useNativeSession({ token: o => bg().token(o) });
  // sign-out / account deleted / session expired: the background backup forgets keys and tokens first
  A.onLocalWipe(reason => bg().disarm({ reason: String(reason || 'signout') }));
  // Back button (MainActivity): close the topmost dialog first; "true" = handled, else web history / background.
  window.faleOneBack = () => {
    const open = [...document.querySelectorAll('dialog[open]')];
    const d = open[open.length - 1];
    if (!d) return false;
    const ev = new Event('cancel', { cancelable: true });
    d.dispatchEvent(ev);
    if (!ev.defaultPrevented) d.close();
    return true;
  };
  const bars = () => {
    const s = system();
    if (!s || typeof s.setBarColors !== 'function') return;
    const color = hexOf(getComputedStyle(document.body || document.documentElement).backgroundColor) || '#F2F3F9';
    s.setBarColors({ color, dark: isDark(color) }).catch(() => {});
  };
  bars();
  window.addEventListener('load', bars);
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setTimeout(bars, 50)); } catch {}
  new MutationObserver(() => setTimeout(bars, 50)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
function hexOf(rgb) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(rgb || '');
  if (!m || (m[4] !== undefined && +m[4] === 0)) return null;
  return '#' + [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, '0')).join('').toUpperCase();
}
function isDark(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) < 128;
}

// ---------------------------------------------------------------- state of the background backup (native)
let uid = null, ctx = null;
let ns = null;                       // last FaleBackup.state()
let armState = 'unknown';            // 'armed' | 'failed' | 'unknown'
const DEFAULTS = { on: false, videos: false, wifiOnly: true };
/** Switch + options of the signed-in account (kept natively – the background jobs need them). */
export const prefs = () => (ns && uid && ns.user === uid ? { ...DEFAULTS, ...ns.prefs } : { ...DEFAULTS });
const status = () => (ns && uid && ns.user === uid && ns.status) || {};
async function refreshState() {
  try { ns = await bg().state(); } catch { ns = null; }
  if (ns && ns.live && ns.user === uid) applyLive(ns.live);
  return ns;
}
async function setPrefs(patch) {
  if (!uid) return;
  const r = await bg().setPrefs({ userId: uid, lang: getLang(), ...patch });
  if (patch.on === false) await A.withSession(async s => { if (s) await s.adopt(r); }).catch(() => {});
  await refreshState();
  paint();
}

/** The first version kept switch + checkpoint in localStorage: move them to the native store once. */
async function migrate() {
  const key = k => `fale-one-ab-${k}-${uid}`;
  const read = k => { try { return JSON.parse(localStorage.getItem(key(k)) || 'null'); } catch { return null; } };
  const old = read('prefs');
  if (!old) return;
  try {
    for (const kind of ['image', 'video']) {
      const cp = read('cp-' + kind);
      if (cp && (cp.since || cp.afterId)) await bg().setCheckpoint({ userId: uid, kind, since: Number(cp.since) || 0, afterId: Number(cp.afterId) || 0 });
    }
    if (!(ns && ns.user === uid)) await bg().setPrefs({ userId: uid, on: !!old.on, videos: !!old.videos, wifiOnly: old.wifiOnly !== false, lang: getLang() });
    for (const k of ['prefs', 'cp-image', 'cp-video', 'status']) { try { localStorage.removeItem(key(k)); } catch {} }
  } catch (e) { console.warn('migrate', e); }
  await refreshState();
}

// ---------------------------------------------------------------- handing the keys to the background backup
const te = new TextEncoder();
const b64u = u => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
/**
 * The account keys of FaLe One (js/one/crypto.js deriveKeys: KEK, dedupe key, device key) as raw bytes – derived
 * from the master key with HKDF exactly like the worker does (deriveBits = the bytes behind deriveKey). Only these
 * three go to the background backup, never the master key (which also opens FaLe Sync, Notfallzugang, …).
 */
export async function deriveBackgroundKeys(mk, userId) {
  const bits = async info => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: te.encode(`fale-one-v1|${userId}`), info: te.encode(info) }, mk, 256));
  return { kek: await bits('fale-one-v1/kek'), dk: await bits('fale-one-v1/dedupe'), dvk: await bits('fale-one-v1/device') };
}
/** Everything FaleBackup.arm() needs. session: { refresh, user, access, exp }, account: { supabaseUrl, supabaseKey } */
export async function armPayload({ userId, mk, deviceId, deviceName, session, account, photosFolderId = null, folderName, lang }) {
  const k = await deriveBackgroundKeys(mk, userId);
  try {
    return {
      userId, email: (session.user && session.user.email) || '', deviceId, deviceName,
      kek: b64u(k.kek), dk: b64u(k.dk), dvk: b64u(k.dvk),
      apiBase: apiBase(), supabaseUrl: account.supabaseUrl, supabaseKey: account.supabaseKey,
      refresh: session.refresh, access: session.access || undefined, accessExp: session.access ? session.exp : undefined,
      photosFolderId: photosFolderId || undefined, folderName: folderName || t('Fotos'), lang: lang || getLang(), touchPlatform: 'web',
    };
  } finally { k.kek.fill(0); k.dk.fill(0); k.dvk.fill(0); }
}
async function arm() {
  if (!ctx || !uid) return false;
  try {
    const account = await A.accountConfig();
    if (!account.configured || !account.supabaseUrl || !account.supabaseKey) throw new Error('account not configured');
    let folder = null;
    try { folder = (await E.call('photosFolder', { folderName: t('Fotos') })).id; } catch { folder = null; } // offline: the background run creates it
    const ok = await A.withSession(async s => {
      if (!s || !s.user || s.user.id !== uid) return false;
      await bg().arm(await armPayload({ ...ctx, userId: uid, session: s, account, photosFolderId: folder }));
      return true;
    });
    armState = ok ? 'armed' : 'failed';
  } catch (e) {
    console.warn('background backup not available', e);
    armState = 'failed';
  }
  await refreshState();
  paint();
  return armState === 'armed';
}

// ---------------------------------------------------------------- live state for the cards
const live = { running: false, done: 0, total: 0, waiting: null, perm: null, net: null, where: null };
const cards = new Set();
function paint() {
  for (const c of [...cards]) {
    if (!c.node.isConnected && Date.now() - c.born > 3000) { cards.delete(c); continue; }
    try { c.paint(); } catch (e) { console.error(e); }
  }
}
let wasRunning = false;
function applyLive(l) {
  if (!l || typeof l !== 'object') return;
  if (inApp) return; // the in-app fallback run paints its own progress
  live.running = !!l.running;
  live.done = Number(l.done) || 0;
  live.total = Number(l.total) || 0;
  live.where = l.running ? 'bg' : null;
}
function onProgress(l) {
  applyLive(l);
  if (wasRunning && !l.running) { // a native run ended: show what it stored
    refreshState().then(() => refreshWaiting());
    if (Number(l.saved) > 0 && E.state.started) { E.syncNow().then(() => { E.refreshQuota(); E.refreshBackup(); }); }
  }
  wasRunning = !!l.running;
  paint();
}

const canRead = perm => !!perm && (perm.media === 'granted' || perm.media === 'limited');
async function refreshPerm() {
  try { live.perm = await media().checkPermissions(); } catch { live.perm = null; }
  return live.perm;
}
/** {known, wifi}: the native connectivity check first, then navigator.connection; unknown → allowed. */
async function network() {
  try {
    const n = await system().network();
    if (n && n.known && n.connected) return (live.net = { known: true, wifi: !!n.wifi });
  } catch {}
  const c = navigator.connection;
  if (c && c.type && c.type !== 'unknown' && c.type !== 'other') return (live.net = { known: true, wifi: c.type === 'wifi' || c.type === 'ethernet' });
  return (live.net = { known: false, wifi: false });
}
const kinds = p => (p.videos ? ['image', 'video'] : ['image']);
const checkpoint = async kind => { try { return await bg().getCheckpoint({ userId: uid, kind }); } catch { return { since: 0, afterId: 0 }; } };
async function refreshWaiting() {
  if (!uid || !canRead(live.perm)) { live.waiting = null; return null; }
  try {
    let n = 0;
    for (const kind of kinds(prefs())) { const cp = await checkpoint(kind); n += (await media().count({ kind, since: cp.since, afterId: cp.afterId })).count || 0; }
    live.waiting = n;
  } catch { live.waiting = null; }
  paint();
  return live.waiting;
}

// ---------------------------------------------------------------- runs
/** One backup run. manual = „Jetzt sichern“ (asks before using mobile data when „Nur im WLAN“ is on). */
export async function run({ manual = false } = {}) {
  if (!uid) return;
  const p = prefs();
  if (!manual && !p.on) return;
  if (live.running) { if (manual) toast(t('Die Sicherung läuft schon.')); return; }
  const perm = await refreshPerm();
  if (!canRead(perm)) { if (manual) toast(t('FaLe One hat keinen Zugriff auf deine Fotos.'), { kind: 'error' }); paint(); return; }
  let allowMetered = false;
  if (manual) {
    if (!navigator.onLine) { toast(t('Du bist offline.'), { kind: 'info' }); return; }
    const net = await network();
    if (p.wifiOnly && net.known && !net.wifi) {
      if (!(await confirmDialog({ title: t('Kein WLAN'), text: t('„Nur im WLAN“ ist eingeschaltet. Jetzt trotzdem über mobile Daten sichern?'), ok: t('Trotzdem sichern') }))) return;
      allowMetered = true;
    }
  }
  if (armState !== 'armed' || !(ns && ns.armed)) await arm();
  if (armState === 'armed') {
    try {
      await bg().runNow({ allowMetered }); // progress arrives as "backupProgress" events once Android starts the job
      if (manual) toast(t('Die Sicherung startet gleich.'));
      return;
    } catch (e) { console.warn('runNow', e); }
  }
  return runInApp({ manual, allowMetered }); // the background part is not available: as in the first version, while the app is open
}

// The in-app fallback run: same checkpoint (native store) and the same single-writer lock as the background jobs.
const PAGE = 60;                      // MediaStore rows per list() call
const BATCH_FILES = 12;               // files per engine batch (memory stays bounded)
const BATCH_BYTES = 160 * 1024 * 1024;
const ACTIVE = new Set(['waiting', 'hashing', 'queued', 'uploading', 'committing']);
const PERMANENT = new Set(['too_large', 'read', 'bad_input', 'unsupported']); // retrying would never help
const ownBatches = new Set();
let inApp = false;
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** content:// item → File (original bytes, through Capacitor's local server); null when unreadable. */
export async function toFile(it) {
  const type = mimeOf(it.name, it.mime || '');
  if (!isMedia(it.name, type)) return null;
  const uris = [it.uri, it.plainUri].filter((u, i, a) => u && a.indexOf(u) === i);
  for (const u of uris) {
    try {
      const res = await fetch(cap().convertFileSrc(u), { cache: 'no-store' });
      if (!res.ok) continue;
      const blob = await res.blob();
      if (!blob.size) continue;
      return new File([blob], it.name, { type, lastModified: Number(it.taken) || Date.now() });
    } catch { /* next URI */ }
  }
  return null;
}
function groups(items) {
  const out = [];
  let cur = [], bytes = 0;
  for (const it of items) {
    const size = Number(it.size) || 0;
    if (cur.length && (cur.length >= BATCH_FILES || bytes + size > BATCH_BYTES)) { out.push(cur); cur = []; bytes = 0; }
    cur.push(it); bytes += size;
  }
  if (cur.length) out.push(cur);
  return out;
}
async function cancelLeftovers() {
  for (const j of E.state.jobs.values()) {
    if (ownBatches.has(j.batch) && (j.state === 'error' || j.state === 'paused' || ACTIVE.has(j.state))) await E.call('cancel', { id: j.id }).catch(() => {});
  }
}
async function backupBatch(files) {
  let r;
  try { r = await E.call('backup', { files: files.map(f => ({ file: f, name: f.name })), folderName: t('Fotos') }); }
  catch (e) { return { ok: false, reason: e.code === 'quota_exceeded' ? 'full' : 'error', error: e, done: 0, skipped: 0 }; }
  ownBatches.add(r.batch);
  for (;;) {
    await sleep(800);
    if (!E.state.started) return { ok: false, reason: 'stopped', done: 0, skipped: 0 };
    const list = [...E.state.jobs.values()].filter(j => j.batch === r.batch);
    if (list.some(j => ACTIVE.has(j.state))) continue;
    const done = list.filter(j => j.state === 'done').length, skipped = list.filter(j => j.state === 'skipped').length;
    const failed = list.filter(j => j.state === 'error' || j.state === 'paused');
    const hard = failed.filter(j => j.state === 'paused' || !(j.error && PERMANENT.has(j.error.code)));
    if (hard.length) {
      const code = c => hard.some(j => j.error && j.error.code === c);
      const reason = code('quota_exceeded') ? 'full' : hard.some(j => j.state === 'paused') ? 'paused' : code('network') ? 'network' : code('drive_limit') ? 'limit' : 'error';
      return { ok: false, reason, done, skipped };
    }
    for (const j of failed) E.call('cancel', { id: j.id }).catch(() => {});
    return { ok: true, done, skipped, unreadable: failed.length };
  }
}
async function runInApp({ manual, allowMetered }) {
  if (inApp || !E.state.started) return;
  const p = prefs();
  let lock = null;
  try { lock = (await bg().lock({ owner: 'app', ttl: 180000 })).token; } catch { lock = null; }
  if (!lock) { if (manual) toast(t('Die Sicherung läuft schon.')); return; }
  inApp = true;
  live.running = true; live.where = 'app'; live.done = 0; live.total = 0;
  paint();
  const renew = setInterval(() => { bg().lock({ token: lock, ttl: 180000 }).catch(() => {}); }, 60000);
  let saved = 0;
  try {
    if (E.state.quota && E.state.quota.readOnly) { if (manual) toast(QUOTA_MSG(), { kind: 'error' }); return; }
    await cancelLeftovers();
    live.total = (await refreshWaiting()) || 0;
    paint();
    for (const kind of kinds(p)) {
      if (kind === 'video' && live.perm && live.perm.video === false) continue;
      for (;;) {
        const cp = await checkpoint(kind);
        const r = await media().list({ kind, since: cp.since, afterId: cp.afterId, limit: PAGE });
        const items = (r && r.items) || [];
        if (!items.length) break;
        for (const group of groups(items)) {
          if (!E.state.started || !uid) return;
          if (!manual && !prefs().on) return;
          if (p.wifiOnly && !allowMetered) { const n = await network(); if (n.known && !n.wifi) return; }
          const files = [];
          for (const it of group) { const f = await toFile(it); if (f) files.push(f); }
          if (files.length) {
            const res = await backupBatch(files);
            saved += res.done;
            if (!res.ok) return;
          }
          const last = group[group.length - 1];
          await bg().setCheckpoint({ userId: uid, kind, since: Number(last.added) || 0, afterId: Number(last.id) || 0 }); // only after the whole batch
          live.done += group.length;
          paint();
        }
        if (!r.hasMore) break;
      }
    }
  } catch (e) {
    console.error('auto backup (in app)', e);
  } finally {
    clearInterval(renew);
    bg().unlock({ token: lock }).catch(() => {});
    inApp = false;
    live.running = false; live.where = null;
    if (saved) { E.refreshQuota(); E.refreshBackup(); }
    refreshWaiting().finally(paint);
  }
}

// ---------------------------------------------------------------- triggers
const MIN_GAP = 60 * 1000;            // automatic runs from the app at most once a minute
let hooked = false, soonT = null, lastAuto = 0;
function soon(reason, delay = 1500) {
  clearTimeout(soonT);
  soonT = setTimeout(() => {
    if (!uid || !prefs().on || live.running) return;
    if (reason !== 'start' && Date.now() - lastAuto < MIN_GAP) return;
    lastAuto = Date.now();
    run().catch(e => console.error(e));
  }, delay);
}
async function afterFirstSync() {
  for (let i = 0; i < 60 && E.state.started && !E.state.lastSync && !E.state.syncError; i++) await sleep(500);
}
export async function appStarted({ userId, mk, deviceId, deviceName }) {
  uid = userId || null;
  ctx = uid ? { mk, deviceId, deviceName } : null;
  live.waiting = null;
  if (!hooked) {
    hooked = true;
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { refreshState().then(paint); soon('visible'); } });
    window.addEventListener('online', () => soon('online', 3000));
    listen('FaleSystem', 'appResume', () => soon('resume'));
    listen('FaleBackup', 'backupProgress', l => onProgress(l || {}));
  }
  await refreshState();
  await migrate();
  refreshPerm().then(() => refreshWaiting()).finally(paint);
  if (!prefs().on) { if (ns && ns.armed && ns.user !== uid) await bg().disarm({ reason: 'other account' }).catch(() => {}); return; }
  await afterFirstSync();
  if (uid === userId) { await arm(); soon('start', 0); }
}
/** Signed out, locked or the key changed: the background backup must not go on with keys of this session. */
export async function appStopped() {
  uid = null; ctx = null; armState = 'unknown';
  clearTimeout(soonT);
  try {
    await A.withSession(async s => {
      const r = await bg().disarm({ reason: 'app stopped' });
      if (s) await s.adopt(r); // locked, still signed in: keep the newest tokens
    });
  } catch {}
  ns = null;
  paint();
}

// ---------------------------------------------------------------- permission flow
async function openSettings() { try { await system().openAppSettings(); } catch {} }
async function askAccess() {
  let perm = await refreshPerm();
  if (!canRead(perm) || perm.media === 'limited') {
    try { perm = live.perm = await media().requestPermissions(); } catch { perm = live.perm; }
  }
  if (!canRead(perm)) {
    toast(t('Ohne Zugriff auf deine Fotos kann FaLe One sie nicht sichern. Du kannst ihn in den Android-Einstellungen erlauben.'), { kind: 'error', action: { label: t('Einstellungen'), run: openSettings }, timeout: 9000 });
  }
  refreshWaiting().finally(paint);
  return canRead(perm);
}
/** Android 13+: ask politely for notifications – optional, the backup also runs without them. */
async function askNotifications() {
  if (!ns || ns.notifications !== 'prompt') return;
  const r = await openDialog({
    title: t('Mitteilungen erlauben?'),
    body: [
      el('p.dlg-text', t('FaLe One zeigt eine kleine Mitteilung, solange Fotos gesichert werden – und sagt Bescheid, falls du dich neu anmelden musst.')),
      el('p.dlg-text.muted', t('Ohne Mitteilungen wird trotzdem gesichert.')),
    ],
    actions: [{ label: t('Nicht jetzt'), value: 'no' }, { label: t('Erlauben'), value: 'ok', default: true }],
  });
  if (r.value === 'ok') { try { await bg().requestNotifications(); } catch {} }
  await refreshState();
}
async function enable() {
  const r = await openDialog({
    title: t('Fotos automatisch sichern'),
    body: [
      el('p.dlg-text', t('FaLe One sichert dann alle Fotos auf diesem Telefon im Original – die vorhandenen und jedes neue. Sie werden auf dem Gerät verschlüsselt, auch Aufnahmeort und Datum, bevor etwas hochgeladen wird. Schon gesicherte Fotos werden erkannt und übersprungen.')),
      el('p.dlg-text', t('Dafür fragt Android gleich nach dem Zugriff auf deine Fotos und Videos.')),
      el('p.dlg-text.muted', t('Die Sicherung läuft auch, wenn FaLe One geschlossen ist. Android kann sie verzögern, um Akku zu sparen.')),
    ],
    actions: [{ label: t('Abbrechen'), value: 'cancel' }, { label: t('Weiter'), value: 'ok', default: true }],
  });
  if (r.value !== 'ok') return false;
  if (!(await askAccess())) return false;
  await askNotifications();
  await setPrefs({ on: true });
  await arm();
  lastAuto = Date.now();
  run().catch(e => console.error(e));
  return true;
}
async function disable() {
  await setPrefs({ on: false }); // native: cancels the jobs and wipes keys + tokens at once
  armState = 'unknown';
  toast(t('Automatische Sicherung ausgeschaltet.'));
}

// ---------------------------------------------------------------- UI
const QUOTA_MSG = () => t('Dein Speicher ist voll. Alles bleibt lesbar – lösche etwas, leere den Papierkorb oder exportiere.');
const STOP_TEXT = () => ({
  wifi: t('Wartet auf WLAN.'),
  offline: t('Wartet auf eine Internetverbindung.'),
  full: t('Angehalten: Dein Speicher ist voll.'),
  perm: t('Kein Zugriff auf deine Fotos.'),
  paused: t('Angehalten, weil Uploads pausiert wurden.'),
  network: t('Verbindung unterbrochen – wird bald erneut versucht.'),
  limit: t('Tageslimit erreicht. Es geht morgen weiter.'),
  error: t('Unterbrochen – wird bald erneut versucht.'),
  signin: t('Angehalten: Bitte melde dich neu an.'),
});
let cardSeq = 0;
export function backupCard({ compact = false } = {}) {
  const id = 'ab-' + (++cardSeq);
  const node = el('section.card.ab-card', { aria: { labelledby: id + '-t' }, data: { autobackup: compact ? 'compact' : 'full' } });
  const c = { node, born: Date.now(), paint: null };
  c.paint = () => {
    const p = uid ? prefs() : { ...DEFAULTS };
    const st = uid ? status() : {};
    const perm = live.perm;
    const sw = el('input', { type: 'checkbox', role: 'switch', id: id + '-sw', checked: p.on, disabled: !uid, aria: { describedby: id + '-d' },
      onchange: async e => {
        e.target.disabled = true;
        try { if (e.target.checked) await enable(); else await disable(); } catch (err) { console.error(err); }
        paint();
      } });
    const opt = (label, k, extra) => el('label.check.sm', el('input', { type: 'checkbox', checked: !!p[k], disabled: !uid, onchange: async e => { await setPrefs({ [k]: e.target.checked }).catch(() => {}); if (k === 'videos') refreshWaiting(); paint(); } }), el('span', label, extra || null));
    const lines = [];
    if (live.running) lines.push(live.total ? t('Sichert … {done} von {total}', { done: fmtNum(Math.min(live.done, live.total)), total: fmtNum(live.total) }) : t('Sichert …'));
    else if (st.stopped && STOP_TEXT()[st.stopped]) lines.push(STOP_TEXT()[st.stopped]);
    else if (st.lastOk) lines.push(t('Zuletzt gesichert: {when}', { when: ago(st.lastOk) }) + (st.saved ? ' · ' + tp(st.saved, '{n} neues Foto', '{n} neue Fotos') : ''));
    else if (p.on) lines.push(t('Startet gleich …'));
    if (p.on && live.waiting != null && !live.running) lines.push(live.waiting ? tp(live.waiting, '{n} wartend', '{n} wartend') : t('Alles gesichert.'));
    clear(node).append(
      el('div.ab-head',
        el('span.ab-ic', icon('cloudUp')),
        el('label.ab-title', { for: id + '-sw', id: id + '-t' }, t('Automatische Sicherung')),
        el('span.switch', sw, el('span.switch-track', { aria: { hidden: 'true' } }))),
      el('p.muted.ab-desc', { id: id + '-d' }, p.on ? t('Neue Fotos auf diesem Telefon werden von selbst verschlüsselt gesichert – auch wenn FaLe One geschlossen ist. Android kann Sicherungen verzögern, um Akku zu sparen.') : t('Sichert die Fotos auf diesem Telefon von selbst – verschlüsselt und im Original, auch im Hintergrund. Android kann Sicherungen verzögern, um Akku zu sparen.')),
      p.on && armState === 'failed' ? el('p.muted.ab-desc', t('Im Hintergrund gerade nicht verfügbar – gesichert wird, solange FaLe One geöffnet ist.')) : null,
      p.on && perm && perm.media === 'limited' ? el('div.callout.ab-callout', icon('info'), el('div', el('p', t('Du hast FaLe One nur ausgewählte Fotos freigegeben. Nur diese werden gesichert.')), el('button.link-btn', { type: 'button', onclick: () => askAccess() }, t('Auswahl ändern')))) : null,
      p.on && perm && !canRead(perm) ? el('div.callout.warn.ab-callout', icon('warning'), el('div', el('p', t('Kein Zugriff auf deine Fotos.')), el('button.link-btn', { type: 'button', onclick: async () => { if (!(await askAccess())) openSettings(); } }, t('Zugriff erlauben')))) : null,
      p.on && !compact ? el('div.ab-opts',
        opt(t('Auch Videos sichern'), 'videos'),
        opt(t('Nur im WLAN'), 'wifiOnly', p.wifiOnly && live.net && !live.net.known ? el('span.muted', t('Ob du im WLAN bist, ist auf diesem Gerät gerade nicht erkennbar – es wird trotzdem gesichert.')) : null)) : null,
      lines.length ? el('p.ab-status', { aria: { live: 'polite' } }, lines.join(' · ')) : null,
      p.on ? el('div.set-btns',
        el('button.btn.ghost.sm', { type: 'button', disabled: live.running || !uid, onclick: () => run({ manual: true }) }, icon('refresh'), t('Jetzt sichern')),
        compact ? el('a.btn.ghost.sm', { href: '#/einstellungen' }, t('Optionen')) : null) : null);
  };
  cards.add(c);
  c.paint();
  if (uid) { if (!live.perm) refreshPerm().then(() => refreshWaiting()).finally(paint); if (!live.net) network().then(paint, () => {}); }
  return node;
}
