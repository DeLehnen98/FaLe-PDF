// FaLe PDF i18n – pure matching engine (no DOM). Shared by the runtime (js/i18n/index.js)
// and the extractor (scripts/i18n-extract.mjs).
//
// Dictionary format (js/i18n/en.js): German source string → English.
//   - Exact keys:    'Seiten verwalten': 'Organize pages'
//   - Pattern keys:  '{0} von {1} Seiten': '{0} of {1} pages'   ({0}…{9} = any text, may be empty)
//     Values may use plural switches: '{0|file|files}' picks by the numeric value of capture 0.
//     Captures are translated recursively when they are a known string ("„{0}“ ist bald verfügbar.").
//   - Named keys (only for t()): 'Seite {n} von {N}': 'Page {n} of {N}'.

const MONTHS_DE = ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON_SHORT_DE = ['jan', 'feb', 'mär', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dez'];
const WD_DE = { mo: 'Mon', di: 'Tue', mi: 'Wed', do: 'Thu', fr: 'Fri', sa: 'Sat', so: 'Sun', montag: 'Monday', dienstag: 'Tuesday', mittwoch: 'Wednesday', donnerstag: 'Thursday', freitag: 'Friday', samstag: 'Saturday', sonntag: 'Sunday' };
const short = i => MONTHS_EN[i].slice(0, 3);

export const normalize = s => String(s).replace(/[\s ]+/g, ' ').trim();

/** German number formatting → English ("1.234,5" → "1,234.5"). Returns null when not a German number. */
export function convertNumber(s) {
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return s.replace(/\./g, '\u0001').replace(',', '.').replace(/\u0001/g, ',');
  if (/^-?\d+,\d+$/.test(s)) return s.replace(',', '.');
  return null;
}

// Locale rules for rendered German formats in UI chrome. Each: [regex (anchored, on normalized text), fn(m) → string]
export const FORMAT_RULES = [
  // 14.10.2026 (optionally with time "14.10.2026, 09:12" / "14.10.2026 09:12:33")
  [/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:,? (\d{1,2}:\d{2}(?::\d{2})?)(?: Uhr)?)?$/, m => `${+m[1]} ${short(+m[2] - 1)} ${m[3]}${m[4] ? `, ${m[4]}` : ''}`],
  [/^(\d{1,2})\.(\d{1,2})\.(\d{2})$/, m => `${+m[1]} ${short(+m[2] - 1)} '${m[3]}`],
  // Heute, 09:12 / Gestern, 18:00 / Heute / Gestern / Morgen
  [/^Heute(?:, (\d{1,2}:\d{2}))?$/, m => `Today${m[1] ? `, ${m[1]}` : ''}`],
  [/^Gestern(?:, (\d{1,2}:\d{2}))?$/, m => `Yesterday${m[1] ? `, ${m[1]}` : ''}`],
  [/^Morgen(?:, (\d{1,2}:\d{2}))?$/, m => `Tomorrow${m[1] ? `, ${m[1]}` : ''}`],
  // 09:12 Uhr
  [/^(\d{1,2}:\d{2}) Uhr$/, m => m[1]],
  // Mi., 14. Oktober 2026 / Mittwoch, 14. Oktober / 14. Okt. 2026 / 14. Oktober
  [/^(?:([A-Za-zäöü]{2,10})\.?, )?(\d{1,2})\. ([A-Za-zäöüÄÖÜ]{3,9})\.?(?: (\d{4}))?$/, m => {
    const mon = monthIndex(m[3]);
    if (mon < 0) return null;
    const wd = m[1] ? WD_DE[m[1].toLowerCase()] : '';
    if (m[1] && !wd) return null;
    const name = m[3].length <= 4 || /\.$/.test(m[3]) ? short(mon) : MONTHS_EN[mon];
    return `${wd ? wd + ', ' : ''}${+m[2]} ${name}${m[4] ? ' ' + m[4] : ''}`;
  }],
  // Oktober 2026
  [/^([A-Za-zäöüÄÖÜ]{3,9}) (\d{4})$/, m => { const i = monthIndex(m[1], true); return i < 0 ? null : `${MONTHS_EN[i]} ${m[2]}`; }],
  // sizes and numbers with units: "1,5 MB", "12.345 Zeichen" is handled by patterns; here units only
  [/^(-?[\d.,]+) ?(B|KB|MB|GB|TB|kB|px|pt|mm|cm|ms|s|dpi|DPI|%)$/, m => { const n = convertNumber(m[1]); if (n == null && !/^-?\d+$/.test(m[1])) return null; return m[2] === '%' ? `${n ?? m[1]}%` : `${n ?? m[1]} ${m[2]}`; }],
  // "3 × 4" etc. stay; plain German decimals
  [/^-?\d{1,3}(\.\d{3})+(,\d+)?$|^-?\d+,\d+$/, m => convertNumber(m[0])],
];

