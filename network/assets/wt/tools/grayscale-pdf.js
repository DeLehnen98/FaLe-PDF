// Tool: PDF to grayscale. Preferred: rewrite the colours inside the PDF (text and vector graphics stay
// sharp and searchable, images become 8-bit gray). Every page of the result is then rendered and checked
// for remaining colour; pages that still show colour (e.g. mesh gradients, JPEG 2000 images) are replaced
// by a gray image of the page – and the result says so. Option: everything as gray images.
import { loadPdfLib, openPdfjs, renderPage } from '../lib/pdf.js';
import { formatPages } from '../lib/ranges.js';
import { removeUnreachable } from '../lib/pdfopt.js';
import { LIMITS } from '../lib/shared/limits.js';
import { saveLike, pdfBlob } from '../lib/org-common.js';

async function decodeJpeg(bytes) {
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  if (bmp.width * bmp.height > LIMITS.canvasPixels) { bmp.close(); throw new Error('image too large'); }
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  bmp.close();
  const rgba = g.getImageData(0, 0, c.width, c.height).data;
  const out = { w: c.width, h: c.height, rgba };
  c.width = c.height = 0;
  return out;
}

/** Share of clearly coloured pixels of a rendered page. */
function colourShare(canvas) {
  const { data } = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) > 16) n++;
  }
  return n / (data.length / 4);
}

