// Tool: Lesezeichen bearbeiten — show, add, rename, reorder, nest and delete PDF bookmarks
// (document outline) and generate them from headings (font-size heuristics). Writes /Outlines
// with pdf-lib low-level objects.
import { icon } from '../icons.js';
import { h, esc, toast, errorToast, progress, baseName, openDialog, confirmDialog } from '../ui.js';
import { resultCard } from '../components.js';
import { saveResult } from '../library.js';
import { loadPdf, renderPage } from '../pdfcore.js';
import { loadEditable, loadPdfLib, saveDoc } from '../pdflib.js';
import { openToolDoc, proBadge, updateFoot, guardLeave, tick } from './common.js';
import { readOutline, outlineFromHeadings as headingsCore, writeOutline } from './outlinecore.js';

export { readOutline, writeOutline };
/** Headings → bookmarks, yielding to the UI every few pages. */
export const outlineFromHeadings = (pdf, onProgress) => headingsCore(pdf, async (n, total) => { onProgress?.(n, total); await tick(); });

export async function mount(screen, { docId }) {
  const ctx = await openToolDoc(screen, docId, 'Lesezeichen bearbeiten');
  if (!ctx) return;
  const { doc, bytes } = ctx;
  const { pdf } = await loadPdf(bytes.slice(), { name: doc.name, key: docId });
  const N = pdf.numPages;
  let list = await readOutline(pdf);
  let original = JSON.stringify(list);
  let saved = original;
  let sel = list.length ? 0 : -1;
  let alive = true;
  let previewSeq = 0;

  const wrap = h(`<div class="screen-inner pt-stamp">
    <div class="card intro"><span class="tile-ic">${icon('outline')}</span><div><strong>${esc(doc.name)}</strong>
      <p>Lesezeichen bilden das Inhaltsverzeichnis in der Seitenleiste jedes PDF-Programms. ${proBadge()}</p></div></div>
    <div class="pt-stamp-grid bm-grid">
      <div class="card bm-card">
        <div class="bm-tools">
          <button class="btn btn-primary btn-sm" type="button" data-add>${icon('plus')} Neu</button>
          <button class="btn btn-soft btn-sm" type="button" data-gen>${icon('magic')} Aus Überschriften</button>
          <span class="grow"></span>
          <span class="muted small" data-count></span>
        </div>
        <div class="bm-list" role="tree" aria-label="Lesezeichen" data-list></div>
        <div class="bm-actions" data-actions>
          <button class="icon-btn" type="button" data-act="up" aria-label="Nach oben" title="Nach oben">${icon('arrowUp')}</button>
          <button class="icon-btn" type="button" data-act="down" aria-label="Nach unten" title="Nach unten">${icon('arrowDown')}</button>
          <button class="icon-btn" type="button" data-act="out" aria-label="Ausrücken (Ebene höher)" title="Ausrücken">${icon('arrowLeft')}</button>
          <button class="icon-btn" type="button" data-act="in" aria-label="Einrücken (Unterpunkt)" title="Einrücken">${icon('arrowRight')}</button>
          <button class="icon-btn" type="button" data-act="edit" aria-label="Umbenennen / Ziel ändern" title="Bearbeiten">${icon('edit')}</button>
          <button class="icon-btn" type="button" data-act="del" aria-label="Löschen" title="Löschen">${icon('trash')}</button>
        </div>
      </div>
      <div class="pt-preview-col">
        <div class="pt-preview"><div class="pt-prev-page" data-prev><span class="muted small">Kein Lesezeichen gewählt</span></div></div>
        <div class="pt-prev-nav"><button class="icon-btn" type="button" data-pp aria-label="Vorherige Seite">${icon('chevronLeft')}</button><span data-pinfo></span>
          <button class="icon-btn" type="button" data-pn aria-label="Nächste Seite">${icon('chevronRight')}</button></div>
        <button class="btn btn-ghost btn-sm bm-settarget" type="button" data-settarget>${icon('bookmark')} Diese Seite als Ziel</button>
      </div>
    </div>
    <div data-result></div></div>`);
  screen.body.appendChild(wrap);
  const listEl = wrap.querySelector('[data-list]');
  const prevBox = wrap.querySelector('[data-prev]');
  const resultBox = wrap.querySelector('[data-result]');
  const saveBtn = h(`<button class="btn btn-primary" type="button">${icon('check')} Speichern</button>`);
  let previewPage = 1;

  function subtreeEnd(i) { let j = i + 1; while (j < list.length && list[j].level > list[i].level) j++; return j; }
  function render() {
    listEl.innerHTML = '';
    if (!list.length) listEl.appendChild(h(`<div class="empty bm-empty"><div class="empty-art">${icon('outline')}</div><h3>Keine Lesezeichen</h3><p>Lege eines an oder lass sie aus den Überschriften erzeugen.</p></div>`));
    list.forEach((it, i) => {
      const row = h(`<div class="bm-row${i === sel ? ' sel' : ''}" role="treeitem" aria-level="${it.level + 1}" aria-selected="${i === sel}" tabindex="${i === sel ? 0 : -1}" style="--lvl:${it.level}">
        <span class="bm-dot"></span><span class="bm-title">${esc(it.title)}</span><span class="bm-page">S. ${it.page}</span></div>`);
      row.addEventListener('click', () => { sel = i; render(); preview(it.page); });
      row.addEventListener('dblclick', () => { sel = i; edit(i); });
      row.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown' && i < list.length - 1) { e.preventDefault(); sel = i + 1; render(); focusSel(); preview(list[sel].page); }
        else if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); sel = i - 1; render(); focusSel(); preview(list[sel].page); }
        else if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); edit(i); }
        else if (e.key === 'Delete') { e.preventDefault(); act('del'); }
        else if (e.key === 'Tab' && !e.altKey) { e.preventDefault(); act(e.shiftKey ? 'out' : 'in'); focusSel(); }
      });
      listEl.appendChild(row);
    });
    const has = sel >= 0 && sel < list.length;
    wrap.querySelectorAll('[data-act]').forEach(b => {
      const a = b.dataset.act;
      let ok = has;
      if (has && a === 'up') ok = sel > 0;
      if (has && a === 'down') ok = subtreeEnd(sel) < list.length;
      if (has && a === 'in') ok = sel > 0 && list[sel].level <= list[sel - 1].level;
      if (has && a === 'out') ok = list[sel].level > 0;
      b.disabled = !ok;
    });
    wrap.querySelector('[data-count]').textContent = list.length ? `${list.length} Lesezeichen` : '';
    const dirty = JSON.stringify(list) !== saved;
    saveBtn.disabled = !dirty;
    updateFoot(screen, [saveBtn], dirty ? 'Ungespeicherte Änderungen' : (list.length ? '' : 'Noch keine Lesezeichen'));
  }
  const focusSel = () => { const r = listEl.querySelector('.bm-row.sel'); if (r) r.focus(); };

  async function preview(n) {
    previewPage = Math.max(1, Math.min(N, n));
    wrap.querySelector('[data-pinfo]').textContent = `Seite ${previewPage} von ${N}`;
    wrap.querySelector('[data-pp]').disabled = previewPage <= 1;
    wrap.querySelector('[data-pn]').disabled = previewPage >= N;
    wrap.querySelector('[data-settarget]').disabled = !(sel >= 0 && list[sel] && list[sel].page !== previewPage);
    const seq = ++previewSeq;
    const page = await pdf.getPage(previewPage);
    const vp = page.getViewport({ scale: 1, rotation: page.rotate });
    const avail = Math.min(prevBox.parentElement.clientWidth - 36 || 300, 420);
    const sc = Math.min(avail / vp.width, (window.matchMedia('(max-width: 720px)').matches ? 300 : 520) / vp.height);
    const c = await renderPage(page, { scale: sc, dpr: Math.min(2, window.devicePixelRatio || 1) });
    if (!alive || seq !== previewSeq) { c.width = c.height = 0; return; }
    c.style.width = `${Math.round(vp.width * sc)}px`; c.style.height = `${Math.round(vp.height * sc)}px`;
    prevBox.innerHTML = '';
    prevBox.appendChild(c);
    const it = list[sel];
    if (it && it.page === previewPage && it.top != null) {
      const [, y] = vp.convertToViewportPoint(0, it.top);
      const mk = h('<div class="bm-mark"></div>');
      mk.style.top = `${Math.max(0, y * sc)}px`;
      prevBox.appendChild(mk);
    }
  }
  wrap.querySelector('[data-pp]').addEventListener('click', () => preview(previewPage - 1));
  wrap.querySelector('[data-pn]').addEventListener('click', () => preview(previewPage + 1));
  wrap.querySelector('[data-settarget]').addEventListener('click', () => {
    if (sel < 0) return;
    list[sel].page = previewPage; list[sel].top = null;
    render(); preview(previewPage);
  });

  async function dialog({ title = '', page = previewPage }, heading) {
    const r = await openDialog({
      title: heading,
      body: `<label class="field"><span class="field-label">Titel</span><input class="input" name="t" value="${esc(title)}" maxlength="200" autofocus></label>
        <label class="field"><span class="field-label">Zielseite (1–${N})</span><input class="input" type="number" name="p" min="1" max="${N}" value="${page}" inputmode="numeric"></label>`,
      actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'OK', value: 'ok', kind: 'btn-primary', default: true }],
      validate: (v, dlg) => {
        if (v !== 'ok') return true;
        if (!dlg.querySelector('[name=t]').value.trim()) { toast('Bitte gib einen Titel ein.', 'error'); return false; }
        const p = +dlg.querySelector('[name=p]').value;
        if (!(p >= 1 && p <= N)) { toast(`Die Seite muss zwischen 1 und ${N} liegen.`, 'error'); return false; }
        return true;
      },
      onMount: dlg => ({ collect: () => ({ title: dlg.querySelector('[name=t]').value.trim(), page: Math.round(+dlg.querySelector('[name=p]').value) }) }),
    });
    return r.value === 'ok' ? r.data : null;
  }
  async function edit(i) {
    const it = list[i];
    const d = await dialog(it, 'Lesezeichen bearbeiten');
    if (!d) return;
    if (d.page !== it.page) it.top = null;
    Object.assign(it, d);
    render(); preview(it.page); focusSel();
  }
  wrap.querySelector('[data-add]').addEventListener('click', async () => {
    const d = await dialog({ title: '', page: previewPage }, 'Neues Lesezeichen');
    if (!d) return;
    const at = sel >= 0 ? subtreeEnd(sel) : list.length;
    const level = sel >= 0 ? list[sel].level : 0;
    list.splice(at, 0, { title: d.title, page: d.page, top: null, level });
    sel = at;
    render(); preview(d.page);
  });
  wrap.querySelector('[data-gen]').addEventListener('click', async () => {
    if (list.length && !(await confirmDialog('Aus Überschriften erzeugen', 'Die vorhandenen Lesezeichen werden durch die erkannten Überschriften ersetzt.', { okLabel: 'Ersetzen' }))) return;
    const prog = progress('Suche Überschriften …');
    try {
      const gen = await outlineFromHeadings(pdf, (i, n) => prog.set(`Suche Überschriften … ${i}/${n}`));
      if (!gen.length) { toast('Keine Überschriften erkannt (z. B. weil alles gleich groß gesetzt ist).', 'info', { timeout: 4500 }); return; }
      list = gen; sel = 0;
      render(); preview(list[0].page);
      toast(`${gen.length} Lesezeichen aus Überschriften erzeugt.`, 'success');
    } catch (e) { errorToast(e, 'Überschriften konnten nicht erkannt werden.'); }
    finally { prog.done(); }
  });

  function act(a) {
    if (sel < 0 || sel >= list.length) return;
    const end = subtreeEnd(sel);
    const block = list.slice(sel, end);
    if (a === 'del') {
      const kids = block.length - 1;
      list.splice(sel, 1);
      // children move up one level
      for (let k = sel; k < sel + kids; k++) list[k].level = Math.max(0, list[k].level - 1);
      sel = Math.min(sel, list.length - 1);
    } else if (a === 'up' && sel > 0) {
      let p = sel - 1;
      while (p > 0 && list[p].level > list[sel].level) p--;
      list.splice(sel, block.length);
      list.splice(p, 0, ...block);
      const lvlFix = p > 0 ? Math.min(block[0].level, list[p - 1].level + 1) : 0;
      const d = block[0].level - lvlFix;
      block.forEach(b => { b.level -= d; });
      sel = p;
    } else if (a === 'down' && end < list.length) {
      const nextEnd = subtreeEnd(end);
      const next = list.slice(end, nextEnd);
      list.splice(sel, nextEnd - sel, ...next, ...block);
      sel = sel + next.length;
    } else if (a === 'in' && sel > 0 && list[sel].level <= list[sel - 1].level) block.forEach(b => { b.level++; });
    else if (a === 'out' && list[sel].level > 0) block.forEach(b => { b.level--; });
    else if (a === 'edit') { edit(sel); return; }
    render();
    if (list[sel]) preview(list[sel].page);
  }
  wrap.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => act(b.dataset.act)));

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    const prog = progress('Speichere Lesezeichen …');
    try {
      const PDFLib = await loadPdfLib();
      const pdfDoc = await loadEditable(bytes, doc.name, { key: docId });
      writeOutline(PDFLib, pdfDoc, list);
      const out = await saveDoc(pdfDoc);
      const res = await saveResult(out, `${baseName(doc.name)} (Lesezeichen).pdf`);
      saved = JSON.stringify(list);
      resultBox.innerHTML = '';
      resultBox.appendChild(resultCard(res, { from: docId, title: 'Lesezeichen gespeichert', note: `${list.length} Einträge` }));
      resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      toast('Lesezeichen gespeichert.', 'success');
    } catch (e) { errorToast(e, 'Speichern fehlgeschlagen.'); }
    finally { prog.done(); render(); }
  });

  guardLeave(screen, () => JSON.stringify(list) !== saved);
  render();
  preview(list[0] ? list[0].page : 1);
  void original;
  return () => { alive = false; pdf.destroy(); };
}
