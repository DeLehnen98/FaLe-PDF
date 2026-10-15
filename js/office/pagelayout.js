// Seitenlayout-Ansicht für die Textverarbeitung: ein einziges contenteditable-Element wird visuell in Seiten
// aufgeteilt. Zeilen, die über das Seitenende laufen, werden mit einem unsichtbaren Float (shape-outside)
// auf die nächste Seite geschoben; Tabellenzeilen und Blöcke ohne Zeilenfluss bekommen einen Abstand.
// Hinter dem Editor liegen die Seitenhintergründe mit Kopf-/Fußzeile und Seitenzahl je Seite.
// Nichts davon landet im Dokument: alle Markierungen (data-pg…, --pg-…) werden vor jedem Lauf entfernt
// und von docmodel/Export ignoriert.

import { hfTexts } from './hfnorm.js';

const PX = 96 / 72;
export const PAGE_GAP = 22; // px between pages (unzoomed)

const TEXT_TAGS = /^(P|H[1-6]|PRE)$/;

/** Remove all pagination marks from an editor (also used before snapshots). */
export function clearPagination(ed) {
  ed.querySelectorAll('[data-pg]').forEach(el => { el.removeAttribute('data-pg'); el.style.removeProperty('--pg-h'); el.style.removeProperty('--pg-shape'); cleanStyle(el); });
  ed.querySelectorAll('[data-pgm]').forEach(el => { el.removeAttribute('data-pgm'); el.style.removeProperty('--pg-mt'); cleanStyle(el); });
  ed.querySelectorAll('[data-pgr]').forEach(el => { el.removeAttribute('data-pgr'); el.style.removeProperty('--pg-r'); cleanStyle(el); });
  ed.querySelectorAll('[data-pgc]').forEach(el => { el.removeAttribute('data-pgc'); el.style.removeProperty('--pg-bg'); cleanStyle(el); });
  ed.querySelectorAll('hr[data-page-break]').forEach(el => { el.style.removeProperty('--pg-hr'); cleanStyle(el); });
}
function cleanStyle(el) { if (el.getAttribute('style') === '') el.removeAttribute('style'); }

/** HTML of the editor without pagination marks (for snapshots / versions). */
export function cleanEditorHtml(ed) {
  const c = ed.cloneNode(true);
  clearPagination(c);
  c.querySelectorAll('.img-handles,.pg-sp').forEach(x => x.remove());
  c.querySelectorAll('.cell-sel').forEach(x => x.classList.remove('cell-sel'));
  c.querySelectorAll('[class=""]').forEach(x => x.removeAttribute('class'));
  return c.innerHTML;
}

function collect(root, out) {
  for (let c = root.firstElementChild; c; c = c.nextElementSibling) one(c, out);
}
function one(c, out) {
  const t = c.tagName;
  if (c.classList.contains('pg-sp') || c.classList.contains('img-handles')) return;
  if (TEXT_TAGS.test(t)) { out.push({ el: c, kind: 'text' }); return; }
  if (t === 'UL' || t === 'OL') {
    for (let li = c.firstElementChild; li; li = li.nextElementSibling) {
      if (li.tagName !== 'LI') continue;
      const nested = Array.from(li.children).filter(k => k.tagName === 'UL' || k.tagName === 'OL');
      if (!nested.length) out.push({ el: li, kind: 'text' });
      else { out.push({ el: li, kind: 'lihead', until: nested[0] }); nested.forEach(n => one(n, out)); }
    }
    return;
  }
  if (t === 'TABLE') {
    if (c.closest('td,th')) { out.push({ el: c, kind: 'block' }); return; }
    for (const tr of Array.from(c.rows)) out.push({ el: tr, kind: 'row', table: c });
    return;
  }
  if (t === 'HR') { out.push({ el: c, kind: c.hasAttribute('data-page-break') ? 'break' : 'block' }); return; }
  if (t === 'BLOCKQUOTE') { collect(c, out); return; }
  if (t === 'DIV') {
    if (c.classList.contains('sect') || c.classList.contains('textbox') || c.hasAttribute('data-toc')) { out.push({ el: c, kind: 'block' }); return; }
    if (c.querySelector(':scope > p, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > ul, :scope > ol, :scope > table, :scope > div, :scope > blockquote, :scope > pre')) { collect(c, out); return; }
    out.push({ el: c, kind: 'text' });
    return;
  }
  if (t === 'FIGURE' || t === 'SECTION') { collect(c, out); return; }
  out.push({ el: c, kind: 'block' });
}

/**
 * @param {object} o { sheet, wrap (positioned container of ed), ed, pagesEl, getPage, getHf, onLayout }
 */
