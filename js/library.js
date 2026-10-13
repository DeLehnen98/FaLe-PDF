// Document library: importing files into IndexedDB, metadata, thumbnails, text index.
import * as db from './db.js';
import { loadPdf, thumbnailBlob, extractAllText, isPdfBytes, rememberPassword } from './pdfcore.js';
import { toast, progress, UserError, safeFileName } from './ui.js';
import { detectKind, unsupportedReason, ensureExt, KINDS } from './office/kinds.js';
import { track } from './extras/stats.js';

const listeners = new Set();
export function onLibraryChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emitChange() { listeners.forEach(fn => { try { fn(); } catch (e) { console.warn(e); } }); }

/**
 * Import a PDF (File/Blob/bytes) into the library.
 * @returns {Promise<object>} doc metadata
 */
export async function importPdf(input, { name, source = 'Gerät', silent = false, quiet = false } = {}) {
  const fileName = safeFileName(name || input.name || 'Dokument.pdf');
  const finalName = /\.pdf$/i.test(fileName) ? fileName : fileName + '.pdf';
  const buf = input instanceof ArrayBuffer ? input : input instanceof Uint8Array ? input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) : await input.arrayBuffer();
  if (!buf.byteLength) throw new UserError(`„${finalName}“ ist leer.`);
  if (!isPdfBytes(buf)) throw new UserError(`„${finalName}“ ist keine PDF-Datei.`);

  // Same file opened again? Reuse the existing entry.
  const existing = (await db.listDocs()).find(d => d.name === finalName && d.size === buf.byteLength && d.source !== 'Erstellt');
  if (existing && source !== 'Erstellt') {
    await db.updateDoc(existing.id, { openedAt: Date.now() });
    emitChange();
    return existing;
  }

  const id = db.uid();
  const { pdf, password } = await loadPdf(buf, { name: finalName, key: id });
  try {
    let thumb = null;
    try { thumb = await thumbnailBlob(pdf); } catch (e) { console.warn('thumbnail', e); }
    const now = Date.now();
    const meta = {
      id, name: finalName, size: buf.byteLength, pages: pdf.numPages,
      createdAt: now, openedAt: now, starred: false, lastPage: 1,
      encrypted: !!password, thumb, source, textReady: false,
    };
    await db.addDoc(meta, new Blob([buf], { type: 'application/pdf' }));
    track(source === 'Erstellt' ? 'files_created' : 'files_imported');
    if (password) rememberPassword(id, password);
    emitChange();
    // Text index for full-text search, in the background.
    indexText(id, pdf).catch(e => console.warn('text index', e)).finally(() => pdf.destroy());
    if (!silent && !quiet) toast(`„${finalName}“ hinzugefügt`, 'success');
    return meta;
  } catch (err) {
    pdf.destroy();
    throw err;
  }
}

async function indexText(id, pdf) {
  const pages = await extractAllText(pdf);
  await db.putText(id, pages);
  await db.updateDoc(id, { textReady: true });
}

/** Import any supported file (PDF, Office, text, image) into the library. */
export async function importAny(file, opts = {}) {
  const kind = detectKind(file);
  if (!kind) throw new UserError(unsupportedReason(file));
  if (kind === 'pdf') return importPdf(file, opts);
  return importOther(file, kind, opts);
}

const ZIP_KINDS = new Set(['docx', 'xlsx', 'pptx']);

