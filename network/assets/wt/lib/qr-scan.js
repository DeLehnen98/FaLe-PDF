// QR code reader for photos, screenshots and camera frames – written from the specification (ISO/IEC 18004):
//   1. luminance → black/white with a block-wise local threshold (works with shadows and uneven light),
//   2. finder patterns (1:1:3:1:1 runs, cross-checked vertically and horizontally),
//   3. the three finders that form a QR corner, size estimate, alignment pattern search, perspective transform,
//   4. sampling the module grid, format + version information (with error tolerance),
//   5. un-masking, de-interleaving, Reed–Solomon error correction, all data modes (numeric, alphanumeric,
//      byte with UTF-8 / ISO-8859-1, Kanji, ECI).
// Light-on-dark codes and mirrored codes are tried, too. Pure functions, no DOM – runs in a worker or the page.
import { ECC_PER_BLOCK, NUM_BLOCKS, rawDataModules, alignmentPositions, formatCode } from './img-qrdecode.js';

// ---------------------------------------------------------------- GF(256) + Reed–Solomon (primitive 0x11d)
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
{ let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; }
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
const div = (a, b) => (a ? EXP[(LOG[a] + 255 - LOG[b]) % 255] : 0);

/**
 * Correct a codeword block in place (data + EC bytes, first byte = highest power). Returns the number of
 * corrected bytes, or -1 when there are too many errors.
 */
export function rsCorrect(block, nsym) {
  const n = block.length;
  const r = j => block[n - 1 - j];   // coefficient of x^j
  const S = new Array(nsym);
  let bad = false;
  for (let k = 0; k < nsym; k++) {
    let s = 0;
    const a = EXP[k];   // α^k
    for (let j = n - 1; j >= 0; j--) s = mul(s, a) ^ r(j);   // Horner, highest power first
    S[k] = s;
    if (s) bad = true;
  }
  if (!bad) return 0;
  // Berlekamp–Massey (arrays low degree first)
  let C = [1], B = [1], L = 0, m = 1, b = 1;
  for (let i = 0; i < nsym; i++) {
    let d = S[i];
    for (let k = 1; k <= L; k++) d ^= mul(C[k] || 0, S[i - k]);
    if (d === 0) { m++; continue; }
    const coef = div(d, b);
    const T = C.slice();
    const len = Math.max(C.length, B.length + m);
    while (C.length < len) C.push(0);
    for (let k = 0; k < B.length; k++) C[k + m] ^= mul(coef, B[k]);
    if (2 * L <= i) { L = i + 1 - L; B = T; b = d; m = 1; } else m++;
  }
  while (C.length > 1 && C[C.length - 1] === 0) C.pop();
  if (L * 2 > nsym || C.length - 1 !== L) return -1;
  // Chien search: Λ(α^-j) = 0 → error at power j
  const evalAt = (poly, x) => { let y = 0; for (let k = poly.length - 1; k >= 0; k--) y = mul(y, x) ^ poly[k]; return y; };
  const pos = [];
  for (let j = 0; j < n; j++) if (evalAt(C, EXP[(255 - j) % 255]) === 0) pos.push(j);
  if (pos.length !== L) return -1;
  // Ω(x) = S(x)Λ(x) mod x^nsym ; Forney (first consecutive root α^0): e = X·Ω(X⁻¹) / Λ'(X⁻¹)
  const Om = new Array(nsym).fill(0);
  for (let i = 0; i < nsym; i++) for (let k = 0; k < C.length && i + k < nsym; k++) Om[i + k] ^= mul(S[i], C[k]);
  const dC = C.map((c, k) => (k % 2 ? c : 0)).slice(1);   // formal derivative
  for (const j of pos) {
    const X = EXP[j], Xi = EXP[(255 - j) % 255];
    const den = evalAt(dC, Xi);
    if (!den) return -1;
    const e = mul(X, div(evalAt(Om, Xi), den));
    block[n - 1 - j] ^= e;
  }
  return pos.length;
}

// ---------------------------------------------------------------- binarisation
function luminance({ data, width, height }) {
  const g = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
  return g;
}

