// Tool: remove the background of photos on the device. A small segmentation model (U²-Netp for objects,
// MODNet for people; vendor/onnx, licences in vendor/MANIFEST.json) runs in a module worker on
// onnxruntime-web (WASM). The coarse mask is snapped to the photo's edges with a guided filter (worker),
// refined here (edge shift, feather, brush edits) and applied at full resolution: transparent, colour,
// blurred original or a custom picture behind the subject; PNG/WebP/JPG; optional trim to the subject.
// The model and runtime are fetched only on this page (first use) and cached for offline use.
import { el, clear, icon } from '../lib/dom.js';
import { loadCanvas, release, encode, encodeSupport, FORMATS, scaleTo, newCanvas, ctx2d, resultCompare, ensureCss as ensureImgCss, userError } from '../lib/img-core.js';
import { ensureCss, T, iconBtn, slider, svg, ICON } from '../lib/new-ui.js';
import { formatSize } from '../lib/format.js';
import { MODELS, RUNTIME_BYTES, RUNTIME_GZ, refineMask, applyEdits, feather, subjectBox, alphaToRGBA, boxBlur } from '../lib/bg-core.js';

ensureCss();
ensureImgCss();
{
  const href = new URL('../lib/bg.css', import.meta.url).href;
  if (!document.querySelector(`link[href="${href}"]`)) document.head.append(el('link', { rel: 'stylesheet', href }));
}

const MID = 1280;          // working size (long side) of masks, edits and the editor preview
const HARD = 0.6;          // steepness of the edge transition (refineMask)
const MASK_CACHE = 24;     // masks kept in memory (≈ 1.2 MB each)

// ---------------------------------------------------------------- worker (model download + inference)
let worker = null, msgId = 0;
const waiting = new Map();            // id → {resolve, reject}
const loads = new Map();              // model → Promise
const progressListeners = new Set();
let lastProgress = null;

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('../lib/bg-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ev => {
    const m = ev.data || {};
    if (m.type === 'progress') { lastProgress = m; progressListeners.forEach(f => f(m)); return; }
    const w = waiting.get(m.id);
    if (!w) return;
    waiting.delete(m.id);
    if (m.type === 'error') w.reject(workerError(m)); else w.resolve(m);
  };
  worker.onerror = ev => { ev.preventDefault?.(); console.warn('bg worker failed', ev.message); resetWorker(workerError({ code: 'worker' })); };
  return worker;
}
function resetWorker(err) {
  worker?.terminate();
  worker = null;
  loads.clear();
  for (const w of waiting.values()) w.reject(err);
  waiting.clear();
}
function workerError(m) {
  console.warn('bg:', m.code, m.message || '');
  if (m.code === 'download') return userError('Das KI-Modell konnte nicht geladen werden. Prüf deine Internetverbindung – nach dem ersten Laden klappt es auch offline.', 'The AI model could not be loaded. Check your internet connection – after the first load it also works offline.');
  return userError('Die Erkennung ist in diesem Browser fehlgeschlagen. Ein aktueller Browser (Chrome, Safari, Firefox, Edge) wird benötigt – bei sehr wenig freiem Speicher hilft es, andere Tabs zu schließen.', 'Detection failed in this browser. A current browser (Chrome, Safari, Firefox, Edge) is needed – with very little free memory, closing other tabs helps.');
}
function call(msg, transfer, signal) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    waiting.set(id, { resolve, reject });
    const onAbort = () => { resetWorker(Object.assign(new DOMException('Aborted', 'AbortError'))); };
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }
    getWorker().postMessage({ ...msg, id }, transfer);
  });
}
function loadModel(model, signal) {
  if (!loads.has(model)) {
    const p = call({ type: 'load', model }, [], signal);
    p.catch(() => loads.delete(model));
    loads.set(model, p);
  }
  return loads.get(model);
}

// ---------------------------------------------------------------- masks (cached per input + model)
const lru = [];
function remember(input) {
  const i = lru.indexOf(input);
  if (i >= 0) lru.splice(i, 1);
  lru.push(input);
  while (lru.length > MASK_CACHE) { const old = lru.shift(); old._bg = null; }
}
/** Edge-aware mask of the photo at the working size: { model, w, h, mask (Uint8Array 0…255), ms }. */
function getMask(input, model, signal) {
  input._bg ||= {};
  if (!input._bg[model]) {
    const p = (async () => {
      const { canvas } = await loadCanvas(input, { maxSide: MID });
      const w = canvas.width, h = canvas.height;
      const rgba = ctx2d(canvas, true).getImageData(0, 0, w, h).data.buffer;
      release(canvas);
      await loadModel(model, signal);
      const m = await call({ type: 'segment', model, w, h, rgba }, [rgba], signal);
      return { model, w, h, mask: new Uint8Array(m.mask), ms: m.ms };
    })();
    p.catch(() => { if (input._bg) delete input._bg[model]; });
    input._bg[model] = p;
  }
  remember(input);
  return input._bg[model];
}

