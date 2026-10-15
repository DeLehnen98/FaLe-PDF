// Tool: delete pages from a PDF – tap thumbnails (or type ranges) to mark pages, the rest is kept.
// Removed pages are really gone (also from bookmarks, forms and the structure tree, then garbage-collected).
import { loadPdfLib } from '../lib/pdf.js';
import { parsePages, formatPages } from '../lib/ranges.js';
import { el } from '../lib/dom.js';
import { PageStage, rearrange, saveLike, pdfBlob, shellText, userError, inputHint, selectedPages } from '../lib/org-common.js';

let stage = null;
let lastText = '';

function sync(fromGrid) {
  if (!stage?.input) return;
  const n = stage.items.length;
  const sel = selectedPages(stage);
  const L = stage.lang === 'de';
  const left = n - sel.length;
  stage.tb.bar.classList.toggle('is-active', sel.length > 0);
  stage.info([
    sel.length ? (L ? `${sel.length} zum Löschen markiert` : `${sel.length} marked for deletion`) : (L ? 'Tippe Seiten an, die weg sollen' : 'Tap the pages you want to remove'),
    el('small', {}, left === 0 ? (L ? 'Mindestens eine Seite muss bleiben' : 'At least one page has to stay') : (L ? `${left} von ${n} Seiten bleiben` : `${left} of ${n} pages stay`)),
  ]);
  stage.tb.btn('none').disabled = !sel.length;
  if (fromGrid) { lastText = formatPages(sel); shellText('pages', lastText); }
}

function select(fn) {
  stage.grid.setSelected(stage.items.filter((it, i) => fn(i, it)).map(it => it.id));
  sync(true);
}

export default {
  options: [
    {
      id: 'pages', type: 'pages', default: '',
      label: { de: 'Zu löschende Seiten', en: 'Pages to delete' },
      placeholder: { de: 'z. B. 2, 5-7', en: 'e.g. 2, 5-7' },
      hint: { de: 'Wird beim Antippen der Seiten automatisch ausgefüllt – oder tippe selbst.', en: 'Filled in as you tap pages – or type it yourself.' },
    },
  ],

  mountStage(host, state, ctx) {
    stage = new PageStage(host, ctx, {
      mode: 'select', mark: 'delete',
      buttons: [
        { id: 'odd', icon: 'odd', label: ctx.t({ de: 'Ungerade Seiten markieren', en: 'Mark odd pages' }), short: ctx.t({ de: 'Ungerade', en: 'Odd' }), onClick: () => select(i => i % 2 === 0) },
        { id: 'even', icon: 'even', label: ctx.t({ de: 'Gerade Seiten markieren', en: 'Mark even pages' }), short: ctx.t({ de: 'Gerade', en: 'Even' }), onClick: () => select(i => i % 2 === 1) },
        { id: 'invert', icon: 'invert', label: ctx.t({ de: 'Markierung umkehren', en: 'Invert marks' }), onClick: () => select((i, it) => !stage.grid.selected.has(it.id)) },
        { id: 'none', icon: 'none', label: ctx.t({ de: 'Alle Markierungen aufheben', en: 'Clear all marks' }), onClick: () => select(() => false) },
      ],
      hint: { de: 'Tipp: Mit gedrückter Umschalttaste wählst du am Computer ganze Bereiche aus.', en: 'Tip: on a computer, hold Shift to mark a whole range.' },
      grid: { ariaLabel: ctx.t({ de: 'Seiten – antippen zum Löschen markieren', en: 'Pages – tap to mark for deletion' }), onSelect: () => sync(true) },
      onLoad: () => { applyText(state.values.pages || ''); },
    });
  },

  async onInputs(inputs) { if (stage) await stage.setInputs(inputs); },

  onOptionsChange(values) { if (values.pages !== lastText) applyText(values.pages || ''); },

  async run(inputs, opts, ctx) {
    const input = inputs[0];
    const doc = await input.pdfDoc();
    const n = doc.getPageCount();
    if (!String(opts.pages || '').trim()) throw inputHint('Markiere zuerst die Seiten, die du löschen möchtest.', 'First mark the pages you want to delete.');
    const del = new Set(ctx.parsePages(opts.pages, n));
    if (del.size >= n) throw inputHint('Du kannst nicht alle Seiten löschen – mindestens eine muss bleiben.', 'You can’t delete every page – at least one has to stay.');
    ctx.progress(0.3, { de: `${del.size} Seiten werden entfernt …`, en: `Removing ${del.size} pages …` });
    await ctx.tick();
    const PDFLib = await loadPdfLib();
    const pages = doc.getPages();
    rearrange(doc, PDFLib, pages.filter((p, i) => !del.has(i)).map(page => ({ page })));
    ctx.progress(0.7, { de: 'Wird gespeichert …', en: 'Saving …' });
    await ctx.tick();
    const bytes = await saveLike(doc, input, ctx);
    return { outputs: [{ name: ctx.fileName(input.name, ctx.lang === 'de' ? ' (Seiten gelöscht)' : ' (pages deleted)', 'pdf'), blob: pdfBlob(bytes), pages: n - del.size }] };
  },
};

function applyText(text) {
  lastText = text;
  if (!stage?.input) return;
  let idx = [];
  try { idx = text.trim() ? parsePages(text, stage.items.length, { unique: true }) : []; } catch { return; }
  const set = new Set(idx);
  stage.grid.setSelected(stage.items.filter((it, i) => set.has(i)).map(it => it.id));
  sync(false);
}
