// Streaming ZIP reader for large archives (Google Takeout): reads only the central directory up front and
// extracts one entry at a time from Blob slices. STORE entries are returned as slices of the archive
// (no copy), DEFLATE entries are inflated with the browser's DecompressionStream('deflate-raw').
// ZIP64 (archives > 4 GB, the usual Takeout size) is supported. No encryption, no multi-disk archives.
const td = new TextDecoder();
const tdLatin = new TextDecoder('latin1');

async function bytes(file, start, end) { return new Uint8Array(await file.slice(start, end).arrayBuffer()); }
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;
const u64 = (b, o) => u32(b, o) + u32(b, o + 4) * 0x100000000;

/** → [{ name, dir, base, method, csize, usize, offset, crc, mtime }] */
export async function listZip(file) {
  const tailLen = Math.min(file.size, 65557 + 20);
  const tail = await bytes(file, file.size - tailLen, file.size);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (u32(tail, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw Object.assign(new Error('not a zip'), { code: 'bad_zip' });
  let count = u16(tail, eocd + 10), cdSize = u32(tail, eocd + 12), cdOff = u32(tail, eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) { // ZIP64 locator right before the EOCD
    const loc = eocd - 20;
    if (loc < 0 || u32(tail, loc) !== 0x07064b50) throw Object.assign(new Error('zip64 locator missing'), { code: 'bad_zip' });
    const z64 = await bytes(file, u64(tail, loc + 8), u64(tail, loc + 8) + 56);
    if (u32(z64, 0) !== 0x06064b50) throw Object.assign(new Error('zip64 eocd missing'), { code: 'bad_zip' });
    count = u64(z64, 32); cdSize = u64(z64, 40); cdOff = u64(z64, 48);
  }
  if (cdSize > 256 * 1024 * 1024) throw Object.assign(new Error('central directory too large'), { code: 'bad_zip' });
  const cd = await bytes(file, cdOff, cdOff + cdSize);
  const out = [];
  for (let p = 0, n = 0; n < count && p + 46 <= cd.length; n++) {
    if (u32(cd, p) !== 0x02014b50) break;
    const flags = u16(cd, p + 8), method = u16(cd, p + 10);
    const time = u16(cd, p + 12), date = u16(cd, p + 14);
    let csize = u32(cd, p + 20), usize = u32(cd, p + 24);
    const nl = u16(cd, p + 28), xl = u16(cd, p + 30), cl = u16(cd, p + 32);
    let offset = u32(cd, p + 42);
    const nameBytes = cd.subarray(p + 46, p + 46 + nl);
    const name = (flags & 0x800) ? td.decode(nameBytes) : (() => { try { return new TextDecoder('utf-8', { fatal: true }).decode(nameBytes); } catch { return tdLatin.decode(nameBytes); } })();
    let x = p + 46 + nl;
    const xe = x + xl;
    while (x + 4 <= xe) { // ZIP64 extra field
      const id = u16(cd, x), sz = u16(cd, x + 2);
      if (id === 0x0001) {
        let q = x + 4;
        if (usize === 0xffffffff) { usize = u64(cd, q); q += 8; }
        if (csize === 0xffffffff) { csize = u64(cd, q); q += 8; }
        if (offset === 0xffffffff) { offset = u64(cd, q); q += 8; }
      }
      x += 4 + sz;
    }
    p = xe + cl;
    if (name.endsWith('/') || (flags & 1)) continue; // directories, encrypted entries
    const slash = name.lastIndexOf('/');
    const mtime = new Date(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2).getTime();
    out.push({ name, dir: slash >= 0 ? name.slice(0, slash) : '', base: slash >= 0 ? name.slice(slash + 1) : name, method, csize, usize, offset, mtime });
  }
  return out;
}

/** Entry contents as a Blob (type given by the caller). */
export async function readEntry(file, e, type = '') {
  const lh = await bytes(file, e.offset, e.offset + 30);
  if (u32(lh, 0) !== 0x04034b50) throw Object.assign(new Error('bad local header'), { code: 'bad_zip' });
  const start = e.offset + 30 + u16(lh, 26) + u16(lh, 28);
  const raw = file.slice(start, start + e.csize);
  if (e.method === 0) return raw.slice(0, raw.size, type);
  if (e.method !== 8 || typeof DecompressionStream === 'undefined') throw Object.assign(new Error('unsupported method'), { code: 'zip_method' });
  const blob = await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob();
  if (blob.size !== e.usize) throw Object.assign(new Error('size mismatch'), { code: 'bad_zip' });
  return type ? blob.slice(0, blob.size, type) : blob;
}
export async function readJson(file, e) {
  if (e.usize > 2 * 1024 * 1024) return null;
  try { return JSON.parse(await (await readEntry(file, e)).text()); } catch { return null; }
}
