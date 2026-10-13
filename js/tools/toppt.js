// Tool: PDF → PowerPoint (.pptx): one slide per page as a high-resolution image,
// optional page text as speaker notes (keeps the content searchable).
import { icon } from '../icons.js';
import { h, esc, toast, errorToast, progress, baseName } from '../ui.js';
import { loadPdf, renderPage, canvasToBlob, pageText } from '../pdfcore.js';
import { openToolDoc, parseRange, fileResultCard, loadPptxLib, tick, bytesToBase64, proBadge, updateFoot } from './common.js';

export async function mount(screen, { docId }) {
  const ctx = await openToolDoc(screen, docId, 'PDF zu PowerPoint');
  if (!ctx) return;
  const { doc, bytes } = ctx;
  const wrap = h(`<div class="screen-inner pt-narrow">
    <div class="card intro"><span class="tile-ic">${icon('slides')}</span><div><strong>${esc(doc.name)}</strong>
      <p>Jede Seite wird zu einer Folie (.pptx) – ideal, um ein PDF zu präsentieren. ${proBadge()}</p></div></div>
    <div class="card card-pad">
      <div class="field"><span class="field-label">Folienformat</span>
        <div class="seg" role="group" aria-label="Folienformat">
          <button type="button" data-fmt="page" aria-pressed="true">Wie die Seite</button>
          <button type="button" data-fmt="16x9" aria-pressed="false">16:9</button>
          <button type="button" data-fmt="4x3" aria-pressed="false">4:3</button>
        </div></div>
      <label class="field"><span class="field-label">Bildqualität</span>
        <select class="select" data-dpi><option value="110">Kompakt (kleine Datei)</option><option value="160" selected>Standard</option><option value="230">Hoch (für Beamer und Druck)</option></select></label>
      <label class="check"><input type="checkbox" data-notes checked><span>Seitentext als Sprechernotizen übernehmen</span></label>
      <label class="field" style="margin:8px 0 0"><span class="field-label">Seiten (leer = alle ${doc.pages})</span><input class="input" data-range placeholder="z. B. 1-3, 5"></label>
    </div>
    <div data-result></div></div>`);
  screen.body.appendChild(wrap);
  let fmt = 'page';
  wrap.querySelectorAll('[data-fmt]').forEach(b => b.addEventListener('click', () => {
    fmt = b.dataset.fmt;
    wrap.querySelectorAll('[data-fmt]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  }));
  const btn = h(`<button class="btn btn-primary" type="button">${icon('slides')} In PowerPoint umwandeln</button>`);
  updateFoot(screen, [btn]);
  const resultBox = wrap.querySelector('[data-result]');

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const prog = progress('Bereite vor …');
    let pdf = null;
    try {
      const PptxGenJS = await loadPptxLib();
      ({ pdf } = await loadPdf(bytes.slice(), { name: doc.name, key: docId }));
      const nums = parseRange(wrap.querySelector('[data-range]').value, pdf.numPages);
      if (!nums || !nums.length) throw Object.assign(new Error('range'), { userMessage: 'Bitte gib einen gültigen Seitenbereich ein, z. B. 1-3, 5.' });
      const dpi = +wrap.querySelector('[data-dpi]').value;
      const notes = wrap.querySelector('[data-notes]').checked;
      const pptx = new PptxGenJS();
      pptx.author = 'FaLe PDF';
      pptx.title = baseName(doc.name);
      let W = 10, H = 5.625;
      if (fmt === '16x9') pptx.layout = 'LAYOUT_16x9';
      else if (fmt === '4x3') { pptx.layout = 'LAYOUT_4x3'; H = 7.5; }
      else {
        const p1 = await pdf.getPage(nums[0]);
        const vp = p1.getViewport({ scale: 1, rotation: p1.rotate });
        // keep the long side at 10 in (PowerPoint's usual width), within the allowed 1–56 in range
        if (vp.width >= vp.height) { W = 10; H = Math.max(1, 10 * vp.height / vp.width); } else { H = 10; W = Math.max(1, 10 * vp.width / vp.height); }
        pptx.defineLayout({ name: 'FALE_PDF', width: W, height: H });
        pptx.layout = 'FALE_PDF';
      }
      for (let k = 0; k < nums.length; k++) {
        prog.set(`Folie ${k + 1} von ${nums.length} …`);
        const page = await pdf.getPage(nums[k]);
        const vp = page.getViewport({ scale: 1, rotation: page.rotate });
        const canvas = await renderPage(page, { scale: dpi / 72 });
        const blob = await canvasToBlob(canvas, 'image/jpeg', 0.88);
        canvas.width = canvas.height = 0;
        const b64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
        const f = Math.min(W / vp.width, H / vp.height);
        const w = vp.width * f, hh = vp.height * f;
        const slide = pptx.addSlide();
        slide.background = { color: 'FFFFFF' };
        slide.addImage({ data: `image/jpeg;base64,${b64}`, x: (W - w) / 2, y: (H - hh) / 2, w, h: hh });
        if (notes) {
          const t = await pageText(page);
          if (t) slide.addNotes(t);
        }
        page.cleanup();
        await tick();
      }
      prog.set('Erstelle PowerPoint-Datei …');
      const out = await pptx.write({ outputType: 'blob' });
      const name = `${baseName(doc.name)}.pptx`;
      resultBox.innerHTML = '';
      resultBox.appendChild(fileResultCard(out, name, { title: 'Präsentation erstellt', iconName: 'slides', note: `${nums.length} Folie${nums.length === 1 ? '' : 'n'}`, type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }));
      resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      toast('Präsentation ist fertig.', 'success');
    } catch (e) { errorToast(e, 'Umwandlung fehlgeschlagen.'); }
    finally { prog.done(); btn.disabled = false; if (pdf) pdf.destroy(); }
  });
}