export function createPageView(o) {
  const { ed, pagesEl } = o;
  let on = false, zoom = 1, pages = 1, timer = 0, raf = 0, busy = false;
  let pageTops = [0];

  const scale = () => {
    const r = ed.getBoundingClientRect();
    return ed.offsetWidth ? r.width / ed.offsetWidth : 1;
  };

  function geometry() {
    const p = o.getPage();
    const P = p.h * PX, G = PAGE_GAP;
    return { P, G, stride: P + G, mt: p.mt * PX, mb: p.mb * PX, contentH: P - (p.mt + p.mb) * PX };
  }

  function layout() {
    raf = 0;
    if (!on || busy) return;
    busy = true;
    try { run(); } finally { busy = false; }
  }

  function run() {
    clearPagination(ed);
    const g = geometry();
    const z = scale() || 1;
    const base = ed.getBoundingClientRect().top;
    const Y = r => (r - base) / z;
    const items = [];
    collect(ed, items);
    const limitOf = k => k * g.stride + g.P - g.mb;
    const nextTopOf = k => (k + 1) * g.stride + g.mt;
    const pageOf = y => Math.max(0, Math.floor((y + 0.5) / g.stride));
    const lineH = el => { const cs = getComputedStyle(el); const lh = parseFloat(cs.lineHeight); return Number.isFinite(lh) ? lh : parseFloat(cs.fontSize) * 1.3; };
    let lastBottom = g.mt;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const el = it.el;
      if (!el.isConnected) continue;
      const r = el.getBoundingClientRect();
      if (!r.height && !r.width) continue;
      let top = Y(r.top), bottom = Y(r.bottom);
      if (it.kind === 'lihead') bottom = Math.min(bottom, Y(it.until.getBoundingClientRect().top));
      const k = pageOf(top);
      const limit = limitOf(k);
      // page break before (data-pbb) on a paragraph that does not start a page
      const wantsBreak = el.hasAttribute('data-pbb') && top > k * g.stride + g.mt + 2;
      if (it.kind === 'break') {
        const h = Math.max(0, nextTopOf(k) - top);
        el.style.setProperty('--pg-hr', `${h}px`);
        lastBottom = Math.max(lastBottom, nextTopOf(k));
        continue;
      }
      // starts in the dead zone between two pages → move to next page
      const inGap = top > limit - 1;
      let overflow = bottom > limit + 0.5;
      // keep with next: a heading at the bottom whose next item would land on the next page
      if (!overflow && !inGap && !wantsBreak && keepsNext(el) && items[i + 1]) {
        const nx = items[i + 1].el;
        const nr = nx.getBoundingClientRect();
        const nTop = Y(nr.top);
        const need = Math.min(Y(nr.bottom) - nTop, lineH(nx) * 2);
        if (pageOf(nTop) === k && nTop + need > limit + 0.5 && bottom - top < g.contentH / 3) { pushWhole(it, top, nextTopOf(k), g); lastBottom = Math.max(lastBottom, Y(el.getBoundingClientRect().bottom)); continue; }
      }
      if (inGap || wantsBreak) {
        const target = inGap ? nextTopOf(k) : nextTopOf(k);
        pushWhole(it, top, target, g);
        lastBottom = Math.max(lastBottom, Y(el.getBoundingClientRect().bottom));
        continue;
      }
      if (!overflow) { lastBottom = Math.max(lastBottom, bottom); continue; }
      const height = bottom - top;
      if (it.kind === 'text' || it.kind === 'lihead') {
        // split between lines: one or more bands
        const cs = getComputedStyle(el);
        const padT = parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth);
        const cTop = top + padT;
        const lh = lineH(el);
        const firstFits = limit - cTop;
        if (firstFits < lh * 0.95 || /^H[1-6]$/.test(el.tagName)) { pushWhole(it, top, nextTopOf(k), g, cTop); lastBottom = Math.max(lastBottom, Y(el.getBoundingClientRect().bottom)); }
        else {
          const bands = [];
          let kk = k;
          for (let guard = 0; guard < 400; guard++) {
            const lim = limitOf(kk) - cTop;
            const gap = nextTopOf(kk) - limitOf(kk);
            bands.push([lim, lim + gap]);
            setBands(el, bands);
            const b2 = Y(el.getBoundingClientRect().bottom);
            if (b2 <= limitOf(kk + 1) + 0.5) { lastBottom = Math.max(lastBottom, b2); break; }
            kk++;
          }
        }
        continue;
      }
      if (it.kind === 'row') {
        if (height <= g.contentH && top > k * g.stride + g.mt + 4) {
          pushRow(el, nextTopOf(k) - top);
        }
        lastBottom = Math.max(lastBottom, Y(el.getBoundingClientRect().bottom));
        continue;
      }
      // atomic block
      if (height <= g.contentH && top > k * g.stride + g.mt + 4) pushWhole(it, top, nextTopOf(k), g);
      lastBottom = Math.max(lastBottom, Y(el.getBoundingClientRect().bottom));
    }
    pages = Math.max(1, pageOf(Math.max(lastBottom - 1, 0)) + 1);
    pageTops = Array.from({ length: pages }, (_, k) => k * g.stride);
    ed.style.setProperty('--pv-h', `${pages * g.stride - g.G}px`);
    paintPages(g);
    o.onLayout && o.onLayout(pages);
  }

  function keepsNext(el) {
    if (el.hasAttribute('data-keep-next')) return true;
    if (!/^H[1-6]$/.test(el.tagName)) return false;
    const st = o.getStyles ? o.getStyles() : null;
    const s = st && st[el.tagName.toLowerCase()];
    return s ? s.keepNext !== false : true;
  }

  function pushWhole(it, top, target, g, cTop) {
    const el = it.el;
    const push = Math.max(0, target - (cTop ?? top));
    if (it.kind === 'text' || it.kind === 'lihead') {
      if (cTop == null) { const cs = getComputedStyle(el); cTop = top + parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth); }
      setBands(el, [[0, Math.max(0, target - cTop)]]);
    } else if (it.kind === 'row') {
      pushRow(el, push);
    } else {
      const mt = parseFloat(getComputedStyle(el).marginTop) || 0;
      el.setAttribute('data-pgm', ''); el.style.setProperty('--pg-mt', `${mt + target - top}px`);
    }
  }

  function pushRow(tr, push) {
    for (const td of Array.from(tr.cells)) {
      const bg = getComputedStyle(td).backgroundColor;
      td.setAttribute('data-pgc', '');
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') td.style.setProperty('--pg-bg', bg);
    }
    tr.setAttribute('data-pgr', '');
    tr.style.setProperty('--pg-r', `${push}px`);
  }

  function setBands(el, bands) {
    const last = bands[bands.length - 1];
    const pts = [];
    for (const [a, b] of bands) pts.push(`0 ${a}px`, `100% ${a}px`, `100% ${b}px`, `0 ${b}px`);
    el.setAttribute('data-pg', '');
    el.style.setProperty('--pg-h', `${last[1]}px`);
    el.style.setProperty('--pg-shape', `polygon(${pts.join(',')})`);
  }

  function paintPages(g) {
    const hf = o.getHf() || null;
    const ctx = { pages, title: o.getTitle ? o.getTitle() : '' };
    const wm = hf && hf.watermark && hf.watermark.text ? hf.watermark : null;
    const frag = document.createDocumentFragment();
    for (let k = 0; k < pages; k++) {
      const d = document.createElement('div');
      d.className = 'pv-page';
      d.style.top = `${k * g.stride}px`;
      d.dataset.page = String(k + 1);
      if (wm) d.appendChild(watermarkEl(wm));
      if (hf && (k > 0 || o.ownFirst === false)) {
        const top = hfEl(hfTexts(hf, k, 'h', ctx), 'pv-hf top');
        const bottom = hfEl(hfTexts(hf, k, 'f', ctx), 'pv-hf bottom');
        if (top) d.appendChild(top);
        if (bottom) d.appendChild(bottom);
      }
      frag.appendChild(d);
    }
    pagesEl.replaceChildren(frag);
  }

  function schedule(delay = 120) {
    if (!on) return;
    clearTimeout(timer);
    timer = setTimeout(() => { if (!raf) raf = requestAnimationFrame(layout); }, delay);
  }

  return {
    get on() { return on; },
    get pages() { return pages; },
    get zoom() { return zoom; },
    enable(v) {
      on = !!v;
      if (!on) { clearTimeout(timer); clearPagination(ed); pagesEl.replaceChildren(); ed.style.removeProperty('--pv-h'); pages = 1; return; }
      layout();
    },
    setZoom(z) { zoom = Math.max(0.25, Math.min(4, z)); },
    refresh() { if (on) layout(); },
    schedule,
    /** 1-based page number of a node (page view only). */
    pageOf(node) {
      if (!on || !node) return 1;
      const el = node.nodeType === 1 ? node : node.parentElement;
      const g = geometry();
      const z = scale() || 1;
      const y = (el.getBoundingClientRect().top - ed.getBoundingClientRect().top) / z;
      return Math.min(pages, Math.max(1, Math.floor(y / g.stride) + 1));
    },
    pageTop(n) { const g = geometry(); return (Math.max(1, Math.min(pages, n)) - 1) * g.stride; },
    pageTops: () => pageTops.slice(),
  };
}

/** Header/footer element: one text (aligned) or three zones (left · centre · right). null when empty. */
export function hfEl(zones, cls, tag = 'div') {
  const filled = zones.map((t, k) => [t, k]).filter(([t]) => t);
  if (!filled.length) return null;
  const x = document.createElement(tag);
  x.className = cls;
  if (filled.length === 1) { x.textContent = filled[0][0]; x.style.textAlign = ['left', 'center', 'right'][filled[0][1]]; }
  else { x.classList.add('z3'); zones.forEach(t => { const sp = document.createElement('span'); sp.textContent = t; x.appendChild(sp); }); }
  return x;
}
/** Diagonal watermark text behind a page. */
export function watermarkEl(wm) {
  const x = document.createElement('div');
  x.className = 'pv-wm';
  x.setAttribute('aria-hidden', 'true');
  const sp = document.createElement('span');
  sp.textContent = wm.text;
  if (wm.color && /^#[0-9a-f]{6}$/i.test(wm.color)) sp.style.color = wm.color;
  if (wm.opacity) sp.style.opacity = String(Math.max(0.05, Math.min(1, +wm.opacity)));
  x.appendChild(sp);
  return x;
}
