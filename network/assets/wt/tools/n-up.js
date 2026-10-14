// Tool: several pages per sheet (n-up) – 2/4/6/8/9/16 per sheet, sheet size and orientation (auto picks
// the one that gives bigger pages), reading order, margins, gaps, frame lines, page range. Pages are
// embedded as vector XObjects (text stays sharp), drawn upright (/Rotate and CropBox respected).
import { loadPdfLib } from '../lib/pdf.js';
import { mm, SHEETS, embedSourcePages, drawEmbedded, frame, savePreview, previewSource, saveResult, selectPages, userError } from '../lib/edit-draw.js';
import { createPreview } from '../lib/edit-preview.js';

export function gridFor(per, landscape) {
  const g = { 2: [2, 1], 4: [2, 2], 6: [3, 2], 8: [4, 2], 9: [3, 3], 16: [4, 4] }[per] || [2, 2];
  return landscape ? g : [g[1], g[0]];
}

/** Sheet geometry: {SW, SH, cols, rows, cellW, cellH, m, gap} */
export function sheetLayout(opts, pageW, pageH) {
  const per = +opts.per || 4;
  let [w, h] = opts.sheet === 'auto' ? [pageW, pageH] : (SHEETS[opts.sheet] || SHEETS.a4);
  if (w > h) [w, h] = [h, w];
  const m = mm(Math.max(0, +opts.margin || 0)), gap = mm(Math.max(0, +opts.gap || 0));
  const calc = land => {
    const [SW, SH] = land ? [h, w] : [w, h];
    const [cols, rows] = gridFor(per, land);
    const cellW = (SW - 2 * m - (cols - 1) * gap) / cols, cellH = (SH - 2 * m - (rows - 1) * gap) / rows;
    const s = Math.min(cellW / pageW, cellH / pageH);
    return { SW, SH, cols, rows, cellW, cellH, m, gap, s, per };
  };
  if (opts.orient === 'portrait') return calc(false);
  if (opts.orient === 'landscape') return calc(true);
  const a = calc(false), b = calc(true);
  return b.s > a.s * 1.001 ? b : a;
}

/** Cell (col, row) of the k-th page on a sheet for the reading order. */
export function cellOf(k, L, order) {
  if (order === 'col') return [Math.floor(k / L.rows), k % L.rows];
  const row = Math.floor(k / L.cols), col = k % L.cols;
  return [order === 'row-rtl' ? L.cols - 1 - col : col, row];
}

async function buildSheets(out, src, PDFLib, indices, opts, { only = null, tick = null } = {}) {
  const pages = src.getPages();
  const f0 = frame(pages[indices[0]]);
  const L = sheetLayout(opts, f0.W, f0.H);
  const sheets = Math.ceil(indices.length / L.per);
  const { rgb } = PDFLib;
  for (let sh = 0; sh < sheets; sh++) {
    if (only != null && sh !== only) continue;
    const chunk = indices.slice(sh * L.per, (sh + 1) * L.per);
    const items = await embedSourcePages(out, src, chunk);
    const page = out.addPage([L.SW, L.SH]);
    items.forEach((it, k) => {
      const [col, row] = cellOf(k, L, opts.order);
      const cx = L.m + col * (L.cellW + L.gap), cy = L.SH - L.m - (row + 1) * L.cellH - row * L.gap;
      const s = Math.min(L.cellW / it.W, L.cellH / it.H);
      const w = it.W * s, h = it.H * s;
      const tx = cx + (L.cellW - w) / 2, ty = cy + (L.cellH - h) / 2;
      drawEmbedded(page, PDFLib, it, s, tx, ty);
      if (opts.frame) page.drawRectangle({ x: tx, y: ty, width: w, height: h, borderColor: rgb(0.55, 0.55, 0.6), borderWidth: 0.6 });
    });
    if (tick && sh % 4 === 3) await tick(sh, sheets);
  }
  return { sheets, L };
}

let pv = null;
const source = previewSource();

function chosen(src, opts, parse) {
  return [...selectPages(opts.scope, opts.pages, src.getPageCount(), parse)];
}

