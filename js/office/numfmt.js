// Number format engine (Excel-compatible format codes, German output: 1.234,56 · 31.12.2026 · Montag).
// Canonical codes are stored like in .xlsx files ("#,##0.00", "dd.mm.yyyy"); German codes typed by the
// user ("#.##0,00 €", "TT.MM.JJJJ") are converted with fromGermanCode() first.

const DAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const DAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mrz', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
export const GERMAN_DAYS = DAYS;
export const GERMAN_MONTHS = MONTHS;

const COLORS = {
  black: '#000000', schwarz: '#000000', blue: '#0000FF', blau: '#0000FF', cyan: '#00FFFF', zyan: '#00FFFF', green: '#008000', grün: '#008000', gruen: '#008000',
  magenta: '#FF00FF', red: '#FF0000', rot: '#FF0000', white: '#FFFFFF', weiß: '#FFFFFF', weiss: '#FFFFFF', yellow: '#FFFF00', gelb: '#FFFF00',
};
const EPOCH = Date.UTC(1899, 11, 30);

// ---------------------------------------------------------------- tokenizing a code
/** Split a format code into sections at ';' (outside quotes/brackets/escapes). */
export function splitSections(code) {
  const out = [];
  let cur = '', q = false, br = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (q) { cur += ch; if (ch === '"') q = false; continue; }
    if (ch === '\\' || ch === '_' || ch === '*') { cur += ch + (code[i + 1] ?? ''); i++; continue; }
    if (ch === '"') { q = true; cur += ch; continue; }
    if (ch === '[') br = true;
    if (ch === ']') br = false;
    if (ch === ';' && !br) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/** Tokens of one section: {t:'lit'|'num'|'date'|'text'|'general'|'pct'|'exp'|'frac', v} */
function tokenizeSection(sec) {
  const toks = [];
  let color = null, cond = null, elapsed = false;
  let i = 0;
  const dateSec = /[dymhs]/i.test(sec.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/general|standard|am\/pm|a\/p/gi, '').replace(/\\./g, '').replace(/[eE][+-]/g, ''));
  const lit = s => { if (toks.length && toks[toks.length - 1].t === 'lit') toks[toks.length - 1].v += s; else toks.push({ t: 'lit', v: s }); };
  while (i < sec.length) {
    const ch = sec[i];
    const rest = sec.slice(i);
    if (ch === '"') { const j = sec.indexOf('"', i + 1); lit(sec.slice(i + 1, j < 0 ? sec.length : j)); i = j < 0 ? sec.length : j + 1; continue; }
    if (ch === '\\') { lit(sec[i + 1] ?? ''); i += 2; continue; }
    if (ch === '_') { lit(' '); i += 2; continue; }
    if (ch === '*') { i += 2; continue; }
    if (ch === '[') {
      const j = sec.indexOf(']', i);
      const inner = sec.slice(i + 1, j < 0 ? sec.length : j);
      i = j < 0 ? sec.length : j + 1;
      const low = inner.toLowerCase();
      if (COLORS[low]) { color = COLORS[low]; continue; }
      const cm = /^(?:color|farbe)\s*(\d+)$/i.exec(inner);
      if (cm) { color = ['#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF'][(+cm[1] - 1) % 8] || null; continue; }
      const cd = /^(<=|>=|<>|<|>|=)\s*(-?[\d.,]+)$/.exec(inner);
      if (cd) { cond = { op: cd[1], v: parseFloat(cd[2].replace(',', '.')) }; continue; }
      if (/^\$/.test(inner)) { const sym = inner.slice(1).split('-')[0]; if (sym) lit(sym); continue; }
      if (/^(h+|m+|s+)$/i.test(inner)) { toks.push({ t: 'date', v: inner.toLowerCase(), elapsed: true }); elapsed = true; continue; }
      continue; // unknown bracket (locale ids, DBNum …)
    }
    if (/^general/i.test(rest) || /^standard/i.test(rest)) { toks.push({ t: 'general' }); i += /^general/i.test(rest) ? 7 : 8; continue; }
    if (/^(am\/pm|a\/p)/i.test(rest)) { const m = /^(am\/pm|a\/p)/i.exec(rest); toks.push({ t: 'date', v: m[0].toLowerCase() === 'a/p' ? 'a/p' : 'ampm' }); i += m[0].length; continue; }
    if (/[ymdhs]/i.test(ch)) {
      let j = i; while (j < sec.length && sec[j].toLowerCase() === ch.toLowerCase()) j++;
      let v = sec.slice(i, j).toLowerCase();
      // fractional seconds: ss.000
      if (v[0] === 's' && sec[j] === '.' && sec[j + 1] === '0') { let k = j + 1; while (sec[k] === '0') k++; toks.push({ t: 'date', v, frac: k - j - 1 }); i = k; continue; }
      toks.push({ t: 'date', v });
      i = j; continue;
    }
    if (/^[eE][+-]/.test(rest)) { let j = i + 2; while (sec[j] === '0' || sec[j] === '#') j++; toks.push({ t: 'exp', sign: rest[1], digits: j - i - 2 }); i = j; continue; }
    if ((ch === '.' || ch === ',') && dateSec) { lit(ch); i++; continue; }
    if ('0#?.,'.includes(ch)) {
      let j = i; while (j < sec.length && '0#?.,'.includes(sec[j])) j++;
      // a fraction like "# ?/?" or "?/?" – digits, slash, digits
      const fm = /^([#0?]*\s?)?([#0?]+)\/([#0?]+|\d+)/.exec(rest);
      if (fm && fm[0].includes('/')) { toks.push({ t: 'frac', whole: !!(fm[1] && fm[1].trim()), num: fm[2], den: fm[3] }); i += fm[0].length; continue; }
      toks.push({ t: 'num', v: sec.slice(i, j) });
      i = j; continue;
    }
    if (ch === '%') { toks.push({ t: 'pct' }); i++; continue; }
    if (ch === '@') { toks.push({ t: 'text' }); i++; continue; }
    lit(ch); i++;
  }
  // m after h / before s means minutes
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k];
    if (tk.t !== 'date' || !/^m{1,2}$/.test(tk.v)) continue;
    const prev = toks.slice(0, k).reverse().find(x => x.t === 'date');
    const next = toks.slice(k + 1).find(x => x.t === 'date');
    if ((prev && /^h/.test(prev.v)) || (next && /^s/.test(next.v))) tk.min = true;
  }
  return { toks, color, cond, elapsed };
}

