// Tool: document scanner – photos of pages (camera or gallery) → automatic edge detection, perspective
// correction, manual corners with big touch handles and a magnifier, filters (original / enhanced colour /
// greyscale / black & white), shadow removal, rotation, page order (file list), page size → one PDF or JPGs.
// Image processing: lib/shared/scanproc.js (synced from the app) + imgproc.js (shadow removal, in a worker).
import { el, icon, clear } from '../lib/dom.js';
import { loadPdfLib, saveDoc } from '../lib/pdf.js';
import { ensureCss, loadCanvas, encode, release, newCanvas, ctx2d, T, imgProgress, segmented } from '../lib/img-core.js';
import { detectDocument, smallImageData, warp, applyFilter, rotateCanvas, FULL_QUAD, orderQuad } from '../lib/shared/scanproc.js';

ensureCss();

const FILTERS = [
  { value: 'original', label: { de: 'Original', en: 'Original' } },
  { value: 'enhance', label: { de: 'Farbe verbessert', en: 'Enhanced colour' } },
  { value: 'gray', label: { de: 'Graustufen', en: 'Greyscale' } },
  { value: 'bw', label: { de: 'Schwarzweiß', en: 'Black & white' } },
];
const QUALITY = { small: { side: 1700, q: 0.72 }, normal: { side: 2400, q: 0.82 }, high: { side: 3300, q: 0.9 } };
const PAGE = { a4: [595.28, 841.89], letter: [612, 792] };
const CORNERS = [{ de: 'oben links', en: 'top left' }, { de: 'oben rechts', en: 'top right' }, { de: 'unten rechts', en: 'bottom right' }, { de: 'unten links', en: 'bottom left' }];

let stageCtl = null;
let defaults = { filter: 'enhance' };

/** Per-page settings in input.opts (set on first use). */
function pageOpts(input) {
  const o = input.opts;
  if (!o.scan) o.scan = { quad: null, auto: null, rot: 0, filter: defaults.filter, shadow: false };
  return o.scan;
}

async function detect(input, thumb) {
  const p = pageOpts(input);
  if (p.auto !== null) return p;
  try {
    const r = detectDocument(smallImageData(thumb, 400));
    p.auto = r.quad ? orderQuad(r.quad) : false;
  } catch (err) { console.warn(err); p.auto = false; }
  if (!p.quad) p.quad = p.auto ? p.auto.map(q => [...q]) : FULL_QUAD.map(q => [...q]);
  return p;
}

/** Process one page at a given resolution: warp → shadow removal → filter → rotation. */
async function processPage(src, p, maxSide, tick) {
  let c = await warp(src, p.quad || FULL_QUAD, { maxSide });
  await tick();
  if (p.shadow) {
    const { runOp } = await import('../lib/shared/imgproc.js');
    const g = ctx2d(c, true);
    const data = await runOp('removeShadows', g.getImageData(0, 0, c.width, c.height), { strength: 1 });
    g.putImageData(data, 0, 0);
    await tick();
  }
  c = await applyFilter(c, p.filter || 'original');
  await tick();
  if (p.rot) c = rotateCanvas(c, p.rot);
  return c;
}

