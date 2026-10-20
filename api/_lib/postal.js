'use strict';
// „Brief per Post“ (/api/post): FaLe prints and mails a letter for the person – normal, Einschreiben Einwurf or
// Einschreiben – through a print-and-mail service (LetterXpress), paid by card / PayPal / Google Pay … via Stripe
// Checkout (a printed and delivered letter is a physical service: Google Play billing must not be used for it).
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
const DEFAULT_PRICES = { base: 199, includedSheets: 3, perSheet: 10, color: 50, r1: 300, r2: 350, intlBase: 299 };
const VAT = 0.19;
const STRIPE_PCT = 0.015, STRIPE_FIX = 25; // EU cards; the price guard keeps a margin above cost + fee

function postConfig() {
  let prices = { ...DEFAULT_PRICES };
  try { if (env('POST_PRICES')) prices = { ...prices, ...JSON.parse(env('POST_PRICES')) }; } catch { /* keep defaults */ }
  const production = process.env.VERCEL_ENV === 'production';
  const lxp = { user: env('LXP_USER'), key: env('LXP_APIKEY'), mode: env('LXP_MODE').toLowerCase() === 'live' ? 'live' : 'test' };
  const providerName = (env('POST_PROVIDER') || (lxp.user && lxp.key ? 'letterxpress' : 'mock')).toLowerCase();
  const paymentName = (env('POST_PAYMENT') || (env('STRIPE_SECRET_KEY') ? 'stripe' : 'mock')).toLowerCase();
  return {
    enabled: env('POST_ENABLED') ? ['1', 'true', 'yes', 'on', 'ja'].includes(env('POST_ENABLED').toLowerCase()) : true,
    production,
    provider: providerName === 'letterxpress' ? 'letterxpress' : 'mock',
    payment: paymentName === 'stripe' ? 'stripe' : 'mock',
    lxp,
    stripeKey: env('STRIPE_SECRET_KEY'),
    prices,
    minMarginCents: Math.round(num('POST_MIN_MARGIN_CENTS', 40, 0, 1000)),
    maxPages: Math.round(num('POST_MAX_PAGES', 10, 1, 40)),
    maxBytes: Math.round(num('POST_MAX_MB', 3, 0.2, 3.2) * 1024 * 1024), // base64 must stay below Vercel's 4.5 MB body limit
    devDaily: Math.round(num('POST_DEVICE_DAILY', 10, 1, 1000)),
    ipDaily: Math.round(num('POST_IP_DAILY', 20, 1, 10000)),
  };
}

/** Test mode = mock print service or mock payment or LetterXpress test mode. Mock parts are refused in production. */
const isTest = pc => pc.provider === 'mock' || pc.payment === 'mock' || (pc.provider === 'letterxpress' && pc.lxp.mode === 'test');

