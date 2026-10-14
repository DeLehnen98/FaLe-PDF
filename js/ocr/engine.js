// Offline OCR engine on top of tesseract.js (vendor/tesseract, loaded lazily, same origin only).
//
//   recognize(source, { lang, psm, onProgress, signal, preprocess })
//     source: Blob | File | ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas | ImageData
//     → { text, lines:[{text,bbox,conf,words,baseline,size}], words:[{text,bbox,conf,baseline,size,line}],
//         paragraphs:[{text,bbox,lines}], width, height, angle, conf }
//     All boxes are {x0,y0,x1,y1} in pixels of the source image (y down).
//
//   ocrPdfPages(pdfBytes, { pages, lang, psm, onProgress, signal, skipText })
//     → [{ page, text, words, lines, paragraphs, width, height, scale, skipped }]
//     width/height/boxes are pixels of the page render at `scale` (pdf.js viewport incl. /Rotate).
//
// Workers are reused (1 on phones, up to 2 on desktops) and terminated after a minute idle.
// Recognition runs in tesseract's web worker, image pre-processing in prep-worker.js.
import { LIB_URL, WORKER_URL, LANG_URL, coreUrl, canRunNow, approxBytes, mbLabel } from './assets.js';
import { mapToSource, toPgm, preprocess as prepInline } from './prep.js';
import { assertImageBlob } from '../security.js';

export const LANGS = [
  { id: 'deu+eng', label: 'Deutsch + Englisch' },
  { id: 'deu', label: 'Deutsch' },
  { id: 'eng', label: 'Englisch' },
];
export const PSMS = [
  { id: 'auto', label: 'Automatisch', value: '3' },
  { id: 'block', label: 'Einzelner Textblock', value: '6' },
  { id: 'sparse', label: 'Spärlicher Text', value: '11' },
];
export const MAX_PIXELS = 12e6;
const IDLE_MS = 60000;

function ocrError(msg, extra = {}) { return Object.assign(new Error(msg), { userMessage: msg }, extra); }
function abortError() {
  try { return new DOMException('Abgebrochen', 'AbortError'); } catch { return Object.assign(new Error('Abgebrochen'), { name: 'AbortError' }); }
}
export const isAbort = e => !!e && e.name === 'AbortError';
const langList = lang => String(lang || 'deu+eng').split('+').filter(Boolean);

// ------------------------------------------------------------------ tesseract.js loader
let libPromise = null;
function loadLib() {
  if (typeof window !== 'undefined' && window.Tesseract) return Promise.resolve(window.Tesseract);
  if (libPromise) return libPromise;
  libPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = LIB_URL;
    s.async = true;
    s.onload = () => (window.Tesseract ? resolve(window.Tesseract) : reject(ocrError('Die Texterkennung konnte nicht geladen werden.')));
    s.onerror = () => { libPromise = null; s.remove(); reject(ocrError('Die Texterkennung konnte nicht geladen werden. Für den ersten Start wird einmalig eine Internetverbindung gebraucht.')); };
    document.head.appendChild(s);
  });
  return libPromise;
}

// ------------------------------------------------------------------ worker pool
const pool = []; // {lang, busy, job, ready: Promise<worker>, dead}
const queue = [];
let idleTimer = null;

export function maxWorkers() {
  try {
    const coarse = matchMedia('(pointer: coarse)').matches && matchMedia('(max-width: 1024px)').matches;
    const mem = navigator.deviceMemory || 8, cores = navigator.hardwareConcurrency || 2;
    if (coarse || mem <= 4 || cores < 4) return 1;
  } catch {}
  return 2;
}

function newEntry(lang) {
  const entry = { lang, busy: false, job: null, dead: false };
  entry.ready = (async () => {
    const T = await loadLib();
    const init = T.createWorker(langList(lang), 1, {
      workerPath: WORKER_URL,
      corePath: coreUrl(),
      langPath: LANG_URL,
      gzip: true,
      cacheMethod: 'none', // the service worker keeps the files (no second copy in IndexedDB)
      workerBlobURL: false, // same-origin worker script → controlled by the service worker (offline)
      logger: m => { const j = entry.job; if (j && j.onLog) j.onLog(m); },
      errorHandler: e => console.warn('OCR', e),
    });
    let t;
    const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(ocrError('Die Texterkennung konnte nicht gestartet werden (Zeitüberschreitung).')), 120000); });
    try { return await Promise.race([init, timeout]); } finally { clearTimeout(t); }
  })();
  entry.ready.catch(() => { entry.dead = true; });
  pool.push(entry);
  return entry;
}

