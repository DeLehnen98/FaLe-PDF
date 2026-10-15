// Shared PDF engine of the "Vorlagen" pack (power of attorney, receipt, leave request, payment reminder,
// withdrawal, CV, cover letter, DIN letter): a small flowing text writer on top of pdf-lib (wrapping, page
// breaks, tables, signature lines, page numbers) and the DIN 5008 letter layout (form A and B: window address
// field with return line and notices, information block or reference line, subject, body, signature,
// enclosures, fold and punch marks). Text goes through lib/unifont.js: Helvetica/Times when the text fits
// WinAnsi, otherwise Liberation Sans as an embedded Unicode subset (Polish, Turkish, Greek, Cyrillic …).
import { loadPdfLib, saveDoc } from './pdf.js';
import { fontForText, cleanText } from './unifont.js';

export const mm = v => v * 72 / 25.4;
export const A4 = [595.28, 841.89];

/** Every string inside a value (objects/arrays walked), joined – used to pick the font once per document. */
export function collectText(v, out = []) {
  if (v == null) return out;
  if (typeof v === 'string') out.push(v);
  else if (typeof v === 'number') out.push(String(v));
  else if (Array.isArray(v)) v.forEach(x => collectText(x, out));
  else if (typeof v === 'object' && !(v instanceof Uint8Array) && !(v instanceof Blob)) Object.values(v).forEach(x => collectText(x, out));
  return out;
}

export function hexColor(PDFLib, hex, fallback = [0.12, 0.33, 0.7]) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  const [r, g, b] = m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255) : fallback;
  return PDFLib.rgb(r, g, b);
}
/** Mix a colour with white (t = 0 → colour, 1 → white). */
export const tint = (PDFLib, c, t) => PDFLib.rgb(c.red + (1 - c.red) * t, c.green + (1 - c.green) * t, c.blue + (1 - c.blue) * t);

/**
 * A document writer. opts: { text (all text, for the font choice), family ('sans'|'serif'), margins {l,r,t,b} in mm,
 * onPage(w, index) – called for every new page (marks, sidebars, running headers) }.
 */
