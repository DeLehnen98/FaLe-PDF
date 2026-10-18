// HTTP client for /api/share, /api/sign and /api/transfer + encrypted upload/download helpers.
// Only ciphertext, opaque headers and capability tokens are ever sent – see js/share/crypto.js.
import { apiBase } from '../ai/config.js';
import { isNative } from '../platform.js';
import { PDF_ORIGIN } from '../domains.js';
import { sealObject, openObject, layout, CryptoFail } from './crypto.js';

const LS = { device: 'fale-share-device', token: 'fale-share-token' };
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
export const PUBLIC_ORIGIN = PDF_ORIGIN; // primary origin: js/domains.js

export class ShareError extends Error {
  constructor(code, userMessage, extra = {}) {
    super(userMessage || code);
    this.code = code;
    this.userMessage = userMessage || 'Der Dienst ist gerade nicht erreichbar. Bitte versuche es später erneut.';
    Object.assign(this, extra);
  }
}

export function online() { return typeof navigator === 'undefined' || navigator.onLine !== false; }
const OFFLINE_MSG = 'Du bist offline. Teilen, Unterschriften anfordern und Übertragen brauchen eine Internetverbindung.';

/** Base URL for links we hand out (the native app shares links to the public web app). */
export function linkBase() {
  if (typeof window !== 'undefined' && typeof window.__FALE_LINK_BASE__ === 'string') return window.__FALE_LINK_BASE__;
  if (isNative()) return PUBLIC_ORIGIN + '/app/'; // the browser app lives at /app/ (/ is its start page)
  return location.origin + location.pathname;
}

function messageFor(code, status, fallback) {
  switch (code) {
    case 'share_not_configured': return 'Teilen ist noch nicht eingerichtet – bitte versuche es später erneut.';
    case 'offline': return OFFLINE_MSG;
    case 'invalid_token': return 'Die Verbindung musste erneuert werden. Bitte versuche es noch einmal.';
    default: return fallback || (status >= 500 ? 'Der Dienst ist gerade nicht erreichbar. Bitte versuche es später erneut.' : 'Das hat nicht geklappt. Bitte versuche es erneut.');
  }
}

