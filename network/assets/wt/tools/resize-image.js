// Tool: resize images – pixels (with or without keeping the aspect ratio), percent, longest edge or
// presets (social media formats, e-mail, HD, 4K). Exact formats can be cropped to fill with a focal point
// chosen by tapping the picture, padded with a colour or stretched. High-quality multi-step downscaling.
import { el, icon, clear } from '../lib/dom.js';
import { loadCanvas, encode, scaleTo, newCanvas, ctx2d, release, keepFormat, FORMATS, encodeSupport, ensureCss, imgProgress, uniqueNames, T, userError } from '../lib/img-core.js';

const SUP = await encodeSupport();
ensureCss();

// presets: exact formats (crop/pad/stretch) or boxes (fit inside, aspect kept)
const PRESETS = {
  square: { w: 1080, h: 1080, label: { de: 'Quadrat 1:1 · 1080 × 1080 (Social-Media-Beitrag)', en: 'Square 1:1 · 1080 × 1080 (social media post)' } },
  portrait: { w: 1080, h: 1350, label: { de: 'Hochformat 4:5 · 1080 × 1350 (Beitrag)', en: 'Portrait 4:5 · 1080 × 1350 (post)' } },
  story: { w: 1080, h: 1920, label: { de: 'Story / Reel 9:16 · 1080 × 1920', en: 'Story / reel 9:16 · 1080 × 1920' } },
  link: { w: 1200, h: 630, label: { de: 'Link-Vorschau 1,91:1 · 1200 × 630', en: 'Link preview 1.91:1 · 1200 × 630' } },
  video: { w: 1280, h: 720, label: { de: 'Video-Vorschaubild 16:9 · 1280 × 720', en: 'Video thumbnail 16:9 · 1280 × 720' } },
  cover: { w: 1500, h: 500, label: { de: 'Titelbild 3:1 · 1500 × 500', en: 'Header image 3:1 · 1500 × 500' } },
  avatar: { w: 400, h: 400, label: { de: 'Profilbild 1:1 · 400 × 400', en: 'Profile picture 1:1 · 400 × 400' } },
  mail: { long: 1600, label: { de: 'E-Mail · längste Seite 1600 px', en: 'E-mail · longest side 1600 px' } },
  hd: { w: 1920, h: 1080, box: true, label: { de: 'Full HD · passt in 1920 × 1080', en: 'Full HD · fits 1920 × 1080' } },
  uhd: { w: 3840, h: 2160, box: true, label: { de: '4K UHD · passt in 3840 × 2160', en: '4K UHD · fits 3840 × 2160' } },
};

const isExact = v => (v.mode === 'preset' && PRESETS[v.preset]?.w && !PRESETS[v.preset].box) || (v.mode === 'px' && !v.keepAspect && +v.width > 0 && +v.height > 0);
const targetBox = v => (v.mode === 'preset' ? PRESETS[v.preset] : { w: +v.width || 0, h: +v.height || 0 });
const showFocus = v => isExact(v) && v.exact === 'fill';

/** Output geometry for a source of w × h. */
export function plan(w, h, v, focus = [0.5, 0.5]) {
  const cap = f => (v.noUpscale ? Math.min(1, f) : f);
  const fit = f => ({ W: Math.max(1, Math.round(w * f)), H: Math.max(1, Math.round(h * f)), crop: null, pad: null, upscaled: f > 1.0001 });
  if (v.mode === 'percent') return fit((+v.percent || 100) / 100);
  if (v.mode === 'long' || (v.mode === 'preset' && PRESETS[v.preset]?.long)) {
    const L = v.mode === 'long' ? +v.long : PRESETS[v.preset].long;
    return fit(cap(L / Math.max(w, h)));
  }
  const box = targetBox(v);
  if (!isExact(v)) {
    const f = box.w && box.h ? Math.min(box.w / w, box.h / h) : box.w ? box.w / w : box.h ? box.h / h : 1;
    return fit(cap(f));
  }
  const W = box.w, H = box.h;
  if (v.exact === 'stretch') return { W, H, crop: null, pad: null, upscaled: W > w || H > h };
  if (v.exact === 'pad') {
    const f = Math.min(W / w, H / h);
    const dw = Math.round(w * f), dh = Math.round(h * f);
    return { W, H, crop: null, pad: { x: Math.round((W - dw) / 2), y: Math.round((H - dh) / 2), w: dw, h: dh }, upscaled: f > 1.0001 };
  }
  // fill: crop the source to the target aspect around the focal point
  const a = W / H;
  let cw = w, ch = h;
  if (w / h > a) cw = h * a; else ch = w / a;
  const x = Math.min(w - cw, Math.max(0, focus[0] * w - cw / 2));
  const y = Math.min(h - ch, Math.max(0, focus[1] * h - ch / 2));
  return { W, H, crop: { x, y, w: cw, h: ch }, pad: null, upscaled: W > cw + 0.5 };
}

