// Input files: a wrapper around File with lazy, cached helpers for tool modules.
//
//   input.kind        'pdf' | 'image' | 'other'
//   input.format      'pdf' | 'jpeg' | 'png' | 'webp' | 'gif' | 'bmp' | 'avif' | 'heic' | 'tiff' | 'svg' | ''
//   input.bytes()     Promise<Uint8Array>            (read once, cached)
//   input.pdfjs()     Promise<PDFDocumentProxy>       (pdf.js, uses input.password)
//   input.pageCount() Promise<number>
//   input.pdfDoc()    Promise<PDFDocument>            (pdf-lib, decrypted, a fresh copy each call)
//   input.bitmap()    Promise<ImageBitmap>            (images, EXIF orientation applied by the browser)
//   input.imageInfo() Promise<{width, height, orientation, components}>  (header only, no decode)
//   input.thumbnail(width) Promise<HTMLCanvasElement>
//   input.opts        per-file option values (option schema entries with perFile: true)
import { openPdfjs, loadPdfDoc, renderPage, PasswordError } from './pdf.js';
import { probeImageSize, LIMITS } from './shared/limits.js';
import { extension } from './format.js';

let seq = 0;

const EXT_FORMAT = { pdf: 'pdf', jpg: 'jpeg', jpeg: 'jpeg', jpe: 'jpeg', jfif: 'jpeg', png: 'png', webp: 'webp', gif: 'gif', bmp: 'bmp', avif: 'avif', heic: 'heic', heif: 'heic', tif: 'tiff', tiff: 'tiff', svg: 'svg' };
const MIME_FORMAT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/avif': 'avif', 'image/heic': 'heic', 'image/heif': 'heic', 'image/tiff': 'tiff', 'image/svg+xml': 'svg' };
export const FORMAT_MIME = { pdf: 'application/pdf', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif', heic: 'image/heic', tiff: 'image/tiff', svg: 'image/svg+xml' };

/** Detect the real format from the first bytes (falls back to MIME type / extension). */
export function sniff(head, name = '', mime = '') {
  const b = head;
  const s = (i, n) => String.fromCharCode(...b.subarray(i, i + n));
  if (b.length >= 5) {
    for (let i = 0; i < Math.min(b.length - 4, 1024); i++) if (b[i] === 0x25 && s(i, 5) === '%PDF-') return 'pdf';
  }
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && s(1, 3) === 'PNG') return 'png';
  if (s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return 'webp';
  if (s(0, 4) === 'GIF8') return 'gif';
  if (s(0, 2) === 'BM') return 'bmp';
  if ((s(0, 4) === 'II*\0') || (s(0, 4) === 'MM\0*')) return 'tiff';
  if (s(4, 4) === 'ftyp') {
    const brands = s(8, 4) + s(16, Math.min(32, b.length - 16));
    if (/avif|avis/.test(brands)) return 'avif';
    if (/heic|heix|hevc|heim|heis|hevm|hevs|mif1|msf1/.test(brands)) return 'heic';
  }
  if (/^\s*(<\?xml|<svg)/i.test(s(0, Math.min(64, b.length)))) return 'svg';
  return MIME_FORMAT[String(mime).toLowerCase()] || EXT_FORMAT[extension(name)] || '';
}

/** EXIF orientation (1–8) and basic SOF data of a JPEG, from the header bytes. */
export function jpegInfo(b) {
  const info = { orientation: 1, width: 0, height: 0, components: 0, progressive: false };
  if (!(b[0] === 0xff && b[1] === 0xd8)) return info;
  let i = 2;
  while (i + 4 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
    if (m === 0xd9 || m === 0xda) break;
    const len = (b[i + 2] << 8) | b[i + 3];
    if (m === 0xe1 && len > 8 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
      info.orientation = exifOrientation(b, i + 10, Math.min(b.length, i + 2 + len)) || 1;
    }
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc && i + 9 < b.length) {
      info.height = (b[i + 5] << 8) | b[i + 6];
      info.width = (b[i + 7] << 8) | b[i + 8];
      info.components = b[i + 9];
      info.progressive = m === 0xc2;
    }
    i += 2 + len;
  }
  return info;
}

function exifOrientation(b, tiff, end) {
  if (tiff + 8 > end) return 0;
  const le = b[tiff] === 0x49;
  const u16 = o => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = o => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 2 ** 24 : b[o] * 2 ** 24 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]));
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return 0;
  const n = u16(ifd);
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > end) break;
    if (u16(e) === 0x0112) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 0; }
  }
  return 0;
}

