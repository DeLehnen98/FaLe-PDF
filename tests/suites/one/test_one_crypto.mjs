// Unit tests for js/one/crypto.js (WebCrypto in Node): formats, key hierarchy binding, tamper detection.
//   node test_one_crypto.mjs
import crypto from 'node:crypto';
const K = await import('/home/claude/FalePDF/js/one/crypto.js');
const Sync = await import('/home/claude/FalePDF/js/sync/crypto.js');
let pass = 0, fail = 0;
function check(name, cond, info = '') { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (info !== '' ? '  [' + JSON.stringify(info).slice(0, 400) + ']' : '')); } }
const rejects = async (p, code) => { try { await p; return false; } catch (e) { return code ? e.code === code : true; } };
const bytes = n => new Uint8Array(crypto.randomBytes(n));
const eq = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

const U1 = crypto.randomUUID(), U2 = crypto.randomUUID();
const mkRaw = bytes(32);
const mk = await K.importMasterRaw(mkRaw);
const keys = await K.deriveKeys(mk, U1);

// --- master key from FaLe Sync is usable as is
const syncMk = await Sync.importMaster(mkRaw);
const keys2 = await K.deriveKeys(syncMk.key, U1);
const n0 = crypto.randomUUID();
const w0 = await K.createNodeKey(keys, n0);
check('MK imported by js/sync/crypto.js (importMaster) derives the same One keys', !!(await K.openNodeKey(keys2, n0, w0.wrapped)));

// --- wrapped key format
check('wrapped key: 61 bytes → 82 base64url chars, version byte 1', w0.wrapped.length === 82 && K.unb64u(w0.wrapped)[0] === 1 && K.unb64u(w0.wrapped).length === 61);
const n1 = crypto.randomUUID();
check('node key bound to its node id (swap → unwrap error)', await rejects(K.openNodeKey(keys, n1, w0.wrapped), 'unwrap'));
check('node key bound to the account (other user id → error)', await rejects(K.openNodeKey(await K.deriveKeys(mk, U2), n0, w0.wrapped), 'unwrap'));
check('node vs album key domains separated', await rejects(K.openAlbumKey(keys, n0, w0.wrapped), 'unwrap'));
check('other master key → unwrap error', await rejects(K.openNodeKey(await K.deriveKeys(await K.importMasterRaw(bytes(32)), U1), n0, w0.wrapped), 'unwrap'));
const tamperedKey = K.unb64u(w0.wrapped); tamperedKey[20] ^= 1;
check('tampered wrapped key → error', await rejects(K.openNodeKey(keys, n0, K.b64u(tamperedKey)), 'unwrap'));
check('ids must be lowercase UUIDs (AAD canonical form)', await rejects(K.createNodeKey(keys, n0.toUpperCase()), 'bad_id'));

// --- metadata
const nk = await K.openNodeKey(keys, n0, w0.wrapped);
const meta = { v: 1, name: 'Größe & Ümlaute 📷.jpg', takenAt: '2026-07-14T10:22:00+02:00', gps: { lat: 54.123456, lon: 7.9 } };
const sm = await K.sealMeta(nk, { userId: U1, kind: 'photo', id: n0 }, meta);
check('meta round trip (UTF-8, nested)', JSON.stringify(await K.openMeta(nk, { userId: U1, kind: 'photo', id: n0 }, sm)) === JSON.stringify(meta));
check('meta envelope is base64url, version 1', /^[A-Za-z0-9_-]+$/.test(sm) && K.unb64u(sm)[0] === 1);
check('meta bound to kind (photo→file swap fails)', await rejects(K.openMeta(nk, { userId: U1, kind: 'file', id: n0 }, sm), 'decrypt'));
check('meta bound to node id', await rejects(K.openMeta(nk, { userId: U1, kind: 'photo', id: n1 }, sm), 'decrypt'));
const s2 = await K.sealMeta(nk, { userId: U1, kind: 'photo', id: n0 }, meta);
check('meta uses a fresh IV each time', s2 !== sm);

// --- file key + revision meta
const r0 = crypto.randomUUID(), r1 = crypto.randomUUID();
const fk = await K.createFileKey(nk, { userId: U1, nodeId: n0, revId: r0 });
check('file key bound to revision id', await rejects(K.openFileKey(nk, { userId: U1, nodeId: n0, revId: r1 }, fk.wrapped), 'unwrap'));
check('file key needs the node key', await rejects(K.openFileKey(await K.openNodeKey(keys, n1, (await K.createNodeKey(keys, n1)).wrapped), { userId: U1, nodeId: n0, revId: r0 }, fk.wrapped), 'unwrap'));
const rm = await K.sealRevMeta(fk.key, { userId: U1, nodeId: n0, revId: r0 }, { v: 1, size: 5, mime: 'text/plain' });
check('rev meta round trip', (await K.openRevMeta(await K.openFileKey(nk, { userId: U1, nodeId: n0, revId: r0 }, fk.wrapped), { userId: U1, nodeId: n0, revId: r0 }, rm)).size === 5);

