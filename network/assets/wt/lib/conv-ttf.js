// TrueType fonts for PDFs with pdf-lib, without fontkit: parse cmap/hmtx/glyf, subset the used glyphs
// (glyph ids are kept, unused glyphs become empty), embed as Type0/CIDFontType2 with Identity-H encoding
// and a ToUnicode map (text stays searchable and copyable). Used by text-to-pdf for characters that the
// 14 standard PDF fonts (WinAnsi) can't show. Font: Liberation Sans (SIL OFL), shipped with pdf.js in
// vendor/pdfjs/standard_fonts/.

const tag = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));

export function parseTtf(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = dv.getUint16(4);
  const tables = {};
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    tables[tag(dv, o)] = { offset: dv.getUint32(o + 8), length: dv.getUint32(o + 12) };
  }
  for (const t of ['head', 'hhea', 'hmtx', 'maxp', 'cmap', 'loca', 'glyf']) if (!tables[t]) throw new Error('ttf: missing ' + t);
  const head = tables.head.offset, hhea = tables.hhea.offset;
  const font = {
    bytes: b, dv, tables,
    unitsPerEm: dv.getUint16(head + 18),
    bbox: [dv.getInt16(head + 36), dv.getInt16(head + 38), dv.getInt16(head + 40), dv.getInt16(head + 42)],
    longLoca: dv.getInt16(head + 50) === 1,
    ascent: dv.getInt16(hhea + 4), descent: dv.getInt16(hhea + 6),
    numHMetrics: dv.getUint16(hhea + 34),
    numGlyphs: dv.getUint16(tables.maxp.offset + 4),
    capHeight: 0, italicAngle: 0, fixed: false, name: 'Font',
    cmap: new Map(),
  };
  const os2 = tables['OS/2'];
  if (os2 && dv.getUint16(os2.offset) >= 2 && os2.length >= 90) font.capHeight = dv.getInt16(os2.offset + 88);
  if (!font.capHeight) font.capHeight = Math.round(font.ascent * 0.7);
  const post = tables.post;
  if (post) { font.italicAngle = dv.getInt32(post.offset + 4) / 65536; font.fixed = dv.getUint32(post.offset + 12) !== 0; }
  font.name = readName(dv, tables.name) || 'Font';
  readCmap(font);
  return font;
}

function readName(dv, t) {
  if (!t) return null;
  const o = t.offset, count = dv.getUint16(o + 2), strings = o + dv.getUint16(o + 4);
  for (let i = 0; i < count; i++) {
    const r = o + 6 + i * 12;
    const platform = dv.getUint16(r), nameId = dv.getUint16(r + 6), len = dv.getUint16(r + 8), off = dv.getUint16(r + 10);
    if (nameId !== 6) continue; // PostScript name
    let s = '';
    if (platform === 3 || platform === 0) for (let k = 0; k < len; k += 2) s += String.fromCharCode(dv.getUint16(strings + off + k));
    else for (let k = 0; k < len; k++) s += String.fromCharCode(dv.getUint8(strings + off + k));
    s = s.replace(/[^A-Za-z0-9-]/g, '');
    if (s) return s;
  }
  return null;
}

function readCmap(font) {
  const { dv, tables } = font;
  const base = tables.cmap.offset;
  const n = dv.getUint16(base + 2);
  let best = null, bestScore = -1;
  for (let i = 0; i < n; i++) {
    const p = dv.getUint16(base + 4 + i * 8), e = dv.getUint16(base + 6 + i * 8), off = dv.getUint32(base + 8 + i * 8);
    const fmt = dv.getUint16(base + off);
    const score = fmt === 12 && (p === 3 && e === 10 || p === 0) ? 3 : fmt === 4 && (p === 3 && e === 1 || p === 0) ? 2 : -1;
    if (score > bestScore) { best = base + off; bestScore = score; }
  }
  if (best == null || bestScore < 0) throw new Error('ttf: no unicode cmap');
  const map = font.cmap;
  const fmt = dv.getUint16(best);
  if (fmt === 4) {
    const segX2 = dv.getUint16(best + 6);
    const ends = best + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
    for (let s = 0; s < segX2 / 2; s++) {
      const end = dv.getUint16(ends + s * 2), start = dv.getUint16(starts + s * 2), delta = dv.getInt16(deltas + s * 2), ro = dv.getUint16(ranges + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let g;
        if (!ro) g = (c + delta) & 0xffff;
        else {
          const addr = ranges + s * 2 + ro + (c - start) * 2;
          g = dv.getUint16(addr);
          if (g) g = (g + delta) & 0xffff;
        }
        if (g) map.set(c, g);
      }
    }
  } else {
    const groups = dv.getUint32(best + 12);
    for (let i = 0; i < groups; i++) {
      const o = best + 16 + i * 12;
      const s = dv.getUint32(o), e = dv.getUint32(o + 4), g = dv.getUint32(o + 8);
      for (let c = s; c <= e && c - s < 0x10000; c++) map.set(c, g + (c - s));
    }
  }
}

