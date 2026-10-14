// GENERATED – synced copy of js/pdfcrypt.js by scripts/sync-webtools-vendor.mjs.
// Do not edit here: change the source in the app and run `node scripts/sync-webtools-vendor.mjs`.
// PDF Standard Security Handler for FaLe PDF.
//  - Decryption: RC4 40/128 bit (V1/V2, R2–R4), AES-128 (V4, AESV2), AES-256 (V5, R5/R6, AESV3)
//  - Encryption: AES-256 (V5/R6, AESV3) as a post-processing step on a pdf-lib document
// Pure-JS primitives (MD5, RC4, SHA-256/384/512, AES) so it works everywhere; WebCrypto is used
// for bulk AES-CBC on streams when available (much faster on big files).
// Everything runs locally – no network.

// =====================================================================================
// Byte helpers
// =====================================================================================
const enc = new TextEncoder();
function concat(...arrs) {
  let n = 0;
  for (const a of arrs) n += a.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
function equalBytes(a, b, n = Math.max(a.length, b.length)) {
  if (a.length < n || b.length < n) return false;
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
}
export function randomBytes(n) {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}
function toHex(b) {
  let s = '';
  for (let i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
  return s;
}

// =====================================================================================
// MD5
// =====================================================================================
const MD5_S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const MD5_K = new Int32Array(64).map((_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) | 0);
export function md5(msg) {
  const len = msg.length;
  const nBlocks = ((len + 8) >>> 6) + 1;
  const w = new Int32Array(nBlocks * 16);
  for (let i = 0; i < len; i++) w[i >> 2] |= msg[i] << ((i & 3) * 8);
  w[len >> 2] |= 0x80 << ((len & 3) * 8);
  w[nBlocks * 16 - 2] = (len * 8) | 0;
  w[nBlocks * 16 - 1] = Math.floor(len / 0x20000000) | 0;
  let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
  for (let blk = 0; blk < w.length; blk += 16) {
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; }
      else { F = C ^ (B | ~D); g = (7 * i) & 15; }
      const s = MD5_S[((i >> 4) << 2) | (i & 3)];
      const x = (A + F + MD5_K[i] + w[blk + g]) | 0;
      A = D; D = C; C = B;
      B = (B + ((x << s) | (x >>> (32 - s)))) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  const out = new Uint8Array(16);
  [a0, b0, c0, d0].forEach((v, i) => { out[i * 4] = v & 255; out[i * 4 + 1] = (v >>> 8) & 255; out[i * 4 + 2] = (v >>> 16) & 255; out[i * 4 + 3] = (v >>> 24) & 255; });
  return out;
}

// =====================================================================================
// RC4
// =====================================================================================
export function rc4(key, data) {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 255;
    const t = S[i]; S[i] = S[j]; S[j] = t;
  }
  const out = new Uint8Array(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255;
    j = (j + S[i]) & 255;
    const t = S[i]; S[i] = S[j]; S[j] = t;
    out[k] = data[k] ^ S[(S[i] + S[j]) & 255];
  }
  return out;
}

// =====================================================================================
// SHA-2 (constants derived with BigInt at load time – no hand-typed tables)
// =====================================================================================
const PRIMES = (() => { const p = []; for (let n = 2; p.length < 80; n++) if (p.every(q => n % q)) p.push(n); return p; })();
function iroot(n, k) { // floor(n^(1/k)) for BigInt n
  let x = BigInt(Math.ceil(Math.pow(Number(n), 1 / k) * 1.001)) + 2n; // overestimate → Newton descends
  for (;;) {
    const y = ((BigInt(k) - 1n) * x + n / (x ** (BigInt(k) - 1n))) / BigInt(k);
    if (y >= x) break;
    x = y;
  }
  while (x ** BigInt(k) > n) x -= 1n;
  return x;
}
const frac64 = (p, k) => iroot(BigInt(p) << BigInt(64 * k), k) & 0xffffffffffffffffn;
const K512 = new Int32Array(160);
PRIMES.forEach((p, i) => { const v = frac64(p, 3); K512[2 * i] = Number(v >> 32n) | 0; K512[2 * i + 1] = Number(v & 0xffffffffn) | 0; });
const IV512 = new Int32Array(16), IV384 = new Int32Array(16);
for (let i = 0; i < 8; i++) {
  const a = frac64(PRIMES[i], 2), b = frac64(PRIMES[i + 8], 2);
  IV512[2 * i] = Number(a >> 32n) | 0; IV512[2 * i + 1] = Number(a & 0xffffffffn) | 0;
  IV384[2 * i] = Number(b >> 32n) | 0; IV384[2 * i + 1] = Number(b & 0xffffffffn) | 0;
}
const K256 = new Int32Array(64).map((_, i) => K512[2 * i]);
const IV256 = new Int32Array(8).map((_, i) => IV512[2 * i]);

function padMessage(msg, blockLen, lenBytes) {
  const len = msg.length;
  const total = Math.ceil((len + 1 + lenBytes) / blockLen) * blockLen;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  const bits = len * 8;
  dv.setUint32(total - 4, bits >>> 0);
  dv.setUint32(total - 8, Math.floor(bits / 0x100000000));
  return { buf, dv };
}

export function sha256(msg) {
  const { buf, dv } = padMessage(msg, 64, 8);
  const H = IV256.slice();
  const W = new Int32Array(64);
  for (let off = 0; off < buf.length; off += 64) {
    for (let t = 0; t < 16; t++) W[t] = dv.getInt32(off + t * 4);
    for (let t = 16; t < 64; t++) {
      const x = W[t - 15], y = W[t - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      W[t] = (W[t - 16] + s0 + W[t - 7] + s1) | 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[t] + W[t]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setInt32(i * 4, H[i]);
  return out;
}

function sha512Core(msg, iv, outLen) {
  const { buf, dv } = padMessage(msg, 128, 16);
  const H = iv.slice();
  const W = new Int32Array(160);
  for (let off = 0; off < buf.length; off += 128) {
    for (let t = 0; t < 32; t++) W[t] = dv.getInt32(off + t * 4);
    for (let t = 16; t < 80; t++) {
      // sigma0(W[t-15]) = rotr1 ^ rotr8 ^ shr7
      let xh = W[2 * (t - 15)], xl = W[2 * (t - 15) + 1];
      const s0h = ((xh >>> 1) | (xl << 31)) ^ ((xh >>> 8) | (xl << 24)) ^ (xh >>> 7);
      const s0l = ((xl >>> 1) | (xh << 31)) ^ ((xl >>> 8) | (xh << 24)) ^ ((xl >>> 7) | (xh << 25));
      // sigma1(W[t-2]) = rotr19 ^ rotr61 ^ shr6
      xh = W[2 * (t - 2)]; xl = W[2 * (t - 2) + 1];
      const s1h = ((xh >>> 19) | (xl << 13)) ^ ((xl >>> 29) | (xh << 3)) ^ (xh >>> 6);
      const s1l = ((xl >>> 19) | (xh << 13)) ^ ((xh >>> 29) | (xl << 3)) ^ ((xl >>> 6) | (xh << 26));
      const lo = (s1l >>> 0) + (W[2 * (t - 7) + 1] >>> 0) + (s0l >>> 0) + (W[2 * (t - 16) + 1] >>> 0);
      W[2 * t] = (s1h + W[2 * (t - 7)] + s0h + W[2 * (t - 16)] + Math.floor(lo / 0x100000000)) | 0;
      W[2 * t + 1] = lo | 0;
    }
    let ah = H[0], al = H[1], bh = H[2], bl = H[3], ch = H[4], cl = H[5], dh = H[6], dl = H[7];
    let eh = H[8], el = H[9], fh = H[10], fl = H[11], gh = H[12], gl = H[13], hh = H[14], hl = H[15];
    for (let t = 0; t < 80; t++) {
      // Sigma1(e) = rotr14 ^ rotr18 ^ rotr41
      const S1h = ((eh >>> 14) | (el << 18)) ^ ((eh >>> 18) | (el << 14)) ^ ((el >>> 9) | (eh << 23));
      const S1l = ((el >>> 14) | (eh << 18)) ^ ((el >>> 18) | (eh << 14)) ^ ((eh >>> 9) | (el << 23));
      const chh = (eh & fh) ^ (~eh & gh), chl = (el & fl) ^ (~el & gl);
      const t1lo = (hl >>> 0) + (S1l >>> 0) + (chl >>> 0) + (K512[2 * t + 1] >>> 0) + (W[2 * t + 1] >>> 0);
      const t1h = (hh + S1h + chh + K512[2 * t] + W[2 * t] + Math.floor(t1lo / 0x100000000)) | 0;
      const t1l = t1lo | 0;
      // Sigma0(a) = rotr28 ^ rotr34 ^ rotr39
      const S0h = ((ah >>> 28) | (al << 4)) ^ ((al >>> 2) | (ah << 30)) ^ ((al >>> 7) | (ah << 25));
      const S0l = ((al >>> 28) | (ah << 4)) ^ ((ah >>> 2) | (al << 30)) ^ ((ah >>> 7) | (al << 25));
      const mjh = (ah & bh) ^ (ah & ch) ^ (bh & ch), mjl = (al & bl) ^ (al & cl) ^ (bl & cl);
      const t2lo = (S0l >>> 0) + (mjl >>> 0);
      const t2h = (S0h + mjh + Math.floor(t2lo / 0x100000000)) | 0;
      const t2l = t2lo | 0;
      hh = gh; hl = gl; gh = fh; gl = fl; fh = eh; fl = el;
      const elo = (dl >>> 0) + (t1l >>> 0);
      eh = (dh + t1h + Math.floor(elo / 0x100000000)) | 0; el = elo | 0;
      dh = ch; dl = cl; ch = bh; cl = bl; bh = ah; bl = al;
      const alo = (t1l >>> 0) + (t2l >>> 0);
      ah = (t1h + t2h + Math.floor(alo / 0x100000000)) | 0; al = alo | 0;
    }
    const v = [ah, al, bh, bl, ch, cl, dh, dl, eh, el, fh, fl, gh, gl, hh, hl];
    for (let i = 0; i < 16; i += 2) {
      const lo = (H[i + 1] >>> 0) + (v[i + 1] >>> 0);
      H[i] = (H[i] + v[i] + Math.floor(lo / 0x100000000)) | 0;
      H[i + 1] = lo | 0;
    }
  }
  const out = new Uint8Array(64);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 16; i++) odv.setInt32(i * 4, H[i]);
  return out.slice(0, outLen);
}
export const sha512 = msg => sha512Core(msg, IV512, 64);
export const sha384 = msg => sha512Core(msg, IV384, 48);

// =====================================================================================
// AES (table based, encrypt + decrypt, 128/192/256 bit keys)
// =====================================================================================
const SBOX = new Uint8Array(256), INV_SBOX = new Uint8Array(256);
const Te = [new Int32Array(256), new Int32Array(256), new Int32Array(256), new Int32Array(256)];
const Td = [new Int32Array(256), new Int32Array(256), new Int32Array(256), new Int32Array(256)];
(() => {
  const xt = x => ((x << 1) ^ (x & 0x80 ? 0x11b : 0)) & 0xff;
  const mul = (a, b) => { let r = 0; while (b) { if (b & 1) r ^= a; a = xt(a); b >>= 1; } return r; };
  const rotl8 = (x, s) => ((x << s) | (x >> (8 - s))) & 0xff;
  let p = 1, q = 1;
  do {
    p = p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0);
    q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff; if (q & 0x80) q ^= 0x09;
    SBOX[p] = (q ^ rotl8(q, 1) ^ rotl8(q, 2) ^ rotl8(q, 3) ^ rotl8(q, 4) ^ 0x63) & 0xff;
  } while (p !== 1);
  SBOX[0] = 0x63;
  for (let i = 0; i < 256; i++) INV_SBOX[SBOX[i]] = i;
  for (let i = 0; i < 256; i++) {
    const s = SBOX[i], si = INV_SBOX[i];
    const e = (mul(s, 2) << 24) | (s << 16) | (s << 8) | mul(s, 3);
    const d = (mul(si, 14) << 24) | (mul(si, 9) << 16) | (mul(si, 13) << 8) | mul(si, 11);
    for (let k = 0; k < 4; k++) {
      Te[k][i] = k ? (e >>> (8 * k)) | (e << (32 - 8 * k)) : e;
      Td[k][i] = k ? (d >>> (8 * k)) | (d << (32 - 8 * k)) : d;
    }
  }
})();

export class AES {
  constructor(key) {
    const Nk = key.length / 4;
    if (![4, 6, 8].includes(Nk)) throw new Error('AES: ungültige Schlüssellänge');
    const Nr = Nk + 6;
    const W = new Int32Array(4 * (Nr + 1));
    const dv = new DataView(key.buffer, key.byteOffset, key.byteLength);
    for (let i = 0; i < Nk; i++) W[i] = dv.getInt32(i * 4);
    let rcon = 1;
    for (let i = Nk; i < W.length; i++) {
      let t = W[i - 1];
      if (i % Nk === 0) {
        t = (t << 8) | (t >>> 24);
        t = (SBOX[t >>> 24] << 24) | (SBOX[(t >>> 16) & 255] << 16) | (SBOX[(t >>> 8) & 255] << 8) | SBOX[t & 255];
        t ^= rcon << 24;
        rcon = ((rcon << 1) ^ (rcon & 0x80 ? 0x11b : 0)) & 0xff;
      } else if (Nk > 6 && i % Nk === 4) {
        t = (SBOX[t >>> 24] << 24) | (SBOX[(t >>> 16) & 255] << 16) | (SBOX[(t >>> 8) & 255] << 8) | SBOX[t & 255];
      }
      W[i] = W[i - Nk] ^ t;
    }
    const D = new Int32Array(W.length);
    for (let r = 0; r <= Nr; r++) {
      for (let c = 0; c < 4; c++) {
        let w = W[4 * (Nr - r) + c];
        if (r > 0 && r < Nr) w = Td[0][SBOX[w >>> 24]] ^ Td[1][SBOX[(w >>> 16) & 255]] ^ Td[2][SBOX[(w >>> 8) & 255]] ^ Td[3][SBOX[w & 255]];
        D[4 * r + c] = w;
      }
    }
    this.Nr = Nr; this.W = W; this.D = D;
  }
  // in/out: Int32Array(4) big-endian words
  encryptWords(s) {
    const W = this.W, Nr = this.Nr, [T0, T1, T2, T3] = Te;
    let s0 = s[0] ^ W[0], s1 = s[1] ^ W[1], s2 = s[2] ^ W[2], s3 = s[3] ^ W[3];
    let k = 4;
    for (let r = 1; r < Nr; r++) {
      const t0 = T0[s0 >>> 24] ^ T1[(s1 >>> 16) & 255] ^ T2[(s2 >>> 8) & 255] ^ T3[s3 & 255] ^ W[k];
      const t1 = T0[s1 >>> 24] ^ T1[(s2 >>> 16) & 255] ^ T2[(s3 >>> 8) & 255] ^ T3[s0 & 255] ^ W[k + 1];
      const t2 = T0[s2 >>> 24] ^ T1[(s3 >>> 16) & 255] ^ T2[(s0 >>> 8) & 255] ^ T3[s1 & 255] ^ W[k + 2];
      const t3 = T0[s3 >>> 24] ^ T1[(s0 >>> 16) & 255] ^ T2[(s1 >>> 8) & 255] ^ T3[s2 & 255] ^ W[k + 3];
      s0 = t0; s1 = t1; s2 = t2; s3 = t3; k += 4;
    }
    const S = SBOX;
    s[0] = ((S[s0 >>> 24] << 24) | (S[(s1 >>> 16) & 255] << 16) | (S[(s2 >>> 8) & 255] << 8) | S[s3 & 255]) ^ W[k];
    s[1] = ((S[s1 >>> 24] << 24) | (S[(s2 >>> 16) & 255] << 16) | (S[(s3 >>> 8) & 255] << 8) | S[s0 & 255]) ^ W[k + 1];
    s[2] = ((S[s2 >>> 24] << 24) | (S[(s3 >>> 16) & 255] << 16) | (S[(s0 >>> 8) & 255] << 8) | S[s1 & 255]) ^ W[k + 2];
    s[3] = ((S[s3 >>> 24] << 24) | (S[(s0 >>> 16) & 255] << 16) | (S[(s1 >>> 8) & 255] << 8) | S[s2 & 255]) ^ W[k + 3];
  }
  decryptWords(s) {
    const D = this.D, Nr = this.Nr, [T0, T1, T2, T3] = Td;
    let s0 = s[0] ^ D[0], s1 = s[1] ^ D[1], s2 = s[2] ^ D[2], s3 = s[3] ^ D[3];
    let k = 4;
    for (let r = 1; r < Nr; r++) {
      const t0 = T0[s0 >>> 24] ^ T1[(s3 >>> 16) & 255] ^ T2[(s2 >>> 8) & 255] ^ T3[s1 & 255] ^ D[k];
      const t1 = T0[s1 >>> 24] ^ T1[(s0 >>> 16) & 255] ^ T2[(s3 >>> 8) & 255] ^ T3[s2 & 255] ^ D[k + 1];
      const t2 = T0[s2 >>> 24] ^ T1[(s1 >>> 16) & 255] ^ T2[(s0 >>> 8) & 255] ^ T3[s3 & 255] ^ D[k + 2];
      const t3 = T0[s3 >>> 24] ^ T1[(s2 >>> 16) & 255] ^ T2[(s1 >>> 8) & 255] ^ T3[s0 & 255] ^ D[k + 3];
      s0 = t0; s1 = t1; s2 = t2; s3 = t3; k += 4;
    }
    const S = INV_SBOX;
    s[0] = ((S[s0 >>> 24] << 24) | (S[(s3 >>> 16) & 255] << 16) | (S[(s2 >>> 8) & 255] << 8) | S[s1 & 255]) ^ D[k];
    s[1] = ((S[s1 >>> 24] << 24) | (S[(s0 >>> 16) & 255] << 16) | (S[(s3 >>> 8) & 255] << 8) | S[s2 & 255]) ^ D[k + 1];
    s[2] = ((S[s2 >>> 24] << 24) | (S[(s1 >>> 16) & 255] << 16) | (S[(s0 >>> 8) & 255] << 8) | S[s3 & 255]) ^ D[k + 2];
    s[3] = ((S[s3 >>> 24] << 24) | (S[(s2 >>> 16) & 255] << 16) | (S[(s1 >>> 8) & 255] << 8) | S[s0 & 255]) ^ D[k + 3];
  }
  /** CBC encrypt; data length must be a multiple of 16 (no padding added). */
  cbcEncrypt(iv, data) {
    const out = new Uint8Array(data.length);
    const din = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const dout = new DataView(out.buffer);
    const ivv = new DataView(iv.buffer, iv.byteOffset, 16);
    const s = new Int32Array(4);
    let p0 = ivv.getInt32(0), p1 = ivv.getInt32(4), p2 = ivv.getInt32(8), p3 = ivv.getInt32(12);
    for (let o = 0; o < data.length; o += 16) {
      s[0] = din.getInt32(o) ^ p0; s[1] = din.getInt32(o + 4) ^ p1; s[2] = din.getInt32(o + 8) ^ p2; s[3] = din.getInt32(o + 12) ^ p3;
      this.encryptWords(s);
      p0 = s[0]; p1 = s[1]; p2 = s[2]; p3 = s[3];
      dout.setInt32(o, p0); dout.setInt32(o + 4, p1); dout.setInt32(o + 8, p2); dout.setInt32(o + 12, p3);
    }
    return out;
  }
  /** CBC decrypt; data length must be a multiple of 16 (padding is NOT removed). */
  cbcDecrypt(iv, data) {
    const out = new Uint8Array(data.length);
    const din = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const dout = new DataView(out.buffer);
    const ivv = new DataView(iv.buffer, iv.byteOffset, 16);
    const s = new Int32Array(4);
    let p0 = ivv.getInt32(0), p1 = ivv.getInt32(4), p2 = ivv.getInt32(8), p3 = ivv.getInt32(12);
    for (let o = 0; o + 16 <= data.length; o += 16) {
      const c0 = din.getInt32(o), c1 = din.getInt32(o + 4), c2 = din.getInt32(o + 8), c3 = din.getInt32(o + 12);
      s[0] = c0; s[1] = c1; s[2] = c2; s[3] = c3;
      this.decryptWords(s);
      dout.setInt32(o, s[0] ^ p0); dout.setInt32(o + 4, s[1] ^ p1); dout.setInt32(o + 8, s[2] ^ p2); dout.setInt32(o + 12, s[3] ^ p3);
      p0 = c0; p1 = c1; p2 = c2; p3 = c3;
    }
    return out;
  }
  ecbEncrypt(data) {
    return this.cbcEncrypt(new Uint8Array(16), data); // single block: CBC with zero IV == ECB
  }
}

function pkcs7Pad(data) {
  const n = 16 - (data.length % 16);
  const out = new Uint8Array(data.length + n);
  out.set(data);
  out.fill(n, data.length);
  return out;
}
function pkcs7Unpad(data) {
  if (!data.length) return data;
  const n = data[data.length - 1];
  if (n < 1 || n > 16 || n > data.length) return data;
  for (let i = data.length - n; i < data.length; i++) if (data[i] !== n) return data;
  return data.subarray(0, data.length - n);
}

const subtle = globalThis.crypto && globalThis.crypto.subtle;
const BIG = 4096; // use WebCrypto for payloads above this size

/** AES-CBC encrypt with random IV + PKCS#7 → IV || ciphertext (PDF string/stream format). */
async function aesEncryptPdf(key, data, aesObj) {
  const iv = randomBytes(16);
  if (subtle && data.length > BIG) {
    try {
      const k = await subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['encrypt']);
      const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv }, k, data));
      return concat(iv, ct);
    } catch { /* fall back to JS */ }
  }
  return concat(iv, (aesObj || new AES(key)).cbcEncrypt(iv, pkcs7Pad(data)));
}

