// Tool: merge PDFs and images into one PDF (reference implementation of the tool module contract).
import { loadPdfLib, saveDoc } from '../lib/pdf.js';
import { embedImage, drawFitted, pageSizeFor, mm } from '../lib/imgembed.js';
import { baseName } from '../lib/format.js';
import { OcgCarrier } from '../lib/aud1-ocg.js';

export default {
  options: [
    {
      id: 'pages', type: 'pages', perFile: true, kinds: ['pdf'], default: '',
      label: { de: 'Seiten (leer = alle)', en: 'Pages (empty = all)' },
      placeholder: { de: 'z. B. 1-3, 5', en: 'e.g. 1-3, 5' },
    },
    {
      id: 'bookmarks', type: 'select', default: 'both',
      label: { de: 'Lesezeichen', en: 'Bookmarks' },
      hint: { de: 'Vorhandene Lesezeichen der Dateien gehen nicht verloren – sie landen an der richtigen Stelle.', en: 'Existing bookmarks of the files are not lost – they end up in the right place.' },
      choices: [
        { value: 'both', label: { de: 'Dateinamen, darunter die vorhandenen', en: 'File names, existing ones below' } },
        { value: 'keep', label: { de: 'Nur die vorhandenen behalten', en: 'Keep only the existing ones' } },
        { value: 'files', label: { de: 'Nur ein Lesezeichen pro Datei', en: 'Only one bookmark per file' } },
        { value: 'none', label: { de: 'Keine Lesezeichen', en: 'No bookmarks' } },
      ],
    },
    {
      id: 'imagePage', type: 'radio', default: 'a4',
      label: { de: 'Fotos und Bilder', en: 'Photos and images' },
      when: (values, inputs) => inputs.some(i => i.kind === 'image'),
      choices: [
        { value: 'a4', label: { de: 'Auf A4-Seite', en: 'On an A4 page' }, hint: { de: 'Passt zu den meisten PDFs', en: 'Matches most PDFs' } },
        { value: 'fit', label: { de: 'Bildgröße', en: 'Image size' }, hint: { de: 'Seite so groß wie das Bild', en: 'Page as large as the image' } },
      ],
    },
  ],

  async run(inputs, opts, ctx) {
    const PDFLib = await loadPdfLib();
    const out = await PDFLib.PDFDocument.create();
    const marks = [];
    let encrypted = false;
    let keptMarks = 0;
    const mode = opts.bookmarks === true ? 'both' : opts.bookmarks === false ? 'none' : (opts.bookmarks || 'both');
    const fields = new FieldMerger(out, PDFLib);
    const layers = new OcgCarrier(PDFLib, out); // hidden layers stay hidden
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      ctx.progress(i / inputs.length, { de: `Datei ${i + 1} von ${inputs.length}: ${input.name}`, en: `File ${i + 1} of ${inputs.length}: ${input.name}` });
      const start = out.getPageCount();
      const fileMarks = [];
      if (input.kind === 'pdf') {
        const src = await input.pdfDoc();
        encrypted = encrypted || src.wtEncrypted;
        const indices = ctx.parsePages(input.opts.pages, src.getPageCount());
        if (mode === 'both' || mode === 'keep') fileMarks.push(...await existingMarks(input, indices, start));
        // copyPages caches copied objects, so a page that appears twice ("1, 1") needs its own pass
        let chunk = [];
        const flush = async () => {
          if (!chunk.length) return;
          const copied = await out.copyPages(src, chunk);
          copied.forEach((p, k) => { out.addPage(p); fields.collect(p); layers.collect(src, src.getPage(chunk[k]), p); });
          chunk = [];
        };
        for (const idx of indices) {
          if (chunk.includes(idx)) await flush();
          chunk.push(idx);
        }
        await flush();
        fields.adoptFormDefaults(src);
      } else {
        const e = await embedImage(out, input);
        const margin = opts.imagePage === 'fit' ? 0 : mm(10);
        const size = pageSizeFor(e, opts.imagePage === 'fit' ? 'fit' : 'a4', 'auto', margin);
        const page = out.addPage(size);
        drawFitted(page, e, PDFLib, { x: margin, y: margin, width: size[0] - 2 * margin, height: size[1] - 2 * margin });
      }
      const withFile = mode === 'files' || (mode === 'both' && inputs.length > 1);
      if (withFile) marks.push({ title: baseName(input.name), page: start + 1, top: null, level: 0 });
      marks.push(...fileMarks.map(m => ({ ...m, level: m.level + (withFile ? 1 : 0) })));
      keptMarks += fileMarks.length;
      await ctx.tick();
    }
    fields.finish();
    layers.finish();
    if (marks.length && mode !== 'none' && !(mode === 'files' && inputs.length < 2)) {
      const { writeOutline } = await import('../lib/shared/outlinecore.js');
      // valid nesting: the first entry on level 0, never more than one level deeper than the one before
      marks.forEach((m, i) => { m.level = Math.max(0, Math.min(m.level, i ? marks[i - 1].level + 1 : 0)); });
      writeOutline(PDFLib, out, marks);
      if (keptMarks) ctx.note({ de: 'Die Lesezeichen der einzelnen Dateien wurden übernommen.', en: 'The bookmarks of the individual files were kept.' });
    }
    ctx.progress(1, { de: 'Wird gespeichert …', en: 'Saving …' });
    await ctx.tick();
    const first = baseName(inputs[0].name);
    const bytes = await saveDoc(out, { title: first });
    if (encrypted) ctx.note({ de: 'Die zusammengefügte PDF ist nicht mit einem Passwort geschützt.', en: 'The merged PDF is not password protected.' });
    const more = inputs.length - 1;
    const name = more > 0
      ? (ctx.lang === 'de' ? `${first} + ${more} weitere.pdf` : `${first} + ${more} more.pdf`)
      : (ctx.lang === 'de' ? `${first} (Auswahl).pdf` : `${first} (selection).pdf`);
    return { outputs: [{ name, blob: new Blob([bytes], { type: 'application/pdf' }), pages: out.getPageCount() }] };
  },
};

