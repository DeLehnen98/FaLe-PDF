// GENERATED – synced copy of js/one/api.js by scripts/sync-one-shared.mjs.
// Do not edit here: change the source and run `node scripts/sync-one-shared.mjs`.
// FaLe One – reference client for /api/drive (ES module; browsers and Node ≥ 20). Contract: docs/FALE-ONE-API.md.
//
//   const one = createClient({ baseUrl: 'https://fale-pdf.vercel.app', getToken: async ({ refresh }) => accessToken });
//   const keys = await deriveKeys(masterKey, userId);              // js/one/crypto.js
//   const { node } = await one.uploadFile({ keys, file, name: 'Urlaub.jpg', mime: 'image/jpeg', kind: 'photo' });
//   const bytes = await one.downloadFile({ keys, node });
//   const cursor = await one.pull({ cursor: saved, onChange: c => …, onReset: () => … });
//
// Low-level methods map 1:1 to the API actions; the high-level helpers (uploadFile, downloadFile, pull, openNode,
// thumbnails) implement the client algorithms of the contract (§7). Nothing here stores state: persisting
// the feed cursor, decrypted metadata and resumable-upload state is the app's job.
import * as K from './crypto.js';

export class OneError extends Error {
  constructor(status, code, message, extra) { super(message || code); this.status = status; this.code = code; this.extra = extra || {}; }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const RETRY_STATUS = new Set([0, 502, 503, 504]);

export function createClient({ baseUrl = '', getToken, fetchImpl, retries = 3, retryDelayMs = 400 } = {}) {
  const f = fetchImpl || ((...a) => globalThis.fetch(...a));
  const base = String(baseUrl).replace(/\/+$/, '');
  let cfgCache = null;

  async function send(a, { query = '', body, raw, binary = false, auth = true }) {
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const headers = {};
      if (auth) headers.Authorization = `Bearer ${await getToken({ refresh: refreshed })}`;
      if (raw) headers['Content-Type'] = 'application/octet-stream';
      else if (body !== undefined) headers['Content-Type'] = 'application/json';
      let r = null, err = null;
      try {
        r = await f(`${base}/api/drive?a=${encodeURIComponent(a)}${query}`, { method: 'POST', headers, body: raw || (body !== undefined ? JSON.stringify(body) : undefined) });
      } catch (e) { err = e; }
      const status = r ? r.status : 0;
      if (r && r.ok) return binary ? new Uint8Array(await r.arrayBuffer()) : r.json();
      let j = null;
      if (r) { try { j = await r.json(); } catch { j = null; } }
      if (status === 401 && auth && !refreshed && j && j.error === 'invalid_account') { refreshed = true; continue; }
      if (RETRY_STATUS.has(status) && attempt < retries && !(j && j.error === 'drive_not_configured')) { await sleep(retryDelayMs * 2 ** attempt); continue; }
      if (!r) throw new OneError(0, 'network', (err && err.message) || 'network error');
      const { ok, error, message, ...extra } = j || {};
      throw new OneError(status, error || 'http_' + status, message || 'HTTP ' + status, extra);
    }
  }
  const call = (a, body = {}) => send(a, { body });

