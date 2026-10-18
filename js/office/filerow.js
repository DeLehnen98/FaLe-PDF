// Library rows for all file kinds (same structure/classes as the PDF rows).
import * as db from '../db.js';
import { esc, h, formatSize, formatDate, pagesLabel, showMenu, promptDialog, confirmDialog, toast, downloadBlob, shareBlob, errorToast } from '../ui.js';
import { thumbUrl, dropThumb, emitChange } from '../library.js';
import { officeMenu, oicon, kindOf, kindInfo, kindTile, openHash, ensureExt, KINDS } from './kinds.js';

// tags + AI capabilities are loaded asynchronously by the views; rows render synchronously with what is known
let TAGS = [];
export function setRowTags(list) { TAGS = Array.isArray(list) ? list : []; }
let AI = { summarize: false, translate: false };
import('../extras/ai.js').then(m => m.aiCapabilities()).then(c => { AI = c || AI; }).catch(() => {});

export function fileThumb(doc) {
  const url = thumbUrl(doc);
  const kind = kindOf(doc);
  const badge = kind !== 'pdf' && kind !== 'image' ? `<span class="kind-badge" style="--kc:${KINDS[kind].color}">${KINDS[kind].short}</span>` : '';
  if (url) return `<span class="doc-thumb${kind === 'pptx' ? ' wide' : ''}"><img src="${url}" alt="" loading="lazy" decoding="async">${badge}</span>`;
  return `<span class="doc-thumb kind">${kindTile(kind)}</span>`;
}

export function fileMeta(doc) {
  const kind = kindOf(doc);
  const k = kindInfo(doc);
  let what = '';
  if (kind === 'pdf') what = pagesLabel(doc.pages);
  else if ((kind === 'xlsx') && doc.pages) what = doc.pages === 1 ? '1 Blatt' : `${doc.pages} Blätter`;
  else if (kind === 'pptx' && doc.pages) what = `${doc.pages} Folie${doc.pages === 1 ? '' : 'n'}`;
  else what = k.label;
  return `${doc.encrypted ? `<span class="lock" title="Passwortgeschützt">${oicon('lock')}</span> ` : ''}${what} · ${formatSize(doc.size)} · ${formatDate(doc.openedAt || doc.createdAt)}`;
}

export function fileRow(doc) {
  const kind = kindOf(doc);
  const el = h(`<article class="doc kind-${kind}" data-id="${esc(doc.id)}" data-kind="${kind}">
    <button class="doc-open" type="button" aria-label="${esc(doc.name)} öffnen">
      ${fileThumb(doc)}
      <span class="doc-info"><span class="doc-name">${esc(doc.name)}</span><span class="doc-meta">${fileMeta(doc)}</span>${tagRow(doc)}</span>
    </button>
    <button class="icon-btn star-btn" type="button" aria-pressed="${doc.starred ? 'true' : 'false'}" aria-label="${doc.starred ? 'Markierung entfernen' : 'Markieren'}">${oicon('star')}</button>
    <button class="icon-btn more-btn" type="button" aria-label="Weitere Aktionen für ${esc(doc.name)}">${oicon('more')}</button>
  </article>`);
  el.querySelector('.doc-open').addEventListener('click', () => { location.hash = openHash(doc); });
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
  el.querySelector('.more-btn').addEventListener('click', e => fileMenu(e.currentTarget, doc));
  // long-press (touch) / right-click opens the same menu
  el.querySelector('.doc-open').addEventListener('contextmenu', e => { e.preventDefault(); fileMenu(el.querySelector('.more-btn'), doc); });
  return el;
}

function tagRow(doc) {
  const list = (doc.tags || []).map(id => TAGS.find(t => t.id === id)).filter(Boolean);
  if (!list.length) return '';
  return `<span class="doc-tags">${list.map(t => `<span class="tag-dot" style="--tc:${t.color}">${esc(t.name)}</span>`).join('')}</span>`;
}

