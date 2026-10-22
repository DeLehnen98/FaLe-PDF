// Small, network-free entry points for the main views (Start, Werkzeuge, Ich).
import { showPlus, proActive, videosHere } from '../monetize.js';
import { h, esc } from '../ui.js';
import { oicon } from '../office/kinds.js';
import { loadAiCss } from './ui.js';
import * as C from './client.js';
import { aiHidden } from './hidden.js';
import { blocked as companyBlocked } from '../policy.js';
import { platformName } from '../platform.js';

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
// the start page and Werkzeuge are built once – follow the „KI ausblenden“ switch afterwards
function follow(el, render) {
  if (el.dataset.aiFollow) return;
  el.dataset.aiFollow = '1';
  window.addEventListener('fale:ai-state', () => { if (el.isConnected) render(el); });
}

export function renderStartCard(box) {
  if (!box) return;
  follow(box, renderStartCard);
  if (aiHidden()) { box.hidden = true; box.innerHTML = ''; return; }
  loadAiCss();
  box.hidden = false;
  box.innerHTML = '';
  box.appendChild(h(`<a class="card ai-start-card" href="#/werkzeuge/ki"><span class="ai-start-ic">${oicon('sparkle')}</span>
    <span class="ai-start-text"><strong>KI-Werkzeuge</strong><span>Frag deine Dokumente, fasse zusammen, übersetze – nur wenn du es möchtest.</span></span>
    <span class="ai-start-go">${oicon('chevronRight')}</span></a>`));
}

/** "KI-Assistent" section on the Werkzeuge page. */
export function renderToolSection(sec) {
  if (!sec) return;
  follow(sec, renderToolSection);
  if (aiHidden()) { sec.hidden = true; return; }
  if (sec.dataset.filled) { sec.hidden = false; return; }
  loadAiCss();
  sec.dataset.filled = '1';
  sec.hidden = false;
  sec.innerHTML = `<div class="ai-access" data-ai-access></div><h2 class="section-title">KI-Werkzeuge</h2><div class="tool-grid ai-grid"></div>
    <p class="muted small ai-tools-note">${oicon('shield')}<span>Cloud-KI nur nach deiner Zustimmung – gesendet wird nur, was du auswählst.</span></p>`;
  paintAccess(sec.querySelector('[data-ai-access]'));
  if (!sec.dataset.accessWatch) { sec.dataset.accessWatch = '1'; window.addEventListener('fale:ai-quota', () => paintAccess(sec.querySelector('[data-ai-access]'))); }
  const grid = sec.querySelector('.ai-grid');
  AI_FEATURES.forEach(f => grid.appendChild(h(`<a class="tool-card" href="${f.href}" data-tool="ai-${f.id}"><span class="tile-ic ai-ic">${oicon(f.icon)}</span><span class="tc-text"><h3>${esc(f.title)}</h3><p>${esc(f.desc)}</p></span></a>`)));
}

/** Status card on "Ich" (only cached state – no network). */
// a row of the grouped list on „Ich“ (same markup as ilRow in js/views.js)
const meRow = (href, ic, tone, title, sub) => `<a class="il-row" href="${href}"><span class="il-ic" data-tone="${tone}">${oicon(ic)}</span>
  <span class="il-txt"><strong>${title}</strong><span>${sub}</span></span><span class="il-go" aria-hidden="true">${oicon('chevronRight')}</span></a>`;

export function renderMeCard(box) {
  if (!box) return;
  loadAiCss();
  if (aiHidden()) {
    box.innerHTML = '';
    if (companyBlocked('cloudAi')) return; // the „Von deiner Firma eingestellt“ card says it
    box.appendChild(h(`<nav class="ilist ai-me" aria-label="KI-Assistent">${meRow('#/ki/einstellungen', 'sliders', 'ink', 'KI ist ausgeblendet', 'Wieder einblenden in den KI-Einstellungen')}</nav>`));
    return;
  }
  const q = C.cachedQuota();
  const status = C.cloudDisabled() ? 'Cloud-KI ausgeschaltet' : accessText(q) + (q && q.scope === 'account' ? ' · für dein Konto' : '');
  box.innerHTML = '';
  box.appendChild(h(`<div class="ai-me-wrap"><h2 class="section-title">KI-Assistent</h2><nav class="ilist ai-me" aria-label="KI-Assistent">
    ${meRow('#/ki', 'sparkle', 'ai', 'KI-Assistent', `<span data-ai-me-status>${esc(status)}</span>`)}
    ${showPlus() || proActive() ? meRow('#/ki/pro', 'star', 'amber', 'FaLe Pro', proActive() ? 'Aktiv – alle KI-Werkzeuge ohne Video, werbefrei' : 'KI ohne Videos, keine Werbung') : ''}
    ${meRow('#/ki/einstellungen', 'sliders', 'slate', 'KI-Einstellungen', 'Cloud-KI an/aus, Datenschutz')}</nav></div>`));
}

