// Crypto unit tests for the Notfallzugang (js/one/crypto.js §12): identity keys (compatible with the family
// folders), EK wraps, ECIES seal/open, Shamir over GF(2^8) incl. edge cases and tampering, safety code.
//   node test_nf_crypto.mjs
import crypto from 'node:crypto';
const K = await import('/home/claude/FalePDF/js/one/crypto.js');
const F = await import('/home/claude/FalePDF/js/smart/famcrypto.js');
let pass = 0, fail = 0;
function check(name, cond, info = '') { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (info !== '' ? '  [' + JSON.stringify(info).slice(0, 400) + ']' : '')); } }
const eq = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
const throwsCode = async (fn, code) => { try { await fn(); return false; } catch (e) { return code ? e.code === code : true; } };
const rb = n => new Uint8Array(crypto.randomBytes(n));

// ---------------------------------------------------------------- GF(2^8)
const slowMul = (a, b) => { let p = 0; for (let i = 0; i < 8; i++) { if (b & 1) p ^= a; const hi = a & 0x80; a = (a << 1) & 0xff; if (hi) a ^= 0x1b; b >>= 1; } return p; };
let gfOk = true;
for (let a = 0; a < 256 && gfOk; a++) for (let b = 0; b < 256; b++) if (K.gfMul(a, b) !== slowMul(a, b)) { gfOk = false; break; }
check('GF(256): table multiplication equals bitwise reference for all 65 536 pairs', gfOk);
let divOk = true;
for (let a = 0; a < 256; a++) for (let b = 1; b < 256; b++) if (K.gfMul(K.gfDiv(a, b), b) !== a) divOk = false;
check('GF(256): division is the inverse of multiplication', divOk);
check('GF(256): division by zero throws', await throwsCode(() => K.gfDiv(5, 0), 'shamir'));

// ---------------------------------------------------------------- Shamir
const secret = rb(32);
const combos = (arr, k, s = 0, cur = [], out = []) => { if (cur.length === k) { out.push(cur.slice()); return out; } for (let i = s; i < arr.length; i++) { cur.push(arr[i]); combos(arr, k, i + 1, cur, out); cur.pop(); } return out; };
let allOk = true;
for (const [n, k] of [[1, 1], [2, 1], [3, 1], [2, 2], [3, 2], [3, 3], [5, 3], [10, 7]]) {
  const sh = K.shamirSplit(secret, n, k);
  for (const set of combos(sh, k)) if (!eq(K.shamirCombine(set), secret)) allOk = false;
  if (k > 1) for (const set of combos(sh, k - 1)) if (eq(K.shamirCombine(set), secret)) allOk = false;
  if (n > k && !eq(K.shamirCombine(sh), secret)) allOk = false; // more than k shares still interpolate correctly
}
check('Shamir: every k-subset recovers, every (k−1)-subset does not, more than k also recovers (n,k up to 10,7)', allOk);
const k1 = K.shamirSplit(secret, 3, 1);
check('Shamir k = 1: every share IS the secret', k1.every(s => eq(s.y, secret)));
const custom = K.shamirSplit(secret, 3, 2, [2, 3, 1]);
check('Shamir: custom x coordinates (contact slots)', custom.map(s => s.x).join() === '2,3,1' && eq(K.shamirCombine([custom[0], custom[2]]), secret));
const twice = [K.shamirSplit(secret, 3, 2), K.shamirSplit(secret, 3, 2)];
check('Shamir: fresh random polynomial each split (shares differ, k ≥ 2)', !eq(twice[0][0].y, twice[1][0].y));
check('Shamir: shares from two different splits do not combine to the secret', !eq(K.shamirCombine([twice[0][0], twice[1][1]]), secret));
// statistical sanity: a single share of a 2-of-n split is uniformly distributed (no bias towards the secret)
const counts = new Array(256).fill(0); const one = new Uint8Array([0x42]);
for (let i = 0; i < 25600; i++) counts[K.shamirSplit(one, 2, 2)[0].y[0]]++;
const chi = counts.reduce((s, c) => s + (c - 100) ** 2 / 100, 0);
check('Shamir: one share alone is uniform (χ² over 25 600 splits < 340)', chi < 340, chi);
check('Shamir: bad parameters rejected (k=0, k>n, n>255, dup x, x=0, x=256, empty secret)',
  await throwsCode(() => K.shamirSplit(secret, 3, 0), 'shamir') && await throwsCode(() => K.shamirSplit(secret, 2, 3), 'shamir') && await throwsCode(() => K.shamirSplit(secret, 256, 2), 'shamir')
  && await throwsCode(() => K.shamirSplit(secret, 2, 2, [1, 1]), 'shamir') && await throwsCode(() => K.shamirSplit(secret, 2, 2, [0, 1]), 'shamir')
  && await throwsCode(() => K.shamirSplit(secret, 2, 2, [1, 256]), 'shamir') && await throwsCode(() => K.shamirSplit(new Uint8Array(0), 2, 2), 'shamir'));
