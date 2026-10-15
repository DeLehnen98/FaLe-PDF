// GENERATED – synced copy of js/office/unifont.js (app imports → lib/conv-office-shim.js, vendor paths re-based) by scripts/sync-webtools-vendor.mjs.
// Do not edit here: change the source in the app and run `node scripts/sync-webtools-vendor.mjs`.
// Unicode text for PDFs made with pdf-lib – without fontkit. The 14 standard PDF fonts only know WinAnsi
// (Western European); for everything else (Polish ł, Hungarian ő, Turkish ş ğ İ, Romanian ș, Greek, Cyrillic …)
// Liberation Sans (SIL OFL, shipped with pdf.js in vendor/pdfjs/standard_fonts/) is embedded as a subset:
// parse cmap/hmtx/glyf, keep only the used glyphs (ids stay the same, unused glyphs become empty) and write a
// Type0/CIDFontType2 font with Identity-H encoding and a ToUnicode map, so the text stays searchable and
// copyable. The font object is a real pdf-lib PDFFont: page.drawText, widthOfTextAtSize, heightAtSize and
// form field appearances (field.updateAppearances(font)) work unchanged. Glyphs are collected while drawing;
// the subset is written when the document is saved (and rewritten in place if it is saved again).
//
// Not covered by the font (reported by cleanText as `missing`): Chinese/Japanese/Korean, Arabic, Hebrew,
// Indic scripts, emoji … – no shaping, no right-to-left reordering.

const tag = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));

// ---------------------------------------------------------------- TrueType parsing
export function parseTtf(bytes) {
  // a plain Uint8Array (a Node Buffer's slice() would share memory instead of copying)
  const b = bytes instanceof Uint8Array && bytes.constructor === Uint8Array ? bytes : new Uint8Array(bytes);
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
    typoAscent: 0, typoDescent: 0,
    cmap: new Map(),
  };
  const os2 = tables['OS/2'];
  if (os2 && os2.length >= 72) { font.typoAscent = dv.getInt16(os2.offset + 68); font.typoDescent = dv.getInt16(os2.offset + 70); }
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
    if (['glyf', 'loca', 'post', 'DSIG', 'GSUB', 'GPOS', 'GDEF', 'kern', 'hdmx', 'VDMX', 'LTSH', 'gasp', 'PCLT', 'JSTF', 'BASE', 'MATH', 'FFTM', 'name'].includes(t)) continue;
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
  hdv.setUint32(8, 0);          // checkSumAdjustment, set in writeSfnt
  return writeSfnt(out);
}

/** Left side bearing of a glyph (hmtx long metrics, then the lsb array). */
function lsbOf(font, gid) {
  const { dv, tables, numHMetrics } = font;
  const o = tables.hmtx.offset;
  return gid < numHMetrics ? dv.getInt16(o + gid * 4 + 2) : dv.getInt16(o + numHMetrics * 4 + (gid - numHMetrics) * 2);
}

/** Glyph ids `used` plus glyph 0 plus composite parts, sorted. */
function closure(font, used) {
  const { dv } = font;
  const keep = new Set([0, ...used].filter(g => g < font.numGlyphs));
  const queue = [...keep];
  while (queue.length) {
    const g = queue.pop();
    const [a, b] = glyphRange(font, g);
    if (b - a < 10 || dv.getInt16(a) >= 0) continue;
    let p = a + 10, flags;
    do {
      flags = dv.getUint16(p);
      const comp = dv.getUint16(p + 2);
      if (!keep.has(comp) && comp < font.numGlyphs) { keep.add(comp); queue.push(comp); }
      p += 4 + (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0);
    } while (flags & 0x20);
  }
  return [...keep].sort((x, y) => x - y);
}

/** Glyph data without hinting instructions; composite parts renumbered with `map` (old → new id). */
function strippedGlyph(font, gid, map) {
  const { dv, bytes } = font;
  const [a, b] = glyphRange(font, gid);
  if (b - a < 10) return new Uint8Array(0);
  const n = dv.getInt16(a);
  if (n >= 0) {
    const insLenAt = a + 10 + n * 2;
    const insLen = dv.getUint16(insLenAt);
    const out = new Uint8Array(b - a - insLen);
    out.set(bytes.subarray(a, insLenAt + 2));
    out[insLenAt - a] = 0; out[insLenAt - a + 1] = 0;
    out.set(bytes.subarray(insLenAt + 2 + insLen, b), insLenAt + 2 - a);
    return out;
  }
  let p = a + 10, flags;
  do {
    flags = dv.getUint16(p);
    p += 4 + (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0);
  } while (flags & 0x20);
  const out = bytes.slice(a, p);
  const odv = new DataView(out.buffer);
  let q = 10;
  do {
    flags = odv.getUint16(q);
    odv.setUint16(q, flags & ~0x100); // WE_HAVE_INSTRUCTIONS off
    odv.setUint16(q + 2, map.get(odv.getUint16(q + 2)) || 0);
    q += 4 + (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0);
  } while (flags & 0x20);
  return out;
}

