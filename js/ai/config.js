// FaLe PDF – Cloud-KI: configuration in ONE place (see store/AI-SETUP.md).
//
// AdMob: the IDs below are Google's official TEST IDs. They show test ads only and never pay out.
// Before the release, replace them with your own IDs from the AdMob console (App-ID → also used by
// scripts/cap-patch-android.mjs for the AndroidManifest; it reads ADMOB_APP_ID from this file) and
// set ADMOB_TESTING to false.
import { isNative } from '../platform.js';

export const AI_CONFIG = {
  // Backend for the Android app (the web version uses its own origin, e.g. preview deployments)
  API_BASE_NATIVE: 'https://fale-pdf.vercel.app',

  // --- AdMob (Android only) ---
  ADMOB_APP_ID: 'ca-app-pub-3940256099942544~3347511713', // TEST app id – replace
  ADMOB_REWARDED_ID: 'ca-app-pub-3940256099942544/5224354917', // TEST rewarded unit – replace
  ADMOB_TESTING: true, // set false for real ads

  // --- FaLe Plus (Google Play subscriptions; prices come from the Play Console, not from code) ---
  PLUS_PRODUCTS: [
    { id: 'fale_plus_monthly', plan: 'monthly', label: 'Monatlich' },
    { id: 'fale_plus_yearly', plan: 'yearly', label: 'Jährlich' },
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
