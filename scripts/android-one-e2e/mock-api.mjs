// FaLe One – mock API for the emulator smoke test (CI has no real FaLe account). Started by smoke.mjs on the
// runner; the debug APK reaches it as http://10.0.2.2:<port> through its debug-only API override.
//
// Implements what the background backup uses, with the contract's validation (docs/FALE-ONE-API.md §4):
//   /api/drive?a=  config, quota, dedupe, mkdir, upload.create, upload.put, upload.status, upload.abort, commit, backup.report
//   /auth/v1/token?grant_type=refresh_token   Supabase refresh with ROTATION and REUSE DETECTION: presenting an
//                                             already rotated refresh token ends the whole session (like Supabase)
//   /rest/v1/rpc/fale_device_touch            FaLe-Konto device heartbeat ({revoked})
// Everything the server receives is ciphertext; the test decrypts it with the web worker's JS code afterwards.
import { createServer } from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';

const b64u = b => Buffer.from(b).toString('base64url');
export const SUPABASE_KEY = 'mock-publishable-key-e2e';

export function startMock({ port = 8787, chunkSize = 65536, accessTtl = 3600 } = {}) {
  const st = {
    user: null,                 // { id, email }
    refresh: null,              // the one valid refresh token of the session
    rotated: new Set(),         // refresh tokens already used (reuse → session ends)
    access: new Map(),          // access token → expiry (ms)
    presented: [],              // refresh tokens presented to /token (to prove who refreshed with what)
    refreshes: 0, reuse: 0, revokedDevice: false,
    uploads: new Map(), nodes: new Map(), reports: [], requests: [], touches: 0, seq: 0,
  };
  const now = () => Date.now();
  const api = {
    st, chunkSize, url: null,
    /** New session for a user. accessExpired: the first access token is already expired (forces a refresh). */
    session(user, { accessExpired = false } = {}) {
      st.user = user;
      st.refresh = 'r-' + b64u(randomBytes(18));
      st.rotated.clear();
      st.access.clear();
      const access = 'a-' + b64u(randomBytes(24));
      st.access.set(access, accessExpired ? now() - 1000 : now() + accessTtl * 1000);
      return { refresh: st.refresh, access, exp: st.access.get(access) };
    },
    /** "Signed out everywhere": refresh token and access tokens stop working. */
    revokeSession() { st.refresh = null; st.access.clear(); },
    photoNodes() { return [...st.nodes.values()].filter(n => n.kind === 'photo'); },
    folders() { return [...st.nodes.values()].filter(n => n.kind === 'folder'); },
    chunksOf(blobId) { const u = st.uploads.get(blobId); return u ? Array.from({ length: u.chunks }, (_, i) => u.received.get(i)) : null; },
    close: () => new Promise(r => server.close(() => r())),
  };

  const send = (res, status, obj) => {
    const body = Buffer.from(JSON.stringify(obj));
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': body.length });
    res.end(body);
  };
  const fail = (res, status, error, extra = {}) => send(res, status, { ok: false, error, message: error, ...extra });
  const readBody = req => new Promise((resolve, reject) => {
    const parts = [];
    req.on('data', c => parts.push(c));
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
  const bearer = req => String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const authed = req => { const t = bearer(req); const exp = st.access.get(t); return !!exp && exp > now(); };
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const B64 = /^[A-Za-z0-9_-]+$/;
  const nodeOut = n => ({ t: 'node', ...n });

  async function drive(req, res, a, q) {
    if (a === 'config') return send(res, 200, { ok: true, configured: true, chunkSize, backend: 'pg', direct: false, maxThumbBatch: 100, maxChangesPage: 1000, version: 1, emergency: true, notify: false });
    if (!authed(req)) return fail(res, 401, 'invalid_account');
    if (a === 'upload.put') {
      const u = st.uploads.get(String(q.get('u'))), i = Number(q.get('i'));
      const buf = await readBody(req);
      if (!u || u.status !== 'pending') return fail(res, 404, 'no_upload');
      if (!Number.isInteger(i) || i < 0 || i >= u.chunks) return fail(res, 400, 'bad_index');
      const want = i < u.chunks - 1 ? u.chunkSize : u.size - (u.chunks - 1) * u.chunkSize;
      if (buf.length !== want) return fail(res, 400, 'bad_size', { want });
      if (req.headers['content-type'] !== 'application/octet-stream') return fail(res, 400, 'bad_input');
      u.received.set(i, new Uint8Array(buf));
      return send(res, 200, { ok: true });
    }
    let body;
    try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); } catch { return fail(res, 400, 'bad_json'); }
    switch (a) {
      case 'quota':
        return send(res, 200, { ok: true, quota: 2 ** 31, used: 0, readOnly: false, nodes: st.nodes.size, cursor: st.seq, minCursor: 0, chunkSize, backend: 'pg', direct: false,
          limits: { maxFileBytes: 512 * 1024 * 1024, thumbMaxBytes: 131072, previewMaxBytes: 8 * 1024 * 1024, maxMetaChars: 16384, maxPending: 256, uploadTtlHours: 24, backupWarnDays: 3 } });
      case 'dedupe': {
        const matches = {};
        for (const h of body.hashes || []) matches[h] = [...st.nodes.values()].filter(n => n.head && n.head.hash === h).map(n => n.id);
        return send(res, 200, { ok: true, matches });
      }
      case 'mkdir': {
        if (!UUID.test(body.nodeId || '') || !B64.test(body.key || '') || !B64.test(body.meta || '')) return fail(res, 400, 'bad_input');
        if (body.parentId != null && !st.nodes.has(body.parentId)) return fail(res, 409, 'bad_parent');
        const n = { id: body.nodeId, parent: body.parentId || null, kind: 'folder', version: 1, seq: ++st.seq, key: body.key, meta: body.meta, head: null, createdAt: new Date().toISOString() };
        st.nodes.set(n.id, n);
        return send(res, 200, { ok: true, node: nodeOut(n) });
      }
      case 'upload.create': {
        const purpose = body.purpose || 'content';
        const { size, chunks } = body;
        if (!['content', 'thumb', 'preview'].includes(purpose) || !Number.isSafeInteger(size) || size < 28 || chunks !== Math.ceil(size / chunkSize)) return fail(res, 400, 'bad_input');
        if (purpose === 'thumb' && (chunks !== 1 || size > 131072)) return fail(res, 413, 'too_large');
        const id = randomUUID();
        st.uploads.set(id, { id, purpose, size, chunks, chunkSize, hash: body.hash || null, received: new Map(), status: 'pending' });
        const duplicates = body.hash ? [...st.nodes.values()].filter(n => n.head && n.head.hash === body.hash).map(n => n.id) : [];
        return send(res, 200, { ok: true, uploadId: id, purpose, size, chunks, chunkSize, backend: 'pg', direct: false, expiresAt: new Date(now() + 864e5).toISOString(), duplicates });
      }
      case 'upload.status': {
        const u = st.uploads.get(body.uploadId);
        if (!u) return fail(res, 404, 'no_upload');
        return send(res, 200, { ok: true, uploadId: u.id, status: u.status === 'pending' ? 'pending' : 'live', purpose: u.purpose, backend: 'pg', size: u.size, chunks: u.chunks, chunkSize, expired: false, received: [...u.received.keys()] });
      }
      case 'upload.abort': {
        const u = st.uploads.get(body.uploadId);
        if (u && u.status === 'pending') u.status = 'aborted';
        return send(res, 200, { ok: true, deleted: !!u });
      }
      case 'commit': {
        const { nodeId, parentId, kind, baseVersion, key, meta, rev, content, thumb, preview, deviceId } = body;
        if (!UUID.test(nodeId || '') || !['file', 'photo'].includes(kind) || baseVersion !== 0 || !B64.test(key || '') || !B64.test(meta || '') || !rev || !UUID.test(rev.id || '') || !B64.test(rev.key || '') || !B64.test(rev.meta || '')) return fail(res, 400, 'bad_input');
        if (rev.hash != null && !/^[A-Za-z0-9_-]{43}$/.test(rev.hash)) return fail(res, 400, 'bad_input');
        if (deviceId != null && !/^[A-Za-z0-9_-]{16,64}$/.test(deviceId)) return fail(res, 400, 'bad_input');
        if (st.nodes.has(nodeId)) { const n = st.nodes.get(nodeId); return n.head && n.head.id === rev.id ? send(res, 200, { ok: true, node: nodeOut(n) }) : fail(res, 409, 'exists'); }
        if (parentId != null && !(st.nodes.has(parentId) && st.nodes.get(parentId).kind === 'folder')) return fail(res, 409, 'bad_parent');
        const blobs = [];
        for (const [purpose, id] of [['content', content], ['thumb', thumb], ['preview', preview]]) {
          if (id == null) { if (purpose === 'content') return fail(res, 400, 'bad_input'); continue; }
          const u = st.uploads.get(id);
          if (!u || u.status !== 'pending' || u.purpose !== purpose) return fail(res, 404, 'no_upload');
          if (u.received.size !== u.chunks) return fail(res, 409, 'incomplete');
          blobs.push(u);
        }
        for (const u of blobs) u.status = 'live';
        const n = { id: nodeId, parent: parentId || null, kind, version: 1, seq: ++st.seq, key, meta, createdAt: new Date().toISOString(), committedAt: now(),
          head: { id: rev.id, key: rev.key, meta: rev.meta, hash: rev.hash || null, deviceId: deviceId || null, size: blobs.reduce((s, u) => s + u.size, 0),
            blobs: blobs.map(u => ({ id: u.id, purpose: u.purpose, size: u.size, chunks: u.chunks, chunkSize: u.chunkSize, backend: 'pg' })) } };
        st.nodes.set(nodeId, n);
        return send(res, 200, { ok: true, node: nodeOut(n) });
      }
      case 'backup.report': {
        if (!/^[A-Za-z0-9_-]{16,64}$/.test(body.deviceId || '') || !['idle', 'running', 'paused', 'error'].includes(body.status)) return fail(res, 400, 'bad_input');
        st.reports.push({ ...body, at: now() });
        return send(res, 200, { ok: true, device: { deviceId: body.deviceId, status: body.status, lastSuccessAt: body.success ? new Date().toISOString() : null } });
      }
      default:
        return fail(res, 400, 'unknown_action');
    }
  }

  async function auth(req, res) {
    if (req.headers.apikey !== SUPABASE_KEY) return fail(res, 401, 'no_api_key');
    let body = {};
    try { body = JSON.parse((await readBody(req)).toString('utf8') || '{}'); } catch { return fail(res, 400, 'bad_json'); }
    const r = String(body.refresh_token || '');
    st.presented.push(r);
    if (st.rotated.has(r)) { // reuse of a rotated token: Supabase ends the session (token theft protection)
      st.reuse++;
      api.revokeSession();
      return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token: Already Used' });
    }
    if (!st.refresh || r !== st.refresh || !st.user) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token: Refresh Token Not Found' });
    st.rotated.add(r);
    st.refresh = 'r-' + b64u(randomBytes(18));
    const access = 'a-' + b64u(randomBytes(24));
    st.access.set(access, now() + accessTtl * 1000);
    st.refreshes++;
    return send(res, 200, { access_token: access, token_type: 'bearer', expires_in: accessTtl, expires_at: Math.floor(now() / 1000) + accessTtl, refresh_token: st.refresh, user: { id: st.user.id, email: st.user.email, aud: 'authenticated' } });
  }

  const server = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://mock');
    st.requests.push({ at: now(), method: req.method, path: u.pathname, a: u.searchParams.get('a') || '' });
    try {
      if (req.method !== 'POST') return fail(res, 405, 'method_not_allowed');
      if (u.pathname === '/api/drive') return await drive(req, res, u.searchParams.get('a') || '', u.searchParams);
      if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'refresh_token') return await auth(req, res);
      if (u.pathname === '/rest/v1/rpc/fale_device_touch') {
        await readBody(req);
        if (req.headers.apikey !== SUPABASE_KEY || !authed(req)) return fail(res, 401, 'invalid_account');
        st.touches++;
        return send(res, 200, { ok: true, revoked: st.revokedDevice });
      }
      return fail(res, 404, 'not_found');
    } catch (e) {
      return fail(res, 500, 'internal', { detail: String(e && e.message) });
    }
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '0.0.0.0', () => { api.url = `http://127.0.0.1:${port}`; resolve(api); });
  });
}
