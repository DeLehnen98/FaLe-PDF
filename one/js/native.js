// FaLe One – Android app layer (Capacitor). Loaded lazily by js/app.js ONLY inside the native app
// (isNativeApp() in js/config.js); the web app never loads this file.
//
//   init()                     back button (dialogs first), system bar colours
//   appStarted({ userId })     after sign-in + unlock: automatic photo backup on start / back in the foreground
//   appStopped()               signed out or locked: no more runs
//   backupCard({ compact })    the „Automatische Sicherung“ card (Fotos view and Settings)
//
// Automatic backup, first version: it runs while the app is open (start, back in the foreground, every few
// minutes while visible). The FaleMedia plugin (scripts/cap-patch-one-android.mjs) lists the phone's photos
// from MediaStore after a checkpoint (date_added, _id); each original is read through Capacitor's local
// server (convertFileSrc(content://…)) and handed to the existing backup path (engine "backup": keyed content
// hash, already stored photos are skipped) in small batches. The checkpoint only moves after a batch is done.
import { el, clear, icon, toast, openDialog, confirmDialog } from './dom.js';
import { t, tp, fmtNum, ago } from './i18n.js';
import * as E from './engine.js';
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

// ---------------------------------------------------------------- per-account settings on this device
let uid = null;
const key = k => `fale-one-ab-${k}-${uid}`;
function load(k, def) { try { const v = JSON.parse(localStorage.getItem(key(k)) || 'null'); return v && typeof v === 'object' ? { ...def, ...v } : { ...def }; } catch { return { ...def }; } }
function store(k, v) { try { localStorage.setItem(key(k), JSON.stringify(v)); } catch {} }
export const prefs = () => load('prefs', { on: false, videos: false, wifiOnly: true });
function setPrefs(patch) { store('prefs', { ...prefs(), ...patch }); }
const checkpoint = kind => load('cp-' + kind, { since: 0, afterId: 0 });
function setCheckpoint(kind, item) { store('cp-' + kind, { since: Number(item.added) || 0, afterId: Number(item.id) || 0 }); }
const status = () => load('status', { lastRun: 0, lastOk: 0, saved: 0, total: 0, stopped: null });

// live state for the cards
const live = { running: false, done: 0, total: 0, waiting: null, perm: null, net: null };
const cards = new Set();
function paint() {
  for (const c of [...cards]) {
    if (!c.node.isConnected && Date.now() - c.born > 3000) { cards.delete(c); continue; }
    try { c.paint(); } catch (e) { console.error(e); }
  }
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
async function refreshWaiting() {
  if (!uid || !canRead(live.perm)) { live.waiting = null; return null; }
  try {
    let n = 0;
    for (const kind of kinds(prefs())) { const cp = checkpoint(kind); n += (await media().count({ kind, since: cp.since, afterId: cp.afterId })).count || 0; }
    live.waiting = n;
  } catch { live.waiting = null; }
  paint();
  return live.waiting;
}

// ---------------------------------------------------------------- the run
const ownBatches = new Set();
let running = false;
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
/** Jobs of an earlier, interrupted automatic run would race the next one: they are redone from the checkpoint. */
async function cancelLeftovers() {
  for (const j of E.state.jobs.values()) {
    if (ownBatches.has(j.batch) && (j.state === 'error' || j.state === 'paused' || ACTIVE.has(j.state))) await E.call('cancel', { id: j.id }).catch(() => {});
  }
}
/** Hand files to the engine and wait until the batch is finished. → { ok, reason, done, skipped } */
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
    for (const j of failed) E.call('cancel', { id: j.id }).catch(() => {}); // e.g. too large: skipped for good
    return { ok: true, done, skipped, unreadable: failed.length };
  }
}

/** One backup run. manual = „Jetzt sichern“ (runs even when switched off, asks before using mobile data). */
export async function run({ manual = false } = {}) {
  if (running) { if (manual) toast(t('Die Sicherung läuft schon.')); return; }
  if (!uid || !E.state.started) return;
  const p = prefs();
  if (!manual && !p.on) return;
  running = true;
  live.running = true; live.done = 0; live.total = 0;
  paint();
  let saved = 0, skipped = 0, unreadable = 0, stopped = null, started = false;
  try {
    const perm = await refreshPerm();
    if (!canRead(perm)) { stopped = 'perm'; if (manual) toast(t('FaLe One hat keinen Zugriff auf deine Fotos.'), { kind: 'error' }); return; }
    if (!navigator.onLine) { stopped = 'offline'; if (manual) toast(t('Du bist offline.'), { kind: 'info' }); return; }
    const net = await network();
    if (p.wifiOnly && net.known && !net.wifi) {
      if (!manual || !(await confirmDialog({ title: t('Kein WLAN'), text: t('„Nur im WLAN“ ist eingeschaltet. Jetzt trotzdem über mobile Daten sichern?'), ok: t('Trotzdem sichern') }))) { stopped = 'wifi'; return; }
    }
    if (E.state.quota && E.state.quota.readOnly) { stopped = 'full'; if (manual) toast(QUOTA_MSG(), { kind: 'error' }); return; }
    started = true;
    await cancelLeftovers();
    live.total = (await refreshWaiting()) || 0;
    paint();
    for (const kind of kinds(p)) {
      if (kind === 'video' && perm.video === false) continue;
      for (;;) {
        const cp = checkpoint(kind);
        const r = await media().list({ kind, since: cp.since, afterId: cp.afterId, limit: PAGE });
        const items = (r && r.items) || [];
        if (!items.length) break;
        for (const group of groups(items)) {
          if (!E.state.started || !uid) { stopped = 'stopped'; return; }
          if (!manual && !prefs().on) { stopped = 'off'; return; }
          if (E.state.quota && E.state.quota.readOnly) { stopped = 'full'; return; }
          if (p.wifiOnly && !manual) { const n = await network(); if (n.known && !n.wifi) { stopped = 'wifi'; return; } }
          const files = [];
          for (const it of group) { const f = await toFile(it); if (f) files.push(f); else unreadable++; }
          if (files.length) {
            const res = await backupBatch(files);
            saved += res.done; skipped += res.skipped; unreadable += res.unreadable || 0;
            if (!res.ok) { stopped = res.reason; return; }
          }
          setCheckpoint(kind, group[group.length - 1]); // only after the whole batch is stored (or skipped for good)
          live.done += group.length;
          paint();
        }
        if (!r.hasMore) break;
      }
    }
  } catch (e) {
    console.error('auto backup', e);
    stopped = e && e.code === 'PERMISSION' ? 'perm' : 'error';
  } finally {
    running = false;
    live.running = false;
    if (uid && (started || stopped)) {
      const st = status();
      const now = Date.now();
      store('status', { lastRun: now, lastOk: stopped ? st.lastOk : now, saved, skipped, unreadable, total: (st.total || 0) + saved, stopped });
    }
    if (saved) { E.refreshQuota(); E.refreshBackup(); }
    refreshWaiting().finally(paint);
  }
}

