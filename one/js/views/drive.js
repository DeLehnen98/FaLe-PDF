// FaLe Drive: folders (list / grid), breadcrumbs, sort, upload (picker, folder, camera, drag & drop),
// selection, trash with restore / delete forever, offline files.
import { el, clear, icon, toast, errorToast, confirmDialog, promptDialog, actionSheet, onLongPress } from '../dom.js';
import { t, tp, fmtSize, fmtDate, fmtNum } from '../i18n.js';
import * as E from '../engine.js';
import { thumbEl, displayName, nodeMenu, openNode, sizeOf, dateOf, moveNodes, trashNodes, downloadNode, cleanName, isPinned } from './common.js';
import { pickAndUpload, uploadTo, entriesFromDrop } from './uploads.js';
import { homeStatus } from '../app.js';

const pref = (k, d) => { try { return localStorage.getItem('fale-one-' + k) || d; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem('fale-one-' + k, v); } catch {} };

export async function mount(main, { parts, setTitle }) {
  if (parts[0] === 'papierkorb') return trashView(main, setTitle);
  if (parts[0] === 'offline') return offlineView(main, setTitle);
  return folderView(main, setTitle, parts[0] === 'f' ? parts[1] : null);
}
function subNav(active) {
  const items = [['', t('Meine Dateien')], ['offline', t('Offline')], ['papierkorb', t('Papierkorb')]];
  return el('nav.subnav', { aria: { label: t('Drive-Bereiche') } }, items.map(([k, l]) => el('a.subnav-item' + (k === active ? '.on' : ''), { href: '#/drive' + (k ? '/' + k : ''), aria: { current: k === active ? 'page' : undefined } }, l)));
}
export function sortNodes(list, by, dir) {
  const m = dir === 'desc' ? -1 : 1;
  return list.sort((a, b) => {
    if ((a.kind === 'folder') !== (b.kind === 'folder')) return a.kind === 'folder' ? -1 : 1;
    let r = 0;
    if (by === 'date') r = dateOf(a) - dateOf(b);
    else if (by === 'size') r = sizeOf(a) - sizeOf(b);
    if (!r) r = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    return r * m;
  });
}

/** One row / tile of the Drive listing. */
export function itemRow(n, { list, mode = 'list', selection, extra, onOpen } = {}) {
  const sel = selection && selection.has(n.id);
  const metaLine = n.kind === 'folder' ? tp(E.childrenOf(n.id).length, '{n} Element', '{n} Elemente') : [fmtSize(sizeOf(n)), fmtDate(dateOf(n))].filter(Boolean).join(' · ');
  const badges = el('span.row-badges',
    isPinned(n) ? el('span.badge-ic', { title: t('Offline verfügbar'), aria: { label: t('Offline verfügbar') } }, icon('offline')) : null,
    n.meta && n.meta.favorite ? el('span.badge-ic', { title: t('Favorit') }, icon('star', { filled: true })) : null);
  const open = el('button.row-open', { type: 'button', aria: { label: `${displayName(n)}${n.kind === 'folder' ? ', ' + t('Ordner') : ''}` } },
    thumbEl(n, mode === 'grid' ? 'tile-thumb' : 'thumb'),
    el('span.row-text', el('span.row-name', displayName(n)), el('span.row-meta', extra || metaLine)), badges);
  const more = el('button.icon-btn.row-more', { type: 'button', aria: { label: t('Aktionen für „{name}“', { name: displayName(n) }) } }, icon('more'));
  const check = selection ? el('span.row-check', icon('check')) : null;
  const row = el((mode === 'grid' ? 'div.tile' : 'div.row') + (sel ? '.sel' : ''), { role: 'listitem', data: { id: n.id } }, check, open, more);
  open.addEventListener('click', e => {
    if (selection && (selection.size || e.ctrlKey || e.metaKey)) { selection.toggle(n.id); return; }
    (onOpen || openNode)(n, { list: list && list.filter(x => x.kind !== 'folder') });
  });
  more.addEventListener('click', () => nodeMenu(n, { list }));
  if (selection) onLongPress(open, () => selection.toggle(n.id));
  return row;
}

