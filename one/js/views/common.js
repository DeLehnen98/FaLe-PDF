// Item actions shared by Drive, Fotos, search and the viewer: open, download, rename, move (folder picker),
// trash with undo, delete forever, versions, offline toggle, share link, "In FaLe PDF öffnen".
import { el, clear, icon, toast, errorToast, errorText, openDialog, confirmDialog, promptDialog, actionSheet, saveBlob, progressBar, pickFiles } from '../dom.js';
import { t, tp, fmtSize, fmtDate, fmtDateTime } from '../i18n.js';
import * as E from '../engine.js';
import { kindOf, mimeOf, extOf } from '../media.js';
import { pdfAppBase } from '../config.js';

export const nodeKind = n => (n.kind === 'folder' ? 'folder' : kindOf(n.name, n.rev && n.rev.mime));
export function kindIcon(n) {
  const k = nodeKind(n);
  return { folder: 'folder', image: 'image', video: 'video', audio: 'audio', pdf: 'pdf', text: 'fileText', office: 'fileText', archive: 'zip' }[k] || 'file';
}
export const sizeOf = n => (n.rev && Number.isFinite(n.rev.size) ? n.rev.size : 0);
export const dateOf = n => (n.rev && n.rev.mtime) || Date.parse(n.updatedAt) || 0;
export function displayName(n) { return n.err ? t('(nicht lesbar)') : (n.name || t('Ohne Namen')); }
export const isPdfLike = n => { const k = nodeKind(n); return k === 'pdf' || k === 'office' || ['txt', 'md', 'csv'].includes(extOf(n.name)); };

/** Thumbnail element (img with lazy decrypted thumbnail, or the kind icon). */
export function thumbEl(n, cls = 'thumb') {
  const box = el('span.' + cls + '.k-' + nodeKind(n), icon(kindIcon(n)));
  if (n.head && n.head.thumb) {
    const cached = E.cachedThumb(n.id);
    const put = url => { if (!url) return; const img = el('img', { alt: '', src: url, decoding: 'async', draggable: 'false' }); clear(box).append(img); box.classList.add('has-img'); };
    if (cached) put(cached); else E.thumbUrl(n).then(put);
  }
  return box;
}

// ---------------------------------------------------------------- open / download
export async function openNode(n, { list } = {}) {
  if (n.kind === 'folder') { location.hash = '#/drive/f/' + encodeURIComponent(n.id); return; }
  const v = await import('./viewer.js');
  v.openViewer(n, { list: list || [n] });
}
export async function fetchBlob(n, { revId, label } = {}) {
  const pid = 'dl:' + n.id + ':' + Math.random().toString(36).slice(2);
  const bar = progressBar(0, label || t('Lade und entschlüssele …'));
  const close = toast(el('span.toast-prog', el('span', label || t('Lade „{name}“ …', { name: displayName(n) })), bar), { timeout: 600000 });
  const off = E.onProgress(pid, f => bar.set(f));
  try { return await E.call('download', { id: n.id, revId, progressId: pid }); }
  finally { off(); close(); }
}
export async function downloadNode(n, opts = {}) {
  if (n.kind === 'folder') return (await import('../export.js')).exportFolder(n);
  try { const b = await fetchBlob(n, opts); saveBlob(b, n.name || 'datei'); }
  catch (e) { errorToast(e); }
}

// ---------------------------------------------------------------- rename / move / trash
export async function renameNode(n) {
  const name = await promptDialog({ title: n.kind === 'folder' ? t('Ordner umbenennen') : t('Umbenennen'), label: t('Neuer Name'), value: n.name, selectBase: n.kind !== 'folder' });
  if (!name || name === n.name) return;
  try { await E.call('rename', { id: n.id, name: cleanName(name) }); toast(t('Umbenannt.')); }
  catch (e) { errorToast(e); }
}
export function cleanName(s) { return String(s).replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim().slice(0, 255) || t('Ohne Namen'); }