// ---------------------------------------------------------------- KI access: FaLe Pro, videos
/** One line: how this person can use the cloud AI right now. */
export function accessText(q = C.cachedQuota()) {
  if (proActive() || (q && q.plus)) return 'FaLe Pro aktiv – alle KI-Werkzeuge ohne Video';
  const n = q ? q.remaining || 0 : 0;
  if (n > 0) return n === 1 ? '1 KI-Anfrage freigeschaltet' : `${n} KI-Anfragen freigeschaltet`;
  if (videosHere()) return 'Ohne Pro: ein kurzes Video pro KI-Anfrage';
  return platformName() === 'ios' ? 'Die Cloud-KI kommt bald auch aufs iPhone' : 'Die Cloud-KI gibt es in der FaLe-App für Android';
}

/** The box above the KI tools: how access works, in one calm card. */
function paintAccess(box) {
  if (!box) return;
  const q = C.cachedQuota();
  const pro = proActive() || (q && q.plus);
  const n = q && !pro ? q.remaining || 0 : 0;
  let body;
  if (pro) body = `<strong>Alle KI-Werkzeuge ohne Video</strong><span>Mit FaLe Pro – danke für deine Unterstützung!</span>`;
  else if (videosHere()) body = `<strong>${n > 0 ? esc(accessText(q)) : 'So nutzt du die KI ohne Pro'}</strong><span>Für jede KI-Anfrage schaust du ein kurzes Video – bitte bis zum Ende. Wird es abgebrochen oder die App geschlossen, gibt es keine Freischaltung.</span>`;
  else if (platformName() === 'ios') body = `<strong>Die Cloud-KI kommt bald auch aufs iPhone</strong><span>Alle anderen Werkzeuge funktionieren schon – direkt auf deinem iPhone.</span>`;
  else body = `<strong>Die Cloud-KI gibt es in der FaLe-App für Android</strong><span>Zusammenfassen und Übersetzen laufen in manchen Browsern auch direkt auf dem Gerät.</span>`;
  box.innerHTML = `<div class="card ai-access-card${pro ? ' is-pro' : ''}"><span class="ai-access-ic">${oicon(pro ? 'checkCircle' : videosHere() ? 'play' : 'info')}</span><div>${body}</div></div>`;
}

/** „Auf Pro upgraden“ bar on top of both tool pages (Android app) – or „FaLe Pro ist aktiv“ once bought. */
export function renderProBar(box) {
  if (!box) return;
  loadAiCss();
  const paint = () => {
    if (!box.isConnected) return;
    const pro = proActive();
    if (!pro && (!showPlus() || aiHidden())) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = pro
      ? `<a class="pro-bar is-on" href="#/ki/pro" data-pro-state="on"><span class="pro-tag" data-no-i18n>PRO</span><span class="pro-bar-txt"><strong>FaLe Pro ist aktiv</strong><span>Alle KI-Werkzeuge ohne Video · werbefrei</span></span><span class="pro-bar-go">${oicon('chevronRight')}</span></a>`
      : `<a class="pro-bar" href="#/ki/pro" data-pro-state="off"><span class="pro-bar-ic">${oicon('star')}</span><span class="pro-bar-txt"><strong>Auf Pro upgraden</strong><span>Alle KI-Werkzeuge ohne Video · keine Werbung</span></span><span class="pro-bar-cta">Ansehen</span></a>`;
  };
  paint();
  if (!box.dataset.watch) {
    box.dataset.watch = '1';
    ['fale:ai-quota', 'fale:plus', 'fale:ai-state'].forEach(ev => window.addEventListener(ev, paint));
  }
}