// ---------------------------------------------------------------- alpha + compositing
function rasterEdits(edits, w, h) {
  if (!edits?.length) return null;
  const c = newCanvas(w, h), g = ctx2d(c, true);
  const S = Math.max(w, h);
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const s of edits) drawStroke(g, s, S, w, h);
  const data = g.getImageData(0, 0, w, h).data;
  release(c);
  return data;
}
function drawStroke(g, s, S, w, h, from = 0) {
  const col = s.m === 'keep' ? '#ffffff' : '#000000';
  g.strokeStyle = col; g.fillStyle = col;
  g.lineWidth = Math.max(1, s.r * S * 2);
  const p = s.p;
  if (p.length === 2 || from >= p.length - 2) {
    const i = p.length - 2;
    g.beginPath(); g.arc(p[i] * w, p[i + 1] * h, Math.max(0.5, s.r * S), 0, Math.PI * 2); g.fill();
    if (p.length === 2) return;
  }
  g.beginPath();
  const st = Math.max(0, from - 2);
  g.moveTo(p[st] * w, p[st + 1] * h);
  for (let i = st + 2; i < p.length; i += 2) g.lineTo(p[i] * w, p[i + 1] * h);
  g.stroke();
}

/** Final alpha (Float32 0…1) at the mask size. `outLong` = long side of the output (feather is in output px). */
function buildAlpha(bg, edits, opts, outLong) {
  const a = refineMask(bg.mask, +opts.shift || 0, HARD);
  applyEdits(a, rasterEdits(edits, bg.w, bg.h));
  feather(a, bg.w, bg.h, (+opts.feather || 0) * Math.max(bg.w, bg.h) / outLong);
  return a;
}
function alphaCanvas(alpha, w, h) {
  const c = newCanvas(w, h);
  ctx2d(c).putImageData(new ImageData(alphaToRGBA(alpha), w, h), 0, 0);
  return c;
}

/** Strong, cheap blur: downscale, box-blur the small copy twice, scale back up (smooth). */
function blurredCopy(src, W, H, strength) {
  const long = Math.max(16, Math.round(520 / Math.max(1, strength)));
  const f = Math.min(1, long / Math.max(W, H));
  const sw = Math.max(2, Math.round(W * f)), sh = Math.max(2, Math.round(H * f));
  const small = scaleTo(src, sw, sh);
  const g = ctx2d(small, true), img = g.getImageData(0, 0, sw, sh), d = img.data, n = sw * sh;
  const ch = new Float32Array(n), tmp = new Float32Array(n), out = new Float32Array(n);
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < n; i++) ch[i] = d[i * 4 + c];
    boxBlur(ch, sw, sh, 2, out, tmp); boxBlur(out, sw, sh, 2, ch, tmp);
    for (let i = 0; i < n; i++) d[i * 4 + c] = ch[i];
  }
  g.putImageData(img, 0, 0);
  const big = newCanvas(W, H), bg = ctx2d(big);
  bg.imageSmoothingEnabled = true; bg.imageSmoothingQuality = 'high';
  bg.drawImage(small, 0, 0, W, H);
  release(small);
  return big;
}

