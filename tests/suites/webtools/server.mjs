// Static server that behaves like Vercel for network/ (project "fale-network"):
//   - headers from network/vercel.json, applied in order, later rules override the same key
//   - redirects (exact sources), cleanUrls (x.html → x, x/index.html → x/), trailingSlash: true
//   - 404.html for missing files, 405 for non-GET/HEAD (static deployment)
// Usage: node server.mjs [port=8710] [root=/home/claude/FalePDF/network]
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';

const port = parseInt(process.argv[2] || '8710', 10);
const ROOT = process.argv[3] || '/home/claude/FalePDF/network';
const cfg = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));

// path-to-regexp subset used by vercel.json: (regex groups), \\x literal, :param, :param*
function toRegex(src) {
  let re = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { re += '\\' + src[++i]; continue; }
    if (c === '(') {
      let depth = 1, j = i + 1;
      while (j < src.length && depth) { if (src[j] === '\\') j++; else if (src[j] === '(') depth++; else if (src[j] === ')') depth--; j++; }
      re += src.slice(i, j);
      i = j - 1;
      continue;
    }
    if (c === ':') {
      const m = /^:([A-Za-z_]\w*)(\*|\+|\?)?/.exec(src.slice(i));
      re += m[2] === '*' ? '(.*)' : '([^/]+)';
      i += m[0].length - 1;
      continue;
    }
    re += /[.*+?^${}|[\]\/]/.test(c) ? '\\' + c : c;
  }
  return new RegExp('^' + re + '$');
}
const HEADER_RULES = (cfg.headers || []).map(r => ({ re: toRegex(r.source), headers: r.headers }));
const REDIRECTS = (cfg.redirects || []).map(r => ({ re: toRegex(r.source), dest: r.destination, status: r.permanent ? 308 : 307 }));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.wasm': 'application/wasm', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.md': 'text/markdown', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream',
  '.icc': 'application/vnd.iccprofile', '.ttf': 'font/ttf',
};

function applyHeaders(pathname, res) {
  const set = new Map();
  for (const r of HEADER_RULES) if (r.re.test(pathname)) for (const h of r.headers) set.set(h.key.toLowerCase(), [h.key, h.value]);
  for (const [, [k, v]] of set) res.setHeader(k, v);
  return set;
}

async function isFile(p) { const s = await stat(p).catch(() => null); return !!(s && s.isFile()); }
async function isDir(p) { const s = await stat(p).catch(() => null); return !!(s && s.isDirectory()); }

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    let path = decodeURIComponent(u.pathname);
    if (path.includes('\0')) { res.statusCode = 400; return res.end(); }
    for (const r of REDIRECTS) {
      if (r.re.test(path)) { res.statusCode = r.status; res.setHeader('Location', r.dest); return res.end(); }
    }
    const rel = normalize(path).replace(/^(\.\.[/\\])+/, '');
    let file = join(ROOT, rel);
    if (!file.startsWith(ROOT)) { res.statusCode = 404; return res.end(); }
    if (/^\/(tools|BRAND\.md|DOMAINS\.md|\.vercelignore|vercel\.json)(\/|$)/.test(rel)) return notFound(res); // .vercelignore (anchored)
    // cleanUrls: /x.html → /x/ (with trailingSlash), /x/index.html → /x/
    if (path.endsWith('/index.html')) return redirect(res, path.slice(0, -'index.html'.length) + u.search);
    if (path.endsWith('.html') && path !== '/404.html') return redirect(res, path.slice(0, -5) + '/' + u.search);
    if (!path.endsWith('/') && !extname(path)) {
      if (await isDir(file) || await isFile(file + '.html')) return redirect(res, path + '/' + u.search);
    }
    if (path.endsWith('/')) {
      if (await isFile(join(file, 'index.html'))) file = join(file, 'index.html');
      else if (path !== '/' && await isFile(file.replace(/\/$/, '') + '.html')) file = file.replace(/\/$/, '') + '.html';
    }
    if (!(await isFile(file))) return notFound(res, path);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; return res.end('Method Not Allowed'); }
    res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    applyHeaders(path, res);
    const body = await readFile(file);
    res.setHeader('Content-Length', body.length);
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (e) {
    if (!res.headersSent) { res.statusCode = 500; res.end(String(e)); }
  }
});

async function notFound(res, path = '') {
  res.statusCode = 404;
  applyHeaders(path || '/404', res);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(await readFile(join(ROOT, '404.html')).catch(() => 'not found'));
}
function redirect(res, to) { res.statusCode = 308; res.setHeader('Location', to); res.end(); }

server.listen(port, '127.0.0.1', () => console.log(`vercel-like server :${port} root ${ROOT}`));
