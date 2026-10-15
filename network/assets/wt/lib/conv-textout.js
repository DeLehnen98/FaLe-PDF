// PDF → plain text / Markdown (tools pdf-to-text and pdf-to-markdown): reading order with paragraphs,
// two-column layouts, headings by font size, lists, tables; running heads/footers dropped on request.
import { analysePdf, dropRunningLines, buildModel, modelToPlainText, modelToMd } from './conv-pdfmodel.js';
import { PAGES_OPTION, coarsePointer, textPreview, fail } from './conv-common.js';

export function makeTextTool(kind) {
  const md = kind === 'markdown';
  return {
    options: [
      { ...PAGES_OPTION, when: (v, inputs) => inputs.length <= 1 },
      {
        id: 'pageMarks', type: 'toggle', default: !md,
        label: md ? { de: 'Trennlinie zwischen den Seiten', en: 'Rule between pages' } : { de: 'Seitenangaben einfügen', en: 'Insert page markers' },
        hint: md ? { de: 'Fügt nach jeder Seite eine Linie (---) ein.', en: 'Adds a line (---) after every page.' } : { de: 'Zeilen wie „—— Seite 2 ——“ zeigen, wo eine neue Seite beginnt.', en: 'Lines like “—— Page 2 ——” show where a new page starts.' },
      },
      {
        id: 'running', type: 'toggle', default: true,
        label: { de: 'Kopf- und Fußzeilen weglassen', en: 'Leave out headers and footers' },
        hint: { de: 'Seitenzahlen und Zeilen, die oben oder unten auf jeder Seite wiederkehren, stören den Lesefluss nicht mehr.', en: 'Page numbers and lines repeating at the top or bottom of every page no longer interrupt the text.' },
      },
    ],
    get shareFirst() { return coarsePointer(); },

    async run(inputs, opts, ctx) {
      const outputs = [];
      let scannedPages = 0, totalPages = 0, columns = 0;
      for (let f = 0; f < inputs.length; f++) {
        const input = inputs[f];
        const pdf = await input.pdfjs();
        const idx = inputs.length === 1 ? ctx.parsePages(opts.pages, pdf.numPages) : Array.from({ length: pdf.numPages }, (_, i) => i);
        const pre = inputs.length > 1 ? { de: `Datei ${f + 1} von ${inputs.length}: `, en: `File ${f + 1} of ${inputs.length}: ` } : { de: '', en: '' };
        const pages = await analysePdf(pdf, idx, ctx, {
          onPage: (k, n) => ctx.progress((f + k / n) / inputs.length, { de: `${pre.de}Seite ${k + 1} von ${n}`, en: `${pre.en}Page ${k + 1} of ${n}` }),
        });
        if (opts.running) dropRunningLines(pages);
        const { model, stats } = buildModel(pages, { tables: true, pageBreaks: true });
        scannedPages += pages.filter(p => p.chars < 15).length;
        totalPages += pages.length;
        columns += stats.columns;
        const text = md ? modelToMd(model, { pageMarks: opts.pageMarks }) : modelToPlainText(model, { pageMarks: opts.pageMarks, lang: ctx.lang });
        if (!text.trim()) continue;
        outputs.push({
          name: ctx.fileName(input.name, '', md ? 'md' : 'txt'),
          blob: new Blob([text], { type: md ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8' }),
          note: ctx.t(md
            ? { de: `${stats.headings} Überschriften · ${stats.lists} Listenpunkte · ${stats.tables} Tabellen`, en: `${stats.headings} headings · ${stats.lists} list items · ${stats.tables} tables` }
            : { de: `${pages.length} ${pages.length === 1 ? 'Seite' : 'Seiten'} · ${stats.paragraphs + stats.headings} Absätze`, en: `${pages.length} ${pages.length === 1 ? 'page' : 'pages'} · ${stats.paragraphs + stats.headings} paragraphs` }),
        });
        await ctx.tick();
      }
      if (!outputs.length) fail(
        'In dieser PDF ist kein Text gespeichert – vermutlich ist sie gescannt oder fotografiert. Nutze zuerst das Werkzeug „PDF Texterkennung (OCR)“ – es läuft ebenfalls nur auf deinem Gerät.',
        'This PDF contains no stored text – it is probably scanned or photographed. Run the “OCR PDF” tool first – it also works only on your device.');
      if (scannedPages) ctx.note({
        de: `${scannedPages} von ${totalPages} Seiten enthalten keinen Text (Scan oder Bild). Für sie hilft vorher das Werkzeug „PDF Texterkennung (OCR)“.`,
        en: `${scannedPages} of ${totalPages} pages contain no text (scan or image). Run the “OCR PDF” tool on them first.`,
      });
      if (columns) ctx.note({ de: 'Mehrspaltige Seiten wurden Spalte für Spalte gelesen.', en: 'Pages with several columns were read column by column.' });
      return { outputs };
    },

    onResult(result, res, ctx) { textPreview(result, res, ctx, { mono: md }); },
  };
}
