// Hinweis-Karte „Was passiert mit dem Inhalt darunter?“ für Schwärzen und Abdecken – mit kurzer Animation
// (Fläche legt sich über den Text, der Text darunter verschwindet, Haken). Erscheint jedes Mal, bis die Person
// „Nicht mehr anzeigen“ wählt; „Verstanden“ blendet sie nur für dieses Mal aus.
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
};

function art(kind) {
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

/** The hint card for `kind` ('redact' | 'cover'), or null when the person chose „Nicht mehr anzeigen“. */
export function safetyHint(kind, { extra = '' } = {}) {
  if (hidden(kind) || !TEXT[kind]) return null;
  const t = TEXT[kind];
  const el = h(`<section class="sh-card sh-${kind}" role="note" aria-label="${esc(t.title)}">
    ${art(kind)}
    <div class="sh-text"><strong>${esc(t.title)}</strong><p>${esc(t.body)}${extra ? ' ' + extra : ''}</p>
      <div class="sh-acts"><button class="btn btn-soft btn-sm" type="button" data-sh-ok>${icon('check')} Verstanden</button>
      <button class="btn btn-ghost btn-sm" type="button" data-sh-never>Nicht mehr anzeigen</button></div></div>
  </section>`);
  const close = never => {
    if (never) { try { localStorage.setItem(KEY(kind), 'hidden'); } catch { /* private mode: hidden for now */ } }
    el.classList.add('sh-out');
    setTimeout(() => el.remove(), 220);
  };
  el.querySelector('[data-sh-ok]').addEventListener('click', () => close(false));
  el.querySelector('[data-sh-never]').addEventListener('click', () => close(true));
  return el;
}
