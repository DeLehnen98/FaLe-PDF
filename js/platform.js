// FaLe PDF — platform layer: hides the differences between the web/PWA build and
// the native Android app (Capacitor). Every function has a web fallback, so this
// module is safe to import everywhere.
//
//   isNative()                                   → boolean
//   saveFile(blobOrBytes, filename, mime)        → {ok, where}
//   shareFile(blobOrBytes, filename, mime, {title, text}) → {ok, method}
//   printPdf(bytes, filename)                    → {ok, method} (Android print dialog; web: caller prints)
//   scheduleNotification({id, at, title, body, route}) → boolean (system notification scheduled?)
//   cancelNotification(id)                       → void
//   dueReminders({remove}) / listReminders()     → in-app reminder list (web + native)
//   onIncomingFiles(cb(File[], {source}))        → unsubscribe()
//   haptic(kind)                                 → void ('light'|'medium'|'heavy'|'selection'|'success'|'warning'|'error')
//   setStatusBarTheme(dark)                      → void
//   openLegalPage(path)                          → shows e.g. datenschutz.html (in-app dialog on native)
//
// No @capacitor/core import (the app has no bundler): we talk to the native bridge
// that Capacitor injects as window.Capacitor. Plugins are reached via
// Capacitor.registerPlugin (when @capacitor/core is present), the bridge's
// nativePromise/nativeCallback, or Capacitor.Plugins (legacy/mocked).

import { t } from './i18n/index.js';

const SAVE_DIR = 'FaLe PDF';
const MAX_CHUNK = 3 * 1024 * 1024; // bytes per bridge call (multiple of 3 → clean base64 chunks)
const REMINDER_KEY = 'fale-reminders';

// ---------------------------------------------------------------- detection
export function isNative() {
  const c = typeof window !== 'undefined' ? window.Capacitor : null;
  if (!c) return false;
  try {
    if (typeof c.isNativePlatform === 'function') return !!c.isNativePlatform();
    return !!c.isNative;
  } catch { return false; }
}

export function platformName() {
  if (!isNative()) return 'web';
  try { return window.Capacitor.getPlatform(); } catch { return 'android'; }
}

// ---------------------------------------------------------------- plugin access
const pluginCache = new Map();

function rawPlugin(name) {
  const c = window.Capacitor;
  return new Proxy({}, {
    get(_, method) {
      if (method === 'then' || typeof method !== 'string') return undefined;
      if (method === 'addListener') {
        return async (eventName, cb) => {
          const callbackId = c.nativeCallback(name, 'addListener', { eventName }, data => cb(data));
          return { remove: () => c.nativePromise(name, 'removeListener', { eventName, callbackId }).catch(() => {}) };
        };
      }
      return (opts) => c.nativePromise(name, method, opts || {});
    },
  });
}

/** Returns a plugin handle or null. */
export function plugin(name) {
  if (!isNative()) return null;
  if (pluginCache.has(name)) return pluginCache.get(name);
  const c = window.Capacitor;
  let p = null;
  if (typeof c.registerPlugin === 'function') { try { p = c.registerPlugin(name); } catch { p = null; } } // @capacitor/core loaded
  else if (typeof c.nativePromise === 'function') p = rawPlugin(name); // bare native bridge
  if (!p && c.Plugins && c.Plugins[name]) p = c.Plugins[name]; // legacy / mocked
  pluginCache.set(name, p);
  return p;
}

async function addListener(p, eventName, cb) {
  const r = p.addListener(eventName, cb);
  return (r && typeof r.then === 'function') ? await r : r;
}

// ---------------------------------------------------------------- helpers
async function uiToast(msg, type = 'info', opts) {
  try { const ui = await import('./ui.js'); ui.toast(msg, type, opts); } catch { /* no UI (tests) */ }
}

