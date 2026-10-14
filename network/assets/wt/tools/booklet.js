// Tool: booklet printing (saddle stitch) – imposes the pages two per sheet side in booklet order, pads
// with blank pages to a multiple of 4 (at the end or before the back cover), optional signatures
// (several booklets of n sheets), left or right binding, margins, fold marks. The result note explains
// how to print it double-sided.
import { loadPdfLib } from '../lib/pdf.js';
import { mm, SHEETS, embedSourcePages, drawEmbedded, frame, savePreview, previewSource, saveResult, selectPages, userError } from '../lib/edit-draw.js';
import { createPreview } from '../lib/edit-preview.js';

/**
 * Booklet order for n pages (0..n-1). Returns sides [{left, right, sheet, back, booklet}] – left/right are page
 * indices or null (blank). sigSheets 0 = one booklet.
 */
export function bookletOrder(n, { sigSheets = 0, blanks = 'end', rtl = false } = {}) {
  const pages = Array.from({ length: n }, (_, i) => i);
  const pad = (4 - (n % 4)) % 4;
  if (pad && blanks === 'beforeBack' && n > 1) pages.splice(n - 1, 0, ...Array(pad).fill(null));
  else pages.push(...Array(pad).fill(null));
  const per = sigSheets > 0 ? sigSheets * 4 : pages.length;
  const sides = [];
  let sheet = 0;
  for (let b = 0, start = 0; start < pages.length; b++, start += per) {
    const chunk = pages.slice(start, start + per);
    while (chunk.length % 4) chunk.push(null);
    const N = chunk.length;
    for (let i = 0; i < N / 4; i++, sheet++) {
      const front = { left: chunk[N - 1 - 2 * i], right: chunk[2 * i] };
      const back = { left: chunk[2 * i + 1], right: chunk[N - 2 - 2 * i] };
      for (const [side, isBack] of [[front, false], [back, true]]) {
        sides.push(rtl ? { left: side.right, right: side.left, sheet, back: isBack, booklet: b } : { ...side, sheet, back: isBack, booklet: b });
      }
    }
  }
  return { sides, blanks: pad };
}

function sheetSize(opts, W, H) {
  let [w, h] = opts.sheet === 'auto' ? [W * 2, H] : (SHEETS[opts.sheet] || SHEETS.a4);
  if (w < h) [w, h] = [h, w]; // landscape sheet
  return [w, h];
}

async function impose(out, src, PDFLib, indices, opts, { only = null, tick = null } = {}) {
  const pages = src.getPages();
  const f0 = frame(pages[indices[0]]);
  const [SW, SH] = sheetSize(opts, f0.W, f0.H);
  const m = mm(Math.max(0, +opts.margin || 0)), g = mm(Math.max(0, +opts.gutter || 0));
  const halfW = SW / 2 - m - g, halfH = SH - 2 * m;
  const order = bookletOrder(indices.length, { sigSheets: +opts.signature || 0, blanks: opts.blanks, rtl: opts.binding === 'right' });
  const { rgb } = PDFLib;
  for (let k = 0; k < order.sides.length; k++) {
    if (only != null && k !== only) continue;
    const side = order.sides[k];
    const page = out.addPage([SW, SH]);
    for (const [slot, idx] of [['left', side.left], ['right', side.right]]) {
      if (idx == null) continue;
      const [it] = await embedSourcePages(out, src, [indices[idx]]);
      const s = Math.min(halfW / it.W, halfH / it.H);
      const w = it.W * s, h = it.H * s;
      // pages sit against the fold (gutter), centred vertically
      const tx = slot === 'left' ? SW / 2 - g - w : SW / 2 + g;
      const ty = (SH - h) / 2;
      drawEmbedded(page, PDFLib, it, s, tx, ty);
    }
    if (opts.marks && m >= mm(3)) {
      const c = rgb(0.5, 0.5, 0.5);
      page.drawLine({ start: { x: SW / 2, y: 0 }, end: { x: SW / 2, y: Math.min(m, mm(6)) * 0.8 }, thickness: 0.4, color: c });
      page.drawLine({ start: { x: SW / 2, y: SH }, end: { x: SW / 2, y: SH - Math.min(m, mm(6)) * 0.8 }, thickness: 0.4, color: c });
    }
    if (tick && k % 6 === 5) await tick(k, order.sides.length);
  }
  return order;
}

