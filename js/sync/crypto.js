// FaLe Sync – key hierarchy and encryption (Web Crypto only, no dependencies).
//
//   master key MK      32 random bytes, created on the first device. Kept on each device only as a
//                      NON-EXTRACTABLE HKDF CryptoKey in IndexedDB; the raw bytes exist only briefly in
//                      memory while wrapping/unwrapping.
//   wrapped_pw         AES-256-GCM(KEK_pw, MK), KEK_pw = PBKDF2-SHA256(Sync-Passwort, salt, ≥ 600 000)
//   wrapped_rk         AES-256-GCM(KEK_rk, MK), KEK_rk = HKDF-SHA256(recovery key (256 bit random), salt)
//                      (AAD binds both to the user id, so wrapped keys cannot be swapped between accounts)
//   key id             HKDF(MK, "fale-sync-keyid-v1") – public fingerprint to notice a changed key
//   item key           HKDF(MK, salt = item id, "fale-sync-item-v1") → AES-256-GCM, one per sync item
//   metadata envelope  v1 | iv | GCM(item key, JSON, AAD = user|item|kind)        (stored in sync_items.meta)
//   file chunks        iv | GCM(item key, ≤ 4 MiB, AAD = user|item|blob|index|count) (Storage <uid>/<blob>/<n>)
// The server never sees MK, a KEK, a password, the recovery key, names or plaintext.
const enc = new TextEncoder();
const dec = new TextDecoder();
export const PBKDF2_ITER = 600000;
export const CHUNK_PLAIN = 4 * 1024 * 1024;
export const CHUNK_OVERHEAD = 28; // 12 byte IV + 16 byte tag
const subtle = () => {
  if (!globalThis.crypto || !crypto.subtle) throw Object.assign(new Error('no crypto'), { userMessage: 'Verschlüsselung ist hier nicht verfügbar (sichere Verbindung nötig).' });
  return crypto.subtle;
};

export const rnd = n => crypto.getRandomValues(new Uint8Array(n));
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
export const randomId = () => b64u(rnd(16)); // 22 chars, 128 bit
export async function sha256(bytes) { return new Uint8Array(await subtle().digest('SHA-256', bytes)); }
export const hex = u => Array.from(u, b => b.toString(16).padStart(2, '0')).join('');

// ---------------------------------------------------------------- recovery key (printable)
// 32 random bytes + 3 checksum bytes = 35 bytes = 56 Crockford-Base32 characters, shown as 14 groups of 4.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function b32encode(bytes) {
  let out = '', bits = 0, val = 0;
  for (const b of bytes) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function b32decode(str) {
  const out = []; let bits = 0, val = 0;
  for (const ch of str) { const i = B32.indexOf(ch); if (i < 0) return null; val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return new Uint8Array(out);
}
export async function newRecoveryKey() {
  const raw = rnd(32);
  const sum = (await sha256(raw)).subarray(0, 3);
  const all = new Uint8Array(35); all.set(raw); all.set(sum, 32);
  return { raw, text: b32encode(all).match(/.{4}/g).join('-') };
}
/** Parse user input (spaces, dashes, lower case, O/0 and I/L/1 confusion tolerated). → raw 32 bytes or null */
export async function parseRecoveryKey(input) {
  const s = String(input || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
  if (s.length !== 56) return null;
  const all = b32decode(s);
  if (!all || all.length !== 35) return null;
  const raw = all.subarray(0, 32), sum = (await sha256(raw)).subarray(0, 3);
  if (sum[0] !== all[32] || sum[1] !== all[33] || sum[2] !== all[34]) return null;
  return new Uint8Array(raw);
}

// ---------------------------------------------------------------- key wrapping
const aad = (...parts) => enc.encode(['fale-sync', ...parts].join('|'));
async function kekFromPassword(password, salt, iter) {
  const base = await subtle().importKey('raw', enc.encode(String(password).normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function kekFromRecovery(raw, salt) {
  const base = await subtle().importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('fale-sync-rk-v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function wrap(kek, mkRaw, ad) {
  const iv = rnd(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: ad }, kek, mkRaw));
  const out = new Uint8Array(1 + 12 + ct.length); out[0] = 1; out.set(iv, 1); out.set(ct, 13);
  return b64u(out);
}
async function unwrap(kek, wrapped, ad) {
  const u = unb64u(wrapped);
  if (u[0] !== 1 || u.length !== 1 + 12 + 32 + 16) throw new Error('format');
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: u.subarray(1, 13), additionalData: ad }, kek, u.subarray(13)));
}

/** Import raw MK as a non-extractable HKDF key (+ its public key id). */
export async function importMaster(mkRaw) {
  const key = await subtle().importKey('raw', mkRaw, 'HKDF', false, ['deriveKey', 'deriveBits']);
  return { key, keyId: await keyIdOf(key) };
}
export async function keyIdOf(mk) {
  const bits = await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('fale-sync-keyid-v1') }, mk, 96);
  return b64u(bits); // 16 chars
}

