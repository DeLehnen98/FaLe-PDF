// Service worker registration (scope /) and offline warm-up of the files a tool needs.
import './tt.js';

const VENDOR = {
  pdfjs: ['/assets/wt/vendor/pdfjs/pdf.min.mjs', '/assets/wt/vendor/pdfjs/pdf.worker.min.mjs'],
  pdflib: ['/assets/wt/vendor/pdf-lib/pdf-lib.min.js'],
  jszip: ['/assets/wt/vendor/jszip/jszip.min.js'],
  // conversion tools (pdf-to-word, word/excel/pptx/text-to-pdf, pdf-to-pptx): writers and the synced office modules
  docx: ['/assets/wt/vendor/docx/docx.iife.js'],
  pptxgenjs: ['/assets/wt/vendor/pptxgenjs/pptxgen.bundle.js'],
  office: ['/assets/wt/lib/conv-office-shim.js', '/assets/wt/lib/conv-domparse.js', '/assets/wt/lib/conv-office.js',
    '/assets/wt/lib/shared/office/vendor.js',
    '/assets/wt/lib/shared/office/fonts.js',
    '/assets/wt/lib/shared/office/docstyles.js',
    '/assets/wt/lib/shared/office/docmodel.js',
    '/assets/wt/lib/shared/office/docx-read.js',
    '/assets/wt/lib/shared/office/docx-write.js',
    '/assets/wt/lib/shared/office/docpdf.js',
    '/assets/wt/lib/shared/office/pdftext.js',
    '/assets/wt/lib/shared/office/workbook.js',
    '/assets/wt/lib/shared/office/formula.js',
    '/assets/wt/lib/shared/office/numfmt.js',
    '/assets/wt/lib/shared/office/sheetfx.js',
    '/assets/wt/lib/shared/office/xlsx-read.js',
    '/assets/wt/lib/shared/office/sheetpdf.js',
    '/assets/wt/lib/shared/office/chart.js',
    '/assets/wt/lib/shared/office/chart-xml.js',
    '/assets/wt/lib/shared/office/kinds.js',
    '/assets/wt/lib/shared/office/pptx-read.js',
    '/assets/wt/lib/shared/office/slide-render.js'],
  unicodefont: ['/assets/wt/vendor/pdfjs/standard_fonts/LiberationSans-Regular.ttf', '/assets/wt/vendor/pdfjs/standard_fonts/LiberationSans-Bold.ttf',
    '/assets/wt/vendor/pdfjs/standard_fonts/LiberationSans-Italic.ttf', '/assets/wt/vendor/pdfjs/standard_fonts/LiberationSans-BoldItalic.ttf'],
};

export async function registerSW() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch { return null; }
}

/**
 * Ask the service worker to cache the tool module, its lib/ imports and vendor files, so the tool works
 * offline after the first visit. Skipped when the user enabled "Data saver".
 * @returns {Promise<boolean>} true when everything is cached
 */
export async function warmUp(urls, needs = []) {
  if (!('serviceWorker' in navigator)) return false;
  if (navigator.connection && navigator.connection.saveData) return false;
  const reg = await navigator.serviceWorker.ready;
  const sw = reg.active;
  if (!sw) return false;
  const all = [...urls, ...needs.flatMap(n => VENDOR[n] || [])];
  return new Promise(resolve => {
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve(false), 60_000);
    ch.port1.onmessage = ev => { clearTimeout(timer); resolve(!!(ev.data && ev.data.ok)); };
    sw.postMessage({ type: 'warm', urls: all }, [ch.port2]);
  });
}
