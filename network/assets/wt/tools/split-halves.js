// Tool: split pages in half – book scans and 2-up sheets become single pages. Vertical (left | right) or
// horizontal (top | bottom); the gutter can be found automatically; cover/back page can stay whole;
// right-to-left reading order. Lossless: both halves show the original content through a smaller page box.
import { loadPdfLib, renderPage } from '../lib/pdf.js';
import { el } from '../lib/dom.js';
import { pgIcon, loadGridCss } from '../lib/pagegrid.js';
import { rearrange, saveLike, pdfBlob, userError, inputHint } from '../lib/org-common.js';

let V = null;

/** Visual rect (fractions of the displayed page, v from the top) → user-space rect for /Rotate r. */
export function visualToUser(box, r, u0, u1, v0, v1) {
  const [x0, y0, x1, y1] = box;
  const W = x1 - x0, H = y1 - y0;
  const map = (u, v) => {
    switch (((r % 360) + 360) % 360) {
      case 90: return [x0 + v * W, y0 + u * H];
      case 180: return [x1 - u * W, y0 + v * H];
      case 270: return [x1 - v * W, y1 - u * H];
      default: return [x0 + u * W, y1 - v * H];
    }
  };
  const a = map(u0, v0), b = map(u1, v1);
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
}

/** Position (0..1) of the emptiest band between 35 % and 65 % of a rendered page (gutter). */
export function findGutter(canvas, vertical) {
  const w = canvas.width, h = canvas.height;
  const { data } = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h);
  const len = vertical ? w : h, across = vertical ? h : w;
  const prof = new Float64Array(len);
  const m0 = Math.floor(across * 0.04), m1 = across - m0; // ignore the outer edges across
  for (let a = m0; a < m1; a++) {
    for (let l = 0; l < len; l++) {
      const i = (vertical ? a * w + l : l * w + a) * 4;
      prof[l] += 255 - (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) / 256;
    }
  }
  const lo = Math.floor(len * 0.35), hi = Math.ceil(len * 0.65);
  const k = Math.max(1, Math.round(len * 0.006));
  const sm = new Float64Array(len);
  for (let l = lo; l < hi; l++) { let s = 0, c = 0; for (let d = -k; d <= k; d++) { s += prof[l + d] || 0; c++; } sm[l] = s / c; }
  let min = Infinity, max = 0;
  for (let l = lo; l < hi; l++) { min = Math.min(min, sm[l]); max = Math.max(max, sm[l]); }
  if (max - min < (m1 - m0) * 2) return 0.5; // no clear structure → middle
  const eps = min + (max - min) * 0.04;
  let best = null, run = null;
  for (let l = lo; l <= hi; l++) {
    if (l < hi && sm[l] <= eps) { if (!run) run = [l, l]; else run[1] = l; continue; }
    if (run) { if (!best || run[1] - run[0] > best[1] - best[0] || (run[1] - run[0] === best[1] - best[0] && Math.abs((run[0] + run[1]) / 2 - len / 2) < Math.abs((best[0] + best[1]) / 2 - len / 2))) best = run; run = null; }
  }
  return best ? (best[0] + best[1] + 1) / 2 / len : 0.5;
}

function eligible(i, n, w, h, o) {
  if (o.keepFirst && i === 0) return false;
  if (o.keepLast && i === n - 1 && n > 1) return false;
  if (o.smart) return o.direction === 'horizontal' ? h > w * 1.05 : w > h * 1.05;
  return true;
}

async function splitPoint(page, o) {
  if (!o.auto) return 0.5;
  const canvas = await renderPage(page, { width: 360 });
  const f = findGutter(canvas, o.direction !== 'horizontal');
  canvas.width = canvas.height = 0;
  return f;
}

