// Fristen & Erinnerungen: Datum an Dateien hängen, Vorlaufzeiten, jährliche Wiederholung,
// Karten auf der Startseite und – in der App – Systembenachrichtigungen über js/platform.js.
import * as db from '../db.js';
import { $, $$, h, esc, toast, errorToast, openDialog, confirmDialog } from '../ui.js';
import { oicon, kindTile } from '../office/kinds.js';
import { track } from './stats.js';

export const TYPES = [
  { id: 'ablauf', label: 'Ablaufdatum', icon: 'idcard' },
  { id: 'kuendigung', label: 'Kündigungsfrist', icon: 'letter' },
  { id: 'zahlung', label: 'Zahlung fällig', icon: 'euro' },
  { id: 'termin', label: 'Termin', icon: 'calendar' },
  { id: 'sonstiges', label: 'Sonstiges', icon: 'bell' },
];
export const LEADS = [
  { d: 1, label: '1 Tag' }, { d: 7, label: '1 Woche' }, { d: 30, label: '1 Monat' }, { d: 90, label: '3 Monate' },
];
export const SUGGESTIONS = [
  { title: 'Personalausweis läuft ab', type: 'ablauf', leads: [90, 30], icon: 'idcard' },
  { title: 'Reisepass läuft ab', type: 'ablauf', leads: [90, 30], icon: 'idcard' },
  { title: 'TÜV / Hauptuntersuchung fällig', type: 'termin', leads: [30, 7], icon: 'calendar' },
  { title: 'Versicherung kündigen', type: 'kuendigung', leads: [30, 7], yearly: true, icon: 'shield' },
  { title: 'Kfz-Versicherung wechseln (Stichtag 30.11.)', type: 'kuendigung', leads: [30, 7], yearly: true, dueMD: '11-30', icon: 'shield' },
  { title: 'Steuererklärung abgeben', type: 'termin', leads: [30, 7], yearly: true, icon: 'euro' },
  { title: 'Handyvertrag kündigen', type: 'kuendigung', leads: [30, 7], icon: 'phone' },
  { title: 'Garantie läuft ab', type: 'ablauf', leads: [30], icon: 'shield' },
];

// ---------------- dates ----------------
const pad = n => String(n).padStart(2, '0');
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const today0 = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
export function daysLeft(due) { return Math.round((parse(due) - today0()) / 86400000); }
export const deDate = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? `${m[3]}.${m[2]}.${m[1]}` : ''; };
const longDate = s => parse(s).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
function relText(n) {
  if (n === 0) return 'heute';
  if (n === 1) return 'morgen';
  if (n === -1) return 'seit gestern';
  if (n < 0) return `seit ${-n} Tagen`;
  if (n < 14) return `in ${n} Tagen`;
  if (n < 60) return `in ${Math.round(n / 7)} Wochen`;
  return `in ${Math.round(n / 30)} Monaten`;
}
const typeOf = id => TYPES.find(t => t.id === id) || TYPES[TYPES.length - 1];

/** Status of a reminder: 'done' | 'overdue' | 'due' (a lead time is reached) | 'later'. */
export function statusOf(r) {
  if (r.done) return 'done';
  const n = daysLeft(r.due);
  if (n < 0) return 'overdue';
  if (r.snoozeUntil && daysLeft(r.snoozeUntil) > 0) return 'later';
  const maxLead = Math.max(0, ...(r.leads || []));
  return n <= maxLead ? 'due' : 'later';
}

// ---------------- data ----------------
export async function listAll() {
  const all = await db.listReminders();
  return all.sort((a, b) => (a.done - b.done) || a.due.localeCompare(b.due));
}
/** Reminders that should be shown now (overdue or within a lead time). */
export async function dueReminders() {
  return (await listAll()).filter(r => ['overdue', 'due'].includes(statusOf(r)));
}

