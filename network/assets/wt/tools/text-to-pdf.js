// Tool: text files → PDF. Plain text (TXT, logs …), Markdown (headings, lists, tables, code, quotes,
// links) and CSV/TSV (as a table). Page size, font size, margins, font (sans, serif, monospace),
// page numbers. Unicode: Latin, Greek and Cyrillic via an embedded font subset (lib/conv-textpdf.js);
// characters no font covers are listed in a note.
import { layoutPdf } from '../lib/conv-textpdf.js';
import { fileTile } from '../lib/conv-office.js';
import { coarsePointer, pdfPagesPreview, fail } from '../lib/conv-common.js';
import { extension } from '../lib/format.js';

const kindOf = name => { const e = extension(name); return e === 'md' || e === 'markdown' ? 'md' : e === 'csv' || e === 'tsv' ? 'csv' : 'txt'; };

/** Text with encoding detection: BOM, UTF-8, else Windows-1252. */
async function readText(input) {
  const b = await input.bytes();
  if (b[0] === 0xff && b[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(b.subarray(2)), enc: 'UTF-16' };
  if (b[0] === 0xfe && b[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(b.subarray(2)), enc: 'UTF-16' };
  const start = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 3 : 0;
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(start)), enc: 'UTF-8' }; } catch {
    return { text: new TextDecoder('windows-1252').decode(b), enc: 'Windows-1252' };
  }
}

function looksBinary(b) {
  const n = Math.min(b.length, 4096);
  if (b[0] === 0xff && b[1] === 0xfe || b[0] === 0xfe && b[1] === 0xff) return false;
  let bad = 0;
  for (let i = 0; i < n; i++) { const c = b[i]; if (c === 0 || (c < 32 && c !== 9 && c !== 10 && c !== 13 && c !== 12)) bad++; }
  return bad > n * 0.01;
}

