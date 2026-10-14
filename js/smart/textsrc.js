// Text of a library entry for the assistants, with layout: lines separated by \n, columns by \t
// (address window and info block of a letter stay apart). PDFs use their text layer; scans and photos
// are recognised on the device (js/ocr/engine.js). Nothing leaves the device.
import * as db from '../db.js';

/** Lines of one pdf.js page: items grouped by baseline, sorted by x, big gaps → \t. */
export async function pageLayoutText(page) {
  const tc = await page.getTextContent();
  const items = [];
  for (const it of tc.items) {
    if (typeof it.str !== 'string' || !it.str.trim()) continue;
    const [a, b, , d, x, y] = it.transform;
    const size = Math.hypot(b, d) || Math.abs(a) || 10;
    items.push({ s: it.str, x, y, w: it.width || it.str.length * size * 0.5, size });
  }
  items.sort((p, q) => q.y - p.y || p.x - q.x);
  const lines = [];
  for (const it of items) {
    const ln = lines.find(l => Math.abs(l.y - it.y) <= Math.max(2, Math.min(l.size, it.size) * 0.45));
    if (ln) { ln.items.push(it); ln.size = Math.max(ln.size, it.size); } else lines.push({ y: it.y, size: it.size, items: [it] });
  }
  lines.sort((p, q) => q.y - p.y);
  const out = [];
  let prevY = null;
  for (const ln of lines) {
    ln.items.sort((p, q) => p.x - q.x);
    let s = '';
    let end = null;
    for (const it of ln.items) {
      if (end != null) {
        const gap = it.x - end;
        const cw = it.size * 0.5;
        if (gap > cw * 3.2) s += '\t';
        else if (gap > cw * 0.25 && !s.endsWith(' ') && !it.s.startsWith(' ')) s += ' ';
      }
      s += it.s;
      end = it.x + it.w;
    }
    // an empty line for bigger vertical gaps (paragraphs)
    if (prevY != null && prevY - ln.y > ln.size * 2.2) out.push('');
    out.push(s.replace(/[ ]{2,}/g, ' ').trim());
    prevY = ln.y;
  }
  return out.join('\n');
}

/** OCR result (engine.recognize) → layout text. Tesseract returns table columns and info blocks as separate
 *  blocks; lines are re-assembled geometrically (same baseline → one row, big gaps → \t) like the PDF path. */
