// TrueType fonts for PDFs with pdf-lib, without fontkit: parse cmap/hmtx/glyf, subset the used glyphs
// (renumbered compact subset without hinting, CIDToGIDMap keeps the original ids as CIDs), embed as Type0/CIDFontType2 with Identity-H encoding
// and a ToUnicode map (text stays searchable and copyable). Used by text-to-pdf for characters that the
// 14 standard PDF fonts (WinAnsi) can't show. Font: Liberation Sans (SIL OFL), shipped with pdf.js in
// vendor/pdfjs/standard_fonts/. Parsing and subsetting live in the app's js/office/unifont.js (synced to
// lib/shared/office/); the other tools use lib/unifont.js (a ready pdf-lib PDFFont).

import { parseTtf, subsetTtf, subsetCompact, advance } from './shared/office/unifont.js';

export { parseTtf, subsetTtf, subsetCompact, advance };

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
      // compact subset (renumbered glyphs, no hinting); CIDs stay the original glyph ids via CIDToGIDMap
      const { bytes: sub, map } = subsetCompact(font, gids);
      const ff = ctx.flateStream(sub, { Length1: sub.length });
      const ffRef = ctx.register(ff);
      const maxCid = gids.length ? gids[gids.length - 1] : 0;
      const c2g = new Uint8Array((maxCid + 1) * 2);
      for (const [cidKey, g] of map) if (cidKey <= maxCid) { c2g[cidKey * 2] = g >> 8; c2g[cidKey * 2 + 1] = g & 255; }
      const c2gRef = ctx.register(ctx.flateStream(c2g));
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
        FontDescriptor: descRef, W, CIDToGIDMap: c2gRef, DW: 1000,
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
