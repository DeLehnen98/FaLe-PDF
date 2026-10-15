// Word/Excel/PowerPoint (DOCX/XLSX/PPTX) → PDF with the app's readers and PDF writers
// (lib/shared/office/*, synced by scripts/sync-webtools-vendor.mjs; app imports → conv-office-shim.js).
//   DOCX: docx-read → HTML → docmodel → docpdf (text stays text; headings, lists, tables, images, page size)
//   XLSX: xlsx-read → workbook → sheetpdf (all visible sheets as tables, values as shown, charts as images)
//   PPTX: pptx-read → slide-render → one page per slide (picture + invisible text layer)
// The PDF writers use the 14 standard PDF fonts and, for text they can't show (Polish, Turkish, Greek,
// Cyrillic …), Liberation Sans as an embedded Unicode subset (shared/office/unifont.js). Scripts that font
// lacks (Chinese, Arabic, emoji …) are replaced – unicodeReport() lists exactly which characters.
import './conv-office-shim.js'; // safe DOMParser for the office readers (Trusted Types)
import { userError } from './conv-common.js';
import { loadJSZip } from './pdf.js';

const MAGIC = { zip: [0x50, 0x4b, 0x03, 0x04], ole: [0xd0, 0xcf, 0x11, 0xe0] };
const starts = (b, m) => m.every((v, i) => b[i] === v);

/** Reject non-ZIP files with a helpful text (old binary .doc/.xls/.ppt, renamed files). */
export async function checkOoxml(input, kind) {
  const b = await input.bytes();
  const names = { docx: ['Word', '.doc'], xlsx: ['Excel', '.xls'], pptx: ['PowerPoint', '.ppt'] }[kind];
  if (starts(b, MAGIC.ole)) throw Object.assign(new Error('old format'), { userMessage: {
    de: `„${input.name}“ ist im alten ${names[0]}-Format (${names[1]}). Speichere die Datei in deinem Office-Programm als ${kind.toUpperCase()} und wähle sie dann erneut aus.`,
    en: `“${input.name}” is in the old ${names[0]} format (${names[1]}). Save the file in your office app as ${kind.toUpperCase()} and choose it again.` } });
  if (!starts(b, MAGIC.zip)) throw Object.assign(new Error('not ooxml'), { userMessage: {
    de: `„${input.name}“ ist keine gültige ${kind.toUpperCase()}-Datei.`, en: `“${input.name}” is not a valid ${kind.toUpperCase()} file.` } });
  return b;
}

/** A small file tile (paper with a coloured band and the format) as the card thumbnail. */
export function fileTile(label, color) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const c = document.createElement('canvas');
  c.width = Math.round(48 * dpr); c.height = Math.round(62 * dpr);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 48, 62);
  g.fillStyle = color; g.fillRect(0, 40, 48, 22);
  g.fillStyle = '#c8cbdf';
  for (let y = 10; y < 36; y += 6) g.fillRect(8, y, y === 34 ? 20 : 32, 2);
  g.fillStyle = '#ffffff';
  g.font = '700 11px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, 24, 51.5);
  return c;
}

/**
 * Characters neither the standard PDF fonts nor the embedded Unicode font (Liberation Sans, lib/unifont.js)
 * can show – the writer replaces them – with counts. Polish, Turkish, Greek, Cyrillic … are not reported.
 */
export async function unicodeReport(texts) {
  const { unsupportedChars, loadUniTtf } = await import('./unifont.js');
  try { await loadUniTtf(); } catch { /* estimate without the font file */ }
  const bad = new Map();
  for (const t of texts) for (const ch of unsupportedChars(t)) bad.set(ch, (bad.get(ch) || 0) + 1);
  return bad;
}

export function unicodeNote(ctx, bad) {
  if (!bad.size) return;
  const list = [...bad.keys()].slice(0, 24).join(' ');
  const more = bad.size > 24 ? ' …' : '';
  ctx.note({
    de: `Achtung: ${bad.size} Zeichen kann die eingebettete Schrift nicht darstellen (z. B. chinesische, arabische oder hebräische Schrift, Emoji). Sie wurden durch ähnliche Zeichen oder „?“ ersetzt oder weggelassen: ${list}${more}`,
    en: `Note: the embedded font can’t show ${bad.size} characters (e.g. Chinese, Arabic or Hebrew script, emoji). They were replaced by similar characters or “?”, or left out: ${list}${more}`,
  });
}

function textsOfModel(model) {
  const out = [];
  const walk = blocks => blocks.forEach(b => {
    if (b.type === 'para') b.runs.forEach(r => { if (r.text) out.push(r.text); });
    if (b.type === 'table') b.rows.forEach(row => row.forEach(c => walk(c.blocks)));
    if (b.type === 'section' || b.type === 'textbox') walk(b.blocks);
  });
  walk(model.blocks);
  return out;
}

