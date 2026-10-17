// Node unit tests for the sharing API (api/_lib/share.js + sharestore.js) and the client crypto
// (js/share/crypto.js, WebCrypto in Node). In-memory store, controllable clock, no network.
//   node test_share_api.mjs
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import crypto from 'node:crypto';

const ROOT = process.env.FALE_ROOT || '/home/claude/FalePDF';
const require = createRequire(join(ROOT, 'api', 'x.js'));
Object.assign(process.env, { FALE_STORE: 'memory', FALE_TOKEN_SECRET: 'test-token-secret-0123456789abcdefghijklmnopqrstuvwxyz', FALE_IP_SALT: 'test-ip-salt-0123456789', SHARE_CHUNK_KB: '64' });
const { makeShareCore, cipherSize, makeTicket, checkTicket } = require('./_lib/share.js');
const { memoryShareStore, supabaseShareStore } = require('./_lib/sharestore.js');
const Sec = require('./_lib/security.js');
const C = await import(join(ROOT, 'js/share/crypto.js'));

let pass = 0, fail = 0;
const check = (name, cond, info = '') => { if (cond) pass++; else fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && info ? `  [${String(info).slice(0, 300)}]` : '')); };

let offset = 0;
const clock = () => new Date(Date.now() + offset);
let store = memoryShareStore({ now: clock });
let core = makeShareCore({ getShareStore: () => store, now: clock });
const fresh = () => { offset = 0; store = memoryShareStore({ now: clock }); core = makeShareCore({ getShareStore: () => store, now: clock }); };
const deviceToken = (id = 'device-aaaaaaaaaaaaaaaa') => Sec.issueToken(process.env.FALE_TOKEN_SECRET, Sec.deviceHash(process.env.FALE_TOKEN_SECRET, id));

async function call(handler, action, { json = null, raw = null, auth = null, ip = '203.0.113.7', method = 'POST', query = '' } = {}) {
  const url = `/api/x?a=${action}${query ? '&' + query : ''}`;
  const body = raw != null ? Buffer.from(raw) : Buffer.from(json ? JSON.stringify(json) : '');
  const req = Readable.from(body.length ? [body] : []);
  Object.assign(req, { method, url, headers: { 'x-real-ip': ip, ...(auth ? { 'x-fale-auth': auth } : {}), 'content-type': raw != null ? 'application/octet-stream' : 'application/json', origin: 'https://fale-pdf.vercel.app' } });
  const chunks = [];
  const headers = {};
  const res = { statusCode: 200, headersSent: false, writableEnded: false, setHeader(k, v) { headers[k.toLowerCase()] = v; }, on() {}, write(b) { chunks.push(Buffer.from(b)); }, end(b) { if (b) chunks.push(Buffer.from(b)); this.writableEnded = true; } };
  await core[handler](req, res);
  const buf = Buffer.concat(chunks);
  let j = null;
  if ((headers['content-type'] || '').includes('json')) { try { j = JSON.parse(buf.toString('utf8')); } catch {} }
  return { status: res.statusCode, json: j, buf, headers };
}

// ---------------------------------------------------------------- crypto (client module in Node)
{
  const L = C.newLinkKey();
  const plain = crypto.randomBytes(200000);
  const sealed = await C.sealObject(L, { name: 'Geheim.pdf', size: plain.length }, { plainSize: plain.length, chunkSize: 65536 });
  check('crypto: header has no plaintext name', !sealed.header.includes('Geheim'));
  const cts = [];
  for (let i = 0; i < sealed.chunks; i++) cts.push(await sealed.encryptChunk(i, plain.subarray(i * sealed.plainChunk, (i + 1) * sealed.plainChunk)));
  check('crypto: cipher size layout', cts.reduce((a, c) => a + c.length, 0) === sealed.cipherSize && sealed.cipherSize === cipherSize(plain.length, 65536));
  const o = await C.openObject(L, sealed.header);
  check('crypto: meta round trip', o.meta.name === 'Geheim.pdf');
  const parts = [];
  for (let i = 0; i < cts.length; i++) parts.push(await o.decryptChunk(i, cts[i], i === cts.length - 1));
  check('crypto: data round trip', Buffer.compare(Buffer.concat(parts), plain) === 0);
  let e1 = null; try { await C.openObject(C.newLinkKey(), sealed.header); } catch (e) { e1 = e; }
  check('crypto: wrong key rejected', e1 && e1.code === 'wrong_key');
  let e2 = null; try { await o.decryptChunk(1, cts[0], false); } catch (e) { e2 = e; }
  check('crypto: reordered chunk rejected', e2 && e2.code === 'corrupt');
  let e3 = null; try { await o.decryptChunk(cts.length - 2, cts[cts.length - 2], true); } catch (e) { e3 = e; }
  check('crypto: truncation (fake last chunk) rejected', e3 && e3.code === 'corrupt');
  const bad = new Uint8Array(cts[0]); bad[10] ^= 1;
  let e4 = null; try { await o.decryptChunk(0, bad, false); } catch (e) { e4 = e; }
  check('crypto: tampered chunk rejected', e4 && e4.code === 'corrupt');
  // password: link key + password both needed
  const kdf = { ...C.newKdf(), i: 100000 };
  const ck = await C.contentKey(L, kdf, 'richtig123');
  const s2 = await C.sealObject(ck, { name: 'x' }, { plainSize: 10, chunkSize: 65536, kdf });
  const ok = await C.openObject(await C.contentKey(L, kdf, 'richtig123'), s2.header);
  check('crypto: password round trip', ok.meta.name === 'x');
  let e5 = null; try { await C.openObject(await C.contentKey(L, kdf, 'falsch'), s2.header); } catch (e) { e5 = e; }
  check('crypto: wrong password rejected', e5 && e5.code === 'wrong_key');
  let e6 = null; try { await C.openObject(await C.contentKey(C.newLinkKey(), kdf, 'richtig123'), s2.header); } catch (e) { e6 = e; }
  check('crypto: password alone (without link key) is useless', e6 && e6.code === 'wrong_key');
  check('crypto: header stores salt/iterations only', JSON.parse(s2.header).k.i === 100000 && !s2.header.includes('richtig'));
  const frag = `#/s/abcdefghijklmnopqrstuv#k=${C.b64u.enc(L)}`;
  check('crypto: key from fragment', Buffer.compare(Buffer.from(C.keyFromFragment(frag)), Buffer.from(L)) === 0);
  check('crypto: no key → null', C.keyFromFragment('#/s/abcdefghijklmnopqrstuv') === null && C.keyFromFragment('#k=short') === null);
  const msg = await C.sealMsg(L, { t: 'offer', sdp: 'v=0' });
  check('crypto: signalling message round trip', (await C.openMsg(L, msg)).sdp === 'v=0');
  let e7 = null; try { await C.openMsg(C.newLinkKey(), msg); } catch (e) { e7 = e; }
  check('crypto: signalling with wrong key fails', !!e7);
  // empty file → 1 chunk with only the tag
  const s3 = await C.sealObject(L, { name: 'leer' }, { plainSize: 0, chunkSize: 65536 });
  check('crypto: empty file = 1 chunk of 16 bytes', s3.chunks === 1 && s3.cipherSize === 16);
}

