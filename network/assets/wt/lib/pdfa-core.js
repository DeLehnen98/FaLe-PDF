// PDF/A (archive PDF, ISO 19005) for a pdf-lib document – level B ("visual appearance") of part 1, 2 or 3.
//
//   1. Analyse every page, including form XObjects, patterns, Type 3 glyphs and annotation appearances: what would
//      break PDF/A and cannot be repaired in place – fonts that are not embedded, uncalibrated CMYK colour (the output
//      intent is sRGB), LZW / JPEG 2000 / PostScript content and, for PDF/A-1, any transparency.
//   2. Such pages (or every page with method 'raster') are replaced by an sRGB image of the page with the page's
//      text as an invisible layer on top (embedded Liberation Sans) – the page looks the same and stays searchable.
//   3. Everything else is repaired in place: JavaScript, Launch & co. and additional actions removed, embedded files
//      removed (kept and labelled for PDF/A-3), annotation flags and types, form XFA / NeedAppearances, optional
//      content configuration, image Alternates/OPI/Interpolate, transfer functions; then the sRGB output intent,
//      XMP metadata with the PDF/A identification (consistent with the document information), a file ID and – for
//      PDF/A-1 – CIDSet streams for the embedded text font.
// The caller saves with `useObjectStreams: false` (PDF/A-1 forbids cross-reference streams) via savePdfA().
import { scanContent } from './pdfimages.js';
import { srgbIcc, SRGB_NAME } from './pdfa-icc.js';

const yieldNow = () => new Promise(r => setTimeout(r, 0));

// annotation subtypes PDF/A allows (part 3 additionally keeps FileAttachment)
const ANNOTS_OK = new Set(['Text', 'Link', 'FreeText', 'Line', 'Square', 'Circle', 'Polygon', 'PolyLine', 'Highlight', 'Underline',
  'Squiggly', 'StrikeOut', 'Stamp', 'Caret', 'Ink', 'Popup', 'Widget', 'PrinterMark', 'TrapNet', 'Watermark', 'Redact']);
// PDF/A-1 only knows the annotation types of PDF 1.4
const ANNOTS_OK_1 = new Set(['Text', 'Link', 'FreeText', 'Line', 'Square', 'Circle', 'Highlight', 'Underline', 'Squiggly', 'StrikeOut',
  'Stamp', 'Ink', 'Popup', 'Widget', 'PrinterMark', 'TrapNet']);
const annotAllowed = (st, part) => (part === 1 ? ANNOTS_OK_1.has(st) : ANNOTS_OK.has(st) || (part === 3 && st === 'FileAttachment'));
const ACTIONS_OK = new Set(['GoTo', 'GoToR', 'GoToE', 'Thread', 'URI', 'Named', 'SubmitForm']);
const NAMED_OK = new Set(['NextPage', 'PrevPage', 'FirstPage', 'LastPage']);

