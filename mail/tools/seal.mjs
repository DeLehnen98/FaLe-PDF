// FaLe Seal v1 – public-key "sealed box" shared by the mail server agent (Python), the pairing page
// (mail/web/index.html) and our backend. ECDH P-256 → HKDF-SHA256 (salt = 32 zero bytes,
// info = "fale-seal-1|<kid>") → AES-256-GCM (AAD = kid). Ciphertext is safe to publish.
// Works with WebCrypto in browsers and Node ≥ 20 (globalThis.crypto.subtle).
export const SEAL_VERSION = 'fale-seal-1';
const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();

export const b64u = (buf) => Buffer.from(buf).toString('base64url');
export const unb64u = (s) => new Uint8Array(Buffer.from(s, 'base64url'));

export async function kidOf(jwk) {
  const raw = new Uint8Array([4, ...unb64u(jwk.x), ...unb64u(jwk.y)]);
  return b64u(new Uint8Array(await subtle.digest('SHA-256', raw))).slice(0, 16);
}

const pubJwk = ({ kty, crv, x, y }) => ({ kty, crv, x, y });

export async function generateKeyPair() {
  const kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return { privateKey: kp.privateKey, jwk: pubJwk(await subtle.exportKey('jwk', kp.publicKey)) };
}

async function aesKey(privateKey, peerJwk, kid, usage) {
  const peer = await subtle.importKey('jwk', pubJwk(peerJwk), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = await subtle.deriveBits({ name: 'ECDH', public: peer }, privateKey, 256);
  const hk = await subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(`${SEAL_VERSION}|${kid}`) },
    hk, { name: 'AES-GCM', length: 256 }, false, [usage]);
}

export async function seal(recipientJwk, plaintext) {
  const kid = await kidOf(recipientJwk);
  const eph = await generateKeyPair();
  const key = await aesKey(eph.privateKey, recipientJwk, kid, 'encrypt');
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const data = typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext;
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(kid) }, key, data));
  return { v: SEAL_VERSION, kid, epk: eph.jwk, iv: b64u(iv), ct: b64u(ct) };
}

export async function unseal(privateKey, myJwk, box) {
  if (box?.v !== SEAL_VERSION) throw new Error('unknown seal version');
  const kid = await kidOf(myJwk);
  if (box.kid !== kid) throw new Error('sealed for a different key (kid mismatch)');
  const key = await aesKey(privateKey, box.epk, kid, 'decrypt');
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64u(box.iv), additionalData: enc.encode(kid) }, key, unb64u(box.ct));
  return new TextDecoder().decode(pt);
}
