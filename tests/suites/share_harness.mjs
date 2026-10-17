// Local test harness for "Teilen & Übertragen": serves the app statically AND routes /api/share,
// /api/sign, /api/transfer (+ /api/ai/register for device tokens) to the real handlers with the
// in-memory store and a controllable clock. Test-only endpoints under /__test/*.
//   node share_harness.mjs [port]      (default 8801)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = process.env.FALE_ROOT || '/home/claude/FalePDF';
const require = createRequire(join(ROOT, 'api', 'x.js'));
const { makeShareCore } = require('./_lib/share.js');
const { memoryShareStore } = require('./_lib/sharestore.js');
const { makeCore } = require('./_lib/core.js');

export const BASE_ENV = {
  AI_PROVIDER: 'mock', FALE_STORE: 'memory', FALE_TOKEN_SECRET: 'test-token-secret-0123456789abcdefghijklmnopqrstuvwxyz',
  FALE_IP_SALT: 'test-ip-salt-0123456789', REGISTER_IP_DAILY: '500', SHARE_CHUNK_KB: '256', SHARE_MAX_MB: '50', SHARE_TOTAL_MB: '300',
};
const MANAGED = new Set([...Object.keys(BASE_ENV), 'SHARE_DEVICE_DAILY', 'SHARE_IP_DAILY', 'SHARE_DL_IP_DAILY', 'TRANSFER_JOIN_IP_DAILY', 'SHARE_TOTAL_MB']);
function resetEnv(extra = {}) { for (const k of MANAGED) delete process.env[k]; Object.assign(process.env, BASE_ENV, extra); }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown', '.gz': 'application/gzip', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf' };

export function startHarness(port = 8801) {
  resetEnv();
  let offset = 0;
  const clock = () => new Date(Date.now() + offset);
  let store = memoryShareStore({ now: clock });
  let core = makeShareCore({ getShareStore: () => store, now: clock });
  let aiCore = makeCore();
  let log = [];
  const routes = { '/api/share': 'share', '/api/sign': 'sign', '/api/transfer': 'transfer' };

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    try {
      if (u.pathname.startsWith('/__test/')) return testRoute(u, req, res);
      const p = u.pathname.replace(/\/+$/, '');
      if (routes[p] || p === '/api/ai/register') {
        // record everything the server receives (to prove: no plaintext, no key)
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = Buffer.concat(chunks);
        log.push({ url: req.url, method: req.method, auth: req.headers['x-fale-auth'] || '', referer: req.headers.referer || '', body: body.toString('latin1') });
        if (log.length > 5000) log = log.slice(-5000);
        req.body = (req.headers['content-type'] || '').includes('application/json') ? (body.length ? JSON.parse(body.toString('utf8')) : {}) : body;
        if (process.env.HARNESS_DELAY_MS) await new Promise(r => setTimeout(r, +process.env.HARNESS_DELAY_MS));
        if (p === '/api/ai/register') return aiCore.register(req, res);
        return core[routes[p]](req, res);
      }
      if (u.pathname.startsWith('/api/')) { res.statusCode = 404; return res.end('{"error":"not_found"}'); }
      let f = normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, '');
      if (f.endsWith('/')) f += 'index.html';
      const file = join(ROOT, f);
      if (!file.startsWith(ROOT) || /\/(api|supabase|\.git)\//.test(file.slice(ROOT.length) + '/')) { res.statusCode = 404; return res.end(); }
      const st = await stat(file).catch(() => null);
      if (!st || !st.isFile()) { res.statusCode = 404; return res.end('not found'); }
      res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      res.end(await readFile(file));
    } catch (e) { console.error('harness', e); if (!res.headersSent) { res.statusCode = 500; res.end(); } }
  });

  async function testRoute(u, req, res) {
    const send = (o, s = 200) => { res.statusCode = s; res.setHeader('Content-Type', 'application/json'); res.setHeader('Access-Control-Allow-Origin', '*'); res.end(JSON.stringify(o)); };
    if (u.pathname === '/__test/reset') {
      resetEnv(Object.fromEntries(u.searchParams)); offset = 0; log = [];
      store = memoryShareStore({ now: clock }); core = makeShareCore({ getShareStore: () => store, now: clock }); aiCore = makeCore();
      require('./_lib/store.js')._memory()._reset();
      return send({ ok: true });
    }
    if (u.pathname === '/__test/env') { for (const [k, v] of u.searchParams) { if (v === '') delete process.env[k]; else process.env[k] = v; } return send({ ok: true }); }
    if (u.pathname === '/__test/advance') { offset += Number(u.searchParams.get('ms') || 0); return send({ ok: true, offset }); }
    if (u.pathname === '/__test/purge') return send(await store.purge());
    if (u.pathname === '/__test/log') return send({ log });
    if (u.pathname === '/__test/state') {
      const s = store._state;
      const objects = [...s.objects.values()].map(o => ({ id: o.id, kind: o.kind, size: o.size, chunks: o.chunkCount, complete: o.complete, downloads: o.downloads, maxDownloads: o.maxDownloads, header: o.header, parent: o.parent }));
      const chunks = [...s.chunks.entries()].map(([k, v]) => ({ k, b64: v.toString('base64') }));
      return send({ objects, chunks, requests: [...s.requests.values()].map(r => ({ id: r.id, count: r.count })), signers: [...s.signers.values()].map(x => ({ idx: x.idx, status: x.status, result: x.resultId })), rooms: [...s.rooms.values()].map(r => ({ id: r.id, code: r.code, via: r.via, joined: !!r.guest })), msgs: s.msgs.length, usage: [...s.usage] });
    }
    return send({ error: 'unknown' }, 404);
  }

  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && process.argv[1].endsWith('share_harness.mjs')) {
  const port = parseInt(process.argv[2] || '8801', 10);
  startHarness(port).then(() => console.log(`Share harness on http://127.0.0.1:${port}/ (root ${ROOT})`));
}