let pv = null;
const source = previewSource();

export function printHint(order, opts, lang) {
  const sheets = order.sides.length / 2;
  const sig = +opts.signature || 0;
  const booklets = sig ? Math.ceil(sheets / sig) : 1;
  const de = lang !== 'en';
  const parts = [];
  parts.push(de
    ? `So druckst du: ${sheets} Blatt, beidseitig, Einstellung „an der kurzen Kante wenden/spiegeln“, Seitengröße „tatsächliche Größe“ oder „an Seite anpassen“.`
    : `How to print: ${sheets} sheet${sheets === 1 ? '' : 's'}, double-sided, setting “flip on short edge”, size “actual size” or “fit to page”.`);
  parts.push(booklets > 1
    ? (de ? `Dann jedes der ${booklets} Hefte (je ${sig} Blatt) einzeln in der Mitte falten, die Hefte aufeinanderlegen und binden.` : `Then fold each of the ${booklets} booklets (${sig} sheets each) in the middle, stack them in order and bind them.`)
    : (de ? 'Dann den Stapel als Ganzes in der Mitte falten und im Falz heften – fertig ist das Heft.' : 'Then fold the whole stack in the middle and staple it along the fold – your booklet is done.'));
  parts.push(de ? 'Ohne Duplexdruck: erst alle ungeraden Seiten drucken, den Stapel gewendet wieder einlegen, dann alle geraden.' : 'Without duplex printing: print all odd pages first, put the stack back in turned over, then print all even pages.');
  return parts.join(' ');
}

