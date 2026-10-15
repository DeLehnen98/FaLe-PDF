#!/usr/bin/env node
// FaLe PDF – i18n extractor.
// Scans js/**/*.js and *.html for German UI strings and reports the ones js/i18n/en.js does not cover.
//
//   node scripts/i18n-extract.mjs            summary + list of missing strings (file:line  text)
//   node scripts/i18n-extract.mjs --json     machine-readable { total, covered, missing: [{key, file, line}] }
//   node scripts/i18n-extract.mjs --all      list every German string found (not only missing ones)
//   node scripts/i18n-extract.mjs --keys     only the missing keys, one per line (for translating)
//
// How strings are found:
//   - every string/template literal is lexed; template ${…} expressions become {0}, {1} … placeholders,
//     except expressions that render HTML (icons, nested templates with tags) which split the text like tags
//   - literals containing HTML are split into text segments + translatable attributes
//     (placeholder, title, aria-label, alt, data-tooltip, value of buttons)
//   - a segment counts as German UI text by a heuristic (umlauts, German stop words, capitalised words …)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
process.removeAllListeners('warning'); // core.js is an ES module in a package without "type" (browser code)
const args = new Set(process.argv.slice(2));

// Files / folders that never contain UI text (vendor code, the dictionary itself, workers without UI).
const SKIP_PATHS = [/^js\/i18n\//, /^vendor/, /^node_modules/, /^dist/, /^android/, /^api\//, /^supabase\//, /^scripts\//];
// HTML pages handled by their own bilingual sections (legal pages) – not runtime-translated.
const SKIP_HTML = new Set(['datenschutz.html', 'impressum.html', 'info.html', 'info-en.html']);
// Generated document content that stays German on purpose (German letters, DIN 5008, legal templates).
// Strings from these places are still listed with --all but not counted as missing.
const CONTENT_FILES = new Set(['js/office/sheet-templates.js', 'js/office/doc-templates.js']); // spreadsheet template cells stay German (the gallery titles are translated in en.js)

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const p = join(dir, name);
    const rel = relative(ROOT, p).split('\\').join('/');
    if (SKIP_PATHS.some(re => re.test(rel))) continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.js$|\.mjs$/.test(name) && rel.startsWith('js/')) out.push(rel);
    else if (/\.html$/.test(name) && !rel.includes('/') && !SKIP_HTML.has(rel)) out.push(rel);
  }
  return out;
}

// ---------------------------------------------------------------- JS lexer
const KW_BEFORE_REGEX = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);

