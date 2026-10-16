// Page side of the engine: starts the worker, answers its requests (access token, poster frames / HEIC decode
// that need page APIs), and keeps the DECRYPTED in-memory state the views render from.
import { accessToken } from './auth.js';
import { apiBase } from './config.js';
import { imageDerivatives } from './media.js';

export const state = {
  nodes: new Map(),     // id → node view (decrypted)
  albums: new Map(),    // id → album view
  members: new Map(),   // albumId → Set(nodeId)
  jobs: new Map(),      // upload jobs
  quota: null, backup: null, em: null, offline: { pinned: new Set(), ready: new Set(), bytes: 0, loading: new Set() },
  lastSync: 0, syncing: false, syncError: null, started: false,
};
const subs = new Set();
let pendingWhat = new Set(), notifyT = null;
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
function notify(what) {
  pendingWhat.add(what);
  if (notifyT) return;
  notifyT = requestAnimationFrame(() => { notifyT = null; const w = pendingWhat; pendingWhat = new Set(); subs.forEach(fn => { try { fn(w); } catch (e) { console.error(e); } }); });
}

let W = null;
const calls = new Map();
let callId = 0;
const progressFns = new Map();
export function onProgress(id, fn) { progressFns.set(id, fn); return () => progressFns.delete(id); }
export function call(op, args = {}) {
  if (!W) return Promise.reject(Object.assign(new Error('engine not started'), { code: 'not_started' }));
  return new Promise((res, rej) => { const id = ++callId; calls.set(id, { res, rej }); W.postMessage({ call: id, op, args }); });
}

async function answer(req, data) {
  if (req === 'token') return accessToken({ force: !!data.refresh });
  if (req === 'derive') return derive(data);
  throw new Error('unknown request');
}
function onMessage(e) {
  const m = e.data || {};
  if (m.reply) {
    const c = calls.get(m.reply); calls.delete(m.reply);
    if (c) { if (m.error) c.rej(Object.assign(new Error(m.error.message), m.error)); else c.res(m.result); }
    return;
  }
  if (m.ask) {
    answer(m.req, m.data || {}).then(result => W.postMessage({ answer: m.ask, result }), err => W.postMessage({ answer: m.ask, error: { code: err.code || 'failed', message: err.message || 'failed' } }));
    return;
  }
  if (m.ev) onEvent(m.ev, m.data);
}
function onEvent(ev, d) {
  if (ev === 'delta') {
    if (d.reset) { state.nodes.clear(); state.albums.clear(); state.members.clear(); }
    for (const n of d.nodes) state.nodes.set(n.id, n);
    for (const id of d.removed) state.nodes.delete(id);
    for (const a of d.albums) state.albums.set(a.id, a);
    for (const id of d.albumsRemoved) { state.albums.delete(id); state.members.delete(id); }
    for (const [a, list] of Object.entries(d.members || {})) state.members.set(a, new Set(list));
    for (const id of d.removed) for (const s of state.members.values()) s.delete(id);
    notify('nodes');
  } else if (ev === 'job') {
    if (d.state === 'canceled') state.jobs.delete(d.id); else state.jobs.set(d.id, d);
    notify('jobs');
  } else if (ev === 'progress') {
    const fn = progressFns.get(d.id); if (fn) fn(d.f);
  } else if (ev === 'offline') {
    if (d.state === 'loading') state.offline.loading.add(d.id); else state.offline.loading.delete(d.id);
    if (d.state === 'ready') state.offline.ready.add(d.id);
    notify('offline');
  } else if (ev === 'backup') { refreshBackup(); }
  else if (ev === 'batchDone') { notify('batch:' + JSON.stringify(d)); refreshQuota(); }
  else if (ev === 'takeoutScan') { const fn = progressFns.get('takeout'); if (fn) fn(d); }
}

export async function start({ userId, mk, deviceId, deviceName }) {
  if (W) W.terminate();
  W = new Worker(new URL('./worker.js', import.meta.url), { type: 'module', name: 'fale-one-engine' });
  W.onmessage = onMessage;
  W.onerror = e => { console.error('engine', e.message); };
  const r = await call('init', { userId, mk, apiBase: apiBase(), deviceId, deviceName });
  state.started = true;
  return r;
}
export function stop() { if (W) W.terminate(); W = null; state.started = false; state.em = null; state.nodes.clear(); state.albums.clear(); state.members.clear(); state.jobs.clear(); }

export async function syncNow() {
  if (!state.started) return;
  state.syncing = true; notify('sync');
  try { await call('sync'); state.lastSync = Date.now(); state.syncError = null; }
  catch (e) { state.syncError = e; }
  finally { state.syncing = false; notify('sync'); }
}
export async function refreshQuota() {
  try { state.quota = await call('quota'); notify('quota'); } catch (e) { if (!state.quota) state.quotaError = e; }
  return state.quota;
}
export async function refreshBackup() {
  try { state.backup = await call('backupList'); notify('backup'); } catch {}
  return state.backup;
}
/** Notfallzugang status (owner + "Für andere da"); decrypted scope names and safety codes come from the worker. */
export async function refreshEm() {
  try { state.em = await call('emStatus'); notify('em'); } catch (e) { state.emError = e; }
  return state.em;
}
export function setEm(st) { if (st) { state.em = st; notify('em'); } return st; }
export async function refreshOffline() {
  try { const o = await call('offlineState'); state.offline.pinned = new Set(o.pinned); state.offline.ready = new Set(o.ready); state.offline.bytes = o.bytes; notify('offline'); } catch {}
}

