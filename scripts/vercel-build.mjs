// Build for hosting (Vercel or any static host).
// Copies the app into dist/, fills dist/vendor/ from node_modules (exact pinned
// versions from package.json) and regenerates the service-worker precache list.
//   npm install && node scripts/vercel-build.mjs
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { verifyVendor } from './vendor-manifest.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const NM = process.env.FALE_NODE_MODULES || join(ROOT, 'node_modules');

const APP_SKIP = new Set(['dist', 'node_modules', 'scripts', 'vendor', '.git', '.vercel',
  'package.json', 'package-lock.json', 'vercel.json', 'README.md', 'vendor-extra',
  'android', 'store', 'capacitor.config.json',
  'api', 'supabase', 'network', // serverless functions + DB migrations are not static app files
  'docs', 'SECURITY.md']); // documentation only
// `--native` (or FALE_TARGET=native): build for the Android app (Capacitor webDir).
const NATIVE = process.argv.includes('--native') || process.env.FALE_TARGET === 'native';

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// 1) App files
for (const name of readdirSync(ROOT)) {
  if (APP_SKIP.has(name) || name.startsWith('.')) continue;
  cpSync(join(ROOT, name), join(DIST, name), { recursive: true });
}
// RFC 9116 security contact (web only; dot-folders are skipped above)
if (!NATIVE && existsSync(join(ROOT, '.well-known', 'security.txt'))) {
  mkdirSync(join(DIST, '.well-known'), { recursive: true });
  cpSync(join(ROOT, '.well-known', 'security.txt'), join(DIST, '.well-known', 'security.txt'));
}

// 1b) Content-Security-Policy: the <meta> fallback in index.html (needed in the Android WebView, which has
// no HTTP headers) must match the header in vercel.json (which additionally has frame-ancestors, a
// directive that is ignored in <meta>). A drift between the two would silently weaken one of them.
const CSP_META = (() => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
  if (!m) throw new Error('index.html: <meta http-equiv="Content-Security-Policy"> fehlt');
  const vc = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
  const hdr = (vc.headers || []).filter(r => r.source === '/' || r.source === '/(.*)\\.html')
    .map(r => (r.headers.find(h => h.key === 'Content-Security-Policy') || {}).value);
  const norm = v => String(v || '').split(';').map(x => x.trim().replace(/\s+/g, ' ')).filter(x => x && !/^frame-ancestors\b/.test(x)).join('; ');
  if (hdr.length !== 2 || hdr.some(v => norm(v) !== norm(m[1]))) {
    throw new Error('Content-Security-Policy in index.html und vercel.json ("/" und "/(.*)\\.html") stimmen nicht überein');
  }
  return m[1];
})();

// 2) Vendor libraries
const stripMap = (file) => {
  const src = readFileSync(file, 'utf8').replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '\n');
  writeFileSync(file, src);
};
const copy = (from, to, opts = {}) => {
  const src = join(NM, from);
  if (!existsSync(src)) throw new Error('Fehlt in node_modules: ' + from);
  mkdirSync(dirname(join(DIST, to)), { recursive: true });
  cpSync(src, join(DIST, to), { recursive: true, ...opts });
  if (/\.(m?js)$/.test(to)) stripMap(join(DIST, to));
};

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const deps = pkg.dependencies || {};
const LOCAL_VENDOR = join(ROOT, 'vendor');

