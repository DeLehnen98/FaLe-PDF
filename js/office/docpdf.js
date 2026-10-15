// Document model → PDF (pdf-lib, standard fonts; Liberation Sans as an embedded Unicode subset for text they
// cannot show – Polish, Turkish, Greek, Cyrillic …). Real text (searchable), line wrapping, headings (also
// numbered), lists, tables, images, links, tab stops with leaders, drop caps, foot- and endnotes, tables of
// contents/figures with page numbers and internal links, cross references, sections with their own orientation,
// header/footer zones with fields, watermark and PDF bookmarks (outline) from the headings.
import { loadPdfLib } from '../pdflib.js';
import { fontKit, safeText, needsUnicodeDeep, rgbOf, addLink, wrapPlain } from './pdftext.js';
import { imageToBytes } from './vendor.js';
import { HEADING_PT, PARA_SPACE, listLabel, bulletChar, tocEntries, runsText } from './docmodel.js';
import { normalizeStyles, STYLE_OF_TAG } from './docstyles.js';
import { fontKind } from './fonts.js';
import { hfTexts, pageNumberOf, pageLabel } from './hfnorm.js';

const HEAD_COLOR = { h1: '#1B1E33', h2: '#1B1E33', h3: '#2B2F4A', h4: '#2B2F4A', h5: '#2B2F4A', h6: '#2B2F4A', subtitle: '#5A607F' };
const LIST_INDENT = 20;
const LINE = 1.3;
const DEFAULT_TAB = 35.4; // 1,25 cm

