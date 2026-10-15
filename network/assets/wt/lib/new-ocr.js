// OCR for the web tools (ocr-pdf, image-to-text) on top of tesseract.js 6 (vendor/tesseract, same origin,
// loaded lazily only on these pages). Adapted from the FaLe PDF app (js/ocr/engine.js, textlayer.js):
// the same pre-processing (lib/shared/ocr/prep.js in a module worker), the same result shape and the
// same invisible text layer, without the app's own offline-cache logic – the site's service worker keeps
// every vendor file it served (cache first), so OCR works offline after its first use.
//
//   recognize(source, { lang, signal, onProgress, dpi, psm }) → { text, words, lines, paragraphs, width, height, conf }
//   ocrPage(pdfPage, opts) → recognize() result for a rendered pdf.js page + { scale, viewport }
//   addTextLayer(PDFLib, pdfDoc, page, words, toPdf) → number of words written (render mode 3)
import { mapToSource, toPgm, preprocess as prepInline } from './shared/ocr/prep.js';
import { renderPage } from './pdf.js';
import { warmUp } from './sw.js';
import './tt.js';

const BASE = new URL('../vendor/tesseract/', import.meta.url).href;
const LIB_URL = BASE + 'tesseract.min.js';
const WORKER_URL = BASE + 'worker.min.js';
const LANG_URL = BASE + 'lang';
export const MAX_PIXELS = 12e6;
const IDLE_MS = 90000;

// approximate download sizes (bytes) for the notice before the first run
const SIZES = { lib: 63e3, worker: 111e3, core: 3.95e6, deu: 853e3, eng: 1.98e6 };
export const firstUseBytes = lang => SIZES.lib + SIZES.worker + SIZES.core + langList(lang).reduce((s, l) => s + (SIZES[l] || 1e6), 0);

let simd = null;
function simdSupported() {
  if (simd !== null) return simd;
  try { simd = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); }
  catch { simd = false; }
  return simd;
}
const coreUrl = () => BASE + (simdSupported() ? 'core/tesseract-core-simd-lstm.wasm.js' : 'core/tesseract-core-lstm.wasm.js');
const langList = lang => String(lang || 'deu').split('+').filter(l => l === 'deu' || l === 'eng');

const userError = (de, en, extra = {}) => Object.assign(new Error(en), { userMessage: { de, en } }, extra);
const abortError = () => new DOMException('Aborted', 'AbortError');
const offlineError = () => userError(
  'Die Texterkennung braucht beim ersten Mal eine Internetverbindung, um einmalig ihre Sprachdaten zu laden. Danach funktioniert sie auch offline.',
  'Text recognition needs an internet connection the first time to download its language data once. After that it also works offline.', { code: 'offline' });

// ---------------------------------------------------------------- tesseract.js loader
let libPromise = null;
function loadLib() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (libPromise) return libPromise;
  libPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = LIB_URL; // same-origin URL, vouched for by the default Trusted Types policy (lib/tt.js)
    s.async = true;
    s.onload = () => (window.Tesseract ? resolve(window.Tesseract) : reject(userError('Die Texterkennung konnte nicht geladen werden.', 'Text recognition could not be loaded.')));
    s.onerror = () => { libPromise = null; s.remove(); reject(navigator.onLine === false ? offlineError() : userError('Die Texterkennung konnte nicht geladen werden.', 'Text recognition could not be loaded.')); };
    document.head.append(s);
  });
  return libPromise;
}

// ---------------------------------------------------------------- worker pool (1 on phones, 2 on desktops)
export function maxWorkers() {
  try {
    const coarse = matchMedia('(pointer: coarse)').matches;
    const mem = navigator.deviceMemory || 8, cores = navigator.hardwareConcurrency || 2;
    if (coarse || mem <= 4 || cores < 4) return 1;
  } catch { /* defaults */ }
  return 2;
}
const pool = [];
const queue = [];
let idleTimer = 0;

