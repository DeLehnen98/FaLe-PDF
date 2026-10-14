// Theme handling: auto (prefers-color-scheme), light or dark.
const KEY = 'fale-theme';

export function currentTheme() {
  try { return localStorage.getItem(KEY) || 'auto'; } catch { return 'auto'; }
}

export function effectiveDark() {
  const t = currentTheme();
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(t) {
  try { if (t === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch {}
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  syncThemeColor();
}

export function syncThemeColor() {
  const dark = effectiveDark();
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => {
    m.setAttribute('content', dark ? '#0E0D23' : '#F2F3F9');
    m.removeAttribute('media');
  });
}

export function toggleTheme() {
  applyTheme(effectiveDark() ? 'light' : 'dark');
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeColor);
