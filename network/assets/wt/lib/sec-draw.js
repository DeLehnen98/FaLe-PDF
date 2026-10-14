// Burn text, check marks and images into a page (fill-pdf-form, sign-pdf). Boxes are given in the pdf.js
// viewport at scale 1 ({cx, cy, w, h, rot}); lib/sec-ui.js itemMatrix maps them into PDF space, so rotated
// pages and cropped pages are handled.
import { itemMatrix } from './sec-ui.js';

const hexRgb = hex => [1, 3, 5].map(k => parseInt(String(hex || '#000000').slice(k, k + 2), 16) / 255 || 0);

function wrapOps(PDFLib, page, vp, box, ops) {
  const { pushGraphicsState, popGraphicsState, concatTransformationMatrix } = PDFLib;
  const m = itemMatrix(vp, box);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...m), ...ops, popGraphicsState());
}

/** Split text into lines that fit `width` at `size` (word wrap; very long words are broken). */
export function wrapText(font, text, size, width) {
  const out = [];
  for (const para of String(text).split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const tryLine = line + word;
      if (!line || font.widthOfTextAtSize(tryLine.trimEnd(), size) <= width) { line = tryLine; continue; }
      out.push(line.trimEnd());
      line = word.trimStart();
      while (line && font.widthOfTextAtSize(line, size) > width && line.length > 1) {
        let k = line.length - 1;
        while (k > 1 && font.widthOfTextAtSize(line.slice(0, k), size) > width) k--;
        out.push(line.slice(0, k)); line = line.slice(k);
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

/**
 * Text in a box: single line (vertically centred, shrunk to fit) or wrapped lines from the top.
 * @param {object} opts {font, fontKey, size?, color?, multiline?, pad?}
 */
export function drawTextBox(PDFLib, page, vp, box, text, { font, fontKey, size = null, color = '#111111', multiline = false, pad = 2 } = {}) {
  const { beginText, endText, setFontAndSize, showText, moveText, setFillingRgbColor } = PDFLib;
  const [r, g, b] = hexRgb(color);
  const innerW = Math.max(4, box.w - pad * 2);
  let s = size || Math.max(6, Math.min(12, box.h * 0.62));
  let lines;
  if (multiline) {
    lines = wrapText(font, text, s, innerW);
    while (lines.length * s * 1.2 > box.h - pad && s > 6) { s -= 0.5; lines = wrapText(font, text, s, innerW); }
  } else {
    lines = [String(text).replace(/\s*\n\s*/g, ' ')];
    while (font.widthOfTextAtSize(lines[0], s) > innerW && s > 5) s -= 0.5;
  }
  const ops = [setFillingRgbColor(r, g, b), beginText(), setFontAndSize(fontKey, s)];
  const asc = 0.718 * s; // Helvetica cap height ≈ 0.718 em
  let y = multiline ? box.h - pad - s * 0.95 : (box.h - asc) / 2 + 0.05 * s;
  ops.push(moveText(pad, y));
  lines.forEach((ln, i) => {
    if (i) ops.push(moveText(0, -s * 1.2));
    ops.push(showText(font.encodeText(ln)));
  });
  ops.push(endText());
  wrapOps(PDFLib, page, vp, box, ops);
  return s;
}

/** ✓ or ✗ drawn as strokes filling the box. */
export function drawMark(PDFLib, page, vp, box, kind = 'check', color = '#111111') {
  const { setStrokingRgbColor, setLineWidth, moveTo, lineTo, stroke, setLineCap, setLineJoin, LineCapStyle, LineJoinStyle } = PDFLib;
  const [r, g, b] = hexRgb(color);
  const w = box.w, h = box.h, lw = Math.max(0.8, Math.min(w, h) * 0.12);
  const ops = [setStrokingRgbColor(r, g, b), setLineWidth(lw), setLineCap(LineCapStyle.Round), setLineJoin(LineJoinStyle.Round)];
  if (kind === 'cross') {
    ops.push(moveTo(w * 0.15, h * 0.15), lineTo(w * 0.85, h * 0.85), stroke(), moveTo(w * 0.15, h * 0.85), lineTo(w * 0.85, h * 0.15), stroke());
  } else {
    ops.push(moveTo(w * 0.1, h * 0.5), lineTo(w * 0.38, h * 0.18), lineTo(w * 0.92, h * 0.85), stroke());
  }
  wrapOps(PDFLib, page, vp, box, ops);
}

/** Image XObject stretched over the box. */
export function drawImageBox(PDFLib, page, vp, box, image, key) {
  const { concatTransformationMatrix, drawObject } = PDFLib;
  const name = page.node.newXObject(key, image.ref);
  wrapOps(PDFLib, page, vp, box, [concatTransformationMatrix(box.w, 0, 0, box.h, 0, 0), drawObject(name)]);
}
