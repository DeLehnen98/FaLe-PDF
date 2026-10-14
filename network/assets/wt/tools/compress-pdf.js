// Tool: compress PDFs – three levels, batch, never bigger than the input, protection kept.
//   lossless  structure only (lib/pdfopt.js): no visible change
//   balanced  + embedded photos/scans re-encoded as JPEG at ≈150 dpi effective (lib/pdfimages.js);
//             text, vector graphics, links and forms stay as they are
//   strong    every page rendered as a JPEG image (≈110 dpi) – smallest, text becomes an image
import { loadPdfLib, saveDoc, saveEncrypted, renderPage, canvasToBlob } from '../lib/pdf.js';
import { optimizeLossless } from '../lib/pdfopt.js';
import { recompressImages } from '../lib/pdfimages.js';

const LEVELS = {
  lossless: { de: 'Verlustfrei', en: 'Lossless' },
  balanced: { de: 'Ausgewogen', en: 'Balanced' },
  strong: { de: 'Stark', en: 'Strong' },
};

export default {
  options: [
    {
      id: 'level', type: 'radio', default: 'balanced', live: true,
      label: { de: 'Stufe', en: 'Level' },
      choices: [
        { value: 'lossless', label: LEVELS.lossless, hint: { de: 'Sieht exakt gleich aus, spart meist wenig', en: 'Looks exactly the same, usually saves a little' } },
        { value: 'balanced', label: LEVELS.balanced, hint: { de: 'Fotos und Scans kleiner, Text bleibt scharf – empfohlen', en: 'Smaller photos and scans, text stays sharp – recommended' } },
        { value: 'strong', label: LEVELS.strong, hint: { de: 'Am kleinsten – Text wird zu Bild und ist nicht mehr durchsuchbar', en: 'Smallest – text becomes an image and is no longer searchable' } },
      ],
    },
  ],

  async run(inputs, opts, ctx) {
    const PDFLib = await loadPdfLib();
    const level = LEVELS[opts.level] ? opts.level : 'balanced';
    const outputs = [];
    let fallback = 0, protectedKept = 0;
    for (let f = 0; f < inputs.length; f++) {
      const input = inputs[f];
      const label = inputs.length > 1 ? { de: `Datei ${f + 1} von ${inputs.length}: `, en: `File ${f + 1} of ${inputs.length}: ` } : { de: '', en: '' };
      const part = (frac, text) => ctx.progress((f + Math.min(1, frac)) / inputs.length, { de: label.de + text.de, en: label.en + text.en });
      part(0, { de: 'Wird gelesen …', en: 'Reading …' });
      const original = await input.bytes();
      let bytes;
      let password = null;
      if (level === 'strong') {
        const r = await rasterize(input, PDFLib, ctx, part);
        bytes = r.bytes;
        password = r.password;
      } else {
        const doc = await input.pdfDoc();
        password = doc.wtPassword || null;
        if (level === 'balanced') {
          await recompressImages(doc, PDFLib, {
            dpi: 150, quality: 0.75, tick: ctx.tick,
            onProgress: (i, n) => part(0.05 + 0.8 * (i / Math.max(1, n)), { de: `Bild ${i} von ${n}`, en: `Image ${i} of ${n}` }),
          });
        }
        part(0.88, { de: 'Struktur wird optimiert …', en: 'Optimising structure …' });
        await optimizeLossless(doc, PDFLib, { tick: ctx.tick });
        await ctx.tick();
        bytes = password ? await saveEncrypted(doc, password) : await saveDoc(doc);
      }
      if (password) protectedKept++;
      const before = input.size;
      if (bytes.length >= before) {
        fallback++;
        outputs.push({ name: input.name, blob: new Blob([original], { type: 'application/pdf' }), before, unchanged: true,
          note: ctx.t({ de: 'Unverändert – die Originaldatei ist bereits kleiner.', en: 'Unchanged – the original file is already smaller.' }) });
      } else {
        const suffix = ctx.lang === 'de' ? ' (komprimiert)' : ' (compressed)';
        outputs.push({ name: ctx.fileName(input.name, suffix, 'pdf'), blob: new Blob([bytes], { type: 'application/pdf' }), before });
      }
      await ctx.tick();
    }
    if (fallback) {
      ctx.note(level === 'strong'
        ? { de: 'Bei manchen Dateien macht diese Stufe nichts kleiner. Dort bekommst du das Original zurück – probier „Ausgewogen“.', en: 'For some files this level doesn’t make them smaller. You get the original back there – try “Balanced”.' }
        : { de: 'Wo es nichts zu verkleinern gab, bekommst du die Originaldatei zurück. „Stark“ spart bei Scans oft noch mehr.', en: 'Where there was nothing to shrink, you get the original file back. “Strong” often saves more on scans.' });
    }
    if (protectedKept) ctx.note({ de: 'Passwortgeschützte Dateien sind wieder mit demselben Passwort geschützt.', en: 'Password-protected files are protected again with the same password.' });
    if (level === 'strong' && fallback < inputs.length) ctx.note({ de: 'Stufe „Stark“: Text ist jetzt Teil eines Bildes und lässt sich nicht mehr markieren oder durchsuchen. Links und Formularfelder sind entfernt.', en: '“Strong” level: text is now part of an image and can no longer be selected or searched. Links and form fields are removed.' });
    return { outputs };
  },
};

/** Render every page as a JPEG (≈110 dpi, quality 0.6) into a new PDF of the same page sizes. */
async function rasterize(input, PDFLib, ctx, part) {
  const pdf = await input.pdfjs();
  const out = await PDFLib.PDFDocument.create();
  const dpi = 110, quality = 0.6;
  for (let i = 1; i <= pdf.numPages; i++) {
    part((i - 1) / pdf.numPages, { de: `Seite ${i} von ${pdf.numPages}`, en: `Page ${i} of ${pdf.numPages}` });
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const canvas = await renderPage(page, { scale: dpi / 72, signal: ctx.signal });
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    canvas.width = canvas.height = 0;
    page.cleanup();
    const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    const p = out.addPage([vp.width, vp.height]);
    p.drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
    await ctx.tick();
  }
  const meta = await pdf.getMetadata().catch(() => null);
  const title = meta?.info?.Title;
  const bytes = input.password ? await saveEncrypted(out, input.password, { title }) : await saveDoc(out, { title });
  return { bytes, password: input.password };
}