function toBlob(data, mime) {
  if (data instanceof Blob) return (mime && !data.type) ? new Blob([data], { type: mime }) : data;
  if (data instanceof ArrayBuffer) return new Blob([data], { type: mime || 'application/octet-stream' });
  if (ArrayBuffer.isView(data)) return new Blob([data], { type: mime || 'application/octet-stream' });
  return new Blob([String(data ?? '')], { type: mime || 'text/plain' });
}

function bytesToBase64(bytes) {
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  return btoa(s);
}

export function base64ToBytes(b64) {
  const s = atob(String(b64 || '').replace(/^data:[^,]*,/, ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function cleanName(name) {
  const n = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (n || 'Dokument').slice(0, 150);
}

function splitExt(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? [name.slice(0, i), name.slice(i)] : [name, ''];
}

/** Write a blob in chunks through the Filesystem plugin. Returns the result of the first write ({uri}). */
async function writeChunked(fs, blob, path, directory) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let first = null;
  if (!buf.length) return fs.writeFile({ path, data: '', directory, recursive: true });
  for (let off = 0; off < buf.length; off += MAX_CHUNK) {
    const data = bytesToBase64(buf.subarray(off, Math.min(off + MAX_CHUNK, buf.length)));
    if (off === 0) first = await fs.writeFile({ path, data, directory, recursive: true });
    else await fs.appendFile({ path, data, directory });
  }
  return first;
}

function webDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ---------------------------------------------------------------- save
/**
 * Save a file for the user. Web: regular download. Android: Documents/FaLe PDF/
 * (falls back to the share sheet, e.g. "In Drive speichern", if writing fails).
 * Resolves {ok, where}; where = 'download' | 'Dokumente/FaLe PDF/<name>' | 'share' | null.
 */
export async function saveFile(blobOrBytes, filename, mime) {
  const name = cleanName(filename);
  const blob = toBlob(blobOrBytes, mime);
  if (!isNative()) {
    webDownload(blob, name); // synchronous: keeps the user gesture
    return { ok: true, where: 'download' };
  }
  const fs = plugin('Filesystem');
  if (fs) {
    try {
      const target = await uniqueName(fs, name);
      await writeChunked(fs, blob, `${SAVE_DIR}/${target}`, 'DOCUMENTS');
      const where = `Dokumente/${SAVE_DIR}/${target}`;
      uiToast(`Gespeichert in „${where}“`, 'success', { timeout: 5200 });
      return { ok: true, where };
    } catch (err) {
      console.warn('Speichern in Dokumente fehlgeschlagen', err);
    }
  }
  // Fallback: let the user pick a place via the share sheet.
  const r = await shareFile(blob, name, mime || blob.type, { title: name, silent: true });
  if (r.ok) return { ok: true, where: 'share' };
  if (!r.cancelled) uiToast('Die Datei konnte nicht gespeichert werden.', 'error');
  return { ok: false, where: null };
}

async function uniqueName(fs, name) {
  const [stem, ext] = splitExt(name);
  for (let i = 1; i < 100; i++) {
    const cand = i === 1 ? name : `${stem} (${i})${ext}`;
    try {
      await fs.stat({ path: `${SAVE_DIR}/${cand}`, directory: 'DOCUMENTS' });
    } catch {
      return cand; // does not exist yet
    }
  }
  return `${stem} ${Date.now()}${ext}`;
}

// ---------------------------------------------------------------- share
/**
 * Share a file. Web: Web Share API level 2 (fallback: download + hint).
 * Android: copy to the cache and open the system share sheet.
 * Resolves {ok, method: 'share'|'download'|null, cancelled}.
 */
export async function shareFile(blobOrBytes, filename, mime, { title, text, silent } = {}) {
  const blob = toBlob(blobOrBytes, mime);
  const type = mime || blob.type || 'application/octet-stream';
  const name = withExt(cleanName(filename), type); // receiving apps pick the handler by extension
  if (!isNative()) {
    const file = new File([blob], name, { type });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        const data = { files: [file], title: title || name };
        if (text) data.text = text;
        await navigator.share(data);
        return { ok: true, method: 'share', cancelled: false };
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return { ok: false, method: null, cancelled: true };
      console.warn(err);
    }
    webDownload(blob, name);
    uiToast('Teilen wird hier nicht unterstützt – die Datei wurde heruntergeladen.');
    return { ok: false, method: 'download', cancelled: false };
  }
  // Android: never navigator.share (absent in the WebView) – the file goes to cache/share/ and the
  // Share plugin hands it to the system share sheet as a FileProvider content:// URI.
  const fs = plugin('Filesystem');
  const share = plugin('Share');
  try {
    if (!fs || !share) throw new Error('Share/Filesystem fehlt');
    const res = await writeChunked(fs, blob, `share/${name}`, 'CACHE');
    let uri = res && res.uri;
    if (!uri) uri = (await fs.getUri({ path: `share/${name}`, directory: 'CACHE' })).uri;
    const opts = { title: title || name, files: [uri], dialogTitle: t('Teilen') };
    if (text) opts.text = text;
    await share.share(opts);
    return { ok: true, method: 'share', cancelled: false };
  } catch (err) {
    const msg = String((err && (err.message || err.errorMessage)) || err || '');
    // "Share canceled" = the user closed the sheet: not an error
    if (/cancel/i.test(msg)) return { ok: false, method: null, cancelled: true };
    console.warn('Teilen fehlgeschlagen', err);
    if (!silent) {
      const busy = /in progress/i.test(msg);
      uiToast(busy ? 'Das Teilen-Menü ist noch geöffnet.' : 'Teilen ist fehlgeschlagen.', 'error', {
        timeout: 7000,
        action: busy ? undefined : { label: t('Herunterladen'), onClick: () => { saveFile(blob, name, type); } },
      });
    }
    return { ok: false, method: null, cancelled: false };
  }
}

/** PDFs always leave the app with a .pdf name (receiving apps pick the handler by extension). */
function withExt(name, type) {
  const ext = String(type || '').split(';')[0].trim().toLowerCase() === 'application/pdf' ? '.pdf' : '';
  if (!ext || name.toLowerCase().endsWith(ext)) return name;
  return name.replace(/\.+$/, '') + ext;
}

/**
 * Share plain text and/or a link. Android: Capacitor Share plugin (the WebView has no navigator.share);
 * web: Web Share API. Resolves {ok, cancelled, method: 'share'|null} – callers fall back to copying.
 */
export async function shareTextOrLink({ title = '', text = '', url = '' } = {}) {
  if (isNative()) {
    const share = plugin('Share');
    if (!share) return { ok: false, cancelled: false, method: null };
    try {
      const opts = { title, dialogTitle: t('Teilen') };
      if (text) opts.text = text;
      if (url) opts.url = url;
      await share.share(opts);
      return { ok: true, cancelled: false, method: 'share' };
    } catch (err) {
      const msg = String((err && (err.message || err.errorMessage)) || err || '');
      if (/cancel/i.test(msg)) return { ok: false, cancelled: true, method: null };
      console.warn('Teilen fehlgeschlagen', err);
      return { ok: false, cancelled: false, method: null };
    }
  }
  if (navigator.share) {
    try { await navigator.share({ title, text, url: url || undefined }); return { ok: true, cancelled: false, method: 'share' }; }
    catch (err) { if (err && err.name === 'AbortError') return { ok: false, cancelled: true, method: null }; console.warn(err); }
  }
  return { ok: false, cancelled: false, method: null };
}

// ---------------------------------------------------------------- print
/** True when PDFs can be printed through the Android print framework (FalePrint plugin). */
export function canPrintNative() {
  return isNative() && !!plugin('FalePrint') && !!plugin('Filesystem');
}

/**
 * Print a PDF on Android: the WebView ignores window.print(), so the PDF goes to the system print
 * dialog (print preview, "Als PDF speichern", installed print services) via the FalePrint plugin.
 * Web: returns {ok:false, method:'web'} – the caller prints in the page (window.print).
 * Resolves {ok, method: 'native'|'share'|'web'|null}.
 */
export async function printPdf(bytes, filename) {
  if (!isNative()) return { ok: false, method: 'web' };
  let name = cleanName(filename);
  if (!/\.pdf$/i.test(name)) name += '.pdf';
  const blob = toBlob(bytes, 'application/pdf');
  const fs = plugin('Filesystem');
  const pr = plugin('FalePrint');
  try {
    if (!fs || !pr) throw new Error('FalePrint/Filesystem fehlt');
    const path = `print/${Date.now()}-${name}`;
    const res = await writeChunked(fs, blob, path, 'CACHE');
    let uri = res && res.uri;
    if (!uri) uri = (await fs.getUri({ path, directory: 'CACHE' })).uri;
    await pr.printPdf({ path: uri, name: name.replace(/\.pdf$/i, '') });
    return { ok: true, method: 'native' };
  } catch (err) {
    console.warn('Drucken über Android fehlgeschlagen', err);
    // last resort: hand the PDF to another app (e.g. a printer app, Drive, "Drucken" share target)
    const r = await shareFile(blob, name, 'application/pdf', { title: name, silent: true });
    if (r.ok) { uiToast('Drucken ist hier nicht direkt möglich – wähle eine Druck-App zum Teilen.', 'info', { timeout: 6000 }); return { ok: true, method: 'share' }; }
    if (!r.cancelled) uiToast('Drucken ist fehlgeschlagen.', 'error');
    return { ok: false, method: null };
  }
}

// ---------------------------------------------------------------- reminders / notifications
function readReminders() {
  try { return JSON.parse(localStorage.getItem(REMINDER_KEY) || '[]').filter(r => r && r.id != null); } catch { return []; }
}
function writeReminders(list) {
  const keep = Date.now() - 30 * 864e5; // forget reminders that are long past
  try { localStorage.setItem(REMINDER_KEY, JSON.stringify(list.filter(r => r.at > keep))); } catch { /* storage full/blocked */ }
}

/** Android notification ids are 32-bit ints: map any id (string/number) to one. */
export function notificationId(id) {
  if (Number.isInteger(id) && Math.abs(id) < 2147483647) return id;
  let h = 0;
  for (const ch of String(id)) h = (Math.imul(h, 31) + ch.codePointAt(0)) | 0;
  return Math.abs(h) % 2147483647 || 1;
}

const webTimers = new Map();
function armWebTimer(r) {
  clearTimeout(webTimers.get(String(r.id)));
  const ms = r.at - Date.now();
  if (ms < 0 || ms > 2147483000) return false; // setTimeout limit (~24.8 days); app shows it in-app later
  webTimers.set(String(r.id), setTimeout(() => showWebNotification(r), ms));
  return true;
}
async function showWebNotification(r) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const opts = { body: r.body || '', icon: 'icons/icon-192.png', tag: 'fale-' + r.id, data: { route: r.route } };
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration().catch(() => null);
    if (reg && reg.showNotification) { await reg.showNotification(r.title, opts); return; }
    const n = new Notification(r.title, opts);
    n.onclick = () => { window.focus(); if (r.route) location.hash = r.route; n.close(); };
  } catch (e) { console.warn(e); }
}

