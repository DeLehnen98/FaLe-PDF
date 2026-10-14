// Tool: repair a damaged PDF, step by step:
//   1. structure rebuild (lossless): every object is read again from the bytes (pdf-lib reads objects in
//      file order and doesn't need the cross-reference table), catalog and page tree are re-found or
//      rebuilt – with the page order pdf.js reconstructed where possible – and the file is saved with a
//      fresh cross-reference table and trailer
//   2. every page of that result is rendered as a check; a page that still fails is taken over as an
//      image from the damaged original if the PDF reader can still draw it
//   3. last resort: all pages the reader can draw become images (text is then not selectable)
// The result says honestly which way worked and what may be missing.
import { loadPdfLib, openPdfjs, renderPage, canvasToBlob, saveDoc } from '../lib/pdf.js';
import { formatPages } from '../lib/ranges.js';
import { removeUnreachable } from '../lib/pdfopt.js';
import { pdfBlob, userError } from '../lib/org-common.js';

const T = (de, en) => ({ de, en });

/** pdf.js view of the damaged file: page count and page object numbers (it rebuilds broken xrefs). */
async function readWithPdfjs(input, bytes) {
  try {
    const own = !input.password;
    const pdf = own ? await openPdfjs(bytes) : await input.pdfjs();
    const refs = [];
    for (let i = 0; i < pdf.numPages; i++) {
      try { const p = await pdf.getPage(i + 1); refs.push(p.ref ? p.ref.num : null); } catch { refs.push(null); }
    }
    return { pdf, refs, own };
  } catch (err) { console.warn('pdf.js could not open the file', err); return null; }
}

async function loadTolerant(PDFLib, input, bytes) {
  try { return await input.pdfDoc(); } catch (err) { console.warn('regular load failed', err); }
  const opts = { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false };
  try { return await PDFLib.PDFDocument.load(bytes, opts); } catch (err) { console.warn('tolerant load failed', err); }
  // cut off a damaged tail (interrupted download): keep everything up to the last complete object
  const end = lastIndexOf(bytes, 'endobj');
  if (end > 0) {
    const cut = new Uint8Array(end + 7);
    cut.set(bytes.subarray(0, end + 6));
    cut[end + 6] = 10;
    try { const doc = await PDFLib.PDFDocument.load(cut, opts); doc.wtCut = true; return doc; } catch (err) { console.warn('load of the cut file failed', err); }
  }
  return null;
}

