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

function applyCors(req, res, cfg) {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  if (origin && isAllowedOrigin(origin, cfg)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

function isAllowedOrigin(origin, cfg) {
  if (cfg.allowedOrigins.includes(origin)) return true;
  // http://localhost:<port> and http://127.0.0.1:<port> for local development
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
  if (req.body !== undefined && req.body !== null && !(req.body instanceof Buffer) && typeof req.body === 'object') return req.body;
  let raw = '';
  if (typeof req.body === 'string') raw = req.body;
  else if (req.body instanceof Buffer) raw = req.body.toString('utf8');
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

function clientIp(req) {
  const h = req.headers;
  const real = h['x-real-ip'];
  if (real) return String(real).trim();
  const xff = h['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || '0.0.0.0';
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

module.exports = { HttpError, applyCors, sendJson, sendError, readJson, clientIp, query, rawQuery, handler, isAllowedOrigin };
