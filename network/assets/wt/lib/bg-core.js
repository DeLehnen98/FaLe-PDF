// Pure image maths of the background remover (tool remove-background): model input tensors, mask
// normalisation, area/bilinear resizing, box blur, guided filter (edge-aware mask upsampling), edge
// refinement, brush edits and the subject bounding box. No DOM, no imports – used by lib/bg-worker.js
// (inference) and by tools/remove-background.js (editing + compositing), and unit-tested under node.

/** The two vendored segmentation models (vendor/onnx/models, see vendor/MANIFEST.json for the licences). */
export const MODELS = {
  // U²-Netp (Apache-2.0): general salient objects – products, animals, things, people in full figure
  object: { file: 'u2netp.onnx', kind: 'u2net', bytes: 4574861, gz: 4237634 },
  // MODNet, 8-bit quantised (Apache-2.0): portrait matting – people, finer hair
  person: { file: 'modnet-quantized.onnx', kind: 'modnet', bytes: 6632188, gz: 5226986 },
};
/** onnxruntime-web WASM build (module + glue + binary), downloaded once for either model. */
export const RUNTIME_BYTES = 48217 + 20856 + 11210254;
/** …about this much when the server compresses (gzip -9 of the files). */
export const RUNTIME_GZ = 2868737 + 20000;

/** Model input size [w, h] for an image of W × H. */
export function inferSize(W, H, kind) {
  if (kind === 'u2net') return [320, 320];
  // MODNet: short side 512, long side ≤ 1024, both multiples of 32
  const s = 512 / Math.min(W, H);
  let w = W * s, h = H * s;
  const k = Math.min(1, 1024 / Math.max(w, h));
  w = Math.max(32, Math.round((w * k) / 32) * 32);
  h = Math.max(32, Math.round((h * k) / 32) * 32);
  return [w, h];
}

/** Area-average resize of RGBA bytes (downscaling; falls back to nearest sampling when enlarging). */
export function resizeRGBA(src, sw, sh, dw, dh) {
  const out = new Uint8ClampedArray(dw * dh * 4);
  const fx = sw / dw, fy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(y * fy), y1 = Math.max(y0 + 1, Math.min(sh, Math.ceil((y + 1) * fy)));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * fx), x1 = Math.max(x0 + 1, Math.min(sw, Math.ceil((x + 1) * fx)));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * sw + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) { r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3]; n++; }
      }
      const o = (y * dw + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
    }
  }
  return out;
}

/** NCHW float tensor data for the model from RGBA bytes of exactly w × h. */
export function toTensor(rgba, w, h, kind) {
  const n = w * h, t = new Float32Array(3 * n);
  if (kind === 'u2net') {
    // as in the reference implementation: divide by the image maximum, then ImageNet mean/std
    let max = 1;
    for (let i = 0; i < n * 4; i++) if ((i & 3) !== 3 && rgba[i] > max) max = rgba[i];
    const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
    for (let c = 0; c < 3; c++) for (let i = 0; i < n; i++) t[c * n + i] = (rgba[i * 4 + c] / max - mean[c]) / std[c];
  } else {
    for (let c = 0; c < 3; c++) for (let i = 0; i < n; i++) t[c * n + i] = rgba[i * 4 + c] / 127.5 - 1;
  }
  return t;
}

/** Model output → mask 0…1 (U²-Net: min-max normalised like the reference; MODNet: clamped matte). */
export function normalizeMask(data, kind) {
  const out = new Float32Array(data.length);
  if (kind === 'u2net') {
    let mi = Infinity, ma = -Infinity;
    for (const v of data) { if (v < mi) mi = v; if (v > ma) ma = v; }
    const d = ma - mi > 1e-6 ? ma - mi : 1;
    for (let i = 0; i < data.length; i++) out[i] = (data[i] - mi) / d;
  } else {
    for (let i = 0; i < data.length; i++) out[i] = data[i] < 0 ? 0 : data[i] > 1 ? 1 : data[i];
  }
  return out;
}

/** Bilinear resize of a float map (pixel-centre aligned). */
export function resizeFloat(src, sw, sh, dw, dh) {
  const out = new Float32Array(dw * dh);
  const fx = sw / dw, fy = sh / dh;
  for (let y = 0; y < dh; y++) {
    let sy = (y + 0.5) * fy - 0.5; if (sy < 0) sy = 0;
    const y0 = Math.min(sh - 1, Math.floor(sy)), y1 = Math.min(sh - 1, y0 + 1), wy = sy - y0;
    for (let x = 0; x < dw; x++) {
      let sx = (x + 0.5) * fx - 0.5; if (sx < 0) sx = 0;
      const x0 = Math.min(sw - 1, Math.floor(sx)), x1 = Math.min(sw - 1, x0 + 1), wx = sx - x0;
      const a = src[y0 * sw + x0], b = src[y0 * sw + x1], c = src[y1 * sw + x0], d = src[y1 * sw + x1];
      out[y * dw + x] = (a * (1 - wx) + b * wx) * (1 - wy) + (c * (1 - wx) + d * wx) * wy;
    }
  }
  return out;
}

