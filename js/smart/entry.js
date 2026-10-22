// Entry points of the assistants: start card, "Assistenten" tool section, file filters, search answer,
// background indexing. Light-weight: heavy modules are imported on demand. No network unless the
// optional Familien-Ordner is in use on this device and the user is signed in.
import { $, h, esc } from '../ui.js';
import { oicon } from '../office/kinds.js';
import { ensureSmartCss, sdb, money, daysUntil, relDays, deDate, onSmartChange } from './common.js';

export const ASSISTANTS = [
  { id: 'a-briefkasten', title: 'Briefkasten-Assistent', desc: 'Brief fotografieren – Art, Beträge, IBAN und Fristen erkennen, Antwort und Überweisung vorbereiten.', icon: 'inbox', href: '#/briefkasten' },
  { id: 'a-gedaechtnis', title: 'Frag deine Dokumente', desc: 'Volltextsuche mit Antworten: „Wann läuft mein Handyvertrag aus?“ – offline.', icon: 'search', href: '#/gedaechtnis' },
  { id: 'a-steuer', title: 'Steuer-Belege', desc: 'Kassenbons und Rechnungen fürs Steuerjahr sammeln – Excel, CSV und PDF-Mappe.', icon: 'euro', href: '#/steuer' },
  { id: 'a-familie', title: 'Familien-Ordner', desc: 'Dokumente, Fristen und Notizen Ende-zu-Ende-verschlüsselt mit der Familie teilen.', icon: 'vault', href: '#/familie' },
];

let inited = false;
/** App start: keep the document index up to date in the background (idle time). */
export function initSmart() {
  if (inited) return;
  inited = true;
  const idle = fn => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 8000 }) : setTimeout(fn, 1500));
  let t = 0;
  const later = () => { clearTimeout(t); t = setTimeout(() => idle(async () => { try { const m = await import('./memory.js'); m.markDirty(); await m.syncIndex(); } catch (e) { console.warn(e); } }), 2500); };
  import('../library.js').then(lib => lib.onLibraryChange(later)).catch(() => {});
  setTimeout(later, 4000);
  import('./memory.js').then(m => { if (m.bgOcrEnabled()) m.scheduleBgOcr(60000); }).catch(() => {});
}

/** Start page card: due letters + the four assistants. */
export async function renderStartCard(box) {
  if (!box) return;
  ensureSmartCss();
  let letters = [], receipts = [];
  try { letters = await sdb.all('letters'); receipts = await sdb.all('receipts'); } catch {}
  const open = letters.filter(l => l.status === 'offen');
  const due = open.filter(l => l.f && l.f.due && daysUntil(l.f.due) <= 14).sort((a, b) => a.f.due.localeCompare(b.f.due));
  const year = new Date().getFullYear();
  const yr = receipts.filter(r => r.year === year || r.year === year - 1);
  const card = h(`<section class="sm-start-card" aria-label="Assistenten">
    <h2 class="section-title"><span class="sm-sec-title">${oicon('sparkle')}<span>Assistenten</span></span></h2>
    <div class="sm-due-list" data-due></div>
    <div class="sm-start-grid" role="list"></div></section>`);
  const grid = $('.sm-start-grid', card);
  const sub = {
    'a-briefkasten': open.length ? `${open.length} offen${due.length ? ` · ${due.length} bald fällig` : ''}` : 'Brief scannen und verstehen',
    'a-gedaechtnis': 'Verträge, Fristen, IBAN …',
    'a-steuer': yr.length ? `${yr.length} Beleg${yr.length === 1 ? '' : 'e'}` : 'Belege fürs Finanzamt',
    'a-familie': 'Sicher mit der Familie teilen',
  };
  for (const a of ASSISTANTS) {
    const it = h(`<a class="sm-start-tile" role="listitem" data-assistant="${a.id}"><span class="sm-start-ic">${oicon(a.icon)}</span><span class="sm-start-txt"><strong></strong><span></span></span></a>`);
    it.href = a.href;
    $('strong', it).textContent = a.title.replace('-Assistent', '');
    $('span span', it).textContent = sub[a.id];
    grid.appendChild(it);
  }
  const dl = $('[data-due]', card);
  for (const l of due.slice(0, 3)) {
    const n = daysUntil(l.f.due);
    const row = h(`<a class="sm-due-row ${n < 0 ? 'over' : n <= 3 ? 'soon' : ''}"><span class="sm-due-ic">${oicon('bell')}</span><span class="sm-row-txt"><strong data-no-i18n></strong><span class="small"></span></span><span class="sm-due-when"></span></a>`);
    row.href = `#/briefkasten/${encodeURIComponent(l.id)}`;
    $('strong', row).textContent = l.f.sender || 'Brief';
    $('.small', row).textContent = [l.f.dueLabel || 'Frist', l.f.amount != null && l.f.amount !== '' ? money(l.f.amount) : ''].filter(Boolean).join(' · ');
    $('.sm-due-when', row).textContent = `${relDays(n)} · ${deDate(l.f.due)}`;
    dl.appendChild(row);
  }
  // Familien-Ordner: pending emergency requests (only if used + signed in)
  import('./family.js').then(async m => {
    const alerts = await m.pendingAlerts();
    for (const a of alerts) {
      const row = h(`<a class="sm-due-row over"><span class="sm-due-ic">${oicon('shield')}</span><span class="sm-row-txt"><strong data-no-i18n></strong><span class="small">Familien-Ordner · Notfallzugang</span></span></a>`);
      row.href = `#/familie/${a.group}?tab=notfall`;
      $('strong', row).textContent = a.text;
      dl.prepend(row);
    }
  }).catch(() => {});
  box.replaceChildren(card);
  box.hidden = false;
}