export async function addReminder({ title, type = 'termin', due, leads = [7], yearly = false, docId = null, note = '' }) {
  if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(due || '')) throw Object.assign(new Error('bad reminder'), { userMessage: 'Bitte gib einen Titel und ein Datum an.' });
  const rec = { id: db.uid(), title: String(title).slice(0, 200), type, due, leads: [...new Set(leads.map(Number))].sort((a, b) => b - a), yearly: !!yearly, docId, note: String(note || '').slice(0, 1000), done: false, createdAt: Date.now() };
  await db.putReminder(rec);
  track('reminders_created');
  await schedule(rec);
  emit();
  return rec;
}
export async function updateReminder(rec, { ask = true } = {}) {
  await cancel(rec);
  rec.notifIds = [];
  await db.putReminder(rec);
  if (!rec.done) await schedule(rec, { ask });
  emit();
  return rec;
}
export async function removeReminder(rec) {
  await cancel(rec);
  await db.deleteReminder(rec.id);
  emit();
}
/** Mark as done. Yearly reminders move to next year. */
export async function completeReminder(rec) {
  if (rec.yearly) {
    const d = parse(rec.due);
    d.setFullYear(d.getFullYear() + 1);
    rec.due = iso(d);
    rec.lastDone = Date.now();
    rec.snoozeUntil = null;
  } else rec.done = true;
  return updateReminder(rec);
}
export async function snoozeReminder(rec, days = 1) {
  const d = today0(); d.setDate(d.getDate() + days);
  rec.snoozeUntil = iso(d);
  return updateReminder(rec);
}

const listeners = new Set();
export function onRemindersChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach(fn => { try { fn(); } catch {} }); }

// ---------------- system notifications (only inside the native app) ----------------
let platformP = null;
async function platform() {
  if (!platformP) platformP = import('../platform.js').catch(() => null);
  const p = await platformP;
  return p && typeof p.scheduleNotification === 'function' && (!p.isNative || p.isNative()) ? p : null;
}
export async function notificationsAvailable() { return !!(await platform()); }
function numId(s) { let x = 5381; for (const ch of s) x = ((x * 33) ^ ch.charCodeAt(0)) >>> 0; return (x % 2000000000) + 1; }
// Before the phone asks for the notification permission the first time: say in one sentence why (it comes right after).
const EXPLAINED = 'fale-notif-explained';
async function explainOnce(p) {
  try { if (localStorage.getItem(EXPLAINED) === '1') return; } catch { return; }
  if (typeof p.notificationPermission !== 'function' || (await p.notificationPermission()) !== 'prompt') return;
  try { localStorage.setItem(EXPLAINED, '1'); } catch {}
  await openDialog({
    title: 'Erinnerungen aufs Handy',
    body: `<div class="rem-explain">${oicon('bell')}<p>Damit FaLe dich rechtzeitig an deine Fristen erinnern kann, fragt dein Handy gleich, ob FaLe Mitteilungen schicken darf. Tippe dort auf „Zulassen“.</p></div>`,
    actions: [{ label: 'Weiter', value: 'ok', kind: 'btn-primary', default: true }],
  });
}
/** ask: a person just saved this Frist → explain + let the phone ask for the permission; otherwise (start, sync) never ask. */
async function schedule(rec, { ask = true } = {}) {
  const p = await platform();
  if (!p || rec.done) return;
  if (ask) await explainOnce(p);
  const ids = [];
  const leads = [...new Set([0, ...(rec.leads || [])])];
  for (const lead of leads) {
    const at = parse(rec.due); at.setDate(at.getDate() - lead); at.setHours(9, 0, 0, 0);
    if (at.getTime() <= Date.now()) continue;
    const id = numId(`${rec.id}:${lead}:${rec.due}`);
    const body = lead === 0 ? `Heute: ${typeOf(rec.type).label} am ${deDate(rec.due)}` : `${typeOf(rec.type).label} am ${deDate(rec.due)} – noch ${LEADS.find(l => l.d === lead) ? LEADS.find(l => l.d === lead).label : `${lead} Tage`}`;
    try { if (await p.scheduleNotification({ id, at, title: rec.title, body, route: '#/fristen', prompt: ask })) ids.push(id); } catch (e) { console.warn('Benachrichtigung', e); }
  }
  rec.notifIds = ids;
  rec.notified = true;
  await db.putReminder(rec);
}
async function cancel(rec) {
  const p = await platform();
  if (!p || !rec.notifIds || typeof p.cancelNotification !== 'function') return;
  for (const id of rec.notifIds) { try { await p.cancelNotification(id); } catch {} }
}
/** Called on start: schedule notifications for reminders that have none yet (e.g. created in the browser). */
export async function syncNotifications() {
  const p = await platform();
  if (!p) return;
  for (const r of await db.listReminders()) if (!r.done && !r.notified) await schedule(r, { ask: false }); // at start: never a permission prompt out of the blue
}

