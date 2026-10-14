// Photo metadata: read EXIF / GPS / XMP / IPTC / comments from JPEG, PNG and WebP, and remove them
// losslessly by editing the file's segments/chunks (the compressed image data is copied byte for byte –
// no re-encoding, no quality loss). Pure functions on Uint8Arrays, no DOM.
//
//   readMeta(bytes)                 → { format, entries[], gps, orientation, date, thumb, xmp, iptc, comments, trailer, icc }
//   stripMeta(bytes, {keepDate})    → { bytes, removed[], kept[], format, imageDataSame }
//   jpegImageData(bytes)            → subarray from the first SOS to EOI (for the "unchanged" check)

const td = new TextDecoder('utf-8', { fatal: false });
const latin = b => String.fromCharCode(...b);
const ascii = (b, i, n) => latin(b.subarray(i, i + n));

export function detectFormat(b) {
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpeg';
  if (b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return 'png';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'webp';
  if (ascii(b, 4, 4) === 'ftyp') return 'heif'; // HEIC / AVIF: read only (EXIF item), no lossless strip
  return '';
}

// ---------------------------------------------------------------- HEIF / AVIF (ISOBMFF): find the EXIF item
const u32be = (b, o) => b[o] * 2 ** 24 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
/** [start, end] of the TIFF data of the 'Exif' item of a HEIC/AVIF file, or null. */
export function isobmffExif(b) {
  let i = 0, meta = null;
  while (i + 8 <= b.length) {
    let size = u32be(b, i), hdr = 8;
    const type = ascii(b, i + 4, 4);
    if (size === 1) { size = u32be(b, i + 8) * 2 ** 32 + u32be(b, i + 12); hdr = 16; } else if (size === 0) size = b.length - i;
    if (size < hdr) return null;
    if (type === 'meta') { meta = [i + hdr + 4, Math.min(b.length, i + size)]; break; }
    i += size;
  }
  if (!meta) return null;
  let exifId = null, iloc = null;
  for (let j = meta[0]; j + 8 <= meta[1];) {
    const size = u32be(b, j), type = ascii(b, j + 4, 4);
    if (size < 8) break;
    if (type === 'iinf') {
      const v = b[j + 8];
      let p = j + 12;
      const n = v === 0 ? (b[p] << 8) | b[p + 1] : u32be(b, p);
      p += v === 0 ? 2 : 4;
      for (let k = 0; k < n && p + 8 <= j + size; k++) {
        const es = u32be(b, p);
        if (es < 8) break;
        if (ascii(b, p + 4, 4) === 'infe' && b[p + 8] >= 2) {
          const ver = b[p + 8];
          const id = ver === 2 ? (b[p + 12] << 8) | b[p + 13] : u32be(b, p + 12);
          const t = ver === 2 ? p + 16 : p + 18;
          if (ascii(b, t, 4) === 'Exif') exifId = id;
        }
        p += es;
      }
    } else if (type === 'iloc') iloc = j;
    j += size;
  }
  if (exifId == null || iloc == null) return null;
  const ver = b[iloc + 8];
  let p = iloc + 12;
  const offSize = b[p] >> 4, lenSize = b[p] & 15, baseSize = b[p + 1] >> 4, idxSize = ver >= 1 ? b[p + 1] & 15 : 0;
  p += 2;
  const rd = sz => { let v = 0; for (let q = 0; q < sz; q++) v = v * 256 + b[p + q]; p += sz; return v; };
  const n = ver < 2 ? rd(2) : rd(4);
  for (let k = 0; k < n && p < b.length; k++) {
    const id = ver < 2 ? rd(2) : rd(4);
    const method = ver >= 1 ? rd(2) & 15 : 0;
    rd(2);
    const base = rd(baseSize);
    const ext = rd(2);
    let first = null;
    for (let e = 0; e < ext; e++) { if (ver >= 1 && idxSize) rd(idxSize); const off = rd(offSize), len = rd(lenSize); if (!first) first = [base + off, len]; }
    if (id === exifId && first && method === 0) {
      const [o, len] = first;
      if (o + len > b.length || len < 10) return null;
      const t = o + 4 + u32be(b, o);
      return t < o + len ? [t, o + len] : null;
    }
  }
  return null;
}

// ---------------------------------------------------------------- TIFF / EXIF
const TAGS = {
  ifd0: { 0x010e: 'description', 0x010f: 'make', 0x0110: 'model', 0x0112: 'orientation', 0x0131: 'software', 0x0132: 'modified', 0x013b: 'artist', 0x8298: 'copyright', 0x8769: '#exif', 0x8825: '#gps', 0xa430: 'owner' },
  exif: { 0x829a: 'exposure', 0x829d: 'fnumber', 0x8827: 'iso', 0x9003: 'taken', 0x9004: 'digitized', 0x9010: 'offset', 0x9011: 'offset', 0x920a: 'focal', 0x927c: 'makernote', 0x9286: 'usercomment', 0xa420: 'uniqueid', 0xa430: 'owner', 0xa431: 'serial', 0xa433: 'lensmake', 0xa434: 'lens', 0xa435: 'lensserial' },
  gps: { 0x0001: 'latref', 0x0002: 'lat', 0x0003: 'lonref', 0x0004: 'lon', 0x0005: 'altref', 0x0006: 'alt', 0x0007: 'gpstime', 0x0011: 'direction', 0x001d: 'gpsdate' },
};
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

/** Parse a TIFF structure (EXIF payload). Returns a flat {name: value} map + raw info. */
export function parseTiff(b, start = 0, end = b.length) {
  const out = { fields: {}, hasThumb: false, thumbBytes: 0, makerNoteBytes: 0 };
  if (start + 8 > end) return out;
  const le = b[start] === 0x49;
  const u16 = o => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = o => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 2 ** 24 : b[o] * 2 ** 24 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]));
  const s32 = o => { const v = u32(o); return v >= 2 ** 31 ? v - 2 ** 32 : v; };
  if (u16(start + 2) !== 42) return out;
  const seen = new Set();
  const readIfd = (off, table, depth) => {
    const ifd = start + off;
    if (depth > 4 || seen.has(ifd) || ifd + 2 > end) return 0;
    seen.add(ifd);
    const n = u16(ifd);
    if (n > 1000) return 0;
    for (let k = 0; k < n; k++) {
      const e = ifd + 2 + k * 12;
      if (e + 12 > end) break;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      const size = (TYPE_SIZE[type] || 1) * count;
      const vo = size <= 4 ? e + 8 : start + u32(e + 8);
      if (vo + size > end || size > 1 << 24) continue;
      const name = table[tag];
      if (!name) continue;
      if (name === '#exif') { readIfd(u32(e + 8), TAGS.exif, depth + 1); continue; }
      if (name === '#gps') { readIfd(u32(e + 8), TAGS.gps, depth + 1); continue; }
      if (name === 'makernote') { out.makerNoteBytes = size; continue; }
      let v;
      if (type === 2) v = latin(b.subarray(vo, vo + count)).replace(/\0+$/, '').trim();
      else if (type === 3) v = count === 1 ? u16(vo) : Array.from({ length: Math.min(count, 8) }, (_, i) => u16(vo + i * 2));
      else if (type === 4 || type === 9) v = count === 1 ? (type === 9 ? s32(vo) : u32(vo)) : Array.from({ length: Math.min(count, 8) }, (_, i) => u32(vo + i * 4));
      else if (type === 5 || type === 10) {
        const r = i => { const den = type === 10 ? s32(vo + i * 8 + 4) : u32(vo + i * 8 + 4); return den ? (type === 10 ? s32(vo + i * 8) : u32(vo + i * 8)) / den : 0; };
        v = count === 1 ? r(0) : Array.from({ length: Math.min(count, 8) }, (_, i) => r(i));
      } else if (type === 1 || type === 7) {
        const raw = b.subarray(vo, vo + count);
        v = name === 'usercomment' ? latin(raw.subarray(8)).replace(/\0+/g, '').trim() : (count === 1 ? raw[0] : Array.from(raw.subarray(0, 8)));
      }
      if (v === '' || v == null) continue;
      if (!(name in out.fields)) out.fields[name] = v;
    }
    return u32(ifd + 2 + n * 12);
  };
  const ifd1 = readIfd(u32(start + 4), TAGS.ifd0, 0);
  if (ifd1 && start + ifd1 + 2 <= end) {
    // IFD1 = embedded thumbnail (can show the uncropped original!)
    const t = start + ifd1, n = u16(t);
    let len = 0;
    for (let k = 0; k < n && t + 2 + k * 12 + 12 <= end; k++) { const e = t + 2 + k * 12; if (u16(e) === 0x0202) len = u32(e + 8); }
    out.hasThumb = len > 0 || n > 0;
    out.thumbBytes = len;
  }
  return out;
}