// ---------------------------------------------------------------- folder view
function folderView(main, setTitle, folderId) {
  const wrap = el('div.view.drive');
  main.appendChild(wrap);
  let mode = pref('drive-mode', 'list'), by = pref('drive-sort', 'name'), dir = pref('drive-dir', 'asc');
  const crumbs = el('nav.crumbs', { aria: { label: t('Pfad') } });
  const listBox = el('div.items', { role: 'list', aria: { label: t('Inhalt') } });
  const selBar = el('div.selbar', { hidden: true, role: 'toolbar', aria: { label: t('Auswahl') } });
  const selected = new Set();
  const selection = { has: id => selected.has(id), get size() { return selected.size; }, toggle(id) { if (selected.has(id)) selected.delete(id); else selected.add(id); paint(); } };
  const tools = el('div.view-tools',
    el('button.btn.primary.sm.new-btn', { type: 'button', onclick: () => newMenu() }, icon('plus'), el('span', t('Neu'))),
    el('div.bar-spacer'),
    el('button.icon-btn', { type: 'button', title: t('Sortieren'), aria: { label: t('Sortieren') }, onclick: () => sortMenu() }, icon('sort')),
    el('button.icon-btn', { type: 'button', title: t('Ansicht wechseln'), aria: { label: t('Ansicht wechseln') }, data: { mode: '' }, onclick: () => { mode = mode === 'list' ? 'grid' : 'list'; setPref('drive-mode', mode); paint(); } }, icon('grid')));
  const drop = el('div.dropzone', { hidden: true }, icon('upload'), el('p', t('Zum Hochladen loslassen')));
  wrap.append(el('div.drive-top', homeStatus(), subNav('')), el('div.view-head', crumbs, tools), listBox, selBar, drop,
    el('button.fab', { type: 'button', aria: { label: t('Neu') }, onclick: () => newMenu() }, icon('plus'), el('span', t('Neu'))));

  function current() { return folderId ? E.state.nodes.get(folderId) : null; }
  async function newMenu() {
    actionSheet({ title: t('Neu'), items: [
      { label: t('Ordner'), icon: 'folderPlus', run: async () => { const name = await promptDialog({ title: t('Neuer Ordner'), label: t('Name'), ok: t('Erstellen') }); if (!name) return; try { await E.call('mkdir', { parentId: folderId, name: cleanName(name) }); toast(t('Ordner erstellt.')); } catch (e) { errorToast(e); } } },
      { label: t('Dateien hochladen'), icon: 'upload', run: () => pickAndUpload(folderId, 'files') },
      { label: t('Ordner hochladen'), icon: 'folder', run: () => pickAndUpload(folderId, 'folder') },
      { label: t('Foto oder Video aufnehmen'), icon: 'camera', run: () => pickAndUpload(folderId, 'camera') },
    ] });
  }
  function sortMenu() {
    const opt = (k, label) => ({ label, icon: by === k ? 'check' : 'sort', hint: by === k ? (dir === 'asc' ? t('aufsteigend') : t('absteigend')) : null, run: () => { if (by === k) dir = dir === 'asc' ? 'desc' : 'asc'; else { by = k; dir = k === 'name' ? 'asc' : 'desc'; } setPref('drive-sort', by); setPref('drive-dir', dir); paint(); } });
    actionSheet({ title: t('Sortieren nach'), items: [opt('name', t('Name')), opt('date', t('Änderungsdatum')), opt('size', t('Größe'))] });
  }
  function paintSel() {
    selBar.hidden = !selected.size;
    document.body.classList.toggle('has-selbar', selected.size > 0);
    const nodes = () => [...selected].map(id => E.state.nodes.get(id)).filter(Boolean);
    clear(selBar).append(
      el('button.icon-btn', { type: 'button', aria: { label: t('Auswahl beenden') }, onclick: () => { selected.clear(); paint(); } }, icon('close')),
      el('span.sel-count', tp(selected.size, '{n} ausgewählt', '{n} ausgewählt')), el('div.bar-spacer'),
      el('button.btn.ghost.sm', { type: 'button', onclick: async () => { await moveNodes(nodes()); selected.clear(); paint(); } }, icon('move'), el('span', t('Verschieben'))),
      el('button.icon-btn', { type: 'button', title: t('Herunterladen'), aria: { label: t('Herunterladen') }, onclick: async () => { for (const n of nodes()) await downloadNode(n); } }, icon('download')),
      el('button.icon-btn.danger', { type: 'button', title: t('In den Papierkorb'), aria: { label: t('In den Papierkorb') }, onclick: async () => { if (await trashNodes(nodes())) { selected.clear(); paint(); } } }, icon('trash')));
  }
  function paint() {
    const cur = current();
    if (folderId && !cur && E.state.lastSync) { clear(wrap).append(el('div.empty', el('h3', t('Diesen Ordner gibt es nicht mehr.')), el('a.btn.ghost', { href: '#/drive' }, t('Zu Meine Dateien')))); return; }
    if (cur && cur.trashedAt) { clear(wrap).append(el('div.empty', el('h3', t('Dieser Ordner liegt im Papierkorb.')), el('a.btn.ghost', { href: '#/drive/papierkorb' }, t('Zum Papierkorb')))); return; }
    setTitle(cur ? displayName(cur) : t('Drive'));
    clear(crumbs).append(el('a.crumb', { href: '#/drive' }, t('Meine Dateien')));
    for (const p of folderId ? E.pathOf(folderId) : []) crumbs.append(icon('chevronRight', { cls: 'sep' }), el('a.crumb', { href: '#/drive/f/' + encodeURIComponent(p.id), aria: { current: p.id === folderId ? 'page' : undefined } }, displayName(p)));
    const vbtn = tools.querySelector('[data-mode]');
    clear(vbtn).append(icon(mode === 'list' ? 'grid' : 'list'));
    const kids = sortNodes(E.childrenOf(folderId), by, dir);
    for (const id of [...selected]) if (!kids.some(k => k.id === id)) selected.delete(id);
    clear(listBox);
    listBox.className = 'items ' + mode;
    if (!kids.length) {
      listBox.append(el('div.empty', icon('drive', { cls: 'empty-ic' }), el('h3', folderId ? t('Dieser Ordner ist leer') : t('Noch keine Dateien')),
        el('p', t('Lade Dateien hoch oder ziehe sie hierher. Alles wird auf diesem Gerät verschlüsselt, bevor es hochgeladen wird.')),
        el('button.btn.primary', { type: 'button', onclick: () => pickAndUpload(folderId, 'files') }, icon('upload'), t('Dateien hochladen'))));
    } else for (const n of kids) listBox.append(itemRow(n, { list: kids, mode, selection }));
    paintSel();
  }
  // drag & drop (desktop): files and whole folders
  let dragDepth = 0;
  const onEnter = e => { if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return; e.preventDefault(); dragDepth++; drop.hidden = false; };
  const onLeave = () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) drop.hidden = true; };
  const onOver = e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); };
  const onDrop = async e => { if (!e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault(); dragDepth = 0; drop.hidden = true; const entries = await entriesFromDrop(e.dataTransfer); uploadTo(folderId, entries); };
  window.addEventListener('dragenter', onEnter); window.addEventListener('dragleave', onLeave); window.addEventListener('dragover', onOver); window.addEventListener('drop', onDrop);
  paint();
  return {
    update(w) { if (w.has('nodes') || w.has('offline')) paint(); },
    destroy() { window.removeEventListener('dragenter', onEnter); window.removeEventListener('dragleave', onLeave); window.removeEventListener('dragover', onOver); window.removeEventListener('drop', onDrop); document.body.classList.remove('has-selbar'); },
  };
}

