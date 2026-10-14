// GENERATED – synced copy of js/office/formula.js (app imports → lib/conv-office-shim.js, vendor paths re-based) by scripts/sync-webtools-vendor.mjs.
// Do not edit here: change the source in the app and run `node scripts/sync-webtools-vendor.mjs`.
// Formula engine: tokenizer (German + English syntax), parser, evaluator (dynamic arrays, named ranges), reference shifting.
// Canonical storage form = English function names, "," as argument separator, "." as decimal point (like .xlsx).
import { formatWithCode, fromGermanCode, fmtGeneralDe } from './numfmt.js';

export class FErr {
  constructor(code) { this.code = code; }
  toString() { return this.code; }
}
export const ERR = {
  DIV0: new FErr('#DIV/0!'), VALUE: new FErr('#VALUE!'), REF: new FErr('#REF!'), NAME: new FErr('#NAME?'),
  NUM: new FErr('#NUM!'), NA: new FErr('#N/A'), NULL: new FErr('#NULL!'), CIRC: new FErr('#CIRC!'), SPILL: new FErr('#SPILL!'), CALC: new FErr('#CALC!'),
};
const ERR_BY_CODE = Object.fromEntries(Object.values(ERR).map(e => [e.code, e]));
export const ERR_DE = { '#DIV/0!': '#DIV/0!', '#VALUE!': '#WERT!', '#REF!': '#BEZUG!', '#NAME?': '#NAME?', '#NUM!': '#ZAHL!', '#N/A': '#NV', '#NULL!': '#NULL!', '#CIRC!': '#ZIRKEL!', '#SPILL!': '#ÜBERLAUF!', '#CALC!': '#KALK!' };
const ERR_FROM_DE = Object.fromEntries(Object.entries(ERR_DE).map(([k, v]) => [v, k]));
export const isErr = v => v instanceof FErr;
export function errFromCode(code) { const c = String(code).toUpperCase(); return ERR_BY_CODE[c] || ERR_BY_CODE[ERR_FROM_DE[c]] || new FErr(code); }

/** 2D array value (results of array expressions / dynamic arrays). */
export class Arr {
  constructor(rows) { this.rows = rows; }
  get h() { return this.rows.length; }
  get w() { return this.rows.length ? this.rows[0].length : 0; }
}
export const isArr = v => v instanceof Arr;

// ---------------- function names ----------------
// [English (canonical), German (preferred display), …aliases]
const NAMES = [
  ['SUM', 'SUMME'], ['PRODUCT', 'PRODUKT'], ['SUMPRODUCT', 'SUMMENPRODUKT'], ['SUMSQ', 'QUADRATESUMME'], ['ABS', 'ABS'], ['ROUND', 'RUNDEN'],
  ['ROUNDUP', 'AUFRUNDEN'], ['ROUNDDOWN', 'ABRUNDEN'], ['MROUND', 'VRUNDEN'], ['CEILING', 'OBERGRENZE'], ['FLOOR', 'UNTERGRENZE'],
  ['CEILING.MATH', 'OBERGRENZE.MATHEMATIK'], ['FLOOR.MATH', 'UNTERGRENZE.MATHEMATIK'], ['INT', 'GANZZAHL'], ['TRUNC', 'KÜRZEN', 'KUERZEN'],
  ['MOD', 'REST'], ['POWER', 'POTENZ'], ['SQRT', 'WURZEL'], ['EXP', 'EXP'], ['LN', 'LN'], ['LOG', 'LOG'], ['LOG10', 'LOG10'], ['PI', 'PI'],
  ['SIGN', 'VORZEICHEN'], ['EVEN', 'GERADE'], ['ODD', 'UNGERADE'], ['FACT', 'FAKULTÄT', 'FAKULTAET'], ['COMBIN', 'KOMBINATIONEN'], ['GCD', 'GGT'],
  ['LCM', 'KGV'], ['RAND', 'ZUFALLSZAHL'], ['RANDBETWEEN', 'ZUFALLSBEREICH'], ['RANDARRAY', 'ZUFALLSMATRIX'], ['QUOTIENT', 'QUOTIENT'],
  ['SIN', 'SIN'], ['COS', 'COS'], ['TAN', 'TAN'], ['ASIN', 'ARCSIN'], ['ACOS', 'ARCCOS'], ['ATAN', 'ARCTAN'], ['ATAN2', 'ARCTAN2'],
  ['DEGREES', 'GRAD'], ['RADIANS', 'BOGENMASS', 'BOGENMAß'], ['SUBTOTAL', 'TEILERGEBNIS'], ['SUMIF', 'SUMMEWENN'], ['SUMIFS', 'SUMMEWENNS'],
  ['AVERAGE', 'MITTELWERT'], ['AVERAGEA', 'MITTELWERTA'], ['AVERAGEIF', 'MITTELWERTWENN'], ['AVERAGEIFS', 'MITTELWERTWENNS'], ['COUNT', 'ANZAHL'],
  ['COUNTA', 'ANZAHL2'], ['COUNTBLANK', 'ANZAHLLEEREZELLEN', 'ZÄHLENLEERE', 'ZAEHLENLEERE'], ['COUNTIF', 'ZÄHLENWENN', 'ZAEHLENWENN'],
  ['COUNTIFS', 'ZÄHLENWENNS', 'ZAEHLENWENNS'], ['MAX', 'MAX'], ['MIN', 'MIN'], ['MAXA', 'MAXA'], ['MINA', 'MINA'], ['MAXIFS', 'MAXWENNS'],
  ['MINIFS', 'MINWENNS'], ['MEDIAN', 'MEDIAN'], ['MODE', 'MODALWERT'], ['MODE.SNGL', 'MODUS.EINF', 'MODUS'], ['STDEV', 'STABW'],
  ['STDEV.S', 'STABW.S'], ['STDEVP', 'STABWN'], ['STDEV.P', 'STABW.N'], ['VAR', 'VARIANZ'], ['VAR.S', 'VAR.S'], ['VARP', 'VARIANZEN'],
  ['VAR.P', 'VAR.P'], ['LARGE', 'KGRÖSSTE', 'KGRÖßTE', 'KGROESSTE'], ['SMALL', 'KKLEINSTE'], ['RANK', 'RANG'], ['RANK.EQ', 'RANG.GLEICH'],
  ['RANK.AVG', 'RANG.MITTELW'], ['PERCENTILE', 'QUANTIL'], ['PERCENTILE.INC', 'QUANTIL.INKL'], ['QUARTILE', 'QUARTILE'],
  ['QUARTILE.INC', 'QUARTILE.INKL'], ['CORREL', 'KORREL'], ['GEOMEAN', 'GEOMITTEL'], ['AVEDEV', 'MITTELABW'],
  ['IF', 'WENN'], ['IFS', 'WENNS'], ['IFERROR', 'WENNFEHLER'], ['IFNA', 'WENNNV'], ['AND', 'UND'], ['OR', 'ODER'], ['NOT', 'NICHT'],
  ['XOR', 'XODER'], ['TRUE', 'WAHR'], ['FALSE', 'FALSCH'], ['SWITCH', 'ERSTERWERT'], ['LET', 'LET'],
  ['VLOOKUP', 'SVERWEIS'], ['HLOOKUP', 'WVERWEIS'], ['XLOOKUP', 'XVERWEIS'], ['MATCH', 'VERGLEICH'], ['XMATCH', 'XVERGLEICH'], ['INDEX', 'INDEX'],
  ['CHOOSE', 'WAHL'], ['ROW', 'ZEILE'], ['COLUMN', 'SPALTE'], ['ROWS', 'ZEILEN'], ['COLUMNS', 'SPALTEN'], ['OFFSET', 'BEREICH.VERSCHIEBEN'],
  ['INDIRECT', 'INDIREKT'], ['ADDRESS', 'ADRESSE'], ['LOOKUP', 'VERWEIS'], ['TRANSPOSE', 'MTRANS'], ['FILTER', 'FILTER'], ['SORT', 'SORTIEREN'],
  ['SORTBY', 'SORTIERENNACH'], ['UNIQUE', 'EINDEUTIG'], ['SEQUENCE', 'SEQUENZ'],
  ['CONCATENATE', 'VERKETTEN'], ['CONCAT', 'TEXTKETTE'], ['TEXTJOIN', 'TEXTVERKETTEN'], ['LEFT', 'LINKS'], ['RIGHT', 'RECHTS'], ['MID', 'TEIL'],
  ['LEN', 'LÄNGE', 'LAENGE'], ['FIND', 'FINDEN'], ['SEARCH', 'SUCHEN'], ['REPLACE', 'ERSETZEN'], ['SUBSTITUTE', 'WECHSELN'],
  ['TRIM', 'GLÄTTEN', 'GLAETTEN'], ['CLEAN', 'SÄUBERN', 'SAEUBERN'], ['UPPER', 'GROSS'], ['LOWER', 'KLEIN'], ['PROPER', 'GROSS2'], ['TEXT', 'TEXT'],
  ['VALUE', 'WERT'], ['REPT', 'WIEDERHOLEN'], ['EXACT', 'IDENTISCH'], ['CHAR', 'ZEICHEN'], ['CODE', 'CODE'], ['UNICHAR', 'UNIZEICHEN'],
  ['UNICODE', 'UNICODE'], ['FIXED', 'FEST'], ['NUMBERVALUE', 'ZAHLENWERT'], ['T', 'T'], ['N', 'N'], ['TEXTBEFORE', 'TEXTVOR'], ['TEXTAFTER', 'TEXTNACH'],
  ['DATE', 'DATUM'], ['TIME', 'ZEIT'], ['YEAR', 'JAHR'], ['MONTH', 'MONAT'], ['DAY', 'TAG'], ['HOUR', 'STUNDE'], ['MINUTE', 'MINUTE'],
  ['SECOND', 'SEKUNDE'], ['WEEKDAY', 'WOCHENTAG'], ['WEEKNUM', 'KALENDERWOCHE'], ['ISOWEEKNUM', 'ISOKALENDERWOCHE'], ['EDATE', 'EDATUM'],
  ['EOMONTH', 'MONATSENDE'], ['NETWORKDAYS', 'NETTOARBEITSTAGE'], ['NETWORKDAYS.INTL', 'NETTOARBEITSTAGE.INTL'], ['WORKDAY', 'ARBEITSTAG'],
  ['WORKDAY.INTL', 'ARBEITSTAG.INTL'], ['TODAY', 'HEUTE'], ['NOW', 'JETZT'], ['DATEDIF', 'DATEDIF'], ['DAYS', 'TAGE'], ['DATEVALUE', 'DATWERT'],
  ['TIMEVALUE', 'ZEITWERT'], ['YEARFRAC', 'BRTEILJAHRE'], ['DAYS360', 'TAGE360'],
  ['ISBLANK', 'ISTLEER'], ['ISNUMBER', 'ISTZAHL'], ['ISTEXT', 'ISTTEXT'], ['ISNONTEXT', 'ISTKTEXT'], ['ISERROR', 'ISTFEHLER'], ['ISERR', 'ISTFEHL'],
  ['ISNA', 'ISTNV'], ['ISLOGICAL', 'ISTLOG'], ['ISEVEN', 'ISTGERADE'], ['ISODD', 'ISTUNGERADE'], ['ISFORMULA', 'ISTFORMEL'], ['ISREF', 'ISTBEZUG'],
  ['NA', 'NV'], ['ERROR.TYPE', 'FEHLER.TYP'], ['TYPE', 'TYP'],
  ['PMT', 'RMZ'], ['FV', 'ZW'], ['PV', 'BW'], ['RATE', 'ZINS'], ['NPER', 'ZZR'], ['NPV', 'NBW'], ['IRR', 'IKV'], ['IPMT', 'ZINSZ'], ['PPMT', 'KAPZ'],
  ['EFFECT', 'EFFEKTIV'], ['NOMINAL', 'NOMINAL'], ['SLN', 'LIA'], ['XNPV', 'XKAPITALWERT'], ['XIRR', 'XINTZINSFUSS'], ['CUMIPMT', 'KUMZINSZ'], ['CUMPRINC', 'KUMKAPITAL'],
];
const DE_EN = {};
const EN_DE = {};
for (const [en, de, ...al] of NAMES) {
  EN_DE[en] = de;
  for (const n of [de, ...al]) if (n !== en) DE_EN[n] = en;
}
export const KNOWN_FUNCTIONS = new Set(NAMES.map(n => n[0]));
/** Functions that need the _xlfn. prefix in .xlsx files. */
const XLFN = {
  LET: '_xlfn.LET', XLOOKUP: '_xlfn.XLOOKUP', XMATCH: '_xlfn.XMATCH', IFS: '_xlfn.IFS', SWITCH: '_xlfn.SWITCH', XOR: '_xlfn.XOR', TEXTJOIN: '_xlfn.TEXTJOIN',
  CONCAT: '_xlfn.CONCAT', IFNA: '_xlfn.IFNA', MAXIFS: '_xlfn.MAXIFS', MINIFS: '_xlfn.MINIFS', ISOWEEKNUM: '_xlfn.ISOWEEKNUM', DAYS: '_xlfn.DAYS',
  FILTER: '_xlfn._xlws.FILTER', SORT: '_xlfn._xlws.SORT', SORTBY: '_xlfn.SORTBY', UNIQUE: '_xlfn.UNIQUE', SEQUENCE: '_xlfn.SEQUENCE',
  RANDARRAY: '_xlfn.RANDARRAY', 'STDEV.S': '_xlfn.STDEV.S', 'STDEV.P': '_xlfn.STDEV.P', 'VAR.S': '_xlfn.VAR.S', 'VAR.P': '_xlfn.VAR.P',
  'MODE.SNGL': '_xlfn.MODE.SNGL', 'RANK.EQ': '_xlfn.RANK.EQ', 'RANK.AVG': '_xlfn.RANK.AVG', 'PERCENTILE.INC': '_xlfn.PERCENTILE.INC',
  'QUARTILE.INC': '_xlfn.QUARTILE.INC', 'CEILING.MATH': '_xlfn.CEILING.MATH', 'FLOOR.MATH': '_xlfn.FLOOR.MATH', 'NETWORKDAYS.INTL': '_xlfn.NETWORKDAYS.INTL',
  'WORKDAY.INTL': '_xlfn.WORKDAY.INTL', UNICHAR: '_xlfn.UNICHAR', UNICODE: '_xlfn.UNICODE', NUMBERVALUE: '_xlfn.NUMBERVALUE',
  TEXTBEFORE: '_xlfn.TEXTBEFORE', TEXTAFTER: '_xlfn.TEXTAFTER', 'ERROR.TYPE': 'ERROR.TYPE',
};
/** Functions whose result is an array that spills (for the xlsx writer: dynamic-array metadata). */
export const ARRAY_FUNCTIONS = new Set(['FILTER', 'SORT', 'SORTBY', 'UNIQUE', 'SEQUENCE', 'RANDARRAY', 'TRANSPOSE']);
/** Volatile functions are recalculated on every change. */
export const VOLATILE = new Set(['RAND', 'RANDBETWEEN', 'RANDARRAY', 'NOW', 'TODAY', 'OFFSET', 'INDIRECT']);

export function canonicalFn(name) {
  const up = name.toUpperCase().replace(/^_XLFN\._XLWS\.|^_XLFN\.|^_XLWS\./, '');
  return DE_EN[up] || up;
}
export function germanFn(en) { return EN_DE[en] || en; }

// ---------------- references ----------------
export function colName(c) {
  let s = '';
  c++;
  while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); }
  return s;
}
export function colIndex(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export function addr(r, c) { return colName(c) + (r + 1); }
export function parseAddr(a) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(String(a).trim());
  return m ? { r: +m[2] - 1, c: colIndex(m[1]) } : null;
}
export function parseRangeAddr(a) {
  const [x, y] = String(a).split(':');
  const p = parseAddr(x), q = y ? parseAddr(y) : p;
  if (!p || !q) return null;
  return { r1: Math.min(p.r, q.r), c1: Math.min(p.c, q.c), r2: Math.max(p.r, q.r), c2: Math.max(p.c, q.c) };
}
export function quoteSheet(name) {
  return /^[A-Za-z_\u00C0-\u024F][\w\u00C0-\u024F.]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name) && !/^(R\d*C\d*)$/i.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}
/** Valid name for a named range? */
export function isValidName(n) {
  return /^[A-Za-z_\u00C0-\u024F\\][\w.\u00C0-\u024F]*$/.test(n) && !/^[A-Za-z]{1,3}\d+$/.test(n) && !/^(R|C|RC|R\d+C\d+)$/i.test(n) && !/^(TRUE|FALSE|WAHR|FALSCH)$/i.test(n) && n.length <= 255;
}

