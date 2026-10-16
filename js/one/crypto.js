// FaLe One – client-side encryption (WebCrypto only, no dependencies). Works in browsers and Node ≥ 20.
// Normative description: docs/FALE-ONE-API.md §5 ("Crypto"). Changing anything here is a format change (v1).
//
// Key hierarchy (everything below MK is derived or wrapped on the device; the server only stores wrapped keys):
//   MK   FaLe-Konto master key (js/sync/crypto.js: 32 random bytes, wrapped by Sync-Passwort + recovery key),
//        held as a non-extractable HKDF CryptoKey.
//   KEK  = HKDF-SHA256(MK, salt = "fale-one-v1|<userId>", info = "fale-one-v1/kek")     → AES-256-GCM (wraps node/album keys)
//   DK   = HKDF-SHA256(MK, same salt, info = "fale-one-v1/dedupe")                    → HMAC-SHA256 (keyed content hash)
//   DVK  = HKDF-SHA256(MK, same salt, info = "fale-one-v1/device")                    → AES-256-GCM (backup device names)
//   NK   node key, 32 random bytes per folder/file/photo; stored as wrap(KEK, NK, AAD "fale-one-v1|wrap|node|<user>|<node>")
//   AK   album key, 32 random bytes per album;          stored as wrap(KEK, AK, AAD "fale-one-v1|wrap|album|<user>|<album>")
//   FK   file key, 32 random bytes per REVISION;        stored as wrap(HKDF(NK, "fale-one-v1/filewrap"), FK,
//                                                        AAD "fale-one-v1|wrap|file|<user>|<node>|<rev>")
//   meta  envelope = AES-GCM(HKDF(NK|AK, "fale-one-v1/meta"), JSON, AAD "fale-one-v1|meta|<kind>|<user>|<id>")
//   rmeta envelope = AES-GCM(HKDF(FK, "fale-one-v1/rmeta"), JSON, AAD "fale-one-v1|rmeta|<user>|<node>|<rev>")
//   blob key BK   = HKDF(FK, salt = "<blobId>", info = "fale-one-v1/blob/<purpose>")   purpose: content | thumb | preview
//   chunk  = IV(12, random) ‖ AES-GCM(BK, plain, AAD "fale-one-v1|chunk|<user>|<node>|<rev>|<blob>|<purpose>|<i>|<n>|<final 0/1>")
// Formats: wrapped key = 0x01 ‖ IV(12) ‖ GCM(32-byte key) = 61 bytes; envelope = 0x01 ‖ IV(12) ‖ GCM(UTF-8 JSON);
// both base64url without padding. All ids are lowercase UUID strings exactly as the server stores them.
const te = new TextEncoder();
const td = new TextDecoder();
export const V = 'fale-one-v1';
export const TAG = 16;
export const IV_LEN = 12;
export const CHUNK_OVERHEAD = IV_LEN + TAG; // 28 bytes per chunk
export const SEGMENT = 4 * 1024 * 1024;     // content digest segment (independent of the upload chunk size)

export class OneCryptoError extends Error {
  constructor(code, msg) { super(msg || code); this.code = code; }
}
const subtle = () => {
  if (!globalThis.crypto || !globalThis.crypto.subtle) throw new OneCryptoError('no_crypto', 'Verschlüsselung ist hier nicht verfügbar (sichere Verbindung nötig).');
  return globalThis.crypto.subtle;
};

// ---------------------------------------------------------------- encoding helpers
export function b64u(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64u(s) {
  const t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '==='.slice((t.length + 3) % 4));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
export const rnd = n => globalThis.crypto.getRandomValues(new Uint8Array(n));
export const uuid = () => globalThis.crypto.randomUUID();
export const hex = u => Array.from(u, b => b.toString(16).padStart(2, '0')).join('');
const aad = (...parts) => te.encode([V, ...parts].join('|'));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function needId(id, what) { if (typeof id !== 'string' || !UUID_RE.test(id)) throw new OneCryptoError('bad_id', `invalid ${what}`); return id; }

// ---------------------------------------------------------------- derivation
const AES = { name: 'AES-GCM', length: 256 };
async function hkdfKey(base, salt, info, alg, usages) {
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: te.encode(info) }, base, alg, false, usages);
}
/** Raw 32-byte master key → non-extractable HKDF CryptoKey (tests / devices that unwrap MK themselves). */
export async function importMasterRaw(raw) {
  return subtle().importKey('raw', raw, 'HKDF', false, ['deriveKey', 'deriveBits']);
}
async function importBase(raw) { return subtle().importKey('raw', raw, 'HKDF', false, ['deriveKey', 'deriveBits']); }