function newEntry(lang) {
  const entry = { lang, busy: false, job: null, dead: false };
  entry.ready = (async () => {
    const T = await loadLib();
    const init = T.createWorker(langList(lang), 1, {
      workerPath: WORKER_URL, corePath: coreUrl(), langPath: LANG_URL, gzip: true,
      cacheMethod: 'none',      // the service worker keeps the files – no second copy in IndexedDB
      workerBlobURL: false,     // same-origin worker script (CSP worker-src 'self', offline via the service worker)
      logger: m => { const j = entry.job; if (j && j.onLog) j.onLog(m); },
      errorHandler: e => console.warn('OCR', e),
    });
    let timer;
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(navigator.onLine === false ? offlineError() : userError('Die Texterkennung konnte nicht gestartet werden (Zeitüberschreitung).', 'Text recognition could not be started (timeout).')), 120000); });
    try { return await Promise.race([init, timeout]); }
    catch (err) { if (err && err.userMessage) throw err; throw navigator.onLine === false ? offlineError() : userError('Die Texterkennung konnte nicht gestartet werden.', 'Text recognition could not be started.', { cause: err }); }
    finally { clearTimeout(timer); }
  })();
  entry.ready.catch(() => { entry.dead = true; });
  pool.push(entry);
  return entry;
}
function drop(entry) {
  entry.dead = true;
  const i = pool.indexOf(entry);
  if (i >= 0) pool.splice(i, 1);
  if (entry.terminated) return; // terminating twice makes tesseract.js post to a worker that is already gone
  entry.terminated = true;
  entry.ready.then(w => w.terminate()).catch(() => {});
}
/** Terminate all OCR workers (frees 100–200 MB). */
export function terminate() { clearTimeout(idleTimer); pool.slice().forEach(drop); }
function armIdle() { clearTimeout(idleTimer); idleTimer = setTimeout(() => { if (!pool.some(e => e.busy) && !queue.length) terminate(); }, IDLE_MS); }

function schedule(lang, task, { signal, onLog } = {}) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) { reject(abortError()); return; }
    const job = { lang, task, resolve, reject, onLog, entry: null, done: false };
    const onAbort = () => cancelJob(job);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    job.cleanup = () => { if (signal) signal.removeEventListener('abort', onAbort); };
    queue.push(job);
    pump();
  });
}
function settle(job, err, value) {
  if (job.done) return;
  job.done = true;
  job.cleanup();
  if (err) job.reject(err); else job.resolve(value);
}
function cancelJob(job) {
  if (job.done) return;
  const qi = queue.indexOf(job);
  if (qi >= 0) queue.splice(qi, 1);
  if (job.entry) drop(job.entry); // a running recognition cannot be stopped – the worker is killed
  settle(job, abortError());
  pump();
}
function pump() {
  clearTimeout(idleTimer);
  for (const e of pool.slice()) if (e.dead && !e.busy) drop(e);
  while (queue.length) {
    const job = queue[0];
    let entry = pool.find(e => !e.busy && !e.dead && e.lang === job.lang);
    if (!entry && pool.length < maxWorkers()) entry = newEntry(job.lang);
    if (!entry) entry = pool.find(e => !e.busy && !e.dead);
    if (!entry) break;
    queue.shift();
    runJob(entry, job);
  }
  if (!pool.some(e => e.busy) && !queue.length) armIdle();
}
async function runJob(entry, job) {
  entry.busy = true; entry.job = job; job.entry = entry;
  try {
    const w = await entry.ready;
    if (job.done) return;
    if (entry.lang !== job.lang) { await w.reinitialize(langList(job.lang), 1); entry.lang = job.lang; }
    if (job.done) return;
    settle(job, null, await job.task(w));
  } catch (e) {
    if (!job.done) { drop(entry); settle(job, e && e.userMessage ? e : userError('Die Texterkennung ist fehlgeschlagen.', 'Text recognition failed.', { cause: e })); }
  } finally {
    entry.busy = false; entry.job = null;
    pump();
  }
}

/** After the first successful run: ask the service worker to keep both languages for offline use. */
let warmed = false;
function warmOffline() {
  if (warmed) return;
  warmed = true;
  const urls = [LIB_URL, WORKER_URL, coreUrl(), `${LANG_URL}/deu.traineddata.gz`, `${LANG_URL}/eng.traineddata.gz`].map(u => new URL(u).pathname);
  setTimeout(() => { warmUp(urls).catch(() => {}); }, 1500);
}

