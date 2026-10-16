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
    // Notfallzugang (§12) – owner
    emIdentity: () => call('em.identity', {}),
    emIdentityPut: (o) => call('em.identity.put', o),
    emStatus: () => call('em.status', {}),
    emSetup: (o) => call('em.setup', o),
    emDelete: () => call('em.delete', { confirm: true }),
    emInvite: (setupId, email) => call('em.invite', { setupId, email }),
    emRemove: (setupId, slot) => call('em.remove', { setupId, slot }),
    emSealPackages: (o) => call('em.seal', o),
    emDeny: (setupId) => call('em.deny', { setupId }),
    emRevoke: (setupId) => call('em.revoke', { setupId }),
    emLog: (before = null, limit = 100) => call('em.log', { before: before || undefined, limit }),
    emKeysDigest: (setupId) => call('em.keys.digest', { setupId }),
    emKeysList: (setupId, after = null, limit = 5000) => call('em.keys.list', { setupId, after: after || undefined, limit }),
    emKeysPut: (setupId, items) => call('em.keys.put', { setupId, items }),
    emKeysDel: (setupId, items) => call('em.keys.del', { setupId, items }),
    // Notfallzugang – trusted contact
    emAccept: (setupId) => call('em.accept', { setupId }),
    emLeave: (setupId) => call('em.leave', { setupId }),
    emRequest: (setupId) => call('em.request', { setupId }),
    emPackage: (setupId) => call('em.package', { setupId }),
    emPool: (setupId, items) => call('em.pool', { setupId, items }),
    emItems: (setupId, after = null, limit = 500) => call('em.items', { setupId, after: after || undefined, limit }),
    emThumbs: (setupId, ids) => call('em.thumbs', { setupId, ids }),
    emDownloadUrls: (setupId, blobId, from = 0, count = 100) => call('em.download.urls', { setupId, blobId, from, count }),
    emGetChunk: (setupId, blobId, i) => send('em.get', { query: `&s=${setupId}&b=${blobId}&i=${i}`, binary: true }),

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
      const nodeKey = await K.openNodeKey(keys, node.id, node.key);
      return api.readBlob({ userId: keys.userId, node, nodeKey, revision, purpose, concurrency, onProgress, verify,
        getChunk: (blobId, i) => api.getChunk(blobId, i), getUrls: (blobId, from, count) => api.downloadUrls(blobId, from, count) });
    },

    /** Decrypt a blob with an already opened node key (own or Notfallzugang). getChunk / getUrls fetch ciphertext. */
    async readBlob({ userId, node, nodeKey, revision, purpose = 'content', concurrency = 4, onProgress, verify = true, getChunk, getUrls }) {
      const rev = revision || node.head;
      if (!rev) throw new OneError(404, 'not_found', 'keine Version');
      const blob = rev.blobs.find(b => b.purpose === purpose);
      if (!blob) throw new OneError(404, 'not_found', 'kein ' + purpose);
      const ctx = { userId, nodeId: node.id, revId: rev.id, blobId: blob.id, purpose };
      const fileKey = await K.openFileKey(nodeKey, ctx, rev.key);
      const rmeta = await K.openRevMeta(fileKey, ctx, rev.meta);
      const bk = await K.blobKey(fileKey, blob.id, purpose);
      const parts = new Array(blob.chunks);
      const urls = new Map();
      const todo = Array.from({ length: blob.chunks }, (_, i) => i);
      let done = 0;
      const fetchChunk = async (i) => {
        if (blob.backend !== 's3') return getChunk(blob.id, i);
        for (let attempt = 0; ; attempt++) {
          if (!urls.has(i)) { const r = await getUrls(blob.id, i, 50); for (const u of r.urls) urls.set(u.i, u); }
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

    // ------------------------------------------------------------ Notfallzugang (§12): client algorithms
    /**
     * The account's identity key (shared with the family folders of FaLe PDF): open it, or create + store it.
     * mk: master key (HKDF CryptoKey). → { kid, publicJwk, privateKey, created }
     */
    async emIdentityEnsure({ mk, userId }) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await api.emIdentity();
        if (r.key) {
          if (await K.identityKid(r.key.publicJwk) !== r.key.keyId) throw new OneError(0, 'key_mismatch', 'Schlüssel-Kennung passt nicht');
          const privateKey = await K.identityOpen(mk, userId, r.key.wrappedPrivate); // authenticated by MK
          if (!(await K.identityMatches(privateKey, r.key.publicJwk))) throw new OneError(0, 'key_mismatch', 'Öffentlicher Schlüssel passt nicht zum privaten');
          return { kid: r.key.keyId, publicJwk: r.key.publicJwk, privateKey, created: false };
        }
        const c = await K.identityCreate(mk, userId);
        try { await api.emIdentityPut({ keyId: c.kid, publicJwk: c.publicJwk, wrapped: c.wrapped, mode: 'create' }); }
        catch (e) { if (e.code === 'exists') continue; throw e; }
        return { kid: c.kid, publicJwk: c.publicJwk, privateKey: c.privateKey, created: true };
      }
      throw new OneError(409, 'exists', 'Schlüssel existiert bereits');
    },
    /** Owner: create the setup. scope: { v: 1, mode: 'items'|'all', roots: [nodeId], albums: [albumId], note? } → { setupId, ek, own } */
    async emCreate({ keys, ownerKid, waitHours, scope, threshold = 1, setupId = K.uuid() }) {
      const ek = K.emNewKey();
      const ownerKey = await K.emOwnerWrap(keys, setupId, ek);
      const sealed = await K.emSealScope(ek, { ownerId: keys.userId, setupId }, scope);
      const r = await api.emSetup({ setupId, baseVersion: 0, waitHours, ownerKey, ownerKid, scope: sealed, threshold });
      return { setupId, ek, own: r.own };
    },
    /** Owner: EK from the setup (raw 32 bytes; caller wipes). */
    emOwnerKey: (keys, own) => K.emOwnerOpen(keys, own.setup.id, own.setup.ownerKey),
    async emScope(keys, own, ek) { return K.emOpenScope(ek || await api.emOwnerKey(keys, own), { ownerId: keys.userId, setupId: own.setup.id }, own.setup.scope); },
    /** Owner: change waiting period and/or scope (and, while nobody is active yet, the threshold). */
    async emUpdate({ keys, own, waitHours = own.setup.waitHours, scope, threshold }) {
      let sealed = own.setup.scope;
      if (scope) { const ek = await api.emOwnerKey(keys, own); try { sealed = await K.emSealScope(ek, { ownerId: keys.userId, setupId: own.setup.id }, scope); } finally { ek.fill(0); } }
      return (await api.emSetup({ setupId: own.setup.id, baseVersion: own.setup.version, waitHours, scope: sealed, threshold })).own;
    },
    /**
     * Owner: (re)seal EK – or, for threshold k > 1, a fresh Shamir split – for every active contact plus `confirm`
     * (slots whose safety code was just compared). Each package also carries the roster (slot, account id, key id)
     * so contacts only pool shares with keys the owner verified, and the check value to detect wrong shares.
     */
    async emReseal({ keys, own, threshold = own.setup.threshold, confirm = [], drop = [] }) {
      const setupId = own.setup.id, ownerId = keys.userId;
      const list = own.contacts.filter(c => (c.status === 'active' || (c.status === 'accepted' && confirm.includes(c.slot))) && !drop.includes(c.slot));
      if (!list.length) throw new OneError(400, 'bad_input', 'Keine Vertrauensperson');
      for (const c of list) if (!c.kid || !c.publicJwk || await K.identityKid(c.publicJwk) !== c.kid) throw new OneError(409, 'key_changed', 'Schlüssel passt nicht', { slot: c.slot });
      const k = Math.min(Math.max(1, threshold), 3);
      const ek = await api.emOwnerKey(keys, own);
      try {
        const check = await K.emCheck(ek, ownerId, setupId);
        const roster = list.map(c => ({ slot: c.slot, id: c.contactId, kid: c.kid }));
        // k may exceed the contacts confirmed so far (e.g. 2 of 3 with one confirmed): evaluate the polynomial at
        // unused x values too and discard those shares – the setup becomes usable once k contacts are active
        const xs = list.map(c => c.slot);
        for (let x = 1; xs.length < k; x++) if (!xs.includes(x)) xs.push(x);
        const shares = K.shamirSplit(ek, xs.length, k, xs);
        for (const s of shares.slice(list.length)) s.y.fill(0);
        const packages = [];
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          packages.push({ slot: c.slot, kid: c.kid, package: await K.emSeal(c.publicJwk, { purpose: 'share', ownerId, setupId, from: ownerId, to: c.contactId },
            { v: 1, t: 'share', setupId, ownerId, slot: c.slot, x: shares[i].x, k, n: list.length, y: K.b64u(shares[i].y), check, roster }) });
          shares[i].y.fill(0);
        }
        return (await api.emSealPackages({ setupId, baseVersion: own.setup.version, threshold: k, packages })).own;
      } finally { ek.fill(0); }
    },
    /**
     * Owner: make the server's set of EK-wrapped keys equal the wanted set (nodes: [{ id, key }] with the node's
     * KEK-wrapped key, albums: [{ id, key }]). Cheap when nothing changed (one digest call). → { added, removed }
     */
    async emSyncKeys({ keys, own, ek, nodes = [], albums = [] }) {
      const setupId = own.setup.id, ownerId = keys.userId;
      const want = new Map();
      for (const n of nodes) want.set('node:' + n.id, { kind: 'node', id: n.id, key: n.key });
      for (const a of albums) want.set('album:' + a.id, { kind: 'album', id: a.id, key: a.key });
      const lines = [...want.keys()].sort();
      const digest = K.hex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(lines.map(l => l + '\n').join('')))));
      const d = await api.emKeysDigest(setupId);
      if (d.digest === digest && d.count === lines.length) return { added: 0, removed: 0 };
      const have = new Set();
      for (let after = null, g = 0; g < 1000; g++) { const r = await api.emKeysList(setupId, after); r.items.forEach(x => have.add(x)); if (!r.next) break; after = r.next; }
      const add = lines.filter(l => !have.has(l)), del = [...have].filter(l => !want.has(l));
      let added = 0, removed = 0;
      const own_ = ek || await api.emOwnerKey(keys, own);
      try {
        for (let i = 0; i < add.length; i += 200) {
          const items = [];
          for (const l of add.slice(i, i + 200)) {
            const w = want.get(l);
            const raw = await K.openItemKeyRaw(keys, w.kind, w.id, w.key);
            try { items.push({ kind: w.kind, id: w.id, key: await K.emWrapItem(own_, { ownerId, setupId, kind: w.kind, id: w.id }, raw) }); } finally { raw.fill(0); }
          }
          added += (await api.emKeysPut(setupId, items)).added;
        }
      } finally { if (!ek) own_.fill(0); }
      for (let i = 0; i < del.length; i += 2000) {
        removed += (await api.emKeysDel(setupId, del.slice(i, i + 2000).map(l => { const [kind, id] = l.split(':'); return { kind, id }; }))).removed;
      }
      return { added, removed };
    },
    /**
     * Contact (after the release): open the own package, pool the share with the other released contacts the owner
     * verified (k of n), combine and verify. → { ek, ownerId } or { waiting: { have, need } }
     */
    async emUnlock({ setupId, userId, privateKey }) {
      const p = await api.emPackage(setupId);
      const ownerId = p.ownerId;
      const pkg = await K.emOpen(privateKey, { purpose: 'share', ownerId, setupId, from: ownerId, to: userId }, p.package);
      if (pkg.v !== 1 || pkg.t !== 'share' || pkg.setupId !== setupId || pkg.ownerId !== ownerId || pkg.slot !== p.slot || pkg.x !== pkg.slot) throw new OneError(0, 'tampered', 'Paket passt nicht');
      const mine = { x: pkg.x, y: K.unb64u(pkg.y) };
      const shares = [mine];
      if (pkg.k > 1) {
        const roster = new Map((pkg.roster || []).map(r => [r.slot, r]));
        const items = [];
        for (const q of p.requesters) {
          if (q.slot === pkg.slot) continue;
          const r = roster.get(q.slot);
          if (!r || r.id !== q.contactId || r.kid !== q.kid || !q.publicJwk || await K.identityKid(q.publicJwk) !== r.kid) continue; // never pool with an unverified key
          items.push({ to: q.slot, sealed: await K.emSeal(q.publicJwk, { purpose: 'pool', ownerId, setupId, from: userId, to: q.contactId }, { v: 1, t: 'pool', setupId, from: pkg.slot, x: pkg.x, y: pkg.y }) });
        }
        if (items.length) await api.emPool(setupId, items);
        for (const e of p.pool) {
          const r = roster.get(e.from);
          if (!r) continue;
          try {
            const o = await K.emOpen(privateKey, { purpose: 'pool', ownerId, setupId, from: r.id, to: userId }, e.sealed);
            if (o.t === 'pool' && o.setupId === setupId && o.from === e.from && o.x === e.from && !shares.some(s => s.x === o.x)) shares.push({ x: o.x, y: K.unb64u(o.y) });
          } catch { /* a share that does not open is ignored (the check below decides) */ }
        }
      }
      if (shares.length < pkg.k) return { waiting: { have: shares.length, need: pkg.k }, ownerId };
      const combos = (arr, k, start = 0, cur = [], out = []) => { if (cur.length === k) { out.push(cur.slice()); return out; } for (let i = start; i < arr.length; i++) { cur.push(arr[i]); combos(arr, k, i + 1, cur, out); cur.pop(); } return out; };
      for (const set of combos(shares, pkg.k)) {
        const ek = K.shamirCombine(set);
        if (await K.emCheck(ek, ownerId, setupId) === pkg.check) { shares.forEach(s => s.y.fill(0)); return { ek, ownerId }; }
        ek.fill(0);
      }
      throw new OneError(0, 'tampered', 'Die Schlüsselteile passen nicht zusammen (beschädigt oder manipuliert).');
    },
    /** Contact: all covered items, decrypted. → { ownerId, scope, nodes: [{ raw, nodeKey, meta, rev }], albums: [{ raw, meta, items }] } */
    async emLoad({ setupId, ek }) {
      const out = { ownerId: null, scope: null, nodes: [], albums: [] };
      for (let after = null, g = 0; g < 10000; g++) {
        const r = await api.emItems(setupId, after, 500);
        out.ownerId = r.ownerId;
        const ownerId = r.ownerId;
        if (r.albums) {
          out.scope = await K.emOpenScope(ek, { ownerId, setupId }, r.scope).catch(() => null);
          for (const a of r.albums) {
            try {
              const ak = await K.emOpenItem(ek, { ownerId, setupId, kind: 'album', id: a.id }, a.emKey);
              out.albums.push({ raw: a, meta: await K.openMeta(ak, { userId: ownerId, kind: 'album', id: a.id }, a.meta), items: a.items });
            } catch { out.albums.push({ raw: a, meta: null, items: a.items, err: 'decrypt' }); }
          }
        }
        for (const n of r.nodes) {
          try {
            const nodeKey = await K.emOpenItem(ek, { ownerId, setupId, kind: 'node', id: n.id }, n.emKey);
            const meta = await K.openMeta(nodeKey, { userId: ownerId, kind: n.kind, id: n.id }, n.meta);
            let rev = null;
            if (n.head) {
              const ctx = { userId: ownerId, nodeId: n.id, revId: n.head.id };
              rev = await K.openRevMeta(await K.openFileKey(nodeKey, ctx, n.head.key), ctx, n.head.meta);
            }
            out.nodes.push({ raw: n, nodeKey, meta, rev });
          } catch { out.nodes.push({ raw: n, nodeKey: null, meta: null, rev: null, err: 'decrypt' }); }
        }
        if (!r.next) break;
        after = r.next;
      }
      return out;
    },
    /** Contact: download + decrypt a covered file (verified like downloadFile). */
    emDownload({ setupId, ownerId, node, nodeKey, purpose = 'content', onProgress, verify = true }) {
      return api.readBlob({ userId: ownerId, node, nodeKey, purpose, onProgress, verify,
        getChunk: (blobId, i) => api.emGetChunk(setupId, blobId, i), getUrls: (blobId, from, count) => api.emDownloadUrls(setupId, blobId, from, count) });
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