/** Decimal degrees from EXIF GPS rationals. */
function dms(v, ref) {
  if (!Array.isArray(v) || v.length < 3) return null;
  const d = v[0] + v[1] / 60 + v[2] / 3600;
  if (!Number.isFinite(d)) return null;
  return /[SW]/i.test(String(ref || '')) ? -d : d;
}

// ---------------------------------------------------------------- JPEG
/** Segments before the scan: [{marker, start, end (exclusive, incl. header), payloadStart}] + scan offset. */
export function jpegSegments(b) {
  const segs = [];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return { segs, sos: -1, bad: true };
    let m = b[i + 1];
    while (m === 0xff && i + 2 < b.length) { i++; m = b[i + 1]; }  // fill bytes
    if (m === 0xda) return { segs, sos: i };
    if (m === 0xd9) return { segs, sos: -1 };
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) return { segs, sos: -1, bad: true };
    segs.push({ marker: m, start: i, end: i + 2 + len, payload: i + 4 });
    i += 2 + len;
  }
  return { segs, sos: -1 };
}

/** End of the main JPEG image (offset after its EOI marker), scanning entropy-coded data after SOS. */
export function jpegEnd(b, sos) {
  let i = sos;
  // walk segments/scans: after each SOS header, skip entropy data until a marker that isn't RSTn/stuffing
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m === 0x00 || m === 0xff || (m >= 0xd0 && m <= 0xd7)) { i += m === 0xff ? 1 : 2; continue; }
    if (m === 0xd9) return i + 2;
    if (i + 4 > b.length) break;
    const len = (b[i + 2] << 8) | b[i + 3];
    i += 2 + len; // SOS header or DHT/DQT/DRI between progressive scans
  }
  return b.length;
}

