// FaLe One engine (module worker). Everything that touches keys, ciphertext or the network runs here, off the
// UI thread: the change feed (§7.4), decryption of names/metadata, thumbnails, resumable uploads (§7.2),
// downloads with integrity check (§7.3), offline copies, photo backup (§7.6), albums, export, share links.
// The page only ever receives DECRYPTED VIEWS of items (no keys) and Blobs to display.
//
// Storage on this device (decision, see README):
//   - the local index (decrypted names/metadata + the server's encrypted records) is persisted as ONE record,
//     sealed with a local key LK = HKDF(MK, "fale-one-local-v1") (AES-256-GCM, non-extractable)
//   - thumbnails: sealed with LK; offline files: the server's ciphertext chunks, unchanged
//   - decrypted file contents are never written to disk or Cache Storage: only Blobs in memory
import { createClient, OneError } from './shared/one/api.js';
import * as K from './shared/one/crypto.js';
import * as SC from './shared/share/crypto.js';
import { kv, thumbs as thumbDb, chunks as chunkDb, pins as pinDb, uploads as upDb } from './idb.js';
import { readMediaMeta, imageDerivatives, mimeOf, kindOf, fallbackTakenAt, browserImage } from './media.js';
import { scanTakeout } from './takeout.js';
import { readEntry } from './unzip.js';

const te = new TextEncoder(), td = new TextDecoder();
let S = null;            // session: { userId, deviceId, deviceName, keys, lk, api, apiBase, chunkSize, limits }
const index = new Map(); // nodeId → { raw, dec: { meta, rev, err? } }
const albums = new Map(); // albumId → { raw, dec: { meta, err? } }
const members = new Map(); // albumId → Set(nodeId)
let cursor = 0;

// ---------------------------------------------------------------- messaging
const pending = new Map();
let askId = 0;
function ask(req, data) { return new Promise((res, rej) => { const id = ++askId; pending.set(id, { res, rej }); postMessage({ ask: id, req, data }); }); }
const emit = (ev, data) => postMessage({ ev, data });
const errObj = e => ({ code: (e && e.code) || 'internal', status: (e && e.status) || 0, message: (e && e.message) || String(e), extra: (e && e.extra) || undefined });
self.onmessage = async e => {
  const m = e.data || {};
  if (m.answer) { const p = pending.get(m.answer); pending.delete(m.answer); if (p) { if (m.error) p.rej(Object.assign(new Error(m.error.message), m.error)); else p.res(m.result); } return; }
  if (!m.call) return;
  try {
    const fn = OPS[m.op];
    if (!fn) throw Object.assign(new Error('unknown op ' + m.op), { code: 'unknown_op' });
    postMessage({ reply: m.call, result: await fn(m.args || {}) });
  } catch (err) { postMessage({ reply: m.call, error: errObj(err) }); }
};
const online = () => navigator.onLine !== false;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const offlineErr = () => Object.assign(new Error('offline'), { code: 'network', status: 0 });

// ---------------------------------------------------------------- local key (LK) sealing
async function seal(bytes) {
  const iv = K.rnd(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode('fale-one-local|' + S.userId) }, S.lk, bytes));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return out;
}
async function unseal(u8) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.subarray(0, 12), additionalData: te.encode('fale-one-local|' + S.userId) }, S.lk, u8.subarray(12)));
}
const sealJson = async o => seal(te.encode(JSON.stringify(o)));
const unsealJson = async u8 => JSON.parse(td.decode(await unseal(u8)));

// ---------------------------------------------------------------- key caches
const nkCache = new Map(), fkCache = new Map();
function cachePut(map, k, v, max = 4000) { if (map.size > max) map.delete(map.keys().next().value); map.set(k, v); }
async function nodeKeyOf(raw) {
  const c = nkCache.get(raw.id);
  if (c && c.w === raw.key) return c.k;
  const k = await K.openNodeKey(S.keys, raw.id, raw.key);
  cachePut(nkCache, raw.id, { w: raw.key, k });
  return k;
}
async function fileKeyOf(raw, rev) {
  const c = fkCache.get(rev.id);
  if (c) return c;
  const k = await K.openFileKey(await nodeKeyOf(raw), { userId: S.userId, nodeId: raw.id, revId: rev.id }, rev.key);
  cachePut(fkCache, rev.id, k);
  return k;
}

// ---------------------------------------------------------------- decrypted views
async function decNode(raw, prev) {
  if (prev && prev.raw.meta === raw.meta && ((prev.raw.head && prev.raw.head.id) || null) === ((raw.head && raw.head.id) || null) && !prev.dec.err) return prev.dec;
  try {
    const nk = await nodeKeyOf(raw);
    const meta = await K.openMeta(nk, { userId: S.userId, kind: raw.kind, id: raw.id }, raw.meta);
    let rev = null;
    if (raw.head) rev = await K.openRevMeta(await fileKeyOf(raw, raw.head), { userId: S.userId, nodeId: raw.id, revId: raw.head.id }, raw.head.meta);
    return { meta, rev };
  } catch { return { meta: { v: 1, name: '' }, rev: null, err: 'decrypt' }; }
}
function view(raw, dec) {
  const b = p => !!(raw.head && raw.head.blobs && raw.head.blobs.some(x => x.purpose === p));
  return {
    t: 'node', id: raw.id, parent: raw.parent, kind: raw.kind, version: raw.version, createdAt: raw.createdAt, updatedAt: raw.updatedAt,
    trashedAt: raw.trashedAt, trashRoot: raw.trashRoot, name: (dec.meta && dec.meta.name) || '', meta: dec.meta || {}, rev: dec.rev, err: dec.err,
    head: raw.head ? { id: raw.head.id, hash: raw.head.hash, size: raw.head.size, createdAt: raw.head.createdAt, deviceId: raw.head.deviceId, thumb: b('thumb'), preview: b('preview') } : null,
  };
}
async function decAlbum(raw) {
  try { const ak = await K.openAlbumKey(S.keys, raw.id, raw.key); return { meta: await K.openMeta(ak, { userId: S.userId, kind: 'album', id: raw.id }, raw.meta) }; }
  catch { return { meta: { v: 1, name: '' }, err: 'decrypt' }; }
}
const albumView = (raw, dec) => ({ t: 'album', id: raw.id, version: raw.version, createdAt: raw.createdAt, updatedAt: raw.updatedAt, name: dec.meta.name || '', meta: dec.meta, err: dec.err });
const memberList = id => [...(members.get(id) || [])];

async function pmap(list, n, fn) {
  const out = new Array(list.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) { const k = i++; out[k] = await fn(list[k], k); } }));
  return out;
}

