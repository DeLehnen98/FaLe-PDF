// Invisible OCR text layer for PDF pages (text render mode 3): every word is placed on its
// baseline with its own text matrix (rotation from the baseline) and horizontal scaling (Tz),
// so selection, copy and search highlights line up with the word in the image.
// Uses the standard Helvetica font (WinAnsi); characters it cannot encode are mapped
// (accents stripped, typographic fallbacks) or skipped – never a crash.
import { loadPdfLib } from '../pdflib.js';
import { winAnsi } from '../office/pdftext.js';

const fonts = new WeakMap();
async function ocrFont(pdfDoc) {
  if (!fonts.has(pdfDoc)) {
    const PDFLib = await loadPdfLib();
    fonts.set(pdfDoc, pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica));
  }
  return fonts.get(pdfDoc);
}

/** Encodable version of a string for `font` (map, else drop the character). */
export function sanitizeFor(font, text, cache = new Map()) {
  let out = '';
  for (const ch of String(text || '').normalize('NFC')) {
    if (!cache.has(ch)) {
      let rep = '';
      try { font.encodeText(ch); rep = ch; } catch {
        const m = winAnsi(ch);
        if (m && !(m === '?' && ch !== '?')) {
          try { font.encodeText(m); rep = m; } catch { rep = ''; }
        }
      }
      cache.set(ch, rep);
    }
    out += cache.get(ch);
  }
  return out;
}

const n4 = v => (Math.abs(v) < 1e-6 ? 0 : +v.toFixed(4));

/**
 * Append an invisible text layer to a pdf-lib page.
 * @param {PDFDocument} pdfDoc
 * @param {PDFPage} page      pdf-lib page
 * @param {Array} words       OCR words ({text, baseline:{x0,y0,x1,y1}, size, line}) in image pixels
 * @param {(x:number,y:number)=>[number,number]} toPdf  image pixel → PDF user space
 * @returns {number} number of words written
 */
export async function addTextLayer(pdfDoc, page, words, toPdf) {
  if (!words || !words.length) return 0;
  const PDFLib = await loadPdfLib();
  const { PDFName, PDFArray } = PDFLib;
  const font = await ocrFont(pdfDoc);
  const ctx = pdfDoc.context;
  const key = page.node.newFontDictionary('FaleOCR', font.ref);
  const cache = new Map();
  let ops = `BT 3 Tr\n`;
  let n = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];
    const bl = w.baseline || { x0: w.bbox.x0, y0: w.bbox.y1, x1: w.bbox.x1, y1: w.bbox.y1 };
    let text = sanitizeFor(font, w.text, cache).trim();
    if (!text) continue;
    const [ax, ay] = toPdf(bl.x0, bl.y0);
    const [bx, by] = toPdf(bl.x1, bl.y1);
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    if (!(len > 0.3)) continue;
    const c = dx / len, s = dy / len;
    // font size: the OCR row height, measured perpendicular to the baseline in PDF units
    const sizePx = Math.max(2, w.size || (w.bbox.y1 - w.bbox.y0));
    const [ux, uy] = toPdf(bl.x0, bl.y0 - sizePx);
    let fs = Math.abs((ux - ax) * -s + (uy - ay) * c);
    if (!(fs > 0.5)) fs = Math.max(1, len / Math.max(1, text.length) * 1.6);
    const natural = font.widthOfTextAtSize(text, fs);
    if (!(natural > 0)) continue;
    const tz = Math.max(5, Math.min(2000, (100 * len) / natural));
    if (next && next.line === w.line) text += ' ';
    const hex = font.encodeText(text).toString();
    ops += `${key.toString()} ${n4(fs)} Tf ${n4(tz)} Tz ${n4(c)} ${n4(s)} ${n4(-s)} ${n4(c)} ${n4(ax)} ${n4(ay)} Tm ${hex} Tj\n`;
    n++;
  }
  ops += 'ET\n';
  if (!n) return 0;
  // keep the original content's graphics state away from ours: q <original> Q <text layer>
  const start = ctx.register(ctx.flateStream('q\n'));
  const end = ctx.register(ctx.flateStream('\nQ\n' + ops));
  const KEY = PDFName.of('Contents');
  const raw = page.node.get(KEY);
  const arr = page.node.lookup(KEY);
  if (arr instanceof PDFArray) { arr.insert(0, start); arr.push(end); }
  else if (raw) page.node.set(KEY, ctx.obj([start, raw, end]));
  else page.node.set(KEY, ctx.obj([end]));
  return n;
}

/** Mapper for an image drawn at (x, y, w, h) on a page: image pixel → PDF user space. */
export function imageMapper(x, y, w, h, iw, ih) {
  const sx = w / iw, sy = h / ih;
  return (px, py) => [x + px * sx, y + h - py * sy];
}
