// Node tests for the FaLe AI backend (api/*): no real provider calls, no real ads.
//   node test_api.mjs
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { startHarness, resetEnv, signedSsvQuery, ssvKeys, SSV_KEY_ID, createCore } from './ai_harness.mjs';

const ROOT = '/home/claude/FalePDF';
const require = createRequire(ROOT + '/api/x.js');
const Sec = require('./_lib/security.js');
const S = require('./_lib/schema.js');
const { TASKS, SCHEMAS } = require('./_lib/tasks.js');
const store = require('./_lib/store.js');
const C = require('./_lib/config.js');
const { getProvider } = require('./_lib/providers.js');

let pass = 0, fail = 0;
const results = [];
function check(name, cond, info = '') {
  if (cond) pass++; else fail++;
  results.push([name, !!cond]);
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${info && !cond ? `  [${String(info).slice(0, 300)}]` : ''}`);
}
async function step(name, fn) { try { await fn(); } catch (e) { fail++; console.log(`FAIL ${name} EXC ${e && e.stack}`); } }

// capture all console output to make sure no input content is ever logged
const logged = [];
for (const k of ['log', 'error', 'warn', 'info']) { const o = console[k]; console[k] = (...a) => { logged.push(a.map(String).join(' ')); o(...a); }; }
const SECRET_MARK = 'GEHEIMER-INHALT-7731';

const PORT = 9410;
const B = `http://127.0.0.1:${PORT}`;
const server = await startHarness(PORT);
const mem = store._memory();
const post = (path, body, headers = {}) => fetch(B + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const pj = async (path, body, headers) => { const r = await post(path, body, headers); let j = null; try { j = await r.clone().json(); } catch {} return { status: r.status, j, r }; };
const reset = (env = {}) => { mem._reset(); resetEnv(env); };
const devId = n => ('device_' + n + '_' + 'x'.repeat(24)).slice(0, 40);
async function token(n = 1) { const { j } = await pj('/api/ai/register', { deviceId: devId(n) }); return j.token; }
const ai = (tok, task, input, options = {}, extra = {}) => pj('/api/ai', { task, input, options, token: tok, client: { deviceId: 'ignored', platform: 'web', appVersion: '2.1.0' }, ...extra });
async function sse(tok, task, input, options = {}) {
  const r = await post('/api/ai', { task, input, options, token: tok, stream: true });
  const text = await r.text();
  const events = [...text.matchAll(/event: (\w+)\ndata: (.*)\n\n/g)].map(m => ({ event: m[1], data: JSON.parse(m[2]) }));
  return { status: r.status, type: r.headers.get('content-type'), events };
}
const longText = (n) => Array.from({ length: Math.ceil(n / 60) }, (_, i) => `Absatz ${i}: Das ist ein Satz über das Sommerfest im Park.`).join('\n\n').slice(0, n);

await step('availability + register', async () => {
  reset();
  let q = await pj('/api/ai/quota', {});
  check('quota anon: configured', q.status === 200 && q.j.configured === true && q.j.provider && q.j.provider.label && !q.j.quota, JSON.stringify(q.j));
  check('quota anon: limits exposed', q.j.limits.free === 5 && q.j.limits.bonus === 3 && q.j.limits.maxRewards === 3);
  check('quota anon: nothing stored', mem._state.usage.size === 0 && mem._state.ip.size === 0);
  let r = await pj('/api/ai/register', { deviceId: 'kurz' });
  check('register rejects bad device id', r.status === 400 && r.j.error === 'bad_input');
  r = await pj('/api/ai/register', { deviceId: devId(1) });
  check('register issues token', r.status === 200 && /^v1\.[\w-]{32}\.\d+\.[\w-]{43}$/.test(r.j.token), JSON.stringify(r.j));
  const r2 = await pj('/api/ai/register', { deviceId: devId(1) });
  check('same device id → same pseudonym', r.j.token.split('.')[1] === r2.j.token.split('.')[1]);
  check('device id itself not in token', !r.j.token.includes(devId(1)));
  q = await pj('/api/ai/quota', { token: r.j.token });
  check('quota with token', q.j.quota && q.j.quota.used === 0 && q.j.quota.limit === 5 && q.j.quota.remaining === 5 && q.j.quota.rewardsLeft === 3, JSON.stringify(q.j));
});

await step('token forgery', async () => {
  reset();
  const tok = await token(1);
  let r = await ai(null, 'summarize', { text: longText(200) });
  check('no token → 401', r.status === 401 && r.j.error === 'invalid_token');
  const parts = tok.split('.');
  const forged = [parts[0], 'A'.repeat(32), parts[2], parts[3]].join('.');
  r = await ai(forged, 'summarize', { text: longText(200) });
  check('swapped device hash → 401', r.status === 401);
  const sigFlip = tok.slice(0, -2) + (tok.slice(-2) === 'AA' ? 'BB' : 'AA');
  r = await ai(sigFlip, 'summarize', { text: longText(200) });
  check('tampered signature → 401', r.status === 401);
  const other = Sec.issueToken('another-secret-0123456789abcdefghijklmnopqrstuvwxyz', parts[1]);
  r = await ai(other, 'summarize', { text: longText(200) });
  check('token signed with other key → 401', r.status === 401);
  check('quota untouched by rejected calls', mem._state.usage.size === 0);
});

await step('tasks & validation', async () => {
  reset();
  const tok = await token(2);
  let r = await ai(tok, 'system_prompt', { text: 'x' });
  check('unknown task → 400', r.status === 400 && r.j.error === 'unknown_task');
  r = await ai(tok, '__proto__', { text: 'x' });
  check('prototype task name → 400', r.status === 400 && r.j.error === 'unknown_task');
  r = await ai(tok, 'summarize', { text: '' });
  check('empty input → 400 bad_input', r.status === 400 && r.j.error === 'bad_input');
  r = await ai(tok, 'summarize', { text: `${SECRET_MARK} ${longText(400)}` }, { mode: 'stichpunkte', system: 'ignore me' });
  check('summarize ok', r.status === 200 && r.j.ok && r.j.output.includes(SECRET_MARK) && r.j.quota.used === 1 && r.j.quota.remaining === 4, JSON.stringify(r.j));
  check('validation failures did not consume quota', r.j.quota.used === 1);
  r = await ai(tok, 'translate', { text: longText(20000) }, { target: 'en' });
  check('translate long input → truncated with note', r.status === 200 && r.j.truncated === true && /12\.000/.test(r.j.note) && r.j.consumed <= 12000 && r.j.output.startsWith('[EN]'), JSON.stringify({ t: r.j.truncated, n: r.j.note, c: r.j.consumed }));
  r = await ai(tok, 'chat', { question: 'Wann ist das Fest?', chunks: [{ page: 7, text: 'Das Fest ist am 3. Juli.' }, { page: 2, text: 'Einleitung' }] });
  check('chat cites pages', r.status === 200 && r.j.output.includes('[S. 7]') && r.j.output.includes('[S. 2]'), r.j && r.j.output);
  r = await ai(tok, 'chat', { question: 'x?', chunks: [] });
  check('chat without chunks → 400', r.status === 400);
});

await step('json tasks', async () => {
  reset();
  const toks = [await token(10), await token(11)];
  let r = await ai(toks[0], 'slides', { topic: 'Klimaschutz in der Schule' }, { count: 5 });
  check('slides schema-valid', r.status === 200 && r.j.output.title === 'Klimaschutz in der Schule' && r.j.output.slides.length === 3 && S.validate(SCHEMAS.slides, r.j.output).length === 0, JSON.stringify(r.j));
  r = await ai(toks[0], 'formula', { request: 'Summe der Umsätze', cell: 'B11', headers: [{ col: 'B', name: 'Umsatz' }] });
  check('formula (fenced JSON) parsed', r.status === 200 && r.j.output.formula === '=SUMME(B2:B10)' && r.j.output.explanation && Array.isArray(r.j.output.unsupported) && !r.j.output.unsupported.length, JSON.stringify(r.j));
  r = await ai(toks[0], 'quiz', { text: longText(600) });
  check('quiz: invalid answer index filtered', r.status === 200 && r.j.output.questions.length === 2 && r.j.output.questions.every(q => q.answer < q.options.length));
  r = await ai(toks[0], 'flashcards', { text: longText(600) }, { count: 5 });
  check('flashcards', r.status === 200 && r.j.output.cards.length === 3 && r.j.output.cards[0].front);
  r = await ai(toks[0], 'letter', { request: 'Ich möchte meinen Handyvertrag kündigen.' });
  check('letter', r.status === 200 && r.j.output.subject && r.j.output.paragraphs.length === 2 && r.j.output.salutation.startsWith('Sehr'));
  // bad JSON → 502 + refund
  const before = (await pj('/api/ai/quota', { token: toks[1] })).j.quota.used;
  r = await ai(toks[1], 'slides', { topic: 'Test [[mock:badjson]]' });
  const after = (await pj('/api/ai/quota', { token: toks[1] })).j.quota.used;
  check('bad model JSON → 502 bad_output', r.status === 502 && r.j.error === 'bad_output', JSON.stringify(r.j));
  check('bad output refunded quota', before === after, `${before} ${after}`);
  r = await ai(toks[1], 'summarize', { text: 'Fehlerfall [[mock:error]] ' + longText(100) });
  check('provider error → 502 + refund', r.status === 502 && r.j.error === 'provider_error' && (await pj('/api/ai/quota', { token: toks[1] })).j.quota.used === before);
});

await step('streaming', async () => {
  reset();
  const tok = await token(3);
  const s = await sse(tok, 'summarize', { text: longText(500) });
  check('SSE content type', s.status === 200 && /text\/event-stream/.test(s.type), s.type);
  const ev = s.events.map(e => e.event);
  check('SSE meta → delta* → done', ev[0] === 'meta' && ev[ev.length - 1] === 'done' && ev.filter(e => e === 'delta').length > 3, ev.join(','));
  const text = s.events.filter(e => e.event === 'delta').map(e => e.data.t).join('');
  check('SSE text assembled', text.startsWith('- Zusammenfassung (Test): Absatz 0'), text.slice(0, 60));
  check('SSE quota in meta', s.events[0].data.quota.used === 1);
  const e = await sse(tok, 'chat', { question: 'x?', chunks: [{ page: 1, text: 'abc [[mock:error]]' }] });
  check('SSE provider error event + refund', e.events.some(x => x.event === 'error' && x.data.error === 'provider_error') && e.events.find(x => x.event === 'error').data.quota.used === 1, JSON.stringify(e.events));
  const r = await post('/api/ai', { task: 'rewrite', input: { text: 'Das ist sehr sehr gut.' }, token: tok, stream: true });
  check('non-stream task ignores stream flag (JSON)', /application\/json/.test(r.headers.get('content-type')) && (await r.json()).output === 'Das ist sehr gut. Vielen Dank.');
});

await step('quota exhaustion', async () => {
  reset();
  const tok = await token(4);
  for (let i = 0; i < 5; i++) await ai(tok, 'explain', { text: 'Kündigungsfrist' });
  const r = await ai(tok, 'explain', { text: 'Kündigungsfrist' });
  check('6th request → 429 quota_exhausted', r.status === 429 && r.j.error === 'quota_exhausted' && r.j.quota.used === 5 && r.j.quota.remaining === 0 && r.j.quota.rewardsLeft === 3, JSON.stringify(r.j));
  const t2 = await token(5);
  check('other device unaffected', (await ai(t2, 'explain', { text: 'Frist' })).status === 200);
});

await step('rewarded ads SSV', async () => {
  reset();
  const tok = await token(6);
  for (let i = 0; i < 5; i++) await ai(tok, 'explain', { text: 'x' });
  const base = { ad_network: '5450213213286189855', ad_unit: '5224354917', custom_data: tok, reward_amount: '3', reward_item: 'KI', timestamp: String(Date.now()) };
  const get = qs => fetch(`${B}/api/admob-ssv?${qs}`).then(async r => ({ status: r.status, j: await r.json() }));
  let r = await get(signedSsvQuery({ ...base, transaction_id: 'tx-0001' }));
  check('valid SSV → reward credited', r.status === 200 && r.j.ok && !r.j.duplicate, JSON.stringify(r.j));
  let q = (await pj('/api/ai/quota', { token: tok })).j.quota;
  check('quota +3 after reward', q.limit === 8 && q.remaining === 3 && q.rewardsLeft === 2, JSON.stringify(q));
  r = await get(signedSsvQuery({ ...base, transaction_id: 'tx-0001' }));
  check('duplicate transaction is idempotent', r.status === 200 && r.j.duplicate === true && (await pj('/api/ai/quota', { token: tok })).j.quota.limit === 8);
  const good = signedSsvQuery({ ...base, transaction_id: 'tx-0002' });
  r = await get(good.replace('reward_amount=3', 'reward_amount=30'));
  check('tampered parameter → 400', r.status === 400 && r.j.error === 'invalid_signature');
  const other = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  r = await get(signedSsvQuery({ ...base, transaction_id: 'tx-0003' }, { privateKey: other.privateKey }));
  check('signature from foreign key → 400', r.status === 400);
  r = await get(signedSsvQuery({ ...base, transaction_id: 'tx-0004' }, { keyId: '999' }));
  check('unknown key id → 400', r.status === 400 && r.j.message === 'unknown_key');
  r = await get(`${new URLSearchParams({ ...base, transaction_id: 'tx-5' })}`);
  check('unsigned callback → 400', r.status === 400);
  r = await get(signedSsvQuery({ ...base, custom_data: tok.slice(0, -3) + 'abc', transaction_id: 'tx-0006' }));
  check('forged custom_data token → 400', r.status === 400 && r.j.error === 'invalid_token');
  r = await get(signedSsvQuery({ ...base, timestamp: String(Date.now() - 5 * 86400000), transaction_id: 'tx-0007' }));
  check('stale callback → 400', r.status === 400 && r.j.error === 'stale');
  r = await get(signedSsvQuery({ ...base, custom_data: undefined, transaction_id: 'tx-0008' }));
  check('AdMob console test callback (no custom data) → 200', r.status === 200 && r.j.test === true);
  await get(signedSsvQuery({ ...base, transaction_id: 'tx-0010' }));
  await get(signedSsvQuery({ ...base, transaction_id: 'tx-0011' }));
  r = await get(signedSsvQuery({ ...base, transaction_id: 'tx-0012' }));
  q = (await pj('/api/ai/quota', { token: tok })).j.quota;
  check('max 3 rewards per day (capped)', r.j.capped === true && q.rewarded === 3 && q.limit === 14 && q.rewardsLeft === 0, JSON.stringify(q));
  const bad = await fetch(`${B}/api/admob-ssv?x=1`, { method: 'POST' });
  check('SSV only GET', bad.status === 405);
  resetEnv({ ADMOB_REWARDED_AD_UNITS: 'ca-app-pub-1/111' });
  r = await get(signedSsvQuery({ ...base, transaction_id: 'tx-0020' }));
  check('foreign ad unit rejected when units configured', r.status === 400 && r.j.error === 'unknown_ad_unit');
  resetEnv();
});

await step('ip + register limits', async () => {
  reset({ IP_DAILY: '3', REGISTER_IP_DAILY: '4' });
  const t = [await token(20), await token(21), await token(22)];
  await ai(t[0], 'explain', { text: 'a' }); await ai(t[1], 'explain', { text: 'a' }); await ai(t[2], 'explain', { text: 'a' });
  const r = await ai(t[0], 'explain', { text: 'a' });
  check('per-IP daily cap → 429 ip_limit', r.status === 429 && r.j.error === 'ip_limit', JSON.stringify(r.j));
  check('ip cap refunds nothing extra (device used stays 1)', r.j.quota.used === 1);
  await token(23);
  const reg = await pj('/api/ai/register', { deviceId: devId(24) });
  check('register IP cap → 429', reg.status === 429 && reg.j.error === 'ip_limit');
  check('ip stored only as salted hash', [...mem._state.ip.keys()].every(k => !k.includes('127.0.0.1') && /\|[0-9a-f]{40}$/.test(k)));
});

await step('budget cap', async () => {
  reset({ AI_MONTHLY_BUDGET_EUR: '0.004' }); // ≈ 0.0042 USD → a few small calls
  const tok = await token(30);
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await ai(tok, 'explain', { text: 'Was bedeutet Widerrufsfrist?' })).status);
  const r = await ai(tok, 'summarize', { text: longText(3000) }, { mode: 'ausfuehrlich' });
  check('budget exhausted → 429 budget_exhausted', r.status === 429 && r.j.error === 'budget_exhausted' && /Monat/.test(r.j.message), JSON.stringify(r.j) + statuses);
  const st = (await pj('/api/ai/quota', { token: tok })).j;
  check('budget refusal refunded quota', st.quota.used === statuses.filter(s => s === 200).length, JSON.stringify(st.quota));
  const b = [...mem._state.budget.values()][0];
  check('reservations settled (reserved back to 0, spent > 0)', b.reserved === 0 && b.spent > 0 && b.spent <= 0.004 / 0.95 + 1e-9, JSON.stringify(b));
  reset({ AI_MONTHLY_BUDGET_EUR: '0' });
  const t2 = await token(31);
  check('cap 0 → everything refused', (await ai(t2, 'explain', { text: 'x' })).status === 429);
  check('quota endpoint reports budgetExhausted', (await pj('/api/ai/quota', { token: t2 })).j.budgetExhausted === true);
});

