// FaLe-Konto: a tiny fetch-based client for the Supabase Auth REST API (no SDK, no CDN).
//
//   sendCode(email)            → e-mail with a 6-digit code (works inside the Android WebView, no deep link)
//   verifyCode(email, code)    → signed in
//   accessToken()              → valid access token or null (refreshes automatically, one refresh at a time
//                                across tabs via Web Locks; refresh tokens rotate)
//   signOut({ everywhere })    → ends the session (this device or all devices) and wipes local tokens + keys
//   rpc(fn, args) / sbFetch()  → PostgREST / Storage calls with the user's token (RLS on auth.uid())
//
// Storage: refresh token + e-mail in IndexedDB (fale-account → kv 'session'); the access token only in memory.
// The account is optional – nothing here runs unless the user signs in.
import { apiBase } from '../ai/config.js';
import { isNative, platformName } from '../platform.js';
import { kv, wipeAll } from './kv.js';
import BUILD_CONFIG from './build-config.js';

const CFG_LS = 'fale-acct-cfg';
const FLAG_LS = 'fale-acct'; // "1" while signed in – lets the app skip all account code otherwise
const PKCE_LS = 'fale-acct-pkce';
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

export class AccountError extends Error {
  constructor(code, userMessage, extra = {}) {
    super(userMessage || code);
    this.code = code;
    this.userMessage = userMessage || 'Das hat nicht geklappt. Bitte versuche es erneut.';
    Object.assign(this, extra);
  }
}
const OFFLINE = 'Du bist offline. Für das FaLe-Konto brauchst du eine Internetverbindung.';
const UNAVAILABLE = 'Das FaLe-Konto ist gerade nicht erreichbar. Bitte versuche es später erneut.';
export const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;

// ---------------------------------------------------------------- config (public: URL + publishable key)
let cfgMem = null;
/**
 * Public account settings (Supabase URL + publishable key, feature flags).
 * passive: true (cards on "Ich" and the start page) never causes a request: it uses the build-time
 * config or the copy cached from an earlier visit of #/konto, else answers { unknown: true }.
 */
