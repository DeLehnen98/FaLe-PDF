// Local backend + static host for the FaLe One web app tests.
//   node one_harness.mjs            (ports 8920–8924)
//   :8920  "fale-pdf.vercel.app" stand-in: /api/share|sign (real share core, in-memory store) + everything else
//          proxied to :8923 (real /api/drive, /api/account, /api/ai/register, FaLe PDF static, /__test/*)
//   :8922  "fale-one.vercel.app" stand-in: serves /home/claude/FalePDF/one with the headers of one/vercel.json
//          (CSP connect-src rewritten to the local origins, upgrade-insecure-requests dropped for http)
//   :8923  account harness (real SQL migrations in the local PostgreSQL), mock Supabase on :8924
process.env.PGDB = process.env.PGDB || 'fale_one_ui';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const { startHarness } = await import('../acct/account_harness.mjs');

const ROOT = '/home/claude/FalePDF';
const ONE = join(ROOT, 'one');
const require = createRequire(join(ROOT, 'api', 'x.js'));
Object.assign(process.env, { SHARE_CHUNK_KB: '256', SHARE_MAX_MB: '50', SHARE_TOTAL_MB: '300' });
const { makeShareCore } = require('./_lib/share.js');
const { memoryShareStore } = require('./_lib/sharestore.js');

const FRONT = +(process.env.ONE_FRONT || 8920), STATIC = +(process.env.ONE_STATIC || 8922), ACCT = +(process.env.ONE_ACCT || 8923); // ports configurable (Notfallzugang tests: 8935/8937/8938)
await startHarness(ACCT);
let shareStore = memoryShareStore();
let shareCore = makeShareCore({ getShareStore: () => shareStore });
const shareLog = [];

const front = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname.replace(/\/+$/, '');
  try {
    if (p === '/__one/share-state') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ objects: [...shareStore._state.objects.values()].map(o => ({ id: o.id, kind: o.kind, size: o.size, complete: o.complete, header: o.header })), log: shareLog.slice(-200) }));
    }
    if (p === '/__one/share-reset') { shareStore = memoryShareStore(); shareCore = makeShareCore({ getShareStore: () => shareStore }); res.end('{}'); return; }
    if (p === '/api/share' || p === '/api/sign') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      shareLog.push({ url: req.url, size: body.length, body: body.length < 4000 ? body.toString('latin1') : '' });
      req.body = (req.headers['content-type'] || '').includes('application/json') ? (body.length ? JSON.parse(body.toString('utf8')) : {}) : body;
      return shareCore[p === '/api/share' ? 'share' : 'sign'](req, res);
    }
    // proxy everything else to the account harness
    const up = http.request({ host: '127.0.0.1', port: ACCT, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${ACCT}` } }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => { if (!res.headersSent) { res.statusCode = 502; res.end(); } });
    req.pipe(up);
  } catch (e) { console.error('front', e); if (!res.headersSent) { res.statusCode = 500; res.end(); } }
});
await new Promise(r => front.listen(FRONT, '127.0.0.1', r));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf', '.icc': 'application/octet-stream' };
function headersFor(path) {
  const vc = JSON.parse(readFileSync(join(ONE, 'vercel.json'), 'utf8'));
  const out = {};
  for (const rule of vc.headers) {
    const re = new RegExp('^' + rule.source.replace(/\(\.\*\)/g, '(.*)') + '$');
    if (re.test(path)) for (const h of rule.headers) out[h.key] = h.value;
  }
  if (out['Content-Security-Policy']) {
    out['Content-Security-Policy'] = out['Content-Security-Policy']
      .replace('https://fale-pdf.vercel.app https://*.supabase.co', `http://127.0.0.1:${FRONT} http://127.0.0.1:${ACCT + 1}`)
      .replace(/;\s*upgrade-insecure-requests/, '');
  }
  delete out['Strict-Transport-Security'];
  return out;
}
const stat_ = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (req.method === 'POST' && u.pathname === '/share-target') { res.statusCode = 405; return res.end('SW not active'); }
    let f = normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (f.endsWith('/')) f += 'index.html';
    const file = join(ONE, f);
    if (!file.startsWith(ONE)) { res.statusCode = 404; return res.end(); }
    const s = await stat(file).catch(() => null);
    if (!s || !s.isFile()) { res.statusCode = 404; return res.end('not found'); }
    for (const [k, v] of Object.entries(headersFor(u.pathname))) res.setHeader(k, v);
    res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch (e) { console.error('static', e); if (!res.headersSent) { res.statusCode = 500; res.end(); } }
});
await new Promise(r => stat_.listen(STATIC, '127.0.0.1', r));
console.log(`FaLe One harness: app http://127.0.0.1:${STATIC}/  api http://127.0.0.1:${FRONT}  (account harness :${ACCT}, mock Supabase :${ACCT + 1}, db ${process.env.PGDB})`);