// ------------------------------------------------------------------ prices
/** Sheets incl. the address sheet; options → gross price in cents (before the cost guard). */
function listPrice(prices, { pages, color, registered, intl }) {
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
const LABEL = { '': 'Brief', r1: 'Einschreiben Einwurf', r2: 'Einschreiben' };
function publicJob(j) {
  return { id: j.id, status: j.status, priceCents: j.price_cents, pages: j.pages, options: j.options, tracking: j.tracking || null,
    createdAt: j.created_at, paidAt: j.paid_at || null, sentAt: j.sent_at || null, error: j.error || null };
}

function makePostalCore(overrides = {}) {
  const deps = { getConfig: C.getConfig, getShareStore, getPostStore, postConfig, now: () => new Date(), fetchImpl: undefined, requestImpl: undefined, ...overrides };
  const providerOf = pc => (pc.provider === 'letterxpress' ? letterxpress(pc, { requestImpl: deps.requestImpl }) : mockProvider());
  const paymentOf = pc => (pc.payment === 'stripe' ? stripe(pc, deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) : mockPay);

  function check(cfg, pc) {
    if (!pc.enabled) throw new H.HttpError(503, 'post_disabled', 'Der Briefversand ist gerade nicht verfügbar.');
    if (!C.secretsConfigured(cfg) || !C.storeConfigured(cfg) && cfg.store !== 'memory') throw new H.HttpError(503, 'post_not_configured', 'Der Briefversand ist noch nicht eingerichtet.');
    if (pc.production && (pc.provider === 'mock' || pc.payment === 'mock')) throw new H.HttpError(503, 'post_not_configured', 'Der Briefversand ist noch nicht eingerichtet.');
  }
  function options(body, pc) {
    const pages = body.pages;
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
    try { cost = await providerOf(pc).price(o); } catch { cost = null; } // the list price stays; the guard runs again at create
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
    try {
      if (!pdf) throw Object.assign(new Error('no pdf'), { code: 'provider_error' });
      const r = await providerOf(pc).send({ pdfB64: pdf, options: job.options, filename: `FaLe-${job.id.slice(0, 8)}.pdf`, notice: `FaLe ${job.id}` });
      const done = await store.patch({ id: job.id, from: 'paid', patch: { status: 'submitted', provider_id: r.id, provider_status: r.status, pdf: null } });
      return done.job;
    } catch (e) {
      let status = 'failed';
      try { if (paymentIntent) { await paymentOf(pc).refund(paymentIntent); status = 'refunded'; } } catch { /* stays failed – owner sees it in the Stripe dashboard */ }
      const f = await store.patch({ id: job.id, from: 'paid', patch: { status, error: 'provider', pdf: null } });
      return f.job;
    }
  }
  async function refresh(pc, store, job) {
    if (job.status === 'pending_payment' && job.session_id) {
      const s = await paymentOf(pc).session(job.session_id);
      if (s.paid && s.job === job.id) return dispatch(pc, store, job, s.paymentIntent);
      return job;
    }
    if (job.status === 'submitted' && job.provider_id) {
      try {
        const st = await providerOf(pc).status(job.provider_id);
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
      H.sendJson(res, 200, { ok: true, enabled: pc.enabled && !(pc.production && (pc.provider === 'mock' || pc.payment === 'mock')), test: isTest(pc), maxPages: pc.maxPages, maxBytes: pc.maxBytes, prices: pc.prices, currency: 'EUR', payment: pc.payment });
      return;
    }
    check(cfg, pc);
    const store = deps.getPostStore(cfg);
    if (a === 'quote') {
      const o = options(body, pc);
      H.sendJson(res, 200, { ok: true, priceCents: await quote(pc, o), label: LABEL[o.registered] });
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
      const c = ctxOf(req, cfg);
      const dh = Sec.verifyToken(cfg.tokenSecret, body.token);
      if (!dh) throw new H.HttpError(401, 'invalid_token', 'Gerätekennung ungültig – bitte erneut verbinden');
      if (typeof body.pdf !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(body.pdf)) throw new H.HttpError(400, 'bad_input', 'Ungültige Datei');
      const buf = Buffer.from(body.pdf, 'base64');
      if (buf.length > pc.maxBytes) throw new H.HttpError(413, 'too_large', `Die Datei ist zu groß (max. ${Math.round(pc.maxBytes / 1048576 * 10) / 10} MB). Verkleinere sie zuerst.`);
      if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new H.HttpError(400, 'bad_input', 'Das ist keine PDF.');
      const counted = countPages(buf);
      if (counted !== o.pages) throw new H.HttpError(400, 'page_mismatch', 'Die Seitenzahl stimmt nicht. Bitte versuche es erneut.');
      const country = String(body.country || '').slice(0, 40);
      const rl = await deps.getShareStore(cfg).rate({ day: c.day, kind: 'post', keys: ['d:' + dh, 'i:' + c.ip], nLimits: [pc.devDaily, pc.ipDaily], bytes: 0, bLimits: [1, 1] });
      if (!rl || !rl.ok) throw new H.HttpError(429, 'post_limit', 'Heute wurden schon viele Briefe von diesem Gerät verschickt. Morgen geht es weiter.');
      const price = await quote(pc, o);
      if (Number.isInteger(body.expectCents) && body.expectCents !== price) throw new H.HttpError(409, 'price_changed', 'Der Preis hat sich geändert. Bitte prüfe ihn noch einmal.', { priceCents: price });
      const id = randId(), cap = randToken();
      const opts = { ...o, country };
      const r = await store.create({ id, owner: dh, cap: capHash(cap), options: opts, priceCents: price, pages: o.pages, pdf: body.pdf });
      if (!r || !r.ok) throw new H.HttpError(500, 'internal', 'Interner Fehler');
      const base = String(cfg.publicAppUrl || C.publicAppUrl()).replace(/\/+$/, '');
      const name = `FaLe: ${LABEL[o.registered]}${o.intl ? ' (Ausland)' : ''}, ${o.pages} Seite${o.pages === 1 ? '' : 'n'}${o.color ? ', farbig' : ''}`;
      let co;
      try {
        co = await paymentOf(pc).checkout({ jobId: id, amount: price, name, successUrl: `${base}/app/#/post/${id}?bezahlt=1`, cancelUrl: `${base}/app/#/post/${id}?abgebrochen=1` });
      } catch (e) {
        await store.remove({ id });
        throw new H.HttpError(502, 'payment_unavailable', 'Die Bezahlung ist gerade nicht erreichbar. Bitte versuche es später erneut.');
      }
      await store.patch({ id, from: 'pending_payment', patch: { session_id: co.sessionId } });
      H.sendJson(res, 200, { ok: true, id, cap, priceCents: price, checkoutUrl: co.url, test: isTest(pc) });
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
      H.sendJson(res, 200, { ok: true, job: publicJob(j), test: isTest(pc) });
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

module.exports = { makePostalCore, postConfig, listPrice, guardPrice, countPages, form, DEFAULT_PRICES, mockProvider, mockPay, _test: { letterxpress, stripe } };
