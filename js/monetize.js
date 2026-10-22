// FaLe Pro (internally still "plus": product ids fale_plus_*, storage keys) and reward videos are offered only
// inside the Android app (Google Play). The web version shows no paid offer and advertises none – it is hosted on
// a non-commercial plan until the Play Store launch. People who already have Pro (bought in the app, carried by
// the FaLe-Konto) see their Pro status everywhere.
//   Ohne Pro: every KI request is unlocked by one fully watched video (Android app, confirmed by Google)
//   Mit Pro:  all KI tools without videos, no ads
import { isNative, platformName } from './platform.js';

// iOS app: no paid offer yet (App Store purchases need their own server check – see store/IOS-SETUP.md)
export const showPlus = () => isNative() && platformName() !== 'ios';
/** Reward videos exist only in the Android app. */
export const videosHere = () => isNative() && platformName() === 'android';

const ls = k => { try { return localStorage.getItem(k); } catch { return null; } };

/** Is FaLe Pro active on this device? (Play purchase info or the AI quota the server last sent.) */
export function proActive(now = Date.now()) {
  try {
    const info = JSON.parse(ls('fale-plus-info') || 'null');
    if (info && (info.lifetime || !info.expiresAt || Date.parse(info.expiresAt) > now)) return true;
    const q = JSON.parse(ls('fale-ai-quota') || 'null'); // the AI client's cached quota knows Pro too
    if (q && q.quota && q.quota.plus) return true;
  } catch { /* ignore */ }
  return false;
}

/** html.is-pro → the „PRO“ mark next to the logo; kept in sync with quota/purchase changes. */
export function syncProMark() {
  try { document.documentElement.classList.toggle('is-pro', proActive()); } catch { /* no DOM */ }
}
let watching = false;
export function watchProMark() {
  syncProMark();
  if (watching || typeof window === 'undefined') return;
  watching = true;
  window.addEventListener('fale:ai-quota', syncProMark);
  window.addEventListener('fale:plus', syncProMark);
  window.addEventListener('storage', syncProMark);
}