/** Account-level keys for FaLe One from the FaLe-Konto master key (HKDF CryptoKey). */
export async function deriveKeys(mk, userId) {
  if (typeof userId !== 'string' || !userId) throw new OneCryptoError('bad_id', 'invalid user id');
  const salt = te.encode(`${V}|${userId}`);
  const [kek, dedupe, device] = await Promise.all([
    hkdfKey(mk, salt, `${V}/kek`, AES, ['encrypt', 'decrypt']),
    hkdfKey(mk, salt, `${V}/dedupe`, { name: 'HMAC', hash: 'SHA-256', length: 256 }, ['sign']),
    hkdfKey(mk, salt, `${V}/device`, AES, ['encrypt', 'decrypt']),
  ]);
  return { userId, kek, dedupe, device };
}

// ---------------------------------------------------------------- AES-GCM envelopes
async function gcmSeal(key, plain, ad) {
  const iv = rnd(IV_LEN);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: ad }, key, plain));
  const out = new Uint8Array(1 + IV_LEN + ct.length); out[0] = 1; out.set(iv, 1); out.set(ct, 1 + IV_LEN);
  return out;
}
async function gcmOpen(key, sealed, ad, code = 'decrypt') {
  if (!(sealed instanceof Uint8Array) || sealed[0] !== 1 || sealed.length < 1 + IV_LEN + TAG) throw new OneCryptoError('format', 'unknown format');
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: sealed.subarray(1, 1 + IV_LEN), additionalData: ad }, key, sealed.subarray(1 + IV_LEN)));
  } catch { throw new OneCryptoError(code, 'decryption failed (wrong key or manipulated data)'); }
}

// ---------------------------------------------------------------- wrapped keys (node / album / file)
async function wrapRaw(wrappingKey, raw, ad) { return b64u(await gcmSeal(wrappingKey, raw, ad)); }
async function unwrapRaw(wrappingKey, wrapped, ad) {
  let u;
  try { u = unb64u(wrapped); } catch { throw new OneCryptoError('format', 'bad key'); }
  if (u.length !== 1 + IV_LEN + 32 + TAG) throw new OneCryptoError('format', 'bad key length');
  return gcmOpen(wrappingKey, u, ad, 'unwrap');
}

/** New random key for a node ('node') or an album ('album'). → { key: HKDF CryptoKey, wrapped: string } */
export async function createItemKey(keys, kind, id) {
  if (kind !== 'node' && kind !== 'album') throw new OneCryptoError('bad_kind', 'kind must be node|album');
  needId(id, kind + ' id');
  const raw = rnd(32);
  try {
    const wrapped = await wrapRaw(keys.kek, raw, aad('wrap', kind, keys.userId, id));
    return { key: await importBase(raw), wrapped };
  } finally { raw.fill(0); }
}
export async function openItemKey(keys, kind, id, wrapped) {
  const raw = await unwrapRaw(keys.kek, wrapped, aad('wrap', kind, keys.userId, needId(id, kind + ' id')));
  try { return await importBase(raw); } finally { raw.fill(0); }
}
export const createNodeKey = (keys, nodeId) => createItemKey(keys, 'node', nodeId);
export const openNodeKey = (keys, nodeId, wrapped) => openItemKey(keys, 'node', nodeId, wrapped);
export const createAlbumKey = (keys, albumId) => createItemKey(keys, 'album', albumId);
export const openAlbumKey = (keys, albumId, wrapped) => openItemKey(keys, 'album', albumId, wrapped);