/** Werkzeuge: section "Assistenten" (cards use .tool-card so the tool filter finds them). */
export function renderToolSection(sec) {
  if (!sec) return;
  ensureSmartCss();
  sec.innerHTML = `<h2 class="section-title">Assistenten <span class="badge new-badge inline-badge">Neu</span></h2><div class="tool-grid sm-tool-grid"></div>`;
  const grid = $('.sm-tool-grid', sec);
  for (const a of ASSISTANTS) grid.appendChild(h(`<a class="tool-card" href="${a.href}" data-tool="${a.id}"><span class="tile-ic sm-tool-ic">${oicon(a.icon)}</span><span class="tc-text"><h3>${esc(a.title)}</h3><p>${esc(a.desc)}</p></span></a>`));
  sec.hidden = false;
}

// ------------------------------------------------------------------ Dateien: smart filters
export const FILE_FILTERS = [
  { id: 'briefe', label: 'Briefe', icon: 'inbox' },
  { id: 'offen', label: 'Offene Post', icon: 'bell' },
  { id: 'belege', label: 'Steuer-Belege', icon: 'euro' },
];
/** doc ids for a smart filter (null = unknown filter) */
export async function smartDocIds(id) {
  if (id === 'briefe') return new Set((await sdb.all('letters')).map(l => l.docId));
  if (id === 'offen') return new Set((await sdb.all('letters')).filter(l => l.status === 'offen').map(l => l.docId));
  if (id === 'belege') return new Set((await sdb.all('receipts')).map(r => r.docId));
  return null;
}
/** Chips row on #/dateien (only shown when there is something to filter). */
export async function renderFileChips(box, current) {
  if (!box) return;
  ensureSmartCss();
  const counts = {};
  for (const f of FILE_FILTERS) counts[f.id] = (await smartDocIds(f.id)).size;
  box.innerHTML = '';
  const any = Object.values(counts).some(Boolean) || current;
  box.hidden = !any;
  if (!any) return;
  for (const f of FILE_FILTERS) {
    if (!counts[f.id] && current !== f.id) continue;
    const on = current === f.id;
    const a = h(`<a class="sm-fchip" aria-pressed="${on}">${oicon(f.icon)}<span>${esc(f.label)}</span><span class="count">${counts[f.id] || ''}</span></a>`);
    a.href = on ? '#/dateien' : `#/dateien?smart=${f.id}`;
    box.appendChild(a);
  }
}

/** #/suche: answers + passages from the Dokumenten-Gedächtnis above the classic results. */
export async function renderSearchAnswer(box, query) {
  try { (await import('./memory.js')).renderAnswer(box, query); } catch (e) { console.warn(e); }
}
export { onSmartChange };
