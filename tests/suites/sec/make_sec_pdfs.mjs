// Malicious PDFs for test_xss.py (secdata/): JavaScript OpenAction, JavaScript / Launch / javascript:-URI
// link actions, an external link (confirm dialog), HTML in metadata / outline / annotation contents /
// rich text / form fields, and a CVE-2024-4367-style FontMatrix injection.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire('/opt/npm-tools/node_modules/x.js');
const { PDFDocument, PDFName, PDFString, PDFHexString, PDFArray, PDFNumber, StandardFonts, rgb } = require('pdf-lib');
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'secdata');
mkdirSync(OUT, { recursive: true });
const P = n => `<img src=x data-pwn="${n}" onerror="window.__pwned=${n}">`;

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
const page = doc.addPage([595, 842]);
page.drawText('FaLe Sicherheitstest – boesartige PDF', { x: 50, y: 790, size: 16, font });
page.drawText('Link (javascript:)', { x: 50, y: 705, size: 12, font, color: rgb(0, 0, 1) });
page.drawText('Link (https)', { x: 50, y: 655, size: 12, font, color: rgb(0, 0, 1) });
page.drawText('Link (JavaScript action)', { x: 50, y: 605, size: 12, font, color: rgb(0, 0, 1) });
page.drawText('Link (Launch)', { x: 50, y: 555, size: 12, font, color: rgb(0, 0, 1) });
doc.setTitle(P(601));
doc.setAuthor(P(602));
doc.setSubject(P(603));
doc.setKeywords([P(604)]);
const ctx = doc.context;
const action = o => ctx.obj(o);
const link = (rect, a) => ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], A: a }));
const annots = [
  link([45, 700, 260, 720], action({ Type: 'Action', S: 'URI', URI: PDFString.of('javascript:window.__pwned=610') })),
  link([45, 650, 260, 670], action({ Type: 'Action', S: 'URI', URI: PDFString.of('https://example.com/fale-sec-test') })),
  link([45, 600, 260, 620], action({ Type: 'Action', S: 'JavaScript', JS: PDFString.of('window.__pwned=611; app.alert(1)') })),
  link([45, 550, 260, 570], action({ Type: 'Action', S: 'Launch', F: PDFString.of('C:\\Windows\\System32\\calc.exe') })),
  ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Text', Rect: [300, 700, 320, 720], Contents: PDFString.of(P(612)), T: PDFString.of(P(613)), Open: true,
    RC: PDFString.of(`<?xml version="1.0"?><body xmlns="http://www.w3.org/1999/xhtml"><p onclick="window.__pwned=614">Rich ${P(615).replace(/"/g, "'")}</p><script>window.__pwned=616</script><a href="javascript:window.__pwned=617">x</a></body>`) })),
  ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'FreeText', Rect: [300, 600, 500, 640], Contents: PDFString.of(P(618)), DA: PDFString.of('/Helv 12 Tf 0 g') })),
];
page.node.set(PDFName.of('Annots'), ctx.obj(annots));
// OpenAction: JavaScript (pdf.js must never run it)
doc.catalog.set(PDFName.of('OpenAction'), action({ Type: 'Action', S: 'JavaScript', JS: PDFString.of('window.__pwned=620; this.print()') }));
doc.catalog.set(PDFName.of('Names'), ctx.obj({ JavaScript: ctx.obj({ Names: [PDFString.of('a'), action({ S: 'JavaScript', JS: PDFString.of('window.__pwned=621') })] }) }));
// AA (additional actions) on the page
page.node.set(PDFName.of('AA'), ctx.obj({ O: action({ S: 'JavaScript', JS: PDFString.of('window.__pwned=622') }) }));
// Outline: HTML title + javascript: URI, and a normal https item
const outlinesRef = ctx.nextRef();
const it1 = ctx.nextRef(), it2 = ctx.nextRef();
ctx.assign(it1, ctx.obj({ Title: PDFHexString.fromText(P(630)), Parent: outlinesRef, Next: it2, A: action({ S: 'URI', URI: PDFString.of('javascript:window.__pwned=631') }) }));
ctx.assign(it2, ctx.obj({ Title: PDFHexString.fromText('Externer Gliederungslink'), Parent: outlinesRef, Prev: it1, A: action({ S: 'URI', URI: PDFString.of('https://example.com/outline') }) }));
ctx.assign(outlinesRef, ctx.obj({ Type: 'Outlines', First: it1, Last: it2, Count: 2 }));
doc.catalog.set(PDFName.of('Outlines'), outlinesRef);
// Form field with HTML name + value
const form = doc.getForm();
const tf = form.createTextField('feld<img src=x onerror=alert(640)>');
tf.setText(`"><img src=x onerror="window.__pwned=641">`);
tf.addToPage(page, { x: 50, y: 450, width: 300, height: 24 });
const dd = form.createDropdown('auswahl');
dd.addOptions([P(642), 'normal']);
dd.addToPage(page, { x: 50, y: 400, width: 300, height: 24 });
writeFileSync(join(OUT, 'evil.pdf'), await doc.save({ useObjectStreams: false }));

// CVE-2024-4367-style: FontMatrix with a JavaScript string in a Type1 font dictionary
const d2 = await PDFDocument.create();
const p2 = d2.addPage([400, 300]);
const c2 = d2.context;
const fontDict = c2.register(c2.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding',
  FontMatrix: c2.obj([PDFNumber.of(0.001), PDFNumber.of(0), PDFNumber.of(0), PDFNumber.of(0.001), PDFNumber.of(0), PDFString.of('0); window.__pwned=650; //')]) }));
p2.node.set(PDFName.of('Resources'), c2.obj({ Font: c2.obj({ F9: fontDict }) }));
const content = c2.stream('BT /F9 24 Tf 40 150 Td (FontMatrix) Tj ET');
p2.node.set(PDFName.of('Contents'), c2.register(content));
writeFileSync(join(OUT, 'fontmatrix.pdf'), await d2.save({ useObjectStreams: false }));

// huge MediaBox (14400 x 14400 pt) – canvas size limits
const d3 = await PDFDocument.create();
const p3 = d3.addPage([14400, 14400]);
p3.drawText('gross', { x: 100, y: 100, size: 400 });
writeFileSync(join(OUT, 'hugepage.pdf'), await d3.save());
console.log('pdfs ok');
