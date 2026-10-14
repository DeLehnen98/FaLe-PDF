'use strict';
// Request handling for "Sicher teilen" (/api/share), "Unterschrift anfordern" (/api/sign) and
// "Geräte verbinden" (/api/transfer). The files in /api only wire these handlers to Vercel; tests
// call them directly with the in-memory store.
//
// Zero-knowledge by construction: clients encrypt with AES-256-GCM before uploading; the key lives
// only in the URL fragment (#k=…), which browsers never send to a server. This code therefore only
// handles ciphertext, an opaque header (nonce, KDF salt, encrypted metadata), sizes and timestamps.
// Capabilities are random tokens handed out once; only their SHA-256 is stored. Downloads use
// short-lived HMAC tickets. Nothing about the content is logged.
//
// Threat model (summary – details in js/share/crypto.js and js/share/transfer.js):
//   - server / database operator / storage breach: sees ciphertext, sizes, timestamps, counters → no content,
//     no file names, no signer names. Can delete or withhold data (availability), cannot read or forge it
//     (AES-GCM authenticates every chunk, its index and the last-chunk flag).
//   - someone who obtains the full link (incl. #k=…) can read the file until it expires/is revoked, or until
//     the download limit is reached; the optional password adds a second factor (PBKDF2 + HKDF).
//   - abuse (storage filling, scraping): per-device + per-IP-hash daily limits, global capacity cap, 50 MB cap.
const crypto = require('node:crypto');
const C = require('./config');
const H = require('./http');
const Sec = require('./security');
const { getShareStore } = require('./sharestore');

const env = k => String(process.env[k] == null ? '' : process.env[k]).trim();
const num = (k, def, min, max) => { const v = parseFloat(env(k).replace(',', '.')); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def; };
const MiB = 1024 * 1024;

function shareConfig() {
  const chunkKb = Math.round(num('SHARE_CHUNK_KB', 1024, 64, 3072));
  return {
    maxBytes: Math.round(num('SHARE_MAX_MB', 50, 1, 500) * MiB),       // plaintext limit shown to users
    chunkSize: chunkKb * 1024,                                         // ciphertext bytes per chunk (≤ Vercel's 4.5 MB body limit)
    totalBytes: Math.round(num('SHARE_TOTAL_MB', 300, 10, 100000) * MiB), // all active shares together (Supabase free: 500 MB DB)
    devDaily: Math.round(num('SHARE_DEVICE_DAILY', 40, 1, 100000)),
    devDailyBytes: Math.round(num('SHARE_DEVICE_DAILY_MB', 600, 1, 1e6) * MiB),
    ipDaily: Math.round(num('SHARE_IP_DAILY', 80, 1, 100000)),
    ipDailyBytes: Math.round(num('SHARE_IP_DAILY_MB', 1200, 1, 1e6) * MiB),
    dlIpDaily: Math.round(num('SHARE_DL_IP_DAILY', 400, 1, 1e6)),
    dlIpDailyBytes: Math.round(num('SHARE_DL_IP_DAILY_MB', 5000, 1, 1e7) * MiB),
    signDaily: Math.round(num('SIGN_DEVICE_DAILY', 30, 1, 100000)),
    signOpenIpDaily: Math.round(num('SIGN_OPEN_IP_DAILY', 500, 1, 1e6)),
    roomsDaily: Math.round(num('TRANSFER_DEVICE_DAILY', 60, 1, 100000)),
    roomsIpDaily: Math.round(num('TRANSFER_IP_DAILY', 150, 1, 100000)),
    joinIpDaily: Math.round(num('TRANSFER_JOIN_IP_DAILY', 60, 1, 100000)),
    maxSigners: 5,
    roomTtlMs: 60 * 60 * 1000,
    ticketTtlSec: 2 * 3600,
  };
}

const EXPIRIES = [3600, 86400, 604800]; // 1 h, 1 Tag, 7 Tage (max)
const ID_RE = /^[A-Za-z0-9_-]{16,32}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{24,64}$/;
const tagLen = 16;

const randId = () => Sec.b64url(crypto.randomBytes(16));      // 22 chars, 128 bit
const randToken = () => Sec.b64url(crypto.randomBytes(24));   // 32 chars, 192 bit
/** Capability tokens are stored only as SHA-256. */
function capHash(token) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) throw new H.HttpError(403, 'forbidden', 'Keine Berechtigung');
  return Sec.sha256hex('fale-cap:' + token);
}

