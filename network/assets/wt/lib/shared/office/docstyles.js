// GENERATED – synced copy of js/office/docstyles.js (app imports → lib/conv-office-shim.js, vendor paths re-based) by scripts/sync-webtools-vendor.mjs.
// Do not edit here: change the source in the app and run `node scripts/sync-webtools-vendor.mjs`.
// Formatvorlagen (Absatzformate) für Dokumente: Standardwerte, CSS für den Editor, Zuordnung zu Word-Formatvorlagen.
import { fontCss } from './fonts.js';

/**
 * A style: { id, name, sel (CSS selector inside .doc-page), font, size (pt), color, b, i, u, before, after (pt), line (multiple), align, indent (pt), bg, keepNext }
 * Paragraph markup: Standard <p>, Titel <p class="title">, Untertitel <p class="subtitle">, Überschrift 1–6 <h1>…<h6>,
 * Zitat <p class="quote"> (und <blockquote>), Code <pre>, Kein Abstand <p class="nospace">.
 */
export const STYLE_ORDER = ['normal', 'title', 'subtitle', 'h1', 'h2', 'h3', 'h4', 'quote', 'code', 'nospace'];
export const DEFAULT_STYLES = {
  normal: { name: 'Standard', font: 'Arial', size: 11, color: null, b: false, i: false, before: 0, after: 6, line: 1.15, align: null, docx: 'Normal' },
  title: { name: 'Titel', font: null, size: 26, color: '#1B1E33', b: true, i: false, before: 0, after: 12, line: 1.05, align: null, docx: 'Title' },
  subtitle: { name: 'Untertitel', font: null, size: 13, color: '#5A607F', b: false, i: false, before: 0, after: 10, line: 1.15, align: null, docx: 'Subtitle' },
  h1: { name: 'Überschrift 1', font: null, size: 20, color: '#1B1E33', b: true, i: false, before: 14, after: 8, line: 1.1, align: null, keepNext: true, docx: 'Heading1' },
  h2: { name: 'Überschrift 2', font: null, size: 16, color: '#1B1E33', b: true, i: false, before: 14, after: 6, line: 1.1, align: null, keepNext: true, docx: 'Heading2' },
  h3: { name: 'Überschrift 3', font: null, size: 13.5, color: '#2B2F4A', b: true, i: false, before: 12, after: 4, line: 1.1, align: null, keepNext: true, docx: 'Heading3' },
  h4: { name: 'Überschrift 4', font: null, size: 12, color: '#2B2F4A', b: true, i: true, before: 10, after: 4, line: 1.1, align: null, keepNext: true, docx: 'Heading4' },
  h5: { name: 'Überschrift 5', font: null, size: 11, color: '#2B2F4A', b: true, i: false, before: 8, after: 4, line: 1.1, align: null, keepNext: true, docx: 'Heading5', hidden: true },
  h6: { name: 'Überschrift 6', font: null, size: 11, color: '#2B2F4A', b: false, i: true, before: 8, after: 4, line: 1.1, align: null, keepNext: true, docx: 'Heading6', hidden: true },
  quote: { name: 'Zitat', font: null, size: null, color: '#3A3F58', b: false, i: true, before: 4, after: 8, line: 1.15, align: null, indent: 14, docx: 'Quote' },
  code: { name: 'Code', font: 'Courier New', size: 10, color: null, b: false, i: false, before: 0, after: 6, line: 1.2, align: null, bg: '#F3F4F8', docx: 'Code' },
  nospace: { name: 'Kein Abstand', font: null, size: null, color: null, b: false, i: false, before: 0, after: 0, line: 1, align: null, docx: 'NoSpacing' },
};
const SEL = { normal: 'p', title: 'p.title', subtitle: 'p.subtitle', h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h5', h6: 'h6', quote: 'p.quote, blockquote', code: 'pre', nospace: 'p.nospace' };
/** Block element description of a style: tag + class. */
export const STYLE_BLOCK = { normal: ['p', ''], title: ['p', 'title'], subtitle: ['p', 'subtitle'], h1: ['h1', ''], h2: ['h2', ''], h3: ['h3', ''], h4: ['h4', ''], h5: ['h5', ''], h6: ['h6', ''], quote: ['p', 'quote'], code: ['pre', ''], nospace: ['p', 'nospace'] };
export const STYLE_CLASSES = ['title', 'subtitle', 'quote', 'nospace'];

export function cloneStyles(st) { return JSON.parse(JSON.stringify(st || DEFAULT_STYLES)); }
/** Merge loaded/partial styles over the defaults. */
export function normalizeStyles(st) {
  const out = cloneStyles(DEFAULT_STYLES);
  if (st) for (const [k, v] of Object.entries(st)) if (out[k] && v) out[k] = { ...out[k], ...v };
  return out;
}
/** Style id of a block element (p/h1…/pre/blockquote). */
export function styleOfBlock(el) {
  if (!el || el.nodeType !== 1) return 'normal';
  const t = el.tagName;
  if (/^H[1-6]$/.test(t)) return t.toLowerCase();
  if (t === 'PRE') return 'code';
  if (t === 'BLOCKQUOTE' || (el.closest && el.closest('blockquote'))) return 'quote';
  for (const c of STYLE_CLASSES) if (el.classList && el.classList.contains(c)) return c;
  return 'normal';
}

/** CSS rules for the editor page (scoped to .doc-page). */
export function stylesCss(styles, scope = '.doc-page') {
  const S = normalizeStyles(styles);
  const n = S.normal;
  const rule = (st, isNormal = false) => {
    const css = [];
    const font = st.font || (isNormal ? n.font : null);
    if (font) css.push(`font-family:${fontCss(font)}`);
    if (st.size) css.push(`font-size:${st.size}pt`);
    if (st.color) css.push(`color:${st.color}`);
    if (st.b != null && !isNormal) css.push(`font-weight:${st.b ? 700 : 400}`);
    if (st.i != null && !isNormal) css.push(`font-style:${st.i ? 'italic' : 'normal'}`);
    if (st.u) css.push('text-decoration:underline');
    css.push(`margin-top:${st.before ?? 0}pt`, `margin-bottom:${st.after ?? 0}pt`);
    if (st.line) css.push(`line-height:${st.line * 1.13}`);
    if (st.align) css.push(`text-align:${st.align}`);
    if (st.bg) css.push(`background-color:${st.bg}`);
    return css.join(';');
  };
  let out = `${scope}{font-family:${fontCss(n.font || 'Arial')};${n.color ? `color:${n.color};` : ''}line-height:${(n.line || 1.15) * 1.13}}`;
  out += `${scope} p{${rule(n, true)}}`;
  for (const id of STYLE_ORDER.concat(['h5', 'h6'])) {
    if (id === 'normal') continue;
    const st = S[id];
    const sel = SEL[id].split(',').map(x => `${scope} ${x.trim()}`).join(',');
    out += `${sel}{${rule(st)}}`;
    if (id === 'quote') out += `${scope} p.quote{padding-left:${st.indent ?? 14}pt;border-left:3px solid #C9CCDA}`;
  }
  out += `${scope} li p, ${scope} td p, ${scope} th p{margin-top:0}`;
  out += `${scope} li{margin-bottom:${Math.min(n.after ?? 6, 3)}pt}`;
  return out;
}

/** Model tag for a block (used by the PDF and DOCX exporters). */
export const TAG_OF_STYLE = { normal: 'p', title: 'title', subtitle: 'subtitle', h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h5', h6: 'h6', quote: 'quote', code: 'code', nospace: 'nospace' };
export const STYLE_OF_TAG = Object.fromEntries(Object.entries(TAG_OF_STYLE).map(([k, v]) => [v, k]));
