// Shared helpers of the image tools (compress, resize, convert, EXIF, scan, passport photo, QR, letter):
// loading photos onto a canvas within the memory limits, high-quality multi-step downscaling, encoding
// (incl. "to a target size"), encoder support detection, the tools' stylesheet, a before/after
// comparison view and a few small UI helpers. Everything stays in the browser.
import { el, icon, clear } from './dom.js';
import { pick } from './strings.js';
import { formatSize } from './format.js';
import { canvasScaleCap, LIMITS } from './shared/limits.js';

export const FORMATS = {
  jpg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPG', lossy: true, alpha: false },
  png: { mime: 'image/png', ext: 'png', label: 'PNG', lossy: false, alpha: true },
  webp: { mime: 'image/webp', ext: 'webp', label: 'WebP', lossy: true, alpha: true },
  avif: { mime: 'image/avif', ext: 'avif', label: 'AVIF', lossy: true, alpha: true },
};
// input.format (lib/files.js) → output format used for "keep the format"
const KEEP = { jpeg: 'jpg', png: 'png', webp: 'webp', avif: 'avif', gif: 'png', bmp: 'png', heic: 'jpg' };
export const keepFormat = input => KEEP[input.format] || 'jpg';

/** Error with a user-facing message for the shell. */
export const userError = (de, en) => Object.assign(new Error(en), { userMessage: { de, en } });

// ---------------------------------------------------------------- stylesheet (CSP: style-src 'self')
let cssReady = null;
export function ensureCss() {
  if (!cssReady) {
    cssReady = new Promise(resolve => {
      const href = new URL('./img-tools.css', import.meta.url).href;
      if (document.querySelector(`link[href="${href}"]`)) { resolve(); return; }
      const link = el('link', { rel: 'stylesheet', href });
      link.addEventListener('load', () => resolve());
      link.addEventListener('error', () => resolve());
      document.head.append(link);
    });
  }
  return cssReady;
}

// ---------------------------------------------------------------- canvases
export function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
/** Free the pixel memory of canvases right away (important on phones with many photos). */
export function release(...cs) { for (const c of cs) if (c && c.width) { c.width = 0; c.height = 0; } }
export const ctx2d = (c, read = false) => c.getContext('2d', read ? { willReadFrequently: true } : undefined);
const sizeOf = s => [s.width || s.videoWidth || s.naturalWidth, s.height || s.videoHeight || s.naturalHeight];

/**
 * High-quality downscale of any drawable (canvas, ImageBitmap, img) to w × h: halves step by step
 * (like a mip chain) so fine detail is averaged instead of aliased, then draws the final size.
 * Intermediate canvases are released immediately. Upscaling is a single smooth draw.
 */
export function scaleTo(src, w, h, { crop = null } = {}) {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  let [sw, sh] = sizeOf(src);
  let sx = 0, sy = 0;
  if (crop) { sx = crop.x; sy = crop.y; sw = crop.w; sh = crop.h; }
  let cur = src, cx = sx, cy = sy, cw = sw, ch = sh, tmp = null;
  while (cw / 2 >= w && ch / 2 >= h && cw > 2 && ch > 2) {
    const t = newCanvas(cw / 2, ch / 2);
    const g = ctx2d(t);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(cur, cx, cy, cw, ch, 0, 0, t.width, t.height);
    if (tmp) release(tmp);
    tmp = cur = t; cx = 0; cy = 0; cw = t.width; ch = t.height;
  }
  const out = newCanvas(w, h);
  const g = ctx2d(out);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(cur, cx, cy, cw, ch, 0, 0, w, h);
  if (tmp) release(tmp);
  return out;
}

/**
 * Decode an InputFile (EXIF orientation applied) onto a canvas, limited to maxSide (long edge) and the
 * canvas pixel limit. Returns { canvas, width, height } with the original (oriented) size.
 */
