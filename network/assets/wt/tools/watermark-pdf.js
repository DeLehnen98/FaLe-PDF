// Tool: watermark – text or image (PNG transparency kept), opacity, rotation (true corner-to-corner
// diagonal per page), size relative to the page, one position (tap on the preview) or tiled, above or
// below the page content, page selection. Drawn in each page's visual frame (/Rotate, CropBox offsets).
import { loadPdfLib } from '../lib/pdf.js';
import { frame, drawVisual, fontCache, fitText, hexColor, lostWarning, mm, FONT_CHOICES, onePageDoc, savePreview, pageLang, saveResult, previewSource, selectPages, drawCentered, rotatedBox, userError } from '../lib/edit-draw.js';
import { createPreview, positionZones } from '../lib/edit-preview.js';
import { filePicker } from '../lib/edit-controls.js';
import { embedImage } from '../lib/imgembed.js';

const LANG = pageLang();
let pv = null;
let picker = null;
let wmImage = null; // InputFile
const source = previewSource();

export function angleFor(rot, W, H) {
  if (rot === 'diag') return Math.atan2(H, W) * 180 / Math.PI;
  return Number(rot) || 0;
}

/** Length of the line through the page centre at `angle` that fits inside W × H. */
function lineLen(W, H, angle) {
  const r = angle * Math.PI / 180, c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
  return Math.min(c > 1e-6 ? W / c : Infinity, s > 1e-6 ? H / s : Infinity);
}

async function makeAssets(doc, PDFLib, opts) {
  if (opts.kind === 'image') {
    if (!wmImage) return null;
    const img = await embedImage(doc, wmImage);
    return { img };
  }
  const fonts = fontCache(doc, PDFLib);
  const r = await fitText(fonts, opts.font, String(opts.text || '').replace(/\s*\n\s*/g, ' ').trim());
  if (!r.text.trim()) return null;
  return { font: r.font, text: r.text, lost: r.lost, color: hexColor(PDFLib, opts.color, '#c8102e') };
}

function stamp(page, PDFLib, a, opts) {
  const f = frame(page);
  const { W, H } = f;
  const angle = angleFor(opts.rotation, W, H);
  const tile = opts.layout === 'tile';
  const pct = Math.max(0.05, Math.min(1, (+opts.size || 50) / 100));
  const target = lineLen(W, H, angle) * pct * (tile ? 0.5 : 1);
  let item, iw, ih;
  if (a.text != null) {
    const w1 = a.font.widthOfTextAtSize(a.text, 1);
    const h1 = a.font.heightAtSize(1, { descender: false });
    let size = target / w1;
    size = Math.min(size, (Math.min(W, H) * 0.9) / h1, 600);
    item = { text: a.text, font: a.font, size, color: a.color };
    iw = w1 * size; ih = h1 * size;
  } else {
    const ar = a.img.height / a.img.width;
    iw = target; ih = iw * ar;
    const [bw0, bh0] = rotatedBox(iw, ih, angle);
    const k = Math.min(1, (W * 0.98) / bw0, (H * 0.98) / bh0);
    if (!tile) { iw *= k; ih *= k; }
    item = { img: a.img, w: iw, h: ih };
  }
  const [bw, bh] = rotatedBox(iw, ih, angle);
  const op = Math.max(0.02, Math.min(1, (+opts.opacity || 30) / 100));
  drawVisual(page, PDFLib, f, () => {
    if (tile) {
      const gx = bw + Math.max(mm(8), bw * 0.25), gy = bh + Math.max(mm(8), bh * 0.6);
      const cols = Math.ceil(W / gx) + 2, rows = Math.ceil(H / gy) + 2;
      const x0 = W / 2 - Math.floor(cols / 2) * gx, y0 = H / 2 - Math.floor(rows / 2) * gy;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const cx = x0 + c * gx + (r % 2 ? gx / 2 : 0), cy = y0 + r * gy;
        if (cx + bw / 2 < 0 || cx - bw / 2 > W || cy + bh / 2 < 0 || cy - bh / 2 > H) continue;
        drawCentered(page, PDFLib, item, cx, cy, angle, op);
      }
    } else {
      const pos = opts.position || 'mc';
      const m = Math.min(mm(10), W / 8, H / 8);
      const cx = pos[1] === 'l' ? m + bw / 2 : pos[1] === 'r' ? W - m - bw / 2 : W / 2;
      const cy = pos[0] === 'b' ? m + bh / 2 : pos[0] === 't' ? H - m - bh / 2 : H / 2;
      drawCentered(page, PDFLib, item, cx, cy, angle, op);
    }
  }, { under: opts.layer === 'under' });
}

