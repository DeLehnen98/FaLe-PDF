// Node unit tests for „Brief per Post“ (api/_lib/postal.js + poststore.js): prices, checks, payment → exactly one
// hand-over to the print service, refund on failure, status/tracking, capabilities, production guard, and the exact
// requests sent to LetterXpress and Stripe (mocked transports). In-memory stores, no network.
//   node test_post_api.mjs
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';

const ROOT = process.env.FALE_ROOT || '/home/claude/FalePDF';
const require = createRequire(join(ROOT, 'api', 'x.js'));
Object.assign(process.env, { FALE_STORE: 'memory', FALE_TOKEN_SECRET: 'test-token-secret-0123456789abcdefghijklmnopqrstuvwxyz', FALE_IP_SALT: 'test-ip-salt-0123456789' });
for (const k of ['LXP_USER', 'LXP_APIKEY', 'STRIPE_SECRET_KEY', 'POST_PROVIDER', 'POST_PAYMENT', 'VERCEL_ENV', 'POST_ENABLED', 'SIPGATE_TOKEN_ID', 'SIPGATE_TOKEN', 'FAX_PROVIDER', 'FAX_ENABLED', 'PARTNER_LINKS', 'POST_SWEEP_SECRET']) delete process.env[k];
const P = require('./_lib/postal.js');
const { memoryPostStore } = require('./_lib/poststore.js');
const { memoryShareStore } = require('./_lib/sharestore.js');
const Sec = require('./_lib/security.js');

let pass = 0, fail = 0;
const check = (name, cond, info = '') => { if (cond) pass++; else fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && info ? `  [${String(info).slice(0, 300)}]` : '')); };

let postStore, shareStore, core;
const fresh = (env = {}) => {
  for (const k of ['POST_DEVICE_DAILY', 'VERCEL_ENV', 'POST_PRICES', 'PARTNER_LINKS', 'POST_SWEEP_SECRET', 'FAX_ENABLED']) delete process.env[k];
  Object.assign(process.env, env);
  postStore = memoryPostStore(); shareStore = memoryShareStore();
  core = P.makePostalCore({ getPostStore: () => postStore, getShareStore: () => shareStore });
  P.mockProvider.fail = false; P.mockProvider.done = false;
  P.faxMock.fail = false; P.faxMock.failOnce = false; P.faxMock.done = true;
};
const token = (id = 'device-aaaaaaaaaaaaaaaa') => Sec.issueToken(process.env.FALE_TOKEN_SECRET, Sec.deviceHash(process.env.FALE_TOKEN_SECRET, id));