export async function modelToPdf(model, { title = 'Dokument', page = null, hf = null, onProgress, measureOnly = false } = {}) {
  const PDFLib = await loadPdfLib();
  const pdf = await PDFLib.PDFDocument.create();
  pdf.setTitle(title);
  pdf.setProducer('FaLe PDF');
  pdf.setCreator('FaLe PDF');
  const fk = await fontKit(pdf);
  const base = model.baseSize || 11;
  const pg = page || { w: 595.3, h: 841.9, mt: 70.9, mr: 70.9, mb: 56.7, ml: 70.9 };
  const geomOf = orient => { const pw = Math.min(pg.w, pg.h), ph = Math.max(pg.w, pg.h); const land = orient ? orient === 'landscape' : pg.w > pg.h; return { ...pg, w: land ? ph : pw, h: land ? pw : ph }; };
  let LG = pg; // geometry of the section being laid out
  const contentW = pg.w - pg.ml - pg.mr;

  // fonts + images up front so layout is synchronous
  const images = new Map();
  let needSerif = false, needMono = false;
  const S = model.styles ? normalizeStyles(model.styles) : null;
  const kindOfRun = (r, sty) => (r.mono ? 'mono' : r.serif ? 'serif' : r.font ? fontKind(r.font) : sty && (sty.font || (S && S.normal.font)) ? fontKind(sty.font || S.normal.font) : 'sans');
  if (S) Object.values(S).forEach(st => { const k = st.font ? fontKind(st.font) : 'sans'; if (k === 'serif') needSerif = true; if (k === 'mono') needMono = true; });
  const scan = blocks => blocks.forEach(b => {
    if (b.type === 'para') b.runs.forEach(r => { if (r.img) images.set(r.img.src, null); const k = kindOfRun(r, null); if (k === 'serif') needSerif = true; if (k === 'mono') needMono = true; });
    if (b.type === 'table') b.rows.forEach(row => row.forEach(c => scan(c.blocks)));
    if (b.type === 'section' || b.type === 'textbox') scan(b.blocks);
  });
  scan(model.blocks);
  if (needSerif) await fk.ensure('serif');
  if (needMono) await fk.ensure('mono');
  if (needsUnicodeDeep(model) || needsUnicodeDeep(hf) || needsUnicodeDeep(title)) await fk.ensureUnicode();
  for (const src of images.keys()) {
    try {
      const im = await imageToBytes(src, { maxSide: 2000 });
      images.set(src, { img: im.type === 'png' ? await pdf.embedPng(im.bytes) : await pdf.embedJpg(im.bytes), w: im.width, h: im.height });
    } catch (e) { console.warn('Bild übersprungen', e); }
  }

  const fontFor = (r, text = '') => fk.pick(text, r.mono ? 'mono' : r.serif ? 'serif' : 'sans', !!r.b, !!r.i);
  const footnotes = []; // texts, numbered in reading order
  const endnotes = [];
  const blockPages = new Map(); // top-level block index → 0-based page index (dry run)
  const anchorPages = new Map(); // bookmark name → 0-based page index
  const blockPos = new Map(), anchorPos = new Map(); // → { page, y } (drawing pass)
  const pendingLinks = []; // internal links resolved after drawing: { page, rect, block?, anchor? }
  const outline = []; // { level, title, page, y }
  const pageText = i => (i == null ? '' : hf ? pageNumberOf(hf, i) : String(i + 1));
  const FN_SIZE = 8.5;
  const styleOf = b => (S ? (b.cstyle && S[b.cstyle]) || S[STYLE_OF_TAG[b.tag || 'p'] || 'normal'] || S.normal : null);

  // ---------- layout: blocks → units ----------
  // unit: { h, draw(page, x, yTop), space?, pagebreak?, fns?, anchors?, blockIdx?, keepNext? }
  const layoutPara = (b, width, x0Offset = 0) => {
    const units = [];
    const tag = b.tag || 'p';
    const head = HEADING_PT[tag];
    const sty = styleOf(b);
    const defSize = sty ? (sty.size || S.normal.size || base) : (head || base);
    const tight = b.tight || model.tight;
    const sp = tight ? [0, 0] : sty ? [b.before ?? (b.list ? 0 : sty.before ?? 0), b.after ?? (b.list ? 3 : sty.after ?? 0)] : [b.before ?? (PARA_SPACE[b.list ? 'li' : tag] || PARA_SPACE.p)[0], b.after ?? (PARA_SPACE[b.list ? 'li' : tag] || PARA_SPACE.p)[1]];
    const lm = b.line || (sty && sty.line) || null;
    const lineF = tight || !lm ? LINE : lm * 1.13;
    const align = b.align || (sty && sty.align) || null;
    const quote = tag === 'quote';
    let indent = (b.indent || 0) + x0Offset + (quote ? ((sty && sty.indent) || 14) : 0) + (b.cstyle && sty && sty.indent ? sty.indent : 0);
    let marker = null;
    if (b.list) {
      indent += LIST_INDENT * (b.list.level + 1);
      marker = b.list.ordered ? listLabel(b.list) : bulletChar(b.list);
    }
    const first = b.list ? 0 : (b.firstLine || 0);
    const avail = Math.max(40, width - indent - (b.indentR || 0));
    // drop cap: the first letter spans three lines, those lines move to the right
    let runs = b.runs;
    let drop = null;
    if (b.dropCap) {
      const k = runs.findIndex(r => r.text && r.text.trim());
      if (k >= 0) {
        const t = runs[k].text.replace(/^\s+/, '');
        const letter = Array.from(t)[0];
        runs = runs.slice(); runs[k] = { ...runs[k], text: t.slice(letter.length) };
        const lh = defSize * lineF;
        const size = (2 * lh + 0.72 * defSize) / 0.72;
        const st0 = { b: runs[k].b, i: runs[k].i, mono: kindOfRun(runs[k], sty) === 'mono', serif: kindOfRun(runs[k], sty) === 'serif' };
        const font = fontFor(st0, letter);
        const lt = safeText(letter, font);
        drop = { text: lt, font, size, w: font.widthOfTextAtSize(lt, size) + 4, color: runs[k].color || (sty && sty.color) || null, lh };
      }
    }
    const lineShift = li => (drop && li < 3 ? drop.w : 0);
    const availOf = li => Math.max(30, avail - (li === 0 ? first : 0) - lineShift(li));
    const pbg = b.bg || (sty && sty.bg) || null;
    // tab stops (pt from the paragraph's left edge)
    const stops = (b.tabDefs || (b.tabs || []).map(pos => ({ pos, align: 'left', leader: 'none' }))).filter(t => t.pos > 0).sort((a, c) => a.pos - c.pos);
    const stopAfter = x => stops.find(t => t.pos > x + 0.5) || { pos: (Math.floor(x / DEFAULT_TAB) + 1) * DEFAULT_TAB, align: 'left', leader: 'none' };
    // tokens
    const tokens = [];
    if (b.hnum) { const font = fontFor({ b: sty ? sty.b !== false : true }, b.hnum); const st = { b: sty ? sty.b !== false : true, size: defSize, rise: 0, color: (sty && sty.color) || HEAD_COLOR[tag] || null }; const t = safeText(`${b.hnum}  `, font); tokens.push({ text: t, st, font, w: font.widthOfTextAtSize(t, defSize) }); }
    for (const r of runs) {
      if (r.del) continue;
      if (r.br) { tokens.push({ br: true }); continue; }
      if (r.bm != null) { tokens.push({ anchor: r.bm, w: 0 }); continue; }
      if (r.fn != null || r.en != null) {
        const isFn = r.fn != null;
        if (isFn) footnotes.push(r.fn); else endnotes.push(r.en);
        const n = isFn ? footnotes.length : endnotes.length;
        const lab = isFn ? String(n) : pageLabel(n, 'i');
        const st = { size: defSize * 0.65, rise: defSize * 0.38, color: null };
        const font = fontFor({});
        tokens.push({ text: lab, st, font, w: font.widthOfTextAtSize(lab, st.size) + 0.5, ...(isFn ? { fnRef: n } : {}) });
        continue;
      }
      if (r.img) {
        const im = images.get(r.img.src);
        if (!im) continue;
        let w = (r.img.w || im.w) * 0.75, h = (r.img.h || im.h * ((r.img.w || im.w) / im.w)) * 0.75;
        const maxH = LG.h - LG.mt - LG.mb - 20;
        const s = Math.min(1, avail / w, maxH / h);
        tokens.push({ img: im.img, w: w * s, h: h * s });
        continue;
      }
      const st = {
        b: r.b || (sty ? sty.b && r.b !== false : head && r.b !== false), i: r.i || (sty && sty.i), u: r.u || !!r.href || (sty && sty.u), s: r.s, mono: kindOfRun(r, sty) === 'mono', serif: kindOfRun(r, sty) === 'serif',
        size: (r.size || defSize) * (r.sup || r.sub ? 0.7 : 1), rise: r.sup ? defSize * 0.35 : r.sub ? -defSize * 0.15 : 0,
        color: r.color || (r.href ? '#0563C1' : sty ? sty.color : head || tag === 'subtitle' ? HEAD_COLOR[tag] : null), bg: r.bg, href: r.href,
      };
      const font = fontFor(st, r.text);
      if (r.xref && r.xref.kind === 'page') { const t = safeText(String(r.text || '0'), font); tokens.push({ text: t, st, font, w: font.widthOfTextAtSize(t.length < 2 ? `${t}0` : t, st.size), xpage: r.xref.name }); continue; }
      const parts = String(r.text).split('\t');
      parts.forEach((part, pi) => {
        if (pi > 0) tokens.push({ tab: true, st, font, w: 0 });
        const text = safeText(part, font);
        for (const piece of text.split(/(\s+)/)) {
          if (!piece) continue;
          const space = /^\s+$/.test(piece);
          tokens.push({ text: piece, space, st, font, w: font.widthOfTextAtSize(piece, st.size), ...(r.xref ? { xref: r.xref.name } : {}) });
        }
      });
    }
    // lines (tabs: left stops advance the position; right/centre stops align the following segment)
    const lines = [];
    let line = { items: [], w: 0, tabs: false };
    let seg = null; // active right/centre/decimal tab segment
    const pushLine = (forced) => {
      while (line.items.length && line.items[line.items.length - 1].space) { line.w -= line.items.pop().w; }
      line.forced = forced;
      lines.push(line);
      line = { items: [], w: 0, tabs: false };
      seg = null;
    };
    for (const t of tokens) {
      if (t.br) { pushLine(true); continue; }
      if (t.anchor) { line.items.push(t); continue; }
      if (t.tab) {
        const x = line.w + (lines.length === 0 ? first : 0);
        const stop = stopAfter(x);
        line.tabs = true;
        const tabT = { ...t, stop, from: line.w };
        if (stop.align === 'left') { tabT.w = Math.max(0, stop.pos - x); seg = null; }
        else { tabT.w = 0; seg = { tab: tabT, w: 0 }; }
        if (stop.pos > availOf(lines.length) + 1 && stop.align === 'left') { pushLine(false); line.items.push({ ...tabT, w: DEFAULT_TAB, stop: { pos: DEFAULT_TAB, align: 'left', leader: 'none' } }); line.w = DEFAULT_TAB; line.tabs = true; continue; }
        line.items.push(tabT); line.w += tabT.w;
        continue;
      }
      if (seg) {
        // right-aligned segment: grows to the left of the stop
        seg.w += t.w;
        const room = seg.tab.stop.pos - (seg.tab.stop.align === 'center' ? 0 : 0);
        if (seg.tab.from + seg.w > Math.max(room, availOf(lines.length)) && line.items.length && !t.space) { pushLine(false); }
        else { line.items.push(t); seg.tab.w = Math.max(0, (seg.tab.stop.align === 'center' ? seg.tab.stop.pos - seg.w / 2 : seg.tab.stop.pos - seg.w) - (seg.tab.from + (lines.length === 0 ? first : 0))); line.w = seg.tab.from + seg.tab.w + seg.w; continue; }
      }
      if (t.space && !line.items.length) continue;
      if (line.w + t.w > availOf(lines.length) && line.items.length && !t.space) pushLine(false);
      if (t.space && line.w + t.w > availOf(lines.length)) { pushLine(false); continue; }
      if (!t.img && t.w > availOf(lines.length)) {
        // split very long word
        let part = '';
        for (const ch of t.text) {
          const pw = t.font.widthOfTextAtSize(part + ch, t.st.size);
          if (line.w + pw > availOf(lines.length) && part) {
            line.items.push({ ...t, text: part, w: t.font.widthOfTextAtSize(part, t.st.size) });
            pushLine(false); part = '';
          }
          part += ch;
        }
        if (part) { const w = t.font.widthOfTextAtSize(part, t.st.size); line.items.push({ ...t, text: part, w }); line.w += w; }
        continue;
      }
      line.items.push(t);
      line.w += t.w;
    }
    pushLine(true);
    if (pbg || lines.length) {
      if (sp[0]) units.push({ h: sp[0], space: true, draw() {} });
    }
    lines.forEach((ln, li) => {
      const maxSize = Math.max(defSize, ...ln.items.filter(i => i.st).map(i => i.st.size));
      const imgH = Math.max(0, ...ln.items.filter(i => i.img).map(i => i.h));
      const textH = maxSize * lineF;
      const h = Math.max(textH, imgH + maxSize * 0.3);
      const ascent = Math.max(maxSize * 0.95, imgH);
      const isLast = li === lines.length - 1;
      units.push({
        h, fns: ln.items.filter(i => i.fnRef).map(i => i.fnRef), anchors: ln.items.filter(i => i.anchor).map(i => i.anchor),
        xpages: ln.items.filter(i => i.xpage).length > 0,
        draw(page, x, yTop) {
          const ph = page.getHeight();
          let lx = x + indent + (li === 0 ? first : 0) + lineShift(li);
          const free = availOf(li) - ln.w;
          let gap = 0;
          if (!ln.tabs) {
            if (align === 'center') lx += free / 2;
            else if (align === 'right') lx += free;
            else if (align === 'justify' && !isLast && !ln.forced) {
              const spaces = ln.items.filter(i => i.space).length;
              if (spaces) gap = free / spaces;
            }
          }
          if (pbg) page.drawRectangle({ x: x + indent - 3, y: ph - yTop - h, width: avail + 6, height: h, color: rgbOf(PDFLib, pbg) });
          if (quote) page.drawRectangle({ x: x + indent - 10, y: ph - yTop - h, width: 2, height: h, color: rgbOf(PDFLib, '#C9CCDA') });
          if (li === 0 && marker) {
            const mf = fk.pick(marker);
            const ms = defSize;
            const mt = safeText(marker, mf);
            page.drawText(mt, { x: x + indent - mf.widthOfTextAtSize(mt, ms) - 5, y: ph - yTop - ascent, size: ms, font: mf, color: rgbOf(PDFLib, null) });
          }
          if (li === 0 && drop) page.drawText(drop.text, { x: x + indent + (first || 0), y: ph - (yTop + 2 * h + defSize * 0.95), size: drop.size, font: drop.font, color: rgbOf(PDFLib, drop.color) });
          const baseline = ph - yTop - ascent;
          const x0 = lx;
          for (const it of ln.items) {
            if (it.anchor) { anchorPos.set(it.anchor, { page, y: ph - yTop + 2 }); continue; }
            if (it.tab) {
              const target = x0 + it.from + it.w - (li === 0 ? 0 : 0);
              if (it.stop.leader && it.stop.leader !== 'none' && target - lx > 8) {
                const ch = it.stop.leader === 'dot' ? '.' : it.stop.leader === 'dash' ? '-' : '_';
                const lf = fk.sync('sans', false, false);
                const cw = lf.widthOfTextAtSize(ch, it.st.size) + 1.2;
                const n = Math.floor((target - lx - 6) / cw);
                if (n > 0) page.drawText(ch.repeat(n), { x: target - 3 - n * cw, y: baseline, size: it.st.size, font: lf, color: rgbOf(PDFLib, '#5A607F'), characterSpacing: 1.2 });
              }
              lx = target;
              continue;
            }
            if (it.img) {
              page.drawImage(it.img, { x: lx, y: baseline, width: it.w, height: it.h });
              lx += it.w; continue;
            }
            const w = it.w + (it.space ? gap : 0);
            if (it.st.bg) page.drawRectangle({ x: lx, y: baseline - it.st.size * 0.22, width: w, height: it.st.size * 1.15, color: rgbOf(PDFLib, it.st.bg) });
            let txt = it.text;
            if (it.xpage) { const pi = anchorPages.get(it.xpage); if (pi != null) txt = safeText(pageText(pi), it.font); }
            if (!it.space) page.drawText(txt, { x: lx, y: baseline + it.st.rise, size: it.st.size, font: it.font, color: rgbOf(PDFLib, it.st.color) });
            const col = rgbOf(PDFLib, it.st.color);
            if (it.st.u) page.drawLine({ start: { x: lx, y: baseline - it.st.size * 0.12 }, end: { x: lx + w, y: baseline - it.st.size * 0.12 }, thickness: Math.max(0.5, it.st.size / 18), color: col });
            if (it.st.s) page.drawLine({ start: { x: lx, y: baseline + it.st.size * 0.3 }, end: { x: lx + w, y: baseline + it.st.size * 0.3 }, thickness: Math.max(0.5, it.st.size / 18), color: col });
            if (it.st.href && !it.space && /^(https?:|mailto:|tel:)/i.test(it.st.href)) addLink(PDFLib, pdf, page, [lx, baseline - 2, lx + w, baseline + it.st.size], it.st.href);
            else if (it.st.href && !it.space && it.st.href.startsWith('#')) pendingLinks.push({ page, rect: [lx, baseline - 2, lx + w, baseline + it.st.size], anchor: decodeURIComponent(it.st.href.slice(1)) });
            if (it.xref && !it.space) pendingLinks.push({ page, rect: [lx, baseline - 2, lx + w, baseline + it.st.size], anchor: it.xref });
            lx += w;
          }
        },
      });
    });
    if (drop && lines.length < 3) units.push({ h: (3 - lines.length) * drop.lh, space: true, draw() {} });
    if (sp[1]) units.push({ h: sp[1], space: true, draw() {} });
    const keep = b.keepNext || (sty && sty.keepNext && /^h[1-6]$/.test(tag)) || !!drop;
    if (keep) { const fu = units.find(u => !u.space); if (fu) fu.keepNext = true; }
    return units;
  };

  const TSTYLE = { header: { head: '#3B37A0', headColor: '#FFFFFF' }, striped: { head: '#E9E8FB', band: '#F5F6FA', line: '#D5D8E6' }, plain: { line: '#1A1A1A' }, minimal: { line: '#C9CCDA', noV: true } };
  const layoutTable = (b, fullWidth) => {
    const units = [];
    const pad = 4;
    const ts = TSTYLE[b.style] || {};
    const width = fullWidth * ((b.widthPct || 100) / 100);
    const xOff = b.align === 'center' ? (fullWidth - width) / 2 : b.align === 'right' ? fullWidth - width : 0;
    const colW = b.widths.map(p => (p / 100) * width);
    const lineCol = ts.line || '#A6ABBD';
    // occupancy grid for rowspans
    const occupied = [];
    const headUnits = [];
    b.rows.forEach((row, ri) => {
      occupied[ri] = occupied[ri] || [];
      let col = 0;
      const cells = [];
      const isHead = ri < (b.headerRows || 0);
      for (const c of row) {
        while (occupied[ri][col]) col++;
        const span = Math.min(c.colspan || 1, Math.max(1, colW.length - col));
        const x = colW.slice(0, col).reduce((a, v) => a + v, 0);
        const w = colW.slice(col, col + span).reduce((a, v) => a + v, 0);
        for (let r = 0; r < (c.rowspan || 1); r++) for (let k = 0; k < span; k++) { occupied[ri + r] = occupied[ri + r] || []; occupied[ri + r][col + k] = true; }
        const white = ri === 0 && ts.headColor;
        const blocks = c.blocks.map(x2 => {
          let y2 = c.align && x2.type === 'para' && !x2.align ? { ...x2, align: c.align } : x2;
          if (white && y2.type === 'para') y2 = { ...y2, runs: y2.runs.map(r => (r.color ? r : { ...r, color: ts.headColor })) };
          if ((isHead || c.header) && y2.type === 'para') y2 = { ...y2, runs: y2.runs.map(r => (r.b === false ? r : { ...r, b: true })) };
          return y2;
        });
        const inner = layoutBlocks(blocks, w - pad * 2, true);
        const ch = inner.reduce((a, u) => a + (u.pagebreak ? 0 : u.h), 0);
        const bg = c.bg || (ri === 0 && ts.head) || (ts.band && ri > 0 && ri % 2 === 0 ? ts.band : null);
        cells.push({ x, w, inner, h: ch + pad * 2, bg, borders: c.borders, valign: c.valign, top: ri === 0, left: col === 0, right: col + span >= colW.length });
        col += span;
      }
      const h = Math.max(14, ...cells.map(c => c.h));
      const unit = {
        h, fns: cells.flatMap(c => c.inner.flatMap(u => u.fns || [])), anchors: cells.flatMap(c => c.inner.flatMap(u => u.anchors || [])), row: true,
        draw(page, x0, yTop) {
          const ph = page.getHeight();
          x0 += xOff;
          for (const c of cells) {
            if (c.bg) page.drawRectangle({ x: x0 + c.x, y: ph - yTop - h, width: c.w, height: h, color: rgbOf(PDFLib, c.bg) });
            let y = yTop + pad + (c.valign === 'middle' ? (h - c.h) / 2 : c.valign === 'bottom' ? h - c.h : 0);
            for (const u of c.inner) { if (u.pagebreak) continue; u.draw(page, x0 + c.x + pad, y); y += u.h; }
            if (b.borderless && !c.borders) continue;
            const L = { t: [x0 + c.x, ph - yTop, x0 + c.x + c.w, ph - yTop], b: [x0 + c.x, ph - yTop - h, x0 + c.x + c.w, ph - yTop - h], l: [x0 + c.x, ph - yTop, x0 + c.x, ph - yTop - h], r: [x0 + c.x + c.w, ph - yTop, x0 + c.x + c.w, ph - yTop - h] };
            for (const side of ['t', 'b', 'l', 'r']) {
              const bd = c.borders && c.borders[side];
              if (bd && bd.none) continue;
              if (!bd && (b.borderless || (ts.noV && (side === 'l' || side === 'r')))) continue;
              const [x1, y1, x2, y2] = L[side];
              const wdt = bd ? Math.max(0.3, bd.w || 0.75) : 0.6;
              const colr = rgbOf(PDFLib, bd ? bd.color || '#1A1A1A' : lineCol);
              page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: wdt, color: colr });
              if (bd && bd.style === 'double') { const o = wdt * 1.6; const dx = side === 'l' || side === 'r' ? o : 0, dy = side === 't' || side === 'b' ? o : 0; page.drawLine({ start: { x: x1 + dx, y: y1 + dy }, end: { x: x2 + dx, y: y2 + dy }, thickness: wdt / 2, color: colr }); }
            }
          }
        },
      };
      if (isHead) headUnits.push(unit);
      else if (headUnits.length) unit.repeat = headUnits.slice();
      units.push(unit);
    });
    units.push({ h: 6, space: true, draw() {} });
    return units;
  };

  const layoutSection = (b, width) => {
    const cols = Math.max(1, Math.min(4, b.cols || 2));
    const gap = b.gap || 18;
    const cw = (width - gap * (cols - 1)) / cols;
    const fn0 = footnotes.length, en0 = endnotes.length;
    const inner = layoutBlocks(b.blocks, cw).filter(u => !u.pagebreak);
    const total = inner.reduce((a, u) => a + u.h, 0);
    const pageH = LG.h - LG.mt - LG.mb;
    if (cols === 1 || total / cols > pageH * 0.85) { footnotes.length = fn0; endnotes.length = en0; return layoutBlocks(b.blocks, width); }
    const target = total / cols;
    const columns = [[]];
    let acc = 0;
    for (const u of inner) {
      if (acc + u.h > target + 2 && columns.length < cols && columns[columns.length - 1].length) { columns.push([]); acc = 0; if (u.space) continue; }
      columns[columns.length - 1].push(u); acc += u.h;
    }
    const hs = columns.map(c => c.reduce((a, u) => a + u.h, 0));
    const h = Math.max(...hs);
    return [{ h, fns: inner.flatMap(u => u.fns || []), anchors: inner.flatMap(u => u.anchors || []), draw(page, x, yTop) { columns.forEach((col, i) => { let y = yTop; for (const u of col) { u.draw(page, x + i * (cw + gap), y); y += u.h; } }); } }, { h: 6, space: true, draw() {} }];
  };

  const layoutTextbox = (b, width) => {
    const pad = 6;
    const w = Math.min(width, b.w || width);
    const inner = layoutBlocks(b.blocks, w - pad * 2, true);
    const h = inner.reduce((a, u) => a + (u.pagebreak ? 0 : u.h), 0) + pad * 2;
    const xo = b.float === 'right' ? width - w : 0;
    return [{ h, fns: inner.flatMap(u => u.fns || []), anchors: inner.flatMap(u => u.anchors || []), draw(page, x, yTop) {
      const ph = page.getHeight();
      if (b.bg) page.drawRectangle({ x: x + xo, y: ph - yTop - h, width: w, height: h, color: rgbOf(PDFLib, b.bg) });
      let y = yTop + pad;
      for (const u of inner) { if (u.pagebreak) continue; u.draw(page, x + xo + pad, y); y += u.h; }
      page.drawRectangle({ x: x + xo, y: ph - yTop - h, width: w, height: h, borderColor: rgbOf(PDFLib, b.border || '#8086A6'), borderWidth: 0.75 });
    } }, { h: 6, space: true, draw() {} }];
  };

  const layoutToc = (b, width) => {
    const units = [];
    const entries = tocEntries(model, b);
    const tocTitle = b.title || 'Inhaltsverzeichnis';
    const tf = fk.pick(tocTitle, 'sans', true, false), ef = fk.sync('sans', false, false);
    const title = safeText(tocTitle, tf);
    units.push({ h: 28, draw(page, x, yTop) { page.drawText(title, { x, y: page.getHeight() - yTop - 18, size: 15, font: tf, color: rgbOf(PDFLib, '#1B1E33') }); } });
    if (!entries.length) units.push({ h: 18, draw(page, x, yTop) { page.drawText(safeText(b.kind === 'captions' ? '(Noch keine Beschriftungen)' : '(Noch keine Überschriften)', ef), { x, y: page.getHeight() - yTop - 13, size: 10, font: ef, color: rgbOf(PDFLib, '#8086A6') }); } });
    entries.forEach(en => {
      const size = en.level === 1 ? 11 : 10;
      const bold = en.level === 1 && b.kind !== 'captions';
      const font = fk.pick(en.text, 'sans', bold, false);
      const ind = (en.level - 1) * 14;
      units.push({ h: size * 1.75, draw(page, x, yTop) {
        const yy = page.getHeight() - yTop - size * 1.25;
        const num = safeText(pageText(blockPages.get(en.index)), font);
        const nw = font.widthOfTextAtSize(num, size);
        let t = safeText(en.text, font);
        const maxW = width - ind - nw - 24;
        while (t.length > 1 && font.widthOfTextAtSize(t, size) > maxW) t = t.slice(0, -2) + '…';
        page.drawText(t, { x: x + ind, y: yy, size, font, color: rgbOf(PDFLib, '#1A1A1A') });
        const start = x + ind + font.widthOfTextAtSize(t, size) + 6, end = x + width - nw - 6;
        const dot = ef.widthOfTextAtSize('.', size);
        if (end > start + dot) page.drawText('.'.repeat(Math.floor((end - start) / (dot + 1.2))), { x: start, y: yy, size, font: ef, color: rgbOf(PDFLib, '#A6ABBD'), characterSpacing: 1.2 });
        page.drawText(num, { x: x + width - nw, y: yy, size, font, color: rgbOf(PDFLib, '#1A1A1A') });
        pendingLinks.push({ page, rect: [x + ind, yy - 3, x + width, yy + size], block: en.index });
      } });
    });
    units.push({ h: 14, space: true, draw() {} });
    return units;
  };

  function layoutBlocks(blocks, width, inCell = false, baseIdx = null) {
    const units = [];
    blocks.forEach((b, i) => {
      const gi = baseIdx == null ? null : baseIdx + i;
      if (b.type === 'toc' && !inCell) { units.push(...layoutToc(b, width)); return; }
      if (b.type === 'para') {
        if (b.pageBreakBefore && !inCell && (gi == null ? i > 0 : gi > 0)) units.push({ pagebreak: true, h: 0, draw() {} });
        let u = layoutPara(b, width);
        if (gi != null) { const first = u.find(x => !x.space); if (first) { first.blockIdx = gi; if (/^h[1-6]$/.test(b.tag)) first.heading = { level: +b.tag[1], title: (b.hnum ? `${b.hnum} ` : '') + runsText(b.runs) }; } }
        if (inCell) {
          if (i === 0) while (u.length && u[0].space) u.shift();
          if (i === blocks.length - 1) while (u.length && u[u.length - 1].space) u.pop();
        }
        units.push(...u);
      } else if (b.type === 'table') units.push(...layoutTable(b, width));
      else if (b.type === 'section') units.push(...layoutSection(b, width));
      else if (b.type === 'textbox') units.push(...layoutTextbox(b, width));
      else if (b.type === 'pagebreak') { if (!inCell) units.push({ pagebreak: true, h: 0, draw() {} }); }
      else if (b.type === 'hr') units.push({ h: 12, draw(page, x, yTop) { const y = page.getHeight() - yTop - 6; page.drawLine({ start: { x, y }, end: { x: x + width, y }, thickness: 0.8, color: rgbOf(PDFLib, '#A6ABBD') }); } });
    });
    return units;
  }

  // ---------- top level: sections with their own page geometry ----------
  const units = [];
  let firstGeom = pg;
  {
    let width = contentW;
    let started = false;
    model.blocks.forEach((b, i) => {
      if (b.type === 'pagebreak' && b.section) {
        const g = geomOf(b.orient || (LG.w > LG.h ? 'landscape' : 'portrait'));
        LG = g; width = g.w - g.ml - g.mr;
        if (!started) { firstGeom = g; return; }
        units.push({ pagebreak: true, geom: g, h: 0, draw() {} });
        return;
      }
      started = true;
      units.push(...layoutBlocks([b], width, false, i));
    });
  }
  // endnotes at the end of the document
  if (endnotes.length) {
    const ef = fk.sync('sans', true, false);
    units.push({ h: 18, space: false, draw(page, x, yTop) { const y = page.getHeight() - yTop - 10; page.drawLine({ start: { x, y }, end: { x: x + 120, y }, thickness: 0.6, color: rgbOf(PDFLib, '#A6ABBD') }); } });
    units.push({ h: 18, draw(page, x, yTop) { page.drawText(safeText('Endnoten', ef), { x, y: page.getHeight() - yTop - 12, size: 11, font: ef, color: rgbOf(PDFLib, '#1B1E33') }); } });
    const notes = endnotes.slice();
    notes.forEach((t, k) => units.push(...layoutPara({ type: 'para', tag: 'p', runs: [{ text: `${pageLabel(k + 1, 'i')}.\t`, size: 9 }, { text: t, size: 9 }], tabs: [20], after: 3 }, LG.w - LG.ml - LG.mr)));
    endnotes.length = notes.length;
  }

  // ---------- paginate (dry run for tables of contents / page references, then for real) ----------
  const fnFont = fk.sync('sans', false, false);
  const fnFontOf = n => fk.pick(footnotes[n - 1] || '');
  const fnLines = (n, cw) => wrapPlain(safeText(footnotes[n - 1] || '', fnFontOf(n)), fnFontOf(n), FN_SIZE, cw - 14);
  const fnHeight = (n, cw) => fnLines(n, cw).length * FN_SIZE * 1.3 + 2;
  const wm = hf && hf.watermark && hf.watermark.text ? hf.watermark : null;
  function drawWatermark(p) {
    const font = fk.pick(wm.text, 'sans', true, false);
    const t = safeText(wm.text, font);
    const { width: W, height: H } = p.getSize();
    const diag = Math.sqrt(W * W + H * H);
    const size = Math.min(110, (diag * 0.62) / Math.max(1, font.widthOfTextAtSize(t, 1)));
    const w = font.widthOfTextAtSize(t, size);
    const a = Math.atan2(H, W);
    const cx = W / 2, cy = H / 2;
    const x = cx - (w / 2) * Math.cos(a) + (size * 0.35) * Math.sin(a);
    const y = cy - (w / 2) * Math.sin(a) - (size * 0.35) * Math.cos(a);
    p.drawText(t, { x, y, size, font, color: rgbOf(PDFLib, /^#[0-9a-f]{6}$/i.test(wm.color || '') ? wm.color : '#B4B8CC'), opacity: Math.max(0.05, Math.min(1, +wm.opacity || 0.45)), rotate: PDFLib.degrees(a * 180 / Math.PI) });
  }
  function drawFootnotes(pdfPage, G, list, total) {
    if (!list.length) return;
    const cw = G.w - G.ml - G.mr;
    let y = G.mb + total;
    pdfPage.drawLine({ start: { x: G.ml, y: y + 2 }, end: { x: G.ml + 120, y: y + 2 }, thickness: 0.6, color: rgbOf(PDFLib, '#A6ABBD') });
    for (const n of list) {
      const lines = fnLines(n, cw);
      y -= FN_SIZE * 1.3;
      pdfPage.drawText(String(n), { x: G.ml, y: y + 2.5, size: FN_SIZE * 0.75, font: fnFont, color: rgbOf(PDFLib, '#1A1A1A') });
      lines.forEach((ln, k) => { if (k) y -= FN_SIZE * 1.3; pdfPage.drawText(ln, { x: G.ml + 12, y, size: FN_SIZE, font: fnFontOf(n), color: rgbOf(PDFLib, '#2B2F4A') }); });
      y -= 2;
    }
  }
  function paginate(draw) {
    let G = firstGeom;
    const newPage = () => { if (!draw) return null; const p = pdf.addPage([G.w, G.h]); if (wm) drawWatermark(p); return p; };
    let pdfPage = newPage();
    let pageNo = 1, y = G.mt, fnH = 0, pageFns = [];
    const finish = () => { if (draw) drawFootnotes(pdfPage, G, pageFns, fnH); };
    const next = () => { finish(); pageNo++; pdfPage = newPage(); y = G.mt; fnH = 0; pageFns = []; };
    let n = 0;
    for (let ui = 0; ui < units.length; ui++) {
      const u = units[ui];
      if (u.pagebreak) { if (u.geom) { finish(); G = u.geom; pageNo++; pdfPage = newPage(); y = G.mt; fnH = 0; pageFns = []; } else next(); continue; }
      if (u.space && y === G.mt) continue;
      const cw = G.w - G.ml - G.mr;
      const need = () => (u.fns && u.fns.length ? u.fns.reduce((a, k) => a + fnHeight(k, cw), 0) + (pageFns.length ? 0 : 8) : 0);
      // keep with next: this paragraph's first line + the first line of what follows must fit
      let keepH = u.h;
      if (u.keepNext) { let extra = 0; for (let j = ui + 1; j < units.length && extra < 2; j++) { if (units[j].pagebreak) break; if (units[j].space) continue; keepH += units[j].h; extra++; } }
      if (y + keepH > G.h - G.mb - fnH - need() && y > G.mt && keepH < (G.h - G.mt - G.mb) * 0.5) {
        if (u.space) continue;
        next();
        if (u.repeat && draw) for (const hu of u.repeat) { hu.draw(pdfPage, G.ml, y); y += hu.h; }
        else if (u.repeat) for (const hu of u.repeat) y += hu.h;
      } else if (y + u.h > G.h - G.mb - fnH - need() && y > G.mt) {
        if (u.space) continue;
        next();
        if (u.repeat) for (const hu of u.repeat) { if (draw) hu.draw(pdfPage, G.ml, y); y += hu.h; }
      }
      if (u.blockIdx != null && !draw) blockPages.set(u.blockIdx, pageNo - 1);
      if (u.anchors && u.anchors.length && !draw) u.anchors.forEach(a => { if (!anchorPages.has(a)) anchorPages.set(a, pageNo - 1); });
      if (draw) {
        u.draw(pdfPage, G.ml, y);
        if (u.blockIdx != null) blockPos.set(u.blockIdx, { page: pdfPage, y: G.h - y + 2 });
        if (u.heading) outline.push({ ...u.heading, page: pdfPage, y: G.h - y + 2 });
      }
      if (u.fns && u.fns.length) { fnH += need(); pageFns.push(...u.fns); }
      y += u.h;
      if (draw && onProgress && ++n % 200 === 0) onProgress(n / units.length);
    }
    finish();
    return pageNo;
  }
  const needsDry = measureOnly || model.blocks.some(b => b.type === 'toc') || units.some(u => u.xpages);
  if (needsDry) {
    const fn0 = footnotes.slice();
    paginate(false);
    footnotes.length = 0; footnotes.push(...fn0);
  }
  if (measureOnly) return new Map([...blockPages.entries()].map(([k, v]) => [k, pageText(v)]));
  paginate(true);
  drawHeaderFooter(PDFLib, pdf, fk, pg, hf, title);
  addInternalLinks(PDFLib, pdf, pendingLinks, blockPos, anchorPos);
  addOutline(PDFLib, pdf, outline);
  return pdf.save({ useObjectStreams: true });
}

/** Kopf-/Fußzeile (drei Bereiche, Felder, erste/gerade Seiten) und Seitenzahlen auf alle Seiten. */
function drawHeaderFooter(PDFLib, pdf, fk, pg, hf, title = '') {
  if (!hf) return;
  const pages = pdf.getPages();
  const total = pages.length;
  const size = 9;
  const col = rgbOf(PDFLib, '#5A607F');
  pages.forEach((page, i) => {
    const { width: W, height: H } = page.getSize();
    const yh = H - Math.max(18, pg.mt * 0.5), yf = Math.max(14, pg.mb * 0.45);
    for (const [where, y] of [['h', yh], ['f', yf]]) {
      const zones = hfTexts(hf, i, where, { pages: total, title });
      zones.forEach((text, k) => {
        if (!text) return;
        const font = fk.pick(text);
        const t = safeText(text, font);
        if (!t) return;
        const w = font.widthOfTextAtSize(t, size);
        const x = k === 2 ? W - pg.mr - w : k === 1 ? (W - w) / 2 : pg.ml;
        page.drawText(t, { x, y, size, font, color: col });
      });
    }
  });
}

/** Link annotations to places inside the document (table of contents, internal links, cross references). */
function addInternalLinks(PDFLib, pdf, links, blockPos, anchorPos) {
  const ctx = pdf.context;
  for (const l of links) {
    const dest = l.block != null ? blockPos.get(l.block) : anchorPos.get(l.anchor);
    if (!dest) continue;
    try {
      const annot = ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: l.rect, Border: [0, 0, 0], Dest: [dest.page.ref, 'XYZ', null, dest.y, null] });
      l.page.node.addAnnot(ctx.register(annot));
    } catch (e) { console.warn('interner Link', e); }
  }
}

