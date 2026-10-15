// DOM helpers. The UI is built with createElement only – no HTML strings, no HTML parsing – so user data
// (decrypted names, EXIF, album titles) can never become markup. Trusted Types (CSP) is the safety net.
import { t } from './i18n.js';

const SVG = 'http://www.w3.org/2000/svg';
/**
 * el('button.btn.primary', { onclick, title, aria: { label }, data: { id } }, 'Text', child, …)
 * Attributes: class/className, text, html is NOT supported on purpose; on<event> handlers; aria/data objects;
 * hidden/disabled/checked booleans; everything else via setAttribute.
 */
export function el(spec, attrs, ...kids) {
  const tag = /^[a-z0-9-]*/i.exec(spec)[0] || 'div';
  const node = document.createElement(tag);
  const cls = [];
  for (const m of spec.slice(tag.length).matchAll(/([.#])([\w-]+)/g)) { if (m[1] === '#') node.id = m[2]; else cls.push(m[2]); }
  if (cls.length) node.className = cls.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class' || k === 'className') node.className = [node.className, v].filter(Boolean).join(' ');
      else if (k === 'text') node.textContent = v;
      else if (k === 'aria') for (const [a, b] of Object.entries(v)) { if (b !== undefined && b !== null) node.setAttribute('aria-' + a, String(b)); }
      else if (k === 'data') for (const [a, b] of Object.entries(v)) { if (b !== undefined && b !== null) node.dataset[a] = String(b); }
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'hidden' || k === 'disabled' || k === 'checked' || k === 'multiple' || k === 'required' || k === 'autofocus' || k === 'readOnly' || k === 'selected') node[k] = !!v;
      else if (k === 'value') node.value = v;
      else node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(node, kids);
  return node;
}
export function append(node, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    node.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return node;
}
// Element.append(null) would insert the text "null": conditional children (cond ? node : null) are skipped.
const nativeAppend = Element.prototype.append;
if (!nativeAppend.faleSafe) {
  Element.prototype.append = function (...kids) { return nativeAppend.apply(this, kids.filter(k => k !== null && k !== undefined && k !== false)); };
  Element.prototype.append.faleSafe = true;
}
export function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; }
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ---------------------------------------------------------------- icons (24 × 24, stroke)
const P = {
  photos: ['M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z', 'm4.5 16 4.2-4.2a1.5 1.5 0 0 1 2.1 0L16 17', 'm14 15 1.7-1.7a1.5 1.5 0 0 1 2.1 0l2 2', 'M15.5 9.5h.01'],
  drive: ['M3.5 7.5A2.5 2.5 0 0 1 6 5h3.3a2 2 0 0 1 1.5.7L12 7h6a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5z'],
  folder: ['M3.5 7.5A2.5 2.5 0 0 1 6 5h3.3a2 2 0 0 1 1.5.7L12 7h6a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5z'],
  folderPlus: ['M3.5 7.5A2.5 2.5 0 0 1 6 5h3.3a2 2 0 0 1 1.5.7L12 7h6a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5z', 'M12 10v6', 'M9 13h6'],
  file: ['M14 3.5H7.5A2 2 0 0 0 5.5 5.5v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z', 'M14 3.5V8h4.5'],
  fileText: ['M14 3.5H7.5A2 2 0 0 0 5.5 5.5v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z', 'M14 3.5V8h4.5', 'M8.5 12.5h7', 'M8.5 16h5'],
  image: ['M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z', 'm4.5 16 4.2-4.2a1.5 1.5 0 0 1 2.1 0L16 17', 'M15.5 9.5h.01'],
  video: ['M3.5 7.5A2.5 2.5 0 0 1 6 5h7a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 13 19H6a2.5 2.5 0 0 1-2.5-2.5z', 'm15.5 10.5 5-3v9l-5-3'],
  audio: ['M9 18V6l11-2v12', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M17 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  pdf: ['M14 3.5H7.5A2 2 0 0 0 5.5 5.5v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z', 'M14 3.5V8h4.5', 'M8.5 16.5v-4h1.3a1.3 1.3 0 0 1 0 2.6H8.5', 'M12.5 16.5v-4h.8a2 2 0 0 1 0 4z'],
  zip: ['M14 3.5H7.5A2 2 0 0 0 5.5 5.5v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z', 'M11 4v2', 'M11 8v2', 'M11 12v2', 'M10 16h2v2.5h-2z'],
  upload: ['M12 15V4', 'm7.5 8.5 4.5-4.5 4.5 4.5', 'M5 15v2.5A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5V15'],
  download: ['M12 4v11', 'm7.5 10.5 4.5 4.5 4.5-4.5', 'M5 15v2.5A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5V15'],
  cloudUp: ['M7 18.5a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9a4 4 0 0 1 .5 7.97', 'M12 20v-7', 'm9 15.5 3-3 3 3'],
  camera: ['M4 8.5A2.5 2.5 0 0 1 6.5 6h1.7l1.3-2h5l1.3 2h1.7A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z', 'M12 16a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6z'],
  plus: ['M12 5v14', 'M5 12h14'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'm20 20-3.5-3.5'],
  more: ['M12 6.5h.01', 'M12 12h.01', 'M12 17.5h.01'],
  moreH: ['M6.5 12h.01', 'M12 12h.01', 'M17.5 12h.01'],
  back: ['M19 12H5', 'm11 18-6-6 6-6'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  chevronRight: ['m9.5 6 6 6-6 6'],
  chevronLeft: ['m14.5 6-6 6 6 6'],
  chevronDown: ['m6 9.5 6 6 6-6'],
  trash: ['M4.5 7h15', 'M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2', 'M6.5 7l.9 12a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12', 'M10.2 11v5.5', 'M13.8 11v5.5'],
  restore: ['M4 12a8 8 0 1 0 2.4-5.7L4 8.5', 'M4 4v4.5h4.5', 'M12 8v4l2.5 2'],
  share: ['M8.7 13.4l6.6 3.8', 'M15.3 6.8 8.7 10.6', 'M18 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', 'M6 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z', 'M18 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
  link: ['M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1', 'M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1'],
  star: ['m12 3.8 2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z'],
  album: ['M6 4.5h12A1.5 1.5 0 0 1 19.5 6v13.5L15 17l-3 2.5L9 17l-4.5 2.5V6A1.5 1.5 0 0 1 6 4.5z', 'M9 9.5h6'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5.5', 'M12 7.5h.01'],
  edit: ['M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z', 'm13.5 6.5 4 4'],
  move: ['M3.5 7.5A2.5 2.5 0 0 1 6 5h3.3a2 2 0 0 1 1.5.7L12 7h6a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 18 19H6a2.5 2.5 0 0 1-2.5-2.5z', 'M9 13h6', 'm12.5 10.5 2.5 2.5-2.5 2.5'],
  history: ['M4 12a8 8 0 1 0 2.4-5.7L4 8.5', 'M4 4v4.5h4.5', 'M12 8v4l2.5 2'],
  pin: ['M12 21s-6.5-5.4-6.5-11a6.5 6.5 0 0 1 13 0c0 5.6-6.5 11-6.5 11z', 'M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
  offline: ['M12 4v10', 'm8 10 4 4 4-4', 'M5 19.5h14'],
  check: ['m5 12.5 4.5 4.5L19 7.5'],
  checkCircle: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'm8.5 12.2 2.4 2.4 4.6-4.8'],
  settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
  user: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4.5 20a7.5 7.5 0 0 1 15 0'],
  lock: ['M6.5 10.5h11A1.5 1.5 0 0 1 19 12v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19v-7a1.5 1.5 0 0 1 1.5-1.5z', 'M8 10.5V7.5a4 4 0 0 1 8 0v3'],
  shield: ['M12 3.5 5 6v5.5c0 4.3 3 7.6 7 9 4-1.4 7-4.7 7-9V6z', 'm9 12 2.2 2.2L15.5 10'],
  key: ['M14.5 14a5 5 0 1 0-4.6-3L3.5 17.4V20.5h3.1v-2h2v-2h2l1.4-1.4A5 5 0 0 0 14.5 14z', 'M16 8.5h.01'],
  sort: ['M7 4v16', 'm3.5 16.5 3.5 3.5 3.5-3.5', 'M17 20V4', 'm13.5 7.5 3.5-3.5 3.5 3.5'],
  grid: ['M4.5 4.5h6v6h-6z', 'M13.5 4.5h6v6h-6z', 'M4.5 13.5h6v6h-6z', 'M13.5 13.5h6v6h-6z'],
  list: ['M8.5 6.5h11', 'M8.5 12h11', 'M8.5 17.5h11', 'M4.5 6.5h.01', 'M4.5 12h.01', 'M4.5 17.5h.01'],
  pause: ['M8.5 5.5v13', 'M15.5 5.5v13'],
  play: ['M7.5 5.2v13.6a.8.8 0 0 0 1.2.7l10.6-6.8a.8.8 0 0 0 0-1.4L8.7 4.5a.8.8 0 0 0-1.2.7z'],
  refresh: ['M20 11a8 8 0 0 0-14.3-4.9L4 8', 'M4 3v5h5', 'M4 13a8 8 0 0 0 14.3 4.9L20 16', 'M20 21v-5h-5'],
  warning: ['M10.3 4.3 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z', 'M12 9.5v4.5', 'M12 17.3h.01'],
  devices: ['M3.5 6A1.5 1.5 0 0 1 5 4.5h10A1.5 1.5 0 0 1 16.5 6v7A1.5 1.5 0 0 1 15 14.5H5A1.5 1.5 0 0 1 3.5 13z', 'M2 18h13', 'M18.5 8.5h2a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'm16 17 5-5-5-5', 'M21 12H9'],
  globe: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M3.5 9h17', 'M3.5 15h17', 'M12 3a14 14 0 0 1 0 18', 'M12 3a14 14 0 0 0 0 18'],
  moon: ['M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'],
  copy: ['M9 9.5A1.5 1.5 0 0 1 10.5 8h8A1.5 1.5 0 0 1 20 9.5v9a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 9 18.5z', 'M15.5 8V5.5A1.5 1.5 0 0 0 14 4H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5H9'],
  export: ['M12 14V3.5', 'm8 7.5 4-4 4 4', 'M8.5 10.5h-2A2.5 2.5 0 0 0 4 13v5.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V13a2.5 2.5 0 0 0-2.5-2.5h-2'],
  openExt: ['M14 4h6v6', 'M20 4l-9 9', 'M18 13.5v4A2.5 2.5 0 0 1 15.5 20h-9A2.5 2.5 0 0 1 4 17.5v-9A2.5 2.5 0 0 1 6.5 6h4'],
  zoomIn: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'm20 20-3.5-3.5', 'M11 8v6', 'M8 11h6'],
  zoomOut: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'm20 20-3.5-3.5', 'M8 11h6'],
  cloudCheck: ['M7 18.5a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9a4 4 0 0 1 .5 7.97', 'm9.3 14.6 2 2 3.6-3.8'],
  cloudOff: ['M7 18.5a4.5 4.5 0 0 1-.6-8.96 6 6 0 0 1 1.4-2.6', 'M10.6 5.2A6 6 0 0 1 18 9a4 4 0 0 1 2.2 7.3', 'M3 3l18 18'],
  select: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z'],
  dup: ['M9 9.5A1.5 1.5 0 0 1 10.5 8h8A1.5 1.5 0 0 1 20 9.5v9a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 9 18.5z', 'M15.5 8V5.5A1.5 1.5 0 0 0 14 4H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5H9', 'm12 14 1.8 1.8 3.2-3.3'],
  eye: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  sun: ['M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z', 'M12 2.5v2', 'M12 19.5v2', 'M4.6 4.6l1.4 1.4', 'M18 18l1.4 1.4', 'M2.5 12h2', 'M19.5 12h2', 'M4.6 19.4 6 18', 'M18 6l1.4-1.4'],
};
const FILLED = new Set(['star']);
export function icon(name, { filled = false, cls = '' } = {}) {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  s.setAttribute('class', 'ic' + (cls ? ' ' + cls : '') + (filled && FILLED.has(name) ? ' ic-filled' : ''));
  for (const d of P[name] || P.file) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    s.appendChild(p);
  }
  return s;
}

/** The FaLe One mark (white cloud + teal ribbon on the app's sky-ink gradient), built as SVG nodes. */
export function logo(size = 32) {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('viewBox', '0 0 64 64'); s.setAttribute('width', size); s.setAttribute('height', size);
  s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'logo');
  const defs = document.createElementNS(SVG, 'defs');
  const g = document.createElementNS(SVG, 'linearGradient');
  g.setAttribute('id', 'oneg' + size); g.setAttribute('x1', '0'); g.setAttribute('y1', '0'); g.setAttribute('x2', '0.4'); g.setAttribute('y2', '1');
  for (const [o, c] of [['0', '#2F6BE0'], ['1', '#1A2A86']]) { const st = document.createElementNS(SVG, 'stop'); st.setAttribute('offset', o); st.setAttribute('stop-color', c); g.appendChild(st); }
  defs.appendChild(g); s.appendChild(defs);
  const add = (tag, at) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(at)) n.setAttribute(k, v); s.appendChild(n); return n; };
  add('rect', { x: 0, y: 0, width: 64, height: 64, rx: 14.4, fill: `url(#oneg${size})` });
  add('path', { d: 'M20 44a9 9 0 0 1-1.2-17.9A12.5 12.5 0 0 1 43 24.6 8 8 0 0 1 44.5 44z', fill: '#FFFFFF' });
  add('path', { d: 'M38 14h7v15l-3.5-2.8L38 29z', fill: '#2DD4BF' });
  return s;
}

// ---------------------------------------------------------------- toasts
let toastBox = null;
export function toast(msg, { kind = 'info', action, timeout } = {}) {
  if (!toastBox) { toastBox = el('div.toasts', { role: 'status', aria: { live: 'polite' } }); document.body.appendChild(toastBox); }
  const close = () => { item.classList.add('out'); setTimeout(() => item.remove(), 220); };
  const item = el('div.toast.' + kind, el('span.toast-msg', msg),
    action ? el('button.toast-act', { type: 'button', onclick: () => { close(); action.run(); } }, action.label) : null,
    el('button.toast-x', { type: 'button', aria: { label: t('Schließen') }, onclick: close }, icon('close')));
  toastBox.appendChild(item);
  setTimeout(close, timeout || (action ? 7000 : kind === 'error' ? 6500 : 3800));
  return close;
}
export function errorText(e, fallback) {
  if (!e) return fallback || t('Das hat nicht geklappt. Bitte versuche es erneut.');
  if (e.userMessage) return e.userMessage;
  const map = {
    network: t('Keine Verbindung. Bitte prüfe dein Internet und versuche es erneut.'),
    offline: t('Du bist offline.'),
    quota_exceeded: t('Dein Speicher ist voll. Alles bleibt lesbar – lösche etwas, leere den Papierkorb oder exportiere.'),
    drive_limit: t('Tageslimit erreicht. Es geht morgen weiter.'),
    capacity: t('Der Beta-Speicher ist gerade voll. Bitte versuche es später erneut.'),
    integrity: t('Datei beschädigt – sie wurde nicht vollständig oder unverändert empfangen.'),
    decrypt: t('Datei beschädigt – sie wurde nicht vollständig oder unverändert empfangen.'),
    too_large: t('Die Datei ist zu groß.'),
    not_found: t('Das Element gibt es nicht mehr.'),
    trashed: t('Das Element liegt im Papierkorb.'),
    cycle: t('Ein Ordner kann nicht in sich selbst verschoben werden.'),
    bad_parent: t('Der Zielordner ist nicht verfügbar.'),
    not_available_offline: t('Offline nicht verfügbar. Markiere Dateien als „Offline verfügbar“, um sie ohne Internet zu öffnen.'),
    drive_not_configured: t('FaLe One ist gerade nicht verfügbar.'),
  };
  return map[e.code] || fallback || (e.status >= 500 ? t('Der Dienst ist gerade nicht erreichbar. Bitte versuche es später erneut.') : t('Das hat nicht geklappt. Bitte versuche es erneut.'));
}
export function errorToast(e, fallback) { if (e && e.code === 'aborted') return; toast(errorText(e, fallback), { kind: 'error' }); }

// ---------------------------------------------------------------- dialogs (native <dialog>: focus trap + Esc)
/**
 * openDialog({ title, body: Node|[Node], actions: [{ label, value, kind, default, danger }], sheet, onMount, cls })
 * → Promise<{ value, data }>
 */
export function openDialog({ title, body, actions = [], sheet = false, onMount, cls = '', dismiss = true, labelledBy }) {
  return new Promise(resolve => {
    const d = el('dialog.dlg' + (sheet ? '.sheet' : '') + (cls ? '.' + cls.split(' ').join('.') : ''), { aria: { labelledby: labelledBy || undefined } });
    const titleId = 'dt' + Math.random().toString(36).slice(2, 8);
    let collect = null, done = false;
    const finish = (value) => {
      if (done) return;
      let data = null;
      if (value !== 'cancel' && collect) { data = collect(value); if (data === false) return; }
      done = true;
      d.close();
      d.remove();
      resolve({ value, data });
    };
    const head = title ? el('div.dlg-head', el('h2.dlg-title', { id: titleId }, title),
      dismiss ? el('button.icon-btn.dlg-x', { type: 'button', aria: { label: t('Schließen') }, onclick: () => finish('cancel') }, icon('close')) : null) : null;
    if (title) d.setAttribute('aria-labelledby', titleId);
    const form = el('form.dlg-body', { method: 'dialog', onsubmit: e => { e.preventDefault(); const def = actions.find(a => a.default); if (def) finish(def.value); } }, body);
    const foot = actions.length ? el('div.dlg-actions', actions.map(a => el('button.btn' + (a.kind ? '.' + a.kind : a.default ? '.primary' : '.ghost') + (a.danger ? '.danger' : ''),
      { type: 'button', data: { v: a.value }, onclick: () => (a.run ? a.run() : finish(a.value)) }, a.label))) : null;
    append(d, [head, form, foot]);
    d.addEventListener('cancel', e => { e.preventDefault(); if (dismiss) finish('cancel'); });
    d.addEventListener('click', e => { if (e.target === d && dismiss) finish('cancel'); });
    document.body.appendChild(d);
    d.showModal();
    if (onMount) { const r = onMount(d, finish); if (r && r.collect) collect = r.collect; }
    const af = d.querySelector('[autofocus]') || d.querySelector('input,select,textarea');
    if (af) setTimeout(() => af.focus(), 30);
  });
}
export async function confirmDialog({ title, text, ok = t('OK'), cancel = t('Abbrechen'), danger = false }) {
  const r = await openDialog({ title, body: el('p.dlg-text', text), actions: [{ label: cancel, value: 'cancel' }, { label: ok, value: 'ok', kind: danger ? 'danger-solid' : 'primary', default: true }] });
  return r.value === 'ok';
}
export async function promptDialog({ title, label, value = '', ok = t('Speichern'), placeholder = '', maxLength = 200, selectBase = false }) {
  let input;
  const r = await openDialog({
    title,
    body: el('label.field', el('span.field-label', label), input = el('input.input', { type: 'text', value, placeholder, maxlength: maxLength, autocomplete: 'off', spellcheck: 'false', autofocus: true })),
    actions: [{ label: t('Abbrechen'), value: 'cancel' }, { label: ok, value: 'ok', default: true }],
    onMount: () => {
      setTimeout(() => { input.focus(); const dot = value.lastIndexOf('.'); if (selectBase && dot > 0) input.setSelectionRange(0, dot); else input.select(); }, 40);
      return { collect: () => { const v = input.value.trim(); if (!v) { input.focus(); return false; } return v; } };
    },
  });
  return r.value === 'ok' ? r.data : null;
}
/** Action sheet: items [{ label, icon, run, danger, hidden, sub }] */
export function actionSheet({ title, sub, items }) {
  const list = items.filter(i => i && !i.hidden);
  return openDialog({
    title, sheet: true, cls: 'actions',
    body: [sub ? el('p.sheet-sub', sub) : null, el('div.menu', list.map((it, i) => el('button.menu-item' + (it.danger ? '.danger' : ''), { type: 'button', data: { i } }, icon(it.icon || 'chevronRight'), el('span', it.label), it.hint ? el('span.menu-hint', it.hint) : null)))],
    onMount: (d, finish) => { d.querySelectorAll('.menu-item').forEach(b => b.addEventListener('click', () => { finish('cancel'); const it = list[+b.dataset.i]; setTimeout(() => it.run(), 10); })); },
  });
}

/** Hidden file input → Promise<File[]> */
export function pickFiles({ accept = '', multiple = true, capture = null, directory = false } = {}) {
  return new Promise(resolve => {
    const i = el('input', { type: 'file', accept: accept || undefined, multiple, hidden: true });
    if (capture) i.setAttribute('capture', capture);
    if (directory) { i.setAttribute('webkitdirectory', ''); i.setAttribute('directory', ''); }
    i.addEventListener('change', () => { const f = Array.from(i.files || []); i.remove(); resolve(f); });
    i.addEventListener('cancel', () => { i.remove(); resolve([]); });
    document.body.appendChild(i);
    i.click();
  });
}
/** Save a Blob as a file (anchor download; object URL revoked afterwards). */
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name || 'datei', hidden: true });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 30000);
}
export function progressBar(value = 0, label = '') {
  const fill = el('span.pbar-fill');
  const bar = el('span.pbar', { role: 'progressbar', aria: { valuemin: 0, valuemax: 100, valuenow: 0, label: label || t('Fortschritt') } }, fill);
  bar.set = v => { const p = Math.max(0, Math.min(1, v || 0)); fill.style.width = (p * 100).toFixed(1) + '%'; bar.setAttribute('aria-valuenow', String(Math.round(p * 100))); };
  bar.set(value);
  return bar;
}
/** Long press (touch) → fn; returns true when the long press fired (to suppress the click). */
export function onLongPress(node, fn, ms = 480) {
  let timer = null, fired = false, x = 0, y = 0;
  node.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') return; fired = false; x = e.clientX; y = e.clientY; timer = setTimeout(() => { fired = true; fn(e); }, ms); });
  const cancel = () => { clearTimeout(timer); timer = null; };
  node.addEventListener('pointerup', cancel); node.addEventListener('pointercancel', cancel); node.addEventListener('pointerleave', cancel);
  node.addEventListener('pointermove', e => { if (timer && (Math.abs(e.clientX - x) > 8 || Math.abs(e.clientY - y) > 8)) cancel(); });
  node.addEventListener('contextmenu', e => { if (fired) e.preventDefault(); });
  node.addEventListener('click', e => { if (fired) { e.preventDefault(); e.stopImmediatePropagation(); fired = false; } }, true);
}
