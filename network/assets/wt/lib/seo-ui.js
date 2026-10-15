// Small UI helpers for the seo-* tools (password-generator, barcode-generator): stylesheet, copy, icons.
import { el } from './dom.js';

let cssReady = null;
/** Load lib/seo.css once (CSP style-src 'self' – no inline styles). Also loads img-tools.css (shared look). */
export function seoCss() {
  if (!cssReady) {
    cssReady = Promise.all(['./img-tools.css', './seo.css'].map(f => new Promise(resolve => {
      const href = new URL(f, import.meta.url).href;
      if (document.querySelector(`link[href="${href}"]`)) { resolve(); return; }
      const link = el('link', { rel: 'stylesheet', href });
      link.addEventListener('load', () => resolve());
      link.addEventListener('error', () => resolve());
      document.head.append(link);
    })));
  }
  return cssReady;
}

/** Copy text to the clipboard; falls back to a selected textarea + execCommand. → true on success. */
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* permission denied or insecure context – try the fallback */ }
  const ta = el('textarea', { class: 'seo-copy-ta', readonly: true, aria: { hidden: 'true' } });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

const NS = 'http://www.w3.org/2000/svg';
const PATHS = {
  copy: ['M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z', 'M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1'],
};
/** Stroke icon that lib/dom.js does not have. */
export function svgIcon(name) {
  const s = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', class: 'wt-i' })) s.setAttribute(k, v);
  for (const d of PATHS[name] || []) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.append(p); }
  return s;
}
