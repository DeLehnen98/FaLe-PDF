// Shared helpers for the pro tools: stylesheet loading, page stage, result cards, colors.
import * as db from '../db.js';
import { icon } from '../icons.js';
import { h, esc, toast, downloadBlob, shareBlob, formatSize, UserError } from '../ui.js';
import { renderPage } from '../pdfcore.js';
import { getDocBytes } from '../library.js';

export const tick = () => new Promise(r => setTimeout(r, 0));
export const frame = () => new Promise(r => requestAnimationFrame(() => r()));

let cssPromise = null;
/** Load css/protools.css once (lazily, so app start stays fast). */
export function ensureCss() {
  if (cssPromise) return cssPromise;
  if (document.querySelector('link[data-protools]')) return (cssPromise = Promise.resolve());
  cssPromise = new Promise(resolve => {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = new URL('../../css/protools.css', import.meta.url).href;
    l.dataset.protools = '1';
    l.onload = () => resolve();
    l.onerror = () => resolve();
    document.head.appendChild(l);
    setTimeout(resolve, 2500);
  });
  return cssPromise;
}

/** Common start of a document tool: loads metadata + bytes, sets the title. */
export async function openToolDoc(screen, docId, title) {
  await ensureCss();
  const doc = await db.getDoc(docId);
  if (!doc) {
    screen.body.innerHTML = '<p class="panel-empty">Dokument nicht gefunden.</p>';
    return null;
  }
  screen.setTitle(title, doc.name);
  const bytes = await getDocBytes(docId);
  return { doc, bytes };
}

export const COLORS = [
  { c: '#FFD43B', n: 'Gelb' }, { c: '#69DB7C', n: 'Grün' }, { c: '#4DABF7', n: 'Blau' },
  { c: '#F783AC', n: 'Pink' }, { c: '#FF6B6B', n: 'Rot' }, { c: '#1F2340', n: 'Schwarz' },
];
export const INK_COLORS = [
  { c: '#1F2340', n: 'Schwarz' }, { c: '#1C64F2', n: 'Blau' }, { c: '#E03131', n: 'Rot' },
  { c: '#2F9E44', n: 'Grün' }, { c: '#F08C00', n: 'Orange' }, { c: '#FFFFFF', n: 'Weiß' },
];

export function hexToRgb(hex) {
  const m = String(hex).replace('#', '');
  const v = parseInt(m.length === 3 ? m.split('').map(x => x + x).join('') : m, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/** Swatch group (role=radiogroup). onPick(color) */
export function swatches(list, current, onPick, label = 'Farbe') {
  const el = h(`<div class="pt-swatches" role="radiogroup" aria-label="${esc(label)}"></div>`);
  list.forEach(({ c, n }) => {
    const b = h(`<button type="button" class="pt-swatch" role="radio" aria-checked="${c === current}" aria-label="${esc(n)}" style="--sw:${c}"></button>`);
    b.addEventListener('click', () => {
      el.querySelectorAll('.pt-swatch').forEach(x => x.setAttribute('aria-checked', String(x === b)));
      onPick(c);
    });
    el.appendChild(b);
  });
  return el;
}

/** Card for non-PDF results (docx, pptx, zip …) with download + share. */
export function fileResultCard(blob, name, { title = 'Fertig', iconName = 'file', note = '', type } = {}) {
  const el = h(`<div class="card result-card" role="status"><span class="tile-ic">${icon(iconName)}</span>
    <div class="grow"><div class="result-title">${icon('check')} ${esc(title)}</div>
    <div class="doc-name">${esc(name)}</div><div class="doc-meta">${formatSize(blob.size)}${note ? ' · ' + esc(note) : ''}</div></div>
    <div class="actions">
      <button class="btn btn-primary btn-sm" type="button" data-r="dl">${icon('download')} Herunterladen</button>
      <button class="btn btn-ghost btn-sm" type="button" data-r="share">${icon('share')} Teilen</button>
    </div></div>`);
  el.querySelector('[data-r="dl"]').addEventListener('click', () => downloadBlob(blob, name));
  el.querySelector('[data-r="share"]').addEventListener('click', () => shareBlob(blob, name, type || blob.type));
  return el;
}

/** Parse "1-3, 5" (empty = all) — returns null when invalid. */
export function parseRange(str, max) {
  const s = String(str || '').trim();
  if (!s) return Array.from({ length: max }, (_, i) => i + 1);
  const out = new Set();
  for (const part of s.split(/[,;]+/)) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^(\d+)\s*[-–]\s*(\d+)?$/);
    if (m) {
      const a = +m[1], b = m[2] ? +m[2] : max;
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= max) out.add(i);
    } else if (/^\d+$/.test(p)) {
      const n = +p;
      if (n >= 1 && n <= max) out.add(n);
    } else return null;
  }
  return [...out].sort((a, b) => a - b);
}