// ---------------------------------------------------------------- pre-processing worker
let prepWorker = null, prepFailed = false, prepSeq = 0;
const prepPending = new Map();
function getPrepWorker() {
  if (prepFailed || typeof Worker === 'undefined') return null;
  if (prepWorker) return prepWorker;
  try {
    prepWorker = new Worker(new URL('./shared/ocr/prep-worker.js', import.meta.url), { type: 'module' });
    prepWorker.onmessage = e => {
      const { id, ok, result, error } = e.data || {};
      const p = prepPending.get(id);
      if (!p) return;
      prepPending.delete(id);
      if (ok) p.resolve(result); else p.reject(new Error(error));
    };
    prepWorker.onerror = e => {
      if (e && e.preventDefault) e.preventDefault();
      prepFailed = true;
      try { prepWorker.terminate(); } catch { /* gone */ }
      prepWorker = null;
      const all = [...prepPending.values()];
      prepPending.clear();
      all.forEach(p => p.retry());
    };
    return prepWorker;
  } catch { prepFailed = true; return null; }
}
function runPrep(image, opts) {
  const inline = () => Promise.resolve().then(() => prepInline(image, opts));
  const wk = getPrepWorker();
  if (!wk) return inline();
  return new Promise((resolve, reject) => {
    const id = ++prepSeq;
    const data = new Uint8ClampedArray(image.data);
    prepPending.set(id, { resolve, reject, retry: () => inline().then(resolve, reject) });
    wk.postMessage({ id, opts, image: { data, width: image.width, height: image.height } }, [data.buffer]);
  });
}

/** Canvas / ImageBitmap / Blob → RGBA ImageData of at most maxPixels (white background). */
export async function toImageData(source, maxPixels = MAX_PIXELS) {
  let bmp = source, close = null;
  if (source instanceof Blob) {
    try { bmp = await createImageBitmap(source, { imageOrientation: 'from-image' }); }
    catch { throw userError('Das Bild konnte nicht gelesen werden.', 'The image could not be read.'); }
    close = () => bmp.close && bmp.close();
  }
  try {
    const w = bmp.width, h = bmp.height;
    if (!w || !h) throw userError('Das Bild ist leer.', 'The image is empty.');
    const f = Math.min(1, Math.sqrt(maxPixels / (w * h)));
    const W = Math.max(1, Math.round(w * f)), H = Math.max(1, Math.round(h * f));
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff';
    g.fillRect(0, 0, W, H);
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, W, H);
    const id = g.getImageData(0, 0, W, H);
    c.width = c.height = 0;
    id.sourceScale = f;
    return id;
  } finally { if (close) close(); }
}

// ---------------------------------------------------------------- result conversion (as in the app)
function convert(data, geo, srcScale = 1) {
  const back = (u, v) => { const [x, y] = mapToSource(geo, u, v); return [x / srcScale, y / srcScale]; };
  const box = b => {
    const pts = [back(b.x0, b.y0), back(b.x1, b.y0), back(b.x0, b.y1), back(b.x1, b.y1)];
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  };
  const k = (geo.scale || 1) * srcScale;
  const words = [], lines = [], paragraphs = [];
  let confSum = 0, confN = 0;
  for (const blk of data.blocks || []) {
    for (const par of blk.paragraphs || []) {
      const para = { text: '', lines: [] };
      for (const ln of par.lines || []) {
        const lw = (ln.words || []).filter(w => w.text && w.text.trim());
        if (!lw.length) continue;
        const bl = ln.baseline && ln.baseline.has_baseline !== false && ln.baseline.x1 > ln.baseline.x0 ? ln.baseline : null;
        const ra = ln.rowAttributes || {};
        const lb = ln.bbox;
        let sizePx = ra.row_height > 0 ? ra.row_height : (lb.y1 - lb.y0) * 0.9;
        if (!(sizePx > 2)) sizePx = Math.max(4, lb.y1 - lb.y0);
        const baseY = x => (bl ? bl.y0 + ((bl.y1 - bl.y0) * (x - bl.x0)) / Math.max(1, bl.x1 - bl.x0) : lb.y1 - Math.max(0, -(ra.descenders || 0)));
        const lineIdx = lines.length;
        const line = { text: '', bbox: box(lb), conf: ln.confidence, words: [] };
        for (const wd of lw) {
          const b = wd.bbox;
          const p0 = back(b.x0, baseY(b.x0)), p1 = back(b.x1, baseY(b.x1));
          const word = { text: wd.text.trim(), bbox: box(b), conf: wd.confidence, baseline: { x0: p0[0], y0: p0[1], x1: p1[0], y1: p1[1] }, size: sizePx / k, line: lineIdx };
          words.push(word);
          line.words.push(word);
          confSum += wd.confidence * word.text.length; confN += word.text.length;
        }
        line.text = line.words.map(w => w.text).join(' ');
        lines.push(line);
        para.lines.push(lineIdx);
      }
      if (para.lines.length) { para.text = para.lines.map(i => lines[i].text).join('\n'); paragraphs.push(para); }
    }
  }
  return { text: paragraphs.map(p => p.text).join('\n\n'), words, lines, paragraphs, conf: confN ? confSum / confN : 0 };
}

