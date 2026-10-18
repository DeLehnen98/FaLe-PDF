// Tool: annotate — highlight/underline/strike out text, freehand pen, text boxes, sticky notes,
// rectangle/ellipse/arrow/line shapes, eraser, undo/redo. Saved as real PDF annotations.
import { icon } from '../icons.js';
import { h, esc, toast, errorToast, progress, baseName, openDialog } from '../ui.js';
import { resultCard } from '../components.js';
import { saveResult } from '../library.js';
import { loadPdf } from '../pdfcore.js';
import { loadEditable, loadPdfLib, saveDoc } from '../pdflib.js';
import { openToolDoc, PageStage, svgEl, COLORS, INK_COLORS, swatches, guardLeave, createPan, updateFoot } from './common.js';
import { pageChars, nearestChar, quadsFor, textOf } from './textgeom.js';
import { writeAnnotations, TEXT_PAD } from './annotpdf.js';

const TOOL_DEFS = [
  { id: 'select', label: 'Auswählen', icon: 'pointer' },
  { id: 'highlight', label: 'Markieren', icon: 'highlight', hint: 'Über Text ziehen zum Markieren – oder einen Bereich aufziehen.' },
  { id: 'underline', label: 'Unterstr.', icon: 'underline', hint: 'Über Text ziehen zum Unterstreichen.' },
  { id: 'strike', label: 'Durchstr.', icon: 'strike', hint: 'Über Text ziehen zum Durchstreichen.' },
  '|',
  { id: 'pen', label: 'Stift', icon: 'pen', hint: 'Frei zeichnen. Mit zwei Fingern scrollen.' },
  { id: 'text', label: 'Text', icon: 'textbox', hint: 'Tippe auf die Seite, um ein Textfeld einzufügen.' },
  { id: 'note', label: 'Notiz', icon: 'note', hint: 'Tippe auf die Seite, um eine Notiz anzuheften.' },
  { id: 'stamp', label: 'Stempel', icon: 'stamp', hint: 'Tippe auf die Seite, um den Stempel / die Unterschrift einzusetzen.' },
  '|',
  { id: 'rect', label: 'Rechteck', icon: 'square', hint: 'Rechteck aufziehen.' },
  { id: 'ellipse', label: 'Ellipse', icon: 'circle', hint: 'Ellipse aufziehen.' },
  { id: 'arrow', label: 'Pfeil', icon: 'arrow', hint: 'Pfeil ziehen – Spitze am Ende.' },
  { id: 'line', label: 'Linie', icon: 'line', hint: 'Linie ziehen.' },
  '|',
  { id: 'eraser', label: 'Radierer', icon: 'eraser', hint: 'Über eigene Anmerkungen wischen, um sie zu löschen.' },
];
const MARKUP = ['highlight', 'underline', 'strike'];
const SHAPES = ['rect', 'ellipse', 'arrow', 'line'];
const PROPS_KEY = 'fale-annot-props';
const DEFAULT_PROPS = {
  highlight: { color: '#FFD43B' }, underline: { color: '#1C64F2' }, strike: { color: '#E03131' },
  pen: { color: '#1C64F2', width: 2 }, shape: { color: '#E03131', width: 2 },
  text: { color: '#1F2340', size: 14 }, note: { color: '#FFD43B' },
};
const propKey = t => (SHAPES.includes(t) ? 'shape' : t);

let measureCtx = null;
function measure(text, size) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = `${size}px Helvetica, Arial, sans-serif`;
  const lines = String(text || '').split('\n');
  return { w: Math.max(size * 0.5, ...lines.map(l => measureCtx.measureText(l).width)) + TEXT_PAD * 2, h: lines.length * size * 1.2 + TEXT_PAD * 2 };
}

