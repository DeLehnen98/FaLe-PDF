// pdf.js setup and rendering helpers (all processing happens locally in a web worker).
import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';
import { openDialog, esc, UserError } from './ui.js';
import { LIMITS, canvasScaleCap } from './security.js';

const VENDOR = new URL('../vendor/pdfjs/', import.meta.url).href;
// worker entry with polyfills for older Android WebViews (js/pdfworker.mjs → vendor worker)
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./pdfworker.mjs', import.meta.url).href;

export { pdfjsLib };

export const DOC_OPTIONS = {
  cMapUrl: VENDOR + 'cmaps/',
  cMapPacked: true,
  standardFontDataUrl: VENDOR + 'standard_fonts/',
  wasmUrl: VENDOR + 'wasm/',
  iccUrl: VENDOR + 'iccs/',
  // Hardening (docs/SECURITY.md): pdf.js 6.2.108 contains no eval/new Function code paths any more (the
  // CVE-2024-4367 font-matrix eval was removed in 4.2.67); the option stays false for older builds.
  // No PDF JavaScript is ever run (no scripting/sandbox bundle is shipped), XFA forms are off, images
  // above LIMITS.imagePixels are skipped instead of decoded (decompression bombs), and no resource is
  // fetched from outside the app (cMaps, fonts, wasm and ICC profiles are local).
  isEvalSupported: false,
  enableXfa: false,
  enableScripting: false,
  maxImageSize: LIMITS.imagePixels,
};

let sharedWorker = null;
let probed = false;
function worker() {
  if (!probed) { probed = true; probeWorker(); }
  if (!sharedWorker || sharedWorker.destroyed) sharedWorker = new pdfjsLib.PDFWorker({ name: 'fale-pdf' });
  return sharedWorker;
}

// iPhone app (WKWebView, capacitor:// scheme): report once whether the pdf.js module worker starts – if not,
// pdf.js silently falls back to a slow "fake worker" on the main thread (diagnosis in the simulator test).
function probeWorker() {
  let ios = false;
  try { ios = !!(window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === 'ios'); } catch { /* no window */ }
  if (!ios) return;
  try {
    const w = new Worker(pdfjsLib.GlobalWorkerOptions.workerSrc, { type: 'module', name: 'fale-probe' });
    const done = msg => { console.info('pdf.js worker: ' + msg); try { w.terminate(); } catch { /* gone */ } };
    const t = setTimeout(() => done('keine Antwort nach 8 s'), 8000);
    w.onmessage = () => { clearTimeout(t); done('ok'); };
    w.onerror = e => { clearTimeout(t); done(`Fehler ${(e && e.message) || ''} ${(e && e.filename) || ''}:${(e && e.lineno) || ''}`); };
    w.onmessageerror = () => { clearTimeout(t); done('messageerror'); };
  } catch (e) { console.info('pdf.js worker: new Worker wirft ' + String((e && (e.name + ': ' + e.message)) || e)); }
}

// Passwords entered in this session (never persisted).
const passwords = new Map();
export function rememberPassword(key, pw) { if (key) passwords.set(key, pw); }
export function knownPassword(key) { return passwords.get(key); }

// Passwords for freshly created files (e.g. just encrypted), keyed by a fingerprint of the bytes,
// so importing the result does not ask for the password the user has just typed.
const bytePasswords = new Map();
function fingerprint(u8) {
  const n = u8.length;
  let h = 2166136261 >>> 0;
  const from = Math.max(0, n - 4096);
  for (let i = from; i < n; i++) { h ^= u8[i]; h = Math.imul(h, 16777619) >>> 0; }
  return `${n}:${h.toString(16)}`;
}
export function rememberBytesPassword(bytes, pw) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  bytePasswords.set(fingerprint(u8), pw);
  if (bytePasswords.size > 20) bytePasswords.delete(bytePasswords.keys().next().value);
}

export class PasswordCancelled extends Error {
  constructor() { super('Passworteingabe abgebrochen'); this.userMessage = 'Ohne Passwort kann die Datei nicht geöffnet werden.'; }
}

