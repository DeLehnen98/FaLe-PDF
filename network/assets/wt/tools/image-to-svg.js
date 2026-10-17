// Tool: picture → real vector graphic (SVG or PDF). Logos, icons, drawings, stamps and signatures are traced
// into clean paths – never a bitmap wrapped in an SVG. Colour logos (automatic or fixed number of colours),
// black & white line art, and single-colour cut outlines for cutting plotters and lasers. Small pictures are
// enlarged before tracing (smooth curves instead of pixel steps); layers are stacked so neighbouring colours
// never show hairline gaps. Colours can be changed on the result. Tracing runs in a worker (lib/vec-worker.js).
import { loadCanvas, release, ensureCss, resultCompare, imgProgress, uniqueNames, ctx2d, newCanvas, userError } from '../lib/img-core.js';
import { el } from '../lib/dom.js';
import { formatSize } from '../lib/format.js';
import { toSvg, toPdfOps, hex } from '../lib/vec-trace.js';

ensureCss();
const T = (v, lang) => (typeof v === 'string' ? v : v[lang] ?? v.de);

// ---------------------------------------------------------------- worker
let worker = null, seq = 0;
const pending = new Map();
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('../lib/vec-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ev => { const p = pending.get(ev.data.id); if (p) { pending.delete(ev.data.id); p(ev.data); } };
  worker.onerror = ev => { for (const p of pending.values()) p({ error: ev.message || 'worker' }); pending.clear(); worker = null; };
  return worker;
}
async function trace(img, opts, signal) {
  let w;
  try { w = getWorker(); } catch {
    const { vectorize } = await import('../lib/vec-trace.js');
    return vectorize(img, opts);
  }
  const id = ++seq;
  const res = await new Promise((resolve, reject) => {
    pending.set(id, resolve);
    const onAbort = () => { pending.delete(id); worker?.terminate(); worker = null; reject(new DOMException('Aborted', 'AbortError')); };
    signal?.addEventListener('abort', onAbort, { once: true });
    w.postMessage({ id, width: img.width, height: img.height, data: img.data.buffer, opts }, [img.data.buffer]);
  });
  if (res.error) throw new Error(res.error);
  return res.res;
}

/** Size at which a picture is traced: small ones enlarged (smooth curves), huge ones reduced (speed). */
export function traceScale(w, h) {
  const long = Math.max(w, h);
  if (long < 1200) return Math.min(4, 1200 / long);
  if (long > 2000) return 2000 / long;
  return 1;
}

async function pdfBlob(vec, recolor, title) {
  const { loadPdfLib, saveDoc } = await import('../lib/pdf.js');
  const PDFLib = await loadPdfLib();
  const doc = await PDFLib.PDFDocument.create();
  const page = doc.addPage([vec.width * 0.75, vec.height * 0.75]);
  const stream = doc.context.flateStream(toPdfOps(vec, { recolor }));
  page.node.set(PDFLib.PDFName.of('Contents'), doc.context.register(stream));
  return new Blob([await saveDoc(doc, { title })], { type: 'application/pdf' });
}

const MODES = {
  color: { label: { de: 'Farbig', en: 'Colour' }, hint: { de: 'Logos, Symbole, Grafiken mit flächigen Farben', en: 'Logos, icons, graphics with flat colours' } },
  bw: { label: { de: 'Schwarz-Weiß', en: 'Black & white' }, hint: { de: 'Strichzeichnungen, Stempel, Unterschriften, Schrift', en: 'Line art, stamps, signatures, lettering' } },
  outline: { label: { de: 'Schneideplotter / Laser', en: 'Cutting plotter / laser' }, hint: { de: 'Nur die Formen in einer Farbe, ohne Hintergrund', en: 'Shapes only, one colour, no background' } },
};