// ---------------------------------------------------------------- trash
function trashView(main, setTitle) {
  setTitle(t('Papierkorb'));
  const wrap = el('div.view.trash');
  main.appendChild(wrap);
  const listBox = el('div.items.list', { role: 'list', aria: { label: t('Papierkorb') } });
  const emptyBtn = el('button.btn.ghost.sm.danger', { type: 'button', onclick: async () => {
    if (!(await confirmDialog({ title: t('Papierkorb leeren?'), text: t('Alles im Papierkorb wird endgültig gelöscht. Das kann nicht rückgängig gemacht werden.'), ok: t('Endgültig löschen'), danger: true }))) return;
    try { const n = await E.call('emptyTrash'); toast(tp(n, '{n} Element endgültig gelöscht.', '{n} Elemente endgültig gelöscht.')); E.refreshQuota(); } catch (e) { errorToast(e); }
  } }, icon('trash'), el('span', t('Papierkorb leeren')));
  wrap.append(el('div.drive-top', subNav('papierkorb')), el('div.view-head', el('h2.view-title', t('Papierkorb')), el('div.view-tools', el('div.bar-spacer'), emptyBtn)),
    el('p.muted.lead', t('Gelöschte Elemente bleiben 30 Tage hier und zählen so lange zum Speicher. Danach werden sie automatisch endgültig gelöscht.')), listBox);
  const days = () => (E.state.quota && E.state.quota.limits && E.state.quota.limits.trashDays) || 30;
  const paint = () => {
    const roots = [...E.state.nodes.values()].filter(n => n.trashedAt && n.trashRoot === n.id).sort((a, b) => Date.parse(b.trashedAt) - Date.parse(a.trashedAt));
    emptyBtn.disabled = !roots.length;
    clear(listBox);
    if (!roots.length) { listBox.append(el('div.empty', icon('trash', { cls: 'empty-ic' }), el('h3', t('Der Papierkorb ist leer')))); return; }
    for (const n of roots) {
      const until = new Date(Date.parse(n.trashedAt) + days() * 864e5);
      const inside = n.kind === 'folder' ? [...E.state.nodes.values()].filter(x => x.trashRoot === n.id && x.id !== n.id).length : 0;
      const row = el('div.row', { role: 'listitem' }, el('span.row-open.static', thumbEl(n),
        el('span.row-text', el('span.row-name', displayName(n)), el('span.row-meta', [t('Gelöscht am {date}', { date: fmtDate(n.trashedAt) }), t('wird am {date} endgültig gelöscht', { date: fmtDate(until) }), inside ? tp(inside, '{n} Element darin', '{n} Elemente darin') : null].filter(Boolean).join(' · ')))),
        el('button.btn.ghost.sm', { type: 'button', onclick: async () => { try { await E.call('restore', { id: n.id }); toast(t('„{name}“ wiederhergestellt.', { name: displayName(n) })); } catch (e) { errorToast(e); } } }, icon('restore'), el('span', t('Wiederherstellen'))),
        el('button.icon-btn.danger', { type: 'button', title: t('Endgültig löschen'), aria: { label: t('„{name}“ endgültig löschen', { name: displayName(n) }) }, onclick: async () => {
          if (!(await confirmDialog({ title: t('Endgültig löschen?'), text: t('„{name}“ wird endgültig gelöscht – mit allen Versionen. Das kann nicht rückgängig gemacht werden.', { name: displayName(n) }), ok: t('Endgültig löschen'), danger: true }))) return;
          try { await E.call('deleteForever', { id: n.id }); toast(t('Endgültig gelöscht.')); E.refreshQuota(); } catch (e) { errorToast(e); }
        } }, icon('trash')));
      listBox.append(row);
    }
  };
  paint();
  return { update(w) { if (w.has('nodes') || w.has('quota')) paint(); } };
}