/** Block-wise local threshold: 1 = dark. Blocks without contrast take the threshold of their neighbourhood. */
export function binarize(lum, w, h) {
  const B = 8, bw = Math.ceil(w / B), bh = Math.ceil(h / B);
  const avg = new Float32Array(bw * bh);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    let sum = 0, mn = 255, mx = 0, n = 0;
    for (let y = by * B; y < Math.min(h, by * B + B); y++) for (let x = bx * B; x < Math.min(w, bx * B + B); x++) {
      const v = lum[y * w + x]; sum += v; n++; if (v < mn) mn = v; if (v > mx) mx = v;
    }
    let a = sum / n;
    if (mx - mn <= 24) {
      a = mn / 2;   // flat block: darker than the background unless the neighbours say otherwise
      if (by > 0 && bx > 0) {
        const nb = (avg[(by - 1) * bw + bx] + 2 * avg[by * bw + bx - 1] + avg[(by - 1) * bw + bx - 1]) / 4;
        if (mn < nb) a = nb;
      }
    }
    avg[by * bw + bx] = a;
  }
  const out = new Uint8Array(w * h);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    let s = 0, n = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const yy = Math.min(bh - 1, Math.max(0, by + dy)), xx = Math.min(bw - 1, Math.max(0, bx + dx));
      s += avg[yy * bw + xx]; n++;
    }
    const t = s / n;
    for (let y = by * B; y < Math.min(h, by * B + B); y++) for (let x = bx * B; x < Math.min(w, bx * B + B); x++) out[y * w + x] = lum[y * w + x] <= t ? 1 : 0;
  }
  return out;
}

// ---------------------------------------------------------------- finder patterns
function ratioOk(c) {
  const total = c[0] + c[1] + c[2] + c[3] + c[4];
  if (total < 7) return false;
  const m = total / 7, v = m / 1.6;
  return Math.abs(m - c[0]) < v && Math.abs(m - c[1]) < v && Math.abs(3 * m - c[2]) < 3 * v && Math.abs(m - c[3]) < v && Math.abs(m - c[4]) < v;
}

function crossCheck(bits, w, h, cx, cy, dx, dy, maxCount, origTotal, lo = 0) {
  // runs along the direction (dx, dy) through (cx, cy): returns centre offset along that line or NaN
  const at = (k) => { const x = Math.round(cx + dx * k), y = Math.round(cy + dy * k); return x < 0 || y < 0 || x >= w || y >= h ? -1 : bits[y * w + x]; };
  const c = [0, 0, 0, 0, 0];
  let k = 0;
  while (at(k) === 1) { c[2]++; k--; }
  if (at(k) === -1) return NaN;
  while (at(k) === 0 && c[1] <= maxCount) { c[1]++; k--; }
  if (at(k) === -1 || c[1] > maxCount) return NaN;
  while (at(k) === 1 && c[0] <= maxCount) { c[0]++; k--; }
  if (c[0] > maxCount) return NaN;
  k = 1;
  while (at(k) === 1) { c[2]++; k++; }
  if (at(k) === -1) return NaN;
  while (at(k) === 0 && c[3] < maxCount) { c[3]++; k++; }
  if (at(k) === -1 || c[3] >= maxCount) return NaN;
  while (at(k) === 1 && c[4] < maxCount) { c[4]++; k++; }
  if (c[4] >= maxCount) return NaN;
  const total = c[0] + c[1] + c[2] + c[3] + c[4];
  if (lo ? total < origTotal * lo || total > origTotal * 1.6 : 5 * Math.abs(total - origTotal) >= 2 * origTotal) return NaN;
  if (!ratioOk(c)) return NaN;
  return { off: k - c[4] - c[3] - c[2] / 2, total };
}

function findFinders(bits, w, h) {
  const found = [];
  const step = Math.max(1, Math.floor(h / 600));
  for (let y = 0; y < h; y += step) {
    const c = [0, 0, 0, 0, 0];
    let state = 0;
    const row = y * w;
    for (let x = 0; x <= w; x++) {
      const v = x < w ? bits[row + x] : 0;
      if (v === 1) {
        if (state & 1) state++;
        c[state]++;
      } else if (!(state & 1)) {
        if (state === 4) {
          if (ratioOk(c)) {
            const total = c[0] + c[1] + c[2] + c[3] + c[4];
            const cxRow = x - c[4] - c[3] - c[2] / 2;
            const v1 = crossCheck(bits, w, h, cxRow, y, 0, 1, c[2], total);
            if (v1 === v1 && v1) {
              const cy = y + v1.off;
              const h1 = crossCheck(bits, w, h, cxRow, cy, 1, 0, c[2], total);
              // a line through the centre in any direction crosses the nested squares 1:1:3:1:1 – the diagonal
              // weeds out look-alikes in the data area (counted in diagonal steps, hence the wide length window)
              const d1 = h1 === h1 && h1 && crossCheck(bits, w, h, cxRow + h1.off, cy, 1, 1, c[2] * 2, total, 0.4);
              if (d1 === d1 && d1) {
                const cx = cxRow + h1.off;
                const size = (v1.total + h1.total) / 14;
                const same = found.find(f => Math.abs(f.x - cx) <= size * 2 && Math.abs(f.y - cy) <= size * 2 && Math.abs(f.size - size) <= Math.max(1, f.size * 0.6));
                if (same) { same.x = (same.x * same.n + cx) / (same.n + 1); same.y = (same.y * same.n + cy) / (same.n + 1); same.size = (same.size * same.n + size) / (same.n + 1); same.n++; }
                else found.push({ x: cx, y: cy, size, n: 1 });
              }
            }
          }
          c[0] = c[2]; c[1] = c[3]; c[2] = c[4]; c[3] = 1; c[4] = 0; state = 3;
        } else c[++state]++;
      } else c[state]++;
    }
  }
  return found.sort((a, b) => b.n - a.n).slice(0, 12);
}