const nameOf = v => (v && typeof v.asString === 'function' ? v.asString().replace(/^\//, '') : v ? String(v).replace(/^\//, '') : '');

/**
 * Find what keeps one page from being PDF/A (content that has to be rasterised).
 * @returns {Set<string>} problem keys: font, cmyk, lzw, jpx, ps, transparency, broken, noap
 */
export function pageProblems(doc, PDFLib, page, { part }) {
  const { PDFDict, PDFArray, PDFName, PDFRawStream, PDFStream, PDFRef } = PDFLib;
  const ctx = doc.context;
  const problems = new Set();
  const seen = new Set();
  const look = v => (v instanceof PDFRef ? ctx.lookup(v) : v);
  const N = s => PDFName.of(s);

  const filters = obj => {
    const dict = obj instanceof PDFStream ? obj.dict : obj;
    const f = dict && look(dict.get(N('Filter')));
    if (!f) return [];
    return f instanceof PDFArray ? f.asArray().map(x => nameOf(look(x))) : [nameOf(f)];
  };
  const checkFilters = s => {
    const f = filters(s);
    if (f.includes('LZWDecode') || f.includes('LZW')) problems.add('lzw');
    if (f.includes('JPXDecode')) problems.add('jpx');
  };
  // deep scan of a colour space / shading / function object for DeviceCMYK
  const hasCmyk = (obj, depth = 0) => {
    obj = look(obj);
    if (!obj || depth > 8) return false;
    if (obj instanceof PDFStream) obj = obj.dict;
    if (obj instanceof PDFName) return nameOf(obj) === 'DeviceCMYK' || nameOf(obj) === 'CMYK';
    if (obj instanceof PDFArray) return obj.asArray().some(x => hasCmyk(x, depth + 1));
    if (obj instanceof PDFDict) {
      const cs = obj.get(N('ColorSpace')) ?? obj.get(N('CS'));
      return cs ? hasCmyk(cs, depth + 1) : false;
    }
    return false;
  };
  const decoded = s => {
    try {
      return s instanceof PDFRawStream ? PDFLib.decodePDFRawStream(s).decode() : s.getContents();
    } catch { problems.add('broken'); return new Uint8Array(0); }
  };
  const latin = b => { let r = ''; for (let i = 0; i < b.length; i += 8192) r += String.fromCharCode(...b.subarray(i, i + 8192)); return r; };

  const fontOk = font => {
    font = look(font);
    if (!(font instanceof PDFDict)) return true;
    const sub = nameOf(font.get(N('Subtype')));
    if (sub === 'Type3') { walkResources(font.lookup(N('Resources'))); const cp = font.lookup(N('CharProcs')); if (cp instanceof PDFDict) for (const [, v] of cp.entries()) walkStream(look(v), font.lookup(N('Resources'))); return true; }
    let fd;
    if (sub === 'Type0') {
      const d = font.lookup(N('DescendantFonts'));
      const cid = d instanceof PDFArray ? look(d.get(0)) : null;
      fd = cid instanceof PDFDict ? cid.lookup(N('FontDescriptor')) : null;
      if (cid instanceof PDFDict && !cid.has(N('CIDToGIDMap')) && nameOf(cid.get(N('Subtype'))) === 'CIDFontType2') return false;
    } else fd = font.lookup(N('FontDescriptor'));
    if (!(fd instanceof PDFDict)) return false;
    if (!['FontFile', 'FontFile2', 'FontFile3'].some(k => fd.has(N(k)))) return false;
    if (part === 1) {
      // PDF/A-1: subsets list their glyphs (Type 1: CharSet, CID fonts: CIDSet)
      const subset = /^[A-Z]{6}\+/.test(nameOf(fd.get(N('FontName'))));
      if (subset && sub === 'Type1' && fd.has(N('FontFile')) && !fd.has(N('CharSet'))) return false;
      if (subset && sub === 'Type0' && !fd.has(N('CIDSet'))) return false;
    }
    return true;
  };

  const checkGState = gs => {
    gs = look(gs);
    if (!(gs instanceof PDFDict)) return;
    for (const k of ['TR', 'TR2', 'HTO']) gs.delete(N(k)); // transfer functions / halftone origin are not allowed
    if (part === 1) {
      const sm = gs.get(N('SMask'));
      if (sm && nameOf(look(sm)) !== 'None') problems.add('transparency');
      for (const k of ['CA', 'ca']) { const v = look(gs.get(N(k))); if (v && typeof v.asNumber === 'function' && v.asNumber() < 1) problems.add('transparency'); }
      const bm = look(gs.get(N('BM')));
      const bms = bm instanceof PDFArray ? bm.asArray().map(x => nameOf(look(x))) : bm ? [nameOf(bm)] : [];
      if (bms.some(b => b !== 'Normal' && b !== 'Compatible')) problems.add('transparency');
    }
  };

  const checkImage = img => {
    const d = img.dict;
    checkFilters(img);
    for (const k of ['Alternates', 'OPI']) d.delete(N(k));
    if (d.has(N('Interpolate'))) d.set(N('Interpolate'), PDFLib.PDFBool.False);
    if (hasCmyk(d.get(N('ColorSpace')))) problems.add('cmyk');
    if (part === 1 && (d.has(N('SMask')) || d.has(N('SMaskInData')))) problems.add('transparency');
    const sm = d.lookup(N('SMask'));
    if (sm instanceof PDFStream) checkFilters(sm);
  };

  function walkStream(s, resources) {
    s = look(s);
    if (!(s instanceof PDFStream) || seen.has(s)) return;
    seen.add(s);
    checkFilters(s);
    const res = look(s.dict.get(N('Resources'))) || resources;
    if (part === 1) {
      const g = s.dict.lookup(N('Group'));
      if (g instanceof PDFDict && nameOf(g.get(N('S'))) === 'Transparency') problems.add('transparency');
    }
    if (nameOf(s.dict.get(N('Subtype2'))) === 'PS') problems.add('ps');
    for (const k of ['OPI']) s.dict.delete(N(k));
    walkResources(res);
    scanBytes(decoded(s), res);
  }

  function scanBytes(bytes, res) {
    if (!bytes.length) return;
    const csRes = res instanceof PDFDict ? res.lookup(N('ColorSpace')) : null;
    scanContent(bytes, (op, args) => {
      if (op === 'k' || op === 'K') problems.add('cmyk');
      else if ((op === 'cs' || op === 'CS') && args[0] && args[0].name) {
        const nm = args[0].name;
        if (nm === 'DeviceCMYK') problems.add('cmyk');
        else if (csRes instanceof PDFDict && hasCmyk(csRes.get(N(nm)))) problems.add('cmyk');
      }
    });
    // inline images (the scanner skips them): colour space and filters from the image dictionary
    const text = latin(bytes);
    const re = /(?:^|[\s\]>)])BI\s([\s\S]*?)\sID[\s]/g;
    let m;
    while ((m = re.exec(text))) {
      const head = m[1];
      if (/\/(?:CS|ColorSpace)\s*\/(?:CMYK|DeviceCMYK)\b/.test(head)) problems.add('cmyk');
      if (/\/(?:LZW|LZWDecode)\b/.test(head)) problems.add('lzw');
      if (/\/(?:CS|ColorSpace)\s*\/([A-Za-z0-9_.-]+)/.test(head) && csRes instanceof PDFDict) {
        const nm = head.match(/\/(?:CS|ColorSpace)\s*\/([A-Za-z0-9_.-]+)/)[1];
        if (!['G', 'RGB', 'I', 'DeviceGray', 'DeviceRGB', 'Indexed', 'CMYK', 'DeviceCMYK'].includes(nm) && hasCmyk(csRes.get(N(nm)))) problems.add('cmyk');
      }
      if (part === 1 && /\/(?:SMask)\b/.test(head)) problems.add('transparency');
      if (re.lastIndex > text.length - 4) break;
    }
  }

  function walkResources(res) {
    res = look(res);
    if (!(res instanceof PDFDict) || seen.has(res)) return;
    seen.add(res);
    const fonts = res.lookup(N('Font'));
    if (fonts instanceof PDFDict) for (const [, f] of fonts.entries()) if (!fontOk(f)) problems.add('font');
    const cs = res.lookup(N('ColorSpace'));
    if (cs instanceof PDFDict) for (const [, v] of cs.entries()) {
      const c = look(v);
      if (c instanceof PDFArray && nameOf(look(c.get(0))) === 'Pattern') continue;
      // only colour spaces that are really selected count (scanBytes); Indexed palettes with a CMYK base are used by images
    }
    const xo = res.lookup(N('XObject'));
    if (xo instanceof PDFDict) for (const [, v] of xo.entries()) {
      const x = look(v);
      if (!(x instanceof PDFStream) || seen.has(x)) continue;
      const st = nameOf(x.dict.get(N('Subtype')));
      if (st === 'Image') { seen.add(x); checkImage(x); }
      else if (st === 'Form') walkStream(x, res);
      else if (st === 'PS') problems.add('ps');
    }
    const gs = res.lookup(N('ExtGState'));
    if (gs instanceof PDFDict) for (const [, v] of gs.entries()) {
      checkGState(v);
      const g = look(v);
      const sm = g instanceof PDFDict ? look(g.get(N('SMask'))) : null;
      if (sm instanceof PDFDict) walkStream(sm.get(N('G')), res);
    }
    const pat = res.lookup(N('Pattern'));
    if (pat instanceof PDFDict) for (const [, v] of pat.entries()) {
      const p = look(v);
      if (p instanceof PDFStream) walkStream(p, res);
      else if (p instanceof PDFDict && hasCmyk(p.lookup(N('Shading')))) problems.add('cmyk');
    }
    const sh = res.lookup(N('Shading'));
    if (sh instanceof PDFDict) for (const [, v] of sh.entries()) if (hasCmyk(v)) problems.add('cmyk');
  }

  // page content
  const node = page.node;
  const res = (() => { for (let n = node, g = 0; n instanceof PDFDict && g < 64; g++) { const r = n.lookup(N('Resources')); if (r instanceof PDFDict) return r; n = n.lookup(N('Parent')); } return null; })();
  if (part === 1) {
    const g = node.lookup(N('Group'));
    if (g instanceof PDFDict && nameOf(g.get(N('S'))) === 'Transparency') problems.add('transparency');
  }
  walkResources(res);
  const contents = node.lookup(N('Contents'));
  const parts = contents instanceof PDFArray ? contents.asArray().map(look) : contents ? [contents] : [];
  // content streams can split operators across parts: scan the concatenation
  const chunks = [];
  for (const c of parts) if (c instanceof PDFStream) { checkFilters(c); chunks.push(decoded(c), new Uint8Array([10])); }
  const all = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
  let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
  scanBytes(all, res);
  // annotation appearances
  const annots = node.lookup(N('Annots'));
  if (annots instanceof PDFArray) for (const a of annots.asArray()) {
    const ad = look(a);
    if (!(ad instanceof PDFDict)) continue;
    const st = nameOf(ad.get(N('Subtype')));
    const ap = ad.lookup(N('AP'));
    const nAp = ap instanceof PDFDict ? look(ap.get(N('N'))) : null;
    if (part === 1) { const ca = look(ad.get(N('CA'))); if (ca && typeof ca.asNumber === 'function' && ca.asNumber() < 1) problems.add('transparency'); }
    if (!nAp && st !== 'Link' && st !== 'Popup' && annotAllowed(st, part)) {
      const r = ad.lookup(N('Rect'));
      const v = r instanceof PDFArray ? r.asArray().map(x => (typeof x.asNumber === 'function' ? x.asNumber() : 0)) : [0, 0, 0, 0];
      if (Math.abs(v[2] - v[0]) > 0 && Math.abs(v[3] - v[1]) > 0) problems.add('noap');
    }
    if (nAp instanceof PDFStream) walkStream(nAp, res);
    else if (nAp instanceof PDFDict) for (const [, s] of nAp.entries()) walkStream(s, res);
    if (ap instanceof PDFDict) { ap.delete(N('R')); ap.delete(N('D')); } // only the normal appearance is allowed (except buttons)
  }
  return problems;
}

