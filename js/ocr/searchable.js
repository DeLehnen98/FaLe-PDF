// "Durchsuchbares PDF": OCR image-only pages and add an invisible text layer. The original
// page content (scan images) is left untouched; pages that already contain text are skipped.
import { loadPdf } from '../pdfcore.js';
import { loadEditable, loadPdfLib, saveDoc } from '../pdflib.js';
import { ocrPdfPages, recognize, pageTextChars } from './engine.js';
import { addTextLayer, imageMapper } from './textlayer.js';

const track = (e, n) => { import('../extras/stats.js').then(m => m.track(e, n)).catch(() => {}); };

/** Which pages (1-based) have no text layer yet. */
export async function pagesWithoutText(pdf, { limit = Infinity, minChars = 20 } = {}) {
  const out = [];
  const n = Math.min(pdf.numPages, limit);
  for (let i = 1; i <= n; i++) {
    const page = await pdf.getPage(i);
    if (await pageTextChars(page) < minChars) out.push(i);
    page.cleanup();
  }
  return out;
}

/**
 * Add an OCR text layer to the image-only pages of a PDF.
 * @param {Uint8Array} bytes
 * @param {{pages?: number[], lang?: string, psm?: string, onProgress?: Function, signal?: AbortSignal, name?: string, key?: string}} opts
 * @returns {Promise<{bytes: Uint8Array, ocrPages: number[], skipped: number[], words: number, texts: Object<number,string>}>}
 */
export async function makeSearchable(bytes, { pages = null, lang = 'deu+eng', psm = 'auto', onProgress, signal, name = 'Dokument', key = null } = {}) {
  const { pdf } = await loadPdf(bytes.slice(), { name, key });
  try {
    const results = await ocrPdfPages(pdf, { pages, lang, psm, onProgress, signal, skipText: true });
    const ocred = results.filter(r => !r.skipped);
    const skipped = results.filter(r => r.skipped).map(r => r.page);
    if (!ocred.length) return { bytes, ocrPages: [], skipped, words: 0, texts: {} };
    const pdfDoc = await loadEditable(bytes, name, { key });
    const docPages = pdfDoc.getPages();
    let words = 0;
    const texts = {};
    for (const r of ocred) {
      const page = await pdf.getPage(r.page);
      const vp = page.getViewport({ scale: r.scale, rotation: page.rotate });
      words += await addTextLayer(pdfDoc, docPages[r.page - 1], r.words, (x, y) => vp.convertToPdfPoint(x, y));
      texts[r.page] = r.text;
      page.cleanup();
    }
    track('ocr_pages', ocred.length);
    const out = await saveDoc(pdfDoc);
    return { bytes: out, ocrPages: ocred.map(r => r.page), skipped, words, texts };
  } finally { try { pdf.destroy(); } catch {} }
}

const canvasToJpeg = (c, q = 0.9) => new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Bild konnte nicht erzeugt werden'))), 'image/jpeg', q));

/**
 * Build a searchable PDF from images (one page per image, long side 842 pt).
 * items: [{source: Blob|Canvas, result?: OCR result}] – OCR runs for items without result.
 */
export async function imagesToSearchablePdf(items, { lang = 'deu+eng', psm = 'auto', onProgress, signal, title = 'Scan' } = {}) {
  const PDFLib = await loadPdfLib();
  const pdfDoc = await PDFLib.PDFDocument.create();
  let ocrCount = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    let canvas = it.source;
    let made = false;
    if (!(canvas instanceof HTMLCanvasElement)) {
      const bmp = await createImageBitmap(it.source, { imageOrientation: 'from-image' });
      const f = Math.min(1, Math.sqrt(12e6 / (bmp.width * bmp.height)));
      canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * f); canvas.height = Math.round(bmp.height * f);
      const g = canvas.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
      g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      bmp.close && bmp.close();
      made = true;
    }
    let r = it.result;
    if (!r) {
      r = await recognize(canvas, { lang, psm, signal, onProgress: p => onProgress && onProgress({ ...p, index: i, total: items.length, page: i + 1 }) });
      ocrCount++;
    }
    const iw = canvas.width, ih = canvas.height;
    const img = await pdfDoc.embedJpg(new Uint8Array(await (await canvasToJpeg(canvas)).arrayBuffer()));
    if (made) canvas.width = canvas.height = 0;
    const long = 841.89;
    const [pw, ph] = iw >= ih ? [long, (long * ih) / iw] : [(long * iw) / ih, long];
    const page = pdfDoc.addPage([pw, ph]);
    page.drawImage(img, { x: 0, y: 0, width: pw, height: ph });
    // OCR boxes refer to the image as recognised (r.width × r.height)
    await addTextLayer(pdfDoc, page, r.words, imageMapper(0, 0, pw, ph, r.width || iw, r.height || ih));
  }
  if (ocrCount) track('ocr_pages', ocrCount);
  pdfDoc.setTitle(title);
  pdfDoc.setCreator('FaLe PDF');
  return saveDoc(pdfDoc);
}