// ---------------------------------------------------------------- queries on the decrypted state
export const live = n => n && !n.trashedAt;
export function childrenOf(parentId) {
  const out = [];
  for (const n of state.nodes.values()) if ((n.parent || null) === (parentId || null) && !n.trashedAt) out.push(n);
  return out;
}
export function pathOf(id) {
  const out = [];
  for (let cur = state.nodes.get(id), g = 0; cur && g < 200; g++) { out.unshift(cur); cur = cur.parent ? state.nodes.get(cur.parent) : null; }
  return out;
}
export function isInside(id, ancestorId) {
  for (let cur = state.nodes.get(id), g = 0; cur && g < 200; g++) { if (cur.id === ancestorId) return true; cur = cur.parent ? state.nodes.get(cur.parent) : null; }
  return false;
}
export function photosFolderId() { for (const n of state.nodes.values()) if (n.kind === 'folder' && !n.trashedAt && n.meta && n.meta.role === 'photos') return n.id; return null; }
/** Capture time for the timeline: decrypted takenAt, else the revision mtime, else server time. */
export function takenOf(n) {
  const s = (n.meta && n.meta.takenAt) || null;
  if (s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(s);
    if (m) return { y: +m[1], mo: +m[2], d: +m[3], ts: Date.parse(s) || Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]), local: s };
  }
  const ms = (n.rev && n.rev.mtime) || Date.parse(n.createdAt) || 0;
  const dt = new Date(ms);
  return { y: dt.getFullYear(), mo: dt.getMonth() + 1, d: dt.getDate(), ts: ms };
}
export function photos({ filter } = {}) {
  const out = [];
  for (const n of state.nodes.values()) if (n.kind === 'photo' && !n.trashedAt && (!filter || filter(n))) out.push(n);
  out.sort((a, b) => takenOf(b).ts - takenOf(a).ts || (a.id < b.id ? -1 : 1));
  return out;
}

// ---------------------------------------------------------------- thumbnails (batched, object URLs with LRU)
const thumbUrls = new Map(); // id → { rev, url }
let thumbWant = new Map(), thumbT = null;
export function thumbUrl(n) {
  if (!n || !n.head || !n.head.thumb) return Promise.resolve(null);
  const c = thumbUrls.get(n.id);
  if (c && c.rev === n.head.id) { thumbUrls.delete(n.id); thumbUrls.set(n.id, c); return Promise.resolve(c.url); }
  return new Promise(res => {
    const list = thumbWant.get(n.id) || [];
    list.push({ res, rev: n.head.id });
    thumbWant.set(n.id, list);
    if (!thumbT) thumbT = setTimeout(flushThumbs, 24);
  });
}
async function flushThumbs() {
  thumbT = null;
  const want = thumbWant; thumbWant = new Map();
  const ids = [...want.keys()];
  let got = {};
  try { got = await call('thumbs', { ids }); } catch { got = {}; }
  for (const id of ids) {
    const blob = got[id];
    let url = null;
    if (blob) {
      url = URL.createObjectURL(blob);
      const n = state.nodes.get(id);
      const old = thumbUrls.get(id);
      if (old) URL.revokeObjectURL(old.url);
      thumbUrls.set(id, { rev: n && n.head ? n.head.id : null, url });
      while (thumbUrls.size > 1500) { const [k, v] = thumbUrls.entries().next().value; thumbUrls.delete(k); setTimeout(() => URL.revokeObjectURL(v.url), 5000); }
    }
    for (const w of want.get(id)) w.res(url);
  }
}
export function cachedThumb(id) { const c = thumbUrls.get(id); return c ? c.url : null; }

// ---------------------------------------------------------------- page-side derivatives (worker fallback)
/** Video poster frame / formats only the page can decode (e.g. HEIC on Safari). → derivatives or null */
async function derive({ file, mime, kind }) {
  if (kind === 'video') return videoPoster(file);
  try { const bmp = await createImageBitmap(file); const d = await imageDerivatives(bmp, { mime, size: file.size }); bmp.close(); return d; } catch {}
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return await imageDerivatives(img.naturalWidth ? await createImageBitmap(img) : null, { mime, size: file.size });
  } catch { return null; } finally { URL.revokeObjectURL(url); }
}
function videoPoster(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.preload = 'metadata';
    let done = false;
    const finish = r => { if (done) return; done = true; clearTimeout(timer); v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); resolve(r); };
    const timer = setTimeout(() => finish(null), 15000);
    v.onerror = () => finish(null);
    v.onloadedmetadata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 3); };
    v.onseeked = async () => {
      try {
        const bmp = await createImageBitmap(v);
        const d = await imageDerivatives(bmp, { mime: 'video', size: 0 });
        bmp.close();
        finish(d ? { ...d, durationMs: Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : undefined } : null);
      } catch { finish(null); }
    };
    v.src = url;
  });
}
