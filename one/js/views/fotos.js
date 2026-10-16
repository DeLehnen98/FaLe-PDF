// FaLe Fotos: timeline (justified, virtualised), albums, favourites, duplicate finder, backup + Takeout import.
import { el, clear, icon, toast, errorToast, openDialog, confirmDialog, promptDialog, actionSheet, pickFiles, progressBar } from '../dom.js';
import { t, tp, fmtNum, fmtSize, fmtDate, ago } from '../i18n.js';
import * as E from '../engine.js';
import { createGrid, groupByDay } from './grid.js';
import { thumbEl, displayName, trashNodes, downloadNode, sizeOf, openNode } from './common.js';
import { backupPhotos, openSheet } from './uploads.js';
import { quotaWidget, statusText, emHomeCard } from '../app.js';
import { isNativeApp } from '../config.js';

const zoomKey = 'fale-one-zoom';
const getZoom = () => { try { const z = +localStorage.getItem(zoomKey); return z >= 0 && z <= 2 ? z : 1; } catch { return 1; } };

export async function mount(main, { parts, setTitle }) {
  const sub = parts[0] || '';
  if (sub === 'alben') return albumsView(main, setTitle);
  if (sub === 'album' && parts[1]) return timelineView(main, setTitle, { albumId: parts[1] });
  if (sub === 'favoriten') return timelineView(main, setTitle, { favorites: true });
  if (sub === 'duplikate') return duplicatesView(main, setTitle);
  return timelineView(main, setTitle, {});
}

function subNav(active) {
  const items = [['', t('Zeitachse')], ['alben', t('Alben')], ['favoriten', t('Favoriten')], ['duplikate', t('Duplikate')]];
  return el('nav.subnav', { aria: { label: t('Fotos-Bereiche') } }, items.map(([k, l]) => el('a.subnav-item' + (k === active ? '.on' : ''), { href: '#/fotos' + (k ? '/' + k : ''), aria: { current: k === active ? 'page' : undefined } }, l)));
}
function statusCard() {
  const box = el('section.status-card', { aria: { label: t('Sicherung') } });
  const paint = () => {
    const st = statusText();
    const b = E.state.backup;
    const me = b && b.devices ? b.devices.find(d => d.self) : null;
    const waiting = [...E.state.jobs.values()].filter(j => ['waiting', 'hashing', 'queued', 'uploading', 'committing', 'paused', 'error'].includes(j.state)).length;
    clear(box).append(
      el('div.sc-line', el('span.sc-ic.' + st.kind, icon(st.icon)), el('div.sc-text',
        el('strong', me && me.lastSuccessAt ? t('Letzte Sicherung: {when}', { when: ago(me.lastSuccessAt) }) : t('Auf diesem Gerät noch keine Sicherung')),
        el('span.muted', tp(waiting, '{n} wartend', '{n} wartend') + ' · ' + t('Originale, unverändert und verschlüsselt'))),
        el('button.btn.primary.sc-btn', { type: 'button', onclick: () => backupPhotos() }, icon('cloudUp'), el('span', t('Fotos sichern')))),
      el('div.sc-quota', { data: { quota: 'card' } }, quotaWidget()));
  };
  paint();
  return { node: box, paint };
}

