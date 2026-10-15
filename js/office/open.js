// Routing glue for office screens: #/bearbeiten/<id>, #/neu/<art>, #/vorlagen.
import * as db from '../db.js';
import { openScreen, currentScreen } from '../screen.js';
import { $, $$, h, esc, toast, errorToast, openDialog, downloadBlob, shareBlob } from '../ui.js';
import { oicon, KINDS, kindTile } from './kinds.js';
import { DOC_TEMPLATES, SHEET_TEMPLATES, SLIDE_THEMES } from './templates.js';
import { handoff } from '../tools/index.js';
import { deleteFileConfirm } from './filerow.js';

/** Ask before leaving an editor with unsaved changes. Resolves true when leaving is fine. */
export async function confirmLeave(screen) {
  if (!screen || !screen.isDirty || !screen.isDirty()) return true;
  const r = await openDialog({
    title: 'Änderungen speichern?',
    body: '<p>Du hast Änderungen, die noch nicht gespeichert sind.</p>',
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Verwerfen', value: 'discard', kind: 'btn-danger-ghost' }, { label: 'Speichern', value: 'save', kind: 'btn-primary', default: true }],
  });
  if (r.value === 'discard') return true;
  if (r.value === 'save') {
    const btn = screen.head.querySelector('[data-office-save]');
    if (btn) { btn.click(); await new Promise(res => { const t = setInterval(() => { if (!screen.isDirty()) { clearInterval(t); res(); } }, 100); setTimeout(() => { clearInterval(t); res(); }, 15000); }); }
    return !screen.isDirty();
  }
  return false;
}

export async function openOfficeRoute(parts, params, { goBack }) {
  const top = parts[0];
  const onBack = async () => { const s = currentScreen(); if (await confirmLeave(s)) { if (s) s.isDirty = () => false; goBack(); } };
  if (top === 'vorlagen' && parts[1] === 'tabelle') return sheetTemplatesScreen(onBack);
  if (top === 'vorlagen') return templatesScreen(onBack, params.get('art'));
  let mount, opts = {}, title = '';
  if (top === 'bearbeiten') {
    const meta = await db.getDoc(parts[1]);
    if (!meta) { toast('Datei nicht gefunden.', 'error'); location.replace('#/dateien'); return; }
    const kind = meta.kind || 'pdf';
    if (kind === 'pdf') { location.replace(`#/ansicht/${meta.id}`); return; }
    title = meta.name;
    opts = { id: meta.id };
    if (kind === 'image') return imageScreen(meta, onBack);
    mount = KINDS[kind].cat === 'doc' ? 'writer' : KINDS[kind].cat === 'sheet' ? 'sheet' : 'slides';
  } else if (top === 'neu') {
    const art = parts[1] || 'dokument';
    mount = art === 'tabelle' ? 'sheet' : art === 'praesentation' ? 'slides' : 'writer';
    opts = { template: params.get('vorlage') || params.get('design') || (params.get('gliederung') ? '__outline' : null) };
    title = mount === 'sheet' ? 'Neue Tabelle' : mount === 'slides' ? 'Neue Präsentation' : 'Neues Dokument';
  } else return;
  const screen = openScreen({ title, sub: '', onBack });
  screen.root.classList.add('office-screen', `office-${mount}`);
  screen._query = params.get('q');
  screen.body.innerHTML = '<div class="v-loading"><div><span class="spinner dark" style="width:30px;height:30px"></span><span>Wird geöffnet …</span></div></div>';
  try {
    const mod = mount === 'writer' ? await import('./writer.js') : mount === 'sheet' ? await import('./sheet.js') : await import('./slides.js');
    if (screen.signal.aborted) return;
    const fn = mount === 'writer' ? mod.mountWriter : mount === 'sheet' ? mod.mountSheet : mod.mountSlides;
    const cleanup = await fn(screen, opts);
    if (typeof cleanup === 'function') screen.cleanup = cleanup;
  } catch (e) {
    if (screen.signal.aborted) return;
    errorToast(e, 'Die Datei konnte nicht geöffnet werden.');
    screen.body.innerHTML = `<div class="screen-inner"><div class="empty"><div class="empty-art">${oicon('info')}</div><h3>Das hat nicht geklappt</h3><p>${esc(e && e.userMessage ? e.userMessage : 'Die Datei ist beschädigt oder wird nicht unterstützt.')}</p><a class="btn btn-primary" href="#/dateien">Zu den Dateien</a></div></div>`;
  }
}

