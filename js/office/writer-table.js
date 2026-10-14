// Tabellenwerkzeuge der Textverarbeitung: Zeilen/Spalten, Zellen verbinden/teilen, Spaltenbreite ziehen,
// Schattierung, Rahmen, Tabellenformatvorlagen, Überschriftenzeile, Eigenschaften, Zellmarkierung.
import { $, $$, esc, openDialog } from '../ui.js';

export const TABLE_STYLES = [['grid', 'Gitternetz'], ['plain', 'Schlicht'], ['header', 'Kopfzeile farbig'], ['striped', 'Gebändert'], ['minimal', 'Minimal']];
export const SHADES = ['#FFFFFF', '#F3F4F8', '#E9E8FB', '#DCEBFF', '#DFF5EA', '#FFF4CC', '#FDE2E1', '#D5D8E6', '#3B37A0', '#1B1E33'];
const LINE = '0.75pt solid #1A1A1A';

/** Grid of a table: grid[r][c] = cell (cells with spans appear in several slots). */
export function tableGrid(table) {
  const grid = [];
  Array.from(table.rows).forEach((tr, r) => {
    grid[r] = grid[r] || [];
    let c = 0;
    for (const td of Array.from(tr.cells)) {
      while (grid[r][c]) c++;
      const cs = Math.max(1, +td.colSpan || 1), rs = Math.max(1, +td.rowSpan || 1);
      for (let i = 0; i < rs; i++) { grid[r + i] = grid[r + i] || []; for (let j = 0; j < cs; j++) grid[r + i][c + j] = td; }
      c += cs;
    }
  });
  return grid;
}
export function cellPos(grid, td) {
  for (let r = 0; r < grid.length; r++) for (let c = 0; c < (grid[r] || []).length; c++) if (grid[r][c] === td) return { r, c };
  return null;
}
function rectOf(grid, cells) {
  let r1 = 1e9, c1 = 1e9, r2 = -1, c2 = -1;
  for (let r = 0; r < grid.length; r++) for (let c = 0; c < (grid[r] || []).length; c++) if (cells.includes(grid[r][c])) { r1 = Math.min(r1, r); c1 = Math.min(c1, c); r2 = Math.max(r2, r); c2 = Math.max(c2, c); }
  return r2 < 0 ? null : { r1, c1, r2, c2 };
}
const newCell = (tag = 'td') => { const c = document.createElement(tag); c.innerHTML = '<p><br></p>'; return c; };
const isEmptyCell = td => !td.textContent.trim() && !td.querySelector('img,table');

