// Local test harness: serves /home/claude/FalePDF statically AND routes /api/* to the real
// Vercel handlers (mock provider + in-memory store). Test-only endpoints under /__test/*.
//   node ai_harness.mjs [port]      (default 8799)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';

const ROOT = process.env.FALE_ROOT || '/home/claude/FalePDF';
const require = createRequire(join(ROOT, 'api', 'x.js'));
const { makeCore } = require('./_lib/core.js');
const store = require('./_lib/store.js');
const Sec = require('./_lib/security.js');

export const BASE_ENV = {
  AI_PROVIDER: 'mock', FALE_STORE: 'memory', FALE_TOKEN_SECRET: 'test-token-secret-0123456789abcdefghijklmnopqrstuvwxyz',
  FALE_IP_SALT: 'test-ip-salt-0123456789', FREE_DAILY: '5', REWARD_BONUS: '3', REWARD_MAX_PER_DAY: '3', PLUS_DAILY: '200', IP_DAILY: '40',
  REGISTER_IP_DAILY: '30', AI_MONTHLY_BUDGET_EUR: '10', AI_PRICE_IN_USD_PER_MTOK: '1', AI_PRICE_OUT_USD_PER_MTOK: '5', USD_EUR: '0.95',
};
const MANAGED = new Set([...Object.keys(BASE_ENV), 'ANTHROPIC_API_KEY', 'GOOGLE_PLAY_SA_JSON', 'ADS_ENABLED', 'ADMOB_REWARDED_AD_UNITS', 'AI_MODEL']);
export function resetEnv(extra = {}) {
  for (const k of MANAGED) delete process.env[k];
  Object.assign(process.env, BASE_ENV, extra);
}

// local ECDSA key pair standing in for Google's AdMob verifier keys
export const ssvKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
export const SSV_KEY_ID = '3335741209';
const pubPem = ssvKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString();

export function signedSsvQuery(params, { keyId = SSV_KEY_ID, privateKey = ssvKeys.privateKey } = {}) {
  const order = ['ad_network', 'ad_unit', 'custom_data', 'reward_amount', 'reward_item', 'timestamp', 'transaction_id', 'user_id'];
  const qs = order.filter(k => params[k] != null).map(k => `${k}=${encodeURIComponent(params[k])}`).join('&');
  const sig = crypto.sign('sha256', Buffer.from(qs), { key: privateKey, dsaEncoding: 'der' });
  return `${qs}&signature=${Sec.b64url(sig)}&key_id=${keyId}`;
}

export function createCore(overrides = {}) {
  return makeCore({ getVerifierKeys: async () => new Map([[SSV_KEY_ID, pubPem]]), ...overrides });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown', '.gz': 'application/gzip', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf' };

export function startHarness(port = 8799, { coreOverrides = {}, env = {} } = {}) {
  resetEnv(env);
  let core = createCore(coreOverrides);
  const routes = { '/api/ai': 'ai', '/api/ai/register': 'register', '/api/ai/quota': 'quota', '/api/admob-ssv': 'ssv', '/api/plus-verify': 'plusVerify' };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    try {
      if (u.pathname.startsWith('/__test/')) return testRoute(u, req, res);
      const r = routes[u.pathname.replace(/\/+$/, '')];
      if (r) return core[r](req, res);
      // „Brief per Post“ asks whether it is set up – answer like production before setup (no 404 in the console)
      if (u.pathname === '/api/post' && u.searchParams.get('a') === 'config') { res.setHeader('Content-Type', 'application/json'); return res.end('{"ok":true,"enabled":false,"fax":false}'); }
      if (u.pathname.startsWith('/api/')) { res.statusCode = 404; return res.end('{"error":"not_found"}'); }
      let p = normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, '');
      if (p.endsWith('/')) p += 'index.html';
      const file = join(ROOT, p);
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
    if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'POST, GET'); res.statusCode = 204; return res.end(); }
    if (u.pathname === '/__test/reset') { store._memory()._reset(); resetEnv(Object.fromEntries(u.searchParams)); core = createCore(coreOverrides); return send({ ok: true }); }
    if (u.pathname === '/__test/env') { for (const [k, v] of u.searchParams) { if (v === '') delete process.env[k]; else process.env[k] = v; } return send({ ok: true }); }
    if (u.pathname === '/__test/ssv') {
      // simulate Google's SSV callback for a reward shown to the device whose token is custom_data
      const custom = u.searchParams.get('custom_data') || '';
      const qs = signedSsvQuery({ ad_network: '5450213213286189855', ad_unit: '5224354917', custom_data: custom, reward_amount: '3', reward_item: 'KI', timestamp: String(Date.now()), transaction_id: 'tx' + crypto.randomBytes(8).toString('hex') });
      const fakeReq = { method: 'GET', url: '/api/admob-ssv?' + qs, headers: {} };
      const chunks = [];
      const fakeRes = { statusCode: 200, headersSent: false, writableEnded: false, setHeader() {}, on() {}, end(b) { chunks.push(b); this.writableEnded = true; } };
      await core.ssv(fakeReq, fakeRes);
      return send({ status: fakeRes.statusCode, body: JSON.parse(chunks.join('') || '{}') });
    }
    if (u.pathname === '/__test/state') { const s = store._memory()._state; return send({ usage: [...s.usage], budget: [...s.budget], rewards: s.rewards.size, plus: [...s.plus] }); }
    return send({ error: 'unknown' }, 404);
  }

  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && process.argv[1].endsWith('ai_harness.mjs')) {
  const port = parseInt(process.argv[2] || '8799', 10);
  startHarness(port).then(() => console.log(`AI harness on http://127.0.0.1:${port}/ (root ${ROOT})`));
}
