'use strict';
// POST /api/drive?a=<action> – FaLe One (FaLe Drive + FaLe Fotos), end-to-end encrypted. Contract:
// docs/FALE-ONE-API.md. The files in /api only wire this handler to Vercel; tests call it directly.
//
// Zero-knowledge by construction: devices encrypt names, metadata, thumbnails and content before upload
// (js/one/crypto.js). This code only sees opaque ids, wrapped keys, encrypted envelopes, ciphertext chunks,
// sizes and timestamps. Auth = FaLe-Konto access token (Supabase Auth JWT, verified in supa-auth.js); the user
// id is then passed to secret-gated SQL functions (drivestore.js). Nothing about content is logged.
//
// Threat model (summary – details in docs/FALE-ONE-API.md §10):
//   - server / DB operator / storage breach: ciphertext + sizes + timestamps + tree shape (parent ids) + album
//     membership + equality of the user's own files via the keyed hash → no names, no content, no EXIF/GPS.
//     Can withhold/delete data (availability) or roll back to an older state; cannot read or undetectably
//     modify it (AES-GCM with AAD over user/node/revision/blob/chunk index/count/final flag).
//   - other users: every query is scoped to the verified user id; foreign ids behave exactly like unknown ids
//     (404 not_found) → no enumeration. Ids are random UUIDs.
//   - abuse: per-account + per-IP-hash daily request/byte limits, quota (read-only when full, never deletion),
//     global capacity cap for the Postgres blob store, upload sessions expire after 24 h.
const crypto = require('node:crypto');
const C = require('./config');
const H = require('./http');
const Sec = require('./security');
const A = require('./supa-auth');
const { getDriveStore } = require('./drivestore');
const { getShareStore } = require('./sharestore');
const B = require('./blobstore');

const env = k => String(process.env[k] == null ? '' : process.env[k]).trim();
const num = (k, def, min, max) => { const v = parseFloat(env(k).replace(',', '.')); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def; };
const bool = (k, def) => { const v = env(k).toLowerCase(); return v ? ['1', 'true', 'yes', 'on', 'ja'].includes(v) : def; };
const MiB = 1024 * 1024;

