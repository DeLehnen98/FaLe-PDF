// Tabellenkalkulation: virtualised grid editor for .xlsx/.csv with formulas, formats, sheets, AutoFill,
// clipboard, multi-selection, frozen panes, row heights, pivot tables, named ranges and more.
import * as db from '../db.js';
import { $, $$, h, esc, toast, errorToast, promptDialog, confirmDialog, downloadBlob, shareBlob, openDialog } from '../ui.js';
import { createShell, exportPdfFlow, tb } from './shell.js';
import { officeMenu, oicon, KINDS, stripExt } from './kinds.js';
import { newWorkbook, newSheet, getCell, setCell, recalc, recalcCells, displayOf, formatCell, formatValue, editTextOf, parseInput, formatKind, FORMATS, KEY, R_OF, C_OF,
  DEFAULT_COL_W, ROW_H, insertRows, deleteRows, insertCols, deleteCols, sortRows, sortRowsMulti, recomputeBounds, currentRegion, valueAt, ensureSheetModel, findName, CELL_STYLES, invalidateDeps, makeCtx } from './workbook.js';
import { colName, addr, parseAddr, parseRangeAddr, toDisplay, toCanonical, shiftRefs, renameSheetRefs, isErr, FUNCTION_LIST, dateToSerial, compile, precedents, isValidName, KNOWN_FUNCTIONS, canonicalFn, quoteSheet, evaluate, FN_ARGS } from './formula.js';
import { t as tr } from '../i18n/index.js';
import { openExternal } from '../security.js';
import { SHEET_TEMPLATES } from './templates.js';
import { buildSheetTemplate } from './sheet-templates.js';
import { ensureSheetExtras, cfStyle, filterHidden, columnValues, validationAt, shiftSheetRanges, extrasSnapshot, restoreExtras, rangeStr, parseRange, CF_TYPES, CF_STYLES, CF_SCALES, EMPTY, dvAllows, dvDescribe, cfDescribe, CF_NEEDS_V1, CF_BARS, CF_ICONS, noteAt, linkAt, safeUrl, pageOf } from './sheetfx.js';
import { chartSvg, chartData, newChartId } from './chart.js';
import { planFill, parseTsv, toTsv, parseHtmlTable } from './sheet-ops.js';
import * as D from './sheet-dialogs.js';
import { FONTS, fontCss } from './fonts.js';
import { aiHidden } from '../ai/hidden.js';