// ---------------------------------------------------------------- standard fonts → embedded Liberation Sans
// Many generated PDFs (shop invoices, reports, pdf-lib/reportlab output) use Helvetica or Arial without embedding
// them. Liberation Sans has the same metrics, so such fonts are replaced by an embedded subset (simple TrueType
// font, WinAnsiEncoding, widths from the embedded program) and the text stays real vector text.
const SANS = /^(?:[A-Z]{6}\+)?(Helvetica|Arial|ArialMT)(?:[-,](Bold|Oblique|Italic|BoldOblique|BoldItalic|BoldMT|ItalicMT|BoldItalicMT))?$/;

/** @returns {Promise<number>} number of replaced font dictionaries */
export async function embedStandardSans(doc, PDFLib, { loadTtf, subset }) {
  const { PDFDict, PDFName, PDFArray, PDFNumber, PDFRef } = PDFLib;
  const ctx = doc.context;
  const N = s => PDFName.of(s);
  const look = v => (v instanceof PDFRef ? ctx.lookup(v) : v);
  const targets = [];
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || nameOf(obj.get(N('Type'))) !== 'Font') continue;
    const sub = nameOf(obj.get(N('Subtype')));
    if (sub !== 'Type1' && sub !== 'TrueType') continue;
    const m = nameOf(obj.get(N('BaseFont'))).match(SANS);
    if (!m) continue;
    const fd = obj.lookup(N('FontDescriptor'));
    if (fd instanceof PDFDict && ['FontFile', 'FontFile2', 'FontFile3'].some(k => fd.has(N(k)))) continue;
    const enc = look(obj.get(N('Encoding')));
    if (nameOf(enc) !== 'WinAnsiEncoding') continue; // other encodings: the page becomes an image instead
    const st = (m[2] || '').toLowerCase();
    targets.push({ font: obj, bold: st.includes('bold'), italic: st.includes('oblique') || st.includes('italic') });
  }
  if (!targets.length) return 0;
  const win = new TextDecoder('windows-1252');
  const files = new Map();
  for (const t of targets) {
    const key = (t.bold ? 'b' : '') + (t.italic ? 'i' : '');
    if (!files.has(key)) {
      const ttf = await loadTtf(t.bold, t.italic);
      const k = 1000 / ttf.unitsPerEm;
      const widths = [];
      const gids = new Set();
      for (let code = 32; code <= 255; code++) {
        const ch = win.decode(new Uint8Array([code]));
        const gid = ttf.cmap.get(ch.codePointAt(0)) || 0;
        if (gid) gids.add(gid);
        widths.push(gid ? Math.round(advanceOf(ttf, gid) * k) : 0);
      }
      const prog = subset(ttf, gids);
      const tag = 'FALE' + (t.bold ? 'B' : 'R') + (t.italic ? 'I' : 'N');
      const name = `${tag}+${(ttf.name || 'LiberationSans').replace(/\s+/g, '')}`;
      const file = ctx.register(ctx.flateStream(prog, { Length1: prog.length }));
      const desc = ctx.register(ctx.obj({
        Type: 'FontDescriptor', FontName: N(name), Flags: 32 | (t.italic ? 64 : 0),
        FontBBox: ttf.bbox.map(v => Math.round(v * k)), ItalicAngle: ttf.italicAngle,
        Ascent: Math.round(ttf.ascent * k), Descent: Math.round(ttf.descent * k), CapHeight: Math.round(ttf.capHeight * k),
        StemV: t.bold ? 120 : 80, FontFile2: file,
      }));
      files.set(key, { name, desc, widths });
    }
    const f = files.get(key);
    t.font.set(N('Subtype'), N('TrueType'));
    t.font.set(N('BaseFont'), N(f.name));
    t.font.set(N('FirstChar'), PDFNumber.of(32));
    t.font.set(N('LastChar'), PDFNumber.of(255));
    t.font.set(N('Widths'), ctx.obj(f.widths));
    t.font.set(N('FontDescriptor'), f.desc);
    t.font.delete(N('ToUnicode')); // WinAnsi names already give the Unicode text
    void PDFArray;
  }
  return targets.length;
}