export default {
  shareFirst: true,
  labels: { back_to_files: { de: 'Zurück zu den Seiten', en: 'Back to the pages' } },
  options: [
    { id: 'filter', type: 'select', default: 'enhance', label: { de: 'Filter für neue Seiten', en: 'Filter for new pages' },
      hint: { de: 'Pro Seite änderst du ihn unten beim Bearbeiten.', en: 'Change it per page while editing below.' }, choices: FILTERS },
    { id: 'pageSize', type: 'radio', default: 'a4', label: { de: 'Seitengröße', en: 'Page size' },
      choices: [
        { value: 'a4', label: 'A4', hint: { de: 'Seite wird eingepasst', en: 'Page is fitted' } },
        { value: 'letter', label: 'Letter', hint: { de: 'US-Format', en: 'US format' } },
        { value: 'fit', label: { de: 'Wie gescannt', en: 'As scanned' }, hint: { de: 'Seitenformat aus dem Foto', en: 'Page shape from the photo' } },
      ], when: v => v.output === 'pdf' },
    { id: 'quality', type: 'select', default: 'normal', label: { de: 'Dateigröße', en: 'File size' },
      choices: [
        { value: 'small', label: { de: 'Klein (zum Mailen)', en: 'Small (for e-mail)' } },
        { value: 'normal', label: { de: 'Normal', en: 'Normal' } },
        { value: 'high', label: { de: 'Hoch (zum Drucken)', en: 'High (for printing)' } },
      ] },
    { id: 'output', type: 'radio', default: 'pdf', label: { de: 'Speichern als', en: 'Save as' },
      choices: [
        { value: 'pdf', label: 'PDF', hint: { de: 'Alle Seiten in einer Datei', en: 'All pages in one file' } },
        { value: 'jpg', label: 'JPG', hint: { de: 'Ein Bild pro Seite', en: 'One image per page' } },
      ] },
  ],

  mountStage(stage, state, ctx) { stageCtl = scanStage(stage, state, ctx); stageCtl.refresh(); },
  onInputs() { stageCtl?.refresh(); },
  onOptionsChange(values) { defaults.filter = values.filter; },

  status(v, inputs) {
    return { summary: { de: inputs.length === 1 ? '1 Seite' : `${inputs.length} Seiten`, en: inputs.length === 1 ? '1 page' : `${inputs.length} pages` } };
  },

  async run(inputs, opts, ctx) {
    const Q = QUALITY[opts.quality] || QUALITY.normal;
    const pdf = opts.output !== 'jpg';
    const PDFLib = pdf ? await loadPdfLib() : null;
    const doc = pdf ? await PDFLib.PDFDocument.create() : null;
    const outputs = [];
    const stamp = new Date();
    const pad = n => String(n).padStart(2, '0');
    const base = `${ctx.t({ de: 'Scan', en: 'Scan' })} ${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(stamp.getHours())}-${pad(stamp.getMinutes())}`;
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      ctx.progress(i / inputs.length, { de: `Seite ${i + 1} von ${inputs.length}`, en: `Page ${i + 1} of ${inputs.length}` });
      await ctx.tick();
      const { canvas: src } = await loadCanvas(input, { maxSide: Math.round(Q.side * 1.25) });
      const p = pageOpts(input);
      if (p.auto === null) await detect(input, src);
      let page;
      try { page = await processPage(src, p, Q.side, ctx.tick); } finally { release(src); }
      const bw = p.filter === 'bw';
      const w = page.width, h = page.height;
      let blob;
      try { blob = await encode(page, { format: bw && pdf ? 'png' : 'jpg', quality: bw ? 0.9 : Q.q }); } finally { release(page); }
      if (pdf) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const img = bw ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        let pw, ph;
        if (opts.pageSize === 'fit') { pw = PAGE.a4[0]; ph = pw * (h / w); }
        else { [pw, ph] = PAGE[opts.pageSize] || PAGE.a4; if (w > h) [pw, ph] = [ph, pw]; }
        const pg = doc.addPage([pw, ph]);
        const s = Math.min(pw / w, ph / h);
        pg.drawImage(img, { x: (pw - w * s) / 2, y: (ph - h * s) / 2, width: w * s, height: h * s });
      } else {
        outputs.push({ name: `${base} – ${ctx.t({ de: 'Seite', en: 'page' })} ${i + 1}.jpg`, blob });
      }
      await ctx.tick();
    }
    if (pdf) {
      ctx.progress(1, { de: 'PDF wird gespeichert …', en: 'Saving PDF …' });
      await ctx.tick();
      const bytes = await saveDoc(doc, { title: base });
      outputs.push({ name: `${base}.pdf`, blob: new Blob([bytes], { type: 'application/pdf' }), pages: inputs.length });
    }
    return { outputs };
  },
};

