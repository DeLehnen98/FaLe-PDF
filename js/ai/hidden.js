// „KI ausblenden“: one switch that removes every AI entry point (start card, Werkzeuge section, editor menus).
// Tiny and dependency-free so the editors can check it synchronously without loading the AI code.
// Stored only on this device (localStorage); hiding also switches the cloud AI off (see hub.js mountSettings).
const KEY = 'fale-ai-hidden';

export function aiHidden() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function setAiHidden(on) {
  try { if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* private mode: stays visible */ }
  try { window.dispatchEvent(new CustomEvent('fale:ai-state')); } catch { /* no window (tests) */ }
}

/** AI entries in menus (viewer „KI-Assistent“, editor menus): hidden when the user hid the AI, and also while the
 *  „Einfache Ansicht“ is on (js/simple.js) – without touching the user's own setting. The AI stays reachable through
 *  the search (Werkzeuge) and #/ki. Reads the class/flag directly so this file stays dependency-free. */
export function aiMenusHidden() {
  if (aiHidden()) return true;
  try { if (document.documentElement.classList.contains('simple')) return true; } catch { /* no DOM */ }
  try { return localStorage.getItem('fale-simple') === '1'; } catch { return false; }
}