/** Apply server records (changes page or write responses) to the index and tell the page. */
async function applyRecords(records, { reset = false } = {}) {
  const nodes = [], removed = [], albumsOut = [], albumsRemoved = [], touchedAlbums = new Set();
  const nodeRecs = records.filter(r => r.t === 'node' || (!r.t && r.kind));
  const decs = await pmap(nodeRecs, 12, r => (r.deleted ? null : decNode(r, index.get(r.id))));
  nodeRecs.forEach((r, i) => {
    if (r.deleted) {
      if (index.delete(r.id)) removed.push(r.id);
      for (const [a, s] of members) if (s.delete(r.id)) touchedAlbums.add(a);
      return;
    }
    const prev = index.get(r.id);
    if (prev && prev.raw.seq > r.seq && r.seq) return; // never go back to an older state
    index.set(r.id, { raw: r, dec: decs[i] });
    nodes.push(view(r, decs[i]));
  });
  for (const r of records) {
    if (r.t === 'album') {
      if (r.deleted) { if (albums.delete(r.id)) albumsRemoved.push(r.id); members.delete(r.id); continue; }
      const dec = await decAlbum(r);
      albums.set(r.id, { raw: r, dec });
      albumsOut.push(albumView(r, dec));
      touchedAlbums.add(r.id);
    } else if (r.t === 'member') {
      if (!members.has(r.album)) members.set(r.album, new Set());
      if (r.removed) members.get(r.album).delete(r.node); else members.get(r.album).add(r.node);
      touchedAlbums.add(r.album);
    }
  }
  const mem = {};
  for (const a of touchedAlbums) mem[a] = memberList(a);
  if (reset || nodes.length || removed.length || albumsOut.length || albumsRemoved.length || touchedAlbums.size) emit('delta', { reset, nodes, removed, albums: albumsOut, albumsRemoved, members: mem });
  schedulePersist();
}
function snapshotAll() {
  return {
    reset: true,
    nodes: [...index.values()].map(x => view(x.raw, x.dec)),
    removed: [], albums: [...albums.values()].map(x => albumView(x.raw, x.dec)), albumsRemoved: [],
    members: Object.fromEntries([...members.keys()].map(a => [a, memberList(a)])),
  };
}

// ---------------------------------------------------------------- persistence of the index
let persistTimer = null, persistP = null;
function schedulePersist(ms = 1200) { clearTimeout(persistTimer); persistTimer = setTimeout(() => { persist().catch(() => {}); }, ms); }
async function persist() {
  if (!S) return;
  clearTimeout(persistTimer);
  if (persistP) await persistP;
  persistP = (async () => {
    const data = { v: 1, cursor, nodes: [...index.values()].map(x => [x.raw, x.dec]), albums: [...albums.values()].map(x => [x.raw, x.dec]), members: [...members].map(([a, s]) => [a, [...s]]) };
    await kv.set('snap', { user: S.userId, sealed: await sealJson(data) }); // index and cursor in ONE write (§7.4: index first, then cursor)
  })().finally(() => { persistP = null; });
  return persistP;
}
async function loadSnapshot() {
  const rec = await kv.get('snap', null).catch(() => null);
  if (!rec || rec.user !== S.userId) return false;
  try {
    const d = await unsealJson(rec.sealed);
    index.clear(); albums.clear(); members.clear();
    for (const [raw, dec] of d.nodes) index.set(raw.id, { raw, dec });
    for (const [raw, dec] of d.albums) albums.set(raw.id, { raw, dec });
    for (const [a, l] of d.members) members.set(a, new Set(l));
    cursor = d.cursor || 0;
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------- sync (§7.4)
let syncP = null;
async function sync() {
  if (syncP) return syncP;
  syncP = (async () => {
    if (!online()) throw offlineErr();
    for (let guard = 0; guard < 100000; guard++) {
      const r = await S.api.changes(cursor, 500);
      if (r.reset) { index.clear(); albums.clear(); members.clear(); cursor = 0; await applyRecords([], { reset: true }); continue; }
      await applyRecords(r.changes);
      cursor = r.cursor;
      await persist();
      if (!r.more) break;
    }
    pinsAfterSync().catch(() => {});
    return { cursor, nodes: index.size };
  })().finally(() => { syncP = null; });
  return syncP;
}
async function applyWrite(node) { if (node) await applyRecords([{ t: 'node', ...node }]); }
function rawOf(id) { const x = index.get(id); if (!x) throw Object.assign(new Error('not found'), { code: 'not_found', status: 404 }); return x; }

// ---------------------------------------------------------------- tree writes
async function sealNodeMeta(raw, meta) { return K.sealMeta(await nodeKeyOf(raw), { userId: S.userId, kind: raw.kind, id: raw.id }, meta); }
async function mkdir({ parentId = null, name, extra = {} }) {
  const nodeId = K.uuid();
  const nk = await K.createNodeKey(S.keys, nodeId);
  const meta = await K.sealMeta(nk.key, { userId: S.userId, kind: 'folder', id: nodeId }, { v: 1, name, ...extra });
  const r = await S.api.mkdir({ nodeId, parentId, key: nk.wrapped, meta });
  cachePut(nkCache, nodeId, { w: nk.wrapped, k: nk.key });
  await applyWrite(r.node);
  return view(index.get(nodeId).raw, index.get(nodeId).dec);
}
/** Change node metadata (rename, favourite, …). Unknown fields are preserved; one retry on a conflict. */
async function patchMeta({ id, patch }) {
  let { raw, dec } = rawOf(id);
  for (let attempt = 0; ; attempt++) {
    const meta = { ...dec.meta, ...patch };
    for (const k of Object.keys(patch)) if (patch[k] === null) delete meta[k];
    try {
      const r = await S.api.update({ nodeId: id, baseVersion: raw.version, meta: await sealNodeMeta(raw, meta) });
      await applyWrite(r.node);
      return true;
    } catch (e) {
      if (e.code === 'conflict' && e.extra && e.extra.node && attempt === 0) { raw = e.extra.node; dec = await decNode(raw); continue; }
      throw e;
    }
  }
}
async function move({ id, parentId }) {
  let { raw } = rawOf(id);
  for (let attempt = 0; ; attempt++) {
    try { const r = await S.api.update({ nodeId: id, baseVersion: raw.version, parentId: parentId || null }); await applyWrite(r.node); return true; }
    catch (e) { if (e.code === 'conflict' && e.extra && e.extra.node && attempt === 0) { raw = e.extra.node; continue; } throw e; }
  }
}
async function afterTreeOp() { try { await sync(); } catch {} }

// ---------------------------------------------------------------- downloads (§7.3)
async function chunkBytes(blob, i) {
  const local = await chunkDb.get(`${blob.id}:${i}`, null).catch(() => null);
  if (local) return local;
  if (!online()) throw Object.assign(new Error('offline'), { code: 'not_available_offline' });
  if (blob.backend !== 's3') return S.api.getChunk(blob.id, i);
  const r = await S.api.downloadUrls(blob.id, i, 1);
  const res = await fetch(r.urls[0].url, { credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!res.ok) throw Object.assign(new Error('storage'), { code: 'storage_download_failed', status: res.status });
  return new Uint8Array(await res.arrayBuffer());
}
/** Decrypted blob of a revision as a Blob (verified). */
async function blobOf(raw, rev, purpose = 'content', { onProgress, mime } = {}) {
  const blob = rev.blobs.find(b => b.purpose === purpose);
  if (!blob) throw Object.assign(new Error('no ' + purpose), { code: 'not_found', status: 404 });
  const fk = await fileKeyOf(raw, rev);
  const ctx = { userId: S.userId, nodeId: raw.id, revId: rev.id, blobId: blob.id, purpose };
  const rmeta = await K.openRevMeta(fk, ctx, rev.meta);
  const bk = await K.blobKey(fk, blob.id, purpose);
  const parts = new Array(blob.chunks);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(4, blob.chunks) }, async () => {
    while (next < blob.chunks) {
      const i = next++;
      parts[i] = await K.openChunk(bk, ctx, i, blob.chunks, await chunkBytes(blob, i));
      done++;
      if (onProgress) onProgress(done / blob.chunks);
    }
  }));
  const type = purpose === 'content' ? (mime || rmeta.mime || 'application/octet-stream') : ((rmeta[purpose] && rmeta[purpose].mime) || 'image/jpeg');
  const out = new Blob(parts, { type });
  if (purpose === 'content') {
    if (rmeta.size !== out.size) throw Object.assign(new Error('size'), { code: 'integrity' });
    if (rmeta.digest && K.hex(await K.contentDigest(out)) !== rmeta.digest) throw Object.assign(new Error('digest'), { code: 'integrity' });
  }
  return out;
}
async function download({ id, revId = null, purpose = 'content', progressId = null }) {
  const { raw, dec } = rawOf(id);
  let rev = raw.head;
  if (revId && (!rev || rev.id !== revId)) {
    rev = (versionCache.get(id) || []).find(r => r.id === revId);
    if (!rev) { const v = await S.api.versions(id); rev = v.versions.find(r => r.id === revId); }
  }
  if (!rev) throw Object.assign(new Error('no version'), { code: 'not_found', status: 404 });
  let last = 0;
  const onProgress = progressId ? f => { const now = Date.now(); if (now - last > 120 || f === 1) { last = now; emit('progress', { id: progressId, f }); } } : null;
  const mime = mimeOf(dec.meta.name || '', dec.rev && dec.rev.mime);
  return blobOf(raw, rev, purpose, { onProgress, mime: revId ? undefined : mime });
}

