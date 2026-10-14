// PDF pages → JPG or PNG images (shared implementation of the tools pdf-to-jpg and pdf-to-png).
//   - page selection, resolution 72–600 dpi with a live size estimate in the bottom bar
//   - JPEG quality, PNG with transparent background (where the PDF has no own white background)
//   - the dpi is written into the files (JFIF density / PNG pHYs), so they print at the right size
//   - one page → the image directly, several → one image per page (+ "Alle als ZIP" in the shell)
import { canvasScaleCap } from './shared/limits.js';
import { PAGES_OPTION, coarsePointer, imageGridPreview, fail } from './conv-common.js';
import { formatSize } from './format.js';
import { parsePages } from './ranges.js';

const MAX_PIXELS_TOUCH = 16e6;   // mobile browsers refuse larger canvases (iOS: 16.7 MP)
const MAX_PIXELS = 36e6;

const pad = (n, total) => String(n).padStart(String(total).length < 2 ? 2 : String(total).length, '0');

/** Render one pdf.js page at `scale` into a canvas; transparent → no background fill. */
export async function renderRaster(page, scale, { transparent = false, signal = null } = {}) {
  const base = page.getViewport({ scale: 1 });
  const cap = coarsePointer() ? MAX_PIXELS_TOUCH : MAX_PIXELS;
  const s = scale * canvasScaleCap(base.width * scale, base.height * scale, cap);
  const vp = page.getViewport({ scale: s });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  const ctx = canvas.getContext('2d', { alpha: transparent });
  if (!transparent) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  const task = page.render({ canvasContext: ctx, canvas, viewport: vp, background: transparent ? 'rgba(0,0,0,0)' : '#ffffff' });
  const abort = () => task.cancel();
  signal?.addEventListener('abort', abort);
  try { await task.promise; } finally { signal?.removeEventListener('abort', abort); }
  return { canvas, scale: s, capped: s < scale * 0.999 };
}

export function toBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), type, quality));
}

