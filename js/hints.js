// Tipps beim ersten Besuch: a small speech bubble points at one thing and says in one sentence what it does.
// One bubble at a time, at most three per page, each tip only once. Never blocks the page: everything stays usable,
// „Verstanden“ closes it, „Keine Tipps mehr“ switches all tips off (Ich → Einstellungen → „Tipps“ turns them on again).
// Skipped while the intro, a dialog or a menu is open, and in automated test browsers (unless fale-hints-force).
import { $, h, esc } from './ui.js';

const SEEN = 'fale-hints-seen';
const OFF = 'fale-hints-off';
const MAX_PER_PAGE = 3;

const ls = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del: k => { try { localStorage.removeItem(k); } catch { /* private mode */ } },
};
function seenList() { try { const v = JSON.parse(ls.get(SEEN) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
const isSeen = id => { const s = seenList(); return s.includes(id) || s.includes('*'); };
function markSeen(id) { const s = seenList(); if (!s.includes(id)) { s.push(id); ls.set(SEEN, JSON.stringify(s)); } }

export const hintsOn = () => ls.get(OFF) !== '1';
export function setHintsOn(on) { if (on) ls.del(OFF); else { ls.set(OFF, '1'); closeHint(); } }
/** „Alle Tipps wieder zeigen“ */
export function resetHints() { ls.del(SEEN); ls.del(OFF); }

// Pro mark explained only where FaLe Pro is offered (Android app) – js/monetize.js
let proOffered = () => false;
import('./monetize.js').then(m => { proOffered = () => m.showPlus() || m.proActive(); }).catch(() => {});

/** Tips per place. sel: what the bubble points at (the first visible match); if: extra condition. */
const HINTS = {
  start: [
    { id: 'start-open', sel: '#view-start [data-action="open-file"]', text: 'Hier öffnest du PDFs, Word-Dateien und Fotos von deinem Gerät.' },
    { id: 'start-search', sel: '#home-search', text: 'Die Suche findet jede Datei – auch Wörter im Text – und jede Funktion.' },
    { id: 'nav-tools', sel: '[data-nav="werkzeuge"]', text: 'Unter „Werkzeuge“ findest du alles zum Bearbeiten, Umwandeln und Unterschreiben.' },
  ],
  dateien: [
    { id: 'files-more', sel: '#view-dateien [data-files] .doc .more-btn', text: 'Tippe auf ⋮ für alle Aktionen: umbenennen, unterschreiben, teilen, in einen Ordner legen.' },
    { id: 'files-star', sel: '#view-dateien [data-files] .doc .star-btn', text: 'Mit dem Stern markierst du wichtige Dateien. Du findest sie auf der Startseite unter „Markiert“.' },
    { id: 'files-folder', sel: '#view-dateien [data-newfolder]', text: 'Mit Ordnern hältst du Ordnung, zum Beispiel „Steuer“ oder „Versicherung“.' },
  ],
  werkzeuge: [
    { id: 'tools-areas', sel: '#view-werkzeuge [data-cats]', text: 'Wähle einen Bereich – oder suche oben direkt nach dem, was du tun möchtest.' },
    { id: 'tools-ki', sel: '#view-werkzeuge [data-tab-link="ki"]', text: 'Hier sind die KI-Werkzeuge: Briefe einfach erklären, zusammenfassen, übersetzen.' },
    { id: 'tools-pro', sel: '#view-werkzeuge [data-pro-bar] .pro-bar', if: () => proOffered(), text: 'Was mit PRO markiert ist, gehört zu FaLe Pro. Alle PDF-Funktionen bleiben kostenlos.' },
  ],
  einstellungen: [
    { id: 'me-settings', sel: '#view-einstellungen [data-me-sub="allgemein"]', text: 'Hier stellst du Sprache, Schriftgröße und Aussehen ein – und schaltest diese Tipps aus oder wieder an.' },
  ],
  viewer: [
    { id: 'viewer-more', sel: '#viewer [data-v="more"]', text: 'Alle Aktionen für dieses Dokument: oben Unterschreiben und Text einfügen, darunter nach Themen sortiert.' },
    { id: 'viewer-mark', sel: '#viewer [data-v="mark"]', text: 'Ein Lesezeichen merkt sich die Seite. Beim nächsten Öffnen findest du sie schnell wieder.' },
  ],
  office: [
    { id: 'office-title', sel: '.screen:not([hidden]) .office-head .title-btn', text: 'Tippe auf den Namen, um die Datei umzubenennen.' },
    { id: 'office-more', sel: '.screen:not([hidden]) [data-office-more]', text: 'Hier speicherst du als PDF, teilst und lädst herunter.' },
  ],
  tool: [
    { id: 'tool-back', sel: '.screen:not([hidden]) .screen-head [data-back]', text: 'Mit dem Pfeil kommst du jederzeit zurück. Deine Dateien bleiben erhalten.' },
  ],
};

let bubble = null, target = null, timer = 0, tries = 0, queue = [], shownHere = 0, place = '', raf = 0;

function visible(el) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return false;
  if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[hidden]');
}
function firstVisible(sel) { for (const el of document.querySelectorAll(sel)) if (visible(el)) return el; return null; }

/** Where are we? viewer / office editor / tool screen / one of the main pages. */
function currentPlace() {
  const v = document.getElementById('viewer');
  if (v && !v.hidden) return 'viewer';
  if (document.querySelector('.screen:not([hidden]) [data-office-more]')) return 'office';
  if (/^#\/werkzeug\//.test(location.hash) && document.querySelector('.screen:not([hidden]) .screen-head [data-back]')) return 'tool';
  if (document.querySelector('.screen:not([hidden])')) return ''; // other screens (KI, Teilen …): no tips
  return document.body.dataset.view || '';
}

const blocked = () => !!document.querySelector('.onboard, dialog[open], .menu-layer, .ai-sheet, .ftip');

function schedule(delay = 1200) {
  clearTimeout(timer);
  timer = setTimeout(run, delay);
}

function run() {
  if (!hintsOn()) return;
  if (navigator.webdriver && ls.get('fale-hints-force') !== '1') return;
  if (document.visibilityState === 'hidden') return;
  if (blocked()) { if (++tries < 8) schedule(2000); return; }
  tries = 0;
  const p = currentPlace();
  if (p !== place) { place = p; shownHere = 0; }
  if (!p || shownHere >= MAX_PER_PAGE) return;
  queue = (HINTS[p] || []).filter(x => !isSeen(x.id) && (!x.if || x.if()));
  next();
}

function next() {
  while (queue.length) {
    const x = queue.shift();
    const el = firstVisible(x.sel);
    if (!el) continue; // not on screen right now – maybe next time
    const left = Math.min(queue.filter(q => firstVisible(q.sel)).length, MAX_PER_PAGE - shownHere - 1);
    show(x, el, shownHere + 1, shownHere + 1 + left);
    return;
  }
}

function show(x, el, n, total) {
  closeHint();
  markSeen(x.id); // each tip only once – even when the page is left without „Verstanden“
  shownHere++;
  target = el;
  target.classList.add('ftip-target');
  bubble = h(`<div class="ftip" role="dialog" aria-modal="false" aria-labelledby="ftip-txt" data-ftip="${esc(x.id)}">
    <span class="ftip-arrow" aria-hidden="true"></span>
    ${total > 1 ? `<span class="ftip-n">Tipp ${n} von ${total}</span>` : ''}
    <p class="ftip-txt" id="ftip-txt" aria-live="polite">${esc(x.text)}</p>
    <div class="ftip-foot"><button class="btn btn-ghost btn-sm" type="button" data-ftip-off>Keine Tipps mehr</button>
      <button class="btn btn-primary btn-sm" type="button" data-ftip-ok>${n < total ? 'Weiter' : 'Verstanden'}</button></div></div>`);
  $('[data-ftip-ok]', bubble).addEventListener('click', () => { closeHint(); setTimeout(next, 250); });
  $('[data-ftip-off]', bubble).addEventListener('click', () => { setHintsOn(false); queue = []; });
  bubble.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeHint(); } });
  document.body.appendChild(bubble);
  position();
  requestAnimationFrame(() => bubble && bubble.classList.add('open'));
}