/** CSV/TSV parser with quotes; the delimiter is detected from the first lines. */
export function parseCsv(text) {
  const sample = text.split(/\r?\n/).slice(0, 10).join('\n');
  const count = d => (sample.match(new RegExp(d === '|' ? '\\|' : d === '\t' ? '\t' : d, 'g')) || []).length;
  const delim = ['\t', ';', ',', '|'].reduce((best, d) => (count(d) > count(best) ? d : best), ',');
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"' && !cell) q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}

async function markdownBlocks(text) {
  await import('../lib/conv-office-shim.js'); // safe DOMParser (Trusted Types) for htmlToModel
  const { markdownToHtml, htmlToModel } = await import('../lib/shared/office/docmodel.js');
  const model = htmlToModel(markdownToHtml(text), { baseSize: 11 });
  const out = [];
  const convRuns = runs => runs.map(r => (r.br ? { br: true } : { text: r.text || '', b: !!r.b, i: !!r.i, mono: !!r.mono, s: !!r.s, href: r.href || null }));
  for (const b of model.blocks) {
    if (b.type === 'para') out.push({ type: 'para', tag: b.tag, runs: convRuns(b.runs), list: b.list ? { ordered: b.list.ordered, level: b.list.level, index: b.list.index } : null, align: b.align || null });
    else if (b.type === 'table') out.push({ type: 'table', header: true, rows: b.rows.map(r => r.map(c => c.blocks.map(x => (x.runs || []).map(q => q.text || '').join('')).join(' '))) });
    else if (b.type === 'hr' || b.type === 'pagebreak') out.push({ type: b.type });
  }
  return out;
}

const plainBlocks = text => text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map(line => (line.includes('\f')
  ? { type: 'pagebreak' } : { type: 'para', tag: 'p', runs: [{ text: line }] }));

export default {
  options: [
    {
      id: 'font', type: 'radio', default: 'sans',
      label: { de: 'Schrift', en: 'Font' },
      choices: [
        { value: 'sans', label: { de: 'Serifenlos', en: 'Sans serif' }, hint: { de: 'Klar und modern', en: 'Clear and modern' } },
        { value: 'serif', label: { de: 'Mit Serifen', en: 'Serif' }, hint: { de: 'Klassisch, wie im Buch', en: 'Classic, like a book' } },
        { value: 'mono', label: { de: 'Festbreite', en: 'Monospace' }, hint: { de: 'Für Code, Logs und Listen', en: 'For code, logs and lists' } },
      ],
    },
    {
      id: 'size', type: 'range', min: 8, max: 16, step: 0.5, default: 11, unit: 'pt',
      label: { de: 'Schriftgröße', en: 'Font size' },
      format: v => `${String(v).replace('.', ',')} pt`,
    },
    {
      id: 'page', type: 'select', default: 'a4',
      label: { de: 'Seitenformat', en: 'Page size' },
      choices: [{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }, { value: 'a5', label: 'A5' }],
    },
    {
      id: 'margin', type: 'radio', default: '20',
      label: { de: 'Ränder', en: 'Margins' },
      choices: [
        { value: '12', label: { de: 'Schmal', en: 'Narrow' }, hint: '12 mm' },
        { value: '20', label: { de: 'Normal', en: 'Normal' }, hint: '20 mm' },
        { value: '30', label: { de: 'Breit', en: 'Wide' }, hint: '30 mm' },
      ],
    },
    {
      id: 'markdown', type: 'toggle', default: true,
      when: (v, inputs) => inputs.some(i => kindOf(i.name) === 'md'),
      label: { de: 'Markdown formatieren', en: 'Format Markdown' },
      hint: { de: 'Überschriften, Listen, Tabellen, fett und kursiv werden gesetzt. Aus: Der Text erscheint unverändert.', en: 'Headings, lists, tables, bold and italic are typeset. Off: the text appears as it is.' },
    },
    { id: 'pageNumbers', type: 'toggle', default: true, label: { de: 'Seitenzahlen', en: 'Page numbers' } },
  ],
  get shareFirst() { return coarsePointer(); },

  async prepareOther(input) {
    const b = await input.bytes();
    if (looksBinary(b)) throw Object.assign(new Error('binary'), { userMessage: { de: `„${input.name}“ ist keine Textdatei.`, en: `“${input.name}” is not a text file.` } });
    const k = kindOf(input.name);
    return fileTile(k === 'md' ? 'MD' : k === 'csv' ? 'CSV' : 'TXT', k === 'md' ? '#3D34B8' : k === 'csv' ? '#1E7145' : '#5E6383');
  },

  async run(inputs, opts, ctx) {
    const outputs = [];
    const replaced = new Map();
    let unicode = false, cp1252 = 0;
    for (let f = 0; f < inputs.length; f++) {
      const input = inputs[f];
      ctx.progress(f / inputs.length, { de: `Datei ${f + 1} von ${inputs.length}`, en: `File ${f + 1} of ${inputs.length}` });
      const { text, enc } = await readText(input);
      if (enc === 'Windows-1252') cp1252++;
      const kind = kindOf(input.name);
      let blocks, landscape = false, plain = false;
      if (kind === 'csv') {
        const rows = parseCsv(text);
        if (!rows.length) fail(`„${input.name}“ ist leer.`, `“${input.name}” is empty.`);
        blocks = [{ type: 'table', header: true, rows }];
        landscape = Math.max(...rows.map(r => r.length)) > 6;
      } else if (kind === 'md' && opts.markdown) blocks = await markdownBlocks(text);
      else { blocks = plainBlocks(text); plain = true; }
      if (!blocks.length || (!text.trim())) fail(`„${input.name}“ ist leer.`, `“${input.name}” is empty.`);
      const r = await layoutPdf(blocks, {
        page: opts.page, size: Number(opts.size) || 11, margin: Number(opts.margin) || 20, family: opts.font, pageNumbers: opts.pageNumbers,
        plain, landscape, title: input.name.replace(/\.[^.]+$/, ''), tick: ctx.tick,
        onProgress: p => ctx.progress((f + p * 0.95) / inputs.length, { de: `Datei ${f + 1} von ${inputs.length}: Seiten werden gesetzt`, en: `File ${f + 1} of ${inputs.length}: laying out pages` }),
      });
      r.replaced.forEach((n, ch) => replaced.set(ch, (replaced.get(ch) || 0) + n));
      unicode = unicode || r.unicodeFont;
      outputs.push({ name: ctx.fileName(input.name, '', 'pdf'), blob: new Blob([r.bytes], { type: 'application/pdf' }), pages: r.pages, meta: { preview: f === 0 } });
      await ctx.tick();
    }
    if (replaced.size) {
      const list = [...replaced.keys()].slice(0, 24).join(' ');
      ctx.note({
        de: `Achtung: ${replaced.size} ${replaced.size === 1 ? 'Zeichen kann' : 'Zeichen können'} mit den eingebauten Schriften nicht dargestellt werden und ${replaced.size === 1 ? 'wurde' : 'wurden'} ersetzt (ähnliches Zeichen oder „?“): ${list}${replaced.size > 24 ? ' …' : ''}`,
        en: `Note: ${replaced.size} ${replaced.size === 1 ? 'character' : 'characters'} can’t be shown with the built-in fonts and ${replaced.size === 1 ? 'was' : 'were'} replaced (similar character or “?”): ${list}${replaced.size > 24 ? ' …' : ''}`,
      });
    }
    if (unicode) ctx.note({ de: 'Für Sonderzeichen außerhalb des westeuropäischen Zeichensatzes ist eine passende Schrift eingebettet.', en: 'A matching font is embedded for special characters outside the Western European character set.' });
    if (cp1252) ctx.note({ de: 'Die Datei war nicht in UTF-8 gespeichert und wurde als Windows-Zeichensatz gelesen.', en: 'The file was not saved as UTF-8 and was read with the Windows character set.' });
    return { outputs };
  },

  onResult(result, res, ctx) {
    const o = res.outputs.find(x => x.meta?.preview) || res.outputs[0];
    if (o) pdfPagesPreview(result, o.blob, ctx);
  },
};
