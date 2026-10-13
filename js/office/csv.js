// CSV import/export (auto-detects ; , or tab; UTF-8 with/without BOM, falls back to Windows-1252).
import { newWorkbook, KEY, formatKind } from './workbook.js';
import { parseNumberText, fmtGeneral, isErr, dateToSerial } from './formula.js';
import { decodeText } from './vendor.js';

export function detectDelimiter(text) {
  const sample = text.slice(0, 20000).split('\n').slice(0, 30);
  const score = d => {
    const counts = sample.map(l => { let n = 0, q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === d && !q) n++; } return n; }).filter(n => n > 0);
    if (!counts.length) return 0;
    const same = counts.filter(n => n === counts[0]).length;
    return counts.length * 2 + same + counts[0] * 0.1;
  };
  const cands = [';', ',', '\t', '|'];
  let best = ',', bs = -1;
  for (const d of cands) { const s = score(d); if (s > bs) { bs = s; best = d; } }
  return best;
}

export function parseCsvText(text, delim) {
  const rows = [];
  let row = [], field = '', q = false, i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } q = false; i++; continue; }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '') { q = true; i++; continue; }
    if (ch === delim) { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function valueOf(s, decimalComma) {
  const t = s.trim();
  if (t === '') return { v: null };
  if (/^0\d/.test(t) && !/[.,]/.test(t)) return { v: s }; // keep leading zeros (postcodes, phone numbers)
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  if (m) { const d = new Date(+m[3], +m[2] - 1, +m[1]); if (d.getMonth() === +m[2] - 1) return { v: dateToSerial(d), fmt: 'dd.mm.yyyy' }; }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) return { v: dateToSerial(new Date(+m[1], +m[2] - 1, +m[3])), fmt: 'dd.mm.yyyy' };
  const pct = /^(-?[\d.,]+)\s*%$/.exec(t);
  const cur = /^(-?[\d.,]+)\s*€$/.exec(t);
  const core = pct ? pct[1] : cur ? cur[1] : t;
  let num = null;
  if (decimalComma) {
    if (/^[-+]?\d{1,3}(\.\d{3})*(,\d+)?$/.test(core) || /^[-+]?\d+(,\d+)?$/.test(core)) num = parseFloat(core.replace(/\./g, '').replace(',', '.'));
  } else if (/^[-+]?\d{1,3}(,\d{3})*(\.\d+)?$/.test(core) || /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(core)) num = parseFloat(core.replace(/,/g, ''));
  if (num === null) { const p = parseNumberText(core); if (p !== null && !/[.,].*[.,]/.test(core)) num = p; }
  if (num !== null && Number.isFinite(num)) {
    if (pct) return { v: num / 100, fmt: '0%' };
    if (cur) return { v: num, fmt: '#,##0.00 "€"' };
    return { v: num };
  }
  return { v: s };
}

export async function readCsv(blob, name = 'Tabelle') {
  const text = (await decodeText(blob)).replace(/^﻿/, '');
  const delim = detectDelimiter(text);
  const decimalComma = delim !== ',';
  const rows = parseCsvText(text, delim);
  const wb = newWorkbook();
  const sh = wb.sheets[0];
  sh.name = String(name).replace(/\.csv$/i, '').slice(0, 31) || 'Tabelle1';
  rows.forEach((row, r) => row.forEach((s, c) => {
    const { v, fmt } = valueOf(s, decimalComma);
    if (v === null) return;
    const cell = { v };
    if (fmt) cell.s = { fmt };
    sh.cells.set(KEY(r, c), cell);
    if (r > sh.maxR) sh.maxR = r;
    if (c > sh.maxC) sh.maxC = c;
  }));
  wb.csv = { delim, decimalComma };
  return wb;
}

/** Export one sheet as CSV. German default: ";" + decimal comma + UTF-8 BOM (opens correctly in office apps). */
export function writeCsv(sh, { delim = ';', decimalComma = true } = {}) {
  const lines = [];
  for (let r = 0; r <= sh.maxR; r++) {
    const row = [];
    for (let c = 0; c <= sh.maxC; c++) {
      const cell = sh.cells.get(KEY(r, c));
      let s = '';
      if (cell) {
        const v = cell.f ? cell.cv : cell.v;
        const kind = formatKind(cell.s && cell.s.fmt);
        if (v === null || v === undefined) s = '';
        else if (typeof v === 'number') {
          if (kind === 'date') { const { formatValue } = DISP; s = formatValue(v, cell.s.fmt); }
          else { s = String(+v.toPrecision(15)); if (decimalComma) s = s.replace('.', ','); }
        } else if (typeof v === 'boolean') s = v ? 'WAHR' : 'FALSCH';
        else if (isErr(v)) s = v.code;
        else s = String(v);
      }
      if (s.includes(delim) || /["\n\r]/.test(s) || /^\s|\s$/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
      row.push(s);
    }
    lines.push(row.join(delim));
  }
  return new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
}
import { formatValue } from './workbook.js';
const DISP = { formatValue };
void fmtGeneral;
