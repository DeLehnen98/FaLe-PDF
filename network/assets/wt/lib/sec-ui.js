// Shared UI + PDF helpers of the security/edit tools (sign, fill, redact, protect, unlock, flatten,
// metadata, compare). Everything stays in the browser: no network, no logging of document text.
import { el, icon, clear } from './dom.js';
import { loadPdfLib, saveDoc, saveEncrypted } from './pdf.js';
import { canvasScaleCap } from './shared/limits.js';

let cssDone = false;
/** Load lib/sec.css once (a same-origin stylesheet – allowed by the CSP, no inline styles). */
export function ensureCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const href = new URL('./sec.css', import.meta.url).href;
  if (!document.querySelector(`link[data-sec-css]`)) document.head.append(el('link', { rel: 'stylesheet', href, dataset: { secCss: '1' } }));
}

/** Pick a {de, en} text. */
export const tr = (lang, de, en) => (lang === 'de' ? de : en);

/** An Error that the shell shows to the user as is. */
export const userError = (de, en) => Object.assign(new Error(en), { userMessage: { de, en } });

// ---------------------------------------------------------------- extra icons (24 px stroke paths)
const PATHS = {
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z'],
  eyeOff: ['M3 3l18 18', 'M10.6 5.1A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2', 'M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'],
  dice: ['M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M8 8h.01', 'M16 8h.01', 'M12 12h.01', 'M8 16h.01', 'M16 16h.01'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
  pen: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'],
  type: ['M5 6V4h14v2', 'M12 4v16', 'M9 20h6'],
  camera: ['M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z', 'M12 10.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z'],
  rotate: ['M20 12a8 8 0 1 1-2.3-5.7', 'M20 4v5h-5'],
  rotateL: ['M4 12a8 8 0 1 0 2.3-5.7', 'M4 4v5h5'],
  pages: ['M8 3h10a2 2 0 0 1 2 2v12', 'M4 7h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z'],
  calendar: ['M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
  checkmark: ['M4 12.5l5 5L20 6.5'],
  cross: ['M6 6l12 12', 'M18 6L6 18'],
  prev: ['M15 5l-7 7 7 7'],
  next: ['M9 5l7 7-7 7'],
  search: ['M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14z', 'M20 20l-4-4'],
  box: ['M4 4h16v16H4z'],
  unlock: ['M6.5 10.5h11a2.5 2.5 0 0 1 2.5 2.5v5.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5V13a2.5 2.5 0 0 1 2.5-2.5z', 'M8 10.5V7a4 4 0 0 1 7.5-2'],
  form: ['M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z', 'M8 8h8', 'M8 12h8', 'M8 16h4'],
  shield: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', 'M9 12l2 2 4-4'],
  expand: ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'],
  undo: ['M9 14L4 9l5-5', 'M4 9h10a6 6 0 0 1 0 12h-3'],
  list: ['M8 6h12', 'M8 12h12', 'M8 18h12', 'M4 6h.01', 'M4 12h.01', 'M4 18h.01'],
  layers: ['M12 3l9 5-9 5-9-5z', 'M3 13l9 5 9-5'],
  columns: ['M4 4h7v16H4z', 'M13 4h7v16h-7z'],
  textbox: ['M3 7h18v10H3z', 'M7 10v4'],
  textarea: ['M3 4h18v16H3z', 'M7 8h10', 'M7 12h10', 'M7 16h6'],
  radio: ['M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z', 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z'],
  dropdown: ['M3 7h18v10H3z', 'M14 11l2 2 2-2'],
  wand: ['M4 20L15 9', 'M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1z', 'M19 11l.7 1.3L21 13l-1.3.7L19 15l-.7-1.3L17 13l1.3-.7z'],
};
const NS = 'http://www.w3.org/2000/svg';
/** Icon from dom.js or from the extra set above. */
export function ic(name, cls = 'wt-i') {
  if (!PATHS[name]) return icon(name, cls);
  const s = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) s.setAttribute(k, v);
  if (cls) s.setAttribute('class', cls);
  for (const d of PATHS[name]) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.append(p); }
  return s;
}

/** Small button with icon + visible text (or aria-label when text is empty). */
export function btn(iconName, text, onclick, { cls = 'wt-btn wt-btn-quiet wt-btn-sm', label = null, ...rest } = {}) {
  return el('button', { type: 'button', class: cls, onclick, aria: { label: text ? null : label }, ...rest }, iconName ? ic(iconName) : null, text || null);
}

// ---------------------------------------------------------------- primary button guard
/**
 * Stops the sticky primary button while the stage is not ready (e.g. nothing placed yet) and lets the
 * stage explain why. `check()` returns '' when ready or a message.
 */
export function guardPrimary(stage, state, check, onBlocked) {
  const app = stage.closest('.wt-app') || stage.parentElement;
  const bar = app?.querySelector('.wt-bar');
  if (!bar) return;
  bar.addEventListener('click', ev => {
    const b = ev.target.closest?.('.wt-btn-primary');
    if (!b || state.phase !== 'files') return;
    const msg = check();
    if (!msg) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    onBlocked?.(msg);
  }, true);
}

/**
 * Call `cb(usableInputs)` when a locked file was unlocked on its card (the shell does not call
 * onInputs then) – observes the class of the file cards.
 */
export function watchUnlock(stage, state, cb) {
  const app = stage.closest('.wt-app') || stage.parentElement;
  const list = app?.querySelector('.wt-files');
  if (!list || typeof MutationObserver === 'undefined') return;
  let locked = new Set(state.inputs.filter(i => i.locked).map(i => i.id));
  new MutationObserver(() => {
    const now = new Set(state.inputs.filter(i => i.locked).map(i => i.id));
    const unlocked = [...locked].some(id => !now.has(id) && state.inputs.some(i => i.id === id));
    locked = now;
    if (unlocked) cb(state.inputs.filter(i => !i.error && !i.locked));
  }).observe(list, { subtree: true, attributes: true, attributeFilter: ['class'] });
}

/** Inline status line inside a stage (polite live region). */
export function statusLine(cls = 'sec-status') {
  const p = el('p', { class: cls, role: 'status', aria: { live: 'polite' }, hidden: true });
  return {
    node: p,
    set(text, kind = '') { p.textContent = text || ''; p.hidden = !text; p.dataset.kind = kind; },
  };
}

// ---------------------------------------------------------------- passwords
/** Rough strength estimate (0–4) + entropy in bits; no dictionary, but penalises repeats/sequences. */
export function passwordStrength(pw) {
  if (!pw) return { score: 0, bits: 0 };
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^A-Za-z0-9]/.test(pw)) pool += 33;
  const chars = [...pw];
  let effective = 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i].codePointAt(0), p = i ? chars[i - 1].codePointAt(0) : -9;
    effective += c === p ? 0.25 : Math.abs(c - p) === 1 ? 0.5 : 1;
  }
  let bits = effective * Math.log2(Math.max(pool, 2));
  if (/^(passwor[dt]|123456|qwert|qwertz|hallo|geheim|letmein|admin)/i.test(pw)) bits = Math.min(bits, 12);
  const score = bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  return { score, bits: Math.round(bits) };
}