function lastIndexOf(bytes, text) {
  const pat = Array.from(text, ch => ch.charCodeAt(0));
  for (let i = bytes.length - pat.length; i >= 0; i--) {
    let ok = true;
    for (let k = 0; k < pat.length; k++) if (bytes[i + k] !== pat[k]) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}

/** Find / rebuild catalog and page tree. Returns {doc, found, missing, how[]} or null. */
function rebuild(doc, PDFLib, js) {
  const { PDFName, PDFDict, PDFRef, PDFArray, PDFNumber, PDFCatalog, PDFPageTree, PDFPageLeaf, PDFStream } = PDFLib;
  const ctx = doc.context;
  const how = [];
  const isPage = o => o instanceof PDFDict && o.get(PDFName.of('Type'))?.toString() === '/Page';
  // 1) catalog
  let catalog = ctx.trailerInfo.Root ? ctx.lookup(ctx.trailerInfo.Root) : null;
  if (!(catalog instanceof PDFDict)) {
    for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
      if (obj instanceof PDFDict && obj.get(PDFName.of('Type'))?.toString() === '/Catalog') { ctx.trailerInfo.Root = ref; catalog = obj; how.push('catalog'); break; }
    }
  }
  let declared = null;
  try { declared = catalog?.lookup(PDFName.of('Pages'))?.lookup(PDFName.of('Count'))?.asNumber?.() ?? null; } catch { declared = null; }
  // 2) candidate page lists
  const fromTree = [];
  let treeOk = false;
  try {
    const pagesRef = catalog?.get(PDFName.of('Pages'));
    const visit = (ref, depth) => {
      if (depth > 64) throw new Error('deep');
      const node = ctx.lookup(ref);
      if (isPage(node)) { fromTree.push(ref); return; }
      if (!(node instanceof PDFDict)) throw new Error('bad node');
      const kids = node.lookup(PDFName.of('Kids'));
      if (!(kids instanceof PDFArray)) throw new Error('no kids');
      for (let i = 0; i < kids.size(); i++) visit(kids.get(i), depth + 1);
    };
    if (pagesRef instanceof PDFRef) { visit(pagesRef, 0); treeOk = fromTree.length > 0; }
  } catch { treeOk = false; }
  const all = [];
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) if (isPage(obj)) all.push(ref);
  all.sort((a, b) => a.objectNumber - b.objectNumber);
  let fromJs = null;
  if (js && js.refs.length) {
    const byNum = new Map(all.map(r => [r.objectNumber, r]));
    fromJs = js.refs.map(n => (n != null ? byNum.get(n) : null)).filter(Boolean);
  }
  let pages;
  if (treeOk && (!fromJs || fromTree.length >= fromJs.length)) pages = fromTree;
  else if (fromJs && fromJs.length) { pages = fromJs; how.push('tree'); }
  else if (all.length) { pages = all; how.push('tree-scan'); }
  else return null;
  // 3) fresh catalog + flat page tree
  if (!(catalog instanceof PDFDict)) {
    const pt = PDFPageTree.withContext(ctx);
    const ptRef = ctx.register(pt);
    catalog = PDFCatalog.withContextAndPages(ctx, ptRef);
    ctx.trailerInfo.Root = ctx.register(catalog);
    how.push('catalog-new');
  }
  if (!(catalog instanceof PDFCatalog)) {
    const c = PDFCatalog.fromMapWithContext(new Map(catalog.entries()), ctx);
    ctx.assign(ctx.trailerInfo.Root, c);
    catalog = c;
  }
  const tree = PDFPageTree.withContext(ctx);
  const treeRef = ctx.register(tree);
  tree.set(PDFName.of('Kids'), ctx.obj(pages));
  tree.set(PDFName.of('Count'), PDFNumber.of(pages.length));
  // inherited attributes from the old tree
  const inherit = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];
  let damaged = 0;
  for (const ref of pages) {
    let leaf = ctx.lookup(ref);
    if (!(leaf instanceof PDFPageLeaf)) { leaf = PDFPageLeaf.fromMapWithContext(new Map(leaf.entries()), ctx); ctx.assign(ref, leaf); }
    for (const k of inherit) {
      if (leaf.has(PDFName.of(k))) continue;
      let v = null;
      try { v = leaf.getInheritableAttribute(PDFName.of(k)); } catch { v = null; }
      if (v) leaf.set(PDFName.of(k), v);
    }
    if (!(leaf.lookup(PDFName.of('MediaBox')) instanceof PDFArray)) { leaf.set(PDFName.of('MediaBox'), ctx.obj([0, 0, 595.28, 841.89])); damaged++; }
    // contents that point to missing objects are dropped (the page renders what is left)
    const c = leaf.get(PDFName.of('Contents'));
    const ok = r => { const o = r instanceof PDFRef ? ctx.lookup(r) : r; return o instanceof PDFStream; };
    if (c instanceof PDFRef && !ok(c)) { leaf.delete(PDFName.of('Contents')); damaged++; }
    else if (c instanceof PDFArray) {
      const good = [];
      for (let i = 0; i < c.size(); i++) if (ok(c.get(i))) good.push(c.get(i)); else damaged++;
      leaf.set(PDFName.of('Contents'), ctx.obj(good));
    }
    leaf.set(PDFName.of('Parent'), treeRef);
  }
  catalog.set(PDFName.of('Pages'), treeRef);
  doc.catalog = catalog;
  doc.pageMap = new Map();
  doc.pageCount = undefined;
  doc.pageCache.invalidate();
  // drop references to objects that do not exist (they would make readers fail)
  removeUnreachable(doc, PDFLib);
  return { doc, found: pages.length, damaged, how, declared };
}

