// Werbebanner – nur in der Android-App (Google AdMob). Finanziert den Anfang; FaLe Plus macht die App werbefrei.
// Regeln (AdMob-Richtlinien gegen versehentliche Klicks, und damit es nicht nervt):
//  • ein einziges Banner, fest am unteren Rand der vier Hauptseiten (Start, Dateien, Werkzeuge, Ich) – nie in
//    Dokumenten, Werkzeugen, Editoren, beim Unterschreiben, in Dialogen, Menüs, der Einführung oder beim Tippen
//  • zwischen Navigation und Banner ein Streifen „Anzeige“ (nicht direkt neben Bedienelementen), nichts überlagert
//    Inhalte: die Seite rückt um die Bannerhöhe nach oben
//  • keine Vollbild-Werbung, keine Videos ohne Antippen; Einwilligung über Googles Dialog (UMP), sonst nicht-
//    personalisiert
import { proActive } from './monetize.js';
import { plugin, isNative, platformName } from './platform.js';
import { AI_CONFIG } from './ai/config.js';

const MAIN = new Set(['start', 'dateien', 'werkzeuge', 'einstellungen', 'suche']);
const LABEL_H = 18; // px – the „Anzeige“ strip between the navigation and the banner
let created = false, showing = false, busy = false, failedAt = 0, height = 0, timer = 0, started = false;

const ls = k => { try { return localStorage.getItem(k); } catch { return null; } };
const admob = () => (isNative() && platformName() === 'android' ? plugin('AdMob') : null);

/** FaLe Plus (bought in the app, js/ai/plus.js) → no banners. */
export function plusActive(now = Date.now()) { return proActive(now); } // FaLe Pro = no ads (js/monetize.js)

/** Does this run of the app show banners at all? */
export function bannersEnabled() {
  if (!admob() || !AI_CONFIG.ADMOB_BANNER_ID) return false;
  if (ls('fale-ads-off') === '1') return false; // tests / screenshots
  return !plusActive();
}

function wanted() {
  if (!bannersEnabled()) return false;
  if (ls('fale-onboarded') !== '1' || document.querySelector('.onboard')) return false;
  if (!MAIN.has(document.body.dataset.view || '')) return false;
  const vis = sel => { const el = document.querySelector(sel); return !!el && !el.hidden; };
  if (vis('#viewer') || vis('#tool-screen')) return false;
  if (document.querySelector('dialog[open], .menu-layer, .ob-wrap, .sheet-open')) return false;
  const a = document.activeElement;
  if (a && (a.matches('input, textarea, select, [contenteditable="true"]'))) return false; // keyboard open
  if (document.visibilityState === 'hidden') return false;
  return true;
}

function setHeight(h) {
  height = Math.max(0, Math.round(h || 0));
  const root = document.documentElement;
  root.style.setProperty('--ad-h', `${height ? height + LABEL_H : 0}px`);
  root.classList.toggle('has-ad', showing && height > 0);
}

async function show() {
  const p = admob();
  if (!p) return;
  if (failedAt && Date.now() - failedAt < 60000) return; // no fill a moment ago: try again later
  const { initAds } = await import('./ai/ads.js');
  const consent = await initAds().catch(() => null);
  if (consent && consent.canRequestAds === false) return;
  const npa = !consent || !['OBTAINED', 'NOT_REQUIRED'].includes(consent.status);
  if (!created) {
    await p.showBanner({ adId: AI_CONFIG.ADMOB_BANNER_ID, adSize: 'ADAPTIVE_BANNER', position: 'BOTTOM_CENTER', margin: 0, isTesting: !!AI_CONFIG.ADMOB_TESTING, npa });
    created = true;
  } else {
    await p.resumeBanner();
  }
  showing = true;
  setHeight(height);
}

async function hide() {
  const p = admob();
  showing = false;
  setHeight(height);
  if (p && created) await p.hideBanner();
}

async function sync() {
  if (busy) { schedule(); return; }
  busy = true;
  try {
    const want = wanted();
    if (want && !showing) await show();
    else if (!want && showing) await hide();
  } catch (e) {
    console.warn('Banner', e);
    showing = false; setHeight(0);
  } finally { busy = false; }
}
let due = 0;
// throttled, not debounced: constant DOM changes (a spinner, a progress bar) must not keep postponing the check
function schedule(ms = 150) {
  const at = Date.now() + ms;
  if (timer && due <= at) return;
  clearTimeout(timer);
  due = at;
  timer = setTimeout(() => { timer = 0; sync(); }, ms);
}

/** Start once at app start (Android app only): listens to page changes, dialogs, menus and the keyboard. */
export function startBanners() {
  if (started || !bannersEnabled()) return;
  started = true;
  const p = admob();
  const listen = (ev, cb) => { try { const r = p.addListener(ev, cb); if (r && r.catch) r.catch(() => {}); } catch { /* old plugin */ } };
  listen('bannerAdSizeChanged', s => setHeight(s && s.height));
  listen('bannerAdLoaded', () => { failedAt = 0; });
  listen('bannerAdFailedToLoad', () => {
    failedAt = Date.now();
    showing = false; created = false; setHeight(0);
    try { p.removeBanner(); } catch { /* gone */ }
    schedule(61000);
  });
  window.addEventListener('hashchange', () => schedule(60));
  document.addEventListener('focusin', () => schedule(0));
  document.addEventListener('focusout', () => schedule(250));
  document.addEventListener('visibilitychange', () => schedule(100));
  window.addEventListener('fale:ai-state', () => schedule(300));
  new MutationObserver(() => schedule()).observe(document.body, { attributes: true, attributeFilter: ['hidden', 'open', 'data-view', 'class'], childList: true, subtree: true });
  schedule(1500);
}

/** For tests: the state of the banner. */
export function bannerState() { return { showing, created, height, enabled: bannersEnabled() }; }
