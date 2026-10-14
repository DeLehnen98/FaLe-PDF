// Familien-Ordner – Kryptografie (nur Web Crypto, keine Abhängigkeiten).
//
//   Konto-Schlüsselpaar   ECDH P-256. Öffentlicher Schlüssel (JWK x/y) liegt beim Server, der private nur
//                         AES-256-GCM-verpackt mit HKDF(Sync-Hauptschlüssel, "fale-fam-priv-v1") → andere Geräte
//                         desselben Kontos entpacken ihn mit FaLe Sync; lokal als nicht exportierbarer CryptoKey.
//   Gruppenschlüssel GK   32 Zufallsbytes pro Familien-Ordner. Für jedes Mitglied verpackt mit
//                         ECIES: ephemeres ECDH(P-256) → HKDF-SHA-256 → AES-256-GCM (AAD bindet Gruppe + Empfänger).
//   Einladung             Geheimnis T (32 Bytes, nur im Link-Fragment): auth = HKDF(T,"auth") (Server speichert SHA-256),
//                         wrapKey = HKDF(T,"wrap"|Einladung) verpackt GK – der Server kann ihn nicht ableiten.
//   Einträge              Schlüssel je Eintrag = HKDF(GK, Eintrags-ID); Metadaten-Umschlag und Datei AES-256-GCM.
import { b64u, unb64u, rnd, sha256, hex } from '../sync/crypto.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const S = () => crypto.subtle;
const aad = (...p) => enc.encode(['fale-fam', ...p].join('|'));

// ------------------------------------------------------------------ account key pair
export async function newKeyPair() {
  const kp = await S().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = await S().exportKey('jwk', kp.publicKey);
  const pkcs8 = new Uint8Array(await S().exportKey('pkcs8', kp.privateKey));
  return { publicJwk: { kty: 'EC', crv: 'P-256', x: pub.x, y: pub.y }, pkcs8 };
}
export async function keyIdOf(publicJwk) { return b64u((await sha256(enc.encode(`${publicJwk.x}.${publicJwk.y}`))).subarray(0, 12)); }
/** Human-comparable fingerprint (e.g. "7K3Q-9M2X-…"). */
export async function fingerprint(publicJwk) {
  const h = await sha256(enc.encode(`fale-fam-fp|${publicJwk.x}|${publicJwk.y}`));
  const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let s = '';
  for (let i = 0; i < 10; i++) s += A[h[i] % 32];
  return s.match(/.{5}/g).join('-');
}
async function privWrapKey(mk, userId) {
  return S().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode(userId), info: enc.encode('fale-fam-priv-v1') }, mk, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
/** Wrap the PKCS#8 private key with the sync master key (CryptoKey, HKDF). */
export async function wrapPrivate(mk, userId, pkcs8) {
  const k = await privWrapKey(mk, userId);
  const iv = rnd(12);
  const ct = new Uint8Array(await S().encrypt({ name: 'AES-GCM', iv, additionalData: aad('priv', 'v1', userId) }, k, pkcs8));
  const out = new Uint8Array(1 + 12 + ct.length); out[0] = 1; out.set(iv, 1); out.set(ct, 13);
  return b64u(out);
}
/** → non-extractable ECDH private CryptoKey */
export async function unwrapPrivate(mk, userId, wrapped) {
  const u = unb64u(wrapped);
  if (u[0] !== 1) throw Object.assign(new Error('format'), { code: 'format' });
  const k = await privWrapKey(mk, userId);
  let pkcs8;
  try { pkcs8 = new Uint8Array(await S().decrypt({ name: 'AES-GCM', iv: u.subarray(1, 13), additionalData: aad('priv', 'v1', userId) }, k, u.subarray(13))); }
  catch { throw Object.assign(new Error('decrypt'), { code: 'decrypt', userMessage: 'Dein Familien-Schlüssel passt nicht zu diesem FaLe-Sync-Schlüssel.' }); }
  try { return await importPrivate(pkcs8); } finally { pkcs8.fill(0); }
}
export async function importPrivate(pkcs8) { return S().importKey('pkcs8', pkcs8, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']); }
async function importPublic(jwk) { return S().importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true }, { name: 'ECDH', namedCurve: 'P-256' }, true, []); }