/** Ciphertext size for a plaintext size (one GCM tag per chunk). */
function cipherSize(plain, chunkSize) {
  const pcs = chunkSize - tagLen;
  const chunks = Math.max(1, Math.ceil(plain / pcs));
  return plain + chunks * tagLen;
}

// ------------------------------------------------------------------ download tickets (HMAC, short-lived)
function makeTicket(secret, id, nowMs, ttlSec) {
  const exp = Math.floor(nowMs / 1000) + ttlSec;
  const body = `t1.${id}.${exp}`;
  return `${body}.${Sec.b64url(crypto.createHmac('sha256', secret).update('dl:' + body).digest()).slice(0, 43)}`;
}
function checkTicket(secret, ticket, id, nowMs) {
  const m = /^t1\.([A-Za-z0-9_-]{16,32})\.(\d{9,11})\.([A-Za-z0-9_-]{43})$/.exec(String(ticket || ''));
  if (!m || m[1] !== id || Number(m[2]) * 1000 < nowMs) return false;
  const want = Sec.b64url(crypto.createHmac('sha256', secret).update(`dl:t1.${m[1]}.${m[2]}`).digest()).slice(0, 43);
  return Sec.safeEqual(want, m[3]);
}

/** Raw request body (octet-stream) with a size limit. Accepts a Buffer pre-read by Vercel. */
async function readRaw(req, maxBytes) {
  if (Buffer.isBuffer(req.body)) { if (req.body.length > maxBytes) throw new H.HttpError(413, 'too_large', 'Teil zu groß'); return req.body; }
  if (typeof req.body === 'string') { const b = Buffer.from(req.body, 'binary'); if (b.length > maxBytes) throw new H.HttpError(413, 'too_large', 'Teil zu groß'); return b; }
  return new Promise((resolve, reject) => {
    let chunks = [], size = 0;
    req.on('data', c => { size += c.length; if (size > maxBytes) { chunks = null; return; } if (chunks) chunks.push(c); });
    req.on('end', () => (chunks ? resolve(Buffer.concat(chunks)) : reject(new H.HttpError(413, 'too_large', 'Teil zu groß'))));
    req.on('error', reject);
  });
}

const MESSAGES = {
  not_found: [404, 'Dieser Link ist abgelaufen oder wurde gelöscht.'],
  forbidden: [403, 'Keine Berechtigung'],
  exhausted: [410, 'Das Download-Limit für diesen Link ist erreicht.'],
  capacity: [503, 'Der Speicher für geteilte Dateien ist gerade voll. Bitte versuche es später erneut oder wähle eine kürzere Laufzeit.'],
  bad_size: [400, 'Ungültige Daten'],
  bad_index: [400, 'Ungültige Daten'],
  complete: [409, 'Bereits abgeschlossen'],
  incomplete: [409, 'Der Upload ist unvollständig.'],
  waiting: [409, 'Vor dir muss noch jemand unterschreiben.'],
  signed: [409, 'Bereits unterschrieben'],
  taken: [409, 'Mit diesem Code ist bereits ein Gerät verbunden.'],
  full: [429, 'Zu viele Nachrichten'],
};
function fail(r, extra) {
  const reason = (r && r.reason) || 'not_found';
  const [status, msg] = MESSAGES[reason] || [400, 'Ungültige Anfrage'];
  return new H.HttpError(status, reason, msg, extra);
}

function pub(o) {
  return { id: o.id, kind: o.kind, header: o.header, size: Number(o.size), chunks: Number(o.chunks), chunkSize: Number(o.chunk_size),
    expiresAt: o.expires_at, createdAt: o.created_at, maxDownloads: o.max_downloads == null ? null : Number(o.max_downloads), downloads: Number(o.downloads) };
}

