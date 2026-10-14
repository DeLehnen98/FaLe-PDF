// Tabellen-Operationen ohne DOM: AutoAusfüllen (Reihen), Zwischenablage-Parsing, Text in Spalten, Duplikate, Pivot.
import { compareValues, serialToDate, dateToSerial } from './formula.js';
import { formatKind } from './workbook.js';

const DAY = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const DAY_S = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MON = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MON_S = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const DAY_EN = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_EN_S = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MON_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON_EN_S = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const FILL_LISTS = [DAY, DAY_S, MON, MON_S, DAY_EN, DAY_EN_S, MON_EN, MON_EN_S];

function listMatch(s) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  const lo = t.toLocaleLowerCase('de');
  for (let li = 0; li < FILL_LISTS.length; li++) {
    const i = FILL_LISTS[li].findIndex(x => x.toLocaleLowerCase('de') === lo);
    if (i >= 0) {
      const caseMode = t === t.toLocaleUpperCase('de') && t.length > 1 ? 'upper' : t === t.toLocaleLowerCase('de') ? 'lower' : 'normal';
      return { li, i, caseMode };
    }
  }
  if (lo === 'mrz') return { li: 3, i: 2, caseMode: 'normal' };
  return null;
}
const applyCase = (s, m) => (m === 'upper' ? s.toLocaleUpperCase('de') : m === 'lower' ? s.toLocaleLowerCase('de') : s);
/** Text with a trailing (or leading) integer: "Artikel 7", "Q1", "3. Quartal". */
function textNumber(s) {
  if (typeof s !== 'string') return null;
  let m = /^(.*?)(\d+)(\D*)$/.exec(s);
  if (m && (m[1] || m[3])) return { pre: m[1], n: +m[2], post: m[3], width: m[2].length };
  return null;
}
const isDateCell = cell => cell && typeof cell.v === 'number' && !cell.f && /^(date|time)$/.test(formatKind(cell.s && cell.s.fmt));

function lsq(xs) {
  const n = xs.length;
  const mx = (n - 1) / 2;
  const my = xs.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  xs.forEach((y, i) => { num += (i - mx) * (y - my); den += (i - mx) ** 2; });
  const slope = den ? num / den : 0;
  return { slope, at: i => my + slope * (i - mx) };
}
const tame = x => +(+x).toPrecision(15);

/**
 * Plan an AutoFill. src: source cells in fill order (cell objects or null). n: number of target cells.
 * forward: true when filling down/right. Returns n entries: { src: index } (copy that source cell, shifting formulas)
 * or { v, src } (new value; style of source index src is kept).
 */