// ---------------------------------------------------------------- offline files
function offlineView(main, setTitle) {
  setTitle(t('Offline verfügbar'));
  const wrap = el('div.view.offline');
  main.appendChild(wrap);
  const listBox = el('div.items.list', { role: 'list', aria: { label: t('Offline verfügbar') } });
  const info = el('p.muted.lead');
  wrap.append(el('div.drive-top', subNav('offline')), el('div.view-head', el('h2.view-title', t('Offline verfügbar'))), info, listBox);
  E.refreshOffline();
  const paint = () => {
    const pins = [...E.state.offline.pinned].map(id => E.state.nodes.get(id)).filter(n => n && !n.trashedAt);
    info.textContent = t('Diese Dateien kannst du auch ohne Internet öffnen. Auf diesem Gerät liegen sie verschlüsselt ({size}).', { size: fmtSize(E.state.offline.bytes) });
    clear(listBox);
    if (!pins.length) { listBox.append(el('div.empty', icon('offline', { cls: 'empty-ic' }), el('h3', t('Noch nichts offline verfügbar')), el('p', t('Öffne bei einer Datei oder einem Ordner das Menü ⋯ und wähle „Offline verfügbar machen“.')))); return; }
    for (const n of pins) {
      const state = n.kind === 'folder' ? tp(E.childrenOf(n.id).length, '{n} Element', '{n} Elemente') : E.state.offline.ready.has(n.id) ? t('Bereit') : E.state.offline.loading.has(n.id) ? t('Wird geladen …') : t('Wartet auf Verbindung');
      listBox.append(itemRow(n, { list: pins, extra: state }));
    }
  };
  paint();
  return { update(w) { if (w.has('nodes') || w.has('offline')) paint(); } };
}
export { fmtNum };
