// The FaleNetwork web tools in the app's tool list (#/werkzeuge) – the tools themselves open in js/webtools/host.js.
import { WEB_TOOLS, WEB_TOOL_CATEGORIES } from './catalog.js';
import { deOrEn } from '../i18n/index.js';
import { h, esc, $, $$, openDialog } from '../ui.js';

/** Tools the app has natively (its own, better integrated screens) – not listed again, still reachable by link. */
export const NATIVE_TWINS = new Set([
  'add-page-numbers', 'annotate-pdf', 'batch-pdf', 'business-card', 'cancellation-letter', 'compare-pdf', 'compress-image',
  'compress-pdf', 'convert-image', 'cover-letter', 'create-pdf-form', 'crop-image', 'crop-pdf', 'delete-pages', 'din-letter',
  'edit-bookmarks', 'edit-pdf-text', 'enhance-photo', 'excel-to-pdf', 'extract-pages', 'fill-pdf-form', 'header-footer',
  'heic-to-pdf', 'heic-to-png', 'id-copy', 'image-to-excel', 'image-to-text', 'image-to-word', 'jpg-to-pdf', 'jpg-to-png',
  'merge-pdf', 'ocr-pdf', 'organize-pdf', 'passport-photo', 'payment-reminder', 'pdf-to-excel', 'pdf-to-jpg', 'pdf-to-png',
  'pdf-to-pptx', 'pdf-to-text', 'pdf-to-word', 'pdf-viewer', 'photo-to-pdf', 'png-to-jpg', 'png-to-pdf', 'power-of-attorney',
  'pptx-to-pdf', 'protect-pdf', 'qr-code', 'qr-scanner', 'read-aloud', 'redact-pdf', 'resize-image', 'rotate-pdf', 'scan-to-pdf',
  'sign-pdf', 'signature-maker', 'text-to-pdf', 'unlock-pdf', 'watermark-pdf', 'webp-to-jpg', 'webp-to-pdf', 'webp-to-png',
  'withdrawal-letter', 'word-to-pdf',
]);

export const webToolById = id => WEB_TOOLS.find(t => t.id === id) || null;
const L = deOrEn;
export const webToolText = t => t[L()] || t.de;
/** Tools shown in the app's tool list (everything the app does not have natively). */
export const listedWebTools = () => WEB_TOOLS.filter(t => !NATIVE_TWINS.has(t.id));

// ---------------------------------------------------------------- accepted files
const MIME = {
  pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv', txt: 'text/plain', md: 'text/markdown',
};
const IMG_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif', heic: 'image/heic', heif: 'image/heif' };

export function docMime(doc) {
  const kind = doc.kind || 'pdf';
  if (kind !== 'image') return MIME[kind] || 'application/octet-stream';
  const ext = (String(doc.name).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1];
  return IMG_MIME[ext] || 'image/*';
}

/** Does a tool with these `accepts` (MIME types, wildcards, extensions) take this library entry? */
export function acceptsDoc(doc, accepts) {
  const name = String(doc.name || '').toLowerCase();
  const mime = docMime(doc);
  return (accepts || []).some(a => {
    a = String(a).toLowerCase();
    if (a.startsWith('.')) return name.endsWith(a);
    if (a.endsWith('/*')) return mime.startsWith(a.slice(0, -1));
    return a === mime;
  });
}

// ---------------------------------------------------------------- tool list
// app group per web tool category; null = own section (title from the catalog)
const GROUP_OF = { organize: 'organisieren', optimize: 'organisieren', edit: 'bearbeiten', 'convert-to-pdf': 'konvertieren',
  'convert-from-pdf': 'konvertieren', security: 'sicherheit', everyday: 'alltag', images: null, calc: null };
const OWN_TITLES = { images: 'Bilder & Fotos', calc: 'Rechner & Text' };

function card(t) {
  const x = webToolText(t);
  const kw = [x.name, x.short, ...(x.keywords || []), t.id].join(' ').toLocaleLowerCase('de');
  const a = h(`<a class="tool-card" href="#/web/${esc(t.id)}" data-tool="web-${esc(t.id)}" data-kw="${esc(kw)}" data-no-i18n><span class="tile-ic">`
    + `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${t.icon}</svg></span>`
    + `<span class="tc-text"><h3>${esc(x.name)}</h3><p>${esc(x.short || '')}</p></span></a>`);
  return a;
}

/** Adds the web tools to the tool list `el` (#view-werkzeuge): into the matching app groups, plus own sections. */
export function renderWebTools(el) {
  const groupsBox = $('[data-groups]', el);
  const own = new Map();
  for (const t of listedWebTools()) {
    const g = GROUP_OF[t.category];
    let grid = g === 'alltag' ? $('.alltag-grid', el) : g ? $(`[data-section="${g}"] .tool-grid`, el) : null;
    if (!grid) {
      const key = g || t.category;
      if (!own.has(key)) {
        const c = WEB_TOOL_CATEGORIES.find(x => x.id === t.category);
        const title = OWN_TITLES[t.category] || (c ? c.de : key);
        const sec = h(`<section class="tool-section" data-section="web-${esc(key)}"><h2 class="section-title">${esc(title)}</h2><div class="tool-grid"></div></section>`);
        groupsBox.appendChild(sec);
        own.set(key, $('.tool-grid', sec));
      }
      grid = own.get(key);
    }
    grid.appendChild(card(t));
  }
}

/** Library entry → choose one of the web tools that can open it (document menu „Mehr Werkzeuge …“). */
export async function chooseWebTool(doc) {
  const list = listedWebTools().filter(t => (t.minFiles || 0) > 0 && acceptsDoc(doc, t.accepts))
    .sort((a, b) => webToolText(a).name.localeCompare(webToolText(b).name, L()));
  await openDialog({
    title: 'Mehr Werkzeuge',
    wide: true,
    body: `<p class="doc-name">${esc(doc.name)}</p><input class="input" type="search" data-q placeholder="Werkzeug suchen" aria-label="Werkzeug suchen">
      <div class="tool-grid wt-pick-grid" data-list></div>${list.length ? '' : '<p class="panel-empty">Für diese Datei gibt es hier keine weiteren Werkzeuge.</p>'}`,
    actions: [{ label: 'Schließen', value: 'cancel' }],
    onMount: dlg => {
      const box = $('[data-list]', dlg);
      list.forEach(t => {
        const c = card(t);
        c.href = `#/web/${t.id}?doc=${encodeURIComponent(doc.id)}`;
        c.addEventListener('click', () => { try { dlg.close(); } catch { /* already closed */ } });
        box.appendChild(c);
      });
      $('[data-q]', dlg).addEventListener('input', e => {
        const n = e.target.value.toLocaleLowerCase('de');
        $$('.tool-card', box).forEach(c => { c.hidden = !!n && !c.textContent.toLocaleLowerCase('de').includes(n) && !(c.dataset.kw || '').includes(n); });
      });
    },
  });
}
