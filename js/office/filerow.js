// Library rows for all file kinds (same structure/classes as the PDF rows).
import * as db from '../db.js';
import { esc, h, formatSize, formatDate, pagesLabel, showMenu, promptDialog, confirmDialog, toast, downloadBlob, shareBlob, errorToast } from '../ui.js';
import { thumbUrl, dropThumb, emitChange } from '../library.js';
import { aiMenusHidden } from '../ai/hidden.js';
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

/** The ⋮ menu of a file: the file itself on top (name can be changed right there), the four most used actions as
 *  big buttons, then the rest in clear groups – „Löschen“ always last. */
export function fileMenu(anchor, doc) {
  const kind = kindOf(doc);
  const cat = kindInfo(doc).cat;
  const go = hash => () => { location.hash = hash; };
  const id = encodeURIComponent(doc.id);
  const tool = t => go(`#/werkzeug/${t}?doc=${id}`);
  const viewable = kind === 'pdf' || kind === 'image';
  const quick = [
    { label: viewable ? 'Öffnen' : 'Bearbeiten', icon: viewable ? 'open' : 'edit', onClick: go(openHash(doc)) },
    { label: 'Teilen', icon: 'share', onClick: () => shareFile(doc) },
    { label: doc.starred ? 'Stern entfernen' : 'Stern setzen', icon: 'star', pressed: !!doc.starred, onClick: () => toggleStar(doc) },
    { label: 'In Ordner', icon: 'folderMove', onClick: () => import('../extras/organize.js').then(m => m.folderDialog([doc])) },
  ];
  const items = [];
  if (kind === 'pdf') {
    items.push({ section: 'Bearbeiten' },
      { label: 'Ausfüllen & unterschreiben', hint: 'Formular ausfüllen, Unterschrift setzen', icon: 'sign', onClick: tool('unterschreiben') },
      { label: 'PDF bearbeiten', hint: 'Text ändern oder hinzufügen', icon: 'edit', onClick: tool('bearbeiten') },
      { label: 'Kommentieren', hint: 'Markieren, Notizen, Zeichnen', icon: 'comment', onClick: tool('kommentieren') },
      { label: 'Seiten verwalten', hint: 'Drehen, sortieren, entfernen', icon: 'pages', onClick: tool('seiten') });
  }
  items.push({ section: 'Umwandeln & mehr' });
  if (kind === 'pdf') {
    items.push(
      { label: 'In Word umwandeln', icon: 'kdoc', onClick: tool('pdf-word') },
      { label: 'In Excel umwandeln', icon: 'ksheet', onClick: tool('pdf-excel') },
      { label: 'PDF verkleinern', icon: 'compress', onClick: tool('komprimieren') },
      { label: 'Mit Passwort schützen', icon: 'lock', onClick: tool('passwort') },
    );
  } else if (cat === 'doc') items.push({ label: 'In PDF umwandeln', icon: 'kpdf', onClick: tool('word-pdf') });
  else if (cat === 'sheet') items.push({ label: 'In PDF umwandeln', icon: 'kpdf', onClick: tool('excel-pdf') });
  else if (cat === 'slides') items.push({ label: 'In PDF umwandeln', icon: 'kpdf', onClick: tool('ppt-pdf') });
  else if (kind === 'image') items.push({ label: 'In PDF umwandeln', icon: 'kpdf', onClick: go(openHash(doc)) });
  // FaleNetwork web tools that can open this file (js/webtools/list.js)
  items.push({ label: 'Mehr Werkzeuge …', icon: 'tools', onClick: () => import('../webtools/list.js').then(m => m.chooseWebTool(doc)) });
  const textKind = ['pdf', 'docx', 'txt', 'md'].includes(kind);
  if (textKind && !aiMenusHidden()) {
    items.push({ section: 'KI-Hilfe' },
      { label: 'Einfach erklärt', hint: 'Worum geht es, was ist zu tun?', icon: 'sparkle', onClick: go(`#/ki/erklaeren?doc=${id}`) },
      { label: 'Fragen zum Dokument', icon: 'comment', onClick: go(`#/ki/chat?doc=${id}`) },
      { label: 'Übersetzen', icon: 'translate', onClick: go(`#/ki/uebersetzen?doc=${id}`) });
    if (AI.summarize) items.push({ label: 'Zusammenfassen (auf dem Gerät)', icon: 'summary', onClick: () => import('../extras/ai.js').then(m => m.aiForDoc(doc, 'summarize')) });
    if (AI.translate) items.push({ label: 'Übersetzen (auf dem Gerät)', icon: 'translate', onClick: () => import('../extras/ai.js').then(m => m.aiForDoc(doc, 'translate')) });
  }
  items.push({ section: 'Teilen & senden' },
    { label: 'Herunterladen', icon: 'download', onClick: () => downloadFile(doc) },
    { label: 'Sicher teilen (Link)', hint: 'Link statt Anhang, läuft von selbst ab', icon: 'link', onClick: go(`#/teilen/link?doc=${id}`) }, // js/share
    ...(kind === 'pdf' ? [{ label: 'Unterschrift anfordern', icon: 'sign', onClick: go(`#/teilen/unterschrift?doc=${id}`) }] : []),
  );
  items.push({ section: 'Ordnen' },
    { label: 'Tags …', icon: 'tag', onClick: () => import('../extras/organize.js').then(m => m.tagsDialog(doc)) },
    { label: 'Frist hinzufügen …', icon: 'bell', onClick: () => import('../extras/reminders.js').then(m => m.reminderDialog({ docId: doc.id, title: '' })) },
    { label: 'In den Tresor verschieben', icon: 'vault', onClick: () => moveToVault(doc) },
  );
  items.push('-', { label: 'Löschen', icon: 'trash', danger: true, onClick: () => deleteFileConfirm(doc) });
  return officeMenu(anchor, items, {
    label: `Aktionen für ${doc.name}`,
    head: { thumb: fileThumb(doc), title: doc.name, sub: fileMeta(doc), onRename: name => renameTo(doc, name) },
    quick,
  });
}

async function toggleStar(doc) {
  const starred = !doc.starred;
  await db.updateDoc(doc.id, { starred });
  doc.starred = starred;
  toast(starred ? 'Markiert' : 'Markierung entfernt');
  emitChange();
}

/** Give a file a new name (cleaned, file extension kept). Returns the new name, or false when it is not allowed. */
export async function renameTo(doc, name) {
  let n = String(name == null ? '' : name).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!n) { toast('Der Name darf nicht leer sein.', 'error'); return false; }
  n = ensureExt(n, kindOf(doc));
  if (n === doc.name) return n;
  await db.updateDoc(doc.id, { name: n });
  doc.name = n;
  toast('Umbenannt', 'success');
  emitChange();
  return n;
}

export async function renameFile(doc) {
  const name = await promptDialog('Umbenennen', 'Neuer Name', doc.name, { okLabel: 'Speichern' });
  if (name === null) return;
  await renameTo(doc, name);
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
