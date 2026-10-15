// PDF preview with the vendored pdf.js (same pinned build as FaLe PDF). Hardening as in FaLe PDF: no PDF
// JavaScript, no XFA, no eval, no remote resources, image size limit; the pure-JS image decoders are used
// (useWasm: false) so the CSP needs no 'wasm-unsafe-eval'. Pages render lazily as they scroll into view.
import { t } from './i18n.js';

const VENDOR = new URL('../vendor/pdfjs/', import.meta.url).href;
let libP = null;
function lib() {
  if (!libP) libP = import('../vendor/pdfjs/pdf.min.mjs').then(m => { m.GlobalWorkerOptions.workerSrc = VENDOR + 'pdf.worker.min.mjs'; return m; });
  return libP;
}

export async function renderPdf(box, blob, { onError } = {}) {
  let pdf = null, io = null, destroyed = false;
  try {
    const pdfjs = await lib();
    const data = new Uint8Array(await blob.arrayBuffer());
    pdf = await pdfjs.getDocument({
      data, cMapUrl: VENDOR + 'cmaps/', cMapPacked: true, standardFontDataUrl: VENDOR + 'standard_fonts/', wasmUrl: VENDOR + 'wasm/', iccUrl: VENDOR + 'iccs/',
      useWasm: false, isEvalSupported: false, enableXfa: false, enableScripting: false, maxImageSize: 100e6, disableAutoFetch: true,
    }).promise;
    if (destroyed) return () => {};
    const width = () => Math.min(box.clientWidth - 16 || 800, 1100);
    const pages = [];
    for (let i = 1; i <= Math.min(pdf.numPages, 2000); i++) {
      const holder = document.createElement('div');
      holder.className = 'pdf-page';
      holder.dataset.page = String(i);
      holder.setAttribute('aria-label', t('Seite {n}', { n: i }));
      holder.style.height = Math.round(width() * 1.414) + 'px';
      box.appendChild(holder);
      pages.push(holder);
    }
    const rendered = new Set();
    const render = async holder => {
      const i = +holder.dataset.page;
      if (rendered.has(i) || destroyed) return;
      rendered.add(i);
      const page = await pdf.getPage(i);
      const vp1 = page.getViewport({ scale: 1 });
      const scale = width() / vp1.width;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const vp = page.getViewport({ scale: scale * dpr });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
      canvas.style.width = Math.floor(vp.width / dpr) + 'px';
      holder.style.height = '';
      holder.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      page.cleanup();
    };
    io = new IntersectionObserver(entries => { for (const e of entries) if (e.isIntersecting) render(e.target).catch(err => onError && onError(err)); }, { root: null, rootMargin: '600px 0px' });
    pages.forEach(p => io.observe(p));
  } catch (e) { if (onError) onError(e); }
  return () => { destroyed = true; if (io) io.disconnect(); if (pdf) pdf.destroy(); };
}
