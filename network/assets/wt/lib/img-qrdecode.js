// Minimal QR decoder for the QR generator's self-test: reads a module matrix (from a rendered image of a
// known geometry) back into text – format info (with error tolerance), unmasking, de-interleaving and
// byte-mode segments (what lib/shared/qr.js produces). No error correction: the self-test wants a
// perfect read of exactly what we rendered.

const ECC_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
const NUM_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];
const ECC_FROM_BITS = { 1: 0, 0: 1, 3: 2, 2: 3 }; // format bits → index L, M, Q, H

function rawDataModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) { const n = Math.floor(ver / 7) + 2; r -= (25 * n - 10) * n - 55; if (ver >= 7) r -= 36; }
  return r;
}
function alignmentPositions(ver) {
  if (ver === 1) return [];
  const num = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (num * 2 - 2)) * 2;
  const out = [6];
  for (let pos = ver * 4 + 10; out.length < num; pos -= step) out.splice(1, 0, pos);
  return out;
}
function formatCode(ecc, mask) {
  const data = ([1, 0, 3, 2][ecc] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}
const popcount = x => { let c = 0; while (x) { c += x & 1; x >>>= 1; } return c; };

/**
 * @param {(x:number, y:number) => boolean} dark   module reader
 * @param {number} size
 * @returns {string|null}
 */
export function decodeModules(dark, size) {
  const ver = (size - 17) / 4;
  if (!Number.isInteger(ver) || ver < 1 || ver > 40) return null;
  // format info (first copy), best match among the 32 codes
  let f = 0;
  const bit = (x, y) => (dark(x, y) ? 1 : 0);
  const fb = [];
  for (let i = 0; i <= 5; i++) fb[i] = bit(8, i);
  fb[6] = bit(8, 7); fb[7] = bit(8, 8); fb[8] = bit(7, 8);
  for (let i = 9; i < 15; i++) fb[i] = bit(14 - i, 8);
  for (let i = 0; i < 15; i++) f |= fb[i] << i;
  let best = null;
  for (let e = 0; e < 4; e++) for (let m = 0; m < 8; m++) {
    const d = popcount(formatCode(e, m) ^ f);
    if (!best || d < best.d) best = { d, e, m };
  }
  if (!best || best.d > 3) return null;
  const eccIdx = best.e, mask = best.m;

  // function pattern map
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

  const maskAt = (x, y) => {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    }
  };
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
        if (i < rawCw * 8) {
          const b = (dark(x, y) ? 1 : 0) ^ (maskAt(x, y) ? 1 : 0);
          bytes[i >>> 3] |= b << (7 - (i & 7));
        }
        i++;
      }
    }
  }
  // de-interleave the data codewords
  const nb = NUM_BLOCKS[eccIdx][ver], eccLen = ECC_PER_BLOCK[eccIdx][ver];
  const numShort = nb - (rawCw % nb), shortLen = Math.floor(rawCw / nb);
  const lens = Array.from({ length: nb }, (_, b) => shortLen - eccLen + (b < numShort ? 0 : 1));
  const blocks = lens.map(l => new Uint8Array(l));
  let k = 0;
  const maxData = shortLen - eccLen + 1;
  for (let c = 0; c < maxData; c++) for (let b = 0; b < nb; b++) if (c < lens[b]) blocks[b][c] = bytes[k++];
  const data = new Uint8Array(lens.reduce((s, l) => s + l, 0));
  let o = 0;
  for (const b of blocks) { data.set(b, o); o += b.length; }

  // segments (byte mode only)
  let pos = 0;
  const read = n => { let v = 0; for (let q = 0; q < n; q++) { const p = pos + q; v = (v << 1) | ((data[p >>> 3] >>> (7 - (p & 7))) & 1); } pos += n; return v; };
  const out = [];
  while (pos + 4 <= data.length * 8) {
    const mode = read(4);
    if (mode === 0) break;
    if (mode !== 4) return null;
    const n = read(ver < 10 ? 8 : 16);
    if (pos + n * 8 > data.length * 8) return null;
    for (let q = 0; q < n; q++) out.push(read(8));
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(out)); } catch { return null; }
}

/**
 * Read a QR code back from RGBA pixels of an image whose geometry we know (generated by us):
 * size modules + border, square, starting at (0,0). Threshold halfway between the darkest and the
 * lightest luminance – like a scanner, dark modules must be darker than the background.
 */
export function decodeRaster({ data, width, height }, size, border) {
  const n = size + border * 2;
  const px = width / n;
  const lum = (x, y) => { const i = (Math.min(height - 1, Math.max(0, Math.round(y))) * width + Math.min(width - 1, Math.max(0, Math.round(x)))) * 4; return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]; };
  let lo = 255, hi = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const v = lum((x + border + 0.5) * px, (y + border + 0.5) * px); if (v < lo) lo = v; if (v > hi) hi = v; }
  // include the quiet zone as "light" reference
  if (border) { const v = lum(px * 0.5, px * 0.5); if (v > hi) hi = v; if (v < lo) lo = v; }
  const t = (lo + hi) / 2;
  if (hi - lo < 10) return null;
  return decodeModules((x, y) => lum((x + border + 0.5) * px, (y + border + 0.5) * px) < t, size);
}
