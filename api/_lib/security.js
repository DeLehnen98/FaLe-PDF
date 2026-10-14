'use strict';
// Crypto helpers: pseudonymous device tokens (HMAC), salted IP hashes, AdMob SSV signature
// verification (ECDSA P-256 / SHA-256), Google service-account JWTs (RS256). node:crypto only.
const crypto = require('node:crypto');

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmac = (key, s) => crypto.createHmac('sha256', key).update(s).digest();

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const DEVICE_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** Pseudonymous device hash: HMAC of the client's random id (the id itself is never stored). */
function deviceHash(secret, deviceId) {
  return b64url(hmac(secret, 'dev:' + deviceId)).slice(0, 32);
}

/** Token format: v1.<deviceHash>.<issuedAtSec>.<sig> (sig = HMAC over the first three parts). */
function issueToken(secret, dh, now = Date.now()) {
  const body = `v1.${dh}.${Math.floor(now / 1000)}`;
  return `${body}.${b64url(hmac(secret, 'tok:' + body)).slice(0, 43)}`;
}

/** Returns the device hash or null when the token is missing/forged. */
function verifyToken(secret, token) {
  if (typeof token !== 'string' || token.length > 200) return null;
  const m = /^v1\.([A-Za-z0-9_-]{32})\.(\d{9,11})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return null;
  const body = `v1.${m[1]}.${m[2]}`;
  const want = b64url(hmac(secret, 'tok:' + body)).slice(0, 43);
  return safeEqual(want, m[3]) ? m[1] : null;
}

/** Salted, day-scoped IP hash: the same IP cannot be linked across days. */
function ipHash(salt, ip, day) {
  return sha256hex(`${salt}|${day}|${String(ip || '').toLowerCase()}`).slice(0, 40);
}

// ------------------------------------------------------------------ dates (Europe/Berlin)
function dayKey(tz = 'Europe/Berlin', now = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const g = t => p.find(x => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
const monthKey = (tz, now) => dayKey(tz, now).slice(0, 7);

// ------------------------------------------------------------------ AdMob SSV
// Google signs the callback query string. Spec: the signed message is the query string up to
// (not including) "&signature=", and signature + key_id are always the last two parameters.
// https://developers.google.com/admob/android/ssv
let keyCache = { at: 0, keys: null };
const KEY_TTL = 12 * 3600 * 1000;

async function fetchVerifierKeys(url, { fetchImpl = fetch, force = false } = {}) {
  if (!force && keyCache.keys && Date.now() - keyCache.at < KEY_TTL) return keyCache.keys;
  const r = await fetchImpl(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error('verifier keys http ' + r.status);
  const j = await r.json();
  const keys = new Map();
  for (const k of (j && j.keys) || []) {
    const id = String(k.keyId);
    if (k.pem) keys.set(id, k.pem);
    else if (k.base64) keys.set(id, `-----BEGIN PUBLIC KEY-----\n${k.base64}\n-----END PUBLIC KEY-----`);
  }
  keyCache = { at: Date.now(), keys };
  return keys;
}
function _setVerifierKeys(map) { keyCache = { at: Date.now(), keys: map }; }

/**
 * Verify an SSV callback. rawQs: raw query string. Returns { ok, params, reason }.
 * getKeys(force) → Map(keyId → PEM)
 */
let lastForcedKeyFetch = 0;
async function verifySsv(rawQs, getKeys) {
  if (typeof rawQs !== 'string' || rawQs.length > 8192) return { ok: false, reason: 'bad_query' };
  const sigIdx = rawQs.indexOf('&signature=');
  if (sigIdx <= 0) return { ok: false, reason: 'no_signature' };
  const message = rawQs.slice(0, sigIdx);
  // signature + key_id must be the LAST two parameters and nothing may follow them. Every other
  // parameter is taken from the signed part only – an appended, unsigned second custom_data or
  // transaction_id can therefore never override the signed values.
  const tail = /^&signature=([A-Za-z0-9_-]{16,1024}(?:=|%3D){0,2})&key_id=(\d{1,20})$/.exec(rawQs.slice(sigIdx));
  if (!tail) return { ok: false, reason: 'no_signature' };
  const params = {};
  for (const [k, v] of new URLSearchParams(message).entries()) {
    if (Object.prototype.hasOwnProperty.call(params, k)) return { ok: false, reason: 'duplicate_param' };
    params[k] = v;
  }
  const sig = tail[1].replace(/%3D/gi, ''), keyId = tail[2];
  params.signature = sig; params.key_id = keyId;
  let keys = await getKeys(false);
  let pem = keys.get(String(keyId));
  // key rotation: refetch for an unknown key id – at most once a minute (no amplification by random ids)
  if (!pem && Date.now() - lastForcedKeyFetch > 60000) { lastForcedKeyFetch = Date.now(); keys = await getKeys(true); pem = keys.get(String(keyId)); }
  if (!pem) return { ok: false, reason: 'unknown_key' };
  let ok = false;
  try {
    ok = crypto.verify('sha256', Buffer.from(message, 'utf8'), { key: pem, dsaEncoding: 'der' }, fromB64url(sig));
  } catch { ok = false; }
  return ok ? { ok: true, params } : { ok: false, reason: 'bad_signature' };
}

// ------------------------------------------------------------------ Google service account (RS256 JWT)
let gTokenCache = { key: '', token: '', exp: 0 };
async function googleAccessToken(saJson, scope, { fetchImpl = fetch } = {}) {
  const sa = typeof saJson === 'string' ? JSON.parse(saJson) : saJson;
  const cacheKey = sa.client_email + '|' + scope;
  if (gTokenCache.key === cacheKey && gTokenCache.exp - 60 > Date.now() / 1000) return gTokenCache.token;
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope, aud: tokenUri, iat: now, exp: now + 3600 }));
  const sig = b64url(crypto.sign('RSA-SHA256', Buffer.from(`${head}.${claims}`), sa.private_key));
  const r = await fetchImpl(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${sig}` }).toString(),
  });
  if (!r.ok) throw new Error('google token http ' + r.status);
  const j = await r.json();
  gTokenCache = { key: cacheKey, token: j.access_token, exp: now + (j.expires_in || 3600) };
  return j.access_token;
}

module.exports = {
  b64url, fromB64url, sha256hex, safeEqual, DEVICE_ID_RE, deviceHash, issueToken, verifyToken, ipHash,
  dayKey, monthKey, fetchVerifierKeys, _setVerifierKeys, verifySsv, googleAccessToken,
};