// ---------------------------------------------------------------- tickets
{
  const sec = process.env.FALE_TOKEN_SECRET;
  const t = makeTicket(sec, 'abcdefghijklmnopqrstuv', Date.now(), 60);
  check('ticket: valid', checkTicket(sec, t, 'abcdefghijklmnopqrstuv', Date.now()));
  check('ticket: other object', !checkTicket(sec, t, 'bbcdefghijklmnopqrstuv', Date.now()));
  check('ticket: expired', !checkTicket(sec, t, 'abcdefghijklmnopqrstuv', Date.now() + 61000));
  check('ticket: forged', !checkTicket(sec, t.slice(0, -2) + 'xx', 'abcdefghijklmnopqrstuv', Date.now()));
}

// ---------------------------------------------------------------- share flow
async function upload(kind = 'file', { size = 150000, expiresIn = 86400, maxDownloads = 2, token = deviceToken() } = {}) {
  const cs = 65536;
  const chunks = Math.max(1, Math.ceil(size / cs));
  const r = await call('share', 'create', { json: { token, kind, size, chunks, header: JSON.stringify({ v: 1, n: 'x', m: 'y' }), expiresIn, maxDownloads } });
  if (r.status !== 200) return { r };
  const data = crypto.randomBytes(size);
  for (let i = 0; i < chunks; i++) {
    const p = await call('share', 'put', { raw: data.subarray(i * cs, (i + 1) * cs), auth: r.json.auth, query: `id=${r.json.id}&i=${i}` });
    if (p.status !== 200) return { r, p };
  }
  return { r, data, id: r.json.id, auth: r.json.auth };
}
{
  fresh();
  const cfg = await call('share', 'config');
  check('config: configured with memory store', cfg.status === 200 && cfg.json.configured && cfg.json.chunkSize === 65536 && cfg.json.maxBytes === 50 * 1048576);
  const noTok = await call('share', 'create', { json: { kind: 'file', size: 10, chunks: 1, header: '{"v":1}', expiresIn: 3600 } });
  check('create: needs device token', noTok.status === 401);
  const badExp = await call('share', 'create', { json: { token: deviceToken(), kind: 'file', size: 10, chunks: 1, header: '{"v":1}', expiresIn: 999 } });
  check('create: expiry must be 1h/1d/7d', badExp.status === 400);
  const tooBig = await call('share', 'create', { json: { token: deviceToken(), kind: 'file', size: 60 * 1048576, chunks: 960, header: '{"v":1}', expiresIn: 3600 } });
  check('create: size limit 50 MB', tooBig.status === 413);
  const badChunks = await call('share', 'create', { json: { token: deviceToken(), kind: 'file', size: 100000, chunks: 1, header: '{"v":1}', expiresIn: 3600 } });
  check('create: chunk count validated', badChunks.status === 400);
  const badKind = await call('share', 'create', { json: { token: deviceToken(), kind: 'sign-result', size: 10, chunks: 1, header: '{"v":1}', expiresIn: 3600 } });
  check('create: kind validated', badKind.status === 400);

  const u = await upload();
  check('upload: create + put', u.id && !u.p);
  const early = await call('share', 'info', { json: { id: u.id } });
  check('info: incomplete object invisible', early.status === 404);
  const wrongOwner = await call('share', 'finish', { json: { id: u.id, auth: 'A'.repeat(32) } });
  check('finish: wrong owner forbidden', wrongOwner.status === 403);
  const fin = await call('share', 'finish', { json: { id: u.id, auth: u.auth } });
  check('finish: ok', fin.status === 200 && fin.json.object.size === 150000);
  const putAfter = await call('share', 'put', { raw: Buffer.alloc(10), auth: u.auth, query: `id=${u.id}&i=2` });
  check('put: after finish rejected', putAfter.status === 409);
  const info = await call('share', 'info', { json: { id: u.id } });
  check('info: no download counted', info.status === 200 && info.json.object.downloads === 0 && !info.json.exhausted);
  const getNoTicket = await call('share', 'get', { raw: '', query: `id=${u.id}&i=0` });
  check('get: needs ticket', getNoTicket.status === 403);
  const open1 = await call('share', 'open', { json: { id: u.id } });
  check('open: counts + ticket', open1.status === 200 && open1.json.object.downloads === 1 && /^t1\./.test(open1.json.ticket));
  const parts = [];
  for (let i = 0; i < 3; i++) parts.push((await call('share', 'get', { raw: '', auth: open1.json.ticket, query: `id=${u.id}&i=${i}` })).buf);
  check('get: identical ciphertext bytes', Buffer.compare(Buffer.concat(parts), u.data) === 0);
  const getOther = await call('share', 'get', { raw: '', auth: open1.json.ticket, query: `id=${u.id.slice(0, -1)}${u.id.endsWith('A') ? 'B' : 'A'}&i=0` });
  check('get: ticket bound to object', getOther.status === 403);
  await call('share', 'open', { json: { id: u.id } });
  const open3 = await call('share', 'open', { json: { id: u.id } });
  check('open: download limit enforced', open3.status === 410 && open3.json.error === 'exhausted');
  const info2 = await call('share', 'info', { json: { id: u.id } });
  check('info: exhausted flag', info2.status === 200 && info2.json.exhausted);
  const st = await call('share', 'status', { json: { id: u.id, auth: u.auth } });
  check('status: downloads for owner', st.json.exists && st.json.object.downloads === 2);
  const stBad = await call('share', 'status', { json: { id: u.id, auth: 'B'.repeat(32) } });
  check('status: other owner forbidden', stBad.status === 403);
  const delBad = await call('share', 'delete', { json: { id: u.id, auth: 'B'.repeat(32) } });
  check('delete: wrong owner does nothing', delBad.json.deleted === false);
  const del = await call('share', 'delete', { json: { id: u.id, auth: u.auth } });
  check('revoke: deleted', del.json.deleted === true && store._state.chunks.size === 0);
  const gone = await call('share', 'info', { json: { id: u.id } });
  check('revoke: link dead', gone.status === 404);

  // expiry (lazy + purge)
  const e = await upload('file', { expiresIn: 3600, maxDownloads: null });
  await call('share', 'finish', { json: { id: e.id, auth: e.auth } });
  const o = await call('share', 'open', { json: { id: e.id } });
  offset += 3601 * 1000;
  const exp = await call('share', 'info', { json: { id: e.id } });
  check('expiry: info after 1 h → 404 (lazy delete)', exp.status === 404 && !store._state.objects.has(e.id));
  const expGet = await call('share', 'get', { raw: '', auth: o.json.ticket, query: `id=${e.id}&i=0` });
  check('expiry: chunks gone too', expGet.status === 404 || expGet.status === 403);
  const e2 = await upload('file', { expiresIn: 3600 });
  offset += 7 * 3600 * 1000;
  const p = await store.purge();
  check('purge: abandoned/expired removed', p.objects >= 1 && !store._state.objects.has(e2.id));

  // relay: max 3 downloads, forced 1 h
  fresh();
  const rl = await upload('relay', { expiresIn: 604800, maxDownloads: 50 });
  check('relay: forced 1 h + 3 downloads', rl.r.json.maxDownloads === 3 && Date.parse(rl.r.json.expiresAt) - Date.now() < 3700 * 1000);
}

