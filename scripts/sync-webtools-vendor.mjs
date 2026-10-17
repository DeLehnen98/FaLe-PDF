// Copies the third-party files and reusable app modules that the FaLe Werkzeuge (network/assets/wt/)
// need from the app's vendor/ and js/ folders into the network site, which is deployed on its own
// (Vercel project "fale-network", root directory network/, no build step).
//
//   node scripts/sync-webtools-vendor.mjs           → copy + write network/assets/wt/vendor/MANIFEST.json
//   node scripts/sync-webtools-vendor.mjs --check   → exit 1 when the copies differ from their sources
//                                                     (or files are missing / unexpected); used in CI
//
// Only import-free app modules are copied as they are. Modules with imports are not copied; where a
// small, self-contained part is useful, an adapter extracts exactly that part (see SHARED below) and
// fails loudly if the source no longer has the expected shape. tesseract (OCR, ~10 MB) is synced only for
// the OCR tools (ocr-pdf, image-to-text): never precached by the service worker, loaded lazily on those
// pages and cached on first use (vendor cache).
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WT = join(ROOT, 'network', 'assets', 'wt');
const CHECK = process.argv.includes('--check');

const walk = dir => readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const rel = (from, p) => relative(from, p).split(sep).join('/');
const sha256 = buf => createHash('sha256').update(buf).digest('hex');

// ---------------------------------------------------------------- vendor files: [target in wt/vendor, source in repo vendor/]
const VENDOR = [];
function addDir(srcDir, dstDir, filter = () => true) {
  for (const p of walk(join(ROOT, 'vendor', srcDir)).sort()) {
    const r = rel(join(ROOT, 'vendor', srcDir), p);
    if (filter(r)) VENDOR.push([`${dstDir}/${r}`, `vendor/${srcDir}/${r}`]);
  }
}
// pdf.js: the core + worker, character maps, standard fonts, ICC profile and the wasm decoders.
// Not copied: the viewer component, its CSS/images, the PDF-JavaScript sandbox (quickjs) and the
// non-wasm fallbacks (the tool pages allow 'wasm-unsafe-eval').
for (const f of ['LICENSE', 'pdf.min.mjs', 'pdf.worker.min.mjs']) VENDOR.push([`pdfjs/${f}`, `vendor/pdfjs/${f}`]);
addDir('pdfjs/cmaps', 'pdfjs/cmaps');
addDir('pdfjs/standard_fonts', 'pdfjs/standard_fonts');
addDir('pdfjs/iccs', 'pdfjs/iccs');
addDir('pdfjs/wasm', 'pdfjs/wasm', r => !/quickjs|nowasm_fallback/.test(r));
for (const f of ['pdf-lib.min.js', 'LICENSE.md', 'THIRD_PARTY_LICENSES.txt']) VENDOR.push([`pdf-lib/${f}`, `vendor/pdf-lib/${f}`]);
for (const f of ['jszip.min.js', 'LICENSE.markdown']) VENDOR.push([`jszip/${f}`, `vendor/jszip/${f}`]);
for (const f of ['BricolageGrotesque-Bold.woff', 'OFL.txt']) VENDOR.push([`fonts/${f}`, `vendor/fonts/bricolage-grotesque/${f}`]);
// Word/PowerPoint writers for the conversion tools (pdf-to-word, pdf-to-pptx); loaded as classic scripts on demand
for (const f of ['docx.iife.js', 'LICENSE']) VENDOR.push([`docx/${f}`, `vendor/docx/${f}`]);
for (const f of ['pptxgen.bundle.js', 'LICENSE']) VENDOR.push([`pptxgenjs/${f}`, `vendor/pptxgenjs/${f}`]);
// OCR (ocr-pdf, image-to-text): tesseract.js + worker, the single-file cores (wasm embedded, so the separate
// .wasm files are not needed) and the deu/eng language data
for (const f of ['tesseract.min.js', 'worker.min.js', 'LICENSE.md', 'VERSIONS.json']) VENDOR.push([`tesseract/${f}`, `vendor/tesseract/${f}`]);
addDir('tesseract/core', 'tesseract/core', r => !/\.wasm$/.test(r));
addDir('tesseract/lang', 'tesseract/lang');
// Background removal (remove-background, ~22 MB): onnxruntime-web WASM build + U²-Netp / MODNet models. Like
// tesseract: never precached, loaded lazily on that page only and cached on first use (vendor cache).
if (existsSync(join(ROOT, 'vendor', 'onnx'))) addDir('onnx', 'onnx');