function advanceOf(ttf, gid) {
  const { dv, tables, numHMetrics } = ttf;
  const o = tables.hmtx.offset;
  return dv.getUint16(o + Math.min(gid, numHMetrics - 1) * 4);
}

/** Replace page `idx` by an sRGB JPEG of the rendered source page plus its text as an invisible layer. */
export async function rasterPagePdfA(doc, PDFLib, srcPdf, idx, { dpi = 200, quality = 0.88, font = null, tick = yieldNow } = {}) {
  const { PDFName, PDFArray, PDFDict, PDFHexString } = PDFLib;
  const ctx = doc.context;
  const page = doc.getPage(idx);
  const jsPage = await srcPdf.getPage(idx + 1);
  const vp0 = jsPage.getViewport({ scale: 1, rotation: 0 });
  const maxPx = 24e6;
  const scale = Math.min(dpi / 72, Math.sqrt(maxPx / (vp0.width * vp0.height)));
  const vp = jsPage.getViewport({ scale, rotation: 0 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(vp.width)); canvas.height = Math.max(1, Math.floor(vp.height));
  const g = canvas.getContext('2d', { alpha: false });
  g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
  await jsPage.render({ canvasContext: g, canvas, viewport: vp, background: 'white' }).promise;
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
  canvas.width = canvas.height = 0;
  const jpg = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
  await tick();
  // invisible text: pdf.js text items (PDF user space of the original page) in Liberation Sans, render mode 3
  let text = '';
  const fontKey = 'FaleA';
  let usedFont = false;
  if (font) {
    const tc = await jsPage.getTextContent();
    const ttf = font.embedder && font.embedder.uniTtf;
    const out = ['BT', '3 Tr'];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim() || !it.transform) continue;
      const str = ttf ? [...it.str.normalize('NFC')].filter(ch => ttf.cmap.has(ch.codePointAt(0))).join('') : it.str;
      if (!str.trim()) continue;
      const [a, b, c, d, e, f] = it.transform;
      const size = Math.hypot(a, b) || 1;
      const w = font.widthOfTextAtSize(str, 1) * size;
      const tz = w > 0 && it.width > 0 ? Math.max(1, Math.min(1000, (100 * it.width) / w)) : 100;
      const hex = font.encodeText(str).toString();
      const n = v => (Math.round(v * 1000) / 1000).toString();
      out.push(`/${fontKey} 1 Tf ${n(tz)} Tz ${n(a)} ${n(b)} ${n(c)} ${n(d)} ${n(e)} ${n(f)} Tm ${hex} Tj`);
      usedFont = true;
    }
    out.push('ET');
    if (usedFont) text = out.join('\n');
  }
  const [x0, y0, x1, y1] = jsPage.view;
  jsPage.cleanup?.();
  const content = `q ${x1 - x0} 0 0 ${y1 - y0} ${x0} ${y0} cm /FaleP Do Q\n${text}`;
  const stream = ctx.flateStream(new TextEncoder().encode(content));
  page.node.set(PDFName.of('Contents'), ctx.register(stream));
  const res = ctx.obj({});
  const xo = ctx.obj({});
  xo.set(PDFName.of('FaleP'), jpg.ref);
  res.set(PDFName.of('XObject'), xo);
  if (usedFont) { const fd = ctx.obj({}); fd.set(PDFName.of(fontKey), font.ref); res.set(PDFName.of('Font'), fd); }
  page.node.set(PDFName.of('Resources'), res);
  page.node.delete(PDFName.of('Group'));
  // annotations are part of the image now – keep only links (they still work on top)
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (annots instanceof PDFArray) {
    for (let a = annots.size() - 1; a >= 0; a--) {
      const d = annots.lookup(a);
      if (!(d instanceof PDFDict) || nameOf(d.get(PDFName.of('Subtype'))) !== 'Link') annots.remove(a);
    }
  }
  void PDFHexString;
}

