// Tool: letterhead / overlay – put a background PDF (or image) under or over every page: own design for
// the first page and the following pages (page 2 of the letterhead, a second file, the same or none),
// fit / fill / stretch, opacity. Vector letterheads stay vector; /Rotate and CropBox of both files respected.
import { loadPdfLib } from '../lib/pdf.js';
import { frame, drawVisual, mul, placeMatrix, cropBoundingBox, clipOps, onePageDoc, savePreview, saveResult, previewSource, drawCentered, userError } from '../lib/edit-draw.js';
import { createPreview } from '../lib/edit-preview.js';
import { filePicker } from '../lib/edit-controls.js';
import { embedImage } from '../lib/imgembed.js';

let pv = null;
let design1 = null, design2 = null; // InputFile (pdf or image)
const source = previewSource();

/** Which design (and which page of it) a page gets: {file, page} | null */
export function designFor(i, opts, d1, d2, d1Pages) {
  if (!d1) return null;
  if (i === 0) return { file: d1, page: 0 };
  switch (opts.follow) {
    case 'none': return null;
    case 'page2': return { file: d1, page: d1Pages > 1 ? 1 : 0 };
    case 'file2': return d2 ? { file: d2, page: 0 } : { file: d1, page: 0 };
    default: return { file: d1, page: 0 };
  }
}

/** Placement of a design of visual size w × h on a page W × H: {sx, sy, tx, ty} */
export function fitBox(mode, w, h, W, H) {
  if (mode === 'stretch') return { sx: W / w, sy: H / h, tx: 0, ty: 0 };
  const s = mode === 'fill' ? Math.max(W / w, H / h) : Math.min(W / w, H / h);
  return { sx: s, sy: s, tx: (W - w * s) / 2, ty: (H - h * s) / 2 };
}

function designCache(doc, PDFLib) {
  const cache = new Map();
  return async d => {
    const key = `${d.file.id}:${d.page}`;
    if (!cache.has(key)) {
      if (d.file.kind === 'pdf') {
        const src = await d.file.pdfDoc();
        const p = src.getPage(Math.min(d.page, src.getPageCount() - 1));
        const f = frame(p);
        const emb = await doc.embedPage(p, cropBoundingBox(p));
        cache.set(key, { kind: 'pdf', emb, rot: f.rot, cw: f.box.width, ch: f.box.height, W: f.W, H: f.H });
      } else {
        const img = await embedImage(doc, d.file);
        cache.set(key, { kind: 'img', img, W: img.width, H: img.height });
      }
    }
    return cache.get(key);
  };
}

function drawDesign(page, PDFLib, it, opts) {
  const f = frame(page);
  const b = fitBox(opts.fit, it.W, it.H, f.W, f.H);
  const op = Math.max(0.05, Math.min(1, (+opts.opacity || 100) / 100));
  drawVisual(page, PDFLib, f, () => {
    const { pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject, setGraphicsState } = PDFLib;
    if (it.kind === 'pdf') {
      const ops = [pushGraphicsState(), ...clipOps(PDFLib, { x: 0, y: 0, width: f.W, height: f.H })];
      if (op < 1) ops.push(setGraphicsState(page.node.newExtGState('GS', page.doc.context.obj({ Type: 'ExtGState', ca: op, CA: op }))));
      const name = page.node.newXObject('FaLeBg', it.emb.ref);
      ops.push(concatTransformationMatrix(...mul([b.sx, 0, 0, b.sy, b.tx, b.ty], placeMatrix(it.rot, it.cw, it.ch, 1, 0, 0))), drawObject(name), popGraphicsState());
      page.pushOperators(...ops);
    } else {
      page.pushOperators(pushGraphicsState(), ...clipOps(PDFLib, { x: 0, y: 0, width: f.W, height: f.H }));
      drawCentered(page, PDFLib, { img: it.img, w: it.W * b.sx, h: it.H * b.sy }, b.tx + it.W * b.sx / 2, b.ty + it.H * b.sy / 2, 0, op);
      page.pushOperators(popGraphicsState());
    }
  }, { under: opts.layer !== 'over' });
}

