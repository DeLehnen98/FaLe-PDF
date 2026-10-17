// Tool: image → Excel (XLSX) or CSV via text recognition. A photographed or screenshotted table becomes a real
// spreadsheet: rows by baseline, columns by empty vertical bands (also tables without ruling lines – the same
// detection as "PDF in Excel", lib/conv-tables.js, fed with the OCR words). Numbers in German or English format,
// amounts (€, $), percentages and dates become real values with formats. A sum row ("Summe", "Gesamt", "Total")
// is checked against the column above and differences are reported. Several images → one sheet each or all on
// one sheet. Runs locally (tesseract.js via lib/new-ocr.js) – nothing is uploaded.
import { loadCanvas, release } from '../lib/img-core.js';
import { userError } from '../lib/new-ui.js';
import { LANG_OPTION, loadOcr, ocrBest } from './ocr-pdf.js';
import { ocrItems } from './image-to-word.js';
import { analyseItems } from '../lib/conv-pdfmodel.js';
import { detectTables, regionRows, smartValue } from '../lib/conv-tables.js';
import { writeXlsx, toCsv } from '../lib/conv-xlsx.js';
import { tablePreview } from '../lib/conv-common.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SUM_RE = /^(summe|gesamt|gesamtsumme|total|sum|insgesamt|endbetrag)\b/i;

/** Sum rows that do not match the numbers above them: [{ row, col, want, got }]. */
export function checkSums(rows) {
  const bad = [];
  rows.forEach((row, ri) => {
    if (!row.length || !SUM_RE.test(String(row[0] || '').trim())) return;
    for (let c = 1; c < row.length; c++) {
      const got = smartValue(row[c] || '').v;
      if (typeof got !== 'number') continue;
      let sum = 0, n = 0;
      for (let k = ri - 1; k >= 0; k--) {
        if (!rows[k].length || SUM_RE.test(String(rows[k][0] || '').trim())) break;
        const v = smartValue(rows[k][c] || '').v;
        if (typeof v === 'number') { sum += v; n++; }
      }
      if (n >= 2 && Math.abs(sum - got) > Math.max(0.011, Math.abs(got) * 1e-6)) bad.push({ row: ri + 1, col: c + 1, want: Math.round(sum * 100) / 100, got });
    }
  });
  return bad;
}

