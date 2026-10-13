// Lazy loader for pdf-lib (UMD build → window.PDFLib) plus shared helpers.
import { UserError } from './ui.js';
import { knownPassword, rememberPassword, askPassword, PasswordCancelled, rememberBytesPassword } from './pdfcore.js';

let loading = null;
export function loadPdfLib() {
  if (window.PDFLib) return Promise.resolve(window.PDFLib);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/pdf-lib/pdf-lib.min.js', import.meta.url).href;
    s.async = true;
    s.onload = () => (window.PDFLib ? resolve(window.PDFLib) : reject(new Error('pdf-lib fehlt')));
    s.onerror = () => { loading = null; reject(new UserError('Die PDF-Bibliothek konnte nicht geladen werden.')); };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * Load a PDF for editing with pdf-lib. Password-protected files are decrypted transparently
 * (the password is taken from this session or asked for). The returned document is unencrypted;
 * `pdfDoc.faleWasEncrypted` tells whether the source was protected.
 * @param {Uint8Array} bytes
 * @param {string} name   file name for messages
 * @param {{key?: string, prompt?: boolean}} [opts]  key = library doc id (session password cache)
 */
export async function loadEditable(bytes, name = 'Dokument', { key = null, prompt = true } = {}) {
  const PDFLib = await loadPdfLib();
  // Encrypted files go straight to the decrypting loader (pdf-lib alone would choke on the
  // encrypted object streams and log parser warnings first).
  if (hasEncryptKey(bytes)) return loadProtected(bytes, name, { key, prompt });
  try {
    return await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    if (!(err && /encrypt/i.test(err.message || ''))) {
      throw new UserError(`„${name}“ konnte nicht verarbeitet werden (beschädigte oder ungewöhnliche PDF).`);
    }
  }
  return loadProtected(bytes, name, { key, prompt });
}

/** Cheap check for an /Encrypt entry in the (never compressed) trailer / xref stream dictionaries. */
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
  // trailers / xref streams sit at the end; linearized files also have one near the start
  return scan(u8.length - 262144, u8.length) || scan(0, 16384);
}

/** Decrypt a protected PDF into a pdf-lib document. */
export async function loadProtected(bytes, name = 'Dokument', { key = null, prompt = true, passwords = [] } = {}) {
  const PDFLib = await loadPdfLib();
  const { loadDecrypted, PasswordRequiredError } = await import('./pdfcrypt.js');
  const known = key ? knownPassword(key) : null;
  try {
    const r = await loadDecrypted(PDFLib, bytes, {
      passwords: [known, ...passwords].filter(p => p != null),
      askPassword: prompt ? wrong => askPassword(name, wrong) : null,
    });
    if (key && r.password) rememberPassword(key, r.password);
    r.pdfDoc.faleWasEncrypted = r.encrypted;
    r.pdfDoc.falePassword = r.password;
    r.pdfDoc.faleEncryption = r.info;
    return r.pdfDoc;
  } catch (e) {
    if (e instanceof PasswordRequiredError) {
      if (!prompt && e.wrong) throw new UserError('Das Passwort ist falsch.');
      throw new PasswordCancelled();
    }
    if (e && e.userMessage) throw e;
    console.warn(e);
    throw new UserError(`„${name}“ konnte nicht entschlüsselt werden.`);
  }
}

export async function saveDoc(pdfDoc) {
  pdfDoc.setProducer('FaLe PDF');
  pdfDoc.setModificationDate(new Date());
  return pdfDoc.save({ useObjectStreams: true });
}

/**
 * Save with AES-256 password protection.
 * @param {object} pdfDoc  pdf-lib document (unencrypted)
 * @param {{userPassword: string, ownerPassword?: string, permissions?: {printing?: boolean, copying?: boolean, editing?: boolean}, onProgress?: Function}} opts
 */
export async function saveProtected(pdfDoc, opts) {
  const PDFLib = await loadPdfLib();
  const { encryptDocument } = await import('./pdfcrypt.js');
  pdfDoc.setProducer('FaLe PDF');
  pdfDoc.setModificationDate(new Date());
  try { if (pdfDoc.getForm().getFields().length) pdfDoc.getForm().updateFieldAppearances(); } catch {}
  await encryptDocument(PDFLib, pdfDoc, opts);
  const bytes = await pdfDoc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false });
  rememberBytesPassword(bytes, opts.userPassword);
  return bytes;
}
