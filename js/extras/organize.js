// Ordnung: Ordner (eine Ebene verschachtelt), farbige Tags, Papierkorb, Duplikate.
import * as db from '../db.js';
import { $, $$, h, esc, toast, errorToast, openDialog, confirmDialog, promptDialog, formatSize, formatDate, progress } from '../ui.js';
import { oicon, kindOf } from '../office/kinds.js';
import { emitChange, dropThumb } from '../library.js';
import { fileThumb, fileMeta } from '../office/filerow.js';
import { cssColor } from '../security.js';

export const TAG_COLORS = ['#D2453F', '#E8613C', '#D99A06', '#15895A', '#0B8F80', '#2F67D8', '#3B37A0', '#8A4FD0', '#C23A7B', '#6B7194'];

// ---------------- folders ----------------
export async function listFolders() { return (await db.getSetting('folders', [])) || []; }
async function saveFolders(list) { await db.setSetting('folders', list); emitChange(); }
export function folderPath(folders, id) {
  const f = folders.find(x => x.id === id);
  if (!f) return [];
  const parent = f.parent ? folders.find(x => x.id === f.parent) : null;
  return parent ? [parent, f] : [f];
}
export async function createFolder(name, parent = null) {
  const list = await listFolders();
  const clean = String(name || '').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60);
  if (!clean) throw Object.assign(new Error('empty'), { userMessage: 'Der Ordnername darf nicht leer sein.' });
  if (parent) { const p = list.find(f => f.id === parent); if (!p) parent = null; else if (p.parent) parent = p.parent; } // one level only
  if (list.some(f => f.parent === parent && f.name.toLocaleLowerCase('de') === clean.toLocaleLowerCase('de'))) throw Object.assign(new Error('dup'), { userMessage: `Ein Ordner „${clean}“ existiert hier schon.` });
  const f = { id: db.uid(), name: clean, parent, createdAt: Date.now() };
  list.push(f);
  await saveFolders(list);
  return f;
}
export async function renameFolder(id, name) {
  const list = await listFolders();
  const f = list.find(x => x.id === id);
  const clean = String(name || '').trim().slice(0, 60);
  if (!f || !clean) return;
  f.name = clean;
  await saveFolders(list);
}
/** Delete a folder: its files (and subfolders' files) move to the parent folder. */
export async function deleteFolder(id) {
  const list = await listFolders();
  const f = list.find(x => x.id === id);
  if (!f) return;
  const subs = list.filter(x => x.parent === id).map(x => x.id);
  const gone = new Set([id, ...subs]);
  for (const d of await db.listFiles()) if (gone.has(d.folder)) await db.updateDoc(d.id, { folder: f.parent || null });
  await saveFolders(list.filter(x => !gone.has(x.id)));
}
export async function moveDocsToFolder(ids, folderId) {
  for (const id of ids) await db.updateDoc(id, { folder: folderId || null });
  emitChange();
}

