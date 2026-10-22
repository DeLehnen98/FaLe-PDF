// Startseiten-Bausteine: „Weiterlesen“, „Zuletzt bearbeitet“ und „Dein Monat“.
import * as db from '../db.js';
import { $, h, esc, formatDate } from '../ui.js';
import { oicon, kindOf, kindInfo, openHash } from '../office/kinds.js';
import { fileThumb } from '../office/filerow.js';
import { EVENTS, monthStats, totals, reachedMilestones, statsEnabled, formatAmount, monthKey } from './stats.js';

let viewerMod = null;
async function readingProgress(id) {
  try {
    if (!viewerMod) viewerMod = await import('../viewer.js');
    if (typeof viewerMod.getReadingProgress === 'function') return await viewerMod.getReadingProgress(id);
  } catch {}
  return null;
}

function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 2) return 'gerade eben';
  if (m < 60) return `vor ${m} Min.`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `vor ${hr} Std.`;
  const d = Math.round(hr / 24);
  if (d < 7) return d === 1 ? 'gestern' : `vor ${d} Tagen`;
  return formatDate(ts);
}

/** „Weiterlesen“ + „Zuletzt bearbeitet“. Hides the box when there is nothing to show. */
export async function renderContinue(box) {
  const docs = await db.listFiles();
  const pdfs = docs.filter(d => kindOf(d) === 'pdf' && (d.pages || 0) > 1).slice(0, 15);
  let best = null;
  for (const d of pdfs) {
    let p = await readingProgress(d.id);
    if (!p && d.lastPage > 1) p = { page: d.lastPage, pages: d.pages, updatedAt: d.openedAt };
    if (!p || !p.pages || p.page >= p.pages || p.page < 2) continue;
    if (!best || (p.updatedAt || 0) > (best.p.updatedAt || 0)) best = { d, p };
  }
  const office = docs.filter(d => ['doc', 'sheet', 'slides'].includes(kindInfo(d).cat))
    .sort((a, b) => (b.modifiedAt || b.createdAt || 0) - (a.modifiedAt || a.createdAt || 0)).slice(0, 4);
  if (!best && !office.length) { box.replaceChildren(); box.hidden = true; return; }
  const title = h('<h2 class="section-title">Weitermachen</h2>');
  const row = h('<div class="cont-row"></div>');
  if (best) {
    const pct = Math.round((best.p.page / best.p.pages) * 100);
    const a = h(`<a class="card cont-read" href="#/ansicht/${esc(best.d.id)}?seite=${best.p.page}" data-cont-read>
      ${fileThumb(best.d)}<span class="cont-txt"><span class="cont-kicker">${oicon('bookOpen')} Weiterlesen</span><strong>${esc(best.d.name)}</strong>
      <span class="muted small">Seite ${best.p.page} von ${best.p.pages}</span>
      <span class="meter cont-meter" role="progressbar" aria-label="Lesefortschritt" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></span></span></a>`);
    row.appendChild(a);
  }
  if (office.length) {
    const list = h(`<div class="card cont-recent"><span class="cont-kicker">${oicon('edit')} Zuletzt bearbeitet</span><div class="cont-items"></div></div>`);
    office.forEach(d => {
      $('.cont-items', list).appendChild(h(`<a class="cont-item" href="${openHash(d)}">${fileThumb(d)}<span class="doc-info"><span class="doc-name">${esc(d.name)}</span><span class="doc-meta">${esc(kindInfo(d).label)} · ${ago(d.modifiedAt || d.createdAt || d.openedAt)}</span></span></a>`));
    });
    row.appendChild(list);
  }
  box.replaceChildren(title, row);
  box.hidden = false;
}

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const ORDER = ['pages_read', 'files_created', 'docs_signed', 'scans', 'bytes_saved', 'letters_created', 'pdf_exported', 'reminders_created', 'files_imported', 'vault_added'];

/** „Dein Monat“ card. compact = for the Ich page. */
export function renderMonthCard(box, { compact = false } = {}) {
  box.innerHTML = '';
  if (!statsEnabled()) { box.hidden = true; return; }
  const m = monthStats();
  const keys = ORDER.filter(k => m[k] > 0);
  const now = new Date();
  const ms = reachedMilestones();
  if (!keys.length && compact === false && !Object.keys(totals()).length) { box.hidden = true; return; }
  box.hidden = false;
  const card = h(`<section class="card month-card" aria-label="Dein Monat">
    <div class="month-head"><span class="month-ic">${oicon('stats')}</span><div><strong>Dein ${MONTHS[now.getMonth()]}</strong><span class="muted small">Nur auf diesem Gerät gezählt</span></div>
      <a class="btn btn-ghost btn-sm" href="#/einstellungen/allgemein" aria-label="Statistik-Einstellungen">${oicon('settings')}</a></div>
    <div class="month-grid"></div>
    <p class="month-ms" hidden></p></section>`);
  const grid = $('.month-grid', card);
  if (!keys.length) grid.appendChild(h('<p class="muted small month-empty">Diesen Monat ist noch nichts passiert – kein Problem. Hier erscheint, was du mit FaLe erledigst.</p>'));
  keys.slice(0, compact ? 6 : 4).forEach(k => {
    const ev = EVENTS[k] || { label: k, icon: 'check' };
    grid.appendChild(h(`<div class="month-stat" data-ev="${k}"><span class="ms-ic">${oicon(ev.icon)}</span><span class="ms-n">${formatAmount(k, m[k])}</span><span class="ms-l">${esc(ev.label)}</span></div>`));
  });
  if (ms.length) {
    const p = $('.month-ms', card);
    p.hidden = false;
    // rotate gently through reached milestones, one per month
    const pick = ms[(now.getMonth() + now.getFullYear()) % ms.length];
    p.textContent = pick.text;
  }
  void monthKey;
  box.appendChild(card);
}
