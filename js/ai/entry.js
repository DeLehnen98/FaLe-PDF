// Small, network-free entry points for the main views (Start, Werkzeuge, Ich).
import { h, esc } from '../ui.js';
import { oicon } from '../office/kinds.js';
import { loadAiCss } from './ui.js';
import * as C from './client.js';

export const AI_FEATURES = [
  { id: 'chat', title: 'Chat mit Dokument', desc: 'Fragen stellen – Antworten mit klickbaren Seitenangaben.', icon: 'comment', href: '#/ki/chat', doc: true },
  { id: 'zusammenfassen', title: 'Zusammenfassen', desc: 'Kurz, ausführlich oder als Stichpunkte.', icon: 'summary', href: '#/ki/zusammenfassen', doc: true },
  { id: 'uebersetzen', title: 'Übersetzen', desc: 'Dokumente und Texte in über 20 Sprachen – als Word, Text oder PDF.', icon: 'translate', href: '#/ki/uebersetzen', doc: true },
  { id: 'folien', title: 'Folien per KI', desc: 'Thema oder Text rein – fertige Präsentation mit Design.', icon: 'kslides', href: '#/ki/folien', doc: true },
  { id: 'lernkarten', title: 'Lernkarten & Quiz', desc: 'Aus Skripten lernen – mit Wiederholung im richtigen Abstand.', icon: 'bookOpen', href: '#/ki/lernkarten', doc: true },
  { id: 'brief', title: 'Brief per KI', desc: 'Anliegen in eigenen Worten – Brief nach DIN 5008.', icon: 'letter', href: '#/ki/brief' },
  { id: 'bild', title: 'Bild übersetzen', desc: 'Foto von Schild, Speisekarte oder Schreiben übersetzen.', icon: 'camera', href: '#/ki/bild' },
  { id: 'schreibhilfe', title: 'Schreibhilfe', desc: 'Im Dokument-Editor: Text markieren → ⋮ → KI-Schreibhilfe.', icon: 'edit', href: '#/neu/dokument' },
  { id: 'formel', title: 'Formel-Assistent', desc: 'In Tabellen: beschreiben, was du ausrechnen willst → ⋮ → Formel-Assistent.', icon: 'fx', href: '#/neu/tabelle' },
];

/** Card on the start page (no network). */
export function renderStartCard(box) {
  if (!box) return;
  loadAiCss();
  box.hidden = false;
  box.innerHTML = '';
  box.appendChild(h(`<a class="card ai-start-card" href="#/ki"><span class="ai-start-ic">${oicon('sparkle')}</span>
    <span class="ai-start-text"><strong>KI-Assistent</strong><span>Frag deine Dokumente, fasse zusammen, übersetze – nur wenn du es möchtest.</span></span>
    <span class="ai-start-go">${oicon('chevronRight')}</span></a>`));
}

/** "KI-Assistent" section on the Werkzeuge page. */
export function renderToolSection(sec) {
  if (!sec || sec.dataset.filled) return;
  loadAiCss();
  sec.dataset.filled = '1';
  sec.hidden = false;
  sec.innerHTML = `<h2 class="section-title">KI-Assistent <a class="btn btn-sm btn-ghost" href="#/ki">${oicon('sparkle')} Übersicht</a></h2><div class="tool-grid ai-grid"></div>
    <p class="muted small ai-tools-note">${oicon('shield')}<span>Cloud-KI nur nach deiner Zustimmung – gesendet wird nur, was du auswählst. Täglich einige Anfragen gratis.</span></p>`;
  const grid = sec.querySelector('.ai-grid');
  AI_FEATURES.forEach(f => grid.appendChild(h(`<a class="tool-card" href="${f.href}" data-tool="ai-${f.id}"><span class="tile-ic ai-ic">${oicon(f.icon)}</span><span class="tc-text"><h3>${esc(f.title)}</h3><p>${esc(f.desc)}</p></span></a>`)));
}

/** Status card on "Ich" (only cached state – no network). */
export function renderMeCard(box) {
  if (!box) return;
  loadAiCss();
  const q = C.cachedQuota();
  const status = C.cloudDisabled() ? 'Cloud-KI ausgeschaltet' : !C.hasConsent() ? 'Noch nicht eingerichtet – täglich einige Anfragen gratis'
    : q ? (q.plus ? `FaLe Plus aktiv · heute noch ${q.remaining} von ${q.limit}` : `Heute noch ${q.remaining} von ${q.limit} gratis`) + (q.scope === 'account' ? ' · für dein Konto' : '') : 'Eingerichtet';
  box.innerHTML = '';
  box.appendChild(h(`<div class="ai-me">
    <a class="action-card" href="#/ki"><span class="tile-ic ai-ic">${oicon('sparkle')}</span><span><strong>KI-Assistent</strong><span class="muted small" data-ai-me-status>${esc(status)}</span></span></a>
    <a class="action-card" href="#/ki/plus"><span class="tile-ic">${oicon('star')}</span><span><strong>FaLe Plus</strong><span class="muted small">${q && q.plus ? 'Aktiv – danke!' : 'Mehr KI pro Tag, freiwillig'}</span></span></a>
    <a class="action-card" href="#/ki/einstellungen"><span class="tile-ic">${oicon('sliders')}</span><span><strong>KI-Einstellungen</strong><span class="muted small">Cloud-KI an/aus, Datenschutz</span></span></a></div>`));
}
