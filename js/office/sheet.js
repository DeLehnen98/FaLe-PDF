// Tabellenkalkulation: virtualised grid editor for .xlsx/.csv with formulas, formats, sheets.
import * as db from '../db.js';
import { $, $$, h, esc, toast, errorToast, showMenu, promptDialog, confirmDialog, downloadBlob, shareBlob, openDialog } from '../ui.js';
import { createShell, exportPdfFlow, tb } from './shell.js';
import { officeMenu, oicon, KINDS, stripExt } from './kinds.js';
import { newWorkbook, newSheet, getCell, setCell, recalc, displayOf, editTextOf, parseInput, formatKind, FORMATS, KEY, R_OF, C_OF,
  DEFAULT_COL_W, ROW_H, insertRows, deleteRows, insertCols, deleteCols, sortRows, recomputeBounds, currentRegion } from './workbook.js';
import { colName, addr, parseAddr, parseRangeAddr, toDisplay, shiftRefs, isErr, FUNCTION_LIST, dateToSerial } from './formula.js';
import { SHEET_TEMPLATES } from './templates.js';
import { ensureSheetExtras, cfStyle, filterHidden, columnValues, validationAt, parseList, shiftSheetRanges, extrasSnapshot, restoreExtras, rangeStr, parseRange, CF_TYPES, CF_STYLES, CF_SCALES, EMPTY } from './sheetfx.js';
import { chartSvg, chartData, newChartId } from './chart.js';

const HW = 46, HH = 26;

