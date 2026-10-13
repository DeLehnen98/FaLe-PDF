// Tool: PDF → Word (.docx). "Bearbeitbar" rebuilds paragraphs/headings/bold from the text layout;
// "Layout exakt" places every page as an image. Pages without text (scans) become images too.
import { icon } from '../icons.js';
import { h, esc, toast, errorToast, progress, baseName } from '../ui.js';
import { loadPdf, renderPage, canvasToBlob } from '../pdfcore.js';
import { openToolDoc, parseRange, fileResultCard, loadDocxLib, tick, proBadge, updateFoot } from './common.js';
import { analysePage, bodySize, paragraphs } from './pdfstruct.js';

const TW = 20; // twips per pt
const PX = 96 / 72; // docx image sizes are in px @96 dpi

export async function mount(screen, { docId }) {
  const ctx = await openToolDoc(screen, docId, 'PDF zu Word');
  if (!ctx) return;
  const { doc, bytes } = ctx;
  const wrap = h(`<div class="screen-inner pt-narrow">
    <div class="card intro"><span class="tile-ic">${icon('word')}</span><div><strong>${esc(doc.name)}</strong>
      <p>Wandelt die PDF in ein Word-Dokument (.docx) um – direkt auf deinem Gerät. ${proBadge()}</p></div></div>
    <div class="option-grid" role="radiogroup" aria-label="Umwandlung">
      <label class="radio-card"><input type="radio" name="mode" value="text" checked><span><strong>Bearbeitbarer Text</strong>
        <span>Absätze, Überschriften, Fett/Kursiv und Seitenumbrüche werden nachgebaut. Seiten ohne Text (Scans) werden als Bild eingefügt.</span></span></label>
      <label class="radio-card"><input type="radio" name="mode" value="exact"><span><strong>Layout exakt</strong>
        <span>Jede Seite als hochauflösendes Bild – sieht genau aus wie das Original, der Text ist aber nicht bearbeitbar.</span></span></label>
    </div>
    <div class="card card-pad" style="margin-top:16px">
      <label class="field" style="margin:0"><span class="field-label">Seiten (leer = alle ${doc.pages})</span><input class="input" data-range placeholder="z. B. 1-3, 5"></label>
    </div>
    <div data-result></div></div>`);
  screen.body.appendChild(wrap);
  const btn = h(`<button class="btn btn-primary" type="button">${icon('word')} In Word umwandeln</button>`);
  updateFoot(screen, [btn]);
  const resultBox = wrap.querySelector('[data-result]');

  btn.addEventListener('click', async () => {
    const mode = wrap.querySelector('input[name=mode]:checked').value;
    btn.disabled = true;
    const prog = progress('Lese PDF …');
    let pdf = null;
    try {
      const docxLib = await loadDocxLib();
      ({ pdf } = await loadPdf(bytes.slice(), { name: doc.name, key: docId }));
      const nums = parseRange(wrap.querySelector('[data-range]').value, pdf.numPages);
      if (!nums || !nums.length) throw Object.assign(new Error('range'), { userMessage: 'Bitte gib einen gültigen Seitenbereich ein, z. B. 1-3, 5.' });
      const blob = mode === 'exact'
        ? await buildExact(docxLib, pdf, nums, prog)
        : await buildText(docxLib, pdf, nums, prog, baseName(doc.name));
      const name = `${baseName(doc.name)}.docx`;
      resultBox.innerHTML = '';
      resultBox.appendChild(fileResultCard(blob, name, { title: 'Word-Dokument erstellt', iconName: 'word', note: `${nums.length} Seite${nums.length === 1 ? '' : 'n'}`, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      toast('Word-Dokument ist fertig.', 'success');
    } catch (e) { errorToast(e, 'Umwandlung fehlgeschlagen.'); }
    finally { prog.done(); btn.disabled = false; if (pdf) pdf.destroy(); }
  });
}

async function pageImage(page, dpi = 150, quality = 0.88) {
  const canvas = await renderPage(page, { scale: dpi / 72 });
  const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
  canvas.width = canvas.height = 0;
  return new Uint8Array(await blob.arrayBuffer());
}

async function buildExact(D, pdf, nums, prog) {
  const sections = [];
  for (let k = 0; k < nums.length; k++) {
    prog.set(`Seite ${k + 1} von ${nums.length} …`);
    const page = await pdf.getPage(nums[k]);
    const vp = page.getViewport({ scale: 1, rotation: page.rotate });
    const data = await pageImage(page, 170, 0.9);
    page.cleanup();
    sections.push({
      properties: { page: { size: { width: Math.round(vp.width * TW), height: Math.round(vp.height * TW) }, margin: { top: 0, right: 0, bottom: 0, left: 0, header: 0, footer: 0 } } },
      children: [new D.Paragraph({
        spacing: { before: 0, after: 0, line: 240 },
        children: [new D.ImageRun({ type: 'jpg', data, transformation: { width: Math.floor(vp.width * PX) - 1, height: Math.floor(vp.height * PX) - 2 } })],
      })],
    });
    await tick();
  }
  prog.set('Erstelle Word-Datei …');
  return D.Packer.toBlob(new D.Document({ creator: 'FaLe PDF', sections }));
}

async function buildText(D, pdf, nums, prog, title) {
  const pages = [];
  for (let k = 0; k < nums.length; k++) {
    prog.set(`Analysiere Seite ${k + 1} von ${nums.length} …`);
    const page = await pdf.getPage(nums[k]);
    const a = await analysePage(page);
    a.page = page;
    pages.push(a);
    if (k % 4 === 3) await tick();
  }
  const body = bodySize(pages);
  const first = pages[0];
  const allLines = pages.flatMap(p => p.lines);
  const minX = allLines.length ? Math.min(...allLines.map(l => l.x0)) : 72;
  const margin = Math.max(36, Math.min(108, minX));
  const contentW = first.width - margin * 2;
  const children = [];
  const HL = [null, D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_2, D.HeadingLevel.HEADING_3];
  const AL = { left: D.AlignmentType.LEFT, center: D.AlignmentType.CENTER, right: D.AlignmentType.RIGHT };
  let stats = { paras: 0, heads: 0, images: 0 };
  for (let k = 0; k < pages.length; k++) {
    const p = pages[k];
    const breakBefore = k > 0;
    if (p.chars < 15) {
      // scanned / image-only page → embed it as a picture
      prog.set(`Seite ${k + 1}: Bild wird eingefügt …`);
      const data = await pageImage(p.page, 150, 0.85);
      const vp = p.page.getViewport({ scale: 1, rotation: p.page.rotate });
      const maxW = contentW, maxH = first.height - margin * 2 - 20;
      const f = Math.min(maxW / vp.width, maxH / vp.height);
      children.push(new D.Paragraph({
        pageBreakBefore: breakBefore, alignment: D.AlignmentType.CENTER,
        children: [new D.ImageRun({ type: 'jpg', data, transformation: { width: Math.round(vp.width * f * PX), height: Math.round(vp.height * f * PX) } })],
      }));
      stats.images++;
    } else {
      const paras = paragraphs(p, body);
      paras.forEach((para, i) => {
        const runs = para.runs.map(r => new D.TextRun({
          text: r.text, bold: para.heading ? undefined : r.bold || undefined, italics: r.italic || undefined,
          size: para.heading ? undefined : Math.max(12, Math.round(r.size * 2)), font: para.heading ? undefined : r.family,
        }));
        children.push(new D.Paragraph({
          children: runs,
          heading: HL[para.heading] || undefined,
          alignment: AL[para.align],
          pageBreakBefore: breakBefore && i === 0,
          indent: para.indent > 6 && para.align === 'left' ? { left: Math.round(Math.min(para.indent, contentW / 2) * TW) } : undefined,
          spacing: { after: para.heading ? 120 : Math.round(Math.min(14, body * 0.6) * TW) },
        }));
        stats.paras++;
        if (para.heading) stats.heads++;
      });
    }
    p.page.cleanup();
    await tick();
  }
  if (!children.length) children.push(new D.Paragraph({ children: [new D.TextRun('')] }));
  prog.set('Erstelle Word-Datei …');
  const docx = new D.Document({
    creator: 'FaLe PDF', title,
    styles: {
      default: { document: { run: { font: 'Arial', size: Math.round(body * 2) } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: Math.round(body * 2 * 1.8), bold: true, font: 'Arial', color: '1F2340' }, paragraph: { spacing: { before: 240, after: 120 } } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: Math.round(body * 2 * 1.4), bold: true, font: 'Arial', color: '1F2340' }, paragraph: { spacing: { before: 200, after: 100 } } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: Math.round(body * 2 * 1.15), bold: true, font: 'Arial', color: '1F2340' }, paragraph: { spacing: { before: 160, after: 80 } } },
      ],
    },
    sections: [{
      properties: { page: { size: { width: Math.round(first.width * TW), height: Math.round(first.height * TW) }, margin: { top: Math.round(margin * TW), right: Math.round(margin * TW), bottom: Math.round(margin * TW), left: Math.round(margin * TW) } } },
      children,
    }],
  });
  return D.Packer.toBlob(docx);
}
