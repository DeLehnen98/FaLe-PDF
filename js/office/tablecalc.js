// Tabellenformeln der Textverarbeitung (wie Formelfelder in Word): =SUM(ABOVE), =C2*D2, =AVERAGE(B2:B9) …
// Reiner Parser/Rechner ohne eval und ohne DOM. Deutsche Namen (SUMME, OBEN, LINKS …) werden akzeptiert;
// gespeichert wird die kanonische (englische) Schreibweise, die auch in .docx-Formelfeldern steht.
// Zahlen: Dezimalpunkt oder -komma ("0,19"); Argumente werden mit ";" getrennt (", " geht auch).

const FN_ALIAS = { SUMME: 'SUM', MITTELWERT: 'AVERAGE', ANZAHL: 'COUNT', PRODUKT: 'PRODUCT', RUNDEN: 'ROUND', MINIMUM: 'MIN', MAXIMUM: 'MAX', BETRAG: 'ABS' };
const DIR_ALIAS = { OBEN: 'ABOVE', LINKS: 'LEFT', UNTEN: 'BELOW', RECHTS: 'RIGHT' };
const FNS = new Set(['SUM', 'AVERAGE', 'COUNT', 'PRODUCT', 'MIN', 'MAX', 'ROUND', 'ABS', 'INT', 'MOD']);
const DIRS = new Set(['ABOVE', 'LEFT', 'BELOW', 'RIGHT']);
export const TF_FORMATS = [['', 'Automatisch'], ['0', '0'], ['0,00', '0,00'], ['0,00 €', '0,00 €'], ['0 %', '0 %']];