function drawCover(g, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/**
 * Composite: photo canvas `src` (any size) + alpha canvas → new canvas with the chosen background.
 * crop = {x, y, w, h} in src pixels or null. `ghost` draws the removed parts faintly (editor).
 */
function composite(src, aCanvas, opts, { crop = null, ghost = 0, consume = false } = {}) {
  const W = src.width, H = src.height;
  const cr = crop || { x: 0, y: 0, w: W, h: H };
  const back = opts.bg === 'blur' ? blurredCopy(src, W, H, +opts.blur || 5) : null;
  // cut-out
  let cut = src;
  if (!consume) { cut = newCanvas(W, H); ctx2d(cut).drawImage(src, 0, 0); }
  const cg = ctx2d(cut);
  cg.globalCompositeOperation = 'destination-in';
  cg.imageSmoothingEnabled = true; cg.imageSmoothingQuality = 'high';
  cg.drawImage(aCanvas, 0, 0, W, H);
  cg.globalCompositeOperation = 'source-over';
  if (!crop && !ghost && (opts.bg === 'transparent' || (opts.bg === 'image' && !bgImage))) return cut;
  const out = newCanvas(cr.w, cr.h), g = ctx2d(out);
  if (opts.bg === 'color') { g.fillStyle = opts.bgColor || '#ffffff'; g.fillRect(0, 0, cr.w, cr.h); }
  else if (opts.bg === 'blur') g.drawImage(back, -cr.x, -cr.y);
  else if (opts.bg === 'image' && bgImage) drawCover(g, bgImage.bitmap, 0, 0, cr.w, cr.h);
  if (ghost && !consume) { g.globalAlpha = ghost; g.drawImage(src, -cr.x, -cr.y); g.globalAlpha = 1; }
  g.drawImage(cut, -cr.x, -cr.y);
  release(back);
  if (cut !== src || consume) release(cut);
  return out;
}

const inputHint = (de, en) => Object.assign(userError(de, en), { stay: true });
let bgImage = null; // { bitmap, name, url }
let stageApi = null;

// ---------------------------------------------------------------- texts
const MB = (b, lang) => formatSize(b, lang);
const firstLoad = (lang, model) => {
  const m = MODELS[model], gz = MB(RUNTIME_GZ + m.gz, lang), max = MB(RUNTIME_BYTES + m.bytes, lang);
  return T(lang, {
    de: `Beim ersten Mal lädt dein Browser das KI-Modell und die Rechen-Engine: etwa ${gz} (ohne Komprimierung bis zu ${max}). Danach sind sie gespeichert und funktionieren auch offline. Deine Fotos werden nicht hochgeladen.`,
    en: `The first time, your browser downloads the AI model and the engine: about ${gz} (up to ${max} without compression). After that they are stored and also work offline. Your photos are not uploaded.`,
  });
};

export default {
  options: [
    { id: 'model', type: 'radio', default: 'object', label: { de: 'Was ist auf dem Foto?', en: 'What is in the photo?' },
      choices: [
        { value: 'object', label: { de: 'Objekt, Produkt, Tier', en: 'Object, product, animal' }, hint: { de: 'Allgemeines Modell – auch für ganze Personen', en: 'General model – also for full-length people' } },
        { value: 'person', label: { de: 'Person (Porträt)', en: 'Person (portrait)' }, hint: { de: 'Für Porträts und Oberkörper, genauer bei Haaren', en: 'For portraits and upper body, more precise with hair' } },
      ] },
    { id: 'bg', type: 'radio', default: 'transparent', live: true, label: { de: 'Neuer Hintergrund', en: 'New background' },
      choices: [
        { value: 'transparent', label: { de: 'Transparent', en: 'Transparent' } },
        { value: 'color', label: { de: 'Farbe', en: 'Colour' } },
        { value: 'blur', label: { de: 'Original unscharf', en: 'Blurred original' } },
        { value: 'image', label: { de: 'Eigenes Bild', en: 'Own picture' } },
      ] },
    { id: 'bgColor', type: 'color', default: '#ffffff', live: true, label: { de: 'Hintergrundfarbe', en: 'Background colour' }, when: v => v.bg === 'color' },
    { id: 'blur', type: 'range', default: 5, min: 1, max: 10, step: 1, live: true, label: { de: 'Unschärfe', en: 'Blur' }, when: v => v.bg === 'blur' },
    { id: 'shift', type: 'range', default: 0, min: -50, max: 50, step: 5, live: true, label: { de: 'Kante: enger ↔ weiter', en: 'Edge: tighter ↔ looser' },
      hint: { de: 'Nach links schneidet mehr ab (Reste vom Hintergrund weg), nach rechts bleibt mehr vom Motiv.', en: 'Left cuts more away (removes leftovers of the background), right keeps more of the subject.' },
      format: (v, lang) => (v > 0 ? '+' : '') + v },
    { id: 'feather', type: 'range', default: 1, min: 0, max: 20, step: 1, unit: 'px', live: true, label: { de: 'Weiche Kante', en: 'Soft edge' } },
    { id: 'trim', type: 'toggle', default: false, live: true, label: { de: 'Auf das Motiv zuschneiden', en: 'Crop to the subject' } },
    { id: 'format', type: 'select', default: 'png', live: true, label: { de: 'Speichern als', en: 'Save as' },
      choices: [
        { value: 'png', label: { de: 'PNG (mit Transparenz)', en: 'PNG (with transparency)' } },
        { value: 'webp', label: { de: 'WebP (kleiner, mit Transparenz)', en: 'WebP (smaller, with transparency)' } },
        { value: 'jpg', label: { de: 'JPG (ohne Transparenz)', en: 'JPG (no transparency)' } },
      ] },
  ],

  mountStage(stage, state, ctx) { stageApi = bgStage(stage, state, ctx); },
  onInputs(inputs) { stageApi?.refresh(inputs); },
  onOptionsChange(values) { stageApi?.optionsChanged(values); },
  onResult(resultEl, res, ctx) {
    resultCompare(resultEl, res, ctx);
    resultEl.querySelector('.img-result-cmp')?.classList.add('bg-cmp');
  },

  async run(inputs, opts, ctx) {
    if (opts.bg === 'image' && !bgImage) throw inputHint('Wähl zuerst ein Hintergrundbild (oben unter dem Vorschaubild).', 'First choose a background picture (above, below the preview).');
    const support = await encodeSupport();
    let fmt = support[opts.format] ? opts.format : 'png';
    const outputs = [];
    const onProg = m => ctx.progress(null, { de: `KI-Modell wird geladen … ${Math.round((m.loaded / m.total) * 100)} %`, en: `Loading the AI model … ${Math.round((m.loaded / m.total) * 100)} %` });
    progressListeners.add(onProg);
    let flattened = false;
    try {
      for (const [i, input] of inputs.entries()) {
        ctx.progress(i / inputs.length, { de: `Bild ${i + 1} von ${inputs.length}: Motiv erkennen …`, en: `Image ${i + 1} of ${inputs.length}: detecting the subject …` });
        const bg = await getMask(input, opts.model, ctx.signal);
        ctx.throwIfAborted();
        ctx.progress((i + 0.6) / inputs.length, { de: `Bild ${i + 1} von ${inputs.length}: freistellen …`, en: `Image ${i + 1} of ${inputs.length}: cutting out …` });
        await ctx.tick();
        const { canvas: full, width, height } = await loadCanvas(input);
        const W = full.width, H = full.height;
        const alpha = buildAlpha(bg, input.opts.bgEdits, opts, Math.max(W, H));
        let crop = null;
        if (opts.trim) {
          const b = subjectBox(alpha, bg.w, bg.h);
          if (b) {
            const kx = W / bg.w, ky = H / bg.h, pad = Math.round(Math.max(W, H) * 0.02);
            const x = Math.max(0, Math.floor(b.x * kx) - pad), y = Math.max(0, Math.floor(b.y * ky) - pad);
            crop = { x, y, w: Math.min(W, Math.ceil((b.x + b.w) * kx) + pad) - x, h: Math.min(H, Math.ceil((b.y + b.h) * ky) + pad) - y };
          }
        }
        const empty = !subjectBox(alpha, bg.w, bg.h, 0.5);
        const ac = alphaCanvas(alpha, bg.w, bg.h);
        await ctx.tick();
        const out = composite(full, ac, opts, { crop, consume: true });
        release(ac);
        const transparent = opts.bg === 'transparent' || (opts.bg === 'image' && !bgImage);
        if (fmt === 'jpg' && transparent) flattened = true;
        const blob = await encode(out, { format: fmt, quality: 0.92, background: '#ffffff' });
        const ow = out.width, oh = out.height;
        release(out, full);
        const note = `${ow} × ${oh} px` + (W < width ? ctx.t({ de: ' (verkleinert – sehr großes Bild)', en: ' (reduced – very large image)' }) : '')
          + (empty ? ctx.t({ de: ' · Kein Motiv erkannt – versuch das andere Modell oder den Pinsel „Behalten“.', en: ' · No subject found – try the other model or the “Keep” brush.' }) : '');
        outputs.push({ name: ctx.fileName(input.name, ctx.t({ de: ' (freigestellt)', en: ' (cut out)' }), FORMATS[fmt].ext), blob, note, meta: { input, width: ow, height: oh, noCompare: !!crop } });
        await ctx.tick();
      }
    } finally { progressListeners.delete(onProg); }
    if (flattened) ctx.note({ de: 'JPG kann keine Transparenz speichern – der Hintergrund ist deshalb weiß. Für Transparenz wähl PNG oder WebP.', en: 'JPG can’t store transparency, so the background is white. For transparency choose PNG or WebP.' });
    if (fmt !== opts.format) ctx.note({ de: 'Dein Browser kann dieses Format nicht speichern – es wurde PNG verwendet.', en: 'Your browser can’t save this format – PNG was used.' });
    stageApi?.update();
    return { outputs };
  },
};

// ---------------------------------------------------------------- stage: preview, brush, pinch-zoom
function bgStage(stage, state, ctx) {
  const lang = ctx.lang;
  let current = null, photo = null, bg = null, base = null, alphaArr = null, aCan = null, editLayer = null, seq = 0;
  let mode = 'pan', zoom = 1, tx = 0, ty = 0, fitS = 1, showOriginal = false;
  const values = () => state.values;
  const edits = () => (current ? (current.opts.bgEdits ||= []) : []);

  const statusText = el('span', { class: 'bg-status-text', aria: { live: 'polite' } });
  const bar = el('progress', { max: '1', hidden: true });
  const status = el('div', { class: 'bg-status' }, bar, statusText);
  const note = el('p', { class: 'new-muted' }, firstLoad(lang, values().model || 'object'));
  const thumbs = el('div', { class: 'new-thumbs', role: 'group', aria: { label: T(lang, { de: 'Bild wählen', en: 'Choose image' }) } });
  const canvas = el('canvas', { aria: { hidden: 'true' } });
  const ring = el('div', { class: 'bg-ring' });
  const empty = el('div', { class: 'bg-empty' }, T(lang, { de: 'Vorschau erscheint, sobald das Motiv erkannt ist.', en: 'The preview appears as soon as the subject is detected.' }));
  const view = el('div', { class: 'bg-view', tabindex: '0', role: 'img', dataset: { mode },
    aria: { label: T(lang, { de: 'Vorschau. Zwei Finger: zoomen und verschieben. Mit Pinsel: Bereiche behalten oder entfernen.', en: 'Preview. Two fingers: zoom and pan. With a brush: keep or remove areas.' }) } }, canvas, ring, empty);

  const modeDefs = [
    ['pan', { de: 'Ansehen', en: 'View' }, ['M5 9l-3 3 3 3', 'M9 5l3-3 3 3', 'M15 19l-3 3-3-3', 'M19 9l3 3-3 3', 'M2 12h20', 'M12 2v20']],
    ['keep', { de: 'Behalten', en: 'Keep' }, ['M12 5v14', 'M5 12h14']],
    ['erase', { de: 'Entfernen', en: 'Remove' }, ['M5 12h14']],
  ];
  const modeBtns = modeDefs.map(([id, label, paths]) => el('button', { type: 'button', class: 'new-chip', aria: { pressed: String(id === mode) }, dataset: { mode: id }, onclick: () => setMode(id) }, svg(paths), T(lang, label)));
  const modes = el('fieldset', { class: 'bg-modes' }, el('legend', {}, T(lang, { de: 'Pinsel', en: 'Brush' })), modeBtns);
  const size = slider({ id: 'bg-brush', label: { de: 'Pinselgröße', en: 'Brush size' }, min: 4, max: 80, step: 2, value: 22, lang, format: v => `${v} px`, onInput: () => {} });
  const undoBtn = iconBtn(['M9 14L4 9l5-5', 'M4 9h11a5 5 0 0 1 0 10h-3'], T(lang, { de: 'Rückgängig', en: 'Undo' }), () => { edits().pop(); full(); changed(); }, { text: T(lang, { de: 'Rückgängig', en: 'Undo' }) });
  const resetBtn = iconBtn(ICON.reset, T(lang, { de: 'Pinselstriche löschen', en: 'Clear brush strokes' }), () => { if (current) current.opts.bgEdits = []; full(); changed(); }, { text: T(lang, { de: 'Striche löschen', en: 'Clear strokes' }) });
  const tools = el('div', { class: 'new-tools' },
    iconBtn(ICON.zoomIn, T(lang, { de: 'Vergrößern', en: 'Zoom in' }), () => zoomBy(1.5)),
    iconBtn(ICON.zoomOut, T(lang, { de: 'Verkleinern', en: 'Zoom out' }), () => zoomBy(1 / 1.5)),
    iconBtn(ICON.fit, T(lang, { de: 'Ganzes Bild', en: 'Whole image' }), () => { zoom = 1; layout(); }),
    undoBtn, resetBtn);
  const origBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm', aria: { pressed: 'false' }, onclick: () => {
    showOriginal = !showOriginal; origBtn.setAttribute('aria-pressed', String(showOriginal)); render();
  } }, T(lang, { de: 'Original zeigen', en: 'Show original' }));
  tools.append(origBtn);

  // custom background picture
  const file = el('input', { type: 'file', accept: 'image/*', class: 'bg-file', id: 'bg-file', tabindex: '-1', aria: { hidden: 'true' } });
  const thumb = el('img', { alt: '', hidden: true });
  const pickBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm', onclick: () => file.click() }, icon('image'), T(lang, { de: 'Hintergrundbild wählen', en: 'Choose background picture' }));
  const bgName = el('span', { class: 'new-muted' });
  const bgImgRow = el('div', { class: 'bg-bgimg', hidden: true }, pickBtn, thumb, bgName, file);
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    try {
      const bitmap = await createImageBitmap(f);
      if (bgImage) { bgImage.bitmap.close?.(); URL.revokeObjectURL(bgImage.url); }
      bgImage = { bitmap, name: f.name, url: URL.createObjectURL(f) };
      thumb.src = bgImage.url; thumb.hidden = false; bgName.textContent = f.name;
      changed(); render();
    } catch (err) { console.warn(err); bgName.textContent = T(lang, { de: 'Dieses Bild kann dein Browser nicht öffnen.', en: 'Your browser can’t open this picture.' }); }
  });

  const limits = el('p', { class: 'new-muted bg-limits' }, T(lang, {
    de: 'Gut für klare Motive vor ruhigem Hintergrund. Feine Haare, Fell, Glas, Rauch und Motive mit wenig Kontrast zum Hintergrund werden oft nicht sauber getrennt – korrigier das mit „Behalten“ und „Entfernen“.',
    en: 'Works best for clear subjects against a calm background. Fine hair, fur, glass, smoke and subjects with little contrast to the background are often not separated cleanly – fix that with “Keep” and “Remove”.' }));

  stage.append(el('section', { class: 'new-box bg-box', aria: { labelledby: 'bg-h' } },
    el('h2', { id: 'bg-h' }, T(lang, { de: 'Vorschau und Feinschliff', en: 'Preview and touch-up' })),
    status, thumbs, view, bgImgRow, modes, size.root, tools,
    el('p', { class: 'new-muted' }, T(lang, { de: 'Zwei Finger zoomen und verschieben. Mit „Behalten“ malst du Teile zurück, mit „Entfernen“ wischst du Reste weg. Entfernte Bereiche sind beim Malen blass zu sehen.', en: 'Two fingers zoom and pan. “Keep” paints parts back in, “Remove” wipes leftovers away. Removed areas show faintly while painting.' })),
    note, limits));

  function changed() { state.results.clear(); ctx.refresh(); }
  function setStatus(text, frac = null) {
    statusText.textContent = text;
    bar.hidden = frac == null;
    if (frac != null) bar.value = Math.max(0, Math.min(1, frac));
  }
  const onProg = m => { if (current) setStatus(T(lang, { de: `KI-Modell wird geladen … ${MB(m.loaded, 'de')} von ${MB(m.total, 'de')}`, en: `Loading the AI model … ${MB(m.loaded, 'en')} of ${MB(m.total, 'en')}` }), m.loaded / m.total); };
  progressListeners.add(onProg);

  function setMode(m) {
    mode = m; view.dataset.mode = m;
    modeBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
    render();
  }

  // ---- geometry
  function layout() {
    if (!photo) return;
    const vw = view.clientWidth || 340, vh = view.clientHeight || 300;
    fitS = Math.min(vw / photo.width, vh / photo.height);
    zoom = Math.max(1, Math.min(zoom, 12));
    const s = fitS * zoom, cw = photo.width * s, ch = photo.height * s;
    // keep the picture inside the view (centred when smaller)
    tx = cw <= vw ? (vw - cw) / 2 : Math.min(0, Math.max(vw - cw, tx));
    ty = ch <= vh ? (vh - ch) / 2 : Math.min(0, Math.max(vh - ch, ty));
    canvas.style.width = photo.width * fitS + 'px';
    canvas.style.height = photo.height * fitS + 'px';
    canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${zoom})`;
  }
  function zoomBy(f, cx, cy) {
    const vw = view.clientWidth, vh = view.clientHeight;
    cx ??= vw / 2; cy ??= vh / 2;
    const nz = Math.max(1, Math.min(12, zoom * f)), k = nz / zoom;
    tx = cx - (cx - tx) * k; ty = cy - (cy - ty) * k; zoom = nz;
    layout();
  }
  function toImage(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return [(clientX - r.left) / r.width, (clientY - r.top) / r.height];
  }

  // ---- rendering
  function full() {
    if (!bg) return;
    base = refineMask(bg.mask, +values().shift || 0, HARD);
    redrawEdits();
    recompute(true);
  }
  function redrawEdits() {
    const g = ctx2d(editLayer, true);
    g.clearRect(0, 0, bg.w, bg.h);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const s of edits()) drawStroke(g, s, Math.max(bg.w, bg.h), bg.w, bg.h);
  }
  function recompute(withFeather, rect = null) {
    const w = bg.w, h = bg.h;
    const r = rect || { x: 0, y: 0, w, h };
    const ed = ctx2d(editLayer, true).getImageData(r.x, r.y, r.w, r.h).data;
    const ag = ctx2d(aCan, true);
    if (!rect) {
      alphaArr = base.slice();
      applyEdits(alphaArr, ed);
      if (withFeather) feather(alphaArr, w, h, (+values().feather || 0) * Math.max(w, h) / Math.max(current._bgDims?.[0] || w, current._bgDims?.[1] || h));
      ag.putImageData(new ImageData(alphaToRGBA(alphaArr), w, h), 0, 0);
    } else {
      const img = ag.createImageData(r.w, r.h), d = img.data;
      for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
        const i = (r.y + y) * w + r.x + x, j = (y * r.w + x) * 4, k = ed[j + 3] / 255;
        const a = k ? base[i] * (1 - k) + (ed[j] / 255) * k : alphaArr[i];
        d[j + 3] = a * 255;
      }
      ag.putImageData(img, r.x, r.y);
    }
    render();
  }
  let raf = 0;
  function render() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!photo) return;
      const g = ctx2d(canvas);
      g.clearRect(0, 0, canvas.width, canvas.height);
      if (showOriginal || !aCan) { g.drawImage(photo, 0, 0); return; }
      const v = values();
      const out = composite(photo, aCan, { ...v, bg: v.bg === 'image' && !bgImage ? 'transparent' : v.bg }, { ghost: mode === 'pan' ? 0 : 0.3 });
      g.drawImage(out, 0, 0);
      release(out);
    });
  }

  // ---- pointers: 1 finger = brush or pan, 2 fingers = pinch zoom + pan
  const pts = new Map();
  let stroke = null, pinch = null, pan = null;
  view.addEventListener('pointerdown', ev => {
    if (!photo || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    view.setPointerCapture?.(ev.pointerId);
    pts.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (pts.size === 2) {
      if (stroke) { edits().pop(); stroke = null; full(); }
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: zoom, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2, tx, ty };
      pan = null;
      return;
    }
    if (pts.size > 2) return;
    if (mode === 'pan' || !bg) { pan = { x: ev.clientX, y: ev.clientY, tx, ty }; return; }
    const [x, y] = toImage(ev.clientX, ev.clientY);
    const r = size.input.value / (fitS * zoom) / Math.max(photo.width, photo.height);
    stroke = { m: mode, r: +r.toFixed(5), p: [+x.toFixed(5), +y.toFixed(5)] };
    edits().push(stroke);
    paintStroke(0);
    moveRing(ev);
  });
  view.addEventListener('pointermove', ev => {
    moveRing(ev);
    if (!pts.has(ev.pointerId)) return;
    pts.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (pinch && pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]), vr = view.getBoundingClientRect();
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const nz = Math.max(1, Math.min(12, pinch.z * d / Math.max(1, pinch.d))), k = nz / pinch.z;
      zoom = nz;
      tx = (mx - vr.left) - ((pinch.mx - vr.left) - pinch.tx) * k;
      ty = (my - vr.top) - ((pinch.my - vr.top) - pinch.ty) * k;
      layout();
    } else if (pan) {
      tx = pan.tx + ev.clientX - pan.x; ty = pan.ty + ev.clientY - pan.y; layout();
    } else if (stroke) {
      const [x, y] = toImage(ev.clientX, ev.clientY);
      const n = stroke.p.length;
      stroke.p.push(+x.toFixed(5), +y.toFixed(5));
      paintStroke(n);
    }
  });
  const up = ev => {
    pts.delete(ev.pointerId);
    if (pts.size < 2) pinch = null;
    if (!pts.size) {
      pan = null;
      if (stroke) { stroke = null; full(); changed(); }
    }
    if (ev.pointerType !== 'mouse') view.classList.remove('is-brushing');
  };
  view.addEventListener('pointerup', up);
  view.addEventListener('pointercancel', up);
  view.addEventListener('pointerleave', ev => { if (ev.pointerType === 'mouse') view.classList.remove('is-brushing'); });
  view.addEventListener('wheel', ev => {
    if (!photo) return;
    ev.preventDefault();
    const r = view.getBoundingClientRect();
    zoomBy(ev.deltaY < 0 ? 1.15 : 1 / 1.15, ev.clientX - r.left, ev.clientY - r.top);
  }, { passive: false });
  view.addEventListener('keydown', ev => {
    const step = 40;
    if (ev.key === '+' || ev.key === '=') zoomBy(1.25);
    else if (ev.key === '-') zoomBy(1 / 1.25);
    else if (ev.key === 'ArrowLeft') { tx += step; layout(); }
    else if (ev.key === 'ArrowRight') { tx -= step; layout(); }
    else if (ev.key === 'ArrowUp') { ty += step; layout(); }
    else if (ev.key === 'ArrowDown') { ty -= step; layout(); }
    else return;
    ev.preventDefault();
  });
  function moveRing(ev) {
    if (mode === 'pan' || !photo) { view.classList.remove('is-brushing'); return; }
    const vr = view.getBoundingClientRect(), d = +size.input.value * 2;
    ring.style.width = ring.style.height = d + 'px';
    ring.style.left = ev.clientX - vr.left - d / 2 + 'px';
    ring.style.top = ev.clientY - vr.top - d / 2 + 'px';
    view.classList.add('is-brushing');
  }
  function paintStroke(from) {
    if (!bg) return;
    const g = ctx2d(editLayer, true), S = Math.max(bg.w, bg.h);
    g.lineCap = 'round'; g.lineJoin = 'round';
    drawStroke(g, stroke, S, bg.w, bg.h, from);
    // dirty rectangle of the new segment
    const p = stroke.p, rr = stroke.r * S + 2;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = Math.max(0, from - 2); i < p.length; i += 2) { x0 = Math.min(x0, p[i] * bg.w); x1 = Math.max(x1, p[i] * bg.w); y0 = Math.min(y0, p[i + 1] * bg.h); y1 = Math.max(y1, p[i + 1] * bg.h); }
    const x = Math.max(0, Math.floor(x0 - rr)), y = Math.max(0, Math.floor(y0 - rr));
    const w = Math.min(bg.w, Math.ceil(x1 + rr)) - x, h = Math.min(bg.h, Math.ceil(y1 + rr)) - y;
    if (w > 0 && h > 0) recompute(false, { x, y, w, h });
  }

  // ---- selecting an image / detecting
  let shown = null;
  async function select(input) {
    current = input; shown = null;
    setStatus(T(lang, { de: 'Bild wird geladen …', en: 'Loading the image …' }));
    for (const b of thumbs.children) b.setAttribute('aria-pressed', String(b._input === input));
    const my = ++seq;
    const model = values().model || 'object';
    bg = null; aCan = null;
    empty.hidden = false;
    let c;
    try { c = await loadCanvas(input, { maxSide: MID }); } catch (err) { console.warn(err); setStatus(T(lang, err.userMessage || { de: 'Dieses Bild kann dein Browser nicht öffnen.', en: 'Your browser can’t open this image.' })); return; }
    if (my !== seq) { release(c.canvas); return; }
    if (photo) release(photo);
    photo = c.canvas;
    input._bgDims = [c.width, c.height];
    canvas.width = photo.width; canvas.height = photo.height;
    zoom = 1; layout(); empty.hidden = true; render();
    setStatus(T(lang, loads.has(model) ? { de: 'Motiv wird erkannt …', en: 'Detecting the subject …' } : { de: 'KI-Modell wird vorbereitet …', en: 'Preparing the AI model …' }), loads.has(model) ? null : 0);
    const t0 = performance.now();
    let m;
    try { m = await getMask(input, model); } catch (err) {
      if (my === seq) setStatus(T(lang, err.userMessage || (err.name === 'AbortError' ? { de: 'Abgebrochen. Tipp auf das Bild oben, um es erneut zu versuchen.', en: 'Cancelled. Tap the image above to try again.' } : { de: 'Die Erkennung ist fehlgeschlagen.', en: 'Detection failed.' })));
      return;
    }
    if (my !== seq || model !== (values().model || 'object')) return;
    bg = m; shown = input;
    editLayer = newCanvas(bg.w, bg.h);
    aCan = newCanvas(bg.w, bg.h);
    full();
    const secs = ((performance.now() - t0) / 1000).toFixed(1).replace('.', lang === 'de' ? ',' : '.');
    setStatus(T(lang, { de: `Motiv erkannt (${secs} s). Prüf die Kanten und korrigier sie bei Bedarf mit dem Pinsel.`, en: `Subject detected (${secs} s). Check the edges and touch them up with the brush if needed.` }));
    changed();
  }
  function refresh(inputs = state.inputs.filter(i => !i.error)) {
    clear(thumbs);
    thumbs.hidden = inputs.length < 2;
    for (const input of inputs) {
      const b = el('button', { type: 'button', class: 'new-thumb', aria: { pressed: 'false', label: input.name }, onclick: () => select(input) });
      b._input = input;
      thumbs.append(b);
      if (inputs.length > 1) input.thumbnail(64).then(c => c.toBlob(bl => { if (!bl) return; const img = el('img', { alt: '' }); img.src = URL.createObjectURL(bl); img.onload = () => URL.revokeObjectURL(img.src); b.append(img); })).catch(() => {});
    }
    if (!inputs.includes(current)) current = inputs[0] || null;
    if (current && current === shown && bg) { for (const b of thumbs.children) b.setAttribute('aria-pressed', String(b._input === current)); return; }
    if (current) select(current);
  }
  let lastModel = values().model, lastShift = values().shift;
  function optionsChanged(v) {
    bgImgRow.hidden = v.bg !== 'image';
    note.textContent = firstLoad(lang, v.model || 'object');
    if (v.model !== lastModel) { lastModel = v.model; if (current) select(current); return; }
    if (v.shift !== lastShift) { lastShift = v.shift; full(); return; }
    if (bg) recompute(true); else render();
  }
  let rt = 0;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(layout, 150); });
  refresh();
  optionsChanged(values());
  return { refresh, optionsChanged, update: () => { if (bg) full(); bgImgRow.hidden = values().bg !== 'image'; } };
}
