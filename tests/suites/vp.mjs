import * as pdfjs from '/home/claude/FalePDF/network/assets/wt/vendor/pdfjs/pdf.min.mjs';
import fs from 'fs';
pdfjs.GlobalWorkerOptions.workerSrc = '/home/claude/FalePDF/network/assets/wt/vendor/pdfjs/pdf.worker.min.mjs';
const data = new Uint8Array(fs.readFileSync(process.argv[2]));
const doc = await pdfjs.getDocument({ data }).promise;
const p = await doc.getPage(2);
const vp = p.getViewport({ scale: 1 });
console.log(p.view, p.rotate, vp.width, vp.height, vp.convertToViewportPoint(-113.65, -21.65));
