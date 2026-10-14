// GENERATED – synced copy of js/tools/scanproc.js by scripts/sync-webtools-vendor.mjs.
// Do not edit here: change the source in the app and run `node scripts/sync-webtools-vendor.mjs`.
// Scanner image processing: document edge detection, perspective correction and filters.
// Everything is plain JS on canvases (no libraries); heavy loops yield to keep the UI responsive.

const tick = () => new Promise(r => setTimeout(r, 0));

// ------------------------------------------------------------------ helpers
export function toGray(data, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
  return g;
}

function blur(src, w, h, passes = 1) {
  // separable [1 4 6 4 1] / 16
  let a = src, b = new Float32Array(w * h);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - 2), x1 = Math.max(0, x - 1), x3 = Math.min(w - 1, x + 1), x4 = Math.min(w - 1, x + 2);
        b[o + x] = (a[o + x0] + 4 * a[o + x1] + 6 * a[o + x] + 4 * a[o + x3] + a[o + x4]) / 16;
      }
    }
    const c = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - 2) * w, y1 = Math.max(0, y - 1) * w, y3 = Math.min(h - 1, y + 1) * w, y4 = Math.min(h - 1, y + 2) * w, o = y * w;
      for (let x = 0; x < w; x++) c[o + x] = (b[y0 + x] + 4 * b[y1 + x] + 6 * b[o + x] + 4 * b[y3 + x] + b[y4 + x]) / 16;
    }
    a = c;
  }
  return a;
}

function sobel(g, w, h) {
  const m = new Float32Array(w * h);
  let max = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1] + g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1];
      const gy = -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
      const v = Math.hypot(gx, gy);
      m[i] = v;
      if (v > max) max = v;
    }
  }
  return { m, max };
}

function otsu(values, bins = 256, maxVal = 255) {
  const hist = new Float64Array(bins);
  for (let i = 0; i < values.length; i++) hist[Math.min(bins - 1, Math.floor(values[i] / maxVal * (bins - 1)))]++;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < bins; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 0;
  for (let i = 0; i < bins; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = i; }
  }
  return (thr / (bins - 1)) * maxVal;
}

function dilate(mask, w, h, r = 1) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    for (let dy = -r; dy <= r; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -r; dx <= r; dx++) { const xx = x + dx; if (xx >= 0 && xx < w) out[yy * w + xx] = 1; }
    }
  }
  return out;
}
function erode(mask, w, h, r = 1) {
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1;
  const d = dilate(inv, w, h, r);
  for (let i = 0; i < d.length; i++) d[i] = d[i] ? 0 : 1;
  return d;
}

/** Largest 4-connected component of mask → array of pixel indices (only boundary pixels kept). */
function largestComponent(mask, w, h) {
  const label = new Int32Array(w * h);
  let best = null, bestSize = 0, cur = 0;
  const stack = new Int32Array(w * h);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || label[i]) continue;
    cur++;
    let sp = 0, size = 0;
    stack[sp++] = i; label[i] = cur;
    const pts = [];
    while (sp) {
      const p = stack[--sp];
      size++;
      const x = p % w, y = (p / w) | 0;
      let boundary = false;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) {
        if (q < 0) { boundary = true; continue; }
        if (!mask[q]) { boundary = true; continue; }
        if (!label[q]) { label[q] = cur; stack[sp++] = q; }
      }
      if (boundary) pts.push(p);
    }
    if (size > bestSize) { bestSize = size; best = pts; }
  }
  return { pts: best || [], size: bestSize };
}

function convexHull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

const polyArea = q => {
  let a = 0;
  for (let i = 0; i < q.length; i++) { const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % q.length]; a += x1 * y2 - x2 * y1; }
  return Math.abs(a) / 2;
};

/** Pick the 4 hull vertices that span the largest quadrilateral. */
function maxQuad(hull) {
  let pts = hull;
  // thin out long hulls (keeps it fast)
  while (pts.length > 48) pts = pts.filter((_, i) => i % 2 === 0);
  const n = pts.length;
  if (n < 4) return null;
  let best = null, bestA = -1;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let c = b + 1; c < n; c++) for (let d = c + 1; d < n; d++) {
    const q = [pts[a], pts[b], pts[c], pts[d]];
    const ar = polyArea(q);
    if (ar > bestA) { bestA = ar; best = q; }
  }
  return best;
}