export async function createWriter({ text = '', family = 'sans', margins = {}, onPage = null, lang = 'de' } = {}) {
  const PDFLib = await loadPdfLib();
  const { PDFDocument, rgb } = PDFLib;
  const doc = await PDFDocument.create();
  const all = String(text);
  const font = await fontForText(doc, all, { PDFLib, family });
  const bold = await fontForText(doc, all, { PDFLib, family, bold: true });
  const italic = await fontForText(doc, all, { PDFLib, family, italic: true });
  const [W, H] = A4;
  const mg = { l: 25, r: 20, t: 20, b: 22, ...margins };
  const missing = new Set();
  const INK = rgb(0.08, 0.08, 0.1), GREY = rgb(0.38, 0.39, 0.45), LINE = rgb(0.72, 0.73, 0.78);

  const w = {
    PDFLib, doc, rgb, font, bold, italic, W, H, lang, INK, GREY, LINE,
    L: mm(mg.l), R: W - mm(mg.r), top: H - mm(mg.t), bottom: mm(mg.b),
    get TW() { return this.R - this.L; },
    page: null, y: 0, pages: [], onPage,
    txt(s) { const r = cleanText(String(s ?? ''), font); r.missing.forEach(c => missing.add(c)); return r.text; },
    width(s, f = font, size = 11) { return f.widthOfTextAtSize(this.txt(s), size); },
    newPage() {
      this.page = doc.addPage([W, H]);
      this.pages.push(this.page);
      this.y = this.top;
      this.onPage?.(this, this.pages.length - 1);
      return this.page;
    },
    ensure(h) { if (this.y - h < this.bottom) this.newPage(); },
    space(h) { this.y -= h; },
    /** One line at (x, y); align left/right/center relative to x; shrinks then cuts to maxWidth. */
    line(s, x, y, { size = 11, font: f = font, color = INK, align = 'left', maxWidth = 0, page = this.page } = {}) {
      let t = this.txt(s);
      if (!t) return 0;
      if (maxWidth) {
        while (size > 6 && f.widthOfTextAtSize(t, size) > maxWidth) size -= 0.25;
        while (t.length > 1 && f.widthOfTextAtSize(t, size) > maxWidth) t = t.slice(0, -2) + '…';
      }
      const tw = f.widthOfTextAtSize(t, size);
      const dx = align === 'right' ? -tw : align === 'center' ? -tw / 2 : 0;
      page.drawText(t, { x: x + dx, y, size, font: f, color });
      return tw;
    },
    /** Wrap text (honours \n; very long words are broken) into lines that fit `width`. */
    wrap(s, f = font, size = 11, width = this.TW) {
      const out = [];
      for (const raw of this.txt(s).split('\n')) {
        const words = raw.split(/[ \t]+/).filter(x => x !== '');
        if (!words.length) { out.push(''); continue; }
        let line = '';
        for (let word of words) {
          while (f.widthOfTextAtSize(word, size) > width && word.length > 1) {
            // break an overlong word (URL, IBAN without spaces)
            let k = word.length - 1;
            while (k > 1 && f.widthOfTextAtSize((line ? line + ' ' : '') + word.slice(0, k), size) > width) k--;
            if (line && f.widthOfTextAtSize(line + ' ' + word.slice(0, k), size) > width) { out.push(line); line = ''; continue; }
            out.push((line ? line + ' ' : '') + word.slice(0, k)); line = ''; word = word.slice(k);
          }
          const t = line ? line + ' ' + word : word;
          if (f.widthOfTextAtSize(t, size) <= width || !line) line = t; else { out.push(line); line = word; }
        }
        out.push(line);
      }
      return out;
    },
    /** Flowing paragraph at the cursor (page breaks included). Returns the number of lines. */
    para(s, { size = 11, font: f = font, x = this.L, width = this.TW, lead = 1.38, color = INK, align = 'left', after = 0 } = {}) {
      const lines = this.wrap(s, f, size, width);
      for (const ln of lines) {
        this.ensure(size * lead);
        if (ln) this.line(ln, align === 'right' ? x + width : align === 'center' ? x + width / 2 : x, this.y - size, { size, font: f, color, align });
        this.y -= size * lead;
      }
      this.y -= after;
      return lines.length;
    },
    hr({ x1 = this.L, x2 = this.R, y = this.y, color = LINE, thickness = 0.6 } = {}) {
      this.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness, color });
    },
    /**
     * Table at the cursor: cols [{label, w (fraction or pt), align}], rows [[cells]], opts {size, foot: [[cells]] (bold),
     * zebra}. The header repeats after a page break.
     */
    table(cols, rows, { size = 9.5, foot = [], zebra = true, x = this.L, width = this.TW, headColor = rgb(0.93, 0.94, 0.96) } = {}) {
      const total = cols.reduce((s, c) => s + (c.w || 1), 0);
      const ws = cols.map(c => (c.w || 1) / total * width);
      const pad = 4, lh = size * 1.3;
      const drawRow = (cells, { head = false, boldRow = false, fill = null } = {}) => {
        const f = head || boldRow ? bold : font;
        // foot rows: a label followed by empty cells spans those columns
        const span = cells.map(() => 1);
        if (boldRow) for (let i = 0; i < cells.length; i++) { let j = i + 1; while (j < cells.length - 1 && String(cells[j] ?? '') === '') { span[i]++; span[j] = 0; j++; } i = j - 1; }
        const cw = i => ws.slice(i, i + span[i]).reduce((a, b) => a + b, 0);
        const wrapped = cells.map((c, i) => (span[i] ? this.wrap(String(c ?? ''), f, size, cw(i) - pad * 2) : []));
        const h = Math.max(1, ...wrapped.map(l => l.length)) * lh + pad * 1.4;
        if (this.y - h < this.bottom) { this.newPage(); if (!head) drawRow(cols.map(c => c.label), { head: true, fill: headColor }); }
        if (fill) this.page.drawRectangle({ x, y: this.y - h, width, height: h, color: fill });
        let cx = x;
        wrapped.forEach((lines, i) => {
          lines.forEach((ln, j) => {
            const al = cols[i].align || 'left';
            const tx = al === 'right' ? cx + cw(i) - pad : cx + pad;
            this.line(ln, tx, this.y - pad - size * 0.95 - j * lh, { size, font: f, align: al === 'right' ? 'right' : 'left' });
          });
          cx += ws[i];
        });
        this.y -= h;
        if (!head) this.hr({ x1: x, x2: x + width, color: LINE, thickness: 0.4 });
      };
      drawRow(cols.map(c => c.label), { head: true, fill: headColor });
      rows.forEach((r, i) => drawRow(r, { fill: zebra && i % 2 ? rgb(0.975, 0.977, 0.985) : null }));
      foot.forEach(r => drawRow(r, { boldRow: true }));
    },
    /** Label/value rows (two columns). */
    kv(rows, { size = 10.5, labelWidth = mm(45), x = this.L, width = this.TW, after = 2 } = {}) {
      for (const [k, v] of rows) {
        const lines = this.wrap(v, font, size, width - labelWidth);
        this.ensure(lines.length * size * 1.35);
        this.line(k, x, this.y - size, { size, font: bold, maxWidth: labelWidth - 6 });
        lines.forEach((ln, i) => this.line(ln, x + labelWidth, this.y - size - i * size * 1.35, { size }));
        this.y -= lines.length * size * 1.35 + after;
      }
    },
    /** Signature lines side by side: [{caption, sig?, name?}] – a drawn signature sits on the line. */
    async signatures(items, { x = this.L, width = this.TW, gap = mm(12), height = mm(18), size = 8.5 } = {}) {
      this.ensure(height + size * 3);
      const n = items.length, cw = (width - gap * (n - 1)) / n;
      const base = this.y - height;
      for (const [i, it] of items.entries()) {
        const cx = x + i * (cw + gap);
        if (it.sig) await drawSig(this, it.sig, cx + 2, base + 2, Math.min(cw - 4, mm(70)), height - 4);
        if (it.above) this.line(it.above, cx, base + 3, { size: 10, maxWidth: cw });
        this.page.drawLine({ start: { x: cx, y: base }, end: { x: cx + cw, y: base }, thickness: 0.6, color: INK });
        this.line(it.caption, cx, base - size - 3, { size, color: GREY, maxWidth: cw });
        if (it.name) this.line(it.name, cx, base - size * 2.3 - 3, { size, color: GREY, maxWidth: cw });
      }
      this.y = base - size * (items.some(i => i.name) ? 3.4 : 2.2) - 4;
    },
    /** Page numbers "Seite i von n" (only for documents with more than one page). */
    numberPages({ label = { de: 'Seite {i} von {n}', en: 'Page {i} of {n}' }, size = 8, y = mm(10), x = null } = {}) {
      const n = this.pages.length;
      if (n < 2) return;
      this.pages.forEach((p, i) => this.line((lang === 'de' ? label.de : label.en).replace('{i}', i + 1).replace('{n}', n), x ?? this.R, y, { size, color: GREY, align: 'right', page: p }));
    },
    async finish({ title = '', subject = '', keywords = [] } = {}) {
      doc.setTitle(this.txt(title) || title);
      if (subject) doc.setSubject(subject);
      doc.setLanguage(lang === 'de' ? 'de-DE' : 'en');
      const bytes = await saveDoc(doc, { title });
      return { bytes, missing: [...missing], pages: this.pages.length };
    },
  };
  return w;
}

