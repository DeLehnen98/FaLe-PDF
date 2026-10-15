// Lossless PDF optimisation on a pdf-lib document (nothing visible changes):
//   1. page thumbnails (/Thumb) are dropped – viewers render their own
//   2. streams stored without any compression are Flate-compressed
//   3. identical streams (fonts, images, ICC profiles embedded several times, e.g. after merging) are
//      stored once and every reference is pointed at the single copy
//   4. objects that nothing references any more (old xref/object streams, leftovers of edits) are removed
// Saving with object streams (lib/pdf.js saveDoc) then packs the remaining small objects.

import { stripAsciiFilters } from './aud1-asciistrip.js';

const yieldNow = () => new Promise(r => setTimeout(r, 0));

export async function optimizeLossless(doc, PDFLib, { tick = yieldNow, dropThumbs = true } = {}) {
  const stats = { thumbs: 0, deflated: 0, deduped: 0, removed: 0 };
  await doc.flush();
  if (dropThumbs) {
    const T = PDFLib.PDFName.of('Thumb');
    for (const page of doc.getPages()) if (page.node.has(T)) { page.node.delete(T); stats.thumbs++; }
  }
  stats.ascii = await stripAsciiFilters(doc, PDFLib, tick);
  stats.deflated = await deflateUnfiltered(doc, PDFLib, tick);
  stats.deduped = await dedupeStreams(doc, PDFLib, tick);
  stats.removed = removeUnreachable(doc, PDFLib);
  return stats;
}

async function deflate(bytes) {
  if (typeof CompressionStream === 'function') {
    const cs = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(cs).arrayBuffer());
  }
  return null;
}

async function deflateUnfiltered(doc, PDFLib, tick) {
  const { PDFRawStream, PDFName } = PDFLib;
  const ctx = doc.context;
  const F = PDFName.of('Filter'), DP = PDFName.of('DecodeParms'), TYPE = PDFName.of('Type');
  let n = 0, k = 0;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || obj.dict.has(F) || obj.dict.has(DP)) continue;
    const type = obj.dict.get(TYPE)?.toString() || '';
    if (type === '/XRef' || type === '/ObjStm' || type === '/Metadata') continue; // XMP should stay readable
    const raw = obj.getContents();
    if (raw.length < 256) continue;
    const packed = (await deflate(raw)) || ctx.flateStream(raw).getContents();
    if (packed.length >= raw.length * 0.95) continue;
    const dict = obj.dict.clone(ctx);
    dict.set(F, PDFName.of('FlateDecode'));
    ctx.assign(ref, PDFRawStream.of(dict, packed));
    n++;
    if (++k % 50 === 0) await tick();
  }
  return n;
}

async function digest(bytes) {
  const h = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, '0')).join('');
}

async function dedupeStreams(doc, PDFLib, tick) {
  const { PDFRawStream, PDFName } = PDFLib;
  const ctx = doc.context;
  const seen = new Map();
  const map = new Map(); // duplicate ref → kept ref
  let k = 0;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const type = obj.dict.get(PDFName.of('Type'))?.toString() || '';
    if (type === '/XRef' || type === '/ObjStm') continue;
    const contents = obj.getContents();
    if (contents.length < 64) continue;
    const key = `${contents.length}:${await digest(contents)}:${obj.dict.toString()}`;
    const first = seen.get(key);
    if (first) map.set(ref, first); else seen.set(key, ref);
    if (++k % 100 === 0) await tick();
  }
  if (!map.size) return 0;
  remapRefs(ctx, PDFLib, map);
  for (const ref of map.keys()) ctx.delete(ref);
  return map.size;
}

/** Replace every reference in the document according to `map` (old PDFRef → new PDFRef). */
export function remapRefs(ctx, PDFLib, map) {
  const { PDFDict, PDFArray, PDFRef, PDFStream } = PDFLib;
  const visit = obj => {
    if (obj instanceof PDFStream) obj = obj.dict;
    if (obj instanceof PDFDict) {
      for (const [k, v] of obj.entries()) {
        if (v instanceof PDFRef) { if (map.has(v)) obj.set(k, map.get(v)); } else visit(v);
      }
    } else if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) {
        const v = obj.get(i);
        if (v instanceof PDFRef) { if (map.has(v)) obj.set(i, map.get(v)); } else visit(v);
      }
    }
  };
  for (const [, obj] of ctx.enumerateIndirectObjects()) visit(obj);
  for (const key of ['Root', 'Info']) {
    const v = ctx.trailerInfo[key];
    if (v instanceof PDFRef && map.has(v)) ctx.trailerInfo[key] = map.get(v);
  }
}

/** Delete indirect objects that cannot be reached from the trailer (Root, Info). Returns the count. */
export function removeUnreachable(doc, PDFLib) {
  const { PDFDict, PDFArray, PDFRef, PDFStream } = PDFLib;
  const ctx = doc.context;
  const reach = new Set();
  const stack = [ctx.trailerInfo.Root, ctx.trailerInfo.Info, ctx.trailerInfo.Encrypt].filter(Boolean);
  while (stack.length) {
    let obj = stack.pop();
    if (obj instanceof PDFRef) {
      if (reach.has(obj)) continue;
      reach.add(obj);
      obj = ctx.lookup(obj);
      if (!obj) continue;
    }
    if (obj instanceof PDFStream) obj = obj.dict;
    if (obj instanceof PDFDict) for (const [, v] of obj.entries()) { if (v instanceof PDFRef || v instanceof PDFDict || v instanceof PDFArray || v instanceof PDFStream) stack.push(v); }
    else if (obj instanceof PDFArray) for (let i = 0; i < obj.size(); i++) { const v = obj.get(i); if (v instanceof PDFRef || v instanceof PDFDict || v instanceof PDFArray || v instanceof PDFStream) stack.push(v); }
  }
  // a broken trailer (no Root) would delete everything – leave such files alone
  if (!ctx.trailerInfo.Root || reach.size < 2) return 0;
  let n = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!reach.has(ref)) { ctx.delete(ref); n++; }
  return n;
}