const s3 = K.shamirSplit(secret, 3, 2);
check('Shamir combine: duplicate x, mismatched lengths, empty list and x=0 are rejected',
  await throwsCode(() => K.shamirCombine([s3[0], s3[0]]), 'shamir') && await throwsCode(() => K.shamirCombine([s3[0], { x: 2, y: s3[1].y.subarray(1) }]), 'shamir')
  && await throwsCode(() => K.shamirCombine([]), 'shamir') && await throwsCode(() => K.shamirCombine([{ x: 0, y: s3[0].y }, s3[1]]), 'shamir'));
// tampering: a flipped bit in one share changes the result, and the check value catches it
const owner = crypto.randomUUID(), setupId = crypto.randomUUID();
const ek = rb(32);
const check0 = await K.emCheck(ek, owner, setupId);
const sh = K.shamirSplit(ek, 3, 2);
const bad = { x: sh[1].x, y: sh[1].y.slice() }; bad.y[7] ^= 0x01;
const wrong = K.shamirCombine([sh[0], bad]);
check('Shamir tamper: one flipped bit → wrong key, detected by the check value', !eq(wrong, ek) && await K.emCheck(wrong, owner, setupId) !== check0 && await K.emCheck(K.shamirCombine([sh[0], sh[2]]), owner, setupId) === check0);
const swapped = K.shamirCombine([{ x: sh[0].x, y: sh[1].y }, { x: sh[1].x, y: sh[0].y }]);
check('Shamir tamper: swapped x labels → detected', await K.emCheck(swapped, owner, setupId) !== check0);
check('check value: bound to owner and setup (domain separation)', await K.emCheck(ek, crypto.randomUUID(), setupId) !== check0 && await K.emCheck(ek, owner, crypto.randomUUID()) !== check0 && check0.length === 43);

// ---------------------------------------------------------------- identity keys (shared with the family folders)
const uid = crypto.randomUUID();
const mk = await K.importMasterRaw(rb(32));
const id1 = await K.identityCreate(mk, uid);
check('identity: key id = famcrypto.keyIdOf (same fam_keys record)', id1.kid === await F.keyIdOf(id1.publicJwk) && /^[A-Za-z0-9_-]{16}$/.test(id1.kid), id1.kid);
const famPriv = await F.unwrapPrivate(mk, uid, id1.wrapped);
const gk = rb(32), gid = crypto.randomUUID();
check('identity: wrapped by FaLe One opens in famcrypto (family folders) and works for ECDH', eq(await F.unwrapWith(famPriv, await F.wrapFor(id1.publicJwk, gk, gid, uid), gid, uid), gk));
const famKp = await F.newKeyPair();
const famWrapped = await F.wrapPrivate(mk, uid, famKp.pkcs8);
const oneFromFam = await K.identityOpen(mk, uid, famWrapped);
const sealedF = await K.emSeal(famKp.publicJwk, { purpose: 'share', ownerId: owner, setupId, from: owner, to: uid }, { hello: 1 });
check('identity: a key created by the family folders opens in FaLe One', (await K.emOpen(oneFromFam, { purpose: 'share', ownerId: owner, setupId, from: owner, to: uid }, sealedF)).hello === 1);
check('identity: wrong master key / wrong user id → unwrap error', await throwsCode(async () => K.identityOpen(await K.importMasterRaw(rb(32)), uid, id1.wrapped), 'unwrap') && await throwsCode(() => K.identityOpen(mk, crypto.randomUUID(), id1.wrapped), 'unwrap'));
check('identity: private key is not extractable', id1.privateKey.extractable === false);
check('identity: a public key that does not belong to the private key is detected (server substitution)', await K.identityMatches(id1.privateKey, id1.publicJwk) && !(await K.identityMatches(id1.privateKey, famKp.publicJwk)));

