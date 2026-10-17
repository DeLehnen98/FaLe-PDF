// Touch placement of items (signatures, initials, text, check marks) on a page preview: drag to move,
// corner handle (or two-finger pinch) to resize, top handle (or two-finger twist) to rotate, keyboard
// alternative (arrows, +/−, [ ], Delete). Items are stored independent of the preview size:
//   {id, page (1-based), kind: 'image'|'text'|'check'|'cross', cx, cy (0..1 of the displayed page),
//    w, h (pt), rot (° clockwise), asset ({url, aspect}) | text + fontPt, color}
// kind 'field' (form fields): a labelled box; items with free: true resize width and height independently and
// do not rotate.
import { el, clear } from './dom.js';
import { tr, ic, btn, pageNav, previewPage, wipeCanvas, stageWidth } from './sec-ui.js';

let measureCtx = null;
/** Width (pt) of Helvetica text at size – same metrics family as the burned-in text. */
export function textWidth(text, size) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = `${size * 10}px Helvetica, Arial, "Liberation Sans", sans-serif`;
  return measureCtx.measureText(String(text)).width / 10;
}
export function sizeText(item) {
  item.w = Math.max(8, textWidth(item.text || ' ', item.fontPt) + 4);
  item.h = item.fontPt * 1.25;
}

const NS = 'http://www.w3.org/2000/svg';
function markSvg(kind) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 100 100'); s.setAttribute('class', 'sec-markic'); s.setAttribute('aria-hidden', 'true');
  s.setAttribute('preserveAspectRatio', 'none');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', kind === 'cross' ? 'M15 15L85 85M15 85L85 15' : 'M10 50L38 82L92 15');
  p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '12');
  p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round'); p.setAttribute('vector-effect', 'non-scaling-stroke');
  s.append(p);
  return s;
}

/**
 * @param {{lang, pdf, items: Array, onChange: Function, onSelect?: Function, label?: (item) => string}} o
 */