async function applyAll(doc, PDFLib, opts, { only = null, tick = null } = {}) {
  const get = designCache(doc, PDFLib);
  const d1Pages = design1?.kind === 'pdf' ? await design1.pageCount() : 1;
  const pages = doc.getPages();
  const count = only ? only.count : pages.length;
  let done = 0;
  for (let i = 0; i < count; i++) {
    const page = only ? (i === only.index ? pages[0] : null) : pages[i];
    if (!page) continue;
    const d = designFor(i, opts, design1, design2, d1Pages);
    if (!d) continue;
    drawDesign(page, PDFLib, await get(d), opts);
    done++;
    if (tick && done % 10 === 0) await tick(i, count);
  }
  return done;
}

const ACCEPT = 'application/pdf,.pdf,image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';

export default {
  options: [
    { id: 'd1', type: 'text', default: '', when: () => false, label: 'design' },
    { id: 'd2', type: 'text', default: '', when: () => false, label: 'design 2' },
    {
      id: 'follow', type: 'select', default: 'same', label: { de: 'Folgeseiten (ab Seite 2)', en: 'Following pages (from page 2)' },
      choices: [
        { value: 'same', label: { de: 'Gleiches Briefpapier wie Seite 1', en: 'Same design as page 1' } },
        { value: 'page2', label: { de: 'Seite 2 der Briefpapier-PDF', en: 'Page 2 of the letterhead PDF' } },
        { value: 'file2', label: { de: 'Eigene Datei für Folgeseiten …', en: 'Separate file for following pages …' } },
        { value: 'none', label: { de: 'Kein Briefpapier – nur Seite 1', en: 'No design – page 1 only' } },
      ],
    },
    {
      id: 'layer', type: 'radio', default: 'under', label: { de: 'Ebene', en: 'Layer' },
      choices: [
        { value: 'under', label: { de: 'Darunter (Briefpapier)', en: 'Below (letterhead)' }, hint: { de: 'Dein Text liegt oben', en: 'Your text stays on top' } },
        { value: 'over', label: { de: 'Darüber (Stempel, Overlay)', en: 'Above (stamp, overlay)' }, hint: { de: 'Auch bei Scans sichtbar', en: 'Visible on scans, too' } },
      ],
    },
    {
      id: 'fit', type: 'radio', default: 'fit', label: { de: 'Größe', en: 'Size' },
      choices: [
        { value: 'fit', label: { de: 'Einpassen', en: 'Fit' }, hint: { de: 'Seitenverhältnis bleibt', en: 'Keeps the aspect ratio' } },
        { value: 'fill', label: { de: 'Ausfüllen', en: 'Fill' }, hint: { de: 'Ränder werden abgeschnitten', en: 'Edges are cut off' } },
        { value: 'stretch', label: { de: 'Strecken', en: 'Stretch' }, hint: { de: 'Genau auf die Seite', en: 'Exactly to the page' } },
      ],
    },
    { id: 'opacity', type: 'range', default: 100, min: 10, max: 100, step: 5, unit: '%', label: { de: 'Deckkraft', en: 'Opacity' } },
  ],

  mountStage(stage, state, ctx) {
    const de = ctx.lang !== 'en';
    pv = createPreview(stage, {
      lang: ctx.lang, state, sticky: true,
      async build(index, values, signal) {
        const PDFLib = await loadPdfLib();
        const src = await source(state.inputs.find(i => !i.error && !i.locked));
        if (signal.aborted) return null;
        const doc = await onePageDoc(PDFLib, src, index);
        if (design1) await applyAll(doc, PDFLib, values, { only: { index, count: src.getPageCount() } });
        pv.setWarning(design1 ? null : { de: 'Wähle unten dein Briefpapier (PDF oder Bild).', en: 'Choose your letterhead below (PDF or image).' });
        return savePreview(doc);
      },
    });
    const p1 = filePicker({
      lang: ctx.lang, accept: ACCEPT, kinds: ['pdf', 'image'],
      label: de ? 'Briefpapier (PDF oder Bild)' : 'Letterhead (PDF or image)',
      hint: de ? 'Am besten eine PDF in der Größe deiner Seiten – so bleiben Logo und Schrift gestochen scharf. Hat sie zwei Seiten, wird Seite 2 für die Folgeseiten verwendet.' : 'Ideally a PDF the size of your pages – logo and type stay crisp. If it has two pages, page 2 is used for the following pages.',
      onFile: async inp => {
        design1 = inp;
        state.values.d1 = inp ? inp.id : '';
        if (inp?.kind === 'pdf' && (await inp.pageCount()) > 1 && state.values.follow === 'same') {
          state.values.follow = 'page2';
          const sel = document.getElementById('wt-opt-follow');
          if (sel) sel.value = 'page2';
        }
        pv.refresh(0);
      },
    });
    const p2 = filePicker({
      lang: ctx.lang, accept: ACCEPT, kinds: ['pdf', 'image'],
      label: de ? 'Briefpapier für die Folgeseiten' : 'Design for the following pages',
      onFile: inp => { design2 = inp; state.values.d2 = inp ? inp.id : ''; pv.refresh(0); },
    });
    const sync = () => { p2.root.hidden = state.values.follow !== 'file2'; };
    document.addEventListener('change', sync);
    sync();
    pv.extra.append(p1.root, p2.root);
  },

  onInputs() { pv?.reset(); },

  async run(inputs, opts, ctx) {
    if (!design1) throw userError('Wähle zuerst dein Briefpapier aus (PDF oder Bild).', 'Choose your letterhead first (PDF or image).');
    if (opts.follow === 'file2' && !design2) ctx.note({ de: 'Für die Folgeseiten wurde keine eigene Datei gewählt – sie bekommen das Briefpapier der ersten Seite.', en: 'No separate file was chosen for the following pages – they get the first page’s design.' });
    if (opts.follow === 'page2' && design1.kind === 'pdf' && (await design1.pageCount()) < 2) ctx.note({ de: 'Die Briefpapier-PDF hat nur eine Seite – sie wird auch für die Folgeseiten verwendet.', en: 'The letterhead PDF has only one page – it is used for the following pages, too.' });
    const PDFLib = await loadPdfLib();
    const outputs = [];
    for (const input of inputs) {
      ctx.progress(0, { de: 'PDF wird geöffnet …', en: 'Opening PDF …' });
      const doc = await input.pdfDoc();
      const n = await applyAll(doc, PDFLib, opts, {
        tick: async (i, total) => { ctx.progress(i / total * 0.9, { de: `Seite ${i + 1} von ${total}`, en: `Page ${i + 1} of ${total}` }); await ctx.tick(); },
      });
      if (opts.layer !== 'over') ctx.note({ de: 'Siehst du das Briefpapier nicht? Dann hat dein Dokument einen weißen Hintergrund (z. B. ein Scan). Wähle in dem Fall „Darüber“.', en: 'Can’t see the letterhead? Then your document has a white background (e.g. a scan). In that case choose “Above”.' });
      ctx.progress(0.95, { de: 'Wird gespeichert …', en: 'Saving …' });
      await ctx.tick();
      const bytes = await saveResult(doc, ctx);
      outputs.push({ name: ctx.fileName(input.name, ctx.lang === 'en' ? ' (letterhead)' : ' (Briefpapier)', 'pdf'), blob: new Blob([bytes], { type: 'application/pdf' }), pages: doc.getPageCount(),
        note: { de: `Briefpapier auf ${n} von ${doc.getPageCount()} Seiten`, en: `Design on ${n} of ${doc.getPageCount()} pages` } });
    }
    return { outputs };
  },
};
