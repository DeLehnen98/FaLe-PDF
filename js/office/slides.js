// Präsentationen: open .pptx, create/edit simple presentations, slideshow, save .pptx, export PDF.
import * as db from '../db.js';
import { $, $$, h, esc, toast, errorToast, showMenu, pickFiles, downloadBlob, shareBlob, confirmDialog, openDialog, debounce } from '../ui.js';
import { createShell, exportPdfFlow, tb } from './shell.js';
import { officeMenu, oicon, KINDS, stripExt } from './kinds.js';
import { slideHtml, slidePreview, textHtml, PPI, elementDom } from './slide-render.js';
import { SLIDE_THEMES, SLIDE_LAYOUTS } from './templates.js';
import { fileToDataUrl } from './vendor.js';
import { enableDragReorder, moveItem } from '../components.js';

// ---------------- new presentations ----------------
const R = (text, size, color, extra = {}) => ({ text, size, color, font: extra.font || 'Arial', b: !!extra.b, i: !!extra.i });
function textEl(role, x, y, w, h, paras, opts = {}) {
  return { type: 'shape', geom: 'rect', role, x, y, w, h, fill: null, line: null, text: { paras, anchor: opts.anchor || 't', ins: [0.1, 0.05, 0.1, 0.05], wrap: true } };
}
export function makeSlide(layout, theme, W = 13.333, H = 7.5) {
  const t = theme;
  const els = [];
  const title = (txt, y = 0.45, hgt = 1.15, size = 34) => textEl('title', 0.75, y, W - 1.5, hgt, [{ align: 'l', level: 0, runs: [R(txt, size, t.title, { b: true, font: t.font })] }], { anchor: 'b' });
  const body = (x, w, lines = ['Erster Punkt', 'Zweiter Punkt', 'Dritter Punkt']) => textEl('body', x, 1.85, w, H - 2.5, lines.map(l => ({ align: 'l', level: 0, bullet: { char: '•' }, runs: [R(l, 20, t.text, { font: t.font })] })));
  if (layout === 'title') {
    els.push(textEl('title', 0.9, H * 0.3, W - 1.8, 1.7, [{ align: 'l', level: 0, runs: [R('Titel der Präsentation', 44, t.title, { b: true, font: t.font })] }], { anchor: 'b' }));
    els.push(textEl('sub', 0.9, H * 0.3 + 1.85, W - 1.8, 1.0, [{ align: 'l', level: 0, runs: [R('Untertitel · Name · Datum', 22, t.text, { font: t.font })] }]));
  } else if (layout === 'title-text') {
    els.push(title('Überschrift'), body(0.75, W - 1.5));
  } else if (layout === 'title-image') {
    els.push(title('Überschrift'));
    els.push({ type: 'image', role: 'image', x: 0.75, y: 1.85, w: W - 1.5, h: H - 2.5, src: null });
  } else if (layout === 'two-col') {
    els.push(title('Überschrift'), body(0.75, (W - 1.8) / 2, ['Linke Spalte', 'Punkt']), body(0.75 + (W - 1.8) / 2 + 0.3, (W - 1.8) / 2, ['Rechte Spalte', 'Punkt']));
  }
  const slide = { layout, bg: { color: t.bg }, els };
  applyDecor(slide, t, W, H);
  return slide;
}

function applyDecor(slide, t, W, H) {
  slide.els = slide.els.filter(e => e.role !== 'decor');
  const d = [];
  const isTitle = slide.layout === 'title';
  if (t.id === 'indigo') {
    if (isTitle) d.push({ x: 0.9, y: H * 0.3 - 0.35, w: 1.4, h: 0.12 });
    else d.push({ x: 0, y: 0.55, w: 0.22, h: 0.95 });
  } else if (t.id === 'papier') {
    d.push(isTitle ? { x: 0, y: H - 0.35, w: W, h: 0.35 } : { x: 0.85, y: 1.62, w: 1.2, h: 0.07 });
  } else if (t.id === 'koralle') {
    d.push({ geom: 'ellipse', x: W - (isTitle ? 3.6 : 1.9), y: isTitle ? -1.4 : -0.9, w: isTitle ? 5 : 2.8, h: isTitle ? 5 : 2.8 });
  } else if (t.id === 'wald') {
    d.push({ x: 0, y: H - 0.18, w: W, h: 0.18 });
    if (isTitle) d.push({ x: 0.9, y: H * 0.3 - 0.35, w: 0.9, h: 0.1 });
  }
  slide.els.unshift(...d.map(x => ({ type: 'shape', geom: x.geom || 'rect', role: 'decor', locked: true, x: x.x, y: x.y, w: x.w, h: x.h, fill: t.accent, line: null })));
}

export function applyTheme(pres, theme) {
  pres.theme = theme.id;
  for (const s of pres.slides) {
    s.bg = { color: theme.bg };
    for (const e of s.els) {
      if (!e.text) continue;
      const col = e.role === 'title' ? theme.title : theme.text;
      e.text.paras.forEach(p => p.runs.forEach(r => { r.color = col; r.font = theme.font; }));
    }
    applyDecor(s, theme, pres.w, pres.h);
  }
}

export function newPresentation(themeId = 'indigo') {
  const theme = SLIDE_THEMES.find(t => t.id === themeId) || SLIDE_THEMES[0];
  return { w: 13.333, h: 7.5, theme: theme.id, slides: [makeSlide('title', theme), makeSlide('title-text', theme)] };
}

/** Hand-over of a freshly generated presentation (e.g. „Folien aus Gliederung“) to the editor. */
export const slideHandoff = { pres: null, name: null };

const clone = o => (Array.isArray(o) ? o.map(clone) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, clone(v)])) : o);

