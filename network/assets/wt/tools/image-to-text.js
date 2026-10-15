// Tool: image → text (OCR) for photos, screenshots and scans. Several images at once, optional region
// per image (touch crop box), German/English, sideways photos are detected when they read poorly.
// Result: editable text with copy button + TXT file. Runs locally (tesseract.js via lib/new-ocr.js).
import { el, clear } from '../lib/dom.js';
import { loadCanvas, release } from '../lib/img-core.js';
import { ensureCss, T, iconBtn, ICON, userError } from '../lib/new-ui.js';
import { createCropBox } from '../lib/new-cropbox.js';
import { LANG_OPTION, loadOcr, ocrBest } from './ocr-pdf.js';

ensureCss();

const PHASE = {
  prepare: { de: 'Bild wird vorbereitet', en: 'Preparing image' },
  load: { de: 'Texterkennung wird geladen', en: 'Loading text recognition' },
  recognize: { de: 'Text wird erkannt', en: 'Recognising text' },
  rotate: { de: 'Ausrichtung wird geprüft', en: 'Checking orientation' },
  done: { de: 'Fertig', en: 'Done' },
};

/** Join the lines of each paragraph (hyphenated line ends are merged). */
export function joinLines(text) {
  return text.split(/\n{2,}/).map(p => p.split('\n').reduce((acc, line) => {
    if (!acc) return line.trim();
    if (/[A-Za-zÄÖÜäöüß]-$/.test(acc) && /^[a-zäöüß]/.test(line.trim())) return acc.slice(0, -1) + line.trim();
    return acc + ' ' + line.trim();
  }, '')).join('\n\n');
}

let stageApi = null;

export default {
  options: [
    LANG_OPTION,
    { id: 'join', type: 'toggle', default: false,
      label: { de: 'Zeilen zu Absätzen zusammenfügen', en: 'Join lines into paragraphs' },
      hint: { de: 'Praktisch zum Einfügen in E-Mails oder Dokumente. Aus ist jede Zeile wie im Bild.', en: 'Handy for pasting into e-mails or documents. Off keeps every line as in the image.' } },
  ],

  mountStage(stage, state, ctx) { stageApi = regionStage(stage, state, ctx); },
  onInputs(inputs) { stageApi?.refresh(inputs); },

  status(values, inputs) {
    const n = inputs.filter(i => i.opts.region).length;
    if (!n) return null;
    return { hint: { de: `Bei ${n} ${n === 1 ? 'Bild' : 'Bildern'} wird nur der markierte Bereich gelesen.`, en: `Only the marked area is read on ${n} ${n === 1 ? 'image' : 'images'}.` } };
  },

  async run(inputs, opts, ctx) {
    const ocr = await loadOcr();
    const parts = [];
    const weak = [], turned = [], empty = [];
    for (const [i, input] of inputs.entries()) {
      const pre = { de: `Bild ${i + 1} von ${inputs.length}`, en: `Image ${i + 1} of ${inputs.length}` };
      ctx.progress(i / inputs.length, { de: `${pre.de} · ${PHASE.prepare.de} …`, en: `${pre.en} · ${PHASE.prepare.en} …` });
      const { canvas, width, height } = await loadCanvas(input, { maxPixels: 24e6 });
      let src = canvas;
      const r = input.opts.region;
      if (r) {
        const sx = canvas.width / width;
        const x = Math.round(r.x * width * sx), y = Math.round(r.y * height * sx);
        const w = Math.max(8, Math.round(r.w * width * sx)), h = Math.max(8, Math.round(r.h * height * sx));
        src = document.createElement('canvas');
        src.width = w; src.height = h;
        src.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
        release(canvas);
      }
      let res;
      try {
        res = await ocrBest(ocr, src, {
          lang: opts.lang, signal: ctx.signal,
          onProgress: (phase, p) => {
            const ph = PHASE[phase] || PHASE.recognize;
            ctx.progress((i + (phase === 'recognize' ? p : 0)) / inputs.length, {
              de: `${pre.de} · ${ph.de}${phase === 'recognize' ? ` … ${Math.round(p * 100)} %` : ' …'}`,
              en: `${pre.en} · ${ph.en}${phase === 'recognize' ? ` … ${Math.round(p * 100)} %` : ' …'}`,
            });
          },
        });
      } finally { release(src); }
      let text = ocr.resultText(res).trim();
      if (opts.join) text = joinLines(text);
      if (!text) empty.push(input.name);
      else if (res.conf < 60) weak.push(input.name);
      if (res.turned) turned.push(input.name);
      parts.push({ name: input.name, text });
      await ctx.tick();
    }
    if (!parts.some(p => p.text)) throw userError(
      'In den Bildern wurde kein Text gefunden. Achte auf ein scharfes, gut beleuchtetes Foto, auf dem der Text groß genug ist.',
      'No text was found in the images. Use a sharp, well-lit photo in which the text is large enough.');
    const text = (parts.length === 1 ? parts[0].text : parts.map(p => `=== ${p.name} ===\n\n${p.text || '–'}`).join('\n\n')) + '\n';
    const name = inputs.length === 1 ? ctx.fileName(inputs[0].name, '', 'txt') : ctx.t({ de: 'Erkannter Text.txt', en: 'Recognised text.txt' });
    if (empty.length) ctx.note({ de: `Kein Text gefunden in: ${empty.join(', ')}.`, en: `No text found in: ${empty.join(', ')}.` });
    if (weak.length) ctx.note({ de: `Schwer lesbar: ${weak.join(', ')} – prüf den Text. Ein schärferes Foto oder ein enger markierter Bereich hilft.`, en: `Hard to read: ${weak.join(', ')} – check the text. A sharper photo or a tighter marked area helps.` });
    if (turned.length) ctx.note({ de: `Gedreht erkannt: ${turned.join(', ')}.`, en: `Recognised in rotated orientation: ${turned.join(', ')}.` });
    return { outputs: [{ name, blob: new Blob([text.replace(/\n/g, '\r\n')], { type: 'text/plain;charset=utf-8' }), meta: { text, txtName: name } }] };
  },

  onResult(result, res, ctx) { import('../lib/new-ui.js').then(m => m.textPanel(result, res, ctx)).catch(err => console.warn(err)); },
};