/** New file key for one revision, wrapped by the node key. ctx: { userId, nodeId, revId } */
export async function createFileKey(nodeKey, ctx) {
  const wk = await hkdfKey(nodeKey, new Uint8Array(0), `${V}/filewrap`, AES, ['encrypt', 'decrypt']);
  const raw = rnd(32);
  try {
    const wrapped = await wrapRaw(wk, raw, aad('wrap', 'file', ctx.userId, needId(ctx.nodeId, 'node id'), needId(ctx.revId, 'revision id')));
    return { key: await importBase(raw), wrapped };
  } finally { raw.fill(0); }
}
export async function openFileKey(nodeKey, ctx, wrapped) {
  const wk = await hkdfKey(nodeKey, new Uint8Array(0), `${V}/filewrap`, AES, ['encrypt', 'decrypt']);
  const raw = await unwrapRaw(wk, wrapped, aad('wrap', 'file', ctx.userId, needId(ctx.nodeId, 'node id'), needId(ctx.revId, 'revision id')));
  try { return await importBase(raw); } finally { raw.fill(0); }
}

// ---------------------------------------------------------------- metadata envelopes
const META_KINDS = ['folder', 'file', 'photo', 'album'];
/** Node / album metadata. ctx: { userId, kind: folder|file|photo|album, id } */
export async function sealMeta(itemKey, ctx, obj) {
  if (!META_KINDS.includes(ctx.kind)) throw new OneCryptoError('bad_kind', 'bad kind');
  const k = await hkdfKey(itemKey, new Uint8Array(0), `${V}/meta`, AES, ['encrypt']);
  return b64u(await gcmSeal(k, te.encode(JSON.stringify(obj)), aad('meta', ctx.kind, ctx.userId, needId(ctx.id, 'id'))));
}
export async function openMeta(itemKey, ctx, sealed) {
  const k = await hkdfKey(itemKey, new Uint8Array(0), `${V}/meta`, AES, ['decrypt']);
  return JSON.parse(td.decode(await gcmOpen(k, unb64u(sealed), aad('meta', ctx.kind, ctx.userId, needId(ctx.id, 'id')))));
}
/** Revision metadata (plaintext size, MIME type, mtime, digest …). ctx: { userId, nodeId, revId } */
export async function sealRevMeta(fileKey, ctx, obj) {
  const k = await hkdfKey(fileKey, new Uint8Array(0), `${V}/rmeta`, AES, ['encrypt']);
  return b64u(await gcmSeal(k, te.encode(JSON.stringify(obj)), aad('rmeta', ctx.userId, needId(ctx.nodeId, 'node id'), needId(ctx.revId, 'revision id'))));
}
export async function openRevMeta(fileKey, ctx, sealed) {
  const k = await hkdfKey(fileKey, new Uint8Array(0), `${V}/rmeta`, AES, ['decrypt']);
  return JSON.parse(td.decode(await gcmOpen(k, unb64u(sealed), aad('rmeta', ctx.userId, needId(ctx.nodeId, 'node id'), needId(ctx.revId, 'revision id')))));
}
/** Backup device record (device name / platform), keyed by the account. */
export async function sealDeviceMeta(keys, deviceId, obj) {
  return b64u(await gcmSeal(keys.device, te.encode(JSON.stringify(obj)), aad('device', keys.userId, deviceId)));
}
export async function openDeviceMeta(keys, deviceId, sealed) {
  return JSON.parse(td.decode(await gcmOpen(keys.device, unb64u(sealed), aad('device', keys.userId, deviceId))));
}