/** Decrypt IV || ciphertext (PDF format) → plaintext. Tolerates bad padding/lengths. */
async function aesDecryptPdf(key, data, aesObj) {
  if (data.length < 16) return new Uint8Array(0);
  const iv = data.slice(0, 16);
  let ct = data.subarray(16);
  if (ct.length % 16) ct = ct.subarray(0, ct.length - (ct.length % 16));
  if (!ct.length) return new Uint8Array(0);
  if (subtle && ct.length > BIG) {
    try {
      const k = await subtle.importKey('raw', key, { name: 'AES-CBC' }, false, ['decrypt']);
      return new Uint8Array(await subtle.decrypt({ name: 'AES-CBC', iv }, k, ct));
    } catch { /* invalid padding etc. → JS path */ }
  }
  return pkcs7Unpad((aesObj || new AES(key)).cbcDecrypt(iv, ct));
}

// =====================================================================================
// Standard Security Handler – key derivation
// =====================================================================================
const PAD = Uint8Array.from([0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41, 0x64, 0x00, 0x4E, 0x56, 0xFF, 0xFA, 0x01, 0x08,
  0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80, 0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A]);

function latin1Password(pw) {
  const s = String(pw || '');
  const out = new Uint8Array(Math.min(32, s.length));
  for (let i = 0; i < out.length; i++) { const c = s.charCodeAt(i); out[i] = c < 256 ? c : 0x3f; }
  return out;
}
function padPassword(pw) {
  const b = latin1Password(pw);
  return concat(b, PAD.subarray(0, 32 - b.length));
}
function utf8Password(pw) {
  let s = String(pw || '');
  try { s = s.normalize('NFKC'); } catch {}
  const b = enc.encode(s);
  return b.length > 127 ? b.slice(0, 127) : b;
}

