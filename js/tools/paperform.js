// Papierformular automatisch ausfüllbar machen: jede Seite wird als Bild angesehen (Scan, Foto oder „flache“ PDF),
// Linien, Kästen und Ankreuzkästchen werden gefunden (js/tools/paperscan.js), Beschriftungen kommen aus der Textebene
// oder – bei Scans – aus der Texterkennung auf dem Gerät. Daraus entstehen echte PDF-Formularfelder.
// Alles läuft offline; nichts verlässt das Gerät.
import { renderPage } from '../pdfcore.js';
import { inkMask, estimateSkew, findShapes, itemsFromWords, fieldsFromShapes, uniqueNames, fixLabel, knownLabel } from './paperscan.js';
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
export async function detectPaperFields(pdf, { ocr = true, maxPages = 20, onProgress, signal, debug = null } = {}) {
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
    let orig = null; // the unturned picture: the text recognition straightens it itself (a second turn confuses it)
    if (skew) {
      orig = canvas;
      const c2 = document.createElement('canvas');
      c2.width = canvas.width; c2.height = canvas.height;
      const g = c2.getContext('2d', { willReadFrequently: true });
      g.fillStyle = '#fff'; g.fillRect(0, 0, c2.width, c2.height);
      g.translate(c2.width / 2, c2.height / 2); g.rotate(-skew * Math.PI / 180); g.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
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
        const r = await recognize(orig || canvas, { lang: 'deu+eng', dpi: s * 72 });
        if (signal && signal.aborted) throw abortErr();
        items = itemsFromWords(orig ? turnWords(r.words, skew, canvas.width, canvas.height) : r.words, s);
        ocrUsed = true;
        // tiny labels inside boxes („PLZ“, „Ort“) are often skipped by the page recognition: read them one by one
        items.push(...await cellLabels(canvas, s, shapes, items, recognize, signal));
        // photos: the page recognition sometimes skips a block next to a dark table edge – read the words in front
        // of write-on lines that have no label yet one by one („Geburtsdatum: ____“)
        items.push(...await lineLabels(canvas, s, shapes, items, recognize, signal));
        items.forEach(it => { it.str = fixLabel(it.str); });
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        console.warn('Texterkennung für Formular', e);
        ocrMissing = true;
      }
    }
    canvas.width = canvas.height = 1; // free the bitmaps
    if (orig) orig.width = orig.height = 1;
    const found = fieldsFromShapes(shapes, items || [], { W, H });
    if (debug) debug.push({ page: n, skew, shapes, items }); // tests: what was seen
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

/** Word boxes of the unturned picture → the straightened picture (turned by −skew around the centre, like the canvas). */
function turnWords(words, skew, w, h) {
  const a = -skew * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a), cx = w / 2, cy = h / 2;
  const t = (x, y) => [cx + (x - cx) * c - (y - cy) * sn, cy + (x - cx) * sn + (y - cy) * c];
  return (words || []).map(wd => {
    if (!wd || !wd.bbox) return wd;
    const b = wd.bbox, pts = [t(b.x0, b.y0), t(b.x1, b.y0), t(b.x0, b.y1), t(b.x1, b.y1)];
    // keep the height of the word (the turned corners would make flat words taller)
    const mx = (Math.min(...pts.map(p => p[0])) + Math.max(...pts.map(p => p[0]))) / 2, my = (Math.min(...pts.map(p => p[1])) + Math.max(...pts.map(p => p[1]))) / 2;
    const hw = (b.x1 - b.x0) / 2, hh = (b.y1 - b.y0) / 2;
    return { ...wd, bbox: { x0: mx - hw, x1: mx + hw, y0: my - hh, y1: my + hh } };
  });
}

/** „Dark“ for a strip of a photo: clearly darker than the strip's own paper (photos are often dim or tinted). */
function darkTest(px) {
  const n = px.length / 4, lum = new Uint8Array(n);
  for (let i = 0; i < n; i++) lum[i] = (px[i * 4] * 77 + px[i * 4 + 1] * 150 + px[i * 4 + 2] * 29) >> 8;
  const sorted = Array.from(lum).sort((a, b) => a - b);
  const paper = sorted[Math.floor(n * 0.75)] || 255;
  const thr = Math.min(paper * 0.72, 200);
  return i => lum[i >> 2] < thr;
}