const fmtChoices = [
  { value: 'keep', label: { de: 'Wie das Original', en: 'Same as original' } },
  { value: 'jpg', label: 'JPG' }, { value: 'png', label: 'PNG' },
  ...(SUP.webp ? [{ value: 'webp', label: 'WebP' }] : []),
];

let stageCtl = null;

export default {
  shareFirst: true,
  options: [
    {
      id: 'mode', type: 'radio', default: 'preset',
      label: { de: 'Neue Größe', en: 'New size' },
      choices: [
        { value: 'preset', label: { de: 'Vorlage', en: 'Preset' }, hint: { de: 'Social Media, E-Mail, HD, 4K', en: 'Social media, e-mail, HD, 4K' } },
        { value: 'px', label: { de: 'Pixel', en: 'Pixels' }, hint: { de: 'Breite und/oder Höhe', en: 'Width and/or height' } },
        { value: 'percent', label: { de: 'Prozent', en: 'Percent' }, hint: { de: 'Z. B. halb so groß', en: 'E.g. half the size' } },
        { value: 'long', label: { de: 'Längste Seite', en: 'Longest side' }, hint: { de: 'Hoch- und Querformat gleich', en: 'Same for portrait and landscape' } },
      ],
    },
    { id: 'preset', type: 'select', default: 'square', label: { de: 'Vorlage', en: 'Preset' }, when: v => v.mode === 'preset',
      choices: Object.entries(PRESETS).map(([value, p]) => ({ value, label: p.label })) },
    { id: 'width', type: 'number', default: 1920, min: 1, max: 20000, unit: 'px', label: { de: 'Breite', en: 'Width' }, when: v => v.mode === 'px',
      placeholder: { de: 'automatisch', en: 'automatic' },
      validate: (val, lang) => (val !== '' && !(+val >= 1 && +val <= 20000) ? (lang === 'de' ? 'Bitte 1 bis 20000 px angeben.' : 'Please enter 1 to 20000 px.') : '') },
    { id: 'height', type: 'number', default: '', min: 1, max: 20000, unit: 'px', label: { de: 'Höhe', en: 'Height' }, when: v => v.mode === 'px',
      placeholder: { de: 'automatisch', en: 'automatic' }, hint: { de: 'Leer lassen = passend zur Breite.', en: 'Leave empty = matches the width.' },
      validate: (val, lang) => (val !== '' && !(+val >= 1 && +val <= 20000) ? (lang === 'de' ? 'Bitte 1 bis 20000 px angeben.' : 'Please enter 1 to 20000 px.') : '') },
    { id: 'keepAspect', type: 'toggle', default: true, label: { de: 'Seitenverhältnis beibehalten', en: 'Keep aspect ratio' },
      hint: { de: 'Das Bild passt in Breite × Höhe, nichts wird abgeschnitten oder verzerrt.', en: 'The image fits into width × height, nothing is cut off or distorted.' },
      when: v => v.mode === 'px' && +v.width > 0 && +v.height > 0 },
    { id: 'exact', type: 'radio', default: 'fill', label: { de: 'Genau dieses Format', en: 'Exactly this format' }, when: v => isExact(v),
      choices: [
        { value: 'fill', label: { de: 'Zuschneiden', en: 'Crop' }, hint: { de: 'Füllt das Format, tippe aufs Wichtigste', en: 'Fills the format, tap what matters' } },
        { value: 'pad', label: { de: 'Mit Rand', en: 'Add borders' }, hint: { de: 'Ganzes Bild, Rand in deiner Farbe', en: 'Whole image, borders in your colour' } },
        { value: 'stretch', label: { de: 'Verzerren', en: 'Stretch' }, hint: { de: 'Ganzes Bild, gestaucht', en: 'Whole image, squashed' } },
      ] },
    { id: 'percent', type: 'range', default: 50, min: 5, max: 200, step: 5, unit: '%', label: { de: 'Prozent', en: 'Percent' }, when: v => v.mode === 'percent' },
    { id: 'long', type: 'number', default: 1920, min: 16, max: 20000, unit: 'px', label: { de: 'Längste Seite', en: 'Longest side' }, when: v => v.mode === 'long',
      validate: (val, lang) => (!(+val >= 16 && +val <= 20000) ? (lang === 'de' ? 'Bitte 16 bis 20000 px angeben.' : 'Please enter 16 to 20000 px.') : '') },
    { id: 'noUpscale', type: 'toggle', default: true, label: { de: 'Kleine Bilder nicht vergrößern', en: 'Don’t enlarge small images' },
      hint: { de: 'Vergrößern macht ein Bild nicht schärfer, nur die Datei größer.', en: 'Enlarging doesn’t make an image sharper, only the file bigger.' },
      when: v => !isExact(v) && v.mode !== 'percent' },
    { id: 'background', type: 'color', default: '#ffffff', label: { de: 'Randfarbe / Hintergrund', en: 'Border / background colour' },
      when: (v, inputs) => (isExact(v) && v.exact === 'pad') || (v.format === 'jpg' && inputs.some(i => ['png', 'webp', 'gif', 'avif'].includes(i.format))) },
    { id: 'format', type: 'select', default: 'keep', label: { de: 'Format', en: 'Format' }, choices: fmtChoices },
    { id: 'quality', type: 'range', default: 90, min: 40, max: 100, step: 5, unit: '%', label: { de: 'Qualität', en: 'Quality' },
      when: (v, inputs) => v.format === 'jpg' || v.format === 'webp' || (v.format === 'keep' && inputs.some(i => ['jpeg', 'webp', 'heic', 'avif'].includes(i.format))) },
    { id: 'strip', type: 'toggle', default: true, label: { de: 'Standort und Kameradaten entfernen', en: 'Remove location and camera data' } },
  ],

  labels: { back_to_files: { de: 'Zurück zu den Bildern', en: 'Back to the images' } },

  mountStage(stage, state, ctx) {
    ensureCss();
    stageCtl = focusStage(stage, state, ctx);
    stageCtl.refresh();
  },
  onInputs() { stageCtl?.refresh(); },
  onOptionsChange() { stageCtl?.refresh(); },

  status(v, inputs, lang) {
    if (v.mode === 'px' && !(+v.width > 0) && !(+v.height > 0)) return { ok: false, hint: { de: 'Gib eine Breite oder Höhe ein.', en: 'Enter a width or height.' } };
    if (inputs.length === 1 && inputs[0]._dims) {
      const p = plan(inputs[0]._dims.width, inputs[0]._dims.height, v, inputs[0].opts.focus);
      return { summary: `${inputs[0]._dims.width} × ${inputs[0]._dims.height} → ${p.W} × ${p.H} px` };
    }
    return null;
  },

  async run(inputs, opts, ctx) {
    const outputs = [];
    let upscaled = 0;
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      ctx.progress(i / inputs.length, imgProgress(i, inputs.length, input.name));
      await ctx.tick();
      const fmt = opts.format === 'keep' ? keepFormat(input) : opts.format;
      const { canvas: src, width, height } = await loadCanvas(input);
      // the canvas may be capped below the original size (canvas pixel limit) – plan in original pixels
      const k = src.width / width;
      const p = plan(width, height, opts, input.opts.focus || [0.5, 0.5]);
      if (p.upscaled) upscaled++;
      let out;
      try {
        if (p.crop) out = scaleTo(src, p.W, p.H, { crop: { x: p.crop.x * k, y: p.crop.y * k, w: p.crop.w * k, h: p.crop.h * k } });
        else if (p.pad) {
          const inner = scaleTo(src, p.pad.w, p.pad.h);
          out = newCanvas(p.W, p.H);
          const g = ctx2d(out);
          g.fillStyle = opts.background || '#ffffff';
          g.fillRect(0, 0, p.W, p.H);
          g.drawImage(inner, p.pad.x, p.pad.y);
          release(inner);
        } else out = scaleTo(src, p.W, p.H);
      } finally { release(src); }
      await ctx.tick();
      let blob;
      try { blob = await encode(out, { format: fmt, quality: (+opts.quality || 90) / 100, background: opts.background }); }
      finally { release(out); }
      outputs.push({ name: ctx.fileName(input.name, ` (${p.W}x${p.H})`, FORMATS[fmt].ext), blob,
        note: `${width} × ${height} → ${p.W} × ${p.H} px`, meta: { input, width: p.W, height: p.H } });
    }
    if (upscaled) ctx.note({ de: `${upscaled === 1 ? 'Ein Bild wurde' : `${upscaled} Bilder wurden`} vergrößert – dadurch wird es nicht schärfer.`, en: `${upscaled === 1 ? 'One image was' : `${upscaled} images were`} enlarged – this doesn’t make it sharper.` });
    if (!outputs.length) throw userError('Kein Bild verarbeitet.', 'No image processed.');
    return { outputs: uniqueNames(outputs) };
  },
};