/** Number in a cell text: "1.234,56 €" → 1234.56, "19 %" → 19, "-2" → -2; null when there is none. */
export function cellNumber(text) {
  const t = String(text || '').replace(/ /g, ' ').trim();
  const m = /-?\s?\d[\d.\s']*(?:,\d+)?|-?\d+(?:\.\d+)?/.exec(t);
  if (!m) return null;
  let s = m[0].replace(/[\s']/g, '');
  if (/,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** Display a result in German format. fmt: '' | '0' | '0,00' | '0,00 €' | '0 %' */
export function formatResult(n, fmt = '') {
  if (n == null || !Number.isFinite(n)) return '!Fehler';
  const de = (v, d) => v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
  if (fmt === '0') return de(Math.round(n), 0);
  if (fmt === '0,00') return de(n, 2);
  if (fmt === '0,00 €') return `${de(n, 2)} €`;
  if (fmt === '0 %') return `${de(Math.round(n), 0)} %`;
  return n.toLocaleString('de-DE', { maximumFractionDigits: 2 });
}

// ---------------- tokenizer + parser ----------------
function tokenize(src) {
  const out = [];
  let i = 0;
  const s = String(src);
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(\d+(?:[.,]\d+)?)/.exec(s.slice(i));
    if (num && !(s[i - 1] && /[A-Za-z]/.test(s[i - 1]))) {
      // "0,19" is a number unless the comma separates arguments ("ROUND(A1, 2)" has a space)
      out.push({ t: 'num', v: parseFloat(num[1].replace(',', '.')) }); i += num[1].length; continue;
    }
    const id = /^([A-Za-zÄÖÜäöü]+\d*)/.exec(s.slice(i));
    if (id) { out.push({ t: 'id', v: id[1].toUpperCase() }); i += id[1].length; continue; }
    if ('+-*/^()'.includes(c)) { out.push({ t: c }); i++; continue; }
    if (c === ';' || c === ',') { out.push({ t: ';' }); i++; continue; }
    if (c === ':') { out.push({ t: ':' }); i++; continue; }
    throw new Error(`Unerwartetes Zeichen „${c}“`);
  }
  return out;
}

/** Parse a formula ("=SUMME(OBEN)") → AST. Throws with a German message on errors. */
export function parseFormula(src) {
  const toks = tokenize(String(src || '').replace(/^\s*=/, ''));
  let p = 0;
  const peek = () => toks[p], eat = t => { if (!toks[p] || toks[p].t !== t) throw new Error('Formel unvollständig'); return toks[p++]; };
  const isRef = v => /^[A-Z]{1,2}\d{1,4}$/.test(v);
  function primary() {
    const k = peek();
    if (!k) throw new Error('Formel unvollständig');
    if (k.t === 'num') { p++; return { n: k.v }; }
    if (k.t === '-') { p++; return { op: 'neg', a: primary() }; }
    if (k.t === '+') { p++; return primary(); }
    if (k.t === '(') { p++; const e = expr(); eat(')'); return e; }
    if (k.t === 'id') {
      p++;
      let v = FN_ALIAS[k.v] || DIR_ALIAS[k.v] || k.v;
      if (peek() && peek().t === '(') {
        if (!FNS.has(v)) throw new Error(`Unbekannte Funktion „${k.v}“`);
        p++;
        const args = [];
        if (peek() && peek().t !== ')') { args.push(arg()); while (peek() && peek().t === ';') { p++; args.push(arg()); } }
        eat(')');
        return { fn: v, args };
      }
      if (DIRS.has(v)) return { dir: v };
      if (isRef(v)) {
        if (peek() && peek().t === ':') { p++; const b = eat('id').v; if (!isRef(b)) throw new Error('Ungültiger Bereich'); return { range: [v, b] }; }
        return { ref: v };
      }
      throw new Error(`Unbekannter Name „${k.v}“`);
    }
    throw new Error('Formel ungültig');
  }
  function pow() { let a = primary(); while (peek() && peek().t === '^') { p++; a = { op: '^', a, b: primary() }; } return a; }
  function term() { let a = pow(); while (peek() && (peek().t === '*' || peek().t === '/')) { const o = toks[p++].t; a = { op: o, a, b: pow() }; } return a; }
  function expr() { let a = term(); while (peek() && (peek().t === '+' || peek().t === '-')) { const o = toks[p++].t; a = { op: o, a, b: term() }; } return a; }
  function arg() { return expr(); }
  const ast = expr();
  if (p < toks.length) throw new Error('Formel ungültig');
  return ast;
}

/** Canonical (English) spelling of a formula for storage / .docx: "=SUM(ABOVE)", "=C2*D2", "=E5*0.19". */
export function canonicalFormula(src) {
  const ast = parseFormula(src);
  const prec = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 };
  const w = (n, parent = 0) => {
    if (n.n != null) return String(n.n);
    if (n.ref) return n.ref;
    if (n.range) return `${n.range[0]}:${n.range[1]}`;
    if (n.dir) return n.dir;
    if (n.fn) return `${n.fn}(${n.args.map(a => w(a)).join(',')})`;
    if (n.op === 'neg') return `-${w(n.a, 4)}`;
    const s = `${w(n.a, prec[n.op])}${n.op}${w(n.b, prec[n.op] + (n.op === '-' || n.op === '/' ? 1 : 0))}`;
    return prec[n.op] < parent ? `(${s})` : s;
  };
  return `=${w(ast)}`;
}

const colIndex = letters => { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
export const parseRef = ref => { const m = /^([A-Z]{1,2})(\d{1,4})$/.exec(ref); return m ? { c: colIndex(m[1]), r: +m[2] - 1 } : null; };

/**
 * Evaluate a formula. ctx: { value(r, c) → number|null (cell number), r, c (position of the formula cell), rows, cols }
 * Directions: ABOVE/LEFT collect the numeric cells next to the formula cell until the first cell without a number.
 */
export function evalFormula(src, ctx) {
  const ast = typeof src === 'string' ? parseFormula(src) : src;
  const dirVals = d => {
    const out = [];
    const [dr, dc] = { ABOVE: [-1, 0], BELOW: [1, 0], LEFT: [0, -1], RIGHT: [0, 1] }[d];
    let r = ctx.r + dr, c = ctx.c + dc, started = false;
    while (r >= 0 && c >= 0 && r < ctx.rows && c < ctx.cols) {
      const v = ctx.value(r, c);
      if (v == null) { if (started) break; } else { out.push(v); started = true; }
      r += dr; c += dc;
    }
    return out;
  };
  const vals = n => {
    if (n.dir) return dirVals(n.dir);
    if (n.range) {
      const a = parseRef(n.range[0]), b = parseRef(n.range[1]);
      const out = [];
      for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++) for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++) { const v = ctx.value(r, c); if (v != null) out.push(v); }
      return out;
    }
    return [ev(n)];
  };
  const ev = n => {
    if (n.n != null) return n.n;
    if (n.ref) { const p = parseRef(n.ref); const v = p ? ctx.value(p.r, p.c) : null; return v == null ? 0 : v; }
    if (n.dir || n.range) return vals(n).reduce((a, b) => a + b, 0);
    if (n.op === 'neg') return -ev(n.a);
    if (n.op) {
      const a = ev(n.a), b = ev(n.b);
      if (n.op === '+') return a + b;
      if (n.op === '-') return a - b;
      if (n.op === '*') return a * b;
      if (n.op === '/') { if (b === 0) throw new Error('Division durch null'); return a / b; }
      return a ** b;
    }
    const all = n.args.flatMap(vals);
    switch (n.fn) {
      case 'SUM': return all.reduce((a, b) => a + b, 0);
      case 'AVERAGE': return all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0;
      case 'COUNT': return all.length;
      case 'PRODUCT': return all.reduce((a, b) => a * b, 1);
      case 'MIN': return all.length ? Math.min(...all) : 0;
      case 'MAX': return all.length ? Math.max(...all) : 0;
      case 'ABS': return Math.abs(all[0] || 0);
      case 'INT': return Math.trunc(all[0] || 0);
      case 'MOD': return all[1] ? (all[0] || 0) % all[1] : 0;
      case 'ROUND': { const d = Math.max(0, Math.min(10, Math.round(all[1] || 0))); const f = 10 ** d; return Math.round((all[0] || 0) * f) / f; }
      default: throw new Error('Unbekannte Funktion');
    }
  };
  return ev(ast);
}
