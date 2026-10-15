// Tool: organize PDF pages – drag to reorder (long-press on phones), rotate, delete, duplicate, insert
// blank pages or pages of other PDFs, reverse, undo/redo. Several PDFs can be mixed page by page.
// The result is built in place in the first PDF, so bookmarks, links and forms of kept pages survive.
import { loadPdfLib } from '../lib/pdf.js';
import { el } from '../lib/dom.js';
import { PageGrid, ThumbSource, loadGridCss, toolbar, moveIds, haptic } from '../lib/pagegrid.js';
import { rearrange, saveLike, pdfBlob, userError, inputHint, norm } from '../lib/org-common.js';

const SIZES = [72, 92, 120, 160, 210];
let S = null; // stage state

function snapshot() { return S.items.map(it => ({ ...it })); }
function commit(next, { keepSel = true } = {}) {
  S.undo.push(snapshot());
  if (S.undo.length > 150) S.undo.shift();
  S.redo.length = 0;
  setItems(next, keepSel);
}
function setItems(next, keepSel = true) {
  S.items = next;
  const first = next.find(it => it.src)?.src.f;
  S.moved = next.some((it, i) => !it.src || it.src.f !== first || it.src.p !== i);
  S.grid.setItems(next);
  if (!keepSel) S.grid.setSelected([]);
  store();
  sync();
}
function store() {
  S.values.layout = S.items.map(it => (it.src ? { f: it.src.f, p: it.src.p, r: it.rot || 0 } : { b: it.size, r: it.rot || 0 }));
}
let seq = 0;
const newId = src => `${src ? `${src.f}:${src.p}` : 'blank'}#${++seq}`;

function sel() { return S.items.filter(it => S.grid.selected.has(it.id)); }
function targetsOr(item) { return item && !S.grid.selected.has(item.id) ? [item] : sel(); }

function rotate(list, deg) {
  if (!list.length) return;
  const ids = new Set(list.map(it => it.id));
  commit(S.items.map(it => (ids.has(it.id) ? { ...it, rot: norm((it.rot || 0) + deg) } : it)));
}
function remove(list) {
  if (!list.length) return;
  const ids = new Set(list.map(it => it.id));
  const next = S.items.filter(it => !ids.has(it.id));
  if (!next.length) { S.status(S.t({ de: 'Mindestens eine Seite muss bleiben.', en: 'At least one page has to stay.' }), true); return; }
  commit(next, { keepSel: false });
  S.grid.say(S.t({ de: `${list.length} ${list.length === 1 ? 'Seite' : 'Seiten'} gelöscht – Rückgängig ist möglich`, en: `${list.length} ${list.length === 1 ? 'page' : 'pages'} deleted – you can undo` }));
}
function duplicate(list) {
  if (!list.length) return;
  const ids = new Set(list.map(it => it.id));
  const next = [];
  const copies = [];
  for (const it of S.items) {
    next.push(it);
    if (ids.has(it.id)) { const c = { ...it, id: newId(it.src) }; next.push(c); copies.push(c.id); }
  }
  commit(next);
  S.grid.setSelected(copies);
  sync();
}
function move(dir) {
  const list = sel();
  if (!list.length) return;
  const first = S.items.indexOf(list[0]), last = S.items.indexOf(list[list.length - 1]);
  const before = dir < 0 ? Math.max(0, first - 1) : Math.min(S.items.length, last + 2);
  commit(moveIds(S.items, list.map(it => it.id), before));
  S.grid.scrollToId(list[0].id);
}
function displaySize(it) {
  const s = it.src ? S.thumbs.size(it.src) : it.size;
  if (!s) return [595.28, 841.89];
  return (it.rot || 0) % 180 ? [s[1], s[0]] : [s[0], s[1]];
}
function insertBlank() {
  const list = sel();
  const ref = list.length ? list[list.length - 1] : S.items[S.items.length - 1];
  const at = ref ? S.items.indexOf(ref) + 1 : 0;
  const size = ref ? displaySize(ref).map(v => Math.round(v * 100) / 100) : [595.28, 841.89];
  const blank = { id: newId(null), src: null, size, rot: 0 };
  const next = S.items.slice();
  next.splice(at, 0, blank);
  commit(next);
  S.grid.setSelected([blank.id]);
  S.grid.scrollToId(blank.id);
  sync();
}
function reverse() {
  const list = sel();
  if (list.length > 1) {
    const idx = list.map(it => S.items.indexOf(it));
    const next = S.items.slice();
    const rev = list.slice().reverse();
    idx.forEach((i, k) => { next[i] = rev[k]; });
    commit(next);
  } else commit(S.items.slice().reverse());
}
function undo() { if (!S.undo.length) return; S.redo.push(snapshot()); setItems(S.undo.pop()); haptic(6); }
function redo() { if (!S.redo.length) return; S.undo.push(snapshot()); setItems(S.redo.pop()); haptic(6); }
function zoom(d) {
  S.size = Math.max(0, Math.min(SIZES.length - 1, S.size + d));
  S.grid.setSize(SIZES[S.size]);
  try { localStorage.setItem('fale-wt-pgsize', String(S.size)); } catch { /* private mode */ }
  sync();
}
function insertPdf() {
  const list = sel();
  S.insertAt = list.length ? S.items.indexOf(list[list.length - 1]) + 1 : S.items.length;
  document.querySelector('[data-wt-input]')?.click();
}