/** Replace characters the standard fonts (WinAnsi) cannot encode. */
export { makeSanitizer } from './formfields.js';

/** Read an image file into {bytes, type:'png'|'jpg', w, h} (re-encoded when needed). */
export async function readImageFile(file, maxDim = 2400) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new UserError('Das Bild konnte nicht gelesen werden.')); i.src = url; });
    let w = img.naturalWidth, hh = img.naturalHeight;
    const isPng = file.type === 'image/png', isJpg = file.type === 'image/jpeg';
    if ((isPng || isJpg) && Math.max(w, hh) <= maxDim) {
      return { bytes: new Uint8Array(await file.arrayBuffer()), type: isPng ? 'png' : 'jpg', w, h: hh, url: null };
    }
    const f = Math.min(1, maxDim / Math.max(w, hh));
    w = Math.max(1, Math.round(w * f)); hh = Math.max(1, Math.round(hh * f));
    const c = document.createElement('canvas');
    c.width = w; c.height = hh;
    c.getContext('2d').drawImage(img, 0, 0, w, hh);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    c.width = c.height = 0;
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'png', w, h: hh };
  } finally { URL.revokeObjectURL(url); }
}

// ---------------------------------------------------------------------------------------
// PageStage: renders all pages of a pdf.js document lazily at a common "fit width" scale,
// each page with an overlay element for interaction. Geometry inside overlays uses the
// page viewport at scale 1 (with the page's /Rotate applied): see pageInfo.base.
// ---------------------------------------------------------------------------------------
export class PageStage {
  constructor(stageEl, pdf, { maxWidth = 980, gutter = 24, onPageCreated = null, onScale = null } = {}) {
    this.stageEl = stageEl;
    this.pdf = pdf;
    this.maxWidth = maxWidth;
    this.gutter = gutter;
    this.zoom = 1;
    this.scale = 1;
    this.pages = [];
    this.onPageCreated = onPageCreated;
    this.onScale = onScale;
    this.alive = true;
    this.box = h('<div class="pt-pages"></div>');
    stageEl.appendChild(this.box);
  }

  async init(onProgress) {
    const n = this.pdf.numPages;
    for (let i = 1; i <= n; i++) {
      const page = await this.pdf.getPage(i);
      if (!this.alive) return;
      const base = page.getViewport({ scale: 1, rotation: page.rotate });
      const el = h(`<div class="pt-page" data-page="${i}" aria-label="Seite ${i}"><div class="pt-canvas"></div><div class="pt-overlay"></div><span class="pt-pnum">${i}</span></div>`);
      const p = { num: i, page, base, el, canvasBox: el.querySelector('.pt-canvas'), overlay: el.querySelector('.pt-overlay'), rendered: 0, rendering: null };
      this.pages.push(p);
      this.box.appendChild(el);
      if (this.onPageCreated) this.onPageCreated(p);
      if (onProgress && i % 20 === 0) { onProgress(i, n); await tick(); }
    }
    this.fit();
    this.io = new IntersectionObserver(entries => {
      entries.forEach(en => {
        const p = this.pages[+en.target.dataset.page - 1];
        if (!p) return;
        if (en.isIntersecting) this.draw(p);
        else this.release(p);
      });
    }, { root: this.stageEl, rootMargin: '900px 0px' });
    this.pages.forEach(p => this.io.observe(p.el));
    this.ro = new ResizeObserver(() => { const old = this.scale; this.fit(); if (Math.abs(old - this.scale) / old > 0.03) this.redrawVisible(); });
    this.ro.observe(this.stageEl);
  }