// ---------------- tokenizer ----------------
// token: {t: 'num'|'str'|'bool'|'err'|'ref'|'range'|'fn'|'op'|'('|')'|'sep'|'ws'|'name'|'{'|'}'|'asep'|'rsep', v, raw}
const RE_REF = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![\w(.])/;
const RE_COL = /^(\$?)([A-Za-z]{1,3})(?![\w(\d])/;
const RE_ROW = /^(\$?)(\d{1,7})(?![\w(.,])/;
const ERR_RE = /^#(DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|NULL!|WERT!|BEZUG!|ZAHL!|NV|SPILL!|ÜBERLAUF!|CALC!|KALK!|CIRC!|ZIRKEL!)/i;

export function tokenize(src, locale = 'en') {
  const sep = locale === 'de' ? ';' : ',';
  const dec = locale === 'de' ? ',' : '.';
  const out = [];
  let i = 0;
  const s = src;
  let braces = 0;
  const readSheetPrefix = () => {
    if (s[i] === "'") {
      let j = i + 1, name = '';
      while (j < s.length) {
        if (s[j] === "'" && s[j + 1] === "'") { name += "'"; j += 2; continue; }
        if (s[j] === "'") break;
        name += s[j++];
      }
      if (s[j] === "'" && s[j + 1] === '!') { i = j + 2; return name; }
      return null;
    }
    const m = /^([A-Za-z_\u00C0-\u024F][\w\u00C0-\u024F.]*)!/.exec(s.slice(i));
    if (m) { i += m[0].length; return m[1]; }
    return null;
  };
  const readRefAt = () => {
    const m = RE_REF.exec(s.slice(i));
    if (m) { i += m[0].length; return { c: colIndex(m[2]), r: +m[4] - 1, absC: !!m[1], absR: !!m[3] }; }
    return null;
  };
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) { let j = i; while (j < s.length && /\s/.test(s[j])) j++; out.push({ t: 'ws', raw: s.slice(i, j) }); i = j; continue; }
    if (ch === '"') {
      let j = i + 1, v = '';
      while (j < s.length) {
        if (s[j] === '"' && s[j + 1] === '"') { v += '"'; j += 2; continue; }
        if (s[j] === '"') break;
        v += s[j++];
      }
      if (j >= s.length) throw new SyntaxError('Anführungszeichen fehlt');
      out.push({ t: 'str', v }); i = j + 1; continue;
    }
    if (ch === '#') {
      const m = ERR_RE.exec(s.slice(i));
      if (m) { out.push({ t: 'err', v: errFromCode(m[0].toUpperCase()) }); i += m[0].length; continue; }
      const last = out[out.length - 1];
      if (last && (last.t === 'ref')) { last.spill = true; i++; continue; }
      throw new SyntaxError('Unerwartetes Zeichen „#“');
    }
    if (ch === '{') { braces++; out.push({ t: '{' }); i++; continue; }
    if (ch === '}') { braces--; out.push({ t: '}' }); i++; continue; }
    if (braces > 0) {
      // inside array constants: en {1,2;3,4} · de {1.2;3.4}  (de decimals use ",")
      if (locale === 'de' ? ch === '.' : ch === ',') { out.push({ t: 'asep' }); i++; continue; }
      if (ch === ';') { out.push({ t: 'rsep' }); i++; continue; }
    }
    // whole rows 1:3
    const rm = /^(\$?)(\d{1,7}):(\$?)(\d{1,7})(?![\w(.,])/.exec(s.slice(i));
    if (rm && !/[A-Za-z]/.test(s[i - 1] || '')) {
      out.push({ t: 'range', sheet: null, a: { r: +rm[2] - 1, c: 0, absR: !!rm[1], absC: false, rowOnly: true }, b: { r: +rm[4] - 1, c: 16383, absR: !!rm[3], absC: false, rowOnly: true } });
      i += rm[0].length; continue;
    }
    // number
    const numRe = locale === 'de' ? /^(\d+(?:,\d*)?|,\d+)(?:[eE][+-]?\d+)?/ : /^(\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
    const nm = numRe.exec(s.slice(i));
    if (nm && !/^\d+[A-Za-z_]/.test(s.slice(i).replace(/^(\d+(?:[.,]\d*)?)[eE][+-]?\d+/, '$1'))) {
      out.push({ t: 'num', v: parseFloat(nm[0].replace(dec, '.')) }); i += nm[0].length; continue;
    }
    if (ch === '(') { out.push({ t: '(' }); i++; continue; }
    if (ch === ')') { out.push({ t: ')' }); i++; continue; }
    if (ch === sep) { out.push({ t: 'sep' }); i++; continue; }
    const two = s.slice(i, i + 2);
    if (['<=', '>=', '<>'].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/^&=<>%@'.includes(ch)) { out.push({ t: 'op', v: ch }); i++; continue; }
    // reference (with optional sheet)
    const start = i;
    const sheet = readSheetPrefix();
    const ref = readRefAt();
    if (ref) {
      if (s[i] === ':') {
        const save = i; i++;
        const sheet2 = readSheetPrefix();
        const ref2 = readRefAt();
        if (ref2) { out.push({ t: 'range', sheet: sheet ?? sheet2 ?? null, a: ref, b: ref2 }); continue; }
        i = save;
      }
      out.push({ t: 'ref', sheet: sheet ?? null, a: ref });
      continue;
    }
    // whole columns A:A
    const cm = RE_COL.exec(s.slice(i));
    if (cm && s[i + cm[0].length] === ':') {
      const save = i;
      i += cm[0].length + 1;
      const cm2 = RE_COL.exec(s.slice(i));
      if (cm2) {
        i += cm2[0].length;
        out.push({ t: 'range', sheet: sheet ?? null, a: { c: colIndex(cm[2]), r: 0, absC: !!cm[1], absR: false, colOnly: true }, b: { c: colIndex(cm2[2]), r: 1048575, absC: !!cm2[1], absR: false, colOnly: true } });
        continue;
      }
      i = save;
    }
    // whole rows with sheet: Tabelle1!1:3
    if (sheet != null) {
      const rr = /^(\$?)(\d{1,7}):(\$?)(\d{1,7})/.exec(s.slice(i));
      if (rr) { out.push({ t: 'range', sheet, a: { r: +rr[2] - 1, c: 0, absR: !!rr[1], rowOnly: true }, b: { r: +rr[4] - 1, c: 16383, absR: !!rr[3], rowOnly: true } }); i += rr[0].length; continue; }
      i = start;
    }
    const im = /^[A-Za-z_\u00C0-\u024F\\][\w.\u00C0-\u024F]*/.exec(s.slice(i));
    if (im) {
      const word = im[0];
      i += word.length;
      let j = i; while (j < s.length && s[j] === ' ') j++;
      if (s[j] === '(') { out.push({ t: 'fn', v: canonicalFn(word), raw: word }); i = j; continue; }
      const up = word.toUpperCase();
      if (up === 'TRUE' || up === 'WAHR') { out.push({ t: 'bool', v: true }); continue; }
      if (up === 'FALSE' || up === 'FALSCH') { out.push({ t: 'bool', v: false }); continue; }
      out.push({ t: 'name', v: word });
      continue;
    }
    throw new SyntaxError(`Unerwartetes Zeichen „${ch}“`);
  }
  return out;
}

// ---------------- serializer ----------------
function refText(a) {
  if (a.colOnly) return (a.absC ? '$' : '') + colName(a.c);
  if (a.rowOnly) return (a.absR ? '$' : '') + (a.r + 1);
  return (a.absC ? '$' : '') + colName(a.c) + (a.absR ? '$' : '') + (a.r + 1);
}
export function serialize(tokens, locale = 'en', { xlsx = false } = {}) {
  const sep = locale === 'de' ? ';' : ',';
  return tokens.map(t => {
    switch (t.t) {
      case 'ws': return t.raw;
      case 'num': { let s = String(t.v); if (/e/.test(s)) s = t.v.toExponential().replace('e+', 'E+').replace('e-', 'E-'); return locale === 'de' ? s.replace('.', ',') : s; }
      case 'str': return '"' + t.v.replace(/"/g, '""') + '"';
      case 'bool': return locale === 'de' ? (t.v ? 'WAHR' : 'FALSCH') : (t.v ? 'TRUE' : 'FALSE');
      case 'err': return locale === 'de' ? (ERR_DE[t.v.code] || t.v.code) : t.v.code;
      case 'ref': return (t.sheet != null ? quoteSheet(t.sheet) + '!' : '') + refText(t.a) + (t.spill ? '#' : '');
      case 'range': return (t.sheet != null ? quoteSheet(t.sheet) + '!' : '') + refText(t.a) + ':' + refText(t.b);
      case 'refErr': return locale === 'de' ? '#BEZUG!' : '#REF!';
      case 'fn': {
        if (locale === 'de') return EN_DE[t.v] || t.v;
        return xlsx && XLFN[t.v] ? XLFN[t.v] : t.v;
      }
      case 'sep': return sep;
      case 'asep': return locale === 'de' ? '.' : ',';
      case 'rsep': return ';';
      case 'name': return t.v;
      case '(': case ')': case '{': case '}': return t.t;
      default: return t.v;
    }
  }).join('');
}

/** User input (without "=") → canonical. Throws SyntaxError on invalid input. */
export function toCanonical(input) {
  const tryLoc = loc => { const t = tokenize(input, loc); parse(t); return serialize(t, 'en'); };
  const noStr = input.replace(/"[^"]*"/g, '');
  let preferDe = noStr.includes(';') || /\d,\d/.test(noStr);
  if (!noStr.includes(';')) {
    // decide by the function names: English-only names (POWER, IFERROR …) → English syntax
    const words = (noStr.match(/[A-Za-z_\u00C0-\u024F][\w.\u00C0-\u024F]*(?=\s*\()/g) || []).map(w => w.toUpperCase());
    const en = words.filter(w => KNOWN_FUNCTIONS.has(w) && EN_DE[w] !== w).length;
    const de = words.filter(w => DE_EN[w] && !KNOWN_FUNCTIONS.has(w)).length;
    if (en > de) preferDe = false; else if (de > en) preferDe = true;
  }
  try { return tryLoc(preferDe ? 'de' : 'en'); } catch (e1) {
    try { return tryLoc(preferDe ? 'en' : 'de'); } catch { throw e1; }
  }
}
/** Canonical → German display (for the formula bar). */
export function toDisplay(canonical) {
  try { return serialize(tokenize(canonical, 'en'), 'de'); } catch { return canonical; }
}
/** Canonical → text for xlsx files. */
export function toXlsx(canonical) {
  try {
    let tokens = tokenize(canonical, 'en');
    // LET parameters are written as _xlpm.name
    const params = new Set();
    tokens.forEach((t, i) => {
      if (t.t !== 'fn' || t.v !== 'LET') return;
      let depth = 0, argi = 0;
      for (let j = i + 1; j < tokens.length; j++) {
        const x = tokens[j];
        if (x.t === '(') { depth++; if (depth === 1 && tokens[j + 1] && tokens[j + 1].t === 'name') params.add(tokens[j + 1].v.toUpperCase()); continue; }
        if (x.t === ')') { depth--; if (!depth) break; continue; }
        if (x.t === 'sep' && depth === 1) { argi++; if (argi % 2 === 0 && tokens[j + 1] && tokens[j + 1].t === 'name' && tokens[j + 2] && tokens[j + 2].t === 'sep') params.add(tokens[j + 1].v.toUpperCase()); }
      }
    });
    if (params.size) tokens = tokens.map(t => (t.t === 'name' && params.has(t.v.toUpperCase()) ? { ...t, v: '_xlpm.' + t.v } : t));
    return serialize(tokens, 'en', { xlsx: true });
  } catch { return canonical; }
}
/** Function names used in a canonical formula. */
export function functionsIn(canonical) {
  try { return tokenize(canonical, 'en').filter(t => t.t === 'fn').map(t => t.v); } catch { return []; }
}

/** Shift references; fn(ref, sheetName) → ref | null (= #REF!). Applies to both ends of ranges. */
export function shiftRefs(canonical, fn) {
  let tokens;
  try { tokens = tokenize(canonical, 'en'); } catch { return canonical; }
  const out = tokens.map(t => {
    if (t.t === 'ref') { const a = fn(t.a, t.sheet, false); return a ? { ...t, a } : { t: 'refErr' }; }
    if (t.t === 'range') {
      const a = fn(t.a, t.sheet, 'start'), b = fn(t.b, t.sheet, 'end');
      if (!a || !b || (!a.colOnly && b.r < a.r) || (!a.rowOnly && b.c < a.c)) return { t: 'refErr' };
      return { ...t, a, b };
    }
    return t;
  });
  return serialize(out, 'en');
}
/** Rename a sheet inside formulas. */
export function renameSheetRefs(canonical, oldName, newName) {
  let tokens;
  try { tokens = tokenize(canonical, 'en'); } catch { return canonical; }
  const lo = String(oldName).toLowerCase();
  let hit = false;
  const out = tokens.map(t => ((t.t === 'ref' || t.t === 'range') && t.sheet != null && t.sheet.toLowerCase() === lo ? (hit = true, { ...t, sheet: newName }) : t));
  return hit ? serialize(out, 'en') : canonical;
}

// ---------------- parser ----------------
// precedence: comparison < concat < additive < multiplicative < power < unary < percent
export function parse(tokens) {
  const toks = tokens.filter(t => t.t !== 'ws');
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const expect = t => { const x = next(); if (!x || x.t !== t) throw new SyntaxError(t === ')' ? 'Klammer fehlt' : 'Ungültige Formel'); return x; };
  const isOp = (t, ...ops) => t && t.t === 'op' && ops.includes(t.v);

  function cmp() {
    let a = concat();
    while (isOp(peek(), '=', '<>', '<', '>', '<=', '>=')) { const op = next().v; a = { k: 'bin', op, a, b: concat() }; }
    return a;
  }
  function concat() {
    let a = add();
    while (isOp(peek(), '&')) { next(); a = { k: 'bin', op: '&', a, b: add() }; }
    return a;
  }
  function add() {
    let a = mul();
    while (isOp(peek(), '+', '-')) { const op = next().v; a = { k: 'bin', op, a, b: mul() }; }
    return a;
  }
  function mul() {
    let a = pow();
    while (isOp(peek(), '*', '/')) { const op = next().v; a = { k: 'bin', op, a, b: pow() }; }
    return a;
  }
  function pow() {
    let a = unary();
    while (isOp(peek(), '^')) { next(); a = { k: 'bin', op: '^', a, b: unary() }; }
    return a;
  }
  function unary() {
    if (isOp(peek(), '-')) { next(); return { k: 'neg', a: unary() }; }
    if (isOp(peek(), '+')) { next(); return unary(); }
    if (isOp(peek(), '@')) { next(); return { k: 'at', a: unary() }; }
    return pct();
  }
  function pct() {
    let a = primary();
    while (isOp(peek(), '%')) { next(); a = { k: 'pct', a }; }
    return a;
  }
  function arrayConst() {
    const rows = [[]];
    for (;;) {
      let t = next();
      if (!t) throw new SyntaxError('Klammer fehlt');
      let neg = false;
      if (t.t === 'op' && t.v === '-') { neg = true; t = next(); }
      if (!t || !['num', 'str', 'bool', 'err'].includes(t.t)) throw new SyntaxError('Ungültige Matrix');
      rows[rows.length - 1].push(neg ? -t.v : t.v);
      const x = next();
      if (!x) throw new SyntaxError('Klammer fehlt');
      if (x.t === '}') break;
      if (x.t === 'asep' || x.t === 'sep') continue;
      if (x.t === 'rsep') { rows.push([]); continue; }
      throw new SyntaxError('Ungültige Matrix');
    }
    const w = rows[0].length;
    if (rows.some(r => r.length !== w)) throw new SyntaxError('Ungültige Matrix');
    return { k: 'lit', v: new Arr(rows) };
  }
  function primary() {
    const t = next();
    if (!t) throw new SyntaxError('Formel unvollständig');
    switch (t.t) {
      case 'num': case 'str': case 'bool': case 'err': return { k: 'lit', v: t.v };
      case 'ref': return t.spill ? { k: 'spill', sheet: t.sheet, r: t.a.r, c: t.a.c } : { k: 'ref', sheet: t.sheet, r: t.a.r, c: t.a.c };
      case 'range': return { k: 'range', sheet: t.sheet, r1: Math.min(t.a.r, t.b.r), c1: Math.min(t.a.c, t.b.c), r2: Math.max(t.a.r, t.b.r), c2: Math.max(t.a.c, t.b.c) };
      case 'name': return { k: 'name', v: t.v };
      case 'refErr': return { k: 'lit', v: ERR.REF };
      case '{': return arrayConst();
      case '(': { const e = cmp(); expect(')'); return e; }
      case 'fn': {
        expect('(');
        const args = [];
        if (peek() && peek().t === ')') { next(); return { k: 'fn', name: t.v, args }; }
        for (;;) {
          if (peek() && (peek().t === 'sep' || peek().t === ')')) args.push({ k: 'missing' });
          else args.push(cmp());
          const x = next();
          if (!x) throw new SyntaxError('Klammer fehlt');
          if (x.t === ')') break;
          if (x.t !== 'sep') throw new SyntaxError('Ungültige Formel');
        }
        return { k: 'fn', name: t.v, args };
      }
      default: throw new SyntaxError('Ungültige Formel');
    }
  }
  const ast = cmp();
  if (p < toks.length) throw new SyntaxError('Ungültige Formel');
  return ast;
}

const astCache = new Map();
export function compile(canonical) {
  let a = astCache.get(canonical);
  if (a) return a;
  try { a = parse(tokenize(canonical, 'en')); } catch { a = { k: 'lit', v: ERR.NAME }; }
  if (astCache.size > 20000) astCache.clear();
  astCache.set(canonical, a);
  return a;
}

/** Precedents of an AST: [{sheet, r1, c1, r2, c2}] plus flags {names:[...], volatile, spills:[...]} */
export function precedents(ast) {
  const refs = [], names = [], spills = [];
  let volatile = false;
  const walk = n => {
    if (!n) return;
    switch (n.k) {
      case 'ref': refs.push({ sheet: n.sheet, r1: n.r, c1: n.c, r2: n.r, c2: n.c }); break;
      case 'spill': spills.push({ sheet: n.sheet, r: n.r, c: n.c }); refs.push({ sheet: n.sheet, r1: n.r, c1: n.c, r2: n.r, c2: n.c }); break;
      case 'range': refs.push({ sheet: n.sheet, r1: n.r1, c1: n.c1, r2: n.r2, c2: n.c2 }); break;
      case 'name': names.push(n.v); break;
      case 'neg': case 'pct': case 'at': walk(n.a); break;
      case 'bin': walk(n.a); walk(n.b); break;
      case 'fn': if (VOLATILE.has(n.name)) volatile = true; n.args.forEach(walk); break;
    }
  };
  walk(ast);
  return { refs, names, spills, volatile };
}

// ---------------- evaluation ----------------
// ctx: { sheet, cur:{r,c}, get(si, r, c), sheetIndex(name), bound(si) → {maxR, maxC}, name(n) → canonical|null,
//        fmt(v, code), isFormula(si,r,c), formulaOf(si,r,c), rowHidden(si,r), spillOf(si,r,c) → {h,w}|null, dynamic }
export function evaluate(ast, ctx, { dynamic = false } = {}) {
  let v;
  const prevLegacy = ctx.legacy, prevDepth = ctx.fnDepth;
  ctx.legacy = !dynamic; ctx.fnDepth = 0;
  try { v = ev(ast, ctx); } catch (e) { if (e instanceof RangeError) return ERR.CIRC; throw e; } finally { ctx.legacy = prevLegacy; ctx.fnDepth = prevDepth; }
  if (v === undefined) return null;
  if (v && v.range) {
    if (v.r1 === v.r2 && v.c1 === v.c2) return ctx.get(v.sheet, v.r1, v.c1);
    return dynamic ? rangeToArr(v, ctx) : implicitIntersect(v, ctx);
  }
  if (v instanceof Arr) {
    if (v.h === 1 && v.w === 1) return v.rows[0][0];
    return dynamic ? v : v.rows[0][0];
  }
  return v;
}

function implicitIntersect(rg, ctx) {
  const cur = ctx.cur;
  if (rg.r1 === rg.r2 && rg.c1 === rg.c2) return ctx.get(rg.sheet, rg.r1, rg.c1);
  if (cur && rg.sheet === ctx.sheet) {
    if (rg.c1 === rg.c2 && cur.r >= rg.r1 && cur.r <= rg.r2) return ctx.get(rg.sheet, cur.r, rg.c1);
    if (rg.r1 === rg.r2 && cur.c >= rg.c1 && cur.c <= rg.c2) return ctx.get(rg.sheet, rg.r1, cur.c);
  }
  if (cur && (rg.c1 === rg.c2 && cur.r >= rg.r1 && cur.r <= rg.r2)) return ctx.get(rg.sheet, cur.r, rg.c1);
  return ctx.get(rg.sheet, rg.r1, rg.c1);
}

function rangeToArr(rg, ctx) {
  const rows = [];
  for (let r = rg.r1; r <= rg.r2; r++) { const row = []; for (let c = rg.c1; c <= rg.c2; c++) { const v = ctx.get(rg.sheet, r, c); row.push(v === undefined ? null : v); } rows.push(row); }
  return new Arr(rows);
}

function sheetOf(name, ctx) {
  if (name == null) return ctx.sheet;
  return ctx.sheetIndex(name);
}

function clampRange(s, r1, c1, r2, c2, ctx) {
  // whole columns/rows (A:A, 1:1) are limited to the used area; explicit ranges stay exact
  if (r2 < 1048575 && c2 < 16383) return { range: true, sheet: s, r1, c1, r2, c2 };
  const b = ctx.bound(s);
  return { range: true, sheet: s, r1, c1, r2: r2 >= 1048575 ? Math.min(r2, Math.max(r1, b.maxR)) : r2, c2: c2 >= 16383 ? Math.min(c2, Math.max(c1, b.maxC)) : c2 };
}

let nameDepth = 0;
function ev(n, ctx) {
  switch (n.k) {
    case 'lit': return n.v;
    case 'missing': return null;
    case 'ref': {
      const s = sheetOf(n.sheet, ctx);
      if (s < 0) return ERR.REF;
      return { range: true, sheet: s, r1: n.r, c1: n.c, r2: n.r, c2: n.c };
    }
    case 'spill': {
      const s = sheetOf(n.sheet, ctx);
      if (s < 0) return ERR.REF;
      ctx.get(s, n.r, n.c);
      const sp = ctx.spillOf ? ctx.spillOf(s, n.r, n.c) : null;
      if (!sp) return ERR.REF;
      return { range: true, sheet: s, r1: n.r, c1: n.c, r2: n.r + sp.h - 1, c2: n.c + sp.w - 1 };
    }
    case 'range': {
      const s = sheetOf(n.sheet, ctx);
      if (s < 0) return ERR.REF;
      return clampRange(s, n.r1, n.c1, n.r2, n.c2, ctx);
    }
    case 'name': {
      if (ctx.locals) { const u = n.v.toUpperCase(); if (u in ctx.locals) return ctx.locals[u]; }
      const def = ctx.name ? ctx.name(n.v) : null;
      if (def == null) return ERR.NAME;
      if (nameDepth > 20) return ERR.CIRC;
      nameDepth++;
      try {
        const ast = compile(def.f || def);
        const prev = ctx.sheet;
        if (def.si != null && def.si >= 0) ctx.sheet = def.si;
        const v = ev(ast, ctx);
        ctx.sheet = prev;
        return v;
      } finally { nameDepth--; }
    }
    case 'neg': return mapUnary(legacy(ev(n.a, ctx), ctx), ctx, x => { const v = num(x); return isErr(v) ? v : -v; });
    case 'pct': return mapUnary(legacy(ev(n.a, ctx), ctx), ctx, x => { const v = num(x); return isErr(v) ? v : v / 100; });
    case 'at': { const v = ev(n.a, ctx); if (v && v.range) return implicitIntersect(v, ctx); if (v instanceof Arr) return v.rows[0][0]; return v; }
    case 'bin': return binop(n.op, legacy(ev(n.a, ctx), ctx), legacy(ev(n.b, ctx), ctx), ctx);
    case 'fn': { ctx.fnDepth = (ctx.fnDepth || 0) + 1; try { return callFn(n, ctx); } finally { ctx.fnDepth--; } }
  }
  return ERR.VALUE;
}

/** Legacy (pre-dynamic-array) formulas: operators outside of functions use implicit intersection. */
const legacy = (v, ctx) => (ctx.legacy && !ctx.fnDepth && v && v.range && (v.r1 !== v.r2 || v.c1 !== v.c2) ? implicitIntersect(v, ctx) : v);
const isMulti = v => (v && v.range && (v.r1 !== v.r2 || v.c1 !== v.c2)) || (v instanceof Arr && (v.h > 1 || v.w > 1));
/** Value grid of a range/array/scalar. */
function grid(v, ctx) {
  if (v && v.range) {
    const rows = [];
    for (let r = v.r1; r <= v.r2; r++) { const row = []; for (let c = v.c1; c <= v.c2; c++) row.push(ctx.get(v.sheet, r, c)); rows.push(row); }
    return rows;
  }
  if (v instanceof Arr) return v.rows;
  return [[v]];
}
function scalar(v, ctx) {
  if (v && v.range) return v.r1 === v.r2 && v.c1 === v.c2 ? ctx.get(v.sheet, v.r1, v.c1) : implicitIntersect(v, ctx);
  if (v instanceof Arr) return v.rows.length ? v.rows[0][0] : ERR.VALUE;
  return v;
}
function mapUnary(v, ctx, f) {
  if (isMulti(v)) return new Arr(grid(v, ctx).map(row => row.map(x => f(x))));
  return f(scalar(v, ctx));
}
function broadcast(vals, ctx, f) {
  const grids = vals.map(v => (isMulti(v) ? grid(v, ctx) : null));
  const H = Math.max(...grids.map((g, i) => (g ? g.length : 1)));
  const W = Math.max(...grids.map(g => (g ? (g[0] || []).length : 1)));
  const sc = vals.map((v, i) => (grids[i] ? null : scalar(v, ctx)));
  const rows = [];
  for (let r = 0; r < H; r++) {
    const row = [];
    for (let c = 0; c < W; c++) {
      const args = vals.map((v, i) => {
        const g = grids[i];
        if (!g) return sc[i];
        const gh = g.length, gw = (g[0] || []).length;
        const rr = gh === 1 ? 0 : r, cc = gw === 1 ? 0 : c;
        if (rr >= gh || cc >= gw) return ERR.NA;
        return g[rr][cc];
      });
      row.push(f(...args));
    }
    rows.push(row);
  }
  return new Arr(rows);
}

// ---------------- coercion ----------------
export function parseNumberText(s) {
  const t = String(s).trim().replace(/\s|€/g, '');
  if (!t) return null;
  if (/^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return parseFloat(t.replace(/\./g, '').replace(',', '.'));
  if (/^[-+]?\d+,\d+$/.test(t)) return parseFloat(t.replace(',', '.'));
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return parseFloat(t);
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return parseFloat(t.replace(/,/g, ''));
  if (/^[-+]?,\d+$/.test(t)) return parseFloat(t.replace(',', '.'));
  return null;
}
const MONTH_NAMES = ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'];
const MONTH_EN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
/** German/ISO date or time text → serial number (null if not a date). */
export function parseDateText(s) {
  const t = String(s).trim();
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  if (m) {
    let y = m[3] ? +m[3] : new Date().getFullYear();
    if (y < 100) y += y < 30 ? 2000 : 1900;
    const mo = +m[2], d = +m[1];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const v = (Date.UTC(y, mo - 1, d) - EPOCH) / 86400000;
    if (new Date(EPOCH + v * 86400000).getUTCMonth() !== mo - 1) return null;
    return v + (m[4] ? (+m[4] * 3600 + +m[5] * 60 + +(m[6] || 0)) / 86400 : 0);
  }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  if (m) return (Date.UTC(+m[1], +m[2] - 1, +m[3]) - EPOCH) / 86400000 + (m[4] ? (+m[4] * 3600 + +m[5] * 60 + +(m[6] || 0)) / 86400 : 0);
  m = /^(\d{1,2})\.?\s+([A-Za-zäÄ]+)\.?\s+(\d{4})$/.exec(t);
  if (m) {
    const name = m[2].toLowerCase();
    let mi = MONTH_NAMES.findIndex(x => x.startsWith(name.slice(0, 3)));
    if (mi < 0) mi = MONTH_EN.findIndex(x => x.startsWith(name.slice(0, 3)));
    if (mi < 0) return null;
    return (Date.UTC(+m[3], mi, +m[1]) - EPOCH) / 86400000;
  }
  m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(am|pm))?$/i.exec(t);
  if (m) {
    let h = +m[1];
    if (m[4]) { h = h % 12 + (m[4].toLowerCase() === 'pm' ? 12 : 0); }
    if (h > 23 || +m[2] > 59 || +(m[3] || 0) > 59) return null;
    return (h * 3600 + +m[2] * 60 + +(m[3] || 0)) / 86400;
  }
  return null;
}
function num(v) {
  if (isErr(v)) return v;
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Arr) return num(v.rows[0][0]);
  const n = parseNumberText(v);
  if (n !== null) return n;
  const p = /^\s*([-+]?[\d.,]+)\s*%\s*$/.exec(v);
  if (p) { const x = parseNumberText(p[1]); if (x !== null) return x / 100; }
  const d = parseDateText(v);
  return d === null ? ERR.VALUE : d;
}
function str(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'WAHR' : 'FALSCH';
  if (typeof v === 'number') return fmtGeneral(v);
  if (isErr(v)) return ERR_DE[v.code] || v.code;
  return String(v);
}
export function fmtGeneral(v) {
  if (!Number.isFinite(v)) return '#ZAHL!';
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-9 || a >= 1e15)) return v.toExponential(5).replace('.', ',').replace('e+', 'E+').replace('e-', 'E-');
  return String(+v.toPrecision(15)).replace('.', ',');
}
function bool(v) {
  if (isErr(v)) return v;
  if (typeof v === 'boolean') return v;
  if (v === null || v === '' || v === undefined) return false;
  if (typeof v === 'number') return v !== 0;
  const u = String(v).toUpperCase();
  if (u === 'TRUE' || u === 'WAHR') return true;
  if (u === 'FALSE' || u === 'FALSCH') return false;
  return ERR.VALUE;
}

function typeRank(v) { return typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : isErr(v) ? 3 : 0; }
export function compareValues(a, b) {
  if (a === null || a === undefined) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b === null || b === undefined) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  const ra = typeRank(a), rb = typeRank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === 'string') return a.localeCompare(b, 'de', { sensitivity: 'accent' });
  if (isErr(a)) return 0;
  return a < b ? -1 : a > b ? 1 : 0;
}
const tame = r => (Math.abs(r) < 1e15 && r !== 0 ? +r.toPrecision(15) : r);