// ---------------------------------------------------------------- timeline / album / favourites
async function timelineView(main, setTitle, { albumId = null, favorites = false }) {
  const album = albumId ? E.state.albums.get(albumId) : null;
  setTitle(albumId ? (album ? album.name : t('Album')) : favorites ? t('Favoriten') : t('Fotos'));
  const wrap = el('div.view.fotos');
  main.appendChild(wrap);
  const head = el('div.view-head');
  wrap.append(head);
  const sc = !albumId && !favorites ? statusCard() : null;
  if (sc) wrap.append(sc.node, emHomeCard());
  if (sc && isNativeApp()) { // Android app: automatic backup card (js/native.js is never loaded on the web)
    const slot = el('div');
    wrap.append(slot);
    import('../native.js').then(m => slot.append(m.backupCard({ compact: true }))).catch(e => console.error(e));
  }
  wrap.append(subNav(albumId ? 'alben' : favorites ? 'favoriten' : ''));
  let zoom = getZoom();
  const empty = el('div.empty', { hidden: true });
  const grid = createGrid({
    zoom, label: t('Fotos'),
    onOpen: (n, list) => openNode(n, { list }),
    onSelectionChange: (set, on) => paintSelBar(set, on),
  });
  wrap.append(empty, grid.node);
  const toolbar = el('div.view-tools',
    el('span.muted', { data: { count: '' } }),
    el('div.bar-spacer'),
    el('button.icon-btn', { type: 'button', title: t('Kleiner'), aria: { label: t('Kleinere Vorschaubilder') }, onclick: () => setZoom(zoom - 1) }, icon('zoomOut')),
    el('button.icon-btn', { type: 'button', title: t('Größer'), aria: { label: t('Größere Vorschaubilder') }, onclick: () => setZoom(zoom + 1) }, icon('zoomIn')),
    el('button.icon-btn', { type: 'button', title: t('Auswählen'), aria: { label: t('Auswählen') }, onclick: () => grid.setSelectMode(!grid.selectMode) }, icon('checkCircle')),
    el('button.icon-btn', { type: 'button', title: t('Mehr'), aria: { label: t('Weitere Aktionen') }, onclick: () => moreMenu() }, icon('more')));
  head.append(el('h2.view-title', albumId ? (album ? album.name : t('Album')) : favorites ? t('Favoriten') : t('Zeitachse')), toolbar);
  const setZoom = z => { zoom = Math.max(0, Math.min(2, z)); try { localStorage.setItem(zoomKey, String(zoom)); } catch {} grid.setZoom(zoom); };

  const selBar = el('div.selbar', { hidden: true, role: 'toolbar', aria: { label: t('Auswahl') } });
  wrap.append(selBar);
  function selection() { return [...grid.selected].map(id => E.state.nodes.get(id)).filter(Boolean); }
  function paintSelBar(set, on) {
    selBar.hidden = !on;
    document.body.classList.toggle('has-selbar', on);
    clear(selBar).append(
      el('button.icon-btn', { type: 'button', aria: { label: t('Auswahl beenden') }, onclick: () => grid.setSelectMode(false) }, icon('close')),
      el('span.sel-count', tp(set.size, '{n} ausgewählt', '{n} ausgewählt')),
      el('div.bar-spacer'),
      el('button.btn.ghost.sm', { type: 'button', disabled: !set.size, onclick: () => addToAlbum(selection()) }, icon('album'), el('span', t('Zu Album'))),
      el('button.icon-btn', { type: 'button', disabled: !set.size, title: t('Favorit'), aria: { label: t('Als Favorit markieren') }, onclick: () => favorite(selection(), true) }, icon('star')),
      el('button.icon-btn', { type: 'button', disabled: !set.size, title: t('Herunterladen'), aria: { label: t('Herunterladen') }, onclick: async () => { for (const n of selection()) await downloadNode(n); } }, icon('download')),
      albumId ? el('button.btn.ghost.sm', { type: 'button', disabled: !set.size, onclick: async () => { const ids = [...set]; await E.call('albumItems', { id: albumId, remove: ids }).catch(errorToast); grid.setSelectMode(false); toast(tp(ids.length, '{n} Foto aus dem Album entfernt.', '{n} Fotos aus dem Album entfernt.')); } }, t('Aus Album entfernen')) : null,
      el('button.icon-btn.danger', { type: 'button', disabled: !set.size, title: t('Überall löschen'), aria: { label: t('Überall löschen') }, onclick: async () => { if (await trashNodes(selection(), { ask: true })) grid.setSelectMode(false); } }, icon('trash')));
  }
  async function moreMenu() {
    actionSheet({ title: t('Fotos'), items: [
      { label: t('Fotos sichern'), icon: 'cloudUp', run: () => backupPhotos() },
      { label: t('Alle auswählen'), icon: 'checkCircle', run: () => grid.selectAll() },
      { label: t('Aus Google Takeout importieren'), icon: 'zip', hidden: !!albumId, run: () => takeoutDialog() },
      { label: t('Fotos zum Album hinzufügen'), icon: 'plus', hidden: !albumId, run: () => addPhotosToAlbum(albumId) },
      { label: t('Album umbenennen'), icon: 'edit', hidden: !albumId, run: () => renameAlbum(albumId) },
      { label: t('Album löschen'), icon: 'trash', danger: true, hidden: !albumId, run: () => deleteAlbum(albumId) },
      { label: t('Uploads anzeigen'), icon: 'cloudUp', run: () => openSheet() },
    ] });
  }
  const fab = el('button.fab', { type: 'button', aria: { label: t('Fotos sichern') }, onclick: () => (albumId ? addPhotosToAlbum(albumId) : backupPhotos()) }, icon(albumId ? 'plus' : 'cloudUp'), el('span', albumId ? t('Hinzufügen') : t('Sichern')));
  wrap.append(fab);

  const paint = () => {
    const al = albumId ? E.state.albums.get(albumId) : null;
    if (albumId && !al && E.state.lastSync) { clear(wrap).append(el('div.empty', el('p', t('Dieses Album gibt es nicht mehr.')), el('a.btn.ghost', { href: '#/fotos/alben' }, t('Zu den Alben')))); return; }
    if (al) { setTitle(al.name); head.querySelector('.view-title').textContent = al.name; }
    const mem = albumId ? (E.state.members.get(albumId) || new Set()) : null;
    const list = E.photos({ filter: mem ? (n => mem.has(n.id)) : favorites ? (n => n.meta && n.meta.favorite) : null });
    if (albumId) for (const id of mem) { const n = E.state.nodes.get(id); if (n && n.kind === 'file' && !n.trashedAt) list.push(n); }
    head.querySelector('[data-count]').textContent = tp(list.length, '{n} Element', '{n} Elemente');
    empty.hidden = list.length > 0;
    if (!list.length) {
      clear(empty).append(icon(albumId ? 'album' : favorites ? 'star' : 'photos', { cls: 'empty-ic' }),
        el('h3', albumId ? t('Dieses Album ist leer') : favorites ? t('Noch keine Favoriten') : t('Noch keine Fotos gesichert')),
        el('p', albumId ? t('Füge Fotos aus deiner Zeitachse hinzu.') : favorites ? t('Tippe im Foto auf den Stern, um es hier zu sammeln.') : t('Wähle Fotos aus deiner Galerie. Sie werden auf diesem Gerät verschlüsselt und im Original gesichert – Doppelte werden erkannt und übersprungen.')),
        !favorites ? el('button.btn.primary', { type: 'button', onclick: () => (albumId ? addPhotosToAlbum(albumId) : backupPhotos()) }, icon(albumId ? 'plus' : 'cloudUp'), albumId ? t('Fotos hinzufügen') : t('Fotos sichern')) : null,
        !albumId && !favorites ? el('button.btn.ghost', { type: 'button', onclick: () => takeoutDialog() }, icon('zip'), t('Aus Google Takeout importieren')) : null);
    }
    grid.setGroups(albumId || favorites ? [{ key: 'all', items: list }] : groupByDay(list));
  };
  paint();
  let lastCount = -1;
  return {
    update(w) {
      if (w.has('nodes')) { paint(); lastCount = -1; }
      if (sc && (w.has('backup') || w.has('jobs') || w.has('quota'))) sc.paint();
    },
    destroy() { grid.destroy(); document.body.classList.remove('has-selbar'); void lastCount; },
  };
}