async function renderable(bytes, n, ctx) {
  const bad = [];
  let pdf;
  try { pdf = await openPdfjs(bytes); } catch { return null; }
  try {
    if (pdf.numPages !== n) return null;
    for (let i = 0; i < n; i++) {
      try {
        const p = await pdf.getPage(i + 1);
        const c = await renderPage(p, { width: 120 });
        c.width = c.height = 0;
      } catch { bad.push(i); }
      if (i % 5 === 4) await ctx.tick();
    }
  } finally { pdf.destroy(); }
  return bad;
}

/** Draw page `i` of the damaged file (pdf.js) as a JPEG page. Returns false when it can't be drawn. */
async function imagePage(PDFLib, out, js, i, at = null) {
  try {
    const p = await js.pdf.getPage(i + 1);
    const vp = p.getViewport({ scale: 1 });
    const canvas = await renderPage(p, { scale: 150 / 72 });
    const jpg = new Uint8Array(await (await canvasToBlob(canvas, 'image/jpeg', 0.85)).arrayBuffer());
    canvas.width = canvas.height = 0;
    const img = await out.embedJpg(jpg);
    const page = at != null ? out.insertPage(at, [vp.width, vp.height]) : out.addPage([vp.width, vp.height]);
    page.drawImage(img, { x: 0, y: 0, width: vp.width, height: vp.height });
    return true;
  } catch (err) { console.warn('page', i + 1, err); return false; }
}

