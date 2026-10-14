// Dialoge der Tabellenkalkulation: Zellen formatieren, Sortieren, Filter, Duplikate, Text in Spalten,
// Datenüberprüfung, Namens-Manager, Inhalte einfügen, Funktion einfügen, Pivot-Tabelle, Reihe, Größen.
import { $, $$, h, esc, toast, openDialog } from '../ui.js';
import { oicon } from './kinds.js';
import { KEY, getCell, setCell, valueAt, displayOf, formatValue, FORMAT_PRESETS, formatKind, parseInput, newSheet, CELL_STYLES } from './workbook.js';
import { colName, addr, parseRangeAddr, toDisplay, toCanonical, isValidName, FUNCTION_LIST, FN_CATEGORIES, KNOWN_FUNCTIONS, canonicalFn } from './formula.js';
import { fromGermanCode, toGermanCode } from './numfmt.js';
import { FONTS } from './fonts.js';
import { rangeStr, parseRange, FILTER_OPS, DV_TYPES, DV_OPS, parseList } from './sheetfx.js';
import { splitText, splitFixed, duplicateRows, computePivot, PIVOT_AGG, makeSeries } from './sheet-ops.js';

const FILL_COLORS = ['#FFFFFF', '#F2F2F2', '#D9D9D9', '#FFF2CC', '#FDE047', '#FED7AA', '#FBCFE8', '#E9E8FB', '#BFDBFE', '#A7F3D0', '#C6EFCE', '#FFC7CE', '#FFEB9C', '#DDEBF7', '#3B37A0', '#0B8F80', '#15803D', '#B91C1C', '#1A1A1A'];
const TEXT_COLORS = ['#1A1A1A', '#595959', '#B91C1C', '#C2410C', '#B45309', '#15803D', '#0B8F80', '#2F67D8', '#3B37A0', '#7E22CE', '#FFFFFF'];
export const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36];
const swatches = (list, name, cur) => `<div class="swatches" role="radiogroup">${list.map(c => `<button type="button" class="sw${(cur || '').toUpperCase() === c ? ' on' : ''}" data-${name}="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div>`;