function makeShareCore(overrides = {}) {
  const deps = { getConfig: C.getConfig, getShareStore, now: () => new Date(), ...overrides };

  function ctxOf(req, cfg) {
    const now = deps.now();
    const day = Sec.dayKey(cfg.timeZone, now);
    return { now, day, ip: Sec.ipHash(cfg.ipSalt, H.clientIp(req), day) };
  }
  function requireBase(cfg) {
    if (!C.secretsConfigured(cfg) || !C.storeConfigured(cfg)) throw new H.HttpError(503, 'share_not_configured', 'Teilen ist noch nicht eingerichtet.');
  }
  function deviceOf(cfg, token) {
    const dh = Sec.verifyToken(cfg.tokenSecret, token);
    if (!dh) throw new H.HttpError(401, 'invalid_token', 'Gerätekennung ungültig – bitte erneut verbinden');
    return dh;
  }
  function action(req, body) { return String(H.query(req).a || (body && body.a) || ''); }
  function authOf(req, body) { return (body && body.auth) || req.headers['x-fale-auth'] || ''; }
  async function limit(store, c, kind, keys, nLimits, bytes, bLimits, msg) {
    const r = await store.rate({ day: c.day, kind, keys, nLimits, bytes, bLimits });
    if (!r || !r.ok) throw new H.HttpError(429, 'share_limit', msg || 'Tageslimit erreicht. Morgen geht es weiter.');
  }
  // the migration may not be applied yet on a fresh project → a clear 503 instead of a 500
  const guard = fn => async (req, res, cfg) => {
    try { await fn(req, res, cfg); }
    catch (e) {
      if (e && e.code === 'store_error' && e.status === 404) throw new H.HttpError(503, 'share_not_configured', 'Teilen ist noch nicht eingerichtet.');
      throw e;
    }
  };
  const ticket = (cfg, id, c) => makeTicket(cfg.tokenSecret, id, c.now.getTime(), shareConfig().ticketTtlSec);
  const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

  function validateUpload(body, sc) {
    const size = body.size, chunks = body.chunks, header = body.header;
    const maxCipher = cipherSize(sc.maxBytes, sc.chunkSize);
    if (!intIn(size, 1, maxCipher)) throw new H.HttpError(413, 'too_large', `Die Datei ist zu groß (max. ${Math.round(sc.maxBytes / MiB)} MB).`);
    if (chunks !== Math.max(1, Math.ceil(size / sc.chunkSize))) throw new H.HttpError(400, 'bad_input', 'Ungültige Aufteilung');
    if (typeof header !== 'string' || header.length < 2 || header.length > 60000) throw new H.HttpError(400, 'bad_input', 'Ungültiger Kopf');
    try { const j = JSON.parse(header); if (!j || j.v !== 1) throw new Error('v'); } catch { throw new H.HttpError(400, 'bad_input', 'Ungültiger Kopf'); }
  }

  // ================================================================ POST /api/share?a=…
  const share = H.handler(['POST'], guard(async (req, res, cfg) => {
    const sc = shareConfig();
    const a = action(req);
    if (a === 'config') {
      const configured = C.secretsConfigured(cfg) && C.storeConfigured(cfg);
      H.sendJson(res, 200, { ok: true, configured, maxBytes: sc.maxBytes, chunkSize: sc.chunkSize, expiries: EXPIRIES, maxSigners: sc.maxSigners });
      return;
    }
    requireBase(cfg);
    const store = deps.getShareStore(cfg);
    const c = ctxOf(req, cfg);

    if (a === 'put') { // raw ciphertext chunk; auth = owner token (or signer token for a signed result)
      const q = H.query(req);
      const id = String(q.id || ''), idx = Number(q.i);
      if (!ID_RE.test(id) || !Number.isInteger(idx) || idx < 0 || idx > 4095) throw new H.HttpError(400, 'bad_input', 'Ungültige Anfrage');
      const owner = capHash(authOf(req));
      const buf = await readRaw(req, sc.chunkSize);
      if (!buf.length) throw new H.HttpError(400, 'bad_input', 'Leerer Teil');
      const r = await store.put({ id, owner, idx, data: buf.toString('base64') });
      if (!r || !r.ok) throw fail(r);
      H.sendJson(res, 200, { ok: true });
      return;
    }
    if (a === 'get') { // raw ciphertext chunk with a download ticket
      const q = H.query(req);
      const id = String(q.id || ''), idx = Number(q.i);
      if (!ID_RE.test(id) || !Number.isInteger(idx) || idx < 0 || idx > 4095) throw new H.HttpError(400, 'bad_input', 'Ungültige Anfrage');
      if (!checkTicket(cfg.tokenSecret, req.headers['x-fale-auth'], id, c.now.getTime())) throw new H.HttpError(403, 'forbidden', 'Der Download-Zugang ist abgelaufen. Bitte öffne den Link erneut.');
      const r = await store.get({ id, idx });
      if (!r || !r.ok) throw fail(r);
      const buf = Buffer.from(r.data, 'base64');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Length', String(buf.length));
      res.end(buf);
      return;
    }

    const body = await H.readJson(req, 80000);
    if (a === 'create') {
      const device = deviceOf(cfg, body.token);
      const kind = body.kind;
      if (!['file', 'relay', 'sign-doc'].includes(kind)) throw new H.HttpError(400, 'bad_input', 'Ungültige Art');
      validateUpload(body, sc);
      let expiresIn = Number(body.expiresIn);
      if (kind === 'relay') expiresIn = 3600;
      if (!EXPIRIES.includes(expiresIn)) throw new H.HttpError(400, 'bad_input', 'Ungültige Laufzeit');
      let maxDownloads = body.maxDownloads == null ? null : Number(body.maxDownloads);
      if (kind === 'relay') maxDownloads = 3;
      if (kind === 'sign-doc') maxDownloads = null;
      if (maxDownloads !== null && !intIn(maxDownloads, 1, 100)) throw new H.HttpError(400, 'bad_input', 'Ungültiges Download-Limit');
      await limit(store, c, 'up', ['d:' + device, 'i:' + c.ip], [sc.devDaily, sc.ipDaily], body.size, [sc.devDailyBytes, sc.ipDailyBytes],
        'Tageslimit für geteilte Dateien erreicht. Morgen geht es weiter.');
      const id = randId(), owner = randToken();
      const expiresAt = new Date(c.now.getTime() + expiresIn * 1000);
      const r = await store.create({ id, kind, owner: capHash(owner), parent: null, header: body.header, size: body.size, chunks: body.chunks, chunkSize: sc.chunkSize, expiresAt, maxDownloads, cap: sc.totalBytes });
      if (!r || !r.ok) throw fail(r);
      H.sendJson(res, 200, { ok: true, id, auth: owner, chunkSize: sc.chunkSize, expiresAt: expiresAt.toISOString(), maxDownloads });
      return;
    }
    if (a === 'finish') {
      const id = String(body.id || '');
      if (!ID_RE.test(id)) throw new H.HttpError(400, 'bad_input', 'Ungültige Anfrage');
      const r = await store.finish({ id, owner: capHash(authOf(req, body)) });
      if (!r || !r.ok) throw fail(r);
      H.sendJson(res, 200, { ok: true, object: pub(r.object) });
      return;
    }
    if (a === 'info' || a === 'open') {
      const id = String(body.id || '');
      if (!ID_RE.test(id)) throw fail({ reason: 'not_found' });
      if (a === 'info') {
        const r = await store.info({ id });
        if (!r || !r.ok || !['file', 'relay'].includes(r.object.kind)) throw fail({ reason: 'not_found' });
        const o = pub(r.object);
        H.sendJson(res, 200, { ok: true, object: o, exhausted: o.maxDownloads != null && o.downloads >= o.maxDownloads });
        return;
      }
      const info = await store.info({ id });
      if (!info || !info.ok) throw fail(info);
      await limit(store, c, 'dl', ['i:' + c.ip], [sc.dlIpDaily], Number(info.object.size), [sc.dlIpDailyBytes], 'Download-Tageslimit für dein Netzwerk erreicht.');
      const r = await store.open({ id });
      if (!r || !r.ok) throw fail(r);
      H.sendJson(res, 200, { ok: true, object: pub(r.object), ticket: ticket(cfg, id, c) });
      return;
    }
    if (a === 'status') {
      const id = String(body.id || '');
      if (!ID_RE.test(id)) throw new H.HttpError(400, 'bad_input', 'Ungültige Anfrage');
      const r = await store.status({ id, owner: capHash(authOf(req, body)) });
      if (!r || !r.ok) throw fail(r);
      H.sendJson(res, 200, { ok: true, exists: !!r.exists, object: r.exists ? pub(r.object) : null });
      return;
    }
    if (a === 'delete') {
      const id = String(body.id || '');
      if (!ID_RE.test(id)) throw new H.HttpError(400, 'bad_input', 'Ungültige Anfrage');
      const r = await store.remove({ id, owner: capHash(authOf(req, body)) });
      H.sendJson(res, 200, { ok: true, deleted: !!(r && r.deleted) });
      return;
    }
    throw new H.HttpError(400, 'unknown_action', 'Unbekannte Aktion');
  }), { getConfig: () => deps.getConfig() });

  // ================================================================ POST /api/sign?a=…
  const sign = H.handler(['POST'], guard(async (req, res, cfg) => {
    requireBase(cfg);
    const sc = shareConfig();
    const store = deps.getShareStore(cfg);
    const c = ctxOf(req, cfg);
    const a = action(req);
    const body = await H.readJson(req, 80000);

    if (a === 'create') { // the encrypted PDF was uploaded before as kind 'sign-doc' (same owner token)
      const device = deviceOf(cfg, body.token);
      const docId = String(body.docId || '');
      const n = Number(body.signers);
      if (!ID_RE.test(docId) || !intIn(n, 1, sc.maxSigners)) throw new H.HttpError(400, 'bad_input', 'Ungültige Anfrage');
      await limit(store, c, 'sign', ['d:' + device, 'i:' + c.ip], [sc.signDaily, sc.signDaily * 2], 0, [1, 1], 'Tageslimit für Unterschriftsanfragen erreicht.');
      const id = randId();
      const tokens = Array.from({ length: n }, randToken);
      const r = await store.signCreate({ id, owner: capHash(authOf(req, body)), docId, signers: tokens.map(capHash) });
      if (!r || !r.ok) throw fail(r);
      H.sendJson(res, 200, { ok: true, id, signers: tokens, createdAt: r.created_at, expiresAt: r.expires_at });
      return;
    }
    if (a === 'open') {
      const signer = capHash(body.s);
      await limit(store, c, 'sopen', ['i:' + c.ip], [sc.signOpenIpDaily], 0, [1], 'Tageslimit für dein Netzwerk erreicht.');
      const r = await store.signOpen({ signer });
      if (!r || !r.ok) throw fail(r, r && r.reason === 'waiting' ? { idx: r.idx, count: r.count } : undefined);
      const src = pub(r.source);
      const out = {
        ok: true, idx: r.idx, count: r.count, status: r.status, createdAt: r.created_at, expiresAt: r.expires_at,
        viewedAt: r.viewed_at, signedAt: r.signed_at, now: r.now,
        doc: { id: r.doc.id, header: r.doc.header }, source: { ...src, ticket: ticket(cfg, src.id, c) },
        result: r.result ? { ...pub(r.result), ticket: ticket(cfg, r.result.id, c) } : null,
      };
      H.sendJson(res, 200, out);
      return;
    }
    if (a === 'result') {
      const signer = capHash(body.s);
      validateUpload(body, sc);
      const id = randId();
      const r = await store.signResult({ signer, id, header: body.header, size: body.size, chunks: body.chunks, chunkSize: sc.chunkSize, cap: sc.totalBytes });
      if (!r || !r.ok) throw fail(r);
      H.sendJson(res, 200, { ok: true, id, chunkSize: sc.chunkSize, expiresAt: r.expires_at });
      return;
    }
    if (a === 'finish') {
      const r = await store.signFinish({ signer: capHash(body.s) });
      if (!r || !r.ok) throw fail(r);
      H.sendJson(res, 200, { ok: true, signedAt: r.signed_at });
      return;
    }
    if (a === 'status') {
      const id = String(body.id || '');
      if (!ID_RE.test(id)) throw new H.HttpError(400, 'bad_input', 'Ungültige Anfrage');
      const r = await store.signStatus({ id, owner: capHash(authOf(req, body)) });
      if (!r || !r.ok) throw fail(r);
      if (!r.exists) { H.sendJson(res, 200, { ok: true, exists: false, expired: !!r.expired }); return; }
      H.sendJson(res, 200, {
        ok: true, exists: true, createdAt: r.created_at, expiresAt: r.expires_at,
        signers: (r.signers || []).map(s => ({ idx: s.idx, status: s.status, viewedAt: s.viewed_at, signedAt: s.signed_at,
          result: s.result ? { ...pub(s.result), ticket: ticket(cfg, s.result.id, c) } : null })),
      });
      return;
    }
    if (a === 'delete') {
      const id = String(body.id || '');
      if (!ID_RE.test(id)) throw new H.HttpError(400, 'bad_input', 'Ungültige Anfrage');
      const r = await store.signDelete({ id, owner: capHash(authOf(req, body)) });
      if (!r || !r.ok) throw fail(r);
      H.sendJson(res, 200, { ok: true, deleted: !!r.deleted });
      return;
    }
    throw new H.HttpError(400, 'unknown_action', 'Unbekannte Aktion');
  }), { getConfig: () => deps.getConfig() });

  // ================================================================ POST /api/transfer?a=…
  // Signalling only: SDP offers/answers travel encrypted (key from the pairing secret), the server
  // just relays opaque strings between the two members of a short-lived room.
  const transfer = H.handler(['POST'], guard(async (req, res, cfg) => {
    requireBase(cfg);
    const sc = shareConfig();
    const store = deps.getShareStore(cfg);
    const c = ctxOf(req, cfg);
    const a = action(req);
    const body = await H.readJson(req, 70000);

    if (a === 'create') {
      const device = deviceOf(cfg, body.token);
      await limit(store, c, 'room', ['d:' + device, 'i:' + c.ip], [sc.roomsDaily, sc.roomsIpDaily], 0, [1, 1], 'Tageslimit für Verbindungen erreicht.');
      const id = randId(), host = randToken();
      const expiresAt = new Date(c.now.getTime() + sc.roomTtlMs);
      for (let i = 0; i < 6; i++) {
        const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        const r = await store.roomCreate({ id, code, host: capHash(host), expiresAt });
        if (r && r.ok) { H.sendJson(res, 200, { ok: true, room: id, code, auth: host, expiresAt: expiresAt.toISOString() }); return; }
        if (!r || r.reason !== 'code_taken') throw fail(r);
      }
      throw new H.HttpError(503, 'busy', 'Gerade sind sehr viele Verbindungen offen. Bitte versuche es gleich noch einmal.');
    }
    if (a === 'join') {
      const room = body.room ? String(body.room) : null;
      const code = body.code ? String(body.code).replace(/\D/g, '') : null;
      if (room ? !ID_RE.test(room) : !/^\d{6}$/.test(code || '')) throw new H.HttpError(400, 'bad_input', 'Bitte gib den 6-stelligen Code ein.');
      // every attempt counts (also wrong codes) → guessing 6-digit codes is impractical
      await limit(store, c, 'join', ['i:' + c.ip], [sc.joinIpDaily], 0, [1], 'Zu viele Versuche von deinem Netzwerk heute.');
      const guest = randToken();
      const r = await store.roomJoin({ id: room, code: room ? null : code, guest: capHash(guest), via: room ? 'qr' : 'code' });
      if (!r || !r.ok) {
        if (r && r.reason === 'not_found') throw new H.HttpError(404, 'not_found', 'Code ungültig oder abgelaufen.');
        throw fail(r);
      }
      H.sendJson(res, 200, { ok: true, room: r.room, auth: guest, expiresAt: r.expires_at, via: room ? 'qr' : 'code' });
      return;
    }
    const room = String(body.room || '');
    if (!ID_RE.test(room)) throw new H.HttpError(400, 'bad_input', 'Ungültige Anfrage');
    const auth = capHash(authOf(req, body));
    if (a === 'send') {
      if (typeof body.body !== 'string' || !body.body.length || body.body.length > 60000) throw new H.HttpError(400, 'bad_input', 'Ungültige Nachricht');
      const r = await store.roomSend({ id: room, auth, body: body.body });
      if (!r || !r.ok) throw fail(r);
      H.sendJson(res, 200, { ok: true });
      return;
    }
    if (a === 'poll') {
      const after = Number(body.after) || 0;
      const r = await store.roomPoll({ id: room, auth, after: Math.max(0, Math.floor(after)) });
      if (!r || !r.ok) throw fail(r);
      H.sendJson(res, 200, { ok: true, joined: !!r.joined, via: r.via || null, expiresAt: r.expires_at, msgs: (r.msgs || []).map(m => ({ seq: Number(m.seq), body: m.body })) });
      return;
    }
    if (a === 'close') {
      const r = await store.roomClose({ id: room, auth });
      H.sendJson(res, 200, { ok: true, deleted: !!(r && r.deleted) });
      return;
    }
    throw new H.HttpError(400, 'unknown_action', 'Unbekannte Aktion');
  }), { getConfig: () => deps.getConfig() });

  return { share, sign, transfer, deps };
}

module.exports = { makeShareCore, shareConfig, cipherSize, makeTicket, checkTicket, capHash, EXPIRIES };
