// Supply-chain check for the checked-in third-party code in vendor/.
// vendor/MANIFEST.json records the version + source of every library and the SHA-256 of every file.
// The build (scripts/vercel-build.mjs) refuses to ship a vendor/ folder that differs from the manifest,
// so a tampered or silently swapped library file fails the deploy instead of reaching users.
//
//   node scripts/vendor-manifest.mjs              → verify (exit 1 on any difference)
//   node scripts/vendor-manifest.mjs --write      → (re)write the whole manifest after a reviewed update
//   node scripts/vendor-manifest.mjs --write tesseract
//                                                  → only refresh vendor/tesseract/ (used by vendor-ocr.yml)
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = 'MANIFEST.json';

// Library metadata (version, upstream, licence). Versions of npm packages must match package.json.
const LIBS = {
  pdfjs: { name: 'pdfjs-dist (legacy build)', npm: 'pdfjs-dist', license: 'Apache-2.0', source: 'https://www.npmjs.com/package/pdfjs-dist',
    note: 'CVE-2024-4367 (FontMatrix eval) fixed in 4.2.67; this version is not affected and isEvalSupported=false is set anyway' },
  'pdf-lib': { name: 'pdf-lib', npm: 'pdf-lib', license: 'MIT', source: 'https://www.npmjs.com/package/pdf-lib' },
  jszip: { name: 'JSZip', npm: 'jszip', license: 'MIT OR GPL-3.0', source: 'https://www.npmjs.com/package/jszip' },
  docx: { name: 'docx', npm: 'docx', license: 'MIT', source: 'https://www.npmjs.com/package/docx' },
  pptxgenjs: { name: 'PptxGenJS', npm: 'pptxgenjs', license: 'MIT', source: 'https://www.npmjs.com/package/pptxgenjs' },
  dompurify: { name: 'DOMPurify', version: '3.4.14', license: 'MPL-2.0 OR Apache-2.0', source: 'https://www.npmjs.com/package/dompurify' },
  tesseract: { name: 'tesseract.js + tesseract.js-core + tessdata_fast (deu, eng)', versionsFile: 'tesseract/VERSIONS.json', license: 'Apache-2.0', source: 'https://www.npmjs.com/package/tesseract.js' },
  fonts: { name: 'Bricolage Grotesque (Bold)', license: 'OFL-1.1', source: 'https://fonts.google.com/specimen/Bricolage+Grotesque' },
};

export function walk(dir) {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const sha256 = p => createHash('sha256').update(readFileSync(p)).digest('hex');

export function hashVendor(vendorDir) {
  const files = {};
  for (const p of walk(vendorDir).sort()) {
    const r = relative(vendorDir, p).split(sep).join('/');
    if (r === MANIFEST) continue;
    files[r] = sha256(p);
  }
  return files;
}

function libraries(root, vendorDir) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const deps = pkg.dependencies || {};
  const out = {};
  for (const [dir, meta] of Object.entries(LIBS)) {
    if (!existsSync(join(vendorDir, dir))) continue;
    const { npm, versionsFile, ...rest } = meta;
    let version = meta.version || (npm && deps[npm]) || null;
    if (versionsFile && existsSync(join(vendorDir, versionsFile))) version = JSON.parse(readFileSync(join(vendorDir, versionsFile), 'utf8'));
    out[dir] = { ...rest, version };
  }
  return out;
}

/** Compare vendor/ with vendor/MANIFEST.json. Returns a list of problems (empty = ok). */
export function verifyVendor(root = ROOT, vendorDir = join(root, 'vendor')) {
  const mp = join(vendorDir, MANIFEST);
  if (!existsSync(mp)) return ['vendor/' + MANIFEST + ' fehlt'];
  let m;
  try { m = JSON.parse(readFileSync(mp, 'utf8')); } catch (e) { return ['vendor/' + MANIFEST + ' ist kein gültiges JSON']; }
  const want = m.files || {}, have = hashVendor(vendorDir), problems = [];
  for (const [f, h] of Object.entries(want)) {
    if (!(f in have)) problems.push('fehlt: vendor/' + f);
    else if (have[f] !== h) problems.push('SHA-256 abweichend: vendor/' + f);
  }
  for (const f of Object.keys(have)) if (!(f in want)) problems.push('nicht im Manifest: vendor/' + f);
  // npm-based libraries must carry the version pinned in package.json
  const libs = libraries(root, vendorDir);
  for (const [dir, lib] of Object.entries(m.libraries || {})) {
    const cur = libs[dir];
    if (cur && JSON.stringify(cur.version) !== JSON.stringify(lib.version)) problems.push(`Version ${dir}: Manifest ${JSON.stringify(lib.version)} ≠ ${JSON.stringify(cur.version)}`);
  }
  return problems;
}

function write(root, only) {
  const vendorDir = join(root, 'vendor'), mp = join(vendorDir, MANIFEST);
  const old = existsSync(mp) ? JSON.parse(readFileSync(mp, 'utf8')) : { files: {} };
  const all = hashVendor(vendorDir);
  let files = all;
  if (only) {
    files = {};
    for (const [f, h] of Object.entries(old.files || {})) if (!f.startsWith(only + '/')) files[f] = h;
    for (const [f, h] of Object.entries(all)) if (f.startsWith(only + '/')) files[f] = h;
    files = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  }
  const out = {
    comment: 'Checked-in third-party code. Verified by scripts/vendor-manifest.mjs during every build – update only after reviewing the new upstream release.',
    libraries: libraries(root, vendorDir),
    files,
  };
  writeFileSync(mp, JSON.stringify(out, null, 2) + '\n');
  console.log(`vendor/${MANIFEST}: ${Object.keys(files).length} Dateien`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const i = process.argv.indexOf('--write');
  if (i >= 0) write(ROOT, process.argv[i + 1] && !process.argv[i + 1].startsWith('-') ? process.argv[i + 1].replace(/\/+$/, '') : null);
  else {
    const p = verifyVendor();
    if (p.length) { console.error('Vendor-Prüfung fehlgeschlagen:\n  ' + p.slice(0, 50).join('\n  ')); process.exit(1); }
    console.log('vendor/ stimmt mit MANIFEST.json überein');
  }
}
