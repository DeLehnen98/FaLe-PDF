// Tool: Stapelverarbeitung — run a recipe of steps over many PDFs (or images).
// Steps (any combination, always in a fixed order): remove pages, rotate, watermark, page numbers, compress,
// remove hidden data, password. Result: one PDF per file (name pattern {name}/{nr}/{datum}), all merged into one
// PDF (steps that work on the whole document run after merging, so page numbers continue), or page images (ZIP).
// One failing or locked file never stops the batch – it is skipped and listed in Bericht.txt. Protected inputs
// are opened with one optional password asked up front (no password dialogs in the middle of a run). The run can
// be cancelled, the screen is kept awake while it runs, and the last recipe is remembered (never passwords).
// Originals are never changed. Reuses the pure functions of the single-file tools.
import * as db from '../db.js';
import { icon } from '../icons.js';
import { h, esc, toast, errorToast, pickFiles, formatSize, baseName, safeFileName } from '../ui.js';
import { pickDocsDialog, resultCard, enableDragReorder, moveItem } from '../components.js';
import { getDocBytes, saveResult } from '../library.js';
import { createZip } from '../zip.js';
import { hasEncryptKey, loadProtected, loadPdfLib } from '../pdflib.js';
import { knownPassword, rememberBytesPassword } from '../pdfcore.js';
import { ensureCss, fileResultCard, proBadge, updateFoot, tick, swatches } from './common.js';

export const STEPS = [
  { id: 'del', label: 'Seiten entfernen', icon: 'trash', desc: 'z. B. Deckblatt', suffix: 'gekürzt' },
  { id: 'rotate', label: 'Seiten drehen', icon: 'rotate', desc: '90° oder 180°', suffix: 'gedreht' },
  { id: 'watermark', label: 'Wasserzeichen', icon: 'watermark', desc: 'Text auf jede Seite', suffix: 'Wasserzeichen' },
  { id: 'numbers', label: 'Seitenzahlen', icon: 'hash', desc: '„Seite 1 von N“', suffix: 'nummeriert' },
  { id: 'compress', label: 'Komprimieren', icon: 'compress', desc: 'Dateien verkleinern', suffix: 'komprimiert' },
  { id: 'strip', label: 'Daten entfernen', icon: 'shield', desc: 'Autor, Programm, Datum', suffix: 'bereinigt' },
  { id: 'protect', label: 'Passwort setzen', icon: 'lock', desc: 'AES-256 verschlüsseln', suffix: 'geschützt' },
];
const OUTPUTS = [
  { id: 'files', label: 'Einzelne PDFs', icon: 'file' },
  { id: 'merge', label: 'Eine PDF', icon: 'merge' },
  { id: 'images', label: 'Bilder (ZIP)', icon: 'image' },
];
export const PRESETS = [
  { id: 'email', label: 'Für E-Mail', steps: ['compress', 'strip'] },
  { id: 'secret', label: 'Vertraulich senden', steps: ['compress', 'strip', 'protect'] },
  { id: 'draft', label: 'Als Entwurf markieren', steps: ['watermark', 'numbers'], text: 'ENTWURF' },
];
// steps that work on the whole merged document (page numbers continue, one password for the result)
const AFTER_MERGE = new Set(['watermark', 'numbers', 'compress', 'strip', 'protect']);
const WM_COLORS = [{ c: '#9AA0B4', n: 'Grau' }, { c: '#E03131', n: 'Rot' }, { c: '#1C64F2', n: 'Blau' }, { c: '#1F2340', n: 'Schwarz' }];
const STORE = 'fale-batch';
const isImage = f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name);
const isPdf = f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const stepById = id => STEPS.find(s => s.id === id);

/** Pages (1-based) to remove from a document with `count` pages: "1, 3-4, letzte"; numbers beyond the end are ignored. */
export function pagesToRemove(text, count) {
  const out = new Set();
  for (const raw of String(text || '').split(/[,;]+/)) {
    const p = raw.trim().toLowerCase().replace(/[–—]/g, '-');
    if (!p) continue;
    let m;
    // "last page" in every UI language (translations may tell users to type their own word)
    if (/^(letzte|last|ende|end|dernière|derniere|fin|última|ultima|último|ultimo|laatste|ostatnia|son|остання|последняя|最后|最後|最终|마지막|अंतिम|आखिरी|terakhir)$/u.test(p)) out.add(count);
    else if ((m = /^(\d*)\s*-\s*(\d*)$/.exec(p)) && (m[1] || m[2])) {
      const a = m[1] ? +m[1] : 1, b = m[2] ? +m[2] : count;
      for (let i = Math.min(a, b); i <= Math.min(Math.max(a, b), count); i++) if (i >= 1) out.add(i);
    } else if (/^\d+$/.test(p)) { if (+p >= 1 && +p <= count) out.add(+p); }
    else return null;
  }
  return [...out].sort((a, b) => a - b);
}

