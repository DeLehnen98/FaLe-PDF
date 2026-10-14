// GENERATED – synced copy of js/office/workbook.js (app imports → lib/conv-office-shim.js, vendor paths re-based) by scripts/sync-webtools-vendor.mjs.
// Do not edit here: change the source in the app and run `node scripts/sync-webtools-vendor.mjs`.
// Spreadsheet model: sheets, cells, styles, number formats (German display), recalculation with a dependency graph.
import { compile, evaluate, precedents, isErr, isArr, ERR, ERR_DE, FErr, fmtGeneral, serialToDate, dateToSerial, parseNumberText, parseDateText, shiftRefs, toCanonical, compareValues, KNOWN_FUNCTIONS } from './formula.js';
import { formatWithCode, isDateFormat, fmtGeneralDe } from './numfmt.js';

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
  time: { label: 'Uhrzeit', code: 'hh:mm' },
  text: { label: 'Text', code: '@' },
  custom: { label: 'Benutzerdefiniert …', code: null },
};
/** Number format presets for the "format cells" dialog: [canonical code, German label]. */
export const FORMAT_PRESETS = [
  ['General', 'Standard'], ['0', 'Zahl ohne Nachkommastellen'], ['0.00', 'Zahl, 2 Nachkommastellen'], ['#,##0', 'Mit Tausenderpunkt'], ['#,##0.00', 'Tausenderpunkt, 2 Nachkommastellen'],
  ['#,##0.00;[Red]-#,##0.00', 'Negative Zahlen rot'], ['#,##0.00 "€"', 'Währung (€)'], ['#,##0 "€"', 'Währung ohne Cent'], ['#,##0.00 "€";[Red]-#,##0.00 "€"', 'Währung, negativ rot'],
  ['0%', 'Prozent'], ['0.00%', 'Prozent, 2 Nachkommastellen'], ['dd.mm.yyyy', 'Datum (31.12.2026)'], ['dd.mm.yy', 'Datum kurz (31.12.26)'], ['d. mmmm yyyy', 'Datum lang (31. Dezember 2026)'],
  ['dddd, d. mmmm yyyy', 'Mit Wochentag'], ['mmmm yyyy', 'Monat und Jahr'], ['hh:mm', 'Uhrzeit (13:30)'], ['hh:mm:ss', 'Uhrzeit mit Sekunden'], ['[h]:mm', 'Stunden über 24 (Zeiterfassung)'],
  ['dd.mm.yyyy hh:mm', 'Datum und Uhrzeit'], ['0.00E+00', 'Wissenschaftlich'], ['# ?/?', 'Bruch'], ['@', 'Text'], ['00000', 'Postleitzahl (5 Stellen)'],
];
/** Cell styles (Zellenformatvorlagen). */
export const CELL_STYLES = [
  { id: 'standard', label: 'Standard', s: {} },
  { id: 'gut', label: 'Gut', s: { fill: '#C6EFCE', color: '#006100' } },
  { id: 'schlecht', label: 'Schlecht', s: { fill: '#FFC7CE', color: '#9C0006' } },
  { id: 'neutral', label: 'Neutral', s: { fill: '#FFEB9C', color: '#9C5700' } },
  { id: 'ueberschrift1', label: 'Überschrift 1', s: { b: true, size: 15, color: '#1F3864', bd: { b: 'thick' } } },
  { id: 'ueberschrift2', label: 'Überschrift 2', s: { b: true, size: 13, color: '#1F3864', bd: { b: 'medium' } } },
  { id: 'titel', label: 'Titel', s: { b: true, size: 18, color: '#1F3864' } },
  { id: 'summe', label: 'Summe', s: { b: true, bd: { t: true, b: 'double' } } },
  { id: 'eingabe', label: 'Eingabe', s: { fill: '#FFCC99', color: '#3F3F76', bd: { t: true, b: true, l: true, r: true } } },
  { id: 'berechnung', label: 'Berechnung', s: { fill: '#F2F2F2', color: '#FA7D00', b: true, bd: { t: true, b: true, l: true, r: true } } },
  { id: 'notiz', label: 'Notiz', s: { fill: '#FFFFCC', bd: { t: true, b: true, l: true, r: true } } },
  { id: 'warnung', label: 'Warnhinweis', s: { color: '#FF0000' } },
  { id: 'akzent', label: 'Akzent', s: { fill: '#3B37A0', color: '#FFFFFF', b: true } },
];