function sync() {
  if (!S) return;
  const de = S.lang === 'de';
  const n = S.items.length, k = S.grid.selected.size;
  S.tb.info.replaceChildren(
    k ? (de ? `${k} ausgewählt` : `${k} selected`) : (de ? `${n} ${n === 1 ? 'Seite' : 'Seiten'}` : `${n} ${n === 1 ? 'page' : 'pages'}`),
    el('small', {}, k ? (de ? `von ${n} Seiten` : `of ${n} pages`) : (de ? 'Antippen zum Auswählen, gedrückt halten zum Verschieben' : 'Tap to select, press and hold to move')),
  );
  S.tb.bar.classList.toggle('is-active', k > 0);
  for (const id of ['rotl', 'rotr', 'del', 'dup', 'left', 'right']) S.tb.btn(id).hidden = !k;
  for (const id of ['all']) S.tb.btn(id).hidden = !!k;
  S.tb.btn('none').hidden = !k;
  S.tb.btn('undo').disabled = !S.undo.length;
  S.tb.btn('redo').disabled = !S.redo.length;
  S.tb.btn('zin').disabled = S.size >= SIZES.length - 1;
  S.tb.btn('zout').disabled = S.size <= 0;
  if (k) {
    const list = sel();
    S.tb.btn('left').disabled = S.items.indexOf(list[0]) === 0 && list.every((it, i) => S.items[i] === it);
    S.tb.btn('right').disabled = S.items.indexOf(list[list.length - 1]) === n - 1 && list.every((it, i) => S.items[n - list.length + i] === it);
  }
  S.side.btn('rev').setAttribute('aria-label', k > 1 ? (de ? 'Reihenfolge der Auswahl umkehren' : 'Reverse the selected pages') : (de ? 'Reihenfolge umkehren' : 'Reverse order'));
  S.status('');
}