function driveConfig() {
  return {
    enabled: bool('ONE_ENABLED', false),                                   // + ACCOUNTS_ENABLED (FaLe-Konto)
    chunkSize: Math.round(num('ONE_CHUNK_KB', 1024, 64, 4096)) * 1024,     // ciphertext bytes per chunk (Vercel body ≤ 4.5 MB)
    dailyRequests: Math.round(num('ONE_DAILY_REQUESTS', 20000, 1, 1e7)),           // per account (JSON actions)
    ipDailyRequests: Math.round(num('ONE_IP_DAILY_REQUESTS', 40000, 1, 1e7)),      // per IP (/64) hash
    dailyChunks: Math.round(num('ONE_DAILY_CHUNKS', 60000, 1, 1e8)),               // chunk uploads / downloads each, per account
    ipDailyChunks: Math.round(num('ONE_IP_DAILY_CHUNKS', 120000, 1, 1e8)),
    uploadDailyBytes: Math.round(num('ONE_UPLOAD_DAILY_MB', 20480, 1, 1e8) * MiB),
    ipUploadDailyBytes: Math.round(num('ONE_IP_UPLOAD_DAILY_MB', 40960, 1, 1e8) * MiB),
    downloadDailyBytes: Math.round(num('ONE_DOWNLOAD_DAILY_MB', 51200, 1, 1e8) * MiB),
    ipDownloadDailyBytes: Math.round(num('ONE_IP_DOWNLOAD_DAILY_MB', 102400, 1, 1e8) * MiB),
    maxBody: 262144,
    cronSecret: env('CRON_SECRET'),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/; // lowercase only (ids are part of the AAD)
const B64_RE = /^[A-Za-z0-9_-]+$/;
const DEVICE_RE = /^[A-Za-z0-9_-]{16,64}$/;
const HASH_RE = /^[A-Za-z0-9_-]{43}$/;
const PURPOSES = ['content', 'thumb', 'preview'];
const KINDS = ['file', 'photo'];
const BACKUP_STATUS = ['idle', 'running', 'paused', 'error'];

const bad = (msg = 'Ungültige Anfrage') => new H.HttpError(400, 'bad_input', msg);
const isUuid = v => typeof v === 'string' && UUID_RE.test(v);
const uuidOrNull = (v, what) => { if (v == null) return null; if (!isUuid(v)) throw bad(`Ungültige ${what}`); return v; };
const needUuid = (v, what) => { if (!isUuid(v)) throw bad(`Ungültige ${what}`); return v; };
const b64 = (v, min, max) => typeof v === 'string' && v.length >= min && v.length <= max && B64_RE.test(v);
const needKey = (v) => { if (!b64(v, 40, 200)) throw bad('Ungültiger Schlüssel'); return v; };
const needMeta = (v, max = 65536) => { if (!b64(v, 24, max)) throw bad('Ungültige Metadaten'); return v; };
const intIn = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;
const uuidList = (v, max) => {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > max || !v.every(isUuid)) throw bad();
  return [...new Set(v)];
};

const MESSAGES = {
  bad_input: [400, 'Ungültige Anfrage'],
  bad_size: [400, 'Ungültige Teilgröße'],
  bad_index: [400, 'Ungültiger Teil'],
  too_large: [413, 'Die Datei ist zu groß.'],
  quota: [507, 'Dein Speicher ist voll. Alles bleibt lesbar und herunterladbar – lösche oder exportiere Dateien, um wieder hochzuladen.'],
  capacity: [503, 'Der Speicher für die Beta ist gerade voll. Bitte versuche es später erneut.'],
  not_found: [404, 'Nicht gefunden'],
  no_upload: [404, 'Der Upload ist abgelaufen oder unbekannt.'],
  exists: [409, 'Existiert bereits'],
  conflict: [409, 'Wurde inzwischen auf einem anderen Gerät geändert.'],
  trashed: [409, 'Liegt im Papierkorb – bitte zuerst wiederherstellen.'],
  not_trashed: [409, 'Endgültig löschen geht nur aus dem Papierkorb.'],
  bad_parent: [409, 'Der Zielordner existiert nicht (mehr).'],
  cycle: [409, 'Ein Ordner kann nicht in sich selbst verschoben werden.'],
  too_deep: [409, 'Zu viele verschachtelte Ordner.'],
  incomplete: [409, 'Der Upload ist unvollständig.'],
  too_many: [409, 'Zu viele Einträge.'],
  too_many_pending: [429, 'Zu viele gleichzeitige Uploads.'],
  is_head: [409, 'Die aktuelle Version kann nicht gelöscht werden.'],
  no_user: [401, 'Bitte melde dich erneut an.'],
};
function fail(r) {
  const reason = (r && r.reason) || 'not_found';
  const [status, msg] = MESSAGES[reason] || [400, 'Ungültige Anfrage'];
  const extra = {};
  if (r && r.node) extra.node = nodeOut(r.node);
  if (r && r.album) extra.album = albumOut(r.album);
  if (r && reason === 'quota') { extra.used = Number(r.used); extra.quota = Number(r.quota); }
  if (r && reason === 'too_large' && r.max != null) extra.max = Number(r.max);
  if (r && reason === 'bad_size' && r.want != null) extra.want = Number(r.want);
  return new H.HttpError(status, reason === 'quota' ? 'quota_exceeded' : reason, msg, Object.keys(extra).length ? extra : undefined);
}
const ok = r => { if (!r || !r.ok) throw fail(r); return r; };

// ------------------------------------------------------------------ JSON shapes (camelCase, see the contract)
function blobOut(b) { return { id: b.id, purpose: b.purpose, size: Number(b.size), chunks: Number(b.chunks), chunkSize: Number(b.chunk_size), backend: b.backend }; }
function revOut(r) {
  if (!r) return null;
  const o = { id: r.id, key: r.key, meta: r.meta, hash: r.hash || null, size: Number(r.size), deviceId: r.device_id || null,
    createdAt: r.created_at, supersededAt: r.superseded_at || null, blobs: (r.blobs || []).map(blobOut) };
  if (r.head !== undefined) o.head = !!r.head;
  return o;
}
function nodeOut(n) {
  if (!n) return null;
  const o = { t: 'node', id: n.id, parent: n.parent || null, kind: n.kind, version: Number(n.version), seq: Number(n.seq), key: n.key || null, meta: n.meta || null,
    createdAt: n.created_at, updatedAt: n.updated_at, trashedAt: n.trashed_at || null, trashRoot: n.trash_root || null, deleted: !!n.deleted, head: revOut(n.head) };
  if (n.revisions) o.revisions = n.revisions.map(revOut);
  return o;
}
function albumOut(a) {
  if (!a) return null;
  const o = { t: 'album', id: a.id, version: Number(a.version), seq: Number(a.seq), key: a.key || null, meta: a.meta || null, createdAt: a.created_at, updatedAt: a.updated_at, deleted: !!a.deleted };
  if (a.items) o.items = a.items;
  return o;
}
const memberOut = m => ({ t: 'member', album: m.album, node: m.node, seq: Number(m.seq), addedAt: m.added_at, removed: !!m.removed });
const changeOut = c => (c.t === 'node' ? nodeOut(c) : c.t === 'album' ? albumOut(c) : memberOut(c));

/** Raw request body (octet-stream) with a size limit. Accepts a Buffer pre-read by Vercel. */
async function readRaw(req, maxBytes) {
  const declared = Number(req.headers && req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw new H.HttpError(413, 'too_large', 'Teil zu groß');
  let pre;
  try { pre = req.body; } catch { throw bad('Ungültige Daten'); }
  if (Buffer.isBuffer(pre)) { if (pre.length > maxBytes) throw new H.HttpError(413, 'too_large', 'Teil zu groß'); return pre; }
  if (pre instanceof Uint8Array) { if (pre.length > maxBytes) throw new H.HttpError(413, 'too_large', 'Teil zu groß'); return Buffer.from(pre); }
  if (typeof pre === 'string') { const b = Buffer.from(pre, 'binary'); if (b.length > maxBytes) throw new H.HttpError(413, 'too_large', 'Teil zu groß'); return b; }
  if (pre !== undefined) throw bad('Ungültige Daten'); // parsed as JSON/form → not a ciphertext chunk (stream already consumed)
  if (req.readableEnded) return Buffer.alloc(0);
  return new Promise((resolve, reject) => {
    let chunks = [], size = 0;
    req.on('data', c => { size += c.length; if (size > maxBytes) { chunks = null; return; } if (chunks) chunks.push(c); });
    req.on('end', () => (chunks ? resolve(Buffer.concat(chunks)) : reject(new H.HttpError(413, 'too_large', 'Teil zu groß'))));
    req.on('error', reject);
  });
}

/** Delete queued S3 objects (deleted blobs). Returns { taken, deleted, failed }. */
async function runGc(cfg, { store, blobs, budgetMs = 20000 } = {}) {
  const until = Date.now() + budgetMs;
  const out = { taken: 0, deleted: 0, failed: 0 };
  if (!blobs || blobs.kind !== 's3') return out;
  while (Date.now() < until) {
    const r = await store.gcTake({ limit: 50 });
    const items = (r && r.items) || [];
    if (!items.length) break;
    out.taken += items.length;
    const done = [];
    for (const it of items) {
      if (!isUuid(it.user) || !isUuid(it.blob)) continue;
      try { await blobs.deleteBlob({ user: it.user, blob: it.blob, chunks: Number(it.chunks) }); done.push(Number(it.id)); out.deleted++; }
      catch { out.failed++; }
      if (Date.now() > until) break;
    }
    if (done.length) await store.gcDone({ ids: done });
    if (items.length < 50) break;
  }
  return out;
}

function makeDriveCore(overrides = {}) {
  const deps = {
    getConfig: C.getConfig, getDriveStore, getRateStore: getShareStore, fetchImpl: (...a) => fetch(...a), now: () => new Date(),
    verify: (cfg, token, opts) => A.verifyAccessToken(cfg, token, { fetchImpl: deps.fetchImpl, ...opts }),
    makeBlobstore: (store) => B.makeBlobstore(store, { fetchImpl: deps.fetchImpl }),
    ...overrides,
  };

  const configured = (cfg, dc) => !!(dc.enabled && C.accountConfigured(cfg) && C.secretsConfigured(cfg)
    && cfg.supabaseUrl && cfg.supabaseKey && cfg.rpcSecret && cfg.rpcSecret.length >= 32);
  function requireEnabled(cfg, dc) {
    if (!configured(cfg, dc)) throw new H.HttpError(503, 'drive_not_configured', 'FaLe One ist bald verfügbar.');
  }
  async function userOf(req, body, cfg) {
    const token = A.bearerOf(req, body);
    if (!token) throw new H.HttpError(401, 'invalid_account', 'Bitte melde dich an.');
    return deps.verify(cfg, token);
  }
  async function limit(cfg, req, user, kind, nLimits, bytes = 0, bLimits = [1, 1]) {
    const now = deps.now();
    const day = Sec.dayKey(cfg.timeZone, now);
    const ip = Sec.ipHash(cfg.ipSalt, H.clientIp(req), day);
    const r = await deps.getRateStore(cfg).rate({ day, kind, keys: ['a:' + A.accountKey(cfg.tokenSecret, user.id), 'i:' + ip], nLimits, bytes, bLimits });
    if (!r || r.ok === false) throw new H.HttpError(429, 'drive_limit', 'Tageslimit erreicht. Morgen geht es weiter.');
  }
  // migration not applied yet → a clear 503 instead of a 500
  const guard = fn => async (req, res, cfg) => {
    try { await fn(req, res, cfg); }
    catch (e) {
      if (e && e.code === 'store_error' && e.status === 404) throw new H.HttpError(503, 'drive_not_configured', 'FaLe One ist bald verfügbar.');
      if (e && e.code === 'blobstore_not_configured') throw new H.HttpError(503, 'drive_not_configured', 'Der Dateispeicher ist noch nicht eingerichtet.');
      if (e && e.code === 's3_error') throw new H.HttpError(502, 'storage_unavailable', 'Der Dateispeicher ist gerade nicht erreichbar. Bitte versuche es erneut.');
      throw e;
    }
  };
  function sendBytes(res, buf) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', String(buf.length));
    res.end(buf);
  }

  const drive = H.handler(['POST', 'GET'], guard(async (req, res, cfg) => {
    const dc = driveConfig();
    const q = H.query(req);
    const a = String(q.a || '');
    if (req.method === 'GET' && a !== 'gc') { res.setHeader('Allow', 'POST'); throw new H.HttpError(405, 'method_not_allowed', 'Methode nicht erlaubt'); }

    if (a === 'config') {
      const on = configured(cfg, dc);
      const bc = B.blobConfig();
      H.sendJson(res, 200, { ok: true, configured: on, chunkSize: dc.chunkSize, backend: bc.kind, direct: on && bc.kind === 's3',
        maxThumbBatch: 100, maxChangesPage: 1000, version: 1 });
      return;
    }
    if (a === 'gc') { // cron worker for the S3 garbage queue (Vercel Cron sends Authorization: Bearer $CRON_SECRET)
      const want = dc.cronSecret;
      const got = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!want || want.length < 16 || !Sec.safeEqual(crypto.createHash('sha256').update(got).digest('hex'), crypto.createHash('sha256').update(want).digest('hex'))) {
        throw new H.HttpError(403, 'forbidden', 'Keine Berechtigung');
      }
      const store = deps.getDriveStore(cfg);
      const out = await runGc(cfg, { store, blobs: B.blobConfig().kind === 's3' ? deps.makeBlobstore(store) : null, budgetMs: 40000 });
      H.sendJson(res, 200, { ok: true, ...out });
      return;
    }
    requireEnabled(cfg, dc);
    const store = deps.getDriveStore(cfg);
    const blobs = deps.makeBlobstore(store);
    const pgBlobs = B.postgresBlobstore(store);
    const storeFor = backend => (backend === 's3' ? blobs : pgBlobs);
    async function blobInfo(user, blob) {
      const r = await store.blobInfo({ user: user.id, blob });
      return r && r.ok ? r.blob : null;
    }

    // ---------------------------------------------------------------- raw chunk transfer (no JSON body)
    if (a === 'upload.put') {
      const blob = needUuid(String(q.u || ''), 'Upload-ID'), idx = Number(q.i);
      if (!intIn(idx, 0, 199999)) throw bad();
      const user = await userOf(req, null, cfg);
      await limit(cfg, req, user, 'one_put', [dc.dailyChunks, dc.ipDailyChunks]);
      const buf = await readRaw(req, dc.chunkSize);
      if (!buf.length) throw bad('Leerer Teil');
      let backend = 'pg';
      if (blobs.kind === 's3') {
        const info = await blobInfo(user, blob);
        if (!info || info.status !== 'pending' || info.expired) throw fail({ reason: 'no_upload' });
        backend = info.backend;
        if (backend === 's3') {
          if (idx >= info.chunks) throw fail({ reason: 'bad_index' });
          const want = idx < info.chunks - 1 ? info.chunk_size : info.size - (info.chunks - 1) * info.chunk_size;
          if (buf.length !== want) throw fail({ reason: 'bad_size', want });
        }
      }
      ok(await storeFor(backend).putChunk({ user: user.id, blob, idx, data: buf }));
      H.sendJson(res, 200, { ok: true });
      return;
    }
    if (a === 'get') {
      const blob = needUuid(String(q.b || ''), 'Datei-ID'), idx = Number(q.i);
      if (!intIn(idx, 0, 199999)) throw bad();
      const user = await userOf(req, null, cfg);
      await limit(cfg, req, user, 'one_dl', [dc.dailyChunks, dc.ipDailyChunks], dc.chunkSize, [dc.downloadDailyBytes, dc.ipDownloadDailyBytes]);
      let backend = 'pg';
      if (blobs.kind === 's3') {
        const info = await blobInfo(user, blob);
        if (!info || info.status !== 'live' || idx >= info.chunks) throw fail({ reason: 'not_found' });
        backend = info.backend;
      }
      const buf = await storeFor(backend).getChunk({ user: user.id, blob, idx });
      if (!buf) throw fail({ reason: 'not_found' });
      sendBytes(res, buf);
      return;
    }

    const body = await H.readJson(req, dc.maxBody);
    const user = await userOf(req, body, cfg);
    const u = user.id;
    const reqLimit = () => limit(cfg, req, user, 'one_req', [dc.dailyRequests, dc.ipDailyRequests]);

    switch (a) {
      case 'quota': {
        await reqLimit();
        const r = ok(await store.status({ user: u, detail: body.detail !== false }));
        const usage = r.usage ? Object.fromEntries(Object.entries(r.usage).map(([k, v]) => [k, Number(v)])) : null;
        const lim = Object.fromEntries(Object.entries(r.limits || {}).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), Number(v)]));
        H.sendJson(res, 200, { ok: true, quota: Number(r.quota), used: Number(r.used), readOnly: !!r.read_only, usage, nodes: Number(r.nodes),
          cursor: Number(r.cursor), minCursor: Number(r.min_cursor), chunkSize: dc.chunkSize, backend: blobs.kind, direct: blobs.direct, limits: lim });
        return;
      }
      case 'changes': {
        await reqLimit();
        const cursor = body.cursor == null ? 0 : Number(body.cursor);
        const lim = body.limit == null ? 500 : Number(body.limit);
        if (!intIn(cursor, 0, Number.MAX_SAFE_INTEGER) || !intIn(lim, 1, 1000)) throw bad();
        const r = ok(await store.changes({ user: u, after: cursor, limit: lim }));
        H.sendJson(res, 200, { ok: true, reset: !!r.reset, changes: (r.changes || []).map(changeOut), cursor: Number(r.cursor), more: !!r.more });
        return;
      }
      case 'mkdir': {
        await reqLimit();
        const r = ok(await store.mkdir({ user: u, node: needUuid(body.nodeId, 'ID'), parent: uuidOrNull(body.parentId, 'Ordner-ID'), key: needKey(body.key), meta: needMeta(body.meta) }));
        H.sendJson(res, 200, { ok: true, node: nodeOut(r.node) });
        return;
      }
      case 'upload.create': {
        const purpose = body.purpose || 'content';
        if (!PURPOSES.includes(purpose)) throw bad();
        const size = body.size, chunks = body.chunks;
        if (!intIn(size, 1, 1e13)) throw bad('Ungültige Größe');
        if (chunks !== Math.ceil(size / dc.chunkSize)) throw bad('Ungültige Aufteilung');
        if (body.hash != null && !(typeof body.hash === 'string' && HASH_RE.test(body.hash))) throw bad();
        await limit(cfg, req, user, 'one_up', [dc.dailyRequests, dc.ipDailyRequests], size, [dc.uploadDailyBytes, dc.ipUploadDailyBytes]);
        const backend = purpose === 'thumb' ? 'pg' : blobs.kind;
        const id = crypto.randomUUID();
        const r = ok(await store.uploadCreate({ user: u, blob: id, purpose, size, chunks, chunkSize: dc.chunkSize, backend, hash: body.hash || null }));
        H.sendJson(res, 200, { ok: true, uploadId: id, purpose, size, chunks, chunkSize: dc.chunkSize, backend, direct: backend === 's3',
          expiresAt: r.expires_at, duplicates: r.duplicates || [] });
        return;
      }
      case 'upload.urls': case 'download.urls': {
        await reqLimit();
        const blob = needUuid(a === 'upload.urls' ? body.uploadId : body.blobId, 'ID');
        const from = body.from == null ? 0 : body.from, count = body.count == null ? 100 : body.count;
        if (!intIn(from, 0, 199999) || !intIn(count, 1, 200)) throw bad();
        const info = await blobInfo(user, blob);
        const up = a === 'upload.urls';
        if (!info || (up ? info.status !== 'pending' || info.expired : info.status !== 'live')) throw fail({ reason: up ? 'no_upload' : 'not_found' });
        if (info.backend !== 's3') throw new H.HttpError(409, 'not_direct', 'Dieser Upload läuft über die API (upload.put / get).');
        const urls = [];
        for (let i = from; i < Math.min(info.chunks, from + count); i++) {
          const size = i < info.chunks - 1 ? info.chunk_size : info.size - (info.chunks - 1) * info.chunk_size;
          urls.push({ i, size, ...(up ? blobs.presignPut({ user: u, blob, idx: i, size }) : blobs.presignGet({ user: u, blob, idx: i })) });
        }
        if (!up) {
          const bytes = urls.reduce((s, x) => s + x.size, 0);
          await limit(cfg, req, user, 'one_dl', [dc.dailyChunks, dc.ipDailyChunks], bytes, [dc.downloadDailyBytes, dc.ipDownloadDailyBytes]);
        }
        H.sendJson(res, 200, { ok: true, urls, expiresIn: B.blobConfig().presignTtl });
        return;
      }
      case 'upload.status': {
        await reqLimit();
        const blob = needUuid(body.uploadId, 'Upload-ID');
        const r = ok(await store.uploadStatus({ user: u, blob }));
        let received = r.received || [];
        if (r.backend === 's3' && r.status === 'pending') {
          const sizes = await blobs.observe({ user: u, blob, chunks: Number(r.chunks) });
          received = sizes.map((s, i) => (s >= 0 && i < r.chunks ? i : -1)).filter(i => i >= 0);
        }
        H.sendJson(res, 200, { ok: true, uploadId: blob, status: r.status, purpose: r.purpose, backend: r.backend, size: Number(r.size), chunks: Number(r.chunks),
          chunkSize: Number(r.chunk_size), expiresAt: r.expires_at, expired: !!r.expired, received: received.map(Number) });
        return;
      }
      case 'upload.abort': {
        await reqLimit();
        const blob = needUuid(body.uploadId, 'Upload-ID');
        // s3 objects of an aborted upload are queued by the blob trigger and removed by the gc worker
        const r = ok(await store.uploadAbort({ user: u, blob }));
        H.sendJson(res, 200, { ok: true, deleted: !!r.deleted });
        return;
      }
      case 'commit': {
        await reqLimit();
        const rev = body.rev && typeof body.rev === 'object' ? body.rev : {};
        const baseVersion = body.baseVersion;
        if (!intIn(baseVersion, 0, Number.MAX_SAFE_INTEGER) || !KINDS.includes(body.kind)) throw bad();
        if (rev.hash != null && !(typeof rev.hash === 'string' && HASH_RE.test(rev.hash))) throw bad();
        if (body.deviceId != null && !(typeof body.deviceId === 'string' && DEVICE_RE.test(body.deviceId))) throw bad();
        const content = needUuid(body.content, 'Upload-ID'), thumb = uuidOrNull(body.thumb, 'Upload-ID'), preview = uuidOrNull(body.preview, 'Upload-ID');
        const o = {
          user: u, node: needUuid(body.nodeId, 'ID'), parent: uuidOrNull(body.parentId, 'Ordner-ID'), kind: body.kind, baseVersion,
          key: baseVersion === 0 ? needKey(body.key) : (body.key == null ? null : needKey(body.key)),
          meta: baseVersion === 0 ? needMeta(body.meta) : (body.meta == null ? null : needMeta(body.meta)),
          rev: needUuid(rev.id, 'Versions-ID'), revKey: needKey(rev.key), revMeta: needMeta(rev.meta), hash: rev.hash || null,
          content, thumb, preview, device: body.deviceId || null, observed: null,
        };
        if (blobs.kind === 's3') { // sizes of directly uploaded objects, verified by the SQL function
          const observed = {};
          for (const id of [content, thumb, preview].filter(Boolean)) {
            const info = await blobInfo(user, id);
            if (info && info.backend === 's3' && info.status === 'pending') observed[id] = await blobs.observe({ user: u, blob: id, chunks: Number(info.chunks) });
          }
          o.observed = observed;
        }
        const r = ok(await store.commit(o));
        H.sendJson(res, 200, { ok: true, node: nodeOut(r.node) });
        return;
      }
      case 'update': {
        await reqLimit();
        const move = body.parentId !== undefined;
        if (!intIn(body.baseVersion, 1, Number.MAX_SAFE_INTEGER) || (!move && body.meta == null)) throw bad();
        const r = ok(await store.update({ user: u, node: needUuid(body.nodeId, 'ID'), baseVersion: body.baseVersion, move,
          parent: move ? uuidOrNull(body.parentId, 'Ordner-ID') : null, meta: body.meta == null ? null : needMeta(body.meta) }));
        H.sendJson(res, 200, { ok: true, node: nodeOut(r.node) });
        return;
      }
      case 'trash': case 'restore': case 'delete': {
        await reqLimit();
        const node = needUuid(body.nodeId, 'ID');
        if (a === 'trash' && body.baseVersion != null && !intIn(body.baseVersion, 1, Number.MAX_SAFE_INTEGER)) throw bad();
        const r = ok(a === 'trash' ? await store.trash({ user: u, node, baseVersion: body.baseVersion })
          : a === 'restore' ? await store.restore({ user: u, node }) : await store.remove({ user: u, node }));
        H.sendJson(res, 200, { ok: true, count: Number(r.count || 0), node: r.node ? nodeOut(r.node) : undefined });
        return;
      }
      case 'trash.empty': {
        await reqLimit();
        if (body.confirm !== true) throw bad('Bitte bestätige das Leeren des Papierkorbs.');
        const r = ok(await store.trashEmpty({ user: u }));
        H.sendJson(res, 200, { ok: true, count: Number(r.count || 0) });
        return;
      }
      case 'versions': {
        await reqLimit();
        const r = ok(await store.versions({ user: u, node: needUuid(body.nodeId, 'ID') }));
        H.sendJson(res, 200, { ok: true, node: nodeOut(r.node), versions: (r.versions || []).map(revOut) });
        return;
      }
      case 'version.restore': {
        await reqLimit();
        if (!intIn(body.baseVersion, 1, Number.MAX_SAFE_INTEGER)) throw bad();
        const r = ok(await store.versionRestore({ user: u, node: needUuid(body.nodeId, 'ID'), rev: needUuid(body.revId, 'Versions-ID'), baseVersion: body.baseVersion }));
        H.sendJson(res, 200, { ok: true, node: nodeOut(r.node) });
        return;
      }
      case 'version.delete': {
        await reqLimit();
        const r = ok(await store.versionDelete({ user: u, node: needUuid(body.nodeId, 'ID'), rev: needUuid(body.revId, 'Versions-ID') }));
        H.sendJson(res, 200, { ok: true, deleted: !!r.deleted });
        return;
      }
      case 'thumbs': {
        await reqLimit();
        const ids = uuidList(body.ids, 100);
        const r = ok(await store.thumbs({ user: u, blobs: ids }));
        H.sendJson(res, 200, { ok: true, thumbs: r.thumbs || {} });
        return;
      }
      case 'album.put': {
        await reqLimit();
        if (!intIn(body.baseVersion, 0, Number.MAX_SAFE_INTEGER)) throw bad();
        const r = ok(await store.albumPut({ user: u, album: needUuid(body.albumId, 'Album-ID'), baseVersion: body.baseVersion,
          key: body.baseVersion === 0 ? needKey(body.key) : (body.key == null ? null : needKey(body.key)), meta: needMeta(body.meta) }));
        H.sendJson(res, 200, { ok: true, album: albumOut(r.album) });
        return;
      }
      case 'album.delete': {
        await reqLimit();
        ok(await store.albumDelete({ user: u, album: needUuid(body.albumId, 'Album-ID') }));
        H.sendJson(res, 200, { ok: true });
        return;
      }
      case 'album.items': {
        await reqLimit();
        const add = uuidList(body.add, 500), remove = uuidList(body.remove, 500);
        if (add.length + remove.length > 500) throw bad();
        const r = ok(await store.albumItems({ user: u, album: needUuid(body.albumId, 'Album-ID'), add, remove }));
        H.sendJson(res, 200, { ok: true, added: Number(r.added), removed: Number(r.removed) });
        return;
      }
      case 'backup.report': {
        await reqLimit();
        if (typeof body.deviceId !== 'string' || !DEVICE_RE.test(body.deviceId) || !BACKUP_STATUS.includes(body.status)) throw bad();
        const pending = body.pending == null ? 0 : body.pending, pendingBytes = body.pendingBytes == null ? 0 : body.pendingBytes;
        if (!intIn(pending, 0, 1e8) || !intIn(pendingBytes, 0, 1e15)) throw bad();
        if (body.error != null && !(typeof body.error === 'string' && /^[a-z0-9_]{1,40}$/.test(body.error))) throw bad();
        if (body.meta != null) needMeta(body.meta, 4096);
        const r = ok(await store.backupReport({ user: u, device: body.deviceId, meta: body.meta || null, status: body.status, pending, pendingBytes,
          success: body.success === true, error: body.error || null }));
        H.sendJson(res, 200, { ok: true, device: { deviceId: r.device.device_id, status: r.device.status, lastSuccessAt: r.device.last_success_at } });
        return;
      }
      case 'backup.list': {
        await reqLimit();
        const r = ok(await store.backupList({ user: u }));
        H.sendJson(res, 200, { ok: true, warnDays: Number(r.warn_days), now: r.now, devices: (r.devices || []).map(d => ({
          deviceId: d.device_id, meta: d.meta || null, status: d.status, pending: Number(d.pending), pendingBytes: Number(d.pending_bytes), error: d.error || null,
          lastSuccessAt: d.last_success_at, lastAttemptAt: d.last_attempt_at, createdAt: d.created_at, updatedAt: d.updated_at, stale: !!d.stale })) });
        return;
      }
      case 'backup.forget': {
        await reqLimit();
        if (typeof body.deviceId !== 'string' || !DEVICE_RE.test(body.deviceId)) throw bad();
        const r = ok(await store.backupForget({ user: u, device: body.deviceId }));
        H.sendJson(res, 200, { ok: true, deleted: !!r.deleted });
        return;
      }
      case 'dedupe': {
        await reqLimit();
        const hashes = body.hashes;
        if (!Array.isArray(hashes) || hashes.length > 200 || !hashes.every(h => typeof h === 'string' && HASH_RE.test(h))) throw bad();
        const r = ok(await store.dedupe({ user: u, hashes: [...new Set(hashes)] }));
        H.sendJson(res, 200, { ok: true, matches: r.matches || {} });
        return;
      }
      case 'export': {
        await reqLimit();
        const lim = body.limit == null ? 200 : body.limit;
        if (!intIn(lim, 1, 500)) throw bad();
        const r = ok(await store.exportPage({ user: u, after: uuidOrNull(body.after, 'Position'), limit: lim }));
        H.sendJson(res, 200, { ok: true, version: 1, nodes: (r.nodes || []).map(nodeOut), albums: r.albums ? r.albums.map(albumOut) : null, next: r.next || null });
        return;
      }
      default:
        throw new H.HttpError(400, 'unknown_action', 'Unbekannte Aktion');
    }
  }), { getConfig: () => deps.getConfig() });

  return { drive, deps };
}

module.exports = { makeDriveCore, driveConfig, runGc, readRaw, nodeOut, revOut };