const PSM = { auto: '3', block: '6', sparse: '11' };

/**
 * Recognise text in an image.
 * onProgress({ phase: 'prepare'|'load'|'recognize'|'done', progress: 0..1 })
 */
export async function recognize(source, { lang = 'deu', psm = 'auto', signal, onProgress, preprocess = true, dpi = 0 } = {}) {
  const report = (phase, progress) => { if (onProgress) try { onProgress({ phase, progress }); } catch { /* ignore */ } };
  if (signal && signal.aborted) throw abortError();
  report('prepare', 0);
  const img = await toImageData(source, MAX_PIXELS);
  if (signal && signal.aborted) throw abortError();
  const srcScale = img.sourceScale || 1;
  const geo = await runPrep(img, { enhance: preprocess, deskew: preprocess, upscale: preprocess, maxPixels: MAX_PIXELS });
  if (signal && signal.aborted) throw abortError();
  const pgm = new Blob([toPgm(geo.gray, geo.width, geo.height)], { type: 'image/x-portable-graymap' });
  geo.gray = null;
  report('load', 0);
  const data = await schedule(langList(lang).join('+') || 'deu', async w => {
    await w.setParameters({
      tessedit_pageseg_mode: PSM[psm] || '3',
      user_defined_dpi: String(Math.round(dpi ? dpi * (geo.scale || 1) : 300)),
      preserve_interword_spaces: '0',
    });
    return (await w.recognize(pgm, {}, { text: true, blocks: true })).data;
  }, {
    signal,
    onLog: m => {
      const s = String(m.status || '');
      report(/recogniz/i.test(s) ? 'recognize' : 'load', typeof m.progress === 'number' ? m.progress : 0);
    },
  });
  const out = convert(data, geo, srcScale);
  out.width = Math.round(img.width / srcScale);
  out.height = Math.round(img.height / srcScale);
  out.angle = geo.angle || 0;
  report('done', 1);
  warmOffline();
  return out;
}

/** Render scale for OCR: about 300 dpi, at most MAX_PIXELS. */
export const ocrScale = (wPt, hPt, dpi = 300) => Math.min(dpi / 72, Math.sqrt(MAX_PIXELS / Math.max(1, wPt * hPt)));

/** Non-space characters of the existing text layer of a pdf.js page. */
export async function pageTextChars(page) {
  try {
    const tc = await page.getTextContent();
    let n = 0;
    for (const it of tc.items) if (typeof it.str === 'string') n += it.str.replace(/\s+/g, '').length;
    return n;
  } catch { return 0; }
}

/** OCR one pdf.js page (rendered at ~300 dpi incl. /Rotate). */
export async function ocrPage(page, { lang, psm, signal, onProgress } = {}) {
  const base = page.getViewport({ scale: 1 });
  const scale = ocrScale(base.width, base.height);
  const canvas = await renderPage(page, { scale, signal });
  try {
    const r = await recognize(canvas, { lang, psm, signal, onProgress, dpi: 72 * scale });
    r.viewport = page.getViewport({ scale: canvas.width / base.width });
    return r;
  } finally { canvas.width = canvas.height = 0; }
}

