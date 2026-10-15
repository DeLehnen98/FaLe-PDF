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