function drop(entry) {
  entry.dead = true;
  const i = pool.indexOf(entry);
  if (i >= 0) pool.splice(i, 1);
  entry.ready.then(w => w.terminate()).catch(() => {});
}

function armIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!pool.some(e => e.busy) && !queue.length) terminate(); }, IDLE_MS);
}

/** Terminate all OCR workers (frees ~100–200 MB). */
export function terminate() {
  clearTimeout(idleTimer);
  pool.slice().forEach(drop);
}

function schedule(lang, task, { signal, onLog } = {}) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) { reject(abortError()); return; }
    const job = { lang, task, resolve, reject, signal, onLog, entry: null, done: false };
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
  if (job.entry) drop(job.entry); // tesseract cannot cancel a running job: kill that worker
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
    run(entry, job);
  }
  if (!pool.some(e => e.busy) && !queue.length) armIdle();
}

async function run(entry, job) {
  entry.busy = true; entry.job = job; job.entry = entry;
  try {
    const w = await entry.ready;
    if (job.done) return;
    if (entry.lang !== job.lang) {
      await w.reinitialize(langList(job.lang), 1);
      entry.lang = job.lang;
    }
    if (job.done) return;
    const r = await job.task(w);
    settle(job, null, r);
  } catch (e) {
    if (!job.done) {
      // a failing worker is not reused
      drop(entry);
      settle(job, e && e.userMessage ? e : ocrError('Die Texterkennung ist fehlgeschlagen.', { cause: e }));
    }
  } finally {
    entry.busy = false; entry.job = null;
    pump();
  }
}

// ------------------------------------------------------------------ pre-processing worker
let prepWorker = null, prepFailed = false, prepSeq = 0;
const prepPending = new Map();
function getPrepWorker() {
  if (prepFailed || typeof Worker === 'undefined') return null;
  if (prepWorker) return prepWorker;
  try {
    prepWorker = new Worker(new URL('./prep-worker.js', import.meta.url), { type: 'module' });
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
      try { prepWorker.terminate(); } catch {}
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
    const data = new Uint8ClampedArray(image.data); // copy: the transferred buffer is gone afterwards
    prepPending.set(id, { resolve, reject, retry: () => inline().then(resolve, reject) });
    wk.postMessage({ id, opts, image: { data, width: image.width, height: image.height } }, [data.buffer]);
  });
}

// ------------------------------------------------------------------ input decoding
/** Any supported source → {data, width, height} (RGBA), at most maxPixels. */
export async function toImageData(source, maxPixels = MAX_PIXELS) {
  if (typeof ImageData !== 'undefined' && source instanceof ImageData) {
    if (source.width * source.height <= maxPixels) return source;
    const c = document.createElement('canvas');
    c.width = source.width; c.height = source.height;
    c.getContext('2d').putImageData(source, 0, 0);
    try { return await toImageData(c, maxPixels); } finally { c.width = c.height = 0; }
  }
  let bmp = source, close = null;
  if (typeof Blob !== 'undefined' && source instanceof Blob) {
    await assertImageBlob(source); // dimension bombs are rejected before decoding
    try { bmp = await createImageBitmap(source, { imageOrientation: 'from-image' }); }
    catch {
      const url = URL.createObjectURL(source);
      try {
        bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(ocrError('Das Bild konnte nicht gelesen werden (Format nicht unterstützt?).')); i.src = url; });
      } finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
    }
    close = () => { if (bmp.close) bmp.close(); };
  }
  try {
    const w = bmp.naturalWidth || bmp.videoWidth || bmp.width, h = bmp.naturalHeight || bmp.videoHeight || bmp.height;
    if (!w || !h) throw ocrError('Das Bild ist leer.');
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
    id.sourceScale = f; // < 1 when the input was larger than maxPixels
    return id;
  } finally { if (close) close(); }
}

