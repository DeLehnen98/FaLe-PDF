// Shared helpers of the conversion tools (pdf-to-jpg/png, extract-images, pdf-to-text/markdown/word/
// excel/pptx, word/excel/pptx/text-to-pdf): errors, result previews on the result card, page options.
import { el, icon, clear } from './dom.js';
import { pick } from './strings.js';

/** Throw an error with a user-facing text. */
export function fail(de, en) {
  throw Object.assign(new Error(en), { userMessage: { de, en } });
}

/** App errors (lib/shared/office/*) only carry German texts – add a generic English one. */
export function userError(err, fallbackEn = 'The file could not be read. It may be damaged or in an unsupported format.') {
  if (err && err.userMessage && typeof err.userMessage === 'object' && !err.userMessage.en) {
    err.userMessage = { de: err.userMessage.de, en: fallbackEn };
  }
  return err;
}

/** Touch device (phone/tablet): the result's main action becomes "Teilen". */
export const coarsePointer = () => !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);

let cssLoaded = false;
/** Load the tool styles (a file – the CSP forbids inline styles). */
export function loadConvCss() {
  if (cssLoaded) return;
  cssLoaded = true;
  document.head.append(el('link', { rel: 'stylesheet', href: new URL('./conv.css', import.meta.url).href }));
}

export const PAGES_OPTION = {
  id: 'pages', type: 'pages', default: '',
  label: { de: 'Seiten (leer = alle)', en: 'Pages (empty = all)' },
  placeholder: { de: 'z. B. 1-3, 5', en: 'e.g. 1-3, 5' },
};

const T = (lang, v) => pick(lang, v);

/** A section on the result card with a heading. */
export function previewSection(result, lang, title, ...children) {
  loadConvCss();
  const sec = el('section', { class: 'cv-preview', aria: { label: T(lang, title) } },
    el('h3', { class: 'cv-preview-h' }, T(lang, title)), ...children);
  // place it right after the list of outputs (before notes / actions)
  const outs = result.querySelector('.wt-outputs');
  if (outs && outs.nextSibling) result.insertBefore(sec, outs.nextSibling); else result.append(sec);
  return sec;
}

/** Grid of image outputs (lazy: object URLs are revoked when the result is replaced). */
export function imageGridPreview(result, res, ctx, { max = 24, title } = {}) {
  const imgs = res.outputs.filter(o => o.blob.type.startsWith('image/'));
  if (!imgs.length) return;
  const urls = [];
  const grid = el('ul', { class: 'cv-grid' });
  for (const o of imgs.slice(0, max)) {
    const url = URL.createObjectURL(o.blob);
    urls.push(url);
    const img = el('img', { src: url, alt: o.name, loading: 'lazy', decoding: 'async' });
    grid.append(el('li', {}, img, el('span', { class: 'cv-grid-cap' }, o.meta?.label || o.name)));
  }
  const more = imgs.length > max ? el('p', { class: 'cv-muted' }, T(ctx.lang, { de: `… und ${imgs.length - max} weitere`, en: `… and ${imgs.length - max} more` })) : null;
  previewSection(result, ctx.lang, title || { de: 'Vorschau', en: 'Preview' }, grid, more);
  revokeLater(result, urls);
}

function revokeLater(result, urls) {
  const mo = new MutationObserver(() => {
    if (!result.isConnected || !result.querySelector('.cv-preview')) { urls.forEach(u => URL.revokeObjectURL(u)); mo.disconnect(); }
  });
  mo.observe(result, { childList: true });
}

/** Text preview with "Kopieren" (copy all) – text of the first output. */
export async function textPreview(result, res, ctx, { title, mono = false } = {}) {
  const o = res.outputs[0];
  if (!o) return;
  const text = await o.blob.text();
  const LIMIT = 4000;
  const pre = el('pre', { class: 'cv-text' + (mono ? ' cv-mono' : ''), tabindex: '0' }, text.length > LIMIT ? text.slice(0, LIMIT) + '\n…' : text);
  const status = el('span', { class: 'cv-copy-status', aria: { live: 'polite' } });
  const copy = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm' }, icon('check'), T(ctx.lang, { de: 'Alles kopieren', en: 'Copy all' }));
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = T(ctx.lang, { de: 'Kopiert ✓', en: 'Copied ✓' });
    } catch {
      // fallback: select the preview so the user can copy by hand
      const sel = window.getSelection();
      const range = document.createRange();
      pre.textContent = text;
      range.selectNodeContents(pre);
      sel.removeAllRanges();
      sel.addRange(range);
      status.textContent = T(ctx.lang, { de: 'Text markiert – jetzt kopieren', en: 'Text selected – copy it now' });
    }
  });
  const stats = el('p', { class: 'cv-muted' }, T(ctx.lang, {
    de: `${text.length.toLocaleString('de-DE')} Zeichen · ${countWords(text).toLocaleString('de-DE')} Wörter`,
    en: `${text.length.toLocaleString('en-GB')} characters · ${countWords(text).toLocaleString('en-GB')} words`,
  }));
  previewSection(result, ctx.lang, title || { de: 'Vorschau', en: 'Preview' }, el('div', { class: 'cv-row' }, copy, status), pre, stats);
}

