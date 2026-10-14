// Live page preview for the "edit" tools: renders a page with pdf.js – either the source page or an
// exact preview PDF built by the tool (build(index) → bytes) – and gives the tool a layer over the page
// for its own overlays/handles. Swipe left/right, the arrow buttons or the arrow keys change the page.
// Option changes re-render automatically (debounced); sliders and colour pickers update while dragging.
//
//   const pv = createPreview(stageEl, { lang, state, build: async (i, values) => bytes, count: async () => n });
//   pv.reset();   // new input
//   pv.refresh(); // options changed (done automatically for the shell's option controls)
import { el, icon, clear } from './dom.js';
import { openPdfjs, renderPage } from './pdf.js';
import { loadEditCss } from './edit-draw.js';

const TXT = {
  de: { page: 'Seite {i} von {n}', prev: 'Vorherige Seite', next: 'Nächste Seite', preview: 'Vorschau', loading: 'Vorschau wird erstellt …', failed: 'Die Vorschau konnte nicht erstellt werden.', keys: 'Vorschau. Mit den Pfeiltasten blätterst du.' },
  en: { page: 'Page {i} of {n}', prev: 'Previous page', next: 'Next page', preview: 'Preview', loading: 'Creating preview …', failed: 'The preview could not be created.', keys: 'Preview. Use the arrow keys to change the page.' },
};

/**
 * @param {HTMLElement} host
 * @param {object} o
 * @param {'de'|'en'} o.lang
 * @param {object} o.state                 shell state (state.values = option values, state.inputs)
 * @param {() => any} [o.source]           InputFile to render (default: first usable PDF input)
 * @param {() => Promise<number>} [o.count]  number of preview pages (default: page count of the source)
 * @param {(index: number, values: object, signal: AbortSignal) => Promise<Uint8Array|null>} [o.build]  exact preview PDF (page 1 is shown); null → source page
 * @param {(index: number, n: number, lang: string) => string} [o.label]
 * @param {(info: object) => void} [o.onRender]   info: {layer, page, canvas, W, H, scale, index, n}
 * @param {boolean} [o.sticky]             keep the preview visible while scrolling the options
 * @param {boolean} [o.interactive]        the tool handles pointers on the page (no swipe)
 * @param {number} [o.heightPhone]         max height as fraction of the viewport (default 0.4)
 * @param {number} [o.heightDesktop]       (default 0.62)
 */