export async function folderDialog(docs, { title } = {}) {
  const folders = await listFolders();
  const current = docs.length === 1 ? docs[0].folder || '' : null;
  const opts = [{ id: '', name: 'Keinem Ordner (Hauptebene)', depth: 0 }];
  folders.filter(f => !f.parent).sort((a, b) => a.name.localeCompare(b.name, 'de')).forEach(f => {
    opts.push({ id: f.id, name: f.name, depth: 0 });
    folders.filter(s => s.parent === f.id).sort((a, b) => a.name.localeCompare(b.name, 'de')).forEach(s => opts.push({ id: s.id, name: s.name, depth: 1 }));
  });
  const r = await openDialog({
    title: title || 'In Ordner verschieben',
    body: `<div class="folder-pick" role="radiogroup">${opts.map(o => `<label class="pick-item fp-${o.depth}"><input type="radio" name="f" value="${esc(o.id)}" ${o.id === current ? 'checked' : ''}><span class="fp-ic">${oicon(o.id ? 'folder' : 'home')}</span><span class="doc-name">${esc(o.name)}</span></label>`).join('')}</div>
      <button class="btn btn-soft btn-sm" type="button" data-newf>${oicon('folderPlus')} Neuer Ordner</button>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Verschieben', value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => {
      $('[data-newf]', dlg).addEventListener('click', async () => {
        const box = $('.folder-pick', dlg);
        const row = h(`<div class="fp-new"><input class="input" placeholder="Name des neuen Ordners" aria-label="Name des neuen Ordners"><button class="btn btn-primary btn-sm" type="button">Anlegen</button></div>`);
        box.after(row);
        const inp = $('input', row);
        inp.focus();
        const go = async () => {
          try {
            const f = await createFolder(inp.value);
            box.appendChild(h(`<label class="pick-item fp-0"><input type="radio" name="f" value="${esc(f.id)}" checked><span class="fp-ic">${oicon('folder')}</span><span class="doc-name">${esc(f.name)}</span></label>`));
            row.remove();
          } catch (e) { errorToast(e, 'Ordner konnte nicht angelegt werden.'); }
        };
        $('button', row).addEventListener('click', go);
        inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); go(); } });
      });
      return { collect: () => { const c = $('input[name=f]:checked', dlg); return c ? c.value : null; } };
    },
  });
  if (r.value !== 'ok' || r.data === null || r.data === undefined) return false;
  await moveDocsToFolder(docs.map(d => d.id), r.data || null);
  const f = folders.find(x => x.id === r.data) || (await listFolders()).find(x => x.id === r.data);
  toast(r.data ? `Verschoben nach „${f ? f.name : 'Ordner'}“` : 'Auf die Hauptebene verschoben', 'success');
  return true;
}

// ---------------- tags ----------------
// tags can arrive from FaLe Sync / backups: only well-formed entries, colours that are safe inside style="…"
export async function listTags() {
  const list = (await db.getSetting('tags', [])) || [];
  return (Array.isArray(list) ? list : []).filter(t => t && typeof t === 'object' && t.id != null)
    .map(t => ({ ...t, name: String(t.name ?? ''), color: cssColor(t.color, '#6B7280') }));
}
async function saveTags(list) { await db.setSetting('tags', list); emitChange(); }
export async function createTag(name, color) {
  const list = await listTags();
  const clean = String(name || '').trim().slice(0, 30);
  if (!clean) throw Object.assign(new Error('empty'), { userMessage: 'Der Tag-Name darf nicht leer sein.' });
  const ex = list.find(t => t.name.toLocaleLowerCase('de') === clean.toLocaleLowerCase('de'));
  if (ex) return ex;
  const t = { id: db.uid(), name: clean, color: color || TAG_COLORS[list.length % TAG_COLORS.length] };
  list.push(t);
  await saveTags(list);
  return t;
}
export async function deleteTag(id) {
  await saveTags((await listTags()).filter(t => t.id !== id));
  for (const d of await db.listFiles()) if ((d.tags || []).includes(id)) await db.updateDoc(d.id, { tags: d.tags.filter(x => x !== id) });
  emitChange();
}
export function tagChips(doc, tags) {
  const list = (doc.tags || []).map(id => tags.find(t => t.id === id)).filter(Boolean);
  return list.map(t => `<span class="tag-dot" style="--tc:${t.color}">${esc(t.name)}</span>`).join('');
}
export async function tagsDialog(doc) {
  let tags = await listTags();
  const sel = new Set(doc.tags || []);
  const r = await openDialog({
    title: 'Tags',
    body: `<p class="small">Farbige Tags helfen beim Wiederfinden – z. B. „Steuer“, „Wohnung“, „Auto“.</p><div class="tag-pick"></div>
      <div class="tag-new"><input class="input" name="tn" placeholder="Neuer Tag" aria-label="Neuer Tag"><div class="tag-colors" role="radiogroup" aria-label="Farbe">${TAG_COLORS.map((c, i) => `<button type="button" class="swatch" style="background:${c}" data-c="${c}" aria-label="Farbe ${i + 1}" aria-pressed="${i === tags.length % TAG_COLORS.length}"></button>`).join('')}</div>
      <button class="btn btn-soft btn-sm" type="button" data-addtag>${oicon('plus')} Hinzufügen</button></div>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Übernehmen', value: 'ok', kind: 'btn-primary', default: true }],
    onMount: dlg => {
      let color = TAG_COLORS[tags.length % TAG_COLORS.length];
      const paint = () => {
        const box = $('.tag-pick', dlg);
        box.innerHTML = tags.length ? '' : '<p class="muted small">Noch keine Tags.</p>';
        tags.forEach(t => {
          const b = h(`<button type="button" class="tag-toggle" style="--tc:${t.color}" aria-pressed="${sel.has(t.id)}">${esc(t.name)}</button>`);
          b.addEventListener('click', () => { if (sel.has(t.id)) sel.delete(t.id); else sel.add(t.id); b.setAttribute('aria-pressed', String(sel.has(t.id))); });
          box.appendChild(b);
        });
      };
      paint();
      $$('[data-c]', dlg).forEach(b => b.addEventListener('click', () => { color = b.dataset.c; $$('[data-c]', dlg).forEach(x => x.setAttribute('aria-pressed', String(x === b))); }));
      const add = async () => {
        const inp = $('[name=tn]', dlg);
        try { const t = await createTag(inp.value, color); tags = await listTags(); sel.add(t.id); inp.value = ''; paint(); } catch (e) { errorToast(e, 'Tag konnte nicht angelegt werden.'); }
      };
      $('[data-addtag]', dlg).addEventListener('click', add);
      $('[name=tn]', dlg).addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); add(); } });
      return { collect: () => [...sel] };
    },
  });
  if (r.value !== 'ok') return false;
  await db.updateDoc(doc.id, { tags: r.data });
  doc.tags = r.data;
  emitChange();
  return true;
}

