// FaLe-Konto for FaLe One: a small fetch-based client for the Supabase Auth REST API (no SDK, no CDN).
// Same flow and storage rules as FaLe PDF (js/account/auth.js), adapted for a separate origin:
//   - the public Supabase URL + publishable key come from <API>/api/account?a=config (cached)
//   - sign-in with a 6-digit e-mail code (new addresses get an account automatically)
//   - refresh token + e-mail in IndexedDB; the access token only in memory; one refresh at a time (Web Locks)
import { apiBase, VERSION } from './config.js';
import { kv, wipeAll } from './idb.js';
import { t } from './i18n.js';

const CFG_LS = 'fale-one-acct-cfg';
const FLAG_LS = 'fale-one-signed-in';
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

export class AccountError extends Error {
  constructor(code, userMessage, extra = {}) { super(userMessage || code); this.code = code; this.userMessage = userMessage; Object.assign(this, extra); }
}
export const online = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const OFFLINE = () => t('Du bist offline. Für die Anmeldung brauchst du eine Internetverbindung.');
const UNAVAILABLE = () => t('Das FaLe-Konto ist gerade nicht erreichbar. Bitte versuche es später erneut.');

// ---------------------------------------------------------------- config
let cfgMem = null;
export async function accountConfig({ force = false } = {}) {
  if (cfgMem && !force && Date.now() - cfgMem.at < 600000) return cfgMem.data;
  let cached = null;
  try { cached = JSON.parse(ls.get(CFG_LS) || 'null'); } catch {}
  try {
    if (!online()) throw new Error('offline');
    const r = await fetch(`${apiBase()}/api/account?a=config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
    if (!r.ok) throw new Error('http ' + r.status);
    const j = await r.json();
    const data = { configured: !!j.configured, supabaseUrl: j.supabaseUrl || null, supabaseKey: j.supabaseKey || null };
    if (data.supabaseUrl && !/^https:\/\/|^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(data.supabaseUrl)) throw new Error('bad url');
    cfgMem = { at: Date.now(), data };
    ls.set(CFG_LS, JSON.stringify(data));
    return data;
  } catch {
    if (cached) { cfgMem = { at: Date.now() - 540000, data: { ...cached, stale: true } }; return cfgMem.data; }
    return { configured: false, offline: !online() };
  }
}
async function cfgOrThrow() {
  const c = await accountConfig();
  if (!c.configured || !c.supabaseUrl || !c.supabaseKey) throw new AccountError('not_configured', c.offline ? OFFLINE() : t('Das FaLe-Konto ist bald verfügbar.'));
  return c;
}

// ---------------------------------------------------------------- session
let mem = { access: null, exp: 0, session: undefined };
const listeners = new Set();
export function onAccountChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(reason) { const s = mem.session; listeners.forEach(fn => { try { fn({ signedIn: !!s, user: s ? s.user : null, reason }); } catch {} }); }
export function maybeSignedIn() { return ls.get(FLAG_LS) === '1'; }
export async function session() { if (mem.session === undefined) mem.session = await kv.get('session', null).catch(() => null); return mem.session; }
export async function currentUser() { const s = await session(); return s ? s.user : null; }

function randId(n = 18) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function defaultDeviceName() {
  const ua = navigator.userAgent || '';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac OS X/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : '';
  return `FaLe One · ${br}${os ? ' · ' + os : ''}`;
}
async function saveSession(tok, { keepDevice = true } = {}) {
  const prev = await session();
  const user = { id: tok.user && tok.user.id, email: (tok.user && tok.user.email) || (prev && prev.user.email) || '' };
  if (!user.id) throw new AccountError('bad_response', UNAVAILABLE());
  const same = prev && prev.user.id === user.id;
  const s = { refresh: tok.refresh_token, user, at: Date.now(), device: keepDevice && same ? prev.device : randId(18), deviceName: (same && prev.deviceName) || defaultDeviceName() };
  await kv.set('session', s);
  mem.session = s;
  mem.access = tok.access_token;
  mem.exp = Date.now() + Math.max(30, Number(tok.expires_in) || 3600) * 1000;
  ls.set(FLAG_LS, '1');
  return s;
}
async function authFetch(cfg, path, { method = 'POST', json, token } = {}) {
  if (!online()) throw new AccountError('offline', OFFLINE());
  const headers = { apikey: cfg.supabaseKey, 'Content-Type': 'application/json', Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  try { return await fetch(`${cfg.supabaseUrl}/auth/v1/${path}`, { method, headers, body: json !== undefined ? JSON.stringify(json) : undefined, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }); }
  catch { throw new AccountError('network', online() ? UNAVAILABLE() : OFFLINE()); }
}
async function errBody(r) { try { return await r.json(); } catch { return {}; } }

export async function sendCode(email) {
  const cfg = await cfgOrThrow();
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(e) || e.length > 254) throw new AccountError('bad_email', t('Bitte gib eine gültige E-Mail-Adresse ein.'));
  const r = await authFetch(cfg, 'otp', { json: { email: e, create_user: true } });
  if (r.ok) return { email: e };
  const j = await errBody(r);
  if (r.status === 429) throw new AccountError('rate_limited', t('Bitte warte eine Minute, bevor du einen neuen Code anforderst.'));
  if (j.error_code === 'validation_failed' || r.status === 400) throw new AccountError('bad_email', t('Bitte gib eine gültige E-Mail-Adresse ein.'));
  throw new AccountError('send_failed', t('Der Code konnte gerade nicht gesendet werden. Bitte versuche es später erneut.'));
}
export async function verifyCode(email, code) {
  const cfg = await cfgOrThrow();
  const c = String(code || '').replace(/\D/g, '');
  if (c.length < 6 || c.length > 10) throw new AccountError('bad_code', t('Bitte gib den 6-stelligen Code aus der E-Mail ein.'));
  const r = await authFetch(cfg, 'verify', { json: { type: 'email', email: String(email).trim().toLowerCase(), token: c } });
  if (!r.ok) {
    if (r.status === 429) throw new AccountError('rate_limited', t('Zu viele Versuche. Bitte warte kurz und fordere dann einen neuen Code an.'));
    throw new AccountError('bad_code', t('Der Code ist falsch oder abgelaufen. Prüfe die E-Mail oder fordere einen neuen Code an.'));
  }
  await saveSession(await r.json(), { keepDevice: false });
  emit('signed-in');
  touchDevice().catch(() => {});
  return mem.session.user;
}

// ---------------------------------------------------------------- access token
let refreshP = null;
async function withLock(fn) { return navigator.locks && navigator.locks.request ? navigator.locks.request('fale-one-refresh', fn) : fn(); }
async function doRefresh() {
  return withLock(async () => {
    const stored = await kv.get('session', null);
    if (!stored) { mem.session = null; mem.access = null; return null; }
    mem.session = stored;
    const cfg = await cfgOrThrow();
    const r = await authFetch(cfg, 'token?grant_type=refresh_token', { json: { refresh_token: stored.refresh } });
    if (!r.ok) {
      if (r.status >= 400 && r.status < 500 && r.status !== 429) { await localSignOut('expired'); return null; }
      throw new AccountError('refresh_failed', UNAVAILABLE());
    }
    await saveSession(await r.json());
    return mem.access;
  });
}
export async function accessToken({ force = false } = {}) {
  const s = await session();
  if (!s) return null;
  if (!force && mem.access && mem.exp - 60000 > Date.now()) return mem.access;
  if (force) mem.access = null;
  if (!refreshP) refreshP = doRefresh().finally(() => { refreshP = null; });
  return refreshP;
}

export async function sbFetch(path, { method = 'POST', json } = {}) {
  const cfg = await cfgOrThrow();
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken({ force: attempt > 0 });
    if (!token) throw new AccountError('signed_out', t('Bitte melde dich erneut an.'));
    if (!online()) throw new AccountError('offline', OFFLINE());
    let r;
    try { r = await fetch(cfg.supabaseUrl + path, { method, headers: { apikey: cfg.supabaseKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: json !== undefined ? JSON.stringify(json) : undefined, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }); }
    catch { throw new AccountError('network', online() ? UNAVAILABLE() : OFFLINE()); }
    if (r.status === 401 && attempt === 0) continue;
    return r;
  }
  throw new AccountError('signed_out', t('Bitte melde dich erneut an.'));
}
export async function rpc(fn, args = {}) {
  const r = await sbFetch(`/rest/v1/rpc/${fn}`, { json: args });
  if (!r.ok) throw new AccountError(r.status === 404 ? 'not_deployed' : 'rpc_failed', r.status >= 500 || r.status === 404 ? UNAVAILABLE() : t('Das hat nicht geklappt. Bitte versuche es erneut.'), { status: r.status });
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}
export async function accountApi(action, body = {}) {
  const token = await accessToken();
  if (!token) throw new AccountError('signed_out', t('Bitte melde dich erneut an.'));
  if (!online()) throw new AccountError('offline', OFFLINE());
  let r;
  try { r = await fetch(`${apiBase()}/api/account?a=${encodeURIComponent(action)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body), credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }); }
  catch { throw new AccountError('network', online() ? UNAVAILABLE() : OFFLINE()); }
  const j = await errBody(r);
  if (!r.ok) throw new AccountError(j.error || 'http_' + r.status, j.message || UNAVAILABLE(), { status: r.status });
  return j;
}

