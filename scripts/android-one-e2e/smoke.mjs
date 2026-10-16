#!/usr/bin/env node
// FaLe One Android app – smoke test on an emulator (debug APK installed, test photos in DCIM, see run.sh).
// Drives the app's WebView over the Chrome DevTools Protocol (adb forward → webview_devtools_remote_<pid>)
// and adb. Results: ::notice / ::error annotations (readable via the Checks API), screenshots in e2e-out/.
//
// Checks: start screen renders without JS errors, native platform, no service worker, FaleMedia/FaleSystem
// registered, media permission flow (prompt → pm grant → granted), MediaStore listing + paging + count,
// reading an original through Capacitor's local server with EXIF GPS intact, the backup card renders,
// back button (dialog, history, background instead of closing).
// Background backup (FaleBackup, WorkManager) against a mock API on the runner (mock-api.mjs, reached through the
// debug-only override at http://10.0.2.2:<port>): Java ↔ JS crypto cross-test on the device, keys handed over and
// sealed (not readable in the app's files), jobs scheduled with the switch on, a run while the app is in the
// background whose uploads decrypt with the web worker's JS code to the original bytes and metadata
// (verify-backup.mjs), one session refresher (no refresh-token reuse), no double upload (checkpoint + dedupe),
// signed out elsewhere → keys wiped + notification, switch off → jobs cancelled + keys wiped.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { startMock, SUPABASE_KEY } from './mock-api.mjs';
import { makeVectors, checkJava } from './crossvec.mjs';
import { verifyBackup, jpegSize } from './verify-backup.mjs';
import * as K from '../../one/js/shared/one/crypto.js';
import { parseExif, exifToMeta } from '../../one/js/media.js';

