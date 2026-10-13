// Lesemodus: reflowed, phone-friendly reading view built from the PDF text layer.
// Lines are merged into paragraphs, headings detected by font size (collapsible sections),
// images become inline figures, with adjustable size / line height / theme and a remembered
// reading position. Used inside the viewer (overlay) and as a stand-alone tool screen.
import { icon } from '../icons.js';
import { h, esc, errorToast } from '../ui.js';
import { loadPdf, renderPage } from '../pdfcore.js';
import { ensureCss, openToolDoc, tick } from './common.js';
import { analysePage, bodySize, paragraphs } from './pdfstruct.js';
import { pageShapes } from './pagegeom.js';

const SET_KEY = 'fale-reflow-settings';
const POS_KEY = id => `fale-reflow-pos:${id}`;
const DEFAULTS = { size: 19, lead: 1.6, theme: 'auto', font: 'serif', width: 'normal' };

function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

export function readerSettings() { return { ...DEFAULTS, ...(lsGet(SET_KEY) || {}) }; }

/** Stand-alone tool screen. */
export async function mount(screen, { docId, params }) {
  const ctx = await openToolDoc(screen, docId, 'Lesemodus');
  if (!ctx) return;
  const { doc, bytes } = ctx;
  const { pdf } = await loadPdf(bytes.slice(), { name: doc.name, key: docId });
  screen.body.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;padding:0';
  const host = h('<div class="rf-host"></div>');
  screen.body.appendChild(host);
  screen.setFoot([]);
  const start = params && +params.get('seite');
  const view = await openReflow(host, {
    pdf, docId, title: doc.name, startPage: start || null, embedded: true,
    onOriginal: n => { location.hash = `#/ansicht/${docId}?seite=${n}`; },
  });
  return () => { view.destroy(); pdf.destroy(); };
}

/**
 * Build the reflow view into `host`.
 * @returns {Promise<{destroy: Function, currentPage: () => number}>}
 */