export default {
  options: [
    { id: 'mode', type: 'radio', default: 'color', live: true, label: { de: 'Was ist auf dem Bild?', en: 'What is in the picture?' },
      choices: Object.entries(MODES).map(([value, m]) => ({ value, label: m.label, hint: m.hint })) },
    { id: 'colors', type: 'select', default: 0, live: true, label: { de: 'Anzahl Farben', en: 'Number of colours' }, when: v => v.mode === 'color',
      choices: [{ value: 0, label: { de: 'Automatisch', en: 'Automatic' } }, ...[2, 3, 4, 5, 6, 8, 10, 12, 16].map(n => ({ value: n, label: String(n) }))] },
    { id: 'detail', type: 'range', default: 3, min: 1, max: 5, step: 1, live: true, label: { de: 'Details', en: 'Detail' },
      format: (v, lang) => T([null, { de: 'wenig – nur große Formen', en: 'low – large shapes only' }, { de: 'eher wenig', en: 'fairly low' }, { de: 'mittel', en: 'medium' }, { de: 'viel', en: 'high' }, { de: 'alles – auch Kleinstes', en: 'everything – even tiny bits' }][v], lang) },
    { id: 'smooth', type: 'range', default: 3, min: 1, max: 5, step: 1, live: true, label: { de: 'Glättung', en: 'Smoothing' },
      format: (v, lang) => T([null, { de: 'genau – folgt jeder Kante', en: 'exact – follows every edge' }, { de: 'leicht', en: 'light' }, { de: 'mittel', en: 'medium' }, { de: 'stark', en: 'strong' }, { de: 'sehr stark – weiche Formen', en: 'very strong – soft shapes' }][v], lang) },
    { id: 'dropBackground', type: 'toggle', default: false, live: true, label: { de: 'Hintergrund weglassen', en: 'Leave out the background' },
      hint: { de: 'Die Fläche hinter dem Motiv wird durchsichtig.', en: 'The area behind the motif becomes transparent.' }, when: v => v.mode !== 'outline' },
    { id: 'format', type: 'select', default: 'svg', label: { de: 'Speichern als', en: 'Save as' },
      choices: [{ value: 'svg', label: 'SVG' }, { value: 'pdf', label: { de: 'PDF (Vektor)', en: 'PDF (vector)' } }, { value: 'both', label: { de: 'SVG und PDF', en: 'SVG and PDF' } }] },
  ],

  onResult(el2, res, ctx) {
    resultCompare(el2, res, ctx, { title: { de: 'Original / Vektor', en: 'Original / vector' } });
    palette(el2, res, ctx);
  },

  async run(inputs, opts, ctx) {
    const outputs = [];
    const lang = ctx.lang;
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      const pre = imgProgress(i, inputs.length, input.name);
      ctx.progress(i / inputs.length, pre);
      const { canvas, width, height } = await loadCanvas(input, { maxSide: 2400 });   // traced at ≤ 2000 px anyway
      let work = null;
      try {
        const s0 = canvas.width / width;   // loadCanvas may already have reduced a giant picture
        const f = traceScale(canvas.width, canvas.height);
        const tw = Math.max(1, Math.round(canvas.width * f)), th = Math.max(1, Math.round(canvas.height * f));
        work = newCanvas(tw, th);
        const g = ctx2d(work, true);
        g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
        g.drawImage(canvas, 0, 0, tw, th);
        const img = g.getImageData(0, 0, tw, th);
        ctx.throwIfAborted();
        const vec = await trace(img, { mode: opts.mode, colors: +opts.colors || 0, detail: +opts.detail || 3, smooth: +opts.smooth || 3,
          dropBackground: !!opts.dropBackground, outScale: width / tw, srcScale: tw / width }, ctx.signal);
        ctx.throwIfAborted();
        if (!vec.layers.length) throw userError(`In „${input.name}“ wurde nichts zum Nachzeichnen gefunden.`, `Nothing to trace was found in “${input.name}”.`);
        vec.width = width; vec.height = height;
        const title = input.name.replace(/\.[^.]+$/, '');
        const meta = { input, width, height, vec, recolor: {}, title };
        if (opts.format !== 'pdf') outputs.push({ name: ctx.fileName(input.name, '', 'svg'), blob: new Blob([toSvg(vec, { title })], { type: 'image/svg+xml' }), meta: { ...meta, kind: 'svg' } });
        if (opts.format === 'pdf' || opts.format === 'both') outputs.push({ name: ctx.fileName(input.name, '', 'pdf'), blob: await pdfBlob(vec, {}, title), meta: { ...meta, kind: 'pdf', noCompare: true } });
        if (s0 < 1 && Math.max(width, height) > 6000) ctx.note({ de: `${input.name}: sehr großes Bild, verkleinert nachgezeichnet.`, en: `${input.name}: very large image, traced at a reduced size.` });
        if (opts.mode === 'color' && vec.layers.length >= 10) ctx.note({ de: `${input.name}: viele Farben – bei Fotos wird das Ergebnis eher plakativ. Für Logos lohnt sich „Anzahl Farben“ niedriger.`, en: `${input.name}: many colours – photos come out poster-like. For logos, try fewer colours.` });
      } finally { release(canvas); if (work) release(work); }
      await ctx.tick();
    }
    const first = outputs[0]?.meta?.vec;
    if (first) ctx.note({ de: `Echte Vektoren: ${first.nodes.toLocaleString('de-DE')} Punkte in ${first.layers.length} ${first.layers.length === 1 ? 'Fläche' : 'Farbflächen'}, kein eingebettetes Pixelbild – beliebig groß skalierbar.`,
      en: `Real vectors: ${first.nodes.toLocaleString('en-GB')} points in ${first.layers.length} ${first.layers.length === 1 ? 'shape layer' : 'colour layers'}, no embedded bitmap – scales to any size.` });
    return { outputs: uniqueNames(outputs) };
  },
};

