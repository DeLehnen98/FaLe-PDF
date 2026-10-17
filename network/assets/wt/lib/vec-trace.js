// Raster → real vector paths (no embedded bitmap). Pure functions, used in a worker (lib/vec-worker.js) by
// tools/image-to-svg.js and by the unit test tests/suites/webtools/vec_unit.mjs.
//
//   1. colours: k-means in Lab on a sample (deterministic), "auto" merges look-alike and tiny clusters;
//      black & white / cut outline use a threshold (Otsu unless given)
//   2. clean-up: anti-aliasing fringes (mode filter) and specks below a minimum size join their neighbour
//   3. stacking: layers from the background up, each layer also covers everything drawn above it – so
//      neighbouring colours never leave hairline gaps, however much the outlines are smoothed
//   4. outlines: pixel-edge loops → edge midpoints (no staircase) → Douglas–Peucker → corners kept sharp,
//      long runs as straight lines, the rest as smooth cubic curves with matching tangents
//
// Output: { width, height, layers: [{ color: [r,g,b], d, nodes, area }], nodes } with path data in the
// coordinates of the original picture (opts.outScale = original px per traced px).

// ---------------------------------------------------------------- colour helpers
const srgb = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const LIN = new Float32Array(256).map((_, i) => srgb(i));
function lab(r, g, b) {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, y = R * 0.2126 + G * 0.7152 + B * 0.0722, z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
export const hex = c => '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

function rng(seed = 1234567) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

/** k-means++ on Lab samples → centres (Lab) */
function kmeans(samples, k, iters = 12) {
  const rnd = rng(42);
  const n = samples.length;
  const cents = [samples[Math.floor(rnd() * n)].slice()];
  const dist = new Float64Array(n).fill(Infinity);
  while (cents.length < k) {
    const c = cents[cents.length - 1];
    let sum = 0;
    for (let i = 0; i < n; i++) { const d = d2(samples[i], c); if (d < dist[i]) dist[i] = d; sum += dist[i]; }
    if (sum === 0) break;
    let t = rnd() * sum, i = 0;
    for (; i < n - 1; i++) { t -= dist[i]; if (t <= 0) break; }
    cents.push(samples[i].slice());
  }
  const asg = new Int32Array(n);
  for (let it = 0; it < iters; it++) {
    const acc = cents.map(() => [0, 0, 0, 0]);
    let moved = 0;
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < cents.length; c++) { const d = d2(samples[i], cents[c]); if (d < bd) { bd = d; best = c; } }
      if (asg[i] !== best) moved++;
      asg[i] = best;
      const a = acc[best]; a[0] += samples[i][0]; a[1] += samples[i][1]; a[2] += samples[i][2]; a[3]++;
    }
    for (let c = 0; c < cents.length; c++) if (acc[c][3]) cents[c] = [acc[c][0] / acc[c][3], acc[c][1] / acc[c][3], acc[c][2] / acc[c][3]];
    if (!moved) break;
  }
  return cents;
}

/** Otsu threshold of luminance values (Uint8Array, only opaque pixels) */
export function otsu(hist) {
  let total = 0, sum = 0;
  for (let i = 0; i < 256; i++) { total += hist[i]; sum += i * hist[i]; }
  let sB = 0, wB = 0, best = 127, max = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sB += t * hist[t];
    const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2;
    if (v > max) { max = v; best = t; }
  }
  return best;
}

// ---------------------------------------------------------------- labelling
/**
 * Pixel labels (Uint8Array, 255 = transparent) and the palette (sRGB) for an RGBA image.
 * opts: { mode: 'color' | 'bw' | 'outline', colors: 0 (auto) | 2…16, threshold: 0 (auto) | 1…254, invert }
 */