/** Output name from a pattern: {name} original name, {nr} running number, {datum} today. */
export function patternName(pattern, name, nr, total, date = new Date()) {
  const base = baseName(String(name || 'Dokument').replace(/\.[^.]+$/, ''));
  const pad = String(nr).padStart(Math.max(2, String(total).length), '0');
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  let out = String(pattern || '').trim() || '{name}';
  if (!/\{(name|nr)\}/i.test(out)) out += ' {nr}';   // otherwise every file would get the same name
  out = out.replace(/\{name\}/gi, base).replace(/\{nr\}/gi, pad).replace(/\{(datum|date)\}/gi, iso);
  return safeFileName(out.replace(/\.pdf$/i, '').trim() || base) + '.pdf';
}

function loadSaved() { try { return JSON.parse(localStorage.getItem(STORE) || 'null') || {}; } catch { return {}; } }

export async function mount(screen) {
  await ensureCss();
  screen.setTitle('Stapelverarbeitung', 'Viele Dateien in einem Rutsch');
  const saved = loadSaved();
  let items = []; // {id, kind:'doc'|'file', doc?, file?, name, size, image, enc, status, msg, p}
  let steps = new Set(Array.isArray(saved.steps) ? saved.steps.filter(stepById) : ['compress']);
  let out = OUTPUTS.some(o => o.id === saved.out) ? saved.out : 'files';
  let running = false, cancelled = false, alive = true, seq = 0;
  let wmColor = saved.wmColor || '#9AA0B4';
  const val = saved.v || {};

  const wrap = h(`<div class="screen-inner bt">
    <div class="card intro"><span class="tile-ic">${icon('layers')}</span><div><strong>Viele Dateien auf einmal</strong>
      <p>Wähle PDFs (oder Bilder) und was mit allen passieren soll – FaLe PDF erledigt alles nacheinander auf deinem Gerät. Die Originale bleiben unverändert. ${proBadge()}</p></div></div>
    <h2 class="section-title">1. Dateien</h2>
    <div class="toolbar"><button class="btn btn-soft" type="button" data-lib>${icon('folder')} Aus Bibliothek</button>
      <button class="btn btn-soft" type="button" data-dev>${icon('open')} Vom Gerät</button><span class="grow"></span><span class="muted small" data-sum></span></div>
    <div class="order-list" data-list></div>
    <h2 class="section-title">2. Was soll passieren? <span class="muted small">mehrere möglich</span></h2>
    <div class="bt-presets" role="group" aria-label="Vorlagen">${PRESETS.map(p => `<button type="button" class="bt-preset" data-preset="${p.id}">${esc(p.label)}</button>`).join('')}</div>
    <div class="bt-actions" role="group" aria-label="Schritte">${STEPS.map(a => `<button type="button" class="bt-action" data-action="${a.id}" aria-pressed="false">${icon(a.icon)}<strong>${a.label}</strong><span>${a.desc}</span></button>`).join('')}</div>
    <p class="hint bt-flow" data-flow></p>
    <form class="card card-pad bt-opts" data-opts novalidate></form>
    <h2 class="section-title">3. Ergebnis</h2>
    <div class="seg pt-seg-full bt-out" role="group" aria-label="Ergebnis">${OUTPUTS.map(o => `<button type="button" data-out="${o.id}" aria-pressed="false">${icon(o.icon)} ${o.label}</button>`).join('')}</div>
    <form class="card card-pad bt-opts" data-outopts novalidate></form>
    <label class="check"><input type="checkbox" data-save ${saved.save === false ? '' : 'checked'}><span>Ergebnisse zusätzlich in „Dateien“ speichern</span></label>
    <div data-result></div></div>`);
  screen.body.appendChild(wrap);
  const listEl = wrap.querySelector('[data-list]');
  const opts = wrap.querySelector('[data-opts]');
  const outOpts = wrap.querySelector('[data-outopts]');
  const resultBox = wrap.querySelector('[data-result]');
  const runBtn = h(`<button class="btn btn-primary" type="button">${icon('layers')} Starten</button>`);
  const stopBtn = h(`<button class="btn btn-soft" type="button">${icon('close')} Abbrechen</button>`);
  opts.addEventListener('submit', e => e.preventDefault());
  outOpts.addEventListener('submit', e => e.preventDefault());

  // ---------- files ----------
  async function markEncrypted(it) {
    try {
      const bytes = it.kind === 'doc' ? await getDocBytes(it.doc.id) : (it.image ? null : new Uint8Array(await it.file.arrayBuffer()));
      it.enc = !!bytes && hasEncryptKey(bytes) && !(it.doc && knownPassword(it.doc.id));
    } catch { it.enc = false; }
  }
  async function addItems(list) {
    items.push(...list);
    render();
    for (const it of list) await markEncrypted(it);
    renderOpts();
    render();
  }
  function addFiles(files) {
    const ok = files.filter(f => isPdf(f) || isImage(f));
    if (ok.length < files.length) toast(`${files.length - ok.length} Datei${files.length - ok.length === 1 ? '' : 'en'} übersprungen – nur PDFs und Bilder können verarbeitet werden.`, 'info');
    addItems(ok.map(f => ({ id: ++seq, kind: 'file', file: f, name: f.name, size: f.size, image: isImage(f), status: 'wait' })));
  }
  wrap.querySelector('[data-lib]').addEventListener('click', async () => {
    const ids = await pickDocsDialog({ multi: true, title: 'Dateien wählen', exclude: items.filter(i => i.doc).map(i => i.doc.id) });
    if (!ids) return;
    const list = [];
    for (const id of ids) { const d = await db.getDoc(id); if (d) list.push({ id: ++seq, kind: 'doc', doc: d, name: d.name, size: d.size, image: false, status: 'wait' }); }
    addItems(list);
  });
  wrap.querySelector('[data-dev]').addEventListener('click', async () => addFiles(await pickFiles({ accept: '.pdf,application/pdf,image/*', multiple: true })));
  screen.onDropFiles = files => { if (!running) addFiles(files); };

  const STATUS = { wait: '', run: 'Läuft …', done: 'Fertig', error: 'Fehler', skip: 'Übersprungen' };
  const metaHtml = it => `${formatSize(it.size)}${it.enc && it.status === 'wait' ? ` · ${icon('lock')} geschützt` : ''}${it.status !== 'wait' ? ` · <b class="bt-st bt-${it.status}">${esc(it.msg || STATUS[it.status])}</b>` : ''}`;
  function render() {
    listEl.innerHTML = '';
    if (!items.length) listEl.appendChild(h(`<div class="empty"><div class="empty-art">${icon('layers')}</div><h3>Noch keine Dateien</h3><p>Füge PDFs oder Bilder hinzu – auch per Ziehen &amp; Ablegen.</p></div>`));
    items.forEach((it, i) => {
      const row = h(`<div class="order-item bt-item" draggable="${!running}" data-i="${i}">
        <span class="order-num">${i + 1}</span><span class="tile-ic bt-ic">${icon(it.image ? 'image' : 'file')}</span>
        <span class="doc-info"><span class="doc-name">${esc(it.name)}</span><span class="doc-meta">${metaHtml(it)}</span></span>
        <button class="icon-btn" type="button" data-up aria-label="Nach oben" ${i === 0 || running ? 'disabled' : ''}>${icon('arrowUp')}</button>
        <button class="icon-btn" type="button" data-down aria-label="Nach unten" ${i === items.length - 1 || running ? 'disabled' : ''}>${icon('arrowDown')}</button>
        <button class="icon-btn" type="button" data-x aria-label="Entfernen" ${running ? 'disabled' : ''}>${icon('close')}</button></div>`);
      row.querySelector('[data-up]').addEventListener('click', () => { moveItem(items, i, i - 1); render(); });
      row.querySelector('[data-down]').addEventListener('click', () => { moveItem(items, i, i + 1); render(); });
      row.querySelector('[data-x]').addEventListener('click', () => { items.splice(i, 1); render(); renderOpts(); });
      it.row = row;
      updateRow(it);
      listEl.appendChild(row);
    });
    const total = items.reduce((s, x) => s + (x.size || 0), 0);
    wrap.querySelector('[data-sum]').textContent = items.length ? `${items.length} Datei${items.length === 1 ? '' : 'en'} · ${formatSize(total)}` : '';
    refresh();
  }
  enableDragReorder(listEl, '.bt-item', (from, to) => { if (!running) { moveItem(items, from, to); render(); } });
  function updateRow(it) {
    if (!it.row) return;
    const meta = it.row.querySelector('.doc-meta');
    meta.innerHTML = metaHtml(it);
    let bar = it.row.querySelector('.bt-bar');
    if (it.status === 'run') {
      if (!bar) { bar = h('<span class="bt-bar"><span></span></span>'); meta.after(bar); }
      bar.firstElementChild.style.width = `${Math.round((it.p || 0) * 100)}%`;
    } else if (bar) bar.remove();
  }

  // ---------- steps + options ----------
  const secret = { pw1: '', pw2: '', srcpw: '' };   // passwords: kept across re-renders, never stored
  function stash() {
    for (const f of [...opts.elements, ...outOpts.elements]) {
      if (f.name in secret) { secret[f.name] = f.value; continue; }
      if (!f.name || f.type === 'password' || f.name === 'username') continue;
      val[f.name] = f.type === 'checkbox' ? f.checked : f.value;
    }
    try { localStorage.setItem(STORE, JSON.stringify({ steps: [...steps], out, wmColor, v: val, save: wrap.querySelector('[data-save]').checked })); } catch { /* private mode */ }
  }
  const sel = (name, list, cur) => `<select class="select" name="${name}">${list.map(([x, l]) => `<option value="${x}" ${String(cur) === String(x) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const chk = (name, label, on) => `<label class="check"><input type="checkbox" name="${name}" ${on ? 'checked' : ''}><span>${label}</span></label>`;
  function renderOpts() {
    if (opts.elements.length) stash();
    wrap.querySelectorAll('[data-action]').forEach(b => {
      b.setAttribute('aria-pressed', String(steps.has(b.dataset.action)));
      const off = out === 'images' && b.dataset.action === 'protect';
      b.disabled = off;
      b.title = off ? 'Bei Bildern nicht möglich' : '';
    });
    wrap.querySelectorAll('[data-out]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.out === out)));
    const parts = [];
    const S = id => steps.has(id) && !(out === 'images' && id === 'protect');
    if (S('del')) parts.push(`<label class="field"><span class="field-label">Seiten entfernen</span><input class="input" name="del" value="${esc(val.del ?? '1')}" placeholder="z. B. 1 oder letzte oder 1, 3-4" maxlength="80"></label>
      <p class="hint">Gilt für jede Datei. Seiten, die eine kurze Datei nicht hat, werden ignoriert.</p>`);
    if (S('rotate')) parts.push(`<label class="field"><span class="field-label">Drehen um</span>${sel('rot', [['90', '90° nach rechts'], ['180', '180°'], ['270', '90° nach links']], val.rot ?? '90')}</label>`);
    if (S('watermark')) parts.push(`<label class="field"><span class="field-label">Wasserzeichen-Text</span><input class="input" name="text" value="${esc(val.text ?? 'VERTRAULICH')}" maxlength="80"></label>
      <div class="pt-two"><label class="field"><span class="field-label">Schriftgröße</span><input class="input" type="number" name="size" min="12" max="160" value="${esc(val.size ?? 60)}"></label>
      <label class="field"><span class="field-label">Deckkraft (%)</span><input class="input" type="number" name="op" min="5" max="100" value="${esc(val.op ?? 25)}"></label></div>
      <div class="pt-row"><span class="field-label">Farbe</span><span data-colors></span></div>${chk('tile', 'Über die ganze Seite kacheln', val.tile)}`);
    if (S('numbers')) parts.push(`<div class="pt-two"><label class="field"><span class="field-label">Seitenzahl-Format</span>${sel('format', [['n', '1'], ['s', 'Seite 1'], ['sv', 'Seite 1 von N'], ['slash', '1 / N']], val.format ?? 'sv')}</label>
      <label class="field"><span class="field-label">Position</span>${sel('pos', [['b-c', 'Unten Mitte'], ['b-r', 'Unten rechts'], ['b-l', 'Unten links'], ['t-c', 'Oben Mitte'], ['t-r', 'Oben rechts']], val.pos ?? 'b-c')}</label></div>`);
    if (S('compress')) {
      const strong = (val.cm ?? 'lossless') === 'strong';
      parts.push(`<div class="seg pt-seg-full" role="group" aria-label="Komprimierung"><button type="button" data-cm="lossless" aria-pressed="${!strong}">Verlustfrei</button><button type="button" data-cm="strong" aria-pressed="${strong}">Stark (Seiten als Bild)</button></div>
        <div data-strong ${strong ? '' : 'hidden'}><label class="field"><span class="field-label">Bildqualität: <b data-qv>${esc(val.q ?? 60)}</b> %</span><input type="range" name="q" min="25" max="90" step="5" value="${esc(val.q ?? 60)}"></label>
        <label class="field"><span class="field-label">Auflösung</span>${sel('dpi', [['100', '100 dpi'], ['130', '130 dpi'], ['150', '150 dpi']], val.dpi ?? '130')}</label>
        <p class="hint">Achtung: Text wird bei „Stark“ zu Bild.</p></div>`);
    }
    if (S('strip')) parts.push(`<p class="hint">${icon('shield')} Entfernt Autor, Titel, Programm, Erstell- und Änderungsdatum sowie XMP-Metadaten.</p>`);
    if (S('protect')) parts.push(`<input type="text" name="username" autocomplete="username" value="Stapel" hidden>
      <label class="field"><span class="field-label">Passwort für alle Dateien</span><input class="input" type="password" name="pw1" autocomplete="new-password"></label>
      <label class="field"><span class="field-label">Passwort wiederholen</span><input class="input" type="password" name="pw2" autocomplete="new-password"></label>
      ${chk('print', 'Drucken erlauben', val.print ?? true)}${chk('copy', 'Kopieren erlauben', val.copy ?? true)}
      <p class="hint">FaLe PDF speichert das Passwort nicht – merke es dir gut.</p>`);
    const enc = items.filter(i => i.enc).length;
    if (enc) parts.push(`<label class="field"><span class="field-label">${icon('lock')} Passwort der geschützten Dateien (${enc})</span><input class="input" type="password" name="srcpw" autocomplete="current-password" placeholder="optional"></label>
      <p class="hint">Wird für alle geschützten Dateien versucht. Ohne passendes Passwort wird die Datei übersprungen – der Stapel läuft weiter.</p>`);
    opts.innerHTML = parts.join('');
    opts.hidden = !parts.length;
    for (const k of Object.keys(secret)) if (opts.elements[k]) opts.elements[k].value = secret[k];
    const colors = opts.querySelector('[data-colors]');
    if (colors) colors.appendChild(swatches(WM_COLORS, wmColor, c => { wmColor = c; stash(); }));
    opts.querySelectorAll('[data-cm]').forEach(b => b.addEventListener('click', () => {
      opts.querySelectorAll('[data-cm]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      opts.querySelector('[data-strong]').hidden = b.dataset.cm !== 'strong';
      val.cm = b.dataset.cm; stash();
    }));
    if (opts.elements.q) opts.elements.q.addEventListener('input', () => { opts.querySelector('[data-qv]').textContent = opts.elements.q.value; });

    if (out === 'files') outOpts.innerHTML = `<label class="field"><span class="field-label">Dateinamen</span><input class="input" name="pattern" value="${esc(val.pattern ?? '')}" placeholder="automatisch, z. B. {datum} {name}" maxlength="120"></label>
      <p class="hint">{name} = alter Name, {nr} = laufende Nummer, {datum} = heute. Leer = Name mit Zusatz wie „(komprimiert)“.</p>`;
    else if (out === 'merge') outOpts.innerHTML = `<label class="field"><span class="field-label">Name der neuen PDF</span><input class="input" name="mname" value="${esc(val.mname ?? 'Zusammengeführt')}" maxlength="100"></label>
      <label class="field"><span class="field-label">Bilder als Seite</span>${sel('isize', [['a4', 'A4 mit Rand'], ['fit', 'An Bild anpassen']], val.isize ?? 'a4')}</label>
      <p class="hint">Reihenfolge wie in der Liste oben. Wasserzeichen, Seitenzahlen, Komprimieren und Passwort gelten für die fertige PDF – die Seitenzahlen laufen durch.</p>`;
    else outOpts.innerHTML = `<div class="pt-two"><label class="field"><span class="field-label">Format</span>${sel('fmt', [['jpg', 'JPG'], ['png', 'PNG']], val.fmt ?? 'jpg')}</label>
      <label class="field"><span class="field-label">Auflösung</span>${sel('idpi', [['100', '100 dpi'], ['150', '150 dpi'], ['300', '300 dpi']], val.idpi ?? '150')}</label></div>
      <p class="hint">Die Bilder kommen als ZIP – je Datei ein eigener Ordner.</p>`;
    const flow = [...steps].filter(id => !(out === 'images' && id === 'protect')).sort((a, b) => STEPS.findIndex(s => s.id === a) - STEPS.findIndex(s => s.id === b));
    wrap.querySelector('[data-flow]').innerHTML = flow.length ? `<span>Ablauf je Datei:</span> ${flow.map(id => `<span>${esc(stepById(id).label)}</span>`).join(' → ')}` : (out === 'files' ? 'Wähle mindestens einen Schritt.' : '');
    stash();
    refresh();
  }
  wrap.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', () => {
    if (running) return;
    const id = b.dataset.action;
    if (steps.has(id)) steps.delete(id); else steps.add(id);
    renderOpts();
  }));
  wrap.querySelectorAll('[data-out]').forEach(b => b.addEventListener('click', () => { if (!running) { out = b.dataset.out; renderOpts(); } }));
  wrap.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
    if (running) return;
    const p = PRESETS.find(x => x.id === b.dataset.preset);
    stash();
    steps = new Set(p.steps);
    if (p.text) val.text = p.text;
    out = 'files';
    renderOpts();
    toast(`Vorlage „${p.label}“: ${p.steps.map(id => stepById(id).label).join(', ')}`, 'info', { timeout: 2500 });
  }));
  opts.addEventListener('input', () => { stash(); refresh(); });
  outOpts.addEventListener('input', () => { stash(); refresh(); });
  wrap.querySelector('[data-save]').addEventListener('change', stash);

  function refresh() {
    const n = items.length;
    const active = STEPS.map(x => x.id).filter(id => steps.has(id) && !(out === 'images' && id === 'protect'));
    let info = n ? `${n} Datei${n === 1 ? '' : 'en'}${active.length ? ' · ' + active.map(id => stepById(id).label).join(' → ') : ''}` : 'Füge Dateien hinzu';
    let ok = n > 0 && !running && (active.length > 0 || out !== 'files');
    if (out === 'merge' && n < 2) { ok = false; if (n) info = 'Zum Zusammenführen mindestens 2 Dateien'; }
    runBtn.disabled = !ok;
    runBtn.innerHTML = running ? '<span class="spinner"></span> Läuft …' : `${icon('layers')} Starten`;
    updateFoot(screen, running ? [stopBtn, runBtn] : [runBtn], info);
  }
  stopBtn.addEventListener('click', () => { cancelled = true; stopBtn.disabled = true; toast('Wird nach dem aktuellen Schritt angehalten …', 'info'); });

  // ---------- step functions (bytes → bytes) ----------
  async function apply(id, bytes, cfg, note) {
    const PDFLib = await loadPdfLib();
    if (id === 'del' || id === 'rotate' || id === 'strip') {
      const doc = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
      if (id === 'del') {
        const n = doc.getPageCount();
        const drop = pagesToRemove(cfg.del, n);
        if (!drop || !drop.length) { note.push('keine der Seiten vorhanden'); return bytes; }
        if (drop.length >= n) throw Object.assign(new Error('all'), { userMessage: 'Dabei würden alle Seiten entfernt.' });
        for (let k = drop.length - 1; k >= 0; k--) doc.removePage(drop[k] - 1);
        note.push(`${drop.length} Seite${drop.length === 1 ? '' : 'n'} entfernt`);
      } else if (id === 'rotate') {
        for (const p of doc.getPages()) p.setRotation(PDFLib.degrees((((p.getRotation().angle + cfg.rot) % 360) + 360) % 360));
      } else {
        stripData(PDFLib, doc);
      }
      return doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
    }
    if (id === 'watermark' || id === 'numbers') {
      const { stampPdf } = await import('./stamp.js');
      return stampPdf(bytes, id, id === 'watermark' ? cfg.wm : cfg.num, { name: cfg.name });
    }
    if (id === 'compress') {
      const { compressPdf } = await import('./compress.js');
      const res = await compressPdf(bytes, { ...cfg.cmp, name: cfg.name });
      if (res.byteLength >= bytes.byteLength) { note.push('Komprimieren brachte nichts'); return bytes; }
      return res;
    }
    if (id === 'protect') {
      // like saveProtected(), but without writing program name and date back (after "Daten entfernen")
      const doc = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
      try { if (doc.getForm().getFields().length) doc.getForm().updateFieldAppearances(); } catch { /* no form */ }
      const { encryptDocument } = await import('../pdfcrypt.js');
      await encryptDocument(PDFLib, doc, { ...cfg.pw, objectStreams: true });
      const res = await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
      rememberBytesPassword(res, cfg.pw.userPassword);
      return res;
    }
    return bytes;
  }

  async function inputBytes(it, cfg) {
    if (it.image) {
      const { imagesToPdf } = await import('./images.js');
      const r = await imagesToPdf([it.file], { pageSize: cfg.isize || 'a4', title: baseName(it.name.replace(/\.[^.]+$/, '')) });
      return r.bytes;
    }
    const bytes = it.kind === 'doc' ? await getDocBytes(it.doc.id) : new Uint8Array(await it.file.arrayBuffer());
    if (!hasEncryptKey(bytes)) return bytes;
    // protected: open with the known/batch password, never with a dialog in the middle of the run
    let doc;
    try { doc = await loadProtected(bytes, it.name, { key: it.doc?.id || null, prompt: false, passwords: cfg.srcpw ? [cfg.srcpw] : [] }); }
    catch { throw Object.assign(new Error('locked'), { userMessage: 'Geschützt – Passwort fehlt oder ist falsch', skip: true }); }
    return doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
  }

  // ---------- run ----------
  function collect() {
    const f = opts.elements;
    const cfg = { srcpw: f.srcpw?.value || '' };
    const active = STEPS.map(s => s.id).filter(id => steps.has(id) && !(out === 'images' && id === 'protect'));
    if (active.includes('del')) {
      cfg.del = f.del.value;
      if (pagesToRemove(cfg.del, 9999) == null || !cfg.del.trim()) { toast('Gib die Seiten wie 1, 3-4 oder „letzte“ an.', 'error'); f.del.focus(); return null; }
    }
    if (active.includes('rotate')) cfg.rot = +f.rot.value || 90;
    if (active.includes('watermark')) {
      if (!f.text.value.trim()) { toast('Bitte gib einen Wasserzeichen-Text ein.', 'error'); f.text.focus(); return null; }
      cfg.wm = { kind: 'text', text: f.text.value.trim(), size: Math.max(12, Math.min(160, +f.size.value || 60)), opacity: Math.max(5, Math.min(100, +f.op.value || 25)), color: wmColor, bold: true, rotation: 45, position: f.tile.checked ? 'tile' : 'm-c', range: '' };
    }
    if (active.includes('numbers')) cfg.num = { format: f.format.value, position: f.pos.value, range: '', start: 1 };
    if (active.includes('compress')) {
      const strong = opts.querySelector('[data-cm="strong"]').getAttribute('aria-pressed') === 'true';
      cfg.cmp = { mode: strong ? 'strong' : 'lossless', quality: +f.q.value / 100, dpi: +f.dpi.value };
    }
    if (active.includes('protect')) {
      const a = f.pw1.value, b = f.pw2.value;
      if (a.length < 4) { toast('Das Passwort sollte mindestens 4 Zeichen haben.', 'error'); f.pw1.focus(); return null; }
      if (a !== b) { toast('Die Passwörter stimmen nicht überein.', 'error'); f.pw2.focus(); return null; }
      cfg.pw = { userPassword: a, permissions: { printing: f.print.checked, copying: f.copy.checked, editing: true } };
    }
    const o = outOpts.elements;
    if (out === 'files') cfg.pattern = o.pattern.value;
    if (out === 'merge') { cfg.mname = safeFileName(o.mname.value.trim() || 'Zusammengeführt'); cfg.isize = o.isize.value; }
    if (out === 'images') { cfg.fmt = o.fmt.value; cfg.idpi = +o.idpi.value; }
    cfg.steps = active;
    return cfg;
  }

  runBtn.addEventListener('click', async () => {
    if (running || !items.length) return;
    const cfg = collect();
    if (!cfg) return;
    stash();
    const saveToLib = wrap.querySelector('[data-save]').checked;
    running = true; cancelled = false; stopBtn.disabled = false;
    items.forEach(it => { it.status = 'wait'; it.msg = ''; it.p = 0; });
    render();
    resultBox.innerHTML = '';
    let lock = null;
    try { lock = await navigator.wakeLock?.request('screen'); } catch { /* not allowed – fine */ }
    const zipFiles = [], log = [], usedNames = new Set();
    const uniq = n => { let x = n, k = 2; while (usedNames.has(x.toLowerCase())) { x = n.replace(/(\.[^.]+)?$/, ` (${k++})$1`); } usedNames.add(x.toLowerCase()); return x; };
    const started = Date.now(), date = new Date();
    const perFile = out === 'merge' ? cfg.steps.filter(id => !AFTER_MERGE.has(id)) : cfg.steps;
    const after = out === 'merge' ? cfg.steps.filter(id => AFTER_MERGE.has(id)) : [];
    const merged = [];
    let okCount = 0;
    try {
      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx];
        if (!alive) return;
        if (cancelled) { it.status = 'skip'; it.msg = 'Abgebrochen'; updateRow(it); continue; }
        it.status = 'run'; it.p = 0.05; updateRow(it);
        const note = [];
        try {
          let bytes = await inputBytes(it, cfg);
          const before = it.image ? bytes.byteLength : (it.size || bytes.byteLength);
          for (let k = 0; k < perFile.length; k++) {
            if (cancelled) throw Object.assign(new Error('cancel'), { userMessage: 'Abgebrochen', skip: true });
            it.p = 0.1 + 0.8 * (k / Math.max(1, perFile.length)); updateRow(it);
            bytes = await apply(perFile[k], bytes, { ...cfg, name: it.name }, note);
            await tick();
          }
          if (out === 'merge') {
            merged.push({ bytes, name: it.name, key: null });
            it.msg = note.join(' · ') || 'Bereit';
          } else if (out === 'images') {
            const { pdfToImages } = await import('./export.js');
            const files = await pdfToImages(bytes, { fmt: cfg.fmt, dpi: cfg.idpi, name: it.name, onProgress: (a, b) => { if (typeof a === 'number' && b) { it.p = 0.5 + 0.45 * (a / b); updateRow(it); } } });
            const folder = uniq(baseName(it.name.replace(/\.[^.]+$/, '')));
            files.forEach(f => zipFiles.push({ name: `${folder}/${f.name}`, data: f.data }));
            it.msg = `${files.length} Bild${files.length === 1 ? '' : 'er'}`;
            log.push(`OK      ${it.name} → ${folder}/ (${files.length})`);
          } else {
            const name = uniq(cfg.pattern.trim()
              ? patternName(cfg.pattern, it.name, idx + 1, items.length, date)
              : `${baseName(it.name.replace(/\.[^.]+$/, ''))} (${cfg.steps.length === 1 ? stepById(cfg.steps[0]).suffix : 'bearbeitet'}).pdf`);
            zipFiles.push({ name, data: bytes });
            if (saveToLib) await saveResult(bytes, name);
            it.msg = cfg.steps.includes('compress') ? `${formatSize(before)} → ${formatSize(bytes.byteLength)}${bytes.byteLength < before ? ` (−${Math.round((1 - bytes.byteLength / before) * 100)} %)` : ''}` : `Fertig · ${formatSize(bytes.byteLength)}`;
            if (cfg.steps.includes('protect') && bytes.byteLength > before * 1.2) note.push('größer durch die Verschlüsselung');
            if (note.length) it.msg += ' · ' + note.join(' · ');
            log.push(`OK      ${it.name} → ${name} (${formatSize(before)} → ${formatSize(bytes.byteLength)})${note.length ? ' – ' + note.join(', ') : ''}`);
          }
          it.status = 'done';
          okCount++;
        } catch (e) {
          it.status = e.skip ? 'skip' : 'error';
          it.msg = e.userMessage || 'Verarbeitung fehlgeschlagen';
          if (!e.userMessage) console.warn(e);
          log.push(`${it.status === 'skip' ? 'ÜBERSPRUNGEN' : 'FEHLER'}  ${it.name} – ${it.msg}`);
        }
        it.p = 1;
        updateRow(it);
        await tick();
      }
      const failed = items.filter(i => i.status === 'error' || i.status === 'skip');
      if (out === 'merge') {
        if (!merged.length) throw Object.assign(new Error('none'), { userMessage: 'Keine der Dateien konnte gelesen werden.' });
        if (cancelled) throw Object.assign(new Error('cancel'), { userMessage: 'Abgebrochen.' });
        const { mergePdfs } = await import('./merge.js');
        let bytes = await mergePdfs(merged, { title: cfg.mname });
        const note = [];
        for (const id of after) { bytes = await apply(id, bytes, { ...cfg, name: cfg.mname }, note); await tick(); }
        const name = `${cfg.mname}.pdf`;
        const extra = [`${merged.length} Dateien`, ...note, failed.length ? `${failed.length} übersprungen` : ''].filter(Boolean).join(' · ');
        if (saveToLib) {
          const res = await saveResult(bytes, name);
          resultBox.appendChild(resultCard(res, { title: 'Zusammengeführt', note: extra }));
        } else {
          resultBox.appendChild(fileResultCard(new Blob([bytes], { type: 'application/pdf' }), name, { title: 'Zusammengeführt', iconName: 'merge', note: extra, type: 'application/pdf' }));
        }
      } else if (zipFiles.length || failed.length) {
        if (failed.length) {
          const steps = cfg.steps.map(id => stepById(id).label).join(' → ') || OUTPUTS.find(o => o.id === out).label;
          const text = [`FaLe PDF Stapelverarbeitung – ${date.toLocaleString('de-DE')}`, `Schritte: ${steps}`, '', ...log, '',
            `${okCount} fertig, ${failed.length} nicht verarbeitet.`].join('\r\n');
          zipFiles.push({ name: uniq('Bericht.txt'), data: new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' }) });
        }
        const zip = await createZip(zipFiles);
        const stamp = date.toLocaleDateString('de-DE').replace(/\./g, '-');
        const label = cfg.steps.length === 1 ? stepById(cfg.steps[0]).label : (out === 'images' ? 'Bilder' : 'Ergebnis');
        resultBox.appendChild(fileResultCard(zip, `Stapel ${label} ${stamp}.zip`, {
          title: `${okCount} von ${items.length} Dateien verarbeitet`, iconName: 'layers', type: 'application/zip',
          note: `${zipFiles.length} Datei${zipFiles.length === 1 ? '' : 'en'} im ZIP${failed.length ? ' · mit Bericht' : ''}${saveToLib && out === 'files' ? ' · auch in „Dateien“ gespeichert' : ''}`,
        }));
      }
      const secs = Math.max(1, Math.round((Date.now() - started) / 1000));
      if (cancelled) toast(`Abgebrochen – ${okCount} Datei${okCount === 1 ? '' : 'en'} fertig.`, 'info', { timeout: 5000 });
      else toast(failed.length ? `${okCount} fertig, ${failed.length} übersprungen (${secs} s).` : `Alle ${okCount} Dateien verarbeitet (${secs} s).`, failed.length ? 'info' : 'success', { timeout: 5000 });
      resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) { errorToast(e, 'Die Stapelverarbeitung ist fehlgeschlagen.'); }
    finally {
      running = false;
      try { await lock?.release(); } catch { /* already released */ }
      render();
    }
  });

  render();
  renderOpts();
  return () => { alive = false; cancelled = true; };
}

/** Remove document properties and XMP metadata (author, title, software, dates) – in place. */
export function stripData(PDFLib, doc) {
  const { PDFDict, PDFName } = PDFLib;
  const ctx = doc.context;
  const info = ctx.lookup(ctx.trailerInfo.Info);
  if (info instanceof PDFDict) for (const [k] of info.entries()) info.delete(k);
  doc.catalog.delete(PDFName.of('Metadata'));
  doc.catalog.delete(PDFName.of('PieceInfo'));
  for (const p of doc.getPages()) { p.node.delete(PDFName.of('PieceInfo')); p.node.delete(PDFName.of('Metadata')); }
}
