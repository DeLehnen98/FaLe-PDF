// Grayscale conversion of a pdf-lib document that keeps text and vector graphics:
//   - content streams (pages, form XObjects, tiling patterns, annotation appearances, Type 3 glyphs):
//     colour operators rg/RG/k/K, cs/CS + sc/scn/SC/SCN in RGB/CMYK/Lab/ICC spaces become gray operators
//   - colour space resources: Indexed palettes → gray palettes, Separation/DeviceN alternates and
//     shadings with exponential/stitching/PostScript functions → gray versions
//   - image XObjects (8-bit RGB/CMYK/ICC/Indexed, Flate or JPEG) → 8-bit DeviceGray (Flate)
//   - annotation colours (/C, /IC, /MK, /DA)
// Anything it cannot convert is reported per page (`unsupported`), so the caller can check the rendered
// result and fall back to a gray raster image for exactly those pages.
const yieldNow = () => new Promise(r => setTimeout(r, 0));

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const cmykGray = (c, m, y, k) => Math.max(0, 1 - Math.min(1, 0.3 * c + 0.59 * m + 0.11 * y + k));
const num = v => { const r = Math.round(Math.max(0, Math.min(1, v)) * 10000) / 10000; return String(r); };

// ---------------------------------------------------------------- tokenizer with positions
const WS = new Uint8Array(256); for (const c of [0, 9, 10, 12, 13, 32]) WS[c] = 1;
const DELIM = new Uint8Array(256); for (const c of '()<>[]{}/%') DELIM[c.charCodeAt(0)] = 1;
const latin1 = (b, s, e) => { let r = ''; for (let i = s; i < e; i++) r += String.fromCharCode(b[i]); return r; };

/**
 * Rewrite colour operators of one content stream.
 * @param {Uint8Array} b
 * @param {(name: string) => string} spaceKind  'rgb' | 'cmyk' | 'lab' | 'gray' | 'keep' | 'pattern' | 'pattern-rgb' | 'pattern-cmyk' | 'bad'
 * @returns {{bytes: Uint8Array, changed: boolean, problems: string[]}}
 */