// ---------------------------------------------------------------- rate limits + capacity
{
  fresh();
  process.env.SHARE_DEVICE_DAILY = '2';
  await upload(); await upload();
  const third = await upload();
  check('rate: per device daily limit', third.r.status === 429);
  const other = await upload('file', { token: deviceToken('device-bbbbbbbbbbbbbbbb') });
  check('rate: other device still ok', other.r.status === 200);
  delete process.env.SHARE_DEVICE_DAILY;
  fresh();
  process.env.SHARE_IP_DAILY = '1';
  await upload('file', { token: deviceToken('device-cccccccccccccccc') });
  const ipBlocked = await upload('file', { token: deviceToken('device-dddddddddddddddd') });
  check('rate: per IP hash limit', ipBlocked.r.status === 429);
  delete process.env.SHARE_IP_DAILY;
  fresh();
  process.env.SHARE_TOTAL_MB = '10';
  const big1 = await upload('file', { size: 6 * 1048576 });
  const big2 = await upload('file', { size: 6 * 1048576 });
  check('capacity: global cap → 503', big1.r.status === 200 && big2.r.status === 503 && big2.r.json.error === 'capacity');
  delete process.env.SHARE_TOTAL_MB;
  const usageKeys = [...store._state.usage.keys()].join(' ');
  check('rate: only hashed keys stored', !usageKeys.includes('203.0.113.7') && /\|d:[A-Za-z0-9_-]{32}\|/.test(usageKeys) && /\|i:[0-9a-f]{40}\|/.test(usageKeys));
}