const GEN_CHARS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Random password from the Web Crypto RNG, grouped for readability: "k7Pm-2Qav-9RtL-w4eX". */
export function generatePassword(groups = 4, size = 4) {
  const out = [];
  const buf = new Uint32Array(groups * size);
  crypto.getRandomValues(buf);
  for (let g = 0; g < groups; g++) {
    let s = '';
    for (let i = 0; i < size; i++) s += GEN_CHARS[buf[g * size + i] % GEN_CHARS.length];
    out.push(s);
  }
  buf.fill(0);
  return out.join('-');
}

/**
 * Password input with show/hide toggle. Returns {node, input, setValue}.
 */
export function passwordInput({ id, label, lang, autocomplete = 'new-password', hint = null, onInput = null, describedby = null }) {
  const input = el('input', { id, class: 'wt-input sec-pw-input', type: 'password', autocomplete, spellcheck: 'false', autocapitalize: 'off', enterkeyhint: 'done',
    aria: { describedby: [hint ? id + '-hint' : null, describedby].filter(Boolean).join(' ') || null }, oninput: () => onInput?.(input.value) });
  const eye = el('button', { type: 'button', class: 'wt-icon-btn sec-eye', aria: { label: tr(lang, 'Passwort anzeigen', 'Show password'), pressed: 'false' } }, ic('eye'));
  eye.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    eye.setAttribute('aria-pressed', String(show));
    eye.setAttribute('aria-label', show ? tr(lang, 'Passwort verbergen', 'Hide password') : tr(lang, 'Passwort anzeigen', 'Show password'));
    clear(eye).append(ic(show ? 'eyeOff' : 'eye'));
  });
  const node = el('div', { class: 'wt-opt sec-pw' }, el('label', { for: id }, label), el('div', { class: 'sec-pw-row' }, input, eye),
    hint ? el('p', { class: 'wt-opt-hint', id: id + '-hint' }, hint) : null);
  return { node, input, eye, setValue(v) { input.value = v; onInput?.(v); } };
}

