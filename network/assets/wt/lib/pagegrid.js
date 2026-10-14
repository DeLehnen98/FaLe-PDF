// Page grid for the page tools (split, delete, extract, organize, rotate, blank pages, …).
//
//   const thumbs = new ThumbSource();             // lazily rendered, cached page thumbnails (blob URLs, LRU)
//   thumbs.addInput(input);                       // InputFile with kind 'pdf'
//   const grid = new PageGrid(host, { lang, mode: 'select', thumbs, onSelect: set => … });
//   grid.setItems([{ id: 'f1:0', src: { f: 'f1', p: 0 }, rot: 0 }, …]);
//
// Modes: 'select' (tap toggles a mark), 'organize' (select + long-press drag to reorder, keyboard moves),
// 'cuts' (scissor buttons between pages, tinted groups) and 'view' (read-only preview).
// Thumbnails are rendered only when a card comes near the viewport (IntersectionObserver), at most two at
// a time, and kept as small JPEG blob URLs in an LRU cache – 300+ page documents stay light.
// All DOM is created with createElement (Trusted Types), styles live in pagegrid.css (CSP style-src 'self').
import { el, clear } from './dom.js';
import { renderPage, canvasToBlob } from './pdf.js';

// ---------------------------------------------------------------- small helpers
export function haptic(ms = 8) {
  try { if (navigator.vibrate && !matchMedia('(prefers-reduced-motion: reduce)').matches) navigator.vibrate(ms); } catch { /* unsupported */ }
}

