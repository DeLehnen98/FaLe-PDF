'use strict';
// Verification of Supabase Auth access tokens (the optional FaLe-Konto) on our API.
//
//   verifyAccessToken(cfg, token, { fresh })  → { id, email, sessionId, via }   (throws HttpError 401 'invalid_account')
//
// Two ways, both without any secret on our side:
//   1. asymmetric JWT signing keys (ES256 / RS256): verify the signature locally against the project's
//      JWKS (${SUPABASE_URL}/auth/v1/.well-known/jwks.json, cached 10 min, refetched on an unknown kid)
//      and check iss / aud / role / exp.
//   2. otherwise (legacy HS256 secret, unknown key, JWKS unreachable) or when `fresh` is requested:
//      ask Supabase Auth itself – GET ${SUPABASE_URL}/auth/v1/user with the token + publishable key.
// Results are cached for at most 60 s (never beyond the token's expiry). `fresh: true` bypasses the
// cache and the local check (used before destructive actions such as deleting the account).
// Tokens are never logged.
const crypto = require('node:crypto');
const H = require('./http');
const Sec = require('./security');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JWT_RE = /^[A-Za-z0-9_-]{8,2000}\.[A-Za-z0-9_-]{8,6000}\.[A-Za-z0-9_-]{16,1000}$/;
const JWKS_TTL = 10 * 60 * 1000;
const CACHE_TTL = 60 * 1000;
const SKEW = 30;

let jwks = { url: '', at: 0, keys: new Map(), failedAt: 0 };
const cache = new Map();

const bad = () => new H.HttpError(401, 'invalid_account', 'Bitte melde dich erneut an.');

function decode(token) {
  if (typeof token !== 'string' || token.length > 8192 || !JWT_RE.test(token)) return null;
  const [h, p, s] = token.split('.');
  try {
    return { header: JSON.parse(Sec.fromB64url(h).toString('utf8')), payload: JSON.parse(Sec.fromB64url(p).toString('utf8')), data: `${h}.${p}`, sig: Sec.fromB64url(s) };
  } catch { return null; }
}

async function loadJwks(cfg, fetchImpl, force) {
  const url = `${cfg.supabaseUrl}/auth/v1/.well-known/jwks.json`;
  if (!force && jwks.url === url && Date.now() - jwks.at < JWKS_TTL) return jwks.keys;
  if (jwks.url === url && Date.now() - jwks.failedAt < 30000) return jwks.keys; // don't hammer a failing endpoint
  try {
    const r = await fetchImpl(url, { headers: { apikey: cfg.supabaseKey, Accept: 'application/json' } });
    if (!r.ok) throw new Error('jwks http ' + r.status);
    const j = await r.json();
    const keys = new Map();
    for (const k of (j && j.keys) || []) {
      if (!k.kid || !['EC', 'RSA'].includes(k.kty)) continue;
      try { keys.set(String(k.kid), { alg: k.alg || (k.kty === 'EC' ? 'ES256' : 'RS256'), key: crypto.createPublicKey({ key: k, format: 'jwk' }) }); } catch { /* unsupported key */ }
    }
    jwks = { url, at: Date.now(), keys, failedAt: 0 };
  } catch {
    jwks = { ...jwks, url, failedAt: Date.now() };
  }
  return jwks.keys;
}

function checkClaims(cfg, p, nowSec) {
  const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
  return p && typeof p.sub === 'string' && UUID_RE.test(p.sub)
    && p.iss === `${cfg.supabaseUrl}/auth/v1`
    && aud.includes('authenticated') && p.role === 'authenticated' && p.is_anonymous !== true
    && Number.isFinite(p.exp) && p.exp + SKEW > nowSec;
}

async function viaJwks(cfg, t, fetchImpl, nowSec) {
  const alg = t.header && t.header.alg;
  if (!['ES256', 'RS256'].includes(alg) || !t.header.kid) return null;
  let keys = await loadJwks(cfg, fetchImpl, false);
  let k = keys.get(String(t.header.kid));
  if (!k) { keys = await loadJwks(cfg, fetchImpl, true); k = keys.get(String(t.header.kid)); }
  if (!k || k.alg !== alg) return null; // unknown key → ask Supabase Auth
  let ok = false;
  try {
    ok = alg === 'ES256'
      ? crypto.verify('sha256', Buffer.from(t.data), { key: k.key, dsaEncoding: 'ieee-p1363' }, t.sig)
      : crypto.verify('RSA-SHA256', Buffer.from(t.data), k.key, t.sig);
  } catch { ok = false; }
  if (!ok || !checkClaims(cfg, t.payload, nowSec)) throw bad();
  return { id: t.payload.sub.toLowerCase(), email: t.payload.email || null, sessionId: t.payload.session_id || null, via: 'jwks' };
}

async function viaUser(cfg, token, t, fetchImpl, nowSec) {
  if (t.payload && Number.isFinite(t.payload.exp) && t.payload.exp + SKEW < nowSec) throw bad();
  let r;
  try {
    r = await fetchImpl(`${cfg.supabaseUrl}/auth/v1/user`, { headers: { apikey: cfg.supabaseKey, Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  } catch { throw new H.HttpError(503, 'account_unavailable', 'Das Konto ist gerade nicht erreichbar. Bitte versuche es später erneut.'); }
  if (r.status === 401 || r.status === 403 || r.status === 404) throw bad();
  if (!r.ok) throw new H.HttpError(503, 'account_unavailable', 'Das Konto ist gerade nicht erreichbar. Bitte versuche es später erneut.');
  const u = await r.json().catch(() => null);
  if (!u || typeof u.id !== 'string' || !UUID_RE.test(u.id) || u.is_anonymous === true) throw bad();
  return { id: u.id.toLowerCase(), email: u.email || null, sessionId: (t.payload && t.payload.session_id) || null, via: 'user' };
}

async function verifyAccessToken(cfg, token, { fetchImpl = fetch, fresh = false, now = Date.now() } = {}) {
  if (!cfg.supabaseUrl || !cfg.supabaseKey) throw new H.HttpError(503, 'account_not_configured', 'Das FaLe-Konto ist noch nicht eingerichtet.');
  const t = decode(token);
  if (!t) throw bad();
  const nowSec = Math.floor(now / 1000);
  const ck = Sec.sha256hex('acc-tok:' + token);
  if (!fresh) {
    const hit = cache.get(ck);
    if (hit && hit.until > now) return hit.user;
  }
  let user = null;
  if (!fresh) user = await viaJwks(cfg, t, fetchImpl, nowSec);
  if (!user) user = await viaUser(cfg, token, t, fetchImpl, nowSec);
  const exp = t.payload && Number.isFinite(t.payload.exp) ? t.payload.exp * 1000 : now + CACHE_TTL;
  if (cache.size > 2000) cache.clear();
  cache.set(ck, { user, until: Math.min(now + CACHE_TTL, exp) });
  return user;
}

/** Bearer token from the Authorization header (or body.account as a fallback). */
function bearerOf(req, body) {
  const h = String(req.headers.authorization || '');
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  if (m) return m[1];
  return body && typeof body.account === 'string' ? body.account : '';
}

/** Pseudonymous counter key for an account (same shape as a device hash, unlinkable without the server secret). */
function accountKey(secret, userId) {
  return Sec.b64url(crypto.createHmac('sha256', secret).update('acc:' + String(userId).toLowerCase()).digest()).slice(0, 32);
}

function _reset() { jwks = { url: '', at: 0, keys: new Map(), failedAt: 0 }; cache.clear(); }

module.exports = { verifyAccessToken, bearerOf, accountKey, decode, _reset };