function position() {
  if (!bubble || !target) return;
  if (!target.isConnected) { closeHint(); return; }
  const r = target.getBoundingClientRect();
  const off = !r.width || r.bottom < 0 || r.top > innerHeight;
  bubble.classList.toggle('off', off);
  if (off) return;
  const bw = bubble.offsetWidth, bh = bubble.offsetHeight, gap = 12, m = 10;
  const below = r.bottom + gap + bh <= innerHeight - m || r.top - gap - bh < m;
  const top = below ? r.bottom + gap : r.top - gap - bh;
  const cx = r.left + r.width / 2;
  const left = Math.max(m, Math.min(innerWidth - bw - m, cx - bw / 2));
  bubble.style.top = Math.max(m, top) + 'px';
  bubble.style.left = left + 'px';
  bubble.classList.toggle('above', !below);
  bubble.style.setProperty('--ax', Math.max(18, Math.min(bw - 18, cx - left)) + 'px');
}
const reposition = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(position); };

export function closeHint() {
  if (target) target.classList.remove('ftip-target');
  target = null;
  if (bubble) { const b = bubble; bubble = null; b.classList.remove('open'); setTimeout(() => b.replaceWith(), 160); }
}

let started = false;
/** Called once from js/app.js: watches page changes and shows the tips that belong there. */
export function initHints() {
  if (started) return;
  started = true;
  window.addEventListener('hashchange', () => { closeHint(); queue = []; schedule(); });
  window.addEventListener('resize', reposition);
  document.addEventListener('scroll', reposition, true);
  window.addEventListener('fale:hints-check', () => schedule(300)); // e.g. after the intro closed
  schedule(1800);
}
