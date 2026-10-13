// „Dein Monat“: tiny local event counter. Nothing leaves the device, nothing is sent anywhere.
//
// Usage from any module:   import { track } from '../extras/stats.js';  track('pages_read', 3);
// Event names (amount = count unless noted):
//   pages_read       Seiten in PDFs gelesen
//   docs_signed      Dokumente unterschrieben
//   scans            Seiten/Dokumente gescannt
//   bytes_saved      Bytes gespart durch Komprimieren (amount in Bytes)
//   files_created    neue Dateien erstellt (Editoren, Werkzeuge, Generatoren)
//   files_imported   Dateien importiert
//   letters_created  Briefe/Vorlagen mit dem Generator erstellt
//   pdf_exported     PDFs exportiert
//   reminders_created Fristen eingetragen
//   vault_added      Dateien in den Tresor gelegt
// Unknown names are counted too (forward compatible) but only the ones above are shown.

const KEY = 'fale-stats';
const OFF = 'fale-stats-off';

export const EVENTS = {
  pages_read: { label: 'Seiten gelesen', icon: 'page' },
  docs_signed: { label: 'Dokumente unterschrieben', icon: 'sign' },
  scans: { label: 'Scans', icon: 'scan' },
  bytes_saved: { label: 'gespart durch Komprimieren', icon: 'compress', bytes: true },
  files_created: { label: 'Dateien erstellt', icon: 'plus' },
  letters_created: { label: 'Briefe geschrieben', icon: 'letter' },
  files_imported: { label: 'Dateien importiert', icon: 'upload' },
  pdf_exported: { label: 'PDFs exportiert', icon: 'kpdf' },
  reminders_created: { label: 'Fristen eingetragen', icon: 'bell' },
  vault_added: { label: 'Dateien im Tresor gesichert', icon: 'vault' },
};

// friendly milestones – reached ones are shown once in a while, never as pressure
const MILESTONES = [
  { ev: 'pages_read', n: 100, text: '100 Seiten gelesen 🎉' },
  { ev: 'pages_read', n: 500, text: '500 Seiten gelesen – ein ganzes Buch! 📚' },
  { ev: 'pages_read', n: 1000, text: '1.000 Seiten gelesen 🏆' },
  { ev: 'files_created', n: 10, text: '10 Dateien erstellt ✨' },
  { ev: 'files_created', n: 100, text: '100 Dateien erstellt 🚀' },
  { ev: 'docs_signed', n: 1, text: 'Erste Unterschrift – ganz ohne Drucker ✍️' },
  { ev: 'docs_signed', n: 25, text: '25 Dokumente unterschrieben ✍️' },
  { ev: 'scans', n: 10, text: '10 Scans – Papierstapel adé 📄' },
  { ev: 'bytes_saved', n: 10 * 1048576, text: '10 MB Speicher gespart 💾' },
  { ev: 'bytes_saved', n: 100 * 1048576, text: '100 MB Speicher gespart 💾' },
  { ev: 'letters_created', n: 1, text: 'Erster Brief erledigt – ohne Vorlagen-Suche 📮' },
  { ev: 'letters_created', n: 10, text: '10 Briefe geschrieben 📮' },
];

let data = null;
let timer = 0;
const listeners = new Set();

function load() {
  if (data) return data;
  try { data = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { data = null; }
  if (!data || typeof data !== 'object' || !data.months) data = { v: 1, months: {}, total: {} };
  return data;
}
function persist() {
  clearTimeout(timer);
  timer = setTimeout(flush, 400);
}
function flush() {
  clearTimeout(timer);
  if (!data) return;
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
}
if (typeof window !== 'undefined') window.addEventListener('pagehide', flush);

export function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function statsEnabled() {
  try { return localStorage.getItem(OFF) !== '1'; } catch { return true; }
}
export function setStatsEnabled(on) {
  try { if (on) localStorage.removeItem(OFF); else localStorage.setItem(OFF, '1'); } catch {}
  listeners.forEach(fn => { try { fn(); } catch {} });
}

/** Count an event locally. Never throws, never blocks. */
export function track(event, amount = 1) {
  try {
    if (!event || !statsEnabled()) return;
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return;
    const d = load();
    const mk = monthKey();
    const m = d.months[mk] || (d.months[mk] = {});
    m[event] = (m[event] || 0) + n;
    d.total[event] = (d.total[event] || 0) + n;
    // keep 24 months at most
    const keys = Object.keys(d.months).sort();
    while (keys.length > 24) delete d.months[keys.shift()];
    persist();
    listeners.forEach(fn => { try { fn(event); } catch {} });
  } catch {}
}

export function onStats(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function monthStats(d = new Date()) { return { ...(load().months[monthKey(d)] || {}) }; }
export function totals() { return { ...load().total }; }
export function resetStats() { data = { v: 1, months: {}, total: {} }; flush(); listeners.forEach(fn => { try { fn(); } catch {} }); }

/** Highest reached milestone per event (based on the all-time total). */
export function reachedMilestones() {
  const t = totals();
  const best = new Map();
  for (const m of MILESTONES) if ((t[m.ev] || 0) >= m.n) best.set(m.ev, m);
  return [...best.values()];
}

export function formatAmount(event, n) {
  if (EVENTS[event] && EVENTS[event].bytes) {
    const mb = n / 1048576;
    return mb >= 1 ? `${mb.toLocaleString('de-DE', { maximumFractionDigits: mb < 10 ? 1 : 0 })} MB` : `${Math.round(n / 1024).toLocaleString('de-DE')} KB`;
  }
  return Math.round(n).toLocaleString('de-DE');
}