// ---------------------------------------------------------------- signature requests (2 signers, sequential)
{
  fresh();
  const doc = await upload('sign-doc', { size: 70000, expiresIn: 604800 });
  check('sign-doc: no download limit', doc.r.json.maxDownloads === null);
  await call('share', 'finish', { json: { id: doc.id, auth: doc.auth } });
  const openDoc = await call('share', 'open', { json: { id: doc.id } });
  check('sign-doc: not downloadable via share/open', openDoc.status === 403);
  const infoDoc = await call('share', 'info', { json: { id: doc.id } });
  check('sign-doc: hidden from share/info', infoDoc.status === 404);
  const badCreate = await call('sign', 'create', { json: { token: deviceToken(), docId: doc.id, auth: 'C'.repeat(32), signers: 2 } });
  check('sign: create needs doc owner', badCreate.status === 403);
  const tooMany = await call('sign', 'create', { json: { token: deviceToken(), docId: doc.id, auth: doc.auth, signers: 6 } });
  check('sign: max 5 signers', tooMany.status === 400);
  const cr = await call('sign', 'create', { json: { token: deviceToken(), docId: doc.id, auth: doc.auth, signers: 2 } });
  check('sign: create', cr.status === 200 && cr.json.signers.length === 2);
  const [s1, s2] = cr.json.signers;
  const st0 = await call('sign', 'status', { json: { id: cr.json.id, auth: doc.auth } });
  check('sign: status Offen', st0.json.signers.map(s => s.status).join() === 'open,open');
  const w = await call('sign', 'open', { json: { s: s2 } });
  check('sign: signer 2 waits for signer 1', w.status === 409 && w.json.error === 'waiting' && w.json.idx === 1);
  const resEarly = await call('sign', 'result', { json: { s: s1, size: 100, chunks: 1, header: '{"v":1}' } });
  check('sign: result before open forbidden', resEarly.status === 403);
  const o1 = await call('sign', 'open', { json: { s: s1 } });
  check('sign: open → viewed + source ticket', o1.status === 200 && o1.json.status === 'viewed' && o1.json.source.id === doc.id && /^t1\./.test(o1.json.source.ticket));
  const g = await call('share', 'get', { raw: '', auth: o1.json.source.ticket, query: `id=${doc.id}&i=0` });
  check('sign: signer downloads doc', g.status === 200 && Buffer.compare(g.buf, doc.data.subarray(0, 65536)) === 0);
  const st1 = await call('sign', 'status', { json: { id: cr.json.id, auth: doc.auth } });
  check('sign: status Angesehen', st1.json.signers[0].status === 'viewed' && !!st1.json.signers[0].viewedAt);
  const rr = await call('sign', 'result', { json: { s: s1, size: 80000, chunks: 2, header: '{"v":1,"r":1}' } });
  check('sign: result announced', rr.status === 200);
  const resData = crypto.randomBytes(80000);
  const fin0 = await call('sign', 'finish', { json: { s: s1 } });
  check('sign: finish before upload rejected', fin0.status === 409);
  const pbad = await call('share', 'put', { raw: resData.subarray(0, 65536), auth: s2, query: `id=${rr.json.id}&i=0` });
  check('sign: other signer cannot upload my result', pbad.status === 403);
  await call('share', 'put', { raw: resData.subarray(0, 65536), auth: s1, query: `id=${rr.json.id}&i=0` });
  await call('share', 'put', { raw: resData.subarray(65536), auth: s1, query: `id=${rr.json.id}&i=1` });
  const fin1 = await call('sign', 'finish', { json: { s: s1 } });
  check('sign: finish', fin1.status === 200 && !!fin1.json.signedAt);
  const again = await call('sign', 'result', { json: { s: s1, size: 100, chunks: 1, header: '{"v":1}' } });
  check('sign: cannot sign twice', again.status === 409);
  const o2 = await call('sign', 'open', { json: { s: s2 } });
  check('sign: signer 2 gets signer 1 result', o2.status === 200 && o2.json.source.id === rr.json.id && o2.json.doc.id === doc.id);
  const st2 = await call('sign', 'status', { json: { id: cr.json.id, auth: doc.auth } });
  check('sign: status Unterschrieben + result ticket', st2.json.signers[0].status === 'signed' && st2.json.signers[0].result && /^t1\./.test(st2.json.signers[0].result.ticket) && st2.json.signers[1].status === 'viewed');
  const dl = await call('share', 'get', { raw: '', auth: st2.json.signers[0].result.ticket, query: `id=${rr.json.id}&i=1` });
  check('sign: sender downloads signed result', Buffer.compare(dl.buf, resData.subarray(65536)) === 0);
  const o1b = await call('sign', 'open', { json: { s: s1 } });
  check('sign: signer 1 re-open shows signed + own copy', o1b.json.status === 'signed' && o1b.json.result && o1b.json.result.id === rr.json.id);
  const stBad = await call('sign', 'status', { json: { id: cr.json.id, auth: 'D'.repeat(32) } });
  check('sign: status needs owner', stBad.status === 403);
  // expiry → Abgelaufen
  offset += 8 * 864e5;
  const stExp = await call('sign', 'status', { json: { id: cr.json.id, auth: doc.auth } });
  check('sign: expired → exists false', stExp.status === 200 && stExp.json.exists === false);
  const oExp = await call('sign', 'open', { json: { s: s2 } });
  check('sign: expired link → 404', oExp.status === 404);
  // delete
  offset = 0;
  const d2 = await upload('sign-doc', { size: 1000, expiresIn: 86400 });
  await call('share', 'finish', { json: { id: d2.id, auth: d2.auth } });
  const c2 = await call('sign', 'create', { json: { token: deviceToken(), docId: d2.id, auth: d2.auth, signers: 1 } });
  const delS = await call('sign', 'delete', { json: { id: c2.json.id, auth: d2.auth } });
  check('sign: delete removes doc + request', delS.json.deleted && !store._state.objects.has(d2.id) && !store._state.requests.has(c2.json.id));
}