/** Triples of finder patterns that look like a QR corner, best first: [tl, tr, bl]. */
function corners(fs) {
  const out = [];
  const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) for (let k = j + 1; k < fs.length; k++) {
    const P = [fs[i], fs[j], fs[k]];
    const sizes = P.map(p => p.size);
    if (Math.max(...sizes) > Math.min(...sizes) * 1.8) continue;
    const s = [d2(P[1], P[2]), d2(P[0], P[2]), d2(P[0], P[1])];   // side opposite each point
    const ai = s.indexOf(Math.max(...s));
    const B = P[ai], A = P[(ai + 1) % 3], C = P[(ai + 2) % 3];
    const ab = Math.sqrt(d2(A, B)), cb = Math.sqrt(d2(C, B));
    if (Math.max(ab, cb) > Math.min(ab, cb) * 1.6) continue;
    const cos = ((A.x - B.x) * (C.x - B.x) + (A.y - B.y) * (C.y - B.y)) / (ab * cb);
    if (Math.abs(cos) > 0.35) continue;
    const mod = (sizes[0] + sizes[1] + sizes[2]) / 3;
    if (Math.min(ab, cb) < mod * 7) continue;   // version 1: 14 modules between centres (mod from runs can be up to √2 too big)
    // orientation: (tr - tl) × (bl - tl) > 0 with y pointing down
    let tr = A, bl = C;
    if ((A.x - B.x) * (C.y - B.y) - (A.y - B.y) * (C.x - B.x) < 0) { tr = C; bl = A; }
    out.push({ score: Math.abs(cos) + Math.abs(ab - cb) / Math.max(ab, cb) - Math.min(...P.map(p => p.n)) * 0.002, tl: B, tr, bl, mod });
  }
  return out.sort((a, b) => a.score - b.score).slice(0, 6);
}

// ---------------------------------------------------------------- geometry
/**
 * Width of a finder pattern measured along the line from `a` towards `b` (both directions from a's centre):
 * dark centre → light ring → dark ring → light quiet zone. A finder is 7 modules wide in every direction, so
 * this gives the module size along that line also for rotated and tilted codes.
 */
function finderWidthAlong(bits, w, h, a, b) {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const dx = (b.x - a.x) / len, dy = (b.y - a.y) / len;
  const run = sgn => {
    let state = 0, k = 0;   // 0 dark centre, 1 light ring, 2 dark ring
    const lim = len / 2;
    while (k < lim) {
      const x = Math.round(a.x + dx * k * sgn), y = Math.round(a.y + dy * k * sgn);
      if (x < 0 || y < 0 || x >= w || y >= h) return NaN;
      const v = bits[y * w + x];
      if (state === 0 && !v) state = 1;
      else if (state === 1 && v) state = 2;
      else if (state === 2 && !v) return k;
      k += 0.5;
    }
    return NaN;
  };
  const f = run(1), r = run(-1);
  if (f !== f || r !== r) return NaN;
  return f + r;
}

function moduleSize(bits, w, h, c) {
  const vals = [finderWidthAlong(bits, w, h, c.tl, c.tr), finderWidthAlong(bits, w, h, c.tr, c.tl), finderWidthAlong(bits, w, h, c.tl, c.bl), finderWidthAlong(bits, w, h, c.bl, c.tl)].filter(v => v === v);
  if (!vals.length) return c.mod;
  return vals.reduce((s, v) => s + v, 0) / vals.length / 7;
}