// ---------------------------------------------------------------- preview of one page with the cut line
async function preview() {
  if (!V?.input) return;
  const token = ++V.token;
  const pdf = await V.input.pdfjs();
  const n = pdf.numPages;
  V.index = Math.max(0, Math.min(n - 1, V.index));
  const page = await pdf.getPage(V.index + 1);
  const vp = page.getViewport({ scale: 1 });
  const o = V.values;
  const ok = eligible(V.index, n, vp.width, vp.height, o);
  const f = ok ? await splitPoint(page, o) : null;
  const canvas = await renderPage(page, { width: 300, dpr: Math.min(2, devicePixelRatio || 1) });
  if (token !== V.token) return;
  canvas.className = 'sh-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const box = el('div', { class: 'sh-box' }, canvas);
  if (f != null) {
    const line = el('span', { class: 'sh-line' + (o.direction === 'horizontal' ? ' is-h' : '') });
    if (o.direction === 'horizontal') line.style.top = `${f * 100}%`; else line.style.left = `${f * 100}%`;
    const rtl = o.direction !== 'horizontal' && o.rtl;
    const a = el('span', { class: 'sh-tag' }, rtl ? '2' : '1'), b = el('span', { class: 'sh-tag' }, rtl ? '1' : '2');
    if (o.direction === 'horizontal') { a.style.left = '50%'; a.style.top = `${f * 50}%`; b.style.left = '50%'; b.style.top = `${50 + f * 50}%`; }
    else { a.style.left = `${f * 50}%`; a.style.top = '50%'; b.style.left = `${50 + f * 50}%`; b.style.top = '50%'; }
    box.append(line, a, b);
  }
  V.view.replaceChildren(box);
  const de = V.lang === 'de';
  V.cap.textContent = de
    ? `Seite ${V.index + 1} von ${n}: ${f == null ? 'bleibt ganz' : `wird bei ${Math.round(f * 100)} % geteilt`}`
    : `Page ${V.index + 1} of ${n}: ${f == null ? 'stays whole' : `split at ${Math.round(f * 100)} %`}`;
  V.prev.disabled = V.index === 0;
  V.next.disabled = V.index >= n - 1;
}

