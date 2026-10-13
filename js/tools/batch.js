// Tool: Stapelverarbeitung — run one action on many PDFs (or images): compress, set password,
// watermark, page numbers, convert to images, merge in order. Progress per file, results as a
// ZIP and (optionally) in the library. Reuses the pure functions of the single-file tools.
import * as db from '../db.js';
import { icon } from '../icons.js';
import { h, esc, toast, errorToast, pickFiles, formatSize, baseName, safeFileName } from '../ui.js';
import { pickDocsDialog, resultCard, enableDragReorder, moveItem } from '../components.js';
import { getDocBytes, saveResult } from '../library.js';
import { createZip } from '../zip.js';
import { ensureCss, fileResultCard, proBadge, updateFoot, tick, swatches } from './common.js';

const ACTIONS = [
  { id: 'compress', label: 'Komprimieren', icon: 'compress', desc: 'Dateien verkleinern' },
  { id: 'protect', label: 'Passwort setzen', icon: 'lock', desc: 'AES-256 verschlüsseln' },
  { id: 'watermark', label: 'Wasserzeichen', icon: 'watermark', desc: 'Text auf jede Seite' },
  { id: 'numbers', label: 'Seitenzahlen', icon: 'hash', desc: '„Seite 1 von N“' },
  { id: 'images', label: 'In Bilder umwandeln', icon: 'image', desc: 'Seiten als PNG/JPG' },
  { id: 'merge', label: 'Zusammenführen', icon: 'merge', desc: 'Eine PDF in Reihenfolge' },
];
const WM_COLORS = [{ c: '#9AA0B4', n: 'Grau' }, { c: '#E03131', n: 'Rot' }, { c: '#1C64F2', n: 'Blau' }, { c: '#1F2340', n: 'Schwarz' }];
const isImage = f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name);
const isPdf = f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

