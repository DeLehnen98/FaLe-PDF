// Copies the shared, import-free modules and third-party files that the FaLe One web app (one/) reuses
// from the FaLe PDF app (js/, vendor/) and the FaleNetwork site (network/assets/) into one/, and
// regenerates the service-worker precache list (one/sw.js). one/ is deployed on its own (Vercel project
// "fale-one", root directory one/, no build step), so it must contain everything it serves.
//
//   node scripts/sync-one-shared.mjs           → copy + write one/vendor/MANIFEST.json + one/sw.js asset list
//   node scripts/sync-one-shared.mjs --check   → exit 1 when a copy differs from its source, a file is missing
//                                                 or unexpected, or the precache list is stale (used in CI)
//
// The reference client js/one/{api,crypto}.js and the key code js/sync/crypto.js are NORMATIVE for the
// FaLe One format (docs/FALE-ONE-API.md §5): one/ must never carry its own edited copy of them.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ONE = join(ROOT, 'one');
const CHECK = process.argv.includes('--check');

const walk = dir => readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const rel = (from, p) => relative(from, p).split(sep).join('/');
const sha256 = buf => createHash('sha256').update(buf).digest('hex');

// ---------------------------------------------------------------- shared modules (banner + unchanged source)
const banner = src => `// GENERATED – synced copy of ${src} by scripts/sync-one-shared.mjs.\n// Do not edit here: change the source and run \`node scripts/sync-one-shared.mjs\`.\n`;
function module_(src, allowed = []) {
  const text = readFileSync(join(ROOT, src), 'utf8');
  const imports = [...text.matchAll(/^\s*import\s[\s\S]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm)].map(m => m[1] || m[2]);
  const bad = imports.filter(i => !allowed.includes(i));
  if (bad.length) throw new Error(`${src} now imports ${bad.join(', ')} – it can no longer be synced into one/ as is`);
  return Buffer.from(banner(src) + text, 'utf8');
}
const SHARED = {
  'js/shared/one/crypto.js': () => module_('js/one/crypto.js'),
  'js/shared/one/api.js': () => module_('js/one/api.js', ['./crypto.js']),
  'js/shared/sync/crypto.js': () => module_('js/sync/crypto.js'),
  'js/shared/share/crypto.js': () => module_('js/share/crypto.js'),
};

// ---------------------------------------------------------------- byte-identical copies: [target in one/, source in repo]
const COPIES = [
  ['css/fale-tokens.css', 'network/assets/fale-tokens.css'],
  ['vendor/fonts/BricolageGrotesque-Bold.woff', 'vendor/fonts/bricolage-grotesque/BricolageGrotesque-Bold.woff'],
  ['vendor/fonts/OFL.txt', 'vendor/fonts/bricolage-grotesque/OFL.txt'],
  ['vendor/dompurify/purify.min.js', 'vendor/dompurify/purify.min.js'],
  ['vendor/dompurify/LICENSE', 'vendor/dompurify/LICENSE'],
  ['vendor/dompurify/LICENSE-MPL', 'vendor/dompurify/LICENSE-MPL'],
  ['vendor/pdfjs/LICENSE', 'vendor/pdfjs/LICENSE'],
  ['vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.min.mjs'],
  ['vendor/pdfjs/pdf.worker.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs'],
];
function addDir(srcDir, dstDir, filter = () => true) {
  for (const p of walk(join(ROOT, srcDir)).sort()) {
    const r = rel(join(ROOT, srcDir), p);
    if (filter(r)) COPIES.push([`${dstDir}/${r}`, `${srcDir}/${r}`]);
  }
}
// pdf.js: character maps, standard fonts, ICC profiles and the pure-JS image decoders. The app runs
// pdf.js with useWasm: false, so the CSP needs no 'wasm-unsafe-eval'; no PDF JavaScript sandbox (quickjs).
addDir('vendor/pdfjs/cmaps', 'vendor/pdfjs/cmaps');
addDir('vendor/pdfjs/standard_fonts', 'vendor/pdfjs/standard_fonts');
addDir('vendor/pdfjs/iccs', 'vendor/pdfjs/iccs');
addDir('vendor/pdfjs/wasm', 'vendor/pdfjs/wasm', r => /nowasm_fallback\.js$|^LICENSE/.test(r));