/** Homography mapping 4 source points to 4 destination points: returns (x, y) → [u, v]. */
function homography(src, dst) {
  const A = [], bv = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); bv.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); bv.push(v);
  }
  // Gaussian elimination
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]]; [bv[c], bv[p]] = [bv[p], bv[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      if (!f) continue;
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      bv[r] -= f * bv[c];
    }
  }
  const hh = bv.map((v, i) => v / A[i][i]);
  return (x, y) => { const z = hh[6] * x + hh[7] * y + 1; return [(hh[0] * x + hh[1] * y + hh[2]) / z, (hh[3] * x + hh[4] * y + hh[5]) / z]; };
}

/** Least-squares homography (code → image) from ≥ 4 point pairs, normalised DLT with h33 = 1. */
function fitHomography(src, dst) {
  if (src.length === 4) return homography(src, dst);
  const n = src.length;
  let mx = 0, my = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { mx += dst[i][0]; my += dst[i][1]; sx += src[i][0]; sy += src[i][1]; }
  mx /= n; my /= n; sx /= n; sy /= n;
  let ds = 0, ss = 0;
  for (let i = 0; i < n; i++) { ds += Math.hypot(dst[i][0] - mx, dst[i][1] - my); ss += Math.hypot(src[i][0] - sx, src[i][1] - sy); }
  ds = ds / n || 1; ss = ss / n || 1;
  const N = Array.from({ length: 8 }, () => new Float64Array(9));
  for (let i = 0; i < n; i++) {
    const x = (src[i][0] - sx) / ss, y = (src[i][1] - sy) / ss, u = (dst[i][0] - mx) / ds, v = (dst[i][1] - my) / ds;
    for (const [row, rhs] of [[[x, y, 1, 0, 0, 0, -u * x, -u * y], u], [[0, 0, 0, x, y, 1, -v * x, -v * y], v]]) {
      for (let r = 0; r < 8; r++) { if (!row[r]) continue; for (let c = 0; c < 8; c++) N[r][c] += row[r] * row[c]; N[r][8] += row[r] * rhs; }
    }
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(N[r][c]) > Math.abs(N[p][c])) p = r;
    if (Math.abs(N[p][c]) < 1e-12) return null;
    [N[c], N[p]] = [N[p], N[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c || !N[r][c]) continue;
      const f = N[r][c] / N[c][c];
      for (let k = c; k < 9; k++) N[r][k] -= f * N[c][k];
    }
  }
  const hh = N.map((row, i) => row[8] / row[i]);
  return (X, Y) => {
    const x = (X - sx) / ss, y = (Y - sy) / ss, z = hh[6] * x + hh[7] * y + 1;
    return [(hh[0] * x + hh[1] * y + hh[2]) / z * ds + mx, (hh[3] * x + hh[4] * y + hh[5]) / z * ds + my];
  };
}

/** Distance from a finder centre to its outer edge in direction (dx, dy): dark centre, light ring, dark ring, light. */
function edgeDist(bits, w, h, p, dx, dy, maxK) {
  let state = 0;
  for (let k = 0; k < maxK; k += 0.5) {
    const x = Math.floor(p.x + dx * k), y = Math.floor(p.y + dy * k);
    if (x < 0 || y < 0 || x >= w || y >= h) return NaN;
    const v = bits[y * w + x];
    if (state === 0 && !v) state = 1;
    else if (state === 1 && v) state = 2;
    else if (state === 2 && !v) return k - 0.25;
  }
  return NaN;
}

/**
 * First guess of the whole perspective from the three finders alone: the lines tl–tr and tl–bl are rows/columns
 * 3.5 of the code, so the outer finder edges on them sit at known module positions; the anti-diagonal tr–bl
 * crosses two finder corners. A least-squares fit over these points follows strong tilts much better than a
 * parallelogram and tells where (and how big, how rotated) the bottom-right alignment pattern should be.
 */