async function favorite(nodes, on) {
  let n = 0;
  for (const x of nodes) { try { await E.call('patchMeta', { id: x.id, patch: { favorite: on ? true : null } }); n++; } catch (e) { errorToast(e); } }
  if (n) toast(on ? tp(n, '{n} Favorit markiert.', '{n} Favoriten markiert.') : t('Favorit entfernt.'));
}
export { favorite };

// ---------------------------------------------------------------- albums
export async function addToAlbum(nodes) {
  if (!nodes.length) return;
  const albums = [...E.state.albums.values()].sort((a, b) => a.name.localeCompare(b.name));
  const r = await actionSheet({ title: t('Zu Album hinzufügen'), sub: tp(nodes.length, '{n} Element', '{n} Elemente'), items: [
    { label: t('Neues Album …'), icon: 'plus', run: async () => { const name = await promptDialog({ title: t('Neues Album'), label: t('Name'), ok: t('Erstellen') }); if (!name) return; try { const a = await E.call('albumCreate', { name }); await E.call('albumItems', { id: a.id, add: nodes.map(n => n.id) }); toast(t('Album „{name}“ erstellt.', { name })); } catch (e) { errorToast(e); } } },
    ...albums.map(a => ({ label: a.name || t('Ohne Namen'), icon: 'album', hint: tp((E.state.members.get(a.id) || new Set()).size, '{n} Element', '{n} Elemente'), run: async () => { try { await E.call('albumItems', { id: a.id, add: nodes.map(n => n.id) }); toast(t('Zu „{name}“ hinzugefügt.', { name: a.name })); } catch (e) { errorToast(e); } } })),
  ] });
  return r;
}
async function renameAlbum(id) {
  const a = E.state.albums.get(id);
  if (!a) return;
  const name = await promptDialog({ title: t('Album umbenennen'), label: t('Name'), value: a.name });
  if (!name || name === a.name) return;
  try { await E.call('albumPatch', { id, patch: { name } }); toast(t('Umbenannt.')); } catch (e) { errorToast(e); }
}
async function deleteAlbum(id) {
  const a = E.state.albums.get(id);
  if (!a || !(await confirmDialog({ title: t('Album löschen?'), text: t('Das Album „{name}“ wird gelöscht. Die Fotos darin bleiben in deiner Zeitachse.', { name: a.name }), ok: t('Album löschen'), danger: true }))) return;
  try { await E.call('albumDelete', { id }); location.hash = '#/fotos/alben'; toast(t('Album gelöscht.')); } catch (e) { errorToast(e); }
}
async function addPhotosToAlbum(albumId) {
  const mem = E.state.members.get(albumId) || new Set();
  const list = E.photos({ filter: n => !mem.has(n.id) });
  if (!list.length) { toast(t('Alle Fotos sind schon in diesem Album.')); return; }
  const grid = createGrid({ zoom: 0, onOpen: () => {}, onSelectionChange: set => { btnCount.textContent = tp(set.size, '{n} ausgewählt', '{n} ausgewählt'); } });
  const btnCount = el('span.muted', tp(0, '{n} ausgewählt', '{n} ausgewählt'));
  const box = el('div.pick-photos', grid.node);
  const r = await openDialog({ title: t('Fotos hinzufügen'), cls: 'wide', body: [btnCount, box], actions: [{ label: t('Abbrechen'), value: 'cancel' }, { label: t('Hinzufügen'), value: 'ok', default: true }],
    onMount: () => { grid.setSelectMode(true); grid.setGroups(groupByDay(list)); box.addEventListener('scroll', () => window.dispatchEvent(new Event('scroll')), { passive: true }); return { collect: () => [...grid.selected] }; } });
  grid.destroy();
  if (r.value !== 'ok' || !r.data.length) return;
  try { await E.call('albumItems', { id: albumId, add: r.data }); toast(tp(r.data.length, '{n} Foto hinzugefügt.', '{n} Fotos hinzugefügt.')); } catch (e) { errorToast(e); }
}
function albumsView(main, setTitle) {
  setTitle(t('Alben'));
  const wrap = el('div.view.albums');
  main.appendChild(wrap);
  const list = el('div.album-grid', { role: 'list' });
  wrap.append(el('div.view-head', el('h2.view-title', t('Alben')), el('div.view-tools', el('div.bar-spacer'),
    el('button.btn.primary.sm', { type: 'button', onclick: async () => { const name = await promptDialog({ title: t('Neues Album'), label: t('Name'), ok: t('Erstellen') }); if (!name) return; try { const a = await E.call('albumCreate', { name }); location.hash = '#/fotos/album/' + a.id; } catch (e) { errorToast(e); } } }, icon('plus'), el('span', t('Neues Album'))))),
  subNav('alben'), list);
  const paint = () => {
    clear(list);
    const albums = [...E.state.albums.values()].sort((a, b) => a.name.localeCompare(b.name));
    if (!albums.length) { list.append(el('div.empty', icon('album', { cls: 'empty-ic' }), el('h3', t('Noch keine Alben')), el('p', t('Sammle Fotos in Alben – ein Foto kann in mehreren Alben sein und bleibt trotzdem nur einmal gespeichert.')))); return; }
    for (const a of albums) {
      const mem = [...(E.state.members.get(a.id) || [])].map(id => E.state.nodes.get(id)).filter(n => n && !n.trashedAt);
      const cover = (a.meta && a.meta.cover && E.state.nodes.get(a.meta.cover)) || mem.sort((x, y) => E.takenOf(y).ts - E.takenOf(x).ts)[0];
      list.append(el('a.album-card', { href: '#/fotos/album/' + a.id, role: 'listitem' }, cover ? thumbEl(cover, 'album-cover') : el('span.album-cover.empty', icon('album')),
        el('span.album-name', a.name || t('Ohne Namen')), el('span.muted', tp(mem.length, '{n} Element', '{n} Elemente'))));
    }
  };
  paint();
  return { update(w) { if (w.has('nodes')) paint(); } };
}

