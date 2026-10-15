// GENERATED – synced copy of js/office/sheetfx.js (app imports → lib/conv-office-shim.js, vendor paths re-based) by scripts/sync-webtools-vendor.mjs.
// Do not edit here: change the source in the app and run `node scripts/sync-webtools-vendor.mjs`.
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
  if (!(sh.notes instanceof Map)) sh.notes = new Map(Array.isArray(sh.notes) ? sh.notes : []);
  if (!(sh.links instanceof Map)) sh.links = new Map(Array.isArray(sh.links) ? sh.links : []);
  if (!(sh.outline instanceof Map)) sh.outline = new Map(Array.isArray(sh.outline) ? sh.outline : []);
  return sh;
}
const inside = (rg, r, c) => rg && r >= rg.r1 && r <= rg.r2 && c >= rg.c1 && c <= rg.c2;
const valOf = cell => (cell ? (cell.f ? cell.cv : cell.v) : null);
const toNum = s => { const n = parseFloat(String(s ?? '').replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };

// ---------------- bedingte Formatierung ----------------
export const CF_TYPES = [
  { id: 'gt', label: 'Größer als' }, { id: 'lt', label: 'Kleiner als' }, { id: 'ge', label: 'Größer oder gleich' }, { id: 'le', label: 'Kleiner oder gleich' },
  { id: 'between', label: 'Zwischen' }, { id: 'eq', label: 'Gleich' }, { id: 'ne', label: 'Ungleich' }, { id: 'contains', label: 'Text enthält' },
  { id: 'top', label: 'Obere Werte (Top N)' }, { id: 'bottom', label: 'Untere Werte (N kleinste)' }, { id: 'aboveAvg', label: 'Über dem Durchschnitt' }, { id: 'belowAvg', label: 'Unter dem Durchschnitt' },
  { id: 'dup', label: 'Doppelte Werte' }, { id: 'unique', label: 'Eindeutige Werte' }, { id: 'blank', label: 'Leere Zellen' }, { id: 'notblank', label: 'Nicht leere Zellen' }, { id: 'error', label: 'Fehlerwerte' },
  { id: 'formula', label: 'Formel ist wahr' }, { id: 'scale', label: 'Farbskala' }, { id: 'bar', label: 'Datenbalken' }, { id: 'icons', label: 'Symbolsatz' },
];
/** Rule types that compare with the first value field. */
export const CF_NEEDS_V1 = new Set(['gt', 'lt', 'ge', 'le', 'between', 'eq', 'ne', 'contains', 'top', 'bottom', 'formula']);
export const CF_BARS = [
  { id: 'blue', label: 'Blau', color: '#638EC6' }, { id: 'green', label: 'Grün', color: '#63BE7B' }, { id: 'red', label: 'Rot', color: '#F8696B' },
  { id: 'orange', label: 'Orange', color: '#FFB628' }, { id: 'violet', label: 'Violett', color: '#8E8AF7' },
];
// 3-icon sets: [high, middle, low] (glyph, colour); xlsx names for the file
export const CF_ICONS = [
  { id: 'arrows', label: 'Pfeile', xlsx: '3Arrows', icons: [['▲', '#1E9E5A'], ['▶', '#D99A06'], ['▼', '#C23A4B']] },
  { id: 'traffic', label: 'Ampel', xlsx: '3TrafficLights1', icons: [['●', '#1E9E5A'], ['●', '#E8B400'], ['●', '#C23A4B']] },
  { id: 'symbols', label: 'Symbole', xlsx: '3Symbols', icons: [['✔', '#1E9E5A'], ['!', '#D99A06'], ['✖', '#C23A4B']] },
  { id: 'flags', label: 'Flaggen', xlsx: '3Flags', icons: [['⚑', '#1E9E5A'], ['⚑', '#E8B400'], ['⚑', '#C23A4B']] },
];
export const CF_STYLES = [
  { id: 'red', label: 'Hellrot mit dunkelrotem Text', fill: '#FFC7CE', color: '#9C0006' },
  { id: 'yellow', label: 'Gelb mit dunkelgelbem Text', fill: '#FFEB9C', color: '#9C5700' },
  { id: 'green', label: 'Grün mit dunkelgrünem Text', fill: '#C6EFCE', color: '#006100' },
  { id: 'blue', label: 'Hellblau', fill: '#CDE2FB', color: '#104281' },
  { id: 'bold', label: 'Nur fett', fill: null, color: null, b: true },
  { id: 'gray', label: 'Grau', fill: '#EEEEF3', color: '#6B7194' },
  { id: 'done', label: 'Grau durchgestrichen (erledigt)', fill: '#F1F1F5', color: '#8A8DA6', st: true },
  { id: 'strong', label: 'Kräftiges Blau mit weißem Text', fill: '#5B6EE1', color: '#FFFFFF' },
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
/** Numbers (and all values) of a rule's range – computed once per render and rule. */
function rangeStats(sh, rg) {
  const nums = [], all = [];
  for (let rr = rg.r1; rr <= Math.min(rg.r2, sh.maxR); rr++) for (let cc = rg.c1; cc <= Math.min(rg.c2, sh.maxC); cc++) {
    const x = valOf(sh.cells.get(KEY(rr, cc)));
    if (typeof x === 'number') nums.push(x);
    if (x !== null && x !== undefined && x !== '') all.push(x);
  }
  let mn = Infinity, mx = -Infinity, sum = 0;
  for (const x of nums) { if (x < mn) mn = x; if (x > mx) mx = x; sum += x; }
  return { nums, all, min: mn, max: mx, avg: nums.length ? sum / nums.length : 0 };
}
const keyText = v => (typeof v === 'string' ? 's' + v.toLocaleLowerCase('de') : typeof v + String(v && v.code ? v.code : v));
/**
 * Style overrides from conditional formatting for a cell. cache: a Map reused during one render;
 * cache.evalAt(f, r, c) (optional) evaluates a rule formula for formula rules.
 * Result may contain fill/color/b plus bar: {pct, color, neg} (data bar) and icon: [glyph, colour].
 */
export function cfStyle(sh, r, c, cell, cache) {
  if (!sh.cf || !sh.cf.length) return null;
  let out = null;
  const v = valOf(cell);
  const n = typeof v === 'number' ? v : null;
  for (const rule of sh.cf) {
    let rg = cache && cache.get(rule);
    if (!rg) { rg = { rg: parseRange(rule.range) }; cache && cache.set(rule, rg); }
    if (!inside(rg.rg, r, c)) continue;
    const stats = () => rg.st || (rg.st = rangeStats(sh, rg.rg));
    if (rule.type === 'scale') {
      if (n === null) continue;
      const st = stats();
      const sc = CF_SCALES.find(s => s.id === rule.scale) || CF_SCALES[0];
      const t = st.max > st.min ? (n - st.min) / (st.max - st.min) : 0.5;
      const fill = sc.mid ? (t < 0.5 ? mix(sc.min, sc.mid, t * 2) : mix(sc.mid, sc.max, (t - 0.5) * 2)) : mix(sc.min, sc.max, t);
      out = { ...(out || {}), fill, color: '#1A1A1A' };
      continue;
    }
    if (rule.type === 'bar') {
      if (n === null) continue;
      const st = stats();
      const lo = Math.min(0, st.min), hi = Math.max(0, st.max);
      const pct = hi > lo ? Math.abs(n) / (hi - lo) : 0;
      const zero = hi > lo ? -lo / (hi - lo) : 0;
      out = { ...(out || {}), bar: { pct: Math.max(0, Math.min(1, pct)), zero, neg: n < 0, color: (CF_BARS.find(b => b.id === rule.bar) || CF_BARS[0]).color } };
      continue;
    }
    if (rule.type === 'icons') {
      if (n === null) continue;
      const st = stats();
      const set = CF_ICONS.find(x => x.id === rule.icons) || CF_ICONS[0];
      const t = st.max > st.min ? (n - st.min) / (st.max - st.min) : 1;
      out = { ...(out || {}), icon: set.icons[t >= 0.67 ? 0 : t >= 0.33 ? 1 : 2] };
      continue;
    }
    let hit = false;
    const a = toNum(rule.v1);
    switch (rule.type) {
      case 'gt': hit = n !== null && a !== null && n > a; break;
      case 'lt': hit = n !== null && a !== null && n < a; break;
      case 'ge': hit = n !== null && a !== null && n >= a; break;
      case 'le': hit = n !== null && a !== null && n <= a; break;
      case 'between': { const b = toNum(rule.v2); hit = n !== null && a !== null && b !== null && n >= Math.min(a, b) && n <= Math.max(a, b); break; }
      case 'eq': hit = n !== null && a !== null ? n === a : String(displayOf(cell)).toLowerCase() === String(rule.v1 || '').toLowerCase() && String(rule.v1 || '') !== ''; break;
      case 'ne': hit = n !== null && a !== null ? n !== a : String(displayOf(cell)).toLowerCase() !== String(rule.v1 || '').toLowerCase(); break;
      case 'contains': hit = !!rule.v1 && cell != null && String(displayOf(cell)).toLowerCase().includes(String(rule.v1).toLowerCase()); break;
      case 'top': case 'bottom': {
        if (n === null) break;
        if (rg.thr === undefined) {
          const st = stats();
          const sorted = [...st.nums].sort((x, y) => (rule.type === 'top' ? y - x : x - y));
          const k = Math.max(1, Math.round(rule.percent ? sorted.length * (a || 10) / 100 : (a || 10)));
          rg.thr = sorted[Math.min(sorted.length, k) - 1];
        }
        hit = rg.thr !== undefined && (rule.type === 'top' ? n >= rg.thr : n <= rg.thr);
        break;
      }
      case 'aboveAvg': hit = n !== null && n > stats().avg; break;
      case 'belowAvg': hit = n !== null && n < stats().avg; break;
      case 'dup': case 'unique': {
        if (v === null || v === undefined || v === '') break;
        if (!rg.counts) { rg.counts = new Map(); for (const x of stats().all) { const k = keyText(x); rg.counts.set(k, (rg.counts.get(k) || 0) + 1); } }
        const cnt = rg.counts.get(keyText(v)) || 0;
        hit = rule.type === 'dup' ? cnt > 1 : cnt === 1;
        break;
      }
      case 'blank': hit = v === null || v === undefined || v === ''; break;
      case 'notblank': hit = !(v === null || v === undefined || v === ''); break;
      case 'error': hit = !!(v && typeof v === 'object' && v.code); break;
      case 'formula': {
        if (!cache || !cache.evalAt || !rule.f) break;
        const res = cache.evalAt(rule.f, r - rg.rg.r1, c - rg.rg.c1);
        hit = res === true || (typeof res === 'number' && res !== 0);
        break;
      }
    }
    if (hit) { const st = rule.custom || CF_STYLES.find(s => s.id === rule.style) || CF_STYLES[0]; out = { ...(out || {}), ...(st.fill ? { fill: st.fill } : {}), ...(st.color ? { color: st.color } : {}), ...(st.b ? { b: true } : {}), ...(st.st ? { st: true } : {}) }; }
  }
  return out;
}
/** Short description of a rule for lists. */
export function cfDescribe(rule) {
  const t = (CF_TYPES.find(x => x.id === rule.type) || {}).label || rule.type;
  if (rule.type === 'between') return `${t} ${rule.v1 || ''} und ${rule.v2 || ''}`;
  if (rule.type === 'top' || rule.type === 'bottom') return `${t}: ${rule.v1 || 10}${rule.percent ? ' %' : ''}`;
  if (rule.type === 'formula') return `${t}: =${rule.fd || rule.f || ''}`;
  if (rule.type === 'bar') return `${t} (${(CF_BARS.find(b => b.id === rule.bar) || CF_BARS[0]).label})`;
  if (rule.type === 'icons') return `${t} (${(CF_ICONS.find(b => b.id === rule.icons) || CF_ICONS[0]).label})`;
  if (rule.type === 'scale') return `${t} (${(CF_SCALES.find(b => b.id === rule.scale) || CF_SCALES[0]).label})`;
  return CF_NEEDS_V1.has(rule.type) ? `${t} ${rule.v1 || ''}` : t;
}

// ---------------- Notizen, Links, Seite einrichten ----------------
/** Note of a cell (plain text) or null. */
export const noteAt = (sh, r, c) => (sh.notes && sh.notes.get(KEY(r, c))) || null;
/** Hyperlink of a cell: {url} (web, mail, phone) or {ref} (place in the workbook) or null. */
export const linkAt = (sh, r, c) => (sh.links && sh.links.get(KEY(r, c))) || null;
/** Only harmless link targets are opened: http(s), mailto, tel. */
export function safeUrl(u) {
  const s = String(u || '').trim();
  if (/^(https?:\/\/|mailto:|tel:)/i.test(s)) return s;
  if (/^www\./i.test(s)) return 'https://' + s;
  if (/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(s)) return 'mailto:' + s;
  return null;
}
export const PAGE_DEFAULTS = { orient: 'auto', fit: 'none', grid: true, head: true, area: null, titleRows: null, margins: 'normal', center: false, footer: true, scale: 100 };
export const pageOf = sh => ({ ...PAGE_DEFAULTS, ...(sh.page || {}) });
const shiftKeyMap = (map, axis, at, n, del) => {
  if (!map || !map.size) return map;
  const next = new Map();
  for (const [k, v] of map) {
    let r = Math.floor(k / 16384), c = k % 16384;
    let x = axis === 'r' ? r : c;
    if (!del) { if (x >= at) x += n; } else if (x >= at && x < at + n) continue; else if (x >= at + n) x -= n;
    if (axis === 'r') r = x; else c = x;
    next.set(KEY(r, c), v);
  }
  return next;
};

// ---------------- AutoFilter ----------------
export const EMPTY = '(Leer)';
export function cellText(cell) { const t = cell ? displayOf(cell) : ''; return t === '' ? EMPTY : t; }
/** Test of one custom filter condition. cond: {op, v} with op eq|ne|gt|ge|lt|le|contains|notcontains|begins|ends */
export function testCondition(cell, cond) {
  const v = valOf(cell);
  const t = cellText(cell) === EMPTY ? '' : cellText(cell);
  const n = typeof v === 'number' ? v : null;
  const target = toNum(cond.v);
  const lc = s => String(s ?? '').toLocaleLowerCase('de');
  const wild = s => new RegExp('^' + String(s).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
  switch (cond.op) {
    case 'eq': return target !== null && n !== null && !/[*?]/.test(cond.v) ? n === target : wild(cond.v).test(t);
    case 'ne': return target !== null && n !== null && !/[*?]/.test(cond.v) ? n !== target : !wild(cond.v).test(t);
    case 'gt': return n !== null && target !== null ? n > target : target === null && t !== '' && lc(t) > lc(cond.v);
    case 'ge': return n !== null && target !== null ? n >= target : target === null && t !== '' && lc(t) >= lc(cond.v);
    case 'lt': return n !== null && target !== null ? n < target : target === null && t !== '' && lc(t) < lc(cond.v);
    case 'le': return n !== null && target !== null ? n <= target : target === null && t !== '' && lc(t) <= lc(cond.v);
    case 'contains': return lc(t).includes(lc(cond.v));
    case 'notcontains': return !lc(t).includes(lc(cond.v));
    case 'begins': return lc(t).startsWith(lc(cond.v));
    case 'ends': return lc(t).endsWith(lc(cond.v));
    case 'blank': return t === '';
    case 'notblank': return t !== '';
  }
  return true;
}
export const FILTER_OPS = [
  { id: 'eq', label: 'ist gleich' }, { id: 'ne', label: 'ist nicht gleich' }, { id: 'gt', label: 'ist größer als' }, { id: 'ge', label: 'ist größer oder gleich' },
  { id: 'lt', label: 'ist kleiner als' }, { id: 'le', label: 'ist kleiner oder gleich' }, { id: 'contains', label: 'enthält' }, { id: 'notcontains', label: 'enthält nicht' },
  { id: 'begins', label: 'beginnt mit' }, { id: 'ends', label: 'endet mit' },
];
/** Rows hidden by the AutoFilter. */
export function filterHidden(sh) {
  const out = new Set();
  const af = sh.autoFilter;
  if (!af || !af.filters) return out;
  const rg = parseRange(af.range);
  if (!rg) return out;
  const tests = [];
  for (const [k, f] of Object.entries(af.filters)) {
    const c = +k;
    if (Array.isArray(f)) { const set = new Set(f); tests.push(r => set.has(cellText(sh.cells.get(KEY(r, c))))); }
    else if (f && f.custom) tests.push(r => { const cell = sh.cells.get(KEY(r, c)); const res = f.custom.map(cd => testCondition(cell, cd)); return f.and ? res.every(Boolean) : res.some(Boolean); });
    else if (f && f.top) {
      const nums = [];
      for (let r = rg.r1 + 1; r <= rg.r2; r++) { const v = valOf(sh.cells.get(KEY(r, c))); if (typeof v === 'number') nums.push(v); }
      nums.sort((a, b) => (f.bottom ? a - b : b - a));
      const k2 = f.percent ? Math.max(1, Math.round(nums.length * f.top / 100)) : f.top;
      const thr = nums[Math.min(nums.length, k2) - 1];
      tests.push(r => { const v = valOf(sh.cells.get(KEY(r, c))); return typeof v === 'number' && thr !== undefined && (f.bottom ? v <= thr : v >= thr); });
    }
  }
  if (!tests.length) return out;
  for (let r = rg.r1 + 1; r <= rg.r2; r++) if (!tests.every(t => t(r))) out.add(r);
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
export const DV_TYPES = [{ id: 'list', label: 'Liste (Dropdown)' }, { id: 'whole', label: 'Ganze Zahl' }, { id: 'decimal', label: 'Dezimalzahl' }, { id: 'date', label: 'Datum' }, { id: 'textLength', label: 'Textlänge' }];
export const DV_OPS = [{ id: 'between', label: 'zwischen' }, { id: 'notBetween', label: 'nicht zwischen' }, { id: 'equal', label: 'gleich' }, { id: 'notEqual', label: 'ungleich' }, { id: 'greaterThan', label: 'größer als' }, { id: 'lessThan', label: 'kleiner als' }, { id: 'greaterThanOrEqual', label: 'größer oder gleich' }, { id: 'lessThanOrEqual', label: 'kleiner oder gleich' }];
/** Is a parsed value allowed by a validation rule? value: parsed cell value, text: raw input. listOf(src) resolves range lists. */
export function dvAllows(dv, value, text, listOf) {
  if (text === '' || value === null || value === undefined) return true;
  const type = dv.type || 'list';
  if (type === 'list') {
    const list = dv.src && listOf ? listOf(dv.src) : dv.list || [];
    return list.some(x => String(x).toLocaleLowerCase('de') === String(text).trim().toLocaleLowerCase('de'));
  }
  let x;
  if (type === 'textLength') x = String(text).length;
  else { if (typeof value !== 'number') return false; x = value; if (type === 'whole' && !Number.isInteger(x)) return false; }
  const a = dvNum(dv.v1, type), b = dvNum(dv.v2, type);
  switch (dv.op || 'between') {
    case 'between': return a !== null && b !== null && x >= Math.min(a, b) && x <= Math.max(a, b);
    case 'notBetween': return a !== null && b !== null && (x < Math.min(a, b) || x > Math.max(a, b));
    case 'equal': return x === a;
    case 'notEqual': return x !== a;
    case 'greaterThan': return x > a;
    case 'lessThan': return x < a;
    case 'greaterThanOrEqual': return x >= a;
    case 'lessThanOrEqual': return x <= a;
  }
  return true;
}
function dvNum(v, type) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  if (type === 'date') { const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s); if (m) return (Date.UTC(+m[3], +m[2] - 1, +m[1]) - Date.UTC(1899, 11, 30)) / 86400000; }
  return toNum(s);
}
export function dvDescribe(dv) {
  const t = (DV_TYPES.find(x => x.id === (dv.type || 'list')) || DV_TYPES[0]).label;
  if ((dv.type || 'list') === 'list') return t;
  const o = (DV_OPS.find(x => x.id === (dv.op || 'between')) || DV_OPS[0]).label;
  return `${t} ${o} ${dv.v1 ?? ''}${/between/i.test(dv.op || 'between') ? ` und ${dv.v2 ?? ''}` : ''}`;
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
  sh.notes = shiftKeyMap(sh.notes, axis, at, n, del);
  sh.links = shiftKeyMap(sh.links, axis, at, n, del);
  if (axis === 'r' && sh.outline.size) {
    const next = new Map();
    for (const [r, lv] of sh.outline) { if (!del) next.set(r >= at ? r + n : r, lv); else if (r < at) next.set(r, lv); else if (r >= at + n) next.set(r - n, lv); }
    sh.outline = next;
  }
  if (sh.page && sh.page.area) { const na = sr(sh.page.area); sh.page = { ...sh.page, area: na }; }
  if (sh.page && sh.page.titleRows && axis === 'r') { const t = sh.page.titleRows; const x = shiftOne({ r1: t.r1, r2: t.r2, c1: 0, c2: 0 }, 'r', at, n, del); sh.page = { ...sh.page, titleRows: x ? { r1: x.r1, r2: x.r2 } : null }; }
  if (axis === 'r' && sh.hiddenRows.size) {
    const next = new Set();
    for (const r of sh.hiddenRows) { if (!del) next.add(r >= at ? r + n : r); else if (r < at) next.add(r); else if (r >= at + n) next.add(r - n); }
    sh.hiddenRows = next;
  }
}

/** Serializable copy for undo. */
export function extrasSnapshot(sh) {
  ensureSheetExtras(sh);
  return JSON.stringify({ charts: sh.charts, cf: sh.cf, dv: sh.dv, autoFilter: sh.autoFilter, hiddenRows: [...sh.hiddenRows], rowH: [...(sh.rowH || new Map())], hiddenColW: sh.hiddenColW || {}, freezeC: sh.freezeC || 0, tabColor: sh.tabColor || null, protect: sh.protect || null, pivot: sh.pivot || null, name: sh.name, notes: [...(sh.notes || new Map())], links: [...(sh.links || new Map())], outline: [...(sh.outline || new Map())], page: sh.page || null });
}
export function restoreExtras(sh, json) {
  const o = JSON.parse(json);
  sh.charts = o.charts; sh.cf = o.cf; sh.dv = o.dv; sh.autoFilter = o.autoFilter; sh.hiddenRows = new Set(o.hiddenRows);
  sh.rowH = new Map(o.rowH || []); sh.hiddenColW = o.hiddenColW || {}; sh.freezeC = o.freezeC || 0; sh.tabColor = o.tabColor || null; sh.protect = o.protect || null; sh.pivot = o.pivot || null;
  if (o.name) sh.name = o.name;
  sh.notes = new Map(o.notes || []); sh.links = new Map(o.links || []); sh.outline = new Map(o.outline || []); sh.page = o.page || null;
}
