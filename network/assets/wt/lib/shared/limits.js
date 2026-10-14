// GENERATED – synced copy of js/security.js (resource limits and image header probing only) by scripts/sync-webtools-vendor.mjs.
// Do not edit here: change the source in the app and run `node scripts/sync-webtools-vendor.mjs`.
// FaLe PDF – client-side security helpers in ONE place (see docs/SECURITY.md).
//
//   safeUrl(href)               → normalised http(s)/mailto/tel URL or null (never javascript:, data:, file: …)
//   openExternal(href)          → asks before leaving the app, then opens with noopener/noreferrer
//   cssColor(value, fallback)   → a value that is safe inside style="…" (hex / rgb() / named colour only)
//   copySecret(text)            → clipboard copy that is cleared again after 60 s (recovery key, Wi-Fi password)
//   screenSecure(on)            → Android: FLAG_SECURE while sensitive screens are open (no screenshots / recents preview)
//   loadPurify() / sanitizeDocHtml(html)  → DOMPurify (vendored, lazy) for rich document HTML (docx/md import, paste)
//   LIMITS / assertImageSize()  → resource limits against decompression / dimension bombs
//
// Escaping of untrusted text into HTML stays ui.js esc() (used everywhere); this module adds the
// pieces that need more than escaping.

// ---------------------------------------------------------------- resource limits
export const LIMITS = Object.freeze({
  imagePixels: 100e6,          // decoded image (≈ 400 MB RGBA) – pdf.js maxImageSize and our own decoders
  canvasPixels: 40e6,          // one rendered canvas (≈ 160 MB RGBA)
  zipEntries: 20000,           // entries in a .docx/.xlsx/.pptx
  zipTotalBytes: 1024 * 1024 * 1024, // declared uncompressed size of all entries (1 GiB)
  zipEntryBytes: 512 * 1024 * 1024,  // one entry (512 MiB)
  zipRatio: 1000,              // compression ratio of one entry above 1 MiB (zip bomb signature)
});

export class LimitError extends Error {
  constructor(msg) { super(msg); this.name = 'LimitError'; this.userMessage = msg; }
}

/** Throws a user-facing LimitError when an image is larger than LIMITS.imagePixels. */
export function assertImageSize(w, h, what = 'Das Bild') {
  const px = Number(w) * Number(h);
  if (!Number.isFinite(px) || px > LIMITS.imagePixels) {
    throw new LimitError(`${what} ist zu groß (${Math.round(w)} × ${Math.round(h)} Pixel). Bitte verkleinere es zuerst.`);
  }
}

/**
 * Image dimensions from the file header (PNG, JPEG, GIF, BMP, WebP) WITHOUT decoding the pixels –
 * so a 50 000 × 50 000 "dimension bomb" is rejected before the browser allocates gigabytes.
 * Resolves {w, h} or null (unknown format → the caller's own checks apply).
 */
export async function probeImageSize(blob) {
  if (!blob || typeof blob.slice !== 'function') return null;
  const b = new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer());
  const u16be = i => (b[i] << 8) | b[i + 1], u16le = i => b[i] | (b[i + 1] << 8);
  const u32be = i => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  const u32le = i => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + ((b[i + 3] << 24) >>> 0);
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { w: u32be(16), h: u32be(20) }; // PNG IHDR
  if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { w: u16le(6), h: u16le(8) }; // GIF
  if (b.length >= 26 && b[0] === 0x42 && b[1] === 0x4d) return { w: Math.abs(u32le(18) | 0), h: Math.abs(u32le(22) | 0) }; // BMP
  if (b.length >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) { // RIFF…WEBP
    const tag = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (tag === 'VP8X') return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (tag === 'VP8L') { const v = u32le(21); return { w: 1 + (v & 0x3fff), h: 1 + ((v >>> 14) & 0x3fff) }; }
    if (tag === 'VP8 ') return { w: u16le(26) & 0x3fff, h: u16le(28) & 0x3fff };
    return null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) { // JPEG: walk the markers to the first SOFn
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
      const len = u16be(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: u16be(i + 7), h: u16be(i + 5) };
      i += 2 + len;
    }
    return null;
  }
  return null;
}

/** Reject image files whose header declares more than LIMITS.imagePixels (before decoding them). */
export async function assertImageBlob(blob, what = 'Das Bild') {
  let d = null;
  try { d = await probeImageSize(blob); } catch { d = null; }
  if (d) assertImageSize(d.w, d.h, what);
  return d;
}

/** Scale factor (≤ 1) that keeps a canvas of w × h within LIMITS.canvasPixels. */
export function canvasScaleCap(w, h, max = LIMITS.canvasPixels) {
  const px = w * h;
  return px > max ? Math.sqrt(max / px) : 1;
}

// ---------------------------------------------------------------- URLs
