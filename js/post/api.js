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
  bad_fax_number: 'Diese Faxnummer geht nicht. Bitte eine Festnetz-Faxnummer mit Vorwahl eintragen.',
  fax_not_configured: 'Der Faxversand ist noch nicht eingerichtet – bitte versuche es später.',
  fax_disabled: 'Der Faxversand ist noch nicht eingerichtet – bitte versuche es später.',
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
  try { localStorage.setItem(ON, data.enabled ? '1' : '0'); localStorage.setItem(FAX_ON, data.fax ? '1' : '0'); } catch { /* private mode */ }
  return data;
}
// Whether the service is set up (last answer of the server, remembered) – entry points stay hidden while it is
// not (e.g. in production before the print service and payment are configured).
const ON = 'fale-post-on';
const FAX_ON = 'fale-fax-on';
/** Fax: true / false from the last config answer, null when never asked. */
export function faxKnown() { try { const v = localStorage.getItem(FAX_ON); return v == null ? null : v === '1'; } catch { return null; } }
/** {post, fax} configs if available (waits at most `ms`), each null when that way is not set up. */
export async function sendWays(ms = 2000) {
  try {
    const cfg = await Promise.race([postConfig(), new Promise(r => setTimeout(() => r(undefined), ms))]);
    if (cfg === undefined) return { post: postKnown() ? { enabled: true, prices: null } : null, fax: faxKnown() ? { fax: true, prices: null } : null, partners: null };
    return { post: cfg.enabled ? cfg : null, fax: cfg.fax ? cfg : null, partners: cfg.partners || null };
  } catch { return { post: postKnown() ? { enabled: true, prices: null } : null, fax: faxKnown() ? { fax: true, prices: null } : null, partners: null }; }
}
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
export function localPrice(prices, { pages, color, registered, intl, channel }) {
  if (channel === 'fax') return intl ? prices.faxIntlBase + Math.max(0, pages - prices.faxIncluded) * prices.faxIntlPerPage
    : prices.faxBase + Math.max(0, pages - prices.faxIncluded) * prices.faxPerPage;
  let p = intl ? prices.intlBase : prices.base;
  p += Math.max(0, pages - prices.includedSheets) * prices.perSheet;
  if (color) p += prices.color;
  if (!intl && registered === 'r1') p += prices.r1;
  if (!intl && registered === 'r2') p += prices.r2;
  return p;
}
/**
 * The person's country (ISO, e.g. 'FR') from the device languages – decides how a fax number without +/00 is read,
 * the default country of a letter and which partner links fit.
 */
const LANG_COUNTRY = { de: 'DE', fr: 'FR', es: 'ES', it: 'IT', pt: 'PT', nl: 'NL', pl: 'PL', tr: 'TR', uk: 'UA', ru: 'RU', zh: 'CN', ja: 'JP', ko: 'KR', hi: 'IN', id: 'ID', en: 'GB', da: 'DK', sv: 'SE', nb: 'NO', fi: 'FI', cs: 'CZ', el: 'GR', hu: 'HU', ro: 'RO' };
export function deviceRegion() {
  try {
    const list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'de-DE'];
    for (const l of list) { const m = /^[a-z]{2,3}[-_]([A-Za-z]{2})\b/.exec(l); if (m) return m[1].toUpperCase(); }
    return LANG_COUNTRY[String(list[0]).slice(0, 2).toLowerCase()] || 'DE';
  } catch { return 'DE'; }
}
export const quoteFax = (to, pages) => call('quote', { channel: 'fax', to, pages, region: deviceRegion() });
export const euro = cents => (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'EUR' });
