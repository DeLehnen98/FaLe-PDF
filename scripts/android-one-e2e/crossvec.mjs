// FaLe One – Java ↔ JS crypto cross-test vectors (Node ≥ 20). The JS side is the web worker's own code
// (one/js/shared/one/crypto.js, a synced copy of js/one/crypto.js); the Java side is FaleCrypto via
// CryptoSelfTest (one-android/native/debug/java). Used by crypto-cross.mjs (JVM) and smoke.mjs (emulator).
//
//   const vec = await makeVectors();               // JS-sealed vectors (+ the expected plaintexts)
//   const out = <Java: CryptoSelfTest.run(vec)>;  // checks + Java-sealed vectors
//   const problems = await checkJava(vec, out);   // [] when every Java check passed and JS opens Java's output
import * as K from '../../one/js/shared/one/crypto.js';

const te = new TextEncoder(), td = new TextDecoder();
export const DATA_LEN = 4 * 1024 * 1024 + 12345;
/** Same deterministic content as CryptoSelfTest.data(). */
export function testData() {
  const d = new Uint8Array(DATA_LEN);
  for (let i = 0; i < d.length; i++) d[i] = (i * 31 + (i >>> 8) * 7 + (i >>> 16)) & 255;
  return d;
}
const HKDF = (mk, userId, info) => globalThis.crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: te.encode(`fale-one-v1|${userId}`), info: te.encode(info) }, mk, 256).then(b => new Uint8Array(b));

/** JS-sealed vectors. mkRaw: optional 32 bytes (else random). */
export async function makeVectors({ mkRaw } = {}) {
  mkRaw = mkRaw || K.rnd(32);
  const userId = K.uuid();
  const mk = await K.importMasterRaw(mkRaw);
  const keys = await K.deriveKeys(mk, userId);
  const kek = await HKDF(mk, userId, 'fale-one-v1/kek'), dk = await HKDF(mk, userId, 'fale-one-v1/dedupe'), dvk = await HKDF(mk, userId, 'fale-one-v1/device');
  const nodeId = K.uuid(), revId = K.uuid(), blobId = K.uuid(), deviceId = K.b64u(K.rnd(18));
  const nk = await K.createNodeKey(keys, nodeId);
  const nodeRaw = await K.openItemKeyRaw(keys, 'node', nodeId, nk.wrapped);
  const fk = await K.createFileKey(nk.key, { userId, nodeId, revId });
  // the raw file key is never exposed by crypto.js: unwrap it here exactly like openFileKey does
  const wk = await globalThis.crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: te.encode('fale-one-v1/filewrap') }, await K.importMasterRaw(nodeRaw), { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const fu = K.unb64u(fk.wrapped);
  const fileRaw = new Uint8Array(await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: fu.subarray(1, 13), additionalData: te.encode(`fale-one-v1|wrap|file|${userId}|${nodeId}|${revId}`) }, wk, fu.subarray(13)));
  const meta = { v: 1, name: 'Größe ÄÖÜ ß – 東京 😀.jpg', takenAt: '2026-05-01T10:15:00+02:00', gps: { lat: 49.2354, lon: 6.9969, alt: 231.5 }, exif: { make: 'FaLe', model: 'E2E', iso: 100 } };
  const rmeta = { v: 1, size: 12345, mime: 'image/jpeg', mtime: 1777630500000, digest: 'ab'.repeat(32), thumb: { mime: 'image/jpeg', w: 256, h: 192 } };
  const device = { v: 1, name: 'FaLe One · Android', platform: 'android', app: 'one-1.0.0' };
  const vec = {
    userId, mk: K.b64u(mkRaw), kek: K.b64u(kek), dk: K.b64u(dk), dvk: K.b64u(dvk),
    nodeId, revId, blobId, deviceId, purpose: 'content',
    nodeWrapped: nk.wrapped, nodeRaw: K.b64u(nodeRaw), fileWrapped: fk.wrapped, fileRaw: K.b64u(fileRaw),
    metaKind: 'photo', metaJson: K.b64u(te.encode(JSON.stringify(meta))), metaSealed: await K.sealMeta(nk.key, { userId, kind: 'photo', id: nodeId }, meta),
    rmetaJson: K.b64u(te.encode(JSON.stringify(rmeta))), rmetaSealed: await K.sealRevMeta(fk.key, { userId, nodeId, revId }, rmeta),
    deviceJson: K.b64u(te.encode(JSON.stringify(device))), deviceSealed: await K.sealDeviceMeta(keys, deviceId, device),
  };
  const n = 3;
  vec.n = String(n);
  const bk = await K.blobKey(fk.key, blobId, 'content');
  for (let i = 0; i < n; i++) {
    const plain = K.rnd(i === n - 1 ? 5 : 4096);
    vec['plain' + i] = K.b64u(plain);
    vec['chunk' + i] = K.b64u(await K.sealChunk(bk, { userId, nodeId, revId, blobId, purpose: 'content' }, i, n, plain));
  }
  const dig = await K.contentDigest(testData());
  vec.digest = K.hex(dig);
  vec.dedupe = await K.dedupeHash(keys, dig);
  vec.emptyDigest = K.hex(await K.contentDigest(new Uint8Array(0)));
  const lay = K.layout(DATA_LEN, 1048576);
  vec.layoutSize = String(DATA_LEN); vec.layoutChunk = '1048576'; vec.layout = `${lay.chunks}/${lay.plainChunk}/${lay.cipherSize}`;
  return vec;
}