export function newSheet(name) {
  return { name, cells: new Map(), colW: [], rowH: new Map(), merges: [], freeze: 0, freezeC: 0, maxR: -1, maxC: -1, charts: [], cf: [], dv: [], autoFilter: null, hiddenRows: new Set(), hiddenColW: {}, spill: new Map(), tabColor: null, protect: null, pivot: null };
}
export function newWorkbook() {
  return { sheets: [newSheet('Tabelle1')], date1904: false, names: [] };
}
export function ensureSheetModel(sh) {
  if (!(sh.rowH instanceof Map)) sh.rowH = new Map(Object.entries(sh.rowH || {}).map(([k, v]) => [+k, v]));
  if (!sh.spill) sh.spill = new Map();
  if (!sh.hiddenColW) sh.hiddenColW = {};
  if (sh.freezeC == null) sh.freezeC = 0;
  return sh;
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
  if (sh.spill) for (const k of sh.spill.keys()) { const r = R_OF(k), c = C_OF(k); if (r > mr) mr = r; if (c > mc) mc = c; }
  sh.maxR = mr; sh.maxC = mc;
}
/** Value of a cell including spilled values (what formulas see). */
export function valueAt(sh, r, c) {
  const cell = sh.cells.get(KEY(r, c));
  if (cell) { if (cell.f) return cell.cv ?? null; if (cell.v != null) return cell.v; }
  const sp = sh.spill && sh.spill.get(KEY(r, c));
  return sp ? sp.v : (cell ? cell.v ?? null : null);
}