  fit() {
    const avail = Math.max(240, Math.min(this.stageEl.clientWidth - this.gutter, this.maxWidth));
    const widest = Math.max(...this.pages.map(p => p.base.width), 1);
    const s = (avail / widest) * this.zoom;
    this.scale = s;
    this.pages.forEach(p => {
      p.el.style.width = `${Math.floor(p.base.width * s)}px`;
      p.el.style.height = `${Math.floor(p.base.height * s)}px`;
    });
    if (this.onScale) this.onScale(s);
  }

  setZoom(z) {
    const prev = this.zoom;
    this.zoom = Math.max(0.5, Math.min(4, z));
    if (prev === this.zoom) return;
    // keep the visual center stable
    const st = this.stageEl;
    const cx = (st.scrollLeft + st.clientWidth / 2) / st.scrollWidth;
    const cy = (st.scrollTop + st.clientHeight / 2) / st.scrollHeight;
    this.fit();
    st.scrollLeft = cx * st.scrollWidth - st.clientWidth / 2;
    st.scrollTop = cy * st.scrollHeight - st.clientHeight / 2;
    this.redrawVisible();
  }

  redrawVisible() {
    this.pages.forEach(p => { p.rendered = 0; });
    if (!this.io) return;
    this.pages.forEach(p => { this.io.unobserve(p.el); this.io.observe(p.el); });
  }

  async draw(p) {
    const want = this.scale;
    if (p.rendered === want || p.rendering === want) return;
    p.rendering = want;
    try {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const canvas = await renderPage(p.page, { scale: want, dpr });
      if (!this.alive || p.rendering !== want) { canvas.width = canvas.height = 0; return; }
      const old = p.canvasBox.querySelector('canvas');
      if (old) { old.width = old.height = 0; old.remove(); }
      p.canvasBox.appendChild(canvas);
      p.rendered = want;
    } catch (e) {
      if (this.alive && !(e && e.name === 'RenderingCancelledException')) console.warn(e);
    } finally { if (p.rendering === want) p.rendering = null; }
  }

  release(p) {
    const c = p.canvasBox.querySelector('canvas');
    if (c && this.pages.length > 6) { c.width = c.height = 0; c.remove(); p.rendered = 0; }
  }

  /** Event → point in page viewport@1 coordinates. */
  pointIn(p, e) {
    const r = p.overlay.getBoundingClientRect();
    return { x: (e.clientX - r.left) / this.scale, y: (e.clientY - r.top) / this.scale };
  }

  pageAt(e) {
    const el = e.target.closest && e.target.closest('.pt-page');
    return el ? this.pages[+el.dataset.page - 1] : null;
  }

  scrollToPage(n) {
    const p = this.pages[n - 1];
    if (p) p.el.scrollIntoView({ block: 'start' });
  }

  destroy() {
    this.alive = false;
    if (this.io) this.io.disconnect();
    if (this.ro) this.ro.disconnect();
    this.pages.forEach(p => { const c = p.canvasBox.querySelector('canvas'); if (c) { c.width = c.height = 0; } try { p.page.cleanup(); } catch {} });
  }
}

/** SVG helper */
export function svgEl(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  return el;
}

export function proBadge() {
  return '<span class="pt-pro" title="Bei anderen PDF-Apps kostenpflichtig – hier gratis">Gratis statt Pro</span>';
}

/** Convert viewport@1 point to PDF user space. */
export const toPdf = (p, x, y) => p.base.convertToPdfPoint(x, y);
/** Convert PDF user space point to viewport@1. */
export const toView = (p, x, y) => p.base.convertToViewportPoint(x, y);

