// Touch crop box over a displayed image (crop-image, image-to-text region). The rectangle is kept in
// normalised coordinates (0..1 of the displayed image) so it survives re-layout and maps to any
// resolution. Drag inside = move, 8 handles (44 px touch targets) = resize, optional aspect lock.
// Keyboard: arrows move (Shift = 10 ×), Alt/Ctrl + arrows resize the right/bottom edge.
import { el } from './dom.js';
import { T } from './new-ui.js';

const MIN_PX = 24;

export function createCropBox({ lang, onChange = () => {}, label = { de: 'Zuschnitt-Rahmen', en: 'Crop frame' } }) {
  const canvas = el('canvas', { class: 'new-ed-canvas', 'aria-hidden': 'true' });
  const sizeTag = el('span', { class: 'new-ed-size', 'aria-hidden': 'true' });
  const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(h => el('span', { class: 'new-ed-h', dataset: { h } }));
  const box = el('div', { class: 'new-ed-crop', tabindex: '0', role: 'slider', aria: { label: T(lang, label), valuetext: '' } }, handles);
  const frame = el('div', { class: 'new-ed-frame' }, canvas, box, sizeTag);
  frame.style.position = 'relative';
  let rect = { x: 0, y: 0, w: 1, h: 1 };
  let aspect = null;          // w/h in output pixels, or null = free
  let full = { w: 1, h: 1 };  // output pixel size of the whole (transformed) image
  let enabled = true;

  const aspectN = () => (aspect ? aspect * full.h / full.w : null);
  const minN = () => ({ w: MIN_PX / Math.max(1, frame.clientWidth), h: MIN_PX / Math.max(1, frame.clientHeight) });

  function paint() {
    box.hidden = !enabled;
    sizeTag.hidden = !enabled;
    box.style.left = `${rect.x * 100}%`; box.style.top = `${rect.y * 100}%`;
    box.style.width = `${rect.w * 100}%`; box.style.height = `${rect.h * 100}%`;
    const px = pixels();
    sizeTag.textContent = `${px.w} × ${px.h}`;
    box.setAttribute('aria-valuetext', T(lang, { de: `Ausschnitt ${px.w} × ${px.h} Pixel ab ${px.x}, ${px.y}`, en: `Selection ${px.w} × ${px.h} pixels from ${px.x}, ${px.y}` }));
  }
  function pixels() {
    const x = Math.round(rect.x * full.w), y = Math.round(rect.y * full.h);
    return { x, y, w: Math.max(1, Math.min(full.w - x, Math.round(rect.w * full.w))), h: Math.max(1, Math.min(full.h - y, Math.round(rect.h * full.h))) };
  }
  const emit = () => { paint(); onChange({ ...rect }); };

  /** Largest rect with the aspect, centred on (cx, cy), scaled by f, inside the image. */
  function fitAspect(cx = 0.5, cy = 0.5, f = 1) {
    const a = aspectN();
    if (!a) return;
    let w = 1, h = 1 / a;
    if (h > 1) { h = 1; w = a; }
    w *= f; h *= f;
    rect = clampMove({ x: cx - w / 2, y: cy - h / 2, w, h });
  }
  const mismatch = () => { const a = aspectN(); return !!a && Math.abs(rect.w / rect.h / a - 1) > 0.01; };
  const clampMove = r => ({ ...r, x: Math.min(Math.max(0, r.x), 1 - r.w), y: Math.min(Math.max(0, r.y), 1 - r.h) });

  function resize(start, h, dx, dy) {
    const m = minN();
    let { x, y, w, h: hh } = start;
    let x1 = x + w, y1 = y + hh;
    if (h.includes('w')) x = Math.min(x1 - m.w, Math.max(0, x + dx));
    if (h.includes('e')) x1 = Math.max(x + m.w, Math.min(1, x1 + dx));
    if (h.includes('n')) y = Math.min(y1 - m.h, Math.max(0, y + dy));
    if (h.includes('s')) y1 = Math.max(y + m.h, Math.min(1, y1 + dy));
    let r = { x, y, w: x1 - x, h: y1 - y };
    const a = aspectN();
    if (a) {
      // keep the aspect: the dominant change wins, the opposite edge/corner stays anchored
      const horiz = h === 'e' || h === 'w' || (h.length === 2 && Math.abs(dx) >= Math.abs(dy));
      let W = horiz ? r.w : r.h * a, H = W / a;
      const ax = h.includes('w') ? start.x + start.w : h.includes('e') ? start.x : start.x + start.w / 2;
      const ay = h.includes('n') ? start.y + start.h : h.includes('s') ? start.y : start.y + start.h / 2;
      const maxW = h.includes('w') ? ax : h.includes('e') ? 1 - ax : 2 * Math.min(ax, 1 - ax);
      const maxH = h.includes('n') ? ay : h.includes('s') ? 1 - ay : 2 * Math.min(ay, 1 - ay);
      const k = Math.min(1, maxW / W, maxH / H);
      W *= k; H *= k;
      if (W < m.w) { W = m.w; H = W / a; }
      if (H < m.h) { H = m.h; W = H * a; }
      r = {
        x: h.includes('w') ? ax - W : h.includes('e') ? ax : ax - W / 2,
        y: h.includes('n') ? ay - H : h.includes('s') ? ay : ay - H / 2,
        w: W, h: H,
      };
      r = clampMove(r);
    }
    return r;
  }

  // pointer interaction
  let drag = null;
  frame.addEventListener('pointerdown', ev => {
    if (!enabled || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    const hEl = ev.target.closest('.new-ed-h');
    const inBox = ev.target === box || box.contains(ev.target);
    if (!hEl && !inBox) return;
    ev.preventDefault();
    drag = { id: ev.pointerId, h: hEl ? hEl.dataset.h : null, x: ev.clientX, y: ev.clientY, start: { ...rect } };
    try { frame.setPointerCapture(ev.pointerId); } catch { /* optional */ }
    box.focus({ preventScroll: true });
  });
  frame.addEventListener('pointermove', ev => {
    if (!drag || ev.pointerId !== drag.id) return;
    const dx = (ev.clientX - drag.x) / Math.max(1, frame.clientWidth), dy = (ev.clientY - drag.y) / Math.max(1, frame.clientHeight);
    rect = drag.h ? resize(drag.start, drag.h, dx, dy) : clampMove({ ...drag.start, x: drag.start.x + dx, y: drag.start.y + dy });
    paint();
  });
  const end = ev => { if (drag && ev.pointerId === drag.id) { drag = null; emit(); } };
  frame.addEventListener('pointerup', end);
  frame.addEventListener('pointercancel', end);
  box.addEventListener('keydown', ev => {
    const step = ev.shiftKey ? 0.1 : 0.01;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
    if (!d) return;
    ev.preventDefault();
    rect = ev.altKey || ev.ctrlKey ? resize(rect, d[0] ? 'e' : 's', d[0], d[1]) : clampMove({ ...rect, x: rect.x + d[0], y: rect.y + d[1] });
    emit();
  });

  return {
    root: frame,
    canvas,
    /** Show a drawable; fullW/fullH = output pixel size it stands for. Keeps the rect. */
    show(src, fullW, fullH, maxCssW, maxCssH) {
      full = { w: Math.max(1, Math.round(fullW)), h: Math.max(1, Math.round(fullH)) };
      const f = Math.min(maxCssW / full.w, maxCssH / full.h, 1e9);
      const cssW = Math.max(40, Math.floor(full.w * f)), cssH = Math.max(40, Math.floor(full.h * f));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
      const g = canvas.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, 0, 0, canvas.width, canvas.height);
      canvas.style.width = `${cssW}px`; canvas.style.height = `${cssH}px`;
      frame.style.width = `${cssW}px`; frame.style.height = `${cssH}px`;
      if (mismatch()) { const r = rect; fitAspect(r.x + r.w / 2, r.y + r.h / 2, Math.max(0.3, Math.max(r.w, r.h))); }
      paint();
    },
    get rect() { return { ...rect }; },
    set rect(r) { rect = clampMove({ x: r.x, y: r.y, w: Math.min(1, r.w), h: Math.min(1, r.h) }); paint(); },
    pixels,
    /** refit: 'always' (new centred frame), 'mismatch' (only if the current frame has another ratio). */
    setAspect(a, refit = 'always') { aspect = a || null; if (aspect && (refit === 'always' || mismatch())) fitAspect(0.5, 0.5, 1); emit(); },
    reset(f = 1) { if (aspect) fitAspect(0.5, 0.5, f); else rect = { x: (1 - f) / 2, y: (1 - f) / 2, w: f, h: f }; emit(); },
    setEnabled(on) { enabled = !!on; paint(); },
    get full() { return { ...full }; },
  };
}