// ---------------------------------------------------------------- duplicates
function duplicatesView(main, setTitle) {
  setTitle(t('Duplikate'));
  const wrap = el('div.view.dups');
  main.appendChild(wrap);
  const body = el('div.dup-list');
  wrap.append(el('div.view-head', el('h2.view-title', t('Duplikate'))), subNav('duplikate'),
    el('p.muted.lead', t('Gleicher Inhalt, mehrfach gespeichert – erkannt am verschlüsselten Fingerabdruck, ohne dass der Server deine Dateien kennt. Beim Aufräumen bleibt jeweils die älteste Kopie.')), body);
  const groupsOf = () => {
    const by = new Map();
    for (const n of E.state.nodes.values()) {
      if (n.kind === 'folder' || n.trashedAt || !n.head || !n.head.hash) continue;
      if (!by.has(n.head.hash)) by.set(n.head.hash, []);
      by.get(n.head.hash).push(n);
    }
    return [...by.values()].filter(g => g.length > 1).map(g => g.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)));
  };
  const paint = () => {
    clear(body);
    const groups = groupsOf();
    if (!groups.length) { body.append(el('div.empty', icon('checkCircle', { cls: 'empty-ic' }), el('h3', t('Keine Duplikate gefunden')), el('p', t('Jede Datei ist nur einmal gespeichert.')))); return; }
    const spare = groups.reduce((s, g) => s + sizeOf(g[0]) * (g.length - 1), 0);
    body.append(el('div.dup-sum', el('span', tp(groups.length, '{n} Gruppe', '{n} Gruppen') + ' · ' + t('{size} frei machbar', { size: fmtSize(spare) })),
      el('button.btn.primary.sm', { type: 'button', onclick: async () => {
        const extra = groups.flatMap(g => g.slice(1));
        if (!(await confirmDialog({ title: t('Alle Duplikate aufräumen?'), text: tp(extra.length, '{n} Kopie kommt in den Papierkorb (30 Tage wiederherstellbar). Von jeder Datei bleibt die älteste Kopie.', '{n} Kopien kommen in den Papierkorb (30 Tage wiederherstellbar). Von jeder Datei bleibt die älteste Kopie.'), ok: t('Aufräumen') }))) return;
        await trashNodes(extra);
      } }, t('Alle aufräumen'))));
    for (const g of groups) {
      body.append(el('section.dup-group',
        el('div.dup-items', g.map((n, i) => el('button.dup-item', { type: 'button', onclick: () => openNode(n, { list: g }) }, thumbEl(n, 'dup-thumb'),
          el('span.dup-name', displayName(n)), el('span.muted', [i === 0 ? t('Original (älteste)') : t('Kopie'), pathLabel(n), fmtDate(n.createdAt)].filter(Boolean).join(' · '))))),
        el('button.btn.ghost.sm', { type: 'button', onclick: () => trashNodes(g.slice(1)) }, tp(g.length - 1, '{n} Kopie entfernen', '{n} Kopien entfernen'))));
    }
  };
  paint();
  return { update(w) { if (w.has('nodes')) paint(); } };
}
function pathLabel(n) { const p = E.pathOf(n.parent); return p.length ? p.map(x => x.name).join(' / ') : t('Meine Dateien'); }