const colName = c => { let s = ''; for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

export default {
  options: [
    LANG_OPTION,
    { id: 'mode', type: 'radio', default: 'tables', label: { de: 'Was übernehmen?', en: 'What to take over?' },
      choices: [
        { value: 'tables', label: { de: 'Nur Tabellen', en: 'Tables only' }, hint: { de: 'Erkannte Tabellen, ohne Text drumherum', en: 'Detected tables, without the text around them' } },
        { value: 'all', label: { de: 'Alles', en: 'Everything' }, hint: { de: 'Jede Textzeile wird eine Zeile, Spalten wo sie ausgerichtet sind', en: 'Every text line becomes a row, columns where they line up' } },
      ] },
    { id: 'sheets', type: 'radio', default: 'one', when: (v, inputs) => inputs.length > 1, label: { de: 'Tabellenblätter', en: 'Sheets' },
      choices: [
        { value: 'one', label: { de: 'Alles auf einem Blatt', en: 'All on one sheet' }, hint: { de: 'Fotos einer langen Liste nacheinander', en: 'Photos of one long list in a row' } },
        { value: 'images', label: { de: 'Ein Blatt pro Bild', en: 'One sheet per image' } },
      ] },
    { id: 'format', type: 'radio', default: 'xlsx', label: { de: 'Format', en: 'Format' },
      choices: [
        { value: 'xlsx', label: { de: 'Excel (XLSX)', en: 'Excel (XLSX)' }, hint: { de: 'Mit echten Zahlen, Datum und Währung', en: 'With real numbers, dates and currency' } },
        { value: 'csv', label: 'CSV', hint: { de: 'Einfacher Text, für jede Tabellen-App', en: 'Plain text, for any spreadsheet app' } },
      ] },
  ],

  async run(inputs, opts, ctx) {
    const ocr = await loadOcr();
    const per = [];   // per image: { name, tables: [{ rows, header }] }
    let fellBack = 0;
    for (const [i, input] of inputs.entries()) {
      const pre = { de: `Bild ${i + 1} von ${inputs.length}`, en: `Image ${i + 1} of ${inputs.length}` };
      ctx.progress(i / inputs.length, { de: `${pre.de} wird vorbereitet …`, en: `${pre.en} is being prepared …` });
      const { canvas } = await loadCanvas(input, { maxPixels: 24e6 });
      const W = canvas.width, H = canvas.height;
      let res;
      try {
        res = await ocrBest(ocr, canvas, { lang: opts.lang, signal: ctx.signal,
          onProgress: (phase, p) => ctx.progress((i + (phase === 'recognize' ? p * 0.9 : 0)) / inputs.length, { de: `${pre.de} · Text wird erkannt …`, en: `${pre.en} · Recognising text …` }) });
      } finally { release(canvas); }
      const { items, width, height } = ocrItems(res, W, H);
      const page = analyseItems(items, width, height, i);
      const lines = page.regions.flatMap(r => r.lines);
      let tables = opts.mode === 'tables' ? page.regions.flatMap(r => detectTables(r.lines, { minRows: 2 })).map(t => ({ rows: t.rows, header: t.header })) : [];
      if (!tables.length && lines.length) { tables = [{ rows: regionRows(lines), header: false }]; if (opts.mode === 'tables') fellBack++; }
      per.push({ name: input.name, tables });
      await ctx.tick();
    }
    if (!per.some(p => p.tables.length)) throw userError(
      'In den Bildern wurde kein Text gefunden. Achte auf ein scharfes, gerade aufgenommenes Foto der Tabelle.',
      'No text was found in the images. Use a sharp photo of the table taken straight on.');
    const word = ctx.lang === 'de' ? 'Bild' : 'Image';
    const groups = inputs.length > 1 && opts.sheets === 'images'
      ? per.filter(p => p.tables.length).map((p, k) => ({ name: `${word} ${k + 1}`, tables: p.tables }))
      : [{ name: ctx.lang === 'de' ? 'Tabelle' : 'Table', tables: per.flatMap(p => p.tables) }];
    const sheets = groups.map(g => {
      const rows = [];
      let headerKey = null;
      g.tables.forEach((t, ti) => {
        let tr = t.rows;
        const key = t.header ? tr[0].join('\u0001') : null;
        if (ti > 0 && key && key === headerKey) tr = tr.slice(1);   // the same header on the next photo
        else if (ti > 0) rows.push([]);
        tr.forEach((r, ri) => rows.push(r.map(s => {
          if (opts.format === 'csv') return s;
          if (t.header && ri === 0 && !(ti > 0 && key === headerKey)) return s ? { v: s, b: true } : null;
          const sv = smartValue(s);
          return sv.v == null ? null : sv;
        })));
        if (key) headerKey = key;
      });
      return { name: g.name, rows, raw: g.tables.flatMap(t => t.rows) };
    });
    const base = inputs.length === 1 ? inputs[0].name : ctx.t({ de: 'Tabelle aus Bildern', en: 'Table from images' });
    const outputs = [];
    if (opts.format === 'csv') {
      sheets.forEach((sh, k) => {
        const suffix = sheets.length > 1 ? `-${k + 1}` : '';
        outputs.push({ name: ctx.fileName(base, suffix, 'csv'), blob: new Blob([toCsv(sh.rows, ctx.lang)], { type: 'text/csv;charset=utf-8' }), note: ctx.t({ de: `${sh.rows.length} Zeilen`, en: `${sh.rows.length} rows` }) });
      });
    } else {
      const blob = await writeXlsx(sheets.map(({ name, rows }) => ({ name, rows })), { title: base.replace(/\.[^.]+$/, '') });
      const nRows = sheets.reduce((s, sh) => s + sh.rows.filter(r => r.length).length, 0);
      outputs.push({ name: ctx.fileName(base, '', 'xlsx'), blob: new Blob([blob], { type: XLSX }),
        note: ctx.t({ de: `${nRows} Zeilen · ${sheets.length} ${sheets.length === 1 ? 'Blatt' : 'Blätter'}`, en: `${nRows} rows · ${sheets.length} ${sheets.length === 1 ? 'sheet' : 'sheets'}` }) });
    }
    // plausibility: sum rows
    const sumIssues = sheets.flatMap(sh => checkSums(sh.raw).map(b => ({ ...b, sheet: sh.name })));
    if (sumIssues.length) {
      const list = sumIssues.slice(0, 4).map(b => `${colName(b.col)}${b.row}: ${b.got.toLocaleString(ctx.lang === 'de' ? 'de-DE' : 'en-GB')} ≠ ${b.want.toLocaleString(ctx.lang === 'de' ? 'de-DE' : 'en-GB')}`).join(', ');
      ctx.note({ de: `Summenprüfung: ${list} – da wurde vermutlich eine Zahl falsch gelesen. Bitte im Foto nachsehen.`, en: `Sum check: ${list} – a number was probably misread. Please check against the photo.` });
    }
    if (fellBack) ctx.note({ de: 'Nicht überall wurde eine klare Tabelle gefunden – dort ist der ganze Text übernommen, mit Spalten wo sie ausgerichtet sind.', en: 'A clear table was not found everywhere – there all text was taken over, with columns where they line up.' });
    ctx.note({ de: 'Tipp: Fotografiere die Tabelle gerade von oben und gut beleuchtet. Prüf Zahlen kurz – Texterkennung kann sich bei 1/7 oder 0/O vertun.', en: 'Tip: photograph the table straight from above in good light. Give the numbers a quick check – recognition can mix up 1/7 or 0/O.' });
    outputs[0].meta = { tables: per.flatMap(p => p.tables).slice(0, 3).map((t, k) => ({ rows: t.rows, caption: `${word} ${k + 1}` })) };
    return { outputs };
  },

  onResult(result, res, ctx) {
    const tables = res.outputs[0]?.meta?.tables;
    if (tables?.length) tablePreview(result, tables, ctx);
  },
};