export function fileMenu(anchor, doc) {
  const kind = kindOf(doc);
  const cat = kindInfo(doc).cat;
  const items = [
    { label: kind === 'pdf' || kind === 'image' ? 'Öffnen' : 'Öffnen & bearbeiten', icon: 'open', onClick: () => { location.hash = openHash(doc); } },
    { label: 'Umbenennen', icon: 'edit', onClick: () => renameFile(doc) },
    { label: 'Teilen', icon: 'share', onClick: () => shareFile(doc) },
    { label: 'Herunterladen', icon: 'download', onClick: () => downloadFile(doc) },
    { label: 'Sicher teilen (Link)', icon: 'link', onClick: () => { location.hash = `#/teilen/link?doc=${encodeURIComponent(doc.id)}`; } }, // js/share
    ...(kind === 'pdf' ? [{ label: 'Unterschrift anfordern', icon: 'sign', onClick: () => { location.hash = `#/teilen/unterschrift?doc=${encodeURIComponent(doc.id)}`; } }] : []),
    '-',
  ];
  if (kind === 'pdf') {
    items.push(
      { label: 'Ausfüllen & unterschreiben', icon: 'sign', onClick: () => { location.hash = `#/werkzeug/unterschreiben?doc=${doc.id}`; } },
      { label: 'Seiten verwalten', icon: 'pages', onClick: () => { location.hash = `#/werkzeug/seiten?doc=${doc.id}`; } },
      { label: 'In Excel-Tabelle umwandeln', icon: 'ksheet', onClick: () => { location.hash = `#/werkzeug/pdf-excel?doc=${doc.id}`; } },
    );
  } else if (cat === 'doc') items.push({ label: 'In PDF umwandeln', icon: 'kpdf', onClick: () => { location.hash = `#/werkzeug/word-pdf?doc=${doc.id}`; } });
  else if (cat === 'sheet') items.push({ label: 'In PDF umwandeln', icon: 'kpdf', onClick: () => { location.hash = `#/werkzeug/excel-pdf?doc=${doc.id}`; } });
  else if (cat === 'slides') items.push({ label: 'In PDF umwandeln', icon: 'kpdf', onClick: () => { location.hash = `#/werkzeug/ppt-pdf?doc=${doc.id}`; } });
  else if (kind === 'image') items.push({ label: 'In PDF umwandeln', icon: 'kpdf', onClick: () => { location.hash = openHash(doc); } });
  // FaleNetwork web tools that can open this file (js/webtools/list.js)
  items.push({ label: 'Mehr Werkzeuge …', icon: 'tools', onClick: () => import('../webtools/list.js').then(m => m.chooseWebTool(doc)) });
  if (AI.summarize && ['pdf', 'docx', 'txt', 'md'].includes(kind)) items.push({ label: 'Zusammenfassen (auf dem Gerät)', icon: 'summary', onClick: () => import('../extras/ai.js').then(m => m.aiForDoc(doc, 'summarize')) });
  if (AI.translate && ['pdf', 'docx', 'txt', 'md'].includes(kind)) items.push({ label: 'Übersetzen (auf dem Gerät)', icon: 'translate', onClick: () => import('../extras/ai.js').then(m => m.aiForDoc(doc, 'translate')) });
  items.push('-',
    { label: 'In Ordner verschieben …', icon: 'folderMove', onClick: () => import('../extras/organize.js').then(m => m.folderDialog([doc])) },
    { label: 'Tags …', icon: 'tag', onClick: () => import('../extras/organize.js').then(m => m.tagsDialog(doc)) },
    { label: 'Frist hinzufügen …', icon: 'bell', onClick: () => import('../extras/reminders.js').then(m => m.reminderDialog({ docId: doc.id, title: '' })) },
    { label: 'In den Tresor verschieben', icon: 'vault', onClick: () => moveToVault(doc) },
  );
  items.push('-', { label: 'Löschen', icon: 'trash', danger: true, onClick: () => deleteFileConfirm(doc) });
  officeMenu(anchor, items, { label: `Aktionen für ${doc.name}` });
}

export async function renameFile(doc) {
  const name = await promptDialog('Umbenennen', 'Neuer Name', doc.name, { okLabel: 'Speichern' });
  if (name === null) return;
  let n = name.trim().replace(/[\\/:*?"<>|]+/g, ' ');
  if (!n) { toast('Der Name darf nicht leer sein.', 'error'); return; }
  n = ensureExt(n, kindOf(doc));
  await db.updateDoc(doc.id, { name: n });
  doc.name = n;
  toast('Umbenannt', 'success');
  emitChange();
}

export async function shareFile(doc) {
  try {
    const blob = await db.getFile(doc.id);
    if (!blob) throw new Error('missing');
    await shareBlob(blob, doc.name, blob.type || kindInfo(doc).mime);
  } catch (e) { errorToast(e, 'Teilen fehlgeschlagen.'); }
}

export async function downloadFile(doc) {
  try {
    const blob = await db.getFile(doc.id);
    if (!blob) throw new Error('missing');
    downloadBlob(blob, doc.name);
  } catch (e) { errorToast(e, 'Download fehlgeschlagen.'); }
}

export async function deleteFileConfirm(doc) {
  const ok = await confirmDialog('Datei löschen?', `„${doc.name}“ kommt in den Papierkorb und wird nach 30 Tagen endgültig entfernt.`, { okLabel: 'Löschen', danger: true });
  if (!ok) return false;
  await db.deleteDoc(doc.id);
  dropThumb(doc.id);
  toast('In den Papierkorb verschoben', 'info', { action: { label: 'Rückgängig', onClick: async () => { await db.restoreFromTrash(doc.id); emitChange(); } } });
  emitChange();
  return true;
}

export async function moveToVault(doc) {
  const v = await import('../extras/vault.js');
  if (!(await v.isSetUp())) { location.hash = `#/tresor?add=${encodeURIComponent(doc.id)}`; return; }
  if (!(await v.ensureUnlocked())) return;
  try {
    await v.moveDocsToVault([doc.id]);
    toast(`„${doc.name}“ liegt jetzt verschlüsselt im Tresor.`, 'success', { action: { label: 'Tresor öffnen', onClick: () => { location.hash = '#/tresor'; } } });
  } catch (e) { errorToast(e, 'Verschieben in den Tresor fehlgeschlagen.'); }
}