/** Strength meter element bound to a password input. */
export function strengthMeter(lang, id) {
  const LABELS = {
    de: ['Sehr schwach', 'Schwach', 'Mittel', 'Stark', 'Sehr stark'],
    en: ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'],
  };
  const bar = el('div', { class: 'sec-meter-bar', 'aria-hidden': 'true' }, [0, 1, 2, 3].map(() => el('span')));
  const text = el('span', { class: 'sec-meter-text' });
  const node = el('div', { class: 'sec-meter', id, dataset: { score: '-1' } }, bar, text);
  return {
    node,
    update(pw) {
      if (!pw) { node.dataset.score = '-1'; text.textContent = ''; return; }
      const s = passwordStrength(pw);
      node.dataset.score = String(s.score);
      text.textContent = `${tr(lang, 'Stärke', 'Strength')}: ${LABELS[lang === 'de' ? 'de' : 'en'][s.score]}`;
    },
  };
}

// ---------------------------------------------------------------- page previews
/**
 * Render a pdf.js page including form fields and annotations (annotationMode ENABLE – lib/pdf.js
 * renderPage leaves interactive form widgets out). Give width (css px) or scale.
 */
export async function renderPage(page, { width = null, scale = null, dpr = 1, signal = null, forms = true } = {}) {
  const base = page.getViewport({ scale: 1 });
  let s = (scale || (width / base.width)) * dpr;
  s *= canvasScaleCap(base.width * s, base.height * s);
  const vp = page.getViewport({ scale: s });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  const g = canvas.getContext('2d', { alpha: false });
  g.fillStyle = 'white';
  g.fillRect(0, 0, canvas.width, canvas.height);
  const task = page.render({ canvasContext: g, canvas, viewport: vp, background: 'white', annotationMode: forms ? 1 : 0 });
  const abort = () => task.cancel();
  signal?.addEventListener('abort', abort);
  try { await task.promise; } finally { signal?.removeEventListener('abort', abort); }
  return canvas;
}

/**
 * Render a pdf.js page into a canvas for a given CSS width (device-pixel sharp, capped).
 * Returns {canvas, vp (scale 1 viewport), scale (css px per pt)}.
 */
export async function previewPage(pdf, pageNo, cssWidth, { signal = null, maxDpr = 2 } = {}) {
  const page = await pdf.getPage(pageNo);
  const vp = page.getViewport({ scale: 1 });
  const dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
  const canvas = await renderPage(page, { width: cssWidth, dpr, signal });
  canvas.classList.add('sec-page-canvas');
  canvas.style.width = cssWidth + 'px';
  canvas.style.height = Math.round(cssWidth * vp.height / vp.width) + 'px';
  page.cleanup();
  return { canvas, vp, scale: cssWidth / vp.width, page };
}