function finderHomography(bits, w, h, c, dim) {
  const { tl, tr, bl } = c;
  const src = [[3.5, 3.5], [dim - 3.5, 3.5], [3.5, dim - 3.5]], dst = [[tl.x, tl.y], [tr.x, tr.y], [bl.x, bl.y]];
  const add = (p, q, sgn, code, diag) => {
    const len = Math.hypot(q.x - p.x, q.y - p.y), dx = (q.x - p.x) / len * sgn, dy = (q.y - p.y) / len * sgn;
    const m = p.size || c.mod, e = edgeDist(bits, w, h, p, dx, dy, m * 7);
    const want = 3.5 * m * (diag ? Math.SQRT2 : 1);
    if (e === e && e > want * 0.55 && e < want * 1.6) { src.push(code); dst.push([p.x + dx * e, p.y + dy * e]); }
  };
  add(tl, tr, 1, [7, 3.5]); add(tl, tr, -1, [0, 3.5]); add(tl, bl, 1, [3.5, 7]); add(tl, bl, -1, [3.5, 0]);
  add(tr, tl, 1, [dim - 7, 3.5]); add(tr, tl, -1, [dim, 3.5]); add(bl, tl, 1, [3.5, dim - 7]); add(bl, tl, -1, [3.5, dim]);
  add(tr, bl, 1, [dim - 7, 7], true); add(tr, bl, -1, [dim, 0], true); add(bl, tr, 1, [7, dim - 7], true); add(bl, tr, -1, [0, dim], true);
  return src.length >= 5 ? fitHomography(src, dst) : null;
}

/**
 * Alignment pattern candidates near (ex, ey): 5×5 modules, dark ring – light ring – dark centre, checked as a whole
 * template on the local module grid (module vectors mx, my: rotation, size and shear at that spot).
 * Returns up to `max` blob centres, nearest first – the caller tries each and keeps the one that decodes.
 */
function findAlignment(bits, w, h, ex, ey, mx, my, radius, max = 3) {
  const mod = Math.max(1, (Math.hypot(mx[0], mx[1]) + Math.hypot(my[0], my[1])) / 2);
  const r = mod * radius, step = Math.max(1, mod / 3);
  const tpl = [];
  for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) tpl.push([i * mx[0] + j * my[0], i * mx[1] + j * my[1], Math.max(Math.abs(i), Math.abs(j)) !== 1 ? 1 : 0]);
  const hits = [];
  for (let y = Math.max(0, ey - r); y < Math.min(h, ey + r); y += step) {
    for (let x = Math.max(0, ex - r); x < Math.min(w, ex + r); x += step) {
      if (!bits[(y | 0) * w + (x | 0)]) continue;
      let bad = 0;
      for (const [dx, dy, want] of tpl) {
        const xx = Math.floor(x + dx), yy = Math.floor(y + dy);
        const v = xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : bits[yy * w + xx];
        if (v !== want && ++bad > 2) break;
      }
      if (bad <= 2) hits.push({ x, y, bad });
    }
  }
  // group neighbouring hits into blobs, centre = mean of the best-fitting hits of each blob
  const blobs = [];
  for (const p of hits) {
    const b = blobs.find(b => Math.abs(b.x0 - p.x) < mod * 1.5 && Math.abs(b.y0 - p.y) < mod * 1.5);
    if (b) b.pts.push(p); else blobs.push({ x0: p.x, y0: p.y, pts: [p] });
  }
  return blobs.map(b => {
    const best = Math.min(...b.pts.map(p => p.bad));
    const pts = b.pts.filter(p => p.bad === best);
    const x = pts.reduce((s, p) => s + p.x, 0) / pts.length, y = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    return { x, y, d: (x - ex) ** 2 + (y - ey) ** 2 + best * mod * mod * 4 };
  }).sort((a, b) => a.d - b.d).slice(0, max);
}

const localModule = (H, X, Y) => {
  const a = H(X - 0.5, Y), b = H(X + 0.5, Y), c = H(X, Y - 0.5), d = H(X, Y + 0.5);
  return [[b[0] - a[0], b[1] - a[1]], [d[0] - c[0], d[1] - c[1]]];
};

/**
 * Candidate code → image transforms for one finder triple and size, most likely first: the finder fit refined by
 * the bottom-right alignment pattern (and, from version 7 on, by every other alignment pattern found where the fit
 * predicts it), the finder fit alone, and the plain parallelogram.
 */
