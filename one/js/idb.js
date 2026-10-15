// Tiny IndexedDB layer shared by the page and the engine worker.
//
// Database "fale-one" (wiped completely on sign-out):
//   kv       key → value   session (refresh token, e-mail, device id), the NON-EXTRACTABLE master key
//                          (CryptoKey), settings, the sealed local index snapshot (see worker.js)
//   thumbs   blobId → sealed thumbnail (AES-GCM with the local key; never plaintext)
//   chunks   "<blobId>:<i>" → ciphertext chunk exactly as stored on the server (offline copies)
//   pins     nodeId → { on, at }  (offline availability chosen by the user)
//   uploads  jobId → { sealed job description, file }  (resumable uploads across reloads)
// Database "fale-one-inbox": files handed over by the Web Share Target (written by sw.js, read once).
const NAME = 'fale-one';
const STORES = ['kv', 'thumbs', 'chunks', 'pins', 'uploads'];
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, 1);
    req.onupgradeneeded = () => { const db = req.result; for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s); };
    req.onsuccess = () => { const db = req.result; db.onversionchange = () => { db.close(); dbp = null; }; resolve(db); };
    req.onerror = () => { dbp = null; reject(req.error); };
    req.onblocked = () => { dbp = null; reject(new Error('blocked')); };
  });
  return dbp;
}
const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    let out;
    Promise.resolve(fn(t.objectStore(store))).then(r => { out = r; }, e => { try { t.abort(); } catch {} reject(e); });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('abort'));
  });
}
function store(name) {
  return {
    get: (k, d = null) => tx(name, 'readonly', s => reqP(s.get(k))).then(v => (v === undefined ? d : v)),
    set: (k, v) => tx(name, 'readwrite', s => { s.put(v, k); }),
    del: k => tx(name, 'readwrite', s => { s.delete(k); }),
    keys: () => tx(name, 'readonly', s => reqP(s.getAllKeys())),
    all: () => tx(name, 'readonly', s => reqP(s.getAll())),
    entries: () => tx(name, 'readonly', async s => { const [k, v] = await Promise.all([reqP(s.getAllKeys()), reqP(s.getAll())]); return k.map((x, i) => [x, v[i]]); }),
    clear: () => tx(name, 'readwrite', s => { s.clear(); }),
    count: () => tx(name, 'readonly', s => reqP(s.count())),
    /** delete all keys in [lo, hi] (string range) */
    delRange: (lo, hi) => tx(name, 'readwrite', s => { s.delete(IDBKeyRange.bound(lo, hi)); }),
    keysRange: (lo, hi) => tx(name, 'readonly', s => reqP(s.getAllKeys(IDBKeyRange.bound(lo, hi)))),
  };
}
export const kv = store('kv');
export const thumbs = store('thumbs');
export const chunks = store('chunks');
export const pins = store('pins');
export const uploads = store('uploads');

/** Sign-out / account deleted: remove everything this app stored on the device. */
export async function wipeAll() {
  for (const s of STORES) await store(s).clear().catch(() => {});
}

// ---------------------------------------------------------------- share-target inbox (written by sw.js)
const INBOX = 'fale-one-inbox';
function openInbox() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(INBOX, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('files')) req.result.createObjectStore('files', { autoIncrement: true }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
/** Take (read + delete) all files the share target stored. → File[] */
export async function takeInbox() {
  const db = await openInbox();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction('files', 'readwrite');
      const s = t.objectStore('files');
      const r = s.getAll();
      let out = [];
      r.onsuccess = () => { out = (r.result || []).flatMap(x => (Array.isArray(x.files) ? x.files : [])); s.clear(); };
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
    });
  } finally { db.close(); }
}