export function advance(font, gid) {
  const { dv, tables, numHMetrics } = font;
  const i = Math.min(gid, numHMetrics - 1);
  return dv.getUint16(tables.hmtx.offset + i * 4);
}

function glyphRange(font, gid) {
  const { dv, tables, longLoca } = font;
  const l = tables.loca.offset;
  const a = longLoca ? dv.getUint32(l + gid * 4) : dv.getUint16(l + gid * 2) * 2;
  const b = longLoca ? dv.getUint32(l + gid * 4 + 4) : dv.getUint16(l + gid * 2 + 2) * 2;
  return [tables.glyf.offset + a, tables.glyf.offset + b];
}

/** Subset: keep glyph 0, the used glyphs and their composite parts; ids stay the same. */
export function subsetTtf(font, used) {
  const { dv, bytes } = font;
  const keep = new Set([0, ...used]);
  const queue = [...keep];
  while (queue.length) {
    const g = queue.pop();
    if (g >= font.numGlyphs) continue;
    const [a, b] = glyphRange(font, g);
    if (b - a < 10 || dv.getInt16(a) >= 0) continue;
    let p = a + 10, flags;
    do {
      flags = dv.getUint16(p);
      const comp = dv.getUint16(p + 2);
      if (!keep.has(comp)) { keep.add(comp); queue.push(comp); }
      p += 4 + (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0);
    } while (flags & 0x20);
  }
  // new glyf + long loca
  const parts = [];
  const loca = new Uint32Array(font.numGlyphs + 1);
  let off = 0;
  for (let g = 0; g < font.numGlyphs; g++) {
    loca[g] = off;
    if (!keep.has(g)) continue;
    const [a, b] = glyphRange(font, g);
    if (b > a) {
      const len = b - a, padded = (len + 3) & ~3;
      const chunk = new Uint8Array(padded);
      chunk.set(bytes.subarray(a, b));
      parts.push(chunk);
      off += padded;
    }
  }
  loca[font.numGlyphs] = off;
  const glyf = concat(parts, off);
  const locaBytes = new Uint8Array(loca.length * 4);
  const ldv = new DataView(locaBytes.buffer);
  loca.forEach((v, i) => ldv.setUint32(i * 4, v));
  const out = {};
  for (const [t, { offset, length }] of Object.entries(font.tables)) {
    if (['glyf', 'loca', 'post', 'DSIG', 'GSUB', 'GPOS', 'GDEF', 'kern', 'hdmx', 'VDMX', 'LTSH', 'gasp', 'PCLT', 'JSTF', 'BASE', 'MATH'].includes(t)) continue;
    out[t] = bytes.slice(offset, offset + length);
  }
  out.glyf = glyf;
  out.loca = locaBytes;
  // minimal post (version 3: no glyph names)
  const post = new Uint8Array(32);
  const pdv = new DataView(post.buffer);
  pdv.setUint32(0, 0x00030000);
  if (font.tables.post) post.set(bytes.subarray(font.tables.post.offset + 4, font.tables.post.offset + 16), 4);
  out.post = post;
  const head = out.head;
  const hdv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  hdv.setInt16(50, 1);          // long loca
  hdv.setUint32(8, 0);          // checkSumAdjustment, set below
  return writeSfnt(out, head);
}

