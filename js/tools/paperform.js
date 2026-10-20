// Papierformular automatisch ausfüllbar machen: jede Seite wird als Bild angesehen (Scan, Foto oder „flache“ PDF),
// Linien, Kästen und Ankreuzkästchen werden gefunden (js/tools/paperscan.js), Beschriftungen kommen aus der Textebene
// oder – bei Scans – aus der Texterkennung auf dem Gerät. Daraus entstehen echte PDF-Formularfelder.
// Alles läuft offline; nichts verlässt das Gerät.
import { renderPage } from '../pdfcore.js';
import { inkMask, estimateSkew, findShapes, itemsFromWords, fieldsFromShapes, uniqueNames, fixLabel } from './paperscan.js';
import { detectFields as detectOnPage, writeFields } from './formfields.js';

const yieldUi = () => new Promise(r => setTimeout(r, 0));
const abortErr = () => Object.assign(new Error('Abgebrochen'), { name: 'AbortError' });

/** Text items of a page from its text layer (points, viewport@1) – null when the page has (almost) no text. */
export async function textItems(page, base) {
  let tc;
  try { tc = await page.getTextContent(); } catch { return null; }
  const items = [];
  let chars = 0;
  for (const it of tc.items) {
    if (typeof it.str !== 'string' || !it.str.trim()) continue;
    const [a, b, c, d, e, f] = it.transform;
    if (Math.abs(b) > Math.abs(a) * 0.2) continue;
    const size = Math.hypot(c, d) || it.height || 10;
    const [x, y] = base.convertToViewportPoint(e, f);
    const [x2] = base.convertToViewportPoint(e + (it.width || 0) * (a / (Math.hypot(a, b) || 1)), f);
    chars += it.str.replace(/\s+/g, '').length;
    items.push({ str: it.str, x: Math.min(x, x2), x1: Math.max(x, x2), y: y + size * 0.2, top: y - size * 0.8, size });
  }
  return chars >= 20 ? items : null;
}

/**
 * Find form fields on every page.
 * @param {object} pdf  pdf.js document
 * @param {{ocr?: boolean, maxPages?: number, onProgress?: Function, signal?: AbortSignal}} opts
 *   onProgress({page, total, phase: 'look'|'ocr'})
 * @returns {Promise<{fields: Array, pages: Array<{page, base}>, ocrUsed: boolean, ocrMissing: boolean}>}
 */
export async function detectPaperFields(pdf, { ocr = true, maxPages = 20, onProgress, signal } = {}) {
  const total = Math.min(pdf.numPages, maxPages);
  const pages = [];
  const fields = [];
  let ocrUsed = false, ocrMissing = false;
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    pages.push({ page, base: page.getViewport({ scale: 1 }) });
  }
  for (let n = 1; n <= total; n++) {
    if (signal && signal.aborted) throw abortErr();
    const { page, base } = pages[n - 1];
    onProgress && onProgress({ page: n, total, phase: 'look' });
    const W = base.width, H = base.height;
    const s0 = Math.min(2.2, Math.sqrt(4.5e6 / Math.max(1, W * H)));
    let canvas = await renderPage(page, { scale: s0 });
    const s = canvas.width / W;
    let ctx = canvas.getContext('2d', { willReadFrequently: true });
    let img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    await yieldUi();
    let mask = inkMask(img.data, canvas.width, canvas.height);
    await yieldUi();
    // scans are often a little crooked: straighten the picture first (fields are mapped back afterwards)
    const skew = estimateSkew(mask, canvas.width, canvas.height);
    if (skew) {
      const c2 = document.createElement('canvas');
      c2.width = canvas.width; c2.height = canvas.height;
      const g = c2.getContext('2d', { willReadFrequently: true });
      g.fillStyle = '#fff'; g.fillRect(0, 0, c2.width, c2.height);
      g.translate(c2.width / 2, c2.height / 2); g.rotate(-skew * Math.PI / 180); g.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
      canvas.width = canvas.height = 1;
      canvas = c2; ctx = g;
      img = g.getImageData(0, 0, c2.width, c2.height);
      mask = inkMask(img.data, c2.width, c2.height);
      await yieldUi();
    }
    img = null;
    const shapes = findShapes(mask, canvas.width, canvas.height, s);
    await yieldUi();
    let items = await textItems(page, base);
    const hasText = !!items;
    if (!items && ocr && (shapes.lines.length || shapes.cells.length || shapes.checks.length)) {
      onProgress && onProgress({ page: n, total, phase: 'ocr' });
      try {
        const { recognize } = await import('../ocr/engine.js');
        // no signal for the OCR itself: cancelling would kill the OCR worker mid-job; the search stops right after it
        const r = await recognize(canvas, { lang: 'deu+eng', dpi: s * 72 });
        if (signal && signal.aborted) throw abortErr();
        items = itemsFromWords(r.words, s);
        ocrUsed = true;
        // tiny labels inside boxes („PLZ“, „Ort“) are often skipped by the page recognition: read them one by one
        items.push(...await cellLabels(canvas, s, shapes, items, recognize, signal));
        items.forEach(it => { it.str = fixLabel(it.str); });
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        console.warn('Texterkennung für Formular', e);
        ocrMissing = true;
      }
    }
    canvas.width = canvas.height = 1; // free the bitmap
    const found = fieldsFromShapes(shapes, items || [], { W, H });
    if (skew) {
      // straightened picture → page: turn each field's centre back around the page centre
      const a = skew * Math.PI / 180, cx = W / 2, cy = H / 2;
      for (const f of found) {
        const mx = f.x + f.w / 2 - cx, my = f.y + f.h / 2 - cy;
        const nx = mx * Math.cos(a) - my * Math.sin(a), ny = mx * Math.sin(a) + my * Math.cos(a);
        f.x = Math.max(0, Math.min(W - f.w, nx + cx - f.w / 2)); f.y = Math.max(0, Math.min(H - f.h, ny + cy - f.h / 2));
      }
    }
    // born-digital pages: "Name: ______" and "Label:" with empty space (text-based rules of the form tool)
    if (hasText) {
      try {
        const extra = await detectOnPage(page, base, { shapes: null });
        for (const f of extra) {
          const ov = found.some(o => Math.max(0, Math.min(o.x + o.w, f.x + f.w) - Math.max(o.x, f.x)) * Math.max(0, Math.min(o.y + o.h, f.y + f.h) - Math.max(o.y, f.y)) > 0.3 * Math.min(o.w * o.h, f.w * f.h));
          if (!ov) found.push({ type: f.type, x: f.x, y: f.y, w: f.w, h: f.h, name: f.name });
        }
      } catch (e) { console.warn(e); }
    }
    found.forEach(f => fields.push({ ...f, page: n, required: false, def: f.type === 'check' ? false : '' }));
    await yieldUi();
  }
  uniqueNames(fields);
  return { fields, pages, ocrUsed, ocrMissing };
}

