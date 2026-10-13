// Tool: compress — lossless re-save (object streams) or strong (re-render pages as JPEG).
import * as db from '../db.js';
import { icon } from '../icons.js';
import { h, esc, toast, errorToast, progress, formatSize, baseName } from '../ui.js';
import { resultCard } from '../components.js';
import { getDocBytes, saveResult } from '../library.js';
import { loadPdf, renderPage, canvasToBlob } from '../pdfcore.js';

const trackStat = (e, n = 1) => { import('../extras/stats.js').then(m => m.track(e, n)).catch(() => {}); };
import { loadEditable, loadPdfLib, saveDoc } from '../pdflib.js';

/**
 * Compress a PDF (pure, reusable by the batch tool).
 * @param {Uint8Array} bytes
 * @param {{mode?: 'lossless'|'strong', quality?: number, dpi?: number, name?: string, key?: string, onProgress?: (text:string) => void}} [opts]
 * @returns {Promise<Uint8Array>}
 */
export async function compressPdf(bytes, { mode = 'lossless', quality = 0.6, dpi = 130, name = 'Dokument', key = null, onProgress = null } = {}) {
  if (mode === 'lossless') {
    const pdfDoc = await loadEditable(bytes, name, { key });
    recompressStreams(pdfDoc, await loadPdfLib());
    return saveDoc(pdfDoc);
  }
  const { pdf } = await loadPdf(bytes.slice(), { name, key });
  try {
    const { PDFDocument } = await loadPdfLib();
    const outDoc = await PDFDocument.create();
    for (let i = 1; i <= pdf.numPages; i++) {
      if (onProgress) onProgress(`Komprimiere Seite ${i}/${pdf.numPages} …`);
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1, rotation: page.rotate });
      const canvas = await renderPage(page, { scale: dpi / 72 });
      const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
      canvas.width = canvas.height = 0;
      const img = await outDoc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      const p = outDoc.addPage([vp.width, vp.height]);
      p.drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
      page.cleanup();
    }
    outDoc.setTitle(baseName(name));
    return await saveDoc(outDoc);
  } finally { pdf.destroy(); }
}

