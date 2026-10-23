// FaLe PDF – Cloud-KI: configuration in ONE place (see store/AI-SETUP.md).
//
// AdMob: our own IDs from the AdMob console (App-ID → also used by scripts/cap-patch-android.mjs for the
// AndroidManifest; it reads ADMOB_APP_ID from this file). While ADMOB_TESTING is true, the app requests Google's
// official TEST ad units instead (test ads, never paid, safe to tap) – set it to false only for the Play release.
import { isNative } from '../platform.js';
import { PDF_ORIGIN } from '../domains.js';

export const AI_CONFIG = {
  // Backend for the Android app (the web version uses its own origin, e.g. preview deployments)
  API_BASE_NATIVE: PDF_ORIGIN, // primary origin: js/domains.js

  // --- AdMob (Android only) ---
  ADMOB_APP_ID: 'ca-app-pub-3002034870890608~3086375405', // FaLe PDF (Android)
  ADMOB_REWARDED_ID: 'ca-app-pub-3002034870890608/8943664757', // „KI-Bonus“ (mit Prämie, SSV → /api/admob-ssv)
  ADMOB_BANNER_ID: 'ca-app-pub-3940256099942544/9214589741', // TEST adaptive banner unit – replace with own banner unit (js/banner.js)
  ADMOB_TESTING: true, // true: Google's test units below are requested; false (Play release): the real units above
  ADMOB_TEST_REWARDED_ID: 'ca-app-pub-3940256099942544/5224354917',
  ADMOB_TEST_BANNER_ID: 'ca-app-pub-3940256099942544/9214589741',

  // --- FaLe Plus (Google Play subscriptions; prices come from the Play Console, not from code) ---
  PLUS_PRODUCTS: [
    { id: 'fale_plus_monthly', plan: 'monthly', label: 'Monatlich' },
    { id: 'fale_plus_yearly', plan: 'yearly', label: 'Jährlich' },
  ],
  // one-time purchase instead of a subscription ("Einmal zahlen, für immer") – Google Play in-app product
  PLUS_LIFETIME: { id: 'fale_plus_lifetime', label: 'Für immer' },
  // voluntary tips – consumable in-app products, no entitlement, can be given again
  TIPS: [
    { id: 'fale_tip_small', label: 'Kleiner Dank' },
    { id: 'fale_tip_medium', label: 'Großer Dank' },
    { id: 'fale_tip_large', label: 'Riesiger Dank' },
  ],

  // client-side input limits (the server enforces its own limits as well)
  MAX_SUMMARY_CHARS: 48000,
  MAX_TRANSLATE_CHARS: 12000,
  MAX_STUDY_CHARS: 24000,
  MAX_CHAT_CONTEXT: 20000,
};

/** Base URL of the AI API ('' = same origin). Tests may override it via window.__FALE_AI_API__. */
export function apiBase() {
  if (typeof window !== 'undefined' && typeof window.__FALE_AI_API__ === 'string') return window.__FALE_AI_API__;
  return isNative() ? AI_CONFIG.API_BASE_NATIVE : '';
}

/** Output language for AI results: follows the UI language (German default, English UI → English). */
export function outputLang() {
  try { return /^en\b/i.test(document.documentElement.lang || '') ? 'en' : 'de'; } catch { return 'de'; }
}

export const TARGET_LANGS = [['en', 'Englisch'], ['de', 'Deutsch'], ['fr', 'Französisch'], ['es', 'Spanisch'], ['it', 'Italienisch'], ['nl', 'Niederländisch'],
  ['pl', 'Polnisch'], ['pt', 'Portugiesisch'], ['tr', 'Türkisch'], ['uk', 'Ukrainisch'], ['ru', 'Russisch'], ['ar', 'Arabisch'], ['ro', 'Rumänisch'],
  ['cs', 'Tschechisch'], ['el', 'Griechisch'], ['hr', 'Kroatisch'], ['hu', 'Ungarisch'], ['sv', 'Schwedisch'], ['da', 'Dänisch'], ['zh', 'Chinesisch'], ['ja', 'Japanisch'], ['ko', 'Koreanisch']];

/** The ad unit to request: Google's test unit while ADMOB_TESTING (no real ads in test builds), else ours. */
export function adUnit(kind) {
  const C = AI_CONFIG;
  if (kind === 'banner') return C.ADMOB_TESTING ? C.ADMOB_TEST_BANNER_ID : C.ADMOB_BANNER_ID;
  return C.ADMOB_TESTING ? C.ADMOB_TEST_REWARDED_ID : C.ADMOB_REWARDED_ID;
}
