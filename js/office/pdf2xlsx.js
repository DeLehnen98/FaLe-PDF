// PDF → Excel: detect table structure from pdf.js text positions (rows by y, columns by x gaps) → .xlsx.
import * as db from '../db.js';
import { $, h, esc, toast, errorToast, progress } from '../ui.js';
import { loadPdf } from '../pdfcore.js';
import { getDocBytes, saveFile } from '../library.js';
import { oicon, stripExt } from './kinds.js';
import { newWorkbook, newSheet, KEY } from './workbook.js';
import { dateToSerial } from './formula.js';
import { resultDialog } from './shell.js';
import { tick } from './vendor.js';

/** Turn text items of one page into rows of cell strings. */
export function pageToRows(items, { onlyTables = false } = {}) {
  const its = items.filter(it => it.str && it.str.trim()).map(it => {
    const t = it.transform;
    const hgt = Math.max(4, Math.hypot(t[2], t[3]) || it.height || 10);
    return { x: t[4], y: t[5], w: Math.max(it.width || 0, 0.1), h: hgt, str: it.str };
  });
  if (!its.length) return [];
  // 1. lines by baseline
  its.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of its) {
    const ln = lines.find(l => Math.abs(l.y - it.y) < Math.max(2, Math.min(l.h, it.h) * 0.45));
    if (ln) { ln.items.push(it); ln.h = Math.max(ln.h, it.h); } else lines.push({ y: it.y, h: it.h, items: [it] });
  }
  lines.sort((a, b) => b.y - a.y);
  // 2. chunks per line (merge close items)
  for (const ln of lines) {
    ln.items.sort((a, b) => a.x - b.x);
    const chunks = [];
    for (const it of ln.items) {
      const last = chunks[chunks.length - 1];
      const gap = last ? it.x - (last.x + last.w) : Infinity;
      if (last && gap < Math.max(3, it.h * 0.55)) {
        last.str += (gap > it.h * 0.12 && !/\s$/.test(last.str) && !/^\s/.test(it.str) ? ' ' : '') + it.str;
        last.w = Math.max(last.w, it.x + it.w - last.x);
      } else chunks.push({ x: it.x, w: it.w, str: it.str });
    }
    ln.chunks = chunks.map(c => ({ ...c, str: c.str.replace(/\s+/g, ' ').trim() })).filter(c => c.str);
  }
  // 3. column separators from the x-coverage of multi-chunk lines
  const multi = lines.filter(l => l.chunks.length >= 2);
  if (!multi.length) return onlyTables ? [] : lines.map(l => [l.chunks.map(c => c.str).join(' ')]);
  const minX = Math.floor(Math.min(...multi.flatMap(l => l.chunks.map(c => c.x))));
  const maxX = Math.ceil(Math.max(...multi.flatMap(l => l.chunks.map(c => c.x + c.w))));
  const cover = new Uint16Array(Math.max(1, maxX - minX + 1));
  for (const l of multi) for (const c of l.chunks) for (let x = Math.floor(c.x) - minX; x <= Math.ceil(c.x + c.w) - minX; x++) if (x >= 0 && x < cover.length) cover[x]++;
  const limit = Math.max(0, Math.floor(multi.length * 0.08));
  const seps = [];
  let runStart = -1;
  for (let x = 0; x < cover.length; x++) {
    if (cover[x] <= limit) { if (runStart < 0) runStart = x; }
    else if (runStart >= 0) { if (x - runStart >= 3 && runStart > 0) seps.push(minX + (runStart + x) / 2); runStart = -1; }
  }
  const colOf = x => { let i = 0; while (i < seps.length && x > seps[i]) i++; return i; };
  const nCols = seps.length + 1;
  // 4. rows
  const rows = [];
  for (const l of lines) {
    if (onlyTables && l.chunks.length < 2) continue;
    const row = new Array(nCols).fill('');
    for (const c of l.chunks) {
      const col = l.chunks.length === 1 ? colOf(c.x) : colOf(c.x + c.w / 2);
      row[col] = row[col] ? row[col] + ' ' + c.str : c.str;
    }
    rows.push(row);
  }
  return rows;
}