function transforms(bits, w, h, c, dim) {
  const { tl, tr, bl } = c;
  const base = [[3.5, 3.5], [dim - 3.5, 3.5], [3.5, dim - 3.5]], img = [[tl.x, tl.y], [tr.x, tr.y], [bl.x, bl.y]];
  const out = [];
  const H0 = finderHomography(bits, w, h, c, dim);
  if (dim > 21) {
    const A = dim - 6.5;
    let ex, ey, mx, my;
    if (H0) { [ex, ey] = H0(A, A); [mx, my] = localModule(H0, A, A); }
    else {
      const corr = 1 - 3 / (dim - 7);
      ex = tl.x + corr * (tr.x - tl.x + bl.x - tl.x); ey = tl.y + corr * (tr.y - tl.y + bl.y - tl.y);
      mx = [(tr.x - tl.x) / (dim - 7), (tr.y - tl.y) / (dim - 7)]; my = [(bl.x - tl.x) / (dim - 7), (bl.y - tl.y) / (dim - 7)];
    }
    const ver = (dim - 17) / 4;
    for (const a of findAlignment(bits, w, h, ex, ey, mx, my, 8)) {
      const H = homography([...base, [A, A]], [...img, [a.x, a.y]]);
      if (!H) continue;
      if (ver >= 7) {
        // every alignment pattern the 4-point fit predicts, searched close by, then one least-squares fit over all
        const src = [...base, [A, A]], dst = [...img, [a.x, a.y]];
        const pos = alignmentPositions(ver);
        for (const py of pos) for (const px of pos) {
          if ((px === 6 && py === 6) || (px === 6 && py === pos[pos.length - 1]) || (py === 6 && px === pos[pos.length - 1])) continue;
          if (px === pos[pos.length - 1] && py === pos[pos.length - 1]) continue;
          const [qx, qy] = H(px + 0.5, py + 0.5), [vx, vy] = localModule(H, px + 0.5, py + 0.5);
          const f = findAlignment(bits, w, h, qx, qy, vx, vy, 2.5, 1)[0];
          if (f) { src.push([px + 0.5, py + 0.5]); dst.push([f.x, f.y]); }
        }
        const H2 = src.length > 4 && fitHomography(src, dst);
        if (H2) out.push(H2);
      }
      out.push(H);
    }
  }
  if (H0) out.push(H0);
  const P = homography([...base, [dim - 3.5, dim - 3.5]], [...img, [tr.x - tl.x + bl.x, tr.y - tl.y + bl.y]]);
  if (P) out.push(P);
  return out;
}

function sampleGrid(bits, w, h, H, dim, mirror = false) {
  const grid = new Uint8Array(dim * dim);
  for (let y = 0; y < dim; y++) for (let x = 0; x < dim; x++) {
    const [u, v] = H(x + 0.5, y + 0.5);
    const xi = Math.floor(u), yi = Math.floor(v);
    const val = xi < 0 || yi < 0 || xi >= w || yi >= h ? 0 : bits[yi * w + xi];
    grid[mirror ? x * dim + y : y * dim + x] = val;
  }
  return grid;
}

// ---------------------------------------------------------------- decoding the module grid
const VERSION_CODES = [];
for (let v = 7; v <= 40; v++) { let rem = v; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25); VERSION_CODES.push({ v, code: (v << 12) | rem }); }
const popcount = x => { let c = 0; while (x) { c += x & 1; x >>>= 1; } return c; };

function readFormat(get, size) {
  let a = 0, b = 0;
  const bit = (x, y) => get(x, y);
  // copy 1 around the top-left finder, copy 2 split between the other two finders
  const fa = [];
  for (let i = 0; i <= 5; i++) fa[i] = bit(8, i);
  fa[6] = bit(8, 7); fa[7] = bit(8, 8); fa[8] = bit(7, 8);
  for (let i = 9; i < 15; i++) fa[i] = bit(14 - i, 8);
  for (let i = 0; i < 15; i++) a |= fa[i] << i;
  for (let i = 0; i < 8; i++) b |= bit(size - 1 - i, 8) << i;
  for (let i = 8; i < 15; i++) b |= bit(8, size - 15 + i) << i;
  let best = null;
  for (let e = 0; e < 4; e++) for (let m = 0; m < 8; m++) {
    const code = formatCode(e, m);
    for (const x of [a, b]) { const d = popcount(code ^ x); if (!best || d < best.d) best = { d, e, m }; }
  }
  return best && best.d <= 3 ? best : null;
}

function readVersion(get, size) {
  let a = 0, b = 0;
  for (let i = 0; i < 18; i++) {
    const p = size - 11 + (i % 3), q = Math.floor(i / 3);
    a |= get(p, q) << i;   // top right
    b |= get(q, p) << i;   // bottom left
  }
  let best = null;
  for (const { v, code } of VERSION_CODES) for (const x of [a, b]) { const d = popcount(code ^ x); if (!best || d < best.d) best = { d, v }; }
  return best && best.d <= 3 ? best.v : null;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];
const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

