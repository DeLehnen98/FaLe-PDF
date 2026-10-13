// Formula engine: tokenizer (German + English syntax), parser, evaluator, reference shifting.
// Canonical storage form = English function names, "," as argument separator, "." as decimal point (like .xlsx).

export class FErr {
  constructor(code) { this.code = code; }
  toString() { return this.code; }
}
export const ERR = {
  DIV0: new FErr('#DIV/0!'), VALUE: new FErr('#VALUE!'), REF: new FErr('#REF!'), NAME: new FErr('#NAME?'),
  NUM: new FErr('#NUM!'), NA: new FErr('#N/A'), NULL: new FErr('#NULL!'), CIRC: new FErr('#CIRC!'),
};
const ERR_BY_CODE = Object.fromEntries(Object.values(ERR).map(e => [e.code, e]));
export const ERR_DE = { '#DIV/0!': '#DIV/0!', '#VALUE!': '#WERT!', '#REF!': '#BEZUG!', '#NAME?': '#NAME?', '#NUM!': '#ZAHL!', '#N/A': '#NV', '#NULL!': '#NULL!', '#CIRC!': '#ZIRKEL!' };
const ERR_FROM_DE = Object.fromEntries(Object.entries(ERR_DE).map(([k, v]) => [v, k]));
export const isErr = v => v instanceof FErr;
export function errFromCode(code) { return ERR_BY_CODE[code] || ERR_BY_CODE[ERR_FROM_DE[code]] || new FErr(code); }

// ---------------- function names ----------------
const DE_EN = {
  SUMME: 'SUM', MITTELWERT: 'AVERAGE', ANZAHL: 'COUNT', ANZAHL2: 'COUNTA', ANZAHLLEEREZELLEN: 'COUNTBLANK', WENN: 'IF', WENNFEHLER: 'IFERROR',
  UND: 'AND', ODER: 'OR', NICHT: 'NOT', RUNDEN: 'ROUND', AUFRUNDEN: 'ROUNDUP', ABRUNDEN: 'ROUNDDOWN', GANZZAHL: 'INT', REST: 'MOD',
  POTENZ: 'POWER', WURZEL: 'SQRT', PRODUKT: 'PRODUCT', VORZEICHEN: 'SIGN', SVERWEIS: 'VLOOKUP', WVERWEIS: 'HLOOKUP', VERGLEICH: 'MATCH',
  HEUTE: 'TODAY', JETZT: 'NOW', DATUM: 'DATE', JAHR: 'YEAR', MONAT: 'MONTH', TAG: 'DAY', WOCHENTAG: 'WEEKDAY', VERKETTEN: 'CONCATENATE',
  TEXTKETTE: 'CONCAT', LÄNGE: 'LEN', LAENGE: 'LEN', GROSS: 'UPPER', KLEIN: 'LOWER', GROSS2: 'PROPER', GLÄTTEN: 'TRIM', GLAETTEN: 'TRIM',
  LINKS: 'LEFT', RECHTS: 'RIGHT', TEIL: 'MID', WERT: 'VALUE', ISTLEER: 'ISBLANK', ISTZAHL: 'ISNUMBER', ISTTEXT: 'ISTEXT',
  SUMMEWENN: 'SUMIF', ZÄHLENWENN: 'COUNTIF', ZAEHLENWENN: 'COUNTIF', MITTELWERTWENN: 'AVERAGEIF', SUMMEWENNS: 'SUMIFS', ZÄHLENWENNS: 'COUNTIFS', ZAEHLENWENNS: 'COUNTIFS',
  ZUFALLSZAHL: 'RAND', WAHR: 'TRUE', FALSCH: 'FALSE',
};
const EN_DE = {};
for (const [de, en] of Object.entries(DE_EN)) if (!EN_DE[en] && !/AE|OE|UE/.test(de)) EN_DE[en] = de;

