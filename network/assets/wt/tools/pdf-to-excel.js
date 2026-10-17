// Tool: PDF → Excel (XLSX) or CSV. Tables are found from the text positions (lib/conv-tables.js):
// rows by baseline, columns by empty vertical bands. Numbers, amounts (€, $), percentages and dates
// become real numbers with formats; tables that continue over several pages are joined (repeated
// header rows dropped). "Gesamte Seite" takes over every line, with columns where they line up.
import { analysePdf } from '../lib/conv-pdfmodel.js';
import { detectTables, regionRows, smartValue } from '../lib/conv-tables.js';
import { writeXlsx, toCsv } from '../lib/conv-xlsx.js';
import { PAGES_OPTION, coarsePointer, tablePreview, fail, userError } from '../lib/conv-common.js';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export default {
  options: [
    { ...PAGES_OPTION, when: (v, inputs) => inputs.length <= 1 },
    {
      id: 'mode', type: 'radio', default: 'tables',
      label: { de: 'Was übernehmen?', en: 'What to take over?' },
      choices: [
        { value: 'tables', label: { de: 'Nur Tabellen', en: 'Tables only' }, hint: { de: 'Erkannte Tabellen, ohne Fließtext drumherum', en: 'Detected tables, without the text around them' } },
        { value: 'all', label: { de: 'Gesamte Seite', en: 'Whole page' }, hint: { de: 'Jede Textzeile wird eine Zeile, Spalten wo sie ausgerichtet sind', en: 'Every text line becomes a row, columns where they line up' } },
      ],
    },
    {
      id: 'sheets', type: 'radio', default: 'one',
      label: { de: 'Tabellenblätter', en: 'Sheets' },
      choices: [
        { value: 'one', label: { de: 'Alles auf einem Blatt', en: 'All on one sheet' }, hint: { de: 'Ideal für lange Listen über mehrere Seiten', en: 'Ideal for long lists over several pages' } },
        { value: 'pages', label: { de: 'Ein Blatt pro Seite', en: 'One sheet per page' }, hint: { de: 'Übersichtlich bei Berichten', en: 'Clear for reports' } },
      ],
    },
    {
      id: 'format', type: 'radio', default: 'xlsx',
      label: { de: 'Format', en: 'Format' },
      choices: [
        { value: 'xlsx', label: { de: 'Excel (XLSX)', en: 'Excel (XLSX)' }, hint: { de: 'Mit echten Zahlen, Datum und Währung', en: 'With real numbers, dates and currency' } },
        { value: 'csv', label: 'CSV', hint: { de: 'Einfacher Text, für jede Tabellen-App', en: 'Plain text, for any spreadsheet app' } },
      ],
    },
  ],
  get shareFirst() { return coarsePointer(); },

  async run(inputs, opts, ctx) {
    const outputs = [];
    let fellBack = false, scanned = 0;
    const previews = [];
    for (let f = 0; f < inputs.length; f++) {
      const input = inputs[f];
      const pdf = await input.pdfjs();
      const idx = inputs.length === 1 ? ctx.parsePages(opts.pages, pdf.numPages) : Array.from({ length: pdf.numPages }, (_, i) => i);
      const pre = inputs.length > 1 ? { de: `Datei ${f + 1} von ${inputs.length}: `, en: `File ${f + 1} of ${inputs.length}: ` } : { de: '', en: '' };
      const pages = await analysePdf(pdf, idx, ctx, {
        onPage: (k, n) => ctx.progress((f + 0.9 * k / n) / inputs.length, { de: `${pre.de}Seite ${k + 1} von ${n}`, en: `${pre.en}Page ${k + 1} of ${n}` }),
      });
      scanned += pages.filter(p => p.chars < 15).length;
      // per page: list of tables {rows, header}
      let mode = opts.mode;
      // page by page with a pause in between – long documents must not freeze the page
      const perPage = async () => {
        const out = [];
        for (const [k, p] of pages.entries()) {
          if (mode === 'all') {
            const lines = p.regions.flatMap(r => r.lines);
            out.push(lines.length ? [{ rows: regionRows(lines), header: false, page: p.index }] : []);
          } else out.push(p.regions.flatMap(r => detectTables(r.lines)).map(t => ({ rows: t.rows, header: t.header, page: p.index })));
          if (k % 4 === 3) await ctx.tick();
        }
        return out;
      };
      let found = await perPage();
      if (mode === 'tables' && !found.some(t => t.length)) { mode = 'all'; found = await perPage(); fellBack = true; }
      if (!found.some(t => t.length)) continue;
      const sheets = [];
      const word = ctx.lang === 'de' ? 'Seite' : 'Page';
      if (opts.sheets === 'pages') {
        found.forEach((tables, k) => { if (tables.length) sheets.push({ name: `${word} ${pages[k].index + 1}`, tables }); });
      } else sheets.push({ name: ctx.lang === 'de' ? 'Tabelle' : 'Table', tables: found.flat() });
      // join tables: continuation over pages (same column count) → no blank row, repeated header dropped
      const sheetRows = sheets.map(sh => {
        const rows = [];
        let prev = null, headerKey = null;
        for (const t of sh.tables) {
          let tr = t.rows;
          const key = t.header ? tr[0].join('\u0001') : null;
          const cont = prev && prev.rows[0].length === tr[0].length && t.page !== prev.page && mode === 'tables';
          if (cont && key && key === headerKey) tr = tr.slice(1);
          else if (prev) rows.push([]);
          tr.forEach((r, ri) => rows.push(r.map(s => {
            const isHead = t.header && ri === 0 && !(cont && key === headerKey);
            if (opts.format === 'csv') return s;
            if (isHead) return s ? { v: s, b: true } : null;
            const sv = smartValue(s);
            return sv.v == null ? null : sv;
          })));
          if (key && !(cont && key === headerKey)) headerKey = key;
          prev = t;
        }
        return { name: sh.name, rows, header: !!sh.tables[0]?.header };
      });
      previews.push(...sheets.flatMap(sh => sh.tables).slice(0, 3).map(t => ({ rows: t.rows, caption: `${word} ${t.page + 1}` })));
      const base = input.name;
      try {
        if (opts.format === 'csv') {
          sheetRows.forEach((sh, k) => {
            const suffix = sheetRows.length > 1 ? `-${sh.name.replace(/\s+/g, '-').toLowerCase()}` : '';
            outputs.push({ name: ctx.fileName(base, suffix, 'csv'), blob: new Blob([toCsv(sh.rows, ctx.lang)], { type: 'text/csv;charset=utf-8' }), note: ctx.t({ de: `${sh.rows.length} Zeilen`, en: `${sh.rows.length} rows` }) });
          });
        } else {
          const blob = await writeXlsx(sheetRows, { title: base.replace(/\.pdf$/i, '') });
          const nRows = sheetRows.reduce((s, sh) => s + sh.rows.filter(r => r.length).length, 0);
          const nTables = found.flat().length;
          outputs.push({
            name: ctx.fileName(base, '', 'xlsx'), blob: new Blob([blob], { type: XLSX }),
            note: ctx.t(mode === 'tables'
              ? { de: `${nTables} ${nTables === 1 ? 'Tabelle' : 'Tabellen'} · ${nRows} Zeilen · ${sheetRows.length} ${sheetRows.length === 1 ? 'Blatt' : 'Blätter'}`, en: `${nTables} ${nTables === 1 ? 'table' : 'tables'} · ${nRows} rows · ${sheetRows.length} ${sheetRows.length === 1 ? 'sheet' : 'sheets'}` }
              : { de: `${nRows} Zeilen · ${sheetRows.length} ${sheetRows.length === 1 ? 'Blatt' : 'Blätter'}`, en: `${nRows} rows · ${sheetRows.length} ${sheetRows.length === 1 ? 'sheet' : 'sheets'}` }),
          });
        }
      } catch (err) { throw userError(err, 'The spreadsheet could not be created.'); }
      for (const p of pages) p.page?.cleanup();
      await ctx.tick();
    }
    if (!outputs.length) fail(
      'In dieser PDF ist kein Text gespeichert – vermutlich ist sie gescannt. Tabellen lassen sich nur aus PDFs mit echtem Text auslesen. Eine Texterkennung (OCR) bietet die FaLe PDF-App.',
      'This PDF contains no stored text – it is probably scanned. Tables can only be read from PDFs with real text. The FaLe PDF app offers text recognition (OCR).');
    if (fellBack) ctx.note({ de: 'Es wurden keine klaren Tabellen gefunden – deshalb ist der gesamte Text der Seiten übernommen, mit Spalten wo sie ausgerichtet sind.', en: 'No clear tables were found – so all text of the pages was taken over, with columns where they line up.' });
    if (scanned) ctx.note({ de: `${scanned} Seiten ohne Text (Scan) wurden übersprungen.`, en: `${scanned} pages without text (scans) were skipped.` });
    ctx.note({ de: 'Tabellen werden an der Ausrichtung des Textes erkannt. Verbundene Zellen und mehrzeilige Zellen können getrennt ankommen – ein kurzer Blick lohnt sich.', en: 'Tables are recognised by how the text is aligned. Merged cells and cells with several lines may arrive split – a quick look is worth it.' });
    if (outputs[0] && previews.length) outputs[0].meta = { tables: previews };
    return { outputs };
  },

  onResult(result, res, ctx) {
    const tables = res.outputs[0]?.meta?.tables;
    if (tables?.length) tablePreview(result, tables, ctx);
  },
};
