// IndexedDB storage layer. Everything stays on this device.
const DB_NAME = 'falepdf';
const DB_VERSION = 2;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('docs')) {
        const s = db.createObjectStore('docs', { keyPath: 'id' });
        s.createIndex('openedAt', 'openedAt');
      }
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('texts')) db.createObjectStore('texts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('signatures')) db.createObjectStore('signatures', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      // v2: Papierkorb, privater Tresor (verschlüsselt), Fristen & Erinnerungen
      if (!db.objectStoreNames.contains('trash')) db.createObjectStore('trash', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('vault')) db.createObjectStore('vault', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('reminders')) db.createObjectStore('reminders', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Datenbank blockiert'));
  });
  return dbPromise;
}

function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    Promise.resolve(fn(t)).then(r => { result = r; }, err => { try { t.abort(); } catch {} reject(err); });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaktion abgebrochen'));
  });
}

// ---- change hooks for FaLe Sync (inactive – fn is null – unless the user turned sync on) ----
export const syncHooks = { fn: null, mute: new Set() };
function changed(store, id, op) {
  const f = syncHooks.fn;
  if (!f || syncHooks.mute.has(`${store}:${id}`)) return;
  try { f(store, id, op); } catch { /* never breaks a write */ }
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---- documents ----
export async function addDoc(meta, blob) {
  await tx(['docs', 'files'], 'readwrite', t => {
    t.objectStore('docs').put(meta);
    t.objectStore('files').put({ id: meta.id, blob });
  });
  changed('docs', meta.id, 'put');
  return meta;
}

export async function getDoc(id) {
  return tx('docs', 'readonly', t => reqP(t.objectStore('docs').get(id)));
}

/** PDF documents only (used by the PDF tools and pickers). */
export async function listDocs() {
  return (await listFiles()).filter(d => !d.kind || d.kind === 'pdf');
}

/** All library entries (PDF, documents, spreadsheets, presentations, text, images), newest first. */
export async function listFiles() {
  const docs = await tx('docs', 'readonly', t => reqP(t.objectStore('docs').getAll()));
  return docs.sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));
}

/** Replace the stored file of an entry and patch its metadata in one transaction. */
export async function replaceFile(id, blob, patch = {}) {
  const r = await tx(['docs', 'files'], 'readwrite', async t => {
    const s = t.objectStore('docs');
    const cur = await reqP(s.get(id));
    if (!cur) return null;
    const next = { ...cur, ...patch, size: blob.size };
    s.put(next);
    t.objectStore('files').put({ id, blob });
    return next;
  });
  if (r) changed('docs', id, 'content');
  return r;
}

export async function updateDoc(id, patch) {
  const r = await tx('docs', 'readwrite', async t => {
    const s = t.objectStore('docs');
    const cur = await reqP(s.get(id));
    if (!cur) return null;
    const next = { ...cur, ...patch };
    s.put(next);
    return next;
  });
  if (r) changed('docs', id, 'meta');
  return r;
}

export async function getFile(id) {
  const rec = await tx('files', 'readonly', t => reqP(t.objectStore('files').get(id)));
  return rec ? rec.blob : null;
}

/** Delete = move into the Papierkorb (kept 30 days, restorable). */
export async function deleteDoc(id) {
  await tx(['docs', 'files', 'texts', 'trash'], 'readwrite', async t => {
    const meta = await reqP(t.objectStore('docs').get(id));
    const file = await reqP(t.objectStore('files').get(id));
    const text = await reqP(t.objectStore('texts').get(id));
    if (meta) t.objectStore('trash').put({ id, meta, blob: file ? file.blob : null, pages: text ? text.pages : null, deletedAt: Date.now() });
    t.objectStore('docs').delete(id);
    t.objectStore('files').delete(id);
    t.objectStore('texts').delete(id);
  });
  changed('docs', id, 'delete');
}

/** Remove an entry for good (no Papierkorb) – used e.g. when a file moves into the Tresor. */
export async function purgeDoc(id) {
  await tx(['docs', 'files', 'texts', 'trash'], 'readwrite', t => {
    ['docs', 'files', 'texts', 'trash'].forEach(s => t.objectStore(s).delete(id));
  });
  changed('docs', id, 'delete');
}