// ---------------- number formats ----------------
export function isDateCode(code) {
  if (!code || code === 'General') return false;
  return isDateFormat(code);
}
export function formatKind(code) {
  if (!code || code === 'General') return 'general';
  if (code === '@') return 'text';
  if (isDateCode(code)) return /[dy]/i.test(code.replace(/"[^"]*"/g, '')) || /m{3,}/i.test(code) ? 'date' : 'time';
  const plain = code.replace(/"[^"]*"/g, m => (/€|\$|£/.test(m) ? '€' : ''));
  if (/%/.test(plain)) return 'percent';
  if (/€|\[\$|\$|£/.test(plain)) return 'currency';
  if (/[0#]/.test(plain)) return 'number';
  return 'general';
}

/** "General" display like spreadsheet apps: at most ~11 characters for fractions. */
function generalShort(v) {
  let s = fmtGeneral(v);
  if (s.length <= 11 || Number.isInteger(v) || /E/.test(s)) return s;
  const intLen = String(Math.trunc(Math.abs(v))).length + (v < 0 ? 1 : 0);
  const dec = Math.max(0, 10 - intLen);
  return String(+v.toFixed(dec)).replace('.', ',');
}

/** Display text + colour of a value with a format code (German conventions). */
export function formatCell(v, code) {
  if (v === null || v === undefined) return { text: '', color: null };
  if (isErr(v)) return { text: ERR_DE[v.code] || v.code, color: null };
  if (typeof v === 'boolean') return { text: v ? 'WAHR' : 'FALSCH', color: null };
  if (typeof v === 'string') { if (code && code !== 'General' && code.includes('@') && code !== '@') return formatWithCode(v, code); return { text: v, color: null }; }
  if (!Number.isFinite(v)) return { text: '#ZAHL!', color: null };
  if (!code || code === 'General') return { text: generalShort(v), color: null };
  if (code === '@') return { text: fmtGeneral(v), color: null };
  try { return formatWithCode(v, code); } catch { return { text: generalShort(v), color: null }; }
}
export function formatValue(v, code) { return formatCell(v, code).text; }

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
    const code = cell.s && cell.s.fmt;
    const k = formatKind(code);
    if (k === 'date') return formatValue(v, Number.isInteger(v) ? 'dd.mm.yyyy' : 'dd.mm.yyyy hh:mm');
    if (k === 'time') return formatValue(v, v >= 1 ? 'dd.mm.yyyy hh:mm:ss' : 'hh:mm:ss').replace(/:00$/, '');
    if (k === 'percent') return fmtGeneral(+(v * 100).toPrecision(15)) + ' %';
    return fmtGeneral(v);
  }
  if (typeof v === 'boolean') return v ? 'WAHR' : 'FALSCH';
  if (isErr(v)) return ERR_DE[v.code] || v.code;
  if (/^=|^[-+]?\d/.test(v) || /^(wahr|falsch|true|false)$/i.test(v)) return "'" + v;
  return v;
}

/** Interpret user input (German conventions). Returns {v, f?, fmt?, da?} or throws SyntaxError for bad formulas. */
export function parseInput(text, currentFmt) {
  const t = String(text);
  if (t === '') return { v: null };
  if (t.startsWith("'")) return { v: t.slice(1) };
  if (t.startsWith('=') && t.length > 1) return { f: toCanonical(t.slice(1)), da: true };
  const s = t.trim();
  if (currentFmt === '@') return { v: t };
  const up = s.toUpperCase();
  if (up === 'WAHR' || up === 'TRUE') return { v: true };
  if (up === 'FALSCH' || up === 'FALSE') return { v: false };
  const kind = formatKind(currentFmt);
  let m = /^(-?[\d.,\s]+)\s*%$/.exec(s);
  if (m) { const n = parseNumberText(m[1]); if (n !== null) return { v: +(n / 100).toPrecision(15), fmt: kind === 'percent' ? undefined : (/[.,]\d/.test(m[1]) ? '0.00%' : '0%') }; }
  m = /^(-?[\d.,\s]+)\s*€$|^€\s*(-?[\d.,\s]+)$/.exec(s);
  if (m) { const n = parseNumberText(m[1] || m[2]); if (n !== null) return { v: n, fmt: kind === 'currency' ? undefined : FORMATS.currency.code }; }
  const n = parseNumberText(s);
  if (n !== null && /\d/.test(s)) {
    if (kind === 'percent' && !/%/.test(s)) return { v: n / 100 };
    return { v: n };
  }
  const d = parseDateText(s);
  if (d !== null) {
    const hasTime = /\d:\d/.test(s), hasDate = /[.\-]|[a-zäA-ZÄ]{3}/.test(s.replace(/\s*(am|pm)$/i, ''));
    if (kind === 'date' || kind === 'time') return { v: d };
    return { v: d, fmt: hasDate ? (hasTime ? 'dd.mm.yyyy hh:mm' : 'dd.mm.yyyy') : (/:\d\d:\d\d/.test(s) ? 'hh:mm:ss' : 'hh:mm') };
  }
  return { v: t };
}

// ---------------- named ranges ----------------
export function findName(wb, name, si = null) {
  const lo = String(name).toLowerCase();
  const list = wb.names || [];
  return list.find(n => n.name.toLowerCase() === lo && n.si != null && n.si === si) || list.find(n => n.name.toLowerCase() === lo && (n.si == null || n.si < 0)) || null;
}

// ---------------- recalculation ----------------
const ID = (si, k) => si * 17179869184 + k; // 2^34
const ID_SI = id => Math.floor(id / 17179869184);
const ID_K = id => id % 17179869184;

function sheetIdx(wb) { return new Map(wb.sheets.map((s, i) => [s.name.toLowerCase(), i])); }

/** Build the dependency index (precedents → dependents). */
function buildDeps(wb) {
  const idx = sheetIdx(wb);
  const dep = { idx, fwd: new Map(), cellRev: wb.sheets.map(() => new Map()), colRev: wb.sheets.map(() => new Map()), wideRev: wb.sheets.map(() => []), volatile: new Set() };
  wb.sheets.forEach((sh, si) => { for (const [k, cell] of sh.cells) if (cell.f) addDeps(dep, si, k, cell.f); });
  wb._dep = dep;
  return dep;
}
function addDeps(dep, si, k, f) {
  const id = ID(si, k);
  const p = precedents(compile(f));
  const list = [];
  for (const rf of p.refs) {
    const ts = rf.sheet == null ? si : (dep.idx.has(String(rf.sheet).toLowerCase()) ? dep.idx.get(String(rf.sheet).toLowerCase()) : -1);
    if (ts < 0 || !dep.cellRev[ts]) continue;
    const n = (rf.r2 - rf.r1 + 1) * (rf.c2 - rf.c1 + 1);
    if (n <= 16) {
      for (let r = rf.r1; r <= rf.r2; r++) for (let c = rf.c1; c <= rf.c2; c++) {
        const kk = KEY(r, c);
        let set = dep.cellRev[ts].get(kk);
        if (!set) dep.cellRev[ts].set(kk, set = new Set());
        set.add(id);
        list.push({ t: 'c', s: ts, k: kk });
      }
    } else {
      const ent = { r1: rf.r1, c1: rf.c1, r2: rf.r2, c2: rf.c2, id };
      if (rf.c2 - rf.c1 <= 64) {
        for (let c = rf.c1; c <= rf.c2; c++) { let arr = dep.colRev[ts].get(c); if (!arr) dep.colRev[ts].set(c, arr = []); arr.push(ent); }
        list.push({ t: 'col', s: ts, ent });
      } else { dep.wideRev[ts].push(ent); list.push({ t: 'wide', s: ts, ent }); }
    }
  }
  if (p.volatile || p.names.length || p.spills.length || p.refs.some(rf => rf.sheet != null && !dep.idx.has(String(rf.sheet).toLowerCase()))) dep.volatile.add(id);
  dep.fwd.set(id, list);
}
function removeDeps(dep, si, k) {
  const id = ID(si, k);
  const list = dep.fwd.get(id);
  if (!list) return;
  for (const e of list) {
    if (e.t === 'c') { const set = dep.cellRev[e.s].get(e.k); if (set) { set.delete(id); if (!set.size) dep.cellRev[e.s].delete(e.k); } }
    else if (e.t === 'col') { for (let c = e.ent.c1; c <= e.ent.c2; c++) { const arr = dep.colRev[e.s].get(c); if (arr) { const i = arr.indexOf(e.ent); if (i >= 0) arr.splice(i, 1); } } }
    else { const arr = dep.wideRev[e.s]; const i = arr.indexOf(e.ent); if (i >= 0) arr.splice(i, 1); }
  }
  dep.fwd.delete(id);
  dep.volatile.delete(id);
}
function dependentsOf(dep, si, r, c, out) {
  const set = dep.cellRev[si] && dep.cellRev[si].get(KEY(r, c));
  if (set) for (const id of set) out.push(id);
  const col = dep.colRev[si] && dep.colRev[si].get(c);
  if (col) for (const e of col) if (r >= e.r1 && r <= e.r2) out.push(e.id);
  const wide = dep.wideRev[si];
  if (wide) for (const e of wide) if (r >= e.r1 && r <= e.r2 && c >= e.c1 && c <= e.c2) out.push(e.id);
}

export function makeCtx(wb, { dirty = null } = {}) {
  const memo = new Map();
  const busy = new Set();
  const idxByName = sheetIdx(wb);
  const spillChanges = [];
  const circular = [];
  const ctx = {
    sheet: 0,
    cur: null,
    spillChanges, circular,
    sheetIndex: name => (idxByName.has(String(name).toLowerCase()) ? idxByName.get(String(name).toLowerCase()) : -1),
    bound: si => ({ maxR: wb.sheets[si].maxR, maxC: wb.sheets[si].maxC }),
    fmt: (v, code) => formatValue(v, code),
    name: n => { const d = findName(wb, n, ctx.sheet); return d ? { f: d.ref, si: d.si } : null; },
    isFormula: (si, r, c) => { const x = wb.sheets[si] && wb.sheets[si].cells.get(KEY(r, c)); return !!(x && x.f); },
    formulaOf: (si, r, c) => { const x = wb.sheets[si] && wb.sheets[si].cells.get(KEY(r, c)); return x && x.f ? x.f : null; },
    rowHidden: (si, r) => { const sh = wb.sheets[si]; return !!(sh && ((sh.hiddenRows && sh.hiddenRows.has(r)) || (sh._fh && sh._fh.has(r)))); },
    spillOf: (si, r, c) => { const x = wb.sheets[si] && wb.sheets[si].cells.get(KEY(r, c)); return x && x.spill ? x.spill : x && x.f ? { h: 1, w: 1 } : null; },
    get(si, r, c) {
      const sh = wb.sheets[si];
      if (!sh) return ERR.REF;
      const k = KEY(r, c);
      const cell = sh.cells.get(k);
      if (!cell || (!cell.f && (cell.v === null || cell.v === undefined))) {
        const sp = sh.spill && sh.spill.get(k);
        if (sp) {
          const oc = sh.cells.get(sp.o);
          if (oc && oc.f) ctx.get(si, R_OF(sp.o), C_OF(sp.o));
          const sp2 = sh.spill.get(k);
          return sp2 ? sp2.v : null;
        }
        return null;
      }
      if (!cell.f) return cell.v;
      const mk = ID(si, k);
      if (memo.has(mk)) return memo.get(mk);
      if (dirty && !dirty.has(mk)) return cell.cv ?? null;
      if (busy.has(mk)) { circular.push({ si, r, c }); return ERR.CIRC; }
      busy.add(mk);
      const prevS = ctx.sheet, prevCur = ctx.cur;
      ctx.sheet = si; ctx.cur = { r, c };
      let v;
      try { v = evaluate(compile(cell.f), ctx, { dynamic: !!cell.da }); } catch (e) { v = e instanceof RangeError ? ERR.CIRC : ERR.VALUE; }
      ctx.sheet = prevS; ctx.cur = prevCur;
      busy.delete(mk);
      if (v && v.range) v = ERR.VALUE;
      v = applySpill(sh, si, r, c, cell, v, spillChanges);
      // unsupported function: keep the value the file was saved with
      if (v === ERR.NAME && cell.cv0 != null && !hasKnownFns(cell.f)) v = cell.cv0;
      memo.set(mk, v);
      cell.cv = v;
      return v;
    },
  };
  return ctx;
}
function hasKnownFns(f) { const m = f.match(/\b([A-Z][A-Z0-9.]*)\(/g) || []; return m.every(x => KNOWN_FUNCTIONS.has(x.slice(0, -1))); }

/** Write/clear the spill area of a formula result. Returns the value for the origin cell. */
function applySpill(sh, si, r, c, cell, v, changes) {
  const old = cell.spill;
  if (old) {
    for (let i = 0; i < old.h; i++) for (let j = 0; j < old.w; j++) { if (!i && !j) continue; const k = KEY(r + i, c + j); const sp = sh.spill.get(k); if (sp && sp.o === KEY(r, c)) sh.spill.delete(k); }
  }
  let out = v;
  let next = null;
  if (isArr(v)) {
    const H = v.h, W = v.w;
    let blocked = false;
    for (let i = 0; i < H && !blocked; i++) for (let j = 0; j < W; j++) {
      if (!i && !j) continue;
      const k = KEY(r + i, c + j);
      const x = sh.cells.get(k);
      if ((x && (x.f || (x.v !== null && x.v !== undefined && x.v !== ''))) || (sh.spill.has(k) && sh.spill.get(k).o !== KEY(r, c))) { blocked = true; break; }
    }
    if (blocked || r + H > 1048576 || c + W > 16384) out = ERR.SPILL;
    else {
      for (let i = 0; i < H; i++) for (let j = 0; j < W; j++) {
        if (!i && !j) continue;
        let x = v.rows[i][j]; if (x === undefined) x = null;
        sh.spill.set(KEY(r + i, c + j), { v: x, o: KEY(r, c) });
      }
      next = { h: H, w: W };
      out = v.rows[0][0] ?? 0;
      if (r + H - 1 > sh.maxR) sh.maxR = r + H - 1;
      if (c + W - 1 > sh.maxC) sh.maxC = c + W - 1;
    }
  }
  if (next) cell.spill = next; else delete cell.spill;
  // remember blocked spills so that clearing the obstacle re-evaluates the anchor
  if (out === ERR.SPILL && isArr(v)) { (sh._blocked || (sh._blocked = new Map())).set(KEY(r, c), { h: v.h, w: v.w }); }
  else if (sh._blocked) sh._blocked.delete(KEY(r, c));
  const oh = old ? old.h : 1, ow = old ? old.w : 1, nh = next ? next.h : 1, nw = next ? next.w : 1;
  if (oh !== nh || ow !== nw) changes.push({ si, r, c, h: Math.max(oh, nh), w: Math.max(ow, nw) });
  return out;
}

/** Recalculate all formulas. Returns number of formulas. */
export function recalc(wb) {
  wb.sheets.forEach(ensureSheetModel);
  buildDeps(wb);
  let n = 0, pass = 0;
  let ctx;
  do {
    ctx = makeCtx(wb);
    n = 0;
    wb.sheets.forEach((sh, si) => {
      const keys = [];
      for (const [k, cell] of sh.cells) if (cell.f) keys.push(k);
      keys.sort((a, b) => a - b);
      for (const k of keys) { ctx.get(si, R_OF(k), C_OF(k)); n++; }
    });
    // stale spill entries of formulas that no longer exist
    wb.sheets.forEach(sh => { for (const [k, sp] of sh.spill) { const o = sh.cells.get(sp.o); if (!o || !o.f || !o.spill) sh.spill.delete(k); } });
  } while (ctx.spillChanges.length && ++pass < 3);
  wb._circ = ctx.circular;
  return n;
}

/**
 * Recalculate only formulas that depend on the given changed cells.
 * changes: [{si, r, c}] – cells whose value or formula changed. formulaChanged: same list entries whose formula text changed.
 */
export function recalcCells(wb, changes) {
  if (!wb._dep || wb._dep.idx.size !== wb.sheets.length) return recalc(wb);
  const dep = wb._dep;
  // refresh dependency entries of changed formula cells
  for (const ch of changes) {
    const sh = wb.sheets[ch.si];
    const k = KEY(ch.r, ch.c);
    removeDeps(dep, ch.si, k);
    const cell = sh.cells.get(k);
    if (cell && cell.f) addDeps(dep, ch.si, k, cell.f);
  }
  let queue = changes.map(ch => ({ si: ch.si, r: ch.r, c: ch.c }));
  // edits inside (or blocking) a spill range re-evaluate the spilling formula
  for (const ch of changes) {
    const sh = wb.sheets[ch.si];
    const sp = sh.spill && sh.spill.get(KEY(ch.r, ch.c));
    if (sp) queue.push({ si: ch.si, r: R_OF(sp.o), c: C_OF(sp.o) });
    if (sh._blocked) for (const [k, d] of sh._blocked) { const r0 = R_OF(k), c0 = C_OF(k); if (ch.r >= r0 && ch.r < r0 + d.h && ch.c >= c0 && ch.c < c0 + d.w && !(ch.r === r0 && ch.c === c0)) queue.push({ si: ch.si, r: r0, c: c0 }); }
  }
  let total = 0;
  for (let pass = 0; pass < 4 && queue.length; pass++) {
    const dirty = new Set();
    const stack = [...queue];
    for (const ch of queue) { const cell = wb.sheets[ch.si].cells.get(KEY(ch.r, ch.c)); if (cell && cell.f) dirty.add(ID(ch.si, KEY(ch.r, ch.c))); }
    for (const id of dep.volatile) { if (!dirty.has(id)) { dirty.add(id); stack.push({ si: ID_SI(id), r: R_OF(ID_K(id)), c: C_OF(ID_K(id)) }); } }
    for (const id of dirty) { const si = ID_SI(id), k = ID_K(id); const cell = wb.sheets[si].cells.get(k); if (cell && cell.spill) pushArea(stack, si, R_OF(k), C_OF(k), cell.spill.h, cell.spill.w); }
    let guard = 0;
    while (stack.length && guard++ < 5e6) {
      const { si, r, c } = stack.pop();
      const out = [];
      dependentsOf(dep, si, r, c, out);
      for (const id of out) {
        if (dirty.has(id)) continue;
        dirty.add(id);
        const dsi = ID_SI(id), dk = ID_K(id);
        stack.push({ si: dsi, r: R_OF(dk), c: C_OF(dk) });
        const cell = wb.sheets[dsi].cells.get(dk);
        if (cell && cell.spill) pushArea(stack, dsi, R_OF(dk), C_OF(dk), cell.spill.h, cell.spill.w);
      }
    }
    const ctx = makeCtx(wb, { dirty });
    const ids = [...dirty].sort((a, b) => a - b);
    for (const id of ids) { const si = ID_SI(id), k = ID_K(id); const cell = wb.sheets[si].cells.get(k); if (cell && cell.f) ctx.get(si, R_OF(k), C_OF(k)); }
    // removed formulas: clear their spill areas
    for (const ch of changes) {
      const sh = wb.sheets[ch.si];
      for (const [k, sp] of sh.spill) if (sp.o === KEY(ch.r, ch.c)) { const o = sh.cells.get(sp.o); if (!o || !o.f || !o.spill) { sh.spill.delete(k); ctx.spillChanges.push({ si: ch.si, r: R_OF(k), c: C_OF(k), h: 1, w: 1 }); } }
    }
    total += ids.length;
    wb._circ = ctx.circular;
    queue = [];
    for (const sc of ctx.spillChanges) for (let i = 0; i < sc.h; i++) for (let j = 0; j < sc.w; j++) if (i || j) queue.push({ si: sc.si, r: sc.r + i, c: sc.c + j });
    changes = [];
  }
  return total;
}
function pushArea(stack, si, r, c, h, w) { for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) if (i || j) stack.push({ si, r: r + i, c: c + j }); }
export function invalidateDeps(wb) { wb._dep = null; }

// ---------------- structural edits ----------------
function remapSheetCells(sh, fn) {
  const next = new Map();
  for (const [k, cell] of sh.cells) {
    const to = fn(R_OF(k), C_OF(k));
    if (to) next.set(KEY(to.r, to.c), cell);
  }
  sh.cells = next;
  if (sh.spill) sh.spill.clear();
  for (const cell of sh.cells.values()) delete cell.spill;
  recomputeBounds(sh);
}

function adjustFormulas(wb, sheetIdx, refFn) {
  const target = wb.sheets[sheetIdx].name.toLowerCase();
  const fix = (f, si) => shiftRefs(f, (ref, sheet) => {
    const t = sheet == null ? si : wb.sheets.findIndex(s => s.name.toLowerCase() === String(sheet).toLowerCase());
    if (t !== sheetIdx) return ref;
    return refFn(ref);
  });
  wb.sheets.forEach((sh, si) => {
    for (const [k, cell] of sh.cells) if (cell.f) { const f = fix(cell.f, si); if (f !== cell.f) sh.cells.set(k, { ...cell, f }); }
  });
  wb.names = (wb.names || []).map(n => ({ ...n }));
  for (const n of wb.names) {
    if (!/!/.test(n.ref) && (n.si == null || n.si !== sheetIdx)) continue;
    n.ref = shiftRefs(n.ref, (ref, sheet) => (sheet != null && String(sheet).toLowerCase() === target ? refFn(ref) : sheet == null && n.si === sheetIdx ? refFn(ref) : ref));
  }
  wb._dep = null;
}

function shiftRowMap(map, at, n, del) {
  if (!map || !map.size) return map;
  const next = new Map();
  for (const [r, v] of map) {
    if (!del) next.set(r >= at ? r + n : r, v);
    else if (r < at) next.set(r, v);
    else if (r >= at + n) next.set(r - n, v);
  }
  return next;
}
export function insertRows(wb, si, at, n = 1) {
  const sh = ensureSheetModel(wb.sheets[si]);
  remapSheetCells(sh, (r, c) => ({ r: r >= at ? r + n : r, c }));
  adjustFormulas(wb, si, ref => (ref.colOnly ? ref : ref.rowOnly && ref.r === 1048575 ? ref : { ...ref, r: ref.r >= at ? ref.r + n : ref.r }));
  sh.merges = sh.merges.map(m => ({ ...m, r1: m.r1 >= at ? m.r1 + n : m.r1, r2: m.r2 >= at ? m.r2 + n : m.r2 }));
  sh.rowH = shiftRowMap(sh.rowH, at, n, false);
}
export function deleteRows(wb, si, at, n = 1) {
  const sh = ensureSheetModel(wb.sheets[si]);
  remapSheetCells(sh, (r, c) => (r >= at && r < at + n ? null : { r: r >= at + n ? r - n : r, c }));
  adjustFormulas(wb, si, (ref) => {
    if (ref.colOnly) return ref;
    if (ref.r >= at && ref.r < at + n) return null;
    return { ...ref, r: ref.r >= at + n ? ref.r - n : ref.r };
  });
  sh.merges = sh.merges.filter(m => m.r2 < at || m.r1 >= at + n).map(m => ({ ...m, r1: m.r1 >= at + n ? m.r1 - n : m.r1, r2: m.r2 >= at + n ? m.r2 - n : m.r2 }));
  sh.rowH = shiftRowMap(sh.rowH, at, n, true);
}
export function insertCols(wb, si, at, n = 1) {
  const sh = ensureSheetModel(wb.sheets[si]);
  remapSheetCells(sh, (r, c) => ({ r, c: c >= at ? c + n : c }));
  adjustFormulas(wb, si, ref => (ref.rowOnly ? ref : { ...ref, c: ref.c >= at ? ref.c + n : ref.c }));
  if (sh.colW.length > at) sh.colW.splice(at, 0, ...new Array(n).fill(undefined));
  sh.merges = sh.merges.map(m => ({ ...m, c1: m.c1 >= at ? m.c1 + n : m.c1, c2: m.c2 >= at ? m.c2 + n : m.c2 }));
  const hw = {}; for (const [c, w] of Object.entries(sh.hiddenColW || {})) hw[+c >= at ? +c + n : +c] = w; sh.hiddenColW = hw;
}
export function deleteCols(wb, si, at, n = 1) {
  const sh = ensureSheetModel(wb.sheets[si]);
  remapSheetCells(sh, (r, c) => (c >= at && c < at + n ? null : { r, c: c >= at + n ? c - n : c }));
  adjustFormulas(wb, si, ref => {
    if (ref.rowOnly) return ref;
    if (ref.c >= at && ref.c < at + n) return null;
    return { ...ref, c: ref.c >= at + n ? ref.c - n : ref.c };
  });
  sh.colW.splice(at, n);
  sh.merges = sh.merges.filter(m => m.c2 < at || m.c1 >= at + n).map(m => ({ ...m, c1: m.c1 >= at + n ? m.c1 - n : m.c1, c2: m.c2 >= at + n ? m.c2 - n : m.c2 }));
  const hw = {}; for (const [c, w] of Object.entries(sh.hiddenColW || {})) { if (+c >= at && +c < at + n) continue; hw[+c >= at + n ? +c - n : +c] = w; } sh.hiddenColW = hw;
}

const cellVal = cell => (cell ? (cell.f ? cell.cv : cell.v) : null);
/**
 * Sort rows r1..r2 of columns c1..c2 by several keys: [{c, asc}] (stable, empty cells last).
 * Formulas inside the moved rows keep relative references to their own row (like spreadsheet apps).
 */
export function sortRowsMulti(wb, si, r1, r2, c1, c2, keys) {
  const sh = wb.sheets[si];
  if (c2 == null) c2 = sh.maxC;
  const rows = [];
  for (let r = r1; r <= r2; r++) {
    const cells = new Map();
    for (let cc = c1; cc <= c2; cc++) { const cell = sh.cells.get(KEY(r, cc)); if (cell) cells.set(cc, cell); }
    rows.push({ cells, r, h: sh.rowH && sh.rowH.get(r) });
  }
  rows.sort((a, b) => {
    for (const k of keys) {
      const x = cellVal(a.cells.get(k.c)), y = cellVal(b.cells.get(k.c));
      const ex = x === null || x === undefined || x === '', ey = y === null || y === undefined || y === '';
      if (ex || ey) { if (ex !== ey) return ex ? 1 : -1; continue; }
      const cmp = compareValues(x, y);
      if (cmp) return k.asc === false ? -cmp : cmp;
    }
    return a.r - b.r;
  });
  for (let r = r1; r <= r2; r++) for (let cc = c1; cc <= c2; cc++) sh.cells.delete(KEY(r, cc));
  rows.forEach((row, i) => {
    const dr = r1 + i - row.r;
    row.cells.forEach((cell, cc) => {
      let n = cell;
      if (cell.f && dr) n = { ...cell, f: shiftRefs(cell.f, (ref, sheet, pos) => (pos === false && sheet == null && !ref.absR && !ref.colOnly && ref.r === row.r ? { ...ref, r: ref.r + dr } : ref)) };
      sh.cells.set(KEY(r1 + i, cc), n);
    });
  });
  if (sh.spill) sh.spill.clear();
  wb._dep = null;
}
/** Sort rows r1..r2 by column c (keeps whole rows together over the used columns). */
export function sortRows(wb, si, r1, r2, c, asc = true, c1 = 0, c2 = null) {
  return sortRowsMulti(wb, si, r1, r2, c1, c2, [{ c, asc }]);
}

/** Contiguous data block around a cell (like "current region" in spreadsheet apps). */
export function currentRegion(sh, r, c) {
  const has = (rr, cc) => { if (rr < 0 || cc < 0) return false; const v = valueAt(sh, rr, cc); const x = sh.cells.get(KEY(rr, cc)); return (x && x.f) || (v !== null && v !== undefined && v !== ''); };
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
      if (cell) row.push(formatted ? displayOf(cell) : (cell.f ? cell.cv : cell.v));
      else { const sp = sh.spill && sh.spill.get(KEY(r, c)); row.push(sp ? (formatted ? formatValue(sp.v, null) : sp.v) : ''); }
    }
    rows.push(row);
  }
  return rows;
}

export { FErr, isErr, fmtGeneralDe, serialToDate, dateToSerial };