async function call(endpoint, action, { json = null, raw = null, auth = null, signal, binary = false, retries = 0 } = {}) {
  if (!online()) throw new ShareError('offline', OFFLINE_MSG);
  const url = `${apiBase()}/api/${endpoint}?a=${encodeURIComponent(action)}${raw && raw.query ? '&' + raw.query : ''}`;
  const headers = {};
  if (auth) headers['x-fale-auth'] = auth; // capability / download ticket (never the key)
  let body;
  if (raw) { headers['Content-Type'] = 'application/octet-stream'; body = raw.body; }
  else { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json || {}); }
  for (let attempt = 0; ; attempt++) {
    let r;
    try {
      r = await fetch(url, { method: 'POST', headers, body, signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      if (attempt < retries) { await sleep(600 * (attempt + 1)); continue; }
      throw new ShareError('network', online() ? 'Der Dienst ist gerade nicht erreichbar. Bitte versuche es später erneut.' : OFFLINE_MSG);
    }
    if (r.ok) return binary ? new Uint8Array(await r.arrayBuffer()) : r.json();
    if (r.status >= 500 && r.status !== 503 && attempt < retries) { await sleep(600 * (attempt + 1)); continue; }
    let j = null;
    try { j = await r.json(); } catch {}
    const code = (j && j.error) || (r.status === 404 && !j ? 'share_not_configured' : 'http_' + r.status);
    throw new ShareError(code, messageFor(code, r.status, j && j.message), { status: r.status, data: j });
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- device token (pseudonymous, for rate limits)
function deviceId() {
  let id = ls.get(LS.device);
  if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
    const b = new Uint8Array(24); crypto.getRandomValues(b);
    id = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    ls.set(LS.device, id);
  }
  return id;
}
let tokenP = null;
export async function deviceToken({ renew = false } = {}) {
  if (!renew) { const t = ls.get(LS.token); if (t) return t; }
  if (!tokenP) {
    tokenP = (async () => {
      if (!online()) throw new ShareError('offline', OFFLINE_MSG);
      let r;
      try { r = await fetch(`${apiBase()}/api/ai/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: deviceId() }), credentials: 'omit', cache: 'no-store' }); }
      catch { throw new ShareError('network', 'Der Dienst ist gerade nicht erreichbar. Bitte versuche es später erneut.'); }
      if (!r.ok) {
        let j = null; try { j = await r.json(); } catch {}
        const code = j && j.error === 'ai_not_configured' ? 'share_not_configured' : (j && j.error) || 'http_' + r.status;
        throw new ShareError(code, messageFor(code, r.status, j && j.message));
      }
      const j = await r.json();
      ls.set(LS.token, j.token);
      return j.token;
    })().finally(() => { tokenP = null; });
  }
  return tokenP;
}
/** Run fn(token) and renew the device token once on 401. */
async function withToken(fn) {
  try { return await fn(await deviceToken()); }
  catch (e) { if (e && e.code === 'invalid_token') { ls.del(LS.token); return fn(await deviceToken({ renew: true })); } throw e; }
}
/** Forget the pseudonymous device id + token on this device. */
export function forgetDevice() { ls.del(LS.device); ls.del(LS.token); }

// ---------------------------------------------------------------- endpoints
let cfgCache = null;
export async function shareConfig({ force = false } = {}) {
  if (cfgCache && !force && Date.now() - cfgCache.at < 300000) return cfgCache.data;
  const data = await call('share', 'config');
  cfgCache = { at: Date.now(), data };
  return data;
}

export const shareApi = {
  create: (body) => withToken(token => call('share', 'create', { json: { ...body, token } })),
  put: (id, idx, bytes, auth, signal) => call('share', 'put', { raw: { query: `id=${id}&i=${idx}`, body: bytes }, auth, signal, retries: 2 }),
  finish: (id, auth) => call('share', 'finish', { json: { id, auth } }),
  info: (id) => call('share', 'info', { json: { id } }),
  open: (id) => call('share', 'open', { json: { id } }),
  get: (id, idx, ticket, signal) => call('share', 'get', { raw: { query: `id=${id}&i=${idx}`, body: '' }, auth: ticket, signal, binary: true, retries: 2 }),
  status: (id, auth) => call('share', 'status', { json: { id, auth } }),
  remove: (id, auth) => call('share', 'delete', { json: { id, auth } }),
};
export const signApi = {
  create: (docId, auth, signers) => withToken(token => call('sign', 'create', { json: { token, docId, auth, signers } })),
  open: (s) => call('sign', 'open', { json: { s } }),
  result: (s, body) => call('sign', 'result', { json: { s, ...body } }),
  finish: (s) => call('sign', 'finish', { json: { s } }),
  status: (id, auth) => call('sign', 'status', { json: { id, auth } }),
  remove: (id, auth) => call('sign', 'delete', { json: { id, auth } }),
};
export const requestApi = {
  create: (body) => withToken(token => call('share', 'rq-create', { json: { ...body, token } })),
  open: (u) => call('share', 'rq-open', { json: { u } }),
  upload: (u, body) => call('share', 'rq-upload', { json: { u, ...body } }),
  retract: (id, auth) => call('share', 'rq-retract', { json: { id, auth } }),
  status: (id, auth) => call('share', 'rq-status', { json: { id, auth } }),
  close: (id, auth, closed) => call('share', 'rq-close', { json: { id, auth, closed } }),
  removeFile: (id, auth, file) => call('share', 'rq-remove', { json: { id, auth, file } }),
  remove: (id, auth) => call('share', 'rq-delete', { json: { id, auth } }),
};
export const transferApi = {
  create: () => withToken(token => call('transfer', 'create', { json: { token } })),
  join: ({ code, room }) => call('transfer', 'join', { json: room ? { room } : { code } }),
  send: (room, auth, body) => call('transfer', 'send', { json: { room, auth, body }, retries: 1 }),
  poll: (room, auth, after, signal) => call('transfer', 'poll', { json: { room, auth, after }, signal }),
  close: (room, auth) => call('transfer', 'close', { json: { room, auth } }),
};

// ---------------------------------------------------------------- encrypted upload / download
/**
 * Encrypt a Blob chunk by chunk and upload it.
 *   announce({ size, chunks, header }) → { id, auth } (creates the server object)
 *   → { id, auth, cipherSize }
 */
export async function uploadEncrypted(blob, { ck, meta, kdf = null, extra = null, announce, onProgress, signal }) {
  const cfg = await shareConfig();
  const chunkSize = cfg.chunkSize;
  if (blob.size > cfg.maxBytes) throw new ShareError('too_large', `Die Datei ist zu groß (max. ${Math.round(cfg.maxBytes / 1048576)} MB).`);
  const sealed = await sealObject(ck, meta, { plainSize: blob.size, chunkSize, kdf, extra });
  const created = await announce({ size: sealed.cipherSize, chunks: sealed.chunks, header: sealed.header });
  const { id, auth } = created;
  let done = 0;
  for (let i = 0; i < sealed.chunks; i++) {
    if (signal && signal.aborted) throw new DOMException('Abgebrochen', 'AbortError');
    const plain = new Uint8Array(await blob.slice(i * sealed.plainChunk, Math.min(blob.size, (i + 1) * sealed.plainChunk)).arrayBuffer());
    const ct = await sealed.encryptChunk(i, plain);
    await shareApi.put(id, i, ct, auth, signal);
    done += ct.length;
    onProgress && onProgress(done / sealed.cipherSize);
  }
  return { ...created, header: sealed.header, cipherSize: sealed.cipherSize };
}

/**
 * Download + decrypt an object ({ id, header, size, chunks, chunkSize, ticket }) with content key ck.
 * → { blob, meta }
 */
export async function downloadDecrypted(obj, ck, { onProgress, signal, opened = null } = {}) {
  const o = opened || await openObject(ck, obj.header);
  const parts = [];
  let got = 0;
  for (let i = 0; i < obj.chunks; i++) {
    if (signal && signal.aborted) throw new DOMException('Abgebrochen', 'AbortError');
    const ct = await shareApi.get(obj.id, i, obj.ticket, signal);
    parts.push(await o.decryptChunk(i, ct, i === obj.chunks - 1));
    got += ct.length;
    onProgress && onProgress(got / obj.size);
  }
  if (got !== obj.size) throw new CryptoFail('corrupt', 'Die Datei ist unvollständig angekommen. Bitte versuche es erneut.');
  const blob = new Blob(parts, { type: (o.meta && o.meta.type) || 'application/octet-stream' });
  if (o.meta && Number.isFinite(o.meta.size) && o.meta.size !== blob.size) throw new CryptoFail('corrupt', 'Die Datei ist unvollständig angekommen. Bitte versuche es erneut.');
  return { blob, meta: o.meta };
}

export { layout };
