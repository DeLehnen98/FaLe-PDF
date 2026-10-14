// Re-compress the raster images inside a PDF in place (pdf-lib document), keeping text, vector graphics,
// links and forms untouched:
//   - finds how large every image XObject is actually drawn (content streams of all pages, including
//     nested form XObjects) → effective resolution in dpi
//   - images above the target resolution are scaled down, then stored as JPEG via the browser's encoder
//   - an image is only replaced when the result is clearly smaller (minGain)
// Skipped on purpose (kept byte-identical): image masks, soft masks and images used as masks, colour-key
// masks, /Decode arrays, CMYK/Lab/Separation/DeviceN/Indexed colour, 1/2/4/16-bit images, JPEG 2000,
// JBIG2, CCITT, images with an unusual EXIF orientation and anything that fails to decode.
import { jpegInfo } from './files.js';
import { LIMITS } from './shared/limits.js';

const yieldNow = () => new Promise(r => setTimeout(r, 0));

// ---------------------------------------------------------------- content stream scanner
const WS = new Uint8Array(256);
for (const c of [0, 9, 10, 12, 13, 32]) WS[c] = 1;
const DELIM = new Uint8Array(256);
for (const c of '()<>[]{}/%') DELIM[c.charCodeAt(0)] = 1;

function latin1(b, s, e) { let r = ''; for (let i = s; i < e; i++) r += String.fromCharCode(b[i]); return r; }

/**
 * Minimal tokenizer: calls onOp(operator, operands) for every operator; operands are numbers,
 * {name} objects or null for anything else. Skips strings, dicts, arrays and inline image data.
 */
