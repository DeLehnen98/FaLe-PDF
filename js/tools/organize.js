// Tool: manage pages — rotate, delete, reorder, extract, split.
import * as db from '../db.js';
import { icon } from '../icons.js';
import { h, esc, toast, errorToast, progress, downloadBlob, confirmDialog, baseName } from '../ui.js';
import { resultCard, enableDragReorder, moveItem } from '../components.js';
import { getDocBytes, saveResult } from '../library.js';
import { loadPdf, renderPage } from '../pdfcore.js';
import { loadEditable, loadPdfLib, saveDoc } from '../pdflib.js';
import { createZip } from '../zip.js';

export async function mount(screen, { docId }) {
  const doc = await db.getDoc(docId);
  if (!doc) { screen.body.innerHTML = '<p class="panel-empty">Dokument nicht gefunden.</p>'; return; }
  screen.setTitle('Seiten verwalten', doc.name);
  const bytes = await getDocBytes(docId);
  const { pdf } = await loadPdf(bytes.slice(), { name: doc.name, key: docId });
  let alive = true;

  let pages = Array.from({ length: pdf.numPages }, (_, i) => ({ src: i, rot: 0, sel: false }));
  const canvases = new Map();

  const wrap = h(`<div class="screen-inner">
    ${doc.encrypted ? `<div class="notice">${icon('lock')}<span>Dieses Dokument ist passwortgeschützt. Neue Dateien werden ohne Passwort gespeichert – über „Passwort festlegen“ kannst du sie wieder schützen.</span></div>` : ''}
    <div class="toolbar">
      <button class="btn btn-ghost btn-sm" type="button" data-selall>${icon('select')} <span>Alle auswählen</span></button>
      <button class="btn btn-ghost btn-sm" type="button" data-rotl aria-label="Auswahl nach links drehen">${icon('rotateLeft')} Links</button>
      <button class="btn btn-ghost btn-sm" type="button" data-rotr aria-label="Auswahl nach rechts drehen">${icon('rotate')} Rechts</button>
      <button class="btn btn-ghost btn-sm" type="button" data-del>${icon('trash')} Löschen</button>
      <button class="btn btn-ghost btn-sm" type="button" data-extract>${icon('extract')} Extrahieren</button>
      <button class="btn btn-ghost btn-sm" type="button" data-split>${icon('split')} Aufteilen</button>
      <span class="grow"></span><span class="muted small" data-info></span>
    </div>
    <p class="muted small desktop-only" style="margin-top:-6px">Tipp: Seiten antippen zum Auswählen, zum Sortieren ziehen.</p>
    <div class="page-grid" data-grid></div>
    <div data-result></div></div>`);
  screen.body.appendChild(wrap);
  const grid = wrap.querySelector('[data-grid]');
  const info = wrap.querySelector('[data-info]');
  const resultBox = wrap.querySelector('[data-result]');
  const saveBtn = h(`<button class="btn btn-primary" type="button" data-save>${icon('check')} Änderungen speichern</button>`);

  const io = new IntersectionObserver(entries => {
    entries.forEach(en => { if (en.isIntersecting) { io.unobserve(en.target); drawThumb(en.target); } });
  }, { root: screen.body, rootMargin: '400px 0px' });

  async function drawThumb(card) {
    const src = +card.dataset.src;
    let c = canvases.get(src);
    if (!c) {
      try {
        const page = await pdf.getPage(src + 1);
        if (!alive) return;
        c = await renderPage(page, { width: 150, dpr: Math.min(2, window.devicePixelRatio || 1) });
        canvases.set(src, c);
      } catch (e) { if (alive) console.warn(e); return; }
    }
    const box = card.querySelector('.pcard-thumb');
    if (box && !box.contains(c)) { box.innerHTML = ''; box.appendChild(c); }
    applyRot(card);
  }

  function applyRot(card) {
    const p = pages[+card.dataset.i];
    const c = card.querySelector('canvas');
    if (p && c) c.style.transform = `rotate(${p.rot}deg)`;
  }

  const selected = () => pages.filter(p => p.sel);

  function render() {
    grid.innerHTML = '';
    pages.forEach((p, i) => {
      const card = h(`<div class="pcard ${p.sel ? 'selected' : ''}" draggable="true" data-i="${i}" data-src="${p.src}">
        <button class="pcard-thumb" type="button" aria-pressed="${p.sel}" aria-label="Seite ${p.src + 1} ${p.sel ? 'abwählen' : 'auswählen'}"><span class="spinner dark"></span></button>
        <span class="pcard-check" aria-hidden="true">${icon('check')}</span>
        <div class="pcard-foot"><span class="pcard-num">${i + 1}${p.src !== i ? ` <span class="muted small">(S. ${p.src + 1})</span>` : ''}</span>
          <span class="pcard-actions">
            <button class="icon-btn mobile-move" type="button" data-ml aria-label="Nach vorne" ${i === 0 ? 'disabled' : ''}>${icon('arrowLeft')}</button>
            <button class="icon-btn mobile-move" type="button" data-mr aria-label="Nach hinten" ${i === pages.length - 1 ? 'disabled' : ''}>${icon('arrowRight')}</button>
            <button class="icon-btn" type="button" data-r aria-label="Seite ${i + 1} drehen">${icon('rotate')}</button>
            <button class="icon-btn" type="button" data-x aria-label="Seite ${i + 1} löschen">${icon('trash')}</button>
          </span></div></div>`);
      card.querySelector('.pcard-thumb').addEventListener('click', () => { p.sel = !p.sel; render(); });
      card.querySelector('[data-r]').addEventListener('click', () => { p.rot = (p.rot + 90) % 360; render(); });
      card.querySelector('[data-x]').addEventListener('click', () => removePages([p]));
      card.querySelector('[data-ml]').addEventListener('click', () => { moveItem(pages, i, i - 1); render(); });
      card.querySelector('[data-mr]').addEventListener('click', () => { moveItem(pages, i, i + 1); render(); });
      grid.appendChild(card);
      if (canvases.has(p.src)) drawThumb(card); else io.observe(card);
    });
    const n = selected().length;
    info.textContent = `${pages.length} Seite${pages.length === 1 ? '' : 'n'}${n ? ` · ${n} ausgewählt` : ''}`;
    wrap.querySelector('[data-selall] span').textContent = n === pages.length && n ? 'Auswahl aufheben' : 'Alle auswählen';
    ['[data-rotl]', '[data-rotr]', '[data-del]', '[data-extract]'].forEach(s => { wrap.querySelector(s).disabled = !n; });
    const changed = pages.length !== pdf.numPages || pages.some((p, i) => p.src !== i || p.rot);
    saveBtn.disabled = !changed || !pages.length;
    screen.setFoot([saveBtn], changed ? 'Ungespeicherte Änderungen' : 'Noch keine Änderungen');
  }

  function removePages(list) {
    if (pages.length - list.length < 1) { toast('Mindestens eine Seite muss erhalten bleiben.', 'error'); return; }
    pages = pages.filter(p => !list.includes(p));
    render();
  }

  enableDragReorder(grid, '.pcard', (from, to) => { moveItem(pages, from, to); render(); });

  wrap.querySelector('[data-selall]').addEventListener('click', () => {
    const all = selected().length === pages.length;
    pages.forEach(p => { p.sel = !all; });
    render();
  });
  wrap.querySelector('[data-rotl]').addEventListener('click', () => { selected().forEach(p => { p.rot = (p.rot + 270) % 360; }); render(); });
  wrap.querySelector('[data-rotr]').addEventListener('click', () => { selected().forEach(p => { p.rot = (p.rot + 90) % 360; }); render(); });
  wrap.querySelector('[data-del]').addEventListener('click', () => removePages(selected()));

  async function build(list) {
    const src = await loadEditable(bytes, doc.name, { key: docId });
    const { PDFDocument, degrees } = await loadPdfLib();
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, list.map(p => p.src));
    copied.forEach((pg, i) => {
      const r = list[i].rot;
      if (r) pg.setRotation(degrees((pg.getRotation().angle + r) % 360));
      out.addPage(pg);
    });
    const title = src.getTitle();
    if (title) out.setTitle(title);
    return out;
  }

  const rangeLabel = list => {
    const nums = list.map(p => p.src + 1);
    return nums.length > 4 ? `${nums.length} Seiten` : `S. ${nums.join(', ')}`;
  };

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    const prog = progress('Speichere …');
    try {
      const out = await build(pages);
      const res = await saveResult(await saveDoc(out), `${baseName(doc.name)} (bearbeitet).pdf`);
      resultBox.innerHTML = '';
      resultBox.appendChild(resultCard(res, { from: docId, title: 'Gespeichert' }));
      resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      toast('Neue Version gespeichert.', 'success');
    } catch (e) { errorToast(e, 'Speichern fehlgeschlagen.'); }
    finally { prog.done(); saveBtn.disabled = false; }
  });

  wrap.querySelector('[data-extract]').addEventListener('click', async () => {
    const list = selected();
    if (!list.length) return;
    const prog = progress('Extrahiere Seiten …');
    try {
      const out = await build(list);
      const res = await saveResult(await saveDoc(out), `${baseName(doc.name)} – ${rangeLabel(list)}.pdf`);
      resultBox.innerHTML = '';
      resultBox.appendChild(resultCard(res, { title: `${list.length} Seite${list.length === 1 ? '' : 'n'} extrahiert` }));
      resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) { errorToast(e, 'Extrahieren fehlgeschlagen.'); }
    finally { prog.done(); }
  });

  wrap.querySelector('[data-split]').addEventListener('click', async () => {
    if (pages.length < 2) { toast('Ein einseitiges Dokument kann nicht aufgeteilt werden.', 'error'); return; }
    const ok = await confirmDialog('In Einzelseiten aufteilen?', `Es werden ${pages.length} einzelne PDFs erstellt${pages.length <= 30 ? ' und in deiner Bibliothek gespeichert' : ''}. Zusätzlich kannst du alle als ZIP herunterladen.`, { okLabel: 'Aufteilen' });
    if (!ok) return;
    const prog = progress('Teile auf …');
    try {
      const files = [];
      const saved = [];
      const width = String(pages.length).length;
      for (let i = 0; i < pages.length; i++) {
        prog.set(`Teile auf … ${i + 1}/${pages.length}`);
        const out = await build([pages[i]]);
        const b = await saveDoc(out);
        const name = `${baseName(doc.name)} – Seite ${String(i + 1).padStart(width, '0')}.pdf`;
        files.push({ name, data: b });
        if (pages.length <= 30) saved.push(await saveResult(b, name));
      }
      const zip = await createZip(files);
      resultBox.innerHTML = '';
      const card = h(`<div class="card result-card"><span class="tile-ic">${icon('split')}</span><div class="grow">
        <div class="result-title">${icon('check')} Aufgeteilt</div><div class="doc-name">${files.length} Einzelseiten${saved.length ? ' – in der Bibliothek gespeichert' : ''}</div></div>
        <div class="actions"><button class="btn btn-primary btn-sm" type="button" data-zip>${icon('download')} ZIP herunterladen</button>
        <a class="btn btn-ghost btn-sm" href="#/start">Zur Bibliothek</a></div></div>`);
      card.querySelector('[data-zip]').addEventListener('click', () => downloadBlob(zip, `${baseName(doc.name)} – Einzelseiten.zip`));
      resultBox.appendChild(card);
      resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      toast(`${files.length} Einzelseiten erstellt.`, 'success');
    } catch (e) { errorToast(e, 'Aufteilen fehlgeschlagen.'); }
    finally { prog.done(); }
  });

  render();
  return () => { alive = false; io.disconnect(); pdf.destroy(); };
}