const ICONS = {
  check: ['M20 6 9 17l-5-5'],
  trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
  rotr: ['M20 12a8 8 0 1 1-2.3-5.7', 'M20 4v5h-5'],
  rotl: ['M4 12a8 8 0 1 0 2.3-5.7', 'M4 4v5h5'],
  rot180: ['M4 12a8 8 0 0 1 14.6-4.5', 'M19 3v5h-5', 'M20 12a8 8 0 0 1-14.6 4.5', 'M5 21v-5h5'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  scissors: ['M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M20 4 8.1 15.9', 'M14.5 14.5 20 20', 'M8.1 8.1 12 12'],
  undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  redo: ['M15 14l5-5-5-5', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13'],
  left: ['M15 18l-6-6 6-6'],
  right: ['M9 18l6-6-6-6'],
  blank: ['M6 3h8l4 4v14H6z', 'M14 3v4h4', 'M12 11v6', 'M9 14h6'],
  insert: ['M4 4h7v16H4z', 'M15 12h6', 'M18 9v6'],
  reverse: ['M7 4v16', 'M3 16l4 4 4-4', 'M17 20V4', 'M13 8l4-4 4 4'],
  all: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
  none: ['M6 6l12 12', 'M18 6L6 18'],
  invert: ['M4 4h16v16H4z', 'M4 20 20 4'],
  minus: ['M5 12h14'],
  plus: ['M12 5v14', 'M5 12h14'],
  landscape: ['M3 6h18v12H3z'],
  portrait: ['M6 3h12v18H6z'],
  odd: ['M7 4h10v16H7z', 'M12 9v6'],
  even: ['M7 4h10v16H7z', 'M10 9v6', 'M14 9v6'],
  wand: ['M4 20 15 9', 'M14 4v2', 'M20 10h-2', 'M18 6l-1.5 1.5', 'M10 4l.5 1.5'],
};
const NS = 'http://www.w3.org/2000/svg';
export function pgIcon(name) {
  const s = document.createElementNS(NS, 'svg');
  for (const [k, v] of [['viewBox', '0 0 24 24'], ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '2'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'], ['aria-hidden', 'true'], ['focusable', 'false'], ['class', 'pg-i']]) s.setAttribute(k, v);
  for (const d of ICONS[name] || []) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.append(p); }
  return s;
}

let cssPromise = null;
/** Load pagegrid.css once; resolves when it applied (or after 3 s). */
export function loadGridCss() {
  if (!cssPromise) {
    cssPromise = new Promise(resolve => {
      const link = el('link', { rel: 'stylesheet', href: new URL('./pagegrid.css', import.meta.url).href });
      link.addEventListener('load', resolve, { once: true });
      link.addEventListener('error', resolve, { once: true });
      setTimeout(resolve, 3000);
      document.head.append(link);
    });
  }
  return cssPromise;
}

const TXT = {
  de: {
    page: n => `Seite ${n}`, pages: 'Seiten', cut: n => `Nach Seite ${n} trennen`, part: n => `Teil ${n}`,
    moved: (n, pos) => (n === 1 ? `Seite an Position ${pos} verschoben` : `${n} Seiten an Position ${pos} verschoben`),
    lift: n => (n === 1 ? 'Seite angehoben – zum Verschieben ziehen' : `${n} Seiten angehoben – zum Verschieben ziehen`),
    blank: 'Leere Seite', loading: 'Vorschau wird geladen',
  },
  en: {
    page: n => `Page ${n}`, pages: 'Pages', cut: n => `Split after page ${n}`, part: n => `Part ${n}`,
    moved: (n, pos) => (n === 1 ? `Page moved to position ${pos}` : `${n} pages moved to position ${pos}`),
    lift: n => (n === 1 ? 'Page lifted – drag to move it' : `${n} pages lifted – drag to move them`),
    blank: 'Blank page', loading: 'Loading preview',
  },
};

// ---------------------------------------------------------------- thumbnails
/**
 * Renders page thumbnails on demand. src = { f: inputId, p: 0-based page } – blank pages have no src.
 * get() resolves to { url, w, h } (w/h = page size in points as displayed, i.e. with the page's /Rotate).
 */
export class ThumbSource {
  constructor({ width = 168, max = 280, jpeg = 0.78 } = {}) {
    this.width = width;
    this.max = max;
    this.jpeg = jpeg;
    this.inputs = new Map();
    this.cache = new Map();   // key → {url, w, h} (Map order = LRU)
    this.sizes = new Map();   // key → [w, h]
    this.pending = new Map(); // key → promise
    this.queue = [];
    this.active = 0;
    this.evicted = new Set();
    this.onEvict = null;
  }

  addInput(input) { this.inputs.set(input.id, input); }
  hasInput(id) { return this.inputs.has(id); }
  key(src) { return `${src.f}:${src.p}`; }
  cached(src) { const k = this.key(src); const v = this.cache.get(k); if (v) { this.cache.delete(k); this.cache.set(k, v); } return v || null; }
  size(src) { return this.sizes.get(this.key(src)) || null; }

  /** Page size without rendering (pdf.js getPage only). */
  async pageSize(src) {
    const k = this.key(src);
    if (this.sizes.has(k)) return this.sizes.get(k);
    const input = this.inputs.get(src.f);
    if (!input) return null;
    const page = await (await input.pdfjs()).getPage(src.p + 1);
    const vp = page.getViewport({ scale: 1 });
    const s = [vp.width, vp.height];
    this.sizes.set(k, s);
    return s;
  }

  /** Queue a render. `prio` lower = sooner. Returns a promise; `signal` drops it from the queue. */
  get(src, { prio = 0, signal = null } = {}) {
    const hit = this.cached(src);
    if (hit) return Promise.resolve(hit);
    const k = this.key(src);
    if (this.pending.has(k)) return this.pending.get(k);
    const p = new Promise((resolve, reject) => {
      const job = { k, src, prio, resolve, reject, signal };
      this.queue.push(job);
      signal?.addEventListener('abort', () => {
        const i = this.queue.indexOf(job);
        if (i >= 0) { this.queue.splice(i, 1); this.pending.delete(k); reject(new DOMException('Aborted', 'AbortError')); }
      }, { once: true });
      this.pump();
    });
    this.pending.set(k, p);
    p.catch(() => {});
    return p;
  }

  /** Store an already rendered canvas (e.g. from an analysis pass) as the thumbnail. */
  async put(src, canvas, size = null) {
    const k = this.key(src);
    if (size) this.sizes.set(k, size);
    if (this.cache.has(k)) return this.cache.get(k);
    const blob = await canvasToBlob(canvas, 'image/jpeg', this.jpeg);
    return this.store(k, blob, size || this.sizes.get(k) || [canvas.width, canvas.height]);
  }

  store(k, blob, size) {
    const v = { url: URL.createObjectURL(blob), w: size[0], h: size[1] };
    this.cache.set(k, v);
    this.sizes.set(k, size);
    while (this.cache.size > this.max) {
      const [ok, ov] = this.cache.entries().next().value;
      this.cache.delete(ok);
      URL.revokeObjectURL(ov.url);
      this.onEvict?.(ok);
    }
    return v;
  }

  pump() {
    while (this.active < 2 && this.queue.length) {
      this.queue.sort((a, b) => a.prio - b.prio);
      const job = this.queue.shift();
      this.active++;
      this.render(job.src).then(v => { this.pending.delete(job.k); job.resolve(v); }, err => { this.pending.delete(job.k); job.reject(err); })
        .finally(() => { this.active--; this.pump(); });
    }
  }

  async render(src) {
    const input = this.inputs.get(src.f);
    if (!input) throw new Error('unknown input');
    const doc = await input.pdfjs();
    const page = await doc.getPage(src.p + 1);
    const vp = page.getViewport({ scale: 1 });
    const size = [vp.width, vp.height];
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // landscape pages get the same pixel budget along their long side
    const w = vp.width > vp.height ? this.width * 1.3 : this.width;
    const canvas = await renderPage(page, { width: w, dpr });
    page.cleanup?.();
    const blob = await canvasToBlob(canvas, 'image/jpeg', this.jpeg);
    canvas.width = canvas.height = 0;
    return this.store(this.key(src), blob, size);
  }

  /** Forget everything of one input (removed file). */
  dropInput(id) {
    this.inputs.delete(id);
    for (const [k, v] of [...this.cache]) if (k.startsWith(id + ':')) { URL.revokeObjectURL(v.url); this.cache.delete(k); }
    this.queue = this.queue.filter(j => j.src.f !== id || (j.reject(new DOMException('Aborted', 'AbortError')), this.pending.delete(j.k), false));
  }

  dispose() {
    for (const v of this.cache.values()) URL.revokeObjectURL(v.url);
    this.cache.clear();
    this.queue.length = 0;
  }
}

// ---------------------------------------------------------------- geometry
const BOX = 3 / 4; // thumbnail box aspect (width / height)
/** Percent size of the page element inside the box for a page of w×h shown with an extra rotation. */
function fit(w, h, rot) {
  const a = (w || 595) / (h || 842);
  const odd = (((rot % 360) + 360) % 360) % 180 !== 0;
  const d = odd ? 1 / a : a;                 // displayed aspect
  const fw = d > BOX ? 1 : d / BOX;          // displayed width  (fraction of box width)
  const fh = d > BOX ? BOX / d : 1;          // displayed height (fraction of box height)
  const m = 0.94;
  // the element is laid out unrotated and turned with transform, so for 90/270 its width is the
  // displayed height (converted to box-width units) and vice versa
  return odd ? { w: (fh / BOX) * 100 * m, h: fw * BOX * 100 * m } : { w: fw * 100 * m, h: fh * 100 * m };
}

// ---------------------------------------------------------------- grid
/**
 * @param {HTMLElement} host
 * @param {object} o
 *   lang, mode ('select'|'organize'|'cuts'|'view'), thumbs (ThumbSource), ariaLabel,
 *   mark: 'check' | 'delete' – look of a marked page,
 *   label(item, index) → string (big number), sub(item, index) → string|null (small line),
 *   cardTools: [{ id, icon, label(item, index) }] – small buttons on each card (touch shortcut),
 *   onSelect(Set ids), onCut(id), onMove(ids, beforeIndex), onTool(toolId, item, index), onKey(action, item, index)
 */
export class PageGrid {
  constructor(host, o) {
    this.o = o;
    this.lang = o.lang === 'en' ? 'en' : 'de';
    this.L = TXT[this.lang];
    this.mode = o.mode || 'select';
    this.items = [];
    this.selected = new Set();
    this.cuts = new Set();      // ids after which a cut is set
    this.groups = null;         // per-item group number (cuts mode tint)
    this.badges = null;         // per-id extra badge text
    this.cards = new Map();     // id → card record
    this.anchor = null;
    this.focusId = null;
    this.thumbs = o.thumbs;

    this.live = el('p', { class: 'sr-only', aria: { live: 'polite' } });
    this.list = el('ul', { class: `pg-grid pg-mode-${this.mode}${o.mark === 'delete' ? ' pg-mark-del' : ''}`, aria: { label: o.ariaLabel || this.L.pages } });
    this.indicator = el('li', { class: 'pg-drop', 'aria-hidden': 'true', hidden: true });
    this.scroller = el('div', { class: 'pg-scroll' }, this.list);
    this.root = el('div', { class: 'pg-root' }, this.scroller, this.live);
    host.append(this.root);

    this.io = new IntersectionObserver(entries => {
      for (const en of entries) {
        const rec = en.target._pg;
        if (!rec) continue;
        if (en.isIntersecting) this.loadThumb(rec, en.intersectionRatio > 0 ? 0 : 1);
        else if (rec.ac) { rec.ac.abort(); rec.ac = null; }
      }
    }, { root: this.scroller, rootMargin: '300px 0px' });
    if (this.thumbs) {
      const prev = this.thumbs.onEvict;
      this.thumbs.onEvict = k => {
        prev?.(k);
        for (const rec of this.cards.values()) if (rec.key === k && rec.img) { rec.img.remove(); rec.img = null; rec.page.classList.remove('has-img'); this.io.unobserve(rec.li); this.io.observe(rec.li); }
      };
    }
    this.list.addEventListener('keydown', e => this.onKeyDown(e));
    this.list.addEventListener('contextmenu', e => { if (this.drag || this.press) e.preventDefault(); });
    this.onTouchMove = e => { if (this.drag) e.preventDefault(); };
    this.list.addEventListener('touchmove', this.onTouchMove, { passive: false });
  }

  setMode(mode) {
    this.mode = mode;
    this.list.className = `pg-grid pg-mode-${mode}${this.o.mark === 'delete' ? ' pg-mark-del' : ''}`;
    this.render();
  }

  setSize(px) { this.root.style.setProperty('--pg-size', `${px}px`); }
  setMaxHeight(css) { this.scroller.style.maxHeight = css; }

  /** Replace the list (cards are reused by id, so thumbnails stay). */
  setItems(items) {
    this.items = items.slice();
    const ids = new Set(items.map(i => i.id));
    for (const [id, rec] of this.cards) if (!ids.has(id)) { this.io.unobserve(rec.li); rec.ac?.abort(); rec.li.remove(); this.cards.delete(id); }
    for (const id of [...this.selected]) if (!ids.has(id)) this.selected.delete(id);
    for (const id of [...this.cuts]) if (!ids.has(id)) this.cuts.delete(id);
    if (this.focusId && !ids.has(this.focusId)) this.focusId = null;
    this.render();
  }

  render() {
    const active = document.activeElement;
    const hadFocus = active && this.list.contains(active);
    const frag = document.createDocumentFragment();
    const n = this.items.length;
    if (!this.focusId && n) this.focusId = this.items[0].id;
    this.items.forEach((item, i) => {
      let rec = this.cards.get(item.id);
      if (!rec) { rec = this.makeCard(item); this.cards.set(item.id, rec); }
      rec.item = item;
      rec.index = i;
      this.updateCard(rec, i, n);
      frag.append(rec.li);
    });
    clear(this.list).append(frag, this.indicator);
    if (hadFocus && active.isConnected && document.activeElement !== active) active.focus({ preventScroll: true });
    for (const rec of this.cards.values()) if (!rec.img && !rec.blank) { this.io.unobserve(rec.li); this.io.observe(rec.li); }
  }

  makeCard(item) {
    const rec = { item, li: null, hit: null, page: null, img: null, key: item.src ? this.thumbs.key(item.src) : null, blank: !item.src, ac: null };
    const page = el('span', { class: 'pg-page' + (item.src ? '' : ' is-blank') });
    const thumb = el('span', { class: 'pg-thumb' }, page);
    const mark = el('span', { class: 'pg-mark', 'aria-hidden': 'true' }, pgIcon(this.o.mark === 'delete' ? 'trash' : 'check'));
    const num = el('span', { class: 'pg-num' });
    const sub = el('span', { class: 'pg-sub' });
    const badge = el('span', { class: 'pg-badge', hidden: true });
    const interactive = this.mode !== 'view';
    const hit = interactive
      ? el('button', { type: 'button', class: 'pg-hit', tabindex: '-1' }, thumb, mark, badge)
      : el('span', { class: 'pg-hit' }, thumb, badge);
    const li = el('li', { class: 'pg-card' }, hit, el('span', { class: 'pg-cap' }, num, sub));
    li._pg = rec;
    Object.assign(rec, { li, hit, page, num, sub, badge, mark });
    if (interactive) {
      hit.addEventListener('click', e => this.onHit(rec, e));
      hit.addEventListener('focus', () => { this.focusId = rec.item.id; this.syncTabStops(); });
      if (this.mode === 'organize') this.bindDrag(rec);
    }
    for (const t of this.o.cardTools || []) {
      const b = el('button', { type: 'button', class: `pg-tool pg-tool-${t.id}`, tabindex: '-1' }, pgIcon(t.icon));
      b.addEventListener('click', e => { e.stopPropagation(); haptic(8); this.o.onTool?.(t.id, rec.item, rec.index); });
      li.append(b);
      (rec.tools ||= []).push([t, b]);
    }
    const cut = el('button', { type: 'button', class: 'pg-cut', tabindex: '-1' }, el('span', { class: 'pg-cut-line', 'aria-hidden': 'true' }), el('span', { class: 'pg-cut-ic' }, pgIcon('scissors')));
    cut.addEventListener('click', e => { e.stopPropagation(); haptic(12); this.o.onCut?.(rec.item.id); });
    li.append(cut);
    rec.cut = cut;
    if (!item.src) this.placeBox(rec, item.size || [595, 842]);
    return rec;
  }

  updateCard(rec, i, n) {
    const { item } = rec;
    const label = this.o.label ? this.o.label(item, i) : String(i + 1);
    rec.num.textContent = label;
    const sub = this.o.sub ? this.o.sub(item, i) : null;
    rec.sub.textContent = sub || '';
    rec.sub.hidden = !sub;
    const sel = this.selected.has(item.id);
    rec.li.classList.toggle('is-sel', sel);
    rec.li.classList.toggle('is-blank', !item.src);
    const pageLabel = item.src || this.o.label ? `${this.L.page(label)}${sub ? ', ' + sub : ''}` : this.L.blank;
    if (this.mode !== 'view') {
      rec.hit.setAttribute('aria-pressed', sel ? 'true' : 'false');
      rec.hit.setAttribute('aria-label', item.src ? pageLabel : `${this.L.blank} (${label})`);
    } else {
      rec.hit.setAttribute('role', 'img');
      rec.hit.setAttribute('aria-label', pageLabel);
    }
    const b = this.badges?.get(item.id);
    rec.badge.hidden = !b;
    rec.badge.textContent = b || '';
    // rotation
    const size = item.src ? this.thumbs.size(item.src) : (item.size || [595, 842]);
    this.placeBox(rec, size || [595, 842]);
    for (const [t, btn] of rec.tools || []) btn.setAttribute('aria-label', typeof t.label === 'function' ? t.label(item, i) : t.label);
    // cuts
    const isCutMode = this.mode === 'cuts';
    rec.cut.hidden = !isCutMode || i === n - 1;
    if (isCutMode) {
      const on = this.cuts.has(item.id);
      rec.cut.setAttribute('aria-pressed', on ? 'true' : 'false');
      rec.cut.setAttribute('aria-label', this.L.cut(label));
      rec.cut.setAttribute('aria-hidden', 'true'); // the page button itself toggles the cut for screen readers
      if (i < n - 1) { rec.hit.setAttribute('aria-pressed', on ? 'true' : 'false'); rec.hit.setAttribute('aria-label', `${pageLabel} – ${this.L.cut(label)}`); }
      else { rec.hit.removeAttribute('aria-pressed'); }
      rec.li.classList.toggle('is-cut', on);
    } else rec.li.classList.remove('is-cut');
    const g = this.groups ? this.groups[i] : null;
    if (g != null) {
      rec.li.dataset.g = String(g % 2);
      const start = this.groupStart?.get(g) === i;
      rec.li.classList.toggle('pg-gstart', start);
      if (start) rec.li.dataset.part = this.L.part(g + 1); else delete rec.li.dataset.part;
    } else { delete rec.li.dataset.g; delete rec.li.dataset.part; rec.li.classList.remove('pg-gstart'); }
    rec.hit.tabIndex = item.id === this.focusId ? 0 : -1;
  }

  placeBox(rec, size) {
    const r = fit(size[0], size[1], rec.item.rot || 0);
    const s = rec.page.style;
    s.width = `${r.w}%`;
    s.height = `${r.h}%`;
    s.transform = `translate(-50%, -50%) rotate(${rec.item.rot || 0}deg)`;
  }

  async loadThumb(rec, prio) {
    if (rec.img || rec.blank || !rec.item.src || rec.ac) return;
    const ac = new AbortController();
    rec.ac = ac;
    try {
      const v = await this.thumbs.get(rec.item.src, { prio, signal: ac.signal });
      if (rec.ac !== ac) return;
      rec.ac = null;
      if (!rec.li.isConnected && !this.cards.has(rec.item.id)) return;
      const img = el('img', { alt: '', decoding: 'async', draggable: false, src: v.url });
      rec.page.append(img);
      rec.page.classList.add('has-img');
      rec.img = img;
      this.placeBox(rec, [v.w, v.h]);
      this.io.unobserve(rec.li);
    } catch (err) {
      if (rec.ac === ac) rec.ac = null;
      if (err?.name !== 'AbortError') { console.warn('thumbnail', err); rec.page.classList.add('is-failed'); }
    }
  }

  /** Re-apply labels, rotation, marks (after the module changed item fields in place). */
  refresh() { const n = this.items.length; this.items.forEach((item, i) => { const rec = this.cards.get(item.id); if (rec) { rec.item = item; rec.index = i; this.updateCard(rec, i, n); } }); }

  setSelected(ids, { silent = true } = {}) {
    this.selected = new Set(ids);
    this.refresh();
    if (!silent) this.o.onSelect?.(new Set(this.selected));
  }

  setCuts(ids, groups = null) {
    this.cuts = new Set(ids);
    this.groups = groups;
    this.groupStart = new Map();
    (groups || []).forEach((g, i) => { if (g != null && !this.groupStart.has(g)) this.groupStart.set(g, i); });
    this.refresh();
  }
  setBadges(map) { this.badges = map; this.refresh(); }

  // ---------------------------------------------------------------- selection
  onHit(rec, e) {
    if (this.suppressClick) { this.suppressClick = false; return; }
    if (this.mode === 'cuts') {
      // tapping a page in cuts mode toggles the cut after it (big target on phones); not after the last page
      if (rec.index < this.items.length - 1) { haptic(12); this.o.onCut?.(rec.item.id); }
      return;
    }
    const id = rec.item.id;
    if (e.shiftKey && this.anchor != null) {
      const a = this.items.findIndex(it => it.id === this.anchor);
      if (a >= 0) {
        const [s, t] = a < rec.index ? [a, rec.index] : [rec.index, a];
        const on = !this.selected.has(id) || this.selected.has(this.anchor);
        for (let k = s; k <= t; k++) on ? this.selected.add(this.items[k].id) : this.selected.delete(this.items[k].id);
      }
    } else if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    this.anchor = id;
    haptic(this.selected.has(id) ? 8 : 5);
    this.refresh();
    this.o.onSelect?.(new Set(this.selected));
  }

  // ---------------------------------------------------------------- keyboard (roving tab stop)
  syncTabStops() { for (const rec of this.cards.values()) rec.hit.tabIndex = rec.item.id === this.focusId ? 0 : -1; }

  columns() {
    const lis = [...this.list.children].filter(n => n._pg);
    if (lis.length < 2) return 1;
    const top = lis[0].offsetTop;
    let c = 0;
    for (const li of lis) { if (li.offsetTop !== top) break; c++; }
    return Math.max(1, c);
  }

  focusIndex(i) {
    const item = this.items[Math.max(0, Math.min(this.items.length - 1, i))];
    if (!item) return;
    this.focusId = item.id;
    this.syncTabStops();
    const rec = this.cards.get(item.id);
    rec.hit.focus({ preventScroll: true });
    rec.li.scrollIntoView({ block: 'nearest' });
  }

  onKeyDown(e) {
    const rec = e.target.closest?.('.pg-card')?._pg;
    if (!rec || e.target !== rec.hit) return;
    const i = rec.index;
    const cols = this.columns();
    const moveKey = e.altKey || e.ctrlKey || e.metaKey;
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
    if (delta != null) {
      e.preventDefault();
      if (moveKey && this.mode === 'organize') {
        const ids = this.selected.has(rec.item.id) ? this.items.filter(it => this.selected.has(it.id)).map(it => it.id) : [rec.item.id];
        const target = Math.max(0, Math.min(this.items.length, delta > 0 ? i + delta + 1 : i + delta));
        this.o.onMove?.(ids, target);
        requestAnimationFrame(() => this.focusId && this.cards.get(this.focusId)?.hit.focus());
      } else this.focusIndex(i + delta);
      return;
    }
    if (e.key === 'Home') { e.preventDefault(); this.focusIndex(0); return; }
    if (e.key === 'End') { e.preventDefault(); this.focusIndex(this.items.length - 1); return; }
    if (this.mode === 'organize' && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); this.o.onKey?.('delete', rec.item, i); requestAnimationFrame(() => { if (!this.list.contains(document.activeElement)) this.focusIndex(Math.min(i, this.items.length - 1)); }); return; }
    if ((e.key === 'r' || e.key === 'R') && !moveKey) { e.preventDefault(); this.o.onKey?.(e.shiftKey ? 'rotl' : 'rotr', rec.item, i); return; }
    if ((e.key === 'a' || e.key === 'A') && moveKey && this.mode !== 'cuts') {
      e.preventDefault();
      this.setSelected(this.selected.size === this.items.length ? [] : this.items.map(it => it.id), { silent: false });
    }
  }

  // ---------------------------------------------------------------- drag to reorder
  bindDrag(rec) {
    const hit = rec.hit;
    hit.addEventListener('pointerdown', e => {
      if (this.drag || (e.pointerType === 'mouse' && e.button !== 0) || !e.isPrimary) return;
      const press = { id: e.pointerId, x: e.clientX, y: e.clientY, rec, type: e.pointerType, timer: 0 };
      this.press = press;
      if (e.pointerType !== 'mouse') {
        press.timer = setTimeout(() => { if (this.press === press) this.startDrag(press, e.clientX, e.clientY); }, 360);
      }
      const move = ev => {
        if (ev.pointerId !== press.id) return;
        if (this.drag) { ev.preventDefault(); this.dragMove(ev.clientX, ev.clientY); return; }
        const dist = Math.hypot(ev.clientX - press.x, ev.clientY - press.y);
        if (press.type === 'mouse' && dist > 6) this.startDrag(press, ev.clientX, ev.clientY);
        else if (press.type !== 'mouse' && dist > 10) cancel();
      };
      const up = ev => {
        if (ev.pointerId !== press.id) return;
        cleanup();
        if (this.drag) { this.endDrag(ev.type === 'pointercancel'); }
      };
      const key = ev => { if (ev.key === 'Escape' && this.drag) { ev.preventDefault(); cleanup(); this.endDrag(true); } };
      const cancel = () => { clearTimeout(press.timer); if (this.press === press) this.press = null; };
      const cleanup = () => {
        cancel();
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        window.removeEventListener('keydown', key, true);
      };
      window.addEventListener('pointermove', move, { passive: false });
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      window.addEventListener('keydown', key, true);
    });
  }

  startDrag(press, x, y) {
    clearTimeout(press.timer);
    const rec = press.rec;
    const id = rec.item.id;
    if (!this.selected.has(id) && this.selected.size) { /* dragging an unselected page moves only that page */ }
    const ids = this.selected.has(id) && this.selected.size > 1 ? this.items.filter(it => this.selected.has(it.id)).map(it => it.id) : [id];
    const r = rec.li.getBoundingClientRect();
    const ghost = el('div', { class: 'pg-ghost', 'aria-hidden': 'true' }, rec.hit.querySelector('.pg-thumb').cloneNode(true));
    if (ids.length > 1) ghost.append(el('span', { class: 'pg-ghost-n' }, String(ids.length)));
    ghost.style.width = `${r.width}px`;
    document.body.append(ghost);
    this.drag = { ids, ghost, dx: x - r.left, dy: y - r.top, x, y, target: null, raf: 0, w: r.width };
    for (const i of ids) this.cards.get(i)?.li.classList.add('is-dragging');
    this.root.classList.add('is-drag');
    this.suppressClick = true;
    haptic(15);
    this.say(this.L.lift(ids.length));
    this.dragMove(x, y);
    const loop = () => { if (!this.drag) return; this.autoScroll(); this.drag.raf = requestAnimationFrame(loop); };
    this.drag.raf = requestAnimationFrame(loop);
  }

  dragMove(x, y) {
    const d = this.drag;
    d.x = x; d.y = y;
    d.ghost.style.transform = `translate(${x - d.dx}px, ${y - d.dy}px) rotate(-2deg) scale(1.04)`;
    this.updateTarget();
  }

  updateTarget() {
    const d = this.drag;
    const { x, y } = d;
    let best = null, bestDist = Infinity;
    for (let i = 0; i < this.items.length; i++) {
      const rec = this.cards.get(this.items[i].id);
      const r = rec.li.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) continue;
      const cx = Math.max(r.left, Math.min(x, r.right)), cy = Math.max(r.top, Math.min(y, r.bottom));
      const dist = Math.hypot(x - cx, (y - cy) * 1.5);
      if (dist < bestDist) { bestDist = dist; best = { i, r }; }
    }
    if (!best) return;
    const after = x > best.r.left + best.r.width / 2;
    d.target = best.i + (after ? 1 : 0);
    const lr = this.list.getBoundingClientRect();
    const ind = this.indicator;
    ind.hidden = false;
    const gap = 6;
    const left = (after ? best.r.right + gap : best.r.left - gap) - lr.left;
    ind.style.transform = `translate(${left - 2}px, ${best.r.top - lr.top}px)`;
    ind.style.height = `${best.r.height}px`;
  }

  autoScroll() {
    const d = this.drag;
    const sc = this.scroller;
    const r = sc.getBoundingClientRect();
    const top = Math.max(r.top, 0), bottom = Math.min(r.bottom, innerHeight);
    const edge = 56;
    let v = 0;
    if (d.y < top + edge) v = -Math.ceil(((top + edge - d.y) / edge) * 14);
    else if (d.y > bottom - edge) v = Math.ceil(((d.y - (bottom - edge)) / edge) * 14);
    if (!v) return;
    const before = sc.scrollTop;
    sc.scrollTop += v;
    if (sc.scrollTop === before) { const wy = scrollY; scrollBy(0, v); if (scrollY === wy) return; }
    this.updateTarget();
  }

  endDrag(cancelled) {
    const d = this.drag;
    this.drag = null;
    cancelAnimationFrame(d.raf);
    d.ghost.remove();
    this.indicator.hidden = true;
    this.root.classList.remove('is-drag');
    for (const i of d.ids) this.cards.get(i)?.li.classList.remove('is-dragging');
    setTimeout(() => { this.suppressClick = false; }, 0);
    if (cancelled || d.target == null) return;
    const first = this.items.findIndex(it => it.id === d.ids[0]);
    const contiguous = d.ids.every((id, k) => this.items[first + k]?.id === id);
    if (contiguous && d.target >= first && d.target <= first + d.ids.length) return; // dropped in place
    haptic(10);
    this.o.onMove?.(d.ids, d.target);
    const pos = this.items.findIndex(it => it.id === d.ids[0]) + 1;
    this.say(this.L.moved(d.ids.length, pos));
  }

  say(text) { this.live.textContent = ''; setTimeout(() => { this.live.textContent = text; }, 30); }

  scrollToId(id) { this.cards.get(id)?.li.scrollIntoView({ block: 'nearest' }); }

  destroy() {
    this.io.disconnect();
    for (const rec of this.cards.values()) rec.ac?.abort();
    this.root.remove();
  }
}

/** Move the items with `ids` so they stand before the item that was at `before` (index in the old list). */
export function moveIds(items, ids, before) {
  const set = new Set(ids);
  const moving = items.filter(it => set.has(it.id));
  let pos = 0;
  for (let i = 0; i < before && i < items.length; i++) if (!set.has(items[i].id)) pos++;
  const rest = items.filter(it => !set.has(it.id));
  rest.splice(pos, 0, ...moving);
  return rest;
}

// ---------------------------------------------------------------- toolbar
/**
 * Sticky toolbar above a grid: an info text plus icon buttons.
 * buttons: [{ id, icon, label, short?, onClick, primary?, danger? }] – label is the accessible name,
 * short (optional) is shown next to the icon.
 */
export function toolbar(buttons, { cls = '' } = {}) {
  const info = el('p', { class: 'pg-bar-info', aria: { live: 'polite' } });
  const row = el('div', { class: 'pg-bar-btns' });
  const map = new Map();
  for (const b of buttons) {
    const btn = el('button', { type: 'button', dataset: { id: b.id }, class: 'pg-btn' + (b.primary ? ' is-primary' : '') + (b.danger ? ' is-danger' : '') + (b.short ? ' has-text' : '') + (b.compact ? ' is-compact' : ''), aria: { label: b.label }, title: b.label, onclick: b.onClick },
      pgIcon(b.icon), b.short ? el('span', { class: 'pg-btn-text' }, b.short) : null);
    map.set(b.id, btn);
    row.append(btn);
  }
  const bar = el('div', { class: 'pg-bar ' + cls }, info, row);
  return { bar, info, btn: id => map.get(id), row };
}
