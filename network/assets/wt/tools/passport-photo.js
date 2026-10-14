// Tool: passport / application photo – templates (biometric 35 × 45 mm, US 2 × 2 in, application formats)
// with guide overlay (crown, chin, eye band, head oval), positioning by drag / pinch / wheel / keys,
// straightening, brightness, optional lightening of a plain background, export as a single photo (600 dpi)
// or a 10 × 15 cm print sheet with cut marks (JPG or PDF). Honest: a layout help – authorities decide.
import { el, icon, clear } from '../lib/dom.js';
import { loadPdfLib, saveDoc } from '../lib/pdf.js';
import { ensureCss, loadCanvas, encode, release, newCanvas, ctx2d, T, userError } from '../lib/img-core.js';
import { TEMPLATES, sheetLayout } from '../lib/shared/passphoto-templates.js';
import { floodMask, replaceMasked, adjust } from '../lib/shared/imgproc.js';

ensureCss();

const DPI = 600, PPM = DPI / 25.4, MM = 72 / 25.4;
const BG = [236, 236, 236];
const NAMES = {
  de: { de: 'Biometrisch 35 × 45 mm', en: 'Biometric 35 × 45 mm' },
  us: { de: 'USA 2 × 2 Zoll (51 × 51 mm)', en: 'US 2 × 2 in (51 × 51 mm)' },
  bew46: { de: 'Bewerbung 40 × 60 mm', en: 'Application 40 × 60 mm' },
  bew4560: { de: 'Bewerbung 45 × 60 mm', en: 'Application 45 × 60 mm' },
};
const DESC = {
  de: { de: 'z. B. Pass, Ausweis, Visum, Führerschein', en: 'e.g. passport, ID card, visa (EU size)' },
  us: { de: 'z. B. US-Visum', en: 'e.g. US passport and visa' },
  bew46: { de: 'Bewerbungsfoto', en: 'CV / application photo' },
  bew4560: { de: 'Bewerbungsfoto groß', en: 'Large application photo' },
};
const tplOf = v => TEMPLATES.find(t => t.id === v.template) || TEMPLATES[0];

let stageCtl = null;
const sources = new Map(); // input.id → { canvas, bg: canvas|null, bgKey }

function ppState(input, tpl, src) {
  const o = input.opts;
  if (!o.pp || o.pp.tpl !== tpl.id) {
    // cover the frame, centred
    const s = Math.max(tpl.w / src.width, tpl.h / src.height) * 1.05;
    o.pp = { tpl: tpl.id, cx: tpl.w / 2, cy: tpl.h / 2, s, rot: 0 };
  }
  return o.pp;
}

/** Draw the photo with transform into a canvas of tpl size at ppm pixels per mm. */
function renderPhoto(src, tpl, T0, ppm, adj) {
  const W = Math.round(tpl.w * ppm), H = Math.round(tpl.h * ppm);
  const c = newCanvas(W, H);
  const g = ctx2d(c, true);
  g.fillStyle = `rgb(${BG.join(',')})`;
  g.fillRect(0, 0, W, H);
  g.translate(T0.cx * ppm, T0.cy * ppm);
  g.rotate(T0.rot);
  g.scale(T0.s * ppm, T0.s * ppm);
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, -src.width / 2, -src.height / 2);
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (adj && (adj.brightness || adj.contrast)) {
    const d = adjust(g.getImageData(0, 0, W, H), { brightness: adj.brightness * 0.78, contrast: adj.contrast });
    g.putImageData(new ImageData(d.data, d.width, d.height), 0, 0);
  }
  return c;
}

function sheetPositions(tpl, lay) {
  const totW = lay.cols * tpl.w + (lay.cols - 1) * lay.gap, totH = lay.rows * tpl.h + (lay.rows - 1) * lay.gap;
  const ox = (lay.SW - totW) / 2, oy = (lay.SH - totH) / 2 - 1;
  const out = [];
  for (let r = 0; r < lay.rows; r++) for (let c = 0; c < lay.cols; c++) out.push([ox + c * (tpl.w + lay.gap), oy + r * (tpl.h + lay.gap)]);
  return out;
}
function cutMarks(tpl, lay) {
  const L = 2.2, off = 0.6, lines = [];
  for (const [x, y] of sheetPositions(tpl, lay)) {
    const x1 = x + tpl.w, y1 = y + tpl.h;
    for (const [cx, cy, dx, dy] of [[x, y, -1, -1], [x1, y, 1, -1], [x, y1, -1, 1], [x1, y1, 1, 1]]) {
      lines.push([cx + dx * off, cy, cx + dx * (off + L), cy]);
      lines.push([cx, cy + dy * off, cx, cy + dy * (off + L)]);
    }
  }
  return lines;
}