// ---------------------------------------------------------------- transfer rooms
{
  fresh();
  const cr = await call('transfer', 'create', { json: { token: deviceToken() } });
  check('room: create', cr.status === 200 && /^\d{6}$/.test(cr.json.code) && cr.json.auth.length >= 24);
  const badJoin = await call('transfer', 'join', { json: { code: String((+cr.json.code + 1) % 1000000).padStart(6, '0') } });
  check('room: wrong code → 404', badJoin.status === 404);
  const j = await call('transfer', 'join', { json: { code: cr.json.code } });
  check('room: join by code', j.status === 200 && j.json.room === cr.json.room && j.json.via === 'code');
  const j2 = await call('transfer', 'join', { json: { room: cr.json.room } });
  check('room: only one guest', j2.status === 409);
  const sendX = await call('transfer', 'send', { json: { room: cr.json.room, auth: 'E'.repeat(32), body: 'x' } });
  check('room: strangers cannot send', sendX.status === 403);
  await call('transfer', 'send', { json: { room: cr.json.room, auth: j.json.auth, body: 'ciphertext-offer' } });
  const ph = await call('transfer', 'poll', { json: { room: cr.json.room, auth: cr.json.auth, after: 0 } });
  check('room: host receives guest message', ph.json.joined && ph.json.msgs.length === 1 && ph.json.msgs[0].body === 'ciphertext-offer' && ph.json.via === 'code');
  const pg = await call('transfer', 'poll', { json: { room: cr.json.room, auth: j.json.auth, after: 0 } });
  check('room: guest does not get own message', pg.json.msgs.length === 0);
  const ph2 = await call('transfer', 'poll', { json: { room: cr.json.room, auth: cr.json.auth, after: ph.json.msgs[0].seq } });
  check('room: after cursor', ph2.json.msgs.length === 0);
  const cl = await call('transfer', 'close', { json: { room: cr.json.room, auth: j.json.auth } });
  const pAfter = await call('transfer', 'poll', { json: { room: cr.json.room, auth: cr.json.auth, after: 0 } });
  check('room: close removes room', cl.json.deleted && pAfter.status === 404);
  // QR join + expiry
  const cr2 = await call('transfer', 'create', { json: { token: deviceToken() } });
  const jq = await call('transfer', 'join', { json: { room: cr2.json.room } });
  check('room: join by id (QR)', jq.status === 200 && jq.json.via === 'qr');
  offset += 3601 * 1000;
  const pExp = await call('transfer', 'poll', { json: { room: cr2.json.room, auth: cr2.json.auth, after: 0 } });
  check('room: expires after 1 h', pExp.status === 404);
  // brute force protection
  fresh();
  process.env.TRANSFER_JOIN_IP_DAILY = '3';
  for (let i = 0; i < 3; i++) await call('transfer', 'join', { json: { code: '000000' } });
  const fourth = await call('transfer', 'join', { json: { code: '000001' } });
  check('room: join attempts rate-limited per IP', fourth.status === 429);
  delete process.env.TRANSFER_JOIN_IP_DAILY;
}

