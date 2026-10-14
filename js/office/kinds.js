// File kinds of the library (PDF, documents, spreadsheets, presentations, text, images) + office icons.
import { icon } from '../icons.js';
import { showMenu } from '../ui.js';

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MIME_PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export const KINDS = {
  pdf: { label: 'PDF', short: 'PDF', cat: 'pdf', color: '#D2453F', ext: '.pdf', mime: 'application/pdf', glyph: 'kpdf' },
  docx: { label: 'Dokument', short: 'DOC', cat: 'doc', color: '#2F67D8', ext: '.docx', mime: MIME_DOCX, glyph: 'kdoc' },
  txt: { label: 'Text', short: 'TXT', cat: 'doc', color: '#5D6488', ext: '.txt', mime: 'text/plain', glyph: 'kdoc' },
  md: { label: 'Markdown', short: 'MD', cat: 'doc', color: '#5D6488', ext: '.md', mime: 'text/markdown', glyph: 'kdoc' },
  xlsx: { label: 'Tabelle', short: 'XLS', cat: 'sheet', color: '#15895A', ext: '.xlsx', mime: MIME_XLSX, glyph: 'ksheet' },
  csv: { label: 'CSV-Tabelle', short: 'CSV', cat: 'sheet', color: '#15895A', ext: '.csv', mime: 'text/csv', glyph: 'ksheet' },
  pptx: { label: 'Präsentation', short: 'PPT', cat: 'slides', color: '#D8622A', ext: '.pptx', mime: MIME_PPTX, glyph: 'kslides' },
  image: { label: 'Bild', short: 'IMG', cat: 'image', color: '#8A4FD0', ext: '', mime: 'image/*', glyph: 'image' },
};

export const CATEGORIES = [
  { id: 'all', label: 'Alle' },
  { id: 'pdf', label: 'PDF' },
  { id: 'doc', label: 'Dokumente' },
  { id: 'sheet', label: 'Tabellen' },
  { id: 'slides', label: 'Präsentationen' },
  { id: 'image', label: 'Bilder' },
];

/** Everything the library can import (for <input accept>). */
export const ACCEPT_ALL = [
  '.pdf', 'application/pdf', '.docx', MIME_DOCX, '.xlsx', MIME_XLSX, '.csv', 'text/csv', '.pptx', MIME_PPTX,
  '.txt', 'text/plain', '.md', '.markdown', 'text/markdown', 'image/*', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp',
].join(',');
export const ACCEPT = {
  doc: `.docx,${MIME_DOCX},.txt,text/plain,.md,.markdown,text/markdown`,
  docx: `.docx,${MIME_DOCX}`,
  sheet: `.xlsx,${MIME_XLSX},.csv,text/csv`,
  slides: `.pptx,${MIME_PPTX}`,
  text: '.txt,text/plain,.md,.markdown,text/markdown',
};

export function kindOf(doc) { return (doc && doc.kind) || 'pdf'; }
export function kindInfo(doc) { return KINDS[kindOf(doc)] || KINDS.pdf; }
export function catOf(doc) { return kindInfo(doc).cat; }

