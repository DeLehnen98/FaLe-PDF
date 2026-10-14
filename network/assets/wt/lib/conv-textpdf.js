// Text layout → PDF for text-to-pdf: plain text, Markdown (via the app's markdownToHtml + htmlToModel)
// and CSV tables. Fonts: the standard PDF fonts (Helvetica / Times / Courier – tiny files) and, for
// characters outside their WinAnsi set (Polish, Czech, Turkish, Greek, Cyrillic …), Liberation Sans
// embedded as a subset (lib/conv-ttf.js). Characters no font here has (e.g. Chinese, emoji) are
// replaced by "?" – and reported, never dropped silently.
import { loadPdfLib, saveDoc } from './pdf.js';
import { parseTtf, ttfForDoc } from './conv-ttf.js';

const FONT_DIR = new URL('../vendor/pdfjs/standard_fonts/', import.meta.url).href;
const LIB_FILES = { r: 'LiberationSans-Regular.ttf', b: 'LiberationSans-Bold.ttf', i: 'LiberationSans-Italic.ttf', bi: 'LiberationSans-BoldItalic.ttf' };
const ttfCache = new Map();
async function loadTtf(style) {
  if (!ttfCache.has(style)) {
    ttfCache.set(style, fetch(FONT_DIR + LIB_FILES[style]).then(r => { if (!r.ok) throw new Error('font ' + r.status); return r.arrayBuffer(); }).then(b => parseTtf(new Uint8Array(b)))
      .catch(err => { ttfCache.delete(style); throw err; }));
  }
  return ttfCache.get(style);
}
const styleKey = (b, i) => (b && i ? 'bi' : b ? 'b' : i ? 'i' : 'r');

export const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792], a5: [419.53, 595.28] };

/** All fonts of one document: standard family + Liberation fallback + replacement report. */
async function fontSet(pdfDoc, PDFLib, family, texts) {
  const SF = PDFLib.StandardFonts;
  const NAMES = {
    sans: { r: SF.Helvetica, b: SF.HelveticaBold, i: SF.HelveticaOblique, bi: SF.HelveticaBoldOblique },
    serif: { r: SF.TimesRoman, b: SF.TimesRomanBold, i: SF.TimesRomanItalic, bi: SF.TimesRomanBoldItalic },
    mono: { r: SF.Courier, b: SF.CourierBold, i: SF.CourierOblique, bi: SF.CourierBoldOblique },
  };
  const std = new Map();
  const getStd = async (fam, st) => {
    const key = fam + st;
    if (!std.has(key)) std.set(key, await pdfDoc.embedFont(NAMES[fam][st]));
    return std.get(key);
  };
  const helv = await getStd('sans', 'r');
  const winSet = new Set(helv.getCharacterSet());
  // does the text need the Unicode font at all?
  let needTtf = false;
  for (const t of texts) { for (const ch of t) { const c = ch.codePointAt(0); if (c >= 32 && !winSet.has(c) && !/\s/.test(ch)) { needTtf = true; break; } } if (needTtf) break; }
  const ttf = new Map();
  if (needTtf) {
    for (const st of ['r', 'b', 'i', 'bi']) {
      try { ttf.set(st, ttfForDoc(pdfDoc, PDFLib, await loadTtf(st))); } catch (err) { console.warn('Unicode font', err); }
    }
  }
  const replaced = new Map();
  const { winAnsi } = await import('./shared/office/pdftext.js');
  // preload the standard faces that will be used
  for (const fam of new Set([family, 'mono', 'sans'])) for (const st of ['r', 'b', 'i', 'bi']) await getStd(fam, st);
  return {
    replaced,
    /** Split text into drawable segments: [{text, std?: PDFFont, ttf?: font}] */
    segments(text, fam, b, i) {
      const st = styleKey(b, i);
      const sf = std.get(fam + st) || helv;
      const tf = ttf.get(st) || ttf.get('r');
      const out = [];
      const push = (t, kind) => {
        const last = out[out.length - 1];
        if (last && last.kind === kind) last.text += t; else out.push({ text: t, kind, std: kind === 'std' ? sf : null, ttf: kind === 'ttf' ? tf : null });
      };
      for (const ch of text) {
        const c = ch.codePointAt(0);
        if (ch === '\t') { push('    ', 'std'); continue; }
        if (c < 32) continue;
        if (winSet.has(c)) { push(ch, 'std'); continue; }
        if (/[​-‏⁠﻿️]/.test(ch)) continue; // invisible formatting characters
        if (tf && tf.has(c)) { push(ch, 'ttf'); continue; }
        const alt = winAnsi(ch);
        replaced.set(ch, (replaced.get(ch) || 0) + 1);
        push(alt && alt !== '?' && [...alt].every(x => winSet.has(x.codePointAt(0))) ? alt : '?', 'std');
      }
      return out;
    },
    width(seg, size) { return seg.std ? seg.std.widthOfTextAtSize(seg.text, size) : seg.ttf.widthOf(seg.text, size); },
    ttfFonts: ttf,
  };
}