/** Interpret a cell string (German/English number formats, %, €, dates). */
export function smartValue(s) {
  const t = String(s).trim();
  if (!t) return { v: null };
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  if (m) { const d = new Date(+m[3], +m[2] - 1, +m[1]); if (d.getMonth() === +m[2] - 1) return { v: dateToSerial(d), fmt: 'dd.mm.yyyy' }; }
  const pct = /%$/.test(t), cur = /€|EUR$/i.test(t);
  let core = t.replace(/\s|€|EUR|%/gi, '');
  const neg = /^\(.*\)$/.test(core) || /-$/.test(core);
  core = core.replace(/^\(|\)$/g, '').replace(/-$/, '');
  let v = null;
  if (/^[-+]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(core) || /^[-+]?\d+,\d+$/.test(core)) v = parseFloat(core.replace(/\./g, '').replace(',', '.'));
  else if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(core)) v = parseFloat(core.replace(/,/g, ''));
  else if (/^[-+]?\d+(\.\d+)?$/.test(core) && !/^0\d/.test(core)) v = parseFloat(core);
  if (v === null || !Number.isFinite(v)) return { v: t };
  if (neg) v = -Math.abs(v);
  if (pct) return { v: v / 100, fmt: '0.00%' };
  if (cur) return { v, fmt: '#,##0.00 "€"' };
  return { v };
}

function rowsToSheet(sh, rows, startRow = 0) {
  rows.forEach((row, r) => row.forEach((s, c) => {
    const { v, fmt } = smartValue(s);
    if (v === null) return;
    const cell = { v };
    if (fmt) cell.s = { fmt };
    sh.cells.set(KEY(startRow + r, c), cell);
    sh.maxR = Math.max(sh.maxR, startRow + r);
    sh.maxC = Math.max(sh.maxC, c);
  }));
  // column widths from content
  for (let c = 0; c <= sh.maxC; c++) {
    let w = 6;
    for (let r = 0; r <= Math.min(sh.maxR, 300); r++) { const x = sh.cells.get(KEY(r, c)); if (x && x.v != null) w = Math.max(w, String(x.v).length); }
    sh.colW[c] = Math.min(380, Math.round(w * 7.2 + 14));
  }
}

