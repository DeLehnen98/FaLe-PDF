// „Einfache Ansicht“ (simple mode): the start screen shows only the essentials as large tiles, Werkzeuge
// starts with a short curated list („Alle Werkzeuge anzeigen“ expands to everything, search always finds
// everything). Nothing is removed – the mode only changes what the main views show first.
// Stored per device (localStorage). It does NOT touch the user's own „KI ausblenden“ setting (js/ai/hidden.js):
// AI entry points on the main views are only hidden by CSS while the mode is on (css/theme-2026.css, html.simple).
const KEY = 'fale-simple';
const HINT_KEY = 'fale-simple-hint';

const read = k => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode: this session only */ } };

let on = read(KEY) === '1';
let hintHidden = read(HINT_KEY) === 'hidden';

export function simpleOn() { return on; }

function applyClass() { try { document.documentElement.classList.toggle('simple', on); } catch { /* no DOM */ } }

/** Switch the mode; the views follow via the "fale:simple" event (and CSS on html.simple). */
export function setSimple(value) {
  on = !!value;
  write(KEY, on ? '1' : null);
  dismissSimpleHint(); // a decision was made – the start hint is not needed any more
  applyClass();
  try { window.dispatchEvent(new CustomEvent('fale:simple', { detail: { on } })); } catch { /* no window */ }
}

export function simpleHintHidden() { return hintHidden; }
export function dismissSimpleHint() { hintHidden = true; write(HINT_KEY, 'hidden'); }

/** Call render(el) whenever the mode changes, as long as el is in the document (views are built once). */
export function followSimple(el, render) {
  if (!el || el.dataset.simpleFollow) return;
  el.dataset.simpleFollow = '1';
  window.addEventListener('fale:simple', () => { if (el.isConnected) render(el); });
}

// Start screen tiles: the tasks people need most (open, scan, sign, merge, shrink, convert, edit text, create).
export const SIMPLE_HOME = [
  { id: 'open', label: 'Datei öffnen', sub: 'PDF, Word, Excel, Fotos', icon: 'upload', group: 'lesen', action: 'open-file' },
  { id: 'scannen', label: 'Scannen', sub: 'Papier mit der Kamera', icon: 'scan', group: 'scannen', href: '#/werkzeug/scannen' },
  { id: 'unterschreiben', label: 'Ausfüllen & unterschreiben', sub: 'Formulare und Unterschrift', icon: 'sign', group: 'bearbeiten', href: '#/werkzeug/unterschreiben' },
  { id: 'zusammenfuegen', label: 'Zusammenfügen', sub: 'Mehrere PDFs zu einer', icon: 'merge', group: 'organisieren', href: '#/werkzeug/zusammenfuegen' },
  { id: 'komprimieren', label: 'PDF verkleinern', sub: 'Für E-Mail und Upload', icon: 'compress', group: 'organisieren', href: '#/werkzeug/komprimieren' },
  { id: 'umwandeln', label: 'In PDF umwandeln', sub: 'Fotos, Word, Excel …', icon: 'image', group: 'konvertieren', menu: 'convert' },
  { id: 'pdf-word', label: 'PDF zu Word', sub: 'Text weiter bearbeiten', icon: 'word', group: 'konvertieren', href: '#/werkzeug/pdf-word' },
  { id: 'neu', label: 'Neu erstellen', sub: 'Dokument, Tabelle, Folien', icon: 'plus', group: 'bearbeiten', menu: 'new' },
];

export const CONVERT_MENU = [
  { label: 'Fotos zu PDF', icon: 'image', href: '#/werkzeug/bilder' },
  { label: 'Word zu PDF', icon: 'kdoc', href: '#/werkzeug/word-pdf' },
  { label: 'Excel zu PDF', icon: 'ksheet', href: '#/werkzeug/excel-pdf' },
  { label: 'PowerPoint zu PDF', icon: 'kslides', href: '#/werkzeug/ppt-pdf' },
  { label: 'Text zu PDF', icon: 'text', href: '#/werkzeug/text-pdf' },
];

// Werkzeuge: the short list shown first in simple mode (ids from js/tools/index.js).
export const SIMPLE_TOOLS = ['unterschreiben', 'scannen', 'bilder', 'zusammenfuegen', 'komprimieren', 'seiten', 'pdf-word', 'word-pdf', 'kommentieren', 'passwort'];

applyClass(); // before the first render (views.js imports this module, app.js imports views.js)
