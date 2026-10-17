// API tests for FaLe One (/api/drive) against the REAL SQL migrations in the local PostgreSQL (mock PostgREST +
// mock Supabase Auth from acct/account_harness.mjs), plus the reference client js/one/api.js + crypto.js.
//   node test_one_api.mjs        (harness on 8914/8915, database fale_one_api)
process.env.PGDB = process.env.PGDB || 'fale_one_api';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const { startHarness } = await import('../acct/account_harness.mjs');
const K = await import('/home/claude/FalePDF/js/one/crypto.js');
const { createClient, OneError } = await import('/home/claude/FalePDF/js/one/api.js');

const PORT = 8914;
const { SB } = await startHarness(PORT);
const APP = `http://127.0.0.1:${PORT}`;
const PKEY = 'sb_publishable_test_key_0123456789';
let pass = 0, fail = 0;
function check(name, cond, info = '') { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (info !== '' ? '  [' + JSON.stringify(info).slice(0, 600) + ']' : '')); } }
const T = (p, o) => fetch(APP + p, o).then(r => r.json());
const sql = async (q) => { const r = await T('/__test/sql', { method: 'POST', body: q }); if (r.error) throw new Error(r.error + ' :: ' + q.slice(0, 200)); return r.rows; };
const bytes = n => new Uint8Array(crypto.randomBytes(n));
const eq = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
const err = async p => { try { await p; return null; } catch (e) { return e; } };

