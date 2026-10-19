// „Einfache Ansicht“ (simple mode): the start screen shows only the essentials as large tiles, Werkzeuge
// starts with a short curated list („Alle Werkzeuge anzeigen“ expands to everything, search always finds
// everything). Nothing is removed – the mode only changes what the main views show first.
// Stored per device (localStorage). It does NOT touch the user's own „KI ausblenden“ setting (js/ai/hidden.js):
// AI entry points on the main views are only hidden by CSS while the mode is on (css/theme-2026.css, html.simple),
// the AI menu entries of the viewer and the editors check aiMenusHidden() (js/ai/hidden.js).
//
// Also here: the text size („Schriftgröße“: Normal / Groß / Sehr groß, html.ts-l / html.ts-xl). It scales the
// root font size, so everything sized in rem grows (the app shell, the tool screens' common parts, dialogs, menus);
// layout widths stay in px, the PDF pages and their coordinates are not affected (see css/theme-2026.css).
//
// While simple mode is on, a small „plain words“ pass rewrites a few technical texts on the first screens of the
// simple-mode tools (e.g. „Komprimieren“ → „PDF verkleinern“) and adds a line to every result card that says
// where the file is now. Tool names stay unchanged everywhere else (tests, store screenshots, search).
import { t } from './i18n/index.js';
import { isNative, isIOSApp } from './platform.js';
import { toast } from './ui.js';

const KEY = 'fale-simple';
const HINT_KEY = 'fale-simple-hint';
const TS_KEY = 'fale-textsize';

const read = k => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode: this session only */ } };
const emit = (name, detail) => { try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch { /* no window */ } };

let on = read(KEY) === '1';
let hintHidden = read(HINT_KEY) === 'hidden';

export function simpleOn() { return on; }

function applyClass() {
  try {
    const c = document.documentElement.classList;
    c.toggle('simple', on);
    c.toggle('ts-l', ts === 'l');
    c.toggle('ts-xl', ts === 'xl');
  } catch { /* no DOM */ }
}

/** Switch the mode; the views follow via the "fale:simple" event (and CSS on html.simple). */
export function setSimple(value) {
  on = !!value;
  write(KEY, on ? '1' : null);
  dismissSimpleHint(); // a decision was made – the start hint is not needed any more
  applyClass();
  plainWatch();
  emit('fale:simple', { on });
}

export function simpleHintHidden() { return hintHidden; }
export function dismissSimpleHint() { hintHidden = true; write(HINT_KEY, 'hidden'); }

/** Call render(el) whenever the mode changes, as long as el is in the document (views are built once). */
export function followSimple(el, render) {
  if (!el || el.dataset.simpleFollow) return;
  el.dataset.simpleFollow = '1';
  window.addEventListener('fale:simple', () => { if (el.isConnected) render(el); });
}

// ---------------------------------------------------------------- text size
export const TEXT_SIZES = [
  { id: 'normal', label: 'Normal' },
  { id: 'l', label: 'Groß' },
  { id: 'xl', label: 'Sehr groß' },
];
const tsValid = v => (v === 'l' || v === 'xl' ? v : 'normal');
let ts = tsValid(read(TS_KEY));

export function textSize() { return ts; }

/** 'normal' | 'l' | 'xl' – stored on this device, applied at once (class on <html>). */
export function setTextSize(value) {
  ts = tsValid(value);
  write(TS_KEY, ts === 'normal' ? null : ts);
  applyClass();
  emit('fale:textsize', { size: ts });
}

/** Three buttons „Normal / Groß / Sehr groß“ (aria-pressed), each with a sample letter in its size. */
export function textSizeSeg(extraClass = '') {
  return `<div class="seg ts-seg ${extraClass}" role="group" aria-label="Schriftgröße">${TEXT_SIZES.map(s =>
    `<button type="button" data-ts-opt="${s.id}" aria-pressed="${s.id === ts}"><span class="ts-a ts-a-${s.id}" aria-hidden="true">A</span><span>${s.label}</span></button>`).join('')}</div>`;
}

