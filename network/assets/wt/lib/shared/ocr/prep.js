// GENERATED – synced copy of js/ocr/prep.js by scripts/sync-webtools-vendor.mjs.
// Do not edit here: change the source in the app and run `node scripts/sync-webtools-vendor.mjs`.
// Image pre-processing for OCR (pure functions, run in prep-worker.js when possible):
// grayscale, illumination/background normalisation, contrast stretch, deskew estimate
// (projection profiles), text-size estimate and upscaling of small text.
// All geometry is returned so word boxes can be mapped back to the source image.

/** RGBA → gray (alpha composited on white). */
export function toGray(rgba, w, h) {
  const n = w * h;
  const g = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    let v = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
    const a = rgba[j + 3];
    if (a < 255) v = (v * a + 255 * (255 - a)) / 255;
    g[i] = v;
  }
  return g;
}

function histogram(g) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < g.length; i++) hist[g[i]]++;
  return hist;
}
function percentile(hist, total, p) {
  const target = total * p;
  let acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) return v; }
  return 255;
}
export function otsu(hist, total) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; thr = t; }
  }
  return thr;
}

/**
 * Flatten uneven lighting: estimate the paper brightness per block (bright percentile),
 * smooth it and divide. Dark-on-light text keeps its contrast, shadows disappear.
 */
