#!/usr/bin/env node
// FaLe PDF – more UI languages, generated from the English dictionary (js/i18n/en.js).
//
// The UI is written in German; js/i18n/en.js maps every German source string to English. Every other language
// gets its own file js/i18n/<lang>.js with the SAME keys (German source) and values in that language.
//
//   node scripts/i18n-langs.mjs dump [dir]              write translation chunks (German + English reference)
//   node scripts/i18n-langs.mjs check <lang> <dir>      validate translated chunks of one language
//   node scripts/i18n-langs.mjs build <lang> <dir>      write js/i18n/<lang>.js (missing entries fall back to English)
//   node scripts/i18n-langs.mjs coverage                 entries per language file vs. en.js
//
// Chunk format (input):  { "lang": "fr", "items": [ { "id": 17, "de": "…", "en": "…" }, … ] }
// Translated chunk:      { "17": "…", "18": "…" }   (id → translation; file <dir>/<lang>/chunk-NN.json)
//
// Rules a translation must keep (checked by `check`):
//  - every placeholder of the English value: {0}…{9}, {name}; plural switches may be rewritten in the target
//    language's own form, either {0|singular|plural} or with CLDR categories {0|one=…|few=…|many=…|other=…}
//    ("other" is required; languages without plural forms may use plain text instead of a switch)
//  - the same HTML tags (<b>, <br>, <a …> …) in the same number
//  - the product names FaLe, FaLe PDF, FaLe One, FaLe Plus, FaLe Sync, FaleNetwork unchanged
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const I18N = join(ROOT, 'js', 'i18n');
const CHUNK = 350;
export const LANG_NAMES = {
  fr: 'French', es: 'Spanish', it: 'Italian', pt: 'Portuguese (Brazil)', nl: 'Dutch', pl: 'Polish', tr: 'Turkish',
  uk: 'Ukrainian', ru: 'Russian', zh: 'Chinese (Simplified, mainland China)', ja: 'Japanese', ko: 'Korean', hi: 'Hindi', id: 'Indonesian',
};
const PLURAL_CATS = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);
const BRANDS = ['FaLe PDF', 'FaLe One', 'FaLe Plus', 'FaLe Sync', 'FaleNetwork'];

async function loadEn() {
  const mod = await import(join(I18N, 'en.js'));
  const items = [];
  let id = 0;
  for (const [de, en] of Object.entries(mod.default)) if (typeof en === 'string') items.push({ id: id++, de, en });
  for (const [de, en] of Object.entries(mod.defaultValues || {})) items.push({ id: id++, de: '§dv§' + de, en });
  return items;
}

const placeholders = s => {
  const out = new Set();
  for (const m of String(s).matchAll(/\{(\d|[a-zA-Z_]\w*)(?::n)?(\|[^{}]*)?\}/g)) out.add(m[1]);
  return out;
};
const tags = s => (String(s).match(/<\/?[a-zA-Z][a-zA-Z0-9]*/g) || []).map(t => t.toLowerCase()).sort().join(',');

/** Problems of one translation (empty array = fine). */
export function problems(item, tr) {
  const p = [];
  if (typeof tr !== 'string' || !tr.trim()) return ['empty'];
  for (const ph of placeholders(item.en)) {
    if (!placeholders(tr).has(ph)) {
      // a plural switch {0|a|b} may become plain text in languages without plural forms (ja, zh, ko, id …)
      // only if the number itself is still shown elsewhere
      if (/^\d$/.test(ph) && new RegExp(`\\{${ph}\\|`).test(item.en) && !new RegExp(`\\{${ph}\\}`).test(item.en)) continue;
      p.push(`placeholder {${ph}} missing`);
    }
  }
  for (const ph of placeholders(tr)) if (!placeholders(item.en).has(ph) && !placeholders(item.de).has(ph)) p.push(`unknown placeholder {${ph}}`);
  for (const m of tr.matchAll(/\{(\d|[a-zA-Z_]\w*)\|([^{}]*)\}/g)) {
    const segs = m[2].split('|');
    const named = segs.filter(s => /^[a-z]+=/.test(s));
    if (named.length) {
      if (named.length !== segs.length) p.push(`plural switch mixes forms: ${m[0]}`);
      if (!segs.some(s => s.startsWith('other='))) p.push(`plural switch without other=: ${m[0]}`);
      for (const s of named) if (!PLURAL_CATS.has(s.split('=')[0])) p.push(`unknown plural category: ${s}`);
    } else if (segs.length !== 2) p.push(`plural switch needs 2 forms or categories: ${m[0]}`);
  }
  if (tags(tr) !== tags(item.en)) p.push(`HTML tags differ (${tags(item.en)} → ${tags(tr)})`);
  for (const b of BRANDS) if (item.en.includes(b) && !tr.includes(b)) p.push(`brand "${b}" missing`);
  return p;
}

