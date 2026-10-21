'use strict';
// „Brief per Post“ and „Per Fax senden“ (/api/post): FaLe prints and mails a letter for the person – normal,
// Einschreiben Einwurf or Einschreiben – through a print-and-mail service (LetterXpress), or faxes it (sipgate),
// paid by card / PayPal / Google Pay … via Stripe Checkout (a printed and delivered letter is a physical service:
// Google Play billing must not be used for it).
// A job's options.channel is 'post' (default) or 'fax'. A fax keeps its PDF until it went through or finally failed
// (one automatic second try, e.g. when the line was busy), at most 24 h.
//
// Flow:  config → quote → create (PDF + options → job, Stripe Checkout URL)
//        → the person pays → webhook (or the app's status poll) checks the payment WITH Stripe and hands the PDF to
//          the print service exactly once (atomic status change) → the PDF is deleted from our store
//        → status (print job state, tracking code for Einschreiben). Failed hand-over → automatic refund.
// The PDF is stored only until it was handed over (max. 24 h when unpaid). No content is logged.
// Without credentials everything runs in test mode (mock print service, mock payment) – never in production.
const crypto = require('node:crypto');
const https = require('node:https');
const C = require('./config');
const H = require('./http');
const Sec = require('./security');
const { getShareStore } = require('./sharestore');
const { getPostStore } = require('./poststore');

const env = k => String(process.env[k] == null ? '' : process.env[k]).trim();
const num = (k, def, min, max) => { const v = parseFloat(env(k).replace(',', '.')); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def; };
const ID_RE = /^[A-Za-z0-9_-]{16,32}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{24,64}$/;
const randId = () => Sec.b64url(crypto.randomBytes(16));
const randToken = () => Sec.b64url(crypto.randomBytes(24));
const capHash = t => {
  if (typeof t !== 'string' || !TOKEN_RE.test(t)) throw new H.HttpError(403, 'forbidden', 'Keine Berechtigung');
  return Sec.sha256hex('fale-post:' + t);
};

// Gross prices in cents (incl. 19 % VAT) – POST_PRICES (JSON) overrides single values.
const DEFAULT_PRICES = { base: 199, includedSheets: 3, perSheet: 10, color: 50, r1: 300, r2: 350, intlBase: 299, faxBase: 99, faxIncluded: 5, faxPerPage: 10, faxIntlBase: 199, faxIntlPerPage: 20 };
const VAT = 0.19;
const STRIPE_PCT = 0.015, STRIPE_FIX = 25; // EU cards; the price guard keeps a margin above cost + fee

function postConfig() {
  let prices = { ...DEFAULT_PRICES };
  try { if (env('POST_PRICES')) prices = { ...prices, ...JSON.parse(env('POST_PRICES')) }; } catch { /* keep defaults */ }
  const production = process.env.VERCEL_ENV === 'production';
  const lxp = { user: env('LXP_USER'), key: env('LXP_APIKEY'), mode: env('LXP_MODE').toLowerCase() === 'live' ? 'live' : 'test' };
  const providerName = (env('POST_PROVIDER') || (lxp.user && lxp.key ? 'letterxpress' : 'mock')).toLowerCase();
  const paymentName = (env('POST_PAYMENT') || (env('STRIPE_SECRET_KEY') ? 'stripe' : 'mock')).toLowerCase();
  const sipgate = { tokenId: env('SIPGATE_TOKEN_ID'), token: env('SIPGATE_TOKEN'), faxline: env('SIPGATE_FAXLINE') || 'f0' };
  const faxName = (env('FAX_PROVIDER') || (sipgate.tokenId && sipgate.token ? 'sipgate' : 'mock')).toLowerCase();
  const on = (k, def) => (env(k) ? ['1', 'true', 'yes', 'on', 'ja'].includes(env(k).toLowerCase()) : def);
  return {
    enabled: on('POST_ENABLED', true),
    faxOn: on('FAX_ENABLED', true),
    production,
    provider: providerName === 'letterxpress' ? 'letterxpress' : 'mock',
    fax: faxName === 'sipgate' ? 'sipgate' : 'mock',
    payment: paymentName === 'stripe' ? 'stripe' : 'mock',
    lxp,
    sipgate,
    faxCostPerPage: num('FAX_COST_PER_PAGE', 0.05, 0, 2), // net € (sipgate tariff) – only for the price guard
    faxCostIntlPerPage: num('FAX_COST_INTL_PER_PAGE', 0.2, 0, 5),
    partners: partnerLinks(env('PARTNER_LINKS')),
    sweepSecret: env('POST_SWEEP_SECRET'),
    stripeKey: env('STRIPE_SECRET_KEY'),
    prices,
    minMarginCents: Math.round(num('POST_MIN_MARGIN_CENTS', 40, 0, 1000)),
    maxPages: Math.round(num('POST_MAX_PAGES', 10, 1, 40)),
    maxBytes: Math.round(num('POST_MAX_MB', 3, 0.2, 3.2) * 1024 * 1024), // base64 must stay below Vercel's 4.5 MB body limit
    devDaily: Math.round(num('POST_DEVICE_DAILY', 10, 1, 1000)),
    ipDaily: Math.round(num('POST_IP_DAILY', 20, 1, 10000)),
  };
}