/** Free a canvas' pixel memory (sensitive content). */
export function wipeCanvas(c) {
  if (!c) return;
  try { c.getContext('2d')?.clearRect(0, 0, c.width, c.height); } catch { /* ignore */ }
  c.width = c.height = 0;
}

/** Page navigation row: ‹ Seite 2 von 5 › */
export function pageNav(lang, onGo) {
  let n = 1, count = 1;
  const label = el('span', { class: 'sec-nav-label', aria: { live: 'polite' } });
  const prev = btn('prev', '', () => go(n - 1), { cls: 'wt-icon-btn sec-nav-btn', label: tr(lang, 'Vorherige Seite', 'Previous page') });
  const next = btn('next', '', () => go(n + 1), { cls: 'wt-icon-btn sec-nav-btn', label: tr(lang, 'Nächste Seite', 'Next page') });
  const node = el('div', { class: 'sec-nav' }, prev, label, next);
  function render() {
    label.textContent = tr(lang, `Seite ${n} von ${count}`, `Page ${n} of ${count}`);
    prev.disabled = n <= 1; next.disabled = n >= count;
    node.hidden = count < 1;
  }
  function go(k) { if (k < 1 || k > count || k === n) return; n = k; render(); onGo(n); }
  render();
  return { node, get page() { return n; }, set(k, c = count) { count = c; n = Math.max(1, Math.min(c, k)); render(); }, go };
}

/** Width available for a page preview inside a stage. */
export function stageWidth(node, max = 760) {
  const w = node.getBoundingClientRect().width || node.parentElement?.getBoundingClientRect().width || 360;
  return Math.max(200, Math.min(max, Math.floor(w)));
}

// ---------------------------------------------------------------- geometry: viewport (scale 1) → PDF
/**
 * Affine matrix [a b c d e f] that maps an item's local space (origin bottom-left, x right, y up,
 * units pt, size w × h, rotated by rot° clockwise as seen on screen, centred at (cx, cy) in viewport
 * points) into PDF user space of a page shown with the pdf.js viewport `vp` (scale 1, page rotation).
 */
export function itemMatrix(vp, { cx, cy, w, h, rot = 0 }) {
  const r = rot * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
  const toVp = (u, v) => {
    const dx = u - w / 2, dy = h / 2 - v; // local (y up) → viewport offsets (y down)
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  };
  const P = (u, v) => vp.convertToPdfPoint(...toVp(u, v));
  const o = P(0, 0), ux = P(1, 0), uy = P(0, 1);
  return [ux[0] - o[0], ux[1] - o[1], uy[0] - o[0], uy[1] - o[1], o[0], o[1]];
}

export const num = n => String(+(+n).toFixed(4));

/** Push raw operators wrapped in q/Q with a cm matrix onto a pdf-lib page. */
export function pushWithMatrix(PDFLib, page, m, ops) {
  const { pushGraphicsState, popGraphicsState, concatTransformationMatrix } = PDFLib;
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...m), ...ops, popGraphicsState());
}

/** Characters pdf-lib's standard Helvetica (WinAnsi) can encode. */
export function winAnsiSafe(font, text) {
  const out = [];
  let lost = 0;
  for (const ch of String(text)) {
    if (ch === '\n' || ch === '\r' || ch === '\t') { out.push(ch); continue; }
    try { font.encodeText(ch); out.push(ch); } catch { out.push('?'); lost++; }
  }
  return { text: out.join(''), lost };
}

// ---------------------------------------------------------------- saving
/**
 * Save a document modified by a tool. If the source was protected with an open password, the result is
 * protected again with the same password (AES-256). Returns {bytes, protectedAgain}.
 */
export async function saveLikeSource(doc, input, { title = null } = {}) {
  const pw = doc.wtPassword || input.password || '';
  if (doc.wtEncrypted && pw) return { bytes: await saveEncrypted(doc, pw, { title }), protectedAgain: true };
  return { bytes: await saveDoc(doc, { title }), protectedAgain: false };
}

export const pdfBlob = bytes => new Blob([bytes], { type: 'application/pdf' });

export { loadPdfLib };