/** Wire the buttons made by textSizeSeg() inside root; after(size) runs after every change. */
export function bindTextSize(root, after) {
  const btns = [...root.querySelectorAll('[data-ts-opt]')];
  const sync = () => btns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tsOpt === ts)));
  btns.forEach(b => b.addEventListener('click', () => { setTextSize(b.dataset.tsOpt); sync(); if (after) after(ts); }));
  sync();
  return sync;
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
  { id: 'neu', label: 'Neu erstellen', sub: 'Brief, Tabelle, Folien', icon: 'plus', group: 'bearbeiten', menu: 'new' },
];

export const CONVERT_MENU = [
  { label: 'Fotos zu PDF', icon: 'image', href: '#/werkzeug/bilder' },
  { label: 'Word-Dokument zu PDF', icon: 'kdoc', href: '#/werkzeug/word-pdf' },
  { label: 'Excel-Tabelle zu PDF', icon: 'ksheet', href: '#/werkzeug/excel-pdf' },
  { label: 'PowerPoint-Folien zu PDF', icon: 'kslides', href: '#/werkzeug/ppt-pdf' },
  { label: 'Textdatei zu PDF', icon: 'text', href: '#/werkzeug/text-pdf' },
];

// „Neu erstellen“ in simple mode: only the three kinds of documents (scan / photos / open have their own tiles).
export const NEW_MENU = [
  { label: 'Text-Dokument (z. B. ein Brief)', icon: 'kdoc', href: '#/vorlagen/dokument' },
  { label: 'Tabelle (z. B. Haushaltsbuch)', icon: 'ksheet', href: '#/vorlagen/tabelle' },
  { label: 'Präsentation (Folien)', icon: 'kslides', href: '#/neu/praesentation' },
  { label: 'Aus einer fertigen Vorlage', icon: 'template', href: '#/vorlagen' },
];

// Werkzeuge: the short list shown first in simple mode (ids from js/tools/index.js).
export const SIMPLE_TOOLS = ['unterschreiben', 'scannen', 'bilder', 'zusammenfuegen', 'komprimieren', 'seiten', 'pdf-word', 'word-pdf', 'kommentieren', 'passwort'];

