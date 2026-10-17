// Tool: images (JPG, PNG, WebP, GIF, BMP, AVIF, HEIC if the browser decodes it) → PDF.
// JPEGs are embedded without re-compression, EXIF orientation is respected (lib/imgembed.js).
import { loadPdfLib, saveDoc } from '../lib/pdf.js';
import { embedImage, drawFitted, pageSizeFor, mm } from '../lib/imgembed.js';
import { baseName } from '../lib/format.js';

const MARGINS = { none: 0, small: mm(10), large: mm(20) };
// longest side in pixels and JPEG quality: A4 at 2000 px is ~170 dpi – sharp on screen and in print
const SHRINK = { original: {}, email: { maxSide: 2000, quality: 0.82 }, small: { maxSide: 1400, quality: 0.72 } };

/** Options with other defaults – photo-to-pdf starts with “For email” (phone photos are huge). */
export function withDefaults(over) {
  const tool = { ...jpgToPdf, options: jpgToPdf.options.map(o => (o.id in over ? { ...o, default: over[o.id] } : o)) };
  return tool;
}

const jpgToPdf = {
  options: [
    {
      id: 'size', type: 'radio', default: 'a4',
      label: { de: 'Seitengröße', en: 'Page size' },
      choices: [
        { value: 'a4', label: 'A4', hint: { de: '21 × 29,7 cm', en: '210 × 297 mm' } },
        { value: 'letter', label: 'Letter', hint: { de: 'US-Format', en: 'US format' } },
        { value: 'fit', label: { de: 'Bildgröße', en: 'Image size' }, hint: { de: 'Seite so groß wie das Bild', en: 'Page as large as the image' } },
      ],
    },
    {
      id: 'orientation', type: 'select', default: 'auto',
      label: { de: 'Ausrichtung', en: 'Orientation' },
      when: v => v.size !== 'fit',
      choices: [
        { value: 'auto', label: { de: 'Automatisch (wie das Bild)', en: 'Automatic (like the image)' } },
        { value: 'portrait', label: { de: 'Hochformat', en: 'Portrait' } },
        { value: 'landscape', label: { de: 'Querformat', en: 'Landscape' } },
      ],
    },
    {
      id: 'margin', type: 'select', default: 'small',
      label: { de: 'Rand', en: 'Margin' },
      choices: [
        { value: 'none', label: { de: 'Kein Rand', en: 'No margin' } },
        { value: 'small', label: { de: 'Schmal (1 cm)', en: 'Narrow (10 mm)' } },
        { value: 'large', label: { de: 'Breit (2 cm)', en: 'Wide (20 mm)' } },
      ],
    },
    {
      id: 'shrink', type: 'select', default: 'original',
      label: { de: 'Bildqualität', en: 'Image quality' },
      choices: [
        { value: 'original', label: { de: 'Original (größte Datei)', en: 'Original (largest file)' } },
        { value: 'email', label: { de: 'Für E-Mail und Messenger (kleiner, scharf)', en: 'For email and messengers (smaller, sharp)' } },
        { value: 'small', label: { de: 'Möglichst klein', en: 'As small as possible' } },
      ],
      hint: { de: 'Handyfotos haben oft 3–5 MB. „Für E-Mail“ macht daraus meist 300–600 KB pro Seite.', en: 'Phone photos are often 3–5 MB. “For email” usually makes that 300–600 KB per page.' },
    },
    {
      id: 'output', type: 'radio', default: 'single',
      label: { de: 'Ergebnis', en: 'Result' },
      when: (v, inputs) => inputs.length > 1,
      choices: [
        { value: 'single', label: { de: 'Eine PDF', en: 'One PDF' }, hint: { de: 'Alle Bilder in einer Datei', en: 'All images in one file' } },
        { value: 'each', label: { de: 'Eine PDF pro Bild', en: 'One PDF per image' }, hint: { de: 'Einzeln oder als ZIP', en: 'Separately or as a ZIP' } },
      ],
    },
  ],

  async run(inputs, opts, ctx) {
    const PDFLib = await loadPdfLib();
    const margin = MARGINS[opts.margin] ?? MARGINS.small;
    const each = opts.output === 'each' && inputs.length > 1;
    const outputs = [];
    let doc = each ? null : await PDFLib.PDFDocument.create();
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      ctx.progress(i / inputs.length, { de: `Bild ${i + 1} von ${inputs.length}`, en: `Image ${i + 1} of ${inputs.length}` });
      const target = each ? await PDFLib.PDFDocument.create() : doc;
      const e = await embedImage(target, input, SHRINK[opts.shrink] || {});
      const size = pageSizeFor(e, opts.size, opts.orientation, margin);
      const page = target.addPage(size);
      drawFitted(page, e, PDFLib, { x: margin, y: margin, width: size[0] - 2 * margin, height: size[1] - 2 * margin });
      if (each) {
        const bytes = await saveDoc(target, { title: baseName(input.name) });
        outputs.push({ name: ctx.fileName(input.name, '', 'pdf'), blob: new Blob([bytes], { type: 'application/pdf' }), pages: 1 });
      }
      await ctx.tick();
    }
    if (!each) {
      ctx.progress(1, { de: 'Wird gespeichert …', en: 'Saving …' });
      await ctx.tick();
      const first = baseName(inputs[0].name);
      const bytes = await saveDoc(doc, { title: first });
      const more = inputs.length - 1;
      const name = more ? (ctx.lang === 'de' ? `${first} + ${more} weitere.pdf` : `${first} + ${more} more.pdf`) : `${first}.pdf`;
      outputs.push({ name, blob: new Blob([bytes], { type: 'application/pdf' }), pages: doc.getPageCount() });
    }
    return { outputs };
  },
};

export default jpgToPdf;
