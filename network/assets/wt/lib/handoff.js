// Hand files from one tool page to the next ("Weiter mit …") and from the share target (sw.js) to the
// hub, without re-selecting them. The blobs live in IndexedDB ("fale-wt" / "handoff", key "current")
// only for the short trip between two pages: the receiving page takes them and clears the store, and
// anything older than MAX_AGE is ignored and deleted. Nothing leaves the device.
const DB = 'fale-wt', STORE = 'handoff', KEY = 'current';
export const MAX_AGE = 30 * 60 * 1000;

function open() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

async function tx(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      let result;
      Promise.resolve(fn(t.objectStore(STORE))).then(r => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('aborted'));
    });
  } finally { db.close(); }
}

const req2p = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

/**
 * @param {{name: string, type?: string, blob: Blob}[]} files
 * @param {{target?: string|null, from?: string}} [meta]  target = tool id that should pick them up (null = any)
 */
export async function putHandoff(files, { target = null, from = '' } = {}) {
  const value = { files: files.map(f => ({ name: f.name, type: f.type || f.blob.type || '', blob: f.blob })), target, from, ts: Date.now() };
  await tx('readwrite', s => s.put(value, KEY));
}

/** Read the pending hand-off (or null). Expired entries are removed. Does not clear a valid one. */
export async function peekHandoff() {
  try {
    const v = await tx('readonly', s => req2p(s.get(KEY)));
    if (!v) return null;
    if (!v.ts || Date.now() - v.ts > MAX_AGE || !Array.isArray(v.files)) { await clearHandoff(); return null; }
    return v;
  } catch { return null; }
}

/** Take the hand-off if it is meant for `toolId` (or for anyone) and clear it. */
export async function takeHandoff(toolId) {
  const v = await peekHandoff();
  if (!v || (v.target && v.target !== toolId)) return null;
  await clearHandoff();
  return v;
}

export async function setHandoffTarget(target) {
  const v = await peekHandoff();
  if (!v) return false;
  v.target = target;
  v.ts = Date.now();
  await tx('readwrite', s => s.put(v, KEY));
  return true;
}

export async function clearHandoff() {
  try { await tx('readwrite', s => s.delete(KEY)); } catch { /* nothing to clear */ }
}

/** Turn stored entries back into File objects. */
export function handoffFiles(v) {
  return (v?.files || []).filter(f => f && f.blob instanceof Blob).map(f =>
    (f.blob instanceof File && f.blob.name === f.name ? f.blob : new File([f.blob], f.name || 'datei', { type: f.type || f.blob.type || '' })));
}
