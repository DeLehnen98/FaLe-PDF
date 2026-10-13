// Spreadsheet model: sheets, cells, styles, number formats (German display), recalculation.
import { compile, evaluate, isErr, ERR, ERR_DE, FErr, fmtGeneral, serialToDate, dateToSerial, parseNumberText, shiftRefs, toCanonical } from './formula.js';

export const KEY = (r, c) => r * 16384 + c;
export const R_OF = k => Math.floor(k / 16384);
export const C_OF = k => k % 16384;
export const DEFAULT_COL_W = 92;
export const ROW_H = 28;

export const FORMATS = {
  general: { label: 'Standard', code: 'General' },
  number: { label: 'Zahl', code: '#,##0.00' },
  currency: { label: 'Währung (€)', code: '#,##0.00 "€"' },
  percent: { label: 'Prozent', code: '0.00%' },
  date: { label: 'Datum', code: 'dd.mm.yyyy' },
  text: { label: 'Text', code: '@' },
};

export function newSheet(name) {
  return { name, cells: new Map(), colW: [], merges: [], freeze: 0, maxR: -1, maxC: -1, charts: [], cf: [], dv: [], autoFilter: null, hiddenRows: new Set() };
}
export function newWorkbook() {
  return { sheets: [newSheet('Tabelle1')], date1904: false };
}

export function getCell(sh, r, c) { return sh.cells.get(KEY(r, c)); }
export function setCell(sh, r, c, cell) {
  const k = KEY(r, c);
  if (!cell || (cell.v == null && !cell.f && !cell.s)) { sh.cells.delete(k); return; }
  sh.cells.set(k, cell);
  if (r > sh.maxR) sh.maxR = r;
  if (c > sh.maxC) sh.maxC = c;
}
export function recomputeBounds(sh) {
  let mr = -1, mc = -1;
  for (const k of sh.cells.keys()) { const r = R_OF(k), c = C_OF(k); if (r > mr) mr = r; if (c > mc) mc = c; }
  sh.maxR = mr; sh.maxC = mc;
}