export function planFill(src, n, { forward = true, series = true } = {}) {
  const L = src.length;
  const out = [];
  const idx = k => (forward ? k % L : (L - 1 - (k % L)));
  const pos = k => (forward ? L + k : -1 - k); // position in the virtual sequence
  const vals = src.map(c => (c ? c.v : null));
  const allNum = series && L >= 1 && src.every(c => c && !c.f && typeof c.v === 'number');
  // dates
  if (series && src.every(isDateCell)) {
    if (L === 1) { for (let k = 0; k < n; k++) out.push({ v: vals[0] + (forward ? k + 1 : -(k + 1)), src: 0 }); return out; }
    const d0 = serialToDate(vals[0]), d1 = serialToDate(vals[1]);
    const monthDiff = (d1.getUTCFullYear() - d0.getUTCFullYear()) * 12 + d1.getUTCMonth() - d0.getUTCMonth();
    const sameDay = d0.getUTCDate() === d1.getUTCDate();
    const regular = vals.every((v, i) => i === 0 || Math.abs(v - vals[i - 1] - (vals[1] - vals[0])) < 1e-9);
    if (sameDay && monthDiff && vals.every((v, i) => { const d = serialToDate(v); return d.getUTCDate() === d0.getUTCDate() && ((d.getUTCFullYear() - d0.getUTCFullYear()) * 12 + d.getUTCMonth() - d0.getUTCMonth()) === i * monthDiff; })) {
      for (let k = 0; k < n; k++) {
        const p = pos(k);
        const tm = d0.getUTCMonth() + p * monthDiff;
        const y = d0.getUTCFullYear() + Math.floor(tm / 12), m = ((tm % 12) + 12) % 12;
        const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
        out.push({ v: (Date.UTC(y, m, Math.min(d0.getUTCDate(), dim)) - Date.UTC(1899, 11, 30)) / 86400000 + (vals[0] % 1), src: idx(k) });
      }
      return out;
    }
    if (regular) { const step = vals[1] - vals[0]; for (let k = 0; k < n; k++) out.push({ v: tame(vals[0] + pos(k) * step), src: idx(k) }); return out; }
  }
  if (allNum) {
    if (L === 1) { for (let k = 0; k < n; k++) out.push({ src: 0 }); return out; }
    const f = lsq(vals);
    for (let k = 0; k < n; k++) out.push({ v: tame(f.at(pos(k))), src: idx(k) });
    return out;
  }
  // lists (weekdays, months)
  if (series && L >= 1 && src.every(c => c && !c.f && listMatch(c.v))) {
    const ms = src.map(c => listMatch(c.v));
    if (ms.every(m => m.li === ms[0].li)) {
      const list = FILL_LISTS[ms[0].li], len = list.length;
      const step = L > 1 ? ((ms[1].i - ms[0].i) % len + len) % len || 1 : 1;
      for (let k = 0; k < n; k++) { const p = pos(k); out.push({ v: applyCase(list[(((ms[0].i + p * step) % len) + len) % len], ms[0].caseMode), src: idx(k) }); }
      return out;
    }
  }
  // text with numbers
  if (series && L >= 1 && src.every(c => c && !c.f && textNumber(c.v))) {
    const ts = src.map(c => textNumber(c.v));
    if (ts.every(t => t.pre === ts[0].pre && t.post === ts[0].post)) {
      const step = L > 1 ? ts[1].n - ts[0].n : 1;
      const quarter = /^Q$/i.test(ts[0].pre) && !ts[0].post && ts.every(t => t.n >= 1 && t.n <= 4);
      for (let k = 0; k < n; k++) {
        let v = ts[0].n + pos(k) * step;
        if (quarter) v = ((v - 1) % 4 + 4) % 4 + 1;
        if (v < 0) v = Math.abs(v);
        out.push({ v: ts[0].pre + String(v).padStart(ts[0].width, '0') + ts[0].post, src: idx(k) });
      }
      return out;
    }
  }
  for (let k = 0; k < n; k++) out.push({ src: idx(k) });
  return out;
}

/** "Reihe" dialog: linear/geometric/date series from a start value. unit for dates: day|weekday|month|year */
export function makeSeries(start, step, count, { type = 'linear', unit = 'day', stop = null } = {}) {
  const out = [];
  let v = start;
  for (let i = 0; i < count; i++) {
    if (stop !== null && stop !== undefined && (step >= 0 ? v > stop : v < stop)) break;
    out.push(tame(v));
    if (type === 'growth') v = v * step;
    else if (type === 'date') {
      if (unit === 'day') v += step;
      else if (unit === 'weekday') { let k = Math.abs(step); const dir = Math.sign(step) || 1; while (k > 0) { v += dir; const wd = serialToDate(v).getUTCDay(); if (wd !== 0 && wd !== 6) k--; } }
      else { const d = serialToDate(v); const months = unit === 'year' ? step * 12 : step; const tm = d.getUTCMonth() + months; const y = d.getUTCFullYear() + Math.floor(tm / 12), m = ((tm % 12) + 12) % 12; const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); v = (Date.UTC(y, m, Math.min(d.getUTCDate(), dim)) - Date.UTC(1899, 11, 30)) / 86400000; }
    } else v = v + step;
  }
  return out;
}