async function call(action, json = {}, { ip = '203.0.113.7', headers: extra = {} } = {}) {
  const body = Buffer.from(JSON.stringify(json));
  const req = Readable.from([body]);
  Object.assign(req, { method: 'POST', url: `/api/post?a=${action}`, headers: { 'x-real-ip': ip, 'content-type': 'application/json', origin: 'https://fale-pdf.vercel.app', ...extra } });
  const chunks = [], headers = {};
  const res = { statusCode: 200, headersSent: false, setHeader(k, v) { headers[k.toLowerCase()] = v; }, on() {}, write(b) { chunks.push(Buffer.from(b)); }, end(b) { if (b) chunks.push(Buffer.from(b)); } };
  await core.post(req, res);
  let j = null; try { j = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
  return { status: res.statusCode, json: j };
}
// a tiny uncompressed PDF with n pages
function pdf(n) {
  let s = '%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Count ' + n + ' /Kids [' + Array.from({ length: n }, (_, i) => `${3 + i} 0 R`).join(' ') + '] >> endobj\n';
  for (let i = 0; i < n; i++) s += `${3 + i} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >> endobj\n`;
  return Buffer.from(s + 'trailer << /Root 1 0 R >>\n%%EOF\n').toString('base64');
}

// ---------------------------------------------------------------- prices
fresh();
{
  const pr = P.DEFAULT_PRICES;
  const lp = o => P.listPrice(pr, { pages: 1, color: false, registered: '', intl: false, ...o });
  check('price: letter up to 3 sheets 1,99 €', lp({}) === 199 && lp({ pages: 3 }) === 199);
  check('price: 5 sheets +2 × 0,10 €', lp({ pages: 5 }) === 219);
  check('price: colour +0,50 €', lp({ color: true }) === 249);
  check('price: Einschreiben Einwurf 4,99 €, Einschreiben 5,49 €', lp({ registered: 'r1' }) === 499 && lp({ registered: 'r2' }) === 549);
  check('price: abroad 2,99 €', lp({ intl: true }) === 299);
  check('price guard: list price kept when the margin is enough', P.guardPrice(499, 2.99, 40) === 499);
  const g = P.guardPrice(199, 2.5, 40);
  check('price guard: raised above cost + fee + margin, ends in 9', g > 199 && g % 10 === 9 && g >= Math.ceil((Math.ceil(2.5 * 1.19 * 100) + 25 + 40) / 0.985), g);
  check('PDF page count', P.countPages(Buffer.from(pdf(3), 'base64')) === 3 && P.countPages(Buffer.from('%PDF-1.7 /Type /Pages', 'latin1')) === 0);
}

// ---------------------------------------------------------------- config / quote
{
  let r = await call('config');
  check('config: enabled, test mode without credentials, prices', r.status === 200 && r.json.enabled && r.json.test && r.json.prices.base === 199 && r.json.maxPages === 10, JSON.stringify(r.json));
  r = await call('quote', { pages: 1, registered: 'r1' });
  check('quote: Einschreiben Einwurf 4,99 €', r.status === 200 && r.json.priceCents === 499 && r.json.label === 'Einschreiben Einwurf', JSON.stringify(r.json));
  r = await call('quote', { pages: 1, registered: 'r1', intl: true });
  check('quote: Einschreiben abroad refused', r.status === 400 && r.json.error === 'registered_national');
  r = await call('quote', { pages: 11 });
  check('quote: more than 10 pages refused', r.status === 400 && r.json.error === 'too_many_pages');
}

// ---------------------------------------------------------------- create: checks
{
  let r = await call('create', { token: 'nope', pdf: pdf(2), pages: 2 });
  check('create: invalid device token → 401', r.status === 401);
  r = await call('create', { token: token(), pdf: Buffer.from('hello').toString('base64'), pages: 1 });
  check('create: not a PDF → 400', r.status === 400 && /keine PDF/.test(r.json.message));
  r = await call('create', { token: token(), pdf: pdf(2), pages: 3 });
  check('create: page count must match the file → 400', r.status === 400 && r.json.error === 'page_mismatch');
  r = await call('create', { token: token(), pdf: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(3.3 * 1024 * 1024)]).toString('base64'), pages: 1 });
  check('create: too large → 413', r.status === 413 || r.status === 400, r.status);
  r = await call('create', { token: token(), pdf: pdf(2), pages: 2, expectCents: 150 });
  check('create: changed price → 409 with the new price', r.status === 409 && r.json.priceCents === 199);
}

