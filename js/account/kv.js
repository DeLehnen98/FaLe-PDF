// Small IndexedDB store for the optional FaLe-Konto and FaLe Sync (separate from the document
// database, so signing out can wipe it completely without touching the user's files).
//   kv:  key → value  (refresh token, account e-mail, device id, sync settings, the NON-EXTRACTABLE
//        sync master key as a CryptoKey, cursor …)
//   map: sync bookkeeping per local entry: { k: '<kind>:<localId>', item, version, fp, h, blob, … }
const NAME = 'fale-account';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('map')) db.createObjectStore('map', { keyPath: 'k' }).createIndex('item', 'item', { unique: false });
    };
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

export const kv = {
  get: (k, d = null) => tx('kv', 'readonly', s => reqP(s.get(k))).then(v => (v === undefined ? d : v)).catch(() => d),
  set: (k, v) => tx('kv', 'readwrite', s => { s.put(v, k); }),
  del: k => tx('kv', 'readwrite', s => { s.delete(k); }),
  /** delete all keys starting with prefix */
  delPrefix: prefix => tx('kv', 'readwrite', async s => {
    const keys = await reqP(s.getAllKeys());
    keys.filter(k => String(k).startsWith(prefix)).forEach(k => s.delete(k));
  }),
};

export const map = {
  get: k => tx('map', 'readonly', s => reqP(s.get(k))).then(v => v || null),
  byItem: item => tx('map', 'readonly', s => reqP(s.index('item').get(item))).then(v => v || null),
  all: () => tx('map', 'readonly', s => reqP(s.getAll())),
  put: rec => tx('map', 'readwrite', s => { s.put(rec); }),
  del: k => tx('map', 'readwrite', s => { s.delete(k); }),
  clear: () => tx('map', 'readwrite', s => { s.clear(); }),
};

/** Remove everything (sign-out / account deleted). */
export async function wipeAll() {
  await tx('kv', 'readwrite', s => { s.clear(); }).catch(() => {});
  await map.clear().catch(() => {});
}