export const FUNCTION_LIST = [
  ['SUMME', 'Summe der Werte', 'SUMME(A1:A10)'], ['MITTELWERT', 'Durchschnitt', 'MITTELWERT(A1:A10)'], ['MIN', 'Kleinster Wert', 'MIN(A1:A10)'],
  ['MAX', 'Größter Wert', 'MAX(A1:A10)'], ['ANZAHL', 'Anzahl der Zahlen', 'ANZAHL(A1:A10)'], ['ANZAHL2', 'Anzahl nicht leerer Zellen', 'ANZAHL2(A1:A10)'],
  ['WENN', 'Bedingung prüfen', 'WENN(A1>0;"ja";"nein")'], ['RUNDEN', 'Runden', 'RUNDEN(A1;2)'], ['SVERWEIS', 'Wert in Tabelle suchen', 'SVERWEIS(A1;D1:E10;2;FALSCH)'],
  ['HEUTE', 'Heutiges Datum', 'HEUTE()'], ['VERKETTEN', 'Texte verbinden', 'VERKETTEN(A1;" ";B1)'], ['ABS', 'Betrag', 'ABS(A1)'],
  ['SUMMEWENN', 'Summe mit Bedingung', 'SUMMEWENN(A1:A10;">0")'], ['ZÄHLENWENN', 'Zählen mit Bedingung', 'ZÄHLENWENN(A1:A10;"ja")'],
  ['WENNFEHLER', 'Fehler abfangen', 'WENNFEHLER(A1/B1;0)'], ['UND', 'Alle Bedingungen wahr', 'UND(A1>0;B1>0)'], ['ODER', 'Eine Bedingung wahr', 'ODER(A1>0;B1>0)'],
  ['PRODUKT', 'Produkt', 'PRODUKT(A1:A3)'], ['MEDIAN', 'Median', 'MEDIAN(A1:A10)'], ['DATUM', 'Datum bilden', 'DATUM(2026;1;31)'],
  ['LINKS', 'Zeichen von links', 'LINKS(A1;3)'], ['LÄNGE', 'Textlänge', 'LÄNGE(A1)'], ['GROSS', 'In Großbuchstaben', 'GROSS(A1)'],
];

