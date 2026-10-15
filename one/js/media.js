// Media helpers that run in the engine worker (and on the page as a fallback): file kinds, EXIF / video
// metadata parsing, thumbnail + preview rendering. Everything happens on the device – the server never sees
// capture dates, GPS, camera data or pixels (contract §5.4/§5.5).

// ---------------------------------------------------------------- kinds
const EXT_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp',
  heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff', dng: 'image/x-adobe-dng', cr2: 'image/x-canon-cr2', nef: 'image/x-nikon-nef', arw: 'image/x-sony-arw', svg: 'image/svg+xml',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', '3gp': 'video/3gpp', avi: 'video/x-msvideo',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/opus', flac: 'audio/flac',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', xml: 'text/xml', html: 'text/html', log: 'text/plain',
  js: 'text/javascript', css: 'text/css', py: 'text/x-python', yml: 'text/yaml', yaml: 'text/yaml', ini: 'text/plain', tsv: 'text/tab-separated-values',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', odp: 'application/vnd.oasis.opendocument.presentation',
  zip: 'application/zip', '7z': 'application/x-7z-compressed', rar: 'application/vnd.rar', gz: 'application/gzip',
};
export const extOf = name => { const m = /\.([a-z0-9]{1,8})$/i.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; };
export function mimeOf(name, given) {
  if (given && given !== 'application/octet-stream') return given;
  return EXT_MIME[extOf(name)] || given || 'application/octet-stream';
}
/** UI kind: image | video | audio | pdf | text | office | archive | other */
export function kindOf(name, mime) {
  const m = mimeOf(name, mime);
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (m === 'application/pdf') return 'pdf';
  if (m.startsWith('text/') || m === 'application/json') return 'text';
  if (/msword|officedocument|ms-excel|ms-powerpoint|opendocument/.test(m)) return 'office';
  if (/zip|compressed|rar|gzip/.test(m)) return 'archive';
  return 'other';
}
export const isMedia = (name, mime) => { const k = kindOf(name, mime); return k === 'image' || k === 'video'; };
/** Formats the browser can usually decode for thumbnails (HEIC/RAW only on some devices). */
export const browserImage = m => /^image\/(jpeg|png|gif|webp|avif|bmp)$/.test(m);

// ---------------------------------------------------------------- EXIF (JPEG APP1, HEIC/HEIF/AVIF Exif item, TIFF-based RAW)
const TAGS0 = { 0x010f: 'make', 0x0110: 'model', 0x0112: 'orientation', 0x0132: 'dateTime', 0x8769: 'exifIfd', 0x8825: 'gpsIfd' };
const TAGSX = { 0x9003: 'dateTimeOriginal', 0x9004: 'dateTimeDigitized', 0x9011: 'offsetTimeOriginal', 0x9010: 'offsetTime', 0x829a: 'exposureTime', 0x829d: 'fNumber',
  0x8827: 'iso', 0x920a: 'focalLength', 0xa405: 'focalLength35', 0xa434: 'lensModel', 0xa002: 'pixelX', 0xa003: 'pixelY', 0x9209: 'flash' };
const TAGSG = { 1: 'latRef', 2: 'lat', 3: 'lonRef', 4: 'lon', 5: 'altRef', 6: 'alt' };