export async function loadCanvas(input, { maxSide = 0, maxPixels = LIMITS.canvasPixels } = {}) {
  let bmp;
  try { bmp = await input.bitmap(); } catch (err) {
    if (err?.wtKey) throw err;
    throw input.format === 'heic'
      ? userError('HEIC-Fotos kann dieser Browser nicht öffnen. In Safari (iPhone, iPad, Mac) klappt es – oder teile das Foto aus der Fotos-App als JPG.',
        'This browser can’t open HEIC photos. It works in Safari (iPhone, iPad, Mac) – or share the photo from the Photos app as a JPG.')
      : userError(`„${input.name}“ kann dein Browser nicht als Bild öffnen.`, `Your browser can’t open “${input.name}” as an image.`);
  }
  const width = bmp.width, height = bmp.height;
  try {
    let f = canvasScaleCap(width, height, maxPixels);
    if (maxSide) f = Math.min(f, maxSide / Math.max(width, height));
    if (f < 1) return { canvas: scaleTo(bmp, width * f, height * f), width, height };
    const c = newCanvas(width, height);
    ctx2d(c).drawImage(bmp, 0, 0);
    return { canvas: c, width, height };
  } finally { bmp.close?.(); }
}

/** Does the canvas have any (partly) transparent pixel? Sampled on a small copy. */
export function hasAlpha(canvas) {
  const s = Math.min(1, 256 / Math.max(canvas.width, canvas.height));
  const t = newCanvas(canvas.width * s, canvas.height * s);
  const g = ctx2d(t, true);
  g.drawImage(canvas, 0, 0, t.width, t.height);
  const d = g.getImageData(0, 0, t.width, t.height).data;
  release(t);
  for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  return false;
}

/** Paint a background colour behind transparent pixels (in place). */
export function flatten(canvas, color = '#ffffff') {
  const g = ctx2d(canvas);
  g.save();
  g.globalCompositeOperation = 'destination-over';
  g.fillStyle = color;
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.restore();
  return canvas;
}

// ---------------------------------------------------------------- encoding
const toBlob = (c, type, q) => new Promise(res => c.toBlob(b => res(b), type, q));

let support = null;
/** Which output formats this browser can encode: { jpg, png, webp, avif } (true/false). */
export function encodeSupport() {
  if (!support) {
    support = (async () => {
      const res = { jpg: true, png: true, webp: false, avif: false };
      try {
        const c = newCanvas(2, 2);
        ctx2d(c).fillRect(0, 0, 1, 1);
        for (const k of ['webp', 'avif']) {
          const b = await toBlob(c, FORMATS[k].mime, 0.8);
          res[k] = !!b && b.type === FORMATS[k].mime;
        }
        release(c);
      } catch { /* keep defaults */ }
      return res;
    })();
  }
  return support;
}

/** Encode a canvas. Formats without alpha are flattened onto `background` first (the canvas is changed). */
export async function encode(canvas, { format = 'jpg', quality = 0.85, background = '#ffffff' } = {}) {
  const F = FORMATS[format] || FORMATS.jpg;
  if (!F.alpha) flatten(canvas, background);
  const blob = await toBlob(canvas, F.mime, F.lossy ? quality : undefined);
  if (!blob) throw userError('Das Bild konnte nicht gespeichert werden (zu wenig Speicher?).', 'The image could not be saved (out of memory?).');
  if (blob.type !== F.mime) throw userError(`Dein Browser kann kein ${F.label} speichern. Wähle ein anderes Format.`, `Your browser can’t save ${F.label}. Choose another format.`);
  return blob;
}

/**
 * Encode as large as possible but ≤ targetBytes: binary search on the quality (lossy formats), then
 * shrink the pixel size when even a low quality is too big (PNG: shrink only).
 * Returns { blob, quality, canvas, scaled, reached }. The returned canvas may be a new, smaller one.
 */