/** Algorithm 2.B (ISO 32000-2) – hash for R6; for R5 just SHA-256. */
function hash2B(pw, salt, udata, rev) {
  let K = sha256(concat(pw, salt, udata));
  if (rev < 6) return K;
  let i = 0;
  for (;;) {
    const unit = concat(pw, K, udata);
    const K1 = new Uint8Array(unit.length * 64);
    for (let j = 0; j < 64; j++) K1.set(unit, j * unit.length);
    const E = new AES(K.slice(0, 16)).cbcEncrypt(K.slice(16, 32), K1);
    let sum = 0;
    for (let j = 0; j < 16; j++) sum += E[j];
    const m = sum % 3;
    K = m === 0 ? sha256(E) : m === 1 ? sha384(E) : sha512(E);
    i++;
    if (i >= 64 && E[E.length - 1] <= i - 32) break;
  }
  return K.slice(0, 32);
}

function computeKeyR4(pwPadded, O, P, id0, rev, keyLen, encryptMetadata) {
  const p = new Uint8Array(4);
  new DataView(p.buffer).setInt32(0, P, true);
  const parts = [pwPadded, O.subarray(0, 32), p, id0];
  if (rev >= 4 && !encryptMetadata) parts.push(Uint8Array.from([255, 255, 255, 255]));
  let h = md5(concat(...parts));
  if (rev >= 3) for (let i = 0; i < 50; i++) h = md5(h.subarray(0, keyLen));
  return h.slice(0, keyLen);
}