/** PDF bookmarks (outline) from the headings, nested by level. */
function addOutline(PDFLib, pdf, items) {
  if (!items.length) return;
  const ctx = pdf.context;
  const root = { ref: ctx.nextRef(), kids: [], level: 0 };
  const stack = [root];
  for (const it of items) {
    while (stack.length > 1 && stack[stack.length - 1].level >= it.level) stack.pop();
    const node = { ref: ctx.nextRef(), kids: [], level: it.level, it, parent: stack[stack.length - 1] };
    node.parent.kids.push(node);
    stack.push(node);
  }
  const count = n => n.kids.reduce((a, k) => a + 1 + count(k), 0);
  const write = n => {
    n.kids.forEach((k, i) => {
      const d = {
        Title: PDFLib.PDFHexString.fromText(String(k.it.title || '').slice(0, 300) || '–'),
        Parent: n.ref,
        Dest: [k.it.page.ref, 'XYZ', null, k.it.y, null],
      };
      if (i > 0) d.Prev = n.kids[i - 1].ref;
      if (i < n.kids.length - 1) d.Next = n.kids[i + 1].ref;
      if (k.kids.length) { d.First = k.kids[0].ref; d.Last = k.kids[k.kids.length - 1].ref; d.Count = k.level < 2 ? count(k) : -count(k); }
      ctx.assign(k.ref, ctx.obj(d));
      write(k);
    });
  };
  write(root);
  ctx.assign(root.ref, ctx.obj({ Type: 'Outlines', First: root.kids[0].ref, Last: root.kids[root.kids.length - 1].ref, Count: count(root) }));
  pdf.catalog.set(PDFLib.PDFName.of('Outlines'), root.ref);
  pdf.catalog.set(PDFLib.PDFName.of('PageMode'), PDFLib.PDFName.of('UseOutlines'));
}

/** Plain text → PDF (monospace-free, wrapped). */
export async function textToPdf(text, { title = 'Text' } = {}) {
  const blocks = String(text).replace(/\r\n?/g, '\n').split('\n').map(l => ({ type: 'para', tag: 'p', runs: l ? [{ text: l }] : [] }));
  return modelToPdf({ blocks, baseSize: 11, tight: true }, { title });
}