// ------------------------------------------------------------------ result conversion
function phaseOf(status) {
  if (/core|initializ|api/i.test(status)) return 'load';
  if (/language|traineddata/i.test(status)) return 'lang';
  if (/recogniz/i.test(status)) return 'recognize';
  return 'load';
}

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
  (data.blocks || []).forEach((blk, bi) => {
    (blk.paragraphs || []).forEach(par => {
      const pIdx = paragraphs.length;
      const para = { text: '', bbox: box(par.bbox), lines: [], block: bi };
      paragraphs.push(para);
      (par.lines || []).forEach(ln => {
        const lw = (ln.words || []).filter(w => w.text && w.text.trim());
        if (!lw.length) return;
        const bl = ln.baseline && ln.baseline.has_baseline !== false && ln.baseline.x1 > ln.baseline.x0 ? ln.baseline : null;
        const ra = ln.rowAttributes || {};
        const lb = ln.bbox;
        // font size (px of the pre-processed image): row height without the space above ascenders
        let sizePx = ra.row_height > 0 ? ra.row_height : (lb.y1 - lb.y0) * 0.9;
        if (!(sizePx > 2)) sizePx = Math.max(4, lb.y1 - lb.y0);
        const baseY = x => {
          if (bl) return bl.y0 + ((bl.y1 - bl.y0) * (x - bl.x0)) / Math.max(1, bl.x1 - bl.x0);
          return lb.y1 - Math.max(0, -(ra.descenders || 0));
        };
        const lineIdx = lines.length;
        const line = { text: '', bbox: box(lb), conf: ln.confidence, words: [], par: pIdx, size: sizePx / k };
        const s0 = back(lb.x0, baseY(lb.x0)), s1 = back(lb.x1, baseY(lb.x1));
        line.baseline = { x0: s0[0], y0: s0[1], x1: s1[0], y1: s1[1] };
        lw.forEach(wd => {
          const b = wd.bbox;
          const p0 = back(b.x0, baseY(b.x0)), p1 = back(b.x1, baseY(b.x1));
          const word = {
            text: wd.text.trim(), bbox: box(b), conf: wd.confidence,
            baseline: { x0: p0[0], y0: p0[1], x1: p1[0], y1: p1[1] },
            size: sizePx / k, line: lineIdx, par: pIdx,
          };
          words.push(word);
          line.words.push(word);
          confSum += wd.confidence * word.text.length; confN += word.text.length;
        });
        line.text = line.words.map(w => w.text).join(' ');
        lines.push(line);
        para.lines.push(lineIdx);
      });
      para.text = para.lines.map(i => lines[i].text).join('\n');
    });
  });
  const cleanParas = paragraphs.filter(p => p.lines.length);
  const text = cleanParas.map(p => p.text).join('\n\n');
  return { text, words, lines, paragraphs: cleanParas, conf: confN ? confSum / confN : 0 };
}

// ------------------------------------------------------------------ public API
/**
 * Recognize text in an image.
 * @param {Blob|ImageBitmap|HTMLCanvasElement|ImageData|HTMLImageElement} source
 * @param {{lang?: string, psm?: 'auto'|'block'|'sparse'|string, onProgress?: Function, signal?: AbortSignal,
 *          preprocess?: boolean, deskew?: boolean, dpi?: number}} [opts]
 * onProgress({phase: 'prepare'|'load'|'lang'|'recognize'|'done', progress: 0..1, message})
 */
export async function recognize(source, { lang = 'deu+eng', psm = 'auto', onProgress, signal, preprocess = true, deskew = true, dpi = 0 } = {}) {
  const report = (phase, progress, message) => { if (onProgress) try { onProgress({ phase, progress, message }); } catch {} };
  if (signal && signal.aborted) throw abortError();
  const check = await canRunNow(langList(lang));
  if (!check.ok) {
    throw ocrError(`Die Texterkennung braucht beim ersten Mal eine Internetverbindung, um einmalig ca. ${mbLabel(approxBytes(langList(lang)))} Sprachdaten zu laden. Danach funktioniert sie auch offline.`, { code: 'offline' });
  }
  report('prepare', 0, 'Bild wird vorbereitet …');
  const img = await toImageData(source, MAX_PIXELS);
  if (signal && signal.aborted) throw abortError();
  const srcScale = img.sourceScale || 1;
  const geo = await runPrep(img, { enhance: preprocess, deskew: preprocess && deskew, upscale: preprocess, maxPixels: MAX_PIXELS });
  if (signal && signal.aborted) throw abortError();
  const pgm = new Blob([toPgm(geo.gray, geo.width, geo.height)], { type: 'image/x-portable-graymap' });
  geo.gray = null;
  const psmValue = (PSMS.find(p => p.id === psm) || {}).value || (/^\d+$/.test(String(psm)) ? String(psm) : '3');
  report('load', 0, 'Texterkennung wird gestartet …');
  const data = await schedule(lang, async w => {
    await w.setParameters({
      tessedit_pageseg_mode: psmValue,
      user_defined_dpi: String(Math.round(dpi ? dpi * (geo.scale || 1) : 300)),
      preserve_interword_spaces: '0',
    });
    const r = await w.recognize(pgm, {}, { text: true, blocks: true });
    return r.data;
  }, {
    signal,
    onLog: m => {
      const ph = phaseOf(m.status || '');
      report(ph, typeof m.progress === 'number' ? m.progress : 0,
        ph === 'recognize' ? 'Text wird erkannt …' : ph === 'lang' ? 'Sprachdaten werden geladen …' : 'Texterkennung wird gestartet …');
    },
  });
  const out = convert(data, geo, srcScale);
  out.width = Math.round(img.width / srcScale);
  out.height = Math.round(img.height / srcScale);
  out.angle = geo.angle || 0;
  report('done', 1, 'Fertig');
  return out;
}