// ---- Papierkorb ----
export async function listTrash() {
  const all = await tx('trash', 'readonly', t => reqP(t.objectStore('trash').getAll()));
  return all.sort((a, b) => b.deletedAt - a.deletedAt);
}
export async function restoreFromTrash(id) {
  const r = await tx(['docs', 'files', 'texts', 'trash'], 'readwrite', async t => {
    const rec = await reqP(t.objectStore('trash').get(id));
    if (!rec) return null;
    const meta = { ...rec.meta, openedAt: Date.now() };
    t.objectStore('docs').put(meta);
    if (rec.blob) t.objectStore('files').put({ id, blob: rec.blob });
    if (rec.pages) t.objectStore('texts').put({ id, pages: rec.pages });
    t.objectStore('trash').delete(id);
    return meta;
  });
  if (r) changed('docs', id, 'put');
  return r;
}
export async function deleteFromTrash(id) {
  await tx('trash', 'readwrite', t => { t.objectStore('trash').delete(id); });
}
export async function emptyTrash() {
  await tx('trash', 'readwrite', t => { t.objectStore('trash').clear(); });
}
/** Drop Papierkorb entries older than `days`. Returns the number removed. */
export async function purgeOldTrash(days = 30, now = Date.now()) {
  const limit = now - days * 86400000;
  const old = (await listTrash()).filter(r => r.deletedAt < limit);
  if (old.length) await tx('trash', 'readwrite', t => { old.forEach(r => t.objectStore('trash').delete(r.id)); });
  return old.length;
}

// ---- Fristen & Erinnerungen ----
export async function listReminders() {
  return tx('reminders', 'readonly', t => reqP(t.objectStore('reminders').getAll()));
}
export async function putReminder(rec) {
  await tx('reminders', 'readwrite', t => { t.objectStore('reminders').put(rec); });
  changed('reminders', rec.id, 'put');
  return rec;
}
export async function deleteReminder(id) {
  await tx('reminders', 'readwrite', t => { t.objectStore('reminders').delete(id); });
  changed('reminders', id, 'delete');
}

// ---- Tresor (only ciphertext is ever stored here) ----
export async function listVault() {
  return tx('vault', 'readonly', t => reqP(t.objectStore('vault').getAll()));
}
export async function getVaultItem(id) {
  return tx('vault', 'readonly', t => reqP(t.objectStore('vault').get(id)));
}
export async function putVaultItem(rec) {
  await tx('vault', 'readwrite', t => { t.objectStore('vault').put(rec); });
  changed('vault', rec.id, 'put');
}
export async function deleteVaultItem(id) {
  await tx('vault', 'readwrite', t => { t.objectStore('vault').delete(id); });
  changed('vault', id, 'delete');
}
export async function clearVault() {
  await tx('vault', 'readwrite', t => { t.objectStore('vault').clear(); });
  changed('vault', '*', 'clear');
}

// ---- extracted text (one string per page) ----
export async function putText(id, pages) {
  await tx('texts', 'readwrite', t => { t.objectStore('texts').put({ id, pages }); });
}
export async function getText(id) {
  const r = await tx('texts', 'readonly', t => reqP(t.objectStore('texts').get(id)));
  return r ? r.pages : null;
}
export async function allTexts() {
  return tx('texts', 'readonly', t => reqP(t.objectStore('texts').getAll()));
}

// ---- signatures ----
export async function addSignature(blob) {
  const id = await tx('signatures', 'readwrite', t => reqP(t.objectStore('signatures').add({ blob, createdAt: Date.now() })));
  changed('signatures', id, 'put');
  return id;
}
/** Sync helpers: read one record / write a full record (new records get an id). */
export async function getSignature(id) {
  return tx('signatures', 'readonly', t => reqP(t.objectStore('signatures').get(id)));
}
export async function putSignature(rec) {
  return tx('signatures', 'readwrite', t => reqP(t.objectStore('signatures').put(rec)));
}
export async function listSignatures() {
  const all = await tx('signatures', 'readonly', t => reqP(t.objectStore('signatures').getAll()));
  return all.sort((a, b) => b.createdAt - a.createdAt);
}
export async function deleteSignature(id) {
  await tx('signatures', 'readwrite', t => { t.objectStore('signatures').delete(id); });
  changed('signatures', id, 'delete');
}

// ---- settings ----
export async function getSetting(key, fallback = null) {
  try {
    const r = await tx('settings', 'readonly', t => reqP(t.objectStore('settings').get(key)));
    return r ? r.value : fallback;
  } catch { return fallback; }
}
export async function setSetting(key, value) {
  await tx('settings', 'readwrite', t => { t.objectStore('settings').put({ key, value }); });
  changed('settings', key, 'put');
}

export async function clearAll({ keepSettings = true } = {}) {
  const stores = ['docs', 'files', 'texts', 'signatures', 'trash'];
  if (!keepSettings) stores.push('settings');
  await tx(stores, 'readwrite', t => { stores.forEach(s => t.objectStore(s).clear()); });
  changed('*', '*', 'clear');
}

// ---- share-target inbox (written by the service worker in a separate DB) ----
export async function takeInbox() {
  return new Promise(resolve => {
    const req = indexedDB.open('falepdf-inbox', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('inbox', { keyPath: 'id', autoIncrement: true });
    req.onerror = () => resolve([]);
    req.onsuccess = () => {
      const db = req.result;
      const t = db.transaction('inbox', 'readwrite');
      const s = t.objectStore('inbox');
      const g = s.getAll();
      g.onsuccess = () => { s.clear(); };
      t.oncomplete = () => { db.close(); resolve(g.result || []); };
      t.onerror = () => { db.close(); resolve([]); };
    };
  });
}
