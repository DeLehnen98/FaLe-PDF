// Hinweis-Karten mit kurzer Animation. Erscheinen jedes Mal, bis die Person „Nicht mehr anzeigen“ wählt;
// „Verstanden“ blendet sie nur für dieses Mal aus.
// - Schwärzen / Abdecken: Fläche legt sich über den Text, der Text darunter verschwindet, Haken
// - Formular mit Gedächtnis: Feld wird ausgefüllt, Schloss (überall fixiert), dann Stift (in FaLe wieder änderbar)
import { h, esc } from '../ui.js';
import { icon } from '../icons.js';

const KEY = kind => `fale-hint-${kind}`;
const hidden = kind => { try { return localStorage.getItem(KEY(kind)) === 'hidden'; } catch { return false; } };

const TEXT = {
  redact: {
    title: 'So funktioniert Schwärzen',
    body: 'Markierte Stellen werden schwarz und endgültig gelöscht – der Text darunter lässt sich danach nicht mehr kopieren oder finden. Seiten mit Markierungen werden dafür als Bild gespeichert. Dein Original bleibt unverändert, FaLe speichert eine neue Datei.',
  },
  cover: {
    title: 'So funktioniert Abdecken',
    body: 'Die Fläche bekommt die Hintergrundfarbe, und was darunter liegt, wird beim Speichern aus der Datei gelöscht – nicht nur verdeckt. Der übrige Text bleibt durchsuchbar. Liegt ein Bild darunter, wird diese Seite als Bild gespeichert. Dein Original bleibt unverändert.',
  },
  memory: {
    title: 'Später in FaLe änderbar',
    body: 'Andere Programme zeigen die PDF fertig ausgefüllt. In FaLe kannst du Einträge und Unterschrift später wieder ändern – einfach die Datei hier wieder öffnen.',
  },
};

function memoryArt() {
  // a form field gets filled in, a lock (fixed for everyone), then a pen (editable again in FaLe)
  return `<svg class="sh-art" viewBox="0 0 132 64" aria-hidden="true" focusable="false">
    <rect class="sh-paper" x="1" y="1" width="130" height="62" rx="8"/>
    <g class="sh-line"><rect x="12" y="12" width="30" height="5" rx="2.5"/><rect x="12" y="46" width="44" height="5" rx="2.5"/></g>
    <rect class="sh-field" x="10" y="24" width="80" height="15" rx="3"/>
    <rect class="sh-type" x="15" y="29" width="58" height="5" rx="2.5"/>
    <g class="sh-lock"><circle cx="112" cy="32" r="11"/><path class="sh-shackle" d="M108.6 30.6v-2.6a3.4 3.4 0 0 1 6.8 0v2.6"/><rect x="106.6" y="30.4" width="10.8" height="7.6" rx="1.6"/></g>
    <g class="sh-pen"><circle cx="112" cy="32" r="11"/><path d="M107 37.2l1-4 7.2-7.2 3 3-7.2 7.2zM113.6 27.6l3 3"/></g>
  </svg>`;
}

function art(kind) {
  if (kind === 'memory') return memoryArt();
  // a line of text, a box that slides over it, the text underneath vanishes (dust), the box turns see-through, a check
  return `<svg class="sh-art" viewBox="0 0 132 64" aria-hidden="true" focusable="false">
    <rect class="sh-paper" x="1" y="1" width="130" height="62" rx="8"/>
    <g class="sh-line"><rect x="12" y="14" width="34" height="5" rx="2.5"/><rect x="50" y="14" width="22" height="5" rx="2.5"/></g>
    <g class="sh-secret"><rect x="12" y="29" width="22" height="7" rx="2"/><rect x="38" y="29" width="30" height="7" rx="2"/><rect x="72" y="29" width="18" height="7" rx="2"/></g>
    <g class="sh-dust"><circle cx="24" cy="32" r="1.6"/><circle cx="50" cy="32" r="1.4"/><circle cx="66" cy="31" r="1.7"/><circle cx="84" cy="33" r="1.3"/></g>
    <rect class="sh-box sh-box-${kind}" x="9" y="25" width="85" height="15" rx="2.5"/>
    <g class="sh-line"><rect x="12" y="47" width="46" height="5" rx="2.5"/></g>
    <g class="sh-check"><circle cx="112" cy="32" r="11"/><path d="M106.5 32.3l3.8 3.8 7.2-8"/></g>
  </svg>`;
}

/**
 * The hint card for `kind` ('redact' | 'cover' | 'memory'), or null when the person chose „Nicht mehr anzeigen“.
 * `actions`: extra buttons (HTML) before „Verstanden“; the caller binds them.
 */
export function safetyHint(kind, { extra = '', actions = '' } = {}) {
  if (hidden(kind) || !TEXT[kind]) return null;
  const t = TEXT[kind];
  const el = h(`<section class="sh-card sh-${kind}" role="note" aria-label="${esc(t.title)}">
    ${art(kind)}
    <div class="sh-text"><strong>${esc(t.title)}</strong><p>${esc(t.body)}${extra ? ' ' + extra : ''}</p>
      <div class="sh-acts">${actions}<button class="btn btn-soft btn-sm" type="button" data-sh-ok>${icon('check')} Verstanden</button>
      <button class="btn btn-ghost btn-sm" type="button" data-sh-never>Nicht mehr anzeigen</button></div></div>
  </section>`);
  const close = never => {
    if (never) { try { localStorage.setItem(KEY(kind), 'hidden'); } catch { /* private mode: hidden for now */ } }
    el.classList.add('sh-out');
    setTimeout(() => el.remove(), 220);
  };
  el.querySelector('[data-sh-ok]').addEventListener('click', () => close(false));
  el.querySelector('[data-sh-never]').addEventListener('click', () => close(true));
  el.close = () => close(false);
  return el;
}
