// Tool: mix pages alternately – front and back sides of a one-sided duplex scan (two PDFs, or one PDF with
// all fronts first and then all backs), optionally with the second stack reversed; or N PDFs in turn.
// A live preview shows the resulting page order before anything is saved.
import { loadPdfLib } from '../lib/pdf.js';
import { el } from '../lib/dom.js';
import { baseName } from '../lib/format.js';
import { PageGrid, ThumbSource, loadGridCss } from '../lib/pagegrid.js';
import { saveLike, pdfBlob, userError, rearrange } from '../lib/org-common.js';

let P = null;

/** Result order: [{f: inputId, p, tag}] for files with `counts` pages. */
export function mixOrder(files, opts) {
  const step = Math.max(1, Math.floor(+opts.chunk || 1));
  let stacks;
  if (files.length === 1) {
    const { id, count } = files[0];
    const half = Math.ceil(count / 2);
    stacks = [
      Array.from({ length: half }, (_, p) => ({ f: id, p })),
      Array.from({ length: count - half }, (_, k) => ({ f: id, p: half + k })),
    ];
  } else stacks = files.map(({ id, count }) => Array.from({ length: count }, (_, p) => ({ f: id, p })));
  if (opts.reverse && stacks[1]) stacks[1].reverse();
  stacks.forEach((s, i) => s.forEach((x, k) => { x.tag = `${String.fromCharCode(65 + (i % 26))}${k + 1}`; }));
  const out = [];
  const pos = stacks.map(() => 0);
  while (stacks.some((s, i) => pos[i] < s.length)) {
    stacks.forEach((s, i) => { for (let k = 0; k < step && pos[i] < s.length; k++) out.push(s[pos[i]++]); });
  }
  return out;
}

async function refresh(inputs, values) {
  if (!P) return;
  const pdfs = inputs.filter(i => i.kind === 'pdf' && !i.locked && !i.error);
  for (const i of pdfs) if (!P.thumbs.hasInput(i.id)) P.thumbs.addInput(i);
  const files = [];
  for (const i of pdfs) files.push({ id: i.id, count: await i.pageCount() });
  await loadGridCss();
  const de = P.lang === 'de';
  const order = files.length ? mixOrder(files, values) : [];
  const front = de ? 'Vorderseite' : 'front', back = de ? 'Rückseite' : 'back';
  const one = files.length === 1;
  P.grid.setItems(order.map((o, i) => ({ id: `${o.f}:${o.p}:${i}`, src: { f: o.f, p: o.p }, rot: 0, tag: o.tag })));
  P.grid.setBadges(new Map(order.map((o, i) => [`${o.f}:${o.p}:${i}`, files.length <= 2 ? `${o.tag[0] === 'A' ? (de ? 'V' : 'F') : (de ? 'R' : 'B')}${o.tag.slice(1)}` : o.tag])));
  P.wrap.hidden = !order.length;
  const counts = one ? [Math.ceil(files[0]?.count / 2), Math.floor(files[0]?.count / 2)] : files.map(f => f.count);
  const uneven = counts.length > 1 && counts.some(c => c !== counts[0]);
  P.title.textContent = de ? `Vorschau: ${order.length} Seiten` : `Preview: ${order.length} pages`;
  P.sub.textContent = files.length <= 2
    ? (de ? `V = ${front}, R = ${back}${one ? ' (erste Hälfte = Vorderseiten)' : ''}` : `F = ${front}, B = ${back}${one ? ' (first half = fronts)' : ''}`)
    : (de ? `A, B, C … = Datei 1, 2, 3 …` : `A, B, C … = file 1, 2, 3 …`);
  P.warn.hidden = !uneven;
  P.warn.textContent = uneven ? (de ? `Die Stapel sind unterschiedlich lang (${counts.join(' / ')} Seiten) – übrige Seiten kommen ans Ende.` : `The stacks differ in length (${counts.join(' / ')} pages) – the extra pages go at the end.`) : '';
}