/**
 * Schedule a reminder. Always stored in localStorage (so the app can show due
 * reminders in-app). Returns true when a system notification was scheduled.
 */
export async function scheduleNotification({ id, at, title, body = '', route = '' } = {}) {
  if (id == null || !title) throw new Error('scheduleNotification: id und title sind nötig');
  const when = at instanceof Date ? at.getTime() : new Date(at).getTime();
  if (!Number.isFinite(when)) throw new Error('scheduleNotification: ungültiges Datum');
  const rec = { id, nid: notificationId(id), at: when, title: String(title), body: t(String(body || '')), route: String(route || '') }; // t(): English UI
  writeReminders([...readReminders().filter(r => String(r.id) !== String(id)), rec]);

  if (isNative()) {
    const ln = plugin('LocalNotifications');
    if (!ln) return false;
    try {
      let perm = await ln.checkPermissions();
      if (perm.display !== 'granted') perm = await ln.requestPermissions();
      if (perm.display !== 'granted') return false;
      await ln.schedule({ notifications: [{
        id: rec.nid, title: rec.title, body: rec.body,
        schedule: { at: new Date(when), allowWhileIdle: true },
        extra: { route: rec.route, reminderId: String(id) },
        smallIcon: 'ic_stat_fale', iconColor: '#3B37A0',
      }] });
      return true;
    } catch (e) { console.warn('Erinnerung konnte nicht geplant werden', e); return false; }
  }
  if (!('Notification' in window)) return false;
  try {
    if (Notification.permission === 'default') await Notification.requestPermission();
  } catch { /* ignore */ }
  if (Notification.permission !== 'granted') return false;
  return armWebTimer(rec);
}

