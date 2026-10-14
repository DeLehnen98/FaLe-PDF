// Tool: crop PDF pages – automatically trim white margins (content box detected on a rendered page,
// like the app's js/tools/crop.js) or drag a crop box with big touch handles on the preview; apply to
// all / odd / even / selected pages. Sets the CropBox (lossless): content outside is hidden, not deleted.
import { loadPdfLib, renderPage } from '../lib/pdf.js';
import { frame, visualRectToPdf, mm, toMm, saveResult, selectPages, userError } from '../lib/edit-draw.js';
import { createPreview } from '../lib/edit-preview.js';
import { el } from '../lib/dom.js';

const MIN = 20; // pt – smallest crop box edge

/** Content bounding box of a pdf.js page in visual points (viewport@1 incl. rotation), null if blank. */
export async function contentBox(page, { pad = 6, threshold = 242 } = {}) {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2, 800 / Math.max(base.width, base.height));
  const c = await renderPage(page, { scale });
  const g = c.getContext('2d', { willReadFrequently: true });
  const { width: W, height: H } = c;
  const d = g.getImageData(0, 0, W, H).data;
  const rows = new Uint32Array(H), cols = new Uint32Array(W);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114 < threshold) { rows[y]++; cols[x]++; }
  }
  c.width = c.height = 0;
  const first = (arr, from, step) => { for (let i = from; i >= 0 && i < arr.length; i += step) if (arr[i] >= 1) return i; return -1; };
  const y0 = first(rows, 0, 1), y1 = first(rows, H - 1, -1), x0 = first(cols, 0, 1), x1 = first(cols, W - 1, -1);
  if (y0 < 0 || x0 < 0) return null;
  const sx = base.width / W, sy = base.height / H;
  return {
    x0: Math.max(0, x0 * sx - pad), y0: Math.max(0, y0 * sy - pad),
    x1: Math.min(base.width, (x1 + 1) * sx + pad), y1: Math.min(base.height, (y1 + 1) * sy + pad),
    W: base.width, H: base.height,
  };
}

const marginsOf = b => ({ l: b.x0, t: b.y0, r: b.W - b.x1, b: b.H - b.y1 });

/** Visual rect from margins, clamped to the page. */
export function rectFrom(m, W, H) {
  const l = Math.max(0, Math.min(m.l, W - MIN)), t = Math.max(0, Math.min(m.t, H - MIN));
  const r = Math.max(0, Math.min(m.r, W - l - MIN)), b = Math.max(0, Math.min(m.b, H - t - MIN));
  return { x: l, y: t, w: W - l - r, h: H - t - b };
}

function applyCrop(page, PDFLib, rect, media) {
  const f = frame(page);
  const r = visualRectToPdf(f, rect);
  page.setCropBox(r.x, r.y, r.width, r.height);
  if (media) { page.setMediaBox(r.x, r.y, r.width, r.height); page.setBleedBox(r.x, r.y, r.width, r.height); }
  page.setTrimBox(r.x, r.y, r.width, r.height);
  if (page.node.get(PDFLib.PDFName.of('ArtBox'))) page.setArtBox(r.x, r.y, r.width, r.height);
}

let pv = null;
const detected = new Map(); // `${inputId}:${index}:${pad}` → box | null

async function detect(input, index, padMm) {
  const key = `${input.id}:${index}:${padMm}`;
  if (!detected.has(key)) {
    const doc = await input.pdfjs();
    const page = await doc.getPage(index + 1);
    try { detected.set(key, await contentBox(page, { pad: mm(padMm) })); } finally { page.cleanup(); }
  }
  return detected.get(key);
}

const M_IDS = ['ml', 'mt', 'mr', 'mb'];
const KEY = { ml: 'l', mt: 't', mr: 'r', mb: 'b' };