/** Render scale for OCR: ~300 dpi, at most MAX_PIXELS pixels. */
export function ocrScale(widthPt, heightPt, dpi = 300) {
  return Math.min(dpi / 72, Math.sqrt(MAX_PIXELS / Math.max(1, widthPt * heightPt)));
}

/** Count real (non-space) text characters on a pdf.js page. */
export async function pageTextChars(page) {
  try {
    const tc = await page.getTextContent();
    let n = 0;
    for (const it of tc.items) if (typeof it.str === 'string') n += it.str.replace(/\s+/g, '').length;
    return n;
  } catch { return 0; }
}

/**
 * OCR pages of a PDF.
 * @param {Uint8Array|ArrayBuffer} pdfBytes  (or {pdf} – an open pdf.js document)
 * @param {{pages?: number[], lang?: string, psm?: string, onProgress?: Function, signal?: AbortSignal, skipText?: boolean}} opts
 * onProgress({page, index, total, phase, progress, eta (s|null), message})
 */
export async function ocrPdfPages(pdfBytes, { pages = null, lang = 'deu+eng', psm = 'auto', onProgress, signal, skipText = false, minChars = 20 } = {}) {
  const { loadPdf, renderPage } = await import('../pdfcore.js');
  let pdf, own = false;
  if (pdfBytes && pdfBytes.numPages && pdfBytes.getPage) pdf = pdfBytes;
  else { ({ pdf } = await loadPdf(pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes))); own = true; }
  const list = (pages && pages.length ? pages : Array.from({ length: pdf.numPages }, (_, i) => i + 1)).filter(n => n >= 1 && n <= pdf.numPages);
  const out = [];
  const t0 = Date.now();
  let doneOcr = 0;
  try {
    for (let k = 0; k < list.length; k++) {
      if (signal && signal.aborted) throw abortError();
      const num = list[k];
      const page = await pdf.getPage(num);
      const base = page.getViewport({ scale: 1, rotation: page.rotate });
      if (skipText && await pageTextChars(page) >= minChars) {
        out.push({ page: num, text: '', words: [], lines: [], paragraphs: [], width: base.width, height: base.height, scale: 1, skipped: true });
        page.cleanup();
        continue;
      }
      const scale = ocrScale(base.width, base.height);
      const eta = () => (doneOcr ? Math.round(((Date.now() - t0) / doneOcr) * (list.length - k) / 1000) : null);
      const tell = (phase, progress, message) => { if (onProgress) try { onProgress({ page: num, index: k, total: list.length, phase, progress, eta: eta(), message }); } catch {} };
      tell('render', 0, `Seite ${num} wird gerendert …`);
      const canvas = await renderPage(page, { scale });
      let r;
      try {
        r = await recognize(canvas, { lang, psm, signal, dpi: 72 * scale, onProgress: p => tell(p.phase, p.progress, p.message) });
      } finally { canvas.width = canvas.height = 0; page.cleanup(); }
      out.push({ page: num, ...r, scale, skipped: false });
      doneOcr++;
      tell('done', 1, '');
    }
  } finally { if (own) try { pdf.destroy(); } catch {} }
  return out;
}