// ------------------------------------------------------------------ group key wrapping (ECIES)
async function eciesKey(shared, ephRaw, groupId, userId) {
  const base = await S().importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return S().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: ephRaw, info: enc.encode(`fale-fam-wrap-v1|${groupId}|${userId}`) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
/** Wrap the raw group key for a member's public key. → b64u(1 | eph pub 65 | iv 12 | ct 48) */
export async function wrapFor(publicJwk, groupKeyRaw, groupId, userId) {
  const pub = await importPublic(publicJwk);
  const eph = await S().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const ephRaw = new Uint8Array(await S().exportKey('raw', eph.publicKey));
  const shared = new Uint8Array(await S().deriveBits({ name: 'ECDH', public: pub }, eph.privateKey, 256));
  const kek = await eciesKey(shared, ephRaw, groupId, userId);
  shared.fill(0);
  const iv = rnd(12);
  const ct = new Uint8Array(await S().encrypt({ name: 'AES-GCM', iv, additionalData: aad('gk', groupId, userId) }, kek, groupKeyRaw));
  const out = new Uint8Array(1 + ephRaw.length + 12 + ct.length);
  out[0] = 1; out.set(ephRaw, 1); out.set(iv, 1 + ephRaw.length); out.set(ct, 13 + ephRaw.length);
  return b64u(out);
}
/** → raw group key (Uint8Array, caller wipes) */
export async function unwrapWith(privateKey, wrapped, groupId, userId) {
  const u = unb64u(wrapped);
  if (u[0] !== 1 || u.length !== 1 + 65 + 12 + 48) throw Object.assign(new Error('format'), { code: 'format' });
  const ephRaw = u.subarray(1, 66);
  const eph = await S().importKey('raw', ephRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await S().deriveBits({ name: 'ECDH', public: eph }, privateKey, 256));
  const kek = await eciesKey(shared, new Uint8Array(ephRaw), groupId, userId);
  shared.fill(0);
  try { return new Uint8Array(await S().decrypt({ name: 'AES-GCM', iv: u.subarray(66, 78), additionalData: aad('gk', groupId, userId) }, kek, u.subarray(78))); }
  catch { throw Object.assign(new Error('decrypt'), { code: 'decrypt', userMessage: 'Der Schlüssel dieses Familien-Ordners lässt sich nicht entschlüsseln.' }); }
}

// ------------------------------------------------------------------ invitations
export function newInviteSecret() { return rnd(32); }
async function hkdfRaw(secret, info, len = 32) {
  const base = await S().importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await S().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(info) }, base, len * 8));
}
/** Proof for the server (hex). The server stores only SHA-256 of it. */
export async function inviteAuth(secret) { return hex(await hkdfRaw(secret, 'fale-fam-invite-auth-v1')); }
export async function inviteAuthHash(secret) { return hex(await sha256(enc.encode(await inviteAuth(secret)))); }
async function inviteKey(secret, inviteId) { return S().importKey('raw', await hkdfRaw(secret, `fale-fam-invite-wrap-v1|${inviteId}`), 'AES-GCM', false, ['encrypt', 'decrypt']); }
export async function wrapForInvite(secret, inviteId, groupId, groupKeyRaw) {
  const k = await inviteKey(secret, inviteId);
  const iv = rnd(12);
  const ct = new Uint8Array(await S().encrypt({ name: 'AES-GCM', iv, additionalData: aad('invite', inviteId, groupId) }, k, groupKeyRaw));
  const out = new Uint8Array(1 + 12 + ct.length); out[0] = 1; out.set(iv, 1); out.set(ct, 13);
  return b64u(out);
}
export async function unwrapInvite(secret, inviteId, groupId, wrapped) {
  const u = unb64u(wrapped);
  const k = await inviteKey(secret, inviteId);
  try { return new Uint8Array(await S().decrypt({ name: 'AES-GCM', iv: u.subarray(1, 13), additionalData: aad('invite', inviteId, groupId) }, k, u.subarray(13))); }
  catch { throw Object.assign(new Error('decrypt'), { code: 'decrypt', userMessage: 'Die Einladung ist beschädigt.' }); }
}

// ------------------------------------------------------------------ content
const keyCache = new Map();
async function gkBase(groupKeyRaw) { return S().importKey('raw', groupKeyRaw, 'HKDF', false, ['deriveKey']); }
async function subKey(groupId, groupKeyRaw, salt, info) {
  // the cache id includes a hash of the group key itself, so a rotated key (new key_version) can never pick up
  // a sub-key derived from the previous one (security audit 2026-10)
  const id = `${groupId}|${hex((await sha256(groupKeyRaw)).subarray(0, 8))}|${salt}|${info}`;
  if (keyCache.has(id)) return keyCache.get(id);
  const k = await S().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc.encode(salt), info: enc.encode(info) }, await gkBase(groupKeyRaw), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  if (keyCache.size > 300) keyCache.clear();
  keyCache.set(id, k);
  return k;
}
export function forgetKeys() { keyCache.clear(); }
async function seal(key, bytes, ad) {
  const iv = rnd(12);
  const ct = new Uint8Array(await S().encrypt({ name: 'AES-GCM', iv, additionalData: ad }, key, bytes));
  const out = new Uint8Array(1 + 12 + ct.length); out[0] = 1; out.set(iv, 1); out.set(ct, 13);
  return out;
}
async function open(key, sealed, ad) {
  if (sealed[0] !== 1) throw Object.assign(new Error('format'), { code: 'decrypt' });
  try { return new Uint8Array(await S().decrypt({ name: 'AES-GCM', iv: sealed.subarray(1, 13), additionalData: ad }, key, sealed.subarray(13))); }
  catch { throw Object.assign(new Error('decrypt'), { code: 'decrypt' }); }
}
export async function sealJson(groupId, gk, scope, obj) {
  const k = await subKey(groupId, gk, scope, 'fale-fam-meta-v1');
  return b64u(await seal(k, enc.encode(JSON.stringify(obj)), aad('meta', groupId, scope)));
}
export async function openJson(groupId, gk, scope, sealed) {
  const k = await subKey(groupId, gk, scope, 'fale-fam-meta-v1');
  return JSON.parse(dec.decode(await open(k, unb64u(sealed), aad('meta', groupId, scope))));
}
export async function sealBlob(groupId, gk, itemId, blobId, bytes) {
  const k = await subKey(groupId, gk, itemId, 'fale-fam-blob-v1');
  return seal(k, bytes, aad('blob', groupId, itemId, blobId));
}
export async function openBlob(groupId, gk, itemId, blobId, sealed) {
  const k = await subKey(groupId, gk, itemId, 'fale-fam-blob-v1');
  return open(k, sealed, aad('blob', groupId, itemId, blobId));
}
export { b64u, unb64u, rnd, sha256, hex };
