// Tool: header and footer – left / centre / right fields for both, placeholders for page, page count,
// date, file name and title (German and English names both work), Bates numbering, font, size,
// colour, margins, mirrored for duplex, page selection. Drawn in each page's visual frame.
import { loadPdfLib } from '../lib/pdf.js';
import { frame, drawVisual, fontCache, hexColor, winAnsi, lostWarning, mm, FONT_CHOICES, onePageDoc, savePreview, pageLang, saveResult, previewSource, selectPages, userError } from '../lib/edit-draw.js';
import { createPreview } from '../lib/edit-preview.js';
import { tokenChips } from '../lib/edit-controls.js';
import { baseName } from '../lib/format.js';

const LANG = pageLang();
const SLOTS = ['hl', 'hc', 'hr', 'fl', 'fc', 'fr'];
const SLOT_LABEL = {
  hl: { de: 'Kopfzeile links', en: 'Header left' }, hc: { de: 'Kopfzeile Mitte', en: 'Header centre' }, hr: { de: 'Kopfzeile rechts', en: 'Header right' },
  fl: { de: 'Fußzeile links', en: 'Footer left' }, fc: { de: 'Fußzeile Mitte', en: 'Footer centre' }, fr: { de: 'Fußzeile rechts', en: 'Footer right' },
};
const DEFAULTS = LANG === 'en'
  ? { hl: '', hc: '', hr: '', fl: '{filename}', fc: '', fr: 'Page {page} of {pages}' }
  : { hl: '', hc: '', hr: '', fl: '{dateiname}', fc: '', fr: 'Seite {seite} von {seiten}' };

export function bates(opts, k) {
  const digits = Math.max(1, Math.min(12, Math.floor(+opts.batesDigits || 6)));
  const n = Math.max(0, Math.floor(+opts.batesStart || 0)) + k;
  return `${opts.batesPrefix || ''}${String(n).padStart(digits, '0')}`;
}

/** Fill placeholders. info: {page, pages, date, filename, title, bates} */
export function fill(text, info) {
  return String(text || '').replace(/\{([a-zäöü]+)\}/gi, (m, k) => {
    switch (k.toLowerCase()) {
      case 'seite': case 'page': return String(info.page);
      case 'seiten': case 'pages': return String(info.pages);
      case 'datum': case 'date': return info.date;
      case 'dateiname': case 'filename': return info.filename;
      case 'titel': case 'title': return info.title;
      case 'bates': return info.bates ?? m;
      default: return m;
    }
  });
}

function slotTexts(opts) {
  const t = {};
  for (const s of SLOTS) t[s] = String(opts[s] || '');
  if (opts.bates) {
    const slot = SLOTS.includes(opts.batesSlot) ? opts.batesSlot : 'fr';
    if (!/\{bates\}/i.test(t[slot])) t[slot] = t[slot].trim() ? `${t[slot]}  {bates}` : '{bates}';
  }
  return t;
}

async function decorate(doc, PDFLib, opts, ctx, meta, { only = null, onPage = null } = {}) {
  const fonts = fontCache(doc, PDFLib);
  const font = await fonts(opts.font);
  const color = hexColor(PDFLib, opts.color, '#333333');
  const count = only ? only.count : doc.getPageCount();
  const sel = selectPages(opts.scope === 'skip' ? 'all' : opts.scope, opts.pages, count, ctx.parsePages);
  if (opts.scope === 'skip') sel.delete(0);
  const start = Number.isFinite(+opts.start) && opts.start !== '' ? Math.floor(+opts.start) : 1;
  const texts = slotTexts(opts);
  const pages = doc.getPages();
  const lost = new Map();
  const size0 = Math.max(5, Math.min(30, +opts.size || 9));
  const order = [...sel].sort((a, b) => a - b);
  let done = 0;
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    const page = only ? (i === only.index ? pages[0] : null) : pages[i];
    if (!page) continue;
    const info = { page: start + i, pages: start + count - 1, date: meta.date, filename: meta.filename, title: meta.title, bates: bates(opts, k) };
    const f = frame(page);
    const mv = Math.min(mm(+opts.marginV || 10), f.H / 5), mh = Math.min(mm(+opts.marginH || 15), f.W / 5);
    const mirror = opts.mirror && i % 2 === 1;
    drawVisual(page, PDFLib, f, () => {
      for (const s of SLOTS) {
        if (!texts[s].trim()) continue;
        const r = winAnsi(fill(texts[s], info).replace(/\s*\n\s*/g, ' '));
        for (const [a, b] of r.lost) lost.set(a, b);
        let col = s[1];
        if (mirror) col = { l: 'r', r: 'l', c: 'c' }[col];
        let size = size0;
        let w = font.widthOfTextAtSize(r.text, size);
        const maxW = f.W - 2 * mh;
        if (w > maxW) { size = Math.max(4, size * maxW / w); w = font.widthOfTextAtSize(r.text, size); }
        const cap = font.heightAtSize(size, { descender: false });
        const x = col === 'l' ? mh : col === 'r' ? f.W - mh - w : (f.W - w) / 2;
        const y = s[0] === 'h' ? f.H - mv - cap : mv;
        page.drawText(r.text, { x, y, size, font, color });
      }
    });
    done++;
    if (onPage && done % 10 === 0) await onPage(done, order.length);
  }
  return { lost, done, lastBates: order.length ? bates(opts, order.length - 1) : null };
}

