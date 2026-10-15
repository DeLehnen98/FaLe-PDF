// 1D barcodes (pure, no DOM) for tools/barcode-generator.js: EAN-13, EAN-8, UPC-A, Code 128 (sets B/C,
// chosen by dynamic programming for the shortest symbol), Code 39 (optional mod-43 check) and ITF-14
// (optional bearer bars). encode() → a symbol in module units; decodeRuns() reads a scanline back
// (self-test of the rendered image, also used by the tests).

// ---------------------------------------------------------------- tables
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const R = L.map(p => [...p].map(b => (b === '1' ? '0' : '1')).join(''));
const G = R.map(p => [...p].reverse().join(''));
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

// Code 128 bar/space widths of the values 0–106 (106 = stop, 7 elements)
export const C128 = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 ' +
  '123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 ' +
  '131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 ' +
  '213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 ' +
  '112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 ' +
  '421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112').split(' ');

// Code 39: built from the symbology's structure (2 of 5 bars wide + 1 of 4 spaces wide; $ / + % = 3 wide spaces)
export const C39_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';
const C39 = (() => {
  const pairs = [[0, 8], [2, 8], [0, 2], [4, 8], [0, 4], [2, 4], [6, 8], [0, 6], [2, 6], [4, 6]];   // values 1…9, 0
  const rows = [['1234567890', 3], ['ABCDEFGHIJ', 5], ['KLMNOPQRST', 7], ['UVWXYZ-. *', 1]];
  const t = {};
  for (const [chars, space] of rows) [...chars].forEach((c, i) => {
    const w = new Set([...pairs[i], space]);
    t[c] = Array.from({ length: 9 }, (_, k) => (w.has(k) ? 'w' : 'n')).join('');
  });
  for (const [c, narrowSpace] of [['$', 7], ['/', 5], ['+', 3], ['%', 1]]) t[c] = Array.from({ length: 9 }, (_, k) => (k % 2 && k !== narrowSpace ? 'w' : 'n')).join('');
  return t;
})();

// ITF: weights 1-2-4-7-parity, two wide of five
const ITF = (() => {
  const t = [];
  for (let d = 0; d < 10; d++) {
    const w = { 0: [2, 3], 1: [0, 4], 2: [1, 4], 3: [0, 1], 4: [2, 4], 5: [0, 2], 6: [1, 2], 7: [3, 4], 8: [0, 3], 9: [1, 3] }[d];
    t.push(Array.from({ length: 5 }, (_, k) => (w.includes(k) ? 'w' : 'n')).join(''));
  }
  return t;
})();

export const TYPES = ['ean13', 'ean8', 'upca', 'code128', 'code39', 'itf14'];
export const LABEL = { ean13: 'EAN-13', ean8: 'EAN-8', upca: 'UPC-A', code128: 'Code 128', code39: 'Code 39', itf14: 'ITF-14' };
export const WIDE = 3;   // wide:narrow ratio for Code 39 and ITF-14

/** GS1 check digit (EAN, UPC, ITF-14) of a digit string without check digit. */
export function gs1Check(digits) {
  let s = 0;
  for (let i = 0; i < digits.length; i++) s += (+digits[digits.length - 1 - i]) * (i % 2 ? 1 : 3);
  return (10 - (s % 10)) % 10;
}
export function mod43(text) {
  let s = 0;
  for (const c of text) s += C39_CHARS.indexOf(c);
  return C39_CHARS[s % 43];
}

class BarcodeInputError extends Error {
  constructor(msg) { super(msg.en); this.name = 'BarcodeInputError'; this.userMessage = msg; }
}
const bad = (de, en) => new BarcodeInputError({ de, en });

/**
 * Check and normalise input → { data (what is encoded / read back), text (human-readable), note? }.
 * Throws BarcodeInputError with {de, en}.
 */