export function scanContent(b, onOp) {
  const n = b.length;
  let i = 0;
  const ops = [];
  let depth = 0; // array / dict nesting: operands inside are not collected
  let inlineImage = false;
  while (i < n) {
    const c = b[i];
    if (WS[c]) { i++; continue; }
    if (c === 0x25) { while (i < n && b[i] !== 10 && b[i] !== 13) i++; continue; } // % comment
    if (c === 0x28) { // ( string )
      let d = 1; i++;
      while (i < n && d) { const x = b[i]; if (x === 0x5c) { i += 2; continue; } if (x === 0x28) d++; else if (x === 0x29) d--; i++; }
      if (!depth) ops.push(null);
      continue;
    }
    if (c === 0x3c) {
      if (b[i + 1] === 0x3c) { depth++; i += 2; continue; }
      while (i < n && b[i] !== 0x3e) i++;
      i++;
      if (!depth) ops.push(null);
      continue;
    }
    if (c === 0x3e) { if (b[i + 1] === 0x3e) { depth = Math.max(0, depth - 1); if (!depth) ops.push(null); i += 2; } else i++; continue; }
    if (c === 0x5b) { depth++; i++; continue; }
    if (c === 0x5d) { depth = Math.max(0, depth - 1); if (!depth) ops.push(null); i++; continue; }
    if (c === 0x7b || c === 0x7d) { i++; continue; }
    if (c === 0x2f) { // /Name
      let j = i + 1;
      while (j < n && !WS[b[j]] && !DELIM[b[j]]) j++;
      if (!depth) ops.push({ name: latin1(b, i + 1, j).replace(/#([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))) });
      i = j;
      continue;
    }
    let j = i;
    while (j < n && !WS[b[j]] && !DELIM[b[j]]) j++;
    if (j === i) { i++; continue; }
    const tok = latin1(b, i, j);
    i = j;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) { if (!depth) ops.push(parseFloat(tok)); continue; }
    if (depth) continue;
    if (tok === 'BI') { inlineImage = true; ops.length = 0; continue; }
    if (tok === 'ID' && inlineImage) {
      // binary data up to whitespace + "EI" + whitespace/end
      let k = i + 1;
      while (k < n - 1) {
        if (b[k] === 0x45 && b[k + 1] === 0x49 && WS[b[k - 1]] && (k + 2 >= n || WS[b[k + 2]] || DELIM[b[k + 2]])) break;
        k++;
      }
      i = k + 2;
      inlineImage = false;
      ops.length = 0;
      continue;
    }
    if (inlineImage) { ops.length = 0; continue; }
    onOp(tok, ops);
    ops.length = 0;
  }
}

const mul = (m, n) => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];

function streamBytes(stream, PDFLib) {
  if (stream instanceof PDFLib.PDFRawStream) return PDFLib.decodePDFRawStream(stream).decode();
  return stream.getContents();
}

function resourcesOf(node, PDFLib) {
  const { PDFDict, PDFName } = PDFLib;
  for (let n = node, guard = 0; n && guard < 64; guard++) {
    const r = n.lookup(PDFName.of('Resources'));
    if (r instanceof PDFDict) return r;
    n = n.lookup(PDFName.of('Parent'));
    if (!(n instanceof PDFDict)) break;
  }
  return null;
}

/**
 * Largest drawn size (in points) of every image XObject, keyed by its PDFRef.
 * @returns {Promise<Map<any, {w: number, h: number}>>}
 */
export async function imageUsage(doc, PDFLib, { tick = yieldNow, budget = 3e6 } = {}) {
  const { PDFDict, PDFArray, PDFName, PDFRef, PDFStream, PDFNumber } = PDFLib;
  const usage = new Map();
  let opsLeft = budget;
  const XO = PDFName.of('XObject'), SUB = PDFName.of('Subtype'), MAT = PDFName.of('Matrix'), RES = PDFName.of('Resources');

  const walk = (bytes, resources, ctm0, depth, path) => {
    const stack = [];
    let ctm = ctm0;
    scanContent(bytes, (op, args) => {
      if (--opsLeft < 0) throw new Error('budget');
      if (op === 'q') stack.push(ctm);
      else if (op === 'Q') ctm = stack.pop() || ctm0;
      else if (op === 'cm' && args.length >= 6 && args.slice(-6).every(a => typeof a === 'number')) ctm = mul(args.slice(-6), ctm);
      else if (op === 'Do' && args.length && args[args.length - 1]?.name && resources) {
        const xobjs = resources.lookup(XO);
        if (!(xobjs instanceof PDFDict)) return;
        const ref = xobjs.get(PDFName.of(args[args.length - 1].name));
        const xo = ref instanceof PDFRef ? doc.context.lookup(ref) : ref;
        if (!(xo instanceof PDFStream)) return;
        const sub = xo.dict.get(SUB)?.toString();
        if (sub === '/Image' && ref instanceof PDFRef) {
          const w = Math.hypot(ctm[0], ctm[1]), h = Math.hypot(ctm[2], ctm[3]);
          const u = usage.get(ref);
          if (!u) usage.set(ref, { w, h }); else { u.w = Math.max(u.w, w); u.h = Math.max(u.h, h); }
        } else if (sub === '/Form' && depth < 12 && !(ref instanceof PDFRef && path.has(ref))) {
          let m = [1, 0, 0, 1, 0, 0];
          const ma = xo.dict.lookup(MAT);
          if (ma instanceof PDFArray && ma.size() === 6) m = ma.asArray().map(v => (v instanceof PDFNumber ? v.asNumber() : 0));
          const res = xo.dict.lookup(RES);
          let bytes2;
          try { bytes2 = streamBytes(xo, PDFLib); } catch { return; }
          const p2 = new Set(path);
          if (ref instanceof PDFRef) p2.add(ref);
          walk(bytes2, res instanceof PDFDict ? res : resources, mul(m, ctm), depth + 1, p2);
        }
      }
    });
  };

  const pages = doc.getPages();
  for (let p = 0; p < pages.length; p++) {
    const node = pages[p].node;
    const contents = node.lookup(PDFName.of('Contents'));
    const parts = contents instanceof PDFArray ? contents.asArray().map(r => doc.context.lookup(r)) : [contents];
    const chunks = [];
    for (const s of parts) {
      if (!(s instanceof PDFStream)) continue;
      try { chunks.push(streamBytes(s, PDFLib), new Uint8Array([10])); } catch { /* undecodable part */ }
    }
    const all = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    try { walk(all, resourcesOf(node, PDFLib), [1, 0, 0, 1, 0, 0], 0, new Set()); } catch (err) {
      if (err.message === 'budget') return usage; // very complex document: known sizes so far are kept
    }
    if (p % 4 === 3) await tick();
  }
  return usage;
}

// ---------------------------------------------------------------- decoding helpers
async function inflate(bytes) {
  const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(ds).arrayBuffer());
}