// ---------------- image viewer ----------------
async function imageScreen(meta, onBack) {
  const screen = openScreen({ title: meta.name, sub: 'Bild', onBack });
  const blob = await db.getFile(meta.id);
  if (!blob) { screen.body.innerHTML = '<p class="panel-empty">Bild nicht gefunden.</p>'; return; }
  db.updateDoc(meta.id, { openedAt: Date.now() }).catch(() => {});
  const url = URL.createObjectURL(blob);
  screen.body.classList.add('image-view');
  screen.body.innerHTML = `<div class="img-stage"><img src="${url}" alt="${esc(meta.name)}"></div>`;
  const img = $('img', screen.body);
  img.addEventListener('click', () => img.classList.toggle('zoom'));
  const mk = (label, icon, fn, kind = 'btn-ghost') => { const b = h(`<button class="btn ${kind}" type="button">${oicon(icon)}<span>${label}</span></button>`); b.addEventListener('click', fn); return b; };
  screen.setFoot([
    mk('Löschen', 'trash', async () => { if (await deleteFileConfirm(meta)) history.back(); }, 'btn-danger-ghost'),
    mk('Teilen', 'share', () => shareBlob(blob, meta.name, blob.type || 'image/jpeg')),
    mk('Herunterladen', 'download', () => downloadBlob(blob, meta.name)),
    mk('In PDF umwandeln', 'kpdf', () => { handoff.images.push(new File([blob], meta.name, { type: blob.type || 'image/jpeg' })); location.hash = '#/werkzeug/bilder'; }, 'btn-primary'),
  ]);
  screen.cleanup = () => URL.revokeObjectURL(url);
}

// ---------------- templates ----------------
function templatesScreen(onBack, art) {
  const screen = openScreen({ title: 'Vorlagen', sub: 'Eigene Designs – kostenlos und ohne Konto', onBack });
  const card = (href, tile, title, desc, preview = '') => `<a class="tpl-card" href="${href}">${preview || `<span class="tpl-prev">${tile}</span>`}<span class="tpl-txt"><strong>${esc(title)}</strong><span>${esc(desc)}</span></span></a>`;
  const docPrev = t => `<span class="tpl-prev tpl-doc tpl-${t.id}" aria-hidden="true"><span class="tl t1"></span><span class="tl"></span><span class="tl s"></span><span class="tl"></span><span class="tl s"></span><span class="tl"></span></span>`;
  const slidePrev = t => `<span class="tpl-prev tpl-slide" aria-hidden="true" style="background:${t.bg}"><span class="ts-bar" style="background:${t.accent}"></span><span class="ts-t" style="background:${t.title}"></span><span class="ts-s" style="background:${t.text}"></span></span>`;
  const sections = [
    ['doc', 'Dokumente', DOC_TEMPLATES.map(t => card(`#/neu/dokument?vorlage=${t.id}`, kindTile('docx'), t.title, t.desc, docPrev(t)))],
    ['sheet', 'Tabellen', SHEET_TEMPLATES.map(t => card(`#/neu/tabelle?vorlage=${t.id}`, kindTile('xlsx'), t.title, t.desc, `<span class="tpl-prev tpl-grid" aria-hidden="true"></span>`))],
    ['slides', 'Präsentationen', SLIDE_THEMES.map(t => card(`#/neu/praesentation?design=${t.id}`, kindTile('pptx'), `Design „${t.name}“`, 'Titel- und Inhaltsfolie, frei erweiterbar', slidePrev(t)))],
  ];
  const order = art ? [...sections.filter(s => s[0] === art), ...sections.filter(s => s[0] !== art)] : sections;
  screen.body.innerHTML = `<div class="screen-inner">${order.map(([id, title, cards]) => `<h2 class="section-title" id="tpl-${id}">${title}</h2><div class="tpl-grid">${cards.join('')}</div>`).join('')}</div>`;
  void $$;
}

