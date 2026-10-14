// Cloud-KI client: device pseudonym, consent state, quota cache and the request helper.
// Nothing here talks to the network on app start – only when the user opens an AI screen
// (anonymous availability check) or actively starts an AI task after giving consent.
import { apiBase, outputLang } from './config.js';
import { isNative, platformName } from '../platform.js';

const K = { device: 'fale-ai-device', token: 'fale-ai-token', consent: 'fale-ai-consent', cloud: 'fale-ai-cloud', quota: 'fale-ai-quota' };
export const CONSENT_VERSION = 1;
const APP_VERSION = '2.1.0';

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

let statusCache = null; // { at, data } – availability check, 30 s

export class AiError extends Error {
  constructor(code, userMessage, extra = {}) {
    super(userMessage || code);
    this.code = code;
    this.userMessage = userMessage || 'Die KI ist gerade nicht erreichbar. Bitte versuche es später erneut.';
    Object.assign(this, extra);
  }
}

// ---------------------------------------------------------------- state
export function online() { return typeof navigator === 'undefined' || navigator.onLine !== false; }
export function cloudDisabled() { return ls.get(K.cloud) === 'off'; }
export function setCloudDisabled(off) { if (off) ls.set(K.cloud, 'off'); else ls.del(K.cloud); emit('fale:ai-state'); }
export function consent() { try { const c = JSON.parse(ls.get(K.consent) || 'null'); return c && c.v === CONSENT_VERSION ? c : null; } catch { return null; } }
export function hasConsent() { return !!consent(); }
export function giveConsent(provider) { ls.set(K.consent, JSON.stringify({ v: CONSENT_VERSION, at: Date.now(), provider: provider || '' })); emit('fale:ai-state'); }
/** Withdraw consent: forget the device pseudonym and token on this device as well. */
export function revokeConsent() { [K.consent, K.token, K.device, K.quota].forEach(ls.del); emit('fale:ai-state'); }

function emit(name, detail) { try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch {} }

function deviceId() {
  let id = ls.get(K.device);
  if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
    const b = new Uint8Array(24);
    crypto.getRandomValues(b);
    id = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    ls.set(K.device, id);
  }
  return id;
}

function today() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
/** Last known quota (from this device's cache, no network). */
export function cachedQuota() {
  try { const q = JSON.parse(ls.get(K.quota) || 'null'); return q && q.day === today() ? q.quota : null; } catch { return null; }
}
function storeQuota(q) {
  if (!q) return;
  ls.set(K.quota, JSON.stringify({ day: today(), quota: q }));
  emit('fale:ai-quota', q);
}

// ---------------------------------------------------------------- HTTP
async function postJson(path, body, { signal } = {}) {
  let r;
  try {
    r = await fetch(apiBase() + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal, credentials: 'omit', cache: 'no-store' });
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw new AiError('network', online() ? 'Der KI-Dienst ist gerade nicht erreichbar. Bitte versuche es später erneut.' : 'Du bist offline. Cloud-KI braucht eine Internetverbindung.');
  }
  return r;
}

async function errorFrom(r) {
  statusCache = null; // availability/budget may have changed
  let j = null;
  try { j = await r.json(); } catch {}
  const code = (j && j.error) || (r.status === 404 ? 'ai_not_configured' : 'http_' + r.status);
  if (j && j.quota) storeQuota(j.quota);
  return new AiError(code, messageFor(code, j && j.message), { status: r.status, quota: j && j.quota });
}

export function messageFor(code, fallback) {
  switch (code) {
    case 'ai_not_configured': return 'KI kommt bald – die Cloud-KI ist noch nicht eingerichtet.';
    case 'quota_exhausted': return 'Dein KI-Kontingent für heute ist aufgebraucht.';
    case 'ip_limit': return 'Für dein Netzwerk ist das Tageslimit erreicht. Morgen geht es weiter.';
    case 'budget_exhausted': return 'KI-Kontingent für diesen Monat aufgebraucht. FaLe PDF ist ein kleines Projekt mit festem Monatsbudget – ab dem 1. geht es weiter.';
    case 'invalid_token': return 'Die Verbindung zur KI musste erneuert werden. Bitte versuche es noch einmal.';
    case 'offline': return 'Du bist offline. Cloud-KI braucht eine Internetverbindung.';
    case 'bad_input': return fallback || 'Die Eingabe konnte nicht verarbeitet werden.';
    default: return fallback || 'Die KI ist gerade nicht erreichbar. Bitte versuche es später erneut.';
  }
}