export function normalize(type, raw, o = {}) {
  const s = String(raw ?? '');
  if (['ean13', 'ean8', 'upca', 'itf14'].includes(type)) {
    const d = s.replace(/[\s-]/g, '');
    const n = { ean13: 13, ean8: 8, upca: 12, itf14: 14 }[type];
    const name = LABEL[type];
    if (!d) throw bad('Gib die Ziffern ein.', 'Enter the digits.');
    if (!/^\d+$/.test(d)) throw bad(`${name} besteht nur aus Ziffern.`, `${name} consists of digits only.`);
    if (d.length === n - 1) {
      const c = gs1Check(d);
      return { data: d + c, text: d + c, note: { de: `Prüfziffer ${c} ergänzt.`, en: `Check digit ${c} added.` } };
    }
    if (d.length !== n) throw bad(`${name} hat ${n - 1} Ziffern plus Prüfziffer – du hast ${d.length} eingegeben.`, `${name} has ${n - 1} digits plus a check digit – you entered ${d.length}.`);
    const c = gs1Check(d.slice(0, -1));
    if (c !== +d.at(-1)) throw bad(`Die Prüfziffer stimmt nicht: Richtig wäre ${c} (${d.slice(0, -1)}${c}). Prüf die Nummer oder lass die letzte Ziffer weg.`,
      `The check digit is wrong: it should be ${c} (${d.slice(0, -1)}${c}). Check the number or leave out the last digit.`);
    return { data: d, text: d, note: { de: 'Prüfziffer stimmt.', en: 'Check digit is correct.' } };
  }
  if (type === 'code128') {
    if (!s) throw bad('Gib den Text oder die Nummer ein.', 'Enter the text or number.');
    const badc = [...new Set([...s].filter(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) > 126))];
    if (badc.length) throw bad(`Code 128 kann hier nur ASCII-Zeichen (ohne Umlaute) – nicht möglich: ${badc.join(' ')}`, `Code 128 can only hold ASCII characters here – not possible: ${badc.join(' ')}`);
    if (s.length > 80) throw bad('Maximal 80 Zeichen – längere Barcodes werden zu breit zum Scannen.', 'At most 80 characters – longer barcodes get too wide to scan.');
    return { data: s, text: s };
  }
  if (type === 'code39') {
    const up = s.toUpperCase();
    if (!up.trim()) throw bad('Gib den Text oder die Nummer ein.', 'Enter the text or number.');
    const badc = [...new Set([...up].filter(c => !C39_CHARS.includes(c)))];
    if (badc.length) throw bad(`Code 39 kennt nur A–Z, 0–9, Leerzeichen und - . $ / + % – nicht möglich: ${badc.join(' ')}`, `Code 39 only knows A–Z, 0–9, space and - . $ / + % – not possible: ${badc.join(' ')}`);
    if (up.length > 40) throw bad('Maximal 40 Zeichen – längere Barcodes werden zu breit zum Scannen.', 'At most 40 characters – longer barcodes get too wide to scan.');
    const data = o.check39 ? up + mod43(up) : up;
    const note = up !== s ? { de: 'Code 39 kennt keine Kleinbuchstaben – es werden Großbuchstaben verwendet.', en: 'Code 39 has no lower case – capital letters are used.' } : null;
    return { data, text: up, note };
  }
  throw bad('Unbekannter Typ.', 'Unknown type.');
}

// ---------------------------------------------------------------- Code 128 values (shortest mix of B and C)
export function code128Values(text) {
  const n = text.length;
  const isD = i => i < n && text.charCodeAt(i) >= 48 && text.charCodeAt(i) <= 57;
  // cost[i][s] = symbols needed to encode text[i:] when currently in set s (0 = B, 1 = C)
  const cost = Array.from({ length: n + 1 }, () => [0, 0]);
  const step = Array.from({ length: n + 1 }, () => [null, null]);
  for (let i = n - 1; i >= 0; i--) {
    const pair = isD(i) && isD(i + 1);
    // in B: encode one char (or switch to C)
    let b = 1 + cost[i + 1][0], bs = 'B';
    if (pair && 2 + cost[i + 2][1] < b) { b = 2 + cost[i + 2][1]; bs = 'toC'; }
    // in C: encode a digit pair, otherwise switch to B
    let c = 1 + b, cs = 'toB';
    if (pair && 1 + cost[i + 2][1] <= c) { c = 1 + cost[i + 2][1]; cs = 'C'; }
    cost[i] = [b, c]; step[i] = [bs, cs];
  }
  let set = n >= 2 && isD(0) && isD(1) && cost[0][1] <= cost[0][0] ? 1 : 0;
  const vals = [set ? 105 : 104];
  for (let i = 0; i < n;) {
    const st = step[i][set];
    if (st === 'B') { vals.push(text.charCodeAt(i) - 32); i += 1; }
    else if (st === 'C') { vals.push(+text.slice(i, i + 2)); i += 2; }
    else if (st === 'toC') { vals.push(99); set = 1; }
    else { vals.push(100); set = 0; }
  }
  let sum = vals[0];
  for (let i = 1; i < vals.length; i++) sum += i * vals[i];
  vals.push(sum % 103, 106);
  return vals;
}