// ---------------------------------------------------------------- chunks
const PURPOSES = ['content', 'thumb', 'preview'];
/** Chunk layout for a plaintext size and the server's ciphertext chunk size. */
export function layout(plainSize, chunkSize) {
  if (!Number.isSafeInteger(plainSize) || plainSize < 0) throw new OneCryptoError('bad_size', 'bad size');
  const plainChunk = chunkSize - CHUNK_OVERHEAD;
  const chunks = Math.max(1, Math.ceil(plainSize / plainChunk));
  return { chunks, plainChunk, cipherSize: plainSize + chunks * CHUNK_OVERHEAD, chunkSize };
}
/** Blob key. ctx: { blobId, purpose } */
export async function blobKey(fileKey, blobId, purpose) {
  if (!PURPOSES.includes(purpose)) throw new OneCryptoError('bad_kind', 'bad purpose');
  return hkdfKey(fileKey, te.encode(needId(blobId, 'blob id')), `${V}/blob/${purpose}`, AES, ['encrypt', 'decrypt']);
}
const chunkAad = (c, i, n) => aad('chunk', c.userId, c.nodeId, c.revId, c.blobId, c.purpose, i, n, i === n - 1 ? 1 : 0);
/** c: { userId, nodeId, revId, blobId, purpose } */
export async function sealChunk(bk, c, i, n, plain) {
  if (!Number.isInteger(i) || i < 0 || i >= n) throw new OneCryptoError('bad_index', 'bad index');
  const iv = rnd(IV_LEN);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: chunkAad(c, i, n) }, bk, plain));
  const out = new Uint8Array(IV_LEN + ct.length); out.set(iv); out.set(ct, IV_LEN);
  return out;
}
export async function openChunk(bk, c, i, n, sealed) {
  if (!(sealed instanceof Uint8Array) || sealed.length < CHUNK_OVERHEAD) throw new OneCryptoError('format', 'short chunk');
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: sealed.subarray(0, IV_LEN), additionalData: chunkAad(c, i, n) }, bk, sealed.subarray(IV_LEN)));
  } catch { throw new OneCryptoError('decrypt', 'chunk decryption failed (wrong key, reordered, truncated or manipulated)'); }
}
/** Encrypt a whole small object (thumbnail) in one chunk. */
export async function sealSmall(fileKey, c, plain) { return sealChunk(await blobKey(fileKey, c.blobId, c.purpose), c, 0, 1, plain); }
export async function openSmall(fileKey, c, sealed) { return openChunk(await blobKey(fileKey, c.blobId, c.purpose), c, 0, 1, sealed); }

// ---------------------------------------------------------------- content digest + keyed dedupe hash
async function bytesOf(src, start, end) {
  if (src instanceof Uint8Array) return src.subarray(start, end);
  return new Uint8Array(await src.slice(start, end).arrayBuffer()); // Blob / File
}
const sizeOf = src => (src instanceof Uint8Array ? src.length : src.size);
/** SHA-256 over the SHA-256 of every 4 MiB plaintext segment (streamable; independent of the chunk size). → Uint8Array(32) */
export async function contentDigest(src) {
  const n = Math.max(1, Math.ceil(sizeOf(src) / SEGMENT));
  const parts = new Uint8Array(32 * n);
  for (let i = 0; i < n; i++) parts.set(new Uint8Array(await subtle().digest('SHA-256', await bytesOf(src, i * SEGMENT, (i + 1) * SEGMENT))), i * 32);
  return new Uint8Array(await subtle().digest('SHA-256', parts));
}
/** Keyed hash the server may store for duplicate detection; without DK it cannot be computed or tested. → 43 chars */
export async function dedupeHash(keys, digest) {
  const msg = new Uint8Array([...te.encode(`${V}|dedupe|`), ...digest]);
  return b64u(new Uint8Array(await subtle().sign('HMAC', keys.dedupe, msg)));
}
export { bytesOf, sizeOf };

// ================================================================ Notfallzugang (emergency access) – contract §12
// Identity key: ECDH P-256, the SAME key pair as the family folders of FaLe PDF (js/smart/famcrypto.js, table fam_keys):
//   key id   = b64u(SHA-256("<x>.<y>")[0..12])
//   private  = PKCS#8, wrapped by AES-GCM(HKDF(MK, salt = <userId>, info "fale-fam-priv-v1"), AAD "fale-fam|priv|v1|<userId>")
// Emergency key EK (32 random bytes per setup):
//   owner copy     wrap(KEK, EK, AAD "fale-one-v1|wrap|em|<ownerId>|<setupId>")
//   covered keys   wrap(HKDF(EK, salt <setupId>, "fale-one-v1/em/wrap"), NK|AK, AAD "fale-one-v1|em|wrap|<node|album>|<ownerId>|<setupId>|<id>")
//   scope envelope AES-GCM(HKDF(EK, salt <setupId>, "fale-one-v1/em/scope"), JSON, AAD "fale-one-v1|em|scope|<ownerId>|<setupId>")
//   check value    b64u(HMAC-SHA-256(HKDF(EK, salt <setupId>, "fale-one-v1/em/check"), "fale-one-v1|em|check|<ownerId>|<setupId>")) – 43 chars
// Sealing for a contact (ECIES): ephemeral P-256 → ECDH → HKDF(shared, salt = eph public key (65 bytes raw),
//   info "fale-one-v1/em/seal|<purpose>|<setupId>|<to>") → AES-256-GCM, AAD "fale-one-v1|em|seal|<purpose>|<ownerId>|<setupId>|<from>|<to>"
//   → b64u(0x01 ‖ eph(65) ‖ IV(12) ‖ GCM(JSON))   purpose: share (owner → contact) | pool (contact → contact, k of n)
// Shamir secret sharing over GF(2^8) (AES polynomial 0x11b), byte-wise, x = contact slot (1..3), secret = EK.
export const FAM_PRIV_INFO = 'fale-fam-priv-v1';
const famAad = (...p) => te.encode(['fale-fam', ...p].join('|'));
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };

