// Justified photo grid with virtual scrolling (10 000+ items): only the rows near the viewport exist in the
// DOM; tiles are positioned absolutely from a precomputed layout. Groups (days) get a header row; the first
// day of a month also shows the month.
import { el, clear, icon, onLongPress } from '../dom.js';
import { t, fmtMonth, fmtDay, fmtDuration, fmtDate } from '../i18n.js';
import * as E from '../engine.js';
import { kindOf } from '../media.js';

const GAP = 3;
const ROW_H = [92, 128, 190]; // zoom levels (phone base); desktop × 1.35
const OVERSCAN = 900;

export function aspectOf(n) {
  const m = n.meta || {};
  let w = m.w, h = m.h;
  const th = n.rev && (n.rev.thumb || n.rev.preview);
  if (th && th.w && th.h) { w = th.w; h = th.h; }
  if (!(w > 0 && h > 0)) return 1;
  return Math.max(0.33, Math.min(3, w / h));
}

/**
 * createGrid({ onOpen(n, list), onSelectionChange(set), zoom }) → { node, setGroups(groups), select…, destroy }
 * groups: [{ key, y, mo, d, items: [node] }]   (no y → no header)
 */
export function createGrid({ onOpen, onSelectionChange, zoom = 1, label = t('Fotos') } = {}) {
  const node = el('div.jgrid', { role: 'list', aria: { label } });
  let groups = [], rows = [], total = 0, width = 0;
  let flat = [];
  const tiles = new Map(); // nodeId → { el, img, rowIdx }
  const heads = new Map();
  const selected = new Set();
  let selectMode = false;
  let raf = 0;

  function rowH() { return ROW_H[zoom] * (width > 900 ? 1.35 : 1); }
  function layout() {
    width = node.clientWidth || node.getBoundingClientRect().width || 360;
    rows = []; flat = [];
    let y = 0, prevMonth = '';
    const H = rowH();
    for (const g of groups) {
      if (g.y) {
        const mk = g.y + '-' + g.mo;
        const month = mk !== prevMonth;
        prevMonth = mk;
        const h = month ? 70 : 38;
        rows.push({ type: 'h', y, h, g, month });
        y += h;
      }
      let line = [], sum = 0;
      const flush = (last) => {
        if (!line.length) return;
        const gaps = GAP * (line.length - 1);
        let h = (width - gaps) / sum;
        if (last && h > H * 1.25) h = H; // last row of a group: no huge stretch
        let x = 0;
        rows.push({ type: 'r', y, h, items: line.map(it => { const w = it.a * h; const r = { n: it.n, x, w }; x += w + GAP; return r; }) });
        y += h + GAP;
        line = []; sum = 0;
      };
      for (const n of g.items) {
        const a = aspectOf(n);
        flat.push(n);
        line.push({ n, a }); sum += a;
        if (sum * H + GAP * (line.length - 1) >= width) flush(false);
      }
      flush(true);
    }
    total = y;
    node.style.height = Math.max(0, Math.ceil(total)) + 'px';
  }
  function firstRow(top) { let lo = 0, hi = rows.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (rows[mid].y + rows[mid].h < top) lo = mid + 1; else hi = mid; } return lo; }
  function render() {
    raf = 0;
    if (!node.isConnected) return;
    const rect = node.getBoundingClientRect();
    const top = -rect.top - OVERSCAN, bottom = -rect.top + window.innerHeight + OVERSCAN;
    const keepT = new Set(), keepH = new Set(), order = [];
    for (let i = firstRow(top); i < rows.length && rows[i].y <= bottom; i++) {
      const r = rows[i];
      if (r.type === 'h') { keepH.add(r.g.key); order.push(placeHead(r)); continue; }
      for (const it of r.items) { keepT.add(it.n.id); order.push(placeTile(it, r)); }
    }
    for (const [id, tl] of tiles) if (!keepT.has(id)) { tl.el.remove(); tiles.delete(id); }
    for (const [k, h] of heads) if (!keepH.has(k)) { h.remove(); heads.delete(k); }
    // DOM order = visual order, so Tab / screen readers walk the grid as it is seen
    const kids = node.children;
    let same = kids.length === order.length;
    for (let i = 0; same && i < order.length; i++) if (kids[i] !== order[i]) same = false;
    if (!same) for (const e of order) node.appendChild(e);
  }
  function placeHead(r) {
    let h = heads.get(r.g.key);
    if (!h) {
      h = el('div.jg-head' + (r.month ? '.month' : ''), { role: 'listitem' },
        r.month ? el('h2.jg-month', fmtMonth(r.g.y, r.g.mo)) : null,
        el('h3.jg-day', fmtDay(r.g.y, r.g.mo, r.g.d)));
      heads.set(r.g.key, h);
      node.appendChild(h);
    }
    h.style.transform = `translateY(${r.y}px)`; h.style.height = r.h + 'px';
    return h;
  }
  function placeTile(it, r) {
    const n = it.n;
    let tl = tiles.get(n.id);
    if (!tl || tl.rev !== (n.head && n.head.id) || tl.fav !== !!(n.meta && n.meta.favorite)) {
      if (tl) tl.el.remove();
      tl = makeTile(n);
      tiles.set(n.id, tl);
      node.appendChild(tl.el);
    }
    const s = tl.el.style;
    s.transform = `translate(${it.x}px, ${r.y}px)`; s.width = it.w + 'px'; s.height = r.h + 'px';
    tl.el.classList.toggle('sel', selected.has(n.id));
    if (selectMode) tl.el.setAttribute('aria-pressed', String(selected.has(n.id))); else tl.el.removeAttribute('aria-pressed');
    return tl.el;
  }
  function makeTile(n) {
    const k = kindOf(n.name, n.rev && n.rev.mime);
    const img = el('img', { alt: '', decoding: 'async', draggable: 'false', hidden: true });
    const label = `${k === 'video' ? t('Video') : t('Foto')} ${n.meta && n.meta.takenAt ? fmtDate(Date.parse(n.meta.takenAt)) : ''} · ${n.name}`;
    const b = el('button.jg-tile.k-' + k, { type: 'button', role: 'listitem', aria: { label }, data: { id: n.id } },
      el('span.jg-ph', icon(k === 'video' ? 'video' : 'image')), img,
      k === 'video' ? el('span.jg-badge', icon('play'), n.meta && n.meta.durationMs ? fmtDuration(n.meta.durationMs) : '') : null,
      n.meta && n.meta.favorite ? el('span.jg-fav', icon('star', { filled: true })) : null,
      el('span.jg-check', icon('check')));
    b.addEventListener('click', e => {
      if (selectMode || e.ctrlKey || e.metaKey) { toggle(n.id, e); return; }
      onOpen && onOpen(n, flat);
    });
    onLongPress(b, () => { if (!selectMode) setSelectMode(true); toggle(n.id); });
    const url = E.cachedThumb(n.id);
    const show = u => { if (!u) return; img.src = u; img.hidden = false; b.classList.add('loaded'); };
    if (url) show(url); else if (n.head && n.head.thumb) E.thumbUrl(n).then(u => { if (tiles.get(n.id) && tiles.get(n.id).el === b) show(u); });
    return { el: b, img, rev: n.head && n.head.id, fav: !!(n.meta && n.meta.favorite) };
  }
  function toggle(id) {
    if (!selectMode) setSelectMode(true);
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    const tl = tiles.get(id);
    if (tl) { tl.el.classList.toggle('sel', selected.has(id)); tl.el.setAttribute('aria-pressed', String(selected.has(id))); }
    onSelectionChange && onSelectionChange(selected, selectMode);
  }
  function setSelectMode(on) {
    selectMode = on;
    node.classList.toggle('selecting', on);
    if (!on) selected.clear();
    for (const [id, tl] of tiles) { tl.el.classList.toggle('sel', selected.has(id)); if (on) tl.el.setAttribute('aria-pressed', String(selected.has(id))); else tl.el.removeAttribute('aria-pressed'); }
    onSelectionChange && onSelectionChange(selected, selectMode);
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(render); };
  const ro = new ResizeObserver(() => { const w = node.clientWidth; if (Math.abs(w - width) > 1) { layout(); render(); } });
  ro.observe(node);
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });

  return {
    node,
    setGroups(g) {
      groups = g;
      for (const id of [...selected]) if (!g.some(x => x.items.some(n => n.id === id))) selected.delete(id);
      layout(); schedule();
    },
    setZoom(z) { zoom = z; layout(); render(); },
    get selected() { return selected; },
    get selectMode() { return selectMode; },
    setSelectMode,
    selectAll() { selectMode = true; node.classList.add('selecting'); flat.forEach(n => selected.add(n.id)); render(); onSelectionChange && onSelectionChange(selected, true); },
    count: () => flat.length,
    refresh() { for (const tl of tiles.values()) tl.el.remove(); tiles.clear(); render(); },
    destroy() { ro.disconnect(); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); cancelAnimationFrame(raf); },
  };
}

/** Group photo nodes (already sorted newest first) by capture day. */
export function groupByDay(list) {
  const out = [];
  let cur = null;
  for (const n of list) {
    const tk = E.takenOf(n);
    const key = `${tk.y}-${tk.mo}-${tk.d}`;
    if (!cur || cur.key !== key) { cur = { key, y: tk.y, mo: tk.mo, d: tk.d, items: [] }; out.push(cur); }
    cur.items.push(n);
  }
  return out;
}
export { clear };