// ---------------------------------------------------------------- pay → exactly one hand-over
let job, cap;
{
  fresh();
  const r = await call('create', { token: token(), pdf: pdf(2), pages: 2, registered: 'r1', country: 'Deutschland', expectCents: 499 });
  check('create: job + capability + checkout (test payment)', r.status === 200 && r.json.id && r.json.cap && /^mock:pay\//.test(r.json.checkoutUrl) && r.json.priceCents === 499, JSON.stringify(r.json));
  job = r.json.id; cap = r.json.cap;
  const stored = postStore._jobs.get(job);
  check('store: PDF held until paid, capability only as hash', stored.pdf && stored.cap_hash !== cap && /^[0-9a-f]{64}$/.test(stored.cap_hash) && stored.status === 'pending_payment');
  let s = await call('status', { id: job, cap });
  check('status: waiting for payment', s.status === 200 && s.json.job.status === 'pending_payment');
  s = await call('status', { id: job, cap: 'x'.repeat(32) });
  check('status: wrong capability → 403', s.status === 403);
  s = await call('status', { id: 'A'.repeat(22), cap });
  check('status: unknown job → 404', s.status === 404);
  const before = P.mockProvider().name && postStore._jobs.size;
  s = await call('mockpay', { id: job, cap });
  check('paid → handed to the print service, PDF deleted', s.status === 200 && s.json.job.status === 'submitted' && postStore._jobs.get(job).pdf === null && postStore._jobs.get(job).provider_id, JSON.stringify(s.json));
  const pid = postStore._jobs.get(job).provider_id;
  // the webhook for the same payment arrives afterwards: no second letter
  const sid = postStore._jobs.get(job).session_id;
  const w = await call('webhook', { id: 'evt_' + sid, type: 'checkout.session.completed' });
  check('webhook after poll: no second hand-over', w.status === 200 && postStore._jobs.get(job).provider_id === pid);
  P.mockProvider.done = true;
  s = await call('status', { id: job, cap });
  check('status: printed and sent, tracking code for Einschreiben', s.json.job.status === 'sent' && /^RT\d{6}123DE$/.test(s.json.job.tracking || '') && s.json.job.sentAt, JSON.stringify(s.json.job));
  const c = await call('cancel', { id: job, cap });
  check('cancel after payment refused', c.status === 409);
}

// webhook first (app closed after paying)
{
  fresh();
  const r = await call('create', { token: token(), pdf: pdf(1), pages: 1 });
  const sid = postStore._jobs.get(r.json.id).session_id;
  P.mockPay._pay(sid);
  const w = await call('webhook', { id: 'evt_' + sid });
  check('webhook alone dispatches the letter', w.status === 200 && postStore._jobs.get(r.json.id).status === 'submitted');
  const w2 = await call('webhook', { id: 'evt_unknown123' });
  check('unknown event ignored (200)', w2.status === 200 && w2.json.ignored);
}

// provider failure → refund
{
  fresh();
  const r = await call('create', { token: token(), pdf: pdf(1), pages: 1 });
  P.mockProvider.fail = true;
  const s = await call('mockpay', { id: r.json.id, cap: r.json.cap });
  check('print service fails → refunded, PDF deleted', s.json.job.status === 'refunded' && postStore._jobs.get(r.json.id).pdf === null, JSON.stringify(s.json));
  P.mockProvider.fail = false;
}

// cancel before payment
{
  fresh();
  const r = await call('create', { token: token(), pdf: pdf(1), pages: 1 });
  const c = await call('cancel', { id: r.json.id, cap: r.json.cap });
  check('cancel before payment → canceled, PDF deleted', c.status === 200 && c.json.job.status === 'canceled' && postStore._jobs.get(r.json.id).pdf === null);
}

// daily limit per device
{
  fresh({ POST_DEVICE_DAILY: '2' });
  const a = await call('create', { token: token('device-limit-aaaaaaaa'), pdf: pdf(1), pages: 1 });
  const b = await call('create', { token: token('device-limit-aaaaaaaa'), pdf: pdf(1), pages: 1 });
  const c = await call('create', { token: token('device-limit-aaaaaaaa'), pdf: pdf(1), pages: 1 });
  check('daily limit per device → 429', a.status === 200 && b.status === 200 && c.status === 429);
}

// production guard: no mock print service / payment in production
{
  fresh({ VERCEL_ENV: 'production' });
  const cfg = await call('config');
  const q = await call('quote', { pages: 1 });
  check('production without credentials: shown as unavailable, actions refused', cfg.json.enabled === false && q.status === 503);
  delete process.env.VERCEL_ENV;
}

// unpaid PDFs are dropped after 24 h
{
  let t = Date.now();
  const st = memoryPostStore({ now: () => new Date(t) });
  await st.create({ id: 'J'.repeat(22), owner: 'o', cap: 'c', options: {}, priceCents: 199, pages: 1, pdf: 'AAAA' });
  t += 25 * 3600e3;
  const g = await st.get({ id: 'J'.repeat(22), withPdf: true });
  check('store: unpaid PDF dropped after 24 h', g.job.pdf === null && g.job.status === 'canceled');
}

// ---------------------------------------------------------------- fax
fresh();
{
  const N = P.faxNumber;
  const to = (n, r) => (N(n, r) || {}).to || null;
  check('fax number: German landline formats → E.164', to('0681 / 123 45-6') === '+49681123456' && to('+49 (0) 30 1234567') === '+49301234567' && to('0049 89 123456') === '+4989123456' && N('0681 1234567').intl === false, [to('0681 / 123 45-6'), to('+49 (0) 30 1234567')]);
  check('fax number: worldwide – national format by device region, +/00 everywhere', to('01 23 45 67 89', 'FR') === '+33123456789' && to('+33 1 23 45 67 89') === '+33123456789'
    && to('(212) 555-1234', 'US') === '+12125551234' && to('020 7946 0000', 'GB') === '+442079460000' && to('06 1234 5678', 'IT') === '+390612345678' && to('03-1234-5678', 'JP') === '+81312345678'
    && to('+43 1 234567') === '+431234567' && N('+33 1 23 45 67 89').intl === true, [to('01 23 45 67 89', 'FR'), to('06 1234 5678', 'IT')]);
  check('fax number: mobile, premium, service, Caribbean, unknown countries, letters refused', [N('0171 1234567'), N('0900 123456'), N('0180 5123456'), N('0137 123456'), N('06 12 34 56 78', 'FR'),
    N('07700 900123', 'GB'), N('+1 876 555 1234'), N('+1 900 555 1234'), N('+7 495 1234567'), N('+882 123456'), N('110'), N('0681 abc'), N('')].every(x => x === null));
  const lp = o => P.listPrice(P.DEFAULT_PRICES, { channel: 'fax', ...o });
  check('fax price: 0,99 € up to 5 pages, +0,10 € per page; abroad 1,99 € + 0,20 €', lp({ pages: 1 }) === 99 && lp({ pages: 5 }) === 99 && lp({ pages: 8 }) === 129 && lp({ pages: 1, intl: true }) === 199 && lp({ pages: 7, intl: true }) === 239);
  let r = await call('config');
  check('config: fax on in test mode', r.json.fax === true && r.json.faxTest === true, JSON.stringify(r.json));
  r = await call('quote', { channel: 'fax', pages: 2, to: '0681 1234567' });
  check('quote: fax 0,99 €', r.status === 200 && r.json.priceCents === 99, JSON.stringify(r.json));
  r = await call('quote', { channel: 'fax', pages: 2, to: '01 23 45 67 89', region: 'FR' });
  check('quote: fax to France 1,99 €, number shown as E.164', r.status === 200 && r.json.priceCents === 199 && r.json.to === '+33123456789' && r.json.intl === true, JSON.stringify(r.json));
  r = await call('quote', { channel: 'fax', pages: 2, to: '0171 1234567' });
  check('quote: fax to a mobile number refused (an answer, not an error)', r.status === 200 && r.json.ok === false && r.json.error === 'bad_fax_number');

  // create → pay → faxed, PDF kept until SENT, then deleted
  r = await call('create', { token: token(), pdf: pdf(2), pages: 2, channel: 'fax', to: '0681 1234567', expectCents: 99 });
  check('fax create: job + checkout', r.status === 200 && r.json.priceCents === 99 && r.json.checkoutUrl.startsWith('mock:pay/'), JSON.stringify(r.json));
  const { id, cap } = r.json;
  check('fax job: number stored as E.164, no country', postStore._jobs.get(id).options.to === '+496811234567' && postStore._jobs.get(id).options.channel === 'fax' && !('country' in postStore._jobs.get(id).options));
  P.faxMock.done = false;
  r = await call('mockpay', { id, cap });
  check('fax paid → handed to the fax service, PDF kept for a second try', r.json.job.status === 'submitted' && postStore._jobs.get(id).pdf, JSON.stringify(r.json.job));
  P.faxMock.done = true;
  r = await call('status', { id, cap });
  check('fax went through → sent, PDF deleted', r.json.job.status === 'sent' && r.json.job.sentAt && postStore._jobs.get(id).pdf === null, JSON.stringify(r.json.job));

  // first try fails (busy) → second try goes through
  P.faxMock.failOnce = true;
  r = await call('create', { token: token(), pdf: pdf(1), pages: 1, channel: 'fax', to: '030 9999999' });
  const j2 = r.json;
  await call('mockpay', { id: j2.id, cap: j2.cap });
  const firstProvider = postStore._jobs.get(j2.id).provider_id;
  r = await call('status', { id: j2.id, cap: j2.cap });
  check('fax busy → second try started automatically', r.json.job.status === 'submitted' && postStore._jobs.get(j2.id).provider_id !== firstProvider && postStore._jobs.get(j2.id).error === 'retry', JSON.stringify(postStore._jobs.get(j2.id)));
  r = await call('status', { id: j2.id, cap: j2.cap });
  check('fax second try went through → sent', r.json.job.status === 'sent', JSON.stringify(r.json.job));

  // both tries fail → refund
  P.faxMock.failOnce = false; P.faxMock.fail = true;
  r = await call('create', { token: token(), pdf: pdf(1), pages: 1, channel: 'fax', to: '089 7777777' });
  const j3 = r.json;
  await call('mockpay', { id: j3.id, cap: j3.cap });
  await call('status', { id: j3.id, cap: j3.cap });
  r = await call('status', { id: j3.id, cap: j3.cap });
  check('fax fails twice → refunded, PDF deleted', r.json.job.status === 'refunded' && r.json.job.error === 'fax_failed' && postStore._jobs.get(j3.id).pdf === null, JSON.stringify(r.json.job));
  // two status calls at the same time start only ONE second try
  P.faxMock.fail = false; P.faxMock.failOnce = true;
  r = await call('create', { token: token(), pdf: pdf(1), pages: 1, channel: 'fax', to: '040 5555555' });
  const j4 = r.json;
  const before = P.faxMock.sent;
  await call('mockpay', { id: j4.id, cap: j4.cap });
  const rs = await Promise.all([call('status', { id: j4.id, cap: j4.cap }), call('status', { id: j4.id, cap: j4.cap }), call('status', { id: j4.id, cap: j4.cap })]);
  const tries = P.faxMock.sent - before;
  check('fax: parallel status checks → one second try only', rs.every(x => x.status === 200) && ['submitted', 'paid'].includes(postStore._jobs.get(j4.id).status) && postStore._jobs.get(j4.id).error === 'retry' && tries === 2, JSON.stringify([tries, rs.map(x => x.json.job && x.json.job.status)]));

  // production without fax credentials: fax off, letter flag unaffected
  fresh({ VERCEL_ENV: 'production' });
  r = await call('config');
  check('production without credentials: fax off', r.json.fax === false && r.json.enabled === false);
  r = await call('create', { token: token(), pdf: pdf(1), pages: 1, channel: 'fax', to: '0681 1234567' });
  check('production without credentials: fax create refused', r.status === 503 && r.json.error === 'fax_not_configured', JSON.stringify(r.json));
  fresh({ FAX_ENABLED: 'false' });
  r = await call('config');
  check('FAX_ENABLED=false switches only the fax off', r.json.fax === false && r.json.enabled === true);
}

// ---------------------------------------------------------------- partner links
{
  const L = P.partnerLinks(JSON.stringify({ strom: 'https://www.check24.net/p/strom?pid=1', handy: { url: 'https://a.example.de/x', name: 'Tarifvergleich<script>' }, gas: 'http://insecure.de', kfz: 'javascript:alert(1)', foo: 'https://x.de' })).DE;
  check('partner links: https only, known topics only, names cleaned (flat = Germany)', L.strom.url.startsWith('https://www.check24.net/') && L.handy.name === 'Tarifvergleichscript' && !L.gas && !L.kfz && !L.foo, JSON.stringify(L));
  const W = P.partnerLinks(JSON.stringify({ DE: { strom: 'https://de.example.com/s' }, AT: { handy: 'https://at.example.com/h' }, xx: { strom: 'https://x.de' } }));
  check('partner links per country', W.DE.strom.url === 'https://de.example.com/s' && W.AT.handy.url === 'https://at.example.com/h' && Object.keys(W).length === 2, JSON.stringify(W));
  check('partner links: broken JSON → none', Object.keys(P.partnerLinks('{oops')).length === 0);
  fresh({ PARTNER_LINKS: JSON.stringify({ strom: 'https://www.check24.net/p/strom?pid=1' }) });
  const r = await call('config');
  check('config hands out the partner links', r.json.partners && r.json.partners.DE && r.json.partners.DE.strom.url === 'https://www.check24.net/p/strom?pid=1', JSON.stringify(r.json.partners));
}

// ---------------------------------------------------------------- sweep (scheduled check)
{
  fresh({ POST_SWEEP_SECRET: 'sweep-secret-0123456789abcdefghij' });
  let r = await call('sweep', {}, { headers: { 'x-fale-sweep': 'wrong' } });
  check('sweep: wrong secret refused', r.status === 403);
  // a fax nobody looks at: paid, first try failed
  P.faxMock.fail = true;
  r = await call('create', { token: token(), pdf: pdf(1), pages: 1, channel: 'fax', to: '0711 222333' });
  const j = r.json;
  await call('mockpay', { id: j.id, cap: j.cap });
  r = await call('sweep', {}, { headers: { 'x-fale-sweep': 'sweep-secret-0123456789abcdefghij' } });
  r = await call('sweep', {}, { headers: { 'x-fale-sweep': 'sweep-secret-0123456789abcdefghij' } });
  check('sweep: failed fax nobody checked → second try, then refunded', r.status === 200 && postStore._jobs.get(j.id).status === 'refunded', JSON.stringify([r.json, postStore._jobs.get(j.id).status]));
  fresh();
  r = await call('sweep', {}, { headers: { 'x-fale-sweep': 'anything-long-enough-0123456789' } });
  check('sweep: no secret configured → refused', r.status === 403);
}

// ---------------------------------------------------------------- the exact requests to LetterXpress and Stripe
{
  const sent = [];
  const requestImpl = (opts, cb) => {
    const req = new EventEmitter();
    let body = '';
    req.end = b => {
      body = b; sent.push({ opts, body: JSON.parse(b) });
      const res = new EventEmitter(); res.statusCode = 200;
      cb(res);
      const data = opts.path.startsWith('/v3/price') ? { status: 200, data: { price: 2.95 } } : opts.method === 'POST' ? { status: 200, data: { id: 6035143, status: 'queue' } }
        : { status: 200, data: { id: 6035143, status: 'done', items: [{ status: 'sent', tracking_code: 'RT123456789DE' }] } };
      res.emit('data', Buffer.from(JSON.stringify(data))); res.emit('end');
    };
    req.destroy = () => {};
    return req;
  };
  const pc = { ...P.postConfig(), provider: 'letterxpress', lxp: { user: 'fale', key: 'k-test', mode: 'test' } };
  const L = P._test.letterxpress(pc, { requestImpl });
  const price = await L.price({ pages: 2, color: false, registered: 'r1', intl: false });
  const b64 = pdf(2);
  const r = await L.send({ pdfB64: b64, options: { pages: 2, color: true, registered: 'r2', intl: false }, filename: 'FaLe-x.pdf', notice: 'FaLe x' });
  const st = await L.status('6035143');
  const [q, p, g] = sent;
  check('LetterXpress price: GET /v3/price with auth + spec + registered', q.opts.method === 'GET' && q.opts.path === '/v3/price' && q.body.auth.username === 'fale' && q.body.auth.mode === 'test'
    && q.body.letter.specification.pages === 2 && q.body.letter.specification.color === '1' && q.body.registered === 'r1' && price === 2.95, JSON.stringify(q));
  check('LetterXpress print job: POST /v3/printjobs, base64 + MD5 checksum, colour 4, simplex, national, Einschreiben r2', p.opts.method === 'POST' && p.opts.path === '/v3/printjobs'
    && p.body.letter.base64_file === b64 && p.body.letter.base64_file_checksum === crypto.createHash('md5').update(b64).digest('hex')
    && p.body.letter.specification.color === '4' && p.body.letter.specification.mode === 'simplex' && p.body.letter.specification.shipping === 'national' && p.body.letter.registered === 'r2' && r.id === '6035143', JSON.stringify(p.body.letter.specification));
  check('LetterXpress status: tracking code read', g.opts.path === '/v3/printjobs/6035143' && st.status === 'done' && st.tracking === 'RT123456789DE');

  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => (url.includes('/checkout/sessions/') ? { id: 'cs_1', payment_status: 'paid', payment_intent: 'pi_1', metadata: { job: 'JOB' }, amount_total: 499 } : { id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }) }; };
  const S = P._test.stripe({ stripeKey: 'sk_test_x' }, { fetchImpl });
  const co = await S.checkout({ jobId: 'JOB', amount: 499, name: 'FaLe: Einschreiben Einwurf, 1 Seite', successUrl: 'https://pdf.fale.network/app/#/post/JOB?bezahlt=1', cancelUrl: 'https://pdf.fale.network/app/#/post/JOB?abgebrochen=1' });
  const body = decodeURIComponent(calls[0].init.body);
  check('Stripe Checkout: POST with secret key, EUR 4,99, job in metadata, return URLs', calls[0].url === 'https://api.stripe.com/v1/checkout/sessions' && calls[0].init.headers.Authorization === 'Bearer sk_test_x'
    && body.includes('line_items[0][price_data][unit_amount]=499') && body.includes('line_items[0][price_data][currency]=eur') && body.includes('metadata[job]=JOB') && body.includes('mode=payment')
    && body.includes('success_url=https://pdf.fale.network/app/#/post/JOB?bezahlt=1') && co.url.startsWith('https://checkout.stripe.com/'), body);
  const se = await S.session('cs_1');
  check('Stripe session read back (paid, payment intent, job)', se.paid && se.paymentIntent === 'pi_1' && se.job === 'JOB');
}

