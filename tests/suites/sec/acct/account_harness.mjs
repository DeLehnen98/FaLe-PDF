// Local test harness for FaLe-Konto + FaLe Sync.
//   node account_harness.mjs [port]   (default 8804; the mock Supabase listens on port + 1)
//
// :port      – the app (static, from FALE_ROOT) + the real /api/* handlers (AI core, account core, share core)
// :port + 1  – a mock Supabase that is as close to the real thing as practical:
//     /auth/v1/otp, /verify, /token?grant_type=refresh_token|pkce, /user, /logout, /.well-known/jwks.json
//         (GoTrue-like; ES256 JWTs; users + sessions live in the local PostgreSQL stub auth schema)
//     /rest/v1/rpc/<fn>     – PostgREST-like: executes the REAL SQL functions from supabase/migrations
//                             in the local PostgreSQL as role anon/authenticated with request.jwt.claims
//     /storage/v1/object/…  – Storage-like: every upload/download/list/delete runs as the user against
//                             storage.objects in PostgreSQL, so the REAL RLS policies decide; bytes in memory
// Test-only endpoints: /__test/* on :port.
import http from 'node:http';
import crypto from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { headersFor } from '../vercel_headers.mjs';
import { join, extname, normalize, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pool as pgPool, lit } from './pgmini.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.FALE_ROOT || '/home/claude/FalePDF';
const require = createRequire(join(ROOT, 'api', 'x.js'));
const { makeCore } = require('./_lib/core.js');
const { makeAccountCore } = require('./_lib/account.js');
const { supabaseAccountStore } = require('./_lib/accountstore.js');
const store = require('./_lib/store.js');
const shareStore = require('./_lib/sharestore.js');
const Sec = require('./_lib/security.js');
const SupaAuth = require('./_lib/supa-auth.js');

const DB = process.env.PGDB || 'fale_sec_e2e';
const PUBLISHABLE = 'sb_publishable_test_key_0123456789';
export const RPC_SECRET = 'test-rpc-secret-0123456789abcdefghijklmnop';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown', '.gz': 'application/gzip', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf' };