export async function mount(screen) {
  await ensureCss();
  screen.setTitle('Stapelverarbeitung', 'Eine Aktion für viele Dateien');
  let items = []; // {id, kind:'doc'|'file', doc?, file?, name, size, image, status, msg, out}
  let action = 'compress';
  let running = false;
  let alive = true;
  let seq = 0;
  let wmColor = '#9AA0B4';

  const wrap = h(`<div class="screen-inner bt">
    <div class="card intro"><span class="tile-ic">${icon('layers')}</span><div><strong>Viele Dateien auf einmal</strong>
      <p>Wähle PDFs (oder Bilder) und eine Aktion – FaLe PDF verarbeitet alles nacheinander auf deinem Gerät. ${proBadge()}</p></div></div>
    <h2 class="section-title">1. Dateien</h2>
    <div class="toolbar"><button class="btn btn-soft" type="button" data-lib>${icon('folder')} Aus Bibliothek</button>
      <button class="btn btn-soft" type="button" data-dev>${icon('open')} Vom Gerät</button><span class="grow"></span><span class="muted small" data-sum></span></div>
    <div class="order-list" data-list></div>
    <h2 class="section-title">2. Aktion</h2>
    <div class="bt-actions" role="radiogroup" aria-label="Aktion">${ACTIONS.map(a => `<button type="button" class="bt-action" role="radio" data-action="${a.id}" aria-checked="false">${icon(a.icon)}<strong>${a.label}</strong><span>${a.desc}</span></button>`).join('')}</div>
    <form class="card card-pad bt-opts" data-opts novalidate></form>
    <label class="check"><input type="checkbox" data-save checked><span>Ergebnisse zusätzlich in „Dateien“ speichern</span></label>
    <div data-result></div></div>`);
  screen.body.appendChild(wrap);
  const listEl = wrap.querySelector('[data-list]');
  const opts = wrap.querySelector('[data-opts]');
  const resultBox = wrap.querySelector('[data-result]');
  const runBtn = h(`<button class="btn btn-primary" type="button">${icon('layers')} Starten</button>`);
  opts.addEventListener('submit', e => e.preventDefault());

  function addFiles(files) {
    const ok = files.filter(f => isPdf(f) || isImage(f));
    if (ok.length < files.length) toast('Nur PDFs und Bilder können verarbeitet werden.', 'error');
    ok.forEach(f => items.push({ id: ++seq, kind: 'file', file: f, name: f.name, size: f.size, image: isImage(f), status: 'wait' }));
    render();
  }
  wrap.querySelector('[data-lib]').addEventListener('click', async () => {
    const ids = await pickDocsDialog({ multi: true, title: 'Dateien wählen', exclude: items.filter(i => i.doc).map(i => i.doc.id) });
    if (!ids) return;
    for (const id of ids) { const d = await db.getDoc(id); if (d) items.push({ id: ++seq, kind: 'doc', doc: d, name: d.name, size: d.size, image: false, status: 'wait' }); }
    render();
  });
  wrap.querySelector('[data-dev]').addEventListener('click', async () => addFiles(await pickFiles({ accept: '.pdf,application/pdf,image/*', multiple: true })));
  screen.onDropFiles = files => { if (!running) addFiles(files); };

  const STATUS = { wait: '', run: 'Läuft …', done: 'Fertig', error: 'Fehler', skip: 'Übersprungen' };
  function render() {
    listEl.innerHTML = '';
    if (!items.length) listEl.appendChild(h(`<div class="empty"><div class="empty-art">${icon('layers')}</div><h3>Noch keine Dateien</h3><p>Füge PDFs oder Bilder hinzu – auch per Ziehen &amp; Ablegen.</p></div>`));
    items.forEach((it, i) => {
      const row = h(`<div class="order-item bt-item" draggable="${!running}" data-i="${i}">
        <span class="order-num">${i + 1}</span><span class="tile-ic bt-ic">${icon(it.image ? 'image' : 'file')}</span>
        <span class="doc-info"><span class="doc-name">${esc(it.name)}</span>
          <span class="doc-meta">${formatSize(it.size)}${it.status !== 'wait' ? ` · <b class="bt-st bt-${it.status}">${esc(it.msg || STATUS[it.status])}</b>` : ''}</span>
          ${it.status === 'run' ? `<span class="bt-bar"><span style="width:${Math.round((it.p || 0) * 100)}%"></span></span>` : ''}</span>
        <button class="icon-btn" type="button" data-up aria-label="Nach oben" ${i === 0 || running ? 'disabled' : ''}>${icon('arrowUp')}</button>
        <button class="icon-btn" type="button" data-down aria-label="Nach unten" ${i === items.length - 1 || running ? 'disabled' : ''}>${icon('arrowDown')}</button>
        <button class="icon-btn" type="button" data-x aria-label="Entfernen" ${running ? 'disabled' : ''}>${icon('close')}</button></div>`);
      row.querySelector('[data-up]').addEventListener('click', () => { moveItem(items, i, i - 1); render(); });
      row.querySelector('[data-down]').addEventListener('click', () => { moveItem(items, i, i + 1); render(); });
      row.querySelector('[data-x]').addEventListener('click', () => { items.splice(i, 1); render(); });
      it.row = row;
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
    meta.innerHTML = `${formatSize(it.size)}${it.status !== 'wait' ? ` · <b class="bt-st bt-${it.status}">${esc(it.msg || STATUS[it.status])}</b>` : ''}`;
    let bar = it.row.querySelector('.bt-bar');
    if (it.status === 'run') {
      if (!bar) { bar = h('<span class="bt-bar"><span></span></span>'); meta.after(bar); }
      bar.firstElementChild.style.width = `${Math.round((it.p || 0) * 100)}%`;
    } else if (bar) bar.remove();
  }

  // ---------- options per action ----------
  function renderOpts() {
    wrap.querySelectorAll('[data-action]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.action === action)));
    if (action === 'compress') {
      opts.innerHTML = `<div class="seg pt-seg-full" role="group"><button type="button" data-cm="lossless" aria-pressed="true">Verlustfrei</button><button type="button" data-cm="strong" aria-pressed="false">Stark (Seiten als Bild)</button></div>
        <div data-strong hidden><label class="field"><span class="field-label">Bildqualität: <b data-qv>60</b> %</span><input type="range" name="q" min="25" max="90" step="5" value="60"></label>
        <label class="field"><span class="field-label">Auflösung</span><select class="select" name="dpi"><option value="100">100 dpi</option><option value="130" selected>130 dpi</option><option value="150">150 dpi</option></select></label>
        <p class="hint">Achtung: Text wird bei „Stark“ zu Bild.</p></div>`;
      opts.querySelectorAll('[data-cm]').forEach(b => b.addEventListener('click', () => {
        opts.querySelectorAll('[data-cm]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        opts.querySelector('[data-strong]').hidden = b.dataset.cm !== 'strong';
      }));
      opts.q.addEventListener('input', () => { opts.querySelector('[data-qv]').textContent = opts.q.value; });
    } else if (action === 'protect') {
      opts.innerHTML = `<input type="text" name="username" autocomplete="username" value="Stapel" hidden>
        <label class="field"><span class="field-label">Passwort für alle Dateien</span><input class="input" type="password" name="pw1" autocomplete="new-password"></label>
        <label class="field"><span class="field-label">Passwort wiederholen</span><input class="input" type="password" name="pw2" autocomplete="new-password"></label>
        <label class="check"><input type="checkbox" name="print" checked><span>Drucken erlauben</span></label>
        <label class="check"><input type="checkbox" name="copy" checked><span>Kopieren erlauben</span></label>
        <p class="hint">FaLe PDF speichert das Passwort nicht – merke es dir gut.</p>`;
    } else if (action === 'watermark') {
      opts.innerHTML = `<label class="field"><span class="field-label">Text</span><input class="input" name="text" value="VERTRAULICH" maxlength="80"></label>
        <div class="pt-two"><label class="field"><span class="field-label">Schriftgröße</span><input class="input" type="number" name="size" min="12" max="160" value="60"></label>
        <label class="field"><span class="field-label">Deckkraft (%)</span><input class="input" type="number" name="op" min="5" max="100" value="25"></label></div>
        <div class="pt-row"><span class="field-label">Farbe</span><span data-colors></span></div>
        <label class="check"><input type="checkbox" name="tile"><span>Über die ganze Seite kacheln</span></label>`;
      opts.querySelector('[data-colors]').appendChild(swatches(WM_COLORS, wmColor, c => { wmColor = c; }));
    } else if (action === 'numbers') {
      opts.innerHTML = `<label class="field"><span class="field-label">Format</span><select class="select" name="format"><option value="n">1</option><option value="s">Seite 1</option><option value="sv" selected>Seite 1 von N</option><option value="slash">1 / N</option></select></label>
        <label class="field"><span class="field-label">Position</span><select class="select" name="pos"><option value="b-c" selected>Unten Mitte</option><option value="b-r">Unten rechts</option><option value="b-l">Unten links</option><option value="t-c">Oben Mitte</option><option value="t-r">Oben rechts</option></select></label>`;
    } else if (action === 'images') {
      opts.innerHTML = `<div class="pt-two"><label class="field"><span class="field-label">Format</span><select class="select" name="fmt"><option value="jpg">JPG</option><option value="png">PNG</option></select></label>
        <label class="field"><span class="field-label">Auflösung</span><select class="select" name="dpi"><option value="100">100 dpi</option><option value="150" selected>150 dpi</option><option value="300">300 dpi</option></select></label></div>
        <p class="hint">Die Bilder kommen als ZIP – je Datei ein eigener Ordner.</p>`;
    } else if (action === 'merge') {
      opts.innerHTML = `<label class="field"><span class="field-label">Name der neuen PDF</span><input class="input" name="mname" value="Zusammengeführt" maxlength="100"></label>
        <label class="field"><span class="field-label">Bilder als Seite</span><select class="select" name="isize"><option value="a4">A4 mit Rand</option><option value="fit">An Bild anpassen</option></select></label>
        <p class="hint">Die Reihenfolge entspricht der Liste oben – mit den Pfeilen oder per Ziehen ändern.</p>`;
    }
    refresh();
  }
  wrap.querySelectorAll('[data-action]').forEach(b => b.addEventListener('click', () => { if (!running) { action = b.dataset.action; renderOpts(); } }));
  opts.addEventListener('input', () => refresh());

  function refresh() {
    const n = items.length;
    let info = n ? `${n} Datei${n === 1 ? '' : 'en'} · ${ACTIONS.find(a => a.id === action).label}` : 'Füge Dateien hinzu';
    let ok = n > 0 && !running;
    if (action === 'merge' && n < 2) { ok = false; if (n) info = 'Zum Zusammenführen mindestens 2 Dateien'; }
    runBtn.disabled = !ok;
    runBtn.innerHTML = running ? '<span class="spinner"></span> Läuft …' : `${icon('layers')} Starten`;
    updateFoot(screen, [runBtn], info);
  }

  // ---------- run ----------
  async function inputBytes(it, { pageSize = 'a4' } = {}) {
    if (it.kind === 'doc') return { bytes: await getDocBytes(it.doc.id), name: it.doc.name, key: it.doc.id };
    if (it.image) {
      const { imagesToPdf } = await import('./images.js');
      const r = await imagesToPdf([it.file], { pageSize, title: baseName(it.name.replace(/\.[^.]+$/, '')) });
      return { bytes: r.bytes, name: it.name.replace(/\.[^.]+$/, '') + '.pdf', key: null };
    }
    return { bytes: new Uint8Array(await it.file.arrayBuffer()), name: it.name, key: null };
  }

  runBtn.addEventListener('click', async () => {
    if (running || !items.length) return;
    // validate options
    let cfg = {};
    if (action === 'protect') {
      const a = opts.pw1.value, b = opts.pw2.value;
      if (a.length < 4) { toast('Das Passwort sollte mindestens 4 Zeichen haben.', 'error'); opts.pw1.focus(); return; }
      if (a !== b) { toast('Die Passwörter stimmen nicht überein.', 'error'); opts.pw2.focus(); return; }
      cfg = { userPassword: a, permissions: { printing: opts.print.checked, copying: opts.copy.checked, editing: true } };
    } else if (action === 'compress') {
      const strong = opts.querySelector('[data-cm="strong"]').getAttribute('aria-pressed') === 'true';
      cfg = { mode: strong ? 'strong' : 'lossless', quality: +opts.q.value / 100, dpi: +opts.dpi.value };
    } else if (action === 'watermark') {
      if (!opts.text.value.trim()) { toast('Bitte gib einen Wasserzeichen-Text ein.', 'error'); return; }
      cfg = { kind: 'text', text: opts.text.value.trim(), size: Math.max(12, Math.min(160, +opts.size.value || 60)), opacity: Math.max(5, Math.min(100, +opts.op.value || 25)), color: wmColor, bold: true, rotation: 45, position: opts.tile.checked ? 'tile' : 'm-c', range: '' };
    } else if (action === 'numbers') {
      cfg = { format: opts.format.value, position: opts.pos.value, range: '', start: 1 };
    } else if (action === 'images') {
      cfg = { fmt: opts.fmt.value, dpi: +opts.dpi.value };
    } else if (action === 'merge') {
      cfg = { name: safeFileName(opts.mname.value.trim() || 'Zusammengeführt'), pageSize: opts.isize.value };
    }
    const saveToLib = wrap.querySelector('[data-save]').checked;
    running = true;
    items.forEach(it => { it.status = 'wait'; it.msg = ''; it.out = null; it.p = 0; });
    render();
    resultBox.innerHTML = '';
    const zipFiles = [];
    const usedNames = new Set();
    const uniq = n => { let x = n, k = 2; while (usedNames.has(x.toLowerCase())) { x = n.replace(/(\.[^.]+)?$/, ` (${k++})$1`); } usedNames.add(x.toLowerCase()); return x; };
    let okCount = 0;
    const started = Date.now();
    try {
      if (action === 'merge') {
        const list = [];
        for (const it of items) {
          it.status = 'run'; it.p = 0.3; updateRow(it);
          try { list.push(await inputBytes(it, { pageSize: cfg.pageSize })); it.status = 'done'; it.msg = 'Bereit'; }
          catch (e) { it.status = 'error'; it.msg = e.userMessage || 'Konnte nicht gelesen werden'; console.warn(e); }
          updateRow(it);
          await tick();
        }
        if (list.length < 1) throw Object.assign(new Error('none'), { userMessage: 'Keine der Dateien konnte gelesen werden.' });
        const { mergePdfs } = await import('./merge.js');
        const bytes = await mergePdfs(list, { title: cfg.name });
        const name = `${cfg.name}.pdf`;
        if (saveToLib) {
          const res = await saveResult(bytes, name);
          resultBox.appendChild(resultCard(res, { title: 'Zusammengeführt', note: `${list.length} Dateien` }));
        } else {
          resultBox.appendChild(fileResultCard(new Blob([bytes], { type: 'application/pdf' }), name, { title: 'Zusammengeführt', iconName: 'merge', type: 'application/pdf' }));
        }
        okCount = list.length;
      } else {
        const mod = action === 'compress' ? await import('./compress.js') : action === 'protect' ? await import('./protect.js')
          : action === 'images' ? await import('./export.js') : await import('./stamp.js');
        for (const it of items) {
          if (!alive) return;
          it.status = 'run'; it.p = 0.05; updateRow(it);
          try {
            const src = await inputBytes(it);
            it.p = 0.2; updateRow(it);
            const onP = (a, b) => { if (typeof a === 'number' && b) { it.p = 0.2 + 0.75 * (a / b); updateRow(it); } };
            if (action === 'images') {
              const files = await mod.pdfToImages(src.bytes, { fmt: cfg.fmt, dpi: cfg.dpi, name: src.name, key: src.key, onProgress: onP });
              const folder = uniq(baseName(src.name));
              files.forEach(f => zipFiles.push({ name: `${folder}/${f.name}`, data: f.data }));
              it.msg = `${files.length} Bild${files.length === 1 ? '' : 'er'}`;
            } else {
              let out;
              if (action === 'compress') out = await mod.compressPdf(src.bytes, { ...cfg, name: src.name, key: src.key, onProgress: () => {} });
              else if (action === 'protect') out = await mod.protectPdf(src.bytes, { ...cfg, name: src.name, key: src.key, onProgress: f => { it.p = 0.2 + 0.75 * f; updateRow(it); } });
              else out = await mod.stampPdf(src.bytes, action, cfg, { name: src.name, key: src.key, onProgress: onP });
              const suffix = { compress: 'komprimiert', protect: 'geschützt', watermark: 'Wasserzeichen', numbers: 'nummeriert' }[action];
              const outName = uniq(`${baseName(src.name)} (${suffix}).pdf`);
              zipFiles.push({ name: outName, data: out });
              if (saveToLib) await saveResult(out, outName);
              const before = src.bytes.byteLength;
              it.msg = action === 'compress' ? `${formatSize(before)} → ${formatSize(out.byteLength)}${out.byteLength < before ? ` (−${Math.round((1 - out.byteLength / before) * 100)} %)` : ''}` : `Fertig · ${formatSize(out.byteLength)}`;
            }
            it.status = 'done';
            okCount++;
          } catch (e) {
            it.status = 'error';
            it.msg = e.userMessage || 'Verarbeitung fehlgeschlagen';
            if (!e.userMessage) console.warn(e);
          }
          updateRow(it);
          await tick();
        }
        if (zipFiles.length) {
          const zip = await createZip(zipFiles);
          const stamp = new Date().toLocaleDateString('de-DE').replace(/\./g, '-');
          const zname = `Stapel ${ACTIONS.find(a => a.id === action).label} ${stamp}.zip`;
          resultBox.appendChild(fileResultCard(zip, zname, { title: `${okCount} von ${items.length} Dateien verarbeitet`, iconName: 'layers', note: `${zipFiles.length} Datei${zipFiles.length === 1 ? '' : 'en'} im ZIP${saveToLib && action !== 'images' ? ' · auch in „Dateien“ gespeichert' : ''}`, type: 'application/zip' }));
        }
      }
      const secs = Math.max(1, Math.round((Date.now() - started) / 1000));
      const failed = items.filter(i => i.status === 'error').length;
      toast(failed ? `${okCount} fertig, ${failed} mit Fehler (${secs} s).` : `Alle ${okCount} Dateien verarbeitet (${secs} s).`, failed ? 'info' : 'success', { timeout: 5000 });
      resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) { errorToast(e, 'Die Stapelverarbeitung ist fehlgeschlagen.'); }
    finally { running = false; render(); }
  });

  render();
  renderOpts();
  return () => { alive = false; };
}
