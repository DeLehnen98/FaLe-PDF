// Tool: PDF → Word (DOCX).
//   editable  text as paragraphs with headings (font size), bold/italic, lists, tables, images at their
//             place, page breaks; two-column pages read column by column; scanned pages as images.
//             Written with the app's DOCX writer (lib/shared/office/docx-write.js → vendored docx library).
//   exact     every page as a picture on its own page – looks exactly like the PDF, not editable.
import { analysePdf, dropRunningLines, buildModel } from '../lib/conv-pdfmodel.js';
import { PAGES_OPTION, coarsePointer, fail, userError } from '../lib/conv-common.js';
import { modelPreview } from '../lib/conv-docpreview.js';
import { renderPage, canvasToBlob } from '../lib/pdf.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const TW = 20, PX = 96 / 72;

export default {
  options: [
    { ...PAGES_OPTION, when: (v, inputs) => inputs.length <= 1 },
    {
      id: 'mode', type: 'radio', default: 'editable',
      label: { de: 'Art der Umwandlung', en: 'Conversion' },
      choices: [
        { value: 'editable', label: { de: 'Bearbeitbar', en: 'Editable' }, hint: { de: 'Text, Überschriften, Listen, Tabellen und Bilder zum Weiterschreiben – das Layout wird vereinfacht', en: 'Text, headings, lists, tables and images to keep writing – the layout is simplified' } },
        { value: 'exact', label: { de: 'Originalgetreu', en: 'Exact look' }, hint: { de: 'Jede Seite als Bild – sieht genau aus wie die PDF, ist aber nicht bearbeitbar', en: 'Every page as a picture – looks exactly like the PDF but is not editable' } },
      ],
    },
    {
      id: 'images', type: 'toggle', default: true, when: v => v.mode !== 'exact',
      label: { de: 'Bilder übernehmen', en: 'Include images' },
    },
    {
      id: 'running', type: 'toggle', default: true, when: v => v.mode !== 'exact',
      label: { de: 'Kopf- und Fußzeilen weglassen', en: 'Leave out headers and footers' },
      hint: { de: 'Seitenzahlen und Zeilen, die auf jeder Seite wiederkehren, stören im Fließtext.', en: 'Page numbers and lines repeating on every page get in the way in running text.' },
    },
  ],
  get shareFirst() { return coarsePointer(); },

  async run(inputs, opts, ctx) {
    const outputs = [];
    let scanned = 0, total = 0;
    for (let f = 0; f < inputs.length; f++) {
      const input = inputs[f];
      const pdf = await input.pdfjs();
      const idx = inputs.length === 1 ? ctx.parsePages(opts.pages, pdf.numPages) : Array.from({ length: pdf.numPages }, (_, i) => i);
      const pre = inputs.length > 1 ? { de: `Datei ${f + 1} von ${inputs.length}: `, en: `File ${f + 1} of ${inputs.length}: ` } : { de: '', en: '' };
      const prog = (frac, text) => ctx.progress((f + Math.min(1, frac)) / inputs.length, { de: pre.de + text.de, en: pre.en + text.en });
      let blob, meta = null, note;
      try {
        if (opts.mode === 'exact') {
          blob = await buildExact(pdf, idx, ctx, prog);
          note = ctx.t({ de: `${idx.length} ${idx.length === 1 ? 'Seite' : 'Seiten'} als Bild`, en: `${idx.length} ${idx.length === 1 ? 'page' : 'pages'} as pictures` });
        } else {
          const pages = await analysePdf(pdf, idx, ctx, {
            images: opts.images,
            onPage: (k, n) => prog(0.75 * k / n, { de: `Seite ${k + 1} von ${n} wird analysiert`, en: `Analysing page ${k + 1} of ${n}` }),
          });
          if (opts.running) dropRunningLines(pages);
          // scanned pages (no text) → page picture
          const scans = new Map();
          for (const p of pages) {
            if (p.chars >= 15) continue;
            const page = p.page || await pdf.getPage(p.index + 1);
            const canvas = await renderPage(page, { scale: 150 / 72, signal: ctx.signal });
            const url = canvas.toDataURL('image/jpeg', 0.85);
            canvas.width = canvas.height = 0;
            const s = Math.min(1, (p.width - 108) / p.width);
            scans.set(p.index, { url, w: Math.round(p.width * s * PX), h: Math.round(p.height * s * PX) });
          }
          scanned += scans.size;
          total += pages.length;
          const { model, stats } = buildModel(pages, { tables: true, pageBreaks: true, scanImages: scans });
          for (const p of pages) p.page?.cleanup();
          if (!model.blocks.some(b => b.type !== 'pagebreak')) fail('In dieser PDF wurde nichts Übertragbares gefunden.', 'Nothing convertible was found in this PDF.');
          prog(0.8, { de: 'Word-Datei wird geschrieben …', en: 'Writing the Word file …' });
          const first = pages[0];
          const allLines = pages.flatMap(p => p.regions.flatMap(r => r.lines));
          const minX = allLines.length ? Math.min(...allLines.map(l => l.x0)) : 72;
          const margin = Math.max(36, Math.min(90, minX));
          const pageSetup = { w: first.width, h: first.height, mt: margin, mr: margin, mb: margin, ml: margin };
          const { modelToDocx } = await import('../lib/shared/office/docx-write.js');
          blob = await modelToDocx(model, { title: input.name.replace(/\.pdf$/i, ''), page: pageSetup });
          meta = { model };
          note = ctx.t({
            de: `${stats.headings} Überschriften · ${stats.paragraphs} Absätze · ${stats.lists} Listenpunkte · ${stats.tables} Tabellen · ${stats.images + stats.scanned} Bilder`,
            en: `${stats.headings} headings · ${stats.paragraphs} paragraphs · ${stats.lists} list items · ${stats.tables} tables · ${stats.images + stats.scanned} images`,
          });
        }
      } catch (err) { throw userError(err, 'The Word file could not be created.'); }
      outputs.push({ name: ctx.fileName(input.name, '', 'docx'), blob: new Blob([blob], { type: DOCX }), meta, note });
      await ctx.tick();
    }
    if (opts.mode !== 'exact') {
      ctx.note({ de: 'Einfache Layouts werden gut übernommen. Bei komplexen Seiten (Spalten, Textfelder, übereinanderliegende Elemente) wird das Layout vereinfacht – prüf das Ergebnis kurz.', en: 'Simple layouts come across well. With complex pages (columns, text boxes, overlapping elements) the layout is simplified – give the result a quick check.' });
      if (scanned) ctx.note({ de: `${scanned} von ${total} Seiten sind gescannt (kein Text) und wurden als Bild eingefügt. Um sie bearbeitbar zu machen, braucht es eine Texterkennung (OCR) – die FaLe PDF-App kann das offline.`, en: `${scanned} of ${total} pages are scanned (no text) and were inserted as pictures. To make them editable they need text recognition (OCR) – the FaLe PDF app does that offline.` });
    }
    return { outputs };
  },

  onResult(result, res, ctx) {
    const o = res.outputs[0];
    if (o?.meta?.model) modelPreview(result, o.meta.model, ctx);
  },
};