// ---------------------------------------------------------------- invisible text layer
const n4 = v => (Math.abs(v) < 1e-6 ? 0 : +v.toFixed(4));
/** Text the font can encode: as is, else without accents, else dropped. */
function encodable(font, text, cache) {
  let out = '';
  for (const ch of String(text || '').normalize('NFC')) {
    if (!cache.has(ch)) {
      let rep = '';
      try { font.encodeText(ch); rep = ch; } catch {
        const map = { '„': '"', '“': '"', '”': '"', '‚': "'", '‘': "'", '’': "'", '–': '-', '—': '-', '…': '...', 'ﬁ': 'fi', 'ﬂ': 'fl' };
        const alt = map[ch] || ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
        try { if (alt && alt !== ch) { font.encodeText(alt); rep = alt; } } catch { rep = ''; }
      }
      cache.set(ch, rep);
    }
    out += cache.get(ch);
  }
  return out;
}

/**
 * Append an invisible text layer (render mode 3) to a pdf-lib page: every word on its baseline with its
 * own text matrix and horizontal scaling, so selection, copy and search highlights match the scan.
 * toPdf(x, y) maps OCR image pixels to PDF user space.
 */
export function addTextLayer(PDFLib, pdfDoc, page, font, words, toPdf) {
  if (!words || !words.length) return 0;
  const { PDFName, PDFArray } = PDFLib;
  const ctx = pdfDoc.context;
  const key = page.node.newFontDictionary('FaleOCR', font.ref);
  const cache = new Map();
  let ops = 'BT 3 Tr\n';
  let n = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i], next = words[i + 1];
    const bl = w.baseline || { x0: w.bbox.x0, y0: w.bbox.y1, x1: w.bbox.x1, y1: w.bbox.y1 };
    let text = encodable(font, w.text, cache).trim();
    if (!text) continue;
    let [ax, ay] = toPdf(bl.x0, bl.y0);
    let [bx, by] = toPdf(bl.x1, bl.y1);
    let dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    if (!(len > 0.3)) continue;
    // nearly horizontal words (slightly skewed scans) are written horizontally on their mean baseline, so
    // text extraction keeps whole words and lines together; steeper ones follow the baseline
    if (dx > 0 && Math.abs(dy) < dx * 0.07) { const my = (ay + by) / 2; ay = my; by = my; dy = 0; len = dx; }
    const c = dx / len, s = dy / len;
    const sizePx = Math.max(2, w.size || (w.bbox.y1 - w.bbox.y0));
    const [ux, uy] = toPdf(bl.x0, bl.y0 - sizePx);
    let fs = Math.abs((ux - ax) * -s + (uy - ay) * c);
    if (!(fs > 0.5)) fs = Math.max(1, (len / Math.max(1, text.length)) * 1.6);
    const natural = font.widthOfTextAtSize(text, fs);
    if (!(natural > 0)) continue;
    const tz = Math.max(5, Math.min(2000, (100 * len) / natural));
    if (next && next.line === w.line) text += ' ';
    ops += `${key.toString()} ${n4(fs)} Tf ${n4(tz)} Tz ${n4(c)} ${n4(s)} ${n4(-s)} ${n4(c)} ${n4(ax)} ${n4(ay)} Tm ${font.encodeText(text).toString()} Tj\n`;
    n++;
  }
  ops += 'ET\n';
  if (!n) return 0;
  const start = ctx.register(ctx.flateStream('q\n'));
  const end = ctx.register(ctx.flateStream('\nQ\n' + ops));
  const KEY = PDFName.of('Contents');
  const raw = page.node.get(KEY);
  const arr = page.node.lookup(KEY);
  if (arr instanceof PDFArray) { arr.insert(0, start); arr.push(end); }
  else if (raw) page.node.set(KEY, ctx.obj([start, raw, end]));
  else page.node.set(KEY, ctx.obj([end]));
  return n;
}

/** Plain text of an OCR result: lines joined, paragraphs separated by a blank line. */
export const resultText = r => (r.paragraphs || []).map(p => p.text).join('\n\n');