export function createPreview(host, o) {
  loadEditCss();
  const lang = o.lang === 'en' ? 'en' : 'de';
  const L = TXT[lang];
  const overrides = {};
  let zoom = 1;
  let index = 0, count = 1, seq = 0, timer = null, busy = false, dirty = false, srcDoc = null, srcId = null, ac = null;

  const canvasBox = el('div', { class: 'ed-pv-canvas' });
  const layer = el('div', { class: 'ed-pv-layer' });
  const pageBox = el('div', { class: 'ed-pv-page', tabindex: '0', role: 'group', aria: { roledescription: L.preview, label: L.keys } }, canvasBox, layer);
  const spin = el('div', { class: 'ed-pv-spin', hidden: true, 'aria-hidden': 'true' });
  const stageBox = el('div', { class: 'ed-pv-stage' }, pageBox, spin);
  if (o.inset) stageBox.style.padding = `${o.inset}px 0`;
  const prev = el('button', { type: 'button', class: 'wt-icon-btn ed-pv-btn', aria: { label: L.prev }, onclick: () => go(index - 1) }, icon('up', 'wt-i ed-rot-l'));
  const next = el('button', { type: 'button', class: 'wt-icon-btn ed-pv-btn', aria: { label: L.next }, onclick: () => go(index + 1) }, icon('up', 'wt-i ed-rot-r'));
  const label = el('p', { class: 'ed-pv-label', aria: { live: 'polite' } });
  const nav = el('div', { class: 'ed-pv-nav' }, prev, label, next);
  const warn = el('p', { class: 'ed-pv-warn', hidden: true, role: 'status' });
  const extra = el('div', { class: 'ed-pv-extra' });
  const root = el('section', { class: 'ed-pv' + (o.sticky ? ' ed-sticky' : ''), aria: { label: L.preview } }, stageBox, nav, warn);
  host.append(root);
  // extra controls live right after the stage (outside the sticky part) and follow its visibility
  host.after(extra);
  const syncExtra = () => { extra.hidden = host.hidden; };
  new MutationObserver(syncExtra).observe(host, { attributes: true, attributeFilter: ['hidden'] });
  syncExtra();
  if (o.sticky) host.classList.add('ed-stage-sticky');

  // keyboard + swipe
  pageBox.addEventListener('keydown', ev => {
    if (ev.target !== pageBox) return;
    if (ev.key === 'ArrowLeft' || ev.key === 'PageUp') { ev.preventDefault(); go(index - 1); }
    else if (ev.key === 'ArrowRight' || ev.key === 'PageDown') { ev.preventDefault(); go(index + 1); }
  });
  let sx = null, sy = 0, sid = null;
  pageBox.addEventListener('pointerdown', ev => {
    if (o.interactive && ev.target !== pageBox && ev.target.closest('.ed-pv-layer > *')) return;
    if (o.interactive && o.swipeOk && !o.swipeOk(ev)) return;
    sx = ev.clientX; sy = ev.clientY; sid = ev.pointerId;
  });
  pageBox.addEventListener('pointerup', ev => {
    if (sx == null || ev.pointerId !== sid) return;
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    sx = null;
    if (Math.abs(dx) > 50 && Math.abs(dy) < Math.abs(dx) * 0.6) { pageBox.dataset.swiped = '1'; setTimeout(() => delete pageBox.dataset.swiped, 50); go(index + (dx < 0 ? 1 : -1)); }
  });
  pageBox.addEventListener('pointercancel', () => { sx = null; });

  // live option changes (the shell's option controls live in .wt-opts-box)
  const optsBox = () => host.parentElement?.querySelector('.wt-opts-box');
  const onInput = ev => {
    const t = ev.target;
    const box = optsBox();
    if (!box || !box.contains(t) || !t.id?.startsWith('wt-opt-')) return;
    if (t.type === 'range' || t.type === 'color') overrides[t.id.slice(7)] = t.type === 'range' ? +t.value : t.value;
    refresh();
  };
  const onChange = ev => {
    const t = ev.target;
    const box = optsBox();
    if (!box || !box.contains(t)) return;
    if (t.id?.startsWith('wt-opt-')) delete overrides[t.id.slice(7)];
    refresh();
  };
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  let lastW = 0;
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    const w = Math.round(stageBox.clientWidth);
    if (w && Math.abs(w - lastW) > 8) { lastW = w; refresh(0); }
  }) : null;
  ro?.observe(stageBox);

  const source = () => (o.source ? o.source() : (o.state.inputs || []).find(i => !i.error && !i.locked && i.kind === 'pdf'));
  const values = () => ({ ...o.state.values, ...overrides });

  async function go(i) {
    const n = count;
    const j = Math.max(0, Math.min(n - 1, i));
    if (j === index) return;
    index = j;
    updateNav();
    refresh(0);
    o.onPage?.(index);
  }

  function updateNav() {
    const n = count;
    label.textContent = o.label ? o.label(index, n, lang) : L.page.replace('{i}', index + 1).replace('{n}', n);
    prev.disabled = index <= 0;
    next.disabled = index >= n - 1;
    nav.hidden = n <= 1 && !o.alwaysNav;
  }

  function refresh(delay = 140) {
    clearTimeout(timer);
    timer = setTimeout(render, delay);
  }

  async function render() {
    if (busy) { dirty = true; return; }
    const input = source();
    if (!input) { if (host.isConnected && (o.state.inputs || []).length) timer = setTimeout(render, 600); return; } // e.g. waiting for a password
    busy = true; dirty = false;
    const my = ++seq;
    ac?.abort();
    ac = new AbortController();
    const signal = ac.signal;
    spin.hidden = false;
    let doc = null, page = null, ownDoc = false;
    try {
      if (srcId !== input.id) { srcId = input.id; srcDoc = await input.pdfjs(); index = 0; }
      count = Math.max(1, o.count ? await o.count() : srcDoc.numPages);
      if (index >= count) index = count - 1;
      updateNav();
      const vals = values();
      const bytes = o.build ? await o.build(index, vals, signal) : null;
      if (my !== seq) return;
      if (bytes) { doc = await openPdfjs(bytes); ownDoc = true; page = await doc.getPage(1); }
      else { doc = srcDoc; page = await doc.getPage(Math.min(srcDoc.numPages, (o.sourceIndex ? o.sourceIndex(index) : index) + 1)); }
      const base = page.getViewport({ scale: 1 });
      const W = base.width, H = base.height;
      const vh = window.innerHeight || 800;
      const wide = (window.innerWidth || 400) >= 720;
      const availW = Math.max(120, stageBox.clientWidth - 2 - 2 * (o.inset || 0));
      const availH = Math.max(160, -2 * (o.inset || 0) + vh * (wide ? (o.heightDesktop || 0.62) : (o.heightPhone || 0.36)));
      const scale = Math.min(availW / W, availH / H) * zoom;
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const canvas = await renderPage(page, { scale, dpr, signal });
      if (my !== seq) { canvas.width = canvas.height = 0; return; }
      const cssW = Math.round(W * scale), cssH = Math.round(H * scale);
      canvas.className = 'ed-pv-cv';
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
      pageBox.style.width = cssW + 'px';
      pageBox.style.height = cssH + 'px';
      for (const c of canvasBox.querySelectorAll('canvas')) { c.width = c.height = 0; }
      clear(canvasBox).append(canvas);
      pageBox.classList.remove('is-failed');
      o.onRender?.({ layer, page: pageBox, canvas, W, H, scale, index, n: count, values: vals });
    } catch (err) {
      if (err?.name !== 'AbortError' && err?.name !== 'RenderingCancelledException') {
        console.warn(err);
        if (my === seq) { pageBox.classList.add('is-failed'); setWarning(err?.userMessage ? err.userMessage[lang] : L.failed); }
      }
    } finally {
      try { page?.cleanup?.(); } catch { /* ignore */ }
      if (ownDoc) doc?.destroy();
      busy = false;
      if (my === seq) spin.hidden = true;
      if (dirty) render();
    }
  }

  function setWarning(text) {
    const s = text && typeof text === 'object' ? text[lang] : text;
    warn.textContent = s || '';
    warn.hidden = !s;
  }

  return {
    root, layer, page: pageBox, extra, values,
    get index() { return index; },
    get count() { return count; },
    refresh, go, setWarning,
    get zoom() { return zoom; },
    setZoom(z) { zoom = z; stageBox.classList.toggle('is-zoomed', z > 1); refresh(0); },
    /** new input / page count changed */
    reset(keepIndex = false) { srcId = null; srcDoc = null; if (!keepIndex) index = 0; for (const k of Object.keys(overrides)) delete overrides[k]; refresh(0); },
  };
}

