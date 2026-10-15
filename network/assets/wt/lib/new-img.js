// Image geometry for crop-image / rotate-image: EXIF orientation algebra, lossless JPEG rotation by
// rewriting the orientation tag, and drawing a source with quarter turns, flips and a fine angle
// (scaled so that no empty corners appear).
import { jpegSegments, minimalTiff, insertSegment, readMeta } from './img-meta.js';

// EXIF orientation → matrix [a, b, c, d] (x' = a x + b y, y' = c x + d y; y points down), stored → shown
const M = { 1: [1, 0, 0, 1], 2: [-1, 0, 0, 1], 3: [-1, 0, 0, -1], 4: [1, 0, 0, -1], 5: [0, 1, 1, 0], 6: [0, -1, 1, 0], 7: [0, -1, -1, 0], 8: [0, 1, -1, 0] };
const mul = (p, q) => [p[0] * q[0] + p[1] * q[2], p[0] * q[1] + p[1] * q[3], p[2] * q[0] + p[3] * q[2], p[2] * q[1] + p[3] * q[3]];
const toOrientation = m => +Object.keys(M).find(k => M[k].every((v, i) => v === m[i]));

/** Matrix of a user transform: quarter turns clockwise (applied first), then flips. */
export function userMatrix({ rot = 0, flipH = false, flipV = false }) {
  let m = M[1];
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) m = mul(M[6], m);
  if (flipH) m = mul(M[2], m);
  if (flipV) m = mul(M[4], m);
  return m;
}
/** New EXIF orientation after applying the user transform to what is shown now. */
export const composeOrientation = (orientation, t) => toOrientation(mul(userMatrix(t), M[orientation] || M[1]));
export const isIdentity = t => toOrientation(userMatrix(t)) === 1;

const isExifSeg = (b, s) => s.marker === 0xe1 && b[s.payload] === 0x45 && b[s.payload + 1] === 0x78 && b[s.payload + 2] === 0x69 && b[s.payload + 3] === 0x66 && b[s.payload + 4] === 0 && b[s.payload + 5] === 0;

/**
 * Set the EXIF orientation of a JPEG without touching the image data.
 * Returns { bytes, kept: true } when the tag was rewritten in place, { bytes, kept: false } when a new
 * minimal EXIF block (orientation + capture date) replaced one without an orientation tag, or null.
 */
export function setJpegOrientation(b, orientation) {
  const { segs, sos } = jpegSegments(b);
  if (sos < 0) return null;
  const s = segs.find(x => isExifSeg(b, x));
  if (s) {
    const out = b.slice();
    const t = s.payload + 6;
    const le = out[t] === 0x49;
    const u16 = o => (le ? out[o] | (out[o + 1] << 8) : (out[o] << 8) | out[o + 1]);
    const u32 = o => (le ? (out[o] | (out[o + 1] << 8) | (out[o + 2] << 16)) + out[o + 3] * 2 ** 24 : out[o] * 2 ** 24 + ((out[o + 1] << 16) | (out[o + 2] << 8) | out[o + 3]));
    const ifd = t + u32(t + 4);
    if (ifd + 2 <= s.end) {
      const n = u16(ifd);
      for (let k = 0; k < n && ifd + 2 + k * 12 + 12 <= s.end; k++) {
        const e = ifd + 2 + k * 12;
        if (u16(e) === 0x0112 && u16(e + 2) === 3) {
          if (le) { out[e + 8] = orientation; out[e + 9] = 0; } else { out[e + 8] = 0; out[e + 9] = orientation; }
          return { bytes: out, kept: true };
        }
      }
    }
  }
  // no orientation tag: write a minimal EXIF block (keeps the capture date) in place of the old one
  let date = '';
  try { const m = readMeta(b); if (/^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}/.test(m.date || '')) date = m.date.slice(0, 19); } catch { /* no date */ }
  const tiff = minimalTiff({ orientation, date });
  const base = s ? new Uint8Array([...b.subarray(0, s.start), ...b.subarray(s.end)]) : b;
  if (!tiff) return { bytes: base, kept: !s };
  const seg = new Uint8Array(4 + 6 + tiff.length);
  seg.set([0xff, 0xe1, (seg.length - 2) >> 8, (seg.length - 2) & 255, 0x45, 0x78, 0x69, 0x66, 0, 0]);
  seg.set(tiff, 10);
  return { bytes: insertSegment(base, seg), kept: !s };
}

/** Current EXIF orientation of a JPEG (1 when none). */
export function jpegOrientation(b) {
  const { segs } = jpegSegments(b);
  const s = segs.find(x => isExifSeg(b, x));
  if (!s) return 1;
  const t = s.payload + 6;
  const le = b[t] === 0x49;
  const u16 = o => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = o => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 2 ** 24 : b[o] * 2 ** 24 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]));
  const ifd = t + u32(t + 4);
  if (ifd + 2 > s.end) return 1;
  for (let k = 0, n = u16(ifd); k < n && ifd + 2 + k * 12 + 12 <= s.end; k++) {
    const e = ifd + 2 + k * 12;
    if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 1; }
  }
  return 1;
}

// ---------------------------------------------------------------- drawing
/** Size after quarter turns. */
export const turnedSize = (w, h, rot) => (rot % 2 ? [h, w] : [w, h]);
/** Zoom needed so that a W×H frame rotated by deg is fully covered by the image (no empty corners). */
export function coverScale(W, H, deg) {
  const t = Math.abs(deg) * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  return Math.max((W * c + H * s) / W, (W * s + H * c) / H);
}

/**
 * Draw src (w × h, upright) transformed into ctx: the result space is the turned size (W × H);
 * crop = {x, y, w, h} in result pixels (the ctx canvas has crop size).
 */
export function drawTransformed(ctx, src, w, h, { rot = 0, flipH = false, flipV = false, angle = 0 }, crop = null, background = null) {
  const [W, H] = turnedSize(w, h, rot);
  const s = angle ? coverScale(W, H, angle) : 1;
  ctx.save();
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height); }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (crop) ctx.scale(ctx.canvas.width / crop.w, ctx.canvas.height / crop.h);
  if (crop) ctx.translate(-crop.x, -crop.y);
  ctx.translate(W / 2, H / 2);
  if (angle) ctx.rotate(angle * Math.PI / 180);
  ctx.scale(s * (flipH ? -1 : 1), s * (flipV ? -1 : 1));
  ctx.rotate(((rot % 4) * Math.PI) / 2);
  ctx.drawImage(src, -w / 2, -h / 2, w, h);
  ctx.restore();
}