export async function mountSheet(screen, { id = null, template = null }) {
  let meta = null, kind = 'xlsx', name = 'Neue Tabelle.xlsx', wb;
  screen.body.innerHTML = '<div class="v-loading"><div><span class="spinner dark" style="width:30px;height:30px"></span><span data-load>Tabelle wird geöffnet …</span></div></div>';
  if (id) {
    meta = await db.getDoc(id);
    if (!meta) throw Object.assign(new Error('missing'), { userMessage: 'Tabelle nicht gefunden.' });
    kind = meta.kind; name = meta.name;
    const blob = await db.getFile(id);
    if (kind === 'csv') wb = await (await import('./csv.js')).readCsv(blob, name);
    else {
      const lbl = $('[data-load]', screen.body);
      wb = await (await import('./xlsx-read.js')).readXlsx(await blob.arrayBuffer(), name, p => { if (lbl) lbl.textContent = `Tabelle wird geöffnet … ${Math.round(p * 100)} %`; });
    }
    db.updateDoc(id, { openedAt: Date.now() }).catch(() => {});
  } else {
    wb = buildTemplate(template);
    const t = SHEET_TEMPLATES.find(x => x.id === template);
    name = (t && t.id !== 'leer' ? t.title : 'Neue Tabelle') + '.xlsx';
  }
  if (screen.signal.aborted) return;
  recalc(wb);
  wb.sheets.forEach(ensureSheetExtras);

  let si = 0;
  let sh = wb.sheets[0];
  const sel = { r: 0, c: 0, ar: 0, ac: 0 }; // active + anchor
  const undo = [], redo = [];

  const shell = createShell(screen, {
    id, name, kind,
    serialize: () => serialize(kind),
    menu: () => [
      { label: 'Als PDF exportieren', icon: 'kpdf', onClick: exportPdf },
      { label: 'Excel-Datei (.xlsx) herunterladen', icon: 'download', onClick: async () => downloadBlob(await serialize('xlsx'), stripExt(shell.name) + '.xlsx') },
      { label: 'Blatt als CSV herunterladen', icon: 'download', onClick: async () => downloadBlob(await serialize('csv'), stripExt(shell.name) + (wb.sheets.length > 1 ? ` – ${sh.name}` : '') + '.csv') },
      kind === 'csv' ? { label: 'Als Excel-Tabelle speichern', icon: 'ksheet', onClick: async () => shell.saveAsKind(await serialize('xlsx'), 'xlsx') } : null,
      '-',
      { label: 'Suchen & ersetzen', icon: 'replace', onClick: () => openFind(true) },
      { label: 'Diagramm einfügen', icon: 'chart', onClick: () => insertChart() },
      { label: 'Teilen', icon: 'share', onClick: async () => shareBlob(await serialize(kind), shell.name, KINDS[kind].mime) },
      { label: 'Kopie speichern unter …', icon: 'copy', onClick: () => shell.save({ asCopy: true }) },
      { label: 'Umbenennen', icon: 'edit', onClick: () => shell.rename() },
    ],
  });

  async function serialize(k) {
    if (k === 'csv') {
      if (kind === 'csv' && wb.sheets.length > 1) toast('CSV speichert nur das aktuelle Blatt.', 'info');
      return (await import('./csv.js')).writeCsv(kind === 'csv' ? wb.sheets[0] : sh, wb.csv || {});
    }
    return (await import('./xlsx-write.js')).writeXlsx(wb, { title: stripExt(shell.name) });
  }
  async function exportPdf() {
    const { workbookToPdf } = await import('./sheetpdf.js');
    await exportPdfFlow(shell.name, onP => workbookToPdf(wb, { title: stripExt(shell.name), onProgress: onP }));
  }

  // ---------------- DOM ----------------
  screen.body.innerHTML = '';
  screen.body.classList.add('office-body');
  const fmtOptions = Object.entries(FORMATS).map(([k, f]) => `<option value="${k}">${f.label}</option>`).join('');
  const root = h(`<div class="sheet-app">
    <div class="office-toolbar" role="toolbar" aria-label="Tabellenwerkzeuge">
      <div class="tb-group">${tb('undo', 'Rückgängig (Strg+Z)', 'data-a="undo"')}${tb('redo', 'Wiederholen (Strg+Y)', 'data-a="redo"')}</div>
      <div class="tb-group">${tb('bold', 'Fett', 'data-a="bold"')}${tb('italic', 'Kursiv', 'data-a="italic"')}
        <span class="tb-color">${tb('color', 'Textfarbe', 'data-a="color"')}<span class="tb-swatch" style="background:#B91C1C"></span></span>
        <span class="tb-color">${tb('fill', 'Füllfarbe', 'data-a="fill"')}<span class="tb-swatch" style="background:#FDE047"></span></span></div>
      <div class="tb-group"><label class="sr-only" for="sh-fmt">Zahlenformat</label><select class="tb-select" id="sh-fmt" data-fmt title="Zahlenformat">${fmtOptions}</select>
        ${tb('alignLeft', 'Linksbündig', 'data-a="al-left"')}${tb('alignCenter', 'Zentriert', 'data-a="al-center"')}${tb('alignRight', 'Rechtsbündig', 'data-a="al-right"')}</div>
      <div class="tb-group">${tb('sigma', 'AutoSumme', 'data-a="sum"')}${tb('fx', 'Funktion einfügen', 'data-a="fx"')}</div>
      <div class="tb-group">${tb('rowAdd', 'Zeile einfügen', 'data-a="row-add"')}${tb('rowDel', 'Zeile löschen', 'data-a="row-del"')}${tb('colAdd', 'Spalte einfügen', 'data-a="col-add"')}${tb('colDel', 'Spalte löschen', 'data-a="col-del"')}</div>
      <div class="tb-group">${tb('sortAsc', 'Aufsteigend sortieren', 'data-a="sort-asc"')}${tb('sortDesc', 'Absteigend sortieren', 'data-a="sort-desc"')}${tb('freeze', 'Kopfzeile fixieren', 'data-a="freeze"')}${tb('filter', 'Filter (AutoFilter)', 'data-a="filter"')}</div>
      <div class="tb-group">${tb('border', 'Rahmen', 'data-a="border"')}${tb('wrap', 'Text umbrechen', 'data-a="wrap"')}${tb('mergeCells', 'Zellen verbinden', 'data-a="merge"')}${tb('condfmt', 'Bedingte Formatierung', 'data-a="cf"')}${tb('dropdown', 'Dropdown-Liste (Datenüberprüfung)', 'data-a="dv"')}</div>
      <div class="tb-group">${tb('chart', 'Diagramm einfügen', 'data-a="chart"')}${tb('replace', 'Suchen & ersetzen (Strg+F)', 'data-a="find"')}</div>
    </div>
    <div class="findbar s-find" hidden>
      <input class="input" type="search" data-fq placeholder="Suchen …" aria-label="Suchbegriff">
      <span class="find-count" data-fcount aria-live="polite"></span>
      <button class="icon-btn" type="button" data-fprev aria-label="Vorheriger Treffer">${oicon('chevronUp')}</button>
      <button class="icon-btn" type="button" data-fnext aria-label="Nächster Treffer">${oicon('chevronDown')}</button>
      <input class="input" type="text" data-fr placeholder="Ersetzen durch …" aria-label="Ersetzen durch">
      <button class="btn btn-ghost btn-sm" type="button" data-frep>Ersetzen</button>
      <button class="btn btn-ghost btn-sm" type="button" data-freall>Alle</button>
      <button class="icon-btn" type="button" data-fclose aria-label="Suche schließen">${oicon('close')}</button>
    </div>
    <div class="fbar">
      <label class="sr-only" for="sh-addr">Zelladresse</label>
      <input class="sh-addr" id="sh-addr" value="A1" spellcheck="false" autocomplete="off">
      <span class="fx-label" aria-hidden="true">${oicon('fx')}</span>
      <label class="sr-only" for="sh-input">Inhalt der Zelle</label>
      <input class="sh-input" id="sh-input" spellcheck="false" autocomplete="off" enterkeyhint="done" placeholder="Wert oder =Formel">
      <button class="icon-btn fb-ok" type="button" data-commit aria-label="Eingabe übernehmen" hidden>${oicon('check')}</button>
      <button class="icon-btn fb-cancel" type="button" data-cancel aria-label="Eingabe verwerfen" hidden>${oicon('close')}</button>
    </div>
    <div class="sh-scroll" tabindex="0" aria-label="Tabellenraster" aria-describedby="sh-live">
      <div class="sh-inner">
        <div class="sh-colhead"><div class="sh-corner" title="Alles auswählen"></div><div class="sh-colcells"></div></div>
        <div class="sh-frozen" hidden><div class="sh-rowhead"></div><div class="sh-cells"></div></div>
        <div class="sh-body"><div class="sh-rowhead"></div><div class="sh-cells"></div></div>
        <div class="sh-charts"></div>
      </div>
    </div>
    <div class="sh-tabs" role="tablist" aria-label="Tabellenblätter"></div>
    <div class="sr-only" id="sh-live" aria-live="polite"></div>
  </div>`);
  screen.body.appendChild(root);
  const scroll = $('.sh-scroll', root), inner = $('.sh-inner', root);
  const colHead = $('.sh-colcells', root), corner = $('.sh-corner', root);
  const frozen = $('.sh-frozen', root), frozenRH = $('.sh-rowhead', frozen), frozenCells = $('.sh-cells', frozen);
  const body = $('.sh-body', root), bodyRH = $('.sh-rowhead', body), bodyCells = $('.sh-cells', body);
  const addrIn = $('#sh-addr', root), input = $('#sh-input', root);
  const live = $('#sh-live', root), tabs = $('.sh-tabs', root);
  const fmtSel = $('[data-fmt]', root);
  const status = h('<span class="foot-info sh-status"></span>');
  screen.foot.innerHTML = ''; screen.foot.appendChild(status); screen.foot.hidden = false; screen.foot.classList.add('office-foot');

  // ---------------- geometry ----------------
  let nRows = 100, nCols = 26, colX = [0];
  let hidden = new Set(), rowY = null;
  const colW = c => { const w = sh.colW[c]; return w == null ? DEFAULT_COL_W : w; };
  const rowHidden = r => hidden.has(r);
  const rowTop = r => (rowY ? (r <= nRows ? rowY[r] : rowY[nRows] + (r - nRows) * ROW_H) : r * ROW_H);
  const rowAt = y => {
    if (!rowY) return Math.max(0, Math.floor(y / ROW_H));
    if (y >= rowY[nRows]) return nRows + Math.floor((y - rowY[nRows]) / ROW_H);
    let lo = 0, hi = nRows - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (rowY[m] <= y) lo = m; else hi = m - 1; }
    while (lo < nRows - 1 && rowHidden(lo)) lo++;
    return Math.max(0, lo);
  };
  function layout() {
    nRows = Math.max(100, sh.maxR + 40, sel.r + 20, sel.ar + 20);
    nCols = Math.max(26, sh.maxC + 6, sel.c + 4, sel.ac + 4);
    colX = new Array(nCols + 1);
    colX[0] = 0;
    for (let c = 0; c < nCols; c++) colX[c + 1] = colX[c] + colW(c);
    hidden = new Set([...(sh.hiddenRows || []), ...filterHidden(sh)]);
    if (hidden.size) {
      rowY = new Float64Array(nRows + 1);
      for (let r = 0; r < nRows; r++) rowY[r + 1] = rowY[r] + (hidden.has(r) ? 0 : ROW_H);
    } else rowY = null;
    const f = Math.min(sh.freeze || 0, nRows);
    const totalW = colX[nCols];
    inner.style.width = `${HW + totalW}px`;
    inner.style.height = `${HH + rowTop(nRows)}px`;
    $('.sh-colhead', root).style.width = `${HW + totalW}px`;
    frozen.hidden = !f;
    frozen.style.height = `${rowTop(f)}px`;
    frozen.style.width = `${HW + totalW}px`;
    body.style.height = `${rowTop(nRows) - rowTop(f)}px`;
    body.style.width = `${HW + totalW}px`;
    $('[data-a="freeze"]', root).setAttribute('aria-pressed', String(!!f));
    $('[data-a="filter"]', root).setAttribute('aria-pressed', String(!!sh.autoFilter));
  }
  const colAt = x => { let lo = 0, hi = nCols - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (colX[m] <= x) lo = m; else hi = m - 1; } return lo; };

  // ---------------- rendering ----------------
  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; render(); }); };
  scroll.addEventListener('scroll', schedule, { passive: true });
  const ro = new ResizeObserver(schedule);
  ro.observe(scroll);

  function mergeAt(r, c) { return sh.merges.find(m => r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2); }
  let cfCache = new Map(), afRange = null;
  function afButton(r, c) {
    if (!afRange || r !== afRange.r1 || c < afRange.c1 || c > afRange.c2) return '';
    const on = sh.autoFilter.filters && Array.isArray(sh.autoFilter.filters[c]);
    return `<button class="af-btn${on ? ' on' : ''}" type="button" data-af="${c}" aria-label="Filter für Spalte ${colName(c)}${on ? ' (aktiv)' : ''}">${oicon(on ? 'filter' : 'chevronDown')}</button>`;
  }
  function borderCss(bd) {
    if (!bd) return '';
    const col = 'var(--cell-border, #1A1A1A)';
    let css = '';
    const sh2 = [];
    if (bd.t) sh2.push(`inset 0 1px 0 ${col}`);
    if (bd.l) sh2.push(`inset 1px 0 0 ${col}`);
    if (sh2.length) css += `box-shadow:${sh2.join(',')};`;
    if (bd.r) css += `border-right-color:${col};`;
    if (bd.b) css += `border-bottom-color:${col};`;
    return css;
  }
  function cellHtml(r, c, top, mergeSkip) {
    const cell = getCell(sh, r, c);
    let w = colW(c);
    if (w === 0) return '';
    let hgt = ROW_H;
    const m = sh.merges.length ? mergeAt(r, c) : null;
    if (m) {
      if (m.r1 !== r || m.c1 !== c) { if (!mergeSkip) return ''; }
      w = colX[Math.min(m.c2 + 1, nCols)] - colX[m.c1];
      hgt = rowTop(m.r2 + 1) - rowTop(m.r1);
    }
    const cfx = sh.cf.length ? cfStyle(sh, r, c, cell, cfCache) : null;
    if (!cell || (!cfx && !cell.s && cell.v == null && !cell.f)) {
      const af = afButton(r, c);
      return `<div class="c e${af ? ' has-af' : ''}" style="left:${colX[c]}px;top:${top}px;width:${w}px;height:${hgt}px">${af}</div>`;
    }
    const id = colName(c) + (r + 1);
    const s = cfx ? { ...(cell.s || {}), ...cfx } : (cell.s || {});
    const v = cell.f ? cell.cv : cell.v;
    const text = displayOf(cell);
    let cls = 'c';
    let align = s.align;
    if (!align) align = typeof v === 'number' ? 'right' : typeof v === 'boolean' || isErr(v) ? 'center' : 'left';
    if (align !== 'left') cls += ` a-${align}`;
    if (isErr(v)) cls += ' err';
    let style = `left:${colX[c]}px;top:${top}px;width:${w}px;height:${hgt}px;`;
    if (s.b) style += 'font-weight:700;';
    if (s.i) style += 'font-style:italic;';
    if (s.u) style += 'text-decoration:underline;';
    if (s.color) style += `color:${s.color};`;
    if (s.fill) style += `background:${s.fill};${s.color ? '' : 'color:#1A1A1A;'}`;
    if (s.size && s.size !== 11) style += `font-size:${Math.max(9, Math.min(28, s.size * 1.2))}px;`;
    if (s.bd) style += borderCss(s.bd);
    // let left-aligned text overflow into empty neighbours
    if (typeof v === 'string' && align === 'left' && !s.fill && !m && !s.wrap && !s.bd && !afButton(r, c)) {
      let k = c + 1, extra = 0;
      while (k < nCols && k < c + 12 && !getCell(sh, r, k)) { extra += colW(k); k++; }
      if (extra) { style += `--ow:${w + extra}px;`; cls += ' ovf'; }
    }
    if (s.wrap) cls += ' wrap';
    const af = afButton(r, c);
    if (af) cls += ' has-af';
    return `<div class="${cls}" data-cell="${id}" style="${style}">${esc(text)}${af}</div>`;
  }

  function render() {
    const st = scroll.scrollTop, sl = scroll.scrollLeft;
    const vw = scroll.clientWidth, vh = scroll.clientHeight;
    const f = Math.min(sh.freeze || 0, nRows);
    cfCache = new Map();
    afRange = sh.autoFilter ? parseRange(sh.autoFilter.range) : null;
    const r0 = Math.max(f, rowAt(rowTop(f) + st) - 2);
    const r1 = Math.min(nRows - 1, rowAt(rowTop(f) + st + vh) + 2);
    const c0 = Math.max(0, colAt(sl) - 1);
    const c1 = Math.min(nCols - 1, colAt(sl + vw - HW) + 1);
    // column headers
    let ch = '';
    const [sr1, sr2, sc1, sc2] = rangeBounds();
    for (let c = c0; c <= c1; c++) {
      const w = colW(c); if (!w) continue;
      ch += `<div class="ch${c >= sc1 && c <= sc2 ? ' on' : ''}" data-col="${c}" style="left:${colX[c]}px;width:${w}px">${colName(c)}<span class="rz" data-rz="${c}"></span></div>`;
    }
    colHead.innerHTML = ch;
    // rows
    const rowsHtml = (from, to, base) => {
      let rh = '', cells = '';
      for (let r = from; r <= to; r++) {
        if (rowY && rowHidden(r)) continue;
        const top = rowTop(r) - rowTop(base);
        rh += `<div class="rh${r >= sr1 && r <= sr2 ? ' on' : ''}${rowY && rowHidden(r + 1) ? ' hid-next' : ''}" data-row="${r}" style="top:${top}px">${r + 1}</div>`;
        for (let c = c0; c <= c1; c++) cells += cellHtml(r, c, top, false);
      }
      // merges whose origin is outside the window
      for (const m of sh.merges) {
        if (m.r2 < from || m.r1 > to || m.c2 < c0 || m.c1 > c1) continue;
        if (m.r1 >= from && m.c1 >= c0) continue;
        cells += cellHtml(m.r1, m.c1, rowTop(m.r1) - rowTop(base), true);
      }
      return [rh, cells];
    };
    if (f) {
      const [rh, cells] = rowsHtml(0, f - 1, 0);
      frozenRH.innerHTML = rh; frozenCells.innerHTML = cells + selHtml(0, f - 1, 0);
    } else if (frozenCells.firstChild) { frozenRH.innerHTML = ''; frozenCells.innerHTML = ''; }
    const [rh, cells] = rowsHtml(r0, r1, f);
    bodyRH.innerHTML = rh;
    bodyCells.innerHTML = cells + selHtml(f, nRows - 1, f);
    if (editing && editingInCell) placeEditor();
    placeDvButton();
  }

  function rangeBounds() { return [Math.min(sel.r, sel.ar), Math.max(sel.r, sel.ar), Math.min(sel.c, sel.ac), Math.max(sel.c, sel.ac)]; }
  function selHtml(from, to, base) {
    const [r1, r2, c1, c2] = rangeBounds();
    let out = '';
    const a = Math.max(r1, from), b = Math.min(r2, to);
    if (a <= b && (r1 !== r2 || c1 !== c2)) out += `<div class="sel-range" style="left:${colX[c1]}px;top:${rowTop(a) - rowTop(base)}px;width:${colX[Math.min(c2 + 1, nCols)] - colX[c1]}px;height:${rowTop(b + 1) - rowTop(a)}px"></div>`;
    if (sel.r >= from && sel.r <= to) {
      const m = mergeAt(sel.r, sel.c);
      const rr = m ? m.r1 : sel.r, cc = m ? m.c1 : sel.c;
      const w = m ? colX[m.c2 + 1] - colX[m.c1] : colW(sel.c);
      const hh = m ? rowTop(m.r2 + 1) - rowTop(m.r1) : ROW_H;
      out += `<div class="sel-active" style="left:${colX[cc]}px;top:${rowTop(rr) - rowTop(base)}px;width:${w}px;height:${hh}px"></div>`;
    }
    return out;
  }

  // ---------------- selection ----------------
  function select(r, c, extend = false, { scrollInto = true } = {}) {
    r = Math.max(0, Math.min(1048575, r)); c = Math.max(0, Math.min(16383, c));
    sel.r = r; sel.c = c;
    if (!extend) { sel.ar = r; sel.ac = c; }
    if (r >= nRows - 5 || c >= nCols - 2) layout();
    if (scrollInto) ensureVisible(r, c);
    updateBar();
    schedule();
  }
  function ensureVisible(r, c) {
    const f = sh.freeze || 0;
    const vw = scroll.clientWidth - HW, vh = scroll.clientHeight - HH - rowTop(f);
    if (r >= f) {
      const y = rowTop(r) - rowTop(f);
      if (y < scroll.scrollTop) scroll.scrollTop = y;
      else if (y + ROW_H > scroll.scrollTop + vh) scroll.scrollTop = y + ROW_H - vh;
    }
    const x = colX[c], w = colW(c);
    if (x < scroll.scrollLeft) scroll.scrollLeft = x;
    else if (x + w > scroll.scrollLeft + vw) scroll.scrollLeft = x + w - vw;
  }
  function updateBar() {
    const [r1, r2, c1, c2] = rangeBounds();
    addrIn.value = r1 === r2 && c1 === c2 ? addr(sel.r, sel.c) : `${addr(r1, c1)}:${addr(r2, c2)}`;
    const cell = getCell(sh, sel.r, sel.c);
    if (!editing) input.value = editTextOf(cell, toDisplay);
    const s = (cell && cell.s) || {};
    fmtSel.value = formatKind(s.fmt);
    $('[data-a="bold"]', root).setAttribute('aria-pressed', String(!!s.b));
    $('[data-a="italic"]', root).setAttribute('aria-pressed', String(!!s.i));
    $('[data-a="wrap"]', root).setAttribute('aria-pressed', String(!!s.wrap));
    $('[data-a="merge"]', root).setAttribute('aria-pressed', String(!!mergeAt(sel.r, sel.c)));
    live.textContent = `${addr(sel.r, sel.c)}: ${displayOf(cell) || 'leer'}`;
    // status: sum/avg/count of the selection
    if (r1 !== r2 || c1 !== c2) {
      let sum = 0, n = 0, cnt = 0;
      const maxR = Math.min(r2, sh.maxR), maxC = Math.min(c2, sh.maxC);
      for (let r = r1; r <= maxR; r++) for (let c = c1; c <= maxC; c++) {
        const x = getCell(sh, r, c); if (!x) continue;
        const v = x.f ? x.cv : x.v;
        if (v !== null && v !== '' && v !== undefined) cnt++;
        if (typeof v === 'number') { sum += v; n++; }
      }
      const f = v => v.toLocaleString('de-DE', { maximumFractionDigits: 4 });
      status.textContent = n ? `Summe: ${f(+sum.toPrecision(15))} · Mittelwert: ${f(sum / n)} · Anzahl: ${cnt}` : `Anzahl: ${cnt}`;
    } else status.textContent = `${sh.name} · ${Math.max(0, sh.maxR + 1).toLocaleString('de-DE')} Zeilen`;
  }

  // ---------------- editing ----------------
  let editing = false, editingInCell = false, cellEditor = null, editOrig = '';
  function startEdit(initial = null, inCell = true) {
    if (editing) return;
    editing = true; editingInCell = inCell;
    const cell = getCell(sh, sel.r, sel.c);
    editOrig = editTextOf(cell, toDisplay);
    input.value = initial != null ? initial : editOrig;
    $('[data-commit]', root).hidden = false; $('[data-cancel]', root).hidden = false;
    root.classList.add('is-editing');
    if (inCell) {
      cellEditor = h('<input class="cell-editor" spellcheck="false" autocomplete="off" aria-label="Zelle bearbeiten" enterkeyhint="done">');
      cellEditor.value = input.value;
      ((sel.r < (sh.freeze || 0)) ? frozen : body).appendChild(cellEditor);
      placeEditor();
      cellEditor.addEventListener('input', () => { input.value = cellEditor.value; });
      cellEditor.addEventListener('keydown', editKeys);
      cellEditor.addEventListener('blur', () => setTimeout(() => { if (editing && editingInCell && document.activeElement !== input && document.activeElement !== cellEditor && !pointMode) commit(); }, 120));
      cellEditor.focus();
      const len = cellEditor.value.length;
      cellEditor.setSelectionRange(len, len);
    }
  }
  function placeEditor() {
    if (!cellEditor) return;
    const f = sh.freeze || 0;
    const top = sel.r < f ? rowTop(sel.r) : rowTop(sel.r) - rowTop(f);
    cellEditor.style.left = `${HW + colX[sel.c]}px`;
    cellEditor.style.top = `${top}px`;
    cellEditor.style.minWidth = `${Math.max(colW(sel.c), 60)}px`;
    cellEditor.style.height = `${ROW_H}px`;
  }
  function endEdit() {
    editing = false; editingInCell = false; pointMode = false;
    if (cellEditor) { cellEditor.remove(); cellEditor = null; }
    $('[data-commit]', root).hidden = true; $('[data-cancel]', root).hidden = true;
    root.classList.remove('is-editing');
  }
  function commit(move = null) {
    if (!editing) return true;
    const text = input.value;
    if (text !== editOrig) {
      const dv = validationAt(sh, sel.r, sel.c);
      if (dv && text.trim() !== '' && !dv.list.some(x => x.toLocaleLowerCase('de') === text.trim().toLocaleLowerCase('de'))) {
        toast(`„${text.trim()}“ ist hier nicht erlaubt. Bitte wähle einen Wert aus der Liste.`, 'error', { timeout: 5000 });
        (cellEditor || input).focus();
        return false;
      }
      try {
        applyInput(sel.r, sel.c, text);
      } catch (e) {
        toast(`Formel ungültig: ${e.message || 'bitte prüfen'}`, 'error');
        (cellEditor || input).focus();
        return false;
      }
    }
    endEdit();
    if (move) select(sel.r + move[0], sel.c + move[1]);
    else { updateBar(); schedule(); }
    scroll.focus({ preventScroll: true });
    return true;
  }
  function cancel() { endEdit(); updateBar(); schedule(); scroll.focus({ preventScroll: true }); }

  function applyInput(r, c, text, { record = true } = {}) {
    const cur = getCell(sh, r, c);
    const p = parseInput(text, cur && cur.s && cur.s.fmt);
    if (record) pushUndo();
    const cell = {};
    if (cur && cur.s) cell.s = { ...cur.s };
    if (p.fmt) cell.s = { ...(cell.s || {}), fmt: p.fmt };
    if (p.f) cell.f = p.f; else cell.v = p.v;
    if (!cell.f && (cell.v === null || cell.v === undefined) && !cell.s) setCell(sh, r, c, null);
    else setCell(sh, r, c, cell);
    changed();
  }
  function changed() { recalc(wb); recomputeBounds(sh); shell.markDirty(); layout(); updateBar(); schedule(); scheduleCharts(); if (findOpen) runFind(false); }

  function editKeys(e) {
    if (e.key === 'Enter') { e.preventDefault(); commit(e.shiftKey ? [-1, 0] : [1, 0]); }
    else if (e.key === 'Tab') { e.preventDefault(); commit(e.shiftKey ? [0, -1] : [0, 1]); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  }
  input.addEventListener('focus', () => { if (!editing) startEdit(null, false); else if (editingInCell && cellEditor) { /* keep both in sync */ } });
  input.addEventListener('input', () => { if (cellEditor) cellEditor.value = input.value; });
  input.addEventListener('keydown', editKeys);
  input.addEventListener('blur', () => setTimeout(() => { if (editing && !editingInCell && document.activeElement !== input && !pointMode) commit(); }, 150));
  $('[data-commit]', root).addEventListener('mousedown', e => e.preventDefault());
  $('[data-commit]', root).addEventListener('click', () => commit());
  $('[data-cancel]', root).addEventListener('mousedown', e => e.preventDefault());
  $('[data-cancel]', root).addEventListener('click', () => cancel());
  addrIn.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const rg = parseRangeAddr(addrIn.value.trim());
    if (!rg) { toast('Ungültige Zelladresse (z. B. B7 oder A1:C5).', 'error'); return; }
    sel.ar = rg.r1; sel.ac = rg.c1;
    select(rg.r2, rg.c2, true);
    scroll.focus({ preventScroll: true });
  });
  addrIn.addEventListener('focus', () => addrIn.select());

  // point mode: clicking cells while typing a formula inserts references
  let pointMode = false;
  function formulaWantsRef() {
    const el = cellEditor || input;
    if (!editing || !el.value.startsWith('=')) return false;
    const pos = el.selectionStart ?? el.value.length;
    return /[=(;,+\-*/^&<>:]\s*$/.test(el.value.slice(0, pos));
  }
  function insertRef(text) {
    const el = cellEditor || input;
    const pos = el.selectionStart ?? el.value.length;
    el.value = el.value.slice(0, pos) + text + el.value.slice(el.selectionEnd ?? pos);
    const np = pos + text.length;
    if (cellEditor) input.value = cellEditor.value; else if (cellEditor) cellEditor.value = input.value;
    el.focus();
    el.setSelectionRange(np, np);
  }

  // ---------------- pointer ----------------
  function cellFromEvent(e) {
    const inFrozen = e.target.closest('.sh-frozen');
    const layer = inFrozen ? frozenCells : bodyCells;
    const rect = layer.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const base = inFrozen ? 0 : (sh.freeze || 0);
    return { r: Math.max(0, rowAt(rowTop(base) + Math.max(0, y))), c: colAt(Math.max(0, x)) };
  }
  let drag = null;
  scroll.addEventListener('pointerdown', e => {
    if (e.target.closest('.cell-editor')) return;
    if (e.button && e.button !== 0) return;
    if (e.target.closest('.sh-chart')) return;
    const afb = e.target.closest('[data-af]');
    if (afb) { e.preventDefault(); e.stopPropagation(); if (editing) commit(); filterMenu(+afb.dataset.af); return; }
    const dvb = e.target.closest('[data-dv]');
    if (dvb) { e.preventDefault(); e.stopPropagation(); if (editing) commit(); dvMenu(dvb); return; }
    if (chartSel) selectChart(null);
    const rz = e.target.closest('[data-rz]');
    if (rz && e.pointerType === 'mouse') { startResize(e, +rz.dataset.rz); return; }
    const chEl = e.target.closest('[data-col]');
    const rhEl = e.target.closest('[data-row]');
    if (e.target === corner || e.target.closest('.sh-corner')) { sel.ar = 0; sel.ac = 0; select(Math.max(sh.maxR, 0), Math.max(sh.maxC, 0), true, { scrollInto: false }); return; }
    if (chEl) { const c = +chEl.dataset.col; if (editing && formulaWantsRef()) { insertRef(`${colName(c)}:${colName(c)}`); e.preventDefault(); return; } if (editing) commit(); if (!e.shiftKey) { sel.ac = c; sel.ar = 0; } select(Math.max(sh.maxR, 0), c, true, { scrollInto: false }); return; }
    if (rhEl) { const r = +rhEl.dataset.row; if (editing) commit(); if (!e.shiftKey) { sel.ar = r; sel.ac = 0; } select(r, Math.max(sh.maxC, 0), true, { scrollInto: false }); return; }
    if (!e.target.closest('.sh-cells')) return;
    const { r, c } = cellFromEvent(e);
    if (editing) {
      if (formulaWantsRef() || pointMode) {
        e.preventDefault();
        pointMode = true;
        insertRef(addr(r, c));
        setTimeout(() => { pointMode = false; }, 200);
        return;
      }
      if (!commit()) return;
    }
    if (e.pointerType === 'mouse') {
      e.preventDefault();
      scroll.focus({ preventScroll: true });
      select(r, c, e.shiftKey, { scrollInto: false });
      drag = { pointerId: e.pointerId };
      scroll.setPointerCapture(e.pointerId);
    } else {
      drag = { touch: true, x: e.clientX, y: e.clientY, r, c, t: Date.now() };
    }
  });
  scroll.addEventListener('pointermove', e => {
    if (!drag || drag.touch) return;
    const { r, c } = cellFromEvent(e);
    if (r !== sel.r || c !== sel.c) select(r, c, true, { scrollInto: false });
  });
  scroll.addEventListener('pointerup', e => {
    if (drag && drag.touch) {
      const moved = Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 10;
      if (!moved) {
        const again = sel.r === drag.r && sel.c === drag.c && sel.r === sel.ar && sel.c === sel.ac;
        select(drag.r, drag.c, false, { scrollInto: false });
        if (again) startEdit();
      }
    }
    drag = null;
  });
  scroll.addEventListener('pointercancel', () => { drag = null; });
  scroll.addEventListener('dblclick', e => { if (e.target.closest('.sh-cells') && !e.target.closest('.cell-editor')) startEdit(); });

  function startResize(e, c) {
    e.preventDefault();
    const x0 = e.clientX, w0 = colW(c);
    const move = ev => { sh.colW[c] = Math.max(24, Math.round(w0 + ev.clientX - x0)); layout(); schedule(); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); shell.markDirty(); };
    pushUndo();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ---------------- keyboard ----------------
  scroll.addEventListener('keydown', e => {
    if (editing || e.target !== scroll) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key;
    const mv = (dr, dc) => {
      e.preventDefault();
      let r = sel.r + dr;
      if (rowY && dr) { const d = dr > 0 ? 1 : -1; while (r > 0 && r < nRows && rowHidden(r)) r += d; }
      select(r, sel.c + dc, e.shiftKey);
    };
    if (k === 'ArrowDown') return mv(ctrl ? jump(1, 0) : 1, 0);
    if (k === 'ArrowUp') return mv(ctrl ? -sel.r : -1, 0);
    if (k === 'ArrowRight') return mv(0, ctrl ? jump(0, 1) : 1);
    if (k === 'ArrowLeft') return mv(0, ctrl ? -sel.c : -1);
    if (k === 'Tab') return mv(0, e.shiftKey ? -1 : 1);
    if (k === 'Enter') { e.preventDefault(); select(sel.r + (e.shiftKey ? -1 : 1), sel.c); return; }
    if (k === 'PageDown') return mv(Math.floor(scroll.clientHeight / ROW_H), 0);
    if (k === 'PageUp') return mv(-Math.floor(scroll.clientHeight / ROW_H), 0);
    if (k === 'Home') { e.preventDefault(); select(ctrl ? 0 : sel.r, 0, e.shiftKey); return; }
    if (k === 'End' && ctrl) { e.preventDefault(); select(Math.max(0, sh.maxR), Math.max(0, sh.maxC), e.shiftKey); return; }
    if (k === 'F2') { e.preventDefault(); startEdit(); return; }
    if ((k === 'Delete' || k === 'Backspace') && chartSel) { e.preventDefault(); deleteChart(chartSel); return; }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); clearSelection(); return; }
    if (ctrl && (k.toLowerCase() === 'f' || k.toLowerCase() === 'h')) { e.preventDefault(); openFind(true); return; }
    if (ctrl && k.toLowerCase() === 'z') { e.preventDefault(); doUndo(); return; }
    if (ctrl && k.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return; }
    if (ctrl && k.toLowerCase() === 'b') { e.preventDefault(); toggleStyle('b'); return; }
    if (ctrl && k.toLowerCase() === 'i') { e.preventDefault(); toggleStyle('i'); return; }
    if (ctrl && k.toLowerCase() === 'a') { e.preventDefault(); sel.ar = 0; sel.ac = 0; select(Math.max(sh.maxR, 0), Math.max(sh.maxC, 0), true); return; }
    if (!ctrl && !e.altKey && k.length === 1) { e.preventDefault(); startEdit(k); }
  });
  function jump(dr, dc) {
    // Ctrl+Arrow: jump to the end of the data block
    let r = sel.r, c = sel.c;
    const filled = (rr, cc) => !!getCell(sh, rr, cc);
    const start = filled(r, c);
    let steps = 0;
    while (r + dr >= 0 && c + dc >= 0 && r + dr <= Math.max(sh.maxR, sel.r) + 1 && c + dc <= Math.max(sh.maxC, sel.c) + 1) {
      const nxt = filled(r + dr, c + dc);
      if (start && !nxt && steps) break;
      r += dr; c += dc; steps++;
      if (!start && nxt) break;
      if (start && !nxt) break;
    }
    return dr ? r - sel.r : c - sel.c;
  }

  // clipboard
  let internalClip = null;
  const onCopy = e => {
    if (editing || document.activeElement !== scroll) return;
    const [r1, r2, c1, c2] = rangeBounds();
    const lines = [];
    const cells = [];
    for (let r = r1; r <= Math.min(r2, Math.max(sh.maxR, r1)); r++) {
      const row = [];
      for (let c = c1; c <= Math.min(c2, Math.max(sh.maxC, c1)); c++) {
        const cell = getCell(sh, r, c);
        row.push(displayOf(cell));
        cells.push({ dr: r - r1, dc: c - c1, cell: cell ? { ...cell, s: cell.s ? { ...cell.s } : undefined } : null });
      }
      lines.push(row.join('\t'));
    }
    const text = lines.join('\n');
    internalClip = { text, cells, r1, c1, cut: e.type === 'cut' };
    e.clipboardData.setData('text/plain', text);
    e.preventDefault();
    if (e.type === 'cut') { clearSelection(); }
  };
  const onPaste = e => {
    if (editing || document.activeElement !== scroll) return;
    const text = e.clipboardData.getData('text/plain');
    e.preventDefault();
    pushUndo();
    if (internalClip && internalClip.text === text) {
      for (const { dr, dc, cell } of internalClip.cells) {
        const r = sel.r + dr, c = sel.c + dc;
        if (!cell) { setCell(sh, r, c, null); continue; }
        const n = { ...cell };
        delete n.cv0;
        if (n.f && !internalClip.cut) n.f = shiftRefs(n.f, ref => ({ ...ref, r: ref.absR || ref.colOnly ? ref.r : ref.r + (sel.r - internalClip.r1), c: ref.absC ? ref.c : ref.c + (sel.c - internalClip.c1) }));
        setCell(sh, r, c, n);
      }
    } else {
      const rows = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map(l => l.split('\t'));
      rows.forEach((row, dr) => row.forEach((val, dc) => {
        try { applyInput(sel.r + dr, sel.c + dc, val, { record: false }); } catch { setCell(sh, sel.r + dr, sel.c + dc, { v: val }); }
      }));
      if (rows.length && rows[0].length) { sel.ar = sel.r + rows.length - 1; sel.ac = sel.c + rows[0].length - 1; }
    }
    changed();
  };
  document.addEventListener('copy', onCopy);
  document.addEventListener('cut', onCopy);
  document.addEventListener('paste', onPaste);

  // ---------------- undo ----------------
  function snapshot() { return { si, cells: new Map(sh.cells), colW: sh.colW.slice(), merges: sh.merges.map(m => ({ ...m })), freeze: sh.freeze, ex: extrasSnapshot(sh) }; }
  function pushUndo() {
    undo.push(snapshot());
    const limit = sh.cells.size > 200000 ? 5 : 40;
    while (undo.length > limit) undo.shift();
    redo.length = 0;
  }
  function restore(s) {
    const target = wb.sheets[s.si];
    if (!target) return;
    target.cells = s.cells; target.colW = s.colW; target.merges = s.merges; target.freeze = s.freeze;
    if (s.ex) restoreExtras(target, s.ex);
    recomputeBounds(target);
    if (si !== s.si) switchSheet(s.si);
    changed();
  }
  function doUndo() { if (editing) { cancel(); return; } const s = undo.pop(); if (!s) { toast('Nichts zum Rückgängigmachen.'); return; } const t = wb.sheets[s.si]; redo.push({ si: s.si, cells: new Map(t.cells), colW: t.colW.slice(), merges: t.merges.map(m => ({ ...m })), freeze: t.freeze, ex: extrasSnapshot(t) }); restore(s); }
  function doRedo() { const s = redo.pop(); if (!s) return; const t = wb.sheets[s.si]; undo.push({ si: s.si, cells: new Map(t.cells), colW: t.colW.slice(), merges: t.merges.map(m => ({ ...m })), freeze: t.freeze, ex: extrasSnapshot(t) }); restore(s); }

  // ---------------- toolbar actions ----------------
  function forEachSel(fn, { createEmpty = true } = {}) {
    const [r1, r2, c1, c2] = rangeBounds();
    const R2 = Math.min(r2, Math.max(r1, sh.maxR)), C2 = Math.min(c2, Math.max(c1, sh.maxC));
    for (let r = r1; r <= R2; r++) for (let c = c1; c <= C2; c++) {
      const cur = getCell(sh, r, c);
      if (!cur && !createEmpty) continue;
      const n = cur ? { ...cur, s: { ...(cur.s || {}) } } : { v: null, s: {} };
      fn(n, r, c);
      if (n.s && !Object.keys(n.s).some(k => n.s[k] != null && n.s[k] !== false)) delete n.s;
      setCell(sh, r, c, n);
    }
  }
  function toggleStyle(key) {
    const cur = getCell(sh, sel.r, sel.c);
    const on = !(cur && cur.s && cur.s[key]);
    pushUndo();
    forEachSel(n => { n.s[key] = on || undefined; });
    changed();
  }
  function clearSelection() {
    pushUndo();
    const [r1, r2, c1, c2] = rangeBounds();
    for (let r = r1; r <= Math.min(r2, sh.maxR); r++) for (let c = c1; c <= Math.min(c2, sh.maxC); c++) {
      const cur = getCell(sh, r, c);
      if (!cur) continue;
      if (cur.s && cur.s.fill) setCell(sh, r, c, { v: null, s: cur.s }); else setCell(sh, r, c, null);
    }
    changed();
  }
  const SWATCH = ['#1A1A1A', '#B91C1C', '#C2410C', '#15803D', '#0B8F80', '#2F67D8', '#3B37A0', '#7E22CE'];
  const FILLS = ['#FDE047', '#FED7AA', '#FBCFE8', '#A7F3D0', '#BFDBFE', '#E9E8FB', '#E5E7EB'];
  const tbar = $('.office-toolbar', root);
  tbar.addEventListener('mousedown', e => { if (e.target.closest('button') && editing) e.preventDefault(); });
  tbar.addEventListener('click', e => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    if (editing && !['sum', 'fx'].includes(a)) { if (!commit()) return; }
    switch (a) {
      case 'undo': doUndo(); break;
      case 'redo': doRedo(); break;
      case 'bold': toggleStyle('b'); break;
      case 'italic': toggleStyle('i'); break;
      case 'color': officeMenu(b, [...SWATCH.map(c => ({ label: c === '#1A1A1A' ? 'Automatisch (schwarz)' : c, icon: 'color', onClick: () => { pushUndo(); forEachSel(n => { n.s.color = c === '#1A1A1A' ? undefined : c; }); changed(); } }))], { label: 'Textfarbe' }); break;
      case 'fill': officeMenu(b, [{ label: 'Keine Füllung', icon: 'close', onClick: () => { pushUndo(); forEachSel(n => { n.s.fill = undefined; }, { createEmpty: false }); changed(); } }, ...FILLS.map(c => ({ label: c, icon: 'fill', onClick: () => { pushUndo(); forEachSel(n => { n.s.fill = c; }); changed(); } }))], { label: 'Füllfarbe' }); break;
      case 'al-left': case 'al-center': case 'al-right': pushUndo(); forEachSel(n => { n.s.align = a.slice(3); }); changed(); break;
      case 'sum': autoSum(); break;
      case 'fx': officeMenu(b, FUNCTION_LIST.slice(0, 16).map(([n, d, ex]) => ({ label: `${n} – ${d}`, icon: 'fx', onClick: () => { if (!editing) startEdit('=' + ex); else insertRef(ex); } })), { label: 'Funktion einfügen' }); break;
      case 'row-add': { pushUndo(); const at = Math.min(sel.r, sel.ar), n = Math.abs(sel.r - sel.ar) + 1; insertRows(wb, si, at, n); shiftSheetRanges(sh, 'r', at, n, false); changed(); toast('Zeile eingefügt'); } break;
      case 'row-del': { pushUndo(); const at = Math.min(sel.r, sel.ar), n = Math.abs(sel.r - sel.ar) + 1; deleteRows(wb, si, at, n); shiftSheetRanges(sh, 'r', at, n, true); changed(); } break;
      case 'col-add': { pushUndo(); const at = Math.min(sel.c, sel.ac), n = Math.abs(sel.c - sel.ac) + 1; insertCols(wb, si, at, n); shiftSheetRanges(sh, 'c', at, n, false); changed(); toast('Spalte eingefügt'); } break;
      case 'col-del': { pushUndo(); const at = Math.min(sel.c, sel.ac), n = Math.abs(sel.c - sel.ac) + 1; deleteCols(wb, si, at, n); shiftSheetRanges(sh, 'c', at, n, true); changed(); } break;
      case 'border': borderMenu(b); break;
      case 'wrap': toggleStyle('wrap'); break;
      case 'merge': mergeAction(); break;
      case 'cf': cfDialog(); break;
      case 'filter': toggleFilter(); break;
      case 'dv': dvDialog(); break;
      case 'chart': insertChart(); break;
      case 'find': openFind(true); break;
      case 'sort-asc': case 'sort-desc': doSort(a === 'sort-asc'); break;
      case 'freeze': pushUndo(); sh.freeze = sh.freeze ? 0 : 1; shell.markDirty(); layout(); schedule(); toast(sh.freeze ? 'Erste Zeile fixiert' : 'Fixierung aufgehoben'); break;
    }
  });
  fmtSel.addEventListener('change', () => {
    pushUndo();
    const code = FORMATS[fmtSel.value].code;
    forEachSel(n => {
      n.s.fmt = code === 'General' ? undefined : code;
      if (fmtSel.value === 'date' && typeof n.v === 'string') { const p = parseInput(n.v, 'dd.mm.yyyy'); if (typeof p.v === 'number') n.v = p.v; }
    }, { createEmpty: true });
    changed();
    scroll.focus({ preventScroll: true });
  });
  function autoSum() {
    // find numbers above (or left) of the active cell
    let r = sel.r - 1;
    const isNum = (rr, cc) => { const x = getCell(sh, rr, cc); const v = x ? (x.f ? x.cv : x.v) : null; return typeof v === 'number'; };
    while (r >= 0 && isNum(r, sel.c)) r--;
    let ref;
    if (r < sel.r - 1) ref = `${addr(r + 1, sel.c)}:${addr(sel.r - 1, sel.c)}`;
    else {
      let c = sel.c - 1;
      while (c >= 0 && isNum(sel.r, c)) c--;
      ref = c < sel.c - 1 ? `${addr(sel.r, c + 1)}:${addr(sel.r, sel.c - 1)}` : '';
    }
    if (editing) cancel();
    startEdit(`=SUMME(${ref})`);
  }
  function doSort(asc) {
    const [r1, r2, c1, c2] = rangeBounds();
    let from = r1, to = r2, cs = c1, ce = c2;
    if (r1 === r2 && c1 === c2) {
      // single cell: sort the surrounding data block
      const reg = currentRegion(sh, sel.r, sel.c);
      from = reg.r1; to = reg.r2; cs = reg.c1; ce = reg.c2;
      const head = getCell(sh, from, sel.c), next = getCell(sh, from + 1, sel.c);
      const hv = head ? (head.f ? head.cv : head.v) : null, nv = next ? (next.f ? next.cv : next.v) : null;
      if ((sh.freeze && from < sh.freeze) || (typeof hv === 'string' && (typeof nv === 'number' || (head && head.s && head.s.b)))) from = Math.max(from + 1, sh.freeze || 0);
    } else if (r1 === r2) { from = sh.freeze || 0; to = sh.maxR; }
    to = Math.min(to, sh.maxR);
    if (to <= from) { toast('Nichts zu sortieren.'); return; }
    pushUndo();
    sortRows(wb, si, from, to, sel.c, asc, cs, ce);
    changed();
    toast(`Zeilen ${from + 1}–${to + 1} nach Spalte ${colName(sel.c)} sortiert`);
  }

  // ---------------- Rahmen, Umbruch, Verbinden ----------------
  function borderMenu(anchor) {
    const apply = mode => {
      pushUndo();
      const [r1, r2, c1, c2] = rangeBounds();
      forEachSel((n, r, c) => {
        if (mode === 'none') { delete n.s.bd; return; }
        const bd = { ...(n.s.bd || {}) };
        if (mode === 'all') Object.assign(bd, { t: true, r: true, b: true, l: true });
        if (mode === 'outer') { if (r === r1) bd.t = true; if (r === r2) bd.b = true; if (c === c1) bd.l = true; if (c === c2) bd.r = true; }
        if (mode === 'bottom' && r === r2) bd.b = true;
        if (mode === 'top' && r === r1) bd.t = true;
        n.s.bd = bd;
      });
      changed();
    };
    officeMenu(anchor, [
      { label: 'Alle Rahmenlinien', icon: 'table', onClick: () => apply('all') },
      { label: 'Außenrahmen', icon: 'border', onClick: () => apply('outer') },
      { label: 'Rahmen oben', icon: 'border', onClick: () => apply('top') },
      { label: 'Rahmen unten', icon: 'border', onClick: () => apply('bottom') },
      '-',
      { label: 'Kein Rahmen', icon: 'close', onClick: () => apply('none') },
    ], { label: 'Rahmen' });
  }
  function mergeAction() {
    const [r1, r2, c1, c2] = rangeBounds();
    const m = mergeAt(sel.r, sel.c);
    const exact = m && m.r1 === r1 && m.r2 === r2 && m.c1 === c1 && m.c2 === c2;
    if ((r1 === r2 && c1 === c2) || exact) {
      if (!m) { toast('Markiere mehrere Zellen, um sie zu verbinden.', 'info'); return; }
      pushUndo(); sh.merges = sh.merges.filter(x => x !== m); changed(); toast('Verbindung aufgehoben'); return;
    }
    pushUndo();
    sh.merges = sh.merges.filter(x => x.r2 < r1 || x.r1 > r2 || x.c2 < c1 || x.c1 > c2);
    let lost = 0;
    for (let r = r1; r <= Math.min(r2, sh.maxR); r++) for (let c = c1; c <= Math.min(c2, sh.maxC); c++) {
      if (r === r1 && c === c1) continue;
      const x = getCell(sh, r, c);
      if (x && (x.f || (x.v != null && x.v !== ''))) { lost++; setCell(sh, r, c, x.s ? { v: null, s: x.s } : null); }
    }
    sh.merges.push({ r1, c1, r2, c2 });
    sel.r = r1; sel.c = c1; sel.ar = r1; sel.ac = c1;
    changed();
    toast(lost ? 'Zellen verbunden – nur der Wert oben links bleibt erhalten.' : 'Zellen verbunden');
  }

  // ---------------- bedingte Formatierung ----------------
  async function cfDialog() {
    const [r1, r2, c1, c2] = rangeBounds();
    const def = rangeStr(r1 === r2 && c1 === c2 ? currentRegion(sh, sel.r, sel.c) : { r1, c1, r2, c2 });
    const rules = sh.cf;
    const r = await openDialog({
      title: 'Bedingte Formatierung', wide: true,
      body: `<div class="cf-dlg">
        ${rules.length ? `<div class="cf-list"><span class="field-label">Regeln auf diesem Blatt</span>${rules.map((x, i) => `<div class="cf-rule" data-i="${i}"><span class="cf-sw" style="background:${x.type === 'scale' ? 'linear-gradient(90deg,#F8696B,#FFEB84,#63BE7B)' : ((x.custom || CF_STYLES.find(s2 => s2.id === x.style) || {}).fill || 'transparent')}"></span><span>${esc(x.range)}: ${esc((CF_TYPES.find(t => t.id === x.type) || {}).label || '')} ${x.type === 'scale' ? '' : esc(x.v1 || '')}${x.type === 'between' ? ` und ${esc(x.v2 || '')}` : ''}</span><button class="icon-btn" type="button" data-del="${i}" aria-label="Regel entfernen">${oicon('trash')}</button></div>`).join('')}</div>` : ''}
        <span class="field-label">Neue Regel</span>
        <label class="field"><span class="field-label">Bereich</span><input class="input" name="range" value="${esc(def)}" spellcheck="false"></label>
        <div class="field-row"><label class="field"><span class="field-label">Wenn der Wert …</span><select class="select" name="type">${CF_TYPES.map(t => `<option value="${t.id}">${t.label}</option>`).join('')}</select></label>
          <label class="field cf-v1"><span class="field-label">Wert</span><input class="input" name="v1" inputmode="decimal"></label></div>
        <label class="field cf-v2" hidden><span class="field-label">und</span><input class="input" name="v2" inputmode="decimal"></label>
        <label class="field cf-style"><span class="field-label">dann formatieren als</span><select class="select" name="style">${CF_STYLES.map(st => `<option value="${st.id}">${st.label}</option>`).join('')}</select></label>
        <label class="field cf-scale" hidden><span class="field-label">Farbskala</span><select class="select" name="scale">${CF_SCALES.map(sc => `<option value="${sc.id}">${sc.label}</option>`).join('')}</select></label>
      </div>`,
      actions: [{ label: 'Schließen', value: 'cancel' }, { label: 'Regel hinzufügen', value: 'ok', kind: 'btn-primary', default: true }],
      validate: (v, dlg) => {
        if (v !== 'ok') return true;
        if (!parseRange($('[name=range]', dlg).value)) { toast('Bitte gib einen gültigen Bereich an, z. B. B2:B20.', 'error'); return false; }
        const t = $('[name=type]', dlg).value;
        if (t !== 'scale' && !$('[name=v1]', dlg).value.trim()) { toast('Bitte gib einen Vergleichswert ein.', 'error'); return false; }
        return true;
      },
      onMount: dlg => {
        const sync = () => {
          const t = $('[name=type]', dlg).value;
          $('.cf-v1', dlg).hidden = t === 'scale';
          $('.cf-v2', dlg).hidden = t !== 'between';
          $('.cf-style', dlg).hidden = t === 'scale';
          $('.cf-scale', dlg).hidden = t !== 'scale';
          $('[name=v1]', dlg).inputMode = t === 'contains' ? 'text' : 'decimal';
        };
        $('[name=type]', dlg).addEventListener('change', sync);
        sync();
        $$('[data-del]', dlg).forEach(bt => bt.addEventListener('click', () => { pushUndo(); sh.cf.splice(+bt.dataset.del, 1); changed(); bt.closest('.cf-rule').remove(); toast('Regel entfernt'); }));
        return { collect: () => ({ range: $('[name=range]', dlg).value.trim().toUpperCase(), type: $('[name=type]', dlg).value, v1: $('[name=v1]', dlg).value.trim(), v2: $('[name=v2]', dlg).value.trim(), style: $('[name=style]', dlg).value, scale: $('[name=scale]', dlg).value }) };
      },
    });
    if (r.value !== 'ok' || !r.data) return;
    pushUndo();
    sh.cf.push({ id: newChartId(), ...r.data, range: rangeStr(parseRange(r.data.range)) });
    changed();
    toast('Bedingte Formatierung angewendet', 'success');
  }

  // ---------------- AutoFilter ----------------
  function toggleFilter() {
    if (sh.autoFilter) { pushUndo(); sh.autoFilter = null; changed(); toast('Filter entfernt'); return; }
    const [r1, r2, c1, c2] = rangeBounds();
    const rg = r1 === r2 && c1 === c2 ? currentRegion(sh, sel.r, sel.c) : { r1, c1, r2: Math.min(r2, Math.max(r1, sh.maxR)), c2: Math.min(c2, Math.max(c1, sh.maxC)) };
    if (rg.r2 <= rg.r1) { toast('Markiere eine Tabelle mit Überschriftenzeile, um zu filtern.', 'info'); return; }
    pushUndo();
    sh.autoFilter = { range: rangeStr(rg), filters: {} };
    changed();
    toast('Filter aktiviert – tippe auf ▾ in der Kopfzeile.');
  }
  async function filterMenu(c) {
    const af = sh.autoFilter;
    if (!af) return;
    const vals = columnValues(sh, c);
    const cur = Array.isArray(af.filters[c]) ? new Set(af.filters[c]) : null;
    const r = await openDialog({
      title: `Filter: Spalte ${colName(c)}`,
      body: `<div class="af-dlg">
        <div class="af-sort"><button class="btn btn-ghost btn-sm" type="button" data-sort="asc">${oicon('sortAsc')} A → Z</button><button class="btn btn-ghost btn-sm" type="button" data-sort="desc">${oicon('sortDesc')} Z → A</button></div>
        <input class="input" type="search" data-q placeholder="Werte durchsuchen" aria-label="Werte durchsuchen">
        <label class="check af-all"><input type="checkbox" data-all> <strong>Alle auswählen</strong></label>
        <div class="af-list">${vals.map((v, i) => `<label class="check af-item"><input type="checkbox" value="${i}" ${!cur || cur.has(v.text) ? 'checked' : ''}> <span>${esc(v.text)}</span><span class="muted small">${v.n}</span></label>`).join('')}</div>
      </div>`,
      actions: [{ label: 'Filter löschen', value: 'clear' }, { label: 'Abbrechen', value: 'cancel' }, { label: 'OK', value: 'ok', kind: 'btn-primary', default: true }],
      onMount: dlg => {
        const boxes = $$('.af-item input', dlg), all = $('[data-all]', dlg);
        const syncAll = () => { const n = boxes.filter(b => b.checked).length; all.checked = n === boxes.length; all.indeterminate = n > 0 && n < boxes.length; };
        syncAll();
        all.addEventListener('change', () => { boxes.forEach(b => { if (!b.closest('label').hidden) b.checked = all.checked; }); syncAll(); });
        boxes.forEach(b => b.addEventListener('change', syncAll));
        $('[data-q]', dlg).addEventListener('input', e => { const q = e.target.value.toLocaleLowerCase('de'); boxes.forEach((b, i) => { b.closest('label').hidden = !!q && !vals[i].text.toLocaleLowerCase('de').includes(q); }); });
        $$('[data-sort]', dlg).forEach(b => b.addEventListener('click', () => { dlg._sort = b.dataset.sort; dlg.close(); }));
        return { collect: () => boxes.filter(b => b.checked).map(b => vals[+b.value].text) };
      },
    });
    if (r.dialog && r.dialog._sort) {
      const rg = parseRange(af.range);
      pushUndo();
      sortRows(wb, si, rg.r1 + 1, Math.min(rg.r2, sh.maxR), c, r.dialog._sort === 'asc', rg.c1, rg.c2);
      changed(); toast(r.dialog._sort === 'asc' ? 'Aufsteigend sortiert' : 'Absteigend sortiert');
      return;
    }
    if (r.value === 'clear') { pushUndo(); delete af.filters[c]; changed(); return; }
    if (r.value !== 'ok' || !r.data) return;
    pushUndo();
    if (r.data.length === vals.length) delete af.filters[c]; else af.filters[c] = r.data;
    changed();
    const hiddenN = filterHidden(sh).size;
    toast(hiddenN ? `${hiddenN} Zeile${hiddenN === 1 ? '' : 'n'} ausgeblendet` : 'Alle Zeilen sichtbar');
  }

  // ---------------- Datenvalidierung (Dropdown) ----------------
  async function dvDialog() {
    const [r1, r2, c1, c2] = rangeBounds();
    const existing = validationAt(sh, sel.r, sel.c);
    const r = await openDialog({
      title: 'Dropdown-Liste',
      body: `<p class="small">In den gewählten Zellen sind dann nur diese Werte erlaubt – auswählbar über den kleinen Pfeil.</p>
        <label class="field"><span class="field-label">Bereich</span><input class="input" name="range" value="${esc(existing ? existing.range : rangeStr({ r1, c1, r2, c2 }))}" spellcheck="false"></label>
        <label class="field"><span class="field-label">Erlaubte Werte (je Zeile einer)</span><textarea class="input dv-ta" name="list" rows="6" placeholder="Offen&#10;In Arbeit&#10;Erledigt">${esc(existing ? existing.list.join('\n') : '')}</textarea></label>`,
      actions: [...(existing ? [{ label: 'Entfernen', value: 'remove', kind: 'btn-danger-ghost' }] : []), { label: 'Abbrechen', value: 'cancel' }, { label: 'Übernehmen', value: 'ok', kind: 'btn-primary', default: true }],
      validate: (v, dlg) => {
        if (v !== 'ok') return true;
        if (!parseRange($('[name=range]', dlg).value)) { toast('Bitte gib einen gültigen Bereich an.', 'error'); return false; }
        if (!parseList($('[name=list]', dlg).value).length) { toast('Bitte gib mindestens einen Wert ein.', 'error'); return false; }
        return true;
      },
      onMount: dlg => ({ collect: () => ({ range: $('[name=range]', dlg).value.trim().toUpperCase(), list: parseList($('[name=list]', dlg).value) }) }),
    });
    if (r.value === 'remove' && existing) { pushUndo(); sh.dv = sh.dv.filter(x => x !== existing); changed(); toast('Dropdown-Liste entfernt'); return; }
    if (r.value !== 'ok' || !r.data) return;
    pushUndo();
    if (existing) sh.dv = sh.dv.filter(x => x !== existing);
    sh.dv.push({ range: rangeStr(parseRange(r.data.range)), list: r.data.list });
    changed();
    toast('Dropdown-Liste angelegt', 'success');
  }
  function placeDvButton() {
    const old = $('.dv-btn', root);
    const dv = validationAt(sh, sel.r, sel.c);
    if (!dv || editing) { if (old) old.remove(); return; }
    const f = sh.freeze || 0;
    const layer = sel.r < f ? frozenCells : bodyCells;
    const btn = old || h(`<button class="dv-btn" type="button" data-dv aria-label="Wert aus Liste wählen">${oicon('chevronDown')}</button>`);
    const m = mergeAt(sel.r, sel.c);
    const right = m ? colX[m.c2 + 1] : colX[sel.c + 1];
    btn.style.left = `${right + 2}px`;
    btn.style.top = `${(sel.r < f ? rowTop(sel.r) : rowTop(sel.r) - rowTop(f)) + 2}px`;
    if (btn.parentElement !== layer) layer.appendChild(btn);
  }
  function dvMenu(anchor) {
    const dv = validationAt(sh, sel.r, sel.c);
    if (!dv) return;
    officeMenu(anchor, [
      ...dv.list.map(v => ({ label: v, icon: 'check', onClick: () => { applyInput(sel.r, sel.c, v); scroll.focus({ preventScroll: true }); } })),
      '-', { label: 'Leeren', icon: 'close', onClick: () => { applyInput(sel.r, sel.c, ''); } },
    ], { label: 'Wert wählen' });
  }

  // ---------------- Suchen & Ersetzen ----------------
  const fbar = $('.s-find', root);
  const fq = $('[data-fq]', fbar), fr = $('[data-fr]', fbar), fcount = $('[data-fcount]', fbar);
  let findOpen = false, fmatches = [], fcur = -1;
  function openFind(focus) {
    findOpen = true; fbar.hidden = false;
    $('[data-a="find"]', root).setAttribute('aria-pressed', 'true');
    if (focus) setTimeout(() => { fq.focus(); fq.select(); }, 30);
    runFind(true);
  }
  function closeFind() { findOpen = false; fbar.hidden = true; fmatches = []; $('[data-a="find"]', root).setAttribute('aria-pressed', 'false'); scroll.focus({ preventScroll: true }); }
  function runFind(jump) {
    const q = fq.value.toLocaleLowerCase('de');
    fmatches = [];
    if (q) {
      const keys = [...sh.cells.keys()].sort((a, b) => a - b);
      for (const k of keys) {
        const cell = sh.cells.get(k);
        const t = displayOf(cell).toLocaleLowerCase('de');
        if (t.includes(q) || (cell.f && ('=' + toDisplay(cell.f)).toLocaleLowerCase('de').includes(q))) fmatches.push({ r: R_OF(k), c: C_OF(k) });
      }
    }
    if (jump || fcur >= fmatches.length) fcur = fmatches.length ? 0 : -1;
    fcount.textContent = fq.value ? (fmatches.length ? `${fcur + 1} von ${fmatches.length}` : 'Keine Treffer') : '';
    fcount.classList.toggle('notfound', !!fq.value && !fmatches.length);
    if (jump && fcur >= 0) select(fmatches[fcur].r, fmatches[fcur].c);
  }
  const fstep = d => { if (!fmatches.length) return; fcur = (fcur + d + fmatches.length) % fmatches.length; fcount.textContent = `${fcur + 1} von ${fmatches.length}`; select(fmatches[fcur].r, fmatches[fcur].c); };
  function replaceIn(r, c) {
    const cell = getCell(sh, r, c);
    if (!cell || cell.f) return false;
    const txt = editTextOf(cell, toDisplay);
    const re = new RegExp(fq.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    if (!re.test(txt)) return false;
    const next = txt.replace(re, fr.value);
    const p = parseInput(next, cell.s && cell.s.fmt);
    const n = { ...cell };
    delete n.cv; delete n.cv0;
    if (p.f) { n.f = p.f; delete n.v; } else n.v = p.v;
    setCell(sh, r, c, n.v == null && !n.f && !n.s ? null : n);
    return true;
  }
  fq.addEventListener('input', () => runFind(true));
  fq.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); fstep(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') closeFind(); });
  $('[data-fnext]', fbar).addEventListener('click', () => fstep(1));
  $('[data-fprev]', fbar).addEventListener('click', () => fstep(-1));
  $('[data-fclose]', fbar).addEventListener('click', closeFind);
  $('[data-frep]', fbar).addEventListener('click', () => {
    if (fcur < 0 || !fmatches[fcur]) return;
    pushUndo();
    const m = fmatches[fcur];
    if (!replaceIn(m.r, m.c)) toast('Formeln werden beim Ersetzen nicht verändert.', 'info');
    changed(); runFind(false); if (fmatches.length) select(fmatches[Math.min(fcur, fmatches.length - 1)].r, fmatches[Math.min(fcur, fmatches.length - 1)].c);
  });
  $('[data-freall]', fbar).addEventListener('click', () => {
    if (!fmatches.length) return;
    pushUndo();
    let n = 0, skipped = 0;
    for (const m of fmatches) { if (replaceIn(m.r, m.c)) n++; else skipped++; }
    changed(); runFind(true);
    toast(`${n} Zelle${n === 1 ? '' : 'n'} ersetzt${skipped ? ` · ${skipped} Formel${skipped === 1 ? '' : 'n'} unverändert` : ''}`, 'success');
  });

  // ---------------- Diagramme ----------------
  const chartsLayer = $('.sh-charts', root);
  let chartSel = null, chartRaf = 0;
  const darkMode = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  const chartTop = ch => { const y = ch.y || 0; const r = Math.floor(y / ROW_H); return rowTop(r) + (y - r * ROW_H); };
  function scheduleCharts() { if (!chartRaf) chartRaf = requestAnimationFrame(() => { chartRaf = 0; renderCharts(); }); }
  function renderCharts() {
    const mode = darkMode() ? 'dark' : 'light';
    chartsLayer.innerHTML = '';
    for (const ch of sh.charts) {
      const el = h(`<div class="sh-chart${chartSel === ch.id ? ' sel' : ''}" data-chart="${ch.id}" tabindex="0" role="figure" aria-label="Diagramm ${esc(ch.title || '')}" style="left:${ch.x}px;top:${chartTop(ch)}px;width:${ch.w}px;height:${ch.h}px">
        <div class="shc-svg"></div><button class="shc-more icon-btn" type="button" aria-label="Diagramm-Aktionen">${oicon('more')}</button><span class="shc-handle" aria-hidden="true"></span></div>`);
      try { $('.shc-svg', el).innerHTML = chartSvg(ch, chartData(wb, sh, ch, mode), { w: ch.w, h: ch.h, mode }); } catch (e) { console.warn(e); }
      chartsLayer.appendChild(el);
    }
  }
  function selectChart(id) {
    chartSel = id;
    $$('.sh-chart', chartsLayer).forEach(x => x.classList.toggle('sel', x.dataset.chart === id));
  }
  function deleteChart(id) {
    pushUndo();
    sh.charts = sh.charts.filter(x => x.id !== id);
    chartSel = null; shell.markDirty(); renderCharts();
    toast('Diagramm gelöscht', 'info', { action: { label: 'Rückgängig', onClick: doUndo } });
  }
  async function insertChart(existing = null) {
    if (editing) commit();
    const { chartDialog } = await import('./chart.js');
    const [r1, r2, c1, c2] = rangeBounds();
    const rg = existing ? null : (r1 === r2 && c1 === c2 ? currentRegion(sh, sel.r, sel.c) : { r1, c1, r2, c2 });
    const mode = darkMode() ? 'dark' : 'light';
    const init = existing ? { ...existing } : { range: rangeStr(rg), type: 'col' };
    if (existing && !existing.range) init.range = '';
    const res = await chartDialog(init, { getData: draft => chartData(wb, sh, draft, mode), title: existing ? 'Diagramm bearbeiten' : 'Diagramm einfügen', mode });
    if (!res) return;
    pushUndo();
    const phone = matchMedia('(max-width: 720px)').matches;
    const cfg = { type: res.type, range: rangeStr(parseRange(res.range)), title: res.title.trim(), xTitle: res.xTitle.trim(), yTitle: res.yTitle.trim(), legend: res.legend, palette: res.palette, byRows: res.byRows, series: null, colors: null };
    if (existing) Object.assign(existing, cfg);
    else {
      const pr = parseRange(cfg.range);
      const w = phone ? 330 : 480, hh = phone ? 230 : 300;
      // next to the used data (not on top of it); stack below charts that are already there
      const x = phone ? 8 : Math.max(0, colX[Math.min(Math.max(pr.c2, sh.maxC) + 1, nCols)] + 16);
      let y = phone ? (Math.max(pr.r2, sh.maxR) + 2) * ROW_H : pr.r1 * ROW_H;
      const hit = yy => sh.charts.some(o => o.x < x + w && x < o.x + o.w && o.y < yy + hh && yy < o.y + o.h);
      let guard = 0;
      while (hit(y) && guard++ < 50) y = Math.max(...sh.charts.filter(o => o.x < x + w && x < o.x + o.w && o.y < y + hh && y < o.y + o.h).map(o => o.y + o.h)) + 16;
      sh.charts.push({ id: newChartId(), ...cfg, x, y, w, h: hh });
      chartSel = sh.charts[sh.charts.length - 1].id;
    }
    shell.markDirty(); renderCharts();
    const el = $(`.sh-chart[data-chart="${chartSel || (existing && existing.id)}"]`, chartsLayer);
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    toast(existing ? 'Diagramm aktualisiert' : 'Diagramm eingefügt – ziehen zum Verschieben, Ecke zum Vergrößern.', 'success');
  }
  let cdrag = null;
  chartsLayer.addEventListener('pointerdown', e => {
    const el = e.target.closest('.sh-chart');
    if (!el) return;
    e.stopPropagation();
    if (editing) commit();
    const ch = sh.charts.find(x => x.id === el.dataset.chart);
    if (!ch) return;
    selectChart(ch.id);
    if (e.target.closest('.shc-more')) {
      e.preventDefault();
      officeMenu(e.target.closest('.shc-more'), [
        { label: 'Bearbeiten …', icon: 'edit', onClick: () => insertChart(ch) },
        { label: 'Nach vorne', icon: 'arrowUp', onClick: () => { pushUndo(); sh.charts = [...sh.charts.filter(x => x !== ch), ch]; shell.markDirty(); renderCharts(); } },
        '-', { label: 'Diagramm löschen', icon: 'trash', danger: true, onClick: () => deleteChart(ch.id) },
      ], { label: 'Diagramm' });
      return;
    }
    e.preventDefault();
    cdrag = { ch, el, x: e.clientX, y: e.clientY, ox: ch.x, oy: ch.y, ow: ch.w, oh: ch.h, resize: !!e.target.closest('.shc-handle'), moved: false };
    el.setPointerCapture(e.pointerId);
  });
  chartsLayer.addEventListener('pointermove', e => {
    if (!cdrag) return;
    const dx = e.clientX - cdrag.x, dy = e.clientY - cdrag.y;
    if (!cdrag.moved && Math.hypot(dx, dy) < 4) return;
    if (!cdrag.moved) { pushUndo(); cdrag.moved = true; }
    const ch = cdrag.ch;
    if (cdrag.resize) { ch.w = Math.max(200, Math.round(cdrag.ow + dx)); ch.h = Math.max(140, Math.round(cdrag.oh + dy)); }
    else { ch.x = Math.max(0, Math.round(cdrag.ox + dx)); ch.y = Math.max(0, Math.round(cdrag.oy + dy)); }
    cdrag.el.style.left = `${ch.x}px`; cdrag.el.style.top = `${chartTop(ch)}px`; cdrag.el.style.width = `${ch.w}px`; cdrag.el.style.height = `${ch.h}px`;
  });
  const endChartDrag = () => { if (!cdrag) return; const d = cdrag; cdrag = null; if (d.moved) { shell.markDirty(); renderCharts(); } };
  chartsLayer.addEventListener('pointerup', endChartDrag);
  chartsLayer.addEventListener('pointercancel', endChartDrag);
  chartsLayer.addEventListener('dblclick', e => { const el = e.target.closest('.sh-chart'); if (el) { const ch = sh.charts.find(x => x.id === el.dataset.chart); if (ch) insertChart(ch); } });
  chartsLayer.addEventListener('keydown', e => {
    const el = e.target.closest('.sh-chart');
    if (!el) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteChart(el.dataset.chart); }
    if (e.key === 'Enter') { e.preventDefault(); const ch = sh.charts.find(x => x.id === el.dataset.chart); if (ch) insertChart(ch); }
  });
  const themeObs = new MutationObserver(() => renderCharts());
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ---------------- sheet tabs ----------------
  function renderTabs() {
    tabs.innerHTML = '';
    wb.sheets.forEach((s, i) => {
      const t = h(`<button class="sh-tab" role="tab" type="button" aria-selected="${i === si}">${esc(s.name)}</button>`);
      t.addEventListener('click', () => { if (i === si) tabMenu(t, i); else { if (editing) commit(); switchSheet(i); } });
      t.addEventListener('contextmenu', e => { e.preventDefault(); tabMenu(t, i); });
      tabs.appendChild(t);
    });
    const add = h(`<button class="sh-tab add" type="button" aria-label="Blatt hinzufügen">${oicon('plus')}</button>`);
    add.addEventListener('click', () => {
      let n = wb.sheets.length + 1;
      while (wb.sheets.some(s => s.name.toLowerCase() === `tabelle${n}`)) n++;
      wb.sheets.push(newSheet(`Tabelle${n}`));
      shell.markDirty();
      switchSheet(wb.sheets.length - 1);
    });
    tabs.appendChild(add);
  }
  function tabMenu(anchor, i) {
    officeMenu(anchor, [
      { label: 'Umbenennen', icon: 'edit', onClick: async () => {
        const n = await promptDialog('Blatt umbenennen', 'Name', wb.sheets[i].name, { okLabel: 'Übernehmen' });
        if (n == null) return;
        const clean = n.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31);
        if (!clean || wb.sheets.some((s, k) => k !== i && s.name.toLowerCase() === clean.toLowerCase())) { toast('Dieser Name ist ungültig oder schon vergeben.', 'error'); return; }
        const old = wb.sheets[i].name;
        wb.sheets[i].name = clean;
        // update references in formulas
        wb.sheets.forEach(s => s.cells.forEach(cell => { if (cell.f && cell.f.includes('!')) cell.f = shiftRefs(cell.f, ref => ref).replace(new RegExp(`(^|[^\\w'])'?${old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'?!`, 'g'), (m, p) => `${p}${/^[A-Za-z_][\w.]*$/.test(clean) ? clean : `'${clean}'`}!`); }));
        recalc(wb); shell.markDirty(); renderTabs(); updateBar(); schedule();
      } },
      { label: 'Nach links', icon: 'arrowLeft', disabled: i === 0, onClick: () => moveSheet(i, -1) },
      { label: 'Nach rechts', icon: 'arrowRight', disabled: i === wb.sheets.length - 1, onClick: () => moveSheet(i, 1) },
      { label: 'Blatt löschen', icon: 'trash', danger: true, disabled: wb.sheets.length < 2, onClick: async () => {
        if (!await confirmDialog('Blatt löschen?', `„${wb.sheets[i].name}“ und alle Inhalte werden entfernt.`, { okLabel: 'Löschen', danger: true })) return;
        wb.sheets.splice(i, 1); undo.length = 0; redo.length = 0;
        recalc(wb); shell.markDirty(); switchSheet(Math.max(0, i - 1));
      } },
    ], { label: 'Blatt' });
  }
  function moveSheet(i, d) {
    const [s] = wb.sheets.splice(i, 1);
    wb.sheets.splice(i + d, 0, s);
    undo.length = 0; redo.length = 0;
    shell.markDirty(); switchSheet(i + d);
  }
  function switchSheet(i) {
    si = i; sh = wb.sheets[i];
    sel.r = sel.c = sel.ar = sel.ac = 0;
    scroll.scrollTop = 0; scroll.scrollLeft = 0;
    selectChart(null);
    layout(); renderTabs(); updateBar(); schedule(); renderCharts();
    if (findOpen) runFind(true);
  }

  // ---------------- init ----------------
  layout(); renderTabs(); updateBar(); render(); renderCharts();
  setTimeout(() => scroll.focus({ preventScroll: true }), 60);
  screen.onDropFiles = () => toast('Öffne Tabellen über „Dateien“.', 'info');

  // test/automation hook (read-only access)
  root._sheetApi = { wb: () => wb, sheet: () => sh, select: (a) => { const p = parseRangeAddr(a); if (p) { sel.ar = p.r1; sel.ac = p.c1; select(p.r2, p.c2, true); } }, input: (a, text) => { const p = parseAddr(a); applyInput(p.r, p.c, text); }, hiddenRows: () => [...hidden], charts: () => sh.charts };

  return () => {
    document.removeEventListener('copy', onCopy);
    document.removeEventListener('cut', onCopy);
    document.removeEventListener('paste', onPaste);
    ro.disconnect();
    themeObs.disconnect();
    if (raf) cancelAnimationFrame(raf);
    if (chartRaf) cancelAnimationFrame(chartRaf);
    screen.officeCleanup && screen.officeCleanup();
  };
}

function buildTemplate(id) {
  const t = SHEET_TEMPLATES.find(x => x.id === id);
  const wb = newWorkbook();
  if (!t || !t.cells) return wb;
  const def = t.cells();
  const sh = wb.sheets[0];
  sh.name = t.title.slice(0, 31);
  def.rows.forEach((row, r) => row.forEach((item, c) => {
    if (item === '' || item == null) return;
    let val = item, style = null;
    if (Array.isArray(item)) [val, style] = item;
    const cell = {};
    if (style) cell.s = { ...style };
    if (val && typeof val === 'object' && val.date) { cell.v = dateToSerial(val.date); cell.s = { ...(cell.s || {}), fmt: 'dd.mm.yyyy' }; }
    else if (typeof val === 'string' && val.startsWith('=')) cell.f = parseInput(val).f;
    else cell.v = val;
    if (def.fmt && def.fmt.cols.includes(c) && r >= def.fmt.from) cell.s = { ...(cell.s || {}), fmt: def.fmt.code };
    setCell(sh, r, c, cell);
  }));
  (def.widths || []).forEach((w, i) => { sh.colW[i] = w; });
  sh.freeze = def.freeze || 0;
  return wb;
}