export function quantize({ data, width: w, height: h }, { mode = 'color', colors = 0, threshold = 0, invert = false } = {}) {
  const n = w * h;
  const labels = new Uint8Array(n);
  if (mode === 'bw' || mode === 'outline') {
    const lum = new Uint8Array(n), hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) {
      if (data[i * 4 + 3] < 128) { labels[i] = 255; continue; }
      const l = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000 | 0;
      lum[i] = l; hist[l]++;
    }
    const t = threshold || otsu(hist);
    for (let i = 0; i < n; i++) if (labels[i] !== 255) labels[i] = (lum[i] <= t) !== !!invert ? 1 : 0;
    return { labels, palette: [[255, 255, 255], [0, 0, 0]], threshold: t };
  }
  // sample opaque pixels on a jittered grid
  const opaque = [];
  const step = Math.max(1, Math.floor(Math.sqrt(n / 40000)));
  const rnd = rng(7);
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    const xx = Math.min(w - 1, x + Math.floor(rnd() * step)), yy = Math.min(h - 1, y + Math.floor(rnd() * step));
    const i = (yy * w + xx) * 4;
    if (data[i + 3] >= 128) opaque.push(lab(data[i], data[i + 1], data[i + 2]));
  }
  if (!opaque.length) { labels.fill(255); return { labels, palette: [] }; }
  let cents = kmeans(opaque, colors || 16);
  // assign every pixel (cache by 15-bit colour)
  const cache = new Int16Array(32768).fill(-1);
  const assign = (r, g, b) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let v = cache[key];
    if (v >= 0) return v;
    const L = lab(r, g, b);
    let bd = Infinity; v = 0;
    for (let c = 0; c < cents.length; c++) { const d = d2(L, cents[c]); if (d < bd) { bd = d; v = c; } }
    cache[key] = v;
    return v;
  };
  const fill = () => {
    for (let i = 0; i < n; i++) labels[i] = data[i * 4 + 3] < 128 ? 255 : assign(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  };
  fill();
  if (!colors) {
    // auto: merge clusters that look alike (ΔE < 12) or cover < 0.25 % of the picture
    const count = new Float64Array(cents.length);
    for (let i = 0; i < n; i++) if (labels[i] !== 255) count[labels[i]]++;
    const total = count.reduce((s, v) => s + v, 0) || 1;
    let alive = cents.map((c, i) => ({ c, n: count[i] })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
    let keep = [];
    for (const x of alive) {
      const near = keep.find(k => d2(k.c, x.c) < 144);
      if (near || x.n / total < 0.0025) {
        const tgt = near || keep.reduce((b, k) => (!b || d2(k.c, x.c) < d2(b.c, x.c) ? k : b), null);
        if (tgt) { const t = tgt.n + x.n; tgt.c = tgt.c.map((v, j) => (v * tgt.n + x.c[j] * x.n) / t); tgt.n = t; continue; }
      }
      keep.push({ ...x });
    }
    // anti-aliasing leaves small clusters of in-between colours on the line between two real colours: drop them
    for (let pass = 0; pass < 3; pass++) {
      const drop = new Set();
      for (const c of keep) {
        if (c.n / total > 0.06) continue;
        for (const a of keep) for (const b of keep) {
          if (a === b || a === c || b === c || drop.has(a) || drop.has(b) || a.n < c.n * 1.5 || b.n < c.n * 1.5) continue;
          const ab = [b.c[0] - a.c[0], b.c[1] - a.c[1], b.c[2] - a.c[2]], L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
          const t = ((c.c[0] - a.c[0]) * ab[0] + (c.c[1] - a.c[1]) * ab[1] + (c.c[2] - a.c[2]) * ab[2]) / L2;
          if (t < 0.08 || t > 0.92) continue;
          const p = [a.c[0] + t * ab[0], a.c[1] + t * ab[1], a.c[2] + t * ab[2]];
          if (d2(p, c.c) < 100) { drop.add(c); break; }
        }
      }
      if (!drop.size) break;
      keep = keep.filter(c => !drop.has(c));
    }
    cents = keep.map(k => k.c);
    cache.fill(-1);
    fill();
  }
  // palette in sRGB = mean colour of the pixels of each label
  const acc = cents.map(() => [0, 0, 0, 0]);
  for (let i = 0; i < n; i++) { const l = labels[i]; if (l === 255) continue; const a = acc[l]; a[0] += data[i * 4]; a[1] += data[i * 4 + 1]; a[2] += data[i * 4 + 2]; a[3]++; }
  const palette = acc.map(a => (a[3] ? [a[0] / a[3], a[1] / a[3], a[2] / a[3]] : [0, 0, 0]));
  return { labels, palette };
}

/** One pass of a 3×3 majority filter: removes the 1-px anti-aliasing fringe between two colours. */
export function modeFilter(labels, w, h) {
  const out = labels.slice();
  const cnt = new Map();
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, me = labels[i];
    cnt.clear();
    let best = me, bc = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const l = labels[i + dy * w + dx];
      const c = (cnt.get(l) || 0) + 1; cnt.set(l, c);
      if (c > bc) { bc = c; best = l; }
    }
    if (best !== me && bc >= 5 && (cnt.get(me) || 0) <= 2) out[i] = best;
  }
  return out;
}

