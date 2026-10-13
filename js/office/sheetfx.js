// Tabellen-Extras: bedingte Formatierung, AutoFilter, Datenvalidierung (Dropdown), Bereichs-Verschiebung bei Zeilen/Spalten.
import { KEY, displayOf } from './workbook.js';
import { parseRangeAddr, colName } from './formula.js';

export const rangeStr = ({ r1, c1, r2, c2 }) => (r1 === r2 && c1 === c2 ? `${colName(c1)}${r1 + 1}` : `${colName(c1)}${r1 + 1}:${colName(c2)}${r2 + 1}`);
export const parseRange = s => parseRangeAddr(String(s || '').replace(/\$/g, '').toUpperCase());
export function ensureSheetExtras(sh) {
  if (!sh.charts) sh.charts = [];
  if (!sh.cf) sh.cf = [];
  if (!sh.dv) sh.dv = [];
  if (sh.autoFilter === undefined) sh.autoFilter = null;
  if (!(sh.hiddenRows instanceof Set)) sh.hiddenRows = new Set(sh.hiddenRows || []);
  return sh;
}
const inside = (rg, r, c) => rg && r >= rg.r1 && r <= rg.r2 && c >= rg.c1 && c <= rg.c2;
const valOf = cell => (cell ? (cell.f ? cell.cv : cell.v) : null);
const toNum = s => { const n = parseFloat(String(s ?? '').replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

// ---------------- bedingte Formatierung ----------------
export const CF_TYPES = [
  { id: 'gt', label: 'Größer als' }, { id: 'lt', label: 'Kleiner als' }, { id: 'between', label: 'Zwischen' },
  { id: 'eq', label: 'Gleich' }, { id: 'contains', label: 'Text enthält' }, { id: 'scale', label: 'Farbskala' },
];
export const CF_STYLES = [
  { id: 'red', label: 'Hellrot mit dunkelrotem Text', fill: '#FFC7CE', color: '#9C0006' },
  { id: 'yellow', label: 'Gelb mit dunkelgelbem Text', fill: '#FFEB9C', color: '#9C5700' },
  { id: 'green', label: 'Grün mit dunkelgrünem Text', fill: '#C6EFCE', color: '#006100' },
  { id: 'blue', label: 'Hellblau', fill: '#CDE2FB', color: '#104281' },
  { id: 'bold', label: 'Nur fett', fill: null, color: null, b: true },
];
export const CF_SCALES = [
  { id: 'rg', label: 'Rot → Grün', min: '#F8696B', mid: '#FFEB84', max: '#63BE7B' },
  { id: 'gr', label: 'Grün → Rot', min: '#63BE7B', mid: '#FFEB84', max: '#F8696B' },
  { id: 'wb', label: 'Weiß → Blau', min: '#FFFFFF', mid: null, max: '#5A8AC6' },
];
function mix(a, b, t) {
  const p = x => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16));
  const A = p(a), B = p(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('').toUpperCase();
}
/** Style overrides from conditional formatting for a cell. cache: a Map reused during one render. */
export function cfStyle(sh, r, c, cell, cache) {
  if (!sh.cf || !sh.cf.length) return null;
  let out = null;
  for (const rule of sh.cf) {
    let rg = cache && cache.get(rule);
    if (!rg) { rg = { rg: parseRange(rule.range) }; cache && cache.set(rule, rg); }
    if (!inside(rg.rg, r, c)) continue;
    const v = valOf(cell);
    if (rule.type === 'scale') {
      if (typeof v !== 'number') continue;
      if (rg.min === undefined) {
        let mn = Infinity, mx = -Infinity;
        for (let rr = rg.rg.r1; rr <= Math.min(rg.rg.r2, sh.maxR); rr++) for (let cc = rg.rg.c1; cc <= Math.min(rg.rg.c2, sh.maxC); cc++) { const x = valOf(sh.cells.get(KEY(rr, cc))); if (typeof x === 'number') { if (x < mn) mn = x; if (x > mx) mx = x; } }
        rg.min = mn; rg.max = mx;
      }
      const sc = CF_SCALES.find(s => s.id === rule.scale) || CF_SCALES[0];
      const t = rg.max > rg.min ? (v - rg.min) / (rg.max - rg.min) : 0.5;
      const fill = sc.mid ? (t < 0.5 ? mix(sc.min, sc.mid, t * 2) : mix(sc.mid, sc.max, (t - 0.5) * 2)) : mix(sc.min, sc.max, t);
      out = { ...(out || {}), fill, color: '#1A1A1A' };
      continue;
    }
    let hit = false;
    const n = typeof v === 'number' ? v : null;
    if (rule.type === 'gt') hit = n !== null && toNum(rule.v1) !== null && n > toNum(rule.v1);
    else if (rule.type === 'lt') hit = n !== null && toNum(rule.v1) !== null && n < toNum(rule.v1);
    else if (rule.type === 'between') { const a = toNum(rule.v1), b = toNum(rule.v2); hit = n !== null && a !== null && b !== null && n >= Math.min(a, b) && n <= Math.max(a, b); }
    else if (rule.type === 'eq') hit = n !== null && toNum(rule.v1) !== null ? n === toNum(rule.v1) : String(displayOf(cell)).toLowerCase() === String(rule.v1 || '').toLowerCase() && String(rule.v1 || '') !== '';
    else if (rule.type === 'contains') hit = !!rule.v1 && cell != null && String(displayOf(cell)).toLowerCase().includes(String(rule.v1).toLowerCase());
    if (hit) { const st = rule.custom || CF_STYLES.find(s => s.id === rule.style) || CF_STYLES[0]; out = { ...(out || {}), ...(st.fill ? { fill: st.fill } : {}), ...(st.color ? { color: st.color } : {}), ...(st.b ? { b: true } : {}) }; }
  }
  return out;
}

// ---------------- AutoFilter ----------------
export const EMPTY = '(Leer)';
export function cellText(cell) { const t = cell ? displayOf(cell) : ''; return t === '' ? EMPTY : t; }
/** Rows hidden by the AutoFilter. */
export function filterHidden(sh) {
  const out = new Set();
  const af = sh.autoFilter;
  if (!af || !af.filters) return out;
  const rg = parseRange(af.range);
  if (!rg) return out;
  const cols = Object.keys(af.filters).map(Number).filter(c => Array.isArray(af.filters[c]));
  if (!cols.length) return out;
  const sets = cols.map(c => [c, new Set(af.filters[c])]);
  for (let r = rg.r1 + 1; r <= rg.r2; r++) {
    for (const [c, allowed] of sets) if (!allowed.has(cellText(sh.cells.get(KEY(r, c))))) { out.add(r); break; }
  }
  return out;
}
export function columnValues(sh, c) {
  const rg = parseRange(sh.autoFilter && sh.autoFilter.range);
  const counts = new Map();
  if (!rg) return [];
  for (let r = rg.r1 + 1; r <= rg.r2; r++) { const t = cellText(sh.cells.get(KEY(r, c))); counts.set(t, (counts.get(t) || 0) + 1); }
  return [...counts.entries()].map(([text, n]) => ({ text, n })).sort((a, b) => (a.text === EMPTY) - (b.text === EMPTY) || a.text.localeCompare(b.text, 'de', { numeric: true }));
}

// ---------------- Datenvalidierung ----------------
export function validationAt(sh, r, c) {
  if (!sh.dv || !sh.dv.length) return null;
  for (let i = sh.dv.length - 1; i >= 0; i--) if (inside(parseRange(sh.dv[i].range), r, c)) return sh.dv[i];
  return null;
}
export function parseList(text) {
  return String(text || '').split(/[\n;]|,(?!\d)/).map(s => s.trim()).filter(Boolean).slice(0, 200);
}

// ---------------- shifting ranges on insert/delete ----------------
function shiftOne(rg, axis, at, n, del) {
  const a1 = axis === 'r' ? 'r1' : 'c1', a2 = axis === 'r' ? 'r2' : 'c2';
  const x = { ...rg };
  if (!del) {
    if (x[a1] >= at) x[a1] += n;
    if (x[a2] >= at) x[a2] += n;
    return x;
  }
  const end = at + n - 1;
  if (x[a1] >= at && x[a2] <= end) return null; // fully deleted
  const map = v => (v > end ? v - n : v >= at ? at : v);
  x[a1] = map(x[a1]);
  x[a2] = x[a2] > end ? x[a2] - n : x[a2] >= at ? Math.max(x[a1], at - 1) : x[a2];
  if (x[a2] < x[a1]) return null;
  return x;
}
function shiftRef(ref, axis, at, n, del) {
  if (!ref) return ref;
  const m = /^(.+!)?(.*)$/.exec(ref);
  const rg = parseRange(m[2]);
  if (!rg) return ref;
  const x = shiftOne(rg, axis, at, n, del);
  if (!x) return null;
  const abs = (r, c) => `$${colName(c)}$${r + 1}`;
  return (m[1] || '') + (x.r1 === x.r2 && x.c1 === x.c2 ? abs(x.r1, x.c1) : `${abs(x.r1, x.c1)}:${abs(x.r2, x.c2)}`);
}
/** Keep charts, rules, validations, filters and hidden rows in place after row/column insert/delete. */
export function shiftSheetRanges(sh, axis, at, n, del = false) {
  ensureSheetExtras(sh);
  const sr = s => { const rg = parseRange(s); if (!rg) return null; const x = shiftOne(rg, axis, at, n, del); return x ? rangeStr(x) : null; };
  sh.charts = sh.charts.filter(ch => {
    if (ch.range) { const nr = sr(ch.range); if (!nr) return false; ch.range = nr; }
    if (ch.series) ch.series = ch.series.map(s => ({ ...s, cat: s.cat && shiftRef(s.cat, axis, at, n, del), val: shiftRef(s.val, axis, at, n, del), name: s.name && /!/.test(s.name) ? shiftRef(s.name, axis, at, n, del) : s.name })).filter(s => s.val);
    if (axis === 'r') { const rowPx = 28; const ry = Math.floor((ch.y || 0) / rowPx); if (!del && ry >= at) ch.y += n * rowPx; if (del && ry > at + n - 1) ch.y -= n * rowPx; }
    return true;
  });
  sh.cf = sh.cf.map(r => ({ ...r, range: sr(r.range) })).filter(r => r.range);
  sh.dv = sh.dv.map(r => ({ ...r, range: sr(r.range) })).filter(r => r.range);
  if (sh.autoFilter) {
    const nr = sr(sh.autoFilter.range);
    if (!nr) sh.autoFilter = null;
    else {
      const f = {};
      for (const [k, v] of Object.entries(sh.autoFilter.filters || {})) {
        const c = +k;
        if (axis === 'c') { if (del && c >= at && c < at + n) continue; f[c >= at ? (del ? c - n : c + n) : c] = v; } else f[c] = v;
      }
      sh.autoFilter = { range: nr, filters: f };
    }
  }
  if (axis === 'r' && sh.hiddenRows.size) {
    const next = new Set();
    for (const r of sh.hiddenRows) { if (!del) next.add(r >= at ? r + n : r); else if (r < at) next.add(r); else if (r >= at + n) next.add(r - n); }
    sh.hiddenRows = next;
  }
}

/** Serializable copy for undo. */
export function extrasSnapshot(sh) {
  ensureSheetExtras(sh);
  return JSON.stringify({ charts: sh.charts, cf: sh.cf, dv: sh.dv, autoFilter: sh.autoFilter, hiddenRows: [...sh.hiddenRows] });
}
export function restoreExtras(sh, json) {
  const o = JSON.parse(json);
  sh.charts = o.charts; sh.cf = o.cf; sh.dv = o.dv; sh.autoFilter = o.autoFilter; sh.hiddenRows = new Set(o.hiddenRows);
}