/** Draw a signature PNG ({bytes, width, height}) into the box (x, y bottom-left, maxW × maxH), keeping its ratio. */
export async function drawSig(w, sig, x, y, maxW, maxH) {
  const png = await w.doc.embedPng(sig.bytes);
  let h = maxH, ww = h * sig.width / sig.height;
  if (ww > maxW) { ww = maxW; h = ww * sig.height / sig.width; }
  w.page.drawImage(png, { x, y, width: ww, height: h });
}

// ---------------------------------------------------------------- DIN 5008 letter
export const DIN = {
  // address field top (mm), Zusatz-/Vermerkzone height, info block top, fold marks, reference line, subject
  A: { field: 27, zone: 12.7, info: 32, folds: [87, 192], refLine: 80.46, subject: 85.5 },
  B: { field: 45, zone: 17.7, info: 50, folds: [105, 210], refLine: 98.46, subject: 103.4 },
};

/** Fold marks (and the punch mark at 148.5 mm) on the left edge. */
export function foldMarks(w, page, form = 'B', { folds = true, punch = true } = {}) {
  const c = w.rgb(0.6, 0.6, 0.6);
  if (folds) for (const y of DIN[form].folds) page.drawLine({ start: { x: mm(3), y: w.H - mm(y) }, end: { x: mm(8), y: w.H - mm(y) }, thickness: 0.4, color: c });
  if (punch) page.drawLine({ start: { x: mm(3), y: w.H - mm(148.5) }, end: { x: mm(10), y: w.H - mm(148.5) }, thickness: 0.4, color: c });
}

