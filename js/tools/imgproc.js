// Image processing for photos and scans (pure functions on ImageData-like objects
// {data: Uint8ClampedArray (RGBA), width, height}). Runs in a module worker (imgworker.js) when
// available, otherwise on the main thread in chunks. Separable box blurs (running sums) keep
// every filter O(pixels) regardless of the radius.

const clamp = v => (v < 0 ? 0 : v > 255 ? 255 : v);
const yieldNow = () => new Promise(r => setTimeout(r, 0));

function newImage(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; }
function copyImage(img) { return { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height }; }

/** Split RGBA into three Float32 planes. */
function planes(img) {
  const n = img.width * img.height, d = img.data;
  const r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0, j = 0; j < n; i += 4, j++) { r[j] = d[i]; g[j] = d[i + 1]; b[j] = d[i + 2]; }
  return [r, g, b];
}
function fromPlanes(img, [r, g, b]) {
  const out = newImage(img.width, img.height), d = out.data, s = img.data, n = img.width * img.height;
  for (let i = 0, j = 0; j < n; i += 4, j++) { d[i] = r[j]; d[i + 1] = g[j]; d[i + 2] = b[j]; d[i + 3] = s[i + 3]; }
  return out;
}
function luma(img) {
  const n = img.width * img.height, d = img.data, y = new Float32Array(n);
  for (let i = 0, j = 0; j < n; i += 4, j++) y[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return y;
}

/** Box blur (radius r) of one plane, separable, edge-clamped. */
export function boxBlur(src, w, h, r) {
  r = Math.max(0, Math.round(r));
  if (!r) return Float32Array.from(src);
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  const win = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = src[row] * (r + 1);
    for (let x = 1; x <= r; x++) acc += src[row + Math.min(w - 1, x)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / win;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = tmp[x] * (r + 1);
    for (let y = 1; y <= r; y++) acc += tmp[Math.min(h - 1, y) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / win;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/** Gaussian approximation by three box blurs. */
export function gaussBlur(src, w, h, sigma) {
  if (sigma < 0.3) return Float32Array.from(src);
  // box sizes for 3 passes (Kovesi)
  const n = 3;
  const wIdeal = Math.sqrt((12 * sigma * sigma / n) + 1);
  let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  let out = src;
  for (let i = 0; i < n; i++) out = boxBlur(out, w, h, ((i < m ? wl : wu) - 1) / 2);
  return out;
}

/** Max filter (dilation) — separable square window, van Herk style via simple passes on small images. */
function maxFilter(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let m = 0;
      const a = Math.max(0, x - r), b = Math.min(w - 1, x + r);
      for (let k = a; k <= b; k++) if (src[row + k] > m) m = src[row + k];
      tmp[row + x] = m;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = 0;
      const a = Math.max(0, y - r), b = Math.min(h - 1, y + r);
      for (let k = a; k <= b; k++) if (tmp[k * w + x] > m) m = tmp[k * w + x];
      out[y * w + x] = m;
    }
  }
  return out;
}
function minFilter(src, w, h, r) {
  const inv = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) inv[i] = 255 - src[i];
  const m = maxFilter(inv, w, h, r);
  for (let i = 0; i < m.length; i++) m[i] = 255 - m[i];
  return m;
}

/** Downscale a plane by integer factor f (area average). */
function downPlane(src, w, h, f) {
  const sw = Math.max(1, Math.floor(w / f)), sh = Math.max(1, Math.floor(h / f));
  const out = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    let s = 0, c = 0;
    for (let yy = y * f; yy < Math.min(h, (y + 1) * f); yy++) for (let xx = x * f; xx < Math.min(w, (x + 1) * f); xx++) { s += src[yy * w + xx]; c++; }
    out[y * sw + x] = s / (c || 1);
  }
  return { p: out, w: sw, h: sh };
}
/** Bilinear upscale of a small plane to w×h. */
function upPlane(small, sw, sh, w, h) {
  const out = new Float32Array(w * h);
  const fx = sw / w, fy = sh / h;
  for (let y = 0; y < h; y++) {
    const sy = Math.max(0, Math.min(sh - 1.001, (y + 0.5) * fy - 0.5));
    const y0 = Math.floor(sy), ty = sy - y0, y1 = Math.min(sh - 1, y0 + 1);
    for (let x = 0; x < w; x++) {
      const sx = Math.max(0, Math.min(sw - 1.001, (x + 0.5) * fx - 0.5));
      const x0 = Math.floor(sx), tx = sx - x0, x1 = Math.min(sw - 1, x0 + 1);
      const a = small[y0 * sw + x0], b = small[y0 * sw + x1], c = small[y1 * sw + x0], d = small[y1 * sw + x1];
      out[y * w + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------ ops
/** Unsharp mask. amount 0..3, radius px (sigma), threshold 0..30 */
export async function sharpen(img, { amount = 1, radius = 1.4, threshold = 2, scale = 1 } = {}, progress = () => {}) {
  const { width: w, height: h } = img;
  radius = radius * Math.max(0.5, Math.min(4, scale));
  const P = planes(img);
  const out = [];
  for (let c = 0; c < 3; c++) {
    const b = gaussBlur(P[c], w, h, radius);
    const o = new Float32Array(w * h);
    for (let i = 0; i < o.length; i++) {
      const diff = P[c][i] - b[i];
      o[i] = Math.abs(diff) < threshold ? P[c][i] : clamp(P[c][i] + amount * diff);
    }
    out.push(o);
    progress((c + 1) / 3);
    await yieldNow();
  }
  return fromPlanes(img, out);
}

/**
 * Remove shadows / uneven lighting from document photos: estimate the paper background with a
 * morphological closing (max then min filter) on a downscaled copy, blur it, then divide.
 */
export async function removeShadows(img, { strength = 1, normalize = true } = {}, progress = () => {}) {
  const { width: w, height: h } = img;
  const P = planes(img);
  const f = Math.max(1, Math.round(Math.max(w, h) / 300));
  const out = [];
  for (let c = 0; c < 3; c++) {
    const small = downPlane(P[c], w, h, f);
    const r = Math.max(2, Math.round(Math.max(small.w, small.h) / 70));
    let bg = maxFilter(small.p, small.w, small.h, r);
    bg = minFilter(bg, small.w, small.h, r);
    bg = gaussBlur(bg, small.w, small.h, r * 1.2);
    const full = upPlane(bg, small.w, small.h, w, h);
    const o = new Float32Array(w * h);
    for (let i = 0; i < o.length; i++) {
      const b = Math.max(30, full[i]);
      const v = (P[c][i] / b) * 255;
      o[i] = clamp(P[c][i] + (v - P[c][i]) * strength);
    }
    out.push(o);
    progress((c + 1) / (normalize ? 4 : 3));
    await yieldNow();
  }
  let res = fromPlanes(img, out);
  if (normalize) res = levels(res, { low: 0.02, high: 0.0, gamma: 1.1, keepWhite: true });
  progress(1);
  return res;
}

/** Percentile-based levels on luminance (keeps hue). */
export function levels(img, { low = 0.005, high = 0.005, gamma = 1, keepWhite = false } = {}) {
  const y = luma(img);
  const hist = new Uint32Array(256);
  for (let i = 0; i < y.length; i++) hist[y[i] | 0]++;
  const n = y.length;
  let lo = 0, hi = 255, acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > n * low) { lo = i; break; } }
  acc = 0;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > n * high) { hi = i; break; } }
  if (keepWhite) hi = Math.min(hi, 250);
  if (hi - lo < 20) { lo = Math.max(0, lo - 10); hi = Math.min(255, hi + 10); }
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) lut[i] = 255 * Math.pow(Math.min(1, Math.max(0, (i - lo) / (hi - lo))), gamma);
  const out = newImage(img.width, img.height), d = out.data, s = img.data;
  for (let i = 0; i < s.length; i += 4) { d[i] = lut[s[i]]; d[i + 1] = lut[s[i + 1]]; d[i + 2] = lut[s[i + 2]]; d[i + 3] = s[i + 3]; }
  return out;
}