/** Specks smaller than minArea pixels take the colour that surrounds them most. */
export function removeSpecks(labels, w, h, minArea) {
  if (minArea <= 1) return labels;
  const n = w * h;
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  const comp = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue;
    const l = labels[s];
    let head = 0, tail = 0, size = 0;
    queue[tail++] = s; seen[s] = 1;
    const border = new Map();
    while (head < tail) {
      const i = queue[head++];
      comp[size++] = i;
      const x = i % w, y = (i / w) | 0;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of nb) {
        if (j < 0) continue;
        if (labels[j] === l) { if (!seen[j]) { seen[j] = 1; queue[tail++] = j; } }
        else border.set(labels[j], (border.get(labels[j]) || 0) + 1);
      }
      if (size > minArea && border.size === 0 && head === tail) break;
    }
    if (size >= minArea || !border.size || l === 255) continue;
    let best = -1, bc = -1;
    for (const [k, c] of border) if (k !== 255 && c > bc) { bc = c; best = k; }
    if (best < 0) continue;
    for (let k = 0; k < size; k++) labels[comp[k]] = best;
  }
  return labels;
}

// ---------------------------------------------------------------- outlines
/** Closed loops along pixel edges of mask (1 = inside), inside on the right (y down): holes run the other way. */
export function loops(mask, w, h) {
  const W = w + 1;
  const out = new Int32Array((w + 1) * (h + 1) * 2).fill(-1);   // up to two outgoing edges per vertex
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  const add = (a, b) => { if (out[a * 2] < 0) out[a * 2] = b; else out[a * 2 + 1] = b; };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    if (!at(x, y - 1)) add(y * W + x, y * W + x + 1);
    if (!at(x + 1, y)) add(y * W + x + 1, (y + 1) * W + x + 1);
    if (!at(x, y + 1)) add((y + 1) * W + x + 1, (y + 1) * W + x);
    if (!at(x - 1, y)) add((y + 1) * W + x, y * W + x);
  }
  const res = [];
  for (let v0 = 0; v0 < out.length / 2; v0++) {
    while (out[v0 * 2] >= 0 || out[v0 * 2 + 1] >= 0) {
      const pts = [];
      let v = v0, prev = -1, guard = 0;
      do {
        // at a pinch vertex (two edges out) take the turn that keeps the loop tight (right turn)
        let k = out[v * 2] >= 0 ? 0 : 1;
        if (out[v * 2] >= 0 && out[v * 2 + 1] >= 0 && prev >= 0) {
          const px = v % W - prev % W, py = ((v / W) | 0) - ((prev / W) | 0);
          const cand = [0, 1].map(j => { const n = out[v * 2 + j]; return { j, cross: px * (((n / W) | 0) - ((v / W) | 0)) - py * (n % W - v % W) }; });
          k = cand.sort((a, b) => b.cross - a.cross)[0].j;
        }
        const nx = out[v * 2 + k];
        out[v * 2 + k] = -1;
        pts.push(v % W, (v / W) | 0);
        prev = v; v = nx;
      } while (v !== v0 && v >= 0 && ++guard < 1e7);
      if (pts.length >= 8) res.push(pts);
    }
  }
  return res;
}

const r2 = v => Math.round(v * 100) / 100;
const fmt = v => { const s = String(r2(v)); return s.startsWith('0.') ? s.slice(1) : s.startsWith('-0.') ? '-' + s.slice(2) : s; };

// ---- small vector helpers
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add2 = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = a => Math.hypot(a[0], a[1]);
const unit = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const bez = (c, t) => { const m = 1 - t; return [m * m * m * c[0][0] + 3 * m * m * t * c[1][0] + 3 * m * t * t * c[2][0] + t * t * t * c[3][0], m * m * m * c[0][1] + 3 * m * m * t * c[1][1] + 3 * m * t * t * c[2][1] + t * t * t * c[3][1]]; };

/**
 * Least-squares cubic Bézier fitting (Schneider, "An Algorithm for Automatically Fitting Digitized Curves",
 * Graphics Gems 1990): one curve per run when it fits within `err`, otherwise split at the worst point.
 */
