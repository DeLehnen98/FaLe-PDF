// Uploads: the uploads sheet (progress, pause / resume / cancel), uploading files and folder trees into Drive
// (picker, camera, drag & drop, share target), and the photo backup entry point.
import { el, clear, icon, toast, errorToast, openDialog, progressBar, pickFiles } from '../dom.js';
import { t, tp, fmtSize, fmtNum } from '../i18n.js';
import * as E from '../engine.js';
import { cleanName, pickFolder, displayName } from './common.js';
import { isMedia, mimeOf } from '../media.js';

const STATE = () => ({
  waiting: t('Wartet'), hashing: t('Prüft …'), queued: t('In der Warteschlange'), uploading: t('Lädt hoch'), committing: t('Speichert …'),
  paused: t('Pausiert'), error: t('Unterbrochen'), done: t('Fertig'), skipped: t('Schon gesichert – übersprungen'),
});
const ACTIVE = new Set(['waiting', 'hashing', 'queued', 'uploading', 'committing']);

let sheetOpen = false;
export async function openSheet() {
  if (sheetOpen) return;
  sheetOpen = true;
  const list = el('div.jobs');
  const summary = el('p.jobs-sum', { aria: { live: 'polite' } });
  const rows = new Map();
  const paint = () => {
    const jobs = [...E.state.jobs.values()].sort((a, b) => (ACTIVE.has(b.state) - ACTIVE.has(a.state)) || 0);
    const active = jobs.filter(j => ACTIVE.has(j.state));
    const sent = active.reduce((s, j) => s + (j.sent || 0), 0), total = active.reduce((s, j) => s + (j.total || j.size || 0), 0);
    summary.textContent = !jobs.length ? t('Keine Uploads.') : active.length
      ? t('{n} offen · {sent} von {total}', { n: fmtNum(active.length), sent: fmtSize(sent), total: fmtSize(total) })
      : t('Alles erledigt: {done} hochgeladen, {skipped} übersprungen.', { done: fmtNum(jobs.filter(j => j.state === 'done').length), skipped: fmtNum(jobs.filter(j => j.state === 'skipped').length) });
    const seen = new Set();
    for (const j of jobs.slice(0, 300)) {
      seen.add(j.id);
      let r = rows.get(j.id);
      if (!r) { r = jobRow(j); rows.set(j.id, r); }
      r.update(j);
      list.appendChild(r.node);
    }
    for (const [id, r] of rows) if (!seen.has(id)) { r.node.remove(); rows.delete(id); }
    if (jobs.length > 300) list.append(el('p.muted.pad', t('… und {n} weitere', { n: fmtNum(jobs.length - 300) })));
  };
  const unsub = E.subscribe(w => { if (w.has('jobs')) paint(); });
  paint();
  await openDialog({
    title: t('Uploads'), sheet: true, cls: 'uploads',
    body: [summary, list],
    actions: [
      { label: t('Fertige ausblenden'), value: 'clear', run: async () => { const l = await E.call('clearFinished'); E.state.jobs.clear(); l.forEach(j => E.state.jobs.set(j.id, j)); paint(); } },
      { label: t('Alle pausieren'), value: 'pauseAll', run: async () => { for (const j of E.state.jobs.values()) if (ACTIVE.has(j.state)) await E.call('pause', { id: j.id }).catch(() => {}); } },
      { label: t('Schließen'), value: 'cancel', default: true },
    ],
  });
  unsub();
  sheetOpen = false;
}
function jobRow(j0) {
  const name = el('span.job-name');
  const meta = el('span.job-meta');
  const bar = progressBar(0, t('Upload-Fortschritt'));
  const btns = el('span.job-btns');
  const node = el('div.job', el('span.job-ic', icon('cloudUp')), el('span.job-main', name, meta, bar), btns);
  let last = '';
  return {
    node,
    update(j) {
      name.textContent = j.name + (j.newVersion ? ' · ' + t('neue Version') : '');
      const s = STATE()[j.state] || j.state;
      const pct = j.total ? Math.min(1, (j.sent || 0) / j.total) : 0;
      meta.textContent = j.state === 'uploading' ? `${s} · ${fmtSize(j.sent || 0)} ${t('von')} ${fmtSize(j.total || j.size)} · ${Math.floor(pct * 100)} %`
        : j.state === 'error' ? `${s} – ${errorShort(j.error)}` : j.state === 'paused' ? `${s} · ${Math.floor(pct * 100)} %${j.persisted ? '' : ''}` : `${s}${j.size != null ? ' · ' + fmtSize(j.size) : ''}`;
      bar.set(j.state === 'done' || j.state === 'skipped' ? 1 : pct);
      node.dataset.state = j.state;
      const key = j.state;
      if (key === last) return;
      last = key;
      clear(btns);
      if (ACTIVE.has(j.state)) btns.append(el('button.icon-btn.sm', { type: 'button', title: t('Pausieren'), aria: { label: t('„{name}“ pausieren', { name: j.name }) }, onclick: () => E.call('pause', { id: j.id }) }, icon('pause')));
      if (j.state === 'paused' || j.state === 'error') btns.append(el('button.icon-btn.sm', { type: 'button', title: t('Fortsetzen'), aria: { label: t('„{name}“ fortsetzen', { name: j.name }) }, onclick: () => E.call('resume', { id: j.id }) }, icon('play')));
      if (j.state !== 'done' && j.state !== 'skipped') btns.append(el('button.icon-btn.sm', { type: 'button', title: t('Abbrechen'), aria: { label: t('„{name}“ abbrechen', { name: j.name }) }, onclick: () => E.call('cancel', { id: j.id }) }, icon('close')));
      if (j.state === 'done') btns.append(el('span.job-ok', { title: t('Fertig') }, icon('check')));
    },
  };
}
function errorShort(e) {
  if (!e) return t('erneut versuchen');
  return ({ network: t('wartet auf Verbindung'), quota_exceeded: t('Speicher voll'), drive_limit: t('Tageslimit erreicht'), too_large: t('Datei zu groß'), read: t('Datei nicht lesbar'), capacity: t('Beta-Speicher voll') })[e.code] || t('erneut versuchen');
}