function readTranslations(lang, dir) {
  const d = join(dir, lang);
  const out = {};
  if (!existsSync(d)) return out;
  for (const f of readdirSync(d).filter(f => /^chunk-\d+\.json$/.test(f)).sort()) {
    const obj = JSON.parse(readFileSync(join(d, f), 'utf8'));
    Object.assign(out, obj);
  }
  return out;
}

const q = s => JSON.stringify(s);

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'dump') {
    const dir = a || join(ROOT, 'i18n-work');
    const items = await loadEn();
    mkdirSync(dir, { recursive: true });
    let n = 0;
    for (let i = 0; i < items.length; i += CHUNK, n++) {
      writeFileSync(join(dir, `chunk-${String(n).padStart(2, '0')}.json`), JSON.stringify({ items: items.slice(i, i + CHUNK) }, null, 1));
    }
    console.log(`${items.length} entries in ${n} chunks → ${dir}`);
    return;
  }
  if (cmd === 'check' || cmd === 'build') {
    const lang = a, dir = b || join(ROOT, 'i18n-work');
    if (!LANG_NAMES[lang]) throw new Error('unknown language ' + lang);
    // ids refer to the DUMP (chunk files in dir), not to the current en.js order: en.js may have grown since
    const dumped = [];
    for (const f of readdirSync(dir).filter(f => /^chunk-\d+\.json$/.test(f)).sort()) dumped.push(...JSON.parse(readFileSync(join(dir, f), 'utf8')).items);
    const trs = readTranslations(lang, dir);
    let missing = 0, bad = 0;
    const report = [];
    const byDe = new Map();
    for (const it of dumped) {
      const t = trs[String(it.id)];
      if (t === undefined) { missing++; continue; }
      const p = problems(it, t);
      if (p.length) { bad++; report.push(`#${it.id} ${q(it.de).slice(0, 80)}: ${p.join('; ')}`); continue; }
      byDe.set(it.de, { en: it.en, t });
    }
    if (cmd === 'check') {
      console.log(`${lang}: ${dumped.length - missing}/${dumped.length} translated, ${bad} with problems`);
      for (const r of report.slice(0, 200)) console.log('  ' + r);
      process.exit(bad ? 1 : 0);
    }
    // build from the CURRENT en.js: a translation is used when its German key exists and the English reference is
    // unchanged; new, changed, missing or invalid entries fall back to English (never ship a broken placeholder)
    const items = await loadEn();
    const main = [], dv = [];
    let used = 0;
    for (const it of items) {
      const hit = byDe.get(it.de);
      const v = hit && hit.en === it.en ? (used++, hit.t) : it.en;
      if (it.de.startsWith('§dv§')) dv.push(`  ${q(it.de.slice(4))}: ${q(v)},`);
      else main.push(`  ${q(it.de)}: ${q(v)},`);
    }
    const head = `// ${LANG_NAMES[lang]} UI dictionary for FaLe PDF: German source string → ${LANG_NAMES[lang]}.\n` +
      `// GENERATED by scripts/i18n-langs.mjs from translated chunks (keys = js/i18n/en.js); entries that were missing or\n` +
      `// failed the placeholder check fall back to English. Format: see js/i18n/en.js and js/i18n/core.js.\n`;
    writeFileSync(join(I18N, `${lang}.js`), `${head}export default {\n${main.join('\n')}\n};\n\nexport const defaultValues = {\n${dv.join('\n')}\n};\n`);
    console.log(`js/i18n/${lang}.js: ${used}/${items.length} translated (${items.length - used} English: ${missing} not translated, ${bad} invalid, rest new/changed)`);
    return;
  }
  if (cmd === 'coverage') {
    const en = (await import(join(I18N, 'en.js'))).default;
    const keys = Object.keys(en);
    for (const lang of Object.keys(LANG_NAMES)) {
      const f = join(I18N, `${lang}.js`);
      if (!existsSync(f)) { console.log(`${lang}: no file`); continue; }
      const d = (await import(f)).default;
      const same = keys.filter(k => d[k] === en[k] && !/^[\p{Lu}\d\s.,:;!?%/()+–-]*$/u.test(en[k])).length;
      console.log(`${lang}: ${keys.filter(k => k in d).length}/${keys.length} keys, ${same} still identical to English`);
    }
    return;
  }
  console.log('usage: dump [dir] | check <lang> [dir] | build <lang> [dir] | coverage');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