// ---------------------------------------------------------------- misc: CORS, not configured, supabase adapter wiring
{
  fresh();
  const pre = await (async () => {
    const req = Readable.from([]);
    Object.assign(req, { method: 'OPTIONS', url: '/api/share?a=put', headers: { origin: 'https://localhost' } });
    const headers = {}; const res = { statusCode: 200, headersSent: false, setHeader(k, v) { headers[k] = v; }, end() {}, on() {} };
    await core.share(req, res);
    return { status: res.statusCode, headers };
  })();
  check('CORS: Android origin + X-Fale-Auth header allowed', pre.status === 204 && pre.headers['Access-Control-Allow-Origin'] === 'https://localhost' && /X-Fale-Auth/.test(pre.headers['Access-Control-Allow-Headers']));
  const saved = process.env.FALE_STORE;
  process.env.FALE_STORE = 'supabase';
  const nc = await call('share', 'create', { json: { token: deviceToken(), kind: 'file', size: 10, chunks: 1, header: '{"v":1}', expiresIn: 3600 } });
  check('not configured → 503 share_not_configured', nc.status === 503 && nc.json.error === 'share_not_configured');
  const ncfg = await call('share', 'config');
  check('config without backend → configured:false', ncfg.status === 200 && ncfg.json.configured === false);
  process.env.FALE_STORE = saved;
  // supabase adapter: RPC names + secret, 404 (migration missing) → 503
  const calls = [];
  const fakeFetch = async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return { ok: false, status: 404, text: async () => '' }; };
  const sb = supabaseShareStore({ supabaseUrl: 'https://x.supabase.co', supabaseKey: 'pk', rpcSecret: 's'.repeat(40) }, { fetchImpl: fakeFetch });
  core = makeShareCore({ getShareStore: () => sb, now: clock });
  const miss = await call('share', 'info', { json: { id: 'abcdefghijklmnopqrstuv' } });
  check('supabase: missing RPC (migration not applied) → 503', miss.status === 503 && miss.json.error === 'share_not_configured');
  check('supabase: calls fale_share_info with secret', calls[0] && calls[0].url.endsWith('/rest/v1/rpc/fale_share_info') && calls[0].body.p_secret === 's'.repeat(40) && calls[0].body.p_id === 'abcdefghijklmnopqrstuv');
  const okFetch = async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) }; };
  const sb2 = supabaseShareStore({ supabaseUrl: 'https://x.supabase.co', supabaseKey: 'pk', rpcSecret: 's'.repeat(40) }, { fetchImpl: okFetch });
  await sb2.put({ id: 'a', owner: 'b', idx: 3, data: 'AAAA' });
  await sb2.rate({ day: '2026-10-14', kind: 'up', keys: ['d:x'], nLimits: [1], bytes: 5, bLimits: [9] });
  await sb2.roomJoin({ code: '123456', guest: 'g', via: 'code' });
  const last3 = calls.slice(-3);
  check('supabase: param names match SQL', last3[0].body.p_idx === 3 && last3[0].body.p_data === 'AAAA' && Array.isArray(last3[1].body.p_keys) && last3[2].body.p_id === null && last3[2].body.p_code === '123456');
}