export async function docxToPdf(bytes, name, ctx) {
  try {
    const { docxToHtml } = await import('./shared/office/docx-read.js');
    const { htmlToModel } = await import('./shared/office/docmodel.js');
    const { modelToPdf } = await import('./shared/office/docpdf.js');
    ctx.progress(0.1, { de: 'Dokument wird gelesen …', en: 'Reading the document …' });
    const r = await docxToHtml(bytes.slice().buffer, name);
    await ctx.tick();
    ctx.progress(0.35, { de: 'Seiten werden gesetzt …', en: 'Laying out the pages …' });
    const model = htmlToModel(r.html, { baseSize: r.baseSize });
    const texts = textsOfModel(model);
    if (r.hf) texts.push(r.hf.header || '', r.hf.footer || '');
    const bad = await unicodeReport(texts);
    const pdf = await modelToPdf(model, { title: name.replace(/\.docx?$/i, ''), page: r.page, hf: r.hf, onProgress: p => ctx.progress(0.35 + 0.6 * p, { de: 'Seiten werden gesetzt …', en: 'Laying out the pages …' }) });
    return { pdf, bad, stats: { images: (r.html.match(/<img\b/g) || []).length, tables: (r.html.match(/<table\b/g) || []).length, math: r.math || 0 } };
  } catch (err) { throw userError(err, 'The Word document could not be read. It may be damaged or use features this tool doesn’t support.'); }
}

/** Names of hidden sheets (workbook.xml state="hidden"/"veryHidden") – they are not printed. */
async function hiddenSheets(bytes) {
  try {
    const JSZip = await loadJSZip();
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('xl/workbook.xml')?.async('string');
    if (!xml) return new Set();
    return new Set([...xml.matchAll(/<sheet\b[^>]*>/g)].map(m => m[0]).filter(t => /state="(hidden|veryHidden)"/.test(t))
      .map(t => (/name="([^"]*)"/.exec(t) || [])[1]).filter(Boolean).map(n => n.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")));
  } catch { return new Set(); }
}

export async function xlsxToPdf(bytes, name, ctx, { sheets = null } = {}) {
  try {
    const { readXlsx } = await import('./shared/office/xlsx-read.js');
    const { workbookToPdf } = await import('./shared/office/sheetpdf.js');
    const { displayOf } = await import('./shared/office/workbook.js');
    ctx.progress(0.05, { de: 'Tabelle wird gelesen …', en: 'Reading the spreadsheet …' });
    const wb = await readXlsx(bytes.slice().buffer, name, p => ctx.progress(0.05 + 0.4 * p, { de: 'Tabelle wird gelesen …', en: 'Reading the spreadsheet …' }));
    await ctx.tick();
    const hidden = await hiddenSheets(bytes);
    const all = wb.sheets.length;
    wb.sheets = wb.sheets.filter(s => !hidden.has(s.name) && (!sheets || sheets.has(s.name)));
    if (!wb.sheets.length) throw Object.assign(new Error('no sheets'), { userMessage: { de: 'Die Tabelle enthält keine sichtbaren Blätter.', en: 'The spreadsheet has no visible sheets.' } });
    const texts = [];
    for (const sh of wb.sheets) {
      texts.push(sh.name);
      for (const cell of sh.cells.values()) { try { texts.push(displayOf(cell)); } catch { /* ignore */ } }
    }
    const bad = await unicodeReport(texts);
    ctx.progress(0.5, { de: 'PDF wird erstellt …', en: 'Creating the PDF …' });
    const pdf = await workbookToPdf(wb, { title: name.replace(/\.xlsx?$/i, ''), onProgress: p => ctx.progress(0.5 + 0.48 * p, { de: 'PDF wird erstellt …', en: 'Creating the PDF …' }) });
    const printed = wb.sheets.filter(s => s.maxR >= 0 || (s.charts && s.charts.length));
    return { pdf, bad, stats: { sheets: printed.length, hidden: hidden.size, empty: wb.sheets.length - printed.length, all } };
  } catch (err) { throw userError(err, 'The spreadsheet could not be read. It may be damaged or use features this tool doesn’t support.'); }
}

export async function pptxToPdf(bytes, name, ctx) {
  try {
    const { readPptx } = await import('./shared/office/pptx-read.js');
    const { presToPdf } = await import('./shared/office/slide-render.js');
    ctx.progress(0.05, { de: 'Präsentation wird gelesen …', en: 'Reading the presentation …' });
    const pres = await readPptx(bytes.slice().buffer, name, { onProgress: p => ctx.progress(0.05 + 0.35 * p, { de: 'Präsentation wird gelesen …', en: 'Reading the presentation …' }) });
    await ctx.tick();
    const texts = [];
    const walk = v => { if (typeof v === 'string') texts.push(v); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'src' && k !== 'image' && k !== 'fillImage') walk(x); };
    pres.slides.forEach(s => s.els.forEach(e => walk(e.text)));
    const bad = await unicodeReport(texts);
    const pdf = await presToPdf(pres, { title: name.replace(/\.pptx?$/i, ''), onProgress: p => ctx.progress(0.4 + 0.58 * p, { de: 'Folien werden gezeichnet …', en: 'Drawing the slides …' }) });
    return { pdf, bad, stats: { slides: pres.slides.length } };
  } catch (err) { throw userError(err, 'The presentation could not be read. It may be damaged or use features this tool doesn’t support.'); }
}
