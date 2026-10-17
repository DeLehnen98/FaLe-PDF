// End-to-end encryption for "Sicher teilen", "Unterschrift anfordern" and the transfer relay.
// WebCrypto only (AES-256-GCM, HKDF-SHA-256, PBKDF2-SHA-256) – no libraries, nothing leaves the
// device unencrypted.
//
// Scheme (v1)
//   link key  L  = 32 random bytes; travels ONLY in the URL fragment (#k=…), never to the server.
//   content key CK = L                                   (no password)
//                  = HKDF(L ‖ PBKDF2(pw, salt, 600 000), salt, "fale-share-v1/pw")   (with password)
//                    → link AND password are needed; the server only stores salt + iteration count.
//   per object a random 16-byte nonce N (public, in the header):
//     data key = HKDF(CK, N, "fale-share-v1/data"), meta key = HKDF(CK, N, "fale-share-v1/meta")
//     → several objects under one CK (signed versions of a document, relay files) never reuse an IV.
//   data chunks: AES-GCM, IV = 4 zero bytes ‖ uint64 chunk index, AAD = "fale1:<index>:<last?1:0>"
//     → chunks cannot be reordered, swapped between objects, or the file truncated unnoticed.
//   metadata (file name, type, size, message, signature fields, signer names …): AES-GCM with a random IV.
//   Header (stored by the server): {v:1, n, m (encrypted metadata), k: {s, i} | null, c: chunk size}.
//
// What this protects against: the server/database operator, storage breaches, network observers.
// What it cannot protect against: whoever holds the complete link (and password, if set), a compromised
// device, or a malicious app version served to the user (web apps are fetched from our host).

const te = new TextEncoder();
const td = new TextDecoder();
export const PBKDF2_ITER = 600000;
export const TAG = 16;

export class CryptoFail extends Error {
  constructor(code, msg) { super(msg); this.code = code; this.userMessage = msg; }
}

export const b64u = {
  enc(u8) {
    const b = u8 instanceof Uint8Array ? u8 : new Uint8Array(u8);
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec(str) {
    const s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s + '==='.slice((s.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};

export function randomBytes(n) { const b = new Uint8Array(n); crypto.getRandomValues(b); return b; }
export function newLinkKey() { return randomBytes(32); }
export function hasWebCrypto() { return !!(globalThis.crypto && crypto.subtle && typeof crypto.subtle.importKey === 'function'); }

/** Parse "#…#k=<key>&…" / "k=…" → Uint8Array(32) or null. */
export function keyFromFragment(text) {
  const m = /(?:^|[#&?])k=([A-Za-z0-9_-]{43})(?:$|[&#])/.exec(String(text || ''));
  if (!m) return null;
  try { const k = b64u.dec(m[1]); return k.length === 32 ? k : null; } catch { return null; }
}

async function hkdfBits(ikm, salt, info, bits = 256) {
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: te.encode(info) }, base, bits));
}
async function hkdfAes(ikm, salt, info) {
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: te.encode(info) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** New password parameters (stored in the header): {s: salt, i: iterations}. */
export function newKdf() { return { s: b64u.enc(randomBytes(16)), i: PBKDF2_ITER }; }

/** Content key from the link key (+ password when the header carries KDF parameters). */
export async function contentKey(linkKey, kdf = null, password = '') {
  if (!kdf) return linkKey;
  if (!password) throw new CryptoFail('password_required', 'Für diesen Link ist ein Passwort nötig.');
  const iter = Math.min(5000000, Math.max(100000, Number(kdf.i) || PBKDF2_ITER));
  const salt = b64u.dec(kdf.s);
  const pwKey = await crypto.subtle.importKey('raw', te.encode(String(password).normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const pwBits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, pwKey, 256));
  const ikm = new Uint8Array(64);
  ikm.set(linkKey, 0); ikm.set(pwBits, 32);
  return hkdfBits(ikm, salt, 'fale-share-v1/pw');
}

/** Derive a content key from another secret (transfer relay: pairing secret + room id). */
export async function deriveKey(secretBytes, saltText, info) { return hkdfBits(secretBytes, te.encode(saltText), info); }

function ivFor(idx) {
  const iv = new Uint8Array(12);
  new DataView(iv.buffer).setBigUint64(4, BigInt(idx));
  return iv;
}
const aadFor = (idx, last) => te.encode(`fale1:${idx}:${last ? 1 : 0}`);

/** Number of chunks / ciphertext size for a plaintext size. chunkSize = ciphertext bytes per chunk. */
export function layout(plainSize, chunkSize) {
  const pcs = chunkSize - TAG;
  const chunks = Math.max(1, Math.ceil(plainSize / pcs));
  return { chunks, plainChunk: pcs, cipherSize: plainSize + chunks * TAG };
}

/**
 * Prepare an object for upload: encrypted header + a chunk encryptor.
 * → { header (JSON string), chunks, cipherSize, encryptChunk(idx, plainBytes) }
 */
export async function sealObject(ck, meta, { plainSize, chunkSize, kdf = null, extra = null }) {
  const nonce = randomBytes(16);
  const [dataKey, metaKey] = await Promise.all([hkdfAes(ck, nonce, 'fale-share-v1/data'), hkdfAes(ck, nonce, 'fale-share-v1/meta')]);
  const iv = randomBytes(12);
  const mct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode('fale1:meta') }, metaKey, te.encode(JSON.stringify(meta))));
  const m = new Uint8Array(12 + mct.length); m.set(iv, 0); m.set(mct, 12);
  const lay = layout(plainSize, chunkSize);
  const header = JSON.stringify({ v: 1, n: b64u.enc(nonce), m: b64u.enc(m), k: kdf, c: chunkSize, ...(extra || {}) });
  return {
    header, chunks: lay.chunks, cipherSize: lay.cipherSize, plainChunk: lay.plainChunk,
    encryptChunk: async (idx, plain) => new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivFor(idx), additionalData: aadFor(idx, idx === lay.chunks - 1) }, dataKey, plain)),
  };
}

