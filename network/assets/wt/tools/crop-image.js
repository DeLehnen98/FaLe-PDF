// Tool: crop images on the phone – touch crop frame with aspect presets (free, original, 1:1, 4:5, 4:3,
// 3:2, 16:9, portrait variants, A4), quarter turns, flips and a straighten slider (auto-zoom, no empty
// corners). Several images: each keeps its own settings, "apply to all" copies them. Output in the
// original format (or JPG/PNG/WebP), exact pixel size shown live. Metadata is not carried over.
import { el, clear } from '../lib/dom.js';
import { loadCanvas, release, encode, keepFormat, encodeSupport, FORMATS } from '../lib/img-core.js';
import { ensureCss, T, iconBtn, ICON, slider } from '../lib/new-ui.js';
import { createCropBox } from '../lib/new-cropbox.js';
import { drawTransformed, turnedSize } from '../lib/new-img.js';

ensureCss();

export const ASPECTS = [
  { id: 'free', label: { de: 'Frei', en: 'Free' }, r: null },
  { id: 'orig', label: { de: 'Original', en: 'Original' }, r: 'orig' },
  { id: '1:1', label: '1:1', r: 1 },
  { id: '4:5', label: '4:5', r: 4 / 5 },
  { id: '4:3', label: '4:3', r: 4 / 3 },
  { id: '3:4', label: '3:4', r: 3 / 4 },
  { id: '3:2', label: '3:2', r: 3 / 2 },
  { id: '16:9', label: '16:9', r: 16 / 9 },
  { id: '9:16', label: '9:16', r: 9 / 16 },
  { id: 'a4', label: { de: 'A4 hoch', en: 'A4 portrait' }, r: 210 / 297 },
];
const DEFAULT = () => ({ rot: 0, flipH: false, flipV: false, angle: 0, aspect: 'free', rect: { x: 0, y: 0, w: 1, h: 1 } });
const stateOf = input => (input.opts.crop ||= DEFAULT());
const ratioOf = (st, W, H) => { const a = ASPECTS.find(x => x.id === st.aspect); return !a || !a.r ? null : a.r === 'orig' ? W / H : a.r; };

let stageApi = null;

export default {
  options: [
    { id: 'format', type: 'select', default: 'keep', label: { de: 'Speichern als', en: 'Save as' },
      choices: [
        { value: 'keep', label: { de: 'Wie das Original', en: 'Same as original' } },
        { value: 'jpg', label: 'JPG' }, { value: 'png', label: { de: 'PNG (verlustfrei)', en: 'PNG (lossless)' } }, { value: 'webp', label: 'WebP' },
      ] },
  ],
  mountStage(stage, state, ctx) { stageApi = cropStage(stage, state, ctx); },
  onInputs(inputs) { stageApi?.refresh(inputs); },

  status(values, inputs) {
    const changed = inputs.filter(i => { const c = i.opts.crop; return c && (c.rot || c.flipH || c.flipV || c.angle || c.rect.w < 0.999 || c.rect.h < 0.999); }).length;
    if (inputs.length && !changed) return { hint: { de: 'Zieh den Rahmen oder wähl ein Format, um zuzuschneiden.', en: 'Drag the frame or choose a format to crop.' } };
    return null;
  },

  async run(inputs, opts, ctx) {
    const support = await encodeSupport();
    const outputs = [];
    for (const [i, input] of inputs.entries()) {
      ctx.progress(i / inputs.length, { de: `Bild ${i + 1} von ${inputs.length}`, en: `Image ${i + 1} of ${inputs.length}` });
      const st = stateOf(input);
      const { canvas, width, height } = await loadCanvas(input);
      const k = canvas.width / width; // < 1 only for images beyond the canvas limit
      const [W, H] = turnedSize(canvas.width, canvas.height, st.rot);
      const crop = { x: Math.round(st.rect.x * W), y: Math.round(st.rect.y * H), w: Math.max(1, Math.round(st.rect.w * W)), h: Math.max(1, Math.round(st.rect.h * H)) };
      crop.w = Math.min(crop.w, W - crop.x); crop.h = Math.min(crop.h, H - crop.y);
      // a fixed ratio copied from another image ("apply to all"): keep the centre, fit the ratio
      const ratio = ratioOf(st, W, H);
      if (ratio && Math.abs(crop.w / crop.h / ratio - 1) > 0.01) {
        const cx = crop.x + crop.w / 2, cy = crop.y + crop.h / 2;
        let w = Math.min(W, Math.max(crop.w, crop.h * ratio)), h = w / ratio;
        if (h > H) { h = H; w = h * ratio; }
        crop.w = Math.round(w); crop.h = Math.round(h);
        crop.x = Math.round(Math.min(Math.max(0, cx - w / 2), W - crop.w)); crop.y = Math.round(Math.min(Math.max(0, cy - h / 2), H - crop.h));
      }
      const out = document.createElement('canvas');
      out.width = crop.w; out.height = crop.h;
      drawTransformed(out.getContext('2d'), canvas, canvas.width, canvas.height, st, crop);
      release(canvas);
      let fmt = opts.format === 'keep' ? keepFormat(input) : opts.format;
      if (!support[fmt]) fmt = 'png';
      const blob = await encode(out, { format: fmt, quality: 0.92 });
      outputs.push({ name: ctx.fileName(input.name, ctx.t({ de: ' (zugeschnitten)', en: ' (cropped)' }), FORMATS[fmt].ext), blob, note: `${out.width} × ${out.height} px` + (k < 1 ? ctx.t({ de: ' (verkleinert – sehr großes Bild)', en: ' (reduced – very large image)' }) : '') });
      release(out);
      await ctx.tick();
    }
    ctx.note({ de: 'Metadaten wie Kamera und Standort werden nicht übernommen.', en: 'Metadata such as camera and location is not carried over.' });
    return { outputs };
  },
};