export default {
  options: [],
  acceptBroken: true,

  async run(inputs, opts, ctx) {
    const PDFLib = await loadPdfLib();
    const outputs = [];
    const de = ctx.lang === 'de';
    for (const input of inputs) {
      const bytes = await input.bytes();
      ctx.progress(0.05, T(`${input.name} wird untersucht …`, `Examining ${input.name} …`));
      const js = await readWithPdfjs(input, bytes);
      const expected = js ? js.pdf.numPages : null;
      const lines = [];
      let result = null;

      // ---- 1. structure rebuild
      ctx.progress(0.2, T('Struktur wird neu aufgebaut …', 'Rebuilding the structure …'));
      const doc = await loadTolerant(PDFLib, input, bytes);
      let rb = null;
      if (doc) { try { rb = rebuild(doc, PDFLib, js); } catch (err) { console.warn('rebuild failed', err); rb = null; } }
      if (rb && rb.found) {
        let saved = null;
        try { saved = await saveDoc(rb.doc); } catch (err) { console.warn('save failed', err); }
        if (saved) {
          ctx.progress(0.5, T('Ergebnis wird geprüft …', 'Checking the result …'));
          const bad = await renderable(saved, rb.found, ctx);
          const clean = !rb.damaged && !doc.wtCut && !(expected && rb.found < expected) && !(rb.declared && rb.found < rb.declared);
          if (bad && !bad.length) {
            result = saved;
            lines.push(clean
              ? (de ? 'Methode: Dateistruktur neu aufgebaut (verlustfrei) – Text, Bilder und Links bleiben, wie sie waren.' : 'Method: file structure rebuilt (lossless) – text, images and links stay as they were.')
              : (de ? 'Methode: Dateistruktur neu aufgebaut – was erhalten war, bleibt echte PDF mit Text, Bildern und Links.' : 'Method: file structure rebuilt – whatever survived stays a real PDF with text, images and links.'));
          } else if (bad && js) {
            // replace the failing pages with images of the original
            const fixed = await PDFLib.PDFDocument.load(saved, { updateMetadata: false });
            const lost = [];
            for (const i of bad.slice().reverse()) {
              fixed.removePage(i);
              if (!(await imagePage(PDFLib, fixed, js, i, i))) lost.push(i);
            }
            removeUnreachable(fixed, PDFLib);
            result = await saveDoc(fixed);
            lines.push(de ? `Methode: Dateistruktur neu aufgebaut; ${bad.length === 1 ? 'Seite' : 'Seiten'} ${formatPages(bad)} als Bild übernommen (dort ist Text nicht markierbar).` : `Method: file structure rebuilt; ${bad.length === 1 ? 'page' : 'pages'} ${formatPages(bad)} taken over as images (text there is not selectable).`);
            if (lost.length) lines.push(de ? `Seite ${formatPages(lost)} ließ sich gar nicht mehr darstellen und ist leer.` : `Page ${formatPages(lost)} could not be drawn at all and is blank.`);
          }
          if (result && rb.damaged) lines.push(de ? 'Einige Inhalte waren beschädigt oder fehlten und konnten nicht gerettet werden.' : 'Some content was damaged or missing and could not be recovered.');
          if (result && doc.wtCut) lines.push(de ? 'Das Ende der Datei fehlte (zum Beispiel nach einem abgebrochenen Download) – was dort stand, ist verloren.' : 'The end of the file was missing (for example after an interrupted download) – whatever was there is lost.');
          if (result && !expected && rb.declared && rb.found < rb.declared) lines.push(de ? `${rb.found} von ${rb.declared} Seiten gerettet.` : `${rb.found} of ${rb.declared} pages recovered.`);
          if (result && expected && rb.found < expected) lines.push(de ? `${rb.found} von ${expected} Seiten gerettet – der Rest fehlt in der Datei.` : `${rb.found} of ${expected} pages recovered – the rest is missing from the file.`);
          if (result) { const pages = (await PDFLib.PDFDocument.load(result, { updateMetadata: false })).getPageCount(); outputs.push(out(input, result, pages)); }
        }
      }

      // ---- 3. last resort: pages as images
      if (!result) {
        if (!js || !js.pdf.numPages) throw userError(`„${input.name}“ ist zu stark beschädigt – es ließ sich keine Seite mehr finden.`, `“${input.name}” is too badly damaged – no page could be found.`);
        const outDoc = await PDFLib.PDFDocument.create();
        const lost = [];
        for (let i = 0; i < js.pdf.numPages; i++) {
          ctx.progress(0.5 + 0.45 * i / js.pdf.numPages, T(`Seite ${i + 1} wird als Bild gerettet …`, `Saving page ${i + 1} as an image …`));
          if (!(await imagePage(PDFLib, outDoc, js, i))) lost.push(i);
          await ctx.tick();
        }
        if (lost.length === js.pdf.numPages) throw userError(`„${input.name}“ ist zu stark beschädigt – keine Seite ließ sich darstellen.`, `“${input.name}” is too badly damaged – no page could be drawn.`);
        result = await saveDoc(outDoc);
        lines.push(de ? 'Methode: Seiten als Bilder neu erstellt (Notlösung) – Aussehen gerettet, Text ist nicht mehr markierbar oder durchsuchbar, Links und Formularfelder fehlen.' : 'Method: pages recreated as images (last resort) – the look is saved, but text can no longer be selected or searched, links and form fields are gone.');
        if (lost.length) lines.push(de ? `Seite ${formatPages(lost)} ließ sich nicht darstellen und fehlt.` : `Page ${formatPages(lost)} could not be drawn and is missing.`);
        outputs.push(out(input, result, js.pdf.numPages - lost.length));
      }
      outputs[outputs.length - 1].note = lines.join(' ');
      if (js?.own) js.pdf.destroy?.();
    }
    return { outputs };

    function out(input, bytes, pages) {
      return { name: ctx.fileName(input.name, de ? ' (repariert)' : ' (repaired)', 'pdf'), blob: pdfBlob(bytes), pages };
    }
  },
};