/** Lex a JS source; returns literals: {kind:'str'|'tpl', parts:[string], exprs:[string], line, ctx} */
export function lexJs(src) {
  const lits = [];
  let i = 0, line = 1;
  let prev = null; // previous significant token: {t:'id'|'punct'|'num'|'str', v}
  const n = src.length;
  const lineAt = pos => { let l = 1; for (let k = 0; k < pos; k++) if (src.charCodeAt(k) === 10) l++; return l; };
  const ctxBefore = pos => src.slice(Math.max(0, pos - 40), pos).replace(/\s+/g, ' ');

  function readString(q) {
    const start = i; i++;
    let s = '';
    while (i < n && src[i] !== q) {
      if (src[i] === '\\') { s += unescape(src[i + 1]); i += 2; continue; }
      if (src[i] === '\n') break;
      s += src[i++];
    }
    i++;
    return { s, start };
  }
  function unescape(c) { return ({ n: '\n', t: '\t', r: '', '\\': '\\', "'": "'", '"': '"', '`': '`', $: '$' })[c] ?? c; }

  function readTemplate() {
    const start = i; i++;
    const parts = []; const exprs = [];
    let s = '';
    while (i < n) {
      const c = src[i];
      if (c === '\\') { s += unescape(src[i + 1]); i += 2; continue; }
      if (c === '`') { i++; break; }
      if (c === '$' && src[i + 1] === '{') {
        parts.push(s); s = '';
        i += 2;
        const es = i;
        lexUntilBrace();
        exprs.push(src.slice(es, i));
        i++; // skip }
        continue;
      }
      s += c; i++;
    }
    parts.push(s);
    return { parts, exprs, start };
  }

  function readRegex() {
    i++;
    let inClass = false;
    while (i < n) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) { i++; break; }
      else if (c === '\n') break;
      i++;
    }
    while (i < n && /[a-z]/i.test(src[i])) i++;
  }

  function regexAllowed() {
    if (!prev) return true;
    if (prev.t === 'num' || prev.t === 'str') return false;
    if (prev.t === 'id') return KW_BEFORE_REGEX.has(prev.v);
    if (prev.t === 'punct') return !/^[)\]}]$/.test(prev.v);
    return true;
  }

  // lex tokens until an unmatched '}' (used for template expressions) or EOF
  function lexUntilBrace() {
    let depth = 0;
    while (i < n) {
      const c = src[i];
      if (c === '}' && depth === 0) return;
      step(c, d => { depth += d; });
    }
  }

  function step(c, onBrace) {
    if (c === '\n') { i++; return; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; return; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; return; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; return; }
    if (c === "'" || c === '"') {
      const { s, start } = readString(c);
      lits.push({ kind: 'str', parts: [s], exprs: [], pos: start, ctx: ctxBefore(start) });
      prev = { t: 'str' };
      return;
    }
    if (c === '`') {
      const savePrev = prev;
      const { parts, exprs, start } = readTemplate();
      lits.push({ kind: 'tpl', parts, exprs, pos: start, ctx: ctxBefore(start) });
      void savePrev;
      prev = { t: 'str' };
      return;
    }
    if (c === '/') {
      if (regexAllowed()) { readRegex(); prev = { t: 'str' }; return; }
      i++; prev = { t: 'punct', v: '/' }; return;
    }
    if (/[A-Za-z_$\u00c0-\u024f]/.test(c)) {
      const s = i; while (i < n && /[\w$\u00c0-\u024f]/.test(src[i])) i++;
      prev = { t: 'id', v: src.slice(s, i) }; return;
    }
    if (/[0-9]/.test(c)) { while (i < n && /[\w.]/.test(src[i])) i++; prev = { t: 'num' }; return; }
    if (c === '{') { onBrace && onBrace(1); }
    if (c === '}') { onBrace && onBrace(-1); }
    i++;
    prev = { t: 'punct', v: c };
  }

  while (i < n) step(src[i]);
  // line numbers (computed lazily in one pass)
  const nl = [];
  for (let k = 0; k < n; k++) if (src.charCodeAt(k) === 10) nl.push(k);
  for (const l of lits) { let lo = 0, hi = nl.length; while (lo < hi) { const m = (lo + hi) >> 1; if (nl[m] < l.pos) lo = m + 1; else hi = m; } l.line = lo + 1; }
  void line; void lineAt;
  return lits;
}