/** Mean filter with radius r (window 2r+1, edges normalised by the real pixel count). O(n) per pass. */
export function boxBlur(src, w, h, r, out = new Float32Array(w * h), tmp = new Float32Array(w * h)) {
  r = Math.max(0, Math.round(r));
  if (!r) { out.set(src); return out; }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0;
    for (let x = 0; x <= Math.min(r, w - 1); x++) s += src[row + x];
    for (let x = 0; x < w; x++) {
      const lo = Math.max(0, x - r), hi = Math.min(w - 1, x + r);
      tmp[row + x] = s / (hi - lo + 1);
      if (x + r + 1 < w) s += src[row + x + r + 1];
      if (x - r >= 0) s -= src[row + x - r];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = 0; y <= Math.min(r, h - 1); y++) s += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      const lo = Math.max(0, y - r), hi = Math.min(h - 1, y + r);
      out[y * w + x] = s / (hi - lo + 1);
      if (y + r + 1 < h) s += tmp[(y + r + 1) * w + x];
      if (y - r >= 0) s -= tmp[(y - r) * w + x];
    }
  }
  return out;
}

/** Luma 0…1 of RGBA bytes. */
export function grayOf(rgba, n) {
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) / 255;
  return g;
}

/**
 * Guided filter (He et al.) with a grey guide: transfers the edges of the photo onto a coarse mask.
 * I = guide 0…1, p = mask 0…1 (same size). Returns a new Float32Array.
 */
export function guidedFilter(I, p, w, h, r, eps) {
  const n = w * h, tmp = new Float32Array(n);
  const mI = boxBlur(I, w, h, r, undefined, tmp), mP = boxBlur(p, w, h, r, undefined, tmp);
  const II = new Float32Array(n), IP = new Float32Array(n);
  for (let i = 0; i < n; i++) { II[i] = I[i] * I[i]; IP[i] = I[i] * p[i]; }
  const cII = boxBlur(II, w, h, r, II, tmp), cIP = boxBlur(IP, w, h, r, IP, tmp);
  const a = cII, b = cIP; // reuse buffers
  for (let i = 0; i < n; i++) {
    const varI = cII[i] - mI[i] * mI[i], cov = cIP[i] - mI[i] * mP[i];
    const ai = cov / (varI + eps);
    a[i] = ai; b[i] = mP[i] - ai * mI[i];
  }
  const ma = boxBlur(a, w, h, r, mI, tmp), mb = boxBlur(b, w, h, r, mP, tmp);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) { const v = ma[i] * I[i] + mb[i]; q[i] = v < 0 ? 0 : v > 1 ? 1 : v; }
  return q;
}

/**
 * Coarse model mask (mw × mh) → edge-aware mask at the working size (w × h) of the photo `rgba`.
 * The coarse mask is upsampled bilinearly, then snapped to the photo's edges with a guided filter and
 * blended with the plain upsampled mask where the guide has no contrast (flat areas keep the model's answer).
 */
export function upsampleMask(mask, mw, mh, rgba, w, h) {
  const p = resizeFloat(mask, mw, mh, w, h);
  const I = grayOf(rgba, w * h);
  const scale = Math.max(w / mw, h / mh);
  const r = Math.max(2, Math.round(scale * 1.5));
  const q = guidedFilter(I, p, w, h, r, 1e-3);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(q[i] * 255);
  return out;
}

/**
 * Edge refinement of a 0…255 mask: `shift` −50…50 moves the edge outwards (+) or inwards (−),
 * `hard` 0…1 makes the transition steeper. Returns Float32Array 0…1.
 */
export function refineMask(m, shift = 0, hard = 0.5) {
  const c = 0.5 - shift / 125;                 // threshold centre 0.1 … 0.9
  const hw = 0.5 - 0.46 * hard;                 // half width of the transition
  const lo = c - hw, d = 2 * hw;
  const out = new Float32Array(m.length);
  for (let i = 0; i < m.length; i++) {
    let t = (m[i] / 255 - lo) / d;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    out[i] = t * t * (3 - 2 * t);
  }
  return out;
}

/** Apply brush edits: RGBA of an edit layer (white = keep, black = remove, alpha = coverage). In place. */
export function applyEdits(alpha, edit) {
  if (!edit) return alpha;
  for (let i = 0, j = 3; i < alpha.length; i++, j += 4) {
    const a = edit[j];
    if (a) { const k = a / 255; alpha[i] = alpha[i] * (1 - k) + (edit[j - 3] / 255) * k; }
  }
  return alpha;
}

/** Soften the edge: two box-blur passes ≈ Gaussian with sigma ≈ radius / 1.4. In place (returns alpha). */
export function feather(alpha, w, h, radius) {
  if (radius < 0.5) return alpha;
  const r = Math.max(1, Math.round(radius / 1.4));
  const tmp = new Float32Array(w * h), b = new Float32Array(w * h);
  boxBlur(alpha, w, h, r, b, tmp);
  boxBlur(b, w, h, r, alpha, tmp);
  return alpha;
}

/** Bounding box {x, y, w, h} of alpha > thr, or null when nothing is left. */
export function subjectBox(alpha, w, h, thr = 0.04) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) if (alpha[row + x] > thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Write alpha 0…1 into RGBA bytes (black, alpha channel) for drawing with destination-in. */
export function alphaToRGBA(alpha, out = new Uint8ClampedArray(alpha.length * 4)) {
  for (let i = 0, j = 3; i < alpha.length; i++, j += 4) out[j] = alpha[i] * 255;
  return out;
}

/** Intersection over union of two masks (values ≥ 0.5 count as foreground). */
export function maskIoU(a, b, thr = 0.5) {
  let inter = 0, uni = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] >= thr, y = b[i] >= thr;
    if (x && y) inter++;
    if (x || y) uni++;
  }
  return uni ? inter / uni : 1;
}
