// Versionsverlauf für Dokumente: die letzten Stände eines Dokuments lokal (IndexedDB „fale-versions“) speichern
// und wiederherstellen. Nichts verlässt das Gerät.
const DB = 'fale-versions', STORE = 'v', KEEP = 20;
let dbp = null;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const rq = indexedDB.open(DB, 1);
    rq.onupgradeneeded = () => { const s = rq.result.createObjectStore(STORE, { keyPath: 'key', autoIncrement: true }); s.createIndex('doc', 'docId'); };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  return dbp;
}
const tx = async (mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(STORE, mode); const out = fn(t.objectStore(STORE)); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); }); };

/** Store a version ({docId, html, page, hf, styles, words, label}). Keeps the newest KEEP per document. */
export async function addVersion(v) {
  if (!v.docId) return;
  const list = await listVersions(v.docId);
  if (list[0] && list[0].html === v.html) return list[0];
  await tx('readwrite', s => s.add({ ...v, at: Date.now() }));
  const all = await listVersions(v.docId);
  const drop = all.slice(KEEP);
  if (drop.length) await tx('readwrite', s => drop.forEach(x => s.delete(x.key)));
  return all[0];
}
export async function listVersions(docId) {
  const rows = await tx('readonly', s => s.index('doc').getAll(docId));
  return (rows || []).sort((a, b) => b.at - a.at);
}
export async function deleteVersions(docId) {
  const all = await listVersions(docId);
  await tx('readwrite', s => all.forEach(x => s.delete(x.key)));
}
/** Remove versions of documents that no longer exist (deleted files must not linger here). */
export async function pruneVersions(existingIds) {
  const keep = new Set(existingIds);
  const all = await tx('readonly', s => s.getAll());
  const drop = (all || []).filter(x => !keep.has(x.docId));
  if (drop.length) await tx('readwrite', s => drop.forEach(x => s.delete(x.key)));
  return drop.length;
}
