// Tool: extract the embedded raster images of PDFs.
//   - JPEG images (DCT streams in RGB/grey, without soft mask) are copied byte for byte → original quality
//   - everything else (Flate/PNG-like, JPEG 2000, JBIG2, CCITT, CMYK, images with transparency …) is
//     decoded by pdf.js – with its soft mask applied – and saved as lossless PNG
//   - images are found in the page content streams (also inside nested form XObjects), in drawing order
//   - min-size filter (skips icons, bullets, lines), duplicates removed (same object or identical data)
import { loadPdfLib, loadPdfjs } from '../lib/pdf.js';
import { scanContent } from '../lib/pdfimages.js';
import { jpegInfo } from '../lib/files.js';
import { PAGES_OPTION, coarsePointer, imageGridPreview, fail } from '../lib/conv-common.js';

export default {
  options: [
    { ...PAGES_OPTION, when: (v, inputs) => inputs.length <= 1 },
    {
      id: 'minSize', type: 'range', min: 0, max: 400, step: 10, default: 50, unit: 'px',
      label: { de: 'Kleine Bilder überspringen', en: 'Skip small images' },
      hint: { de: 'Bilder, deren kürzere Seite kleiner ist, werden ausgelassen – so landen keine Symbole, Aufzählungspunkte oder Linien im Ergebnis. 0 = alle Bilder.', en: 'Images whose shorter side is smaller are left out – no icons, bullets or lines in the result. 0 = all images.' },
      format: (v, lang) => (v ? `${v} px` : (lang === 'de' ? 'alle' : 'all')),
    },
    {
      id: 'dedupe', type: 'toggle', default: true,
      label: { de: 'Doppelte Bilder nur einmal', en: 'Each image only once' },
      hint: { de: 'Logos oder Hintergründe, die auf vielen Seiten wiederkehren, bekommst du nur einmal.', en: 'Logos or backgrounds that repeat on many pages are saved only once.' },
    },
  ],
  get shareFirst() { return coarsePointer(); },

  async run(inputs, opts, ctx) {
    const PDFLib = await loadPdfLib();
    const minSize = Math.max(0, Number(opts.minSize) || 0);
    const outputs = [];
    const seenHash = new Set();
    let small = 0, dupes = 0, failed = 0, decoded = 0;
    for (let f = 0; f < inputs.length; f++) {
      const input = inputs[f];
      const label = inputs.length > 1 ? { de: `Datei ${f + 1} von ${inputs.length}: `, en: `File ${f + 1} of ${inputs.length}: ` } : { de: '', en: '' };
      const part = (frac, text) => ctx.progress((f + Math.min(1, frac)) / inputs.length, { de: label.de + text.de, en: label.en + text.en });
      part(0, { de: 'Bilder werden gesucht …', en: 'Looking for images …' });
      const doc = await input.pdfDoc();
      const pageCount = doc.getPageCount();
      const pages = inputs.length === 1 ? ctx.parsePages(opts.pages, pageCount) : Array.from({ length: pageCount }, (_, i) => i);
      const found = await findImages(doc, PDFLib, pages, ctx);     // [{ ref, key, stream, page, w, h }]
      const pdf = await input.pdfjs();
      const opCache = new Map();                                    // page → pdf.js images in drawing order
      let n = 0;
      for (let k = 0; k < found.length; k++) {
        const im = found[k];
        part(0.1 + 0.9 * (k / Math.max(1, found.length)), { de: `Bild ${k + 1} von ${found.length}`, en: `Image ${k + 1} of ${found.length}` });
        if (Math.min(im.w, im.h) < minSize) { small++; continue; }
        let blob = null;
        let ext = 'png';
        const jpeg = await passthroughJpeg(im.stream, PDFLib);
        if (jpeg) {
          blob = new Blob([jpeg], { type: 'image/jpeg' });
          ext = 'jpg';
        } else {
          try { blob = await decodeWithPdfjs(pdf, im, opCache); } catch (err) { console.warn(err); blob = null; }
          if (!blob) { failed++; continue; }
          decoded++;
        }
        if (opts.dedupe) {
          const h = await digest(blob);
          if (seenHash.has(h)) { dupes++; continue; }
          seenHash.add(h);
        }
        n++;
        const word = ctx.lang === 'de' ? ['bild', 'seite'] : ['image', 'page'];
        outputs.push({
          name: ctx.fileName(input.name, `-${word[0]}-${String(n).padStart(2, '0')}-${word[1]}-${im.page + 1}`, ext),
          blob,
          meta: { label: `${im.w} × ${im.h}` },
          note: ctx.t({ de: `Seite ${im.page + 1} · ${im.w} × ${im.h} px${ext === 'jpg' ? ' · Original-JPG' : ''}`, en: `Page ${im.page + 1} · ${im.w} × ${im.h} px${ext === 'jpg' ? ' · original JPG' : ''}` }),
        });
        await ctx.tick();
      }
      for (const page of opCache.keys()) { try { (await pdf.getPage(page + 1)).cleanup(); } catch { /* ignore */ } }
    }
    if (!outputs.length) {
      if (small) fail(
        `Es wurden nur kleine Bilder gefunden (${small}). Stell „Kleine Bilder überspringen“ niedriger ein, um sie trotzdem zu bekommen.`,
        `Only small images were found (${small}). Lower “Skip small images” to get them anyway.`);
      fail('In dieser PDF sind keine eingebetteten Bilder. Möchtest du die Seiten selbst als Bild? Dann nimm „PDF in JPG“.',
        'This PDF has no embedded images. Want the pages themselves as images? Use “PDF to JPG”.');
    }
    if (small) ctx.note({ de: `${small} kleine ${small === 1 ? 'Bild' : 'Bilder'} übersprungen (Symbole, Linien …).`, en: `${small} small ${small === 1 ? 'image' : 'images'} skipped (icons, lines …).` });
    if (dupes) ctx.note({ de: `${dupes} doppelte ${dupes === 1 ? 'Bild' : 'Bilder'} nur einmal gespeichert.`, en: `${dupes} duplicate ${dupes === 1 ? 'image' : 'images'} saved only once.` });
    if (decoded) ctx.note({ de: 'JPG-Bilder sind unverändert aus der PDF kopiert. Andere Bildarten werden verlustfrei als PNG gespeichert.', en: 'JPG images are copied from the PDF unchanged. Other image types are saved losslessly as PNG.' });
    if (failed) ctx.note({ de: `${failed} ${failed === 1 ? 'Bild konnte' : 'Bilder konnten'} nicht gelesen werden.`, en: `${failed} ${failed === 1 ? 'image' : 'images'} could not be read.` });
    return { outputs };
  },

  onResult(result, res, ctx) { imageGridPreview(result, res, ctx); },
};

