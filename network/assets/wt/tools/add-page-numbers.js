// Tool: add page numbers – 9 positions (tap on the preview), formats incl. "Seite 1 von 10" and roman
// numerals, start number, skip the first pages or number only a range, font, size, colour, margin,
// mirrored positions for duplex printing. Drawn in the visual frame of each page (respects /Rotate
// and CropBox offsets). Live preview of any page.
import { loadPdfLib } from '../lib/pdf.js';
import { frame, drawVisual, fontCache, hexColor, winAnsi, lostWarning, roman, mm, FONT_CHOICES, onePageDoc, savePreview, pageLang, saveResult, previewSource } from '../lib/edit-draw.js';
import { createPreview, positionZones } from '../lib/edit-preview.js';
import { el } from '../lib/dom.js';

const LANG = pageLang();
const FORMATS = [
  { value: 'n', label: '1, 2, 3' },
  { value: 'page', label: { de: 'Seite 1', en: 'Page 1' } },
  { value: 'n-of', label: '1 / 10' },
  { value: 'page-of', label: { de: 'Seite 1 von 10', en: 'Page 1 of 10' } },
  { value: 'dash', label: '- 1 -' },
  { value: 'roman-lower', label: 'i, ii, iii' },
  { value: 'roman-upper', label: 'I, II, III' },
  { value: 'custom', label: { de: 'Eigener Text …', en: 'Custom text …' } },
];

/** Which pages get which number. → {numbers: Map(index → n), total} */
export function plan(count, opts, parse) {
  let idx = Array.from({ length: count }, (_, i) => i);
  if (opts.scope === 'skip') idx = idx.slice(Math.max(0, Math.min(count, Math.floor(+opts.skip || 0))));
  else if (opts.scope === 'range' && String(opts.pages || '').trim()) idx = [...new Set(parse(opts.pages, count))].sort((a, b) => a - b);
  const start = Number.isFinite(+opts.start) && opts.start !== '' ? Math.floor(+opts.start) : 1;
  const numbers = new Map(idx.map((i, k) => [i, start + k]));
  return { numbers, total: idx.length ? start + idx.length - 1 : 0 };
}

export function formatNumber(n, total, opts, lang) {
  const de = lang !== 'en';
  switch (opts.format) {
    case 'page': return `${de ? 'Seite' : 'Page'} ${n}`;
    case 'n-of': return `${n} / ${total}`;
    case 'page-of': return de ? `Seite ${n} von ${total}` : `Page ${n} of ${total}`;
    case 'dash': return `- ${n} -`;
    case 'roman-lower': return roman(n, false);
    case 'roman-upper': return roman(n, true);
    case 'custom': return String(opts.custom || '{n}')
      .replace(/\{(n|seite|page)\}/gi, String(n))
      .replace(/\{(total|seiten|pages)\}/gi, String(total));
    default: return String(n);
  }
}

/** Mirror left/right on the back side (even page numbers in the document) when printing duplex. */
export function effectivePos(pos, index, mirror) {
  if (!mirror || index % 2 === 0) return pos;
  return pos[0] + ({ l: 'r', r: 'l' }[pos[1]] || pos[1]);
}

async function stampPage(page, PDFLib, font, text, opts, index) {
  const f = frame(page);
  const size = Math.max(4, Math.min(72, +opts.size || 11));
  const m = Math.min(mm(+opts.margin || 0), f.H / 4, f.W / 4);
  const pos = effectivePos(opts.position || 'bc', index, opts.mirror);
  const w = font.widthOfTextAtSize(text, size);
  const cap = font.heightAtSize(size, { descender: false });
  const x = pos[1] === 'l' ? m : pos[1] === 'r' ? f.W - m - w : (f.W - w) / 2;
  const y = pos[0] === 'b' ? m : pos[0] === 't' ? f.H - m - cap : (f.H - cap) / 2;
  drawVisual(page, PDFLib, f, () => page.drawText(text, { x, y, size, font, color: hexColor(PDFLib, opts.color) }));
}

async function numberDoc(doc, PDFLib, opts, ctx, { only = null, onPage = null } = {}) {
  const count = only ? only.count : doc.getPageCount();
  const { numbers, total } = plan(count, opts, ctx.parsePages);
  const fonts = fontCache(doc, PDFLib);
  const font = await fonts(opts.font);
  const lost = new Map();
  const pages = doc.getPages();
  let done = 0;
  for (const [index, n] of numbers) {
    const page = only ? (index === only.index ? pages[0] : null) : pages[index];
    if (!page) continue;
    const r = winAnsi(formatNumber(n, total, opts, ctx.lang));
    for (const [k, v] of r.lost) lost.set(k, v);
    await stampPage(page, PDFLib, font, r.text.replace(/\n/g, ' '), opts, index);
    if (onPage && ++done % 10 === 0) await onPage(done, numbers.size);
  }
  return { lost, numbered: numbers.size };
}

let pv = null;
const source = previewSource();