function checkUserR4(key, U, id0, rev) {
  if (rev === 2) return equalBytes(rc4(key, PAD), U, 32);
  let x = rc4(key, md5(concat(PAD, id0)));
  for (let i = 1; i <= 19; i++) x = rc4(key.map(b => b ^ i), x);
  return equalBytes(x, U, 16);
}

function ownerToUserR4(ownerPw, O, rev, keyLen) {
  let h = md5(padPassword(ownerPw));
  if (rev >= 3) for (let i = 0; i < 50; i++) h = md5(h);
  const key = h.slice(0, rev === 2 ? 5 : keyLen);
  let x = O.slice(0, 32);
  if (rev === 2) x = rc4(key, x);
  else for (let i = 19; i >= 0; i--) x = rc4(key.map(b => b ^ i), x);
  return x; // padded user password bytes
}

function deriveKeyAES256(pwStr, enc) {
  const pw = utf8Password(pwStr);
  const { O, U, OE, UE, R } = enc;
  // owner password?
  if (O.length >= 48 && U.length >= 48) {
    const u48 = U.subarray(0, 48);
    if (equalBytes(hash2B(pw, O.subarray(32, 40), u48, R), O, 32)) {
      const ik = hash2B(pw, O.subarray(40, 48), u48, R);
      return { key: new AES(ik).cbcDecrypt(new Uint8Array(16), OE.subarray(0, 32)), owner: true };
    }
    if (equalBytes(hash2B(pw, U.subarray(32, 40), new Uint8Array(0), R), U, 32)) {
      const ik = hash2B(pw, U.subarray(40, 48), new Uint8Array(0), R);
      return { key: new AES(ik).cbcDecrypt(new Uint8Array(16), UE.subarray(0, 32)), owner: false };
    }
  }
  return null;
}