/** OCR of the label strip at the top of every box that has no text yet (upscaled, single line). → text items */
async function cellLabels(canvas, s, shapes, items, recognize, signal) {
  const out = [];
  const g0 = canvas.getContext('2d', { willReadFrequently: true });
  for (const c of shapes.cells.slice(0, 30)) {
    if (signal && signal.aborted) throw abortErr();
    const has = items.some(it => it.x < c.x1 && it.x1 > c.x0 && it.y > c.y0 && (it.top != null ? it.top : it.y - it.size) < c.y1);
    if (has) continue;
    const x0 = c.x0 + 1.5, y0 = c.y0 + 1, wPt = Math.min(c.x1 - c.x0 - 3, 140), hPt = Math.min(c.y1 - c.y0 - 2, 12);
    const sx = Math.round(x0 * s), sy = Math.round(y0 * s), sw = Math.round(wPt * s), sh = Math.round(hPt * s);
    if (sw < 12 || sh < 8) continue;
    // empty strip → nothing to read
    const id = g0.getImageData(sx, sy, sw, sh);
    const px = id.data;
    const isDark = i => px[i] + px[i + 1] + px[i + 2] < 360;
    // remove remains of the box border (rows/columns that are mostly ink) so they are not read as letters
    for (let y = 0; y < sh; y++) { let n = 0; for (let x = 0; x < sw; x++) n += isDark((y * sw + x) * 4); if (n > sw * 0.5) for (let x = 0; x < sw; x++) { const i = (y * sw + x) * 4; px[i] = px[i + 1] = px[i + 2] = 255; } }
    for (let x = 0; x < sw; x++) { let n = 0; for (let y = 0; y < sh; y++) n += isDark((y * sw + x) * 4); if (n > sh * 0.7) for (let y = 0; y < sh; y++) { const i = (y * sw + x) * 4; px[i] = px[i + 1] = px[i + 2] = 255; } }
    let dark = 0;
    for (let i = 0; i < px.length; i += 4) if (isDark(i)) dark++;
    if (dark < 12 || dark > sw * sh * 0.35) continue;
    const k = 3, pad = 12;
    const crop = document.createElement('canvas');
    crop.width = sw * k + pad * 2; crop.height = sh * k + pad * 2;
    const g = crop.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, crop.width, crop.height);
    g.imageSmoothingQuality = 'high';
    const tmp = document.createElement('canvas'); tmp.width = sw; tmp.height = sh;
    tmp.getContext('2d').putImageData(id, 0, 0);
    g.drawImage(tmp, 0, 0, sw, sh, pad, pad, sw * k, sh * k);
    try {
      const r = await recognize(crop, { lang: 'deu+eng', psm: '7', deskew: false, dpi: s * 72 * k });
      if (signal && signal.aborted) throw abortErr();
      const words = (r.words || []).filter(w => w.conf >= 50 && /[A-Za-zÄÖÜäöüß]{2}/.test(w.text));
      if (!words.length) continue;
      const map = (u, v) => [x0 + (u - pad) / (s * k), y0 + (v - pad) / (s * k)];
      const [ax, ay] = map(Math.min(...words.map(w => w.bbox.x0)), Math.min(...words.map(w => w.bbox.y0)));
      const [bx, by] = map(Math.max(...words.map(w => w.bbox.x1)), Math.max(...words.map(w => w.bbox.y1)));
      out.push({ str: words.map(w => w.text).join(' '), x: ax, x1: bx, top: ay, y: by, size: Math.max(5, by - ay) });
    } catch (e) { if (e && e.name === 'AbortError') throw e; }
    await yieldUi();
  }
  return out;
}

/** Write the found fields into a copy of the PDF → bytes. */
export async function makeFillable(pdfDoc, PDFLib, fields, pages) {
  await writeFields(PDFLib, pdfDoc, fields, pages);
  return pdfDoc;
}
