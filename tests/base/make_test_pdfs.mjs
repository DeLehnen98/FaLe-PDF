import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire('/opt/npm-tools/node_modules/');
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');
const out = process.argv[2];
fs.mkdirSync(out, { recursive: true });

async function multiPage() {
  const doc = await PDFDocument.create();
  doc.setTitle('Testbericht');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const words = ['Datenschutz', 'Rechnung', 'Vertrag', 'Mietwohnung', 'Fahrrad', 'Kaffeemaschine', 'Sonnenblume', 'Quartalsbericht'];
  for (let i = 0; i < 6; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`Kapitel ${i + 1}: ${words[i]}`, { x: 50, y: 780, size: 22, font: bold, color: rgb(0.1, 0.1, 0.3) });
    let y = 740;
    for (let l = 0; l < 30; l++) {
      p.drawText(`Zeile ${l + 1} auf Seite ${i + 1}. Dies ist ein Testtext ueber ${words[(i + l) % words.length]} und mehr.`, { x: 50, y, size: 11, font });
      y -= 20;
    }
    if (i === 3) p.drawText('Der geheime Begriff lautet Zitronenfalter.', { x: 50, y: 60, size: 13, font: bold });
  }
  fs.writeFileSync(`${out}/bericht.pdf`, await doc.save());
}

async function second() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  for (let i = 0; i < 3; i++) {
    const p = doc.addPage([842, 595]);
    p.drawText(`Anhang ${i + 1} - Querformat`, { x: 60, y: 520, size: 28, font });
    p.drawText('Kontoauszug und Belege fuer die Steuererklaerung.', { x: 60, y: 470, size: 14, font });
  }
  fs.writeFileSync(`${out}/anhang.pdf`, await doc.save());
}

async function form() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([595, 842]);
  p.drawText('Anmeldeformular', { x: 50, y: 780, size: 24, font });
  p.drawText('Name:', { x: 50, y: 700, size: 12, font });
  p.drawText('Newsletter:', { x: 50, y: 650, size: 12, font });
  p.drawText('Tarif:', { x: 50, y: 600, size: 12, font });
  p.drawText('Unterschrift:', { x: 50, y: 300, size: 12, font });
  const f = doc.getForm();
  const name = f.createTextField('name');
  name.addToPage(p, { x: 140, y: 692, width: 250, height: 22 });
  const cb = f.createCheckBox('newsletter');
  cb.addToPage(p, { x: 140, y: 645, width: 16, height: 16 });
  const dd = f.createDropdown('tarif');
  dd.addOptions(['Basis', 'Plus', 'Premium']);
  dd.select('Basis');
  dd.addToPage(p, { x: 140, y: 592, width: 150, height: 22 });
  const rg = f.createRadioGroup('zahlung');
  rg.addOptionToPage('Rechnung', p, { x: 140, y: 550, width: 14, height: 14 });
  rg.addOptionToPage('Lastschrift', p, { x: 240, y: 550, width: 14, height: 14 });
  fs.writeFileSync(`${out}/formular.pdf`, await doc.save());
}

async function imagePdf() {
  const doc = await PDFDocument.create();
  // tiny generated PNG (gradient) via pdf-lib needs bytes: build a simple PNG using zlib
  const zlib = await import('zlib');
  const w = 400, h = 300;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = (x * 255 / w) | 0; raw[o + 1] = (y * 255 / h) | 0; raw[o + 2] = 160;
    }
  }
  const png = makePng(w, h, zlib.deflateSync(raw));
  fs.writeFileSync(`${out}/farbverlauf.png`, png);
  const img = await doc.embedPng(png);
  for (let i = 0; i < 2; i++) {
    const p = doc.addPage([w, h]);
    p.drawImage(img, { x: 0, y: 0, width: w, height: h });
  }
  fs.writeFileSync(`${out}/bild.pdf`, await doc.save());
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function makePng(w, h, idat) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

await multiPage(); await second(); await form(); await imagePdf();
console.log('ok');