  const api = {
    // ------------------------------------------------------------ low level (1:1 with the actions)
    async config(force) { if (!cfgCache || force) cfgCache = await send('config', { body: {}, auth: false }); return cfgCache; },
    quota: (detail = true) => call('quota', { detail }),
    changes: (cursor = 0, limit = 500) => call('changes', { cursor, limit }),
    mkdir: (o) => call('mkdir', o),
    uploadCreate: (o) => call('upload.create', o),
    uploadPut: (uploadId, i, bytes) => send('upload.put', { query: `&u=${uploadId}&i=${i}`, raw: bytes }),
    uploadUrls: (uploadId, from = 0, count = 100) => call('upload.urls', { uploadId, from, count }),
    uploadStatus: (uploadId) => call('upload.status', { uploadId }),
    uploadAbort: (uploadId) => call('upload.abort', { uploadId }),
    commit: (o) => call('commit', o),
    update: (o) => call('update', o),
    trash: (nodeId, baseVersion) => call('trash', { nodeId, baseVersion }),
    restore: (nodeId) => call('restore', { nodeId }),
    deleteForever: (nodeId) => call('delete', { nodeId }),
    emptyTrash: () => call('trash.empty', { confirm: true }),
    versions: (nodeId) => call('versions', { nodeId }),
    restoreVersion: (nodeId, revId, baseVersion) => call('version.restore', { nodeId, revId, baseVersion }),
    deleteVersion: (nodeId, revId) => call('version.delete', { nodeId, revId }),
    getChunk: (blobId, i) => send('get', { query: `&b=${blobId}&i=${i}`, binary: true }),
    downloadUrls: (blobId, from = 0, count = 100) => call('download.urls', { blobId, from, count }),
    thumbs: (ids) => call('thumbs', { ids }),
    albumPut: (o) => call('album.put', o),
    albumDelete: (albumId) => call('album.delete', { albumId }),
    albumItems: (albumId, add = [], remove = []) => call('album.items', { albumId, add, remove }),
    backupReport: (o) => call('backup.report', o),
    backupList: () => call('backup.list', {}),
    backupForget: (deviceId) => call('backup.forget', { deviceId }),
    dedupe: (hashes) => call('dedupe', { hashes }),
    exportPage: (after = null, limit = 200) => call('export', { after, limit }),

    // ------------------------------------------------------------ high level
    /**
     * Encrypt and upload one blob (content / thumb / preview) of a revision. Resumable: pass `uploadId` of an
     * earlier session (same fileKey + revId!) and only the missing chunks are sent. Chunks go up in parallel,
     * in any order; duplicates are harmless.
     * → { uploadId, duplicates }
     */
    async uploadBlob({ keys, fileKey, nodeId, revId, purpose = 'content', data, hash, uploadId, concurrency = 3, onProgress, signal }) {
      const { chunkSize } = await api.config();
      const lay = K.layout(K.sizeOf(data), chunkSize);
      let session, received = new Set(), duplicates = [];
      if (uploadId) {
        const st = await api.uploadStatus(uploadId);
        if (st.status !== 'pending' || st.expired || st.chunks !== lay.chunks || st.size !== lay.cipherSize) throw new OneError(409, 'resume_mismatch', 'Upload kann nicht fortgesetzt werden');
        session = { uploadId, direct: st.backend === 's3' };
        received = new Set(st.received);
      } else {
        const r = await api.uploadCreate({ purpose, size: lay.cipherSize, chunks: lay.chunks, hash: hash || undefined });
        session = r; duplicates = r.duplicates || [];
      }
      const ctx = { userId: keys.userId, nodeId, revId, blobId: session.uploadId, purpose };
      const bk = await K.blobKey(fileKey, session.uploadId, purpose);
      const todo = [];
      for (let i = 0; i < lay.chunks; i++) if (!received.has(i)) todo.push(i);
      let urls = new Map();
      const presigned = async (i) => {
        if (!urls.has(i)) { const r = await api.uploadUrls(session.uploadId, i, 100); for (const u of r.urls) urls.set(u.i, u); }
        return urls.get(i);
      };
      let done = lay.chunks - todo.length;
      const worker = async () => {
        while (todo.length) {
          if (signal && signal.aborted) throw new OneError(0, 'aborted', 'abgebrochen');
          const i = todo.shift();
          const plain = await K.bytesOf(data, i * lay.plainChunk, Math.min((i + 1) * lay.plainChunk, K.sizeOf(data)));
          const sealed = await K.sealChunk(bk, ctx, i, lay.chunks, plain);
          if (session.direct) {
            for (let attempt = 0; ; attempt++) {
              const u = await presigned(i);
              const r = await f(u.url, { method: 'PUT', headers: u.headers, body: sealed }).catch(() => null);
              if (r && r.ok) break;
              urls.delete(i);
              if (attempt >= retries) throw new OneError(r ? r.status : 0, 'storage_upload_failed', 'Upload in den Speicher fehlgeschlagen');
              await sleep(retryDelayMs * 2 ** attempt);
            }
          } else {
            await api.uploadPut(session.uploadId, i, sealed);
          }
          done++;
          if (onProgress) onProgress({ purpose, done, total: lay.chunks });
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, todo.length)) }, worker));
      return { uploadId: session.uploadId, duplicates, cipherSize: lay.cipherSize };
    },

    /**
     * Upload a new file/photo (baseVersion 0) or a new version of an existing one (baseVersion = node.version,
     * nodeKey = its opened node key). meta: extra node metadata (photo: { takenAt, w, h, gps, exif … }).
     * thumb/preview: already rendered JPEG/WebP bytes (the app renders them; ≤ thumbMaxBytes − 28).
     * skipDuplicates: stop before uploading when the same content is already stored (photo backup).
     * → { node, duplicate?: [nodeIds] }
     */
    async uploadFile({ keys, file, name, mime = 'application/octet-stream', mtime = Date.now(), kind = 'file', parentId = null, nodeId, baseVersion = 0,
      nodeKey, wrappedNodeKey, meta = {}, thumb, preview, deviceId, skipDuplicates = false, concurrency = 3, onProgress, signal }) {
      nodeId = nodeId || K.uuid();
      const revId = K.uuid();
      const digest = await K.contentDigest(file);
      const hash = await K.dedupeHash(keys, digest);
      if (skipDuplicates) {
        const d = await api.dedupe([hash]);
        if (d.matches && d.matches[hash] && d.matches[hash].length) return { node: null, duplicate: d.matches[hash] };
      }
      let wrapped = null;
      if (baseVersion === 0) { const nk = await K.createNodeKey(keys, nodeId); nodeKey = nk.key; wrapped = nk.wrapped; }
      else if (!nodeKey) nodeKey = await K.openNodeKey(keys, nodeId, wrappedNodeKey);
      const fk = await K.createFileKey(nodeKey, { userId: keys.userId, nodeId, revId });
      const content = await api.uploadBlob({ keys, fileKey: fk.key, nodeId, revId, purpose: 'content', data: file, hash, concurrency, onProgress, signal });
      const extra = {};
      for (const [purpose, data] of [['thumb', thumb], ['preview', preview]]) {
        if (data) extra[purpose] = (await api.uploadBlob({ keys, fileKey: fk.key, nodeId, revId, purpose, data, concurrency: 1, signal })).uploadId;
      }
      const revMeta = await K.sealRevMeta(fk.key, { userId: keys.userId, nodeId, revId }, {
        v: 1, size: K.sizeOf(file), mime, mtime, digest: K.hex(digest),
        thumb: thumb ? { mime: meta.thumbMime || 'image/jpeg' } : undefined, preview: preview ? { mime: meta.previewMime || 'image/jpeg' } : undefined,
      });
      const nodeMeta = (baseVersion === 0 || name != null)
        ? await K.sealMeta(nodeKey, { userId: keys.userId, kind, id: nodeId }, { v: 1, name, ...meta, thumbMime: undefined, previewMime: undefined })
        : undefined;
      const r = await api.commit({
        nodeId, parentId, kind, baseVersion, key: wrapped || undefined, meta: nodeMeta,
        rev: { id: revId, key: fk.wrapped, meta: revMeta, hash }, content: content.uploadId, thumb: extra.thumb, preview: extra.preview, deviceId,
      });
      return { node: r.node, duplicate: content.duplicates.length ? content.duplicates : undefined };
    },

    /** Decrypt node metadata (+ current revision metadata). → { nodeKey, meta, rev: { fileKey, meta } | null } */
    async openNode(keys, node) {
      const nodeKey = await K.openNodeKey(keys, node.id, node.key);
      const meta = await K.openMeta(nodeKey, { userId: keys.userId, kind: node.kind, id: node.id }, node.meta);
      let rev = null;
      if (node.head) {
        const ctx = { userId: keys.userId, nodeId: node.id, revId: node.head.id };
        const fileKey = await K.openFileKey(nodeKey, ctx, node.head.key);
        rev = { fileKey, meta: await K.openRevMeta(fileKey, ctx, node.head.meta) };
      }
      return { nodeKey, meta, rev };
    },

    /** Download + decrypt a blob of a revision (default: the current content). → Uint8Array */
    async downloadFile({ keys, node, revision, purpose = 'content', concurrency = 4, onProgress, verify = true }) {
      const rev = revision || node.head;
      if (!rev) throw new OneError(404, 'not_found', 'keine Version');
      const blob = rev.blobs.find(b => b.purpose === purpose);
      if (!blob) throw new OneError(404, 'not_found', 'kein ' + purpose);
      const nodeKey = await K.openNodeKey(keys, node.id, node.key);
      const ctx = { userId: keys.userId, nodeId: node.id, revId: rev.id, blobId: blob.id, purpose };
      const fileKey = await K.openFileKey(nodeKey, ctx, rev.key);
      const rmeta = await K.openRevMeta(fileKey, ctx, rev.meta);
      const bk = await K.blobKey(fileKey, blob.id, purpose);
      const parts = new Array(blob.chunks);
      const urls = new Map();
      const todo = Array.from({ length: blob.chunks }, (_, i) => i);
      let done = 0;
      const fetchChunk = async (i) => {
        if (blob.backend !== 's3') return api.getChunk(blob.id, i);
        for (let attempt = 0; ; attempt++) {
          if (!urls.has(i)) { const r = await api.downloadUrls(blob.id, i, 50); for (const u of r.urls) urls.set(u.i, u); }
          const r = await f(urls.get(i).url).catch(() => null);
          if (r && r.ok) return new Uint8Array(await r.arrayBuffer());
          urls.delete(i);
          if (attempt >= retries) throw new OneError(r ? r.status : 0, 'storage_download_failed', 'Download aus dem Speicher fehlgeschlagen');
          await sleep(retryDelayMs * 2 ** attempt);
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, blob.chunks) }, async () => {
        while (todo.length) {
          const i = todo.shift();
          parts[i] = await K.openChunk(bk, ctx, i, blob.chunks, await fetchChunk(i));
          done++;
          if (onProgress) onProgress({ done, total: blob.chunks });
        }
      }));
      const total = parts.reduce((s, p) => s + p.length, 0);
      const out = new Uint8Array(total);
      let o = 0;
      for (const p of parts) { out.set(p, o); o += p.length; }
      if (verify && purpose === 'content') {
        if (rmeta.size !== out.length) throw new OneError(0, 'integrity', 'Größe stimmt nicht');
        if (rmeta.digest && K.hex(await K.contentDigest(out)) !== rmeta.digest) throw new OneError(0, 'integrity', 'Prüfsumme stimmt nicht');
      }
      return out;
    },

    /** Thumbnails for many nodes at once (current revisions). → Map(nodeId → Uint8Array image bytes) */
    async thumbnails(keys, nodes) {
      const out = new Map();
      const want = [];
      for (const n of nodes) {
        const b = n.head && n.head.blobs.find(x => x.purpose === 'thumb');
        if (b) want.push({ n, b });
      }
      for (let i = 0; i < want.length; i += 100) {
        const part = want.slice(i, i + 100);
        const r = await api.thumbs(part.map(x => x.b.id));
        for (const { n, b } of part) {
          const data = r.thumbs[b.id];
          if (!data) continue;
          const nodeKey = await K.openNodeKey(keys, n.id, n.key);
          const ctx = { userId: keys.userId, nodeId: n.id, revId: n.head.id, blobId: b.id, purpose: 'thumb' };
          const fileKey = await K.openFileKey(nodeKey, ctx, n.head.key);
          out.set(n.id, await K.openSmall(fileKey, ctx, K.unb64u(data)));
        }
      }
      return out;
    },

    /**
     * Incremental sync: fetch all changes after `cursor` (oldest first) and hand each to onChange; on `reset`
     * (cursor older than the server's tombstone horizon) onReset() is called and the sync restarts at 0.
     * → new cursor (persist it AFTER the changes were applied)
     */
    async pull({ cursor = 0, onChange, onReset, limit = 500 }) {
      for (let guard = 0; guard < 100000; guard++) {
        const r = await api.changes(cursor, limit);
        if (r.reset) { if (onReset) await onReset(); cursor = 0; continue; }
        for (const c of r.changes) await onChange(c);
        cursor = r.cursor;
        if (!r.more) return cursor;
      }
      return cursor;
    },
  };
  return api;
}