/** Decode a module grid (Uint8Array, 1 = dark). Returns { text, bytes, version, ecc, corrected } or null. */
export function decodeGrid(grid, size) {
  const get = (x, y) => grid[y * size + x];
  let ver = (size - 17) / 4;
  if (ver >= 7) { const v = readVersion(get, size); if (v && v !== ver) return { retrySize: 17 + 4 * v }; }
  if (!Number.isInteger(ver) || ver < 1 || ver > 40) return null;
  const fmt = readFormat(get, size);
  if (!fmt) return null;
  const isFn = new Uint8Array(size * size);
  const mark = (x, y) => { if (x >= 0 && y >= 0 && x < size && y < size) isFn[y * size + x] = 1; };
  for (let i = 0; i < size; i++) { mark(6, i); mark(i, 6); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) mark(cx + dx, cy + dy);
  const al = alignmentPositions(ver), na = al.length;
  for (let i = 0; i < na; i++) for (let j = 0; j < na; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(al[i] + dx, al[j] + dy);
  }
  for (let i = 0; i <= 8; i++) { mark(8, i); mark(i, 8); }
  for (let i = 0; i < 8; i++) { mark(size - 1 - i, 8); mark(8, size - 1 - i); }
  if (ver >= 7) for (let i = 0; i < 18; i++) { const a = size - 11 + (i % 3), b = Math.floor(i / 3); mark(a, b); mark(b, a); }
  const maskAt = MASKS[fmt.m];
  const rawCw = Math.floor(rawDataModules(ver) / 8);
  const bytes = new Uint8Array(rawCw);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const up = ((right + 1) & 2) === 0;
        const y = up ? size - 1 - vert : vert;
        if (isFn[y * size + x]) continue;
        if (i < rawCw * 8) bytes[i >>> 3] |= ((get(x, y) ^ (maskAt(x, y) ? 1 : 0)) & 1) << (7 - (i & 7));
        i++;
      }
    }
  }
  // de-interleave data + EC codewords, correct each block
  const nb = NUM_BLOCKS[fmt.e][ver], ecLen = ECC_PER_BLOCK[fmt.e][ver];
  const numShort = nb - (rawCw % nb), shortLen = Math.floor(rawCw / nb);
  const blocks = Array.from({ length: nb }, (_, b) => new Uint8Array(shortLen + (b < numShort ? 0 : 1)));
  const dataLen = b => blocks[b].length - ecLen;
  let k = 0;
  for (let c = 0; c < shortLen - ecLen + 1; c++) for (let b = 0; b < nb; b++) if (c < dataLen(b)) blocks[b][c] = bytes[k++];
  for (let c = 0; c < ecLen; c++) for (let b = 0; b < nb; b++) blocks[b][dataLen(b) + c] = bytes[k++];
  let corrected = 0;
  for (const blk of blocks) { const r = rsCorrect(blk, ecLen); if (r < 0) return null; corrected += r; }
  const data = new Uint8Array(blocks.reduce((s, b) => s + b.length - ecLen, 0));
  let o = 0;
  for (const blk of blocks) { data.set(blk.subarray(0, blk.length - ecLen), o); o += blk.length - ecLen; }
  const seg = decodeSegments(data, ver);
  if (!seg) return null;
  return { ...seg, version: ver, ecc: 'LMQH'[fmt.e], corrected };
}

