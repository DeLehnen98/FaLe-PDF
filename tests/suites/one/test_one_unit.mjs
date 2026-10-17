// Unit tests for api/_lib/drive.js pieces that the harness cannot exercise: Vercel's pre-parsed request bodies,
// config clamping, production CORS, error mapping. No database.
//   node test_one_unit.mjs
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
const require = createRequire('/home/claude/FalePDF/api/x.js');
const D = require('./_lib/drive.js');
const H = require('./_lib/http.js');
const C = require('./_lib/config.js');
let pass = 0, fail = 0;
function check(name, cond, info = '') { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (info !== '' ? '  [' + JSON.stringify(info).slice(0, 300) + ']' : '')); } }
const err = async p => { try { await p; return null; } catch (e) { return e; } };

// readRaw: Vercel hands octet-stream bodies over as Buffer
let r = await D.readRaw({ headers: {}, body: Buffer.from('abc') }, 10);
check('readRaw: pre-read Buffer', r.toString() === 'abc');
r = await D.readRaw({ headers: {}, body: new Uint8Array([1, 2]) }, 10);
check('readRaw: Uint8Array', r.length === 2);
let e = await err(D.readRaw({ headers: {}, body: Buffer.alloc(11) }, 10));
check('readRaw: pre-read Buffer over the limit → 413', e && e.status === 413);
e = await err(D.readRaw({ headers: {}, body: { a: 1 } }, 10));
check('readRaw: body parsed as JSON → 400 (not a chunk)', e && e.status === 400);
e = await err(D.readRaw({ headers: { 'content-length': '999' } }, 10));
check('readRaw: declared length over the limit → 413 before reading', e && e.status === 413);
const stream = Object.assign(Readable.from([Buffer.from('xy'), Buffer.from('z')]), { headers: {} });
r = await D.readRaw(stream, 10);
check('readRaw: streamed body', r.toString() === 'xyz');
const big = Object.assign(Readable.from([Buffer.alloc(8), Buffer.alloc(8)]), { headers: {} });
e = await err(D.readRaw(big, 10));
check('readRaw: streamed body over the limit → 413', e && e.status === 413);

// config
for (const k of Object.keys(process.env)) if (k.startsWith('ONE_')) delete process.env[k];
let dc = D.driveConfig();
check('defaults: disabled, 1 MiB chunks, limits', dc.enabled === false && dc.chunkSize === 1048576 && dc.dailyRequests === 20000 && dc.uploadDailyBytes === 20480 * 1048576);
process.env.ONE_CHUNK_KB = '99999';
check('chunk size clamped to 4 MiB (Vercel body limit 4.5 MB)', D.driveConfig().chunkSize === 4194304);
process.env.ONE_CHUNK_KB = '1';
check('chunk size clamped to ≥ 64 KiB', D.driveConfig().chunkSize === 65536);
delete process.env.ONE_CHUNK_KB;

// production CORS: only the listed FaLe One origins, no localhost
process.env.VERCEL_ENV = 'production';
const cfg = C.getConfig();
check('production: FaLe One origins allowed', H.isAllowedOrigin('https://fale-one.vercel.app', cfg) && H.isAllowedOrigin('https://one.fale.network', cfg));
check('production: localhost with port not allowed', !H.isAllowedOrigin('http://localhost:8917', cfg));
process.env.FALE_ONE_ORIGINS = 'http://localhost:5173, javascript:alert(1), https://ok.example';
const cfg2 = C.getConfig();
check('FALE_ONE_ORIGINS: only http(s) origins are taken over', cfg2.allowedOrigins.includes('http://localhost:5173') && cfg2.allowedOrigins.includes('https://ok.example') && !cfg2.allowedOrigins.some(o => o.startsWith('javascript')));
delete process.env.FALE_ONE_ORIGINS; delete process.env.VERCEL_ENV;

// the handler without configuration
const core = D.makeDriveCore({ getConfig: () => ({ ...C.getConfig(), accountsEnabled: true, supabaseUrl: 'https://x.supabase.co', supabaseKey: 'k' }) });
function mockRes() {
  const res = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b ? String(b) : ''; this.done = true; }, headersSent: false };
  return res;
}
let res = mockRes();
await core.drive({ method: 'POST', url: '/api/drive?a=quota', headers: {}, body: {} }, res);
check('ONE_ENABLED unset → 503 drive_not_configured', res.statusCode === 503 && JSON.parse(res.body).error === 'drive_not_configured', res.body);
res = mockRes();
await core.drive({ method: 'POST', url: '/api/drive?a=config', headers: {}, body: {} }, res);
check('config works without auth and reports configured:false', res.statusCode === 200 && JSON.parse(res.body).configured === false);
res = mockRes();
await core.drive({ method: 'PUT', url: '/api/drive?a=config', headers: {}, body: {} }, res);
check('PUT → 405', res.statusCode === 405);

// JSON mapping
const n = D.nodeOut({ id: 'i', parent: null, kind: 'file', version: '3', seq: '9', key: 'k', meta: 'm', created_at: 'c', updated_at: 'u', trashed_at: null, trash_root: null, deleted: false,
  head: { id: 'r', key: 'rk', meta: 'rm', hash: null, size: '10', device_id: null, created_at: 'c', superseded_at: null, blobs: [{ id: 'b', purpose: 'content', size: '10', chunks: '1', chunk_size: '65536', backend: 'pg' }] } });
check('nodeOut: camelCase + numbers', n.version === 3 && n.seq === 9 && n.head.size === 10 && n.head.blobs[0].chunkSize === 65536 && n.trashedAt === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
