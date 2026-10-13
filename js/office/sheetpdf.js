// Workbook → PDF: table pages with grid, header row repeat, fills, bold, alignment. Landscape when wide.
import { loadPdfLib } from '../pdflib.js';
import { fontKit, winAnsi, rgbOf } from './pdftext.js';
import { KEY, displayOf, DEFAULT_COL_W } from './workbook.js';
import { colName, isErr } from './formula.js';
import { tick } from './vendor.js';
import { cfStyle, filterHidden, ensureSheetExtras } from './sheetfx.js';

export async function workbookToPdf(wb, { title = 'Tabelle', onProgress } = {}) {
  const PDFLib = await loadPdfLib();
  const pdf = await PDFLib.PDFDocument.create();
  pdf.setTitle(title); pdf.setProducer('FaLe PDF'); pdf.setCreator('FaLe PDF');
  const fk = await fontKit(pdf);
  const regular = fk.sync('sans', false, false), bold = fk.sync('sans', true, false), italic = fk.sync('sans', false, true), bi = fk.sync('sans', true, true);
  const grid = rgbOf(PDFLib, '#C9CCDA'), headBg = rgbOf(PDFLib, '#EEF0F8'), headTxt = rgbOf(PDFLib, '#4F5475');
  const M = 28, FS = 9, RH = 15;
  wb.sheets.forEach(ensureSheetExtras);
  const sheets = wb.sheets.filter(s => s.maxR >= 0 || (s.charts && s.charts.length));
  if (!sheets.length) { const p = pdf.addPage([595.28, 841.89]); p.drawText('Leere Tabelle', { x: M, y: 800, size: 12, font: regular }); return pdf.save(); }
  let done = 0;
  const totalRows = sheets.reduce((a, s) => a + s.maxR + 1, 0);
  for (const sh of sheets) {
    const cfCache = new Map();
    const hiddenRows = new Set([...(sh.hiddenRows || []), ...filterHidden(sh)]);
    if (sh.maxR < 0) { await chartPages(sh); continue; }
    const nC = Math.max(sh.maxC, ...sh.merges.filter(m => m.r1 <= sh.maxR).map(m => m.c2)) + 1;
    const widths = [];
    for (let c = 0; c < nC; c++) { const w = sh.colW[c]; widths.push((w == null ? DEFAULT_COL_W : w) * 0.75); }
    const rowHeadW = 26;
    const natural = widths.reduce((a, b) => a + b, 0) + rowHeadW;
    const landscape = natural > 595.28 - 2 * M;
    const [PW, PH] = landscape ? [841.89, 595.28] : [595.28, 841.89];
    const avail = PW - 2 * M;
    // scale down to fit width (min 55 %), otherwise split columns over several pages
    const scale = Math.max(0.55, Math.min(1, avail / natural));
    const colGroups = [];
    let start = 0;
    while (start < nC) {
      let w = rowHeadW * scale, end = start;
      while (end < nC && (w + widths[end] * scale <= avail || end === start)) { w += widths[end] * scale; end++; }
      colGroups.push([start, end]);
      start = end;
    }
    const fs = FS * Math.max(0.8, scale), rh = RH * Math.max(0.8, scale);
    const headerRows = Math.min(sh.freeze || 0, sh.maxR + 1);
    for (const [cs, ce] of colGroups) {
      let page = null, y = 0;
      const newPage = () => {
        page = pdf.addPage([PW, PH]);
        const label = winAnsi(`${sh.name}${colGroups.length > 1 ? ` (Spalten ${colName(cs)}–${colName(ce - 1)})` : ''}`);
        page.drawText(label, { x: M, y: PH - M + 8, size: 10, font: bold, color: rgbOf(PDFLib, '#15172F') });
        y = PH - M - 8;
        // column letters
        drawRow(-1);
        for (let r = 0; r < headerRows; r++) drawRow(r);
      };
      const xs = [M + rowHeadW * scale];
      for (let c = cs; c < ce; c++) xs.push(xs[xs.length - 1] + widths[c] * scale);
      function drawRow(r) {
        const top = y, bottom = y - rh;
        // row header
        page.drawRectangle({ x: M, y: bottom, width: rowHeadW * scale, height: rh, color: headBg, borderColor: grid, borderWidth: 0.4 });
        if (r >= 0) {
          const t = String(r + 1);
          page.drawText(t, { x: M + rowHeadW * scale - regular.widthOfTextAtSize(t, fs * 0.9) - 3, y: bottom + (rh - fs * 0.9) / 2 + 1, size: fs * 0.9, font: regular, color: headTxt });
        }
        for (let c = cs; c < ce; c++) {
          const x0 = xs[c - cs];
          let w = xs[c - cs + 1] - x0;
          if (w <= 0) continue;
          if (r >= 0 && sh.merges.length) {
            const m = sh.merges.find(mm => r >= mm.r1 && r <= mm.r2 && c >= mm.c1 && c <= mm.c2);
            if (m && (m.c1 !== c || m.r1 !== r)) { if (m.c1 === c || c === cs) page.drawRectangle({ x: x0, y: bottom, width: xs[Math.min(m.c2 + 1, ce) - cs] - x0, height: rh, borderColor: grid, borderWidth: 0.4 }); continue; }
            if (m) w = xs[Math.min(m.c2 + 1, ce) - cs] - x0;
          }
          if (r < 0) {
            page.drawRectangle({ x: x0, y: bottom, width: w, height: rh, color: headBg, borderColor: grid, borderWidth: 0.4 });
            const t = colName(c);
            page.drawText(t, { x: x0 + (w - regular.widthOfTextAtSize(t, fs * 0.9)) / 2, y: bottom + (rh - fs * 0.9) / 2 + 1, size: fs * 0.9, font: regular, color: headTxt });
            continue;
          }
          const cell = sh.cells.get(KEY(r, c));
          const cfx = sh.cf && sh.cf.length ? cfStyle(sh, r, c, cell, cfCache) : null;
          const s = cfx ? { ...((cell && cell.s) || {}), ...cfx } : (cell && cell.s) || {};
          page.drawRectangle({ x: x0, y: bottom, width: w, height: rh, color: s.fill ? rgbOf(PDFLib, s.fill) : undefined, borderColor: grid, borderWidth: 0.4 });
          if (s.bd) {
            const bc = rgbOf(PDFLib, '#1A1A1A');
            if (s.bd.t) page.drawLine({ start: { x: x0, y: top }, end: { x: x0 + w, y: top }, thickness: 0.9, color: bc });
            if (s.bd.b) page.drawLine({ start: { x: x0, y: bottom }, end: { x: x0 + w, y: bottom }, thickness: 0.9, color: bc });
            if (s.bd.l) page.drawLine({ start: { x: x0, y: bottom }, end: { x: x0, y: top }, thickness: 0.9, color: bc });
            if (s.bd.r) page.drawLine({ start: { x: x0 + w, y: bottom }, end: { x: x0 + w, y: top }, thickness: 0.9, color: bc });
          }
          if (!cell) continue;
          const v = cell.f ? cell.cv : cell.v;
          let text = winAnsi(displayOf(cell));
          if (!text) continue;
          const font = s.b && s.i ? bi : s.b ? bold : s.i ? italic : regular;
          const size = s.size ? Math.min(fs * 1.6, s.size * 0.8 * Math.max(0.8, scale)) : fs;
          const pad = 2.5;
          const maxW = w - pad * 2;
          let tw = font.widthOfTextAtSize(text, size);
          if (tw > maxW) {
            if (typeof v === 'number') text = '###';
            else { while (text.length > 1 && font.widthOfTextAtSize(text + '…', size) > maxW) text = text.slice(0, -1); text += '…'; }
            tw = font.widthOfTextAtSize(text, size);
          }
          const align = s.align || (typeof v === 'number' ? 'right' : typeof v === 'boolean' || isErr(v) ? 'center' : 'left');
          const tx = align === 'right' ? x0 + w - pad - tw : align === 'center' ? x0 + (w - tw) / 2 : x0 + pad;
          page.drawText(text, { x: tx, y: bottom + (rh - size) / 2 + 1.5, size, font, color: rgbOf(PDFLib, s.color || (isErr(v) ? '#C23A4B' : '#15172F')) });
          if (s.u) page.drawLine({ start: { x: tx, y: bottom + (rh - size) / 2 }, end: { x: tx + tw, y: bottom + (rh - size) / 2 }, thickness: 0.5 });
        }
        y = bottom;
      }
      newPage();
      for (let r = headerRows; r <= sh.maxR; r++) {
        if (hiddenRows.has(r)) continue;
        if (y - rh < M) newPage();
        drawRow(r);
        if (++done % 400 === 0) { onProgress && onProgress(Math.min(0.99, done / (totalRows * colGroups.length))); await tick(); }
      }
    }
    await chartPages(sh);
  }
  return pdf.save({ useObjectStreams: true });

  // charts of a sheet: own pages after the table, scaled to the page width, as many per page as fit
  async function chartPages(sh) {
    if (!sh.charts || !sh.charts.length) return;
    const { chartSvg, chartData, chartPng } = await import('./chart.js');
    void chartSvg;
    const [PW, PH] = [595.28, 841.89];
    let page = null, y = 0;
    for (const ch of sh.charts) {
      const w = PW - 2 * M;
      const hgt = Math.min(PH - 2 * M - 30, w * (ch.h / ch.w));
      if (!page || y - hgt - 16 < M) {
        page = pdf.addPage([PW, PH]);
        page.drawText(winAnsi(`${sh.name} – Diagramme`), { x: M, y: PH - M + 8, size: 10, font: bold, color: rgbOf(PDFLib, '#15172F') });
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