const HW = 46, HH = 26;
const ROW_PX_PER_PT = 28 / 15;
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');

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
    name = (t && t.id !== 'leer' ? t.title.replace(/[\\/:*?"<>|]+/g, '-') : 'Neue Tabelle') + '.xlsx';
  }
  if (screen.signal.aborted) return;
  wb.names = wb.names || [];
  wb.sheets.forEach(s => { ensureSheetExtras(s); ensureSheetModel(s); });
  recalc(wb);

  let si = 0;
  let sh = wb.sheets[0];
  const sel = { r: 0, c: 0, ar: 0, ac: 0, more: [], box: null }; // active + anchor + extra ranges (Ctrl+click); box: range when the active cell walks inside it
  const undo = [], redo = [];
  let showFormulas = false;

  const shell = createShell(screen, {
    id, name, kind,
    serialize: () => serialize(kind),
    menu: () => [
      { label: 'Als PDF exportieren', icon: 'kpdf', onClick: exportPdf },
      { label: 'Seite einrichten …', icon: 'pageSetup', onClick: () => pageSetup() },
      { label: 'Excel-Datei (.xlsx) herunterladen', icon: 'download', onClick: async () => downloadBlob(await serialize('xlsx'), stripExt(shell.name) + '.xlsx') },
      { label: 'Blatt als CSV herunterladen', icon: 'download', onClick: async () => downloadBlob(await serialize('csv'), stripExt(shell.name) + (wb.sheets.length > 1 ? ` – ${sh.name}` : '') + '.csv') },
      kind === 'csv' ? { label: 'Als Excel-Tabelle speichern', icon: 'ksheet', onClick: async () => shell.saveAsKind(await serialize('xlsx'), 'xlsx') } : null,
      '-',
      { label: 'Suchen & ersetzen', icon: 'replace', onClick: () => openFind(true) },
      { label: 'Diagramm einfügen', icon: 'chart', onClick: () => insertChart() },
      { label: 'Pivot-Tabelle …', icon: 'pivot', onClick: () => D.pivotDialog(api) },
      { label: 'Namens-Manager …', icon: 'names', onClick: () => D.nameManagerDialog(api) },
      aiHidden() ? null : { label: 'Formel-Assistent (KI) …', icon: 'fx', onClick: () => import('../ai/assist.js').then(m => m.formulaAssist({ sheet: sh, cell: addr(sel.r, sel.c), insert: f => { if (editing) cancel(); startEdit(f); } })) },
      { label: 'Tastenkürzel', icon: 'keyboard', onClick: () => shortcutsDialog() },
      { label: 'Neue Tabelle aus Vorlage …', icon: 'template', onClick: () => { location.hash = '#/vorlagen/tabelle'; } },
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
  const sizeOptions = D.SIZES.map(s => `<option value="${s}">${s}</option>`).join('');
  const fontOptions = `<option value="">Calibri</option>` + FONTS.filter(f => f.name !== 'Calibri').map(f => `<option value="${esc(f.name)}">${esc(f.name)}</option>`).join('');
  const root = h(`<div class="sheet-app">
    <div class="ribbon">
      <div class="rb-tabs" role="tablist" aria-label="Menüband">
        ${[['start', 'Start'], ['insert', 'Einfügen'], ['page', 'Seitenlayout'], ['formulas', 'Formeln'], ['data', 'Daten'], ['view', 'Ansicht']].map(([k, l], i) => `<button class="rb-tab" type="button" role="tab" data-rb="${k}" aria-selected="${i === 0}">${l}</button>`).join('')}
      </div>
      <div class="office-toolbar" role="toolbar" aria-label="Tabellenwerkzeuge" data-rbp="start">
        <div class="tb-group">${tb('undo', 'Rückgängig (Strg+Z)', 'data-a="undo"')}${tb('redo', 'Wiederholen (Strg+Y)', 'data-a="redo"')}</div>
        <div class="tb-group"><label class="sr-only" for="sh-font">Schriftart</label><select class="tb-select tb-font" id="sh-font" data-font title="Schriftart">${fontOptions}</select>
          <label class="sr-only" for="sh-fsize">Schriftgröße</label><select class="tb-select tb-size" id="sh-fsize" data-fsize title="Schriftgröße">${sizeOptions}</select></div>
        <div class="tb-group">${tb('bold', 'Fett (Strg+B)', 'data-a="bold"')}${tb('italic', 'Kursiv (Strg+I)', 'data-a="italic"')}${tb('underline', 'Unterstrichen (Strg+U)', 'data-a="underline"')}${tb('strike', 'Durchgestrichen (Strg+5)', 'data-a="strike"')}
          <span class="tb-color">${tb('color', 'Textfarbe', 'data-a="color"')}<span class="tb-swatch" style="background:#B91C1C"></span></span>
          <span class="tb-color">${tb('fill', 'Füllfarbe', 'data-a="fill"')}<span class="tb-swatch" style="background:#FDE047"></span></span>${tb('border', 'Rahmen', 'data-a="border"')}</div>
        <div class="tb-group">${tb('alignLeft', 'Linksbündig', 'data-a="al-left"')}${tb('alignCenter', 'Zentriert', 'data-a="al-center"')}${tb('alignRight', 'Rechtsbündig', 'data-a="al-right"')}${tb('valign', 'Vertikale Ausrichtung', 'data-a="valign"')}${tb('wrap', 'Text umbrechen', 'data-a="wrap"')}${tb('mergeCells', 'Zellen verbinden', 'data-a="merge"')}</div>
        <div class="tb-group"><label class="sr-only" for="sh-fmt">Zahlenformat</label><select class="tb-select" id="sh-fmt" data-fmt title="Zahlenformat">${fmtOptions}</select>${tb('decInc', 'Mehr Nachkommastellen', 'data-a="dec-up"')}${tb('decDec', 'Weniger Nachkommastellen', 'data-a="dec-down"')}</div>
        <div class="tb-group">${tb('cellStyles', 'Zellenformatvorlagen', 'data-a="styles"')}${tb('condfmt', 'Bedingte Formatierung', 'data-a="cf"')}${tb('dropdown', 'Datenüberprüfung (Dropdown-Liste)', 'data-a="dv"')}</div>
        <div class="tb-group">${tb('sigma', 'AutoSumme', 'data-a="sum"')}${tb('fx', 'Funktion einfügen', 'data-a="fx"')}</div>
        <div class="tb-group">${tb('rowAdd', 'Zeile einfügen', 'data-a="row-add"')}${tb('rowDel', 'Zeile löschen', 'data-a="row-del"')}${tb('colAdd', 'Spalte einfügen', 'data-a="col-add"')}${tb('colDel', 'Spalte löschen', 'data-a="col-del"')}</div>
        <div class="tb-group">${tb('sortAsc', 'Aufsteigend sortieren', 'data-a="sort-asc"')}${tb('sortDesc', 'Absteigend sortieren', 'data-a="sort-desc"')}${tb('filter', 'Filter (AutoFilter)', 'data-a="filter"')}${tb('freeze', 'Kopfzeile fixieren', 'data-a="freeze"')}</div>
        <div class="tb-group">${tb('chart', 'Diagramm einfügen', 'data-a="chart"')}${tb('replace', 'Suchen & ersetzen (Strg+F)', 'data-a="find"')}</div>
      </div>
      <div class="office-toolbar" role="toolbar" aria-label="Einfügen" data-rbp="insert" hidden>
        <div class="tb-group">${tbl('pivot', 'Pivot-Tabelle', 'data-a="pivot"')}</div>
        <div class="tb-group">${tbl('dateIns', 'Datum', 'data-a="ins-date"')}${tbl('timeIns', 'Uhrzeit', 'data-a="ins-time"')}</div>
        <div class="tb-group">${tbl('names', 'Name definieren', 'data-a="defname"')}${tbl('series', 'Reihe ausfüllen', 'data-a="series"')}</div>
        <div class="tb-group">${tbl('note', 'Notiz', 'data-a="note"')}${tbl('link', 'Link', 'data-a="link"')}${tbl('chart', 'Diagramm', 'data-a="ins-chart"')}</div>
      </div>
      <div class="office-toolbar" role="toolbar" aria-label="Seitenlayout" data-rbp="page" hidden>
        <div class="tb-group">${tbl('pageSetup', 'Seite einrichten', 'data-a="pagesetup"')}${tbl('kpdf', 'Als PDF', 'data-a="pdf"')}</div>
        <div class="tb-group">${tbl('printArea', 'Druckbereich festlegen', 'data-a="printarea"')}${tbl('close', 'Druckbereich aufheben', 'data-a="printarea-clear"')}${tbl('printTitles', 'Drucktitel', 'data-a="printtitles"')}</div>
      </div>
      <div class="office-toolbar" role="toolbar" aria-label="Formeln" data-rbp="formulas" hidden>
        <div class="tb-group">${tbl('fxList', 'Funktion einfügen', 'data-a="fxdlg"')}${tbl('sigma', 'AutoSumme …', 'data-a="sumx"')}</div>
        <div class="tb-group">${tbl('names', 'Namens-Manager', 'data-a="names"')}${tbl('recalc', 'Neu berechnen', 'data-a="recalc"')}</div>
      </div>
      <div class="office-toolbar" role="toolbar" aria-label="Daten" data-rbp="data" hidden>
        <div class="tb-group">${tbl('sortCustom', 'Sortieren …', 'data-a="sortdlg"')}${tbl('filterClear', 'Filter löschen', 'data-a="filterclear"')}</div>
        <div class="tb-group">${tbl('dedupe', 'Duplikate entfernen', 'data-a="dedupe"')}${tbl('textCols', 'Text in Spalten', 'data-a="t2c"')}</div>
        <div class="tb-group">${tbl('protect', 'Blatt schützen', 'data-a="protect"')}${tbl('restore', 'Pivot aktualisieren', 'data-a="pivot-refresh"')}</div>
        <div class="tb-group">${tbl('subtotal', 'Teilergebnisse', 'data-a="subtotal"')}${tbl('groupRows', 'Gruppieren', 'data-a="group"')}${tbl('ungroupRows', 'Gruppierung aufheben', 'data-a="ungroup"')}</div>
        <div class="tb-group">${tbl('condfmt', 'Bedingte Formatierung', 'data-a="cf2"')}${tbl('dropdown', 'Datenüberprüfung', 'data-a="dv2"')}</div>
      </div>
      <div class="office-toolbar" role="toolbar" aria-label="Ansicht" data-rbp="view" hidden>
        <div class="tb-group">${tbl('freezePanes', 'Fixieren …', 'data-a="freezemenu"')}${tbl('gridlines', 'Gitternetzlinien', 'data-a="grid"')}${tbl('showFormulas', 'Formeln anzeigen', 'data-a="showf"')}</div>
        <div class="tb-group">${tbl('goto', 'Gehe zu …', 'data-a="goto"')}${tbl('keyboard', 'Tastenkürzel', 'data-a="keys"')}</div>
      </div>
    </div>
    <div class="findbar s-find" hidden>
      <input class="input" type="search" data-fq placeholder="Suchen …" aria-label="Suchbegriff">
      <span class="find-count" data-fcount aria-live="polite"></span>
      <button class="icon-btn" type="button" data-fprev aria-label="Vorheriger Treffer">${oicon('chevronUp')}</button>
      <button class="icon-btn" type="button" data-fnext aria-label="Nächster Treffer">${oicon('chevronDown')}</button>
      <input class="input" type="text" data-fr placeholder="Ersetzen durch …" aria-label="Ersetzen durch">
      <button class="btn btn-ghost btn-sm" type="button" data-frep>Ersetzen</button>
      <button class="btn btn-ghost btn-sm" type="button" data-freall>Alle</button>
      <label class="check find-opt"><input type="checkbox" data-fcase> Aa</label>
      <label class="check find-opt"><input type="checkbox" data-fwhole> Ganze Zelle</label>
      <label class="check find-opt" title="Reguläre Ausdrücke (z. B. ^\\d{5}$)"><input type="checkbox" data-fregex> .*</label>
      <button class="icon-btn" type="button" data-fclose aria-label="Suche schließen">${oicon('close')}</button>
    </div>
    <div class="fbar">
      <label class="sr-only" for="sh-addr">Zelladresse oder Name</label>
      <input class="sh-addr" id="sh-addr" value="A1" spellcheck="false" autocomplete="off" title="Zelladresse oder Name – mit Enter springen; neuen Namen für die Markierung eintippen">
      <span class="fx-label" aria-hidden="true">${oicon('fx')}</span>
      <label class="sr-only" for="sh-input">Inhalt der Zelle</label>
      <input class="sh-input" id="sh-input" spellcheck="false" autocomplete="off" enterkeyhint="done" placeholder="Wert oder =Formel">
      <button class="icon-btn fb-ok" type="button" data-commit aria-label="Eingabe übernehmen" hidden>${oicon('check')}</button>
      <button class="icon-btn fb-cancel" type="button" data-cancel aria-label="Eingabe verwerfen" hidden>${oicon('close')}</button>
      <div class="fx-tip" hidden></div>
    </div>
    <div class="sh-scroll" tabindex="0" aria-label="Tabellenraster" aria-describedby="sh-live">
      <div class="sh-inner">
        <div class="sh-colhead"><div class="sh-corner" title="Alles auswählen"></div><div class="sh-fcw"><div class="sh-fc sh-fchead"></div></div><div class="sh-colcells"></div></div>
        <div class="sh-frozen" hidden><div class="sh-rowhead"></div><div class="sh-fcw"><div class="sh-fc"></div></div><div class="sh-cells"></div></div>
        <div class="sh-body"><div class="sh-rowhead"></div><div class="sh-fcw"><div class="sh-fc"></div></div><div class="sh-cells"></div></div>
        <div class="sh-charts"></div>
      </div>
    </div>
    <div class="sh-tabs" role="tablist" aria-label="Tabellenblätter"></div>
    <div class="sr-only" id="sh-live" aria-live="polite"></div>
  </div>`);
  function tbl(icon, label, attrs) { return `<button class="tb tb-l" type="button" aria-label="${esc(label)}" title="${esc(label)}" ${attrs}>${oicon(icon)}<span>${esc(label)}</span></button>`; }
  screen.body.appendChild(root);
  const scroll = $('.sh-scroll', root), inner = $('.sh-inner', root);
  const colHead = $('.sh-colcells', root), corner = $('.sh-corner', root), fcHead = $('.sh-fchead', root);
  const frozen = $('.sh-frozen', root), frozenRH = $('.sh-rowhead', frozen), frozenCells = $('.sh-cells', frozen), frozenFc = $('.sh-fc', frozen);
  const body = $('.sh-body', root), bodyRH = $('.sh-rowhead', body), bodyCells = $('.sh-cells', body), bodyFc = $('.sh-fc', body);
  const addrIn = $('#sh-addr', root), input = $('#sh-input', root);
  const live = $('#sh-live', root), tabs = $('.sh-tabs', root);
  const fmtSel = $('[data-fmt]', root), fontSel = $('[data-font]', root), fsizeSel = $('[data-fsize]', root);
  const fxTip = $('.fx-tip', root);
  const status = h('<span class="foot-info sh-status"></span>');
  screen.foot.innerHTML = ''; screen.foot.appendChild(status); screen.foot.hidden = false; screen.foot.classList.add('office-foot');

  // ribbon tabs
  const LS = { get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  function showRibbon(k) {
    $$('[data-rb]', root).forEach(b => b.setAttribute('aria-selected', String(b.dataset.rb === k)));
    $$('[data-rbp]', root).forEach(p => { p.hidden = p.dataset.rbp !== k; });
  }
  $$('[data-rb]', root).forEach(b => b.addEventListener('click', () => showRibbon(b.dataset.rb)));

  // ---------------- geometry ----------------
  let nRows = 100, nCols = 26, colX = [0];
  let hidden = new Set(), rowY = null;
  const colW = c => { const w = sh.colW[c]; return w == null ? DEFAULT_COL_W : w; };
  const rowHidden = r => hidden.has(r);
  const rowH = r => (hidden.has(r) ? 0 : (sh.rowH.get(r) ?? ROW_H));
  const rowTop = r => (rowY ? (r <= nRows ? rowY[r] : rowY[nRows] + (r - nRows) * ROW_H) : r * ROW_H);
  const fr = () => Math.min(sh.freeze || 0, nRows);
  const fcN = () => Math.min(sh.freezeC || 0, nCols);
  const fcW = () => colX[fcN()] || 0;
  const rowAt = y => {
    if (!rowY) return Math.max(0, Math.floor(y / ROW_H));
    if (y >= rowY[nRows]) return nRows + Math.floor((y - rowY[nRows]) / ROW_H);
    let lo = 0, hi = nRows - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (rowY[m] <= y) lo = m; else hi = m - 1; }
    while (lo < nRows - 1 && rowHidden(lo)) lo++;
    return Math.max(0, lo);
  };
  function layout() {
    nRows = Math.max(100, sh.maxR + 40, sel.r + 20, sel.ar + 20, (sh.freeze || 0) + 20);
    nCols = Math.max(26, sh.maxC + 6, sel.c + 4, sel.ac + 4, (sh.freezeC || 0) + 6);
    colX = new Array(nCols + 1);
    colX[0] = 0;
    for (let c = 0; c < nCols; c++) colX[c + 1] = colX[c] + colW(c);
    const fh = filterHidden(sh);
    sh._fh = fh;
    hidden = new Set([...(sh.hiddenRows || []), ...fh]);
    if (hidden.size || sh.rowH.size) {
      rowY = new Float64Array(nRows + 1);
      for (let r = 0; r < nRows; r++) rowY[r + 1] = rowY[r] + rowH(r);
    } else rowY = null;
    const f = fr();
    const totalW = colX[nCols];
    inner.style.width = `${HW + totalW}px`;
    inner.style.height = `${HH + rowTop(nRows)}px`;
    $('.sh-colhead', root).style.width = `${HW + totalW}px`;
    frozen.hidden = !f;
    frozen.style.height = `${rowTop(f)}px`;
    frozen.style.width = `${HW + totalW}px`;
    body.style.height = `${rowTop(nRows) - rowTop(f)}px`;
    body.style.width = `${HW + totalW}px`;
    const w = fcW();
    $$('.sh-fc', root).forEach(x => { x.style.width = `${w}px`; x.hidden = !w; });
    root.classList.toggle('has-fc', !!w);
    root.classList.toggle('no-grid', !!sh.noGrid);
    $('[data-a="freeze"]', root).setAttribute('aria-pressed', String(!!(sh.freeze || sh.freezeC)));
    $('[data-a="filter"]', root).setAttribute('aria-pressed', String(!!sh.autoFilter));
    $('[data-a="grid"]', root).setAttribute('aria-pressed', String(!sh.noGrid));
    $('[data-a="showf"]', root).setAttribute('aria-pressed', String(showFormulas));
    $('[data-a="protect"]', root).setAttribute('aria-pressed', String(!!(sh.protect && sh.protect.on)));
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
    const on = sh.autoFilter.filters && sh.autoFilter.filters[c] != null;
    return `<button class="af-btn${on ? ' on' : ''}" type="button" data-af="${c}" aria-label="Filter für Spalte ${colName(c)}${on ? ' (aktiv)' : ''}">${oicon(on ? 'filter' : 'chevronDown')}</button>`;
  }
  const BW = { true: 1, thin: 1, hair: 1, dotted: 1, dashed: 1, medium: 2, mediumDashed: 2, dashDot: 1, thick: 3, double: 3 };
  function borderCss(bd) {
    if (!bd) return '';
    const col = bd.color || 'var(--cell-border, #1A1A1A)';
    const side = v => { const w = BW[v] || 1; const st = v === 'double' ? 'double' : /dash/i.test(v) ? 'dashed' : v === 'dotted' || v === 'hair' ? 'dotted' : 'solid'; return `${w}px ${st} ${col}`; };
    let css = '';
    if (bd.t) css += `border-top:${side(bd.t)};`;
    if (bd.l) css += `border-left:${side(bd.l)};`;
    if (bd.r) css += `border-right:${side(bd.r)};`;
    if (bd.b) css += `border-bottom:${side(bd.b)};`;
    return css;
  }
  function cellHtml(r, c, top, mergeSkip) {
    const k = KEY(r, c);
    let cell = sh.cells.get(k);
    let w = colW(c);
    if (w === 0) return '';
    let hgt = rowH(r);
    const m = sh.merges.length ? mergeAt(r, c) : null;
    if (m) {
      if (m.r1 !== r || m.c1 !== c) { if (!mergeSkip) return ''; }
      w = colX[Math.min(m.c2 + 1, nCols)] - colX[m.c1];
      hgt = rowTop(m.r2 + 1) - rowTop(m.r1);
    }
    let spill = null;
    if ((!cell || (!cell.f && cell.v == null)) && sh.spill.size) { const sp = sh.spill.get(k); if (sp) spill = sp; }
    const cfx = sh.cf.length ? cfStyle(sh, r, c, cell, cfCache) : null;
    const af = afButton(r, c);
    const note = sh.notes.size ? sh.notes.get(k) : null;
    const noteMark = note ? '<span class="note-mark" aria-hidden="true"></span>' : '';
    const noteTip = note ? ` title="${esc(note.text.slice(0, 400))}"` : '';
    if (!spill && (!cell || (!cfx && !cell.s && cell.v == null && !cell.f))) {
      return `<div class="c e${af ? ' has-af' : ''}${note ? ' has-note' : ''}"${noteTip} style="left:${colX[c]}px;top:${top}px;width:${w}px;height:${hgt}px${cfx && cfx.fill ? `;background:${cfx.fill}` : ''}">${af}${noteMark}</div>`;
    }
    const id = colName(c) + (r + 1);
    let s = cfx ? { ...((cell && cell.s) || {}), ...cfx } : ((cell && cell.s) || {});
    let v, text, fcol = null;
    if (spill) {
      v = spill.v;
      const oc = sh.cells.get(spill.o);
      const fmt = s.fmt || (oc && oc.s && oc.s.fmt);
      const fc = formatCell(v, fmt); text = fc.text; fcol = fc.color;
    } else if (showFormulas && cell.f) { v = '=' + toDisplay(cell.f); text = v; }
    else { v = cell.f ? cell.cv : cell.v; const fc = formatCell(v, s.fmt); text = fc.text; fcol = fc.color; }
    let cls = 'c';
    let align = s.align;
    if (!align) align = typeof v === 'number' ? 'right' : typeof v === 'boolean' || isErr(v) ? 'center' : 'left';
    if (align !== 'left') cls += ` a-${align}`;
    if (isErr(v)) cls += ' err';
    if (spill) cls += ' spilled';
    let style = `left:${colX[c]}px;top:${top}px;width:${w}px;height:${hgt}px;`;
    if (s.b) style += 'font-weight:700;';
    if (s.i) style += 'font-style:italic;';
    if (s.u || s.st) style += `text-decoration:${s.u ? 'underline' : ''}${s.st ? ' line-through' : ''};`;
    const color = fcol || s.color;
    if (color) style += `color:${color};`;
    if (s.fill) style += `background:${s.fill};${color ? '' : 'color:#1A1A1A;'}`;
    if (s.size && s.size !== 11) style += `font-size:${Math.max(8, Math.min(48, s.size * 1.27))}px;`;
    if (s.font) style += `font-family:${fontCss(s.font)};`;
    if (s.indent) style += `padding-${align === 'right' ? 'right' : 'left'}:${5 + s.indent * 9}px;`;
    if (s.bd) { style += borderCss(s.bd); cls += ' bd'; }
    const tall = hgt > ROW_H + 1 || s.valign || s.wrap || s.rot || /\n/.test(text);
    if (tall) { cls += ` tall v-${s.valign || 'bottom'}`; }
    if (s.rot) cls += ` rot${s.rot}`;
    // let left-aligned text overflow into empty neighbours
    if (typeof v === 'string' && align === 'left' && !s.fill && !m && !s.wrap && !s.bd && !af && !s.rot && !spill) {
      let kk = c + 1, extra = 0;
      while (kk < nCols && kk < c + 12 && !getCell(sh, r, kk) && !sh.spill.has(KEY(r, kk))) { extra += colW(kk); kk++; }
      if (extra) { style += `--ow:${w + extra}px;`; cls += ' ovf'; }
    }
    if (s.wrap) cls += ' wrap';
    if (af) cls += ' has-af';
    if (note) cls += ' has-note';
    if ((sh.links.size && sh.links.has(k)) || (cell && cell.f && /^HYPERLINK\(/.test(cell.f))) cls += ' lnk';
    let deco = '';
    if (cfx && cfx.bar) {
      const b = cfx.bar, pct = b.pct * 100, z = b.zero * 100;
      deco += `<span class="cf-bar" style="left:calc(${b.neg ? z - pct : z}% + 2px);width:calc(${pct}% - 4px);background:${b.color}"></span>`;
    }
    if (cfx && cfx.icon) deco += `<span class="cf-ic" style="color:${cfx.icon[1]}">${esc(cfx.icon[0])}</span>`;
    const inner = tall ? `<span class="ct">${esc(text)}</span>` : esc(text);
    return `<div class="${cls}${deco ? ' has-deco' : ''}" data-cell="${id}"${noteTip} style="${style}">${deco}${inner}${af}${noteMark}</div>`;
  }

  function render() {
    const st = scroll.scrollTop, sl = scroll.scrollLeft;
    const vw = scroll.clientWidth, vh = scroll.clientHeight;
    const f = fr(), fc = fcN(), fw = fcW();
    cfCache = new Map();
    cfCtx = null;
    cfCache.evalAt = cfEval;
    afRange = sh.autoFilter ? parseRange(sh.autoFilter.range) : null;
    const r0 = Math.max(f, rowAt(rowTop(f) + st) - 2);
    const r1 = Math.min(nRows - 1, rowAt(rowTop(f) + st + vh) + 2);
    const c0 = Math.max(fc, colAt(sl + fw) - 1);
    const c1 = Math.min(nCols - 1, colAt(sl + vw - HW) + 1);
    const [sr1, sr2, sc1, sc2] = rangeBounds();
    const colHeadHtml = (from, to) => {
      let ch = '';
      for (let c = from; c <= to; c++) {
        const w = colW(c);
        if (!w) { ch += `<div class="ch-hid" style="left:${colX[c] - 2}px" data-unhide-c="${c}" title="Ausgeblendete Spalte ${colName(c)}"></div>`; continue; }
        ch += `<div class="ch${c >= sc1 && c <= sc2 ? ' on' : ''}" data-col="${c}" style="left:${colX[c]}px;width:${w}px">${colName(c)}<span class="rz" data-rz="${c}"></span></div>`;
      }
      return ch;
    };
    colHead.innerHTML = colHeadHtml(c0, c1);
    fcHead.innerHTML = fc ? colHeadHtml(0, fc - 1) : '';
    const rowsHtml = (from, to, base, cFrom, cTo) => {
      let rh = '', cells = '';
      for (let r = from; r <= to; r++) {
        if (rowY && rowHidden(r)) continue;
        const top = rowTop(r) - rowTop(base);
        const hh = rowH(r);
        if (cFrom === 0 || cFrom === c0) {
          const lv = sh.outline.size ? sh.outline.get(r) || 0 : 0;
          const tg = sh.outline.size && !lv && sh.outline.get(r - 1) ? `<button class="ol-btn" type="button" data-olt="${r}" aria-label="Gruppe ein-/ausblenden">${rowHidden(r - 1) ? '+' : '−'}</button>` : '';
          rh += `<div class="rh${r >= sr1 && r <= sr2 ? ' on' : ''}${rowY && rowHidden(r + 1) ? ' hid-next' : ''}${lv ? ` ol ol${Math.min(lv, 3)}` : ''}" data-row="${r}" style="top:${top}px;height:${hh}px;line-height:${hh}px">${tg}${r + 1}<span class="rrz" data-rrz="${r}"></span></div>`;
        }
        for (let c = cFrom; c <= cTo; c++) cells += cellHtml(r, c, top, false);
      }
      // merges whose origin is outside the window
      for (const m of sh.merges) {
        if (m.r2 < from || m.r1 > to || m.c2 < cFrom || m.c1 > cTo) continue;
        if (m.r1 >= from && m.c1 >= cFrom) continue;
        cells += cellHtml(m.r1, m.c1, rowTop(m.r1) - rowTop(base), true);
      }
      return [rh, cells];
    };
    if (f) {
      const [rh, cells] = rowsHtml(0, f - 1, 0, c0, c1);
      frozenRH.innerHTML = rh; frozenCells.innerHTML = cells + selHtml(0, f - 1, 0, false);
      frozenFc.innerHTML = fc ? rowsHtml(0, f - 1, 0, 0, fc - 1)[1] + selHtml(0, f - 1, 0, true) : '';
    } else if (frozenCells.firstChild || frozenFc.firstChild) { frozenRH.innerHTML = ''; frozenCells.innerHTML = ''; frozenFc.innerHTML = ''; }
    const [rh, cells] = rowsHtml(r0, r1, f, c0, c1);
    bodyRH.innerHTML = rh;
    bodyCells.innerHTML = cells + selHtml(f, nRows - 1, f, false);
    bodyFc.innerHTML = fc ? rowsHtml(r0, r1, f, 0, fc - 1)[1] + selHtml(f, nRows - 1, f, true) : '';
    if (editing && editingInCell) placeEditor();
    placeDvButton();
    placeCellPop();
  }
  // formula rules of the conditional formatting: evaluated with the cached values (no recalculation)
  let cfCtx = null;
  function cfEval(f, dr, dc) {
    try {
      if (!cfCtx) cfCtx = makeCtx(wb, { dirty: new Set() });
      const g = dr || dc ? shiftRefs(f, ref => ({ ...ref, r: ref.absR || ref.colOnly ? ref.r : ref.r + dr, c: ref.absC || ref.rowOnly ? ref.c : ref.c + dc })) : f;
      cfCtx.sheet = si; cfCtx.cur = null;
      return evaluate(compile(g), cfCtx, { dynamic: false });
    } catch { return null; }
  }

  function rangeBounds() { if (sel.box) return [sel.box.r1, sel.box.r2, sel.box.c1, sel.box.c2]; return [Math.min(sel.r, sel.ar), Math.max(sel.r, sel.ar), Math.min(sel.c, sel.ac), Math.max(sel.c, sel.ac)]; }
  function mainRange() { const [r1, r2, c1, c2] = rangeBounds(); return { r1, r2, c1, c2 }; }
  function allRanges() { return [mainRange(), ...sel.more]; }
  let copyMark = null, fillPreview = null;
  const coarseMq = matchMedia('(pointer: coarse)');
  let coarse = coarseMq.matches;
  coarseMq.addEventListener && coarseMq.addEventListener('change', () => { coarse = coarseMq.matches; schedule(); });
  function rectHtml(cls, r1, r2, c1, c2, from, to, base, inFc) {
    const fc = fcN();
    if (inFc) { if (c1 >= fc) return ''; c2 = Math.min(c2, fc - 1); } else if (fc && c2 < fc) return '';
    const a = Math.max(r1, from), b = Math.min(r2, to);
    if (a > b) return '';
    return `<div class="${cls}" style="left:${colX[c1]}px;top:${rowTop(a) - rowTop(base)}px;width:${colX[Math.min(c2 + 1, nCols)] - colX[c1]}px;height:${rowTop(b + 1) - rowTop(a)}px"></div>`;
  }
  function selHtml(from, to, base, inFc) {
    const [r1, r2, c1, c2] = rangeBounds();
    let out = '';
    for (const m of sel.more) out += rectHtml('sel-range more', m.r1, m.r2, m.c1, m.c2, from, to, base, inFc);
    if (r1 !== r2 || c1 !== c2) out += rectHtml('sel-range', r1, r2, c1, c2, from, to, base, inFc);
    if (copyMark && copyMark.si === si) out += rectHtml('copy-mark', copyMark.r1, copyMark.r2, copyMark.c1, copyMark.c2, from, to, base, inFc);
    if (fillPreview) out += rectHtml('fill-preview', fillPreview.r1, fillPreview.r2, fillPreview.c1, fillPreview.c2, from, to, base, inFc);
    // spill range outline of the active cell's formula
    const ac = getCell(sh, sel.r, sel.c);
    let sp = ac && ac.spill ? { r: sel.r, c: sel.c, ...ac.spill } : null;
    if (!sp && sh.spill.has(KEY(sel.r, sel.c))) { const o = sh.spill.get(KEY(sel.r, sel.c)).o; const oc = sh.cells.get(o); if (oc && oc.spill) sp = { r: R_OF(o), c: C_OF(o), ...oc.spill }; }
    if (sp) out += rectHtml('spill-mark', sp.r, sp.r + sp.h - 1, sp.c, sp.c + sp.w - 1, from, to, base, inFc);
    const fc = fcN();
    if (sel.r >= from && sel.r <= to && (inFc ? sel.c < fc : sel.c >= fc || !fc)) {
      const m = mergeAt(sel.r, sel.c);
      const rr = m ? m.r1 : sel.r, cc = m ? m.c1 : sel.c;
      const w = m ? colX[m.c2 + 1] - colX[m.c1] : colW(sel.c);
      const hh = m ? rowTop(m.r2 + 1) - rowTop(m.r1) : rowH(sel.r);
      out += `<div class="sel-active" style="left:${colX[cc]}px;top:${rowTop(rr) - rowTop(base)}px;width:${w}px;height:${hh}px"></div>`;
    }
    // fill handle at the bottom-right corner of the main range (touch: a tab below the middle of the range)
    if (!editing && r2 >= from && r2 <= to && (inFc ? c2 < fc : c2 >= fc || !fc)) {
      if (coarse) out += `<div class="fill-handle fh-touch" data-fh title="Ziehen zum Ausfüllen" style="left:${Math.round((colX[Math.max(c1, inFc ? 0 : fc)] + colX[c2 + 1]) / 2) - 14}px;top:${rowTop(r2 + 1) - rowTop(base) + 3}px"></div>`;
      else out += `<div class="fill-handle" data-fh title="Ziehen zum Ausfüllen (Doppelklick: bis zum Datenende)" style="left:${colX[c2 + 1] - 4}px;top:${rowTop(r2 + 1) - rowTop(base) - 4}px"></div>`;
    }
    // touch: handles at the corners to resize the selection
    if (coarse && !editing) {
      if (r1 >= from && r1 <= to && (inFc ? c1 < fc : c1 >= fc || !fc)) out += `<div class="sel-knob tl" data-knob="tl" style="left:${colX[c1]}px;top:${rowTop(r1) - rowTop(base)}px"></div>`;
      if (r2 >= from && r2 <= to && (inFc ? c2 < fc : c2 >= fc || !fc)) out += `<div class="sel-knob br" data-knob="br" style="left:${colX[c2 + 1]}px;top:${rowTop(r2 + 1) - rowTop(base)}px"></div>`;
    }
    return out;
  }

  // ---------------- selection ----------------
  function select(r, c, extend = false, { scrollInto = true, keepMore = false } = {}) {
    r = Math.max(0, Math.min(1048575, r)); c = Math.max(0, Math.min(16383, c));
    if (sel.box && extend) { sel.ar = sel.r === sel.box.r1 ? sel.box.r2 : sel.box.r1; sel.ac = sel.c === sel.box.c1 ? sel.box.c2 : sel.box.c1; }
    sel.box = null;
    sel.r = r; sel.c = c;
    if (!extend) { sel.ar = r; sel.ac = c; }
    if (!keepMore) sel.more = [];
    if (r >= nRows - 5 || c >= nCols - 2) layout();
    if (scrollInto) ensureVisible(r, c);
    updateBar();
    schedule();
  }
  function ensureVisible(r, c) {
    const f = fr(), fw = fcW();
    const vw = scroll.clientWidth - HW, vh = scroll.clientHeight - HH - rowTop(f);
    if (r >= f) {
      const y = rowTop(r) - rowTop(f);
      if (y < scroll.scrollTop) scroll.scrollTop = y;
      else if (y + rowH(r) > scroll.scrollTop + vh) scroll.scrollTop = y + rowH(r) - vh;
    }
    if (c >= fcN()) {
      const x = colX[c], w = colW(c);
      if (x - fw < scroll.scrollLeft) scroll.scrollLeft = Math.max(0, x - fw);
      else if (x + w > scroll.scrollLeft + vw) scroll.scrollLeft = x + w - vw;
    }
  }
  function updateBar() {
    const [r1, r2, c1, c2] = rangeBounds();
    if (document.activeElement !== addrIn) addrIn.value = r1 === r2 && c1 === c2 ? addr(sel.r, sel.c) : `${addr(r1, c1)}:${addr(r2, c2)}`;
    const cell = getCell(sh, sel.r, sel.c);
    if (!editing) {
      const sp = !cell && sh.spill.get(KEY(sel.r, sel.c));
      if (sp) { const oc = sh.cells.get(sp.o); input.value = oc && oc.f ? '=' + toDisplay(oc.f) : ''; input.classList.add('ghost'); }
      else { input.value = cell && cell.f && cell.s && cell.s.hideF && sh.protect && sh.protect.on ? '' : editTextOf(cell, toDisplay); input.classList.remove('ghost'); }
    }
    const s = (cell && cell.s) || {};
    const k = formatKind(s.fmt);
    fmtSel.value = s.fmt && !Object.values(FORMATS).some(f => f.code === s.fmt) ? 'custom' : (FORMATS[k] ? k : 'general');
    fontSel.value = s.font && FONTS.some(f => f.name === s.font) ? s.font : '';
    fsizeSel.value = String(s.size || 11);
    $('[data-a="bold"]', root).setAttribute('aria-pressed', String(!!s.b));
    $('[data-a="italic"]', root).setAttribute('aria-pressed', String(!!s.i));
    $('[data-a="underline"]', root).setAttribute('aria-pressed', String(!!s.u));
    $('[data-a="strike"]', root).setAttribute('aria-pressed', String(!!s.st));
    $('[data-a="wrap"]', root).setAttribute('aria-pressed', String(!!s.wrap));
    $('[data-a="merge"]', root).setAttribute('aria-pressed', String(!!mergeAt(sel.r, sel.c)));
    ['left', 'center', 'right'].forEach(a => $(`[data-a="al-${a}"]`, root).setAttribute('aria-pressed', String(s.align === a)));
    live.textContent = `${addr(sel.r, sel.c)}: ${displayOf(cell) || 'leer'}${noteAt(sh, sel.r, sel.c) ? ' · Notiz: ' + noteAt(sh, sel.r, sel.c).text : ''}`;
    // status: sum/avg/count of the selection (all ranges)
    const ranges = allRanges();
    const multi = ranges.length > 1 || r1 !== r2 || c1 !== c2;
    if (multi) {
      let sum = 0, n = 0, cnt = 0, mn = Infinity, mx = -Infinity;
      const seen = ranges.length > 1 ? new Set() : null;
      for (const rg of ranges) {
        const maxR = Math.min(rg.r2, sh.maxR), maxC = Math.min(rg.c2, sh.maxC);
        for (let r = rg.r1; r <= maxR; r++) {
          if (rowHidden(r)) continue;
          for (let c = rg.c1; c <= maxC; c++) {
            if (seen) { const kk = KEY(r, c); if (seen.has(kk)) continue; seen.add(kk); }
            const v = valueAt(sh, r, c);
            if (v !== null && v !== '' && v !== undefined) cnt++;
            if (typeof v === 'number') { sum += v; n++; if (v < mn) mn = v; if (v > mx) mx = v; }
          }
        }
      }
      const f = v => v.toLocaleString('de-DE', { maximumFractionDigits: 4 });
      status.textContent = n ? `Summe: ${f(+sum.toPrecision(15))} · Mittelwert: ${f(sum / n)} · Anzahl: ${cnt}${n > 1 ? ` · Min: ${f(mn)} · Max: ${f(mx)}` : ''}` : `Anzahl: ${cnt}`;
    } else {
      const dv = validationAt(sh, sel.r, sel.c);
      status.textContent = `${sh.name} · ${Math.max(0, sh.maxR + 1).toLocaleString('de-DE')} Zeilen${sh.protect && sh.protect.on ? ' · geschützt' : ''}${dv && dv.prompt ? ` · ${dv.prompt}` : ''}`;
    }
  }

  // ---------------- protection ----------------
  function lockedIn(rg) {
    if (!sh.protect || !sh.protect.on) return false;
    const R2 = Math.min(rg.r2, Math.max(rg.r1, sh.maxR + 1)), C2 = Math.min(rg.c2, Math.max(rg.c1, sh.maxC + 1));
    for (let r = rg.r1; r <= R2; r++) for (let c = rg.c1; c <= C2; c++) { const x = getCell(sh, r, c); if (!(x && x.s && x.s.unlocked)) return true; }
    return false;
  }
  function guard(ranges = allRanges(), { structural = false } = {}) {
    if (sh.protect && sh.protect.on && (structural || ranges.some(lockedIn))) {
      toast('Das Blatt ist geschützt. Hebe den Schutz unter „Daten → Blatt schützen“ auf, um diese Zellen zu ändern.', 'error', { timeout: 5000 });
      return false;
    }
    return true;
  }

  // ---------------- editing ----------------
  let editing = false, editingInCell = false, cellEditor = null, editOrig = '', editMode = 'edit';
  function startEdit(initial = null, inCell = true) {
    if (editing) return;
    if (!guard([{ r1: sel.r, r2: sel.r, c1: sel.c, c2: sel.c }])) { scroll.focus({ preventScroll: true }); return; }
    editing = true; editingInCell = inCell;
    editMode = initial != null && !String(initial).startsWith('=') ? 'enter' : 'edit';
    const cell = getCell(sh, sel.r, sel.c);
    editOrig = editTextOf(cell, toDisplay);
    input.value = initial != null ? initial : editOrig;
    input.classList.remove('ghost');
    $('[data-commit]', root).hidden = false; $('[data-cancel]', root).hidden = false;
    root.classList.add('is-editing');
    if (inCell) {
      cellEditor = h('<textarea class="cell-editor" spellcheck="false" autocomplete="off" aria-label="Zelle bearbeiten" enterkeyhint="done" rows="1"></textarea>');
      cellEditor.value = input.value;
      const inFc = sel.c < fcN();
      const band = sel.r < fr() ? frozen : body;
      (inFc ? $('.sh-fc', band) : band).appendChild(cellEditor);
      placeEditor();
      cellEditor.addEventListener('input', () => { input.value = cellEditor.value; growEditor(); fxHint(); });
      cellEditor.addEventListener('keydown', editKeys);
      cellEditor.addEventListener('keyup', fxHint);
      cellEditor.addEventListener('click', () => { editMode = 'edit'; fxHint(); });
      cellEditor.addEventListener('blur', () => setTimeout(() => { if (editing && editingInCell && document.activeElement !== input && document.activeElement !== cellEditor && !pointMode) commit(); }, 120));
      cellEditor.focus();
      const len = cellEditor.value.length;
      cellEditor.setSelectionRange(len, len);
      growEditor();
    }
    fxHint();
    schedule();
  }
  function placeEditor() {
    if (!cellEditor) return;
    const f = fr();
    const inFc = sel.c < fcN();
    const top = sel.r < f ? rowTop(sel.r) : rowTop(sel.r) - rowTop(f);
    cellEditor.style.left = `${(inFc ? 0 : HW) + colX[sel.c]}px`;
    cellEditor.style.top = `${top}px`;
    cellEditor.style.minWidth = `${Math.max(colW(sel.c), 60)}px`;
    cellEditor.style.minHeight = `${Math.max(rowH(sel.r), ROW_H)}px`;
  }
  function growEditor() {
    if (!cellEditor) return;
    cellEditor.style.height = 'auto';
    cellEditor.style.height = `${Math.max(rowH(sel.r), ROW_H, cellEditor.scrollHeight)}px`;
    cellEditor.style.width = 'auto';
    cellEditor.style.width = `${Math.min(560, Math.max(colW(sel.c), 60, cellEditor.scrollWidth + 6))}px`;
  }
  function endEdit() {
    editing = false; editingInCell = false; pointMode = false;
    if (cellEditor) { cellEditor.remove(); cellEditor = null; }
    $('[data-commit]', root).hidden = true; $('[data-cancel]', root).hidden = true;
    root.classList.remove('is-editing');
    fxTip.hidden = true;
  }
  function commit(move = null) {
    if (!editing) return true;
    const text = input.value;
    if (text !== editOrig) {
      const dv = validationAt(sh, sel.r, sel.c);
      if (dv && text.trim() !== '') {
        let pv = null;
        try { pv = text.startsWith('=') ? null : parseInput(text, (getCell(sh, sel.r, sel.c) || {}).s && getCell(sh, sel.r, sel.c).s.fmt).v; } catch {}
        if (pv !== null && !dvAllows(dv, pv, text.trim(), dvList)) {
          toast(dv.error || ((dv.type || 'list') === 'list' ? `„${text.trim()}“ ist hier nicht erlaubt. Bitte wähle einen Wert aus der Liste.` : `„${text.trim()}“ ist hier nicht erlaubt (${dvDescribe(dv)}).`), 'error', { timeout: 5000 });
          (cellEditor || input).focus();
          return false;
        }
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
    if (move) moveActive(move[0], move[1]);
    else { updateBar(); schedule(); }
    scroll.focus({ preventScroll: true });
    return true;
  }
  function cancel() { endEdit(); updateBar(); schedule(); scroll.focus({ preventScroll: true }); }
  /** Move the active cell; inside a multi-cell selection Enter/Tab cycle within it (like spreadsheet apps). */
  function moveActive(dr, dc) {
    const [r1, r2, c1, c2] = rangeBounds();
    if ((r1 !== r2 || c1 !== c2) && !sel.more.length) {
      let r = sel.r + dr, c = sel.c + dc;
      if (dc) { if (c > c2) { c = c1; r++; } if (c < c1) { c = c2; r--; } if (r > r2) r = r1; if (r < r1) r = r2; }
      else { if (r > r2) { r = r1; c++; } if (r < r1) { r = r2; c--; } if (c > c2) c = c1; if (c < c1) c = c2; }
      sel.box = { r1, r2, c1, c2 };
      sel.r = r; sel.c = c;
      ensureVisible(r, c); updateBar(); schedule();
      return;
    }
    let r = sel.r + dr;
    if (rowY && dr) { const d = dr > 0 ? 1 : -1; while (r > 0 && r < nRows && rowHidden(r)) r += d; }
    select(r, sel.c + dc);
  }
  /** Set the selection to a range with the active cell at (ar, ac) inside it. */
  function setSel(r1, c1, r2, c2, ar = r1, ac = c1) {
    sel.box = (ar === r1 || ar === r2) && (ac === c1 || ac === c2) ? null : { r1, r2, c1, c2 };
    sel.r = ar; sel.c = ac;
    sel.ar = ar === r1 ? r2 : r1; sel.ac = ac === c1 ? c2 : c1;
    sel.more = [];
  }

  function applyInput(r, c, text, { record = true, recalc: rc = true } = {}) {
    const cur = getCell(sh, r, c);
    const p = parseInput(text, cur && cur.s && cur.s.fmt);
    if (record) pushUndo();
    const cell = {};
    if (cur && cur.s) cell.s = { ...cur.s };
    if (p.fmt) cell.s = { ...(cell.s || {}), fmt: p.fmt };
    if (p.f) {
      cell.f = p.f; cell.da = true;
      // inherit the number format of the first referenced cell (like spreadsheet apps: =A1+1 on a date stays a date)
      if (!(cell.s && cell.s.fmt)) {
        try {
          const pr = precedents(compile(p.f)).refs[0];
          const fn0 = /^\s*([A-Z][A-Z0-9.]*)\(/.exec(p.f);
          const inherit = !fn0 || /^(SUM|MIN|MAX|AVERAGE|ROUND|ROUNDUP|ROUNDDOWN|EDATE|EOMONTH|WORKDAY|DATE|TODAY|NOW|MEDIAN|INDEX|VLOOKUP|XLOOKUP)$/.test(fn0[1]);
          if (pr && pr.sheet == null && inherit) { const src = getCell(sh, pr.r1, pr.c1); const k2 = src && src.s && src.s.fmt ? formatKind(src.s.fmt) : null; if (k2 === 'date' || k2 === 'currency' || k2 === 'percent' || k2 === 'time') cell.s = { ...(cell.s || {}), fmt: src.s.fmt }; }
          if (/^(TODAY)\(\)$/.test(p.f)) cell.s = { ...(cell.s || {}), fmt: 'dd.mm.yyyy' };
          if (/^(NOW)\(\)$/.test(p.f)) cell.s = { ...(cell.s || {}), fmt: 'dd.mm.yyyy hh:mm' };
        } catch {}
      }
    } else cell.v = p.v;
    if (!cell.f && (cell.v === null || cell.v === undefined) && !cell.s) setCell(sh, r, c, null);
    else setCell(sh, r, c, cell);
    if (rc) changed({ cells: [{ r, c }] });
  }
  function recalcFull() { recalc(wb); }
  let circWarned = false;
  /** After a change: recalc (incremental for changed cells), repaint. opts: {cells:[{r,c,si?}], full, recalc:false} */
  function changed({ cells = null, full = false, recalc: rc = true } = {}) {
    if (rc) {
      if (full || !cells || cells.length > 4000) recalcFull();
      else recalcCells(wb, cells.map(x => ({ si: x.si ?? si, r: x.r, c: x.c })));
    }
    recomputeBounds(sh); shell.markDirty(); layout(); updateBar(); schedule(); scheduleCharts(); if (findOpen) runFind(false);
    if (wb._circ && wb._circ.length) {
      if (!circWarned) { const x = wb._circ[0]; toast(`Zirkelbezug: Die Formel in ${wb.sheets[x.si] && x.si !== si ? wb.sheets[x.si].name + '!' : ''}${addr(x.r, x.c)} bezieht sich auf sich selbst.`, 'error', { timeout: 6000 }); circWarned = true; }
    } else circWarned = false;
  }

  // formula hint: function autocomplete while typing a name, argument help inside a call
  const fnHelp = new Map(FUNCTION_LIST.map(([n, cat, d, ex]) => [canonicalFn(n), { n, d, ex }]));
  const fnNames = FUNCTION_LIST.map(([n, , d]) => ({ n, en: canonicalFn(n), d }));
  let fxSuggest = [];
  /** Split the argument text of a call at top-level separators (outside strings and brackets). */
  function argIndex(text) {
    let depth = 0, idx = 0, q = false;
    for (const ch of text) {
      if (ch === '"') q = !q;
      else if (q) continue;
      else if (ch === '(' || ch === '{') depth++;
      else if (ch === ')' || ch === '}') depth--;
      else if (depth === 0 && (ch === ';' || (ch === ',' && !/;/.test(text)))) idx++;
    }
    return idx;
  }
  function fxHint() {
    const el = cellEditor || input;
    fxSuggest = [];
    if (!editing || !el.value.startsWith('=')) { fxTip.hidden = true; return; }
    const pos = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, pos);
    // 1) typing a function name: suggestions (German and English names)
    const quotes = (before.match(/"/g) || []).length % 2;
    const pm = !quotes && /(?:^=|[=(;,+\-*/^&<>:\s])([A-Za-zÄÖÜäöüß][\w.ÄÖÜäöüß]*)$/.exec(before);
    if (pm && pm[1].length >= 1 && !/^[A-Za-z]{1,3}\d+$/.test(pm[1])) {
      const w = pm[1].toLocaleUpperCase('de');
      const starts = fnNames.filter(f => f.n.startsWith(w) || f.en.startsWith(w));
      const more = w.length >= 3 ? fnNames.filter(f => !starts.includes(f) && (f.n.includes(w) || f.en.includes(w))) : [];
      fxSuggest = [...starts.sort((a, b) => a.n.length - b.n.length), ...more].slice(0, 7);
      if (fxSuggest.length && !(fxSuggest.length === 1 && fxSuggest[0].n === w)) {
        fxTip.hidden = false;
        fxTip.innerHTML = `<div class="fx-sug" role="listbox" aria-label="Funktionen">${fxSuggest.map((f, i) => `<button type="button" class="fx-sg${i === 0 ? ' on' : ''}" role="option" data-sug="${i}"><strong>${esc(f.n)}</strong><span>${esc(f.d)}</span></button>`).join('')}</div><div class="fx-sug-hint">${coarse ? 'Tippen zum Einfügen' : 'Tippen zum Einfügen · Tab übernimmt den ersten Vorschlag'}</div>`;
        fxTip._word = pm[1];
        return;
      }
    }
    // 2) inside a call: syntax with the current argument highlighted
    let depth = 0, name = null, open = -1;
    for (let i = before.length - 1; i >= 0; i--) {
      const ch = before[i];
      if (ch === ')') depth++;
      else if (ch === '(') { if (depth === 0) { const m = /([A-Za-zÄÖÜäöüß_][\w.ÄÖÜäöüß]*)\s*$/.exec(before.slice(0, i)); name = m ? m[1] : null; open = i; break; } depth--; }
    }
    const en = name && canonicalFn(name);
    const info = en && fnHelp.get(en);
    if (!info) { fxTip.hidden = true; return; }
    const sig = FN_ARGS[en];
    const ai = argIndex(before.slice(open + 1));
    let sigHtml = '';
    if (sig != null) {
      const args = tr(sig).split('; ').filter(Boolean);
      // repeating arguments ("…"): highlight the last named one for higher indices
      const rep = args[args.length - 1] === '…';
      const at = rep && ai >= args.length - 1 ? args.length - 2 : Math.min(ai, args.length - 1);
      sigHtml = `<div class="fx-sig"><strong>${esc(info.n)}</strong>(${args.map((a, i) => `<span class="fx-arg${i === at ? ' on' : ''}">${esc(a)}</span>`).join('; ')})</div>`;
    }
    fxTip.hidden = false;
    fxTip.innerHTML = `${sigHtml || `<strong>${esc(info.n)}</strong>`}<div class="fx-desc">${esc(info.d)}</div><code>=${esc(info.ex)}</code>`;
  }
  function acceptSuggestion(i) {
    const f = fxSuggest[i];
    if (!f) return false;
    const el = cellEditor || input;
    const pos = el.selectionStart ?? el.value.length;
    const word = fxTip._word || '';
    const start = pos - word.length;
    const tail = el.value.slice(pos);
    el.value = el.value.slice(0, start) + f.n + '(' + (tail.startsWith('(') ? tail.slice(1) : tail);
    const np = start + f.n.length + 1;
    el.focus();
    el.setSelectionRange(np, np);
    if (el === cellEditor) input.value = el.value; else if (cellEditor) { cellEditor.value = el.value; growEditor(); }
    fxHint();
    return true;
  }
  fxTip.addEventListener('pointerdown', e => { const b = e.target.closest('[data-sug]'); if (b) { e.preventDefault(); acceptSuggestion(+b.dataset.sug); } });

  function cycleAbsRef(el) {
    // F4: A1 → $A$1 → A$1 → $A1 → A1 for the reference at the caret
    const pos = el.selectionStart ?? el.value.length;
    const v = el.value;
    const re = /(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})/g;
    let m;
    while ((m = re.exec(v))) {
      if (pos >= m.index && pos <= m.index + m[0].length) {
        const st = (m[1] ? 2 : 0) + (m[3] ? 1 : 0); // 0 none, 3 both, 1 row, 2 col
        const next = { 0: 3, 3: 1, 1: 2, 2: 0 }[st];
        const rep = `${next & 2 ? '$' : ''}${m[2]}${next & 1 ? '$' : ''}${m[4]}`;
        el.value = v.slice(0, m.index) + rep + v.slice(m.index + m[0].length);
        const np = m.index + rep.length;
        el.setSelectionRange(np, np);
        if (el === cellEditor) input.value = el.value; else if (cellEditor) cellEditor.value = el.value;
        return;
      }
    }
  }
  function editKeys(e) {
    if (e.key === 'Tab' && !e.shiftKey && fxSuggest.length && !fxTip.hidden && fxTip.querySelector('.fx-sug')) { e.preventDefault(); acceptSuggestion(0); return; }
    if (e.key === 'Escape' && !fxTip.hidden && fxTip.querySelector('.fx-sug')) { e.preventDefault(); fxTip.hidden = true; fxSuggest = []; return; }
    if (e.key === 'Enter' && (e.altKey || (e.ctrlKey && e.target === cellEditor && false))) {
      e.preventDefault();
      const el = e.target; const p = el.selectionStart ?? el.value.length;
      if (el.tagName === 'TEXTAREA') { el.value = el.value.slice(0, p) + '\n' + el.value.slice(el.selectionEnd ?? p); el.setSelectionRange(p + 1, p + 1); input.value = el.value; growEditor(); }
      return;
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); fillSelectionWith(); return; }
    if (e.key === 'Enter') { e.preventDefault(); commit(e.shiftKey ? [-1, 0] : [1, 0]); }
    else if (e.key === 'Tab') { e.preventDefault(); commit(e.shiftKey ? [0, -1] : [0, 1]); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    else if (e.key === 'F4') { e.preventDefault(); cycleAbsRef(e.target); }
    else if (e.key === 'F2') { e.preventDefault(); editMode = 'edit'; }
    else if (editMode === 'enter' && e.target === cellEditor && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && !input.value.startsWith('=')) {
      e.preventDefault();
      commit({ ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key]);
    }
  }
  /** Ctrl+Enter while editing: put the same entry into all selected cells. */
  function fillSelectionWith() {
    const text = input.value;
    const ranges = allRanges();
    if (!guard(ranges)) return;
    endEdit();
    pushUndo();
    const cells = [];
    const base = { r: sel.r, c: sel.c };
    for (const rg of ranges) for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) {
      try {
        if (text.startsWith('=')) { applyInput(base.r, base.c, text, { record: false, recalc: false }); const f = getCell(sh, base.r, base.c).f; const cur = getCell(sh, r, c); setCell(sh, r, c, { ...(cur && cur.s ? { s: { ...cur.s } } : {}), f: shiftFormula(f, r - base.r, c - base.c), da: true }); }
        else applyInput(r, c, text, { record: false, recalc: false });
      } catch (err) { toast(`Formel ungültig: ${err.message}`, 'error'); break; }
      cells.push({ r, c });
    }
    changed({ cells });
    scroll.focus({ preventScroll: true });
  }
  input.addEventListener('focus', () => { if (!editing) startEdit(null, false); });
  input.addEventListener('input', () => { if (cellEditor) { cellEditor.value = input.value; growEditor(); } fxHint(); });
  input.addEventListener('keyup', fxHint);
  input.addEventListener('keydown', editKeys);
  input.addEventListener('blur', () => setTimeout(() => { if (editing && !editingInCell && document.activeElement !== input && !pointMode) commit(); }, 150));
  $('[data-commit]', root).addEventListener('mousedown', e => e.preventDefault());
  $('[data-commit]', root).addEventListener('click', () => commit());
  $('[data-cancel]', root).addEventListener('mousedown', e => e.preventDefault());
  $('[data-cancel]', root).addEventListener('click', () => cancel());
  addrIn.addEventListener('keydown', e => {
    if (e.key === 'Escape') { addrIn.blur(); updateBar(); scroll.focus({ preventScroll: true }); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const t = addrIn.value.trim();
    gotoRef(t);
    scroll.focus({ preventScroll: true });
  });
  addrIn.addEventListener('focus', () => addrIn.select());
  addrIn.addEventListener('blur', () => updateBar());
  /** Name box: cell, range, Sheet!range or a defined name; an unknown valid name defines a new name for the selection. */
  function gotoRef(t) {
    let sheetName = null, ref = t;
    const m = /^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/.exec(t);
    if (m) { sheetName = (m[1] || m[2]).replace(/''/g, "'"); ref = m[3]; }
    let rg = parseRangeAddr(ref.replace(/\$/g, ''));
    if (rg) {
      if (sheetName) { const i = wb.sheets.findIndex(s => s.name.toLowerCase() === sheetName.toLowerCase()); if (i < 0) { toast('Dieses Blatt gibt es nicht.', 'error'); return; } if (i !== si) switchSheet(i); }
      sel.ar = rg.r1; sel.ac = rg.c1;
      select(rg.r2, rg.c2, true);
      return;
    }
    const nm = findName(wb, t, si);
    if (nm) {
      const mm = /^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/.exec(nm.ref);
      const target = mm ? wb.sheets.findIndex(s => s.name.toLowerCase() === (mm[1] || mm[2]).replace(/''/g, "'").toLowerCase()) : si;
      const r2 = parseRangeAddr((mm ? mm[3] : nm.ref).replace(/\$/g, ''));
      if (r2 && target >= 0) { if (target !== si) switchSheet(target); sel.ar = r2.r1; sel.ac = r2.c1; select(r2.r2, r2.c2, true); return; }
      toast(`„${t}“ ist kein Bereich (=${toDisplay(nm.ref)}).`, 'info');
      return;
    }
    if (isValidName(t) && !KNOWN_FUNCTIONS.has(canonicalFn(t))) {
      const [r1, r2, c1, c2] = rangeBounds();
      pushUndo('wb');
      wb.names.push({ name: t, ref: `${quoteSheet(sh.name)}!$${colName(c1)}$${r1 + 1}${r1 !== r2 || c1 !== c2 ? `:$${colName(c2)}$${r2 + 1}` : ''}`, si: null });
      changed({ full: true });
      toast(`Name „${t}“ für ${rangeStr({ r1, r2, c1, c2 })} angelegt`, 'success');
      return;
    }
    toast('Ungültige Zelladresse oder unbekannter Name (z. B. B7, A1:C5 oder Umsatz).', 'error');
  }

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
    if (el === cellEditor) input.value = cellEditor.value; else if (cellEditor) cellEditor.value = input.value;
    el.focus();
    el.setSelectionRange(np, np);
  }

  // ---------------- pointer ----------------
  function cellFromEvent(e) {
    const inFrozen = e.target.closest('.sh-frozen');
    const inFc = e.target.closest('.sh-fc');
    const band = inFrozen ? frozen : body;
    const layer = inFc ? $('.sh-fc', band) : (inFrozen ? frozenCells : bodyCells);
    const rect = layer.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const base = inFrozen ? 0 : fr();
    return { r: Math.max(0, rowAt(rowTop(base) + Math.max(0, y))), c: colAt(Math.max(0, x)) };
  }
  function cellFromPoint(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    const sc = scroll.getBoundingClientRect();
    const f = fr();
    const inFrozenBand = f && clientY < sc.top + HH + rowTop(f) - 0;
    const inFcBand = fcN() && clientX < sc.left + HW + fcW();
    const band = inFrozenBand ? frozen : body;
    const layer = inFcBand ? $('.sh-fc', band) : $('.sh-cells', band);
    const rect = layer.getBoundingClientRect();
    void el;
    return { r: Math.max(0, rowAt(rowTop(inFrozenBand ? 0 : f) + Math.max(0, clientY - rect.top))), c: colAt(Math.max(0, clientX - rect.left)) };
  }
  let drag = null, longPress = null;
  // the finger lifted after a long press must not "click" the menu that just opened (the touched cell element
  // may already be re-rendered, so the click is swallowed at document level for a short moment)
  function swallowNextClick(x, y) {
    const t0 = Date.now();
    const onClick = e => {
      if (Date.now() - t0 > 1500 || Math.hypot(e.clientX - x, e.clientY - y) > 14) return; // a real tap elsewhere goes through
      document.removeEventListener('click', onClick, true);
      e.stopPropagation(); e.preventDefault();
    };
    document.addEventListener('click', onClick, true);
    setTimeout(() => document.removeEventListener('click', onClick, true), 1500);
  }
  scroll.addEventListener('pointerdown', e => {
    if (e.target.closest('.cell-editor')) return;
    if (e.button && e.button !== 0) return;
    if (e.target.closest('.sh-chart')) return;
    const afb = e.target.closest('[data-af]');
    if (afb) { e.preventDefault(); e.stopPropagation(); if (editing) commit(); filterMenu(+afb.dataset.af); return; }
    const dvb = e.target.closest('[data-dv]');
    if (dvb) { e.preventDefault(); e.stopPropagation(); if (editing) commit(); dvMenu(dvb); return; }
    if (chartSel) selectChart(null);
    if (e.target.closest('.cell-pop')) return;
    const kn = e.target.closest('[data-knob]');
    if (kn) {
      e.preventDefault(); e.stopPropagation();
      if (editing && !commit()) return;
      const [r1, r2, c1, c2] = rangeBounds();
      drag = { knob: kn.dataset.knob, anchor: kn.dataset.knob === 'tl' ? { r: r2, c: c2 } : { r: r1, c: c1 }, pointerId: e.pointerId };
      try { scroll.setPointerCapture(e.pointerId); } catch {}
      return;
    }
    const fh = e.target.closest('[data-fh]');
    if (fh) { e.preventDefault(); e.stopPropagation(); if (editing && !commit()) return; startFillDrag(e); return; }
    const rz = e.target.closest('[data-rz]');
    if (rz && e.pointerType === 'mouse') { startResize(e, +rz.dataset.rz); return; }
    const rrz = e.target.closest('[data-rrz]');
    if (rrz && e.pointerType === 'mouse') { startRowResize(e, +rrz.dataset.rrz); return; }
    const uh = e.target.closest('[data-unhide-c]');
    if (uh) { e.preventDefault(); unhideCols(+uh.dataset.unhideC, +uh.dataset.unhideC); return; }
    if (e.target.closest('[data-olt]')) return;
    const chEl = e.target.closest('[data-col]');
    const rhEl = e.target.closest('[data-row]');
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.target === corner || e.target.closest('.sh-corner')) { sel.ar = 0; sel.ac = 0; select(Math.max(sh.maxR, 0), Math.max(sh.maxC, 0), true, { scrollInto: false }); return; }
    if (chEl) {
      const c = +chEl.dataset.col;
      if (editing && formulaWantsRef()) { insertRef(`${colName(c)}:${colName(c)}`); e.preventDefault(); return; }
      if (editing) commit();
      if (ctrl) { sel.more.push(mainRange()); sel.ar = 0; sel.ac = c; select(Math.max(sh.maxR, 0), c, true, { scrollInto: false, keepMore: true }); return; }
      if (!e.shiftKey) { sel.ac = c; sel.ar = 0; } select(Math.max(sh.maxR, 0), c, true, { scrollInto: false });
      drag = { pointerId: e.pointerId, col: true };
      return;
    }
    if (rhEl) {
      const r = +rhEl.dataset.row;
      if (editing) commit();
      if (ctrl) { sel.more.push(mainRange()); sel.ar = r; sel.ac = 0; select(r, Math.max(sh.maxC, 0), true, { scrollInto: false, keepMore: true }); return; }
      if (!e.shiftKey) { sel.ar = r; sel.ac = 0; } select(r, Math.max(sh.maxC, 0), true, { scrollInto: false });
      drag = { pointerId: e.pointerId, row: true };
      return;
    }
    if (!e.target.closest('.sh-cells') && !e.target.closest('.sh-fc')) return;
    const { r, c } = cellFromEvent(e);
    if (editing) {
      if (formulaWantsRef() || pointMode) {
        e.preventDefault();
        pointMode = true;
        insertRef(addr(r, c));
        drag = { pointerId: e.pointerId, point: { r, c, len: addr(r, c).length } };
        setTimeout(() => { pointMode = false; }, 200);
        return;
      }
      if (!commit()) return;
    }
    copyMarkClearOnMove();
    if (e.pointerType === 'mouse') {
      e.preventDefault();
      scroll.focus({ preventScroll: true });
      if (ctrl) { sel.more.push(mainRange()); select(r, c, false, { scrollInto: false, keepMore: true }); }
      else select(r, c, e.shiftKey, { scrollInto: false });
      drag = { pointerId: e.pointerId };
      scroll.setPointerCapture(e.pointerId);
    } else {
      drag = { touch: true, x: e.clientX, y: e.clientY, r, c, t: Date.now() };
      clearTimeout(longPress);
      longPress = setTimeout(() => { if (drag && drag.touch && !drag.moved) { drag.long = true; swallowNextClick(drag.x, drag.y); const [r1, r2, c1, c2] = rangeBounds(); if (r < r1 || r > r2 || c < c1 || c > c2) select(r, c); cellMenu({ clientX: drag.x, clientY: drag.y }); } }, 550);
    }
  });
  scroll.addEventListener('pointermove', e => {
    if (!drag) return;
    if (drag.knob) {
      const { r, c } = cellFromPoint(e.clientX, e.clientY);
      if (r === sel.r && c === sel.c) return;
      sel.more = []; sel.box = null; sel.ar = drag.anchor.r; sel.ac = drag.anchor.c;
      select(r, c, true);
      return;
    }
    if (drag.touch) { if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 10) { drag.moved = true; clearTimeout(longPress); } return; }
    if (drag.fill) { fillDragMove(e); return; }
    const { r, c } = drag.col || drag.row ? cellFromPoint(e.clientX, e.clientY) : cellFromEvent(e);
    if (drag.point) {
      // dragging in point mode extends the inserted reference to a range
      const el = cellEditor || input;
      const pos = el.selectionStart ?? el.value.length;
      const start = pos - drag.point.len;
      const txt = r === drag.point.r && c === drag.point.c ? addr(r, c) : `${addr(Math.min(r, drag.point.r), Math.min(c, drag.point.c))}:${addr(Math.max(r, drag.point.r), Math.max(c, drag.point.c))}`;
      el.value = el.value.slice(0, start) + txt + el.value.slice(pos);
      drag.point.len = txt.length;
      el.setSelectionRange(start + txt.length, start + txt.length);
      if (el === cellEditor) input.value = el.value;
      return;
    }
    if (drag.col) { if (c !== sel.c) select(Math.max(sh.maxR, 0), c, true, { scrollInto: false, keepMore: true }); return; }
    if (drag.row) { if (r !== sel.r) select(r, Math.max(sh.maxC, 0), true, { scrollInto: false, keepMore: true }); return; }
    if (r !== sel.r || c !== sel.c) select(r, c, true, { scrollInto: false, keepMore: true });
  });
  scroll.addEventListener('pointerup', e => {
    clearTimeout(longPress);
    if (drag && drag.knob) { drag = null; updateBar(); schedule(); return; }
    if (drag && drag.fill) { fillDragEnd(); drag = null; return; }
    if (drag && drag.touch && !drag.long) {
      const moved = Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 10;
      if (!moved) {
        const again = sel.r === drag.r && sel.c === drag.c && sel.r === sel.ar && sel.c === sel.ac;
        select(drag.r, drag.c, false, { scrollInto: false });
        if (again) startEdit();
      }
    }
    drag = null;
  });
  scroll.addEventListener('pointercancel', () => { drag = null; fillPreview = null; clearTimeout(longPress); });
  scroll.addEventListener('dblclick', e => {
    const rz = e.target.closest('[data-rz]');
    if (rz) { autofitCols(+rz.dataset.rz, +rz.dataset.rz); return; }
    const rrz = e.target.closest('[data-rrz]');
    if (rrz) { autofitRows(+rrz.dataset.rrz, +rrz.dataset.rrz); return; }
    if (e.target.closest('[data-fh]')) { fillDownToEnd(); return; }
    if ((e.target.closest('.sh-cells') || e.target.closest('.sh-fc')) && !e.target.closest('.cell-editor')) startEdit();
  });
  scroll.addEventListener('contextmenu', e => {
    if (e.target.closest('.cell-editor') || e.target.closest('.sh-chart')) return;
    e.preventDefault();
    if (editing) commit();
    const chEl = e.target.closest('[data-col]'), rhEl = e.target.closest('[data-row]');
    if (chEl) { const c = +chEl.dataset.col; const [, , c1, c2] = rangeBounds(); if (c < c1 || c > c2 || sel.ar !== 0) { sel.ac = c; sel.ar = 0; select(Math.max(sh.maxR, 0), c, true, { scrollInto: false }); } colMenu(e); return; }
    if (rhEl) { const r = +rhEl.dataset.row; const [r1, r2] = rangeBounds(); if (r < r1 || r > r2 || sel.ac !== 0) { sel.ar = r; sel.ac = 0; select(r, Math.max(sh.maxC, 0), true, { scrollInto: false }); } rowMenu(e); return; }
    if (e.target.closest('.sh-cells') || e.target.closest('.sh-fc')) {
      const { r, c } = cellFromEvent(e);
      const [r1, r2, c1, c2] = rangeBounds();
      if (r < r1 || r > r2 || c < c1 || c > c2) select(r, c, false, { scrollInto: false });
      cellMenu(e);
    }
  });
  function anchorAt(e) { const a = h('<span class="ctx-anchor" style="position:fixed;width:1px;height:1px"></span>'); a.style.left = `${e.clientX}px`; a.style.top = `${e.clientY}px`; document.body.appendChild(a); setTimeout(() => a.remove(), 2000); return a; }
  function cellMenu(e) {
    officeMenu(anchorAt(e), [
      { label: 'Ausschneiden', icon: 'crop', onClick: () => clipboardAction('cut') },
      { label: 'Kopieren', icon: 'copy', onClick: () => clipboardAction('copy') },
      { label: 'Einfügen', icon: 'paste', onClick: () => clipboardAction('paste') },
      { label: 'Inhalte einfügen …', icon: 'paste', onClick: () => pasteSpecial() },
      '-',
      { label: 'Zellen formatieren …', icon: 'sliders', onClick: () => D.formatCellsDialog(api) },
      { label: 'Zeilen oberhalb einfügen', icon: 'rowAdd', onClick: () => doAction('row-add') },
      { label: 'Spalten links einfügen', icon: 'colAdd', onClick: () => doAction('col-add') },
      { label: 'Zeilen löschen', icon: 'rowDel', onClick: () => doAction('row-del') },
      { label: 'Spalten löschen', icon: 'colDel', onClick: () => doAction('col-del') },
      { label: 'Inhalte löschen', icon: 'eraser', onClick: () => clearSelection() },
      ...(coarse ? ['-', { label: 'Nach unten ausfüllen', icon: 'series', onClick: () => fillDownRight('down') }, { label: 'Nach rechts ausfüllen', icon: 'series', onClick: () => fillDownRight('right') }, { label: 'Reihe ausfüllen …', icon: 'series', onClick: () => D.seriesDialog(api) }] : []),
      '-',
      { label: noteAt(sh, sel.r, sel.c) ? 'Notiz bearbeiten …' : 'Notiz einfügen …', icon: 'note', onClick: () => editNote() },
      ...(noteAt(sh, sel.r, sel.c) ? [{ label: 'Notiz löschen', icon: 'trash', onClick: () => setNote(null) }] : []),
      { label: linkAt(sh, sel.r, sel.c) ? 'Link bearbeiten …' : 'Link einfügen …', icon: 'link', onClick: () => editLink() },
      ...(linkAt(sh, sel.r, sel.c) ? [{ label: 'Link entfernen', icon: 'close', onClick: () => setLink(null) }] : []),
      '-',
      { label: 'Aufsteigend sortieren', icon: 'sortAsc', onClick: () => doSort(true) },
      { label: 'Absteigend sortieren', icon: 'sortDesc', onClick: () => doSort(false) },
      { label: 'Nach diesem Wert filtern', icon: 'filter', onClick: () => filterBySelection() },
      { label: 'Bedingte Formatierung …', icon: 'condfmt', onClick: () => cfDialog() },
      { label: 'Namen definieren …', icon: 'names', onClick: () => D.nameManagerDialog(api, { defineOnly: true }) },
    ], { label: 'Zelle' });
  }
  function rowMenu(e) {
    const [r1, r2] = rangeBounds();
    officeMenu(anchorAt(e), [
      { label: 'Zeilen oberhalb einfügen', icon: 'rowAdd', onClick: () => doAction('row-add') },
      { label: 'Zeilen löschen', icon: 'rowDel', onClick: () => doAction('row-del') },
      '-',
      { label: 'Zeilenhöhe …', icon: 'resize', onClick: async () => { const v = await D.sizeDialog('row', Math.round(rowH(r1) / ROW_PX_PER_PT * 2) / 2 || 15); if (v != null) setRowHeights(r1, r2, Math.round(v * ROW_PX_PER_PT)); } },
      { label: 'Optimale Höhe', icon: 'fitPage', onClick: () => autofitRows(r1, r2) },
      { label: 'Ausblenden', icon: 'eyeOff', onClick: () => hideRows(r1, r2) },
      { label: 'Einblenden', icon: 'eye', onClick: () => unhideRows(Math.max(0, r1 - 1), r2 + 1) },
      '-',
      { label: 'Gruppieren', icon: 'groupRows', onClick: () => groupRows(r1, r2, 1) },
      { label: 'Gruppierung aufheben', icon: 'ungroupRows', onClick: () => groupRows(r1, r2, -1) },
      { label: 'Als Drucktitel wiederholen', icon: 'printTitles', onClick: () => setPrintTitles(r1, r2) },
    ], { label: 'Zeile' });
  }
  function colMenu(e) {
    const [, , c1, c2] = rangeBounds();
    officeMenu(anchorAt(e), [
      { label: 'Spalten links einfügen', icon: 'colAdd', onClick: () => doAction('col-add') },
      { label: 'Spalten löschen', icon: 'colDel', onClick: () => doAction('col-del') },
      '-',
      { label: 'Spaltenbreite …', icon: 'resize', onClick: async () => { const v = await D.sizeDialog('col', Math.round((colW(c1) - 5) / 7 * 2) / 2); if (v != null) setColWidths(c1, c2, Math.round(v * 7 + 5)); } },
      { label: 'Optimale Breite', icon: 'fitWidth', onClick: () => autofitCols(c1, c2) },
      { label: 'Ausblenden', icon: 'eyeOff', onClick: () => hideCols(c1, c2) },
      { label: 'Einblenden', icon: 'eye', onClick: () => unhideCols(Math.max(0, c1 - 1), c2 + 1) },
      '-',
      { label: 'Aufsteigend sortieren', icon: 'sortAsc', onClick: () => doSort(true) },
      { label: 'Absteigend sortieren', icon: 'sortDesc', onClick: () => doSort(false) },
    ], { label: 'Spalte' });
  }

  function startResize(e, c) {
    e.preventDefault();
    const x0 = e.clientX, w0 = colW(c);
    const [, , c1, c2] = rangeBounds();
    const cols = c >= c1 && c <= c2 && sel.ar === 0 ? [c1, c2] : [c, c];
    pushUndo();
    const move = ev => { const w = Math.max(16, Math.round(w0 + ev.clientX - x0)); for (let k = cols[0]; k <= cols[1]; k++) sh.colW[k] = w; layout(); schedule(); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); shell.markDirty(); scheduleCharts(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  function startRowResize(e, r) {
    e.preventDefault();
    const y0 = e.clientY, h0 = rowH(r);
    const [r1, r2] = rangeBounds();
    const rows = r >= r1 && r <= r2 && sel.ac === 0 ? [r1, r2] : [r, r];
    pushUndo();
    const move = ev => { const hh = Math.max(8, Math.round(h0 + ev.clientY - y0)); for (let k = rows[0]; k <= rows[1]; k++) { if (Math.abs(hh - ROW_H) < 2) sh.rowH.delete(k); else sh.rowH.set(k, hh); } layout(); schedule(); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); shell.markDirty(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  function setRowHeights(r1, r2, px) { pushUndo(); for (let r = r1; r <= r2; r++) { if (Math.abs(px - ROW_H) < 2) sh.rowH.delete(r); else sh.rowH.set(r, Math.max(8, px)); } changed({ recalc: false }); }
  function setColWidths(c1, c2, px) { pushUndo(); for (let c = c1; c <= c2; c++) sh.colW[c] = Math.max(8, px); changed({ recalc: false }); scheduleCharts(); }
  let measureCtx = null;
  function textWidth(text, s) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    const size = s && s.size ? s.size * 1.27 : 14;
    measureCtx.font = `${s && s.i ? 'italic ' : ''}${s && s.b ? '700 ' : ''}${size}px ${s && s.font ? fontCss(s.font) : getComputedStyle(scroll).fontFamily || 'sans-serif'}`;
    return Math.max(...String(text).split('\n').map(l => measureCtx.measureText(l).width));
  }
  function autofitCols(c1, c2) {
    pushUndo();
    for (let c = c1; c <= c2; c++) {
      let w = 0;
      const maxR = Math.min(sh.maxR, 20000);
      for (let r = 0; r <= maxR; r++) {
        const cell = getCell(sh, r, c);
        const sp = !cell && sh.spill.get(KEY(r, c));
        if (!cell && !sp) continue;
        if (cell && mergeAt(r, c)) continue;
        const t = sp ? formatValue(sp.v, null) : displayOf(cell);
        if (!t) continue;
        w = Math.max(w, textWidth(t, cell && cell.s) + 14 + (cell && cell.s && cell.s.indent ? cell.s.indent * 9 : 0) + (afRange && r === afRange.r1 ? 26 : 0));
      }
      sh.colW[c] = w ? Math.min(600, Math.max(32, Math.ceil(w))) : undefined;
    }
    changed({ recalc: false }); scheduleCharts();
  }
  function autofitRows(r1, r2) {
    pushUndo();
    for (let r = r1; r <= r2; r++) {
      let need = ROW_H;
      for (let c = 0; c <= sh.maxC; c++) {
        const cell = getCell(sh, r, c);
        if (!cell || mergeAt(r, c)) continue;
        const s = cell.s || {};
        const t = displayOf(cell);
        if (!t) continue;
        const lh = Math.max(18, (s.size ? s.size * 1.27 : 14) * 1.3);
        let lines = String(t).split('\n').length;
        if (s.wrap) { const avail = Math.max(20, colW(c) - 10); lines = String(t).split('\n').reduce((a, l) => a + Math.max(1, Math.ceil(textWidth(l, s) / avail)), 0); }
        if (s.rot === 90 || s.rot === 270 || s.rot === 255) need = Math.max(need, Math.min(400, textWidth(t, s) + 12));
        need = Math.max(need, Math.ceil(lines * lh + 8));
      }
      if (Math.abs(need - ROW_H) < 2) sh.rowH.delete(r); else sh.rowH.set(r, Math.min(600, need));
    }
    changed({ recalc: false });
  }
  function hideRows(r1, r2) { if (!guard([], { structural: true })) return; pushUndo(); for (let r = r1; r <= r2; r++) sh.hiddenRows.add(r); changed({ full: true }); toast(`${r2 - r1 + 1} Zeile${r2 > r1 ? 'n' : ''} ausgeblendet`); }
  function unhideRows(r1, r2) { pushUndo(); let n = 0; for (let r = r1; r <= r2; r++) if (sh.hiddenRows.delete(r)) n++; changed({ full: true }); if (n) toast(`${n} Zeile${n > 1 ? 'n' : ''} eingeblendet`); }
  function hideCols(c1, c2) { if (!guard([], { structural: true })) return; pushUndo(); for (let c = c1; c <= c2; c++) { if (colW(c)) sh.hiddenColW[c] = colW(c); sh.colW[c] = 0; } if (sel.c >= c1 && sel.c <= c2) select(sel.r, c2 + 1); changed({ recalc: false }); toast(`${c2 - c1 + 1} Spalte${c2 > c1 ? 'n' : ''} ausgeblendet`); }
  function unhideCols(c1, c2) { pushUndo(); let n = 0; for (let c = c1; c <= c2; c++) if (sh.colW[c] === 0) { sh.colW[c] = sh.hiddenColW[c] || undefined; delete sh.hiddenColW[c]; n++; } changed({ recalc: false }); if (n) toast(`${n} Spalte${n > 1 ? 'n' : ''} eingeblendet`); }

  // ---------------- AutoFill (fill handle, Ctrl+D/R) ----------------
  let fillState = null;
  function startFillDrag(e) {
    const [r1, r2, c1, c2] = rangeBounds();
    fillState = { r1, r2, c1, c2 };
    drag = { fill: true, pointerId: e.pointerId };
    try { scroll.setPointerCapture(e.pointerId); } catch {}
  }
  function fillDragMove(e) {
    const { r, c } = cellFromPoint(e.clientX, e.clientY);
    const s = fillState;
    let p = null;
    const dDown = r - s.r2, dUp = s.r1 - r, dRight = c - s.c2, dLeft = s.c1 - c;
    const best = Math.max(dDown, dUp, dRight, dLeft);
    if (best <= 0) p = null;
    else if (best === dDown) p = { dir: 'down', r1: s.r1, r2: r, c1: s.c1, c2: s.c2 };
    else if (best === dUp) p = { dir: 'up', r1: r, r2: s.r2, c1: s.c1, c2: s.c2 };
    else if (best === dRight) p = { dir: 'right', r1: s.r1, r2: s.r2, c1: s.c1, c2: c };
    else p = { dir: 'left', r1: s.r1, r2: s.r2, c1: c, c2: s.c2 };
    fillPreview = p;
    if (p) ensureVisible(Math.min(r, nRows - 1), c);
    schedule();
  }
  function fillDragEnd() {
    const p = fillPreview;
    fillPreview = null;
    if (!p) { schedule(); return; }
    const s = fillState;
    const n = p.dir === 'down' ? p.r2 - s.r2 : p.dir === 'up' ? s.r1 - p.r1 : p.dir === 'right' ? p.c2 - s.c2 : s.c1 - p.c1;
    doFill(p.dir, n, s);
  }
  function shiftFormula(f, dr, dc) { return shiftRefs(f, ref => ({ ...ref, r: ref.absR || ref.colOnly ? ref.r : Math.max(0, ref.r + dr), c: ref.absC || ref.rowOnly ? ref.c : Math.max(0, ref.c + dc) })); }
  /** Fill n cells in direction dir from the source block s (r1,r2,c1,c2). */
  function doFill(dir, n, s, { series = true } = {}) {
    if (n <= 0) return;
    const vert = dir === 'down' || dir === 'up';
    const target = dir === 'down' ? { r1: s.r2 + 1, r2: s.r2 + n, c1: s.c1, c2: s.c2 } : dir === 'up' ? { r1: s.r1 - n, r2: s.r1 - 1, c1: s.c1, c2: s.c2 } : dir === 'right' ? { r1: s.r1, r2: s.r2, c1: s.c2 + 1, c2: s.c2 + n } : { r1: s.r1, r2: s.r2, c1: s.c1 - n, c2: s.c1 - 1 };
    if (!guard([target])) return;
    pushUndo();
    const cells = [];
    const lines = vert ? [s.c1, s.c2] : [s.r1, s.r2];
    for (let line = lines[0]; line <= lines[1]; line++) {
      const src = [];
      const len = vert ? s.r2 - s.r1 + 1 : s.c2 - s.c1 + 1;
      for (let i = 0; i < len; i++) src.push(vert ? getCell(sh, s.r1 + i, line) || null : getCell(sh, line, s.c1 + i) || null);
      const forward = dir === 'down' || dir === 'right';
      const plan = planFill(src, n, { forward, series });
      plan.forEach((pe, k) => {
        const tr = vert ? (forward ? s.r2 + 1 + k : s.r1 - 1 - k) : line;
        const tc = vert ? line : (forward ? s.c2 + 1 + k : s.c1 - 1 - k);
        if (tr < 0 || tc < 0) return;
        const sc = src[pe.src];
        const srcPos = vert ? s.r1 + pe.src : s.c1 + pe.src;
        let cell = null;
        if (pe.v !== undefined) cell = { v: pe.v, ...(sc && sc.s ? { s: { ...sc.s } } : {}) };
        else if (sc) {
          cell = { ...sc, ...(sc.s ? { s: { ...sc.s } } : {}) };
          delete cell.cv; delete cell.cv0; delete cell.spill;
          if (sc.f) cell.f = vert ? shiftFormula(sc.f, tr - srcPos, 0) : shiftFormula(sc.f, 0, tc - srcPos);
        }
        setCell(sh, tr, tc, cell);
        cells.push({ r: tr, c: tc });
      });
    }
    setSel(Math.min(s.r1, target.r1), Math.min(s.c1, target.c1), Math.max(s.r2, target.r2), Math.max(s.c2, target.c2), s.r1, s.c1);
    changed({ cells });
  }
  /** Double-click on the fill handle: fill down as far as the neighbouring column has data. */
  function fillDownToEnd() {
    const [r1, r2, c1, c2] = rangeBounds();
    const has = (r, c) => c >= 0 && valueAt(sh, r, c) !== null && valueAt(sh, r, c) !== '';
    let end = r2;
    const probe = has(r2 + 1, c1 - 1) ? c1 - 1 : has(r2 + 1, c2 + 1) ? c2 + 1 : null;
    if (probe === null) { toast('Neben der Markierung gibt es keine Daten, bis zu denen ausgefüllt werden kann.', 'info'); return; }
    while (end + 1 <= sh.maxR && has(end + 1, probe)) end++;
    doFill('down', end - r2, { r1, r2, c1, c2 });
  }
  function fillDownRight(dir) {
    const [r1, r2, c1, c2] = rangeBounds();
    if (dir === 'down') {
      if (r1 === r2) { if (r1 === 0) return; doFill('down', 1, { r1: r1 - 1, r2: r1 - 1, c1, c2 }, { series: false }); return; }
      doFill('down', r2 - r1, { r1, r2: r1, c1, c2 }, { series: false });
    } else {
      if (c1 === c2) { if (c1 === 0) return; doFill('right', 1, { r1, r2, c1: c1 - 1, c2: c1 - 1 }, { series: false }); return; }
      doFill('right', c2 - c1, { r1, r2, c1, c2: c1 }, { series: false });
    }
    setSel(r1, c1, r2, c2, r1, c1); updateBar(); schedule();
  }

  // ---------------- keyboard ----------------
  scroll.addEventListener('keydown', e => {
    if (editing || e.target !== scroll) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key;
    const lk = k.length === 1 ? k.toLowerCase() : k;
    const mv = (dr, dc) => {
      e.preventDefault();
      if (e.shiftKey) {
        // extend from the anchor: move the "moving" corner
        let r = sel.r + dr, c = sel.c + dc;
        if (rowY && dr) { const d = dr > 0 ? 1 : -1; while (r > 0 && r < nRows && rowHidden(r)) r += d; }
        select(r, c, true);
        return;
      }
      let r = sel.r + dr;
      if (rowY && dr) { const d = dr > 0 ? 1 : -1; while (r > 0 && r < nRows && rowHidden(r)) r += d; }
      select(r, sel.c + dc);
    };
    if (e.altKey && e.shiftKey && (k === 'ArrowRight' || k === 'ArrowLeft')) { e.preventDefault(); const [r1, r2] = rangeBounds(); groupRows(r1, r2, k === 'ArrowRight' ? 1 : -1); return; }
    if (k === 'ArrowDown') return ctrl ? mv(edge(1, 0), 0) : mv(1, 0);
    if (k === 'ArrowUp') return ctrl ? mv(edge(-1, 0), 0) : mv(-1, 0);
    if (k === 'ArrowRight') return ctrl ? mv(0, edge(0, 1)) : mv(0, 1);
    if (k === 'ArrowLeft') return ctrl ? mv(0, edge(0, -1)) : mv(0, -1);
    if (k === 'Tab') { e.preventDefault(); moveActive(0, e.shiftKey ? -1 : 1); return; }
    if (k === 'Enter') { e.preventDefault(); moveActive(e.shiftKey ? -1 : 1, 0); return; }
    if (k === 'PageDown' && e.altKey) return mv(0, Math.max(1, Math.floor(scroll.clientWidth / DEFAULT_COL_W)));
    if (k === 'PageUp' && e.altKey) return mv(0, -Math.max(1, Math.floor(scroll.clientWidth / DEFAULT_COL_W)));
    if (k === 'PageDown' && ctrl) { e.preventDefault(); if (si < wb.sheets.length - 1) switchSheet(si + 1); return; }
    if (k === 'PageUp' && ctrl) { e.preventDefault(); if (si > 0) switchSheet(si - 1); return; }
    if (k === 'PageDown') return mv(Math.floor(scroll.clientHeight / ROW_H), 0);
    if (k === 'PageUp') return mv(-Math.floor(scroll.clientHeight / ROW_H), 0);
    if (k === 'Home') { e.preventDefault(); select(ctrl ? fr() : sel.r, ctrl ? fcN() : fcN() && sel.c >= fcN() ? fcN() : 0, e.shiftKey); return; }
    if (k === 'End' && ctrl) { e.preventDefault(); select(Math.max(0, sh.maxR), Math.max(0, sh.maxC), e.shiftKey); return; }
    if (k === 'F2' && e.shiftKey) { e.preventDefault(); editNote(); return; }
    if (k === 'F2') { e.preventDefault(); startEdit(); return; }
    if (k === 'Escape') { if (copyMark) { copyMark = null; schedule(); } if (sel.more.length) { sel.more = []; schedule(); } return; }
    if ((k === 'Delete' || k === 'Backspace') && chartSel) { e.preventDefault(); deleteChart(chartSel); return; }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); if (k === 'Backspace' && !sel.more.length && sel.r === sel.ar && sel.c === sel.ac) { startEdit(''); return; } clearSelection(); return; }
    if (ctrl && k === ' ') { e.preventDefault(); sel.ar = 0; sel.ac = sel.c; select(Math.max(sh.maxR, 0), sel.c, true, { scrollInto: false }); return; }
    if (e.shiftKey && k === ' ' && !ctrl) { e.preventDefault(); sel.ac = 0; sel.ar = sel.r; select(sel.r, Math.max(sh.maxC, 0), true, { scrollInto: false }); return; }
    if (ctrl && (lk === 'f' || lk === 'h')) { e.preventDefault(); openFind(true); return; }
    if ((ctrl && lk === 'g') || k === 'F5') { e.preventDefault(); gotoDialog(); return; }
    if (ctrl && lk === 'k') { e.preventDefault(); editLink(); return; }
    if (ctrl && lk === 'p') { e.preventDefault(); exportPdf(); return; }
    if (ctrl && lk === 'z') { e.preventDefault(); doUndo(); return; }
    if (ctrl && lk === 'y') { e.preventDefault(); doRedo(); return; }
    if (ctrl && lk === 'b') { e.preventDefault(); toggleStyle('b'); return; }
    if (ctrl && lk === 'i') { e.preventDefault(); toggleStyle('i'); return; }
    if (ctrl && lk === 'u') { e.preventDefault(); toggleStyle('u'); return; }
    if (ctrl && k === '5') { e.preventDefault(); toggleStyle('st'); return; }
    if (ctrl && k === '1') { e.preventDefault(); D.formatCellsDialog(api); return; }
    if (ctrl && lk === 'd') { e.preventDefault(); fillDownRight('down'); return; }
    if (ctrl && lk === 'r') { e.preventDefault(); fillDownRight('right'); return; }
    if (ctrl && (k === ';' || k === ',') && !e.shiftKey) { e.preventDefault(); startEdit(formatValue(dateToSerial(new Date()), 'dd.mm.yyyy')); commit(); return; }
    if (ctrl && (k === ':' || (e.shiftKey && (k === ';' || k === '.')))) { e.preventDefault(); const d = new Date(); startEdit(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`); commit(); return; }
    if (ctrl && e.shiftKey && (lk === 'v')) { e.preventDefault(); pasteSpecial(); return; }
    if (ctrl && e.altKey && lk === 'v') { e.preventDefault(); pasteSpecial(); return; }
    if (ctrl && (k === '+' || (e.shiftKey && k === '=')) ) { e.preventDefault(); insertByShape(); return; }
    if (ctrl && k === '-') { e.preventDefault(); deleteByShape(); return; }
    if (ctrl && lk === 'a') { e.preventDefault(); const reg = currentRegion(sh, sel.r, sel.c); const [r1, r2, c1, c2] = rangeBounds(); if ((reg.r1 !== reg.r2 || reg.c1 !== reg.c2) && !(r1 === reg.r1 && r2 === reg.r2 && c1 === reg.c1 && c2 === reg.c2)) { sel.ar = reg.r1; sel.ac = reg.c1; select(reg.r2, reg.c2, true); } else { sel.ar = 0; sel.ac = 0; select(Math.max(sh.maxR, 0), Math.max(sh.maxC, 0), true); } return; }
    if (k === 'F4' && ctrl) return;
    if (k === 'F11' && e.shiftKey) { e.preventDefault(); addSheet(); return; }
    if (k === 'F9') { e.preventDefault(); changed({ full: true }); toast('Neu berechnet'); return; }
    if (!ctrl && !e.altKey && k.length === 1) { e.preventDefault(); startEdit(k); }
  });
  /** Ctrl+Arrow: jump to the edge of the data block (or the next filled cell). Returns the delta. */
  function edge(dr, dc) {
    let r = sel.r, c = sel.c;
    const filled = (rr, cc) => { const v = valueAt(sh, rr, cc); const x = getCell(sh, rr, cc); return !!(x && x.f) || (v !== null && v !== undefined && v !== ''); };
    const maxR = Math.max(sh.maxR, sel.r), maxC = Math.max(sh.maxC, sel.c);
    const inside = (rr, cc) => rr >= 0 && cc >= 0 && rr <= maxR && cc <= maxC;
    if (filled(r, c) && inside(r + dr, c + dc) && filled(r + dr, c + dc)) {
      while (inside(r + dr, c + dc) && filled(r + dr, c + dc)) { r += dr; c += dc; }
    } else {
      r += dr; c += dc;
      while (inside(r, c) && !filled(r, c)) { r += dr; c += dc; }
      if (!inside(r, c)) { r = dr > 0 ? (sh.maxR >= sel.r ? Math.max(sel.r, maxR) : sel.r) : dr < 0 ? 0 : sel.r; c = dc > 0 ? Math.max(sel.c, maxC) : dc < 0 ? 0 : sel.c; if (dr > 0 && !filled(r, c)) r = Math.max(sel.r, sh.maxR); }
    }
    return dr ? r - sel.r : c - sel.c;
  }

  // ---------------- clipboard ----------------
  let internalClip = null;
  function copyMarkClearOnMove() { /* the marching-ants frame stays until Esc or an edit */ }
  function buildClip(cut) {
    const [r1, r2, c1, c2] = rangeBounds();
    const R2 = Math.min(r2, Math.max(sh.maxR, r1)), C2 = Math.min(c2, Math.max(sh.maxC, c1));
    const grid = [], textRows = [];
    let html = '<table>';
    for (let r = r1; r <= R2; r++) {
      if (rowHidden(r) && !cut) continue;
      const row = [], trow = [];
      html += '<tr>';
      for (let c = c1; c <= C2; c++) {
        const cell = getCell(sh, r, c);
        const sp = !cell && sh.spill.get(KEY(r, c));
        const t = sp ? formatValue(sp.v, null) : displayOf(cell);
        trow.push(t);
        row.push(cell ? { ...cell, s: cell.s ? { ...cell.s } : undefined } : sp ? { v: sp.v } : null);
        const s = (cell && cell.s) || {};
        const css = [s.b ? 'font-weight:bold' : '', s.i ? 'font-style:italic' : '', s.color ? `color:${s.color}` : '', s.fill ? `background-color:${s.fill}` : '', s.align ? `text-align:${s.align}` : ''].filter(Boolean).join(';');
        html += `<td${css ? ` style="${css}"` : ''}>${esc(t)}</td>`;
      }
      html += '</tr>';
      grid.push(row); textRows.push(trow);
    }
    html += '</table>';
    const text = toTsv(textRows);
    internalClip = { text, grid, r1, c1, h: grid.length, w: grid[0] ? grid[0].length : 0, cut, si, sheetName: sh.name };
    copyMark = { si, r1, r2: R2, c1, c2: C2 };
    schedule();
    return { text, html };
  }
  const onCopy = e => {
    if (editing || document.activeElement !== scroll) return;
    if (e.type === 'cut' && !guard()) { e.preventDefault(); return; }
    const { text, html } = buildClip(e.type === 'cut');
    e.clipboardData.setData('text/plain', text);
    e.clipboardData.setData('text/html', html);
    e.preventDefault();
    if (e.type === 'cut') toast('Ausgeschnitten – an der Zielzelle einfügen (Strg+V).');
  };
  const onPaste = e => {
    if (editing || document.activeElement !== scroll) return;
    const text = e.clipboardData.getData('text/plain');
    const html = e.clipboardData.getData('text/html');
    e.preventDefault();
    pasteData(text, html);
  };
  function pasteData(text, html, opts = {}) {
    if (internalClip && (internalClip.text === text || (!text && !html))) { pasteInternal(opts); return; }
    const table = html ? parseHtmlTable(html) : null;
    let grid;
    if (table && table.rows.length) grid = table.rows.map(r => r.map(c => ({ text: c.text, s: pickFmt(c) })));
    else grid = parseTsv(text || '').map(r => r.map(t => ({ text: t })));
    if (!grid.length || (grid.length === 1 && grid[0].length === 1 && grid[0][0].text === '' && !text)) return;
    if (opts.transpose) grid = grid[0].map((_, c) => grid.map(r => r[c] || { text: '' }));
    const tg = { r1: sel.r, c1: sel.c, r2: sel.r + grid.length - 1, c2: sel.c + Math.max(...grid.map(r => r.length)) - 1 };
    if (!guard([tg])) return;
    pushUndo();
    const cells = [];
    grid.forEach((row, dr) => row.forEach((it, dc) => {
      const r = sel.r + dr, c = sel.c + dc;
      if (opts.skip && it.text === '') return;
      if (opts.what !== 'formats') { try { applyInput(r, c, it.text, { record: false, recalc: false }); } catch { setCell(sh, r, c, { v: it.text }); } }
      if (it.s && opts.what !== 'values' && opts.what !== 'formulas') { const cur = getCell(sh, r, c); setCell(sh, r, c, { ...(cur || { v: null }), s: { ...((cur && cur.s) || {}), ...it.s } }); }
      cells.push({ r, c });
    }));
    setSel(tg.r1, tg.c1, tg.r2, tg.c2, tg.r1, tg.c1);
    changed({ cells });
  }
  function pickFmt(c) { const s = {}; if (c.b) s.b = true; if (c.i) s.i = true; if (c.align) s.align = c.align; const toHex = x => { if (!x) return null; if (/^#/.test(x)) return x.length === 4 ? '#' + x.slice(1).split('').map(y => y + y).join('').toUpperCase() : x.toUpperCase(); const m = /(\d+)\D+(\d+)\D+(\d+)/.exec(x); return m ? '#' + [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, '0')).join('').toUpperCase() : null; }; const f = toHex(c.fill), co = toHex(c.color); if (f) s.fill = f; if (co) s.color = co; return Object.keys(s).length ? s : null; }
  /** Paste the internal clipboard. opts: {what: all|values|formats|formulas|valfmt, op: + - * /, skip, transpose} */
  function pasteInternal(opts = {}) {
    const clip = internalClip;
    const what = opts.what || 'all';
    let grid = clip.grid;
    if (opts.transpose) grid = grid[0].map((_, c) => grid.map(r => r[c]));
    const H = grid.length, Wd = grid[0] ? grid[0].length : 0;
    // tile into a larger selection that is a multiple of the copied block
    const [r1, r2, c1, c2] = rangeBounds();
    const selH = r2 - r1 + 1, selW = c2 - c1 + 1;
    const tilesR = !opts.transpose && selH > H && selH % H === 0 ? selH / H : 1, tilesC = !opts.transpose && selW > Wd && selW % Wd === 0 ? selW / Wd : 1;
    const top = r1, left = c1;
    const tg = { r1: top, c1: left, r2: top + H * tilesR - 1, c2: left + Wd * tilesC - 1 };
    if (!guard([tg])) return;
    pushUndo(clip.cut && clip.si !== si ? 'wb' : 'sheet');
    const cells = [];
    const srcSh = wb.sheets[clip.si] || sh;
    if (clip.cut) {
      // move: clear source first (only cells not overwritten by the target)
      for (let dr = 0; dr < clip.h; dr++) for (let dc = 0; dc < clip.w; dc++) { setCell(srcSh, clip.r1 + dr, clip.c1 + dc, null); cells.push({ si: clip.si, r: clip.r1 + dr, c: clip.c1 + dc }); }
    }
    for (let tr = 0; tr < tilesR; tr++) for (let tc = 0; tc < tilesC; tc++) {
      grid.forEach((row, dr) => row.forEach((cell, dc) => {
        const r = top + tr * H + dr, c = left + tc * Wd + dc;
        if (opts.skip && (!cell || (cell.v == null && !cell.f))) return;
        const cur = getCell(sh, r, c);
        let n;
        const srcR = opts.transpose ? clip.r1 + dc : clip.r1 + dr, srcC = opts.transpose ? clip.c1 + dr : clip.c1 + dc;
        if (!cell) n = what === 'formats' || what === 'values' ? (cur ? { ...cur, ...(what === 'formats' ? { s: undefined } : { v: null, f: undefined }) } : null) : null;
        else {
          const val = cell.f ? cell.cv : cell.v;
          if (what === 'values') n = { ...(cur && cur.s ? { s: { ...cur.s } } : {}), v: isErr(val) ? val : val ?? null };
          else if (what === 'valfmt') n = { ...(cell.s || (cur && cur.s) ? { s: { ...((cur && cur.s) || {}), ...(cell.s && cell.s.fmt ? { fmt: cell.s.fmt } : {}) } } : {}), v: val ?? null };
          else if (what === 'formats') n = { ...(cur || { v: null }), s: cell.s ? { ...cell.s } : undefined };
          else if (what === 'formulas') n = { ...(cur && cur.s ? { s: { ...cur.s } } : {}), ...(cell.f ? { f: cell.f, da: cell.da } : { v: cell.v }) };
          else n = { ...cell, s: cell.s ? { ...cell.s } : undefined };
          if (n) { delete n.cv; delete n.cv0; delete n.spill; }
          if (n && n.f && !clip.cut) n.f = shiftFormula(n.f, r - srcR, c - srcC);
          if (n && n.f && clip.cut && clip.si !== si) n.f = n.f; // moved across sheets: references stay as they are
          if (n && opts.op && what !== 'formats') {
            const a = typeof (cur && (cur.f ? cur.cv : cur.v)) === 'number' ? (cur.f ? cur.cv : cur.v) : 0;
            const b = typeof val === 'number' ? val : null;
            if (b !== null) { const res = opts.op === '+' ? a + b : opts.op === '-' ? a - b : opts.op === '*' ? a * b : b === 0 ? null : a / b; n = { ...(cur && cur.s ? { s: { ...cur.s } } : {}), v: res === null ? null : +res.toPrecision(15) }; delete n.f; }
          }
        }
        if (n && n.s && !Object.keys(n.s).some(x => n.s[x] != null)) delete n.s;
        setCell(sh, r, c, n && (n.v != null || n.f || n.s) ? n : null);
        cells.push({ r, c });
      }));
    }
    if (clip.cut) {
      // references elsewhere that pointed into the moved block follow it
      const dr = top - clip.r1, dc = left - clip.c1;
      const srcName = srcSh.name.toLowerCase();
      wb.sheets.forEach((s2, k2) => {
        for (const [kk, cell] of s2.cells) {
          if (!cell.f) continue;
          const f = shiftRefs(cell.f, (ref, sheet) => {
            const t = sheet == null ? k2 : wb.sheets.findIndex(x => x.name.toLowerCase() === String(sheet).toLowerCase());
            if (t !== clip.si || ref.colOnly || ref.rowOnly) return ref;
            if (ref.r >= clip.r1 && ref.r < clip.r1 + clip.h && ref.c >= clip.c1 && ref.c < clip.c1 + clip.w) return { ...ref, r: ref.r + dr, c: ref.c + dc };
            return ref;
          });
          if (f !== cell.f) s2.cells.set(kk, { ...cell, f: clip.si !== si && k2 !== si ? f : f });
        }
      });
      void srcName;
      internalClip = null; copyMark = null;
      changed({ full: true });
    } else changed({ cells: cells.length > 4000 ? null : cells, full: cells.length > 4000 });
    setSel(tg.r1, tg.c1, tg.r2, tg.c2, tg.r1, tg.c1);
    updateBar(); schedule();
  }
  async function clipboardAction(kind2) {
    if (kind2 === 'copy' || kind2 === 'cut') {
      if (kind2 === 'cut' && !guard()) return;
      const { text, html } = buildClip(kind2 === 'cut');
      try {
        if (navigator.clipboard && window.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]);
        else if (navigator.clipboard) await navigator.clipboard.writeText(text);
      } catch {}
      toast(kind2 === 'cut' ? 'Ausgeschnitten' : 'Kopiert');
      return;
    }
    let text = '';
    try { if (navigator.clipboard && navigator.clipboard.readText) text = await navigator.clipboard.readText(); } catch {}
    if (!text && !internalClip) { toast('Zum Einfügen von außerhalb bitte Strg+V verwenden.', 'info'); return; }
    pasteData(text || (internalClip && internalClip.text), '', {});
  }
  async function pasteSpecial() {
    if (!internalClip) {
      let text = '';
      try { if (navigator.clipboard && navigator.clipboard.readText) text = await navigator.clipboard.readText(); } catch {}
      if (!text) { toast('Kopiere zuerst Zellen in dieser Tabelle (Strg+C).', 'info'); return; }
      const opts = await D.pasteSpecialDialog();
      if (opts) pasteData(text, '', opts);
      return;
    }
    const opts = await D.pasteSpecialDialog();
    if (!opts) return;
    pasteInternal(opts);
    scroll.focus({ preventScroll: true });
  }
  document.addEventListener('copy', onCopy);
  document.addEventListener('cut', onCopy);
  document.addEventListener('paste', onPaste);

  // ---------------- undo ----------------
  function snapSheet(s) { return { cells: new Map(s.cells), colW: s.colW.slice(), merges: s.merges.map(m => ({ ...m })), freeze: s.freeze, ex: extrasSnapshot(s), noGrid: !!s.noGrid }; }
  function applySnap(s, st) { s.cells = st.cells; s.colW = st.colW; s.merges = st.merges; s.freeze = st.freeze; s.noGrid = st.noGrid; restoreExtras(s, st.ex); if (s.spill) s.spill.clear(); for (const c of s.cells.values()) if (c.spill) { /* recomputed */ } recomputeBounds(s); }
  function snapshot(kind2 = 'sheet') {
    const names = JSON.stringify(wb.names || []);
    if (kind2 === 'wb') return { wb: true, si, sheets: wb.sheets.map(s => ({ ref: s, st: snapSheet(s) })), names };
    return { si, st: snapSheet(sh), names };
  }
  function pushUndo(kind2 = 'sheet') {
    undo.push(snapshot(kind2));
    const limit = sh.cells.size > 200000 ? 5 : sh.cells.size > 20000 ? 40 : 100;
    while (undo.length > limit) undo.shift();
    redo.length = 0;
  }
  function restore(s) {
    if (s.wb) {
      wb.sheets = s.sheets.map(x => { applySnap(x.ref, x.st); return x.ref; });
    } else {
      const target = wb.sheets[s.si];
      if (!target) return;
      applySnap(target, s.st);
    }
    wb.names = JSON.parse(s.names || '[]');
    invalidateDeps(wb);
    const nsi = Math.min(s.si, wb.sheets.length - 1);
    if (si !== nsi || s.wb) switchSheet(nsi, { keepSel: si === nsi });
    changed({ full: true });
  }
  function doUndo() { if (editing) { cancel(); return; } const s = undo.pop(); if (!s) { toast('Nichts zum Rückgängigmachen.'); return; } redo.push(s.wb ? snapshot('wb') : { ...snapshot('sheet'), si: s.si, st: snapSheet(wb.sheets[s.si]) }); restore(s); }
  function doRedo() { const s = redo.pop(); if (!s) return; undo.push(s.wb ? snapshot('wb') : { ...snapshot('sheet'), si: s.si, st: snapSheet(wb.sheets[s.si]) }); restore(s); }

  // ---------------- toolbar actions ----------------
  /** Apply fn(cell, r, c) to every cell of a range (creates styled empty cells when needed). */
  function forRange(rg, fn, { createEmpty = true } = {}) {
    const R2 = Math.min(rg.r2, Math.max(rg.r1, sh.maxR)), C2 = Math.min(rg.c2, Math.max(rg.c1, sh.maxC));
    for (let r = rg.r1; r <= R2; r++) {
      if (rowHidden(r) && R2 - rg.r1 > 0 && rg.r1 !== rg.r2 && rg.c1 === 0 && false) continue;
      for (let c = rg.c1; c <= C2; c++) {
        const cur = getCell(sh, r, c);
        if (!cur && !createEmpty) continue;
        const n = cur ? { ...cur, s: { ...(cur.s || {}) } } : { v: null, s: {} };
        fn(n, r, c);
        if (n.s && !Object.keys(n.s).some(k => n.s[k] != null && n.s[k] !== false)) delete n.s;
        setCell(sh, r, c, n);
      }
    }
  }
  function forEachSel(fn, opts) { for (const rg of allRanges()) forRange(rg, fn, opts); }
  function styleOp(fn) { if (!guard()) return; pushUndo(); forEachSel(fn); changed({ recalc: false }); }
  function toggleStyle(key) {
    const cur = getCell(sh, sel.r, sel.c);
    const on = !(cur && cur.s && cur.s[key]);
    styleOp(n => { n.s[key] = on || undefined; });
  }
  function clearSelection(what = 'content') {
    if (!guard()) return;
    pushUndo();
    const cells = [];
    for (const rg of allRanges()) {
      for (let r = rg.r1; r <= Math.min(rg.r2, sh.maxR); r++) for (let c = rg.c1; c <= Math.min(rg.c2, sh.maxC); c++) {
        const cur = getCell(sh, r, c);
        if (!cur) continue;
        if (what === 'all') setCell(sh, r, c, null);
        else if (what === 'formats') setCell(sh, r, c, cur.f || cur.v != null ? { ...cur, s: undefined } : null);
        else setCell(sh, r, c, cur.s ? { v: null, s: cur.s } : null);
        cells.push({ r, c });
      }
    }
    changed({ cells });
  }
  const SWATCH = ['#1A1A1A', '#B91C1C', '#C2410C', '#B45309', '#15803D', '#0B8F80', '#2F67D8', '#3B37A0', '#7E22CE', '#6B7194'];
  const FILLS = ['#FDE047', '#FED7AA', '#FBCFE8', '#A7F3D0', '#BFDBFE', '#E9E8FB', '#E5E7EB', '#C6EFCE', '#FFC7CE', '#FFEB9C'];
  const tbars = $$('.office-toolbar', root);
  tbars.forEach(tbar => {
    tbar.addEventListener('mousedown', e => { if (e.target.closest('button') && editing) e.preventDefault(); });
    tbar.addEventListener('click', e => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const a = b.dataset.a;
      if (editing && !['sum', 'fx', 'fxdlg'].includes(a)) { if (!commit()) return; }
      doAction(a, b);
    });
  });
  function doAction(a, b = null) {
    const anchor = b || $(`[data-a="${a}"]`, root) || scroll;
    switch (a) {
      case 'undo': doUndo(); break;
      case 'redo': doRedo(); break;
      case 'bold': toggleStyle('b'); break;
      case 'italic': toggleStyle('i'); break;
      case 'underline': toggleStyle('u'); break;
      case 'strike': toggleStyle('st'); break;
      case 'color': officeMenu(anchor, [...SWATCH.map(c => ({ label: c === '#1A1A1A' ? 'Automatisch (schwarz)' : colorLabel(c), icon: 'color', onClick: () => styleOp(n => { n.s.color = c === '#1A1A1A' ? undefined : c; }) })), '-', { label: 'Weitere Farben …', icon: 'sparkle', onClick: () => pickCustomColor(c => styleOp(n => { n.s.color = c; })) }], { label: 'Textfarbe' }); break;
      case 'fill': officeMenu(anchor, [{ label: 'Keine Füllung', icon: 'close', onClick: () => { if (!guard()) return; pushUndo(); forEachSel(n => { n.s.fill = undefined; }, { createEmpty: false }); changed({ recalc: false }); } }, ...FILLS.map(c => ({ label: colorLabel(c), icon: 'fill', onClick: () => styleOp(n => { n.s.fill = c; }) })), '-', { label: 'Weitere Farben …', icon: 'sparkle', onClick: () => pickCustomColor(c => styleOp(n => { n.s.fill = c; })) }], { label: 'Füllfarbe' }); break;
      case 'al-left': case 'al-center': case 'al-right': { const v = a.slice(3); const cur = getCell(sh, sel.r, sel.c); const off = cur && cur.s && cur.s.align === v; styleOp(n => { n.s.align = off ? undefined : v; }); } break;
      case 'valign': officeMenu(anchor, [['top', 'Oben'], ['center', 'Mitte'], ['', 'Unten']].map(([k, l]) => ({ label: l, icon: 'valign', onClick: () => styleOp(n => { n.s.valign = k || undefined; }) })), { label: 'Vertikal ausrichten' }); break;
      case 'dec-up': case 'dec-down': changeDecimals(a === 'dec-up' ? 1 : -1); break;
      case 'styles': officeMenu(anchor, CELL_STYLES.map(cs => ({ label: cs.label, icon: 'cellStyles', onClick: () => styleOp(n => { const keep = { fmt: n.s.fmt, wrap: n.s.wrap, align: n.s.align, unlocked: n.s.unlocked }; n.s = { ...keep, ...JSON.parse(JSON.stringify(cs.s)) }; }) })), { label: 'Zellenformatvorlagen' }); break;
      case 'sum': autoSum(); break;
      case 'sumx': officeMenu(anchor, [['SUMME', 'Summe'], ['MITTELWERT', 'Mittelwert'], ['ANZAHL', 'Anzahl'], ['MAX', 'Maximum'], ['MIN', 'Minimum']].map(([f, l]) => ({ label: l, icon: 'sigma', onClick: () => autoSum(f) })), { label: 'AutoSumme' }); break;
      case 'fx': officeMenu(anchor, [...FUNCTION_LIST.slice(0, 16).map(([n, , d, ex]) => ({ label: `${n} – ${d}`, icon: 'fx', onClick: () => { if (!editing) startEdit('=' + ex); else insertRef(ex); } })), '-', { label: 'Alle Funktionen …', icon: 'fxList', onClick: () => fxDialog() }], { label: 'Funktion einfügen' }); break;
      case 'fxdlg': fxDialog(); break;
      case 'row-add': case 'row-del': case 'col-add': case 'col-del': structural(a); break;
      case 'border': borderMenu(anchor); break;
      case 'wrap': toggleStyle('wrap'); break;
      case 'merge': mergeAction(); break;
      case 'cf': case 'cf2': cfDialog(); break;
      case 'filter': toggleFilter(); break;
      case 'filterclear': if (sh.autoFilter) { pushUndo(); sh.autoFilter.filters = {}; changed({ full: true }); toast('Alle Filter gelöscht'); } else toast('Auf diesem Blatt ist kein Filter aktiv.', 'info'); break;
      case 'dv': case 'dv2': D.dvDialog(api); break;
      case 'chart': case 'ins-chart': insertChart(); break;
      case 'find': openFind(true); break;
      case 'sort-asc': case 'sort-desc': doSort(a === 'sort-asc'); break;
      case 'sortdlg': D.sortDialog(api); break;
      case 'freeze': { pushUndo(); if (sh.freeze || sh.freezeC) { sh.freeze = 0; sh.freezeC = 0; } else sh.freeze = 1; shell.markDirty(); layout(); schedule(); toast(sh.freeze ? 'Erste Zeile fixiert' : 'Fixierung aufgehoben'); } break;
      case 'freezemenu': officeMenu(anchor, [
        { label: `Bis ${addr(sel.r, sel.c)} fixieren (Zeilen darüber, Spalten links)`, icon: 'freezePanes', onClick: () => setFreeze(sel.r, sel.c) },
        { label: 'Oberste Zeile fixieren', icon: 'freeze', onClick: () => setFreeze(1, 0) },
        { label: 'Erste Spalte fixieren', icon: 'freeze', onClick: () => setFreeze(0, 1) },
        { label: 'Fixierung aufheben', icon: 'close', onClick: () => setFreeze(0, 0) },
      ], { label: 'Fixieren' }); break;
      case 'grid': pushUndo(); sh.noGrid = !sh.noGrid; shell.markDirty(); layout(); schedule(); break;
      case 'showf': showFormulas = !showFormulas; layout(); schedule(); break;
      case 'keys': shortcutsDialog(); break;
      case 'pivot': D.pivotDialog(api); break;
      case 'pivot-refresh': if (sh.pivot) { refreshPivot(sh); toast('Pivot-Tabelle aktualisiert', 'success'); } else { const p = wb.sheets.filter(s => s.pivot); if (p.length) { p.forEach(refreshPivot); toast(`${p.length} Pivot-Tabelle${p.length > 1 ? 'n' : ''} aktualisiert`, 'success'); } else toast('Diese Mappe enthält keine Pivot-Tabelle.', 'info'); } break;
      case 'ins-date': startEdit(formatValue(dateToSerial(new Date()), 'dd.mm.yyyy')); commit(); break;
      case 'ins-time': { const d = new Date(); startEdit(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`); commit(); } break;
      case 'defname': D.nameManagerDialog(api, { defineOnly: true }); break;
      case 'names': D.nameManagerDialog(api); break;
      case 'recalc': changed({ full: true }); toast('Alle Formeln neu berechnet'); break;
      case 'dedupe': D.dedupeDialog(api); break;
      case 't2c': D.textToColumnsDialog(api); break;
      case 'series': D.seriesDialog(api); break;
      case 'protect': toggleProtect(); break;
      case 'note': editNote(); break;
      case 'link': editLink(); break;
      case 'pagesetup': pageSetup(); break;
      case 'pdf': exportPdf(); break;
      case 'printarea': { const [r1, r2, c1, c2] = rangeBounds(); pushUndo(); sh.page = { ...(sh.page || {}), area: rangeStr({ r1, r2, c1, c2: Math.min(c2, Math.max(c1, sh.maxC)) }) }; shell.markDirty(); toast(`Druckbereich: ${sh.page.area}`, 'success'); break; }
      case 'printarea-clear': if (sh.page && sh.page.area) { pushUndo(); sh.page = { ...sh.page, area: null }; shell.markDirty(); toast('Druckbereich aufgehoben'); } else toast('Es ist kein Druckbereich festgelegt.', 'info'); break;
      case 'printtitles': { const [r1, r2] = rangeBounds(); setPrintTitles(r1, r2); break; }
      case 'goto': gotoDialog(); break;
      case 'group': { const [r1, r2] = rangeBounds(); groupRows(r1, r2, 1); break; }
      case 'ungroup': { const [r1, r2] = rangeBounds(); groupRows(r1, r2, -1); break; }
      case 'subtotal': subtotals(); break;
    }
  }
  const COLOR_LABELS = { '#1A1A1A': 'Schwarz', '#B91C1C': 'Rot', '#C2410C': 'Orange', '#B45309': 'Braun', '#15803D': 'Grün', '#0B8F80': 'Petrol', '#2F67D8': 'Blau', '#3B37A0': 'Indigo', '#7E22CE': 'Violett', '#6B7194': 'Grau', '#FDE047': 'Gelb', '#FED7AA': 'Apricot', '#FBCFE8': 'Rosa', '#A7F3D0': 'Mint', '#BFDBFE': 'Hellblau', '#E9E8FB': 'Lavendel', '#E5E7EB': 'Hellgrau', '#C6EFCE': 'Gut (grün)', '#FFC7CE': 'Schlecht (rot)', '#FFEB9C': 'Neutral (gelb)' };
  const colorLabel = c => COLOR_LABELS[c] || c;
  function pickCustomColor(cb) {
    const inp = h('<input type="color" class="sr-only" value="#3B37A0" tabindex="-1">');
    root.appendChild(inp);
    inp.addEventListener('change', () => { cb(inp.value.toUpperCase()); inp.remove(); });
    inp.addEventListener('blur', () => setTimeout(() => inp.remove(), 500));
    inp.click();
  }
  function changeDecimals(d) {
    const cur = getCell(sh, sel.r, sel.c);
    let code = (cur && cur.s && cur.s.fmt) || 'General';
    if (code === 'General') { const v = valueAt(sh, sel.r, sel.c); const dec = typeof v === 'number' && !Number.isInteger(v) ? Math.min(9, (String(v).split('.')[1] || '').length) : 0; code = dec ? '0.' + '0'.repeat(dec) : '0'; }
    const bump = c => c.split(';').map(sec => sec.replace(/(0|#)(\.(0+))?(?![^"]*"(?:[^"]*"[^"]*")*[^"]*$)/, (m, a, b, z) => { const n = Math.max(0, (z || '').length + d); return a + (n ? '.' + '0'.repeat(n) : ''); })).join(';');
    const next = bump(code);
    styleOp(n => { n.s.fmt = next; });
  }
  function setFreeze(r, c) { pushUndo(); sh.freeze = r; sh.freezeC = c; shell.markDirty(); layout(); schedule(); toast(r || c ? `Fixiert: ${r ? `${r} Zeile${r > 1 ? 'n' : ''}` : ''}${r && c ? ', ' : ''}${c ? `${c} Spalte${c > 1 ? 'n' : ''}` : ''}` : 'Fixierung aufgehoben'); }
  function toggleProtect() {
    pushUndo();
    if (sh.protect && sh.protect.on) { sh.protect = null; toast('Blattschutz aufgehoben'); }
    else { sh.protect = { on: true }; toast('Blatt geschützt – nur entsperrte Zellen sind änderbar. Hinweis: Das ist ein Schutz vor versehentlichen Änderungen, keine Verschlüsselung.', 'info', { timeout: 6000 }); }
    shell.markDirty(); layout(); updateBar();
  }
  fmtSel.addEventListener('change', () => {
    if (fmtSel.value === 'custom') { D.formatCellsDialog(api, 'num'); updateBar(); return; }
    if (!guard()) { updateBar(); return; }
    pushUndo();
    const code = FORMATS[fmtSel.value].code;
    forEachSel(n => {
      n.s.fmt = code === 'General' ? undefined : code;
      if ((fmtSel.value === 'date' || fmtSel.value === 'time') && typeof n.v === 'string') { const p = parseInput(n.v, code); if (typeof p.v === 'number') n.v = p.v; }
    }, { createEmpty: true });
    changed({ recalc: false });
    scroll.focus({ preventScroll: true });
  });
  fontSel.addEventListener('change', () => { const f = fontSel.value; styleOp(n => { n.s.font = f || undefined; }); scroll.focus({ preventScroll: true }); });
  fsizeSel.addEventListener('change', () => { const z = +fsizeSel.value; styleOp(n => { n.s.size = z === 11 ? undefined : z; }); scroll.focus({ preventScroll: true }); });
  async function fxDialog() {
    const ex = await D.insertFunctionDialog();
    if (!ex) return;
    if (!editing) startEdit('=' + ex); else insertRef(ex);
  }
  function autoSum(fn = 'SUMME') {
    // find numbers above (or left) of the active cell
    let r = sel.r - 1;
    const isNum = (rr, cc) => typeof valueAt(sh, rr, cc) === 'number';
    while (r >= 0 && isNum(r, sel.c)) r--;
    let ref;
    if (r < sel.r - 1) ref = `${addr(r + 1, sel.c)}:${addr(sel.r - 1, sel.c)}`;
    else {
      let c = sel.c - 1;
      while (c >= 0 && isNum(sel.r, c)) c--;
      ref = c < sel.c - 1 ? `${addr(sel.r, c + 1)}:${addr(sel.r, sel.c - 1)}` : '';
    }
    if (editing) cancel();
    startEdit(`=${fn}(${ref})`);
  }
  function doSort(asc) {
    const [r1, r2, c1, c2] = rangeBounds();
    let from = r1, to = r2, cs = c1, ce = c2;
    if (r1 === r2 && c1 === c2) {
      const reg = currentRegion(sh, sel.r, sel.c);
      from = reg.r1; to = reg.r2; cs = reg.c1; ce = reg.c2;
      if ((sh.freeze && from < sh.freeze) || hasHeader(reg)) from = Math.max(from + 1, sh.freeze || 0);
    } else if (r1 === r2) { from = sh.freeze || 0; to = sh.maxR; }
    to = Math.min(to, sh.maxR);
    if (to <= from) { toast('Nichts zu sortieren.'); return; }
    if (!guard([{ r1: from, r2: to, c1: cs, c2: ce }])) return;
    pushUndo();
    sortRows(wb, si, from, to, sel.c, asc, cs, ce);
    changed({ full: true });
    toast(`Zeilen ${from + 1}–${to + 1} nach Spalte ${colName(sel.c)} sortiert`);
  }
  function hasHeader(rg) {
    const head = getCell(sh, rg.r1, rg.c1 <= sel.c && sel.c <= rg.c2 ? sel.c : rg.c1), next = getCell(sh, rg.r1 + 1, rg.c1 <= sel.c && sel.c <= rg.c2 ? sel.c : rg.c1);
    const hv = head ? (head.f ? head.cv : head.v) : null, nv = next ? (next.f ? next.cv : next.v) : null;
    if (head && head.s && head.s.b) return true;
    if (typeof hv === 'string' && typeof nv === 'number') return true;
    // all header cells text and at least one column numeric below
    let allText = true, anyNum = false;
    for (let c = rg.c1; c <= rg.c2; c++) { const v = valueAt(sh, rg.r1, c); if (v !== null && typeof v !== 'string') allText = false; if (typeof valueAt(sh, rg.r1 + 1, c) === 'number') anyNum = true; }
    return allText && anyNum;
  }
  function dataRange() {
    const [r1, r2, c1, c2] = rangeBounds();
    if (r1 === r2 && c1 === c2) return currentRegion(sh, sel.r, sel.c);
    return { r1, c1, r2: Math.min(r2, Math.max(r1, sh.maxR)), c2: Math.min(c2, Math.max(c1, sh.maxC)) };
  }
  function sortRange(rg, keys) {
    if (rg.r2 < rg.r1) return;
    if (!guard([rg])) return;
    pushUndo();
    sortRowsMulti(wb, si, rg.r1, Math.min(rg.r2, sh.maxR), rg.c1, rg.c2, keys);
    changed({ full: true });
    toast(`Sortiert nach ${keys.map(k => `${colName(k.c)} ${k.asc ? '↑' : '↓'}`).join(', ')}`);
  }
  function structural(a) {
    if (!guard([], { structural: true })) return;
    const [r1, r2, c1, c2] = rangeBounds();
    pushUndo('wb');
    if (a === 'row-add') { insertRows(wb, si, r1, r2 - r1 + 1); shiftSheetRanges(sh, 'r', r1, r2 - r1 + 1, false); changed({ full: true }); toast('Zeile eingefügt'); }
    if (a === 'row-del') { deleteRows(wb, si, r1, r2 - r1 + 1); shiftSheetRanges(sh, 'r', r1, r2 - r1 + 1, true); changed({ full: true }); }
    if (a === 'col-add') { insertCols(wb, si, c1, c2 - c1 + 1); shiftSheetRanges(sh, 'c', c1, c2 - c1 + 1, false); changed({ full: true }); toast('Spalte eingefügt'); }
    if (a === 'col-del') { deleteCols(wb, si, c1, c2 - c1 + 1); shiftSheetRanges(sh, 'c', c1, c2 - c1 + 1, true); changed({ full: true }); }
  }
  function insertByShape() { const [r1, r2, c1, c2] = rangeBounds(); if (c1 === 0 && c2 >= Math.max(sh.maxC, 0) && r2 > r1 - 1 && sel.ac === 0) structural('row-add'); else if (r1 === 0 && r2 >= Math.max(sh.maxR, 0) && sel.ar === 0) structural('col-add'); else officeMenu(scroll, [{ label: 'Ganze Zeile einfügen', icon: 'rowAdd', onClick: () => structural('row-add') }, { label: 'Ganze Spalte einfügen', icon: 'colAdd', onClick: () => structural('col-add') }], { label: 'Einfügen' }); }
  function deleteByShape() { const [r1, r2, c1, c2] = rangeBounds(); if (c1 === 0 && c2 >= Math.max(sh.maxC, 0) && sel.ac === 0) structural('row-del'); else if (r1 === 0 && r2 >= Math.max(sh.maxR, 0) && sel.ar === 0) structural('col-del'); else officeMenu(scroll, [{ label: 'Ganze Zeile löschen', icon: 'rowDel', onClick: () => structural('row-del') }, { label: 'Ganze Spalte löschen', icon: 'colDel', onClick: () => structural('col-del') }], { label: 'Löschen' }); void r2; }

  // ---------------- Rahmen, Umbruch, Verbinden ----------------
  function borderMenu(anchor) {
    const apply = mode => {
      if (!guard()) return;
      pushUndo();
      for (const rg of allRanges()) forRange(rg, (n, r, c) => { n.s.bd = D.applyBorderPreset(n.s.bd, mode, mode === 'thickouter' ? 'thick' : 'thin', '#000000', r, c, rg); }, { createEmpty: true });
      changed({ recalc: false });
    };
    officeMenu(anchor, [
      { label: 'Alle Rahmenlinien', icon: 'table', onClick: () => apply('all') },
      { label: 'Außenrahmen', icon: 'border', onClick: () => apply('outer') },
      { label: 'Dicker Außenrahmen', icon: 'border', onClick: () => apply('thickouter') },
      { label: 'Rahmen oben', icon: 'border', onClick: () => apply('top') },
      { label: 'Rahmen unten', icon: 'border', onClick: () => apply('bottom') },
      { label: 'Doppelte Rahmenlinie unten', icon: 'border', onClick: () => apply('doublebottom') },
      { label: 'Rahmen links', icon: 'border', onClick: () => apply('left') },
      { label: 'Rahmen rechts', icon: 'border', onClick: () => apply('right') },
      '-',
      { label: 'Kein Rahmen', icon: 'close', onClick: () => apply('none') },
      { label: 'Weitere Rahmen …', icon: 'sliders', onClick: () => D.formatCellsDialog(api, 'border') },
    ], { label: 'Rahmen' });
  }
  function toggleMerge(on) {
    const [r1, r2, c1, c2] = rangeBounds();
    const m = mergeAt(sel.r, sel.c);
    if (!on) { if (m) sh.merges = sh.merges.filter(x => x !== m); return; }
    if (r1 === r2 && c1 === c2) return;
    sh.merges = sh.merges.filter(x => x.r2 < r1 || x.r1 > r2 || x.c2 < c1 || x.c1 > c2);
    for (let r = r1; r <= Math.min(r2, sh.maxR); r++) for (let c = c1; c <= Math.min(c2, sh.maxC); c++) {
      if (r === r1 && c === c1) continue;
      const x = getCell(sh, r, c);
      if (x && (x.f || (x.v != null && x.v !== ''))) setCell(sh, r, c, x.s ? { v: null, s: x.s } : null);
    }
    sh.merges.push({ r1, c1, r2, c2 });
  }
  function mergeAction() {
    if (!guard()) return;
    const [r1, r2, c1, c2] = rangeBounds();
    const m = mergeAt(sel.r, sel.c);
    const exact = m && m.r1 === r1 && m.r2 === r2 && m.c1 === c1 && m.c2 === c2;
    if ((r1 === r2 && c1 === c2) || exact) {
      if (!m) { toast('Markiere mehrere Zellen, um sie zu verbinden.', 'info'); return; }
      pushUndo(); sh.merges = sh.merges.filter(x => x !== m); changed({ recalc: false }); toast('Verbindung aufgehoben'); return;
    }
    pushUndo();
    let lost = 0;
    for (let r = r1; r <= Math.min(r2, sh.maxR); r++) for (let c = c1; c <= Math.min(c2, sh.maxC); c++) {
      if (r === r1 && c === c1) continue;
      const x = getCell(sh, r, c);
      if (x && (x.f || (x.v != null && x.v !== ''))) lost++;
    }
    toggleMerge(true);
    sel.box = null; sel.r = r1; sel.c = c1; sel.ar = r1; sel.ac = c1;
    changed({ full: !!lost, recalc: !!lost });
    toast(lost ? 'Zellen verbunden – nur der Wert oben links bleibt erhalten.' : 'Zellen verbunden');
  }

  // ---------------- bedingte Formatierung ----------------
  async function cfDialog() {
    const [r1, r2, c1, c2] = rangeBounds();
    const def = rangeStr(r1 === r2 && c1 === c2 ? currentRegion(sh, sel.r, sel.c) : { r1, c1, r2, c2 });
    const rules = sh.cf;
    const groups = [['Zellwert', ['gt', 'lt', 'ge', 'le', 'between', 'eq', 'ne']], ['Oben/unten', ['top', 'bottom', 'aboveAvg', 'belowAvg']], ['Text & Sonstiges', ['contains', 'dup', 'unique', 'blank', 'notblank', 'error']], ['Formel', ['formula']], ['Grafisch', ['scale', 'bar', 'icons']]];
    const lbl = id => (CF_TYPES.find(t => t.id === id) || {}).label || id;
    const swatchOf = x => (x.type === 'scale' ? 'linear-gradient(90deg,#F8696B,#FFEB84,#63BE7B)' : x.type === 'bar' ? `linear-gradient(90deg,${(CF_BARS.find(b2 => b2.id === x.bar) || CF_BARS[0]).color} 60%,transparent 60%)` : x.type === 'icons' ? 'conic-gradient(#1E9E5A 0 33%,#E8B400 0 66%,#C23A4B 0)' : ((x.custom || CF_STYLES.find(s2 => s2.id === x.style) || {}).fill || 'transparent'));
    const r = await openDialog({
      title: 'Bedingte Formatierung', wide: true,
      body: `<div class="cf-dlg">
        ${rules.length ? `<div class="cf-list"><span class="field-label">Regeln auf diesem Blatt</span>${rules.map((x, i) => `<div class="cf-rule" data-i="${i}"><span class="cf-sw" style="background:${swatchOf(x)}"></span><span>${esc(x.range)}: ${esc(cfDescribe(x))}</span><button class="icon-btn" type="button" data-del="${i}" aria-label="Regel entfernen">${oicon('trash')}</button></div>`).join('')}</div>` : ''}
        <span class="field-label">Neue Regel</span>
        <label class="field"><span class="field-label">Bereich</span><input class="input" name="range" value="${esc(def)}" spellcheck="false"></label>
        <div class="field-row"><label class="field"><span class="field-label">Regel</span><select class="select" name="type">${groups.map(([g, ids]) => `<optgroup label="${esc(g)}">${ids.map(id => `<option value="${id}">${esc(lbl(id))}</option>`).join('')}</optgroup>`).join('')}</select></label>
          <label class="field cf-v1"><span class="field-label" data-v1l>Wert</span><input class="input" name="v1" inputmode="decimal"></label></div>
        <label class="field cf-v2" hidden><span class="field-label">und</span><input class="input" name="v2" inputmode="decimal"></label>
        <label class="check cf-pct" hidden><input type="checkbox" name="percent"> Prozent statt Anzahl</label>
        <p class="hint cf-fhint" hidden>Formel für die erste Zelle des Bereichs, z. B. <code>=$C2&gt;100</code> (ganze Zeile hervorheben) oder <code>=REST(ZEILE();2)=0</code> (jede zweite Zeile). Bezüge passen sich für die anderen Zellen an.</p>
        <label class="field cf-style"><span class="field-label">dann formatieren als</span><select class="select" name="style">${CF_STYLES.map(st => `<option value="${st.id}">${st.label}</option>`).join('')}</select></label>
        <label class="field cf-scale" hidden><span class="field-label">Farbskala</span><select class="select" name="scale">${CF_SCALES.map(sc => `<option value="${sc.id}">${sc.label}</option>`).join('')}</select></label>
        <label class="field cf-bar" hidden><span class="field-label">Balkenfarbe</span><select class="select" name="bar">${CF_BARS.map(b2 => `<option value="${b2.id}">${b2.label}</option>`).join('')}</select></label>
        <label class="field cf-icons" hidden><span class="field-label">Symbole (oberes, mittleres, unteres Drittel)</span><select class="select" name="icons">${CF_ICONS.map(b2 => `<option value="${b2.id}">${b2.label} ${b2.icons.map(x => x[0]).join(' ')}</option>`).join('')}</select></label>
      </div>`,
      actions: [{ label: 'Schließen', value: 'cancel' }, { label: 'Regel hinzufügen', value: 'ok', kind: 'btn-primary', default: true }],
      validate: (v, dlg) => {
        if (v !== 'ok') return true;
        if (!parseRange($('[name=range]', dlg).value)) { toast('Bitte gib einen gültigen Bereich an, z. B. B2:B20.', 'error'); return false; }
        const t = $('[name=type]', dlg).value;
        const v1 = $('[name=v1]', dlg).value.trim();
        if (CF_NEEDS_V1.has(t) && !v1 && t !== 'top' && t !== 'bottom') { toast(t === 'formula' ? 'Bitte gib eine Formel ein, z. B. =$C2>100.' : 'Bitte gib einen Vergleichswert ein.', 'error'); return false; }
        if (t === 'formula') { try { toCanonical(v1.replace(/^=/, '')); } catch (e) { toast(`Formel ungültig: ${e.message || 'bitte prüfen'}`, 'error'); return false; } }
        return true;
      },
      onMount: dlg => {
        const sync = () => {
          const t = $('[name=type]', dlg).value;
          const graphic = t === 'scale' || t === 'bar' || t === 'icons';
          $('.cf-v1', dlg).hidden = !CF_NEEDS_V1.has(t);
          $('.cf-v2', dlg).hidden = t !== 'between';
          $('.cf-pct', dlg).hidden = t !== 'top' && t !== 'bottom';
          $('.cf-fhint', dlg).hidden = t !== 'formula';
          $('.cf-style', dlg).hidden = graphic;
          $('.cf-scale', dlg).hidden = t !== 'scale';
          $('.cf-bar', dlg).hidden = t !== 'bar';
          $('.cf-icons', dlg).hidden = t !== 'icons';
          $('[data-v1l]', dlg).textContent = t === 'formula' ? 'Formel' : t === 'top' || t === 'bottom' ? 'Anzahl (Standard 10)' : 'Wert';
          const v1 = $('[name=v1]', dlg);
          v1.inputMode = t === 'contains' || t === 'formula' || t === 'eq' || t === 'ne' ? 'text' : 'decimal';
          if (t === 'formula' && !v1.value) v1.value = '=';
        };
        $('[name=type]', dlg).addEventListener('change', sync);
        sync();
        $$('[data-del]', dlg).forEach(bt => bt.addEventListener('click', () => { pushUndo(); sh.cf.splice(+bt.dataset.del, 1); changed({ recalc: false }); bt.closest('.cf-rule').remove(); toast('Regel entfernt'); }));
        return { collect: () => ({ range: $('[name=range]', dlg).value.trim().toUpperCase(), type: $('[name=type]', dlg).value, v1: $('[name=v1]', dlg).value.trim(), v2: $('[name=v2]', dlg).value.trim(), percent: $('[name=percent]', dlg).checked, style: $('[name=style]', dlg).value, scale: $('[name=scale]', dlg).value, bar: $('[name=bar]', dlg).value, icons: $('[name=icons]', dlg).value }) };
      },
    });
    if (r.value !== 'ok' || !r.data) return;
    const d = r.data;
    const rule = { id: newChartId(), range: rangeStr(parseRange(d.range)), type: d.type };
    if (CF_NEEDS_V1.has(d.type)) rule.v1 = d.v1;
    if (d.type === 'between') rule.v2 = d.v2;
    if (d.type === 'top' || d.type === 'bottom') { rule.v1 = d.v1 || '10'; if (d.percent) rule.percent = true; }
    if (d.type === 'formula') { rule.f = toCanonical(d.v1.replace(/^=/, '')); rule.fd = toDisplay(rule.f); delete rule.v1; }
    if (d.type === 'scale') rule.scale = d.scale; else if (d.type === 'bar') rule.bar = d.bar; else if (d.type === 'icons') rule.icons = d.icons; else rule.style = d.style;
    pushUndo();
    sh.cf.push(rule);
    changed({ recalc: false });
    toast('Bedingte Formatierung angewendet', 'success');
  }

  // ---------------- AutoFilter ----------------
  function toggleFilter() {
    if (sh.autoFilter) { pushUndo(); sh.autoFilter = null; changed({ full: true }); toast('Filter entfernt'); return; }
    const [r1, r2, c1, c2] = rangeBounds();
    const rg = r1 === r2 && c1 === c2 ? currentRegion(sh, sel.r, sel.c) : { r1, c1, r2: Math.min(r2, Math.max(r1, sh.maxR)), c2: Math.min(c2, Math.max(c1, sh.maxC)) };
    if (rg.r2 <= rg.r1) { toast('Markiere eine Tabelle mit Überschriftenzeile, um zu filtern.', 'info'); return; }
    pushUndo();
    sh.autoFilter = { range: rangeStr(rg), filters: {} };
    changed({ recalc: false });
    toast('Filter aktiviert – tippe auf ▾ in der Kopfzeile.');
  }
  function filterBySelection() {
    const v = valueAt(sh, sel.r, sel.c);
    const text = displayOf(getCell(sh, sel.r, sel.c)) || EMPTY;
    if (!sh.autoFilter) { const rg = currentRegion(sh, sel.r, sel.c); if (rg.r2 <= rg.r1) return; sh.autoFilter = { range: rangeStr({ ...rg, r1: Math.min(rg.r1, sel.r - 1 < rg.r1 ? rg.r1 : rg.r1) }), filters: {} }; }
    pushUndo();
    sh.autoFilter.filters[sel.c] = [text];
    changed({ full: true });
    toast(`Gefiltert nach „${text}“`);
    void v;
  }
  async function filterMenu(c) {
    const af = sh.autoFilter;
    if (!af) return;
    const vals = columnValues(sh, c);
    const curF = af.filters[c];
    const cur = Array.isArray(curF) ? new Set(curF) : null;
    const numeric = (() => { const rg = parseRange(af.range); for (let r = rg.r1 + 1; r <= Math.min(rg.r2, rg.r1 + 30); r++) if (typeof valueAt(sh, r, c) === 'number') return true; return false; })();
    const r = await openDialog({
      title: `Filter: Spalte ${colName(c)}`,
      body: `<div class="af-dlg">
        <div class="af-sort"><button class="btn btn-ghost btn-sm" type="button" data-sort="asc">${oicon('sortAsc')} A → Z</button><button class="btn btn-ghost btn-sm" type="button" data-sort="desc">${oicon('sortDesc')} Z → A</button>
          <button class="btn btn-ghost btn-sm" type="button" data-custom>${oicon('filter')} ${numeric ? 'Zahlenfilter …' : 'Textfilter …'}</button></div>
        ${curF && !Array.isArray(curF) ? `<p class="small af-active">Aktiv: ${curF.top ? `obere ${curF.top}` : esc(curF.custom.map(x => `${x.op} ${x.v}`).join(curF.and ? ' UND ' : ' ODER '))}</p>` : ''}
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
        $('[data-custom]', dlg).addEventListener('click', () => { dlg._custom = true; dlg.close(); });
        return { collect: () => boxes.filter(b => b.checked).map(b => vals[+b.value].text) };
      },
    });
    if (r.dialog && r.dialog._sort) {
      const rg = parseRange(af.range);
      pushUndo();
      sortRows(wb, si, rg.r1 + 1, Math.min(rg.r2, sh.maxR), c, r.dialog._sort === 'asc', rg.c1, rg.c2);
      changed({ full: true }); toast(r.dialog._sort === 'asc' ? 'Aufsteigend sortiert' : 'Absteigend sortiert');
      return;
    }
    if (r.dialog && r.dialog._custom) {
      const f = await D.customFilterDialog(api, c);
      if (!f) return;
      pushUndo(); af.filters[c] = f; changed({ full: true });
      const hiddenN = filterHidden(sh).size;
      toast(hiddenN ? `${hiddenN} Zeile${hiddenN === 1 ? '' : 'n'} ausgeblendet` : 'Alle Zeilen sichtbar');
      return;
    }
    if (r.value === 'clear') { pushUndo(); delete af.filters[c]; changed({ full: true }); return; }
    if (r.value !== 'ok' || !r.data) return;
    pushUndo();
    if (r.data.length === vals.length) delete af.filters[c]; else af.filters[c] = r.data;
    changed({ full: true });
    const hiddenN = filterHidden(sh).size;
    toast(hiddenN ? `${hiddenN} Zeile${hiddenN === 1 ? '' : 'n'} ausgeblendet` : 'Alle Zeilen sichtbar');
  }

  // ---------------- Datenvalidierung (Dropdown) ----------------
  function dvList(src) {
    try {
      const m = /^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/.exec(src);
      const s2 = m ? wb.sheets.find(x => x.name.toLowerCase() === (m[1] || m[2]).replace(/''/g, "'").toLowerCase()) : sh;
      const rg = parseRangeAddr((m ? m[3] : src).replace(/\$/g, ''));
      if (!s2 || !rg) { const nm = findName(wb, src, si); return nm ? dvList(nm.ref) : []; }
      const out = [];
      for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) { const t = formatValue(valueAt(s2, r, c), (getCell(s2, r, c) || {}).s && getCell(s2, r, c).s.fmt); if (t !== '') out.push(t); }
      return out.slice(0, 500);
    } catch { return []; }
  }
  function placeDvButton() {
    const old = $('.dv-btn', root);
    const dv = validationAt(sh, sel.r, sel.c);
    if (!dv || editing || (dv.type && dv.type !== 'list')) { if (old) old.remove(); return; }
    const f = fr();
    const inFc = sel.c < fcN();
    const band = sel.r < f ? frozen : body;
    const layer = inFc ? $('.sh-fc', band) : $('.sh-cells', band);
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
    const list = dv.src ? dvList(dv.src) : dv.list;
    officeMenu(anchor, [
      ...list.map(v => ({ label: v, icon: 'check', onClick: () => { if (!guard()) return; applyInput(sel.r, sel.c, v); scroll.focus({ preventScroll: true }); } })),
      '-', { label: 'Leeren', icon: 'close', onClick: () => { if (!guard()) return; applyInput(sel.r, sel.c, ''); } },
    ], { label: 'Wert wählen' });
  }

  // ---------------- Suchen & Ersetzen ----------------
  const fbar = $('.s-find', root);
  const fq = $('[data-fq]', fbar), frIn = $('[data-fr]', fbar), fcount = $('[data-fcount]', fbar), fcase = $('[data-fcase]', fbar), fwhole = $('[data-fwhole]', fbar), fregex = $('[data-fregex]', fbar);
  /** Search pattern as RegExp (regex mode) or null when it is invalid; plain mode returns null. */
  function findRe(flags = '') {
    if (!fregex.checked || !fq.value) return null;
    try { return new RegExp(fq.value.slice(0, 500), (fcase.checked ? '' : 'i') + flags); } catch { return false; }
  }
  let findOpen = false, fmatches = [], fcur = -1;
  function openFind(focus) {
    findOpen = true; fbar.hidden = false;
    $('[data-a="find"]', root).setAttribute('aria-pressed', 'true');
    if (focus) setTimeout(() => { fq.focus(); fq.select(); }, 30);
    runFind(true);
  }
  function closeFind() { findOpen = false; fbar.hidden = true; fmatches = []; $('[data-a="find"]', root).setAttribute('aria-pressed', 'false'); scroll.focus({ preventScroll: true }); }
  const norm = t => (fcase.checked ? t : t.toLocaleLowerCase('de'));
  function matchText(t, q) {
    const re = findRe();
    if (re === false) return false;
    if (re) { const m = re.exec(t); return !!m && (!fwhole.checked || m[0] === t); }
    return fwhole.checked ? norm(t) === q : norm(t).includes(q);
  }
  function runFind(jump) {
    const q = norm(fq.value);
    fmatches = [];
    if (q) {
      const keys = [...sh.cells.keys()].sort((a, b) => a - b);
      for (const k of keys) {
        const cell = sh.cells.get(k);
        const t = displayOf(cell);
        if (matchText(t, q) || (cell.f && !fwhole.checked && !fregex.checked && norm('=' + toDisplay(cell.f)).includes(q))) fmatches.push({ r: R_OF(k), c: C_OF(k) });
      }
    }
    if (jump || fcur >= fmatches.length) fcur = fmatches.length ? 0 : -1;
    fcount.textContent = fq.value ? (findRe() === false ? 'Ungültiges Muster' : fmatches.length ? `${fcur + 1} von ${fmatches.length}` : 'Keine Treffer') : '';
    fcount.classList.toggle('notfound', !!fq.value && !fmatches.length);
    if (jump && fcur >= 0) select(fmatches[fcur].r, fmatches[fcur].c);
  }
  const fstep = d => { if (!fmatches.length) return; fcur = (fcur + d + fmatches.length) % fmatches.length; fcount.textContent = `${fcur + 1} von ${fmatches.length}`; select(fmatches[fcur].r, fmatches[fcur].c); };
  function replaceIn(r, c) {
    const cell = getCell(sh, r, c);
    if (!cell || cell.f) return false;
    if (lockedIn({ r1: r, r2: r, c1: c, c2: c })) return false;
    const txt = editTextOf(cell, toDisplay);
    let next;
    const rx = findRe('g');
    if (rx === false) return false;
    if (rx) {
      const plain = txt.replace(/^'/, '');
      rx.lastIndex = 0;
      if (fwhole.checked) { const m = new RegExp(`^(?:${rx.source})$`, rx.flags.replace('g', '')); if (!m.test(plain)) return false; next = plain.replace(m, frIn.value); }
      else { if (!rx.test(plain)) return false; rx.lastIndex = 0; next = plain.replace(rx, frIn.value); }
    } else if (fwhole.checked) { if (norm(txt.replace(/^'/, '')) !== norm(fq.value)) return false; next = frIn.value; }
    else {
      const re = new RegExp(fq.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), fcase.checked ? 'g' : 'gi');
      if (!re.test(txt)) return false;
      next = txt.replace(re, () => frIn.value);
    }
    const p = parseInput(next, cell.s && cell.s.fmt);
    const n = { ...cell };
    delete n.cv; delete n.cv0;
    if (p.f) { n.f = p.f; n.da = true; delete n.v; } else n.v = p.v;
    setCell(sh, r, c, n.v == null && !n.f && !n.s ? null : n);
    return true;
  }
  fq.addEventListener('input', () => runFind(true));
  [fcase, fwhole, fregex].forEach(x => x.addEventListener('change', () => runFind(true)));
  fq.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); fstep(e.shiftKey ? -1 : 1); } if (e.key === 'Escape') closeFind(); });
  $('[data-fnext]', fbar).addEventListener('click', () => fstep(1));
  $('[data-fprev]', fbar).addEventListener('click', () => fstep(-1));
  $('[data-fclose]', fbar).addEventListener('click', closeFind);
  $('[data-frep]', fbar).addEventListener('click', () => {
    if (fcur < 0 || !fmatches[fcur]) return;
    pushUndo();
    const m = fmatches[fcur];
    if (!replaceIn(m.r, m.c)) toast('Formeln werden beim Ersetzen nicht verändert.', 'info');
    changed({ cells: [m] }); runFind(false); if (fmatches.length) select(fmatches[Math.min(fcur, fmatches.length - 1)].r, fmatches[Math.min(fcur, fmatches.length - 1)].c);
  });
  $('[data-freall]', fbar).addEventListener('click', () => {
    if (!fmatches.length) return;
    pushUndo();
    let n = 0, skipped = 0;
    const cells = [];
    for (const m of fmatches) { if (replaceIn(m.r, m.c)) { n++; cells.push(m); } else skipped++; }
    changed({ cells }); runFind(true);
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
  function selectChart(cid) {
    chartSel = cid;
    $$('.sh-chart', chartsLayer).forEach(x => x.classList.toggle('sel', x.dataset.chart === cid));
  }
  function deleteChart(cid) {
    pushUndo();
    sh.charts = sh.charts.filter(x => x.id !== cid);
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
      const x = phone ? 8 : Math.max(0, colX[Math.min(Math.max(pr.c2, sh.maxC) + 1, nCols)] + 16);
      let y = phone ? (Math.max(pr.r2, sh.maxR) + 2) * ROW_H : pr.r1 * ROW_H;
      const hit = yy => sh.charts.some(o => o.x < x + w && x < o.x + o.w && o.y < yy + hh && yy < o.y + o.h);
      let guardN = 0;
      while (hit(y) && guardN++ < 50) y = Math.max(...sh.charts.filter(o => o.x < x + w && x < o.x + o.w && o.y < y + hh && y < o.y + o.h).map(o => o.y + o.h)) + 16;
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

  // ---------------- Pivot ----------------
  const colFmtCache = new Map();
  function keyLabel(v, srcSh, r, c) {
    if (v === null || v === undefined || v === '') return '(Leer)';
    if (typeof v === 'number') {
      let fmt = null;
      if (r != null) fmt = ((getCell(srcSh, r, c) || {}).s || {}).fmt;
      else {
        const ck = srcSh.name + '|' + c;
        if (!colFmtCache.has(ck)) { let f2 = null; for (let rr = 0; rr <= Math.min(srcSh.maxR, 50); rr++) { const x = getCell(srcSh, rr, c); if (x && typeof (x.f ? x.cv : x.v) === 'number') { f2 = (x.s || {}).fmt || null; break; } } colFmtCache.set(ck, f2); }
        fmt = colFmtCache.get(ck);
      }
      return formatValue(v, fmt && /^(date|time)$/.test(formatKind(fmt)) ? fmt : null);
    }
    return isErr(v) ? v.code : String(v);
  }
  function buildPivot(spec, target = null) {
    colFmtCache.clear();
    const res = D.pivotGrid(api, spec);
    if (!res) { toast('Die Quelldaten der Pivot-Tabelle wurden nicht gefunden.', 'error'); return; }
    pushUndo('wb');
    let tsh = target;
    if (!tsh) {
      let n = 1;
      while (wb.sheets.some(s => s.name.toLowerCase() === `pivot${n}`)) n++;
      tsh = newSheet(`Pivot${n}`);
      ensureSheetExtras(tsh); ensureSheetModel(tsh);
      wb.sheets.splice(si + 1, 0, tsh);
    }
    writePivot(tsh, res, spec);
    invalidateDeps(wb);
    switchSheet(wb.sheets.indexOf(tsh));
    changed({ full: true });
    toast(target ? 'Pivot-Tabelle aktualisiert' : 'Pivot-Tabelle erstellt – über „Daten → Pivot aktualisieren“ neu berechnen.', 'success');
  }
  function writePivot(tsh, res, spec) {
    tsh.cells = new Map(); tsh.merges = []; tsh.spill = new Map();
    const srcSh = wb.sheets.find(s => s.name === spec.src);
    const v0 = spec.def.vals[0];
    let numFmt = null;
    if (v0 && v0.c != null && v0.agg !== 'count' && srcSh) { const rg = parseRange(spec.range); for (let r = rg.r1 + 1; r <= Math.min(rg.r2, rg.r1 + 20); r++) { const x = getCell(srcSh, r, v0.c); if (x && x.s && x.s.fmt) { numFmt = x.s.fmt; break; } } }
    res.grid.forEach((row, r) => row.forEach((v, c) => {
      if (v === null || v === undefined || v === '') { if (r === 0) setCell(tsh, r, c, { v: null, s: { b: true, fill: '#E9E8FB', bd: { b: true } } }); return; }
      const cell = { v };
      const s = {};
      if (r === 0) Object.assign(s, { b: true, fill: '#E9E8FB', bd: { b: true } });
      if (res.totalRows.includes(r)) Object.assign(s, { b: true, bd: { t: true } });
      if (res.totalCols.includes(c) && r > 0) s.b = true;
      if (typeof v === 'number' && res.valueCols.includes(c) && numFmt && !/^(date|time)$/.test(formatKind(numFmt))) s.fmt = numFmt;
      if (typeof v === 'number' && c < res.rowFields && srcSh) { const lbl = keyLabel(v, srcSh, null, spec.def.rows[c] ?? 0); if (lbl !== String(v)) { cell.v = lbl; } }
      if (Object.keys(s).length) cell.s = s;
      setCell(tsh, r, c, cell);
    }));
    tsh.colW = res.grid[0].map((h0, i) => Math.min(260, Math.max(DEFAULT_COL_W, 14 + String(h0 || '').length * 8 + (i === 0 ? 30 : 0))));
    tsh.pivot = spec;
    tsh.freeze = 1;
    recomputeBounds(tsh);
  }
  function refreshPivot(tsh) {
    colFmtCache.clear();
    const res = D.pivotGrid(api, tsh.pivot);
    if (!res) return;
    pushUndo('wb');
    writePivot(tsh, res, tsh.pivot);
    invalidateDeps(wb);
    changed({ full: true });
  }

  // ---------------- sheet tabs ----------------
  function renderTabs() {
    tabs.innerHTML = '';
    wb.sheets.forEach((s, i) => {
      const t = h(`<button class="sh-tab" role="tab" type="button" aria-selected="${i === si}" ${s.tabColor ? `style="--tab-c:${s.tabColor}"` : ''}>${s.protect && s.protect.on ? oicon('protect', 'tab-ic') : ''}${s.pivot ? oicon('pivot', 'tab-ic') : ''}${esc(s.name)}</button>`);
      if (s.tabColor) t.classList.add('has-color');
      t.addEventListener('click', () => { if (i === si) tabMenu(t, i); else { if (editing) commit(); switchSheet(i); } });
      t.addEventListener('dblclick', e => { e.preventDefault(); renameSheet(i); });
      t.addEventListener('contextmenu', e => { e.preventDefault(); tabMenu(t, i); });
      t.draggable = true;
      t.addEventListener('dragstart', e => { e.dataTransfer.setData('text/x-fale-sheet', String(i)); e.dataTransfer.effectAllowed = 'move'; });
      t.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('text/x-fale-sheet')) { e.preventDefault(); t.classList.add('drop'); } });
      t.addEventListener('dragleave', () => t.classList.remove('drop'));
      t.addEventListener('drop', e => { e.preventDefault(); t.classList.remove('drop'); const from = +e.dataTransfer.getData('text/x-fale-sheet'); if (from !== i && Number.isFinite(from)) moveSheetTo(from, i); });
      tabs.appendChild(t);
    });
    const add = h(`<button class="sh-tab add" type="button" aria-label="Blatt hinzufügen">${oicon('plus')}</button>`);
    add.addEventListener('click', () => addSheet());
    tabs.appendChild(add);
  }
  function addSheet() {
    pushUndo('wb');
    let n = wb.sheets.length + 1;
    while (wb.sheets.some(s => s.name.toLowerCase() === `tabelle${n}`)) n++;
    const s = newSheet(`Tabelle${n}`);
    ensureSheetExtras(s); ensureSheetModel(s);
    wb.sheets.push(s);
    invalidateDeps(wb);
    shell.markDirty();
    switchSheet(wb.sheets.length - 1);
  }
  async function renameSheet(i) {
    const nn = await promptDialog('Blatt umbenennen', 'Name', wb.sheets[i].name, { okLabel: 'Übernehmen' });
    if (nn == null) return;
    const clean = nn.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31);
    if (!clean || wb.sheets.some((s, k) => k !== i && s.name.toLowerCase() === clean.toLowerCase())) { toast('Dieser Name ist ungültig oder schon vergeben.', 'error'); return; }
    pushUndo('wb');
    const old = wb.sheets[i].name;
    wb.sheets[i].name = clean;
    wb.sheets.forEach(s => { for (const [k, cell] of s.cells) if (cell.f && cell.f.includes('!')) { const f = renameSheetRefs(cell.f, old, clean); if (f !== cell.f) s.cells.set(k, { ...cell, f }); } });
    wb.names = (wb.names || []).map(n => ({ ...n, ref: renameSheetRefs(n.ref, old, clean) }));
    wb.sheets.forEach(s => { if (s.pivot && s.pivot.src === old) s.pivot = { ...s.pivot, src: clean }; (s.charts || []).forEach(ch => { if (ch.series) ch.series = ch.series.map(x => ({ ...x, cat: x.cat && renameSheetRefs(x.cat, old, clean), val: x.val && renameSheetRefs(x.val, old, clean), name: x.name && /!/.test(x.name) ? renameSheetRefs(x.name, old, clean) : x.name })); }); });
    invalidateDeps(wb);
    changed({ full: true }); renderTabs();
  }
  function tabMenu(anchor, i) {
    officeMenu(anchor, [
      { label: 'Umbenennen', icon: 'edit', onClick: () => renameSheet(i) },
      { label: 'Duplizieren', icon: 'duplicate', onClick: () => duplicateSheet(i) },
      { label: 'Registerfarbe …', icon: 'fill', onClick: () => tabColorMenu(anchor, i) },
      { label: wb.sheets[i].protect && wb.sheets[i].protect.on ? 'Blattschutz aufheben' : 'Blatt schützen', icon: 'protect', onClick: () => { if (i !== si) switchSheet(i); toggleProtect(); renderTabs(); } },
      { label: 'Nach links', icon: 'arrowLeft', disabled: i === 0, onClick: () => moveSheetTo(i, i - 1) },
      { label: 'Nach rechts', icon: 'arrowRight', disabled: i === wb.sheets.length - 1, onClick: () => moveSheetTo(i, i + 1) },
      { label: 'Blatt löschen', icon: 'trash', danger: true, disabled: wb.sheets.length < 2, onClick: async () => {
        if (!await confirmDialog('Blatt löschen?', `„${wb.sheets[i].name}“ und alle Inhalte werden entfernt.`, { okLabel: 'Löschen', danger: true })) return;
        pushUndo('wb');
        const gone = wb.sheets[i].name;
        wb.sheets.splice(i, 1);
        wb.names = (wb.names || []).filter(n => !(n.si === i) && !new RegExp(`^'?${gone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'?!`, 'i').test(n.ref)).map(n => ({ ...n, si: n.si != null && n.si > i ? n.si - 1 : n.si }));
        invalidateDeps(wb);
        changed({ full: true }); switchSheet(Math.max(0, i - 1));
        toast('Blatt gelöscht', 'info', { action: { label: 'Rückgängig', onClick: doUndo } });
      } },
    ], { label: 'Blatt' });
  }
  function tabColorMenu(anchor, i) {
    const cols = [['', 'Keine Farbe'], ['#3B37A0', 'Indigo'], ['#2F67D8', 'Blau'], ['#0B8F80', 'Petrol'], ['#15803D', 'Grün'], ['#D99A06', 'Gelb'], ['#E8613C', 'Orange'], ['#B91C1C', 'Rot'], ['#7E22CE', 'Violett'], ['#6B7194', 'Grau']];
    officeMenu(anchor, cols.map(([c, l]) => ({ label: l, icon: c ? 'fill' : 'close', onClick: () => { pushUndo('wb'); wb.sheets[i].tabColor = c || null; shell.markDirty(); renderTabs(); } })), { label: 'Registerfarbe' });
  }
  function duplicateSheet(i) {
    pushUndo('wb');
    const src = wb.sheets[i];
    let n = 2;
    const base = src.name.replace(/ \(\d+\)$/, '').slice(0, 26);
    while (wb.sheets.some(s => s.name.toLowerCase() === `${base} (${n})`.toLowerCase())) n++;
    const s = newSheet(`${base} (${n})`);
    s.cells = new Map([...src.cells].map(([k, c]) => [k, { ...c, s: c.s ? { ...c.s } : undefined }]));
    for (const c of s.cells.values()) { delete c.spill; if (!c.s) delete c.s; }
    s.colW = src.colW.slice(); s.rowH = new Map(src.rowH); s.merges = src.merges.map(m => ({ ...m })); s.freeze = src.freeze; s.freezeC = src.freezeC;
    s.hiddenRows = new Set(src.hiddenRows); s.hiddenColW = { ...src.hiddenColW }; s.tabColor = src.tabColor; s.noGrid = src.noGrid;
    s.cf = JSON.parse(JSON.stringify(src.cf || [])); s.dv = JSON.parse(JSON.stringify(src.dv || [])); s.autoFilter = src.autoFilter ? JSON.parse(JSON.stringify(src.autoFilter)) : null;
    s.charts = (src.charts || []).map(ch => ({ ...JSON.parse(JSON.stringify(ch)), id: newChartId() }));
    s.pivot = src.pivot ? JSON.parse(JSON.stringify(src.pivot)) : null;
    s.notes = new Map([...(src.notes || [])].map(([k, v]) => [k, { ...v }])); s.links = new Map([...(src.links || [])].map(([k, v]) => [k, { ...v }]));
    s.outline = new Map(src.outline || []); s.page = src.page ? JSON.parse(JSON.stringify(src.page)) : null;
    ensureSheetExtras(s); ensureSheetModel(s);
    recomputeBounds(s);
    wb.sheets.splice(i + 1, 0, s);
    invalidateDeps(wb);
    changed({ full: true }); switchSheet(i + 1);
    toast(`„${s.name}“ angelegt`, 'success');
  }
  function moveSheetTo(from, to) {
    pushUndo('wb');
    const idxOld = wb.sheets.map(s => s);
    const [s] = wb.sheets.splice(from, 1);
    wb.sheets.splice(to, 0, s);
    // sheet-local names follow their sheet
    wb.names = (wb.names || []).map(n => (n.si != null && n.si >= 0 ? { ...n, si: wb.sheets.indexOf(idxOld[n.si]) } : n));
    invalidateDeps(wb);
    shell.markDirty(); switchSheet(to); changed({ full: true });
  }
  function switchSheet(i, { keepSel = false } = {}) {
    if (editing) cancel();
    si = i; sh = wb.sheets[i];
    ensureSheetModel(sh);
    if (!keepSel) { sel.r = sel.c = sel.ar = sel.ac = 0; sel.more = []; sel.box = null; scroll.scrollTop = 0; scroll.scrollLeft = 0; }
    sel.box = null;
    selectChart(null);
    layout(); renderTabs(); updateBar(); schedule(); renderCharts();
    if (findOpen) runFind(true);
  }

  // ---------------- shortcuts help ----------------
  function shortcutsDialog() {
    const k = isMac ? '⌘' : 'Strg';
    const rows = [
      ['Bewegen', [['Pfeiltasten', 'Zelle wechseln'], [`${k}+Pfeil`, 'Zum Rand des Datenbereichs'], ['Umschalt+Pfeil', 'Markierung erweitern'], [`${k}+Umschalt+Pfeil`, 'Bis zum Datenrand markieren'], ['Tab / Umschalt+Tab', 'Nach rechts / links'], ['Eingabe', 'Nach unten (in Markierung bleiben)'], [`${k}+Pos1 / ${k}+Ende`, 'Anfang / letzte benutzte Zelle'], [`${k}+Bild↑ / Bild↓`, 'Vorheriges / nächstes Blatt']]],
      ['Markieren', [[`${k}+Leertaste`, 'Ganze Spalte'], ['Umschalt+Leertaste', 'Ganze Zeile'], [`${k}+A`, 'Datenbereich, dann alles'], [`${k}+Klick`, 'Mehrere Bereiche']]],
      ['Bearbeiten', [['F2', 'Zelle bearbeiten'], ['Alt+Eingabe', 'Zeilenumbruch in der Zelle'], [`${k}+Eingabe`, 'Eingabe in alle markierten Zellen'], ['F4', '$-Bezug umschalten (beim Bearbeiten)'], ['Entf', 'Inhalt löschen'], [`${k}+D / ${k}+R`, 'Nach unten / rechts ausfüllen'], [`${k}+; / ${k}+Umschalt+;`, 'Datum / Uhrzeit einfügen'], [`${k}+Z / ${k}+Y`, 'Rückgängig / Wiederholen']]],
      ['Zwischenablage', [[`${k}+C / X / V`, 'Kopieren / Ausschneiden / Einfügen'], [`${k}+Umschalt+V`, 'Inhalte einfügen …']]],
      ['Format', [[`${k}+B / I / U`, 'Fett / Kursiv / Unterstrichen'], [`${k}+5`, 'Durchgestrichen'], [`${k}+1`, 'Zellen formatieren …']]],
      ['Sonstiges', [[`${k}+F`, 'Suchen & ersetzen'], [`${k}+G / F5`, 'Gehe zu …'], [`${k}+K`, 'Link einfügen'], ['Umschalt+F2', 'Notiz bearbeiten'], [`${k}+P`, 'Als PDF exportieren'], [`${k}+S`, 'Speichern'], [`${k}++ / ${k}+-`, 'Zeilen/Spalten einfügen / löschen'], ['Alt+Umschalt+→ / ←', 'Zeilen gruppieren / Gruppierung aufheben'], ['Umschalt+F11', 'Neues Blatt'], ['F9', 'Neu berechnen']]],
      ['Formeln', [['Tab', 'Vorgeschlagene Funktion übernehmen'], ['F4', '$-Bezug umschalten'], ['Esc', 'Vorschläge schließen / Eingabe verwerfen']]],
    ];
    openDialog({ title: 'Tastenkürzel – Tabelle', wide: true, body: `<div class="keys-grid">${rows.map(([t, list]) => `<section><h3>${esc(t)}</h3><dl>${list.map(([a, b]) => `<dt><kbd>${esc(a)}</kbd></dt><dd>${esc(b)}</dd>`).join('')}</dl></section>`).join('')}</div>`, actions: [{ label: 'Schließen', value: 'ok', kind: 'btn-primary', default: true }] });
  }

  // ---------------- Notizen & Links ----------------
  const cellPop = h('<div class="cell-pop" hidden></div>');
  root.appendChild(cellPop);
  /** Link of a cell: a stored hyperlink or a HYPERLINK() formula. Returns {url|ref, label} or null. */
  function cellLink(r, c) {
    const l = linkAt(sh, r, c);
    if (l) return { ...l, label: l.ref ? `Gehe zu ${l.ref}` : String(l.url || '').replace(/^mailto:/i, '') };
    const cell = getCell(sh, r, c);
    if (cell && cell.f && /^HYPERLINK\(/.test(cell.f)) {
      try {
        const ast = compile(cell.f);
        const ctx = makeCtx(wb, { dirty: new Set() });
        ctx.sheet = si; ctx.cur = { r, c };
        const url = evaluate(ast.args[0], ctx);
        if (typeof url === 'string' && url) return /^#/.test(url) ? { ref: url.slice(1), label: `Gehe zu ${url.slice(1)}` } : { url, label: url.replace(/^mailto:/i, '') };
      } catch {}
    }
    return null;
  }
  function placeCellPop() {
    const note = !editing && noteAt(sh, sel.r, sel.c);
    const link = !editing && cellLink(sel.r, sel.c);
    const act = $('.sel-active', root);
    if ((!note && !link) || !act) { cellPop.hidden = true; cellPop._k = null; return; }
    const key = `${si}:${sel.r}:${sel.c}:${note ? note.text : ''}:${link ? link.label : ''}`;
    if (cellPop._k !== key) {
      cellPop._k = key;
      cellPop.innerHTML = `${note ? `<div class="cp-note"><span class="cp-h">Notiz</span>${esc(note.text)}</div>` : ''}${link ? `<button class="btn btn-ghost btn-sm cp-link" type="button" data-open-link title="Link öffnen">${oicon('link')}<span>${esc(link.label.length > 48 ? link.label.slice(0, 46) + '…' : link.label)}</span></button>` : ''}`;
    }
    const rc = act.getBoundingClientRect(), sc = scroll.getBoundingClientRect();
    if (rc.bottom < sc.top + HH || rc.top > sc.bottom || rc.right < sc.left + HW || rc.left > sc.right) { cellPop.hidden = true; return; }
    cellPop.hidden = false;
    const pw = cellPop.offsetWidth, ph = cellPop.offsetHeight;
    let x = rc.right + 6, y = rc.top;
    if (x + pw > Math.min(innerWidth, sc.right) - 4) { x = Math.max(sc.left + 4, Math.min(rc.left, innerWidth - pw - 8)); y = rc.bottom + 6; }
    if (y + ph > innerHeight - 8) y = Math.max(8, rc.top - ph - 6);
    cellPop.style.left = `${Math.round(x)}px`; cellPop.style.top = `${Math.round(y)}px`;
  }
  cellPop.addEventListener('click', e => { if (e.target.closest('[data-open-link]')) openLink(sel.r, sel.c); });
  async function openLink(r, c) {
    const l = cellLink(r, c);
    if (!l) return;
    if (l.ref) { gotoRef(l.ref); scroll.focus({ preventScroll: true }); return; }
    const url = safeUrl(l.url);
    if (!url) { toast('Dieser Link wird aus Sicherheitsgründen nicht geöffnet (nur Web-, E-Mail- und Telefon-Links).', 'error'); return; }
    await openExternal(url, { source: 'Die Tabelle enthält einen Link.' });
  }
  function setNote(text) {
    if (!guard([{ r1: sel.r, r2: sel.r, c1: sel.c, c2: sel.c }])) return;
    pushUndo();
    const k = KEY(sel.r, sel.c);
    if (text && text.trim()) sh.notes.set(k, { text: text.trim().slice(0, 4000) }); else sh.notes.delete(k);
    shell.markDirty(); cellPop._k = null; schedule(); updateBar();
    toast(text && text.trim() ? 'Notiz gespeichert' : 'Notiz gelöscht');
  }
  async function editNote() {
    if (editing && !commit()) return;
    const cur = noteAt(sh, sel.r, sel.c);
    const t = await D.noteDialog(addr(sel.r, sel.c), cur ? cur.text : '');
    if (t === null) return;
    setNote(t);
  }
  function setLink(l, text = null) {
    if (!guard([{ r1: sel.r, r2: sel.r, c1: sel.c, c2: sel.c }])) return;
    pushUndo();
    const k = KEY(sel.r, sel.c);
    if (l) sh.links.set(k, l); else sh.links.delete(k);
    const cell = getCell(sh, sel.r, sel.c);
    if (l && (text || (!cell || (cell.v == null && !cell.f)))) applyInput(sel.r, sel.c, text || (l.ref ? l.ref : String(l.url).replace(/^mailto:/i, '')), { record: false });
    shell.markDirty(); cellPop._k = null; changed({ recalc: false });
    toast(l ? 'Link gespeichert' : 'Link entfernt');
  }
  async function editLink() {
    if (editing && !commit()) return;
    const cur = linkAt(sh, sel.r, sel.c);
    const cell = getCell(sh, sel.r, sel.c);
    const r = await D.linkDialog({ target: cur ? (cur.ref ? cur.ref : cur.url) : '', text: cell && !cell.f && typeof cell.v === 'string' ? cell.v : '', sheets: wb.sheets.map(x => x.name) });
    if (!r) return;
    if (r.remove) { setLink(null); return; }
    const tgt = r.target.trim();
    let l;
    if (/^[^/:@\s]+![$A-Za-z]+\$?\d+/.test(tgt) || parseRangeAddr(tgt.replace(/\$/g, ''))) l = { ref: tgt.replace(/^#/, '') };
    else { const u = safeUrl(tgt); if (!u) { toast('Bitte gib eine Webadresse (https://…), eine E-Mail-Adresse oder eine Zelle wie Tabelle2!A1 an.', 'error', { timeout: 6000 }); return; } l = { url: u }; }
    setLink(l, r.text.trim() || null);
  }

  // ---------------- Seite einrichten / Druck ----------------
  async function pageSetup() {
    const p = await D.pageSetupDialog(api, pageOf(sh));
    if (!p) return;
    pushUndo();
    sh.page = p;
    shell.markDirty();
    toast('Seiteneinstellungen gespeichert – sie gelten für „Als PDF exportieren“ und die .xlsx-Datei.', 'success', { timeout: 5000 });
  }
  function setPrintTitles(r1, r2) {
    pushUndo();
    sh.page = { ...(sh.page || {}), titleRows: { r1, r2 } };
    shell.markDirty();
    toast(`Zeile${r1 === r2 ? ` ${r1 + 1}` : `n ${r1 + 1}–${r2 + 1}`} wird auf jeder PDF-Seite wiederholt`, 'success');
  }

  // ---------------- Gehe zu ----------------
  async function gotoDialog() {
    if (editing && !commit()) return;
    const r = await D.gotoDialog(wb, si);
    if (!r) return;
    if (r.ref) { gotoRef(r.ref); scroll.focus({ preventScroll: true }); return; }
    // special cells inside the selection (or the used range when only one cell is selected)
    const [r1, r2, c1, c2] = rangeBounds();
    const one = r1 === r2 && c1 === c2;
    const rg = one ? { r1: 0, c1: 0, r2: Math.max(0, sh.maxR), c2: Math.max(0, sh.maxC) } : { r1, r2: Math.min(r2, Math.max(r1, sh.maxR)), c1, c2: Math.min(c2, Math.max(c1, sh.maxC)) };
    const test = {
      blank: (cell, v) => v === null || v === undefined || v === '',
      formulas: cell => !!(cell && cell.f),
      constants: (cell, v) => !!(cell && !cell.f && v !== null && v !== undefined && v !== ''),
      errors: (cell, v) => isErr(v),
      notes: (cell, v, rr, cc) => !!noteAt(sh, rr, cc),
      cf: (cell, v, rr, cc) => sh.cf.some(x => { const g = parseRange(x.range); return g && rr >= g.r1 && rr <= g.r2 && cc >= g.c1 && cc <= g.c2; }),
      dv: (cell, v, rr, cc) => !!validationAt(sh, rr, cc),
    }[r.special];
    const hits = [];
    for (let rr = rg.r1; rr <= rg.r2 && hits.length < 5000; rr++) {
      if (rowHidden(rr)) continue;
      for (let cc = rg.c1; cc <= rg.c2; cc++) { const cell = getCell(sh, rr, cc); if (test(cell, valueAt(sh, rr, cc), rr, cc)) hits.push({ r: rr, c: cc }); }
    }
    if (!hits.length) { toast('Keine passenden Zellen gefunden.', 'info'); return; }
    // vertical runs per column → few ranges
    const ranges = [];
    hits.sort((a, b) => a.c - b.c || a.r - b.r);
    for (const x of hits) { const last = ranges[ranges.length - 1]; if (last && last.c1 === x.c && last.r2 === x.r - 1) last.r2 = x.r; else ranges.push({ r1: x.r, r2: x.r, c1: x.c, c2: x.c }); }
    const first = ranges.shift();
    sel.ar = first.r1; sel.ac = first.c1; sel.box = null;
    select(first.r2, first.c1, true);
    sel.more = ranges.slice(0, 2000);
    updateBar(); schedule();
    toast(`${hits.length} Zelle${hits.length === 1 ? '' : 'n'} markiert`, 'success');
  }

  // ---------------- Gliederung (Zeilen gruppieren) & Teilergebnisse ----------------
  function groupRows(r1, r2, delta) {
    if (!guard([], { structural: true })) return;
    if (r1 === 0 && r2 >= Math.max(sh.maxR, 0) && delta > 0 && r2 - r1 > 2000) { toast('Markiere die Zeilen, die gruppiert werden sollen.', 'info'); return; }
    pushUndo();
    let n = 0;
    for (let r = r1; r <= r2; r++) {
      const lv = (sh.outline.get(r) || 0) + delta;
      if (lv < 0 || lv > 7) continue;
      n++;
      if (lv) sh.outline.set(r, lv); else { sh.outline.delete(r); }
    }
    if (delta < 0) for (let r = r1; r <= r2; r++) if (!sh.outline.get(r)) sh.hiddenRows.delete(r);
    changed({ recalc: false });
    toast(delta > 0 ? `${n} Zeile${n === 1 ? '' : 'n'} gruppiert – mit − / + am Zeilenkopf ein- und ausblenden` : 'Gruppierung aufgehoben');
  }
  /** Rows of the group that ends right above summary row r (level ≥ lv). */
  function groupAbove(r) {
    const lv = sh.outline.get(r - 1);
    if (!lv) return null;
    let a = r - 1;
    while (a > 0 && (sh.outline.get(a - 1) || 0) >= lv) a--;
    return { r1: a, r2: r - 1, lv };
  }
  function toggleGroup(r) {
    const g = groupAbove(r);
    if (!g) return;
    pushUndo();
    let collapse = false;
    for (let x = g.r1; x <= g.r2; x++) if (!sh.hiddenRows.has(x)) { collapse = true; break; }
    for (let x = g.r1; x <= g.r2; x++) { if (collapse) sh.hiddenRows.add(x); else if ((sh.outline.get(x) || 0) >= g.lv) sh.hiddenRows.delete(x); }
    changed({ recalc: false });
  }
  async function subtotals() {
    const rg = dataRange();
    if (!rg || rg.r2 <= rg.r1) { toast('Markiere eine Tabelle mit Überschriften (mindestens zwei Zeilen).', 'info'); return; }
    const spec = await D.subtotalDialog(api, rg);
    if (!spec) return;
    if (!guard([], { structural: true })) return;
    pushUndo('wb');
    if (spec.sort) sortRowsMulti(wb, si, rg.r1 + 1, rg.r2, rg.c1, rg.c2, [{ c: spec.by, asc: true }]);
    const keyOf = r => displayOf(getCell(sh, r, spec.by));
    // group boundaries (bottom-up so inserted rows do not move the ones still to come)
    const groups = [];
    let start = rg.r1 + 1;
    for (let r = rg.r1 + 2; r <= rg.r2 + 1; r++) if (r > rg.r2 || keyOf(r) !== keyOf(start)) { groups.push({ r1: start, r2: r - 1, key: keyOf(start) }); start = r; }
    const fnCode = { sum: 9, count: 3, avg: 1, max: 4, min: 5 }[spec.fn] || 9;
    const label = { sum: 'Ergebnis', count: 'Anzahl', avg: 'Mittelwert', max: 'Maximum', min: 'Minimum' }[spec.fn] || 'Ergebnis';
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i];
      insertRows(wb, si, g.r2 + 1, 1);
      shiftSheetRanges(sh, 'r', g.r2 + 1, 1, false);
      const at = g.r2 + 1;
      setCell(sh, at, spec.by, { v: `${g.key} ${label}`, s: { b: true } });
      for (const c of spec.cols) setCell(sh, at, c, { f: `SUBTOTAL(${fnCode},${colName(c)}${g.r1 + 1}:${colName(c)}${g.r2 + 1})`, da: true, s: { b: true, ...((getCell(sh, g.r1, c) || {}).s && getCell(sh, g.r1, c).s.fmt ? { fmt: getCell(sh, g.r1, c).s.fmt } : {}) } });
      for (let r = g.r1; r <= g.r2; r++) sh.outline.set(r, Math.max(1, sh.outline.get(r) || 0));
    }
    // grand total
    const lastRow = rg.r2 + groups.length;
    const tot = lastRow + 1;
    insertRows(wb, si, tot, 1);
    shiftSheetRanges(sh, 'r', tot, 1, false);
    setCell(sh, tot, spec.by, { v: `Gesamt${label === 'Ergebnis' ? 'ergebnis' : ' – ' + label}`, s: { b: true, bd: { t: true } } });
    for (const c of spec.cols) setCell(sh, tot, c, { f: `SUBTOTAL(${fnCode},${colName(c)}${rg.r1 + 2}:${colName(c)}${lastRow + 1})`, da: true, s: { b: true, bd: { t: true }, ...((getCell(sh, rg.r1 + 1, c) || {}).s && getCell(sh, rg.r1 + 1, c).s.fmt ? { fmt: getCell(sh, rg.r1 + 1, c).s.fmt } : {}) } });
    invalidateDeps(wb);
    changed({ full: true });
    toast(`${groups.length} Teilergebnis${groups.length === 1 ? '' : 'se'} eingefügt – Gruppen lassen sich am Zeilenkopf mit − zuklappen`, 'success', { timeout: 5000 });
  }
  scroll.addEventListener('click', e => { const b = e.target.closest('[data-olt]'); if (b) { e.preventDefault(); toggleGroup(+b.dataset.olt); } });

  // ---------------- api for dialogs ----------------
  const api = {
    get wb() { return wb; }, get sh() { return sh; }, get si() { return si; }, sel,
    bounds: () => rangeBounds(), ranges: () => allRanges(), mergeAt, forRange, pushUndo, changed, guard, toggleMerge, applyInput, dataRange, hasHeader, sortRange,
    validationAt: (r, c) => validationAt(sh, r, c), keyLabel, buildPivot,
  };

  // ---------------- init ----------------
  if (sh.start) { const p0 = parseAddr(sh.start); if (p0) { sel.r = sel.ar = p0.r; sel.c = sel.ac = p0.c; } }
  wb.sheets.forEach(x => { delete x.start; });
  layout(); renderTabs(); updateBar(); render(); renderCharts();
  setTimeout(() => scroll.focus({ preventScroll: true }), 60);
  screen.onDropFiles = () => toast('Öffne Tabellen über „Dateien“.', 'info');

  // test/automation hook
  root._sheetApi = {
    wb: () => wb, sheet: () => sh, select: (a) => { const p = parseRangeAddr(a); if (p) { sel.ar = p.r1; sel.ac = p.c1; select(p.r2, p.c2, true); } },
    input: (a, text) => { const p = parseAddr(a); applyInput(p.r, p.c, text); }, hiddenRows: () => [...hidden], charts: () => sh.charts,
    value: a => { const p = parseAddr(a); return valueAt(sh, p.r, p.c); }, text: a => { const p = parseAddr(a); const cell = getCell(sh, p.r, p.c); const sp = !cell && sh.spill.get(KEY(p.r, p.c)); return sp ? formatValue(sp.v, null) : displayOf(cell); },
    fill: (dir, n) => { const [r1, r2, c1, c2] = rangeBounds(); doFill(dir, n, { r1, r2, c1, c2 }); }, action: a => doAction(a), paste: (text, html) => pasteData(text, html || ''),
    copy: () => buildClip(false), pasteInternal: opts => pasteInternal(opts || {}), switchSheet: i => switchSheet(i), undo: () => doUndo(), redo: () => doRedo(),
    pivot: spec => buildPivot(spec), recalcAll: () => changed({ full: true }), freeze: (r, c) => setFreeze(r, c), sortRange: (a, keys) => { const p = parseRangeAddr(a); sortRange(p, keys); },
    note: (a, text) => { const p = parseAddr(a); sel.r = sel.ar = p.r; sel.c = sel.ac = p.c; setNote(text); }, link: (a, l, text) => { const p = parseAddr(a); sel.r = sel.ar = p.r; sel.c = sel.ac = p.c; setLink(l, text); },
    cellLink: a => { const p = parseAddr(a); return cellLink(p.r, p.c); }, group: (r1, r2, d) => groupRows(r1, r2, d), toggleGroup: r => toggleGroup(r), page: p => { sh.page = { ...(sh.page || {}), ...p }; shell.markDirty(); },
    addCf: rule => { pushUndo(); sh.cf.push({ id: newChartId(), ...rule }); changed({ recalc: false }); }, sel: () => ({ ...mainRange(), more: sel.more.length }),
  };

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
  return (id && buildSheetTemplate(id)) || newWorkbook();
}
