// Spreadsheet template pages of the Vorlagen-Archiv (/vorlagen/tabellen/<slug>/, /en/templates/spreadsheets/<slug>/):
// builds the template from js/office/sheet-templates.js (synced to lib/shared/office/) in the browser, shows it as a
// live grid with the app's number formats and colour rules, lets you edit any non-formula cell (formulas recalculate
// at once, drop-down lists become a select), shows each formula in German syntax, and downloads the workbook as
// Excel (XLSX, real formulas) or the current sheet as CSV. Everything stays on the device.
import { el } from './lib/dom.js';

const L = {
  de: { more: 'Weitere Zeilen anzeigen', cell: 'Zelle', apply: 'Übernehmen', formula: 'Formel', reset: 'Beispielwerte wiederherstellen', changed: 'Geändert – XLSX und CSV enthalten deine Eingaben.',
    pick: 'Tippe auf eine Zelle, um sie zu ändern. Gelbe Felder sind Eingaben.', readonly: 'Diese Zelle rechnet automatisch:', sheets: 'Tabellenblätter', grid: 'Tabelle {name}', empty: '(leer)',
    xlsxDone: 'Excel-Datei erstellt.', csvDone: 'CSV-Datei erstellt.', fail: 'Das hat nicht geklappt. Bitte versuch es noch einmal.', choose: '– auswählen –', value: 'Wert' },
  en: { more: 'Show more rows', cell: 'Cell', apply: 'Apply', formula: 'Formula', reset: 'Restore sample values', changed: 'Changed – XLSX and CSV contain your input.',
    pick: 'Tap a cell to change it. Yellow cells are inputs.', readonly: 'This cell is calculated:', sheets: 'Sheets', grid: 'Sheet {name}', empty: '(empty)',
    xlsxDone: 'Excel file created.', csvDone: 'CSV file created.', fail: 'That did not work. Please try again.', choose: '– choose –', value: 'Value' },
};