/** Adaptive (Wiener/Lee) denoise: smooths flat areas, keeps edges. strength 0..1 */
export async function denoise(img, { strength = 0.6, radius = 2 } = {}, progress = () => {}) {
  const { width: w, height: h } = img;
  const P = planes(img);
  const out = [];
  for (let c = 0; c < 3; c++) {
    const x = P[c];
    const mean = boxBlur(x, w, h, radius);
    const sq = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) sq[i] = x[i] * x[i];
    const meanSq = boxBlur(sq, w, h, radius);
    // noise variance = median-ish of local variances (use average of the lower half)
    const vars = new Float32Array(x.length);
    let sum = 0;
    for (let i = 0; i < x.length; i++) { vars[i] = Math.max(0, meanSq[i] - mean[i] * mean[i]); sum += vars[i]; }
    const sample = [];
    for (let i = 0; i < vars.length; i += Math.max(1, Math.floor(vars.length / 4000))) sample.push(vars[i]);
    sample.sort((a, b) => a - b);
    const noise = (sample[Math.floor(sample.length * 0.5)] || sum / x.length) * (0.6 + strength * 1.6);
    const o = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) {
      const v = vars[i];
      const k = v > 0 ? Math.max(0, v - noise) / v : 0;
      o[i] = mean[i] + k * (x[i] - mean[i]);
    }
    out.push(o);
    progress((c + 1) / 3);
    await yieldNow();
  }
  return fromPlanes(img, out);
}

