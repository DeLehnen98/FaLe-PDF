// PDF fixtures for the web tool tests (pdf-lib from the global npm tools).
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const require = createRequire('/opt/npm-tools/node_modules/');
const { PDFDocument, StandardFonts, rgb, PDFName, PDFString } = require('pdf-lib');
const OUT = new URL('./fixtures/', import.meta.url).pathname;

async function textPdf(file, n, word) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= n; i++) {
    const p = doc.addPage([595.28, 841.89]);
    p.drawText(`${word} Seite ${i}`, { x: 72, y: 760, size: 28, font, color: rgb(0.1, 0.1, 0.3) });
    p.drawText('Lorem ipsum dolor sit amet, consectetur adipiscing elit.', { x: 72, y: 720, size: 12, font });
    p.drawRectangle({ x: 72, y: 400, width: 200, height: 100, color: rgb(0.2, 0.6, 0.5) });
    if (i === 1) {
      const link = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [72, 750, 300, 790], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://fale.network/') } });
      p.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(link)]));
    }
  }
  doc.setTitle(word);
  writeFileSync(OUT + file, await doc.save());
}

async function formPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([595.28, 841.89]);
  p.drawText('Formular', { x: 72, y: 760, size: 24, font });
  const f = doc.getForm().createTextField('Name');
  f.setText('Ada');
  f.addToPage(p, { x: 72, y: 600, width: 200, height: 30 });
  writeFileSync(OUT + 'form.pdf', await doc.save());
}

async function photoPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const jpg = await doc.embedJpg(readFileSync(OUT + '_big_photo.jpg'));
  const jpgGray = await doc.embedJpg(readFileSync(OUT + '_gray_photo.jpg'));
  const png = await doc.embedPng(readFileSync(OUT + 'alpha.png'));
  const flat = await doc.embedPng(readFileSync(OUT + '_flat_photo.png'));
  for (let i = 1; i <= 3; i++) {
    const p = doc.addPage([595.28, 841.89]);
    p.drawText(`Fotoseite ${i}`, { x: 72, y: 780, size: 24, font });
    p.drawImage(i === 2 ? jpgGray : jpg, { x: 72, y: 420, width: 288, height: 216 }); // 4 x 3 in → 2400 px = 600 dpi
    p.drawImage(png, { x: 380, y: 420, width: 144, height: 108 });
    if (i === 3) p.drawImage(flat, { x: 72, y: 120, width: 288, height: 216 });
  }
  writeFileSync(OUT + 'photos.pdf', await doc.save());
}

await textPdf('text3.pdf', 3, 'Alpha');
await textPdf('text5.pdf', 5, 'Beta');
await formPdf();
await photoPdf();
console.log('pdf fixtures written');