// =====================================================================================
// Reading the /Encrypt dictionary (pdf-lib objects)
// =====================================================================================
function readEncrypt(PDFLib, context, encDict, idArray) {
  const { PDFName, PDFNumber, PDFString, PDFHexString, PDFBool, PDFDict } = PDFLib;
  const get = k => encDict.lookup(PDFName.of(k));
  const num = (k, d) => { const v = get(k); return v instanceof PDFNumber ? v.asNumber() : d; };
  const bytes = k => { const v = get(k); return v instanceof PDFString || v instanceof PDFHexString ? v.asBytes() : new Uint8Array(0); };
  const name = (v, d) => (v instanceof PDFName ? v.decodeText() : d);
  const filter = name(get('Filter'), 'Standard');
  if (filter !== 'Standard') return { unsupported: `Sicherheits-Handler „${filter}“` };
  const V = num('V', 0), R = num('R', 2);
  const emv = get('EncryptMetadata');
  const info = {
    V, R, O: bytes('O'), U: bytes('U'), OE: bytes('OE'), UE: bytes('UE'), P: num('P', -4) | 0,
    encryptMetadata: !(emv instanceof PDFBool) || emv.asBoolean(),
    keyLen: Math.max(5, Math.min(16, Math.floor(num('Length', 40) / 8))),
    stm: 'RC4', str: 'RC4', id0: new Uint8Array(0),
  };
  if (idArray && idArray.size && idArray.size() > 0) {
    const first = idArray.lookup ? idArray.lookup(0) : null;
    if (first && first.asBytes) info.id0 = first.asBytes();
  }
  if (V === 1) info.keyLen = 5;
  if (V >= 4) {
    const cf = get('CF');
    const method = fname => {
      if (!fname || fname === 'Identity') return 'Identity';
      const d = cf instanceof PDFDict ? cf.lookup(PDFName.of(fname)) : null;
      if (!(d instanceof PDFDict)) return 'Identity';
      const cfm = name(d.lookup(PDFName.of('CFM')), 'None');
      const len = d.lookup(PDFName.of('Length'));
      if (len instanceof PDFNumber && V === 4) { const L = len.asNumber(); info.keyLen = L > 32 ? L / 8 : L; info.keyLen = Math.max(5, Math.min(16, info.keyLen)); }
      return cfm === 'AESV2' ? 'AESV2' : cfm === 'AESV3' ? 'AESV3' : cfm === 'V2' ? 'RC4' : 'Identity';
    };
    info.stm = method(name(get('StmF'), 'Identity'));
    info.str = method(name(get('StrF'), 'Identity'));
    if (V === 4 && (info.stm === 'AESV2' || info.str === 'AESV2')) info.keyLen = 16;
  }
  if (V === 5) { info.keyLen = 32; }
  return info;
}