export async function cancelNotification(id) {
  const list = readReminders();
  const rec = list.find(r => String(r.id) === String(id));
  writeReminders(list.filter(r => String(r.id) !== String(id)));
  clearTimeout(webTimers.get(String(id)));
  webTimers.delete(String(id));
  if (isNative()) {
    const ln = plugin('LocalNotifications');
    if (ln) { try { await ln.cancel({ notifications: [{ id: rec ? rec.nid : notificationId(id) }] }); } catch (e) { console.warn(e); } }
  }
}

/** All stored reminders (sorted by time). */
export function listReminders() {
  return readReminders().sort((a, b) => a.at - b.at);
}

/** Reminders whose time has come; removed from storage unless remove === false. */
export function dueReminders({ remove = true, now = Date.now() } = {}) {
  const list = readReminders();
  const due = list.filter(r => r.at <= now);
  if (remove && due.length) writeReminders(list.filter(r => r.at > now));
  return due.sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------- incoming files
const incomingCbs = new Set();
let incomingReady = false;
let incomingBacklog = [];

function deliverIncoming(files, info) {
  if (!files.length) return;
  if (!incomingCbs.size) { incomingBacklog.push([files, info]); return; }
  incomingCbs.forEach(cb => { try { cb(files, info); } catch (e) { console.error(e); } });
}

async function nativeItemToFile(it, fi) {
  const name = cleanName(it.name || 'Datei');
  const type = it.mimeType || '';
  let blob = null;
  if (it.data) blob = new Blob([base64ToBytes(it.data)], { type });
  if (!blob && it.path) {
    try {
      const url = window.Capacitor.convertFileSrc(it.path.startsWith('file://') ? it.path : 'file://' + it.path);
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      blob = await r.blob();
    } catch (e) {
      // Fallback over the bridge (slower, but always works)
      const r = await fi.readFile({ path: it.path });
      blob = new Blob([base64ToBytes(r.data)], { type });
    }
  }
  if (!blob) return null;
  return new File([blob], name, { type: type || blob.type, lastModified: Date.now() });
}

let drainChain = Promise.resolve();
function drainNative() {
  drainChain = drainChain.then(drainOnce, drainOnce);
  return drainChain;
}
async function drainOnce() {
  const fi = plugin('FaleIncoming');
  if (!fi) return;
  {
    const res = await fi.takePending();
    const items = (res && res.files) || [];
    const skipped = (res && res.skipped) || [];
    if (skipped.length) {
      const big = skipped.filter(x => x.reason === 'too-large');
      const msg = skipped.length === 1
        ? (big.length ? `„${skipped[0].name}“ ist zu groß (max. 100 MB).` : `„${skipped[0].name}“ konnte nicht gelesen werden.`)
        : `${skipped.length} Dateien konnten nicht übernommen werden${big.length ? ' (max. 100 MB pro Datei)' : ''}.`;
      uiToast(msg, 'error', { timeout: 6000 });
    }
    const files = [];
    for (const it of items) {
      try { const f = await nativeItemToFile(it, fi); if (f) files.push(f); } catch (e) { console.warn('Eingehende Datei nicht lesbar', e); }
    }
    if (items.length) fi.release({ paths: items.map(i => i.path).filter(Boolean) }).catch(() => {});
    if (items.length && !files.length) uiToast('Die Datei konnte nicht geöffnet werden.', 'error');
    const source = (res && res.action === 'VIEW') ? 'Geöffnet' : 'Geteilt';
    deliverIncoming(files, { source });
  }
}

function setupIncomingWeb() {
  if (!('launchQueue' in window)) return;
  window.launchQueue.setConsumer(async params => {
    if (!params.files || !params.files.length) return;
    try {
      const files = await Promise.all(params.files.map(fh => fh.getFile()));
      deliverIncoming(files, { source: 'Geöffnet' });
    } catch (e) {
      console.warn(e);
      uiToast('Die Datei konnte nicht geöffnet werden.', 'error');
    }
  });
}

async function setupIncomingNative() {
  const fi = plugin('FaleIncoming');
  if (!fi) return;
  try {
    await addListener(fi, 'filesReady', () => drainNative().catch(e => console.warn(e)));
    await drainNative();
  } catch (e) { console.warn('FaleIncoming nicht verfügbar', e); }
}

/**
 * Register a handler for files opened with / shared to the app.
 * cb(files: File[], {source: 'Geöffnet'|'Geteilt'}). Returns an unsubscribe function.
 * (The web share-target inbox written by sw.js is still read by app.js → checkInbox.)
 */
export function onIncomingFiles(cb) {
  incomingCbs.add(cb);
  if (incomingBacklog.length) {
    const queued = incomingBacklog;
    incomingBacklog = [];
    queued.forEach(([files, info]) => deliverIncoming(files, info));
  }
  if (!incomingReady) {
    incomingReady = true;
    if (isNative()) setupIncomingNative(); else setupIncomingWeb();
  }
  return () => incomingCbs.delete(cb);
}

// ---------------------------------------------------------------- haptics
const IMPACT = { light: 'LIGHT', medium: 'MEDIUM', heavy: 'HEAVY', selection: 'LIGHT' };
const NOTIFY = { success: 'SUCCESS', warning: 'WARNING', error: 'ERROR' };
const VIBRATE = { light: 10, selection: 8, medium: 20, heavy: 35, success: [12, 60, 12], warning: [25, 80, 25], error: [40, 60, 40, 60, 40] };

export function haptic(kind = 'light') {
  try {
    if (isNative()) {
      const hp = plugin('Haptics');
      if (!hp) return;
      const p = NOTIFY[kind] ? hp.notification({ type: NOTIFY[kind] }) : hp.impact({ style: IMPACT[kind] || 'LIGHT' });
      if (p && p.catch) p.catch(() => {});
      return;
    }
    if (navigator.vibrate && window.matchMedia && window.matchMedia('(pointer: coarse)').matches) navigator.vibrate(VIBRATE[kind] || 10);
  } catch { /* never throws */ }
}

// ---------------------------------------------------------------- status bar / theme
function cssBg() {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  } catch { /* ignore */ }
  return null;
}

