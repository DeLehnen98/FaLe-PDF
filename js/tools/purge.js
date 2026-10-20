// Echtes Entfernen unter abgedeckten Flächen („Abdecken“ / „Text ersetzen“ in PDF bearbeiten):
// Text, der unter einer Fläche liegt, wird aus dem Seiteninhalt gelöscht – Zeichen für Zeichen, die übrigen Zeichen
// behalten ihre Position (gelöschte Zeichen werden in TJ-Arrays durch gleich große Abstände ersetzt). Unsichtbarer
// Text (Texterkennungs-Ebene) zählt genauso. Vektorformen, die ganz unter einer Fläche liegen, werden entfernt.
// Wo das nicht sicher geht (Bilder, Formular-XObjekte mit Text, Schriften ohne bekannte Zeichenbreiten, Formularfelder
// oder Kommentare unter der Fläche), meldet purgePage() `raster: true` – der Aufrufer baut die Seite dann als Bild neu.
// Pure apart from pdf-lib objects; no DOM.

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);
const latin1 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return s; };
const toBytes = s => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };

// ------------------------------------------------------------------ tokenizer (latin1 string → operations)
function lexer(s) {
  let i = 0;
  const n = s.length;
  const skipWs = () => {
    for (;;) {
      while (i < n && WS.has(s.charCodeAt(i))) i++;
      if (i < n && s[i] === '%') { while (i < n && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
      return;
    }
  };
  function literal() { // at '('
    let depth = 0, out = '';
    for (; i < n; i++) {
      const c = s[i];
      if (c === '\\') {
        const d = s[++i];
        if (d === undefined) break;
        const map = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' };
        if (map[d] !== undefined) out += map[d];
        else if (d >= '0' && d <= '7') {
          let oct = d;
          while (oct.length < 3 && s[i + 1] >= '0' && s[i + 1] <= '7') oct += s[++i];
          out += String.fromCharCode(parseInt(oct, 8) & 255);
        } else if (d === '\r') { if (s[i + 1] === '\n') i++; } else if (d === '\n') { /* line continuation */ } else out += d;
        continue;
      }
      if (c === '(') { depth++; if (depth === 1) continue; }
      if (c === ')') { depth--; if (depth === 0) { i++; break; } }
      out += c;
    }
    return { t: 'str', v: out };
  }
  function hex() { // at '<'
    const j = s.indexOf('>', i);
    const h = s.slice(i + 1, j < 0 ? n : j).replace(/[^0-9a-fA-F]/g, '');
    i = j < 0 ? n : j + 1;
    let out = '';
    for (let k = 0; k < h.length; k += 2) out += String.fromCharCode(parseInt((h[k] + (h[k + 1] || '0')), 16));
    return { t: 'str', v: out };
  }
  function value() {
    skipWs();
    if (i >= n) return null;
    const start = i;
    const c = s[i];
    let v;
    if (c === '(') v = literal();
    else if (c === '<' && s[i + 1] === '<') {
      i += 2;
      const entries = [];
      for (;;) {
        skipWs();
        if (i >= n) break;
        if (s[i] === '>' && s[i + 1] === '>') { i += 2; break; }
        const k = value();
        if (!k) break;
        const vs = i;
        const val = value();
        entries.push({ key: k.t === 'name' ? k.v : '', raw: s.slice(vs, i), val });
      }
      v = { t: 'dict', entries };
    } else if (c === '<') v = hex();
    else if (c === '[') {
      i++;
      const items = [];
      for (;;) {
        skipWs();
        if (i >= n || s[i] === ']') { i++; break; }
        const x = value();
        if (!x) break;
        items.push(x);
      }
      v = { t: 'arr', items };
    } else if (c === '/') {
      i++;
      const b = i;
      while (i < n && !WS.has(s.charCodeAt(i)) && !DELIM.has(s.charCodeAt(i))) i++;
      v = { t: 'name', v: s.slice(b, i).replace(/#([0-9a-fA-F]{2})/g, (m, x) => String.fromCharCode(parseInt(x, 16))) };
    } else if (c === ')' || c === '>' || c === ']' || c === '}' || c === '{') { i++; v = { t: 'junk' }; } else {
      const b = i;
      while (i < n && !WS.has(s.charCodeAt(i)) && !DELIM.has(s.charCodeAt(i))) i++;
      const w = s.slice(b, i);
      if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) v = { t: 'num', v: parseFloat(w) };
      else if (w === 'true' || w === 'false') v = { t: 'bool', v: w === 'true' };
      else if (w === 'null') v = { t: 'null' };
      else v = { t: 'op', v: w };
    }
    v.start = start; v.end = i;
    return v;
  }
  return {
    value,
    get pos() { return i; },
    set pos(p) { i = p; },
    skipWs,
    /** after the ID operator of an inline image: skip the binary data up to EI */
    skipInlineImage() {
      i++; // the single white-space after ID
      for (let k = i; k < n - 1; k++) {
        if (s[k] === 'E' && s[k + 1] === 'I' && (k === 0 || WS.has(s.charCodeAt(k - 1))) && (k + 2 >= n || WS.has(s.charCodeAt(k + 2)) || DELIM.has(s.charCodeAt(k + 2)))) { i = k + 2; return; }
      }
      i = n;
    },
  };
}

export function parseOps(s) {
  const lx = lexer(s);
  const ops = [];
  let operands = [];
  for (;;) {
    const v = lx.value();
    if (!v) break;
    if (v.t !== 'op') { operands.push(v); continue; }
    const start = operands.length ? operands[0].start : v.start;
    if (v.v === 'BI') { // inline image: BI … ID <data> EI – one operation
      for (;;) { const x = lx.value(); if (!x || (x.t === 'op' && x.v === 'ID')) break; }
      lx.skipInlineImage();
      ops.push({ op: 'BI', args: [], start, end: lx.pos });
    } else ops.push({ op: v.v, args: operands, start, end: v.end });
    operands = [];
  }
  return ops;
}

// ------------------------------------------------------------------ geometry
const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
const ap = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const inside = (r, x, y, pad = 0.5) => x >= r.x0 - pad && x <= r.x1 + pad && y >= r.y0 - pad && y <= r.y1 + pad;
const boxOf = pts => ({ x0: Math.min(...pts.map(p => p[0])), y0: Math.min(...pts.map(p => p[1])), x1: Math.max(...pts.map(p => p[0])), y1: Math.max(...pts.map(p => p[1])) });
const overlaps = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5;
const within = (a, r, pad = 0.75) => a.x0 >= r.x0 - pad && a.x1 <= r.x1 + pad && a.y0 >= r.y0 - pad && a.y1 <= r.y1 + pad;

// ------------------------------------------------------------------ fonts → glyph widths (1/1000 em)
const STD = { Helvetica: 'Helvetica', 'Helvetica-Bold': 'HelveticaBold', 'Helvetica-Oblique': 'HelveticaOblique', 'Helvetica-BoldOblique': 'HelveticaBoldOblique',
  'Times-Roman': 'TimesRoman', 'Times-Bold': 'TimesRomanBold', 'Times-Italic': 'TimesRomanItalic', 'Times-BoldItalic': 'TimesRomanBoldItalic',
  Courier: 'Courier', 'Courier-Bold': 'CourierBold', 'Courier-Oblique': 'CourierOblique', 'Courier-BoldOblique': 'CourierBoldOblique',
  Arial: 'Helvetica', ArialMT: 'Helvetica', 'Arial-BoldMT': 'HelveticaBold', 'Arial,Bold': 'HelveticaBold', TimesNewRoman: 'TimesRoman', TimesNewRomanPSMT: 'TimesRoman', CourierNew: 'Courier', CourierNewPSMT: 'Courier' };
let cp1252 = null;
function winAnsiChar(code) {
  if (!cp1252) { try { cp1252 = new TextDecoder('windows-1252'); } catch { cp1252 = null; } }
  return cp1252 ? cp1252.decode(new Uint8Array([code])) : String.fromCharCode(code);
}

async function fontInfo(PDFLib, dict, stdCache) {
  const { PDFName, PDFArray, PDFNumber, PDFDict } = PDFLib;
  if (!(dict instanceof PDFDict)) return null;
  const name = k => { const x = dict.lookup(PDFName.of(k)); return x && x.decodeText ? x.decodeText() : x ? String(x).replace(/^\//, '') : ''; };
  const num = x => (x instanceof PDFNumber ? x.asNumber() : typeof x === 'number' ? x : NaN);
  const sub = name('Subtype');
  if (sub === 'Type0') {
    const enc = name('Encoding');
    if (enc !== 'Identity-H') return null; // vertical writing / other CMaps: positions unknown
    const df = dict.lookup(PDFName.of('DescendantFonts'));
    const d = df instanceof PDFArray ? df.lookup(0) : null;
    if (!(d instanceof PDFDict)) return null;
    const dw = num(d.lookup(PDFName.of('DW')));
    const map = new Map();
    const w = d.lookup(PDFName.of('W'));
    if (w instanceof PDFArray) {
      for (let k = 0; k < w.size();) {
        const first = num(w.lookup(k));
        const nx = w.lookup(k + 1);
        if (nx instanceof PDFArray) { for (let j = 0; j < nx.size(); j++) map.set(first + j, num(nx.lookup(j))); k += 2; } else { const last = num(nx); const val = num(w.lookup(k + 2)); for (let c = first; c <= last && c - first < 70000; c++) map.set(c, val); k += 3; }
      }
    }
    return { bytes: 2, width: c => (map.has(c) ? map.get(c) : Number.isFinite(dw) ? dw : 1000), space: false };
  }
  let scale = 1;
  if (sub === 'Type3') {
    const fm = dict.lookup(PDFName.of('FontMatrix'));
    scale = fm instanceof PDFArray ? num(fm.lookup(0)) * 1000 : 1;
    if (!Number.isFinite(scale)) return null;
  }
  const widths = dict.lookup(PDFName.of('Widths'));
  if (widths instanceof PDFArray) {
    const first = num(dict.lookup(PDFName.of('FirstChar'))) || 0;
    let missing = 0;
    const fd = dict.lookup(PDFName.of('FontDescriptor'));
    if (fd instanceof PDFDict) { const mw = num(fd.lookup(PDFName.of('MissingWidth'))); if (Number.isFinite(mw)) missing = mw; }
    const arr = []; for (let k = 0; k < widths.size(); k++) arr.push(num(widths.lookup(k)));
    return { bytes: 1, width: c => { const v = arr[c - first]; return (Number.isFinite(v) ? v : missing) * scale; }, space: true };
  }
  // standard 14 fonts (no /Widths): metrics from pdf-lib's built-in AFM data
  const base = name('BaseFont').replace(/^[A-Z]{6}\+/, '');
  const std = STD[base];
  if (!std || sub === 'Type3') return null;
  if (!stdCache.has(std)) {
    const tmp = await PDFLib.PDFDocument.create();
    stdCache.set(std, await tmp.embedFont(PDFLib.StandardFonts[std]));
  }
  const f = stdCache.get(std);
  const cache = new Map();
  return { bytes: 1, space: true, width: c => { if (!cache.has(c)) { let w = 500; try { w = f.widthOfTextAtSize(winAnsiChar(c), 1000); } catch { /* not encodable */ } cache.set(c, w); } return cache.get(c); } };
}

// ------------------------------------------------------------------ one content stream
/**
 * Remove what lies under `rects` from a content stream.
 * @param {string} s  content (latin1)
 * @param {object} env {PDFLib, resources (PDFDict), ctm0, rects, fonts: Map, stdCache, xobj: (name, ctm) => Promise<'keep'|'raster'|{replace}>}
 * @returns {Promise<{out: string, removed: number, raster: boolean}>}
 */
async function purgeStream(s, env) {
  const { PDFLib, rects } = env;
  const { PDFName, PDFDict } = PDFLib;
  const ops = parseOps(s);
  let ctm = env.ctm0.slice();
  const stack = [];
  let ts = null; // text state inside BT
  let tf = { font: null, size: 0, tc: 0, tw: 0, th: 1, tl: 0, rise: 0 };
  const tfStack = [];
  let removed = 0, raster = false;
  const out = [];
  let prev = 0;
  let pathStart = -1, pathPts = [], pathClip = false;
  const replace = (op, text) => { out.push(s.slice(prev, op.start), text); prev = op.end; };
  const drop = (from, to) => { out.push(s.slice(prev, from)); prev = to; };
  const fontsRes = env.resources && env.resources.lookup(PDFName.of('Font'));
  const getFont = async nm => {
    const key = nm;
    if (env.fonts.has(key)) return env.fonts.get(key);
    let info = null;
    try { const d = fontsRes instanceof PDFDict ? fontsRes.lookup(PDFName.of(nm)) : null; info = await fontInfo(PDFLib, d, env.stdCache); } catch { info = null; }
    env.fonts.set(key, info);
    return info;
  };
  const hexOf = str => '<' + [...str].map(ch => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('') + '>';

  /** run a show operation; returns the replacement TJ array text or null when nothing was removed */
  async function show(parts) {
    const f = tf.font ? await getFont(tf.font) : null;
    const trm = () => mul([tf.size * tf.th, 0, 0, tf.size, 0, tf.rise], mul(ts.tm, ctm));
    if (!f || !tf.size) {
      // unknown widths: if the run may start inside a covered area, the page must be rebuilt as an image
      const [x, y] = ap(trm(), 0, 0.3);
      if (rects.some(r => y >= r.y0 - tf.size && y <= r.y1 + tf.size)) raster = true;
      // still advance roughly so later runs stay plausible
      return null;
    }
    const outParts = [];
    let changed = false;
    let cur = '';
    const flush = () => { if (cur) { outParts.push(hexOf(cur)); cur = ''; } };
    for (const p of parts) {
      if (p.t === 'num') { flush(); outParts.push(String(p.v)); ts.tm = mul([1, 0, 0, 1, -p.v / 1000 * tf.size * tf.th, 0], ts.tm); continue; }
      if (p.t !== 'str') continue;
      const str = p.v;
      for (let k = 0; k + f.bytes <= str.length; k += f.bytes) {
        const code = f.bytes === 2 ? (str.charCodeAt(k) << 8) | str.charCodeAt(k + 1) : str.charCodeAt(k);
        const w0 = f.width(code) || 0;
        const spc = f.space && f.bytes === 1 && code === 32 ? tf.tw : 0;
        const adv = (w0 / 1000 * tf.size + tf.tc + spc) * tf.th;
        const m = trm();
        const [cx, cy] = ap(m, Math.max(w0, 250) / 2000, 0.3);
        const hit = rects.some(r => inside(r, cx, cy));
        if (hit) {
          flush();
          changed = true; removed++;
          outParts.push(String(Math.round(-(adv / tf.th) * 1000 / tf.size * 1000) / 1000));
        } else cur += str.slice(k, k + f.bytes);
        ts.tm = mul([1, 0, 0, 1, adv, 0], ts.tm);
      }
      flush();
    }
    return changed ? '[' + outParts.join(' ') + '] TJ' : null;
  }

  for (const op of ops) {
    const a = op.args;
    const nums = a.map(x => (x.t === 'num' ? x.v : 0));
    switch (op.op) {
      case 'q': stack.push(ctm.slice()); tfStack.push({ ...tf }); break;
      case 'Q': if (stack.length) ctm = stack.pop(); if (tfStack.length) tf = tfStack.pop(); break;
      case 'cm': if (a.length === 6) ctm = mul(nums, ctm); break;
      case 'BT': ts = { tm: [1, 0, 0, 1, 0, 0], tlm: [1, 0, 0, 1, 0, 0] }; break;
      case 'ET': ts = null; break;
      case 'Tf': tf.font = a[0] && a[0].t === 'name' ? a[0].v : null; tf.size = nums[1] || 0; break;
      case 'Tc': tf.tc = nums[0]; break;
      case 'Tw': tf.tw = nums[0]; break;
      case 'Tz': tf.th = (nums[0] || 100) / 100; break;
      case 'TL': tf.tl = nums[0]; break;
      case 'Ts': tf.rise = nums[0]; break;
      case 'Td': if (ts) { ts.tlm = mul([1, 0, 0, 1, nums[0], nums[1]], ts.tlm); ts.tm = ts.tlm.slice(); } break;
      case 'TD': if (ts) { tf.tl = -nums[1]; ts.tlm = mul([1, 0, 0, 1, nums[0], nums[1]], ts.tlm); ts.tm = ts.tlm.slice(); } break;
      case 'Tm': if (ts && a.length === 6) { ts.tlm = nums.slice(); ts.tm = nums.slice(); } break;
      case 'T*': if (ts) { ts.tlm = mul([1, 0, 0, 1, 0, -tf.tl], ts.tlm); ts.tm = ts.tlm.slice(); } break;
      case 'Tj': case 'TJ': case "'": case '"': {
        if (!ts) break;
        let pre = '';
        if (op.op === '"') { tf.tw = nums[0]; tf.tc = nums[1]; pre = `${nums[0]} Tw ${nums[1]} Tc `; }
        if (op.op === "'" || op.op === '"') { ts.tlm = mul([1, 0, 0, 1, 0, -tf.tl], ts.tlm); ts.tm = ts.tlm.slice(); pre += 'T* '; }
        const last = a[a.length - 1];
        const parts = !last ? [] : last.t === 'arr' ? last.items : [last];
        const rep = await show(parts);
        if (rep) replace(op, pre + rep);
        break;
      }
      // paths: drop shapes that lie completely under a covered area
      case 'm': case 'l': case 'c': case 'v': case 'y': case 're': case 'h': {
        if (pathStart < 0) { pathStart = op.start; pathPts = []; pathClip = false; }
        if (op.op === 're' && a.length === 4) { const [x, y, w, hh] = nums; pathPts.push(ap(ctm, x, y), ap(ctm, x + w, y), ap(ctm, x, y + hh), ap(ctm, x + w, y + hh)); } else for (let k = 0; k + 1 < nums.length; k += 2) pathPts.push(ap(ctm, nums[k], nums[k + 1]));
        break;
      }
      case 'W': case 'W*': pathClip = true; break;
      case 'S': case 's': case 'f': case 'F': case 'f*': case 'B': case 'B*': case 'b': case 'b*': case 'n': {
        if (pathStart >= 0 && op.op !== 'n' && !pathClip && pathPts.length && pathStart >= prev) {
          const bb = boxOf(pathPts);
          if (rects.some(r => within(bb, r))) { drop(pathStart, op.end); removed++; }
        }
        pathStart = -1; pathPts = []; pathClip = false;
        break;
      }
      case 'Do': {
        const nm = a[0] && a[0].t === 'name' ? a[0].v : null;
        if (!nm) break;
        const r = await env.xobj(nm, ctm);
        if (r === 'raster') raster = true;
        else if (r && typeof r === 'object' && r.replace) replace(op, r.replace);
        break;
      }
      case 'BI': {
        const bb = boxOf([ap(ctm, 0, 0), ap(ctm, 1, 0), ap(ctm, 0, 1), ap(ctm, 1, 1)]);
        if (rects.some(r => overlaps(bb, r))) raster = true;
        break;
      }
      case 'sh': raster = raster || false; break;
      default: break;
    }
  }
  out.push(s.slice(prev));
  return { out: out.join(''), removed, raster };
}

// strip /ActualText, /Alt and /E from marked-content property lists (they can repeat removed text)
function stripActualText(s) {
  const ops = parseOps(s);
  const out = [];
  let prev = 0;
  for (const op of ops) {
    if ((op.op === 'BDC' || op.op === 'DP') && op.args[1] && op.args[1].t === 'dict' && op.args[1].entries.some(e => /^(ActualText|Alt|E)$/.test(e.key))) {
      const keep = op.args[1].entries.filter(e => !/^(ActualText|Alt|E)$/.test(e.key)).map(e => `/${e.key} ${e.raw.trim()}`).join(' ');
      out.push(s.slice(prev, op.start), `/${op.args[0].v} <<${keep}>> ${op.op}`);
      prev = op.end;
    }
  }
  out.push(s.slice(prev));
  return out.join('');
}

/**
 * Remove the content under `rects` (PDF user space of the page) from one page of a pdf-lib document.
 * @returns {Promise<{removed: number, raster: boolean}>} raster = the caller must rebuild the page as an image
 */
export async function purgePage(PDFLib, pdfDoc, page, rects) {
  const { PDFName, PDFArray, PDFDict, PDFRawStream, PDFStream, PDFNumber, decodePDFRawStream } = PDFLib;
  const ctx = pdfDoc.context;
  const node = page.node;
  if (!rects.length) return { removed: 0, raster: false };
  // annotations (comments, form fields) under a covered area: only an image of the page is safe
  const annots = node.lookup(PDFName.of('Annots'));
  if (annots instanceof PDFArray) {
    for (let k = 0; k < annots.size(); k++) {
      const an = annots.lookup(k);
      const r = an instanceof PDFDict ? an.lookup(PDFName.of('Rect')) : null;
      if (!(r instanceof PDFArray) || r.size() < 4) continue;
      const v = [0, 1, 2, 3].map(j => { const x = r.lookup(j); return x instanceof PDFNumber ? x.asNumber() : 0; });
      const bb = { x0: Math.min(v[0], v[2]), y0: Math.min(v[1], v[3]), x1: Math.max(v[0], v[2]), y1: Math.max(v[1], v[3]) };
      if (rects.some(rr => overlaps(bb, rr))) return { removed: 0, raster: true };
    }
  }
  const streamText = st => {
    if (st instanceof PDFRawStream) return latin1(decodePDFRawStream(st).decode());
    if (st instanceof PDFStream && st.getContents) return latin1(st.getContents());
    return '';
  };
  const contents = node.lookup(PDFName.of('Contents'));
  const list = contents instanceof PDFArray ? Array.from({ length: contents.size() }, (_, k) => contents.lookup(k)) : contents ? [contents] : [];
  const src = list.map(streamText).join('\n');
  const resources = node.Resources ? node.Resources() : node.lookup(PDFName.of('Resources'));
  const stdCache = new Map();
  let newXObjects = null; // name → new ref (copies of form XObjects with content removed)
  const xres = resources instanceof PDFDict ? resources.lookup(PDFName.of('XObject')) : null;

  // how many pages use a form XObject (through their own or inherited resources)
  const usesOf = ref => {
    let n = 0;
    for (const pg of pdfDoc.getPages()) {
      const res = pg.node.Resources ? pg.node.Resources() : null;
      const xd = res instanceof PDFDict ? res.lookup(PDFName.of('XObject')) : null;
      if (xd instanceof PDFDict && [...xd.values()].some(v => v instanceof PDFLib.PDFRef && v.tag === ref.tag)) n++;
    }
    return n;
  };
  const makeEnv = (res, ctm0, depth) => ({
    PDFLib, resources: res, ctm0, rects, fonts: new Map(), stdCache,
    async xobj(name, ctm) {
      const xd = res instanceof PDFDict ? res.lookup(PDFName.of('XObject')) : null;
      const x = xd instanceof PDFDict ? xd.lookup(PDFName.of(name)) : null;
      if (!(x instanceof PDFStream)) return 'keep';
      const sub = x.dict.lookup(PDFName.of('Subtype'));
      const subName = sub ? String(sub).replace(/^\//, '') : '';
      if (subName === 'Image') {
        const bb = boxOf([ap(ctm, 0, 0), ap(ctm, 1, 0), ap(ctm, 0, 1), ap(ctm, 1, 1)]);
        return rects.some(r => overlaps(bb, r)) ? 'raster' : 'keep';
      }
      if (subName !== 'Form') return 'keep';
      const mtx = x.dict.lookup(PDFName.of('Matrix'));
      const m = mtx instanceof PDFArray ? [0, 1, 2, 3, 4, 5].map(j => { const v = mtx.lookup(j); return v instanceof PDFNumber ? v.asNumber() : 0; }) : [1, 0, 0, 1, 0, 0];
      const fctm = mul(m, ctm);
      const bbox = x.dict.lookup(PDFName.of('BBox'));
      if (bbox instanceof PDFArray) {
        const v = [0, 1, 2, 3].map(j => { const q = bbox.lookup(j); return q instanceof PDFNumber ? q.asNumber() : 0; });
        const bb = boxOf([ap(fctm, v[0], v[1]), ap(fctm, v[2], v[1]), ap(fctm, v[0], v[3]), ap(fctm, v[2], v[3])]);
        if (!rects.some(r => overlaps(bb, r))) return 'keep';
      }
      if (depth >= 3) return 'raster';
      const fres = x.dict.lookup(PDFName.of('Resources'));
      const r = await purgeStream(streamText(x), makeEnv(fres instanceof PDFDict ? fres : res, fctm, depth + 1));
      if (r.raster) return 'raster';
      if (!r.removed) return 'keep';
      if (depth > 0) return 'raster'; // nested copies would need their own resource rewiring
      // the cleaned form: in place when only this page uses it (so the old content leaves the file), else a copy
      const dict = x.dict.clone(ctx);
      ['Filter', 'DecodeParms', 'Length'].forEach(k => dict.delete(PDFName.of(k)));
      const copy = ctx.flateStream(toBytes(stripActualText(r.out)), {});
      for (const [k, v] of dict.entries()) copy.dict.set(k, v);
      const origRef = xd.get(PDFName.of(name));
      if (origRef instanceof PDFLib.PDFRef && usesOf(origRef) <= 1) { ctx.assign(origRef, copy); return 'keep'; }
      const ref = ctx.register(copy);
      const nn = `FaLeP${(newXObjects ? newXObjects.size : 0) + 1}`;
      if (!newXObjects) newXObjects = new Map();
      newXObjects.set(nn, ref);
      return { replace: `/${nn} Do` };
    },
  });
  const r = await purgeStream(src, makeEnv(resources, [1, 0, 0, 1, 0, 0], 0));
  if (r.raster) return { removed: r.removed, raster: true };
  if (!r.removed) return { removed: 0, raster: false };
  node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(toBytes(stripActualText(r.out)))));
  if (newXObjects) {
    // this page gets its own resources dict with the cleaned form copies
    const res2 = resources instanceof PDFDict ? resources.clone(ctx) : ctx.obj({});
    const x2 = xres instanceof PDFDict ? xres.clone(ctx) : ctx.obj({});
    for (const [nm, ref] of newXObjects) x2.set(PDFName.of(nm), ref);
    res2.set(PDFName.of('XObject'), x2);
    node.set(PDFName.of('Resources'), res2);
  }
  return { removed: r.removed, raster: false };
}

export const _test = { parseOps, purgeStream, stripActualText };