await step('cost accounting', async () => {
  reset({ AI_PRICE_IN_USD_PER_MTOK: '2', AI_PRICE_OUT_USD_PER_MTOK: '10' });
  const tok = await token(32);
  const input = 'Erkläre das bitte.';
  await ai(tok, 'explain', { text: input });
  const b = [...mem._state.budget.values()][0];
  // mock usage: input = ceil(user.length/4), output = ceil(text.length/4)
  check('spent = usage × env prices', b.spent > 0 && b.spent < 0.001 && b.reserved === 0, JSON.stringify(b));
});

await step('not configured / CORS / limits', async () => {
  reset({ AI_PROVIDER: 'anthropic' }); // no ANTHROPIC_API_KEY
  let r = await pj('/api/ai', { task: 'summarize', input: { text: 'x' }, token: 'x' });
  check('no provider key → 503 ai_not_configured', r.status === 503 && r.j.error === 'ai_not_configured');
  r = await pj('/api/ai/quota', {});
  check('quota reports configured=false', r.j.configured === false && r.j.provider.label.includes('Anthropic'));
  reset({ FALE_TOKEN_SECRET: '' });
  r = await pj('/api/ai/register', { deviceId: devId(1) });
  check('missing server secrets → 503', r.status === 503);
  reset();
  let rr = await fetch(B + '/api/ai', { method: 'OPTIONS', headers: { Origin: 'https://fale-pdf.vercel.app', 'Access-Control-Request-Method': 'POST' } });
  check('CORS preflight for app origin', rr.status === 204 && rr.headers.get('access-control-allow-origin') === 'https://fale-pdf.vercel.app');
  rr = await post('/api/ai/quota', {}, { Origin: 'https://localhost' });
  check('CORS for Capacitor origin', rr.headers.get('access-control-allow-origin') === 'https://localhost');
  rr = await post('/api/ai/quota', {}, { Origin: 'https://evil.example' });
  check('CORS denied for foreign origin', !rr.headers.get('access-control-allow-origin'));
  rr = await fetch(B + '/api/ai');
  check('GET /api/ai → 405', rr.status === 405);
  const tok = await token(40);
  rr = await post('/api/ai', JSON.stringify({ task: 'summarize', token: tok, input: { text: 'x'.repeat(260000) } }));
  check('oversized body → 413', rr.status === 413);
  rr = await post('/api/ai', '{nope');
  check('broken JSON → 400', rr.status === 400);
});

