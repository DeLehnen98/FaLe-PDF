// Shared chrome for the office editors: title/rename, dirty state, save, export results, leave guard.
import * as db from '../db.js';
import { esc, h, toast, errorToast, promptDialog, openDialog, downloadBlob, shareBlob, progress, safeFileName } from '../ui.js';
import { saveFile, saveResult, emitChange } from '../library.js';
import { KINDS, ensureExt, stripExt, oicon, officeMenu } from './kinds.js';
import { track } from '../extras/stats.js';

export function setHashSilently(hash) {
  if (location.hash === hash) return;
  history.replaceState(history.state, '', hash);
  window.dispatchEvent(new CustomEvent('fale:hash-replaced', { detail: hash }));
}

/**
 * @param screen tool screen from openScreen()
 * @param opts { id, name, kind, serialize: async () => Blob, menu: () => items[], onSaved }
 */
export function createShell(screen, opts) {
  const S = {
    id: opts.id || null,
    name: opts.name,
    kind: opts.kind,
    dirty: false,
    saving: false,
  };
  const head = screen.head;
  head.classList.add('office-head');
  const titleEl = head.querySelector('.screen-title');
  const subEl = head.querySelector('.sub');
  // title becomes a rename button
  const titleBtn = h(`<button class="title-btn" type="button" aria-label="Dokument umbenennen"></button>`);
  titleEl.textContent = '';
  titleEl.appendChild(titleBtn);
  const paint = () => {
    titleBtn.textContent = S.name;
    subEl.textContent = S.saving ? 'Wird gespeichert …' : S.dirty ? 'Nicht gespeichert' : S.id ? 'Gespeichert auf diesem Gerät' : 'Neu – noch nicht gespeichert';
    subEl.classList.toggle('unsaved', S.dirty);
  };
  titleBtn.addEventListener('click', () => rename());

  const saveBtn = h(`<button class="btn btn-primary btn-sm save-btn" type="button" data-office-save>${oicon('check')}<span class="hide-sm">Speichern</span></button>`);
  saveBtn.setAttribute('aria-label', 'Speichern');
  const moreBtn = h(`<button class="icon-btn" type="button" data-office-more aria-label="Weitere Aktionen">${oicon('more')}</button>`);
  screen.extra.append(saveBtn, moreBtn);
  saveBtn.addEventListener('click', () => save());
  moreBtn.addEventListener('click', () => {
    officeMenu(moreBtn, opts.menu ? opts.menu() : [], { label: 'Weitere Aktionen' });
  });

  const onKey = e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  };
  document.addEventListener('keydown', onKey);
  const onUnload = e => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', onUnload);
  screen.isDirty = () => S.dirty;
  screen.officeCleanup = () => { document.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onUnload); };

  async function rename() {
    const n = await promptDialog('Umbenennen', 'Name', S.name, { okLabel: 'Übernehmen' });
    if (n == null) return;
    const clean = safeFileName(n.trim());
    if (!clean) { toast('Der Name darf nicht leer sein.', 'error'); return; }
    S.name = ensureExt(clean, S.kind);
    if (S.id) { await db.updateDoc(S.id, { name: S.name }); emitChange(); }
    paint();
  }

  async function save({ asCopy = false } = {}) {
    if (S.saving) return null;
    S.saving = true; paint();
    saveBtn.disabled = true;
    try {
      let name = S.name;
      if (asCopy) {
        const n = await promptDialog('Kopie speichern', 'Name der Kopie', `${stripExt(S.name)} (Kopie)${KINDS[S.kind].ext}`, { okLabel: 'Speichern' });
        if (n == null) return null;
        name = ensureExt(safeFileName(n), S.kind);
      }
      const blob = await opts.serialize();
      const meta = await saveFile({ id: asCopy ? null : S.id, blob, name, kind: S.kind });
      if (!asCopy) {
        S.id = meta.id; S.dirty = false;
        setHashSilently(`#/bearbeiten/${meta.id}`);
      }
      toast(asCopy ? `Kopie „${meta.name}“ gespeichert` : 'Gespeichert', 'success');
      opts.onSaved && opts.onSaved(meta);
      return meta;
    } catch (e) {
      errorToast(e, 'Speichern fehlgeschlagen.');
      return null;
    } finally {
      S.saving = false; saveBtn.disabled = false; paint();
    }
  }

  function markDirty() { if (!S.dirty) { S.dirty = true; paint(); } }
  paint();
  return {
    S, save, rename, markDirty, paint,
    get name() { return S.name; },
    get id() { return S.id; },
    setClean() { S.dirty = false; paint(); },
    async saveAsKind(blob, kind, suffix = '') {
      const meta = await saveFile({ blob, name: stripExt(S.name) + suffix + KINDS[kind].ext, kind });
      toast(`„${meta.name}“ gespeichert`, 'success', { action: { label: 'Öffnen', onClick: () => { location.hash = `#/bearbeiten/${meta.id}`; } } });
      return meta;
    },
  };
}

/** Run a PDF export with progress, store it in the library and show the result dialog. */
export async function exportPdfFlow(name, makeBytes) {
  const prog = progress('PDF wird erstellt …');
  let doc;
  try {
    const bytes = await makeBytes(p => prog.set(`PDF wird erstellt … ${Math.round(p * 100)} %`));
    doc = await saveResult(bytes, stripExt(name) + '.pdf');
    track('pdf_exported');
  } catch (e) {
    prog.done();
    errorToast(e, 'Die PDF konnte nicht erstellt werden.');
    return null;
  }
  prog.done();
  await resultDialog(doc, 'PDF erstellt', 'Die PDF wurde in deinen Dateien gespeichert.');
  return doc;
}

export async function resultDialog(doc, title, text) {
  const r = await openDialog({
    title,
    body: `<div class="result-mini">${oicon('check')}<div><strong>${esc(doc.name)}</strong><p class="muted small">${esc(text)}</p></div></div>`,
    actions: [
      { label: 'Teilen', value: 'share' },
      { label: 'Herunterladen', value: 'dl' },
      { label: 'Öffnen', value: 'open', kind: 'btn-primary', default: true },
    ],
  });
  if (!r.value) return;
  const blob = await db.getFile(doc.id);
  const k = KINDS[doc.kind || 'pdf'];
  if (r.value === 'open') location.hash = (doc.kind || 'pdf') === 'pdf' ? `#/ansicht/${doc.id}` : `#/bearbeiten/${doc.id}`;
  if (r.value === 'dl') downloadBlob(blob, doc.name);
  if (r.value === 'share') shareBlob(blob, doc.name, k.mime);
}

export function download(blob, name) { downloadBlob(blob, name); }

/** A toolbar button. */
export function tb(iconName, label, attrs = '') {
  return `<button class="tb" type="button" aria-label="${esc(label)}" title="${esc(label)}" ${attrs}>${oicon(iconName)}</button>`;
}