// ---------------------------------------------------------------- segmenting
const HTML_EXPR = /^\s*(o?icon|logo|ic|svg|thumbHtml|fileThumb|kbd|badge)\s*\(|<[a-z/]|^\s*\w+(Html|Badge|Icon|Chip|Pill)\b|^\s*\w+\.map\(/i;
const TR_ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'data-tooltip', 'value', 'data-label', 'data-empty', 'data-placeholder', 'aria-description', 'data-toc-title'];
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ', shy: '', hellip: '…', ndash: '–', mdash: '—', bdquo: '„', ldquo: '“', rdquo: '”', times: '×', middot: '·', rarr: '→', larr: '←', check: '✓', euro: '€', copy: '©', apos: "'" };
const decode = s => s.replace(/&(#?\w+);/g, (m, e) => (ENT[e] ?? (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : m)));

/** Turn a literal into candidate UI segments. */
export function segmentsOf(lit) {
  // Join parts; HTML-like expressions become a tag boundary marker, others {n}
  let text = '';
  lit.parts.forEach((p, k) => {
    text += p;
    if (k < lit.exprs.length) text += HTML_EXPR.test(lit.exprs[k]) ? '\u0002' : '\u0001';
  });
  const out = [];
  const isHtml = /<\/?[a-zA-Z][^>]*>|<[a-z]+[\s>]/.test(text);
  if (!isHtml) {
    for (const seg of text.split('\u0002')) out.push(seg);
  } else {
    // split into tags and text
    const re = /<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>/g;
    let last = 0, m;
    let inSkip = 0;
    while ((m = re.exec(text))) {
      if (!inSkip) for (const seg of text.slice(last, m.index).split('\u0002')) out.push(seg);
      const tag = m[0];
      if (/^<(style|script)\b/i.test(tag)) inSkip++;
      if (/^<\/(style|script)\b/i.test(tag)) inSkip = Math.max(0, inSkip - 1);
      const isBtnInput = /^<input\b/i.test(tag) && /type="(button|submit|reset)"/i.test(tag);
      for (const a of TR_ATTRS) {
        if (a === 'value' && !isBtnInput && !/^<(option|button)\b/i.test(tag)) continue;
        if (a === 'value' && /^<(option|button)\b/i.test(tag)) continue;
        const am = new RegExp(`\\s${a}="([^"]*)"`, 'i').exec(tag);
        if (am) out.push(am[1]);
      }
      last = re.lastIndex;
    }
    if (!inSkip) for (const seg of text.slice(last).split('\u0002')) out.push(seg);
  }
  const res = [];
  for (let seg of out) {
    seg = decode(seg).replace(/[\s\u00a0]+/g, ' ').trim();
    // renumber placeholders inside this segment
    let k = 0;
    seg = seg.replace(/\u0001/g, () => `{${k++}}`).replace(/\u0002/g, ' ').trim();
    // strip leading/trailing placeholders that are separated by whitespace? keep – numbers are text.
    if (seg) res.push(seg);
  }
  return res;
}

// ---------------------------------------------------------------- German heuristic
const STOP = new Set(('und oder nicht kein keine keinen keiner der die das den dem des ein eine einen einem einer mit für von auf aus bei nach über unter vor zu zum zur im ins ist sind wird werden wurde wurden kann können konnte muss müssen soll alle alles noch nur auch schon hier dein deine deinen deiner deines dich dir du ihr sie es wir man wie was wo wann warum bitte jetzt neu neue neuen neues seite seiten datei dateien öffnen speichern abbrechen löschen schließen zurück weiter fertig erstellen hinzufügen entfernen bearbeiten einfügen ändern wählen auswählen teilen herunterladen hochladen drucken suchen gefunden fehler fehlgeschlagen erfolgreich gespeichert gelöscht ungültig bild bilder text seite als ohne mehr weniger sowie dass damit wenn dann diese dieser dieses ganze gesamte jede jeden jeder ja nein aus an am um bis seit gegen pro je sehr gut lange oben unten links rechts mitte groß klein hell dunkel').split(' '));
const UPPER_UI = new Set(['VERTRAULICH', 'ENTWURF', 'KOPIE', 'GENEHMIGT', 'BEZAHLT', 'ERLEDIGT', 'GEPRÜFT', 'ORIGINAL', 'ABGELEHNT', 'EILT', 'MUSTER', 'STORNIERT', 'GEBUCHT', 'ERHALTEN', 'INTERN', 'DRINGEND']);
const ENGLISH_OK = new Set(['PDF', 'OK', 'Auto', 'FaLe PDF', 'FaLe', 'Pro', 'Office', 'Word', 'Excel', 'PowerPoint', 'Markdown', 'CSV', 'QR', 'ZIP', 'PNG', 'JPG', 'JPEG', 'WebP', 'SVG', 'TXT', 'DOCX', 'XLSX', 'PPTX', 'Google Drive', 'OneDrive', 'Dropbox', 'Sepia', 'Code', 'Name', 'Start', 'Status', 'Layout', 'Logo', 'Design', 'Info', 'Filter', 'Format', 'Material', 'Normal', 'Standard', 'Zoom', 'Arial', 'Helvetica', 'Times', 'Courier', 'Hz', 'Fax', 'E-Mail', 'Tel', 'URL', 'IBAN', 'BIC', 'Server', 'Online', 'Offline', 'Upload', 'Download', 'Version', 'Modus', 'Light', 'Dark', 'A4', 'A5', 'A3', 'Letter', 'Legal', 'Mono', 'Serif', 'Sans', 'JavaScript', 'Android', 'iOS', 'Chrome', 'Safari', 'Firefox']);

export function looksGerman(s) {
  if (s.length < 2) return false;
  const letters = s.replace(/\{\d\}/g, '').match(/\p{L}/gu);
  if (!letters || letters.length < 2) return false;
  if (ENGLISH_OK.has(s)) return false;
  if (/^(z\. ?B\.|u\. ?a\.|Z\. ?B\.) /.test(s)) return true;                // "z. B. Muster GmbH" (examples)
  // code-ish
  if (/^[\w.-]+\.(js|css|html|mjs|png|svg|pdf|json|webmanifest|wasm|traineddata|gz|docx|xlsx|pptx|txt|md|csv|zip|jpg|jpeg)$/i.test(s)) return false;
  if (/^(https?:|mailto:|tel:|data:|blob:|#\/|\.\/|\.\.\/)/.test(s)) return false;
  if (/^[a-z][\w-]*$/.test(s)) return false;                        // ids, css classes, single lowercase words
  if (/^[a-z]+([A-Z][a-z0-9]+)+$/.test(s)) return false;             // camelCase
  if (/^[A-Z][a-z0-9]+([A-Z][a-z0-9]*)+$/.test(s)) return false;      // PascalCase identifiers
  if (/^[A-ZÄÖÜ0-9_]+(\(.*)?$/.test(s)) return UPPER_UI.has(s);      // formula names, constants (stamps are listed)
  if (/^[A-ZÄÖÜ]+\(/.test(s)) return false;                           // formula examples WENN(A1>0;…)
  if (/(sans-serif|monospace|serif)\s*$/.test(s)) return false;       // font stacks
  if (/^[\w-]+\/[\w.+-]+$/.test(s)) return false;                    // mime types
  if (/[{};]\s*$/.test(s.replace(/\{\d\}/g, '')) && /:/.test(s)) return false; // css
  if (/^[.#[]?[a-z][\w-]*(?:[.#[:\s>+~,][\w-="'\]\s:.()#[>+~,]*)?$/.test(s) && !/\s[a-zäöü]{3,}\s/.test(s)) return false; // selectors (same language as ([sep][chars]*)+ but linear – no catastrophic backtracking on long lowercase phrases)
  if (/^[\w-]+:\s*[^\s]/.test(s) && /;/.test(s)) return false;       // inline styles
  if (/^(M|m|L|l|C|c|Z|z|H|h|V|v)[\d\s.,-]/.test(s) && !/\p{L}{3,}/u.test(s.slice(1))) return false; // svg paths
  if (/^[\d\s.,:%×x*+\-–/()]*$/.test(s)) return false;
  if (/^[a-z][\w-]*(\s+[a-z][\w-]*)+$/.test(s) && !/[äöüß]/.test(s)) {
    // all-lowercase multi-word: class lists vs German phrases → need a stop word
    const ws = s.split(/\s+/);
    if (!ws.some(w => STOP.has(w))) return false;
    if (ws.every(w => /-/.test(w) || /^[a-z]+$/.test(w)) && ws.filter(w => STOP.has(w)).length < 2 && ws.length > 1 && ws.some(w => /-/.test(w))) return false;
  }
  if (/[äöüÄÖÜß„“]/.test(s) || /\bz\. ?B\./.test(s) || /\bu\. ?a\./.test(s)) return true;
  const words = s.toLowerCase().match(/\p{L}+/gu) || [];
  if (words.some(w => STOP.has(w))) return true;
  // Capitalised words (German nouns/labels): "Speichern", "Fertig", "Seite 3"
  if (/^[A-ZÄÖÜ][a-zäöüß]+/.test(s)) return true;
  // compounds like "KI-Assistent", "PDF-Dateien", "E-Mail-Adresse"
  if (/(^|\s)[A-ZÄÖÜ][\wäöüß]*-[A-ZÄÖÜ][a-zäöüß]{3,}/.test(s)) return true;
  // German noun somewhere in a phrase ("· {0} passende{1} Dateiname{2}")
  if (/\s/.test(s) && /(^|[\s(„"'{}0-9·–-])[A-ZÄÖÜ][a-zäöüß]{3,}/.test(s) && /\b[a-zäöüß]{3,}\b/.test(s.replace(/\{\d\}/g, ''))) return true;
  return false;
}

// ---------------------------------------------------------------- run
export function extract() {
  const files = walk(ROOT).sort();
  const found = new Map(); // key → [{file,line}]
  const add = (key, file, line) => {
    if (!found.has(key)) found.set(key, []);
    found.get(key).push({ file, line });
  };
  for (const file of files) {
    const src = readFileSync(join(ROOT, file), 'utf8');
    if (file.endsWith('.html')) {
      const lits = [{ kind: 'str', parts: [src.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, m => '\n'.repeat((m.match(/\n/g) || []).length))], exprs: [], line: 1 }];
      for (const seg of segmentsOf(lits[0])) if (looksGerman(seg)) add(seg, file, lineOf(src, seg));
      // <title>/<meta description>
      continue;
    }
    for (const lit of lexJs(src)) {
      if (/console\.(log|warn|error|info|debug)\s*\(\s*$/.test(lit.ctx)) continue;
      if (/(querySelector(All)?|\$\$?|closest|matches|getElementById|addEventListener|removeEventListener|dataset\.\w+\s*===?|setAttribute|getAttribute|removeAttribute|toggleAttribute|classList\.\w+|import|localStorage\.\w+|getSetting|setSetting|new RegExp|createElement|createElementNS)\s*\(\s*$/.test(lit.ctx)) continue;
      for (const seg of segmentsOf(lit)) if (looksGerman(seg)) add(seg, file, lit.line);
    }
  }
  return found;
}

function lineOf(src, seg) {
  const first = seg.split(/\s|\{/)[0];
  const idx = src.indexOf(first);
  return idx < 0 ? 1 : src.slice(0, idx).split('\n').length;
}

async function main() {
  const { createTranslator, normalize, plainKey, FORMAT_RULES } = await import(pathToFileURL(join(ROOT, 'js/i18n/core.js')).href);
  const enPath = join(ROOT, 'js/i18n/en.js');
  const dict = existsSync(enPath) ? (await import(pathToFileURL(enPath).href)).default : {};
  const tr = createTranslator(dict);
  const ignPath = join(ROOT, 'scripts/i18n-ignore.txt');
  const ignore = new Set(existsSync(ignPath) ? readFileSync(ignPath, 'utf8').split('\n').filter(l => l && !l.startsWith('#')) : []);
  const exactKeys = new Set(Object.keys(dict).map(k => plainKey(normalize(k))));
  void tr;
  const found = extract();
  for (const k of [...found.keys()]) if (ignore.has(k)) found.delete(k);
  const missing = [];
  let covered = 0;
  for (const [key, locs] of found) {
    // covered = an exact dictionary entry (patterns are a runtime safety net only, they don't count)
    const ok = exactKeys.has(key) || FORMAT_RULES.some(([re]) => re.test(key));
    if (ok) covered++;
    else if (locs.every(l => CONTENT_FILES.has(l.file))) { covered++; continue; } // document content that stays German
    else missing.push({ key, file: locs[0].file, line: locs[0].line, count: locs.length, content: false });
  }
  const total = found.size;
  if (args.has('--json')) {
    process.stdout.write(JSON.stringify({ total, covered, missing }, null, 1));
    return;
  }
  if (args.has('--keys')) { for (const m of missing) console.log(m.key); return; }
  if (args.has('--all')) { for (const [k, l] of found) console.log(`${l[0].file}:${l[0].line}\t${k}`); return; }
  const byFile = new Map();
  for (const m of missing) byFile.set(m.file, (byFile.get(m.file) || 0) + 1);
  for (const m of missing) console.log(`${m.file}:${m.line}\t${m.key}`);
  console.log('\nMissing per file:');
  for (const [f, c] of [...byFile].sort((a, b) => b[1] - a[1])) console.log(`  ${String(c).padStart(4)}  ${f}`);
  console.log(`\nGerman UI strings: ${total} · translated: ${covered} (${total ? ((covered / total) * 100).toFixed(1) : 100} %) · missing: ${missing.length}`);
  if (args.has('--strict') && missing.length) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
