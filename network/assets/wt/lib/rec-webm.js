// WebM files from MediaRecorder carry no duration: players show no length and can't seek. This writes a
// Duration element into the Segment's Info header (EBML / Matroska), touching only the first bytes of the
// file – the rest of the recording (which may be gigabytes on disk) is passed through as a Blob slice.

const ID = { EBML: 0x1a45dfa3, Segment: 0x18538067, Info: 0x1549a966, SeekHead: 0x114d9b74, Duration: 0x4489, TimecodeScale: 0x2ad7b1, Cluster: 0x1f43b675 };

function readId(b, p) {
  const first = b[p];
  if (first === undefined) return null;
  let len = 1;
  while (len <= 4 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 4 || p + len > b.length) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + b[p + i];
  return { id, len };
}
function readSize(b, p) {
  const first = b[p];
  if (first === undefined) return null;
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8 || p + len > b.length) return null;
  let v = first & (0xff >> len), allOnes = v === (0xff >> len);
  for (let i = 1; i < len; i++) { v = v * 256 + b[p + i]; if (b[p + i] !== 0xff) allOnes = false; }
  return { size: allOnes ? -1 : v, len };
}
/** Size as an EBML vint of exactly `len` bytes (null if it doesn't fit). */
function writeSize(v, len) {
  if (v >= 2 ** (7 * len) - 1) return null;
  const out = new Uint8Array(len);
  let x = v;
  for (let i = len - 1; i >= 0; i--) { out[i] = x % 256; x = Math.floor(x / 256); }
  out[0] |= 0x80 >> (len - 1);
  return out;
}
function readUint(b, p, n) { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + b[p + i]; return v; }

/**
 * Patch the head of a WebM file. head: Uint8Array of the first bytes (64 KB is plenty). durationMs: length.
 * → { head: Uint8Array, cut: number } – replace head.subarray(0, cut) by `head` – or null if the file can't
 * be patched safely (unknown layout, a SeekHead whose offsets would shift, Info not in the first bytes).
 */
export function patchWebmHead(head, durationMs) {
  const b = head;
  let p = 0;
  const e = readId(b, p);
  if (!e || e.id !== ID.EBML) return null;
  const es = readSize(b, p + e.len);
  if (!es || es.size < 0) return null;
  p += e.len + es.len + es.size;
  const s = readId(b, p);
  if (!s || s.id !== ID.Segment) return null;
  const segSizePos = p + s.len;
  const ss = readSize(b, segSizePos);
  if (!ss) return null;
  let q = segSizePos + ss.len;
  while (q < b.length) {
    const c = readId(b, q);
    if (!c) return null;
    const cs = readSize(b, q + c.len);
    if (!cs) return null;
    if (c.id === ID.SeekHead || c.id === ID.Cluster) return null;   // offsets would shift / no Info before media
    if (c.id === ID.Info) {
      if (cs.size < 0) return null;
      const start = q + c.len + cs.len, end = start + cs.size;
      if (end > b.length) return null;
      let scale = 1e6, durPos = -1, durLen = 0;
      for (let r = start; r < end;) {
        const x = readId(b, r); const xs = x && readSize(b, r + x.len);
        if (!x || !xs || xs.size < 0) return null;
        const v = r + x.len + xs.len;
        if (x.id === ID.TimecodeScale) scale = readUint(b, v, xs.size) || 1e6;
        if (x.id === ID.Duration) { durPos = v; durLen = xs.size; }
        r = v + xs.size;
      }
      const value = (durationMs * 1e6) / scale;
      if (durPos >= 0) {   // overwrite in place
        const out = b.slice(0, end);
        const dv = new DataView(out.buffer, out.byteOffset);
        if (durLen === 8) dv.setFloat64(durPos, value); else if (durLen === 4) dv.setFloat32(durPos, value); else return null;
        return { head: out, cut: end };
      }
      const dur = new Uint8Array(11);
      dur[0] = 0x44; dur[1] = 0x89; dur[2] = 0x88;
      new DataView(dur.buffer).setFloat64(3, value);
      const newSize = writeSize(cs.size + dur.length, 8);
      const parts = [b.subarray(0, q), b.subarray(q, q + c.len), newSize, b.subarray(start, end), dur];
      const delta = (8 - cs.len) + dur.length;
      const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
      let o = 0;
      for (const x of parts) { out.set(x, o); o += x.length; }
      if (ss.size >= 0) {   // a known Segment size grows by delta
        const sz = writeSize(ss.size + delta, ss.len);
        if (!sz) return null;
        out.set(sz, segSizePos);
      }
      return { head: out, cut: end };
    }
    if (cs.size < 0) return null;
    q += c.len + cs.len + cs.size;
  }
  return null;
}

/** Blob with the duration written in (or the blob unchanged when it can't be patched). */
export async function withDuration(blob, durationMs) {
  if (!/webm/i.test(blob.type) || !(durationMs > 0)) return blob;
  const head = new Uint8Array(await blob.slice(0, 65536).arrayBuffer());
  const r = patchWebmHead(head, durationMs);
  return r ? new Blob([r.head, blob.slice(r.cut)], { type: blob.type }) : blob;
}