const isExif = (b, s) => s.marker === 0xe1 && ascii(b, s.payload, 6) === 'Exif\0\0';
const isXmp = (b, s) => s.marker === 0xe1 && ascii(b, s.payload, 28).startsWith('http://ns.adobe.com/xap/1.0/');
const isXmpExt = (b, s) => s.marker === 0xe1 && ascii(b, s.payload, 34).startsWith('http://ns.adobe.com/xmp/extension/');
const isIcc = (b, s) => s.marker === 0xe2 && ascii(b, s.payload, 12) === 'ICC_PROFILE\0';
const isMpf = (b, s) => s.marker === 0xe2 && ascii(b, s.payload, 4) === 'MPF\0';
const isAdobe = (b, s) => s.marker === 0xee && ascii(b, s.payload, 5) === 'Adobe';
const isJfif = (b, s) => s.marker === 0xe0 && (ascii(b, s.payload, 5) === 'JFIF\0' || ascii(b, s.payload, 5) === 'JFXX\0');

// ---------------------------------------------------------------- PNG
function pngChunks(b) {
  const chunks = [];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
    const type = ascii(b, i + 4, 4);
    if (i + 12 + len > b.length) break;
    chunks.push({ type, start: i, end: i + 12 + len, data: i + 8, len });
    i += 12 + len;
    if (type === 'IEND') break;
  }
  return { chunks, end: i };
}
const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME', 'dSIG', 'caBX']);
// PNG CRC32
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

