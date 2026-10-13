// Tool: export pages as PNG/JPG (ZIP) and full text as .txt
import * as db from '../db.js';
import { icon } from '../icons.js';
import { h, esc, toast, errorToast, progress, downloadBlob, baseName, formatSize } from '../ui.js';
import { getDocBytes } from '../library.js';
import { loadPdf, renderPage, canvasToBlob, extractAllText } from '../pdfcore.js';
import { createZip } from '../zip.js';

/** Parse "1-3, 5" into sorted unique page numbers within [1, max]. */
export function parseRange(str, max) {
  const s = String(str || '').trim();
  if (!s) return Array.from({ length: max }, (_, i) => i + 1);
  const out = new Set();
  for (const part of s.split(/[,;]+/)) {
    const p = part.trim();
    if (!p) continue;
    const m = p.match(/^(\d+)\s*[-–]\s*(\d+)?$/);
    if (m) {
      const a = +m[1], b = m[2] ? +m[2] : max;
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= max) out.add(i);
    } else if (/^\d+$/.test(p)) {
      const n = +p;
      if (n >= 1 && n <= max) out.add(n);
    } else return null;
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * Render pages to image files (pure, reusable by the batch tool).
 * @returns {Promise<Array<{name: string, data: Blob}>>}
 */
export async function pdfToImages(bytes, { fmt = 'png', dpi = 150, pages = null, name = 'Dokument', key = null, onProgress = null } = {}) {
  const { pdf } = await loadPdf(bytes.slice(), { name, key });
  try {
    const list = pages || Array.from({ length: pdf.numPages }, (_, i) => i + 1);
    const files = [];
    const width = String(pdf.numPages).length;
    for (let k = 0; k < list.length; k++) {
      const n = list[k];
      if (onProgress) onProgress(k + 1, list.length);
      const page = await pdf.getPage(n);
      const canvas = await renderPage(page, { scale: dpi / 72 });
      const blob = await canvasToBlob(canvas, fmt === 'png' ? 'image/png' : 'image/jpeg', 0.9);
      canvas.width = canvas.height = 0;
      files.push({ name: `${baseName(name)}-Seite-${String(n).padStart(width, '0')}.${fmt}`, data: blob });
      page.cleanup();
    }
    return files;
  } finally { pdf.destroy(); }
}

export async function mount(screen, { docId }) {
  const doc = await db.getDoc(docId);
  if (!doc) { screen.body.innerHTML = '<p class="panel-empty">Dokument nicht gefunden.</p>'; return; }
  screen.setTitle('Exportieren', doc.name);
  const wrap = h(`<div class="screen-inner">
    <div class="card intro"><span class="tile-ic">${icon('export')}</span><div><strong>${esc(doc.name)}</strong><p>${doc.pages} Seite${doc.pages === 1 ? '' : 'n'} · ${formatSize(doc.size)}</p></div></div>
    <h2 class="section-title">Seiten als Bilder</h2>
    <div class="card card-pad">
      <div class="option-grid">
        <label class="field"><span class="field-label">Format</span>
          <select class="select" data-fmt aria-label="Bildformat"><option value="png">PNG – verlustfrei</option><option value="jpg">JPG – kleinere Dateien</option></select></label>
        <label class="field"><span class="field-label">Auflösung</span>
          <select class="select" data-dpi aria-label="Auflösung"><option value="72">72 dpi</option><option value="150" selected>150 dpi</option><option value="300">300 dpi</option></select></label>
        <label class="field"><span class="field-label">Seiten (leer = alle)</span>
          <input class="input" data-range placeholder="z. B. 1-3, 5" inputmode="numeric" aria-label="Seitenbereich"></label>
      </div>
      <button class="btn btn-primary" type="button" data-img>${icon('image')} Als Bilder exportieren (ZIP)</button>
    </div>
    <h2 class="section-title">Text</h2>
    <div class="card card-pad" style="display:flex;justify-content:space-between;gap:14px;align-items:center;flex-wrap:wrap">
      <span class="muted">Speichert den gesamten Text des Dokuments als .txt-Datei – Seite für Seite.</span>
      <button class="btn btn-soft" type="button" data-txt>${icon('text')} Text exportieren (.txt)</button>
    </div></div>`);
  screen.body.appendChild(wrap);
  screen.setFoot([]);

  wrap.querySelector('[data-img]').addEventListener('click', async e => {
    const btn = e.currentTarget;
    const pagesWanted = parseRange(wrap.querySelector('[data-range]').value, doc.pages);
    if (!pagesWanted || !pagesWanted.length) { toast('Bitte gib einen gültigen Seitenbereich ein, z. B. 1-3, 5.', 'error'); return; }
    const fmt = wrap.querySelector('[data-fmt]').value;
    const dpi = +wrap.querySelector('[data-dpi]').value;
    btn.disabled = true;
    const prog = progress('Exportiere …');
    try {
      const files = await pdfToImages(await getDocBytes(docId), { fmt, dpi, pages: pagesWanted, name: doc.name, key: docId, onProgress: (k, n) => prog.set(`Exportiere Seite ${k}/${n} …`) });
      prog.set('Erstelle ZIP …');
      const zip = await createZip(files);
      downloadBlob(zip, `${baseName(doc.name)} – Bilder.zip`);
      toast(`${files.length} Bild${files.length === 1 ? '' : 'er'} exportiert (${formatSize(zip.size)}).`, 'success');
    } catch (err) { errorToast(err, 'Export fehlgeschlagen.'); }
    finally { prog.done(); btn.disabled = false; }
  });

  wrap.querySelector('[data-txt]').addEventListener('click', async () => {
    const prog = progress('Lese Text …');
    try {
      let pages = await db.getText(docId);
      if (!pages) {
        const { pdf } = await loadPdf(await getDocBytes(docId), { name: doc.name, key: docId });
        try { pages = await extractAllText(pdf); } finally { pdf.destroy(); }
        db.putText(docId, pages).catch(() => {});
      }
      const hasText = pages.some(p => p && p.trim());
      const body = pages.map((t, i) => `===== Seite ${i + 1} =====\n${t || ''}`).join('\n\n');
      downloadBlob(new Blob(['﻿' + body + '\n'], { type: 'text/plain;charset=utf-8' }), `${baseName(doc.name)}.txt`);
      toast(hasText ? 'Text exportiert.' : 'Exportiert – das Dokument enthält aber keinen lesbaren Text (evtl. ein Scan).', hasText ? 'success' : 'info', { timeout: 5000 });
    } catch (err) { errorToast(err, 'Text-Export fehlgeschlagen.'); }
    finally { prog.done(); }
  });
}