// ---------------------------------------------------------------- Zellen formatieren
export async function formatCellsDialog(api, tab = 'num') {
  const sh = api.sh;
  const [r1, , c1] = api.bounds();
  const cur = getCell(sh, api.sel.r, api.sel.c);
  const s0 = (cur && cur.s) || {};
  const val = cur ? (cur.f ? cur.cv : cur.v) : null;
  const sample = typeof val === 'number' ? val : 1234.5678;
  const code0 = s0.fmt || 'General';
  const preset0 = FORMAT_PRESETS.find(p => p[0] === code0);
  const BD = [['none', 'Kein Rahmen'], ['outer', 'Außenrahmen'], ['all', 'Alle Rahmenlinien'], ['inner', 'Innenlinien'], ['top', 'Oben'], ['bottom', 'Unten'], ['left', 'Links'], ['right', 'Rechts'], ['thickouter', 'Dicker Außenrahmen'], ['doublebottom', 'Doppelte Unterlinie']];
  const LINE = [['thin', 'Dünn'], ['medium', 'Mittel'], ['thick', 'Dick'], ['double', 'Doppelt'], ['dashed', 'Gestrichelt'], ['dotted', 'Gepunktet']];
  const r = await openDialog({
    title: 'Zellen formatieren', wide: true,
    body: `<div class="fc-dlg">
      <div class="seg fc-tabs" role="tablist">${[['num', 'Zahl'], ['align', 'Ausrichtung'], ['font', 'Schrift'], ['border', 'Rahmen'], ['fill', 'Ausfüllen'], ['prot', 'Schutz']].map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${k === tab}">${l}</button>`).join('')}</div>
      <section data-pane="num" ${tab === 'num' ? '' : 'hidden'}>
        <div class="fc-presets">${FORMAT_PRESETS.map(([c, l], i) => `<label class="radio-row"><input type="radio" name="preset" value="${i}" ${preset0 && preset0[0] === c ? 'checked' : ''}><span>${esc(l)}</span><span class="muted small fc-ex">${esc(formatValue(c === '@' ? String(sample) : /[dmyhs]/i.test(c.replace(/"[^"]*"/g, '')) && sample > 1000 ? 46000.5625 : sample, c))}</span></label>`).join('')}</div>
        <label class="field"><span class="field-label">Formatcode (deutsch, z. B. #.##0,00 € oder TT.MM.JJJJ)</span><input class="input" name="code" value="${esc(toGermanCode(code0 === 'General' ? 'Standard' : code0))}" spellcheck="false"></label>
        <p class="fc-preview">Vorschau: <strong data-preview></strong></p>
      </section>
      <section data-pane="align" ${tab === 'align' ? '' : 'hidden'}>
        <div class="field-row"><label class="field"><span class="field-label">Horizontal</span><select class="select" name="halign">${[['', 'Standard'], ['left', 'Links'], ['center', 'Zentriert'], ['right', 'Rechts'], ['justify', 'Blocksatz']].map(([k, l]) => `<option value="${k}" ${(s0.align || '') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="field"><span class="field-label">Vertikal</span><select class="select" name="valign">${[['', 'Unten'], ['center', 'Mitte'], ['top', 'Oben']].map(([k, l]) => `<option value="${k}" ${(s0.valign || '') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
        <div class="field-row"><label class="field"><span class="field-label">Einzug</span><input class="input" type="number" min="0" max="15" name="indent" value="${s0.indent || 0}"></label>
        <label class="field"><span class="field-label">Textrichtung</span><select class="select" name="rot">${[['0', 'Waagerecht'], ['45', 'Schräg (45°)'], ['90', 'Nach oben gedreht (90°)'], ['270', 'Nach unten gedreht (−90°)'], ['255', 'Senkrecht gestapelt']].map(([k, l]) => `<option value="${k}" ${String(s0.rot || 0) === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
        <label class="check"><input type="checkbox" name="wrap" ${s0.wrap ? 'checked' : ''}> Zeilenumbruch</label>
        <label class="check"><input type="checkbox" name="merge" ${api.mergeAt(api.sel.r, api.sel.c) ? 'checked' : ''}> Zellen verbinden</label>
      </section>
      <section data-pane="font" ${tab === 'font' ? '' : 'hidden'}>
        <div class="field-row"><label class="field"><span class="field-label">Schriftart</span><select class="select" name="font"><option value="">Standard (Calibri)</option>${FONTS.map(f => `<option value="${esc(f.name)}" ${s0.font === f.name ? 'selected' : ''} style="font-family:${esc(f.css)}">${esc(f.name)}</option>`).join('')}</select></label>
        <label class="field"><span class="field-label">Größe</span><select class="select" name="size">${SIZES.map(z => `<option value="${z}" ${(s0.size || 11) === z ? 'selected' : ''}>${z} pt</option>`).join('')}</select></label></div>
        <div class="check-row"><label class="check"><input type="checkbox" name="b" ${s0.b ? 'checked' : ''}> <strong>Fett</strong></label><label class="check"><input type="checkbox" name="i" ${s0.i ? 'checked' : ''}> <em>Kursiv</em></label>
          <label class="check"><input type="checkbox" name="u" ${s0.u ? 'checked' : ''}> <u>Unterstrichen</u></label><label class="check"><input type="checkbox" name="st" ${s0.st ? 'checked' : ''}> <s>Durchgestrichen</s></label></div>
        <span class="field-label">Schriftfarbe</span>${swatches(TEXT_COLORS, 'tc', s0.color || '#1A1A1A')}
      </section>
      <section data-pane="border" ${tab === 'border' ? '' : 'hidden'}>
        <div class="fc-bd">${BD.map(([k, l]) => `<button type="button" class="chip" data-bd="${k}">${l}</button>`).join('')}</div>
        <div class="field-row"><label class="field"><span class="field-label">Linienart</span><select class="select" name="line">${LINE.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <label class="field"><span class="field-label">Farbe</span><input class="input" type="color" name="bdcolor" value="#000000"></label></div>
        <p class="hint">Wähle eine Vorlage – sie wird beim Übernehmen auf den markierten Bereich angewendet.</p>
      </section>
      <section data-pane="fill" ${tab === 'fill' ? '' : 'hidden'}>
        <span class="field-label">Hintergrundfarbe</span>${swatches(FILL_COLORS, 'fc', s0.fill || '#FFFFFF')}
        <label class="field"><span class="field-label">Eigene Farbe</span><input class="input" type="color" name="fillc" value="${s0.fill || '#FFFFFF'}"></label>
        <button type="button" class="btn btn-ghost btn-sm" data-nofill>Keine Füllung</button>
      </section>
      <section data-pane="prot" ${tab === 'prot' ? '' : 'hidden'}>
        <label class="check"><input type="checkbox" name="locked" ${s0.unlocked ? '' : 'checked'}> Gesperrt</label>
        <label class="check"><input type="checkbox" name="hideF" ${s0.hideF ? 'checked' : ''}> Formel ausblenden</label>
        <p class="hint">Wirkt erst, wenn das Blatt geschützt ist (Daten → Blatt schützen). Der Schutz verhindert versehentliche Änderungen – er ist keine Verschlüsselung.</p>
      </section>
    </div>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Übernehmen', value: 'ok', kind: 'btn-primary', default: true }],
    validate: (v, dlg) => {
      if (v !== 'ok') return true;
      const code = $('[name=code]', dlg).value.trim();
      if (code && !/^standard$/i.test(code)) { try { formatValue(1, fromGermanCode(code)); } catch { toast('Dieser Formatcode ist ungültig.', 'error'); return false; } }
      return true;
    },
    onMount: dlg => {
      const st = { tc: null, fill: undefined, bd: null };
      $$('[data-tab]', dlg).forEach(b => b.addEventListener('click', () => { $$('[data-tab]', dlg).forEach(x => x.setAttribute('aria-selected', String(x === b))); $$('[data-pane]', dlg).forEach(p => { p.hidden = p.dataset.pane !== b.dataset.tab; }); }));
      const codeIn = $('[name=code]', dlg), prev = $('[data-preview]', dlg);
      const paint = () => { const c = codeIn.value.trim(); let t; try { t = formatValue(typeof val === 'string' && !/@/.test(c) ? val : sample, !c || /^standard$/i.test(c) ? 'General' : fromGermanCode(c)); } catch { t = '—'; } prev.textContent = t; };
      $$('[name=preset]', dlg).forEach(x => x.addEventListener('change', () => { const p = FORMAT_PRESETS[+x.value]; codeIn.value = p[0] === 'General' ? 'Standard' : toGermanCode(p[0]); paint(); }));
      codeIn.addEventListener('input', () => { $$('[name=preset]', dlg).forEach(x => { x.checked = false; }); paint(); });
      paint();
      $$('[data-tc]', dlg).forEach(b => b.addEventListener('click', () => { st.tc = b.dataset.tc; $$('[data-tc]', dlg).forEach(x => x.classList.toggle('on', x === b)); }));
      $$('[data-fc]', dlg).forEach(b => b.addEventListener('click', () => { st.fill = b.dataset.fc; $$('[data-fc]', dlg).forEach(x => x.classList.toggle('on', x === b)); }));
      $('[name=fillc]', dlg).addEventListener('input', e => { st.fill = e.target.value.toUpperCase(); $$('[data-fc]', dlg).forEach(x => x.classList.remove('on')); });
      $('[data-nofill]', dlg).addEventListener('click', () => { st.fill = null; $$('[data-fc]', dlg).forEach(x => x.classList.remove('on')); });
      $$('[data-bd]', dlg).forEach(b => b.addEventListener('click', () => { st.bd = b.dataset.bd; $$('[data-bd]', dlg).forEach(x => x.setAttribute('aria-pressed', String(x === b))); }));
      const v = n => $(`[name=${n}]`, dlg);
      return { collect: () => ({ code: codeIn.value.trim(), halign: v('halign').value, valign: v('valign').value, indent: +v('indent').value || 0, rot: +v('rot').value || 0, wrap: v('wrap').checked, merge: v('merge').checked, font: v('font').value, size: +v('size').value, b: v('b').checked, i: v('i').checked, u: v('u').checked, st: v('st').checked, tc: st.tc, fill: st.fill, bd: st.bd, line: v('line').value, bdcolor: v('bdcolor').value.toUpperCase(), locked: v('locked').checked, hideF: v('hideF').checked }) };
    },
  });
  if (r.value !== 'ok' || !r.data) return false;
  const d = r.data;
  const code = !d.code || /^standard$/i.test(d.code) ? 'General' : fromGermanCode(d.code);
  const diff = {
    fmt: code !== code0, align: d.halign !== (s0.align || ''), valign: d.valign !== (s0.valign || ''), indent: d.indent !== (s0.indent || 0), rot: d.rot !== (s0.rot || 0),
    wrap: d.wrap !== !!s0.wrap, font: d.font !== (s0.font || ''), size: d.size !== (s0.size || 11), b: d.b !== !!s0.b, i: d.i !== !!s0.i, u: d.u !== !!s0.u, st: d.st !== !!s0.st,
    locked: d.locked !== !s0.unlocked, hideF: d.hideF !== !!s0.hideF,
  };
  if (!api.guard()) return false;
  api.pushUndo();
  const ranges = api.ranges();
  for (const rg of ranges) {
    api.forRange(rg, (n, rr, cc) => {
      const s = n.s;
      if (diff.fmt) { s.fmt = code === 'General' ? undefined : code; if (formatKind(code) === 'date' && typeof n.v === 'string') { const p = parseInput(n.v, code); if (typeof p.v === 'number') n.v = p.v; } }
      if (diff.align) s.align = d.halign || undefined;
      if (diff.valign) s.valign = d.valign || undefined;
      if (diff.indent) s.indent = d.indent || undefined;
      if (diff.rot) s.rot = d.rot || undefined;
      if (diff.wrap) s.wrap = d.wrap || undefined;
      if (diff.font) s.font = d.font || undefined;
      if (diff.size) s.size = d.size === 11 ? undefined : d.size;
      for (const k of ['b', 'i', 'u', 'st']) if (diff[k]) s[k] = d[k] || undefined;
      if (d.tc) s.color = d.tc === '#1A1A1A' ? undefined : d.tc;
      if (d.fill !== undefined) s.fill = d.fill && d.fill !== '#FFFFFF' ? d.fill : undefined;
      if (diff.locked) s.unlocked = d.locked ? undefined : true;
      if (diff.hideF) s.hideF = d.hideF || undefined;
      if (d.bd) s.bd = applyBorderPreset(s.bd, d.bd, d.line, d.bdcolor, rr, cc, rg);
    });
  }
  if (d.merge !== !!api.mergeAt(api.sel.r, api.sel.c)) api.toggleMerge(d.merge);
  api.changed({ recalc: false });
  void r1; void c1;
  return true;
}
/** New border object for a cell inside range rg after applying a preset. */
export function applyBorderPreset(bd0, preset, line = 'thin', color = '#000000', r, c, rg) {
  const style = line === 'thin' ? true : line;
  const bd = { ...(bd0 || {}) };
  const set = k => { bd[k] = style; };
  const top = r === rg.r1, bottom = r === rg.r2, left = c === rg.c1, right = c === rg.c2;
  switch (preset) {
    case 'none': return undefined;
    case 'all': set('t'); set('b'); set('l'); set('r'); break;
    case 'outer': if (top) set('t'); if (bottom) set('b'); if (left) set('l'); if (right) set('r'); break;
    case 'thickouter': if (top) bd.t = 'thick'; if (bottom) bd.b = 'thick'; if (left) bd.l = 'thick'; if (right) bd.r = 'thick'; break;
    case 'inner': if (!top) set('t'); if (!bottom) set('b'); if (!left) set('l'); if (!right) set('r'); break;
    case 'top': if (top) set('t'); break;
    case 'bottom': if (bottom) set('b'); break;
    case 'left': if (left) set('l'); break;
    case 'right': if (right) set('r'); break;
    case 'doublebottom': if (bottom) bd.b = 'double'; break;
  }
  if (color && color !== '#000000') bd.color = color; else delete bd.color;
  return Object.keys(bd).some(k => k !== 'color' && bd[k]) ? bd : undefined;
}

// ---------------------------------------------------------------- Sortieren (mehrere Ebenen)
export async function sortDialog(api) {
  const sh = api.sh;
  const rg = api.dataRange();
  if (!rg || rg.r2 <= rg.r1) { toast('Markiere eine Tabelle zum Sortieren.', 'info'); return; }
  const headGuess = api.hasHeader(rg);
  const colLabel = (c, head) => (head ? `${displayOf(getCell(sh, rg.r1, c)) || `Spalte ${colName(c)}`}` : `Spalte ${colName(c)}`);
  const cols = [];
  for (let c = rg.c1; c <= rg.c2; c++) cols.push(c);
  const levelHtml = (head, lv = { c: api.sel.c, asc: true }) => `<div class="sort-level"><select class="select" data-col>${cols.map(c => `<option value="${c}" ${c === lv.c ? 'selected' : ''}>${esc(colLabel(c, head))}</option>`).join('')}</select><select class="select" data-ord><option value="asc" ${lv.asc ? 'selected' : ''}>A → Z / aufsteigend</option><option value="desc" ${lv.asc ? '' : 'selected'}>Z → A / absteigend</option></select><button type="button" class="icon-btn" data-rm aria-label="Ebene entfernen">${oicon('trash')}</button></div>`;
  const r = await openDialog({
    title: 'Sortieren', wide: true,
    body: `<div class="sort-dlg"><p class="small">Bereich ${esc(rangeStr(rg))}</p>
      <label class="check"><input type="checkbox" name="head" ${headGuess ? 'checked' : ''}> Daten haben Überschriften</label>
      <div class="sort-levels"></div>
      <button type="button" class="btn btn-ghost btn-sm" data-add>${oicon('plus')} Ebene hinzufügen</button></div>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Sortieren', value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => {
      const box = $('.sort-levels', dlg), headCb = $('[name=head]', dlg);
      const add = lv => { const el = h(levelHtml(headCb.checked, lv)); $('[data-rm]', el).addEventListener('click', () => { if ($$('.sort-level', box).length > 1) el.remove(); }); box.appendChild(el); };
      add({ c: Math.min(Math.max(api.sel.c, rg.c1), rg.c2), asc: true });
      $('[data-add]', dlg).addEventListener('click', () => { if ($$('.sort-level', box).length < 6) add({ c: cols[Math.min(cols.length - 1, $$('.sort-level', box).length)], asc: true }); });
      headCb.addEventListener('change', () => { $$('[data-col]', box).forEach(s => { [...s.options].forEach(o => { o.textContent = colLabel(+o.value, headCb.checked); }); }); });
      return { collect: () => ({ head: headCb.checked, keys: $$('.sort-level', box).map(l => ({ c: +$('[data-col]', l).value, asc: $('[data-ord]', l).value === 'asc' })) }) };
    },
  });
  if (r.value !== 'ok' || !r.data) return;
  api.sortRange({ ...rg, r1: rg.r1 + (r.data.head ? 1 : 0) }, r.data.keys);
}

// ---------------------------------------------------------------- Zahlen-/Textfilter
export async function customFilterDialog(api, c) {
  const af = api.sh.autoFilter;
  const curF = af && af.filters && af.filters[c] && af.filters[c].custom ? af.filters[c] : null;
  const c1 = (curF && curF.custom[0]) || { op: 'gt', v: '' }, c2 = (curF && curF.custom[1]) || { op: '', v: '' };
  const opSel = (name, v, empty) => `<select class="select" name="${name}">${empty ? '<option value="">—</option>' : ''}${FILTER_OPS.map(o => `<option value="${o.id}" ${o.id === v ? 'selected' : ''}>${o.label}</option>`).join('')}</select>`;
  const r = await openDialog({
    title: `Benutzerdefinierter Filter: Spalte ${colName(c)}`,
    body: `<div class="cfl-dlg"><div class="field-row">${opSel('op1', c1.op)}<input class="input" name="v1" value="${esc(c1.v)}" placeholder="Wert"></div>
      <div class="seg" role="group"><button type="button" data-join="and" aria-pressed="${curF ? !!curF.and : true}">UND</button><button type="button" data-join="or" aria-pressed="${curF ? !curF.and : false}">ODER</button></div>
      <div class="field-row">${opSel('op2', c2.op, true)}<input class="input" name="v2" value="${esc(c2.v)}" placeholder="Wert"></div>
      <label class="check"><input type="checkbox" name="top"> Stattdessen die obersten <input class="input inline-num" name="topn" type="number" min="1" max="500" value="10"> Werte zeigen</label>
      <p class="hint">Platzhalter: ? für ein Zeichen, * für beliebig viele.</p></div>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'OK', value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => {
      let join = curF ? (curF.and ? 'and' : 'or') : 'and';
      $$('[data-join]', dlg).forEach(b => b.addEventListener('click', () => { join = b.dataset.join; $$('[data-join]', dlg).forEach(x => x.setAttribute('aria-pressed', String(x === b))); }));
      const v = n => $(`[name=${n}]`, dlg);
      return { collect: () => ({ op1: v('op1').value, v1: v('v1').value, op2: v('op2').value, v2: v('v2').value, join, top: v('top').checked, topn: +v('topn').value || 10 }) };
    },
  });
  if (r.value !== 'ok' || !r.data) return null;
  const d = r.data;
  if (d.top) return { top: Math.max(1, Math.min(500, d.topn)) };
  const custom = [{ op: d.op1, v: d.v1 }];
  if (d.op2) custom.push({ op: d.op2, v: d.v2 });
  return { custom, and: d.join === 'and' };
}

// ---------------------------------------------------------------- Duplikate entfernen
export async function dedupeDialog(api) {
  const sh = api.sh;
  const rg = api.dataRange();
  if (!rg) return;
  const headGuess = api.hasHeader(rg);
  const cols = [];
  for (let c = rg.c1; c <= rg.c2; c++) cols.push(c);
  const r = await openDialog({
    title: 'Duplikate entfernen',
    body: `<p class="small">Bereich ${esc(rangeStr(rg))}. Zeilen mit gleichen Werten in den gewählten Spalten werden entfernt (die erste bleibt).</p>
      <label class="check"><input type="checkbox" name="head" ${headGuess ? 'checked' : ''}> Daten haben Überschriften</label>
      <div class="dd-cols">${cols.map(c => `<label class="check"><input type="checkbox" value="${c}" checked> ${esc(headGuess ? displayOf(getCell(sh, rg.r1, c)) || `Spalte ${colName(c)}` : `Spalte ${colName(c)}`)}</label>`).join('')}</div>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Entfernen', value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => ({ collect: () => ({ head: $('[name=head]', dlg).checked, cols: $$('.dd-cols input', dlg).filter(x => x.checked).map(x => +x.value) }) }),
  });
  if (r.value !== 'ok' || !r.data || !r.data.cols.length) return;
  if (!api.guard()) return;
  const from = rg.r1 + (r.data.head ? 1 : 0);
  const rows = [];
  for (let rr = from; rr <= rg.r2; rr++) { const row = []; for (let c = 0; c <= rg.c2; c++) row[c] = valueAt(sh, rr, c); rows.push(row); }
  const dups = new Set(duplicateRows(rows, r.data.cols));
  api.pushUndo();
  const keep = [];
  rows.forEach((_, i) => { if (!dups.has(i)) { const cells = []; for (let c = rg.c1; c <= rg.c2; c++) cells.push(getCell(sh, from + i, c) || null); keep.push(cells); } });
  for (let rr = from; rr <= rg.r2; rr++) for (let c = rg.c1; c <= rg.c2; c++) setCell(sh, rr, c, null);
  keep.forEach((cells, i) => cells.forEach((cell, k) => { if (cell) setCell(sh, from + i, rg.c1 + k, cell); }));
  api.changed({ full: true });
  toast(dups.size ? `${dups.size} doppelte Zeile${dups.size === 1 ? '' : 'n'} entfernt · ${keep.length} eindeutige bleiben` : 'Keine Duplikate gefunden', dups.size ? 'success' : 'info');
}

// ---------------------------------------------------------------- Text in Spalten
export async function textToColumnsDialog(api) {
  const sh = api.sh;
  const [r1, r2, c1] = api.bounds();
  const last = Math.min(r2, sh.maxR);
  const lines = [];
  for (let rr = r1; rr <= last; rr++) lines.push(String(valueAt(sh, rr, c1) ?? ''));
  if (!lines.some(Boolean)) { toast('Markiere eine Spalte mit Text.', 'info'); return; }
  const r = await openDialog({
    title: 'Text in Spalten', wide: true,
    body: `<div class="t2c-dlg"><div class="seg" role="group"><button type="button" data-mode="delim" aria-pressed="true">Getrennt</button><button type="button" data-mode="fixed" aria-pressed="false">Feste Breite</button></div>
      <div data-delims><div class="check-row">${[['tab', 'Tabulator'], [';', 'Semikolon'], [',', 'Komma'], [' ', 'Leerzeichen']].map(([k, l]) => `<label class="check"><input type="checkbox" value="${esc(k)}" ${k === ';' || (k === ',' && !lines.join('').includes(';')) ? 'checked' : ''}> ${l}</label>`).join('')}
        <label class="check">Andere: <input class="input inline-num" name="other" maxlength="1"></label></div>
        <label class="check"><input type="checkbox" name="merge"> Aufeinanderfolgende Trennzeichen als eins behandeln</label></div>
      <label class="field" data-fixed hidden><span class="field-label">Trennpositionen (Zeichen, z. B. 5, 12)</span><input class="input" name="pos" placeholder="5, 12"></label>
      <div class="t2c-prev" data-prev></div></div>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Aufteilen', value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => {
      let mode = 'delim';
      const opts = () => {
        const delims = $$('[data-delims] .check-row input[type=checkbox]', dlg).filter(x => x.checked).map(x => (x.value === 'tab' ? '\t' : x.value));
        const o = $('[name=other]', dlg).value; if (o) delims.push(o);
        return { mode, delims, merge: $('[name=merge]', dlg).checked, pos: $('[name=pos]', dlg).value.split(/[;,\s]+/).map(Number).filter(n => n > 0).sort((a, b) => a - b) };
      };
      const split = (t, o) => (o.mode === 'fixed' ? splitFixed(t, o.pos) : splitText(t, { delims: o.delims.length ? o.delims : [';'], merge: o.merge }));
      const paint = () => { const o = opts(); $('[data-prev]', dlg).innerHTML = `<table>${lines.slice(0, 6).map(l => `<tr>${split(l, o).map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</table>`; };
      $$('[data-mode]', dlg).forEach(b => b.addEventListener('click', () => { mode = b.dataset.mode; $$('[data-mode]', dlg).forEach(x => x.setAttribute('aria-pressed', String(x === b))); $('[data-delims]', dlg).hidden = mode !== 'delim'; $('[data-fixed]', dlg).hidden = mode !== 'fixed'; paint(); }));
      dlg.addEventListener('input', paint); dlg.addEventListener('change', paint);
      paint();
      return { collect: () => ({ ...opts(), split }) };
    },
  });
  if (r.value !== 'ok' || !r.data) return;
  if (!api.guard()) return;
  api.pushUndo();
  const changedCells = [];
  lines.forEach((l, i) => {
    const parts = r.data.split(l, r.data);
    parts.forEach((p, k) => { api.applyInput(r1 + i, c1 + k, p.trim(), { record: false, recalc: false }); changedCells.push({ r: r1 + i, c: c1 + k }); });
  });
  api.changed({ cells: changedCells });
  toast('Text auf Spalten verteilt', 'success');
}

// ---------------------------------------------------------------- Datenüberprüfung
export async function dvDialog(api) {
  const sh = api.sh;
  const [r1, r2, c1, c2] = api.bounds();
  const existing = api.validationAt(api.sel.r, api.sel.c);
  const ex = existing || { type: 'list', op: 'between' };
  const r = await openDialog({
    title: 'Datenüberprüfung', wide: true,
    body: `<p class="small">Lege fest, welche Werte in den Zellen erlaubt sind. Bei Listen erscheint ein kleiner Pfeil zur Auswahl.</p>
        <label class="field"><span class="field-label">Bereich</span><input class="input" name="range" value="${esc(existing ? existing.range : rangeStr({ r1, c1, r2, c2 }))}" spellcheck="false"></label>
        <div class="field-row"><label class="field"><span class="field-label">Zulassen</span><select class="select" name="type">${DV_TYPES.map(t => `<option value="${t.id}" ${(ex.type || 'list') === t.id ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label>
        <label class="field dv-op"><span class="field-label">Daten</span><select class="select" name="op">${DV_OPS.map(o => `<option value="${o.id}" ${(ex.op || 'between') === o.id ? 'selected' : ''}>${o.label}</option>`).join('')}</select></label></div>
        <label class="field dv-list"><span class="field-label">Erlaubte Werte (je Zeile einer) oder ein Bereich wie =$A$1:$A$5</span><textarea class="input dv-ta" name="list" rows="6" placeholder="Offen&#10;In Arbeit&#10;Erledigt">${esc(ex.src ? '=' + toDisplay(ex.src) : (ex.list || []).join('\n'))}</textarea></label>
        <div class="field-row dv-vals"><label class="field"><span class="field-label">Minimum / Wert</span><input class="input" name="v1" value="${esc(ex.v1 ?? '')}"></label><label class="field dv-v2"><span class="field-label">Maximum</span><input class="input" name="v2" value="${esc(ex.v2 ?? '')}"></label></div>
        <label class="field"><span class="field-label">Eingabehinweis (optional)</span><input class="input" name="prompt" value="${esc(ex.prompt || '')}"></label>
        <label class="field"><span class="field-label">Fehlermeldung (optional)</span><input class="input" name="error" value="${esc(ex.error || '')}"></label>`,
    actions: [...(existing ? [{ label: 'Entfernen', value: 'remove', kind: 'btn-danger-ghost' }] : []), { label: 'Abbrechen', value: 'cancel' }, { label: 'Übernehmen', value: 'ok', kind: 'btn-primary', default: true }],
    validate: (v, dlg) => {
      if (v !== 'ok') return true;
      if (!parseRange($('[name=range]', dlg).value)) { toast('Bitte gib einen gültigen Bereich an.', 'error'); return false; }
      const t = $('[name=type]', dlg).value;
      if (t === 'list') { const l = $('[name=list]', dlg).value.trim(); if (!l || (!/^=/.test(l) && !parseList(l).length)) { toast('Bitte gib mindestens einen Wert ein.', 'error'); return false; } }
      else if (!$('[name=v1]', dlg).value.trim()) { toast('Bitte gib einen Vergleichswert ein.', 'error'); return false; }
      return true;
    },
    onMount: dlg => {
      const sync = () => {
        const t = $('[name=type]', dlg).value, op = $('[name=op]', dlg).value;
        $('.dv-list', dlg).hidden = t !== 'list'; $('.dv-op', dlg).hidden = t === 'list'; $('.dv-vals', dlg).hidden = t === 'list';
        $('.dv-v2', dlg).hidden = !/between/i.test(op);
      };
      dlg.addEventListener('change', sync); sync();
      const v = n => $(`[name=${n}]`, dlg).value;
      return { collect: () => ({ range: v('range').trim().toUpperCase(), type: v('type'), op: v('op'), list: v('list'), v1: v('v1').trim(), v2: v('v2').trim(), prompt: v('prompt').trim(), error: v('error').trim() }) };
    },
  });
  if (r.value === 'remove' && existing) { api.pushUndo(); sh.dv = sh.dv.filter(x => x !== existing); api.changed({ recalc: false }); toast('Datenüberprüfung entfernt'); return; }
  if (r.value !== 'ok' || !r.data) return;
  const d = r.data;
  api.pushUndo();
  if (existing) sh.dv = sh.dv.filter(x => x !== existing);
  const base = { range: rangeStr(parseRange(d.range)), ...(d.prompt ? { prompt: d.prompt } : {}), ...(d.error ? { error: d.error } : {}) };
  if (d.type === 'list') {
    const t = d.list.trim();
    if (/^=/.test(t)) { let src; try { src = toCanonical(t.slice(1)); } catch { src = t.slice(1); } sh.dv.push({ ...base, type: 'list', src, list: [] }); }
    else sh.dv.push({ ...base, list: parseList(t) });
  } else sh.dv.push({ ...base, type: d.type, op: d.op, v1: d.v1, v2: d.v2, list: [] });
  api.changed({ recalc: false });
  toast(d.type === 'list' ? 'Dropdown-Liste angelegt' : 'Datenüberprüfung angelegt', 'success');
}

// ---------------------------------------------------------------- Namens-Manager
export async function nameManagerDialog(api, { defineOnly = false } = {}) {
  const wb = api.wb;
  const [r1, r2, c1, c2] = api.bounds();
  const defRef = `${api.sh.name}!$${colName(c1)}$${r1 + 1}${r1 !== r2 || c1 !== c2 ? `:$${colName(c2)}$${r2 + 1}` : ''}`;
  const listHtml = () => (wb.names || []).length ? (wb.names || []).map((n, i) => `<div class="nm-row" data-i="${i}"><strong>${esc(n.name)}</strong><span class="muted small">=${esc(toDisplay(n.ref))}${n.si != null && n.si >= 0 && wb.sheets[n.si] ? ` · nur ${esc(wb.sheets[n.si].name)}` : ''}</span><button type="button" class="icon-btn" data-del="${i}" aria-label="Name löschen">${oicon('trash')}</button></div>`).join('') : '<p class="panel-empty">Noch keine Namen. Namen machen Formeln lesbarer, z. B. =Netto*Steuersatz.</p>';
  const r = await openDialog({
    title: defineOnly ? 'Namen definieren' : 'Namens-Manager', wide: true,
    body: `<div class="nm-dlg">${defineOnly ? '' : `<div class="nm-list">${listHtml()}</div><span class="field-label">Neuer Name</span>`}
      <div class="field-row"><label class="field"><span class="field-label">Name</span><input class="input" name="name" placeholder="z. B. Steuersatz" spellcheck="false" autofocus></label>
      <label class="field"><span class="field-label">Bezieht sich auf</span><input class="input" name="ref" value="${esc(toDisplay(defRef.replace(/^([^!]+)!/, (m, s) => (/^[A-Za-z_][\w.]*$/.test(s) ? s : `'${s.replace(/'/g, "''")}'`) + '!')))}" spellcheck="false"></label></div>
      <label class="field"><span class="field-label">Gültig für</span><select class="select" name="scope"><option value="">Arbeitsmappe</option>${wb.sheets.map((s, i) => `<option value="${i}">${esc(s.name)}</option>`).join('')}</select></label></div>`,
    actions: [{ label: 'Schließen', value: 'cancel' }, { label: 'Name anlegen', value: 'ok', kind: 'btn-primary', default: true }],
    validate: (v, dlg) => {
      if (v !== 'ok') return true;
      const n = $('[name=name]', dlg).value.trim();
      if (!isValidName(n) || KNOWN_FUNCTIONS.has(canonicalFn(n))) { toast('Ungültiger Name. Er muss mit einem Buchstaben beginnen und darf keine Zelladresse sein.', 'error'); return false; }
      const scope = $('[name=scope]', dlg).value;
      if ((wb.names || []).some(x => x.name.toLowerCase() === n.toLowerCase() && String(x.si ?? '') === scope)) { toast('Diesen Namen gibt es schon.', 'error'); return false; }
      try { toCanonical($('[name=ref]', dlg).value.trim().replace(/^=/, '')); } catch { toast('Der Bezug ist ungültig.', 'error'); return false; }
      return true;
    },
    onMount: dlg => {
      dlg.addEventListener('click', e => {
        const b = e.target.closest('[data-del]');
        if (!b) return;
        api.pushUndo('wb');
        wb.names.splice(+b.dataset.del, 1);
        api.changed({ full: true });
        $('.nm-list', dlg).innerHTML = listHtml();
        toast('Name gelöscht');
      });
      return { collect: () => ({ name: $('[name=name]', dlg).value.trim(), ref: $('[name=ref]', dlg).value.trim().replace(/^=/, ''), scope: $('[name=scope]', dlg).value }) };
    },
  });
  if (r.value !== 'ok' || !r.data) return;
  api.pushUndo('wb');
  wb.names = wb.names || [];
  wb.names.push({ name: r.data.name, ref: toCanonical(r.data.ref), si: r.data.scope === '' ? null : +r.data.scope });
  api.changed({ full: true });
  toast(`Name „${r.data.name}“ angelegt`, 'success');
}

// ---------------------------------------------------------------- Inhalte einfügen
export async function pasteSpecialDialog() {
  const r = await openDialog({
    title: 'Inhalte einfügen',
    body: `<div class="ps-special">
      <span class="field-label">Einfügen</span>
      ${[['all', 'Alles'], ['values', 'Nur Werte'], ['formats', 'Nur Formate'], ['formulas', 'Nur Formeln'], ['valfmt', 'Werte und Zahlenformate']].map(([k, l], i) => `<label class="radio-row"><input type="radio" name="what" value="${k}" ${i === 0 ? 'checked' : ''}> ${l}</label>`).join('')}
      <span class="field-label">Rechenoperation</span>
      <select class="select" name="op"><option value="">Keine</option><option value="+">Addieren</option><option value="-">Subtrahieren</option><option value="*">Multiplizieren</option><option value="/">Dividieren</option></select>
      <label class="check"><input type="checkbox" name="skip"> Leerzellen überspringen</label>
      <label class="check"><input type="checkbox" name="transpose"> Transponieren (Zeilen ↔ Spalten)</label></div>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Einfügen', value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => ({ collect: () => ({ what: ($('[name=what]:checked', dlg) || {}).value || 'all', op: $('[name=op]', dlg).value, skip: $('[name=skip]', dlg).checked, transpose: $('[name=transpose]', dlg).checked }) }),
  });
  return r.value === 'ok' ? r.data : null;
}

// ---------------------------------------------------------------- Funktion einfügen
export async function insertFunctionDialog() {
  const cats = ['Alle', ...FN_CATEGORIES.slice(1)];
  const popular = new Set(FUNCTION_LIST.slice(0, 16).map(f => f[0]));
  const r = await openDialog({
    title: 'Funktion einfügen', wide: true,
    body: `<div class="fx-dlg"><input class="input" type="search" name="q" placeholder="Funktion suchen, z. B. Summe, Datum, SVERWEIS …" autofocus>
      <div class="chips fx-cats">${['Häufig verwendet', ...cats].map((c, i) => `<button type="button" class="chip" data-cat="${esc(c)}" aria-selected="${i === 0}">${esc(c)}</button>`).join('')}</div>
      <div class="fx-list" role="listbox"></div>
      <p class="fx-info" data-info></p></div>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Einfügen', value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => {
      let cat = 'Häufig verwendet', pick = null;
      const list = $('.fx-list', dlg), info = $('[data-info]', dlg), q = $('[name=q]', dlg);
      const paint = () => {
        const term = q.value.trim().toLocaleLowerCase('de');
        const items = FUNCTION_LIST.filter(([n, c, d]) => (term ? (n.toLocaleLowerCase('de').includes(term) || d.toLocaleLowerCase('de').includes(term) || canonicalFn(n).toLowerCase().includes(term)) : cat === 'Alle' ? true : cat === 'Häufig verwendet' ? popular.has(n) : c === cat));
        list.innerHTML = items.map(([n, , d, ex]) => `<button type="button" class="fx-item" role="option" data-fn="${esc(n)}" data-ex="${esc(ex)}"><strong>${esc(n)}</strong><span>${esc(d)}</span></button>`).join('') || '<p class="panel-empty">Keine Funktion gefunden.</p>';
        pick = items[0] ? items[0][3] : null;
        info.textContent = items[0] ? `=${items[0][3]}` : '';
        const first = $('.fx-item', list); if (first) first.setAttribute('aria-selected', 'true');
      };
      $$('[data-cat]', dlg).forEach(b => b.addEventListener('click', () => { cat = b.dataset.cat; q.value = ''; $$('[data-cat]', dlg).forEach(x => x.setAttribute('aria-selected', String(x === b))); paint(); }));
      q.addEventListener('input', paint);
      list.addEventListener('click', e => { const b = e.target.closest('.fx-item'); if (!b) return; pick = b.dataset.ex; info.textContent = '=' + pick; $$('.fx-item', list).forEach(x => x.setAttribute('aria-selected', String(x === b))); });
      list.addEventListener('dblclick', e => { if (e.target.closest('.fx-item')) $('.dlg-actions .btn-primary', dlg).click(); });
      paint();
      return { collect: () => pick };
    },
  });
  return r.value === 'ok' ? r.data : null;
}

// ---------------------------------------------------------------- Pivot-Tabelle
export async function pivotDialog(api, existing = null) {
  const wb = api.wb;
  const srcSh = existing ? wb.sheets.find(s => s.name === existing.src) || api.sh : api.sh;
  const rg = existing ? parseRange(existing.range) : api.dataRange();
  if (!rg || rg.r2 <= rg.r1) { toast('Markiere eine Tabelle mit Überschriften (mindestens zwei Zeilen).', 'info'); return; }
  const fields = [];
  for (let c = rg.c1; c <= rg.c2; c++) fields.push({ c, name: displayOf(getCell(srcSh, rg.r1, c)) || `Spalte ${colName(c)}` });
  const numCol = fields.find(f => { for (let rr = rg.r1 + 1; rr <= Math.min(rg.r2, rg.r1 + 20); rr++) if (typeof valueAt(srcSh, rr, f.c) === 'number') return true; return false; });
  const textCol = fields.find(f => f !== numCol) || fields[0];
  const d0 = existing ? existing.def : { rows: [textCol.c], cols: [], vals: [{ c: (numCol || fields[fields.length - 1]).c, agg: numCol ? 'sum' : 'count' }], filters: [] };
  const fieldOpts = (sel, empty) => `${empty ? `<option value="">${empty}</option>` : ''}${fields.map(f => `<option value="${f.c}" ${sel === f.c ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}`;
  const r = await openDialog({
    title: existing ? 'Pivot-Tabelle bearbeiten' : 'Pivot-Tabelle erstellen', wide: true,
    body: `<div class="pv-dlg"><p class="small">Quelle: ${esc(srcSh.name)}!${esc(rangeStr(rg))} · ${rg.r2 - rg.r1} Datensätze</p>
      <div class="field-row"><label class="field"><span class="field-label">Zeilen</span><select class="select" name="row1">${fieldOpts(d0.rows[0])}</select></label>
      <label class="field"><span class="field-label">2. Zeilenfeld</span><select class="select" name="row2">${fieldOpts(d0.rows[1], '—')}</select></label></div>
      <label class="field"><span class="field-label">Spalten</span><select class="select" name="col">${fieldOpts(d0.cols[0], '— (keine)')}</select></label>
      <div class="pv-vals"></div>
      <button type="button" class="btn btn-ghost btn-sm" data-addval>${oicon('plus')} Wertfeld hinzufügen</button>
      <div class="field-row"><label class="field"><span class="field-label">Filter</span><select class="select" name="ff">${fieldOpts(d0.filters[0] && d0.filters[0].c, '— (keiner)')}</select></label>
      <div class="field pv-fvals"><span class="field-label">Nur diese Werte</span><div class="af-list pv-flist"></div></div></div></div>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: existing ? 'Aktualisieren' : 'Erstellen', value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => {
      const vbox = $('.pv-vals', dlg);
      const addVal = v => {
        const el = h(`<div class="field-row pv-val"><label class="field"><span class="field-label">Werte</span><select class="select" data-vc>${fieldOpts(v.c)}</select></label><label class="field"><span class="field-label">Berechnung</span><select class="select" data-agg>${PIVOT_AGG.map(a => `<option value="${a.id}" ${a.id === v.agg ? 'selected' : ''}>${a.label}</option>`).join('')}</select></label></div>`);
        vbox.appendChild(el);
      };
      d0.vals.forEach(addVal);
      $('[data-addval]', dlg).addEventListener('click', () => { if ($$('.pv-val', vbox).length < 4) addVal({ c: (numCol || fields[0]).c, agg: 'sum' }); });
      const flist = $('.pv-flist', dlg), ff = $('[name=ff]', dlg);
      const paintF = () => {
        const c = ff.value === '' ? null : +ff.value;
        $('.pv-fvals', dlg).hidden = c === null;
        if (c === null) { flist.innerHTML = ''; return; }
        const vals = new Set();
        for (let rr = rg.r1 + 1; rr <= rg.r2; rr++) vals.add(api.keyLabel(valueAt(srcSh, rr, c), srcSh, rr, c));
        const chosen = d0.filters[0] && d0.filters[0].c === c ? new Set(d0.filters[0].values) : null;
        flist.innerHTML = [...vals].sort((a, b) => a.localeCompare(b, 'de', { numeric: true })).map(v => `<label class="check af-item"><input type="checkbox" value="${esc(v)}" ${!chosen || chosen.has(v) ? 'checked' : ''}> <span>${esc(v)}</span></label>`).join('');
      };
      ff.addEventListener('change', paintF); paintF();
      return {
        collect: () => {
          const rows = [+$('[name=row1]', dlg).value];
          if ($('[name=row2]', dlg).value !== '' && +$('[name=row2]', dlg).value !== rows[0]) rows.push(+$('[name=row2]', dlg).value);
          const cols = $('[name=col]', dlg).value === '' ? [] : [+$('[name=col]', dlg).value];
          const vals = $$('.pv-val', vbox).map(el => ({ c: +$('[data-vc]', el).value, agg: $('[data-agg]', el).value }));
          const filters = ff.value === '' ? [] : [{ c: +ff.value, values: $$('input', flist).filter(x => x.checked).map(x => x.value) }];
          return { rows, cols, vals, filters };
        },
      };
    },
  });
  if (r.value !== 'ok' || !r.data) return;
  const def = r.data;
  const spec = { src: srcSh.name, range: rangeStr(rg), def };
  api.buildPivot(spec, existing ? api.sh : null);
}
/** Values grid of a pivot spec (used by build + refresh). */
export function pivotGrid(api, spec) {
  const srcSh = api.wb.sheets.find(s => s.name === spec.src);
  const rg = parseRange(spec.range);
  if (!srcSh || !rg) return null;
  const data = [];
  for (let rr = rg.r1; rr <= rg.r2; rr++) { const row = []; for (let c = 0; c <= rg.c2; c++) row[c] = c >= rg.c1 ? valueAt(srcSh, rr, c) : null; data.push(row); }
  return computePivot(data, spec.def, (v, c) => api.keyLabel(v, srcSh, null, c));
}

// ---------------------------------------------------------------- Reihe ausfüllen
export async function seriesDialog(api) {
  const sh = api.sh;
  const [r1, r2, c1, c2] = api.bounds();
  const start = valueAt(sh, r1, c1);
  const isDate = typeof start === 'number' && /^(date|time)$/.test(formatKind((getCell(sh, r1, c1) || {}).s && getCell(sh, r1, c1).s.fmt));
  const r = await openDialog({
    title: 'Reihe ausfüllen',
    body: `<div class="field-row"><label class="field"><span class="field-label">Richtung</span><select class="select" name="dir"><option value="down" ${r2 > r1 || c1 === c2 ? 'selected' : ''}>Nach unten (Spalten)</option><option value="right" ${c2 > c1 && r1 === r2 ? 'selected' : ''}>Nach rechts (Zeilen)</option></select></label>
      <label class="field"><span class="field-label">Typ</span><select class="select" name="type"><option value="linear" ${isDate ? '' : 'selected'}>Linear</option><option value="growth">Geometrisch</option><option value="date" ${isDate ? 'selected' : ''}>Datum</option></select></label></div>
      <div class="field-row"><label class="field"><span class="field-label">Startwert</span><input class="input" name="start" value="${esc(typeof start === 'number' ? (isDate ? formatValue(start, 'dd.mm.yyyy') : String(start).replace('.', ',')) : '1')}"></label>
      <label class="field"><span class="field-label">Schrittweite</span><input class="input" name="step" value="1"></label></div>
      <div class="field-row"><label class="field"><span class="field-label">Endwert (optional)</span><input class="input" name="stop"></label>
      <label class="field"><span class="field-label">Zeiteinheit</span><select class="select" name="unit"><option value="day">Tag</option><option value="weekday">Wochentag (Mo–Fr)</option><option value="month">Monat</option><option value="year">Jahr</option></select></label></div>
      <label class="field"><span class="field-label">Anzahl Zellen</span><input class="input" type="number" name="count" min="1" max="100000" value="${Math.max(r2 - r1, c2 - c1) + 1 > 1 ? Math.max(r2 - r1, c2 - c1) + 1 : 10}"></label>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Ausfüllen', value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => { const v = n => $(`[name=${n}]`, dlg).value; return { collect: () => ({ dir: v('dir'), type: v('type'), start: v('start'), step: v('step'), stop: v('stop'), unit: v('unit'), count: +v('count') || 10 }) }; },
  });
  if (r.value !== 'ok' || !r.data) return;
  const d = r.data;
  const toN = t => { const p = parseInput(String(t).trim()); return typeof p.v === 'number' ? p.v : null; };
  const st = toN(d.start), step = toN(d.step) ?? 1, stop = d.stop.trim() ? toN(d.stop) : null;
  if (st === null) { toast('Bitte gib einen Startwert ein.', 'error'); return; }
  const vals = makeSeries(st, step, Math.min(100000, d.count), { type: d.type, unit: d.unit, stop });
  if (!api.guard()) return;
  api.pushUndo();
  const fmt = d.type === 'date' ? ((getCell(sh, r1, c1) || {}).s || {}).fmt || 'dd.mm.yyyy' : null;
  const cells = [];
  vals.forEach((v, i) => {
    const rr = d.dir === 'down' ? r1 + i : r1, cc = d.dir === 'down' ? c1 : c1 + i;
    const cur = getCell(sh, rr, cc);
    setCell(sh, rr, cc, { v, ...(cur && cur.s ? { s: { ...cur.s, ...(fmt ? { fmt } : {}) } } : fmt ? { s: { fmt } } : {}) });
    cells.push({ r: rr, c: cc });
  });
  api.changed({ cells });
  toast(`${vals.length} Werte ausgefüllt`, 'success');
}

// ---------------------------------------------------------------- Zeilenhöhe / Spaltenbreite
export async function sizeDialog(kind, value) {
  const isRow = kind === 'row';
  const r = await openDialog({
    title: isRow ? 'Zeilenhöhe' : 'Spaltenbreite',
    body: `<label class="field"><span class="field-label">${isRow ? 'Höhe in Punkt (Standard 15)' : 'Breite in Zeichen (Standard 12)'}</span><input class="input" type="number" name="v" min="${isRow ? 4 : 1}" max="${isRow ? 400 : 255}" step="0.5" value="${value}" autofocus></label>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'OK', value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => ({ collect: () => parseFloat($('[name=v]', dlg).value) }),
  });
  return r.value === 'ok' && Number.isFinite(r.data) ? r.data : null;
}

export { CELL_STYLES, addr, parseRangeAddr, setCell, newSheet };