async function source(input) {
  if (!sources.has(input.id)) sources.set(input.id, loadCanvas(input, { maxSide: 2400 }).then(r => ({ canvas: r.canvas, bg: null, bgKey: '' })));
  return sources.get(input.id);
}

/** Background lightening (flood fill from the top corners), cached per tolerance. */
function withBackground(srcObj, tolerance) {
  const key = String(tolerance);
  if (srcObj.bgKey === key && srcObj.bg) return { canvas: srcObj.bg, share: 0 };
  const c = srcObj.canvas, w = c.width, h = c.height;
  const data = ctx2d(c, true).getImageData(0, 0, w, h);
  const seeds = [[w * 0.04, h * 0.04], [w * 0.96, h * 0.04], [w * 0.5, h * 0.02], [w * 0.04, h * 0.3], [w * 0.96, h * 0.3]];
  const mask = floodMask(data, seeds, { tolerance });
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i];
  const share = n / mask.length;
  const out = replaceMasked(data, mask, { color: BG, feather: Math.max(1.5, w / 900) });
  if (srcObj.bg) release(srcObj.bg);
  srcObj.bg = newCanvas(w, h);
  ctx2d(srcObj.bg).putImageData(new ImageData(out.data, out.width, out.height), 0, 0);
  srcObj.bgKey = key;
  srcObj.share = share;
  return { canvas: srcObj.bg, share };
}