// ---------------------------------------------------------------- pdf-lib: images in drawing order
async function findImages(doc, PDFLib, pageIdx, ctx) {
  const { PDFDict, PDFArray, PDFName, PDFRef, PDFStream, PDFRawStream, PDFNumber } = PDFLib;
  const XO = PDFName.of('XObject'), SUB = PDFName.of('Subtype'), RES = PDFName.of('Resources');
  const out = [];
  const seenRef = new Set();
  const bytesOf = s => (s instanceof PDFRawStream ? PDFLib.decodePDFRawStream(s).decode() : s.getContents());
  const num = v => (v instanceof PDFNumber ? v.asNumber() : 0);
  const resourcesOf = node => {
    for (let n = node, g = 0; n && g < 64; g++) {
      const r = n.lookup(RES);
      if (r instanceof PDFDict) return r;
      n = n.lookup(PDFName.of('Parent'));
      if (!(n instanceof PDFDict)) break;
    }
    return null;
  };
  let budget = 5e6;
  const walk = (bytes, resources, page, depth, path) => {
    scanContent(bytes, (op, args) => {
      if (--budget < 0) throw new Error('budget');
      if (op !== 'Do' || !resources || !args.length || !args[args.length - 1]?.name) return;
      const xobjs = resources.lookup(XO);
      if (!(xobjs instanceof PDFDict)) return;
      const ref = xobjs.get(PDFName.of(args[args.length - 1].name));
      const xo = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
      if (!(xo instanceof PDFStream)) return;
      const sub = xo.dict.get(SUB)?.toString();
      if (sub === '/Image') {
        const key = ref instanceof PDFRef ? ref.toString() : `inline-${out.length}`;
        if (seenRef.has(key)) return;
        seenRef.add(key);
        if (xo.dict.lookup(PDFName.of('ImageMask'))?.toString() === 'true') return; // stencil mask = a shape, not a picture
        const w = num(xo.dict.lookup(PDFName.of('Width'))), h = num(xo.dict.lookup(PDFName.of('Height')));
        if (w > 0 && h > 0) out.push({ key, stream: xo, page, w, h });
      } else if (sub === '/Form' && depth < 12 && !(ref instanceof PDFRef && path.has(ref.toString()))) {
        const res = xo.dict.lookup(RES);
        let b2;
        try { b2 = bytesOf(xo); } catch { return; }
        const p2 = new Set(path);
        if (ref instanceof PDFRef) p2.add(ref.toString());
        walk(b2, res instanceof PDFDict ? res : resources, page, depth + 1, p2);
      }
    });
  };
  const pages = doc.getPages();
  for (let k = 0; k < pageIdx.length; k++) {
    const p = pageIdx[k];
    const node = pages[p].node;
    const contents = node.lookup(PDFName.of('Contents'));
    const parts = contents instanceof PDFArray ? contents.asArray().map(r => doc.context.lookup(r)) : [contents];
    const chunks = [];
    for (const s of parts) {
      if (!(s instanceof PDFStream)) continue;
      try { chunks.push(bytesOf(s), new Uint8Array([10])); } catch { /* undecodable */ }
    }
    const all = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    try { walk(all, resourcesOf(node), p, 0, new Set()); } catch (err) { if (err.message === 'budget') break; console.warn(err); }
    if (k % 8 === 7) { ctx.progress(null, { de: `Seite ${k + 1} von ${pageIdx.length} durchsucht`, en: `Searched page ${k + 1} of ${pageIdx.length}` }); await ctx.tick(); }
  }
  return out;
}