export async function identityKid(publicJwk) {
  return b64u(new Uint8Array(await subtle().digest('SHA-256', te.encode(`${publicJwk.x}.${publicJwk.y}`))).subarray(0, 12));
}
async function famWrapKey(mk, userId) {
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: te.encode(userId), info: te.encode(FAM_PRIV_INFO) }, mk, AES, false, ['encrypt', 'decrypt']);
}
/** New identity key pair. → { publicJwk, kid, wrapped (for fam_keys), privateKey (non-extractable) } */
export async function identityCreate(mk, userId) {
  const kp = await subtle().generateKey(ECDH, true, ['deriveBits']);
  const pub = await subtle().exportKey('jwk', kp.publicKey);
  const pkcs8 = new Uint8Array(await subtle().exportKey('pkcs8', kp.privateKey));
  try {
    const publicJwk = { kty: 'EC', crv: 'P-256', x: pub.x, y: pub.y };
    const wrapped = b64u(await gcmSeal(await famWrapKey(mk, userId), pkcs8, famAad('priv', 'v1', userId)));
    const privateKey = await subtle().importKey('pkcs8', pkcs8, ECDH, false, ['deriveBits']);
    return { publicJwk, kid: await identityKid(publicJwk), wrapped, privateKey };
  } finally { pkcs8.fill(0); }
}
/** Unwrap the identity private key (from fam_keys.wrapped_private). → non-extractable ECDH CryptoKey */
export async function identityOpen(mk, userId, wrapped) {
  const pkcs8 = await gcmOpen(await famWrapKey(mk, userId), unb64u(wrapped), famAad('priv', 'v1', userId), 'unwrap');
  try { return await subtle().importKey('pkcs8', pkcs8, ECDH, false, ['deriveBits']); } finally { pkcs8.fill(0); }
}
/** Does the (server-delivered) public key belong to this private key? ECDH(e, pub) == ECDH(priv, e·G) for a fresh e. */
export async function identityMatches(privateKey, publicJwk) {
  try {
    const e = await subtle().generateKey(ECDH, true, ['deriveBits']);
    const a = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: await importPub(publicJwk) }, e.privateKey, 256));
    const b = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: e.publicKey }, privateKey, 256));
    let d = a.length ^ b.length;
    for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
    a.fill(0); b.fill(0);
    return d === 0;
  } catch { return false; }
}
async function importPub(jwk) {
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.x !== 'string' || typeof jwk.y !== 'string') throw new OneCryptoError('format', 'bad public key');
  return subtle().importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true }, ECDH, true, []);
}