// ---------------- number formats ----------------
export function isDateCode(code) {
  if (!code || code === 'General') return false;
  const c = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[dmyhs]/i.test(c) && !/[#0]/.test(c.replace(/[hms]/gi, '')) && !/^@$/.test(c);
}
export function formatKind(code) {
  if (!code || code === 'General') return 'general';
  if (code === '@') return 'text';
  if (isDateCode(code)) return 'date';
  if (/%/.test(code.replace(/"[^"]*"/g, ''))) return 'percent';
  if (/€|\[\$|"\$"|\$/.test(code)) return 'currency';
  if (/[0#]/.test(code)) return 'number';
  return 'general';
}
function decimalsOf(code) {
  const sec = code.split(';')[0].replace(/"[^"]*"/g, '');
  const m = /\.([0#]+)/.exec(sec);
  return m ? m[1].length : 0;
}
const nf = new Map();
function numFmt(dec, group = true) {
  const k = dec + (group ? 'g' : '');
  if (!nf.has(k)) nf.set(k, new Intl.NumberFormat('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: group }));
  return nf.get(k);
}

/** "General" display like spreadsheet apps: at most ~11 characters for fractions. */
function generalShort(v) {
  let s = fmtGeneral(v);
  if (s.length <= 11 || Number.isInteger(v) || /E/.test(s)) return s;
  const intLen = String(Math.trunc(Math.abs(v))).length + (v < 0 ? 1 : 0);
  const dec = Math.max(0, 10 - intLen);
  return String(+v.toFixed(dec)).replace('.', ',');
}

/** Display text of a value with a format code (German conventions). */
export function formatValue(v, code) {
  if (v === null || v === undefined) return '';
  if (isErr(v)) return ERR_DE[v.code] || v.code;
  if (typeof v === 'boolean') return v ? 'WAHR' : 'FALSCH';
  if (typeof v === 'string') return v;
  if (!Number.isFinite(v)) return '#ZAHL!';
  const kind = formatKind(code);
  switch (kind) {
    case 'general': return generalShort(v);
    case 'text': return fmtGeneral(v);
    case 'date': {
      const c = code.toLowerCase();
      const d = serialToDate(v);
      const pad = n => String(n).padStart(2, '0');
      const hasDate = /[dy]/.test(c) || /m{3,}/.test(c) || (/m/.test(c) && !/h/.test(c));
      const hasTime = /h/.test(c);
      let out = '';
      if (hasDate) {
        if (/mmmm/.test(c)) out = d.toLocaleDateString('de-DE', { timeZone: 'UTC', day: /d/.test(c) ? 'numeric' : undefined, month: 'long', year: /y/.test(c) ? 'numeric' : undefined });
        else if (/mmm/.test(c)) out = d.toLocaleDateString('de-DE', { timeZone: 'UTC', day: /d/.test(c) ? '2-digit' : undefined, month: 'short', year: /y/.test(c) ? (/yyyy/.test(c) ? 'numeric' : '2-digit') : undefined });
        else out = `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${/yyyy|^[^y]*y{3,}/.test(c) || !/yy/.test(c) ? d.getUTCFullYear() : String(d.getUTCFullYear()).slice(2)}`;
      }
      if (hasTime) out += (out ? ' ' : '') + `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${/s/.test(c) ? ':' + pad(d.getUTCSeconds()) : ''}`;
      return out;
    }
    case 'percent': return numFmt(decimalsOf(code), true).format(v * 100) + ' %';
    case 'currency': {
      const sym = /€/.test(code) ? '€' : /\$/.test(code) ? '$' : /£/.test(code) ? '£' : '€';
      const s = numFmt(decimalsOf(code), true).format(Math.abs(v));
      return (v < 0 ? '-' : '') + (sym === '€' ? `${s} €` : `${sym}${s}`);
    }
    case 'number': return numFmt(decimalsOf(code), /#,##|0,0/.test(code)).format(v);
  }
  return fmtGeneral(v);
}

/** Value of a cell for display (computed value for formulas). */
export function displayOf(cell) {
  if (!cell) return '';
  return formatValue(cell.f ? cell.cv : cell.v, cell.s && cell.s.fmt);
}

/** Text shown when editing a cell. */
export function editTextOf(cell, toDisplay) {
  if (!cell) return '';
  if (cell.f) return '=' + toDisplay(cell.f);
  const v = cell.v;
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    const k = formatKind(cell.s && cell.s.fmt);
    if (k === 'date') return formatValue(v, Number.isInteger(v) ? 'dd.mm.yyyy' : 'dd.mm.yyyy hh:mm');
    if (k === 'percent') return fmtGeneral(+(v * 100).toPrecision(15)) + ' %';
    return fmtGeneral(v);
  }
  if (typeof v === 'boolean') return v ? 'WAHR' : 'FALSCH';
  if (isErr(v)) return ERR_DE[v.code] || v.code;
  if (/^=|^[-+]?\d/.test(v) || /^(wahr|falsch|true|false)$/i.test(v)) return "'" + v;
  return v;
}

/** Interpret user input (German conventions). Returns {v, f?, fmt?} or throws SyntaxError for bad formulas. */
export function parseInput(text, currentFmt) {
  const t = String(text);
  if (t === '') return { v: null };
  if (t.startsWith("'")) return { v: t.slice(1) };
  if (t.startsWith('=') && t.length > 1) return { f: toCanonical(t.slice(1)) };
  const s = t.trim();
  if (currentFmt === '@') return { v: t };
  const up = s.toUpperCase();
  if (up === 'WAHR' || up === 'TRUE') return { v: true };
  if (up === 'FALSCH' || up === 'FALSE') return { v: false };
  let m = /^(-?[\d.,\s]+)\s*%$/.exec(s);
  if (m) { const n = parseNumberText(m[1]); if (n !== null) return { v: +(n / 100).toPrecision(15), fmt: formatKind(currentFmt) === 'percent' ? undefined : '0%' }; }
  m = /^(-?[\d.,\s]+)\s*€$|^€\s*(-?[\d.,\s]+)$/.exec(s);
  if (m) { const n = parseNumberText(m[1] || m[2]); if (n !== null) return { v: n, fmt: formatKind(currentFmt) === 'currency' ? undefined : FORMATS.currency.code }; }
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})?(?:\s+(\d{1,2}):(\d{2}))?$/.exec(s);
  if (m) {
    let y = m[3] ? +m[3] : new Date().getFullYear();
    if (y < 100) y += y < 50 ? 2000 : 1900;
    const d = new Date(y, +m[2] - 1, +m[1]);
    if (d.getMonth() === +m[2] - 1) {
      let v = dateToSerial(d);
      if (m[4]) v += (+m[4] * 60 + +m[5]) / 1440;
      return { v, fmt: formatKind(currentFmt) === 'date' ? undefined : (m[4] ? 'dd.mm.yyyy hh:mm' : 'dd.mm.yyyy') };
    }
  }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return { v: dateToSerial(new Date(+m[1], +m[2] - 1, +m[3])), fmt: formatKind(currentFmt) === 'date' ? undefined : 'dd.mm.yyyy' };
  const n = parseNumberText(s);
  if (n !== null && /\d/.test(s)) {
    if (formatKind(currentFmt) === 'percent' && !/%/.test(s)) return { v: n / 100 };
    return { v: n };
  }
  return { v: t };
}

// ---------------- recalculation ----------------
export function makeCtx(wb) {
  const memo = new Map(); // sheet → Map(key → value)
  const busy = new Set();
  const idxByName = new Map(wb.sheets.map((s, i) => [s.name.toLowerCase(), i]));
  const ctx = {
    sheet: 0,
    sheetIndex: name => (idxByName.has(String(name).toLowerCase()) ? idxByName.get(String(name).toLowerCase()) : -1),
    bound: si => ({ maxR: wb.sheets[si].maxR, maxC: wb.sheets[si].maxC }),
    fmt: (v, code) => formatValue(v, code.replace(/T/g, 'd').replace(/J/g, 'y').replace(/,/g, '.')),
    get(si, r, c) {
      const sh = wb.sheets[si];
      if (!sh) return ERR.REF;
      const cell = sh.cells.get(KEY(r, c));
      if (!cell) return null;
      if (!cell.f) return cell.v ?? null;
      const mk = si * 1e11 + KEY(r, c);
      if (memo.has(mk)) return memo.get(mk);
      if (busy.has(mk)) return ERR.CIRC;
      busy.add(mk);
      const prev = ctx.sheet;
      ctx.sheet = si;
      let v;
      try { v = evaluate(compile(cell.f), ctx); } catch (e) { v = e instanceof RangeError ? ERR.CIRC : ERR.VALUE; }
      ctx.sheet = prev;
      busy.delete(mk);
      if (v && v.range) v = ERR.VALUE;
      // unsupported function: keep the value the file was saved with
      if (v === ERR.NAME && cell.cv0 != null) v = cell.cv0;
      memo.set(mk, v);
      cell.cv = v;
      return v;
    },
  };
  return ctx;
}

/** Recalculate all formulas (row-major order keeps recursion shallow). Returns number of formulas. */
export function recalc(wb) {
  const ctx = makeCtx(wb);
  let n = 0;
  wb.sheets.forEach((sh, si) => {
    const keys = [];
    for (const [k, cell] of sh.cells) if (cell.f) keys.push(k);
    keys.sort((a, b) => a - b);
    for (const k of keys) { ctx.get(si, R_OF(k), C_OF(k)); n++; }
  });
  return n;
}

// ---------------- structural edits ----------------
function remapSheetCells(sh, fn) {
  const next = new Map();
  for (const [k, cell] of sh.cells) {
    const to = fn(R_OF(k), C_OF(k));
    if (to) next.set(KEY(to.r, to.c), cell);
  }
  sh.cells = next;
  recomputeBounds(sh);
}

function adjustFormulas(wb, sheetIdx, refFn) {
  const name = wb.sheets[sheetIdx].name.toLowerCase();
  wb.sheets.forEach((sh, si) => {
    for (const cell of sh.cells.values()) {
      if (!cell.f) continue;
      cell.f = shiftRefs(cell.f, (ref, sheet) => {
        const target = sheet == null ? si : wb.sheets.findIndex(s => s.name.toLowerCase() === String(sheet).toLowerCase());
        if (target !== sheetIdx) return ref;
        return refFn(ref);
      });
    }
  });
  void name;
}

export function insertRows(wb, si, at, n = 1) {
  const sh = wb.sheets[si];
  remapSheetCells(sh, (r, c) => ({ r: r >= at ? r + n : r, c }));
  adjustFormulas(wb, si, ref => (ref.colOnly ? ref : { ...ref, r: ref.r >= at ? ref.r + n : ref.r }));
  sh.merges = sh.merges.map(m => ({ ...m, r1: m.r1 >= at ? m.r1 + n : m.r1, r2: m.r2 >= at ? m.r2 + n : m.r2 }));
}
export function deleteRows(wb, si, at, n = 1) {
  const sh = wb.sheets[si];
  remapSheetCells(sh, (r, c) => (r >= at && r < at + n ? null : { r: r >= at + n ? r - n : r, c }));
  adjustFormulas(wb, si, (ref) => {
    if (ref.colOnly) return ref;
    if (ref.r >= at && ref.r < at + n) return null;
    return { ...ref, r: ref.r >= at + n ? ref.r - n : ref.r };
  });
  sh.merges = sh.merges.filter(m => m.r2 < at || m.r1 >= at + n).map(m => ({ ...m, r1: m.r1 >= at + n ? m.r1 - n : m.r1, r2: m.r2 >= at + n ? m.r2 - n : m.r2 }));
}
export function insertCols(wb, si, at, n = 1) {
  const sh = wb.sheets[si];
  remapSheetCells(sh, (r, c) => ({ r, c: c >= at ? c + n : c }));
  adjustFormulas(wb, si, ref => ({ ...ref, c: ref.c >= at ? ref.c + n : ref.c }));
  sh.colW.splice(at, 0, ...new Array(n).fill(undefined));
  sh.merges = sh.merges.map(m => ({ ...m, c1: m.c1 >= at ? m.c1 + n : m.c1, c2: m.c2 >= at ? m.c2 + n : m.c2 }));
}
export function deleteCols(wb, si, at, n = 1) {
  const sh = wb.sheets[si];
  remapSheetCells(sh, (r, c) => (c >= at && c < at + n ? null : { r, c: c >= at + n ? c - n : c }));
  adjustFormulas(wb, si, ref => {
    if (ref.c >= at && ref.c < at + n) return null;
    return { ...ref, c: ref.c >= at + n ? ref.c - n : ref.c };
  });
  sh.colW.splice(at, n);
  sh.merges = sh.merges.filter(m => m.c2 < at || m.c1 >= at + n).map(m => ({ ...m, c1: m.c1 >= at + n ? m.c1 - n : m.c1, c2: m.c2 >= at + n ? m.c2 - n : m.c2 }));
}

/** Sort rows r1..r2 by column c (keeps whole rows together over the used columns). */
export function sortRows(wb, si, r1, r2, c, asc = true, c1 = 0, c2 = null) {
  const sh = wb.sheets[si];
  if (c2 == null) c2 = sh.maxC;
  const rows = [];
  for (let r = r1; r <= r2; r++) {
    const cells = new Map();
    for (let cc = c1; cc <= c2; cc++) { const cell = sh.cells.get(KEY(r, cc)); if (cell) cells.set(cc, cell); }
    const key = cells.get(c);
    rows.push({ cells, v: key ? (key.f ? key.cv : key.v) : null });
  }
  const { compareValues } = SORT;
  rows.sort((a, b) => {
    const ea = a.v === null || a.v === undefined || a.v === '', eb = b.v === null || b.v === undefined || b.v === '';
    if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1; // empty cells last
    const x = compareValues(a.v, b.v);
    return asc ? x : -x;
  });
  for (let r = r1; r <= r2; r++) for (let cc = c1; cc <= c2; cc++) sh.cells.delete(KEY(r, cc));
  rows.forEach((row, i) => row.cells.forEach((cell, cc) => sh.cells.set(KEY(r1 + i, cc), cell)));
}
import { compareValues } from './formula.js';
const SORT = { compareValues };

/** Contiguous data block around a cell (like "current region" in spreadsheet apps). */
export function currentRegion(sh, r, c) {
  const has = (rr, cc) => rr >= 0 && cc >= 0 && sh.cells.has(KEY(rr, cc)) && (() => { const x = sh.cells.get(KEY(rr, cc)); return x.f || (x.v !== null && x.v !== undefined && x.v !== ''); })();
  let r1 = r, r2 = r, c1 = c, c2 = c, grew = true, guard = 0;
  while (grew && guard++ < 10000) {
    grew = false;
    const rowHas = rr => { for (let cc = Math.max(0, c1 - 1); cc <= c2 + 1; cc++) if (has(rr, cc)) return true; return false; };
    const colHas = cc => { for (let rr = Math.max(0, r1 - 1); rr <= r2 + 1; rr++) if (has(rr, cc)) return true; return false; };
    if (r1 > 0 && rowHas(r1 - 1)) { r1--; grew = true; }
    if (r2 < sh.maxR && rowHas(r2 + 1)) { r2++; grew = true; }
    if (c1 > 0 && colHas(c1 - 1)) { c1--; grew = true; }
    if (c2 < sh.maxC && colHas(c2 + 1)) { c2++; grew = true; }
  }
  return { r1, r2, c1, c2 };
}

/** Used range text grid (for search index / CSV). */
export function sheetToRows(sh, { formatted = true } = {}) {
  const rows = [];
  for (let r = 0; r <= sh.maxR; r++) {
    const row = [];
    for (let c = 0; c <= sh.maxC; c++) {
      const cell = sh.cells.get(KEY(r, c));
      row.push(cell ? (formatted ? displayOf(cell) : (cell.f ? cell.cv : cell.v)) : '');
    }
    rows.push(row);
  }
  return rows;
}

export { FErr, isErr };
