// Baseline JPEG encoder for 8-bit grayscale pixels (one component, standard IJG tables).
// Browsers only encode 3-component (YCbCr) JPEGs; a PDF image with /ColorSpace /DeviceGray needs a
// 1-component JPEG – that is what this writes. Used by grayscale-pdf for photos that were JPEGs before
// (storing them as Flate would make the file several times larger).
// encodeGrayJpeg(px, w, h, quality 1–100, tick?) → Promise<Uint8Array>

const ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];
const LUMA_Q = [16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
  18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99];
const DC_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_VALS = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
  0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
  0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
  0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
  0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa];

function huffTable(bits, vals) {
  const code = new Uint16Array(256), len = new Uint8Array(256);
  let c = 0, k = 0;
  for (let l = 1; l <= 16; l++) {
    for (let i = 0; i < bits[l - 1]; i++) { code[vals[k]] = c; len[vals[k]] = l; k++; c++; }
    c <<= 1;
  }
  return { code, len };
}
const DC = huffTable(DC_BITS, DC_VALS), AC = huffTable(AC_BITS, AC_VALS);

// AAN scaled DCT factors
const AAN = [1, 1.387039845, 1.306562965, 1.175875602, 1, 0.785694958, 0.5411961, 0.275899379];

function quantTables(quality) {
  const q = Math.max(1, Math.min(100, Math.round(quality)));
  const sf = q < 50 ? Math.floor(5000 / q) : 200 - q * 2;
  const nat = new Uint8Array(64), fdtbl = new Float32Array(64), qt = new Uint8Array(64);
  for (let i = 0; i < 64; i++) nat[i] = Math.max(1, Math.min(255, Math.floor((LUMA_Q[i] * sf + 50) / 100)));
  for (let k = 0; k < 64; k++) qt[k] = nat[ZIGZAG[k]]; // DQT is written in zigzag order (ZIGZAG: zigzag → natural)
  for (let r = 0, k = 0; r < 8; r++) for (let c = 0; c < 8; c++, k++) fdtbl[k] = 1 / (nat[k] * AAN[r] * AAN[c] * 8);
  return { qt, fdtbl };
}

class BitWriter {
  constructor(size) { this.buf = new Uint8Array(size); this.pos = 0; this.acc = 0; this.n = 0; }
  grow(extra) { if (this.pos + extra > this.buf.length) { const b = new Uint8Array(Math.max(this.buf.length * 2, this.pos + extra)); b.set(this.buf); this.buf = b; } }
  byte(v) { this.grow(1); this.buf[this.pos++] = v; }
  bytes(a) { this.grow(a.length); this.buf.set(a, this.pos); this.pos += a.length; }
  word(v) { this.byte(v >> 8); this.byte(v & 255); }
  bits(code, len) {
    this.acc = (this.acc << len) | code; this.n += len;
    while (this.n >= 8) {
      const b = (this.acc >>> (this.n - 8)) & 255;
      this.byte(b); if (b === 255) this.byte(0);
      this.n -= 8;
    }
    this.acc &= (1 << this.n) - 1;
  }
  flush() { if (this.n > 0) this.bits((1 << (8 - this.n)) - 1, 8 - this.n); }
}

