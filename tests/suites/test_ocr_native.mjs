// Unit test for js/ocr/native.js fromVision(): Apple Vision lines → the OCR engine's result shape
// (words/lines/paragraphs with boxes in source pixels, reading order, paragraphs by gaps, confidence 0–100).
//   node test_ocr_native.mjs
import { fromVision } from '../../js/ocr/native.js';
let pass = 0, fail = 0;
const check = (n, c, info = '') => { if (c) pass++; else fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (!c && info ? `  [${String(info).slice(0, 300)}]` : '')); };

// Vision answers in the image it got (here: scaled to 50 % → srcScale 0.5), boxes [x, y, w, h], top-left origin
const r = fromVision({ width: 600, height: 400, lines: [
  { text: 'Straße 42, 66620 Nonnweiler', conf: 0.9, box: [30, 160, 300, 20], words: [{ text: 'Straße', conf: 0.9, box: [30, 160, 60, 20] }, { text: '42,', conf: 0.9, box: [95, 160, 25, 20] }, { text: '66620', conf: 0.9, box: [125, 160, 55, 20] }, { text: 'Nonnweiler', conf: 0.9, box: [185, 160, 120, 20] }] },
  { text: 'Vollmacht', conf: 0.95, box: [30, 30, 150, 30], words: [{ text: 'Vollmacht', conf: 0.95, box: [30, 30, 150, 30] }] },
  { text: 'Geburtsdatum: 12.03.1961', conf: 0.8, box: [30, 130, 260, 20], words: [] },
  { text: '   ', conf: 0.1, box: [0, 0, 1, 1] },
] }, 0.5);
check('reading order top to bottom', r.lines.map(l => l.text).join(' | ') === 'Vollmacht | Geburtsdatum: 12.03.1961 | Straße 42, 66620 Nonnweiler', r.lines.map(l => l.text));
check('boxes back in source pixels (÷ 0.5)', r.words[0].bbox.x0 === 60 && r.words[0].bbox.y0 === 60 && r.words[0].bbox.x1 === 360 && r.width === 1200 && r.height === 800, JSON.stringify(r.words[0].bbox));
check('a line without word boxes becomes one word', r.lines[1].words.length === 1 && r.lines[1].words[0].text === 'Geburtsdatum: 12.03.1961');
check('words keep their own boxes and line index', r.words.find(w => w.text === '66620').bbox.x0 === 250 && r.words.find(w => w.text === '66620').line === 2);
check('paragraphs split at the gap after the heading', r.paragraphs.length === 2 && r.paragraphs[0].lines.join() === '0' && r.paragraphs[1].lines.join() === '1,2', JSON.stringify(r.paragraphs.map(p => p.lines)));
check('text joins paragraphs with a blank line', r.text === 'Vollmacht\n\nGeburtsdatum: 12.03.1961\nStraße 42, 66620 Nonnweiler', JSON.stringify(r.text));
check('confidence 0–100, size and baseline set, engine apple', r.conf > 80 && r.conf <= 100 && r.words.every(w => w.size > 0 && w.baseline.y0 > w.bbox.y0 && w.baseline.y0 <= w.bbox.y1) && r.engine === 'apple');
check('empty lines ignored, line.par points at its paragraph', r.lines.length === 3 && r.lines.every((l, i) => r.paragraphs[l.par].lines.includes(i)));
check('empty result', fromVision({ width: 10, height: 10, lines: [] }).text === '' && fromVision(null).words.length === 0);
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