// ---------------------------------------------------------------- file requests ("Unterlagen anfordern")
{
  fresh();
  // crypto: uploads encrypted to the requester's public key – the link key alone cannot open them
  const keys = await C.newRequestKeys();
  const L = C.newLinkKey();
  const reqHeader = (await C.sealObject(L, { title: 'Steuer 2026', items: ['Lohnsteuerbescheinigung'], pub: keys.pub }, { plainSize: 0, chunkSize: 65536 })).header;
  check('rq crypto: request header has no plaintext', !reqHeader.includes('Steuer') && !reqHeader.includes(keys.pub));
  const opened = await C.openObject(L, reqHeader);
  check('rq crypto: uploader reads title + public key with the link key', opened.meta.title === 'Steuer 2026' && opened.meta.pub === keys.pub);
  const plain = crypto.randomBytes(100000);
  const uk = await C.uploadKey(opened.meta.pub);
  const sealed = await C.sealObject(uk.ck, { name: 'Bescheinigung.pdf', size: plain.length, from: 'Max' }, { plainSize: plain.length, chunkSize: 65536, extra: { e: uk.e } });
  const hdr = JSON.parse(sealed.header);
  check('rq crypto: header carries the ephemeral public key', hdr.e === uk.e && !sealed.header.includes('Bescheinigung'));
  const ck2 = await C.ownerFileKey(keys.priv, hdr.e);
  const o2 = await C.openObject(ck2, sealed.header);
  const cts = [];
  for (let i = 0; i < sealed.chunks; i++) cts.push(await sealed.encryptChunk(i, plain.subarray(i * sealed.plainChunk, (i + 1) * sealed.plainChunk)));
  const back = [];
  for (let i = 0; i < cts.length; i++) back.push(await o2.decryptChunk(i, cts[i], i === cts.length - 1));
  check('rq crypto: requester decrypts with the private key', o2.meta.from === 'Max' && Buffer.compare(Buffer.concat(back), plain) === 0);
  let le = null; try { await C.openObject(L, sealed.header); } catch (e) { le = e; }
  check('rq crypto: link key cannot open an upload', le && le.code === 'wrong_key');
  const other = await C.newRequestKeys();
  let oe = null; try { await C.openObject(await C.ownerFileKey(other.priv, hdr.e), sealed.header); } catch (e) { oe = e; }
  check('rq crypto: another private key cannot open it', oe && oe.code === 'wrong_key');
  const uk2 = await C.uploadKey(opened.meta.pub);
  check('rq crypto: fresh key per file', uk2.e !== uk.e && Buffer.compare(Buffer.from(uk2.ck), Buffer.from(uk.ck)) !== 0);
  let be = null; try { await C.uploadKey('AAAA'); } catch (e) { be = e; }
  check('rq crypto: broken public key → clear error', be && be.code === 'bad_header');

  // API
  const cfg = await call('share', 'config');
  check('rq config: expiries + limits', JSON.stringify(cfg.json.reqExpiries) === JSON.stringify([86400, 604800, 1209600, 2592000]) && cfg.json.reqMaxFiles === 50 && cfg.json.reqMaxBytes === 250 * 1048576);
  const noTok = await call('share', 'rq-create', { json: { header: reqHeader, expiresIn: 1209600 } });
  check('rq-create: needs device token', noTok.status === 401);
  const badExp = await call('share', 'rq-create', { json: { token: deviceToken(), header: reqHeader, expiresIn: 3600 } });
  check('rq-create: expiry 1/7/14/30 days', badExp.status === 400);
  const badHdr = await call('share', 'rq-create', { json: { token: deviceToken(), header: 'x', expiresIn: 1209600 } });
  check('rq-create: header validated', badHdr.status === 400);
  const tooMany = await call('share', 'rq-create', { json: { token: deviceToken(), header: reqHeader, expiresIn: 1209600, maxFiles: 51 } });
  check('rq-create: max files validated', tooMany.status === 400);
  const cr = await call('share', 'rq-create', { json: { token: deviceToken(), header: reqHeader, expiresIn: 2592000, maxFiles: 3 } });
  check('rq-create: ok (30 days)', cr.status === 200 && cr.json.id && cr.json.auth && cr.json.upload && cr.json.auth !== cr.json.upload && Math.abs(Date.parse(cr.json.expiresAt) - Date.now() - 30 * 864e5) < 60e3, JSON.stringify(cr.json));
  const { id, auth, upload: U } = cr.json;
  const op = await call('share', 'rq-open', { json: { u: U } });
  check('rq-open: header + counters', op.status === 200 && op.json.header === reqHeader && op.json.files === 0 && op.json.maxFiles === 3 && op.json.maxFileBytes === 50 * 1048576 && !op.json.closed);
  check('rq-open: wrong token → 404', (await call('share', 'rq-open', { json: { u: 'Z'.repeat(32) } })).status === 404);
  check('rq-open: owner token is no upload token', (await call('share', 'rq-open', { json: { u: auth } })).status === 404);
  // upload one file: rq-upload → put → finish
  const up = await call('share', 'rq-upload', { json: { u: U, size: sealed.cipherSize, chunks: sealed.chunks, header: sealed.header } });
  check('rq-upload: announced', up.status === 200 && up.json.id && up.json.auth && up.json.expiresAt === cr.json.expiresAt, JSON.stringify(up.json));
  for (let i = 0; i < cts.length; i++) await call('share', 'put', { raw: cts[i], auth: up.json.auth, query: `id=${up.json.id}&i=${i}` });
  const st0 = await call('share', 'rq-status', { json: { id, auth } });
  check('rq-status: unfinished upload not listed, but counted', st0.json.files.length === 0 && st0.json.usedFiles === 1);
  const fin = await call('share', 'finish', { json: { id: up.json.id, auth: up.json.auth } });
  check('rq-upload: finish with the per-file token', fin.status === 200 && fin.json.object.kind === 'req-file');
  const st = await call('share', 'rq-status', { json: { id, auth } });
  const f0 = st.json.files[0];
  check('rq-status: file with ticket', st.status === 200 && st.json.exists && st.json.files.length === 1 && f0.id === up.json.id && f0.header === sealed.header && f0.ticket && st.json.usedBytes === sealed.cipherSize);
  const g = await call('share', 'get', { auth: f0.ticket, query: `id=${f0.id}&i=0` });
  check('rq download: chunk via ticket', g.status === 200 && Buffer.compare(g.buf, Buffer.from(cts[0])) === 0);
  check('rq-status: wrong owner → 403', (await call('share', 'rq-status', { json: { id, auth: U } })).status === 403);
  // the uploaded file is not reachable through the public share endpoints
  check('rq file: share info hides it', (await call('share', 'info', { json: { id: f0.id } })).status === 404);
  check('rq file: share open refuses it', (await call('share', 'open', { json: { id: f0.id } })).status !== 200);
  check('rq file: share delete ignores it', (await call('share', 'delete', { json: { id: f0.id, auth: up.json.auth } })).json.deleted === false);
  // limits: 3 files per request, 250 MB per request
  const a2 = await call('share', 'rq-upload', { json: { u: U, size: 100, chunks: 1, header: '{"v":1}' } });
  const a3 = await call('share', 'rq-upload', { json: { u: U, size: 100, chunks: 1, header: '{"v":1}' } });
  const a4 = await call('share', 'rq-upload', { json: { u: U, size: 100, chunks: 1, header: '{"v":1}' } });
  check('rq-upload: max files per request', a2.status === 200 && a3.status === 200 && a4.status === 409 && a4.json.error === 'req_files', JSON.stringify(a4.json));
  const rt = await call('share', 'rq-retract', { json: { id: a3.json.id, auth: a3.json.auth } });
  const rtBad = await call('share', 'rq-retract', { json: { id: a2.json.id, auth: a3.json.auth } });
  check('rq-retract: own upload only', rt.json.deleted === true && rtBad.json.deleted === false);
  check('rq-upload: slot free again after retract', (await call('share', 'rq-upload', { json: { u: U, size: 100, chunks: 1, header: '{"v":1}' } })).status === 200);
  check('rq-upload: chunking validated', (await call('share', 'rq-upload', { json: { u: 'Y'.repeat(32), size: 100000, chunks: 1, header: '{"v":1}' } })).status === 400);
  // close / reopen
  check('rq-close: wrong owner', (await call('share', 'rq-close', { json: { id, auth: U, closed: true } })).status === 404);
  const cl = await call('share', 'rq-close', { json: { id, auth, closed: true } });
  check('rq-close: closed', cl.status === 200 && cl.json.closed === true && (await call('share', 'rq-open', { json: { u: U } })).json.closed === true);
  const afterClose = await call('share', 'rq-upload', { json: { u: U, size: 100, chunks: 1, header: '{"v":1}' } });
  check('rq-upload: refused when closed', afterClose.status === 409 && afterClose.json.error === 'closed');
  await call('share', 'rq-close', { json: { id, auth, closed: false } });
  // remove one file, delete request
  check('rq-remove: wrong owner', (await call('share', 'rq-remove', { json: { id, auth: U, file: f0.id } })).status === 403);
  const rm = await call('share', 'rq-remove', { json: { id, auth, file: f0.id } });
  check('rq-remove: file deleted', rm.json.deleted === true && (await call('share', 'get', { auth: f0.ticket, query: `id=${f0.id}&i=0` })).status === 404);
  check('rq-delete: wrong owner', (await call('share', 'rq-delete', { json: { id, auth: U } })).status === 403);
  const del = await call('share', 'rq-delete', { json: { id, auth } });
  check('rq-delete: request + files gone', del.json.deleted === true && (await call('share', 'rq-open', { json: { u: U } })).status === 404
    && ![...store._state.objects.values()].some(o => o.kind === 'req-file'));
  check('rq-status after delete: exists false', (await call('share', 'rq-status', { json: { id, auth } })).json.exists === false);
  // expiry: request + files disappear
  const c2 = await call('share', 'rq-create', { json: { token: deviceToken(), header: reqHeader, expiresIn: 86400 } });
  const u2 = await call('share', 'rq-upload', { json: { u: c2.json.upload, size: 100, chunks: 1, header: '{"v":1}' } });
  check('rq expiry: file expires with the request', u2.json.expiresAt === c2.json.expiresAt);
  offset = 86400e3 + 1000;
  check('rq expiry: link dead after expiry', (await call('share', 'rq-open', { json: { u: c2.json.upload } })).status === 404);
  const ps = store._purge();
  check('rq expiry: purge removes the files', ![...store._state.objects.values()].some(o => o.kind === 'req-file') && store._state.fileReqs.size === 0, JSON.stringify(ps));
  offset = 0;
  // capacity cap (global) and per-request bytes
  process.env.REQ_MAX_MB = '1';
  const c3 = await call('share', 'rq-create', { json: { token: deviceToken(), header: reqHeader, expiresIn: 86400 } });
  const big = await call('share', 'rq-upload', { json: { u: c3.json.upload, size: 2 * 1048576, chunks: 32, header: '{"v":1}' } });
  check('rq-upload: per-request byte limit', big.status === 413 && big.json.error === 'req_bytes', JSON.stringify(big.json));
  delete process.env.REQ_MAX_MB;
  // daily creation limit per device
  process.env.REQ_DEVICE_DAILY = '2';
  const t2 = deviceToken('device-limit-bbbbbbbbbbbb');
  const l1 = await call('share', 'rq-create', { json: { token: t2, header: reqHeader, expiresIn: 86400 }, ip: '198.51.100.9' });
  const l2 = await call('share', 'rq-create', { json: { token: t2, header: reqHeader, expiresIn: 86400 }, ip: '198.51.100.9' });
  const l3 = await call('share', 'rq-create', { json: { token: t2, header: reqHeader, expiresIn: 86400 }, ip: '198.51.100.9' });
  check('rq-create: daily limit per device', l1.status === 200 && l2.status === 200 && l3.status === 429);
  delete process.env.REQ_DEVICE_DAILY;
  check('rq: unknown action', (await call('share', 'rq-nope', { json: {} })).status === 400);
  // supabase adapter param names
  const calls = [];
  const okFetch = async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true }) }; };
  const sb = supabaseShareStore({ supabaseUrl: 'https://x.supabase.co', supabaseKey: 'pk', rpcSecret: 's'.repeat(40) }, { fetchImpl: okFetch });
  await sb.reqUpload({ upload: 'u', id: 'i', owner: 'o', header: 'h', size: 5, chunks: 1, chunkSize: 65536, cap: 9 });
  await sb.reqSet({ id: 'i', owner: 'o', closed: 1 });
  check('supabase: rq param names', calls[0].url.endsWith('/fale_req_upload') && calls[0].body.p_obj_owner === 'o' && calls[0].body.p_upload === 'u' && calls[1].body.p_closed === true);
}

// ---------------------------------------------------------------- SQL file sanity: every RPC used by the adapter exists in the migration
{
  const fs = await import('node:fs');
  const dir = join(ROOT, 'supabase/migrations');
  const sql = fs.readdirSync(dir).filter(f => /share|sign|file_requests/.test(f)).sort().map(f => fs.readFileSync(join(dir, f), 'utf8')).join('\n');
  const src = fs.readFileSync(join(ROOT, 'api/_lib/sharestore.js'), 'utf8');
  const used = [...new Set([...src.matchAll(/rpc\('([a-z_]+)'/g)].map(m => m[1]))];
  const missing = used.filter(f => !new RegExp(`function public\\.${f}\\(`).test(sql));
  check(`SQL: all ${used.length} RPCs defined`, !missing.length, missing.join());
  const granted = used.filter(f => new RegExp(`'public\\.${f}\\(`).test(sql));
  check('SQL: all RPCs granted to anon', granted.length === used.length, used.filter(f => !granted.includes(f)).join());
  check('SQL: RLS on all tables', (sql.match(/enable row level security/g) || []).length === 8);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