/** Undo PNG (10–15) or TIFF (2) predictors for 8-bit samples. */
function unpredict(data, predictor, colors, columns, height) {
  const bpp = colors, row = colors * columns;
  if (predictor === 2) {
    const out = new Uint8Array(data.subarray(0, row * height));
    for (let y = 0; y < height; y++) for (let x = bpp; x < row; x++) out[y * row + x] = (out[y * row + x] + out[y * row + x - bpp]) & 255;
    return out;
  }
  const out = new Uint8Array(row * height);
  let prev = new Uint8Array(row);
  for (let y = 0; y < height; y++) {
    const src = y * (row + 1);
    if (src + row + 1 > data.length) break;
    const type = data[src];
    const cur = out.subarray(y * row, (y + 1) * row);
    for (let x = 0; x < row; x++) {
      const raw = data[src + 1 + x];
      const a = x >= bpp ? cur[x - bpp] : 0, b2 = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v;
      switch (type) {
        case 0: v = raw; break;
        case 1: v = raw + a; break;
        case 2: v = raw + b2; break;
        case 3: v = raw + ((a + b2) >> 1); break;
        case 4: { const p = a + b2 - c, pa = Math.abs(p - a), pb = Math.abs(p - b2), pc = Math.abs(p - c); v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b2 : c); break; }
        default: v = raw;
      }
      cur[x] = v & 255;
    }
    prev = cur;
  }
  return out;
}

function colourComponents(dict, PDFLib, ctx) {
  const { PDFName, PDFArray, PDFStream, PDFNumber } = PDFLib;
  const cs = dict.lookup(PDFName.of('ColorSpace'));
  if (cs instanceof PDFName) {
    const n = cs.toString();
    if (n === '/DeviceRGB' || n === '/CalRGB') return 3;
    if (n === '/DeviceGray' || n === '/CalGray') return 1;
    return 0;
  }
  if (cs instanceof PDFArray && cs.size() >= 1) {
    const kind = String(cs.lookup(0));
    if (kind === '/CalRGB') return 3;
    if (kind === '/CalGray') return 1;
    if (kind === '/ICCBased') {
      const s = cs.lookup(1);
      if (s instanceof PDFStream) {
        const n = s.dict.lookup(PDFName.of('N'));
        const v = n instanceof PDFNumber ? n.asNumber() : 0;
        return v === 1 || v === 3 ? v : 0;
      }
    }
  }
  return 0;
}

function filterName(dict, PDFLib) {
  const { PDFName, PDFArray } = PDFLib;
  const f = dict.lookup(PDFName.of('Filter'));
  if (f instanceof PDFName) return f.toString();
  if (f instanceof PDFArray && f.size() === 1) return f.lookup(0).toString();
  if (!f) return 'none';
  return 'chain';
}

/**
 * @param doc      pdf-lib document
 * @param {{dpi?: number, quality?: number, minGain?: number, minBytes?: number, onProgress?: (done, total) => void, tick?: () => Promise<void>}} [o]
 * @returns {Promise<{images: number, replaced: number, before: number, after: number}>}
 */