// ---------------------------------------------------------------- shared app modules → wt/lib/shared/
const banner = (src, how) => `// GENERATED – synced copy of ${src}${how ? ` (${how})` : ''} by scripts/sync-webtools-vendor.mjs.\n// Do not edit here: change the source in the app and run \`node scripts/sync-webtools-vendor.mjs\`.\n`;

function importFree(src) {
  const text = readFileSync(join(ROOT, src), 'utf8');
  // dynamic import of a sibling that is synced as well is fine (scanproc → imgproc)
  const imports = [...text.matchAll(/^\s*import\s.*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm)].map(m => m[1] || m[2]);
  return { text, imports };
}

function copyModule(src, allowed = []) {
  const { text, imports } = importFree(src);
  const bad = imports.filter(i => !allowed.includes(i));
  if (bad.length) throw new Error(`${src} now imports ${bad.join(', ')} – it can no longer be synced as is (write an adapter)`);
  return banner(src) + text;
}

/** Extract the leading part of a module up to (not including) a marker line. */
function extractHead(src, endMarker, what) {
  const text = readFileSync(join(ROOT, src), 'utf8');
  const end = text.indexOf(endMarker);
  if (end < 0) throw new Error(`${src}: marker "${endMarker}" not found – update the adapter in sync-webtools-vendor.mjs`);
  const part = text.slice(0, end).trimEnd() + '\n';
  if (/^\s*import\s|import\(/m.test(part)) throw new Error(`${src}: extracted part (${what}) contains imports`);
  return banner(src, what) + part;
}

/** Extract named top-level blocks (export const/function … up to the next top-level statement). */
function extractBlocks(src, starts, what) {
  const text = readFileSync(join(ROOT, src), 'utf8');
  const lines = text.split('\n');
  const out = [];
  for (const start of starts) {
    const i = lines.findIndex(l => l.startsWith(start));
    if (i < 0) throw new Error(`${src}: "${start}" not found – update the adapter in sync-webtools-vendor.mjs`);
    let j = i + 1;
    while (j < lines.length && !/^(\]|\});?\s*$/.test(lines[j])) j++;
    const comment = [];
    for (let k = i - 1; k >= 0 && /^\s*(\/\/|\/\*\*|\*)/.test(lines[k]); k--) comment.unshift(lines[k]);
    out.push([...comment, ...lines.slice(i, j + 1)].join('\n'));
  }
  const part = out.join('\n\n') + '\n';
  if (/^\s*import\s|import\(/m.test(part)) throw new Error(`${src}: extracted part (${what}) contains imports`);
  return banner(src, what) + part;
}

