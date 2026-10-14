// Stand-ins for the FaLe PDF app modules that the synced office readers/writers import
// (lib/shared/office/* – see scripts/sync-webtools-vendor.mjs): ../ui.js, ../security.js, ../pdflib.js,
// ../icons.js. Only what those modules really use on the conversion path is implemented; the dialog
// helpers (toast, openDialog, showMenu, icon) are inert because the web tools never open app dialogs.
import { LIMITS } from './shared/limits.js';
import { loadPdfLib } from './pdf.js';
import { installDomParserFallback, parseHtmlString } from './conv-domparse.js';

installDomParserFallback();

export { LIMITS, loadPdfLib };

/** Friendly error of the app (German text). The web tools add an English text where they catch it. */
export class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
    this.userMessage = { de: message, en: null };
  }
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** HTML string → first element (inert, via the safe parser). */
export function h(html) {
  const body = parseHtmlString(String(html).trim()).body;
  return document.adoptNode(body.firstElementChild || body);
}

export function toast() { /* no toasts in the web tools */ }
export function openDialog() { throw new Error('dialogs are not available in the web tools'); }
export function showMenu() { /* not used */ }
export function icon() { return ''; }