export class InputFile {
  constructor(file, format) {
    this.id = 'f' + (++seq);
    this.file = file;
    this.name = file.name || 'Datei';
    this.size = file.size;
    this.format = format || '';
    this.type = FORMAT_MIME[this.format] || file.type || '';
    this.kind = this.format === 'pdf' ? 'pdf' : (this.format && this.format !== 'svg' && this.format !== 'tiff' ? 'image' : 'other');
    this.opts = {};
    this.password = null;
    this.locked = false;   // needs a password before it can be used
    this.error = null;     // {key, vars} – shell shows it and skips the file
    this._bytes = null;
    this._pdf = null;
    this._pages = null;
  }

  static async from(file) {
    const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
    return new InputFile(file, sniff(head, file.name, file.type));
  }

  async bytes() {
    if (!this._bytes) this._bytes = new Uint8Array(await this.file.arrayBuffer());
    return this._bytes;
  }

  /** pdf.js document (cached). Throws PasswordError when locked. */
  async pdfjs() {
    if (this._pdf) return this._pdf;
    this._pdf = openPdfjs(await this.bytes(), this.password).catch(err => { this._pdf = null; throw err; });
    return this._pdf;
  }

  async pageCount() {
    if (this._pages == null) this._pages = (await this.pdfjs()).numPages;
    return this._pages;
  }

  /** pdf-lib document, decrypted (fresh object each call – tools may modify it). */
  async pdfDoc() { return loadPdfDoc(await this.bytes(), this.password); }

  /** Try to open with a password; true on success. */
  async unlock(password) {
    this.password = password;
    this._pdf = null;
    try {
      await this.pdfjs();
      this.locked = false;
      return true;
    } catch (err) {
      if (err instanceof PasswordError) return false;
      throw err;
    }
  }

  async imageInfo() {
    if (this._info) return this._info;
    const head = new Uint8Array(await this.file.slice(0, 256 * 1024).arrayBuffer());
    let info = { width: 0, height: 0, orientation: 1, components: 0 };
    if (this.format === 'jpeg') info = jpegInfo(head);
    else {
      const d = await probeImageSize(this.file).catch(() => null);
      if (d) { info.width = d.w; info.height = d.h; }
    }
    if (info.width * info.height > LIMITS.imagePixels) { const e = new Error('too big'); e.wtKey = 'too_big'; throw e; }
    this._info = info;
    return info;
  }

  /** Decoded image with the EXIF orientation applied. Caller should .close() it when done. */
  async bitmap() {
    await this.imageInfo();
    try {
      return await createImageBitmap(this.file, { imageOrientation: 'from-image' });
    } catch {
      // Safari < 17 and some formats only decode through <img>
      const url = URL.createObjectURL(this.file);
      try {
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
        await img.decode();
        return await createImageBitmap(img);
      } finally { URL.revokeObjectURL(url); }
    }
  }

  /** Thumbnail canvas (first page or the image) at the given CSS width. */
  async thumbnail(width = 72, signal = null) {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (this.kind === 'pdf') {
      const doc = await this.pdfjs();
      const page = await doc.getPage(1);
      try { return await renderPage(page, { width, dpr, signal }); } finally { page.cleanup(); }
    }
    const bmp = await this.bitmap();
    const scale = Math.min(1, (width * dpr) / bmp.width);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * scale));
    c.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    this._dims = { width: bmp.width, height: bmp.height };
    bmp.close?.();
    return c;
  }

  release() {
    if (this._pdf) this._pdf.then(d => d.destroy()).catch(() => {});
    this._pdf = null;
    this._bytes = null;
  }
}

/** Does a file (format/type/name) match an accept list like ["application/pdf", ".pdf", "image/*"]? */
export function accepted(input, accepts) {
  const mime = input.type || '';
  const ext = '.' + extension(input.name);
  return accepts.some(a => {
    a = a.toLowerCase();
    if (a.endsWith('/*')) return mime.startsWith(a.slice(0, -1));
    if (a.startsWith('.')) return a === ext || (FORMAT_MIME[EXT_FORMAT[a.slice(1)]] && FORMAT_MIME[EXT_FORMAT[a.slice(1)]] === mime);
    return a === mime;
  });
}