/** Raw 32-byte node/album key (to re-wrap it for the emergency key). Caller wipes. */
export async function openItemKeyRaw(keys, kind, id, wrapped) {
  return unwrapRaw(keys.kek, wrapped, aad('wrap', kind, keys.userId, needId(id, kind + ' id')));
}
export function emNewKey() { return rnd(32); }
export async function emOwnerWrap(keys, setupId, ek) { return wrapRaw(keys.kek, ek, aad('wrap', 'em', keys.userId, needId(setupId, 'setup id'))); }
export async function emOwnerOpen(keys, setupId, wrapped) { return unwrapRaw(keys.kek, wrapped, aad('wrap', 'em', keys.userId, needId(setupId, 'setup id'))); }
async function emSub(ek, setupId, info, alg = AES, usages = ['encrypt', 'decrypt']) {
  if (!(ek instanceof Uint8Array) || ek.length !== 32) throw new OneCryptoError('format', 'bad emergency key');
  return hkdfKey(await importBase(ek), te.encode(needId(setupId, 'setup id')), `${V}/em/${info}`, alg, usages);
}
/** ctx: { ownerId, setupId, kind: 'node'|'album', id } */
export async function emWrapItem(ek, ctx, raw) {
  if (ctx.kind !== 'node' && ctx.kind !== 'album') throw new OneCryptoError('bad_kind', 'kind must be node|album');
  return wrapRaw(await emSub(ek, ctx.setupId, 'wrap'), raw, aad('em', 'wrap', ctx.kind, ctx.ownerId, ctx.setupId, needId(ctx.id, 'id')));
}
/** → HKDF CryptoKey usable exactly like a node/album key from openNodeKey/openAlbumKey */
export async function emOpenItem(ek, ctx, wrapped) {
  const raw = await unwrapRaw(await emSub(ek, ctx.setupId, 'wrap'), wrapped, aad('em', 'wrap', ctx.kind, ctx.ownerId, ctx.setupId, needId(ctx.id, 'id')));
  try { return await importBase(raw); } finally { raw.fill(0); }
}
export async function emSealScope(ek, ctx, obj) {
  return b64u(await gcmSeal(await emSub(ek, ctx.setupId, 'scope'), te.encode(JSON.stringify(obj)), aad('em', 'scope', ctx.ownerId, ctx.setupId)));
}
export async function emOpenScope(ek, ctx, sealed) {
  return JSON.parse(td.decode(await gcmOpen(await emSub(ek, ctx.setupId, 'scope'), unb64u(sealed), aad('em', 'scope', ctx.ownerId, ctx.setupId))));
}
export async function emCheck(ek, ownerId, setupId) {
  const k = await emSub(ek, setupId, 'check', { name: 'HMAC', hash: 'SHA-256', length: 256 }, ['sign']);
  return b64u(new Uint8Array(await subtle().sign('HMAC', k, aad('em', 'check', ownerId, setupId))));
}

const SEAL_PURPOSES = ['share', 'pool'];
/** Seal a JSON object for a contact's identity public key. ctx: { purpose, ownerId, setupId, from, to } */
export async function emSeal(publicJwk, ctx, obj) {
  if (!SEAL_PURPOSES.includes(ctx.purpose)) throw new OneCryptoError('bad_kind', 'bad purpose');
  const pub = await importPub(publicJwk);
  const eph = await subtle().generateKey(ECDH, true, ['deriveBits']);
  const ephRaw = new Uint8Array(await subtle().exportKey('raw', eph.publicKey));
  const shared = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: pub }, eph.privateKey, 256));
  try {
    const k = await hkdfKey(await importBase(shared), ephRaw, `${V}/em/seal|${ctx.purpose}|${ctx.setupId}|${ctx.to}`, AES, ['encrypt']);
    const body = await gcmSeal(k, te.encode(JSON.stringify(obj)), aad('em', 'seal', ctx.purpose, ctx.ownerId, ctx.setupId, ctx.from, ctx.to));
    const out = new Uint8Array(1 + 65 + body.length - 1);
    out[0] = 1; out.set(ephRaw, 1); out.set(body.subarray(1), 66);
    return b64u(out);
  } finally { shared.fill(0); }
}
export async function emOpen(privateKey, ctx, sealed) {
  let u;
  try { u = unb64u(sealed); } catch { throw new OneCryptoError('format', 'bad sealed data'); }
  if (u[0] !== 1 || u.length < 1 + 65 + IV_LEN + TAG) throw new OneCryptoError('format', 'unknown format');
  const ephRaw = u.slice(1, 66);
  let eph;
  try { eph = await subtle().importKey('raw', ephRaw, ECDH, false, []); } catch { throw new OneCryptoError('format', 'bad ephemeral key'); }
  const shared = new Uint8Array(await subtle().deriveBits({ name: 'ECDH', public: eph }, privateKey, 256));
  try {
    const k = await hkdfKey(await importBase(shared), ephRaw, `${V}/em/seal|${ctx.purpose}|${ctx.setupId}|${ctx.to}`, AES, ['decrypt']);
    const body = new Uint8Array(1 + u.length - 66); body[0] = 1; body.set(u.subarray(66), 1);
    return JSON.parse(td.decode(await gcmOpen(k, body, aad('em', 'seal', ctx.purpose, ctx.ownerId, ctx.setupId, ctx.from, ctx.to))));
  } finally { shared.fill(0); }
}