export default {
  shareFirst: true,
  labels: { back_to_files: { de: 'Zurück zum Foto', en: 'Back to the photo' } },
  options: [
    { id: 'template', type: 'radio', default: 'de', label: { de: 'Format', en: 'Format' },
      choices: TEMPLATES.map(t => ({ value: t.id, label: NAMES[t.id] || t.label, hint: DESC[t.id] || t.desc })) },
    { id: 'output', type: 'radio', default: 'sheet', label: { de: 'Ergebnis', en: 'Result' },
      choices: [
        { value: 'sheet', label: { de: 'Druckbogen 10 × 15 cm (JPG)', en: 'Print sheet 10 × 15 cm (JPG)' }, hint: { de: 'Für den Fotodruck im Laden oder am Automaten', en: 'For photo printing in a shop or kiosk' } },
        { value: 'pdf', label: { de: 'Druckbogen als PDF', en: 'Print sheet as PDF' }, hint: { de: 'Zum Selbstdrucken in Originalgröße', en: 'To print yourself at actual size' } },
        { value: 'single', label: { de: 'Einzelnes Foto (JPG)', en: 'Single photo (JPG)' }, hint: { de: 'Z. B. für Online-Bewerbungen', en: 'E.g. for online applications' } },
      ] },
    { id: 'count', type: 'select', default: 0, label: { de: 'Fotos auf dem Bogen', en: 'Photos on the sheet' }, when: v => v.output !== 'single',
      choices: [{ value: 0, label: { de: 'So viele wie passen', en: 'As many as fit' } }, { value: 2, label: '2' }, { value: 4, label: '4' }, { value: 6, label: '6' }] },
  ],

  mountStage(stage, state, ctx) { stageCtl = ppStage(stage, state, ctx); stageCtl.refresh(); },
  onInputs() { stageCtl?.refresh(); },
  onOptionsChange() { stageCtl?.refresh(); },

  async run(inputs, opts, ctx) {
    const input = inputs[0];
    if (!input) throw userError('Bitte wähle ein Foto aus.', 'Please choose a photo.');
    const tpl = tplOf(opts);
    ctx.progress(0.1, { de: 'Foto wird vorbereitet …', en: 'Preparing photo …' });
    const srcObj = await source(input);
    const pp = ppState(input, tpl, srcObj.canvas);
    const ed = input.opts.ppEdit || {};
    const src = ed.bg ? withBackground(srcObj, ed.tolerance || 22).canvas : srcObj.canvas;
    await ctx.tick();
    const photo = renderPhoto(src, tpl, pp, PPM, ed);
    const name = (opts.template === 'us' ? 'US-2x2' : `${String(tpl.w).replace('.', ',')}x${String(tpl.h).replace('.', ',')}mm`);
    const label = ctx.t(NAMES[tpl.id] || tpl.label);
    try {
      if (opts.output === 'single') {
        const blob = await encode(photo, { format: 'jpg', quality: 0.95 });
        return { outputs: [{ name: `${ctx.t({ de: 'Passfoto', en: 'Passport photo' })} ${name}.jpg`, blob, note: `${label} · ${photo.width} × ${photo.height} px (${DPI} dpi)` }] };
      }
      const lay = sheetLayout(tpl, +opts.count || 99);
      const pos = sheetPositions(tpl, lay);
      ctx.progress(0.5, { de: 'Druckbogen wird erstellt …', en: 'Creating print sheet …' });
      await ctx.tick();
      const note = ctx.t({ de: `${lay.n} Fotos · 10 × 15 cm · in Originalgröße (100 %) drucken`, en: `${lay.n} photos · 10 × 15 cm · print at actual size (100 %)` });
      if (opts.output === 'pdf') {
        const PDFLib = await loadPdfLib();
        const doc = await PDFLib.PDFDocument.create();
        const page = doc.addPage([lay.SW * MM, lay.SH * MM]);
        const img = await doc.embedJpg(new Uint8Array(await (await encode(photo, { format: 'jpg', quality: 0.95 })).arrayBuffer()));
        for (const [x, y] of pos) page.drawImage(img, { x: x * MM, y: (lay.SH - y - tpl.h) * MM, width: tpl.w * MM, height: tpl.h * MM });
        for (const [x0, y0, x1, y1] of cutMarks(tpl, lay)) page.drawLine({ start: { x: x0 * MM, y: (lay.SH - y0) * MM }, end: { x: x1 * MM, y: (lay.SH - y1) * MM }, thickness: 0.3, color: PDFLib.rgb(0.6, 0.62, 0.7) });
        const bytes = await saveDoc(doc, { title: `${ctx.t({ de: 'Passfoto', en: 'Passport photo' })} ${label}` });
        return { outputs: [{ name: `${ctx.t({ de: 'Passfotos', en: 'Passport photos' })} ${name} 10x15.pdf`, blob: new Blob([bytes], { type: 'application/pdf' }), pages: 1, note }] };
      }
      const sheet = newCanvas(lay.SW * PPM, lay.SH * PPM);
      const g = ctx2d(sheet);
      g.fillStyle = '#fff'; g.fillRect(0, 0, sheet.width, sheet.height);
      for (const [x, y] of pos) g.drawImage(photo, Math.round(x * PPM), Math.round(y * PPM), Math.round(tpl.w * PPM), Math.round(tpl.h * PPM));
      g.strokeStyle = '#9AA0B4'; g.lineWidth = Math.max(2, PPM * 0.15);
      for (const [x0, y0, x1, y1] of cutMarks(tpl, lay)) { g.beginPath(); g.moveTo(x0 * PPM, y0 * PPM); g.lineTo(x1 * PPM, y1 * PPM); g.stroke(); }
      g.fillStyle = '#9AA0B4';
      g.font = `${Math.round(PPM * 2)}px sans-serif`;
      g.fillText(`${label} · ${ctx.t({ de: 'in Originalgröße (100 %) drucken', en: 'print at actual size (100 %)' })}`, PPM * 3, sheet.height - PPM * 1.2);
      let blob;
      try { blob = await encode(sheet, { format: 'jpg', quality: 0.93 }); } finally { release(sheet); }
      return { outputs: [{ name: `${ctx.t({ de: 'Passfotos', en: 'Passport photos' })} ${name} 10x15.jpg`, blob, note }] };
    } finally { release(photo); }
  },
};

