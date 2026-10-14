// Tool: change the page size – A3/A4/A5/Letter/Legal/same as the first page/custom (mm), orientation,
// fit / fill / actual size, extra content scale, centred or top-left, margins and print bleed.
// Lossless: each page keeps its content (text stays text, links keep working); the content stream is
// wrapped in a transformation, /Rotate is baked in, annotation rectangles are moved along.
import { loadPdfLib } from '../lib/pdf.js';
import { frame, mul, invert, apply, clipOps, mm, SHEETS, onePageDoc, savePreview, saveResult, previewSource, selectPages, userError } from '../lib/edit-draw.js';
import { createPreview } from '../lib/edit-preview.js';

/** Target size (portrait/landscape resolved) for a page of visual size W × H. */
export function targetSize(opts, W, H, first) {
  let w, h;
  if (opts.size === 'custom') { w = mm(+opts.cw || 210); h = mm(+opts.ch || 297); }
  else if (opts.size === 'first') { [w, h] = first; return [w, h]; }
  else [w, h] = SHEETS[opts.size] || SHEETS.a4;
  const land = opts.orient === 'landscape' || (opts.orient === 'auto' && W > H);
  const port = opts.orient === 'portrait' || (opts.orient === 'auto' && W <= H);
  if ((land && w < h) || (port && w > h)) [w, h] = [h, w];
  return [w, h];
}

/** Placement of the visual page content on the new page: {s, tx, ty, NW, NH, b, area} */
export function layout(opts, W, H, first) {
  const [NW, NH] = targetSize(opts, W, H, first);
  const b = mm(Math.max(0, +opts.bleed || 0));
  const m = Math.min(mm(Math.max(0, +opts.margin || 0)), NW / 3, NH / 3);
  const fillBleed = opts.fit === 'fill' && b > 0;
  const ax = fillBleed ? 0 : b + m, ay = fillBleed ? 0 : b + m;
  const aw = fillBleed ? NW + 2 * b : NW - 2 * m, ah = fillBleed ? NH + 2 * b : NH - 2 * m;
  let s0 = opts.fit === 'fill' ? Math.max(aw / W, ah / H) : opts.fit === 'actual' ? 1 : Math.min(aw / W, ah / H);
  const s = s0 * Math.max(0.05, (+opts.scale || 100) / 100);
  const cw = W * s, ch = H * s;
  const tx = opts.center === false ? ax : ax + (aw - cw) / 2;
  const ty = opts.center === false ? ay + ah - ch : ay + (ah - ch) / 2;
  return { s, tx, ty, NW, NH, b, area: { x: ax, y: ay, width: aw, height: ah } };
}

function bbox(M, x0, y0, x1, y1) {
  const pts = [apply(M, x0, y0), apply(M, x1, y0), apply(M, x0, y1), apply(M, x1, y1)];
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function resizePage(doc, page, PDFLib, opts, first) {
  const { PDFName, PDFArray, PDFNumber, PDFContentStream, pushGraphicsState, popGraphicsState, concatTransformationMatrix, degrees } = PDFLib;
  const f = frame(page);
  const L = layout(opts, f.W, f.H, first);
  // old PDF space → visual-up → new page
  const M = mul([L.s, 0, 0, L.s, L.tx, L.ty], invert(f.m));
  const startOps = [pushGraphicsState()];
  if (opts.fit !== 'fit' || +opts.scale > 100) startOps.push(...clipOps(PDFLib, { x: 0, y: 0, width: L.NW + 2 * L.b, height: L.NH + 2 * L.b }));
  startOps.push(concatTransformationMatrix(...M), ...clipOps(PDFLib, f.box));
  const ctx = doc.context;
  const start = ctx.register(PDFContentStream.of(ctx.obj({}), startOps));
  const end = ctx.register(PDFContentStream.of(ctx.obj({}), [popGraphicsState()]));
  page.node.normalizedEntries();
  const contents = page.node.Contents();
  if (contents instanceof PDFArray) { contents.insert(0, start); contents.push(end); }
  else page.node.set(PDFName.of('Contents'), ctx.obj([start, end]));
  // annotations follow the content
  const annots = page.node.Annots();
  if (annots instanceof PDFArray) {
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookup(i);
      if (!a || typeof a.get !== 'function') continue;
      const rect = a.lookup(PDFName.of('Rect'));
      if (rect instanceof PDFArray && rect.size() === 4) {
        const v = rect.asArray().map(n => n.asNumber?.() ?? 0);
        a.set(PDFName.of('Rect'), ctx.obj(bbox(M, v[0], v[1], v[2], v[3]).map(n => PDFNumber.of(Math.round(n * 100) / 100))));
      }
      const qp = a.lookup(PDFName.of('QuadPoints'));
      if (qp instanceof PDFArray) {
        const v = qp.asArray().map(n => n.asNumber?.() ?? 0);
        const out = [];
        for (let k = 0; k + 1 < v.length; k += 2) out.push(...apply(M, v[k], v[k + 1]));
        a.set(PDFName.of('QuadPoints'), ctx.obj(out.map(n => PDFNumber.of(Math.round(n * 100) / 100))));
      }
    }
  }
  const TW = L.NW + 2 * L.b, TH = L.NH + 2 * L.b;
  page.setRotation(degrees(0));
  page.setMediaBox(0, 0, TW, TH);
  page.setCropBox(0, 0, TW, TH);
  page.setBleedBox(0, 0, TW, TH);
  page.setTrimBox(L.b, L.b, L.NW, L.NH);
  page.node.delete(PDFName.of('ArtBox'));
  return L;
}