let lastBars = '';
/** Status/navigation bar colours on Android (icons dark on light bars and vice versa). */
export async function setStatusBarTheme(dark) {
  if (!isNative()) return;
  const color = (!!dark === effectiveDark() && cssBg()) || (dark ? '#171542' : '#F5F6FB');
  const key = `${!!dark}${color}`;
  if (key === lastBars) return;
  lastBars = key;
  const fi = plugin('FaleIncoming');
  try { if (fi) await fi.setBarColors({ color, dark: !!dark }); } catch (e) { console.warn(e); }
}

function effectiveDark() {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
}

// ---------------------------------------------------------------- legal pages
/** Open a static page (datenschutz.html, impressum.html). Native: in-app dialog (keeps the app state). */
export async function openLegalPage(path = 'datenschutz.html') {
  if (!isNative()) { window.open(path, '_blank', 'noopener'); return; }
  try {
    const html = await (await fetch(path)).text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const en = document.documentElement.lang === 'en'; // legal pages carry an English <main data-lang="en">
    const main = (en && doc.querySelector('main[data-lang="en"]')) || doc.querySelector('main') || doc.body;
    main.querySelectorAll('script, [data-web-only]').forEach(n => n.remove());
    const ui = await import('./ui.js');
    await ui.openDialog({ title: (en && main.dataset.title) || doc.title.replace(/\s*[–-]\s*FaLe PDF\s*$/, '') || 'Rechtliches', body: `<div class="legal-page">${main.innerHTML}</div>`, wide: true, actions: [{ label: 'Schließen', value: 'ok', kind: 'btn-primary', default: true }] });
  } catch (e) { console.warn(e); }
}

