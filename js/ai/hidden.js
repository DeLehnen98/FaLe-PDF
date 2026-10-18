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