// ---------------------------------------------------------------- triggers
let hooked = false, soonT = null, lastAuto = 0;
function soon(reason, delay = 1500) {
  clearTimeout(soonT);
  soonT = setTimeout(() => {
    if (!uid || !prefs().on || running) return;
    if (reason !== 'start' && Date.now() - lastAuto < MIN_GAP) return;
    lastAuto = Date.now();
    run().catch(e => console.error(e));
  }, delay);
}
async function afterFirstSync() {
  for (let i = 0; i < 60 && E.state.started && !E.state.lastSync && !E.state.syncError; i++) await sleep(500);
}
export function appStarted({ userId }) {
  uid = userId || null;
  live.waiting = null;
  if (!hooked) {
    hooked = true;
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') soon('visible'); });
    window.addEventListener('online', () => soon('online', 3000));
    listen('FaleSystem', 'appResume', () => soon('resume'));
    setInterval(() => { if (document.visibilityState === 'visible') soon('timer', 0); }, TIMER);
  }
  refreshPerm().then(() => refreshWaiting()).finally(paint);
  afterFirstSync().then(() => soon('start', 0));
}
export function appStopped() { uid = null; clearTimeout(soonT); paint(); }

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
async function enable() {
  const r = await openDialog({
    title: t('Fotos automatisch sichern'),
    body: [
      el('p.dlg-text', t('FaLe One sichert dann alle Fotos auf diesem Telefon im Original – die vorhandenen und jedes neue. Sie werden auf dem Gerät verschlüsselt, auch Aufnahmeort und Datum, bevor etwas hochgeladen wird. Schon gesicherte Fotos werden erkannt und übersprungen.')),
      el('p.dlg-text', t('Dafür fragt Android gleich nach dem Zugriff auf deine Fotos und Videos.')),
      el('p.dlg-text.muted', t('In dieser Version läuft die Sicherung, solange FaLe One geöffnet ist.')),
    ],
    actions: [{ label: t('Abbrechen'), value: 'cancel' }, { label: t('Weiter'), value: 'ok', default: true }],
  });
  if (r.value !== 'ok') return false;
  if (!(await askAccess())) return false;
  setPrefs({ on: true });
  paint();
  lastAuto = Date.now();
  run().catch(e => console.error(e));
  return true;
}

// ---------------------------------------------------------------- UI
const STOP_TEXT = () => ({
  wifi: t('Wartet auf WLAN.'),
  offline: t('Wartet auf eine Internetverbindung.'),
  full: t('Angehalten: Dein Speicher ist voll.'),
  perm: t('Kein Zugriff auf deine Fotos.'),
  paused: t('Angehalten, weil Uploads pausiert wurden.'),
  network: t('Verbindung unterbrochen – geht beim nächsten Öffnen weiter.'),
  limit: t('Tageslimit erreicht. Es geht morgen weiter.'),
  error: t('Unterbrochen – wird beim nächsten Öffnen erneut versucht.'),
});
let cardSeq = 0;
export function backupCard({ compact = false } = {}) {
  const id = 'ab-' + (++cardSeq);
  const node = el('section.card.ab-card', { aria: { labelledby: id + '-t' }, data: { autobackup: compact ? 'compact' : 'full' } });
  const c = { node, born: Date.now(), paint: null };
  c.paint = () => {
    const p = uid ? prefs() : { on: false, videos: false, wifiOnly: true };
    const st = uid ? status() : {};
    const perm = live.perm;
    const sw = el('input', { type: 'checkbox', role: 'switch', id: id + '-sw', checked: p.on, disabled: !uid, aria: { describedby: id + '-d' },
      onchange: async e => {
        e.target.disabled = true;
        if (e.target.checked) await enable(); else { setPrefs({ on: false }); toast(t('Automatische Sicherung ausgeschaltet.')); }
        paint();
      } });
    const opt = (label, k, extra) => el('label.check.sm', el('input', { type: 'checkbox', checked: !!p[k], disabled: !uid, onchange: e => { setPrefs({ [k]: e.target.checked }); if (k === 'videos') refreshWaiting(); paint(); } }), el('span', label, extra || null));
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
      el('p.muted.ab-desc', { id: id + '-d' }, p.on ? t('Neue Fotos auf diesem Telefon werden von selbst verschlüsselt gesichert – solange FaLe One geöffnet ist. Sicherung im Hintergrund kommt später.') : t('Sichert die Fotos auf diesem Telefon von selbst – verschlüsselt und im Original. In dieser Version, solange FaLe One geöffnet ist.')),
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