{
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, text: async () => (url.includes('/history/') ? JSON.stringify({ faxStatusType: 'SENT' }) : JSON.stringify({ sessionId: 'abc123' })) }; };
  const F = P._test.sipgateFax({ ...P.postConfig(), sipgate: { tokenId: 'token-id', token: 'tok', faxline: 'f0' }, faxCostPerPage: 0.05 }, { fetchImpl });
  const b64 = pdf(1);
  const r = await F.send({ pdfB64: b64, options: { channel: 'fax', to: '+496811234567', pages: 1 }, filename: 'FaLe-x.pdf' });
  const st = await F.status('abc123');
  const body = JSON.parse(calls[0].init.body);
  check('sipgate fax: POST /v2/sessions/fax, Basic auth, faxline, E.164, base64 PDF', calls[0].url === 'https://api.sipgate.com/v2/sessions/fax' && calls[0].init.headers.Authorization === 'Basic ' + Buffer.from('token-id:tok').toString('base64')
    && body.faxlineId === 'f0' && body.recipient === '+496811234567' && body.base64Content === b64 && body.filename === 'FaLe-x.pdf' && r.id === 'abc123', JSON.stringify(body).slice(0, 200));
  check('sipgate fax status: GET /v2/history/<id>', calls[1].url === 'https://api.sipgate.com/v2/history/abc123' && st.status === 'SENT');
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