// ---------------- Papierkorb ----------------
export async function trashDoc(doc, { undo = true } = {}) {
  await db.deleteDoc(doc.id);
  dropThumb(doc.id);
  emitChange();
  toast('In den Papierkorb verschoben', 'info', undo ? { action: { label: 'Rückgängig', onClick: async () => { await db.restoreFromTrash(doc.id); emitChange(); } } } : {});
}

export async function mountTrash(screen) {
  const wrap = h('<div class="screen-inner trash-screen"></div>');
  screen.body.appendChild(wrap);
  const emptyBtn = h(`<button class="btn btn-danger-ghost" type="button" data-empty>${oicon('trash')} Papierkorb leeren</button>`);
  emptyBtn.addEventListener('click', async () => {
    if (!await confirmDialog('Papierkorb leeren?', 'Alle Dateien im Papierkorb werden endgültig gelöscht.', { okLabel: 'Endgültig löschen', danger: true })) return;
    await db.emptyTrash(); toast('Papierkorb geleert', 'success'); render();
  });
  async function render() {
    const items = await db.listTrash();
    screen.setFoot(items.length ? [emptyBtn] : [], items.length ? `${items.length} Datei${items.length === 1 ? '' : 'en'} · ${formatSize(items.reduce((s, x) => s + (x.meta.size || 0), 0))}` : '');
    wrap.innerHTML = `<div class="card intro"><span class="tile-ic">${oicon('trash')}</span><div><strong>Gelöscht ist nicht gleich weg</strong><p>Dateien bleiben hier 30 Tage, dann werden sie automatisch endgültig entfernt. So kannst du Versehen in Ruhe rückgängig machen.</p></div></div><div class="doc-list trash-list"></div>`;
    const list = $('.trash-list', wrap);
    if (!items.length) { list.appendChild(h(`<div class="empty" style="grid-column:1/-1"><div class="empty-art">${oicon('trash')}</div><h3>Der Papierkorb ist leer</h3><p>Gelöschte Dateien erscheinen hier.</p></div>`)); return; }
    for (const it of items) {
      const left = Math.max(0, 30 - Math.floor((Date.now() - it.deletedAt) / 86400000));
      const el = h(`<article class="doc trash-item" data-id="${esc(it.id)}"><div class="doc-open">${fileThumb({ ...it.meta, thumb: null })}<span class="doc-info"><span class="doc-name">${esc(it.meta.name)}</span><span class="doc-meta">${formatSize(it.meta.size)} · gelöscht ${formatDate(it.deletedAt)} · noch ${left} Tag${left === 1 ? '' : 'e'}</span></span></div>
        <button class="btn btn-soft btn-sm" type="button" data-restore>${oicon('restore')}<span class="hide-sm">Wiederherstellen</span></button>
        <button class="icon-btn" type="button" data-del aria-label="${esc(it.meta.name)} endgültig löschen">${oicon('trash')}</button></article>`);
      $('[data-restore]', el).addEventListener('click', async () => { await db.restoreFromTrash(it.id); emitChange(); toast(`„${it.meta.name}“ wiederhergestellt`, 'success'); render(); });
      $('[data-del]', el).addEventListener('click', async () => {
        if (!await confirmDialog('Endgültig löschen?', `„${it.meta.name}“ wird unwiderruflich entfernt.`, { okLabel: 'Löschen', danger: true })) return;
        await db.deleteFromTrash(it.id); render();
      });
      list.appendChild(el);
    }
  }
  await render();
}

