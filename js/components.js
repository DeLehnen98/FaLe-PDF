// Reusable UI components: document rows, menus for documents, doc picker, result cards.
import * as db from './db.js';
import { icon } from './icons.js';
import { esc, h, formatSize, formatDate, pagesLabel, showMenu, promptDialog, confirmDialog, toast, downloadBlob, shareBlob, openDialog, errorToast, pickFiles, $, $$ } from './ui.js';
import { thumbUrl, dropThumb, emitChange, importFiles } from './library.js';

export function thumbHtml(doc) {
  const url = thumbUrl(doc);
  return `<span class="doc-thumb">${url ? `<img src="${url}" alt="" loading="lazy" decoding="async">` : icon('page')}</span>`;
}

export function docMeta(doc) {
  return `${doc.encrypted ? `<span class="lock" title="Passwortgeschützt">${icon('lock')}</span> ` : ''}${pagesLabel(doc.pages)} · ${formatSize(doc.size)} · ${formatDate(doc.openedAt || doc.createdAt)}`;
}

export function docRow(doc, { onOpen } = {}) {
  const el = h(`<article class="doc" data-id="${esc(doc.id)}">
    <button class="doc-open" type="button" aria-label="${esc(doc.name)} öffnen">
      ${thumbHtml(doc)}
      <span class="doc-info"><span class="doc-name">${esc(doc.name)}</span><span class="doc-meta">${docMeta(doc)}</span></span>
    </button>
    <button class="icon-btn star-btn" type="button" aria-pressed="${doc.starred ? 'true' : 'false'}" aria-label="${doc.starred ? 'Markierung entfernen' : 'Markieren'}">${icon('star')}</button>
    <button class="icon-btn more-btn" type="button" aria-label="Weitere Aktionen für ${esc(doc.name)}">${icon('more')}</button>
  </article>`);
  el.querySelector('.doc-open').addEventListener('click', () => (onOpen ? onOpen(doc) : (location.hash = `#/ansicht/${doc.id}`)));
  el.querySelector('.star-btn').addEventListener('click', async e => {
    const btn = e.currentTarget;
    const starred = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(starred));
    btn.setAttribute('aria-label', starred ? 'Markierung entfernen' : 'Markieren');
    await db.updateDoc(doc.id, { starred });
    doc.starred = starred;
    toast(starred ? 'Markiert' : 'Markierung entfernt');
    emitChange();
  });
  el.querySelector('.more-btn').addEventListener('click', e => docMenu(e.currentTarget, doc));
  return el;
}

export function docMenu(anchor, doc) {
  showMenu(anchor, [
    { label: 'Öffnen', icon: 'open', onClick: () => (location.hash = `#/ansicht/${doc.id}`) },
    { label: 'Umbenennen', icon: 'edit', onClick: () => renameDoc(doc) },
    { label: 'Teilen', icon: 'share', onClick: () => shareDoc(doc) },
    { label: 'Herunterladen', icon: 'download', onClick: () => downloadDoc(doc) },
    '-',
    { label: 'Ausfüllen & unterschreiben', icon: 'sign', onClick: () => (location.hash = `#/werkzeug/unterschreiben?doc=${doc.id}`) },
    { label: 'Seiten verwalten', icon: 'pages', onClick: () => (location.hash = `#/werkzeug/seiten?doc=${doc.id}`) },
    '-',
    { label: 'Löschen', icon: 'trash', danger: true, onClick: () => deleteDocConfirm(doc) },
  ], { label: `Aktionen für ${doc.name}` });
}