function firstSize(doc) {
  const f = frame(doc.getPage(0));
  return [f.W, f.H];
}

let pv = null;
const source = previewSource();
const SIZES = [
  { value: 'a4', label: 'A4 (210 × 297 mm)' },
  { value: 'a3', label: 'A3 (297 × 420 mm)' },
  { value: 'a5', label: 'A5 (148 × 210 mm)' },
  { value: 'letter', label: 'Letter (8,5 × 11 in)' },
  { value: 'legal', label: 'Legal (8,5 × 14 in)' },
  { value: 'first', label: { de: 'Wie die erste Seite', en: 'Same as the first page' } },
  { value: 'custom', label: { de: 'Eigene Größe …', en: 'Custom size …' } },
];
const mmCheck = (v, lang) => (v === '' || !(+v >= 10 && +v <= 5000) ? (lang === 'en' ? 'Between 10 and 5000 mm.' : 'Zwischen 10 und 5000 mm.') : '');

export default {
  options: [
    { id: 'size', type: 'select', default: 'a4', label: { de: 'Neue Seitengröße', en: 'New page size' }, choices: SIZES },
    { id: 'cw', type: 'number', default: 210, min: 10, max: 5000, step: 1, unit: 'mm', when: v => v.size === 'custom', label: { de: 'Breite', en: 'Width' }, validate: mmCheck },
    { id: 'ch', type: 'number', default: 297, min: 10, max: 5000, step: 1, unit: 'mm', when: v => v.size === 'custom', label: { de: 'Höhe', en: 'Height' }, validate: mmCheck },
    {
      id: 'orient', type: 'radio', default: 'auto', when: v => v.size !== 'first', label: { de: 'Ausrichtung', en: 'Orientation' },
      choices: [
        { value: 'auto', label: { de: 'Automatisch', en: 'Automatic' }, hint: { de: 'Querformat bleibt quer', en: 'Landscape stays landscape' } },
        { value: 'portrait', label: { de: 'Hochformat', en: 'Portrait' } },
        { value: 'landscape', label: { de: 'Querformat', en: 'Landscape' } },
      ],
    },
    {
      id: 'fit', type: 'radio', default: 'fit', label: { de: 'Inhalt', en: 'Content' },
      choices: [
        { value: 'fit', label: { de: 'Einpassen', en: 'Fit' }, hint: { de: 'Alles sichtbar, ggf. Rand', en: 'All visible, may leave a border' } },
        { value: 'fill', label: { de: 'Ausfüllen', en: 'Fill' }, hint: { de: 'Seite voll, Ränder werden abgeschnitten', en: 'Page filled, edges are cut off' } },
        { value: 'actual', label: { de: 'Originalgröße', en: 'Actual size' }, hint: { de: 'Nicht skalieren', en: 'No scaling' } },
      ],
    },
    { id: 'scale', type: 'range', default: 100, min: 25, max: 200, step: 5, unit: '%', label: { de: 'Inhalt zusätzlich skalieren', en: 'Scale content further' } },
    { id: 'center', type: 'toggle', default: true, label: { de: 'Inhalt zentrieren', en: 'Centre the content' }, hint: { de: 'Aus: oben links ausrichten', en: 'Off: align to the top left' } },
    { id: 'margin', type: 'range', default: 0, min: 0, max: 40, step: 1, unit: 'mm', label: { de: 'Rand', en: 'Margin' } },
    { id: 'bleed', type: 'range', default: 0, min: 0, max: 10, step: 1, unit: 'mm', label: { de: 'Beschnittzugabe (für Druckereien)', en: 'Bleed (for print shops)' },
      hint: { de: 'Macht die Seite rundum größer und setzt die TrimBox auf das Endformat. Mit „Ausfüllen“ reicht der Inhalt in den Beschnitt.', en: 'Makes the page larger all round and sets the TrimBox to the final size. With “Fill” the content extends into the bleed.' } },
    {
      id: 'scope', type: 'select', default: 'all', label: { de: 'Welche Seiten?', en: 'Which pages?' },
      choices: [
        { value: 'all', label: { de: 'Alle Seiten', en: 'All pages' } },
        { value: 'range', label: { de: 'Bestimmte Seiten', en: 'Certain pages' } },
      ],
    },
    { id: 'pages', type: 'pages', default: '', when: v => v.scope === 'range', label: { de: 'Seitenbereich', en: 'Page range' } },
  ],

  mountStage(stage, state, ctx) {
    pv = createPreview(stage, {
      lang: ctx.lang, state, sticky: true,
      async build(index, values, signal) {
        const PDFLib = await loadPdfLib();
        const src = await source(state.inputs.find(i => !i.error && !i.locked));
        if (signal.aborted) return null;
        const doc = await onePageDoc(PDFLib, src, index);
        let sel;
        try { sel = selectPages(values.scope, values.pages, src.getPageCount(), ctx.parsePages); } catch { sel = new Set([index]); }
        if (values.size === 'custom' && (mmCheck(values.cw) || mmCheck(values.ch))) return savePreview(doc);
        let msg = null;
        if (sel.has(index)) {
          const L = resizePage(doc, doc.getPage(0), PDFLib, values, firstSize(src));
          const pct = Math.round(L.s * 100);
          msg = { de: `Inhalt auf ${pct} % skaliert · ${Math.round(L.NW / 72 * 25.4)} × ${Math.round(L.NH / 72 * 25.4)} mm`, en: `Content scaled to ${pct} % · ${Math.round(L.NW / 72 * 25.4)} × ${Math.round(L.NH / 72 * 25.4)} mm` };
        } else msg = { de: 'Diese Seite bleibt unverändert.', en: 'This page stays unchanged.' };
        pv.setWarning(null);
        status.textContent = msg[ctx.lang] || msg.de;
        return savePreview(doc);
      },
    });
    const status = document.createElement('p');
    status.className = 'ed-hint';
    pv.extra.append(status);
  },

  onInputs() { pv?.reset(); },

  async run(inputs, opts, ctx) {
    if (opts.size === 'custom' && (mmCheck(opts.cw) || mmCheck(opts.ch))) throw userError('Gib Breite und Höhe zwischen 10 und 5000 mm ein.', 'Enter a width and height between 10 and 5000 mm.');
    const PDFLib = await loadPdfLib();
    const outputs = [];
    for (const input of inputs) {
      ctx.progress(0, { de: 'PDF wird geöffnet …', en: 'Opening PDF …' });
      const doc = await input.pdfDoc();
      const n = doc.getPageCount();
      const first = firstSize(doc);
      const sel = [...selectPages(opts.scope, opts.pages, n, ctx.parsePages)];
      let annots = 0;
      for (let k = 0; k < sel.length; k++) {
        const page = doc.getPage(sel[k]);
        if (page.node.Annots()?.size?.()) annots++;
        resizePage(doc, page, PDFLib, opts, first);
        if (k % 10 === 9) { ctx.progress(k / sel.length * 0.9, { de: `Seite ${k + 1} von ${sel.length}`, en: `Page ${k + 1} of ${sel.length}` }); await ctx.tick(); }
      }
      if (annots) ctx.note({ de: 'Links und Kommentare wurden mitverschoben. Formularfelder auf gedrehten Seiten können danach falsch ausgerichtet sein.', en: 'Links and comments were moved along. Form fields on rotated pages may be misaligned afterwards.' });
      ctx.progress(0.95, { de: 'Wird gespeichert …', en: 'Saving …' });
      await ctx.tick();
      const bytes = await saveResult(doc, ctx);
      const label = opts.size === 'custom' ? `${opts.cw}x${opts.ch} mm` : opts.size === 'first' ? (ctx.lang === 'en' ? 'same size' : 'einheitlich') : opts.size.toUpperCase().replace('LETTER', 'Letter').replace('LEGAL', 'Legal');
      outputs.push({ name: ctx.fileName(input.name, ` (${label})`, 'pdf'), blob: new Blob([bytes], { type: 'application/pdf' }), pages: n });
    }
    return { outputs };
  },
};