/**
 * Partner links (affiliate, shown as „Anzeige“ after a cancellation letter), per country of the person:
 * PARTNER_LINKS = JSON {"DE": {"strom": "https://…", "handy": {"url": "https://…", "name": "CHECK24"}}, "AT": {…}}
 * (a flat {"strom": …} object means Germany). https only, known topics only.
 */
const PARTNER_KEYS = ['strom', 'gas', 'handy', 'internet', 'versicherung', 'kfz', 'fitness', 'abo'];
function partnerTopics(j) {
  const out = {};
  for (const k of PARTNER_KEYS) {
    const v = j[k];
    const url = typeof v === 'string' ? v : v && typeof v === 'object' ? v.url : '';
    if (typeof url !== 'string' || url.length > 600 || !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/|\?|$)/i.test(url)) continue;
    const name = v && typeof v === 'object' && typeof v.name === 'string' ? v.name.replace(/[<>"]/g, '').slice(0, 40) : '';
    out[k] = { url, name };
  }
  return out;
}
function partnerLinks(raw) {
  let j = null;
  try { j = raw ? JSON.parse(raw) : null; } catch { j = null; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return {};
  const keys = Object.keys(j);
  const byCountry = keys.some(k => /^[A-Z]{2}$/.test(k)) ? j : { DE: j };
  const out = {};
  for (const [c, v] of Object.entries(byCountry)) {
    if (!/^[A-Z]{2}$/.test(c) || !v || typeof v !== 'object') continue;
    const t = partnerTopics(v);
    if (Object.keys(t).length) out[c] = t;
  }
  return out;
}

/** Test mode = mock print service or mock payment or LetterXpress test mode. Mock parts are refused in production. */
const isTest = pc => pc.provider === 'mock' || pc.payment === 'mock' || (pc.provider === 'letterxpress' && pc.lxp.mode === 'test');
const isFaxTest = pc => pc.fax === 'mock' || pc.payment === 'mock';
const postOn = pc => pc.enabled && !(pc.production && (pc.provider === 'mock' || pc.payment === 'mock'));
const faxOn = pc => pc.faxOn && !(pc.production && (pc.fax === 'mock' || pc.payment === 'mock'));

// ------------------------------------------------------------------ fax numbers
// Countries a fax can go to (calling code; trunk prefix dropped in national format – Italy keeps its leading 0).
// Germany is domestic for our fax line; everything else is billed as abroad. Not offered: mobile and premium /
// service numbers (expensive, no fax machines) and countries where fax fraud to premium ranges is common.
const FAX_CC = {
  DE: '49', AT: '43', CH: '41', LI: '423', LU: '352', NL: '31', BE: '32', FR: '33', IT: '39', ES: '34', PT: '351',
  IE: '353', GB: '44', DK: '45', SE: '46', NO: '47', FI: '358', IS: '354', PL: '48', CZ: '420', SK: '421', HU: '36',
  SI: '386', HR: '385', RO: '40', BG: '359', GR: '30', CY: '357', MT: '356', EE: '372', LV: '371', LT: '370',
  TR: '90', IL: '972', US: '1', CA: '1', AU: '61', NZ: '64', JP: '81', SG: '65', HK: '852',
};
const CC_LIST = [...new Set(Object.values(FAX_CC))].sort((a, b) => b.length - a.length);
const KEEP_ZERO = new Set(['39']); // Italy: the 0 is part of the number
// North America: Caribbean and other NANP areas with international rates, premium 900/976
const NANP_BLOCK = /^(242|246|264|268|284|340|345|441|473|649|658|664|670|671|684|721|758|767|784|809|829|849|868|869|876|900|976)/;
/** Mobile / premium / special ranges by calling code (national significant number). */
const FAX_BLOCK = {
  49: /^(1|900|137|180|190|11)/, 43: /^(6|9|8[12])/, 41: /^(7[5-9]|90|84|0)/, 33: /^(6|7|8)/, 44: /^(7|9|8[47]|70|76)/,
  39: /^(3|89|4)/, 34: /^(6|7|80|90)/, 31: /^(6|90|84|85|87)/, 32: /^(4|90|70|78)/, 352: /^(6|90)/, 351: /^(9|7|6)/,
  353: /^(8|15)/, 45: /^(90)/, 46: /^(7|99|90)/, 47: /^(4|9|8)/, 358: /^(4|50|60|70|0)/, 48: /^(5|6|7|8)/,
  420: /^(6|7|90)/, 421: /^(9)/, 36: /^(20|30|31|50|70|90)/, 30: /^(6|90)/, 90: /^(5|8|9)/, 972: /^(5|1)/,
  61: /^(4|19|13|18)/, 64: /^(2|9)/, 81: /^(70|80|90|50|20|0)/, 65: /^(8|9|1)/, 852: /^(5|6|9)/,
};
/**
 * Fax number → { to: E.164, cc, intl } or null. `region` (ISO, e.g. 'FR' from the device language) decides how a
 * number without +/00 is read; default Germany.
 */
function faxNumber(input, region = 'DE') {
  let s = String(input || '').trim();
  if (!s || s.length > 40 || /[^\d\s()+\/.-]/.test(s)) return null;
  s = s.replace(/\(0\)/g, '').replace(/[\s()\/.-]/g, '');
  let cc = null, nsn = null;
  if (s.startsWith('+') || s.startsWith('00')) {
    const d = s.startsWith('+') ? s.slice(1) : s.slice(2);
    cc = CC_LIST.find(c => d.startsWith(c)) || null;
    if (!cc) return null;
    nsn = d.slice(cc.length);
  } else {
    cc = FAX_CC[String(region || 'DE').toUpperCase()] || '49';
    if (cc === '1') nsn = s.replace(/^1(?=\d{10}$)/, '');
    else if (KEEP_ZERO.has(cc)) nsn = s;
    else { if (!s.startsWith('0')) return null; nsn = s.slice(1); }
  }
  if (!/^\d+$/.test(nsn)) return null;
  if (cc === '1') {
    if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(nsn) || NANP_BLOCK.test(nsn)) return null;
  } else {
    if (!KEEP_ZERO.has(cc) && nsn.startsWith('0')) return null;
    if (nsn.length < 6 || nsn.length > 13) return null;
    if (KEEP_ZERO.has(cc) && !nsn.startsWith('0')) return null; // Italian landlines start with 0
    if (FAX_BLOCK[cc] && FAX_BLOCK[cc].test(cc === '39' ? nsn.slice(1) : nsn)) return null;
    if (cc === '39' && /^(89|3)/.test(nsn)) return null;
  }
  return { to: '+' + cc + nsn, cc, intl: cc !== '49' };
}

// ------------------------------------------------------------------ prices
/** Sheets incl. the address sheet; options → gross price in cents (before the cost guard). */
function listPrice(prices, { pages, color, registered, intl, channel }) {
  if (channel === 'fax') return Math.round(intl ? prices.faxIntlBase + Math.max(0, pages - prices.faxIncluded) * prices.faxIntlPerPage
    : prices.faxBase + Math.max(0, pages - prices.faxIncluded) * prices.faxPerPage);
  let p = intl ? prices.intlBase : prices.base;
  p += Math.max(0, pages - prices.includedSheets) * prices.perSheet;
  if (color) p += prices.color;
  if (!intl && registered === 'r1') p += prices.r1;
  if (!intl && registered === 'r2') p += prices.r2;
  return Math.round(p);
}
/** Never sell below cost: provider cost (net → gross) + payment fee + minimum margin; rounded up to …9 cents. */
function guardPrice(listCents, costNetEuro, minMargin) {
  if (!Number.isFinite(costNetEuro) || costNetEuro <= 0) return listCents;
  const costGross = Math.ceil(costNetEuro * (1 + VAT) * 100);
  const needed = Math.ceil((costGross + STRIPE_FIX + minMargin) / (1 - STRIPE_PCT));
  if (listCents >= needed) return listCents;
  return Math.ceil((needed + 1) / 10) * 10 - 1; // …9
}

// ------------------------------------------------------------------ PDF checks
/**
 * Pages of a PDF saved without object streams (the app does that for letters): the page tree's /Count (what a print
 * service prints – the largest /Count of the /Pages nodes is the root's), else the number of page objects.
 */
function countPages(buf) {
  const s = buf.toString('latin1');
  let max = 0;
  for (const m of s.matchAll(/<<((?:(?!>>)[\s\S]){0,400}?)\/Type\s*\/Pages(?![a-zA-Z])([\s\S]{0,400}?)>>/g)) {
    const c = /\/Count\s+(\d+)/.exec(m[1] + ' ' + m[2]);
    if (c) max = Math.max(max, +c[1]);
  }
  if (max) return max;
  const m = s.match(/\/Type\s*\/Page(?![a-zA-Z])/g);
  return m ? m.length : 0;
}

// ------------------------------------------------------------------ print service: LetterXpress (REST, JSON body also on GET)
function lxpRequest(pc, method, path, body, { requestImpl = https.request } = {}) {
  const payload = JSON.stringify({ auth: { username: pc.lxp.user, apikey: pc.lxp.key, mode: pc.lxp.mode }, ...(body || {}) });
  return new Promise((resolve, reject) => {
    const req = requestImpl({ host: 'api.letterxpress.de', path: `/v3${path}`, method, timeout: 40000,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* not JSON */ }
        if (res.statusCode >= 200 && res.statusCode < 300 && j) resolve(j);
        else { const e = new Error(`lxp ${method} ${path} ${res.statusCode}`); e.code = 'provider_error'; e.status = res.statusCode; reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('lxp timeout'), { code: 'provider_error' })));
    req.on('error', e => reject(Object.assign(e, { code: 'provider_error' })));
    req.end(payload);
  });
}
const spec = o => ({ pages: o.pages, color: o.color ? '4' : '1', mode: 'simplex', shipping: o.intl ? 'international' : 'national' });
function letterxpress(pc, deps) {
  return {
    name: 'letterxpress',
    async price(o) {
      const s = spec(o);
      const j = await lxpRequest(pc, 'GET', '/price', { letter: { specification: s }, ...(o.registered && !o.intl ? { registered: o.registered } : {}) }, deps);
      const p = j && j.data ? parseFloat(String(j.data.price).replace(',', '.')) : NaN;
      return Number.isFinite(p) ? p : null;
    },
    async send({ pdfB64, options, filename, notice }) {
      const s = spec(options); delete s.pages;
      const letter = { base64_file: pdfB64, base64_file_checksum: crypto.createHash('md5').update(pdfB64).digest('hex'), specification: s,
        filename_original: filename, notice };
      if (options.registered && !options.intl) letter.registered = options.registered;
      const j = await lxpRequest(pc, 'POST', '/printjobs', { letter }, deps);
      if (!j || !j.data || j.data.id == null) throw Object.assign(new Error('lxp no id'), { code: 'provider_error' });
      return { id: String(j.data.id), status: j.data.status || 'queue' };
    },
    async status(id) {
      const j = await lxpRequest(pc, 'GET', `/printjobs/${encodeURIComponent(id)}`, null, deps);
      const d = (j && j.data) || {};
      const item = Array.isArray(d.items) && d.items[0] ? d.items[0] : {};
      return { status: d.status || null, itemStatus: item.status || null, tracking: item.tracking_code || null, trackingStatus: item.tracking_status || null };
    },
  };
}
// mock print service (tests / no credentials): prints instantly, registered letters get a tracking code
const mockJobs = new Map();
function mockProvider() {
  return {
    name: 'mock',
    async price(o) { return Math.round(((o.intl ? 1.6 : 0.69) + Math.max(0, o.pages - 1) * 0.06 + (o.color ? 0.25 : 0) + (o.registered === 'r1' ? 2.3 : o.registered === 'r2' ? 2.6 : 0)) * 100) / 100; },
    async send({ pdfB64, options }) {
      if (!pdfB64 || mockProvider.fail) throw Object.assign(new Error('mock fail'), { code: 'provider_error' });
      const id = String(6000000 + mockJobs.size + 1);
      mockJobs.set(id, { options, at: Date.now(), bytes: Buffer.from(pdfB64, 'base64').length });
      return { id, status: 'queue' };
    },
    async status(id) {
      const j = mockJobs.get(id);
      if (!j) return { status: null };
      const done = mockProvider.done;
      return { status: done ? 'done' : 'queue', itemStatus: done ? 'sent' : 'queue', tracking: done && j.options.registered ? `RT${String(id).slice(-6)}123DE` : null, trackingStatus: null };
    },
  };
}
mockProvider.fail = false;
mockProvider.done = false;