export async function mount(screen, { docId }) {
  const meta = await db.getDoc(docId);
  if (!meta) throw Object.assign(new Error('missing'), { userMessage: 'Dokument nicht gefunden.' });
  const inner = h(`<div class="screen-inner">
    <div class="card intro"><span class="tile-ic">${oicon('ksheet')}</span><div><strong>${esc(meta.name)}</strong><p>Tabellen werden anhand der Textpositionen erkannt: Zeilen nach Höhe, Spalten nach Abständen. Gescannte PDFs ohne Text können nicht ausgelesen werden.</p></div></div>
    <div class="option-grid">
      <label class="radio-card"><input type="radio" name="mode" value="pages" checked><span><strong>Ein Blatt pro Seite</strong><span>Übersichtlich bei mehrseitigen Berichten.</span></span></label>
      <label class="radio-card"><input type="radio" name="mode" value="one"><span><strong>Alles in einem Blatt</strong><span>Ideal für lange Listen über mehrere Seiten.</span></span></label>
    </div>
    <label class="check"><input type="checkbox" data-only> Nur tabellenartige Zeilen übernehmen (Fließtext weglassen)</label>
    <h2 class="section-title">Vorschau <span class="muted small" data-info></span></h2>
    <div class="card x2-preview" data-preview><div class="v-loading" style="position:static;padding:30px"><div><span class="spinner dark"></span><span>Seiten werden analysiert …</span></div></div></div>
  </div>`);
  screen.body.appendChild(inner);
  const btn = h(`<button class="btn btn-primary" type="button" data-make disabled>${oicon('ksheet')} Excel-Tabelle erstellen</button>`);
  screen.setFoot([btn]);

  // extract once
  const bytes = await getDocBytes(docId);
  const { pdf } = await loadPdf(bytes, { name: meta.name, key: docId });
  const pages = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      if (screen.signal.aborted) return;
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      pages.push(tc.items);
      page.cleanup();
      if (i % 5 === 0) { $('[data-info]', inner).textContent = `Seite ${i} von ${pdf.numPages}`; await tick(); }
    }
  } finally { pdf.destroy(); }

  const build = () => {
    const only = $('[data-only]', inner).checked;
    const mode = inner.querySelector('input[name=mode]:checked').value;
    const wb = newWorkbook();
    wb.sheets = [];
    if (mode === 'one') {
      const sh = newSheet('Tabelle1');
      let r = 0;
      for (const items of pages) { const rows = pageToRows(items, { onlyTables: only }); rowsToSheet(sh, rows, r); r += rows.length; }
      wb.sheets.push(sh);
    } else {
      pages.forEach((items, i) => { const sh = newSheet(`Seite ${i + 1}`); rowsToSheet(sh, pageToRows(items, { onlyTables: only })); wb.sheets.push(sh); });
    }
    if (!wb.sheets.length) wb.sheets.push(newSheet('Tabelle1'));
    return wb;
  };
  const preview = () => {
    const wb = build();
    const sh = wb.sheets.find(s => s.maxR >= 0) || wb.sheets[0];
    const box = $('[data-preview]', inner);
    const textCount = pages.reduce((a, p) => a + p.filter(i => i.str && i.str.trim()).length, 0);
    if (!textCount) {
      box.innerHTML = `<div class="empty" style="border:none"><div class="empty-art">${oicon('info')}</div><h3>Kein Text gefunden</h3><p>Diese PDF enthält keinen auswählbaren Text – vermutlich ein Scan. Tabellen lassen sich daraus nicht auslesen.</p></div>`;
      btn.disabled = true;
      return;
    }
    const rows = Math.min(sh.maxR + 1, 14), cols = Math.min(sh.maxC + 1, 8);
    let t = '<div class="x2-scroll"><table class="x2-table"><tbody>';
    for (let r = 0; r < rows; r++) {
      t += '<tr>';
      for (let c = 0; c < cols; c++) { const x = sh.cells.get(KEY(r, c)); const v = x ? x.v : ''; t += `<td class="${typeof v === 'number' ? 'num' : ''}">${esc(typeof v === 'number' ? v.toLocaleString('de-DE', { maximumFractionDigits: 4 }) : v ?? '')}</td>`; }
      t += '</tr>';
    }
    t += '</tbody></table></div>';
    box.innerHTML = t;
    $('[data-info]', inner).textContent = `${wb.sheets.length} Blatt/Blätter · ${sh.name}: ${sh.maxR + 1} Zeilen × ${sh.maxC + 1} Spalten`;
    btn.disabled = false;
  };
  inner.addEventListener('change', preview);
  preview();

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const prog = progress('Excel-Tabelle wird erstellt …');
    try {
      const wb = build();
      const { recalc } = await import('./workbook.js');
      recalc(wb);
      const blob = await (await import('./xlsx-write.js')).writeXlsx(wb, { title: stripExt(meta.name) });
      const doc = await saveFile({ blob, name: stripExt(meta.name) + '.xlsx', kind: 'xlsx' });
      prog.done();
      toast('Excel-Tabelle erstellt', 'success');
      await resultDialog(doc, 'Excel-Tabelle erstellt', 'Die Tabelle wurde in deinen Dateien gespeichert.');
    } catch (e) {
      prog.done();
      errorToast(e, 'Die Tabelle konnte nicht erstellt werden.');
    } finally { btn.disabled = false; }
  });
}
