// Build for hosting (Vercel or any static host).
// Copies the app into dist/, fills dist/vendor/ from node_modules (exact pinned
// versions from package.json) and regenerates the service-worker precache list.
//   npm install && node scripts/vercel-build.mjs
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const NM = process.env.FALE_NODE_MODULES || join(ROOT, 'node_modules');

const APP_SKIP = new Set(['dist', 'node_modules', 'scripts', 'vendor', '.git', '.vercel',
  'package.json', 'package-lock.json', 'vercel.json', 'README.md', 'vendor-extra',
  'android', 'store', 'capacitor.config.json',
  'api', 'supabase']); // serverless functions + DB migrations are not static app files
// `--native` (or FALE_TARGET=native): build for the Android app (Capacitor webDir).
const NATIVE = process.argv.includes('--native') || process.env.FALE_TARGET === 'native';

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// 1) App files
for (const name of readdirSync(ROOT)) {
  if (APP_SKIP.has(name) || name.startsWith('.')) continue;
  cpSync(join(ROOT, name), join(DIST, name), { recursive: true });
}

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
  // Self-contained build: use the checked-in vendor/ folder as is.
  cpSync(LOCAL_VENDOR, join(DIST, 'vendor'), { recursive: true });
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

// Static host config next to the files (so `vercel deploy dist` keeps the headers)
if (!NATIVE) {
  const vc = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
  writeFileSync(join(DIST, 'vercel.json'), JSON.stringify({ headers: vc.headers }, null, 2));
} else {
  // Android: no viewport-fit=cover → Capacitor keeps the WebView clear of the system bars.
  const ix = join(DIST, 'index.html');
  writeFileSync(ix, readFileSync(ix, 'utf8').replace(/,\s*viewport-fit=cover/, ''));
}

// 3) Service worker precache list
const walk = (dir) => readdirSync(dir).flatMap(n => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const files = walk(DIST)
  .map(p => relative(DIST, p).split(sep).join('/'))
  .filter(r => r !== 'sw.js' && r !== 'vercel.json' && !r.startsWith('.') && !r.endsWith('.map'))
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