function readTiff(view, start, len) {
  const end = Math.min(view.byteLength, start + len);
  if (start + 8 > end) return null;
  const le = view.getUint16(start) === 0x4949;
  if (!le && view.getUint16(start) !== 0x4d4d) return null;
  const u16 = o => view.getUint16(start + o, le), u32 = o => view.getUint32(start + o, le);
  if (u16(2) !== 42) return null;
  const val = (type, count, off) => {
    const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }[type] || 1;
    const p = size * count <= 4 ? off : u32(off);
    if (start + p + size * count > end) return null;
    const one = i => {
      const q = p + i * size;
      switch (type) {
        case 1: case 7: return view.getUint8(start + q);
        case 3: return u16(q);
        case 4: return u32(q);
        case 9: return view.getInt32(start + q, le);
        case 5: { const d = u32(q + 4); return d ? u32(q) / d : 0; }
        case 10: { const d = view.getInt32(start + q + 4, le); return d ? view.getInt32(start + q, le) / d : 0; }
        default: return null;
      }
    };
    if (type === 2) { let s = ''; for (let i = 0; i < count; i++) { const c = view.getUint8(start + p + i); if (!c) break; s += String.fromCharCode(c); } return s.trim(); }
    if (count === 1) return one(0);
    return Array.from({ length: Math.min(count, 16) }, (_, i) => one(i));
  };
  const ifd = (off, names, out) => {
    if (!off || start + off + 2 > end) return;
    const n = u16(off);
    for (let i = 0; i < n && i < 400; i++) {
      const e = off + 2 + i * 12;
      if (start + e + 12 > end) break;
      const name = names[u16(e)];
      if (name) { try { out[name] = val(u16(e + 2), u32(e + 4), e + 8); } catch {} }
    }
  };
  const out = {};
  ifd(u32(4), TAGS0, out);
  if (out.exifIfd) ifd(out.exifIfd, TAGSX, out);
  const gps = {};
  if (out.gpsIfd) ifd(out.gpsIfd, TAGSG, gps);
  out.gps = gps;
  return out;
}
function findBytes(u8, pat, from = 0, to = u8.length) {
  outer: for (let i = from; i <= to - pat.length; i++) { for (let j = 0; j < pat.length; j++) if (u8[i + j] !== pat[j]) continue outer; return i; }
  return -1;
}
const EXIF_HDR = [0x45, 0x78, 0x69, 0x66, 0, 0]; // "Exif\0\0"
/** Raw EXIF fields from the first bytes of an image (null when none). */
export function parseExif(u8) {
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8[0] === 0xff && u8[1] === 0xd8) { // JPEG: walk the markers to APP1/Exif
    let i = 2;
    while (i + 4 < u8.length) {
      if (u8[i] !== 0xff) { i++; continue; }
      const m = u8[i + 1];
      if (m === 0xd9 || m === 0xda) break;
      const len = view.getUint16(i + 2);
      if (m === 0xe1 && findBytes(u8, EXIF_HDR, i + 4, i + 10) === i + 4) return readTiff(view, i + 10, len - 8);
      i += 2 + len;
    }
    return null;
  }
  if ((u8[0] === 0x49 && u8[1] === 0x49 && u8[2] === 42) || (u8[0] === 0x4d && u8[1] === 0x4d && u8[3] === 42)) return readTiff(view, 0, u8.length); // TIFF / DNG / many RAWs
  const p = findBytes(u8, EXIF_HDR); // HEIC/HEIF/AVIF/PNG eXIf/WebP EXIF: the Exif item/chunk starts with "Exif\0\0"
  if (p >= 0) return readTiff(view, p + 6, u8.length - p - 6);
  const q = Math.max(findBytes(u8, [0x4d, 0x4d, 0, 42, 0, 0, 0, 8]), findBytes(u8, [0x49, 0x49, 42, 0, 8, 0, 0, 0]));
  return q >= 0 ? readTiff(view, q, u8.length - q) : null;
}
function exifDate(s, off) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(s || ''));
  if (!m || m[1] === '0000') return null;
  const o = /^[+-]\d{2}:\d{2}$/.test(String(off || '')) ? off : '';
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${o}`;
}
const gpsDeg = (v, ref) => {
  if (!Array.isArray(v) || v.length < 3) return null;
  const d = v[0] + v[1] / 60 + v[2] / 3600;
  if (!Number.isFinite(d) || d === 0) return null;
  return Math.round((ref === 'S' || ref === 'W' ? -d : d) * 1e6) / 1e6;
};
/** Node-meta fields (contract §5.4) from raw EXIF. */
export function exifToMeta(x) {
  if (!x) return {};
  const meta = {};
  const taken = exifDate(x.dateTimeOriginal, x.offsetTimeOriginal || x.offsetTime) || exifDate(x.dateTimeDigitized, x.offsetTime) || exifDate(x.dateTime, x.offsetTime);
  if (taken) meta.takenAt = taken;
  if (Number.isInteger(x.orientation) && x.orientation >= 1 && x.orientation <= 8) meta.orientation = x.orientation;
  if (x.pixelX > 0 && x.pixelY > 0) { meta.w = x.pixelX; meta.h = x.pixelY; }
  const lat = gpsDeg(x.gps && x.gps.lat, x.gps && x.gps.latRef), lon = gpsDeg(x.gps && x.gps.lon, x.gps && x.gps.lonRef);
  if (lat !== null && lon !== null) {
    meta.gps = { lat, lon };
    if (typeof x.gps.alt === 'number' && Number.isFinite(x.gps.alt)) meta.gps.alt = Math.round((x.gps.altRef === 1 ? -x.gps.alt : x.gps.alt) * 10) / 10;
  }
  const ex = {};
  if (x.make) ex.make = String(x.make).slice(0, 60);
  if (x.model) ex.model = String(x.model).slice(0, 80);
  if (x.lensModel) ex.lens = String(x.lensModel).slice(0, 80);
  if (typeof x.iso === 'number') ex.iso = x.iso; else if (Array.isArray(x.iso)) ex.iso = x.iso[0];
  if (typeof x.fNumber === 'number' && x.fNumber > 0) ex.fNumber = Math.round(x.fNumber * 10) / 10;
  if (typeof x.exposureTime === 'number' && x.exposureTime > 0) ex.exposure = x.exposureTime;
  if (typeof x.focalLength === 'number' && x.focalLength > 0) ex.focal = Math.round(x.focalLength * 10) / 10;
  if (typeof x.focalLength35 === 'number' && x.focalLength35 > 0) ex.focal35 = x.focalLength35;
  if (Object.keys(ex).length) meta.exif = ex;
  return meta;
}

// ---------------------------------------------------------------- MP4 / MOV (creation time, duration, size)
function mp4Meta(u8) {
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const out = {};
  const mvhd = findBytes(u8, [0x6d, 0x76, 0x68, 0x64]); // "mvhd"
  if (mvhd >= 4) {
    const v = u8[mvhd + 4];
    try {
      const created = v === 1 ? Number(view.getBigUint64(mvhd + 8)) : view.getUint32(mvhd + 8);
      const scale = v === 1 ? view.getUint32(mvhd + 24) : view.getUint32(mvhd + 16);
      const dur = v === 1 ? Number(view.getBigUint64(mvhd + 28)) : view.getUint32(mvhd + 20);
      if (created > 0) { const ms = (created - 2082844800) * 1000; if (ms > 0 && ms < Date.now() + 864e5) out.takenAt = new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z'); }
      if (scale > 0 && dur > 0) out.durationMs = Math.round((dur / scale) * 1000);
    } catch {}
  }
  const xyz = findBytes(u8, [0xa9, 0x78, 0x79, 0x7a]); // "©xyz" ISO 6709 location (+54.1000+007.9000/)
  if (xyz >= 0) {
    const s = new TextDecoder().decode(u8.subarray(xyz + 4, xyz + 60));
    const m = /([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/.exec(s);
    if (m) { const lat = +m[1], lon = +m[2]; if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat || lon)) out.gps = { lat, lon }; }
  }
  return out;
}

/** Metadata for a photo/video file → node meta fields (takenAt, gps, exif, w, h, orientation, durationMs). */
export async function readMediaMeta(file, mime) {
  const kind = kindOf(file.name, mime);
  try {
    if (kind === 'video') {
      const head = new Uint8Array(await file.slice(0, 1024 * 1024).arrayBuffer());
      let m = mp4Meta(head);
      if (!m.takenAt && file.size > 1024 * 1024) m = { ...mp4Meta(new Uint8Array(await file.slice(Math.max(0, file.size - 2 * 1024 * 1024)).arrayBuffer())), ...m };
      return m;
    }
    if (kind !== 'image') return {};
    const head = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer());
    return exifToMeta(parseExif(head));
  } catch { return {}; }
}
/** ISO capture time with offset, falling back to the file's modification time (device local time). */
export function fallbackTakenAt(ms) {
  const d = new Date(ms || Date.now());
  const off = -d.getTimezoneOffset();
  const pad = n => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${off >= 0 ? '+' : '-'}${pad(off / 60)}:${pad(off % 60)}`;
}