export async function encodeToTarget(canvas, { format = 'jpg', targetBytes, background = '#ffffff', minQuality = 0.3, tick = async () => {}, onStep = null } = {}) {
  const F = FORMATS[format] || FORMATS.jpg;
  if (!F.alpha) flatten(canvas, background);
  let c = canvas, scaled = false, last = null;
  for (let round = 0; round < 10; round++) {
    if (!F.lossy) {
      const b = await encode(c, { format });
      last = { blob: b, quality: 1 };
      if (b.size <= targetBytes || c.width < 48 || c.height < 48) break;
      const f = Math.max(0.5, Math.min(0.95, Math.sqrt(targetBytes / b.size) * 0.97));
      const n = scaleTo(c, c.width * f, c.height * f);
      if (c !== canvas) release(c);
      c = n; scaled = true;
      onStep?.({ width: c.width, height: c.height });
      await tick();
      continue;
    }
    let lo = minQuality, hi = 0.95, best = null, atLo = null;
    const top = await encode(c, { format, quality: hi });
    if (top.size <= targetBytes) best = { blob: top, quality: hi };
    else {
      for (let i = 0; i < 7; i++) {
        const q = (lo + hi) / 2;
        const b = await encode(c, { format, quality: q });
        onStep?.({ quality: q });
        if (b.size <= targetBytes) { best = { blob: b, quality: q }; lo = q; } else hi = q;
        await tick();
      }
      if (!best) atLo = await encode(c, { format, quality: minQuality });
      if (!best && atLo.size <= targetBytes) best = { blob: atLo, quality: minQuality };
    }
    if (best) { last = best; break; }
    last = { blob: atLo, quality: minQuality };
    if (c.width < 48 || c.height < 48) break;
    // shrink so that the low-quality size would roughly fit, then search the quality again
    const f = Math.max(0.5, Math.min(0.92, Math.sqrt(targetBytes / atLo.size) * 1.05));
    const n = scaleTo(c, c.width * f, c.height * f);
    if (c !== canvas) release(c);
    c = n; scaled = true;
    onStep?.({ width: c.width, height: c.height });
    await tick();
  }
  return { ...last, canvas: c, scaled, reached: last.blob.size <= targetBytes };
}

// ---------------------------------------------------------------- UI helpers
export const T = (lang, v) => pick(lang, v);

/** Small segmented control (radio group) – returns { root, set(value) }. */
export function segmented({ name, label, choices, value, lang, onChange }) {
  const inputs = [];
  const root = el('fieldset', { class: 'img-seg' }, el('legend', { class: 'img-seg-legend' }, T(lang, label)),
    el('div', { class: 'img-seg-row' }, choices.map(c => {
      const input = el('input', { type: 'radio', name, value: String(c.value), checked: String(c.value) === String(value), onchange: () => onChange(c.value) });
      inputs.push(input);
      return el('label', { class: 'img-seg-opt' }, input, el('span', {}, T(lang, c.label)));
    })));
  return { root, set: v => inputs.forEach(i => { i.checked = i.value === String(v); }) };
}

/** Labelled text/number/date input bound to obj[key]. */
export function field({ id, label, value = '', type = 'text', lang, onInput, placeholder = '', autocomplete = 'off', inputmode = null, hint = null, wide = true, maxLength = 200 }) {
  const input = el('input', { id, class: 'wt-input', type, value: value ?? '', placeholder: T(lang, placeholder) || null, autocomplete, inputmode, maxlength: type === 'date' ? null : String(maxLength),
    aria: { describedby: hint ? id + '-hint' : null }, oninput: e => onInput(e.target.value) });
  return el('div', { class: 'img-field' + (wide ? '' : ' img-field-half') }, el('label', { for: id }, T(lang, label)), input,
    hint ? el('p', { class: 'wt-opt-hint', id: id + '-hint' }, T(lang, hint)) : null);
}

/** Checkbox row bound to a value. */
export function check({ id, label, checked, lang, onChange, hint = null }) {
  const input = el('input', { id, type: 'checkbox', checked: !!checked, aria: { describedby: hint ? id + '-hint' : null }, onchange: e => onChange(e.target.checked) });
  return el('div', { class: 'img-check' }, el('label', { for: id }, input, el('span', {}, T(lang, label))),
    hint ? el('p', { class: 'wt-opt-hint', id: id + '-hint' }, T(lang, hint)) : null);
}

