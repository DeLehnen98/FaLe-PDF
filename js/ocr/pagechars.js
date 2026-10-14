// OCR for pages without a text layer, returned in the same shape as tools/textgeom.js
// pageChars(): {chars, text, map} with per-character boxes in viewport@1 coordinates (and quads
// in PDF space), so search, selection, redaction and comparison work unchanged on scans.
import { recognize, ocrScale } from './engine.js';

/**
 * @param {object} page  pdf.js page proxy
 * @param {object} base  viewport at scale 1 with the page rotation
 */
export async function ocrPageChars(page, base, { lang = 'deu+eng', psm = 'auto', signal, onProgress } = {}) {
  const { renderPage } = await import('../pdfcore.js');
  const scale = ocrScale(base.width, base.height);
  const canvas = await renderPage(page, { scale });
  let r;
  try { r = await recognize(canvas, { lang, psm, signal, onProgress, dpi: 72 * scale }); }
  finally { canvas.width = canvas.height = 0; }
  const pt = wordsToChars(r, scale, base);
  pt.ocr = { conf: r.conf, words: r.words.length };
  return pt;
}

/** OCR result (pixels at `scale`) → pageChars-compatible structure. */
export function wordsToChars(r, scale, base) {
  const chars = [];
  let text = '';
  const map = [];
  const P = (x, y) => base.convertToPdfPoint(x, y);
  let itemIdx = 0;
  r.lines.forEach((line, li) => {
    if (li > 0) { text += '\n'; map.push(-1); }
    line.words.forEach((w, wi) => {
      if (wi > 0) { text += ' '; map.push(-1); }
      const letters = Array.from(w.text);
      const x0 = w.bbox.x0 / scale, x1 = w.bbox.x1 / scale, y0 = w.bbox.y0 / scale, y1 = w.bbox.y1 / scale;
      const step = (x1 - x0) / Math.max(1, letters.length);
      letters.forEach((ch, k) => {
        const a = x0 + step * k, b = a + step;
        const UL = P(a, y0), UR = P(b, y0), LL = P(a, y1), LR = P(b, y1);
        const ux = LR[0] - LL[0], uy = LR[1] - LL[1], ul = Math.hypot(ux, uy) || 1;
        const nx = UL[0] - LL[0], ny = UL[1] - LL[1], nl = Math.hypot(nx, ny) || 1;
        map.push(chars.length);
        text += ch;
        chars.push({
          ch, item: itemIdx, eol: k === letters.length - 1 && wi === line.words.length - 1, line: li,
          quad: [UL[0], UL[1], UR[0], UR[1], LL[0], LL[1], LR[0], LR[1]],
          x0: a, y0, x1: b, y1, u: [ux / ul, uy / ul], n: [nx / nl, ny / nl], fh: nl, base: LL, font: 'ocr',
        });
      });
      itemIdx++;
    });
  });
  return { chars, text, map };
}
