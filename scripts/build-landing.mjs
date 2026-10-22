#!/usr/bin/env node
// FaLe PDF – generates the start pages of pdf.fale.network (all languages) from ONE template + one strings file per language.
//
//   site/landing.template.html   markup (placeholders {{key}}, {{key|a}} for attributes, {{#each list}}…{{/each}})
//   site/i18n/<code>.json        strings of one language (same keys in every file – the build checks that)
//   → site/index.html            German (/)          → site/<code>/index.html   every other language (/<code>/)
//
//   node scripts/build-landing.mjs            write the pages
//   node scripts/build-landing.mjs --check    only compare with the files on disk (fails when the pages are stale; used by vercel-build.mjs)
//
// Never edit the generated site/**/index.html by hand – change the template or the strings and run the script again.
// Adding a language: write site/i18n/<code>.json (same keys as de.json) and run the script; site/landing.js reads the
// list of published languages from the generated <link rel="alternate" hreflang> tags, vercel-build copies every folder.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const ORIGIN = 'https://pdf.fale.network';

// code → [value of <html lang> / hreflang]; "de" is the root page (/), all others live at /<code>/
const ALL_LANGS = [
  ['de', 'de'], ['en', 'en'], ['fr', 'fr'], ['es', 'es'], ['it', 'it'], ['pt', 'pt-BR'], ['nl', 'nl'], ['pl', 'pl'],
  ['tr', 'tr'], ['uk', 'uk'], ['ru', 'ru'], ['zh', 'zh-Hans'], ['ja', 'ja'], ['ko', 'ko'], ['hi', 'hi'], ['id', 'id'],
];
// a language is published as soon as its strings file exists (site/i18n/<code>.json)
export const LANGS = ALL_LANGS.filter(([c]) => existsSync(join(SITE, 'i18n', c + '.json')));
export const SUBFOLDERS = LANGS.map(l => l[0]).filter(c => c !== 'de');
const SCREEN_FILES = ['01_home', '02_sign', '03_scan', '06_sheet', '08_privacy'];
// product names that must survive translation unchanged (checked against the English strings)
const KEEP = ['FaLe PDF', 'FaLe Plus', 'FaleNetwork', 'Microsoft Store', 'Play Store', 'App Store', 'Safari', 'Chrome', 'Edge', 'PDF/A', 'DOCX', 'XLSX', 'CSV', 'PPTX', 'OCR', 'Windows', 'Mac', 'Word', 'Excel', 'PowerPoint', 'Markdown'];

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escA = s => esc(s).replace(/"/g, '&quot;');
// json.dumps-style (", " and ": ") so the German/English pages stay byte-identical to the hand-written ones
const dumps = v => Array.isArray(v) ? '[' + v.map(dumps).join(', ') + ']'
  : v && typeof v === 'object' ? '{' + Object.entries(v).map(([k, x]) => JSON.stringify(k) + ': ' + dumps(x)).join(', ') + '}'
    : JSON.stringify(v).replace(/</g, '\\u003c');

const get = (obj, path, where) => {
  let v = obj;
  for (const k of path.split('.')) { if (v == null || !(k in v)) throw new Error(`${where}: Platzhalter {{${path}}} hat keinen Wert`); v = v[k]; }
  return v;
};

function render(tpl, ctx, where) {
  const sub = (s, local) => s.replace(/\{\{(\.[\w]*|[\w.]+)(\|a)?\}\}/g, (_, key, a) => {
    let v;
    if (key[0] === '.') {
      if (local == null) throw new Error(`${where}: {{${key}}} außerhalb von #each`);
      v = key === '.' ? local : local[key.slice(1)];
      if (v == null) throw new Error(`${where}: {{${key}}} fehlt im Listeneintrag`);
    } else v = get(ctx, key, where);
    return key.startsWith('page.') && !a ? String(v) : (a ? escA(v) : esc(v));
  });
  const out = tpl.replace(/\{\{#each ([\w.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, path, body) =>
    get(ctx, path, where).map(item => sub(body, item)).join(''));
  return sub(out, null);
}

function loadStrings(code) {
  const f = join(SITE, 'i18n', code + '.json');
  if (!existsSync(f)) throw new Error(`site/i18n/${code}.json fehlt`);
  return JSON.parse(readFileSync(f, 'utf8'));
}

// every language file must have exactly the structure of de.json; names/formats from en.json must be kept
function validate(code, s, de, en) {
  const walk = (a, b, path) => {
    if (typeof b === 'string') { if (typeof a !== 'string' || !a.trim()) throw new Error(`i18n/${code}.json: ${path} fehlt oder ist leer`); return; }
    if (Array.isArray(b)) {
      if (!Array.isArray(a) || a.length !== b.length) throw new Error(`i18n/${code}.json: ${path} muss ${b.length} Einträge haben`);
      b.forEach((x, i) => walk(a[i], x, `${path}[${i}]`)); return;
    }
    if (!a || typeof a !== 'object') throw new Error(`i18n/${code}.json: ${path} fehlt`);
    for (const k of Object.keys(b)) walk(a[k], b[k], path ? `${path}.${k}` : k);
    for (const k of Object.keys(a)) if (!(k in b)) throw new Error(`i18n/${code}.json: unbekannter Schlüssel ${path ? path + '.' : ''}${k}`);
  };
  walk(s, de, '');
  const flat = (v, path, out) => {
    if (typeof v === 'string') out[path] = v;
    else if (Array.isArray(v)) v.forEach((x, i) => flat(x, `${path}[${i}]`, out));
    else for (const [k, x] of Object.entries(v)) flat(x, path ? `${path}.${k}` : k, out);
    return out;
  };
  const fs = flat(s, '', {}), fe = flat(en, '', {});
  for (const [p, e] of Object.entries(fe)) {
    if (/\.alts\[/.test(p) || /^faq\.items\[\d+\]\.q$/.test(p) && false) continue;
    for (const n of KEEP) if (e.includes(n) && !fs[p].includes(n) && !(code === 'en')) {
      throw new Error(`i18n/${code}.json: ${p} muss "${n}" unverändert enthalten`);
    }
  }
}

// links to the task pages of this language (site/tasks/<code>.json, pages by scripts/build-tasks.mjs)
function taskLinks(code) {
  const f = join(SITE, 'tasks', code + '.json');
  if (!existsSync(f)) return { h2: '', items: [] };
  const t = JSON.parse(readFileSync(f, 'utf8'));
  return { h2: t.ui.popularH, items: Object.values(t.tasks).map(x => ({ href: `/${code}/${x.slug}/`, label: x.h1 })) };
}

function pageFor(code, htmlLang, s, tpl) {
  const de = code === 'de';
  const path = de ? '/' : `/${code}/`;
  const url = ORIGIN + path;
  const faq = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: s.faq.items.map(i => ({ '@type': 'Question', name: i.q, acceptedAnswer: { '@type': 'Answer', text: i.a } })) };
  const app = {
    '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'FaLe PDF', url, applicationCategory: 'BusinessApplication',
    operatingSystem: 'Android, iOS, Windows, macOS, Web', inLanguage: htmlLang, description: s.meta.description,
    image: ORIGIN + '/icons/icon-512.png',
  };
  const alternates = LANGS.map(([c, h]) => `  <link rel="alternate" hreflang="${h}" href="${ORIGIN}${c === 'de' ? '/' : `/${c}/`}">`)
    .concat(`  <link rel="alternate" hreflang="x-default" href="${ORIGIN}/">`).join('\n');
  const ctx = {
    ...s,
    page: {
      htmlLang, path, url, alternates, jsonLdApp: dumps(app), jsonLdFaq: dumps(faq),
      ogImage: ORIGIN + (de ? '/og-image.png' : '/og-image-en.png'), imgPrefix: de ? 'de' : 'en',
      legal: de ? { imprint: '/impressum.html', privacy: '/datenschutz.html' } : { imprint: '/impressum.html?lang=en', privacy: '/datenschutz.html?lang=en' },
      network: de ? 'https://fale.network/' : 'https://fale.network/en/',
    },
    screens: { ...s.screens, items: s.screens.alts.map((alt, i) => ({ file: SCREEN_FILES[i], alt })) },
    tasks: taskLinks(code),
  };
  return render(tpl, ctx, `site/i18n/${code}.json`);
}

export function buildAll() {
  const tpl = readFileSync(join(SITE, 'landing.template.html'), 'utf8');
  const de = loadStrings('de'), en = loadStrings('en');
  return LANGS.map(([code, htmlLang]) => {
    const s = code === 'de' ? de : code === 'en' ? en : loadStrings(code);
    validate(code, s, de, en);
    return { code, file: code === 'de' ? join(SITE, 'index.html') : join(SITE, code, 'index.html'), html: pageFor(code, htmlLang, s, tpl) };
  });
}

// returns the pages whose file on disk differs from what the template + strings produce
export function stalePages() {
  return buildAll().filter(p => !existsSync(p.file) || readFileSync(p.file, 'utf8') !== p.html).map(p => p.file.slice(ROOT.length + 1));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--check')) {
    const stale = stalePages();
    if (stale.length) { console.error('Startseiten veraltet (node scripts/build-landing.mjs ausführen): ' + stale.join(', ')); process.exit(1); }
    console.log('Startseiten sind aktuell');
  } else {
    const pages = buildAll();
    for (const p of pages) { mkdirSync(dirname(p.file), { recursive: true }); writeFileSync(p.file, p.html); }
    console.log(`Startseiten: ${pages.length} Sprachen geschrieben (${pages.map(p => p.code).join(' ')})`);
  }
}