export async function mount(screen, { docId }) {
  const doc = await db.getDoc(docId);
  if (!doc) { screen.body.innerHTML = '<p class="panel-empty">Dokument nicht gefunden.</p>'; return; }
  screen.setTitle('Komprimieren', doc.name);

  const wrap = h(`<div class="screen-inner">
    <div class="card intro"><span class="tile-ic">${icon('compress')}</span><div><strong>${esc(doc.name)}</strong>
      <p>Aktuelle Größe: <b>${formatSize(doc.size)}</b> · ${doc.pages} Seite${doc.pages === 1 ? '' : 'n'}</p></div></div>
    <div class="option-grid" role="radiogroup" aria-label="Komprimierungsart">
      <label class="radio-card"><input type="radio" name="mode" value="lossless" checked><span><strong>Verlustfrei</strong>
        <span>Optimiert die Dateistruktur und packt unkomprimierte Daten. Text, Links und Formulare bleiben unverändert.</span></span></label>
      <label class="radio-card"><input type="radio" name="mode" value="strong"><span><strong>Stark</strong>
        <span>Wandelt jede Seite in ein JPEG-Bild um. Ideal für Scans und Fotos – deutlich kleinere Dateien.</span></span></label>
    </div>
    <div class="card card-pad" data-strong hidden style="margin-top:16px">
      <div class="notice" style="margin-top:0">${icon('info')}<span>Achtung: Bei „Stark“ wird Text zu Bild – er ist danach nicht mehr markierbar oder durchsuchbar. Links und Formularfelder gehen verloren.</span></div>
      <label class="field"><span class="field-label">Bildqualität: <b data-qv>60</b> %</span><input type="range" min="25" max="90" step="5" value="60" data-q aria-label="Bildqualität"></label>
      <label class="field"><span class="field-label">Auflösung</span>
        <select class="select" data-dpi aria-label="Auflösung">
          <option value="72">72 dpi – sehr klein</option><option value="100">100 dpi – Bildschirm</option>
          <option value="130" selected>130 dpi – ausgewogen</option><option value="150">150 dpi – Druck (einfach)</option><option value="200">200 dpi – Druck (gut)</option>
        </select></label>
    </div>
    <div data-out></div></div>`);
  screen.body.appendChild(wrap);
  const strongBox = wrap.querySelector('[data-strong]');
  const out = wrap.querySelector('[data-out]');
  const q = wrap.querySelector('[data-q]');
  q.addEventListener('input', () => { wrap.querySelector('[data-qv]').textContent = q.value; });
  wrap.querySelectorAll('input[name="mode"]').forEach(r => r.addEventListener('change', () => {
    strongBox.hidden = wrap.querySelector('input[name="mode"]:checked').value !== 'strong';
  }));
  if (doc.encrypted) {
    wrap.querySelector('.option-grid').insertAdjacentHTML('afterend', `<div class="notice">${icon('lock')}<span>Passwortgeschützt: Das Ergebnis wird ohne Passwort gespeichert. Mit „Passwort festlegen“ kannst du es wieder schützen.</span></div>`);
  }

  const btn = h(`<button class="btn btn-primary" type="button" data-run>${icon('compress')} Komprimieren</button>`);
  screen.setFoot([btn]);

  btn.addEventListener('click', async () => {
    const mode = wrap.querySelector('input[name="mode"]:checked').value;
    btn.disabled = true;
    const prog = progress('Komprimiere …');
    try {
      const bytes = await getDocBytes(docId);
      const result = await compressPdf(bytes, { mode, quality: +q.value / 100, dpi: +wrap.querySelector('[data-dpi]').value, name: doc.name, key: docId, onProgress: t => prog.set(t) });
      const before = doc.size, after = result.byteLength;
      const saving = Math.round((1 - after / before) * 100);
      out.innerHTML = '';
      const cmp = h(`<div class="card card-pad" style="margin-top:18px">
        <div class="compare"><div><div class="num">${formatSize(before)}</div><div class="lbl">Vorher</div></div>
        <div class="arrow">${icon('arrowRight')}</div><div><div class="num">${formatSize(after)}</div><div class="lbl">Nachher</div></div></div>
        <div style="text-align:center">${saving > 0 ? `<span class="saving-pill">${saving} % kleiner</span>` : '<span class="muted">Keine Verkleinerung möglich – die Datei ist bereits gut optimiert.</span>'}</div></div>`);
      out.appendChild(cmp);
      if (after < before) {
        const res = await saveResult(result, `${baseName(doc.name)} (komprimiert).pdf`);
        trackStat('bytes_saved', before - after);
        out.appendChild(resultCard(res, { title: 'Komprimiert' }));
        toast(`Datei um ${saving} % verkleinert.`, 'success');
      } else {
        toast('Die Datei konnte nicht weiter verkleinert werden.', 'info');
      }
      out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) { errorToast(e, 'Komprimieren fehlgeschlagen.'); }
    finally { prog.done(); btn.disabled = false; }
  });

}

/** Lossless: Flate-compress streams that are stored without any filter. */
function recompressStreams(pdfDoc, PDFLib) {
  const { PDFRawStream, PDFName } = PDFLib;
  const ctx = pdfDoc.context;
  const F = PDFName.of('Filter'), L = PDFName.of('Length'), T = PDFName.of('Type'), DP = PDFName.of('DecodeParms');
  let n = 0;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || obj.dict.get(F)) continue;
    const type = obj.dict.get(T);
    const t = type ? type.toString() : '';
    if (t === '/XRef' || t === '/ObjStm' || t === '/Metadata') continue;
    const raw = obj.getContents();
    if (raw.length < 128) continue;
    const ns = ctx.flateStream(raw);
    if (ns.getContentsSize() >= raw.length) continue;
    for (const [k, v] of obj.dict.entries()) if (k !== L && k !== F && k !== DP) ns.dict.set(k, v);
    ctx.assign(ref, ns);
    n++;
  }
  return n;
}