// ---------------------------------------------------------------- expected state
const expected = new Map(); // path relative to one/ → Buffer
for (const [dst, make] of Object.entries(SHARED)) expected.set(dst, make());
for (const [dst, src] of COPIES) expected.set(dst, readFileSync(join(ROOT, src)));
// every shared module must still load as an ES module (relative imports stubbed)
for (const [p, buf] of expected) {
  if (!p.startsWith('js/shared/')) continue;
  const probe = buf.toString('utf8').replace(/^import\s+\*\s+as\s+(\w+)\s+from\s*['"]\.\/[^'"]+['"];?/gm, 'const $1 = {};');
  try { await import('data:text/javascript;base64,' + Buffer.from(probe).toString('base64')); }
  catch (e) { console.error(`one/${p}: does not load as an ES module (${e.message})`); process.exit(1); }
}
const rootManifest = JSON.parse(readFileSync(join(ROOT, 'vendor', 'MANIFEST.json'), 'utf8'));
const vendorManifest = {
  comment: 'GENERATED by scripts/sync-one-shared.mjs – copies of vendor/, js/ and network/assets/ for FaLe One. Check: node scripts/sync-one-shared.mjs --check',
  libraries: Object.fromEntries(['pdfjs', 'dompurify', 'fonts'].filter(k => rootManifest.libraries[k]).map(k => [k, rootManifest.libraries[k]])),
  files: Object.fromEntries([...expected.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, buf]) => [p, sha256(buf)])),
};
expected.set('vendor/MANIFEST.json', Buffer.from(JSON.stringify(vendorManifest, null, 2) + '\n', 'utf8'));

// ---------------------------------------------------------------- service worker precache list
// Everything the app shell needs offline. Not precached (cached on first use instead): pdf.js resources that
// only some PDFs need. Never cached at all: anything from the API (personal data) – see one/sw.js.
const NOT_SHELL = r => r === 'sw.js' || r === 'vercel.json' || r === 'README.md' || r === '.vercelignore' || r === 'vendor/MANIFEST.json'
  || /^vendor\/pdfjs\/(cmaps|standard_fonts|iccs|wasm)\//.test(r) || /(^|\/)LICENSE[^/]*$|OFL\.txt$/.test(r) || r.startsWith('.');
function shellFiles() {
  const onDisk = existsSync(ONE) ? walk(ONE).map(p => rel(ONE, p)) : [];
  const all = new Set([...onDisk.filter(r => !r.startsWith('js/shared/') && !r.startsWith('vendor/') && r !== 'css/fale-tokens.css'), ...expected.keys()]);
  return [...all].filter(r => !NOT_SHELL(r)).sort();
}
function swText(current) {
  const files = shellFiles();
  const h = createHash('sha256');
  for (const r of files) { h.update(r); h.update(expected.get(r) || readFileSync(join(ONE, r))); }
  const ver = h.digest('hex').slice(0, 10);
  const list = ['./', ...files.map(r => './' + r)];
  let sw = current.replace(/(\/\/ ASSETS-START[^\n]*\n)[\s\S]*?(\n\/\/ ASSETS-END)/, (_, a, b) => a + 'const ASSETS = ' + JSON.stringify(list, null, 2) + ';' + b);
  sw = sw.replace(/const VERSION = '[^']*';/, `const VERSION = 'one-${ver}';`);
  return sw;
}

const managedDirs = [join(ONE, 'js', 'shared'), join(ONE, 'vendor')];
const actualFiles = managedDirs.filter(existsSync).flatMap(d => walk(d)).map(p => rel(ONE, p));
const swPath = join(ONE, 'sw.js');

if (CHECK) {
  const problems = [];
  for (const [p, buf] of expected) {
    const abs = join(ONE, p);
    if (!existsSync(abs)) problems.push(`missing: one/${p}`);
    else if (!readFileSync(abs).equals(buf)) problems.push(`differs: one/${p}`);
  }
  for (const p of actualFiles) if (!expected.has(p)) problems.push(`unexpected: one/${p}`);
  if (!existsSync(swPath)) problems.push('missing: one/sw.js');
  else { const cur = readFileSync(swPath, 'utf8'); if (swText(cur) !== cur) problems.push('stale: one/sw.js precache list / version'); }
  if (problems.length) {
    console.error(`one/ is out of sync (${problems.length}):\n  ` + problems.slice(0, 40).join('\n  ') + '\nRun: node scripts/sync-one-shared.mjs');
    process.exit(1);
  }
  console.log(`one/ shared files in sync (${expected.size} files, precache list current)`);
} else {
  for (const p of actualFiles) if (!expected.has(p)) rmSync(join(ONE, p));
  let changed = 0;
  for (const [p, buf] of expected) {
    const abs = join(ONE, p);
    if (existsSync(abs) && readFileSync(abs).equals(buf)) continue;
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, buf);
    changed++;
  }
  if (existsSync(swPath)) {
    const cur = readFileSync(swPath, 'utf8');
    const next = swText(cur);
    if (next !== cur) { writeFileSync(swPath, next); changed++; }
  }
  console.log(`synced ${expected.size} files into one/ (${changed} written)`);
}
