// Cloud-KI client: device pseudonym, consent state, quota cache and the request helper.
// Nothing here talks to the network on app start – only when the user opens an AI screen
// (anonymous availability check) or actively starts an AI task after giving consent.
import { blocked } from '../policy.js';
import { apiBase, outputLang } from './config.js';
import { isNative, platformName } from '../platform.js';
import { accessTokenOrNull, accessToken } from '../account/auth.js';

const K = { device: 'fale-ai-device', token: 'fale-ai-token', consent: 'fale-ai-consent', cloud: 'fale-ai-cloud', quota: 'fale-ai-quota', reward: 'fale-ai-reward' };
export const CONSENT_VERSION = 1;
import { APP_VERSION } from '../version.js';

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
export function cloudDisabled() { return ls.get(K.cloud) === 'off' || blocked('cloudAi'); }
export function setCloudDisabled(off) { if (!off && blocked('cloudAi')) return; if (off) ls.set(K.cloud, 'off'); else ls.del(K.cloud); emit('fale:ai-state'); }
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
  let r, timer = null, own = null;
  if (!signal) { own = new AbortController(); timer = setTimeout(() => own.abort(), 20000); signal = own.signal; } // status/register/plus: short calls
  try {
    r = await fetch(apiBase() + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal, credentials: 'omit', cache: 'no-store' });
  } catch (e) {
    if (own && own.signal.aborted) throw new AiError('timeout', 'Der KI-Dienst antwortet gerade nicht. Bitte versuche es später erneut.');
    if (e && e.name === 'AbortError') throw e;
    throw new AiError('network', online() ? 'Der KI-Dienst ist gerade nicht erreichbar. Bitte versuche es später erneut.' : 'Du bist offline. Cloud-KI braucht eine Internetverbindung.');
  } finally { clearTimeout(timer); }
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
    case 'modified_app': return 'Diese App-Version wurde verändert. Bitte lade FaLe PDF aus dem Google Play Store.';
    case 'timeout': case 'provider_timeout': return fallback || 'Die KI antwortet gerade nicht. Bitte versuche es gleich noch einmal – bei langen Dokumenten hilft „Kurz“ oder ein kleinerer Abschnitt.';
    case 'bad_input': return fallback || 'Die Eingabe konnte nicht verarbeitet werden.';
    default: return fallback || 'Die KI ist gerade nicht erreichbar. Bitte versuche es später erneut.';
  }
}

// ---------------------------------------------------------------- optional FaLe-Konto
// Signed in → quota and Plus belong to the account (the server verifies the access token).
async function withAccount(body) {
  const t = await accessTokenOrNull();
  return t ? { ...body, account: t } : body;
}
/** Retry once with a refreshed account token (or without it) after 401 invalid_account. */
async function accountRetry(r, body, send) {
  if (r.status !== 401 || !body.account) return r;
  let j = null; try { j = await r.clone().json(); } catch {}
  if (!j || j.error !== 'invalid_account') return r;
  let t = null; try { t = await accessToken({ force: true }); } catch {}
  const next = { ...body }; if (t) next.account = t; else delete next.account;
  return send(next);
}
/** custom_data for rewarded ads: credits the account when signed in, else the device. */
export function rewardCustomData(deviceToken) { return ls.get(K.reward) || deviceToken; }

// ---------------------------------------------------------------- availability + quota
/** Availability (+ quota when consent was given). Anonymous without consent: nothing is stored server-side. */
export async function aiStatus({ force = false } = {}) {
  if (!online()) throw new AiError('offline', messageFor('offline'));
  if (statusCache && !force && Date.now() - statusCache.at < 30000) return statusCache.data;
  const tok = hasConsent() ? ls.get(K.token) : null;
  const body = tok ? await withAccount({ token: tok }) : {};
  const r = await accountRetry(await postJson('/api/ai/quota', body), body, b => postJson('/api/ai/quota', b));
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
  if (data.quota) { if (data.rewardToken) ls.set(K.reward, data.rewardToken); else ls.del(K.reward); }
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
      const r = await postJson('/api/ai/register', { deviceId: deviceId(), client: await clientInfo() });
      if (!r.ok) throw await errorFrom(r);
      const j = await r.json();
      ls.set(K.token, j.token);
      return j.token;
    })().finally(() => { tokenP = null; });
  }
  return tokenP;
}
export function currentToken() { return hasConsent() ? ls.get(K.token) : null; }

// ---------------------------------------------------------------- genuine app (Android)
// SHA-256 of the app's signing certificate + installing store (FaleApp plugin, scripts/cap-patch-android.mjs). The
// server refuses re-signed copies when it knows the genuine certificate (ANDROID_APP_CERT_SHA256).
let appInfoP = null;
function appInfo() {
  if (!isNative() || platformName() !== 'android') return Promise.resolve(null);
  if (!appInfoP) {
    appInfoP = (async () => {
      try {
        const { plugin } = await import('../platform.js');
        const p = plugin('FaleApp');
        if (!p) return null;
        const r = await Promise.race([p.info(), new Promise(res => setTimeout(() => res(null), 3000))]);
        return r ? { cert: String(r.cert || '').slice(0, 700), installer: String(r.installer || '').slice(0, 100) } : null;
      } catch { return null; }
    })();
  }
  return appInfoP;
}
async function clientInfo() {
  const a = await appInfo();
  return { platform: platformName(), appVersion: APP_VERSION, native: isNative(), ...(a ? { cert: a.cert, installer: a.installer } : {}) };
}

