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
  // lambda & array helpers
  ['LAMBDA', 'LAMBDA'], ['MAP', 'MAP'], ['REDUCE', 'REDUCE'], ['SCAN', 'SCAN'], ['BYROW', 'NACHZEILE'], ['BYCOL', 'NACHSPALTE'], ['MAKEARRAY', 'MATRIXERSTELLEN'],
  ['ISOMITTED', 'ISTAUSGELASSEN'], ['TEXTSPLIT', 'TEXTTEILEN'], ['VSTACK', 'VSTAPELN'], ['HSTACK', 'HSTAPELN'], ['TAKE', 'ÜBERNEHMEN', 'UEBERNEHMEN'], ['DROP', 'WEGLASSEN'],
  ['CHOOSEROWS', 'ZEILENWAHL'], ['CHOOSECOLS', 'SPALTENWAHL'], ['TOCOL', 'ZUSPALTE'], ['TOROW', 'ZUZEILE'], ['WRAPROWS', 'ZEILENUMBRUCH'], ['WRAPCOLS', 'SPALTENUMBRUCH'], ['EXPAND', 'ERWEITERN'],
  // statistics
  ['FREQUENCY', 'HÄUFIGKEIT', 'HAEUFIGKEIT'], ['SLOPE', 'STEIGUNG'], ['INTERCEPT', 'ACHSENABSCHNITT'], ['RSQ', 'BESTIMMTHEITSMASS', 'BESTIMMTHEITSMAß'], ['FORECAST', 'SCHÄTZER', 'SCHAETZER'],
  ['FORECAST.LINEAR', 'PROGNOSE.LINEAR'], ['TREND', 'TREND'], ['PERCENTRANK', 'QUANTILSRANG'], ['PERCENTRANK.INC', 'QUANTILSRANG.INKL'], ['PERCENTILE.EXC', 'QUANTIL.EXKL'],
  ['QUARTILE.EXC', 'QUARTILE.EXKL'], ['TRIMMEAN', 'GESTUTZTMITTEL'], ['HARMEAN', 'HARMITTEL'], ['DEVSQ', 'SUMQUADABW'], ['KURT', 'KURT'], ['SKEW', 'SCHIEFE'],
  ['STANDARDIZE', 'STANDARDISIERUNG'], ['COVARIANCE.P', 'KOVARIANZ.P'], ['COVARIANCE.S', 'KOVARIANZ.S'], ['PEARSON', 'PEARSON'], ['NORM.DIST', 'NORM.VERT'], ['NORM.INV', 'NORM.INV'],
  ['NORM.S.DIST', 'NORM.S.VERT'], ['NORM.S.INV', 'NORM.S.INV'], ['BINOM.DIST', 'BINOM.VERT'], ['POISSON.DIST', 'POISSON.VERT'], ['EXPON.DIST', 'EXPON.VERT'], ['CONFIDENCE.NORM', 'KONFIDENZ.NORM'],
  ['PERMUT', 'VARIATIONEN'], ['COUNTUNIQUE', 'ANZAHLEINDEUTIG'],
  // math
  ['SINH', 'SINHYP'], ['COSH', 'COSHYP'], ['TANH', 'TANHYP'], ['ASINH', 'ARCSINHYP'], ['ACOSH', 'ARCCOSHYP'], ['ATANH', 'ARCTANHYP'], ['COT', 'COT'], ['SQRTPI', 'WURZELPI'],
  ['FACTDOUBLE', 'ZWEIFAKULTÄT', 'ZWEIFAKULTAET'], ['MULTINOMIAL', 'POLYNOMIAL'], ['ROMAN', 'RÖMISCH', 'ROEMISCH'], ['ARABIC', 'ARABISCH'], ['BASE', 'BASIS'], ['DECIMAL', 'DEZIMAL'],
  ['DEC2BIN', 'DEZINBIN'], ['BIN2DEC', 'BININDEZ'], ['DEC2HEX', 'DEZINHEX'], ['HEX2DEC', 'HEXINDEZ'], ['DEC2OCT', 'DEZINOKT'], ['OCT2DEC', 'OKTINDEZ'],
  ['MMULT', 'MMULT'], ['MDETERM', 'MDET'], ['MINVERSE', 'MINV'], ['MUNIT', 'MEINHEIT'], ['SUMX2MY2', 'SUMMEX2MY2'], ['SUMX2PY2', 'SUMMEX2PY2'], ['SUMXMY2', 'SUMMEXMY2'], ['AGGREGATE', 'AGGREGAT'],
  // text & information
  ['VALUETOTEXT', 'WERTZUTEXT'], ['ARRAYTOTEXT', 'MATRIXZUTEXT'], ['REGEXTEST', 'REGEXTEST'], ['REGEXEXTRACT', 'REGEXEXTRAKT', 'REGEXEXTRAHIEREN'], ['REGEXREPLACE', 'REGEXERSETZEN'],
  ['HYPERLINK', 'HYPERLINK'], ['FORMULATEXT', 'FORMELTEXT'], ['SHEET', 'BLATT'], ['SHEETS', 'BLÄTTER', 'BLAETTER'], ['CELL', 'ZELLE'],
  // financial & database
  ['DB', 'GDA2'], ['DDB', 'GDA'], ['SYD', 'DIA'], ['MIRR', 'QIKV'], ['FVSCHEDULE', 'ZW2'], ['PDURATION', 'PDURATION'], ['RRI', 'ZSATZINVEST'], ['ISPMT', 'ISPMT'],
  ['DSUM', 'DBSUMME'], ['DCOUNT', 'DBANZAHL'], ['DCOUNTA', 'DBANZAHL2'], ['DAVERAGE', 'DBMITTELWERT'], ['DMAX', 'DBMAX'], ['DMIN', 'DBMIN'], ['DGET', 'DBAUSZUG'], ['DPRODUCT', 'DBPRODUKT'],
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
for (const n of ['LAMBDA', 'MAP', 'REDUCE', 'SCAN', 'BYROW', 'BYCOL', 'MAKEARRAY', 'ISOMITTED', 'TEXTSPLIT', 'VSTACK', 'HSTACK', 'TAKE', 'DROP', 'CHOOSEROWS', 'CHOOSECOLS',
  'TOCOL', 'TOROW', 'WRAPROWS', 'WRAPCOLS', 'EXPAND', 'FORECAST.LINEAR', 'PERCENTRANK.INC', 'PERCENTILE.EXC', 'QUARTILE.EXC', 'COVARIANCE.P', 'COVARIANCE.S', 'NORM.DIST',
  'NORM.INV', 'NORM.S.DIST', 'NORM.S.INV', 'BINOM.DIST', 'POISSON.DIST', 'EXPON.DIST', 'CONFIDENCE.NORM', 'COT', 'ARABIC', 'BASE', 'DECIMAL', 'MUNIT', 'AGGREGATE',
  'VALUETOTEXT', 'ARRAYTOTEXT', 'REGEXTEST', 'REGEXEXTRACT', 'REGEXREPLACE', 'FORMULATEXT', 'SHEET', 'SHEETS', 'PDURATION', 'RRI']) XLFN[n] = '_xlfn.' + n;
