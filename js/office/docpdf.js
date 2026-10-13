// Document model → PDF (pdf-lib, standard fonts). Real text (searchable), line wrapping,
// headings, lists, tables, images, links and page breaks.
import { loadPdfLib } from '../pdflib.js';
import { fontKit, winAnsi, rgbOf, addLink, wrapPlain } from './pdftext.js';
import { imageToBytes } from './vendor.js';
import { HEADING_PT, PARA_SPACE, listLabel, modelHeadings } from './docmodel.js';

const HEAD_COLOR = { h1: '#1B1E33', h2: '#1B1E33', h3: '#2B2F4A', h4: '#2B2F4A', h5: '#2B2F4A', h6: '#2B2F4A', subtitle: '#5A607F' };
const LIST_INDENT = 20;
const LINE = 1.3;

export async function modelToPdf(model, { title = 'Dokument', page = null, hf = null, onProgress, measureOnly = false } = {}) {
  const PDFLib = await loadPdfLib();
  const pdf = await PDFLib.PDFDocument.create();
  pdf.setTitle(title);
  pdf.setProducer('FaLe PDF');
  pdf.setCreator('FaLe PDF');
  const fk = await fontKit(pdf);
  const base = model.baseSize || 11;
  const pg = page || { w: 595.3, h: 841.9, mt: 70.9, mr: 70.9, mb: 56.7, ml: 70.9 };
  const contentW = pg.w - pg.ml - pg.mr;

  // fonts + images up front so layout is synchronous
  const images = new Map();
  let needSerif = false, needMono = false;
  const scan = blocks => blocks.forEach(b => {
    if (b.type === 'para') b.runs.forEach(r => { if (r.img) images.set(r.img.src, null); if (r.serif) needSerif = true; if (r.mono) needMono = true; });
    if (b.type === 'table') b.rows.forEach(row => row.forEach(c => scan(c.blocks)));
  });
  scan(model.blocks);
  if (needSerif) await fk.ensure('serif');
  if (needMono) await fk.ensure('mono');
  for (const src of images.keys()) {
    try {
      const im = await imageToBytes(src, { maxSide: 2000 });
      images.set(src, { img: im.type === 'png' ? await pdf.embedPng(im.bytes) : await pdf.embedJpg(im.bytes), w: im.width, h: im.height });
    } catch (e) { console.warn('Bild übersprungen', e); }
  }

  const fontFor = r => fk.sync(r.mono ? 'mono' : r.serif ? 'serif' : 'sans', !!r.b, !!r.i);
  const footnotes = []; // texts, numbered in reading order
  const headingPages = new Map();
  const FN_SIZE = 8.5;

  // ---------- layout: blocks → units ----------
  // unit: { h, draw(page, x, yTop), space?, pagebreak? }
  const layoutPara = (b, width, x0Offset = 0) => {
    const units = [];
    const tag = b.tag || 'p';
    const head = HEADING_PT[tag];
    const defSize = head || base;
    const sp = b.tight || model.tight ? [0, 0] : PARA_SPACE[b.list ? 'li' : tag] || PARA_SPACE.p;
    let indent = (b.indent || 0) + x0Offset;
    let marker = null;
    if (b.list) {
      indent += LIST_INDENT * (b.list.level + 1);
      marker = b.list.ordered ? listLabel(b.list) : ['•', '–', '•'][b.list.level % 3];
    }
    const avail = Math.max(40, width - indent);
    // tokens
    const tokens = [];
    for (const r of b.runs) {
      if (r.br) { tokens.push({ br: true }); continue; }
      if (r.fn != null) {
        footnotes.push(r.fn);
        const n = footnotes.length;
        const st = { size: defSize * 0.65, rise: defSize * 0.38, color: null };
        const font = fontFor({});
        tokens.push({ text: String(n), st, font, w: font.widthOfTextAtSize(String(n), st.size) + 0.5, fnRef: n });
        continue;
      }
      if (r.img) {
        const im = images.get(r.img.src);
        if (!im) continue;
        let w = (r.img.w || im.w) * 0.75, h = (r.img.h || im.h * ((r.img.w || im.w) / im.w)) * 0.75;
        const maxH = pg.h - pg.mt - pg.mb - 20;
        const s = Math.min(1, avail / w, maxH / h);
        tokens.push({ img: im.img, w: w * s, h: h * s });
        continue;
      }
      const st = {
        b: r.b || (head && r.b !== false), i: r.i, u: r.u || !!r.href, s: r.s, mono: r.mono, serif: r.serif,
        size: (r.size || defSize) * (r.sup || r.sub ? 0.7 : 1), rise: r.sup ? defSize * 0.35 : r.sub ? -defSize * 0.15 : 0,
        color: r.color || (r.href ? '#0563C1' : head || tag === 'subtitle' ? HEAD_COLOR[tag] : null), bg: r.bg, href: r.href,
      };
      const font = fontFor(st);
      const text = winAnsi(r.text);
      for (const piece of text.split(/(\s+)/)) {
        if (!piece) continue;
        const space = /^\s+$/.test(piece);
        tokens.push({ text: piece, space, st, font, w: font.widthOfTextAtSize(piece, st.size) });
      }
    }
    // lines
    const lines = [];
    let line = { items: [], w: 0 };
    const pushLine = (forced) => {
      while (line.items.length && line.items[line.items.length - 1].space) { line.w -= line.items.pop().w; }
      line.forced = forced;
      lines.push(line);
      line = { items: [], w: 0 };
    };
    for (const t of tokens) {
      if (t.br) { pushLine(true); continue; }
      if (t.space && !line.items.length) continue;
      if (line.w + t.w > avail && line.items.length && !t.space) pushLine(false);
      if (t.space && line.w + t.w > avail) { pushLine(false); continue; }
      if (!t.img && t.w > avail) {
        // split very long word
        let part = '';
        for (const ch of t.text) {
          const pw = t.font.widthOfTextAtSize(part + ch, t.st.size);
          if (line.w + pw > avail && part) {
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
    if (b.bg || lines.length) {
      if (sp[0]) units.push({ h: sp[0], space: true, draw() {} });
    }
    lines.forEach((ln, li) => {
      const maxSize = Math.max(defSize, ...ln.items.filter(i => i.st).map(i => i.st.size));
      const imgH = Math.max(0, ...ln.items.filter(i => i.img).map(i => i.h));
      const textH = maxSize * LINE;
      const h = Math.max(textH, imgH + maxSize * 0.3);
      const ascent = Math.max(maxSize * 0.95, imgH);
      const isLast = li === lines.length - 1;
      units.push({
        h, fns: ln.items.filter(i => i.fnRef).map(i => i.fnRef),
        draw(page, x, yTop) {
          const ph = page.getHeight();
          let lx = x + indent;
          const free = avail - ln.w;
          let gap = 0;
          if (b.align === 'center') lx += free / 2;
          else if (b.align === 'right') lx += free;
          else if (b.align === 'justify' && !isLast && !ln.forced) {
            const spaces = ln.items.filter(i => i.space).length;
            if (spaces) gap = free / spaces;
          }
          if (b.bg) page.drawRectangle({ x: x + indent - 3, y: ph - yTop - h, width: avail + 6, height: h, color: rgbOf(PDFLib, b.bg) });
          if (li === 0 && marker) {
            const mf = fk.sync('sans', false, false);
            const ms = defSize;
            const mt = winAnsi(marker);
            page.drawText(mt, { x: x + indent - mf.widthOfTextAtSize(mt, ms) - 5, y: ph - yTop - ascent, size: ms, font: mf, color: rgbOf(PDFLib, null) });
          }
          const baseline = ph - yTop - ascent;
          for (const it of ln.items) {
            if (it.img) {
              page.drawImage(it.img, { x: lx, y: baseline, width: it.w, height: it.h });
              lx += it.w; continue;
            }
            const w = it.w + (it.space ? gap : 0);
            if (it.st.bg) page.drawRectangle({ x: lx, y: baseline - it.st.size * 0.22, width: w, height: it.st.size * 1.15, color: rgbOf(PDFLib, it.st.bg) });
            if (!it.space) page.drawText(it.text, { x: lx, y: baseline + it.st.rise, size: it.st.size, font: it.font, color: rgbOf(PDFLib, it.st.color) });
            const col = rgbOf(PDFLib, it.st.color);
            if (it.st.u) page.drawLine({ start: { x: lx, y: baseline - it.st.size * 0.12 }, end: { x: lx + w, y: baseline - it.st.size * 0.12 }, thickness: Math.max(0.5, it.st.size / 18), color: col });
            if (it.st.s) page.drawLine({ start: { x: lx, y: baseline + it.st.size * 0.3 }, end: { x: lx + w, y: baseline + it.st.size * 0.3 }, thickness: Math.max(0.5, it.st.size / 18), color: col });
            if (it.st.href && !it.space && /^(https?:|mailto:|tel:)/i.test(it.st.href)) addLink(PDFLib, pdf, page, [lx, baseline - 2, lx + w, baseline + it.st.size], it.st.href);
            lx += w;
          }
        },
      });
    });
    if (sp[1]) units.push({ h: sp[1], space: true, draw() {} });
    return units;
  };

  const layoutTable = (b, width) => {
    const units = [];
    const pad = 4;
    const colW = b.widths.map(p => (p / 100) * width);
    // occupancy grid for rowspans
    const occupied = [];
    b.rows.forEach((row, ri) => {
      occupied[ri] = occupied[ri] || [];
      let col = 0;
      const cells = [];
      for (const c of row) {
        while (occupied[ri][col]) col++;
        const span = Math.min(c.colspan || 1, Math.max(1, colW.length - col));
        const x = colW.slice(0, col).reduce((a, v) => a + v, 0);
        const w = colW.slice(col, col + span).reduce((a, v) => a + v, 0);
        for (let r = 0; r < (c.rowspan || 1); r++) for (let k = 0; k < span; k++) { occupied[ri + r] = occupied[ri + r] || []; occupied[ri + r][col + k] = true; }
        const inner = layoutBlocks(c.blocks.map(x2 => (c.align && x2.type === 'para' && !x2.align ? { ...x2, align: c.align } : x2)), w - pad * 2, true);
        const ch = inner.reduce((a, u) => a + (u.pagebreak ? 0 : u.h), 0);
        cells.push({ x, w, inner, h: ch + pad * 2, bg: c.bg });
        col += span;
      }
      const h = Math.max(14, ...cells.map(c => c.h));
      units.push({
        h, fns: cells.flatMap(c => c.inner.flatMap(u => u.fns || [])),
        draw(page, x0, yTop) {
          const ph = page.getHeight();
          for (const c of cells) {
            if (c.bg) page.drawRectangle({ x: x0 + c.x, y: ph - yTop - h, width: c.w, height: h, color: rgbOf(PDFLib, c.bg) });
            let y = yTop + pad;
            for (const u of c.inner) { if (u.pagebreak) continue; u.draw(page, x0 + c.x + pad, y); y += u.h; }
            if (!b.borderless) page.drawRectangle({ x: x0 + c.x, y: ph - yTop - h, width: c.w, height: h, borderColor: rgbOf(PDFLib, '#A6ABBD'), borderWidth: 0.6 });
          }
        },
      });
    });
    units.push({ h: 6, space: true, draw() {} });
    return units;
  };

  const layoutToc = (b, width) => {
    const units = [];
    const entries = modelHeadings(model, b.depth || 3);
    const tf = fk.sync('sans', true, false), ef = fk.sync('sans', false, false), ebf = fk.sync('sans', true, false);
    const title = winAnsi(b.title || 'Inhaltsverzeichnis');
    units.push({ h: 28, draw(page, x, yTop) { page.drawText(title, { x, y: page.getHeight() - yTop - 18, size: 15, font: tf, color: rgbOf(PDFLib, '#1B1E33') }); } });
    if (!entries.length) units.push({ h: 18, draw(page, x, yTop) { page.drawText(winAnsi('(Noch keine Überschriften)'), { x, y: page.getHeight() - yTop - 13, size: 10, font: ef, color: rgbOf(PDFLib, '#8086A6') }); } });
    entries.forEach(en => {
      const size = en.level === 1 ? 11 : 10;
      const font = en.level === 1 ? ebf : ef;
      const ind = (en.level - 1) * 14;
      units.push({ h: size * 1.75, draw(page, x, yTop) {
        const yy = page.getHeight() - yTop - size * 1.25;
        const num = String(headingPages.get(en.index) || '');
        const nw = font.widthOfTextAtSize(num, size);
        let t = winAnsi(en.text);
        const maxW = width - ind - nw - 24;
        while (t.length > 1 && font.widthOfTextAtSize(t, size) > maxW) t = t.slice(0, -2) + '…';
        page.drawText(t, { x: x + ind, y: yy, size, font, color: rgbOf(PDFLib, '#1A1A1A') });
        const start = x + ind + font.widthOfTextAtSize(t, size) + 6, end = x + width - nw - 6;
        const dot = ef.widthOfTextAtSize('.', size);
        if (end > start + dot) page.drawText('.'.repeat(Math.floor((end - start) / (dot + 1.2))), { x: start, y: yy, size, font: ef, color: rgbOf(PDFLib, '#A6ABBD'), characterSpacing: 1.2 });
        page.drawText(num, { x: x + width - nw, y: yy, size, font, color: rgbOf(PDFLib, '#1A1A1A') });
      } });
    });
    units.push({ h: 14, space: true, draw() {} });
    return units;
  };

  function layoutBlocks(blocks, width, inCell = false) {
    const units = [];
    blocks.forEach((b, i) => {
      if (b.type === 'toc' && !inCell) { units.push(...layoutToc(b, width)); return; }
      if (b.type === 'para') {
        let u = layoutPara(b, width);
        if (!inCell && /^h[1-6]$/.test(b.tag)) { const first = u.find(x => !x.space); if (first) first.headingIdx = i; }
        if (inCell) {
          if (i === 0) while (u.length && u[0].space) u.shift();
          if (i === blocks.length - 1) while (u.length && u[u.length - 1].space) u.pop();
        }
        units.push(...u);
      } else if (b.type === 'table') units.push(...layoutTable(b, width));
      else if (b.type === 'pagebreak') { if (!inCell) units.push({ pagebreak: true, h: 0, draw() {} }); }
      else if (b.type === 'hr') units.push({ h: 12, draw(page, x, yTop) { const y = page.getHeight() - yTop - 6; page.drawLine({ start: { x, y }, end: { x: x + width, y }, thickness: 0.8, color: rgbOf(PDFLib, '#A6ABBD') }); } });
    });
    return units;
  }

  // ---------- paginate (dry run for the table of contents, then for real) ----------
  const units = layoutBlocks(model.blocks, contentW);
  const fnFont = fk.sync('sans', false, false);
  const fnLines = n => wrapPlain(winAnsi(footnotes[n - 1] || ''), fnFont, FN_SIZE, contentW - 14);
  const fnHeight = n => fnLines(n).length * FN_SIZE * 1.3 + 2;
  function drawFootnotes(pdfPage, list, total) {
    if (!list.length) return;
    let y = pg.mb + total;
    pdfPage.drawLine({ start: { x: pg.ml, y: y + 2 }, end: { x: pg.ml + 120, y: y + 2 }, thickness: 0.6, color: rgbOf(PDFLib, '#A6ABBD') });
    for (const n of list) {
      const lines = fnLines(n);
      y -= FN_SIZE * 1.3;
      pdfPage.drawText(String(n), { x: pg.ml, y: y + 2.5, size: FN_SIZE * 0.75, font: fnFont, color: rgbOf(PDFLib, '#1A1A1A') });
      lines.forEach((ln, k) => { if (k) y -= FN_SIZE * 1.3; pdfPage.drawText(ln, { x: pg.ml + 12, y, size: FN_SIZE, font: fnFont, color: rgbOf(PDFLib, '#2B2F4A') }); });
      y -= 2;
    }
  }
  function paginate(draw) {
    let pdfPage = draw ? pdf.addPage([pg.w, pg.h]) : null;
    let pageNo = 1, y = pg.mt, fnH = 0, pageFns = [];
    const finish = () => { if (draw) drawFootnotes(pdfPage, pageFns, fnH); };
    const next = () => { finish(); pageNo++; pdfPage = draw ? pdf.addPage([pg.w, pg.h]) : null; y = pg.mt; fnH = 0; pageFns = []; };
    let n = 0;
    for (const u of units) {
      if (u.pagebreak) { next(); continue; }
      if (u.space && y === pg.mt) continue;
      const need = () => (u.fns && u.fns.length ? u.fns.reduce((a, k) => a + fnHeight(k), 0) + (pageFns.length ? 0 : 8) : 0);
      if (y + u.h > pg.h - pg.mb - fnH - need() && y > pg.mt) {
        if (u.space) continue;
        next();
      }
      if (u.headingIdx != null && !draw) headingPages.set(u.headingIdx, pageNo);
      if (draw) u.draw(pdfPage, pg.ml, y);
      if (u.fns && u.fns.length) { fnH += need(); pageFns.push(...u.fns); }
      y += u.h;
      if (draw && onProgress && ++n % 200 === 0) onProgress(n / units.length);
    }
    finish();
    return pageNo;
  }
  if (measureOnly || model.blocks.some(b => b.type === 'toc')) paginate(false);
  if (measureOnly) return headingPages;
  paginate(true);
  drawHeaderFooter(PDFLib, pdf, fk, pg, hf, title);
  return pdf.save({ useObjectStreams: true });
}

/** Kopf-/Fußzeile und Seitenzahlen auf alle Seiten. hf: { header, headerAlign, footer, footerAlign, pageNumbers, pageFormat, firstPage } */
function drawHeaderFooter(PDFLib, pdf, fk, pg, hf) {
  if (!hf) return;
  const pages = pdf.getPages();
  const total = pages.length;
  const font = fk.sync('sans', false, false);
  const size = 9;
  const col = rgbOf(PDFLib, '#5A607F');
  const place = (page, text, align, y) => {
    const t = winAnsi(text);
    if (!t) return;
    const w = font.widthOfTextAtSize(t, size);
    const x = align === 'right' ? pg.w - pg.mr - w : align === 'center' ? (pg.w - w) / 2 : pg.ml;
    page.drawText(t, { x, y, size, font, color: col });
  };
  pages.forEach((page, i) => {
    if (hf.firstPage === false && i === 0) return;
    const num = hf.pageFormat === 'n-of-m' ? `Seite ${i + 1} von ${total}` : String(i + 1);
    const yh = pg.h - Math.max(18, pg.mt * 0.5), yf = Math.max(14, pg.mb * 0.45);
    const pn = hf.pageNumbers || 'none';
    let header = hf.header || '', footer = hf.footer || '';
    const hAlign = hf.headerAlign || 'left', fAlign = hf.footerAlign || 'left';
    if (pn.startsWith('header')) { const a = pn.split('-')[1]; if (header && hAlign === a) header += ` · ${num}`; else place(page, num, a, yh); }
    if (pn.startsWith('footer')) { const a = pn.split('-')[1]; if (footer && fAlign === a) footer += ` · ${num}`; else place(page, num, a, yf); }
    place(page, header, hAlign, yh);
    place(page, footer, fAlign, yf);
  });
}

/** Plain text → PDF (monospace-free, wrapped). */
export async function textToPdf(text, { title = 'Text' } = {}) {
  const blocks = String(text).replace(/\r\n?/g, '\n').split('\n').map(l => ({ type: 'para', tag: 'p', runs: l ? [{ text: l }] : [] }));
  return modelToPdf({ blocks, baseSize: 11, tight: true }, { title });
}