// ------------------------------------------------------------------ fax service: sipgate.io (REST, Basic auth with a personal access token)
function sipgateFax(pc, { fetchImpl = fetch } = {}) {
  const auth = 'Basic ' + Buffer.from(`${pc.sipgate.tokenId}:${pc.sipgate.token}`).toString('base64');
  async function call(method, path, body) {
    const r = await fetchImpl(`https://api.sipgate.com/v2${path}`, {
      method, headers: { Authorization: auth, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const t = await r.text().catch(() => '');
    if (!r.ok) throw Object.assign(new Error(`sipgate ${method} ${path} ${r.status}`), { code: 'provider_error', status: r.status });
    try { return t ? JSON.parse(t) : {}; } catch { return {}; }
  }
  return {
    name: 'sipgate',
    async price(o) { return Math.max(0.1, o.pages * (o.intl ? pc.faxCostIntlPerPage : pc.faxCostPerPage)); },
    async send({ pdfB64, options, filename }) {
      const j = await call('POST', '/sessions/fax', { faxlineId: pc.sipgate.faxline, recipient: options.to, filename, base64Content: pdfB64 });
      if (!j || !j.sessionId) throw Object.assign(new Error('sipgate no session'), { code: 'provider_error' });
      return { id: String(j.sessionId).slice(0, 64), status: 'PENDING' };
    },
    async status(id) {
      const j = await call('GET', `/history/${encodeURIComponent(id)}`);
      return { status: j && j.faxStatusType ? String(j.faxStatusType).toUpperCase() : null };
    },
  };
}
// mock fax (tests / no credentials): faxMock.fail = fails every try; faxMock.failOnce = only the first try fails
const mockFaxes = new Map();
function faxMock() {
  return {
    name: 'mock',
    async price(o) { return Math.max(0.1, o.pages * (o.intl ? 0.2 : 0.05)); },
    async send({ pdfB64, options }) {
      if (!pdfB64) throw Object.assign(new Error('mock fax: no pdf'), { code: 'provider_error' });
      const id = 'fax' + String(7000000 + mockFaxes.size + 1);
      const fail = faxMock.fail || (faxMock.failOnce && ![...mockFaxes.values()].some(f => f.to === options.to));
      faxMock.sent += 1;
      mockFaxes.set(id, { to: options.to, at: Date.now(), fail });
      return { id, status: 'PENDING' };
    },
    async status(id) {
      const f = mockFaxes.get(id);
      if (!f) return { status: null };
      return { status: f.fail ? 'FAILED' : faxMock.done ? 'SENT' : 'SENDING' };
    },
  };
}
faxMock.fail = false;
faxMock.failOnce = false;
faxMock.done = true;
faxMock.sent = 0;

// ------------------------------------------------------------------ payment: Stripe Checkout (REST, form-encoded)
function form(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v == null) continue;
    if (typeof v === 'object') form(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out.join('&');
}
function stripe(pc, { fetchImpl = fetch } = {}) {
  async function call(method, path, body) {
    const r = await fetchImpl(`https://api.stripe.com/v1${path}`, {
      method, headers: { Authorization: `Bearer ${pc.stripeKey}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), 'Stripe-Version': '2024-06-20' },
      body: body ? form(body) : undefined,
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) throw Object.assign(new Error(`stripe ${path} ${r.status}`), { code: 'payment_error', status: r.status });
    return j;
  }
  return {
    name: 'stripe',
    async checkout({ jobId, amount, name, successUrl, cancelUrl }) {
      const s = await call('POST', '/checkout/sessions', {
        mode: 'payment', client_reference_id: jobId, success_url: successUrl, cancel_url: cancelUrl, locale: 'auto',
        expires_at: Math.floor(Date.now() / 1000) + 3600 * 2,
        line_items: { 0: { quantity: 1, price_data: { currency: 'eur', unit_amount: amount, product_data: { name } } } },
        metadata: { job: jobId }, payment_intent_data: { metadata: { job: jobId }, description: name },
      });
      return { sessionId: s.id, url: s.url };
    },
    async session(id) {
      const s = await call('GET', `/checkout/sessions/${encodeURIComponent(id)}`);
      return { paid: s.payment_status === 'paid', paymentIntent: typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent && s.payment_intent.id, job: s.metadata && s.metadata.job, amount: s.amount_total };
    },
    async event(id) { return call('GET', `/events/${encodeURIComponent(id)}`); },
    async refund(paymentIntent) { return call('POST', '/refunds', { payment_intent: paymentIntent }); },
  };
}
const mockSessions = new Map();
function mockPayment() {
  return {
    name: 'mock',
    async checkout({ jobId, amount }) { const id = 'cs_test_' + randId(); mockSessions.set(id, { job: jobId, amount, paid: false }); return { sessionId: id, url: `mock:pay/${id}` }; },
    async session(id) { const s = mockSessions.get(id); return s ? { paid: s.paid, paymentIntent: s.paid ? 'pi_mock_' + id.slice(-8) : null, job: s.job, amount: s.amount } : { paid: false }; },
    async event(id) { const s = mockSessions.get(id.replace(/^evt_/, '')); return s ? { type: 'checkout.session.completed', data: { object: { id: id.replace(/^evt_/, '') } } } : null; },
    async refund() { return { status: 'succeeded' }; },
    _pay(id) { const s = mockSessions.get(id); if (s) s.paid = true; return !!s; },
  };
}
const mockPay = mockPayment();

// ------------------------------------------------------------------ core
const LABEL = { '': 'Brief', r1: 'Einschreiben Einwurf', r2: 'Einschreiben', fax: 'Fax' };
function publicJob(j) {
  return { id: j.id, status: j.status, priceCents: j.price_cents, pages: j.pages, options: j.options, tracking: j.tracking || null,
    createdAt: j.created_at, paidAt: j.paid_at || null, sentAt: j.sent_at || null, error: j.error || null };
}

function makePostalCore(overrides = {}) {
  const deps = { getConfig: C.getConfig, getShareStore, getPostStore, postConfig, now: () => new Date(), fetchImpl: undefined, requestImpl: undefined, ...overrides };
  const letterProvider = pc => (pc.provider === 'letterxpress' ? letterxpress(pc, { requestImpl: deps.requestImpl }) : mockProvider());
  const faxProvider = pc => (pc.fax === 'sipgate' ? sipgateFax(pc, deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) : faxMock());
  const providerOf = (pc, o) => (o && o.channel === 'fax' ? faxProvider(pc) : letterProvider(pc));
  const paymentOf = pc => (pc.payment === 'stripe' ? stripe(pc, deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) : mockPay);

  function check(cfg, pc) {
    if (!C.secretsConfigured(cfg) || !C.storeConfigured(cfg) && cfg.store !== 'memory') throw new H.HttpError(503, 'post_not_configured', 'Der Briefversand ist noch nicht eingerichtet.');
  }
  function checkChannel(pc, o) {
    if (o.channel === 'fax') {
      if (!faxOn(pc)) throw new H.HttpError(503, pc.faxOn ? 'fax_not_configured' : 'fax_disabled', 'Der Faxversand ist noch nicht eingerichtet.');
      return;
    }
    if (!pc.enabled) throw new H.HttpError(503, 'post_disabled', 'Der Briefversand ist gerade nicht verfügbar.');
    if (!postOn(pc)) throw new H.HttpError(503, 'post_not_configured', 'Der Briefversand ist noch nicht eingerichtet.');
  }
  function options(body, pc) {
    const pages = body.pages;
    if (body.channel === 'fax') {
      if (!Number.isInteger(pages) || pages < 1 || pages > pc.maxPages) throw new H.HttpError(400, 'too_many_pages', `Höchstens ${pc.maxPages} Seiten pro Fax.`);
      const n = faxNumber(body.to, typeof body.region === 'string' ? body.region.slice(0, 2) : 'DE');
      if (!n) throw new H.HttpError(400, 'bad_fax_number', 'Diese Faxnummer geht nicht (Festnetz, mit Vorwahl).');
      return { channel: 'fax', pages, to: n.to, intl: n.intl, cc: n.cc };
    }
    if (!Number.isInteger(pages) || pages < 1 || pages > pc.maxPages) throw new H.HttpError(400, 'too_many_pages', `Höchstens ${pc.maxPages} Seiten pro Brief.`);
    const registered = ['', 'r1', 'r2'].includes(body.registered || '') ? (body.registered || '') : null;
    if (registered === null) throw new H.HttpError(400, 'bad_input', 'Ungültige Versandart');
    const intl = !!body.intl;
    if (intl && registered) throw new H.HttpError(400, 'registered_national', 'Einschreiben ist nur innerhalb Deutschlands möglich.');
    return { pages, color: !!body.color, registered, intl };
  }
  async function quote(pc, o) {
    const list = listPrice(pc.prices, o);
    let cost = null;
    try { cost = await providerOf(pc, o).price(o); } catch { cost = null; } // the list price stays; the guard runs again at create
    return guardPrice(list, cost, pc.minMarginCents);
  }
  const ctxOf = (req, cfg) => { const now = deps.now(); const day = Sec.dayKey(cfg.timeZone, now); return { now, day, ip: Sec.ipHash(cfg.ipSalt, H.clientIp(req), day) }; };
  const guard = fn => async (req, res, cfg) => {
    try { await fn(req, res, cfg); }
    catch (e) {
      if (e && e.code === 'store_error' && e.status === 404) throw new H.HttpError(503, 'post_not_configured', 'Der Briefversand ist noch nicht eingerichtet.');
      throw e;
    }
  };

  /** Hand the paid letter to the print service – exactly once (atomic paid transition). Refund when that fails. */
  async function dispatch(pc, store, job, paymentIntent) {
    const t = await store.patch({ id: job.id, from: 'pending_payment', patch: { status: 'paid', payment_intent: paymentIntent || null, paid_at: deps.now().toISOString() } });
    if (!t || !t.ok) return (await store.get({ id: job.id })).job; // someone else got there first
    const full = await store.get({ id: job.id, withPdf: true });
    const pdf = full && full.job && full.job.pdf;
    const fax = job.options && job.options.channel === 'fax';
    try {
      if (!pdf) throw Object.assign(new Error('no pdf'), { code: 'provider_error' });
      const r = await providerOf(pc, job.options).send({ pdfB64: pdf, options: job.options, filename: `FaLe-${job.id.slice(0, 8)}.pdf`, notice: `FaLe ${job.id}` });
      // a fax keeps its PDF for the second try until it went through (then it is deleted, see refreshFax)
      const done = await store.patch({ id: job.id, from: 'paid', patch: { status: 'submitted', provider_id: r.id, provider_status: r.status, ...(fax ? {} : { pdf: null }) } });
      return done.job;
    } catch (e) {
      let status = 'failed';
      try { if (paymentIntent) { await paymentOf(pc).refund(paymentIntent); status = 'refunded'; } } catch { /* stays failed – owner sees it in the Stripe dashboard */ }
      const f = await store.patch({ id: job.id, from: 'paid', patch: { status, error: 'provider', pdf: null } });
      return f.job;
    }
  }
  /** Fax: SENT → sent (PDF deleted); FAILED → one more try, then refund. */
  async function refreshFax(pc, store, job) {
    let st;
    try { st = await faxProvider(pc).status(job.provider_id); } catch { return job; }
    const s = st.status;
    if (s === 'SENT') {
      const r = await store.patch({ id: job.id, from: 'submitted', patch: { status: 'sent', provider_status: s, sent_at: deps.now().toISOString(), pdf: null } });
      return r && r.ok ? r.job : job;
    }
    if (s === 'FAILED') {
      if (job.error !== 'retry') {
        // claim the second try atomically (submitted → paid; only one request wins), then send the stored PDF again
        const c = await store.patch({ id: job.id, from: 'submitted', patch: { status: 'paid', error: 'retry', provider_status: 'RETRY' } });
        if (!c || !c.ok) return (await store.get({ id: job.id })).job;
        const full = await store.get({ id: job.id, withPdf: true });
        try {
          if (!full.job.pdf) throw new Error('no pdf');
          const r = await faxProvider(pc).send({ pdfB64: full.job.pdf, options: job.options, filename: `FaLe-${job.id.slice(0, 8)}.pdf` });
          const p = await store.patch({ id: job.id, from: 'paid', patch: { status: 'submitted', provider_id: r.id, provider_status: r.status } });
          return p && p.ok ? p.job : job;
        } catch {
          let status = 'failed';
          try { if (job.payment_intent) { await paymentOf(pc).refund(job.payment_intent); status = 'refunded'; } } catch { /* owner sees it in Stripe */ }
          const f = await store.patch({ id: job.id, from: 'paid', patch: { status, provider_status: 'FAILED', error: 'fax_failed', pdf: null } });
          return f && f.ok ? f.job : job;
        }
      }
      let status = 'failed';
      try { if (job.payment_intent) { await paymentOf(pc).refund(job.payment_intent); status = 'refunded'; } } catch { /* owner sees it in Stripe */ }
      const f = await store.patch({ id: job.id, from: 'submitted', patch: { status, provider_status: 'FAILED', error: 'fax_failed', pdf: null } });
      return f && f.ok ? f.job : job;
    }
    if (s && s !== job.provider_status) {
      const r = await store.patch({ id: job.id, from: 'submitted', patch: { provider_status: s.slice(0, 32) } });
      return r && r.ok ? r.job : job;
    }
    return job;
  }
  async function refresh(pc, store, job) {
    if (job.status === 'pending_payment' && job.session_id) {
      const s = await paymentOf(pc).session(job.session_id);
      if (s.paid && s.job === job.id) return dispatch(pc, store, job, s.paymentIntent);
      return job;
    }
    if (job.status === 'submitted' && job.provider_id && job.options && job.options.channel === 'fax') return refreshFax(pc, store, job);
    if (job.status === 'submitted' && job.provider_id) {
      try {
        const st = await letterProvider(pc).status(job.provider_id);
        const sent = st.status === 'done' || st.itemStatus === 'sent';
        const patch = { provider_status: st.status || job.provider_status };
        if (st.tracking) patch.tracking = String(st.tracking).slice(0, 60);
        if (sent) { patch.status = 'sent'; patch.sent_at = deps.now().toISOString(); }
        if (st.status === 'canceled') patch.status = 'failed';
        const r = await store.patch({ id: job.id, from: 'submitted', patch });
        return r && r.ok ? r.job : job;
      } catch { return job; }
    }
    return job;
  }

  const post = H.handler(['POST'], guard(async (req, res, cfg) => {
    const pc = deps.postConfig();
    const body = await H.readJson(req, Math.ceil(pc.maxBytes * 1.4) + 8192);
    const a = String(H.query(req).a || body.a || '');
    if (a === 'config') {
      H.sendJson(res, 200, { ok: true, enabled: postOn(pc), test: isTest(pc), fax: faxOn(pc), faxTest: isFaxTest(pc), maxPages: pc.maxPages, maxBytes: pc.maxBytes,
        prices: pc.prices, currency: 'EUR', payment: pc.payment, partners: pc.partners });
      return;
    }
    check(cfg, pc);
    const store = deps.getPostStore(cfg);
    if (a === 'sweep') {
      // scheduled check (GitHub workflow „Post sweep“): moves on paid / submitted jobs nobody looks at in the app
      // (refund for a fax that never went through, tracking codes) – needs POST_SWEEP_SECRET
      const sec = String(req.headers['x-fale-sweep'] || '');
      if (!pc.sweepSecret || pc.sweepSecret.length < 24 || !Sec.safeEqual(Sec.sha256hex(sec), Sec.sha256hex(pc.sweepSecret))) throw new H.HttpError(403, 'forbidden', 'Keine Berechtigung');
      const open = store.open ? await store.open({ limit: 40 }) : { ok: true, jobs: [] };
      const out = {};
      for (const j of (open && open.jobs) || []) {
        try { const r = await refresh(pc, store, j); out[r.status] = (out[r.status] || 0) + 1; } catch { out.error = (out.error || 0) + 1; }
      }
      H.sendJson(res, 200, { ok: true, checked: ((open && open.jobs) || []).length, result: out });
      return;
    }
    if (a === 'quote') {
      // checking a fax number while typing: an invalid number is an answer, not a failed request (200, ok:false)
      let o;
      try { o = options(body, pc); }
      catch (e) { if (body.channel === 'fax' && e && e.code === 'bad_fax_number') { H.sendJson(res, 200, { ok: false, error: e.code, message: e.message }); return; } throw e; }
      checkChannel(pc, o);
      H.sendJson(res, 200, { ok: true, priceCents: await quote(pc, o), label: o.channel === 'fax' ? LABEL.fax : LABEL[o.registered], ...(o.channel === 'fax' ? { to: o.to, intl: o.intl, cc: o.cc } : {}) });
      return;
    }
    if (a === 'webhook') {
      // Stripe event: never trusted as sent – the event is fetched again from Stripe with our secret key
      if (pc.payment !== 'stripe' && !(pc.payment === 'mock' && !pc.production)) throw new H.HttpError(400, 'bad_input', 'Unbekannt');
      const id = String(body.id || '');
      if (!/^evt_[A-Za-z0-9_-]{6,80}$/.test(id)) { H.sendJson(res, 200, { ok: true, ignored: true }); return; }
      const ev = await paymentOf(pc).event(id);
      if (!ev || !['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(ev.type)) { H.sendJson(res, 200, { ok: true, ignored: true }); return; }
      const sid = ev.data && ev.data.object && ev.data.object.id;
      const s = sid ? await paymentOf(pc).session(sid) : null;
      if (!s || !s.paid || !s.job || !ID_RE.test(s.job)) { H.sendJson(res, 200, { ok: true, ignored: true }); return; }
      const g = await store.get({ id: s.job });
      if (g && g.ok && g.job.session_id === sid) await dispatch(pc, store, g.job, s.paymentIntent);
      H.sendJson(res, 200, { ok: true });
      return;
    }
    if (a === 'create') {
      const o = options(body, pc);
      checkChannel(pc, o);
      const c = ctxOf(req, cfg);
      const dh = Sec.verifyToken(cfg.tokenSecret, body.token);
      if (!dh) throw new H.HttpError(401, 'invalid_token', 'Gerätekennung ungültig – bitte erneut verbinden');
      if (typeof body.pdf !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(body.pdf)) throw new H.HttpError(400, 'bad_input', 'Ungültige Datei');
      const buf = Buffer.from(body.pdf, 'base64');
      if (buf.length > pc.maxBytes) throw new H.HttpError(413, 'too_large', `Die Datei ist zu groß (max. ${Math.round(pc.maxBytes / 1048576 * 10) / 10} MB). Verkleinere sie zuerst.`);
      if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new H.HttpError(400, 'bad_input', 'Das ist keine PDF.');
      const counted = countPages(buf);
      if (counted !== o.pages) throw new H.HttpError(400, 'page_mismatch', 'Die Seitenzahl stimmt nicht. Bitte versuche es erneut.');
      const country = o.channel === 'fax' ? '' : String(body.country || '').slice(0, 40);
      const rl = await deps.getShareStore(cfg).rate({ day: c.day, kind: 'post', keys: ['d:' + dh, 'i:' + c.ip], nLimits: [pc.devDaily, pc.ipDaily], bytes: 0, bLimits: [1, 1] });
      if (!rl || !rl.ok) throw new H.HttpError(429, 'post_limit', 'Heute wurden schon viele Briefe von diesem Gerät verschickt. Morgen geht es weiter.');
      const price = await quote(pc, o);
      if (Number.isInteger(body.expectCents) && body.expectCents !== price) throw new H.HttpError(409, 'price_changed', 'Der Preis hat sich geändert. Bitte prüfe ihn noch einmal.', { priceCents: price });
      const id = randId(), cap = randToken();
      const opts = o.channel === 'fax' ? o : { ...o, country };
      const r = await store.create({ id, owner: dh, cap: capHash(cap), options: opts, priceCents: price, pages: o.pages, pdf: body.pdf });
      if (!r || !r.ok) throw new H.HttpError(500, 'internal', 'Interner Fehler');
      const base = String(cfg.publicAppUrl || C.publicAppUrl()).replace(/\/+$/, '');
      const name = o.channel === 'fax' ? `FaLe: Fax${o.intl ? ' (Ausland)' : ''}, ${o.pages} Seite${o.pages === 1 ? '' : 'n'}`
        : `FaLe: ${LABEL[o.registered]}${o.intl ? ' (Ausland)' : ''}, ${o.pages} Seite${o.pages === 1 ? '' : 'n'}${o.color ? ', farbig' : ''}`;
      let co;
      try {
        co = await paymentOf(pc).checkout({ jobId: id, amount: price, name, successUrl: `${base}/app/#/post/${id}?bezahlt=1`, cancelUrl: `${base}/app/#/post/${id}?abgebrochen=1` });
      } catch (e) {
        await store.remove({ id });
        throw new H.HttpError(502, 'payment_unavailable', 'Die Bezahlung ist gerade nicht erreichbar. Bitte versuche es später erneut.');
      }
      await store.patch({ id, from: 'pending_payment', patch: { session_id: co.sessionId } });
      H.sendJson(res, 200, { ok: true, id, cap, priceCents: price, checkoutUrl: co.url, test: o.channel === 'fax' ? isFaxTest(pc) : isTest(pc) });
      return;
    }
    // job actions: id + capability
    const id = String(body.id || '');
    if (!ID_RE.test(id)) throw new H.HttpError(400, 'bad_input', 'Ungültige Anfrage');
    const g = await store.get({ id });
    if (!g || !g.ok) throw new H.HttpError(404, 'not_found', 'Diesen Auftrag gibt es nicht (mehr).');
    if (!Sec.safeEqual(g.job.cap_hash, capHash(body.cap))) throw new H.HttpError(403, 'forbidden', 'Keine Berechtigung');
    if (a === 'status') {
      const j = await refresh(pc, store, g.job);
      H.sendJson(res, 200, { ok: true, job: publicJob(j), test: j.options && j.options.channel === 'fax' ? isFaxTest(pc) : isTest(pc) });
      return;
    }
    if (a === 'cancel') {
      if (g.job.status !== 'pending_payment') throw new H.HttpError(409, 'not_cancelable', 'Der Brief ist schon bezahlt und wird verschickt.');
      // a payment that arrived in the meantime wins
      const j = await refresh(pc, store, g.job);
      if (j.status !== 'pending_payment') { H.sendJson(res, 200, { ok: true, job: publicJob(j) }); return; }
      const r = await store.patch({ id, from: 'pending_payment', patch: { status: 'canceled', pdf: null } });
      H.sendJson(res, 200, { ok: true, job: publicJob(r.ok ? r.job : j) });
      return;
    }
    if (a === 'mockpay') {
      if (pc.payment !== 'mock' || pc.production) throw new H.HttpError(400, 'bad_input', 'Unbekannte Aktion');
      mockPay._pay(g.job.session_id);
      const j = await refresh(pc, store, g.job);
      H.sendJson(res, 200, { ok: true, job: publicJob(j) });
      return;
    }
    throw new H.HttpError(400, 'unknown_action', 'Unbekannte Aktion');
  }), { getConfig: () => deps.getConfig() });

  return { post, deps };
}

module.exports = { makePostalCore, postConfig, listPrice, guardPrice, countPages, form, faxNumber, partnerLinks, DEFAULT_PRICES, mockProvider, faxMock, mockPay, _test: { letterxpress, stripe, sipgateFax } };
