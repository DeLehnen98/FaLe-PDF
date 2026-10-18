// „Im Original speichern“: remembers where a library document came from, so edits can replace the original file.
//   Android app: files opened with „Öffnen mit“ / „Bearbeiten mit“ (FaleIncoming plugin keeps the content URI for this
//                app run; writable only if the other app granted write access).
//   Browser:     files opened via the installed web app (launchQueue) or the file picker of browsers with the File
//                System Access API – the FileSystemFileHandle is kept in IndexedDB; the browser asks once for write
//                permission.
// Nothing is ever written without a tap by the user. The library copy is never replaced by this module.
import * as db from './db.js';
import { isNative, plugin, platformName, writeChunkedTo } from './platform.js';

const KEY = id => `origin:${id}`;
const mem = new Map(); // docId → origin (native tokens live only here; web handles also in IndexedDB)

const extOf = name => { const m = /\.([a-z0-9]{1,6})$/i.exec(String(name || '')); return m ? '.' + m[1].toLowerCase() : ''; };

/** Attach origin info to an incoming File (read again by rememberFromFile after the import). */
export function tagFile(file, origin) {
  try { Object.defineProperty(file, 'faleOrigin', { value: origin, enumerable: false, configurable: true }); } catch { /* frozen */ }
  return file;
}

/** After importing `file` as library document `docId`. */
export async function rememberFromFile(docId, file) {
  const o = file && file.faleOrigin;
  if (!docId || !o) return;
  const rec = { ...o, name: o.name || file.name, ext: extOf(o.name || file.name), at: Date.now() };
  mem.set(docId, rec);
  selfTest(docId, rec);
  if (rec.type === 'web') {
    try { await db.putDeviceSetting(KEY(docId), rec); } catch { /* handle not storable (e.g. tests): memory only */ }
  }
}

/**
 * Debug builds of the native apps only (Capacitor.DEBUG): a file named fale-e2e-writeback.pdf is written back at
 * once with a marker appended – lets the simulator/emulator test check the whole native write path
 * (.github/workflows/ios.yml). Release builds never do this.
 */
function selfTest(docId, rec) {
  let debug = false;
  try { debug = isNative() && !!(window.Capacitor && window.Capacitor.DEBUG); } catch { /* no window */ }
  if (!isNative()) return;
  // rec.e2e: set by the native test builds only (iOS FaleE2E flag); Capacitor.DEBUG: debug builds
  if (!(debug || rec.e2e === true) || rec.type !== 'native' || rec.name !== 'fale-e2e-writeback.pdf') return;
  console.info(`FALE-E2E self-test: imported doc=${docId}, writing back`);
  setTimeout(async () => {
    try {
      const blob = await db.getFile(docId);
      await writeOriginal(docId, new Blob([blob, '\n% FALE-E2E-WRITEBACK-OK\n'], { type: 'application/pdf' }));
      console.info('FALE-E2E write-back ok');
    } catch (e) { console.error('FALE-E2E write-back failed: ' + (e.code || e.message)); }
  }, 500);
}

async function load(docId) {
  if (!docId) return null;
  if (mem.has(docId)) return mem.get(docId);
  const rec = await db.getDeviceSetting(KEY(docId)).catch(() => null);
  if (rec && rec.type === 'web' && rec.handle) { mem.set(docId, rec); return rec; }
  return null;
}

/**
 * Can `docId` be written back as a file of type `ext` ('.pdf', '.docx' …)?
 * → { name, where } when possible (where: 'app' | 'browser'), else null.
 */
export async function originFor(docId, ext) {
  const o = await load(docId);
  if (!o || (ext && o.ext && o.ext !== ext)) return null;
  if (o.type === 'native') return isNative() && o.writable ? { name: o.name, where: 'app' } : null;
  if (o.type === 'web') return o.handle && typeof o.handle.createWritable === 'function' ? { name: o.name, where: 'browser' } : null;
  return null;
}

export class OriginError extends Error {
  constructor(code, msg) { super(msg); this.code = code; this.userMessage = msg; }
}