// ---------------------------------------------------------------- document level
const pad = (n, l = 2) => String(n).padStart(l, '0');
const pdfDate = d => `D:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}+00'00'`;
const xmpDate = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`;
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // XML 1.0 forbids most control characters
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');

function infoText(doc, PDFLib, key) {
  const info = doc.getInfoDict();
  const v = info.lookup(PDFLib.PDFName.of(key));
  if (!v) return '';
  try { return typeof v.decodeText === 'function' ? v.decodeText() : String(v); } catch { return ''; }
}
function infoDate(doc, PDFLib, key) {
  const s = infoText(doc, PDFLib, key);
  const m = s.match(/^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/);
  if (!m) return null;
  const [, y, mo = '01', d = '01', h = '00', mi = '00', se = '00', tz, th = '00', tm = '00'] = m;
  let t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
  if (tz === '+' || tz === '-') t -= (tz === '+' ? 1 : -1) * ((+th) * 60 + (+tm)) * 60000;
  const date = new Date(t);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() > 1900 ? date : null;
}

/** XMP packet with the PDF/A identification; values must equal the document information dictionary. */
export function xmpPacket({ part, title, author, subject, keywords, creator, producer, created, modified }) {
  const alt = v => `<rdf:Alt><rdf:li xml:lang="x-default">${xmlEsc(v)}</rdf:li></rdf:Alt>`;
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
   <pdfaid:part>${part}</pdfaid:part>
   <pdfaid:conformance>B</pdfaid:conformance>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:format>application/pdf</dc:format>${title ? `
   <dc:title>${alt(title)}</dc:title>` : ''}${author ? `
   <dc:creator><rdf:Seq><rdf:li>${xmlEsc(author)}</rdf:li></rdf:Seq></dc:creator>` : ''}${subject ? `
   <dc:description>${alt(subject)}</dc:description>` : ''}
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
   <pdf:Producer>${xmlEsc(producer)}</pdf:Producer>${keywords ? `
   <pdf:Keywords>${xmlEsc(keywords)}</pdf:Keywords>` : ''}
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">${creator ? `
   <xmp:CreatorTool>${xmlEsc(creator)}</xmp:CreatorTool>` : ''}
   <xmp:CreateDate>${xmpDate(created)}</xmp:CreateDate>
   <xmp:ModifyDate>${xmpDate(modified)}</xmp:ModifyDate>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
${' '.repeat(2000)}
<?xpacket end="w"?>`;
}

