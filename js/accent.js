// FaLe Pro extra: the app colour (Ich → Einstellungen → „App-Farbe“). Stored on this device; only applied while Pro
// is active (js/monetize.js syncProMark) – the choice is kept, so it comes back when Pro is renewed.
export const ACCENTS = [
  { id: '', name: 'Violett', sw: '#3D34B8' },
  { id: 'ozean', name: 'Ozean', sw: '#0B5CAD' },
  { id: 'wald', name: 'Wald', sw: '#1E6B3A' },
  { id: 'beere', name: 'Beere', sw: '#A3245E' },
  { id: 'bernstein', name: 'Bernstein', sw: '#A34A00' },
  { id: 'graphit', name: 'Graphit', sw: '#3C4152' },
];
const KEY = 'fale-accent';

export function storedAccent() {
  try { const v = localStorage.getItem(KEY) || ''; return ACCENTS.some(a => a.id === v) ? v : ''; } catch { return ''; }
}
/** Put the colour on the page (pro = may it be shown?). */
export function paintAccent(pro) {
  const a = pro ? storedAccent() : '';
  try {
    if (a) document.documentElement.dataset.accent = a;
    else delete document.documentElement.dataset.accent;
  } catch { /* no DOM */ }
}
export function setAccent(id, pro) {
  try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch { /* private mode */ }
  paintAccent(pro);
}
