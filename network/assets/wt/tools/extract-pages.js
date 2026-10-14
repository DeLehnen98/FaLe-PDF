// Tool: extract pages – pick pages (tap or ranges) and get them as one new PDF or one PDF per page.
import { loadPdfLib } from '../lib/pdf.js';
import { parsePages, formatPages } from '../lib/ranges.js';
import { el } from '../lib/dom.js';
import { baseName } from '../lib/format.js';
import { PageStage, rearrange, copyToNew, saveLike, pdfBlob, shellText, userError, selectedPages } from '../lib/org-common.js';

let stage = null;
let lastText = '';

function sync(fromGrid) {
  if (!stage?.input) return;
  const n = stage.items.length;
  const sel = selectedPages(stage);
  const de = stage.lang === 'de';
  stage.tb.bar.classList.toggle('is-active', sel.length > 0);
  stage.info([
    sel.length ? (de ? `${sel.length} ${sel.length === 1 ? 'Seite' : 'Seiten'} ausgewählt` : `${sel.length} ${sel.length === 1 ? 'page' : 'pages'} selected`) : (de ? 'Tippe die Seiten an, die du brauchst' : 'Tap the pages you need'),
    el('small', {}, de ? `von ${n} Seiten` : `of ${n} pages`),
  ]);
  stage.tb.btn('none').disabled = !sel.length;
  if (fromGrid) { lastText = formatPages(sel); shellText('pages', lastText); }
}

function select(fn) {
  stage.grid.setSelected(stage.items.filter((it, i) => fn(i, it)).map(it => it.id));
  sync(true);
}

function applyText(text) {
  lastText = text;
  if (!stage?.input) return;
  let idx = [];
  try { idx = text.trim() ? parsePages(text, stage.items.length, { unique: true }) : []; } catch { return; }
  const set = new Set(idx);
  stage.grid.setSelected(stage.items.filter((it, i) => set.has(i)).map(it => it.id));
  sync(false);
}

export default {
  options: [
    {
      id: 'pages', type: 'pages', default: '',
      label: { de: 'Seiten', en: 'Pages' },
      placeholder: { de: 'z. B. 1-3, 7', en: 'e.g. 1-3, 7' },
      hint: { de: 'Wird beim Antippen ausgefüllt. Eigene Reihenfolge? Tippe z. B. „5, 1-3“.', en: 'Filled in as you tap. Want your own order? Type e.g. “5, 1-3”.' },
    },
    {
      id: 'output', type: 'radio', default: 'one',
      label: { de: 'Ergebnis', en: 'Result' },
      choices: [
        { value: 'one', label: { de: 'Eine PDF', en: 'One PDF' }, hint: { de: 'Alle ausgewählten Seiten in einer Datei', en: 'All selected pages in one file' } },
        { value: 'each', label: { de: 'Eine PDF pro Seite', en: 'One PDF per page' }, hint: { de: 'Einzelne Dateien, zusammen als ZIP', en: 'Separate files, also as a ZIP' } },
      ],
    },
  ],

  mountStage(host, state, ctx) {
    stage = new PageStage(host, ctx, {
      mode: 'select',
      buttons: [
        { id: 'all', icon: 'all', label: ctx.t({ de: 'Alle auswählen', en: 'Select all' }), short: ctx.t({ de: 'Alle', en: 'All' }), onClick: () => select(() => true) },
        { id: 'odd', icon: 'odd', label: ctx.t({ de: 'Ungerade Seiten auswählen', en: 'Select odd pages' }), short: ctx.t({ de: 'Ungerade', en: 'Odd' }), onClick: () => select(i => i % 2 === 0) },
        { id: 'even', icon: 'even', label: ctx.t({ de: 'Gerade Seiten auswählen', en: 'Select even pages' }), short: ctx.t({ de: 'Gerade', en: 'Even' }), onClick: () => select(i => i % 2 === 1) },
        { id: 'invert', icon: 'invert', label: ctx.t({ de: 'Auswahl umkehren', en: 'Invert selection' }), onClick: () => select((i, it) => !stage.grid.selected.has(it.id)) },
        { id: 'none', icon: 'none', label: ctx.t({ de: 'Auswahl aufheben', en: 'Clear selection' }), onClick: () => select(() => false) },
      ],
      grid: { ariaLabel: ctx.t({ de: 'Seiten – antippen zum Auswählen', en: 'Pages – tap to select' }), onSelect: () => sync(true) },
      onLoad: () => applyText(state.values.pages || ''),
    });
  },

  async onInputs(inputs) { if (stage) await stage.setInputs(inputs); },
  onOptionsChange(values) { if (values.pages !== lastText) applyText(values.pages || ''); },

  async run(inputs, opts, ctx) {
    const input = inputs[0];
    const PDFLib = await loadPdfLib();
    const doc = await input.pdfDoc();
    const n = doc.getPageCount();
    if (!String(opts.pages || '').trim()) throw userError('Wähle zuerst die Seiten aus, die du herauslösen möchtest.', 'First select the pages you want to extract.');
    const idx = ctx.parsePages(opts.pages, n);
    const base = baseName(input.name);
    const de = ctx.lang === 'de';
    if (opts.output === 'each') {
      const outputs = [];
      const width = String(n).length;
      for (let k = 0; k < idx.length; k++) {
        ctx.progress(k / idx.length, { de: `Seite ${k + 1} von ${idx.length}`, en: `Page ${k + 1} of ${idx.length}` });
        const out = await copyToNew(PDFLib, doc, [idx[k]]);
        const bytes = await saveLike(out, input, ctx);
        const num = String(idx[k] + 1).padStart(width, '0');
        outputs.push({ name: `${base} – ${de ? 'Seite' : 'page'} ${num}.pdf`, blob: pdfBlob(bytes), pages: 1 });
        await ctx.tick();
      }
      return { outputs };
    }
    ctx.progress(0.4, { de: `${idx.length} Seiten werden übernommen …`, en: `Copying ${idx.length} pages …` });
    await ctx.tick();
    const pages = doc.getPages();
    rearrange(doc, PDFLib, idx.map(i => ({ page: pages[i] })));
    const bytes = await saveLike(doc, input, ctx);
    const label = idx.length <= 6 ? `${de ? 'S.' : 'p.'} ${formatPages(idx)}` : `${idx.length} ${de ? 'Seiten' : 'pages'}`;
    return { outputs: [{ name: ctx.safeFileName(`${base} (${label}).pdf`), blob: pdfBlob(bytes), pages: idx.length }] };
  },
};