/** Folder picker → folder id (null = Drive root) or undefined when cancelled. */
export async function pickFolder({ title = t('Ziel wählen'), exclude = [], startId = null, okLabel = t('Hierher verschieben') } = {}) {
  let cur = startId && E.state.nodes.get(startId) && !E.state.nodes.get(startId).trashedAt ? startId : null;
  const listBox = el('div.picker-list');
  const crumbs = el('nav.crumbs.picker-crumbs', { aria: { label: t('Pfad') } });
  const paint = () => {
    clear(crumbs).append(el('button.crumb', { type: 'button', onclick: () => { cur = null; paint(); } }, t('Meine Dateien')));
    for (const p of cur ? E.pathOf(cur) : []) crumbs.append(icon('chevronRight', { cls: 'sep' }), el('button.crumb', { type: 'button', onclick: () => { cur = p.id; paint(); } }, displayName(p)));
    clear(listBox);
    const kids = E.childrenOf(cur).filter(x => x.kind === 'folder' && !exclude.some(ex => E.isInside(x.id, ex))).sort((a, b) => a.name.localeCompare(b.name));
    if (!kids.length) listBox.append(el('p.muted.pad', t('Keine Unterordner.')));
    for (const f of kids) listBox.append(el('button.picker-item', { type: 'button', onclick: () => { cur = f.id; paint(); } }, icon('folder'), el('span', displayName(f)), icon('chevronRight', { cls: 'go' })));
  };
  paint();
  const r = await openDialog({
    title, cls: 'picker',
    body: [crumbs, listBox, el('button.btn.ghost.sm.picker-new', { type: 'button', onclick: async () => { const name = await promptDialog({ title: t('Neuer Ordner'), label: t('Name'), ok: t('Erstellen') }); if (!name) return; try { const f = await E.call('mkdir', { parentId: cur, name: cleanName(name) }); cur = f.id; paint(); } catch (e) { errorToast(e); } } }, icon('folderPlus'), t('Neuer Ordner'))],
    actions: [{ label: t('Abbrechen'), value: 'cancel' }, { label: okLabel, value: 'ok', default: true }],
    onMount: () => ({ collect: () => cur }),
  });
  return r.value === 'ok' ? (r.data || null) : undefined;
}
export async function moveNodes(nodes) {
  const target = await pickFolder({ title: nodes.length === 1 ? t('„{name}“ verschieben', { name: displayName(nodes[0]) }) : tp(nodes.length, '{n} Element verschieben', '{n} Elemente verschieben'), exclude: nodes.filter(n => n.kind === 'folder').map(n => n.id), startId: nodes[0].parent });
  if (target === undefined) return;
  let ok = 0;
  for (const n of nodes) { if ((n.parent || null) === target) { ok++; continue; } try { await E.call('move', { id: n.id, parentId: target }); ok++; } catch (e) { errorToast(e); } }
  if (ok) toast(tp(ok, '{n} Element verschoben.', '{n} Elemente verschoben.'));
}
/** "Überall löschen": into the trash (30 days), with undo. */
export async function trashNodes(nodes, { ask = false } = {}) {
  if (ask && !(await confirmDialog({ title: t('Überall löschen?'), text: nodes.length === 1 ? t('„{name}“ wird aus FaLe One auf allen deinen Geräten entfernt und kommt für 30 Tage in den Papierkorb.', { name: displayName(nodes[0]) }) : t('{n} Elemente werden aus FaLe One auf allen deinen Geräten entfernt und kommen für 30 Tage in den Papierkorb.', { n: nodes.length }), ok: t('In den Papierkorb'), danger: true }))) return false;
  const done = [];
  for (const n of nodes) { try { await E.call('trash', { id: n.id }); done.push(n); } catch (e) { errorToast(e); } }
  if (done.length) toast(done.length === 1 ? t('„{name}“ ist im Papierkorb.', { name: displayName(done[0]) }) : tp(done.length, '{n} Element ist im Papierkorb.', '{n} Elemente sind im Papierkorb.'), {
    action: { label: t('Rückgängig'), run: async () => { for (const n of done) { try { await E.call('restore', { id: n.id }); } catch (e) { errorToast(e); } } toast(t('Wiederhergestellt.')); } },
  });
  return done.length > 0;
}