// ---------------------------------------------------------------- thumbnails
async function getThumbs({ ids }) {
  const out = {};
  const need = [];
  for (const id of ids) {
    const x = index.get(id);
    const b = x && x.raw.head && x.raw.head.blobs.find(z => z.purpose === 'thumb');
    if (!b) continue;
    const cached = await thumbDb.get(b.id, null).catch(() => null);
    if (cached) { try { out[id] = new Blob([await unseal(cached)], { type: (x.dec.rev && x.dec.rev.thumb && x.dec.rev.thumb.mime) || 'image/jpeg' }); continue; } catch {} }
    need.push({ x, b });
  }
  if (need.length && online()) {
    for (let i = 0; i < need.length; i += 100) {
      const part = need.slice(i, i + 100);
      let r;
      try { r = await S.api.thumbs(part.map(p => p.b.id)); } catch { continue; }
      await pmap(part, 8, async ({ x, b }) => {
        const data = r.thumbs[b.id];
        if (!data) return;
        try {
          const fk = await fileKeyOf(x.raw, x.raw.head);
          const plain = await K.openSmall(fk, { userId: S.userId, nodeId: x.raw.id, revId: x.raw.head.id, blobId: b.id, purpose: 'thumb' }, K.unb64u(data));
          out[x.raw.id] = new Blob([plain], { type: (x.dec.rev && x.dec.rev.thumb && x.dec.rev.thumb.mime) || 'image/jpeg' });
          thumbDb.set(b.id, await seal(plain)).catch(() => {});
        } catch {}
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- versions
const versionCache = new Map();
async function versions({ id }) {
  const { raw } = rawOf(id);
  const r = await S.api.versions(id);
  versionCache.set(id, r.versions);
  if (r.node) await applyWrite(r.node);
  return pmap(r.versions, 6, async v => {
    let meta = null;
    try { meta = await K.openRevMeta(await fileKeyOf(raw, v), { userId: S.userId, nodeId: id, revId: v.id }, v.meta); } catch { meta = null; }
    return { id: v.id, head: !!v.head, createdAt: v.createdAt, supersededAt: v.supersededAt, cipherSize: v.size, deviceId: v.deviceId, size: meta ? meta.size : null, mime: meta ? meta.mime : null, mtime: meta ? meta.mtime : null, err: meta ? undefined : 'decrypt' };
  });
}

// ---------------------------------------------------------------- offline copies
async function pinnedSet() {
  const keys = await pinDb.keys().catch(() => []);
  return new Set(keys);
}
function underPinned(id, pinned) {
  for (let cur = id, guard = 0; cur && guard < 200; guard++) { if (pinned.has(cur)) return true; const x = index.get(cur); cur = x ? x.raw.parent : null; }
  return false;
}
async function cachedChunks(blob) { const keys = await chunkDb.keysRange(`${blob.id}:`, `${blob.id}:\uffff`).catch(() => []); return keys.length; }
let pinRun = null;
async function pinsAfterSync() {
  if (pinRun) return pinRun;
  pinRun = (async () => {
    const pinned = await pinnedSet();
    const want = new Set();
    for (const [id, x] of index) {
      if (x.raw.kind === 'folder' || !x.raw.head || x.raw.trashedAt) continue;
      if (!underPinned(id, pinned)) continue;
      for (const b of x.raw.head.blobs) want.add(b.id);
      const content = x.raw.head.blobs.find(b => b.purpose === 'content');
      if (content && (await cachedChunks(content)) < content.chunks && online()) {
        emit('offline', { id, state: 'loading' });
        try {
          for (const b of x.raw.head.blobs) for (let i = 0; i < b.chunks; i++) {
            const k = `${b.id}:${i}`;
            if (await chunkDb.get(k, null)) continue;
            await chunkDb.set(k, b.backend !== 's3' ? await S.api.getChunk(b.id, i) : await chunkBytes(b, i));
          }
          emit('offline', { id, state: 'ready' });
        } catch { emit('offline', { id, state: 'error' }); }
      }
    }
    // drop copies that are no longer wanted (unpinned, replaced by a newer version, deleted)
    const keys = await chunkDb.keys().catch(() => []);
    const stale = new Set(keys.map(k => String(k).split(':')[0]).filter(b => !want.has(b)));
    for (const b of stale) await chunkDb.delRange(`${b}:`, `${b}:\uffff`).catch(() => {});
    return true;
  })().finally(() => { pinRun = null; });
  return pinRun;
}
async function setPin({ id, on }) {
  if (on) await pinDb.set(id, { on: true, at: Date.now() }); else await pinDb.del(id);
  await pinsAfterSync();
  return offlineState();
}
async function offlineState() {
  const pinned = await pinnedSet();
  const counts = new Map();
  for (const k of await chunkDb.keys().catch(() => [])) { const b = String(k).split(':')[0]; counts.set(b, (counts.get(b) || 0) + 1); }
  const ready = [];
  let bytes = 0;
  for (const [id, x] of index) {
    if (x.raw.kind === 'folder' || !x.raw.head) continue;
    for (const b of x.raw.head.blobs) {
      if ((counts.get(b.id) || 0) < b.chunks) continue;
      bytes += b.size;
      if (b.purpose === 'content') ready.push(id);
    }
  }
  return { pinned: [...pinned], ready, bytes };
}

// ---------------------------------------------------------------- uploads (§7.2, resumable)
const jobs = new Map(); // id → job (in memory, file attached)
let running = 0;
const MAX_PARALLEL = 2;
const PERSIST_FILE_MAX = 512 * 1024 * 1024; // larger files resume only within this session (no second copy on disk)
function jobView(j) {
  return { id: j.id, name: j.name, kind: j.kind, size: j.size, state: j.state, sent: j.sent || 0, total: j.total || j.size, error: j.error || null, nodeId: j.nodeId, parentId: j.parentId,
    batch: j.batch || null, dupOf: j.dupOf || null, newVersion: j.baseVersion > 0, conflict: !!j.conflict, persisted: !!j.persisted };
}
let jobEmitT = new Map();
function jobChanged(j, force = false) {
  const now = Date.now();
  if (!force && now - (jobEmitT.get(j.id) || 0) < 150) return;
  jobEmitT.set(j.id, now);
  emit('job', jobView(j));
}
const JOB_FIELDS = ['id', 'kind', 'name', 'mime', 'mtime', 'size', 'parentId', 'nodeId', 'revId', 'baseVersion', 'targetId', 'wrappedNK', 'wrappedFK', 'hash', 'digestHex',
  'meta', 'up', 'prepared', 'thumbMeta', 'previewMeta', 'state', 'batch', 'albums', 'created', 'skipDuplicates'];
async function persistJob(j) {
  if (j.noPersist) return;
  const o = {};
  for (const k of JOB_FIELDS) o[k] = j[k];
  if (j.thumb) o.thumbB64 = K.b64u(j.thumb);
  if (j.preview) o.previewB64 = K.b64u(j.preview);
  const rec = { sealed: await sealJson(o), file: j.file && j.file.size <= PERSIST_FILE_MAX ? j.file : null };
  try { await upDb.set(j.id, rec); j.persisted = !!rec.file; } catch { // storage full: keep going without the copy
    try { await upDb.set(j.id, { sealed: rec.sealed, file: null }); } catch {}
    j.persisted = false;
  }
}
async function restoreJobs() {
  const entries = await upDb.entries().catch(() => []);
  for (const [id, rec] of entries) {
    try {
      const o = await unsealJson(rec.sealed);
      if (!rec.file) { await upDb.del(id); if (o.up) for (const u of Object.values(o.up)) if (u) S.api.uploadAbort(u).catch(() => {}); continue; }
      const j = { ...o, file: rec.file, persisted: true };
      if (o.thumbB64) j.thumb = K.unb64u(o.thumbB64);
      if (o.previewB64) j.preview = K.unb64u(o.previewB64);
      j.state = o.state === 'paused' ? 'paused' : 'queued';
      j.sent = 0; j.total = j.size;
      jobs.set(id, j);
    } catch { await upDb.del(id).catch(() => {}); }
  }
  for (const j of jobs.values()) jobChanged(j, true);
  pump();
}
function enqueue(j) {
  j.id = j.id || K.uuid();
  j.created = j.created || Date.now();
  j.state = j.state || 'queued';
  j.mime = mimeOf(j.name, j.mime || (j.file && j.file.type));
  j.size = j.file ? j.file.size : j.size;
  j.mtime = j.mtime || (j.file && j.file.lastModified) || Date.now();
  j.up = j.up || {};
  jobs.set(j.id, j);
  jobChanged(j, true);
  return j;
}
function pump() {
  for (const j of [...jobs.values()].sort((a, b) => a.created - b.created)) {
    if (running >= MAX_PARALLEL) break;
    if (j.state !== 'queued') continue;
    running++;
    runJob(j).finally(() => { running--; pump(); checkBatches(); });
  }
}
function isNetErr(e) { return e && (e.code === 'network' || e.status === 0 || e.status === 502 || e.status === 503 || e.status === 504 || e.code === 'storage_upload_failed'); }

async function prepare(j) {
  if (!j.hash) {
    j.state = 'hashing'; jobChanged(j, true);
    const d = await K.contentDigest(j.file);
    j.digestHex = K.hex(d);
    j.hash = await K.dedupeHash(S.keys, d);
  }
  if (j.skipDuplicates && !j.checkedDup) {
    j.checkedDup = true;
    const local = localByHash().get(j.hash);
    let dup = local ? [local] : null;
    if (!dup && online()) { const r = await S.api.dedupe([j.hash]); dup = (r.matches && r.matches[j.hash]) || null; if (dup && !dup.length) dup = null; }
    if (dup) { j.dupOf = dup[0]; return false; }
  }
  if (!j.prepared) {
    const kind = kindOf(j.name, j.mime);
    let meta = {};
    if (kind === 'image' || kind === 'video') {
      meta = await readMediaMeta(j.file, j.mime);
      let der = kind === 'image' && browserImage(j.mime) ? await imageDerivatives(j.file, { mime: j.mime, size: j.size }).catch(() => null) : null;
      if (!der) { // video poster frame, HEIC/RAW: let the page try (it can use <video>/<img> decoders the worker lacks)
        try { der = await ask('derive', { file: j.file, mime: j.mime, kind }); } catch { der = null; }
      }
      if (der) {
        j.thumb = der.thumb && der.thumb.bytes; j.thumbMeta = der.thumb ? { mime: der.thumb.mime, w: der.thumb.w, h: der.thumb.h } : null;
        j.preview = der.preview && der.preview.bytes; j.previewMeta = der.preview ? { mime: der.preview.mime, w: der.preview.w, h: der.preview.h } : null;
        if (der.w && der.h) { meta.w = der.w; meta.h = der.h; }
        if (der.durationMs) meta.durationMs = der.durationMs;
      } else if (kind === 'image') meta.noPreview = true;
      if (j.kind === 'photo' && !meta.takenAt) meta.takenAt = (j.meta && j.meta.takenAt) || fallbackTakenAt(j.mtime);
    }
    // explicit meta (e.g. Takeout sidecar) fills gaps; EXIF from the file wins for date/GPS when present
    const extra = j.meta || {};
    j.meta = { ...extra, ...meta };
    if (extra.favorite) j.meta.favorite = true;
    if (extra.description) j.meta.description = extra.description;
    if (!meta.gps && extra.gps) j.meta.gps = extra.gps;
    if (!meta.takenAt && extra.takenAt) j.meta.takenAt = extra.takenAt;
    if (meta.takenAt && extra.takenAt && extra.source === 'takeout' && !/[+-]\d\d:\d\d$|Z$/.test(meta.takenAt)) j.meta.takenAt = extra.takenAt;
    delete j.meta.source;
    j.prepared = true;
  }
  if (!j.nodeId) j.nodeId = K.uuid();
  if (!j.revId) j.revId = K.uuid();
  if (!j.wrappedNK) {
    if (j.baseVersion > 0) j.wrappedNK = rawOf(j.targetId).raw.key;
    else { const nk = await K.createNodeKey(S.keys, j.nodeId); j.wrappedNK = nk.wrapped; cachePut(nkCache, j.nodeId, { w: nk.wrapped, k: nk.key }); }
  }
  const nodeKey = await K.openNodeKey(S.keys, j.nodeId, j.wrappedNK);
  if (!j.wrappedFK) { const fk = await K.createFileKey(nodeKey, { userId: S.userId, nodeId: j.nodeId, revId: j.revId }); j.wrappedFK = fk.wrapped; }
  j.total = j.size + (j.thumb ? j.thumb.length : 0) + (j.preview ? j.preview.length : 0);
  await persistJob(j);
  return true;
}

async function putBlob(j, purpose, data, fileKey) {
  const lay = K.layout(K.sizeOf(data), S.chunkSize);
  let uploadId = j.up[purpose], received = new Set(), direct = false;
  if (uploadId) {
    try {
      const st = await S.api.uploadStatus(uploadId);
      if (st.status !== 'pending' || st.expired || st.chunks !== lay.chunks || st.size !== lay.cipherSize) uploadId = null;
      else { received = new Set(st.received); direct = st.backend === 's3'; }
    } catch (e) { if (e.status === 404) uploadId = null; else throw e; }
  }
  if (!uploadId) {
    const r = await S.api.uploadCreate({ purpose, size: lay.cipherSize, chunks: lay.chunks, hash: purpose === 'content' ? j.hash : undefined });
    uploadId = r.uploadId; direct = !!r.direct;
    j.up[purpose] = uploadId;
    await persistJob(j);
  }
  const base = purpose === 'content' ? 0 : purpose === 'thumb' ? j.size : j.size + (j.thumb ? j.thumb.length : 0);
  const ctx = { userId: S.userId, nodeId: j.nodeId, revId: j.revId, blobId: uploadId, purpose };
  const bk = await K.blobKey(fileKey, uploadId, purpose);
  const todo = [];
  for (let i = 0; i < lay.chunks; i++) if (!received.has(i)) todo.push(i);
  let doneBytes = [...received].reduce((s, i) => s + Math.min(lay.plainChunk, K.sizeOf(data) - i * lay.plainChunk), 0);
  j.sent = base + doneBytes; jobChanged(j);
  const urls = new Map();
  const worker = async () => {
    while (todo.length) {
      if (j.ctrl.signal.aborted) throw Object.assign(new Error('aborted'), { code: 'aborted' });
      const i = todo.shift();
      const plain = await K.bytesOf(data, i * lay.plainChunk, Math.min((i + 1) * lay.plainChunk, K.sizeOf(data)));
      const sealed = await K.sealChunk(bk, ctx, i, lay.chunks, plain);
      if (direct) {
        for (let attempt = 0; ; attempt++) {
          if (!urls.has(i)) { const r = await S.api.uploadUrls(uploadId, i, 100); for (const u of r.urls) urls.set(u.i, u); }
          const u = urls.get(i);
          const res = await fetch(u.url, { method: 'PUT', headers: u.headers, body: sealed, credentials: 'omit' }).catch(() => null);
          if (res && res.ok) break;
          urls.delete(i);
          if (attempt >= 3) throw Object.assign(new Error('storage'), { code: 'storage_upload_failed', status: res ? res.status : 0 });
          await sleep(400 * 2 ** attempt);
        }
      } else await S.api.uploadPut(uploadId, i, sealed);
      doneBytes += plain.length;
      j.sent = base + doneBytes;
      jobChanged(j);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, Math.max(1, todo.length)) }, worker));
  return uploadId;
}

async function runJob(j) {
  j.ctrl = new AbortController();
  j.error = null;
  try {
    if (!online()) throw offlineErr();
    const go = await prepare(j);
    if (!go) { j.state = 'skipped'; jobChanged(j, true); await upDb.del(j.id).catch(() => {}); afterJob(j); return; }
    j.state = 'uploading'; jobChanged(j, true);
    const nodeKey = await K.openNodeKey(S.keys, j.nodeId, j.wrappedNK);
    const fileKey = await K.openFileKey(nodeKey, { userId: S.userId, nodeId: j.nodeId, revId: j.revId }, j.wrappedFK);
    await putBlob(j, 'content', j.file, fileKey);
    if (j.thumb) await putBlob(j, 'thumb', j.thumb, fileKey);
    if (j.preview) await putBlob(j, 'preview', j.preview, fileKey);
    if (j.ctrl.signal.aborted) throw Object.assign(new Error('aborted'), { code: 'aborted' });
    j.state = 'committing'; jobChanged(j, true);
    const kind = j.kind === 'photo' ? 'photo' : 'file';
    const revMeta = await K.sealRevMeta(fileKey, { userId: S.userId, nodeId: j.nodeId, revId: j.revId }, {
      v: 1, size: j.size, mime: j.mime, mtime: j.mtime, digest: j.digestHex, thumb: j.thumbMeta || undefined, preview: j.previewMeta || undefined,
    });
    const newNode = !(j.baseVersion > 0);
    const nodeMeta = newNode ? await K.sealMeta(nodeKey, { userId: S.userId, kind, id: j.nodeId }, { v: 1, name: j.name, ...(j.meta || {}) }) : undefined;
    let base = j.baseVersion || 0;
    let node = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await S.api.commit({
          nodeId: j.nodeId, parentId: j.parentId || null, kind, baseVersion: base, key: newNode ? j.wrappedNK : undefined, meta: nodeMeta,
          rev: { id: j.revId, key: j.wrappedFK, meta: revMeta, hash: j.hash }, content: j.up.content, thumb: j.up.thumb, preview: j.up.preview, deviceId: S.deviceId,
        });
        node = r.node; break;
      } catch (e) {
        // edited elsewhere meanwhile: keep both – this upload becomes the newest version on top (§7.2)
        if (e.code === 'conflict' && !newNode && e.extra && e.extra.node) { base = e.extra.node.version; j.conflict = true; continue; }
        if ((e.code === 'exists' && newNode) || e.code === 'no_upload') { await sync().catch(() => {}); const x = index.get(j.nodeId); if (x && x.raw.head && x.raw.head.id === j.revId) { node = x.raw; break; } }
        throw e;
      }
    }
    if (node) await applyWrite(node);
    j.state = 'done'; j.sent = j.total; jobChanged(j, true);
    j.thumb = j.preview = null; j.file = null; // memory stays flat during big backups
    await upDb.del(j.id).catch(() => {});
    afterJob(j);
  } catch (e) {
    if (e.code === 'aborted') { if (j.state !== 'canceled') { j.state = 'paused'; await persistJob(j).catch(() => {}); } jobChanged(j, true); return; }
    j.state = 'error';
    j.error = { code: isNetErr(e) ? 'network' : e.code || 'internal', status: e.status || 0 };
    jobChanged(j, true);
    if (isNetErr(e)) scheduleRetry();
  }
}
let retryT = null;
function scheduleRetry() { clearTimeout(retryT); retryT = setTimeout(() => { if (online()) retryNetwork(); else scheduleRetry(); }, 20000); }
function retryNetwork() { for (const j of jobs.values()) if (j.state === 'error' && j.error && j.error.code === 'network') j.state = 'queued'; pump(); }
function afterJob(j) {
  if (j.albums && j.albums.length) { const id = j.state === 'skipped' ? j.dupOf : j.nodeId; if (id) for (const a of j.albums) { const s = albumQueue.get(a) || new Set(); s.add(id); albumQueue.set(a, s); } }
}

// ---------------------------------------------------------------- photo backup (§7.6) + Takeout import
const batches = new Map(); // batchId → { total, kind: 'backup'|'takeout', started, reported }
const albumQueue = new Map(); // album name → Set(nodeId) (Takeout)
function localByHash() {
  const m = new Map();
  for (const [id, x] of index) if (x.raw.head && x.raw.head.hash && !x.raw.trashedAt) m.set(x.raw.head.hash, id);
  return m;
}
async function photosFolder(name) {
  for (const [, x] of index) if (x.raw.kind === 'folder' && !x.raw.trashedAt && x.dec.meta && x.dec.meta.role === 'photos') return x.raw.id;
  const f = await mkdir({ parentId: null, name, extra: { role: 'photos' } });
  return f.id;
}
async function deviceMeta() { return K.sealDeviceMeta(S.keys, S.deviceId, { v: 1, name: S.deviceName, platform: 'web', app: 'one-1.0.0' }); }
async function report(status, extra = {}) {
  try { await S.api.backupReport({ deviceId: S.deviceId, status, meta: await deviceMeta(), ...extra }); emit('backup', {}); } catch {}
}
/** Hash all files first, skip what is already stored (keyed hash, batched dedupe), then upload the rest. */
async function backup({ files, folderName, takeout = null }) {
  const parentId = await photosFolder(folderName);
  const batch = K.uuid();
  batches.set(batch, { kind: takeout ? 'takeout' : 'backup', started: Date.now() });
  // Photo backups are not copied into IndexedDB for resume-after-restart: re-selecting the same photos is
  // cheap (everything already stored is skipped by its keyed hash), and a second plaintext copy of a whole
  // gallery on the device is not worth it. Interrupted chunks expire on the server after 24 h.
  const list = files.map(f => enqueue({ kind: 'photo', file: f.file || f, name: f.name || (f.file || f).name, parentId, batch, state: 'waiting', skipDuplicates: false, meta: f.meta, albums: f.albums, noPersist: true }));
  report('running', { pending: list.length, pendingBytes: list.reduce((s, j) => s + (j.size || 0), 0) });
  // 1) keyed hashes (in this worker, 2 files at a time; each file is read in 4 MiB segments)
  await pmap(list, 2, async j => {
    try { j.state = 'hashing'; jobChanged(j, true); const d = await K.contentDigest(j.file); j.digestHex = K.hex(d); j.hash = await K.dedupeHash(S.keys, d); }
    catch { j.state = 'error'; j.error = { code: 'read' }; jobChanged(j, true); }
  });
  // 2) duplicates: already in the cloud (server dedupe + local index) or twice in this selection
  const known = localByHash();
  const seen = new Map();
  const ask_ = [];
  for (const j of list) {
    if (!j.hash) continue;
    if (known.has(j.hash)) { j.dupOf = known.get(j.hash); continue; }
    if (seen.has(j.hash)) { j.dupOf = seen.get(j.hash).nodeId || 'batch'; j.dupJob = seen.get(j.hash).id; continue; }
    seen.set(j.hash, j);
    ask_.push(j.hash);
  }
  for (let i = 0; i < ask_.length && online(); i += 200) {
    try {
      const r = await S.api.dedupe(ask_.slice(i, i + 200));
      for (const j of list) if (!j.dupOf && j.hash && r.matches && r.matches[j.hash] && r.matches[j.hash].length) j.dupOf = r.matches[j.hash][0];
    } catch {}
  }
  for (const j of list) {
    if (j.state === 'error') continue;
    if (j.dupOf) {
      j.state = 'skipped';
      if (j.dupJob) { const first = jobs.get(j.dupJob); if (first) { first.albums = [...new Set([...(first.albums || []), ...(j.albums || [])])]; } }
      else afterJob(j);
      jobChanged(j, true);
    } else { j.state = 'queued'; j.checkedDup = true; jobChanged(j, true); }
  }
  pump();
  checkBatches();
  return { batch, total: list.length, skipped: list.filter(j => j.state === 'skipped').length };
}
async function checkBatches() {
  for (const [id, b] of batches) {
    const list = [...jobs.values()].filter(j => j.batch === id);
    const open = list.filter(j => ['waiting', 'hashing', 'queued', 'uploading', 'committing'].includes(j.state));
    const failed = list.filter(j => j.state === 'error' || j.state === 'paused');
    if (open.length) {
      if (Date.now() - (b.reported || 0) > 15000) { b.reported = Date.now(); report('running', { pending: open.length + failed.length, pendingBytes: open.reduce((s, j) => s + (j.size || 0) - (j.sent || 0), 0) }); }
      continue;
    }
    batches.delete(id);
    if (b.kind === 'takeout') await flushAlbums().catch(() => {});
    if (failed.length) await report(failed.some(j => j.state === 'error') ? 'error' : 'paused', { pending: failed.length, error: failed.some(j => j.state === 'error') ? 'upload_failed' : undefined });
    else await report('idle', { pending: 0, pendingBytes: 0, success: true });
    emit('batchDone', { batch: id, kind: b.kind, done: list.filter(j => j.state === 'done').length, skipped: list.filter(j => j.state === 'skipped').length, failed: failed.length });
  }
}

// Takeout: scan + import
const takeoutZips = [];
async function takeoutScan({ files }) {
  takeoutZips.length = 0;
  takeoutZips.push(...files);
  const r = await scanTakeout(files, n => emit('takeoutScan', { n }));
  takeoutState = r;
  const withSidecar = r.items.filter(i => Object.keys(i.sidecar).length).length;
  return { photos: r.items.filter(i => i.kind === 'image').length, videos: r.items.filter(i => i.kind === 'video').length, albums: r.albums, withSidecar, skipped: r.skipped };
}
let takeoutState = null;
async function takeoutImport({ folderName }) {
  if (!takeoutState) throw Object.assign(new Error('no scan'), { code: 'bad_input' });
  // extract lazily: each entry becomes a Blob only when its turn comes (memory stays flat for big archives)
  const files = [];
  for (const it of takeoutState.items) {
    const blob = await readEntry(takeoutZips[it.zip], it.entry, it.mime);
    files.push({ file: new File([blob], it.name, { type: it.mime, lastModified: it.entry.mtime }), name: it.name, meta: { ...it.sidecar, source: 'takeout' }, albums: it.albums, noPersist: true });
    if (files.length % 25 === 0) emit('takeoutScan', { extracted: files.length });
  }
  const r = await backup({ files, folderName, takeout: true });
  takeoutState = null;
  return r;
}
async function flushAlbums() {
  for (const [name, ids] of albumQueue) {
    let album = [...albums.values()].find(a => a.dec.meta && a.dec.meta.name === name);
    let id = album ? album.raw.id : (await albumCreate({ name })).id;
    const list = [...ids].filter(x => index.has(x));
    for (let i = 0; i < list.length; i += 500) await S.api.albumItems(id, list.slice(i, i + 500), []);
  }
  albumQueue.clear();
  await sync().catch(() => {});
}

// ---------------------------------------------------------------- albums (§7.7)
async function albumCreate({ name }) {
  const albumId = K.uuid();
  const ak = await K.createAlbumKey(S.keys, albumId);
  const meta = await K.sealMeta(ak.key, { userId: S.userId, kind: 'album', id: albumId }, { v: 1, name, sort: 'taken' });
  const r = await S.api.albumPut({ albumId, baseVersion: 0, key: ak.wrapped, meta });
  await applyRecords([{ t: 'album', ...r.album }]);
  return albumView(albums.get(albumId).raw, albums.get(albumId).dec);
}
async function albumPatch({ id, patch }) {
  let x = albums.get(id);
  if (!x) throw Object.assign(new Error('not found'), { code: 'not_found' });
  let raw = x.raw, dec = x.dec;
  for (let attempt = 0; ; attempt++) {
    const ak = await K.openAlbumKey(S.keys, id, raw.key);
    const meta = await K.sealMeta(ak, { userId: S.userId, kind: 'album', id }, { ...dec.meta, ...patch });
    try { const r = await S.api.albumPut({ albumId: id, baseVersion: raw.version, meta }); await applyRecords([{ t: 'album', ...r.album }]); return true; }
    catch (e) { if (e.code === 'conflict' && e.extra && e.extra.album && attempt === 0) { raw = e.extra.album; dec = await decAlbum(raw); continue; } throw e; }
  }
}
async function albumItems({ id, add = [], remove = [] }) {
  for (let i = 0; i < Math.max(add.length, remove.length); i += 500) await S.api.albumItems(id, add.slice(i, i + 500), remove.slice(i, i + 500));
  if (!members.has(id)) members.set(id, new Set());
  add.forEach(n => members.get(id).add(n)); remove.forEach(n => members.get(id).delete(n));
  emit('delta', { nodes: [], removed: [], albums: [], albumsRemoved: [], members: { [id]: memberList(id) } });
  schedulePersist();
  sync().catch(() => {});
  return true;
}

// ---------------------------------------------------------------- export (§7.8)
let exportCache = null;
async function exportList() {
  const nodes = [];
  let albumsOut = null, after = null;
  for (let guard = 0; guard < 100000; guard++) {
    const r = await S.api.exportPage(after, 200);
    nodes.push(...r.nodes);
    if (r.albums) albumsOut = r.albums;
    if (!r.next) break;
    after = r.next;
  }
  exportCache = new Map(nodes.map(n => [n.id, n]));
  const out = await pmap(nodes, 8, async n => {
    const dec = await decNode(n);
    const versionsOut = await pmap(n.revisions || [], 4, async v => {
      try { const m = await K.openRevMeta(await fileKeyOf(n, v), { userId: S.userId, nodeId: n.id, revId: v.id }, v.meta); return { id: v.id, head: !!(n.head && n.head.id === v.id), createdAt: v.createdAt, size: m.size, mime: m.mime, mtime: m.mtime, digest: m.digest }; }
      catch { return { id: v.id, err: 'decrypt' }; }
    });
    return { id: n.id, parent: n.parent, kind: n.kind, trashed: !!n.trashedAt, name: dec.meta.name || '', meta: dec.meta, err: dec.err, versions: versionsOut };
  });
  const al = await pmap(albumsOut || [], 4, async a => { const d = await decAlbum(a); return { id: a.id, name: d.meta.name || '', items: a.items || [] }; });
  return { nodes: out, albums: al };
}
async function exportFile({ id, revId }) {
  const n = (exportCache && exportCache.get(id)) || (index.get(id) && index.get(id).raw);
  if (!n) throw Object.assign(new Error('not found'), { code: 'not_found' });
  const rev = (n.revisions || []).find(r => r.id === revId) || (n.head && n.head.id === revId ? n.head : null);
  if (!rev) throw Object.assign(new Error('not found'), { code: 'not_found' });
  return blobOf(n, rev, 'content');
}

// ---------------------------------------------------------------- share link (§7.9, existing /api/share)
async function shareCall(action, { json, raw, auth } = {}) {
  const headers = {};
  if (auth) headers['x-fale-auth'] = auth;
  let body;
  if (raw) { headers['Content-Type'] = 'application/octet-stream'; body = raw.body; } else { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json || {}); }
  let r;
  try { r = await fetch(`${S.apiBase}/api/share?a=${action}${raw && raw.query ? '&' + raw.query : ''}`, { method: 'POST', headers, body, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }); }
  catch { throw offlineErr(); }
  let j = null; try { j = await r.json(); } catch {}
  if (!r.ok) throw Object.assign(new Error((j && j.message) || 'share'), { code: (j && j.error) || 'http_' + r.status, status: r.status, userMessage: j && j.message });
  return j;
}
async function shareToken(renew = false) {
  if (!renew) { const t0 = await kv.get('shareToken', null); if (t0) return t0; }
  let dev = await kv.get('shareDevice', null);
  if (!dev) { dev = K.b64u(K.rnd(24)); await kv.set('shareDevice', dev); }
  const r = await fetch(`${S.apiBase}/api/ai/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: dev }), credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }).catch(() => null);
  if (!r) throw offlineErr();
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.token) throw Object.assign(new Error('register'), { code: j.error === 'ai_not_configured' ? 'share_not_configured' : (j.error || 'http_' + r.status), status: r.status });
  await kv.set('shareToken', j.token);
  return j.token;
}
async function shareLink({ id, expiresIn = 86400, maxDownloads = 5, password = '' }) {
  const { dec } = rawOf(id);
  const cfg = await shareCall('config');
  if (!cfg.configured) throw Object.assign(new Error('share'), { code: 'share_not_configured' });
  const blob = await download({ id, progressId: 'share:' + id });
  if (blob.size > cfg.maxBytes) throw Object.assign(new Error('too large'), { code: 'share_too_large', max: cfg.maxBytes });
  const L = SC.newLinkKey();
  const kdf = password ? SC.newKdf() : null;
  const ck = await SC.contentKey(L, kdf, password);
  const name = dec.meta.name || 'Datei';
  const sealed = await SC.sealObject(ck, { name, type: blob.type || 'application/octet-stream', size: blob.size, created: new Date().toISOString() }, { plainSize: blob.size, chunkSize: cfg.chunkSize, kdf });
  const createBody = { kind: 'file', size: sealed.cipherSize, chunks: sealed.chunks, header: sealed.header, expiresIn, maxDownloads: maxDownloads || null };
  let created;
  try { created = await shareCall('create', { json: { ...createBody, token: await shareToken() } }); }
  catch (e) { if (e.code !== 'invalid_token') throw e; created = await shareCall('create', { json: { ...createBody, token: await shareToken(true) } }); }
  for (let i = 0; i < sealed.chunks; i++) {
    const plain = new Uint8Array(await blob.slice(i * sealed.plainChunk, Math.min(blob.size, (i + 1) * sealed.plainChunk)).arrayBuffer());
    await shareCall('put', { raw: { query: `id=${created.id}&i=${i}`, body: await sealed.encryptChunk(i, plain) }, auth: created.auth });
    emit('progress', { id: 'share:' + id, f: 0.5 + 0.5 * (i + 1) / sealed.chunks });
  }
  const fin = await shareCall('finish', { json: { id: created.id, auth: created.auth } });
  return { id: created.id, key: SC.b64u.enc(L), expiresAt: (fin.object && fin.object.expiresAt) || created.expiresAt, maxDownloads: created.maxDownloads, password: !!kdf };
}

// ---------------------------------------------------------------- ops
const OPS = {
  async init({ userId, mk, apiBase, deviceId, deviceName }) {
    const keys = await K.deriveKeys(mk, userId);
    const lk = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('fale-one-local|' + userId), info: te.encode('fale-one-local-v1') }, mk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const api = createClient({ baseUrl: apiBase, getToken: async ({ refresh }) => { const tok = await ask('token', { refresh }); if (!tok) throw Object.assign(new Error('signed out'), { code: 'signed_out', status: 401 }); return tok; }, retries: 2, retryDelayMs: 500 });
    S = { userId, deviceId, deviceName, keys, lk, api, apiBase, chunkSize: 1048576, limits: null };
    const had = await loadSnapshot();
    const cfgChunk = await kv.get('chunkSize', null).catch(() => null);
    if (cfgChunk) S.chunkSize = cfgChunk;
    if (had) emit('delta', snapshotAll());
    restoreJobs().catch(() => {});
    return { hasSnapshot: had, nodes: index.size };
  },
  async config() { return S.api.config(true); },
  async quota() {
    const q = await S.api.quota(true);
    S.chunkSize = q.chunkSize; S.limits = q.limits;
    kv.set('chunkSize', q.chunkSize).catch(() => {});
    return q;
  },
  sync,
  snapshot: async () => snapshotAll(),
  mkdir,
  rename: ({ id, name }) => patchMeta({ id, patch: { name } }),
  patchMeta,
  move,
  async trash({ id }) { rawOf(id); const r = await S.api.trash(id); await applyWrite(r.node); await afterTreeOp(); return r.count; },
  async restore({ id }) { const r = await S.api.restore(id); await applyWrite(r.node); await afterTreeOp(); return r.count; },
  async deleteForever({ id }) { const r = await S.api.deleteForever(id); await afterTreeOp(); return r.count; },
  async emptyTrash() { const r = await S.api.emptyTrash(); await afterTreeOp(); return r.count; },
  versions,
  async restoreVersion({ id, revId }) { const { raw } = rawOf(id); const r = await S.api.restoreVersion(id, revId, raw.version); await applyWrite(r.node); return true; },
  async deleteVersion({ id, revId }) { await S.api.deleteVersion(id, revId); return true; },
  download,
  thumbs: getThumbs,
  setPin, offlineState,
  async clearThumbCache() { await thumbDb.clear(); return true; },
  // uploads
  async upload({ items }) {
    // items: [{ file, name, parentId, kind?, targetId? (new version of), baseVersion? }]
    const out = items.map(it => {
      const j = { kind: it.kind || 'file', file: it.file, name: it.name || it.file.name, parentId: it.parentId || null };
      if (it.targetId) { const { raw } = rawOf(it.targetId); j.targetId = it.targetId; j.nodeId = it.targetId; j.baseVersion = raw.version; j.kind = raw.kind; j.parentId = raw.parent; }
      return enqueue(j).id;
    });
    for (const id of out) persistJob(jobs.get(id)).catch(() => {});
    pump();
    return out;
  },
  async jobs() { return [...jobs.values()].map(jobView); },
  async pause({ id }) { const j = jobs.get(id); if (!j) return false; if (j.ctrl && ['hashing', 'uploading', 'committing'].includes(j.state)) j.ctrl.abort(); if (j.state === 'queued' || j.state === 'error') { j.state = 'paused'; await persistJob(j).catch(() => {}); } jobChanged(j, true); return true; },
  async resume({ id }) { const j = jobs.get(id); if (!j) return false; if (j.state === 'paused' || j.state === 'error') { j.state = 'queued'; jobChanged(j, true); pump(); } return true; },
  async cancel({ id }) {
    const j = jobs.get(id);
    if (!j) return false;
    const was = j.state;
    j.state = 'canceled';
    if (j.ctrl) j.ctrl.abort();
    jobs.delete(id);
    await upDb.del(id).catch(() => {});
    if (was !== 'done') for (const u of Object.values(j.up || {})) if (u) S.api.uploadAbort(u).catch(() => {});
    emit('job', { ...jobView(j), state: 'canceled' });
    checkBatches();
    return true;
  },
  async clearFinished() { for (const [id, j] of jobs) if (j.state === 'done' || j.state === 'skipped') jobs.delete(id); return [...jobs.values()].map(jobView); },
  async online() { retryNetwork(); return true; },
  backup, takeoutScan, takeoutImport,
  async backupList() { const r = await S.api.backupList(); return { ...r, devices: await pmap(r.devices || [], 4, async d => { let meta = null; try { meta = d.meta ? await K.openDeviceMeta(S.keys, d.deviceId, d.meta) : null; } catch {} return { ...d, meta, self: d.deviceId === S.deviceId }; }) }; },
  async backupForget({ deviceId }) { return S.api.backupForget(deviceId); },
  albumCreate, albumPatch, albumItems,
  async albumDelete({ id }) { await S.api.albumDelete(id); albums.delete(id); members.delete(id); emit('delta', { nodes: [], removed: [], albums: [], albumsRemoved: [id], members: {} }); schedulePersist(); return true; },
  exportList, exportFile,
  shareLink,
  async flush() { await persist(); return true; },
};
