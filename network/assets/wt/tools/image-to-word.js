// Tool: image → Word (DOCX) via text recognition. Photos, scans and screenshots become an editable document:
// real paragraphs (line breaks inside a paragraph are joined, hyphenated words re-joined), headings from the text
// size, lists, tables (also without ruling lines) and two-column pages read column by column – the same layout
// analysis as "PDF in Word" (lib/conv-pdfmodel.js), fed with the OCR words. Words the recognition is unsure about
// can be highlighted in yellow so they are quick to check. Several images → one document (one page each) or one
// file per image. Runs locally (tesseract.js via lib/new-ocr.js) – nothing is uploaded.
import { loadCanvas, release } from '../lib/img-core.js';
import { userError } from '../lib/new-ui.js';
import { LANG_OPTION, loadOcr, ocrBest } from './ocr-pdf.js';
import { analyseItems, dropRunningLines, buildModel } from '../lib/conv-pdfmodel.js';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const A4 = [595.28, 841.89];
const PHASE = {
  prepare: { de: 'Bild wird vorbereitet', en: 'Preparing image' },
  load: { de: 'Texterkennung wird geladen', en: 'Loading text recognition' },
  recognize: { de: 'Text wird erkannt', en: 'Recognising text' },
  rotate: { de: 'Ausrichtung wird geprüft', en: 'Checking orientation' },
};

/** OCR result → text items in points on an A4-wide page (rotated photos are turned upright first). */
export function ocrItems(res, W, H, { flagBelow = 0 } = {}) {
  const deg = res.turned || 0;
  const [RW, RH] = deg === 90 || deg === 270 ? [H, W] : [W, H];
  const toR = (x, y) => (deg === 90 ? [H - y, x] : deg === 180 ? [W - x, H - y] : deg === 270 ? [y, W - x] : [x, y]);
  const pageW = RW > RH ? A4[1] : A4[0];
  const s = pageW / RW;
  const items = [];
  for (const w of res.words || []) {
    if (!w.text) continue;
    const a = toR(w.baseline.x0, w.baseline.y0), b = toR(w.baseline.x1, w.baseline.y1);
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
    const y = (a[1] + b[1]) / 2;
    items.push({
      str: w.text, x: x0 * s, y: y * s, w: Math.max(1, (x1 - x0) * s), size: Math.max(4, (w.size || 12) * s * 1.18),   // OCR row height ≈ 0.85 × font size
      flag: flagBelow > 0 && w.conf < flagBelow ? true : undefined,
    });
  }
  // OCR sizes come from the line height, which varies with ascenders/descenders – snap sizes that are within
  // ~30 % of each other to one value, otherwise every line would look like a new paragraph (size change)
  const sizes = items.map(i => i.size).sort((a, b) => a - b);
  const clusters = [];
  for (const v of sizes) { const c = clusters[clusters.length - 1]; if (c && v <= c[0] * 1.32) c.push(v); else clusters.push([v]); }
  const snap = v => { const c = clusters.find(k => v >= k[0] && v <= k[k.length - 1]); return c ? c[Math.floor(c.length / 2)] : v; };
  for (const it of items) it.size = snap(it.size);
  return { items, width: pageW, height: RH * s };
}