async function importOther(file, kind, { name, source = 'Gerät', silent = false, quiet = false } = {}) {
  const finalName = kind === 'image' ? safeFileName(name || file.name || 'Bild') : ensureExt(safeFileName(name || file.name || 'Dokument'), kind);
  if (!file.size) throw new UserError(`„${finalName}“ ist leer.`);
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (ZIP_KINDS.has(kind) && !(head[0] === 0x50 && head[1] === 0x4b)) {
    if (head[0] === 0xd0 && head[1] === 0xcf) throw new UserError(`„${finalName}“ ist im alten Office-Format gespeichert. Bitte als ${KINDS[kind].ext} speichern.`);
    throw new UserError(`„${finalName}“ ist beschädigt oder keine gültige ${KINDS[kind].ext}-Datei.`);
  }
  const existing = (await db.listFiles()).find(d => d.name === finalName && d.size === file.size && d.kind === kind && d.source !== 'Erstellt');
  if (existing && source !== 'Erstellt') {
    await db.updateDoc(existing.id, { openedAt: Date.now() });
    emitChange();
    return existing;
  }
  const id = db.uid();
  const now = Date.now();
  const type = kind === 'image' ? (file.type || 'image/png') : KINDS[kind].mime;
  const blob = file instanceof Blob && file.type === type ? file : new Blob([await file.arrayBuffer()], { type });
  const meta = { id, kind, name: finalName, size: blob.size, pages: null, createdAt: now, openedAt: now, starred: false, thumb: null, source, textReady: false };
  await db.addDoc(meta, blob);
  track(source === 'Erstellt' ? 'files_created' : 'files_imported');
  emitChange();
  indexOther(id, kind, blob).catch(e => console.warn('index', e));
  if (!silent && !quiet) toast(`„${finalName}“ hinzugefügt`, 'success');
  return meta;
}

/** Background: thumbnail + text index for non-PDF files. */
async function indexOther(id, kind, blob) {
  const { describeFile } = await import('./office/extract.js');
  const info = await describeFile(kind, blob);
  if (!info) return;
  if (info.pages) await db.putText(id, info.pages);
  dropThumb(id);
  await db.updateDoc(id, { textReady: true, thumb: info.thumb || null, pages: info.count ?? null });
  emitChange();
}

/**
 * Save an office file into the library. With `id` the existing entry is replaced (keeps star etc.).
 * @returns {Promise<object>} metadata
 */
export async function saveFile({ id = null, blob, name, kind, source = 'Erstellt' }) {
  const finalName = ensureExt(safeFileName(name), kind);
  const now = Date.now();
  let meta;
  if (id && await db.getDoc(id)) {
    meta = await db.replaceFile(id, blob, { name: finalName, openedAt: now, modifiedAt: now, textReady: false });
  } else {
    id = db.uid();
    meta = { id, kind, name: finalName, size: blob.size, pages: null, createdAt: now, openedAt: now, modifiedAt: now, starred: false, thumb: null, source, textReady: false };
    await db.addDoc(meta, blob);
    track('files_created');
  }
  emitChange();
  indexOther(id, kind, blob).catch(e => console.warn('index', e));
  return meta;
}

/** Import several files, returns imported docs (errors are reported as toasts).
 * PDF only unless `opts.any` is set (the PDF tools rely on getting PDFs back). */
export async function importFiles(files, opts = {}) {
  const list = Array.from(files || []);
  const done = [];
  const prog = list.length > 1 ? progress(`Importiere 0 von ${list.length} …`) : null;
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    prog && prog.set(`Importiere ${i + 1} von ${list.length} …`);
    try {
      done.push(await (opts.any ? importAny(f, { ...opts, quiet: list.length > 1 }) : importPdf(f, { ...opts, quiet: list.length > 1 })));
    } catch (err) {
      toast(err.userMessage || `„${f.name}“ konnte nicht geöffnet werden.`, 'error', { timeout: 5000 });
      if (!err.userMessage) console.warn(err);
    }
  }
  prog && prog.done();
  if (list.length > 1 && done.length) toast(`${done.length} Dokument${done.length === 1 ? '' : 'e'} hinzugefügt`, 'success');
  return done;
}

/** Save tool output bytes as a new library document. */
export async function saveResult(bytes, name) {
  return importPdf(bytes, { name, source: 'Erstellt', silent: true });
}

export async function getDocBytes(id) {
  const blob = await db.getFile(id);
  if (!blob) throw new UserError('Dokument nicht gefunden.');
  return new Uint8Array(await blob.arrayBuffer());
}

// thumbnail object URLs (cached per doc id)
const thumbUrls = new Map();
export function thumbUrl(doc) {
  if (!doc.thumb) return null;
  const cached = thumbUrls.get(doc.id);
  if (cached) return cached.url;
  const url = URL.createObjectURL(doc.thumb);
  thumbUrls.set(doc.id, { url });
  return url;
}
export function dropThumb(id) {
  const c = thumbUrls.get(id);
  if (c) { URL.revokeObjectURL(c.url); thumbUrls.delete(id); }
}