/** Replace page `idx` of `doc` by a gray raster image of the source page (pdf.js). */
async function rasterPage(doc, PDFLib, srcPdf, idx, dpi) {
  const { PDFName, PDFArray, PDFDict } = PDFLib;
  const ctx = doc.context;
  const page = doc.getPage(idx);
  const jsPage = await srcPdf.getPage(idx + 1);
  const vp0 = jsPage.getViewport({ scale: 1, rotation: 0 });
  let scale = dpi / 72;
  const max = Math.sqrt(LIMITS.canvasPixels / 4 / (vp0.width * vp0.height));
  scale = Math.min(scale, max);
  const vp = jsPage.getViewport({ scale, rotation: 0 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(vp.width)); canvas.height = Math.max(1, Math.floor(vp.height));
  const g = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
  await jsPage.render({ canvasContext: g, canvas, viewport: vp, background: 'white' }).promise;
  jsPage.cleanup?.();
  const { data } = g.getImageData(0, 0, canvas.width, canvas.height);
  const px = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0, j = 0; j < px.length; i += 4, j++) px[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  const img = ctx.flateStream(px, { Type: 'XObject', Subtype: 'Image', Width: canvas.width, Height: canvas.height, ColorSpace: 'DeviceGray', BitsPerComponent: 8 });
  const imgRef = ctx.register(img);
  canvas.width = canvas.height = 0;
  // the rendered area is the crop box (pdf.js view), drawn unrotated – /Rotate stays as it was
  const [x0, y0, x1, y1] = jsPage.view;
  const content = ctx.flateStream(new TextEncoder().encode(`q ${x1 - x0} 0 0 ${y1 - y0} ${x0} ${y0} cm /FaleGray Do Q`));
  page.node.set(PDFName.of('Contents'), ctx.register(content));
  const res = ctx.obj({});
  const xo = ctx.obj({});
  xo.set(PDFName.of('FaleGray'), imgRef);
  res.set(PDFName.of('XObject'), xo);
  page.node.set(PDFName.of('Resources'), res);
  page.node.delete(PDFName.of('Group'));
  // annotations are part of the image now – keep only links (they still work on top)
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (annots instanceof PDFArray) {
    for (let a = annots.size() - 1; a >= 0; a--) {
      const d = annots.lookup(a);
      if (!(d instanceof PDFDict) || d.get(PDFName.of('Subtype'))?.toString() !== '/Link') annots.remove(a);
    }
  }
}

export default {
  options: [
    {
      id: 'method', type: 'radio', default: 'keep',
      label: { de: 'Art der Umwandlung', en: 'Conversion' },
      choices: [
        { value: 'keep', label: { de: 'Text und Grafik erhalten', en: 'Keep text and graphics' }, hint: { de: 'Empfohlen: Text bleibt scharf und durchsuchbar', en: 'Recommended: text stays sharp and searchable' } },
        { value: 'raster', label: { de: 'Alles als Graustufenbild', en: 'Everything as gray images' }, hint: { de: 'Sicher grau, Text nicht mehr markierbar', en: 'Surely gray, text no longer selectable' } },
      ],
    },
  ],

  async run(inputs, opts, ctx) {
    const PDFLib = await loadPdfLib();
    const outputs = [];
    const de = ctx.lang === 'de';
    for (let f = 0; f < inputs.length; f++) {
      const input = inputs[f];
      const share = (a, b) => (f + a + (b || 0)) / inputs.length;
      const doc = await input.pdfDoc();
      const n = doc.getPageCount();
      const srcPdf = await input.pdfjs();
      let fallback = [];
      let note = '';
      if (opts.method === 'raster') {
        fallback = Array.from({ length: n }, (_, i) => i);
      } else {
        await (await import('../lib/org-gray.js')).grayscaleDoc(doc, PDFLib, {
          decodeJpeg, tick: ctx.tick,
          encodeGrayJpeg: async (px, w, h) => (await import('../lib/aud1-grayjpeg.js')).encodeGrayJpeg(px, w, h, 88, ctx.tick),
          onProgress: (i, total) => ctx.progress(share(0.5 * i / total), { de: `Farben werden umgewandelt … Seite ${i + 1} von ${total}`, en: `Converting colours … page ${i + 1} of ${total}` }),
        });
        // check the result: render every page and look for colour
        const bytes = await doc.save({ useObjectStreams: false, addDefaultPage: false });
        const check = await openPdfjs(bytes);
        try {
          for (let i = 0; i < n; i++) {
            ctx.progress(share(0.5 + 0.3 * i / n), { de: `Ergebnis wird geprüft … Seite ${i + 1} von ${n}`, en: `Checking the result … page ${i + 1} of ${n}` });
            const p = await check.getPage(i + 1);
            const canvas = await renderPage(p, { width: 260, signal: ctx.signal });
            if (colourShare(canvas) > 0.0002) fallback.push(i);
            canvas.width = canvas.height = 0;
            await ctx.tick();
          }
        } finally { check.destroy(); }
      }
      for (let k = 0; k < fallback.length; k++) {
        ctx.progress(share(0.8 + 0.15 * k / fallback.length), { de: `Seite ${fallback[k] + 1} wird als Graustufenbild übernommen …`, en: `Page ${fallback[k] + 1} becomes a gray image …` });
        await rasterPage(doc, PDFLib, srcPdf, fallback[k], 150);
        await ctx.tick();
      }
      if (fallback.length) removeUnreachable(doc, PDFLib);
      if (opts.method !== 'raster' && fallback.length) {
        const list = formatPages(fallback);
        note = de
          ? `${fallback.length === 1 ? `Seite ${list} enthielt` : `Die Seiten ${list} enthielten`} Farbe, die sich nicht direkt umwandeln ließ (z. B. besondere Farbverläufe oder Bildformate). ${fallback.length === 1 ? 'Sie wurde' : 'Sie wurden'} deshalb als Graustufenbild übernommen – Text ist dort nicht mehr markierbar.`
          : `${fallback.length === 1 ? `Page ${list} contained` : `Pages ${list} contained`} colour that could not be converted directly (e.g. special gradients or image formats), so ${fallback.length === 1 ? 'it was' : 'they were'} turned into a gray image – text there can no longer be selected.`;
      } else if (opts.method === 'raster') {
        note = de ? 'Alle Seiten sind jetzt Graustufenbilder (150 dpi). Text ist nicht mehr markierbar oder durchsuchbar.' : 'All pages are gray images now (150 dpi). Text can no longer be selected or searched.';
      }
      ctx.progress(share(0.96), { de: 'Wird gespeichert …', en: 'Saving …' });
      await ctx.tick();
      const bytes = await saveLike(doc, input, ctx);
      outputs.push({ name: ctx.fileName(input.name, de ? ' (Graustufen)' : ' (grayscale)', 'pdf'), blob: pdfBlob(bytes), pages: n, note });
    }
    ctx.notes.splice(0, ctx.notes.length, ...new Set(ctx.notes));
    return { outputs };
  },
};