function cropStage(stage, state, ctx) {
  const lang = ctx.lang;
  let current = null, preview = null, prevW = 0, prevH = 0, seq = 0;
  const thumbs = el('div', { class: 'new-thumbs', role: 'group', aria: { label: T(lang, { de: 'Bild wählen', en: 'Choose image' }) } });
  const box = createCropBox({ lang, onChange: r => { if (current) { stateOf(current).rect = r; changed(); } } });
  const view = el('div', { class: 'new-ed-view' }, box.root);
  const chipBtns = ASPECTS.map(a => el('button', { type: 'button', class: 'new-chip', aria: { pressed: 'false' }, dataset: { aspect: a.id }, onclick: () => setAspect(a.id) }, T(lang, a.label)));
  const chips = el('fieldset', { class: 'new-chips' }, el('legend', {}, T(lang, { de: 'Seitenverhältnis', en: 'Aspect ratio' })), chipBtns);
  const straighten = slider({ id: 'new-crop-angle', label: { de: 'Begradigen', en: 'Straighten' }, min: -45, max: 45, step: 0.5, value: 0, lang,
    format: v => `${v > 0 ? '+' : ''}${String(v).replace('.', lang === 'de' ? ',' : '.')}°`,
    onInput: v => { stateOf(current).angle = v; redraw(); changed(); } });
  const tool = (icn, de, en, fn) => iconBtn(icn, T(lang, { de, en }), fn);
  const tools = el('div', { class: 'new-tools' },
    tool(ICON.rotL, 'Nach links drehen', 'Rotate left', () => turn(-1)),
    tool(ICON.rotR, 'Nach rechts drehen', 'Rotate right', () => turn(1)),
    tool(ICON.flipH, 'Horizontal spiegeln', 'Flip horizontally', () => { const s = stateOf(current); s.flipH = !s.flipH; redraw(); changed(); }),
    tool(ICON.flipV, 'Vertikal spiegeln', 'Flip vertically', () => { const s = stateOf(current); s.flipV = !s.flipV; redraw(); changed(); }),
    iconBtn(ICON.reset, T(lang, { de: 'Alles zurücksetzen', en: 'Reset everything' }), () => { current.opts.crop = DEFAULT(); straighten.set(0); syncChips(); redraw(); box.rect = stateOf(current).rect; changed(); }, { text: T(lang, { de: 'Zurücksetzen', en: 'Reset' }) }));
  const applyAll = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm', hidden: true, onclick: () => {
    const src = stateOf(current);
    for (const i of state.inputs) if (i !== current && !i.error) i.opts.crop = JSON.parse(JSON.stringify(src));
    changed();
    ctx.announce(T(lang, { de: 'Für alle Bilder übernommen', en: 'Applied to all images' }));
  } }, T(lang, { de: 'Für alle Bilder übernehmen', en: 'Apply to all images' }));
  stage.append(el('section', { class: 'new-box', aria: { labelledby: 'new-crop-h' } },
    el('h2', { id: 'new-crop-h' }, T(lang, { de: 'Zuschneiden', en: 'Crop' })),
    thumbs, el('div', { class: 'new-ed' }, view), chips, tools, straighten.root, applyAll,
    el('p', { class: 'new-muted' }, T(lang, { de: 'Zieh die Ecken oder den Rahmen. Mit der Tastatur: Pfeiltasten verschieben, Strg + Pfeiltasten ändern die Größe.', en: 'Drag the corners or the frame. With a keyboard: arrow keys move, Ctrl + arrow keys resize.' }))));

  function changed() { state.results.clear(); ctx.refresh(); }
  function syncChips() { const st = stateOf(current); chipBtns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.aspect === st.aspect))); }
  function fullSize() { const st = stateOf(current); const d = current._newDims || [prevW, prevH]; return turnedSize(d[0], d[1], st.rot); }
  function setAspect(id) {
    const st = stateOf(current);
    st.aspect = id;
    syncChips();
    const [W, H] = fullSize();
    box.setAspect(ratioOf(st, W, H));
  }
  function turn(d) {
    const st = stateOf(current);
    st.rot = (st.rot + d + 4) % 4;
    // rotate the frame with the image
    const r = st.rect;
    st.rect = d > 0 ? { x: 1 - r.y - r.h, y: r.x, w: r.h, h: r.w } : { x: r.y, y: 1 - r.x - r.w, w: r.h, h: r.w };
    redraw();
    box.rect = st.rect;
    const [W, H] = fullSize();
    box.setAspect(ratioOf(st, W, H), 'mismatch');
    changed();
  }
  function redraw() {
    if (!preview || !current) return;
    const st = stateOf(current);
    const [w, h] = turnedSize(preview.width, preview.height, st.rot);
    const t = document.createElement('canvas');
    t.width = w; t.height = h;
    drawTransformed(t.getContext('2d'), preview, preview.width, preview.height, st, null, '#ffffff00');
    const [W, H] = fullSize();
    const maxW = Math.max(200, view.clientWidth || stage.clientWidth || 340);
    const maxH = Math.max(240, Math.min(window.innerHeight * 0.58, 600));
    box.show(t, W, H, maxW, maxH);
    release(t);
  }
  async function select(input) {
    current = input;
    for (const b of thumbs.children) b.setAttribute('aria-pressed', String(b._input === input));
    const my = ++seq;
    let c;
    try { c = await loadCanvas(input, { maxSide: 1600 }); } catch (err) { console.warn(err); return; }
    if (my !== seq) { release(c.canvas); return; }
    if (preview) release(preview);
    preview = c.canvas; prevW = c.width; prevH = c.height;
    input._newDims = [c.width, c.height];
    const st = stateOf(input);
    straighten.set(st.angle);
    syncChips();
    redraw();
    const [W, H] = fullSize();
    box.rect = st.rect;
    box.setAspect(ratioOf(st, W, H), 'mismatch');
    changed();
  }
  function refresh(inputs = state.inputs.filter(i => !i.error)) {
    clear(thumbs);
    thumbs.hidden = inputs.length < 2;
    applyAll.hidden = inputs.length < 2;
    for (const input of inputs) {
      const b = el('button', { type: 'button', class: 'new-thumb', aria: { pressed: 'false', label: input.name }, onclick: () => select(input) });
      b._input = input;
      thumbs.append(b);
      if (inputs.length > 1) input.thumbnail(64).then(c => c.toBlob(bl => { if (!bl) return; const img = el('img', { alt: '' }); img.src = URL.createObjectURL(bl); img.onload = () => URL.revokeObjectURL(img.src); b.append(img); })).catch(() => {});
    }
    if (!inputs.includes(current)) current = inputs[0] || null;
    if (current) select(current);
  }
  let rt = 0;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(redraw, 150); });
  refresh();
  return { refresh };
}
