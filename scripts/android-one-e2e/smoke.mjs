#!/usr/bin/env node
// FaLe One Android app – smoke test on an emulator (debug APK installed, test photos in DCIM, see run.sh).
// Drives the app's WebView over the Chrome DevTools Protocol (adb forward → webview_devtools_remote_<pid>)
// and adb. Results: ::notice / ::error annotations (readable via the Checks API), screenshots in e2e-out/.
//
// Checks: start screen renders without JS errors, native platform, no service worker, FaleMedia/FaleSystem
// registered, media permission flow (prompt → pm grant → granted), MediaStore listing + paging + count,
// reading an original through Capacitor's local server with EXIF GPS intact, the backup card renders,
// back button (dialog, history, background instead of closing).
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

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
      const text = msg.params.args.map(a => (a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value)) : a.description || a.type)).join(' ');
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
const jsErrors = (from = 0) => consoleLog.slice(from).filter(l => /^\[(exception|error|assert)\]|^\[log:error:(javascript|other)\]/.test(l));

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
      throw new Error('Testfotos nicht gefunden: ' + JSON.stringify(x).slice(0, 600));
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
    await ev(`const d = await import('/js/dom.js'); window.__dlg = null; d.openDialog({ title: 'E2E', body: d.el('p', 'Test'), actions: [{ label: 'OK', value: 'ok', default: true }] }).then(r => { window.__dlg = r.value; }); return true;`);
    await sleep(500);
    sh('input keyevent 4');
    if (!await waitJs(`window.__dlg === 'cancel' && !document.querySelector('dialog[open]')`, { timeout: 8000 })) throw new Error('Dialog schließt nicht mit Zurück');
    if (!appOnTop()) throw new Error('App nach Dialog-Zurück nicht mehr vorne');
    await ev(`location.hash = '#e2e-a'; await new Promise(r => setTimeout(r, 200)); location.hash = '#e2e-b'; return true;`);
    await sleep(400);
    sh('input keyevent 4');
    if (!await waitJs(`location.hash === '#e2e-a'`, { timeout: 8000 })) throw new Error('Zurück navigiert nicht im Verlauf: ' + await ev('return location.hash;'));
    if (!appOnTop()) throw new Error('App nach Verlauf-Zurück nicht mehr vorne');
    const pid = appPid();
    let left = false;
    for (let i = 0; i < 4 && !left; i++) { sh('input keyevent 4'); await sleep(1200); left = !appOnTop(); }
    if (!left) throw new Error('App bleibt vorne (Startseite)');
    const still = appPid();
    screenshot('nach-zurueck');
    sh(`am start -n ${PKG}/.MainActivity`, { allowFail: true });
    await waitFor(() => appOnTop(), { timeout: 10000 });
    return `Dialog zu, #e2e-b → #e2e-a, Startseite → Hintergrund (Prozess ${still === pid ? 'läuft weiter' : 'neu: ' + still})`;
  });

  writeFileSync(join(OUT, 'console.txt'), consoleLog.join('\n'));
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  const exc = [...new Set(jsErrors().map(l => l.split('\n')[0].slice(0, 220)))];
  if (exc.length) console.log(`::warning title=One-Smoke Konsole (${exc.length})::${esc(exc.slice(0, 12).join('\n'))}`);
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} bestanden`);
  console.log(`::${failed.length ? 'error' : 'notice'} title=One-Smoke Zusammenfassung (API ${sdk})::${esc(failed.length ? failed.map(f => f.name).join(', ') + ' fehlgeschlagen' : `${results.length}/${results.length} bestanden`)}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(e => {
  console.log('::error title=One-Smoke Abbruch::' + esc(e.stack || e.message) + esc(' | Konsole: ' + jsErrors().slice(-6).join(' | ')));
  screenshot('abort');
  try { writeFileSync(join(OUT, 'console.txt'), consoleLog.join('\n')); } catch { /* ignore */ }
  process.exit(2);
});
