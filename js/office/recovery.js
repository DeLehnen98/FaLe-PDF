// Crash-safe recovery for the office editors (document, spreadsheet, presentation).
// While an editor has unsaved changes, a snapshot of the file is written to this device every minute and
// whenever the app goes to the background (Android may kill it there without warning). A normal save, or
// leaving the editor on purpose, removes the snapshot. Whatever is left at the next start came from a crash
// or a killed app and is offered for restore – restored files are saved as new files, nothing is overwritten.
import * as db from '../db.js';
import { esc, toast, errorToast, openDialog } from '../ui.js';
import { saveFile } from '../library.js';
import { KINDS, stripExt } from './kinds.js';
import { locale } from '../i18n/index.js';

const INTERVAL = 60000;
export const live = new Set(); // keys of editors open right now (never offered for restore)

/**
 * Attach recovery to an editor shell. S: shell state ({ id, name, kind, dirty, saving }), serialize: () => Blob.
 * → { touch() on every change, saved() after a save, dispose() when the editor closes on purpose }
 */
export function attachRecovery(S, serialize) {
  const key = db.uid();
  live.add(key);
  let changedAt = 0, snapAt = 0, wrote = false, busy = false, disposed = false;
  async function snapshot() {
    if (disposed || busy || !S.dirty || S.saving || changedAt <= snapAt) return;
    busy = true;
    const at = Date.now();
    try {
      const blob = await serialize();
      if (disposed || !S.dirty) return;
      await db.putRecovery(key, { docId: S.id || null, name: S.name, kind: S.kind, at, blob });
      snapAt = at; wrote = true;
    } catch (e) { console.warn('recovery snapshot', e); } finally { busy = false; }
  }
  const timer = setInterval(snapshot, INTERVAL);
  const onHide = () => { if (document.visibilityState === 'hidden') snapshot(); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', snapshot);
  const drop = () => { if (wrote) { wrote = false; db.deleteRecovery(key); } };
  return {
    touch() { changedAt = Date.now(); },
    saved() { snapAt = changedAt = 0; drop(); },
    snapshot,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', snapshot);
      live.delete(key);
      drop();
    },
  };
}

const when = at => new Date(at).toLocaleString(locale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** At app start: offer what an earlier session left behind. */
export async function offerRecovery() {
  const found = (await db.listRecovery()).filter(r => !live.has(r.key) && r.blob && KINDS[r.kind]);
  if (!found.length) return;
  const one = found.length === 1;
  const list = found.map(r => `<li><strong>${esc(r.name || 'Unbenannt')}</strong> <span class="muted small">– ${esc(when(r.at))}</span></li>`).join('');
  const r = await openDialog({
    title: one ? 'Ungespeicherte Änderungen gefunden' : `${found.length} ungespeicherte Dokumente gefunden`,
    body: `<p>FaLe PDF wurde beendet, bevor diese Änderungen gespeichert wurden. Beim Wiederherstellen wird jeweils eine neue Datei angelegt – deine gespeicherte Fassung bleibt unverändert.</p><ul class="rec-list">${list}</ul>`,
    actions: [
      { label: 'Verwerfen', value: 'drop', kind: 'btn-danger-ghost' },
      { label: 'Später', value: 'later' },
      { label: 'Wiederherstellen', value: 'restore', kind: 'btn-primary', default: true },
    ],
  });
  if (r.value === 'drop') {
    for (const f of found) await db.deleteRecovery(f.key);
    toast('Verworfen', 'success');
    return;
  }
  if (r.value !== 'restore') return;
  let last = null;
  for (const f of found) {
    try {
      const k = KINDS[f.kind];
      last = await saveFile({ blob: f.blob, name: `${stripExt(f.name || 'Dokument')} (wiederhergestellt)${k.ext}`, kind: f.kind, source: 'Wiederhergestellt' });
      await db.deleteRecovery(f.key);
    } catch (e) { errorToast(e, `„${f.name}“ konnte nicht wiederhergestellt werden.`); }
  }
  if (!last) return;
  if (one) location.hash = `#/bearbeiten/${last.id}`;
  else toast(`${found.length} Dokumente wiederhergestellt – du findest sie unter „Zuletzt“.`, 'success');
}
