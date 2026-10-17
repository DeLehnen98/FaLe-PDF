// Lazy loaders for pdf.js and pdf-lib with the same hardened settings as the FaLe PDF app
// (js/pdfcore.js): no eval, no PDF JavaScript, no XFA, local cMaps/fonts/wasm/ICC only, image size cap.
import './tt.js';
import { LIMITS, canvasScaleCap } from './shared/limits.js';
import { tunePdfLib } from './shared/pdflibtune.js';

const VENDOR = new URL('../vendor/', import.meta.url).href;
const PDFJS = VENDOR + 'pdfjs/';

export const DOC_OPTIONS = {
  cMapUrl: PDFJS + 'cmaps/',
  cMapPacked: true,
  standardFontDataUrl: PDFJS + 'standard_fonts/',
  wasmUrl: PDFJS + 'wasm/',
  iccUrl: PDFJS + 'iccs/',
  isEvalSupported: false,
  enableXfa: false,
  enableScripting: false,
  maxImageSize: LIMITS.imagePixels,
  disableAutoFetch: true,
  useSystemFonts: true,
};

let pdfjsPromise = null;
let sharedWorker = null;

/** pdf.js module (loaded once, on first use). */
export function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('../vendor/pdfjs/pdf.min.mjs').then(lib => {
      lib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs';
      return lib;
    }).catch(err => { pdfjsPromise = null; throw err; });
  }
  return pdfjsPromise;
}

async function worker() {
  const lib = await loadPdfjs();
  if (!sharedWorker || sharedWorker.destroyed) sharedWorker = new lib.PDFWorker({ name: 'fale-wt' });
  return sharedWorker;
}

export class PasswordError extends Error {
  /** @param {'needed'|'wrong'} reason */
  constructor(reason) { super(reason === 'wrong' ? 'Wrong password' : 'Password required'); this.name = 'PasswordError'; this.reason = reason; }
}
export class BadPdfError extends Error { constructor(msg) { super(msg || 'Invalid PDF'); this.name = 'BadPdfError'; } }

/**
 * Open a PDF with pdf.js. Never prompts: throws PasswordError('needed'|'wrong') instead, so the
 * shell can ask inline on the file card.
 * @param {Uint8Array} bytes  (copied – pdf.js transfers its buffer to the worker)
 * @param {string|null} password
 */
export async function openPdfjs(bytes, password = null) {
  const lib = await loadPdfjs();
  const task = lib.getDocument({ ...DOC_OPTIONS, data: bytes.slice(), worker: await worker(), password: password ?? undefined });
  let pwReason = null;
  task.onPassword = (update, reason) => {
    pwReason = reason === lib.PasswordResponses.INCORRECT_PASSWORD ? 'wrong' : 'needed';
    task.destroy();
  };
  try {
    const doc = await task.promise;
    if (typeof doc.destroy !== 'function') doc.destroy = () => task.destroy();
    return doc;
  } catch (err) {
    if (pwReason || (err && err.name === 'PasswordException')) throw new PasswordError(pwReason || (password ? 'wrong' : 'needed'));
    if (err && (err.name === 'InvalidPDFException' || err.name === 'FormatError')) throw new BadPdfError(err.message);
    throw err;
  }
}

/** Render a pdf.js page into a new canvas (white background). Give width (css px) or scale. */
export async function renderPage(page, { width = null, scale = null, dpr = 1, background = 'white', signal = null } = {}) {
  const base = page.getViewport({ scale: 1 });
  let s = (scale || (width / base.width)) * dpr;
  s *= canvasScaleCap(base.width * s, base.height * s);
  const vp = page.getViewport({ scale: s });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const task = page.render({ canvasContext: ctx, canvas, viewport: vp, background });
  const abort = () => task.cancel();
  signal?.addEventListener('abort', abort);
  try { await task.promise; } finally { signal?.removeEventListener('abort', abort); }
  return canvas;
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.85) {
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('canvas.toBlob failed'))), type, quality));
}

