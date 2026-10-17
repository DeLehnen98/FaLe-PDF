// Fixtures for the security/edit tools (agent "sec"): forms, private data, compare versions, annotations.
//   node sec_fixtures.mjs   (writes fixtures/sec_*.pdf; then sec_fixtures.py post-processes)
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire('/opt/npm-tools/node_modules/');
const { PDFDocument, StandardFonts, rgb, PDFName, PDFString, PDFHexString, degrees } = require('pdf-lib');
const OUT = new URL('./fixtures/', import.meta.url).pathname;
const A4 = [595.28, 841.89];

async function formPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const form = doc.getForm();
  const p = doc.addPage(A4);
  p.drawText('Anmeldung Schwimmkurs', { x: 60, y: 780, size: 22, font });
  const label = (pg, t, y) => pg.drawText(t, { x: 60, y: y + 8, size: 11, font });
  label(p, 'Vorname', 700); const fn = form.createTextField('Vorname'); fn.addToPage(p, { x: 170, y: 696, width: 250, height: 24, font });
  label(p, 'Nachname', 660); const ln = form.createTextField('Nachname'); ln.setText('Müller'); ln.addToPage(p, { x: 170, y: 656, width: 250, height: 24, font });
  label(p, 'E-Mail', 620); const em = form.createTextField('E-Mail'); em.addToPage(p, { x: 170, y: 616, width: 250, height: 24, font });
  label(p, 'Telefon', 580); const tel = form.createTextField('Telefon'); tel.addToPage(p, { x: 170, y: 576, width: 250, height: 24, font });
  label(p, 'Bemerkung', 520); const bm = form.createTextField('Bemerkung'); bm.enableMultiline(); bm.addToPage(p, { x: 170, y: 470, width: 330, height: 70, font });
  label(p, 'Kurs', 420); const dd = form.createDropdown('Kurs'); dd.addOptions(['Seepferdchen', 'Bronze', 'Silber', 'Gold']); dd.select('Bronze'); dd.addToPage(p, { x: 170, y: 416, width: 200, height: 24, font });
  label(p, 'Tage', 360); const lb = form.createOptionList('Tage'); lb.addOptions(['Montag', 'Mittwoch', 'Freitag', 'Samstag']); lb.addToPage(p, { x: 170, y: 300, width: 200, height: 76, font });
  label(p, 'Schwimmer', 250); const rg = form.createRadioGroup('Schwimmer');
  rg.addOptionToPage('ja', p, { x: 170, y: 250, width: 16, height: 16 }); p.drawText('ja', { x: 192, y: 253, size: 11, font });
  rg.addOptionToPage('nein', p, { x: 240, y: 250, width: 16, height: 16 }); p.drawText('nein', { x: 262, y: 253, size: 11, font });
  label(p, 'Fotos erlaubt', 200); const cb = form.createCheckBox('Fotos'); cb.addToPage(p, { x: 170, y: 200, width: 16, height: 16 });
  // page 2, rotated 90°
  const p2 = doc.addPage(A4);
  p2.setRotation(degrees(90));
  p2.drawText('Seite 2 (gedreht)', { x: 60, y: 780, size: 18, font });
  label(p2, 'Ort, Datum', 700); const od = form.createTextField('Ort'); od.addToPage(p2, { x: 170, y: 696, width: 250, height: 24, font });
  doc.setTitle('Anmeldung');
  writeFileSync(OUT + 'sec_form.pdf', await doc.save());
}

async function privatePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage(A4);
  const lines = [
    'Kundendaten (vertraulich)',
    'Name: Erika Mustermann',
    'E-Mail: erika.mustermann@example.de',
    'Telefon: +49 681 1234567',
    'IBAN: DE89 3704 0044 0532 0130 00',
    'Geburtsdatum: 12.03.1985',
    'Projekt: Falke-7 ist streng geheim.',
    'Dieser Satz bleibt sichtbar.',
  ];
  lines.forEach((t, i) => p.drawText(t, { x: 60, y: 780 - i * 28, size: 14, font }));
  // page 2: rotated, more data
  const p2 = doc.addPage([841.89, 595.28]);
  p2.setRotation(degrees(90));
  p2.drawText('Seite 2: Kontakt max@firma.example, Projekt Falke-7', { x: 60, y: 500, size: 14, font });
  p2.drawText('Öffentlicher Text ohne Geheimnisse.', { x: 60, y: 460, size: 14, font });
  // page 3: nothing private
  const p3 = doc.addPage(A4);
  p3.drawText('Seite 3 ohne persönliche Daten.', { x: 60, y: 780, size: 14, font });
  // note annotation that also contains the secret
  const note = doc.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [400, 700, 420, 720], Contents: PDFHexString.fromText('Notiz: Falke-7 Budget'), T: PDFHexString.fromText('Erika') });
  p.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(note)]));
  doc.setTitle('Geheimbericht Falke-7');
  doc.setAuthor('Erika Mustermann');
  doc.setSubject('Kundendaten');
  doc.setKeywords(['vertraulich', 'Falke-7']);
  doc.setCreator('Textprogramm 1.0');
  doc.setProducer('Druckertreiber 2.3');
  doc.setCreationDate(new Date('2020-05-01T10:00:00Z'));
  // XMP
  const xmp = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator><rdf:Seq><rdf:li>Erika Mustermann</rdf:li></rdf:Seq></dc:creator><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Geheimbericht Falke-7</rdf:li></rdf:Alt></dc:title></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
  const xs = doc.context.stream(xmp, { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(xs));
  // attachment
  await doc.attach(new TextEncoder().encode('Kontonummer 123456 – Falke-7'), 'notizen.txt', { mimeType: 'text/plain', description: 'Interne Notizen' });
  // JavaScript (document level + open action)
  const js = doc.context.obj({ S: 'JavaScript', JS: PDFString.of('app.alert("Hallo");') });
  const jsRef = doc.context.register(js);
  const names = doc.context.obj({ Names: [PDFHexString.fromText('init'), jsRef] });
  await doc.flush();
  let nm = doc.catalog.lookup(PDFName.of('Names'));
  if (!nm) { nm = doc.context.obj({}); doc.catalog.set(PDFName.of('Names'), nm); }
  nm.set(PDFName.of('JavaScript'), doc.context.register(names));
  doc.catalog.set(PDFName.of('OpenAction'), jsRef);
  writeFileSync(OUT + 'sec_private.pdf', await doc.save({ updateFieldAppearances: false }));
}

