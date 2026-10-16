// FaLe One – configuration in ONE place. No secrets: the Supabase URL and publishable key are fetched from
// the FaLe PDF API (/api/account?a=config), which is the single source of truth for the FaLe-Konto.
export const VERSION = '1.0.0';
// Public origins (docs/DOMAINS-SWITCH.md). The API answers CORS for old and new FaLe One origins alike,
// and the CSP in one/vercel.json allows both API hosts, so flipping is just these three lines:
//   FLIP → PDF_ORIGIN = 'https://pdf.fale.network', ONE_ORIGIN = 'https://faleone.com', NETWORK_ORIGIN = 'https://fale.network'
export const PDF_ORIGIN = 'https://fale-pdf.vercel.app';         // FaLe PDF web app + /api
export const ONE_ORIGIN = 'https://fale-one.vercel.app';         // this app (used in texts sent to other people)
export const NETWORK_ORIGIN = 'https://fale-network.vercel.app'; // FaleNetwork site (privacy policy, imprint)
export const API_BASE = PDF_ORIGIN;          // /api/drive, /api/account, /api/share (contract §2)
export const PDF_APP = PDF_ORIGIN + '/';     // "In FaLe PDF öffnen" and share links (§7.9)
export const PRIVACY_URL = NETWORK_ORIGIN + '/datenschutz/';
export const IMPRINT_URL = NETWORK_ORIGIN + '/impressum/';
export const SUPPORT_MAIL = 'hallo@fale.network';

// Local development / tests only: on localhost the API origins can be pointed at a local harness
// (localStorage 'fale-one-dev-api' / 'fale-one-dev-pdf'). Never honoured on a real origin.
const isLocal = () => typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
function dev(k) {
  if (!isLocal()) return null;
  try { const v = localStorage.getItem(k); return v && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(v) ? v.replace(/\/+$/, '') : null; } catch { return null; }
}
export function apiBase() { return dev('fale-one-dev-api') || API_BASE; }
export function pdfAppBase() { const d = dev('fale-one-dev-pdf'); return d ? d + '/' : PDF_APP; }