// ---------------------------------------------------------------- Shamir secret sharing over GF(2^8)
const GF_EXP = new Uint8Array(510), GF_LOG = new Uint8Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { GF_EXP[i] = x; GF_LOG[x] = i; x ^= ((x << 1) ^ (x & 0x80 ? 0x1b : 0)) & 0xff; } for (let i = 255; i < 510; i++) GF_EXP[i] = GF_EXP[i - 255]; })();
export const gfMul = (a, b) => (a && b ? GF_EXP[GF_LOG[a] + GF_LOG[b]] : 0);
export function gfDiv(a, b) { if (!b) throw new OneCryptoError('shamir', 'division by zero'); return a ? GF_EXP[GF_LOG[a] + 255 - GF_LOG[b]] : 0; }
/**
 * Split a secret into n shares, any k of which recover it. xs: the x coordinates (distinct, 1..255), default 1..n.
 * → [{ x, y: Uint8Array }]. k = 1 gives every holder the secret itself.
 */
export function shamirSplit(secret, n, k, xs) {
  if (!(secret instanceof Uint8Array) || !secret.length) throw new OneCryptoError('shamir', 'empty secret');
  if (!Number.isInteger(n) || !Number.isInteger(k) || k < 1 || n < k || n > 255) throw new OneCryptoError('shamir', 'bad n/k');
  xs = xs || Array.from({ length: n }, (_, i) => i + 1);
  if (xs.length !== n || new Set(xs).size !== n || !xs.every(x => Number.isInteger(x) && x >= 1 && x <= 255)) throw new OneCryptoError('shamir', 'bad x');
  const coef = k > 1 ? rnd(secret.length * (k - 1)) : new Uint8Array(0);
  const out = xs.map(x => ({ x, y: new Uint8Array(secret.length) }));
  for (let j = 0; j < secret.length; j++) {
    for (const s of out) {
      let acc = 0; // Horner: c_{k-1} … c_1, then c_0 = secret byte
      for (let m = k - 1; m >= 1; m--) acc = gfMul(acc, s.x) ^ coef[(m - 1) * secret.length + j];
      s.y[j] = gfMul(acc, s.x) ^ secret[j];
    }
  }
  coef.fill(0);
  return out;
}
/** Recover the secret from shares [{ x, y }] (Lagrange interpolation at 0). Wrong or too few shares give a WRONG
 *  secret, never an error – verify the result (emCheck). */
export function shamirCombine(shares) {
  if (!Array.isArray(shares) || !shares.length) throw new OneCryptoError('shamir', 'no shares');
  const len = shares[0].y && shares[0].y.length;
  if (!len || !shares.every(s => s.y instanceof Uint8Array && s.y.length === len && Number.isInteger(s.x) && s.x >= 1 && s.x <= 255)) throw new OneCryptoError('shamir', 'bad share');
  if (new Set(shares.map(s => s.x)).size !== shares.length) throw new OneCryptoError('shamir', 'duplicate share');
  const lag = shares.map((s, i) => { let num = 1, den = 1; shares.forEach((o, m) => { if (m !== i) { num = gfMul(num, o.x); den = gfMul(den, o.x ^ s.x); } }); return gfDiv(num, den); });
  const out = new Uint8Array(len);
  for (let j = 0; j < len; j++) { let acc = 0; shares.forEach((s, i) => { acc ^= gfMul(s.y[j], lag[i]); }); out[j] = acc; }
  return out;
}