export function notFoundError() { return new UserError('Dokument nicht gefunden.'); }
export { toast };

/** Ask before leaving a tool with unsaved changes (header back button). */
export function guardLeave(screen, isDirty) {
  const back = screen.head && screen.head.querySelector('[data-back]');
  if (!back) return;
  back.addEventListener('click', async e => {
    if (!isDirty() || back.dataset.confirmed) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    const { confirmDialog } = await import('../ui.js');
    const ok = await confirmDialog('Änderungen verwerfen?', 'Du hast ungespeicherte Änderungen. Wenn du jetzt zurückgehst, gehen sie verloren.', { okLabel: 'Verwerfen', danger: true });
    if (ok) { back.dataset.confirmed = '1'; back.click(); }
  }, { capture: true });
}

/** Two-finger panning for drawing surfaces: returns handlers to integrate in pointer logic. */
export function createPan(stageEl) {
  const pts = new Map();
  let last = null;
  return {
    down(e) { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) last = centroid(); return pts.size >= 2; },
    move(e) {
      if (!pts.has(e.pointerId)) return false;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size < 2 || !last) return false;
      const c = centroid();
      stageEl.scrollLeft -= c.x - last.x;
      stageEl.scrollTop -= c.y - last.y;
      last = c;
      return true;
    },
    up(e) { pts.delete(e.pointerId); if (pts.size < 2) last = null; return pts.size > 0 && !!last; },
    get active() { return pts.size >= 2; },
  };
  function centroid() {
    let x = 0, y = 0;
    pts.forEach(p => { x += p.x; y += p.y; });
    return { x: x / pts.size, y: y / pts.size };
  }
}

// Lazy classic-script loader for vendored libraries (globals). Paths are relative to this file.
const scriptLoads = new Map();
export function loadScriptGlobal(rel, globalName, label) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (scriptLoads.has(rel)) return scriptLoads.get(rel);
  const p = new Promise((resolve, reject) => {
    const existing = Array.from(document.scripts).find(s => s.src && s.src.endsWith(rel.replace(/^(\.\.\/)+/, '')));
    const s = existing || document.createElement('script');
    const done = () => (window[globalName] ? resolve(window[globalName]) : reject(new UserError(`${label} konnte nicht geladen werden.`)));
    s.addEventListener('load', done);
    s.addEventListener('error', () => { scriptLoads.delete(rel); reject(new UserError(`${label} konnte nicht geladen werden.`)); });
    if (!existing) {
      s.src = new URL(rel, import.meta.url).href;
      s.async = true;
      document.head.appendChild(s);
    } else if (window[globalName]) done();
  });
  scriptLoads.set(rel, p);
  return p;
}
export const loadDocxLib = () => loadScriptGlobal('../../vendor/docx/docx.iife.js', 'docx', 'Die Word-Bibliothek');
export async function loadPptxLib() {
  if (!window.JSZip) await loadScriptGlobal('../../vendor/jszip/jszip.min.js', 'JSZip', 'Die ZIP-Bibliothek');
  return loadScriptGlobal('../../vendor/pptxgenjs/pptxgen.bundle.js', 'PptxGenJS', 'Die Präsentations-Bibliothek');
}

export function bytesToBase64(u8) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}

/**
 * Like screen.setFoot, but keeps the existing button elements when they are already shown
 * (re-creating them between mousedown and mouseup — e.g. on an input's change/blur — would
 * swallow the user's click).
 */
export function updateFoot(screen, nodes = [], info = '') {
  const foot = screen.foot;
  const current = Array.from(foot.children).filter(c => !c.classList.contains('foot-info'));
  const same = current.length === nodes.length && nodes.every((n, i) => current[i] === n);
  if (!same) { screen.setFoot(nodes, info); return; }
  let el = foot.querySelector('.foot-info');
  if (info) {
    if (!el) { el = document.createElement('span'); el.className = 'foot-info'; foot.prepend(el); }
    if (el.textContent !== info) el.textContent = info;
  } else if (el) el.remove();
  foot.hidden = !nodes.length && !info;
}