// ---------------- UI: editor dialog ----------------
export async function reminderDialog(init = {}) {
  const files = await db.listFiles();
  const rec = { title: '', type: 'termin', due: '', leads: [7], yearly: false, docId: null, note: '', ...init };
  const r = await openDialog({
    title: init.id ? 'Frist bearbeiten' : 'Frist hinzufügen',
    wide: true,
    body: `<div class="rem-form">
      <label class="field"><span class="field-label">Worum geht es?</span><input class="input" name="title" value="${esc(rec.title)}" placeholder="z. B. Personalausweis läuft ab" autofocus></label>
      <div class="field-row">
        <label class="field"><span class="field-label">Art</span><select class="select" name="type">${TYPES.map(t => `<option value="${t.id}" ${t.id === rec.type ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label>
        <label class="field"><span class="field-label">Datum</span><input class="input" type="date" name="due" value="${esc(rec.due)}"></label>
      </div>
      <div class="field"><span class="field-label">Erinnern</span><div class="rem-leads" role="group" aria-label="Vorlaufzeit">
        ${LEADS.map(l => `<label class="chip-check"><input type="checkbox" name="lead" value="${l.d}" ${rec.leads.includes(l.d) ? 'checked' : ''}><span>${l.label} vorher</span></label>`).join('')}
      </div><p class="hint">Am Tag selbst erinnert FaLe immer.</p></div>
      <label class="check"><input type="checkbox" name="yearly" ${rec.yearly ? 'checked' : ''}> Jedes Jahr wiederholen</label>
      <label class="field"><span class="field-label">Zugehörige Datei (optional)</span><select class="select" name="doc"><option value="">Keine</option>${files.map(f => `<option value="${esc(f.id)}" ${f.id === rec.docId ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></label>
      <label class="field"><span class="field-label">Notiz (optional)</span><input class="input" name="note" value="${esc(rec.note || '')}" placeholder="z. B. Vertragsnummer, Ansprechpartner"></label>
    </div>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Speichern', value: 'ok', kind: 'btn-primary', default: true }],
    validate: (v, dlg) => {
      if (v !== 'ok') return true;
      if (!$('[name=title]', dlg).value.trim()) { toast('Bitte gib an, worum es geht.', 'error'); return false; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test($('[name=due]', dlg).value)) { toast('Bitte wähle ein Datum.', 'error'); return false; }
      return true;
    },
    onMount: dlg => ({ collect: () => ({
      title: $('[name=title]', dlg).value.trim(), type: $('[name=type]', dlg).value, due: $('[name=due]', dlg).value,
      leads: $$('[name=lead]:checked', dlg).map(i => +i.value), yearly: $('[name=yearly]', dlg).checked, docId: $('[name=doc]', dlg).value || null, note: $('[name=note]', dlg).value,
    }) }),
  });
  if (r.value !== 'ok' || !r.data) return null;
  try {
    if (init.id) { Object.assign(rec, r.data, { leads: r.data.leads.sort((a, b) => b - a), done: false, snoozeUntil: null }); await updateReminder(rec); toast('Frist gespeichert', 'success'); return rec; }
    const out = await addReminder(r.data);
    toast(`Erinnerung für den ${deDate(out.due)} eingetragen`, 'success');
    return out;
  } catch (e) { errorToast(e, 'Die Frist konnte nicht gespeichert werden.'); return null; }
}

// ---------------- UI: cards (Start) ----------------
function remCard(r, docs, { compact = false, onChange } = {}) {
  const st = statusOf(r);
  const n = daysLeft(r.due);
  const t = typeOf(r.type);
  const doc = r.docId ? docs.find(d => d.id === r.docId) : null;
  const el = h(`<article class="rem-card st-${st}${compact ? ' compact' : ''}" data-rem="${esc(r.id)}">
    <span class="rem-ic">${oicon(t.icon)}</span>
    <div class="rem-txt"><strong>${esc(r.title)}</strong>
      <span class="rem-when"><b>${st === 'overdue' ? `Überfällig ${relText(n)}` : st === 'done' ? 'Erledigt' : relText(n)}</b> · ${esc(t.label)} am ${deDate(r.due)}${r.yearly ? ' · jährlich' : ''}</span>
      ${r.note && !compact ? `<span class="rem-note">${esc(r.note)}</span>` : ''}
      ${doc ? `<a class="rem-doc" href="${doc.kind && doc.kind !== 'pdf' ? `#/bearbeiten/${doc.id}` : `#/ansicht/${doc.id}`}">${oicon('file')}<span>${esc(doc.name)}</span></a>` : ''}
    </div>
    <div class="rem-acts">
      ${st !== 'done' ? `<button class="btn btn-soft btn-sm" type="button" data-done>${oicon('check')}<span>${r.yearly ? 'Erledigt – nächstes Jahr' : 'Erledigt'}</span></button>` : ''}
      ${!compact ? `<button class="icon-btn" type="button" data-more aria-label="Weitere Aktionen für ${esc(r.title)}">${oicon('more')}</button>` : `<button class="icon-btn" type="button" data-snooze aria-label="Morgen erinnern">${oicon('timer')}</button>`}
    </div></article>`);
  const changed = () => onChange && onChange();
  const done = $('[data-done]', el);
  if (done) done.addEventListener('click', async () => { await completeReminder(r); toast(r.yearly ? `Erledigt – nächste Erinnerung am ${deDate(r.due)}` : 'Erledigt ✓', 'success'); changed(); });
  const sn = $('[data-snooze]', el);
  if (sn) sn.addEventListener('click', async () => { await snoozeReminder(r, 1); toast('Ich erinnere dich morgen wieder.'); changed(); });
  const more = $('[data-more]', el);
  if (more) more.addEventListener('click', async () => {
    const { officeMenu } = await import('../office/kinds.js');
    officeMenu(more, [
      { label: 'Bearbeiten', icon: 'edit', onClick: async () => { if (await reminderDialog(r)) changed(); } },
      st !== 'done' ? { label: 'Morgen erinnern', icon: 'timer', onClick: async () => { await snoozeReminder(r, 1); changed(); } } : null,
      st === 'done' ? { label: 'Wieder aktivieren', icon: 'restore', onClick: async () => { r.done = false; await updateReminder(r); changed(); } } : null,
      '-',
      { label: 'Löschen', icon: 'trash', danger: true, onClick: async () => { if (await confirmDialog('Frist löschen?', `„${r.title}“ wird entfernt.`, { okLabel: 'Löschen', danger: true })) { await removeReminder(r); changed(); } } },
    ], { label: r.title });
  });
  return el;
}

/** Fill a container on the Start page with due/overdue reminders. Returns the number shown. */
export async function renderStartCards(box) {
  const [due, docs] = await Promise.all([dueReminders(), db.listFiles()]);
  // build first, then swap in one go (concurrent renders must not duplicate cards)
  if (!due.length) { box.replaceChildren(); box.hidden = true; return 0; }
  const head = h(`<div class="rem-start-head"><h2 class="section-title">${oicon('bell')} Fristen <a class="btn btn-sm btn-ghost" href="#/fristen">Alle anzeigen</a></h2></div>`);
  const list = h('<div class="rem-list"></div>');
  due.slice(0, 3).forEach(r => list.appendChild(remCard(r, docs, { compact: true, onChange: () => renderStartCards(box) })));
  if (due.length > 3) list.appendChild(h(`<a class="rem-more" href="#/fristen">+ ${due.length - 3} weitere fällige Fristen</a>`));
  box.replaceChildren(head, list);
  box.hidden = false;
  return due.length;
}

// ---------------- UI: screen ----------------
export async function mount(screen, { params }) {
  const wrap = h(`<div class="screen-inner rem-screen">
    <div class="rem-top">
      <button class="btn btn-primary" type="button" data-add>${oicon('plus')} Frist hinzufügen</button>
      <p class="muted small" data-notif></p>
    </div>
    <h2 class="section-title">Schnell eintragen</h2>
    <div class="rem-sugg" role="list"></div>
    <div data-lists></div>
  </div>`);
  screen.body.appendChild(wrap);
  screen.setFoot([]);
  $('[data-notif]', wrap).textContent = (await notificationsAvailable())
    ? 'Du bekommst zusätzlich eine Benachrichtigung auf deinem Gerät.'
    : 'Fällige Fristen erscheinen auf der Startseite, sobald du FaLe öffnest. In der installierten App kommen zusätzlich Benachrichtigungen.';
  const sugg = $('.rem-sugg', wrap);
  SUGGESTIONS.forEach(s => {
    const b = h(`<button class="lt-chip" type="button" role="listitem">${oicon(s.icon)}<span>${esc(s.title)}</span></button>`);
    b.addEventListener('click', async () => {
      let due = '';
      if (s.dueMD) { const y = new Date().getFullYear(); due = `${y}-${s.dueMD}`; if (daysLeft(due) < 0) due = `${y + 1}-${s.dueMD}`; }
      if (await reminderDialog({ title: s.title, type: s.type, leads: s.leads, yearly: !!s.yearly, due })) render();
    });
    sugg.appendChild(b);
  });
  $('[data-add]', wrap).addEventListener('click', async () => { if (await reminderDialog({ docId: params && params.get('doc') })) render(); });
  async function render() {
    const all = await listAll();
    const docs = await db.listFiles();
    const box = $('[data-lists]', wrap);
    box.innerHTML = '';
    if (!all.length) {
      box.appendChild(h(`<div class="empty"><div class="empty-art">${oicon('bell')}</div><h3>Noch keine Fristen</h3><p>Trage Ablaufdaten, Kündigungsfristen und Zahlungstermine ein – FaLe erinnert dich rechtzeitig. Tipp: Im Menü jeder Datei gibt es „Frist hinzufügen“.</p></div>`));
      return;
    }
    const groups = [['overdue', 'Überfällig'], ['due', 'Demnächst'], ['later', 'Später'], ['done', 'Erledigt']];
    for (const [st, title] of groups) {
      const items = all.filter(r => statusOf(r) === st);
      if (!items.length) continue;
      const sec = h(`<section class="rem-group g-${st}"><h2 class="section-title">${title} <span class="count-pill">${items.length}</span></h2><div class="rem-list"></div></section>`);
      items.forEach(r => $('.rem-list', sec).appendChild(remCard(r, docs, { onChange: render })));
      box.appendChild(sec);
    }
  }
  await render();
  if (params && params.get('neu') === '1') setTimeout(async () => { if (await reminderDialog({ docId: params.get('doc') })) render(); }, 50);
  const off = onRemindersChange(render);
  return () => off();
}

export { longDate, kindTile };