// ---------------------------------------------------------------- tasks
/**
 * Run a server-defined task.
 * opts: { stream, onDelta(text, full), onMeta(meta), signal }
 * → { output, truncated, note, quota, cut, consumed }
 */
// Never wait forever: no answer within WAIT_MS (the server gives up after 60 s) or a stream that stays silent for
// IDLE_MS ends with a clear message instead of an endless spinner.
export const AI_WAIT = { WAIT_MS: 75000, IDLE_MS: 40000 };
function watchdog(userSignal) {
  const ac = new AbortController();
  let timer = null, fired = false;
  const kick = ms => { clearTimeout(timer); timer = setTimeout(() => { fired = true; ac.abort(); }, ms); };
  if (userSignal) { if (userSignal.aborted) ac.abort(); else userSignal.addEventListener('abort', () => ac.abort(), { once: true }); }
  kick(AI_WAIT.WAIT_MS);
  return { signal: ac.signal, kick, stop: () => clearTimeout(timer), timedOut: () => fired };
}

export async function runTask(task, input, options = {}, opts = {}) {
  if (cloudDisabled()) throw new AiError('disabled', 'Cloud-KI ist in den KI-Einstellungen ausgeschaltet.');
  if (!online()) throw new AiError('offline', messageFor('offline'));
  if (!hasConsent()) throw new AiError('no_consent', 'Bitte stimme zuerst der Nutzung der Cloud-KI zu.');
  const lang = options.lang || outputLang();
  const wd = watchdog(opts.signal);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await ensureToken({ renew: attempt > 0 });
      const body = await withAccount({ task, input, options: { lang, ...options }, token, stream: !!opts.stream, client: await clientInfo() });
      const r = await accountRetry(await postJson('/api/ai', body, { signal: wd.signal }), body, b => postJson('/api/ai', b, { signal: wd.signal }));
      if (r.status === 401 && attempt === 0) { ls.del(K.token); continue; }
      if (!r.ok) throw await errorFrom(r);
      const ct = r.headers.get('content-type') || '';
      if (/text\/event-stream/.test(ct)) return await readStream(r, { ...opts, signal: opts.signal, wd });
      const j = await r.json();
      if (j.quota) storeQuota(j.quota);
      return j;
    }
    throw new AiError('invalid_token', messageFor('invalid_token'));
  } catch (e) {
    if (wd.timedOut() && !(opts.signal && opts.signal.aborted)) throw new AiError('timeout', messageFor('timeout'));
    throw e;
  } finally { wd.stop(); }
}

async function readStream(r, { onDelta, onMeta, signal, wd = null }) {
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
      if (signal && signal.aborted) { try { reader.cancel().catch(() => {}); } catch {} throw new DOMException('Abgebrochen', 'AbortError'); }
      const { value, done: end } = await reader.read();
      if (end) break;
      if (wd) wd.kick(AI_WAIT.IDLE_MS);
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
    const stalled = wd && wd.timedOut() && !(signal && signal.aborted);
    if (e && e.name === 'AbortError' && !stalled) throw e;
    try { reader.cancel().catch(() => {}); } catch { /* already closed */ }
    if (!full) throw stalled ? new AiError('timeout', messageFor('timeout')) : new AiError('network', 'Die Verbindung zur KI wurde unterbrochen. Bitte versuche es erneut.');
    error = error || (stalled ? { error: 'timeout', message: 'Die KI hat nicht weitergeschrieben – die Antwort ist unvollständig.' } : { error: 'network', message: 'Die Verbindung wurde unterbrochen – die Antwort ist unvollständig.' });
  }
  if (error && !full) throw new AiError(error.error, messageFor(error.error, error.message), { quota: error.quota });
  return { output: full.trim(), truncated: !!(meta && meta.truncated), note: (meta && meta.note) || '', quota: (done && done.quota) || (meta && meta.quota) || null, cut: !!(done && done.cut), consumed: done && done.consumed, partial: !!error, partialMessage: error ? messageFor(error.error, error.message) : '' };
}

/** POST to another AI endpoint with this device's token (e.g. /api/plus-verify). */
export async function callApi(path, body = {}) {
  const token = await ensureToken();
  const b = await withAccount({ ...body, token });
  const r = await accountRetry(await postJson(path, b), b, x => postJson(path, x));
  if (!r.ok) throw await errorFrom(r);
  return r.json();
}

// test hook
export function _resetStatusCache() { statusCache = null; }