const PKG = 'dev.fale.one';
const OUT = process.env.E2E_OUT || 'e2e-out';
const PORT = 9223;
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = readdirSync(join(HERE, 'fixtures')).filter(f => f.endsWith('.jpg')).sort();
mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const esc = s => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
function report(name, ok, info = '') {
  results.push({ name, ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' – ' + info : ''}`);
  console.log(`::${ok ? 'notice' : 'error'} title=One-Smoke ${name}::${esc((ok ? 'OK' : 'FEHLER') + (info ? ': ' + info : ''))}`);
}

// ------------------------------------------------------------------ adb
function adb(args, { timeout = 30000, allowFail = false, encoding = 'utf8' } = {}) {
  try {
    return execFileSync('adb', args, { timeout, encoding, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    if (allowFail) return encoding ? String(e.stdout || '') + String(e.stderr || '') : Buffer.alloc(0);
    throw new Error(`adb ${args.join(' ')}: ${e.message}`);
  }
}
const sh = (cmd, o) => adb(['shell', cmd], o);
let shotN = 0;
function screenshot(name) {
  try {
    const png = adb(['exec-out', 'screencap', '-p'], { encoding: null, allowFail: true });
    if (png && png.length) writeFileSync(join(OUT, `${String(++shotN).padStart(2, '0')}-${name}.png`), png);
  } catch { /* ignore */ }
}
async function waitFor(fn, { timeout = 15000, interval = 400 } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    await sleep(interval);
  }
  return null;
}
const appPid = () => sh(`pidof ${PKG}`, { allowFail: true }).trim().split(/\s+/)[0] || '';
const appOnTop = () => new RegExp(`topResumedActivity=[^\\n]*${PKG.replace(/\./g, '\\.')}/`).test(sh('dumpsys activity activities', { allowFail: true }));
const sdk = parseInt(sh('getprop ro.build.version.sdk').trim(), 10);
const focusedWindow = () => (sh('dumpsys window', { allowFail: true }).match(/mCurrentFocus=[^\n]*/) || [''])[0];
const appFocused = () => { const f = focusedWindow(); return /mCurrentFocus=null/.test(f) ? appOnTop() : f.includes(PKG + '/'); };
/** Key events go to the focused window: on the API 34 image the launcher can keep the focus although the app is
 *  resumed (same workaround as scripts/android-e2e/e2e.mjs). Brings the app to the front with the focus. */
async function ensureFocus() {
  for (let i = 0; i < 3 && !(appOnTop() && appFocused()); i++) {
    if (appOnTop() && !appFocused()) { // resumed but the launcher window holds the focus: a tap on the app's margin moves it
      const [w, h] = ((sh('wm size', { allowFail: true }).match(/(\d+)x(\d+)/) || []).slice(1).map(Number));
      if (w && h) { sh(`input tap 6 ${Math.round(h * 0.45)}`, { allowFail: true }); await sleep(1200); if (appFocused()) break; }
    }
    if (i === 2) { sh('input keyevent 3', { allowFail: true }); await sleep(1500); }
    sh(`am start -n ${PKG}/.MainActivity`, { allowFail: true });
    await waitFor(() => appOnTop() && appFocused(), { timeout: 10000, interval: 700 });
    await sleep(800);
  }
  if (!(appOnTop() && appFocused())) {
    const act = sh('dumpsys activity activities', { allowFail: true }).split('\n').filter(l => /ResumedActivity|mFocusedApp|Hist #0/.test(l)).slice(0, 6).map(l => l.trim()).join(' / ');
    const start = sh(`am start -W -n ${PKG}/.MainActivity`, { allowFail: true }).replace(/\s+/g, ' ').slice(0, 300);
    const crash = adb(['logcat', '-d', '-v', 'brief', 'AndroidRuntime:E', 'ActivityTaskManager:W', 'WindowManager:W', '*:S'], { allowFail: true }).split('\n').filter(l => l.trim()).slice(-6).join(' / ').slice(0, 900);
    throw new Error(`App hat keinen Fokus: ${focusedWindow()} | ${act} | am start: ${start} | ${crash}`);
  }
  if (cdp.closed || cdp.pid !== appPid()) await connect();
}

/** The app in front with a live CDP connection (no key focus needed: everything goes through the WebView). */
async function ensureFront() {
  if (!appOnTop()) {
    sh(`am start -n ${PKG}/.MainActivity`, { allowFail: true });
    if (!await waitFor(() => appOnTop(), { timeout: 15000, interval: 700 })) throw new Error('App kommt nicht nach vorne: ' + focusedWindow());
    await sleep(800);
  }
  if (cdp.closed || cdp.pid !== appPid()) await connect();
}

// ------------------------------------------------------------------ CDP
class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.handlers = []; }
  open() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const t = setTimeout(() => reject(new Error('CDP connect timeout')), 15000);
      ws.onopen = () => { clearTimeout(t); resolve(); };
      ws.onerror = e => { clearTimeout(t); reject(new Error('CDP error ' + (e.message || ''))); };
      ws.onclose = () => { for (const [, p] of this.pending) p.reject(new Error('CDP closed')); this.pending.clear(); this.closed = true; };
      ws.onmessage = ev => {
        const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString());
        if (msg.id && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
        } else if (msg.method) this.handlers.forEach(h => h(msg));
      };
    });
  }
  send(method, params = {}, timeout = 60000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeout);
      this.pending.set(id, { resolve: v => { clearTimeout(t); resolve(v); }, reject: e => { clearTimeout(t); reject(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}
let cdp = null;
const consoleLog = [];
async function connect() {
  const pid = await waitFor(() => appPid(), { timeout: 30000 });
  if (!pid) throw new Error('App-Prozess nicht gefunden');
  adb(['forward', '--remove-all'], { allowFail: true });
  adb(['forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`]);
  const target = await waitFor(async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    return (await r.json()).find(t => t.type === 'page' && /^https:\/\/localhost/.test(t.url));
  }, { timeout: 30000, interval: 800 });
  if (!target) throw new Error('WebView-Debug-Ziel nicht gefunden (WebView-Debugging aus?)');
  cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.open();
  cdp.pid = pid;
  cdp.handlers.push(msg => {
    if (msg.method === 'Runtime.consoleAPICalled') {
      const fmt = a => {
        if (a.value !== undefined) return typeof a.value === 'string' ? a.value : JSON.stringify(a.value);
        if (a.preview && a.preview.properties) return (a.description || '') + JSON.stringify(Object.fromEntries(a.preview.properties.map(p => [p.name, p.value])));
        return a.description || a.type;
      };
      const text = msg.params.args.map(fmt).join(' ');
      consoleLog.push(`[${msg.params.type}] ${text}`);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      consoleLog.push(`[exception] ${(d.exception && d.exception.description) || d.text}`);
    } else if (msg.method === 'Log.entryAdded') {
      consoleLog.push(`[log:${msg.params.entry.level}:${msg.params.entry.source}] ${msg.params.entry.text} ${msg.params.entry.url || ''}`);
    }
  });
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable').catch(() => {});
  return target;
}
async function ev(expression, { timeout = 60000 } = {}) {
  const r = await cdp.send('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true }, timeout);
  if (r.exceptionDetails) throw new Error('JS: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  return r.result.value;
}
const waitJs = (expr, opts) => waitFor(() => ev(`return (${expr});`), opts);
// Capacitor's SystemBars injects its safe-area CSS during a reload before <html> exists – its own noise, not ours
const NOISE = /Error injecting safe area CSS/;
const jsErrors = (from = 0) => consoleLog.slice(from).filter(l => /^\[(exception|error|assert)\]|^\[log:error:(javascript|other)\]/.test(l) && !NOISE.test(l));
const logcatOne = () => adb(['logcat', '-d', '-v', 'brief', 'FaleOne:V', 'FaleMedia:V', 'Capacitor/Console:V', 'AndroidRuntime:E', '*:S'], { allowFail: true }).split('\n').filter(l => l.trim()).slice(-12).join(' | ').slice(0, 1500);
/** Real click (CDP input events carry user activation, like a finger tap) on the centre of an element. */
async function click(selector) {
  const r = await ev(`const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 };`);
  if (!r) throw new Error('Element fehlt: ' + selector);
  for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
}

async function step(name, fn) {
  try {
    const info = await fn();
    report(name, true, info || '');
  } catch (e) {
    report(name, false, `${e.message}${jsErrors().length ? ' | Konsole: ' + jsErrors().slice(-4).join(' | ').slice(0, 900) : ''}`);
  }
  screenshot(name.replace(/[^\w]+/g, '-').toLowerCase());
}
const M = (method, opts) => `const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.FaleMedia; if (!P) throw new Error('FaleMedia fehlt'); return await P.${method}(${JSON.stringify(opts || {})});`;
const B = (method, opts) => `const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.FaleBackup; if (!P) throw new Error('FaleBackup fehlt'); return await P.${method}(${JSON.stringify(opts || {})});`;
const bgState = () => ev(B('state'));
const debugBroadcast = (action, extra = '') => sh(`am broadcast -n ${PKG}/.FaleDebugReceiver -a ${PKG}.debug.${action} ${extra}`, { allowFail: true });
const logcatBg = () => adb(['logcat', '-d', '-v', 'brief', 'FaleBackup:V', 'FaleDebug:V', 'WM-WorkerWrapper:V', 'AndroidRuntime:E', '*:S'], { allowFail: true }).split('\n').filter(l => l.trim()).slice(-25).join(' | ').slice(0, 2500);
/** WorkManager's jobs of this app in JobScheduler: [{ id, ns, text }]. Android 14+ prints a namespace
 *  ("JOB #u0a190/<namespace>:<id>: …") when WorkManager uses one; `cmd jobscheduler run` then needs -n. */
let jobsRaw = '';
function ourJobs() {
  const jobs = new Map();
  for (const args of [`dumpsys jobscheduler ${PKG}`, 'dumpsys jobscheduler']) {
    const out = sh(args, { allowFail: true, timeout: 60000 });
    // "JOB #u0a190/1: 5b1d3e7 dev.fale.one/…SystemJobService" or (namespace, Android 14+)
    // "JOB androidx.work.systemjobscheduler:u0a192/0: 8a6d2b @androidx.work.systemjobscheduler@dev.fale.one/…SystemJobService"
    for (const block of out.split(/\n(?=\s*JOB )/)) {
      const m = /JOB #?(?:([^\s:/#]+):)?[^\s/]+\/(-?\d+): \S+ (\S+)/.exec(block);
      if (!m || !(m[3].startsWith(PKG + '/') || m[3].includes('@' + PKG + '/'))) continue;
      const key = (m[1] || '') + ':' + m[2];
      if (!jobs.has(key)) jobs.set(key, { id: m[2], ns: m[1] || null, text: block.slice(0, 4000) });
    }
    if (jobs.size) break;
    jobsRaw = out.split('\n').filter(l => l.includes(PKG)).slice(0, 8).join(' / ').slice(0, 1200);
  }
  return [...jobs.values()];
}
const runJob = j => sh(`cmd jobscheduler run -f ${j.ns ? `-n ${j.ns} ` : ''}${PKG} ${j.id}`, { allowFail: true });
const runAs = cmd => sh(`run-as ${PKG} sh -c '${cmd}'`, { allowFail: true });
const secretFile = () => /fale-one-bg-secret\.bin/.test(runAs('ls no_backup 2>/dev/null'));

// ------------------------------------------------------------------ main
async function main() {
  const env = `Android ${sh('getprop ro.build.version.release').trim()} (API ${sdk}), WebView ${(sh('dumpsys webviewupdate', { allowFail: true }).match(/Current WebView package \(name, version\): \(([^)]*)\)/) || [])[1] || '?'}`;
  console.log(`::notice title=One-Smoke Gerät::${esc(env)}`);
  sh(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`, { allowFail: true });
  await sleep(4000);
  await connect();
  // German UI (source language), then a clean reload with the console attached from the first line on
  await ev(`localStorage.setItem('fale-one-lang', 'de'); return true;`);
  const mark = consoleLog.length;
  await cdp.send('Page.enable').catch(() => {});
  await cdp.send('Page.reload', { ignoreCache: true }).catch(() => {});
  await sleep(1500);
  if (cdp.closed) await connect();

  await step('Startbildschirm ohne JS-Fehler', async () => {
    const ok = await waitJs(`!!document.querySelector('.gate .gate-card') && !document.getElementById('splash')`, { timeout: 30000 });
    await sleep(2500); // late errors (config request, fonts)
    const title = await ev(`const h = document.querySelector('.gate-title'); return h ? h.textContent : (document.querySelector('.gate-card') || document.body).innerText.slice(0, 120);`).catch(() => '');
    if (!ok) throw new Error('Anmeldebildschirm erscheint nicht: ' + (await ev('return document.body.innerText.slice(0, 200);').catch(() => '?')));
    const errs = jsErrors(mark);
    const net = consoleLog.slice(mark).filter(l => /^\[log:error:network\]/.test(l));
    if (net.length) console.log(`::warning title=One-Smoke Netzwerk::${esc(net.slice(0, 5).join('\n'))}`);
    if (errs.length) throw new Error('JS-Fehler: ' + errs.slice(0, 5).join(' | ').slice(0, 1200));
    const nativeUi = await ev(`return document.querySelectorAll('[data-autobackup]').length;`);
    if (nativeUi) throw new Error('Sicherungskarte auf dem Anmeldebildschirm');
    return `„${title.trim().slice(0, 80)}“`;
  });

  await step('Native Plattform, Plugins, kein Service Worker', async () => {
    const r = await ev(`const c = window.Capacitor;
      const regs = navigator.serviceWorker ? await navigator.serviceWorker.getRegistrations() : [];
      return { native: !!(c && c.isNativePlatform && c.isNativePlatform()), platform: c && c.getPlatform && c.getPlatform(),
        media: !!(c && c.isPluginAvailable && c.isPluginAvailable('FaleMedia')), system: !!(c && c.isPluginAvailable && c.isPluginAvailable('FaleSystem')),
        methods: Object.keys((c && c.Plugins && c.Plugins.FaleMedia) || {}).sort().join(','), sw: regs.length, origin: location.origin };`);
    if (!r.native) throw new Error('isNativePlatform() ist nicht true: ' + JSON.stringify(r));
    if (!r.media || !r.system) throw new Error('Plugin fehlt: ' + JSON.stringify(r));
    if (r.sw) throw new Error(`${r.sw} Service Worker registriert`);
    if (r.origin !== 'https://localhost') throw new Error('Origin ' + r.origin);
    return `${r.platform}, FaleMedia [${r.methods}], ${r.origin}, kein Service Worker`;
  });

  await step('FaleSystem: Netz + Leistenfarben', async () => {
    const r = await ev(`const S = window.Capacitor.Plugins.FaleSystem; const n = await S.network(); await S.setBarColors({ color: '#F2F3F9', dark: false }); return n;`);
    if (!r || r.known !== true) throw new Error('network(): ' + JSON.stringify(r));
    return JSON.stringify(r);
  });

  await step('Berechtigung vor der Freigabe', async () => {
    const p = await ev(M('checkPermissions'));
    if (!p || !['prompt', 'denied'].includes(p.media)) throw new Error('erwartet prompt/denied: ' + JSON.stringify(p));
    const rej = await ev(`try { ${M('list', { limit: 5 }).replace('return await', 'await')} return 'resolved'; } catch (e) { return 'rejected:' + (e.code || e.message); }`);
    if (!/^rejected:PERMISSION/.test(rej)) throw new Error('list() ohne Berechtigung: ' + rej);
    return `${JSON.stringify(p)}, list() → ${rej}`;
  });

  await step('Berechtigung erteilen (pm grant) + requestPermissions', async () => {
    const perms = sdk >= 33 ? ['READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO'] : ['READ_EXTERNAL_STORAGE'];
    if (sdk >= 34) perms.push('READ_MEDIA_VISUAL_USER_SELECTED');
    if (sdk >= 29) perms.push('ACCESS_MEDIA_LOCATION');
    for (const p of perms) sh(`pm grant ${PKG} android.permission.${p}`, { allowFail: true });
    const p = await ev(M('checkPermissions'));
    if (!p || p.media !== 'granted' || p.location !== 'granted') throw new Error('nach pm grant: ' + JSON.stringify(p));
    // all granted → the permission callback answers without a system dialog
    const r = await ev(M('requestPermissions'), { timeout: 20000 }).catch(e => ({ error: e.message }));
    if (!r || r.media !== 'granted') { screenshot('request-permissions'); sh('input keyevent 4', { allowFail: true }); throw new Error('requestPermissions(): ' + JSON.stringify(r)); }
    return JSON.stringify(r);
  });

  let items = [];
  await step('MediaStore-Liste, Seiten, Anzahl', async () => {
    const r = await waitFor(async () => {
      const x = await ev(M('list', { kind: 'image', since: 0, afterId: 0, limit: 200 }));
      return FIXTURES.every(f => x.items.some(i => i.name === f)) && x;
    }, { timeout: 30000, interval: 2000 });
    if (!r) {
      const x = await ev(M('list', { kind: 'image', limit: 200 })).catch(e => ({ error: e.message }));
      const q = sh(`content query --uri content://media/external/images/media --projection _id:_display_name:relative_path:is_pending:date_added`, { allowFail: true }).replace(/\s+/g, ' ').slice(0, 600);
      const ls = sh('ls -la /sdcard/DCIM/Camera/', { allowFail: true }).replace(/\s+/g, ' ').slice(0, 300);
      throw new Error('Testfotos nicht gefunden: ' + JSON.stringify(x).slice(0, 400) + ' | MediaStore: ' + q + ' | DCIM: ' + ls);
    }
    items = r.items.filter(i => FIXTURES.includes(i.name));
    for (const it of items) {
      if (!/^content:\/\/media\//.test(it.uri) || it.mime !== 'image/jpeg' || !(it.size > 0) || !(it.taken > 0) || !(it.added > 0) || it.video) throw new Error('Eintrag unvollständig: ' + JSON.stringify(it));
      if (sdk >= 29 && !/requireOriginal=1/.test(it.uri)) throw new Error('keine Original-URI (Ortsdaten): ' + it.uri);
    }
    const all = r.items;
    for (let i = 1; i < all.length; i++) if (all[i].added < all[i - 1].added || (all[i].added === all[i - 1].added && all[i].id <= all[i - 1].id)) throw new Error('Reihenfolge falsch');
    // paging from a checkpoint (date_added, _id)
    const first = await ev(M('list', { kind: 'image', limit: 1 }));
    if (first.items.length !== 1 || (all.length > 1 && !first.hasMore)) throw new Error('limit/hasMore: ' + JSON.stringify(first).slice(0, 300));
    const next = await ev(M('list', { kind: 'image', since: first.items[0].added, afterId: first.items[0].id, limit: 1 }));
    if (all.length > 1 && (next.items.length !== 1 || next.items[0].id !== all[1].id)) throw new Error('Seite 2 falsch: ' + JSON.stringify(next).slice(0, 300));
    const c0 = await ev(M('count', { kind: 'image' }));
    const c1 = await ev(M('count', { kind: 'image', since: first.items[0].added, afterId: first.items[0].id }));
    if (c0.count !== all.length || c1.count !== all.length - 1) throw new Error(`count: ${c0.count}/${c1.count}, Liste ${all.length}`);
    const vids = await ev(M('list', { kind: 'video', limit: 5 }));
    return `${all.length} Fotos (Testfotos: ${items.map(i => `${i.name} ${i.size} B`).join(', ')}), Seite 2 ok, count ${c0.count}/${c1.count}, Videos ${vids.items.length}`;
  });

  await step('Original lesen (convertFileSrc) – Ortsdaten erhalten', async () => {
    if (!items.length) throw new Error('keine Testfotos');
    const out = [];
    for (const it of items) {
      const local = readFileSync(join(HERE, 'fixtures', it.name));
      const want = createHash('sha256').update(local).digest('hex');
      const r = await ev(`const m = await import('/js/native.js'); const f = await m.toFile(${JSON.stringify(it)});
        if (!f) return null; const h = await crypto.subtle.digest('SHA-256', await f.arrayBuffer());
        return { size: f.size, type: f.type, name: f.name, lm: f.lastModified, sha: Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('') };`);
      if (!r) throw new Error(`${it.name}: nicht lesbar`);
      if (r.size !== local.length) throw new Error(`${it.name}: ${r.size} B statt ${local.length} B`);
      if (r.sha !== want) throw new Error(`${it.name}: Inhalt weicht ab (Ortsdaten entfernt?)`);
      if (r.type !== 'image/jpeg' || r.lm !== it.taken) throw new Error(`${it.name}: File-Metadaten ${JSON.stringify(r)}`);
      out.push(`${it.name} identisch`);
    }
    return out.join(', ');
  });

  await step('Sicherungskarte rendert', async () => {
    const r = await ev(`const m = await import('/js/native.js'); const n = m.backupCard(); n.id = 'e2e-card'; document.body.append(n);
      await new Promise(r => setTimeout(r, 300));
      const sw = n.querySelector('input[role=switch]');
      const res = { text: n.innerText.replace(/\\s+/g, ' ').trim(), switch: !!sw, checked: sw && sw.checked };
      n.remove(); return res;`);
    if (!r.switch || !/Automatische Sicherung/.test(r.text) || r.checked) throw new Error(JSON.stringify(r));
    return r.text.slice(0, 160);
  });

  await step('Zurück-Taste: Dialog, Verlauf, Hintergrund', async () => {
    await ensureFocus();
    adb(['logcat', '-c'], { allowFail: true });
    await ev(`const d = await import('/js/dom.js'); window.__dlg = null; d.openDialog({ title: 'E2E', body: d.el('p', 'Test'), actions: [{ label: 'OK', value: 'ok', default: true }] }).then(r => { window.__dlg = r.value; }); return true;`);
    await sleep(500);
    sh('input keyevent 4');
    if (!await waitJs(`window.__dlg === 'cancel' && !document.querySelector('dialog[open]')`, { timeout: 8000 })) throw new Error('Dialog schließt nicht mit Zurück | logcat: ' + logcatOne());
    if (!appOnTop()) throw new Error('App nach Dialog-Zurück nicht mehr vorne');
    // navigation by taps (script-only history entries are skipped by the back button in current WebViews)
    await ev(`for (const h of ['e2e-a', 'e2e-b']) { const a = document.createElement('a'); a.href = '#' + h; a.id = 'lnk-' + h; a.textContent = h; a.style.cssText = 'position:fixed;left:20px;top:' + (h === 'e2e-a' ? 120 : 200) + 'px;z-index:99;padding:20px;background:#ff0'; document.body.append(a); } return true;`);
    await click('#lnk-e2e-a');
    await waitJs(`location.hash === '#e2e-a'`, { timeout: 5000 });
    await click('#lnk-e2e-b');
    if (!await waitJs(`location.hash === '#e2e-b'`, { timeout: 5000 })) throw new Error('Link-Klick navigiert nicht: ' + await ev('return location.hash;'));
    await sleep(400);
    sh('input keyevent 4');
    if (!await waitJs(`location.hash === '#e2e-a'`, { timeout: 8000 })) throw new Error('Zurück navigiert nicht im Verlauf: ' + await ev('return location.hash + " history " + history.length;') + ' | logcat: ' + logcatOne());
    if (!appOnTop()) throw new Error('App nach Verlauf-Zurück nicht mehr vorne');
    const pid = appPid();
    let left = false;
    for (let i = 0; i < 4 && !left; i++) { sh('input keyevent 4'); await sleep(1200); left = !appOnTop(); }
    if (!left) throw new Error('App bleibt vorne (Startseite) | logcat: ' + logcatOne());
    const still = appPid();
    screenshot('nach-zurueck');
    sh(`am start -n ${PKG}/.MainActivity`, { allowFail: true });
    await waitFor(() => appOnTop(), { timeout: 10000 });
    return `Dialog zu, #e2e-b → #e2e-a, Startseite → Hintergrund (Prozess ${still === pid ? 'läuft weiter' : 'neu: ' + still})`;
  });

  await backgroundBackup(items);

  writeFileSync(join(OUT, 'console.txt'), consoleLog.join('\n'));
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  const exc = [...new Set(jsErrors().map(l => l.split('\n')[0].slice(0, 220)))];
  if (exc.length) console.log(`::warning title=One-Smoke Konsole (${exc.length})::${esc(exc.slice(0, 12).join('\n'))}`);
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} bestanden`);
  console.log(`::${failed.length ? 'error' : 'notice'} title=One-Smoke Zusammenfassung (API ${sdk})::${esc(failed.length ? failed.map(f => f.name).join(', ') + ' fehlgeschlagen' : `${results.length}/${results.length} bestanden`)}`);
  process.exit(failed.length ? 1 : 0);
}

// ------------------------------------------------------------------ background backup (FaleBackup + WorkManager)
async function backgroundBackup(items) {
  const MOCK_PORT = 8787;
  let mock;
  try { mock = await startMock({ port: MOCK_PORT, chunkSize: 65536 }); }
  catch (e) { report('Mock-API starten', false, e.message); return; }
  const user = { id: K.uuid(), email: 'e2e@example.invalid' };
  const mkRaw = K.rnd(32);
  const deviceId = 'E2E_' + K.b64u(K.rnd(12)), deviceName = 'E2E Pixel';
  let sess = null, armed = false, payloadKeys = null;
  const fixtures = FIXTURES.map(name => {
    const bytes = new Uint8Array(readFileSync(join(HERE, 'fixtures', name)));
    const raw = jpegSize(bytes), o = exifToMeta(parseExif(bytes)).orientation || 1;
    const swap = o >= 5 && o <= 8;
    const it = items.find(i => i.name === name);
    return { name, bytes, taken: it ? it.taken : 0, w: swap ? raw.h : raw.w, h: swap ? raw.w : raw.h };
  });
  const armJs = (session) => ev(`const m = await import('/js/native.js');
    const mk = await crypto.subtle.importKey('raw', Uint8Array.from(atob(${JSON.stringify(Buffer.from(mkRaw).toString('base64'))}), c => c.charCodeAt(0)), 'HKDF', false, ['deriveKey', 'deriveBits']);
    const p = await m.armPayload({ userId: ${JSON.stringify(user.id)}, mk, deviceId: ${JSON.stringify(deviceId)}, deviceName: ${JSON.stringify(deviceName)},
      session: { refresh: ${JSON.stringify(session.refresh)}, user: ${JSON.stringify(user)}, access: ${JSON.stringify(session.access)}, exp: ${session.exp} },
      account: { supabaseUrl: 'https://e2e-auth.invalid', supabaseKey: ${JSON.stringify(SUPABASE_KEY)} }, folderName: 'Fotos', lang: 'de' });
    const P = window.Capacitor.Plugins.FaleBackup;
    await P.setPrefs({ userId: p.userId, on: true, wifiOnly: true, videos: false, lang: 'de' });
    await P.arm(p);
    return { kek: p.kek, dk: p.dk, dvk: p.dvk, apiBase: p.apiBase };`);

  await step('Krypto-Kreuztest im Emulator (Java ↔ JS)', async () => {
    await ensureFront();
    const vec = await makeVectors();
    const out = await ev(`const P = window.Capacitor.Plugins.FaleDebug; if (!P) throw new Error('FaleDebug fehlt (Debug-Build?)'); return await P.cryptoSelfTest({ vectors: ${JSON.stringify(vec)} });`, { timeout: 120000 });
    const problems = await checkJava(vec, out);
    if (problems.length) throw new Error(problems.join(' | ').slice(0, 1500));
    return `${Object.keys(out).filter(k => k.startsWith('check.')).length} Java-Prüfungen auf dem Gerät, JS öffnet alle Java-Daten`;
  });

  await step('Hintergrund-Sicherung einrichten: Schlüssel versiegelt, Zeitplan aktiv', async () => {
    debugBroadcast('API', `--es api http://10.0.2.2:${MOCK_PORT}`);
    await sleep(800);
    const logApi = adb(['logcat', '-d', '-v', 'brief', 'FaleDebug:V', '*:S'], { allowFail: true });
    if (!/api override = http:\/\/10\.0\.2\.2/.test(logApi)) throw new Error('Debug-Override nicht gesetzt: ' + logApi.slice(-400));
    // nothing new yet: the checkpoint is put behind the test photos, so the first (immediate) periodic run uploads nothing
    const last = items.reduce((a, b) => (b.added > a.added || (b.added === a.added && b.id > a.id) ? b : a), items[0]);
    await ev(B('setCheckpoint', { userId: user.id, kind: 'image', since: last.added, afterId: last.id }));
    sess = mock.session(user, { accessExpired: true }); // expired access token: the background run must refresh first
    payloadKeys = await armJs(sess);
    armed = true;
    // what the app hands over = the worker's account keys (K.deriveKeys) – checked byte for byte
    const want = await crossKeys(mkRaw, user.id);
    if (payloadKeys.kek !== want.kek || payloadKeys.dk !== want.dk || payloadKeys.dvk !== want.dvk) throw new Error('übergebene Schlüssel ≠ K.deriveKeys');
    if (payloadKeys.apiBase !== 'https://pdf.fale.network') throw new Error('apiBase ' + payloadKeys.apiBase);
    const st = await waitFor(async () => { const x = await bgState(); return x.armed && x.work.periodic !== 'NONE' && x.work.trigger !== 'NONE' && x; }, { timeout: 15000 });
    if (!st) throw new Error('nicht geplant: ' + JSON.stringify(await bgState()));
    if (!st.prefs.on || !st.prefs.wifiOnly || st.prefs.videos) throw new Error('prefs ' + JSON.stringify(st.prefs));
    // sealed: neither the tokens nor the keys are readable in the app's files
    if (!secretFile()) throw new Error('kein versiegelter Zustand in no_backup/');
    const blob = adb(['exec-out', 'run-as', PKG, 'cat', 'no_backup/fale-one-bg-secret.bin'], { encoding: null, allowFail: true });
    const txt = Buffer.from(blob).toString('latin1');
    const kekRaw = Buffer.from(K.unb64u(payloadKeys.kek));
    if (!blob.length || blob[0] !== 1) throw new Error('Dateiformat ' + blob.length);
    if (txt.includes(sess.refresh) || txt.includes(payloadKeys.kek) || Buffer.from(blob).includes(kekRaw) || txt.includes('userId')) throw new Error('Geheimnisse im Klartext gespeichert');
    const prefsXml = runAs('cat shared_prefs/*.xml');
    if (prefsXml.includes(sess.refresh) || prefsXml.includes(payloadKeys.kek)) throw new Error('Geheimnisse in shared_prefs');
    const pkgFlags = (sh(`dumpsys package ${PKG}`, { allowFail: true }).match(/pkgFlags=\[[^\]]*\]/) || [''])[0];
    if (/ALLOW_BACKUP/.test(pkgFlags)) throw new Error('allowBackup ist an: ' + pkgFlags);
    const jobs = await waitFor(() => { const j = ourJobs(); return j.length >= 2 && j; }, { timeout: 15000, interval: 1500 });
    if (!jobs) throw new Error('keine JobScheduler-Jobs: ' + JSON.stringify(ourJobs().map(j => j.id)) + ' | dumpsys: ' + jobsRaw);
    const all = jobs.map(j => j.text).join('\n');
    const unmetered = /NOT_METERED|UNMETERED/.test(all), content = /content:\/\/media/.test(all);
    if (!unmetered || !content) console.log(`::warning title=One-Smoke Job-Bedingungen::${esc('WLAN-Bedingung ' + unmetered + ', Inhalts-Trigger ' + content + '\n' + all.slice(0, 1500))}`);
    return `armiert, Arbeit ${JSON.stringify(st.work)}, ${jobs.length} Jobs (WLAN-Bedingung ${unmetered ? 'ja' : '?'}, neue-Fotos-Trigger ${content ? 'ja' : '?'}), Datei versiegelt (${blob.length} B), allowBackup aus`;
  });

  await step('Hintergrundlauf bei geschlossener App: Uploads entschlüsseln mit JS zum Original', async () => {
    if (!armed) throw new Error('nicht eingerichtet');
    await waitFor(async () => { const x = await bgState(); return x.live && !x.live.running && x; }, { timeout: 60000, interval: 1500 }); // the immediate periodic run (nothing new) is over
    if (mock.photoNodes().length) throw new Error('vor dem Hintergrundtest schon hochgeladen');
    await ev(B('setPrefs', { userId: user.id, wifiOnly: false })); // the emulator's network may count as metered
    adb(['logcat', '-c'], { allowFail: true });
    sh('input keyevent 3'); // HOME: the activity goes to the background (not force-stopped)
    if (!await waitFor(() => !appOnTop(), { timeout: 10000 })) throw new Error('App bleibt vorne');
    debugBroadcast('CHECKPOINT'); // all test photos are new again
    await sleep(1000);
    const jobs = ourJobs();
    for (const j of jobs) runJob(j);
    let how = `JobScheduler (${jobs.map(j => (j.ns ? j.ns + ':' : '') + j.id).join(', ') || 'keine Jobs gefunden'})`;
    let ok = await waitFor(() => mock.photoNodes().length >= FIXTURES.length, { timeout: 60000, interval: 1500 });
    if (!ok) { debugBroadcast('RUN'); how += ' + Debug-RUN'; ok = await waitFor(() => mock.photoNodes().length >= FIXTURES.length, { timeout: 120000, interval: 2000 }); }
    const fg = appOnTop();
    if (!ok) throw new Error(`${mock.photoNodes().length}/${FIXTURES.length} hochgeladen | Mock: ${mock.st.requests.slice(-12).map(r => r.a || r.path).join(',')} | logcat: ${logcatBg()}`);
    if (fg) throw new Error('App war während des Laufs vorne');
    await waitFor(() => mock.st.reports.some(r => r.deviceId === deviceId && r.status === 'idle' && r.success && r.at > Math.max(...mock.photoNodes().map(n => n.committedAt))), { timeout: 30000 });
    const runs = adb(['logcat', '-d', '-v', 'brief', 'FaleBackup:V', '*:S'], { allowFail: true }).split('\n').filter(l => /run \(/.test(l)).map(l => l.replace(/^.*?: /, '')).slice(-4).join('; ');
    const v = await verifyBackup({ mock, mkRaw, userId: user.id, deviceId, deviceName, fixtures });
    if (v.problems.length) throw new Error(v.problems.join(' | ').slice(0, 1800));
    if (mock.st.refreshes < 1) throw new Error('Sitzung nicht erneuert (Zugriffstoken war abgelaufen)');
    if (mock.st.reuse) throw new Error('Refresh-Token doppelt benutzt');
    return `${how}; ${v.info.join(' · ')}; Läufe: ${runs}; Sitzung ${mock.st.refreshes}× erneuert`;
  });

  await step('Ein Sitzungs-Erneuerer: die App erneuert über die Hintergrund-Sicherung', async () => {
    await ensureFront();
    // the app's own (now outdated) refresh token must never reach the server – auth.js asks FaleBackup
    const r = await ev(`const { kv } = await import('/js/idb.js'); const A = await import('/js/auth.js');
      await kv.set('session', { refresh: ${JSON.stringify(sess.refresh)}, user: ${JSON.stringify(user)}, at: Date.now(), device: ${JSON.stringify(deviceId)}, deviceName: ${JSON.stringify(deviceName)} });
      const before = ${mock.st.refreshes};
      const tok = await A.accessToken({ force: true });
      const s = await kv.get('session', null);
      await kv.del('session'); localStorage.removeItem('fale-one-signed-in');
      return { tok: !!tok, refresh: s && s.refresh };`);
    if (!r.tok) throw new Error('kein Zugriffstoken');
    if (r.refresh !== mock.st.refresh) throw new Error('App hat nicht das neueste Refresh-Token');
    const usedOld = mock.st.presented.filter(x => x === sess.refresh).length;
    if (usedOld !== 1 || mock.st.reuse) throw new Error(`altes Refresh-Token ${usedOld}× vorgelegt, Wiederverwendung ${mock.st.reuse}`);
    return `${mock.st.refreshes} Erneuerungen, keine Wiederverwendung, App übernimmt das neue Token`;
  });

  await step('Kein Doppel-Upload: Prüfpunkt und Dedupe', async () => {
    const uploadsBefore = mock.st.uploads.size, nodesBefore = mock.photoNodes().length;
    const runOnce = async () => {
      const s0 = (await bgState()).status || {};
      debugBroadcast('RUN');
      const s1 = await waitFor(async () => { const x = await bgState(); return x.status && x.status.lastRun > (s0.lastRun || 0) && !x.live.running && x; }, { timeout: 90000, interval: 1500 });
      if (!s1) throw new Error('Lauf endet nicht | ' + logcatBg());
      return s1;
    };
    await runOnce(); // checkpoint: nothing new
    const dedupeBefore = mock.st.requests.filter(r => r.a === 'dedupe').length;
    debugBroadcast('CHECKPOINT');
    await sleep(800);
    const s2 = await runOnce(); // everything "new" again → server dedupe must skip it
    const dedupes = mock.st.requests.filter(r => r.a === 'dedupe').length - dedupeBefore;
    if (mock.photoNodes().length !== nodesBefore) throw new Error(`${mock.photoNodes().length} statt ${nodesBefore} Fotos`);
    if (mock.st.uploads.size !== uploadsBefore) throw new Error(`${mock.st.uploads.size - uploadsBefore} neue Uploads`);
    if (dedupes < FIXTURES.length || s2.status.skipped < FIXTURES.length) throw new Error(`Dedupe ${dedupes}×, übersprungen ${s2.status.skipped}`);
    return `2 weitere Läufe, keine neuen Uploads, ${s2.status.skipped} per Dedupe übersprungen`;
  });

  await step('Neues Foto: Inhalts-Trigger sichert es im Hintergrund', async () => {
    const n0 = mock.photoNodes().length;
    const name = 'fale-e2e-neu.jpg';
    const bytes = Buffer.concat([Buffer.from(fixtures[0].bytes), Buffer.from('E2E' + Date.now())]); // new content (after EOI)
    writeFileSync(join(OUT, name), bytes);
    sh('input keyevent 3');
    adb(['push', join(OUT, name), `/sdcard/DCIM/Camera/${name}`], { allowFail: true });
    sh(`content call --uri content://media/none --method scan_file --arg /storage/emulated/0/DCIM/Camera/${name}`, { allowFail: true });
    sh(`am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/DCIM/Camera/${name}`, { allowFail: true });
    let ok = await waitFor(() => mock.photoNodes().length > n0, { timeout: 75000, interval: 2000 });
    let how = 'Inhalts-Trigger';
    if (!ok) { // the trigger may be delayed by the system: run the jobs like the scheduler would
      for (const j of ourJobs()) runJob(j);
      how = 'Job erzwungen (Trigger kam nicht in 75 s)';
      ok = await waitFor(() => mock.photoNodes().length > n0, { timeout: 90000, interval: 2000 });
    }
    if (!ok) throw new Error('neues Foto nicht gesichert | ' + logcatBg());
    if (how !== 'Inhalts-Trigger') console.log(`::warning title=One-Smoke Inhalts-Trigger::${esc(how)}`);
    return `${how}, ${mock.photoNodes().length} Fotos`;
  });

  await step('Anderswo abgemeldet: Schlüssel gelöscht, Hinweis zum Öffnen', async () => {
    await ensureFront();
    if (sdk >= 33) sh(`pm grant ${PKG} android.permission.POST_NOTIFICATIONS`, { allowFail: true });
    mock.revokeSession();
    debugBroadcast('RUN');
    const st = await waitFor(async () => { const x = await bgState(); return !x.armed && x; }, { timeout: 90000, interval: 1500 });
    if (!st) throw new Error('Schlüssel nicht gelöscht | ' + logcatBg());
    if (secretFile()) throw new Error('versiegelte Datei noch da');
    const busy = Object.entries(st.work).filter(([, v]) => v === 'ENQUEUED' || v === 'RUNNING');
    if (busy.length) throw new Error('Arbeit noch geplant: ' + JSON.stringify(st.work));
    const notes = sh('dumpsys notification --noredact', { allowFail: true, timeout: 60000 });
    const shown = notes.includes('Sicherung angehalten');
    if (sdk >= 33 && !shown) throw new Error('kein Hinweis „Sicherung angehalten“');
    const tok = await ev(B('token', {}));
    if (tok.armed) throw new Error('token() liefert noch eine Sitzung');
    return `entwaffnet, Arbeit ${JSON.stringify(st.work)}, Hinweis ${shown ? 'angezeigt' : 'ohne Mitteilungs-Erlaubnis nicht sichtbar'}`;
  });

  await step('Schalter aus: Zeitplan gelöscht, Schlüssel gelöscht', async () => {
    sess = mock.session(user);
    await ev(B('setCheckpoint', { userId: user.id, kind: 'image', since: 4102444800, afterId: 0 })); // nothing to upload in this step
    await armJs(sess);
    const on = await waitFor(async () => { const x = await bgState(); return x.armed && x.work.periodic !== 'NONE' && x; }, { timeout: 15000 });
    if (!on) throw new Error('nicht wieder eingerichtet');
    if (!await waitFor(() => ourJobs().length > 0, { timeout: 15000, interval: 1500 })) throw new Error('keine Jobs nach dem Einschalten | dumpsys: ' + jobsRaw);
    const r = await ev(B('setPrefs', { userId: user.id, on: false }));
    if (r.armed !== false || r.on !== false) throw new Error('setPrefs(off): ' + JSON.stringify(r));
    const off = await waitFor(async () => { const x = await bgState(); return !x.armed && !Object.values(x.work).some(v => v === 'ENQUEUED' || v === 'RUNNING') && x; }, { timeout: 15000 });
    if (!off) throw new Error('nach dem Ausschalten: ' + JSON.stringify(await bgState()));
    const left = await waitFor(() => ourJobs().length === 0, { timeout: 20000, interval: 2000 });
    if (!left) throw new Error('JobScheduler-Jobs bleiben: ' + ourJobs().map(j => j.id).join(','));
    if (secretFile()) throw new Error('versiegelte Datei noch da');
    debugBroadcast('API', '--es api ""');
    return `aus: Arbeit ${JSON.stringify(off.work)}, keine Jobs, keine Schlüssel`;
  });
  await mock.close().catch(() => {});
}
async function crossKeys(mkRaw, userId) {
  const te = new TextEncoder();
  const mk = await K.importMasterRaw(mkRaw);
  const bits = async info => K.b64u(new Uint8Array(await globalThis.crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: te.encode(`fale-one-v1|${userId}`), info: te.encode(info) }, mk, 256)));
  // must equal the keys K.deriveKeys derives (checked by decrypting with them in verifyBackup)
  return { kek: await bits('fale-one-v1/kek'), dk: await bits('fale-one-v1/dedupe'), dvk: await bits('fale-one-v1/device') };
}

main().catch(e => {
  console.log('::error title=One-Smoke Abbruch::' + esc(e.stack || e.message) + esc(' | Konsole: ' + jsErrors().slice(-6).join(' | ')));
  screenshot('abort');
  try { writeFileSync(join(OUT, 'console.txt'), consoleLog.join('\n')); } catch { /* ignore */ }
  process.exit(2);
});