// ---------------------------------------------------------------- stage: frame with guides, drag / pinch
function ppStage(stage, state, ctx) {
  const lang = ctx.lang;
  const NS = 'http://www.w3.org/2000/svg';
  const view = el('canvas', { class: 'img-pp-canvas', 'aria-hidden': 'true' });
  const guides = document.createElementNS(NS, 'svg');
  guides.setAttribute('class', 'img-pp-guides');
  guides.setAttribute('aria-hidden', 'true');
  guides.setAttribute('preserveAspectRatio', 'none');
  const frame = el('div', { class: 'img-pp-frame', tabindex: '0', role: 'application',
    aria: { label: T(lang, { de: 'Foto ausrichten: ziehen zum Verschieben, mit zwei Fingern zoomen. Tastatur: Pfeiltasten verschieben, Plus und Minus zoomen.', en: 'Position the photo: drag to move, pinch to zoom. Keyboard: arrow keys move, plus and minus zoom.' }) } }, view, guides);
  const legend = el('ul', { class: 'img-pp-legend' },
    el('li', {}, el('span', { class: 'img-pp-key img-pp-key-crown' }), T(lang, { de: 'Scheitel zwischen den blauen Linien', en: 'Top of head between the blue lines' })),
    el('li', {}, el('span', { class: 'img-pp-key img-pp-key-eyes' }), T(lang, { de: 'Augen im grünen Band', en: 'Eyes in the green band' })),
    el('li', {}, el('span', { class: 'img-pp-key img-pp-key-chin' }), T(lang, { de: 'Kinn zwischen den gelben Linien', en: 'Chin between the yellow lines' })));
  const zoom = el('input', { type: 'range', id: 'img-pp-zoom', min: '0.2', max: '4', step: '0.01', value: '1', oninput: e => setScale(+e.target.value) });
  const rot = el('input', { type: 'range', id: 'img-pp-rot', min: '-15', max: '15', step: '0.5', value: '0', oninput: e => edit(p => { p.rot = (+e.target.value * Math.PI) / 180; }) });
  const bright = el('input', { type: 'range', id: 'img-pp-bright', min: '-40', max: '40', step: '2', value: '0', oninput: e => setEdit({ brightness: +e.target.value }) });
  const bg = el('input', { type: 'checkbox', id: 'img-pp-bg', onchange: e => setEdit({ bg: e.target.checked }) });
  const tol = el('input', { type: 'range', id: 'img-pp-tol', min: '8', max: '45', step: '1', value: '22', onchange: e => setEdit({ tolerance: +e.target.value }) });
  const tolRow = el('div', { class: 'img-pp-row', hidden: true }, el('label', { for: 'img-pp-tol' }, T(lang, { de: 'Toleranz', en: 'Tolerance' })), tol);
  const bgMsg = el('p', { class: 'img-muted', role: 'status' });
  const row = (id, label, input) => el('div', { class: 'img-pp-row' }, el('label', { for: id }, T(lang, label)), input);
  const box = el('section', { class: 'img-box img-pp', aria: { labelledby: 'img-pp-h' } },
    el('h2', { class: 'img-h', id: 'img-pp-h' }, T(lang, { de: 'Foto ausrichten', en: 'Position the photo' })),
    el('p', { class: 'img-muted' }, T(lang, { de: 'Zieh das Foto mit dem Finger, zoome mit zwei Fingern (am Computer: Mausrad).', en: 'Drag the photo with your finger, pinch to zoom (on a computer: mouse wheel).' })),
    el('div', { class: 'img-pp-stage' }, frame), legend,
    row('img-pp-zoom', { de: 'Größe', en: 'Size' }, zoom),
    row('img-pp-rot', { de: 'Gerade ausrichten', en: 'Straighten' }, rot),
    row('img-pp-bright', { de: 'Helligkeit', en: 'Brightness' }, bright),
    el('div', { class: 'img-check' }, el('label', { for: 'img-pp-bg' }, bg, el('span', {}, T(lang, { de: 'Hintergrund aufhellen (bei einfarbigem Hintergrund)', en: 'Lighten the background (plain backgrounds only)' })))),
    tolRow, bgMsg,
    el('p', { class: 'img-note img-info' }, icon('alert'), el('span', {}, T(lang, {
      de: 'FaLe hilft beim Zuschnitt und Druckbogen – ob ein Foto angenommen wird, entscheidet die Behörde. Für deutsche Ausweise und Pässe wird das Foto seit Mai 2025 in der Regel digital beim Fotografen oder im Bürgeramt erstellt; gedruckte Fotos brauchst du z. B. noch für manche Visa oder Mitgliedsausweise.',
      en: 'FaLe helps with cropping and the print sheet – whether a photo is accepted is up to the authority. Some countries only accept photos taken or submitted digitally by an approved photographer or office; check the current rules first.' }))));
  stage.append(box);

  let srcObj = null, input = null, k = 8; // k = CSS px per mm
  const inputs = () => state.inputs.filter(i => !i.error);
  const tpl = () => tplOf(state.values);
  function changed() { state.results.clear(); ctx.refresh(); }
  function pp() { return ppState(input, tpl(), srcObj.canvas); }
  function edits() { return (input.opts.ppEdit ||= { brightness: 0, bg: false, tolerance: 22 }); }
  function edit(fn) { if (!input || !srcObj) return; fn(pp()); draw(); changed(); }
  function setScale(s) { edit(p => { p.s = s * baseScale(); }); }
  const baseScale = () => Math.max(tpl().w / srcObj.canvas.width, tpl().h / srcObj.canvas.height);
  function setEdit(o) {
    if (!input) return;
    Object.assign(edits(), o);
    tolRow.hidden = !edits().bg;
    draw();
    changed();
  }

  function layout() {
    const t = tpl();
    const avail = Math.min(box.clientWidth - 28 || 300, 380);
    k = Math.max(4, Math.min(avail / t.w, (window.innerHeight * 0.55) / t.h));
    frame.style.width = `${t.w * k}px`;
    frame.style.height = `${t.h * k}px`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    view.width = Math.round(t.w * k * dpr);
    view.height = Math.round(t.h * k * dpr);
    drawGuides(guides, t);
  }

  function draw() {
    if (!srcObj || !input) return;
    const t = tpl(), p = pp(), ed = edits();
    let src = srcObj.canvas;
    bgMsg.textContent = '';
    if (ed.bg) {
      const r = withBackground(srcObj, ed.tolerance);
      src = r.canvas;
      if (r.share > 0.8) bgMsg.textContent = T(lang, { de: 'Das hat fast das ganze Bild erfasst – verringere die Toleranz.', en: 'That caught almost the whole picture – lower the tolerance.' });
      else if (r.share < 0.03) bgMsg.textContent = T(lang, { de: 'Kaum Hintergrund gefunden – erhöhe die Toleranz oder nutze ein Foto vor einer hellen, einfarbigen Wand.', en: 'Hardly any background found – raise the tolerance or use a photo in front of a light, plain wall.' });
    }
    const ppm = view.width / t.w;
    const g = ctx2d(view);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = `rgb(${BG.join(',')})`;
    g.fillRect(0, 0, view.width, view.height);
    g.translate(p.cx * ppm, p.cy * ppm); g.rotate(p.rot); g.scale(p.s * ppm, p.s * ppm);
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, -src.width / 2, -src.height / 2);
    view.style.filter = ed.brightness ? `brightness(${1 + ed.brightness / 100})` : '';
    zoom.value = String(p.s / baseScale());
    rot.value = String((p.rot * 180) / Math.PI);
    bright.value = String(ed.brightness || 0);
    bg.checked = !!ed.bg;
    tolRow.hidden = !ed.bg;
    tol.value = String(ed.tolerance || 22);
  }

  // pointers: 1 = pan, 2 = pinch (zoom around the midpoint)
  const pts = new Map();
  let last = null;
  frame.addEventListener('pointerdown', ev => {
    if (!srcObj) return;
    frame.setPointerCapture?.(ev.pointerId);
    pts.set(ev.pointerId, [ev.clientX, ev.clientY]);
    last = gesture();
  });
  frame.addEventListener('pointermove', ev => {
    if (!pts.has(ev.pointerId)) return;
    pts.set(ev.pointerId, [ev.clientX, ev.clientY]);
    const now = gesture();
    if (last && now && last.n === now.n) {
      const p = pp();
      if (now.n >= 2 && last.d > 0) {
        const f = now.d / last.d;
        const r = frame.getBoundingClientRect();
        const mx = (now.x - r.left) / k, my = (now.y - r.top) / k;
        p.s *= f;
        p.cx = mx + (p.cx - mx) * f;
        p.cy = my + (p.cy - my) * f;
      }
      p.cx += (now.x - last.x) / k;
      p.cy += (now.y - last.y) / k;
      draw();
    }
    last = now;
  });
  const end = ev => { pts.delete(ev.pointerId); last = gesture(); if (!pts.size) changed(); };
  frame.addEventListener('pointerup', end);
  frame.addEventListener('pointercancel', end);
  frame.addEventListener('wheel', ev => {
    if (!srcObj) return;
    ev.preventDefault();
    const f = Math.exp(-ev.deltaY / 500);
    const r = frame.getBoundingClientRect();
    const mx = (ev.clientX - r.left) / k, my = (ev.clientY - r.top) / k;
    edit(p => { p.s *= f; p.cx = mx + (p.cx - mx) * f; p.cy = my + (p.cy - my) * f; });
  }, { passive: false });
  frame.addEventListener('keydown', ev => {
    const step = ev.shiftKey ? 2 : 0.5;
    const m = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
    if (m) { ev.preventDefault(); edit(p => { p.cx += m[0]; p.cy += m[1]; }); }
    else if (ev.key === '+' || ev.key === '=') { ev.preventDefault(); edit(p => { p.s *= 1.04; }); }
    else if (ev.key === '-') { ev.preventDefault(); edit(p => { p.s /= 1.04; }); }
  });
  function gesture() {
    const a = [...pts.values()];
    if (!a.length) return null;
    const x = a.reduce((s, q) => s + q[0], 0) / a.length, y = a.reduce((s, q) => s + q[1], 0) / a.length;
    const d = a.length >= 2 ? Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]) : 0;
    return { n: a.length, x, y, d };
  }

  async function autoAlign() {
    if (!('FaceDetector' in window)) return;
    try {
      const fd = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
      const [face] = await fd.detect(srcObj.canvas);
      if (!face?.boundingBox) return;
      const b = face.boundingBox, t = tpl(), p = pp();
      p.s = ((t.head[0] + t.head[1]) / 2) / (b.height * 1.45);
      p.cx = t.w / 2 - (b.x + b.width / 2 - srcObj.canvas.width / 2) * p.s;
      p.cy = (t.chin[0] + t.chin[1]) / 2 - (b.y + b.height - srcObj.canvas.height / 2) * p.s;
      draw();
      ctx.announce(T(lang, { de: 'Gesicht erkannt und vorausgerichtet – bitte prüfen.', en: 'Face found and pre-aligned – please check.' }));
    } catch { /* not available on this device */ }
  }

  window.addEventListener('resize', () => { if (srcObj) { layout(); draw(); } });

  return {
    async refresh() {
      const inp = inputs()[0];
      box.hidden = !inp;
      if (!inp) return;
      for (const id of [...sources.keys()]) if (!inputs().some(i => i.id === id)) { sources.get(id).then(s => { release(s.canvas, s.bg); }); sources.delete(id); }
      const fresh = inp !== input;
      input = inp;
      srcObj = await source(inp);
      layout();
      draw();
      if (fresh) autoAlign();
    },
  };
}