function binScalar(op, a, b) {
  if (isErr(a)) return a;
  if (isErr(b)) return b;
  if (op === '&') return str(a) + str(b);
  if (['=', '<>', '<', '>', '<=', '>='].includes(op)) {
    const c = compareValues(a, b);
    return { '=': c === 0, '<>': c !== 0, '<': c < 0, '>': c > 0, '<=': c <= 0, '>=': c >= 0 }[op];
  }
  const x = num(a), y = num(b);
  if (isErr(x)) return x;
  if (isErr(y)) return y;
  let r;
  switch (op) {
    case '+': r = x + y; break;
    case '-': r = x - y; break;
    case '*': r = x * y; break;
    case '/': if (y === 0) return ERR.DIV0; r = x / y; break;
    case '^': if (x === 0 && y < 0) return ERR.DIV0; r = Math.pow(x, y); break;
  }
  if (!Number.isFinite(r)) return ERR.NUM;
  return tame(r);
}
function binop(op, a, b, ctx) {
  if (isMulti(a) || isMulti(b)) return broadcast([a, b], ctx, (x, y) => binScalar(op, x, y));
  return binScalar(op, scalar(a, ctx), scalar(b, ctx));
}

// iterate values of args: ranges/arrays yield cell values (flagged), scalars yield themselves
function* values(args, ctx) {
  for (const a of args) {
    const v = ev(a, ctx);
    if (v && v.range) {
      for (let r = v.r1; r <= v.r2; r++) for (let c = v.c1; c <= v.c2; c++) yield { v: ctx.get(v.sheet, r, c), fromRange: true, r, c, sheet: v.sheet };
    } else if (v instanceof Arr) {
      for (const row of v.rows) for (const x of row) yield { v: x, fromRange: true };
    } else yield { v, fromRange: false };
  }
}
function numbersOf(args, ctx, { filter } = {}) {
  const out = [];
  for (const it of values(args, ctx)) {
    const v = it.v;
    if (filter && it.r != null && !filter(it)) continue;
    if (isErr(v)) return v;
    if (typeof v === 'number') out.push(v);
    else if (!it.fromRange && v !== null && v !== '') { const n = num(v); if (isErr(n)) return n; out.push(n); }
  }
  return out;
}
/** Numbers of args with "A" semantics (text → 0, TRUE → 1 also inside ranges). */
function numbersA(args, ctx) {
  const out = [];
  for (const { v, fromRange } of values(args, ctx)) {
    if (isErr(v)) return v;
    if (typeof v === 'number') out.push(v);
    else if (typeof v === 'boolean') out.push(v ? 1 : 0);
    else if (typeof v === 'string') { if (fromRange) out.push(0); else { const n = num(v); if (isErr(n)) return n; out.push(n); } }
  }
  return out;
}
const flatVals = (v, ctx) => grid(v, ctx).flat();

function wildcardRe(pat, anchored = true) {
  const src = pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/~\*/g, '\u0001').replace(/~\?/g, '\u0002').replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\u0001/g, '\\*').replace(/\u0002/g, '\\?');
  return new RegExp(anchored ? '^' + src + '$' : src, 'is');
}
export function criterion(crit) {
  if (isErr(crit)) return v => isErr(v) && v.code === crit.code;
  if (typeof crit === 'number') return v => (typeof v === 'number' && v === crit) || (typeof v === 'string' && parseNumberText(v) === crit);
  if (typeof crit === 'boolean') return v => v === crit;
  const s = String(crit ?? '');
  const m = /^(<=|>=|<>|=|<|>)?(.*)$/s.exec(s);
  const op = m[1] || '=';
  const raw = m[2];
  if (raw === '' && op === '=' && m[1]) return v => v === null || v === undefined || v === '';
  if (raw === '' && op === '<>') return v => !(v === null || v === undefined || v === '');
  if (raw === '' && !m[1]) return v => v === null || v === undefined || v === '';
  let n = parseNumberText(raw);
  if (n === null) { const d = parseDateText(raw); if (d !== null) n = d; }
  if (n === null && /^\s*[-+]?[\d.,]+\s*%\s*$/.test(raw)) n = parseNumberText(raw.replace('%', '')) / 100;
  if (n !== null) {
    return v => {
      let x = v;
      if (typeof x === 'string') { const p = parseNumberText(x); if (p === null) return op === '<>'; x = p; }
      if (typeof x !== 'number') return op === '<>';
      return { '=': x === n, '<>': x !== n, '<': x < n, '>': x > n, '<=': x <= n, '>=': x >= n }[op];
    };
  }
  const ub = raw.toUpperCase();
  if (ub === 'WAHR' || ub === 'TRUE' || ub === 'FALSCH' || ub === 'FALSE') {
    const b = ub === 'WAHR' || ub === 'TRUE';
    return v => (op === '<>' ? v !== b : v === b);
  }
  const re = wildcardRe(raw);
  return v => {
    const t = v === null || v === undefined ? '' : typeof v === 'string' ? v : null;
    if (op === '=') return t !== null && re.test(t);
    if (op === '<>') return t === null || !re.test(t);
    if (t === null) return false;
    const c = t.localeCompare(raw, 'de', { sensitivity: 'accent' });
    return { '<': c < 0, '>': c > 0, '<=': c <= 0, '>=': c >= 0 }[op];
  };
}

const EPOCH = Date.UTC(1899, 11, 30);
export function dateToSerial(d) { return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH) / 86400000; }
export function serialToDate(s) { return new Date(EPOCH + Math.round(s * 86400000)); } // UTC based
const ymd = s => { const d = new Date(EPOCH + Math.floor(s + 1e-9) * 86400000); return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay() }; };
const serial = (y, m, d) => (Date.UTC(y, m, d) - EPOCH) / 86400000;
const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
function roundHalfAway(x, n) {
  const f = Math.pow(10, n);
  const r = Math.sign(x) * Math.round(Math.abs(x) * f * (1 + 1e-15)) / f;
  return +r.toPrecision(15);
}

// cp1252 (CHAR/CODE)
const CP1252 = { 128: 8364, 130: 8218, 131: 402, 132: 8222, 133: 8230, 134: 8224, 135: 8225, 136: 710, 137: 8240, 138: 352, 139: 8249, 140: 338, 142: 381, 145: 8216, 146: 8217, 147: 8220, 148: 8221, 149: 8226, 150: 8211, 151: 8212, 152: 732, 153: 8482, 154: 353, 155: 8250, 156: 339, 158: 382, 159: 376 };
const CP1252_REV = Object.fromEntries(Object.entries(CP1252).map(([k, v]) => [v, +k]));

// ---------------- function helpers ----------------
const argN = (A, i, ctx) => (A[i] && A[i].k !== 'missing' ? scalar(ev(A[i], ctx), ctx) : null);
const has = (A, i) => A.length > i && A[i].k !== 'missing';
/** Scalar function with array lifting: f receives evaluated scalars. */
function lift(A, ctx, f, { min = 0, max = Infinity, liftIdx = null } = {}) {
  if (A.length < min || A.length > max) return ERR.VALUE;
  const vals = A.map(a => (a.k === 'missing' ? undefined : ev(a, ctx)));
  const multi = vals.some((v, i) => isMulti(v) && (!liftIdx || liftIdx.includes(i)));
  if (!multi) return f(...vals.map(v => (v === undefined ? undefined : scalar(v, ctx))));
  return broadcast(vals.map((v, i) => (liftIdx && !liftIdx.includes(i) && isMulti(v) ? scalar(v, ctx) : v)), ctx, f);
}
const N1 = (fn) => (A, ctx) => lift(A, ctx, (x) => { const n = num(x); return isErr(n) ? n : fn(n); }, { min: 1, max: 1 });
const firstErr = (...xs) => xs.find(isErr);
const nOr = (v, d) => (v === undefined || v === null ? d : num(v));