// Other languages: the same German formats, rendered with Intl in the target locale. `words` holds the
// dictionary's translations of "Heute", "Gestern", "Morgen" (relative days).
export function formatRules(locale, words = {}) {
  if (/^en\b/.test(locale)) return FORMAT_RULES;
  const df = o => new Intl.DateTimeFormat(locale, o);
  const nf = new Map();
  const num = s => {
    const plain = s.replace(/\./g, '').replace(',', '.');
    if (!/^-?\d+(\.\d+)?$/.test(plain)) return null;
    const dec = (plain.split('.')[1] || '').length;
    const key = dec;
    if (!nf.has(key)) nf.set(key, new Intl.NumberFormat(locale, { minimumFractionDigits: dec, maximumFractionDigits: dec }));
    return nf.get(key).format(+plain);
  };
  const date = (d, m, y) => new Date(Date.UTC(+y, +m - 1, +d, 12));
  const rel = (w, time) => (words[w] ? words[w] + (time ? `, ${time}` : '') : null);
  return [
    [/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:,? (\d{1,2}:\d{2}(?::\d{2})?)(?: Uhr)?)?$/, m => df({ day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date(m[1], m[2], m[3])) + (m[4] ? `, ${m[4]}` : '')],
    [/^(\d{1,2})\.(\d{1,2})\.(\d{2})$/, m => df({ day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' }).format(date(m[1], m[2], 2000 + +m[3]))],
    [/^Heute(?:, (\d{1,2}:\d{2}))?$/, m => rel('Heute', m[1])],
    [/^Gestern(?:, (\d{1,2}:\d{2}))?$/, m => rel('Gestern', m[1])],
    [/^Morgen(?:, (\d{1,2}:\d{2}))?$/, m => rel('Morgen', m[1])],
    [/^(\d{1,2}:\d{2}) Uhr$/, m => m[1]],
    [/^(?:([A-Za-zäöü]{2,10})\.?, )?(\d{1,2})\. ([A-Za-zäöüÄÖÜ]{3,9})\.?(?: (\d{4}))?$/, m => {
      const mon = monthIndex(m[3]);
      if (mon < 0) return null;
      if (m[1] && !WD_DE[m[1].toLowerCase()]) return null;
      const longMon = !(m[3].length <= 4 || /\.$/.test(m[3]));
      const o = { day: 'numeric', month: longMon ? 'long' : 'short', timeZone: 'UTC' };
      if (m[4]) o.year = 'numeric';
      if (m[1]) o.weekday = m[1].length > 3 ? 'long' : 'short';
      return df(o).format(new Date(Date.UTC(m[4] ? +m[4] : new Date().getFullYear(), mon, +m[2], 12)));
    }],
    [/^([A-Za-zäöüÄÖÜ]{3,9}) (\d{4})$/, m => { const i = monthIndex(m[1], true); return i < 0 ? null : df({ month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(+m[2], i, 1, 12))); }],
    [/^(-?[\d.,]+) ?(B|KB|MB|GB|TB|kB|px|pt|mm|cm|ms|s|dpi|DPI|%)$/, m => { const n = num(m[1]); if (n == null) return null; return m[2] === '%' ? `${n} %`.replace(/^(.*) %$/, /^(fr|de|pl|ru|uk|tr|nl|it|es|pt|id)\b/.test(locale) ? '$1 %' : '$1%') : `${n} ${m[2]}`; }],
    [/^-?\d{1,3}(\.\d{3})+(,\d+)?$|^-?\d+,\d+$/, m => num(m[0])],
  ];
}

function monthIndex(word, fullOnly = false) {
  const w = word.toLowerCase().replace(/\.$/, '');
  let i = MONTHS_DE.indexOf(w);
  if (i >= 0) return i;
  if (fullOnly) return -1;
  i = MON_SHORT_DE.indexOf(w.slice(0, 3));
  if (i >= 0 && (w.length <= 4 || MONTHS_DE[i].startsWith(w))) return i;
  if (w === 'märz' || w === 'mrz') return 2;
  return -1;
}

const PH = /\{(\d)(:n)?\}/g;
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORD_RE = /[\p{L}]{2,}/gu;
const bucketKey = w => w.slice(0, 4).toLowerCase();
const NUM = /^(?:[-+]?\d[\d.,]*|\?)$/;
const GROUP = { num: '([-+]?\\d[\\d.,]*|\\?)', suffix: '([a-zäöüß]{0,3}|[^\\p{L}].*?)', any: '(.*?)' };
/** Key without type annotations: '{0:n} Datei{1}' → '{0} Datei{1}' (how the extractor writes keys). */
export const plainKey = k => String(k).replace(/\{(\d):n\}/g, '{$1}');

/** Build a translator from a dictionary object. */
export function createTranslator(dict = {}, opts = {}) {
  const locale = opts.locale || 'en-GB';
  const rules = formatRules(locale, { Heute: dict['Heute'], Gestern: dict['Gestern'], Morgen: dict['Morgen'] });
  let pr = null;
  try { pr = new Intl.PluralRules(locale); } catch { /* very old engine: two forms only */ }
  const exact = new Map();
  const patterns = [];
  const buckets = new Map();
  const always = [];
  const lower = new Map();
  for (const [k0, v] of Object.entries(dict)) {
    if (typeof v !== 'string') continue;
    const k = normalize(k0);
    if (!k) continue;
    if (/\{\d(:n)?\}/.test(k)) {
      const parts = k.split(/\{\d(?::n)?\}/);
      const phs = [...k.matchAll(PH)];
      const order = phs.map(m => +m[1]);
      // Capture rules keep generic patterns from swallowing whole sentences:
      //  {0:n} or a capture used in a plural switch {0|…|…} must be a number;
      //  a capture glued to a letter ("Datei{1}") is a short suffix ("en") or starts with a non-letter.
      const kinds = phs.map((m, i) => {
        if (m[2] || new RegExp(`\\{${m[1]}\\|`).test(v)) return 'num';
        // '{0} Dateien', '{0} Seite{1} extrahiert': a leading placeholder before a German noun is a count
        if (i === 0 && parts[0] === '' && /^ [A-ZÄÖÜ]/.test(parts[1] || '') && !/^ (Du|Alles|Die|Der|Das|Mit|Bitte|Ohne|Es|Wir|Ich|FaLe|KI)\b/.test(parts[1])) return 'num';
        const before = parts[i], after = parts[i + 1];
        if (/\p{L}$/u.test(before) || /^\p{L}/u.test(after)) return 'suffix';
        return 'any';
      });
      // a placeholder at the very start/end next to a space may be missing entirely: it often holds markup
      // (badges, icons) that is not part of the text node, e.g. 'Wandelt … um. {0}' ↔ 'Wandelt … um.'
      let src = '^';
      const last = order.length - 1;
      parts.forEach((p, i) => {
        if (i === 0 && p === '' && kinds[0] === 'any' && / $/.test(parts[1] || '') && parts.length > 2) { src += '(?:(.*?) )?'; parts[1] = parts[1].slice(1); return; }
        if (i === last && parts[last + 1] === '' && kinds[last] === 'any' && / $/.test(p)) { src += escRe(p.slice(0, -1)) + '(?: (.*?))?'; return; }
        src += escRe(p);
        if (i < order.length) src += GROUP[kinds[i]];
      });
      src += '$';
      const p = { key: k, re: new RegExp(src, 'su'), order, kinds, value: v, lit: parts.join('').length };
      patterns.push(p);
      const words = parts.join(' ').match(WORD_RE) || [];
      if (!words.length) { always.push(p); continue; }
      const anchor = words.reduce((a, b) => (b.length > a.length ? b : a));
      const bk = bucketKey(anchor);
      if (!buckets.has(bk)) buckets.set(bk, []);
      buckets.get(bk).push(p);
    } else {
      exact.set(k, v);
      if (!lower.has(k.toLowerCase())) lower.set(k.toLowerCase(), v);
    }
  }
  // longer literal content first → more specific patterns win
  for (const list of buckets.values()) list.sort((a, b) => b.lit - a.lit);
  always.sort((a, b) => b.lit - a.lit);

  const cache = new Map();

  function validCaps(p, caps) {
    for (let j = 0; j < p.order.length; j++) {
      const c = caps[p.order[j]] ?? '';
      const kind = p.kinds[j];
      if (kind === 'num' && !NUM.test(c.trim())) return false;
      if (kind === 'suffix' && c && !/^[a-zäöüß]{1,3}$/.test(c) && /^\p{L}/u.test(c)) return false;
    }
    return true;
  }

  function fill(value, caps, depth) {
    let ok = true;
    const out = value.replace(/\{(\d)((?:\|[^|{}]*)*)\}/g, (m, i, sw) => {
      const c = caps[+i] ?? '';
      if (sw) {
        const n = parseFloat(String(c).replace(/\./g, '').replace(',', '.'));
        return pluralPick(sw.slice(1).split('|'), n, pr);
      }
      const f = fragment(c, depth + 1);
      // an untranslated capture of more than a few words is a sentence the pattern should not have matched
      if (f === c && (c.match(/\p{L}+/gu) || []).length > 5) ok = false;
      return f;
    });
    return ok ? out : null;
  }

  /** Translate a captured fragment: known string → translation, German number → English, else unchanged. */
  function fragment(c, depth) {
    if (!c || depth > 3) return c;
    const n = normalize(c);
    if (!n) return c;
    const r = lookup(n, depth, true);
    if (r == null) return c;
    return /^\s*/.exec(c)[0] + r + /\s*$/.exec(c)[0];
  }

  function matchPatterns(n, depth) {
    const words = n.match(WORD_RE);
    const seen = new Set();
    const cands = [];
    if (words) for (const w of words) {
      const bk = bucketKey(w);
      if (seen.has(bk)) continue;
      seen.add(bk);
      const list = buckets.get(bk);
      if (list) cands.push(...list);
    }
    cands.sort((a, b) => b.lit - a.lit);
    for (const p of cands.concat(always)) {
      const m = p.re.exec(n);
      if (!m) continue;
      const caps = [];
      p.order.forEach((idx, j) => { caps[idx] = m[j + 1]; });
      if (!validCaps(p, caps)) continue;
      const out = fill(p.value, caps, depth);
      if (out != null) return out.trim();
    }
    return null;
  }

  function lookup(text, depth = 0, frag = false) {
    const n = normalize(text);
    if (!n) return null;
    if (!frag && cache.has(n)) return cache.get(n);
    let r = exact.get(n);
    if (r === undefined) r = null;
    if (r == null) {
      // trailing punctuation variants: "Name:" "Speichern …" "Bitte warten..."  "(optional)"
      const m = /^(.*?[^\s:…(])(\s*(?::|…|\.\.\.|\*|:\s*\*|\())$/.exec(n);
      if (m) { const b = exact.get(m[1]); if (b != null) r = b + m[2]; }
    }
    if (r == null) {
      const m = /^([„"“(])(.+?)([“"”)])$/.exec(n);
      if (m) { const b = exact.get(m[2]); if (b != null) r = (m[1] === '„' ? '“' : m[1]) + b + (m[3] === '“' ? '”' : m[3]); }
    }
    if (r == null) for (const [re, fn] of rules) {
      const m = re.exec(n);
      if (m) { const out = fn(m); if (out != null) { r = out; break; } }
    }
    if (r == null && /\p{L}/u.test(n) && depth < 4) r = matchPatterns(n, depth);
    if (r == null && frag) { const l = lower.get(n.toLowerCase()); if (l != null && n.length > 3) r = n[0] === n[0].toLowerCase() ? l[0].toLowerCase() + l.slice(1) : l; }
    if (!frag) { if (cache.size > 6000) cache.clear(); cache.set(n, r); }
    return r;
  }

  return {
    lookup: s => lookup(s, 0, false),
    /** Attribute-specific entries ('@aria-label:Markieren') win over the general translation. */
    lookupAttr(attr, s) { const o = exact.get('@' + attr + ':' + normalize(s)); return o != null ? o : lookup(s, 0, false); },
    has: s => exact.has(normalize(s)),
    exact, patterns,
    /** t(): exact or pattern key, then {name} variables. */
    t(german, vars) {
      let out = exact.get(normalize(german));
      if (out == null) out = /\{[a-zA-Z_]\w*\}/.test(german) ? null : lookup(german);
      if (out == null) out = german;
      return vars ? subst(out, vars, pr) : out;
    },
  };
}

/** Plural form: two forms (singular|plural, as in English) or CLDR categories ("one=…|few=…|other=…"). */
export function pluralPick(segs, n, pr) {
  if (segs.some(x => /^(zero|one|two|few|many|other)=/.test(x))) {
    const map = {};
    for (const x of segs) { const k = x.indexOf('='); map[x.slice(0, k)] = x.slice(k + 1); }
    let cat = 'other';
    try { cat = pr ? pr.select(isNaN(n) ? 0 : n) : (n === 1 ? 'one' : 'other'); } catch { /* keep other */ }
    return map[cat] ?? map.other ?? '';
  }
  if (segs.length === 1) return segs[0];
  return n === 1 ? segs[0] : segs[1];
}

export function subst(s, vars, pr = null) {
  return String(s).replace(/\{([a-zA-Z_]\w*)((?:\|[^|{}]*)*)\}/g, (m, k, sw) => {
    if (!(k in vars)) return m;
    if (sw) return pluralPick(sw.slice(1).split('|'), +vars[k], pr);
    return String(vars[k]);
  });
}