// ---------------------------------------------------------------- safety code (compare in person / by phone)
// 64 emoji (6 bits each) – the same list as the Matrix SAS emoji, with German / English names.
export const SAS_EMOJI = [['🐶', 'Hund', 'Dog'], ['🐱', 'Katze', 'Cat'], ['🦁', 'Löwe', 'Lion'], ['🐎', 'Pferd', 'Horse'], ['🦄', 'Einhorn', 'Unicorn'], ['🐷', 'Schwein', 'Pig'],
  ['🐘', 'Elefant', 'Elephant'], ['🐰', 'Hase', 'Rabbit'], ['🐼', 'Panda', 'Panda'], ['🐓', 'Hahn', 'Rooster'], ['🐧', 'Pinguin', 'Penguin'], ['🐢', 'Schildkröte', 'Turtle'],
  ['🐟', 'Fisch', 'Fish'], ['🐙', 'Krake', 'Octopus'], ['🦋', 'Schmetterling', 'Butterfly'], ['🌷', 'Tulpe', 'Flower'], ['🌳', 'Baum', 'Tree'], ['🌵', 'Kaktus', 'Cactus'],
  ['🍄', 'Pilz', 'Mushroom'], ['🌏', 'Globus', 'Globe'], ['🌙', 'Mond', 'Moon'], ['☁️', 'Wolke', 'Cloud'], ['🔥', 'Feuer', 'Fire'], ['🍌', 'Banane', 'Banana'],
  ['🍎', 'Apfel', 'Apple'], ['🍓', 'Erdbeere', 'Strawberry'], ['🌽', 'Mais', 'Corn'], ['🍕', 'Pizza', 'Pizza'], ['🎂', 'Kuchen', 'Cake'], ['❤️', 'Herz', 'Heart'],
  ['😀', 'Lächeln', 'Smiley'], ['🤖', 'Roboter', 'Robot'], ['🎩', 'Hut', 'Hat'], ['👓', 'Brille', 'Glasses'], ['🔧', 'Schraubenschlüssel', 'Spanner'], ['🎅', 'Weihnachtsmann', 'Santa'],
  ['👍', 'Daumen hoch', 'Thumbs up'], ['☂️', 'Regenschirm', 'Umbrella'], ['⌛', 'Sanduhr', 'Hourglass'], ['⏰', 'Wecker', 'Clock'], ['🎁', 'Geschenk', 'Gift'], ['💡', 'Glühbirne', 'Light bulb'],
  ['📕', 'Buch', 'Book'], ['✏️', 'Bleistift', 'Pencil'], ['📎', 'Büroklammer', 'Paperclip'], ['✂️', 'Schere', 'Scissors'], ['🔒', 'Schloss', 'Lock'], ['🔑', 'Schlüssel', 'Key'],
  ['🔨', 'Hammer', 'Hammer'], ['☎️', 'Telefon', 'Telephone'], ['🏁', 'Zielflagge', 'Flag'], ['🚂', 'Zug', 'Train'], ['🚲', 'Fahrrad', 'Bicycle'], ['✈️', 'Flugzeug', 'Aeroplane'],
  ['🚀', 'Rakete', 'Rocket'], ['🏆', 'Pokal', 'Trophy'], ['⚽', 'Ball', 'Ball'], ['🎸', 'Gitarre', 'Guitar'], ['🎺', 'Trompete', 'Trumpet'], ['🔔', 'Glocke', 'Bell'],
  ['⚓', 'Anker', 'Anchor'], ['🎧', 'Kopfhörer', 'Headphones'], ['📁', 'Ordner', 'Folder'], ['📌', 'Stecknadel', 'Pin']];
/**
 * Safety code over both identity key ids. Owner and contact each compute it from their OWN key id plus the other
 * one as the server reports it – equal codes prove the server did not substitute a key.
 * → { emoji: [[emoji, de, en] × 6], digits: '1234 5678 9012', hex }
 */
export async function safetyCode({ setupId, ownerId, ownerKid, contactId, contactKid }) {
  const h = new Uint8Array(await subtle().digest('SHA-256', aad('em', 'sas', setupId, ownerId, ownerKid, contactId, contactKid)));
  let bits = 0n;
  for (let i = 0; i < 6; i++) bits = (bits << 8n) | BigInt(h[i]);
  const emoji = Array.from({ length: 6 }, (_, i) => SAS_EMOJI[Number((bits >> BigInt(42 - 6 * i)) & 63n)]);
  let num = 0n;
  for (let i = 6; i < 12; i++) num = (num << 8n) | BigInt(h[i]);
  const d = (num % 1000000000000n).toString().padStart(12, '0');
  return { emoji, digits: `${d.slice(0, 4)} ${d.slice(4, 8)} ${d.slice(8)}`, hex: hex(h.subarray(0, 12)) };
}