function stats(xs) {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const ss = xs.reduce((a, b) => a + (b - mean) ** 2, 0);
  return { n, mean, ss };
}
function percentileInc(xs, k) {
  if (!xs.length || k < 0 || k > 1) return ERR.NUM;
  const s = [...xs].sort((a, b) => a - b);
  const pos = k * (s.length - 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return tame(s[lo] + (s[hi] - s[lo]) * (pos - lo));
}
function rangeArg(A, i, ctx) { return A[i] ? ev(A[i], ctx) : null; }

function ifsAgg(A, ctx, off, kind) {
  const target = off ? ev(A[0], ctx) : null;
  const pairs = [];
  for (let i = off; i + 1 < A.length; i += 2) pairs.push({ g: grid(ev(A[i], ctx), ctx), test: criterion(argN(A, i + 1, ctx)) });
  if (!pairs.length || (A.length - off) % 2) return ERR.VALUE;
  const g0 = pairs[0].g;
  const H = g0.length, W = (g0[0] || []).length;
  if (pairs.some(p => p.g.length !== H || (p.g[0] || []).length !== W)) return ERR.VALUE;
  const tg = target ? grid(target, ctx) : null;
  if (tg && (tg.length !== H || (tg[0] || []).length !== W)) return ERR.VALUE;
  let total = 0, count = 0, mx = -Infinity, mn = Infinity, any = false;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (!pairs.every(p => p.test(p.g[r][c]))) continue;
    count++;
    if (tg) {
      const v = tg[r][c];
      if (isErr(v) && kind !== 'count') return v;
      if (typeof v === 'number') { total += v; any = true; if (v > mx) mx = v; if (v < mn) mn = v; } else if (kind === 'avg') count--;
    }
  }
  if (kind === 'count') return count;
  if (kind === 'sum') return tame(total);
  if (kind === 'avg') return count && any ? tame(total / count) : ERR.DIV0;
  if (kind === 'max') return any ? mx : 0;
  if (kind === 'min') return any ? mn : 0;
  return ERR.VALUE;
}

function lookupIndex(key, vec, mode, search) {
  // mode: 0 exact, -1 exact/next smaller, 1 exact/next larger, 2 wildcard
  const n = vec.length;
  const order = search < 0 ? Array.from({ length: n }, (_, i) => n - 1 - i) : Array.from({ length: n }, (_, i) => i);
  if (mode === 2 && typeof key === 'string') { const re = wildcardRe(key); for (const i of order) if (typeof vec[i] === 'string' && re.test(vec[i])) return i; return -1; }
  const eq = v => (typeof key === 'string' ? typeof v === 'string' && v.localeCompare(key, 'de', { sensitivity: 'accent' }) === 0 : v === key || (v != null && typeof v === typeof key && compareValues(v, key) === 0));
  for (const i of order) if (eq(vec[i])) return i;
  if (mode === -1 || mode === 1) {
    let best = -1;
    for (const i of order) {
      const v = vec[i];
      if (v === null || v === undefined || typeRank(v) !== typeRank(key)) continue;
      const c = compareValues(v, key);
      if (mode === -1 && c < 0 && (best < 0 || compareValues(v, vec[best]) > 0)) best = i;
      if (mode === 1 && c > 0 && (best < 0 || compareValues(v, vec[best]) < 0)) best = i;
    }
    return best;
  }
  return -1;
}
function approxSorted(key, vec, desc = false) {
  let found = -1;
  for (let i = 0; i < vec.length; i++) {
    const v = vec[i];
    if (v === null || v === undefined || typeRank(v) !== typeRank(key)) continue;
    const c = compareValues(v, key);
    if (desc ? c >= 0 : c <= 0) found = i; else break;
  }
  return found;
}