// ---------------------------------------------------------------- Drive uploads
/** files: [{ file, path: 'a/b/name.ext' (relative, optional) }] → creates the folder tree, asks about name clashes. */
export async function uploadTo(parentId, entries) {
  if (!entries.length) return;
  if (E.state.quota && E.state.quota.readOnly) { toast(t('Dein Speicher ist voll. Alles bleibt lesbar – lösche etwas, leere den Papierkorb oder exportiere.'), { kind: 'error' }); return; }
  const folderCache = new Map();
  const ensureFolder = async (pid, name) => {
    const key = (pid || '') + '/' + name;
    if (folderCache.has(key)) return folderCache.get(key);
    let f = E.childrenOf(pid).find(x => x.kind === 'folder' && x.name === name);
    if (!f) f = await E.call('mkdir', { parentId: pid, name: cleanName(name) });
    folderCache.set(key, f.id);
    return f.id;
  };
  const items = [];
  const clashes = [];
  for (const { file, path } of entries) {
    const parts = String(path || file.name).split('/').filter(Boolean);
    const name = cleanName(parts.pop() || file.name);
    let pid = parentId;
    try { for (const p of parts) pid = await ensureFolder(pid, p); } catch (e) { errorToast(e); return; }
    const existing = E.childrenOf(pid).find(x => x.kind !== 'folder' && x.name === name);
    const it = { file, name, parentId: pid };
    if (existing) { it.existing = existing; clashes.push(it); }
    items.push(it);
  }
  if (clashes.length) {
    const r = await openDialog({
      title: tp(clashes.length, 'Eine Datei gibt es schon', '{n} Dateien gibt es schon'),
      body: el('p.dlg-text', clashes.length === 1 ? t('„{name}“ liegt schon in diesem Ordner. Als neue Version speichern (die alte bleibt im Verlauf) oder beide behalten?', { name: clashes[0].name }) : t('Einige Dateien liegen schon in diesem Ordner. Als neue Versionen speichern (die alten bleiben im Verlauf) oder beide behalten?')),
      actions: [{ label: t('Abbrechen'), value: 'cancel' }, { label: t('Beide behalten'), value: 'keep' }, { label: t('Neue Version'), value: 'version', default: true }],
    });
    if (r.value === 'cancel') return;
    for (const it of clashes) {
      if (r.value === 'version') it.targetId = it.existing.id;
      else it.name = uniqueName(it.parentId, it.name, items);
    }
  }
  try {
    await E.call('upload', { items: items.map(({ file, name, parentId: p, targetId }) => ({ file, name, parentId: p, targetId })) });
    toast(tp(items.length, '{n} Datei wird hochgeladen.', '{n} Dateien werden hochgeladen.'), { action: { label: t('Anzeigen'), run: openSheet } });
  } catch (e) { errorToast(e); }
}
function uniqueName(pid, name, pending) {
  const taken = new Set([...E.childrenOf(pid).map(x => x.name), ...pending.filter(p => p.parentId === pid).map(p => p.name)]);
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; i < 1000; i++) { const c = `${base} (${i})${ext}`; if (!taken.has(c)) return c; }
  return `${base} (${Date.now()})${ext}`;
}
/** Files and folders from a drop (DataTransfer) → [{ file, path }] */
export async function entriesFromDrop(dt) {
  const out = [];
  const items = dt.items ? Array.from(dt.items).filter(i => i.kind === 'file') : [];
  const roots = items.map(i => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null));
  if (!roots.length || roots.some(r => !r)) return Array.from(dt.files || []).map(f => ({ file: f, path: f.name }));
  const walk = async (entry, prefix) => {
    if (entry.isFile) { const f = await new Promise((res, rej) => entry.file(res, rej)); out.push({ file: f, path: prefix + f.name }); return; }
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const e of batch) await walk(e, prefix + entry.name + '/');
    }
  };
  for (const r of roots) await walk(r, '');
  return out;
}
export async function pickAndUpload(parentId, mode = 'files') {
  const files = await pickFiles(mode === 'camera' ? { accept: 'image/*,video/*', capture: 'environment', multiple: false } : mode === 'folder' ? { directory: true } : { multiple: true });
  if (!files.length) return;
  await uploadTo(parentId, files.map(f => ({ file: f, path: mode === 'folder' ? (f.webkitRelativePath || f.name) : f.name })));
}