/**
 * The JPEG bytes when the image can be saved as is: DCT (possibly wrapped in ASCII85/ASCIIHex/Flate),
 * RGB or grey, no masks, no Decode array. Otherwise null (→ decoded by pdf.js).
 */
async function passthroughJpeg(stream, PDFLib) {
  const { PDFName, PDFArray, PDFRawStream } = PDFLib;
  if (!(stream instanceof PDFRawStream)) return null;
  const d = stream.dict;
  const f = d.lookup(PDFName.of('Filter'));
  const filters = f instanceof PDFArray ? f.asArray().map(x => x.toString()) : f ? [f.toString()] : [];
  if (filters[filters.length - 1] !== '/DCTDecode') return null;
  const pre = filters.slice(0, -1);
  if (!pre.every(x => x === '/ASCII85Decode' || x === '/A85' || x === '/ASCIIHexDecode' || x === '/AHx' || x === '/FlateDecode' || x === '/Fl')) return null;
  if (pre.length && d.has(PDFName.of('DecodeParms')) && pre.includes('/FlateDecode')) return null; // predictors on a JPEG: unusual
  for (const k of ['SMask', 'Mask', 'Decode', 'SMaskInData']) if (d.has(PDFName.of(k))) return null;
  let bytes = stream.getContents();
  try {
    for (const x of pre) bytes = x.startsWith('/ASCII85') || x === '/A85' ? ascii85(bytes) : x.startsWith('/ASCIIHex') || x === '/AHx' ? asciiHex(bytes) : await inflate(bytes);
  } catch { return null; }
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) return null;
  const info = jpegInfo(bytes.subarray(0, Math.min(bytes.length, 65536)));
  if (info.components !== 1 && info.components !== 3) return null; // CMYK JPEGs are often stored inverted → decode
  return bytes;
}