// ---------------- editor ----------------
export async function mountSlides(screen, { id = null, template = null }) {
  let pres, name = 'Neue Präsentation.pptx';
  screen.body.innerHTML = '<div class="v-loading"><div><span class="spinner dark" style="width:30px;height:30px"></span><span data-load>Präsentation wird geöffnet …</span></div></div>';
  if (id) {
    const meta = await db.getDoc(id);
    if (!meta) throw Object.assign(new Error('missing'), { userMessage: 'Präsentation nicht gefunden.' });
    name = meta.name;
    const blob = await db.getFile(id);
    const lbl = $('[data-load]', screen.body);
    pres = await (await import('./pptx-read.js')).readPptx(await blob.arrayBuffer(), name, { onProgress: p => { if (lbl) lbl.textContent = `Präsentation wird geöffnet … ${Math.round(p * 100)} %`; } });
    db.updateDoc(id, { openedAt: Date.now() }).catch(() => {});
  } else if (template === '__outline' && slideHandoff.pres) {
    pres = slideHandoff.pres; name = `${slideHandoff.name || 'Präsentation'}.pptx`;
    slideHandoff.pres = null;
  } else pres = newPresentation(template || 'indigo');
  const fromOutline = !id && template === '__outline';
  if (screen.signal.aborted) return;

  let cur = 0, selIdx = -1, editingEl = null;
  const undo = [], redo = [];
  const theme = () => SLIDE_THEMES.find(t => t.id === pres.theme) || null;

  const shell = createShell(screen, {
    id, name, kind: 'pptx',
    serialize: async () => { commitEdit(); return (await import('./pptx-write.js')).presToPptx(pres, { title: stripExt(shell.name) }); },
    menu: () => [
      { label: 'Präsentieren', icon: 'present', onClick: () => slideshow(cur) },
      { label: 'Referentenansicht', icon: 'presenter', onClick: () => presenter(cur) },
      { label: 'Als PDF exportieren', icon: 'kpdf', onClick: exportPdf },
      { label: 'Handzettel / Notizen als PDF …', icon: 'handout', onClick: handoutDialog },
      { label: 'PowerPoint-Datei (.pptx) herunterladen', icon: 'download', onClick: async () => { try { downloadBlob(await (await import('./pptx-write.js')).presToPptx(pres, { title: stripExt(shell.name) }), stripExt(shell.name) + '.pptx'); } catch (e) { errorToast(e, 'Export fehlgeschlagen.'); } } },
      '-',
      { label: 'Design wechseln', icon: 'sparkle', onClick: () => pickTheme() },
      { label: 'Folien aus Gliederung …', icon: 'kslides', onClick: () => { location.hash = '#/gliederung'; } },
      { label: 'Teilen', icon: 'share', onClick: async () => shareBlob(await (await import('./pptx-write.js')).presToPptx(pres, { title: stripExt(shell.name) }), shell.name, KINDS.pptx.mime) },
      { label: 'Kopie speichern unter …', icon: 'copy', onClick: () => shell.save({ asCopy: true }) },
      { label: 'Umbenennen', icon: 'edit', onClick: () => shell.rename() },
    ],
  });
  async function exportPdf() {
    commitEdit();
    const { presToPdf } = await import('./slide-render.js');
    await exportPdfFlow(shell.name, onP => presToPdf(pres, { title: stripExt(shell.name), onProgress: onP }));
  }

  screen.body.innerHTML = '';
  screen.body.classList.add('office-body');
  const root = h(`<div class="slides-app">
    <div class="office-toolbar" role="toolbar" aria-label="Folienwerkzeuge">
      <div class="tb-group">${tb('undo', 'Rückgängig', 'data-a="undo"')}${tb('redo', 'Wiederholen', 'data-a="redo"')}</div>
      <div class="tb-group">${tb('slideAdd', 'Neue Folie', 'data-a="add"')}${tb('copy', 'Folie duplizieren', 'data-a="dup"')}${tb('trash', 'Folie löschen', 'data-a="del"')}</div>
      <div class="tb-group">${tb('textbox', 'Textfeld einfügen', 'data-a="text"')}${tb('image', 'Bild einfügen', 'data-a="image"')}${tb('shape', 'Form einfügen', 'data-a="shape"')}</div>
      <div class="tb-group el-tools">${tb('bold', 'Fett', 'data-a="bold"')}${tb('italic', 'Kursiv', 'data-a="italic"')}${tb('underline', 'Unterstrichen', 'data-a="underline"')}${tb('fontUp', 'Schrift größer', 'data-a="grow"')}${tb('fontDown', 'Schrift kleiner', 'data-a="shrink"')}
        <span class="tb-color">${tb('color', 'Farbe', 'data-a="color"')}</span>${tb('alignLeft', 'Ausrichtung', 'data-a="align"')}${tb('listUl', 'Aufzählung', 'data-a="bullets"')}${tb('arrowUp', 'Nach vorne', 'data-a="front"')}${tb('trash', 'Element löschen', 'data-a="eldel"')}</div>
      <div class="tb-group">${tb('sparkle', 'Design', 'data-a="theme"')}${tb('fill', 'Hintergrund', 'data-a="bg"')}${tb('transition', 'Übergang', 'data-a="transition"')}${tb('notes', 'Sprechernotizen', 'data-a="notes"')}</div>
      <div class="tb-group"><button class="btn btn-soft btn-sm" type="button" data-a="show">${oicon('present')}<span>Präsentieren</span></button>${tb('presenter', 'Referentenansicht (Folie, nächste Folie, Notizen, Zeit)', 'data-a="presenter"')}</div>
    </div>
    <div class="slides-main">
      <div class="slide-strip" role="listbox" aria-label="Folien"></div>
      <div class="stage-col">
        <div class="slide-stage" tabindex="-1"><div class="stage-fit"></div></div>
        <div class="slide-notes" hidden><label class="sn-label" for="slide-notes-ta">Notizen zu Folie <span data-sn>1</span></label><textarea id="slide-notes-ta" class="sn-ta" placeholder="Was möchtest du zu dieser Folie sagen? (nur in der Referentenansicht sichtbar)" spellcheck="true" lang="de-DE"></textarea></div>
      </div>
    </div>
  </div>`);
  screen.body.appendChild(root);
  const strip = $('.slide-strip', root), stage = $('.slide-stage', root), fit = $('.stage-fit', root);
  const status = h('<span class="foot-info"></span>');
  screen.foot.innerHTML = ''; screen.foot.appendChild(status); screen.foot.hidden = false; screen.foot.classList.add('office-foot');

  // ---------------- undo ----------------
  function pushUndo() { undo.push(JSON.stringify({ pres, cur })); if (undo.length > 40) undo.shift(); redo.length = 0; }
  function restore(s) { const o = JSON.parse(s); pres = o.pres; cur = Math.min(o.cur, pres.slides.length - 1); selIdx = -1; shell.markDirty(); renderAll(); }
  const doUndo = () => { commitEdit(); const s = undo.pop(); if (!s) { toast('Nichts zum Rückgängigmachen.'); return; } redo.push(JSON.stringify({ pres, cur })); restore(s); };
  const doRedo = () => { const s = redo.pop(); if (!s) return; undo.push(JSON.stringify({ pres, cur })); restore(s); };
  const dirty = () => { shell.markDirty(); refreshThumb(cur); };

  // ---------------- strip ----------------
  function renderStrip() {
    strip.innerHTML = '';
    pres.slides.forEach((s, i) => {
      const item = h(`<div class="strip-item${i === cur ? ' on' : ''}" role="option" aria-selected="${i === cur}" draggable="true" data-si="${i}">
        <span class="strip-num">${i + 1}</span><button class="strip-btn" type="button" aria-label="Folie ${i + 1}"></button></div>`);
      $('.strip-btn', item).appendChild(slidePreview(pres, s, stripW()));
      $('.strip-btn', item).addEventListener('click', () => go(i));
      item.addEventListener('contextmenu', e => { e.preventDefault(); commitEdit(); slideMenu(item, i); });
      strip.appendChild(item);
    });
    const add = h(`<button class="strip-add" type="button" aria-label="Neue Folie">${oicon('plus')}</button>`);
    add.addEventListener('click', e => addSlide(e.currentTarget));
    strip.appendChild(add);
    const on = $('.strip-item.on', strip);
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  const stripW = () => (window.matchMedia('(max-width: 720px)').matches ? 96 : 168);
  const refreshThumb = debounce(i => {
    const item = $(`.strip-item[data-si="${i}"] .strip-btn`, strip);
    if (!item || !pres.slides[i]) return;
    item.innerHTML = '';
    item.appendChild(slidePreview(pres, pres.slides[i], stripW()));
  }, 250);
  enableDragReorder(strip, '.strip-item', (from, to) => { pushUndo(); moveItem(pres.slides, from, to); cur = to; shell.markDirty(); renderAll(); });
  function slideMenu(anchor, i) {
    officeMenu(anchor, [
      { label: 'Nach oben', icon: 'arrowUp', disabled: i === 0, onClick: () => { pushUndo(); moveItem(pres.slides, i, i - 1); cur = i - 1; shell.markDirty(); renderAll(); } },
      { label: 'Nach unten', icon: 'arrowDown', disabled: i === pres.slides.length - 1, onClick: () => { pushUndo(); moveItem(pres.slides, i, i + 1); cur = i + 1; shell.markDirty(); renderAll(); } },
      { label: 'Duplizieren', icon: 'copy', onClick: () => { pushUndo(); pres.slides.splice(i + 1, 0, clone(pres.slides[i])); cur = i + 1; shell.markDirty(); renderAll(); } },
      { label: 'Löschen', icon: 'trash', danger: true, disabled: pres.slides.length < 2, onClick: () => deleteSlide(i) },
    ], { label: `Folie ${i + 1}` });
  }

  // ---------------- stage ----------------
  let scale = 1;
  function layoutStage() {
    const pad = window.matchMedia('(max-width: 720px)').matches ? 12 : 32;
    const aw = stage.clientWidth - pad * 2, ah = stage.clientHeight - pad * 2;
    scale = Math.max(0.05, Math.min(aw / (pres.w * PPI), ah / (pres.h * PPI)));
    fit.style.width = `${pres.w * PPI * scale}px`;
    fit.style.height = `${pres.h * PPI * scale}px`;
    const sl = $('.slide', fit);
    if (sl) sl.style.transform = `scale(${scale})`;
  }
  function renderStage() {
    if (editingEl) commitEdit(false);
    editingEl = null;
    const s = pres.slides[cur];
    fit.innerHTML = slideHtml(pres, s);
    const sl = $('.slide', fit);
    sl.classList.add('editing');
    $$('.el', sl).forEach(el => {
      const e = s.els[+el.dataset.i];
      if (e && e.text && !e.locked) {
        const tx = $('.tx', el);
        if (tx && !e.text.paras.some(p => p.runs.some(r => r.text.trim()))) tx.dataset.empty = e.role === 'title' ? 'Titel hinzufügen' : 'Text hinzufügen';
      }
    });
    layoutStage();
    paintSel();
    status.textContent = `Folie ${cur + 1} von ${pres.slides.length}${theme() ? ` · Design „${theme().name}“` : ''}${s.transition && s.transition !== 'none' ? ` · Übergang: ${s.transition === 'push' ? 'Schieben' : 'Überblenden'}` : ''}`;
    syncNotes();
  }
  function renderAll() { renderStrip(); renderStage(); }
  function go(i) { commitEdit(); cur = Math.max(0, Math.min(pres.slides.length - 1, i)); selIdx = -1; renderAll(); }
  stage.addEventListener('pointerdown', e => {
    if (e.target.closest('.stage-fit')) return;
    commitEdit();
    if (selIdx >= 0) { selIdx = -1; paintSel(); }
  });
  const ro = new ResizeObserver(() => layoutStage());
  ro.observe(stage);

  function elNode(i) { return $(`.slide .el[data-i="${i}"]`, fit); }
  function paintSel() {
    $$('.el.sel', fit).forEach(x => x.classList.remove('sel'));
    $$('.handle', fit).forEach(x => x.remove());
    const n = selIdx >= 0 ? elNode(selIdx) : null;
    root.classList.toggle('has-sel', !!n);
    if (!n) return;
    n.classList.add('sel');
    const hd = h(`<span class="handle" aria-hidden="true"></span>`);
    hd.style.setProperty('--inv', 1 / scale);
    n.appendChild(hd);
  }

  // pointer: select, move, resize, edit
  let drag = null;
  fit.addEventListener('pointerdown', e => {
    const elN = e.target.closest('.el');
    if (editingEl && elN && elN === editingEl.node) return; // let the caret move
    commitEdit();
    if (!elN || elN.classList.contains('locked')) { selIdx = -1; paintSel(); return; }
    const i = +elN.dataset.i;
    const s = pres.slides[cur];
    const e0 = s.els[i];
    const wasSel = selIdx === i;
    selIdx = i; paintSel();
    if (e0.type === 'image' && !e0.src) { e.preventDefault(); placeImage(i); return; }
    const resize = e.target.classList.contains('handle');
    drag = { i, x: e.clientX, y: e.clientY, ox: e0.x, oy: e0.y, ow: e0.w, oh: e0.h, resize, moved: false, wasSel, pointerId: e.pointerId };
    fit.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  fit.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = (e.clientX - drag.x) / scale / PPI, dy = (e.clientY - drag.y) / scale / PPI;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
    if (!drag.moved) { pushUndo(); drag.moved = true; }
    const el = pres.slides[cur].els[drag.i];
    if (drag.resize) { el.w = Math.max(0.2, drag.ow + dx); el.h = Math.max(0.2, drag.oh + dy); }
    else { el.x = snap(drag.ox + dx, el.w, pres.w); el.y = snap(drag.oy + dy, el.h, pres.h); }
    const n = elNode(drag.i);
    if (n) { n.style.left = `${el.x * PPI}px`; n.style.top = `${el.y * PPI}px`; n.style.width = `${el.w * PPI}px`; n.style.height = `${el.h * PPI}px`; }
  });
  const endDrag = () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.moved) { dirty(); return; }
    const el = pres.slides[cur].els[d.i];
    if (d.wasSel && el.text !== undefined && el.type === 'shape') startEdit(d.i);
  };
  fit.addEventListener('pointerup', endDrag);
  fit.addEventListener('pointercancel', () => { drag = null; });
  fit.addEventListener('dblclick', e => { const n = e.target.closest('.el'); if (n && !n.classList.contains('locked')) { const el = pres.slides[cur].els[+n.dataset.i]; if (el.type === 'shape') startEdit(+n.dataset.i); } });
  function snap(v, size, max) {
    const t = 0.08;
    for (const target of [0, (max - size) / 2, max - size]) if (Math.abs(v - target) < t) return target;
    return v;
  }

  // ---------------- text editing ----------------
  function startEdit(i) {
    const el = pres.slides[cur].els[i];
    if (!el.text) el.text = { paras: [{ align: 'l', level: 0, runs: [] }], anchor: 't', ins: [0.1, 0.05, 0.1, 0.05], wrap: true };
    const n = elNode(i);
    if (!n) return;
    let tx = $('.tx', n);
    if (!tx) { n.insertAdjacentHTML('beforeend', `<div class="tx" style="padding:${0.05 * PPI}px ${0.1 * PPI}px"></div>`); tx = $('.tx', n); }
    tx.innerHTML = textHtml(el.text).replace(/<span class="bu"[^>]*>.*?<\/span>/g, '');
    if (!tx.textContent.trim()) {
      const p = el.text.paras[0] || {};
      const r = (p.runs && p.runs[0]) || {};
      const sz = (r.size || p.endSize || (el.role === 'title' ? 34 : 20)) * PPI / 72;
      const col = r.color || (theme() ? (el.role === 'title' ? theme().title : theme().text) : '#15172F');
      tx.innerHTML = `<div class="sp"${p.bullet ? ' data-bullet="dot"' : ''} style="text-align:${{ ctr: 'center', r: 'right' }[p.align] || 'left'};padding-left:${(p.bullet ? 0.3 : 0) * PPI}px"><span style="font-size:${sz}px;color:${col};font-family:${esc(r.font || (theme() ? theme().font : 'Arial'))}${el.role === 'title' ? ';font-weight:700' : ''}"><br></span></div>`;
    }
    delete tx.dataset.empty;
    tx.contentEditable = 'true';
    tx.spellcheck = true;
    tx.setAttribute('role', 'textbox');
    tx.setAttribute('aria-label', 'Text der Folie bearbeiten');
    n.classList.add('editing-text');
    editingEl = { i, node: n, tx, before: JSON.stringify(el.text), slide: pres.slides[cur] };
    tx.focus();
    const range = document.createRange();
    range.selectNodeContents(tx); range.collapse(false);
    const s = getSelection(); s.removeAllRanges(); s.addRange(range);
    try { document.execCommand('styleWithCSS', false, true); } catch {}
  }
  function commitEdit(render = true) {
    if (!editingEl) return;
    const { i, tx, before, slide } = editingEl;
    editingEl = null;
    const el = slide.els[i];
    if (!el) return;
    const paras = domToParas(tx, el);
    const next = { ...el.text, paras };
    if (JSON.stringify(next) !== before) {
      undo.push(JSON.stringify({ pres, cur }));
      el.text = next;
      shell.markDirty();
      const si = pres.slides.indexOf(slide);
      if (si >= 0) refreshThumb(si);
    }
    if (render) renderStage();
  }
  function domToParas(tx, el) {
    const paras = [];
    const blocks = $$(':scope > .sp, :scope > div, :scope > p', tx);
    const list = blocks.length ? blocks : [tx];
    const old = el.text.paras;
    list.forEach((b, k) => {
      const runs = [];
      const walk = (node, f) => {
        for (let c = node.firstChild; c; c = c.nextSibling) {
          if (c.nodeType === 3) { if (c.nodeValue) runs.push({ text: c.nodeValue.replace(/ /g, ' '), ...f }); continue; }
          if (c.nodeType !== 1 || c.classList.contains('bu')) continue;
          if (c.tagName === 'BR') { if (c.nextSibling) runs.push({ text: '\n', ...f }); continue; }
          const cs = getComputedStyle(c);
          const nf = {
            size: Math.round(parseFloat(cs.fontSize) * 72 / PPI * 2) / 2,
            b: parseInt(cs.fontWeight, 10) >= 600, i: cs.fontStyle === 'italic', u: /underline/.test(cs.textDecorationLine) || f.u,
            color: rgbHex(cs.color), font: (cs.fontFamily.split(',')[0] || 'Arial').replace(/["']/g, '').trim(),
          };
          walk(c, nf);
        }
      };
      const cs0 = getComputedStyle(b);
      walk(b, { size: Math.round(parseFloat(cs0.fontSize) * 72 / PPI * 2) / 2, b: parseInt(cs0.fontWeight, 10) >= 600, i: cs0.fontStyle === 'italic', u: false, color: rgbHex(cs0.color), font: (cs0.fontFamily.split(',')[0] || 'Arial').replace(/["']/g, '').trim() });
      // merge adjacent runs with the same format
      const merged = [];
      for (const r of runs) {
        const last = merged[merged.length - 1];
        if (last && last.size === r.size && last.b === r.b && last.i === r.i && last.u === r.u && last.color === r.color && last.font === r.font) last.text += r.text;
        else merged.push({ ...r });
      }
      const ref = old[Math.min(k, old.length - 1)] || { align: 'l', level: 0 };
      const ta = b.style && b.style.textAlign;
      paras.push({
        align: ta === 'center' ? 'ctr' : ta === 'right' ? 'r' : ta === 'justify' ? 'just' : (ta === 'left' ? 'l' : ref.align || 'l'),
        level: ref.level || 0, bullet: b.dataset && b.dataset.bullet ? (b.dataset.bullet === 'num' ? { num: true, n: k + 1 } : { char: '•' }) : null,
        runs: merged.filter(r => r.text !== ''), endSize: ref.endSize || (merged[0] && merged[0].size) || 18, marL: null,
      });
    });
    // renumber numbered paragraphs
    let n = 0;
    paras.forEach(p => { if (p.bullet && p.bullet.num) p.bullet.n = ++n; else n = 0; });
    return paras.length ? paras : [{ align: 'l', level: 0, runs: [] }];
  }
  function rgbHex(c) {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
    return m ? '#' + [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, '0')).join('').toUpperCase() : '#000000';
  }

  // ---------------- toolbar ----------------
  const tbar = $('.office-toolbar', root);
  tbar.addEventListener('mousedown', e => { if (e.target.closest('button') && editingEl) e.preventDefault(); });
  tbar.addEventListener('click', e => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const a = b.dataset.a;
    const s = pres.slides[cur];
    const el = selIdx >= 0 ? s.els[selIdx] : null;
    const textOnly = () => { if (!el || !el.text) { toast('Wähle zuerst ein Textfeld aus.', 'info'); return false; } return true; };
    switch (a) {
      case 'undo': doUndo(); break;
      case 'redo': doRedo(); break;
      case 'add': addSlide(b); break;
      case 'dup': commitEdit(); pushUndo(); pres.slides.splice(cur + 1, 0, clone(s)); cur++; shell.markDirty(); renderAll(); break;
      case 'del': deleteSlide(cur); break;
      case 'text': commitEdit(); pushUndo(); {
        const t = theme();
        s.els.push({ type: 'shape', geom: 'rect', x: pres.w / 2 - 2.5, y: pres.h / 2 - 0.5, w: 5, h: 1, fill: null, line: null, text: { paras: [{ align: 'l', level: 0, runs: [{ text: 'Neuer Text', size: 24, color: t ? t.text : '#15172F', font: t ? t.font : 'Arial' }] }], anchor: 't', ins: [0.1, 0.05, 0.1, 0.05], wrap: true } });
        selIdx = s.els.length - 1; dirty(); renderStage(); startEdit(selIdx);
      } break;
      case 'image': commitEdit(); placeImage(-1); break;
      case 'shape': commitEdit(); officeMenu(b, [['rect', 'Rechteck'], ['roundRect', 'Abgerundetes Rechteck'], ['ellipse', 'Ellipse'], ['triangle', 'Dreieck'], ['rightArrow', 'Pfeil'], ['star5', 'Stern']].map(([g, l]) => ({ label: l, icon: 'shape', onClick: () => {
        pushUndo();
        const t = theme();
        s.els.push({ type: 'shape', geom: g, x: pres.w / 2 - 1.25, y: pres.h / 2 - 1.25, w: 2.5, h: 2.5, fill: t ? t.accent : '#3B37A0', line: null });
        selIdx = s.els.length - 1; dirty(); renderStage();
      } })), { label: 'Form einfügen' }); break;
      case 'bold': case 'italic': case 'underline':
        if (editingEl) { document.execCommand(a); break; }
        if (!textOnly()) break;
        pushUndo(); { const key = a[0]; const on = !el.text.paras.every(p => p.runs.every(r => r[key])); el.text.paras.forEach(p => p.runs.forEach(r => { r[key] = on; })); } dirty(); renderStage(); break;
      case 'grow': case 'shrink':
        commitEdit();
        if (!textOnly()) break;
        pushUndo(); el.text.paras.forEach(p => { p.runs.forEach(r => { r.size = Math.max(6, Math.round((r.size || 18) * (a === 'grow' ? 1.12 : 0.89))); }); if (p.endSize) p.endSize = Math.max(6, Math.round(p.endSize * (a === 'grow' ? 1.12 : 0.89))); }); dirty(); renderStage(); break;
      case 'color': {
        const cols = ['#FFFFFF', '#15172F', '#3B37A0', '#0B8F80', '#2DD4BF', '#E8613C', '#F5C04A', '#C23A4B', '#6B7194'];
        const editingNow = !!editingEl;
        officeMenu(b, cols.map(c => ({ label: c, icon: 'color', onClick: () => {
          if (editingNow && editingEl) { editingEl.tx.focus(); document.execCommand('foreColor', false, c); return; }
          if (!el) return;
          pushUndo();
          if (el.text && el.type !== 'image') el.text.paras.forEach(p => p.runs.forEach(r => { r.color = c; }));
          else if (el.type === 'shape') el.fill = c;
          dirty(); renderStage();
        } })), { label: 'Farbe' });
      } break;
      case 'align': commitEdit(); if (!textOnly()) break; pushUndo(); { const order = ['l', 'ctr', 'r']; const nx = order[(order.indexOf(el.text.paras[0].align || 'l') + 1) % 3]; el.text.paras.forEach(p => { p.align = nx; }); toast({ l: 'Linksbündig', ctr: 'Zentriert', r: 'Rechtsbündig' }[nx]); } dirty(); renderStage(); break;
      case 'bullets': commitEdit(); if (!textOnly()) break; pushUndo(); { const on = !el.text.paras.every(p => p.bullet); el.text.paras.forEach(p => { p.bullet = on ? { char: '•' } : null; p.marL = null; }); } dirty(); renderStage(); break;
      case 'front': commitEdit(); if (!el) { toast('Wähle zuerst ein Element aus.', 'info'); break; } pushUndo(); s.els.splice(selIdx, 1); s.els.push(el); selIdx = s.els.length - 1; dirty(); renderStage(); break;
      case 'eldel': commitEdit(); if (!el) { toast('Wähle zuerst ein Element aus.', 'info'); break; } pushUndo(); s.els.splice(selIdx, 1); selIdx = -1; dirty(); renderStage(); break;
      case 'theme': commitEdit(); pickTheme(); break;
      case 'bg': commitEdit(); officeMenu(b, [
        ...['#FFFFFF', '#F5F6FB', '#15172F', '#1E1B5E', '#0F3D3A', '#FFF6F0'].map(c => ({ label: `Farbe ${c}`, icon: 'fill', onClick: () => { pushUndo(); s.bg = { color: c }; dirty(); renderStage(); } })),
        { label: 'Bild als Hintergrund …', icon: 'image', onClick: async () => { const f = await pickFiles({ accept: 'image/*', multiple: false }); if (!f.length) return; const { url } = await fileToDataUrl(f[0], 2400); pushUndo(); s.bg = { color: '#FFFFFF', image: url }; dirty(); renderStage(); } },
      ], { label: 'Hintergrund' }); break;
      case 'show': commitEdit(); slideshow(cur); break;
      case 'presenter': commitEdit(); presenter(cur); break;
      case 'notes': toggleNotes(); break;
      case 'transition': commitEdit(); transitionMenu(b); break;
    }
  });

  async function placeImage(targetIdx) {
    const f = await pickFiles({ accept: 'image/*', multiple: false });
    if (!f.length) return;
    try {
      const { url, w, h: ih } = await fileToDataUrl(f[0], 2000);
      pushUndo();
      const s = pres.slides[cur];
      if (targetIdx >= 0 && s.els[targetIdx]) {
        const ph = s.els[targetIdx];
        const r = Math.min(ph.w / w, ph.h / ih);
        const nw = w * r, nh = ih * r;
        Object.assign(ph, { src: url, x: ph.x + (ph.w - nw) / 2, y: ph.y + (ph.h - nh) / 2, w: nw, h: nh });
        selIdx = targetIdx;
      } else {
        const maxW = pres.w * 0.6, maxH = pres.h * 0.6;
        let nw = w / 96, nh = ih / 96;
        const r = Math.min(maxW / nw, maxH / nh);
        nw *= r; nh *= r;
        s.els.push({ type: 'image', x: (pres.w - nw) / 2, y: (pres.h - nh) / 2, w: nw, h: nh, src: url });
        selIdx = s.els.length - 1;
      }
      dirty(); renderStage();
    } catch (e) { errorToast(e, 'Das Bild konnte nicht eingefügt werden.'); }
  }

  function addSlide(anchor) {
    commitEdit();
    const t = theme() || SLIDE_THEMES[1];
    officeMenu(anchor, SLIDE_LAYOUTS.map(l => ({ label: l.name, icon: 'kslides', onClick: () => {
      pushUndo();
      const s = makeSlide(l.id, t, pres.w, pres.h);
      if (!theme()) { s.bg = { color: (pres.slides[cur] && pres.slides[cur].bg && pres.slides[cur].bg.color) || '#FFFFFF' }; s.els = s.els.filter(e => e.role !== 'decor'); }
      pres.slides.splice(cur + 1, 0, s);
      cur++; selIdx = -1; shell.markDirty(); renderAll();
    } })), { label: 'Layout der neuen Folie' });
  }
  async function deleteSlide(i) {
    commitEdit();
    if (pres.slides.length < 2) { toast('Eine Präsentation braucht mindestens eine Folie.', 'info'); return; }
    pushUndo();
    pres.slides.splice(i, 1);
    cur = Math.min(cur, pres.slides.length - 1); selIdx = -1;
    shell.markDirty(); renderAll();
    toast('Folie gelöscht', 'info', { action: { label: 'Rückgängig', onClick: doUndo } });
  }
  async function pickTheme() {
    const r = await openDialog({
      title: 'Design wählen',
      wide: true,
      body: `<div class="theme-grid">${SLIDE_THEMES.map(t => `<button type="button" class="theme-card${pres.theme === t.id ? ' on' : ''}" data-theme="${t.id}" style="background:${t.bg};color:${t.title}"><span class="tc-bar" style="background:${t.accent}"></span><strong style="font-family:${t.font}">${t.name}</strong><span style="color:${t.text}">Aa · Text</span></button>`).join('')}</div>
        <p class="hint">Das Design ändert Hintergründe, Farben und Schmuckelemente aller Folien.</p>`,
      actions: [{ label: 'Abbrechen', value: 'cancel' }],
      onMount: dlg => { $$('[data-theme]', dlg).forEach(b => b.addEventListener('click', () => { dlg._picked = b.dataset.theme; dlg.close(); })); return { collect: () => dlg._picked }; },
    });
    const id2 = r.dialog && r.dialog._picked;
    if (!id2) return;
    pushUndo();
    applyTheme(pres, SLIDE_THEMES.find(t => t.id === id2));
    shell.markDirty(); renderAll();
  }

  // keyboard
  const onKey = e => {
    if (document.querySelector('.slideshow')) return;
    if (editingEl) { if (e.key === 'Escape') { e.preventDefault(); commitEdit(); } return; }
    if (e.target.closest && e.target.closest('input,textarea,select,[contenteditable="true"],dialog')) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); doUndo(); return; }
    if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); return; }
    if (e.key === 'F5') { e.preventDefault(); slideshow(0); return; }
    if (selIdx >= 0 && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); pushUndo(); pres.slides[cur].els.splice(selIdx, 1); selIdx = -1; dirty(); renderStage(); return; }
    if (selIdx >= 0 && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const el = pres.slides[cur].els[selIdx]; const d = e.shiftKey ? 0.25 : 0.05;
      if (!e.repeat) pushUndo();
      if (e.key === 'ArrowLeft') el.x -= d; if (e.key === 'ArrowRight') el.x += d; if (e.key === 'ArrowUp') el.y -= d; if (e.key === 'ArrowDown') el.y += d;
      dirty(); renderStage(); return;
    }
    if (e.key === 'PageDown' || (selIdx < 0 && e.key === 'ArrowDown')) { e.preventDefault(); go(cur + 1); }
    if (e.key === 'PageUp' || (selIdx < 0 && e.key === 'ArrowUp')) { e.preventDefault(); go(cur - 1); }
    if (selIdx >= 0 && e.key === 'Enter') { const el = pres.slides[cur].els[selIdx]; if (el.type === 'shape') { e.preventDefault(); startEdit(selIdx); } }
  };
  document.addEventListener('keydown', onKey);
  screen.onDropFiles = files => { const imgs = files.filter(f => /^image\//.test(f.type)); if (!imgs.length) return; fileToDataUrl(imgs[0], 2000).then(({ url, w, h: ih }) => { pushUndo(); const nw = Math.min(pres.w * 0.6, w / 96), nh = nw * ih / w; pres.slides[cur].els.push({ type: 'image', x: (pres.w - nw) / 2, y: (pres.h - nh) / 2, w: nw, h: nh, src: url }); dirty(); renderStage(); }); };

  // ---------------- speaker notes ----------------
  const notesBox = $('.slide-notes', root), notesTa = $('.sn-ta', root);
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
  function toggleNotes(force) {
    const open = force != null ? force : notesBox.hidden;
    notesBox.hidden = !open;
    $('[data-a="notes"]', root).setAttribute('aria-pressed', String(open));
    try { localStorage.setItem('fale-slide-notes', open ? '1' : '0'); } catch {}
    layoutStage();
    if (open && force == null) setTimeout(() => notesTa.focus(), 30);
  }
  let notesUndo = false;
  function syncNotes() {
    const s = pres.slides[cur];
    if (document.activeElement !== notesTa) notesTa.value = (s && s.notes) || '';
    $('[data-sn]', root).textContent = String(cur + 1);
  }
  notesTa.addEventListener('focus', () => { notesUndo = false; });
  notesTa.addEventListener('input', () => {
    if (!notesUndo) { pushUndo(); notesUndo = true; }
    pres.slides[cur].notes = notesTa.value;
    shell.markDirty();
  });
  notesTa.addEventListener('blur', syncNotes);
  if (lsGet('fale-slide-notes', window.matchMedia('(max-width: 720px)').matches ? '0' : '1') === '1') toggleNotes(true);

  // ---------------- transitions ----------------
  function transitionMenu(anchor) {
    const set = (t, all) => {
      pushUndo();
      (all ? pres.slides : [pres.slides[cur]]).forEach(sl => { sl.transition = t === 'none' ? null : t; });
      shell.markDirty(); renderStage();
      toast(all ? 'Übergang für alle Folien gesetzt' : 'Übergang gesetzt');
    };
    const curT = pres.slides[cur].transition || 'none';
    officeMenu(anchor, [
      { label: `${curT === 'none' ? '✓ ' : ''}Kein Übergang`, icon: 'close', onClick: () => set('none') },
      { label: `${curT === 'fade' ? '✓ ' : ''}Überblenden`, icon: 'transition', onClick: () => set('fade') },
      { label: `${curT === 'push' ? '✓ ' : ''}Schieben`, icon: 'arrowLeft', onClick: () => set('push') },
      '-',
      { label: 'Diesen Übergang für alle Folien', icon: 'copy', onClick: () => set(curT, true) },
    ], { label: 'Übergang' });
  }

  // ---------------- handouts (PDF) ----------------
  async function handoutDialog() {
    commitEdit();
    const r = await openDialog({
      title: 'Handzettel als PDF',
      body: `<div class="ho-grid" role="radiogroup">${[['2', '2 Folien pro Seite', 'Groß und gut lesbar'], ['3', '3 Folien mit Notizen', 'Rechts deine Notizen oder Linien zum Mitschreiben'], ['6', '6 Folien pro Seite', 'Kompakte Übersicht'], ['notes', 'Notizenseiten', 'Eine Folie pro Seite mit deinen Sprechernotizen']].map(([k, l, d], i) => `<label class="radio-card"><input type="radio" name="ho" value="${k}" ${i === 1 ? 'checked' : ''}><span><strong>${l}</strong><span class="muted small">${d}</span></span></label>`).join('')}</div>`,
      actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'PDF erstellen', value: 'ok', kind: 'btn-primary', default: true }],
      onMount: dlg => ({ collect: () => ($('input[name=ho]:checked', dlg) || {}).value }),
    });
    if (r.value !== 'ok' || !r.data) return;
    const { handoutPdf } = await import('./handout.js');
    await exportPdfFlow(`${stripExt(shell.name)} – Handzettel`, onP => handoutPdf(pres, { title: stripExt(shell.name), layout: r.data, onProgress: onP }));
  }

  if (fromOutline) { shell.markDirty(); toast(`${pres.slides.length} Folien erstellt – prüfe sie und speichere die Präsentation.`, 'success', { timeout: 5000 }); }
  renderAll();
  root._slidesApi = { pres: () => pres, go, startEdit, commitEdit, select: i => { selIdx = i; paintSel(); }, presenter: () => presenter(cur) };
  return () => { document.removeEventListener('keydown', onKey); ro.disconnect(); closeShow(); screen.officeCleanup && screen.officeCleanup(); };

  // ---------------- slideshow ----------------
  function slideshow(start = 0) {
    commitEdit();
    let i = start;
    const ov = h(`<div class="slideshow" role="dialog" aria-label="Präsentation" tabindex="-1">
      <div class="ss-stage"></div>
      <div class="ss-bar"><button class="icon-btn" type="button" data-ss="prev" aria-label="Vorherige Folie">${oicon('chevronLeft')}</button><span class="ss-count"></span><button class="icon-btn" type="button" data-ss="next" aria-label="Nächste Folie">${oicon('chevronRight')}</button><button class="icon-btn" type="button" data-ss="close" aria-label="Präsentation beenden">${oicon('close')}</button></div>
    </div>`);
    document.body.appendChild(ov);
    const st = $('.ss-stage', ov);
    let last = -1;
    const show = () => {
      const dir = last < 0 ? 0 : i > last ? 1 : i < last ? -1 : 0;
      const old = $('.slide', st);
      const s = Math.min(window.innerWidth / (pres.w * PPI), window.innerHeight / (pres.h * PPI));
      const t = pres.slides[i].transition;
      const animate = dir && old && t && t !== 'none' && !matchMedia('(prefers-reduced-motion: reduce)').matches && old.animate;
      st.insertAdjacentHTML('beforeend', slideHtml(pres, pres.slides[i]));
      const all = $$('.slide', st);
      const sl = all[all.length - 1];
      sl.style.transform = `scale(${s})`;
      all.slice(0, -1).forEach(x => { if (!animate) x.remove(); });
      st.style.width = `${pres.w * PPI * s}px`; st.style.height = `${pres.h * PPI * s}px`;
      if (animate) {
        const W = pres.w * PPI * s;
        const kf = t === 'push'
          ? [{ transform: `translateX(${dir * W}px) scale(${s})` }, { transform: `translateX(0) scale(${s})` }]
          : [{ opacity: 0, transform: `scale(${s})` }, { opacity: 1, transform: `scale(${s})` }];
        const a = sl.animate(kf, { duration: t === 'push' ? 420 : 380, easing: 'cubic-bezier(.2,.7,.2,1)' });
        if (t === 'push') old.animate([{ transform: `translateX(0) scale(${s})` }, { transform: `translateX(${-dir * W}px) scale(${s})` }], { duration: 420, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' });
        a.onfinish = () => { all.slice(0, -1).forEach(x => x.remove()); };
      }
      last = i;
      $('.ss-count', ov).textContent = `${i + 1} / ${pres.slides.length}`;
      if (ov._onSlide) ov._onSlide(i);
    };
    const next = () => { if (i < pres.slides.length - 1) { i++; show(); } else close(); };
    const prev = () => { if (i > 0) { i--; show(); } };
    const close = () => {
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', show);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      ov.remove();
    };
    const key = e => {
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); next(); }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); prev(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'Home') { i = 0; show(); } else if (e.key === 'End') { i = pres.slides.length - 1; show(); }
    };
    document.addEventListener('keydown', key, true);
    window.addEventListener('resize', show);
    let sx = null, sy = 0;
    ov.addEventListener('pointerdown', e => { if (e.target.closest('.ss-bar')) return; sx = e.clientX; sy = e.clientY; });
    ov.addEventListener('pointerup', e => {
      if (sx == null) return;
      const dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { dx < 0 ? next() : prev(); return; }
      if (e.clientX < window.innerWidth / 3) prev(); else next();
    });
    $('[data-ss="prev"]', ov).addEventListener('click', prev);
    $('[data-ss="next"]', ov).addEventListener('click', next);
    $('[data-ss="close"]', ov).addEventListener('click', close);
    ov._close = close;
    show();
    ov.focus();
    if (ov.requestFullscreen) ov.requestFullscreen().catch(() => {});
  }
  function closeShow() { const ov = document.querySelector('.slideshow'); if (ov && ov._close) ov._close(); const pv = document.querySelector('.presenter'); if (pv && pv._close) pv._close(); }

  // ---------------- presenter view ----------------
  function presenter(start = 0) {
    commitEdit();
    let i = start, t0 = Date.now(), paused = 0, pausedAt = 0, aud = null;
    const ov = h(`<div class="presenter" role="dialog" aria-label="Referentenansicht" tabindex="-1">
      <div class="pv-main"><div class="pv-cur"><div class="pv-fit"></div></div></div>
      <aside class="pv-side">
        <div class="pv-next"><span class="pv-lbl">Nächste Folie</span><div class="pv-next-fit"></div></div>
        <div class="pv-notes"><span class="pv-lbl">Notizen</span><div class="pv-notes-text"></div><div class="pv-font"><button class="icon-btn" type="button" data-pv="smaller" aria-label="Notizen kleiner">${oicon('fontDown')}</button><button class="icon-btn" type="button" data-pv="bigger" aria-label="Notizen größer">${oicon('fontUp')}</button></div></div>
      </aside>
      <div class="pv-bar">
        <div class="pv-time"><span class="pv-timer" aria-label="Vergangene Zeit">00:00</span><button class="icon-btn" type="button" data-pv="pause" aria-label="Zeit anhalten">${oicon('pause')}</button><button class="icon-btn" type="button" data-pv="reset" aria-label="Zeit zurücksetzen">${oicon('rotateLeft')}</button><span class="pv-clock"></span></div>
        <div class="pv-nav"><button class="icon-btn" type="button" data-pv="prev" aria-label="Vorherige Folie">${oicon('chevronLeft')}</button><span class="pv-count"></span><button class="icon-btn" type="button" data-pv="next" aria-label="Nächste Folie">${oicon('chevronRight')}</button></div>
        <div class="pv-acts"><button class="btn btn-ghost btn-sm" type="button" data-pv="audience">${oicon('present')}<span>Publikumsfenster</span></button><button class="btn btn-primary btn-sm" type="button" data-pv="close">Beenden</button></div>
      </div></div>`);
    document.body.appendChild(ov);
    let notesSize = 22;
    const fitInto = (box, sl) => {
      box.innerHTML = slideHtml(pres, sl);
      const el = $('.slide', box);
      const host = box.parentElement;
      const sc = Math.min((host.clientWidth - 8) / (pres.w * PPI), (host.clientHeight - 8) / (pres.h * PPI));
      el.style.transform = `scale(${Math.max(0.05, sc)})`;
      box.style.width = `${pres.w * PPI * sc}px`; box.style.height = `${pres.h * PPI * sc}px`;
    };
    const paint = () => {
      fitInto($('.pv-fit', ov), pres.slides[i]);
      const nx = pres.slides[i + 1];
      const nf = $('.pv-next-fit', ov);
      if (nx) fitInto(nf, nx); else { nf.innerHTML = '<p class="pv-end">Ende der Präsentation</p>'; nf.style.width = ''; nf.style.height = ''; }
      const nt = $('.pv-notes-text', ov);
      nt.textContent = pres.slides[i].notes || 'Keine Notizen für diese Folie.';
      nt.classList.toggle('empty', !pres.slides[i].notes);
      nt.style.fontSize = `${notesSize}px`;
      $('.pv-count', ov).textContent = `${i + 1} / ${pres.slides.length}`;
      if (aud && !aud.closed) paintAudience();
    };
    const fmt = ms => { const s = Math.floor(ms / 1000); const hh = Math.floor(s / 3600); return `${hh ? hh + ':' : ''}${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
    const tick = () => {
      const el = (pausedAt || Date.now()) - t0 - paused;
      $('.pv-timer', ov).textContent = fmt(el);
      $('.pv-clock', ov).textContent = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    };
    const timer = setInterval(tick, 500);
    tick();
    function paintAudience() {
      const d = aud.document;
      const box = d.getElementById('aud');
      if (!box) return;
      box.innerHTML = slideHtml(pres, pres.slides[i]);
      const el = box.firstElementChild;
      const sc = Math.min(aud.innerWidth / (pres.w * PPI), aud.innerHeight / (pres.h * PPI));
      el.style.transformOrigin = '0 0';
      el.style.transform = `scale(${sc})`;
      box.style.width = `${pres.w * PPI * sc}px`; box.style.height = `${pres.h * PPI * sc}px`;
    }
    function openAudience() {
      aud = window.open('', 'fale-publikum', 'popup,width=1280,height=720');
      if (!aud) { toast('Das Publikumsfenster wurde vom Browser blockiert.', 'error'); return; }
      const base = new URL('.', location.href).href;
      aud.document.open();
      aud.document.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Präsentation</title><link rel="stylesheet" href="${base}styles.css"><link rel="stylesheet" href="${base}css/office.css"><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}body{display:grid;place-items:center}#aud{position:relative;overflow:hidden}#aud>.slide{position:absolute;left:0;top:0}button{position:fixed;right:10px;bottom:10px;opacity:.3}button:hover{opacity:1}</style></head><body><div id="aud"></div><button type="button" onclick="document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen()">Vollbild</button></body></html>`);
      aud.document.close();
      aud.addEventListener('resize', () => paintAudience());
      aud.addEventListener('keydown', key);
      setTimeout(paintAudience, 120);
    }
    const next = () => { if (i < pres.slides.length - 1) { i++; paint(); } };
    const prev = () => { if (i > 0) { i--; paint(); } };
    const close = () => {
      clearInterval(timer);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', paint);
      if (aud && !aud.closed) aud.close();
      ov.remove();
      go(i);
    };
    function key(e) {
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); next(); }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); prev(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'Home') { i = 0; paint(); } else if (e.key === 'End') { i = pres.slides.length - 1; paint(); }
    }
    document.addEventListener('keydown', key, true);
    window.addEventListener('resize', paint);
    ov.addEventListener('click', e => {
      const b = e.target.closest('[data-pv]');
      if (!b) return;
      const a = b.dataset.pv;
      if (a === 'next') next(); else if (a === 'prev') prev(); else if (a === 'close') close(); else if (a === 'audience') openAudience();
      else if (a === 'reset') { t0 = Date.now(); paused = 0; if (pausedAt) pausedAt = Date.now(); tick(); }
      else if (a === 'pause') { if (pausedAt) { paused += Date.now() - pausedAt; pausedAt = 0; b.innerHTML = oicon('pause'); } else { pausedAt = Date.now(); b.innerHTML = oicon('play'); } tick(); }
      else if (a === 'bigger') { notesSize = Math.min(44, notesSize + 2); paint(); } else if (a === 'smaller') { notesSize = Math.max(14, notesSize - 2); paint(); }
    });
    ov._close = close;
    requestAnimationFrame(paint);
    ov.focus();
  }
}
