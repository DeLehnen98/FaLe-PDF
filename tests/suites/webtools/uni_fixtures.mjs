// Fixtures for the Unicode tests (agent `uni`): two versions of a document in Polish/Greek/Cyrillic/Turkish.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const R = '/home/claude/FalePDF/';
globalThis.PDFLib = require(R + 'vendor/pdf-lib/pdf-lib.min.js');
const U = await import(R + 'js/office/unifont.js');
async function make(lines, file) {
  const doc = await PDFLib.PDFDocument.create();
  const f = U.uniPdfFont(doc, PDFLib, U.parseTtf(readFileSync(R + 'vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf')));
  const p = doc.addPage([595.28, 841.89]);
  lines.forEach((l, i) => p.drawText(l, { x: 60, y: 760 - i * 24, size: 14, font: f }));
  writeFileSync(new URL('fixtures/' + file, import.meta.url), await doc.save());
}
await make(['Vertrag zwischen Łukasz Kowalski-Müller und Ελληνικά', 'Ort: Gdańsk, Betrag 100 €'], 'uni_v1.pdf');
await make(['Vertrag zwischen Łukasz Kowalski-Müller und Привет Türkçe İğ', 'Ort: Gdańsk, Betrag 120 €'], 'uni_v2.pdf');
console.log('ok');
{ // form whose Unicode values have no appearance yet (NeedAppearances) – as left by many form fillers
  const doc = await PDFLib.PDFDocument.create();
  const f = U.uniPdfFont(doc, PDFLib, U.parseTtf(readFileSync(R + 'vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf')));
  const p = doc.addPage([595.28, 841.89]);
  p.drawText('Name:', { x: 60, y: 760, size: 12, font: await doc.embedFont(PDFLib.StandardFonts.Helvetica) });
  const form = doc.getForm();
  const vals = { name: 'Łukasz Kowalski-Müller', city: 'Ελληνικά Привет', note: 'Türkçe İğ €' };
  let y = 740;
  for (const [k, v] of Object.entries(vals)) {
    const t = form.createTextField(k); t.setText(v); t.addToPage(p, { x: 60, y, width: 400, height: 22, font: f }); y -= 40;
    for (const w of t.acroField.getWidgets()) w.dict.delete(PDFLib.PDFName.of('AP'));
  }
  form.acroForm.dict.set(PDFLib.PDFName.of('NeedAppearances'), PDFLib.PDFBool.True);
  writeFileSync(new URL('fixtures/uni_form_noap.pdf', import.meta.url), await doc.save({ updateFieldAppearances: false }));
}
console.log('form ok');
