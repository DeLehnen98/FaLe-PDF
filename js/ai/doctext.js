// Text of a library document for the AI features (page by page). PDFs without a text layer are
// run through the on-device OCR engine (js/ocr/engine.js) when it is available.
import * as db from '../db.js';
import { kindOf } from '../office/kinds.js';

const cache = new Map(); // docId → { pages, unit, ocr } (session only)

export function unitFor(doc) {
  const k = kindOf(doc);
  if (k === 'pdf') return 'S.';
  if (k === 'pptx') return 'Folie';
  if (k === 'xlsx' || k === 'csv') return 'Blatt';
  return 'Abschnitt';
}

// engine progress: number or { index, total, progress } → 0..1
function ocrFraction(p) {
  if (typeof p === 'number') return p;
  if (!p) return 0;
  const inner = typeof p.progress === 'number' ? p.progress : 0;
  return p.total ? Math.min(1, ((p.index || 0) + inner) / p.total) : inner;
}

const userErr = msg => Object.assign(new Error(msg), { userMessage: msg });

/** Split one long text into sections (~maxLen) at paragraph boundaries (for docx/txt "pages"). */
function sections(text, maxLen = 2500) {
  const paras = String(text).split(/\n{2,}|\n/).map(s => s.trim()).filter(Boolean);
  const out = [];
  let cur = '';
  for (const p of paras) {
    if (cur && cur.length + p.length > maxLen) { out.push(cur); cur = ''; }
    cur += (cur ? '\n' : '') + p;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * @returns {Promise<{pages: string[], unit: string, ocr: boolean}>}
 * opts: { onProgress(fraction, label), signal, allowOcr = true }
 */
export async function docPages(doc, { onProgress, signal, allowOcr = true } = {}) {
  if (cache.has(doc.id)) return cache.get(doc.id);
  const kind = kindOf(doc);
  const unit = unitFor(doc);
  let pages = await db.getText(doc.id).catch(() => null);
  const hasText = p => p && p.join('').replace(/\s+/g, '').length > 20;
  if (!hasText(pages) && kind !== 'pdf' && kind !== 'image') {
    try {
      const blob = await db.getFile(doc.id);
      const { describeFile } = await import('../office/extract.js');
      const info = await describeFile(kind, blob);
      pages = info && info.pages;
    } catch (e) { console.warn(e); }
  }
  let ocr = false;
  if (!hasText(pages) && (kind === 'pdf' || kind === 'image')) {
    if (!allowOcr) throw userErr('Dieses Dokument enthält keinen erkennbaren Text.');
    let engine = null;
    try { engine = await import('../ocr/engine.js'); } catch { engine = null; }
    if (!engine || (kind === 'pdf' ? typeof engine.ocrPdfPages !== 'function' : typeof engine.recognize !== 'function')) {
      throw userErr('Dieses Dokument enthält keinen Text (z. B. ein Scan). Die Texterkennung ist auf diesem Gerät nicht verfügbar.');
    }
    onProgress && onProgress(0, 'Text wird erkannt (OCR, auf deinem Gerät) …');
    const blob = await db.getFile(doc.id);
    if (kind === 'pdf') {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const res = await engine.ocrPdfPages(bytes, { lang: 'deu+eng', signal, onProgress: p => onProgress && onProgress(ocrFraction(p), p && p.page ? `Seite ${p.page} wird erkannt (OCR) …` : 'Text wird erkannt …') });
      const n = Math.max(doc.pages || 0, ...res.map(r => r.page || 0));
      pages = Array.from({ length: n }, (_, i) => { const r = res.find(x => x.page === i + 1); return r ? r.text || '' : ''; });
    } else {
      const r = await engine.recognize(blob, { lang: 'deu+eng', signal, onProgress: p => onProgress && onProgress(ocrFraction(p), 'Text wird erkannt (OCR) …') });
      pages = [r.text || ''];
    }
    ocr = true;
  }
  if (!hasText(pages)) throw userErr('In diesem Dokument wurde kein Text gefunden.');
  if (unit === 'Abschnitt' && pages.length === 1) pages = sections(pages[0]);
  const res = { pages: pages.map(p => String(p || '')), unit, ocr };
  cache.set(doc.id, res);
  return res;
}

export function forgetDocText(id) { cache.delete(id); }

/** All text of a document (for summarize/translate/study), joined with blank lines. */
export async function docText(doc, opts) {
  const r = await docPages(doc, opts);
  return { text: r.pages.map(p => p.trim()).filter(Boolean).join('\n\n'), ...r };
}