async function start(cfg) {
  const t = L[cfg.lang === 'en' ? 'en' : 'de'];
  const base = new URL('./lib/shared/office/', import.meta.url).href;
  const [T, W, F, FX] = await Promise.all(['sheet-templates.js', 'workbook.js', 'formula.js', 'sheetfx.js'].map(m => import(base + m)));
  let wb, si = 0, limit = new Map(), sel = null, dirty = false;
  const build = () => {
    wb = T.buildSheetTemplate(cfg.id);
    if (!wb) throw new Error('unknown template ' + cfg.id);
    wb.sheets.forEach(s => { FX.ensureSheetExtras(s); W.ensureSheetModel(s); });
    W.recalc(wb);
  };
  build();

  // ------------------------------------------------ UI skeleton
  const tabs = el('div', { class: 'arc2-tabs', role: 'tablist', aria: { label: t.sheets } });
  const status = el('p', { class: 'arc2-status', role: 'status' }, t.pick);
  const addr = el('span', { class: 'arc2-addr' });
  const input = el('input', { class: 'wt-input arc2-in', type: 'text', id: 'arc2-in', autocomplete: 'off', enterkeyhint: 'done', aria: { label: t.value } });
  const select = el('select', { class: 'wt-input arc2-in', id: 'arc2-sel', hidden: true, aria: { label: t.value } });
  const applyBtn = el('button', { type: 'button', class: 'btn btn-primary arc2-apply' }, t.apply);
  const fx = el('p', { class: 'arc2-fx' });
  const bar = el('div', { class: 'arc2-bar', hidden: true }, el('label', { for: 'arc2-in', class: 'arc2-barl' }, addr), input, select, applyBtn, fx);
  const wrap = el('div', { class: 'arc2-grid', tabindex: '0' });
  const moreBtn = el('button', { type: 'button', class: 'btn btn-quiet arc2-morebtn' }, t.more);
  const resetBtn = el('button', { type: 'button', class: 'btn btn-quiet', hidden: true }, t.reset);
  host.replaceChildren(tabs, bar, wrap, el('div', { class: 'btn-row arc2-gridfoot' }, moreBtn, resetBtn), status);
  const actions = document.querySelector('[data-arc2-actions]');
  if (actions) actions.hidden = false;

  const sheet = () => wb.sheets[si];
  const colName = c => F.colName(c);
  function lastUsedRow(sh) {
    let last = 0;
    for (const [k, cell] of sh.cells) {
      const v = cell.f ? cell.cv : cell.v;
      if (v !== null && v !== undefined && v !== '') last = Math.max(last, W.R_OF(k));
    }
    return last;
  }
  function lastUsedCol(sh) {
    let last = 0;
    for (const [k, cell] of sh.cells) if (cell.v != null || cell.f) last = Math.max(last, W.C_OF(k));
    return Math.min(last, 30);
  }
  function listFor(sh, r, c) {
    const dv = FX.validationAt(sh, r, c);
    if (!dv || dv.type !== 'list') return null;
    if (dv.list && dv.list.length) return dv.list.map(String);
    if (!dv.src) return null;
    const m = /^(?:'?([^'!]+)'?!)?\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/.exec(String(dv.src).replace(/^=/, ''));
    if (!m) return null;
    const target = m[1] ? wb.sheets.find(s => s.name === m[1]) : sh;
    const g = F.parseRangeAddr(`${m[2]}${m[3]}:${m[4]}${m[5]}`);
    if (!target || !g) return null;
    const out = [];
    for (let r2 = g.r1; r2 <= g.r2; r2++) for (let c2 = g.c1; c2 <= g.c2; c2++) { const x = W.displayOf(target.cells.get(W.KEY(r2, c2))); if (x !== '') out.push(x); }
    return out;
  }
  // colour rules: formula rules need an evaluation context (as in the app)
  let cfCtx = null;
  const cfCache = () => {
    const cache = new Map();
    cache.evalAt = (f, dr, dc) => {
      try {
        if (!cfCtx) cfCtx = W.makeCtx(wb, { dirty: new Set() });
        const g = dr || dc ? F.shiftRefs(f, ref => ({ ...ref, r: ref.absR || ref.colOnly ? ref.r : ref.r + dr, c: ref.absC || ref.rowOnly ? ref.c : ref.c + dc })) : f;
        cfCtx.sheet = si; cfCtx.cur = null;
        return F.evaluate(F.compile(g), cfCtx, { dynamic: false });
      } catch { return null; }
    };
    return cache;
  };

  function renderTabs() {
    tabs.hidden = wb.sheets.length < 2;
    tabs.replaceChildren(...wb.sheets.map((s, i) => {
      const b = el('button', { type: 'button', role: 'tab', class: 'arc2-tab', aria: { selected: String(i === si) }, tabindex: i === si ? '0' : '-1' }, s.name);
      b.addEventListener('click', () => { si = i; sel = null; bar.hidden = true; renderTabs(); render(); });
      b.addEventListener('keydown', e => { const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (d) { const j = (si + d + wb.sheets.length) % wb.sheets.length; tabs.children[j].click(); tabs.children[j].focus(); } });
      return b;
    }));
  }

  function render() {
    const sh = sheet();
    cfCtx = null;
    const used = lastUsedRow(sh);
    const max = Math.min(sh.maxR, limit.get(si) ?? Math.max(used + 3, 12));
    const cols = lastUsedCol(sh);
    const cache = cfCache();
    const table = el('table', { class: 'arc2-table', aria: { label: t.grid.replace('{name}', sh.name) } });
    const widths = Array.from({ length: cols + 1 }, (_, c) => Math.max(44, Math.round((sh.colW[c] ?? W.DEFAULT_COL_W) * 0.9)));
    table.style.width = (38 + widths.reduce((a, b) => a + b, 0)) + 'px';
    const cg = el('colgroup', {}, el('col', { class: 'arc2-rn' }), ...widths.map(px => { const col = el('col'); col.style.width = px + 'px'; return col; }));
    const head = el('tr', {}, el('th', { class: 'arc2-corner', scope: 'col' }), ...Array.from({ length: cols + 1 }, (_, c) => el('th', { scope: 'col' }, colName(c))));
    const rows = [];
    for (let r = 0; r <= max; r++) {
      const tds = [el('th', { scope: 'row', class: 'arc2-rh' }, String(r + 1))];
      for (let c = 0; c <= cols; c++) {
        const cell = sh.cells.get(W.KEY(r, c));
        const st = (cell && cell.s) || {};
        const cf = cell ? FX.cfStyle(sh, r, c, cell, cache) : null;
        const v = cell ? (cell.f ? cell.cv : cell.v) : null;
        const td = el('td', { dataset: { r: String(r), c: String(c) } }, cell ? W.displayOf(cell) : '');
        const fill = (cf && cf.fill) || st.fill;
        if (fill) td.style.background = fill;
        if ((cf && cf.color) || st.color) td.style.color = (cf && cf.color) || st.color;
        if (st.b || (cf && cf.b)) td.classList.add('b');
        if (st.i) td.classList.add('i');
        if (cf && cf.st) td.classList.add('st');
        if (st.size && st.size >= 13) td.classList.add('big');
        const align = st.align || (typeof v === 'number' ? 'right' : null);
        if (align) td.classList.add('al-' + align);
        if (cf && cf.bar) td.style.backgroundImage = `linear-gradient(to right, ${cf.bar.color}55 ${Math.round(cf.bar.pct * 100)}%, transparent ${Math.round(cf.bar.pct * 100)}%)`;
        if (cf && cf.icon) td.prepend(el('span', { class: 'arc2-ic', aria: { hidden: 'true' } }, cf.icon[0]), ' ');
        if (cf && cf.icon) td.firstChild.style.color = cf.icon[1];
        // text runs on into empty neighbour cells, as in a spreadsheet
        if (typeof v === 'string' && v !== '' && !align) { const nx = sh.cells.get(W.KEY(r, c + 1)); const nv = nx ? (nx.f ? nx.cv : nx.v) : null; if (nv == null || nv === '') td.classList.add('ovf'); }
        if (cell && cell.f) td.classList.add('fx');
        else if (st.unlocked) td.classList.add('in');
        if (sel && sel.r === r && sel.c === c) td.classList.add('sel');
        tds.push(td);
      }
      rows.push(el('tr', {}, ...tds));
    }
    table.append(cg, el('thead', {}, head), el('tbody', {}, ...rows));
    wrap.replaceChildren(table);
    moreBtn.hidden = max >= sh.maxR;
  }

  function select_(r, c) {
    const sh = sheet();
    sel = { r, c };
    const cell = sh.cells.get(W.KEY(r, c));
    addr.textContent = `${t.cell} ${colName(c)}${r + 1}`;
    bar.hidden = false;
    if (cell && cell.f) {
      input.hidden = true; select.hidden = true; applyBtn.hidden = true;
      fx.hidden = false;
      fx.textContent = `${t.readonly} =${F.toDisplay(cell.f)}`;
    } else {
      fx.hidden = true; applyBtn.hidden = false;
      const list = listFor(sh, r, c);
      const cur = cell ? W.editTextOf(cell, F.toDisplay) : '';
      if (list) {
        input.hidden = true; select.hidden = false;
        select.replaceChildren(el('option', { value: '' }, t.choose), ...list.map(x => el('option', { value: x, selected: x === W.displayOf(cell) }, x)));
        select.focus({ preventScroll: true });
      } else {
        select.hidden = true; input.hidden = false;
        input.value = cur;
        input.focus({ preventScroll: true });
        input.select();
      }
    }
    wrap.querySelectorAll('td.sel').forEach(x => x.classList.remove('sel'));
    wrap.querySelector(`td[data-r="${r}"][data-c="${c}"]`)?.classList.add('sel');
  }

  function apply() {
    if (!sel) return;
    const sh = sheet();
    const old = sh.cells.get(W.KEY(sel.r, sel.c));
    if (old && old.f) return;
    const text = select.hidden ? input.value : select.value;
    const res = W.parseInput(text, old && old.s && old.s.fmt);
    const cell = { ...(old || {}) };
    delete cell.v; delete cell.f; delete cell.cv; delete cell.da;
    if (res.f) { cell.f = res.f; cell.da = true; } else if (res.v !== null && res.v !== undefined) cell.v = res.v;
    if (res.fmt && !(cell.s && cell.s.fmt)) cell.s = { ...(cell.s || {}), fmt: res.fmt };
    W.setCell(sh, sel.r, sel.c, cell.v === undefined && !cell.f && !cell.s ? null : cell);
    W.ensureSheetModel(sh);
    W.recalc(wb);
    dirty = true; resetBtn.hidden = false;
    status.textContent = t.changed;
    const next = { r: sel.r + 1, c: sel.c };
    render();
    select_(next.r, next.c);
  }

  wrap.addEventListener('click', e => { const td = e.target.closest('td[data-r]'); if (td) select_(+td.dataset.r, +td.dataset.c); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } else if (e.key === 'Escape') { bar.hidden = true; sel = null; render(); } });
  select.addEventListener('change', apply);
  applyBtn.addEventListener('click', apply);
  moreBtn.addEventListener('click', () => { const sh = sheet(); limit.set(si, Math.min(sh.maxR, (limit.get(si) ?? Math.max(lastUsedRow(sh) + 3, 12)) + 25)); render(); });
  resetBtn.addEventListener('click', () => { build(); dirty = false; sel = null; bar.hidden = true; resetBtn.hidden = true; status.textContent = t.pick; renderTabs(); render(); });

  // ------------------------------------------------ downloads
  const save = (blob, name) => {
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  const safe = s => String(s).replace(/[\\/:*?"<>|]+/g, '-').trim();
  document.querySelector('[data-arc2-xlsx]')?.addEventListener('click', async e => {
    const b = e.currentTarget; b.disabled = true;
    try {
      const { writeXlsx } = await import(base + 'xlsx-write.js');
      save(await writeXlsx(wb, { title: cfg.file }), `${safe(cfg.file)}.xlsx`);
      status.textContent = t.xlsxDone + (dirty ? ' ' + t.changed : '');
    } catch (err) { console.warn('xlsx', err); status.textContent = t.fail; } finally { b.disabled = false; }
  });
  document.querySelector('[data-arc2-csv]')?.addEventListener('click', async e => {
    const b = e.currentTarget; b.disabled = true;
    try {
      const { writeCsv } = await import(base + 'csv.js');
      const sh = sheet();
      save(writeCsv(sh, { delim: ';', decimalComma: true }), `${safe(cfg.file)}${wb.sheets.length > 1 ? ' – ' + safe(sh.name) : ''}.csv`);
      status.textContent = t.csvDone;
    } catch (err) { console.warn('csv', err); status.textContent = t.fail; } finally { b.disabled = false; }
  });
  // test hook (read-only): the built workbook
  host.arc2 = { wb: () => wb, values: (a, s = si) => { const p = F.parseAddr(a); const c = wb.sheets[s].cells.get(W.KEY(p.r, p.c)); return c ? (c.f ? c.cv : c.v) : null; } };
  renderTabs();
  render();
  host.dataset.ready = '1';
}

const cfgEl = document.getElementById('arc2-config');
const host = document.querySelector('[data-arc2-sheet]');
if (cfgEl && host) start(JSON.parse(cfgEl.textContent)).catch(err => {
  console.warn('arc2-sheet', err);
  const n = host.querySelector('[data-arc2-nojs]');
  if (n) n.textContent = /^en/.test(document.documentElement.lang) ? 'The preview could not be loaded. You can still open the template in the FaLe PDF app.' : 'Die Vorschau konnte nicht geladen werden. Du kannst die Vorlage trotzdem in der FaLe-PDF-App öffnen.';
});
