// Full-screen viewer: photos (preview first, original on demand; swipe, pinch / double-tap zoom), videos and
// audio (decrypted into a Blob URL that is revoked on close), PDFs (vendored pdf.js), text, info panel.
// Decrypted content exists only in memory while it is shown.
import { el, clear, icon, toast, errorToast, errorText, progressBar } from '../dom.js';
import { t, fmtSize, fmtDateTime, fmtDuration } from '../i18n.js';
import * as E from '../engine.js';
import { kindOf } from '../media.js';
import { displayName, nodeKind, shareLink, openInPdf, isPdfLike, showVersions, renameNode, moveNodes, togglePin, trashNodes, sizeOf, dateOf, downloadNode, fetchBlob } from './common.js';

let active = null;
export function openViewer(n, { list }) {
  if (active) active.close(true);
  const items = (list && list.length ? list : [n]).filter(x => x.kind !== 'folder');
  let idx = Math.max(0, items.findIndex(x => x.id === n.id));
  let urls = [], infoOpen = false, cleanup = [];
  const stage = el('div.vw-stage');
  const title = el('h2.vw-title');
  const counter = el('span.vw-count');
  const favBtn = el('button.icon-btn.vw-fav', { type: 'button', title: t('Favorit'), aria: { label: t('Favorit'), pressed: 'false' } });
  const info = el('aside.vw-info', { hidden: true, aria: { label: t('Informationen') } });
  const prev = el('button.vw-nav.prev', { type: 'button', aria: { label: t('Vorheriges') }, onclick: () => go(-1) }, icon('chevronLeft'));
  const next = el('button.vw-nav.next', { type: 'button', aria: { label: t('Nächstes') }, onclick: () => go(1) }, icon('chevronRight'));
  const bar = el('header.vw-bar',
    el('button.icon-btn', { type: 'button', aria: { label: t('Schließen') }, onclick: () => close() }, icon('back')),
    el('div.vw-head', title, counter),
    favBtn,
    el('button.icon-btn', { type: 'button', title: t('Link teilen'), aria: { label: t('Link teilen') }, onclick: () => shareLink(cur()) }, icon('link')),
    el('button.icon-btn', { type: 'button', title: t('Herunterladen'), aria: { label: t('Original herunterladen') }, onclick: () => downloadNode(cur()) }, icon('download')),
    el('button.icon-btn', { type: 'button', title: t('Informationen'), aria: { label: t('Informationen') }, onclick: () => { infoOpen = !infoOpen; paintInfo(); } }, icon('info')),
    el('button.icon-btn', { type: 'button', title: t('Mehr'), aria: { label: t('Weitere Aktionen') }, onclick: () => more() }, icon('more')));
  const overlay = el('div.viewer', { role: 'dialog', aria: { modal: 'true', label: t('Ansicht') }, tabindex: '-1' }, bar, el('div.vw-body', stage, prev, next, info));
  document.body.appendChild(overlay);
  document.body.classList.add('viewer-open');
  const opener = document.activeElement;
  overlay.focus();
  history.pushState({ viewer: true }, '');
  const onPop = () => close(true);
  window.addEventListener('popstate', onPop);
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
  };
  overlay.addEventListener('keydown', onKey);

  const cur = () => E.state.nodes.get(items[idx].id) || items[idx];
  function revoke() { urls.forEach(u => URL.revokeObjectURL(u)); urls = []; cleanup.forEach(f => { try { f(); } catch {} }); cleanup = []; }
  function go(d) { const j = idx + d; if (j < 0 || j >= items.length) return; idx = j; show(); }
  function close(fromPop) {
    if (!active) return;
    active = null;
    revoke();
    window.removeEventListener('popstate', onPop);
    overlay.remove();
    document.body.classList.remove('viewer-open');
    if (!fromPop && history.state && history.state.viewer) history.back();
    if (opener && opener.focus) opener.focus();
  }
  active = { close };

  async function show() {
    revoke();
    const n = cur();
    title.textContent = displayName(n);
    counter.textContent = items.length > 1 ? `${idx + 1} / ${items.length}` : '';
    prev.hidden = idx === 0; next.hidden = idx >= items.length - 1;
    paintFav(n);
    paintInfo();
    clear(stage);
    const k = nodeKind(n);
    const loading = el('div.vw-loading', progressBar(0, t('Lade und entschlüssele …')), el('span', t('Entschlüssele …')));
    const myIdx = idx;
    const stale = () => myIdx !== idx || !active;
    if (k === 'image') {
      const img = el('img.vw-img', { alt: displayName(n), draggable: 'false' });
      const thumb = E.cachedThumb(n.id);
      if (thumb) { img.src = thumb; img.classList.add('blur'); }
      stage.append(img, loading);
      const usePreview = n.head && n.head.preview;
      try {
        const blob = await E.call('download', { id: n.id, purpose: usePreview ? 'preview' : 'content', progressId: 'vw' });
        if (stale()) return;
        const u = URL.createObjectURL(blob); urls.push(u);
        img.src = u; img.classList.remove('blur'); loading.remove();
        attachZoom(img);
        if (usePreview) stage.append(el('button.btn.ghost.sm.vw-orig', { type: 'button', onclick: async e => {
          e.currentTarget.disabled = true;
          try { const b = await fetchBlob(n, { label: t('Lade Original …') }); if (stale()) return; const u2 = URL.createObjectURL(b); urls.push(u2); img.src = u2; e.currentTarget.remove(); }
          catch (x) { errorToast(x); e.currentTarget.disabled = false; }
        } }, t('Original laden')));
      } catch (e) {
        if (stale()) return;
        loading.remove();
        if (n.meta && n.meta.noPreview) stage.append(noPreview(n, t('Dieses Format (z. B. HEIC/RAW) kann dieser Browser nicht anzeigen. Das Original ist sicher gespeichert – lade es herunter, um es zu öffnen.')));
        else stage.append(failBox(e));
      }
      return;
    }
    if (k === 'video' || k === 'audio' || k === 'pdf' || k === 'text') {
      stage.append(loading);
      const bar_ = loading.querySelector('.pbar');
      const off = E.onProgress('vw', f => bar_.set(f));
      cleanup.push(off);
      try {
        if (k === 'text' && sizeOf(n) > 3 * 1024 * 1024) { loading.remove(); stage.append(noPreview(n, t('Die Textdatei ist zu groß für die Vorschau.'))); return; }
        const blob = await E.call('download', { id: n.id, progressId: 'vw' });
        if (stale()) return;
        loading.remove();
        if (k === 'video' || k === 'audio') {
          const u = URL.createObjectURL(blob); urls.push(u);
          const media = el(k === 'video' ? 'video.vw-video' : 'audio.vw-audio', { controls: true, src: u, playsinline: true, preload: 'metadata' });
          stage.append(k === 'audio' ? el('div.vw-audio-box', icon('audio', { cls: 'big' }), el('p', displayName(n)), media) : media);
        } else if (k === 'text') {
          stage.append(el('pre.vw-text', { tabindex: '0' }, await blob.text()));
        } else {
          const box = el('div.vw-pdf', { tabindex: '0' });
          stage.append(box);
          const pv = await import('../pdfview.js');
          const destroy = await pv.renderPdf(box, blob, { onError: e => { clear(box).append(failBox(e, t('Diese PDF konnte nicht angezeigt werden.'))); } });
          cleanup.push(destroy);
          stage.append(el('button.btn.ghost.sm.vw-orig', { type: 'button', onclick: () => openInPdf(n) }, icon('pdf'), t('In FaLe PDF öffnen')));
        }
      } catch (e) { if (!stale()) { loading.remove(); stage.append(failBox(e)); } }
      return;
    }
    stage.append(noPreview(n));
  }
  function noPreview(n, text) {
    const offline = !navigator.onLine && !E.state.offline.ready.has(n.id);
    return el('div.vw-none', icon(nodeKind(n) === 'office' ? 'fileText' : 'file', { cls: 'big' }), el('p.vw-none-name', displayName(n)), el('p.muted', text || t('Für diesen Dateityp gibt es keine Vorschau.')),
      offline ? el('p.muted', t('Offline nicht verfügbar. Markiere Dateien als „Offline verfügbar“, um sie ohne Internet zu öffnen.')) : null,
      el('div.row-btns', el('button.btn.primary', { type: 'button', onclick: () => downloadNode(n) }, icon('download'), t('Herunterladen')),
        isPdfLike(n) ? el('button.btn.ghost', { type: 'button', onclick: () => openInPdf(n) }, icon('pdf'), t('In FaLe PDF öffnen')) : null));
  }
  function failBox(e, text) { return el('div.vw-none', icon('warning', { cls: 'big' }), el('p', text || errorText(e)), el('button.btn.ghost', { type: 'button', onclick: show }, t('Erneut versuchen'))); }
  function paintFav(n) {
    const photo = n.kind === 'photo';
    favBtn.hidden = !photo;
    const on = !!(n.meta && n.meta.favorite);
    clear(favBtn).append(icon('star', { filled: on }));
    favBtn.setAttribute('aria-pressed', String(on));
    favBtn.onclick = async () => {
      try { await E.call('patchMeta', { id: n.id, patch: { favorite: on ? null : true } }); paintFav(E.state.nodes.get(n.id)); toast(on ? t('Favorit entfernt.') : t('Als Favorit markiert.')); } catch (e) { errorToast(e); }
    };
  }
  function paintInfo() {
    info.hidden = !infoOpen;
    overlay.classList.toggle('info-open', infoOpen);
    if (!infoOpen) return;
    const n = cur();
    const m = n.meta || {};
    const ex = m.exif || {};
    const rows = [];
    const add = (label, value) => { if (value !== undefined && value !== null && value !== '') rows.push(el('div.kv', el('dt', label), el('dd', String(value)))); };
    add(t('Name'), displayName(n));
    if (m.takenAt) add(t('Aufgenommen'), takenLabel(m.takenAt));
    add(t('Geändert'), fmtDateTime(dateOf(n)));
    if (ex.make || ex.model) add(t('Kamera'), [ex.make, ex.model && ex.make && ex.model.startsWith(ex.make) ? ex.model.slice(ex.make.length).trim() : ex.model].filter(Boolean).join(' '));
    if (ex.lens) add(t('Objektiv'), ex.lens);
    const shot = [ex.fNumber ? `ƒ/${ex.fNumber}` : null, ex.exposure ? (ex.exposure < 1 ? `1/${Math.round(1 / ex.exposure)} s` : `${ex.exposure} s`) : null, ex.iso ? `ISO ${ex.iso}` : null, ex.focal ? `${ex.focal} mm` : null].filter(Boolean).join(' · ');
    add(t('Aufnahme'), shot);
    if (m.w && m.h) add(t('Abmessungen'), `${m.w} × ${m.h}`);
    if (m.durationMs) add(t('Dauer'), fmtDuration(m.durationMs));
    add(t('Größe'), fmtSize(sizeOf(n)));
    add(t('Typ'), n.rev && n.rev.mime);
    if (m.gps) add(t('Ort (Koordinaten)'), coords(m.gps));
    if (m.description) add(t('Beschreibung'), m.description);
    const path = E.pathOf(n.parent).map(displayName).join(' / ');
    add(t('Ordner'), path || t('Meine Dateien'));
    const inAlbums = [...E.state.albums.values()].filter(a => (E.state.members.get(a.id) || new Set()).has(n.id)).map(a => a.name);
    if (inAlbums.length) add(t('Alben'), inAlbums.join(', '));
    clear(info).append(el('h3', t('Informationen')), el('dl.kvs', rows),
      el('p.muted.small', icon('lock'), t('Diese Angaben sind verschlüsselt gespeichert. Der Ort wird nur als Koordinaten angezeigt – ohne Kartendienst.')),
      el('button.btn.ghost.sm', { type: 'button', onclick: () => showVersions(n) }, icon('history'), t('Versionen')));
  }
  async function more() {
    const n = cur();
    const { actionSheet } = await import('../dom.js');
    const { addToAlbum } = await import('./fotos.js');
    actionSheet({ title: displayName(n), items: [
      { label: t('In FaLe PDF öffnen'), icon: 'pdf', hidden: !isPdfLike(n), run: () => openInPdf(n) },
      { label: t('Zu Album hinzufügen'), icon: 'album', hidden: !['image', 'video'].includes(kindOf(n.name, n.rev && n.rev.mime)), run: () => addToAlbum([n]) },
      { label: t('Versionen'), icon: 'history', run: () => showVersions(n) },
      { label: t('Umbenennen'), icon: 'edit', run: () => renameNode(n).then(() => { title.textContent = displayName(cur()); }) },
      { label: t('Verschieben'), icon: 'move', run: () => moveNodes([n]) },
      { label: E.state.offline.pinned.has(n.id) ? t('Nicht mehr offline verfügbar') : t('Offline verfügbar machen'), icon: 'offline', run: () => togglePin(n) },
      { label: t('Überall löschen'), icon: 'trash', danger: true, hint: t('Papierkorb, 30 Tage'), run: async () => { if (await trashNodes([n], { ask: true })) { items.splice(idx, 1); if (!items.length) close(); else { idx = Math.min(idx, items.length - 1); show(); } } } },
    ] });
  }
  // swipe between items (when not zoomed)
  let sx = 0, sy = 0, swiping = false;
  stage.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' || stage.dataset.zoomed === '1') return; sx = e.clientX; sy = e.clientY; swiping = true; });
  stage.addEventListener('pointerup', e => {
    if (!swiping) return; swiping = false;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
    else if (dy > 120 && Math.abs(dy) > Math.abs(dx) * 1.5) close();
  });
  stage.addEventListener('pointercancel', () => { swiping = false; });

  /** Pinch / wheel / double-tap zoom + pan for one image. */
  function attachZoom(img) {
    let scale = 1, tx = 0, ty = 0;
    const pts = new Map();
    let startDist = 0, startScale = 1, last = null, lastTap = 0;
    const apply = () => { img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`; stage.dataset.zoomed = scale > 1.01 ? '1' : '0'; };
    const reset = () => { scale = 1; tx = ty = 0; apply(); };
    img.addEventListener('pointerdown', e => {
      img.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) { const [a, b] = [...pts.values()]; startDist = Math.hypot(a.x - b.x, a.y - b.y); startScale = scale; }
      last = { x: e.clientX, y: e.clientY };
      const now = Date.now();
      if (e.pointerType !== 'mouse' && now - lastTap < 300) { if (scale > 1) reset(); else { scale = 2.5; apply(); } }
      lastTap = now;
    });
    img.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) { const [a, b] = [...pts.values()]; scale = Math.max(1, Math.min(8, startScale * Math.hypot(a.x - b.x, a.y - b.y) / (startDist || 1))); apply(); }
      else if (scale > 1 && last) { tx += e.clientX - last.x; ty += e.clientY - last.y; apply(); }
      last = { x: e.clientX, y: e.clientY };
    });
    const up = e => { pts.delete(e.pointerId); if (scale <= 1.01) reset(); };
    img.addEventListener('pointerup', up); img.addEventListener('pointercancel', up);
    img.addEventListener('dblclick', () => { if (scale > 1) reset(); else { scale = 2.5; apply(); } });
    img.addEventListener('wheel', e => { if (!e.ctrlKey && Math.abs(e.deltaY) < 30) return; e.preventDefault(); scale = Math.max(1, Math.min(8, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); if (scale === 1) { tx = ty = 0; } apply(); }, { passive: false });
    apply();
  }
  show();
}
function takenLabel(s) {
  if (/Z$/.test(s)) return fmtDateTime(new Date(s));
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
  if (!m) return s;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const off = /([+-]\d\d:\d\d|Z)$/.exec(s);
  return fmtDateTime(d) + (off ? ` (UTC${off[1] === 'Z' ? '' : off[1]})` : '');
}
function coords(g) {
  const lat = Math.abs(g.lat).toFixed(5) + '° ' + (g.lat >= 0 ? 'N' : 'S');
  const lon = Math.abs(g.lon).toFixed(5) + '° ' + (g.lon >= 0 ? 'E' : 'W');
  return `${lat}, ${lon}` + (typeof g.alt === 'number' ? ` · ${Math.round(g.alt)} m` : '');
}
