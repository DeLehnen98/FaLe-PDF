// Tool modules word-to-pdf, excel-to-pdf, pptx-to-pdf (lib/conv-office.js does the conversion).
import { checkOoxml, fileTile, docxToPdf, xlsxToPdf, pptxToPdf, unicodeNote } from './conv-office.js';
import { coarsePointer, pdfPagesPreview, fail } from './conv-common.js';

const KIND = {
  docx: { tile: ['DOCX', '#2B5797'], convert: docxToPdf },
  xlsx: { tile: ['XLSX', '#1E7145'], convert: xlsxToPdf },
  pptx: { tile: ['PPTX', '#C4462B'], convert: pptxToPdf },
};

export function makeOfficeTool(kind) {
  const K = KIND[kind];
  return {
    options: [],
    get shareFirst() { return coarsePointer(); },

    async prepareOther(input) {
      await checkOoxml(input, kind);
      return fileTile(...K.tile);
    },

    async run(inputs, opts, ctx) {
      const outputs = [];
      const bad = new Map();
      const notes = [];
      for (let f = 0; f < inputs.length; f++) {
        const input = inputs[f];
        const sub = {
          ...ctx,
          progress: (frac, text) => ctx.progress((f + Math.min(1, frac ?? 0)) / inputs.length, inputs.length > 1
            ? { de: `Datei ${f + 1} von ${inputs.length}: ${text.de}`, en: `File ${f + 1} of ${inputs.length}: ${text.en}` } : text),
        };
        const bytes = await checkOoxml(input, kind);
        const r = await K.convert(bytes, input.name, sub);
        r.bad.forEach((n, ch) => bad.set(ch, (bad.get(ch) || 0) + n));
        const { loadPdfLib } = await import('./pdf.js');
        const PDFLib = await loadPdfLib();
        const doc = await PDFLib.PDFDocument.load(r.pdf, { updateMetadata: false });
        const pages = doc.getPageCount();
        let note = '';
        if (kind === 'xlsx') {
          note = ctx.t({ de: `${r.stats.sheets} ${r.stats.sheets === 1 ? 'Blatt' : 'Blätter'}`, en: `${r.stats.sheets} ${r.stats.sheets === 1 ? 'sheet' : 'sheets'}` });
          if (r.stats.hidden) notes.push({ de: `${r.stats.hidden} ${r.stats.hidden === 1 ? 'ausgeblendetes Blatt wurde' : 'ausgeblendete Blätter wurden'} nicht übernommen.`, en: `${r.stats.hidden} hidden ${r.stats.hidden === 1 ? 'sheet was' : 'sheets were'} left out.` });
        } else if (kind === 'docx' && r.stats.math && !notes.some(n => n.math)) {
          notes.push({ math: true, de: 'Formeln wurden als einfacher Text übernommen (z. B. a/b, x^2) – das Formel-Layout selbst kann dieses Werkzeug nicht setzen.', en: 'Equations were taken over as plain text (e.g. a/b, x^2) – this tool cannot lay out the equation itself.' });
        } else if (kind === 'pptx') note = ctx.t({ de: `${r.stats.slides} Folien`, en: `${r.stats.slides} slides` });
        outputs.push({ name: ctx.fileName(input.name, '', 'pdf'), blob: new Blob([r.pdf], { type: 'application/pdf' }), pages, note, meta: { preview: f === 0 } });
        await ctx.tick();
      }
      if (!outputs.length) fail('Es konnte keine Datei umgewandelt werden.', 'No file could be converted.');
      notes.forEach(n => ctx.note(n));
      if (kind === 'pptx') {
        if (bad.size) ctx.note({ de: 'Die Folien sehen aus wie im Original. Einige Sonderzeichen sind in der unsichtbaren Textebene (Suchen, Kopieren) aber ersetzt.', en: 'The slides look like the original. Some special characters are replaced in the invisible text layer (search, copy), though.' });
        ctx.note({ de: 'Folien werden als Bild mit durchsuchbarer Textebene übernommen. Animationen, Videos und sehr spezielle Effekte fehlen in der PDF.', en: 'Slides are taken over as pictures with a searchable text layer. Animations, videos and very special effects are not in the PDF.' });
      } else {
        unicodeNote(ctx, bad);
        ctx.note(kind === 'docx'
          ? { de: 'Text, Überschriften, Listen, Tabellen und Bilder werden übernommen. Sehr komplexe Layouts (Textfelder, Formen, umfließende Bilder) können leicht abweichen – schau dir die Vorschau an.', en: 'Text, headings, lists, tables and images are taken over. Very complex layouts (text boxes, shapes, wrapped images) may differ slightly – check the preview.' }
          : { de: 'Alle sichtbaren Blätter werden mit ihren angezeigten Werten übernommen; breite Tabellen werden verkleinert oder auf mehrere Seiten verteilt.', en: 'All visible sheets are taken over with their displayed values; wide tables are scaled down or spread over several pages.' });
      }
      return { outputs };
    },

    onResult(result, res, ctx) {
      const o = res.outputs.find(x => x.meta?.preview) || res.outputs[0];
      if (o) pdfPagesPreview(result, o.blob, ctx);
    },
  };
}