/** Order 4 points as TL, TR, BR, BL. */
export function orderQuad(q) {
  const c = q.reduce((s, p) => [s[0] + p[0] / 4, s[1] + p[1] / 4], [0, 0]);
  const sorted = q.slice().sort((a, b) => Math.atan2(a[1] - c[1], a[0] - c[0]) - Math.atan2(b[1] - c[1], b[0] - c[0]));
  // atan2 order starts at the left (−π): TL comes first after rotating so that TL = min(x+y)
  let start = 0, bestS = Infinity;
  sorted.forEach((p, i) => { const s = p[0] + p[1]; if (s < bestS) { bestS = s; start = i; } });
  const out = [];
  for (let i = 0; i < 4; i++) out.push(sorted[(start + i) % 4]);
  // ensure clockwise (TL → TR → BR → BL) in screen coordinates
  const cross = (out[1][0] - out[0][0]) * (out[2][1] - out[0][1]) - (out[1][1] - out[0][1]) * (out[2][0] - out[0][0]);
  if (cross < 0) return [out[0], out[3], out[2], out[1]];
  return out;
}

function quadOk(q, w, h) {
  const a = polyArea(q) / (w * h);
  if (a < 0.05 || a > 0.985) return false;
  for (let i = 0; i < 4; i++) {
    const p0 = q[(i + 3) % 4], p1 = q[i], p2 = q[(i + 1) % 4];
    const v1 = [p0[0] - p1[0], p0[1] - p1[1]], v2 = [p2[0] - p1[0], p2[1] - p1[1]];
    const ang = Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) || 1)))) * 180 / Math.PI;
    if (ang < 40 || ang > 140) return false;
  }
  return true;
}

/** Mean gradient magnitude sampled along the quad's edges (0..1). */
function edgeSupport(q, mag, max, w, h) {
  let s = 0, n = 0;
  for (let i = 0; i < 4; i++) {
    const [x0, y0] = q[i], [x1, y1] = q[(i + 1) % 4];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(8, Math.floor(len / 2));
    let hits = 0;
    for (let k = 1; k < steps; k++) {
      const x = x0 + (x1 - x0) * k / steps, y = y0 + (y1 - y0) * k / steps;
      // best response within ±2 px perpendicular (detected corners are slightly off)
      let best = 0;
      const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
      for (let d = -2; d <= 2; d++) {
        const xi = Math.round(x + nx * d), yi = Math.round(y + ny * d);
        if (xi > 0 && yi > 0 && xi < w - 1 && yi < h - 1) best = Math.max(best, mag[yi * w + xi]);
      }
      s += best / max;
      if (best / max > 0.12) hits++;
      n++;
    }
    if (hits / (steps - 1) < 0.35) s -= 0.5 * (steps - 1); // a side with no edge is suspicious
  }
  return n ? s / n : 0;
}

/**
 * Detect a document in an image.
 * @param {ImageData} img  (ideally ≤ 400 px on the long side)
 * @returns {{quad: number[][]|null, score: number}} quad in normalized [0..1] coordinates (TL,TR,BR,BL)
 */