export function rewriteContent(b, spaceKind) {
  const n = b.length;
  const parts = [];
  let last = 0;
  let changed = false;
  const problems = [];
  let ops = []; // {s, e, v} v: number | {name} | null
  let depth = 0;
  let fill = 'gray', stroke = 'gray';
  const stack = [];
  const replace = (start, end, text) => { parts.push(b.subarray(last, start), enc(text)); last = end; changed = true; };
  let i = 0;
  while (i < n) {
    const c = b[i];
    if (WS[c]) { i++; continue; }
    if (c === 0x25) { while (i < n && b[i] !== 10 && b[i] !== 13) i++; continue; }
    const s = i;
    if (c === 0x28) {
      let d = 1; i++;
      while (i < n && d) { const x = b[i]; if (x === 0x5c) { i += 2; continue; } if (x === 0x28) d++; else if (x === 0x29) d--; i++; }
      if (!depth) ops.push({ s, e: i, v: null });
      continue;
    }
    if (c === 0x3c) {
      if (b[i + 1] === 0x3c) { depth++; i += 2; if (depth === 1) ops.push({ s, e: i, v: null }); continue; }
      while (i < n && b[i] !== 0x3e) i++;
      i++;
      if (!depth) ops.push({ s, e: i, v: null });
      continue;
    }
    if (c === 0x3e) { if (b[i + 1] === 0x3e) { depth = Math.max(0, depth - 1); i += 2; } else i++; continue; }
    if (c === 0x5b) { if (!depth) ops.push({ s, e: i + 1, v: null }); depth++; i++; continue; }
    if (c === 0x5d) { depth = Math.max(0, depth - 1); i++; continue; }
    if (c === 0x7b || c === 0x7d) { i++; continue; }
    if (c === 0x2f) {
      let j = i + 1;
      while (j < n && !WS[b[j]] && !DELIM[b[j]]) j++;
      if (!depth) ops.push({ s, e: j, v: { name: latin1(b, i + 1, j).replace(/#([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))) } });
      i = j;
      continue;
    }
    let j = i;
    while (j < n && !WS[b[j]] && !DELIM[b[j]]) j++;
    if (j === i) { i++; continue; }
    const tok = latin1(b, i, j);
    i = j;
    if (depth) continue;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) { ops.push({ s, e: j, v: parseFloat(tok) }); continue; }
    if (tok === 'true' || tok === 'false' || tok === 'null') { ops.push({ s, e: j, v: null }); continue; }
    if (tok === 'BI') {
      // inline image: check its colour space, skip the binary data
      let k = j, csName = null, isMask = false;
      const head = [];
      while (k < n - 1) {
        if (b[k] === 0x49 && b[k + 1] === 0x44 && WS[b[k - 1]] && (WS[b[k + 2]] || k + 2 >= n)) break;
        k++;
      }
      const dict = latin1(b, j, k);
      const m = /\/(?:CS|ColorSpace)\s*\/?([A-Za-z0-9#]+)/.exec(dict);
      csName = m ? m[1] : null;
      isMask = /\/(?:IM|ImageMask)\s+true/.test(dict);
      head.push(dict);
      k += 3;
      while (k < n - 1) {
        if (b[k] === 0x45 && b[k + 1] === 0x49 && WS[b[k - 1]] && (k + 2 >= n || WS[b[k + 2]] || DELIM[b[k + 2]])) break;
        k++;
      }
      i = k + 2;
      if (!isMask && csName && !/^(G|DeviceGray|CalGray)$/.test(csName)) {
        const kind = /^(RGB|DeviceRGB|CMYK|DeviceCMYK|CalRGB)$/.test(csName) ? 'colour' : spaceKind(csName);
        if (kind !== 'gray') problems.push('inline-image');
      }
      ops = [];
      continue;
    }
    // operator
    const nums = ops.map(o => o.v);
    const allNum = k => nums.length >= k && nums.slice(-k).every(v => typeof v === 'number');
    const from = k => ops[ops.length - k].s;
    switch (tok) {
      case 'q': stack.push([fill, stroke]); break;
      case 'Q': if (stack.length) [fill, stroke] = stack.pop(); break;
      case 'rg': case 'RG':
        if (allNum(3)) { const [r, g, bb] = nums.slice(-3); replace(from(3), j, `${num(lum(r, g, bb))} ${tok === 'rg' ? 'g' : 'G'}`); }
        if (tok === 'rg') fill = 'gray'; else stroke = 'gray';
        break;
      case 'k': case 'K':
        if (allNum(4)) { const [cc, m, y, kk] = nums.slice(-4); replace(from(4), j, `${num(cmykGray(cc, m, y, kk))} ${tok === 'k' ? 'g' : 'G'}`); }
        if (tok === 'k') fill = 'gray'; else stroke = 'gray';
        break;
      case 'g': if (tok === 'g') fill = 'gray'; break;
      case 'G': stroke = 'gray'; break;
      case 'cs': case 'CS': {
        const nm = nums[nums.length - 1];
        if (nm && nm.name != null) {
          const kind = spaceKind(nm.name);
          if (kind === 'rgb' || kind === 'cmyk' || kind === 'lab') replace(ops[ops.length - 1].s, j, `/DeviceGray ${tok}`);
          if (kind === 'bad') problems.push('colourspace ' + nm.name);
          if (tok === 'cs') fill = kind; else stroke = kind;
        }
        break;
      }
      case 'sc': case 'scn': case 'SC': case 'SCN': {
        const kind = tok === 'sc' || tok === 'scn' ? fill : stroke;
        const hasName = nums.length && nums[nums.length - 1] && nums[nums.length - 1].name != null;
        const values = nums.slice(0, hasName ? -1 : undefined).filter(v => typeof v === 'number');
        const base = kind === 'pattern-rgb' ? 'rgb' : kind === 'pattern-cmyk' ? 'cmyk' : kind;
        let g = null;
        if (base === 'rgb' && values.length >= 3) { const [r, gg, bb] = values.slice(-3); g = lum(r, gg, bb); }
        else if (base === 'cmyk' && values.length >= 4) { const [cc, m, y, kk] = values.slice(-4); g = cmykGray(cc, m, y, kk); }
        else if (base === 'lab' && values.length >= 3) g = values[values.length - 3] / 100;
        if (g != null) {
          const cnt = base === 'cmyk' ? 4 : 3;
          const start = ops[ops.length - cnt - (hasName ? 1 : 0)].s;
          const nameText = hasName ? ' ' + latin1(b, ops[ops.length - 1].s, ops[ops.length - 1].e) : '';
          replace(start, j, `${num(g)}${nameText} ${tok}`);
        }
        break;
      }
      default: break;
    }
    ops = [];
  }
  if (!changed) return { bytes: b, changed, problems };
  parts.push(b.subarray(last));
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return { bytes: out, changed, problems };
}
const enc = s => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };

// ---------------------------------------------------------------- PNG predictor
function unpredict(data, predictor, colors, columns, height, bpc = 8) {
  const bpp = Math.max(1, Math.ceil(colors * bpc / 8)), row = Math.ceil(colors * columns * bpc / 8);
  if (predictor === 2) {
    const out = new Uint8Array(data.subarray(0, row * height));
    if (bpc === 8) for (let y = 0; y < height; y++) for (let x = bpp; x < row; x++) out[y * row + x] = (out[y * row + x] + out[y * row + x - bpp]) & 255;
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
      const a = x >= bpp ? cur[x - bpp] : 0, up = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v;
      switch (type) {
        case 1: v = raw + a; break;
        case 2: v = raw + up; break;
        case 3: v = raw + ((a + up) >> 1); break;
        case 4: { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c); break; }
        default: v = raw;
      }
      cur[x] = v & 255;
    }
    prev = cur;
  }
  return out;
}

// ---------------------------------------------------------------- the converter
/**
 * @param doc pdf-lib PDFDocument (modified in place)
 * @param PDFLib
 * @param {{decodeJpeg?: (bytes: Uint8Array) => Promise<{w,h,rgba}>, tick?, onProgress?}} env
 * @returns {Promise<{unsupported: Map<number, string[]>, images: number, streams: number}>}
 */
export async function grayscaleDoc(doc, PDFLib, env = {}) {
  const { PDFName, PDFDict, PDFArray, PDFRef, PDFStream, PDFRawStream, PDFNumber, PDFString, PDFHexString, PDFBool } = PDFLib;
  const ctx = doc.context;
  const N = k => PDFName.of(k);
  const tick = env.tick || yieldNow;
  const L = v => (v instanceof PDFRef ? ctx.lookup(v) : v);
  const streamBytes = s => (s instanceof PDFRawStream ? PDFLib.decodePDFRawStream(s).decode() : s.getContents());
  const stats = { unsupported: new Map(), images: 0, streams: 0 };
  let pageNo = -1;
  const problem = text => { if (pageNo < 0) return; const l = stats.unsupported.get(pageNo) || []; if (!l.includes(text)) l.push(text); stats.unsupported.set(pageNo, l); };

  // ---- colour spaces
  const csCache = new Map(); // PDFObject → kind
  function kindOf(cs, depth = 0) {
    cs = L(cs);
    if (!cs || depth > 8) return 'gray';
    if (csCache.has(cs)) return csCache.get(cs);
    let kind = 'bad';
    if (cs instanceof PDFName) {
      const n = cs.decodeText ? cs.decodeText() : cs.toString().slice(1);
      kind = { DeviceRGB: 'rgb', RGB: 'rgb', CalRGB: 'rgb', DeviceCMYK: 'cmyk', CMYK: 'cmyk', DeviceGray: 'gray', G: 'gray', CalGray: 'gray', Pattern: 'pattern', Indexed: 'keep', I: 'keep' }[n] || 'bad';
    } else if (cs instanceof PDFArray && cs.size()) {
      const fam = cs.lookup(0)?.toString().slice(1);
      if (fam === 'CalRGB') kind = 'rgb';
      else if (fam === 'CalGray') kind = 'gray';
      else if (fam === 'Lab') kind = 'lab';
      else if (fam === 'ICCBased') {
        const s = cs.lookup(1);
        const nn = s instanceof PDFStream ? s.dict.lookup(N('N'))?.asNumber?.() : 0;
        kind = nn === 1 ? 'gray' : nn === 3 ? 'rgb' : nn === 4 ? 'cmyk' : 'bad';
      } else if (fam === 'Indexed' || fam === 'I') kind = convertIndexed(cs, depth) ? 'keep' : 'bad';
      else if (fam === 'Separation' || fam === 'DeviceN') kind = convertTint(cs, fam, depth) ? 'keep' : 'bad';
      else if (fam === 'Pattern') {
        const base = cs.size() > 1 ? kindOf(cs.get(1), depth + 1) : 'gray';
        if (base === 'rgb' || base === 'cmyk' || base === 'lab') { cs.set(1, N('DeviceGray')); kind = base === 'cmyk' ? 'pattern-cmyk' : 'pattern-rgb'; } else kind = 'pattern';
      }
    }
    csCache.set(cs, kind);
    return kind;
  }
  /** gray value (0..1) for a colour given in a base space. */
  function toGray(kind, vals) {
    if (kind === 'rgb') return lum(vals[0], vals[1], vals[2]);
    if (kind === 'cmyk') return cmykGray(vals[0], vals[1], vals[2], vals[3]);
    if (kind === 'lab') return vals[0] / 100;
    return vals[0];
  }
  function convertIndexed(cs, depth) {
    const base = L(cs.get(1));
    const kind = kindOf(base, depth + 1);
    if (kind === 'gray') return true;
    if (kind !== 'rgb' && kind !== 'cmyk' && kind !== 'lab') return false;
    const hival = cs.lookup(2)?.asNumber?.() ?? 255;
    const lk = cs.lookup(3);
    let bytes;
    if (lk instanceof PDFStream) bytes = streamBytes(lk);
    else if (lk instanceof PDFString || lk instanceof PDFHexString) bytes = lk.asBytes();
    else return false;
    const nc = kind === 'cmyk' ? 4 : 3;
    const out = new Uint8Array(hival + 1);
    for (let i = 0; i <= hival; i++) {
      const v = [];
      for (let k = 0; k < nc; k++) v.push((bytes[i * nc + k] ?? 0) / 255 * (kind === 'lab' && k === 0 ? 100 : 1));
      out[i] = Math.round(toGray(kind, v) * 255);
    }
    cs.set(1, N('DeviceGray'));
    cs.set(3, PDFHexString.of(Array.from(out, x => x.toString(16).padStart(2, '0')).join('')));
    return true;
  }
  /** Separation / DeviceN: turn the alternate space into DeviceGray by converting the tint transform. */
  function convertTint(cs, fam, depth) {
    const altIdx = fam === 'Separation' ? 2 : 2;
    const alt = cs.get(altIdx);
    const kind = kindOf(alt, depth + 1);
    if (kind === 'gray') return true;
    if (kind !== 'rgb' && kind !== 'cmyk' && kind !== 'lab') return false;
    const fnRef = cs.get(3);
    const fn = grayFunction(fnRef, kind);
    if (!fn) return false;
    cs.set(altIdx, N('DeviceGray'));
    cs.set(3, fn);
    return true;
  }
  /** A function with the same inputs whose single output is the gray of the original outputs. */
  function grayFunction(fnRef, kind, depth = 0) {
    const fn = L(fnRef);
    if (depth > 6) return null;
    const d = fn instanceof PDFStream ? fn.dict : fn;
    if (!(d instanceof PDFDict)) return null;
    const type = d.lookup(N('FunctionType'))?.asNumber?.();
    const nc = kind === 'cmyk' ? 4 : 3;
    if (type === 2) {
      const c0 = d.lookup(N('C0')), c1 = d.lookup(N('C1'));
      const arr = (a, def) => (a instanceof PDFArray ? Array.from({ length: a.size() }, (_, i) => a.lookup(i)?.asNumber?.() ?? 0) : def);
      const v0 = arr(c0, [0]), v1 = arr(c1, [1]);
      if (v0.length < nc || v1.length < nc) return null;
      const nd = d.clone(ctx);
      nd.set(N('C0'), ctx.obj([PDFNumber.of(+num(toGray(kind, v0)))]));
      nd.set(N('C1'), ctx.obj([PDFNumber.of(+num(toGray(kind, v1)))]));
      nd.delete(N('Range'));
      return ctx.register(nd);
    }
    if (type === 3) {
      const fns = d.lookup(N('Functions'));
      if (!(fns instanceof PDFArray)) return null;
      const list = [];
      for (let i = 0; i < fns.size(); i++) { const g = grayFunction(fns.get(i), kind, depth + 1); if (!g) return null; list.push(g); }
      const nd = d.clone(ctx);
      nd.set(N('Functions'), ctx.obj(list));
      nd.delete(N('Range'));
      return ctx.register(nd);
    }
    if (type === 4 && fn instanceof PDFStream) {
      let code = new TextDecoder('latin1').decode(streamBytes(fn)).trim();
      if (!code.startsWith('{') || !code.endsWith('}')) return null;
      code = code.slice(1, -1);
      const conv = kind === 'cmyk' ? '4 1 roll 0.11 mul exch 0.59 mul add exch 0.3 mul add add dup 1 gt {pop 1} if 1 exch sub'
        : kind === 'lab' ? 'pop pop 100 div' : '0.114 mul exch 0.587 mul add exch 0.299 mul add';
      const nd = fn.dict.clone(ctx);
      for (const k of ['Filter', 'DecodeParms', 'Length']) nd.delete(N(k));
      nd.set(N('Range'), ctx.obj([PDFNumber.of(0), PDFNumber.of(1)]));
      return ctx.register(PDFRawStream.of(nd, enc(`{${code} ${conv}}`)));
    }
    if (type === 0 && fn instanceof PDFStream) {
      // sampled: convert every sample (8-bit samples only)
      const bps = d.lookup(N('BitsPerSample'))?.asNumber?.();
      if (bps !== 8) return null;
      const data = streamBytes(fn);
      const range = d.lookup(N('Range'));
      const rng = range instanceof PDFArray ? Array.from({ length: range.size() }, (_, i) => range.lookup(i)?.asNumber?.() ?? 0) : null;
      if (!rng || rng.length < nc * 2) return null;
      const count = Math.floor(data.length / nc);
      const out = new Uint8Array(count);
      for (let i = 0; i < count; i++) {
        const v = [];
        for (let k = 0; k < nc; k++) v.push(rng[2 * k] + data[i * nc + k] / 255 * (rng[2 * k + 1] - rng[2 * k]));
        out[i] = Math.round(Math.max(0, Math.min(1, toGray(kind, v))) * 255);
      }
      const nd = d.clone(ctx);
      for (const k of ['Filter', 'DecodeParms', 'Length', 'Decode']) nd.delete(N(k));
      nd.set(N('Range'), ctx.obj([PDFNumber.of(0), PDFNumber.of(1)]));
      return ctx.register(PDFRawStream.of(nd, out));
    }
    return null;
  }
  function convertShading(sh) {
    const d = sh instanceof PDFStream ? sh.dict : sh;
    if (!(d instanceof PDFDict) || d.__gray) return true;
    d.__gray = true;
    const kind = kindOf(d.get(N('ColorSpace')));
    if (kind === 'gray' || kind === 'keep') return true;
    if (kind !== 'rgb' && kind !== 'cmyk' && kind !== 'lab') return false;
    const fn = d.get(N('Function'));
    if (!fn) return false; // mesh shading with colours per vertex
    if (fn instanceof PDFArray) {
      // one function per component → combine is not possible generically
      return false;
    }
    const g = grayFunction(fn, kind);
    if (!g) return false;
    d.set(N('Function'), g);
    d.set(N('ColorSpace'), N('DeviceGray'));
    const bg = d.lookup(N('Background'));
    if (bg instanceof PDFArray) d.delete(N('Background'));
    return true;
  }

  // ---- images
  const doneImages = new Set();
  async function convertImage(ref, img) {
    if (doneImages.has(img)) return;
    doneImages.add(img);
    const d = img.dict;
    if (d.lookup(N('ImageMask')) === PDFBool.True) return;
    const csObj = d.get(N('ColorSpace'));
    if (!csObj) return; // JPX with embedded colour space: handled below
    const kind = kindOf(csObj);
    if (kind === 'gray' || kind === 'keep') return; // Indexed palettes are converted with the colour space
    if (kind !== 'rgb' && kind !== 'cmyk' && kind !== 'lab') { problem('image colour space'); return; }
    const W = d.lookup(N('Width'))?.asNumber?.(), H = d.lookup(N('Height'))?.asNumber?.();
    const bpc = d.lookup(N('BitsPerComponent'))?.asNumber?.();
    const filters = filterList(d);
    if (!W || !H || bpc !== 8 || d.has(N('Decode'))) { problem('image format'); return; }
    const nc = kind === 'cmyk' ? 4 : 3;
    let px = null; // gray bytes
    let wasJpeg = false;
    try {
      if (filters.length && filters[filters.length - 1] === 'DCTDecode' && filters.slice(0, -1).every(f => /^(ASCII85Decode|A85|ASCIIHexDecode|AHx|FlateDecode|Fl|LZWDecode|LZW|RunLengthDecode|RL)$/.test(f))) {
        if (!env.decodeJpeg) { problem('jpeg'); return; }
        let jpg = img.getContents();
        if (filters.length > 1) {
          const td = d.clone(ctx);
          td.set(N('Filter'), ctx.obj(filters.slice(0, -1).map(f => N(f))));
          td.delete(N('DecodeParms'));
          jpg = PDFLib.decodePDFRawStream(PDFRawStream.of(td, jpg)).decode();
        }
        wasJpeg = true;
        const { w, h, rgba } = await env.decodeJpeg(jpg);
        if (w !== W || h !== H) { problem('jpeg size'); return; }
        px = new Uint8Array(W * H);
        for (let i = 0, j = 0; j < px.length; i += 4, j++) px[j] = Math.round(lum(rgba[i], rgba[i + 1], rgba[i + 2]));
      } else if (filters.every(f => f !== 'DCTDecode' && f !== 'JPXDecode' && f !== 'JBIG2Decode' && f !== 'CCITTFaxDecode')) {
        let data = streamBytes(img);
        const dp = d.lookup(N('DecodeParms'));
        const dpd = dp instanceof PDFArray ? dp.lookup(dp.size() - 1) : dp;
        const pred = dpd instanceof PDFDict ? dpd.lookup(N('Predictor'))?.asNumber?.() || 1 : 1;
        if (pred > 1) data = unpredict(data, pred, nc, W, H);
        if (data.length < W * H * nc) { problem('image data'); return; }
        px = new Uint8Array(W * H);
        if (nc === 3 && kind === 'rgb') for (let j = 0, i = 0; j < px.length; j++, i += 3) px[j] = Math.round(lum(data[i], data[i + 1], data[i + 2]));
        else if (kind === 'lab') for (let j = 0, i = 0; j < px.length; j++, i += 3) px[j] = data[i];
        else for (let j = 0, i = 0; j < px.length; j++, i += 4) px[j] = Math.round(cmykGray(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255, data[i + 3] / 255) * 255);
      } else { problem('image codec'); return; }
    } catch (err) { console.warn('gray image', err); problem('image decode'); return; }
    const nd = ctx.obj({});
    for (const [k, v] of d.entries()) {
      const key = k.toString();
      if (['/Filter', '/DecodeParms', '/Length', '/ColorSpace', '/BitsPerComponent', '/Decode', '/Intent'].includes(key)) continue;
      nd.set(k, v);
    }
    nd.set(N('ColorSpace'), N('DeviceGray'));
    nd.set(N('BitsPerComponent'), PDFNumber.of(8));
    // photos that were JPEGs stay JPEGs (gray, 1 component) – as Flate they would be several times larger
    let stream = null;
    if (wasJpeg && env.encodeGrayJpeg) {
      try { stream = ctx.stream(await env.encodeGrayJpeg(px, W, H), { Filter: 'DCTDecode' }); } catch (err) { console.warn('gray jpeg', err); }
    }
    if (!stream) stream = ctx.flateStream(px);
    for (const [k, v] of nd.entries()) stream.dict.set(k, v);
    ctx.assign(ref, stream);
    stats.images++;
  }
  function filterList(d) {
    const f = d.lookup(N('Filter'));
    if (f instanceof PDFName) return [f.toString().slice(1)];
    if (f instanceof PDFArray) return Array.from({ length: f.size() }, (_, i) => f.lookup(i)?.toString().slice(1));
    return [];
  }

  // ---- streams with resources
  const doneStreams = new Set();
  async function processStream(ref, stream, resources) {
    if (doneStreams.has(stream)) return;
    doneStreams.add(stream);
    const res = L(stream.dict.get(N('Resources'))) || resources;
    await processResources(res);
    let bytes;
    try { bytes = streamBytes(stream); } catch (err) { console.warn(err); problem('stream'); return; }
    const r = rewriteContent(bytes, name => spaceName(name, res));
    r.problems.forEach(problem);
    if (r.changed && ref) replaceStream(ref, stream, r.bytes);
    stats.streams++;
  }
  function replaceStream(ref, stream, bytes) {
    const ns = ctx.flateStream(bytes);
    for (const [k, v] of stream.dict.entries()) {
      const key = k.toString();
      if (key === '/Filter' || key === '/DecodeParms' || key === '/Length') continue;
      ns.dict.set(k, v);
    }
    ctx.assign(ref, ns);
  }
  function spaceName(name, res) {
    const builtin = { DeviceRGB: 'rgb', RGB: 'rgb', DeviceCMYK: 'cmyk', CMYK: 'cmyk', DeviceGray: 'gray', G: 'gray', Pattern: 'pattern' }[name];
    if (builtin) return builtin;
    const cs = res instanceof PDFDict ? L(res.get(N('ColorSpace'))) : null;
    const v = cs instanceof PDFDict ? cs.get(N(name)) : null;
    return v ? kindOf(v) : 'bad';
  }
  const doneRes = new Set();
  async function processResources(res) {
    res = L(res);
    if (!(res instanceof PDFDict) || doneRes.has(res)) return;
    doneRes.add(res);
    const cs = L(res.get(N('ColorSpace')));
    if (cs instanceof PDFDict) for (const [, v] of cs.entries()) if (kindOf(v) === 'bad') problem('colourspace');
    const sh = L(res.get(N('Shading')));
    if (sh instanceof PDFDict) for (const [, v] of sh.entries()) if (!convertShading(L(v))) problem('shading');
    const pat = L(res.get(N('Pattern')));
    if (pat instanceof PDFDict) {
      for (const [, v] of pat.entries()) {
        const p = L(v);
        const pd = p instanceof PDFStream ? p.dict : p;
        if (!(pd instanceof PDFDict)) continue;
        const type = pd.lookup(N('PatternType'))?.asNumber?.();
        if (type === 2) { if (!convertShading(L(pd.get(N('Shading'))))) problem('shading pattern'); }
        else if (p instanceof PDFStream) await processStream(v instanceof PDFRef ? v : null, p, res);
      }
    }
    const xo = L(res.get(N('XObject')));
    if (xo instanceof PDFDict) {
      for (const [, v] of xo.entries()) {
        const x = L(v);
        if (!(x instanceof PDFStream)) continue;
        const sub = x.dict.get(N('Subtype'))?.toString();
        if (sub === '/Image') {
          if (v instanceof PDFRef) await convertImage(v, x);
          const sm = x.dict.get(N('SMask'));
          if (sm instanceof PDFRef) { const s = L(sm); if (s instanceof PDFStream) await convertImage(sm, s); }
        } else if (sub === '/Form') {
          await processStream(v instanceof PDFRef ? v : null, x, res);
          const grp = L(x.dict.get(N('Group')));
          if (grp instanceof PDFDict && grp.get(N('CS'))) grp.set(N('CS'), N('DeviceGray'));
        }
      }
    }
    const fonts = L(res.get(N('Font')));
    if (fonts instanceof PDFDict) {
      for (const [, v] of fonts.entries()) {
        const f = L(v);
        if (!(f instanceof PDFDict) || f.get(N('Subtype'))?.toString() !== '/Type3') continue;
        const procs = L(f.get(N('CharProcs')));
        const fres = L(f.get(N('Resources'))) || res;
        if (procs instanceof PDFDict) for (const [, pv] of procs.entries()) { const ps = L(pv); if (ps instanceof PDFStream) await processStream(pv instanceof PDFRef ? pv : null, ps, fres); }
      }
    }
    const gs = L(res.get(N('ExtGState')));
    if (gs instanceof PDFDict) {
      for (const [, v] of gs.entries()) {
        const g = L(v);
        const sm = g instanceof PDFDict ? L(g.get(N('SMask'))) : null;
        const grp = sm instanceof PDFDict ? sm.get(N('G')) : null;
        if (grp) { const gstr = L(grp); if (gstr instanceof PDFStream) await processStream(grp instanceof PDFRef ? grp : null, gstr, res); }
      }
    }
  }

  // ---- annotation colours
  const grayArr = arr => {
    if (!(arr instanceof PDFArray)) return null;
    const v = Array.from({ length: arr.size() }, (_, i) => arr.lookup(i)?.asNumber?.() ?? 0);
    if (v.length === 3) return ctx.obj([PDFNumber.of(+num(lum(...v)))]);
    if (v.length === 4) return ctx.obj([PDFNumber.of(+num(cmykGray(...v)))]);
    return null;
  };
  const grayDA = s => s.replace(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/g, (m, r, g, b) => `${num(lum(+r, +g, +b))} g`)
    .replace(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+k/g, (m, c, mm, y, k) => `${num(cmykGray(+c, +mm, +y, +k))} g`);
  async function processAnnot(a, pageRes) {
    for (const k of ['C', 'IC']) { const g = grayArr(a.lookup(N(k))); if (g) a.set(N(k), g); }
    const mk = a.lookup(N('MK'));
    if (mk instanceof PDFDict) for (const k of ['BG', 'BC']) { const g = grayArr(mk.lookup(N(k))); if (g) mk.set(N(k), g); }
    const da = a.lookup(N('DA'));
    if (da instanceof PDFString || da instanceof PDFHexString) a.set(N('DA'), PDFString.of(grayDA(da.decodeText())));
    const ap = a.lookup(N('AP'));
    if (!(ap instanceof PDFDict)) return;
    for (const [, v] of ap.entries()) {
      const x = L(v);
      if (x instanceof PDFStream) await processStream(v instanceof PDFRef ? v : null, x, pageRes);
      else if (x instanceof PDFDict) for (const [, sv] of x.entries()) { const s = L(sv); if (s instanceof PDFStream) await processStream(sv instanceof PDFRef ? sv : null, s, pageRes); }
    }
  }

  // ---- pages
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    pageNo = i;
    env.onProgress?.(i, pages.length);
    const page = pages[i];
    const node = page.node;
    const res = node.Resources ? node.Resources() : L(node.getInheritableAttribute(N('Resources')));
    if (res && !node.has(N('Resources'))) node.set(N('Resources'), res);
    // contents: one stream (operands and operators may be split over an array of streams)
    const contents = node.get(N('Contents'));
    const c = L(contents);
    let ref = contents instanceof PDFRef ? contents : null, stream = c instanceof PDFStream ? c : null;
    if (c instanceof PDFArray) {
      const chunks = [];
      for (let k = 0; k < c.size(); k++) { const s = c.lookup(k); if (s instanceof PDFStream) { chunks.push(streamBytes(s), enc('\n')); } }
      const total = chunks.reduce((s, x) => s + x.length, 0);
      const all = new Uint8Array(total);
      let o = 0;
      for (const x of chunks) { all.set(x, o); o += x.length; }
      stream = ctx.flateStream(all);
      ref = ctx.register(stream);
      node.set(N('Contents'), ref);
    }
    if (stream) await processStream(ref, stream, res);
    else await processResources(res);
    const grp = L(node.get(N('Group')));
    if (grp instanceof PDFDict && grp.get(N('CS'))) grp.set(N('CS'), N('DeviceGray'));
    const annots = node.lookup(N('Annots'));
    if (annots instanceof PDFArray) for (let k = 0; k < annots.size(); k++) { const a = annots.lookup(k); if (a instanceof PDFDict) await processAnnot(a, res); }
    if (i % 2 === 1) await tick();
  }
  pageNo = -1;
  // output intents describe a colour printing condition – not valid for a gray document any more
  doc.catalog.delete(N('OutputIntents'));
  return stats;
}