/** Detect the kind of a File from its name and type. Returns null for unsupported files. */
export function detectKind(file) {
  const n = String(file.name || '').toLowerCase();
  const t = String(file.type || '').toLowerCase();
  if (t === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (n.endsWith('.docx') || t === MIME_DOCX) return 'docx';
  if (n.endsWith('.xlsx') || t === MIME_XLSX) return 'xlsx';
  if (n.endsWith('.pptx') || t === MIME_PPTX) return 'pptx';
  if (n.endsWith('.csv') || t === 'text/csv') return 'csv';
  if (n.endsWith('.md') || n.endsWith('.markdown') || t === 'text/markdown') return 'md';
  if (n.endsWith('.txt') || t === 'text/plain') return 'txt';
  if (/^image\//.test(t) || /\.(jpe?g|png|webp|gif|bmp|avif)$/.test(n)) return 'image';
  return null;
}

/** Friendly reason why a file can't be imported. */
export function unsupportedReason(file) {
  const n = String(file.name || '').toLowerCase();
  if (/\.(doc|xls|ppt|dot|xlt|pot)$/.test(n)) return `„${file.name}“ ist ein älteres Office-Format. Bitte speichere es als .docx, .xlsx oder .pptx.`;
  if (/\.(odt|ods|odp)$/.test(n)) return `„${file.name}“: OpenDocument-Dateien werden noch nicht unterstützt. Bitte als .docx, .xlsx oder .pptx speichern.`;
  if (/\.(heic|heif)$/.test(n)) return `„${file.name}“: HEIC-Fotos kann dieser Browser nicht lesen. Bitte als JPG teilen.`;
  return `„${file.name}“ wird nicht unterstützt.`;
}

/** Route for opening a library entry. */
export function openHash(doc) {
  return kindOf(doc) === 'pdf' ? `#/ansicht/${doc.id}` : `#/bearbeiten/${doc.id}`;
}

export function ensureExt(name, kind) {
  const k = KINDS[kind];
  let n = String(name || '').trim() || 'Dokument';
  if (kind === 'image') return n;
  if (kind === 'md' && /\.(md|markdown)$/i.test(n)) return n;
  if (k && k.ext && !n.toLowerCase().endsWith(k.ext)) n += k.ext;
  return n;
}

export function stripExt(name) {
  return String(name || 'Dokument').replace(/\.(pdf|docx|xlsx|pptx|csv|txt|md|markdown|jpe?g|png|webp|gif|bmp|avif)$/i, '');
}

// ---------------- office icons (24x24 stroke) ----------------
const P = {
  kdoc: '<path d="M14 3.5H7.2c-.9 0-1.7.8-1.7 1.7v13.6c0 .9.8 1.7 1.7 1.7h9.6c.9 0 1.7-.8 1.7-1.7V8z"/><path d="M14 3.5V8h4.5"/><path d="M8.6 11.5h6.8M8.6 14.4h6.8M8.6 17.3h4.4"/>',
  ksheet: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.3h16M4 14.7h16M9.5 4v16"/>',
  kslides: '<rect x="3.5" y="4.5" width="17" height="11.5" rx="1.8"/><path d="M12 16v3.5M8.5 19.5h7"/><path d="M7.5 12.5v-2M10.5 12.5V8.5M13.5 12.5v-3"/>',
  kpdf: '<path d="M14 3.5H7.2c-.9 0-1.7.8-1.7 1.7v13.6c0 .9.8 1.7 1.7 1.7h9.6c.9 0 1.7-.8 1.7-1.7V8z"/><path d="M14 3.5V8h4.5"/><path d="M8.3 16.5c1.6-1 3.4-3.7 3.7-6.4.1-.9-.9-1.2-1.2-.4-.6 1.7 1.9 4.6 4.4 5 .9.1 1-.9.3-1.1-1.9-.6-5.4.7-7.2 2.9z"/>',
  template: '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M4 8.5h16M9.5 8.5v12"/>',
  bold: '<path d="M7.5 5h5.2a3.3 3.3 0 0 1 0 6.6H7.5zM7.5 11.6h6a3.4 3.4 0 0 1 0 6.9h-6z" stroke-width="2.2"/>',
  italic: '<path d="M10.5 5H17M7 19h6.5M14 5l-4 14"/>',
  underline: '<path d="M7.5 4.5v6.2a4.5 4.5 0 0 0 9 0V4.5M6 19.5h12"/>',
  strike: '<path d="M5 12h14M16.2 7.5c-.6-1.6-2.1-2.5-4.2-2.5-2.5 0-4 1.3-4 3 0 1.2.7 2 1.8 2.6M8 16.3c.6 1.6 2.2 2.7 4.3 2.7 2.6 0 4.2-1.3 4.2-3.2 0-.6-.1-1.1-.4-1.5"/>',
  alignLeft: '<path d="M4.5 6h15M4.5 10h10M4.5 14h15M4.5 18h10"/>',
  alignCenter: '<path d="M4.5 6h15M7 10h10M4.5 14h15M7 18h10"/>',
  alignRight: '<path d="M4.5 6h15M9.5 10h10M4.5 14h15M9.5 18h10"/>',
  alignJustify: '<path d="M4.5 6h15M4.5 10h15M4.5 14h15M4.5 18h15"/>',
  listUl: '<path d="M9.5 6.5h10M9.5 12h10M9.5 17.5h10"/><circle cx="5.3" cy="6.5" r="1.1" fill="currentColor"/><circle cx="5.3" cy="12" r="1.1" fill="currentColor"/><circle cx="5.3" cy="17.5" r="1.1" fill="currentColor"/>',
  listOl: '<path d="M10 6.5h9.5M10 12h9.5M10 17.5h9.5"/><path d="M4.6 5.2 5.8 4.6v4M4.4 10.6c.3-.5.8-.8 1.3-.8.7 0 1.2.4 1.2 1 0 .9-1.5 1.6-2.5 2.6h2.6M4.5 15.5h2.2l-1.2 1.3c.8 0 1.4.4 1.4 1.1s-.6 1.2-1.3 1.2c-.5 0-.9-.2-1.2-.5"/>',
  table: '<rect x="3.8" y="4.5" width="16.4" height="15" rx="1.8"/><path d="M3.8 9.5h16.4M3.8 14.5h16.4M9.3 9.5v10M14.7 9.5v10"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  redo: '<path d="M15.5 5.5 19.5 9.5l-4 4"/><path d="M19.2 9.5H10a5.5 5.5 0 0 0 0 11h3"/>',
  color: '<path d="M6.5 17 12 4.5 17.5 17M8.4 12.8h7.2"/><path d="M4.5 20.2h15" stroke-width="2.6"/>',
  fill: '<path d="m5.5 11.5 6-6 7 7-6 6a2 2 0 0 1-2.8 0l-4.2-4.2a2 2 0 0 1 0-2.8z"/><path d="M5 12h13M9 3.5l2.5 2"/><path d="M19.5 15.5s1.5 1.8 1.5 2.8a1.5 1.5 0 0 1-3 0c0-1 1.5-2.8 1.5-2.8z"/>',
  replace: '<circle cx="9.5" cy="9.5" r="5"/><path d="m13 13 3 3"/><path d="M14.5 19.5h6M18 17l2.5 2.5L18 22"/>',
  rowAdd: '<rect x="3.5" y="4" width="17" height="6" rx="1.4"/><path d="M3.5 15h9M17.5 13v6M14.5 16h6"/>',
  rowDel: '<rect x="3.5" y="4" width="17" height="6" rx="1.4"/><path d="M3.5 15h9M15 14l4.5 4.5M19.5 14 15 18.5"/>',
  colAdd: '<rect x="4" y="3.5" width="6" height="17" rx="1.4"/><path d="M15 3.5v9M17 17.5h6M20 14.5v6"/>',
  colDel: '<rect x="4" y="3.5" width="6" height="17" rx="1.4"/><path d="M15 3.5v9M14.5 15l4.5 4.5M19 15l-4.5 4.5"/>',
  sortAsc: '<path d="M7 4.5v15M3.8 16.3 7 19.5l3.2-3.2"/><path d="M13 6.5h7.5M13 11h5.5M13 15.5h3.5"/>',
  sortDesc: '<path d="M7 4.5v15M3.8 16.3 7 19.5l3.2-3.2"/><path d="M13 6.5h3.5M13 11h5.5M13 15.5h7.5"/>',
  freeze: '<rect x="3.8" y="4" width="16.4" height="16" rx="1.8"/><path d="M3.8 9h16.4" stroke-width="2.6"/><path d="M9.5 9v11M14.5 9v11"/>',
  sigma: '<path d="M17.5 5.5h-11l6 6.5-6 6.5h11"/>',
  fx: '<path d="M12 5.5c-1.2-.9-3.6-.8-4 1.8L6.2 18.5c-.4 2.3-2.4 2.6-3.2 1.8M5 10.5h6"/><path d="m13.5 10.5 6 7M19.5 10.5l-6 7"/>',
  present: '<rect x="3.5" y="4.5" width="17" height="11.5" rx="1.8"/><path d="M10.3 8v5l4.2-2.5z" fill="currentColor" stroke="none"/><path d="M12 16v3.5M8.5 19.5h7"/>',
  slideAdd: '<rect x="3.5" y="5" width="13" height="9.5" rx="1.6"/><path d="M19.5 9v9.5c0 .6-.4 1-1 1H7"/><path d="M10 7.5v4.5M7.8 9.8h4.4"/>',
  shape: '<rect x="3.8" y="9" width="9.5" height="10.5" rx="1.4"/><circle cx="15.5" cy="8.5" r="4.7"/>',
  textbox: '<rect x="3.5" y="5" width="17" height="14" rx="1.8" stroke-dasharray="2.6 2.4"/><path d="M8.5 9h7M12 9v7"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V6c0-1.1-.9-2-2-2H6c-1.1 0-2 .9-2 2v7.5c0 1.1.9 2 2 2h2.5"/>',
  fontUp: '<path d="M3.5 18.5 8.5 6l5 12.5M5.3 14h6.4"/><path d="M18 9v8M14 13h8"/>',
  fontDown: '<path d="M3.5 18.5 8.5 6l5 12.5M5.3 14h6.4"/><path d="M14.5 13h7"/>',
  heart: '<path d="M12 19.5s-7.5-4.4-7.5-10A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7.5 2.5c0 5.6-7.5 10-7.5 10z"/>',
  cloud: '<path d="M7 18.5h10.5a4 4 0 0 0 .6-8 5.5 5.5 0 0 0-10.6-1.2A4.6 4.6 0 0 0 7 18.5z"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.8 20c.8-3.6 3.7-5.6 7.2-5.6s6.4 2 7.2 5.6"/>',
  upload: '<path d="M12 15.5V4.5M7.5 8.8 12 4.3l4.5 4.5"/><path d="M4.5 16.5v2.2c0 .7.6 1.3 1.3 1.3h12.4c.7 0 1.3-.6 1.3-1.3v-2.2"/>',
  gift: '<rect x="4" y="9" width="16" height="11" rx="1.8"/><path d="M3.5 9h17v-1.3c0-.6-.4-1-1-1h-15c-.6 0-1 .4-1 1zM12 6.7V20"/><path d="M12 6.7c-1.2-2.8-4.8-3.4-4.8-1.3 0 1.6 3 1.3 4.8 1.3zM12 6.7c1.2-2.8 4.8-3.4 4.8-1.3 0 1.6-3 1.3-4.8 1.3z"/>',
  // ---- extras ----
  vault: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.2"/><circle cx="12" cy="12" r="3.6"/><path d="M12 8.4v1.4M12 14.2v1.4M8.4 12h1.4M14.2 12h1.4M6.5 19.5v1.2M17.5 19.5v1.2"/>',
  bell: '<path d="M6.2 16.5V11a5.8 5.8 0 0 1 11.6 0v5.5l1.6 1.8H4.6z"/><path d="M10 20.2a2.1 2.1 0 0 0 4 0"/>',
  letter: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4.2 7 7.8 6 7.8-6"/>',
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.8 11.5a6.2 6.2 0 0 0 12.4 0M12 17.7v3M9 20.7h6"/>',
  tag: '<path d="M3.8 12.6V4.8c0-.6.4-1 1-1h7.8l7.6 7.6a1.4 1.4 0 0 1 0 2l-6.8 6.8a1.4 1.4 0 0 1-2 0z"/><circle cx="8.3" cy="8.3" r="1.5"/>',
  folderPlus: '<path d="M3.5 6.8c0-.9.7-1.6 1.6-1.6h4.2l2 2.2h7.6c.9 0 1.6.7 1.6 1.6v8.8c0 .9-.7 1.6-1.6 1.6H5.1c-.9 0-1.6-.7-1.6-1.6z"/><path d="M12 10.5v6M9 13.5h6"/>',
  folderMove: '<path d="M3.5 6.8c0-.9.7-1.6 1.6-1.6h4.2l2 2.2h7.6c.9 0 1.6.7 1.6 1.6v8.8c0 .9-.7 1.6-1.6 1.6H5.1c-.9 0-1.6-.7-1.6-1.6z"/><path d="M8.5 13.5h7M13 11l2.5 2.5L13 16"/>',
  chart: '<path d="M4 4v16h16"/><rect x="7" y="11" width="3" height="6" rx=".6"/><rect x="12" y="7" width="3" height="10" rx=".6"/><rect x="17" y="13" width="2.6" height="4" rx=".6"/>',
  comment: '<path d="M4.5 6.2c0-1 .8-1.7 1.7-1.7h11.6c1 0 1.7.8 1.7 1.7v8.1c0 1-.8 1.7-1.7 1.7H10l-4.2 3.5V16h0a1.7 1.7 0 0 1-1.3-1.7z"/><path d="M8.5 9h7M8.5 12h4.5"/>',
  toc: '<path d="M4.5 6h9M4.5 10h11M7.5 14h8M7.5 18h6"/><path d="M18 6h1.5M18.5 10h1M18.5 14h1M17.5 18h2" stroke-dasharray="1 1.6"/>',
  restore: '<path d="M4.5 12a7.5 7.5 0 1 0 2.3-5.4"/><path d="M4.4 4.2v4.4h4.4"/><path d="M12 8v4.3l2.8 1.7"/>',
  duplicate: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.8c0-1-.8-1.8-1.8-1.8H5.8C4.8 4 4 4.8 4 5.8v8.4c0 1 .8 1.8 1.8 1.8H8"/><path d="M11.5 14h5M14 11.5v5"/>',
  stats: '<path d="M5 19.5V13M10 19.5V8M15 19.5v-9M20 19.5V5"/>',
  border: '<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="2 2.2"/><path d="M4 20h16" stroke-width="2.6"/>',
  wrap: '<path d="M4 6h16M4 12h12.5a3 3 0 0 1 0 6H12"/><path d="m14 15.8-2.3 2.2 2.3 2.2M4 18h4.5"/>',
  mergeCells: '<rect x="3.5" y="5" width="17" height="14" rx="1.6"/><path d="M12 5v3.5M12 15.5V19M7 12h4M13 12h4M9 10l2 2-2 2M15 10l-2 2 2 2"/>',
  condfmt: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.3h16M4 14.7h16M9.5 4v16"/><rect x="10.5" y="10.3" width="8.5" height="3.4" fill="currentColor" stroke="none" opacity=".45"/>',
  dropdown: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M7 10h6M7 14h4M15.5 11l1.5 1.6 1.5-1.6"/>',
  presenter: '<rect x="2.5" y="4.5" width="12" height="8.5" rx="1.4"/><rect x="16" y="4.5" width="5.5" height="4" rx="1"/><path d="M16 11.5h5.5M16 14h4M2.5 17h12M2.5 20h8"/>',
  timer: '<circle cx="12" cy="13.5" r="7"/><path d="M12 9.5v4.2l2.6 1.5M9.5 3.5h5"/>',
  fingerprint: '<path d="M7.2 18.6c1.2-1.7 1.8-3.8 1.8-6.1a3 3 0 0 1 6 0c0 1.2-.1 2.4-.4 3.5"/><path d="M12 12.5c0 3.2-1 6.1-2.7 8.3M14 18.5c-.4 1-.9 1.9-1.4 2.7"/><path d="M5 15.3c.4-.9.6-1.8.6-2.8a6.4 6.4 0 0 1 12.8 0c0 1.5-.1 2.9-.4 4.3"/><path d="M6.4 6.4A8.5 8.5 0 0 1 20.3 9"/>',
  translate: '<path d="M4 5.5h9M8.5 4v1.5c0 4-2 7-4.5 8.5M6.2 9c1.1 2.2 3 3.8 5.3 4.6"/><path d="m12.5 20 3.8-9 3.8 9M13.8 17h5"/>',
  summary: '<path d="M14 3.5H7.2c-.9 0-1.7.8-1.7 1.7v13.6c0 .9.8 1.7 1.7 1.7h9.6c.9 0 1.7-.8 1.7-1.7V8z"/><path d="M14 3.5V8h4.5"/><path d="M8.6 12h6.8M8.6 15h4"/><path d="M17.5 14.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" fill="currentColor" stroke="none"/>',
  notes: '<rect x="4.5" y="3.5" width="15" height="17" rx="2"/><path d="M8 8h8M8 11.5h8M8 15h5"/>',
  pageSetup: '<rect x="5.5" y="3.5" width="13" height="17" rx="1.6"/><path d="M5.5 7.5h13M5.5 16.5h13M9 3.5v17M15 3.5v17" stroke-dasharray="1.4 1.6"/>',
  footnote: '<path d="M4.5 6.5h10M4.5 10.5h10M4.5 14.5h6"/><path d="M17 4.5h2.2v5.5M16.6 10h3"/><path d="M4.5 19h15" stroke-dasharray="1.6 1.6"/>',
  spell: '<path d="m3.5 15 3.5-9 3.5 9M4.7 12h4.6"/><path d="M13 6v9M13 10.2c.4-1.1 1.3-1.7 2.4-1.7 1.6 0 2.6 1.3 2.6 3.2S17 15 15.4 15c-1.1 0-2-.6-2.4-1.7"/><path d="m8 19 2.4 2.2L15.5 17"/>',
  heading: '<path d="M6 5v14M16 5v14M6 12h10"/>',
  person: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c.7-3.5 3.6-5.4 7-5.4s6.3 1.9 7 5.4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8.5-8.5M16.5 6.5l2.5 2.5M14 9l2 2"/>',
  checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="m8.3 12.3 2.5 2.5 5-5.3"/>',
  inbox: '<path d="M4 13.5 6.2 5.6c.2-.7.8-1.1 1.5-1.1h8.6c.7 0 1.3.4 1.5 1.1L20 13.5v4.8c0 .9-.7 1.7-1.7 1.7H5.7c-.9 0-1.7-.8-1.7-1.7z"/><path d="M4 13.5h4.5l1 2h5l1-2H20"/>',
  scale: '<path d="M12 4v16M7 20h10M5 7h14"/><path d="m5 7-2.5 6a2.5 2.5 0 0 0 5 0zM19 7l-2.5 6a2.5 2.5 0 0 0 5 0z"/>',
  euro: '<path d="M17.5 6.5a6.5 6.5 0 1 0 0 11"/><path d="M4.5 10.5h9M4.5 13.5h9"/>',
  bookOpen: '<path d="M12 6.5c-1.8-1.4-4.6-2-8-1.8v13c3.4-.2 6.2.4 8 1.8 1.8-1.4 4.6-2 8-1.8v-13c-3.4-.2-6.2.4-8 1.8zM12 6.5v13"/>',
  transition: '<rect x="3" y="6" width="11" height="12" rx="1.6"/><path d="M17 6.5c1.9 1.2 3 3.2 3 5.5s-1.1 4.3-3 5.5" /><path d="M14 9.5h4.5M16.5 7.5l2 2-2 2"/>',
  handout: '<rect x="5" y="3.5" width="14" height="17" rx="1.6"/><rect x="7.5" y="6" width="9" height="4.5" rx=".8"/><rect x="7.5" y="12.5" width="9" height="4.5" rx=".8"/>',
  phone: '<rect x="6.5" y="2.8" width="11" height="18.4" rx="2.4"/><path d="M10.5 18h3"/>',
  pin: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  // ---- office 2 (Tabellen + Dokumente) ----
  decInc: '<path d="M3.5 17.5h.1"/><path d="M8 9.5a2.5 2.5 0 0 1 5 0v5a2.5 2.5 0 0 1-5 0z"/><path d="M15.5 13h5M18 10.5v5"/>',
  decDec: '<path d="M3.5 17.5h.1"/><path d="M8 9.5a2.5 2.5 0 0 1 5 0v5a2.5 2.5 0 0 1-5 0z"/><path d="M15.5 13h5"/>',
  cellStyles: '<rect x="3.5" y="4" width="7.5" height="7" rx="1.4"/><rect x="13" y="4" width="7.5" height="7" rx="1.4" fill="currentColor" opacity=".35"/><rect x="3.5" y="13" width="7.5" height="7" rx="1.4" fill="currentColor" opacity=".6"/><rect x="13" y="13" width="7.5" height="7" rx="1.4"/>',
  pivot: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M3.5 8.5h17M8.5 3.5v17"/><path d="M12 17.5h5.5M15.5 15.5l2 2-2 2M17.5 12v-1.5"/>',
  names: '<path d="M4.5 7.5h6M4.5 12h4M4.5 16.5h6"/><rect x="12.5" y="5.5" width="8" height="13" rx="1.6"/><path d="M14.8 9.5h3.4M14.8 12.5h3.4"/>',
  protect: '<path d="M12 3.5 5 6.2v5.1c0 4.2 2.9 7.8 7 9.2 4.1-1.4 7-5 7-9.2V6.2z"/><path d="m9.2 12 2 2 3.8-4"/>',
  dedupe: '<rect x="3.5" y="4" width="11" height="6" rx="1.3"/><rect x="3.5" y="14" width="11" height="6" rx="1.3" stroke-dasharray="2 1.8"/><path d="M17 15l4 4M21 15l-4 4"/>',
  textCols: '<path d="M4 5.5h16M4 18.5h16"/><path d="M9 9v6M15 9v6"/><path d="M4 12h3M17 12h3"/>',
  series: '<path d="M4.5 18.5h15"/><path d="M6.5 15.5v3M10.5 12.5v6M14.5 9.5v9M18.5 6.5v12"/>',
  valign: '<path d="M4.5 4.5h15M4.5 19.5h15"/><path d="M12 7.5v9M9 13.5l3 3 3-3"/>',
  indentInc: '<path d="M10.5 6h9M10.5 10h9M10.5 14h9M4.5 18h15"/><path d="m4.5 8 3 2-3 2"/>',
  indentDec: '<path d="M10.5 6h9M10.5 10h9M10.5 14h9M4.5 18h15"/><path d="m7.5 8-3 2 3 2"/>',
  gridlines: '<rect x="3.5" y="3.5" width="17" height="17" rx="1.6" stroke-dasharray="2 2"/><path d="M3.5 9.2h17M3.5 14.8h17M9.2 3.5v17M14.8 3.5v17" stroke-dasharray="2 2"/>',
  fxList: '<path d="M10 5c-1-.8-3-.7-3.4 1.5L5 17c-.3 2-2 2.2-2.6 1.5M3.8 9.5h5"/><path d="M13 7h7.5M13 11h7.5M13 15h7.5M13 19h5"/>',
  freezePanes: '<rect x="3.5" y="3.5" width="17" height="17" rx="1.6"/><path d="M3.5 9h17M9 3.5v17" stroke-width="2.6"/>',
  dateIns: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><path d="M8 13.5h2M12 13.5h2M8 16.5h2"/>',
  timeIns: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  recalc: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.6 4.3v4.4h-4.4"/><path d="M9 10.5h6M9 13.5h6"/>',
  showFormulas: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M8.5 9.5c-.6-.5-1.8-.4-2 .9L6 15c-.2 1.1-1.2 1.2-1.5.8M5.5 11.5h3"/><path d="M12 10.5h6M12 13.5h6"/>',
  filterClear: '<path d="M4 5h16l-6 7.5V19l-4-2v-4.5z"/><path d="M16.5 15l4 4M20.5 15l-4 4"/>',
  sortCustom: '<path d="M6.5 4.5v15M3.5 16.5l3 3 3-3"/><path d="M12 6h8.5M12 10.5h6.5M12 15h4.5"/><circle cx="18.5" cy="17.5" r="2"/>',
  wstyles: '<path d="M5.5 5.5h13M5.5 10h9M5.5 14.5h13M5.5 19h7"/><path d="M3.5 5.5h.1M3.5 10h.1" stroke-width="2.6"/>',
  fontFamily: '<path d="M4 19 9 5l5 14M5.8 14h6.4"/><path d="M15.5 19c0-1.5.7-3 2.5-3s2.5 1.2 2.5 3V13"/>',
  lineSpacing: '<path d="M11 6.5h9M11 12h9M11 17.5h9"/><path d="M5.5 4.5v15M3.3 6.7l2.2-2.2 2.2 2.2M3.3 17.3l2.2 2.2 2.2-2.2"/>',
  superscript: '<path d="m4 8 8 10M12 8l-8 10"/><path d="M15.5 6.5c0-1 .8-1.8 1.9-1.8s1.9.7 1.9 1.6c0 1.5-2.2 2.2-3.8 4.2h4"/>',
  subscript: '<path d="m4 6 8 10M12 6l-8 10"/><path d="M15.5 15.5c0-1 .8-1.8 1.9-1.8s1.9.7 1.9 1.6c0 1.5-2.2 2.2-3.8 4.2h4"/>',
  changeCase: '<path d="M3 18 7.5 6 12 18M4.6 14h5.8"/><path d="M14 13.5c.4-1.2 1.4-1.8 2.6-1.8 1.6 0 2.6 1 2.6 2.6V18M19.2 15.2c-.9-.4-5-.6-5 1.4 0 1.9 3.7 1.9 5-.4"/>',
  painter: '<rect x="4" y="3.5" width="13" height="5.5" rx="1.4"/><path d="M17 6.2h2.5v4.3H11v3"/><rect x="9.5" y="13.5" width="3" height="7" rx="1"/>',
  clearFormat: '<path d="M6 5h12M12 5l-3.5 14"/><path d="m14.5 14 5 5M19.5 14l-5 5"/>',
  multilevel: '<path d="M7.5 6h12M10.5 11h9M13.5 16h6"/><path d="M4 6h.1M7 11h.1M10 16h.1" stroke-width="2.6"/>',
  track: '<path d="M4.5 19.5 6 14.5 15.5 5a2.1 2.1 0 0 1 3 3L9 17.5z"/><path d="M13.5 7l3 3"/><path d="M12 19.5h7.5" stroke-dasharray="2 1.6"/>',
  accept: '<circle cx="12" cy="12" r="8.5"/><path d="m8.2 12.2 2.5 2.5 5-5.2"/>',
  reject: '<circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6M15 9l-6 6"/>',
  columns2: '<rect x="3.5" y="4" width="7.5" height="16" rx="1.4"/><rect x="13" y="4" width="7.5" height="16" rx="1.4"/><path d="M5.5 8h3.5M5.5 11h3.5M15 8h3.5M15 11h3.5"/>',
  sectionBreak: '<path d="M5 4.5h14v5H5zM5 14.5h14v5H5z"/><path d="M3.5 12h3M9.5 12h5M17.5 12h3"/>',
  mailMerge: '<rect x="3.5" y="6" width="17" height="12" rx="2"/><path d="m4.2 7.2 7.8 5.8 7.8-5.8"/><path d="M15 3.5h5.5V9"/>',
  gotoPage: '<path d="M14 3.5H7.2c-.9 0-1.7.8-1.7 1.7v13.6c0 .9.8 1.7 1.7 1.7h9.6c.9 0 1.7-.8 1.7-1.7V8z"/><path d="M14 3.5V8h4.5"/><path d="M9 14h6M12.5 11.5 15 14l-2.5 2.5"/>',
  wordCount: '<path d="M4 6.5h9M4 11h7M4 15.5h9"/><path d="M15.5 18.5v-7l2.5-2 2.5 2v7M15.5 15h5"/>',
  versions: '<path d="M12 7.5v4.6l3 1.8"/><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12H1.8M22.2 12h-1.7"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 9.5h.1M9 9.5h.1M12 9.5h.1M15 9.5h.1M18 9.5h.1M6 12.5h.1M18 12.5h.1M8.5 15h7M9 12.5h6"/>',
  pageView: '<rect x="5" y="2.5" width="14" height="8.5" rx="1"/><rect x="5" y="13" width="14" height="8.5" rx="1"/><path d="M8 6h8M8 16.5h8"/>',
  webView: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M3.5 8h17"/><path d="M7 12h10M7 15.5h7"/>',
  ruler: '<rect x="2.5" y="8" width="19" height="8" rx="1.4"/><path d="M6 8v3M9.5 8v2M13 8v3M16.5 8v2M20 8v3"/>',
  wrapText: '<rect x="3.5" y="5" width="7" height="7" rx="1.2"/><path d="M13.5 6h7M13.5 9.5h7M13.5 13h7M3.5 16.5h17M3.5 20h12"/>',
  altText: '<rect x="3.5" y="4.5" width="17" height="12" rx="2"/><path d="m7 13 3-3.5 2.5 2.5 2-1.5 2.5 2.5"/><path d="M6.5 20h11"/>',
  shapes: '<rect x="3.5" y="11" width="8" height="8.5" rx="1.2"/><circle cx="16.5" cy="7.5" r="4"/><path d="m14 19.5 3-5.5 3.5 5.5z"/>',
  cellMerge: '<rect x="3.5" y="5" width="17" height="14" rx="1.6"/><path d="M7 12h10M9 9.8 6.8 12 9 14.2M15 9.8l2.2 2.2-2.2 2.2"/>',
  cellSplit: '<rect x="3.5" y="5" width="17" height="14" rx="1.6"/><path d="M12 5v14"/><path d="M5.8 12h4M14.2 12h4"/>',
  tableStyle: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.6"/><path d="M3.5 9h17" stroke-width="3"/><path d="M3.5 13.5h17M3.5 17h17" opacity=".6"/>',
  headerRow: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.6"/><rect x="3.5" y="4.5" width="17" height="4.5" rx="1.6" fill="currentColor" opacity=".35"/><path d="M3.5 13.5h17M9 9v10.5M15 9v10.5"/>',
  shading: '<rect x="4" y="4" width="16" height="16" rx="1.6"/><path d="M4 14 14 4M4 20 20 4M10 20l10-10" opacity=".7"/>',
};

/** Icon lookup: office icons first, then the app icon set. */
export function oicon(name, cls = '') {
  const body = P[name];
  if (!body) return icon(name, cls);
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

/** Coloured file-type tile used in lists. */
export function kindTile(kind, { size = '' } = {}) {
  const k = KINDS[kind] || KINDS.pdf;
  return `<span class="kind-tile ${size}" style="--kc:${k.color}">${oicon(k.glyph)}<span class="kind-tag">${k.short}</span></span>`;
}

/** showMenu() with office icons (the shared menu only knows the base icon set). */
export function officeMenu(anchor, items, opts) {
  showMenu(anchor, items, opts);
  const menu = document.querySelector('.menu-layer .menu');
  if (!menu) return;
  const btns = menu.querySelectorAll('.menu-item');
  items.filter(it => it && it !== '-').forEach((it, k) => {
    const svg = btns[k] && btns[k].querySelector('svg');
    if (svg && it.icon) svg.outerHTML = oicon(it.icon);
  });
}