export function detectDocument(img) {
  const { width: w, height: h, data } = img;
  const gray = blur(toGray(data, w, h), w, h, 2);
  const { m, max } = sobel(gray, w, h);
  if (max < 1) return { quad: null, score: 0 };
  const candidates = [];
  const tryMask = mask => {
    const comp = largestComponent(mask, w, h);
    if (comp.size < w * h * 0.035) return;
    const hull = convexHull(comp.pts.map(p => [p % w, (p / w) | 0]));
    const q = maxQuad(hull);
    if (!q) return;
    const oq = orderQuad(q);
    if (!quadOk(oq, w, h)) return;
    const sup = edgeSupport(oq, m, max, w, h);
    candidates.push({ q: oq, score: sup * Math.sqrt(polyArea(oq) / (w * h)), sup });
  };
  // A) bright region (paper is usually brighter than the table)
  const t = otsu(gray);
  const bright = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) bright[i] = gray[i] > t ? 1 : 0;
  tryMask(dilate(erode(bright, w, h, 2), w, h, 2));
  // B) brighter-than-surroundings with a stricter threshold (busy, light backgrounds)
  const t2 = t + (255 - t) * 0.35;
  const bright2 = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) bright2[i] = gray[i] > t2 ? 1 : 0;
  tryMask(dilate(erode(bright2, w, h, 2), w, h, 2));
  // C) closed edge contour: fill everything not reachable from the border
  const et = Math.max(otsu(m, 256, max), max * 0.12);
  let edges = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) edges[i] = m[i] > et ? 1 : 0;
  edges = dilate(edges, w, h, 1);
  const outside = new Uint8Array(w * h);
  const st = [];
  const push = i => { if (!outside[i] && !edges[i]) { outside[i] = 1; st.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (st.length) {
    const p = st.pop();
    const x = p % w, y = (p / w) | 0;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }
  const inside = new Uint8Array(w * h);
  for (let i = 0; i < inside.length; i++) inside[i] = outside[i] ? 0 : 1;
  tryMask(erode(inside, w, h, 1));
  if (!candidates.length) return { quad: null, score: 0 };
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (best.sup < 0.08) return { quad: null, score: best.score };
  return { quad: best.q.map(([x, y]) => [x / (w - 1), y / (h - 1)]), score: best.score };
}

/** Downscale any drawable to ImageData with max side `max`. */
export function smallImageData(src, max = 360) {
  const sw = src.videoWidth || src.naturalWidth || src.width, sh = src.videoHeight || src.naturalHeight || src.height;
  const f = Math.min(1, max / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * f)), h = Math.max(1, Math.round(sh * f));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h);
  c.width = c.height = 0;
  return d;
}

// ------------------------------------------------------------------ perspective warp
function solve(A, b) {
  const n = b.length;
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
    const d = A[i][i] || 1e-12;
    for (let r = i + 1; r < n; r++) {
      const f = A[r][i] / d;
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
    x[i] = s / (A[i][i] || 1e-12);
  }
  return x;
}

/** Homography mapping dst points → src points (8 params). */
export function homography(dst, src) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = dst[i], [x, y] = src[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
  }
  return solve(A, b);
}

/**
 * True width/height ratio of the photographed rectangle (Zhang & He, "Whiteboard scanning"):
 * estimates the focal length from the perspective quad (principal point = image centre).
 * Returns null when it cannot be determined reliably.
 */
export function rectAspect(quadPx, cx, cy) {
  const [tl, tr, br, bl] = quadPx.map(([x, y]) => [x - cx, y - cy, 1]);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const m1 = tl, m2 = tr, m3 = bl, m4 = br;
  const c14 = cross(m1, m4);
  const k2 = dot(c14, m3) / dot(cross(m2, m4), m3);
  const k3 = dot(c14, m2) / dot(cross(m3, m4), m2);
  if (!Number.isFinite(k2) || !Number.isFinite(k3)) return null;
  const n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 * m2[2] - m1[2]];
  const n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 * m3[2] - m1[2]];
  let ratio2;
  const pz = n2[2] * n3[2];
  if (Math.abs(n2[2]) < 1e-6 || Math.abs(n3[2]) < 1e-6) {
    ratio2 = (n2[0] ** 2 + n2[1] ** 2) / (n3[0] ** 2 + n3[1] ** 2); // no perspective (affine)
  } else {
    const f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / pz;
    if (!(f2 > 0)) return null;
    ratio2 = (n2[0] ** 2 / f2 + n2[1] ** 2 / f2 + n2[2] ** 2) / (n3[0] ** 2 / f2 + n3[1] ** 2 / f2 + n3[2] ** 2);
  }
  const r = Math.sqrt(ratio2);
  return Number.isFinite(r) && r > 0 ? r : null;
}