// ---------------------------------------------------------------- symbol layout (module units)
const bitsToBars = (bits, x0) => {
  const bars = [];
  for (let i = 0; i < bits.length; i++) if (bits[i] === '1') {
    const last = bars.at(-1);
    if (last && last.x + last.w === x0 + i) last.w++; else bars.push({ x: x0 + i, w: 1 });
  }
  return bars;
};
const widthsToBars = (widths, x0) => {
  const bars = [];
  let x = x0;
  widths.forEach((w, i) => { if (i % 2 === 0) bars.push({ x, w }); x += w; });
  return { bars, end: x };
};
const nw = s => [...s].map(c => (c === 'w' ? WIDE : 1));

/**
 * → { type, data, width, quiet: [l, r], bars: [{x, w, guard?}], text: [{x, s, anchor: 'start'|'middle'|'end', small?}], bearer }
 * x/w in modules, from the left edge including the quiet zone.
 */
export function encode(type, data, o = {}) {
  if (type === 'ean13' || type === 'upca') {
    const d = type === 'upca' ? '0' + data : data;
    const q = type === 'upca' ? 9 : 11;
    let bits = '101';
    for (let i = 1; i <= 6; i++) bits += (PARITY[+d[0]][i - 1] === 'L' ? L : G)[+d[i]];
    bits += '01010';
    for (let i = 7; i <= 12; i++) bits += R[+d[i]];
    bits += '101';
    const guardBits = new Set();
    for (const i of [0, 1, 2, 45, 46, 47, 48, 49, 92, 93, 94]) guardBits.add(i);
    if (type === 'upca') { for (let i = 3; i < 10; i++) guardBits.add(i); for (let i = 85; i < 92; i++) guardBits.add(i); }
    const bars = bitsToBars(bits, q).map(b => ({ ...b, guard: guardBits.has(b.x - q) }));
    const text = [];
    if (type === 'ean13') {
      text.push({ x: q - 2, s: d[0], anchor: 'end' });
      for (let i = 1; i <= 6; i++) text.push({ x: q + 3 + (i - 1) * 7 + 3.5, s: d[i], anchor: 'middle' });
      for (let i = 7; i <= 12; i++) text.push({ x: q + 50 + (i - 7) * 7 + 3.5, s: d[i], anchor: 'middle' });
    } else {
      text.push({ x: q - 2, s: data[0], anchor: 'end', small: true });
      for (let i = 1; i <= 5; i++) text.push({ x: q + 10 + (i - 1) * 7 + 3.5, s: data[i], anchor: 'middle' });
      for (let i = 6; i <= 10; i++) text.push({ x: q + 50 + (i - 6) * 7 + 3.5, s: data[i], anchor: 'middle' });
      text.push({ x: q + 95 + 2, s: data[11], anchor: 'start', small: true });
    }
    return { type, data, width: q + 95 + (type === 'upca' ? 9 : 7), quiet: [q, type === 'upca' ? 9 : 7], bars, text, ean: true };
  }
  if (type === 'ean8') {
    const q = 7;
    let bits = '101';
    for (let i = 0; i < 4; i++) bits += L[+data[i]];
    bits += '01010';
    for (let i = 4; i < 8; i++) bits += R[+data[i]];
    bits += '101';
    const guard = new Set([0, 1, 2, 31, 32, 33, 34, 35, 64, 65, 66]);
    const bars = bitsToBars(bits, q).map(b => ({ ...b, guard: guard.has(b.x - q) }));
    const text = [];
    for (let i = 0; i < 4; i++) text.push({ x: q + 3 + i * 7 + 3.5, s: data[i], anchor: 'middle' });
    for (let i = 4; i < 8; i++) text.push({ x: q + 36 + (i - 4) * 7 + 3.5, s: data[i], anchor: 'middle' });
    return { type, data, width: q + 67 + q, quiet: [q, q], bars, text, ean: true };
  }
  let widths;
  const q = 10;
  if (type === 'code128') widths = code128Values(data).flatMap(v => [...C128[v]].map(Number));
  else if (type === 'code39') {
    widths = [];
    [...('*' + data + '*')].forEach((c, i, a) => { widths.push(...nw(C39[c])); if (i < a.length - 1) widths.push(1); });
  } else if (type === 'itf14') {
    widths = [1, 1, 1, 1];
    for (let i = 0; i < data.length; i += 2) {
      const a = ITF[+data[i]], b = ITF[+data[i + 1]];
      for (let k = 0; k < 5; k++) widths.push(a[k] === 'w' ? WIDE : 1, b[k] === 'w' ? WIDE : 1);
    }
    widths.push(WIDE, 1, 1);
  } else throw new Error('unknown type ' + type);
  const { bars, end } = widthsToBars(widths, q);
  const shown = o.text ?? data;
  return { type, data, width: end + q, quiet: [q, q], bars, text: [{ x: (q + end) / 2, s: shown, anchor: 'middle' }], bearer: type === 'itf14' && !!o.bearer };
}