/** OCR of the strip in front of every write-on line without a label (single line, upscaled). → text items */
async function lineLabels(canvas, s, shapes, items, recognize, signal) {
  const out = [];
  const top = it => (it.top != null ? it.top : it.y - it.size);
  const g0 = canvas.getContext('2d', { willReadFrequently: true });
  // one strip → words (black on white by the strip's own paper, upscaled, read as one line)
  const readStrip = async (x0, y0, wPt, hPt, clipX1) => {
    const sx = Math.round(x0 * s), sy = Math.round(y0 * s), sw = Math.round(wPt * s), sh = Math.round(hPt * s);
    if (sw < 20 || sh < 10 || sx < 0 || sy < 0 || sx + sw > canvas.width || sy + sh > canvas.height) return null;
    const id = g0.getImageData(sx, sy, sw, sh);
    const px = id.data;
    const isDark = darkTest(px);
    // the edge of the sheet / a table next to it: columns that are almost all dark are not letters
    for (let x = 0; x < sw; x++) { let n = 0; for (let y = 0; y < sh; y++) n += isDark((y * sw + x) * 4); if (n > sh * 0.85) for (let y = 0; y < sh; y++) { const i = (y * sw + x) * 4; px[i] = px[i + 1] = px[i + 2] = 255; } }
    let dark = 0;
    for (let i = 0; i < px.length; i += 4) if (isDark(i)) dark++;
    if (dark < 15 || dark > sw * sh * 0.4) return null;
    const lums = [];
    for (let i = 0; i < px.length; i += 4) lums.push((px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8);
    const so = lums.slice().sort((a, b) => a - b);
    const lo = so[Math.floor(so.length * 0.02)], hi = so[Math.floor(so.length * 0.8)];
    // two looks at the strip: grey stretched from the ink to the paper (smooth letter edges), then black and white
    for (const mode of ['grey', 'bw']) {
      const out = new ImageData(sw, sh);
      for (let i = 0, j = 0; i < px.length; i += 4, j++) {
        const v = mode === 'bw' ? (isDark(i) ? 0 : 255) : Math.max(0, Math.min(255, Math.round((lums[j] - lo) * 255 / Math.max(20, hi - lo))));
        out.data[i] = out.data[i + 1] = out.data[i + 2] = v; out.data[i + 3] = 255;
      }
      const k = 3, pad = 12;
      const crop = document.createElement('canvas');
      crop.width = sw * k + pad * 2; crop.height = sh * k + pad * 2;
      const g = crop.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, crop.width, crop.height);
      g.imageSmoothingQuality = 'high';
      const tmp = document.createElement('canvas'); tmp.width = sw; tmp.height = sh;
      tmp.getContext('2d').putImageData(out, 0, 0);
      g.drawImage(tmp, 0, 0, sw, sh, pad, pad, sw * k, sh * k);
      const r = await recognize(crop, { lang: 'deu+eng', psm: '7', preprocess: false, dpi: s * 72 * k });
      if (signal && signal.aborted) throw abortErr();
      const words = (r.words || []).filter(w => /[A-Za-zÄÖÜäöüß]{2}/.test(w.text) && (w.conf >= 45 || knownLabel(w.text)));
      if (!words.length) continue;
      const map = (u, v) => [x0 + (u - pad) / (s * k), y0 + (v - pad) / (s * k)];
      const [ax, ay] = map(Math.min(...words.map(w => w.bbox.x0)), Math.min(...words.map(w => w.bbox.y0)));
      const [bx, by] = map(Math.max(...words.map(w => w.bbox.x1)), Math.max(...words.map(w => w.bbox.y1)));
      return { str: words.map(w => w.text).join(' '), x: ax, x1: clipX1 != null ? Math.min(bx, clipX1) : bx, top: ay, y: by, size: Math.max(5, by - ay) };
    }
    return null;
  };
  for (const l of (shapes.lines || []).slice(0, 24)) {
    if (signal && signal.aborted) throw abortErr();
    const yLo = Math.max(l.y, l.yr != null ? l.yr : l.y);
    const left = items.some(it => it.x1 <= l.x0 + 3 && l.x0 - it.x1 < 170 && Math.abs((top(it) + it.y) / 2 - (l.y - 6)) < 10);
    const below = items.some(it => top(it) >= Math.min(l.y, yLo) - 1 && top(it) - yLo < 12 && it.x < l.x1 && it.x1 > l.x0);
    if (left || below) continue;
    try {
      // the label in front of the line („Geburtsdatum: ____“) …
      let it = l.x0 >= 20 ? await readStrip(Math.max(0, l.x0 - 170), Math.max(0, l.y - 15), l.x0 - 1.5 - Math.max(0, l.x0 - 170), 15, l.x0) : null;
      // … or the caption under it („Ort, Datum“, „Unterschrift“)
      if (!it) it = await readStrip(l.x0, yLo + 1, Math.min(l.x1 - l.x0, 260), 12, null);
      if (it) out.push(it);
    } catch (e) { if (e && e.name === 'AbortError') throw e; }
    await yieldUi();
  }
  return out;
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