function concat(parts, total) {
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function checksum(b) {
  const padded = b.length % 4 ? concat([b, new Uint8Array(4 - (b.length % 4))], b.length + 4 - (b.length % 4)) : b;
  const dv = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  let s = 0;
  for (let i = 0; i < padded.length; i += 4) s = (s + dv.getUint32(i)) >>> 0;
  return s;
}

function writeSfnt(tables, head) {
  const tags = Object.keys(tables).sort();
  const n = tags.length;
  let pow = 1, log = 0;
  while (pow * 2 <= n) { pow *= 2; log++; }
  const headerLen = 12 + 16 * n;
  let total = headerLen;
  const offsets = {};
  for (const t of tags) { offsets[t] = total; total += (tables[t].length + 3) & ~3; }
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x00010000); dv.setUint16(4, n); dv.setUint16(6, pow * 16); dv.setUint16(8, log); dv.setUint16(10, n * 16 - pow * 16);
  tags.forEach((t, i) => {
    const r = 12 + i * 16;
    for (let k = 0; k < 4; k++) out[r + k] = t.charCodeAt(k);
    dv.setUint32(r + 4, checksum(tables[t])); dv.setUint32(r + 8, offsets[t]); dv.setUint32(r + 12, tables[t].length);
    out.set(tables[t], offsets[t]);
  });
  const adj = (0xb1b0afba - checksum(out)) >>> 0;
  dv.setUint32(offsets.head + 8, adj);
  void head;
  return out;
}

const hex4 = n => n.toString(16).padStart(4, '0').toUpperCase();
const SUBSET_TAG = () => Array.from({ length: 6 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');

/**
 * A TrueType font for one PDF document. glyph(cp) → gid or 0, width(gid) in 1/1000 em,
 * encode(text) → hex string of glyph ids (marks the glyphs as used), finish() embeds the subset
 * into the reserved object number.
 */
export function ttfForDoc(pdfDoc, PDFLib, font) {
  const ref = pdfDoc.context.nextRef();
  const used = new Map(); // gid → unicode string
  const k = 1000 / font.unitsPerEm;
  return {
    ref, font,
    has: cp => font.cmap.has(cp),
    widthOf(text, size) { let w = 0; for (const ch of text) { const g = font.cmap.get(ch.codePointAt(0)) || 0; w += advance(font, g); } return (w * k * size) / 1000; },
    encode(text) {
      let hex = '';
      for (const ch of text) {
        const g = font.cmap.get(ch.codePointAt(0)) || 0;
        if (!used.has(g)) used.set(g, ch);
        hex += hex4(g);
      }
      return hex;
    },
    get usedCount() { return used.size; },
    finish() {
      const { context: ctx } = pdfDoc;
      const { PDFName, PDFString, PDFHexString } = PDFLib;
      const gids = [...used.keys()].sort((a, b) => a - b);
      const sub = subsetTtf(font, gids);
      const ff = ctx.flateStream(sub, { Length1: sub.length });
      const ffRef = ctx.register(ff);
      const name = `${SUBSET_TAG()}+${font.name}`;
      const flags = 32 | (font.fixed ? 1 : 0) | (font.italicAngle ? 64 : 0);
      const desc = ctx.obj({
        Type: 'FontDescriptor', FontName: name, Flags: flags,
        FontBBox: font.bbox.map(v => Math.round(v * k)), ItalicAngle: font.italicAngle,
        Ascent: Math.round(font.ascent * k), Descent: Math.round(font.descent * k), CapHeight: Math.round(font.capHeight * k),
        StemV: 80, FontFile2: ffRef,
      });
      const descRef = ctx.register(desc);
      const W = [];
      for (let i = 0; i < gids.length;) {
        const start = gids[i];
        const ws = [Math.round(advance(font, start) * k)];
        let j = i + 1;
        while (j < gids.length && gids[j] === gids[j - 1] + 1) { ws.push(Math.round(advance(font, gids[j]) * k)); j++; }
        W.push(start, ws);
        i = j;
      }
      const cid = ctx.obj({
        Type: 'Font', Subtype: 'CIDFontType2', BaseFont: name,
        CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Identity'), Supplement: 0 },
        FontDescriptor: descRef, W, CIDToGIDMap: 'Identity', DW: 1000,
      });
      const cidRef = ctx.register(cid);
      // ToUnicode CMap
      const lines = [];
      for (let i = 0; i < gids.length; i += 100) {
        const chunk = gids.slice(i, i + 100);
        lines.push(`${chunk.length} beginbfchar`);
        for (const g of chunk) {
          const s = used.get(g) || '';
          let u = '';
          for (let q = 0; q < s.length; q++) u += hex4(s.charCodeAt(q));
          lines.push(`<${hex4(g)}> <${u || 'FFFD'}>`);
        }
        lines.push('endbfchar');
      }
      const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${lines.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
      const tu = ctx.flateStream(new TextEncoder().encode(cmap));
      const tuRef = ctx.register(tu);
      const type0 = ctx.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: name, Encoding: 'Identity-H', DescendantFonts: [cidRef], ToUnicode: tuRef });
      ctx.assign(ref, type0);
      void PDFName; void PDFHexString;
    },
  };
}