export async function askPassword(name, wrong) {
  const r = await openDialog({
    title: 'Passwortgeschützte PDF',
    body: `<p>${wrong ? '<strong class="text-danger">Falsches Passwort.</strong> ' : ''}Bitte gib das Passwort für <strong>${esc(name || 'dieses Dokument')}</strong> ein.</p>
      <label class="field"><span class="field-label">Passwort</span><input class="input" type="password" name="pw" autocomplete="current-password" autofocus></label>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Öffnen', value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => ({ collect: () => dlg.querySelector('input').value }),
  });
  return r.value === 'ok' ? r.data : null;
}

/**
 * Load a PDF from bytes. Prompts for a password if needed.
 * @returns {Promise<{pdf: any, password: string|null}>}
 */
export async function loadPdf(data, { name = '', key = null, xfa = false } = {}) {
  const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(data.slice(0));
  let usedPassword = key ? knownPassword(key) || null : null;
  if (!usedPassword && bytePasswords.size) usedPassword = bytePasswords.get(fingerprint(bytes)) || null;
  let autoSupplied = !!usedPassword;
  // xfa: only the XFA form screen (js/tools/xfaform.js) turns pdf.js' XFA engine on – for forms that exist only as XFA
  const task = pdfjsLib.getDocument({ ...DOC_OPTIONS, enableXfa: !!xfa, data: bytes, worker: worker(), password: usedPassword || undefined });
  let cancelled = false;
  task.onPassword = async (update, reason) => {
    // a remembered password that no longer fits is not the user's typo: ask without the warning
    const wrong = reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD && !autoSupplied;
    autoSupplied = false;
    const pw = await askPassword(name, wrong);
    if (pw === null) { cancelled = true; task.destroy(); return; }
    usedPassword = pw;
    update(pw);
  };
  try {
    const pdf = await task.promise;
    // pdf.js 6 removed PDFDocumentProxy.destroy(); keep a uniform API for our modules.
    if (typeof pdf.destroy !== 'function') pdf.destroy = () => task.destroy();
    if (usedPassword && key) rememberPassword(key, usedPassword);
    return { pdf, password: usedPassword };
  } catch (err) {
    if (cancelled) throw new PasswordCancelled();
    if (err && err.name === 'InvalidPDFException') throw new UserError('Die Datei ist keine gültige oder eine beschädigte PDF.');
    throw err;
  }
}

/** Render a page into a new canvas. width (css px) or scale. */
export async function renderPage(page, { width = null, scale = null, rotation = 0, dpr = 1, background = 'white' } = {}) {
  const base = page.getViewport({ scale: 1, rotation: page.rotate + rotation });
  let s = (scale || (width / base.width)) * dpr;
  // pages with absurd MediaBoxes (up to 14 400 pt) must not allocate gigantic canvases
  s *= canvasScaleCap(base.width * s, base.height * s);
  const vp = page.getViewport({ scale: s, rotation: page.rotate + rotation });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport: vp, background }).promise;
  return canvas;
}

// Page thumbnails one after another (organize, extract, viewer sidebar): rendering a dozen scanned pages at once
// let their image work pile up into one long freeze on phones; queued with a breather between pages the
// list fills in steadily and taps still get through.
let thumbChain = Promise.resolve();
export function renderThumb(page, opts) {
  const run = async () => {
    await new Promise(r => setTimeout(r, 0));
    return renderPage(page, opts);
  };
  const p = thumbChain.then(run, run);
  thumbChain = p.catch(() => {});
  return p;
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.85) {
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Bild konnte nicht erzeugt werden'))), type, quality));
}

export async function thumbnailBlob(pdf, width = 220) {
  const page = await pdf.getPage(1);
  const canvas = await renderPage(page, { width, dpr: 1.5 });
  page.cleanup();
  return canvasToBlob(canvas, 'image/jpeg', 0.8);
}

export async function pageText(page) {
  const content = await page.getTextContent();
  let out = '';
  for (const item of content.items) {
    if (typeof item.str !== 'string') continue;
    out += item.str;
    out += item.hasEOL ? '\n' : (item.str && !item.str.endsWith(' ') ? ' ' : '');
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ').trim();
}

export async function extractAllText(pdf, onProgress) {
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    try {
      const page = await pdf.getPage(i);
      pages.push(await pageText(page));
      page.cleanup();
    } catch { pages.push(''); }
    if (onProgress && i % 5 === 0) onProgress(i, pdf.numPages);
  }
  return pages;
}

export function isPdfBytes(buf) {
  const u = new Uint8Array(buf, 0, Math.min(1024, buf.byteLength));
  for (let i = 0; i < u.length - 4; i++) {
    if (u[i] === 0x25 && u[i + 1] === 0x50 && u[i + 2] === 0x44 && u[i + 3] === 0x46) return true;
  }
  return false;
}