// ---------------------------------------------------------------- back button
/**
 * Android back button: closes dialogs/menus first, then navigates back in the app,
 * and closes the app on the start screen. Other modules can intercept by calling
 * preventDefault() on the cancelable window event 'fale:back'.
 */
export function handleBackButton({ canGoBack } = {}) {
  const ev = new CustomEvent('fale:back', { cancelable: true });
  if (!window.dispatchEvent(ev)) return 'custom';
  const dialogs = Array.from(document.querySelectorAll('dialog[open]'));
  if (dialogs.length) {
    const dlg = dialogs[dialogs.length - 1];
    const cancel = new Event('cancel', { cancelable: true });
    if (dlg.dispatchEvent(cancel)) dlg.close();
    return 'dialog';
  }
  const menus = document.querySelectorAll('.menu-layer');
  if (menus.length) { menus.forEach(m => m.remove()); return 'menu'; }
  const hash = location.hash.replace(/^#\/?/, '').split('?')[0];
  if (!hash || hash === 'start') {
    const app = plugin('App');
    if (app) app.exitApp();
    return 'exit';
  }
  if (canGoBack !== false && history.length > 1) history.back();
  else location.replace('#/start');
  return 'back';
}

// ---------------------------------------------------------------- native init
let nativeInitDone = false;
function initNative() {
  if (nativeInitDone || !isNative()) return;
  nativeInitDone = true;
  document.documentElement.classList.add('is-native', 'is-' + platformName());

  const app = plugin('App');
  if (app) addListener(app, 'backButton', e => handleBackButton(e || {})).catch(e => console.warn(e));

  const ln = plugin('LocalNotifications');
  if (ln) {
    addListener(ln, 'localNotificationActionPerformed', e => {
      const n = (e && e.notification) || {};
      const extra = n.extra || {};
      if (extra.reminderId != null) {
        writeReminders(readReminders().filter(r => String(r.id) !== String(extra.reminderId)));
      }
      if (extra.route) location.hash = extra.route;
    }).catch(e => console.warn(e));
  }

  // keep status/navigation bar colours in sync with the app theme
  const sync = () => setStatusBarTheme(effectiveDark());
  const start = () => { sync(); setTimeout(sync, 300); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  try {
    new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', sync);
  } catch { /* old WebView */ }
}

// re-arm web reminder timers for this session
function initWeb() {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    readReminders().forEach(r => { if (r.at > Date.now()) armWebTimer(r); });
  } catch { /* ignore */ }
}

if (typeof window !== 'undefined') {
  if (isNative()) initNative(); else initWeb();
}