const BASE = [
  'Der Mietvertrag beginnt am ersten Mai und läuft unbefristet.',
  'Die Miete beträgt 750 Euro pro Monat inklusive Nebenkosten.',
  'Haustiere sind nach Absprache mit dem Vermieter erlaubt.',
  'Die Kaution beträgt drei Monatsmieten und wird verzinst.',
  'Schönheitsreparaturen übernimmt der Mieter in angemessenen Abständen.',
  'Die Kündigungsfrist beträgt drei Monate zum Monatsende.',
];
async function versionPdf(file, edit) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = edit(BASE.slice());
  for (let pg = 0; pg < 2; pg++) {
    const p = doc.addPage(A4);
    p.drawText(`Mietvertrag – Seite ${pg + 1}`, { x: 60, y: 780, size: 20, font: bold });
    const chunk = pg === 0 ? text.slice(0, 4) : text.slice(4);
    chunk.forEach((t, i) => p.drawText(t, { x: 60, y: 730 - i * 26, size: 12, font }));
    p.drawRectangle({ x: 60, y: 300, width: 200, height: 120, color: file.includes('v2') && pg === 1 ? rgb(0.8, 0.2, 0.2) : rgb(0.2, 0.4, 0.8) });
  }
  writeFileSync(OUT + file, await doc.save());
}

async function annotsPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const form = doc.getForm();
  const p = doc.addPage(A4);
  p.drawText('Glätten-Test', { x: 60, y: 780, size: 22, font });
  const tf = form.createTextField('Kunde'); tf.setText('Jörg Größe'); tf.addToPage(p, { x: 60, y: 700, width: 250, height: 26, font });
  const cb = form.createCheckBox('OK'); cb.check(); cb.addToPage(p, { x: 60, y: 650, width: 18, height: 18 });
  form.updateFieldAppearances(font);
  // ink-like square annotation with appearance stream
  const ap = doc.context.stream('1 0 0 RG 3 w 2 2 96 46 re S', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 100, 50] });
  const sq = doc.context.obj({ Type: 'Annot', Subtype: 'Square', Rect: [300, 600, 400, 650], C: [1, 0, 0], Contents: PDFHexString.fromText('Rahmen'), AP: { N: doc.context.register(ap) } });
  const link = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [60, 560, 260, 580], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://fale.network/') } });
  p.drawText('Link zu fale.network', { x: 60, y: 565, size: 12, font, color: rgb(0, 0, 0.8) });
  const annots = p.node.lookup(PDFName.of('Annots'));
  annots.push(doc.context.register(sq));
  annots.push(doc.context.register(link));
  // rotated page with a field
  const p2 = doc.addPage(A4);
  p2.setRotation(degrees(270));
  p2.drawText('Gedrehte Seite', { x: 60, y: 780, size: 18, font });
  const tf2 = form.createTextField('Notiz'); tf2.setText('Straße 5'); tf2.addToPage(p2, { x: 60, y: 700, width: 250, height: 26, font });
  form.updateFieldAppearances(font);
  writeFileSync(OUT + 'sec_annots.pdf', await doc.save());
}

async function blankFormPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage(A4);
  p.drawText('Antrag (ohne Formularfelder)', { x: 60, y: 780, size: 20, font });
  p.drawText('Name: ______________________________', { x: 60, y: 720, size: 12, font });
  p.drawText('Anschrift:', { x: 60, y: 680, size: 12, font });
  p.drawLine({ start: { x: 140, y: 678 }, end: { x: 460, y: 678 }, thickness: 0.8 });
  p.drawText('Bemerkungen', { x: 60, y: 640, size: 12, font });
  p.drawRectangle({ x: 60, y: 540, width: 400, height: 90, borderWidth: 1, borderColor: rgb(0, 0, 0) });
  p.drawRectangle({ x: 60, y: 500, width: 12, height: 12, borderWidth: 1, borderColor: rgb(0, 0, 0) });
  p.drawText('Ich stimme zu', { x: 80, y: 502, size: 12, font });
  writeFileSync(OUT + 'sec_blank.pdf', await doc.save());
}

async function longPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 120; i++) {
    const p = doc.addPage(i % 7 === 0 ? [841.89, 595.28] : A4);
    p.drawText(`Langes Dokument Seite ${i}`, { x: 60, y: 520, size: 18, font });
    if (i % 10 === 0) p.setRotation(degrees(90));
  }
  writeFileSync(OUT + 'sec_long.pdf', await doc.save());
}

await formPdf();
await privatePdf();
await versionPdf('sec_v1.pdf', t => t);
await versionPdf('sec_v2.pdf', t => {
  t[1] = 'Die Miete beträgt 820 Euro pro Monat inklusive Nebenkosten.';
  t.splice(3, 0, 'Ein Stellplatz in der Tiefgarage ist im Preis enthalten.');
  t[5] = 'Schönheitsreparaturen übernimmt der Vermieter.';
  return t;
});
await annotsPdf();
await blankFormPdf();
await longPdf();
console.log('sec fixtures written');