function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = 0, mi = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const L = Math.hypot(bx - ax, by - ay) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L;
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export async function mount(screen, { docId }) {
  const ctx = await openToolDoc(screen, docId, 'Kommentieren');
  if (!ctx) return;
  const { doc, bytes } = ctx;
  const { pdf } = await loadPdf(bytes.slice(), { name: doc.name, key: docId });

  let props;
  try { props = { ...DEFAULT_PROPS, ...JSON.parse(localStorage.getItem(PROPS_KEY) || '{}') }; } catch { props = { ...DEFAULT_PROPS }; }
  const saveProps = () => { try { localStorage.setItem(PROPS_KEY, JSON.stringify(props)); } catch {} };

  let tool = 'highlight';
  let annots = [];
  let selected = null;
  const undoStack = [], redoStack = [];
  let seq = 0;
  let editingId = null;
  let savedSnapshot = '[]';
  const nid = () => `a${++seq}`;
  const assets = new Map(); // asset key → {url, blob, w, h} (kept out of the undo snapshots)
  let pendingAsset = null;

  // ---------- layout ----------
  screen.body.classList.add('pt-shell');
  screen.body.style.cssText = 'display:flex;flex-direction:column;overflow:hidden';
  const toolbar = h('<div class="pt-toolbar" role="toolbar" aria-label="Kommentar-Werkzeuge"></div>');
  TOOL_DEFS.forEach(t => {
    if (t === '|') { toolbar.appendChild(h('<span class="pt-sep" aria-hidden="true"></span>')); return; }
    const b = h(`<button class="pt-tool" type="button" data-tool="${t.id}" aria-pressed="false" title="${esc(t.label)}">${icon(t.icon)}<span>${esc(t.label)}</span></button>`);
    b.addEventListener('click', () => setTool(t.id));
    toolbar.appendChild(b);
  });
  const propsBar = h('<div class="pt-props" aria-label="Eigenschaften"></div>');
  const stageEl = h('<div class="pt-stage" tabindex="-1"></div>');
  const zoomBox = h(`<div class="pt-zoom"><button class="icon-btn" type="button" data-z="in" aria-label="Vergrößern">${icon('zoomIn')}</button><button class="icon-btn" type="button" data-z="out" aria-label="Verkleinern">${icon('zoomOut')}</button></div>`);
  const stageWrap = h('<div style="position:relative;flex:1;min-height:0;display:flex;flex-direction:column"></div>');
  stageWrap.append(stageEl, zoomBox);
  screen.body.append(toolbar, propsBar, stageWrap);

  const undoBtn = h(`<button class="icon-btn" type="button" aria-label="Rückgängig" title="Rückgängig (Strg+Z)" disabled>${icon('undo')}</button>`);
  const redoBtn = h(`<button class="icon-btn" type="button" aria-label="Wiederholen" title="Wiederholen (Strg+Y)" disabled>${icon('redo')}</button>`);
  screen.extra.append(undoBtn, redoBtn);
  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);

  const stage = new PageStage(stageEl, pdf, {
    onPageCreated: p => {
      p.svg = svgEl('svg', { viewBox: `0 0 ${p.base.width} ${p.base.height}`, preserveAspectRatio: 'none' });
      p.html = h('<div class="pt-html"></div>');
      p.overlay.append(p.svg, p.html);
      p.chars = null;
    },
    onScale: s => { stageEl.style.setProperty('--s', s); },
  });
  await stage.init();
  zoomBox.querySelector('[data-z="in"]').addEventListener('click', () => stage.setZoom(stage.zoom * 1.25));
  zoomBox.querySelector('[data-z="out"]').addEventListener('click', () => stage.setZoom(stage.zoom / 1.25));

  stage.box.addEventListener('pointerenter', () => { if (MARKUP.includes(tool)) stage.pages.forEach(p => { if (p.rendered) charsOf(p); }); }, true);
  async function charsOf(p) {
    if (!p.chars) p.chars = pageChars(p.page, p.base).catch(e => { console.warn(e); return { chars: [], text: '', map: [] }; });
    return p.chars;
  }

  // ---------- props bar ----------
  function renderProps() {
    propsBar.innerHTML = '';
    const def = TOOL_DEFS.find(t => t.id === tool);
    const target = selected && selected.type !== 'markup' ? selected : null;
    const key = target ? (MARKUP.includes(target.type) ? target.type : target.type === 'ink' ? 'pen' : SHAPES.includes(target.type) ? 'shape' : target.type) : propKey(tool);
    const pr = props[key];
    if (pr && tool !== 'eraser') {
      const palette = key === 'highlight' || key === 'note' ? COLORS : INK_COLORS;
      const cur = target ? target.color : pr.color;
      propsBar.appendChild(swatches(palette, cur, c => {
        pr.color = c; saveProps();
        if (target) { commit(); target.color = c; renderPage(target.page); }
      }));
      if (pr.width != null) {
        const w = target ? target.width : pr.width;
        const r = h(`<label class="pt-range">Stärke <input type="range" min="${key === 'pen' ? 1 : 1}" max="${key === 'pen' ? 12 : 10}" step="0.5" value="${w}" aria-label="Linienstärke"><b>${w}</b></label>`);
        const inp = r.querySelector('input');
        let committed = false;
        inp.addEventListener('input', () => {
          pr.width = +inp.value; r.querySelector('b').textContent = inp.value; saveProps();
          if (target) { if (!committed) { commit(); committed = true; } target.width = +inp.value; renderPage(target.page); }
        });
        propsBar.appendChild(r);
      }
      if (pr.size != null) {
        const sz = target ? target.size : pr.size;
        const sel = h(`<label class="pt-range">Größe <select class="select pt-mini" aria-label="Schriftgröße">${[8, 10, 12, 14, 16, 18, 20, 24, 28, 36, 48].map(v => `<option ${v === sz ? 'selected' : ''}>${v}</option>`).join('')}</select></label>`);
        sel.querySelector('select').addEventListener('change', e => {
          pr.size = +e.target.value; saveProps();
          if (target) { commit(); target.size = +e.target.value; renderPage(target.page); }
        });
        propsBar.appendChild(sel);
      }
    }
    if (selected && selected.type === 'stamp') {
      const a = selected;
      const w0 = Math.abs(a.x1 - a.x0);
      const r = h(`<label class="pt-range">Größe <input type="range" min="20" max="400" step="2" value="${Math.round(w0)}" aria-label="Stempelgröße"></label>`);
      const inp = r.querySelector('input');
      let committed = false;
      inp.addEventListener('input', () => {
        if (!committed) { commit(); committed = true; }
        const cx = (a.x0 + a.x1) / 2, cy = (a.y0 + a.y1) / 2;
        const ratio = Math.abs(a.y1 - a.y0) / Math.max(1, Math.abs(a.x1 - a.x0));
        const w = +inp.value, hh = w * ratio;
        a.x0 = cx - w / 2; a.x1 = cx + w / 2; a.y0 = cy - hh / 2; a.y1 = cy + hh / 2;
        renderPage(a.page);
      });
      propsBar.appendChild(r);
    }
    if (selected) {
      const del = h(`<button class="btn btn-danger-ghost btn-sm" type="button">${icon('trash')} Löschen</button>`);
      del.addEventListener('click', () => removeAnnot(selected));
      propsBar.appendChild(del);
      if (selected.type === 'note' || selected.type === 'text') {
        const ed = h(`<button class="btn btn-ghost btn-sm" type="button">${icon('edit')} Bearbeiten</button>`);
        ed.addEventListener('click', () => (selected.type === 'note' ? editNote(selected) : editText(selected)));
        propsBar.appendChild(ed);
      }
    } else if (def && def.hint) {
      propsBar.appendChild(h(`<span class="pt-hint">${esc(def.hint)}</span>`));
    } else if (tool === 'select') {
      propsBar.appendChild(h(`<span class="pt-hint">${annots.length ? 'Tippe auf eine eigene Anmerkung, um sie zu bearbeiten oder zu verschieben.' : 'Wähle oben ein Werkzeug.'}</span>`));
    }
  }

  async function chooseStamp() {
    const { pickAsset } = await import('./sigstore.js');
    const a = await pickAsset({ tab: 'stamp', title: 'Stempel oder Unterschrift' });
    if (!a) return false;
    const key = `s${assets.size + 1}-${Date.now().toString(36)}`;
    assets.set(key, a);
    pendingAsset = key;
    return true;
  }
  function setTool(t) {
    if (t === 'stamp') {
      chooseStamp().then(ok => { if (ok) setToolInner('stamp'); });
      return;
    }
    setToolInner(t);
  }
  function setToolInner(t) {
    tool = t;
    toolbar.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
    stageEl.classList.toggle('drawing', t !== 'select');
    stageEl.dataset.mode = t;
    if (t !== 'select') select(null, false);
    renderProps();
  }

  // ---------- model ----------
  function commit() {
    undoStack.push(JSON.stringify(annots));
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
    updateButtons();
  }
  function restore(json) {
    const pagesBefore = new Set(annots.map(a => a.page));
    annots = JSON.parse(json);
    selected = null;
    const pagesAfter = new Set(annots.map(a => a.page));
    new Set([...pagesBefore, ...pagesAfter]).forEach(renderPage);
    renderProps();
    updateButtons();
  }
  function undo() { if (!undoStack.length) return; redoStack.push(JSON.stringify(annots)); restore(undoStack.pop()); }
  function redo() { if (!redoStack.length) return; undoStack.push(JSON.stringify(annots)); restore(redoStack.pop()); }
  function addAnnot(a) { commit(); a.id = nid(); annots.push(a); renderPage(a.page); updateButtons(); return a; }
  function removeAnnot(a) {
    commit();
    annots = annots.filter(x => x.id !== a.id);
    if (selected && selected.id === a.id) selected = null;
    renderPage(a.page);
    renderProps();
    updateButtons();
  }
  function updateButtons() {
    undoBtn.disabled = !undoStack.length;
    redoBtn.disabled = !redoStack.length;
    const n = annots.length;
    saveBtn.disabled = !n;
    updateFoot(screen, [saveBtn], n ? `${n} Anmerkung${n === 1 ? '' : 'en'}` : 'Noch keine Anmerkungen');
  }

  function bboxOf(a, p) {
    switch (a.type) {
      case 'highlight': case 'underline': case 'strike': {
        const pts = a.quads.flatMap(q => [0, 2, 4, 6].map(i => p.base.convertToViewportPoint(q[i], q[i + 1])));
        return box(pts);
      }
      case 'ink': return box(a.paths.flat(), a.width / 2);
      case 'text': { const m = measure(a.text || ' ', a.size); return { x0: a.x, y0: a.y, x1: a.x + m.w, y1: a.y + m.h }; }
      case 'note': return { x0: a.x, y0: a.y, x1: a.x + 20, y1: a.y + 20 };
      case 'stamp': return { x0: Math.min(a.x0, a.x1), y0: Math.min(a.y0, a.y1), x1: Math.max(a.x0, a.x1), y1: Math.max(a.y0, a.y1) };
      default: return { x0: Math.min(a.x0, a.x1) - a.width / 2, y0: Math.min(a.y0, a.y1) - a.width / 2, x1: Math.max(a.x0, a.x1) + a.width / 2, y1: Math.max(a.y0, a.y1) + a.width / 2 };
    }
  }
  function box(pts, pad = 0) {
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    return { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad };
  }

  function hitTest(p, x, y) {
    const tol = 8 / stage.scale;
    for (let i = annots.length - 1; i >= 0; i--) {
      const a = annots[i];
      if (a.page !== p.num) continue;
      if (a.type === 'ink') {
        for (const path of a.paths) {
          if (path.length === 1 && Math.hypot(path[0][0] - x, path[0][1] - y) < a.width / 2 + tol) return a;
          for (let k = 1; k < path.length; k++) if (segDist(x, y, path[k - 1][0], path[k - 1][1], path[k][0], path[k][1]) < a.width / 2 + tol) return a;
        }
        continue;
      }
      if (a.type === 'line' || a.type === 'arrow') {
        if (segDist(x, y, a.x0, a.y0, a.x1, a.y1) < a.width / 2 + tol) return a;
        continue;
      }
      if (MARKUP.includes(a.type)) {
        for (const q of a.quads) {
          const b = box([0, 2, 4, 6].map(k => p.base.convertToViewportPoint(q[k], q[k + 1])));
          if (x >= b.x0 - 2 && x <= b.x1 + 2 && y >= b.y0 - 2 && y <= b.y1 + 2) return a;
        }
        continue;
      }
      const b = bboxOf(a, p);
      if (x >= b.x0 - tol && x <= b.x1 + tol && y >= b.y0 - tol && y <= b.y1 + tol) return a;
    }
    return null;
  }

  // ---------- rendering ----------
  function renderPage(num) {
    const p = stage.pages[num - 1];
    if (!p) return;
    p.svg.textContent = '';
    p.html.textContent = '';
    for (const a of annots) {
      if (a.page !== num) continue;
      const g = drawAnnot(a, p);
      if (g) p.svg.appendChild(g);
    }
    if (selected && selected.page === num) drawSelection(p);
  }

  function drawAnnot(a, p) {
    const g = svgEl('g', { 'data-id': a.id });
    if (MARKUP.includes(a.type)) {
      for (const q of a.quads) {
        const v = [0, 2, 6, 4].map(k => p.base.convertToViewportPoint(q[k], q[k + 1]));
        if (a.type === 'highlight') {
          g.appendChild(svgEl('polygon', { points: v.map(pt => pt.join(',')).join(' '), fill: a.color, 'fill-opacity': 0.45, class: 'pt-hl' }));
        } else {
          const t = a.type === 'underline' ? 0.1 : 0.42;
          const [ul, ur, lr, ll] = v;
          const hgt = Math.hypot(ul[0] - ll[0], ul[1] - ll[1]);
          g.appendChild(svgEl('line', {
            x1: ll[0] + (ul[0] - ll[0]) * t, y1: ll[1] + (ul[1] - ll[1]) * t, x2: lr[0] + (ur[0] - lr[0]) * t, y2: lr[1] + (ur[1] - lr[1]) * t,
            stroke: a.color, 'stroke-width': Math.max(0.6, hgt * 0.065), 'stroke-linecap': 'round',
          }));
        }
      }
    } else if (a.type === 'ink') {
      for (const path of a.paths) g.appendChild(svgEl('path', { d: svgPath(path), fill: 'none', stroke: a.color, 'stroke-width': a.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    } else if (a.type === 'rect') {
      g.appendChild(svgEl('rect', { x: Math.min(a.x0, a.x1), y: Math.min(a.y0, a.y1), width: Math.abs(a.x1 - a.x0), height: Math.abs(a.y1 - a.y0), fill: 'none', stroke: a.color, 'stroke-width': a.width }));
    } else if (a.type === 'ellipse') {
      g.appendChild(svgEl('ellipse', { cx: (a.x0 + a.x1) / 2, cy: (a.y0 + a.y1) / 2, rx: Math.abs(a.x1 - a.x0) / 2, ry: Math.abs(a.y1 - a.y0) / 2, fill: 'none', stroke: a.color, 'stroke-width': a.width }));
    } else if (a.type === 'line' || a.type === 'arrow') {
      g.appendChild(svgEl('line', { x1: a.x0, y1: a.y0, x2: a.x1, y2: a.y1, stroke: a.color, 'stroke-width': a.width, 'stroke-linecap': 'round' }));
      if (a.type === 'arrow') {
        const len = Math.hypot(a.x1 - a.x0, a.y1 - a.y0) || 1;
        const d = [(a.x1 - a.x0) / len, (a.y1 - a.y0) / len];
        const s = Math.max(7, a.width * 3.5);
        const l = [a.x1 - d[0] * s - d[1] * s * 0.55, a.y1 - d[1] * s + d[0] * s * 0.55];
        const r = [a.x1 - d[0] * s + d[1] * s * 0.55, a.y1 - d[1] * s - d[0] * s * 0.55];
        g.appendChild(svgEl('polyline', { points: `${l.join(',')} ${a.x1},${a.y1} ${r.join(',')}`, fill: 'none', stroke: a.color, 'stroke-width': a.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      }
    } else if (a.type === 'text') {
      const el = h('<div class="pt-text" role="textbox" aria-label="Textfeld"></div>');
      el.textContent = a.text;
      el.dataset.id = a.id;
      Object.assign(el.style, { left: `calc(var(--s) * ${a.x}px)`, top: `calc(var(--s) * ${a.y}px)`, fontSize: `calc(var(--s) * ${a.size}px)`, color: a.color, padding: `calc(var(--s) * ${TEXT_PAD}px)` });
      p.html.appendChild(el);
      a._el = el;
      return null;
    } else if (a.type === 'stamp') {
      const as = assets.get(a.asset);
      if (as) g.appendChild(svgEl('image', { href: as.url, x: Math.min(a.x0, a.x1), y: Math.min(a.y0, a.y1), width: Math.abs(a.x1 - a.x0), height: Math.abs(a.y1 - a.y0), preserveAspectRatio: 'none' }));
    } else if (a.type === 'note') {
      const el = h(`<button type="button" class="pt-note" aria-label="Notiz: ${esc(a.text)}" title="${esc(a.text)}">${icon('note')}</button>`);
      el.dataset.id = a.id;
      Object.assign(el.style, { left: `calc(var(--s) * ${a.x}px)`, top: `calc(var(--s) * ${a.y}px)`, '--nc': a.color });
      p.html.appendChild(el);
      return null;
    }
    return g;
  }

  function svgPath(pts) {
    if (!pts.length) return '';
    if (pts.length === 1) return `M${pts[0][0]} ${pts[0][1]}l0.01 0`;
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      d += `Q${pts[i][0]} ${pts[i][1]} ${mx} ${my}`;
    }
    const l = pts[pts.length - 1];
    return d + `L${l[0]} ${l[1]}`;
  }

  function drawSelection(p) {
    const b = bboxOf(selected, p);
    const pad = 4 / stage.scale;
    p.svg.appendChild(svgEl('rect', { x: b.x0 - pad, y: b.y0 - pad, width: b.x1 - b.x0 + 2 * pad, height: b.y1 - b.y0 + 2 * pad, class: 'pt-selrect', fill: 'none' }));
    if (!MARKUP.includes(selected.type) && editingId !== selected.id) {
      const handle = h('<div class="pt-selbox" aria-hidden="true"></div>');
      Object.assign(handle.style, {
        left: `calc(var(--s) * ${b.x0 - pad}px)`, top: `calc(var(--s) * ${b.y0 - pad}px)`,
        width: `calc(var(--s) * ${b.x1 - b.x0 + 2 * pad}px)`, height: `calc(var(--s) * ${b.y1 - b.y0 + 2 * pad}px)`,
      });
      handle.dataset.id = selected.id;
      p.html.appendChild(handle);
    }
  }

  function select(a, render = true) {
    const prev = selected;
    selected = a;
    if (render) {
      if (prev) renderPage(prev.page);
      if (a && (!prev || prev.page !== a.page)) renderPage(a.page);
    } else if (prev) renderPage(prev.page);
    renderProps();
  }

  // ---------- notes & text ----------
  async function noteDialog(text = '') {
    const r = await openDialog({
      title: 'Notiz',
      body: `<label class="field"><span class="field-label">Kommentar</span><textarea class="input pt-textarea" rows="5" autofocus>${esc(text)}</textarea></label>`,
      actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Speichern', value: 'ok', kind: 'btn-primary', default: true }],
      onMount: dlg => ({ collect: () => dlg.querySelector('textarea').value }),
    });
    return r.value === 'ok' ? r.data : null;
  }
  async function editNote(a) {
    const t = await noteDialog(a.text);
    if (t === null) return;
    if (!t.trim()) { removeAnnot(a); return; }
    commit(); a.text = t; renderPage(a.page);
  }
  function p_html_cleanup(a) {
    const p = stage.pages[a.page - 1];
    p && p.html.querySelectorAll('.pt-selbox').forEach(x => x.remove());
  }
  function editText(a) {
    renderPage(a.page);
    const el = a._el;
    if (!el) return;
    const before = JSON.stringify(annots);
    editingId = a.id;
    p_html_cleanup(a);
    el.contentEditable = 'true';
    el.classList.add('editing');
    el.focus();
    const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    const onInput = () => { a.text = el.innerText.replace(/\n$/, ''); };
    el.addEventListener('input', onInput);
    el.addEventListener('keydown', e => { if (e.key === 'Escape') el.blur(); e.stopPropagation(); });
    el.addEventListener('blur', () => {
      editingId = null;
      el.removeEventListener('input', onInput);
      a.text = el.innerText.replace(/\n+$/, '');
      if (JSON.stringify(annots) !== before) { undoStack.push(before); redoStack.length = 0; }
      if (!a.text.trim()) { annots = annots.filter(x => x.id !== a.id); if (selected === a) selected = null; }
      renderPage(a.page); renderProps(); updateButtons();
    }, { once: true });
  }

  // ---------- pointer interaction ----------
  const pan = createPan(stageEl);
  let gest = null;

  stage.box.addEventListener('pointerdown', async e => {
    if (e.button > 0) return;
    if (e.target.closest('.pt-text.editing')) return;
    const p = stage.pageAt(e);
    if (!p) return;
    if (pan.down(e)) { cancelGesture(); return; }
    const { x, y } = stage.pointIn(p, e);
    const selbox = e.target.closest('.pt-selbox');
    if (tool === 'select' || selbox) {
      const hit = selbox ? annots.find(a => a.id === selbox.dataset.id) : hitTest(p, x, y);
      if (!hit) { select(null); return; }
      const wasSelected = selected && selected.id === hit.id;
      if (!wasSelected) select(hit);
      if (MARKUP.includes(hit.type)) return;
      e.preventDefault();
      stage.box.setPointerCapture(e.pointerId);
      gest = { kind: 'move', p, a: hit, sx: x, sy: y, orig: JSON.parse(JSON.stringify(hit)), before: JSON.stringify(annots), moved: false, wasSelected, pid: e.pointerId };
      return;
    }
    if (tool === 'eraser') {
      e.preventDefault();
      stage.box.setPointerCapture(e.pointerId);
      gest = { kind: 'erase', p, before: JSON.stringify(annots), removed: 0, pid: e.pointerId };
      eraseAt(p, x, y);
      return;
    }
    if (tool === 'text') {
      e.preventDefault();
      const pr = props.text;
      const a = addAnnot({ page: p.num, type: 'text', x, y: y - pr.size * 0.7, text: '', size: pr.size, color: pr.color });
      setTool('select');
      select(a);
      setTimeout(() => editText(a), 20);
      return;
    }
    if (tool === 'stamp' && pendingAsset) {
      e.preventDefault();
      const as = assets.get(pendingAsset);
      const w = Math.min(as.kind === 'initials' ? 70 : as.kind === 'stamp' ? 150 : 170, p.base.width * 0.45, as.w * 0.75);
      const hh = w * as.h / as.w;
      const x0 = Math.max(0, Math.min(p.base.width - w, x - w / 2)), y0 = Math.max(0, Math.min(p.base.height - hh, y - hh / 2));
      const a = addAnnot({ page: p.num, type: 'stamp', asset: pendingAsset, x0, y0, x1: x0 + w, y1: y0 + hh, color: '#000000', kind: as.kind, name: as.name || '' });
      setToolInner('select');
      select(a);
      return;
    }
    if (tool === 'note') {
      e.preventDefault();
      const t = await noteDialog('');
      if (t && t.trim()) { const a = addAnnot({ page: p.num, type: 'note', x: x - 10, y: y - 10, text: t, color: props.note.color }); setTool('select'); select(a); }
      return;
    }
    e.preventDefault();
    stage.box.setPointerCapture(e.pointerId);
    if (MARKUP.includes(tool)) {
      // the text geometry may still be loading: track the gesture right away, decide later
      const g = { kind: 'markpending', p, sx: x, sy: y, x, y, moved: false, pid: e.pointerId };
      gest = g;
      const pt = await charsOf(p);
      if (g.cancelled) return;
      const i = pt.chars.length ? nearestChar(pt.chars, x, y) : -1;
      const near = i >= 0 && (() => { const c = pt.chars[i]; const dx = Math.max(c.x0 - x, 0, x - c.x1), dy = Math.max(c.y0 - y, 0, y - c.y1); return dx < c.fh * 2 && dy < c.fh * 1.2; })();
      if (near) Object.assign(g, { kind: 'markup', pt, i, j: g.moved ? nearestChar(pt.chars, g.x, g.y) : i, preview: svgEl('g', { class: 'pt-preview' }) });
      else Object.assign(g, { kind: 'markrect', preview: svgEl('rect', { class: 'pt-preview-rect' }) });
      if (g.ended) { finish(g, g.endType); return; }
      p.svg.appendChild(g.preview);
      updatePreview();
      return;
    }
    if (tool === 'pen') {
      const pr = props.pen;
      gest = { kind: 'pen', p, pts: [[x, y]], pid: e.pointerId, preview: svgEl('path', { fill: 'none', stroke: pr.color, 'stroke-width': pr.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }) };
      p.svg.appendChild(gest.preview);
      updatePreview();
      return;
    }
    if (SHAPES.includes(tool)) {
      gest = { kind: 'shape', p, x0: x, y0: y, x1: x, y1: y, pid: e.pointerId, preview: svgEl('g') };
      p.svg.appendChild(gest.preview);
    }
  });

  stage.box.addEventListener('pointermove', e => {
    if (pan.move(e)) return;
    if (!gest || e.pointerId !== gest.pid) return;
    const p = gest.p;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) {
      const { x, y } = stage.pointIn(p, ev);
      if (gest.kind === 'pen') {
        const l = gest.pts[gest.pts.length - 1];
        if (Math.hypot(l[0] - x, l[1] - y) > 0.6 / stage.scale) gest.pts.push([x, y]);
      } else if (gest.kind === 'shape') { gest.x1 = x; gest.y1 = y; }
      else if (gest.kind === 'markup') {
        gest.j = nearestChar(gest.pt.chars, x, y);
        if (Math.hypot(x - gest.sx, y - gest.sy) > 3 / stage.scale) gest.moved = true;
      } else if (gest.kind === 'markrect' || gest.kind === 'markpending') {
        gest.x = x; gest.y = y;
        if (Math.hypot(x - gest.sx, y - gest.sy) > 3 / stage.scale) gest.moved = true;
      }
      else if (gest.kind === 'erase') eraseAt(p, x, y);
      else if (gest.kind === 'move') {
        const dx = x - gest.sx, dy = y - gest.sy;
        if (!gest.moved && Math.hypot(dx, dy) * stage.scale < 4) continue;
        gest.moved = true;
        moveAnnot(gest.a, gest.orig, dx, dy);
      }
    }
    if (gest.kind === 'move' && gest.moved) renderPage(p.num);
    else updatePreview();
  });

  const end = e => {
    if (pan.up(e) && !gest) return;
    if (!gest || e.pointerId !== gest.pid) return;
    const g = gest;
    gest = null;
    if (g.kind === 'markpending') { g.ended = true; g.endType = e.type; return; }
    finish(g, e.type);
  };
  function finish(g, type) {
    if (g.preview) g.preview.remove();
    const p = g.p;
    if (type === 'pointercancel' && g.kind !== 'move') { renderPage(p.num); return; }
    if (g.kind === 'pen') {
      const pts = simplify(g.pts, 0.35);
      const last = annots[annots.length - 1];
      // strokes drawn quickly after each other on the same page become one ink annotation
      if (last && last.type === 'ink' && last.page === p.num && last.color === props.pen.color && last.width === props.pen.width && Date.now() - (last._t || 0) < 1200) {
        commit(); last.paths.push(pts); last._t = Date.now(); renderPage(p.num); updateButtons();
      } else {
        const a = addAnnot({ page: p.num, type: 'ink', paths: [pts], color: props.pen.color, width: props.pen.width });
        a._t = Date.now();
      }
    } else if (g.kind === 'shape') {
      const big = Math.hypot(g.x1 - g.x0, g.y1 - g.y0) > 4;
      if (big) addAnnot({ page: p.num, type: tool, x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1, color: props.shape.color, width: props.shape.width });
      else toast('Zum Zeichnen ziehen.', 'info', { timeout: 1800 });
    } else if (g.kind === 'markup') {
      let { i, j } = g;
      if (!g.moved) [i, j] = wordAt(g.pt.chars, i);
      const quads = quadsFor(g.pt.chars, i, j);
      if (quads.length) addAnnot({ page: p.num, type: tool, quads, color: props[tool].color, text: textOf(g.pt.chars, Math.min(i, j), Math.max(i, j)).trim() });
    } else if (g.kind === 'markrect') {
      const x0 = Math.min(g.sx, g.x), x1 = Math.max(g.sx, g.x), y0 = Math.min(g.sy, g.y), y1 = Math.max(g.sy, g.y);
      if (x1 - x0 > 3 && y1 - y0 > 3) {
        const P = (x, y) => p.base.convertToPdfPoint(x, y);
        const quad = [...P(x0, y0), ...P(x1, y0), ...P(x0, y1), ...P(x1, y1)];
        addAnnot({ page: p.num, type: tool, quads: [quad], color: props[tool].color, text: '' });
      } else toast('Kein Text an dieser Stelle – ziehe einen Bereich auf.', 'info', { timeout: 2200 });
    } else if (g.kind === 'erase') {
      if (g.removed) { undoStack.push(g.before); redoStack.length = 0; } updateButtons();
    } else if (g.kind === 'move') {
      if (g.moved) { undoStack.push(g.before); redoStack.length = 0; updateButtons(); renderPage(p.num); }
      else if (g.wasSelected && g.a.type === 'text') editText(g.a);
      else if (g.wasSelected && g.a.type === 'note') editNote(g.a);
    }
    renderProps();
  }
  stage.box.addEventListener('pointerup', end);
  stage.box.addEventListener('pointercancel', end);

  function cancelGesture() {
    if (!gest) return;
    gest.cancelled = true;
    if (gest.preview) gest.preview.remove();
    if (gest.kind === 'move' && gest.moved) { annots = JSON.parse(gest.before); }
    const n = gest.p.num;
    gest = null;
    renderPage(n);
  }

  function wordAt(chars, i) {
    const isW = c => c && /[\p{L}\p{N}\-_'’]/u.test(c.ch);
    if (!isW(chars[i])) return [i, i];
    let a = i, b = i;
    while (a > 0 && isW(chars[a - 1]) && chars[a - 1].line === chars[i].line) a--;
    while (b < chars.length - 1 && isW(chars[b + 1]) && chars[b + 1].line === chars[i].line) b++;
    return [a, b];
  }

  function updatePreview() {
    if (!gest || !gest.preview) return;
    const g = gest, p = g.p;
    if (g.kind === 'pen') g.preview.setAttribute('d', svgPath(g.pts));
    else if (g.kind === 'markrect') {
      Object.entries({ x: Math.min(g.sx, g.x), y: Math.min(g.sy, g.y), width: Math.abs(g.x - g.sx), height: Math.abs(g.y - g.sy), fill: props[tool].color }).forEach(([k, v]) => g.preview.setAttribute(k, v));
    } else if (g.kind === 'markup') {
      g.preview.textContent = '';
      const [i, j] = g.moved ? [g.i, g.j] : wordAt(g.pt.chars, g.i);
      for (const q of quadsFor(g.pt.chars, i, j)) {
        const v = [0, 2, 6, 4].map(k => p.base.convertToViewportPoint(q[k], q[k + 1]));
        g.preview.appendChild(svgEl('polygon', { points: v.map(pt => pt.join(',')).join(' '), class: 'pt-sel-poly' }));
      }
    } else if (g.kind === 'shape') {
      g.preview.textContent = '';
      const tmp = drawAnnot({ type: tool, x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1, color: props.shape.color, width: props.shape.width }, p);
      if (tmp) g.preview.appendChild(tmp);
    }
  }

  function eraseAt(p, x, y) {
    const hit = hitTest(p, x, y);
    if (!hit) return;
    annots = annots.filter(a => a.id !== hit.id);
    gest.removed++;
    if (selected && selected.id === hit.id) selected = null;
    renderPage(p.num);
  }

  function moveAnnot(a, o, dx, dy) {
    const p = stage.pages[a.page - 1];
    const W = p.base.width, H = p.base.height;
    // keep at least part of the annotation on the page
    const b = bboxOf(o, p);
    dx = Math.max(-b.x1 + 10, Math.min(W - b.x0 - 10, dx));
    dy = Math.max(-b.y1 + 10, Math.min(H - b.y0 - 10, dy));
    if (a.type === 'ink') a.paths = o.paths.map(path => path.map(([x, y]) => [x + dx, y + dy]));
    else if (a.type === 'text' || a.type === 'note') { a.x = o.x + dx; a.y = o.y + dy; }
    else if ('x0' in a) { a.x0 = o.x0 + dx; a.x1 = o.x1 + dx; a.y0 = o.y0 + dy; a.y1 = o.y1 + dy; }
  }

  // keyboard
  const onKey = e => {
    if (e.target.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('dialog[open]')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); removeAnnot(selected); }
    else if (e.key === 'Escape') { if (selected) select(null); else setTool('select'); }
  };
  window.addEventListener('keydown', onKey);

  // ---------- save ----------
  const saveBtn = h(`<button class="btn btn-primary" type="button">${icon('check')} Speichern</button>`);
  saveBtn.addEventListener('click', async () => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    const items = annots.filter(a => a.type !== 'text' || (a.text && a.text.trim()));
    if (!items.length) return;
    saveBtn.disabled = true;
    const prog = progress('Speichere Anmerkungen …');
    try {
      const PDFLib = await loadPdfLib();
      const pdfDoc = await loadEditable(bytes, doc.name, { key: docId });
      await writeAnnotations(PDFLib, pdfDoc, items, stage.pages, { assets });
      const out = await saveDoc(pdfDoc);
      const res = await saveResult(out, `${baseName(doc.name)} (kommentiert).pdf`);
      savedSnapshot = JSON.stringify(annots);
      showResult(res);
      toast('Anmerkungen gespeichert.', 'success');
    } catch (e) { errorToast(e, 'Speichern fehlgeschlagen.'); }
    finally { prog.done(); saveBtn.disabled = !annots.length; }
  });

  function showResult(res) {
    stageEl.querySelectorAll('.pt-result').forEach(x => x.remove());
    const wrap = h('<div class="pt-result screen-inner"></div>');
    const card = resultCard(res, { from: docId, title: 'Gespeichert', note: `${annots.length} Anmerkung${annots.length === 1 ? '' : 'en'}` });
    const close = h(`<button class="icon-btn pt-result-x" type="button" aria-label="Hinweis schließen">${icon('close')}</button>`);
    close.addEventListener('click', () => wrap.remove());
    card.appendChild(close);
    wrap.appendChild(card);
    stageEl.prepend(wrap);
    stageEl.scrollTo({ top: 0, behavior: 'smooth' });
  }

  guardLeave(screen, () => annots.length > 0 && JSON.stringify(annots) !== savedSnapshot);
  setTool('highlight');
  updateButtons();
  stage.pages.forEach(p => renderPage(p.num));

  return () => {
    window.removeEventListener('keydown', onKey);
    assets.forEach(a => { if (a.url) URL.revokeObjectURL(a.url); });
    stage.destroy();
    pdf.destroy();
  };
}