/** One-tap "Bildqualität verbessern": denoise + auto levels + gentle saturation + sharpen. */
export async function enhance(img, { strength = 1 } = {}, progress = () => {}) {
  let r = await denoise(img, { strength: 0.45 * strength, radius: 2 }, p => progress(p * 0.4));
  r = levels(r, { low: 0.004, high: 0.004, gamma: 0.95 });
  r = saturate(r, 1 + 0.12 * strength);
  progress(0.6);
  r = await sharpen(r, { amount: 0.7 * strength, radius: 1.2, threshold: 3 }, p => progress(0.6 + p * 0.4));
  return r;
}

/**
 * Reduce moiré / screen patterns: strong chroma smoothing, frequency-aware luminance blur
 * (sigma from strength), then re-sharpen at a larger radius to recover edges.
 */
export async function reduceMoire(img, { strength = 1 } = {}, progress = () => {}) {
  const { width: w, height: h } = img;
  const n = w * h, s = img.data;
  const Y = new Float32Array(n), Cb = new Float32Array(n), Cr = new Float32Array(n);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    const r = s[i], g = s[i + 1], b = s[i + 2];
    Y[j] = 0.299 * r + 0.587 * g + 0.114 * b;
    Cb[j] = -0.168736 * r - 0.331264 * g + 0.5 * b;
    Cr[j] = 0.5 * r - 0.418688 * g - 0.081312 * b;
  }
  const scale = Math.max(1, Math.max(w, h) / 1500);
  const sigY = (1.1 + 1.1 * strength) * scale;
  const Yb = gaussBlur(Y, w, h, sigY);
  progress(0.35); await yieldNow();
  const Cbb = gaussBlur(Cb, w, h, sigY * 2.4);
  const Crb = gaussBlur(Cr, w, h, sigY * 2.4);
  progress(0.65); await yieldNow();
  // re-sharpen luminance with a wider kernel than the pattern
  const Yw = gaussBlur(Yb, w, h, sigY * 2.2);
  const amt = 0.55 + 0.25 * strength;
  const out = newImage(w, h), d = out.data;
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    const y = Yb[j] + amt * (Yb[j] - Yw[j]);
    const cb = Cbb[j], cr = Crb[j];
    d[i] = clamp(y + 1.402 * cr);
    d[i + 1] = clamp(y - 0.344136 * cb - 0.714136 * cr);
    d[i + 2] = clamp(y + 1.772 * cb);
    d[i + 3] = s[i + 3];
  }
  progress(1);
  return out;
}

export function saturate(img, f) {
  const out = newImage(img.width, img.height), d = out.data, s = img.data;
  for (let i = 0; i < s.length; i += 4) {
    const y = 0.299 * s[i] + 0.587 * s[i + 1] + 0.114 * s[i + 2];
    d[i] = clamp(y + (s[i] - y) * f); d[i + 1] = clamp(y + (s[i + 1] - y) * f); d[i + 2] = clamp(y + (s[i + 2] - y) * f); d[i + 3] = s[i + 3];
  }
  return out;
}

/** Brightness (-100..100), contrast (-100..100), saturation (-100..100), warmth (-100..100). */
export function adjust(img, { brightness = 0, contrast = 0, saturation = 0, warmth = 0 } = {}) {
  const c = Math.tan(((contrast + 100) / 200) * Math.PI / 2);
  const b = brightness * 1.28;
  const sat = 1 + saturation / 100;
  const wr = warmth * 0.25, wb = -warmth * 0.25;
  const out = newImage(img.width, img.height), d = out.data, s = img.data;
  for (let i = 0; i < s.length; i += 4) {
    let r = (s[i] - 128) * c + 128 + b + wr, g = (s[i + 1] - 128) * c + 128 + b, bl = (s[i + 2] - 128) * c + 128 + b + wb;
    if (sat !== 1) { const y = 0.299 * r + 0.587 * g + 0.114 * bl; r = y + (r - y) * sat; g = y + (g - y) * sat; bl = y + (bl - y) * sat; }
    d[i] = clamp(r); d[i + 1] = clamp(g); d[i + 2] = clamp(bl); d[i + 3] = s[i + 3];
  }
  return out;
}