export async function accountConfig({ force = false, passive = false } = {}) {
  if (typeof window !== 'undefined' && window.__FALE_ACCOUNT_CONFIG__) return window.__FALE_ACCOUNT_CONFIG__;
  if (BUILD_CONFIG && (BUILD_CONFIG.configured || passive)) return BUILD_CONFIG;
  if (cfgMem && !force && Date.now() - cfgMem.at < 600000) return cfgMem.data;
  let cached = null;
  try { cached = JSON.parse(ls.get(CFG_LS) || 'null'); } catch {}
  if (passive && !force) return cached || { configured: null, unknown: true, features: {} };
  try {
    if (!online()) throw new Error('offline');
    const r = await fetch(`${apiBase()}/api/account?a=config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', credentials: 'omit', cache: 'no-store' });
    if (!r.ok) throw new Error('http ' + r.status);
    const j = await r.json();
    const data = { configured: !!j.configured, supabaseUrl: j.supabaseUrl || null, supabaseKey: j.supabaseKey || null, features: j.features || {}, at: Date.now() };
    cfgMem = { at: Date.now(), data };
    ls.set(CFG_LS, JSON.stringify(data));
    return data;
  } catch {
    if (cached) { cfgMem = { at: Date.now() - 540000, data: { ...cached, stale: true } }; return cfgMem.data; }
    return { configured: false, offline: !online(), features: {} };
  }
}
async function cfgOrThrow() {
  const c = await accountConfig();
  if (!c.configured || !c.supabaseUrl || !c.supabaseKey) throw new AccountError('not_configured', c.offline ? OFFLINE : 'Das FaLe-Konto ist bald verfügbar.');
  return c;
}

// ---------------------------------------------------------------- session state
let mem = { access: null, exp: 0, session: undefined }; // session: { refresh, user: {id, email}, device, at } | null
const listeners = new Set();
export function onAccountChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(reason) {
  const s = mem.session;
  const detail = { signedIn: !!s, user: s ? s.user : null, reason };
  listeners.forEach(fn => { try { fn(detail); } catch {} });
  try { window.dispatchEvent(new CustomEvent('fale:account', { detail })); } catch {}
}
/** Quick check without IndexedDB (localStorage flag). */
export function maybeSignedIn() { return ls.get(FLAG_LS) === '1'; }

export async function session() {
  if (mem.session === undefined) mem.session = await kv.get('session', null);
  return mem.session;
}
export async function currentUser() { const s = await session(); return s ? s.user : null; }
export async function deviceId() { const s = await session(); return s ? s.device : null; }

function randId(n = 24) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function defaultDeviceName() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  if (isNative()) return /Android/i.test(ua) ? 'Android' : /iPad/i.test(ua) ? 'iPad' : /iPhone|iOS|Macintosh/i.test(ua) ? 'iPhone' : 'FaLe';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac OS X/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : '';
  return os ? `${br} · ${os}` : br;
}

async function saveSession(tok, { keepDevice = true } = {}) {
  const prev = await session();
  const user = { id: tok.user && tok.user.id, email: (tok.user && tok.user.email) || (prev && prev.user.email) || '' };
  if (!user.id) throw new AccountError('bad_response', UNAVAILABLE);
  const same = prev && prev.user.id === user.id;
  const s = {
    refresh: tok.refresh_token, user, at: Date.now(),
    device: keepDevice && same ? prev.device : randId(18), // a fresh device id per sign-in (revoked ids are never reused)
    deviceName: (same && prev.deviceName) || defaultDeviceName(),
  };
  await kv.set('session', s);
  mem.session = s;
  mem.access = tok.access_token;
  mem.exp = Date.now() + Math.max(30, Number(tok.expires_in) || 3600) * 1000;
  ls.set(FLAG_LS, '1');
  return s;
}

// ---------------------------------------------------------------- HTTP to Supabase
async function authFetch(cfg, path, { method = 'POST', json, token } = {}) {
  if (!online()) throw new AccountError('offline', OFFLINE);
  const headers = { apikey: cfg.supabaseKey, 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    return await fetch(`${cfg.supabaseUrl}/auth/v1/${path}`, { method, headers, body: json !== undefined ? JSON.stringify(json) : undefined, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
  } catch { throw new AccountError('network', online() ? UNAVAILABLE : OFFLINE); }
}
async function errBody(r) { try { return await r.json(); } catch { return {}; } }

/** Send the 6-digit sign-in code. New e-mail addresses get an account automatically. */
export async function sendCode(email) {
  const cfg = await cfgOrThrow();
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(e) || e.length > 254) throw new AccountError('bad_email', 'Bitte gib eine gültige E-Mail-Adresse ein.');
  const r = await authFetch(cfg, 'otp', { json: { email: e, create_user: true } });
  if (r.ok) return { email: e };
  const j = await errBody(r);
  if (r.status === 429) throw new AccountError('rate_limited', 'Bitte warte eine Minute, bevor du einen neuen Code anforderst.');
  if (j.error_code === 'validation_failed' || r.status === 400) throw new AccountError('bad_email', 'Bitte gib eine gültige E-Mail-Adresse ein.');
  throw new AccountError('send_failed', 'Der Code konnte gerade nicht gesendet werden. Bitte versuche es später erneut.');
}

/** Verify the code → signed in. */
export async function verifyCode(email, code) {
  const cfg = await cfgOrThrow();
  const c = String(code || '').replace(/\D/g, '');
  if (c.length < 6 || c.length > 10) throw new AccountError('bad_code', 'Bitte gib den 6-stelligen Code aus der E-Mail ein.');
  const r = await authFetch(cfg, 'verify', { json: { type: 'email', email: String(email).trim().toLowerCase(), token: c } });
  if (!r.ok) {
    if (r.status === 429) throw new AccountError('rate_limited', 'Zu viele Versuche. Bitte warte kurz und fordere dann einen neuen Code an.');
    throw new AccountError('bad_code', 'Der Code ist falsch oder abgelaufen. Prüfe die E-Mail oder fordere einen neuen Code an.');
  }
  await saveSession(await r.json(), { keepDevice: false });
  emit('signed-in');
  afterSignIn();
  return mem.session.user;
}

// ---------------------------------------------------------------- Google (prepared, behind a feature flag)
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function googleAvailable() {
  const c = await accountConfig();
  return !!(c.configured && c.features && c.features.google && !isNative()); // the WebView cannot do Google OAuth (needs a browser + deep link)
}
export async function startGoogle() {
  const cfg = await cfgOrThrow();
  if (!(await googleAvailable())) throw new AccountError('not_available', 'Die Anmeldung mit Google ist hier noch nicht verfügbar.');
  const verifier = randId(48);
  ls.set(PKCE_LS, verifier);
  const challenge = b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const redirect = `${location.origin}${location.pathname}?auth=google#/konto`;
  location.href = `${cfg.supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirect)}&code_challenge=${challenge}&code_challenge_method=s256`;
}
/** Called on app start: finishes a Google sign-in redirect (?code=… + stored PKCE verifier). */
export async function handleAuthRedirect() {
  const p = new URLSearchParams(location.search);
  if (p.get('auth') !== 'google') return false;
  const verifier = ls.get(PKCE_LS);
  ls.del(PKCE_LS);
  history.replaceState(null, '', location.pathname + location.hash);
  if (!p.get('code') || !verifier) throw new AccountError('google_failed', 'Die Anmeldung mit Google wurde abgebrochen.');
  const cfg = await cfgOrThrow();
  const r = await authFetch(cfg, 'token?grant_type=pkce', { json: { auth_code: p.get('code'), code_verifier: verifier } });
  if (!r.ok) throw new AccountError('google_failed', 'Die Anmeldung mit Google hat nicht geklappt. Bitte versuche es erneut.');
  await saveSession(await r.json(), { keepDevice: false });
  emit('signed-in');
  afterSignIn();
  return true;
}

// ---------------------------------------------------------------- access token (auto refresh)
let refreshP = null;
async function withLock(fn) {
  if (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) return navigator.locks.request('fale-acct-refresh', fn);
  return fn();
}
async function doRefresh() {
  // one refresh at a time across tabs; always use the newest stored refresh token (another tab may have rotated it)
  return withLock(async () => {
    const stored = await kv.get('session', null);
    if (!stored) { mem.session = null; mem.access = null; return null; }
    mem.session = stored;
    const cfg = await cfgOrThrow();
    const r = await authFetch(cfg, 'token?grant_type=refresh_token', { json: { refresh_token: stored.refresh } });
    if (!r.ok) {
      if (r.status >= 400 && r.status < 500 && r.status !== 429) { await localSignOut('expired'); return null; }
      throw new AccountError('refresh_failed', UNAVAILABLE);
    }
    await saveSession(await r.json());
    return mem.access;
  });
}
/** A valid access token, or null when not signed in. Throws AccountError when offline/unreachable. */
export async function accessToken({ force = false } = {}) {
  const s = await session();
  if (!s) return null;
  if (!force && mem.access && mem.exp - 60000 > Date.now()) return mem.access;
  if (!refreshP) refreshP = doRefresh().finally(() => { refreshP = null; });
  return refreshP;
}
/** Like accessToken() but never throws (for optional use, e.g. the AI quota). */
export async function accessTokenOrNull() {
  if (!maybeSignedIn()) return null;
  try { return await accessToken(); } catch { return null; }
}

/** fetch() against Supabase with apikey + the user's token; retries once after a 401 with a refreshed token. */
export async function sbFetch(path, { method = 'POST', json, raw, contentType, signal, headers: extra = {} } = {}) {
  const cfg = await cfgOrThrow();
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken({ force: attempt > 0 });
    if (!token) throw new AccountError('signed_out', 'Bitte melde dich erneut an.');
    if (!online()) throw new AccountError('offline', OFFLINE);
    const headers = { apikey: cfg.supabaseKey, Authorization: `Bearer ${token}`, ...extra };
    let body;
    if (raw !== undefined) { headers['Content-Type'] = contentType || 'application/octet-stream'; body = raw; }
    else if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
    let r;
    try { r = await fetch(cfg.supabaseUrl + path, { method, headers, body, signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }); }
    catch (e) { if (e && e.name === 'AbortError') throw e; throw new AccountError('network', online() ? UNAVAILABLE : OFFLINE); }
    if (r.status === 401 && attempt === 0) continue;
    return r;
  }
  throw new AccountError('signed_out', 'Bitte melde dich erneut an.');
}
export async function rpc(fn, args = {}) {
  const r = await sbFetch(`/rest/v1/rpc/${fn}`, { json: args });
  if (!r.ok) {
    const j = await errBody(r);
    throw new AccountError(r.status === 404 ? 'not_deployed' : 'rpc_failed', r.status >= 500 || r.status === 404 ? UNAVAILABLE : 'Das hat nicht geklappt. Bitte versuche es erneut.', { status: r.status, detail: j && j.message });
  }
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

/** POST to our /api/account endpoint with the user's token. */
export async function accountApi(action, body = {}) {
  const token = await accessToken();
  if (!token) throw new AccountError('signed_out', 'Bitte melde dich erneut an.');
  if (!online()) throw new AccountError('offline', OFFLINE);
  let r;
  try { r = await fetch(`${apiBase()}/api/account?a=${encodeURIComponent(action)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body), credentials: 'omit', cache: 'no-store' }); }
  catch { throw new AccountError('network', online() ? UNAVAILABLE : OFFLINE); }
  const j = await errBody(r);
  if (!r.ok) throw new AccountError(j.error || 'http_' + r.status, j.message || UNAVAILABLE, { status: r.status });
  return j;
}

// ---------------------------------------------------------------- after sign-in / devices
async function afterSignIn() {
  ls.del('fale-ai-quota'); // the quota now belongs to the account
  try { await touchDevice(); } catch {}
  // Plus bought in the Android app before signing in → link it to the account (needs this device's AI token)
  try {
    const t = ls.get('fale-ai-token');
    if (t) {
      const r = await accountApi('link', { token: t });
      if (r && r.plus) try { window.dispatchEvent(new CustomEvent('fale:account-plus', { detail: r.plus })); } catch {}
    }
  } catch {}
  try { (await import('../sync/engine.js')).onSignedIn(); } catch (e) { console.warn(e); }
}

/** Register / refresh this device in the account's device list. Signs out locally when revoked. */
export async function touchDevice() {
  const s = await session();
  if (!s) return null;
  const r = await rpc('fale_device_touch', { p_device: s.device, p_name: s.deviceName || defaultDeviceName(), p_platform: platformName(), p_version: '2.4.0' });
  if (r && r.revoked) { await localSignOut('revoked'); return { revoked: true }; }
  await kv.set('deviceTouchedAt', Date.now());
  return r;
}
export async function renameDevice(name) {
  const s = await session();
  if (!s) return;
  const clean = String(name || '').trim().slice(0, 60) || defaultDeviceName();
  mem.session = { ...s, deviceName: clean };
  await kv.set('session', mem.session);
  await touchDevice();
}
export async function listDevices() { return ((await rpc('fale_devices')) || {}).devices || []; }
export async function revokeDevice(id) { return rpc('fale_device_revoke', { p_device: id }); }

// ---------------------------------------------------------------- sign-out / delete
/** Wipe tokens, keys and sync bookkeeping on this device (the user's files stay). */
export async function localSignOut(reason = 'signed-out') {
  try { (await import('../sync/engine.js')).stopAndForget(); } catch {}
  await wipeAll();
  mem = { access: null, exp: 0, session: null };
  ls.del(FLAG_LS);
  ls.del('fale-ai-reward');
  ls.del('fale-ai-quota'); // cached "für dein Konto" quota
  emit(reason);
}
/** Sign out on this device (scope local) or everywhere (scope global). */
export async function signOut({ everywhere = false } = {}) {
  try {
    const cfg = await accountConfig();
    const token = mem.access && mem.exp > Date.now() ? mem.access : await accessToken().catch(() => null);
    if (token && cfg.configured) await authFetch(cfg, `logout?scope=${everywhere ? 'global' : 'local'}`, { token }).catch(() => null);
  } catch {}
  await localSignOut('signed-out');
}
/** Delete the account and all cloud data (server side), then wipe this device's account data. */
export async function deleteAccount() {
  const r = await accountApi('delete', { confirm: 'LÖSCHEN' });
  await localSignOut('deleted');
  return r;
}

// test hook
export function _forgetMemory() { mem = { access: null, exp: 0, session: undefined }; }