// ---------------------------------------------------------------- versions
export async function showVersions(n) {
  const list = el('div.versions', el('p.muted', t('Lade Versionen …')));
  const dlg = openDialog({ title: t('Versionen von „{name}“', { name: displayName(n) }), body: [list, el('p.hint', t('Ältere Versionen werden 30 Tage aufbewahrt (höchstens 10 pro Datei).'))], actions: [{ label: t('Schließen'), value: 'cancel' }] });
  const paint = async () => {
    let vs;
    try { vs = await E.call('versions', { id: n.id }); } catch (e) { clear(list).append(el('p.form-error', errorText(e))); return; }
    clear(list);
    vs.forEach((v, i) => {
      list.append(el('div.version' + (v.head ? '.head' : ''),
        el('div.version-info', el('strong', v.head ? t('Aktuelle Version') : t('Version vom {date}', { date: fmtDateTime(v.createdAt) })),
          el('span.muted', [v.head ? fmtDateTime(v.createdAt) : null, v.size != null ? fmtSize(v.size) : null, v.err ? t('nicht lesbar') : null].filter(Boolean).join(' · '))),
        el('div.version-acts',
          el('button.icon-btn.sm', { type: 'button', title: t('Herunterladen'), aria: { label: t('Diese Version herunterladen') }, onclick: async () => { try { const b = await fetchBlob(n, { revId: v.id }); saveBlob(b, versionName(n.name, v)); } catch (e) { errorToast(e); } } }, icon('download')),
          v.head ? null : el('button.btn.ghost.sm', { type: 'button', onclick: async () => { try { await E.call('restoreVersion', { id: n.id, revId: v.id }); toast(t('Version wiederhergestellt. Die bisherige Version ist jetzt im Verlauf.')); paint(); } catch (e) { errorToast(e); } } }, t('Wiederherstellen')),
          v.head ? null : el('button.icon-btn.sm.danger', { type: 'button', title: t('Version löschen'), aria: { label: t('Diese Version endgültig löschen') }, onclick: async () => { if (!(await confirmDialog({ title: t('Version löschen?'), text: t('Diese ältere Version wird endgültig gelöscht.'), ok: t('Löschen'), danger: true }))) return; try { await E.call('deleteVersion', { id: n.id, revId: v.id }); paint(); E.refreshQuota(); } catch (e) { errorToast(e); } } }, icon('trash')))));
      if (i === 0 && vs.length === 1) list.append(el('p.muted', t('Es gibt noch keine älteren Versionen.')));
    });
  };
  paint();
  await dlg;
}
function versionName(name, v) { const d = new Date(v.createdAt); const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; const dot = name.lastIndexOf('.'); return dot > 0 ? `${name.slice(0, dot)} (${stamp})${name.slice(dot)}` : `${name} (${stamp})`; }
export async function uploadNewVersion(n) {
  const [f] = await pickFiles({ multiple: false });
  if (!f) return;
  await E.call('upload', { items: [{ file: f, name: n.name, targetId: n.id }] });
  toast(t('Neue Version wird hochgeladen. Die bisherige bleibt im Verlauf.'));
}

// ---------------------------------------------------------------- offline
export function isPinned(n) {
  const pins = E.state.offline.pinned;
  for (let cur = n, g = 0; cur && g < 200; g++) { if (pins.has(cur.id)) return true; cur = cur.parent ? E.state.nodes.get(cur.parent) : null; }
  return false;
}
export async function togglePin(n) {
  const on = !E.state.offline.pinned.has(n.id);
  if (!on && isPinned(n) && !E.state.offline.pinned.has(n.id)) { toast(t('Der übergeordnete Ordner ist offline verfügbar.')); return; }
  try {
    if (on) toast(n.kind === 'folder' ? t('Der Ordner wird für die Offline-Nutzung geladen …') : t('Wird für die Offline-Nutzung geladen …'));
    await E.call('setPin', { id: n.id, on });
    await E.refreshOffline();
    toast(on ? t('Offline verfügbar. Die verschlüsselte Kopie liegt auf diesem Gerät.') : t('Nicht mehr offline verfügbar. Die Kopie auf diesem Gerät wurde entfernt.'));
  } catch (e) { errorToast(e); }
}