export function startHarness(port = 8804) {
  const SB = `http://127.0.0.1:${port + 1}`;
  const BASE_ENV = {
    AI_PROVIDER: 'mock', FALE_STORE: 'memory', FALE_TOKEN_SECRET: 'test-token-secret-0123456789abcdefghijklmnopqrstuvwxyz',
    FALE_IP_SALT: 'test-ip-salt-0123456789', FREE_DAILY: '5', REWARD_BONUS: '3', REWARD_MAX_PER_DAY: '3', PLUS_DAILY: '200', IP_DAILY: '400', REGISTER_IP_DAILY: '500',
    SUPABASE_URL: SB, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE, FALE_RPC_SECRET: RPC_SECRET, ACCOUNTS_ENABLED: '1',
    GOOGLE_PLAY_SA_JSON: JSON.stringify({ client_email: 'x@y', private_key: 'test' }),
  };
  const MANAGED = new Set([...Object.keys(BASE_ENV), 'AUTH_GOOGLE_ENABLED', 'SUPABASE_SERVICE_ROLE_KEY', 'ACCOUNT_DAILY']);
  const resetEnv = (extra = {}) => { for (const k of MANAGED) delete process.env[k]; Object.assign(process.env, BASE_ENV, extra); };
  resetEnv();

  // ------------------------------------------------------------------ state
  const keys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const KID = 'test-key-' + crypto.randomBytes(3).toString('hex');
  const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: KID, alg: 'ES256', use: 'sig' };
  const HS_SECRET = crypto.randomBytes(32);
  let st;
  const freshState = () => ({
    otps: new Map(), refresh: new Map(), bytes: new Map(), log: [], accessTtl: 3600, hs: false, otpGapMs: 0, lastOtp: new Map(), failStorage: false, failRpc: false,
    purchases: new Map(),
  });
  st = freshState();
  let pg = null;
  const resetDb = () => execFileSync(join(HERE, 'reset_db.sh'), [DB], { stdio: 'ignore' });
  async function ensurePg() {
    if (!pg) pg = await pgPool({ path: '/tmp/faleacct/.s.PGSQL.5544', database: DB }, 6);
    return pg;
  }
  resetDb();

  async function sql(text) {
    const p = await ensurePg();
    return p.run(async c => { try { return await c.query(text); } catch (e) { try { await c.query('rollback'); } catch {} throw e; } });
  }
  async function asRole(claims, text) {
    const role = claims ? 'authenticated' : 'anon';
    const cl = claims || { role: 'anon' };
    return sql(`begin; set local role ${role}; select set_config('request.jwt.claims', ${lit(JSON.stringify(cl))}, true); ${text}; commit;`);
  }

  // ------------------------------------------------------------------ JWT
  const b64u = b => Sec.b64url(b);
  function signJwt(payload) {
    const header = st.hs ? { alg: 'HS256', typ: 'JWT' } : { alg: 'ES256', typ: 'JWT', kid: KID };
    const data = `${b64u(Buffer.from(JSON.stringify(header)))}.${b64u(Buffer.from(JSON.stringify(payload)))}`;
    const sig = st.hs ? crypto.createHmac('sha256', HS_SECRET).update(data).digest() : crypto.sign('sha256', Buffer.from(data), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' });
    return `${data}.${b64u(sig)}`;
  }
  function verifyJwt(token) {
    const t = SupaAuth.decode(token);
    if (!t) return null;
    let ok = false;
    try {
      if (t.header.alg === 'HS256') ok = crypto.timingSafeEqual(crypto.createHmac('sha256', HS_SECRET).update(t.data).digest(), t.sig);
      else ok = crypto.verify('sha256', Buffer.from(t.data), { key: keys.publicKey, dsaEncoding: 'ieee-p1363' }, t.sig);
    } catch { ok = false; }
    if (!ok || t.payload.exp * 1000 < Date.now()) return null;
    return t.payload;
  }
  async function issueSession(user, sessionId = null) {
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      await sql(`insert into auth.sessions (id, user_id) values (${lit(sessionId)}, ${lit(user.id)})`);
    }
    const now = Math.floor(Date.now() / 1000);
    const access = signJwt({ aud: 'authenticated', exp: now + st.accessTtl, iat: now, iss: `${SB}/auth/v1`, sub: user.id, email: user.email, role: 'authenticated', aal: 'aal1', session_id: sessionId, is_anonymous: false });
    const refresh = crypto.randomBytes(12).toString('hex');
    st.refresh.set(refresh, { sessionId, userId: user.id, used: 0 });
    return { access_token: access, token_type: 'bearer', expires_in: st.accessTtl, expires_at: now + st.accessTtl, refresh_token: refresh, user: { id: user.id, aud: 'authenticated', role: 'authenticated', email: user.email } };
  }
  async function sessionAlive(sessionId) { return (await sql(`select 1 from auth.sessions where id = ${lit(sessionId)}`)).length > 0; }

  // ------------------------------------------------------------------ mock Supabase
  const readBody = async req => { const ch = []; for await (const c of req) ch.push(c); return Buffer.concat(ch); };
  const procCache = new Map();
  async function procArgs(fn) {
    if (procCache.has(fn)) return procCache.get(fn);
    const rows = await sql(`select p.oid::text oid, coalesce(array_to_string(p.proargnames, ','), '') names, (select string_agg(format_type(t, null), ',' order by o) from unnest(p.proargtypes) with ordinality u(t, o)) types
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = ${lit(fn)}`);
    const list = rows.map(r => { const names = r.names ? r.names.split(',') : []; const types = r.types ? r.types.split(',') : []; return names.map((n, i) => ({ name: n, type: types[i] })); });
    procCache.set(fn, list);
    return list;
  }
  function argExpr(type, v) {
    if (v === null || v === undefined) return `NULL::${type}`;
    if (type === 'jsonb' || type === 'json') return `${lit(JSON.stringify(v))}::${type}`;
    if (type.endsWith('[]')) return `(select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(${lit(JSON.stringify(v))}::jsonb) x)::${type}`;
    return `${lit(typeof v === 'object' ? JSON.stringify(v) : String(v))}::${type}`;
  }
  function pgErr(res, e, authed) {
    const code = e && e.code;
    const status = code === '42501' ? (authed ? 403 : 401) : code === '28000' ? 401 : code === '42883' ? 404 : 400;
    return sendJ(res, status, { code, message: e && e.message, details: null, hint: null });
  }
  function sendJ(res, status, obj) { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(obj === undefined ? '' : JSON.stringify(obj)); }
  function cors(req, res) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info, x-upsert, cache-control');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  function claimsOf(req) {
    const h = String(req.headers.authorization || '');
    const m = /^Bearer\s+(\S+)$/i.exec(h);
    if (!m || m[1] === PUBLISHABLE) return { ok: true, claims: null };
    const p = verifyJwt(m[1]);
    if (!p) return { ok: false };
    return { ok: true, claims: p, token: m[1] };
  }

  const sb = http.createServer(async (req, res) => {
    cors(req, res);
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    try {
      if (p === '/auth/v1/.well-known/jwks.json') return sendJ(res, 200, { keys: st.hs ? [] : [jwk] });
      if (req.headers.apikey !== PUBLISHABLE && !(process.env.SUPABASE_SERVICE_ROLE_KEY && req.headers.apikey === process.env.SUPABASE_SERVICE_ROLE_KEY)) {
        return sendJ(res, 401, { message: 'No API key found in request', hint: 'No `apikey` request header or url param was found.' });
      }
      const raw = await readBody(req);
      st.log.push({ method: req.method, path: p + u.search, auth: !!req.headers.authorization, body: raw.toString('latin1'), size: raw.length });
      if (st.log.length > 20000) st.log = st.log.slice(-20000);
      const body = (req.headers['content-type'] || '').includes('json') && raw.length ? JSON.parse(raw.toString('utf8')) : null;

      // ---------------------------------------------------------- auth
      if (p === '/auth/v1/otp' && req.method === 'POST') {
        const email = String((body && body.email) || '').trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return sendJ(res, 400, { code: 400, error_code: 'validation_failed', msg: 'Unable to validate email address: invalid format' });
        const last = st.lastOtp.get(email) || 0;
        if (Date.now() - last < st.otpGapMs) return sendJ(res, 429, { code: 429, error_code: 'over_email_send_rate_limit', msg: 'For security purposes, you can only request this after 60 seconds.' });
        st.lastOtp.set(email, Date.now());
        let rows = await sql(`select id::text id, email from auth.users where email = ${lit(email)}`);
        if (!rows.length) {
          if (body.create_user === false) return sendJ(res, 422, { code: 422, error_code: 'otp_disabled', msg: 'Signups not allowed for otp' });
          rows = await sql(`insert into auth.users (email) values (${lit(email)}) returning id::text id, email`);
        }
        const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        st.otps.set(email, { code, exp: Date.now() + 600000, tries: 0 });
        return sendJ(res, 200, {});
      }
      if (p === '/auth/v1/verify' && req.method === 'POST') {
        const email = String((body && body.email) || '').trim().toLowerCase();
        const o = st.otps.get(email);
        const bad = () => sendJ(res, 403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
        if (!o || o.exp < Date.now() || !['email', 'magiclink', 'signup'].includes(body.type)) return bad();
        if (++o.tries > 5) { st.otps.delete(email); return bad(); }
        if (String(body.token) !== o.code) return bad();
        st.otps.delete(email);
        const rows = await sql(`update auth.users set last_sign_in_at = now() where email = ${lit(email)} returning id::text id, email`);
        return sendJ(res, 200, await issueSession(rows[0]));
      }
      if (p === '/auth/v1/token' && req.method === 'POST' && u.searchParams.get('grant_type') === 'refresh_token') {
        const rt = st.refresh.get(String((body && body.refresh_token) || ''));
        if (!rt) return sendJ(res, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' });
        if (!(await sessionAlive(rt.sessionId))) return sendJ(res, 400, { code: 400, error_code: 'session_not_found', msg: 'Invalid Refresh Token: Session Expired' });
        if (rt.used && Date.now() - rt.used > 10000) return sendJ(res, 400, { code: 400, error_code: 'refresh_token_already_used', msg: 'Invalid Refresh Token: Already Used' });
        rt.used = rt.used || Date.now();
        const rows = await sql(`select id::text id, email from auth.users where id = ${lit(rt.userId)}`);
        if (!rows.length) return sendJ(res, 400, { code: 400, error_code: 'user_not_found', msg: 'User not found' });
        return sendJ(res, 200, await issueSession(rows[0], rt.sessionId));
      }
      if (p === '/auth/v1/user' && req.method === 'GET') {
        const c = claimsOf(req);
        if (!c.ok || !c.claims) return sendJ(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
        if (!(await sessionAlive(c.claims.session_id))) return sendJ(res, 403, { code: 403, error_code: 'session_not_found', msg: 'Session from session_id claim in JWT does not exist' });
        const rows = await sql(`select id::text id, email, created_at::text created_at from auth.users where id = ${lit(c.claims.sub)}`);
        if (!rows.length) return sendJ(res, 403, { code: 403, error_code: 'user_not_found', msg: 'User from sub claim in JWT does not exist' });
        return sendJ(res, 200, { id: rows[0].id, aud: 'authenticated', role: 'authenticated', email: rows[0].email, created_at: rows[0].created_at });
      }
      if (p === '/auth/v1/logout' && req.method === 'POST') {
        const c = claimsOf(req);
        if (!c.ok || !c.claims) return sendJ(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
        const scope = u.searchParams.get('scope') || 'global';
        if (scope === 'local') await sql(`delete from auth.sessions where id = ${lit(c.claims.session_id)}`);
        else if (scope === 'others') await sql(`delete from auth.sessions where user_id = ${lit(c.claims.sub)} and id <> ${lit(c.claims.session_id)}`);
        else await sql(`delete from auth.sessions where user_id = ${lit(c.claims.sub)}`);
        res.statusCode = 204; return res.end();
      }
      if (p.startsWith('/auth/v1/admin/users/') && req.method === 'DELETE') {
        if (!process.env.SUPABASE_SERVICE_ROLE_KEY || req.headers.apikey !== process.env.SUPABASE_SERVICE_ROLE_KEY) return sendJ(res, 401, { msg: 'forbidden' });
        await sql(`delete from auth.users where id = ${lit(decodeURIComponent(p.split('/').pop()))}`);
        return sendJ(res, 200, {});
      }

      // ---------------------------------------------------------- PostgREST rpc
      if (p.startsWith('/rest/v1/rpc/') && req.method === 'POST') {
        if (st.failRpc) return sendJ(res, 503, { message: 'unavailable' });
        const fn = p.slice('/rest/v1/rpc/'.length);
        if (!/^[a-z_][a-z0-9_]{0,62}$/.test(fn)) return sendJ(res, 404, { code: 'PGRST202' });
        const c = claimsOf(req);
        if (!c.ok) return sendJ(res, 401, { code: 'PGRST301', message: 'JWT expired' });
        const args = body || {};
        const sigs = await procArgs(fn);
        const keys_ = Object.keys(args);
        const sig = sigs.find(s => keys_.every(k => s.some(a => a.name === k)) && s.every(a => keys_.includes(a.name)));
        if (!sig) return sendJ(res, 404, { code: 'PGRST202', message: `Could not find the function public.${fn}` });
        const call = `public.${fn}(${sig.map(a => `${a.name} => ${argExpr(a.type, args[a.name])}`).join(', ')})`;
        try {
          const rows = await asRole(c.claims, `select (${call})::text as r`);
          const r = rows[0] ? rows[0].r : null;
          res.statusCode = 200; res.setHeader('Content-Type', 'application/json');
          return res.end(r === null ? 'null' : r);
        } catch (e) { return pgErr(res, e, !!c.claims); }
      }

      // ---------------------------------------------------------- Storage
      if (p.startsWith('/storage/v1/object')) {
        if (st.failStorage) return sendJ(res, 503, { statusCode: '503', error: 'unavailable', message: 'unavailable' });
        const c = claimsOf(req);
        if (!c.ok || !c.claims) return sendJ(res, 400, { statusCode: '403', error: 'Unauthorized', message: 'Invalid JWT' });
        const rest = p.slice('/storage/v1/object'.length);
        if (rest.startsWith('/list/') && req.method === 'POST') {
          const bucket = rest.slice(6);
          const prefix = String((body && body.prefix) || '');
          const lim = Math.min(1000, Number((body && body.limit) || 100)), off = Number((body && body.offset) || 0);
          const rows = await asRole(c.claims, `select name, id::text id, metadata::text metadata, created_at::text created_at from storage.objects where bucket_id = ${lit(bucket)} and starts_with(name, ${lit(prefix)}) order by name`);
          const seen = new Map();
          for (const r of rows) {
            const rem = r.name.slice(prefix.length);
            const seg = rem.split('/')[0];
            if (!seg) continue;
            if (rem.includes('/')) { if (!seen.has(seg)) seen.set(seg, { name: seg, id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null }); }
            else seen.set(seg, { name: seg, id: r.id, created_at: r.created_at, metadata: JSON.parse(r.metadata || 'null') });
          }
          return sendJ(res, 200, [...seen.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(off, off + lim));
        }
        if (req.method === 'DELETE' && /^\/[a-z0-9_-]+$/.test(rest)) {
          const bucket = rest.slice(1);
          const names = (body && Array.isArray(body.prefixes) ? body.prefixes : []).map(String).slice(0, 1000);
          if (!names.length) return sendJ(res, 200, []);
          const rows = await asRole(c.claims, `with d as (delete from storage.objects where bucket_id = ${lit(bucket)} and name = any(array[${names.map(lit).join(',')}]::text[]) returning name) select name from d`);
          rows.forEach(r => st.bytes.delete(`${bucket}/${r.name}`));
          return sendJ(res, 200, rows.map(r => ({ name: r.name, bucket_id: bucket })));
        }
        const m = /^\/(?:authenticated\/)?([a-z0-9_-]+)\/(.+)$/.exec(rest);
        if (!m) return sendJ(res, 400, { statusCode: '400', error: 'invalid', message: 'invalid path' });
        const bucket = m[1], name = decodeURIComponent(m[2]);
        if (req.method === 'POST' || req.method === 'PUT') {
          const b = await sql(`select file_size_limit::text lim, array_to_string(allowed_mime_types, ',') mimes from storage.buckets where id = ${lit(bucket)}`);
          if (!b.length) return sendJ(res, 400, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' });
          const ct = String(req.headers['content-type'] || '').split(';')[0].trim();
          if (b[0].mimes && !b[0].mimes.split(',').includes(ct)) return sendJ(res, 400, { statusCode: '415', error: 'invalid_mime_type', message: `mime type ${ct} is not supported` });
          if (b[0].lim && raw.length > Number(b[0].lim)) return sendJ(res, 400, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
          try {
            await asRole(c.claims, `insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values (${lit(bucket)}, ${lit(name)}, ${lit(c.claims.sub)}, ${lit(c.claims.sub)}, jsonb_build_object('size', ${raw.length}, 'mimetype', ${lit(ct)}, 'eTag', ${lit('"' + crypto.createHash('md5').update(raw).digest('hex') + '"')}))`);
          } catch (e) {
            if (/duplicate key/.test(e.message)) return sendJ(res, 400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
            if (/row-level security/.test(e.message)) return sendJ(res, 400, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
            throw e;
          }
          st.bytes.set(`${bucket}/${name}`, raw);
          return sendJ(res, 200, { Key: `${bucket}/${name}`, Id: crypto.randomUUID() });
        }
        if (req.method === 'GET') {
          const rows = await asRole(c.claims, `select 1 from storage.objects where bucket_id = ${lit(bucket)} and name = ${lit(name)}`);
          const data = st.bytes.get(`${bucket}/${name}`);
          if (!rows.length || !data) return sendJ(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
          res.statusCode = 200; res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Length', String(data.length));
          return res.end(data);
        }
      }
      return sendJ(res, 404, { message: 'not found' });
    } catch (e) { console.error('mock supabase', e); if (!res.headersSent) sendJ(res, 500, { message: 'internal' }); }
  });

  // ------------------------------------------------------------------ app + API
  const accountStoreOf = () => (cfg) => supabaseAccountStore(cfg);
  const fakePlay = async (cfg, token) => {
    const p = st.purchases.get(token);
    return p ? { active: true, state: 'SUBSCRIPTION_STATE_ACTIVE', productId: p.product, expiresAt: new Date(Date.now() + 30 * 864e5).toISOString() } : { active: false, state: 'not_found' };
  };
  let core, acct;
  const build = () => {
    SupaAuth._reset();
    // AI counters + device Plus also run on the real SQL functions (like production)
    core = makeCore({ getAccountStore: accountStoreOf(), getStore: cfg => store.supabaseStore(cfg), verifyPlayPurchase: fakePlay });
    acct = makeAccountCore({ getAccountStore: accountStoreOf() });
  };
  build();
  const routes = { '/api/ai': ['ai'], '/api/ai/register': ['register'], '/api/ai/quota': ['quota'], '/api/plus-verify': ['plusVerify'], '/api/account': ['account', true] };

  const app = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    try {
      if (u.pathname.startsWith('/__test/')) return testRoute(u, req, res);
      const r = routes[u.pathname.replace(/\/+$/, '')];
      if (r) return r[1] ? acct[r[0]](req, res) : core[r[0]](req, res);
      if (u.pathname.startsWith('/api/')) { res.statusCode = 404; return res.end('{"error":"not_found"}'); }
      if (u.pathname === '/js/account/build-config.js') { // what scripts/vercel-build.mjs generates from the env
        const on = k => ['1', 'true', 'yes', 'on'].includes(String(process.env[k] || '').toLowerCase());
        const c = on('ACCOUNTS_ENABLED');
        const cfg = { configured: c, supabaseUrl: c ? process.env.SUPABASE_URL : null, supabaseKey: c ? process.env.SUPABASE_PUBLISHABLE_KEY : null, features: { email: c, google: c && on('AUTH_GOOGLE_ENABLED'), sync: c } };
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.setHeader('Cache-Control', 'no-store');
        return res.end(`export default ${JSON.stringify(cfg)};\n`);
      }
      let f = normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, '');
      if (f.endsWith('/')) f += 'index.html';
      const file = join(ROOT, f);
      if (!file.startsWith(ROOT) || /\/(api|supabase|\.git)\//.test(file.slice(ROOT.length) + '/')) { res.statusCode = 404; return res.end(); }
      const s = await stat(file).catch(() => null);
      if (!s || !s.isFile()) { res.statusCode = 404; return res.end('not found'); }
      // vercel.json headers + (like scripts/vercel-build.mjs does for a Supabase URL outside *.supabase.co)
      // the mock Supabase origin in connect-src of the header and the meta CSP
      const sbOrigin = `http://127.0.0.1:${port + 1}`;
      const addSb = v => String(v).replace(/connect-src ([^;]*)/, (m, a) => `connect-src ${a} ${sbOrigin}`);
      const hv = headersFor(u.pathname);
      if (process.env.FALE_NO_CSP !== '1') for (const [k, v] of Object.entries(hv)) res.setHeader(k, k === 'Content-Security-Policy' ? addSb(v) : v);
      res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      if (/\.html$/.test(file)) return res.end((await readFile(file, 'utf8')).replace(/(<meta http-equiv="Content-Security-Policy" content=")([^"]*)/, (m, a, b) => a + addSb(b)));
      res.end(await readFile(file));
    } catch (e) { console.error('harness', e); if (!res.headersSent) { res.statusCode = 500; res.end(); } }
  });

  async function testRoute(u, req, res) {
    const send = (o, s = 200) => { res.statusCode = s; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    const q = Object.fromEntries(u.searchParams);
    if (u.pathname === '/__test/reset') {
      if (pg) { pg.close(); pg = null; }
      resetDb();
      procCache.clear();
      st = freshState();
      resetEnv(q);
      store._memory()._reset();
      shareStore._memoryShare()._reset();
      build();
      return send({ ok: true });
    }
    if (u.pathname === '/__test/env') { for (const [k, v] of u.searchParams) { if (v === '') delete process.env[k]; else process.env[k] = v; } build(); return send({ ok: true }); }
    if (u.pathname === '/__test/otp') { const o = st.otps.get(String(q.email || '').toLowerCase()); return send({ code: o ? o.code : null }); }
    if (u.pathname === '/__test/mock') {
      if (q.accessTtl) st.accessTtl = +q.accessTtl;
      if (q.hs != null) st.hs = q.hs === '1';
      if (q.otpGapMs != null) st.otpGapMs = +q.otpGapMs;
      if (q.failStorage != null) st.failStorage = q.failStorage === '1';
      if (q.failRpc != null) st.failRpc = q.failRpc === '1';
      if (q.purchase) st.purchases.set(q.purchase, { product: q.product || 'fale_plus_monthly' });
      if (q.hs != null) SupaAuth._reset();
      return send({ ok: true });
    }
    if (u.pathname === '/__test/sql') { // test setup only (runs as postgres)
      const text = Buffer.concat(await (async () => { const ch = []; for await (const c of req) ch.push(c); return ch; })()).toString('utf8') || q.q;
      try { return send({ rows: await sql(text) }); } catch (e) { return send({ error: e.message }, 400); }
    }
    if (u.pathname === '/__test/objects') {
      const rows = await sql(`select name, (metadata->>'size')::text size from storage.objects where bucket_id = 'sync' order by name`);
      return send({ objects: rows.map(r => ({ ...r, b64: q.bytes ? (st.bytes.get('sync/' + r.name) || Buffer.alloc(0)).toString('base64') : undefined })) });
    }
    if (u.pathname === '/__test/log') return send({ log: q.since ? st.log.slice(+q.since) : st.log, n: st.log.length });
    if (u.pathname === '/__test/state') {
      const s = store._memory()._state;
      return send({ usage: [...s.usage], plus: [...s.plus] });
    }
    return send({ error: 'unknown' }, 404);
  }

  return Promise.all([
    new Promise(r => app.listen(port, '127.0.0.1', r)),
    new Promise(r => sb.listen(port + 1, '127.0.0.1', r)),
  ]).then(() => ({ app, sb, SB }));
}

if (process.argv[1] && process.argv[1].endsWith('account_harness.mjs')) {
  const port = parseInt(process.argv[2] || '8804', 10);
  startHarness(port).then(() => console.log(`Account harness on http://127.0.0.1:${port}/ (mock Supabase :${port + 1}, root ${ROOT}, db ${DB})`));
}
