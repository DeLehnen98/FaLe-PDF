// „Ausfüllen & unterschreiben“: entries that are not saved yet survive a closed or killed app.
// While a document has unsaved entries they are written to this device (settings store – never synced, never
// uploaded) a moment after every change and when the app goes to the background, where Android may end it without
// warning. Saving or discarding removes them. Whatever is left is put back the next time the document is opened
// in the tool, and it is offered once at the next start of the app.
import * as db from '../db.js';

const PREFIX = 'signdraft:';

export async function putDraft(docId, rec) {
  try { await db.putDeviceSetting(PREFIX + docId, { docId, at: Date.now(), ...rec }); } catch (e) { console.warn('Entwurf', e); }
}
export function getDraft(docId) { return db.getDeviceSetting(PREFIX + docId, null); }
export function dropDraft(docId) { return db.deleteDeviceSetting(PREFIX + docId); }
export async function listDrafts() {
  const rows = await db.listDeviceSettings(PREFIX);
  return rows.map(r => r.value).filter(d => d && d.docId).sort((a, b) => (b.at || 0) - (a.at || 0));
}

/** At app start: say that unsaved entries are still there (drafts of deleted documents are removed quietly). */
export async function offerDrafts() {
  const drafts = await listDrafts();
  if (!drafts.length) return;
  const openNow = (location.hash.match(/^#\/werkzeug\/unterschreiben\?(?:[^#]*&)?doc=([^&#]+)/) || [])[1];
  const found = [];
  for (const d of drafts) {
    const meta = await db.getDoc(d.docId).catch(() => null);
    if (!meta) { await dropDraft(d.docId); continue; }
    if (d.docId !== openNow) found.push({ ...d, name: meta.name });
  }
  if (!found.length) return;
  const { esc, openDialog, toast } = await import('../ui.js');
  const { locale } = await import('../i18n/index.js');
  const when = at => new Date(at).toLocaleString(locale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const list = found.map(d => `<li><strong>${esc(d.name || 'Unbenannt')}</strong> <span class="muted small">– ${esc(when(d.at))}</span></li>`).join('');
  const r = await openDialog({
    title: 'Nicht gespeicherte Einträge gefunden',
    body: `<p>Du hast etwas ausgefüllt, aber noch nicht gespeichert. Deine Einträge sind noch da.</p><ul class="rec-list">${list}</ul>`,
    actions: [
      { label: 'Verwerfen', value: 'drop', kind: 'btn-danger-ghost' },
      { label: 'Später', value: 'later' },
      { label: 'Weiter ausfüllen', value: 'open', kind: 'btn-primary', default: true },
    ],
  });
  if (r.value === 'drop') {
    for (const d of found) await dropDraft(d.docId);
    toast('Verworfen', 'success');
  } else if (r.value === 'open') {
    location.hash = `#/werkzeug/unterschreiben?doc=${found[0].docId}`;
  }
}