/** Bookmarks of one input, re-targeted to the pages it got in the merged file (pages left out drop theirs). */
async function existingMarks(input, indices, start) {
  let flat = [];
  try {
    const pdf = await input.pdfjs();
    const { readOutline } = await import('../lib/shared/outlinecore.js');
    flat = await readOutline(pdf);
  } catch { return []; }
  const where = new Map();
  indices.forEach((idx, k) => { if (!where.has(idx)) where.set(idx, start + k + 1); });
  const out = [];
  for (const m of flat) {
    const page = where.get(m.page - 1);
    if (!page) continue;
    out.push({ title: m.title, page, top: m.top, level: m.level });
  }
  // a dropped parent must not leave its children hanging two levels deep
  out.forEach((m, i) => { m.level = Math.max(0, Math.min(m.level, i ? out[i - 1].level + 1 : 0)); });
  return out;
}

/**
 * Keeps form fields working after copyPages: copied widgets are registered in the new document's
 * AcroForm, and fields that would clash by name with an earlier file are renamed ("Name (2)").
 */
class FieldMerger {
  constructor(doc, PDFLib) {
    this.doc = doc;
    this.L = PDFLib;
    this.fields = [];
    this.seenRefs = new Set();
    this.names = new Map();
    this.defaults = null;
  }

  collect(page) {
    const { PDFName, PDFDict, PDFArray, PDFRef, PDFString, PDFHexString } = this.L;
    const ctx = this.doc.context;
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) return;
    for (let i = 0; i < annots.size(); i++) {
      let ref = annots.get(i);
      let dict = ref instanceof PDFRef ? ctx.lookup(ref) : ref;
      if (!(dict instanceof PDFDict) || dict.get(PDFName.of('Subtype'))?.toString() !== '/Widget') continue;
      // walk up to the top-level field
      for (let guard = 0; guard < 32; guard++) {
        const parent = dict.get(PDFName.of('Parent'));
        if (!(parent instanceof PDFRef)) break;
        ref = parent;
        dict = ctx.lookup(parent);
      }
      if (!(ref instanceof PDFRef) || this.seenRefs.has(ref)) continue;
      this.seenRefs.add(ref);
      const t = dict.lookup(PDFName.of('T'));
      if (t instanceof PDFString || t instanceof PDFHexString) {
        const name = t.decodeText();
        const n = (this.names.get(name) || 0) + 1;
        this.names.set(name, n);
        if (n > 1) dict.set(PDFName.of('T'), PDFHexString.fromText(`${name} (${n})`));
      }
      this.fields.push(ref);
    }
  }

  adoptFormDefaults(src) {
    if (this.defaults) return;
    const { PDFName, PDFDict } = this.L;
    const form = src.catalog.lookup(PDFName.of('AcroForm'));
    if (!(form instanceof PDFDict)) return;
    const copier = this.L.PDFObjectCopier.for(src.context, this.doc.context);
    this.defaults = {};
    for (const k of ['DR', 'DA', 'Q']) {
      const v = form.get(PDFName.of(k));
      if (v) this.defaults[k] = copier.copy(v);
    }
  }

  finish() {
    if (!this.fields.length) return;
    const { PDFName } = this.L;
    const ctx = this.doc.context;
    const form = ctx.obj({});
    form.set(PDFName.of('Fields'), ctx.obj(this.fields));
    for (const [k, v] of Object.entries(this.defaults || {})) form.set(PDFName.of(k), v);
    this.doc.catalog.set(PDFName.of('AcroForm'), ctx.register(form));
  }
}