/** Write the resolution into a JPEG (JFIF APP0 density) – returns new bytes (or the input). */
export function setJpegDpi(bytes, dpi) {
  const b = bytes;
  const d = Math.max(1, Math.min(65535, Math.round(dpi)));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b[3] === 0xe0 && b[6] === 0x4a && b[7] === 0x46 && b[8] === 0x49 && b[9] === 0x46 && b[10] === 0) {
    const out = b.slice();
    out[13] = 1; out[14] = d >> 8; out[15] = d & 255; out[16] = d >> 8; out[17] = d & 255;
    return out;
  }
  // no JFIF segment: insert one after SOI
  const app0 = [0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1, d >> 8, d & 255, d >> 8, d & 255, 0, 0];
  const out = new Uint8Array(b.length + app0.length);
  out.set(b.subarray(0, 2), 0); out.set(app0, 2); out.set(b.subarray(2), 2 + app0.length);
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** Insert/replace a pHYs chunk (pixels per metre) right after IHDR. */
export function setPngDpi(bytes, dpi) {
  const b = bytes;
  if (!(b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)) return bytes;
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // pHYs
  dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  // walk chunks: drop an existing pHYs, insert after IHDR
  const parts = [b.subarray(0, 8)];
  let i = 8;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  while (i + 8 <= b.length) {
    const len = view.getUint32(i);
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    const end = i + 12 + len;
    if (end > b.length) return bytes;
    if (type !== 'pHYs') parts.push(b.subarray(i, end));
    if (type === 'IHDR') parts.push(chunk);
    i = end;
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** The tool module (format: 'jpeg' | 'png'). */
export function makeRasterTool(format) {
  const isJpeg = format === 'jpeg';
  const ext = isJpeg ? 'jpg' : 'png';
  const mime = isJpeg ? 'image/jpeg' : 'image/png';
  const est = { key: '', bpp: 0, pages: 0, w: 0, h: 0, busy: false, timer: 0 };
  let last = { quality: 85, transparent: false };

  const options = [
    { ...PAGES_OPTION, when: (v, inputs) => inputs.length <= 1 },
    {
      id: 'dpi', type: 'range', min: 72, max: 600, step: 6, default: 150, unit: 'dpi',
      label: { de: 'Auflösung', en: 'Resolution' },
      hint: {
        de: '72–100 dpi: Bildschirm und Messenger · 150 dpi: gute Allround-Qualität · 300 dpi: Druck · 600 dpi: sehr feine Details (große Dateien)',
        en: '72–100 dpi: screens and messengers · 150 dpi: good all-round quality · 300 dpi: print · 600 dpi: very fine detail (large files)',
      },
      format: v => `${v} dpi`,
    },
  ];
  if (isJpeg) {
    options.push({
      id: 'quality', type: 'range', min: 50, max: 100, step: 5, default: 85, unit: '%',
      label: { de: 'JPG-Qualität', en: 'JPG quality' },
      hint: { de: '85 % ist kaum vom Original zu unterscheiden. Weniger = kleinere Dateien.', en: '85 % is hard to tell from the original. Lower = smaller files.' },
      format: v => `${v} %`,
    });
  } else {
    options.push({
      id: 'transparent', type: 'toggle', default: false,
      label: { de: 'Transparenter Hintergrund', en: 'Transparent background' },
      hint: { de: 'Leere Flächen werden durchsichtig – praktisch für Logos und Grafiken. Hat die PDF selbst einen weißen Hintergrund, bleibt er weiß.', en: 'Empty areas become see-through – handy for logos and graphics. If the PDF itself has a white background, it stays white.' },
    });
  }

  async function measure(inputs, ctx) {
    const values = last;
    const input = inputs[0];
    if (!input || input.kind !== 'pdf' || input.locked) return;
    const key = `${input.id}|${isJpeg ? values.quality : values.transparent}`;
    if (est.key === key || est.busy) return;
    est.busy = true;
    try {
      const doc = await input.pdfjs();
      const page = await doc.getPage(1);
      const vp = page.getViewport({ scale: 1 });
      est.w = vp.width; est.h = vp.height;
      const { canvas } = await renderRaster(page, 96 / 72, { transparent: !isJpeg && values.transparent });
      page.cleanup();
      const blob = await toBlob(canvas, mime, isJpeg ? values.quality / 100 : undefined);
      est.bpp = blob.size / (canvas.width * canvas.height);
      canvas.width = canvas.height = 0;
      est.key = key;
    } catch { est.key = ''; } finally { est.busy = false; }
    ctx?.refresh?.();
  }

  return {
    options,
    get shareFirst() { return coarsePointer(); },

    onInputs(inputs, ctx) { est.key = ''; clearTimeout(est.timer); measure(inputs, ctx); },
    onOptionsChange(values, inputs, ctx) {
      last = { quality: values.quality, transparent: values.transparent };
      clearTimeout(est.timer);
      est.timer = setTimeout(() => measure(inputs, ctx), 300);
    },
    status(values, inputs, lang) {
      if (inputs.length !== 1 || !est.bpp || !inputs[0]._pages) return null;
      const input = inputs[0];
      let n = input._pages;
      try { if (String(values.pages || '').trim()) n = parsePagesCount(values.pages, input._pages); } catch { return null; }
      const s = values.dpi / 72;
      const w = Math.round(est.w * s), h = Math.round(est.h * s);
      // larger renders compress a bit better – a mild correction keeps the estimate honest
      const bpp = est.bpp * Math.pow(96 / Math.max(96, values.dpi), 0.35);
      const bytes = n * w * h * bpp;
      const size = formatSize(bytes, lang);
      return {
        summary: lang === 'de'
          ? `${n} ${n === 1 ? 'Bild' : 'Bilder'} · ${w} × ${h} px · ca. ${size}`
          : `${n} ${n === 1 ? 'image' : 'images'} · ${w} × ${h} px · approx. ${size}`,
      };
    },

    async run(inputs, opts, ctx) {
      const dpi = Math.max(72, Math.min(600, Number(opts.dpi) || 150));
      const quality = Math.max(0.3, Math.min(1, (Number(opts.quality) || 85) / 100));
      const transparent = !isJpeg && !!opts.transparent;
      // all pages to do, over all files
      const jobs = [];
      for (const input of inputs) {
        const doc = await input.pdfjs();
        const idx = inputs.length === 1 ? ctx.parsePages(opts.pages, doc.numPages) : Array.from({ length: doc.numPages }, (_, i) => i);
        for (const i of idx) jobs.push({ input, doc, i });
      }
      if (!jobs.length) fail('Keine Seiten ausgewählt.', 'No pages selected.');
      const outputs = [];
      let capped = 0;
      const seen = new Map();
      for (let k = 0; k < jobs.length; k++) {
        const { input, doc, i } = jobs[k];
        ctx.progress(k / jobs.length, { de: `Seite ${k + 1} von ${jobs.length}`, en: `Page ${k + 1} of ${jobs.length}` });
        const page = await doc.getPage(i + 1);
        const { canvas, scale, capped: c } = await renderRaster(page, dpi / 72, { transparent, signal: ctx.signal });
        page.cleanup();
        if (c) capped++;
        await ctx.tick();
        const blob = await toBlob(canvas, mime, isJpeg ? quality : undefined);
        const realDpi = scale * 72;
        canvas.width = canvas.height = 0;
        let bytes = new Uint8Array(await blob.arrayBuffer());
        bytes = isJpeg ? setJpegDpi(bytes, realDpi) : setPngDpi(bytes, realDpi);
        const word = ctx.lang === 'de' ? 'Seite' : 'page';
        let name = ctx.fileName(input.name, `-${word}-${pad(i + 1, doc.numPages)}`, ext);
        if (jobs.length === 1) name = ctx.fileName(input.name, '', ext);
        const dup = seen.get(name) || 0;
        seen.set(name, dup + 1);
        if (dup) name = name.replace(/(\.\w+)$/, ` (${dup + 1})$1`);
        outputs.push({ name, blob: new Blob([bytes], { type: mime }), meta: { label: (ctx.lang === 'de' ? 'Seite ' : 'Page ') + (i + 1) } });
        await ctx.tick();
      }
      if (capped) ctx.note({
        de: `Bei ${capped === 1 ? 'einer Seite' : `${capped} Seiten`} wurde die Auflösung verringert – so große Bilder kann dieses Gerät nicht erzeugen.`,
        en: `The resolution was reduced for ${capped === 1 ? 'one page' : `${capped} pages`} – this device can’t create images that large.`,
      });
      if (transparent) ctx.note({ de: 'Flächen, die in der PDF selbst weiß gefüllt sind, bleiben weiß.', en: 'Areas that the PDF itself fills with white stay white.' });
      return { outputs };
    },

    onResult(result, res, ctx) { imageGridPreview(result, res, ctx); },
  };
}

function parsePagesCount(text, count) { return parsePages(text, count).length; }