/**
 * 3 × 3 position picker on the preview page: big tap zones (one third of the page each), real buttons
 * (radio group, arrow keys), the chosen one marked. value: 'tl' | 'tc' | 'tr' | 'ml' | 'mc' | 'mr' | 'bl' | 'bc' | 'br'
 */
export function positionZones(pv, { lang, get, set, allowed = null, title }) {
  const N = {
    de: { t: 'oben', m: 'Mitte', b: 'unten', l: 'links', c: 'mittig', r: 'rechts' },
    en: { t: 'top', m: 'middle', b: 'bottom', l: 'left', c: 'centre', r: 'right' },
  }[lang === 'en' ? 'en' : 'de'];
  const keys = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'];
  const grid = el('div', { class: 'ed-zones', role: 'radiogroup', aria: { label: title } });
  const btns = new Map();
  const name = k => (k === 'mc' ? (lang === 'en' ? 'centre' : 'Mitte') : `${N[k[0]]} ${N[k[1]]}`.replace(/^./, c => c.toUpperCase()));
  for (const k of keys) {
    const b = el('button', { type: 'button', class: `ed-zone ed-zone-${k}`, role: 'radio', aria: { label: name(k) }, dataset: { pos: k },
      onclick: ev => { if (pv.page.dataset.swiped) return; ev.stopPropagation(); set(k); sync(); } }, el('span', { class: 'ed-zone-dot' }));
    btns.set(k, b);
    grid.append(b);
  }
  grid.addEventListener('keydown', ev => {
    const i = keys.indexOf(get());
    const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }[ev.key];
    if (d == null) return;
    ev.preventDefault();
    ev.stopPropagation();
    let j = i + d;
    while (j >= 0 && j < 9 && allowed && !allowed().includes(keys[j])) j += d;
    if (j < 0 || j > 8) return;
    set(keys[j]); sync(); btns.get(keys[j]).focus();
  });
  function sync() {
    const v = get();
    const ok = allowed ? allowed() : keys;
    for (const [k, b] of btns) {
      b.hidden = !ok.includes(k);
      b.setAttribute('aria-checked', String(k === v));
      b.tabIndex = k === v ? 0 : -1;
    }
  }
  pv.page.append(grid);
  sync();
  return { sync, root: grid };
}
