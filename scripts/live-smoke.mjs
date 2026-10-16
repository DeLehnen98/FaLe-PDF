// Live smoke test against the deployed API (default: production). Includes the FaLe One drive config + auth gate. Runs the same round trips as the
// real client – end-to-end encrypted with js/share/crypto.js – and reports one GitHub annotation per step.
//   BASE=https://fale-pdf.vercel.app node scripts/live-smoke.mjs
// Never prints device tokens, capability tokens, download tickets or link keys.
// Node 20+, no dependencies. Exit code 1 if any step fails.
import { randomBytes as nodeRandom, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const C = await import(join(ROOT, 'js/share/crypto.js'));

const BASE = (process.env.BASE || 'https://fale-pdf.vercel.app').replace(/\/+$/, '');
const ORIGIN = process.env.SMOKE_ORIGIN || 'https://fale-pdf.vercel.app';
const TIMEOUT_MS = 45000;
const te = new TextEncoder();

// ---------------------------------------------------------------- output helpers (redacting)
const secrets = new Set();
const keep = (...xs) => { for (const x of xs) if (typeof x === 'string' && x.length >= 8) secrets.add(x); return xs[0]; };
function redact(s) {
  let out = String(s);
  for (const x of secrets) out = out.split(x).join('…');
  return out
    .replace(/("(?:token|auth|ticket|rewardToken|s|k|key)"\s*:\s*")[^"]*(")/g, '$1…$2')
    .replace(/("signers"\s*:\s*\[)[^\]]*(\])/g, '$1…$2')
    .replace(/t1\.[A-Za-z0-9_-]+\.\d+\.[A-Za-z0-9_-]+/g, 't1.…')
    .replace(/#k=[A-Za-z0-9_-]+/g, '#k=…');
}
const esc = s => redact(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escTitle = s => esc(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
const notice = (title, msg) => console.log(`::notice title=${escTitle(title)}::${esc(msg)}`);
const error = (title, msg) => console.log(`::error title=${escTitle(title)}::${esc(msg)}`);

class StepError extends Error {
  constructor(msg, detail) { super(msg); this.detail = detail; }
}
const must = (cond, msg, detail) => { if (!cond) throw new StepError(msg, detail); };
const sameBytes = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
const kb = n => `${(n / 1024).toFixed(1)} KB`;

// ---------------------------------------------------------------- HTTP (like js/share/api.js)
async function http(path, { json = undefined, raw = undefined, auth = null, binary = false } = {}) {
  const headers = { Origin: ORIGIN };
  if (auth) headers['X-Fale-Auth'] = auth;
  let body;
  if (raw !== undefined) { headers['Content-Type'] = 'application/octet-stream'; body = raw; }
  else { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json || {}); }
  const t0 = Date.now();
  let r;
  try {
    r = await fetch(BASE + path, { method: 'POST', headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new StepError(`${path.split('&')[0]}: network error (${e && (e.name || e.message)})`);
  }
  const ms = Date.now() - t0;
  if (binary && r.ok) return { status: r.status, bytes: new Uint8Array(await r.arrayBuffer()), ms, headers: r.headers };
  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch {}
  return { status: r.status, json: j, text, ms, headers: r.headers };
}
/** POST /api/<ep>?a=<action> expecting 200 + ok:true. */
async function api(ep, action, opts = {}, query = '') {
  const path = `/api/${ep}?a=${action}${query ? '&' + query : ''}`;
  const r = await http(path, opts);
  if (r.status !== 200 || (!opts.binary && !(r.json && r.json.ok))) {
    throw new StepError(`${ep}/${action} → HTTP ${r.status}`, (r.text || '').slice(0, 600));
  }
  return opts.binary ? r.bytes : r.json;
}
/** Same, but expecting a specific non-200 status (e.g. 404 after delete). */
async function apiExpect(ep, action, status, opts = {}, query = '') {
  const r = await http(`/api/${ep}?a=${action}${query ? '&' + query : ''}`, opts);
  must(r.status === status, `${ep}/${action}: expected HTTP ${status}, got ${r.status}`, (r.text || '').slice(0, 600));
  return r;
}

// ---------------------------------------------------------------- encrypted upload/download (like uploadEncrypted/downloadDecrypted)
async function uploadEncrypted(plain, { ck, meta, chunkSize, announce, auth: putAuth }) {
  const sealed = await C.sealObject(ck, meta, { plainSize: plain.length, chunkSize });
  const created = await announce({ size: sealed.cipherSize, chunks: sealed.chunks, header: sealed.header });
  keep(created.auth);
  const auth = putAuth || created.auth;
  for (let i = 0; i < sealed.chunks; i++) {
    const ct = await sealed.encryptChunk(i, plain.subarray(i * sealed.plainChunk, Math.min(plain.length, (i + 1) * sealed.plainChunk)));
    await api('share', 'put', { raw: ct, auth }, `id=${created.id}&i=${i}`);
  }
  return { ...created, chunks: sealed.chunks, cipherSize: sealed.cipherSize, header: sealed.header };
}
async function downloadDecrypted(obj, ck) {
  keep(obj.ticket);
  const o = await C.openObject(ck, obj.header);
  const parts = [];
  let got = 0;
  for (let i = 0; i < obj.chunks; i++) {
    const ct = await api('share', 'get', { raw: new Uint8Array(0), auth: obj.ticket, binary: true }, `id=${obj.id}&i=${i}`);
    parts.push(await o.decryptChunk(i, ct, i === obj.chunks - 1));
    got += ct.length;
  }
  must(got === obj.size, `download size ${got} ≠ announced ${obj.size}`);
  return { bytes: Buffer.concat(parts.map(p => Buffer.from(p))), meta: o.meta };
}

// ---------------------------------------------------------------- steps
const results = [];
async function step(name, fn) {
  const t0 = Date.now();
  try {
    const msg = await fn();
    const ms = Date.now() - t0;
    results.push({ name, ok: true, ms });
    notice(`${name} PASS`, `${msg} (${ms} ms)`);
    return true;
  } catch (e) {
    const ms = Date.now() - t0;
    results.push({ name, ok: false, ms });
    const detail = e instanceof StepError ? (e.detail ? ` | server: ${e.detail}` : '') : ` | ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : e}`;
    error(`${name} FAIL`, `${e && e.message}${detail} (${ms} ms)`);
    return false;
  }
}

let token = null;
let cfg = null;
const cleanups = [];

await step('register', async () => {
  const deviceId = 'smoke-' + randomUUID().replace(/-/g, '');
  const x = await http('/api/ai/register', { json: { deviceId } });
  if (x.json && x.json.token) keep(x.json.token);
  must(x.status === 200 && x.json && typeof x.json.token === 'string' && x.json.token.length > 20, `ai/register → HTTP ${x.status}`, (x.text || '').slice(0, 400));
  token = x.json.token;
  return 'device token issued';
});

await step('share-config', async () => {
  cfg = await api('share', 'config');
  must(cfg.configured === true, 'share/config says configured:false', JSON.stringify(cfg));
  must(Number.isInteger(cfg.chunkSize) && cfg.chunkSize > 1024, 'bad chunkSize', JSON.stringify(cfg));
  return `configured, chunkSize=${kb(cfg.chunkSize)}, maxBytes=${(cfg.maxBytes / 1048576).toFixed(0)} MB, expiries=${(cfg.expiries || []).join('/')}, maxSigners=${cfg.maxSigners}`;
});

// ---------------- SHARE: create → upload → finish → info → open → download → decrypt → compare → status → delete → gone
if (token && cfg) await step('share', async () => {
  const t = {};
  const plainChunk = cfg.chunkSize - C.TAG;
  // ~150 KB, but always > 1 chunk so the multi-chunk path is exercised
  const size = Math.min(Math.max(150 * 1024, plainChunk + 50 * 1024), 3 * 1024 * 1024);
  const plain = nodeRandom(size);
  const L = C.newLinkKey(); // link key – stays local (would live in #k=…)
  const meta = { name: 'smoke-test.bin', type: 'application/octet-stream', size };
  let s0 = Date.now();
  const up = await uploadEncrypted(plain, {
    ck: L, meta, chunkSize: cfg.chunkSize,
    announce: b => api('share', 'create', { json: { ...b, token, kind: 'file', expiresIn: 3600, maxDownloads: 2 } }),
  });
  cleanups.push(() => api('share', 'delete', { json: { id: up.id, auth: up.auth } }));
  t.upload = Date.now() - s0;
  must(up.maxDownloads === 2, `maxDownloads ${up.maxDownloads} ≠ 2`);
  const fin = await api('share', 'finish', { json: { id: up.id, auth: up.auth } });
  must(fin.object && fin.object.size === up.cipherSize && fin.object.chunks === up.chunks, 'finish: size/chunks mismatch', JSON.stringify(fin.object));
  const info = await api('share', 'info', { json: { id: up.id } });
  must(info.object.downloads === 0 && !info.exhausted, 'info: unexpected download counter');
  must(!info.object.header.includes('smoke-test'), 'header leaks the file name in plaintext');
  s0 = Date.now();
  const op = await api('share', 'open', { json: { id: up.id } });
  must(op.object.downloads === 1 && /^t1\./.test(op.ticket || ''), 'open: no ticket / counter');
  const dl = await downloadDecrypted({ ...op.object, ticket: op.ticket }, L);
  t.download = Date.now() - s0;
  must(sameBytes(dl.bytes, plain), 'decrypted bytes differ from the original');
  must(dl.meta && dl.meta.name === meta.name && dl.meta.size === size, 'decrypted metadata differs');
  // a wrong link key must not decrypt
  let wrong = null; try { await C.openObject(C.newLinkKey(), op.object.header); } catch (e) { wrong = e; }
  must(wrong && wrong.code === 'wrong_key', 'wrong link key was accepted');
  const st = await api('share', 'status', { json: { id: up.id, auth: up.auth } });
  must(st.exists && st.object.downloads === 1, 'status: downloads ≠ 1');
  const del = await api('share', 'delete', { json: { id: up.id, auth: up.auth } });
  must(del.deleted === true, 'delete: deleted ≠ true', JSON.stringify(del));
  cleanups.pop();
  await apiExpect('share', 'info', 404, { json: { id: up.id } });
  await apiExpect('share', 'open', 404, { json: { id: up.id } });
  const st2 = await api('share', 'status', { json: { id: up.id, auth: up.auth } });
  must(st2.exists === false, 'status after delete: still exists');
  return `${kb(size)} plaintext in ${up.chunks} chunks (${kb(up.cipherSize)} ciphertext): upload ${t.upload} ms, open+download+decrypt ${t.download} ms, bytes+meta identical, wrong key rejected, revoked → 404`;
});

// ---------------- SIGN: sign-doc upload → sign/create → signer open → download+decrypt → result upload → finish → requester status → download result → delete
if (token && cfg) await step('sign', async () => {
  const L = C.newLinkKey();
  const doc = Buffer.concat([Buffer.from('%PDF-1.7\n% FaLe live smoke\n'), nodeRandom(40 * 1024)]);
  const up = await uploadEncrypted(doc, {
    ck: L, meta: { name: 'Vertrag.pdf', type: 'application/pdf', size: doc.length, signers: ['Smoke Test'] }, chunkSize: cfg.chunkSize,
    announce: b => api('share', 'create', { json: { ...b, token, kind: 'sign-doc', expiresIn: 86400 } }),
  });
  cleanups.push(() => api('share', 'delete', { json: { id: up.id, auth: up.auth } }));
  await api('share', 'finish', { json: { id: up.id, auth: up.auth } });
  await apiExpect('share', 'open', 403, { json: { id: up.id } }); // sign-docs are only reachable via a signer link
  const cr = await api('sign', 'create', { json: { token, docId: up.id, auth: up.auth, signers: 1 } });
  keep(...(cr.signers || []));
  must(Array.isArray(cr.signers) && cr.signers.length === 1, 'sign/create: no signer token');
  cleanups.pop();
  cleanups.push(() => api('sign', 'delete', { json: { id: cr.id, auth: up.auth } }));
  const [s1] = cr.signers;
  const st0 = await api('sign', 'status', { json: { id: cr.id, auth: up.auth } });
  must(st0.exists && st0.signers[0].status === 'open', 'status before open ≠ open', JSON.stringify(st0.signers));
  // signer
  const o = await api('sign', 'open', { json: { s: s1 } });
  must(o.status === 'viewed' && o.source && o.source.id === up.id && o.doc.id === up.id, 'sign/open: unexpected source', JSON.stringify({ status: o.status, idx: o.idx, count: o.count }));
  const got = await downloadDecrypted(o.source, L);
  must(sameBytes(got.bytes, doc), 'signer: decrypted document differs');
  must(got.meta.name === 'Vertrag.pdf', 'signer: metadata differs');
  const signed = Buffer.concat([doc, Buffer.from('\n% signed by smoke test ' + new Date().toISOString() + '\n')]);
  const res = await uploadEncrypted(signed, {
    ck: L, meta: { name: 'Vertrag (unterschrieben).pdf', type: 'application/pdf', size: signed.length, signer: 'Smoke Test' }, chunkSize: cfg.chunkSize,
    announce: b => api('sign', 'result', { json: { ...b, s: s1 } }),
    auth: s1, // the signer token owns its result object
  });
  const fin = await api('sign', 'finish', { json: { s: s1 } });
  must(!!fin.signedAt, 'sign/finish: no signedAt');
  // requester
  const st = await api('sign', 'status', { json: { id: cr.id, auth: up.auth } });
  const sg = st.signers && st.signers[0];
  must(sg && sg.status === 'signed' && sg.result && sg.result.id === res.id, 'status after signing ≠ signed with result', JSON.stringify(st.signers && st.signers.map(x => ({ idx: x.idx, status: x.status, result: !!x.result }))));
  const back = await downloadDecrypted(sg.result, L);
  must(sameBytes(back.bytes, signed), 'requester: decrypted signed result differs');
  must(back.meta.signer === 'Smoke Test', 'requester: result metadata differs');
  const again = await http('/api/sign?a=open', { json: { s: s1 } });
  must(again.status === 200 && again.json.status === 'signed', 'signer re-open ≠ signed');
  const del = await api('sign', 'delete', { json: { id: cr.id, auth: up.auth } });
  must(del.deleted === true, 'sign/delete: deleted ≠ true');
  cleanups.pop();
  const st2 = await api('sign', 'status', { json: { id: cr.id, auth: up.auth } });
  must(st2.exists === false, 'status after delete: still exists');
  await apiExpect('sign', 'open', 404, { json: { s: s1 } });
  return `doc ${kb(doc.length)} uploaded as sign-doc, request created (1 signer), signer opened (open→viewed), decrypted doc identical, signed result ${kb(signed.length)} uploaded+finished, requester saw "signed" and decrypted identical result, delete → signer link 404`;
});

// ---------------- TRANSFER: host creates room → guest joins by code → encrypted signalling both ways → relay blob A→B → close
if (token && cfg) await step('transfer', async () => {
  const room = await api('transfer', 'create', { json: { token } });
  keep(room.auth);
  must(/^\d{6}$/.test(room.code) && room.room, 'transfer/create: no room/code');
  cleanups.push(() => api('transfer', 'close', { json: { room: room.room, auth: room.auth } }));
  const pre = await api('transfer', 'poll', { json: { room: room.room, auth: room.auth, after: 0 } });
  must(pre.joined === false, 'room joined before guest joined');
  const guest = await api('transfer', 'join', { json: { code: room.code } });
  keep(guest.auth);
  must(guest.room === room.room && guest.via === 'code', 'join: wrong room/via');
  // both sides derive K from the typed code (like Session.keys in js/share/transfer.js)
  const K = await C.deriveKey(te.encode(room.code), room.room, 'fale-transfer-v1/code');
  // guest → host (signalling "offer")
  const offer = { t: 'offer', sdp: 'v=0 smoke ' + randomUUID() };
  await api('transfer', 'send', { json: { room: room.room, auth: guest.auth, body: await C.sealMsg(K, offer) } });
  const ph = await api('transfer', 'poll', { json: { room: room.room, auth: room.auth, after: 0 } });
  must(ph.joined === true && ph.via === 'code' && ph.msgs.length === 1, 'host poll: expected 1 message', JSON.stringify({ joined: ph.joined, via: ph.via, n: ph.msgs.length }));
  must(!ph.msgs[0].body.includes('smoke'), 'signalling body is not encrypted');
  const gotOffer = await C.openMsg(K, ph.msgs[0].body);
  must(gotOffer.sdp === offer.sdp, 'host: decrypted offer differs');
  // host → guest: relay file (encrypted blob in share storage, key derived from K) + "rfile" message
  const relayKey = await C.deriveKey(K, room.room, 'fale-transfer-v1/relay');
  const blob = nodeRandom(64 * 1024 + 123);
  const up = await uploadEncrypted(blob, {
    ck: relayKey, meta: { name: 'foto.jpg', type: 'image/jpeg', size: blob.length }, chunkSize: cfg.chunkSize,
    announce: b => api('share', 'create', { json: { ...b, token, kind: 'relay', expiresIn: 3600 } }),
  });
  cleanups.push(() => api('share', 'delete', { json: { id: up.id, auth: up.auth } }));
  must(up.maxDownloads === 3, `relay maxDownloads ${up.maxDownloads} ≠ 3`);
  await api('share', 'finish', { json: { id: up.id, auth: up.auth } });
  await api('transfer', 'send', { json: { room: room.room, auth: room.auth, body: await C.sealMsg(K, { t: 'rfile', id: up.id, fid: 'f1', name: 'foto.jpg', size: blob.length }) } });
  const pg = await api('transfer', 'poll', { json: { room: room.room, auth: guest.auth, after: 0 } });
  must(pg.msgs.length === 1, `guest poll: expected 1 message, got ${pg.msgs.length}`);
  const rf = await C.openMsg(K, pg.msgs[0].body);
  must(rf.t === 'rfile' && rf.id === up.id, 'guest: decrypted rfile differs');
  const op = await api('share', 'open', { json: { id: rf.id } });
  const recv = await downloadDecrypted({ ...op.object, ticket: op.ticket }, relayKey);
  must(sameBytes(recv.bytes, blob) && recv.meta.name === 'foto.jpg', 'guest: decrypted relay file differs');
  await api('transfer', 'send', { json: { room: room.room, auth: guest.auth, body: await C.sealMsg(K, { t: 'rgot', id: up.id, fid: 'f1' }) } });
  const ph2 = await api('transfer', 'poll', { json: { room: room.room, auth: room.auth, after: ph.msgs[0].seq } });
  must(ph2.msgs.length === 1 && (await C.openMsg(K, ph2.msgs[0].body)).t === 'rgot', 'host: no rgot');
  const del = await api('share', 'delete', { json: { id: up.id, auth: up.auth } });
  must(del.deleted === true, 'relay delete failed');
  cleanups.pop();
  const cl = await api('transfer', 'close', { json: { room: room.room, auth: room.auth } });
  must(cl.deleted === true, 'close: deleted ≠ true');
  cleanups.pop();
  await apiExpect('transfer', 'poll', 404, { json: { room: room.room, auth: guest.auth, after: 0 } });
  return `room created (6-digit code), guest joined by code, encrypted offer guest→host ok, relay file ${kb(blob.length)} host→guest via share storage decrypted identical, rgot ack back, relay deleted, room closed → 404`;
});

// ---------------- ACCOUNT: config (public) + me without token
await step('account', async () => {
  const r = await http('/api/account?a=config', { json: {} });
  must(r.status === 200 && r.json && r.json.ok === true, `account/config → HTTP ${r.status}`, (r.text || '').slice(0, 400));
  const j = r.json;
  const me = await http('/api/account?a=me', { json: {} });
  const meErr = me.json ? me.json.error : me.text.slice(0, 80);
  if (j.configured) {
    must(typeof j.supabaseUrl === 'string' && /^https:\/\//.test(j.supabaseUrl), 'configured but no supabaseUrl');
    must(me.status === 401, `account/me without token: expected 401, got ${me.status}`, me.text.slice(0, 300));
    return `ENABLED: configured=true, features=${JSON.stringify(j.features)}, region=${j.region}; me without token → ${me.status} ${meErr}`;
  }
  must(j.supabaseUrl === null && j.supabaseKey === null, 'disabled but config exposes supabase settings');
  must(me.status === 503 && meErr === 'account_not_configured', `account/me while disabled: expected 503 account_not_configured, got ${me.status} ${meErr}`, me.text.slice(0, 300));
  return `DISABLED as expected (ACCOUNTS_ENABLED not set): configured=false, features=${JSON.stringify(j.features)}; me → 503 account_not_configured`;
});

// ---------------- FALE ONE: drive config (public), auth required for everything else, CORS for the FaLe One app
await step('drive', async () => {
  const r = await http('/api/drive?a=config', { json: {} });
  must(r.status === 200 && r.json && r.json.ok === true, `drive/config → HTTP ${r.status}`, (r.text || '').slice(0, 400));
  const j = r.json;
  const q = await http('/api/drive?a=quota', { json: {} });
  const em = await http('/api/drive?a=em.status', { json: {} });
  const err = x => (x.json ? x.json.error : (x.text || '').slice(0, 80));
  const pre = await fetch(BASE + '/api/drive?a=quota', { method: 'OPTIONS', headers: { Origin: 'https://fale-one.vercel.app', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const cors = pre.headers.get('access-control-allow-origin');
  must(cors === 'https://fale-one.vercel.app', `CORS preflight from fale-one.vercel.app: allow-origin=${cors}, HTTP ${pre.status}`);
  if (j.configured) {
    must(Number.isInteger(j.chunkSize) && j.chunkSize >= 65536 && ['pg', 's3'].includes(j.backend), 'config: bad chunkSize/backend', JSON.stringify(j));
    must(q.status === 401 && err(q) === 'invalid_account', `drive/quota without token: expected 401 invalid_account, got ${q.status} ${err(q)}`, (q.text || '').slice(0, 300));
    must(em.status === 401, `drive/em.status without token: expected 401, got ${em.status} ${err(em)}`, (em.text || '').slice(0, 300));
    return `ENABLED: configured=true, backend=${j.backend}, chunk=${j.chunkSize}, direct=${j.direct}, emergency=${j.emergency}, notify=${j.notify}; quota/em.status without token → 401; CORS for fale-one.vercel.app ok`;
  }
  must(q.status === 503 && err(q) === 'drive_not_configured', `drive/quota while disabled: expected 503 drive_not_configured, got ${q.status} ${err(q)}`, (q.text || '').slice(0, 300));
  return `DISABLED (ONE_ENABLED / ACCOUNTS_ENABLED not both set or migration missing): configured=false; quota → 503 drive_not_configured; CORS ok`;
});

// ---------------------------------------------------------------- cleanup leftovers after failures
for (const fn of cleanups.reverse()) { try { await fn(); } catch {} }

const failed = results.filter(r => !r.ok);
const summary = results.map(r => `${r.name}:${r.ok ? 'PASS' : 'FAIL'}(${r.ms}ms)`).join(' ');
if (failed.length) error('summary', `${failed.length} of ${results.length} failed against ${BASE} – ${summary}`);
else notice('summary', `all ${results.length} steps passed against ${BASE} – ${summary}`);
process.exit(failed.length ? 1 : 0);