function fitCubic(P, t1, t2, err, out, depth = 0) {
  const n = P.length;
  if (n === 2 || depth > 12) {
    const d = len(sub(P[n - 1], P[0])) / 3;
    out.push([P[0], add2(P[0], mul(t1, d)), add2(P[n - 1], mul(t2, d)), P[n - 1]]);
    return;
  }
  let u = [0];
  for (let i = 1; i < n; i++) u.push(u[i - 1] + len(sub(P[i], P[i - 1])));
  const total = u[n - 1] || 1;
  u = u.map(v => v / total);
  const gen = uu => {
    const A = uu.map(t => { const m = 1 - t; return [mul(t1, 3 * m * m * t), mul(t2, 3 * m * t * t)]; });
    let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
    for (let i = 0; i < n; i++) {
      const t = uu[i], m = 1 - t;
      c00 += dot(A[i][0], A[i][0]); c01 += dot(A[i][0], A[i][1]); c11 += dot(A[i][1], A[i][1]);
      const tmp = sub(P[i], add2(mul(P[0], m * m * m + 3 * m * m * t), mul(P[n - 1], 3 * m * t * t + t * t * t)));
      x0 += dot(A[i][0], tmp); x1 += dot(A[i][1], tmp);
    }
    const det = c00 * c11 - c01 * c01;
    let a1 = det ? (x0 * c11 - x1 * c01) / det : 0, a2 = det ? (c00 * x1 - c01 * x0) / det : 0;
    const seg = len(sub(P[n - 1], P[0])), eps = 1e-6 * seg;
    if (a1 < eps || a2 < eps || a1 > seg * 2 || a2 > seg * 2) { a1 = a2 = seg / 3; }
    return [P[0], add2(P[0], mul(t1, a1)), add2(P[n - 1], mul(t2, a2)), P[n - 1]];
  };
  const maxErr = (c, uu) => {
    let m = 0, at = Math.floor(n / 2);
    for (let i = 1; i < n - 1; i++) { const d = len(sub(bez(c, uu[i]), P[i])) ** 2; if (d >= m) { m = d; at = i; } }
    return [m, at];
  };
  let c = gen(u);
  let [e, split] = maxErr(c, u);
  if (e < err * err) { out.push(c); return; }
  if (e < err * err * 4) {
    for (let it = 0; it < 4; it++) {
      // Newton–Raphson re-parameterisation
      u = u.map((t, i) => {
        const q = bez(c, t);
        const d1 = [0, 1].map(k => 3 * ((1 - t) ** 2 * (c[1][k] - c[0][k]) + 2 * (1 - t) * t * (c[2][k] - c[1][k]) + t * t * (c[3][k] - c[2][k])));
        const d2v = [0, 1].map(k => 6 * ((1 - t) * (c[2][k] - 2 * c[1][k] + c[0][k]) + t * (c[3][k] - 2 * c[2][k] + c[1][k])));
        const num = (q[0] - P[i][0]) * d1[0] + (q[1] - P[i][1]) * d1[1];
        const den = d1[0] ** 2 + d1[1] ** 2 + (q[0] - P[i][0]) * d2v[0] + (q[1] - P[i][1]) * d2v[1];
        return den ? Math.min(1, Math.max(0, t - num / den)) : t;
      });
      c = gen(u);
      [e, split] = maxErr(c, u);
      if (e < err * err) { out.push(c); return; }
    }
  }
  split = Math.max(1, Math.min(n - 2, split));
  const tc = unit(sub(P[split - 1], P[split + 1]));
  fitCubic(P.slice(0, split + 1), t1, tc, err, out, depth + 1);
  fitCubic(P.slice(split), mul(tc, -1), t2, err, out, depth + 1);
}

/**
 * One closed outline (pixel-edge loop as [x0,y0,x1,y1,…]) → smooth path: edge midpoints (no staircase),
 * corners found over a short window and kept sharp, gentle smoothing between them, straight runs as lines,
 * the rest as least-squares cubic curves. → { d, nodes, start, ops }
 */