/** Output size for a quad (in source pixels), capped to maxSide. */
export function warpSize(quadPx, maxSide, aspect = null, center = null) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let w = Math.max(d(quadPx[0], quadPx[1]), d(quadPx[3], quadPx[2]));
  let h = Math.max(d(quadPx[0], quadPx[3]), d(quadPx[1], quadPx[2]));
  if (!aspect && center) {
    const r = rectAspect(quadPx, center[0], center[1]);
    const naive = w / h;
    // trust the estimate only within a sane range of the naive ratio
    if (r && r > naive / 1.8 && r < naive * 1.8) aspect = r;
  }
  if (aspect) { // keep the larger dimension, derive the other from the aspect ratio
    if (w / h > aspect) h = w / aspect; else w = h * aspect;
  }
  const f = Math.min(1, maxSide / Math.max(w, h));
  return [Math.max(8, Math.round(w * f)), Math.max(8, Math.round(h * f))];
}

/**
 * Perspective-correct a quad of the source canvas into a new canvas.
 * @param {HTMLCanvasElement} srcCanvas
 * @param {number[][]} quadN   normalized TL,TR,BR,BL
 */
export async function warp(srcCanvas, quadN, { maxSide = 2400, aspect = null, onProgress } = {}) {
  const sw = srcCanvas.width, sh = srcCanvas.height;
  const quad = quadN.map(([x, y]) => [x * sw, y * sh]);
  const [W, H] = warpSize(quad, maxSide, aspect, aspect ? null : [sw / 2, sh / 2]);
  const src = srcCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, sw, sh).data;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const og = out.getContext('2d');
  const img = og.createImageData(W, H);
  const o = img.data;
  const hm = homography([[0, 0], [W - 1, 0], [W - 1, H - 1], [0, H - 1]], quad);
  const [a, b, c, d, e, f, g, hh] = hm;
  let t0 = performance.now();
  for (let v = 0; v < H; v++) {
    for (let u = 0; u < W; u++) {
      const den = g * u + hh * v + 1;
      let x = (a * u + b * v + c) / den, y = (d * u + e * v + f) / den;
      if (x < 0) x = 0; else if (x > sw - 1.001) x = sw - 1.001;
      if (y < 0) y = 0; else if (y > sh - 1.001) y = sh - 1.001;
      const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      const k = (v * W + u) * 4;
      o[k] = src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11;
      o[k + 1] = src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11;
      o[k + 2] = src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11;
      o[k + 3] = 255;
    }
    if (performance.now() - t0 > 40) { if (onProgress) onProgress(v / H); await tick(); t0 = performance.now(); }
  }
  og.putImageData(img, 0, 0);
  return out;
}

// ------------------------------------------------------------------ filters
/** Estimate the paper/background colour field (shading, colour cast) at low resolution. */
function backgroundField(canvas) {
  const W = canvas.width, H = canvas.height;
  const f = Math.min(1, 96 / Math.max(W, H));
  const w = Math.max(4, Math.round(W * f)), h = Math.max(4, Math.round(H * f));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(canvas, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h);
  const r = 3;
  // max filter (removes dark text), then box blur
  for (let pass = 0; pass < 2; pass++) {
    const src = new Uint8ClampedArray(d.data);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let mr = 0, mg = 0, mb = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -r; dx <= r; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          const i = (yy * w + xx) * 4;
          const lum = src[i] + src[i + 1] + src[i + 2];
          if (lum > mr + mg + mb) { mr = src[i]; mg = src[i + 1]; mb = src[i + 2]; }
        }
      }
      const i = (y * w + x) * 4;
      d.data[i] = mr; d.data[i + 1] = mg; d.data[i + 2] = mb;
    }
  }
  g.putImageData(d, 0, 0);
  g.filter = 'blur(2px)';
  g.drawImage(c, 0, 0);
  g.filter = 'none';
  const big = document.createElement('canvas');
  big.width = W; big.height = H;
  const bg = big.getContext('2d', { willReadFrequently: true });
  bg.imageSmoothingEnabled = true;
  bg.imageSmoothingQuality = 'high';
  bg.drawImage(c, 0, 0, W, H);
  c.width = c.height = 0;
  const field = bg.getImageData(0, 0, W, H).data;
  big.width = big.height = 0;
  return field;
}

/**
 * Apply a scan filter in place. filter: 'original' | 'enhance' | 'gray' | 'bw'
 */