// ---------------------------------------------------------------- plain words on the tool screens
// [selector inside #tool-screen, German text (whole text, or its beginning for long ones), plain German text].
// Every plain text has an English entry in js/i18n/en.js; in English the original is matched via t() too.
const PLAIN = [
  // titles
  ['.screen-title', 'Komprimieren', 'PDF verkleinern'],
  ['.screen-title', 'Scanner', 'Scannen'],
  ['.screen-title', 'Bilder → PDF', 'Fotos zu PDF'],
  // subtitles (tool descriptions)
  ['.screen-head .sub', 'Dateigröße verringern – verlustfrei oder stark.', 'Damit die Datei klein genug für E-Mails ist.'],
  ['.screen-head .sub', 'Fotos und Scans (JPG, PNG) in eine PDF umwandeln – auch mit der Kamera.', 'Aus Fotos eine PDF machen – auch direkt mit der Kamera.'],
  ['.screen-head .sub', 'Mehrere PDFs in der gewünschten Reihenfolge kombinieren.', 'Mehrere PDFs zu einer einzigen PDF verbinden.'],
  ['.screen-head .sub', 'Bearbeitbares Word-Dokument (.docx) mit Absätzen und Überschriften erstellen.', 'Aus einer PDF ein Word-Dokument machen, das du ändern kannst.'],
  ['.screen-head .sub', 'Word-Dokumente (.docx), Text und Markdown als PDF speichern.', 'Ein Word-Dokument als PDF speichern.'],
  ['.screen-head .sub', 'Tabellen (.xlsx, .csv) als druckfertige PDF speichern.', 'Eine Excel-Tabelle als PDF speichern.'],
  ['.screen-head .sub', 'Präsentationen (.pptx) als PDF speichern – eine Seite pro Folie.', 'PowerPoint-Folien als PDF speichern – jede Folie wird eine Seite.'],
  ['.screen-head .sub', 'Textdateien (.txt, .md) als PDF speichern.', 'Eine Textdatei als PDF speichern.'],
  // „Dokument wählen“ (tools that need a document)
  ['.card.intro p', 'Wähle ein Dokument aus deiner Bibliothek oder öffne eine PDF von deinem Gerät.', 'Tippe unten auf eine deiner Dateien – oder hol eine PDF mit „Vom Gerät öffnen“ von deinem Gerät.'],
  // first screens
  ['.card.intro p', 'Fotografiere deine Seiten – Kanten werden automatisch erkannt, die Seite entzerrt und lesbar gemacht.', 'Halte das Handy über das Papier und mach ein Foto. FaLe schneidet die Seite gerade und macht daraus eine PDF.'],
  ['.card.intro p', 'Wähle Fotos oder Scans aus (JPG, PNG, WebP). Jedes Bild wird zu einer Seite. Auf dem Handy kannst du direkt die Kamera nutzen.', 'Wähle Fotos aus oder mach ein neues Foto. Jedes Foto wird eine Seite der PDF.'],
  ['.card.intro p', 'Word-Dokumente (.docx), Text und Markdown als PDF speichern.', 'Wähle ein Word-Dokument. FaLe macht daraus eine PDF – direkt auf deinem Gerät.'],
  ['.card.intro p', 'Tabellen (.xlsx, .csv) als druckfertige PDF speichern.', 'Wähle eine Excel-Tabelle. FaLe macht daraus eine PDF – direkt auf deinem Gerät.'],
  ['.card.intro p', 'Präsentationen (.pptx) als PDF speichern – eine Seite pro Folie.', 'Wähle eine PowerPoint-Datei. FaLe macht daraus eine PDF – direkt auf deinem Gerät.'],
  ['.card.intro p', 'Textdateien (.txt, .md) als PDF speichern.', 'Wähle eine Textdatei. FaLe macht daraus eine PDF – direkt auf deinem Gerät.'],
  ['.card.intro p', 'Wandelt die PDF in ein Word-Dokument (.docx) um – direkt auf deinem Gerät.', 'Aus dieser PDF wird ein Word-Dokument, das du ändern kannst – direkt auf deinem Gerät.'],
  ['.convert-pick .muted', 'Word-Dokument (.docx), Text oder Markdown', 'Zum Beispiel ein Brief aus Word'],
  ['.convert-pick .muted', 'Textdatei (.txt) oder Markdown (.md)', 'Zum Beispiel eine Notiz (.txt)'],
  ['.convert-pick .muted', 'Excel-Tabelle (.xlsx) oder CSV', 'Zum Beispiel eine Liste aus Excel'],
  ['.convert-pick .muted', 'PowerPoint-Präsentation (.pptx)', 'Zum Beispiel Folien aus PowerPoint'],
  // PDF verkleinern: two choices in everyday words
  ['.radio-card strong', 'Verlustfrei', 'Etwas kleiner'],
  ['.radio-card strong', 'Stark', 'Viel kleiner'],
  ['.radio-card > span > span', 'Optimiert die Dateistruktur und packt unkomprimierte Daten. Text, Links und Formulare bleiben unverändert.', 'Die PDF sieht genau gleich aus, Text bleibt markierbar. Die Datei wird meist nur etwas kleiner.'],
  ['.radio-card > span > span', 'Wandelt jede Seite in ein JPEG-Bild um. Ideal für Scans und Fotos – deutlich kleinere Dateien.', 'Jede Seite wird zu einem Bild. Gut für eingescannte Briefe und Fotos – die Datei wird viel kleiner.'],
  ['.screen-foot [data-run]', 'Komprimieren', 'Jetzt verkleinern'],
  ['.result-title', 'Komprimiert', 'Fertig verkleinert'],
  // PDF zu Word
  ['.radio-card strong', 'Layout exakt', 'Genau wie das Original'],
  // Text erkennen (OCR)
  ['.screen-title', 'Text erkennen (OCR)', 'Text aus Fotos holen'],
  ['.screen-head .sub', 'Text aus Fotos, Scans und Bild-PDFs', 'Zum Kopieren oder als Word-Datei'],
  ['.card.intro strong', 'Text erkennen (OCR)', 'Text aus Fotos holen'],
  ['.card.intro p', 'Erkennt Text in Fotos, Scans und PDF-Seiten ohne Textebene – als bearbeitbarer Text, Word-Datei oder durchsuchbare PDF.', 'Mach ein Foto von einem Brief oder wähle eines aus. FaLe liest den Text heraus – zum Kopieren, Teilen oder als Word-Datei.'],
];