export default {
  options: [
    { id: 'position', type: 'text', default: 'bc', when: () => false, label: 'position' },
    { id: 'format', type: 'select', default: 'n', label: { de: 'Format', en: 'Format' }, choices: FORMATS },
    {
      id: 'custom', type: 'text', default: LANG === 'en' ? 'Page {n} of {total}' : 'Seite {n} von {total}', maxLength: 80,
      when: v => v.format === 'custom',
      label: { de: 'Eigener Text', en: 'Custom text' },
      hint: { de: '{n} wird zur Seitenzahl, {total} zur Gesamtzahl – z. B. „Anlage B – {n}“.', en: '{n} becomes the page number, {total} the total – e.g. “Annex B – {n}”.' },
    },
    { id: 'start', type: 'number', default: 1, min: 0, max: 99999, step: 1, label: { de: 'Erste Seitenzahl', en: 'First number' },
      validate: (v, lang) => (v === '' || !Number.isInteger(+v) || +v < 0 ? (lang === 'en' ? 'Enter a whole number.' : 'Gib eine ganze Zahl ein.') : '') },
    {
      id: 'scope', type: 'select', default: 'all', label: { de: 'Welche Seiten?', en: 'Which pages?' },
      choices: [
        { value: 'all', label: { de: 'Alle Seiten', en: 'All pages' } },
        { value: 'skip', label: { de: 'Erste Seiten auslassen (z. B. Deckblatt)', en: 'Skip the first pages (e.g. cover)' } },
        { value: 'range', label: { de: 'Nur bestimmte Seiten', en: 'Only certain pages' } },
      ],
    },
    { id: 'skip', type: 'number', default: 1, min: 0, max: 9999, step: 1, when: v => v.scope === 'skip', label: { de: 'Anzahl ausgelassener Seiten', en: 'Pages to skip' },
      hint: { de: 'Die erste nummerierte Seite bekommt die „Erste Seitenzahl“. Soll Seite 2 die 2 tragen, stell dort 2 ein.', en: 'The first numbered page gets the “first number”. If page 2 should show 2, set it to 2.' } },
    { id: 'pages', type: 'pages', default: '', when: v => v.scope === 'range', label: { de: 'Seiten', en: 'Pages' }, placeholder: { de: 'z. B. 3-12', en: 'e.g. 3-12' } },
    { id: 'size', type: 'range', default: 11, min: 6, max: 36, step: 1, unit: 'pt', label: { de: 'Schriftgröße', en: 'Font size' } },
    { id: 'font', type: 'select', default: 'sans', label: { de: 'Schrift', en: 'Font' }, choices: FONT_CHOICES },
    { id: 'color', type: 'color', default: '#222222', label: { de: 'Farbe', en: 'Colour' } },
    { id: 'margin', type: 'range', default: 10, min: 3, max: 40, step: 1, unit: 'mm', label: { de: 'Abstand zum Rand', en: 'Distance from the edge' } },
    {
      id: 'mirror', type: 'toggle', default: false,
      label: { de: 'Für beidseitigen Druck spiegeln', en: 'Mirror for double-sided printing' },
      hint: { de: 'Steht die Zahl links oder rechts, wechselt sie auf geraden Seiten die Seite – so ist sie im gebundenen Dokument immer außen.', en: 'If the number is on the left or right, it switches sides on even pages, so it is always on the outside of a bound document.' },
    },
  ],

  mountStage(stage, state, ctx) {
    pv = createPreview(stage, {
      lang: ctx.lang, state, sticky: true,
      async build(index, values, signal) {
        const PDFLib = await loadPdfLib();
        const src = await source(state.inputs.find(i => !i.error && !i.locked));
        if (signal.aborted) return null;
        const doc = await onePageDoc(PDFLib, src, index);
        let opts = values;
        try { ctx.parsePages(values.pages || '', src.getPageCount()); } catch { opts = { ...values, pages: '' }; }
        const r = await numberDoc(doc, PDFLib, opts, ctx, { only: { index, count: src.getPageCount() } });
        pv.setWarning(lostWarning(r.lost, winAnsi(formatNumber(1, 1, values, ctx.lang)).lost));
        return savePreview(doc);
      },
    });
    positionZones(pv, {
      lang: ctx.lang, title: ctx.t({ de: 'Position der Seitenzahl', en: 'Position of the page number' }),
      get: () => state.values.position || 'bc',
      set: v => { state.values.position = v; state.results.clear(); pv.refresh(0); },
    });
    pv.extra.append(el('p', { class: 'ed-hint' }, ctx.t({ de: 'Tippe auf die Stelle, an der die Seitenzahl stehen soll. Wischen wechselt die Seite.', en: 'Tap where the page number should go. Swipe to change the page.' })));
  },

  onInputs() { pv?.reset(); },

  async run(inputs, opts, ctx) {
    const PDFLib = await loadPdfLib();
    const outputs = [];
    for (const input of inputs) {
      ctx.progress(0, { de: 'PDF wird geöffnet …', en: 'Opening PDF …' });
      const doc = await input.pdfDoc();
      const n = doc.getPageCount();
      const r = await numberDoc(doc, PDFLib, opts, ctx, {
        onPage: async (i, total) => { ctx.progress(i / total * 0.9, { de: `Seite ${i} von ${total}`, en: `Page ${i} of ${total}` }); await ctx.tick(); },
      });
      if (!r.numbered) throw Object.assign(new Error('nothing'), { userMessage: { de: 'Keine Seite ausgewählt – prüfe „Welche Seiten?“.', en: 'No page selected – check “Which pages?”.' } });
      const w = lostWarning(r.lost);
      if (w) ctx.note(w);
      ctx.progress(0.95, { de: 'Wird gespeichert …', en: 'Saving …' });
      await ctx.tick();
      const bytes = await saveResult(doc, ctx);
      outputs.push({
        name: ctx.fileName(input.name, ctx.lang === 'en' ? ' (numbered)' : ' (nummeriert)', 'pdf'),
        blob: new Blob([bytes], { type: 'application/pdf' }), pages: n,
        note: r.numbered < n ? { de: `${r.numbered} von ${n} Seiten nummeriert`, en: `${r.numbered} of ${n} pages numbered` } : null,
      });
    }
    return { outputs };
  },
};