/**
 * Compact subset for PDF embedding: only the used glyphs (+ glyph 0 and composite parts), renumbered
 * 0…n-1, without hinting (fpgm/prep/cvt and glyph instructions – PDF viewers render unhinted outlines fine)
 * and with a minimal cmap (PDF text uses glyph ids through CIDToGIDMap). Returns {bytes, map: old → new id}.
 */
export function subsetCompact(font, used) {
  const { dv, bytes } = font;
  const gids = closure(font, used);
  const map = new Map(gids.map((g, i) => [g, i]));
  const n = gids.length;
  const parts = [];
  const loca = new Uint8Array((n + 1) * 4), ldv = new DataView(loca.buffer);
  const hmtx = new Uint8Array(n * 4), hdv = new DataView(hmtx.buffer);
  let off = 0;
  gids.forEach((g, i) => {
    ldv.setUint32(i * 4, off);
    hdv.setUint16(i * 4, advance(font, g)); hdv.setInt16(i * 4 + 2, lsbOf(font, g));
    const glyph = strippedGlyph(font, g, map);
    if (glyph.length) {
      const padded = new Uint8Array((glyph.length + 3) & ~3);
      padded.set(glyph);
      parts.push(padded); off += padded.length;
    }
  });
  ldv.setUint32(n * 4, off);
  const t = name => new Uint8Array(bytes.subarray(font.tables[name].offset, font.tables[name].offset + font.tables[name].length));
  const head = t('head');
  const headDv = new DataView(head.buffer);
  headDv.setUint32(8, 0); headDv.setInt16(50, 1);
  const hhea = t('hhea');
  new DataView(hhea.buffer).setUint16(34, n);
  const maxp = t('maxp');
  const mdv = new DataView(maxp.buffer);
  mdv.setUint16(4, n);
  if (maxp.length >= 32) { mdv.setUint16(14, 1); mdv.setUint16(16, 0); mdv.setUint16(18, 0); mdv.setUint16(20, 0); mdv.setUint16(26, 0); } // no hinting: zones, twilight, storage, fdefs, instr. size
  // minimal cmap: format 4 with only the terminating segment
  const cmap = new Uint8Array([0, 0, 0, 1, 0, 3, 0, 1, 0, 0, 0, 12, 0, 4, 0, 24, 0, 0, 0, 2, 0, 2, 0, 0, 0, 0, 0xff, 0xff, 0, 0, 0xff, 0xff, 0, 1, 0, 0]);
  const post = new Uint8Array(32);
  const pdv = new DataView(post.buffer);
  pdv.setUint32(0, 0x00030000);
  if (font.tables.post) post.set(bytes.subarray(font.tables.post.offset + 4, font.tables.post.offset + 16), 4);
  const tables = { head, hhea, maxp, hmtx, loca, glyf: concat(parts, off), cmap, post };
  if (font.tables['OS/2']) tables['OS/2'] = t('OS/2');
  void dv;
  return { bytes: writeSfnt(tables), map };
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

function writeSfnt(tables) {
  const tags = Object.keys(tables).sort();
  const n = tags.length;
  let pow = 1, log = 0;
  while (pow * 2 <= n) { pow *= 2; log++; }
  let total = 12 + 16 * n;
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
  dv.setUint32(offsets.head + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return out;
}

// ---------------------------------------------------------------- font files
const FONT_DIR = new URL('../../../vendor/pdfjs/standard_fonts/', import.meta.url).href;
const FILES = { r: 'LiberationSans-Regular.ttf', b: 'LiberationSans-Bold.ttf', i: 'LiberationSans-Italic.ttf', bi: 'LiberationSans-BoldItalic.ttf' };
export const styleKey = (bold, italic) => (bold && italic ? 'bi' : bold ? 'b' : italic ? 'i' : 'r');
const ttfCache = new Map();
let knownCmap = null; // character map of the first loaded face (all four faces cover the same characters)
/** Parsed Liberation Sans face (cached for the page's lifetime). */
export function loadUniTtf(bold = false, italic = false) {
  const st = styleKey(bold, italic);
  if (!ttfCache.has(st)) {
    ttfCache.set(st, fetch(FONT_DIR + FILES[st]).then(r => { if (!r.ok) throw new Error('font ' + r.status); return r.arrayBuffer(); })
      .then(buf => { const ttf = parseTtf(new Uint8Array(buf)); if (!knownCmap) knownCmap = ttf.cmap; return ttf; })
      .catch(err => { ttfCache.delete(st); throw err; }));
  }
  return ttfCache.get(st);
}

// ---------------------------------------------------------------- characters
const WIN_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
/** Can the 14 standard PDF fonts (WinAnsi) show this character? */
export function isWinAnsiChar(ch) {
  const c = ch.codePointAt(0);
  return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_EXTRA.has(ch);
}
// invisible formatting characters that are dropped without a warning
const INVISIBLE = /[­​-‏⁠-⁤﻿︀-️\u{e0100}-\u{e01ef}]/u;
const SPACES = /[ -   　]/u;
/** Does the text contain anything a standard font cannot show (ignoring line breaks and invisible marks)? */
export function needsUnicode(text) {
  for (const ch of String(text ?? '').normalize('NFC')) {
    if (ch === '\n' || ch === '\r' || ch === '\t' || isWinAnsiChar(ch) || INVISIBLE.test(ch) || SPACES.test(ch)) continue;
    return true;
  }
  return false;
}

/**
 * Make text drawable with `font` (a font from uniFont/stdOrUni or a pdf-lib standard font).
 * NFC-normalises, drops invisible marks, turns tabs and exotic spaces into spaces and replaces characters the
 * font does not have by '?'. Returns {text, missing: string[]} – missing: the replaced characters (unique),
 * for an honest warning. Line breaks are kept.
 */
export function cleanText(input, font) {
  const ttf = font && font.embedder && font.embedder.uniTtf;
  const has = ttf ? ch => ttf.cmap.has(ch.codePointAt(0)) : isWinAnsiChar;
  let text = '';
  const missing = [];
  for (const ch of String(input ?? '').normalize('NFC')) {
    if (ch === '\n') { text += ch; continue; }
    if (ch === '\r' || INVISIBLE.test(ch) || ch === '‍') continue;
    if (ch === '\t') { text += '    '; continue; }
    if (SPACES.test(ch)) { text += ' '; continue; }
    if (ch.codePointAt(0) < 0x20) continue;
    if (has(ch)) { text += ch; continue; }
    if (!missing.includes(ch)) missing.push(ch);
    // a combining mark without a precomposed letter (no mark positioning here): keep the base letter only
    if (!/\p{M}/u.test(ch)) text += '?';
  }
  return { text, missing };
}

// ---------------------------------------------------------------- pdf-lib font
const hex4 = n => n.toString(16).padStart(4, '0').toUpperCase();
function subsetTag(gids) {
  let h = 2166136261;
  for (const g of gids) { h ^= g; h = Math.imul(h, 16777619) >>> 0; }
  let s = '';
  for (let i = 0; i < 6; i++) { s += String.fromCharCode(65 + (h % 26)); h = Math.floor(h / 26) + i * 7919; }
  return s;
}

class UniEmbedder {
  constructor(ttf, PDFLib) {
    this.uniTtf = ttf;
    this.PDFLib = PDFLib;
    this.fontName = ttf.name;
    this.scale = 1000 / ttf.unitsPerEm;
    this.used = new Map(); // gid → unicode text
    this.refs = null;
    this.font = { characterSet: [...ttf.cmap.keys()].sort((a, b) => a - b) }; // PDFFont.getCharacterSet()
  }
  gidsOf(text) {
    const out = [];
    for (const ch of text) out.push([this.uniTtf.cmap.get(ch.codePointAt(0)) || 0, ch]);
    return out;
  }
  encodeText(text) {
    let hex = '';
    for (const [g, ch] of this.gidsOf(text)) { if (!this.used.has(g)) this.used.set(g, ch); hex += hex4(g); }
    return this.PDFLib.PDFHexString.of(hex);
  }
  widthOfTextAtSize(text, size) {
    let w = 0;
    for (const [g] of this.gidsOf(text)) w += advance(this.uniTtf, g);
    return (w * this.scale * size) / 1000;
  }
  // vertical metrics: OS/2 typo values – close to Helvetica's, so layouts made for the standard font fit
  vMetrics() {
    const t = this.uniTtf;
    return [(t.typoAscent || t.ascent) * this.scale, (t.typoDescent || t.descent) * this.scale];
  }
  heightOfFontAtSize(size, { descender = true } = {}) {
    const [a, d] = this.vMetrics();
    return ((descender ? a - d : a) / 1000) * size;
  }
  sizeOfFontAtHeight(height) {
    const [a, d] = this.vMetrics();
    return (1000 * height) / (a - d);
  }
  async embedIntoContext(ctx, ref) {
    const t = this.uniTtf, k = this.scale;
    const { PDFString } = this.PDFLib;
    if (!this.refs) this.refs = { file: ctx.nextRef(), desc: ctx.nextRef(), cid: ctx.nextRef(), tu: ctx.nextRef() };
    const R = this.refs;
    const gids = [...this.used.keys()].sort((a, b) => a - b);
    // CIDs in the content streams are the original glyph ids; CIDToGIDMap points them at the compact subset
    const { bytes: sub, map } = subsetCompact(t, gids);
    ctx.assign(R.file, ctx.flateStream(sub, { Length1: sub.length }));
    if (!R.c2g) R.c2g = ctx.nextRef();
    const maxCid = gids.length ? gids[gids.length - 1] : 0;
    const c2g = new Uint8Array((maxCid + 1) * 2);
    for (const [cid, g] of map) if (cid <= maxCid) { c2g[cid * 2] = g >> 8; c2g[cid * 2 + 1] = g & 255; }
    ctx.assign(R.c2g, ctx.flateStream(c2g));
    const name = `${subsetTag(gids)}+${t.name}`;
    const flags = 32 | (t.fixed ? 1 : 0) | (t.italicAngle ? 64 : 0);
    ctx.assign(R.desc, ctx.obj({
      Type: 'FontDescriptor', FontName: name, Flags: flags,
      FontBBox: t.bbox.map(v => Math.round(v * k)), ItalicAngle: t.italicAngle,
      Ascent: Math.round(t.ascent * k), Descent: Math.round(t.descent * k), CapHeight: Math.round(t.capHeight * k),
      StemV: 80, FontFile2: R.file,
    }));
    const W = [];
    for (let i = 0; i < gids.length;) {
      const start = gids[i];
      const ws = [Math.round(advance(t, start) * k)];
      let j = i + 1;
      while (j < gids.length && gids[j] === gids[j - 1] + 1) { ws.push(Math.round(advance(t, gids[j]) * k)); j++; }
      W.push(start, ws);
      i = j;
    }
    ctx.assign(R.cid, ctx.obj({
      Type: 'Font', Subtype: 'CIDFontType2', BaseFont: name,
      CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Identity'), Supplement: 0 },
      FontDescriptor: R.desc, W, CIDToGIDMap: R.c2g, DW: 1000,
    }));
    const lines = [];
    const mapped = gids.filter(g => g);
    for (let i = 0; i < mapped.length; i += 100) {
      const chunk = mapped.slice(i, i + 100);
      lines.push(`${chunk.length} beginbfchar`);
      for (const g of chunk) {
        const s = this.used.get(g) || '';
        let u = '';
        for (let q = 0; q < s.length; q++) u += hex4(s.charCodeAt(q));
        lines.push(`<${hex4(g)}> <${u || 'FFFD'}>`);
      }
      lines.push('endbfchar');
    }
    const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${lines.join('\n')}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
    ctx.assign(R.tu, ctx.flateStream(new TextEncoder().encode(cmap)));
    ctx.assign(ref, ctx.obj({ Type: 'Font', Subtype: 'Type0', BaseFont: name, Encoding: 'Identity-H', DescendantFonts: [R.cid], ToUnicode: R.tu }));
  }
}

/** Wrap a parsed TrueType face as a pdf-lib PDFFont of `pdfDoc` (embedded as a subset on save). */
export function uniPdfFont(pdfDoc, PDFLib, ttf) {
  const embedder = new UniEmbedder(ttf, PDFLib);
  // PDFFont's constructor only accepts pdf-lib's own embedders – build the instance from its prototype
  const font = Object.create(PDFLib.PDFFont.prototype);
  // modified=false: a face that never draws anything is not embedded at all (encodeText sets it)
  Object.assign(font, { ref: pdfDoc.context.nextRef(), doc: pdfDoc, name: embedder.fontName, embedder, modified: false });
  font.isUnicode = true;
  pdfDoc.fonts.push(font); // embedded by pdfDoc.save() like every other font
  return font;
}

const docFonts = new WeakMap();
const PDFLibOf = p => p || globalThis.PDFLib;
/** Liberation Sans (Unicode) of one document, cached per document and style. */
export async function uniFont(pdfDoc, { bold = false, italic = false, PDFLib = null } = {}) {
  let m = docFonts.get(pdfDoc);
  if (!m) docFonts.set(pdfDoc, (m = new Map()));
  const st = 'u' + styleKey(bold, italic);
  if (!m.has(st)) m.set(st, loadUniTtf(bold, italic).then(ttf => uniPdfFont(pdfDoc, PDFLibOf(PDFLib), ttf)).catch(err => { m.delete(st); throw err; }));
  return m.get(st);
}

const STD = {
  sans: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'],
  serif: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'],
  mono: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'],
};
/** pdf-lib standard font of one document, cached. */
export async function stdFont(pdfDoc, { family = 'sans', bold = false, italic = false, PDFLib = null } = {}) {
  let m = docFonts.get(pdfDoc);
  if (!m) docFonts.set(pdfDoc, (m = new Map()));
  const fam = STD[family] ? family : 'sans';
  const key = 's' + fam + styleKey(bold, italic);
  if (!m.has(key)) m.set(key, pdfDoc.embedFont(PDFLibOf(PDFLib).StandardFonts[STD[fam][(bold ? 1 : 0) + (italic ? 2 : 0)]]));
  return m.get(key);
}

/**
 * The right font for one piece of text: the standard font of the family (tiny files, unchanged look) when it
 * can show every character, otherwise Liberation Sans in the same weight/style (Unicode, embedded subset).
 * Serif and typewriter text with such characters is set in the sans face (only the sans family ships with the
 * app). If the Unicode font cannot be loaded, the standard font is returned (cleanText then reports the losses).
 */
export async function fontForText(pdfDoc, text, opts = {}) {
  if (!needsUnicode(text)) return stdFont(pdfDoc, opts);
  try { return await uniFont(pdfDoc, opts); }
  catch (err) { console.warn('Unicode font', err); return stdFont(pdfDoc, opts); }
}

/** fontForText + cleanText in one step: {font, text, missing}. */
export async function prepareText(pdfDoc, input, opts = {}) {
  const font = await fontForText(pdfDoc, input, opts);
  return { font, ...cleanText(input, font) };
}

/**
 * Characters of `text` that neither the standard fonts nor Liberation Sans can show (synchronous, for live
 * warnings while typing). Before a face has been loaded (preloadUniFont) it estimates: Latin, Greek,
 * Cyrillic and common punctuation count as supported.
 */
export function unsupportedChars(text) {
  const out = [];
  for (const ch of String(text ?? '').normalize('NFC')) {
    if (ch === '\n' || ch === '\r' || ch === '\t' || ch === '\u200d' || isWinAnsiChar(ch) || INVISIBLE.test(ch) || SPACES.test(ch) || ch.codePointAt(0) < 0x20) continue;
    const ok = knownCmap ? knownCmap.has(ch.codePointAt(0))
      : /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\u2010-\u2027\u2030-\u205e\u20a0-\u20bf\u2100-\u215f\u2190-\u2195]/u.test(ch) && !/\p{M}/u.test(ch);
    if (!ok && !out.includes(ch)) out.push(ch);
  }
  return out;
}
/** Start loading the regular face in the background (so unsupportedChars is exact and drawing is fast). */
export function preloadUniFont() { loadUniTtf().catch(() => {}); }

/** User-facing warning ({de, en}) for characters no available font has – null when nothing was replaced. */
export function missingWarning(...lists) {
  const all = [...new Set(lists.flat().filter(Boolean))];
  if (!all.length) return null;
  const list = all.slice(0, 16).join(' ') + (all.length > 16 ? ' …' : '');
  return {
    de: `Diese Zeichen kann die eingebettete Schrift nicht darstellen (z. B. chinesische, arabische oder hebräische Schrift, Emoji) – sie wurden durch „?“ ersetzt: ${list}`,
    en: `The embedded font cannot show these characters (e.g. Chinese, Arabic or Hebrew script, emoji) – they were replaced by "?": ${list}`,
  };
}