const cache = new Map();
function compileCode(code) {
  let c = cache.get(code);
  if (c) return c;
  const secs = splitSections(code).map(tokenizeSection);
  c = { secs, isDate: secs.some(s => s.toks.some(t => t.t === 'date')), isText: secs.length === 1 && secs[0].toks.some(t => t.t === 'text') && !secs[0].toks.some(t => t.t === 'num') };
  if (cache.size > 500) cache.clear();
  cache.set(code, c);
  return c;
}

/** Is a code a date/time format? */
export function isDateFormat(code) {
  if (!code || /^general$/i.test(code)) return false;
  return compileCode(code).isDate;
}

// ---------------------------------------------------------------- formatting
const grp = s => s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

function fmtGeneralDe(v) {
  if (!Number.isFinite(v)) return '#ZAHL!';
  if (Number.isInteger(v) && Math.abs(v) < 1e11) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-9 || a >= 1e11)) return v.toExponential(5).replace(/\.?0+e/, 'e').replace('.', ',').replace('e+', 'E+').replace('e-', 'E-');
  let s = String(+v.toPrecision(15));
  if (s.length > 11) { const intLen = String(Math.trunc(a)).length + (v < 0 ? 1 : 0); s = String(+v.toFixed(Math.max(0, 10 - intLen))); }
  return s.replace('.', ',');
}

/** Format the integer/decimal part placeholders. pattern like "#,##0.00" */
function fmtDigits(a, pattern, opts) {
  // a ≥ 0 already scaled
  let pat = pattern;
  // trailing commas = divide by 1000
  while (/,$/.test(pat)) { a /= 1000; pat = pat.slice(0, -1); }
  const dot = pat.indexOf('.');
  const ip = dot < 0 ? pat : pat.slice(0, dot);
  const fp = dot < 0 ? '' : pat.slice(dot + 1).replace(/,/g, '');
  const grouping = /[0#?],[0#?]/.test(ip);
  const ipClean = ip.replace(/,/g, '');
  const maxDec = fp.length;
  const minDec = (fp.match(/0/g) || []).length;
  const qDec = (fp.match(/\?/g) || []).length;
  let s = maxDec ? (Math.round(a * 10 ** maxDec + 1e-9 * (a * 10 ** maxDec)) / 10 ** maxDec).toFixed(maxDec) : String(Math.round(a));
  if (/e/.test(s)) s = BigInt(Math.round(a)).toString();
  let [is, fs = ''] = s.split('.');
  // trim optional decimals
  if (fs) {
    let keep = fs.length;
    while (keep > minDec && fs[keep - 1] === '0') keep--;
    fs = fs.slice(0, keep);
    if (qDec && fs.length < minDec + qDec) fs = fs.padEnd(Math.min(maxDec, Math.max(fs.length, minDec)), ' ');
  }
  const minInt = (ipClean.match(/0/g) || []).length;
  if (is === '0' && minInt === 0) is = '';
  is = is.padStart(minInt, '0');
  const qInt = (ipClean.match(/\?/g) || []).length;
  if (qInt && is.length < minInt + qInt) is = is.padStart(minInt + qInt, ' ');
  if (grouping) is = grp(is);
  const decSep = opts.dec ?? ',';
  return is + (fs.length || (dot >= 0 && opts.keepDot) ? decSep + fs : (dot >= 0 && pat.endsWith('.') ? decSep : ''));
}

function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }
function fracApprox(x, maxDen) {
  let best = [Math.round(x), 1], err = Math.abs(x - best[0]);
  for (let d = 1; d <= maxDen; d++) { const n = Math.round(x * d); const e = Math.abs(x - n / d); if (e < err - 1e-12) { best = [n, d]; err = e; } }
  const g = gcd(Math.abs(best[0]), best[1]) || 1;
  return [best[0] / g, best[1] / g];
}

