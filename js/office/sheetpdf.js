// Workbook → PDF: table pages with optional grid and row/column headings, fills, borders, wrapped text, data bars,
// repeated title rows, print area, orientation, fit to width/page and page numbers ("Seite einrichten").
import { loadPdfLib } from '../pdflib.js';
import { fontKit, safeText, needsUnicodeDeep, rgbOf } from './pdftext.js';
import { KEY, displayOf, DEFAULT_COL_W, ROW_H } from './workbook.js';
import { colName, isErr } from './formula.js';
import { tick } from './vendor.js';
import { cfStyle, filterHidden, ensureSheetExtras, pageOf, parseRange } from './sheetfx.js';

const A4 = [595.28, 841.89];
const MARGINS = { narrow: 18, normal: 28, wide: 54 };

export async function workbookToPdf(wb, { title = 'Tabelle', onProgress } = {}) {
  const PDFLib = await loadPdfLib();
  const pdf = await PDFLib.PDFDocument.create();
  pdf.setTitle(title); pdf.setProducer('FaLe PDF'); pdf.setCreator('FaLe PDF');
  const fk = await fontKit(pdf);
  // Unicode face only when a sheet name or cell needs it (Polish, Greek, Cyrillic …)
  if (needsUnicodeDeep(wb.sheets.map(s => [s.name, s.cells, [...(s.notes || new Map()).values()].map(n => n.text)]))) await fk.ensureUnicode();
  const regular = fk.sync('sans', false, false);
  const grid = rgbOf(PDFLib, '#C9CCDA'), headBg = rgbOf(PDFLib, '#EEF0F8'), headTxt = rgbOf(PDFLib, '#4F5475');
  const FS = 9, RH = 15;
  wb.sheets.forEach(ensureSheetExtras);
  const sheets = wb.sheets.filter(s => !s.hidden && (s.maxR >= 0 || (s.charts && s.charts.length)));
  if (!sheets.length) { const p = pdf.addPage(A4); p.drawText('Leere Tabelle', { x: 28, y: 800, size: 12, font: regular }); return pdf.save(); }
  let done = 0;
  const totalRows = sheets.reduce((a, s) => a + s.maxR + 1, 0);
  const numbered = []; // pages that get "Seite x von y": {page, sheetPages}
  for (const sh of sheets) {
    const pg = pageOf(sh);
    const M = MARGINS[pg.margins] || 28;
    const cfCache = new Map();
    const hiddenRows = new Set([...(sh.hiddenRows || []), ...filterHidden(sh)]);
    if (sh.maxR < 0) { await chartPages(sh, M); continue; }
    // printed block: print area or the used range (incl. merges)
    const area = pg.area && parseRange(pg.area);
    const R1 = area ? area.r1 : 0, C1 = area ? area.c1 : 0;
    const R2 = area ? Math.min(area.r2, Math.max(sh.maxR, area.r1)) : sh.maxR;
    const C2 = area ? area.c2 : Math.max(sh.maxC, ...sh.merges.filter(m => m.r1 <= sh.maxR).map(m => m.c2));
    const cols = [];
    for (let c = C1; c <= C2; c++) { const w = sh.colW[c]; if (w !== 0) cols.push({ c, w: (w == null ? DEFAULT_COL_W : w) * 0.75 }); }
    if (!cols.length) continue;
    const rowHeadW = pg.head ? 26 : 0;
    const colHeadH = pg.head ? RH : 0;
    const natural = cols.reduce((a, x) => a + x.w, 0) + rowHeadW;
    const rowPt = r => { const px = sh.rowH && sh.rowH.get(r); return px ? (px / ROW_H) * RH : RH; };
    const landscape = pg.orient === 'landscape' || (pg.orient !== 'portrait' && natural > A4[0] - 2 * M);
    const [PW, PH] = landscape ? [A4[1], A4[0]] : A4;
    const titleH = 18, footH = pg.footer ? 16 : 0;
    const availW = PW - 2 * M, availH = PH - 2 * M - titleH - footH;
    // titles: repeated rows (page setup) or the frozen rows
    const tr = pg.titleRows && pg.titleRows.r2 >= pg.titleRows.r1 ? pg.titleRows : (sh.freeze ? { r1: 0, r2: Math.min(sh.freeze, sh.maxR + 1) - 1 } : null);
    const titleRows = [];
    if (tr) for (let r = Math.max(0, tr.r1); r <= tr.r2; r++) if (!hiddenRows.has(r) && r < R1 + 1e9) titleRows.push(r);
    const bodyRows = [];
    for (let r = R1; r <= R2; r++) if (!hiddenRows.has(r) && !(titleRows.includes(r) && r <= (tr ? tr.r2 : -1))) bodyRows.push(r);
    // scale: fit to width/page, otherwise shrink a little (min 55 %) and split columns over several pages
    let scale;
    if (pg.fit === 'width' || pg.fit === 'page') {
      scale = Math.min(1, availW / natural);
      if (pg.fit === 'page') {
        const totalH = colHeadH + [...titleRows, ...bodyRows].reduce((a, r) => a + rowPt(r), 0);
        scale = Math.min(scale, availH / Math.max(1, totalH));
      }
      scale = Math.max(0.15, scale);
    } else scale = Math.max(0.55, Math.min(1, availW / natural));
    const colGroups = [];
    let start = 0;
    while (start < cols.length) {
      let w = rowHeadW * scale, end = start;
      while (end < cols.length && (w + cols[end].w * scale <= availW + 0.01 || end === start)) { w += cols[end].w * scale; end++; }
      colGroups.push([start, end]);
      start = end;
    }
    const fs = FS * Math.max(0.6, Math.min(1, scale)) * (scale < 0.6 ? scale / 0.6 : 1), sheetPages = [];
    for (const [gs, ge] of colGroups) {
      const groupW = rowHeadW * scale + cols.slice(gs, ge).reduce((a, x) => a + x.w * scale, 0);
      const x0 = M + (pg.center ? Math.max(0, (availW - groupW) / 2) : 0);
      const xs = [x0 + rowHeadW * scale];
      for (let i = gs; i < ge; i++) xs.push(xs[xs.length - 1] + cols[i].w * scale);
      const colIdx = new Map(cols.slice(gs, ge).map((x, i) => [x.c, i]));
      let page = null, y = 0;
      const newPage = () => {
        page = pdf.addPage([PW, PH]);
        sheetPages.push(page);
        const raw = `${sh.name}${colGroups.length > 1 ? ` (Spalten ${colName(cols[gs].c)}–${colName(cols[ge - 1].c)})` : ''}`;
        const lf = fk.pick(raw, 'sans', true);
        page.drawText(safeText(raw, lf), { x: M, y: PH - M - 2, size: 10, font: lf, color: rgbOf(PDFLib, '#15172F') });
        y = PH - M - titleH;
        if (pg.head) drawRow(-1);
        for (const r of titleRows) drawRow(r);
      };
      // wrapped lines of a cell text
      const wrapLines = (text, font, size, maxW) => {
        const out = [];
        for (const para of String(text).split('\n')) {
          let line = '';
          for (const word of para.split(/(\s+)/)) {
            const t = line + word;
            if (font.widthOfTextAtSize(t, size) <= maxW || !line.trim()) line = t;
            else { out.push(line.trimEnd()); line = word.trimStart(); }
          }
          out.push(line);
        }
        return out;
      };
      const cellInfo = r => {
        // row height incl. wrapped text
        let h = rowPt(r) * scale;
        for (let i = gs; i < ge; i++) {
          const c = cols[i].c;
          const cell = sh.cells.get(KEY(r, c));
          if (!cell || !cell.s || !cell.s.wrap) continue;
          const shown = displayOf(cell);
          if (!shown) continue;
          const font = fk.pick(shown, 'sans', !!cell.s.b, !!cell.s.i);
          const size = cell.s.size ? Math.min(fs * 1.6, cell.s.size * 0.8 * scale) : fs;
          const lines = wrapLines(safeText(shown, font), font, size, cols[i].w * scale - 5).length;
          h = Math.max(h, lines * size * 1.2 + 4);
        }
        return h;
      };
      function drawRow(r) {
        const rh = r < 0 ? colHeadH * scale : cellInfo(r);
        const top = y, bottom = y - rh;
        if (pg.head) {
          page.drawRectangle({ x: x0, y: bottom, width: rowHeadW * scale, height: rh, color: headBg, borderColor: grid, borderWidth: 0.4 });
          if (r >= 0) {
            const t = String(r + 1);
            page.drawText(t, { x: x0 + rowHeadW * scale - regular.widthOfTextAtSize(t, fs * 0.9) - 3, y: bottom + (rh - fs * 0.9) / 2 + 1, size: fs * 0.9, font: regular, color: headTxt });
          }
        }
        for (let i = gs; i < ge; i++) {
          const c = cols[i].c;
          const cx = xs[i - gs];
          let w = xs[i - gs + 1] - cx;
          if (w <= 0) continue;
          if (r < 0) {
            page.drawRectangle({ x: cx, y: bottom, width: w, height: rh, color: headBg, borderColor: grid, borderWidth: 0.4 });
            const t = colName(c);
            page.drawText(t, { x: cx + (w - regular.widthOfTextAtSize(t, fs * 0.9)) / 2, y: bottom + (rh - fs * 0.9) / 2 + 1, size: fs * 0.9, font: regular, color: headTxt });
            continue;
          }
          if (sh.merges.length) {
            const m = sh.merges.find(mm => r >= mm.r1 && r <= mm.r2 && c >= mm.c1 && c <= mm.c2);
            if (m && (m.c1 !== c || m.r1 !== r)) {
              if (pg.grid && (m.c1 === c || i === gs)) { const endI = colIdx.has(m.c2) ? colIdx.get(m.c2) + 1 : ge - gs; page.drawRectangle({ x: cx, y: bottom, width: xs[endI] - cx, height: rh, borderColor: grid, borderWidth: 0.4 }); }
              continue;
            }
            if (m) { const endI = colIdx.has(m.c2) ? colIdx.get(m.c2) + 1 : ge - gs; w = xs[Math.min(endI, ge - gs)] - cx; }
          }
          const cell = sh.cells.get(KEY(r, c));
          const cfx = sh.cf && sh.cf.length ? cfStyle(sh, r, c, cell, cfCache) : null;
          const s = cfx ? { ...((cell && cell.s) || {}), ...cfx } : (cell && cell.s) || {};
          page.drawRectangle({ x: cx, y: bottom, width: w, height: rh, color: s.fill ? rgbOf(PDFLib, s.fill) : undefined, borderColor: pg.grid ? grid : undefined, borderWidth: pg.grid ? 0.4 : 0 });
          if (cfx && cfx.bar) {
            const b = cfx.bar, bw = (w - 4) * b.pct, bx = cx + 2 + (w - 4) * (b.neg ? b.zero - b.pct : b.zero);
            page.drawRectangle({ x: bx, y: bottom + 2, width: Math.max(0.5, bw), height: rh - 4, color: rgbOf(PDFLib, b.color), opacity: 0.75 });
          }
          if (s.bd) {
            const bc = rgbOf(PDFLib, s.bd.color || '#1A1A1A');
            const th = v => (v === 'thick' || v === 'double' ? 1.6 : v === 'medium' ? 1.2 : 0.7);
            if (s.bd.t) page.drawLine({ start: { x: cx, y: top }, end: { x: cx + w, y: top }, thickness: th(s.bd.t), color: bc });
            if (s.bd.b) page.drawLine({ start: { x: cx, y: bottom }, end: { x: cx + w, y: bottom }, thickness: th(s.bd.b), color: bc });
            if (s.bd.l) page.drawLine({ start: { x: cx, y: bottom }, end: { x: cx, y: top }, thickness: th(s.bd.l), color: bc });
            if (s.bd.r) page.drawLine({ start: { x: cx + w, y: bottom }, end: { x: cx + w, y: top }, thickness: th(s.bd.r), color: bc });
          }
          let iconW = 0;
          if (cfx && cfx.icon) {
            const col = rgbOf(PDFLib, cfx.icon[1]);
            const rad = Math.min(3.2, rh / 4);
            page.drawCircle({ x: cx + 3 + rad, y: bottom + rh / 2, size: rad, color: col });
            iconW = rad * 2 + 4;
          }
          let v, shown;
          if (cell) { v = cell.f ? cell.cv : cell.v; shown = displayOf(cell); }
          else { const sp = sh.spill && sh.spill.get(KEY(r, c)); if (!sp) continue; v = sp.v; shown = displayOf({ v: sp.v, s: s }); }
          const font = fk.pick(shown, 'sans', !!s.b, !!s.i);
          let text = safeText(shown, font);
          if (!text) continue;
          const size = s.size ? Math.min(fs * 1.6, s.size * 0.8 * scale) : fs;
          const pad = 2.5;
          const maxW = w - pad * 2 - iconW;
          const align = s.align || (typeof v === 'number' ? 'right' : typeof v === 'boolean' || isErr(v) ? 'center' : 'left');
          const color = rgbOf(PDFLib, s.color || (isErr(v) ? '#C23A4B' : '#15172F'));
          if (s.wrap && typeof v === 'string') {
            const lines = wrapLines(text, font, size, maxW);
            const lh = size * 1.2;
            let ly = s.valign === 'top' ? top - pad - size : s.valign === 'center' ? bottom + (rh + lines.length * lh) / 2 - size : bottom + pad + (lines.length - 1) * lh;
            for (const ln of lines) {
              const tw = font.widthOfTextAtSize(ln, size);
              const tx = align === 'right' ? cx + w - pad - tw : align === 'center' ? cx + (w - tw) / 2 : cx + pad + iconW;
              page.drawText(ln, { x: tx, y: ly, size, font, color });
              ly -= lh;
            }
            continue;
          }
          let tw = font.widthOfTextAtSize(text, size);
          // left-aligned text may run into empty neighbour cells (like on screen)
          if (tw > maxW && typeof v === 'string' && align === 'left' && !s.wrap) {
            let extra = 0;
            for (let j = i + 1; j < ge && tw > maxW + extra; j++) {
              const nc = sh.cells.get(KEY(r, cols[j].c));
              if ((nc && (nc.f || (nc.v != null && nc.v !== '') || (nc.s && nc.s.fill))) || (sh.spill && sh.spill.has(KEY(r, cols[j].c)))) break;
              if (sh.merges.length && sh.merges.some(mm => r >= mm.r1 && r <= mm.r2 && cols[j].c >= mm.c1 && cols[j].c <= mm.c2)) break;
              extra += xs[j - gs + 1] - xs[j - gs];
            }
            if (extra) { const m2 = maxW + extra; if (tw <= m2) { page.drawText(text, { x: cx + pad + iconW, y: s.valign === 'top' ? top - pad - size : s.valign === 'center' ? bottom + (rh - size) / 2 + 1.5 : bottom + Math.min(pad + 1, (rh - size) / 2 + 1.5), size, font, color }); continue; } }
          }
          if (tw > maxW) {
            if (typeof v === 'number') text = '###';
            else { while (text.length > 1 && font.widthOfTextAtSize(text + '…', size) > maxW) text = text.slice(0, -1); text += '…'; }
            tw = font.widthOfTextAtSize(text, size);
          }
          const tx = align === 'right' ? cx + w - pad - tw : align === 'center' ? cx + (w - tw) / 2 : cx + pad + iconW;
          const ty = s.valign === 'top' ? top - pad - size : s.valign === 'center' ? bottom + (rh - size) / 2 + 1.5 : bottom + Math.min(pad + 1, (rh - size) / 2 + 1.5);
          page.drawText(text, { x: tx, y: ty, size, font, color });
          if (s.u) page.drawLine({ start: { x: tx, y: ty - 1 }, end: { x: tx + tw, y: ty - 1 }, thickness: 0.5, color });
          if (s.st) page.drawLine({ start: { x: tx, y: ty + size * 0.32 }, end: { x: tx + tw, y: ty + size * 0.32 }, thickness: 0.5, color });
        }
        y = bottom;
      }
      newPage();
      for (const r of bodyRows) {
        if (y - cellInfo(r) < M + footH) newPage();
        drawRow(r);
        if (++done % 400 === 0) { onProgress && onProgress(Math.min(0.99, done / (totalRows * colGroups.length))); await tick(); }
      }
    }
    if (pg.footer) sheetPages.forEach(p => numbered.push({ page: p, list: sheetPages, M }));
    await chartPages(sh, M);
  }
  // page numbers per sheet: "Seite x von y"
  for (const { page, list, M } of numbered) {
    const t = `Seite ${list.indexOf(page) + 1} von ${list.length}`;
    const [w] = [page.getWidth()];
    page.drawText(t, { x: (w - regular.widthOfTextAtSize(t, 8)) / 2, y: M - 12, size: 8, font: regular, color: headTxt });
  }
  return pdf.save({ useObjectStreams: true });

  // charts of a sheet: own pages after the table, scaled to the page width, as many per page as fit
  async function chartPages(sh, M) {
    if (!sh.charts || !sh.charts.length) return;
    const { chartData, chartPng } = await import('./chart.js');
    const [PW, PH] = A4;
    let page = null, y = 0;
    for (const ch of sh.charts) {
      const w = PW - 2 * M;
      const hgt = Math.min(PH - 2 * M - 30, w * (ch.h / ch.w));
      if (!page || y - hgt - 16 < M) {
        page = pdf.addPage([PW, PH]);
        const ct = `${sh.name} – Diagramme`, cf = fk.pick(ct, 'sans', true);
        page.drawText(safeText(ct, cf), { x: M, y: PH - M + 8, size: 10, font: cf, color: rgbOf(PDFLib, '#15172F') });
        y = PH - M - 8;
      }
      try {
        const png = await chartPng(ch, chartData(wb, sh, ch, 'light'), ch.w, ch.h, 2);
        const img = await pdf.embedPng(png);
        page.drawImage(img, { x: M, y: y - hgt, width: w, height: hgt });
        page.drawRectangle({ x: M, y: y - hgt, width: w, height: hgt, borderColor: grid, borderWidth: 0.5 });
      } catch (e) { console.warn('Diagramm übersprungen', e); }
      y -= hgt + 18;
    }
  }
}