function fitLoop(flat, { cornerDeg, sigma, err, scale }) {
  const n = flat.length / 2;
  if (n < 4) return null;
  let P = new Array(n);
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; P[i] = [(flat[i * 2] + flat[j * 2]) / 2, (flat[i * 2 + 1] + flat[j * 2 + 1]) / 2]; }
  // corners: direction change measured over ±k points, local maxima only
  const k = Math.max(2, Math.min(6, Math.floor(n / 8)));
  const cosLim = Math.cos(cornerDeg * Math.PI / 180);
  const turn = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = unit(sub(P[i], P[(i - k + n) % n])), b = unit(sub(P[(i + k) % n], P[i]));
    turn[i] = dot(a, b);
  }
  const corners = [];
  for (let i = 0; i < n; i++) {
    if (turn[i] >= cosLim) continue;
    let isMin = true;
    for (let d = -k; d <= k && isMin; d++) if (d && turn[(i + d + n) % n] < turn[i]) isMin = false;
    if (isMin && !corners.some(c => Math.min(Math.abs(c - i), n - Math.abs(c - i)) <= k)) corners.push(i);
  }
  corners.sort((a, b) => a - b);
  // smoothing (Gaussian along the outline), corners stay where they are
  if (sigma > 0) {
    const R = Math.ceil(sigma * 2.5), w = [];
    for (let d = -R; d <= R; d++) w.push(Math.exp(-(d * d) / (2 * sigma * sigma)));
    const isC = new Uint8Array(n); corners.forEach(c => { isC[c] = 1; });
    const Q = P.map((p, i) => {
      if (isC[i]) return p;
      let sx = 0, sy = 0, sw = 0;
      for (let d = -R; d <= R; d++) {
        // don't smooth across a corner
        let blocked = false;
        for (let e = Math.sign(d); Math.abs(e) <= Math.abs(d) && e; e += Math.sign(d)) if (isC[(i + e + n) % n]) { blocked = true; break; }
        if (blocked) continue;
        const q = P[(i + d + n) % n], ww = w[d + R];
        sx += q[0] * ww; sy += q[1] * ww; sw += ww;
      }
      return [sx / sw, sy / sw];
    });
    P = Q;
  }
  // runs between corners (a loop without corners is one run that starts and ends at point 0)
  const runs = [];
  const starts = corners.length ? corners : [0];
  for (let r = 0; r < starts.length; r++) {
    const s0 = starts[r], s1 = starts[(r + 1) % starts.length];
    const m = ((s1 - s0 + n) % n) || n;
    const pts = [];
    for (let q = 0; q <= m; q++) pts.push(P[(s0 + q) % n]);
    runs.push(pts);
  }
  const S = scale;
  const ops = [];
  for (const pts of runs) {
    const m = pts.length;
    if (m < 2) continue;
    // straight? (all points within a fraction of a pixel of the chord)
    const a = pts[0], b = pts[m - 1], ab = sub(b, a), L = len(ab);
    let dev = 0;
    if (L > 0) for (const q of pts) dev = Math.max(dev, Math.abs((q[0] - a[0]) * ab[1] - (q[1] - a[1]) * ab[0]) / L);
    if (L > 0 && dev <= Math.max(0.35, err * 0.35) && corners.length) { ops.push(['L', b]); continue; }
    const closed = !corners.length;
    const t1 = closed ? unit(sub(pts[1], pts[m - 2])) : unit(sub(pts[Math.min(m - 1, 2)], pts[0]));
    const t2 = closed ? mul(t1, -1) : unit(sub(pts[Math.max(0, m - 3)], pts[m - 1]));
    const cs = [];
    fitCubic(pts, t1, t2, err, cs);
    for (const c of cs) ops.push(['C', c[1], c[2], c[3]]);
  }
  if (!ops.length) return null;
  const start = runs[0][0];
  let d = `M${fmt(start[0] * S)} ${fmt(start[1] * S)}`;
  for (const op of ops) d += op[0] === 'L' ? `L${fmt(op[1][0] * S)} ${fmt(op[1][1] * S)}` : `C${fmt(op[1][0] * S)} ${fmt(op[1][1] * S)} ${fmt(op[2][0] * S)} ${fmt(op[2][1] * S)} ${fmt(op[3][0] * S)} ${fmt(op[3][1] * S)}`;
  return { d: d + 'Z', nodes: ops.length, start, ops };
}

/**
 * Trace an RGBA image. opts: quantize options + { detail 1…5, smooth 1…5, dropBackground, outScale }
 * → { width, height, layers: [{ color, d, nodes, area, ops }], nodes, palette, background }
 */