export default {
  options: [
    {
      id: 'per', type: 'radio', default: 4, label: { de: 'Seiten pro Blatt', en: 'Pages per sheet' },
      choices: [2, 4, 6, 8, 9, 16].map(n => ({ value: n, label: String(n) })),
    },
    {
      id: 'sheet', type: 'select', default: 'a4', label: { de: 'Blattgröße', en: 'Sheet size' },
      choices: [
        { value: 'a4', label: 'A4' }, { value: 'a3', label: 'A3' }, { value: 'letter', label: 'Letter' }, { value: 'legal', label: 'Legal' },
        { value: 'auto', label: { de: 'Wie die Originalseiten', en: 'Same as the original pages' } },
      ],
    },
    {
      id: 'orient', type: 'radio', default: 'auto', label: { de: 'Ausrichtung', en: 'Orientation' },
      choices: [
        { value: 'auto', label: { de: 'Automatisch', en: 'Automatic' }, hint: { de: 'Größtmögliche Seiten', en: 'Largest possible pages' } },
        { value: 'portrait', label: { de: 'Hochformat', en: 'Portrait' } },
        { value: 'landscape', label: { de: 'Querformat', en: 'Landscape' } },
      ],
    },
    {
      id: 'order', type: 'select', default: 'row', label: { de: 'Reihenfolge', en: 'Order' },
      choices: [
        { value: 'row', label: { de: 'Zeilenweise (links → rechts, dann runter)', en: 'By rows (left → right, then down)' } },
        { value: 'col', label: { de: 'Spaltenweise (oben → unten, dann rechts)', en: 'By columns (top → bottom, then right)' } },
        { value: 'row-rtl', label: { de: 'Zeilenweise von rechts nach links', en: 'By rows, right to left' } },
      ],
    },
    { id: 'margin', type: 'range', default: 8, min: 0, max: 25, step: 1, unit: 'mm', label: { de: 'Rand des Blatts', en: 'Sheet margin' } },
    { id: 'gap', type: 'range', default: 4, min: 0, max: 20, step: 1, unit: 'mm', label: { de: 'Abstand zwischen den Seiten', en: 'Gap between pages' } },
    { id: 'frame', type: 'toggle', default: true, label: { de: 'Rahmen um jede Seite', en: 'Frame around each page' } },
    {
      id: 'scope', type: 'select', default: 'all', label: { de: 'Welche Seiten?', en: 'Which pages?' },
      choices: [{ value: 'all', label: { de: 'Alle Seiten', en: 'All pages' } }, { value: 'range', label: { de: 'Bestimmte Seiten', en: 'Certain pages' } }],
    },
    { id: 'pages', type: 'pages', default: '', when: v => v.scope === 'range', label: { de: 'Seiten in dieser Reihenfolge', en: 'Pages in this order' } },
  ],

  mountStage(stage, state, ctx) {
    const input = () => state.inputs.find(i => !i.error && !i.locked);
    const safe = (src, v) => { try { return chosen(src, v, ctx.parsePages); } catch { return chosen(src, { scope: 'all' }, ctx.parsePages); } };
    pv = createPreview(stage, {
      lang: ctx.lang, state, sticky: true,
      label: (i, n, lang) => (lang === 'en' ? `Sheet ${i + 1} of ${n}` : `Blatt ${i + 1} von ${n}`),
      async count() {
        const src = await source(input());
        return Math.max(1, Math.ceil(safe(src, pv.values()).length / (+pv.values().per || 4)));
      },
      async build(index, values, signal) {
        const PDFLib = await loadPdfLib();
        const src = await source(input());
        if (signal.aborted) return null;
        const out = await PDFLib.PDFDocument.create();
        await buildSheets(out, src, PDFLib, safe(src, values), values, { only: index });
        return savePreview(out);
      },
    });
  },

  onInputs() { pv?.reset(); },

  async run(inputs, opts, ctx) {
    const PDFLib = await loadPdfLib();
    const outputs = [];
    for (const input of inputs) {
      ctx.progress(0, { de: 'PDF wird geöffnet …', en: 'Opening PDF …' });
      const src = await input.pdfDoc();
      const idx = chosen(src, opts, ctx.parsePages);
      if (!idx.length) throw userError('Keine Seite ausgewählt.', 'No page selected.');
      const out = await PDFLib.PDFDocument.create();
      const r = await buildSheets(out, src, PDFLib, idx, opts, {
        tick: async (i, n) => { ctx.progress(i / n * 0.9, { de: `Blatt ${i + 1} von ${n}`, en: `Sheet ${i + 1} of ${n}` }); await ctx.tick(); },
      });
      ctx.note({ de: 'Links und Formularfelder der Originalseiten sind im Ergebnis nicht mehr anklickbar – Text und Grafiken bleiben scharf.', en: 'Links and form fields of the original pages are no longer clickable in the result – text and graphics stay sharp.' });
      ctx.progress(0.95, { de: 'Wird gespeichert …', en: 'Saving …' });
      await ctx.tick();
      out.wtPassword = src.wtPassword || null;
      const bytes = await saveResult(out, ctx, { title: src.getTitle?.() || null });
      outputs.push({ name: ctx.fileName(input.name, ctx.lang === 'en' ? ` (${opts.per} per sheet)` : ` (${opts.per} pro Blatt)`, 'pdf'), blob: new Blob([bytes], { type: 'application/pdf' }), pages: r.sheets,
        note: { de: `${idx.length} Seiten auf ${r.sheets} Blatt`, en: `${idx.length} pages on ${r.sheets} sheet${r.sheets === 1 ? '' : 's'}` } });
    }
    return { outputs };
  },
};