// ---------------------------------------------------------------- photo backup
export async function backupPhotos(files) {
  if (!files) files = await pickFiles({ accept: 'image/*,video/*,.heic,.heif,.dng', multiple: true });
  files = files.filter(f => isMedia(f.name, mimeOf(f.name, f.type)));
  if (!files.length) return;
  if (E.state.quota && E.state.quota.readOnly) { toast(t('Dein Speicher ist voll. Alles bleibt lesbar – lösche etwas, leere den Papierkorb oder exportiere.'), { kind: 'error' }); return; }
  const heic = files.filter(f => /\.(heic|heif)$/i.test(f.name)).length;
  toast(tp(files.length, '{n} Foto wird geprüft und gesichert …', '{n} Fotos werden geprüft und gesichert …') + (heic ? ' ' + t('HEIC-Originale werden unverändert gesichert; eine Vorschau gibt es nur, wenn dieses Gerät HEIC anzeigen kann.') : ''), { action: { label: t('Anzeigen'), run: openSheet }, timeout: 6000 });
  try {
    const r = await E.call('backup', { files: files.map(f => ({ file: f, name: f.name })), folderName: t('Fotos') });
    if (r.skipped) toast(tp(r.skipped, '{n} Foto war schon gesichert und wird übersprungen.', '{n} Fotos waren schon gesichert und werden übersprungen.'));
  } catch (e) { errorToast(e); }
}

// ---------------------------------------------------------------- share target
export async function sharedFilesDialog(files) {
  const media = files.filter(f => isMedia(f.name, mimeOf(f.name, f.type)));
  const total = files.reduce((s, f) => s + f.size, 0);
  const allMedia = media.length === files.length;
  let target = null;
  const where = el('span.muted', t('Meine Dateien'));
  const r = await openDialog({
    title: tp(files.length, '{n} geteilte Datei', '{n} geteilte Dateien'),
    body: [el('ul.share-list', files.slice(0, 8).map(f => el('li', icon('file'), el('span', f.name), el('span.muted', fmtSize(f.size)))), files.length > 8 ? el('li.muted', t('… und {n} weitere', { n: files.length - 8 })) : null),
      el('p.muted', t('Zusammen {size}.', { size: fmtSize(total) })),
      allMedia ? null : el('div.field', el('span.field-label', t('Speichern in')), el('div.row-btns', where, el('button.btn.ghost.sm', { type: 'button', onclick: async () => { const f = await pickFolder({ title: t('Speichern in'), okLabel: t('Hier speichern') }); if (f !== undefined) { target = f; where.textContent = f ? displayName(E.state.nodes.get(f)) : t('Meine Dateien'); } } }, t('Ändern'))))],
    actions: [{ label: t('Abbrechen'), value: 'cancel' }, allMedia ? { label: t('Als Fotos sichern'), value: 'photos', default: true } : null, { label: t('In Drive speichern'), value: 'drive', default: !allMedia }].filter(Boolean),
  });
  if (r.value === 'photos') return backupPhotos(files);
  if (r.value === 'drive') return uploadTo(target, files.map(f => ({ file: f, path: f.name })));
}