export async function openReflow(host, { pdf, docId, title = '', startPage = null, embedded = false, onClose = null, onOriginal = null }) {
  await ensureCss();
  let settings = readerSettings();
  let alive = true;
  const root = h(`<div class="rf" data-theme-r="${esc(settings.theme)}">
    <header class="rf-bar">
      ${onClose ? `<button class="icon-btn" type="button" data-rf="close" aria-label="Lesemodus schließen">${icon('close')}</button>` : ''}
      <div class="rf-title"><strong>${esc(title)}</strong><span data-rf="status">Wird aufbereitet …</span></div>
      <button class="icon-btn" type="button" data-rf="toc" aria-label="Inhalt" title="Inhalt">${icon('outline')}</button>
      <button class="icon-btn" type="button" data-rf="settings" aria-label="Darstellung" aria-expanded="false" title="Darstellung">${icon('textSize')}</button>
    </header>
    <div class="rf-panel" data-rf="panel" hidden>
      <div class="rf-row"><span>Schriftgröße</span>
        <button class="icon-btn" type="button" data-rf="smaller" aria-label="Kleiner"><span class="rf-a small">A</span></button>
        <input type="range" min="14" max="30" step="1" data-rf="size" aria-label="Schriftgröße">
        <button class="icon-btn" type="button" data-rf="bigger" aria-label="Größer"><span class="rf-a">A</span></button></div>
      <div class="rf-row"><span>Zeilenabstand</span><input type="range" min="1.3" max="2.1" step="0.1" data-rf="lead" aria-label="Zeilenabstand"></div>
      <div class="rf-row"><span>Hintergrund</span><div class="rf-themes" role="radiogroup" aria-label="Hintergrund">
        <button type="button" role="radio" data-th="auto" class="rf-th rf-th-auto" aria-label="Wie App">Auto</button>
        <button type="button" role="radio" data-th="hell" class="rf-th rf-th-hell" aria-label="Hell">Hell</button>
        <button type="button" role="radio" data-th="sepia" class="rf-th rf-th-sepia" aria-label="Sepia">Sepia</button>
        <button type="button" role="radio" data-th="dunkel" class="rf-th rf-th-dunkel" aria-label="Dunkel">Dunkel</button></div></div>
      <div class="rf-row"><span>Schrift</span><div class="seg" role="group" aria-label="Schriftart">
        <button type="button" data-font="serif">Serif</button><button type="button" data-font="sans">Sans</button></div>
        <div class="seg" role="group" aria-label="Textbreite"><button type="button" data-width="narrow">Schmal</button><button type="button" data-width="normal">Breit</button></div></div>
    </div>
    <div class="rf-toc" data-rf="tocpanel" hidden><div class="rf-toc-head"><strong>Inhalt</strong><button class="icon-btn" type="button" data-rf="tocclose" aria-label="Inhalt schließen">${icon('close')}</button></div><nav data-rf="toclist"></nav></div>
    <div class="rf-scroll" data-rf="scroll" tabindex="0">
      <article class="rf-doc" data-rf="doc" lang="de"></article>
      <div class="rf-more" data-rf="more"><span class="spinner dark"></span><span data-rf="moretext">Text wird aufbereitet …</span></div>
    </div>
    <div class="rf-progress"><span data-rf="bar"></span></div>
  </div>`);
  host.appendChild(root);
  const q = n => root.querySelector(`[data-rf="${n}"]`);
  const scroller = q('scroll');
  const article = q('doc');
  const n = pdf.numPages;

  // ---------- settings ----------
  function applySettings() {
    root.style.setProperty('--rf-size', `${settings.size}px`);
    root.style.setProperty('--rf-lead', String(settings.lead));
    root.dataset.themeR = settings.theme;
    root.dataset.font = settings.font;
    root.dataset.width = settings.width;
    q('size').value = String(settings.size);
    q('lead').value = String(settings.lead);
    root.querySelectorAll('[data-th]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.th === settings.theme)));
    root.querySelectorAll('[data-font]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.font === settings.font)));
    root.querySelectorAll('[data-width]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.width === settings.width)));
  }
  const change = patch => {
    const anchor = currentAnchor();
    settings = { ...settings, ...patch };
    lsSet(SET_KEY, settings);
    applySettings();
    if (anchor) restoreAnchor(anchor);
  };
  applySettings();
  q('settings').addEventListener('click', () => {
    const p = q('panel');
    p.hidden = !p.hidden;
    q('settings').setAttribute('aria-expanded', String(!p.hidden));
    q('tocpanel').hidden = true;
  });
  q('size').addEventListener('input', e => change({ size: +e.target.value }));
  q('lead').addEventListener('input', e => change({ lead: +e.target.value }));
  q('smaller').addEventListener('click', () => change({ size: Math.max(14, settings.size - 1) }));
  q('bigger').addEventListener('click', () => change({ size: Math.min(30, settings.size + 1) }));
  root.querySelectorAll('[data-th]').forEach(b => b.addEventListener('click', () => change({ theme: b.dataset.th })));
  root.querySelectorAll('[data-font]').forEach(b => b.addEventListener('click', () => change({ font: b.dataset.font })));
  root.querySelectorAll('[data-width]').forEach(b => b.addEventListener('click', () => change({ width: b.dataset.width })));
  if (onClose) q('close').addEventListener('click', () => onClose(currentPage()));
  q('toc').addEventListener('click', () => { const t = q('tocpanel'); t.hidden = !t.hidden; q('panel').hidden = true; });
  q('tocclose').addEventListener('click', () => { q('tocpanel').hidden = true; });
  scroller.addEventListener('click', e => {
    if (e.target.closest('summary, button, a')) return;
    q('panel').hidden = true; q('tocpanel').hidden = true;
  });

  // ---------- building ----------
  const stack = []; // open sections [{level, body}]
  const headings = [];
  let textChars = 0, scannedPages = 0, built = 0;
  const target = () => (stack.length ? stack[stack.length - 1].body : article);
  const pageRenders = new Map();
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => { if (en.isIntersecting) { io.unobserve(en.target); drawFigure(en.target); } });
  }, { root: scroller, rootMargin: '600px 0px' });

  function runsHtml(runs) {
    return runs.map(r => {
      let t = esc(r.text);
      if (r.bold) t = `<strong>${t}</strong>`;
      if (r.italic) t = `<em>${t}</em>`;
      return t;
    }).join('');
  }

  function addFigure(pnum, box, pw, ph, caption = '') {
    const w = box.x1 - box.x0, hh = box.y1 - box.y0;
    const fig = h(`<figure class="rf-fig" data-p="${pnum}"><div class="rf-fig-box" style="aspect-ratio:${(w / hh).toFixed(4)}"></div>${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}</figure>`);
    fig._box = box; fig._pw = pw; fig._ph = ph;
    fig.style.maxWidth = `${Math.min(100, Math.max(30, (w / pw) * 130)).toFixed(1)}%`;
    target().appendChild(fig);
    io.observe(fig);
  }

  async function drawFigure(fig) {
    const pnum = +fig.dataset.p;
    const boxEl = fig.querySelector('.rf-fig-box');
    try {
      const b = fig._box;
      const cssW = Math.max(120, boxEl.clientWidth || 300);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const scale = Math.min(3, Math.max(1, (cssW * dpr) / (b.x1 - b.x0)));
      let pr = pageRenders.get(pnum);
      if (!pr || pr.scale < scale) {
        pr = { scale, promise: pdf.getPage(pnum).then(pg => renderPage(pg, { scale })) };
        pageRenders.set(pnum, pr);
      }
      const canvas = await pr.promise;
      if (!alive) return;
      const c = document.createElement('canvas');
      const sx = b.x0 * pr.scale, sy = b.y0 * pr.scale;
      c.width = Math.max(1, Math.round((b.x1 - b.x0) * pr.scale));
      c.height = Math.max(1, Math.round((b.y1 - b.y0) * pr.scale));
      c.getContext('2d').drawImage(canvas, sx, sy, c.width, c.height, 0, 0, c.width, c.height);
      c.setAttribute('role', 'img');
      c.setAttribute('aria-label', `Abbildung auf Seite ${pnum}`);
      boxEl.innerHTML = '';
      boxEl.appendChild(c);
      // drop the page render once all its figures are drawn
      if (!article.querySelector(`.rf-fig[data-p="${pnum}"] .rf-fig-box:empty`)) {
        pageRenders.delete(pnum);
        canvas.width = canvas.height = 0;
      }
    } catch (e) { if (alive) console.warn('figure', e); }
  }

  let body = 11;
  const analysed = [];
  async function analyse(pnum) {
    const page = await pdf.getPage(pnum);
    const a = await analysePage(page);
    const base = page.getViewport({ scale: 1 });
    let shapes = { images: [] };
    try { shapes = await pageShapes(page, base, { wantPaths: false }); } catch {}
    return { pnum, a, shapes, width: base.width, height: base.height };
  }

  function emitPage(info) {
    const { pnum, a, shapes, width: pw, height: ph } = info;
    const marker = h(`<div class="rf-pg" data-page="${pnum}"><span>Seite ${pnum}</span>${onOriginal || onClose ? `<button type="button" class="rf-orig" data-go="${pnum}">Original</button>` : ''}</div>`);
    target().appendChild(marker);
    const area = pw * ph;
    const imgs = (shapes.images || []).filter(b => {
      const w = Math.min(b.x1, pw) - Math.max(b.x0, 0), hh = Math.min(b.y1, ph) - Math.max(b.y0, 0);
      return w > 40 && hh > 30 && (w * hh) / area > 0.015;
    }).map(b => ({ x0: Math.max(0, b.x0), y0: Math.max(0, b.y0), x1: Math.min(pw, b.x1), y1: Math.min(ph, b.y1) }));
    // merge overlapping image boxes (tiled images)
    const merged = [];
    for (const b of imgs.sort((p, r) => p.y0 - r.y0)) {
      const m = merged.find(o => !(b.x0 > o.x1 + 2 || b.x1 < o.x0 - 2 || b.y0 > o.y1 + 2 || b.y1 < o.y0 - 2));
      if (m) { m.x0 = Math.min(m.x0, b.x0); m.y0 = Math.min(m.y0, b.y0); m.x1 = Math.max(m.x1, b.x1); m.y1 = Math.max(m.y1, b.y1); }
      else merged.push({ ...b });
    }
    const chars = a.chars;
    textChars += chars;
    const fullImage = merged.some(b => ((b.x1 - b.x0) * (b.y1 - b.y0)) / area > 0.6);
    if (chars < 25 && (fullImage || !merged.length)) {
      scannedPages++;
      if (fullImage || merged.length) {
        addFigure(pnum, { x0: 0, y0: 0, x1: pw, y1: ph }, pw, ph, `Seite ${pnum} enthält keinen Text (Bild/Scan)`);
      } else if (!chars) {
        target().appendChild(h(`<p class="rf-empty-page">Seite ${pnum} ist leer.</p>`));
      }
      return;
    }
    const paras = paragraphs(a, body);
    const figs = merged.filter(b => ((b.x1 - b.x0) * (b.y1 - b.y0)) / area <= 0.85);
    let fi = 0;
    paras.forEach((p, idx) => {
      while (fi < figs.length && figs[fi].y0 <= p.top + 2) { addFigure(pnum, figs[fi], pw, ph); fi++; }
      const text = p.text.trim();
      if (!text) return;
      // drop running headers/footers: tiny text at the very top/bottom repeated on pages
      if (p.lines.length === 1 && text.length < 60 && (p.top < ph * 0.06 || p.top > ph * 0.93) && p.size <= body * 1.05 && /^(seite\s*)?\d+(\s*(von|\/)\s*\d+)?$/i.test(text)) return;
      if (p.heading) {
        const level = p.heading;
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
        const det = h(`<details class="rf-sec" data-level="${level}" open><summary><span class="rf-h rf-h${level}" role="heading" aria-level="${level + 1}" data-p="${pnum}" data-i="${idx}">${runsHtml(p.runs)}</span></summary><div class="rf-sec-body"></div></details>`);
        target().appendChild(det);
        stack.push({ level, body: det.querySelector('.rf-sec-body') });
        headings.push({ level, text, el: det, page: pnum });
        return;
      }
      const bullet = /^([•\-–▪◦*]|\d{1,3}[.)])\s/.test(text);
      const el = h(`<p class="${bullet ? 'rf-li' : ''}${p.align === 'center' ? ' rf-center' : ''}" data-p="${pnum}" data-i="${idx}">${runsHtml(p.runs)}</p>`);
      target().appendChild(el);
    });
    while (fi < figs.length) { addFigure(pnum, figs[fi], pw, ph); fi++; }
  }

  function renderToc() {
    const nav = q('toclist');
    if (!headings.length) { nav.innerHTML = '<p class="panel-empty">Keine Überschriften erkannt.</p>'; return; }
    nav.innerHTML = '';
    headings.forEach(hd => {
      const b = h(`<button type="button" class="rf-toc-item" style="padding-left:${10 + (hd.level - 1) * 16}px">${esc(hd.text)}<span>S. ${hd.page}</span></button>`);
      b.addEventListener('click', () => {
        let p = hd.el.parentElement.closest('details');
        while (p) { p.open = true; p = p.parentElement.closest('details'); }
        hd.el.open = true;
        hd.el.scrollIntoView({ block: 'start' });
        q('tocpanel').hidden = true;
      });
      nav.appendChild(b);
    });
  }

  root.addEventListener('click', e => {
    const b = e.target.closest('[data-go]');
    if (!b) return;
    const pg = +b.dataset.go;
    if (onClose) onClose(pg); else if (onOriginal) onOriginal(pg);
  });

  // ---------- position ----------
  function blocks() { return Array.from(article.querySelectorAll('p[data-p], .rf-h[data-p], .rf-pg[data-page], .rf-fig')); }
  function currentAnchor() {
    const top = scroller.getBoundingClientRect().top + 8;
    let best = null;
    for (const el of blocks()) {
      if (!el.offsetParent) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom > top) { best = { el, off: (top - r.top) / Math.max(1, r.height) }; break; }
    }
    if (!best) return null;
    const el = best.el;
    return { p: +(el.dataset.p || el.dataset.page), i: el.dataset.i != null ? +el.dataset.i : -1, off: Math.max(0, Math.min(1, best.off)) };
  }
  function restoreAnchor(a) {
    let el = a.i >= 0 ? article.querySelector(`[data-p="${a.p}"][data-i="${a.i}"]`) : null;
    if (!el) el = article.querySelector(`.rf-pg[data-page="${a.p}"]`);
    if (!el) return false;
    let d = el.closest('details');
    while (d) { d.open = true; d = d.parentElement.closest('details'); }
    const r = el.getBoundingClientRect(), sr = scroller.getBoundingClientRect();
    scroller.scrollTop += r.top - sr.top - 8 + a.off * r.height;
    return true;
  }
  function currentPage() {
    const a = currentAnchor();
    return a ? a.p : 1;
  }
  let saveT = null;
  const onScroll = () => {
    const max = scroller.scrollHeight - scroller.clientHeight;
    q('bar').style.width = `${max > 0 ? Math.min(100, (scroller.scrollTop / max) * 100) : 0}%`;
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      const a = currentAnchor();
      if (a && docId) lsSet(POS_KEY(docId), { ...a, at: Date.now() });
      if (a) q('status').textContent = built < n ? `Seite ${a.p} · ${built} von ${n} aufbereitet` : `Seite ${a.p} von ${n}`;
    }, 250);
  };
  scroller.addEventListener('scroll', onScroll, { passive: true });

  const saved = docId ? lsGet(POS_KEY(docId)) : null;
  const want = startPage ? (saved && saved.p === startPage ? saved : { p: startPage, i: -1, off: 0 }) : saved;
  let restored = !want;

  // ---------- run ----------
  (async () => {
    try {
      // body size from the first pages (enough for a stable estimate)
      const sampleN = Math.min(n, 6);
      for (let i = 1; i <= sampleN; i++) { analysed[i] = await analyse(i); if (!alive) return; }
      body = bodySize(analysed.slice(1, sampleN + 1).map(x => x.a)) || 11;
      for (let i = 1; i <= n; i++) {
        if (!alive) return;
        const info = analysed[i] || await analyse(i);
        analysed[i] = null;
        if (!alive) return;
        emitPage(info);
        built = i;
        if (!restored && want && i >= want.p) restored = restoreAnchor(want) || i === n;
        if (i % 3 === 0 || i === n) {
          q('moretext').textContent = `Seite ${i} von ${n} aufbereitet …`;
          q('status').textContent = `${i} von ${n} Seiten aufbereitet`;
          await tick();
        }
      }
      q('more').hidden = true;
      if (!textChars || scannedPages === n) {
        article.innerHTML = '';
        article.appendChild(h(`<div class="rf-noscan"><span class="tile-ic">${icon('scan')}</span>
          <h2>Kein Text zum Umbrechen</h2>
          <p>Dieses Dokument besteht aus Bildern (z. B. ein Scan oder Foto) und enthält keinen erkennbaren Text. Der Lesemodus braucht echten Text – eine Texterkennung (OCR) ist in FaLe PDF nicht eingebaut.</p>
          ${onClose || onOriginal ? '<button class="btn btn-primary" type="button" data-go="1">Zur Seitenansicht</button>' : ''}</div>`));
      }
      renderToc();
      q('status').textContent = `Seite ${currentPage()} von ${n}`;
      onScroll();
    } catch (e) {
      if (!alive) return;
      q('more').hidden = true;
      errorToast(e, 'Der Lesemodus konnte nicht aufgebaut werden.');
    }
  })();

  setTimeout(() => scroller.focus({ preventScroll: true }), 60);
  return {
    destroy() {
      alive = false;
      io.disconnect();
      const a = currentAnchor();
      if (a && docId) lsSet(POS_KEY(docId), { ...a, at: Date.now() });
      pageRenders.forEach(pr => pr.promise.then(c => { c.width = c.height = 0; }).catch(() => {}));
      root.remove();
    },
    currentPage,
    element: root,
  };
}

/** Saved reflow position for a document ({p, i, off, at}) or null. */
export function reflowPosition(docId) { return lsGet(POS_KEY(docId)); }
