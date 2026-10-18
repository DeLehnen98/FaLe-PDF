// A quiet "this was free – you can support it" line under a tool result. Shown from the third successful result
// of a visit, at most once per visit, and never again for 60 days once dismissed or followed. The count lives
// in memory only; localStorage "fale-wt-support" ({ until }) is written only when the user dismisses or follows it.
import { el } from './dom.js';

const KEY = 'fale-wt-support';
const DAY = 86400000;
let shownThisVisit = false, results = 0;

function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } }
function store(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode */ } }

/** Count a successful result; returns the hint element when it is time to show it, else null. */
export function supportNudge(lang) {
  if (globalThis.faleWtHost) return null; // not inside the FaLe PDF app (store rules for links to payment pages)
  results++;
  if (shownThisVisit || results < 3) return null;
  const s = load();
  if (s.until && Date.now() < s.until) return null;
  shownThisVisit = true;
  const de = lang === 'de';
  const snooze = () => { const v = load(); v.until = Date.now() + 60 * DAY; store(v); };
  const box = el('p', { class: 'wt-support' },
    el('span', {}, de ? 'Kostenlos, ohne Werbung und ohne Tracking. Wenn dir das geholfen hat: ' : 'Free, without ads or tracking. If this helped you: '),
    el('a', { href: de ? '/unterstuetzen/' : '/en/support/', onclick: snooze }, de ? 'FaleNetwork unterstützen' : 'support FaleNetwork'),
    el('button', { type: 'button', class: 'wt-support-x', aria: { label: de ? 'Hinweis ausblenden' : 'Hide this note' }, onclick: () => { snooze(); box.remove(); } }, '×'));
  return box;
}
