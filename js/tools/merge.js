// Tool: merge several PDFs into one.
import * as db from '../db.js';
import { icon } from '../icons.js';
import { h, esc, toast, errorToast, progress } from '../ui.js';
import { thumbHtml, docMeta, pickDocsDialog, resultCard, enableDragReorder, moveItem } from '../components.js';
import { getDocBytes, saveResult, importFiles } from '../library.js';
import { loadEditable, loadPdfLib, saveDoc } from '../pdflib.js';

/**
 * Merge PDFs in the given order (pure, reusable by the batch tool).
 * @param {Array<{bytes: Uint8Array, name?: string, key?: string}>} list
 * @returns {Promise<Uint8Array>}
 */
export async function mergePdfs(list, { onProgress = null, title = 'Zusammengefügt' } = {}) {
  const { PDFDocument } = await loadPdfLib();
  const out = await PDFDocument.create();
  for (let i = 0; i < list.length; i++) {
    if (onProgress) onProgress(i + 1, list.length);
    const src = await loadEditable(list[i].bytes, list[i].name || 'Dokument', { key: list[i].key || null });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach(p => out.addPage(p));
  }
  out.setTitle(title);
  return saveDoc(out);
}

export async function mount(screen, { docId }) {
  let items = [];
  if (docId) { const d = await db.getDoc(docId); if (d) items.push(d); }

  const wrap = h(`<div class="screen-inner">
    <div class="card intro"><span class="tile-ic">${icon('merge')}</span><div><strong>PDFs zusammenfügen</strong>
      <p>Wähle mindestens zwei Dokumente und bringe sie in die gewünschte Reihenfolge – per Ziehen oder mit den Pfeilen.</p></div></div>
    <div class="toolbar"><button class="btn btn-soft" type="button" data-add>${icon('plus')} Dokumente hinzufügen</button><span class="grow"></span><span class="muted small" data-sum></span></div>
    <div class="order-list" data-list></div>
    <div data-result></div></div>`);
  screen.body.appendChild(wrap);
  const list = wrap.querySelector('[data-list]');
  const resultBox = wrap.querySelector('[data-result]');
  const mergeBtn = h(`<button class="btn btn-primary" type="button" data-merge>${icon('merge')} Zusammenfügen</button>`);

  const render = () => {
    list.innerHTML = '';
    if (!items.length) list.appendChild(h(`<div class="empty"><div class="empty-art">${icon('merge')}</div><h3>Noch keine Dokumente gewählt</h3><p>Füge zwei oder mehr PDFs hinzu.</p></div>`));
    items.forEach((d, i) => {
      const row = h(`<div class="order-item" draggable="true" data-i="${i}">
        <span class="handle desktop-only" aria-hidden="true">${icon('drag')}</span>
        <span class="order-num">${i + 1}</span>${thumbHtml(d)}
        <span class="doc-info"><span class="doc-name">${esc(d.name)}</span><span class="doc-meta">${docMeta(d)}</span></span>
        <button class="icon-btn" type="button" data-up aria-label="Nach oben" ${i === 0 ? 'disabled' : ''}>${icon('arrowUp')}</button>
        <button class="icon-btn" type="button" data-down aria-label="Nach unten" ${i === items.length - 1 ? 'disabled' : ''}>${icon('arrowDown')}</button>
        <button class="icon-btn" type="button" data-remove aria-label="Entfernen">${icon('close')}</button></div>`);
      row.querySelector('[data-up]').addEventListener('click', () => { moveItem(items, i, i - 1); render(); });
      row.querySelector('[data-down]').addEventListener('click', () => { moveItem(items, i, i + 1); render(); });
      row.querySelector('[data-remove]').addEventListener('click', () => { items.splice(i, 1); render(); });
      list.appendChild(row);
    });
    const pages = items.reduce((s, d) => s + (d.pages || 0), 0);
    wrap.querySelector('[data-sum]').textContent = items.length ? `${items.length} Dokumente · ${pages} Seiten` : '';
    mergeBtn.disabled = items.length < 2;
    screen.setFoot([mergeBtn], items.length < 2 ? 'Mindestens 2 Dokumente wählen' : `Ergebnis: ${pages} Seiten`);
  };
  enableDragReorder(list, '.order-item', (from, to) => { moveItem(items, from, to); render(); });

  wrap.querySelector('[data-add]').addEventListener('click', async () => {
    const ids = await pickDocsDialog({ multi: true, title: 'Dokumente hinzufügen' });
    if (!ids) return;
    for (const id of ids) { const d = await db.getDoc(id); if (d) items.push(d); }
    render();
  });
  screen.onDropFiles = async files => {
    const docs = await importFiles(files.filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf'));
    items.push(...docs);
    render();
  };

  mergeBtn.addEventListener('click', async () => {
    if (items.length < 2) return;
    mergeBtn.disabled = true;
    const prog = progress('Füge zusammen …');
    try {
      const list = [];
      for (const it of items) list.push({ bytes: await getDocBytes(it.id), name: it.name, key: it.id });
      const bytes = await mergePdfs(list, { onProgress: (i, n) => prog.set(`Füge zusammen … ${i}/${n}`) });
      const first = items[0].name.replace(/\.pdf$/i, '');
      const doc = await saveResult(bytes, `${first} + ${items.length - 1} weitere.pdf`);
      resultBox.innerHTML = '';
      resultBox.appendChild(resultCard(doc, { title: 'Zusammengefügt' }));
      resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      toast('PDFs wurden zusammengefügt.', 'success');
    } catch (e) {
      errorToast(e, 'Zusammenfügen fehlgeschlagen.');
    } finally {
      prog.done();
      mergeBtn.disabled = items.length < 2;
    }
  });
  render();
}