export default {
  options: [
    {
      id: 'reverse', type: 'toggle', default: true,
      label: { de: 'Zweiten Stapel rückwärts', en: 'Second stack in reverse' },
      hint: { de: 'Richtig für einseitige Scanner: Den umgedrehten Stapel liest der Scanner von der letzten Rückseite an ein.', en: 'Right for one-sided scanners: the flipped stack is scanned starting with the last back side.' },
    },
    {
      id: 'chunk', type: 'number', default: 1, min: 1, step: 1,
      label: { de: 'Seiten pro Wechsel', en: 'Pages per turn' },
      hint: { de: '1 = immer abwechselnd. 2 = je zwei Seiten aus jeder Datei.', en: '1 = strictly alternating. 2 = two pages from each file in turn.' },
      validate: (v, lang) => (Number.isInteger(+v) && +v >= 1 ? '' : (lang === 'de' ? 'Ganze Zahl ab 1' : 'A whole number from 1')),
    },
  ],

  mountStage(host, state, ctx) {
    P = { lang: ctx.lang, values: state.values, thumbs: new ThumbSource({ width: 140 }) };
    loadGridCss();
    P.title = el('p', { class: 'pg-bar-info' });
    P.sub = el('p', { class: 'pg-hint' });
    P.warn = el('p', { class: 'pg-status is-warn', hidden: true });
    P.wrap = el('div', { class: 'pg-stage', hidden: true }, el('div', { class: 'pg-bar pg-bar-plain' }, P.title), P.sub, P.warn);
    host.append(P.wrap);
    P.grid = new PageGrid(P.wrap, { lang: ctx.lang, mode: 'view', thumbs: P.thumbs, ariaLabel: ctx.t({ de: 'Vorschau der neuen Seitenfolge', en: 'Preview of the new page order' }) });
    P.grid.setMaxHeight('min(52vh, 560px)');
    P.inputs = [];
  },

  async onInputs(inputs) { if (P) { P.inputs = inputs; await refresh(inputs, P.values); } },
  onOptionsChange(values, inputs) { refresh(inputs, values); },

  async run(inputs, opts, ctx) {
    const PDFLib = await loadPdfLib();
    const pdfs = inputs.filter(i => i.kind === 'pdf');
    if (!pdfs.length) throw userError('Bitte wähle eine oder mehrere PDFs aus.', 'Please choose one or more PDFs.');
    const files = [];
    for (const i of pdfs) files.push({ id: i.id, count: await i.pageCount() });
    if (files.length === 1 && files[0].count < 2) throw userError('Die PDF hat nur eine Seite – da gibt es nichts zu mischen.', 'The PDF has only one page – nothing to mix.');
    const order = mixOrder(files, opts);
    const de = ctx.lang === 'de';
    const base = baseName(pdfs[0].name);
    let doc;
    if (files.length === 1) {
      doc = await pdfs[0].pdfDoc();
      const pages = doc.getPages();
      rearrange(doc, PDFLib, order.map(o => ({ page: pages[o.p] })));
    } else {
      doc = await PDFLib.PDFDocument.create();
      const srcs = new Map();
      for (let k = 0; k < pdfs.length; k++) {
        ctx.progress(k / pdfs.length * 0.6, { de: `Datei ${k + 1} von ${pdfs.length} wird gelesen …`, en: `Reading file ${k + 1} of ${pdfs.length} …` });
        const src = await pdfs[k].pdfDoc();
        const copied = await doc.copyPages(src, src.getPageIndices());
        srcs.set(pdfs[k].id, copied);
        await ctx.tick();
      }
      for (const o of order) doc.addPage(srcs.get(o.f)[o.p]);
    }
    ctx.progress(0.8, { de: 'Wird gespeichert …', en: 'Saving …' });
    await ctx.tick();
    const bytes = await saveLike(doc, files.length === 1 ? pdfs[0] : null, ctx);
    if (files.length > 1 && pdfs.some(p => p.password)) ctx.note({ de: 'Das Ergebnis ist nicht mit einem Passwort geschützt.', en: 'The result is not password protected.' });
    return { outputs: [{ name: ctx.safeFileName(`${base} (${de ? 'gemischt' : 'mixed'})`) + '.pdf', blob: pdfBlob(bytes), pages: order.length }] };
  },
};