function dateParts(v, exact) {
  const ms = exact ? Math.round(v * 86400000) : Math.round(v * 86400) * 1000;
  const d = new Date(EPOCH + ms);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay(), H: d.getUTCHours(), M: d.getUTCMinutes(), S: d.getUTCSeconds(), ms: d.getUTCMilliseconds() };
}

function fmtDate(v, sec) {
  if (v < 0 && !sec.elapsed) return '#'.repeat(10);
  const p = dateParts(v, sec.toks.some(t => t.frac));
  const ampm = sec.toks.some(t => t.t === 'date' && (t.v === 'ampm' || t.v === 'a/p'));
  const pad = (n, k = 2) => String(n).padStart(k, '0');
  let out = '';
  for (const t of sec.toks) {
    if (t.t === 'lit') { out += t.v; continue; }
    if (t.t === 'num') { out += t.v.replace(/[#?]/g, ''); continue; }
    if (t.t !== 'date') continue;
    const x = t.v;
    if (t.elapsed) {
      const totalS = Math.round(v * 86400);
      if (x[0] === 'h') out += pad(Math.floor(totalS / 3600), x.length);
      else if (x[0] === 'm') out += pad(Math.floor(totalS / 60), x.length);
      else out += pad(totalS, x.length);
      continue;
    }
    if (x[0] === 'y') out += x.length <= 2 ? pad(p.y % 100) : String(p.y);
    else if (x[0] === 'm' && t.min) out += x.length === 1 ? p.M : pad(p.M);
    else if (x[0] === 'm') out += x.length === 1 ? p.m + 1 : x.length === 2 ? pad(p.m + 1) : x.length === 3 ? MONTHS_SHORT[p.m] : x.length === 5 ? MONTHS[p.m][0] : MONTHS[p.m];
    else if (x[0] === 'd') out += x.length === 1 ? p.d : x.length === 2 ? pad(p.d) : x.length === 3 ? DAYS_SHORT[p.wd] : DAYS[p.wd];
    else if (x[0] === 'h') { const hh = ampm ? ((p.H + 11) % 12) + 1 : p.H; out += x.length === 1 ? hh : pad(hh); }
    else if (x[0] === 's') {
      if (t.frac) { const sf = (p.S + p.ms / 1000).toFixed(t.frac).split('.'); out += pad(+sf[0]) + ',' + sf[1]; }
      else out += x.length === 1 ? p.S : pad(p.S);
    } else if (x === 'ampm') out += p.H < 12 ? 'AM' : 'PM';
    else if (x === 'a/p') out += p.H < 12 ? 'A' : 'P';
  }
  return out;
}

function fmtNumberSection(v, sec, neg) {
  // v already absolute if this is the negative section with its own format
  const toks = sec.toks;
  const hasPct = toks.some(t => t.t === 'pct');
  const numToks = toks.filter(t => t.t === 'num');
  const exp = toks.find(t => t.t === 'exp');
  const frac = toks.find(t => t.t === 'frac');
  let a = Math.abs(v) * (hasPct ? 100 : 1);
  let out = '';
  let sign = v < 0 && neg ? '-' : '';
  if (frac) {
    const den = /^\d+$/.test(frac.den) ? +frac.den : 10 ** frac.den.length - 1;
    let whole = frac.whole ? Math.floor(a) : 0;
    let rem = a - whole;
    let [n, d] = /^\d+$/.test(frac.den) ? [Math.round(rem * den), den] : fracApprox(rem, den);
    if (n === d && d) { whole++; n = 0; }
    const pre = toks.slice(0, toks.indexOf(frac)).map(t => (t.t === 'lit' ? t.v : '')).join('');
    const post = toks.slice(toks.indexOf(frac) + 1).map(t => (t.t === 'lit' ? t.v : '')).join('');
    let body;
    if (frac.whole) body = n ? `${whole ? whole + ' ' : ''}${n}/${d}` : String(whole);
    else body = `${Math.round(a * d) || 0}/${d}`;
    return sign + pre + body + post;
  }
  if (exp) {
    const pat = numToks.map(t => t.v).join('');
    const dot = pat.indexOf('.');
    const intDigits = Math.max(1, (dot < 0 ? pat : pat.slice(0, dot)).replace(/,/g, '').length);
    let e = a === 0 ? 0 : Math.floor(Math.log10(a));
    if (intDigits > 1) e = Math.floor(e / intDigits) * intDigits; else e = e - (intDigits - 1);
    let m = a === 0 ? 0 : a / 10 ** e;
    let ms = fmtDigits(m, pat, {});
    if (/^10(,|$)/.test(ms) && intDigits === 1) { e++; m = a / 10 ** e; ms = fmtDigits(m, pat, {}); }
    const es = String(Math.abs(e)).padStart(exp.digits, '0');
    for (const t of toks) {
      if (t.t === 'lit') out += t.v;
      else if (t === numToks[0]) out += ms;
      else if (t.t === 'exp') out += 'E' + (e < 0 ? '-' : exp.sign === '+' ? '+' : '') + es;
    }
    return sign + out;
  }
  if (!numToks.length) {
    // only literals (e.g. "Null") – value is not shown
    let s = '';
    for (const t of toks) { if (t.t === 'lit') s += t.v; else if (t.t === 'pct') s += '%'; else if (t.t === 'general') s += fmtGeneralDe(Math.abs(v)); }
    return (toks.some(t => t.t === 'general') ? sign : '') + s;
  }
  // combine all number tokens (literals between digits stay in place: "000-000")
  const firstIdx = toks.indexOf(numToks[0]), lastIdx = toks.indexOf(numToks[numToks.length - 1]);
  const middle = toks.slice(firstIdx, lastIdx + 1);
  const pattern = middle.filter(t => t.t === 'num').map(t => t.v).join('');
  const embedded = middle.some(t => t.t === 'lit');
  let digits;
  if (embedded) {
    // digit-by-digit fill from the right (phone/zip style), integers only
    const dPat = pattern.replace(/[.,]/g, '');
    let ds = String(Math.round(a));
    const slots = (dPat.match(/[0#?]/g) || []).length;
    ds = ds.padStart(slots, '0');
    const extra = ds.length - slots;
    let k = 0;
    digits = '';
    let firstSlot = true;
    for (const t of middle) {
      if (t.t === 'lit') { digits += t.v; continue; }
      for (const ch of t.v.replace(/[.,]/g, '')) {
        if (firstSlot) { digits += ds.slice(0, extra + 1); k = extra + 1; firstSlot = false; continue; }
        digits += ds[k++];
      }
    }
    digits = digits.replace(/^0+(?=\d)/, m => (/^0/.test(dPat) ? m : ''));
  } else digits = fmtDigits(a, pattern, {});
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (k > firstIdx && k <= lastIdx) continue;
    if (k === firstIdx) { out += digits; continue; }
    if (t.t === 'lit') out += t.v;
    else if (t.t === 'pct') out += (/\d$/.test(out) ? ' %' : '%');
    else if (t.t === 'text') out += '';
  }
  return sign + out;
}

/**
 * Format a value with a format code. Returns { text, color }.
 * v: number | string | boolean | null.
 */
export function formatWithCode(v, code) {
  if (v === null || v === undefined) return { text: '', color: null };
  if (!code || /^(general|standard)$/i.test(code)) {
    if (typeof v === 'number') return { text: fmtGeneralDe(v), color: null };
    if (typeof v === 'boolean') return { text: v ? 'WAHR' : 'FALSCH', color: null };
    return { text: String(v), color: null };
  }
  const c = compileCode(code);
  const secs = c.secs;
  if (typeof v === 'boolean') return { text: v ? 'WAHR' : 'FALSCH', color: null };
  if (typeof v === 'string') {
    const sec = secs.length >= 4 ? secs[3] : secs.find(s => s.toks.some(t => t.t === 'text'));
    if (!sec) return { text: v, color: null };
    let out = '';
    for (const t of sec.toks) out += t.t === 'lit' ? t.v : t.t === 'text' ? v : '';
    return { text: out, color: sec.color };
  }
  if (!Number.isFinite(v)) return { text: '#ZAHL!', color: null };
  if (c.isText) return { text: fmtGeneralDe(v), color: null };
  // choose section
  let sec = secs[0], neg = true;
  if (secs.some(s => s.cond)) {
    const test = s => { const { op, v: x } = s.cond; return { '<': v < x, '>': v > x, '<=': v <= x, '>=': v >= x, '=': v === x, '<>': v !== x }[op]; };
    if (secs[0].cond ? test(secs[0]) : v >= 0) sec = secs[0];
    else if (secs[1] && (!secs[1].cond || test(secs[1]))) sec = secs[1];
    else sec = secs[2] || secs[0];
  } else if (v < 0 && secs.length >= 2) { sec = secs[1]; neg = false; }
  else if (v === 0 && secs.length >= 3) sec = secs[2];
  if (!sec.toks.length) return { text: '', color: sec.color };
  if (sec.toks.some(t => t.t === 'general') && !sec.toks.some(t => t.t === 'num')) {
    let s = '';
    for (const t of sec.toks) s += t.t === 'lit' ? t.v : t.t === 'general' ? fmtGeneralDe(neg ? v : Math.abs(v)) : '';
    return { text: s, color: sec.color };
  }
  if (sec.toks.some(t => t.t === 'date')) return { text: fmtDate(v, sec), color: sec.color };
  return { text: fmtNumberSection(v, sec, neg), color: sec.color };
}

export function formatNumberCode(v, code) { return formatWithCode(v, code).text; }

// ---------------------------------------------------------------- German ↔ canonical codes
/**
 * Convert a format code typed in German conventions to the canonical (xlsx) form:
 * "#.##0,00 €" → "#,##0.00 €" · "TT.MM.JJJJ" → "dd.mm.yyyy" · "0,0 %" → "0.0 %".
 * Codes that already look canonical are returned unchanged.
 */
export function fromGermanCode(code) {
  if (!code) return code;
  let s = String(code);
  // map date letters outside quotes/brackets
  const mapOutside = (fn) => {
    let out = '', q = false, br = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) { out += ch; if (ch === '"') q = false; continue; }
      if (ch === '"') { q = true; out += ch; continue; }
      if (ch === '\\') { out += ch + (s[i + 1] ?? ''); i++; continue; }
      if (ch === '[') br = true;
      if (ch === ']') { br = false; out += ch; continue; }
      out += br ? ch : fn(ch, i);
    }
    return out;
  };
  const plain = s.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
  if (/[TJ]/.test(plain) || /\bMM\b.*\bJ/i.test(plain)) {
    s = mapOutside(ch => (ch === 'T' ? 'd' : ch === 'J' ? 'y' : ch === 'M' ? 'm' : ch));
    // "MMM" etc. already lowered; German "hh:mm" unchanged
  }
  const numPart = plain.replace(/[TJMhms]/g, '');
  const hasComma = numPart.includes(','), hasDot = numPart.includes('.');
  let german = false;
  if (hasComma && hasDot) german = numPart.indexOf('.') < numPart.indexOf(','); // #.##0,00
  else if (hasComma) german = !/[#0],##0/.test(numPart) && !/#,###/.test(numPart); // "0,00" (but "#,##0" is canonical)
  else if (hasDot && !isDateFormat(s)) german = /#\.##0/.test(numPart); // "#.##0"
  if (german) s = mapOutside(ch => (ch === ',' ? '\u0001' : ch === '.' ? ',' : ch)).replace(/\u0001/g, '.');
  return s;
}

/** Canonical code → German display form (for the format dialog). */
export function toGermanCode(code) {
  if (!code) return code;
  let out = '', q = false, br = false;
  const dateLike = isDateFormat(code);
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (q) { out += ch; if (ch === '"') q = false; continue; }
    if (ch === '"') { q = true; out += ch; continue; }
    if (ch === '\\') { out += ch + (code[i + 1] ?? ''); i++; continue; }
    if (ch === '[') br = true;
    if (ch === ']') { br = false; out += ch; continue; }
    if (br) { out += ch; continue; }
    if (dateLike) out += ch === 'd' ? 'T' : ch === 'y' ? 'J' : ch === 'm' ? 'M' : ch;
    else out += ch === ',' ? '.' : ch === '.' ? ',' : ch;
  }
  if (dateLike) out = out.replace(/(h{1,2}):MM/gi, '$1:mm').replace(/MM:ss/gi, 'mm:ss').replace(/:MM\b/g, ':mm');
  return out;
}

export { fmtGeneralDe };
