// Tool: PDF → PowerPoint (PPTX). Every page becomes a slide with a sharp picture of the page (exact
// look), optionally the page text as speaker notes. Port of the app's js/tools/toppt.js; written with
// the vendored pptxgenjs library (loaded by lib/shared/office/vendor.js).
import { analysePdf, buildModel, modelToPlainText } from '../lib/conv-pdfmodel.js';
import { PAGES_OPTION, coarsePointer, thumbStrip, canvasThumb, userError } from '../lib/conv-common.js';
import { renderPage, canvasToBlob } from '../lib/pdf.js';

const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

export default {
  options: [
    { ...PAGES_OPTION, when: (v, inputs) => inputs.length <= 1 },
    {
      id: 'layout', type: 'radio', default: 'page',
      label: { de: 'Folienformat', en: 'Slide size' },
      choices: [
        { value: 'page', label: { de: 'Wie die PDF', en: 'Like the PDF' }, hint: { de: 'Folien so geformt wie die Seiten – kein Rand', en: 'Slides shaped like the pages – no borders' } },
        { value: '16x9', label: '16:9', hint: { de: 'Breitbild, Seite mittig eingepasst', en: 'Widescreen, page centred' } },
        { value: '4x3', label: '4:3', hint: { de: 'Klassisch, Seite mittig eingepasst', en: 'Classic, page centred' } },
      ],
    },
    {
      id: 'dpi', type: 'radio', default: '160',
      label: { de: 'Bildqualität', en: 'Picture quality' },
      choices: [
        { value: '110', label: { de: 'Kompakt', en: 'Compact' }, hint: { de: 'Kleine Datei, gut zum Verschicken', en: 'Small file, good for sending' } },
        { value: '160', label: { de: 'Standard', en: 'Standard' }, hint: { de: 'Scharf auf Bildschirmen', en: 'Sharp on screens' } },
        { value: '230', label: { de: 'Hoch', en: 'High' }, hint: { de: 'Für Beamer und Druck', en: 'For projectors and print' } },
      ],
    },
    {
      id: 'notes', type: 'toggle', default: true,
      label: { de: 'Seitentext als Sprechernotizen', en: 'Page text as speaker notes' },
      hint: { de: 'Der Text jeder Seite steht in den Notizen – praktisch zum Vortragen und Durchsuchen.', en: 'The text of each page goes into the notes – handy for presenting and searching.' },
    },
  ],
  get shareFirst() { return coarsePointer(); },

  async run(inputs, opts, ctx) {
    const { loadPptxGen, loadJSZip } = await import('../lib/shared/office/vendor.js');
    const { PLACEHOLDER_JPEG, writePptx } = await import('../lib/shared/pptximg.js');
    let PptxGenJS;
    try { PptxGenJS = await loadPptxGen(); } catch (err) { throw userError(err, 'The presentation library could not be loaded.'); }
    const dpi = Math.max(72, Math.min(300, Number(opts.dpi) || 160));
    const outputs = [];
    for (let f = 0; f < inputs.length; f++) {
      const input = inputs[f];
      const pdf = await input.pdfjs();
      const idx = inputs.length === 1 ? ctx.parsePages(opts.pages, pdf.numPages) : Array.from({ length: pdf.numPages }, (_, i) => i);
      const pre = inputs.length > 1 ? { de: `Datei ${f + 1} von ${inputs.length}: `, en: `File ${f + 1} of ${inputs.length}: ` } : { de: '', en: '' };
      const pptx = new PptxGenJS();
      pptx.author = 'FaLe Werkzeuge';
      pptx.title = input.name.replace(/\.pdf$/i, '');
      let W = 10, H = 5.625;
      if (opts.layout === '16x9') pptx.layout = 'LAYOUT_16x9';
      else if (opts.layout === '4x3') { pptx.layout = 'LAYOUT_4x3'; H = 7.5; }
      else {
        const p1 = await pdf.getPage(idx[0] + 1);
        const vp = p1.getViewport({ scale: 1 });
        if (vp.width >= vp.height) { W = 10; H = Math.max(1, 10 * vp.height / vp.width); } else { H = 10; W = Math.max(1, 10 * vp.width / vp.height); }
        pptx.defineLayout({ name: 'FALE_PDF', width: W, height: H });
        pptx.layout = 'FALE_PDF';
      }
      const thumbs = [], jpgs = [];
      for (let k = 0; k < idx.length; k++) {
        ctx.progress((f + k / idx.length) / inputs.length, { de: `${pre.de}Folie ${k + 1} von ${idx.length}`, en: `${pre.en}Slide ${k + 1} of ${idx.length}` });
        const page = await pdf.getPage(idx[k] + 1);
        const vp = page.getViewport({ scale: 1 });
        const canvas = await renderPage(page, { scale: dpi / 72, signal: ctx.signal });
        const blob = await canvasToBlob(canvas, 'image/jpeg', 0.88);
        if (f === 0 && thumbs.length < 8) thumbs.push(await canvasThumb(canvas));
        canvas.width = canvas.height = 0;
        jpgs.push(new Uint8Array(await blob.arrayBuffer()));
        const s = Math.min(W / vp.width, H / vp.height);
        const w = vp.width * s, h = vp.height * s;
        const slide = pptx.addSlide();
        slide.background = { color: 'FFFFFF' };
        slide.addImage({ data: PLACEHOLDER_JPEG, x: (W - w) / 2, y: (H - h) / 2, w, h });
        if (opts.notes) {
          try {
            const [pg] = await analysePdf(pdf, [idx[k]], ctx);
            const text = modelToPlainText(buildModel([pg], { tables: true, pageBreaks: false }).model, { pageMarks: false }).trim();
            if (text) slide.addNotes(text);
          } catch (err) { console.warn(err); }
        }
        page.cleanup();
        await ctx.tick();
      }
      ctx.progress((f + 0.98) / inputs.length, { de: 'PowerPoint-Datei wird geschrieben …', en: 'Writing the PowerPoint file …' });
      let out;
      try { out = await writePptx(pptx, await loadJSZip(), jpgs, PPTX); } catch (err) { throw userError(err, 'The presentation could not be created.'); }
      outputs.push({
        name: ctx.fileName(input.name, '', 'pptx'), blob: new Blob([out], { type: PPTX }),
        note: ctx.t({ de: `${idx.length} ${idx.length === 1 ? 'Folie' : 'Folien'}`, en: `${idx.length} ${idx.length === 1 ? 'slide' : 'slides'}` }),
        meta: f === 0 ? { thumbs, total: idx.length } : null,
      });
    }
    ctx.note({ de: 'Jede Folie zeigt die Seite als Bild – sie sieht genau aus wie in der PDF. Text und Grafiken lassen sich auf der Folie nicht einzeln bearbeiten.', en: 'Each slide shows the page as a picture – it looks exactly like the PDF. Text and graphics on the slide can’t be edited individually.' });
    return { outputs };
  },

  onResult(result, res, ctx) {
    const m = res.outputs[0]?.meta;
    if (m?.thumbs?.length) thumbStrip(result, m.thumbs, ctx, { title: { de: 'Deine Folien', en: 'Your slides' }, total: m.total, label: i => ctx.t({ de: `Folie ${i + 1}`, en: `Slide ${i + 1}` }) });
  },
};
