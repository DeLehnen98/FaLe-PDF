// Minimal, dependency-free PNG toolkit for generating the Android launcher icons.
// Supports 8-bit non-interlaced PNGs (grey, grey+alpha, RGB, RGBA, palette) as input
// and writes 8-bit RGBA PNGs. Deterministic: same input → byte-identical output.
import { inflateSync, deflateSync } from 'node:zlib';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Image = {width, height, data: Uint8Array RGBA (straight alpha)} */
export function decodePng(buf) {
  if (!Buffer.from(buf.subarray(0, 8)).equals(SIG)) throw new Error('Keine PNG-Datei');
  let pos = 8, width = 0, height = 0, depth = 0, ctype = 0, interlace = 0;
  let palette = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      depth = body[8]; ctype = body[9]; interlace = body[12];
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace !== 0) throw new Error(`PNG nicht unterstützt (Bittiefe ${depth}, Interlace ${interlace})`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!channels) throw new Error('PNG-Farbtyp nicht unterstützt: ' + ctype);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = new Uint8Array(stride * height);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = px.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
    prev = cur;
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += 4) {
    const s = i * channels;
    if (ctype === 6) { data[j] = px[s]; data[j + 1] = px[s + 1]; data[j + 2] = px[s + 2]; data[j + 3] = px[s + 3]; }
    else if (ctype === 2) { data[j] = px[s]; data[j + 1] = px[s + 1]; data[j + 2] = px[s + 2]; data[j + 3] = 255; }
    else if (ctype === 0) { data[j] = data[j + 1] = data[j + 2] = px[s]; data[j + 3] = 255; }
    else if (ctype === 4) { data[j] = data[j + 1] = data[j + 2] = px[s]; data[j + 3] = px[s + 1]; }
    else { // palette
      const k = px[s];
      data[j] = palette[k * 3]; data[j + 1] = palette[k * 3 + 1]; data[j + 2] = palette[k * 3 + 2];
      data[j + 3] = trns && k < trns.length ? trns[k] : 255;
    }
  }
  return { width, height, data };
}

function chunk(type, body) {
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(tb));
  return Buffer.concat([len, tb, crc]);
}

export function encodePng({ width, height, data }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    // filter 1 (Sub) compresses icons well and is cheap
    raw[y * (stride + 1)] = 1;
    for (let i = 0; i < stride; i++) {
      const v = data[y * stride + i];
      const left = i >= 4 ? data[y * stride + i - 4] : 0;
      raw[y * (stride + 1) + 1 + i] = (v - left) & 255;
    }
  }
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

export function createImage(width, height, fill = [0, 0, 0, 0]) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return { width, height, data };
}

/** Area-averaging resize (premultiplied alpha) — good quality for downscaling icons. */
export function resize(img, w, h) {
  const { width: sw, height: sh, data: s } = img;
  const out = new Uint8Array(w * h * 4);
  const fx = sw / w, fy = sh / h;
  for (let y = 0; y < h; y++) {
    const y0 = y * fy, y1 = y0 + fy;
    for (let x = 0; x < w; x++) {
      const x0 = x * fx, x1 = x0 + fx;
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      for (let yy = Math.floor(y0); yy < Math.min(sh, Math.ceil(y1)); yy++) {
        const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
        if (wy <= 0) continue;
        for (let xx = Math.floor(x0); xx < Math.min(sw, Math.ceil(x1)); xx++) {
          const wx = Math.min(x1, xx + 1) - Math.max(x0, xx);
          if (wx <= 0) continue;
          const wgt = wx * wy, i = (yy * sw + xx) * 4, al = s[i + 3] / 255;
          r += s[i] * al * wgt; g += s[i + 1] * al * wgt; b += s[i + 2] * al * wgt; a += al * wgt; wsum += wgt;
        }
      }
      const o = (y * w + x) * 4;
      if (a > 0) { out[o] = Math.round(r / a); out[o + 1] = Math.round(g / a); out[o + 2] = Math.round(b / a); }
      out[o + 3] = Math.round((a / (wsum || 1)) * 255);
    }
  }
  return { width: w, height: h, data: out };
}

/** Draw src onto dst at (dx, dy) with source-over blending. */
export function composite(dst, src, dx, dy) {
  for (let y = 0; y < src.height; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= dst.width) continue;
      const si = (y * src.width + x) * 4, di = (ty * dst.width + tx) * 4;
      const sa = src.data[si + 3] / 255, da = dst.data[di + 3] / 255;
      const oa = sa + da * (1 - sa);
      if (oa <= 0) { dst.data[di + 3] = 0; continue; }
      for (let c = 0; c < 3; c++) dst.data[di + c] = Math.round((src.data[si + c] * sa + dst.data[di + c] * da * (1 - sa)) / oa);
      dst.data[di + 3] = Math.round(oa * 255);
    }
  }
  return dst;
}

/** Circular mask with 1px anti-aliased edge (for ic_launcher_round). */
export function circleMask(img) {
  const { width: w, height: h, data } = img;
  const out = new Uint8Array(data);
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    const cov = Math.max(0, Math.min(1, r - d + 0.5));
    out[(y * w + x) * 4 + 3] = Math.round(data[(y * w + x) * 4 + 3] * cov);
  }
  return { width: w, height: h, data: out };
}

/** Vertical linear gradient (colors as [r,g,b]); t is mapped from rows [from, to]. */
export function verticalGradient(w, h, top, bottom, from = 0, to = h - 1) {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++) {
    const t = Math.max(0, Math.min(1, (y - from) / Math.max(1, to - from)));
    const c = [0, 1, 2].map(i => Math.round(top[i] + (bottom[i] - top[i]) * t));
    for (let x = 0; x < w; x++) img.data.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
  }
  return img;
}

/**
 * White silhouette for monochrome/themed icons and notification icons:
 * alpha = how much brighter than the background a pixel is.
 */
export function silhouette(img, bgLum = 60) {
  const { width: w, height: h, data } = img;
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const lum = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    const a = Math.max(0, Math.min(1, (lum - bgLum) / (235 - bgLum))) * (data[o + 3] / 255);
    out[o] = out[o + 1] = out[o + 2] = 255;
    out[o + 3] = Math.round(a * 255);
  }
  return { width: w, height: h, data: out };
}
