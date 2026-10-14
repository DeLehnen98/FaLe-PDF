// Lightweight page stage (pdf.js canvases + an overlay layer per page) for placing and filling
// signature fields. Coordinates of fields are in viewport units at scale 1 (like js/tools/sign.js).
import { h } from '../ui.js';
import { renderPage } from '../pdfcore.js';

export async function mountPages(stage, pdf, { onLayout, maxWidth = 900 } = {}) {
  const box = h('<div class="sh-pages"></div>');
  stage.appendChild(box);
  const pages = [];
  let alive = true;
  let scale = 1;
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    if (!alive) break;
    const base = page.getViewport({ scale: 1 });
    const el = h(`<div class="sh-page" data-page="${n}" aria-label="Seite ${n}"><div class="sh-layer"></div></div>`);
    box.appendChild(el);
    pages.push({ num: n, page, base, el, layer: el.querySelector('.sh-layer'), drawn: false });
  }
  const computeScale = () => Math.max(0.3, Math.min(stage.clientWidth - 24, maxWidth) / pages[0].base.width);
  function layout() {
    pages.forEach(p => { p.el.style.width = `${Math.floor(p.base.width * scale)}px`; p.el.style.height = `${Math.floor(p.base.height * scale)}px`; });
    onLayout && onLayout(scale);
  }
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => { if (en.isIntersecting) { io.unobserve(en.target); draw(pages[+en.target.dataset.page - 1]); } });
  }, { root: null, rootMargin: '800px 0px' });
  async function draw(p) {
    try {
      const c = await renderPage(p.page, { scale, dpr: Math.min(2, window.devicePixelRatio || 1) });
      if (!alive) return;
      p.el.querySelector('canvas')?.remove();
      p.el.prepend(c);
      p.drawn = true;
    } catch (e) { if (alive) console.warn(e); }
  }
  scale = computeScale();
  layout();
  pages.forEach((p, i) => { if (i < 3) draw(p); else io.observe(p.el); }); // first pages right away (they may sit below a long form)
  const ro = new ResizeObserver(() => {
    const s = computeScale();
    if (Math.abs(s - scale) / scale < 0.04) return;
    scale = s;
    pages.forEach((p, i) => { p.drawn = false; if (i < 3) draw(p); else io.observe(p.el); });
    layout();
  });
  ro.observe(stage);
  return {
    pages,
    get scale() { return scale; },
    destroy() { alive = false; io.disconnect(); ro.disconnect(); },
  };
}

/** Pointer drag (move) + resize handle for an absolutely positioned item in page units. */
export function makeDraggable(el, item, { getScale, bounds, onChange, minW = 30, minH = 14 }) {
  let start = null;
  el.addEventListener('pointerdown', e => {
    if (e.target.closest('[data-nodrag]')) return;
    const resize = !!e.target.closest('[data-resize]');
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY, ix: item.x, iy: item.y, w: item.w, h: item.h, resize, moved: false };
  });
  el.addEventListener('pointermove', e => {
    if (!start) return;
    const s = getScale();
    const dx = (e.clientX - start.x) / s, dy = (e.clientY - start.y) / s;
    if (!start.moved && Math.hypot(dx * s, dy * s) < 3) return;
    start.moved = true;
    const b = bounds();
    if (start.resize) {
      item.w = Math.max(minW, Math.min(b.w - item.x, start.w + dx));
      item.h = Math.max(minH, Math.min(b.h - item.y, start.h + dy));
    } else {
      item.x = Math.max(0, Math.min(b.w - item.w, start.ix + dx));
      item.y = Math.max(0, Math.min(b.h - item.h, start.iy + dy));
    }
    onChange && onChange(false);
  });
  const end = () => { if (start && start.moved) onChange && onChange(true); start = null; };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}