function metaFor(input, src, lang) {
  let title = '';
  try { title = src.getTitle() || ''; } catch { /* none */ }
  if (/^\s*(untitled|unbenannt|ohne titel)\s*$/i.test(title)) title = '';
  const filename = baseName(input.name);
  return { filename, title: title || filename, date: new Date().toLocaleDateString(lang === 'en' ? 'en-GB' : 'de-DE') };
}

let pv = null;
const source = previewSource();
const textOpt = id => ({ id, type: 'text', default: DEFAULTS[id], maxLength: 160, label: SLOT_LABEL[id] });

export default {
  options: [
    ...SLOTS.map(textOpt),
    { id: 'size', type: 'range', default: 9, min: 6, max: 20, step: 1, unit: 'pt', label: { de: 'Schriftgröße', en: 'Font size' } },
    { id: 'font', type: 'select', default: 'sans', label: { de: 'Schrift', en: 'Font' }, choices: FONT_CHOICES },
    { id: 'color', type: 'color', default: '#333333', label: { de: 'Farbe', en: 'Colour' } },
    { id: 'marginV', type: 'range', default: 10, min: 3, max: 40, step: 1, unit: 'mm', label: { de: 'Abstand oben und unten', en: 'Distance from top and bottom' } },
    { id: 'marginH', type: 'range', default: 15, min: 3, max: 40, step: 1, unit: 'mm', label: { de: 'Abstand links und rechts', en: 'Distance from left and right' } },
    { id: 'start', type: 'number', default: 1, min: 0, max: 99999, step: 1, label: { de: 'Erste Seitenzahl für {seite}', en: 'First number for {page}' } },
    {
      id: 'scope', type: 'select', default: 'all', label: { de: 'Welche Seiten?', en: 'Which pages?' },
      choices: [
        { value: 'all', label: { de: 'Alle Seiten', en: 'All pages' } },
        { value: 'skip', label: { de: 'Alle außer der ersten (Deckblatt)', en: 'All except the first (cover)' } },
        { value: 'odd', label: { de: 'Ungerade Seiten', en: 'Odd pages' } },
        { value: 'even', label: { de: 'Gerade Seiten', en: 'Even pages' } },
        { value: 'range', label: { de: 'Bestimmte Seiten', en: 'Certain pages' } },
      ],
    },
    { id: 'pages', type: 'pages', default: '', when: v => v.scope === 'range', label: { de: 'Seitenbereich', en: 'Page range' } },
    { id: 'mirror', type: 'toggle', default: false, label: { de: 'Links und rechts auf geraden Seiten tauschen', en: 'Swap left and right on even pages' },
      hint: { de: 'Für beidseitigen Druck: was rechts steht, ist im gebundenen Dokument immer außen.', en: 'For double-sided printing: whatever is on the right is always on the outside of a bound document.' } },
    { id: 'bates', type: 'toggle', default: false, label: { de: 'Bates-Nummerierung', en: 'Bates numbering' },
      hint: { de: 'Fortlaufende Kennung wie „AKTE-000001“ auf jeder Seite, z. B. für Akten und Beweismittel.', en: 'A running ID such as “CASE-000001” on every page, e.g. for legal files and exhibits.' } },
    { id: 'batesPrefix', type: 'text', default: LANG === 'en' ? 'CASE-' : 'AKTE-', maxLength: 30, when: v => v.bates, label: { de: 'Präfix', en: 'Prefix' } },
    { id: 'batesDigits', type: 'number', default: 6, min: 1, max: 12, step: 1, when: v => v.bates, label: { de: 'Stellen', en: 'Digits' } },
    { id: 'batesStart', type: 'number', default: 1, min: 0, max: 999999999, step: 1, when: v => v.bates, label: { de: 'Startnummer', en: 'Start number' } },
    { id: 'batesSlot', type: 'select', default: 'fr', when: v => v.bates, label: { de: 'Position', en: 'Position' }, choices: SLOTS.map(s => ({ value: s, label: SLOT_LABEL[s] })) },
  ],

  mountStage(stage, state, ctx) {
    pv = createPreview(stage, {
      lang: ctx.lang, state, sticky: true,
      async build(index, values, signal) {
        const PDFLib = await loadPdfLib();
        const input = state.inputs.find(i => !i.error && !i.locked);
        const src = await source(input);
        if (signal.aborted) return null;
        const doc = await onePageDoc(PDFLib, src, index);
        let opts = values;
        try { ctx.parsePages(values.pages || '', src.getPageCount()); } catch { opts = { ...values, pages: '' }; }
        const r = await decorate(doc, PDFLib, opts, ctx, metaFor(input, src, ctx.lang), { only: { index, count: src.getPageCount() } });
        const probe = winAnsi(SLOTS.map(s => values[s] || '').join(' ') + (values.bates ? values.batesPrefix || '' : ''));
        pv.setWarning(lostWarning(r.lost, probe.lost));
        return savePreview(doc);
      },
    });
    const de = ctx.lang !== 'en';
    const tokens = (de
      ? [['{seite}', 'Seitenzahl'], ['{seiten}', 'Seitenanzahl'], ['{datum}', 'Heutiges Datum'], ['{dateiname}', 'Dateiname'], ['{titel}', 'Titel der PDF'], ['{bates}', 'Bates-Nummer']]
      : [['{page}', 'Page number'], ['{pages}', 'Page count'], ['{date}', 'Today’s date'], ['{filename}', 'File name'], ['{title}', 'PDF title'], ['{bates}', 'Bates number']])
      .map(([token, label]) => ({ token, label }));
    pv.extra.append(tokenChips({
      lang: ctx.lang, tokens, fieldIds: SLOTS.map(s => 'wt-opt-' + s),
      title: ctx.t({ de: 'Platzhalter – antippen zum Einfügen', en: 'Placeholders – tap to insert' }),
    }));
  },

  onInputs() { pv?.reset(); },

  async run(inputs, opts, ctx) {
    if (!SLOTS.some(s => String(opts[s] || '').trim()) && !opts.bates) throw userError('Alle Felder sind leer – schreib mindestens in ein Feld etwas.', 'All fields are empty – fill in at least one field.');
    const PDFLib = await loadPdfLib();
    const outputs = [];
    for (const input of inputs) {
      ctx.progress(0, { de: 'PDF wird geöffnet …', en: 'Opening PDF …' });
      const doc = await input.pdfDoc();
      const r = await decorate(doc, PDFLib, opts, ctx, metaFor(input, doc, ctx.lang), {
        onPage: async (i, n) => { ctx.progress(i / n * 0.9, { de: `Seite ${i} von ${n}`, en: `Page ${i} of ${n}` }); await ctx.tick(); },
      });
      if (!r.done) throw userError('Keine Seite ausgewählt – prüfe „Welche Seiten?“.', 'No page selected – check “Which pages?”.');
      const w = lostWarning(r.lost);
      if (w) ctx.note(w);
      if (opts.bates) ctx.note({ de: `Bates-Nummern: ${bates(opts, 0)} bis ${r.lastBates}. Die nächste Datei beginnt mit ${bates(opts, r.done)} (Startnummer ${Math.floor(+opts.batesStart || 0) + r.done}).`, en: `Bates numbers: ${bates(opts, 0)} to ${r.lastBates}. The next file starts with ${bates(opts, r.done)} (start number ${Math.floor(+opts.batesStart || 0) + r.done}).` });
      ctx.progress(0.95, { de: 'Wird gespeichert …', en: 'Saving …' });
      await ctx.tick();
      const bytes = await saveResult(doc, ctx);
      outputs.push({ name: ctx.fileName(input.name, ctx.lang === 'en' ? ' (header-footer)' : ' (Kopf-Fußzeile)', 'pdf'), blob: new Blob([bytes], { type: 'application/pdf' }), pages: doc.getPageCount() });
    }
    return { outputs };
  },
};