const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
const matches = (cur, from) => {
  if (!cur) return false;
  const tr = t(from);
  if (cur === from || cur === tr) return true;
  return from.length > 30 && (cur.startsWith(from) || (tr !== from && cur.startsWith(tr)));
};

function whereText(inLibrary) {
  let dl = 'Mit „Herunterladen“ kommt eine Kopie in den Ordner „Downloads“ deines Geräts.';
  let dlOnly = 'Noch nicht auf deinem Gerät gespeichert: Tippe auf „Herunterladen“ – dann liegt die Datei im Ordner „Downloads“.';
  if (isNative()) {
    if (isIOSApp()) {
      dl = 'Mit „Herunterladen“ kommt eine Kopie in die App „Dateien“, Ordner „FaLe PDF“.';
      dlOnly = 'Noch nicht gespeichert: Tippe auf „Herunterladen“ – dann liegt die Datei in der App „Dateien“, Ordner „FaLe PDF“.';
    } else {
      dl = 'Mit „Herunterladen“ kommt eine Kopie in den Ordner „Dokumente“ › „FaLe PDF“.';
      dlOnly = 'Noch nicht gespeichert: Tippe auf „Herunterladen“ – dann liegt die Datei im Ordner „Dokumente“ › „FaLe PDF“.';
    }
  }
  return inLibrary ? [t('Fertig! Die Datei ist in FaLe unter „Dateien“ gespeichert.'), t(dl)] : [t(dlOnly)];
}

function plainPass() {
  const root = document.getElementById('tool-screen');
  if (!on || !root || root.hidden) return;
  for (const [sel, from, to] of PLAIN) {
    for (const el of root.querySelectorAll(sel)) {
      if (matches(norm(el.textContent), from)) setText(el, t(to));
    }
  }
  for (const card of root.querySelectorAll('.result-card:not([data-simple-where])')) {
    card.dataset.simpleWhere = '1';
    const lines = whereText(!!card.querySelector('[data-r="open"]'));
    const note = document.createElement('p');
    note.className = 'simple-where';
    lines.forEach((l, i) => { if (i) note.appendChild(document.createElement('br')); note.appendChild(document.createTextNode(l)); });
    card.appendChild(note);
  }
}

// keeps icons: only the (last) text node changes when the element has child elements
function setText(el, text) {
  if (!el.firstElementChild) { el.textContent = text; return; }
  const nodes = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
  if (!nodes.length) return;
  nodes.slice(0, -1).forEach(n => n.remove());
  nodes[nodes.length - 1].textContent = ` ${text}`;
}

let mo = null, queued = false;
function plainWatch() {
  const root = typeof document !== 'undefined' && document.getElementById('tool-screen');
  if (!root) return;
  if (!on) { if (mo) { mo.disconnect(); mo = null; } return; }
  if (mo) return;
  mo = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; plainPass(); });
  });
  mo.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
  plainPass();
}

// Downloads in the browser give no feedback of their own – in simple mode say where the file went.
function onDownloadClick(e) {
  if (!on || !e.target.closest || !e.target.closest('.result-card [data-r="dl"]')) return;
  if (isNative()) return; // the app shows „Gespeichert in …“ itself
  setTimeout(() => toast(t('Heruntergeladen. Du findest die Datei im Ordner „Downloads“ deines Geräts.'), 'success', { timeout: 8000 }), 0);
}

applyClass(); // before the first render (views.js imports this module, app.js imports views.js)
try {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', plainWatch, { once: true });
  else plainWatch();
  document.addEventListener('click', onDownloadClick);
} catch { /* no DOM (tests) */ }