/** Try a password; returns {key, owner} or null. */
function authenticate(info, password) {
  if (info.V === 5 || info.R >= 5) return deriveKeyAES256(password, info);
  // R2–R4: as owner password …
  const derived = ownerToUserR4(password, info.O, info.R, info.keyLen);
  let key = computeKeyR4(derived, info.O, info.P, info.id0, info.R, info.keyLen, info.encryptMetadata);
  if (checkUserR4(key, info.U, info.id0, info.R)) return { key, owner: true };
  // … or as user password
  key = computeKeyR4(padPassword(password), info.O, info.P, info.id0, info.R, info.keyLen, info.encryptMetadata);
  if (checkUserR4(key, info.U, info.id0, info.R)) return { key, owner: false };
  return null;
}

function objectKey(fileKey, ref, aes) {
  const n = ref.objectNumber, g = ref.generationNumber;
  const extra = Uint8Array.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, g & 255, (g >> 8) & 255]);
  const parts = aes ? concat(fileKey, extra, Uint8Array.from([0x73, 0x41, 0x6c, 0x54])) : concat(fileKey, extra);
  return md5(parts).slice(0, Math.min(fileKey.length + 5, 16));
}

function makeCipher(info, fileKey) {
  const keyCache = new Map();
  const aes256 = info.V === 5 ? new AES(fileKey) : null;
  const keyFor = (ref, aes) => {
    const id = `${ref.objectNumber}/${ref.generationNumber}/${aes ? 1 : 0}`;
    let k = keyCache.get(id);
    if (!k) { k = objectKey(fileKey, ref, aes); keyCache.set(id, k); if (keyCache.size > 5000) keyCache.clear(); }
    return k;
  };
  const run = async (method, data, ref) => {
    if (method === 'Identity') return data;
    if (method === 'AESV3') return aesDecryptPdf(fileKey, data, aes256);
    if (method === 'AESV2') return aesDecryptPdf(keyFor(ref, true), data);
    return rc4(keyFor(ref, false), data);
  };
  return {
    string: (data, ref) => run(info.str, data, ref),
    stream: (data, ref) => run(info.stm, data, ref),
  };
}

// =====================================================================================
// Walking pdf-lib objects
// =====================================================================================
async function transformStrings(PDFLib, obj, fn, skipContents = false) {
  const { PDFString, PDFHexString, PDFDict, PDFArray, PDFName, PDFStream } = PDFLib;
  if (obj instanceof PDFString || obj instanceof PDFHexString) {
    return PDFHexString.of(toHex(await fn(obj.asBytes())));
  }
  if (obj instanceof PDFDict) {
    const isSig = skipContents || (() => { const t = obj.lookup(PDFName.of('Type')); return t === PDFName.of('Sig') || t === PDFName.of('DocTimeStamp'); })();
    for (const [k, v] of obj.entries()) {
      if (isSig && k === PDFName.of('Contents')) continue;
      const nv = await transformStrings(PDFLib, v, fn);
      if (nv !== v) obj.set(k, nv);
    }
    return obj;
  }
  if (obj instanceof PDFArray) {
    for (let i = 0; i < obj.size(); i++) {
      const v = obj.get(i);
      const nv = await transformStrings(PDFLib, v, fn);
      if (nv !== v) obj.set(i, nv);
    }
    return obj;
  }
  if (obj instanceof PDFStream) { await transformStrings(PDFLib, obj.dict, fn); return obj; }
  return obj;
}

function isType(PDFLib, dict, type) {
  const t = dict.lookup(PDFLib.PDFName.of('Type'));
  return t === PDFLib.PDFName.of(type);
}

// Serialise parser monkey-patching (pdf-lib's object stream parser is a shared static).
let parseLock = Promise.resolve();

/**
 * Parse PDF bytes with pdf-lib while deferring object streams, so encrypted files can be decrypted.
 * @returns {Promise<{context, deferred, seqOf}>}
 */
async function parseDeferred(PDFLib, bytes) {
  const { PDFParser, PDFObjectStreamParser } = PDFLib;
  const parser = PDFParser.forBytesWithOptions(bytes, 400, false, false);
  const deferred = [];
  const seqOf = new Map();
  let seq = 0;
  let currentRef = null;
  const origHeader = parser.parseIndirectObjectHeader;
  parser.parseIndirectObjectHeader = function () { currentRef = origHeader.call(this); return currentRef; };
  const ctx = parser.context;
  const origAssign = ctx.assign.bind(ctx);
  ctx.assign = (ref, obj) => { seqOf.set(ref.tag, ++seq); origAssign(ref, obj); };
  const origForStream = PDFObjectStreamParser.forStream;
  let release;
  const prev = parseLock;
  parseLock = new Promise(r => { release = r; });
  await prev;
  PDFObjectStreamParser.forStream = (stream) => ({ parseIntoContext: async () => { deferred.push({ ref: currentRef, stream, seq: ++seq }); } });
  try {
    await parser.parseDocument();
  } finally {
    PDFObjectStreamParser.forStream = origForStream;
    ctx.assign = origAssign;
    release();
  }
  return { context: ctx, deferred, seqOf, origForStream };
}