/** js/tools/pagegeom.js takes pdf.js from the app's pdfcore.js – here the tool hands it in via setPdfjs(). */
function pagegeomModule() {
  const src = 'js/tools/pagegeom.js';
  const text = readFileSync(join(ROOT, src), 'utf8');
  const imp = "import { pdfjsLib } from '../pdfcore.js';";
  if (!text.includes(imp)) throw new Error(`${src}: expected import "${imp}" not found – update the adapter in sync-webtools-vendor.mjs`);
  const out = text.replace(imp, 'let pdfjsLib = null;\n/** Hand in the pdf.js module (lib/pdf.js loadPdfjs()) before calling pageShapes(). */\nexport function setPdfjs(lib) { pdfjsLib = lib; }');
  if (/^\s*import\s|import\(/m.test(out)) throw new Error(`${src} now has other imports – update the adapter`);
  return banner(src, 'pdf.js handed in via setPdfjs()') + out;
}
const SHARED = {
  'pdfcrypt.js': () => copyModule('js/pdfcrypt.js'),
  'zip.js': () => copyModule('js/zip.js'),
  'pdflibtune.js': () => copyModule('js/pdflibtune.js'),   // pdf-lib: time-based pauses while saving, one font name per page
  'imgproc.js': () => copyModule('js/tools/imgproc.js'),
  'scanproc.js': () => copyModule('js/tools/scanproc.js', ['./imgproc.js']),
  'imgworker.js': () => copyModule('js/tools/imgworker.js', ['./imgproc.js']),   // runOp() worker (otherwise it falls back to the main thread)
  'qr.js': () => copyModule('js/tools/qr.js'),
  'limits.js': () => extractHead('js/security.js', 'export const SAFE_SCHEMES', 'resource limits and image header probing only'),
  'passphoto-templates.js': () => extractBlocks('js/tools/passphoto.js', ['export const TEMPLATES', 'export function sheetLayout'], 'TEMPLATES + sheetLayout only'),
  'pdfstruct.js': () => copyModule('js/tools/pdfstruct.js'),
  // PDF forms (create-pdf-form): field detection + AcroForm writer, and the page geometry it uses for boxes/lines
  'formfields.js': () => copyModule('js/tools/formfields.js'),
  'pagegeom.js': () => pagegeomModule(),
  // bookmarks (edit-bookmarks): read / derive from headings / write the outline – uses pdfstruct.js above
  'outlinecore.js': () => copyModule('js/tools/outlinecore.js', ['./pdfstruct.js']),
  // PDF → PowerPoint without freezing (real pictures go into the ZIP after pptxgenjs wrote it)
  'pptximg.js': () => copyModule('js/tools/pptximg.js'),   // PDF text layout analysis (pdf-to-word, pdf-to-text)
  // OCR image pre-processing (ocr-pdf, image-to-text): pure functions + their module worker
  'ocr/prep.js': () => copyModule('js/ocr/prep.js'),
  'ocr/prep-worker.js': () => copyModule('js/ocr/prep-worker.js', ['./prep.js']),
  // business cards (business-card): field parser + vCard writer
  'ocr/bizcard-parse.js': () => copyModule('js/ocr/bizcard-parse.js'),
};

// ---------------------------------------------------------------- office modules → wt/lib/shared/office/
// The conversion tools (Word/Excel/PowerPoint → PDF, PDF → Word/Markdown) reuse the app's document
// readers, document model and PDF/DOCX writers unchanged. Their few app-level imports (ui.js,
// security.js, pdflib.js, icons.js) are redirected to the hand-written lib/conv-office-shim.js, the
// vendor paths are re-based; any other import that is not a synced sibling fails the sync.
const OFFICE = ['vendor.js', 'hfnorm.js', 'fonts.js', 'docstyles.js', 'docmodel.js', 'docx-read.js', 'docx-write.js', 'docpdf.js', 'pdftext.js',
  'workbook.js', 'formula.js', 'numfmt.js', 'sheetfx.js', 'xlsx-read.js', 'sheetpdf.js', 'chart.js', 'chart-xml.js', 'kinds.js',
  'pptx-read.js', 'slide-render.js', 'unifont.js',
  // spreadsheet templates of the Vorlagen-Archiv (/vorlagen/tabellen/): template data + builder, XLSX and CSV writers
  'sheet-templates.js', 'xlsx-write.js', 'csv.js'];
function officeModule(name) {
  let text = readFileSync(join(ROOT, 'js/office', name), 'utf8');
  text = text.replace(/(from\s*|import\(\s*)(['"])\.\.\/(ui|security|pdflib|icons)\.js\2/g, (m, pre, q) => `${pre}${q}../../conv-office-shim.js${q}`);
  text = text.replace(/(['"])\.\.\/\.\.\/vendor\//g, '$1../../../vendor/');
  const specs = [...text.matchAll(/^\s*import\s[\s\S]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm)].map(m => m[1] || m[2]);
  const bad = specs.filter(s => s !== '../../conv-office-shim.js' && !OFFICE.includes(s.replace(/^\.\//, '')));
  if (bad.length) throw new Error(`js/office/${name} now imports ${bad.join(', ')} – add it to OFFICE or to lib/conv-office-shim.js`);
  return banner(`js/office/${name}`, 'app imports → lib/conv-office-shim.js, vendor paths re-based') + text;
}

// ---------------------------------------------------------------- expected state
const expected = new Map(); // path relative to wt/ → Buffer
const sources = {};
for (const [dst, src] of VENDOR) { expected.set(`vendor/${dst}`, readFileSync(join(ROOT, src))); sources[`vendor/${dst}`] = src; }
for (const [name, make] of Object.entries(SHARED)) {
  expected.set(`lib/shared/${name}`, Buffer.from(make(), 'utf8'));
  sources[`lib/shared/${name}`] = 'adapter: ' + name;
}
for (const name of OFFICE) { expected.set(`lib/shared/office/${name}`, Buffer.from(officeModule(name), 'utf8')); sources[`lib/shared/office/${name}`] = `js/office/${name}`; }
{ // office modules import each other: syntax-check them with node --check instead of the import probe below
  const { mkdtempSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const tmp = mkdtempSync(join((await import('node:os')).tmpdir(), 'wt-office-'));
  try {
    for (const name of OFFICE) {
      const f = join(tmp, name.replace(/\.js$/, '.mjs'));
      writeFileSync(f, expected.get(`lib/shared/office/${name}`));
      try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
      catch (e) { console.error(`lib/shared/office/${name}: syntax error\n${e.stderr}`); process.exit(1); }
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
// every shared module must still parse as an ES module on its own (catches a broken extraction)
for (const [p, buf] of expected) {
  if (!p.startsWith('lib/shared/') || p.startsWith('lib/shared/office/')) continue;
  const src = buf.toString('utf8').replace(/import\(\s*['"]\.\/[^'"]+['"]\s*\)/g, 'Promise.resolve({})')
    .replace(/^import\s*\{([^}]*)\}\s*from\s*['"]\.\/[^'"]+['"];?/gm, 'const {$1} = {};'); // static import of a synced sibling (imgworker → imgproc)
  const probe = (/^\s*self\./m.test(src) ? 'const self = {};\n' : '') + src; // worker modules assign self.onmessage
  try { await import('data:text/javascript;base64,' + Buffer.from(probe).toString('base64')); }
  catch (e) { console.error(`${p}: does not load as an ES module (${e.message})`); process.exit(1); }
}
const rootManifest = JSON.parse(readFileSync(join(ROOT, 'vendor', 'MANIFEST.json'), 'utf8'));
const manifest = {
  comment: 'GENERATED by scripts/sync-webtools-vendor.mjs – copies of vendor/ and js/ for the FaLe Werkzeuge. Check: node scripts/sync-webtools-vendor.mjs --check',
  libraries: Object.fromEntries(['pdfjs', 'pdf-lib', 'jszip', 'docx', 'pptxgenjs', 'tesseract', 'fonts', 'onnx'].filter(k => rootManifest.libraries[k]).map(k => [k, rootManifest.libraries[k]])),
  files: Object.fromEntries([...expected.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, buf]) => [p, sha256(buf)])),
};
const manifestText = JSON.stringify(manifest, null, 2) + '\n';
expected.set('vendor/MANIFEST.json', Buffer.from(manifestText, 'utf8'));

const managedDirs = [join(WT, 'vendor'), join(WT, 'lib', 'shared')];
const actualFiles = managedDirs.filter(existsSync).flatMap(d => walk(d)).map(p => rel(WT, p));

if (CHECK) {
  const problems = [];
  for (const [p, buf] of expected) {
    const abs = join(WT, p);
    if (!existsSync(abs)) problems.push(`missing: ${p}`);
    else if (!readFileSync(abs).equals(buf)) problems.push(`differs: ${p}`);
  }
  for (const p of actualFiles) if (!expected.has(p)) problems.push(`unexpected: ${p}`);
  // offline: every synced office module imported by a module in lib/sw.js's "office" warm-up list must be listed too
  // (otherwise the conversion tools break offline the first time the app adds a new import)
  const swSrc = readFileSync(join(WT, 'lib', 'sw.js'), 'utf8');
  const officeList = (swSrc.match(/office:\s*\[([\s\S]*?)\]/) || [, ''])[1];
  const listed = new Set([...officeList.matchAll(/lib\/shared\/office\/([\w.-]+\.js)/g)].map(m => m[1]));
  for (const name of listed) {
    const abs = join(WT, 'lib', 'shared', 'office', name);
    if (!existsSync(abs)) continue;
    for (const m of readFileSync(abs, 'utf8').matchAll(/(?:from|import\()\s*['"]\.\/([\w.-]+\.js)['"]/g)) {
      if (!listed.has(m[1])) problems.push(`offline list lib/sw.js (office) misses lib/shared/office/${m[1]} (imported by ${name})`);
    }
  }
  if (problems.length) {
    console.error(`network/assets/wt is out of sync with vendor/ and js/ (${problems.length}):\n  ` + problems.slice(0, 40).join('\n  ') +
      (problems.length > 40 ? `\n  … and ${problems.length - 40} more` : '') + '\nRun: node scripts/sync-webtools-vendor.mjs');
    process.exit(1);
  }
  console.log(`webtools vendor in sync (${expected.size} files)`);
} else {
  for (const p of actualFiles) if (!expected.has(p)) rmSync(join(WT, p));
  let changed = 0;
  for (const [p, buf] of expected) {
    const abs = join(WT, p);
    if (existsSync(abs) && readFileSync(abs).equals(buf)) continue;
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, buf);
    changed++;
  }
  console.log(`synced ${expected.size} files into network/assets/wt (${changed} written)`);
}