export default {
  options: [
    {
      id: 'mode', type: 'radio', default: 'auto', label: { de: 'Zuschneiden', en: 'Crop' },
      choices: [
        { value: 'auto', label: { de: 'Weiße Ränder entfernen', en: 'Remove white margins' }, hint: { de: 'Automatisch, für jede Seite einzeln', en: 'Automatic, for each page separately' } },
        { value: 'manual', label: { de: 'Eigener Ausschnitt', en: 'Custom area' }, hint: { de: 'Rahmen in der Vorschau ziehen', en: 'Drag the frame in the preview' } },
      ],
    },
    { id: 'pad', type: 'range', default: 3, min: 0, max: 20, step: 1, unit: 'mm', when: v => v.mode === 'auto', label: { de: 'Rand um den Inhalt', en: 'Space around the content' } },
    { id: 'ml', type: 'number', default: 15, min: 0, max: 2000, step: 0.5, unit: 'mm', when: v => v.mode === 'manual', label: { de: 'Links abschneiden', en: 'Cut from the left' } },
    { id: 'mt', type: 'number', default: 15, min: 0, max: 2000, step: 0.5, unit: 'mm', when: v => v.mode === 'manual', label: { de: 'Oben abschneiden', en: 'Cut from the top' } },
    { id: 'mr', type: 'number', default: 15, min: 0, max: 2000, step: 0.5, unit: 'mm', when: v => v.mode === 'manual', label: { de: 'Rechts abschneiden', en: 'Cut from the right' } },
    { id: 'mb', type: 'number', default: 15, min: 0, max: 2000, step: 0.5, unit: 'mm', when: v => v.mode === 'manual', label: { de: 'Unten abschneiden', en: 'Cut from the bottom' } },
    {
      id: 'scope', type: 'select', default: 'all', label: { de: 'Welche Seiten?', en: 'Which pages?' },
      choices: [
        { value: 'all', label: { de: 'Alle Seiten', en: 'All pages' } },
        { value: 'odd', label: { de: 'Ungerade Seiten', en: 'Odd pages' } },
        { value: 'even', label: { de: 'Gerade Seiten', en: 'Even pages' } },
        { value: 'range', label: { de: 'Bestimmte Seiten', en: 'Certain pages' } },
      ],
    },
    { id: 'pages', type: 'pages', default: '', when: v => v.scope === 'range', label: { de: 'Seitenbereich', en: 'Page range' } },
    { id: 'media', type: 'toggle', default: false, label: { de: 'Auch die Papiergröße anpassen', en: 'Also change the paper size' },
      hint: { de: 'Setzt zusätzlich die MediaBox – manche Druckprogramme beachten sonst nur die Originalgröße.', en: 'Also sets the MediaBox – some print programs otherwise only use the original size.' } },
  ],

  mountStage(stage, state, ctx) {
    const de = ctx.lang !== 'en';
    let geo = null; // {W, H, scale}
    const box = el('div', { class: 'ed-crop', role: 'group', aria: { label: de ? 'Zuschneide-Rahmen' : 'Crop frame' } });
    const sizeTag = el('span', { class: 'ed-crop-size' });
    const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    const NAMES = { nw: de ? 'Ecke oben links' : 'Top left corner', n: de ? 'Oberkante' : 'Top edge', ne: de ? 'Ecke oben rechts' : 'Top right corner', e: de ? 'Rechte Kante' : 'Right edge', se: de ? 'Ecke unten rechts' : 'Bottom right corner', s: de ? 'Unterkante' : 'Bottom edge', sw: de ? 'Ecke unten links' : 'Bottom left corner', w: de ? 'Linke Kante' : 'Left edge' };
    const hs = HANDLES.map(h => el('button', { type: 'button', class: 'ed-crop-h', dataset: { h }, aria: { label: `${NAMES[h]} – ${de ? 'ziehen oder Pfeiltasten' : 'drag or use the arrow keys'}` } }));
    box.append(sizeTag, ...hs);
    const autoBox = el('div', { class: 'ed-crop-dim ed-crop-auto', hidden: true, 'aria-hidden': 'true' });
    const dim = el('div', { class: 'ed-crop-dim', 'aria-hidden': 'true' });
    const clip = el('div', { class: 'ed-crop-clip', 'aria-hidden': 'true' }, dim, autoBox);
    const detectBtn = el('button', { type: 'button', class: 'ed-chip', onclick: () => detectInto() }, de ? 'Ränder dieser Seite erkennen' : 'Detect this page’s margins');
    const resetBtn = el('button', { type: 'button', class: 'ed-chip', onclick: () => setMargins({ l: 0, t: 0, r: 0, b: 0 }) }, de ? 'Ganze Seite' : 'Whole page');
    const tools = el('div', { class: 'ed-row' }, detectBtn, resetBtn);
    const note = el('p', { class: 'ed-hint' });
    const info = el('p', { class: 'ed-note' }, de
      ? 'Zuschneiden blendet den Bereich außerhalb des Rahmens nur aus – der Inhalt bleibt in der Datei und lässt sich wiederherstellen. Für vertrauliche Inhalte ist das kein Schwärzen.'
      : 'Cropping only hides the area outside the frame – the content stays in the file and can be restored. It is not a way to redact confidential content.');

    const margins = () => ({ l: mm(+state.values.ml || 0), t: mm(+state.values.mt || 0), r: mm(+state.values.mr || 0), b: mm(+state.values.mb || 0) });
    function setMargins(m, { render = true } = {}) {
      for (const id of M_IDS) {
        const v = Math.round(toMm(Math.max(0, m[KEY[id]])) * 2) / 2;
        state.values[id] = v;
        const inp = document.getElementById('wt-opt-' + id);
        if (inp && document.activeElement !== inp) inp.value = String(v);
      }
      state.results.clear();
      if (render) draw();
    }
    function input() { return state.inputs.find(i => !i.error && !i.locked); }
    async function detectInto() {
      const inp = input();
      if (!inp) return;
      const b = await detect(inp, pv.index, 2);
      if (b) setMargins(marginsOf(b));
      else note.textContent = de ? 'Auf dieser Seite wurde kein Inhalt gefunden.' : 'No content was found on this page.';
    }
    function place(node, r) {
      node.style.left = r.x * geo.scale + 'px';
      node.style.top = r.y * geo.scale + 'px';
      node.style.width = r.w * geo.scale + 'px';
      node.style.height = r.h * geo.scale + 'px';
    }
    function draw() {
      if (!geo) return;
      const manual = state.values.mode === 'manual';
      box.hidden = !manual;
      dim.hidden = !manual;
      tools.hidden = !manual;
      if (manual) {
        const r = rectFrom(margins(), geo.W, geo.H);
        place(box, r);
        place(dim, r);
        sizeTag.textContent = `${Math.round(toMm(r.w))} × ${Math.round(toMm(r.h))} mm`;
        for (const h of hs) {
          const k = h.dataset.h;
          h.style.left = (k.includes('w') ? 0 : k.includes('e') ? 100 : 50) + '%';
          h.style.top = (k.includes('n') ? 0 : k.includes('s') ? 100 : 50) + '%';
        }
        note.textContent = de ? 'Ziehe die Punkte oder den Rahmen. Der Ausschnitt gilt für alle gewählten Seiten.' : 'Drag the handles or the frame. The area applies to all selected pages.';
      }
    }
    async function drawAuto(index) {
      autoBox.hidden = true;
      if (state.values.mode !== 'auto' || !geo) return;
      const inp = input();
      const b = inp ? await detect(inp, index, +state.values.pad || 0) : null;
      if (pv.index !== index || state.values.mode !== 'auto') return;
      if (b) {
        place(autoBox, { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 });
        autoBox.hidden = false;
        note.textContent = de ? `Erkannter Inhalt: ${Math.round(toMm(b.x1 - b.x0))} × ${Math.round(toMm(b.y1 - b.y0))} mm. Wische, um andere Seiten zu prüfen.` : `Detected content: ${Math.round(toMm(b.x1 - b.x0))} × ${Math.round(toMm(b.y1 - b.y0))} mm. Swipe to check other pages.`;
      } else note.textContent = de ? 'Leere Seite – sie bleibt unverändert.' : 'Blank page – it stays unchanged.';
    }

    pv = createPreview(stage, {
      lang: ctx.lang, state, interactive: true, heightPhone: 0.55, heightDesktop: 0.7, inset: 24,
      swipeOk: ev => state.values.mode === 'auto' || !ev.target.closest('.ed-crop'),
      onRender(i) {
        geo = { W: i.W, H: i.H, scale: i.scale };
        draw();
        drawAuto(i.index);
      },
    });
    pv.layer.append(clip, box);
    pv.extra.append(tools, note, info);
    // first file: suggest the detected content box of page 1 as the manual frame
    let suggestedFor = null;
    const suggest = async () => {
      const inp = input();
      if (!inp || suggestedFor === inp.id) return;
      suggestedFor = inp.id;
      try { const b = await detect(inp, 0, 2); if (b) setMargins(marginsOf(b), { render: true }); } catch { /* keep defaults */ }
    };
    this._suggest = suggest;
    suggest();
    document.addEventListener('change', ev => { if (ev.target?.name === 'wt-opt-mode') { draw(); drawAuto(pv.index); } });
    document.addEventListener('input', ev => { if (M_IDS.includes(ev.target?.id?.slice(7))) draw(); });

    // dragging
    let drag = null;
    box.addEventListener('pointerdown', ev => {
      if (!geo || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
      ev.preventDefault();
      ev.stopPropagation();
      const h = ev.target.closest('.ed-crop-h')?.dataset.h || 'move';
      drag = { h, id: ev.pointerId, x: ev.clientX, y: ev.clientY, m: margins() };
      box.setPointerCapture(ev.pointerId);
    });
    box.addEventListener('pointermove', ev => {
      if (!drag || ev.pointerId !== drag.id) return;
      const dx = (ev.clientX - drag.x) / geo.scale, dy = (ev.clientY - drag.y) / geo.scale;
      const m = { ...drag.m };
      const { W, H } = geo;
      if (drag.h === 'move') {
        const w = W - m.l - m.r, h = H - m.t - m.b;
        m.l = Math.max(0, Math.min(W - w, m.l + dx)); m.r = W - w - m.l;
        m.t = Math.max(0, Math.min(H - h, m.t + dy)); m.b = H - h - m.t;
      } else {
        if (drag.h.includes('w')) m.l = Math.max(0, Math.min(W - m.r - MIN, m.l + dx));
        if (drag.h.includes('e')) m.r = Math.max(0, Math.min(W - m.l - MIN, m.r - dx));
        if (drag.h.includes('n')) m.t = Math.max(0, Math.min(H - m.b - MIN, m.t + dy));
        if (drag.h.includes('s')) m.b = Math.max(0, Math.min(H - m.t - MIN, m.b - dy));
      }
      setMargins(m);
    });
    const end = ev => { if (drag && ev.pointerId === drag.id) drag = null; };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
    box.addEventListener('keydown', ev => {
      const h = ev.target.closest('.ed-crop-h')?.dataset.h;
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
      if (!h || !d) return;
      ev.preventDefault();
      const step = mm(ev.shiftKey ? 5 : 1);
      const m = margins();
      if (h.includes('w')) m.l += d[0] * step;
      if (h.includes('e')) m.r -= d[0] * step;
      if (h.includes('n')) m.t += d[1] * step;
      if (h.includes('s')) m.b -= d[1] * step;
      setMargins(m);
    });
  },

  onInputs(inputs) { pv?.reset(); this._suggest?.(); },

  async run(inputs, opts, ctx) {
    const PDFLib = await loadPdfLib();
    const outputs = [];
    for (const input of inputs) {
      ctx.progress(0, { de: 'PDF wird geöffnet …', en: 'Opening PDF …' });
      const doc = await input.pdfDoc();
      const n = doc.getPageCount();
      const sel = [...selectPages(opts.scope, opts.pages, n, ctx.parsePages)].sort((a, b) => a - b);
      const pages = doc.getPages();
      let cropped = 0, blank = 0;
      const mm4 = { l: mm(+opts.ml || 0), t: mm(+opts.mt || 0), r: mm(+opts.mr || 0), b: mm(+opts.mb || 0) };
      for (let k = 0; k < sel.length; k++) {
        const i = sel[k];
        ctx.progress(k / sel.length * 0.92, { de: `Seite ${k + 1} von ${sel.length}`, en: `Page ${k + 1} of ${sel.length}` });
        const f = frame(pages[i]);
        let rect;
        if (opts.mode === 'auto') {
          const b = await detect(input, i, +opts.pad || 0);
          if (!b) { blank++; await ctx.tick(); continue; }
          // pdf.js and pdf-lib may disagree by rounding – scale the box to this page's visual size
          const sx = f.W / b.W, sy = f.H / b.H;
          rect = { x: b.x0 * sx, y: b.y0 * sy, w: (b.x1 - b.x0) * sx, h: (b.y1 - b.y0) * sy };
          if (rect.w < MIN || rect.h < MIN) { blank++; continue; }
        } else {
          rect = rectFrom(mm4, f.W, f.H);
        }
        applyCrop(pages[i], PDFLib, rect, opts.media);
        cropped++;
        await ctx.tick();
      }
      if (!cropped) throw userError(opts.mode === 'auto' ? 'Auf den gewählten Seiten wurde kein Inhalt gefunden.' : 'Keine Seite ausgewählt.', opts.mode === 'auto' ? 'No content was found on the selected pages.' : 'No page selected.');
      if (blank) ctx.note({ de: `${blank} leere Seite(n) blieben unverändert.`, en: `${blank} blank page(s) were left unchanged.` });
      ctx.progress(0.95, { de: 'Wird gespeichert …', en: 'Saving …' });
      const bytes = await saveResult(doc, ctx);
      outputs.push({
        name: ctx.fileName(input.name, ctx.lang === 'en' ? ' (cropped)' : ' (zugeschnitten)', 'pdf'), blob: new Blob([bytes], { type: 'application/pdf' }), pages: n,
        note: { de: `${cropped} von ${n} Seiten zugeschnitten`, en: `${cropped} of ${n} pages cropped` },
      });
    }
    return { outputs };
  },
};
