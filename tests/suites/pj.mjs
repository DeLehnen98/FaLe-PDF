import { readFileSync } from 'fs';
const lib = await import('/home/claude/FalePDF/network/assets/wt/vendor/pdfjs/pdf.min.mjs');
const data = new Uint8Array(readFileSync(process.argv[2]));
const doc = await lib.getDocument({ data, disableWorker: true, isEvalSupported: false }).promise;
const page = await doc.getPage(+process.argv[3]);
const tc = await page.getTextContent();
for (const it of tc.items.slice(0, +process.argv[4] || 15)) console.log(JSON.stringify(it.str), it.transform.map(v => Math.round(v * 10) / 10).join(','), Math.round(it.width * 10) / 10, it.hasEOL);