export function canonicalFn(name) {
  const up = name.toUpperCase().replace(/^_XLFN\.|^_XLWS\./, '');
  return DE_EN[up] || up;
}

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
function quoteSheet(name) {
  return /^[A-Za-z_\u00C0-\u024F][\w\u00C0-\u024F.]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

// ---------------- tokenizer ----------------
// token: {t: 'num'|'str'|'bool'|'err'|'ref'|'range'|'fn'|'op'|'(' |')'|'sep'|'ws', v, raw}
const RE_REF = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![\w(])/;
const RE_COL = /^(\$?)([A-Za-z]{1,3})(?![\w(\d])/;

export function tokenize(src, locale = 'en') {
  const sep = locale === 'de' ? ';' : ',';
  const dec = locale === 'de' ? ',' : '.';
  const out = [];
  let i = 0;
  const s = src;
  const readSheetPrefix = () => {
    // 'Name'! or Name!
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
    const rest = s.slice(i);
    let m = RE_REF.exec(rest);
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
      const m = /^#(DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|NULL!|WERT!|BEZUG!|ZAHL!|NV)/i.exec(s.slice(i));
      if (m) { out.push({ t: 'err', v: errFromCode(m[0].toUpperCase()) }); i += m[0].length; continue; }
    }
    // number
    const numRe = locale === 'de' ? /^(\d+(?:,\d*)?|,\d+)(?:[eE][+-]?\d+)?/ : /^(\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
    const nm = numRe.exec(s.slice(i));
    if (nm && !/^\d+:\d/.test(s.slice(i)) && !/^\d+[A-Za-z]/.test(s.slice(i).replace(/[eE][+-]?\d+/, ''))) {
      out.push({ t: 'num', v: parseFloat(nm[0].replace(dec, '.')) }); i += nm[0].length; continue;
    }
    if (ch === '(') { out.push({ t: '(' }); i++; continue; }
    if (ch === ')') { out.push({ t: ')' }); i++; continue; }
    if (ch === sep) { out.push({ t: 'sep' }); i++; continue; }
    if (locale === 'de' && ch === '.' && false) { i++; continue; }
    const two = s.slice(i, i + 2);
    if (['<=', '>=', '<>'].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/^&=<>%'.includes(ch)) { out.push({ t: 'op', v: ch }); i++; continue; }
    // reference (with optional sheet)
    const start = i;
    const sheet = readSheetPrefix();
    let ref = readRefAt();
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
    if (sheet != null) { i = start; }
    const im = /^[A-Za-z_\u00C0-\u024F][\w.\u00C0-\u024F]*/.exec(s.slice(i));
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
function refText(a, sheet) {
  if (a.colOnly) return (a.absC ? '$' : '') + colName(a.c);
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
      case 'ref': return (t.sheet != null ? quoteSheet(t.sheet) + '!' : '') + refText(t.a);
      case 'range': return (t.sheet != null ? quoteSheet(t.sheet) + '!' : '') + refText(t.a) + ':' + refText(t.b);
      case 'refErr': return locale === 'de' ? '#BEZUG!' : '#REF!';
      case 'fn': {
        if (locale === 'de') return EN_DE[t.v] || t.v;
        return xlsx && t.v === 'CONCAT' ? '_xlfn.CONCAT' : t.v;
      }
      case 'sep': return sep;
      case 'name': return t.v;
      case '(': case ')': return t.t;
      default: return t.v;
    }
  }).join('');
}

/** User input (without "=") → canonical. Throws SyntaxError on invalid input. */
export function toCanonical(input) {
  const tryLoc = loc => { const t = tokenize(input, loc); parse(t); return serialize(t, 'en'); };
  const preferDe = input.includes(';') || /\d,\d/.test(input.replace(/"[^"]*"/g, ''));
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
  try { return serialize(tokenize(canonical, 'en'), 'en', { xlsx: true }); } catch { return canonical; }
}

/** Shift references; fn(ref, sheetName) → ref | null (= #REF!). Applies to both ends of ranges. */
export function shiftRefs(canonical, fn) {
  let tokens;
  try { tokens = tokenize(canonical, 'en'); } catch { return canonical; }
  const out = tokens.map(t => {
    if (t.t === 'ref') { const a = fn(t.a, t.sheet, false); return a ? { ...t, a } : { t: 'refErr' }; }
    if (t.t === 'range') {
      const a = fn(t.a, t.sheet, 'start'), b = fn(t.b, t.sheet, 'end');
      if (!a || !b || (!a.colOnly && b.r < a.r) || b.c < a.c) return { t: 'refErr' };
      return { ...t, a, b };
    }
    return t;
  });
  return serialize(out, 'en');
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
    return pct();
  }
  function pct() {
    let a = primary();
    while (isOp(peek(), '%')) { next(); a = { k: 'pct', a }; }
    return a;
  }
  function primary() {
    const t = next();
    if (!t) throw new SyntaxError('Formel unvollständig');
    switch (t.t) {
      case 'num': return { k: 'lit', v: t.v };
      case 'str': return { k: 'lit', v: t.v };
      case 'bool': return { k: 'lit', v: t.v };
      case 'err': return { k: 'lit', v: t.v };
      case 'ref': return { k: 'ref', sheet: t.sheet, r: t.a.r, c: t.a.c };
      case 'range': return { k: 'range', sheet: t.sheet, r1: Math.min(t.a.r, t.b.r), c1: Math.min(t.a.c, t.b.c), r2: Math.max(t.a.r, t.b.r), c2: Math.max(t.a.c, t.b.c) };
      case 'name': return { k: 'name', v: t.v };
      case '(': { const e = cmp(); expect(')'); return e; }
      case 'fn': {
        expect('(');
        const args = [];
        if (peek() && peek().t === ')') { next(); return { k: 'fn', name: t.v, args }; }
        for (;;) {
          if (peek() && (peek().t === 'sep' || peek().t === ')')) args.push({ k: 'lit', v: null });
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

// ---------------- evaluation ----------------
// ctx: { sheet: idx, get(sheetIdx, r, c) → value, sheetIndex(name) → idx (-1), bound(sheetIdx) → {maxR, maxC}, fmt(v, code) }
export function evaluate(ast, ctx) {
  const v = ev(ast, ctx);
  if (v && v.range) return v.r1 === v.r2 && v.c1 === v.c2 ? ctx.get(v.sheet, v.r1, v.c1) : implicitIntersect(v, ctx);
  return v === undefined ? null : v;
}

function implicitIntersect(rg, ctx) {
  return ctx.get(rg.sheet, rg.r1, rg.c1);
}

function sheetOf(name, ctx) {
  if (name == null) return ctx.sheet;
  const i = ctx.sheetIndex(name);
  return i;
}

function ev(n, ctx) {
  switch (n.k) {
    case 'lit': return n.v;
    case 'ref': {
      const s = sheetOf(n.sheet, ctx);
      if (s < 0) return ERR.REF;
      return ctx.get(s, n.r, n.c);
    }
    case 'range': {
      const s = sheetOf(n.sheet, ctx);
      if (s < 0) return ERR.REF;
      const b = ctx.bound(s);
      return { range: true, sheet: s, r1: n.r1, c1: n.c1, r2: Math.min(n.r2, Math.max(n.r1, b.maxR)), c2: Math.min(n.c2, Math.max(n.c1, b.maxC)) };
    }
    case 'name': return ERR.NAME;
    case 'neg': { const v = num(scalar(ev(n.a, ctx), ctx)); return isErr(v) ? v : -v; }
    case 'pct': { const v = num(scalar(ev(n.a, ctx), ctx)); return isErr(v) ? v : v / 100; }
    case 'bin': return binop(n.op, scalar(ev(n.a, ctx), ctx), scalar(ev(n.b, ctx), ctx), ctx);
    case 'fn': return callFn(n, ctx);
  }
  return ERR.VALUE;
}

function scalar(v, ctx) {
  if (v && v.range) return v.r1 === v.r2 && v.c1 === v.c2 ? ctx.get(v.sheet, v.r1, v.c1) : ctx.get(v.sheet, v.r1, v.c1);
  return v;
}

export function parseNumberText(s) {
  const t = String(s).trim().replace(/\s|€/g, '');
  if (!t) return null;
  if (/^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return parseFloat(t.replace(/\./g, '').replace(',', '.'));
  if (/^[-+]?\d+,\d+$/.test(t)) return parseFloat(t.replace(',', '.'));
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return parseFloat(t);
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return parseFloat(t.replace(/,/g, ''));
  return null;
}

function num(v) {
  if (isErr(v)) return v;
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = parseNumberText(v);
  return n === null ? ERR.VALUE : n;
}
function str(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'WAHR' : 'FALSCH';
  if (typeof v === 'number') return fmtGeneral(v);
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
  if (v === null || v === '') return false;
  if (typeof v === 'number') return v !== 0;
  const u = String(v).toUpperCase();
  if (u === 'TRUE' || u === 'WAHR') return true;
  if (u === 'FALSE' || u === 'FALSCH') return false;
  return ERR.VALUE;
}

function typeRank(v) { return typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : 0; }
export function compareValues(a, b) {
  if (a === null || a === undefined) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b === null || b === undefined) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  const ra = typeRank(a), rb = typeRank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === 'string') return a.localeCompare(b, 'de', { sensitivity: 'base' });
  return a < b ? -1 : a > b ? 1 : 0;
}

function binop(op, a, b) {
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
    case '^': r = Math.pow(x, y); break;
  }
  if (!Number.isFinite(r)) return ERR.NUM;
  // tame binary floating point noise (0.1+0.2)
  return Math.abs(r) < 1e15 ? +r.toPrecision(15) : r;
}

// iterate values of args: ranges yield cell values (flagged), scalars yield themselves
function* values(args, ctx) {
  for (const a of args) {
    const v = ev(a, ctx);
    if (v && v.range) {
      for (let r = v.r1; r <= v.r2; r++) for (let c = v.c1; c <= v.c2; c++) yield { v: ctx.get(v.sheet, r, c), fromRange: true };
    } else yield { v, fromRange: false };
  }
}
function rangeCells(rg, ctx) {
  const out = [];
  if (!rg || !rg.range) return [[scalar(rg, ctx)]];
  for (let r = rg.r1; r <= rg.r2; r++) { const row = []; for (let c = rg.c1; c <= rg.c2; c++) row.push(ctx.get(rg.sheet, r, c)); out.push(row); }
  return out;
}
function numbersOf(args, ctx) {
  const out = [];
  for (const { v, fromRange } of values(args, ctx)) {
    if (isErr(v)) return v;
    if (typeof v === 'number') out.push(v);
    else if (!fromRange && v !== null && v !== '') { const n = num(v); if (isErr(n)) return n; out.push(n); }
  }
  return out;
}

function criterion(crit) {
  if (isErr(crit)) return () => false;
  if (typeof crit === 'number' || typeof crit === 'boolean') return v => compareValues(v, crit) === 0 && typeof v === typeof crit;
  const s = String(crit ?? '');
  const m = /^(<=|>=|<>|=|<|>)?(.*)$/s.exec(s);
  const op = m[1] || '=';
  const raw = m[2];
  const n = parseNumberText(raw);
  if (n !== null) {
    return v => {
      if (typeof v !== 'number') return op === '<>' ? true : false;
      return { '=': v === n, '<>': v !== n, '<': v < n, '>': v > n, '<=': v <= n, '>=': v >= n }[op];
    };
  }
  const re = new RegExp('^' + raw.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/~\*/g, '\u0001').replace(/~\?/g, '\u0002').replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\u0001/g, '\\*').replace(/\u0002/g, '\\?') + '$', 'i');
  return v => {
    const t = v === null || v === undefined ? '' : typeof v === 'string' ? v : null;
    if (op === '=') return t !== null && re.test(t);
    if (op === '<>') return t === null || !re.test(t);
    if (t === null) return false;
    const c = t.localeCompare(raw, 'de', { sensitivity: 'base' });
    return { '<': c < 0, '>': c > 0, '<=': c <= 0, '>=': c >= 0 }[op];
  };
}

const EPOCH = Date.UTC(1899, 11, 30);
export function dateToSerial(d) { return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - EPOCH) / 86400000; }
export function serialToDate(s) { return new Date(EPOCH + Math.round(s * 86400000)); } // UTC based
function roundHalfAway(x, n) {
  const f = Math.pow(10, n);
  const r = Math.sign(x) * Math.round(Math.abs(x) * f * (1 + 1e-15)) / f;
  return +r.toPrecision(15);
}

function callFn(n, ctx) {
  const A = n.args;
  const arg = i => (A[i] ? scalar(ev(A[i], ctx), ctx) : null);
  const need = (min, max = min) => A.length >= min && A.length <= max;
  switch (n.name) {
    case 'SUM': { const xs = numbersOf(A, ctx); return isErr(xs) ? xs : +xs.reduce((a, b) => a + b, 0).toPrecision(15); }
    case 'PRODUCT': { const xs = numbersOf(A, ctx); return isErr(xs) ? xs : xs.reduce((a, b) => a * b, 1); }
    case 'AVERAGE': { const xs = numbersOf(A, ctx); if (isErr(xs)) return xs; if (!xs.length) return ERR.DIV0; return +(xs.reduce((a, b) => a + b, 0) / xs.length).toPrecision(15); }
    case 'MIN': { const xs = numbersOf(A, ctx); return isErr(xs) ? xs : xs.length ? Math.min(...xs) : 0; }
    case 'MAX': { const xs = numbersOf(A, ctx); return isErr(xs) ? xs : xs.length ? Math.max(...xs) : 0; }
    case 'MEDIAN': { const xs = numbersOf(A, ctx); if (isErr(xs)) return xs; if (!xs.length) return ERR.NUM; xs.sort((a, b) => a - b); const m = xs.length >> 1; return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2; }
    case 'COUNT': { let k = 0; for (const { v, fromRange } of values(A, ctx)) if (typeof v === 'number' || (!fromRange && parseNumberText(v) !== null && typeof v !== 'boolean')) k++; return k; }
    case 'COUNTA': { let k = 0; for (const { v } of values(A, ctx)) if (v !== null && v !== undefined && v !== '') k++; return k; }
    case 'COUNTBLANK': { let k = 0; for (const { v } of values(A, ctx)) if (v === null || v === undefined || v === '') k++; return k; }
    case 'IF': {
      if (!need(1, 3)) return ERR.VALUE;
      const c = bool(arg(0));
      if (isErr(c)) return c;
      return c ? (A.length > 1 ? arg(1) ?? 0 : true) : (A.length > 2 ? arg(2) ?? 0 : false);
    }
    case 'IFERROR': { const v = arg(0); return isErr(v) ? arg(1) ?? 0 : v; }
    case 'AND': case 'OR': {
      let any = false, all = true, seen = false;
      for (const { v, fromRange } of values(A, ctx)) {
        if (isErr(v)) return v;
        if (fromRange && typeof v !== 'boolean' && typeof v !== 'number') continue;
        const b = bool(v); if (isErr(b)) return b;
        seen = true; any = any || b; all = all && b;
      }
      if (!seen) return ERR.VALUE;
      return n.name === 'AND' ? all : any;
    }
    case 'NOT': { const b = bool(arg(0)); return isErr(b) ? b : !b; }
    case 'TRUE': return true;
    case 'FALSE': return false;
    case 'ROUND': case 'ROUNDUP': case 'ROUNDDOWN': {
      const x = num(arg(0)), d = A.length > 1 ? num(arg(1)) : 0;
      if (isErr(x)) return x; if (isErr(d)) return d;
      const k = Math.trunc(d);
      if (n.name === 'ROUND') return roundHalfAway(x, k);
      const f = Math.pow(10, k);
      const v = Math.abs(x) * f;
      const r = n.name === 'ROUNDUP' ? Math.ceil(+v.toPrecision(15)) : Math.floor(+v.toPrecision(15));
      return +(Math.sign(x) * r / f).toPrecision(15);
    }
    case 'INT': { const x = num(arg(0)); return isErr(x) ? x : Math.floor(x); }
    case 'MOD': { const x = num(arg(0)), y = num(arg(1)); if (isErr(x)) return x; if (isErr(y)) return y; if (y === 0) return ERR.DIV0; return +(x - y * Math.floor(x / y)).toPrecision(15); }
    case 'ABS': { const x = num(arg(0)); return isErr(x) ? x : Math.abs(x); }
    case 'SIGN': { const x = num(arg(0)); return isErr(x) ? x : Math.sign(x); }
    case 'POWER': { const x = num(arg(0)), y = num(arg(1)); if (isErr(x)) return x; if (isErr(y)) return y; return Math.pow(x, y); }
    case 'SQRT': { const x = num(arg(0)); if (isErr(x)) return x; return x < 0 ? ERR.NUM : Math.sqrt(x); }
    case 'PI': return Math.PI;
    case 'RAND': return Math.random();
    case 'TODAY': return dateToSerial(new Date());
    case 'NOW': { const d = new Date(); return dateToSerial(d) + (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400; }
    case 'DATE': {
      const y = num(arg(0)), m = num(arg(1)), d = num(arg(2));
      if ([y, m, d].some(isErr)) return ERR.VALUE;
      return (Date.UTC(y < 1900 ? y + 1900 : y, m - 1, d) - EPOCH) / 86400000;
    }
    case 'YEAR': case 'MONTH': case 'DAY': case 'WEEKDAY': {
      const x = num(arg(0)); if (isErr(x)) return x;
      const d = serialToDate(x);
      if (n.name === 'YEAR') return d.getUTCFullYear();
      if (n.name === 'MONTH') return d.getUTCMonth() + 1;
      if (n.name === 'DAY') return d.getUTCDate();
      const type = A.length > 1 ? num(arg(1)) : 1;
      const wd = d.getUTCDay();
      return type === 2 ? ((wd + 6) % 7) + 1 : type === 3 ? (wd + 6) % 7 : wd + 1;
    }
    case 'CONCAT': case 'CONCATENATE': {
      let s = '';
      for (const { v } of values(A, ctx)) { if (isErr(v)) return v; s += str(v); }
      return s;
    }
    case 'LEN': { const v = arg(0); return isErr(v) ? v : str(v).length; }
    case 'UPPER': { const v = arg(0); return isErr(v) ? v : str(v).toLocaleUpperCase('de'); }
    case 'LOWER': { const v = arg(0); return isErr(v) ? v : str(v).toLocaleLowerCase('de'); }
    case 'PROPER': { const v = arg(0); return isErr(v) ? v : str(v).toLocaleLowerCase('de').replace(/(^|[^\p{L}])(\p{L})/gu, (m, a, b) => a + b.toLocaleUpperCase('de')); }
    case 'TRIM': { const v = arg(0); return isErr(v) ? v : str(v).trim().replace(/ {2,}/g, ' '); }
    case 'LEFT': case 'RIGHT': {
      const v = arg(0); if (isErr(v)) return v;
      const k = A.length > 1 ? num(arg(1)) : 1; if (isErr(k)) return k;
      const s = str(v);
      return n.name === 'LEFT' ? s.slice(0, Math.max(0, k)) : (k <= 0 ? '' : s.slice(-k));
    }
    case 'MID': { const v = arg(0), st = num(arg(1)), k = num(arg(2)); if (isErr(v)) return v; if (isErr(st) || isErr(k) || st < 1) return ERR.VALUE; return str(v).substr(st - 1, k); }
    case 'VALUE': { const v = arg(0); if (typeof v === 'number') return v; const x = parseNumberText(str(v)); return x === null ? ERR.VALUE : x; }
    case 'TEXT': { const v = arg(0), f = arg(1); if (isErr(v)) return v; return ctx.fmt ? ctx.fmt(v, str(f)) : str(v); }
    case 'ISBLANK': { const v = arg(0); return v === null || v === undefined; }
    case 'ISNUMBER': return typeof arg(0) === 'number';
    case 'ISTEXT': return typeof arg(0) === 'string';
    case 'SUMIF': case 'COUNTIF': case 'AVERAGEIF': {
      const rg = ev(A[0], ctx);
      if (isErr(rg)) return rg;
      const test = criterion(arg(1));
      const cells = rangeCells(rg, ctx);
      const sumRg = A.length > 2 ? ev(A[2], ctx) : rg;
      let total = 0, count = 0;
      cells.forEach((row, ri) => row.forEach((v, ci) => {
        if (!test(v)) return;
        count++;
        if (n.name !== 'COUNTIF') {
          const sv = sumRg && sumRg.range ? ctx.get(sumRg.sheet, sumRg.r1 + ri, sumRg.c1 + ci) : v;
          if (typeof sv === 'number') total += sv; else if (n.name === 'AVERAGEIF') count--;
        }
      }));
      if (n.name === 'COUNTIF') return count;
      if (n.name === 'SUMIF') return +total.toPrecision(15);
      return count ? total / count : ERR.DIV0;
    }
    case 'SUMIFS': case 'COUNTIFS': {
      const off = n.name === 'SUMIFS' ? 1 : 0;
      const sumRg = off ? ev(A[0], ctx) : null;
      const pairs = [];
      for (let i = off; i + 1 < A.length; i += 2) pairs.push({ rg: ev(A[i], ctx), test: criterion(scalar(ev(A[i + 1], ctx), ctx)) });
      if (!pairs.length) return ERR.VALUE;
      const first = pairs[0].rg;
      if (!first || !first.range) return ERR.VALUE;
      let total = 0, count = 0;
      for (let r = 0; r <= first.r2 - first.r1; r++) for (let c = 0; c <= first.c2 - first.c1; c++) {
        if (!pairs.every(p => p.rg && p.rg.range && p.test(ctx.get(p.rg.sheet, p.rg.r1 + r, p.rg.c1 + c)))) continue;
        count++;
        if (sumRg && sumRg.range) { const sv = ctx.get(sumRg.sheet, sumRg.r1 + r, sumRg.c1 + c); if (typeof sv === 'number') total += sv; }
      }
      return off ? +total.toPrecision(15) : count;
    }
    case 'VLOOKUP': case 'HLOOKUP': {
      const key = arg(0); if (isErr(key)) return key;
      const rg = ev(A[1], ctx);
      if (!rg || !rg.range) return ERR.VALUE;
      const idx = num(arg(2)); if (isErr(idx)) return idx;
      const approx = A.length > 3 ? bool(arg(3)) : true;
      const vert = n.name === 'VLOOKUP';
      const len = vert ? rg.r2 - rg.r1 + 1 : rg.c2 - rg.c1 + 1;
      const width = vert ? rg.c2 - rg.c1 + 1 : rg.r2 - rg.r1 + 1;
      if (idx < 1 || idx > width) return ERR.REF;
      const at = (i, k) => (vert ? ctx.get(rg.sheet, rg.r1 + i, rg.c1 + k) : ctx.get(rg.sheet, rg.r1 + k, rg.c1 + i));
      let found = -1;
      if (approx === true) {
        for (let i = 0; i < len; i++) {
          const v = at(i, 0);
          if (v === null || v === undefined) continue;
          if (typeRank(v) !== typeRank(key)) continue;
          if (compareValues(v, key) <= 0) found = i; else break;
        }
      } else {
        const test = typeof key === 'string' ? criterion(key) : v => compareValues(v, key) === 0 && typeof v === typeof key;
        for (let i = 0; i < len; i++) if (test(at(i, 0))) { found = i; break; }
      }
      if (found < 0) return ERR.NA;
      return at(found, idx - 1) ?? 0;
    }
    case 'MATCH': {
      const key = arg(0); const rg = ev(A[1], ctx);
      if (!rg || !rg.range) return ERR.NA;
      const type = A.length > 2 ? num(arg(2)) : 1;
      const cells = rangeCells(rg, ctx).flat();
      if (type === 0) { const test = typeof key === 'string' ? criterion(key) : v => compareValues(v, key) === 0; const i = cells.findIndex(test); return i < 0 ? ERR.NA : i + 1; }
      let found = -1;
      for (let i = 0; i < cells.length; i++) { const c = compareValues(cells[i], key); if (type > 0 ? c <= 0 : c >= 0) found = i; else break; }
      return found < 0 ? ERR.NA : found + 1;
    }
    case 'INDEX': {
      const rg = ev(A[0], ctx);
      const r = A.length > 1 ? num(arg(1)) : 1, c = A.length > 2 ? num(arg(2)) : 1;
      if (isErr(r) || isErr(c)) return ERR.VALUE;
      if (!rg || !rg.range) return r <= 1 && c <= 1 ? scalar(rg, ctx) : ERR.REF;
      const rr = rg.r1 + Math.max(1, r) - 1, cc = rg.c1 + Math.max(1, c) - 1;
      if (rr > rg.r2 || cc > rg.c2) return ERR.REF;
      return ctx.get(rg.sheet, rr, cc);
    }
    default: return ERR.NAME;
  }
}