export function parseHeader(headerStr) {
  let h;
  try { h = JSON.parse(headerStr); } catch { h = null; }
  if (!h || h.v !== 1 || typeof h.n !== 'string' || typeof h.m !== 'string') throw new CryptoFail('bad_header', 'Diese Datei hat ein unbekanntes Format.');
  return h;
}

/** Decrypt the metadata; throws CryptoFail('wrong_key') when the key/password does not fit. */
export async function openObject(ck, headerStr) {
  const h = parseHeader(headerStr);
  const nonce = b64u.dec(h.n);
  const [dataKey, metaKey] = await Promise.all([hkdfAes(ck, nonce, 'fale-share-v1/data'), hkdfAes(ck, nonce, 'fale-share-v1/meta')]);
  const m = b64u.dec(h.m);
  let meta;
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: m.subarray(0, 12), additionalData: te.encode('fale1:meta') }, metaKey, m.subarray(12));
    meta = JSON.parse(td.decode(pt));
  } catch {
    throw new CryptoFail('wrong_key', h.k ? 'Das Passwort ist falsch – oder der Link ist unvollständig.' : 'Der Schlüssel im Link passt nicht. Bitte prüfe, ob der Link vollständig kopiert wurde.');
  }
  return {
    meta, header: h,
    decryptChunk: async (idx, ct, last) => {
      try { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivFor(idx), additionalData: aadFor(idx, last) }, dataKey, ct)); }
      catch { throw new CryptoFail('corrupt', 'Die Datei ist beschädigt oder wurde verändert – die Entschlüsselung wurde abgebrochen.'); }
    },
  };
}

export async function sha256Hex(data) {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data;
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(d, b => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- file requests ("Unterlagen anfordern")
// Uploads that only the requester can open – not even someone who has the upload link.
//   requester: P-256 key pair. The PUBLIC key travels inside the request header (encrypted with the link key, so
//              the server can neither read nor swap it); the private key stays on the requester's device.
//   per uploaded file: a fresh ephemeral key pair E; content key = HKDF(ECDH(E, requester), salt = E.pub,
//              "fale-request-v1/file") → used with sealObject as usual; the header carries E.pub as "e".
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
async function ecdhKey(shared, epk) { return hkdfBits(shared, epk, 'fale-request-v1/file'); }

/** New requester key pair → { pub (raw, base64url), priv (JWK – keep on this device only) }. */
export async function newRequestKeys() {
  const kp = await crypto.subtle.generateKey(ECDH, true, ['deriveBits']);
  return { pub: b64u.enc(new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))), priv: await crypto.subtle.exportKey('jwk', kp.privateKey) };
}

/** Uploader side: content key for one file + the ephemeral public key for the header. */
export async function uploadKey(pubB64) {
  let peer;
  try { peer = await crypto.subtle.importKey('raw', b64u.dec(pubB64), ECDH, false, []); }
  catch { throw new CryptoFail('bad_header', 'Diese Anfrage ist beschädigt. Bitte frag nach einem neuen Link.'); }
  const eph = await crypto.subtle.generateKey(ECDH, true, ['deriveBits']);
  const epk = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, eph.privateKey, 256));
  return { ck: await ecdhKey(shared, epk), e: b64u.enc(epk) };
}

/** Requester side: content key of one uploaded file from the private key (JWK) and the header's "e". */
export async function ownerFileKey(privJwk, eB64) {
  try {
    const priv = await crypto.subtle.importKey('jwk', privJwk, ECDH, false, ['deriveBits']);
    const epk = b64u.dec(eB64);
    const peer = await crypto.subtle.importKey('raw', epk, ECDH, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, priv, 256));
    return await ecdhKey(shared, epk);
  } catch { throw new CryptoFail('wrong_key', 'Diese Datei lässt sich mit dem Schlüssel auf diesem Gerät nicht öffnen.'); }
}

/** Encrypt / decrypt small JSON messages (transfer signalling). */
export async function sealMsg(keyBytes, obj, label = 'fale-transfer-v1/msg') {
  const key = await hkdfAes(keyBytes, new Uint8Array(16), label);
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length); out.set(iv, 0); out.set(ct, 12);
  return b64u.enc(out);
}
export async function openMsg(keyBytes, str, label = 'fale-transfer-v1/msg') {
  const key = await hkdfAes(keyBytes, new Uint8Array(16), label);
  const b = b64u.dec(str);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.subarray(0, 12) }, key, b.subarray(12));
  return JSON.parse(td.decode(pt));
}