// --- chunks
const CS = 65536;
const L = K.layout(200000, CS);
check('layout: plain chunk = chunk − 28, chunks, cipher size', L.plainChunk === CS - 28 && L.chunks === 4 && L.cipherSize === 200000 + 4 * 28);
check('layout: empty file = 1 chunk of 28 bytes', K.layout(0, CS).chunks === 1 && K.layout(0, CS).cipherSize === 28);
check('layout: exact multiple has no extra chunk', K.layout(2 * (CS - 28), CS).chunks === 2);
const b0 = crypto.randomUUID(), b1 = crypto.randomUUID();
const ctx = { userId: U1, nodeId: n0, revId: r0, blobId: b0, purpose: 'content' };
const bk = await K.blobKey(fk.key, b0, 'content');
const plain = bytes(200000);
const sealed = [];
for (let i = 0; i < L.chunks; i++) sealed.push(await K.sealChunk(bk, ctx, i, L.chunks, plain.subarray(i * L.plainChunk, (i + 1) * L.plainChunk)));
check('ciphertext chunk sizes: full chunks exactly chunkSize, last = rest + 28', sealed.slice(0, -1).every(c => c.length === CS) && sealed.at(-1).length === 200000 - 3 * L.plainChunk + 28);
const outs = [];
for (let i = 0; i < L.chunks; i++) outs.push(await K.openChunk(bk, ctx, i, L.chunks, sealed[i]));
check('chunks round trip', eq(Buffer.concat(outs.map(Buffer.from)), plain));
check('reordering detected (chunk 1 at index 0)', await rejects(K.openChunk(bk, ctx, 0, L.chunks, sealed[1]), 'decrypt'));
check('truncation detected (count 3 instead of 4: chunk 2 claimed as final)', await rejects(K.openChunk(bk, ctx, 2, 3, sealed[2]), 'decrypt'));
check('extension detected (count 5)', await rejects(K.openChunk(bk, ctx, 3, 5, sealed[3]), 'decrypt'));
check('chunk moved to another blob detected', await rejects(K.openChunk(await K.blobKey(fk.key, b1, 'content'), { ...ctx, blobId: b1 }, 0, L.chunks, sealed[0]), 'decrypt'));
check('content vs thumb domain separated', await rejects(K.openChunk(await K.blobKey(fk.key, b0, 'thumb'), { ...ctx, purpose: 'thumb' }, 0, L.chunks, sealed[0]), 'decrypt'));
check('chunk moved to another revision detected', await rejects(K.openChunk(bk, { ...ctx, revId: r1 }, 0, L.chunks, sealed[0]), 'decrypt'));
const flip = sealed[0].slice(); flip[100] ^= 0x80;
check('bit flip detected', await rejects(K.openChunk(bk, ctx, 0, L.chunks, flip), 'decrypt'));
const again = await K.sealChunk(bk, ctx, 0, L.chunks, plain.subarray(0, L.plainChunk));
check('re-encrypting a chunk uses a fresh random IV (safe retries/resume)', !eq(again.subarray(0, 12), sealed[0].subarray(0, 12)));
const th = bytes(4000);
const st = await K.sealSmall(fk.key, { ...ctx, blobId: b1, purpose: 'thumb' }, th);
check('thumbnail (single chunk) round trip', eq(await K.openSmall(fk.key, { ...ctx, blobId: b1, purpose: 'thumb' }, st), th));

// --- digest + dedupe
const d1 = await K.contentDigest(plain);
const d2 = await K.contentDigest(new Blob([plain]));
check('content digest: Uint8Array and Blob agree', eq(d1, d2));
const big = bytes(9 * 1024 * 1024);
const manual = new Uint8Array(await crypto.webcrypto.subtle.digest('SHA-256', Buffer.concat([0, 1, 2].map(i => crypto.createHash('sha256').update(big.subarray(i * 4194304, (i + 1) * 4194304)).digest()))));
check('content digest = SHA-256 over SHA-256 of 4 MiB segments', eq(await K.contentDigest(big), manual));
const h1 = await K.dedupeHash(keys, d1);
check('dedupe hash: 43 chars base64url, deterministic per account', h1.length === 43 && h1 === await K.dedupeHash(keys2, d1));
check('dedupe hash differs between accounts', h1 !== await K.dedupeHash(await K.deriveKeys(mk, U2), d1));
check('dedupe hash differs from the plain digest (keyed)', h1 !== K.b64u(d1).slice(0, 43));