export default {
  options: [],

  mountStage(host, state, ctx) {
    const t = ctx.t;
    S = { values: state.values, lang: ctx.lang, t, items: [], undo: [], redo: [], inputs: new Map(), insertAt: null, size: 1 };
    try { const v = +localStorage.getItem('fale-wt-pgsize'); if (v >= 0 && v < SIZES.length && localStorage.getItem('fale-wt-pgsize') !== null) S.size = v; } catch { /* private mode */ }
    state.values.layout = [];
    loadGridCss();
    S.thumbs = new ThumbSource({ width: 210 });
    const wrap = el('div', { class: 'pg-stage', hidden: true });
    host.append(wrap);
    S.wrap = wrap;
    S.tb = toolbar([
      { id: 'all', icon: 'all', label: t({ de: 'Alle auswählen', en: 'Select all' }), short: t({ de: 'Alle', en: 'All' }), compact: true, onClick: () => { S.grid.setSelected(S.items.map(it => it.id)); sync(); } },
      { id: 'rotl', icon: 'rotl', label: t({ de: 'Auswahl nach links drehen', en: 'Rotate selection left' }), onClick: () => rotate(sel(), -90) },
      { id: 'rotr', icon: 'rotr', label: t({ de: 'Auswahl nach rechts drehen', en: 'Rotate selection right' }), onClick: () => rotate(sel(), 90) },
      { id: 'left', icon: 'left', label: t({ de: 'Auswahl nach vorne verschieben', en: 'Move selection forward' }), onClick: () => move(-1) },
      { id: 'right', icon: 'right', label: t({ de: 'Auswahl nach hinten verschieben', en: 'Move selection back' }), onClick: () => move(1) },
      { id: 'dup', icon: 'copy', label: t({ de: 'Auswahl duplizieren', en: 'Duplicate selection' }), onClick: () => duplicate(sel()) },
      { id: 'del', icon: 'trash', label: t({ de: 'Auswahl löschen', en: 'Delete selection' }), short: t({ de: 'Löschen', en: 'Delete' }), danger: true, compact: true, onClick: () => remove(sel()) },
      { id: 'none', icon: 'none', label: t({ de: 'Auswahl aufheben', en: 'Clear selection' }), onClick: () => { S.grid.setSelected([]); sync(); } },
      { id: 'undo', icon: 'undo', label: t({ de: 'Rückgängig', en: 'Undo' }), onClick: undo },
      { id: 'redo', icon: 'redo', label: t({ de: 'Wiederholen', en: 'Redo' }), onClick: redo },
      { id: 'zout', icon: 'minus', label: t({ de: 'Kleinere Vorschau', en: 'Smaller thumbnails' }), onClick: () => zoom(-1) },
      { id: 'zin', icon: 'plus', label: t({ de: 'Größere Vorschau', en: 'Larger thumbnails' }), onClick: () => zoom(1) },
    ]);
    wrap.append(S.tb.bar);
    S.grid = new PageGrid(wrap, {
      lang: ctx.lang, mode: 'organize', thumbs: S.thumbs,
      ariaLabel: t({ de: 'Seiten – antippen zum Auswählen, gedrückt halten zum Verschieben', en: 'Pages – tap to select, press and hold to move' }),
      label: (item, i) => String(i + 1),
      sub: item => {
        const parts = [];
        if (item.src && S.inputs.size > 1) parts.push(S.inputs.get(item.src.f)?.tag || '');
        if (item.src && S.moved) parts.push(t({ de: `S. ${item.src.p + 1}`, en: `p. ${item.src.p + 1}` }));
        if (!item.src) parts.push(t({ de: 'leer', en: 'blank' }));
        if (item.rot) parts.push(`${item.rot}°`);
        return parts.filter(Boolean).join(' · ') || null;
      },
      cardTools: [{ id: 'rot', icon: 'rotr', label: (item, i) => t({ de: `Seite ${i + 1} drehen`, en: `Rotate page ${i + 1}` }) }],
      onTool: (id, item) => rotate([item], 90),
      onSelect: sync,
      onMove: (ids, before) => commit(moveIds(S.items, ids, before)),
      onKey: (action, item) => (action === 'delete' ? remove(targetsOr(item)) : rotate(targetsOr(item), action === 'rotl' ? -90 : 90)),
    });
    S.grid.setSize(SIZES[S.size]);
    S.grid.setMaxHeight('min(76vh, 900px)');
    S.side = toolbar([
      { id: 'pdf', icon: 'insert', label: t({ de: 'Seiten aus einer anderen PDF einfügen', en: 'Insert pages from another PDF' }), short: t({ de: 'PDF einfügen', en: 'Insert PDF' }), onClick: insertPdf },
      { id: 'blank', icon: 'blank', label: t({ de: 'Leere Seite einfügen (nach der Auswahl)', en: 'Insert a blank page (after the selection)' }), short: t({ de: 'Leere Seite', en: 'Blank page' }), onClick: insertBlank },
      { id: 'rev', icon: 'reverse', label: t({ de: 'Reihenfolge umkehren', en: 'Reverse order' }), short: t({ de: 'Umkehren', en: 'Reverse' }), onClick: reverse },
    ], { cls: 'pg-bar-plain' });
    S.side.info.remove();
    const status = el('p', { class: 'pg-status', role: 'status' });
    S.status = (text, warn = false) => { status.textContent = text; status.classList.toggle('is-warn', warn); };
    wrap.append(S.side.bar, status, el('p', { class: 'pg-hint' }, t({
      de: 'Handy: Seite kurz gedrückt halten und ziehen. Computer: ziehen mit der Maus; Pfeiltasten wählen, Strg + Pfeil verschiebt, R dreht, Entf löscht, Strg + Z macht rückgängig.',
      en: 'Phone: press and hold a page, then drag. Computer: drag with the mouse; arrow keys move the focus, Ctrl + arrow moves the page, R rotates, Delete removes, Ctrl + Z undoes.',
    })));
    wrap.addEventListener('keydown', e => {
      if (!(e.ctrlKey || e.metaKey) || e.target.closest('input, textarea')) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); } else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    });
    sync();
  },

  async onInputs(inputs) {
    if (!S) return;
    await loadGridCss();
    const pdfs = inputs.filter(i => i.kind === 'pdf' && !i.locked && !i.error);
    const ids = new Set(pdfs.map(i => i.id));
    // removed files → their pages go (part of undo history)
    let next = S.items.filter(it => !it.src || ids.has(it.src.f));
    for (const id of [...S.inputs.keys()]) if (!ids.has(id)) { S.inputs.delete(id); S.thumbs.dropInput(id); }
    const fresh = pdfs.filter(i => !S.inputs.has(i.id));
    const added = [];
    for (const input of fresh) {
      const n = await input.pageCount();
      S.inputs.set(input.id, { input, tag: '' });
      S.thumbs.addInput(input);
      for (let p = 0; p < n; p++) added.push({ id: newId({ f: input.id, p }), src: { f: input.id, p }, rot: 0 });
    }
    // short tags A, B, C … when pages of several files are mixed
    [...S.inputs.values()].forEach((v, i) => { v.tag = i < 26 ? String.fromCharCode(65 + i) : `#${i + 1}`; });
    if (added.length) {
      const at = S.insertAt != null && S.items.length ? Math.min(S.insertAt, next.length) : next.length;
      next = next.slice();
      next.splice(at, 0, ...added);
      S.insertAt = null;
    }
    const changed = next.length !== S.items.length || next.some((it, i) => it !== S.items[i]);
    if (changed) {
      if (S.items.length) commit(next); else setItems(next);
      if (added.length && S.items.length !== added.length) { S.grid.setSelected(added.map(a => a.id)); S.grid.scrollToId(added[0].id); sync(); }
    }
    S.wrap.hidden = !S.items.length;
    S.grid.refresh();
    // page sizes in the background (blank pages take the size of their neighbour)
    for (const it of added) { try { await S.thumbs.pageSize(it.src); } catch { break; } }
    S.grid.refresh();
  },

  async run(inputs, opts, ctx) {
    const layout = opts.layout || [];
    if (!layout.length) throw inputHint('Es sind keine Seiten übrig.', 'There are no pages left.');
    const PDFLib = await loadPdfLib();
    const byId = new Map(inputs.map(i => [i.id, i]));
    const baseId = (layout.find(l => l.f && byId.has(l.f)) || {}).f || inputs.find(i => i.kind === 'pdf')?.id;
    const baseInput = byId.get(baseId);
    if (!baseInput) throw userError('Bitte wähle zuerst eine PDF aus.', 'Please choose a PDF first.');
    ctx.progress(0.1, { de: 'Seiten werden zusammengestellt …', en: 'Arranging pages …' });
    const doc = await baseInput.pdfDoc();
    const basePages = doc.getPages();
    const foreign = new Map(); // inputId → Map(srcPage → PDFPage copied into doc)
    const others = [...new Set(layout.filter(l => l.f && l.f !== baseId).map(l => l.f))];
    for (let k = 0; k < others.length; k++) {
      const input = byId.get(others[k]);
      if (!input) continue;
      ctx.progress(0.1 + 0.4 * (k / others.length), { de: `Seiten aus ${input.name} …`, en: `Pages from ${input.name} …` });
      const src = await input.pdfDoc();
      const need = [...new Set(layout.filter(l => l.f === input.id).map(l => l.p))];
      const copied = await doc.copyPages(src, need);
      foreign.set(input.id, new Map(need.map((p, i) => [p, copied[i]])));
      await ctx.tick();
    }
    const spec = [];
    for (const l of layout) {
      if (l.b) spec.push({ blank: l.b, rot: l.r });
      else if (l.f === baseId) { if (basePages[l.p]) spec.push({ page: basePages[l.p], rot: l.r }); }
      else { const pg = foreign.get(l.f)?.get(l.p); if (pg) spec.push({ page: pg, rot: l.r }); }
    }
    if (!spec.length) throw inputHint('Es sind keine Seiten übrig.', 'There are no pages left.');
    ctx.progress(0.6, { de: 'Wird gespeichert …', en: 'Saving …' });
    await ctx.tick();
    rearrange(doc, PDFLib, spec);
    const bytes = await saveLike(doc, baseInput, ctx);
    if (others.length) ctx.note({ de: 'Lesezeichen und Formularfelder werden aus der ersten PDF übernommen.', en: 'Bookmarks and form fields are taken from the first PDF.' });
    return { outputs: [{ name: ctx.fileName(baseInput.name, ctx.lang === 'de' ? ' (sortiert)' : ' (organized)', 'pdf'), blob: pdfBlob(bytes), pages: spec.length }] };
  },
};