// ---------------------------------------------------------------- Google Takeout
export async function takeoutDialog() {
  const files = await pickFiles({ accept: '.zip,application/zip', multiple: true });
  if (!files.length) return;
  const status = el('p.muted', t('Lese das Archiv …'));
  const bar = progressBar(0);
  const prog = E.onProgress('takeout', d => { status.textContent = d.extracted ? t('Entpacke … {n}', { n: fmtNum(d.extracted) }) : t('Gefunden: {n}', { n: fmtNum(d.n) }); });
  let closeProg = () => {};
  openDialog({ title: t('Google Takeout importieren'), body: [status, bar], actions: [], dismiss: false, onMount: (d, fin) => { closeProg = () => fin('cancel'); } });
  let scan;
  try { scan = await E.call('takeoutScan', { files }); }
  catch (e) { prog(); closeProg(); errorToast(e, t('Das Archiv konnte nicht gelesen werden. Ist es eine Google-Takeout-ZIP?')); return; }
  closeProg();
  const n = scan.photos + scan.videos;
  if (!n) { prog(); toast(t('In diesem Archiv wurden keine Fotos oder Videos gefunden.'), { kind: 'error' }); return; }
  const r = await openDialog({ title: t('Google Takeout importieren'), body: [
    el('ul.gate-points',
      el('li', icon('photos'), tp(scan.photos, '{n} Foto', '{n} Fotos') + ', ' + tp(scan.videos, '{n} Video', '{n} Videos')),
      el('li', icon('info'), t('{n} mit Google-Metadaten (Datum, Ort, Favorit)', { n: fmtNum(scan.withSidecar) })),
      el('li', icon('album'), tp(scan.albums.length, '{n} Album', '{n} Alben'))),
    el('p.hint', t('Die Originale werden unverändert gesichert, Datum und Ort aus den JSON-Dateien kommen verschlüsselt in die Metadaten. Doppelte (z. B. in Jahres- und Albumordnern) werden nur einmal gespeichert.')),
  ], actions: [{ label: t('Abbrechen'), value: 'cancel' }, { label: t('Importieren'), value: 'ok', default: true }] });
  if (r.value !== 'ok') { prog(); return; }
  const close = toast(status, { timeout: 600000 });
  try { const res = await E.call('takeoutImport', { folderName: t('Fotos') }); close(); toast(t('Import läuft: {n} Elemente, {s} schon vorhanden.', { n: fmtNum(res.total), s: fmtNum(res.skipped) }), { action: { label: t('Anzeigen'), run: openSheet } }); }
  catch (e) { close(); errorToast(e); }
  finally { prog(); }
}