// --- device meta
const dev = 'device-aaaaaaaaaaaaaaaa';
const dm = await K.sealDeviceMeta(keys, dev, { name: 'Pixel' });
check('device meta round trip, bound to device id', (await K.openDeviceMeta(keys, dev, dm)).name === 'Pixel' && await rejects(K.openDeviceMeta(keys, 'other-aaaaaaaaaaaaaaaa', dm)));

// --- known-answer test of the derivation (pins the format: fixed MK, user, node, IV-independent parts)
{
  const fixedMk = await K.importMasterRaw(new Uint8Array(32).fill(7));
  const fk2 = await K.deriveKeys(fixedMk, '00000000-0000-4000-8000-000000000001');
  const h = await K.dedupeHash(fk2, new Uint8Array(32));
  // independent recomputation with node:crypto HKDF + HMAC
  const dk = crypto.hkdfSync('sha256', Buffer.alloc(32, 7), Buffer.from('fale-one-v1|00000000-0000-4000-8000-000000000001'), Buffer.from('fale-one-v1/dedupe'), 32);
  const want = crypto.createHmac('sha256', Buffer.from(dk)).update(Buffer.concat([Buffer.from('fale-one-v1|dedupe|'), Buffer.alloc(32)])).digest('base64url');
  check('KAT: DK = HKDF(MK, "fale-one-v1|<user>", "fale-one-v1/dedupe"); hash = HMAC(DK, "fale-one-v1|dedupe|" ‖ digest)', h === want, [h, want]);
  // KEK + wrapped key decryptable with node:crypto (documented format: 0x01 ‖ IV ‖ ct ‖ tag, AAD string)
  const nid = '00000000-0000-4000-8000-0000000000aa';
  const w = await K.createNodeKey(fk2, nid);
  const kek = Buffer.from(crypto.hkdfSync('sha256', Buffer.alloc(32, 7), Buffer.from('fale-one-v1|00000000-0000-4000-8000-000000000001'), Buffer.from('fale-one-v1/kek'), 32));
  const u = Buffer.from(K.unb64u(w.wrapped));
  const d = crypto.createDecipheriv('aes-256-gcm', kek, u.subarray(1, 13));
  d.setAAD(Buffer.from('fale-one-v1|wrap|node|00000000-0000-4000-8000-000000000001|' + nid));
  d.setAuthTag(u.subarray(u.length - 16));
  let rawNk = null;
  try { rawNk = Buffer.concat([d.update(u.subarray(13, u.length - 16)), d.final()]); } catch {}
  check('KAT: wrapped node key opens with an independent AES-GCM implementation (format as documented)', rawNk && rawNk.length === 32);
  // chunk decryptable independently: BK = HKDF(FK, blobId, "fale-one-v1/blob/content"), AAD string
  if (rawNk) {
    const nodeKey = await K.openNodeKey(fk2, nid, w.wrapped);
    const rid = '00000000-0000-4000-8000-0000000000bb', bid = '00000000-0000-4000-8000-0000000000cc';
    const f = await K.createFileKey(nodeKey, { userId: '00000000-0000-4000-8000-000000000001', nodeId: nid, revId: rid });
    const wk = Buffer.from(crypto.hkdfSync('sha256', rawNk, Buffer.alloc(0), Buffer.from('fale-one-v1/filewrap'), 32));
    const fu = Buffer.from(K.unb64u(f.wrapped));
    const d2 = crypto.createDecipheriv('aes-256-gcm', wk, fu.subarray(1, 13));
    d2.setAAD(Buffer.from(`fale-one-v1|wrap|file|00000000-0000-4000-8000-000000000001|${nid}|${rid}`)); d2.setAuthTag(fu.subarray(fu.length - 16));
    const rawFk = Buffer.concat([d2.update(fu.subarray(13, fu.length - 16)), d2.final()]);
    const c = { userId: '00000000-0000-4000-8000-000000000001', nodeId: nid, revId: rid, blobId: bid, purpose: 'content' };
    const ch = Buffer.from(await K.sealChunk(await K.blobKey(f.key, bid, 'content'), c, 0, 1, new TextEncoder().encode('hallo')));
    const bkRaw = Buffer.from(crypto.hkdfSync('sha256', rawFk, Buffer.from(bid), Buffer.from('fale-one-v1/blob/content'), 32));
    const d3 = crypto.createDecipheriv('aes-256-gcm', bkRaw, ch.subarray(0, 12));
    d3.setAAD(Buffer.from(`fale-one-v1|chunk|${c.userId}|${nid}|${rid}|${bid}|content|0|1|1`)); d3.setAuthTag(ch.subarray(ch.length - 16));
    const pt = Buffer.concat([d3.update(ch.subarray(12, ch.length - 16)), d3.final()]).toString();
    check('KAT: chunk = IV ‖ ct ‖ tag with the documented key derivation and AAD', pt === 'hallo', pt);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