// ---------------------------------------------------------------- before / after comparison
const CMP = {
  before: { de: 'Vorher', en: 'Before' }, after: { de: 'Nachher', en: 'After' },
  slider: { de: 'Vergleich: Vorher links, nachher rechts', en: 'Comparison: before on the left, after on the right' },
  zoom: { de: 'Ausschnitt vergrößern', en: 'Zoom in' }, zoomOut: { de: 'Ganzes Bild', en: 'Whole image' },
  hint: { de: 'Schieb den Regler, um Vorher und Nachher zu vergleichen. Zum Prüfen von Details tippe auf eine Stelle und dann auf „Ausschnitt vergrößern“.', en: 'Drag the slider to compare before and after. To check details, tap a spot and then “Zoom in”.' },
};
let cmpUrls = [];
/** Revoke the object URLs of the previous comparison (called before a new one is built). */
export function releaseCompare() { cmpUrls.forEach(u => URL.revokeObjectURL(u)); cmpUrls = []; }

/**
 * Before/after slider over two images. `before`/`after` are Blobs/Files (displayable by the browser).
 * Keyboard and screen readers use the range input; touch drags the handle; vertical swipes still scroll.
 */
export function compareView({ before, after, lang, width, height, caption = '' }) {
  const ub = URL.createObjectURL(before), ua = URL.createObjectURL(after);
  cmpUrls.push(ub, ua);
  const imgA = el('img', { src: ua, alt: '', class: 'img-cmp-img', decoding: 'async', draggable: false });
  const imgB = el('img', { src: ub, alt: '', class: 'img-cmp-img', decoding: 'async', draggable: false });
  const beforeBox = el('div', { class: 'img-cmp-before', 'aria-hidden': 'true' }, imgB);
  const handle = el('div', { class: 'img-cmp-handle', 'aria-hidden': 'true' }, el('span', {}));
  const range = el('input', { type: 'range', class: 'img-cmp-range', min: '0', max: '100', step: '1', value: '50', aria: { label: T(lang, CMP.slider) } });
  const inner = el('div', { class: 'img-cmp-inner' }, imgA, beforeBox);
  const view = el('div', { class: 'img-cmp-view' }, inner, handle,
    el('span', { class: 'img-cmp-tag img-cmp-tag-l', 'aria-hidden': 'true' }, T(lang, CMP.before)),
    el('span', { class: 'img-cmp-tag img-cmp-tag-r', 'aria-hidden': 'true' }, T(lang, CMP.after)), range);
  if (width && height) view.style.aspectRatio = `${width} / ${height}`;
  const set = p => {
    p = Math.max(0, Math.min(100, p));
    beforeBox.style.clipPath = `inset(0 ${100 - p}% 0 0)`;
    handle.style.left = p + '%';
    range.value = String(Math.round(p));
    range.setAttribute('aria-valuetext', `${Math.round(p)} %`);
  };
  set(50);
  range.addEventListener('input', () => set(+range.value));
  // direct drag anywhere on the picture (pointer events; horizontal moves only, so vertical swipes scroll)
  let drag = null;
  view.addEventListener('pointerdown', ev => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, active: ev.pointerType === 'mouse' };
    focus = pointToFocus(ev);
    if (drag.active) { view.setPointerCapture?.(ev.pointerId); move(ev); }
  });
  view.addEventListener('pointermove', ev => {
    if (!drag || ev.pointerId !== drag.id) return;
    if (!drag.active) {
      const dx = Math.abs(ev.clientX - drag.x), dy = Math.abs(ev.clientY - drag.y);
      if (dy > 10 && dy > dx) { drag = null; return; }
      if (dx > 6) { drag.active = true; try { view.setPointerCapture(ev.pointerId); } catch { /* optional */ } }
    }
    if (drag.active) move(ev);
  });
  const end = ev => { if (drag && ev.pointerId === drag.id) { if (!drag.active && ev.type === 'pointerup') move(ev); drag = null; } };
  view.addEventListener('pointerup', end);
  view.addEventListener('pointercancel', () => { drag = null; });
  function move(ev) { const r = view.getBoundingClientRect(); if (r.width) set(((ev.clientX - r.left) / r.width) * 100); }
  // zoom: 3× around the last tapped spot (compression artefacts are only visible up close)
  let focus = [50, 50], zoomed = false;
  function pointToFocus(ev) { const r = inner.getBoundingClientRect(); return r.width ? [((ev.clientX - r.left) / r.width) * 100, ((ev.clientY - r.top) / r.height) * 100] : focus; }
  const zoomBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm', aria: { pressed: 'false' }, onclick: () => {
    zoomed = !zoomed;
    inner.style.transformOrigin = `${focus[0].toFixed(1)}% ${focus[1].toFixed(1)}%`;
    view.classList.toggle('is-zoomed', zoomed);
    zoomBtn.setAttribute('aria-pressed', String(zoomed));
    zoomBtn.lastChild.textContent = T(lang, zoomed ? CMP.zoomOut : CMP.zoom);
  } }, icon('plus'), el('span', {}, T(lang, CMP.zoom)));
  return el('figure', { class: 'img-cmp' }, view,
    el('figcaption', { class: 'img-cmp-cap' }, el('span', {}, caption), zoomBtn),
    el('p', { class: 'wt-opt-hint' }, T(lang, CMP.hint)));
}