// ---------------------------------------------------------------- devices
export async function touchDevice() {
  const s = await session();
  if (!s) return null;
  const r = await rpc('fale_device_touch', { p_device: s.device, p_name: s.deviceName || defaultDeviceName(), p_platform: 'web', p_version: 'one-' + VERSION });
  if (r && r.revoked) { await localSignOut('revoked'); return { revoked: true }; }
  return r;
}
export async function renameDevice(name) {
  const s = await session();
  if (!s) return;
  mem.session = { ...s, deviceName: String(name || '').trim().slice(0, 60) || defaultDeviceName() };
  await kv.set('session', mem.session);
  await touchDevice();
}
export async function listDevices() { return ((await rpc('fale_devices')) || {}).devices || []; }
export async function revokeDevice(id) { return rpc('fale_device_revoke', { p_device: id }); }

// ---------------------------------------------------------------- sign-out / delete
export async function localSignOut(reason = 'signed-out') {
  await wipeAll();
  mem = { access: null, exp: 0, session: null };
  ls.del(FLAG_LS);
  emit(reason);
}
export async function signOut({ everywhere = false } = {}) {
  try {
    const cfg = await accountConfig();
    const token = mem.access && mem.exp > Date.now() ? mem.access : await accessToken().catch(() => null);
    if (token && cfg.configured) await authFetch(cfg, `logout?scope=${everywhere ? 'global' : 'local'}`, { token }).catch(() => null);
  } catch {}
  await localSignOut('signed-out');
}
export async function deleteAccount() {
  const r = await accountApi('delete', { confirm: 'LÖSCHEN' });
  await localSignOut('deleted');
  return r;
}