function fdct(d, fdtbl, out) {
  for (let i = 0; i < 64; i += 8) {
    const t0 = d[i] + d[i + 7], t7 = d[i] - d[i + 7], t1 = d[i + 1] + d[i + 6], t6 = d[i + 1] - d[i + 6];
    const t2 = d[i + 2] + d[i + 5], t5 = d[i + 2] - d[i + 5], t3 = d[i + 3] + d[i + 4], t4 = d[i + 3] - d[i + 4];
    let t10 = t0 + t3, t13 = t0 - t3, t11 = t1 + t2, t12 = t1 - t2;
    d[i] = t10 + t11; d[i + 4] = t10 - t11;
    const z1 = (t12 + t13) * 0.707106781; d[i + 2] = t13 + z1; d[i + 6] = t13 - z1;
    t10 = t4 + t5; t11 = t5 + t6; t12 = t6 + t7;
    const z5 = (t10 - t12) * 0.382683433, z2 = 0.5411961 * t10 + z5, z4 = 1.306562965 * t12 + z5, z3 = t11 * 0.707106781;
    const z11 = t7 + z3, z13 = t7 - z3;
    d[i + 5] = z13 + z2; d[i + 3] = z13 - z2; d[i + 1] = z11 + z4; d[i + 7] = z11 - z4;
  }
  for (let i = 0; i < 8; i++) {
    const t0 = d[i] + d[i + 56], t7 = d[i] - d[i + 56], t1 = d[i + 8] + d[i + 48], t6 = d[i + 8] - d[i + 48];
    const t2 = d[i + 16] + d[i + 40], t5 = d[i + 16] - d[i + 40], t3 = d[i + 24] + d[i + 32], t4 = d[i + 24] - d[i + 32];
    let t10 = t0 + t3, t13 = t0 - t3, t11 = t1 + t2, t12 = t1 - t2;
    d[i] = t10 + t11; d[i + 32] = t10 - t11;
    const z1 = (t12 + t13) * 0.707106781; d[i + 16] = t13 + z1; d[i + 48] = t13 - z1;
    t10 = t4 + t5; t11 = t5 + t6; t12 = t6 + t7;
    const z5 = (t10 - t12) * 0.382683433, z2 = 0.5411961 * t10 + z5, z4 = 1.306562965 * t12 + z5, z3 = t11 * 0.707106781;
    const z11 = t7 + z3, z13 = t7 - z3;
    d[i + 40] = z13 + z2; d[i + 24] = z13 - z2; d[i + 8] = z11 + z4; d[i + 56] = z11 - z4;
  }
  for (let k = 0; k < 64; k++) { const v = d[k] * fdtbl[k]; out[k] = v > 0 ? Math.floor(v + 0.5) : Math.ceil(v - 0.5); }
}

const bitLen = v => { v = Math.abs(v); let n = 0; while (v) { n++; v >>= 1; } return n; };

/** @param {Uint8Array} px  w*h gray samples, row-major */
export async function encodeGrayJpeg(px, w, h, quality = 85, tick = null) {
  const { qt, fdtbl } = quantTables(quality);
  const out = new BitWriter(Math.max(4096, (w * h) >> 2));
  out.word(0xffd8);
  out.bytes([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]); // JFIF
  out.word(0xffdb); out.word(67); out.byte(0); for (let i = 0; i < 64; i++) out.byte(qt[i]);
  out.word(0xffc0); out.word(11); out.byte(8); out.word(h); out.word(w); out.byte(1); out.bytes([1, 0x11, 0]);
  out.word(0xffc4); out.word(3 + 16 + DC_VALS.length); out.byte(0x00); out.bytes(DC_BITS); out.bytes(DC_VALS);
  out.word(0xffc4); out.word(3 + 16 + AC_VALS.length); out.byte(0x10); out.bytes(AC_BITS); out.bytes(AC_VALS);
  out.word(0xffda); out.word(8); out.byte(1); out.bytes([1, 0x00, 0, 63, 0]);
  const blk = new Float32Array(64), q = new Int32Array(64);
  let pred = 0, rows = 0;
  for (let by = 0; by < h; by += 8) {
    for (let bx = 0; bx < w; bx += 8) {
      for (let y = 0; y < 8; y++) {
        const sy = Math.min(h - 1, by + y) * w;
        for (let x = 0; x < 8; x++) blk[y * 8 + x] = px[sy + Math.min(w - 1, bx + x)] - 128;
      }
      fdct(blk, fdtbl, q);
      // DC
      const diff = q[0] - pred; pred = q[0];
      const dl = bitLen(diff);
      out.bits(DC.code[dl], DC.len[dl]);
      if (dl) out.bits(diff < 0 ? diff + (1 << dl) - 1 : diff, dl);
      // AC (zigzag)
      let run = 0;
      for (let k = 1; k < 64; k++) {
        const v = q[ZIGZAG[k]];
        if (!v) { run++; continue; }
        while (run > 15) { out.bits(AC.code[0xf0], AC.len[0xf0]); run -= 16; }
        const l = bitLen(v), sym = (run << 4) | l;
        out.bits(AC.code[sym], AC.len[sym]);
        out.bits(v < 0 ? v + (1 << l) - 1 : v, l);
        run = 0;
      }
      if (run) out.bits(AC.code[0], AC.len[0]);
    }
    if (tick && ++rows % 32 === 0) await tick();
  }
  out.flush();
  out.word(0xffd9);
  return out.buf.slice(0, out.pos);
}