// ---------------- clipboard ----------------
/** Tab separated text (as copied from spreadsheet apps) → rows of strings. Quoted fields may contain tabs/newlines. */
export function parseTsv(text) {
  const s = String(text).replace(/\r\n?/g, '\n').replace(/\n$/, '');
  const rows = [];
  let row = [], cur = '', i = 0, q = false;
  while (i < s.length) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cur += '"'; i += 2; continue; }
      if (ch === '"') { q = false; i++; continue; }
      cur += ch; i++; continue;
    }
    if (ch === '"' && cur === '') { q = true; i++; continue; }
    if (ch === '\t') { row.push(cur); cur = ''; i++; continue; }
    if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; i++; continue; }
    cur += ch; i++;
  }
  row.push(cur);
  rows.push(row);
  return rows;
}
/** Grid → TSV text (quotes cells containing tabs, newlines or quotes). */
export function toTsv(rows) {
  return rows.map(r => r.map(v => { const s = String(v ?? ''); return /[\t\n"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join('\t')).join('\n');
}

/** HTML table (from web pages, Excel, Google Sheets) → { rows: [[{text, b, i, color, fill, align}]] } or null. Needs DOMParser. */
export function parseHtmlTable(html) {
  if (!html || !/<table/i.test(html) || typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return null;
  const rows = [];
  const occupied = [];
  Array.from(table.rows).forEach((tr, ri) => {
    occupied[ri] = occupied[ri] || [];
    const row = rows[ri] = rows[ri] || [];
    let c = 0;
    Array.from(tr.cells).forEach(td => {
      while (occupied[ri][c]) c++;
      const text = (td.innerText !== undefined && td.innerText !== '' ? td.innerText : td.textContent || '').replace(/ /g, ' ').replace(/\s*\n\s*/g, '\n').trim();
      const st = td.getAttribute('style') || '';
      const cs = Math.max(1, +td.getAttribute('colspan') || 1), rs = Math.max(1, +td.getAttribute('rowspan') || 1);
      const fmt = {};
      if (/font-weight:\s*(bold|[6-9]00)/i.test(st) || td.tagName === 'TH' || td.querySelector('b,strong')) fmt.b = true;
      if (/font-style:\s*italic/i.test(st) || td.querySelector('i,em')) fmt.i = true;
      const bg = /background(?:-color)?:\s*(#[0-9a-f]{6}|#[0-9a-f]{3}|rgb\([^)]*\))/i.exec(st);
      if (bg && !/#fff(fff)?\b|rgb\(255,\s*255,\s*255\)/i.test(bg[1])) fmt.fill = bg[1];
      const col = /(?:^|;)\s*color:\s*(#[0-9a-f]{6}|#[0-9a-f]{3}|rgb\([^)]*\))/i.exec(st);
      if (col && !/#000(000)?\b|rgb\(0,\s*0,\s*0\)/i.test(col[1])) fmt.color = col[1];
      const al = /text-align:\s*(left|center|right)/i.exec(st) || (td.getAttribute('align') ? [0, td.getAttribute('align')] : null);
      if (al) fmt.align = String(al[1]).toLowerCase();
      row[c] = { text, ...fmt, ...(cs > 1 || rs > 1 ? { span: { r: rs, c: cs } } : {}) };
      for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) { occupied[ri + dr] = occupied[ri + dr] || []; occupied[ri + dr][c + dc] = true; }
      c += cs;
    });
  });
  const w = Math.max(0, ...rows.map(r => r.length));
  return { rows: rows.map(r => Array.from({ length: w }, (_, i) => r[i] || { text: '' })) };
}

// ---------------- text to columns ----------------
/** Split text by delimiters. delims: array of single characters; merge: treat consecutive delimiters as one; quote: text qualifier. */
export function splitText(text, { delims = [';'], merge = false, quote = '"' } = {}) {
  const s = String(text ?? '');
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote && ch === quote) { if (q && s[i + 1] === quote) { cur += quote; i++; continue; } q = !q; continue; }
    if (!q && delims.includes(ch)) {
      out.push(cur); cur = '';
      if (merge) while (i + 1 < s.length && delims.includes(s[i + 1])) i++;
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}
/** Fixed-width split at character positions (sorted ascending). */
export function splitFixed(text, positions) {
  const s = String(text ?? '');
  const out = [];
  let last = 0;
  for (const p of positions) { out.push(s.slice(last, p).trim()); last = p; }
  out.push(s.slice(last).trim());
  return out;
}

// ---------------- duplicates ----------------
/** rows: array of arrays of values; cols: column indices to compare. Returns the indices of rows that are duplicates of an earlier row. */
export function duplicateRows(rows, cols) {
  const seen = new Set();
  const dups = [];
  const key = v => (v === null || v === undefined ? '' : typeof v === 'string' ? 's' + v.trim().toLocaleLowerCase('de') : typeof v + String(v && v.code ? v.code : v));
  rows.forEach((row, i) => {
    const k = cols.map(c => key(row[c])).join('\u0001');
    if (seen.has(k)) dups.push(i); else seen.add(k);
  });
  return dups;
}

// ---------------- pivot ----------------
export const PIVOT_AGG = [
  { id: 'sum', label: 'Summe' }, { id: 'count', label: 'Anzahl' }, { id: 'avg', label: 'Mittelwert' }, { id: 'min', label: 'Min' }, { id: 'max', label: 'Max' },
];
const aggLabel = id => (PIVOT_AGG.find(a => a.id === id) || PIVOT_AGG[0]).label;
function aggregate(list, agg) {
  const nums = list.filter(v => typeof v === 'number');
  switch (agg) {
    case 'count': return list.filter(v => v !== null && v !== undefined && v !== '').length;
    case 'avg': return nums.length ? tame(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
    case 'min': return nums.length ? Math.min(...nums) : null;
    case 'max': return nums.length ? Math.max(...nums) : null;
    default: return tame(nums.reduce((a, b) => a + b, 0));
  }
}
const pkey = v => (v === null || v === undefined || v === '' ? '(Leer)' : typeof v === 'string' ? v : String(v));
/**
 * Pivot table. data: rows of values, first row = header. def: { rows:[col], cols:[col], vals:[{c, agg}], filters:[{c, values:[text]}] }
 * label(v, c): display text for keys (e.g. formatted dates). Returns { grid, header: n (rows), totalRows: [indices], totalCols: [indices], valueCols: [indices] }.
 */
export function computePivot(data, def, label = v => pkey(v)) {
  const head = data[0] || [];
  let body = data.slice(1).filter(r => r.some(v => v !== null && v !== undefined && v !== ''));
  for (const f of def.filters || []) {
    if (!f || !Array.isArray(f.values)) continue;
    const allow = new Set(f.values);
    body = body.filter(r => allow.has(label(r[f.c], f.c)));
  }
  const rowsF = def.rows || [], colsF = def.cols || [], vals = def.vals && def.vals.length ? def.vals : [{ c: null, agg: 'count' }];
  const keyOf = (r, fields) => fields.map(c => label(r[c], c));
  const sortKeys = (a, b, fields) => { for (let i = 0; i < a.raw.length; i++) { const x = compareValues(a.raw[i], b.raw[i]); if (x) return x; } return 0; };
  const uniq = fields => {
    const m = new Map();
    for (const r of body) { const k = keyOf(r, fields); const s = k.join('\u0001'); if (!m.has(s)) m.set(s, { k, raw: fields.map(c => (r[c] === undefined ? null : r[c])) }); }
    return [...m.values()].sort((a, b) => sortKeys(a, b, fields));
  };
  const rowKeys = rowsF.length ? uniq(rowsF) : [{ k: [], raw: [] }];
  const colKeys = colsF.length ? uniq(colsF) : [{ k: [], raw: [] }];
  const vname = v => `${aggLabel(v.agg)} von ${v.c == null ? 'Werte' : head[v.c] ?? ''}`;
  const grid = [];
  // header
  const hdr = rowsF.map(c => String(head[c] ?? ''));
  if (!rowsF.length) hdr.push('');
  const valueCols = [];
  for (const ck of colKeys) for (const v of vals) { hdr.push(colsF.length ? ck.k.join(' / ') + (vals.length > 1 ? ` – ${vname(v)}` : '') : vname(v)); valueCols.push(hdr.length - 1); }
  if (colsF.length) for (const v of vals) { hdr.push(vals.length > 1 ? `Gesamt – ${vname(v)}` : 'Gesamtergebnis'); valueCols.push(hdr.length - 1); }
  grid.push(hdr);
  const match = (r, fields, k) => fields.every((c, i) => label(r[c], c) === k[i]);
  const totalCols = [];
  if (colsF.length) for (let i = 0; i < vals.length; i++) totalCols.push(hdr.length - vals.length + i);
  for (const rk of rowKeys) {
    const rowsIn = body.filter(r => match(r, rowsF, rk.k));
    const line = rowsF.length ? rk.raw.map(v => (v === null || v === undefined || v === '' ? '(Leer)' : v)) : [vals.length > 1 || colsF.length ? 'Werte' : 'Gesamtergebnis'];
    for (const ck of colKeys) {
      const cell = rowsIn.filter(r => match(r, colsF, ck.k));
      for (const v of vals) line.push(cell.length ? aggregate(cell.map(r => (v.c == null ? 1 : r[v.c])), v.agg) : null);
    }
    if (colsF.length) for (const v of vals) line.push(aggregate(rowsIn.map(r => (v.c == null ? 1 : r[v.c])), v.agg));
    grid.push(line);
  }
  const totalRows = [];
  if (rowsF.length) {
    const line = ['Gesamtergebnis', ...new Array(rowsF.length - 1).fill('')];
    for (const ck of colKeys) { const cell = body.filter(r => match(r, colsF, ck.k)); for (const v of vals) line.push(cell.length ? aggregate(cell.map(r => (v.c == null ? 1 : r[v.c])), v.agg) : null); }
    if (colsF.length) for (const v of vals) line.push(aggregate(body.map(r => (v.c == null ? 1 : r[v.c])), v.agg));
    grid.push(line);
    totalRows.push(grid.length - 1);
  }
  return { grid, header: 1, totalRows, totalCols, valueCols, rowFields: rowsF.length || 1 };
}

export { dateToSerial };