/**
 * Result preview for image tools (shell hook onResult): comparison of the chosen output with its input.
 * outputs carry meta: { input (InputFile), width, height }.
 */
export function resultCompare(resultEl, res, ctx, { title } = {}) {
  releaseCompare();
  const items = res.outputs.filter(o => o.meta?.input && o.blob.type.startsWith('image/') && !o.meta.noCompare);
  if (!items.length) return;
  const lang = ctx.lang;
  const box = el('div', { class: 'img-result-cmp' });
  const head = el('div', { class: 'img-cmp-head' }, el('p', { class: 'wt-live-title' }, T(lang, title || { de: 'Vorher / nachher', en: 'Before / after' })));
  let sel = null;
  if (items.length > 1) {
    sel = el('select', { class: 'wt-input img-cmp-pick', aria: { label: T(lang, { de: 'Bild für den Vergleich', en: 'Image to compare' }) }, onchange: () => show(+sel.value) },
      items.map((o, i) => el('option', { value: String(i) }, `${i + 1}. ${o.name}`)));
    head.append(sel);
  }
  const slot = el('div', {});
  box.append(head, slot);
  function show(i) {
    releaseCompare();
    const o = items[i];
    const inp = o.meta.input;
    const cap = `${formatSize(inp.size, lang)} → ${formatSize(o.blob.size, lang)}${o.meta.width ? ` · ${o.meta.width} × ${o.meta.height} px` : ''}`;
    clear(slot).append(compareView({ before: inp.file, after: o.blob, lang, width: o.meta.width, height: o.meta.height, caption: cap }));
  }
  show(0);
  const list = resultEl.querySelector('.wt-outputs');
  (list || resultEl.lastChild)?.before(box);
}

/** Per-image progress text. */
export const imgProgress = (i, n, name) => ({ de: `Bild ${i + 1} von ${n} · ${name}`, en: `Image ${i + 1} of ${n} · ${name}` });

/** Make output names unique within one result ("Foto.jpg", "Foto (2).jpg"). */
export function uniqueNames(outputs) {
  const seen = new Map();
  for (const o of outputs) {
    const key = o.name.toLowerCase();
    const n = seen.get(key) || 0;
    seen.set(key, n + 1);
    if (n) o.name = o.name.replace(/(\.[^.]+)?$/, m => ` (${n + 1})${m}`);
  }
  return outputs;
}

/** Wait for an <img>-displayable blob's natural size. */
export async function blobSize(blob) {
  const bmp = await createImageBitmap(blob);
  const r = { width: bmp.width, height: bmp.height };
  bmp.close?.();
  return r;
}