async function expandObjectStreams(PDFLib, parsed, decryptStream) {
  const { PDFRawStream, PDFObjectStreamParser } = PDFLib;
  const { context, deferred, seqOf } = parsed;
  for (const d of deferred) {
    let stream = d.stream;
    if (decryptStream) stream = PDFRawStream.of(stream.dict, await decryptStream(stream.contents, d.ref));
    const origAssign = context.assign;
    // Objects defined later in the file (incremental updates) win over object-stream copies.
    context.assign = (ref, obj) => {
      const s = seqOf.get(ref.tag);
      if (s !== undefined && s > d.seq) return;
      seqOf.set(ref.tag, d.seq);
      origAssign.call(context, ref, obj);
    };
    try {
      await PDFObjectStreamParser.forStream(stream, false).parseIntoContext();
    } catch (e) {
      console.warn('Objektstream konnte nicht gelesen werden', e);
    } finally {
      context.assign = origAssign;
    }
  }
}

export class PasswordRequiredError extends Error {
  constructor(wrong) { super(wrong ? 'Falsches Passwort' : 'Passwort erforderlich'); this.name = 'PasswordRequiredError'; this.wrong = wrong; }
}

/**
 * Load (and if needed decrypt) a PDF into a pdf-lib PDFDocument.
 * @param {object} PDFLib  pdf-lib namespace
 * @param {Uint8Array} bytes
 * @param {object} opts
 * @param {string[]} [opts.passwords]  passwords to try (the empty password is always tried first)
 * @param {(wrong:boolean)=>Promise<string|null>} [opts.askPassword]  interactive prompt
 * @returns {Promise<{pdfDoc, encrypted:boolean, password:string|null, info:object|null}>}
 */
export async function loadDecrypted(PDFLib, bytes, { passwords = [], askPassword = null, updateMetadata = false } = {}) {
  const parsed = await parseDeferred(PDFLib, bytes);
  const { context } = parsed;
  const encRef = context.trailerInfo.Encrypt;
  const encDict = encRef ? context.lookup(encRef) : null;
  if (!encDict) {
    await expandObjectStreams(PDFLib, parsed, null);
    const pdfDoc = new PDFLib.PDFDocument(context, true, updateMetadata);
    return { pdfDoc, encrypted: false, password: null, info: null };
  }
  const idArr = context.lookup(context.trailerInfo.ID);
  const info = readEncrypt(PDFLib, context, encDict, idArr);
  if (info.unsupported) {
    const err = new Error('unsupported');
    err.userMessage = `Diese PDF nutzt eine nicht unterstützte Verschlüsselung (${info.unsupported}).`;
    throw err;
  }
  let auth = null, used = null;
  // explicit passwords first (they may be the owner password), then the empty user password
  for (const pw of [...passwords.filter(p => p != null && p !== ''), '']) {
    auth = authenticate(info, pw);
    if (auth) { used = pw; break; }
  }
  let wrong = passwords.some(p => p);
  while (!auth) {
    if (!askPassword) throw new PasswordRequiredError(wrong);
    const pw = await askPassword(wrong);
    if (pw == null) throw new PasswordRequiredError(false);
    auth = authenticate(info, pw);
    if (auth) used = pw;
    wrong = true;
    await new Promise(r => setTimeout(r, 0));
  }
  const fileKey = auth.key;
  const cipher = makeCipher(info, fileKey);
  const { PDFRawStream, PDFName, PDFArray } = PDFLib;
  const encTag = encRef && encRef.tag;
  let n = 0;
  for (const [ref, obj] of context.enumerateIndirectObjects()) {
    if (ref.tag === encTag) continue;
    if (obj instanceof PDFRawStream) {
      const meta = isType(PDFLib, obj.dict, 'Metadata');
      const filter = obj.dict.lookup(PDFName.of('Filter'));
      let identityCrypt = false;
      if (filter instanceof PDFArray && filter.size() && filter.lookup(0) === PDFName.of('Crypt')) identityCrypt = true;
      await transformStrings(PDFLib, obj.dict, b => cipher.string(b, ref));
      if (!(meta && !info.encryptMetadata) && !identityCrypt && !isType(PDFLib, obj.dict, 'XRef')) {
        context.assign(ref, PDFRawStream.of(obj.dict, await cipher.stream(obj.contents, ref)));
      }
    } else {
      await transformStrings(PDFLib, obj, b => cipher.string(b, ref));
    }
    if (++n % 300 === 0) await new Promise(r => setTimeout(r, 0));
  }
  await expandObjectStreams(PDFLib, parsed, (data, ref) => cipher.stream(data, ref));
  if (encRef) { try { context.delete(encRef); } catch {} }
  context.trailerInfo.Encrypt = undefined;
  const pdfDoc = new PDFLib.PDFDocument(context, true, updateMetadata);
  return { pdfDoc, encrypted: true, password: used, info: { V: info.V, R: info.R, method: info.stm, P: info.P, owner: auth.owner, restricted: isRestricted(info.P) } };
}

/** Quick check whether bytes describe an encrypted PDF (and whether a password is needed). */
export async function inspectEncryption(PDFLib, bytes) {
  const parsed = await parseDeferred(PDFLib, bytes);
  const { context } = parsed;
  const encDict = context.trailerInfo.Encrypt ? context.lookup(context.trailerInfo.Encrypt) : null;
  if (!encDict) return { encrypted: false };
  const info = readEncrypt(PDFLib, context, encDict, context.lookup(context.trailerInfo.ID));
  if (info.unsupported) return { encrypted: true, unsupported: info.unsupported };
  const openWithoutPassword = !!authenticate(info, '');
  return { encrypted: true, needsPassword: !openWithoutPassword, V: info.V, R: info.R, method: info.stm, P: info.P, restricted: isRestricted(info.P), label: methodLabel(info) };
}