/**
 * Make `doc` PDF/A-<part>B.
 * @param {object} o  part (1|2|3), srcPdf (pdf.js document of the same file, for rasterising), method ('auto'|'raster'),
 *                    dpi, getFont() → Liberation Sans PDFFont of `doc`, tick, onProgress(i, n, rasterising)
 * @returns {Promise<{rasterised: number[], reasons: Object<string, number[]>, removed: Object<string, number>}>}
 */
export async function makePdfA(doc, PDFLib, { part = 2, srcPdf, method = 'auto', dpi = 200, getFont = null, fonts = null, tick = yieldNow, onProgress = () => {} } = {}) {
  const { PDFDict, PDFArray, PDFName, PDFString, PDFHexString, PDFRef, PDFStream, PDFNumber, PDFBool } = PDFLib;
  const ctx = doc.context;
  const N = s => PDFName.of(s);
  const look = v => (v instanceof PDFRef ? ctx.lookup(v) : v);
  const catalog = doc.catalog;
  const removed = { javascript: 0, actions: 0, attachments: 0, annotations: 0, xfa: 0 };

  // ---- forms: real appearances instead of "viewer, please draw them"
  const acro = catalog.lookup(N('AcroForm'));
  if (acro instanceof PDFDict) {
    if (acro.has(N('XFA'))) { acro.delete(N('XFA')); removed.xfa++; }
    const need = look(acro.get(N('NeedAppearances')));
    if (need && need.toString() === 'true') {
      // appearances in the embedded Liberation Sans (pdf-lib would use Helvetica, which is not embedded)
      const font = getFont ? await getFont().catch(() => null) : null;
      try { doc.getForm().updateFieldAppearances(font || undefined); } catch (e) { console.warn('form appearances', e); }
    }
    acro.delete(N('NeedAppearances'));
  }

  // ---- Helvetica / Arial without embedding → embedded Liberation Sans (same metrics, text stays text)
  let fontsEmbedded = 0;
  if (method !== 'raster' && fonts) {
    try { fontsEmbedded = await embedStandardSans(doc, PDFLib, fonts); } catch (e) { console.warn('pdfa fonts', e); }
  }

  // ---- pages: analyse, rasterise what cannot be repaired
  const pages = doc.getPages();
  const n = pages.length;
  const reasons = {};
  const raster = [];
  for (let i = 0; i < n; i++) {
    onProgress(i, n, false);
    let probs;
    try { probs = pageProblems(doc, PDFLib, pages[i], { part }); } catch (e) { console.warn('pdfa analyse', e); probs = new Set(['broken']); }
    if (method === 'raster') probs.add('all');
    for (const p of probs) (reasons[p] = reasons[p] || []).push(i);
    if (probs.size) raster.push(i);
    await tick();
  }
  if (raster.length) {
    const font = getFont ? await getFont().catch(e => { console.warn('pdfa font', e); return null; }) : null;
    for (let k = 0; k < raster.length; k++) {
      onProgress(k, raster.length, true);
      await rasterPagePdfA(doc, PDFLib, srcPdf, raster[k], { dpi, font, tick });
      await tick();
    }
  }

  // ---- actions and annotations
  const cleanAction = (owner, key) => {
    const a = look(owner.get(N(key)));
    if (!(a instanceof PDFDict)) return;
    const s = nameOf(a.get(N('S')));
    const ok = ACTIONS_OK.has(s) && (s !== 'Named' || NAMED_OK.has(nameOf(a.get(N('N')))));
    if (!ok) { owner.delete(N(key)); if (s === 'JavaScript') removed.javascript++; else removed.actions++; return; }
    if (a.has(N('Next'))) a.delete(N('Next'));
  };
  if (catalog.has(N('AA'))) { catalog.delete(N('AA')); removed.actions++; }
  cleanAction(catalog, 'OpenAction');
  for (const page of doc.getPages()) {
    const node = page.node;
    if (node.has(N('AA'))) { node.delete(N('AA')); removed.actions++; }
    for (const k of ['PresSteps', 'Trans', 'Dur']) node.delete(N(k));
    const annots = node.lookup(N('Annots'));
    if (!(annots instanceof PDFArray)) continue;
    for (let a = annots.size() - 1; a >= 0; a--) {
      const d = annots.lookup(a);
      if (!(d instanceof PDFDict)) { annots.remove(a); continue; }
      const st = nameOf(d.get(N('Subtype')));
      if (!annotAllowed(st, part)) { annots.remove(a); removed.annotations++; if (st === 'FileAttachment') removed.attachments++; continue; }
      if (d.has(N('AA'))) { d.delete(N('AA')); removed.actions++; }
      cleanAction(d, 'A');
      const f = look(d.get(N('F')));
      let flags = f && typeof f.asNumber === 'function' ? f.asNumber() : 0;
      flags = (flags | 4) & ~(1 | 2 | 32 | 256);
      d.set(N('F'), PDFNumber.of(flags));
      if (part === 1) d.delete(N('CA'));
      if (st === 'Widget') {
        // button widgets keep their state appearances, everything else exactly one normal appearance
        const ap = d.lookup(N('AP'));
        if (ap instanceof PDFDict) { ap.delete(N('R')); ap.delete(N('D')); }
      }
    }
  }
  // form fields: no additional actions, no JavaScript calculations
  if (acro instanceof PDFDict) {
    const walk = (arr, depth = 0) => {
      if (!(arr instanceof PDFArray) || depth > 20) return;
      for (const r of arr.asArray()) {
        const fld = look(r);
        if (!(fld instanceof PDFDict)) continue;
        if (fld.has(N('AA'))) { fld.delete(N('AA')); removed.actions++; }
        cleanAction(fld, 'A');
        walk(fld.lookup(N('Kids')), depth + 1);
      }
    };
    walk(acro.lookup(N('Fields')));
    acro.delete(N('CO'));
  }

  // ---- names: JavaScript and embedded files
  const names = catalog.lookup(N('Names'));
  if (names instanceof PDFDict) {
    if (names.has(N('JavaScript'))) { names.delete(N('JavaScript')); removed.javascript++; }
    const ef = names.lookup(N('EmbeddedFiles'));
    if (ef) {
      if (part === 3) labelAttachments(ef);
      else { names.delete(N('EmbeddedFiles')); removed.attachments++; }
    }
  }
  for (const k of ['Collection', 'Requirements', 'Perms']) catalog.delete(N(k));
  if (part !== 3) catalog.delete(N('AF'));

  function labelAttachments(tree) {
    const specs = [];
    const visit = (node, depth = 0) => {
      node = look(node);
      if (!(node instanceof PDFDict) || depth > 20) return;
      const arr = node.lookup(N('Names'));
      if (arr instanceof PDFArray) for (let i = 1; i < arr.size(); i += 2) {
        // the catalog's AF array must point at the very same file specification object: make direct ones indirect
        let v = arr.get(i);
        if (!(v instanceof PDFRef) && v instanceof PDFDict) { v = ctx.register(v); arr.set(i, v); }
        specs.push(v);
      }
      const kids = node.lookup(N('Kids'));
      if (kids instanceof PDFArray) for (const k of kids.asArray()) visit(k, depth + 1);
    };
    visit(tree);
    const af = [];
    for (const ref of specs) {
      const fs = look(ref);
      if (!(fs instanceof PDFDict)) continue;
      if (!fs.has(N('AFRelationship'))) fs.set(N('AFRelationship'), N('Unspecified'));
      const fname = fs.lookup(N('UF')) || fs.lookup(N('F'));
      if (!fs.has(N('UF')) && fname) fs.set(N('UF'), fname);
      if (!fs.has(N('F')) && fname) fs.set(N('F'), fname);
      const efd = fs.lookup(N('EF'));
      const st = efd instanceof PDFDict ? look(efd.get(N('F'))) : null;
      const efs = efd instanceof PDFDict ? [...efd.entries()].map(([, v]) => look(v)).filter(v => v instanceof PDFStream) : [];
      for (const es of efs) {
        // MIME type: pdf-lib keeps "#2f" escapes of the source literally (it would write "text#232fxml") – decode them
        let raw = nameOf(es.dict.get(N('Subtype')));
        for (let k = 0; k < 3 && /#[0-9a-f]{2}/i.test(raw); k++) raw = raw.replace(/#([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
        es.dict.set(N('Subtype'), N(/^[-\w.+]+\/[-\w.+]+$/.test(raw) ? raw : 'application/octet-stream'));
      }
      if (st instanceof PDFStream) {
        const params = st.dict.lookup(N('Params'));
        const p = params instanceof PDFDict ? params : ctx.obj({});
        if (!p.has(N('ModDate'))) p.set(N('ModDate'), PDFString.of(pdfDate(new Date())));
        st.dict.set(N('Params'), p);
      }
      af.push(ref);
    }
    if (af.length) catalog.set(N('AF'), ctx.obj(af));
  }

  // ---- optional content
  const ocp = catalog.lookup(N('OCProperties'));
  if (ocp instanceof PDFDict) {
    if (part === 1) catalog.delete(N('OCProperties'));
    else {
      const fix = (cfg, i) => {
        cfg = look(cfg);
        if (!(cfg instanceof PDFDict)) return;
        if (!cfg.has(N('Name'))) cfg.set(N('Name'), PDFString.of(i === 0 ? 'Standard' : `Ansicht ${i}`));
        cfg.delete(N('AS'));
      };
      fix(ocp.get(N('D')), 0);
      const cfgs = ocp.lookup(N('Configs'));
      if (cfgs instanceof PDFArray) cfgs.asArray().forEach((c, i) => fix(c, i + 1));
      // every optional content group needs a name
      const ocgs = ocp.lookup(N('OCGs'));
      if (ocgs instanceof PDFArray) ocgs.asArray().forEach((g, i) => { const d = look(g); if (d instanceof PDFDict && !d.has(N('Name'))) d.set(N('Name'), PDFString.of(`Ebene ${i + 1}`)); });
    }
  }

  // ---- output intent (sRGB), metadata, file identifier
  const icc = ctx.flateStream(srgbIcc(), { N: 3 });
  const oi = ctx.obj({
    Type: 'OutputIntent', S: 'GTS_PDFA1', OutputConditionIdentifier: PDFString.of(SRGB_NAME),
    Info: PDFString.of(SRGB_NAME), RegistryName: PDFString.of('http://www.color.org'), DestOutputProfile: ctx.register(icc),
  });
  catalog.set(N('OutputIntents'), ctx.obj([ctx.register(oi)]));

  const now = new Date();
  const meta = {
    part,
    title: infoText(doc, PDFLib, 'Title'), author: infoText(doc, PDFLib, 'Author'), subject: infoText(doc, PDFLib, 'Subject'),
    keywords: infoText(doc, PDFLib, 'Keywords'), creator: infoText(doc, PDFLib, 'Creator'), producer: 'FaLe Werkzeuge (fale.network)',
    created: infoDate(doc, PDFLib, 'CreationDate') || now, modified: now,
  };
  // rebuild the information dictionary with exactly the values the XMP packet has
  const info = ctx.obj({});
  const put = (k, v) => { if (v) info.set(N(k), PDFHexString.fromText(v)); };
  put('Title', meta.title); put('Author', meta.author); put('Subject', meta.subject); put('Keywords', meta.keywords); put('Creator', meta.creator);
  put('Producer', meta.producer);
  info.set(N('CreationDate'), PDFString.of(pdfDate(meta.created)));
  info.set(N('ModDate'), PDFString.of(pdfDate(meta.modified)));
  ctx.trailerInfo.Info = ctx.register(info);
  doc.pdfaMeta = meta; // savePdfA keeps pdf-lib from overwriting the info dictionary
  const xmp = ctx.stream(new TextEncoder().encode(xmpPacket(meta)), { Type: 'Metadata', Subtype: 'XML' });
  catalog.set(N('Metadata'), ctx.register(xmp));
  if (part !== 1 && !catalog.has(N('MarkInfo'))) { /* level B: tagging is optional */ }
  const id = new Uint8Array(16);
  crypto.getRandomValues(id);
  const hex = [...id].map(b => b.toString(16).padStart(2, '0')).join('');
  ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(hex), PDFHexString.of(hex)]);
  // form fields whose widgets went into a page image: without any widget left, the form is gone
  if (acro instanceof PDFDict && raster.length) {
    const widgets = doc.getPages().some(p => { const a = p.node.lookup(N('Annots')); return a instanceof PDFArray && a.asArray().some(x => { const d = look(x); return d instanceof PDFDict && nameOf(d.get(N('Subtype'))) === 'Widget'; }); });
    if (!widgets) catalog.delete(N('AcroForm'));
  }
  // stream dictionaries: no external file references (F/FFilter/FDecodeParms)
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFStream) for (const k of ['F', 'FFilter', 'FDecodeParms']) obj.dict.delete(N(k));
  }
  void PDFBool;
  const { removeUnreachable } = await import('./pdfopt.js');
  removeUnreachable(doc, PDFLib);
  return { rasterised: raster, reasons, removed, fontsEmbedded };
}