// ---------------------------------------------------------------- reading back (self-test)
/** Run lengths of a boolean row (true = dark), as [{dark, len}]. */
export function runsOf(row) {
  const runs = [];
  for (const v of row) { const last = runs.at(-1); if (last && last.dark === v) last.len++; else runs.push({ dark: v, len: 1 }); }
  return runs;
}

/** Bar/space widths of the symbol in a row: drop quiet zones and bearer bars at the edges. */
export function symbolWidths(row) {
  let runs = runsOf(row);
  const trim = () => {
    while (runs.length && !runs[0].dark) runs.shift();
    while (runs.length && !runs.at(-1).dark) runs.pop();
  };
  trim();
  if (runs.length < 5) return null;
  const narrow = Math.min(...runs.map(r => r.len));
  // a vertical bearer bar is separated from the symbol by a quiet zone (≥ 8 narrow modules)
  if (runs.length > 2 && !runs[1].dark && runs[1].len >= 8 * narrow) { runs = runs.slice(2); trim(); }
  if (runs.length > 2 && !runs.at(-2).dark && runs.at(-2).len >= 8 * narrow) { runs = runs.slice(0, -2); trim(); }
  return runs.map(r => r.len);
}

const modulesOf = (w, total) => { const sum = w.reduce((a, b) => a + b, 0); return w.map(x => Math.round(x * total / sum)); };
const wideNarrow = w => { const mn = Math.min(...w), mx = Math.max(...w); const th = (mn + mx) / 2; return w.map(x => (x > th ? 'w' : 'n')); };

function decodeEan(w, type) {
  const n = type === 'ean8' ? 4 : 6;
  if (w.length !== 3 + 4 * n + 5 + 4 * n + 3) return null;
  const m = modulesOf(w, type === 'ean8' ? 67 : 95);
  const digitAt = (k, tables) => {
    const ws = m.slice(k, k + 4);
    if (ws.reduce((a, b) => a + b, 0) !== 7) return null;
    // left digits start with a space, right digits with a bar
    const first = k < 3 + 4 * n ? '0' : '1';
    let bits = '', on = first;
    for (const x of ws) { bits += on.repeat(x); on = on === '1' ? '0' : '1'; }
    for (const [name, t] of tables) { const i = t.indexOf(bits); if (i >= 0) return [name, i]; }
    return null;
  };
  let parity = '', digits = '';
  for (let i = 0; i < n; i++) {
    const r = digitAt(3 + i * 4, type === 'ean8' ? [['L', L]] : [['L', L], ['G', G]]);
    if (!r) return null;
    parity += r[0]; digits += r[1];
  }
  for (let i = 0; i < n; i++) {
    const r = digitAt(3 + 4 * n + 5 + i * 4, [['R', R]]);
    if (!r) return null;
    digits += r[1];
  }
  if (type !== 'ean8') {
    const f = PARITY.indexOf(parity);
    if (f < 0) return null;
    digits = f + digits;
  }
  if (gs1Check(digits.slice(0, -1)) !== +digits.at(-1)) return null;
  if (type === 'upca') return digits[0] === '0' ? digits.slice(1) : null;
  return digits;
}