export const LOOKS = [
  { id: 'original', label: 'Original' },
  { id: 'lebendig', label: 'Lebendig' },
  { id: 'sw', label: 'Schwarzweiß' },
  { id: 'sepia', label: 'Sepia' },
  { id: 'warm', label: 'Warm' },
  { id: 'kuehl', label: 'Kühl' },
  { id: 'vintage', label: 'Vintage' },
  { id: 'kontrast', label: 'Kontrast' },
  { id: 'dokument', label: 'Dokument' },
];

/** Filter "looks" for photos and scans. */
export async function look(img, { id = 'original' } = {}, progress = () => {}) {
  const { width: w, height: h } = img;
  switch (id) {
    case 'lebendig': return adjust(saturate(img, 1.35), { contrast: 12, brightness: 3 });
    case 'kontrast': return adjust(levels(img, { low: 0.01, high: 0.01 }), { contrast: 28 });
    case 'warm': return adjust(img, { warmth: 45, saturation: 8 });
    case 'kuehl': return adjust(img, { warmth: -45, saturation: -5 });
    case 'sw': {
      const g = levels(saturate(img, 0), { low: 0.01, high: 0.01 });
      return adjust(g, { contrast: 12 });
    }
    case 'sepia': {
      const out = newImage(w, h), d = out.data, s = img.data;
      for (let i = 0; i < s.length; i += 4) {
        const r = s[i], g = s[i + 1], b = s[i + 2];
        d[i] = clamp(0.393 * r + 0.769 * g + 0.189 * b); d[i + 1] = clamp(0.349 * r + 0.686 * g + 0.168 * b); d[i + 2] = clamp(0.272 * r + 0.534 * g + 0.131 * b); d[i + 3] = s[i + 3];
      }
      return out;
    }
    case 'vintage': {
      const base = adjust(saturate(img, 0.7), { warmth: 30, contrast: -12, brightness: 6 });
      const d = base.data, cx = w / 2, cy = h / 2, maxD = Math.hypot(cx, cy);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = 1 - 0.35 * Math.pow(Math.hypot(x - cx, y - cy) / maxD, 2.2);
        d[i] = clamp(d[i] * v + 14); d[i + 1] = clamp(d[i + 1] * v + 8); d[i + 2] = clamp(d[i + 2] * v);
      }
      return base;
    }
    case 'dokument': {
      const r = await removeShadows(img, { strength: 1 }, progress);
      return adjust(levels(saturate(r, 0.85), { low: 0.02, high: 0, keepWhite: true }), { contrast: 10 });
    }
    default: return copyImage(img);
  }
}

// ------------------------------------------------------------------- masks (passport photo)
/**
 * Flood fill from seed points: pixels connected to a seed whose colour differs less than
 * `tolerance` (0..100) from the seed colour. Returns a Uint8Array mask (1 = selected).
 */
