// Tool: OCR for scanned PDFs – adds an invisible text layer over the page images, so the PDF becomes
// searchable, selectable and copyable; the scan itself stays untouched. Pages that already have text are
// skipped (optional). Sideways or upside-down scans are detected when a page reads poorly. Outputs: the
// searchable PDF and the recognised text as TXT. Everything runs locally (tesseract.js, lib/new-ocr.js).
import { loadPdfLib, saveDoc } from '../lib/pdf.js';
import { formatSize } from '../lib/format.js';

const PAGE_LANG = document.documentElement.lang === 'en' ? 'en' : 'de';
const userError = (de, en) => Object.assign(new Error(en), { userMessage: { de, en } });

export const LANG_OPTION = {
  id: 'lang', type: 'radio', default: PAGE_LANG === 'en' ? 'eng' : 'deu',
  label: { de: 'Sprache des Texts', en: 'Language of the text' },
  hint: { de: 'Beim ersten Mal werden die Erkennungsdaten einmalig geladen (ca. 5–7 MB). Danach funktioniert die Texterkennung auch offline.', en: 'The first time, the recognition data is downloaded once (about 5–7 MB). After that, text recognition also works offline.' },
  choices: [
    { value: 'deu', label: { de: 'Deutsch', en: 'German' } },
    { value: 'eng', label: { de: 'Englisch', en: 'English' } },
    { value: 'deu+eng', label: { de: 'Deutsch und Englisch', en: 'German and English' }, hint: { de: 'Für gemischte Texte – etwas langsamer.', en: 'For mixed texts – a little slower.' } },
  ],
};

let ocrLib = null;
export const loadOcr = () => (ocrLib ||= import('../lib/new-ocr.js').catch(err => { ocrLib = null; throw err; }));

const PHASE = {
  prepare: { de: 'Bild wird vorbereitet', en: 'Preparing image' },
  load: { de: 'Texterkennung wird geladen', en: 'Loading text recognition' },
  recognize: { de: 'Text wird erkannt', en: 'Recognising text' },
  done: { de: 'Fertig', en: 'Done' },
  render: { de: 'Seite wird gelesen', en: 'Reading page' },
  rotate: { de: 'Ausrichtung wird geprüft', en: 'Checking orientation' },
};

/** Words with good confidence × length – used to compare orientations. */
const score = r => r.words.reduce((s, w) => s + (w.conf >= 55 ? w.text.length : 0), 0);

