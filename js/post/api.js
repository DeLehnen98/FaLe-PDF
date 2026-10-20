// „Brief per Post“: client for /api/post (api/_lib/postal.js) + the list of own letters on this device.
// The pseudonymous device token comes from js/share/api.js (same as „Sicher teilen“).
import { apiBase } from '../ai/config.js';
import { deviceToken } from '../share/api.js';

const LS = 'fale-post-jobs';
const ls = {
  get() { try { const v = JSON.parse(localStorage.getItem(LS) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } },
  set(v) { try { localStorage.setItem(LS, JSON.stringify(v.slice(0, 100))); } catch { /* private mode */ } },
};

export class PostError extends Error {
  constructor(code, userMessage, extra = {}) { super(userMessage || code); this.code = code; this.userMessage = userMessage; Object.assign(this, extra); }
}
const OFFLINE = 'Du bist offline. Für den Briefversand brauchst du eine Internetverbindung.';
// the server's messages are German – show the app's own texts (they are translated with the rest of the UI)
const MESSAGES = {
  post_disabled: 'Der Briefversand ist noch nicht eingerichtet – bitte versuche es später.',
  too_many_pages: 'Dieser Brief hat zu viele Seiten für den Versand.',
  registered_national: 'Einschreiben ist nur innerhalb Deutschlands möglich.',
  too_large: 'Die PDF ist zu groß für den Versand. Verkleinere sie zuerst mit „PDF verkleinern“.',
  post_limit: 'Heute wurden schon viele Briefe von diesem Gerät verschickt. Morgen geht es weiter.',
  price_changed: 'Der Preis hat sich geändert. Bitte prüfe ihn noch einmal.',
  payment_unavailable: 'Die Bezahlung ist gerade nicht erreichbar. Bitte versuche es später erneut.',
  not_found: 'Diesen Auftrag gibt es nicht mehr.',
  not_cancelable: 'Der Brief ist schon bezahlt und wird verschickt.',
  page_mismatch: 'Die Seitenzahl passt nicht zur Datei. Bitte versuche es erneut.',
};

async function call(action, json = {}) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new PostError('offline', OFFLINE);
  let r;
  try {
    r = await fetch(`${apiBase()}/api/post?a=${encodeURIComponent(action)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json), credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
  } catch { throw new PostError('network', 'Der Briefversand ist gerade nicht erreichbar. Bitte versuche es später erneut.'); }
  let j = null;
  try { j = await r.json(); } catch { /* not JSON */ }
  if (r.ok && j && j.ok) return j;
  const code = (j && j.error) || (r.status === 404 ? 'post_not_configured' : 'http_' + r.status);
  const msg = code === 'post_not_configured' ? 'Der Briefversand ist noch nicht eingerichtet – bitte versuche es später.' : MESSAGES[code] || 'Das hat nicht geklappt. Bitte versuche es erneut.';
  throw new PostError(code, msg, { status: r.status, data: j });
}

let cfgCache = null;
export async function postConfig({ force = false } = {}) {
  if (cfgCache && !force && Date.now() - cfgCache.at < 300000) return cfgCache.data;
  const data = await call('config');
  cfgCache = { at: Date.now(), data };
  try { localStorage.setItem(ON, data.enabled ? '1' : '0'); } catch { /* private mode */ }
  return data;
}
// Whether the service is set up (last answer of the server, remembered) – entry points stay hidden while it is
// not (e.g. in production before the print service and payment are configured).
const ON = 'fale-post-on';
/** true / false from the last config answer, null when never asked. */
export function postKnown() { try { const v = localStorage.getItem(ON); return v == null ? null : v === '1'; } catch { return null; } }
/** The config if the service is available (waits at most `ms`, then decides by the last known answer), else null. */
export async function postAvailable(ms = 2000) {
  const known = postKnown();
  try {
    const cfg = await Promise.race([postConfig(), new Promise(r => setTimeout(() => r(undefined), ms))]);
    if (cfg === undefined) return known ? { enabled: true, prices: null } : null;
    return cfg.enabled ? cfg : null;
  } catch { return known ? { enabled: true, prices: null } : null; }
}
/** Ask the server in the background (so menus know whether to offer „Per Post senden“). */
export function warmPost() { if (typeof navigator === 'undefined' || navigator.onLine !== false) postConfig().catch(() => {}); }
export const quote = o => call('quote', o);
export async function createJob(o) {
  const send = token => call('create', { ...o, token });
  try { return await send(await deviceToken()); }
  catch (e) {
    if (e && e.code === 'invalid_token') { try { localStorage.removeItem('fale-share-token'); } catch {} return send(await deviceToken({ renew: true })); }
    throw e;
  }
}
export const jobStatus = (id, cap) => call('status', { id, cap });
export const cancelJob = (id, cap) => call('cancel', { id, cap });
export const mockPay = (id, cap) => call('mockpay', { id, cap });

// ---------------------------------------------------------------- own letters (this device)
export const listJobs = () => ls.get();
export const findJob = id => ls.get().find(j => j.id === id) || null;
export function rememberJob(j) { ls.set([j, ...ls.get().filter(x => x.id !== j.id)]); }
export function updateJob(id, patch) { const all = ls.get(); const i = all.findIndex(x => x.id === id); if (i >= 0) { all[i] = { ...all[i], ...patch }; ls.set(all); return all[i]; } return null; }

/** Simple local price (same rules as the server's list price) – the server price is binding. */
export function localPrice(prices, { pages, color, registered, intl }) {
  let p = intl ? prices.intlBase : prices.base;
  p += Math.max(0, pages - prices.includedSheets) * prices.perSheet;
  if (color) p += prices.color;
  if (!intl && registered === 'r1') p += prices.r1;
  if (!intl && registered === 'r2') p += prices.r2;
  return p;
}
export const euro = cents => (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'EUR' });