/** First device: new MK + recovery key, wrapped by password and recovery key (separate salts). */
export async function createKeys(userId, password, { iter = PBKDF2_ITER } = {}) {
  const mkRaw = rnd(32);
  const salt = rnd(16), rsalt = rnd(16);
  const rk = await newRecoveryKey();
  try {
    const [kp, kr] = await Promise.all([kekFromPassword(password, salt, iter), kekFromRecovery(rk.raw, rsalt)]);
    const wrappedPw = await wrap(kp, mkRaw, aad('mk', 'pw', 'v1', userId));
    const wrappedRk = await wrap(kr, mkRaw, aad('mk', 'rk', 'v1', userId));
    const { key, keyId } = await importMaster(mkRaw);
    return { key, keyId, recoveryText: rk.text, record: { key_id: keyId, kdf: { alg: 'PBKDF2-SHA256', iter, salt: b64u(salt), rsalt: b64u(rsalt) }, wrapped_pw: wrappedPw, wrapped_rk: wrappedRk } };
  } finally { mkRaw.fill(0); rk.raw.fill(0); }
}

/** Unlock with the Sync-Passwort or the recovery key. → raw MK (caller must wipe) or throws {code:'wrong'|'format'} */
export async function unwrapMaster(userId, record, { password, recovery }) {
  try {
    if (password != null) {
      // the KDF parameters come from the server: never derive with fewer rounds than we create keys with
      // (a manipulated record could otherwise make this device do a cheap derivation) – nor absurdly many (DoS)
      const iter = Number(record.kdf && record.kdf.iter);
      if (!Number.isInteger(iter) || iter < PBKDF2_ITER || iter > 10000000 || !record.kdf.salt) throw Object.assign(new Error('format'), { code: 'format' });
      return await unwrap(await kekFromPassword(password, unb64u(record.kdf.salt), iter), record.wrapped_pw, aad('mk', 'pw', 'v1', userId));
    }
    const raw = await parseRecoveryKey(recovery);
    if (!raw) throw Object.assign(new Error('format'), { code: 'format' });
    try { return await unwrap(await kekFromRecovery(raw, unb64u(record.kdf.rsalt || record.kdf.salt)), record.wrapped_rk, aad('mk', 'rk', 'v1', userId)); } finally { raw.fill(0); }
  } catch (e) {
    if (e && e.code === 'format') throw Object.assign(new Error('format'), { code: 'format', userMessage: password != null ? 'Die Schlüsseldaten deines Kontos sind ungültig (unsichere Parameter) – bitte melde dich beim Support.' : 'Das ist kein gültiger Wiederherstellungsschlüssel. Bitte prüfe die Eingabe.' });
    throw Object.assign(new Error('wrong'), { code: 'wrong', userMessage: password != null ? 'Das Sync-Passwort ist falsch.' : 'Der Wiederherstellungsschlüssel passt nicht zu diesem Konto.' });
  }
}

