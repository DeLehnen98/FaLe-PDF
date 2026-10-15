#!/usr/bin/env node
// FaLe PDF – end-to-end test of the real Android app (emulator, debug APK).
// Drives the app's WebView via the Chrome DevTools Protocol (adb forward → webview_devtools_remote_<pid>)
// and real touch input (adb shell input). Results: ::notice / ::error annotations, screenshots in e2e-out/.
//
//   node scripts/android-e2e/e2e.mjs          (adb connected to a booted emulator, app installed)
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PKG = 'dev.fale.pdf';
const OUT = process.env.E2E_OUT || 'e2e-out';
const PORT = 9222;
const MARK = 'E2E' + Date.now().toString(36).toUpperCase();
mkdirSync(OUT, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const esc = s => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
function report(name, ok, info = '') {
  results.push({ name, ok, info });
  const line = `${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' – ' + info : ''}`;
  console.log(line);
  console.log(`::${ok ? 'notice' : 'error'} title=E2E ${name}::${esc((ok ? 'OK' : 'FEHLER') + (info ? ': ' + info : ''))}`);
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
function topActivity() {
  const s = sh('dumpsys activity activities', { allowFail: true });
  const m = s.match(/topResumedActivity=[^\n]*|mResumedActivity[^\n]*|ResumedActivity: [^\n]*/);
  return m ? m[0] : '';
}
function focusedWindow() {
  const s = sh('dumpsys window', { allowFail: true });
  const m = s.match(/mCurrentFocus=[^\n]*/);
  return m ? m[0] : '';
}
async function waitFor(fn, { timeout = 15000, interval = 400 } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { last = await fn(); if (last) return last; } catch (e) { last = null; }
    await sleep(interval);
  }
  return null;
}
const appPid = () => sh(`pidof ${PKG}`, { allowFail: true }).trim().split(/\s+/)[0] || '';

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
    const list = await r.json();
    return list.find(t => t.type === 'page' && /^https:\/\/localhost/.test(t.url));
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
      consoleLog.push(`[log:${msg.params.entry.level}] ${msg.params.entry.text}`);
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

// recent console errors/warnings (for failure details)
function consoleTail(n = 8) {
  return consoleLog.filter(l => /^\[(error|warning|exception|log:error|log:warning)/.test(l)).slice(-n).join(' | ').slice(0, 1500);
}

// ------------------------------------------------------------------ touch
let wv = null; // { left, top, dpr }
async function webviewGeometry() {
  let bounds = null;
  for (let i = 0; i < 5 && !bounds; i++) {
    sh('uiautomator dump /sdcard/e2e-ui.xml', { allowFail: true, timeout: 30000 });
    const xml = sh('cat /sdcard/e2e-ui.xml', { allowFail: true });
    const m = xml.match(/class="android\.webkit\.WebView"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (m) bounds = m.slice(1).map(Number);
    else await sleep(1500);
  }
  const dpr = await ev('return window.devicePixelRatio;');
  const inner = await ev('return [innerWidth, innerHeight];');
  if (!bounds) {
    // fallback: WebView fills the width and ends above the navigation bar
    const size = sh('wm size').match(/(\d+)x(\d+)/).slice(1).map(Number);
    bounds = [0, size[1] - Math.round(inner[1] * dpr) - 0, size[0], size[1]];
  }
  wv = { left: bounds[0], top: bounds[1], dpr };
  console.log('WebView', JSON.stringify({ bounds, dpr, inner }));
}
const dev = (x, y) => [Math.round(wv.left + x * wv.dpr), Math.round(wv.top + y * wv.dpr)];
function tapXY(x, y) { const [dx, dy] = dev(x, y); sh(`input tap ${dx} ${dy}`); }
/** Real tap on the centre of the first visible element matching the selector (scrolled into view). */
async function tap(selector, { index = -1, text = null, dx = null, dy = null } = {}) {
  const r = await ev(`
    const all = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).filter(e => e.offsetParent !== null || e.getClientRects().length);
    const list = ${JSON.stringify(text)} ? all.filter(e => e.textContent.trim().includes(${JSON.stringify(text)})) : all;
    const el = ${index} < 0 ? list[0] : list[${index}];
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    await new Promise(r => setTimeout(r, 250));
    const b = el.getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: b.height };`);
  if (!r) throw new Error(`Element nicht gefunden: ${selector}${text ? ' „' + text + '“' : ''}`);
  tapXY(r.x + (dx ?? r.w / 2), r.y + (dy ?? r.h / 2));
  return r;
}
async function rectOf(selector) {
  return ev(`const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 250)); const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height };`);
}
/** Finger stroke through CSS points (input motionevent; falls back to swipes). */
function stroke(points) {
  const d = points.map(([x, y]) => dev(x, y));
  const ok = !/rror|nknown|sage/.test(sh(`input motionevent DOWN ${d[0][0]} ${d[0][1]}`, { allowFail: true }));
  if (ok) {
    for (const [x, y] of d.slice(1)) sh(`input motionevent MOVE ${x} ${y}`, { allowFail: true });
    sh(`input motionevent UP ${d[d.length - 1][0]} ${d[d.length - 1][1]}`, { allowFail: true });
  } else {
    for (let i = 1; i < d.length; i++) sh(`input swipe ${d[i - 1][0]} ${d[i - 1][1]} ${d[i][0]} ${d[i][1]} 120`, { allowFail: true });
  }
}
/** Warnings/errors the app process logged since the last logcatMark() (Capacitor, plugins, chromium). */
function logcatMark() { adb(['logcat', '-c'], { allowFail: true }); }
function logcatTail(n = 14) {
  const pid = appPid();
  const noise = /Handling local request|ZappDownloader|ChimeraConfig|Vision|abht|dumpsys|beginning of/;
  const sys = adb(['logcat', '-d', '-v', 'brief', 'FaleIncoming:V', 'FalePrint:V', 'Capacitor/Plugin:V', 'Capacitor/Console:V', 'ActivityTaskManager:W', 'AndroidRuntime:E', '*:S'], { allowFail: true });
  const app = adb(['logcat', '-d', '-v', 'brief', ...(pid ? [`--pid=${pid}`] : []), '*:W'], { allowFail: true });
  const lines = [...new Set((sys + '\n' + app).split('\n'))].filter(l => l.trim() && !noise.test(l));
  return lines.slice(-n).join(' | ').slice(0, 2000);
}
const back = () => sh('input keyevent 4', { allowFail: true });
const hideKeyboard = () => sh('input keyevent 111', { allowFail: true }); // ESCAPE closes the IME without touching the page

// ------------------------------------------------------------------ test PDF
function makePdf(text) {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    null,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  const content = `BT /F1 24 Tf 72 760 Td (${text}) Tj ET BT /F1 12 Tf 72 720 Td (Zweite Zeile fuer den E2E-Test.) Tj ET`;
  objs[3] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// in-page helpers (installed after every (re)load)
const HELPERS = `
  if (!window.__e2e) {
    window.__e2e = { toasts: [] };
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
      if (n.nodeType === 1 && n.classList.contains('toast')) window.__e2e.toasts.push((n.className.match(/toast-(\\w+)/) || [])[1] + ': ' + n.textContent.trim());
    }))).observe(document.getElementById('toasts') || document.body, { childList: true, subtree: true });
  }
  return true;`;
const docs = () => ev(`const db = await import('/js/db.js'); return (await db.listDocs()).map(d => ({ id: d.id, name: d.name, kind: d.kind }));`);
const toasts = () => ev('return (window.__e2e && window.__e2e.toasts) || [];');
async function pdfInfo(id) {
  return ev(`
    const db = await import('/js/db.js');
    const blob = await db.getFile(${JSON.stringify(id)});
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const lib = await import('/vendor/pdfjs/pdf.min.mjs');
    const { loadPdf } = await import('/js/pdfcore.js');
    const { pdf } = await loadPdf(bytes, {});
    const page = await pdf.getPage(1);
    const tc = await page.getTextContent();
    const ops = await page.getOperatorList();
    const images = ops.fnArray.filter(f => f === lib.OPS.paintImageXObject || f === lib.OPS.paintInlineImageXObject).length;
    return { size: bytes.length, text: tc.items.map(i => i.str).join(' '), images };`);
}
async function closeOverlays() {
  await ev(`document.querySelectorAll('.menu-layer').forEach(m => m.remove()); document.querySelectorAll('dialog[open]').forEach(d => d.close()); document.querySelectorAll('.onboard').forEach(o => o.remove()); return true;`).catch(() => {});
}
const appOnTop = () => new RegExp(`topResumedActivity=[^\\n]*${PKG.replace(/\./g, '\\.')}/`).test(sh('dumpsys activity activities', { allowFail: true }));
/** Bring the app back to the front (never with BACK: on the start screen that closes the app). */
async function ensureApp() {
  if (!appOnTop()) {
    sh(`am start -n ${PKG}/.MainActivity`, { allowFail: true });
    await waitFor(() => appOnTop(), { timeout: 15000, interval: 700 });
    await sleep(800);
  }
  const pid = appPid();
  if (!cdp || cdp.closed || cdp.pid !== pid) {
    await connect();
    cdp.pid = appPid();
    await waitJs(`document.readyState === 'complete' && !!document.querySelector('#view-start, main')`, { timeout: 30000 });
    await ev(HELPERS);
  }
}
async function step(name, fn) {
  const start = consoleLog.length;
  logcatMark();
  try {
    await ensureApp();
    const info = await fn();
    report(name, true, info || '');
  } catch (e) {
    const cons = consoleLog.slice(start).filter(l => /^\[(error|warning|exception|log:error)/.test(l)).slice(-6).join(' | ');
    let t = [];
    try { t = (await toasts()).slice(-4); } catch { /* app gone */ }
    report(name, false, `${e.message}${t.length ? ' | Toasts: ' + t.join(' / ') : ''}${cons ? ' | Konsole: ' + cons.slice(0, 900) : ''} | Fenster: ${focusedWindow()} | logcat: ${logcatTail()}`);
  }
  screenshot(name.replace(/[^\w]+/g, '-').toLowerCase());
}

// ------------------------------------------------------------------ main
async function main() {
  const env = `Android ${sh('getprop ro.build.version.release').trim()} (API ${sh('getprop ro.build.version.sdk').trim()}), WebView ${(sh('dumpsys webviewupdate', { allowFail: true }).match(/Current WebView package \(name, version\): \(([^)]*)\)/) || [])[1] || '?'}`;
  console.log(`::notice title=E2E Gerät::${esc(env)}`);
  sh(`pm clear ${PKG}`, { allowFail: true });
  sh(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`, { allowFail: true });
  await sleep(4000);
  await connect();
  // German UI (as on the owner's phone), skip the intro
  await ev(`localStorage.setItem('fale-lang', 'de'); localStorage.setItem('fale-onboarded', '1'); location.hash = '#/start'; location.reload(); return true;`).catch(() => {});
  await sleep(3500);
  if (cdp.closed) await connect();
  await waitJs(`!!document.querySelector('#view-start, main')`, { timeout: 30000 });
  await ev(HELPERS);
  await closeOverlays();
  await webviewGeometry();
  screenshot('start');

  // ---- open a PDF from another app ("Öffnen mit") ----
  const pdf = makePdf(`Hallo ${MARK}`);
  const local = join(OUT, 'e2e-test.pdf');
  writeFileSync(local, pdf);
  let docId = null;
  await step('PDF aus anderer App öffnen (VIEW-Intent)', async () => {
    adb(['push', local, '/sdcard/Download/e2e-test.pdf']);
    // index the file in MediaStore → content://media/… URI that the shell can grant to the app
    sh('content call --uri content://media/none --method scan_volume --arg external_primary', { allowFail: true, timeout: 60000 });
    sh('am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Download/e2e-test.pdf', { allowFail: true });
    let uri = '';
    for (let i = 0; i < 10 && !uri; i++) {
      const q = sh(`content query --uri content://media/external/file --projection _id:_display_name --where "_display_name='e2e-test.pdf'"`, { allowFail: true });
      const m = q.match(/_id=(\d+)/);
      if (m) uri = `content://media/external/file/${m[1]}`;
      else await sleep(1500);
    }
    const am = uri
      ? sh(`am start -W -a android.intent.action.VIEW -d ${uri} -t application/pdf --grant-read-uri-permission -n ${PKG}/.MainActivity`, { allowFail: true })
      : sh(`am start -W -a android.intent.action.VIEW -d file:///sdcard/Download/e2e-test.pdf -t application/pdf -n ${PKG}/.MainActivity`, { allowFail: true });
    console.log('VIEW', uri || 'file://', am.replace(/\s+/g, ' ').slice(0, 200));
    await sleep(2500);
    if (cdp.closed || cdp.pid !== appPid()) { await connect(); await ev(HELPERS); }
    const d = await waitFor(async () => (await docs()).find(x => x.name === 'e2e-test.pdf'), { timeout: 20000 });
    if (!d) throw new Error(`Datei kam nicht in der App an (${uri || 'file://'}; am: ${am.replace(/\s+/g, ' ').slice(0, 300)})`);
    docId = d.id;
    const hash = await waitJs(`location.hash.includes(${JSON.stringify(d.id)}) && location.hash`, { timeout: 10000 });
    return `importiert und geöffnet (${hash})`;
  });
  if (!docId) {
    // fallback so the remaining tests can run: import inside the page
    await ensureApp();
    docId = await ev(`const lib = await import('/js/library.js'); const b = Uint8Array.from(atob(${JSON.stringify(pdf.toString('base64'))}), c => c.charCodeAt(0));
      const [d] = await lib.importFiles([new File([b], 'e2e-test.pdf', { type: 'application/pdf' })]); return d && d.id;`);
    console.log('Fallback-Import:', docId);
  }

  const openViewer = async () => {
    await closeOverlays();
    await ev(`location.hash = '#/ansicht/${docId}'; return true;`);
    if (!await waitJs(`!!document.querySelector('.v-stage .page canvas, .pdfViewer .page canvas, .pdfViewer .page')`, { timeout: 20000 })) throw new Error('Viewer lädt nicht');
    await sleep(800);
  };
  const menuItem = async label => {
    await tap('[data-v="more"]');
    if (!await waitJs(`!!document.querySelector('.menu-layer .menu-item')`, { timeout: 5000 })) throw new Error('Menü öffnet nicht');
    await sleep(400);
    await tap('.menu-layer .menu-item', { text: label });
  };

  // ---- print ----
  await step('Drucken', async () => {
    await openViewer();
    await menuItem('Drucken');
    const act = await waitFor(() => { const a = topActivity() + ' ' + focusedWindow(); return /printspooler|PrintActivity/i.test(a) && a; }, { timeout: 25000, interval: 700 });
    screenshot('print-ui');
    if (!act) throw new Error('Android-Druckdialog erscheint nicht (' + topActivity() + ')');
    back(); await sleep(1500);
    if (/printspooler/i.test(focusedWindow())) { back(); await sleep(1500); }
    return act.trim().slice(0, 160);
  });

  // ---- share ----
  await step('Teilen', async () => {
    await openViewer();
    await menuItem('Teilen');
    const act = await waitFor(() => { const a = topActivity() + ' ' + focusedWindow(); return /Chooser|Resolver|intentresolver/i.test(a) && a; }, { timeout: 20000, interval: 700 });
    screenshot('share-sheet');
    if (!act) throw new Error('System-Teilen-Dialog erscheint nicht (' + topActivity() + ')');
    back(); await sleep(1500);
    const t = await toasts();
    if (t.some(x => /^error/.test(x) && /Teilen/.test(x))) throw new Error('Fehlermeldung nach dem Schließen: ' + t.join(' / '));
    return act.trim().slice(0, 160);
  });

  // ---- download ----
  await step('Herunterladen', async () => {
    await openViewer();
    const before = (await toasts()).length;
    await menuItem('Herunterladen');
    const ok = await waitFor(async () => (await toasts()).slice(before).find(x => /Gespeichert in/.test(x)), { timeout: 15000 });
    if (!ok) {
      const probe = await ev(`const { plugin } = await import('/js/platform.js'); const fs = plugin('Filesystem');
        try { const r = await fs.writeFile({ path: 'FaLe PDF/e2e-probe.txt', data: btoa('x'), directory: 'DOCUMENTS', recursive: true }); return 'writeFile ok ' + JSON.stringify(r); }
        catch (e) { return 'writeFile: ' + (e && (e.message || e.errorMessage)) + ' code=' + (e && e.code); }`).catch(e => e.message);
      throw new Error('keine Bestätigung; Probe: ' + probe);
    }
    const ls = sh('ls "/sdcard/Documents/FaLe PDF/"', { allowFail: true });
    if (!/e2e-test/.test(ls)) throw new Error('Datei fehlt in Dokumente/FaLe PDF: ' + ls.trim());
    return ok;
  });

  // ---- edit text ----
  await step('Text bearbeiten (PDF bearbeiten → Text)', async () => {
    await closeOverlays();
    await ev(`location.hash = '#/werkzeug/bearbeiten?doc=${docId}'; return true;`);
    if (!await waitJs(`!!document.querySelector('.pt-stage .pt-page canvas')`, { timeout: 25000 })) throw new Error('Editor lädt nicht');
    await sleep(1000);
    await tap('[data-tool="text"]');
    await sleep(400);
    const r = await rectOf('.pt-stage .pt-page');
    tapXY(r.x + r.w * 0.2, r.y + Math.min(r.h * 0.45, 260));
    // a real user can only type when the on-screen keyboard opens
    const ime = await waitFor(() => /mInputShown=true|isInputViewShown=true|mIsInputViewShown=true/.test(sh('dumpsys input_method', { allowFail: true })), { timeout: 6000, interval: 500 });
    screenshot('edit-keyboard');
    report('Text bearbeiten: Tastatur öffnet sich', !!ime, ime ? 'Bildschirmtastatur sichtbar' : 'Feld fokussiert, aber keine Bildschirmtastatur');
    await sleep(600);
    const typed = `${MARK}x`;
    sh(`input text ${typed}`);
    await sleep(800);
    const st = await ev(`const s = document.querySelector('.pt-etext-in'); return { text: s ? s.innerText : null, active: document.activeElement && document.activeElement.className, kb: visualViewport ? Math.round(visualViewport.height) : 0 };`);
    console.log('edit state', JSON.stringify(st));
    if (!st.text || !st.text.includes(typed)) throw new Error('Text kommt nicht im Textfeld an: ' + JSON.stringify(st));
    screenshot('edit-typed');
    const before = (await docs()).length;
    await tap('button.btn-primary', { text: 'Speichern' });
    let d = await waitFor(async () => (await docs()).find(x => /bearbeitet/.test(x.name)), { timeout: 8000 });
    if (!d) {
      screenshot('edit-after-first-save-tap');
      throw new Error('Speichern reagiert nicht auf den ersten Tipp (Dokumente: ' + before + ')');
    }
    const info = await pdfInfo(d.id);
    if (!info.text.includes(typed)) throw new Error('gespeicherte PDF enthält den Text nicht: ' + info.text.slice(0, 200));
    return `„${typed}“ in „${d.name}“ (${info.size} B)`;
  });

  // ---- sign ----
  await step('Unterschreiben', async () => {
    await closeOverlays();
    await ev(`location.hash = '#/werkzeug/unterschreiben?doc=${docId}'; return true;`);
    if (!await waitJs(`!!document.querySelector('.sign-page canvas')`, { timeout: 25000 })) throw new Error('Unterschreiben lädt nicht');
    await sleep(1000);
    await tap('[data-mode="sign"]');
    if (!await waitJs(`!!document.querySelector('dialog[open] canvas.sig-pad')`, { timeout: 10000 })) throw new Error('Unterschriften-Dialog erscheint nicht');
    await sleep(700);
    const pad = await rectOf('dialog[open] canvas.sig-pad');
    const pts = [];
    for (let i = 0; i <= 16; i++) pts.push([pad.x + 30 + i * (pad.w - 60) / 16, pad.y + pad.h * 0.5 + Math.sin(i / 2) * pad.h * 0.25]);
    stroke(pts);
    await sleep(500);
    const drawn = await ev(`const c = document.querySelector('dialog[open] canvas.sig-pad'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n;`);
    screenshot('sign-pad');
    if (!drawn) throw new Error('Zeichnen auf der Unterschriftenfläche hinterlässt keine Spur');
    await tap('dialog[open] button.btn-primary', { text: 'Übernehmen' });
    if (!await waitJs(`!document.querySelector('dialog[open]')`, { timeout: 8000 })) throw new Error('Dialog schließt nicht nach „Übernehmen“');
    await sleep(600);
    const pg = await rectOf('.sign-page');
    tapXY(pg.x + pg.w * 0.35, pg.y + Math.min(pg.h * 0.5, 300));
    if (!await waitJs(`document.querySelectorAll('.s-item').length > 0`, { timeout: 6000 })) throw new Error('Unterschrift wird nicht platziert');
    screenshot('sign-placed');
    await tap('[data-save]');
    const d = await waitFor(async () => (await docs()).find(x => /unterschrieben/.test(x.name)), { timeout: 15000 });
    if (!d) throw new Error('keine unterschriebene Kopie gespeichert');
    const info = await pdfInfo(d.id);
    if (!info.images) throw new Error('gespeicherte PDF enthält kein Unterschriftsbild');
    return `„${d.name}“ mit ${info.images} Bild(ern), ${drawn} Pixel gezeichnet`;
  });

  writeFileSync(join(OUT, 'console.txt'), consoleLog.join('\n'));
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} bestanden`);
  if (failed.length) console.log('::error title=E2E Zusammenfassung::' + esc(failed.map(f => f.name).join(', ') + ' fehlgeschlagen'));
  process.exit(failed.length ? 1 : 0);
}

main().catch(e => {
  console.log('::error title=E2E Abbruch::' + esc(e.stack || e.message) + esc(' | Konsole: ' + consoleTail()));
  screenshot('abort');
  try { writeFileSync(join(OUT, 'console.txt'), consoleLog.join('\n')); } catch { /* ignore */ }
  process.exit(2);
});
