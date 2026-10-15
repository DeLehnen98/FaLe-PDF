// Full-screen PDF reader for phones and desktops (tool pdf-viewer): continuous scroll with lazy rendering,
// pinch-zoom / Ctrl+wheel / buttons / double-tap, page jump, search with highlights, outline and page
// thumbnails, night mode, print, download. Built on pdf.js (lib/pdf.js); everything local.
import { el, clear } from './dom.js';
import { renderPage } from './pdf.js';
import { T, svg, ICON } from './new-ui.js';

const GAP = 10;
const MAX_RENDERED = 14;
const MIN_SCALE = 0.25, MAX_SCALE = 6;

export function openViewer({ pdf, name, lang, appUrl = '', onClose = () => {}, getBlob = null }) {
  const L = v => T(lang, v);
  const n = pdf.numPages;
  const st = { scale: 1, page: 1, night: false, closed: false, sizes: [], rendered: new Map(), queue: new Set(), busy: false, fit: true };
  try { st.night = localStorage.getItem('fale-wt-viewer-night') === '1'; } catch { /* storage unavailable */ }

  // ---------------------------------------------------------------- DOM
  const ib = (icn, label, onclick, extra = {}) => el('button', { type: 'button', class: 'new-ib', aria: { label: L(label), ...(extra.aria || {}) }, title: L(label), onclick, ...extra.attrs }, svg(icn));
  const title = el('div', { class: 'new-v-title', id: 'new-v-title' }, name);
  const btnSearch = ib(ICON.search, { de: 'Suchen', en: 'Search' }, () => toggleSearch(), { aria: { pressed: 'false', controls: 'new-v-search' } });
  const btnSide = ib(ICON.list, { de: 'Inhalt und Seiten', en: 'Contents and pages' }, () => toggleSide(), { aria: { pressed: 'false', controls: 'new-v-side' } });
  const btnMore = ib(ICON.more, { de: 'Weitere Funktionen', en: 'More options' }, () => toggleMenu(), { aria: { expanded: 'false', haspopup: 'true', controls: 'new-v-menu' } });
  const top = el('div', { class: 'new-v-top' }, ib(ICON.close, { de: 'Leseansicht schließen', en: 'Close reader' }, () => close()), btnSide, title, btnSearch, btnMore);
  const sInput = el('input', { type: 'search', class: 'wt-input', id: 'new-v-q', enterkeyhint: 'search', autocomplete: 'off', placeholder: L({ de: 'Im Dokument suchen', en: 'Search in document' }), aria: { label: L({ de: 'Im Dokument suchen', en: 'Search in document' }) } });
  const sCount = el('span', { class: 'new-v-count', aria: { live: 'polite' } });
  const search = el('div', { class: 'new-v-search', id: 'new-v-search', hidden: true, role: 'search' }, sInput,
    sCount, ib(ICON.up, { de: 'Vorheriger Treffer', en: 'Previous match' }, () => step(-1)), ib(ICON.down, { de: 'Nächster Treffer', en: 'Next match' }, () => step(1)),
    ib(ICON.close, { de: 'Suche schließen', en: 'Close search' }, () => toggleSearch(false)));
  const pagesEl = el('div', { class: 'new-v-pages' });
  const scroller = el('div', { class: 'new-v-scroll', tabindex: '0', aria: { label: L({ de: 'Dokumentseiten', en: 'Document pages' }) } }, pagesEl);
  const sideTabs = el('div', { class: 'new-row' });
  const sideBody = el('div', {});
  const side = el('nav', { class: 'new-v-side', id: 'new-v-side', hidden: true, aria: { label: L({ de: 'Inhalt und Seiten', en: 'Contents and pages' }) } }, sideTabs, sideBody);
  const nightBtn = el('button', { type: 'button', role: 'menuitemcheckbox', aria: { checked: String(st.night) }, onclick: () => { setNight(!st.night); toggleMenu(false); } }, svg(ICON.moon), L({ de: 'Nachtmodus', en: 'Night mode' }));
  const menu = el('div', { class: 'new-v-menu', id: 'new-v-menu', role: 'menu', hidden: true },
    nightBtn,
    el('button', { type: 'button', role: 'menuitem', onclick: () => { toggleMenu(false); setScale(fitScale(), null, true); } }, svg(ICON.fit), L({ de: 'An Breite anpassen', en: 'Fit to width' })),
    el('button', { type: 'button', role: 'menuitem', onclick: () => { toggleMenu(false); printDoc(); } }, svg(ICON.print), L({ de: 'Drucken', en: 'Print' })),
    getBlob ? el('button', { type: 'button', role: 'menuitem', onclick: async () => { toggleMenu(false); const { download } = await import('./download.js'); download(await getBlob(), name); } }, svg(ICON.download), L({ de: 'Herunterladen', en: 'Download' })) : null,
    appUrl ? el('a', { role: 'menuitem', href: appUrl, rel: 'noopener' }, svg(ICON.book), L({ de: 'Mehr in der FaLe PDF-App', en: 'More in the FaLe PDF app' })) : null);
  const toast = el('div', { class: 'new-v-toast', hidden: true, role: 'status' });
  const main = el('div', { class: 'new-v-main' }, side, scroller, menu, toast);
  const pageIn = el('input', { type: 'text', inputmode: 'numeric', class: 'wt-input', id: 'new-v-page', value: '1', aria: { label: L({ de: 'Seite', en: 'Page' }) } });
  const zoomBtn = el('button', { type: 'button', class: 'new-v-zoom', aria: { label: L({ de: 'Zoom – tippen zum Anpassen an die Breite', en: 'Zoom – tap to fit width' }) }, onclick: () => setScale(st.fit ? Math.min(MAX_SCALE, fitScale() * 2) : fitScale(), null, !st.fit ? true : false) });
  const bottom = el('div', { class: 'new-v-bottom' },
    ib(ICON.up, { de: 'Vorherige Seite', en: 'Previous page' }, () => goTo(st.page - 1)),
    el('div', { class: 'new-v-pageno' }, pageIn, el('span', {}, `/ ${n}`)),
    ib(ICON.down, { de: 'Nächste Seite', en: 'Next page' }, () => goTo(st.page + 1)),
    el('span', { class: 'new-v-spacer' }),
    ib(ICON.zoomOut, { de: 'Verkleinern', en: 'Zoom out' }, () => zoomBy(1 / 1.25)), zoomBtn, ib(ICON.zoomIn, { de: 'Vergrößern', en: 'Zoom in' }, () => zoomBy(1.25)));
  const root = el('div', { class: 'new-v', role: 'dialog', aria: { modal: 'true', labelledby: 'new-v-title' } }, top, search, main, bottom);
  document.body.append(root);
  document.documentElement.classList.add('new-v-lock');
  setNight(st.night);
  const lastFocus = document.activeElement;

  // back button (phones) closes the reader
  history.pushState({ newViewer: true }, '');
  const onPop = () => { if (!st.closed) close(true); };
  window.addEventListener('popstate', onPop);

  // ---------------------------------------------------------------- layout
  const pageEls = [];
  const io = new IntersectionObserver(entries => {
    for (const e of entries) { const i = +e.target.dataset.i; if (e.isIntersecting) want(i); }
  }, { root: scroller, rootMargin: '700px 0px' });

  async function init() {
    for (let i = 1; i <= n; i++) {
      const p = await pdf.getPage(i);
      const vp = p.getViewport({ scale: 1 });
      st.sizes.push({ w: vp.width, h: vp.height });
      const div = el('div', { class: 'new-v-page', dataset: { i: String(i) }, aria: { label: L({ de: `Seite ${i}`, en: `Page ${i}` }) }, role: 'img' }, el('span', { class: 'new-v-num', 'aria-hidden': 'true' }, String(i)));
      pageEls.push(div);
      pagesEl.append(div);
      if (i % 50 === 0) await new Promise(r => setTimeout(r, 0));
      if (st.closed) return;
    }
    st.scale = Math.min(fitScale(), window.matchMedia('(pointer: coarse)').matches ? 99 : 1.6);
    st.fit = Math.abs(st.scale - fitScale()) < 0.01;
    layout();
    pageEls.forEach(d => io.observe(d));
    buildSide();
    scroller.focus({ preventScroll: true });
  }
  const maxW = () => Math.max(...st.sizes.map(s => s.w), 1);
  const fitScale = () => Math.max(MIN_SCALE, Math.min(MAX_SCALE, (scroller.clientWidth - 2 * GAP) / maxW()));
  function layout() {
    st.sizes.forEach((s, i) => { const d = pageEls[i]; d.style.width = `${Math.floor(s.w * st.scale)}px`; d.style.height = `${Math.floor(s.h * st.scale)}px`; });
    zoomBtn.textContent = `${Math.round(st.scale * 100)} %`;
    for (const i of st.rendered.keys()) want(i);
  }
  /** Change the scale; focus = [x, y] in scroller client coordinates that stays put. */
  function setScale(s, focus = null, fitMode = false) {
    s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
    const k = s / st.scale;
    const fx = focus ? focus[0] : scroller.clientWidth / 2, fy = focus ? focus[1] : scroller.clientHeight / 2;
    const dx = scroller.scrollLeft + fx, dy = scroller.scrollTop + fy;
    st.scale = s;
    st.fit = fitMode || Math.abs(s - fitScale()) < 0.01;
    layout();
    scroller.scrollLeft = dx * k - fx;
    scroller.scrollTop = dy * k - fy;
  }
  const zoomBy = f => setScale(st.scale * f);

  // ---------------------------------------------------------------- rendering
  function want(i) { st.queue.add(i); pump(); }
  async function pump() {
    if (st.busy || st.closed) return;
    st.busy = true;
    try {
      while (st.queue.size && !st.closed) {
        // nearest wanted page first
        const list = [...st.queue].sort((a, b) => Math.abs(a - st.page) - Math.abs(b - st.page));
        const i = list[0];
        st.queue.delete(i);
        const div = pageEls[i - 1];
        const r = div.getBoundingClientRect(), sr = scroller.getBoundingClientRect();
        if (r.bottom < sr.top - 900 || r.top > sr.bottom + 900) continue; // scrolled away meanwhile
        const have = st.rendered.get(i);
        const dpr = Math.min(2.5, window.devicePixelRatio || 1);
        if (have && Math.abs(have.scale - st.scale * dpr) < 0.01) continue;
        const page = await pdf.getPage(i);
        let c;
        try { c = await renderPage(page, { scale: st.scale * dpr }); } catch (err) { console.warn(err); continue; }
        if (st.closed) { c.width = c.height = 0; break; }
        c.setAttribute('aria-hidden', 'true');
        if (have) { have.canvas.replaceWith(c); have.canvas.width = have.canvas.height = 0; } else div.prepend(c);
        st.rendered.set(i, { canvas: c, scale: st.scale * dpr });
        evict();
      }
    } finally { st.busy = false; }
  }
  function evict() {
    if (st.rendered.size <= MAX_RENDERED) return;
    const far = [...st.rendered.keys()].sort((a, b) => Math.abs(b - st.page) - Math.abs(a - st.page));
    for (const i of far.slice(0, st.rendered.size - MAX_RENDERED)) { const r = st.rendered.get(i); r.canvas.remove(); r.canvas.width = r.canvas.height = 0; st.rendered.delete(i); }
  }

  // ---------------------------------------------------------------- page tracking + navigation
  let raf = 0;
  scroller.addEventListener('scroll', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const y = scroller.scrollTop + scroller.clientHeight / 3;
      let lo = 0, hi = pageEls.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (pageEls[mid].offsetTop <= y) lo = mid; else hi = mid - 1; }
      setPage(lo + 1);
    });
  }, { passive: true });
  function setPage(p) {
    if (p === st.page) return;
    st.page = p;
    if (document.activeElement !== pageIn) pageIn.value = String(p);
    thumbCurrent();
  }
  function goTo(p, yFrac = 0) {
    p = Math.max(1, Math.min(n, p | 0));
    const d = pageEls[p - 1];
    if (!d) return;
    scroller.scrollTop = d.offsetTop - GAP + yFrac * d.offsetHeight;
    setPage(p);
    pageIn.value = String(p);
  }
  pageIn.addEventListener('focus', () => pageIn.select());
  pageIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); goTo(parseInt(pageIn.value, 10) || st.page); scroller.focus({ preventScroll: true }); } });
  pageIn.addEventListener('change', () => goTo(parseInt(pageIn.value, 10) || st.page));

  // ---------------------------------------------------------------- gestures
  let pinch = null, lastTap = 0;
  const center = (a, b, r) => [(a.clientX + b.clientX) / 2 - r.left, (a.clientY + b.clientY) / 2 - r.top];
  scroller.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      const r = scroller.getBoundingClientRect();
      const [a, b] = e.touches;
      pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), c: center(a, b, r), k: 1 };
      pagesEl.style.transformOrigin = `${scroller.scrollLeft + pinch.c[0]}px ${scroller.scrollTop + pinch.c[1]}px`;
    } else if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTap < 300) {
        e.preventDefault();
        const r = scroller.getBoundingClientRect();
        const t = e.touches[0];
        setScale(st.fit ? Math.min(MAX_SCALE, fitScale() * 2) : fitScale(), [t.clientX - r.left, t.clientY - r.top], !st.fit);
        lastTap = 0;
      } else lastTap = now;
    }
  }, { passive: false });
  scroller.addEventListener('touchmove', e => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const [a, b] = e.touches;
    pinch.k = Math.max(MIN_SCALE / st.scale, Math.min(MAX_SCALE / st.scale, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinch.d));
    pagesEl.style.transform = `scale(${pinch.k})`;
  }, { passive: false });
  const endPinch = e => {
    if (!pinch || e.touches.length >= 2) return;
    const p = pinch;
    pinch = null;
    pagesEl.style.transform = '';
    if (Math.abs(p.k - 1) > 0.02) setScale(st.scale * p.k, p.c);
  };
  scroller.addEventListener('touchend', endPinch);
  scroller.addEventListener('touchcancel', endPinch);
  scroller.addEventListener('wheel', e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const r = scroller.getBoundingClientRect();
    setScale(st.scale * Math.exp(-e.deltaY / 300), [e.clientX - r.left, e.clientY - r.top]);
  }, { passive: false });
  root.addEventListener('keydown', e => {
    const inField = e.target === sInput || e.target === pageIn;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); toggleSearch(true); return; }
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!menu.hidden) toggleMenu(false); else if (!search.hidden) toggleSearch(false); else if (!side.hidden) toggleSide(false); else close();
      return;
    }
    if (inField) return;
    if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) { e.preventDefault(); zoomBy(1.25); }
    else if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); zoomBy(0.8); }
    else if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); setScale(fitScale(), null, true); }
    else if (e.key === 'Home' && e.ctrlKey) { e.preventDefault(); goTo(1); }
    else if (e.key === 'End' && e.ctrlKey) { e.preventDefault(); goTo(n); }
  });
  let rt = 0;
  const onResize = () => { clearTimeout(rt); rt = setTimeout(() => { if (st.fit) setScale(fitScale(), null, true); }, 150); };
  window.addEventListener('resize', onResize);

  // ---------------------------------------------------------------- search
  const texts = new Map(); // page → {str, spans:[{s, e, item}], vp1}
  let matches = [], cur = -1, sTimer = 0, sSeq = 0;
  async function pageText(i) {
    if (texts.has(i)) return texts.get(i);
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    let str = '';
    const spans = [];
    for (const it of tc.items) {
      if (typeof it.str !== 'string') continue;
      spans.push({ s: str.length, e: str.length + it.str.length, it });
      str += it.str;
      if (it.hasEOL) str += '\n';
    }
    const t = { str: str.toLowerCase(), spans, vp: page.getViewport({ scale: 1 }) };
    texts.set(i, t);
    return t;
  }
  const norm = q => q.toLowerCase().replace(/\s+/g, ' ').trim();
  async function runSearch() {
    const q = norm(sInput.value);
    const my = ++sSeq;
    clearHl();
    matches = []; cur = -1;
    if (!q) { sCount.textContent = ''; return; }
    sCount.textContent = '…';
    for (let i = 1; i <= n; i++) {
      const t = await pageText(i);
      if (my !== sSeq) return;
      const hay = t.str.replace(/\s/g, ' ');
      for (let at = hay.indexOf(q); at >= 0; at = hay.indexOf(q, at + q.length)) matches.push({ page: i, s: at, e: at + q.length });
      if (i % 20 === 0) { sCount.textContent = `${matches.length} …`; await new Promise(r => setTimeout(r, 0)); }
    }
    if (!matches.length) { sCount.textContent = L({ de: 'Keine Treffer', en: 'No matches' }); return; }
    paintHl();
    const firstAfter = matches.findIndex(m => m.page >= st.page);
    show(firstAfter >= 0 ? firstAfter : 0);
  }
  function rectsOf(m) {
    const t = texts.get(m.page);
    const out = [];
    for (const sp of t.spans) {
      if (sp.e <= m.s || sp.s >= m.e) continue;
      const it = sp.it, tr = it.transform, len = Math.max(1, it.str.length);
      const a = Math.max(m.s, sp.s) - sp.s, b = Math.min(m.e, sp.e) - sp.s;
      const fh = it.height || Math.hypot(tr[2], tr[3]) || 10;
      const ux = tr[0] / (Math.hypot(tr[0], tr[1]) || 1), uy = tr[1] / (Math.hypot(tr[0], tr[1]) || 1);
      const w = it.width || 0;
      const x0 = tr[4] + ux * w * a / len, y0 = tr[5] + uy * w * a / len;
      const x1 = tr[4] + ux * w * b / len, y1 = tr[5] + uy * w * b / len;
      const nx = -uy, ny = ux; // up, perpendicular to the baseline
      const pts = [[x0, y0], [x1, y1]].flatMap(([x, y]) => [[x - 0.25 * fh * nx, y - 0.25 * fh * ny], [x + 0.95 * fh * nx, y + 0.95 * fh * ny]]).map(([x, y]) => t.vp.convertToViewportPoint(x, y));
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      out.push({ l: Math.min(...xs) / t.vp.width, t: Math.min(...ys) / t.vp.height, w: (Math.max(...xs) - Math.min(...xs)) / t.vp.width, h: (Math.max(...ys) - Math.min(...ys)) / t.vp.height });
    }
    return out;
  }
  function clearHl() { root.querySelectorAll('.new-v-hl').forEach(h => h.remove()); }
  function paintHl() {
    matches.forEach((m, k) => {
      m.els = rectsOf(m).map(r => {
        const h = el('div', { class: 'new-v-hl', dataset: { m: String(k) } });
        h.style.left = `${r.l * 100}%`; h.style.top = `${r.t * 100}%`; h.style.width = `${r.w * 100}%`; h.style.height = `${r.h * 100}%`;
        pageEls[m.page - 1].append(h);
        return h;
      });
      m.box = rectsOf(m)[0];
    });
  }
  function show(k) {
    if (!matches.length) return;
    cur = (k + matches.length) % matches.length;
    root.querySelectorAll('.new-v-hl.is-cur').forEach(h => h.classList.remove('is-cur'));
    const m = matches[cur];
    (m.els || []).forEach(h => h.classList.add('is-cur'));
    const d = pageEls[m.page - 1];
    const yIn = (m.box ? m.box.t : 0) * d.offsetHeight;
    scroller.scrollTop = d.offsetTop + yIn - scroller.clientHeight / 3;
    if (m.box) { const x = d.offsetLeft + m.box.l * d.offsetWidth; if (x < scroller.scrollLeft || x > scroller.scrollLeft + scroller.clientWidth - 40) scroller.scrollLeft = x - 40; }
    setPage(m.page);
    pageIn.value = String(m.page);
    sCount.textContent = `${cur + 1} / ${matches.length}`;
  }
  const step = d => { if (matches.length) show(cur + d); };
  sInput.addEventListener('input', () => { clearTimeout(sTimer); sTimer = setTimeout(() => { const q = norm(sInput.value); runSearch().then(() => { lastQ = q; }); }, 350); });
  let lastQ = null;
  sInput.addEventListener('input', () => { lastQ = null; });
  sInput.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    clearTimeout(sTimer);
    const q = norm(sInput.value);
    if (matches.length && q === lastQ) step(e.shiftKey ? -1 : 1);
    else runSearch().then(() => { lastQ = q; });
  });
  function toggleSearch(on = search.hidden) {
    search.hidden = !on;
    btnSearch.setAttribute('aria-pressed', String(on));
    if (on) { sInput.focus(); sInput.select(); } else { clearHl(); matches = []; sCount.textContent = ''; scroller.focus({ preventScroll: true }); }
  }

  // ---------------------------------------------------------------- sidebar: outline + thumbnails
  let thumbs = [], thumbIo = null, outline = null, sideTab = 'outline';
  async function buildSide() {
    try { outline = await pdf.getOutline(); } catch { outline = null; }
    if (!outline || !outline.length) sideTab = 'pages';
    renderSide();
  }
  function renderSide() {
    clear(sideTabs); clear(sideBody);
    const tab = (id, label) => el('button', { type: 'button', class: 'new-chip', aria: { pressed: String(sideTab === id) }, onclick: () => { sideTab = id; renderSide(); } }, L(label));
    sideTabs.append(tab('outline', { de: 'Inhalt', en: 'Contents' }), tab('pages', { de: 'Seiten', en: 'Pages' }));
    if (sideTab === 'outline') {
      if (!outline || !outline.length) { sideBody.append(el('p', { class: 'new-muted' }, L({ de: 'Diese PDF hat keine Lesezeichen.', en: 'This PDF has no bookmarks.' }))); return; }
      const build = items => el('ul', { class: 'new-v-outline' }, items.map(it => el('li', {}, el('button', { type: 'button', onclick: () => jumpDest(it.dest) }, it.title || '–'), it.items && it.items.length ? build(it.items) : null)));
      sideBody.append(build(outline));
    } else {
      thumbIo?.disconnect();
      thumbIo = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { thumbIo.unobserve(e.target); drawThumb(+e.target.dataset.i, e.target); } }), { root: side, rootMargin: '300px 0px' });
      const grid = el('div', { class: 'new-v-thumbs' });
      thumbs = [];
      for (let i = 1; i <= n; i++) {
        const img = el('img', { alt: '' });
        const s = st.sizes[i - 1];
        img.style.aspectRatio = `${s.w} / ${s.h}`;
        const b = el('button', { type: 'button', dataset: { i: String(i) }, aria: { label: L({ de: `Zu Seite ${i}`, en: `Go to page ${i}` }), current: i === st.page ? 'page' : null }, onclick: () => { goTo(i); if (matchMedia('(max-width: 719px)').matches) toggleSide(false); } }, img, el('span', {}, String(i)));
        thumbs.push(b);
        grid.append(b);
        thumbIo.observe(b);
      }
      sideBody.append(grid);
    }
  }
  async function drawThumb(i, b) {
    try {
      const page = await pdf.getPage(i);
      const c = await renderPage(page, { width: 130, dpr: Math.min(2, window.devicePixelRatio || 1) });
      c.toBlob(bl => { if (!bl) return; const img = b.querySelector('img'); img.src = URL.createObjectURL(bl); img.onload = () => URL.revokeObjectURL(img.src); c.width = c.height = 0; }, 'image/jpeg', 0.8);
    } catch (err) { console.warn(err); }
  }
  function thumbCurrent() { thumbs.forEach((b, k) => { if (k + 1 === st.page) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }); }
  async function jumpDest(dest) {
    try {
      const d = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
      if (!Array.isArray(d)) return;
      const idx = typeof d[0] === 'number' ? d[0] : await pdf.getPageIndex(d[0]);
      let frac = 0;
      if (d[1] && d[1].name === 'XYZ' && typeof d[3] === 'number') {
        const s = st.sizes[idx];
        const page = await pdf.getPage(idx + 1);
        const vp = page.getViewport({ scale: 1 });
        frac = Math.max(0, Math.min(1, vp.convertToViewportPoint(d[2] || 0, d[3])[1] / s.h));
      }
      goTo(idx + 1, frac);
      if (matchMedia('(max-width: 719px)').matches) toggleSide(false);
    } catch (err) { console.warn(err); }
  }
  function toggleSide(on = side.hidden) { side.hidden = !on; btnSide.setAttribute('aria-pressed', String(on)); if (on && sideTab === 'pages') thumbCurrent(); }
  function toggleMenu(on = menu.hidden) {
    menu.hidden = !on;
    btnMore.setAttribute('aria-expanded', String(on));
    if (on) menu.querySelector('button, a')?.focus();
  }
  document.addEventListener('pointerdown', e => { if (!menu.hidden && !menu.contains(e.target) && e.target !== btnMore && !btnMore.contains(e.target)) toggleMenu(false); });
  function setNight(on) {
    st.night = on;
    root.classList.toggle('is-night', on);
    nightBtn.setAttribute('aria-checked', String(on));
    try { localStorage.setItem('fale-wt-viewer-night', on ? '1' : '0'); } catch { /* storage unavailable */ }
  }
  let toastTimer = 0;
  function say(text, ms = 2500) { toast.textContent = text; toast.hidden = false; clearTimeout(toastTimer); if (ms) toastTimer = setTimeout(() => { toast.hidden = true; }, ms); }

  // ---------------------------------------------------------------- print
  async function printDoc() {
    const box = el('div', { class: 'new-print', 'aria-hidden': 'true' });
    const urls = [];
    try {
      for (let i = 1; i <= n; i++) {
        say(L({ de: `Druck wird vorbereitet … Seite ${i} von ${n}`, en: `Preparing print … page ${i} of ${n}` }), 0);
        const page = await pdf.getPage(i);
        const c = await renderPage(page, { scale: 150 / 72 });
        const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
        c.width = c.height = 0;
        const u = URL.createObjectURL(blob);
        urls.push(u);
        box.append(el('img', { src: u, alt: '' }));
        if (st.closed) return;
      }
      document.body.append(box);
      await Promise.all([...box.querySelectorAll('img')].map(im => im.decode().catch(() => {})));
      toast.hidden = true;
      document.documentElement.classList.add('new-printing');
      window.print();
    } finally {
      setTimeout(() => { document.documentElement.classList.remove('new-printing'); box.remove(); urls.forEach(u => URL.revokeObjectURL(u)); }, 1500);
    }
  }

  // ---------------------------------------------------------------- close
  function close(fromHistory = false) {
    if (st.closed) return;
    st.closed = true;
    io.disconnect(); thumbIo?.disconnect();
    window.removeEventListener('resize', onResize);
    window.removeEventListener('popstate', onPop);
    for (const r of st.rendered.values()) r.canvas.width = r.canvas.height = 0;
    root.remove();
    document.documentElement.classList.remove('new-v-lock');
    if (!fromHistory && history.state && history.state.newViewer) history.back();
    try { lastFocus?.focus?.(); } catch { /* gone */ }
    onClose();
  }

  init().catch(err => { console.warn(err); say(L({ de: 'Die PDF konnte nicht angezeigt werden.', en: 'The PDF could not be displayed.' }), 0); });
  return { close, goTo, setScale: s => setScale(s), state: st, root };
}