await step('FaLe Plus', async () => {
  reset();
  const tok = await token(50);
  let r = await pj('/api/plus-verify', { token: tok, productId: 'fale_plus_monthly', purchaseToken: 'x'.repeat(40) });
  check('plus without service account → 503 plus_not_configured', r.status === 503 && r.j.error === 'plus_not_configured');
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  resetEnv({ GOOGLE_PLAY_SA_JSON: JSON.stringify({ client_email: 'sa@x.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }) });
  const exp = new Date(Date.now() + 30 * 86400000).toISOString();
  const calls = [];
  const core = createCore({ verifyPlayPurchase: async (cfg, ptoken) => { calls.push(ptoken); return ptoken.startsWith('ok') ? { active: true, productId: 'fale_plus_monthly', expiresAt: exp, state: 'SUBSCRIPTION_STATE_ACTIVE' } : { active: false, state: 'SUBSCRIPTION_STATE_EXPIRED' }; } });
  const srv = http.createServer((req, res) => core[req.url.includes('plus') ? 'plusVerify' : req.url.includes('quota') ? 'quota' : 'ai'](req, res));
  await new Promise(r2 => srv.listen(9411, '127.0.0.1', r2));
  const P = (path, body) => fetch('http://127.0.0.1:9411' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async x => ({ status: x.status, j: await x.json() }));
  r = await P('/api/plus-verify', { token: tok, productId: 'fale_plus_evil', purchaseToken: 'ok' + 'x'.repeat(30) });
  check('plus: unknown product → 400', r.status === 400);
  r = await P('/api/plus-verify', { token: tok, productId: 'fale_plus_monthly', purchaseToken: 'expired' + 'x'.repeat(30) });
  check('plus: inactive purchase not stored', r.status === 200 && r.j.active === false && mem._state.plus.size === 0);
  r = await P('/api/plus-verify', { token: tok, productId: 'fale_plus_monthly', purchaseToken: 'ok' + 'x'.repeat(30) });
  check('plus: active purchase stored', r.status === 200 && r.j.active === true && mem._state.plus.size === 1, JSON.stringify(r.j));
  check('plus: purchase token stored only hashed', [...mem._state.plus.values()].every(p => /^[0-9a-f]{64}$/.test(p.tokenHash)));
  const q = (await P('/api/ai/quota', { token: tok })).j.quota;
  check('plus: quota 200/day, no ad button', q.plus === true && q.limit === 200 && q.rewardsLeft === 0, JSON.stringify(q));
  resetEnv({ GOOGLE_PLAY_SA_JSON: process.env.GOOGLE_PLAY_SA_JSON, IP_DAILY: '1' });
  let okAll = true;
  for (let i = 0; i < 3; i++) okAll = okAll && (await P('/api/ai', { task: 'explain', input: { text: 'a' }, token: tok })).status === 200;
  check('plus: per-IP cap does not apply', okAll);
  const tok2 = await token(51);
  await P('/api/plus-verify', { token: tok2, productId: 'fale_plus_monthly', purchaseToken: 'ok' + 'x'.repeat(30) });
  check('plus: restore moves entitlement to new device', mem._state.plus.size === 1 && (await P('/api/ai/quota', { token: tok2 })).j.quota.plus === true && (await P('/api/ai/quota', { token: tok })).j.quota.plus === false);
  srv.close();
  resetEnv();
});

await step('google JWT (RS256) for the Play API', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  let seen = null;
  const fakeFetch = async (url, init) => {
    seen = { url, body: new URLSearchParams(init.body) };
    return new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const at = await Sec.googleAccessToken({ client_email: 'sa@p.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }, 'https://www.googleapis.com/auth/androidpublisher', { fetchImpl: fakeFetch });
  const [h, c, s] = seen.body.get('assertion').split('.');
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  const valid = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${c}`), publicKey, Buffer.from(s, 'base64url'));
  check('JWT signed RS256 + correct claims', at === 'ya29.test' && valid && claims.iss === 'sa@p.iam.gserviceaccount.com' && claims.scope.endsWith('androidpublisher') && claims.exp - claims.iat === 3600);
  const { verifyPlaySubscription } = require('./_lib/core.js');
  const play = async (url, init) => {
    if (String(url).includes('oauth2')) return fakeFetch(url, init);
    seen = { url: String(url), auth: init.headers.Authorization };
    return new Response(JSON.stringify({ subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE', lineItems: [{ productId: 'fale_plus_yearly', expiryTime: new Date(Date.now() + 86400000 * 300).toISOString() }] }), { status: 200 });
  };
  const sub = await verifyPlaySubscription({ playSaJson: JSON.stringify({ client_email: 'sa@p.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }), playPackage: 'dev.fale.pdf' }, 'tok123', play);
  check('Play subscriptionsv2 parsed', sub.active && sub.productId === 'fale_plus_yearly' && seen.url.includes('/applications/dev.fale.pdf/purchases/subscriptionsv2/tokens/tok123') && seen.auth === 'Bearer ya29.test', JSON.stringify(sub));
});

await step('provider adapters against fake upstreams', async () => {
  const calls = [];
  const sseBody = chunks => new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(new TextEncoder().encode(x)); c.close(); } });
  const fakeFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), headers: init.headers, body });
    if (String(url).includes('anthropic')) {
      if (!body.stream) return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Hallo' }], usage: { input_tokens: 12, output_tokens: 3 }, stop_reason: 'end_turn' }), { status: 200 });
      return new Response(sseBody([
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":20,"output_tokens":1}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hal"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}\n\n',
      ]), { status: 200 });
    }
    if (String(url).includes('openai')) {
      if (!body.stream) return new Response(JSON.stringify({ choices: [{ message: { content: 'Hi' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 } }), { status: 200 });
      return new Response(sseBody(['data: {"choices":[{"delta":{"content":"H"}}]}\n\n', 'data: {"choices":[{"delta":{"content":"i"},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":4}}\n\ndata: [DONE]\n\n']), { status: 200 });
    }
    if (String(url).includes('googleapis')) {
      if (String(url).includes('alt=sse')) return new Response(sseBody(['data: {"candidates":[{"content":{"parts":[{"text":"Ser"}]}}]}\n\n', 'data: {"candidates":[{"content":{"parts":[{"text":"vus"}]}}],"usageMetadata":{"promptTokenCount":8,"candidatesTokenCount":3}}\n\n']), { status: 200 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Servus' }] } }], usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 2 } }), { status: 200 });
    }
    return new Response('x', { status: 500 });
  };
  const base = C.getConfig();
  const cfgA = { ...base, provider: 'anthropic', anthropicKey: 'sk-test', anthropicBase: 'https://api.anthropic.com', model: 'claude-haiku-5-5' };
  const pA = getProvider(cfgA, { fetchImpl: fakeFetch });
  let r = await pA.complete({ system: 'sys', user: 'u', maxTokens: 50, stream: false });
  const c0 = calls[0];
  check('anthropic: request shape', c0.url === 'https://api.anthropic.com/v1/messages' && c0.headers['x-api-key'] === 'sk-test' && c0.headers['anthropic-version'] && c0.body.model === 'claude-haiku-5-5' && c0.body.system === 'sys' && c0.body.max_tokens === 50 && c0.body.messages[0].role === 'user');
  check('anthropic: non-stream usage', r.text === 'Hallo' && r.usage.input === 12 && r.usage.output === 3);
  const deltas = [];
  r = await pA.complete({ system: 's', user: 'u', maxTokens: 50, stream: true, onDelta: t => deltas.push(t) });
  check('anthropic: stream deltas + usage', r.text === 'Hallo' && deltas.join('') === 'Hallo' && r.usage.input === 20 && r.usage.output === 7, JSON.stringify(r));
  const pO = getProvider({ ...base, provider: 'openai_compat', openaiBase: 'https://openai.example/v1', openaiKey: 'k', model: 'm' }, { fetchImpl: fakeFetch });
  r = await pO.complete({ system: 's', user: 'u', maxTokens: 9, stream: true, onDelta: () => {} });
  check('openai_compat: stream + usage', r.text === 'Hi' && r.usage.input === 9 && r.usage.output === 4 && calls.at(-1).headers.Authorization === 'Bearer k' && calls.at(-1).body.messages[0].role === 'system');
  const pG = getProvider({ ...base, provider: 'gemini', geminiKey: 'g', model: 'gemini-x' }, { fetchImpl: fakeFetch });
  r = await pG.complete({ system: 's', user: 'u', maxTokens: 9, stream: true, onDelta: () => {} });
  check('gemini: stream + usage', r.text === 'Servus' && r.usage.output === 3 && calls.at(-1).headers['x-goog-api-key'] === 'g');
  const failing = getProvider(cfgA, { fetchImpl: async () => new Response('{"error":"' + SECRET_MARK + '"}', { status: 529 }) });
  let err = null; try { await failing.complete({ system: 's', user: 'u', maxTokens: 5 }); } catch (e) { err = e; }
  check('provider HTTP error mapped, body not exposed', err && err.kind === 'unavailable' && !String(err.message).includes(SECRET_MARK));
});

await step('end-to-end with anthropic adapter + cost', async () => {
  reset({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-test', AI_PRICE_IN_USD_PER_MTOK: '1', AI_PRICE_OUT_USD_PER_MTOK: '5' });
  const fakeFetch = async () => new Response(JSON.stringify({ content: [{ type: 'text', text: 'Erklärung.' }], usage: { input_tokens: 1000, output_tokens: 200 }, stop_reason: 'end_turn' }), { status: 200 });
  const core = createCore({ fetchImpl: fakeFetch });
  const srv = http.createServer((req, res) => core[req.url.includes('register') ? 'register' : 'ai'](req, res));
  await new Promise(r2 => srv.listen(9412, '127.0.0.1', r2));
  const P = (path, body) => fetch('http://127.0.0.1:9412' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async x => ({ status: x.status, j: await x.json() }));
  const t = (await P('/api/ai/register', { deviceId: devId(60) })).j.token;
  const r = await P('/api/ai', { task: 'explain', input: { text: 'Widerruf' }, token: t });
  const b = [...mem._state.budget.values()][0];
  check('anthropic path: output + spent = 1000×1e-6 + 200×5e-6 USD', r.status === 200 && r.j.output === 'Erklärung.' && Math.abs(b.spent - 0.002) < 1e-9 && b.reserved === 0, JSON.stringify({ r: r.j, b }));
  srv.close();
  resetEnv();
});

await step('schema + helpers', async () => {
  const n = S.normalize(SCHEMAS.flashcards, { cards: Array.from({ length: 40 }, (_, i) => ({ front: ' F' + i + ' ', back: 'B'.repeat(900), extra: 1 })), junk: true });
  check('normalize: clamp arrays, trim + cut strings, drop unknown keys', n.cards.length === 30 && n.cards[0].front === 'F0' && n.cards[0].back.length === 600 && !('extra' in n.cards[0]) && !('junk' in n));
  check('validate: valid', S.validate(SCHEMAS.flashcards, n).length === 0);
  check('validate: wrong types', S.validate(SCHEMAS.quiz, { questions: [{ question: 1, options: 'a', answer: 'x' }] }).length >= 3);
  check('extractJson: chatter + fences', S.extractJson('Hier bitte:\n```json\n{"a":{"b":"}"}}\n```\nViel Spaß').a.b === '}');
  check('dayKey Europe/Berlin crosses midnight', Sec.dayKey('Europe/Berlin', new Date('2026-10-14T22:30:00Z')) === '2026-10-15' && Sec.dayKey('Europe/Berlin', new Date('2026-10-14T21:30:00Z')) === '2026-10-14');
  check('ipHash day-scoped + salted', Sec.ipHash('s', '1.2.3.4', '2026-10-14') !== Sec.ipHash('s', '1.2.3.4', '2026-10-15') && Sec.ipHash('s', '1.2.3.4', 'd') !== Sec.ipHash('t', '1.2.3.4', 'd'));
  const tasks = Object.keys(TASKS).sort().join(',');
  check('all server tasks defined', tasks === 'chat,explain,flashcards,formula,image_translate,letter,letter_extract,quiz,rewrite,slides,summarize,translate', tasks);
  for (const [id, t] of Object.entries(TASKS)) {
    let threw = null; try { t.prepare({ text: 'x', question: 'x', request: 'x', chunks: [{ page: 1, text: 'x' }] }, {}); } catch (e) { threw = e; }
    const big = (() => { try { return t.prepare({ text: 'Satz. '.repeat(20000), question: 'Frage?', request: 'Anliegen '.repeat(400), topic: 'T', chunks: Array.from({ length: 30 }, (_, i) => ({ page: i + 1, text: 'abc '.repeat(2000) })) }, { count: 99 }); } catch (e) { return e; } })();
    check(`task ${id}: limits enforced`, !(big instanceof Error) && big.user.length <= (t.maxInput || 3000) + 2500 && big.maxTokens > 0 && big.maxTokens <= 7000, big instanceof Error ? big.message : big.user.length);
    void threw;
  }
  check('store memory is refused on Vercel production', (() => { process.env.VERCEL_ENV = 'production'; const v = C.storeConfigured({ store: 'memory' }); delete process.env.VERCEL_ENV; return v === false; })());
});

check('no request content in server logs', !logged.some(l => l.includes(SECRET_MARK)), logged.filter(l => l.includes(SECRET_MARK)).slice(0, 2).join(' | '));
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