const countWords = s => (s.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu) || []).length;

/** Swipeable strip of rendered PDF pages (first `max` pages) of a PDF blob. */
export async function pdfPagesPreview(result, blob, ctx, { max = 6, title } = {}) {
  const strip = el('ol', { class: 'cv-pages', tabindex: '0', aria: { label: T(ctx.lang, { de: 'Seitenvorschau', en: 'Page preview' }) } });
  const sec = previewSection(result, ctx.lang, title || { de: 'So sieht das Ergebnis aus', en: 'This is what the result looks like' }, strip);
  const { openPdfjs, renderPage } = await import('./pdf.js');
  let doc;
  try {
    doc = await openPdfjs(new Uint8Array(await blob.arrayBuffer()), null);
    const n = Math.min(max, doc.numPages);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (let i = 1; i <= n; i++) {
      if (!sec.isConnected) break;
      const page = await doc.getPage(i);
      const canvas = await renderPage(page, { width: 220, dpr });
      page.cleanup();
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', T(ctx.lang, { de: `Seite ${i}`, en: `Page ${i}` }));
      strip.append(el('li', {}, canvas, el('span', { class: 'cv-grid-cap' }, String(i))));
    }
    if (doc.numPages > n) strip.append(el('li', { class: 'cv-pages-more' }, T(ctx.lang, { de: `+ ${doc.numPages - n} Seiten`, en: `+ ${doc.numPages - n} pages` })));
  } catch (err) {
    console.warn(err);
    sec.remove();
  } finally { doc?.destroy(); }
}

/** Strip of small preview images (blobs), e.g. slides or rendered result pages. */
export function thumbStrip(result, blobs, ctx, { title, total = blobs.length, label } = {}) {
  if (!blobs?.length) return;
  const urls = [];
  const strip = el('ol', { class: 'cv-pages', tabindex: '0', aria: { label: T(ctx.lang, title || { de: 'Vorschau', en: 'Preview' }) } });
  blobs.forEach((b, i) => {
    const url = URL.createObjectURL(b);
    urls.push(url);
    const name = label ? label(i) : T(ctx.lang, { de: `Seite ${i + 1}`, en: `Page ${i + 1}` });
    strip.append(el('li', {}, el('img', { src: url, alt: name, class: 'cv-thumb', decoding: 'async' }), el('span', { class: 'cv-grid-cap' }, String(i + 1))));
  });
  if (total > blobs.length) strip.append(el('li', { class: 'cv-pages-more' }, T(ctx.lang, { de: `+ ${total - blobs.length} weitere`, en: `+ ${total - blobs.length} more` })));
  previewSection(result, ctx.lang, title || { de: 'Vorschau', en: 'Preview' }, strip);
  revokeLater(result, urls);
}

/** Small JPEG of a canvas for previews. */
export async function canvasThumb(canvas, width = 240) {
  const s = Math.min(1, width / canvas.width);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(canvas.width * s)); c.height = Math.max(1, Math.round(canvas.height * s));
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(canvas, 0, 0, c.width, c.height);
  const b = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
  c.width = c.height = 0;
  return b;
}

/** Table preview (first rows of detected tables). */
export function tablePreview(result, tables, ctx, { title, maxRows = 12, maxTables = 3 } = {}) {
  const box = el('div', { class: 'cv-tables' });
  for (const t of tables.slice(0, maxTables)) {
    const table = el('table', { class: 'cv-table' });
    if (t.caption) table.append(el('caption', {}, t.caption));
    const tb = el('tbody');
    for (const row of t.rows.slice(0, maxRows)) tb.append(el('tr', {}, row.map(c => el('td', {}, c == null ? '' : String(c)))));
    table.append(tb);
    box.append(el('div', { class: 'cv-table-wrap', tabindex: '0' }, table));
    if (t.rows.length > maxRows) box.append(el('p', { class: 'cv-muted' }, T(ctx.lang, { de: `… ${t.rows.length - maxRows} weitere Zeilen`, en: `… ${t.rows.length - maxRows} more rows` })));
  }
  if (tables.length > maxTables) box.append(el('p', { class: 'cv-muted' }, T(ctx.lang, { de: `… und ${tables.length - maxTables} weitere Tabellen`, en: `… and ${tables.length - maxTables} more tables` })));
  previewSection(result, ctx.lang, title || { de: 'Erkannte Tabellen', en: 'Detected tables' }, box);
}

export { el, icon, clear };