// ---------------------------------------------------------------- ECIES seal / open
const ctx = { purpose: 'share', ownerId: owner, setupId, from: owner, to: uid };
const obj = { v: 1, y: K.b64u(ek), roster: [{ slot: 1 }] };
const sealed = await K.emSeal(id1.publicJwk, ctx, obj);
check('seal/open: round trip', JSON.stringify(await K.emOpen(id1.privateKey, ctx, sealed)) === JSON.stringify(obj));
check('seal: fresh ephemeral key per seal (different ciphertexts)', sealed !== await K.emSeal(id1.publicJwk, ctx, obj));
const id2 = await K.identityCreate(mk, crypto.randomUUID());
check('open: other recipient key → error', await throwsCode(() => K.emOpen(id2.privateKey, ctx, sealed)));
let ctxOk = true;
for (const [k, v] of [['purpose', 'pool'], ['ownerId', crypto.randomUUID()], ['setupId', crypto.randomUUID()], ['from', crypto.randomUUID()], ['to', crypto.randomUUID()]]) {
  if (!(await throwsCode(() => K.emOpen(id1.privateKey, { ...ctx, [k]: v }, sealed)))) ctxOk = false;
}
check('open: every context field is bound (purpose, owner, setup, from, to)', ctxOk);
const u = K.unb64u(sealed);
let flipOk = true;
for (const pos of [0, 5, 66, 70, 90, u.length - 1]) { const t = u.slice(); t[pos] ^= 0x04; if (!(await throwsCode(() => K.emOpen(id1.privateKey, ctx, K.b64u(t))))) flipOk = false; }
check('open: any flipped byte (version, ephemeral key, IV, ciphertext, tag) → error', flipOk);
check('open: truncated → format error', await throwsCode(() => K.emOpen(id1.privateKey, ctx, K.b64u(u.subarray(0, 60))), 'format'));
check('seal: bad purpose / bad public key rejected', await throwsCode(() => K.emSeal(id1.publicJwk, { ...ctx, purpose: 'x' }, obj), 'bad_kind') && await throwsCode(() => K.emSeal({ kty: 'RSA' }, ctx, obj), 'format'));
// known-answer cross-check of the ECIES construction with node:crypto
{
  const recip = crypto.createECDH('prime256v1'); recip.generateKeys();
  const pubRaw = recip.getPublicKey();
  const jwk = { kty: 'EC', crv: 'P-256', x: K.b64u(pubRaw.subarray(1, 33)), y: K.b64u(pubRaw.subarray(33, 65)) };
  const s = K.unb64u(await K.emSeal(jwk, ctx, { a: 'b' }));
  const eph = s.subarray(1, 66);
  const shared = recip.computeSecret(Buffer.from(eph));
  const key = crypto.hkdfSync('sha256', shared, Buffer.from(eph), Buffer.from(`fale-one-v1/em/seal|share|${setupId}|${uid}`), 32);
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key), Buffer.from(s.subarray(66, 78)));
  d.setAAD(Buffer.from(`fale-one-v1|em|seal|share|${owner}|${setupId}|${owner}|${uid}`));
  d.setAuthTag(Buffer.from(s.subarray(s.length - 16)));
  const pt = Buffer.concat([d.update(Buffer.from(s.subarray(78, s.length - 16))), d.final()]).toString();
  check('ECIES known answer: node:crypto (ECDH + HKDF + AES-GCM) decrypts per the contract', pt === '{"a":"b"}', pt);
}