function ascii85(b) {
  const out = [];
  let tuple = 0, n = 0;
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c === 0x7e) break; // ~>
    if (c <= 32) continue;
    if (c === 0x7a && n === 0) { out.push(0, 0, 0, 0); continue; } // z
    if (c < 33 || c > 117) throw new Error('a85');
    tuple = tuple * 85 + (c - 33);
    if (++n === 5) { out.push((tuple >>> 24) & 255, (tuple >>> 16) & 255, (tuple >>> 8) & 255, tuple & 255); tuple = 0; n = 0; }
  }
  if (n) {
    for (let k = n; k < 5; k++) tuple = tuple * 85 + 84;
    const bytes = [(tuple >>> 24) & 255, (tuple >>> 16) & 255, (tuple >>> 8) & 255, tuple & 255];
    out.push(...bytes.slice(0, n - 1));
  }
  return new Uint8Array(out);
}

function asciiHex(b) {
  const hex = String.fromCharCode(...b.filter(c => c > 32)).replace(/>.*$/, '');
  const out = new Uint8Array(Math.ceil(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt((hex.substr(i * 2, 2) + '0').slice(0, 2), 16);
  return out;
}

async function inflate(bytes) {
  const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(ds).arrayBuffer());
}

// ---------------------------------------------------------------- pdf.js: decode with masks applied
async function pageImages(pdf, pageIndex, cache) {
  if (cache.has(pageIndex)) return cache.get(pageIndex);
  const lib = await loadPdfjs();
  const OPS = lib.OPS;
  const page = await pdf.getPage(pageIndex + 1);
  const list = await page.getOperatorList();
  const ids = [];
  for (let i = 0; i < list.fnArray.length; i++) {
    const fn = list.fnArray[i];
    if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat) {
      const id = list.argsArray[i][0];
      if (typeof id === 'string' && !ids.includes(id)) ids.push(id);
    }
  }
  const items = [];
  for (const id of ids) {
    const objs = id.startsWith('g_') ? page.commonObjs : page.objs;
    const obj = await new Promise(resolve => {
      try { objs.get(id, resolve); } catch { resolve(null); }
      setTimeout(() => resolve(null), 15000);
    });
    if (obj) items.push({ obj, used: false, w: obj.width, h: obj.height });
  }
  cache.set(pageIndex, items);
  return items;
}

async function decodeWithPdfjs(pdf, im, cache) {
  const items = await pageImages(pdf, im.page, cache);
  const hit = items.find(it => !it.used && it.w === im.w && it.h === im.h) || items.find(it => it.w === im.w && it.h === im.h);
  if (!hit) return null;
  hit.used = true;
  const { obj } = hit;
  const canvas = document.createElement('canvas');
  canvas.width = obj.width; canvas.height = obj.height;
  const c2 = canvas.getContext('2d');
  if (obj.bitmap) c2.drawImage(obj.bitmap, 0, 0);
  else if (obj.data) c2.putImageData(toImageData(obj), 0, 0);
  else return null;
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  canvas.width = canvas.height = 0;
  return blob;
}

function toImageData(obj) {
  const { width: w, height: h, data, kind } = obj;
  const out = new ImageData(w, h);
  const px = out.data;
  if (kind === 3) px.set(data.subarray(0, w * h * 4));
  else if (kind === 2) {
    for (let i = 0, j = 0; i < w * h; i++, j += 3) { px[i * 4] = data[j]; px[i * 4 + 1] = data[j + 1]; px[i * 4 + 2] = data[j + 2]; px[i * 4 + 3] = 255; }
  } else { // 1 bit grey, rows padded to bytes
    const rowBytes = (w + 7) >> 3;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
      const o = (y * w + x) * 4;
      px[o] = px[o + 1] = px[o + 2] = v; px[o + 3] = 255;
    }
  }
  return out;
}

async function digest(blob) {
  const buf = await blob.arrayBuffer();
  const h = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, '0')).join('');
}