export function normalizeBackground(g, w, h) {
  const B = Math.max(16, Math.round(Math.max(w, h) / 48));
  const bw = Math.ceil(w / B), bh = Math.ceil(h / B);
  const bg = new Float32Array(bw * bh);
  const hist = new Uint32Array(256);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      hist.fill(0);
      let cnt = 0;
      const x0 = bx * B, y0 = by * B, x1 = Math.min(w, x0 + B), y1 = Math.min(h, y0 + B);
      for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { hist[g[y * w + x]]++; cnt++; }
      bg[by * bw + bx] = percentile(hist, cnt, 0.9);
    }
  }
  // smooth the block grid (3×3 max then mean) so text-dense blocks don't darken the estimate
  const mx = new Float32Array(bg.length);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    let m = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && yy < bh && xx >= 0 && xx < bw) m = Math.max(m, bg[yy * bw + xx]);
    }
    mx[y * bw + x] = m;
  }
  const sm = new Float32Array(bg.length);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    let s = 0, c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = y + dy, xx = x + dx;
      if (yy >= 0 && yy < bh && xx >= 0 && xx < bw) { s += mx[yy * bw + xx]; c++; }
    }
    sm[y * bw + x] = Math.max(40, s / c);
  }
  // bilinear upsample + divide
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(bh - 1, Math.max(0, (y + 0.5) / B - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(bh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(bw - 1, Math.max(0, (x + 0.5) / B - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(bw - 1, x0 + 1), tx = fx - x0;
      const b = (sm[y0 * bw + x0] * (1 - tx) + sm[y0 * bw + x1] * tx) * (1 - ty) + (sm[y1 * bw + x0] * (1 - tx) + sm[y1 * bw + x1] * tx) * ty;
      const v = (g[y * w + x] * 255) / b;
      out[y * w + x] = v > 255 ? 255 : v;
    }
  }
  return out;
}

/** Stretch the gray range when the contrast is weak (faint scans, grey paper). */
export function stretchContrast(g) {
  const hist = histogram(g);
  const lo = percentile(hist, g.length, 0.01), hi = percentile(hist, g.length, 0.995);
  if (hi - lo > 215 || hi - lo < 12) return g;
  const k = 255 / (hi - lo);
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.max(0, Math.min(255, Math.round((v - lo) * k)));
  for (let i = 0; i < g.length; i++) g[i] = lut[g[i]];
  return g;
}

/** Area-downscale a gray image so the long side is ≤ max. */
function shrink(g, w, h, max) {
  const f = Math.min(1, max / Math.max(w, h));
  if (f >= 1) return { g, w, h, f: 1 };
  const W = Math.max(1, Math.round(w * f)), H = Math.max(1, Math.round(h * f));
  const out = new Uint8Array(W * H);
  const sx = w / W, sy = h / H;
  for (let y = 0; y < H; y++) {
    const ya = Math.floor(y * sy), yb = Math.max(ya + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < W; x++) {
      const xa = Math.floor(x * sx), xb = Math.max(xa + 1, Math.floor((x + 1) * sx));
      let s = 0, c = 0;
      for (let yy = ya; yy < yb; yy += 1) for (let xx = xa; xx < xb; xx += 1) { s += g[yy * w + xx]; c++; }
      out[y * W + x] = s / c;
    }
  }
  return { g: out, w: W, h: H, f: W / w };
}

/**
 * Estimate the text direction (degrees, y-down image coordinates) via projection profiles,
 * plus the typical text line height (px of the full image). Returns {angle, lineHeight}.
 */
export function analyseLayout(g, w, h) {
  const s = shrink(g, w, h, 1100);
  const hist = histogram(s.g);
  const thr = Math.min(otsu(hist, s.g.length), 150);
  // ink map + integral image: keep only pixels in "stroke-like" neighbourhoods (drops solid dark
  // areas such as a desk around a photographed page, which would dominate the profiles)
  const W1 = s.w + 1;
  const ii = new Uint32Array(W1 * (s.h + 1));
  for (let y = 0; y < s.h; y++) {
    let row = 0;
    for (let x = 0; x < s.w; x++) { row += s.g[y * s.w + x] < thr ? 1 : 0; ii[(y + 1) * W1 + x + 1] = ii[y * W1 + x + 1] + row; }
  }
  const r = Math.max(3, Math.round(Math.max(s.w, s.h) / 160));
  const xs = [], ys = [];
  for (let y = 0; y < s.h; y++) {
    const ya = Math.max(0, y - r), yb = Math.min(s.h, y + r + 1);
    for (let x = 0; x < s.w; x++) {
      if (s.g[y * s.w + x] >= thr) continue;
      const xa = Math.max(0, x - r), xb = Math.min(s.w, x + r + 1);
      const dark = ii[yb * W1 + xb] - ii[ya * W1 + xb] - ii[yb * W1 + xa] + ii[ya * W1 + xa];
      if (dark < (yb - ya) * (xb - xa) * 0.55) { xs.push(x); ys.push(y); }
    }
  }
  const n = xs.length;
  if (n < 50 || n > s.w * s.h * 0.5) return { angle: 0, lineHeight: 0 };
  // sample at most 60k dark pixels (speed)
  const step = Math.max(1, Math.floor(n / 60000));
  const diag = Math.ceil(Math.hypot(s.w, s.h)) + 2;
  const bins = new Float64Array(diag * 2);
  const profile = deg => {
    const t = (deg * Math.PI) / 180, c = Math.cos(t), sn = Math.sin(t);
    bins.fill(0);
    for (let i = 0; i < n; i += step) {
      const r = Math.round(ys[i] * c - xs[i] * sn) + diag;
      bins[r]++;
    }
    let sc = 0;
    for (let i = 0; i < bins.length; i++) sc += bins[i] * bins[i];
    return sc;
  };
  let best = 0, bestScore = profile(0);
  const base = bestScore;
  for (let d = -8; d <= 8; d += 0.5) { const sc = profile(d); if (sc > bestScore) { bestScore = sc; best = d; } }
  const coarse = best;
  for (let d = coarse - 0.5; d <= coarse + 0.5 + 1e-9; d += 0.1) { const sc = profile(d); if (sc > bestScore) { bestScore = sc; best = d; } }
  let angle = Math.round(best * 100) / 100;
  if (Math.abs(angle) < 0.3 || bestScore < base * 1.03) angle = 0;
  // line height from the profile at the chosen angle: runs of "inked" rows
  profile(angle);
  let mxv = 0;
  for (let i = 0; i < bins.length; i++) mxv = Math.max(mxv, bins[i]);
  const lim = mxv * 0.06;
  const runs = [];
  let run = 0;
  for (let i = 0; i < bins.length; i++) {
    if (bins[i] > lim) run++;
    else if (run) { if (run >= 2) runs.push(run); run = 0; }
  }
  runs.sort((a, b) => a - b);
  const med = runs.length ? runs[Math.floor(runs.length / 2)] : 0;
  return { angle, lineHeight: med / s.f };
}

/** Resample (rotate by the text angle + scale) with bilinear interpolation, white fill. */
export function resample(g, w, h, angleDeg, scale, outW, outH) {
  const t = (angleDeg * Math.PI) / 180, c = Math.cos(t), sn = Math.sin(t);
  const out = new Uint8Array(outW * outH);
  const cx = w / 2, cy = h / 2, ox = outW / 2, oy = outH / 2;
  for (let v = 0; v < outH; v++) {
    const dy = (v + 0.5 - oy) / scale;
    for (let u = 0; u < outW; u++) {
      const dx = (u + 0.5 - ox) / scale;
      const x = cx + dx * c - dy * sn - 0.5, y = cy + dx * sn + dy * c - 0.5;
      if (x < -0.5 || y < -0.5 || x > w - 0.5 || y > h - 0.5) { out[v * outW + u] = 255; continue; }
      const x0 = Math.max(0, Math.min(w - 2, Math.floor(x))), y0 = Math.max(0, Math.min(h - 2, Math.floor(y)));
      const fx = Math.max(0, Math.min(1, x - x0)), fy = Math.max(0, Math.min(1, y - y0)), i = y0 * w + x0;
      const a = g[i] + (g[i + 1] - g[i]) * fx, b = g[i + w] + (g[i + w + 1] - g[i + w]) * fx;
      out[v * outW + u] = a + (b - a) * fy;
    }
  }
  return out;
}

/**
 * Full pipeline. image: {data (RGBA), width, height}.
 * opts: {enhance=true, deskew=true, upscale=true, maxPixels=12e6}
 * → {gray, width, height, angle, scale, srcWidth, srcHeight}
 * Output pixel (u,v) maps to source (x,y) via mapToSource().
 */
export function preprocess(image, { enhance = true, deskew = true, upscale = true, maxPixels = 12e6 } = {}) {
  const w = image.width, h = image.height;
  let g = toGray(image.data, w, h);
  // light text on dark background → invert
  const hist = histogram(g);
  if (percentile(hist, g.length, 0.5) < 90) for (let i = 0; i < g.length; i++) g[i] = 255 - g[i];
  // layout analysis on the raw gray image (normalisation turns the page edges into dark bands)
  const lay = deskew || upscale ? analyseLayout(g, w, h) : { angle: 0, lineHeight: 0 };
  if (enhance) { g = normalizeBackground(g, w, h); stretchContrast(g); }
  const angle = deskew ? lay.angle : 0;
  let scale = 1;
  if (upscale && lay.lineHeight > 0 && lay.lineHeight < 24) scale = Math.min(3, 32 / lay.lineHeight);
  const capScale = Math.sqrt(maxPixels / (w * h));
  scale = Math.min(scale, capScale);
  if (scale > 0.97 && scale < 1.12) scale = 1;
  if (!angle && scale === 1) return { gray: g, width: w, height: h, angle: 0, scale: 1, srcWidth: w, srcHeight: h, lineHeight: lay.lineHeight };
  const outW = Math.max(1, Math.round(w * scale)), outH = Math.max(1, Math.round(h * scale));
  const out = resample(g, w, h, angle, scale, outW, outH);
  return { gray: out, width: outW, height: outH, angle, scale, srcWidth: w, srcHeight: h, lineHeight: lay.lineHeight };
}

/** Map a point of the pre-processed image back to the source image. */
export function mapToSource(geo, u, v) {
  if (!geo || (!geo.angle && geo.scale === 1)) return [u, v];
  const t = (geo.angle * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const dx = (u - geo.width / 2) / geo.scale, dy = (v - geo.height / 2) / geo.scale;
  return [geo.srcWidth / 2 + dx * c - dy * s, geo.srcHeight / 2 + dx * s + dy * c];
}

/** Binary PGM (P5) container for gray pixels – read natively by Leptonica, no PNG encoding. */
export function toPgm(gray, w, h) {
  const head = new TextEncoder().encode(`P5\n${w} ${h}\n255\n`);
  const out = new Uint8Array(head.length + gray.length);
  out.set(head, 0);
  out.set(gray, head.length);
  return out;
}