/** true when printing, copying or changing is not allowed. */
export function isRestricted(P) {
  const need = PERM.print | PERM.modify | PERM.copy | PERM.annotate;
  return (P & need) !== need;
}

function methodLabel(info) {
  if (info.V === 5) return 'AES-256';
  if (info.stm === 'AESV2') return 'AES-128';
  return info.keyLen <= 5 ? 'RC4 40 Bit' : `RC4 ${info.keyLen * 8} Bit`;
}

// =====================================================================================
// Encryption (AES-256, V5/R6)
// =====================================================================================
export const PERM = { print: 1 << 2, modify: 1 << 3, copy: 1 << 4, annotate: 1 << 5, fillForms: 1 << 8, accessibility: 1 << 9, assemble: 1 << 10, printHigh: 1 << 11 };

/** Build the /P value from flags. */
export function permissionsValue({ printing = true, copying = true, editing = true } = {}) {
  let p = 0xFFFFF0C0 | 0; // bits 7,8 and 13–32 set (reserved), all permissions cleared
  if (printing) p |= PERM.print | PERM.printHigh;
  if (copying) p |= PERM.copy | PERM.accessibility;
  else p |= PERM.accessibility; // keep screen readers working
  if (editing) p |= PERM.modify | PERM.annotate | PERM.fillForms | PERM.assemble;
  return p | 0;
}

/**
 * Encrypt a pdf-lib document in place with AES-256 (Standard Security Handler V5/R6).
 * Call right before `pdfDoc.save({ useObjectStreams: false, updateFieldAppearances: false })`.
 */
export async function encryptDocument(PDFLib, pdfDoc, { userPassword = '', ownerPassword = '', permissions = {}, onProgress } = {}) {
  const { PDFRawStream, PDFStream, PDFName, PDFHexString, PDFDict, PDFHeader } = PDFLib;
  const context = pdfDoc.context;
  if (context.trailerInfo.Encrypt) throw new Error('Dokument ist bereits verschlüsselt');
  await pdfDoc.flush();
  const owner = ownerPassword || toHex(randomBytes(16)); // random owner password if none chosen
  const P = permissionsValue(permissions);
  const fileKey = randomBytes(32);
  const upw = utf8Password(userPassword), opw = utf8Password(owner);
  const uvs = randomBytes(8), uks = randomBytes(8);
  const U = concat(hash2B(upw, uvs, new Uint8Array(0), 6), uvs, uks);
  const UE = new AES(hash2B(upw, uks, new Uint8Array(0), 6)).cbcEncrypt(new Uint8Array(16), fileKey);
  const ovs = randomBytes(8), oks = randomBytes(8);
  const O = concat(hash2B(opw, ovs, U, 6), ovs, oks);
  const OE = new AES(hash2B(opw, oks, U, 6)).cbcEncrypt(new Uint8Array(16), fileKey);
  const permsPlain = new Uint8Array(16);
  new DataView(permsPlain.buffer).setInt32(0, P, true);
  permsPlain.set([0xff, 0xff, 0xff, 0xff, 0x54 /* T */, 0x61, 0x64, 0x62], 4);
  permsPlain.set(randomBytes(4), 12);
  const aes = new AES(fileKey);
  const Perms = aes.ecbEncrypt(permsPlain);

  // Remove structures that must not be re-written (cross-reference / object streams).
  const all = context.enumerateIndirectObjects();
  for (const [ref, obj] of all) {
    if (obj instanceof PDFStream && (isType(PDFLib, obj.dict, 'XRef') || isType(PDFLib, obj.dict, 'ObjStm'))) context.delete(ref);
  }
  const objects = context.enumerateIndirectObjects();
  let n = 0;
  for (const [ref, obj] of objects) {
    const encStr = b => aesEncryptPdf(fileKey, b, aes);
    if (obj instanceof PDFStream) {
      await transformStrings(PDFLib, obj.dict, encStr);
      const raw = obj instanceof PDFRawStream ? obj.contents : obj.getContents();
      context.assign(ref, PDFRawStream.of(obj.dict, await aesEncryptPdf(fileKey, raw, aes)));
    } else {
      await transformStrings(PDFLib, obj, encStr);
    }
    if (++n % 200 === 0) {
      if (onProgress) onProgress(n / objects.length);
      await new Promise(r => setTimeout(r, 0));
    }
  }
  const encDict = context.obj({
    Filter: 'Standard', V: 5, R: 6, Length: 256, P,
    CF: { StdCF: { AuthEvent: 'DocOpen', CFM: 'AESV3', Length: 32 } },
    StmF: 'StdCF', StrF: 'StdCF', EncryptMetadata: true,
  });
  encDict.set(PDFName.of('O'), PDFHexString.of(toHex(O)));
  encDict.set(PDFName.of('U'), PDFHexString.of(toHex(U)));
  encDict.set(PDFName.of('OE'), PDFHexString.of(toHex(OE)));
  encDict.set(PDFName.of('UE'), PDFHexString.of(toHex(UE)));
  encDict.set(PDFName.of('Perms'), PDFHexString.of(toHex(Perms)));
  context.trailerInfo.Encrypt = context.register(encDict);
  const id = toHex(randomBytes(16));
  context.trailerInfo.ID = context.obj([PDFHexString.of(id), PDFHexString.of(id)]);
  // AES-256 requires PDF 1.7 extension level 3+ (or PDF 2.0)
  try {
    const cat = pdfDoc.catalog;
    if (cat instanceof PDFDict) {
      cat.set(PDFName.of('Extensions'), context.obj({ ADBE: { BaseVersion: PDFName.of('1.7'), ExtensionLevel: 8 } }));
    }
    if (PDFHeader) context.header = PDFHeader.forVersion(1, 7);
  } catch {}
  return pdfDoc;
}