export function ocrLayoutText(r) {
  if (!r) return '';
  const lines = (r.lines || []).filter(l => l.words && l.words.length && l.bbox);
  if (!lines.length) return r.text || '';
  // a photographed page is often slightly tilted: estimate the slope from the baselines of long lines
  const slopes = lines.filter(l => l.baseline && l.baseline.x1 - l.baseline.x0 > 150).map(l => (l.baseline.y1 - l.baseline.y0) / (l.baseline.x1 - l.baseline.x0)).sort((a, b) => a - b);
  const slope = slopes.length ? Math.max(-0.1, Math.min(0.1, slopes[Math.floor(slopes.length / 2)])) : 0;
  const yOf = w => (w.bbox.y0 + w.bbox.y1) / 2 - slope * ((w.bbox.x0 + w.bbox.x1) / 2);
  const items = lines.map(l => {
    const ws = l.words.slice().sort((a, b) => a.bbox.x0 - b.bbox.x0);
    const hs = ws.map(w => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
    const hgt = hs[Math.floor(hs.length / 2)] || (l.bbox.y1 - l.bbox.y0) || 12;
    const cy = ws.reduce((s, w) => s + yOf(w), 0) / ws.length;
    return { ws, hgt, cy, x0: ws[0].bbox.x0, y0: l.bbox.y0 };
  }).sort((a, b) => a.cy - b.cy);
  const rows = [];
  for (const it of items) {
    const row = rows.find(rw => Math.abs(rw.cy - it.cy) < Math.min(rw.hgt, it.hgt) * 0.55);
    if (row) { row.items.push(it); row.cy = (row.cy * (row.items.length - 1) + it.cy) / row.items.length; row.hgt = Math.max(row.hgt, it.hgt); }
    else rows.push({ cy: it.cy, hgt: it.hgt, items: [it] });
  }
  rows.sort((a, b) => a.cy - b.cy);
  const out = [];
  let prev = null;
  for (const rw of rows) {
    const ws = rw.items.flatMap(it => it.ws).sort((a, b) => a.bbox.x0 - b.bbox.x0);
    let s = '', end = null;
    for (const w of ws) {
      if (end != null) s += (w.bbox.x0 - end > rw.hgt * 2.2 ? '\t' : ' ');
      s += w.text;
      end = w.bbox.x1;
    }
    if (prev && rw.cy - prev.cy > Math.max(prev.hgt, rw.hgt) * 2.4) out.push('');
    out.push(s.trim());
    prev = rw;
  }
  return out.join('\n');
}

const MAX_PAGES = 6;

/**
 * Text of a library entry.
 * @param {string} docId
 * @param {{ocr?: 'auto'|'never', onProgress?: Function, signal?: AbortSignal, maxPages?: number}} opts
 * @returns {Promise<{text: string, pages: string[], ocr: boolean, ocrPages?: object[], kind: string, needsOcr?: boolean}>}
 */
export async function textOfDoc(docId, { ocr = 'auto', onProgress, signal, maxPages = MAX_PAGES } = {}) {
  const meta = await db.getDoc(docId);
  if (!meta) throw Object.assign(new Error('missing'), { userMessage: 'Dokument nicht gefunden.' });
  const kind = meta.kind || 'pdf';
  const blob = await db.getFile(docId);
  if (kind === 'image') {
    if (ocr === 'never') return { text: '', pages: [], ocr: false, kind, needsOcr: true };
    const eng = await import('../ocr/engine.js');
    const r = await eng.recognize(blob, { lang: 'deu+eng', signal, onProgress: p => onProgress && onProgress({ ...p, page: 1, total: 1 }) });
    const t = ocrLayoutText(r);
    return { text: t, pages: [t], ocr: true, ocrImage: r, kind };
  }
  if (kind !== 'pdf') {
    const pages = (await db.getText(docId)) || [];
    return { text: pages.join('\n\n'), pages, ocr: false, kind };
  }
  const { loadPdf } = await import('../pdfcore.js');
  const { pdf } = await loadPdf(new Uint8Array(await blob.arrayBuffer()), { name: meta.name, key: docId });
  try {
    const n = Math.min(pdf.numPages, maxPages);
    const pages = [];
    const empty = [];
    for (let i = 1; i <= n; i++) {
      const page = await pdf.getPage(i);
      const t = await pageLayoutText(page);
      page.cleanup();
      pages.push(t);
      if (t.replace(/\s+/g, '').length < 25) empty.push(i);
    }
    if (!empty.length || ocr === 'never') return { text: pages.join('\n\n'), pages, ocr: false, kind, needsOcr: empty.length > 0 };
    const eng = await import('../ocr/engine.js');
    const res = await eng.ocrPdfPages(pdf, { pages: empty, lang: 'deu+eng', signal, onProgress });
    for (const r of res) pages[r.page - 1] = ocrLayoutText(r);
    return { text: pages.join('\n\n'), pages, ocr: true, ocrPages: res, kind };
  } finally { try { pdf.destroy(); } catch {} }
}

/** Add an invisible text layer from existing OCR results (no second OCR run). → Uint8Array */
export async function searchablePdf(bytes, ocrPages, name = 'Dokument') {
  const { loadPdf } = await import('../pdfcore.js');
  const { loadEditable, saveDoc } = await import('../pdflib.js');
  const { addTextLayer } = await import('../ocr/textlayer.js');
  const { pdf } = await loadPdf(bytes.slice(), { name });
  try {
    const pdfDoc = await loadEditable(bytes, name);
    const docPages = pdfDoc.getPages();
    for (const r of ocrPages) {
      if (!r.words || !r.words.length) continue;
      const page = await pdf.getPage(r.page);
      const vp = page.getViewport({ scale: r.scale, rotation: page.rotate });
      await addTextLayer(pdfDoc, docPages[r.page - 1], r.words, (x, y) => vp.convertToPdfPoint(x, y));
      page.cleanup();
    }
    return await saveDoc(pdfDoc);
  } finally { try { pdf.destroy(); } catch {} }
}