// ---------------------------------------------------------------- layout
/**
 * blocks: [{type:'para', tag, runs:[{text,b,i,mono,s,href}|{br:true}], list?:{ordered,level,index}, align?}
 *          | {type:'table', rows:[[string]], header:boolean} | {type:'hr'} | {type:'pagebreak'}]
 * opts: { page:'a4', size:11, margin:mm, family:'sans'|'serif'|'mono', pageNumbers, plain (no paragraph spacing), title, onProgress, tick }
 */
export async function layoutPdf(blocks, opts) {
  const PDFLib = await loadPdfLib();
  const { rgb, PDFName, PDFHexString, PDFString } = PDFLib;
  const pdf = await PDFLib.PDFDocument.create();
  const texts = [];
  const collect = bs => bs.forEach(b => { if (b.runs) b.runs.forEach(r => r.text && texts.push(r.text)); if (b.rows) b.rows.forEach(r => r.forEach(c => texts.push(String(c ?? '')))); });
  collect(blocks);
  const fam = opts.family || 'sans';
  const F = await fontSet(pdf, PDFLib, fam, texts);
  const [PW, PH] = opts.landscape ? [...(PAGE_SIZES[opts.page] || PAGE_SIZES.a4)].reverse() : (PAGE_SIZES[opts.page] || PAGE_SIZES.a4);
  const M = (opts.margin || 20) * 72 / 25.4;
  const S = opts.size || 11;
  const contentW = PW - 2 * M;
  const bottom = M + (opts.pageNumbers ? 14 : 0);
  const C = { text: rgb(0.1, 0.1, 0.12), head: rgb(0.08, 0.09, 0.2), mute: rgb(0.38, 0.4, 0.5), link: rgb(0.02, 0.33, 0.75), rule: rgb(0.78, 0.8, 0.86), codeBg: rgb(0.95, 0.955, 0.97), headBg: rgb(0.93, 0.94, 0.97) };
  const ttfNames = new Map();
  let page = null, y = 0;
  const pages = [];
  const newPage = () => {
    page = pdf.addPage([PW, PH]);
    pages.push(page);
    for (const [st, t] of F.ttfFonts) {
      const n = `FL${st}`;
      page.node.setFontDictionary(PDFName.of(n), t.ref);
      ttfNames.set(t, n);
    }
    y = PH - M;
  };
  const ensure = h => { if (!page || y - h < bottom) newPage(); };

  const drawSegs = (segs, x, base, size, color) => {
    for (const s of segs) {
      if (!s.text) continue;
      if (s.std) page.drawText(s.text, { x, y: base, size, font: s.std, color });
      else {
        page.pushOperators(
          PDFLib.pushGraphicsState(), PDFLib.beginText(), PDFLib.setFillingRgbColor(color.red, color.green, color.blue),
          PDFLib.setFontAndSize(ttfNames.get(s.ttf), size), PDFLib.moveText(x, base),
          PDFLib.showText(PDFHexString.of(s.ttf.encode(s.text))), PDFLib.endText(), PDFLib.popGraphicsState());
      }
      x += F.width(s, size);
    }
    return x;
  };

  /** Break runs into lines that fit `maxW`. Returns [{pieces:[{segs,size,color,w,run}], w, h}] */
  const breakLines = (runs, maxW, size, base) => {
    const lines = [];
    let cur = [], curW = 0;
    const flush = () => { lines.push({ pieces: cur, w: curW }); cur = []; curW = 0; };
    for (const r of runs) {
      if (r.br) { flush(); continue; }
      const f = r.mono ? 'mono' : base.family;
      const sz = r.mono && !base.allMono ? size * 0.92 : size;
      const color = r.href ? C.link : base.color;
      const words = String(r.text || '').split(/(\s+)/).filter(w => w !== '');
      for (const w of words) {
        const segs = F.segments(w, f, r.b || base.b, r.i || base.i);
        let ww = segs.reduce((s, g) => s + F.width(g, sz), 0);
        const isSpace = /^\s+$/.test(w);
        if (curW + ww > maxW && cur.length) {
          flush();
          if (isSpace) continue; // the space at a line break is not drawn
        }
        if (ww > maxW) { // very long word: split by characters
          let part = '';
          for (const ch of w) {
            const t = part + ch;
            const tw = F.segments(t, f, r.b || base.b, r.i || base.i).reduce((s, g) => s + F.width(g, sz), 0);
            if (curW + tw > maxW && part) {
              const ps = F.segments(part, f, r.b || base.b, r.i || base.i);
              cur.push({ segs: ps, size: sz, color, w: ps.reduce((s, g) => s + F.width(g, sz), 0), run: r });
              flush();
              part = ch;
            } else part = t;
          }
          const ps = F.segments(part, f, r.b || base.b, r.i || base.i);
          ww = ps.reduce((s, g) => s + F.width(g, sz), 0);
          cur.push({ segs: ps, size: sz, color, w: ww, run: r });
          curW += ww;
          continue;
        }
        cur.push({ segs, size: sz, color, w: ww, run: r });
        curW += ww;
      }
    }
    if (cur.length || !lines.length) flush();
    // trailing spaces don't count for alignment
    for (const l of lines) {
      if (!base.keepSpace) while (l.pieces.length && /^\s+$/.test(l.pieces[l.pieces.length - 1].segs.map(s => s.text).join(''))) l.w -= l.pieces.pop().w;
      if (!base.keepSpace) while (l.pieces.length && /^\s+$/.test(l.pieces[0].segs.map(s => s.text).join(''))) l.w -= l.pieces.shift().w;
    }
    return lines;
  };

  const drawLine = (line, x, base, align, maxW) => {
    let cx = x + (align === 'center' ? (maxW - line.w) / 2 : align === 'right' ? maxW - line.w : 0);
    for (const p of line.pieces) {
      const x0 = cx;
      cx = drawSegs(p.segs, cx, base, p.size, p.color);
      if (p.run.s) page.drawLine({ start: { x: x0, y: base + p.size * 0.3 }, end: { x: cx, y: base + p.size * 0.3 }, thickness: p.size / 18, color: p.color });
      if (p.run.href) {
        page.drawLine({ start: { x: x0, y: base - p.size * 0.12 }, end: { x: cx, y: base - p.size * 0.12 }, thickness: p.size / 20, color: p.color });
        if (/^(https?:|mailto:)/i.test(p.run.href)) {
          const annot = pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [x0, base - p.size * 0.25, cx, base + p.size * 0.85], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(p.run.href) } });
          page.node.addAnnot(pdf.context.register(annot));
        }
      }
    }
  };

  const HEAD = { title: 2, h1: 1.8, h2: 1.45, h3: 1.2, h4: 1.05, h5: 1, h6: 1 };
  let listCounters = [];
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    if (bi % 40 === 0) { opts.onProgress?.(bi / blocks.length); await opts.tick?.(); }
    if (b.type === 'pagebreak') { newPage(); continue; }
    if (b.type === 'hr') { ensure(S); y -= S * 0.6; page.drawLine({ start: { x: M, y }, end: { x: PW - M, y }, thickness: 0.7, color: C.rule }); y -= S * 0.8; continue; }
    if (b.type === 'table') { await drawTable(b); continue; }
    if (b.type !== 'para') continue;
    const tag = b.tag || 'p';
    const isHead = HEAD[tag] != null;
    const isCode = tag === 'code' || (b.runs.length && b.runs.every(r => r.br || r.mono)) && !opts.plain;
    const size = isHead ? S * HEAD[tag] : isCode ? S * 0.9 : S;
    const lead = opts.plain ? size * 1.32 : isHead ? size * 1.22 : size * 1.38;
    let indent = 0;
    let label = null;
    if (b.list) {
      const lv = b.list.level || 0;
      indent = S * 1.6 * (lv + 1);
      listCounters = listCounters.slice(0, lv + 1);
      label = b.list.ordered ? `${b.list.index}.` : ['•', '–', '·'][lv % 3];
    } else listCounters = [];
    if (tag === 'quote') indent = S * 1.2;
    const maxW = contentW - indent - (isCode ? S : 0);
    const base = { family: isCode ? 'mono' : fam, allMono: isCode || fam === 'mono', b: isHead, i: tag === 'quote', color: isHead ? C.head : tag === 'quote' ? C.mute : C.text, keepSpace: opts.plain || isCode };
    const runs = b.runs.length ? b.runs : [{ text: '' }];
    const lines = breakLines(runs, maxW, size, base);
    const before = opts.plain ? 0 : isHead ? size * 0.75 : b.list ? 0 : 0;
    const after = opts.plain ? 0 : isHead ? size * 0.35 : b.list ? S * 0.15 : S * 0.55;
    if (isHead) ensure(before + lead * Math.min(lines.length, 2) + S * 2.5); // keep a heading with what follows
    else ensure(lead);
    if (page && y < PH - M - 1) y -= before;
    if (isCode) {
      // background box per page part
      const h = lines.length * lead + S * 0.6;
      if (y - Math.min(h, y - bottom) >= bottom) page.drawRectangle({ x: M, y: Math.max(bottom, y - h), width: contentW, height: Math.min(h, y - bottom), color: C.codeBg });
      y -= S * 0.3;
    }
    lines.forEach((line, li) => {
      if (y - lead < bottom) { newPage(); }
      const baseY = y - size * 0.95;
      if (li === 0 && label) {
        const segs = F.segments(label, fam, false, false);
        const lw = segs.reduce((s, g) => s + F.width(g, size), 0);
        drawSegs(segs, M + indent - lw - S * 0.45, baseY, size, C.text);
      }
      if (tag === 'quote') page.drawRectangle({ x: M, y: y - lead, width: 2.2, height: lead, color: C.rule });
      drawLine(line, M + indent + (isCode ? S * 0.5 : 0), baseY, b.align, maxW);
      y -= lead;
    });
    if (isCode) y -= S * 0.3;
    y -= after;
  }
  if (!pages.length) newPage();

  async function drawTable(t) {
    const rows = t.rows.filter(r => r.some(c => String(c ?? '').trim()));
    if (!rows.length) return;
    const n = Math.max(...rows.map(r => r.length));
    const size = S * 0.9, pad = 4, lead = size * 1.3;
    // column widths from content (capped), scaled to the content width
    const natural = new Array(n).fill(20);
    rows.slice(0, 300).forEach((r, ri) => {
      const head = t.header && ri === 0;
      for (let k = 0; k < n; k++) {
        const segs = F.segments(String(r[k] ?? ''), fam, head, false);
        natural[k] = Math.max(natural[k], Math.min(contentW * 0.6, segs.reduce((s, g) => s + F.width(g, size), 0) + pad * 2 + 1));
      }
    });
    const sum = natural.reduce((a, b2) => a + b2, 0);
    const widths = natural.map(w => (sum > contentW ? (w / sum) * contentW : w));
    const tableW = widths.reduce((a, b2) => a + b2, 0);
    const layoutRow = (r, head) => {
      const cells = widths.map((w, k) => breakLines([{ text: String(r[k] ?? ''), b: head }], w - pad * 2, size, { family: fam, b: head, i: false, color: C.text, keepSpace: false }));
      return { cells, h: Math.max(...cells.map(c => c.length)) * lead + pad * 2 };
    };
    const drawRow = (row, head) => {
      if (y - row.h < bottom) { newPage(); if (t.header && !head) drawRow(layoutRow(rows[0], true), true); }
      if (head) page.drawRectangle({ x: M, y: y - row.h, width: tableW, height: row.h, color: C.headBg });
      let x = M;
      row.cells.forEach((lines, k) => {
        lines.forEach((line, li) => drawLine(line, x + pad, y - pad - li * lead - size * 0.95, null, widths[k] - pad * 2));
        x += widths[k];
      });
      // grid
      page.drawLine({ start: { x: M, y: y - row.h }, end: { x: M + tableW, y: y - row.h }, thickness: 0.5, color: C.rule });
      page.drawLine({ start: { x: M, y }, end: { x: M + tableW, y }, thickness: 0.5, color: C.rule });
      let gx = M;
      for (let k = 0; k <= n; k++) { page.drawLine({ start: { x: gx, y }, end: { x: gx, y: y - row.h }, thickness: 0.5, color: C.rule }); gx += widths[k] || 0; }
      y -= row.h;
    };
    ensure(lead * 3);
    if (!opts.plain) y -= S * 0.2;
    for (let ri = 0; ri < rows.length; ri++) {
      drawRow(layoutRow(rows[ri], t.header && ri === 0), t.header && ri === 0);
      if (ri % 50 === 49) await opts.tick?.();
    }
    y -= S * 0.8;
  }

  if (opts.pageNumbers) {
    const total = pages.length;
    pages.forEach((p, i) => {
      const s = `${i + 1} / ${total}`;
      const f = F.segments(s, 'sans', false, false)[0].std;
      const w = f.widthOfTextAtSize(s, 8.5);
      p.drawText(s, { x: (PW - w) / 2, y: M * 0.55, size: 8.5, font: f, color: C.mute });
    });
  }
  // embed the used Unicode faces; drop unused ones from the page resources again
  for (const [st, t] of F.ttfFonts) {
    if (t.usedCount) { t.finish(); continue; }
    for (const p of pages) p.node.Resources()?.lookup(PDFName.of('Font'))?.delete(PDFName.of(`FL${st}`));
  }
  const bytes = await saveDoc(pdf, { title: opts.title || null });
  return { bytes, pages: pages.length, replaced: F.replaced, unicodeFont: [...F.ttfFonts.values()].some(t => t.usedCount) };
}