export function createPlacer({ lang, pdf, items, onChange, onSelect = null, label = null, hint: hintText = null }) {
  const L = lang;
  let selected = null, cur = null, seq = 0;
  const nav = pageNav(L, n => show(n));
  const pageBox = el('div', { class: 'sec-page' });
  const overlay = el('div', { class: 'sec-overlay' });
  const hint = el('p', { class: 'sec-hint-row' }, hintText || tr(L, 'Ziehen zum Verschieben · Ecke zum Vergrößern · runder Griff oben zum Drehen · zwei Finger zum Zoomen und Drehen',
    'Drag to move · corner to resize · round handle on top to rotate · two fingers to zoom and rotate'));
  const root = el('div', { class: 'sec-stage' }, nav.node, el('div', { class: 'sec-page-wrap' }, pageBox), hint);
  const nodes = new Map();

  async function show(n) {
    const my = ++seq;
    const r = await previewPage(pdf, n, Math.max(200, stageWidth(root.parentElement || root, 720) - 30));
    if (my !== seq) { wipeCanvas(r.canvas); return; }
    if (cur) wipeCanvas(cur.canvas);
    cur = r;
    pageBox.style.width = r.canvas.style.width;
    clear(pageBox).append(r.canvas, overlay);
    if (selected && selected.page !== n) select(null);
    draw();
  }

  const px = () => ({ W: parseFloat(cur.canvas.style.width), H: parseFloat(cur.canvas.style.height), s: cur.scale });

  function layout(item, node) {
    const { W, H, s } = px();
    const w = item.w * s, h = item.h * s;
    Object.assign(node.style, { width: `${w}px`, height: `${h}px`, transform: `translate(${item.cx * W - w / 2}px, ${item.cy * H - h / 2}px) rotate(${item.rot || 0}deg)` });
    if (item.kind === 'text') node.querySelector('.sec-item-text').style.fontSize = `${item.fontPt * s}px`;
    if (item.kind === 'field') { const n = node.querySelector('.sec-fld-name'); if (n) n.style.fontSize = `${Math.max(7, Math.min(12, (item.type === 'radio' || item.type === 'multiline' ? 19 : item.h) * s * 0.62))}px`; }
    node.style.color = item.color || '#111';
  }

  function itemLabel(item) {
    const what = label ? label(item) : item.kind;
    return tr(L, `${what} auf Seite ${item.page}. Pfeiltasten verschieben, Plus und Minus ändern die Größe, eckige Klammern drehen, Entfernen löscht.`,
      `${what} on page ${item.page}. Arrow keys move, plus and minus resize, square brackets rotate, Delete removes.`);
  }

  function draw() {
    if (!cur) return;
    clear(overlay);
    nodes.clear();
    for (const item of items.filter(i => i.page === nav.page)) {
      const body = el('div', { class: 'sec-item-body' });
      if (item.kind === 'image') body.append(el('img', { src: item.asset.url, alt: '', draggable: 'false' }));
      else if (item.kind === 'text') body.append(el('span', { class: 'sec-item-text' }, item.text));
      else if (item.kind === 'field') { body.classList.add('sec-fld', `sec-fld-${item.type}`); body.append(el('span', { class: 'sec-fld-name' }, item.name || '')); }
      else body.append(markSvg(item.kind));
      const size = el('div', { class: 'sec-handle sec-h-size', 'aria-hidden': 'true' });
      const rot = el('div', { class: 'sec-handle sec-h-rot', 'aria-hidden': 'true' });
      const node = el('div', { class: 'sec-item' + (item === selected ? ' is-sel' : '') + (item.free ? ' is-free' : ''), tabindex: '0', role: 'button', aria: { label: itemLabel(item) } }, body, size, rot);
      node._item = item;
      layout(item, node);
      bind(node, item, size, rot);
      overlay.append(node);
      nodes.set(item.id, node);
    }
  }

  function changed(item) {
    const n = nodes.get(item.id);
    if (n) layout(item, n);
    onChange?.(items);
  }

  function clampItem(item) {
    item.cx = Math.max(0, Math.min(1, item.cx));
    item.cy = Math.max(0, Math.min(1, item.cy));
    const vp = cur?.vp;
    if (vp) {
      const max = Math.max(vp.width, vp.height) * 1.2;
      if (item.w > max) { const f = max / item.w; item.w *= f; item.h *= f; if (item.fontPt) item.fontPt *= f; }
    }
  }

  function scaleItem(item, f, base = null) {
    const b = base || { w: item.w, h: item.h, fontPt: item.fontPt };
    const nf = Math.max(6 / Math.min(b.w, b.h), f);
    item.w = b.w * nf; item.h = b.h * nf;
    if (item.kind === 'text') { item.fontPt = Math.max(4, b.fontPt * nf); sizeText(item); }
    clampItem(item);
  }

  function select(item) {
    selected = item;
    for (const [, n] of nodes) n.classList.toggle('is-sel', n._item === item);
    onSelect?.(item);
  }

  function bind(node, item, sizeH, rotH) {
    const pts = new Map();
    let start = null;
    const center = () => { const r = pageBox.getBoundingClientRect(); const { W, H } = px(); return [r.left + item.cx * W, r.top + item.cy * H]; };
    node.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      node.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (selected !== item) select(item);
      node.focus({ preventScroll: true });
      const mode = e.target === sizeH ? 'size' : e.target === rotH ? 'rot' : 'move';
      const [cx, cy] = center();
      start = { mode, x: e.clientX, y: e.clientY, cx: item.cx, cy: item.cy, w: item.w, h: item.h, fontPt: item.fontPt, rot: item.rot || 0,
        dist: Math.hypot(e.clientX - cx, e.clientY - cy) || 1, ang: Math.atan2(e.clientY - cy, e.clientX - cx) };
      if (pts.size === 2) startPinch();
    });
    let pinch = null;
    function startPinch() {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, ang: Math.atan2(b[1] - a[1], b[0] - a[0]), w: item.w, h: item.h, fontPt: item.fontPt, rot: item.rot || 0 };
    }
    node.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId) || !start) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        scaleItem(item, d / pinch.d, pinch);
        if (item.kind !== 'box' && !item.free) item.rot = snap(pinch.rot + (ang - pinch.ang) * 180 / Math.PI);
        changed(item);
        return;
      }
      const { W, H } = px();
      if (start.mode === 'move') {
        item.cx = start.cx + (e.clientX - start.x) / W;
        item.cy = start.cy + (e.clientY - start.y) / H;
        clampItem(item);
      } else if (start.mode === 'size' && item.free) {
        // free resize from the bottom-right corner: the top-left corner stays where it is
        const { s } = px();
        const w = Math.max(6, start.w + (e.clientX - start.x) / s), h = Math.max(6, start.h + (e.clientY - start.y) / s);
        item.cx = start.cx + (w - start.w) * s / 2 / W;
        item.cy = start.cy + (h - start.h) * s / 2 / H;
        item.w = w; item.h = h;
        clampItem(item);
      } else if (start.mode === 'size') {
        const [cx, cy] = center();
        scaleItem(item, Math.hypot(e.clientX - cx, e.clientY - cy) / start.dist, start);
      } else {
        const [cx, cy] = center();
        const ang = Math.atan2(e.clientY - cy, e.clientX - cx);
        item.rot = snap(start.rot + (ang - start.ang) * 180 / Math.PI);
      }
      changed(item);
    });
    const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) start = null; };
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
    node.addEventListener('keydown', e => {
      const step = e.shiftKey ? 0.05 : 0.005;
      let handled = true;
      switch (e.key) {
        case 'ArrowLeft': item.cx -= step; break;
        case 'ArrowRight': item.cx += step; break;
        case 'ArrowUp': item.cy -= step; break;
        case 'ArrowDown': item.cy += step; break;
        case '+': case '=': scaleItem(item, 1.08); break;
        case '-': case '_': scaleItem(item, 1 / 1.08); break;
        case ']': if (!item.free) item.rot = snap((item.rot || 0) + 5); break;
        case '[': if (!item.free) item.rot = snap((item.rot || 0) - 5); break;
        case 'Delete': case 'Backspace': remove(item); return;
        case 'Escape': select(null); break;
        default: handled = false;
      }
      if (!handled) return;
      e.preventDefault();
      clampItem(item);
      changed(item);
    });
    node.addEventListener('focus', () => { if (selected !== item) select(item); });
  }

  const snap = deg => {
    let d = ((deg % 360) + 360) % 360;
    for (const s of [0, 90, 180, 270, 360]) if (Math.abs(d - s) < 4) d = s % 360;
    return Math.round(d * 10) / 10;
  };

  pageBox.addEventListener('pointerdown', e => { if (e.target === pageBox || e.target === overlay || e.target === cur?.canvas) select(null); });

  function add(item) {
    items.push(item);
    if (nav.page !== item.page) { nav.set(item.page); show(item.page).then(() => { select(item); nodes.get(item.id)?.focus({ preventScroll: true }); }); }
    else { draw(); select(item); nodes.get(item.id)?.focus({ preventScroll: true }); }
    onChange?.(items);
  }
  function remove(item) {
    const i = items.indexOf(item);
    if (i >= 0) items.splice(i, 1);
    if (selected === item) select(null);
    draw();
    onChange?.(items);
  }

  nav.set(1, pdf.numPages);
  requestAnimationFrame(() => show(1));
  return {
    root, nav, add, remove, draw, select,
    get page() { return nav.page; },
    get selected() { return selected; },
    get viewport() { return cur?.vp || null; },
    update(item) { changed(item); },
    scale(item, f) { scaleItem(item, f); changed(item); },
    rotate(item, d) { item.rot = snap((item.rot || 0) + d); changed(item); },
    destroy() { if (cur) wipeCanvas(cur.canvas); },
  };
}

export { btn, ic };