function decode128(w) {
  if ((w.length - 7) % 6 !== 0 || w.length < 19) return null;
  const k = (w.length - 7) / 6;
  const m = modulesOf(w, 11 * k + 13);
  const vals = [];
  for (let i = 0; i < k; i++) {
    const p = m.slice(i * 6, i * 6 + 6).join('');
    const v = C128.indexOf(p);
    if (v < 0 || v > 105) return null;
    vals.push(v);
  }
  if (m.slice(k * 6).join('') !== C128[106]) return null;
  let sum = vals[0];
  for (let i = 1; i < vals.length - 1; i++) sum += i * vals[i];
  if (sum % 103 !== vals.at(-1)) return null;
  let set = { 103: 'A', 104: 'B', 105: 'C' }[vals[0]];
  if (!set) return null;
  let out = '';
  for (const v of vals.slice(1, -1)) {
    if (set === 'C') { if (v < 100) out += String(v).padStart(2, '0'); else if (v === 100) set = 'B'; else if (v === 101) set = 'A'; else return null; }
    else if (set === 'B') { if (v < 96) out += String.fromCharCode(v + 32); else if (v === 99) set = 'C'; else if (v === 101) set = 'A'; else return null; }
    else { if (v < 64) out += String.fromCharCode(v + 32); else if (v < 96) out += String.fromCharCode(v - 64); else if (v === 99) set = 'C'; else if (v === 100) set = 'B'; else return null; }
  }
  return out;
}

function decode39(w, check39) {
  if ((w.length + 1) % 10 !== 0) return null;
  const c = wideNarrow(w);
  const rev = Object.fromEntries(Object.entries(C39).map(([k, v]) => [v, k]));
  let s = '';
  for (let i = 0; i < c.length; i += 10) {
    const ch = rev[c.slice(i, i + 9).join('')];
    if (!ch) return null;
    if (i + 9 < c.length && c[i + 9] !== 'n') return null;
    s += ch;
  }
  if (s[0] !== '*' || s.at(-1) !== '*' || s.length < 3) return null;
  s = s.slice(1, -1);
  if (check39) { if (mod43(s.slice(0, -1)) !== s.at(-1)) return null; }
  return s;
}

function decodeItf(w) {
  if ((w.length - 7) % 10 !== 0) return null;
  const c = wideNarrow(w);
  if (c.slice(0, 4).join('') !== 'nnnn' || c.slice(-3).join('') !== 'wnn') return null;
  let s = '';
  for (let i = 4; i < c.length - 3; i += 10) {
    const a = [], b = [];
    for (let k = 0; k < 5; k++) { a.push(c[i + 2 * k]); b.push(c[i + 2 * k + 1]); }
    const da = ITF.indexOf(a.join('')), db = ITF.indexOf(b.join(''));
    if (da < 0 || db < 0) return null;
    s += da + '' + db;
  }
  return s;
}

/** Decode a scanline (array of booleans, true = dark) as `type` → data string or null. */
export function decodeRow(type, row, o = {}) {
  const w = symbolWidths(row);
  if (!w) return null;
  if (type === 'ean13' || type === 'ean8' || type === 'upca') return decodeEan(w, type);
  if (type === 'code128') return decode128(w);
  if (type === 'code39') return decode39(w, !!o.check39);
  if (type === 'itf14') { const s = decodeItf(w); return s && s.length === 14 && gs1Check(s.slice(0, -1)) === +s.at(-1) ? s : null; }
  return null;
}
