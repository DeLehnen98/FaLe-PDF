// FaLe One – configuration in ONE place. No secrets: the Supabase URL and publishable key are fetched from
// the FaLe PDF API (/api/account?a=config), which is the single source of truth for the FaLe-Konto.
export const VERSION = '1.0.0';
export const API_BASE = 'https://fale-pdf.vercel.app';   // /api/drive, /api/account, /api/share (contract §2)
export const PDF_APP = 'https://fale-pdf.vercel.app/';   // "In FaLe PDF öffnen" and share links (§7.9)
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