if (existsSync(join(LOCAL_VENDOR, 'pdfjs', 'pdf.min.mjs')) && !process.env.FALE_VENDOR_FROM_NPM) {
  // Self-contained build: use the checked-in vendor/ folder as is – after checking every file against the
  // SHA-256 list in vendor/MANIFEST.json (supply-chain integrity; see scripts/vendor-manifest.mjs).
  const problems = verifyVendor(ROOT, LOCAL_VENDOR);
  if (problems.length) throw new Error('vendor/ weicht von vendor/MANIFEST.json ab:\n  ' + problems.slice(0, 30).join('\n  '));
  // vendor/onnx (background removal, ~22 MB) is only used by the FaLe Werkzeuge web tool – not shipped with the app
  cpSync(LOCAL_VENDOR, join(DIST, 'vendor'), { recursive: true, filter: src => relative(LOCAL_VENDOR, src).split(sep)[0] !== 'onnx' });
} else {
  const PDFJS = 'pdfjs-dist';
  copy(`${PDFJS}/legacy/build/pdf.min.mjs`, 'vendor/pdfjs/pdf.min.mjs');
  copy(`${PDFJS}/legacy/build/pdf.worker.min.mjs`, 'vendor/pdfjs/pdf.worker.min.mjs');
  copy(`${PDFJS}/legacy/web/pdf_viewer.mjs`, 'vendor/pdfjs/pdf_viewer.mjs');
  copy(`${PDFJS}/legacy/web/pdf_viewer.css`, 'vendor/pdfjs/pdf_viewer.css');
  copy(`${PDFJS}/legacy/web/images`, 'vendor/pdfjs/images');
  for (const d of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
    if (existsSync(join(NM, PDFJS, d))) copy(`${PDFJS}/${d}`, `vendor/pdfjs/${d}`);
  }
  copy(`${PDFJS}/LICENSE`, 'vendor/pdfjs/LICENSE');
  copy('pdf-lib/dist/pdf-lib.min.js', 'vendor/pdf-lib/pdf-lib.min.js');
  copy('pdf-lib/LICENSE.md', 'vendor/pdf-lib/LICENSE.md');
  const EXTRA = {
    'jszip': [['jszip/dist/jszip.min.js', 'vendor/jszip/jszip.min.js'], ['jszip/LICENSE.markdown', 'vendor/jszip/LICENSE.markdown']],
    'docx': [['docx/dist/index.iife.js', 'vendor/docx/docx.iife.js'], ['docx/LICENSE', 'vendor/docx/LICENSE']],
    'pptxgenjs': [['pptxgenjs/dist/pptxgen.bundle.js', 'vendor/pptxgenjs/pptxgen.bundle.js'], ['pptxgenjs/LICENSE', 'vendor/pptxgenjs/LICENSE']],
  };
  for (const [name, files] of Object.entries(EXTRA)) {
    if (!deps[name]) continue;
    for (const [from, to] of files) copy(from, to);
  }
}
if (existsSync(join(ROOT, 'vendor-extra'))) {
  cpSync(join(ROOT, 'vendor-extra'), join(DIST, 'vendor'), { recursive: true });
}

// Public FaLe-Konto settings (no secrets) → js/account/build-config.js, so the app knows without any request
// whether the optional account is available. Left as `null` when the variables are missing (e.g. a local
// native build); the app then asks /api/account?a=config when the user opens #/konto.
{
  const env = k => String(process.env[k] || '').trim();
  const on = k => ['1', 'true', 'yes', 'on', 'ja'].includes(env(k).toLowerCase());
  const url = env('SUPABASE_URL').replace(/\/+$/, ''), key = env('SUPABASE_PUBLISHABLE_KEY');
  if (url && key && !/^sb_secret_/.test(key)) {
    const configured = on('ACCOUNTS_ENABLED');
    const cfg = { configured, supabaseUrl: configured ? url : null, supabaseKey: configured ? key : null, features: { email: configured, google: configured && on('AUTH_GOOGLE_ENABLED'), sync: configured } };
    writeFileSync(join(DIST, 'js/account/build-config.js'), `// generated by scripts/vercel-build.mjs – public settings only\nexport default ${JSON.stringify(cfg)};\n`);
    // The CSP (connect-src) only allows https://*.supabase.co – a custom Supabase domain must be added to
    // index.html AND vercel.json, otherwise every account request would be blocked by the browser.
    let host = '';
    try { host = new URL(url).hostname; } catch {}
    if (configured && !/\.supabase\.co$/i.test(host) && !CSP_META.includes(new URL(url).origin)) {
      throw new Error(`SUPABASE_URL ${new URL(url).origin} ist nicht in der Content-Security-Policy (connect-src) erlaubt – in index.html und vercel.json ergänzen`);
    }
  }
}