export async function recompressImages(doc, PDFLib, { dpi = 150, quality = 0.75, minGain = 0.9, minBytes = 12 * 1024, onProgress = null, tick = yieldNow } = {}) {
  const { PDFRawStream, PDFName, PDFNumber, PDFBool, PDFRef, PDFDict } = PDFLib;
  const ctx = doc.context;
  const N = k => PDFName.of(k);
  const usage = await imageUsage(doc, PDFLib, { tick });

  // images that serve as (soft) masks of other images must stay exact
  const masks = new Set();
  const candidates = [];
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream) || obj.dict.get(N('Subtype'))?.toString() !== '/Image') continue;
    for (const k of ['SMask', 'Mask']) { const v = obj.dict.get(N(k)); if (v instanceof PDFRef) masks.add(v); }
    candidates.push([ref, obj]);
  }
  const stats = { images: candidates.length, replaced: 0, before: 0, after: 0 };
  let done = 0;
  for (const [ref, obj] of candidates) {
    done++;
    onProgress?.(done, candidates.length);
    const d = obj.dict;
    try {
      if (masks.has(ref)) continue;
      if (d.lookup(N('ImageMask')) === PDFBool.True) continue;
      if (d.has(N('Decode')) || d.lookup(N('Mask')) instanceof PDFLib.PDFArray) continue;
      const bpc = d.lookup(N('BitsPerComponent'));
      if (!(bpc instanceof PDFNumber) || bpc.asNumber() !== 8) continue;
      const W = d.lookup(N('Width'))?.asNumber?.(), H = d.lookup(N('Height'))?.asNumber?.();
      if (!W || !H || W < 16 || H < 16 || W * H > LIMITS.canvasPixels) continue;
      const comps = colourComponents(d, PDFLib, ctx);
      if (!comps) continue;
      const raw = obj.getContents();
      if (raw.length < minBytes) continue;
      const filter = filterName(d, PDFLib);
      if (filter !== '/DCTDecode' && filter !== '/FlateDecode') continue;

      // target size from the drawn size (unknown use → keep the pixel size, only re-encode)
      let scale = 1;
      const u = usage.get(ref);
      if (u && u.w > 0 && u.h > 0) {
        const dpiX = W / (u.w / 72), dpiY = H / (u.h / 72);
        const eff = Math.min(dpiX, dpiY);
        if (eff > dpi * 1.15) scale = Math.max(dpi / eff, 16 / Math.min(W, H));
      }
      const tw = Math.max(1, Math.round(W * scale)), th = Math.max(1, Math.round(H * scale));

      let bitmap;
      if (filter === '/DCTDecode') {
        const info = jpegInfo(raw);
        if (info.components !== comps || (info.orientation && info.orientation !== 1)) continue;
        if (scale === 1 && quality >= 0.85) continue; // nothing to gain
        bitmap = await createImageBitmap(new Blob([raw], { type: 'image/jpeg' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
        if (bitmap.width !== W || bitmap.height !== H) { bitmap.close(); continue; }
      } else {
        const dp = d.lookup(N('DecodeParms'));
        let data = await inflate(raw);
        const pred = dp instanceof PDFDict ? dp.lookup(N('Predictor'))?.asNumber?.() || 1 : 1;
        if (pred > 1) {
          const colors = dp.lookup(N('Colors'))?.asNumber?.() || 1, cols = dp.lookup(N('Columns'))?.asNumber?.() || 1;
          const bpc2 = dp.lookup(N('BitsPerComponent'))?.asNumber?.() || 8;
          if (colors !== comps || cols !== W || bpc2 !== 8) continue;
          data = unpredict(data, pred, colors, cols, H);
        }
        if (data.length < W * H * comps) continue;
        const rgba = new Uint8ClampedArray(W * H * 4);
        if (comps === 3) for (let s = 0, t = 0; t < rgba.length; s += 3, t += 4) { rgba[t] = data[s]; rgba[t + 1] = data[s + 1]; rgba[t + 2] = data[s + 2]; rgba[t + 3] = 255; }
        else for (let s = 0, t = 0; t < rgba.length; s++, t += 4) { rgba[t] = rgba[t + 1] = rgba[t + 2] = data[s]; rgba[t + 3] = 255; }
        bitmap = await createImageBitmap(new ImageData(rgba, W, H), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      }
      let src = bitmap;
      if (tw !== W || th !== H) {
        src = await createImageBitmap(bitmap, { resizeWidth: tw, resizeHeight: th, resizeQuality: 'high' });
        bitmap.close();
      }
      const canvas = document.createElement('canvas');
      canvas.width = tw; canvas.height = th;
      const c2 = canvas.getContext('2d', { alpha: false });
      c2.drawImage(src, 0, 0);
      src.close();
      const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
      canvas.width = canvas.height = 0;
      if (!blob) continue;
      // Flate images that are graphics (flat colours) stay Flate unless JPEG is a lot smaller
      const gain = filter === '/FlateDecode' && scale === 1 ? Math.min(minGain, 0.6) : minGain;
      if (blob.size >= raw.length * gain) continue;
      const jpg = new Uint8Array(await blob.arrayBuffer());
      const nd = ctx.obj({});
      for (const [k, v] of d.entries()) {
        const key = k.toString();
        if (['/Filter', '/DecodeParms', '/Length', '/Width', '/Height', '/BitsPerComponent', '/Decode'].includes(key)) continue;
        if (key === '/ColorSpace' && comps === 1) continue;
        nd.set(k, v);
      }
      nd.set(N('Filter'), N('DCTDecode'));
      nd.set(N('Width'), PDFNumber.of(tw));
      nd.set(N('Height'), PDFNumber.of(th));
      nd.set(N('BitsPerComponent'), PDFNumber.of(8));
      if (comps === 1) nd.set(N('ColorSpace'), N('DeviceRGB'));
      ctx.assign(ref, PDFRawStream.of(nd, jpg));
      stats.replaced++;
      stats.before += raw.length;
      stats.after += jpg.length;
    } catch (err) {
      console.warn('image skipped', err);
    }
    if (done % 2 === 0) await tick();
  }
  return stats;
}