// ---------------------------------------------------------------- WebP
function webpChunks(b) {
  const chunks = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const type = ascii(b, i, 4);
    const len = b[i + 4] | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] * 2 ** 24);
    const end = i + 8 + len + (len & 1);
    if (i + 8 + len > b.length) break;
    chunks.push({ type, start: i, end: Math.min(end, b.length), data: i + 8, len });
    i = end;
  }
  return chunks;
}

// ---------------------------------------------------------------- read
/**
 * Everything that is stored next to the picture. `entries` are display rows:
 * { group: 'location'|'camera'|'time'|'person'|'software'|'other', key, value, raw? }.
 */
export function readMeta(b) {
  const format = detectFormat(b);
  const r = { format, entries: [], gps: null, orientation: 1, date: '', thumb: false, xmp: 0, iptc: 0, comments: [], trailer: 0, icc: false, exif: 0, makerNote: 0, text: [] };
  const tiffs = [];
  if (format === 'jpeg') {
    const { segs, sos } = jpegSegments(b);
    for (const s of segs) {
      if (isExif(b, s)) { r.exif += s.end - s.start; tiffs.push([s.payload + 6, s.end]); }
      else if (isXmp(b, s) || isXmpExt(b, s)) { r.xmp += s.end - s.start; r.text.push(td.decode(b.subarray(s.payload, s.end))); }
      else if (s.marker === 0xed) r.iptc += s.end - s.start;
      else if (s.marker === 0xfe) r.comments.push(td.decode(b.subarray(s.payload, s.end)).replace(/\0+$/, '').trim());
      else if (isIcc(b, s)) r.icc = true;
      else if (s.marker >= 0xe1 && s.marker <= 0xef && !isMpf(b, s) && !isAdobe(b, s)) r.other = (r.other || 0) + (s.end - s.start);
    }
    if (sos > 0) { const e = jpegEnd(b, sos); if (e < b.length) r.trailer = b.length - e; }
  } else if (format === 'png') {
    for (const c of pngChunks(b).chunks) {
      if (c.type === 'eXIf') { r.exif += c.len; tiffs.push([c.data, c.data + c.len]); }
      else if (c.type === 'tEXt' || c.type === 'iTXt' || c.type === 'zTXt') {
        const raw = b.subarray(c.data, c.data + c.len);
        const z = raw.indexOf(0);
        const key = latin(raw.subarray(0, z < 0 ? 0 : z));
        if (/xmp/i.test(key)) { r.xmp += c.len; r.text.push(td.decode(raw)); }
        else if (c.type === 'zTXt') r.comments.push(`${key}: …`);
        else {
          let val = raw.subarray(z + 1);
          if (c.type === 'iTXt') { // keyword\0 flag method lang\0 transkey\0 text
            const comp = val[0];
            let p = 2; p = val.indexOf(0, p) + 1; p = val.indexOf(0, p) + 1;
            val = comp ? new Uint8Array(0) : val.subarray(p);
          }
          r.comments.push(`${key}: ${td.decode(val).slice(0, 300)}`.trim());
        }
      } else if (c.type === 'tIME') {
        const d = b.subarray(c.data, c.data + 7);
        r.entries.push({ group: 'time', key: 'modified', value: `${(d[0] << 8) | d[1]}-${String(d[2]).padStart(2, '0')}-${String(d[3]).padStart(2, '0')} ${String(d[4]).padStart(2, '0')}:${String(d[5]).padStart(2, '0')}` });
      } else if (c.type === 'iCCP') r.icc = true;
    }
  } else if (format === 'webp') {
    for (const c of webpChunks(b)) {
      if (c.type === 'EXIF') {
        r.exif += c.len;
        let s = c.data;
        if (ascii(b, s, 6) === 'Exif\0\0') s += 6;
        tiffs.push([s, c.data + c.len]);
      } else if (c.type === 'XMP ') { r.xmp += c.len; r.text.push(td.decode(b.subarray(c.data, c.data + c.len))); }
      else if (c.type === 'ICCP') r.icc = true;
    }
  }
  if (format === 'heif') { const x = isobmffExif(b); if (x) { r.exif += x[1] - x[0]; tiffs.push(x); } }
  for (const [s, e] of tiffs) {
    const t = parseTiff(b, s, e);
    const f = t.fields;
    r.thumb = r.thumb || t.hasThumb;
    r.makerNote += t.makerNoteBytes;
    if (f.orientation) r.orientation = +f.orientation || 1;
    const lat = dms(f.lat, f.latref), lon = dms(f.lon, f.lonref);
    if (lat != null && lon != null && !(lat === 0 && lon === 0)) {
      r.gps = { lat, lon, alt: typeof f.alt === 'number' ? (f.altref === 1 ? -f.alt : f.alt) : null, direction: typeof f.direction === 'number' ? f.direction : null };
    }
    const date = f.taken || f.digitized || f.modified;
    if (date) r.date = String(date);
    const add = (group, key, value) => { if (value != null && value !== '' && !r.entries.some(x => x.key === key)) r.entries.push({ group, key, value }); };
    add('camera', 'camera', f.model && f.make && String(f.model).toLowerCase().startsWith(String(f.make).toLowerCase()) ? f.model : [f.make, f.model].filter(Boolean).join(' '));
    add('camera', 'lens', [f.lensmake, f.lens].filter(Boolean).join(' '));
    add('camera', 'settings', [f.fnumber ? `f/${(+f.fnumber).toFixed(1).replace(/\.0$/, '')}` : '', f.exposure ? (f.exposure < 1 ? `1/${Math.round(1 / f.exposure)} s` : `${f.exposure} s`) : '', f.iso ? `ISO ${Array.isArray(f.iso) ? f.iso[0] : f.iso}` : '', f.focal ? `${Math.round(f.focal * 10) / 10} mm` : ''].filter(Boolean).join(' · '));
    add('person', 'serial', f.serial || '');
    add('person', 'lensserial', f.lensserial || '');
    add('person', 'owner', f.owner || '');
    add('person', 'artist', f.artist || '');
    add('person', 'copyright', f.copyright || '');
    add('person', 'uniqueid', f.uniqueid || '');
    add('time', 'taken', f.taken ? exifDate(f.taken, f.offset) : '');
    add('time', 'modified', f.modified && exifDate(f.modified) !== exifDate(f.taken || '') ? exifDate(f.modified) : '');
    add('software', 'software', f.software || '');
    add('other', 'description', f.description || '');
    add('other', 'usercomment', f.usercomment || '');
    if (f.gpsdate || f.gpstime) add('time', 'gpstime', `${String(f.gpsdate || '').replace(/:/g, '-')} ${Array.isArray(f.gpstime) ? f.gpstime.map(x => String(Math.floor(x)).padStart(2, '0')).join(':') : ''} UTC`.trim());
  }
  // XMP may carry its own location (e.g. after editing) or creator data
  for (const x of r.text) {
    if (!r.gps) {
      const la = /GPSLatitude[=>"]+\s*"?([0-9.,]+)\s*([NS])/i.exec(x), lo = /GPSLongitude[=>"]+\s*"?([0-9.,]+)\s*([EW])/i.exec(x);
      if (la && lo) {
        const conv = (s, ref) => { const p = s.split(','); const d = (+p[0] || 0) + (+p[1] || 0) / 60 + (+p[2] || 0) / 3600; return /[SW]/i.test(ref) ? -d : d; };
        r.gps = { lat: conv(la[1], la[2]), lon: conv(lo[1], lo[2]), alt: null, direction: null };
      }
    }
    const tool = /CreatorTool[=>"]+\s*"?([^"<]{1,80})/i.exec(x);
    if (tool && !r.entries.some(e => e.key === 'software')) r.entries.push({ group: 'software', key: 'software', value: tool[1].trim() });
    const creator = /<dc:creator>[\s\S]*?<rdf:li[^>]*>([^<]{1,80})</i.exec(x);
    if (creator && !r.entries.some(e => e.key === 'artist')) r.entries.push({ group: 'person', key: 'artist', value: creator[1].trim() });
  }
  return r;
}

function exifDate(s, offset) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s));
  if (!m) return String(s);
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}${offset ? ` (${offset})` : ''}`;
}

/** Does the file carry anything private beyond the orientation? */
export function hasPrivate(m) {
  return !!(m.gps || m.entries.length || m.thumb || m.xmp || m.iptc || m.comments.length || m.trailer || m.makerNote || m.other);
}

// ---------------------------------------------------------------- build a minimal EXIF (orientation [+ date])
/** Big-endian TIFF with IFD0 {Orientation, DateTime} and an EXIF IFD {DateTimeOriginal}. */
export function minimalTiff({ orientation = 1, date = '' } = {}) {
  const d = /^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/.test(date) ? date : '';
  const ifd0 = [];
  if (orientation > 1 && orientation <= 8) ifd0.push([0x0112, 3, 1, orientation]);
  if (d) ifd0.push([0x0132, 2, 20, 'str'], [0x8769, 4, 1, 'exifptr']);
  if (!ifd0.length) return null;
  const n0 = ifd0.length;
  const ifd0Size = 2 + n0 * 12 + 4;
  const exifOff = 8 + ifd0Size;
  const exifSize = d ? 2 + 12 + 4 : 0;
  const strOff = exifOff + exifSize;
  const total = strOff + (d ? 40 : 0);
  const b = new Uint8Array(total);
  const v = new DataView(b.buffer);
  b.set([0x4d, 0x4d, 0, 42, 0, 0, 0, 8]);
  v.setUint16(8, n0);
  ifd0.forEach(([tag, type, count, val], k) => {
    const e = 10 + k * 12;
    v.setUint16(e, tag); v.setUint16(e + 2, type); v.setUint32(e + 4, count);
    if (val === 'str') v.setUint32(e + 8, strOff);
    else if (val === 'exifptr') v.setUint32(e + 8, exifOff);
    else if (type === 3) v.setUint16(e + 8, val);
    else v.setUint32(e + 8, val);
  });
  v.setUint32(10 + n0 * 12, 0);
  if (d) {
    v.setUint16(exifOff, 1);
    v.setUint16(exifOff + 2, 0x9003); v.setUint16(exifOff + 4, 2); v.setUint32(exifOff + 6, 20); v.setUint32(exifOff + 10, strOff + 20);
    v.setUint32(exifOff + 14, 0);
    const enc = s => { for (let i = 0; i < 19; i++) b[strOff + i] = s.charCodeAt(i); };
    enc(d); // DateTime
    for (let i = 0; i < 19; i++) b[strOff + 20 + i] = d.charCodeAt(i); // DateTimeOriginal
  }
  return b;
}

function exifDateRaw(m) {
  // r.date is "YYYY:MM:DD HH:MM:SS" as stored (not the display format)
  return /^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}/.test(m.date) ? m.date.slice(0, 19) : '';
}

const concat = parts => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

// ---------------------------------------------------------------- strip
/**
 * Remove metadata without touching the image data. The orientation is kept (as the only EXIF tag)
 * when the photo needs it to be shown upright; keepDate also keeps the capture date.
 * Kept: colour profile (ICC), JFIF/Adobe colour info, PNG colour/transparency chunks, WebP animation/alpha.
 */
export function stripMeta(b, { keepDate = false } = {}) {
  const m = readMeta(b);
  const tiff = minimalTiff({ orientation: m.orientation, date: keepDate ? exifDateRaw(m) : '' });
  const kept = [];
  if (m.orientation > 1) kept.push('orientation');
  if (keepDate && exifDateRaw(m)) kept.push('date');
  if (m.icc) kept.push('icc');
  if (m.format === 'jpeg') return { ...stripJpeg(b, tiff), meta: m, kept };
  if (m.format === 'png') return { ...stripPng(b, tiff), meta: m, kept };
  if (m.format === 'webp') return { ...stripWebp(b, tiff), meta: m, kept };
  throw new Error('unsupported format');
}

function stripJpeg(b, tiff) {
  const { segs, sos, bad } = jpegSegments(b);
  if (bad || sos < 0) throw new Error('bad jpeg');
  const parts = [b.subarray(0, 2)];
  let insertedExif = false;
  const putExif = () => {
    if (insertedExif || !tiff) return;
    insertedExif = true;
    const len = 2 + 6 + tiff.length;
    parts.push(new Uint8Array([0xff, 0xe1, len >> 8, len & 0xff, 0x45, 0x78, 0x69, 0x66, 0, 0]), tiff);
  };
  for (const s of segs) {
    const keep = isJfif(b, s) || isIcc(b, s) || isAdobe(b, s) || s.marker < 0xe0 || (s.marker > 0xef && s.marker !== 0xfe);
    if (isJfif(b, s)) { parts.push(b.subarray(s.start, s.end)); continue; }
    putExif(); // EXIF goes right after SOI/JFIF
    if (keep) parts.push(b.subarray(s.start, s.end));
  }
  putExif();
  const end = jpegEnd(b, sos);
  parts.push(b.subarray(sos, end)); // scan data up to and including EOI – byte for byte; trailing data is dropped
  return { bytes: concat(parts), format: 'jpeg' };
}

function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function stripPng(b, tiff) {
  const { chunks } = pngChunks(b);
  const parts = [b.subarray(0, 8)];
  for (const c of chunks) {
    if (PNG_DROP.has(c.type)) continue;
    parts.push(b.subarray(c.start, c.end));
    if (c.type === 'IHDR' && tiff) parts.push(pngChunk('eXIf', tiff));
  }
  return { bytes: concat(parts), format: 'png' };
}

function stripWebp(b, tiff) {
  const chunks = webpChunks(b);
  const body = [];
  let vp8x = null;
  for (const c of chunks) {
    if (c.type === 'EXIF' || c.type === 'XMP ') continue;
    const part = b.slice(c.start, c.end);
    if (c.type === 'VP8X') vp8x = part;
    body.push(part);
  }
  if (tiff) {
    if (!vp8x) {
      // a simple WebP needs a VP8X header to carry EXIF: canvas size from the VP8/VP8L bitstream
      const dims = webpSize(b, chunks);
      if (dims) {
        vp8x = new Uint8Array(18);
        vp8x.set([0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0]);
        const w = dims[0] - 1, h = dims[1] - 1;
        vp8x.set([w & 255, (w >> 8) & 255, (w >> 16) & 255, h & 255, (h >> 8) & 255, (h >> 16) & 255], 12);
        if (chunks.some(c => c.type === 'VP8L') && webpLosslessAlpha(b, chunks)) vp8x[8] |= 0x10;
        body.unshift(vp8x);
      }
    }
    if (vp8x) {
      const pad = tiff.length & 1;
      const ex = new Uint8Array(8 + tiff.length + pad);
      ex.set([0x45, 0x58, 0x49, 0x46, tiff.length & 255, (tiff.length >> 8) & 255, (tiff.length >> 16) & 255, 0]);
      ex.set(tiff, 8);
      body.push(ex);
    }
  }
  if (vp8x) {
    vp8x[8] &= ~(0x08 | 0x04); // EXIF + XMP flags off
    if (tiff) vp8x[8] |= 0x08;
  }
  const size = 4 + body.reduce((s, p) => s + p.length, 0);
  const head = new Uint8Array(12);
  head.set([0x52, 0x49, 0x46, 0x46, size & 255, (size >> 8) & 255, (size >> 16) & 255, (size >>> 24) & 255, 0x57, 0x45, 0x42, 0x50]);
  return { bytes: concat([head, ...body]), format: 'webp' };
}

function webpSize(b, chunks) {
  const c = chunks.find(x => x.type === 'VP8 ' || x.type === 'VP8L');
  if (!c) return null;
  const d = c.data;
  if (c.type === 'VP8 ') return [(b[d + 6] | (b[d + 7] << 8)) & 0x3fff, (b[d + 8] | (b[d + 9] << 8)) & 0x3fff];
  const bits = b[d + 1] | (b[d + 2] << 8) | (b[d + 3] << 16) | (b[d + 4] << 24);
  return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
}
function webpLosslessAlpha(b, chunks) {
  const c = chunks.find(x => x.type === 'VP8L');
  return c ? ((b[c.data + 4] >> 4) & 1) === 1 : false;
}

/** The compressed image itself (for the "unchanged" proof): JPEG scan data, PNG IDAT, WebP bitstream. */
export function imageData(b) {
  const f = detectFormat(b);
  if (f === 'jpeg') {
    const { sos } = jpegSegments(b);
    return sos < 0 ? new Uint8Array(0) : b.subarray(sos, jpegEnd(b, sos));
  }
  if (f === 'png') return concat(pngChunks(b).chunks.filter(c => c.type === 'IDAT' || c.type === 'fdAT').map(c => b.subarray(c.data, c.data + c.len)));
  if (f === 'webp') return concat(webpChunks(b).filter(c => /^(VP8 |VP8L|ALPH|ANMF)$/.test(c.type)).map(c => b.subarray(c.data, c.data + c.len)));
  return new Uint8Array(0);
}

export function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Set the EXIF orientation tag of a JPEG to 1 in place (after the pixels were rotated) – used when the
 * original EXIF block is carried over into a re-encoded photo. Returns the APP1 segment (or null).
 */
export function exifSegmentUpright(b) {
  if (detectFormat(b) !== 'jpeg') return null;
  const { segs } = jpegSegments(b);
  const s = segs.find(x => isExif(b, x));
  if (!s) return null;
  const seg = b.slice(s.start, s.end);
  const t = s.payload + 6 - s.start;
  const le = seg[t] === 0x49;
  const u16 = o => (le ? seg[o] | (seg[o + 1] << 8) : (seg[o] << 8) | seg[o + 1]);
  const u32 = o => (le ? (seg[o] | (seg[o + 1] << 8) | (seg[o + 2] << 16)) + seg[o + 3] * 2 ** 24 : seg[o] * 2 ** 24 + ((seg[o + 1] << 16) | (seg[o + 2] << 8) | seg[o + 3]));
  const ifd = t + u32(t + 4);
  if (ifd + 2 <= seg.length) {
    const n = u16(ifd);
    for (let k = 0; k < n; k++) {
      const e = ifd + 2 + k * 12;
      if (e + 12 > seg.length) break;
      if (u16(e) === 0x0112) { if (le) { seg[e + 8] = 1; seg[e + 9] = 0; } else { seg[e + 8] = 0; seg[e + 9] = 1; } }
    }
  }
  return seg;
}

/** Insert an APP1 segment right after SOI (+JFIF) of a JPEG produced by the browser. */
export function insertSegment(jpeg, seg) {
  const { segs } = jpegSegments(jpeg);
  const at = segs.length && isJfif(jpeg, segs[0]) ? segs[0].end : 2;
  return concat([jpeg.subarray(0, at), seg, jpeg.subarray(at)]);
}
