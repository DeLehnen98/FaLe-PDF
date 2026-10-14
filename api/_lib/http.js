'use strict';
// Tiny HTTP helpers for Vercel Node functions (no framework). Works with plain node:http too
// (the local test harness), so only res.statusCode / setHeader / write / end are used.

class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.extra = extra || null;
  }
}

// Security headers for every API response (JSON / octet-stream / SSE – never rendered as a page).
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
};
function applySecurityHeaders(res) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) { try { res.setHeader(k, v); } catch {} }
}

function applyCors(req, res, cfg) {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  if (origin && isAllowedOrigin(origin, cfg)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Fale-Auth, Authorization'); // X-Fale-Auth: share capability / download ticket; Authorization: FaLe-Konto access token
    res.setHeader('Access-Control-Max-Age', '7200'); // preflight cache (Chromium caps at 2 h)
  }
}

/**
 * Strict allow-list (no wildcard, no credentials): the configured origins + the native app origins.
 * http://localhost:<port> / http://127.0.0.1:<port> (local development) are accepted only outside
 * production deployments (VERCEL_ENV !== 'production').
 */
function isAllowedOrigin(origin, cfg) {
  if (typeof origin !== 'string' || origin.length > 200) return false;
  if (cfg.allowedOrigins.includes(origin)) return true;
  if (process.env.VERCEL_ENV === 'production') return false;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d{2,5})?$/.test(origin);
}

function sendJson(res, status, obj) {
  if (res.headersSent) { try { res.end(); } catch {} return; }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

function sendError(res, err) {
  if (err instanceof HttpError) {
    return sendJson(res, err.status, { ok: false, error: err.code, message: err.message, ...(err.extra || {}) });
  }
  // Never echo internal errors (could contain provider responses); log only the type.
  console.error('[fale-api] internal error:', err && err.name, err && err.code);
  return sendJson(res, 500, { ok: false, error: 'internal', message: 'Interner Fehler' });
}

/** Read and parse the JSON body with a size limit. Accepts a body pre-parsed by Vercel. */
async function readJson(req, maxBytes) {
  const declared = Number(req.headers && req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, 'too_large', 'Anfrage zu groß');
  let pre;
  // Vercel's lazy body getter throws on invalid JSON → a clean 400 instead of a 500
  try { pre = req.body; } catch { throw new HttpError(400, 'bad_json', 'Ungültige Anfrage'); }
  if (pre !== undefined && pre !== null && !(pre instanceof Buffer) && typeof pre === 'object') {
    // Vercel parsed the body already (up to its own 4.5 MB limit): enforce our limit + shape anyway
    if (Array.isArray(pre)) throw new HttpError(400, 'bad_json', 'Ungültige Anfrage');
    let size = 0;
    try { size = Buffer.byteLength(JSON.stringify(pre), 'utf8'); } catch { throw new HttpError(400, 'bad_json', 'Ungültige Anfrage'); }
    if (size > maxBytes) throw new HttpError(413, 'too_large', 'Anfrage zu groß');
    return pre;
  }
  // pre-parsed JSON that is not an object (null, 1, true, "x" …): the stream is already consumed –
  // reading it again would hang until the function timeout (cost/DoS), so answer 400 right away
  if (pre !== undefined && typeof pre !== 'string' && !(pre instanceof Buffer)) throw new HttpError(400, 'bad_json', 'Ungültige Anfrage');
  let raw = '';
  if (typeof pre === 'string') raw = pre;
  else if (pre instanceof Buffer) raw = pre.toString('utf8');
  else if (req.readableEnded || req.complete === true && req.readable === false) raw = '';
  else {
    raw = await new Promise((resolve, reject) => {
      let chunks = [];
      let size = 0;
      req.on('data', c => {
        size += c.length;
        if (size > maxBytes) { chunks = null; return; } // keep draining, answer 413 at the end
        if (chunks) chunks.push(c);
      });
      req.on('end', () => (chunks ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(new HttpError(413, 'too_large', 'Anfrage zu groß'))));
      req.on('error', reject);
    });
  }
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) throw new HttpError(413, 'too_large', 'Anfrage zu groß');
  if (!raw) return {};
  try { const j = JSON.parse(raw); if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('x'); return j; }
  catch { throw new HttpError(400, 'bad_json', 'Ungültige Anfrage'); }
}

/**
 * Client address for rate limits. On Vercel, x-real-ip / x-forwarded-for are set by the edge and
 * cannot be spoofed by the client. IPv6 addresses are reduced to their /64 prefix (one subscriber
 * line usually owns a whole /64 – otherwise every address of it would get its own daily limit);
 * IPv4-mapped IPv6 addresses become plain IPv4.
 */
function clientIp(req) {
  const h = req.headers;
  const real = h['x-real-ip'];
  let ip = '';
  if (real) ip = String(real).trim();
  else if (h['x-forwarded-for']) ip = String(h['x-forwarded-for']).split(',')[0].trim();
  else ip = (req.socket && req.socket.remoteAddress) || '0.0.0.0';
  return ipPrefix(ip);
}

function ipPrefix(ip) {
  let s = String(ip || '').trim().toLowerCase().slice(0, 64);
  if (s.startsWith('[')) s = s.slice(1, s.indexOf(']') > 0 ? s.indexOf(']') : undefined);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (mapped) return mapped[1];
  if (!s.includes(':')) return s.replace(/:\d+$/, '');
  s = s.split('%')[0];
  // expand "::" and keep the first four hextets (the /64 network)
  const [head, tail] = s.includes('::') ? s.split('::') : [s, null];
  const a = head ? head.split(':') : [];
  const b = tail ? tail.split(':') : [];
  if (tail !== null) while (a.length + b.length < 8) a.push('0');
  const full = [...a, ...b].map(x => (x || '0').replace(/^0+(?=.)/, ''));
  return full.slice(0, 4).join(':') + '::/64';
}

function query(req) {
  if (req.query && typeof req.query === 'object' && !Array.isArray(req.query)) return req.query;
  const u = new URL(req.url, 'http://x');
  return Object.fromEntries(u.searchParams.entries());
}

/** Raw query string exactly as received (needed for AdMob SSV signature checks). */
function rawQuery(req) {
  const i = String(req.url || '').indexOf('?');
  return i >= 0 ? String(req.url).slice(i + 1) : '';
}

/** Wrap a handler: CORS, OPTIONS, method check, uniform errors. */
function handler(methods, fn, { getConfig, cors = true } = {}) {
  return async (req, res) => {
    const cfg = getConfig();
    try {
      applySecurityHeaders(res);
      if (cors) applyCors(req, res, cfg);
      if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
      if (!methods.includes(req.method)) {
        res.setHeader('Allow', methods.join(', '));
        throw new HttpError(405, 'method_not_allowed', 'Methode nicht erlaubt');
      }
      await fn(req, res, cfg);
    } catch (err) {
      sendError(res, err);
    }
  };
}

module.exports = { HttpError, applyCors, applySecurityHeaders, sendJson, sendError, readJson, clientIp, ipPrefix, query, rawQuery, handler, isAllowedOrigin };