export function createTableTools(ed, ctx) {
  let selCells = [];

  function current() {
    const s = getSelection();
    const n = s.rangeCount ? s.anchorNode : null;
    const el = n && (n.nodeType === 1 ? n : n.parentElement);
    const td = el && el.closest('td,th');
    return td && ed.contains(td) ? td : null;
  }
  function cells() {
    if (selCells.length && selCells.every(c => c.isConnected)) return selCells;
    const td = current();
    return td ? [td] : [];
  }
  function clearSel() { selCells.forEach(c => c.classList.remove('cell-sel')); selCells = []; }
  /** Update the visual cell selection from the DOM selection (anchor and focus in different cells). */
  function syncSelection() {
    const s = getSelection();
    clearSel();
    if (!s.rangeCount || s.isCollapsed) return;
    const a = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement);
    const f = s.focusNode && (s.focusNode.nodeType === 1 ? s.focusNode : s.focusNode.parentElement);
    const ta = a && a.closest('td,th'), tf = f && f.closest('td,th');
    if (!ta || !tf || ta === tf || !ed.contains(ta)) return;
    const table = ta.closest('table');
    if (tf.closest('table') !== table) return;
    const grid = tableGrid(table);
    const pa = cellPos(grid, ta), pf = cellPos(grid, tf);
    if (!pa || !pf) return;
    const r1 = Math.min(pa.r, pf.r), r2 = Math.max(pa.r, pf.r), c1 = Math.min(pa.c, pf.c), c2 = Math.max(pa.c, pf.c);
    const set = new Set();
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (grid[r] && grid[r][c]) set.add(grid[r][c]);
    selCells = Array.from(set);
    selCells.forEach(c => c.classList.add('cell-sel'));
  }

  const op = fn => { ctx.capture(); const r = fn(); ctx.changed(); return r; };

  function insertRow(td, below) {
    const table = td.closest('table'), grid = tableGrid(table);
    const p = cellPos(grid, td);
    const rIdx = below ? p.r + (td.rowSpan || 1) - 1 : p.r;
    const tr = table.rows[rIdx];
    const nr = document.createElement('tr');
    const width = Math.max(...grid.map(g => g.length));
    const seen = new Set();
    for (let c = 0; c < width; c++) {
      const cell = grid[rIdx][c];
      if (!cell) { nr.appendChild(newCell()); continue; }
      const cp = cellPos(grid, cell);
      const spansAcross = below ? cp.r + (cell.rowSpan || 1) - 1 > rIdx : cp.r < rIdx;
      if (spansAcross) { if (!seen.has(cell)) { cell.rowSpan = (cell.rowSpan || 1) + 1; seen.add(cell); } continue; }
      if (seen.has(cell)) continue;
      seen.add(cell);
      const n = newCell(cell.tagName.toLowerCase());
      if (cell.colSpan > 1) n.colSpan = cell.colSpan;
      if (cell.style.backgroundColor && tr.hasAttribute('data-hdr')) n.style.backgroundColor = cell.style.backgroundColor;
      nr.appendChild(n);
    }
    if (below) tr.after(nr); else tr.before(nr);
    return nr;
  }
  function insertCol(td, right) {
    const table = td.closest('table'), grid = tableGrid(table);
    const p = cellPos(grid, td);
    const cIdx = right ? p.c + (td.colSpan || 1) - 1 : p.c;
    const seen = new Set();
    Array.from(table.rows).forEach((tr, r) => {
      const cell = grid[r] && grid[r][cIdx];
      if (!cell) { tr.appendChild(newCell()); return; }
      if (seen.has(cell)) return;
      seen.add(cell);
      const cp = cellPos(grid, cell);
      const inside = right ? cp.c + (cell.colSpan || 1) - 1 > cIdx : cp.c < cIdx;
      if (inside) { cell.colSpan = (cell.colSpan || 1) + 1; return; }
      if (cp.r !== r) return;
      const n = newCell(cell.tagName.toLowerCase());
      if (cell.rowSpan > 1) n.rowSpan = cell.rowSpan;
      if (right) cell.after(n); else cell.before(n);
    });
    resetCols(table);
  }
  function deleteRows(list) {
    const table = list[0].closest('table'), grid = tableGrid(table);
    const rows = new Set();
    list.forEach(td => { const p = cellPos(grid, td); for (let i = 0; i < (td.rowSpan || 1); i++) rows.add(p.r + i); });
    if (rows.size >= table.rows.length) { removeTable(table); return; }
    Array.from(rows).sort((a, b) => b - a).forEach(r => {
      const tr = table.rows[r];
      const g = tableGrid(table);
      const seen = new Set();
      (g[r] || []).forEach(cell => {
        if (!cell || seen.has(cell)) return;
        seen.add(cell);
        const cp = cellPos(g, cell);
        if ((cell.rowSpan || 1) > 1) {
          if (cp.r === r) {
            // move a spanning cell down one row
            const next = table.rows[r + 1];
            if (next) {
              const g2 = g[r + 1];
              let ref = null;
              for (let c = cp.c + (cell.colSpan || 1); c < g2.length; c++) { if (g2[c] && g2[c].parentElement === next) { ref = g2[c]; break; } }
              cell.rowSpan -= 1;
              if (ref) ref.before(cell); else next.appendChild(cell);
            }
          } else cell.rowSpan -= 1;
        }
      });
      tr.remove();
    });
  }
  function deleteCols(list) {
    const table = list[0].closest('table'), grid = tableGrid(table);
    const cols = new Set();
    list.forEach(td => { const p = cellPos(grid, td); for (let i = 0; i < (td.colSpan || 1); i++) cols.add(p.c + i); });
    const width = Math.max(...grid.map(g => g.length));
    if (cols.size >= width) { removeTable(table); return; }
    const touched = new Set();
    grid.forEach(row => cols.forEach(c => { const cell = row[c]; if (cell) touched.add(cell); }));
    touched.forEach(cell => {
      const p = cellPos(grid, cell);
      let n = 0;
      for (let i = 0; i < (cell.colSpan || 1); i++) if (cols.has(p.c + i)) n++;
      if (n >= (cell.colSpan || 1)) cell.remove(); else cell.colSpan -= n;
    });
    resetCols(table);
  }
  function removeTable(table) {
    const p = document.createElement('p'); p.innerHTML = '<br>';
    table.replaceWith(p);
    const r = document.createRange(); r.setStart(p, 0); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }
  function resetCols(table) { const cg = table.querySelector('colgroup'); if (cg) cg.remove(); }

  function merge() {
    const list = cells();
    if (list.length < 2) return false;
    const table = list[0].closest('table'), grid = tableGrid(table);
    const rc = rectOf(grid, list);
    // the rectangle must not cut through other spans
    for (let r = rc.r1; r <= rc.r2; r++) for (let c = rc.c1; c <= rc.c2; c++) { const cell = grid[r][c]; const p = cellPos(grid, cell); if (p.r < rc.r1 || p.c < rc.c1 || p.r + (cell.rowSpan || 1) - 1 > rc.r2 || p.c + (cell.colSpan || 1) - 1 > rc.c2) return false; }
    const first = grid[rc.r1][rc.c1];
    const seen = new Set([first]);
    for (let r = rc.r1; r <= rc.r2; r++) for (let c = rc.c1; c <= rc.c2; c++) {
      const cell = grid[r][c];
      if (seen.has(cell)) continue;
      seen.add(cell);
      if (!isEmptyCell(cell)) { if (isEmptyCell(first)) first.innerHTML = ''; while (cell.firstChild) first.appendChild(cell.firstChild); }
      cell.remove();
    }
    first.colSpan = rc.c2 - rc.c1 + 1;
    first.rowSpan = rc.r2 - rc.r1 + 1;
    if (first.colSpan === 1) first.removeAttribute('colspan');
    if (first.rowSpan === 1) first.removeAttribute('rowspan');
    clearSel();
    return true;
  }
  function split(td, cols = 2, rows = 1) {
    const table = td.closest('table');
    if ((td.colSpan || 1) > 1 || (td.rowSpan || 1) > 1) {
      // undo a merge: restore single cells
      const grid = tableGrid(table), p = cellPos(grid, td);
      const cs = td.colSpan || 1, rs = td.rowSpan || 1;
      td.removeAttribute('colspan'); td.removeAttribute('rowspan');
      for (let j = 1; j < cs; j++) td.after(newCell(td.tagName.toLowerCase()));
      for (let i = 1; i < rs; i++) {
        const tr = table.rows[p.r + i];
        const g = grid[p.r + i];
        let ref = null;
        for (let c = p.c + cs; c < g.length; c++) if (g[c] && g[c] !== td && g[c].parentElement === tr) { ref = g[c]; break; }
        for (let j = 0; j < cs; j++) { const n = newCell(td.tagName.toLowerCase()); if (ref) ref.before(n); else tr.appendChild(n); }
      }
      return true;
    }
    const grid = tableGrid(table), p = cellPos(grid, td);
    if (cols > 1) {
      const seen = new Set([td]);
      grid.forEach(row => { const cell = row[p.c]; if (cell && !seen.has(cell)) { seen.add(cell); cell.colSpan = (cell.colSpan || 1) + cols - 1; } });
      for (let j = 1; j < cols; j++) td.after(newCell(td.tagName.toLowerCase()));
      resetCols(table);
    }
    if (rows > 1) {
      const tr = td.parentElement;
      const g = tableGrid(table);
      const mine = new Set();
      for (let j = 0; j < cols; j++) mine.add(g[p.r][p.c + j]);
      const seen = new Set();
      for (const cell of g[p.r]) { if (!cell || seen.has(cell) || mine.has(cell)) continue; seen.add(cell); cell.rowSpan = (cell.rowSpan || 1) + rows - 1; }
      let last = tr;
      for (let i = 1; i < rows; i++) {
        const nr = document.createElement('tr');
        for (let j = 0; j < cols; j++) nr.appendChild(newCell(td.tagName.toLowerCase()));
        last.after(nr); last = nr;
      }
    }
    return true;
  }

  function setShade(color) {
    cells().forEach(td => { if (!color || color === '#FFFFFF') td.style.removeProperty('background-color'); else td.style.backgroundColor = color; if (!td.getAttribute('style')) td.removeAttribute('style'); });
  }
  function setBorders(preset) {
    const list = cells();
    if (!list.length) return;
    const table = list[0].closest('table');
    const all = list.length > 1 ? list : (preset === 'none-table' || preset === 'all-table' ? Array.from(table.querySelectorAll(':scope > tbody > tr > td, :scope > tbody > tr > th, :scope > thead > tr > *, :scope > tr > *')) : list);
    const grid = tableGrid(table);
    const rc = rectOf(grid, all);
    const set = (td, side, v) => { td.style.setProperty(`border-${side}`, v); };
    for (const td of all) {
      const p = cellPos(grid, td);
      const top = p.r === rc.r1, left = p.c === rc.c1, bottom = p.r + (td.rowSpan || 1) - 1 === rc.r2, right = p.c + (td.colSpan || 1) - 1 === rc.c2;
      switch (preset) {
        case 'all': case 'all-table': ['top', 'right', 'bottom', 'left'].forEach(s => set(td, s, LINE)); break;
        case 'none': case 'none-table': ['top', 'right', 'bottom', 'left'].forEach(s => set(td, s, 'none')); break;
        case 'outer': set(td, 'top', top ? LINE : 'none'); set(td, 'bottom', bottom ? LINE : 'none'); set(td, 'left', left ? LINE : 'none'); set(td, 'right', right ? LINE : 'none'); break;
        case 'inner': set(td, 'top', top ? 'none' : LINE); set(td, 'bottom', bottom ? 'none' : LINE); set(td, 'left', left ? 'none' : LINE); set(td, 'right', right ? 'none' : LINE); break;
        case 'top': if (top) set(td, 'top', LINE); break;
        case 'bottom': if (bottom) set(td, 'bottom', LINE); break;
        case 'left': if (left) set(td, 'left', LINE); break;
        case 'right': if (right) set(td, 'right', LINE); break;
        case 'thick-bottom': if (bottom) set(td, 'bottom', '2.25pt solid #1A1A1A'); break;
        case 'double-bottom': if (bottom) set(td, 'bottom', '2.25pt double #1A1A1A'); break;
        default: break;
      }
    }
    if (preset === 'none-table') table.classList.add('borderless');
    else table.classList.remove('borderless');
  }
  function setStyle(table, st) {
    Array.from(table.classList).filter(c => /^ts-/.test(c)).forEach(c => table.classList.remove(c));
    if (st) table.classList.add(`ts-${st}`);
    if ((st === 'header' || st === 'striped' || st === 'minimal') && table.rows[0]) table.rows[0].setAttribute('data-hdr', '');
  }
  function toggleHeader(table) {
    const tr = table.rows[0];
    if (!tr) return false;
    const on = !tr.hasAttribute('data-hdr');
    tr.toggleAttribute('data-hdr', on);
    return on;
  }
  function distribute(table) {
    const grid = tableGrid(table);
    const n = Math.max(...grid.map(g => g.length));
    setWidths(table, new Array(n).fill(100 / n));
  }
  function setWidths(table, pcts) {
    let cg = table.querySelector(':scope > colgroup');
    if (!cg) { cg = document.createElement('colgroup'); table.prepend(cg); }
    cg.innerHTML = pcts.map(p => `<col style="width:${Math.round(p * 100) / 100}%">`).join('');
  }
  function colWidthsPx(table) {
    const grid = tableGrid(table);
    const n = Math.max(...grid.map(g => g.length));
    const tw = table.getBoundingClientRect().width || 1;
    const cols = $$(':scope > colgroup > col', table);
    if (cols.length === n) {
      const ws = cols.map(c => parseFloat(c.style.width) || 0);
      const sum = ws.reduce((a, b) => a + b, 0);
      if (sum > 0) return ws.map(w => w / sum * tw);
    }
    // derive from a row of single cells
    const out = new Array(n).fill(tw / n);
    for (const row of grid) {
      if (row.every((c, i) => c && (c.colSpan || 1) === 1 && row.indexOf(c) === i)) { row.forEach((c, i) => { out[i] = c.getBoundingClientRect().width; }); break; }
    }
    return out;
  }

  // ---- column resize by dragging a cell border ----
  let drag = null;
  const scale = () => { const r = ed.getBoundingClientRect(); return ed.offsetWidth ? r.width / ed.offsetWidth : 1; };
  function edgeAt(e) {
    const td = e.target.closest && e.target.closest('td,th');
    if (!td || !ed.contains(td)) return null;
    const r = td.getBoundingClientRect();
    const table = td.closest('table');
    const grid = tableGrid(table), p = cellPos(grid, td);
    if (!p) return null;
    if (Math.abs(e.clientX - r.right) <= 5) return { table, col: p.c + (td.colSpan || 1) - 1 };
    if (Math.abs(e.clientX - r.left) <= 5 && p.c > 0) return { table, col: p.c - 1 };
    return null;
  }
  ed.addEventListener('pointermove', e => {
    if (drag) return;
    const edge = e.pointerType === 'mouse' ? edgeAt(e) : null;
    ed.classList.toggle('col-resize', !!edge);
  });
  ed.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.pointerType !== 'mouse') return;
    const edge = edgeAt(e);
    if (!edge) return;
    const ws = colWidthsPx(edge.table);
    if (edge.col >= ws.length - 1) {
      // last column: resize the whole table width
      drag = { ...edge, ws, x: e.clientX, last: true, tw: edge.table.getBoundingClientRect().width, pw: edge.table.parentElement.getBoundingClientRect().width };
    } else drag = { ...edge, ws, x: e.clientX };
    e.preventDefault();
    ctx.capture();
    ed.setPointerCapture && ed.setPointerCapture(e.pointerId);
  });
  ed.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = (e.clientX - drag.x) / scale();
    const ws = drag.ws.slice();
    if (drag.last) {
      const tw = Math.max(80, Math.min(drag.pw, drag.tw + dx));
      ws[ws.length - 1] = Math.max(24, drag.ws[ws.length - 1] + (tw - drag.tw));
      drag.table.style.width = `${Math.round(tw / drag.pw * 1000) / 10}%`;
      if (parseFloat(drag.table.style.width) >= 99.9) drag.table.style.removeProperty('width');
    } else {
      const a = drag.col, b = a + 1;
      const tot = ws[a] + ws[b];
      ws[a] = Math.max(24, Math.min(tot - 24, drag.ws[a] + dx));
      ws[b] = tot - ws[a];
    }
    const sum = ws.reduce((x, y) => x + y, 0);
    setWidths(drag.table, ws.map(w => w / sum * 100));
  });
  const endDrag = () => { if (drag) { drag = null; ctx.changed(); } };
  ed.addEventListener('pointerup', endDrag);
  ed.addEventListener('pointercancel', endDrag);

  async function insertDialog() {
    const r = await openDialog({
      title: 'Tabelle einfügen',
      body: `<div class="field-row"><label class="field"><span class="field-label">Zeilen</span><input class="input" type="number" min="1" max="200" value="3" name="rows"></label>
        <label class="field"><span class="field-label">Spalten</span><input class="input" type="number" min="1" max="20" value="3" name="cols"></label></div>
        <label class="field"><span class="field-label">Tabellenformatvorlage</span><select class="select" name="style">${TABLE_STYLES.map(([k, l]) => `<option value="${k}" ${k === 'grid' ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" name="head" checked> Erste Zeile als Überschriftenzeile (wird auf jeder Seite wiederholt)</label>`,
      actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Einfügen', value: 'ok', kind: 'btn-primary', default: true }],
      onMount: dlg => ({ collect: () => ({ rows: +$('[name=rows]', dlg).value, cols: +$('[name=cols]', dlg).value, head: $('[name=head]', dlg).checked, style: $('[name=style]', dlg).value }) }),
    });
    if (r.value !== 'ok') return null;
    const rows = Math.max(1, Math.min(200, r.data.rows || 3)), cols = Math.max(1, Math.min(20, r.data.cols || 3));
    let t = `<table${r.data.style && r.data.style !== 'grid' ? ` class="ts-${r.data.style}"` : ''}><tbody>`;
    for (let i = 0; i < rows; i++) {
      const head = i === 0 && r.data.head;
      t += `<tr${head ? ' data-hdr' : ''}>` + Array.from({ length: cols }, () => (head && (!r.data.style || r.data.style === 'grid') ? '<td style="background-color:#E9E8FB"><p><strong><br></strong></p></td>' : '<td><p><br></p></td>')).join('') + '</tr>';
    }
    return t + '</tbody></table><p><br></p>';
  }

  async function propsDialog(table) {
    const td = current();
    const w = table.style.width ? parseFloat(table.style.width) : 100;
    const al = table.getAttribute('data-align') || 'left';
    const va = td ? (td.style.verticalAlign || 'top') : 'top';
    const r = await openDialog({
      title: 'Tabelleneigenschaften',
      body: `<div class="field-row"><label class="field"><span class="field-label">Breite (% der Seite)</span><input class="input" name="w" type="number" min="10" max="100" value="${Math.round(w)}"></label>
        <label class="field"><span class="field-label">Ausrichtung</span><select class="select" name="al">${[['left', 'Links'], ['center', 'Zentriert'], ['right', 'Rechts']].map(([k, l]) => `<option value="${k}" ${al === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
        <label class="field"><span class="field-label">Vertikale Ausrichtung der Zelle(n)</span><select class="select" name="va">${[['top', 'Oben'], ['middle', 'Mitte'], ['bottom', 'Unten']].map(([k, l]) => `<option value="${k}" ${va === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="check"><input type="checkbox" name="hdr" ${table.rows[0] && table.rows[0].hasAttribute('data-hdr') ? 'checked' : ''}> Erste Zeile auf jeder Seite wiederholen</label>`,
      actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Übernehmen', value: 'ok', kind: 'btn-primary', default: true }],
      onMount: dlg => ({ collect: () => ({ w: +$('[name=w]', dlg).value, al: $('[name=al]', dlg).value, va: $('[name=va]', dlg).value, hdr: $('[name=hdr]', dlg).checked }) }),
    });
    if (r.value !== 'ok' || !r.data) return false;
    const d = r.data;
    const pw = Math.max(10, Math.min(100, d.w || 100));
    if (pw >= 100) table.style.removeProperty('width'); else table.style.width = `${pw}%`;
    if (d.al === 'left') table.removeAttribute('data-align'); else table.setAttribute('data-align', d.al);
    cells().forEach(c => { if (d.va === 'top') c.style.removeProperty('vertical-align'); else c.style.verticalAlign = d.va; if (!c.getAttribute('style')) c.removeAttribute('style'); });
    if (table.rows[0]) table.rows[0].toggleAttribute('data-hdr', d.hdr);
    if (!table.getAttribute('style')) table.removeAttribute('style');
    return true;
  }

  /** Tab / Shift+Tab inside a table: next/previous cell, new row at the end. */
  function tabKey(e) {
    const td = current();
    if (!td) return false;
    const table = td.closest('table');
    const all = $$('td,th', table).filter(c => c.closest('table') === table);
    let i = all.indexOf(td) + (e.shiftKey ? -1 : 1);
    if (i >= all.length) { ctx.capture(); insertRow(all[all.length - 1], true); ctx.changed(); const all2 = $$('td,th', table).filter(c => c.closest('table') === table); i = all.length; placeIn(all2[i]); return true; }
    if (i < 0) return true;
    placeIn(all[i]);
    return true;
  }
  function placeIn(cell) {
    if (!cell) return;
    const r = document.createRange();
    r.selectNodeContents(cell.querySelector('p') || cell);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  }

  return {
    current, cells, syncSelection, clearSel, insertDialog, propsDialog, tabKey, op,
    insertRow: (b) => { const td = current(); if (td) op(() => insertRow(td, b)); },
    insertCol: (b) => { const td = current(); if (td) op(() => insertCol(td, b)); },
    deleteRows: () => { const l = cells(); if (l.length) op(() => deleteRows(l)); },
    deleteCols: () => { const l = cells(); if (l.length) op(() => deleteCols(l)); },
    deleteTable: () => { const td = current(); if (td) op(() => removeTable(td.closest('table'))); },
    merge: () => op(() => merge()),
    split: (c, r) => { const td = current(); if (td) op(() => split(td, c, r)); },
    shade: c => op(() => setShade(c)),
    borders: p => op(() => setBorders(p)),
    style: st => { const td = current(); if (td) op(() => setStyle(td.closest('table'), st)); },
    header: () => { const td = current(); return td ? op(() => toggleHeader(td.closest('table'))) : null; },
    distribute: () => { const td = current(); if (td) op(() => distribute(td.closest('table'))); },
    _merge: merge, _split: split, _insertRow: insertRow, _insertCol: insertCol, _deleteRows: deleteRows, _deleteCols: deleteCols,
  };
}