/** Share of dark pixels on a small copy of the canvas (blank pages are not re-tried). */
function inkRatio(canvas) {
  const s = Math.min(1, 300 / Math.max(canvas.width, canvas.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(canvas.width * s)); c.height = Math.max(1, Math.round(canvas.height * s));
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(canvas, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let dark = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11 < 128) dark++;
  c.width = c.height = 0;
  return dark / (d.length / 4);
}

/** Canvas rotated clockwise by deg (90/180/270). */
function rotated(src, deg) {
  const c = document.createElement('canvas');
  const q = deg % 180 !== 0;
  c.width = q ? src.height : src.width; c.height = q ? src.width : src.height;
  const g = c.getContext('2d');
  g.translate(c.width / 2, c.height / 2);
  g.rotate((deg * Math.PI) / 180);
  g.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

/** Map OCR geometry from a canvas rotated clockwise by deg back to the unrotated canvas (W × H). */
function unrotate(r, deg, W, H) {
  const P = (x, y) => (deg === 90 ? [y, H - x] : deg === 180 ? [W - x, H - y] : [W - y, x]);
  const box = b => {
    const pts = [P(b.x0, b.y0), P(b.x1, b.y1)];
    return { x0: Math.min(pts[0][0], pts[1][0]), y0: Math.min(pts[0][1], pts[1][1]), x1: Math.max(pts[0][0], pts[1][0]), y1: Math.max(pts[0][1], pts[1][1]) };
  };
  for (const w of r.words) {
    const a = P(w.baseline.x0, w.baseline.y0), b = P(w.baseline.x1, w.baseline.y1);
    w.baseline = { x0: a[0], y0: a[1], x1: b[0], y1: b[1] };
    w.bbox = box(w.bbox);
  }
  r.width = W; r.height = H;
  return r;
}

/**
 * Recognise a canvas; if it reads poorly but has ink, try the other orientations (sideways /
 * upside-down scans or photos) and keep the best. Boxes refer to the unrotated canvas; `turned` = degrees.
 */
export async function ocrBest(ocr, canvas, { lang, signal, onProgress, dpi = 0, orientation = true }) {
  const opts = { lang, signal, dpi };
  let best = await ocr.recognize(canvas, { ...opts, onProgress: p => onProgress?.(p.phase, p.progress) });
  best.turned = 0;
  const weak = best.words.length < 8 || best.conf < 45;
  if (orientation && weak && inkRatio(canvas) > 0.004) {
    for (const deg of [90, 270, 180]) {
      onProgress?.('rotate', 0);
      const rc = rotated(canvas, deg);
      let r;
      try { r = await ocr.recognize(rc, opts); } finally { rc.width = rc.height = 0; }
      if (score(r) > score(best) * 1.5 + 10) { best = unrotate(r, deg, canvas.width, canvas.height); best.turned = deg; }
      if (best.turned && best.conf > 70) break;
    }
  }
  return best;
}

/** OCR one pdf.js page rendered at ~300 dpi; adds the viewport that maps its pixels to PDF space. */
export async function ocrPdfPage(ocr, page, { lang, signal, onProgress }) {
  const { renderPage } = await import('../lib/pdf.js');
  const base = page.getViewport({ scale: 1 });
  const scale = ocr.ocrScale(base.width, base.height);
  onProgress?.('render', 0);
  const canvas = await renderPage(page, { scale, signal });
  try {
    const best = await ocrBest(ocr, canvas, { lang, signal, onProgress, dpi: 72 * (canvas.width / base.width) });
    best.viewport = page.getViewport({ scale: canvas.width / base.width });
    return best;
  } finally { canvas.width = canvas.height = 0; }
}

export default {
  options: [
    LANG_OPTION,
    { id: 'pages', type: 'pages', label: { de: 'Seiten (leer = alle)', en: 'Pages (empty = all)' }, when: (v, inputs) => inputs.length <= 1 },
    { id: 'skipText', type: 'toggle', default: true,
      label: { de: 'Seiten mit vorhandenem Text überspringen', en: 'Skip pages that already contain text' },
      hint: { de: 'Verhindert doppelten Text, wenn nur einzelne Seiten gescannt sind.', en: 'Avoids duplicate text when only some pages are scanned.' } },
  ],

  async run(inputs, opts, ctx) {
    const [ocr, PDFLib] = await Promise.all([loadOcr(), loadPdfLib()]);
    const outputs = [];
    const lowConf = [], turned = [], empty = [];
    let skippedTotal = 0, ocrTotal = 0;
    // pages of all files, for one overall progress bar
    const jobs = [];
    for (const [f, input] of inputs.entries()) {
      const pdf = await input.pdfjs();
      const idx = inputs.length === 1 && opts.pages ? ctx.parsePages(opts.pages, pdf.numPages) : Array.from({ length: pdf.numPages }, (_, i) => i);
      jobs.push({ f, input, pdf, idx });
    }
    const total = jobs.reduce((s, j) => s + j.idx.length, 0);
    let done = 0;
    const firstUse = ocr.firstUseBytes(opts.lang);
    for (const job of jobs) {
      const { input, pdf, idx } = job;
      const results = new Map();
      const texts = [];
      const pre = inputs.length > 1 ? { de: `Datei ${job.f + 1} von ${inputs.length} · `, en: `File ${job.f + 1} of ${inputs.length} · ` } : { de: '', en: '' };
      // pages are recognised in parallel when the device has more than one OCR worker
      const lanes = Math.max(1, Math.min(ocr.maxWorkers(), idx.length));
      let next = 0;
      const progressOf = new Map();
      const tell = (pageNo, phase, p) => {
        progressOf.set(pageNo, phase === 'recognize' ? p : phase === 'done' ? 1 : 0);
        const part = [...progressOf.values()].reduce((s, v) => s + v, 0);
        const ph = PHASE[phase] || PHASE.recognize;
        const extra = phase === 'load' && !done ? { de: ` (beim ersten Mal ca. ${formatSize(firstUse, 'de')})`, en: ` (about ${formatSize(firstUse, 'en')} the first time)` } : { de: '', en: '' };
        ctx.progress(Math.min(0.97, (done + part) / total), {
          de: `${pre.de}Seite ${pageNo} (${done + 1} von ${total}) · ${ph.de}${extra.de}${phase === 'recognize' ? ` … ${Math.round(p * 100)} %` : ' …'}`,
          en: `${pre.en}Page ${pageNo} (${done + 1} of ${total}) · ${ph.en}${extra.en}${phase === 'recognize' ? ` … ${Math.round(p * 100)} %` : ' …'}`,
        });
      };
      const lane = async () => {
        while (next < idx.length) {
          const i = idx[next++];
          ctx.throwIfAborted();
          const page = await pdf.getPage(i + 1);
          try {
            if (opts.skipText && await ocr.pageTextChars(page) >= 20) { results.set(i, { skipped: true }); skippedTotal++; }
            else {
              const r = await ocrPdfPage(ocr, page, { lang: opts.lang, signal: ctx.signal, onProgress: (phase, p) => tell(i + 1, phase, p) });
              results.set(i, r);
              ocrTotal++;
              if (r.turned) turned.push(i + 1);
              if (!r.words.length) empty.push(i + 1);
              else if (r.conf < 60) lowConf.push(i + 1);
            }
          } finally { page.cleanup(); }
          progressOf.delete(i + 1);
          done++;
          await ctx.tick();
        }
      };
      await Promise.all(Array.from({ length: lanes }, lane));
      const ocred = idx.filter(i => results.get(i) && !results.get(i).skipped);
      if (!ocred.length) continue;
      ctx.progress(Math.min(0.98, done / total), { de: `${pre.de}Textebene wird eingefügt …`, en: `${pre.en}Adding the text layer …` });
      const doc = await input.pdfDoc();
      const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
      const pages = doc.getPages();
      let words = 0;
      for (const i of idx) {
        const r = results.get(i);
        if (!r || r.skipped) continue;
        words += ocr.addTextLayer(PDFLib, doc, pages[i], font, r.words, (x, y) => r.viewport.convertToPdfPoint(x, y));
        texts.push([i + 1, ocr.resultText(r)]);
      }
      const bytes = await saveDoc(doc);
      const marker = n => ctx.t({ de: `—— Seite ${n} ——`, en: `—— Page ${n} ——` });
      const txt = texts.map(([n, t]) => (texts.length > 1 || idx.length > 1 ? `${marker(n)}\n\n` : '') + t.trim()).join('\n\n') + '\n';
      // the text is offered in the result (copy / "save as TXT"); the PDF stays the only output so that
      // "continue with …" (compress, merge, sign) works
      outputs.push({
        name: ctx.fileName(input.name, ctx.t({ de: ' (durchsuchbar)', en: ' (searchable)' }), 'pdf'),
        blob: new Blob([bytes], { type: 'application/pdf' }),
        // no word count here: the text panel below counts the (editable) text – two different numbers confused
        note: ctx.t({ de: `${ocred.length} ${ocred.length === 1 ? 'Seite' : 'Seiten'} erkannt`, en: `${ocred.length} ${ocred.length === 1 ? 'page' : 'pages'} recognised` }),
        meta: { text: txt, txtName: ctx.fileName(input.name, '', 'txt'), source: input.name },
      });
    }
    if (!outputs.length) {
      // the user fixes this on the same screen (switch the option off): a hint in the bar, not an error card
      if (skippedTotal && !ocrTotal) throw Object.assign(userError(
        'Alle gewählten Seiten enthalten schon Text – die PDF ist bereits durchsuchbar. Schalte „Seiten mit vorhandenem Text überspringen“ aus, wenn du sie trotzdem erkennen lassen willst.',
        'All selected pages already contain text – the PDF is already searchable. Turn off “Skip pages that already contain text” to recognise them anyway.'), { stay: true });
      throw userError('Es konnte kein Text erkannt werden.', 'No text could be recognised.');
    }
    if (inputs.some(i => i.password)) ctx.note({ de: 'Die durchsuchbare PDF ist nicht mehr mit einem Passwort geschützt. Mit „PDF schützen“ kannst du wieder eins setzen.', en: 'The searchable PDF is no longer password-protected. Use “Protect PDF” to set a password again.' });
    if (skippedTotal) ctx.note({ de: `${skippedTotal} ${skippedTotal === 1 ? 'Seite hatte' : 'Seiten hatten'} schon Text und ${skippedTotal === 1 ? 'wurde' : 'wurden'} unverändert übernommen.`, en: `${skippedTotal} ${skippedTotal === 1 ? 'page already had' : 'pages already had'} text and ${skippedTotal === 1 ? 'was' : 'were'} kept as it was.` });
    if (turned.length) ctx.note({ de: `Seite ${turned.join(', ')} war gedreht gescannt – der Text wurde trotzdem richtig erkannt. Zum Lesen kannst du die Seite mit „PDF drehen“ aufrichten.`, en: `Page ${turned.join(', ')} was scanned sideways or upside down – the text was still recognised. Use “Rotate PDF” to turn the page upright for reading.` });
    if (empty.length) ctx.note({ de: `Auf Seite ${empty.join(', ')} wurde kein Text gefunden.`, en: `No text was found on page ${empty.join(', ')}.` });
    if (lowConf.length) ctx.note({ de: `Seite ${lowConf.join(', ')} war schwer lesbar – prüfe den erkannten Text. Ein schärferer Scan mit 300 dpi hilft.`, en: `Page ${lowConf.join(', ')} was hard to read – check the recognised text. A sharper scan at 300 dpi helps.` });
    return { outputs };
  },

  onResult(result, res, ctx) { import('../lib/new-ui.js').then(m => m.textPanel(result, res, ctx)).catch(err => console.warn(err)); },
};