// ---------------------------------------------------------------- pdf-lib
let pdflibPromise = null;
/** pdf-lib namespace (UMD build evaluated as a module; it attaches itself to globalThis.PDFLib). */
export function loadPdfLib() {
  if (globalThis.PDFLib) return Promise.resolve(tunePdfLib(globalThis.PDFLib));
  if (!pdflibPromise) {
    pdflibPromise = import('../vendor/pdf-lib/pdf-lib.min.js').then(() => {
      if (!globalThis.PDFLib) throw new Error('pdf-lib missing');
      return tunePdfLib(globalThis.PDFLib);
    }).catch(err => { pdflibPromise = null; throw err; });
  }
  return pdflibPromise;
}

/** Cheap check for an /Encrypt entry in the trailer area (same as the app's js/pdflib.js). */
export function hasEncryptKey(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const pat = [0x2f, 0x45, 0x6e, 0x63, 0x72, 0x79, 0x70, 0x74]; // "/Encrypt"
  const scan = (from, to) => {
    for (let i = Math.max(0, from); i < Math.min(u8.length, to) - 8; i++) {
      if (u8[i] !== 0x2f || u8[i + 1] !== 0x45) continue;
      let ok = true;
      for (let k = 2; k < 8; k++) if (u8[i + k] !== pat[k]) { ok = false; break; }
      if (ok && !/[A-Za-z0-9]/.test(String.fromCharCode(u8[i + 8] || 32))) return true;
    }
    return false;
  };
  return scan(u8.length - 262144, u8.length) || scan(0, 16384);
}

/**
 * Load a PDF into pdf-lib, decrypting it when needed (js/pdfcrypt.js, synced to lib/shared/).
 * Returns the document; doc.wtEncrypted tells whether the source was encrypted.
 * @throws {PasswordError|BadPdfError}
 */
export async function loadPdfDoc(bytes, password = null) {
  const PDFLib = await loadPdfLib();
  if (!hasEncryptKey(bytes)) {
    try {
      const doc = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
      doc.wtEncrypted = false;
      return doc;
    } catch (err) {
      if (!/encrypt/i.test(err?.message || '')) throw new BadPdfError(err?.message);
    }
  }
  const { loadDecrypted, PasswordRequiredError } = await import('./shared/pdfcrypt.js');
  try {
    const r = await loadDecrypted(PDFLib, bytes, { passwords: password ? [password] : [] });
    r.pdfDoc.wtEncrypted = r.encrypted;
    r.pdfDoc.wtPassword = r.password;
    return r.pdfDoc;
  } catch (err) {
    if (err instanceof PasswordRequiredError) throw new PasswordError(err.wrong ? 'wrong' : 'needed');
    if (err?.userMessage) throw new BadPdfError(err.userMessage);
    throw new BadPdfError(err?.message);
  }
}

/** Save with the FaLe defaults (object streams = smaller files). */
export async function saveDoc(doc, { title = null, objectStreams = true } = {}) {
  doc.setProducer('FaLe Werkzeuge (fale.network)');
  doc.setCreator('FaLe Werkzeuge');
  doc.setModificationDate(new Date());
  if (title) doc.setTitle(title, { showInWindowTitleBar: false });
  return doc.save({ useObjectStreams: objectStreams, addDefaultPage: false });
}

/** Re-encrypt with AES-256 (user password, all permissions) – used to keep protection on results. */
export async function saveEncrypted(doc, userPassword, { title = null } = {}) {
  const PDFLib = await loadPdfLib();
  const { encryptDocument } = await import('./shared/pdfcrypt.js');
  doc.setProducer('FaLe Werkzeuge (fale.network)');
  doc.setModificationDate(new Date());
  if (title) doc.setTitle(title, { showInWindowTitleBar: false });
  await encryptDocument(PDFLib, doc, { userPassword, objectStreams: true });   // compact: encrypted object streams
  return doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
}

let jszipPromise = null;
/** JSZip (for tools that read ZIP based formats). Writing a download ZIP: use lib/shared/zip.js. */
export function loadJSZip() {
  if (globalThis.JSZip) return Promise.resolve(globalThis.JSZip);
  if (!jszipPromise) jszipPromise = import('../vendor/jszip/jszip.min.js').then(() => globalThis.JSZip);
  return jszipPromise;
}