// ---------------------------------------------------------------- thumbnails + previews
export const THUMB_EDGE = 256;
export const PREVIEW_EDGE = 1600;
const THUMB_MAX = 120 * 1024; // sealed thumb must stay ≤ thumbMaxBytes (128 KiB)

async function encode(canvas, max, q) {
  let blob = null;
  for (let quality = q; quality >= 0.35; quality -= 0.12) {
    blob = canvas.convertToBlob ? await canvas.convertToBlob({ type: 'image/jpeg', quality }) : await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
    if (!max || blob.size <= max) break;
  }
  return blob;
}
function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
async function scaled(bitmap, edge, max, q) {
  const s = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * s)), h = Math.max(1, Math.round(bitmap.height * s));
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob = await encode(c, max, q);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h, mime: 'image/jpeg' };
}
/**
 * Thumbnail (256 px long edge, ≤ 120 KB) + preview (1600 px, only when the original is larger or not a
 * web format) from an image file or an ImageBitmap/canvas source. EXIF orientation is applied, EXIF itself is
 * not carried over (canvas re-encode). → { w, h, thumb, preview } or null (format not decodable here).
 */
export async function imageDerivatives(src, { mime = '', size = 0, maxPixels = 100e6 } = {}) {
  let bitmap;
  try { bitmap = src instanceof Blob ? await createImageBitmap(src, { imageOrientation: 'from-image' }) : src; }
  catch { return null; }
  try {
    if (!bitmap || !bitmap.width || bitmap.width * bitmap.height > maxPixels) return null;
    const w = bitmap.width, h = bitmap.height;
    const thumb = await scaled(bitmap, THUMB_EDGE, THUMB_MAX, 0.72);
    const needPreview = Math.max(w, h) > PREVIEW_EDGE * 1.15 || !browserImage(mime) || size > 2.5 * 1024 * 1024;
    const preview = needPreview ? await scaled(bitmap, PREVIEW_EDGE, 7.5 * 1024 * 1024, 0.84) : null;
    return { w, h, thumb, preview };
  } finally { if (bitmap && bitmap.close && src instanceof Blob) bitmap.close(); }
}