export async function applyFilter(canvas, filter) {
  if (filter === 'original') return canvas;
  if (filter === 'magic' || filter === 'photo') {
    // photo tools (imgproc.js, in a worker when possible): "Magie" = shadow removal + sharpening
    // for document photos, "Foto" = denoise + contrast + sharpening for pictures
    const { runOp } = await import('./imgproc.js');
    const g0 = canvas.getContext('2d', { willReadFrequently: true });
    let data = g0.getImageData(0, 0, canvas.width, canvas.height);
    if (filter === 'magic') {
      data = await runOp('removeShadows', data, { strength: 1 });
      data = await runOp('sharpen', data, { amount: 0.7, radius: 1, threshold: 3, scale: Math.max(canvas.width, canvas.height) / 1600 });
    } else data = await runOp('enhance', data, { strength: 1 });
    g0.putImageData(data, 0, 0);
    return canvas;
  }
  const W = canvas.width, H = canvas.height;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  const bgf = backgroundField(canvas);
  // 1) divide by background → white paper, no shading or colour cast
  for (let i = 0; i < d.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      const b = Math.max(40, bgf[i + k]);
      d[i + k] = Math.min(255, (d[i + k] / b) * 255);
    }
  }
  await tick();
  if (filter === 'enhance') {
    // 2) levels: push near-white to white and darken ink
    const lo = 55, hi = 235;
    for (let i = 0; i < d.length; i += 4) {
      for (let k = 0; k < 3; k++) {
        let v = (d[i + k] - lo) / (hi - lo);
        v = v < 0 ? 0 : v > 1 ? 1 : v;
        d[i + k] = 255 * Math.pow(v, 1.15);
      }
    }
  } else {
    const gray = new Float32Array(W * H);
    for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (filter === 'gray') {
      const lo = 45, hi = 238;
      for (let j = 0, i = 0; j < gray.length; j++, i += 4) {
        let v = (gray[j] - lo) / (hi - lo);
        v = v < 0 ? 0 : v > 1 ? 1 : v;
        d[i] = d[i + 1] = d[i + 2] = 255 * Math.pow(v, 1.1);
      }
    } else {
      // adaptive threshold (mean of a local window via integral image)
      const integ = new Float64Array((W + 1) * (H + 1));
      for (let y = 0; y < H; y++) {
        let row = 0;
        for (let x = 0; x < W; x++) {
          row += gray[y * W + x];
          integ[(y + 1) * (W + 1) + x + 1] = integ[y * (W + 1) + x + 1] + row;
        }
      }
      const r = Math.max(7, Math.round(Math.max(W, H) / 60));
      for (let y = 0; y < H; y++) {
        const y0 = Math.max(0, y - r), y1 = Math.min(H - 1, y + r);
        for (let x = 0; x < W; x++) {
          const x0 = Math.max(0, x - r), x1 = Math.min(W - 1, x + r);
          const cnt = (x1 - x0 + 1) * (y1 - y0 + 1);
          const sum = integ[(y1 + 1) * (W + 1) + x1 + 1] - integ[y0 * (W + 1) + x1 + 1] - integ[(y1 + 1) * (W + 1) + x0] + integ[y0 * (W + 1) + x0];
          const mean = sum / cnt;
          const v = gray[y * W + x];
          const black = v < mean * 0.86 && v < 200;
          const i = (y * W + x) * 4;
          d[i] = d[i + 1] = d[i + 2] = black ? 0 : 255;
        }
        if ((y & 127) === 0) await tick();
      }
    }
  }
  g.putImageData(img, 0, 0);
  return canvas;
}

/** Rotate a canvas by 0/90/180/270 degrees (clockwise). */
export function rotateCanvas(canvas, deg) {
  const r = ((deg % 360) + 360) % 360;
  if (!r) return canvas;
  const out = document.createElement('canvas');
  out.width = r % 180 ? canvas.height : canvas.width;
  out.height = r % 180 ? canvas.width : canvas.height;
  const g = out.getContext('2d');
  g.translate(out.width / 2, out.height / 2);
  g.rotate(r * Math.PI / 180);
  g.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  canvas.width = canvas.height = 0;
  return out;
}

export const FULL_QUAD = [[0, 0], [1, 0], [1, 1], [0, 1]];