function decodeSegments(data, ver) {
  let pos = 0;
  const total = data.length * 8;
  const read = n => { if (pos + n > total) throw new Error('eod'); let v = 0; for (let q = 0; q < n; q++) { const p = pos + q; v = (v << 1) | ((data[p >>> 3] >>> (7 - (p & 7))) & 1); } pos += n; return v; };
  const cc = ver < 10 ? 0 : ver < 27 ? 1 : 2;
  const parts = [];   // { bytes, enc } chunks, decoded at the end
  let enc = null, raw = [];
  const flushBytes = bs => parts.push({ bytes: bs, enc });
  try {
    while (pos + 4 <= total) {
      const mode = read(4);
      if (mode === 0) break;
      if (mode === 1) {   // numeric
        let n = read([10, 12, 14][cc]); let s = '';
        while (n >= 3) { s += String(read(10)).padStart(3, '0'); n -= 3; }
        if (n === 2) s += String(read(7)).padStart(2, '0'); else if (n === 1) s += String(read(4));
        parts.push({ text: s });
      } else if (mode === 2) {   // alphanumeric
        let n = read([9, 11, 13][cc]); let s = '';
        while (n >= 2) { const v = read(11); s += ALNUM[Math.floor(v / 45)] + ALNUM[v % 45]; n -= 2; }
        if (n) s += ALNUM[read(6)];
        parts.push({ text: s });
      } else if (mode === 4) {   // byte
        const n = read([8, 16, 16][cc]);
        const bs = new Uint8Array(n);
        for (let q = 0; q < n; q++) bs[q] = read(8);
        raw.push(...bs);
        flushBytes(bs);
      } else if (mode === 8) {   // kanji (Shift_JIS)
        const n = read([8, 10, 12][cc]);
        const bs = [];
        for (let q = 0; q < n; q++) {
          const v = read(13);
          let c = Math.floor(v / 0xc0) * 0x100 + (v % 0xc0);
          c += c < 0x1f00 ? 0x8140 : 0xc140;
          bs.push(c >> 8, c & 255);
        }
        parts.push({ bytes: new Uint8Array(bs), enc: 'shift_jis' });
      } else if (mode === 7) {   // ECI
        let v = read(8);
        if ((v & 0x80) === 0) { /* 1 byte */ } else if ((v & 0xc0) === 0x80) v = ((v & 0x3f) << 8) | read(8); else v = ((v & 0x1f) << 16) | read(16);
        enc = { 26: 'utf-8', 3: 'iso-8859-1', 1: 'iso-8859-1', 4: 'iso-8859-2', 20: 'shift_jis', 22: 'windows-1251', 23: 'windows-1252', 28: 'big5', 29: 'gb18030', 30: 'euc-kr' }[v] || null;
      } else if (mode === 3) { read(16); }   // structured append header
      else if (mode === 5) { /* FNC1 first position */ } else if (mode === 9) { read(8); }
      else return null;
    }
  } catch { /* data ran out: keep what we have */ }
  const text = parts.map(p => {
    if (p.text != null) return p.text;
    if (p.enc) { try { return new TextDecoder(p.enc).decode(p.bytes); } catch { /* unknown label */ } }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(p.bytes); } catch { return new TextDecoder('iso-8859-1').decode(p.bytes); }
  }).join('');
  if (!parts.length) return null;
  return { text, bytes: new Uint8Array(raw) };
}

// ---------------------------------------------------------------- public API
function tryBits(bits, w, h, results, max) {
  const finders = findFinders(bits, w, h);
  if (finders.length < 3) return;
  for (const c of corners(finders)) {
    const mod = moduleSize(bits, w, h, c);
    const est = (Math.hypot(c.tr.x - c.tl.x, c.tr.y - c.tl.y) + Math.hypot(c.bl.x - c.tl.x, c.bl.y - c.tl.y)) / 2 / mod + 7;
    let dim = Math.round(est);
    const r = (dim - 17 + 400) % 4;
    dim += r === 0 ? 0 : r === 1 ? -1 : r === 2 ? 2 : 1;   // nearest 17 + 4v
    const sizes = [dim, dim - 4, dim + 4].filter(s => s >= 21 && s <= 177);
    for (let s of sizes) {
      let res = null;
      const attempt = size => {
        for (const H of transforms(bits, w, h, c, size)) {
          for (const mirror of [false, true]) {
            const grid = sampleGrid(bits, w, h, H, size, mirror);
            const r = grid && decodeGrid(grid, size);
            if (r && (r.text != null || r.retrySize)) return r;
          }
        }
        return null;
      };
      res = attempt(s);
      if (res && res.retrySize) res = attempt(res.retrySize);
      if (res && res.text != null && !res.retrySize) {
        if (!results.some(x => x.text === res.text)) results.push({ ...res, format: 'qr_code', points: [c.tl, c.tr, c.bl].map(p => ({ x: p.x, y: p.y })) });
        if (results.length >= max) return;
      }
      if (results.some(x => x.points && Math.hypot(x.points[0].x - c.tl.x, x.points[0].y - c.tl.y) < 2)) break;
    }
  }
}

/**
 * Find and decode QR codes in RGBA pixels { data, width, height }.
 * @returns {Array<{text, bytes, version, ecc, corrected, format: 'qr_code', points}>}
 */
export function scanImageData(img, { max = 4 } = {}) {
  const { width: w, height: h } = img;
  const lum = luminance(img);
  const results = [];
  const bits = binarize(lum, w, h);
  tryBits(bits, w, h, results, max);
  if (!results.length) {   // light code on a dark background
    for (let i = 0; i < bits.length; i++) bits[i] ^= 1;
    tryBits(bits, w, h, results, max);
  }
  return results;
}

/** Internals for the unit test (tests/suites/webtools/qrscan_unit.mjs). */
export const _internals = { luminance, binarize, findFinders, corners, moduleSize, sampleGrid, decodeGrid, transforms };
