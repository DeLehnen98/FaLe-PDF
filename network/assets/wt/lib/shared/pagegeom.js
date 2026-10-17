// GENERATED – synced copy of js/tools/pagegeom.js (pdf.js handed in via setPdfjs()) by scripts/sync-webtools-vendor.mjs.
// Do not edit here: change the source in the app and run `node scripts/sync-webtools-vendor.mjs`.
// Page geometry from the pdf.js operator list: image placements and simple vector shapes
// (rectangles, horizontal lines) in page-viewport coordinates at scale 1.
let pdfjsLib = null;
/** Hand in the pdf.js module (lib/pdf.js loadPdfjs()) before calling pageShapes(). */
export function setPdfjs(lib) { pdfjsLib = lib; }

const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/**
 * @param {object} page  pdf.js page
 * @param {object} base  viewport at scale 1 (with the page rotation)
 * @returns {Promise<{images: Array<{x0,y0,x1,y1}>, rects: Array<{x0,y0,x1,y1,fill,stroke}>, lines: Array<{x0,y0,x1,y1}>}>}
 */
export async function pageShapes(page, base, { wantPaths = true } = {}) {
  const OPS = pdfjsLib.OPS;
  const out = { images: [], rects: [], lines: [] };
  let list;
  try { list = await page.getOperatorList(); } catch { return out; }
  const { fnArray, argsArray } = list;
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const toView = (x, y) => { const [px, py] = apply(ctm, x, y); return base.convertToViewportPoint(px, py); };
  const boxOf = pts => {
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  };
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i], args = argsArray[i];
    if (fn === OPS.save) stack.push(ctm.slice());
    else if (fn === OPS.restore) { if (stack.length) ctm = stack.pop(); }
    else if (fn === OPS.transform) ctm = mul(ctm, args);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm.slice());
      const m = args && args[0];
      if (m && m.length === 6) ctm = mul(ctm, Array.from(m));
    } else if (fn === OPS.paintFormXObjectEnd) { if (stack.length) ctm = stack.pop(); }
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject || fn === OPS.paintImageXObjectRepeat) {
      const b = boxOf([toView(0, 0), toView(1, 0), toView(0, 1), toView(1, 1)]);
      if (b.x1 - b.x0 > 1 && b.y1 - b.y0 > 1) out.images.push(b);
    } else if (wantPaths && fn === OPS.constructPath) {
      // pdf.js ≥5: [paintOp, [pathData], minMax]
      const paint = args && args[0];
      const mm = args && args[2];
      if (!mm || mm.length < 4 || !Number.isFinite(mm[0]) || mm[0] > mm[2]) continue;
      const data = args[1] && args[1][0];
      const segs = data && data.length != null ? data.length : 0;
      const b = boxOf([toView(mm[0], mm[1]), toView(mm[2], mm[1]), toView(mm[0], mm[3]), toView(mm[2], mm[3])]);
      const w = b.x1 - b.x0, h = b.y1 - b.y0;
      const stroke = paint === OPS.stroke || paint === OPS.closeStroke || paint === OPS.fillStroke || paint === OPS.closeFillStroke || paint === OPS.eoFillStroke;
      const fill = paint === OPS.fill || paint === OPS.eoFill || paint === OPS.fillStroke || paint === OPS.eoFillStroke || paint === OPS.closeFillStroke;
      if (segs && segs > 40) continue; // complex outlines (glyph-like drawings, charts)
      if (h < 2.2 && w > 24) out.lines.push(b);
      else if (w > 4 && h > 4) out.rects.push({ ...b, fill, stroke });
    }
  }
  return out;
}