async function buildExact(pdf, idx, ctx, prog) {
  const { loadDocx } = await import('../lib/shared/office/vendor.js');
  const D = await loadDocx();
  const sections = [];
  for (let k = 0; k < idx.length; k++) {
    prog(k / idx.length * 0.9, { de: `Seite ${k + 1} von ${idx.length}`, en: `Page ${k + 1} of ${idx.length}` });
    const page = await pdf.getPage(idx[k] + 1);
    const vp = page.getViewport({ scale: 1 });
    const canvas = await renderPage(page, { scale: 170 / 72, signal: ctx.signal });
    const data = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', 0.9)).arrayBuffer());
    canvas.width = canvas.height = 0;
    page.cleanup();
    sections.push({
      properties: { page: { size: { width: Math.round(vp.width * TW), height: Math.round(vp.height * TW), orientation: vp.width > vp.height ? D.PageOrientation.LANDSCAPE : D.PageOrientation.PORTRAIT }, margin: { top: 0, right: 0, bottom: 0, left: 0, header: 0, footer: 0 } } },
      children: [new D.Paragraph({ spacing: { before: 0, after: 0, line: 240, lineRule: D.LineRuleType.AUTO }, children: [new D.ImageRun({ type: 'jpg', data, transformation: { width: Math.floor(vp.width * PX) - 1, height: Math.floor(vp.height * PX) - 2 } })] })],
    });
    await ctx.tick();
  }
  prog(0.95, { de: 'Word-Datei wird geschrieben …', en: 'Writing the Word file …' });
  return D.Packer.toBlob(new D.Document({ creator: 'FaLe Werkzeuge', sections }));
}
