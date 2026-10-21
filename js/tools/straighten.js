// „Blatt gerade ausrichten“: photos of paper made straight (perspective by the sheet's edges, else by the tilt of the
// text lines). Kept apart from scanproc.js, which is shared with the web tools and must not import anything.
import { detectDocument, smallImageData, warp, FULL_QUAD } from './scanproc.js';
import { inkMask, estimateSkew } from './paperscan.js';

/**
 * Is a found quad plausibly a whole sheet of paper? Big enough (≥ 25 % of the photo) and paper-shaped (sides
 * between 1 : 2.2 and 2.2 : 1) – a bright band or a light reflection across the page is not.
 */
export function sheetLike(q, w, h) {
  const P = q.map(([x, y]) => [x * w, y * h]);
  const d = (a, b) => Math.hypot(P[a][0] - P[b][0], P[a][1] - P[b][1]);
  const top = d(0, 1), bottom = d(3, 2), left = d(0, 3), right = d(1, 2);
  const ratio = ((top + bottom) / 2) / Math.max(1, (left + right) / 2);
  let area = 0;
  for (let i = 0; i < 4; i++) { const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % 4]; area += x1 * y2 - x2 * y1; }
  area = Math.abs(area) / 2;
  return area >= 0.25 * w * h && ratio >= 1 / 2.2 && ratio <= 2.2;
}

/**
 * A little inside the found sheet edges (the edges are found on a ~360 px copy, so they sit on the shadow/table seam):
 * the straightened page then shows no strip of table at its border. Letter margins are far wider than this.
 */
export function insetQuad(q, f = 0.022) {
  const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
  return q.map(([x, y]) => [x + (cx - x) * f, y + (cy - y) * f]);
}

/** Rotate a canvas by any small angle (degrees, clockwise) – white corners, size grows to fit. */
export function rotateFree(canvas, deg) {
  if (!deg) return canvas;
  const a = deg * Math.PI / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const out = document.createElement('canvas');
  out.width = Math.round(canvas.width * c + canvas.height * s);
  out.height = Math.round(canvas.width * s + canvas.height * c);
  const g = out.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, out.width, out.height);
  g.translate(out.width / 2, out.height / 2);
  g.rotate(a);
  g.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return out;
}

/**
 * „Blatt gerade ausrichten“ for a photo of paper (no UI): the sheet's edges → perspective correction; when the
 * sheet fills the photo (no edges to find), the tilt of the text lines → rotation. Returns
 * { canvas, how: 'edges' | 'tilt' | 'none', angle }. The source canvas is left as it is.
 */
export async function straighten(srcCanvas, { maxSide = 2400 } = {}) {
  const det = detectDocument(smallImageData(srcCanvas, 360));
  const q = det.quad;
  // a quad that is the whole photo (or nearly) is no correction
  const moved = q ? Math.max(...q.map(([x, y], i) => Math.hypot(x - FULL_QUAD[i][0], y - FULL_QUAD[i][1]))) : 0;
  if (q && moved > 0.015 && sheetLike(q, srcCanvas.width, srcCanvas.height)) {
    const inset = insetQuad(q);
    return { canvas: await warp(srcCanvas, inset, { maxSide }), how: 'edges', angle: 0, quad: inset };
  }
  // tilt of the text lines (−8° … 8°) on a reduced copy
  const f = Math.min(1, 1400 / Math.max(srcCanvas.width, srcCanvas.height));
  const sm = document.createElement('canvas');
  sm.width = Math.max(1, Math.round(srcCanvas.width * f)); sm.height = Math.max(1, Math.round(srcCanvas.height * f));
  sm.getContext('2d').drawImage(srcCanvas, 0, 0, sm.width, sm.height);
  const img = sm.getContext('2d').getImageData(0, 0, sm.width, sm.height);
  const angle = estimateSkew(inkMask(img.data, sm.width, sm.height), sm.width, sm.height, { maxDeg: 8, step: 0.2 });
  sm.width = sm.height = 0;
  if (!angle) return { canvas: srcCanvas, how: 'none', angle: 0, quad: null };
  return { canvas: rotateFree(srcCanvas, -angle), how: 'tilt', angle, quad: null };
}