/** Default letterhead: sender name (bold) and address lines right-aligned at the top, contact line below. */
export function defaultHead(w, m, form) {
  let y = w.H - mm(form === 'A' ? 12 : 17);
  const lines = [...m.sender, m.contact.join(' · ')].filter(Boolean);
  if (form === 'A' && lines.length > 3) {
    // form A has only 27 mm for the head: name left, the rest in one line on the right
    w.line(lines[0], w.L, y, { size: 12, font: w.bold, maxWidth: w.TW / 2 });
    w.line(lines.slice(1).join(' · '), w.R, y, { size: 8.5, color: w.GREY, align: 'right', maxWidth: w.TW / 2 - 10 });
    return;
  }
  for (const [i, s] of lines.entries()) {
    const size = i === 0 ? 12 : 9.5;
    w.line(s, w.R, y, { size, font: i === 0 ? w.bold : w.font, align: 'right', maxWidth: w.TW * 0.7 });
    y -= size * 1.35;
  }
}

/**
 * Draw a DIN 5008 letter. m: { form 'A'|'B', sender [lines], contact [lines], returnLine?, notices [lines] (e.g. "Einschreiben"),
 * recipient [lines ≤ 6], info [[label, value]], dateLine, refLine [[label, value]] (instead of the info block), subject,
 * salutation, blocks [string | {table: {cols, rows, foot}} | {kv: rows} | {gap: pt} | {bold: string}], closing, sig, name,
 * signerExtra [lines], enclosures [lines], cc [lines], marks {folds, punch}, head(w, m, form) }.
 */
export async function drawLetter(w, m) {
  const form = m.form === 'A' ? 'A' : 'B';
  const G = DIN[form];
  const marks = m.marks || {};
  w.onPage = (ww, i) => { if (i === 0) foldMarks(ww, ww.page, form, { folds: marks.folds !== false, punch: marks.punch !== false }); else ww.y = ww.H - mm(20); };
  w.newPage();
  (m.head || defaultHead)(w, m, form);
  const H = w.H, L = w.L;
  // Zusatz- und Vermerkzone: return line on top, notices bottom-up just above the address zone
  const zoneBottom = G.field + G.zone;           // mm from top where the address zone starts
  const notices = (m.notices || []).filter(Boolean).slice(0, form === 'A' ? 2 : 3);
  let zy = H - mm(zoneBottom) + 2;
  for (const n of [...notices].reverse()) { w.line(n, L, zy, { size: 8.5, font: w.bold, maxWidth: mm(80) }); zy += 10; }
  const ret = m.returnLine ?? m.sender.join(', ');
  if (ret) {
    const size = 7, ty = zy + (notices.length ? 1 : 0);
    const tw = w.line(ret, L, ty, { size, color: w.GREY, maxWidth: mm(80) });
    w.page.drawLine({ start: { x: L, y: ty - 1.5 }, end: { x: L + tw, y: ty - 1.5 }, thickness: 0.3, color: w.GREY });
  }
  // address zone: 6 lines, all inside the window (x 20–105 mm)
  const rec = (m.recipient || []).filter(Boolean).slice(0, 6);
  const first = mm(zoneBottom) + 13, last = mm(zoneBottom + 27.3 - 1.5);
  const lead = Math.min(13.5, rec.length > 1 ? (last - first) / (rec.length - 1) : 13.5);
  let y = H - first;
  for (const s of rec) { w.line(s, L, y, { size: Math.min(11, lead / 1.15), maxWidth: mm(79) }); y -= lead; }
  // information block (x 125 mm) or reference line
  if (m.refLine && m.refLine.length) {
    const cols = [mm(25), mm(75), mm(125), mm(175)];
    const ry = H - mm(G.refLine);
    m.refLine.slice(0, 4).forEach(([k, v], i) => {
      w.line(k, cols[i], ry + 9, { size: 6.5, color: w.GREY, maxWidth: mm(48) });
      w.line(v, cols[i], ry - 2, { size: 9.5, maxWidth: i === 3 ? w.R - cols[i] : mm(48) });
    });
    w.y = H - mm(G.refLine) - mm(9);
  } else {
    let iy = H - mm(G.info);
    const info = [...(m.info || []).filter(r => r && r[1]).map(r => (r[0] ? `${r[0]}: ${r[1]}` : r[1])), m.dateLine].filter(Boolean);
    for (const s of info.slice(0, 12)) { w.line(s, mm(125), iy, { size: 9.5, color: w.rgb(0.2, 0.2, 0.25), maxWidth: w.R - mm(125) }); iy -= 13; }
    w.y = H - mm(G.subject) + 11.5;
    if (iy + 13 < w.y + 10) w.y = iy - 6; // a very long info block pushes the subject down
  }
  if (m.subject) w.para(m.subject, { font: w.bold, size: 11.5, after: 11 * 1.38 });
  if (m.salutation) w.para(m.salutation, { after: 11 * 0.69 });
  for (const b of m.blocks || []) {
    if (typeof b === 'string') { if (b.trim()) w.para(b, { after: 11 * 0.69 }); }
    else if (b.bold) w.para(b.bold, { font: w.bold, after: 11 * 0.69 });
    else if (b.table) { w.table(b.table.cols, b.table.rows, { foot: b.table.foot || [] }); w.space(11 * 0.9); }
    else if (b.kv) { w.kv(b.kv, { size: 10.5 }); w.space(11 * 0.5); }
    else if (b.gap) w.space(b.gap);
  }
  w.space(11 * 0.3);
  w.ensure(m.sig ? 90 : 62);
  if (m.closing) w.para(m.closing);
  if (m.sig) { w.ensure(mm(18)); await drawSig(w, m.sig, L, w.y - mm(16) + 4, mm(70), mm(16)); w.space(mm(16) + 2); }
  else w.space(11 * 2.2);
  if (m.name) w.para(m.name);
  for (const s of m.signerExtra || []) w.para(s, { size: 9.5, color: w.GREY });
  if ((m.enclosures || []).filter(Boolean).length) {
    const enc = m.enclosures.filter(Boolean);
    w.space(11 * 1.2);
    w.para(w.lang === 'de' ? (enc.length === 1 ? 'Anlage' : 'Anlagen') : (enc.length === 1 ? 'Enclosure' : 'Enclosures'), { font: w.bold, size: 10 });
    for (const e of enc) w.para(e, { size: 10, lead: 1.3 });
  }
  if ((m.cc || []).filter(Boolean).length) {
    w.space(11 * 0.8);
    w.para(w.lang === 'de' ? 'Verteiler' : 'Copy to', { font: w.bold, size: 10 });
    for (const e of m.cc.filter(Boolean)) w.para(e, { size: 10, lead: 1.3 });
  }
  w.numberPages();
}