/** Functions whose result is an array that spills (for the xlsx writer: dynamic-array metadata). */
export const ARRAY_FUNCTIONS = new Set(['FILTER', 'SORT', 'SORTBY', 'UNIQUE', 'SEQUENCE', 'RANDARRAY', 'TRANSPOSE', 'TEXTSPLIT', 'VSTACK', 'HSTACK', 'TAKE', 'DROP', 'CHOOSEROWS',
  'CHOOSECOLS', 'TOCOL', 'TOROW', 'WRAPROWS', 'WRAPCOLS', 'EXPAND', 'MAP', 'SCAN', 'BYROW', 'BYCOL', 'MAKEARRAY', 'MMULT', 'MINVERSE', 'MUNIT', 'FREQUENCY']);
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
    // LET / LAMBDA parameters are written as _xlpm.name
    const params = new Set();
    tokens.forEach((t, i) => {
      if (t.t === 'fn' && t.v === 'LAMBDA') {
        let depth = 0;
        for (let j = i + 1; j < tokens.length; j++) {
          const x = tokens[j];
          if (x.t === 'ws') continue;
          if (x.t === '(') { depth++; continue; }
          if (x.t === ')') { depth--; if (!depth) break; continue; }
          const nx = tokens.slice(j + 1).find(y => y.t !== 'ws');
          if (depth === 1 && x.t === 'name' && nx && nx.t === 'sep') params.add(x.v.toUpperCase());
        }
        return;
      }
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
      case '(': { const e = cmp(); expect(')'); return postfixCall(e); }
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
        return postfixCall({ k: 'fn', name: t.v, args });
      }
      default: throw new SyntaxError('Ungültige Formel');
    }
  }
  // LAMBDA(x, x+1)(5): call the result of a function with arguments
  function postfixCall(node) {
    while (peek() && peek().t === '(') {
      next();
      const args = [];
      if (peek() && peek().t === ')') { next(); node = { k: 'call', f: node, args }; continue; }
      for (;;) {
        if (peek() && (peek().t === 'sep' || peek().t === ')')) args.push({ k: 'missing' });
        else args.push(cmp());
        const x = next();
        if (!x) throw new SyntaxError('Klammer fehlt');
        if (x.t === ')') break;
        if (x.t !== 'sep') throw new SyntaxError('Ungültige Formel');
      }
      node = { k: 'call', f: node, args };
    }
    return node;
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
      case 'call': walk(n.f); n.args.forEach(walk); break;
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
  if (v instanceof Lambda) return ERR.CALC;
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
      if (ctx.locals) { const u = n.v.toUpperCase(); if (u in ctx.locals) { const lv = ctx.locals[u]; return lv === OMITTED ? null : lv; } }
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
    case 'call': {
      const f = ev(n.f, ctx);
      if (!(f instanceof Lambda)) return isErr(f) ? f : ERR.VALUE;
      ctx.fnDepth = (ctx.fnDepth || 0) + 1;
      try { return invokeLambda(f, n.args.map(a => (a.k === 'missing' ? OMITTED : ev(a, ctx))), ctx); } finally { ctx.fnDepth--; }
    }
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

// ---------------- LAMBDA & helper functions ----------------
/** A LAMBDA value: parameters (upper case), body AST and the LET/LAMBDA variables visible where it was created. */
class Lambda {
  constructor(params, body, closure) { this.params = params; this.body = body; this.closure = closure; }
}
const OMITTED = Object.freeze({ omitted: true });
let lambdaDepth = 0;
function invokeLambda(lam, args, ctx) {
  if (args.length > lam.params.length) return ERR.VALUE;
  if (lambdaDepth > 400) return ERR.CALC;
  const saved = ctx.locals;
  const loc = Object.assign(Object.create(null), lam.closure || {});
  lam.params.forEach((p, i) => { loc[p] = i < args.length ? args[i] : OMITTED; });
  ctx.locals = loc;
  lambdaDepth++;
  try {
    const v = ev(lam.body, ctx);
    return v === OMITTED ? null : v;
  } finally { lambdaDepth--; ctx.locals = saved; }
}
/** Evaluated argument → Lambda (or error). */
function lambdaArg(A, i, ctx) {
  if (!A[i] || A[i].k === 'missing') return ERR.VALUE;
  const f = ev(A[i], ctx);
  return f instanceof Lambda ? f : isErr(f) ? f : ERR.VALUE;
}
/** Result of a lambda call used as one array element: must be a single value. */
function lamScalar(v, ctx) {
  if (v instanceof Lambda) return ERR.CALC;
  if (isMulti(v)) return ERR.CALC;
  const s = scalar(v, ctx);
  return s === null || s === undefined ? 0 : s;
}
const asArr = (v, ctx) => new Arr(grid(v, ctx).map(r => r.map(x => (x === undefined ? null : x))));
def('LAMBDA', (A, ctx) => {
  if (!A.length) return ERR.VALUE;
  const params = [];
  for (let i = 0; i < A.length - 1; i++) {
    if (A[i].k !== 'name') return ERR.VALUE;
    const p = A[i].v.toUpperCase();
    if (params.includes(p)) return ERR.VALUE;
    params.push(p);
  }
  return new Lambda(params, A[A.length - 1], ctx.locals ? Object.assign(Object.create(null), ctx.locals) : null);
});
def('ISOMITTED', (A, ctx) => {
  if (A.length !== 1) return ERR.VALUE;
  if (A[0].k === 'name' && ctx.locals) { const u = A[0].v.toUpperCase(); if (u in ctx.locals) return ctx.locals[u] === OMITTED; }
  return A[0].k === 'missing';
});
def('MAP', (A, ctx) => {
  if (A.length < 2) return ERR.VALUE;
  const lam = lambdaArg(A, A.length - 1, ctx); if (isErr(lam)) return lam;
  const gs = A.slice(0, -1).map(a => grid(ev(a, ctx), ctx));
  const H = Math.max(...gs.map(g => g.length)), W = Math.max(...gs.map(g => (g[0] || []).length));
  const rows = [];
  for (let r = 0; r < H; r++) {
    const row = [];
    for (let c = 0; c < W; c++) {
      const args = gs.map(g => { const gh = g.length, gw = (g[0] || []).length; const rr = gh === 1 ? 0 : r, cc = gw === 1 ? 0 : c; return rr < gh && cc < gw ? g[rr][cc] : ERR.NA; });
      row.push(lamScalar(invokeLambda(lam, args, ctx), ctx));
    }
    rows.push(row);
  }
  return new Arr(rows);
});
def('REDUCE SCAN', (A, ctx, name) => {
  if (A.length !== 3) return ERR.VALUE;
  let acc = A[0].k === 'missing' ? 0 : scalar(ev(A[0], ctx), ctx);
  const g = grid(ev(A[1], ctx), ctx);
  const lam = lambdaArg(A, 2, ctx); if (isErr(lam)) return lam;
  const out = g.map(row => row.map(x => { acc = invokeLambda(lam, [acc, x], ctx); if (name === 'SCAN') { acc = lamScalar(acc, ctx); } return acc; }));
  if (name === 'SCAN') return new Arr(out);
  return acc instanceof Lambda ? ERR.CALC : acc;
});
def('BYROW BYCOL', (A, ctx, name) => {
  if (A.length !== 2) return ERR.VALUE;
  const g = grid(ev(A[0], ctx), ctx);
  const lam = lambdaArg(A, 1, ctx); if (isErr(lam)) return lam;
  if (name === 'BYROW') return new Arr(g.map(row => [lamScalar(invokeLambda(lam, [new Arr([row])], ctx), ctx)]));
  const W = (g[0] || []).length;
  return new Arr([Array.from({ length: W }, (_, c) => lamScalar(invokeLambda(lam, [new Arr(g.map(r => [r[c]]))], ctx), ctx))]);
});
def('MAKEARRAY', (A, ctx) => {
  if (A.length !== 3) return ERR.VALUE;
  const R = Math.trunc(num(argN(A, 0, ctx))), C = Math.trunc(num(argN(A, 1, ctx)));
  if (isErr(R) || isErr(C)) return ERR.VALUE;
  if (R < 1 || C < 1 || R * C > 1e6) return ERR.VALUE;
  const lam = lambdaArg(A, 2, ctx); if (isErr(lam)) return lam;
  return new Arr(Array.from({ length: R }, (_, r) => Array.from({ length: C }, (_, c) => lamScalar(invokeLambda(lam, [r + 1, c + 1], ctx), ctx))));
});

// array shaping
const NA_PAD = () => ERR.NA;
function stack(A, ctx, vertical) {
  if (!A.length) return ERR.VALUE;
  const gs = A.map(a => grid(ev(a, ctx), ctx).map(r => r.map(x => (x === null || x === undefined ? 0 : x))));
  if (vertical) {
    const W = Math.max(...gs.map(g => (g[0] || []).length));
    return new Arr(gs.flatMap(g => g.map(r => Array.from({ length: W }, (_, c) => (c < r.length ? r[c] : NA_PAD())))));
  }
  const H = Math.max(...gs.map(g => g.length));
  return new Arr(Array.from({ length: H }, (_, r) => gs.flatMap(g => { const w = (g[0] || []).length; return r < g.length ? g[r] : new Array(w).fill(ERR.NA); })));
}
def('VSTACK', (A, ctx) => stack(A, ctx, true));
def('HSTACK', (A, ctx) => stack(A, ctx, false));
const clean0 = g => g.map(r => r.map(x => (x === null || x === undefined ? 0 : x)));
def('TAKE DROP', (A, ctx, name) => {
  if (A.length < 2 || A.length > 3) return ERR.VALUE;
  const g = clean0(grid(ev(A[0], ctx), ctx));
  const H = g.length, W = (g[0] || []).length;
  const rn = has(A, 1) ? Math.trunc(num(argN(A, 1, ctx))) : null, cn = has(A, 2) ? Math.trunc(num(argN(A, 2, ctx))) : null;
  if (isErr(rn) || isErr(cn)) return ERR.VALUE;
  const pick = (len, n) => {
    if (n === null) return [0, len];
    if (name === 'TAKE') return n >= 0 ? [0, Math.min(n, len)] : [Math.max(0, len + n), len];
    return n >= 0 ? [Math.min(n, len), len] : [0, Math.max(0, len + n)];
  };
  const [r1, r2] = pick(H, rn), [c1, c2] = pick(W, cn);
  if (r2 <= r1 || c2 <= c1) return ERR.CALC;
  return new Arr(g.slice(r1, r2).map(r => r.slice(c1, c2)));
});
def('CHOOSEROWS CHOOSECOLS', (A, ctx, name) => {
  if (A.length < 2) return ERR.VALUE;
  let g = clean0(grid(ev(A[0], ctx), ctx));
  const byCol = name === 'CHOOSECOLS';
  if (byCol) g = g[0].map((_, c) => g.map(r => r[c]));
  const idx = [];
  for (const a of A.slice(1)) for (const v of flatVals(ev(a, ctx), ctx)) { const n = Math.trunc(num(v)); if (isErr(n)) return n; idx.push(n); }
  const out = [];
  for (const n of idx) { if (n === 0 || Math.abs(n) > g.length) return ERR.VALUE; out.push(g[n > 0 ? n - 1 : g.length + n]); }
  return new Arr(byCol ? out[0].map((_, r) => out.map(col => col[r])) : out);
});
def('TOCOL TOROW', (A, ctx, name) => {
  const g = grid(ev(A[0], ctx), ctx);
  const ignore = has(A, 1) ? Math.trunc(num(argN(A, 1, ctx))) : 0, byCol = has(A, 2) ? bool(argN(A, 2, ctx)) === true : false;
  if (isErr(ignore) || ignore < 0 || ignore > 3) return ERR.VALUE;
  const seq = byCol ? (g[0] || []).flatMap((_, c) => g.map(r => r[c])) : g.flat();
  const keep = seq.filter(v => !((ignore & 1) && (v === null || v === undefined)) && !((ignore & 2) && isErr(v))).map(v => (v === null || v === undefined ? 0 : v));
  if (!keep.length) return ERR.CALC;
  return new Arr(name === 'TOCOL' ? keep.map(v => [v]) : [keep]);
});
def('WRAPROWS WRAPCOLS', (A, ctx, name) => {
  const v = flatVals(ev(A[0], ctx), ctx).map(x => (x === null || x === undefined ? 0 : x));
  const n = Math.trunc(num(argN(A, 1, ctx))); if (isErr(n)) return n;
  if (n < 1) return ERR.NUM;
  const pad = has(A, 2) ? argN(A, 2, ctx) : ERR.NA;
  const chunks = [];
  for (let i = 0; i < v.length; i += n) { const ch = v.slice(i, i + n); while (ch.length < n) ch.push(pad); chunks.push(ch); }
  if (!chunks.length) return ERR.CALC;
  return new Arr(name === 'WRAPROWS' ? chunks : chunks[0].map((_, r) => chunks.map(c => c[r])));
});
def('EXPAND', (A, ctx) => {
  const g = clean0(grid(ev(A[0], ctx), ctx));
  const H = g.length, W = (g[0] || []).length;
  const R = has(A, 1) ? Math.trunc(num(argN(A, 1, ctx))) : H, C = has(A, 2) ? Math.trunc(num(argN(A, 2, ctx))) : W;
  if (isErr(R) || isErr(C)) return ERR.VALUE;
  if (R < H || C < W) return ERR.VALUE;
  const pad = has(A, 3) ? argN(A, 3, ctx) : ERR.NA;
  return new Arr(Array.from({ length: R }, (_, r) => Array.from({ length: C }, (_, c) => (r < H && c < W ? g[r][c] : pad))));
});
def('TEXTSPLIT', (A, ctx) => {
  if (A.length < 2 || A.length > 6) return ERR.VALUE;
  const text = argN(A, 0, ctx); if (isErr(text)) return text;
  const delims = v => (v === null ? [] : flatVals(v, ctx).map(str).filter(s => s !== ''));
  const cd = has(A, 1) ? delims(ev(A[1], ctx)) : [], rd = has(A, 2) ? delims(ev(A[2], ctx)) : [];
  if (!cd.length && !rd.length) return ERR.VALUE;
  const ignoreEmpty = has(A, 3) ? bool(argN(A, 3, ctx)) === true : false;
  const ci = has(A, 4) ? num(argN(A, 4, ctx)) === 1 : false;
  const pad = has(A, 5) ? argN(A, 5, ctx) : ERR.NA;
  const re = list => (list.length ? new RegExp(list.sort((a, b) => b.length - a.length).map(d => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), ci ? 'i' : '') : null);
  const rre = re(rd), cre = re(cd);
  let lines = rre ? str(text).split(rre) : [str(text)];
  if (ignoreEmpty) lines = lines.filter(l => l !== '');
  const rows = lines.map(l => { let p = cre ? l.split(cre) : [l]; if (ignoreEmpty) p = p.filter(x => x !== ''); return p; }).filter(r => r.length);
  if (!rows.length) return ERR.CALC;
  const W = Math.max(...rows.map(r => r.length));
  return new Arr(rows.map(r => Array.from({ length: W }, (_, c) => (c < r.length ? r[c] : pad))));
});

// statistics
/** Numbers of a value (range/array/scalar): errors propagate, text and blanks skipped. */
function numsOf(v, ctx) {
  const out = [];
  for (const x of flatVals(v, ctx)) { if (isErr(x)) return x; if (typeof x === 'number') out.push(x); }
  return out;
}
/** Paired numbers (y, x) of two equally sized ranges: pairs where both are numbers. */
function pairs(A, ctx, iy = 0, ix = 1) {
  const a = flatVals(ev(A[iy], ctx), ctx), b = flatVals(ev(A[ix], ctx), ctx);
  if (a.length !== b.length) return ERR.NA;
  const ys = [], xs = [];
  for (let i = 0; i < a.length; i++) { if (isErr(a[i])) return a[i]; if (isErr(b[i])) return b[i]; if (typeof a[i] === 'number' && typeof b[i] === 'number') { ys.push(a[i]); xs.push(b[i]); } }
  return { ys, xs };
}
function linreg(ys, xs) {
  const n = xs.length;
  const mx = xs.reduce((p, q) => p + q, 0) / n, my = ys.reduce((p, q) => p + q, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return { n, mx, my, sxy, sxx, syy, slope: sxx ? sxy / sxx : NaN, icpt: sxx ? my - (sxy / sxx) * mx : NaN };
}
def('SLOPE INTERCEPT RSQ PEARSON', (A, ctx, name) => {
  if (A.length !== 2) return ERR.VALUE;
  const p = pairs(A, ctx); if (isErr(p)) return p;
  if (p.xs.length < (name === 'PEARSON' || name === 'RSQ' ? 2 : 1)) return ERR.DIV0;
  const L = linreg(p.ys, p.xs);
  if (!L.sxx) return ERR.DIV0;
  if (name === 'SLOPE') return tame(L.slope);
  if (name === 'INTERCEPT') return tame(L.icpt);
  if (!L.syy) return ERR.DIV0;
  const r = L.sxy / Math.sqrt(L.sxx * L.syy);
  return tame(name === 'RSQ' ? r * r : r);
});
def('FORECAST FORECAST.LINEAR', (A, ctx) => lift(A.slice(0, 1), ctx, x => {
  const xv = num(x); if (isErr(xv)) return xv;
  const p = pairs(A, ctx, 1, 2); if (isErr(p)) return p;
  if (!p.xs.length) return ERR.DIV0;
  const L = linreg(p.ys, p.xs); if (!L.sxx) return ERR.DIV0;
  return tame(L.icpt + L.slope * xv);
}, { min: 1, max: 1 }));
def('TREND', (A, ctx) => {
  const ys = flatVals(ev(A[0], ctx), ctx);
  const xsV = has(A, 1) ? ev(A[1], ctx) : null;
  const xs = xsV ? flatVals(xsV, ctx) : ys.map((_, i) => i + 1);
  if (xs.length !== ys.length) return ERR.REF;
  if ([...xs, ...ys].some(v => typeof v !== 'number')) return ERR.VALUE;
  const L = linreg(ys, xs);
  const konst = has(A, 3) ? bool(argN(A, 3, ctx)) !== false : true;
  let slope = L.slope, icpt = L.icpt;
  if (!konst) { const sxy = xs.reduce((s, x, i) => s + x * ys[i], 0), sxx = xs.reduce((s, x) => s + x * x, 0); slope = sxx ? sxy / sxx : NaN; icpt = 0; }
  if (!Number.isFinite(slope)) return ERR.DIV0;
  const nv = has(A, 2) ? ev(A[2], ctx) : (xsV || new Arr(xs.map(x => [x])));
  const g = grid(nv, ctx);
  const res = g.map(r => r.map(x => (typeof x === 'number' ? tame(icpt + slope * x) : ERR.VALUE)));
  return res.length === 1 && res[0].length === 1 ? res[0][0] : new Arr(res);
});
def('FREQUENCY', (A, ctx) => {
  const data = numsOf(ev(A[0], ctx), ctx); if (isErr(data)) return data;
  const bins = numsOf(ev(A[1], ctx), ctx); if (isErr(bins)) return bins;
  const order = bins.map((b, i) => i).sort((a, b) => bins[a] - bins[b]);
  const counts = new Array(bins.length + 1).fill(0);
  for (const x of data) { let k = order.find(i => x <= bins[i]); counts[k === undefined ? bins.length : k]++; }
  return new Arr(counts.map(c => [c]));
});
def('PERCENTRANK PERCENTRANK.INC', (A, ctx) => {
  const xs = numsOf(ev(A[0], ctx), ctx); if (isErr(xs)) return xs;
  const x = num(argN(A, 1, ctx)); if (isErr(x)) return x;
  const sig = has(A, 2) ? Math.trunc(num(argN(A, 2, ctx))) : 3; if (isErr(sig)) return sig;
  if (!xs.length || sig < 1) return ERR.NUM;
  const s = [...xs].sort((a, b) => a - b), n = s.length;
  if (x < s[0] || x > s[n - 1]) return ERR.NA;
  if (n === 1) return 1;
  let rank;
  const lo = s.filter(v => v < x).length;
  if (s.includes(x)) rank = lo / (n - 1);
  else { const a = s[lo - 1], b = s[lo]; rank = (lo - 1 + (x - a) / (b - a)) / (n - 1); }
  const f = Math.pow(10, sig);
  return Math.floor(+(rank * f).toPrecision(12)) / f;
});
function percentileExc(xs, k) {
  const s = [...xs].sort((a, b) => a - b), n = s.length;
  const pos = k * (n + 1);
  if (!n || k <= 0 || k >= 1 || pos < 1 || pos > n) return ERR.NUM;
  const lo = Math.floor(pos);
  return tame(lo >= n ? s[n - 1] : s[lo - 1] + (s[lo] - s[lo - 1]) * (pos - lo));
}
def('PERCENTILE.EXC', (A, ctx) => { const xs = numsOf(ev(A[0], ctx), ctx); if (isErr(xs)) return xs; const k = num(argN(A, 1, ctx)); if (isErr(k)) return k; return percentileExc(xs, k); });
def('QUARTILE.EXC', (A, ctx) => { const xs = numsOf(ev(A[0], ctx), ctx); if (isErr(xs)) return xs; const q = Math.trunc(num(argN(A, 1, ctx))); if (isErr(q)) return q; if (q < 1 || q > 3) return ERR.NUM; return percentileExc(xs, q / 4); });
def('TRIMMEAN', (A, ctx) => {
  const xs = numsOf(ev(A[0], ctx), ctx); if (isErr(xs)) return xs;
  const p = num(argN(A, 1, ctx)); if (isErr(p)) return p;
  if (p < 0 || p >= 1 || !xs.length) return ERR.NUM;
  const k = Math.floor(xs.length * p / 2);
  const s = [...xs].sort((a, b) => a - b).slice(k, xs.length - k);
  return tame(s.reduce((a, b) => a + b, 0) / s.length);
});
def('HARMEAN', (A, ctx) => { const xs = numbersOf(A, ctx); if (isErr(xs)) return xs; if (!xs.length || xs.some(x => x <= 0)) return ERR.NUM; return tame(xs.length / xs.reduce((a, b) => a + 1 / b, 0)); });
def('DEVSQ', (A, ctx) => { const xs = numbersOf(A, ctx); if (isErr(xs)) return xs; if (!xs.length) return ERR.NUM; return tame(stats(xs).ss); });
def('KURT', (A, ctx) => {
  const xs = numbersOf(A, ctx); if (isErr(xs)) return xs;
  const n = xs.length; if (n < 4) return ERR.DIV0;
  const { mean, ss } = stats(xs); const sd = Math.sqrt(ss / (n - 1)); if (!sd) return ERR.DIV0;
  const s4 = xs.reduce((a, x) => a + ((x - mean) / sd) ** 4, 0);
  return tame(n * (n + 1) / ((n - 1) * (n - 2) * (n - 3)) * s4 - 3 * (n - 1) ** 2 / ((n - 2) * (n - 3)));
});
def('SKEW', (A, ctx) => {
  const xs = numbersOf(A, ctx); if (isErr(xs)) return xs;
  const n = xs.length; if (n < 3) return ERR.DIV0;
  const { mean, ss } = stats(xs); const sd = Math.sqrt(ss / (n - 1)); if (!sd) return ERR.DIV0;
  return tame(n / ((n - 1) * (n - 2)) * xs.reduce((a, x) => a + ((x - mean) / sd) ** 3, 0));
});
def('STANDARDIZE', (A, ctx) => lift(A, ctx, (x, m, s) => { const a = num(x), b = num(m), c = num(s); const e = firstErr(a, b, c); if (e) return e; if (c <= 0) return ERR.NUM; return tame((a - b) / c); }, { min: 3, max: 3 }));
def('COVARIANCE.P COVARIANCE.S', (A, ctx, name) => {
  const p = pairs(A, ctx); if (isErr(p)) return p;
  const n = p.xs.length; if (n < (name === 'COVARIANCE.S' ? 2 : 1)) return ERR.DIV0;
  const L = linreg(p.ys, p.xs);
  return tame(L.sxy / (name === 'COVARIANCE.S' ? n - 1 : n));
});
// normal distribution
function erf(x) {
  // high-precision erf via series / continued fraction (|error| < 1e-14)
  const ax = Math.abs(x);
  if (ax < 2.5) { let sum = x, term = x; const x2 = x * x; for (let n = 1; n < 200; n++) { term *= -x2 / n; const t = term / (2 * n + 1); sum += t; if (Math.abs(t) < 1e-17) break; } return 2 / Math.sqrt(Math.PI) * sum; }
  return Math.sign(x) * (1 - erfcCf(ax));
}
function erfcCf(x) {
  // continued fraction for erfc (x > 0)
  let f = 0;
  for (let n = 60; n >= 1; n--) f = n / 2 / (x + f);
  return Math.exp(-x * x) / Math.sqrt(Math.PI) / (x + f);
}
const normCdf = z => (z < -2.5 ? erfcCf(-z / Math.SQRT2) / 2 : z > 2.5 ? 1 - erfcCf(z / Math.SQRT2) / 2 : 0.5 * (1 + erf(z / Math.SQRT2)));
const normPdf = z => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
function normInv(p) {
  // Acklam's rational approximation + one Halley refinement step
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425;
  let x;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  else if (p <= 1 - pl) { const q = p - 0.5, r = q * q; x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
  else { const q = Math.sqrt(-2 * Math.log(1 - p)); x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  for (let i = 0; i < 2; i++) { const e = normCdf(x) - p; const u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2); x = x - u / (1 + x * u / 2); }
  return x;
}
def('NORM.DIST', (A, ctx) => lift(A, ctx, (x, m, s, cum) => {
  const a = num(x), b = num(m), c = num(s), k = bool(cum); const e = firstErr(a, b, c, k); if (e) return e;
  if (c <= 0) return ERR.NUM;
  const z = (a - b) / c;
  return tame(k ? normCdf(z) : normPdf(z) / c);
}, { min: 4, max: 4 }));
def('NORM.S.DIST', (A, ctx) => lift(A, ctx, (x, cum) => { const z = num(x), k = cum === undefined ? true : bool(cum); const e = firstErr(z, k); if (e) return e; return tame(k ? normCdf(z) : normPdf(z)); }, { min: 1, max: 2 }));
def('NORM.INV', (A, ctx) => lift(A, ctx, (p, m, s) => { const a = num(p), b = num(m), c = num(s); const e = firstErr(a, b, c); if (e) return e; if (a <= 0 || a >= 1 || c <= 0) return ERR.NUM; return tame(b + c * normInv(a)); }, { min: 3, max: 3 }));
def('NORM.S.INV', (A, ctx) => lift(A, ctx, p => { const a = num(p); if (isErr(a)) return a; if (a <= 0 || a >= 1) return ERR.NUM; return tame(normInv(a)); }, { min: 1, max: 1 }));
def('CONFIDENCE.NORM', (A, ctx) => lift(A, ctx, (al, s, n) => { const a = num(al), b = num(s), c = Math.trunc(num(n)); const e = firstErr(a, b, c); if (e) return e; if (a <= 0 || a >= 1 || b <= 0 || c < 1) return ERR.NUM; return tame(normInv(1 - a / 2) * b / Math.sqrt(c)); }, { min: 3, max: 3 }));
const lnFact = n => { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; };
def('BINOM.DIST', (A, ctx) => lift(A, ctx, (k0, n0, p0, cum) => {
  const k = Math.trunc(num(k0)), n = Math.trunc(num(n0)), p = num(p0), c = bool(cum); const e = firstErr(k, n, p, c); if (e) return e;
  if (k < 0 || k > n || p < 0 || p > 1) return ERR.NUM;
  const pmf = i => (p === 0 ? (i === 0 ? 1 : 0) : p === 1 ? (i === n ? 1 : 0) : Math.exp(lnFact(n) - lnFact(i) - lnFact(n - i) + i * Math.log(p) + (n - i) * Math.log(1 - p)));
  if (!c) return tame(pmf(k));
  let s = 0; for (let i = 0; i <= k; i++) s += pmf(i);
  return tame(Math.min(1, s));
}, { min: 4, max: 4 }));
def('POISSON.DIST', (A, ctx) => lift(A, ctx, (x0, m0, cum) => {
  const x = Math.trunc(num(x0)), m = num(m0), c = bool(cum); const e = firstErr(x, m, c); if (e) return e;
  if (x < 0 || m < 0) return ERR.NUM;
  if (m === 0) return c || x === 0 ? 1 : 0;
  const pmf = i => Math.exp(-m + i * Math.log(m) - lnFact(i));
  if (!c) return tame(pmf(x));
  let s = 0; for (let i = 0; i <= x; i++) s += pmf(i);
  return tame(Math.min(1, s));
}, { min: 3, max: 3 }));
def('EXPON.DIST', (A, ctx) => lift(A, ctx, (x0, l0, cum) => { const x = num(x0), l = num(l0), c = bool(cum); const e = firstErr(x, l, c); if (e) return e; if (x < 0 || l <= 0) return ERR.NUM; return tame(c ? 1 - Math.exp(-l * x) : l * Math.exp(-l * x)); }, { min: 3, max: 3 }));
def('PERMUT', (A, ctx) => lift(A, ctx, (a, b) => { const n = Math.trunc(num(a)), k = Math.trunc(num(b)); const e = firstErr(n, k); if (e) return e; if (n < 0 || k < 0 || k > n) return ERR.NUM; let r = 1; for (let i = 0; i < k; i++) r *= n - i; return Number.isFinite(r) ? r : ERR.NUM; }, { min: 2, max: 2 }));
def('COUNTUNIQUE', (A, ctx) => { const seen = new Set(); for (const { v } of values(A, ctx)) if (v !== null && v !== undefined && v !== '') seen.add(keyOf(v)); return seen.size; });

// math
def('SINH', N1(x => tame(Math.sinh(x)))); def('COSH', N1(x => tame(Math.cosh(x)))); def('TANH', N1(x => tame(Math.tanh(x))));
def('ASINH', N1(x => tame(Math.asinh(x)))); def('ACOSH', N1(x => (x < 1 ? ERR.NUM : tame(Math.acosh(x))))); def('ATANH', N1(x => (Math.abs(x) >= 1 ? ERR.NUM : tame(Math.atanh(x)))));
def('COT', N1(x => (x === 0 ? ERR.DIV0 : tame(1 / Math.tan(x)))));
def('SQRTPI', N1(x => (x < 0 ? ERR.NUM : tame(Math.sqrt(x * Math.PI)))));
def('FACTDOUBLE', N1(x => { if (x < 0) return ERR.NUM; let r = 1; for (let i = Math.floor(x); i > 1; i -= 2) r *= i; return Number.isFinite(r) ? r : ERR.NUM; }));
def('MULTINOMIAL', (A, ctx) => {
  const xs = numbersOf(A, ctx); if (isErr(xs)) return xs;
  if (xs.some(x => x < 0)) return ERR.NUM;
  const ks = xs.map(Math.floor); const total = ks.reduce((a, b) => a + b, 0);
  return Math.round(Math.exp(lnFact(total) - ks.reduce((a, k) => a + lnFact(k), 0)));
});
const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
def('ROMAN', (A, ctx) => lift(A, ctx, x => { let n = Math.trunc(num(x)); if (isErr(n)) return n; if (n < 0 || n > 3999) return ERR.VALUE; let s = ''; for (const [v, r] of ROMAN) while (n >= v) { s += r; n -= v; } return s; }, { min: 1, max: 2 }));
def('ARABIC', T1(s => {
  const t = s.trim().toUpperCase(); if (!t) return 0;
  const neg = t.startsWith('-'); const u = neg ? t.slice(1) : t;
  if (!/^[MDCLXVI]+$/.test(u)) return ERR.VALUE;
  const val = { M: 1000, D: 500, C: 100, L: 50, X: 10, V: 5, I: 1 };
  let n = 0; for (let i = 0; i < u.length; i++) { const a = val[u[i]], b = val[u[i + 1]] || 0; n += a < b ? -a : a; }
  return neg ? -n : n;
}));
def('BASE', (A, ctx) => lift(A, ctx, (x, r, l) => {
  const n = Math.trunc(num(x)), rad = Math.trunc(num(r)), len = l === undefined ? 0 : Math.trunc(num(l)); const e = firstErr(n, rad, len); if (e) return e;
  if (n < 0 || n >= 2 ** 53 || rad < 2 || rad > 36 || len < 0 || len > 255) return ERR.NUM;
  return n.toString(rad).toUpperCase().padStart(len, '0');
}, { min: 2, max: 3 }));
def('DECIMAL', (A, ctx) => lift(A, ctx, (t, r) => {
  const s = str(t).trim(), rad = Math.trunc(num(r)); if (isErr(rad)) return rad;
  if (rad < 2 || rad > 36 || s.length > 255) return ERR.NUM;
  const digits = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, rad);
  let n = 0; for (const ch of s.toUpperCase()) { const d = digits.indexOf(ch); if (d < 0) return ERR.NUM; n = n * rad + d; }
  return n;
}, { min: 2, max: 2 }));
// engineering base conversions (10 digit two's complement like spreadsheet apps)
const BASES = { BIN: [2, 10], OCT: [8, 10], HEX: [16, 10] };
function fromBase(s, radix) {
  const t = str(s).trim().toUpperCase();
  if (!t) return 0;
  if (t.length > 10 || !new RegExp(`^[${'0123456789ABCDEF'.slice(0, radix)}]+$`).test(t)) return ERR.NUM;
  let n = parseInt(t, radix);
  const full = radix ** 10;
  if (t.length === 10 && n >= full / 2) n -= full;
  return n;
}
function toBase(n, radix, places) {
  const full = radix ** 10;
  const lim = { 2: 512, 8: 536870912, 16: 549755813888 }[radix];
  n = Math.trunc(n);
  if (n < -lim || n > lim - 1) return ERR.NUM;
  if (n < 0) return (full + n).toString(radix).toUpperCase();
  const s = n.toString(radix).toUpperCase();
  if (places !== undefined && places !== null) { const p = Math.trunc(places); if (p < s.length || p > 10) return ERR.NUM; return s.padStart(p, '0'); }
  return s;
}
for (const [k, [radix]] of Object.entries(BASES)) {
  def(`${k}2DEC`, (A, ctx) => lift(A, ctx, s => (isErr(s) ? s : fromBase(typeof s === 'number' ? String(s) : s, radix)), { min: 1, max: 1 }));
  def(`DEC2${k}`, (A, ctx) => lift(A, ctx, (x, p) => { const n = num(x), pl = p === undefined ? undefined : num(p); const e = firstErr(n, pl); if (e) return e; return toBase(n, radix, pl); }, { min: 1, max: 2 }));
}
// matrices
function numMatrix(v, ctx) {
  const g = grid(v, ctx);
  for (const r of g) for (const x of r) { if (isErr(x)) return x; if (typeof x !== 'number') return ERR.VALUE; }
  return g;
}
def('MMULT', (A, ctx) => {
  if (A.length !== 2) return ERR.VALUE;
  const a = numMatrix(ev(A[0], ctx), ctx), b = numMatrix(ev(A[1], ctx), ctx);
  if (isErr(a)) return a; if (isErr(b)) return b;
  if ((a[0] || []).length !== b.length) return ERR.VALUE;
  return new Arr(a.map(r => b[0].map((_, j) => tame(r.reduce((s, x, k) => s + x * b[k][j], 0)))));
});
function luDet(m) {
  const n = m.length, a = m.map(r => r.slice());
  let det = 1;
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r;
    if (!a[p][i]) return 0;
    if (p !== i) { [a[p], a[i]] = [a[i], a[p]]; det = -det; }
    det *= a[i][i];
    for (let r = i + 1; r < n; r++) { const f = a[r][i] / a[i][i]; for (let c = i; c < n; c++) a[r][c] -= f * a[i][c]; }
  }
  return det;
}
def('MDETERM', (A, ctx) => { const m = numMatrix(ev(A[0], ctx), ctx); if (isErr(m)) return m; if (m.length !== (m[0] || []).length) return ERR.VALUE; return tame(luDet(m)); });
def('MINVERSE', (A, ctx) => {
  const m = numMatrix(ev(A[0], ctx), ctx); if (isErr(m)) return m;
  const n = m.length; if (n !== (m[0] || []).length) return ERR.VALUE;
  const a = m.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r;
    if (Math.abs(a[p][i]) < 1e-15) return ERR.NUM;
    [a[p], a[i]] = [a[i], a[p]];
    const d = a[i][i]; for (let c = 0; c < 2 * n; c++) a[i][c] /= d;
    for (let r = 0; r < n; r++) if (r !== i) { const f = a[r][i]; if (f) for (let c = 0; c < 2 * n; c++) a[r][c] -= f * a[i][c]; }
  }
  return new Arr(a.map(r => r.slice(n).map(x => tame(x) || 0)));
});
def('MUNIT', (A, ctx) => { const n = Math.trunc(num(argN(A, 0, ctx))); if (isErr(n)) return n; if (n < 1 || n > 1000) return ERR.VALUE; return new Arr(Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)))); });
def('SUMX2MY2 SUMX2PY2 SUMXMY2', (A, ctx, name) => {
  if (A.length !== 2) return ERR.VALUE;
  const a = flatVals(ev(A[0], ctx), ctx), b = flatVals(ev(A[1], ctx), ctx);
  if (a.length !== b.length) return ERR.NA;
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    if (isErr(a[i])) return a[i]; if (isErr(b[i])) return b[i];
    if (typeof a[i] !== 'number' || typeof b[i] !== 'number') continue;
    s += name === 'SUMX2MY2' ? a[i] ** 2 - b[i] ** 2 : name === 'SUMX2PY2' ? a[i] ** 2 + b[i] ** 2 : (a[i] - b[i]) ** 2;
  }
  return tame(s);
});
const AGG_FN = { 1: 'AVERAGE', 2: 'COUNT', 3: 'COUNTA', 4: 'MAX', 5: 'MIN', 6: 'PRODUCT', 7: 'STDEV.S', 8: 'STDEV.P', 9: 'SUM', 10: 'VAR.S', 11: 'VAR.P', 12: 'MEDIAN', 13: 'MODE.SNGL', 14: 'LARGE', 15: 'SMALL', 16: 'PERCENTILE.INC', 17: 'QUARTILE.INC', 18: 'PERCENTILE.EXC', 19: 'QUARTILE.EXC' };
def('AGGREGATE', (A, ctx) => {
  if (A.length < 3) return ERR.VALUE;
  const code = Math.trunc(num(argN(A, 0, ctx))), opt = Math.trunc(num(argN(A, 1, ctx)));
  if (isErr(code) || isErr(opt)) return ERR.VALUE;
  const fn = AGG_FN[code]; if (!fn || opt < 0 || opt > 7) return ERR.VALUE;
  const skipHidden = opt === 1 || opt === 3 || opt === 5 || opt === 7, skipErr = opt === 2 || opt === 3 || opt === 6 || opt === 7, skipNested = opt <= 3;
  const refs = code >= 14 ? [A[2]] : A.slice(2);
  const vals = [];
  for (const a of refs) {
    const v = ev(a, ctx);
    if (v && v.range) {
      for (let r = v.r1; r <= v.r2; r++) {
        if (skipHidden && ctx.rowHidden && ctx.rowHidden(v.sheet, r)) continue;
        for (let c = v.c1; c <= v.c2; c++) {
          const f = skipNested && ctx.formulaOf && ctx.formulaOf(v.sheet, r, c);
          if (f && /\b(SUBTOTAL|AGGREGATE)\(/i.test(f)) continue;
          const x = ctx.get(v.sheet, r, c);
          if (skipErr && isErr(x)) continue;
          vals.push(x);
        }
      }
    } else for (const x of flatVals(v, ctx)) { if (skipErr && isErr(x)) continue; vals.push(x); }
  }
  const arg = { k: 'lit', v: new Arr([vals.length ? vals : [null]]) };
  if (code >= 14) { if (!has(A, 3)) return ERR.VALUE; return F[fn]([arg, A[3]], ctx, fn); }
  return F[fn]([arg], ctx, fn);
});

// text & information
const valueText = (v, strict) => (typeof v === 'string' ? (strict ? '"' + v.replace(/"/g, '""') + '"' : v) : str(v));
def('VALUETOTEXT', (A, ctx) => lift(A, ctx, (v, f) => { const m = f === undefined ? 0 : num(f); if (isErr(m)) return m; if (m !== 0 && m !== 1) return ERR.VALUE; return valueText(v, m === 1); }, { min: 1, max: 2, liftIdx: [0] }));
def('ARRAYTOTEXT', (A, ctx) => {
  const g = grid(ev(A[0], ctx), ctx);
  const m = has(A, 1) ? num(argN(A, 1, ctx)) : 0; if (isErr(m)) return m;
  if (m !== 0 && m !== 1) return ERR.VALUE;
  if (m === 0) return g.flat().map(v => valueText(v, false)).join('; ');
  return '{' + g.map(r => r.map(v => valueText(v, true)).join('.')).join(';') + '}';
});
function userRegex(pat, flags) {
  const p = str(pat);
  if (p.length > 1000) return ERR.VALUE;
  // nested quantifiers like (a+)+ or (\w*)* can take exponential time (files may come from others) → refused
  if (/\((?:[^()\\]|\\.)*[+*}]\)\s*[+*{]/.test(p)) return ERR.VALUE;
  try { return new RegExp(p, flags + 'u'); } catch { try { return new RegExp(p, flags); } catch { return ERR.VALUE; } }
}
def('REGEXTEST', (A, ctx) => lift(A, ctx, (t, p, cs) => {
  if (isErr(t)) return t; const ci = cs === undefined ? 0 : num(cs); if (isErr(ci)) return ci;
  const re = userRegex(p, ci === 1 ? 'i' : ''); if (isErr(re)) return re;
  return re.test(str(t).slice(0, 32767));
}, { min: 2, max: 3 }));
def('REGEXEXTRACT', (A, ctx) => {
  if (A.length < 2 || A.length > 4) return ERR.VALUE;
  const t = argN(A, 0, ctx); if (isErr(t)) return t;
  const mode = has(A, 2) ? Math.trunc(num(argN(A, 2, ctx))) : 0, ci = has(A, 3) ? num(argN(A, 3, ctx)) : 0;
  if (isErr(mode) || mode < 0 || mode > 2) return ERR.VALUE;
  const re = userRegex(argN(A, 1, ctx), (ci === 1 ? 'i' : '') + (mode === 1 ? 'g' : '')); if (isErr(re)) return re;
  const s = str(t).slice(0, 32767);
  if (mode === 1) { const all = [...s.matchAll(re)].map(m => m[0]); return all.length ? (all.length === 1 ? all[0] : new Arr(all.map(x => [x]))) : ERR.NA; }
  const m = re.exec(s);
  if (!m) return ERR.NA;
  if (mode === 2) { const gs = m.slice(1).map(x => x ?? ''); return gs.length ? (gs.length === 1 ? gs[0] : new Arr([gs])) : ERR.NA; }
  return m[0];
});
def('REGEXREPLACE', (A, ctx) => lift(A, ctx, (t, p, rep, occ, cs) => {
  if (isErr(t)) return t;
  const o = occ === undefined ? 0 : Math.trunc(num(occ)), ci = cs === undefined ? 0 : num(cs); const e = firstErr(o, ci); if (e) return e;
  const re = userRegex(p, 'g' + (ci === 1 ? 'i' : '')); if (isErr(re)) return re;
  const s = str(t).slice(0, 32767), r = str(rep);
  if (!o) return s.replace(re, r);
  const all = [...s.matchAll(re)];
  const m = all[o > 0 ? o - 1 : all.length + o];
  if (!m) return s;
  const one = new RegExp(re.source, re.flags.replace('g', ''));
  return s.slice(0, m.index) + m[0].replace(one, r) + s.slice(m.index + m[0].length);
}, { min: 3, max: 5 }));
def('HYPERLINK', (A, ctx) => lift(A, ctx, (url, name) => (isErr(url) ? url : name === undefined || name === null ? str(url) : name), { min: 1, max: 2 }));
def('FORMULATEXT', (A, ctx) => {
  const v = A[0] ? ev(A[0], ctx) : null;
  if (!v || !v.range) return ERR.VALUE;
  const f = ctx.formulaOf && ctx.formulaOf(v.sheet, v.r1, v.c1);
  return f ? '=' + toDisplay(f) : ERR.NA;
});
def('SHEET', (A, ctx) => {
  if (!A.length || A[0].k === 'missing') return ctx.sheet + 1;
  const v = ev(A[0], ctx);
  if (v && v.range) return v.sheet + 1;
  const s = scalar(v, ctx); if (isErr(s)) return s;
  const i = ctx.sheetIndex(str(s)); return i < 0 ? ERR.NA : i + 1;
});
def('SHEETS', (A, ctx) => (A.length && A[0].k !== 'missing' ? (() => { const v = ev(A[0], ctx); return v && v.range ? 1 : ERR.VALUE; })() : ctx.sheetCount ? ctx.sheetCount() : 1));
def('CELL', (A, ctx) => {
  const t = str(argN(A, 0, ctx)).toLowerCase();
  const v = has(A, 1) ? ev(A[1], ctx) : { range: true, sheet: ctx.sheet, r1: ctx.cur ? ctx.cur.r : 0, c1: ctx.cur ? ctx.cur.c : 0, r2: 0, c2: 0 };
  if (!v || !v.range) return ERR.VALUE;
  const x = ctx.get(v.sheet, v.r1, v.c1);
  switch (t) {
    case 'address': case 'adresse': return `$${colName(v.c1)}$${v.r1 + 1}`;
    case 'row': case 'zeile': return v.r1 + 1;
    case 'col': case 'spalte': return v.c1 + 1;
    case 'contents': case 'inhalt': return x ?? 0;
    case 'type': case 'typ': return x === null || x === undefined ? 'b' : typeof x === 'string' ? 'l' : 'v';
    default: return ERR.VALUE;
  }
});

// financial
def('DB', (A, ctx) => {
  const a = fin(A, ctx, 5, [undefined, undefined, undefined, undefined, 12]); if (isErr(a)) return a;
  const [cost, salv, life, per, mon] = a;
  if (cost < 0 || salv < 0 || life <= 0 || per <= 0 || mon < 1 || mon > 12 || per > life + 1) return ERR.NUM;
  const rate = cost === 0 ? 0 : Math.round((1 - Math.pow(salv / cost, 1 / life)) * 1000) / 1000;
  let total = 0, dep = cost * rate * mon / 12;
  if (per === 1) return tame(dep);
  total = dep;
  for (let p = 2; p <= per; p++) { dep = p === life + 1 ? (cost - total) * rate * (12 - mon) / 12 : (cost - total) * rate; if (p < per) total += dep; }
  return tame(dep);
});
def('DDB', (A, ctx) => {
  const a = fin(A, ctx, 5, [undefined, undefined, undefined, undefined, 2]); if (isErr(a)) return a;
  const [cost, salv, life, per, fac] = a;
  if (cost < 0 || salv < 0 || life <= 0 || per <= 0 || per > life || fac <= 0) return ERR.NUM;
  let book = cost, dep = 0;
  for (let p = 1; p <= per; p++) { dep = Math.min(book * fac / life, Math.max(0, book - salv)); book -= dep; }
  return tame(dep);
});
def('SYD', (A, ctx) => { const a = fin(A, ctx, 4, []); if (isErr(a)) return a; const [cost, salv, life, per] = a; if (life <= 0 || per <= 0 || per > life) return ERR.NUM; return tame((cost - salv) * (life - per + 1) * 2 / (life * (life + 1))); });
def('MIRR', (A, ctx) => {
  const xs = flatVals(ev(A[0], ctx), ctx).filter(v => typeof v === 'number');
  const fr = num(argN(A, 1, ctx)), rr = num(argN(A, 2, ctx)); const e = firstErr(fr, rr); if (e) return e;
  const n = xs.length;
  if (!xs.some(v => v > 0) || !xs.some(v => v < 0)) return ERR.DIV0;
  const pvNeg = xs.reduce((s, v, i) => s + (v < 0 ? v / Math.pow(1 + fr, i) : 0), 0);
  const fvPos = xs.reduce((s, v, i) => s + (v > 0 ? v * Math.pow(1 + rr, n - 1 - i) : 0), 0);
  return tame(Math.pow(-fvPos / pvNeg, 1 / (n - 1)) - 1);
});
def('FVSCHEDULE', (A, ctx) => { const p = num(argN(A, 0, ctx)); if (isErr(p)) return p; let v = p; for (const r of flatVals(ev(A[1], ctx), ctx)) { const x = num(r); if (isErr(x)) return ERR.VALUE; v *= 1 + x; } return tame(v); });
def('PDURATION', (A, ctx) => { const a = fin(A, ctx, 3, []); if (isErr(a)) return a; const [r, pv, fv] = a; if (r <= 0 || pv <= 0 || fv <= 0) return ERR.NUM; return tame((Math.log(fv) - Math.log(pv)) / Math.log(1 + r)); });
def('RRI', (A, ctx) => { const a = fin(A, ctx, 3, []); if (isErr(a)) return a; const [n, pv, fv] = a; if (n <= 0 || pv === 0) return ERR.NUM; const r = Math.pow(fv / pv, 1 / n) - 1; return Number.isFinite(r) ? tame(r) : ERR.NUM; });
def('ISPMT', (A, ctx) => { const a = fin(A, ctx, 4, []); if (isErr(a)) return a; const [r, per, n, pv] = a; if (n === 0) return ERR.DIV0; return tame(pv * r * (per / n - 1)); });

// database functions: (database with header row, field = header or 1-based index, criteria range with header row)
def('DSUM DCOUNT DCOUNTA DAVERAGE DMAX DMIN DGET DPRODUCT', (A, ctx, name) => {
  if (A.length !== 3) return ERR.VALUE;
  const db = grid(ev(A[0], ctx), ctx), crit = grid(ev(A[2], ctx), ctx);
  if (db.length < 1 || crit.length < 1) return ERR.VALUE;
  const head = db[0].map(h => str(h).trim().toLocaleLowerCase('de'));
  let fi = -1;
  if (A[1].k !== 'missing') {
    const f = argN(A, 1, ctx);
    if (typeof f === 'number') fi = Math.trunc(f) - 1; else fi = head.indexOf(str(f).trim().toLocaleLowerCase('de'));
    if (fi < 0 || fi >= head.length) return ERR.VALUE;
  } else if (name !== 'DCOUNT' && name !== 'DCOUNTA') return ERR.VALUE;
  const chead = crit[0].map(h => head.indexOf(str(h).trim().toLocaleLowerCase('de')));
  const tests = crit.slice(1).map(row => row.map((v, j) => (v === null || v === '' ? null : { c: chead[j], t: criterion(v) })).filter(Boolean));
  const ok = row => !tests.length || tests.some(conds => conds.every(({ c, t }) => c >= 0 && t(row[c])));
  const picked = db.slice(1).filter(ok).map(r => (fi >= 0 ? r[fi] : 1));
  const nums = picked.filter(v => typeof v === 'number');
  switch (name) {
    case 'DSUM': return tame(nums.reduce((a, b) => a + b, 0));
    case 'DPRODUCT': return nums.length ? tame(nums.reduce((a, b) => a * b, 1)) : 0;
    case 'DCOUNT': return fi >= 0 ? nums.length : picked.length;
    case 'DCOUNTA': return picked.filter(v => v !== null && v !== undefined && v !== '').length;
    case 'DAVERAGE': return nums.length ? tame(nums.reduce((a, b) => a + b, 0) / nums.length) : ERR.DIV0;
    case 'DMAX': return nums.length ? Math.max(...nums) : 0;
    case 'DMIN': return nums.length ? Math.min(...nums) : 0;
    case 'DGET': return picked.length === 1 ? picked[0] ?? 0 : picked.length ? ERR.NUM : ERR.VALUE;
  }
  return ERR.VALUE;
});

function callFn(n, ctx) {
  const fn = F[n.name];
  if (!fn) {
    // LET/LAMBDA variable or a defined name that holds a LAMBDA
    let lam = null;
    if (ctx.locals && n.name in ctx.locals) lam = ctx.locals[n.name];
    else if (ctx.name && ctx.name(n.name) != null) lam = ev({ k: 'name', v: n.name }, ctx);
    if (lam instanceof Lambda) return invokeLambda(lam, n.args.map(a => (a.k === 'missing' ? OMITTED : ev(a, ctx))), ctx);
    return ERR.NAME;
  }
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

// further functions for the catalogue (German name, category, description, example)
FUNCTION_LIST.push(
  ['QUADRATESUMME', 'Mathematik', 'Summe der Quadrate', 'QUADRATESUMME(3;4)'], ['OBERGRENZE.MATHEMATIK', 'Mathematik', 'Auf Vielfaches aufrunden (mit Modus)', 'OBERGRENZE.MATHEMATIK(-4,3;1;1)'],
  ['UNTERGRENZE.MATHEMATIK', 'Mathematik', 'Auf Vielfaches abrunden (mit Modus)', 'UNTERGRENZE.MATHEMATIK(4,7;0,5)'], ['LOG10', 'Mathematik', 'Zehnerlogarithmus', 'LOG10(1000)'],
  ['GERADE', 'Mathematik', 'Auf gerade Zahl aufrunden', 'GERADE(3,2)'], ['UNGERADE', 'Mathematik', 'Auf ungerade Zahl aufrunden', 'UNGERADE(2,1)'],
  ['KOMBINATIONEN', 'Mathematik', 'Anzahl Kombinationen ohne Wiederholung', 'KOMBINATIONEN(49;6)'], ['ZUFALLSMATRIX', 'Mathematik', 'Matrix mit Zufallszahlen (überläuft)', 'ZUFALLSMATRIX(3;2;1;6;WAHR)'],
  ['QUOTIENT', 'Mathematik', 'Ganzzahliger Anteil einer Division', 'QUOTIENT(17;5)'], ['COS', 'Mathematik', 'Kosinus (Bogenmaß)', 'COS(PI())'], ['TAN', 'Mathematik', 'Tangens (Bogenmaß)', 'TAN(PI()/4)'],
  ['ARCSIN', 'Mathematik', 'Arkussinus', 'ARCSIN(1)'], ['ARCCOS', 'Mathematik', 'Arkuskosinus', 'ARCCOS(0)'], ['ARCTAN', 'Mathematik', 'Arkustangens', 'ARCTAN(1)'],
  ['ARCTAN2', 'Mathematik', 'Winkel aus x- und y-Koordinate', 'ARCTAN2(1;1)'], ['SINHYP', 'Mathematik', 'Sinus hyperbolicus', 'SINHYP(1)'], ['COSHYP', 'Mathematik', 'Kosinus hyperbolicus', 'COSHYP(1)'],
  ['TANHYP', 'Mathematik', 'Tangens hyperbolicus', 'TANHYP(0,5)'], ['ARCSINHYP', 'Mathematik', 'Umkehrfunktion des Sinus hyperbolicus', 'ARCSINHYP(1)'],
  ['ARCCOSHYP', 'Mathematik', 'Umkehrfunktion des Kosinus hyperbolicus', 'ARCCOSHYP(2)'], ['ARCTANHYP', 'Mathematik', 'Umkehrfunktion des Tangens hyperbolicus', 'ARCTANHYP(0,5)'],
  ['COT', 'Mathematik', 'Kotangens', 'COT(1)'], ['WURZELPI', 'Mathematik', 'Wurzel aus Zahl mal π', 'WURZELPI(2)'], ['ZWEIFAKULTÄT', 'Mathematik', 'Doppelfakultät', 'ZWEIFAKULTÄT(7)'],
  ['POLYNOMIAL', 'Mathematik', 'Multinomialkoeffizient', 'POLYNOMIAL(2;3;4)'], ['RÖMISCH', 'Mathematik', 'Zahl als römische Zahl', 'RÖMISCH(2026)'], ['ARABISCH', 'Mathematik', 'Römische Zahl in arabische Zahl', 'ARABISCH("MMXXVI")'],
  ['BASIS', 'Mathematik', 'Zahl in andere Basis umwandeln', 'BASIS(255;16)'], ['DEZIMAL', 'Mathematik', 'Text einer Basis in Dezimalzahl', 'DEZIMAL("FF";16)'],
  ['MMULT', 'Mathematik', 'Matrixprodukt (überläuft)', 'MMULT(A1:B2;D1:E2)'], ['MDET', 'Mathematik', 'Determinante einer Matrix', 'MDET(A1:C3)'], ['MINV', 'Mathematik', 'Inverse Matrix (überläuft)', 'MINV(A1:B2)'],
  ['MEINHEIT', 'Mathematik', 'Einheitsmatrix (überläuft)', 'MEINHEIT(3)'], ['SUMMEX2MY2', 'Mathematik', 'Summe der Differenzen der Quadrate', 'SUMMEX2MY2(A1:A5;B1:B5)'],
  ['SUMMEX2PY2', 'Mathematik', 'Summe der Summen der Quadrate', 'SUMMEX2PY2(A1:A5;B1:B5)'], ['SUMMEXMY2', 'Mathematik', 'Summe der quadrierten Differenzen', 'SUMMEXMY2(A1:A5;B1:B5)'],
  ['AGGREGAT', 'Mathematik', 'Teilergebnis, das Fehler und ausgeblendete Zeilen ignorieren kann', 'AGGREGAT(9;6;A1:A10)'],
  ['MITTELWERTA', 'Statistik', 'Durchschnitt (Text = 0, WAHR = 1)', 'MITTELWERTA(A1:A10)'], ['MAXA', 'Statistik', 'Größter Wert inkl. Wahrheitswerte', 'MAXA(A1:A10)'], ['MINA', 'Statistik', 'Kleinster Wert inkl. Wahrheitswerte', 'MINA(A1:A10)'],
  ['MODUS.EINF', 'Statistik', 'Häufigster Wert', 'MODUS.EINF(A1:A10)'], ['STABW', 'Statistik', 'Standardabweichung (Stichprobe, ältere Form)', 'STABW(A1:A10)'], ['STABWN', 'Statistik', 'Standardabweichung (Grundgesamtheit, ältere Form)', 'STABWN(A1:A10)'],
  ['VARIANZ', 'Statistik', 'Varianz (Stichprobe, ältere Form)', 'VARIANZ(A1:A10)'], ['VARIANZEN', 'Statistik', 'Varianz (Grundgesamtheit, ältere Form)', 'VARIANZEN(A1:A10)'], ['VAR.P', 'Statistik', 'Varianz (Grundgesamtheit)', 'VAR.P(A1:A10)'],
  ['RANG', 'Statistik', 'Rang einer Zahl (ältere Form)', 'RANG(A1;A$1:A$10)'], ['RANG.MITTELW', 'Statistik', 'Rang mit Mittelwert bei Gleichstand', 'RANG.MITTELW(A1;A$1:A$10)'],
  ['QUANTIL', 'Statistik', 'Quantil (ältere Form)', 'QUANTIL(A1:A10;0,9)'], ['QUARTILE', 'Statistik', 'Quartil (ältere Form)', 'QUARTILE(A1:A10;1)'], ['GEOMITTEL', 'Statistik', 'Geometrisches Mittel', 'GEOMITTEL(A1:A10)'],
  ['MITTELABW', 'Statistik', 'Mittlere absolute Abweichung', 'MITTELABW(A1:A10)'], ['HÄUFIGKEIT', 'Statistik', 'Werte in Klassen zählen (überläuft)', 'HÄUFIGKEIT(A1:A20;C1:C4)'],
  ['STEIGUNG', 'Statistik', 'Steigung der Regressionsgeraden', 'STEIGUNG(B1:B10;A1:A10)'], ['ACHSENABSCHNITT', 'Statistik', 'Achsenabschnitt der Regressionsgeraden', 'ACHSENABSCHNITT(B1:B10;A1:A10)'],
  ['BESTIMMTHEITSMASS', 'Statistik', 'Bestimmtheitsmaß R²', 'BESTIMMTHEITSMASS(B1:B10;A1:A10)'], ['SCHÄTZER', 'Statistik', 'Linearer Schätzwert (ältere Form)', 'SCHÄTZER(11;B1:B10;A1:A10)'],
  ['PROGNOSE.LINEAR', 'Statistik', 'Linearer Prognosewert', 'PROGNOSE.LINEAR(11;B1:B10;A1:A10)'], ['TREND', 'Statistik', 'Werte entlang eines linearen Trends', 'TREND(B1:B10;A1:A10;A11:A12)'],
  ['QUANTILSRANG', 'Statistik', 'Relativer Rang (ältere Form)', 'QUANTILSRANG(A1:A10;A3)'], ['QUANTILSRANG.INKL', 'Statistik', 'Relativer Rang einer Zahl (0 bis 1)', 'QUANTILSRANG.INKL(A1:A10;A3)'],
  ['QUANTIL.EXKL', 'Statistik', 'Quantil ohne 0 und 1', 'QUANTIL.EXKL(A1:A10;0,25)'], ['QUARTILE.EXKL', 'Statistik', 'Quartil ohne Minimum und Maximum', 'QUARTILE.EXKL(A1:A10;1)'],
  ['GESTUTZTMITTEL', 'Statistik', 'Mittelwert ohne Randwerte', 'GESTUTZTMITTEL(A1:A20;0,1)'], ['HARMITTEL', 'Statistik', 'Harmonisches Mittel', 'HARMITTEL(A1:A10)'],
  ['SUMQUADABW', 'Statistik', 'Summe der quadrierten Abweichungen', 'SUMQUADABW(A1:A10)'], ['KURT', 'Statistik', 'Kurtosis (Wölbung)', 'KURT(A1:A10)'], ['SCHIEFE', 'Statistik', 'Schiefe einer Verteilung', 'SCHIEFE(A1:A10)'],
  ['STANDARDISIERUNG', 'Statistik', 'Standardisierter Wert (z-Wert)', 'STANDARDISIERUNG(A1;50;10)'], ['KOVARIANZ.P', 'Statistik', 'Kovarianz (Grundgesamtheit)', 'KOVARIANZ.P(A1:A10;B1:B10)'],
  ['KOVARIANZ.S', 'Statistik', 'Kovarianz (Stichprobe)', 'KOVARIANZ.S(A1:A10;B1:B10)'], ['PEARSON', 'Statistik', 'Pearsonscher Korrelationskoeffizient', 'PEARSON(A1:A10;B1:B10)'],
  ['NORM.VERT', 'Statistik', 'Normalverteilung', 'NORM.VERT(42;40;1,5;WAHR)'], ['NORM.INV', 'Statistik', 'Quantil der Normalverteilung', 'NORM.INV(0,95;40;1,5)'],
  ['NORM.S.VERT', 'Statistik', 'Standardnormalverteilung', 'NORM.S.VERT(1;WAHR)'], ['NORM.S.INV', 'Statistik', 'Quantil der Standardnormalverteilung', 'NORM.S.INV(0,975)'],
  ['BINOM.VERT', 'Statistik', 'Binomialverteilung', 'BINOM.VERT(6;10;0,5;FALSCH)'], ['POISSON.VERT', 'Statistik', 'Poisson-Verteilung', 'POISSON.VERT(2;5;WAHR)'],
  ['EXPON.VERT', 'Statistik', 'Exponentialverteilung', 'EXPON.VERT(0,2;10;WAHR)'], ['KONFIDENZ.NORM', 'Statistik', 'Konfidenzintervall (Normalverteilung)', 'KONFIDENZ.NORM(0,05;2,5;50)'],
  ['VARIATIONEN', 'Statistik', 'Anzahl Variationen (Reihenfolge zählt)', 'VARIATIONEN(10;3)'], ['ANZAHLEINDEUTIG', 'Statistik', 'Anzahl verschiedener Werte', 'ANZAHLEINDEUTIG(A1:A20)'],
  ['WAHR', 'Logik', 'Wahrheitswert WAHR', 'WAHR()'], ['FALSCH', 'Logik', 'Wahrheitswert FALSCH', 'FALSCH()'],
  ['LAMBDA', 'Logik', 'Eigene Funktion mit Parametern', 'LAMBDA(x;x*2)(A1)'], ['MAP', 'Logik', 'LAMBDA auf jeden Wert anwenden (überläuft)', 'MAP(A1:A5;LAMBDA(x;x*2))'],
  ['REDUCE', 'Logik', 'Werte mit LAMBDA zu einem Ergebnis zusammenfassen', 'REDUCE(0;A1:A5;LAMBDA(s;x;s+x))'], ['SCAN', 'Logik', 'Zwischenergebnisse einer LAMBDA-Berechnung (überläuft)', 'SCAN(0;A1:A5;LAMBDA(s;x;s+x))'],
  ['NACHZEILE', 'Logik', 'LAMBDA je Zeile anwenden (überläuft)', 'NACHZEILE(A1:C5;LAMBDA(z;SUMME(z)))'], ['NACHSPALTE', 'Logik', 'LAMBDA je Spalte anwenden (überläuft)', 'NACHSPALTE(A1:C5;LAMBDA(s;MAX(s)))'],
  ['MATRIXERSTELLEN', 'Logik', 'Matrix aus LAMBDA berechnen (überläuft)', 'MATRIXERSTELLEN(3;3;LAMBDA(z;s;z*s))'], ['ISTAUSGELASSEN', 'Logik', 'Wurde ein LAMBDA-Parameter weggelassen?', 'LAMBDA(a;b;WENN(ISTAUSGELASSEN(b);a;a+b))(1)'],
  ['VERWEIS', 'Nachschlagen & Verweisen', 'Wert in sortierter Liste suchen', 'VERWEIS(A1;D1:D10;E1:E10)'], ['VSTAPELN', 'Nachschlagen & Verweisen', 'Bereiche untereinander anfügen (überläuft)', 'VSTAPELN(A1:B3;D1:E3)'],
  ['HSTAPELN', 'Nachschlagen & Verweisen', 'Bereiche nebeneinander anfügen (überläuft)', 'HSTAPELN(A1:A5;C1:C5)'], ['ÜBERNEHMEN', 'Nachschlagen & Verweisen', 'Erste/letzte Zeilen oder Spalten nehmen (überläuft)', 'ÜBERNEHMEN(A1:C20;5)'],
  ['WEGLASSEN', 'Nachschlagen & Verweisen', 'Zeilen oder Spalten weglassen (überläuft)', 'WEGLASSEN(A1:C20;1)'], ['ZEILENWAHL', 'Nachschlagen & Verweisen', 'Bestimmte Zeilen wählen (überläuft)', 'ZEILENWAHL(A1:C20;1;3)'],
  ['SPALTENWAHL', 'Nachschlagen & Verweisen', 'Bestimmte Spalten wählen (überläuft)', 'SPALTENWAHL(A1:E20;1;3)'], ['ZUSPALTE', 'Nachschlagen & Verweisen', 'Bereich in eine Spalte umwandeln (überläuft)', 'ZUSPALTE(A1:C3)'],
  ['ZUZEILE', 'Nachschlagen & Verweisen', 'Bereich in eine Zeile umwandeln (überläuft)', 'ZUZEILE(A1:C3)'], ['ZEILENUMBRUCH', 'Nachschlagen & Verweisen', 'Liste zeilenweise umbrechen (überläuft)', 'ZEILENUMBRUCH(A1:A12;3)'],
  ['SPALTENUMBRUCH', 'Nachschlagen & Verweisen', 'Liste spaltenweise umbrechen (überläuft)', 'SPALTENUMBRUCH(A1:A12;3)'], ['ERWEITERN', 'Nachschlagen & Verweisen', 'Bereich auf Größe auffüllen (überläuft)', 'ERWEITERN(A1:B2;4;4;"")'],
  ['UNIZEICHEN', 'Text', 'Zeichen aus Unicode-Wert', 'UNIZEICHEN(8364)'], ['UNICODE', 'Text', 'Unicode-Wert des ersten Zeichens', 'UNICODE("€")'], ['ZAHLENWERT', 'Text', 'Text mit Trennzeichen in Zahl', 'ZAHLENWERT("1.234,5";",";".")'],
  ['T', 'Text', 'Text oder leer', 'T(A1)'], ['TEXTTEILEN', 'Text', 'Text an Trennzeichen aufteilen (überläuft)', 'TEXTTEILEN(A1;",")'], ['WERTZUTEXT', 'Text', 'Wert als Text', 'WERTZUTEXT(A1)'],
  ['MATRIXZUTEXT', 'Text', 'Bereich als Text', 'MATRIXZUTEXT(A1:B3)'], ['REGEXTEST', 'Text', 'Passt der Text zu einem Suchmuster (regulärer Ausdruck)?', 'REGEXTEST(A1;"^\\d{5}$")'],
  ['REGEXEXTRAKT', 'Text', 'Teil per regulärem Ausdruck herausziehen', 'REGEXEXTRAKT(A1;"\\d+")'], ['REGEXERSETZEN', 'Text', 'Text per regulärem Ausdruck ersetzen', 'REGEXERSETZEN(A1;"\\s+";" ")'],
  ['HYPERLINK', 'Text', 'Anklickbarer Link', 'HYPERLINK("https://example.org";"Webseite")'],
  ['NETTOARBEITSTAGE.INTL', 'Datum & Uhrzeit', 'Arbeitstage mit eigenem Wochenende', 'NETTOARBEITSTAGE.INTL(A1;B1;11)'], ['ARBEITSTAG.INTL', 'Datum & Uhrzeit', 'Datum nach Arbeitstagen mit eigenem Wochenende', 'ARBEITSTAG.INTL(A1;10;11)'],
  ['ZEITWERT', 'Datum & Uhrzeit', 'Text in Uhrzeit umwandeln', 'ZEITWERT("14:30")'], ['TAGE360', 'Datum & Uhrzeit', 'Tage auf Basis von 360 Tagen', 'TAGE360(A1;B1)'],
  ['ISTKTEXT', 'Information', 'Ist kein Text?', 'ISTKTEXT(A1)'], ['ISTFEHL', 'Information', 'Fehler außer #NV?', 'ISTFEHL(A1)'], ['ISTLOG', 'Information', 'Ist ein Wahrheitswert?', 'ISTLOG(A1)'],
  ['ISTUNGERADE', 'Information', 'Ungerade Zahl?', 'ISTUNGERADE(A1)'], ['ISTBEZUG', 'Information', 'Ist ein Bezug?', 'ISTBEZUG(A1)'], ['FEHLER.TYP', 'Information', 'Nummer eines Fehlerwerts', 'FEHLER.TYP(A1)'],
  ['N', 'Information', 'Wert als Zahl', 'N(A1)'], ['FORMELTEXT', 'Information', 'Formel einer Zelle als Text', 'FORMELTEXT(A1)'], ['BLATT', 'Information', 'Nummer des Tabellenblatts', 'BLATT()'],
  ['BLÄTTER', 'Information', 'Anzahl der Tabellenblätter', 'BLÄTTER()'], ['ZELLE', 'Information', 'Angaben zu einer Zelle', 'ZELLE("adresse";A1)'],
  ['NOMINAL', 'Finanzmathematik', 'Nominalzins aus Effektivzins', 'NOMINAL(5%;12)'], ['KUMZINSZ', 'Finanzmathematik', 'Summe der Zinsen über Perioden', 'KUMZINSZ(5%/12;60;20000;1;12;0)'],
  ['KUMKAPITAL', 'Finanzmathematik', 'Summe der Tilgung über Perioden', 'KUMKAPITAL(5%/12;60;20000;1;12;0)'], ['GDA2', 'Finanzmathematik', 'Geometrisch-degressive Abschreibung', 'GDA2(10000;1000;5;1)'],
  ['GDA', 'Finanzmathematik', 'Doppelt degressive Abschreibung', 'GDA(10000;1000;5;1)'], ['DIA', 'Finanzmathematik', 'Arithmetisch-degressive Abschreibung', 'DIA(10000;1000;5;1)'],
  ['QIKV', 'Finanzmathematik', 'Modifizierter interner Zinsfuß', 'QIKV(B1:B6;5%;8%)'], ['ZW2', 'Finanzmathematik', 'Endwert mit wechselnden Zinsen', 'ZW2(1000;{0,02.0,03.0,025})'],
  ['PDURATION', 'Finanzmathematik', 'Perioden bis zum Zielwert', 'PDURATION(5%;1000;2000)'], ['ZSATZINVEST', 'Finanzmathematik', 'Effektiver Zins für Wertzuwachs', 'ZSATZINVEST(10;1000;2000)'],
  ['ISPMT', 'Finanzmathematik', 'Zinsen bei gleichen Tilgungsraten', 'ISPMT(5%/12;1;60;20000)'],
  ['DBSUMME', 'Datenbank', 'Summe der Datensätze, die Kriterien erfüllen', 'DBSUMME(A1:E50;"Betrag";G1:H2)'], ['DBANZAHL', 'Datenbank', 'Anzahl Zahlen der passenden Datensätze', 'DBANZAHL(A1:E50;"Betrag";G1:H2)'],
  ['DBANZAHL2', 'Datenbank', 'Anzahl nicht leerer Werte der passenden Datensätze', 'DBANZAHL2(A1:E50;"Name";G1:H2)'], ['DBMITTELWERT', 'Datenbank', 'Mittelwert der passenden Datensätze', 'DBMITTELWERT(A1:E50;"Betrag";G1:H2)'],
  ['DBMAX', 'Datenbank', 'Größter Wert der passenden Datensätze', 'DBMAX(A1:E50;"Betrag";G1:H2)'], ['DBMIN', 'Datenbank', 'Kleinster Wert der passenden Datensätze', 'DBMIN(A1:E50;"Betrag";G1:H2)'],
  ['DBAUSZUG', 'Datenbank', 'Genau einen passenden Wert holen', 'DBAUSZUG(A1:E50;"Betrag";G1:H2)'], ['DBPRODUKT', 'Datenbank', 'Produkt der passenden Datensätze', 'DBPRODUKT(A1:E50;"Faktor";G1:H2)'],
  ['DEZINBIN', 'Technisch', 'Dezimalzahl in Binärzahl', 'DEZINBIN(9;8)'], ['BININDEZ', 'Technisch', 'Binärzahl in Dezimalzahl', 'BININDEZ("1001")'], ['DEZINHEX', 'Technisch', 'Dezimalzahl in Hexadezimalzahl', 'DEZINHEX(255)'],
  ['HEXINDEZ', 'Technisch', 'Hexadezimalzahl in Dezimalzahl', 'HEXINDEZ("FF")'], ['DEZINOKT', 'Technisch', 'Dezimalzahl in Oktalzahl', 'DEZINOKT(58)'], ['OKTINDEZ', 'Technisch', 'Oktalzahl in Dezimalzahl', 'OKTINDEZ("72")'],
);
FN_CATEGORIES.push('Datenbank', 'Technisch');

// argument names per function (German, "; " separated, optional arguments in [ ])
const ARGS_SRC = {
  'Zahl1; [Zahl2]; …': 'SUM PRODUCT SUMSQ AVERAGE AVERAGEA MIN MAX MINA MAXA MEDIAN MODE MODE.SNGL STDEV STDEV.S STDEVP STDEV.P VAR VAR.S VARP VAR.P GEOMEAN AVEDEV HARMEAN DEVSQ KURT SKEW GCD LCM MULTINOMIAL',
  'Wert1; [Wert2]; …': 'COUNT COUNTA COUNTBLANK COUNTUNIQUE CONCAT',
  'Zahl': 'ABS SIGN INT SQRT EXP LN LOG10 SIN COS TAN ASIN ACOS ATAN DEGREES RADIANS EVEN ODD FACT SINH COSH TANH ASINH ACOSH ATANH COT SQRTPI FACTDOUBLE ISEVEN ISODD',
  'Zahl; [Basis]': 'LOG', 'Zahl; Anzahl_Stellen': 'ROUND ROUNDUP ROUNDDOWN', 'Zahl; [Anzahl_Stellen]': 'TRUNC', 'Zahl; Vielfaches': 'MROUND',
  'Zahl; [Schritt]': 'CEILING FLOOR', 'Zahl; [Schritt]; [Modus]': 'CEILING.MATH FLOOR.MATH', 'Dividend; Divisor': 'MOD QUOTIENT', 'Basis; Exponent': 'POWER',
  'n; k': 'COMBIN PERMUT', 'Untere_Zahl; Obere_Zahl': 'RANDBETWEEN', '[Zeilen]; [Spalten]; [Min]; [Max]; [Ganze_Zahl]': 'RANDARRAY', 'x; y': 'ATAN2',
  'Funktion; Bezug1; [Bezug2]; …': 'SUBTOTAL', 'Funktion; Optionen; Bezug1; [Bezug2]; …': 'AGGREGATE',
  'Bereich; Kriterium; [Summe_Bereich]': 'SUMIF', 'Bereich; Kriterium; [Mittelwert_Bereich]': 'AVERAGEIF', 'Bereich; Kriterium': 'COUNTIF',
  'Summe_Bereich; Kriterien_Bereich1; Kriterium1; …': 'SUMIFS', 'Kriterien_Bereich1; Kriterium1; …': 'COUNTIFS',
  'Mittelwert_Bereich; Kriterien_Bereich1; Kriterium1; …': 'AVERAGEIFS', 'Max_Bereich; Kriterien_Bereich1; Kriterium1; …': 'MAXIFS', 'Min_Bereich; Kriterien_Bereich1; Kriterium1; …': 'MINIFS',
  'Matrix1; [Matrix2]; …': 'SUMPRODUCT', 'Matrix; k': 'LARGE SMALL', 'Zahl; Bezug; [Reihenfolge]': 'RANK RANK.EQ RANK.AVG', 'Matrix; k ': 'PERCENTILE PERCENTILE.INC PERCENTILE.EXC',
  'Matrix; Quartil': 'QUARTILE QUARTILE.INC QUARTILE.EXC', 'Matrix1; Matrix2': 'CORREL PEARSON COVARIANCE.P COVARIANCE.S MMULT SUMX2MY2 SUMX2PY2 SUMXMY2',
  'Daten; Klassen': 'FREQUENCY', 'Y_Werte; X_Werte': 'SLOPE INTERCEPT RSQ', 'x; Y_Werte; X_Werte': 'FORECAST FORECAST.LINEAR', 'Y_Werte; [X_Werte]; [Neue_X_Werte]; [Konstante]': 'TREND',
  'Matrix; x; [Genauigkeit]': 'PERCENTRANK PERCENTRANK.INC', 'Matrix; Prozent': 'TRIMMEAN', 'x; Mittelwert; Standardabweichung': 'STANDARDIZE',
  'x; Mittelwert; Standardabweichung; Kumuliert': 'NORM.DIST', 'Wahrscheinlichkeit; Mittelwert; Standardabweichung': 'NORM.INV', 'z; [Kumuliert]': 'NORM.S.DIST', 'Wahrscheinlichkeit': 'NORM.S.INV',
  'Erfolge; Versuche; Erfolgswahrscheinlichkeit; Kumuliert': 'BINOM.DIST', 'x; Mittelwert; Kumuliert': 'POISSON.DIST', 'x; Lambda; Kumuliert': 'EXPON.DIST', 'Alpha; Standardabweichung; Umfang': 'CONFIDENCE.NORM',
  'Prüfung; [Dann_Wert]; [Sonst_Wert]': 'IF', 'Prüfung1; Wert1; [Prüfung2; Wert2]; …': 'IFS', 'Wert; Wert_falls_Fehler': 'IFERROR', 'Wert; Wert_falls_NV': 'IFNA',
  'Wahrheitswert1; [Wahrheitswert2]; …': 'AND OR XOR', 'Wahrheitswert': 'NOT', '': 'TRUE FALSE PI RAND TODAY NOW NA SHEETS',
  'Ausdruck; Wert1; Ergebnis1; …; [Standard]': 'SWITCH', 'Name1; Wert1; …; Berechnung': 'LET', '[Parameter1]; …; Berechnung': 'LAMBDA',
  'Matrix1; …; LAMBDA(Wert1; …)': 'MAP', 'Startwert; Matrix; LAMBDA(Akku; Wert)': 'REDUCE SCAN', 'Matrix; LAMBDA(Zeile)': 'BYROW', 'Matrix; LAMBDA(Spalte)': 'BYCOL',
  'Zeilen; Spalten; LAMBDA(Zeile; Spalte)': 'MAKEARRAY', 'Parameter': 'ISOMITTED',
  'Suchkriterium; Matrix; Spaltenindex; [Bereich_Verweis]': 'VLOOKUP', 'Suchkriterium; Matrix; Zeilenindex; [Bereich_Verweis]': 'HLOOKUP',
  'Suchkriterium; Suchmatrix; Rückgabematrix; [Wenn_nicht_gefunden]; [Vergleichsmodus]; [Suchmodus]': 'XLOOKUP', 'Suchkriterium; Suchmatrix; [Vergleichstyp]': 'MATCH',
  'Suchkriterium; Suchmatrix; [Vergleichsmodus]; [Suchmodus]': 'XMATCH', 'Matrix; Zeile; [Spalte]': 'INDEX', 'Index; Wert1; [Wert2]; …': 'CHOOSE', '[Bezug]': 'ROW COLUMN SHEET',
  'Matrix': 'ROWS COLUMNS TRANSPOSE MDETERM MINVERSE', 'Bezug; Zeilen; Spalten; [Höhe]; [Breite]': 'OFFSET', 'Bezug_Text; [A1]': 'INDIRECT',
  'Zeile; Spalte; [Abs]; [A1]; [Tabellenname]': 'ADDRESS', 'Suchkriterium; Suchvektor; [Ergebnisvektor]': 'LOOKUP', 'Matrix; Einschließen; [Wenn_leer]': 'FILTER',
  'Matrix; [Sortierindex]; [Sortierreihenfolge]; [Nach_Spalte]': 'SORT', 'Matrix; Nach_Matrix1; [Reihenfolge1]; …': 'SORTBY', 'Matrix; [Nach_Spalte]; [Genau_einmal]': 'UNIQUE',
  'Zeilen; [Spalten]; [Anfang]; [Schritt]': 'SEQUENCE', 'Matrix1; [Matrix2]; … ': 'VSTACK HSTACK', 'Matrix; [Zeilen]; [Spalten]': 'TAKE DROP', 'Matrix; Zeile1; [Zeile2]; …': 'CHOOSEROWS',
  'Matrix; Spalte1; [Spalte2]; …': 'CHOOSECOLS', 'Matrix; [Ignorieren]; [Nach_Spalte]': 'TOCOL TOROW', 'Vektor; Anzahl; [Auffüllen_mit]': 'WRAPROWS WRAPCOLS',
  'Matrix; Zeilen; [Spalten]; [Auffüllen_mit]': 'EXPAND', 'Text1; [Text2]; …': 'CONCATENATE', 'Trennzeichen; Leere_ignorieren; Text1; [Text2]; …': 'TEXTJOIN',
  'Text; [Anzahl_Zeichen]': 'LEFT RIGHT', 'Text; Erstes_Zeichen; Anzahl_Zeichen': 'MID', 'Text': 'LEN UPPER LOWER PROPER TRIM CLEAN VALUE CODE UNICODE T ARABIC DATEVALUE TIMEVALUE',
  'Suchtext; Text; [Erstes_Zeichen]': 'FIND SEARCH', 'Alter_Text; Erstes_Zeichen; Anzahl_Zeichen; Neuer_Text': 'REPLACE', 'Text; Alter_Text; Neuer_Text; [ntes_Auftreten]': 'SUBSTITUTE',
  'Wert; Textformat': 'TEXT', 'Text; [Dezimaltrennzeichen]; [Gruppentrennzeichen]': 'NUMBERVALUE', 'Text; Multiplikator': 'REPT', 'Text1; Text2': 'EXACT',
  'Zahl ': 'CHAR UNICHAR ROMAN', 'Zahl; [Dezimalstellen]; [Keine_Punkte]': 'FIXED', 'Wert': 'N ISBLANK ISNUMBER ISTEXT ISNONTEXT ISERROR ISERR ISNA ISLOGICAL ISREF ERROR.TYPE TYPE',
  'Text; Trennzeichen; [Instanz]; [Vergleichsmodus]; [Bei_Ende]; [Wenn_nicht_gefunden]': 'TEXTBEFORE TEXTAFTER',
  'Text; Spaltentrenner; [Zeilentrenner]; [Leere_ignorieren]; [Vergleichsmodus]; [Auffüllen_mit]': 'TEXTSPLIT', 'Wert; [Format]': 'VALUETOTEXT', 'Matrix; [Format]': 'ARRAYTOTEXT',
  'Text; Muster; [Groß_klein]': 'REGEXTEST', 'Text; Muster; [Rückgabemodus]; [Groß_klein]': 'REGEXEXTRACT', 'Text; Muster; Ersetzung; [Vorkommen]; [Groß_klein]': 'REGEXREPLACE',
  'Adresse; [Anzeigename]': 'HYPERLINK', 'Bezug': 'FORMULATEXT ISFORMULA', 'Infotyp; [Bezug]': 'CELL', 'Zahl; Basis; [Mindestlänge]': 'BASE', 'Text; Basis': 'DECIMAL',
  'Zahl; [Stellen]': 'DEC2BIN DEC2HEX DEC2OCT', 'Zahl  ': 'BIN2DEC HEX2DEC OCT2DEC', 'Größe': 'MUNIT',
  'Jahr; Monat; Tag': 'DATE', 'Stunde; Minute; Sekunde': 'TIME', 'Zahl   ': 'YEAR MONTH DAY HOUR MINUTE SECOND ISOWEEKNUM', 'Zahl; [Typ]': 'WEEKDAY WEEKNUM',
  'Ausgangsdatum; Monate': 'EDATE EOMONTH', 'Ausgangsdatum; Enddatum; [Freie_Tage]': 'NETWORKDAYS', 'Ausgangsdatum; Enddatum; [Wochenende]; [Freie_Tage]': 'NETWORKDAYS.INTL',
  'Ausgangsdatum; Tage; [Freie_Tage]': 'WORKDAY', 'Ausgangsdatum; Tage; [Wochenende]; [Freie_Tage]': 'WORKDAY.INTL', 'Ausgangsdatum; Enddatum; Einheit': 'DATEDIF',
  'Enddatum; Ausgangsdatum': 'DAYS', 'Ausgangsdatum; Enddatum; [Methode]': 'DAYS360', 'Ausgangsdatum; Enddatum; [Basis]': 'YEARFRAC',
  'Zins; Zzr; Bw; [Zw]; [F]': 'PMT', 'Zins; Zzr; Rmz; [Bw]; [F]': 'FV', 'Zins; Zzr; Rmz; [Zw]; [F]': 'PV', 'Zzr; Rmz; Bw; [Zw]; [F]; [Schätzwert]': 'RATE', 'Zins; Rmz; Bw; [Zw]; [F]': 'NPER',
  'Zins; Wert1; [Wert2]; …': 'NPV', 'Werte; [Schätzwert]': 'IRR', 'Zins; Zr; Zzr; Bw; [Zw]; [F]': 'IPMT PPMT', 'Nominalzins; Perioden': 'EFFECT', 'Effektivzins; Perioden': 'NOMINAL',
  'Ansch_Wert; Restwert; Nutzungsdauer': 'SLN', 'Zins; Werte; Zeitpunkte': 'XNPV', 'Werte; Zeitpunkte; [Schätzwert]': 'XIRR', 'Zins; Zzr; Bw; Zeitraum_Anfang; Zeitraum_Ende; F': 'CUMIPMT CUMPRINC',
  'Ansch_Wert; Restwert; Nutzungsdauer; Periode; [Monate]': 'DB', 'Ansch_Wert; Restwert; Nutzungsdauer; Periode; [Faktor]': 'DDB', 'Ansch_Wert; Restwert; Nutzungsdauer; Periode': 'SYD',
  'Werte; Investition; Reinvestition': 'MIRR', 'Kapital; Zinsen': 'FVSCHEDULE', 'Zins; Bw; Zw': 'PDURATION', 'Zzr; Bw; Zw': 'RRI', 'Zins; Zr; Zzr; Bw': 'ISPMT',
  'Datenbank; Datenbankfeld; Suchkriterien': 'DSUM DCOUNT DCOUNTA DAVERAGE DMAX DMIN DGET DPRODUCT',
};
/** Argument help per function (canonical English name → German argument list, "; " separated). */
export const FN_ARGS = {};
for (const [args, names] of Object.entries(ARGS_SRC)) for (const n of names.split(' ')) FN_ARGS[n] = args.trim();

export { fmtGeneralDe };