export default {
  options: [
    {
      id: 'sheet', type: 'select', default: 'a4', label: { de: 'Papier', en: 'Paper' },
      choices: [
        { value: 'a4', label: { de: 'A4 quer → Heft in A5', en: 'A4 landscape → A5 booklet' } },
        { value: 'a3', label: { de: 'A3 quer → Heft in A4', en: 'A3 landscape → A4 booklet' } },
        { value: 'letter', label: { de: 'Letter quer → Heft in 5,5 × 8,5 in', en: 'Letter landscape → 5.5 × 8.5 in booklet' } },
        { value: 'auto', label: { de: 'Doppelte Originalbreite (ohne Verkleinern)', en: 'Twice the original width (no scaling)' } },
      ],
    },
    {
      id: 'binding', type: 'radio', default: 'left', label: { de: 'Bindung', en: 'Binding' },
      choices: [
        { value: 'left', label: { de: 'Links', en: 'Left' }, hint: { de: 'Normal für Deutsch, Englisch …', en: 'Usual for English, German …' } },
        { value: 'right', label: { de: 'Rechts', en: 'Right' }, hint: { de: 'Für Arabisch, Hebräisch, Manga', en: 'For Arabic, Hebrew, manga' } },
      ],
    },
    {
      id: 'blanks', type: 'radio', default: 'beforeBack', label: { de: 'Leere Seiten zum Auffüllen', en: 'Blank pages for padding' },
      hint: { de: 'Ein Heft braucht eine durch 4 teilbare Seitenzahl.', en: 'A booklet needs a page count divisible by 4.' },
      choices: [
        { value: 'beforeBack', label: { de: 'Vor der Rückseite', en: 'Before the back cover' }, hint: { de: 'Letzte Seite bleibt hinten', en: 'Last page stays at the back' } },
        { value: 'end', label: { de: 'Am Ende', en: 'At the end' } },
      ],
    },
    {
      id: 'signature', type: 'select', default: 0, label: { de: 'Hefte', en: 'Booklets' },
      choices: [
        { value: 0, label: { de: 'Ein Heft (alle Blätter zusammen falten)', en: 'One booklet (fold all sheets together)' } },
        { value: 4, label: { de: 'Mehrere Hefte zu je 4 Blatt (16 Seiten)', en: 'Several booklets of 4 sheets (16 pages)' } },
        { value: 5, label: { de: 'Mehrere Hefte zu je 5 Blatt (20 Seiten)', en: 'Several booklets of 5 sheets (20 pages)' } },
        { value: 8, label: { de: 'Mehrere Hefte zu je 8 Blatt (32 Seiten)', en: 'Several booklets of 8 sheets (32 pages)' } },
      ],
    },
    { id: 'margin', type: 'range', default: 5, min: 0, max: 20, step: 1, unit: 'mm', label: { de: 'Außenrand', en: 'Outer margin' } },
    { id: 'gutter', type: 'range', default: 0, min: 0, max: 15, step: 1, unit: 'mm', label: { de: 'Zusätzlicher Abstand zum Falz', en: 'Extra space at the fold' } },
    { id: 'marks', type: 'toggle', default: true, label: { de: 'Falzmarken', en: 'Fold marks' }, hint: { de: 'Kleine Striche oben und unten in der Mitte', en: 'Small ticks at the top and bottom centre' } },
  ],

  mountStage(stage, state, ctx) {
    const input = () => state.inputs.find(i => !i.error && !i.locked);
    const all = src => [...selectPages('all', '', src.getPageCount(), ctx.parsePages)];
    let order = null;
    pv = createPreview(stage, {
      lang: ctx.lang, state, sticky: true, heightPhone: 0.3,
      label: (i, n, lang) => {
        const side = order?.sides[i];
        if (!side) return '';
        const sheet = side.sheet + 1;
        return lang === 'en' ? `Sheet ${sheet} · ${side.back ? 'back' : 'front'} (${i + 1}/${n})` : `Blatt ${sheet} · ${side.back ? 'Rückseite' : 'Vorderseite'} (${i + 1}/${n})`;
      },
      async count() {
        const src = await source(input());
        const v = pv.values();
        order = bookletOrder(src.getPageCount(), { sigSheets: +v.signature || 0, blanks: v.blanks, rtl: v.binding === 'right' });
        return order.sides.length;
      },
      async build(index, values, signal) {
        const PDFLib = await loadPdfLib();
        const src = await source(input());
        if (signal.aborted) return null;
        const out = await PDFLib.PDFDocument.create();
        const o = await impose(out, src, PDFLib, all(src), values, { only: index });
        info.textContent = o.blanks
          ? (ctx.lang === 'en' ? `${o.blanks} blank page(s) added so the page count is divisible by 4.` : `${o.blanks} leere Seite(n) ergänzt, damit die Seitenzahl durch 4 teilbar ist.`)
          : '';
        return savePreview(out);
      },
    });
    const info = document.createElement('p');
    info.className = 'ed-hint';
    pv.extra.append(info);
  },

  onInputs() { pv?.reset(); },

  async run(inputs, opts, ctx) {
    const PDFLib = await loadPdfLib();
    const outputs = [];
    for (const input of inputs) {
      ctx.progress(0, { de: 'PDF wird geöffnet …', en: 'Opening PDF …' });
      const src = await input.pdfDoc();
      const n = src.getPageCount();
      if (n < 2) throw userError('Für ein Heft braucht die PDF mindestens 2 Seiten.', 'A booklet needs at least 2 pages.');
      const out = await PDFLib.PDFDocument.create();
      const order = await impose(out, src, PDFLib, Array.from({ length: n }, (_, i) => i), opts, {
        tick: async (k, total) => { ctx.progress(k / total * 0.9, { de: `Blattseite ${k + 1} von ${total}`, en: `Sheet side ${k + 1} of ${total}` }); await ctx.tick(); },
      });
      ctx.note(printHint(order, opts, ctx.lang));
      if (order.blanks) ctx.note({ de: `${order.blanks} leere Seite(n) ergänzt.`, en: `${order.blanks} blank page(s) added.` });
      ctx.progress(0.95, { de: 'Wird gespeichert …', en: 'Saving …' });
      await ctx.tick();
      out.wtPassword = src.wtPassword || null;
      const bytes = await saveResult(out, ctx, { title: src.getTitle?.() || null });
      outputs.push({ name: ctx.fileName(input.name, ctx.lang === 'en' ? ' (booklet)' : ' (Broschüre)', 'pdf'), blob: new Blob([bytes], { type: 'application/pdf' }), pages: order.sides.length,
        note: { de: `${n} Seiten → ${order.sides.length / 2} Blatt, beidseitig`, en: `${n} pages → ${order.sides.length / 2} sheets, double-sided` } });
    }
    return { outputs };
  },
};