/** Letter model → PDF ({bytes, missing, pages}). */
export async function letterPdf(m, { lang = 'de', family = 'sans', title = '' } = {}) {
  const w = await createWriter({ text: collectText({ ...m, sig: null, head: null }).join('\n'), lang, family });
  await drawLetter(w, { ...m, lang });
  return w.finish({ title: title || m.subject || '' });
}

/** Plain-text version of a letter model (copy into an e-mail). */
export function letterText(m) {
  const blockText = b => (typeof b === 'string' ? b : b.bold ? b.bold
    : b.table ? [b.table.cols.map(c => c.label).join(' | '), ...b.table.rows.map(r => r.join(' | ')), ...(b.table.foot || []).map(r => r.filter(Boolean).join(' '))].join('\n')
      : b.kv ? b.kv.map(([k, v]) => `${k}: ${v}`).join('\n') : '');
  const info = (m.refLine && m.refLine.length ? m.refLine : (m.info || [])).filter(r => r && r[1]).map(r => (r[0] ? `${r[0]}: ${r[1]}` : r[1]));
  const enc = (m.enclosures || []).filter(Boolean);
  return [
    m.sender.join('\n') + (m.contact?.length ? '\n' + m.contact.join(' · ') : ''), '',
    ...(m.notices || []).filter(Boolean), (m.recipient || []).join('\n'), '', ...info, m.dateLine, '', m.subject, '', m.salutation, '',
    ...(m.blocks || []).map(blockText).filter(s => s && s.trim()).flatMap(p => [p, '']), m.closing, '', '', m.name, ...(m.signerExtra || []),
    enc.length ? '\n' + (m.lang === 'en' ? 'Enclosures:' : 'Anlagen:') + '\n' + enc.join('\n') : '',
  ].filter(x => x != null).join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
