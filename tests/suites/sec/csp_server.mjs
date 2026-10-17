// Static file server for the e2e suites that applies the vercel.json security headers (CSP, COOP, …).
//   node csp_server.mjs <port> [root]
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { applyVercelHeaders } from './vercel_headers.mjs';
const port = parseInt(process.argv[2] || '9400', 10);
const ROOT = process.argv[3] || process.env.FALE_ROOT || '/home/claude/FalePDF';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown', '.gz': 'application/gzip', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.xml': 'application/xml', '.docx': 'application/octet-stream', '.xlsx': 'application/octet-stream', '.pptx': 'application/octet-stream' };
http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    let p = normalize(decodeURIComponent(u.pathname)).replace(/^(\.\.[/\\])+/, '');
    applyVercelHeaders(u.pathname, res);
    if (p.endsWith('/')) p += 'index.html';
    const file = join(ROOT, p);
    if (!file.startsWith(ROOT) || /\/(\.git|api|supabase)\//.test(file.slice(ROOT.length) + '/')) { res.statusCode = 404; return res.end(); }
    const st = await stat(file).catch(() => null);
    if (!st || !st.isFile()) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(await readFile(file));
  } catch (e) { if (!res.headersSent) { res.statusCode = 500; res.end(); } }
}).listen(port, '127.0.0.1', () => console.log(`csp server :${port} root ${ROOT}`));