async function watermarkDoc(doc, PDFLib, opts, ctx, { only = null, onPage = null } = {}) {
  const a = await makeAssets(doc, PDFLib, opts);
  if (!a) return { assets: null, done: 0 };
  const count = only ? only.count : doc.getPageCount();
  const sel = selectPages(opts.scope, opts.pages, count, ctx.parsePages);
  const pages = doc.getPages();
  let done = 0;
  for (let i = 0; i < count; i++) {
    if (!sel.has(i)) continue;
    const page = only ? (i === only.index ? pages[0] : null) : pages[i];
    if (!page) continue;
    stamp(page, PDFLib, a, opts);
    done++;
    if (onPage && done % 10 === 0) await onPage(done, sel.size);
  }
  return { assets: a, done };
}

export default {
  options: [
    { id: 'position', type: 'text', default: 'mc', when: () => false, label: 'position' },
    { id: 'imageId', type: 'text', default: '', when: () => false, label: 'image' },
    {
      id: 'kind', type: 'radio', default: 'text', label: { de: 'Art', en: 'Type' },
      choices: [
        { value: 'text', label: { de: 'Text', en: 'Text' }, hint: { de: 'z. B. VERTRAULICH oder ENTWURF', en: 'e.g. CONFIDENTIAL or DRAFT' } },
        { value: 'image', label: { de: 'Bild / Logo', en: 'Image / logo' }, hint: { de: 'PNG mit Transparenz, JPG …', en: 'PNG with transparency, JPG …' } },
      ],
    },
    { id: 'text', type: 'text', default: LANG === 'en' ? 'CONFIDENTIAL' : 'VERTRAULICH', maxLength: 120, when: v => v.kind !== 'image', label: { de: 'Text', en: 'Text' },
      validate: (v, lang) => (String(v || '').trim() ? '' : (lang === 'en' ? 'Enter a text.' : 'Gib einen Text ein.')) },
    { id: 'font', type: 'select', default: 'sans-bold', when: v => v.kind !== 'image', label: { de: 'Schrift', en: 'Font' }, choices: FONT_CHOICES },
    { id: 'color', type: 'color', default: '#c8102e', when: v => v.kind !== 'image', label: { de: 'Farbe', en: 'Colour' } },
    { id: 'opacity', type: 'range', default: 25, min: 5, max: 100, step: 5, unit: '%', label: { de: 'Deckkraft', en: 'Opacity' } },
    {
      id: 'rotation', type: 'select', default: 'diag', label: { de: 'Drehung', en: 'Rotation' },
      choices: [
        { value: 'diag', label: { de: 'Diagonal (Ecke zu Ecke)', en: 'Diagonal (corner to corner)' } },
        { value: '0', label: { de: 'Waagerecht', en: 'Horizontal' } },
        { value: '45', label: '45°' },
        { value: '-45', label: '−45°' },
        { value: '90', label: { de: 'Senkrecht', en: 'Vertical' } },
      ],
    },
    { id: 'size', type: 'range', default: 70, min: 10, max: 100, step: 5, unit: '%', label: { de: 'Größe', en: 'Size' },
      hint: { de: '100 % reicht von Rand zu Rand.', en: '100 % reaches from edge to edge.' } },
    {
      id: 'layout', type: 'radio', default: 'single', label: { de: 'Anordnung', en: 'Layout' },
      choices: [
        { value: 'single', label: { de: 'Einmal', en: 'Once' }, hint: { de: 'Stelle in der Vorschau antippen', en: 'Tap a spot in the preview' } },
        { value: 'tile', label: { de: 'Gekachelt', en: 'Tiled' }, hint: { de: 'Über die ganze Seite verteilt', en: 'Repeated across the page' } },
      ],
    },
    {
      id: 'layer', type: 'radio', default: 'over', label: { de: 'Ebene', en: 'Layer' },
      choices: [
        { value: 'over', label: { de: 'Über dem Inhalt', en: 'Above the content' }, hint: { de: 'Immer sichtbar', en: 'Always visible' } },
        { value: 'under', label: { de: 'Unter dem Inhalt', en: 'Below the content' }, hint: { de: 'Text bleibt besser lesbar; bei Scans verdeckt', en: 'Text stays easier to read; hidden by scans' } },
      ],
    },
    {
      id: 'scope', type: 'select', default: 'all', label: { de: 'Seiten', en: 'Pages' },
      choices: [
        { value: 'all', label: { de: 'Alle Seiten', en: 'All pages' } },
        { value: 'odd', label: { de: 'Ungerade Seiten (1, 3, 5 …)', en: 'Odd pages (1, 3, 5 …)' } },
        { value: 'even', label: { de: 'Gerade Seiten (2, 4, 6 …)', en: 'Even pages (2, 4, 6 …)' } },
        { value: 'range', label: { de: 'Bestimmte Seiten', en: 'Certain pages' } },
      ],
    },
    { id: 'pages', type: 'pages', default: '', when: v => v.scope === 'range', label: { de: 'Seitenbereich', en: 'Page range' } },
  ],

  mountStage(stage, state, ctx) {
    pv = createPreview(stage, {
      lang: ctx.lang, state, sticky: true,
      async build(index, values, signal) {
        const PDFLib = await loadPdfLib();
        const src = await source(state.inputs.find(i => !i.error && !i.locked));
        if (signal.aborted) return null;
        const doc = await onePageDoc(PDFLib, src, index);
        let opts = values;
        try { ctx.parsePages(values.pages || '', src.getPageCount()); } catch { opts = { ...values, pages: '' }; }
        const r = await watermarkDoc(doc, PDFLib, opts, ctx, { only: { index, count: src.getPageCount() } });
        pv.setWarning(values.kind === 'image' && !wmImage
          ? { de: 'Wähle unten ein Bild für das Wasserzeichen.', en: 'Choose an image for the watermark below.' }
          : lostWarning(r.assets?.lost));
        return savePreview(doc);
      },
    });
    const zones = positionZones(pv, {
      lang: ctx.lang, title: ctx.t({ de: 'Position des Wasserzeichens', en: 'Position of the watermark' }),
      get: () => state.values.position || 'mc',
      set: v => { state.values.position = v; if (state.values.layout === 'tile') { state.values.layout = 'single'; const r = document.querySelector('input[name="wt-opt-layout"][value="single"]'); if (r) r.checked = true; } pv.refresh(0); },
    });
    picker = filePicker({
      lang: ctx.lang, accept: 'image/png,image/jpeg,image/webp,image/gif,image/avif,.png,.jpg,.jpeg,.webp,.gif,.avif', kinds: ['image'],
      label: ctx.t({ de: 'Bild für das Wasserzeichen', en: 'Image for the watermark' }),
      hint: ctx.t({ de: 'Transparente PNGs bleiben transparent. Das Bild bleibt auf deinem Gerät.', en: 'Transparent PNGs stay transparent. The image stays on your device.' }),
      onFile: inp => { wmImage = inp; state.values.imageId = inp ? inp.id : ''; pv.refresh(0); },
    });
    const syncPicker = () => {
      picker.root.hidden = state.values.kind !== 'image';
      zones.root.hidden = state.values.layout === 'tile';
    };
    document.addEventListener('change', syncPicker);
    syncPicker();
    pv.extra.append(picker.root);
  },

  onInputs() { pv?.reset(); },

  async run(inputs, opts, ctx) {
    if (opts.kind === 'image' && !wmImage) throw userError('Wähle zuerst ein Bild für das Wasserzeichen aus.', 'Choose an image for the watermark first.');
    const PDFLib = await loadPdfLib();
    const outputs = [];
    for (const input of inputs) {
      ctx.progress(0, { de: 'PDF wird geöffnet …', en: 'Opening PDF …' });
      const doc = await input.pdfDoc();
      const r = await watermarkDoc(doc, PDFLib, opts, ctx, {
        onPage: async (i, n) => { ctx.progress(i / n * 0.9, { de: `Seite ${i} von ${n}`, en: `Page ${i} of ${n}` }); await ctx.tick(); },
      });
      if (!r.assets) throw userError('Gib einen Text für das Wasserzeichen ein.', 'Enter a text for the watermark.');
      const w = lostWarning(r.assets.lost);
      if (w) ctx.note(w);
      if (opts.layer === 'under') ctx.note({ de: 'Unter dem Inhalt ist das Wasserzeichen nur dort sichtbar, wo die Seite durchsichtig ist. Bei Scans und Seiten mit weißem Hintergrund wähle „Über dem Inhalt“.', en: 'Below the content, the watermark only shows where the page is transparent. For scans and pages with a white background, choose “Above the content”.' });
      ctx.progress(0.95, { de: 'Wird gespeichert …', en: 'Saving …' });
      await ctx.tick();
      const bytes = await saveResult(doc, ctx);
      outputs.push({ name: ctx.fileName(input.name, ctx.lang === 'en' ? ' (watermark)' : ' (Wasserzeichen)', 'pdf'), blob: new Blob([bytes], { type: 'application/pdf' }), pages: doc.getPageCount() });
    }
    return { outputs };
  },
};