// ---------------------------------------------------------------- focal point picker (crop to fill)
function focusStage(stage, state, ctx) {
  const lang = ctx.lang;
  const thumbs = new Map();
  let current = 0;
  const strip = el('div', { class: 'img-strip', role: 'group', aria: { label: T(lang, { de: 'Bild wählen', en: 'Choose image' }) } });
  const canvasBox = el('div', { class: 'img-focus-img' });
  const frame = el('div', { class: 'img-focus-frame', 'aria-hidden': 'true' });
  const dot = el('div', { class: 'img-focus-dot', 'aria-hidden': 'true' });
  const pad = el('div', { class: 'img-focus-pad', tabindex: '0', role: 'application',
    aria: { label: T(lang, { de: 'Bildausschnitt: tippe auf das Wichtigste oder nutze die Pfeiltasten', en: 'Crop area: tap what matters or use the arrow keys' }), describedby: 'img-focus-hint' } }, canvasBox, frame, dot);
  const allBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm', onclick: () => {
    const f = inputs()[current]?.opts.focus || [0.5, 0.5];
    for (const inp of inputs()) inp.opts.focus = [...f];
    ctx.announce(T(lang, { de: 'Ausschnitt für alle Bilder übernommen.', en: 'Crop applied to all images.' }));
    changed();
  } }, T(lang, { de: 'Für alle Bilder übernehmen', en: 'Use for all images' }));
  const centerBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm', onclick: () => setFocus([0.5, 0.5]) }, T(lang, { de: 'Mitte', en: 'Centre' }));
  const box = el('section', { class: 'img-box img-focus', aria: { labelledby: 'img-focus-h' } },
    el('h2', { class: 'img-h', id: 'img-focus-h' }, T(lang, { de: 'Bildausschnitt', en: 'Crop area' })),
    el('p', { class: 'img-muted', id: 'img-focus-hint' }, T(lang, { de: 'Tippe auf das Wichtigste im Bild. Der helle Rahmen zeigt, was erhalten bleibt.', en: 'Tap the most important part of the picture. The bright frame shows what is kept.' })),
    strip, pad, el('div', { class: 'img-btn-row' }, centerBtn, allBtn));
  stage.append(box);

  const inputs = () => state.inputs.filter(i => !i.error);
  function changed() { state.results.clear(); draw(); ctx.refresh(); }
  function setFocus(f) {
    const inp = inputs()[current];
    if (!inp) return;
    inp.opts.focus = [Math.min(1, Math.max(0, f[0])), Math.min(1, Math.max(0, f[1]))];
    changed();
  }
  pad.addEventListener('pointerdown', ev => {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    const r = canvasBox.getBoundingClientRect();
    setFocus([(ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height]);
  });
  pad.addEventListener('keydown', ev => {
    const d = { ArrowLeft: [-0.03, 0], ArrowRight: [0.03, 0], ArrowUp: [0, -0.03], ArrowDown: [0, 0.03] }[ev.key];
    if (!d) return;
    ev.preventDefault();
    const f = inputs()[current]?.opts.focus || [0.5, 0.5];
    setFocus([f[0] + d[0], f[1] + d[1]]);
  });

  async function thumb(inp) {
    if (!thumbs.has(inp.id)) thumbs.set(inp.id, inp.thumbnail(Math.min(560, stage.clientWidth || 360)).catch(() => null));
    return thumbs.get(inp.id);
  }

  async function draw() {
    const list = inputs();
    if (current >= list.length) current = 0;
    const inp = list[current];
    if (!inp) return;
    const c = await thumb(inp);
    if (!c) return;
    if (canvasBox.firstChild !== c) clear(canvasBox).append(c);
    const f = inp.opts.focus || [0.5, 0.5];
    const p = plan(c.width, c.height, state.values, f);
    if (!p.crop) return;
    frame.style.left = (p.crop.x / c.width) * 100 + '%';
    frame.style.top = (p.crop.y / c.height) * 100 + '%';
    frame.style.width = (p.crop.w / c.width) * 100 + '%';
    frame.style.height = (p.crop.h / c.height) * 100 + '%';
    dot.style.left = f[0] * 100 + '%';
    dot.style.top = f[1] * 100 + '%';
    [...strip.children].forEach((b, i) => b.setAttribute('aria-pressed', String(i === current)));
  }

  function renderStrip() {
    const list = inputs();
    clear(strip);
    strip.hidden = list.length < 2;
    allBtn.hidden = list.length < 2;
    list.forEach((inp, i) => {
      const b = el('button', { type: 'button', class: 'img-strip-btn', aria: { pressed: String(i === current), label: inp.name }, onclick: () => { current = i; draw(); } });
      thumb(inp).then(c => { if (c) { const s = 128 / Math.max(c.width, c.height); const t = el('canvas', { width: Math.round(c.width * s), height: Math.round(c.height * s) }); ctx2d(t).drawImage(c, 0, 0, t.width, t.height); b.append(t); } });
      strip.append(b);
    });
  }

  return {
    refresh() {
      const on = showFocus(state.values) && inputs().length > 0;
      box.hidden = !on;
      if (!on) return;
      for (const id of [...thumbs.keys()]) if (!inputs().some(i => i.id === id)) thumbs.delete(id);
      renderStrip();
      draw();
    },
  };
}