/** Stage: choose an image, optionally mark the area to read. */
function regionStage(stage, state, ctx) {
  const lang = ctx.lang;
  let current = null;
  let loadSeq = 0;
  const thumbs = el('div', { class: 'new-thumbs', role: 'group', aria: { label: T(lang, { de: 'Bild zum Markieren wählen', en: 'Choose image to mark' }) } });
  const toggle = el('input', { type: 'checkbox', id: 'new-itt-region' });
  const box = createCropBox({ lang, label: { de: 'Bereich, der gelesen wird', en: 'Area to read' }, onChange: r => { if (current && toggle.checked) { current.opts.region = r; changed(); } } });
  const view = el('div', { class: 'new-ed-view' }, box.root);
  const resetBtn = iconBtn(ICON.reset, T(lang, { de: 'Ganzes Bild', en: 'Whole image' }), () => { box.reset(0.8); }, { text: T(lang, { de: 'Rahmen zurücksetzen', en: 'Reset frame' }) });
  const editor = el('div', { class: 'new-ed', hidden: true }, view, el('div', { class: 'new-tools' }, resetBtn));
  const sec = el('section', { class: 'new-box', aria: { labelledby: 'new-itt-h' } },
    el('h2', { id: 'new-itt-h' }, T(lang, { de: 'Bereich (optional)', en: 'Area (optional)' })),
    thumbs,
    el('label', { class: 'new-chk', for: 'new-itt-region' }, toggle, el('span', {}, T(lang, { de: 'Nur einen Bereich des Bildes lesen', en: 'Read only part of the image' }))),
    el('p', { class: 'new-muted' }, T(lang, { de: 'Zieh den Rahmen über den Text, den du brauchst – z. B. eine Adresse oder eine Tabelle. Ohne Markierung wird das ganze Bild gelesen.', en: 'Drag the frame over the text you need – e.g. an address or a table. Without a frame the whole image is read.' })),
    editor);
  stage.append(sec);

  toggle.addEventListener('change', () => {
    if (!current) return;
    if (toggle.checked) { current.opts.region = current.opts._lastRegion || { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }; box.rect = current.opts.region; }
    else { current.opts._lastRegion = current.opts.region; current.opts.region = null; }
    editor.hidden = !toggle.checked;
    if (toggle.checked) show();
    changed();
  });
  function changed() { state.results.clear(); ctx.refresh(); }

  async function show() {
    if (!current || !toggle.checked) return;
    const seq = ++loadSeq;
    const input = current;
    let c;
    try { c = await loadCanvas(input, { maxSide: 1600 }); } catch (err) { console.warn(err); return; }
    if (seq !== loadSeq) { release(c.canvas); return; }
    const maxW = Math.max(200, view.clientWidth || stage.clientWidth || 340);
    const maxH = Math.max(240, Math.min(window.innerHeight * 0.6, 560));
    box.show(c.canvas, c.width, c.height, maxW, maxH);
    release(c.canvas);
    box.rect = input.opts.region || { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
  }

  function select(input) {
    current = input;
    for (const b of thumbs.children) b.setAttribute('aria-pressed', String(b._input === input));
    toggle.checked = !!input.opts.region;
    editor.hidden = !toggle.checked;
    show();
  }

  async function refresh(inputs = state.inputs.filter(i => !i.error)) {
    clear(thumbs);
    thumbs.hidden = inputs.length < 2;
    for (const input of inputs) {
      const b = el('button', { type: 'button', class: 'new-thumb', aria: { pressed: 'false', label: input.name }, onclick: () => select(input) });
      b._input = input;
      thumbs.append(b);
      if (inputs.length > 1) input.thumbnail(64).then(c => { const img = el('img', { alt: '' }); c.toBlob(bl => { if (bl) { img.src = URL.createObjectURL(bl); img.onload = () => URL.revokeObjectURL(img.src); } }); b.append(img); }).catch(() => {});
    }
    if (!inputs.includes(current)) current = inputs[0] || null;
    if (current) select(current);
  }
  refresh();
  return { refresh };
}