export function floodMask(img, seeds, { tolerance = 22, base = null } = {}) {
  const { width: w, height: h, data: d } = img;
  const mask = base ? Uint8Array.from(base) : new Uint8Array(w * h);
  const tol = (tolerance / 100) * 160;
  const tol2 = tol * tol;
  for (const [sx0, sy0] of seeds) {
    const sx = Math.max(0, Math.min(w - 1, Math.round(sx0))), sy = Math.max(0, Math.min(h - 1, Math.round(sy0)));
    // seed colour = 5×5 average
    let r = 0, g = 0, b = 0, c = 0;
    for (let y = Math.max(0, sy - 2); y <= Math.min(h - 1, sy + 2); y++) for (let x = Math.max(0, sx - 2); x <= Math.min(w - 1, sx + 2); x++) {
      const i = (y * w + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; c++;
    }
    r /= c; g /= c; b /= c;
    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    let top = 0;
    stack[top++] = sy * w + sx;
    seen[sy * w + sx] = 1;
    while (top) {
      const p = stack[--top];
      const i = p * 4;
      const dr = d[i] - r, dg = d[i + 1] - g, db = d[i + 2] - b;
      // weighted distance (human-ish): luminance differences matter a bit less than hue
      if (dr * dr * 0.9 + dg * dg * 1.2 + db * db * 0.9 > tol2) continue;
      mask[p] = 1;
      const x = p % w, y = (p - x) / w;
      if (x > 0 && !seen[p - 1]) { seen[p - 1] = 1; stack[top++] = p - 1; }
      if (x < w - 1 && !seen[p + 1]) { seen[p + 1] = 1; stack[top++] = p + 1; }
      if (y > 0 && !seen[p - w]) { seen[p - w] = 1; stack[top++] = p - w; }
      if (y < h - 1 && !seen[p + w]) { seen[p + w] = 1; stack[top++] = p + w; }
    }
  }
  return mask;
}

/** Replace masked pixels with a colour, with a soft (feathered) edge. */
export function replaceMasked(img, mask, { color = [232, 232, 232], feather = 2.5 } = {}) {
  const { width: w, height: h } = img;
  const m = new Float32Array(w * h);
  for (let i = 0; i < m.length; i++) m[i] = mask[i] ? 255 : 0;
  // close tiny holes then feather
  const soft = gaussBlur(m, w, h, feather);
  const out = copyImage(img), d = out.data;
  for (let j = 0, i = 0; j < m.length; j++, i += 4) {
    const a = Math.min(1, (mask[j] ? Math.max(soft[j], 160) : soft[j]) / 255);
    if (a <= 0.001) continue;
    d[i] = d[i] * (1 - a) + color[0] * a; d[i + 1] = d[i + 1] * (1 - a) + color[1] * a; d[i + 2] = d[i + 2] * (1 - a) + color[2] * a;
  }
  return out;
}

/** Simple statistics for tests and UI hints. */
export function stats(img) {
  const y = luma(img);
  let s = 0, s2 = 0;
  for (let i = 0; i < y.length; i++) { s += y[i]; s2 += y[i] * y[i]; }
  const mean = s / y.length;
  // high-frequency energy (Laplacian)
  const { width: w, height: h } = img;
  let lap = 0;
  for (let yy = 1; yy < h - 1; yy++) for (let x = 1; x < w - 1; x++) {
    const i = yy * w + x;
    lap += Math.abs(4 * y[i] - y[i - 1] - y[i + 1] - y[i - w] - y[i + w]);
  }
  return { mean, std: Math.sqrt(Math.max(0, s2 / y.length - mean * mean)), sharpness: lap / Math.max(1, (w - 2) * (h - 2)) };
}

export const OPS = { sharpen, removeShadows, denoise, enhance, reduceMoire, look, adjust: async (img, p) => adjust(img, p), levels: async (img, p) => levels(img, p) };

// ------------------------------------------------------------------- client (main thread)
let worker = null, workerFailed = false, seq = 0;
const pending = new Map();
function getWorker() {
  if (workerFailed || typeof Worker === 'undefined' || typeof window === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./imgworker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => {
      const { id, type, progress, result, error } = e.data || {};
      const p = pending.get(id);
      if (!p) return;
      if (type === 'progress') { p.onProgress && p.onProgress(progress); return; }
      pending.delete(id);
      if (type === 'error') p.reject(new Error(error)); else p.resolve(result);
    };
    worker.onerror = e => {
      e.preventDefault && e.preventDefault();
      workerFailed = true;
      try { worker.terminate(); } catch {}
      worker = null;
      const all = [...pending.values()];
      pending.clear();
      all.forEach(p => p.retry());
    };
    return worker;
  } catch { workerFailed = true; return null; }
}

/**
 * Run an operation (name from OPS) on ImageData; resolves with a new ImageData.
 * Heavy work happens in a worker when possible so the UI stays responsive.
 */
export function runOp(op, imageData, params = {}, onProgress = null) {
  const inline = async () => {
    const r = await OPS[op]({ data: imageData.data, width: imageData.width, height: imageData.height }, params, onProgress || (() => {}));
    return new ImageData(r.data, r.width, r.height);
  };
  const wk = getWorker();
  if (!wk) return inline();
  return new Promise((resolve, reject) => {
    const id = ++seq;
    // copy the pixels: the transferred buffer becomes unusable on this side
    const buf = new Uint8ClampedArray(imageData.data);
    pending.set(id, {
      onProgress,
      resolve: r => resolve(new ImageData(new Uint8ClampedArray(r.data), r.width, r.height)),
      reject,
      retry: () => inline().then(resolve, reject),
    });
    wk.postMessage({ id, op, params, image: { data: buf, width: imageData.width, height: imageData.height } }, [buf.buffer]);
  });
}