/** Problems with Java's answer: failed Java checks, or Java-sealed data the JS code cannot open. */
export async function checkJava(vec, out) {
  const problems = [];
  const checks = Object.entries(out).filter(([k]) => k.startsWith('check.'));
  if (checks.length < 9) problems.push(`nur ${checks.length} Java-Prüfungen`);
  for (const [k, v] of checks) if (v !== 'ok') problems.push(`${k.slice(6)}: ${v}`);
  if (!out['j.nodeId']) { problems.push('keine Java-Vektoren'); return problems; }
  const userId = vec.userId;
  const keys = await K.deriveKeys(await K.importMasterRaw(K.unb64u(vec.mk)), userId);
  const nodeId = out['j.nodeId'], revId = out['j.revId'], blobId = out['j.blobId'];
  const step = async (name, fn) => { try { const r = await fn(); if (r) problems.push(`${name}: ${r}`); } catch (e) { problems.push(`${name}: ${e.code || ''} ${e.message}`); } };
  const eqBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  let nk, fk;
  await step('java.nodeKey', async () => {
    const raw = await K.openItemKeyRaw(keys, 'node', nodeId, out['j.nodeWrapped']);
    if (!eqBytes(raw, K.unb64u(out['j.nodeRaw']))) return 'Rohschlüssel weicht ab';
    nk = await K.openNodeKey(keys, nodeId, out['j.nodeWrapped']);
  });
  await step('java.meta', async () => {
    const m = await K.openMeta(nk, { userId, kind: 'photo', id: nodeId }, out['j.metaSealed']);
    if (JSON.stringify(m) !== JSON.stringify(JSON.parse(td.decode(K.unb64u(out['j.metaJson']))))) return 'Inhalt weicht ab: ' + JSON.stringify(m);
  });
  await step('java.fileKey', async () => { fk = await K.openFileKey(nk, { userId, nodeId, revId }, out['j.fileWrapped']); });
  await step('java.rmeta', async () => {
    const m = await K.openRevMeta(fk, { userId, nodeId, revId }, out['j.rmetaSealed']);
    if (JSON.stringify(m) !== JSON.stringify(JSON.parse(td.decode(K.unb64u(out['j.rmetaJson']))))) return 'Inhalt weicht ab';
  });
  await step('java.chunks', async () => {
    const n = Number(out['j.n']);
    const bk = await K.blobKey(fk, blobId, 'content');
    for (let i = 0; i < n; i++) {
      const p = await K.openChunk(bk, { userId, nodeId, revId, blobId, purpose: 'content' }, i, n, K.unb64u(out['j.chunk' + i]));
      if (!eqBytes(p, K.unb64u(out['j.plain' + i]))) return `Teil ${i} weicht ab`;
    }
    // the final flag is authenticated: chunk n-1 must not open as a non-final chunk
    try { await K.openChunk(bk, { userId, nodeId, revId, blobId, purpose: 'content' }, n - 1, n + 1, K.unb64u(out['j.chunk' + (n - 1)])); return 'Kürzung nicht erkannt'; } catch { /* expected */ }
  });
  await step('java.thumb', async () => {
    const p = await K.openSmall(fk, { userId, nodeId, revId, blobId: out['j.thumbId'], purpose: 'thumb' }, K.unb64u(out['j.thumbSealed']));
    if (!eqBytes(p, K.unb64u(out['j.thumbPlain']))) return 'Vorschaubild weicht ab';
  });
  await step('java.device', async () => {
    const m = await K.openDeviceMeta(keys, vec.deviceId, out['j.deviceSealed']);
    if (m.platform !== 'android' || m.name !== 'Pixel · Android') return JSON.stringify(m);
  });
  await step('java.digest', async () => {
    if (out['j.digest'] !== vec.digest) return 'Prüfsumme ' + out['j.digest'];
    if (out['j.dedupe'] !== vec.dedupe) return 'Dedupe-Hash ' + out['j.dedupe'];
  });
  await step('java.uuid', async () => { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(out['j.uuid'])) return out['j.uuid']; });
  return problems;
}