/** Colour chips under the result: change a colour, the files are rewritten at once. */
function palette(resultEl, res, ctx) {
  const lang = ctx.lang;
  const groups = new Map();   // one entry per traced picture (SVG and PDF of it share the colours)
  for (const o of res.outputs) {
    const m = o.meta;
    if (!m?.vec) continue;
    if (!groups.has(m.input)) groups.set(m.input, []);
    groups.get(m.input).push(o);
  }
  if (!groups.size) return;
  const box = el('div', { class: 'vec-pal' }, el('p', { class: 'wt-live-title' }, T({ de: 'Farben ändern', en: 'Change colours' }, lang)));
  for (const [input, outs] of groups) {
    const { vec } = outs[0].meta;
    const recolor = {};
    const row = el('div', { class: 'vec-pal-row' });
    if (groups.size > 1) box.append(el('p', { class: 'img-muted' }, input.name));
    vec.layers.forEach((l, i) => {
      const inp = el('input', { type: 'color', value: hex(l.color), class: 'vec-pal-in', aria: { label: T({ de: `Farbe ${i + 1}`, en: `Colour ${i + 1}` }, lang) } });
      const code = el('span', { class: 'vec-pal-hex' }, hex(l.color));
      inp.addEventListener('change', async () => {
        recolor[i] = inp.value; code.textContent = inp.value;
        for (const o of outs) {
          o.meta.recolor = recolor;
          o.blob = o.meta.kind === 'pdf' ? await pdfBlob(vec, recolor, o.meta.title) : new Blob([toSvg(vec, { recolor, title: o.meta.title })], { type: 'image/svg+xml' });
        }
        resultCompare(resultEl, res, ctx, { title: { de: 'Original / Vektor', en: 'Original / vector' } });
        resultEl.querySelectorAll('.img-result-cmp').forEach((n, k, all) => { if (k < all.length - 1) n.remove(); });
        stat.textContent = sizeText();
      });
      row.append(el('label', { class: 'vec-pal-chip' }, inp, code));
    });
    const sizeText = () => outs.map(o => `${o.name}: ${formatSize(o.blob.size, lang)}`).join(' · ');
    const stat = el('p', { class: 'img-muted vec-pal-stat' }, sizeText());
    box.append(row, stat);
  }
  const list = resultEl.querySelector('.wt-outputs');
  (list || resultEl.lastChild)?.before(box);
}
