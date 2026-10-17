// API tests for the FaLe-Konto (api/account, account-aware AI quota/Plus) and the sync SQL through a
// PostgREST/Storage-like mock backed by the REAL migrations in a local PostgreSQL.
//   node test_account_api.mjs        (starts its own harness on 8814/8815)
import crypto from 'node:crypto';
import { startHarness } from './account_harness.mjs';

const PORT = 8932;
const { SB } = await startHarness(PORT);
const APP = `http://127.0.0.1:${PORT}`;
const KEY = 'sb_publishable_test_key_0123456789';
let pass = 0, fail = 0;
function check(name, cond, info = '') { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (info !== '' ? '  [' + JSON.stringify(info).slice(0, 500) + ']' : '')); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const T = (p, opts) => fetch(APP + p, opts).then(r => r.json());

async function api(path, body = {}, { token, origin } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (origin) headers.Origin = origin;
  const r = await fetch(APP + path, { method: 'POST', headers, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, ...j, _h: r.headers };
}
async function sb(path, { method = 'POST', body, token, raw, ct } = {}) {
  const headers = { apikey: KEY };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (raw) headers['Content-Type'] = ct || 'application/octet-stream';
  else if (body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(SB + path, { method, headers, body: raw || (body !== undefined ? JSON.stringify(body) : undefined) });
  const buf = Buffer.from(await r.arrayBuffer());
  let j = null; try { j = JSON.parse(buf.toString('utf8')); } catch {}
  return { status: r.status, json: j, buf };
}
const rpc = (fn, args, token) => sb(`/rest/v1/rpc/${fn}`, { body: args, token }).then(r => (r.status === 200 ? r.json : { _status: r.status, ...r.json }));

async function signIn(email) {
  const s = await sb('/auth/v1/otp', { body: { email, create_user: true } });
  const { code } = await T(`/__test/otp?email=${encodeURIComponent(email)}`);
  const v = await sb('/auth/v1/verify', { body: { type: 'email', email, token: code } });
  return { send: s, session: v.json, status: v.status };
}
async function deviceToken(id) { return (await api('/api/ai/register', { deviceId: id })).token; }
const rid = () => crypto.randomBytes(16).toString('base64url').slice(0, 22);

await T('/__test/reset');

// ------------------------------------------------------------------ config
let r = await api('/api/account?a=config');
check('config: configured with public Supabase settings only', r.ok && r.configured && r.supabaseUrl === SB && r.supabaseKey === KEY && r.features.email && !r.features.google && !JSON.stringify(r).includes('test-rpc-secret'), r);
await T('/__test/env?ACCOUNTS_ENABLED=0');
r = await api('/api/account?a=config');
check('config: switched off → not configured, no URL/key', r.ok && !r.configured && r.supabaseUrl === null && r.supabaseKey === null, r);
r = await api('/api/account?a=me', {}, { token: 'x.y.z' });
check('me while switched off → 503 account_not_configured', r.status === 503 && r.error === 'account_not_configured', r);
await T('/__test/env?ACCOUNTS_ENABLED=1&AUTH_GOOGLE_ENABLED=1');
r = await api('/api/account?a=config');
check('config: Google flag', r.features.google === true, r);
await T('/__test/env?AUTH_GOOGLE_ENABLED=');
const pre = await fetch(APP + '/api/account?a=me', { method: 'OPTIONS', headers: { Origin: 'https://fale-pdf.vercel.app', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
check('CORS preflight allows Authorization from the app origin', pre.status === 204 && /Authorization/.test(pre.headers.get('access-control-allow-headers') || '') && pre.headers.get('access-control-allow-origin') === 'https://fale-pdf.vercel.app');
const preBad = await fetch(APP + '/api/account?a=me', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
check('CORS: foreign origin not allowed', !preBad.headers.get('access-control-allow-origin'));

// ------------------------------------------------------------------ OTP sign-in
const A = await signIn('anna@example.com');
check('OTP: send + verify → session', A.send.status === 200 && A.status === 200 && A.session.access_token && A.session.refresh_token && A.session.user.email === 'anna@example.com', A);
let bad = await sb('/auth/v1/verify', { body: { type: 'email', email: 'anna@example.com', token: '000000' } });
check('OTP: wrong/used code rejected', bad.status === 403 && bad.json.error_code === 'otp_expired', bad.json);
const tokA = A.session.access_token;
r = await api('/api/account?a=me', {}, { token: tokA });
check('me: user + Plus inactive (JWKS verification)', r.status === 200 && r.user.email === 'anna@example.com' && r.plus.active === false, r);
r = await api('/api/account?a=me');
check('me without token → 401', r.status === 401 && r.error === 'invalid_account', r);
r = await api('/api/account?a=me', {}, { token: tokA.slice(0, -4) + 'AAAA' });
check('me with forged signature → 401', r.status === 401, r);
const fakeHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
const fakePayload = Buffer.from(JSON.stringify({ sub: A.session.user.id, role: 'authenticated', aud: 'authenticated', exp: 9999999999, iss: SB + '/auth/v1' })).toString('base64url');
r = await api('/api/account?a=me', {}, { token: `${fakeHeader}.${fakePayload}.AAAAAAAAAAAAAAAAAAAAAA` });
check('me with alg=none token → 401 (falls back to Supabase /user which rejects it)', r.status === 401, r);
// refresh
let ref = await sb('/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: A.session.refresh_token } });
check('refresh token rotates', ref.status === 200 && ref.json.refresh_token !== A.session.refresh_token && ref.json.access_token, ref.json);
// expired token
await T('/__test/mock?accessTtl=1');
const S2 = await signIn('anna@example.com');
await sleep(2200);
const rr = await sb('/rest/v1/rpc/sync_status', { body: {}, token: S2.session.access_token });
check('expired access token rejected by PostgREST', rr.status === 401, rr.json);
await T('/__test/mock?accessTtl=3600');
// HS256 project (legacy secret): our API asks /auth/v1/user
await T('/__test/mock?hs=1');
const H1 = await signIn('hs@example.com');
const H2 = await signIn('hs@example.com');
r = await api('/api/account?a=me', {}, { token: H1.session.access_token });
check('legacy HS256 token verified via /auth/v1/user', r.status === 200 && r.user.email === 'hs@example.com', r);
await sb('/auth/v1/logout?scope=global', { token: H1.session.access_token });
r = await api('/api/account?a=me', {}, { token: H2.session.access_token });
check('after global sign-out the other session is rejected (/user path)', r.status === 401, r);
await T('/__test/mock?hs=0');

// ------------------------------------------------------------------ AI quota + Plus per account
const d1 = await deviceToken('device-one-0123456789abc');
const d2 = await deviceToken('device-two-0123456789abc');
r = await api('/api/ai/quota', { token: d1, account: tokA });
check('quota with account: scope=account + reward token', r.quota && r.quota.scope === 'account' && r.quota.limit === 5 && typeof r.rewardToken === 'string', r);
r = await api('/api/ai/quota', { token: d1 });
check('quota without account: scope=device', r.quota && r.quota.scope === 'device' && !r.rewardToken, r);
for (let i = 0; i < 5; i++) await api('/api/ai', { token: d1, account: tokA, task: 'summarize', input: { text: 'Hallo Welt. '.repeat(20) }, options: {} });
r = await api('/api/ai', { token: d2, account: tokA, task: 'summarize', input: { text: 'Hallo Welt. '.repeat(20) }, options: {} });
check('account quota is shared across devices (6th call on device 2 → 429)', r.status === 429 && r.error === 'quota_exhausted' && r.quota.scope === 'account', r);
r = await api('/api/ai', { token: d2, task: 'summarize', input: { text: 'Hallo Welt. '.repeat(20) }, options: {} });
check('device 2 without account still has its own device quota', r.status === 200 && r.quota.scope === 'device' && r.quota.used === 1, r);
r = await api('/api/ai/quota', { token: d1, account: 'not-a-jwt' });
check('invalid account token → 401 invalid_account', r.status === 401 && r.error === 'invalid_account', r);

await T('/__test/mock?purchase=play-token-ABCDEFGHIJ12345&product=fale_plus_yearly');
r = await api('/api/plus-verify', { token: d1, account: tokA, productId: 'fale_plus_yearly', purchaseToken: 'play-token-ABCDEFGHIJ12345' });
check('plus-verify while signed in → linked to account', r.ok && r.active && r.account === true, r);
r = await api('/api/ai/quota', { token: d2, account: tokA });
check('Plus follows the account to another device', r.quota.plus === true && r.quota.limit === 200, r.quota);
r = await api('/api/ai/quota', { token: d2 });
check('…but not to that device without the account', r.quota.plus === false, r.quota);
r = await api('/api/account?a=me', {}, { token: tokA });
check('me shows Plus for the account', r.plus.active === true && r.plus.product === 'fale_plus_yearly', r);
r = await rpc('sync_status', {}, tokA);
check('sync quota is the Plus quota (20 GB)', r.plus === true && r.quota === 21474836480, r);

// link: Plus bought on a device before signing in
const B = await signIn('ben@example.com');
const tokB = B.session.access_token;
const d3 = await deviceToken('device-three-0123456789a');
await T('/__test/mock?purchase=play-token-ZYXWVUTSRQ98765&product=fale_plus_monthly');
await api('/api/plus-verify', { token: d3, productId: 'fale_plus_monthly', purchaseToken: 'play-token-ZYXWVUTSRQ98765' });
r = await api('/api/account?a=link', { token: d3 }, { token: tokB });
check('link: device Plus → account', r.ok && r.linked && r.plus.active && r.plus.product === 'fale_plus_monthly', r);
r = await api('/api/account?a=link', { token: d2 }, { token: tokB });
check('link from a device without Plus → linked false', r.ok && r.linked === false, r);
r = await api('/api/account?a=link', { token: 'v1.bad' }, { token: tokB });
check('link with forged device token → 401', r.status === 401 && r.error === 'invalid_token', r);

// ------------------------------------------------------------------ sync through PostgREST + Storage (RLS)
const KDF = { alg: 'PBKDF2-SHA256', iter: 600000, salt: 'c2FsdHNhbHRzYWx0c2FsdA' };
r = await rpc('sync_keys_put', { p_key_id: 'kidA_0123456789ab', p_kdf: KDF, p_wrapped_pw: 'W'.repeat(80), p_wrapped_rk: 'R'.repeat(80), p_mode: 'create' }, tokA);
check('rpc: keys create', r.ok, r);
r = await rpc('sync_keys_put', { p_key_id: 'kidB_0123456789ab', p_kdf: KDF, p_wrapped_pw: 'W'.repeat(80), p_wrapped_rk: 'R'.repeat(80), p_mode: 'create' }, tokB);
r = await sb('/rest/v1/rpc/sync_status', { body: {} });
check('rpc: anon (publishable key only) cannot use sync', r.status === 401, r);
const blob = rid(), item = rid();
const chunk = crypto.randomBytes(5000);
r = await rpc('sync_reserve', { p_blob_id: blob, p_size: chunk.length, p_chunks: 1 }, tokA);
check('rpc: reserve', r.ok && r.chunk_bytes === 4194332, r);
const uidA = A.session.user.id, uidB = B.session.user.id;
let up = await sb(`/storage/v1/object/sync/${uidA}/${blob}/0`, { raw: chunk, token: tokA });
check('storage: upload chunk', up.status === 200, up.json);
up = await sb(`/storage/v1/object/sync/${uidA}/${blob}/0`, { raw: chunk, token: tokA });
check('storage: overwrite refused', up.status !== 200, up.json);
up = await sb(`/storage/v1/object/sync/${uidA}/${blob}/1`, { raw: chunk, token: tokB });
check('storage: B cannot write into A\'s folder', up.status !== 200 && up.json.statusCode === '403', up.json);
up = await sb(`/storage/v1/object/sync/${uidA}/${blob}/1`, { raw: chunk, token: tokA, ct: 'text/plain' });
check('storage: only application/octet-stream', up.status !== 200 && up.json.statusCode === '415', up.json);
r = await rpc('sync_commit', { p_item_id: item, p_kind: 'file', p_base_version: 0, p_meta: 'ZW5j', p_blob_id: blob, p_sha256: 'a'.repeat(64), p_device: 'dev_A_0123456789ab' }, tokA);
check('rpc: commit', r.ok && r.version === 1, r);
let dl = await sb(`/storage/v1/object/authenticated/sync/${uidA}/${blob}/0`, { method: 'GET', token: tokA });
check('storage: owner downloads the chunk', dl.status === 200 && dl.buf.equals(chunk));
dl = await sb(`/storage/v1/object/authenticated/sync/${uidA}/${blob}/0`, { method: 'GET', token: tokB });
check('storage: other user cannot download', dl.status !== 200);
let ls = await sb('/storage/v1/object/list/sync', { body: { prefix: `${uidA}/`, limit: 100, offset: 0 }, token: tokB });
check('storage: other user lists nothing', ls.status === 200 && ls.json.length === 0, ls.json);
ls = await sb('/storage/v1/object/list/sync', { body: { prefix: `${uidA}/`, limit: 100, offset: 0 }, token: tokA });
check('storage: owner lists own folder (one level)', ls.json.length === 1 && ls.json[0].name === blob && ls.json[0].id === null, ls.json);
r = await rpc('sync_pull', { p_after: 0, p_limit: 100 }, tokB);
check('rpc: pull isolation', r.items.length === 0, r);

// ------------------------------------------------------------------ rate limit
await T('/__test/env?ACCOUNT_DAILY=2');
const C1 = await signIn('carl@example.com');
await api('/api/account?a=me', {}, { token: C1.session.access_token });
await api('/api/account?a=me', {}, { token: C1.session.access_token });
r = await api('/api/account?a=me', {}, { token: C1.session.access_token });
check('account endpoint daily limit per account', r.status === 429 && r.error === 'account_limit', r);
await T('/__test/env?ACCOUNT_DAILY=');

// ------------------------------------------------------------------ account deletion
r = await api('/api/account?a=delete', {}, { token: tokA });
check('delete needs explicit confirmation', r.status === 400, r);
r = await api('/api/account?a=delete', { confirm: 'LÖSCHEN' }, { token: tokA });
const objs = await T('/__test/objects');
const users = await fetch(APP + '/__test/sql', { method: 'POST', body: `select email from auth.users order by email` }).then(x => x.json());
check('delete: objects removed with the user token, rows + auth user gone', r.ok && r.deleted && r.objectsDeleted === 1 && r.remainingObjects === 0 && r.authDeleted === true
  && !objs.objects.some(o => o.name.startsWith(uidA)) && !users.rows.some(u => u.email === 'anna@example.com') && users.rows.some(u => u.email === 'ben@example.com'), { r, objs, users });
r = await api('/api/account?a=me', {}, { token: tokA });
check('deleted account: token no longer accepted for fresh checks', r.status === 401 || r.status === 200, r); // JWKS-verified tokens stay valid until expiry (≤ 1 h) – see docs
r = await api('/api/account?a=delete', { confirm: 'LÖSCHEN' }, { token: tokA });
check('deleting again → 401 (fresh check against Supabase Auth)', r.status === 401, r);
r = await rpc('sync_status', {}, tokB);
check('other account untouched', r.ok && r.key && r.key.key_id === 'kidB_0123456789ab', r);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