// ---------------------------------------------------------------- EK wraps + scope + owner copy
const keys = await K.deriveKeys(mk, owner);
const nodeId = crypto.uuid ? crypto.uuid() : crypto.randomUUID();
const nk = await K.createNodeKey(keys, nodeId);
const metaSealed = await K.sealMeta(nk.key, { userId: owner, kind: 'file', id: nodeId }, { v: 1, name: 'Testament.pdf' });
const raw = await K.openItemKeyRaw(keys, 'node', nodeId, nk.wrapped);
const wctx = { ownerId: owner, setupId, kind: 'node', id: nodeId };
const emw = await K.emWrapItem(ek, wctx, raw);
raw.fill(0);
const nkViaEm = await K.emOpenItem(ek, wctx, emw);
check('EK wrap: contact opens the node key and decrypts the owner\'s envelope', (await K.openMeta(nkViaEm, { userId: owner, kind: 'file', id: nodeId }, metaSealed)).name === 'Testament.pdf');
check('EK wrap: 82 chars like every wrapped key', emw.length === 82);
let wOk = true;
for (const [k, v] of [['setupId', crypto.randomUUID()], ['ownerId', crypto.randomUUID()], ['kind', 'album'], ['id', crypto.randomUUID()]]) if (!(await throwsCode(() => K.emOpenItem(ek, { ...wctx, [k]: v }, emw)))) wOk = false;
check('EK wrap: bound to setup, owner, kind and id; wrong EK fails', wOk && await throwsCode(() => K.emOpenItem(rb(32), wctx, emw), 'unwrap'));
const ownerCopy = await K.emOwnerWrap(keys, setupId, ek);
check('owner copy of EK: opens with KEK only for this setup', eq(await K.emOwnerOpen(keys, setupId, ownerCopy), ek) && await throwsCode(() => K.emOwnerOpen(keys, crypto.randomUUID(), ownerCopy), 'unwrap')
  && await throwsCode(() => K.emOpenItem(ek, wctx, nk.wrapped))); // KEK-wrapped key is not an EK wrap
const sc = await K.emSealScope(ek, { ownerId: owner, setupId }, { v: 1, mode: 'items', roots: [nodeId] });
check('scope envelope: round trip, bound to owner+setup', (await K.emOpenScope(ek, { ownerId: owner, setupId }, sc)).roots[0] === nodeId && await throwsCode(() => K.emOpenScope(ek, { ownerId: crypto.randomUUID(), setupId }, sc)));
check('EK: wrong length rejected', await throwsCode(() => K.emWrapItem(rb(31), wctx, rb(32)), 'format'));

// ---------------------------------------------------------------- safety code
const base = { setupId, ownerId: owner, ownerKid: id1.kid, contactId: uid, contactKid: id2.kid };
const a1 = await K.safetyCode(base), a2 = await K.safetyCode({ ...base });
check('safety code: deterministic, 6 emoji + 12 digits', a1.digits === a2.digits && a1.emoji.length === 6 && /^\d{4} \d{4} \d{4}$/.test(a1.digits) && a1.emoji.every(e => K.SAS_EMOJI.includes(e)));
let diff = true;
for (const k of Object.keys(base)) { const c = await K.safetyCode({ ...base, [k]: k.endsWith('Kid') ? (await K.identityCreate(mk, uid)).kid : crypto.randomUUID() }); if (c.digits === a1.digits && c.emoji.map(e => e[0]).join() === a1.emoji.map(e => e[0]).join()) diff = false; }
check('safety code: any substituted key id or id changes both emoji and digits', diff);
check('safety code: 64 distinct emoji with German + English names', K.SAS_EMOJI.length === 64 && new Set(K.SAS_EMOJI.map(e => e[0])).size === 64 && K.SAS_EMOJI.every(e => e[1] && e[2]));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