// ---------------------------------------------------------------- stage: page strip + corner editor
function scanStage(stage, state, ctx) {
  const lang = ctx.lang;
  const thumbs = new Map();     // input.id → Promise<canvas> (display/detection source)
  const previews = new Map();   // input.id → canvas (processed, small)
  let current = 0;
  let mode = 'crop';

  const strip = el('div', { class: 'img-strip img-scan-strip', role: 'group', aria: { label: T(lang, { de: 'Seiten', en: 'Pages' }) } });
  const addBtn = el('button', { type: 'button', class: 'img-strip-btn img-scan-add', aria: { label: T(lang, { de: 'Seite hinzufügen', en: 'Add page' }) }, onclick: addPage }, icon('plus'));
  const title = el('h2', { class: 'img-h', id: 'img-scan-h' });
  const prev = el('button', { type: 'button', class: 'img-icon-btn', aria: { label: T(lang, { de: 'Vorherige Seite', en: 'Previous page' }) }, onclick: () => select(current - 1) }, icon('up'));
  const next = el('button', { type: 'button', class: 'img-icon-btn', aria: { label: T(lang, { de: 'Nächste Seite', en: 'Next page' }) }, onclick: () => select(current + 1) }, icon('down'));
  prev.firstChild.style.transform = 'rotate(-90deg)';
  next.firstChild.style.transform = 'rotate(-90deg)';
  const modeSeg = segmented({ name: 'img-scan-mode', label: { de: 'Ansicht', en: 'View' }, lang, value: mode,
    choices: [{ value: 'crop', label: { de: 'Ecken anpassen', en: 'Adjust corners' } }, { value: 'result', label: { de: 'Ergebnis', en: 'Result' } }],
    onChange: v => { mode = v; draw(); } });

  // editor
  const img = el('div', { class: 'img-scan-img' });
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'img-scan-svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const poly = document.createElementNS(svgNS, 'polygon');
  poly.setAttribute('class', 'img-scan-poly');
  svg.append(poly);
  const handles = CORNERS.map((c, k) => el('button', { type: 'button', class: 'img-scan-handle', aria: { label: T(lang, { de: `Ecke ${c.de} – mit Pfeiltasten verschieben`, en: `Corner ${c.en} – move with the arrow keys` }) } }));
  const loupe = el('canvas', { class: 'img-scan-loupe', width: 240, height: 240, hidden: true, 'aria-hidden': 'true' });
  const editor = el('div', { class: 'img-scan-editor' }, img, svg, ...handles, loupe);
  const result = el('div', { class: 'img-scan-result' });
  const view = el('div', { class: 'img-scan-view' }, editor, result);

  const filterSeg = segmented({ name: 'img-scan-filter', label: { de: 'Filter', en: 'Filter' }, lang, value: 'enhance', choices: FILTERS,
    onChange: v => update(p => { p.filter = v; }, true) });
  const shadow = el('input', { type: 'checkbox', id: 'img-scan-shadow', onchange: e => update(p => { p.shadow = e.target.checked; }, true) });
  const tools = el('div', { class: 'img-btn-row' },
    btn('restart', { de: 'Links drehen', en: 'Rotate left' }, () => update(p => { p.rot = (p.rot + 270) % 360; }, true)),
    btn('restart', { de: 'Rechts drehen', en: 'Rotate right' }, () => update(p => { p.rot = (p.rot + 90) % 360; }, true), true),
    btn('check', { de: 'Automatisch erkennen', en: 'Detect automatically' }, () => update(p => { if (p.auto) p.quad = p.auto.map(q => [...q]); else ctx.announce(T(lang, { de: 'Kein Dokument erkannt – zieh die Ecken selbst.', en: 'No document found – drag the corners yourself.' })); }, true)),
    btn('image', { de: 'Ganzes Foto', en: 'Whole photo' }, () => update(p => { p.quad = FULL_QUAD.map(q => [...q]); }, true)),
    btn('settings', { de: 'Filter für alle Seiten', en: 'Filter for all pages' }, () => {
      const f = pageOpts(inputs()[current]).filter, s = pageOpts(inputs()[current]).shadow;
      for (const inp of inputs()) { const p = pageOpts(inp); p.filter = f; p.shadow = s; previews.delete(inp.id); }
      changed(); renderStrip();
    }));
  const status = el('p', { class: 'img-muted', role: 'status' });

  const box = el('section', { class: 'img-box img-scan', aria: { labelledby: 'img-scan-h' } },
    el('div', { class: 'img-scan-head' }, title, el('div', { class: 'img-row' }, prev, next)),
    el('div', { class: 'img-strip-wrap' }, strip),
    modeSeg.root, view, status,
    filterSeg.root,
    el('div', { class: 'img-check' }, el('label', { for: 'img-scan-shadow' }, shadow, el('span', {}, T(lang, { de: 'Schatten entfernen (bei ungleichmäßigem Licht)', en: 'Remove shadows (for uneven light)' })))),
    tools);
  stage.append(box);

  function btn(ic, label, onclick, mirror = false) {
    const i = icon(ic);
    if (mirror) i.style.transform = 'scaleX(-1)';
    return el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm', onclick }, i, el('span', {}, T(lang, label)));
  }
  function addPage() {
    const app = stage.closest('#wt-app');
    const cam = app?.querySelector('[data-wt-camera]:not([hidden]) input');
    (cam || app?.querySelector('[data-wt-input]'))?.click();
  }
  const inputs = () => state.inputs.filter(i => !i.error);
  function changed() { state.results.clear(); ctx.refresh(); }

  function thumb(inp) {
    if (!thumbs.has(inp.id)) thumbs.set(inp.id, inp.thumbnail(Math.min(640, Math.max(320, stage.clientWidth || 360))).then(async c => { await detect(inp, c); return c; }).catch(err => { console.warn(err); return null; }));
    return thumbs.get(inp.id);
  }

  async function preview(inp) {
    if (previews.has(inp.id)) return previews.get(inp.id);
    const c = await thumb(inp);
    if (!c) return null;
    const pv = await processPage(c, pageOpts(inp), 900, async () => {});
    previews.set(inp.id, pv);
    return pv;
  }

  function update(fn, reprocess) {
    const inp = inputs()[current];
    if (!inp) return;
    fn(pageOpts(inp));
    if (reprocess) { const old = previews.get(inp.id); previews.delete(inp.id); if (old) release(old); }
    changed();
    draw();
    refreshStripItem(current);
  }

  function select(i) {
    const n = inputs().length;
    if (!n) return;
    current = Math.max(0, Math.min(n - 1, i));
    draw();
  }

  async function draw() {
    const list = inputs();
    if (current >= list.length) current = Math.max(0, list.length - 1);
    const inp = list[current];
    title.textContent = T(lang, { de: `Seite ${current + 1} von ${list.length}`, en: `Page ${current + 1} of ${list.length}` });
    prev.disabled = current === 0;
    next.disabled = current >= list.length - 1;
    [...strip.querySelectorAll('.img-scan-page')].forEach((b, i) => b.setAttribute('aria-pressed', String(i === current)));
    if (!inp) return;
    const c = await thumb(inp);
    if (!c || inp !== inputs()[current]) return;
    const p = pageOpts(inp);
    filterSeg.set(p.filter);
    shadow.checked = !!p.shadow;
    modeSeg.set(mode);
    editor.hidden = mode !== 'crop';
    result.hidden = mode !== 'result';
    if (mode === 'crop') {
      if (img.firstChild !== c) clear(img).append(c);
      placeHandles(p.quad);
      status.textContent = p.auto ? T(lang, { de: 'Dokument erkannt. Zieh die Ecken, falls etwas nicht passt.', en: 'Document found. Drag the corners if something is off.' })
        : T(lang, { de: 'Kein Dokument erkannt – zieh die vier Ecken auf die Blattecken.', en: 'No document found – drag the four corners onto the page corners.' });
    } else {
      status.textContent = T(lang, { de: 'So wird die Seite gespeichert (Vorschau).', en: 'This is how the page is saved (preview).' });
      clear(result).append(el('p', { class: 'img-muted' }, '…'));
      const pv = await preview(inp);
      if (pv && inp === inputs()[current] && mode === 'result') clear(result).append(copyCanvas(pv));
    }
  }

  function copyCanvas(c) {
    const t = el('canvas', { width: c.width, height: c.height, class: 'img-scan-pv' });
    ctx2d(t).drawImage(c, 0, 0);
    return t;
  }

  function placeHandles(quad) {
    poly.setAttribute('points', quad.map(([x, y]) => `${x * 100},${y * 100}`).join(' '));
    quad.forEach(([x, y], k) => { handles[k].style.left = x * 100 + '%'; handles[k].style.top = y * 100 + '%'; });
  }

  // drag corners (pointer) + arrow keys; magnifier while dragging
  handles.forEach((h, k) => {
    h.addEventListener('pointerdown', ev => {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      ev.preventDefault();
      try { h.setPointerCapture(ev.pointerId); } catch { /* optional */ }
      h.classList.add('is-active');
      const move = e => {
        const r = editor.getBoundingClientRect();
        const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
        const p = pageOpts(inputs()[current]);
        p.quad[k] = [x, y];
        placeHandles(p.quad);
        showLoupe(x, y, r);
      };
      const up = () => {
        h.removeEventListener('pointermove', move);
        h.removeEventListener('pointerup', up);
        h.removeEventListener('pointercancel', up);
        h.classList.remove('is-active');
        loupe.hidden = true;
        update(() => {}, true);
      };
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', up);
      h.addEventListener('pointercancel', up);
      move(ev);
    });
    h.addEventListener('keydown', ev => {
      const d = { ArrowLeft: [-0.005, 0], ArrowRight: [0.005, 0], ArrowUp: [0, -0.005], ArrowDown: [0, 0.005] }[ev.key];
      if (!d) return;
      ev.preventDefault();
      const f = ev.shiftKey ? 5 : 1;
      update(p => { p.quad[k] = [Math.min(1, Math.max(0, p.quad[k][0] + d[0] * f)), Math.min(1, Math.max(0, p.quad[k][1] + d[1] * f))]; }, true);
    });
  });

  function showLoupe(x, y, r) {
    const c = img.firstChild;
    if (!c) return;
    loupe.hidden = false;
    const g = ctx2d(loupe);
    // 3× magnification of the displayed picture: the loupe (120 CSS px) shows 40 CSS px around the corner
    const src = (loupe.clientWidth || 120) / 3 * (c.width / r.width);
    g.fillStyle = '#000'; g.fillRect(0, 0, loupe.width, loupe.height);
    g.imageSmoothingQuality = 'high';
    g.drawImage(c, x * c.width - src / 2, y * c.height - src / 2, src, src, 0, 0, loupe.width, loupe.height);
    g.strokeStyle = '#fff'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(loupe.width / 2, loupe.height / 2 - 26); g.lineTo(loupe.width / 2, loupe.height / 2 + 26);
    g.moveTo(loupe.width / 2 - 26, loupe.height / 2); g.lineTo(loupe.width / 2 + 26, loupe.height / 2); g.stroke();
    // keep the loupe away from the finger: top corner opposite to the touch point
    const left = x < 0.5;
    loupe.style.left = left ? 'auto' : '8px';
    loupe.style.right = left ? '8px' : 'auto';
    loupe.style.top = y < 0.4 ? 'auto' : '8px';
    loupe.style.bottom = y < 0.4 ? '8px' : 'auto';
  }

  async function refreshStripItem(i) {
    const b = strip.querySelectorAll('.img-scan-page')[i];
    const inp = inputs()[i];
    if (!b || !inp) return;
    const pv = await preview(inp);
    if (!pv) return;
    const s = 128 / Math.max(pv.width, pv.height);
    const t = el('canvas', { width: Math.round(pv.width * s), height: Math.round(pv.height * s) });
    ctx2d(t).drawImage(pv, 0, 0, t.width, t.height);
    const old = b.querySelector('canvas');
    if (old) old.replaceWith(t); else b.prepend(t);
  }

  function renderStrip() {
    clear(strip);
    inputs().forEach((inp, i) => {
      strip.append(el('button', { type: 'button', class: 'img-strip-btn img-scan-page', aria: { pressed: String(i === current), label: T(lang, { de: `Seite ${i + 1}`, en: `Page ${i + 1}` }) }, onclick: () => select(i) },
        el('span', { class: 'img-scan-num', 'aria-hidden': 'true' }, String(i + 1))));
    });
    strip.append(addBtn);
    // previews one after another (memory)
    (async () => { for (let i = 0; i < inputs().length; i++) await refreshStripItem(i); })();
  }

  return {
    refresh() {
      const list = inputs();
      for (const id of [...thumbs.keys()]) if (!list.some(i => i.id === id)) { thumbs.delete(id); release(previews.get(id)); previews.delete(id); }
      for (const inp of list) pageOpts(inp);
      box.hidden = !list.length;
      renderStrip();
      draw();
    },
  };
}