export default {
  options: [
    {
      id: 'direction', type: 'radio', default: 'vertical',
      label: { de: 'Teilen', en: 'Split' },
      choices: [
        { value: 'vertical', label: { de: 'Links | Rechts', en: 'Left | right' }, hint: { de: 'Buchscans, Doppelseiten', en: 'Book scans, spreads' } },
        { value: 'horizontal', label: { de: 'Oben | Unten', en: 'Top | bottom' }, hint: { de: 'Zwei Seiten übereinander', en: 'Two pages stacked' } },
      ],
    },
    { id: 'auto', type: 'toggle', default: true, label: { de: 'Mitte automatisch finden', en: 'Find the gutter automatically' }, hint: { de: 'Sucht den hellen Streifen zwischen den Seiten – hilfreich, wenn der Scan nicht genau mittig ist.', en: 'Looks for the light strip between the pages – helpful when the scan isn’t centred.' } },
    { id: 'smart', type: 'toggle', default: true, label: { de: 'Nur passende Seiten teilen', en: 'Only split suitable pages' }, hint: { de: 'Links | Rechts: nur Querformat-Seiten. Oben | Unten: nur Hochformat-Seiten. Der Rest bleibt ganz.', en: 'Left | right: landscape pages only. Top | bottom: portrait pages only. The rest stays whole.' } },
    { id: 'keepFirst', type: 'toggle', default: false, label: { de: 'Erste Seite ganz lassen (Umschlag)', en: 'Keep the first page whole (cover)' } },
    { id: 'keepLast', type: 'toggle', default: false, label: { de: 'Letzte Seite ganz lassen', en: 'Keep the last page whole' } },
    { id: 'rtl', type: 'toggle', default: false, label: { de: 'Rechte Hälfte zuerst', en: 'Right half first' }, hint: { de: 'Für Bücher, die von rechts nach links gelesen werden.', en: 'For books read from right to left.' }, when: v => v.direction !== 'horizontal' },
  ],

  mountStage(host, state, ctx) {
    loadGridCss();
    V = { values: state.values, lang: ctx.lang, index: 0, token: 0, input: null };
    const t = ctx.t;
    V.view = el('div', { class: 'sh-view' });
    V.cap = el('p', { class: 'pg-status', aria: { live: 'polite' } });
    V.prev = el('button', { type: 'button', class: 'pg-btn', aria: { label: t({ de: 'Vorherige Seite', en: 'Previous page' }) }, onclick: () => { V.index--; preview(); } }, pgIcon('left'));
    V.next = el('button', { type: 'button', class: 'pg-btn', aria: { label: t({ de: 'Nächste Seite', en: 'Next page' }) }, onclick: () => { V.index++; preview(); } }, pgIcon('right'));
    V.wrap = el('div', { class: 'pg-stage sh-stage', hidden: true },
      el('p', { class: 'pg-bar-info' }, t({ de: 'Vorschau', en: 'Preview' })),
      V.view, el('div', { class: 'pg-row sh-nav' }, V.prev, V.cap, V.next));
    host.append(V.wrap);
  },

  async onInputs(inputs) {
    if (!V) return;
    const input = inputs.find(i => i.kind === 'pdf' && !i.locked) || null;
    if (input !== V.input) { V.input = input; V.index = 0; }
    V.wrap.hidden = !input;
    if (input) {
      // start the preview at the first page that will be split
      const pdf = await input.pdfjs();
      for (let i = 0; i < Math.min(pdf.numPages, 12); i++) {
        const vp = (await pdf.getPage(i + 1)).getViewport({ scale: 1 });
        if (eligible(i, pdf.numPages, vp.width, vp.height, V.values)) { V.index = i; break; }
      }
      await preview();
    }
  },

  onOptionsChange() { preview(); },

  async run(inputs, opts, ctx) {
    const input = inputs[0];
    const PDFLib = await loadPdfLib();
    const { PDFName, PDFArray, PDFDict, PDFNumber } = PDFLib;
    const pdf = await input.pdfjs();
    const doc = await input.pdfDoc();
    const pages = doc.getPages();
    const n = pages.length;
    const spec = [], boxes = [];
    let split = 0;
    for (let i = 0; i < n; i++) {
      ctx.progress(i / n * 0.8, { de: `Seite ${i + 1} von ${n}`, en: `Page ${i + 1} of ${n}` });
      const page = pages[i];
      const jsPage = await pdf.getPage(i + 1);
      const vp = jsPage.getViewport({ scale: 1 });
      if (!eligible(i, n, vp.width, vp.height, opts)) { spec.push({ page }); boxes.push(null); continue; }
      const f = await splitPoint(jsPage, opts);
      const crop = page.getCropBox(), media = page.getMediaBox();
      const x0 = Math.max(crop.x, media.x), y0 = Math.max(crop.y, media.y);
      const x1 = Math.min(crop.x + crop.width, media.x + media.width), y1 = Math.min(crop.y + crop.height, media.y + media.height);
      const box = [x0, y0, x1, y1];
      const r = page.getRotation().angle;
      let halves = opts.direction === 'horizontal'
        ? [visualToUser(box, r, 0, 1, 0, f), visualToUser(box, r, 0, 1, f, 1)]
        : [visualToUser(box, r, 0, f, 0, 1), visualToUser(box, r, f, 1, 0, 1)];
      if (opts.direction !== 'horizontal' && opts.rtl) halves = halves.reverse();
      spec.push({ page }, { page });
      boxes.push(...halves);
      split++;
      if (i % 4 === 3) await ctx.tick();
    }
    if (!split) throw inputHint('Keine Seite passt zum Teilen. Schalte „Nur passende Seiten teilen“ aus oder wähle die andere Richtung.', 'No page fits for splitting. Turn off “Only split suitable pages” or choose the other direction.');
    rearrange(doc, PDFLib, spec);
    const out = doc.getPages();
    out.forEach((p, k) => {
      const b = boxes[k];
      if (!b) return;
      const arr = doc.context.obj(b.map(v => PDFNumber.of(Math.round(v * 1000) / 1000)));
      p.node.set(PDFName.of('MediaBox'), arr);
      p.node.set(PDFName.of('CropBox'), arr);
      for (const k2 of ['TrimBox', 'BleedBox', 'ArtBox']) p.node.delete(PDFName.of(k2));
      // annotations outside this half belong to the other one
      const annots = p.node.lookup(PDFName.of('Annots'));
      if (annots instanceof PDFArray) {
        for (let a = annots.size() - 1; a >= 0; a--) {
          const d = annots.lookup(a);
          const rect = d instanceof PDFDict ? d.lookup(PDFName.of('Rect')) : null;
          if (!(rect instanceof PDFArray) || rect.size() < 4) continue;
          const [ax0, ay0, ax1, ay1] = [0, 1, 2, 3].map(j => rect.lookup(j)?.asNumber?.() ?? 0);
          const cx = (Math.min(ax0, ax1) + Math.max(ax0, ax1)) / 2, cy = (Math.min(ay0, ay1) + Math.max(ay0, ay1)) / 2;
          if (cx < b[0] || cx > b[2] || cy < b[1] || cy > b[3]) annots.remove(a);
        }
      }
    });
    ctx.progress(0.9, { de: 'Wird gespeichert …', en: 'Saving …' });
    await ctx.tick();
    const bytes = await saveLike(doc, input, ctx);
    const de = ctx.lang === 'de';
    return { outputs: [{
      name: ctx.fileName(input.name, de ? ' (Seiten geteilt)' : ' (pages split)', 'pdf'), blob: pdfBlob(bytes), pages: out.length,
      note: de ? `${split} von ${n} Seiten geteilt → ${out.length} Seiten` : `${split} of ${n} pages split → ${out.length} pages`,
    }] };
  },
};
