// Handzettel & Notizenseiten als PDF (2, 3 oder 6 Folien pro Seite, oder eine Folie mit Notizen).
import { loadPdfLib } from '../pdflib.js';
import { fontKit, safeText, needsUnicodeDeep, rgbOf, wrapPlain } from './pdftext.js';
import { slideCanvas } from './slide-render.js';

export async function handoutPdf(pres, { title = 'Präsentation', layout = '3', onProgress } = {}) {
  const PDFLib = await loadPdfLib();
  const pdf = await PDFLib.PDFDocument.create();
  pdf.setTitle(`${title} – Handzettel`); pdf.setProducer('FaLe PDF'); pdf.setCreator('FaLe PDF');
  const fk = await fontKit(pdf);
  const reg = fk.sync('sans', false, false);
  if (needsUnicodeDeep([title, pres.slides])) await fk.ensureUnicode();
  const PW = 595.28, PH = 841.89, M = 40;
  const ink = rgbOf(PDFLib, '#15172F'), grey = rgbOf(PDFLib, '#8086A6'), line = rgbOf(PDFLib, '#C9CCDA');
  const ratio = pres.h / pres.w;
  const n = pres.slides.length;
  const per = layout === 'notes' ? 1 : +layout || 3;
  const pages = Math.ceil(n / per);
  const images = [];
  for (let i = 0; i < n; i++) {
    const { canvas } = await slideCanvas(pres, pres.slides[i], layout === '6' ? 700 : 1100);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.86));
    images.push(await pdf.embedJpg(new Uint8Array(await blob.arrayBuffer())));
    canvas.width = canvas.height = 0;
    onProgress && onProgress(((i + 1) / n) * 0.8);
  }
  const frame = (page, img, x, y, w, hgt, num) => {
    page.drawImage(img, { x, y, width: w, height: hgt });
    page.drawRectangle({ x, y, width: w, height: hgt, borderColor: line, borderWidth: 0.6 });
    page.drawText(String(num), { x: x - 4 - reg.widthOfTextAtSize(String(num), 8), y: y + hgt - 8, size: 8, font: reg, color: grey });
  };
  const notesText = (page, text, x, yTop, w, maxH, size = 10) => {
    const f = fk.pick(text);
    const lines = wrapPlain(safeText(text, f), f, size, w);
    let y = yTop - size;
    for (const ln of lines) { if (yTop - y > maxH) break; page.drawText(ln, { x, y, size, font: f, color: ink }); y -= size * 1.4; }
  };
  for (let p = 0; p < pages; p++) {
    const page = pdf.addPage([PW, PH]);
    const tf = fk.pick(title, 'sans', true);
    page.drawText(safeText(title, tf), { x: M, y: PH - M + 12, size: 9, font: tf, color: grey });
    const pn = `${p + 1} / ${pages}`;
    page.drawText(pn, { x: PW - M - reg.widthOfTextAtSize(pn, 9), y: M - 22, size: 9, font: reg, color: grey });
    const slice = pres.slides.map((s, i) => i).slice(p * per, p * per + per);
    if (layout === '2') {
      const w = PW - 2 * M - 40, hgt = w * ratio, gap = (PH - 2 * M - 2 * hgt) / 3;
      slice.forEach((i, k) => frame(page, images[i], M + 20, PH - M - gap - hgt - k * (hgt + gap), w, hgt, i + 1));
    } else if (layout === '6') {
      const w = (PW - 2 * M - 30) / 2, hgt = w * ratio, gap = (PH - 2 * M - 3 * hgt) / 4;
      slice.forEach((i, k) => frame(page, images[i], M + 10 + (k % 2) * (w + 10), PH - M - gap - hgt - Math.floor(k / 2) * (hgt + gap), w, hgt, i + 1));
    } else if (layout === 'notes') {
      const i = slice[0];
      const w = PW - 2 * M - 20, hgt = w * ratio;
      frame(page, images[i], M + 10, PH - M - 10 - hgt, w, hgt, i + 1);
      const top = PH - M - 10 - hgt - 26;
      page.drawText('Notizen', { x: M + 10, y: top + 6, size: 11, font: bold, color: ink });
      const nt = pres.slides[i].notes;
      if (nt) notesText(page, nt, M + 10, top - 6, w, top - M - 10, 11);
      else for (let y = top - 22; y > M; y -= 24) page.drawLine({ start: { x: M + 10, y }, end: { x: PW - M - 10, y }, thickness: 0.5, color: line });
    } else {
      const w = (PW - 2 * M) * 0.48, hgt = w * ratio, rowH = (PH - 2 * M) / 3;
      slice.forEach((i, k) => {
        const y0 = PH - M - k * rowH - (rowH - hgt) / 2 - hgt;
        frame(page, images[i], M + 12, y0, w, hgt, i + 1);
        const nx = M + 12 + w + 18, nw = PW - M - nx;
        const nt = pres.slides[i].notes;
        if (nt) notesText(page, nt, nx, y0 + hgt, nw, hgt, 9.5);
        else for (let y = y0 + hgt - 14; y > y0; y -= 18) page.drawLine({ start: { x: nx, y }, end: { x: PW - M, y }, thickness: 0.5, color: line });
      });
    }
    onProgress && onProgress(0.8 + ((p + 1) / pages) * 0.2);
  }
  return pdf.save({ useObjectStreams: true });
}
