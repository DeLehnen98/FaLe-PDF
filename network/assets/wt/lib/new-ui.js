// Small UI helpers for the tools ocr-pdf, image-to-text, pdf-viewer, invoice-generator, signature-maker,
// crop-image and rotate-image (stylesheet lib/new.css; CSP style-src 'self' → loaded as a file).
import { el, icon } from './dom.js';
import { pick } from './strings.js';

let cssReady = null;
export function ensureCss() {
  if (!cssReady) {
    cssReady = new Promise(resolve => {
      const href = new URL('./new.css', import.meta.url).href;
      if (document.querySelector(`link[href="${href}"]`)) { resolve(); return; }
      const link = el('link', { rel: 'stylesheet', href });
      link.addEventListener('load', () => resolve());
      link.addEventListener('error', () => resolve());
      document.head.append(link);
    });
  }
  return cssReady;
}

export const T = (lang, v) => pick(lang, v);
export const userError = (de, en) => Object.assign(new Error(en), { userMessage: { de, en } });

/** Copy text to the clipboard; falls back to selecting `selectNode`. Returns true when copied. */
export async function copyText(text, selectNode = null) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fallback below */ }
  if (selectNode) {
    const range = document.createRange();
    range.selectNodeContents(selectNode);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  return false;
}

const countWords = s => (s.match(/[\p{L}\p{N}]+(?:[-'’.][\p{L}\p{N}]+)*/gu) || []).length;

/** Result card: text of the outputs with meta.text (editable) + copy + "save as TXT" + counts. */
export function textPanel(result, res, ctx, { title = { de: 'Erkannter Text', en: 'Recognised text' } } = {}) {
  ensureCss();
  const parts = res.outputs.filter(x => x.meta && typeof x.meta.text === 'string');
  if (!parts.length) return;
  const lang = ctx.lang;
  const text = parts.length === 1 ? parts[0].meta.text : parts.map(o => `=== ${o.meta.source || o.name} ===\n\n${o.meta.text.trim()}\n`).join('\n');
  const txtName = parts.length === 1 ? (parts[0].meta.txtName || 'Text.txt') : T(lang, { de: 'Erkannter Text.txt', en: 'Recognised text.txt' });
  const area = el('textarea', { class: 'new-text', id: 'new-text-out', rows: '10', spellcheck: 'false' });
  area.value = text;
  const status = el('span', { class: 'new-muted', aria: { live: 'polite' } });
  const stats = el('p', { class: 'new-muted' });
  const count = () => {
    const t = area.value;
    stats.textContent = T(lang, { de: `${t.length.toLocaleString('de-DE')} Zeichen · ${countWords(t).toLocaleString('de-DE')} Wörter`, en: `${t.length.toLocaleString('en-GB')} characters · ${countWords(t).toLocaleString('en-GB')} words` });
  };
  area.addEventListener('input', count);
  count();
  const copy = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm new-copy' }, icon('check'), T(lang, { de: 'Text kopieren', en: 'Copy text' }));
  copy.addEventListener('click', async () => {
    const ok = await copyText(area.value);
    if (!ok) { area.focus(); area.select(); }
    status.textContent = T(lang, ok ? { de: 'Kopiert ✓', en: 'Copied ✓' } : { de: 'Text markiert – jetzt kopieren', en: 'Text selected – copy it now' });
  });
  const save = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm new-txt' }, icon('download'), T(lang, { de: 'Als TXT speichern', en: 'Save as TXT' }));
  save.addEventListener('click', async () => {
    const { download } = await import('./download.js');
    download(new Blob([area.value.replace(/\r?\n/g, '\r\n')], { type: 'text/plain;charset=utf-8' }), txtName);
  });
  const sec = el('section', { class: 'new-textpanel', aria: { labelledby: 'new-text-h' } },
    el('h3', { id: 'new-text-h' }, el('label', { for: 'new-text-out' }, T(lang, title))),
    el('div', { class: 'new-row' }, copy, save, status), area, stats,
    el('p', { class: 'new-muted' }, T(lang, { de: 'Du kannst den Text hier korrigieren, bevor du ihn kopierst oder speicherst.', en: 'You can correct the text here before copying or saving it.' })));
  const outs = result.querySelector('.wt-outputs, .wt-output');
  if (outs) outs.parentNode.insertBefore(sec, outs.nextSibling); else result.append(sec);
}

/** Labelled range slider: returns { root, input, set(v) }. */
export function slider({ id, label, min, max, step = 1, value, lang, format = v => String(v), onInput }) {
  const out = el('output', { for: id, class: 'new-range-val' }, format(value));
  const input = el('input', { id, type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
  input.addEventListener('input', () => { out.textContent = format(+input.value); onInput(+input.value); });
  return {
    root: el('div', { class: 'new-range' }, el('div', { class: 'new-range-head' }, el('label', { for: id }, T(lang, label)), out), input),
    input,
    set(v) { input.value = String(v); out.textContent = format(v); },
  };
}

/** Icon button with accessible name (text optional). */
export function iconBtn(svgPaths, label, onclick, { cls = 'wt-btn wt-btn-quiet wt-btn-sm', text = null, pressed = null, id = null } = {}) {
  const b = el('button', { type: 'button', class: cls, id, aria: { label: text ? null : label, pressed: pressed == null ? null : String(pressed) }, title: label, onclick }, svg(svgPaths), text);
  return b;
}

const NS = 'http://www.w3.org/2000/svg';
/** Stroke icon from path data strings. */
export function svg(paths, cls = 'wt-i') {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', cls);
  for (const d of [].concat(paths)) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.append(p); }
  return s;
}
export const ICON = {
  rotL: ['M3 12a9 9 0 1 0 3-6.7', 'M3 4v5h5'],
  rotR: ['M21 12a9 9 0 1 1-3-6.7', 'M21 4v5h-5'],
  flipH: ['M12 3v18', 'M8 7l-5 5 5 5V7z', 'M16 7l5 5-5 5V7z'],
  flipV: ['M3 12h18', 'M7 8l5-5 5 5H7z', 'M7 16l5 5 5-5H7z'],
  search: ['M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14z', 'M20 20l-4-4'],
  list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
  grid: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
  moon: ['M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z'],
  print: ['M6 9V3h12v6', 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2', 'M6 14h12v7H6z'],
  zoomIn: ['M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14z', 'M20 20l-4-4', 'M8 11h6', 'M11 8v6'],
  zoomOut: ['M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14z', 'M20 20l-4-4', 'M8 11h6'],
  fit: ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'],
  up: ['M6 15l6-6 6 6'],
  down: ['M6 9l6 6 6-6'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  more: ['M12 5h.01', 'M12 12h.01', 'M12 19h.01'],
  crop: ['M6 2v14a2 2 0 0 0 2 2h14', 'M18 22V8a2 2 0 0 0-2-2H2'],
  reset: ['M4 12a8 8 0 1 0 2.3-5.7', 'M4 4v5h5'],
  pen: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'],
  trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
  plus: ['M12 5v14', 'M5 12h14'],
  book: ['M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2z', 'M4 19V5'],
  download: ['M12 4v12', 'M7 11l5 5 5-5', 'M4 20h16'],
  file: ['M6 3h8l4 4v14H6z', 'M14 3v4h4'],
  expand: ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'],
};
