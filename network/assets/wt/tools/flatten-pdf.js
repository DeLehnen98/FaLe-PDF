// Tool: flatten PDFs – form fields and annotations become part of the page content (lib/sec-flatten.js),
// so values can no longer be changed and look the same everywhere. Links can be kept. Fallback: render
// every page as an image (for broken forms / annotations without appearance).
import { loadPdfLib, saveDoc, canvasToBlob, saveEncrypted } from '../lib/pdf.js';
import { flattenDoc, countAnnots, refreshFieldAppearances } from '../lib/sec-flatten.js';
import { pdfBlob, renderPage } from '../lib/sec-ui.js';

export default {
  options: [
    {
      id: 'method', type: 'radio', default: 'vector',
      label: { de: 'Verfahren', en: 'Method' },
      choices: [
        { value: 'vector', label: { de: 'Sauber glätten', en: 'Clean flatten' }, hint: { de: 'Text bleibt Text und durchsuchbar – empfohlen', en: 'Text stays text and searchable – recommended' } },
        { value: 'raster', label: { de: 'Als Bild', en: 'As image' }, hint: { de: 'Jede Seite wird zum Bild – für widerspenstige Formulare', en: 'Every page becomes an image – for stubborn forms' } },
      ],
    },
    {
      id: 'what', type: 'radio', default: 'all', when: v => v.method === 'vector',
      label: { de: 'Was glätten?', en: 'What to flatten?' },
      choices: [
        { value: 'all', label: { de: 'Formulare und Kommentare', en: 'Forms and comments' } },
        { value: 'forms', label: { de: 'Nur Formularfelder', en: 'Form fields only' } },
        { value: 'annots', label: { de: 'Nur Kommentare und Markierungen', en: 'Comments and markups only' } },
      ],
    },
    {
      id: 'keepLinks', type: 'toggle', default: true, when: v => v.method === 'vector',
      label: { de: 'Links anklickbar lassen', en: 'Keep links clickable' },
    },
    {
      id: 'dpi', type: 'select', default: 200, when: v => v.method === 'raster',
      label: { de: 'Bildqualität', en: 'Image quality' },
      choices: [
        { value: 150, label: { de: '150 dpi – kleinere Datei', en: '150 dpi – smaller file' } },
        { value: 200, label: { de: '200 dpi – empfohlen', en: '200 dpi – recommended' } },
        { value: 300, label: { de: '300 dpi – Druckqualität', en: '300 dpi – print quality' } },
      ],
    },
  ],

  async run(inputs, opts, ctx) {
    const PDFLib = await loadPdfLib();
    const outputs = [];
    let nothing = 0, missing = 0, badFont = 0;
    for (let f = 0; f < inputs.length; f++) {
      const input = inputs[f];
      const part = (x, t) => ctx.progress((f + Math.min(1, x)) / inputs.length, inputs.length > 1 ? { de: `Datei ${f + 1} von ${inputs.length}: ${t.de}`, en: `File ${f + 1} of ${inputs.length}: ${t.en}` } : t);
      const suffix = ctx.lang === 'de' ? ' (geglättet)' : ' (flattened)';
      if (opts.method === 'raster') {
        const bytes = await rasterize(input, PDFLib, ctx, part, +opts.dpi || 200);
        outputs.push({ name: ctx.fileName(input.name, suffix, 'pdf'), blob: pdfBlob(bytes) });
        continue;
      }
      part(0, { de: 'Wird gelesen …', en: 'Reading …' });
      const doc = await input.pdfDoc();
      const before = countAnnots(PDFLib, doc);
      const forms = opts.what !== 'annots', annots = opts.what !== 'forms';
      const todo = (forms ? before.widgets : 0) + (annots ? before.other : 0) + (opts.keepLinks ? 0 : before.links);
      if (!todo) {
        nothing++;
        outputs.push({ name: input.name, blob: pdfBlob(await input.bytes()), unchanged: true,
          note: ctx.t({ de: 'Nichts zu glätten – unverändert.', en: 'Nothing to flatten – unchanged.' }) });
        continue;
      }
      if (forms && before.widgets) {
        // fields filled in other programs often have no up-to-date appearance → regenerate (Helvetica, umlauts OK)
        const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
        const acro = doc.catalog.lookup(PDFLib.PDFName.of('AcroForm'));
        const need = acro && acro.lookup?.(PDFLib.PDFName.of('NeedAppearances'));
        if (need && need.asBoolean?.()) badFont += refreshFieldAppearances(PDFLib, doc, font).length;
      }
      const st = await flattenDoc(PDFLib, doc, { forms, annots, keepLinks: !!opts.keepLinks, tick: ctx.tick,
        onPage: (i, n) => part(0.1 + 0.8 * (i / n), { de: `Seite ${i + 1} von ${n}`, en: `Page ${i + 1} of ${n}` }) });
      missing += st.missing;
      part(0.95, { de: 'Wird gespeichert …', en: 'Saving …' });
      const pw = doc.wtEncrypted && (doc.wtPassword || input.password);
      const bytes = pw ? await saveEncrypted(doc, pw) : await saveDoc(doc);
      outputs.push({ name: ctx.fileName(input.name, suffix, 'pdf'), blob: pdfBlob(bytes), pages: doc.getPageCount(),
        note: ctx.t({ de: `${st.drawn} Elemente eingebrannt${st.fields ? `, ${st.fields} Formularfelder` : ''}`, en: `${st.drawn} items burned in${st.fields ? `, ${st.fields} form fields` : ''}` }) });
      await ctx.tick();
    }
    if (missing) ctx.note({ de: `${missing} Element(e) hatten kein Erscheinungsbild und wurden entfernt. Fehlt etwas, nimm „Als Bild“.`, en: `${missing} item(s) had no appearance and were removed. If something is missing, use “As image”.` });
    if (badFont) ctx.note({ de: 'Manche Feldwerte enthalten Zeichen außerhalb des westeuropäischen Zeichensatzes und behalten ihr bisheriges Aussehen.', en: 'Some field values contain characters outside the Western European character set and keep their previous look.' });
    if (opts.method === 'raster') ctx.note({ de: 'Als Bild geglättet: Text ist nicht mehr markier- oder durchsuchbar, Links sind entfernt.', en: 'Flattened as images: text can no longer be selected or searched, links are removed.' });
    return { outputs };
  },
};

async function rasterize(input, PDFLib, ctx, part, dpi) {
  const pdf = await input.pdfjs();
  const out = await PDFLib.PDFDocument.create();
  for (let i = 1; i <= pdf.numPages; i++) {
    part((i - 1) / pdf.numPages, { de: `Seite ${i} von ${pdf.numPages}`, en: `Page ${i} of ${pdf.numPages}` });
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const canvas = await renderPage(page, { scale: dpi / 72, signal: ctx.signal });
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.9);
    canvas.width = canvas.height = 0;
    page.cleanup();
    const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    out.addPage([vp.width, vp.height]).drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
    await ctx.tick();
  }
  return input.password ? saveEncrypted(out, input.password) : saveDoc(out);
}
