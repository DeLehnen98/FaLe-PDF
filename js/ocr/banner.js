// Viewer banner for image-only PDFs: "Dieser Scan enthält keinen Text – Text erkennen?"
import { icon } from '../icons.js';
import { h } from '../ui.js';
import { pdfjsLib } from '../pdfcore.js';
import { pageTextChars } from './engine.js';

const OFF_KEY = id => `fale-ocr-banner-off:${id}`;
const IMG_OPS = () => {
  const O = pdfjsLib.OPS || {};
  return new Set([O.paintImageXObject, O.paintInlineImageXObject, O.paintImageXObjectRepeat, O.paintImageMaskXObject, O.paintInlineImageXObjectGroup].filter(v => v != null));
};

/** True when the first pages contain no text but images (a scan / photo PDF). */
export async function isImageOnlyPdf(pdf, { sample = 3 } = {}) {
  const n = Math.min(pdf.numPages, sample);
  let images = false;
  for (let i = 1; i <= n; i++) {
    const page = await pdf.getPage(i);
    if (await pageTextChars(page) >= 20) return false;
    if (!images) {
      try {
        const ops = await page.getOperatorList();
        const set = IMG_OPS();
        images = ops.fnArray.some(f => set.has(f));
      } catch {}
    }
  }
  return images;
}

/**
 * Show the banner inside `host` (viewer stage) when the document is image-only.
 * @returns {Promise<HTMLElement|null>}
 */
export async function showScanBanner(host, { docId, pdf, isCurrent = () => true }) {
  try {
    if (localStorage.getItem(OFF_KEY(docId)) === '1') return null;
  } catch {}
  let scan = false;
  try { scan = await isImageOnlyPdf(pdf); } catch { return null; }
  if (!scan || !isCurrent()) return null;
  host.querySelectorAll('.ocr-banner').forEach(b => b.remove());
  const el = h(`<div class="ocr-banner" role="region" aria-label="Hinweis Texterkennung">${icon('scan')}
    <span>Dieser Scan enthält keinen Text – Text erkennen?</span>
    <span class="ocr-banner-act"><button class="btn btn-primary btn-sm" type="button" data-ocr-go>Text erkennen</button>
    <button class="icon-btn" type="button" data-ocr-x aria-label="Hinweis schließen">${icon('close')}</button></span></div>`);
  el.querySelector('[data-ocr-go]').addEventListener('click', () => { location.hash = `#/werkzeug/durchsuchbar?doc=${docId}&start=1`; });
  el.querySelector('[data-ocr-x]').addEventListener('click', () => {
    try { localStorage.setItem(OFF_KEY(docId), '1'); } catch {}
    el.remove();
  });
  host.appendChild(el);
  return el;
}