// ---------------------------------------------------------------- share link (§7.9) + FaLe PDF hand-off
export async function shareLink(n) {
  const opts = { expiresIn: 86400, maxDownloads: 5, pw: false };
  const seg = (name, items, key) => el('div.seg', { role: 'group', aria: { label: name } }, items.map(([v, l]) => {
    const b = el('button', { type: 'button', aria: { pressed: String(opts[key] === v) }, onclick: () => { opts[key] = v; b.parentNode.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); } }, l);
    return b;
  }));
  const pw = el('input.input', { type: 'password', autocomplete: 'new-password', minlength: 6, placeholder: t('mindestens 6 Zeichen'), hidden: true });
  const pwToggle = el('input', { type: 'checkbox', onchange: e => { opts.pw = e.target.checked; pw.hidden = !opts.pw; if (opts.pw) pw.focus(); } });
  const out = el('div.share-out');
  const r = await openDialog({
    title: t('Link teilen'),
    body: [
      el('p.dlg-text', t('„{name}“ wird auf diesem Gerät neu verschlüsselt und als eigene Kopie hochgeladen. Der Schlüssel steckt nur im Link – wir können die Datei nicht öffnen.', { name: displayName(n) })),
      el('div.field', el('span.field-label', t('Gültig für')), seg(t('Gültig für'), [[3600, t('1 Stunde')], [86400, t('1 Tag')], [604800, t('7 Tage')]], 'expiresIn')),
      el('div.field', el('span.field-label', t('Downloads')), seg(t('Downloads'), [[1, '1×'], [5, '5×'], [0, t('Unbegrenzt')]], 'maxDownloads')),
      el('label.check', pwToggle, el('span', t('Zusätzlich mit Passwort schützen'))), pw,
      el('p.hint', t('Höchstens 50 MB, höchstens 7 Tage. Für Ordner und Alben kommt das Teilen später.')), out,
    ],
    actions: [{ label: t('Abbrechen'), value: 'cancel' }, { label: t('Link erstellen'), value: 'ok', default: true }],
    onMount: () => ({ collect: () => { if (opts.pw && pw.value.length < 6) { pw.focus(); return false; } return { ...opts, password: opts.pw ? pw.value : '' }; } }),
  });
  if (r.value !== 'ok') return;
  const pid = 'share:' + n.id;
  const bar = progressBar(0, t('Verschlüssele und lade hoch …'));
  const close = toast(el('span.toast-prog', el('span', t('Erstelle Link …')), bar), { timeout: 600000 });
  const off = E.onProgress(pid, f => bar.set(f));
  try {
    const s = await E.call('shareLink', { id: n.id, expiresIn: r.data.expiresIn, maxDownloads: r.data.maxDownloads, password: r.data.password });
    close();
    const url = `${pdfAppBase()}#/s/${s.id}#k=${s.key}`;
    const input = el('input.input.mono', { type: 'text', readOnly: true, value: url, aria: { label: t('Link') }, onfocus: e => e.target.select() });
    await openDialog({
      title: t('Dein Link ist fertig'),
      body: [el('label.field', el('span.field-label', t('Link')), input),
        el('p.hint', t('Gültig bis {date}.', { date: fmtDateTime(s.expiresAt) }) + (s.password ? ' ' + t('Sende das Passwort auf einem anderen Weg als den Link.') : '')),
        el('div.row-btns',
          el('button.btn.primary', { type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(url); toast(t('Link kopiert.')); } catch { input.select(); } } }, icon('copy'), t('Kopieren')),
          navigator.share ? el('button.btn.ghost', { type: 'button', onclick: () => navigator.share({ title: displayName(n), url }).catch(() => {}) }, icon('share'), t('Teilen …')) : null)],
      actions: [{ label: t('Fertig'), value: 'cancel', default: true }],
    });
  } catch (e) {
    close();
    if (e.code === 'share_too_large') toast(t('Die Datei ist zu groß für einen Link (max. {n} MB).', { n: Math.round((e.extra && e.extra.max || 52428800) / 1048576) }), { kind: 'error' });
    else if (e.code === 'share_not_configured') toast(t('Teilen per Link ist gerade nicht verfügbar.'), { kind: 'error' });
    else errorToast(e);
  } finally { off(); }
}
/**
 * "In FaLe PDF öffnen": FaLe PDF runs on another origin, and both apps isolate themselves (COOP), so a page
 * cannot hand a file to the other directly. The file is decrypted here and handed over by the system:
 * on phones via the share sheet (FaLe PDF is a share target), elsewhere as a download + FaLe PDF in a new tab.
 */