export function vectorize(img, opts = {}) {
  const { width: w, height: h } = img;
  const detail = opts.detail ?? 3, smooth = opts.smooth ?? 3;
  const q = quantize(img, opts);
  let labels = q.labels;
  if (detail <= 4) labels = modeFilter(labels, w, h);
  const minArea = [0, 120, 40, 14, 5, 1][detail] * Math.max(1, (w * h) / 1e6);
  labels = removeSpecks(labels, w, h, Math.round(minArea));
  const k = q.palette.length;
  const area = new Float64Array(k), borderCnt = new Float64Array(k);
  for (let i = 0; i < w * h; i++) { const l = labels[i]; if (l !== 255) area[l]++; }
  const edge = i => { const l = labels[i]; if (l !== 255) borderCnt[l]++; };
  for (let x = 0; x < w; x++) { edge(x); edge((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { edge(y * w); edge(y * w + w - 1); }
  const used = [...Array(k).keys()].filter(i => area[i] > 0);
  // the background: what most of the frame is made of (light colour for black & white)
  let bg = -1;
  if (opts.mode === 'bw' || opts.mode === 'outline') bg = area[0] > 0 ? 0 : -1;
  else if (used.length) {
    const totalBorder = borderCnt.reduce((s, v) => s + v, 0);
    const top = used.reduce((b, i) => (borderCnt[i] > borderCnt[b] ? i : b), used[0]);
    if (totalBorder && borderCnt[top] / totalBorder > 0.45) bg = top;
  }
  const order = used.filter(i => i !== bg).sort((a, b) => area[b] - area[a]);
  if (bg >= 0) order.unshift(bg);
  const rank = new Int16Array(256).fill(-1);
  order.forEach((l, r) => { rank[l] = r; });
  // in traced pixels; the tool traces at ~1200–2000 px, so these are fractions of a pixel of the original
  const err = [0, 0.45, 0.7, 1, 1.5, 2.2][smooth];
  const sigma = [0, 0, 0.8, 1.4, 2.2, 3.2][smooth];
  const cornerDeg = [0, 35, 45, 55, 65, 80][smooth];
  // enlarged pictures: one original pixel spans several traced pixels – smooth over that span, so the
  // interpolation ripple of the enlargement doesn't show up as bumps
  const up = Math.max(1, opts.srcScale || 1);
  const sigmaUp = sigma ? sigma * Math.max(1, up * 0.75) : 0, errUp = err * Math.max(1, up * 0.4);
  const scale = opts.outScale || 1;
  const layers = [];
  const mask = new Uint8Array(w * h);
  const dropBg = opts.dropBackground || opts.mode === 'outline';
  for (let r = 0; r < order.length; r++) {
    if (r === 0 && bg >= 0 && dropBg) continue;
    // this colour plus everything stacked above it (no gaps between neighbouring colours)
    for (let i = 0; i < w * h; i++) mask[i] = labels[i] !== 255 && rank[labels[i]] >= r ? 1 : 0;
    let d = '', nodes = 0;
    const ops = [];
    for (const lp of loops(mask, w, h)) {
      const p = fitLoop(lp, { cornerDeg, sigma: sigmaUp, err: errUp, scale });
      if (!p) continue;
      d += p.d; nodes += p.nodes; ops.push(p);
    }
    if (!d) continue;
    const color = opts.mode === 'bw' || opts.mode === 'outline' ? (order[r] === 1 ? [0, 0, 0] : [255, 255, 255]) : q.palette[order[r]];
    layers.push({ color, d, nodes, area: area[order[r]], ops });
  }
  return { width: w * scale, height: h * scale, scale, layers, nodes: layers.reduce((s, l) => s + l.nodes, 0), palette: order.map(l => q.palette[l]), background: bg >= 0 && !dropBg, threshold: q.threshold };
}

/** SVG document (colours may be overridden: recolor[i] = '#rrggbb' for layer i). */
export function toSvg(res, { recolor = {}, title = '' } = {}) {
  const W = r2(res.width), H = r2(res.height);
  const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const paths = res.layers.map((l, i) => `<path fill="${recolor[i] || hex(l.color)}" fill-rule="evenodd" d="${l.d}"/>`).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${title ? `<title>${esc(title)}</title>` : ''}\n${paths}\n</svg>\n`;
}

/** PDF content stream operators for the layers (PDF y axis up; 1 px = 0.75 pt). */
export function toPdfOps(res, { recolor = {} } = {}) {
  const S = res.scale || 1, H = res.height;
  const p = pt => `${r2(pt[0] * S * 0.75)} ${r2((H - pt[1] * S) * 0.75)}`;
  let s = '';
  res.layers.forEach((l, i) => {
    const c = recolor[i] ? [1, 3, 5].map(j => parseInt(recolor[i].slice(j, j + 2), 16)) : l.color;
    s += `${c.map(v => r2(v / 255)).join(' ')} rg\n`;
    for (const lp of l.ops) {
      s += `${p(lp.start)} m\n`;
      for (const op of lp.ops) s += op[0] === 'L' ? `${p(op[1])} l\n` : `${p(op[1])} ${p(op[2])} ${p(op[3])} c\n`;
      s += 'h\n';
    }
    s += 'f*\n';
  });
  return s;
}