export default {
  options: [
    LANG_OPTION,
    { id: 'mark', type: 'toggle', default: true, label: { de: 'Unsichere Wörter gelb markieren', en: 'Highlight uncertain words in yellow' },
      hint: { de: 'So findest du schnell die Stellen, die du prüfen solltest. In Word einfach die Markierung entfernen.', en: 'So you quickly find the spots worth checking. Simply remove the highlight in Word.' } },
    { id: 'tables', type: 'toggle', default: true, label: { de: 'Tabellen erkennen', en: 'Detect tables' },
      hint: { de: 'Auch Tabellen ohne Linien werden zu echten Word-Tabellen.', en: 'Tables without lines become real Word tables, too.' } },
    { id: 'one', type: 'toggle', default: true, when: (v, inputs) => inputs.length > 1, label: { de: 'Alle Bilder in ein Dokument', en: 'All images in one document' },
      hint: { de: 'Jedes Bild beginnt auf einer neuen Seite.', en: 'Every image starts on a new page.' } },
  ],

  async run(inputs, opts, ctx) {
    const ocr = await loadOcr();
    const pages = [], empty = [], weak = [];
    let flagged = 0;
    for (const [i, input] of inputs.entries()) {
      const pre = { de: `Bild ${i + 1} von ${inputs.length}`, en: `Image ${i + 1} of ${inputs.length}` };
      ctx.progress(i / inputs.length, { de: `${pre.de} · ${PHASE.prepare.de} …`, en: `${pre.en} · ${PHASE.prepare.en} …` });
      const { canvas } = await loadCanvas(input, { maxPixels: 24e6 });
      const W = canvas.width, H = canvas.height;
      let res;
      try {
        res = await ocrBest(ocr, canvas, {
          lang: opts.lang, signal: ctx.signal,
          onProgress: (phase, p) => {
            const ph = PHASE[phase] || PHASE.recognize;
            ctx.progress((i + (phase === 'recognize' ? p * 0.9 : 0)) / inputs.length, {
              de: `${pre.de} · ${ph.de}${phase === 'recognize' ? ` … ${Math.round(p * 100)} %` : ' …'}`,
              en: `${pre.en} · ${ph.en}${phase === 'recognize' ? ` … ${Math.round(p * 100)} %` : ' …'}`,
            });
          },
        });
      } finally { release(canvas); }
      const { items, width, height } = ocrItems(res, W, H, { flagBelow: opts.mark ? 70 : 0 });
      flagged += items.filter(it => it.flag).length;
      if (!items.length) empty.push(input.name);
      else if (res.conf < 60) weak.push(input.name);
      pages.push({ name: input.name, page: analyseItems(items, width, height, i) });
      await ctx.tick();
    }
    if (!pages.some(p => p.page.chars)) throw userError(
      'In den Bildern wurde kein Text gefunden. Achte auf ein scharfes, gut beleuchtetes Foto, auf dem der Text groß genug ist.',
      'No text was found in the images. Use a sharp, well-lit photo in which the text is large enough.');
    ctx.progress(0.95, { de: 'Word-Datei wird geschrieben …', en: 'Writing the Word file …' });
    const { modelToDocx } = await import('../lib/shared/office/docx-write.js');
    const write = async (list, title) => {
      const recs = list.map(p => p.page).filter(p => p.chars);
      if (recs.length >= 3) dropRunningLines(recs);
      const { model, stats } = buildModel(recs, { tables: opts.tables, pageBreaks: true });
      const first = recs[0];
      const all = recs.flatMap(p => p.regions.flatMap(r => r.lines));
      const minX = all.length ? Math.min(...all.map(l => l.x0)) : 56;
      const m = Math.max(36, Math.min(80, minX));
      const blob = await modelToDocx(model, { title, page: { w: first.width, h: Math.max(first.height, first.width * 1.2), mt: m, mr: m, mb: m, ml: m } });
      return { blob: new Blob([blob], { type: DOCX }), stats };
    };
    const outputs = [];
    const statNote = st => ctx.t({
      de: `${st.headings} Überschriften · ${st.paragraphs} Absätze · ${st.lists} Listenpunkte · ${st.tables} Tabellen`,
      en: `${st.headings} headings · ${st.paragraphs} paragraphs · ${st.lists} list items · ${st.tables} tables`,
    });
    if (inputs.length === 1 || opts.one) {
      const title = inputs.length === 1 ? inputs[0].name.replace(/\.[^.]+$/, '') : ctx.t({ de: 'Erkannter Text', en: 'Recognised text' });
      const { blob, stats } = await write(pages, title);
      outputs.push({ name: inputs.length === 1 ? ctx.fileName(inputs[0].name, '', 'docx') : `${title}.docx`, blob, note: statNote(stats) });
    } else {
      for (const p of pages) {
        if (!p.page.chars) continue;
        const { blob, stats } = await write([p], p.name.replace(/\.[^.]+$/, ''));
        outputs.push({ name: ctx.fileName(p.name, '', 'docx'), blob, note: statNote(stats) });
        await ctx.tick();
      }
    }
    if (empty.length) ctx.note({ de: `Kein Text gefunden in: ${empty.join(', ')}.`, en: `No text found in: ${empty.join(', ')}.` });
    if (weak.length) ctx.note({ de: `Schwer lesbar: ${weak.join(', ')} – ein schärferes, gerade aufgenommenes Foto hilft.`, en: `Hard to read: ${weak.join(', ')} – a sharper photo taken straight on helps.` });
    if (flagged) ctx.note({ de: `${flagged} unsichere ${flagged === 1 ? 'Wort ist' : 'Wörter sind'} gelb markiert – kurz prüfen.`, en: `${flagged} uncertain ${flagged === 1 ? 'word is' : 'words are'} highlighted in yellow – give them a quick check.` });
    return { outputs };
  },
};