// Static host config next to the files (so `vercel deploy dist` keeps the headers)
if (!NATIVE) {
  const vc = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
  writeFileSync(join(DIST, 'vercel.json'), JSON.stringify({ headers: vc.headers }, null, 2));
} else {
  // Android: no viewport-fit=cover → Capacitor keeps the WebView clear of the system bars.
  const ix = join(DIST, 'index.html');
  writeFileSync(ix, readFileSync(ix, 'utf8').replace(/,\s*viewport-fit=cover/, ''));
}

// 2b) Minify our own JS/CSS for production (Vercel/CI or FALE_MINIFY=1; FALE_MINIFY=0 disables)
const MINIFY = process.env.FALE_MINIFY === '1' || (process.env.FALE_MINIFY !== '0' && !!(process.env.VERCEL || process.env.CI));
if (MINIFY) {
  let esbuild = null;
  for (const base of [NM, join(ROOT, 'node_modules')]) {
    try { esbuild = (await import(pathToFileURL(join(base, 'esbuild', 'lib', 'main.js')).href)).default; break; } catch {}
  }
  if (!esbuild) {
    console.warn('esbuild nicht gefunden – Build bleibt unminifiziert.');
  } else {
    const walkMin = (dir) => readdirSync(dir).flatMap(n => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? (n === 'vendor' ? [] : walkMin(p)) : [p];
    });
    let before = 0, after = 0;
    for (const f of walkMin(DIST)) {
      const isJs = f.endsWith('.js') && !f.endsWith('.min.js') && !/[\\/]sw\.js$/.test(f);
      const isCss = f.endsWith('.css');
      if (!isJs && !isCss) continue;
      const src = readFileSync(f, 'utf8');
      const out = esbuild.transformSync(src, { loader: isJs ? 'js' : 'css', minify: true, target: isJs ? 'es2022' : undefined, legalComments: 'none', charset: 'utf8' }).code;
      before += src.length; after += out.length;
      writeFileSync(f, out);
    }
    console.log(`Minifiziert: ${(before / 1e6).toFixed(2)} MB → ${(after / 1e6).toFixed(2)} MB`);
  }
}

// 3) Service worker precache list
const walk = (dir) => readdirSync(dir).flatMap(n => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const files = walk(DIST)
  .map(p => relative(DIST, p).split(sep).join('/'))
  .filter(r => r !== 'sw.js' && r !== 'vercel.json' && r !== 'vendor/MANIFEST.json' && !r.startsWith('.') && !r.endsWith('.map'))
  // OCR engine + language data (~13 MB) are cached by the service worker on first use, not at install
  .filter(r => !r.startsWith('vendor/tesseract/'))
  .sort();
const h = createHash('sha256');
for (const r of files) { h.update(r); h.update(readFileSync(join(DIST, r))); }
const ver = h.digest('hex').slice(0, 10);
const list = ['./', ...files.map(r => './' + r)];
const swPath = join(DIST, 'sw.js');
let sw = readFileSync(swPath, 'utf8');
sw = sw.replace(/(\/\/ ASSETS-START[^\n]*\n)[\s\S]*?(\n\/\/ ASSETS-END)/, (_, a, b) => a + 'const ASSETS = ' + JSON.stringify(list, null, 2) + ';' + b);
sw = sw.replace(/const VERSION = '[^']*';/, `const VERSION = 'v${pkg.version}-${ver}';`);
writeFileSync(swPath, sw);
const total = files.reduce((s, r) => s + statSync(join(DIST, r)).size, 0);
console.log(`FaLe PDF build: ${list.length} Dateien, ${(total / 1e6).toFixed(1)} MB, Version ${pkg.version}-${ver}`);