// ---------------------------------------------------------------- availability + quota
/** Availability (+ quota when consent was given). Anonymous without consent: nothing is stored server-side. */
export async function aiStatus({ force = false } = {}) {
  if (!online()) throw new AiError('offline', messageFor('offline'));
  if (statusCache && !force && Date.now() - statusCache.at < 30000) return statusCache.data;
  const tok = hasConsent() ? ls.get(K.token) : null;
  const r = await postJson('/api/ai/quota', tok ? { token: tok } : {});
  if (r.status === 401 && tok) { ls.del(K.token); return aiStatus({ force: true }); }
  if (!r.ok) {
    if (r.status === 404 || r.status === 405 || r.status === 501) { // no backend on this host (e.g. a static mirror)
      const data = { configured: false, provider: null, features: {}, limits: {} };
      statusCache = { at: Date.now(), data };
      return data;
    }
    throw await errorFrom(r);
  }
  const data = await r.json();
  if (data.quota) storeQuota(data.quota);
  statusCache = { at: Date.now(), data };
  return data;
}

/** Fetch today's quota (requires consent). Registers the device on first use. */
export async function refreshQuota() {
  if (!hasConsent()) return null;
  await ensureToken();
  const s = await aiStatus({ force: true });
  return s.quota || null;
}

let tokenP = null;
export async function ensureToken({ renew = false } = {}) {
  if (!hasConsent()) throw new AiError('no_consent', 'Bitte stimme zuerst der Nutzung der Cloud-KI zu.');
  if (!renew) { const t = ls.get(K.token); if (t) return t; }
  if (!tokenP) {
    tokenP = (async () => {
      const r = await postJson('/api/ai/register', { deviceId: deviceId() });
      if (!r.ok) throw await errorFrom(r);
      const j = await r.json();
      ls.set(K.token, j.token);
      return j.token;
    })().finally(() => { tokenP = null; });
  }
  return tokenP;
}
export function currentToken() { return hasConsent() ? ls.get(K.token) : null; }

// ---------------------------------------------------------------- tasks
/**
 * Run a server-defined task.
 * opts: { stream, onDelta(text, full), onMeta(meta), signal }
 * → { output, truncated, note, quota, cut, consumed }
 */
export async function runTask(task, input, options = {}, opts = {}) {
  if (cloudDisabled()) throw new AiError('disabled', 'Cloud-KI ist in den KI-Einstellungen ausgeschaltet.');
  if (!online()) throw new AiError('offline', messageFor('offline'));
  if (!hasConsent()) throw new AiError('no_consent', 'Bitte stimme zuerst der Nutzung der Cloud-KI zu.');
  const lang = options.lang || outputLang();
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await ensureToken({ renew: attempt > 0 });
    const body = { task, input, options: { lang, ...options }, token, stream: !!opts.stream, client: { platform: platformName(), appVersion: APP_VERSION, native: isNative() } };
    const r = await postJson('/api/ai', body, { signal: opts.signal });
    if (r.status === 401 && attempt === 0) { ls.del(K.token); continue; }
    if (!r.ok) throw await errorFrom(r);
    const ct = r.headers.get('content-type') || '';
    if (/text\/event-stream/.test(ct)) return readStream(r, opts);
    const j = await r.json();
    if (j.quota) storeQuota(j.quota);
    return j;
  }
  throw new AiError('invalid_token', messageFor('invalid_token'));
}

async function readStream(r, { onDelta, onMeta, signal }) {
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '', full = '', meta = null, done = null, error = null;
  const handle = (event, data) => {
    if (event === 'meta') { meta = data; if (data.quota) storeQuota(data.quota); onMeta && onMeta(data); }
    else if (event === 'delta') { full += data.t; onDelta && onDelta(data.t, full); }
    else if (event === 'done') { done = data; if (data.quota) storeQuota(data.quota); }
    else if (event === 'error') { error = data; if (data.quota) storeQuota(data.quota); }
  };
  try {
    for (;;) {
      if (signal && signal.aborted) { try { reader.cancel(); } catch {} throw new DOMException('Abgebrochen', 'AbortError'); }
      const { value, done: end } = await reader.read();
      if (end) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        let ev = 'message', data = '';
        for (const line of block.split('\n')) { if (line.startsWith('event:')) ev = line.slice(6).trim(); else if (line.startsWith('data:')) data += line.slice(5).trim(); }
        if (data) { try { handle(ev, JSON.parse(data)); } catch {} }
      }
    }
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    if (!full) throw new AiError('network', 'Die Verbindung zur KI wurde unterbrochen. Bitte versuche es erneut.');
    error = error || { error: 'network', message: 'Die Verbindung wurde unterbrochen – die Antwort ist unvollständig.' };
  }
  if (error && !full) throw new AiError(error.error, messageFor(error.error, error.message), { quota: error.quota });
  return { output: full.trim(), truncated: !!(meta && meta.truncated), note: (meta && meta.note) || '', quota: (done && done.quota) || (meta && meta.quota) || null, cut: !!(done && done.cut), consumed: done && done.consumed, partial: !!error, partialMessage: error ? messageFor(error.error, error.message) : '' };
}

/** POST to another AI endpoint with this device's token (e.g. /api/plus-verify). */
export async function callApi(path, body = {}) {
  const token = await ensureToken();
  const r = await postJson(path, { ...body, token });
  if (!r.ok) throw await errorFrom(r);
  return r.json();
}

// test hook
export function _resetStatusCache() { statusCache = null; }