// ---------------- Duplikate ----------------
async function hashOf(doc) {
  if (doc.hash && doc.hashSize === doc.size) return doc.hash;
  const blob = await db.getFile(doc.id);
  if (!blob) return null;
  const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  const hex = Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join('');
  await db.updateDoc(doc.id, { hash: hex, hashSize: doc.size });
  return hex;
}
/** Groups of identical files (same SHA-256). */
export async function findDuplicates(onProgress) {
  const docs = await db.listFiles();
  // only files that share a size can be identical
  const bySize = new Map();
  docs.forEach(d => { const k = d.size; if (!bySize.has(k)) bySize.set(k, []); bySize.get(k).push(d); });
  const cand = [...bySize.values()].filter(g => g.length > 1).flat();
  const byHash = new Map();
  let i = 0;
  for (const d of cand) {
    const hx = await hashOf(d);
    if (hx) { if (!byHash.has(hx)) byHash.set(hx, []); byHash.get(hx).push(d); }
    onProgress && onProgress(++i, cand.length);
  }
  return [...byHash.values()].filter(g => g.length > 1).map(g => g.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)));
}

export async function mountDuplicates(screen) {
  const wrap = h('<div class="screen-inner dup-screen"></div>');
  screen.body.appendChild(wrap);
  screen.setFoot([]);
  async function render() {
    wrap.innerHTML = `<div class="v-loading" style="position:relative;min-height:160px"><div><span class="spinner dark" style="width:30px;height:30px"></span><span data-p>Dateien werden verglichen …</span></div></div>`;
    let groups;
    try { groups = await findDuplicates((n, t) => { const p = $('[data-p]', wrap); if (p) p.textContent = `Dateien werden verglichen … ${n}/${t}`; }); } catch (e) { errorToast(e, 'Vergleich fehlgeschlagen.'); return; }
    const extra = groups.reduce((s, g) => s + g.slice(1).reduce((a, d) => a + d.size, 0), 0);
    wrap.innerHTML = `<div class="card intro"><span class="tile-ic">${oicon('duplicate')}</span><div><strong>${groups.length ? `${groups.length} Gruppe${groups.length === 1 ? '' : 'n'} identischer Dateien` : 'Keine Duplikate gefunden'}</strong>
      <p>${groups.length ? `Verglichen wird der Inhalt (SHA-256), nicht nur der Name. Löschen der Kopien spart ${formatSize(extra)}. Gelöschte Dateien landen im Papierkorb.` : 'Alle Dateien auf diesem Gerät sind einzigartig. 🎉'}</p></div></div><div data-groups></div>`;
    const box = $('[data-groups]', wrap);
    groups.forEach(g => {
      const sec = h(`<section class="card dup-group"><div class="dup-head"><strong>${esc(g[0].name)}</strong><span class="muted small">${g.length} identische Dateien · je ${formatSize(g[0].size)}</span>
        <button class="btn btn-soft btn-sm" type="button" data-keep>${oicon('checkCircle')} Älteste behalten, Rest löschen</button></div><div class="dup-items"></div></section>`);
      g.forEach((d, i) => {
        const row = h(`<div class="dup-item">${fileThumb(d)}<span class="doc-info"><span class="doc-name">${esc(d.name)}${i === 0 ? ' <span class="badge">Original</span>' : ''}</span><span class="doc-meta">${fileMeta(d)}</span></span>
          <button class="icon-btn" type="button" aria-label="${esc(d.name)} löschen">${oicon('trash')}</button></div>`);
        $('button', row).addEventListener('click', async () => { await db.deleteDoc(d.id); dropThumb(d.id); emitChange(); toast('In den Papierkorb verschoben'); render(); });
        $('.dup-items', sec).appendChild(row);
      });
      $('[data-keep]', sec).addEventListener('click', async () => {
        for (const d of g.slice(1)) { await db.deleteDoc(d.id); dropThumb(d.id); }
        emitChange(); toast(`${g.length - 1} Kopie${g.length - 1 === 1 ? '' : 'n'} in den Papierkorb verschoben`, 'success'); render();
      });
      box.appendChild(sec);
    });
  }
  await render();
}

export { kindOf, progress };