// ---------------- spreadsheet start screen: blank workbook or a template ----------------
async function sheetTemplatesScreen(onBack) {
  const screen = openScreen({ title: 'Neue Tabelle', sub: 'Leer beginnen oder eine Vorlage wählen', onBack });
  const T = await import('./sheet-templates.js');
  const cats = T.SHEET_TEMPLATE_CATS;
  screen.body.innerHTML = `<div class="screen-inner stp">
    <div class="stp-bar"><input class="input" type="search" data-q placeholder="Vorlage suchen, z. B. Budget, Urlaub, Rechnung …" aria-label="Vorlagen durchsuchen">
      <div class="chips stp-cats" role="tablist" aria-label="Kategorien">${cats.map((c, i) => `<button type="button" class="chip" role="tab" data-cat="${esc(c)}" aria-selected="${i === 0}">${esc(c)}</button>`).join('')}</div></div>
    <div class="stp-grid">${T.SHEET_TEMPLATE_LIST.map(t => `<div class="stp-card" data-id="${esc(t.id)}">
      <a class="stp-open" href="#/neu/tabelle?vorlage=${encodeURIComponent(t.id)}" aria-label="${esc(t.title)} öffnen"><span class="stp-prev stp-${esc(t.accent)}" data-no-i18n aria-hidden="true">${t.id === 'leer' ? emptyGrid() : '<span class="stp-load"></span>'}</span>
        <span class="tpl-txt"><strong>${esc(t.title)}</strong><span>${esc(t.desc)}</span></span></a>
      ${t.id === 'leer' ? '' : `<button class="icon-btn stp-dl" type="button" data-dl="${esc(t.id)}" aria-label="${esc(t.title)} als .xlsx-Datei herunterladen" title="Als .xlsx-Datei herunterladen">${oicon('download')}</button>`}
    </div>`).join('')}</div>
    <p class="muted small stp-note">Alle Vorlagen sind eigene Entwürfe mit fertigen Formeln, Dropdown-Listen und bedingter Formatierung. Gelbe Felder sind Eingaben.</p>
  </div>`;
  const q = $('[data-q]', screen.body);
  let cat = cats[0];
  const filter = () => {
    const term = q.value.trim().toLocaleLowerCase('de');
    for (const card of $$('.stp-card', screen.body)) {
      const t = T.SHEET_TEMPLATE_LIST.find(x => x.id === card.dataset.id);
      const hay = `${t.title} ${t.desc} ${t.keywords || ''} ${t.cat}`.toLocaleLowerCase('de');
      card.hidden = !((cat === cats[0] || t.cat === cat || t.id === 'leer') && (!term || hay.includes(term)));
    }
  };
  q.addEventListener('input', filter);
  const catBtns = $$('.stp-cats [data-cat]', screen.body);
  catBtns.forEach(b => b.addEventListener('click', () => { cat = b.dataset.cat; catBtns.forEach(x => x.setAttribute('aria-selected', String(x === b))); filter(); }));
  screen.body.addEventListener('click', async e => {
    const b = e.target.closest('[data-dl]');
    if (!b) return;
    try {
      const wb = await builtTemplate(b.dataset.dl);
      const { writeXlsx } = await import('./xlsx-write.js');
      const t = T.SHEET_TEMPLATE_LIST.find(x => x.id === b.dataset.dl);
      downloadBlob(await writeXlsx(wb, { title: t.title }), `${t.title.replace(/[\\/:*?"<>|]+/g, '-')}.xlsx`);
    } catch (err) { errorToast(err, 'Die Vorlage konnte nicht erstellt werden.'); }
  });
  // live previews: build each template (with calculated values) one after another
  const cache = new Map();
  async function builtTemplate(id) {
    if (cache.has(id)) return cache.get(id);
    const [{ recalc, ensureSheetModel }, { ensureSheetExtras }] = await Promise.all([import('./workbook.js'), import('./sheetfx.js')]);
    const wb = T.buildSheetTemplate(id);
    wb.sheets.forEach(s => { ensureSheetExtras(s); ensureSheetModel(s); });
    recalc(wb);
    cache.set(id, wb);
    return wb;
  }
  const { displayOf, KEY } = await import('./workbook.js');
  for (const t of T.SHEET_TEMPLATE_LIST) {
    if (t.id === 'leer' || screen.signal.aborted) continue;
    await new Promise(r => setTimeout(r, 0));
    try {
      const wb = await builtTemplate(t.id);
      const sh = wb.sheets[0];
      const rows = [];
      let r0 = 0;
      for (let r = 0; r <= Math.min(sh.maxR, 40) && rows.length < 9; r++) {
        if (r === 1) continue; // hint line
        const row = [];
        for (let c = 0; c < 5; c++) { const cell = sh.cells.get(KEY(r, c)); row.push({ t: cell ? displayOf(cell) : '', s: (cell && cell.s) || {} }); }
        if (!rows.length) r0 = r;
        rows.push(row);
      }
      void r0;
      const el = $(`.stp-card[data-id="${t.id}"] .stp-prev`, screen.body);
      if (el) el.innerHTML = `<table>${rows.map((row, i) => `<tr>${row.map((x, c) => (i === 0 ? (c === 0 ? `<td colspan="5" class="stp-title">${esc(x.t)}</td>` : '') : `<td class="${x.s.fill && x.s.b ? 'h' : x.s.fill ? 'in' : ''}${typeof x.t === 'string' && /^-?[\d.,]+( €| %| km)?$/.test(x.t) ? ' n' : ''}${x.s.b ? ' b' : ''}">${esc(x.t)}</td>`)).join('')}</tr>`).join('')}</table>`;
    } catch (e) { console.warn('Vorschau übersprungen', t.id, e); }
  }
}
function emptyGrid() { return `<table>${Array.from({ length: 8 }, () => `<tr>${'<td></td>'.repeat(5)}</tr>`).join('')}</table>`; }
