// Service worker registration (scope /) and offline warm-up of the files a tool needs.
import './tt.js';

const VENDOR = {
  pdfjs: ['/assets/wt/vendor/pdfjs/pdf.min.mjs', '/assets/wt/vendor/pdfjs/pdf.worker.min.mjs'],
  pdflib: ['/assets/wt/vendor/pdf-lib/pdf-lib.min.js'],
  jszip: ['/assets/wt/vendor/jszip/jszip.min.js'],
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