export async function renameDoc(doc) {
  const name = await promptDialog('Umbenennen', 'Neuer Name', doc.name, { okLabel: 'Speichern' });
  if (name === null) return;
  let n = name.trim().replace(/[\\/:*?"<>|]+/g, ' ');
  if (!n) { toast('Der Name darf nicht leer sein.', 'error'); return; }
  if (!/\.pdf$/i.test(n)) n += '.pdf';
  await db.updateDoc(doc.id, { name: n });
  doc.name = n;
  toast('Umbenannt', 'success');
  emitChange();
}

export async function shareDoc(doc) {
  try {
    const blob = await db.getFile(doc.id);
    if (!blob) throw new Error('missing');
    await shareBlob(blob, doc.name);
  } catch (e) { errorToast(e, 'Teilen fehlgeschlagen.'); }
}

export async function downloadDoc(doc) {
  try {
    const blob = await db.getFile(doc.id);
    if (!blob) throw new Error('missing');
    downloadBlob(blob, doc.name);
  } catch (e) { errorToast(e, 'Download fehlgeschlagen.'); }
}

export async function deleteDocConfirm(doc) {
  const ok = await confirmDialog('Dokument löschen?', `„${doc.name}“ wird von diesem Gerät entfernt.`, { okLabel: 'Löschen', danger: true });
  if (!ok) return false;
  await db.deleteDoc(doc.id);
  dropThumb(doc.id);
  toast('Dokument gelöscht');
  emitChange();
  return true;
}

/** Dialog: pick one or more documents from the library (or from the device). */
export async function pickDocsDialog({ multi = false, title, exclude = [] } = {}) {
  let docs = (await db.listDocs()).filter(d => !exclude.includes(d.id));
  const preselect = new Set();
  const r = await openDialog({
    title: title || (multi ? 'Dokumente wählen' : 'Dokument wählen'),
    wide: true,
    body: '<div class="pick-wrap"></div>',
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: multi ? 'Hinzufügen' : 'Auswählen', value: 'ok', kind: 'btn-primary', default: true }],
    validate: (v, dlg) => {
      if (v !== 'ok') return true;
      const n = $$('input:checked', dlg).length;
      if (!n) { toast('Bitte wähle mindestens ein Dokument.', 'error'); return false; }
      return true;
    },
    onMount: dlg => {
      const wrap = $('.pick-wrap', dlg);
      const render = () => {
        wrap.innerHTML = '';
        const fromDevice = h(`<button class="btn btn-soft btn-block" type="button">${icon('open')} Vom Gerät hinzufügen</button>`);
        fromDevice.addEventListener('click', async () => {
          const files = await pickFiles({ parent: wrap });
          if (!files.length) return;
          const added = await importFiles(files, { source: 'Gerät' });
          added.forEach(d => preselect.add(d.id));
          docs = (await db.listDocs()).filter(d => !exclude.includes(d.id));
          render();
        });
        wrap.appendChild(fromDevice);
        if (!docs.length) { wrap.appendChild(h('<p class="panel-empty">Noch keine Dokumente in deiner Bibliothek.</p>')); return; }
        const list = h('<div class="pick-list" role="group" aria-label="Dokumente"></div>');
        docs.forEach((d, i) => {
          const checked = preselect.has(d.id) || (!multi && i === 0 && !preselect.size);
          list.appendChild(h(`<label class="pick-item">
            <input type="${multi ? 'checkbox' : 'radio'}" name="doc" value="${esc(d.id)}" ${checked ? 'checked' : ''}>
            ${thumbHtml(d)}<span class="doc-info"><span class="doc-name">${esc(d.name)}</span><span class="doc-meta">${docMeta(d)}</span></span></label>`));
        });
        wrap.prepend(list);
      };
      render();
      return { collect: () => $$('input:checked', dlg).map(i => i.value) };
    },
  });
  return r.value === 'ok' ? r.data : null;
}

/** Result card shown after a tool produced a new document. */
export function resultCard(doc, { title = 'Fertig', note = '' } = {}) {
  const el = h(`<div class="card result-card" role="status">
    ${thumbHtml(doc)}
    <div class="grow"><div class="result-title">${icon('check')} ${esc(title)}</div>
      <div class="doc-name">${esc(doc.name)}</div><div class="doc-meta">${docMeta(doc)}${note ? ' · ' + esc(note) : ''}</div></div>
    <div class="actions">
      <button class="btn btn-primary btn-sm" type="button" data-r="open">${icon('open')} Öffnen</button>
      <button class="btn btn-ghost btn-sm" type="button" data-r="dl">${icon('download')} Herunterladen</button>
      <button class="btn btn-ghost btn-sm" type="button" data-r="share">${icon('share')} Teilen</button>
    </div></div>`);
  el.querySelector('[data-r="open"]').addEventListener('click', () => (location.hash = `#/ansicht/${doc.id}`));
  el.querySelector('[data-r="dl"]').addEventListener('click', () => downloadDoc(doc));
  el.querySelector('[data-r="share"]').addEventListener('click', () => shareDoc(doc));
  return el;
}

/** Drag-and-drop reordering for a list of elements (desktop) — calls onMove(from, to). */
export function enableDragReorder(container, itemSelector, onMove) {
  let dragIdx = -1;
  container.addEventListener('dragstart', e => {
    const item = e.target.closest(itemSelector);
    if (!item) return;
    dragIdx = $$(itemSelector, container).indexOf(item);
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(dragIdx)); } catch {}
  });
  container.addEventListener('dragover', e => {
    if (dragIdx < 0) return;
    e.preventDefault();
    const item = e.target.closest(itemSelector);
    $$('.drop-before', container).forEach(x => x.classList.remove('drop-before'));
    if (item) item.classList.add('drop-before');
  });
  container.addEventListener('dragleave', e => { if (!container.contains(e.relatedTarget)) $$('.drop-before', container).forEach(x => x.classList.remove('drop-before')); });
  container.addEventListener('drop', e => {
    if (dragIdx < 0) return;
    e.preventDefault();
    e.stopPropagation();
    const items = $$(itemSelector, container);
    const item = e.target.closest(itemSelector);
    let to = items.length - 1;
    if (item) { to = items.indexOf(item); if (to > dragIdx) to -= 1; }
    $$('.drop-before', container).forEach(x => x.classList.remove('drop-before'));
    const from = dragIdx;
    dragIdx = -1;
    if (to !== from && to >= 0) onMove(from, to);
  });
  container.addEventListener('dragend', () => {
    dragIdx = -1;
    $$('.dragging, .drop-before', container).forEach(x => x.classList.remove('dragging', 'drop-before'));
  });
}

export function moveItem(arr, from, to) {
  const [x] = arr.splice(from, 1);
  arr.splice(to, 0, x);
  return arr;
}