function weekdayOf(s, type = 1) {
  const wd = ymd(s).wd; // 0 = Sunday
  if (type === 1 || type === 17) return wd + 1;
  if (type === 2 || type === 11) return ((wd + 6) % 7) + 1;
  if (type === 3) return (wd + 6) % 7;
  if (type >= 12 && type <= 16) { const start = type - 10; return ((wd - start + 7) % 7) + 1; }
  return ERR.NUM;
}
function isoWeek(s) {
  const { y, m, d } = ymd(s);
  const date = new Date(Date.UTC(y, m, d));
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((date - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
}
function weekendMask(w) {
  // returns array[7] indexed by JS weekday (0=Sun) → true if weekend
  if (w === undefined || w === null) w = 1;
  if (typeof w === 'string') { if (!/^[01]{7}$/.test(w) || w === '1111111') return null; return [w[6], w[0], w[1], w[2], w[3], w[4], w[5]].map(x => x === '1'); }
  const pairs = { 1: [6, 0], 2: [0, 1], 3: [1, 2], 4: [2, 3], 5: [3, 4], 6: [4, 5], 7: [5, 6] };
  const singles = { 11: 0, 12: 1, 13: 2, 14: 3, 15: 4, 16: 5, 17: 6 };
  const m = new Array(7).fill(false);
  if (pairs[w]) pairs[w].forEach(i => { m[i] = true; });
  else if (singles[w] !== undefined) m[singles[w]] = true;
  else return null;
  return m;
}
function holidaysOf(A, i, ctx) {
  if (!has(A, i)) return new Set();
  const out = new Set();
  for (const v of flatVals(ev(A[i], ctx), ctx)) { if (isErr(v)) return v; if (typeof v === 'number') out.add(Math.floor(v)); }
  return out;
}
function networkdays(s, e, mask, hol) {
  s = Math.floor(s); e = Math.floor(e);
  const sign = s <= e ? 1 : -1;
  if (sign < 0) [s, e] = [e, s];
  let n = 0;
  for (let x = s; x <= e; x++) { if (!mask[ymd(x).wd] && !hol.has(x)) n++; }
  return n * sign;
}
function workday(s, days, mask, hol) {
  let x = Math.floor(s);
  const step = days >= 0 ? 1 : -1;
  let left = Math.abs(Math.trunc(days));
  let guard = 0;
  while (left > 0 && guard++ < 1e6) { x += step; if (!mask[ymd(x).wd] && !hol.has(x)) left--; }
  return x;
}
function edate(s, months) {
  const { y, m, d } = ymd(s);
  const tm = m + Math.trunc(months);
  const ty = y + Math.floor(tm / 12), mm = ((tm % 12) + 12) % 12;
  return serial(ty, mm, Math.min(d, daysInMonth(ty, mm)));
}
function days360(s, e, eu) {
  const a = ymd(s), b = ymd(e);
  let d1 = a.d, d2 = b.d;
  if (eu) { if (d1 === 31) d1 = 30; if (d2 === 31) d2 = 30; }
  else {
    const lastFebA = a.m === 1 && d1 === daysInMonth(a.y, 1);
    const lastFebB = b.m === 1 && d2 === daysInMonth(b.y, 1);
    if (lastFebA && lastFebB) d2 = 30;
    if (lastFebA) d1 = 30;
    if (d2 === 31 && d1 >= 30) d2 = 30;
    if (d1 === 31) d1 = 30;
  }
  return (b.y - a.y) * 360 + (b.m - a.m) * 30 + (d2 - d1);
}
function yearfrac(s, e, basis) {
  if (s > e) [s, e] = [e, s];
  s = Math.floor(s); e = Math.floor(e);
  switch (basis) {
    case 0: return days360(s, e, false) / 360;
    case 1: {
      const a = ymd(s), b = ymd(e);
      const leap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
      if (a.y === b.y || (b.y === a.y + 1 && (b.m < a.m || (b.m === a.m && b.d <= a.d)))) {
        let den = leap(a.y) ? 366 : 365;
        if (a.y !== b.y) { const feb29InRange = (leap(a.y) && (a.m < 2)) || (leap(b.y) && (b.m > 1 || (b.m === 1 && b.d === 29))); den = feb29InRange ? 366 : 365; }
        return (e - s) / den;
      }
      let tot = 0; for (let y = a.y; y <= b.y; y++) tot += leap(y) ? 366 : 365;
      return (e - s) / (tot / (b.y - a.y + 1));
    }
    case 2: return (e - s) / 360;
    case 3: return (e - s) / 365;
    case 4: return days360(s, e, true) / 360;
  }
  return ERR.NUM;
}
// financial
function fvCalc(r, n, pmt, pv, type) {
  if (r === 0) return -(pv + pmt * n);
  const f = Math.pow(1 + r, n);
  return -(pv * f + pmt * (1 + r * type) * (f - 1) / r);
}
function pmtCalc(r, n, pv, fv, type) {
  if (r === 0) return -(pv + fv) / n;
  const f = Math.pow(1 + r, n);
  return -(r * (fv + pv * f)) / ((1 + r * type) * (f - 1));
}
function ipmtCalc(r, per, n, pv, fv, type) {
  const pmt = pmtCalc(r, n, pv, fv, type);
  let interest;
  if (per === 1) interest = type === 1 ? 0 : -pv;
  else interest = type === 1 ? fvCalc(r, per - 2, pmt, pv, 1) - pmt : fvCalc(r, per - 1, pmt, pv, 0);
  return interest * r;
}
function newton(f, guess, df) {
  let x = guess;
  for (let i = 0; i < 200; i++) {
    const y = f(x);
    if (!Number.isFinite(y)) break;
    if (Math.abs(y) < 1e-10) return x;
    const d = df ? df(x) : (f(x + 1e-6) - f(x - 1e-6)) / 2e-6;
    if (!d || !Number.isFinite(d)) break;
    const nx = x - y / d;
    if (Math.abs(nx - x) < 1e-13) return nx;
    x = nx;
  }
  if (Number.isFinite(x) && Math.abs(f(x)) < 1e-7) return x;
  // fallback: bisection over a sign change in (-0.99, 10)
  let lo = -0.99, flo = f(lo);
  for (let k = 1; k <= 400; k++) {
    const hi = -0.99 + k * 0.0275, fhi = f(hi);
    if (Number.isFinite(flo) && Number.isFinite(fhi) && flo * fhi <= 0) {
      let a = lo, b = hi, fa = flo;
      for (let j = 0; j < 200; j++) { const m = (a + b) / 2, fm = f(m); if (fa * fm <= 0) b = m; else { a = m; fa = fm; } }
      return (a + b) / 2;
    }
    lo = hi; flo = fhi;
  }
  return null;
}
function sortRowsBy(rows, keys) {
  // keys: [{get(row, idx) → value, order}]
  const idx = rows.map((r, i) => i);
  idx.sort((a, b) => {
    for (const k of keys) {
      const x = k.get(a), y = k.get(b);
      const ex = x === null || x === undefined || x === '', ey = y === null || y === undefined || y === '';
      if (ex || ey) { if (ex !== ey) return ex ? 1 : -1; continue; }
      const c = compareValues(x, y);
      if (c) return k.order < 0 ? -c : c;
    }
    return a - b;
  });
  return idx;
}
const keyOf = v => (typeof v === 'string' ? 's:' + v.toLocaleLowerCase('de') : typeof v + ':' + String(isErr(v) ? v.code : v));

// ---------------- the function table ----------------
const F = {};
const def = (names, fn) => names.split(' ').forEach(n => { F[n] = fn; });

// math
def('SUM', (A, ctx) => { const xs = numbersOf(A, ctx); return isErr(xs) ? xs : tame(xs.reduce((a, b) => a + b, 0)); });
def('PRODUCT', (A, ctx) => { const xs = numbersOf(A, ctx); return isErr(xs) ? xs : xs.length ? tame(xs.reduce((a, b) => a * b, 1)) : 0; });
def('SUMSQ', (A, ctx) => { const xs = numbersOf(A, ctx); return isErr(xs) ? xs : tame(xs.reduce((a, b) => a + b * b, 0)); });
def('SUMPRODUCT', (A, ctx) => {
  if (!A.length) return ERR.VALUE;
  const gs = A.map(a => grid(ev(a, ctx), ctx));
  const H = gs[0].length, W = (gs[0][0] || []).length;
  if (gs.some(g => g.length !== H || (g[0] || []).length !== W)) return ERR.VALUE;
  let total = 0;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    let p = 1;
    for (const g of gs) { const v = g[r][c]; if (isErr(v)) return v; p *= typeof v === 'number' ? v : 0; }
    total += p;
  }
  return tame(total);
});
def('ABS', N1(Math.abs));
def('SIGN', N1(Math.sign));
def('INT', N1(Math.floor));
def('SQRT', N1(x => (x < 0 ? ERR.NUM : tame(Math.sqrt(x)))));
def('EXP', N1(x => tame(Math.exp(x))));
def('LN', N1(x => (x <= 0 ? ERR.NUM : tame(Math.log(x)))));
def('LOG10', N1(x => (x <= 0 ? ERR.NUM : tame(Math.log10(x)))));
def('LOG', (A, ctx) => lift(A, ctx, (x, b) => { const n = num(x), bb = nOr(b, 10); const e = firstErr(n, bb); if (e) return e; if (n <= 0 || bb <= 0 || bb === 1) return bb === 1 ? ERR.DIV0 : ERR.NUM; return tame(Math.log(n) / Math.log(bb)); }, { min: 1, max: 2 }));
def('PI', () => Math.PI);
def('SIN', N1(x => tame(Math.sin(x)))); def('COS', N1(x => tame(Math.cos(x)))); def('TAN', N1(x => tame(Math.tan(x))));
def('ASIN', N1(x => (Math.abs(x) > 1 ? ERR.NUM : tame(Math.asin(x))))); def('ACOS', N1(x => (Math.abs(x) > 1 ? ERR.NUM : tame(Math.acos(x)))));
def('ATAN', N1(x => tame(Math.atan(x))));
def('ATAN2', (A, ctx) => lift(A, ctx, (x, y) => { const a = num(x), b = num(y); const e = firstErr(a, b); if (e) return e; if (a === 0 && b === 0) return ERR.DIV0; return tame(Math.atan2(b, a)); }, { min: 2, max: 2 }));
def('DEGREES', N1(x => tame(x * 180 / Math.PI))); def('RADIANS', N1(x => tame(x * Math.PI / 180)));
def('EVEN', N1(x => { const s = Math.sign(x) || 1; let v = Math.ceil(Math.abs(x)); if (v % 2) v++; return s * v; }));
def('ODD', N1(x => { const s = Math.sign(x) || 1; let v = Math.ceil(Math.abs(x)); if (v % 2 === 0) v++; return s * v; }));
def('FACT', N1(x => { if (x < 0) return ERR.NUM; let r = 1; for (let i = 2; i <= Math.floor(x); i++) r *= i; return Number.isFinite(r) ? r : ERR.NUM; }));
def('COMBIN', (A, ctx) => lift(A, ctx, (a, b) => { const n = Math.trunc(num(a)), k = Math.trunc(num(b)); if (isErr(n) || isErr(k)) return ERR.VALUE; if (n < 0 || k < 0 || k > n) return ERR.NUM; let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return Math.round(r); }, { min: 2, max: 2 }));
def('GCD LCM', (A, ctx, name) => {
  const xs = numbersOf(A, ctx); if (isErr(xs)) return xs;
  if (xs.some(x => x < 0)) return ERR.NUM;
  const ints = xs.map(Math.trunc);
  if (name === 'GCD') return ints.reduce((a, b) => gcdInt(a, b), 0);
  if (ints.some(x => x === 0)) return 0;
  return ints.reduce((a, b) => a / gcdInt(a, b) * b, 1);
});
function gcdInt(a, b) { while (b) [a, b] = [b, a % b]; return a; }
def('ROUND ROUNDUP ROUNDDOWN', (A, ctx, name) => lift(A, ctx, (x, d) => {
  const v = num(x), dd = nOr(d, 0); const e = firstErr(v, dd); if (e) return e;
  const k = Math.trunc(dd);
  if (name === 'ROUND') return roundHalfAway(v, k);
  const f = Math.pow(10, k);
  const a = +(Math.abs(v) * f).toPrecision(15);
  const r = name === 'ROUNDUP' ? Math.ceil(a) : Math.floor(a);
  return tame(Math.sign(v) * r / f) || 0;
}, { min: 1, max: 2 }));
def('TRUNC', (A, ctx) => lift(A, ctx, (x, d) => { const v = num(x), dd = nOr(d, 0); const e = firstErr(v, dd); if (e) return e; const f = Math.pow(10, Math.trunc(dd)); return tame(Math.trunc(+(v * f).toPrecision(15)) / f) || 0; }, { min: 1, max: 2 }));
def('MROUND', (A, ctx) => lift(A, ctx, (x, m) => { const v = num(x), mm = num(m); const e = firstErr(v, mm); if (e) return e; if (mm === 0) return 0; if (Math.sign(v) * Math.sign(mm) < 0) return ERR.NUM; return tame(roundHalfAway(v / mm, 0) * mm); }, { min: 2, max: 2 }));
def('CEILING FLOOR', (A, ctx, name) => lift(A, ctx, (x, s) => {
  const v = num(x), sg = nOr(s, 1); const e = firstErr(v, sg); if (e) return e;
  if (sg === 0) return name === 'CEILING' ? 0 : ERR.DIV0;
  if (v > 0 && sg < 0) return ERR.NUM;
  const q = +(v / sg).toPrecision(15);
  return tame((name === 'CEILING' ? Math.ceil(q) : Math.floor(q)) * sg) || 0;
}, { min: 1, max: 2 }));
def('CEILING.MATH FLOOR.MATH', (A, ctx, name) => lift(A, ctx, (x, s, md) => {
  const v = num(x), sg = Math.abs(nOr(s, 1)), mode = nOr(md, 0); const e = firstErr(v, sg, mode); if (e) return e;
  if (sg === 0) return 0;
  const q = +(v / sg).toPrecision(15);
  let r;
  if (name === 'CEILING.MATH') r = v < 0 && mode ? Math.floor(q) : Math.ceil(q);
  else r = v < 0 && mode ? Math.ceil(q) : Math.floor(q);
  return tame(r * sg) || 0;
}, { min: 1, max: 3 }));
def('MOD', (A, ctx) => lift(A, ctx, (a, b) => { const x = num(a), y = num(b); const e = firstErr(x, y); if (e) return e; if (y === 0) return ERR.DIV0; return tame(x - y * Math.floor(x / y)); }, { min: 2, max: 2 }));
def('QUOTIENT', (A, ctx) => lift(A, ctx, (a, b) => { const x = num(a), y = num(b); const e = firstErr(x, y); if (e) return e; if (y === 0) return ERR.DIV0; return Math.trunc(x / y); }, { min: 2, max: 2 }));
def('POWER', (A, ctx) => lift(A, ctx, (a, b) => binScalar('^', num(a), num(b)), { min: 2, max: 2 }));
def('RAND', () => Math.random());
def('RANDBETWEEN', (A, ctx) => lift(A, ctx, (a, b) => { const lo = Math.ceil(num(a)), hi = Math.floor(num(b)); if (isErr(lo) || isErr(hi) || Number.isNaN(lo) || Number.isNaN(hi)) return ERR.VALUE; if (lo > hi) return ERR.NUM; return lo + Math.floor(Math.random() * (hi - lo + 1)); }, { min: 2, max: 2 }));
def('RANDARRAY', (A, ctx) => {
  const R = Math.trunc(nOr(argN(A, 0, ctx), 1)), C = Math.trunc(nOr(argN(A, 1, ctx), 1)), lo = nOr(argN(A, 2, ctx), 0), hi = nOr(argN(A, 3, ctx), 1), whole = has(A, 4) ? bool(argN(A, 4, ctx)) : false;
  if ([R, C, lo, hi].some(isErr)) return ERR.VALUE;
  if (R < 1 || C < 1 || lo > hi) return ERR.VALUE;
  return new Arr(Array.from({ length: R }, () => Array.from({ length: C }, () => (whole ? Math.ceil(lo) + Math.floor(Math.random() * (Math.floor(hi) - Math.ceil(lo) + 1)) : lo + Math.random() * (hi - lo)))));
});
const SUBTOTAL_FN = { 1: 'AVERAGE', 2: 'COUNT', 3: 'COUNTA', 4: 'MAX', 5: 'MIN', 6: 'PRODUCT', 7: 'STDEV', 8: 'STDEVP', 9: 'SUM', 10: 'VAR', 11: 'VARP' };
def('SUBTOTAL', (A, ctx) => {
  const code = Math.trunc(num(argN(A, 0, ctx)));
  if (isErr(code)) return code;
  const fn = SUBTOTAL_FN[code > 100 ? code - 100 : code];
  if (!fn) return ERR.VALUE;
  const skipHidden = code > 100;
  // collect values from refs, skipping nested SUBTOTALs and (101+) hidden rows
  const vals = [];
  for (const a of A.slice(1)) {
    const v = ev(a, ctx);
    if (v && v.range) {
      for (let r = v.r1; r <= v.r2; r++) {
        if (skipHidden && ctx.rowHidden && ctx.rowHidden(v.sheet, r)) continue;
        for (let c = v.c1; c <= v.c2; c++) {
          const f = ctx.formulaOf && ctx.formulaOf(v.sheet, r, c);
          if (f && /\bSUBTOTAL\(/i.test(f)) continue;
          vals.push(ctx.get(v.sheet, r, c));
        }
      }
    } else vals.push(...flatVals(v, ctx));
  }
  return F[fn]([{ k: 'lit', v: new Arr([vals.length ? vals : [null]]) }], ctx, fn);
});
def('SUMIF AVERAGEIF COUNTIF', (A, ctx, name) => {
  if (A.length < 2 || A.length > (name === 'COUNTIF' ? 2 : 3)) return ERR.VALUE;
  const rg = ev(A[0], ctx);
  if (isErr(rg)) return rg;
  const test = criterion(argN(A, 1, ctx));
  const cells = grid(rg, ctx);
  let sumG = cells;
  if (has(A, 2)) {
    const s = ev(A[2], ctx);
    if (s && s.range) { const H = cells.length, W = (cells[0] || []).length; sumG = grid({ ...s, r2: s.r1 + H - 1, c2: s.c1 + W - 1 }, ctx); } else sumG = grid(s, ctx);
  }
  let total = 0, count = 0, n = 0;
  cells.forEach((row, ri) => row.forEach((v, ci) => {
    if (!test(v)) return;
    count++;
    const sv = sumG[ri] ? sumG[ri][ci] : null;
    if (typeof sv === 'number') { total += sv; n++; }
  }));
  if (name === 'COUNTIF') return count;
  if (name === 'SUMIF') return tame(total);
  return n ? tame(total / n) : ERR.DIV0;
});
def('SUMIFS', (A, ctx) => ifsAgg(A, ctx, 1, 'sum'));
def('COUNTIFS', (A, ctx) => ifsAgg(A, ctx, 0, 'count'));
def('AVERAGEIFS', (A, ctx) => ifsAgg(A, ctx, 1, 'avg'));
def('MAXIFS', (A, ctx) => ifsAgg(A, ctx, 1, 'max'));
def('MINIFS', (A, ctx) => ifsAgg(A, ctx, 1, 'min'));

// statistics
def('AVERAGE', (A, ctx) => { const xs = numbersOf(A, ctx); if (isErr(xs)) return xs; if (!xs.length) return ERR.DIV0; return tame(xs.reduce((a, b) => a + b, 0) / xs.length); });
def('AVERAGEA', (A, ctx) => { const xs = numbersA(A, ctx); if (isErr(xs)) return xs; if (!xs.length) return ERR.DIV0; return tame(xs.reduce((a, b) => a + b, 0) / xs.length); });
def('MIN', (A, ctx) => { const xs = numbersOf(A, ctx); return isErr(xs) ? xs : xs.length ? xs.reduce((a, b) => (b < a ? b : a)) : 0; });
def('MAX', (A, ctx) => { const xs = numbersOf(A, ctx); return isErr(xs) ? xs : xs.length ? xs.reduce((a, b) => (b > a ? b : a)) : 0; });
def('MINA', (A, ctx) => { const xs = numbersA(A, ctx); return isErr(xs) ? xs : xs.length ? Math.min(...xs) : 0; });
def('MAXA', (A, ctx) => { const xs = numbersA(A, ctx); return isErr(xs) ? xs : xs.length ? Math.max(...xs) : 0; });
def('MEDIAN', (A, ctx) => { const xs = numbersOf(A, ctx); if (isErr(xs)) return xs; if (!xs.length) return ERR.NUM; xs.sort((a, b) => a - b); const m = xs.length >> 1; return xs.length % 2 ? xs[m] : tame((xs[m - 1] + xs[m]) / 2); });
def('MODE MODE.SNGL', (A, ctx) => {
  const xs = numbersOf(A, ctx); if (isErr(xs)) return xs;
  const cnt = new Map();
  for (const x of xs) cnt.set(x, (cnt.get(x) || 0) + 1);
  let best = null, bc = 1;
  for (const x of xs) { const c = cnt.get(x); if (c > bc) { bc = c; best = x; } }
  return best === null ? ERR.NA : best;
});
def('STDEV STDEV.S STDEVP STDEV.P VAR VAR.S VARP VAR.P', (A, ctx, name) => {
  const xs = numbersOf(A, ctx); if (isErr(xs)) return xs;
  const pop = /P$/.test(name.replace('.', ''));
  const { n, ss } = stats(xs);
  if (n < (pop ? 1 : 2)) return ERR.DIV0;
  const v = ss / (pop ? n : n - 1);
  return tame(/^STDEV/.test(name) ? Math.sqrt(v) : v);
});
def('LARGE SMALL', (A, ctx, name) => {
  const xs = numbersOf([A[0]], ctx); if (isErr(xs)) return xs;
  const kv = ev(A[1], ctx);
  const pick = k => { const kk = num(k); if (isErr(kk)) return kk; const i = Math.ceil(kk); if (i < 1 || i > xs.length) return ERR.NUM; const s = [...xs].sort((a, b) => (name === 'LARGE' ? b - a : a - b)); return s[i - 1]; };
  if (isMulti(kv)) return new Arr(grid(kv, ctx).map(r => r.map(pick)));
  return pick(scalar(kv, ctx));
});
def('RANK RANK.EQ RANK.AVG', (A, ctx, name) => {
  const x = num(argN(A, 0, ctx)); if (isErr(x)) return x;
  const xs = numbersOf([A[1]], ctx); if (isErr(xs)) return xs;
  const asc = has(A, 2) ? num(argN(A, 2, ctx)) !== 0 : false;
  if (!xs.includes(x)) return ERR.NA;
  const better = xs.filter(v => (asc ? v < x : v > x)).length;
  if (name !== 'RANK.AVG') return better + 1;
  const same = xs.filter(v => v === x).length;
  return better + (same + 1) / 2;
});
def('PERCENTILE PERCENTILE.INC', (A, ctx) => { const xs = numbersOf([A[0]], ctx); if (isErr(xs)) return xs; const k = num(argN(A, 1, ctx)); if (isErr(k)) return k; return percentileInc(xs, k); });
def('QUARTILE QUARTILE.INC', (A, ctx) => { const xs = numbersOf([A[0]], ctx); if (isErr(xs)) return xs; const q = Math.trunc(num(argN(A, 1, ctx))); if (isErr(q)) return q; if (q < 0 || q > 4) return ERR.NUM; return percentileInc(xs, q / 4); });
def('CORREL', (A, ctx) => {
  const a = flatVals(ev(A[0], ctx), ctx), b = flatVals(ev(A[1], ctx), ctx);
  if (a.length !== b.length) return ERR.NA;
  const xs = [], ys = [];
  for (let i = 0; i < a.length; i++) { if (isErr(a[i])) return a[i]; if (isErr(b[i])) return b[i]; if (typeof a[i] === 'number' && typeof b[i] === 'number') { xs.push(a[i]); ys.push(b[i]); } }
  if (xs.length < 2) return ERR.DIV0;
  const mx = xs.reduce((p, q) => p + q, 0) / xs.length, my = ys.reduce((p, q) => p + q, 0) / ys.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  if (!sxx || !syy) return ERR.DIV0;
  return tame(sxy / Math.sqrt(sxx * syy));
});
def('GEOMEAN', (A, ctx) => { const xs = numbersOf(A, ctx); if (isErr(xs)) return xs; if (!xs.length || xs.some(x => x <= 0)) return ERR.NUM; return tame(Math.exp(xs.reduce((a, b) => a + Math.log(b), 0) / xs.length)); });
def('AVEDEV', (A, ctx) => { const xs = numbersOf(A, ctx); if (isErr(xs)) return xs; if (!xs.length) return ERR.NUM; const m = xs.reduce((a, b) => a + b, 0) / xs.length; return tame(xs.reduce((a, b) => a + Math.abs(b - m), 0) / xs.length); });
def('COUNT', (A, ctx) => { let k = 0; for (const { v, fromRange } of values(A, ctx)) if (typeof v === 'number' || (!fromRange && (typeof v === 'boolean' || (typeof v === 'string' && !isErr(num(v)))))) k++; return k; });
def('COUNTA', (A, ctx) => { let k = 0; for (const { v } of values(A, ctx)) if (v !== null && v !== undefined && v !== '') k++; return k; });
def('COUNTBLANK', (A, ctx) => { let k = 0; for (const { v } of values(A, ctx)) if (v === null || v === undefined || v === '') k++; return k; });

// logical
def('IF', (A, ctx) => {
  if (A.length < 1 || A.length > 3) return ERR.VALUE;
  const cv = ev(A[0], ctx);
  const branch = i => (A.length > i ? (A[i].k === 'missing' ? 0 : ev(A[i], ctx)) : i === 1);
  if (isMulti(cv)) return broadcast([cv, branch(1), branch(2)], ctx, (c, t, f) => { const b = bool(c); return isErr(b) ? b : b ? t : f; });
  const b = bool(scalar(cv, ctx));
  if (isErr(b)) return b;
  return b ? branch(1) : branch(2);
});
def('LET', (A, ctx) => {
  if (A.length < 3 || A.length % 2 === 0) return ERR.VALUE;
  const saved = ctx.locals;
  const loc = Object.assign(Object.create(null), saved || {});
  ctx.locals = loc;
  try {
    for (let i = 0; i < A.length - 1; i += 2) {
      if (A[i].k !== 'name') return ERR.VALUE;
      loc[A[i].v.toUpperCase()] = ev(A[i + 1], ctx);
    }
    return ev(A[A.length - 1], ctx);
  } finally { ctx.locals = saved; }
});
def('IFS', (A, ctx) => {
  if (!A.length || A.length % 2) return ERR.VALUE;
  for (let i = 0; i < A.length; i += 2) { const b = bool(argN(A, i, ctx)); if (isErr(b)) return b; if (b) return ev(A[i + 1], ctx); }
  return ERR.NA;
});
def('IFERROR IFNA', (A, ctx, name) => {
  if (A.length !== 2) return ERR.VALUE;
  const v = ev(A[0], ctx);
  const bad = x => (name === 'IFNA' ? isErr(x) && x.code === '#N/A' : isErr(x));
  if (isMulti(v)) { let alt; return new Arr(grid(v, ctx).map(r => r.map(x => (bad(x) ? (alt === undefined ? (alt = argN(A, 1, ctx) ?? 0) : alt) : x)))); }
  const s = scalar(v, ctx);
  return bad(s) ? (A[1].k === 'missing' ? 0 : ev(A[1], ctx)) : v;
});
def('AND OR XOR', (A, ctx, name) => {
  let any = false, all = true, seen = false, odd = false;
  for (const { v, fromRange } of values(A, ctx)) {
    if (isErr(v)) return v;
    if (fromRange && typeof v !== 'boolean' && typeof v !== 'number') continue;
    if (v === null) continue;
    const b = bool(v); if (isErr(b)) return b;
    seen = true; any = any || b; all = all && b; if (b) odd = !odd;
  }
  if (!seen) return ERR.VALUE;
  return name === 'AND' ? all : name === 'OR' ? any : odd;
});
def('NOT', (A, ctx) => lift(A, ctx, x => { const b = bool(x); return isErr(b) ? b : !b; }, { min: 1, max: 1 }));
def('TRUE', () => true);
def('FALSE', () => false);
def('SWITCH', (A, ctx) => {
  if (A.length < 3) return ERR.VALUE;
  const x = argN(A, 0, ctx); if (isErr(x)) return x;
  let i = 1;
  for (; i + 1 < A.length; i += 2) { const v = argN(A, i, ctx); if (isErr(v)) return v; if (compareValues(x, v) === 0 && typeRank(x) === typeRank(v)) return ev(A[i + 1], ctx); }
  return i < A.length ? ev(A[i], ctx) : ERR.NA;
});

// lookup & reference
def('VLOOKUP HLOOKUP', (A, ctx, name) => {
  if (A.length < 3 || A.length > 4) return ERR.VALUE;
  const key = argN(A, 0, ctx); if (isErr(key)) return key;
  const g = grid(ev(A[1], ctx), ctx);
  const idx = Math.trunc(num(argN(A, 2, ctx))); if (isErr(idx)) return idx;
  const approx = has(A, 3) ? bool(argN(A, 3, ctx)) : true;
  if (isErr(approx)) return approx;
  const vert = name === 'VLOOKUP';
  const len = vert ? g.length : (g[0] || []).length;
  const width = vert ? (g[0] || []).length : g.length;
  if (idx < 1) return ERR.VALUE;
  if (idx > width) return ERR.REF;
  const at = (i, k) => (vert ? g[i][k] : g[k][i]);
  const vec = Array.from({ length: len }, (_, i) => at(i, 0));
  const found = approx ? approxSorted(key, vec) : lookupIndex(key, vec, typeof key === 'string' ? 2 : 0, 1);
  if (found < 0) return ERR.NA;
  return at(found, idx - 1) ?? 0;
});
def('LOOKUP', (A, ctx) => {
  const key = argN(A, 0, ctx); if (isErr(key)) return key;
  const g = grid(ev(A[1], ctx), ctx);
  let vec, res;
  if (has(A, 2)) { vec = g.flat(); res = flatVals(ev(A[2], ctx), ctx); }
  else if (g.length >= (g[0] || []).length) { vec = g.map(r => r[0]); res = g.map(r => r[r.length - 1]); }
  else { vec = g[0]; res = g[g.length - 1]; }
  const i = approxSorted(key, vec);
  return i < 0 ? ERR.NA : res[i] ?? ERR.NA;
});
def('MATCH', (A, ctx) => {
  const key = argN(A, 0, ctx); if (isErr(key)) return key;
  const vec = flatVals(ev(A[1], ctx), ctx);
  const type = has(A, 2) ? Math.sign(num(argN(A, 2, ctx))) : 1;
  let i;
  if (type === 0) i = lookupIndex(key, vec, typeof key === 'string' ? 2 : 0, 1);
  else i = approxSorted(key, vec, type < 0);
  return i < 0 ? ERR.NA : i + 1;
});
def('XMATCH', (A, ctx) => {
  const key = argN(A, 0, ctx); if (isErr(key)) return key;
  const vec = flatVals(ev(A[1], ctx), ctx);
  const mode = has(A, 2) ? num(argN(A, 2, ctx)) : 0, search = has(A, 3) ? num(argN(A, 3, ctx)) : 1;
  const i = lookupIndex(key, vec, mode, search);
  return i < 0 ? ERR.NA : i + 1;
});
def('XLOOKUP', (A, ctx) => {
  if (A.length < 3 || A.length > 6) return ERR.VALUE;
  const keyV = ev(A[0], ctx);
  const lg = grid(ev(A[1], ctx), ctx), rg = grid(ev(A[2], ctx), ctx);
  const vertical = lg.length >= (lg[0] || []).length;
  const vec = vertical ? lg.map(r => r[0]) : lg[0];
  const rlen = vertical ? rg.length : (rg[0] || []).length;
  if (rlen !== vec.length) return ERR.VALUE;
  const mode = has(A, 4) ? num(argN(A, 4, ctx)) : 0, search = has(A, 5) ? num(argN(A, 5, ctx)) : 1;
  const one = key => {
    if (isErr(key)) return key;
    const i = lookupIndex(key, vec, mode, search);
    if (i < 0) return has(A, 3) ? argN(A, 3, ctx) : ERR.NA;
    if (vertical) return rg[i].length === 1 ? rg[i][0] : new Arr([rg[i]]);
    return rg.length === 1 ? rg[0][i] : new Arr(rg.map(r => [r[i]]));
  };
  if (isMulti(keyV)) return new Arr(grid(keyV, ctx).map(r => r.map(k => { const x = one(k); return x instanceof Arr ? x.rows[0][0] : x; })));
  return one(scalar(keyV, ctx));
});
def('INDEX', (A, ctx) => {
  if (A.length < 2 || A.length > 3) return ERR.VALUE;
  const src = ev(A[0], ctx);
  let r = has(A, 1) ? Math.trunc(num(argN(A, 1, ctx))) : 0, c = has(A, 2) ? Math.trunc(num(argN(A, 2, ctx))) : 0;
  if (isErr(r) || isErr(c)) return ERR.VALUE;
  if (r < 0 || c < 0) return ERR.VALUE;
  if (src && src.range) {
    const H = src.r2 - src.r1 + 1, W = src.c2 - src.c1 + 1;
    if (A.length === 2 && H === 1) { c = r; r = 1; }
    if (r > H || c > W) return ERR.REF;
    if (W > 1 && H > 1 && A.length === 2 && r) return { ...src, r1: src.r1 + r - 1, r2: src.r1 + r - 1 };
    return { range: true, sheet: src.sheet, r1: r ? src.r1 + r - 1 : src.r1, r2: r ? src.r1 + r - 1 : src.r2, c1: c ? src.c1 + c - 1 : src.c1, c2: c ? src.c1 + c - 1 : src.c2 };
  }
  const g = grid(src, ctx);
  const H = g.length, W = (g[0] || []).length;
  if (A.length === 2 && H === 1) { c = r; r = 1; }
  if (r > H || c > W) return ERR.REF;
  if (r && c) return g[r - 1][c - 1];
  if (r) return new Arr([g[r - 1]]);
  if (c) return new Arr(g.map(x => [x[c - 1]]));
  return src;
});
def('CHOOSE', (A, ctx) => {
  const iv = ev(A[0], ctx);
  const pick = x => { const i = Math.trunc(num(x)); if (isErr(i)) return i; if (i < 1 || i >= A.length) return ERR.VALUE; return ev(A[i], ctx); };
  if (isMulti(iv)) return new Arr(grid(iv, ctx).map(r => r.map(x => scalar(pick(x), ctx))));
  return pick(scalar(iv, ctx));
});
def('ROW COLUMN', (A, ctx, name) => {
  if (!A.length || A[0].k === 'missing') return ctx.cur ? (name === 'ROW' ? ctx.cur.r + 1 : ctx.cur.c + 1) : ERR.VALUE;
  const v = ev(A[0], ctx);
  if (!v || !v.range) return ERR.VALUE;
  if (name === 'ROW') return v.r1 === v.r2 ? v.r1 + 1 : new Arr(Array.from({ length: v.r2 - v.r1 + 1 }, (_, i) => [v.r1 + i + 1]));
  return v.c1 === v.c2 ? v.c1 + 1 : new Arr([Array.from({ length: v.c2 - v.c1 + 1 }, (_, i) => v.c1 + i + 1)]);
});
def('ROWS COLUMNS', (A, ctx, name) => {
  if (A.length !== 1) return ERR.VALUE;
  const v = ev(A[0], ctx);
  if (v && v.range) { const b = A[0].k === 'range' ? A[0] : v; return name === 'ROWS' ? b.r2 - b.r1 + 1 : b.c2 - b.c1 + 1; }
  if (v instanceof Arr) return name === 'ROWS' ? v.h : v.w;
  return isErr(v) ? v : 1;
});
def('OFFSET', (A, ctx) => {
  if (A.length < 3 || A.length > 5) return ERR.VALUE;
  const base = ev(A[0], ctx);
  if (!base || !base.range) return ERR.VALUE;
  const dr = Math.trunc(num(argN(A, 1, ctx))), dc = Math.trunc(num(argN(A, 2, ctx)));
  const h = has(A, 3) ? Math.trunc(num(argN(A, 3, ctx))) : base.r2 - base.r1 + 1;
  const w = has(A, 4) ? Math.trunc(num(argN(A, 4, ctx))) : base.c2 - base.c1 + 1;
  if ([dr, dc, h, w].some(isErr)) return ERR.VALUE;
  const r1 = base.r1 + dr, c1 = base.c1 + dc;
  if (r1 < 0 || c1 < 0 || h < 1 || w < 1) return ERR.REF;
  return { range: true, sheet: base.sheet, r1, c1, r2: r1 + h - 1, c2: c1 + w - 1 };
});
def('INDIRECT', (A, ctx) => {
  const t = str(argN(A, 0, ctx)).trim();
  const a1 = has(A, 1) ? bool(argN(A, 1, ctx)) : true;
  let sheetName = null, ref = t;
  const m = /^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/.exec(t);
  if (m) { sheetName = (m[1] || m[2]).replace(/''/g, "'"); ref = m[3]; }
  const si = sheetName == null ? ctx.sheet : ctx.sheetIndex(sheetName);
  if (si < 0) return ERR.REF;
  if (a1 === false) {
    const rc = /^[RZ](\d+)[CS](\d+)(?::[RZ](\d+)[CS](\d+))?$/i.exec(ref);
    if (!rc) return ERR.REF;
    const r1 = +rc[1] - 1, c1 = +rc[2] - 1, r2 = rc[3] ? +rc[3] - 1 : r1, c2 = rc[4] ? +rc[4] - 1 : c1;
    return { range: true, sheet: si, r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
  }
  const rg = parseRangeAddr(ref.replace(/\$/g, ''));
  if (rg) return { range: true, sheet: si, ...rg };
  const cm = /^\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})$/.exec(ref);
  if (cm) return clampRange(si, 0, Math.min(colIndex(cm[1]), colIndex(cm[2])), 1048575, Math.max(colIndex(cm[1]), colIndex(cm[2])), ctx);
  if (ctx.name && ctx.name(ref) != null) return ev({ k: 'name', v: ref }, ctx);
  return ERR.REF;
});
def('ADDRESS', (A, ctx) => {
  const r = Math.trunc(num(argN(A, 0, ctx))), c = Math.trunc(num(argN(A, 1, ctx)));
  const abs = has(A, 2) ? Math.trunc(num(argN(A, 2, ctx))) : 1;
  const a1 = has(A, 3) ? bool(argN(A, 3, ctx)) : true;
  if ([r, c, abs].some(isErr)) return ERR.VALUE;
  if (r < 1 || c < 1 || abs < 1 || abs > 4) return ERR.VALUE;
  let s;
  if (a1 === false) s = `${abs === 1 || abs === 2 ? `Z${r}` : `Z[${r}]`}${abs === 1 || abs === 3 ? `S${c}` : `S[${c}]`}`;
  else s = `${abs === 1 || abs === 3 ? '$' : ''}${colName(c - 1)}${abs === 1 || abs === 2 ? '$' : ''}${r}`;
  if (has(A, 4)) s = quoteSheet(str(argN(A, 4, ctx))) + '!' + s;
  return s;
});
def('TRANSPOSE', (A, ctx) => { const g = grid(ev(A[0], ctx), ctx); if (!g.length) return ERR.VALUE; return new Arr(g[0].map((_, c) => g.map(r => (r[c] === null ? 0 : r[c])))); });
def('FILTER', (A, ctx) => {
  if (A.length < 2 || A.length > 3) return ERR.VALUE;
  const g = grid(ev(A[0], ctx), ctx), inc = grid(ev(A[1], ctx), ctx);
  const H = g.length, W = (g[0] || []).length;
  let out;
  if (inc.length === H && (inc[0] || []).length === 1) {
    out = [];
    for (let r = 0; r < H; r++) { const b = bool(inc[r][0]); if (isErr(b)) return b; if (b) out.push(g[r]); }
  } else if (inc.length === 1 && (inc[0] || []).length === W) {
    const keep = [];
    for (let c = 0; c < W; c++) { const b = bool(inc[0][c]); if (isErr(b)) return b; if (b) keep.push(c); }
    out = keep.length ? g.map(r => keep.map(c => r[c])) : [];
  } else return ERR.VALUE;
  if (!out.length) return has(A, 2) ? argN(A, 2, ctx) : ERR.CALC;
  return new Arr(out.map(r => r.map(x => (x === null ? 0 : x))));
});
def('SORT', (A, ctx) => {
  const g = grid(ev(A[0], ctx), ctx);
  const idx = has(A, 1) ? Math.trunc(num(argN(A, 1, ctx))) : 1;
  const order = has(A, 2) ? num(argN(A, 2, ctx)) : 1;
  const byCol = has(A, 3) ? bool(argN(A, 3, ctx)) === true : false;
  if (isErr(idx) || isErr(order)) return ERR.VALUE;
  if (byCol) {
    if (idx < 1 || idx > g.length) return ERR.VALUE;
    const cols = g[0].map((_, c) => g.map(r => r[c]));
    const o = sortRowsBy(cols, [{ get: i => cols[i][idx - 1], order }]);
    return new Arr(g.map((r) => o.map(i => r[i] ?? 0)));
  }
  if (idx < 1 || idx > (g[0] || []).length) return ERR.VALUE;
  const o = sortRowsBy(g, [{ get: i => g[i][idx - 1], order }]);
  return new Arr(o.map(i => g[i].map(x => x ?? 0)));
});
def('SORTBY', (A, ctx) => {
  const g = grid(ev(A[0], ctx), ctx);
  const keys = [];
  for (let i = 1; i < A.length; i += 2) {
    const kv = flatVals(ev(A[i], ctx), ctx);
    if (kv.length !== g.length) return ERR.VALUE;
    keys.push({ get: r => kv[r], order: has(A, i + 1) ? num(argN(A, i + 1, ctx)) : 1 });
  }
  if (!keys.length) return ERR.VALUE;
  return new Arr(sortRowsBy(g, keys).map(i => g[i].map(x => x ?? 0)));
});
def('UNIQUE', (A, ctx) => {
  const g = grid(ev(A[0], ctx), ctx);
  const byCol = has(A, 1) ? bool(argN(A, 1, ctx)) === true : false;
  const once = has(A, 2) ? bool(argN(A, 2, ctx)) === true : false;
  const items = byCol ? g[0].map((_, c) => g.map(r => r[c])) : g;
  const counts = new Map(), first = new Map();
  items.forEach((it, i) => { const k = it.map(keyOf).join('\u0001'); counts.set(k, (counts.get(k) || 0) + 1); if (!first.has(k)) first.set(k, i); });
  const keep = [...first.entries()].filter(([k]) => !once || counts.get(k) === 1).map(([, i]) => items[i]);
  if (!keep.length) return ERR.CALC;
  const rows = byCol ? g.map((_, r) => keep.map(col => col[r])) : keep;
  return new Arr(rows.map(r => r.map(x => x ?? 0)));
});
def('SEQUENCE', (A, ctx) => {
  const R = Math.trunc(nOr(argN(A, 0, ctx), 1)), C = has(A, 1) ? Math.trunc(nOr(argN(A, 1, ctx), 1)) : 1;
  const start = has(A, 2) ? nOr(argN(A, 2, ctx), 1) : 1, step = has(A, 3) ? nOr(argN(A, 3, ctx), 1) : 1;
  if ([R, C, start, step].some(isErr)) return ERR.VALUE;
  if (R < 1 || C < 1) return ERR.CALC;
  if (R * C > 1e6) return ERR.NUM;
  return new Arr(Array.from({ length: R }, (_, r) => Array.from({ length: C }, (_, c) => tame(start + (r * C + c) * step))));
});

// text
const T1 = fn => (A, ctx) => lift(A, ctx, x => (isErr(x) ? x : fn(str(x))), { min: 1, max: 1 });
def('CONCATENATE', (A, ctx) => lift(A, ctx, (...xs) => { const e = xs.find(isErr); return e || xs.map(str).join(''); }, { min: 1 }));
def('CONCAT', (A, ctx) => { let s = ''; for (const { v } of values(A, ctx)) { if (isErr(v)) return v; s += str(v); } return s.length > 32767 ? ERR.VALUE : s; });
def('TEXTJOIN', (A, ctx) => {
  if (A.length < 3) return ERR.VALUE;
  const delimV = flatVals(ev(A[0], ctx), ctx).map(str);
  const ign = bool(argN(A, 1, ctx)); if (isErr(ign)) return ign;
  const parts = [];
  for (const { v } of values(A.slice(2), ctx)) { if (isErr(v)) return v; const s = str(v); if (ign && s === '') continue; parts.push(s); }
  let out = '';
  parts.forEach((p, i) => { if (i) out += delimV[(i - 1) % delimV.length] ?? ''; out += p; });
  return out;
});
def('LEN', T1(s => s.length));
def('UPPER', T1(s => s.toLocaleUpperCase('de')));
def('LOWER', T1(s => s.toLocaleLowerCase('de')));
def('PROPER', T1(s => s.toLocaleLowerCase('de').replace(/(^|[^\p{L}])(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase('de'))));
def('TRIM', T1(s => s.replace(/^ +| +$/g, '').replace(/ {2,}/g, ' ')));
def('CLEAN', T1(s => s.replace(/[\x00-\x1F]/g, '')));
def('LEFT RIGHT', (A, ctx, name) => lift(A, ctx, (x, k) => {
  if (isErr(x)) return x;
  const n = k === undefined || k === null ? 1 : num(k); if (isErr(n)) return n;
  if (n < 0) return ERR.VALUE;
  const s = str(x), m = Math.trunc(n);
  return name === 'LEFT' ? s.slice(0, m) : (m <= 0 ? '' : s.slice(-m));
}, { min: 1, max: 2 }));
def('MID', (A, ctx) => lift(A, ctx, (x, st, k) => { if (isErr(x)) return x; const a = num(st), b = num(k); const e = firstErr(a, b); if (e) return e; if (a < 1 || b < 0) return ERR.VALUE; return str(x).substr(Math.trunc(a) - 1, Math.trunc(b)); }, { min: 3, max: 3 }));
def('FIND SEARCH', (A, ctx, name) => lift(A, ctx, (f, w, st) => {
  const e0 = firstErr(f, w); if (e0) return e0;
  const needle = str(f), hay = str(w);
  const start = st === undefined || st === null ? 1 : num(st); if (isErr(start)) return start;
  if (start < 1 || start > hay.length + 1) return ERR.VALUE;
  let i;
  if (name === 'FIND') i = hay.indexOf(needle, start - 1);
  else {
    if (needle === '') i = start - 1;
    else { const re = wildcardRe(needle, false); re.lastIndex = 0; const sub = hay.slice(start - 1); const m = re.exec(sub); i = m ? m.index + start - 1 : -1; }
  }
  return i < 0 ? ERR.VALUE : i + 1;
}, { min: 2, max: 3 }));
def('REPLACE', (A, ctx) => lift(A, ctx, (t, st, n, nw) => { const e = firstErr(t, nw); if (e) return e; const a = num(st), b = num(n); const e2 = firstErr(a, b); if (e2) return e2; if (a < 1 || b < 0) return ERR.VALUE; const s = str(t); return s.slice(0, Math.trunc(a) - 1) + str(nw) + s.slice(Math.trunc(a) - 1 + Math.trunc(b)); }, { min: 4, max: 4 }));
def('SUBSTITUTE', (A, ctx) => lift(A, ctx, (t, o, nw, inst) => {
  const e = firstErr(t, o, nw); if (e) return e;
  const s = str(t), old = str(o), rep = str(nw);
  if (!old) return s;
  if (inst === undefined || inst === null) return s.split(old).join(rep);
  const k = Math.trunc(num(inst)); if (isErr(k)) return k; if (k < 1) return ERR.VALUE;
  let idx = -1;
  for (let i = 0; i < k; i++) { idx = s.indexOf(old, idx + 1); if (idx < 0) return s; }
  return s.slice(0, idx) + rep + s.slice(idx + old.length);
}, { min: 3, max: 4 }));
def('TEXT', (A, ctx) => lift(A, ctx, (v, f) => {
  if (isErr(v)) return v; if (isErr(f)) return f;
  const code = fromGermanCode(str(f));
  let x = v;
  if (typeof x === 'string') { const n = num(x); if (!isErr(n)) x = n; }
  return formatWithCode(x, code).text;
}, { min: 2, max: 2 }));
def('VALUE', (A, ctx) => lift(A, ctx, v => { if (isErr(v)) return v; if (typeof v === 'number') return v; if (v === null || v === '') return 0; if (typeof v === 'boolean') return ERR.VALUE; const n = num(String(v)); return isErr(n) ? ERR.VALUE : n; }, { min: 1, max: 1 }));
def('NUMBERVALUE', (A, ctx) => lift(A, ctx, (v, d, g) => {
  if (isErr(v)) return v;
  let s = str(v).replace(/\s/g, '');
  const dec = d === undefined || d === null ? ',' : str(d)[0], gr = g === undefined || g === null ? '.' : str(g)[0];
  if (!s) return 0;
  let pct = 0; while (s.endsWith('%')) { pct++; s = s.slice(0, -1); }
  s = s.split(gr).join('');
  const parts = s.split(dec);
  if (parts.length > 2) return ERR.VALUE;
  const n = Number(parts[0] + (parts[1] !== undefined ? '.' + parts[1] : ''));
  return Number.isFinite(n) ? n / 100 ** pct : ERR.VALUE;
}, { min: 1, max: 3 }));
def('REPT', (A, ctx) => lift(A, ctx, (t, n) => { if (isErr(t)) return t; const k = num(n); if (isErr(k)) return k; if (k < 0) return ERR.VALUE; const s = str(t).repeat(Math.trunc(k)); return s.length > 32767 ? ERR.VALUE : s; }, { min: 2, max: 2 }));
def('EXACT', (A, ctx) => lift(A, ctx, (a, b) => { const e = firstErr(a, b); if (e) return e; return str(a) === str(b); }, { min: 2, max: 2 }));
def('CHAR', N1(n => { const k = Math.trunc(n); if (k < 1 || k > 255) return ERR.VALUE; return String.fromCharCode(CP1252[k] || k); }));
def('CODE', T1(s => { if (!s) return ERR.VALUE; const c = s.charCodeAt(0); return c < 256 ? c : CP1252_REV[c] || 63; }));
def('UNICHAR', N1(n => { const k = Math.trunc(n); if (k < 1 || k > 0x10FFFF) return ERR.VALUE; return String.fromCodePoint(k); }));
def('UNICODE', T1(s => (s ? s.codePointAt(0) : ERR.VALUE)));
def('FIXED', (A, ctx) => lift(A, ctx, (x, d, nc) => {
  const v = num(x), dd = d === undefined || d === null ? 2 : num(d); const e = firstErr(v, dd); if (e) return e;
  const k = Math.trunc(dd);
  const r = roundHalfAway(v, k);
  const noSep = nc === undefined || nc === null ? false : bool(nc) === true;
  return r.toLocaleString('de-DE', { minimumFractionDigits: Math.max(0, k), maximumFractionDigits: Math.max(0, k), useGrouping: !noSep });
}, { min: 1, max: 3 }));
def('T', (A, ctx) => { const v = argN(A, 0, ctx); return isErr(v) ? v : typeof v === 'string' ? v : ''; });
def('N', (A, ctx) => { const v = argN(A, 0, ctx); return isErr(v) ? v : typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : 0; });
def('TEXTBEFORE TEXTAFTER', (A, ctx, name) => {
  const t = argN(A, 0, ctx), d = argN(A, 1, ctx); const e = firstErr(t, d); if (e) return e;
  const s = str(t), delim = str(d);
  let n = has(A, 2) ? Math.trunc(num(argN(A, 2, ctx))) : 1;
  const ci = has(A, 3) ? num(argN(A, 3, ctx)) === 1 : false;
  if (isErr(n) || n === 0) return ERR.VALUE;
  const hay = ci ? s.toLocaleLowerCase('de') : s, nd = ci ? delim.toLocaleLowerCase('de') : delim;
  if (!nd) return name === 'TEXTBEFORE' ? (n > 0 ? '' : s) : (n > 0 ? s : '');
  const pos = [];
  let i = hay.indexOf(nd);
  while (i >= 0) { pos.push(i); i = hay.indexOf(nd, i + nd.length); }
  const k = n > 0 ? n - 1 : pos.length + n;
  if (k < 0 || k >= pos.length) return has(A, 5) ? argN(A, 5, ctx) : ERR.NA;
  return name === 'TEXTBEFORE' ? s.slice(0, pos[k]) : s.slice(pos[k] + delim.length);
});

// date & time
const D1 = fn => (A, ctx) => lift(A, ctx, x => { const n = num(x); if (isErr(n)) return n; if (n < 0) return ERR.NUM; return fn(n); }, { min: 1, max: 1 });
def('TODAY', () => dateToSerial(new Date()));
def('NOW', () => { const d = new Date(); return dateToSerial(d) + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400; });
def('DATE', (A, ctx) => lift(A, ctx, (a, b, c) => {
  const y = num(a), m = num(b), d = num(c); const e = firstErr(y, m, d); if (e) return e;
  let yy = Math.trunc(y); if (yy < 1900) yy += 1900;
  if (yy < 1900 || yy > 9999) return ERR.NUM;
  const v = serial(yy, Math.trunc(m) - 1, Math.trunc(d));
  return v < 0 ? ERR.NUM : v;
}, { min: 3, max: 3 }));
def('TIME', (A, ctx) => lift(A, ctx, (a, b, c) => {
  const h = num(a), m = num(b), s = num(c); const e = firstErr(h, m, s); if (e) return e;
  const t = Math.trunc(h) * 3600 + Math.trunc(m) * 60 + Math.trunc(s);
  if (t < 0) return ERR.NUM;
  return tame((t % 86400) / 86400);
}, { min: 3, max: 3 }));
def('YEAR', D1(n => ymd(n).y)); def('MONTH', D1(n => ymd(n).m + 1)); def('DAY', D1(n => ymd(n).d));
const tod = n => Math.round((n - Math.floor(n)) * 86400) % 86400;
def('HOUR', D1(n => Math.floor(tod(n) / 3600))); def('MINUTE', D1(n => Math.floor(tod(n) % 3600 / 60))); def('SECOND', D1(n => tod(n) % 60));
def('WEEKDAY', (A, ctx) => lift(A, ctx, (x, t) => { const n = num(x), ty = t === undefined || t === null ? 1 : num(t); const e = firstErr(n, ty); if (e) return e; if (n < 0) return ERR.NUM; return weekdayOf(n, Math.trunc(ty)); }, { min: 1, max: 2 }));
def('WEEKNUM', (A, ctx) => lift(A, ctx, (x, t) => {
  const n = num(x), ty = t === undefined || t === null ? 1 : Math.trunc(num(t)); const e = firstErr(n, ty); if (e) return e;
  if (n < 0) return ERR.NUM;
  if (ty === 21) return isoWeek(n);
  const startDay = { 1: 0, 17: 0, 2: 1, 11: 1, 12: 2, 13: 3, 14: 4, 15: 5, 16: 6 }[ty];
  if (startDay === undefined) return ERR.NUM;
  const { y } = ymd(n);
  const jan1 = serial(y, 0, 1);
  const off = (ymd(jan1).wd - startDay + 7) % 7;
  return Math.floor((Math.floor(n) - jan1 + off) / 7) + 1;
}, { min: 1, max: 2 }));
def('ISOWEEKNUM', D1(n => isoWeek(n)));
def('EDATE', (A, ctx) => lift(A, ctx, (s, m) => { const a = num(s), b = num(m); const e = firstErr(a, b); if (e) return e; if (a < 0) return ERR.NUM; return edate(a, b); }, { min: 2, max: 2 }));
def('EOMONTH', (A, ctx) => lift(A, ctx, (s, m) => { const a = num(s), b = num(m); const e = firstErr(a, b); if (e) return e; if (a < 0) return ERR.NUM; const { y, m: mo } = ymd(a); const tm = mo + Math.trunc(b); const ty = y + Math.floor(tm / 12), mm = ((tm % 12) + 12) % 12; return serial(ty, mm, daysInMonth(ty, mm)); }, { min: 2, max: 2 }));
def('NETWORKDAYS', (A, ctx) => { const s = num(argN(A, 0, ctx)), e = num(argN(A, 1, ctx)); const er = firstErr(s, e); if (er) return er; const hol = holidaysOf(A, 2, ctx); if (isErr(hol)) return hol; return networkdays(s, e, weekendMask(1), hol); });
def('NETWORKDAYS.INTL', (A, ctx) => { const s = num(argN(A, 0, ctx)), e = num(argN(A, 1, ctx)); const er = firstErr(s, e); if (er) return er; const wv = has(A, 2) ? argN(A, 2, ctx) : 1; const mask = weekendMask(typeof wv === 'string' ? wv : Math.trunc(num(wv))); if (!mask) return ERR.NUM; const hol = holidaysOf(A, 3, ctx); if (isErr(hol)) return hol; return networkdays(s, e, mask, hol); });
def('WORKDAY', (A, ctx) => { const s = num(argN(A, 0, ctx)), d = num(argN(A, 1, ctx)); const er = firstErr(s, d); if (er) return er; const hol = holidaysOf(A, 2, ctx); if (isErr(hol)) return hol; return workday(s, d, weekendMask(1), hol); });
def('WORKDAY.INTL', (A, ctx) => { const s = num(argN(A, 0, ctx)), d = num(argN(A, 1, ctx)); const er = firstErr(s, d); if (er) return er; const wv = has(A, 2) ? argN(A, 2, ctx) : 1; const mask = weekendMask(typeof wv === 'string' ? wv : Math.trunc(num(wv))); if (!mask) return ERR.NUM; const hol = holidaysOf(A, 3, ctx); if (isErr(hol)) return hol; return workday(s, d, mask, hol); });
def('DATEDIF', (A, ctx) => {
  const s = num(argN(A, 0, ctx)), e = num(argN(A, 1, ctx)); const er = firstErr(s, e); if (er) return er;
  const unit = str(argN(A, 2, ctx)).toUpperCase();
  if (s > e) return ERR.NUM;
  const a = ymd(s), b = ymd(e);
  let months = (b.y - a.y) * 12 + (b.m - a.m); if (b.d < a.d) months--;
  switch (unit) {
    case 'Y': return Math.floor(months / 12);
    case 'M': return months;
    case 'D': return Math.floor(e) - Math.floor(s);
    case 'MD': { let d = b.d - a.d; if (d < 0) { const pm = b.m === 0 ? 11 : b.m - 1, py = b.m === 0 ? b.y - 1 : b.y; d += daysInMonth(py, pm); } return d; }
    case 'YM': return months % 12;
    case 'YD': { let ss = serial(b.y, a.m, a.d); if (ss > Math.floor(e)) ss = serial(b.y - 1, a.m, a.d); return Math.floor(e) - ss; }
  }
  return ERR.NUM;
});
def('DAYS', (A, ctx) => { const e = num(argN(A, 0, ctx)), s = num(argN(A, 1, ctx)); const er = firstErr(e, s); if (er) return er; return Math.floor(e) - Math.floor(s); });
def('DAYS360', (A, ctx) => { const s = num(argN(A, 0, ctx)), e = num(argN(A, 1, ctx)); const er = firstErr(s, e); if (er) return er; return days360(s, e, has(A, 2) ? bool(argN(A, 2, ctx)) === true : false); });
def('DATEVALUE', (A, ctx) => lift(A, ctx, v => { if (isErr(v)) return v; const d = parseDateText(str(v)); return d === null ? ERR.VALUE : Math.floor(d); }, { min: 1, max: 1 }));
def('TIMEVALUE', (A, ctx) => lift(A, ctx, v => { if (isErr(v)) return v; const t = str(v).trim(); const m = /(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?)$/i.exec(t); const d = m ? parseDateText(m[1]) : null; return d === null ? ERR.VALUE : tame(d - Math.floor(d)); }, { min: 1, max: 1 }));
def('YEARFRAC', (A, ctx) => { const s = num(argN(A, 0, ctx)), e = num(argN(A, 1, ctx)); const er = firstErr(s, e); if (er) return er; const b = has(A, 2) ? Math.trunc(num(argN(A, 2, ctx))) : 0; if (isErr(b)) return b; const r = yearfrac(s, e, b); return isErr(r) ? r : tame(r); });

// information
def('ISBLANK', (A, ctx) => lift(A, ctx, v => v === null || v === undefined, { min: 1, max: 1 }));
def('ISNUMBER', (A, ctx) => lift(A, ctx, v => typeof v === 'number', { min: 1, max: 1 }));
def('ISTEXT', (A, ctx) => lift(A, ctx, v => typeof v === 'string', { min: 1, max: 1 }));
def('ISNONTEXT', (A, ctx) => lift(A, ctx, v => typeof v !== 'string', { min: 1, max: 1 }));
def('ISLOGICAL', (A, ctx) => lift(A, ctx, v => typeof v === 'boolean', { min: 1, max: 1 }));
def('ISERROR', (A, ctx) => lift(A, ctx, v => isErr(v), { min: 1, max: 1 }));
def('ISERR', (A, ctx) => lift(A, ctx, v => isErr(v) && v.code !== '#N/A', { min: 1, max: 1 }));
def('ISNA', (A, ctx) => lift(A, ctx, v => isErr(v) && v.code === '#N/A', { min: 1, max: 1 }));
def('ISEVEN ISODD', (A, ctx, name) => lift(A, ctx, v => { const n = num(v); if (isErr(n)) return n; const even = Math.trunc(n) % 2 === 0; return name === 'ISEVEN' ? even : !even; }, { min: 1, max: 1 }));
def('ISFORMULA', (A, ctx) => { const v = A[0] ? ev(A[0], ctx) : null; if (!v || !v.range) return ERR.VALUE; return !!(ctx.isFormula && ctx.isFormula(v.sheet, v.r1, v.c1)); });
def('ISREF', (A) => !!A[0] && ['ref', 'range', 'spill'].includes(A[0].k));
def('NA', () => ERR.NA);
const ERROR_TYPE = { '#NULL!': 1, '#DIV/0!': 2, '#VALUE!': 3, '#REF!': 4, '#NAME?': 5, '#NUM!': 6, '#N/A': 7, '#SPILL!': 9, '#CALC!': 14 };
def('ERROR.TYPE', (A, ctx) => { const v = argN(A, 0, ctx); return isErr(v) ? ERROR_TYPE[v.code] || ERR.NA : ERR.NA; });
def('TYPE', (A, ctx) => { const v = A[0] ? ev(A[0], ctx) : null; if (isMulti(v)) return 64; const s = scalar(v, ctx); return typeof s === 'number' || s === null ? 1 : typeof s === 'string' ? 2 : typeof s === 'boolean' ? 4 : isErr(s) ? 16 : 1; });

// financial
const fin = (A, ctx, n, defs) => { const out = []; for (let i = 0; i < n; i++) { const v = has(A, i) ? num(argN(A, i, ctx)) : defs[i]; if (v === undefined) return ERR.VALUE; if (isErr(v)) return v; out.push(v); } return out; };
def('PMT', (A, ctx) => { const a = fin(A, ctx, 5, [undefined, undefined, undefined, 0, 0]); if (isErr(a)) return a; const [r, n, pv, fv, t] = a; if (n === 0) return ERR.NUM; return tame(pmtCalc(r, n, pv, fv, t ? 1 : 0)); });
def('FV', (A, ctx) => { const a = fin(A, ctx, 5, [undefined, undefined, undefined, 0, 0]); if (isErr(a)) return a; const [r, n, pmt, pv, t] = a; return tame(fvCalc(r, n, pmt, pv, t ? 1 : 0)); });
def('PV', (A, ctx) => {
  const a = fin(A, ctx, 5, [undefined, undefined, undefined, 0, 0]); if (isErr(a)) return a; const [r, n, pmt, fv, t] = a;
  if (r === 0) return tame(-(fv + pmt * n));
  const f = Math.pow(1 + r, n);
  return tame(-(fv + pmt * (1 + r * (t ? 1 : 0)) * (f - 1) / r) / f);
});
def('NPER', (A, ctx) => {
  const a = fin(A, ctx, 5, [undefined, undefined, undefined, 0, 0]); if (isErr(a)) return a; const [r, pmt, pv, fv, t0] = a; const t = t0 ? 1 : 0;
  if (r === 0) return pmt === 0 ? ERR.NUM : tame(-(pv + fv) / pmt);
  const x = (pmt * (1 + r * t) - fv * r) / (pmt * (1 + r * t) + pv * r);
  if (x <= 0) return ERR.NUM;
  return tame(Math.log(x) / Math.log(1 + r));
});
def('RATE', (A, ctx) => {
  const a = fin(A, ctx, 6, [undefined, undefined, undefined, 0, 0, 0.1]); if (isErr(a)) return a; const [n, pmt, pv, fv, t0, guess] = a; const t = t0 ? 1 : 0;
  const f = r => (Math.abs(r) < 1e-12 ? pv + pmt * n + fv : pv * Math.pow(1 + r, n) + pmt * (1 + r * t) * (Math.pow(1 + r, n) - 1) / r + fv);
  const r = newton(f, guess);
  return r === null ? ERR.NUM : Math.abs(r) < 1e-10 ? 0 : tame(r);
});
def('NPV', (A, ctx) => {
  const r = num(argN(A, 0, ctx)); if (isErr(r)) return r;
  const xs = numbersOf(A.slice(1), ctx); if (isErr(xs)) return xs;
  if (r === -1) return ERR.DIV0;
  return tame(xs.reduce((s, v, i) => s + v / Math.pow(1 + r, i + 1), 0));
});
def('IRR', (A, ctx) => {
  const xs = flatVals(ev(A[0], ctx), ctx).filter(v => typeof v === 'number');
  const guess = has(A, 1) ? num(argN(A, 1, ctx)) : 0.1; if (isErr(guess)) return guess;
  if (!xs.some(v => v > 0) || !xs.some(v => v < 0)) return ERR.NUM;
  const f = r => xs.reduce((s, v, i) => s + v / Math.pow(1 + r, i), 0);
  const df = r => xs.reduce((s, v, i) => s - i * v / Math.pow(1 + r, i + 1), 0);
  const r = newton(f, guess, df);
  return r === null ? ERR.NUM : tame(r);
});
def('IPMT PPMT', (A, ctx, name) => {
  const a = fin(A, ctx, 6, [undefined, undefined, undefined, undefined, 0, 0]); if (isErr(a)) return a; const [r, per, n, pv, fv, t0] = a; const t = t0 ? 1 : 0;
  if (per < 1 || per > n) return ERR.NUM;
  const ip = ipmtCalc(r, per, n, pv, fv, t);
  return tame(name === 'IPMT' ? ip : pmtCalc(r, n, pv, fv, t) - ip);
});
def('CUMIPMT CUMPRINC', (A, ctx, name) => {
  const a = fin(A, ctx, 6, []); if (isErr(a)) return a; const [r, n, pv, s, e, t] = a;
  if (r <= 0 || n <= 0 || pv <= 0 || s < 1 || e < s || e > n || (t !== 0 && t !== 1)) return ERR.NUM;
  let sum = 0;
  for (let p = Math.ceil(s); p <= Math.floor(e); p++) { const ip = ipmtCalc(r, p, n, pv, 0, t); sum += name === 'CUMIPMT' ? ip : pmtCalc(r, n, pv, 0, t) - ip; }
  return tame(sum);
});
def('EFFECT', (A, ctx) => { const a = fin(A, ctx, 2, []); if (isErr(a)) return a; const [nom, n0] = a; const n = Math.trunc(n0); if (nom <= 0 || n < 1) return ERR.NUM; return tame(Math.pow(1 + nom / n, n) - 1); });
def('NOMINAL', (A, ctx) => { const a = fin(A, ctx, 2, []); if (isErr(a)) return a; const [eff, n0] = a; const n = Math.trunc(n0); if (eff <= 0 || n < 1) return ERR.NUM; return tame(n * (Math.pow(1 + eff, 1 / n) - 1)); });
def('SLN', (A, ctx) => { const a = fin(A, ctx, 3, []); if (isErr(a)) return a; const [c, s, l] = a; if (l === 0) return ERR.DIV0; return tame((c - s) / l); });
def('XNPV', (A, ctx) => {
  const r = num(argN(A, 0, ctx)); if (isErr(r)) return r;
  const vs = flatVals(ev(A[1], ctx), ctx), ds = flatVals(ev(A[2], ctx), ctx);
  if (vs.length !== ds.length || !vs.length) return ERR.NUM;
  if (vs.some(v => typeof v !== 'number') || ds.some(v => typeof v !== 'number')) return ERR.VALUE;
  return tame(vs.reduce((s, v, i) => s + v / Math.pow(1 + r, (ds[i] - ds[0]) / 365), 0));
});
def('XIRR', (A, ctx) => {
  const vs = flatVals(ev(A[0], ctx), ctx), ds = flatVals(ev(A[1], ctx), ctx);
  const guess = has(A, 2) ? num(argN(A, 2, ctx)) : 0.1;
  if (vs.length !== ds.length || vs.some(v => typeof v !== 'number') || ds.some(v => typeof v !== 'number')) return ERR.NUM;
  if (!vs.some(v => v > 0) || !vs.some(v => v < 0)) return ERR.NUM;
  const f = r => vs.reduce((s, v, i) => s + v / Math.pow(1 + r, (ds[i] - ds[0]) / 365), 0);
  const r = newton(f, guess);
  return r === null ? ERR.NUM : tame(r);
});

function callFn(n, ctx) {
  const fn = F[n.name];
  if (!fn) return ERR.NAME;
  return fn(n.args, ctx, n.name);
}

// ---------------- catalogue for the "insert function" dialog ----------------
// [German name, category, short description, example]
export const FN_CATEGORIES = ['Häufig verwendet', 'Mathematik', 'Statistik', 'Logik', 'Nachschlagen & Verweisen', 'Text', 'Datum & Uhrzeit', 'Information', 'Finanzmathematik'];
export const FUNCTION_LIST = [
  ['SUMME', 'Mathematik', 'Summe der Werte', 'SUMME(A1:A10)'], ['MITTELWERT', 'Statistik', 'Durchschnitt', 'MITTELWERT(A1:A10)'], ['MIN', 'Statistik', 'Kleinster Wert', 'MIN(A1:A10)'],
  ['MAX', 'Statistik', 'Größter Wert', 'MAX(A1:A10)'], ['ANZAHL', 'Statistik', 'Anzahl der Zahlen', 'ANZAHL(A1:A10)'], ['ANZAHL2', 'Statistik', 'Anzahl nicht leerer Zellen', 'ANZAHL2(A1:A10)'],
  ['WENN', 'Logik', 'Bedingung prüfen', 'WENN(A1>0;"ja";"nein")'], ['RUNDEN', 'Mathematik', 'Runden', 'RUNDEN(A1;2)'], ['SVERWEIS', 'Nachschlagen & Verweisen', 'Wert in Tabelle suchen', 'SVERWEIS(A1;D1:E10;2;FALSCH)'],
  ['HEUTE', 'Datum & Uhrzeit', 'Heutiges Datum', 'HEUTE()'], ['VERKETTEN', 'Text', 'Texte verbinden', 'VERKETTEN(A1;" ";B1)'], ['ABS', 'Mathematik', 'Betrag', 'ABS(A1)'],
  ['SUMMEWENN', 'Mathematik', 'Summe mit Bedingung', 'SUMMEWENN(A1:A10;">0")'], ['ZÄHLENWENN', 'Statistik', 'Zählen mit Bedingung', 'ZÄHLENWENN(A1:A10;"ja")'],
  ['WENNFEHLER', 'Logik', 'Fehler abfangen', 'WENNFEHLER(A1/B1;0)'], ['XVERWEIS', 'Nachschlagen & Verweisen', 'Wert suchen und zurückgeben (modern)', 'XVERWEIS(A1;D2:D10;E2:E10;"nicht gefunden")'],
  ['UND', 'Logik', 'Alle Bedingungen wahr', 'UND(A1>0;B1>0)'], ['ODER', 'Logik', 'Eine Bedingung wahr', 'ODER(A1>0;B1>0)'], ['NICHT', 'Logik', 'Wahrheitswert umkehren', 'NICHT(A1>0)'],
  ['XODER', 'Logik', 'Genau eine (ungerade Anzahl) wahr', 'XODER(A1>0;B1>0)'], ['WENNS', 'Logik', 'Mehrere Bedingungen nacheinander', 'WENNS(A1>90;"sehr gut";A1>50;"ok";WAHR;"schwach")'], ['LET', 'Logik', 'Namen für Zwischenergebnisse vergeben', 'LET(x;A1*2;x+x)'],
  ['ERSTERWERT', 'Logik', 'Wert mit Liste vergleichen', 'ERSTERWERT(A1;1;"eins";2;"zwei";"andere")'], ['WENNNV', 'Logik', '#NV abfangen', 'WENNNV(SVERWEIS(A1;D:E;2;0);"—")'],
  ['PRODUKT', 'Mathematik', 'Produkt', 'PRODUKT(A1:A3)'], ['SUMMENPRODUKT', 'Mathematik', 'Summe der Produkte', 'SUMMENPRODUKT(A1:A5;B1:B5)'], ['SUMMEWENNS', 'Mathematik', 'Summe mit mehreren Bedingungen', 'SUMMEWENNS(C1:C10;A1:A10;"Nord";B1:B10;">100")'],
  ['AUFRUNDEN', 'Mathematik', 'Aufrunden', 'AUFRUNDEN(A1;0)'], ['ABRUNDEN', 'Mathematik', 'Abrunden', 'ABRUNDEN(A1;0)'], ['VRUNDEN', 'Mathematik', 'Auf ein Vielfaches runden', 'VRUNDEN(A1;5)'],
  ['OBERGRENZE', 'Mathematik', 'Auf Vielfaches aufrunden', 'OBERGRENZE(A1;0,05)'], ['UNTERGRENZE', 'Mathematik', 'Auf Vielfaches abrunden', 'UNTERGRENZE(A1;0,05)'],
  ['GANZZAHL', 'Mathematik', 'Auf ganze Zahl abrunden', 'GANZZAHL(A1)'], ['KÜRZEN', 'Mathematik', 'Nachkommastellen abschneiden', 'KÜRZEN(A1;1)'], ['REST', 'Mathematik', 'Rest einer Division', 'REST(A1;2)'],
  ['POTENZ', 'Mathematik', 'Potenz', 'POTENZ(2;10)'], ['WURZEL', 'Mathematik', 'Quadratwurzel', 'WURZEL(A1)'], ['EXP', 'Mathematik', 'e hoch x', 'EXP(1)'], ['LN', 'Mathematik', 'Natürlicher Logarithmus', 'LN(A1)'],
  ['LOG', 'Mathematik', 'Logarithmus', 'LOG(A1;10)'], ['PI', 'Mathematik', 'Kreiszahl π', 'PI()'], ['VORZEICHEN', 'Mathematik', 'Vorzeichen', 'VORZEICHEN(A1)'], ['FAKULTÄT', 'Mathematik', 'Fakultät', 'FAKULTÄT(5)'],
  ['GGT', 'Mathematik', 'Größter gemeinsamer Teiler', 'GGT(12;18)'], ['KGV', 'Mathematik', 'Kleinstes gemeinsames Vielfaches', 'KGV(4;6)'], ['ZUFALLSZAHL', 'Mathematik', 'Zufallszahl zwischen 0 und 1', 'ZUFALLSZAHL()'],
  ['ZUFALLSBEREICH', 'Mathematik', 'Zufällige ganze Zahl', 'ZUFALLSBEREICH(1;6)'], ['TEILERGEBNIS', 'Mathematik', 'Teilergebnis (ignoriert Teilergebnisse)', 'TEILERGEBNIS(9;A1:A10)'],
  ['SIN', 'Mathematik', 'Sinus (Bogenmaß)', 'SIN(PI()/2)'], ['GRAD', 'Mathematik', 'Bogenmaß in Grad', 'GRAD(PI())'], ['BOGENMASS', 'Mathematik', 'Grad in Bogenmaß', 'BOGENMASS(180)'],
  ['MEDIAN', 'Statistik', 'Median', 'MEDIAN(A1:A10)'], ['MODALWERT', 'Statistik', 'Häufigster Wert', 'MODALWERT(A1:A10)'], ['STABW.S', 'Statistik', 'Standardabweichung (Stichprobe)', 'STABW.S(A1:A10)'],
  ['STABW.N', 'Statistik', 'Standardabweichung (Grundgesamtheit)', 'STABW.N(A1:A10)'], ['VAR.S', 'Statistik', 'Varianz (Stichprobe)', 'VAR.S(A1:A10)'], ['KGRÖSSTE', 'Statistik', 'k-größter Wert', 'KGRÖSSTE(A1:A10;2)'],
  ['KKLEINSTE', 'Statistik', 'k-kleinster Wert', 'KKLEINSTE(A1:A10;2)'], ['RANG.GLEICH', 'Statistik', 'Rang einer Zahl', 'RANG.GLEICH(A1;A$1:A$10)'], ['QUANTIL.INKL', 'Statistik', 'Quantil', 'QUANTIL.INKL(A1:A10;0,9)'],
  ['QUARTILE.INKL', 'Statistik', 'Quartil', 'QUARTILE.INKL(A1:A10;1)'], ['KORREL', 'Statistik', 'Korrelationskoeffizient', 'KORREL(A1:A10;B1:B10)'], ['ZÄHLENWENNS', 'Statistik', 'Zählen mit mehreren Bedingungen', 'ZÄHLENWENNS(A1:A10;"Nord";B1:B10;">100")'],
  ['MITTELWERTWENN', 'Statistik', 'Durchschnitt mit Bedingung', 'MITTELWERTWENN(A1:A10;">0")'], ['MITTELWERTWENNS', 'Statistik', 'Durchschnitt mit mehreren Bedingungen', 'MITTELWERTWENNS(C1:C10;A1:A10;"Nord")'],
  ['MAXWENNS', 'Statistik', 'Maximum mit Bedingungen', 'MAXWENNS(C1:C10;A1:A10;"Nord")'], ['MINWENNS', 'Statistik', 'Minimum mit Bedingungen', 'MINWENNS(C1:C10;A1:A10;"Nord")'],
  ['ANZAHLLEEREZELLEN', 'Statistik', 'Anzahl leerer Zellen', 'ANZAHLLEEREZELLEN(A1:A10)'],
  ['WVERWEIS', 'Nachschlagen & Verweisen', 'Waagerecht suchen', 'WVERWEIS(A1;A5:F6;2;FALSCH)'], ['VERGLEICH', 'Nachschlagen & Verweisen', 'Position eines Werts', 'VERGLEICH(A1;D1:D10;0)'],
  ['XVERGLEICH', 'Nachschlagen & Verweisen', 'Position eines Werts (modern)', 'XVERGLEICH(A1;D1:D10)'], ['INDEX', 'Nachschlagen & Verweisen', 'Wert an Position', 'INDEX(A1:C10;2;3)'],
  ['WAHL', 'Nachschlagen & Verweisen', 'Wert aus Liste wählen', 'WAHL(2;"a";"b";"c")'], ['ZEILE', 'Nachschlagen & Verweisen', 'Zeilennummer', 'ZEILE(A5)'], ['SPALTE', 'Nachschlagen & Verweisen', 'Spaltennummer', 'SPALTE(C1)'],
  ['ZEILEN', 'Nachschlagen & Verweisen', 'Anzahl Zeilen', 'ZEILEN(A1:A10)'], ['SPALTEN', 'Nachschlagen & Verweisen', 'Anzahl Spalten', 'SPALTEN(A1:D1)'],
  ['BEREICH.VERSCHIEBEN', 'Nachschlagen & Verweisen', 'Verschobener Bereich', 'BEREICH.VERSCHIEBEN(A1;2;1)'], ['INDIREKT', 'Nachschlagen & Verweisen', 'Bezug aus Text', 'INDIREKT("B"&A1)'],
  ['ADRESSE', 'Nachschlagen & Verweisen', 'Zelladresse als Text', 'ADRESSE(2;3)'], ['MTRANS', 'Nachschlagen & Verweisen', 'Zeilen und Spalten tauschen', 'MTRANS(A1:C2)'],
  ['FILTER', 'Nachschlagen & Verweisen', 'Zeilen nach Bedingung filtern (überläuft)', 'FILTER(A2:C20;B2:B20>100;"keine")'], ['SORTIEREN', 'Nachschlagen & Verweisen', 'Bereich sortieren (überläuft)', 'SORTIEREN(A2:B20;2;-1)'],
  ['SORTIERENNACH', 'Nachschlagen & Verweisen', 'Nach anderem Bereich sortieren', 'SORTIERENNACH(A2:A20;B2:B20;-1)'], ['EINDEUTIG', 'Nachschlagen & Verweisen', 'Doppelte entfernen (überläuft)', 'EINDEUTIG(A2:A20)'],
  ['SEQUENZ', 'Nachschlagen & Verweisen', 'Zahlenfolge (überläuft)', 'SEQUENZ(5;1;1;1)'],
  ['TEXTVERKETTEN', 'Text', 'Texte mit Trennzeichen verbinden', 'TEXTVERKETTEN(", ";WAHR;A1:A5)'], ['TEXTKETTE', 'Text', 'Bereiche verketten', 'TEXTKETTE(A1:C1)'], ['LINKS', 'Text', 'Zeichen von links', 'LINKS(A1;3)'],
  ['RECHTS', 'Text', 'Zeichen von rechts', 'RECHTS(A1;3)'], ['TEIL', 'Text', 'Zeichen aus der Mitte', 'TEIL(A1;2;3)'], ['LÄNGE', 'Text', 'Textlänge', 'LÄNGE(A1)'],
  ['FINDEN', 'Text', 'Position (Groß/klein beachten)', 'FINDEN("a";A1)'], ['SUCHEN', 'Text', 'Position (mit Platzhaltern)', 'SUCHEN("a*";A1)'], ['ERSETZEN', 'Text', 'Zeichen ersetzen', 'ERSETZEN(A1;1;3;"neu")'],
  ['WECHSELN', 'Text', 'Text austauschen', 'WECHSELN(A1;"alt";"neu")'], ['GLÄTTEN', 'Text', 'Überflüssige Leerzeichen entfernen', 'GLÄTTEN(A1)'], ['GROSS', 'Text', 'In Großbuchstaben', 'GROSS(A1)'],
  ['KLEIN', 'Text', 'In Kleinbuchstaben', 'KLEIN(A1)'], ['GROSS2', 'Text', 'Anfangsbuchstaben groß', 'GROSS2(A1)'], ['TEXT', 'Text', 'Zahl formatiert als Text', 'TEXT(A1;"TT.MM.JJJJ")'],
  ['WERT', 'Text', 'Text in Zahl umwandeln', 'WERT(A1)'], ['WIEDERHOLEN', 'Text', 'Text wiederholen', 'WIEDERHOLEN("*";5)'], ['IDENTISCH', 'Text', 'Texte exakt vergleichen', 'IDENTISCH(A1;B1)'],
  ['ZEICHEN', 'Text', 'Zeichen aus Code', 'ZEICHEN(65)'], ['CODE', 'Text', 'Code eines Zeichens', 'CODE("A")'], ['FEST', 'Text', 'Zahl mit festen Nachkommastellen', 'FEST(A1;2)'],
  ['SÄUBERN', 'Text', 'Steuerzeichen entfernen', 'SÄUBERN(A1)'], ['TEXTVOR', 'Text', 'Text vor einem Trennzeichen', 'TEXTVOR(A1;"@")'], ['TEXTNACH', 'Text', 'Text nach einem Trennzeichen', 'TEXTNACH(A1;"@")'],
  ['DATUM', 'Datum & Uhrzeit', 'Datum bilden', 'DATUM(2026;1;31)'], ['ZEIT', 'Datum & Uhrzeit', 'Uhrzeit bilden', 'ZEIT(14;30;0)'], ['JETZT', 'Datum & Uhrzeit', 'Datum und Uhrzeit jetzt', 'JETZT()'],
  ['JAHR', 'Datum & Uhrzeit', 'Jahr eines Datums', 'JAHR(A1)'], ['MONAT', 'Datum & Uhrzeit', 'Monat eines Datums', 'MONAT(A1)'], ['TAG', 'Datum & Uhrzeit', 'Tag eines Datums', 'TAG(A1)'],
  ['STUNDE', 'Datum & Uhrzeit', 'Stunde', 'STUNDE(A1)'], ['MINUTE', 'Datum & Uhrzeit', 'Minute', 'MINUTE(A1)'], ['SEKUNDE', 'Datum & Uhrzeit', 'Sekunde', 'SEKUNDE(A1)'],
  ['WOCHENTAG', 'Datum & Uhrzeit', 'Wochentag als Zahl', 'WOCHENTAG(A1;2)'], ['KALENDERWOCHE', 'Datum & Uhrzeit', 'Kalenderwoche', 'KALENDERWOCHE(A1;2)'],
  ['ISOKALENDERWOCHE', 'Datum & Uhrzeit', 'Kalenderwoche nach ISO (DIN)', 'ISOKALENDERWOCHE(A1)'], ['EDATUM', 'Datum & Uhrzeit', 'Datum plus Monate', 'EDATUM(A1;3)'],
  ['MONATSENDE', 'Datum & Uhrzeit', 'Letzter Tag des Monats', 'MONATSENDE(A1;0)'], ['NETTOARBEITSTAGE', 'Datum & Uhrzeit', 'Arbeitstage zwischen zwei Daten', 'NETTOARBEITSTAGE(A1;B1)'],
  ['ARBEITSTAG', 'Datum & Uhrzeit', 'Datum nach Arbeitstagen', 'ARBEITSTAG(A1;10)'], ['DATEDIF', 'Datum & Uhrzeit', 'Differenz in Jahren/Monaten/Tagen', 'DATEDIF(A1;B1;"Y")'],
  ['TAGE', 'Datum & Uhrzeit', 'Tage zwischen zwei Daten', 'TAGE(B1;A1)'], ['DATWERT', 'Datum & Uhrzeit', 'Text in Datum umwandeln', 'DATWERT("31.12.2026")'], ['BRTEILJAHRE', 'Datum & Uhrzeit', 'Bruchteil eines Jahres', 'BRTEILJAHRE(A1;B1;1)'],
  ['ISTLEER', 'Information', 'Zelle leer?', 'ISTLEER(A1)'], ['ISTZAHL', 'Information', 'Ist eine Zahl?', 'ISTZAHL(A1)'], ['ISTTEXT', 'Information', 'Ist Text?', 'ISTTEXT(A1)'],
  ['ISTFEHLER', 'Information', 'Ist ein Fehler?', 'ISTFEHLER(A1)'], ['ISTNV', 'Information', 'Ist #NV?', 'ISTNV(A1)'], ['ISTGERADE', 'Information', 'Gerade Zahl?', 'ISTGERADE(A1)'],
  ['ISTFORMEL', 'Information', 'Enthält eine Formel?', 'ISTFORMEL(A1)'], ['NV', 'Information', 'Fehlerwert #NV', 'NV()'], ['TYP', 'Information', 'Datentyp', 'TYP(A1)'],
  ['RMZ', 'Finanzmathematik', 'Rate eines Kredits', 'RMZ(5%/12;60;-20000)'], ['ZW', 'Finanzmathematik', 'Zukünftiger Wert', 'ZW(3%/12;120;-100)'], ['BW', 'Finanzmathematik', 'Barwert', 'BW(5%/12;60;-400)'],
  ['ZINS', 'Finanzmathematik', 'Zinssatz', 'ZINS(60;-400;20000)'], ['ZZR', 'Finanzmathematik', 'Anzahl Zahlungen', 'ZZR(5%/12;-400;20000)'], ['NBW', 'Finanzmathematik', 'Nettobarwert', 'NBW(8%;B2:B6)'],
  ['IKV', 'Finanzmathematik', 'Interner Zinsfuß', 'IKV(B1:B6)'], ['ZINSZ', 'Finanzmathematik', 'Zinsanteil einer Rate', 'ZINSZ(5%/12;1;60;20000)'], ['KAPZ', 'Finanzmathematik', 'Tilgungsanteil einer Rate', 'KAPZ(5%/12;1;60;20000)'],
  ['EFFEKTIV', 'Finanzmathematik', 'Effektiver Jahreszins', 'EFFEKTIV(5%;12)'], ['LIA', 'Finanzmathematik', 'Lineare Abschreibung', 'LIA(10000;1000;5)'],
  ['XKAPITALWERT', 'Finanzmathematik', 'Kapitalwert mit Datumsangaben', 'XKAPITALWERT(8%;B2:B6;A2:A6)'], ['XINTZINSFUSS', 'Finanzmathematik', 'Interner Zinsfuß mit Datumsangaben', 'XINTZINSFUSS(B2:B6;A2:A6)'],
];

export { fmtGeneralDe };
