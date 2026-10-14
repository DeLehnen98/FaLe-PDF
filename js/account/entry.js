// FaLe-Konto entry points: app start, the card on "Ich", the (dismissible) hint on the start page.
// Nothing here talks to the network unless the user is signed in or opens #/konto.
import { h, esc, $ } from '../ui.js';
import { oicon } from '../office/kinds.js';
import * as A from './auth.js';

let cssDone = false;
export function loadAccountCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('../../css/account.css', import.meta.url).href;
  document.head.appendChild(l);
}

const EXTRA = {
  sync: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 3v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 21v-5h-5"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  devices: '<rect x="2.5" y="5" width="13" height="10" rx="1.6"/><path d="M1.5 18h15"/><rect x="17.5" y="8" width="5" height="11" rx="1.2"/><path d="M19.4 16.8h1.2"/>',
  cloudLock: '<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4 4 0 0 1 .5 7.97"/><rect x="9" y="13" width="7" height="6" rx="1.2"/><path d="M10.6 13v-1.4a1.9 1.9 0 0 1 3.8 0V13"/>',
};
export function aicon(name, cls = '') {
  if (!EXTRA[name]) return oicon(name, cls);
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${EXTRA[name]}</svg>`;
}

/** "vor 2 Min." */
export function ago(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 50) return 'gerade eben';
  const m = Math.round(s / 60);
  if (m < 60) return `vor ${m} Min.`;
  const hrs = Math.round(m / 60);
  if (hrs < 24) return `vor ${hrs} Std.`;
  return `am ${new Date(ts).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`;
}

/** One-line sync state for cards. */
export function syncLine(st) {
  if (!st) return '';
  if (st.needs === 'setup') return 'FaLe Sync ist noch nicht eingerichtet';
  if (st.needs === 'unlock' || st.needs === 'keychange') return 'FaLe Sync: auf diesem Gerät entsperren';
  if (!st.enabled) return 'FaLe Sync ist auf diesem Gerät aus';
  if (st.paused) return st.pausedReason === 'cleared' ? 'Sync pausiert – Daten auf diesem Gerät gelöscht' : 'Sync pausiert';
  if (st.phase === 'pulling' || st.phase === 'pushing' || st.phase === 'checking' || st.phase === 'cleaning') return 'Synchronisiert gerade …';
  if (st.quotaFull) return 'Cloud-Speicher voll';
  if (st.offline) return 'Offline – Änderungen werden später synchronisiert';
  if (st.waitingWifi) return 'Wartet auf WLAN';
  if (st.error) return 'Sync-Fehler – wird erneut versucht';
  return st.last ? `Synchronisiert ${ago(st.last)}` : 'Noch nicht synchronisiert';
}

/** App start: finish a Google redirect, resume background sync when signed in. */
export async function initAccount() {
  if (new URLSearchParams(location.search).get('auth') === 'google') {
    try { await A.handleAuthRedirect(); } catch (e) { (await import('../ui.js')).errorToast(e, 'Die Anmeldung hat nicht geklappt.'); }
  }
  if (!A.maybeSignedIn()) return;
  try { (await import('../sync/engine.js')).init(); } catch (e) { console.warn(e); }
}

/** Card on the "Ich" page. */
export async function renderMeCard(box) {
  if (!box) return;
  loadAccountCss();
  const paint = async () => {
    const user = A.maybeSignedIn() ? await A.currentUser() : null;
    if (!user) {
      const cfg = await A.accountConfig({ passive: true }); // build-time / cached config – never a request
      if (cfg.configured === false) { box.innerHTML = ''; return; }
      box.innerHTML = '';
      box.appendChild(h(`<a class="card acct-me acct-me-out" href="#/konto">
        <span class="acct-me-ic">${aicon('cloudLock')}</span>
        <span class="acct-me-text"><strong>FaLe-Konto (optional)</strong><span>Dateien Ende-zu-Ende-verschlüsselt auf allen Geräten, FaLe Plus überall. Alles geht auch ohne Konto.</span></span>
        ${cfg.configured ? '<span class="btn btn-soft btn-sm acct-me-btn">Anmelden</span>' : `<span class="me-go">${oicon('chevronRight')}</span>`}</a>`));
      return;
    }
    let st = null;
    try { st = (await import('../sync/engine.js')).status(); } catch {}
    box.innerHTML = '';
    const initial = esc((user.email || '?').slice(0, 1).toUpperCase());
    box.appendChild(h(`<a class="card acct-me" href="#/konto">
      <span class="acct-avatar" aria-hidden="true">${initial}</span>
      <span class="acct-me-text"><strong data-no-i18n>${esc(user.email)}</strong><span data-acct-line>${esc(syncLine(st))}</span></span>
      <span class="me-go">${oicon('chevronRight')}</span></a>`));
  };
  await paint();
  const onChange = () => { if (document.body.contains(box)) paint(); else window.removeEventListener('fale:account', onChange); };
  window.addEventListener('fale:account', onChange);
  const onSync = e => { const l = $('[data-acct-line]', box); if (!document.body.contains(box)) { window.removeEventListener('fale:sync', onSync); return; } if (l) l.textContent = syncLine(e.detail); };
  window.addEventListener('fale:sync', onSync);
}

/** Start page: one dismissible hint, only for users with at least 5 files who are not signed in. */
export async function renderStartHint(box, fileCount) {
  if (!box) return;
  let hidden = false;
  try { hidden = localStorage.getItem('fale-acct-hint') === 'hidden'; } catch {}
  if (hidden || fileCount < 5 || A.maybeSignedIn()) { box.hidden = true; return; }
  const cfg = await A.accountConfig({ passive: true });
  if (!cfg.configured) { box.hidden = true; return; }
  loadAccountCss();
  box.innerHTML = '';
  box.appendChild(h(`<div class="card acct-hint"><span class="acct-hint-ic">${aicon('sync')}</span>
    <div class="acct-hint-text"><strong>Deine Dateien auf allen Geräten?</strong><span>Mit dem optionalen FaLe-Konto synchronisierst du Ende-zu-Ende-verschlüsselt – wir können nichts davon lesen.</span>
    <a class="btn btn-ghost btn-sm" href="#/konto">Mehr erfahren</a></div>
    <button class="icon-btn" type="button" data-acct-hint-close aria-label="Hinweis ausblenden">${oicon('close')}</button></div>`));
  $('[data-acct-hint-close]', box).addEventListener('click', () => { box.hidden = true; try { localStorage.setItem('fale-acct-hint', 'hidden'); } catch {} });
  box.hidden = false;
}