/** PDF/A-1 additionally wants a CIDSet for every embedded CID font subset (lists the glyphs that are in it). */
export async function addCidSets(doc, PDFLib) {
  const { PDFDict, PDFName, PDFArray, PDFNumber } = PDFLib;
  const ctx = doc.context;
  const N = s => PDFName.of(s);
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict) || obj.get(N('Subtype'))?.toString() !== '/CIDFontType2') continue;
    const fd = obj.lookup(N('FontDescriptor'));
    const w = obj.lookup(N('W'));
    if (!(fd instanceof PDFDict) || !(w instanceof PDFArray) || fd.has(N('CIDSet'))) continue;
    const cids = [0];
    const arr = w.asArray().map(x => ctx.lookup(x));
    for (let i = 0; i < arr.length;) {
      const first = arr[i];
      const next = arr[i + 1];
      if (first instanceof PDFNumber && next instanceof PDFArray) { next.asArray().forEach((_, k) => cids.push(first.asNumber() + k)); i += 2; }
      else if (first instanceof PDFNumber && next instanceof PDFNumber) { for (let c = first.asNumber(); c <= next.asNumber(); c++) cids.push(c); i += 3; }
      else i++;
    }
    const max = Math.max(...cids);
    const bits = new Uint8Array(Math.floor(max / 8) + 1);
    for (const c of cids) bits[c >> 3] |= 0x80 >> (c & 7);
    fd.set(N('CIDSet'), ctx.register(ctx.flateStream(bits)));
  }
}

/** Save as PDF/A: classic cross-reference table, no object streams, the information dictionary kept as built. */
export async function savePdfA(doc, PDFLib, { part }) {
  const bytes = await doc.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false, updateMetadata: false });
  // fonts and images are embedded during save: load the result once more to drop what nothing uses any more
  // (e.g. a standard font pdf-lib wrote for form appearances of a page that became an image) and – PDF/A-1 –
  // to add CIDSets from the final glyph lists
  const again = await PDFLib.PDFDocument.load(bytes, { updateMetadata: false });
  const { removeUnreachable } = await import('./pdfopt.js');
  removeUnreachable(again, PDFLib);
  if (part === 1) await addCidSets(again, PDFLib);
  again.context.trailerInfo.ID = doc.context.trailerInfo.ID;
  return again.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false, updateMetadata: false });
}