/** Re-wrap MK with a new password and/or a new recovery key; the other half stays as it is. */
export async function rewrap(userId, record, mkRaw, { password = null, newRecovery = false, iter = PBKDF2_ITER } = {}) {
  const kdf = { ...record.kdf };
  const out = { key_id: record.key_id, kdf, wrapped_pw: record.wrapped_pw, wrapped_rk: record.wrapped_rk };
  let recoveryText = null;
  if (password != null) {
    const salt = rnd(16);
    kdf.salt = b64u(salt); kdf.iter = iter;
    out.wrapped_pw = await wrap(await kekFromPassword(password, salt, iter), mkRaw, aad('mk', 'pw', 'v1', userId));
  }
  if (newRecovery) {
    const rsalt = rnd(16), rk = await newRecoveryKey();
    kdf.rsalt = b64u(rsalt);
    out.wrapped_rk = await wrap(await kekFromRecovery(rk.raw, rsalt), mkRaw, aad('mk', 'rk', 'v1', userId));
    rk.raw.fill(0);
    recoveryText = rk.text;
  }
  return { record: out, recoveryText };
}

/** Deterministic item id for singletons (folders, tags, profile, settings, vault key): HKDF(MK, name) – same on every device. */
export async function singletonId(mk, name) {
  return b64u(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode('fale-sync-singleton-v1|' + name) }, mk, 128));
}

// ---------------------------------------------------------------- item encryption
const itemKeys = new Map();
async function itemKey(mk, itemId) {
  const k = itemKeys.get(itemId);
  if (k && k.mk === mk) return k.key;
  const key = await subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode(itemId), info: enc.encode('fale-sync-item-v1') }, mk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  if (itemKeys.size > 500) itemKeys.clear();
  itemKeys.set(itemId, { mk, key });
  return key;
}
export function forgetItemKeys() { itemKeys.clear(); }

export async function sealMeta(mk, userId, itemId, kind, obj) {
  const key = await itemKey(mk, itemId);
  const iv = rnd(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad('meta', 'v1', userId, itemId, kind) }, key, enc.encode(JSON.stringify(obj))));
  const out = new Uint8Array(1 + 12 + ct.length); out[0] = 1; out.set(iv, 1); out.set(ct, 13);
  return b64u(out);
}
export async function openMeta(mk, userId, itemId, kind, sealed) {
  const u = unb64u(sealed);
  if (u[0] !== 1 || u.length < 30) throw Object.assign(new Error('format'), { code: 'decrypt' });
  const key = await itemKey(mk, itemId);
  try {
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: u.subarray(1, 13), additionalData: aad('meta', 'v1', userId, itemId, kind) }, key, u.subarray(13));
    return JSON.parse(dec.decode(pt));
  } catch { throw Object.assign(new Error('decrypt'), { code: 'decrypt' }); }
}

/** Number of chunks / ciphertext size for a plaintext size. */
export function layout(plainSize) {
  const chunks = Math.max(1, Math.ceil(plainSize / CHUNK_PLAIN));
  return { chunks, cipherSize: plainSize + chunks * CHUNK_OVERHEAD };
}
export async function sealChunk(mk, userId, itemId, blobId, index, count, plain) {
  const key = await itemKey(mk, itemId);
  const iv = rnd(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad('blob', 'v1', userId, itemId, blobId, index, count) }, key, plain));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return out;
}
export async function openChunk(mk, userId, itemId, blobId, index, count, sealed) {
  const key = await itemKey(mk, itemId);
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: sealed.subarray(0, 12), additionalData: aad('blob', 'v1', userId, itemId, blobId, index, count) }, key, sealed.subarray(12)));
  } catch { throw Object.assign(new Error('decrypt'), { code: 'decrypt' }); }
}

/** Content fingerprint independent of memory size: SHA-256 over the SHA-256 of each 4 MiB plaintext chunk. */
export async function contentHash(blob) {
  const n = Math.max(1, Math.ceil(blob.size / CHUNK_PLAIN));
  const parts = new Uint8Array(32 * n);
  for (let i = 0; i < n; i++) parts.set(await sha256(new Uint8Array(await blob.slice(i * CHUNK_PLAIN, (i + 1) * CHUNK_PLAIN).arrayBuffer())), i * 32);
  return hex(await sha256(parts));
}