export async function openInPdf(n) {
  let blob;
  try { blob = await fetchBlob(n); } catch (e) { errorToast(e); return; }
  const file = new File([blob], n.name || 'Dokument.pdf', { type: mimeOf(n.name, blob.type) });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    const ok = await confirmDialog({ title: t('In FaLe PDF öffnen'), text: t('Wähle im nächsten Schritt „FaLe PDF“ aus der Liste. Die Datei geht direkt auf deinem Gerät an FaLe PDF – nicht über das Internet.'), ok: t('Weiter') });
    if (!ok) return;
    try { await navigator.share({ files: [file], title: file.name }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const ok = await confirmDialog({ title: t('In FaLe PDF öffnen'), text: t('Die entschlüsselte Datei wird heruntergeladen. Danach öffnet sich FaLe PDF – tippe dort auf „Importieren“ und wähle die Datei aus deinen Downloads. (Ein direkter Austausch zwischen zwei Web-Apps ist aus Sicherheitsgründen nicht möglich.)'), ok: t('Herunterladen und öffnen') });
  if (!ok) return;
  saveBlob(file, file.name);
  window.open(pdfAppBase() + '#/start', '_blank', 'noopener,noreferrer');
}

// ---------------------------------------------------------------- the ⋯ menu
export function nodeMenu(n, { list, onChange } = {}) {
  const isFolder = n.kind === 'folder';
  const pinned = E.state.offline.pinned.has(n.id);
  return actionSheet({
    title: displayName(n),
    sub: isFolder ? null : [fmtSize(sizeOf(n)), fmtDate(dateOf(n))].filter(Boolean).join(' · '),
    items: [
      { label: t('Öffnen'), icon: isFolder ? 'folder' : 'openExt', run: () => openNode(n, { list }) },
      { label: t('Link teilen'), icon: 'link', hidden: isFolder, run: () => shareLink(n) },
      { label: t('In FaLe PDF öffnen'), icon: 'pdf', hidden: isFolder || !isPdfLike(n), run: () => openInPdf(n) },
      { label: isFolder ? t('Als ZIP herunterladen') : t('Herunterladen'), icon: 'download', run: () => downloadNode(n) },
      { label: t('Umbenennen'), icon: 'edit', run: () => renameNode(n).then(onChange) },
      { label: t('Verschieben'), icon: 'move', run: () => moveNodes([n]).then(onChange) },
      { label: pinned ? t('Nicht mehr offline verfügbar') : t('Offline verfügbar machen'), icon: 'offline', hint: pinned ? t('an') : null, run: () => togglePin(n) },
      { label: t('Versionen'), icon: 'history', hidden: isFolder, run: () => showVersions(n) },
      { label: t('Neue Version hochladen'), icon: 'upload', hidden: isFolder, run: () => uploadNewVersion(n) },
      { label: t('In den Papierkorb'), icon: 'trash', danger: true, run: () => trashNodes([n]).then(onChange) },
    ],
  });
}