/** Template guides into an SVG (viewBox in mm), built with DOM calls. */
function drawGuides(svg, t) {
  const NS = 'http://www.w3.org/2000/svg';
  while (svg.firstChild) svg.firstChild.remove();
  svg.setAttribute('viewBox', `0 0 ${t.w} ${t.h}`);
  const add = (tag, a) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); svg.append(e); return e; };
  const sw = t.w / 140;
  const crownMid = (t.crown[0] + t.crown[1]) / 2, chinMid = (t.chin[0] + t.chin[1]) / 2;
  const headH = chinMid - crownMid, headW = headH * 0.74;
  add('rect', { x: 0, y: t.eyes[0], width: t.w, height: t.eyes[1] - t.eyes[0], fill: 'rgba(45,212,191,.16)' });
  for (const y of t.crown) add('line', { x1: 0, x2: t.w, y1: y, y2: y, stroke: '#4DABF7', 'stroke-width': sw, 'stroke-dasharray': `${sw * 4} ${sw * 3}` });
  for (const y of t.chin) add('line', { x1: 0, x2: t.w, y1: y, y2: y, stroke: '#FFD43B', 'stroke-width': sw, 'stroke-dasharray': `${sw * 4} ${sw * 3}` });
  for (const y of t.eyes) add('line', { x1: 0, x2: t.w, y1: y, y2: y, stroke: '#2DD4BF', 'stroke-width': sw * 0.8 });
  add('line', { x1: t.w / 2, x2: t.w / 2, y1: 0, y2: t.h, stroke: 'rgba(255,255,255,.65)', 'stroke-width': sw * 0.7, 'stroke-dasharray': `${sw * 2} ${sw * 2}` });
  add('ellipse', { cx: t.w / 2, cy: (crownMid + chinMid) / 2, rx: headW / 2, ry: headH / 2, fill: 'none', stroke: 'rgba(255,255,255,.85)', 'stroke-width': sw * 1.1 });
}