/** Ask for write permission – call directly inside the click handler (browsers need the user gesture). */
export async function ensurePermission(docId) {
  const o = await load(docId);
  if (!o || o.type !== 'web' || !o.handle) return true;
  const h = o.handle;
  try {
    if (typeof h.queryPermission === 'function' && await h.queryPermission({ mode: 'readwrite' }) === 'granted') return true;
    if (typeof h.requestPermission === 'function') return (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
    return true;
  } catch { return false; }
}

const readonlyMsg = () => (isNative() && platformName() === 'ios'
  ? 'Diese Datei darf FaLe PDF nicht überschreiben. Öffne sie direkt aus der Dateien-App oder speichere eine Kopie.'
  : 'Die andere App hat nur Lesezugriff gegeben. Öffne die Datei mit „Bearbeiten mit“ oder speichere eine Kopie.');

const chains = new Map(); // docId → last write (writes to the same original never overlap)
let seq = 0;

/** Replace the original file with `blob`. Throws OriginError with a user message. */
export function writeOriginal(docId, blob) {
  const prev = chains.get(docId) || Promise.resolve();
  const p = prev.catch(() => {}).then(() => writeOnce(docId, blob));
  chains.set(docId, p);
  p.finally(() => { if (chains.get(docId) === p) chains.delete(docId); }).catch(() => {});
  return p;
}

async function writeOnce(docId, blob) {
  const o = await load(docId);
  if (!o) throw new OriginError('unknown', 'Die Originaldatei ist nicht mehr erreichbar. Speichere stattdessen eine Kopie.');
  if (o.type === 'web') {
    if (!await ensurePermission(docId)) throw new OriginError('denied', 'Ohne deine Erlaubnis kann die Originaldatei nicht überschrieben werden.');
    let w;
    try {
      w = await o.handle.createWritable({ keepExistingData: false });
      await w.write(blob);
      await w.close();
    } catch (e) {
      try { if (w && w.abort) await w.abort(); } catch { /* ignore */ }
      if (e && e.name === 'NotFoundError') throw new OriginError('gone', 'Die Originaldatei wurde verschoben oder gelöscht.');
      if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw new OriginError('denied', 'Der Browser erlaubt das Überschreiben der Originaldatei nicht.');
      throw new OriginError('failed', 'Die Originaldatei konnte nicht überschrieben werden.');
    }
    return { name: o.name };
  }
  const fi = isNative() ? plugin('FaleIncoming') : null;
  const fs = isNative() ? plugin('Filesystem') : null;
  if (!fi || !fs || !o.writable) throw new OriginError('readonly', readonlyMsg());
  const path = `writeback/${o.token}-${Date.now().toString(36)}${++seq}${o.ext || ''}`; // unique staging file
  try {
    await writeChunkedTo(fs, blob, path, 'CACHE');
    await fi.writeBack({ token: o.token, path });
  } catch (e) {
    try { await fs.deleteFile({ path, directory: 'CACHE' }); } catch { /* already gone */ }
    const code = String((e && (e.code || e.message)) || '');
    if (/readonly/.test(code)) throw new OriginError('readonly', readonlyMsg());
    if (/unknown/.test(code)) throw new OriginError('unknown', 'Die Originaldatei ist nicht mehr erreichbar (App wurde neu gestartet). Speichere stattdessen eine Kopie.');
    throw new OriginError('failed', 'Die Originaldatei konnte nicht überschrieben werden.');
  }
  return { name: o.name };
}

/** Forget (e.g. when the library document is deleted for good). */
export async function forgetOrigin(docId) {
  mem.delete(docId);
  await db.deleteDeviceSetting(KEY(docId));
}

export const _test = { mem, extOf };

// ---------------------------------------------------------------- UI helper (result cards, office editors)
/**
 * Ask, then replace the original of `fromId` with the file of library document `docId` (or `blob`).
 * Must be called from a click handler. → true when written.
 */
const keptBefore = new Set(); // docIds whose earlier version was already kept this session

/**
 * keepBefore: Blob of the version the original had before (office editors replace their own library copy when
 * saving) – kept once as a new library file „<name> (vorher)“, so nothing the editor cannot represent is lost.
 * For web originals the file is read again (exactly what is on disk).
 */
export async function replaceOriginalFlow(fromId, { docId = null, blob = null, ext = '.pdf', confirm = true, keepBefore = null } = {}) {
  const { confirmDialog, toast, errorToast } = await import('./ui.js');
  const info = await originFor(fromId, ext);
  if (!info) { toast('Die Originaldatei ist nicht mehr erreichbar. Speichere stattdessen eine Kopie.', 'error'); return false; }
  const sameDoc = fromId === docId;
  const keep = sameDoc && !keptBefore.has(fromId);
  const stem = String(info.name).replace(/\.[^.]+$/, '');
  const keepName = `${stem} (vorher)${ext}`;
  if (confirm && !await confirmDialog(`„${info.name}“ überschreiben?`,
    sameDoc
      ? (keep ? `Die Originaldatei wird durch die gespeicherte Fassung ersetzt. Die bisherige Fassung bleibt als „${keepName}“ in FaLe PDF.` : 'Die Originaldatei wird durch die gespeicherte Fassung ersetzt.')
      : 'Die Originaldatei wird durch diese Fassung ersetzt. In FaLe PDF bleiben beide Fassungen erhalten – du kannst jederzeit zurück.',
    { okLabel: 'Überschreiben' })) return false;
  try {
    if (info.where === 'browser' && !await ensurePermission(fromId)) throw new OriginError('denied', 'Ohne deine Erlaubnis kann die Originaldatei nicht überschrieben werden.');
    const data = blob || await db.getFile(docId);
    if (!data) throw new OriginError('failed', 'Die neue Fassung wurde nicht gefunden.');
    if (keep) {
      const o = await load(fromId);
      let before = keepBefore;
      if (o && o.type === 'web') { try { const f = await o.handle.getFile(); before = new Blob([await f.arrayBuffer()], { type: f.type }); } catch { /* fall back to keepBefore */ } }
      if (!before) throw new OriginError('failed', 'Die bisherige Fassung konnte nicht gesichert werden – die Originaldatei bleibt unverändert.');
      const { saveFile } = await import('./library.js');
      const kind = (await db.getDoc(fromId) || {}).kind || 'pdf';
      await saveFile({ blob: before, name: keepName, kind, source: 'Gerät' });
      keptBefore.add(fromId);
    }
    await writeOriginal(fromId, data);
    toast(`Originaldatei „${info.name}“ aktualisiert`, 'success');
    return true;
  } catch (e) {
    errorToast(e, 'Die Originaldatei konnte nicht überschrieben werden.');
    return false;
  }
}