async function sbPost(path, body, token) {
  const h = { apikey: PKEY, 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  const r = await fetch(SB + path, { method: 'POST', headers: h, body: JSON.stringify(body) });
  return r.json().catch(() => null);
}
async function signIn(email) {
  await sbPost('/auth/v1/otp', { email, create_user: true });
  const { code } = await T(`/__test/otp?email=${encodeURIComponent(email)}`);
  const s = await sbPost('/auth/v1/verify', { type: 'email', email, token: code });
  const keys = await K.deriveKeys(await K.importMasterRaw(new Uint8Array(crypto.randomBytes(32))), s.user.id);
  const one = createClient({ baseUrl: APP, getToken: async () => s.access_token, retries: 1, retryDelayMs: 10 });
  return { token: s.access_token, id: s.user.id, keys, one };
}
async function api(a, body, { token, query = '', raw, origin } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (origin) headers.Origin = origin;
  if (raw) headers['Content-Type'] = 'application/octet-stream'; else headers['Content-Type'] = 'application/json';
  const r = await fetch(`${APP}/api/drive?a=${a}${query}`, { method: 'POST', headers, body: raw || JSON.stringify(body || {}) });
  const buf = Buffer.from(await r.arrayBuffer());
  let j = null; try { j = JSON.parse(buf.toString('utf8')); } catch {}
  return { status: r.status, ...(j || {}), _buf: buf, _h: r.headers };
}
async function folder(U, name, parentId = null) {
  const nodeId = K.uuid();
  const nk = await K.createNodeKey(U.keys, nodeId);
  const meta = await K.sealMeta(nk.key, { userId: U.id, kind: 'folder', id: nodeId }, { v: 1, name });
  const r = await U.one.mkdir({ nodeId, parentId, key: nk.wrapped, meta });
  return { ...r.node, _nk: nk };
}
const usageOk = async (uid) => {
  const [r] = await sql(`select (select blob_bytes + meta_bytes from public.one_accounts where user_id = '${uid}') fast, (private.fale_one_usage('${uid}') ->> 'total') slow`);
  return r.fast === r.slow ? true : r;
};

// ================================================================== config / switch / CORS / auth
await T('/__test/reset?ONE_CHUNK_KB=64');
let r = await api('config');
check('config: configured, chunk size from env, postgres backend', r.ok && r.configured === true && r.chunkSize === 65536 && r.backend === 'pg' && r.direct === false, r);
await T('/__test/env?ONE_ENABLED=0');
r = await api('config');
check('config: ONE_ENABLED=0 → not configured', r.ok && r.configured === false, r);
r = await api('quota', {}, { token: 'x.y.z' });
check('switched off → 503 drive_not_configured', r.status === 503 && r.error === 'drive_not_configured', r);
await T('/__test/env?ONE_ENABLED=1&ACCOUNTS_ENABLED=0');
r = await api('quota', {}, { token: 'x.y.z' });
check('ACCOUNTS_ENABLED=0 → 503 drive_not_configured', r.status === 503 && r.error === 'drive_not_configured', r);
await T('/__test/env?ACCOUNTS_ENABLED=1');
for (const origin of ['https://fale-one.vercel.app', 'https://one.fale.network']) {
  const pre = await fetch(APP + '/api/drive?a=quota', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  check(`CORS: ${origin} allowed with Authorization`, pre.status === 204 && pre.headers.get('access-control-allow-origin') === origin && /Authorization/.test(pre.headers.get('access-control-allow-headers') || ''));
}
let pre = await fetch(APP + '/api/drive?a=quota', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
check('CORS: foreign origin not allowed', !pre.headers.get('access-control-allow-origin'));
await T('/__test/env?FALE_ONE_ORIGINS=https://one.example.org');
pre = await fetch(APP + '/api/drive?a=quota', { method: 'OPTIONS', headers: { Origin: 'https://one.example.org', 'Access-Control-Request-Method': 'POST' } });
const pre2 = await fetch(APP + '/api/drive?a=quota', { method: 'OPTIONS', headers: { Origin: 'https://fale-one.vercel.app', 'Access-Control-Request-Method': 'POST' } });
check('CORS: FALE_ONE_ORIGINS replaces the default list', pre.headers.get('access-control-allow-origin') === 'https://one.example.org' && !pre2.headers.get('access-control-allow-origin'));
await T('/__test/env?FALE_ONE_ORIGINS=');
r = await api('quota', {});
check('no token → 401 invalid_account', r.status === 401 && r.error === 'invalid_account', r);
const A = await signIn('anna@example.com');
r = await api('quota', {}, { token: A.token.slice(0, -4) + 'AAAA' });
check('forged token → 401', r.status === 401, r);
r = await api('nonsense', {}, { token: A.token });
check('unknown action → 400', r.status === 400 && r.error === 'unknown_action', r);
r = await fetch(`${APP}/api/drive?a=quota`, { method: 'GET', headers: { Authorization: `Bearer ${A.token}` } });
check('GET (except gc) → 405', r.status === 405);
r = await api('gc', {});
check('gc without CRON_SECRET → 403', r.status === 403, r);
check('security headers on API responses', (await fetch(APP + '/api/drive?a=config', { method: 'POST' })).headers.get('x-content-type-options') === 'nosniff');

// ================================================================== quota (initial), folders
r = await A.one.quota();
check('quota: beta cap 2 GiB, nothing used, not read-only', r.quota === 2147483648 && r.used === 0 && r.readOnly === false && r.usage.total === 0 && r.cursor === 0, r);
const fotos = await folder(A, 'Fotos');
check('mkdir: folder at root', fotos.kind === 'folder' && fotos.parent === null && fotos.version === 1 && fotos.seq > 0, fotos);
const urlaub = await folder(A, 'Urlaub 2026', fotos.id);
check('mkdir: subfolder', urlaub.parent === fotos.id, urlaub);
r = await api('mkdir', { nodeId: urlaub.id, parentId: fotos.id, key: urlaub.key, meta: urlaub.meta }, { token: A.token });
check('mkdir: identical retry is idempotent', r.status === 200 && r.node.seq === urlaub.seq, r);
r = await api('mkdir', { nodeId: urlaub.id, parentId: null, key: urlaub.key, meta: urlaub.meta }, { token: A.token });
check('mkdir: same id, different request → 409 exists', r.status === 409 && r.error === 'exists', r);
r = await api('mkdir', { nodeId: K.uuid(), parentId: K.uuid(), key: urlaub.key, meta: urlaub.meta }, { token: A.token });
check('mkdir: unknown parent → 409 bad_parent', r.status === 409 && r.error === 'bad_parent', r);
r = await api('mkdir', { nodeId: K.uuid().toUpperCase(), key: urlaub.key, meta: urlaub.meta }, { token: A.token });
check('mkdir: uppercase uuid rejected (ids are part of the AAD)', r.status === 400 && r.error === 'bad_input', r);
r = await api('mkdir', { nodeId: K.uuid(), key: 'short', meta: urlaub.meta }, { token: A.token });
check('mkdir: invalid key rejected', r.status === 400, r);
r = await api('mkdir', { nodeId: K.uuid(), key: urlaub.key, meta: 'not base64url!!!!!!!!!!!!!!!!!' }, { token: A.token });
check('mkdir: non-base64url meta rejected', r.status === 400, r);
const fileNode = await (async () => {
  const opened = await A.one.openNode(A.keys, urlaub);
  return opened;
})();
check('folder meta decrypts to the name', fileNode.meta.name === 'Urlaub 2026' && fileNode.rev === null, fileNode.meta);

// ================================================================== upload / download via the client
const content1 = bytes(300000); // 5 chunks à 64 KiB
let up = await A.one.uploadFile({ keys: A.keys, file: content1, name: 'Strand.jpg', mime: 'image/jpeg', kind: 'photo', parentId: urlaub.id,
  meta: { takenAt: '2026-07-14T10:22:00+02:00', w: 4000, h: 3000, gps: { lat: 54.1, lon: 7.9 }, exif: { model: 'Pixel 9' } },
  thumb: bytes(5000), preview: bytes(70000), deviceId: 'device-aaaaaaaaaaaaaaaa' });
let photo = up.node;
check('upload: photo committed with content+thumb+preview blobs', photo.kind === 'photo' && photo.parent === urlaub.id && photo.head && photo.head.blobs.length === 3
  && photo.head.blobs.find(b => b.purpose === 'content').chunks === 5 && photo.head.hash && photo.head.hash.length === 43, photo);
let back = await A.one.downloadFile({ keys: A.keys, node: photo });
check('download: decrypted content equals the original (digest + size verified)', eq(back, content1));
const op = await A.one.openNode(A.keys, photo);
check('open: photo meta (name, GPS, EXIF) + revision meta (size, mime) decrypt', op.meta.name === 'Strand.jpg' && op.meta.gps.lat === 54.1 && op.rev.meta.size === 300000 && op.rev.meta.mime === 'image/jpeg', op);
const prevBack = await A.one.downloadFile({ keys: A.keys, node: photo, purpose: 'preview' });
check('download: preview blob (2 chunks)', prevBack.length === 70000);
const thumbs = await A.one.thumbnails(A.keys, [photo, fotos]);
check('thumbs: batch download + decrypt', thumbs.size === 1 && thumbs.get(photo.id).length === 5000);
const empty = await A.one.uploadFile({ keys: A.keys, file: new Uint8Array(0), name: 'leer.txt', mime: 'text/plain' });
check('upload: empty file (one 28-byte chunk)', empty.node.head.blobs[0].size === 28 && (await A.one.downloadFile({ keys: A.keys, node: empty.node })).length === 0, empty.node.head);
check('usage counters match a full recomputation', await usageOk(A.id) === true, await usageOk(A.id));

// ================================================================== plaintext never reaches the server
const log = (await T('/__test/log')).log;
const allBodies = log.map(l => l.body).join('\n');
check('no plaintext name / EXIF / GPS in any request to the database', !/Strand|Urlaub|Pixel 9|54\.1|image\/jpeg|leer\.txt/.test(allBodies));
const contentProbe = Buffer.from(content1.subarray(1000, 1032)).toString('base64');
check('no plaintext content bytes in any request to the database', !allBodies.includes(contentProbe.slice(0, 40)));
const rows = await sql(`select meta, key from public.one_nodes where user_id = '${A.id}'`);
check('DB rows hold only opaque base64url envelopes', rows.every(x => /^[A-Za-z0-9_-]+$/.test(x.meta) && !/Strand|Urlaub/.test(Buffer.from(x.meta, 'base64').toString('latin1'))));

// ================================================================== resumable upload: out of order, duplicates, status, commit checks
{
  const nodeId = K.uuid(), revId = K.uuid();
  const nk = await K.createNodeKey(A.keys, nodeId);
  const fk = await K.createFileKey(nk.key, { userId: A.id, nodeId, revId });
  const plain = bytes(250000);
  const lay = K.layout(plain.length, 65536);
  const s = await A.one.uploadCreate({ purpose: 'content', size: lay.cipherSize, chunks: lay.chunks });
  check('upload.create: session with server-generated id + expiry', /^[0-9a-f-]{36}$/.test(s.uploadId) && s.chunks === 4 && s.chunkSize === 65536 && s.expiresAt, s);
  const ctx = { userId: A.id, nodeId, revId, blobId: s.uploadId, purpose: 'content' };
  const bk = await K.blobKey(fk.key, s.uploadId, 'content');
  const sealed = [];
  for (let i = 0; i < lay.chunks; i++) sealed.push(await K.sealChunk(bk, ctx, i, lay.chunks, plain.subarray(i * lay.plainChunk, (i + 1) * lay.plainChunk)));
  await A.one.uploadPut(s.uploadId, 3, sealed[3]);
  await A.one.uploadPut(s.uploadId, 1, sealed[1]);
  await A.one.uploadPut(s.uploadId, 1, sealed[1]); // duplicate
  let st = await A.one.uploadStatus(s.uploadId);
  check('upload.status: received chunks (any order, duplicates harmless)', JSON.stringify(st.received) === '[1,3]' && st.status === 'pending', st);
  const nm = await K.sealMeta(nk.key, { userId: A.id, kind: 'file', id: nodeId }, { v: 1, name: 'Vertrag.pdf' });
  const rm = await K.sealRevMeta(fk.key, { userId: A.id, nodeId, revId }, { v: 1, size: plain.length, mime: 'application/pdf', mtime: 1, digest: K.hex(await K.contentDigest(plain)) });
  const commitBody = { nodeId, parentId: null, kind: 'file', baseVersion: 0, key: nk.wrapped, meta: nm, rev: { id: revId, key: fk.wrapped, meta: rm }, content: s.uploadId };
  r = await api('commit', commitBody, { token: A.token });
  check('commit before all chunks are there → 409 incomplete', r.status === 409 && r.error === 'incomplete', r);
  r = await api('upload.put', null, { token: A.token, query: `&u=${s.uploadId}&i=0`, raw: sealed[0].subarray(0, 1000) });
  check('chunk with wrong size → 400 bad_size', r.status === 400 && r.error === 'bad_size', r);
  r = await api('upload.put', null, { token: A.token, query: `&u=${s.uploadId}&i=4`, raw: sealed[0] });
  check('chunk index ≥ chunks → 400 bad_index', r.status === 400 && r.error === 'bad_index', r);
  r = await api('upload.put', null, { token: A.token, query: `&u=${s.uploadId}&i=0`, raw: Buffer.alloc(65537) });
  check('chunk larger than the chunk size → 413', r.status === 413, r);
  r = await api('upload.put', null, { token: A.token, query: `&u=${K.uuid()}&i=0`, raw: sealed[0] });
  check('chunk for an unknown upload → 404 no_upload', r.status === 404 && r.error === 'no_upload', r);
  // resume with the high-level client (same file key + rev): only chunks 0 and 2 are sent
  const before = (await T('/__test/log')).n;
  await A.one.uploadBlob({ keys: A.keys, fileKey: fk.key, nodeId, revId, data: plain, uploadId: s.uploadId });
  const puts = (await T('/__test/log?since=' + before)).log.filter(l => l.path.includes('fale_one_chunk_put')).length;
  check('resume: client uploads only the missing chunks', puts === 2, puts);
  r = await api('commit', commitBody, { token: A.token });
  check('commit after completion → node', r.status === 200 && r.node.version === 1 && r.node.head.id === revId, r);
  const resumed = r.node;
  r = await api('commit', commitBody, { token: A.token });
  check('commit retry is idempotent', r.status === 200 && r.node.seq === resumed.seq, r);
  back = await A.one.downloadFile({ keys: A.keys, node: resumed });
  check('resumed upload decrypts (re-encrypted chunks with fresh IVs mix fine)', eq(back, plain));
  r = await api('upload.put', null, { token: A.token, query: `&u=${s.uploadId}&i=0`, raw: sealed[0] });
  check('chunk after commit → 404 no_upload (blobs are immutable)', r.status === 404, r);
  // reusing the same upload for a second node
  const n2 = K.uuid(), nk2 = await K.createNodeKey(A.keys, n2);
  r = await api('commit', { ...commitBody, nodeId: n2, key: nk2.wrapped, rev: { ...commitBody.rev, id: K.uuid() } }, { token: A.token });
  check('an upload can be committed only once', r.status === 404 && r.error === 'no_upload', r);
  // tampering: swap two chunks in the database → decryption fails
  const blobId = resumed.head.blobs[0].id;
  await sql(`update public.one_chunks c set data = (select data from public.one_chunks where blob_id = '${blobId}' and idx = 1) where blob_id = '${blobId}' and idx = 0`);
  const e = await err(A.one.downloadFile({ keys: A.keys, node: resumed }));
  check('swapped chunks on the server → decryption error (AAD binds the index)', e && e.code === 'decrypt', e && e.message);
  r = await api('upload.abort', { uploadId: (await A.one.uploadCreate({ purpose: 'thumb', size: 100, chunks: 1 })).uploadId }, { token: A.token });
  check('upload.abort deletes an open session', r.status === 200 && r.deleted === true, r);
  r = await api('upload.create', { purpose: 'thumb', size: 200000, chunks: 4 }, { token: A.token });
  check('thumb larger than thumb_max_bytes → 413', r.status === 413 && r.error === 'too_large', r);
  r = await api('upload.create', { purpose: 'content', size: 1000, chunks: 2 }, { token: A.token });
  check('upload.create with inconsistent chunk count → 400', r.status === 400, r);
}

// ================================================================== versions, concurrency, move/rename
{
  const v2 = bytes(100000);
  const op1 = await A.one.openNode(A.keys, photo);
  up = await A.one.uploadFile({ keys: A.keys, file: v2, kind: 'photo', nodeId: photo.id, baseVersion: photo.version, nodeKey: op1.nodeKey, mime: 'image/jpeg' });
  check('new version: same node, version+1, name unchanged', up.node.id === photo.id && up.node.version === photo.version + 1 && up.node.meta === photo.meta, up.node);
  const photoV2 = up.node;
  const e = await err(A.one.uploadFile({ keys: A.keys, file: bytes(10), kind: 'photo', nodeId: photo.id, baseVersion: photo.version, nodeKey: op1.nodeKey }));
  check('stale baseVersion → 409 conflict with the current node', e && e.status === 409 && e.code === 'conflict' && e.extra.node.version === photoV2.version, e && e.extra);
  let vs = await A.one.versions(photo.id);
  check('versions: 2 (current first)', vs.versions.length === 2 && vs.versions[0].head === true && vs.versions[0].id === photoV2.head.id && vs.versions[1].id === photo.head.id, vs);
  const oldBack = await A.one.downloadFile({ keys: A.keys, node: photo, revision: vs.versions[1] });
  check('old version still downloadable', eq(oldBack, content1));
  r = await A.one.restoreVersion(photo.id, photo.head.id, photoV2.version);
  check('version.restore: old revision is current again', r.node.head.id === photo.head.id && r.node.version === photoV2.version + 1, r.node);
  back = await A.one.downloadFile({ keys: A.keys, node: r.node });
  check('restored version downloads the original content', eq(back, content1));
  r = await api('version.delete', { nodeId: photo.id, revId: photo.head.id }, { token: A.token });
  check('version.delete of the current version → 409 is_head', r.status === 409 && r.error === 'is_head', r);
  r = await api('version.delete', { nodeId: photo.id, revId: photoV2.head.id }, { token: A.token });
  check('version.delete of an old version', r.status === 200 && r.deleted === true, r);
  photo = (await A.one.versions(photo.id)).node;
  // keep at most version_keep old versions
  await sql(`update private.fale_one_config set value = 2 where key = 'version_keep'`);
  let cur = photo;
  for (let i = 0; i < 4; i++) cur = (await A.one.uploadFile({ keys: A.keys, file: bytes(1000 + i), kind: 'photo', nodeId: photo.id, baseVersion: cur.version, nodeKey: op1.nodeKey })).node;
  vs = await A.one.versions(photo.id);
  check('version_keep: at most 2 old versions + current', vs.versions.length === 3, vs.versions.length);
  await sql(`update private.fale_one_config set value = 10 where key = 'version_keep'`);
  photo = cur;
  check('usage counters still match after version churn', await usageOk(A.id) === true, await usageOk(A.id));
  // concurrency: two devices commit a new version on the same base version at the same time
  const mk = async () => {
    const revId = K.uuid(), fk = await K.createFileKey(op1.nodeKey, { userId: A.id, nodeId: photo.id, revId });
    const b = await A.one.uploadBlob({ keys: A.keys, fileKey: fk.key, nodeId: photo.id, revId, data: bytes(500) });
    const rm = await K.sealRevMeta(fk.key, { userId: A.id, nodeId: photo.id, revId }, { v: 1, size: 500 });
    return { nodeId: photo.id, kind: 'photo', baseVersion: photo.version, rev: { id: revId, key: fk.wrapped, meta: rm }, content: b.uploadId };
  };
  const [c1, c2] = await Promise.all([mk(), mk()]);
  const res = await Promise.all([api('commit', c1, { token: A.token }), api('commit', c2, { token: A.token })]);
  const okN = res.filter(x => x.status === 200).length, confN = res.filter(x => x.status === 409 && x.error === 'conflict').length;
  check('concurrent commits on one base version: exactly one wins, the other gets conflict', okN === 1 && confN === 1, res.map(x => [x.status, x.error]));
  photo = (await A.one.versions(photo.id)).node;
  // rename (metadata update) + move
  const renamed = await K.sealMeta(op1.nodeKey, { userId: A.id, kind: 'photo', id: photo.id }, { v: 1, name: 'Strand-umbenannt.jpg' });
  r = await A.one.update({ nodeId: photo.id, baseVersion: photo.version, meta: renamed });
  check('update: rename (meta) bumps version + seq', r.node.version === photo.version + 1 && r.node.seq > photo.seq && r.node.meta === renamed, r.node);
  r = await api('update', { nodeId: photo.id, baseVersion: photo.version, meta: renamed }, { token: A.token });
  check('update with stale version → 409 conflict (+ current node)', r.status === 409 && r.error === 'conflict' && r.node.version === photo.version + 1, r);
  photo = (await A.one.versions(photo.id)).node;
  r = await A.one.update({ nodeId: photo.id, baseVersion: photo.version, parentId: fotos.id });
  check('update: move to another folder', r.node.parent === fotos.id, r.node);
  photo = r.node;
  r = await api('update', { nodeId: fotos.id, baseVersion: fotos.version, parentId: urlaub.id }, { token: A.token });
  check('move a folder into its own child → 409 cycle', r.status === 409 && r.error === 'cycle', r);
  r = await api('update', { nodeId: fotos.id, baseVersion: fotos.version, parentId: fotos.id }, { token: A.token });
  check('move a folder into itself → 409 cycle', r.status === 409 && r.error === 'cycle', r);
  r = await api('update', { nodeId: photo.id, baseVersion: photo.version, parentId: photo.id }, { token: A.token });
  check('move into a file (not a folder) → 409 bad_parent', r.status === 409 && r.error === 'bad_parent', r);
  r = await A.one.update({ nodeId: photo.id, baseVersion: photo.version, parentId: null });
  check('update: move to root (parentId null)', r.node.parent === null, r.node);
  photo = r.node;
}

// ================================================================== change feed (2nd device)
{
  const seen = new Map();
  const apply = c => { const k = c.t === 'member' ? `m:${c.album}:${c.node}` : `${c.t}:${c.id}`; const prev = seen.get(k); if (prev && prev.seq > c.seq) throw new Error('order'); seen.set(k, c); };
  let cursor = await A.one.pull({ cursor: 0, onChange: apply, limit: 3 });
  const q = await A.one.quota(false);
  check('feed: full pull in pages of 3 ends at the server cursor', cursor === q.cursor && seen.size >= 5, [cursor, q.cursor, seen.size]);
  const live = [...seen.values()].filter(c => c.t === 'node' && !c.deleted);
  const ph = live.find(c => c.id === photo.id);
  check('feed: latest state of each node (photo at root, current version)', ph && ph.parent === null && ph.version === photo.version, ph);
  const f2 = await folder(A, 'Neu');
  const changes = []; cursor = await A.one.pull({ cursor, onChange: c => changes.push(c) });
  check('feed: incremental pull returns only the new change', changes.length === 1 && changes[0].id === f2.id && cursor === f2.seq, changes);
  const none = []; await A.one.pull({ cursor, onChange: c => none.push(c) });
  check('feed: nothing new → empty', none.length === 0);
  // seq strictly increases under concurrent writers
  const made = await Promise.all(Array.from({ length: 12 }, (_, i) => folder(A, 'p' + i)));
  const after = []; cursor = await A.one.pull({ cursor, onChange: c => after.push(c) });
  const seqs = after.map(c => c.seq);
  check('feed: 12 concurrent writes → 12 entries, strictly increasing seq, none missed', after.length === 12 && seqs.every((s, i) => i === 0 || s > seqs[i - 1]) && made.every(m => after.some(c => c.id === m.id)), seqs);
  r = await api('changes', { cursor: -1 }, { token: A.token });
  check('feed: negative cursor → 400', r.status === 400, r);
}

// ================================================================== trash / restore / delete forever
{
  const inner = await A.one.uploadFile({ keys: A.keys, file: bytes(2000), name: 'Notiz.txt', parentId: urlaub.id });
  const q0 = await A.one.quota();
  r = await A.one.trash(fotos.id);
  check('trash: folder + subtree (Fotos/Urlaub/Notiz)', r.count === 3 && r.node.trashedAt && r.node.trashRoot === fotos.id, r);
  const q1 = await A.one.quota();
  check('trash still counts against the quota (usage.trash)', q1.used === q0.used && q1.usage.trash > 0 && q1.usage.trash === q0.usage.files - q1.usage.files, [q0.usage, q1.usage]);
  r = await api('mkdir', { nodeId: K.uuid(), parentId: urlaub.id, key: fotos.key, meta: fotos.meta }, { token: A.token });
  check('mkdir inside a trashed folder → 409 bad_parent', r.status === 409 && r.error === 'bad_parent', r);
  const nNode = inner.node;
  r = await api('update', { nodeId: nNode.id, baseVersion: nNode.version + 1, meta: nNode.meta }, { token: A.token });
  check('update of a trashed node → 409 trashed', r.status === 409 && r.error === 'trashed', r);
  back = await A.one.downloadFile({ keys: A.keys, node: nNode });
  check('trashed files stay downloadable', back.length === 2000);
  r = await A.one.restore(urlaub.id);
  check('restore a node inside a trashed folder → moves it to the root', r.count === 2 && r.node.parent === null && !r.node.trashedAt, r);
  r = await A.one.restore(fotos.id);
  check('restore the rest', r.count === 1 && !r.node.trashedAt, r);
  r = await api('delete', { nodeId: urlaub.id }, { token: A.token });
  check('delete forever without trash first → 409 not_trashed', r.status === 409 && r.error === 'not_trashed', r);
  await A.one.trash(urlaub.id);
  const qa = await A.one.quota();
  r = await A.one.deleteForever(urlaub.id);
  const qb = await A.one.quota();
  check('delete forever: subtree becomes tombstones, quota is freed', r.count === 2 && qb.used < qa.used && qb.usage.trash === 0, [r, qa.usage, qb.usage]);
  const [cnt] = await sql(`select count(*) n from public.one_blobs where user_id = '${A.id}' and rev_id in (select rev_id from public.one_revisions where node_id = '${nNode.id}')`);
  check('delete forever removes revisions + blobs', cnt.n === '0', cnt);
  const tomb = []; await A.one.pull({ cursor: qa.cursor, onChange: c => tomb.push(c) });
  check('feed reports the tombstones (deleted, no key/meta)', tomb.filter(c => c.deleted && c.key === null && c.meta === null).length === 2, tomb);
  const t1 = await A.one.uploadFile({ keys: A.keys, file: bytes(10), name: 'x' });
  await A.one.trash(t1.node.id);
  r = await api('trash.empty', {}, { token: A.token });
  check('trash.empty needs confirm', r.status === 400, r);
  r = await A.one.emptyTrash();
  check('trash.empty deletes everything in the trash', r.count === 1, r);
  check('usage counters match after trash operations', await usageOk(A.id) === true, await usageOk(A.id));
}

// ================================================================== albums
{
  const albumId = K.uuid();
  const ak = await K.createAlbumKey(A.keys, albumId);
  const am = await K.sealMeta(ak.key, { userId: A.id, kind: 'album', id: albumId }, { v: 1, name: 'Sommer', cover: photo.id });
  r = await A.one.albumPut({ albumId, baseVersion: 0, key: ak.wrapped, meta: am });
  check('album.put: create', r.album.id === albumId && r.album.version === 1, r);
  const album = r.album;
  r = await A.one.albumItems(albumId, [photo.id, fotos.id, K.uuid()]);
  check('album.items: only existing non-folder nodes are added', r.added === 1, r);
  r = await A.one.albumItems(albumId, [photo.id]);
  check('album.items: adding twice is a no-op', r.added === 0, r);
  const am2 = await K.sealMeta(ak.key, { userId: A.id, kind: 'album', id: albumId }, { v: 1, name: 'Sommer 2026' });
  r = await api('album.put', { albumId, baseVersion: 5, meta: am2 }, { token: A.token });
  check('album.put with stale version → 409 conflict', r.status === 409 && r.error === 'conflict' && r.album.version === 1, r);
  r = await A.one.albumPut({ albumId, baseVersion: 1, meta: am2 });
  check('album.put: rename', r.album.version === 2, r);
  const ch = []; await A.one.pull({ cursor: album.seq - 1, onChange: c => ch.push(c) });
  check('feed: album + member entries', ch.some(c => c.t === 'album' && c.id === albumId) && ch.some(c => c.t === 'member' && c.album === albumId && c.node === photo.id && !c.removed), ch);
  const opened = await K.openMeta(await K.openAlbumKey(A.keys, albumId, ch.find(c => c.t === 'album').key), { userId: A.id, kind: 'album', id: albumId }, ch.find(c => c.t === 'album').meta);
  check('album name decrypts', opened.name === 'Sommer 2026', opened);
  r = await A.one.albumItems(albumId, [], [photo.id]);
  check('album.items: remove', r.removed === 1, r);
  const q = await A.one.quota(false);
  r = await A.one.albumDelete(albumId);
  const ch2 = []; await A.one.pull({ cursor: q.cursor, onChange: c => ch2.push(c) });
  check('album.delete → album tombstone in the feed; photo untouched', ch2.some(c => c.t === 'album' && c.deleted) && !ch2.some(c => c.t === 'node'), ch2);
  globalThis.__album = { albumId: K.uuid() };
}

// ================================================================== dedupe + backup status + export
{
  const src = (await A.one.uploadFile({ keys: A.keys, file: content1, name: 'Quelle.jpg', kind: 'photo' })).node;
  const digest = await K.contentDigest(content1);
  const h = await K.dedupeHash(A.keys, digest);
  check('the stored revision carries the keyed hash', src.head.hash === h, src.head.hash);
  r = await A.one.dedupe([h, 'A'.repeat(43)]);
  check('dedupe: keyed hash of a stored file is found', JSON.stringify(Object.keys(r.matches)) === JSON.stringify([h]) && r.matches[h][0] === src.id, r);
  r = await A.one.uploadFile({ keys: A.keys, file: content1, name: 'nochmal.jpg', kind: 'photo', skipDuplicates: true });
  check('uploadFile(skipDuplicates): nothing uploaded, existing node reported', r.node === null && r.duplicate[0] === src.id, r);
  const s = await A.one.uploadCreate({ purpose: 'content', size: 1000, chunks: 1, hash: h });
  check('upload.create with hash reports duplicates', s.duplicates.includes(src.id), s);
  await A.one.trash(src.id);
  r = await A.one.dedupe([h]);
  check('dedupe ignores files in the trash', Object.keys(r.matches).length === 0, r);
  await A.one.uploadAbort(s.uploadId);
  const B0 = await signIn('bob@example.com');
  const hb = await K.dedupeHash(B0.keys, digest);
  check('the keyed hash differs per account (server cannot correlate users or test guesses)', hb !== h);

  const dev = 'phone-aaaaaaaaaaaaaaaa';
  const dm = await K.sealDeviceMeta(A.keys, dev, { name: 'Annas Pixel', platform: 'android' });
  r = await A.one.backupReport({ deviceId: dev, meta: dm, status: 'idle', pending: 0, success: true });
  check('backup.report: success recorded', r.device.lastSuccessAt && r.device.status === 'idle', r);
  r = await A.one.backupReport({ deviceId: 'laptop-aaaaaaaaaaaaaaa', status: 'running', pending: 12, pendingBytes: 3000000 });
  let l = await A.one.backupList();
  const ph = l.devices.find(d => d.deviceId === dev), lap = l.devices.find(d => d.deviceId === 'laptop-aaaaaaaaaaaaaaa');
  check('backup.list: both devices, not stale yet', l.warnDays === 3 && ph && !ph.stale && lap && !lap.stale && lap.pending === 12, l);
  check('backup device name decrypts', (await K.openDeviceMeta(A.keys, dev, ph.meta)).name === 'Annas Pixel');
  await sql(`update public.one_backup_devices set last_success_at = now() - interval '4 days' where device_id = '${dev}'`);
  await sql(`update public.one_backup_devices set created_at = now() - interval '5 days' where device_id = 'laptop-aaaaaaaaaaaaaaa'`);
  l = await A.one.backupList();
  check('backup.list: stale after 3 days without success (also never-succeeded devices)', l.devices.every(d => d.stale), l.devices);
  r = await A.one.backupReport({ deviceId: dev, status: 'error', error: 'no_network' });
  l = await A.one.backupList();
  check('failed attempt does not reset the stale flag', l.devices.find(d => d.deviceId === dev).stale === true && l.devices.find(d => d.deviceId === dev).error === 'no_network', l);
  r = await api('backup.report', { deviceId: 'short', status: 'idle' }, { token: A.token });
  check('backup.report: invalid device id → 400', r.status === 400, r);
  r = await A.one.backupForget('laptop-aaaaaaaaaaaaaaa');
  check('backup.forget', r.deleted === true, r);

  let page = await A.one.exportPage(null, 2);
  const all = [...page.nodes];
  const albumsFirst = page.albums;
  while (page.next) { page = await A.one.exportPage(page.next, 2); all.push(...page.nodes); check('export: later pages carry no album list', page.albums === null); }
  const [nn] = await sql(`select count(*) n from public.one_nodes where user_id = '${A.id}' and not deleted`);
  check('export: every live node exactly once, with all revisions', all.length === Number(nn.n) && new Set(all.map(n => n.id)).size === all.length
    && all.find(n => n.id === photo.id).revisions.length >= 2, [all.length, nn.n]);
  check('export: album list on the first page', Array.isArray(albumsFirst), albumsFirst);
  globalThis.__B = B0;
}

// ================================================================== isolation between accounts (no enumeration)
{
  const B = globalThis.__B;
  r = await api('versions', { nodeId: photo.id }, { token: B.token });
  const rU = await api('versions', { nodeId: K.uuid() }, { token: B.token });
  check('foreign node looks exactly like an unknown one (404 not_found)', r.status === 404 && rU.status === 404 && r.error === rU.error && r.message === rU.message, [r.error, rU.error]);
  const blobId = photo.head.blobs.find(b => b.purpose === 'content').id;
  r = await api('get', null, { token: B.token, query: `&b=${blobId}&i=0` });
  check('foreign blob download → 404', r.status === 404, r.status);
  r = await api('thumbs', { ids: [photo.head.blobs.find(b => b.purpose === 'thumb')?.id || blobId] }, { token: B.token });
  check('foreign thumbnails are not returned', r.status === 200 && Object.keys(r.thumbs).length === 0, r);
  const s = await A.one.uploadCreate({ purpose: 'content', size: 100, chunks: 1 });
  r = await api('upload.put', null, { token: B.token, query: `&u=${s.uploadId}&i=0`, raw: Buffer.alloc(100) });
  check('chunk into a foreign upload → 404 no_upload', r.status === 404 && r.error === 'no_upload', r);
  const nk = await K.createNodeKey(B.keys, K.uuid());
  r = await api('commit', { nodeId: K.uuid(), kind: 'file', baseVersion: 0, key: nk.wrapped, meta: photo.meta, rev: { id: K.uuid(), key: nk.wrapped, meta: photo.meta }, content: s.uploadId }, { token: B.token });
  check('commit with a foreign upload → 404 no_upload', r.status === 404 && r.error === 'no_upload', r);
  r = await api('update', { nodeId: photo.id, baseVersion: photo.version, parentId: null }, { token: B.token });
  check('update of a foreign node → 404', r.status === 404, r);
  r = await api('trash', { nodeId: photo.id }, { token: B.token });
  check('trash of a foreign node → 404', r.status === 404, r);
  r = await api('mkdir', { nodeId: K.uuid(), parentId: fotos.id, key: nk.wrapped, meta: photo.meta }, { token: B.token });
  check('mkdir inside a foreign folder → 409 bad_parent', r.status === 409 && r.error === 'bad_parent', r);
  const bc = await B.one.changes(0);
  check('B\'s feed is empty', bc.changes.length === 0 && bc.cursor === 0, bc);
  r = await api('changes', { cursor: 0 }, { token: B.token });
  check('B cannot read A\'s data by cursor', r.changes.length === 0, r);
  await A.one.uploadAbort(s.uploadId);
}

// ================================================================== quota: read-only, never delete
{
  const q = await A.one.quota();
  await sql(`update public.one_accounts set quota_bytes = ${q.used + 1000} where user_id = '${A.id}'`);
  r = await api('upload.create', { purpose: 'content', size: 5000, chunks: 1 }, { token: A.token });
  check('over quota: upload.create → 507 quota_exceeded with used/quota', r.status === 507 && r.error === 'quota_exceeded' && r.quota === q.used + 1000 && r.used === q.used, r);
  await A.one.uploadCreate({ purpose: 'content', size: 900, chunks: 1 }).then(s => A.one.uploadAbort(s.uploadId));
  check('below the remaining space uploads still work', true);
  await sql(`update public.one_accounts set quota_bytes = ${Math.floor(q.used / 2)} where user_id = '${A.id}'`);
  const q2 = await A.one.quota();
  check('quota below usage → readOnly, nothing deleted', q2.readOnly === true && q2.used === q.used, q2);
  r = await api('mkdir', { nodeId: K.uuid(), key: fotos.key, meta: fotos.meta }, { token: A.token });
  check('read-only: mkdir → 507', r.status === 507, r);
  back = await A.one.downloadFile({ keys: A.keys, node: photo });
  check('read-only: downloads keep working', back.length > 0);
  const ren = await A.one.update({ nodeId: photo.id, baseVersion: photo.version, parentId: fotos.id });
  check('read-only: moving (no growth) keeps working', ren.node.parent === fotos.id);
  photo = ren.node;
  r = await A.one.trash(photo.id); await A.one.restore(photo.id);
  check('read-only: trash/restore keep working', r.count === 1);
  photo = (await A.one.versions(photo.id)).node;
  await sql(`update public.one_accounts set quota_bytes = null where user_id = '${A.id}'`);
  check('override removed → default quota again', (await A.one.quota(false)).quota === 2147483648);
  await sql(`update private.fale_one_config set value = 1 where key = 'pg_total_cap_bytes'`);
  r = await api('upload.create', { purpose: 'content', size: 5000, chunks: 1 }, { token: A.token });
  check('global Postgres capacity reached → 503 capacity', r.status === 503 && r.error === 'capacity', r);
  await sql(`update private.fale_one_config set value = 5368709120 where key = 'pg_total_cap_bytes'`);
  const [tot] = await sql(`select (select bytes from private.fale_one_totals where backend = 'pg') = (select coalesce(sum(size), 0) from public.one_blobs where backend = 'pg') ok`);
  check('global byte counter matches the blobs', tot.ok === 't', tot);
}

// ================================================================== retention (pg_cron purge) + cursor reset
{
  const qx = await A.one.quota(false);
  const old = await A.one.uploadFile({ keys: A.keys, file: bytes(3000), name: 'alt.txt' });
  await A.one.trash(old.node.id);
  const pend = await A.one.uploadCreate({ purpose: 'content', size: 100, chunks: 1 });
  await sql(`update public.one_nodes set trashed_at = now() - interval '31 days' where node_id = '${old.node.id}'`);
  await sql(`update public.one_blobs set expires_at = now() - interval '1 minute' where blob_id = '${pend.uploadId}'`);
  r = await api('upload.put', null, { token: A.token, query: `&u=${pend.uploadId}&i=0`, raw: Buffer.alloc(100) });
  check('expired upload session → 404 no_upload', r.status === 404 && r.error === 'no_upload', r);
  const vsBefore = (await A.one.versions(photo.id)).versions.length;
  await sql(`update public.one_revisions set superseded_at = now() - interval '31 days' where node_id = '${photo.id}' and superseded_at is not null`);
  let [p] = await sql(`select private.fale_one_purge()::text r`);
  p = JSON.parse(p.r);
  check('purge: 30-day trash, old versions, abandoned uploads', p.trash === 1 && p.versions === vsBefore - 1 && p.uploads >= 1, p);
  check('purge: only the current version is left', (await A.one.versions(photo.id)).versions.length === 1);
  const ch = []; const cAfter = await A.one.pull({ cursor: qx.cursor, onChange: c => ch.push(c) });
  check('purged trash appears as tombstone in the feed', ch.some(c => c.id === old.node.id && c.deleted), ch.map(c => [c.id, c.deleted]));
  await sql(`update public.one_nodes set deleted_at = now() - interval '31 days' where user_id = '${A.id}' and deleted`);
  await sql(`update public.one_albums set deleted_at = now() - interval '31 days' where user_id = '${A.id}' and deleted`);
  await sql(`update public.one_album_items set removed_at = now() - interval '31 days' where user_id = '${A.id}' and removed`);
  [p] = await sql(`select private.fale_one_purge()::text r`);
  p = JSON.parse(p.r);
  const q = await A.one.quota(false);
  check('purge: tombstones deleted, min_cursor moved', p.tombstones >= 4 && q.minCursor >= old.node.seq, [p, q.minCursor]);
  r = await A.one.changes(1);
  check('feed: cursor older than min_cursor → reset', r.reset === true && r.changes.length === 0, r);
  let resets = 0; const state = new Map();
  const cur = await A.one.pull({ cursor: 1, onReset: () => { resets++; state.clear(); }, onChange: c => { if (c.t === 'node') { if (c.deleted) state.delete(c.id); else state.set(c.id, c); } } });
  const [live] = await sql(`select count(*) n from public.one_nodes where user_id = '${A.id}' and not deleted`);
  check('client handles reset by resyncing from 0 → complete state', resets === 1 && state.size === Number(live.n) && cur === q.cursor, [resets, state.size, live.n]);
  r = await A.one.changes(cAfter);
  check('a cursor ≥ min_cursor keeps working', r.reset === false, r);
  check('usage counters match after purge', await usageOk(A.id) === true, await usageOk(A.id));
}

// ================================================================== rate limits
{
  const C = await signIn('carl@example.com');
  await T('/__test/env?ONE_DAILY_REQUESTS=4');
  const st = [];
  for (let i = 0; i < 6; i++) st.push((await api('quota', {}, { token: C.token })).status);
  check('per-account daily request limit → 429 drive_limit', JSON.stringify(st) === '[200,200,200,200,429,429]', st);
  await T('/__test/env?ONE_DAILY_REQUESTS=&ONE_UPLOAD_DAILY_MB=1&ONE_IP_UPLOAD_DAILY_MB=100000');
  r = await api('upload.create', { purpose: 'content', size: 900000, chunks: 14 }, { token: C.token });
  const r2 = await api('upload.create', { purpose: 'content', size: 900000, chunks: 14 }, { token: C.token });
  check('daily upload byte limit (per account)', r.status === 200 && r2.status === 429 && r2.error === 'drive_limit', [r.status, r2.status]);
  await T('/__test/env?ONE_UPLOAD_DAILY_MB=&ONE_IP_UPLOAD_DAILY_MB=&ONE_IP_DAILY_REQUESTS=3');
  const E = await signIn('emil@example.com');
  const st2 = [];
  for (let i = 0; i < 2; i++) st2.push((await api('backup.list', {}, { token: E.token })).status);
  check('per-IP daily request limit applies across accounts', st2.includes(429), st2);
  await T('/__test/env?ONE_IP_DAILY_REQUESTS=');
}

// ================================================================== direct table access (RLS / grants)
{
  const tables = ['one_accounts', 'one_nodes', 'one_revisions', 'one_blobs', 'one_chunks', 'one_albums', 'one_album_items', 'one_backup_devices'];
  const claims = JSON.stringify({ sub: A.id, role: 'authenticated', aud: 'authenticated' });
  let denied = 0;
  for (const t of tables) for (const role of ['anon', 'authenticated']) {
    try { await sql(`begin; set local role ${role}; select set_config('request.jwt.claims', '${claims}', true); select * from public.${t} limit 1; commit;`); }
    catch (e) { if (/permission denied/.test(e.message)) denied++; try { await sql('rollback'); } catch {} }
  }
  check('direct SELECT on every one_* table denied for anon + authenticated', denied === tables.length * 2, denied);
  let wDenied = 0;
  for (const role of ['anon', 'authenticated']) {
    try { await sql(`begin; set local role ${role}; update public.one_accounts set quota_bytes = 1e15; commit;`); } catch (e) { if (/permission denied/.test(e.message)) wDenied++; try { await sql('rollback'); } catch {} }
  }
  check('direct UPDATE denied (no self-service quota)', wDenied === 2);
  const [rls] = await sql(`select count(*) filter (where relrowsecurity) n, count(*) t from pg_class where relname = any (array[${tables.map(t => `'${t}'`).join(',')}]) and relnamespace = 'public'::regnamespace`);
  check('RLS enabled on all one_* tables', rls.n === rls.t && rls.t === String(tables.length), rls);
  let fnDenied = 0;
  try { await sql(`begin; set local role authenticated; select public.fale_one_status('x', '${A.id}', true); commit;`); } catch (e) { if (/permission denied/.test(e.message)) fnDenied++; try { await sql('rollback'); } catch {} }
  try { await sql(`begin; set local role anon; select public.fale_one_status('wrong-secret-0123456789abcdefghijkl', '${A.id}', true); commit;`); } catch (e) { if (/forbidden/.test(e.message)) fnDenied++; try { await sql('rollback'); } catch {} }
  check('RPCs: not executable by authenticated; anon needs the server secret', fnDenied === 2, fnDenied);
  const [pub] = await sql(`select count(*) n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'fale_one_%'
    and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))`);
  check('no fale_one_* function executable by authenticated/PUBLIC', pub.n === '0', pub);
  const [defs] = await sql(`select count(*) n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'private') and p.proname like 'fale_one_%'
    and p.prosecdef and not exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""')`);
  check('every SECURITY DEFINER fale_one_* function pins search_path = \'\'', defs.n === '0', defs);
}

// ================================================================== migrations are idempotent
{
  const before = await sql(`select count(*) n from public.one_nodes`);
  let okRe = true;
  for (const f of ['20261015220000_fale_one_drive.sql', '20261015220100_fale_one_drive_cron.sql']) {
    try { execFileSync('psql', ['-h', '/tmp/faleacct', '-p', '5544', '-U', 'postgres', '-d', process.env.PGDB, '-v', 'ON_ERROR_STOP=1', '-q', '--single-transaction', '-f', '/home/claude/FalePDF/supabase/migrations/' + f], { stdio: 'pipe', env: { ...process.env, PGOPTIONS: '-cclient_min_messages=warning' } }); }
    catch (e) { okRe = false; console.log(String(e.stderr)); }
  }
  const after = await sql(`select count(*) n from public.one_nodes`);
  check('migrations re-apply cleanly without touching data', okRe && before[0].n === after[0].n, [before, after]);
  back = await A.one.downloadFile({ keys: A.keys, node: photo });
  check('data still readable after re-applying', back.length > 0);
}

// ================================================================== account deletion cascade
{
  const D = await signIn('dora@example.com');
  const f = await folder(D, 'Docs');
  await D.one.uploadFile({ keys: D.keys, file: bytes(70000), name: 'a.bin', parentId: f.id, thumb: bytes(100) });
  const albumId = K.uuid(), ak = await K.createAlbumKey(D.keys, albumId);
  await D.one.albumPut({ albumId, baseVersion: 0, key: ak.wrapped, meta: f.meta });
  await D.one.backupReport({ deviceId: 'dora-device-aaaaaaaa', status: 'idle', success: true });
  await D.one.uploadCreate({ purpose: 'content', size: 100, chunks: 1 });
  const cnt = async () => (await sql(`select (select count(*) from public.one_nodes where user_id = '${D.id}') + (select count(*) from public.one_blobs where user_id = '${D.id}')
    + (select count(*) from public.one_chunks where user_id = '${D.id}') + (select count(*) from public.one_albums where user_id = '${D.id}')
    + (select count(*) from public.one_backup_devices where user_id = '${D.id}') + (select count(*) from public.one_accounts where user_id = '${D.id}') n`))[0].n;
  const n0 = await cnt();
  const [tb] = await sql(`select bytes from private.fale_one_totals where backend = 'pg'`);
  r = await fetch(`${APP}/api/account?a=delete`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${D.token}` }, body: JSON.stringify({ confirm: 'LÖSCHEN' }) }).then(x => x.json());
  const n1 = await cnt();
  const [ta] = await sql(`select bytes from private.fale_one_totals where backend = 'pg'`);
  check('account deletion removes all FaLe One rows (nodes, blobs, chunks, albums, devices, account)', r.ok && Number(n0) >= 8 && n1 === '0', [r, n0, n1]);
  check('account deletion releases the global byte counter', Number(ta.bytes) < Number(tb.bytes), [tb, ta]);
  r = await api('mkdir', { nodeId: K.uuid(), key: f.key, meta: f.meta }, { token: D.token });
  check('deleted account cannot write any more (no_user → 401) even with a still-unexpired token', r.status === 401 && r.error === 'no_user', r);
  r = await api('changes', { cursor: 0 }, { token: D.token });
  check('…and sees nothing', r.changes.length === 0, r);
  check('A\'s data untouched by D\'s deletion', (await A.one.downloadFile({ keys: A.keys, node: photo })).length > 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
