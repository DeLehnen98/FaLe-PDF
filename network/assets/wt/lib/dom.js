// Tiny DOM helpers. All UI is built with createElement/textContent – never from HTML strings – so the
// pages work under Trusted Types and untrusted text (file names!) can never become markup.

/**
 * el('button', {class: 'x', type: 'button', onclick: fn, dataset: {a: 1}, aria: {label: '…'}}, child, 'text', …)
 * Attribute values false/null/undefined are skipped, true sets an empty attribute.
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'aria') for (const [a, av] of Object.entries(v)) { if (av != null) node.setAttribute('aria-' + a, String(av)); }
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k in node && typeof v !== 'string' && k !== 'list') node[k] = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function clear(node) { while (node.firstChild) node.firstChild.remove(); return node; }

// 24 px stroke icons as path data (circles/rects written as paths).
const ICONS = {
  up: ['M12 19V5', 'M6 11l6-6 6 6'],
  down: ['M12 5v14', 'M6 13l6 6 6-6'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  grip: ['M9 6h.01', 'M15 6h.01', 'M9 12h.01', 'M15 12h.01', 'M9 18h.01', 'M15 18h.01'],
  lock: ['M6.5 10.5h11a2.5 2.5 0 0 1 2.5 2.5v5.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5V13a2.5 2.5 0 0 1 2.5-2.5z', 'M8 10.5V7a4 4 0 0 1 8 0v3.5'],
  check: ['M20 6 9 17l-5-5'],
  download: ['M12 4v12', 'M7 11l5 5 5-5', 'M4 20h16'],
  share: ['M12 15V3', 'M7 8l5-5 5 5', 'M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7'],
  zip: ['M6 3h8l4 4v14H6z', 'M10 3v2h2v2h-2v2h2v2h-2v2', 'M9.5 14h3v3h-3z'],
  arrow: ['M5 12h14', 'M13 6l6 6-6 6'],
  restart: ['M4 12a8 8 0 1 0 2.3-5.7', 'M4 4v5h5'],
  alert: ['M12 3l9.5 17h-19z', 'M12 10v4', 'M12 17.5v.01'],
  file: ['M6 3h8l4 4v14H6z', 'M14 3v4h4'],
  image: ['M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M3 17l5-5 4 4 3-3 6 6'],
  plus: ['M12 5v14', 'M5 12h14'],
  settings: ['M4 7h10', 'M18 7h2', 'M4 17h4', 'M12 17h8', 'M16 5v4', 'M10 15v4'],
  offline: ['M5 13a10 10 0 0 1 14 0', 'M8.5 16.5a5 5 0 0 1 7 0', 'M12 20h.01', 'M2 9.5a15 15 0 0 1 20 0'],
};

const NS = 'http://www.w3.org/2000/svg';
export function icon(name, cls = 'wt-i') {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  if (cls) s.setAttribute('class', cls);
  for (const d of ICONS[name] || []) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    s.append(p);
  }
  return s;
}

/** Wait for the next frame / macrotask so the UI can paint between heavy steps. */
export const nextFrame = () => new Promise(r => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => setTimeout(r, 0)) : setTimeout(r, 0)));
export const tick = () => new Promise(r => setTimeout(r, 0));

export const reducedMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
