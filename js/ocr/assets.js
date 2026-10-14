// OCR asset locations (vendor/tesseract/, same origin – never a CDN) and offline caching.
// The ~7 MB of OCR files are NOT part of the install-time precache. The service worker keeps
// them in a separate cache (OCR_CACHE) the first time they are used, or when the user taps
// "OCR-Daten für offline laden" in the settings.

export const OCR_CACHE = 'falepdf-ocr-v6';
export const BASE = new URL('../../vendor/tesseract/', import.meta.url).href;
export const LIB_URL = BASE + 'tesseract.min.js';
export const WORKER_URL = BASE + 'worker.min.js';
export const LANG_URL = BASE + 'lang';
const CORE_SIMD = BASE + 'core/tesseract-core-simd-lstm.wasm.js';
const CORE_PLAIN = BASE + 'core/tesseract-core-lstm.wasm.js';

// approximate sizes (bytes) for the user notices
export const SIZES = { lib: 63e3, worker: 111e3, core: 3.95e6, deu: 853e3, eng: 1.98e6 };

let simd = null;
/** WebAssembly SIMD support decides which core build is loaded. */
export function simdSupported() {
  if (simd !== null) return simd;
  try {
    simd = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch { simd = false; }
  return simd;
}
export const coreUrl = () => (simdSupported() ? CORE_SIMD : CORE_PLAIN);
export const langFileUrl = code => `${LANG_URL}/${code}.traineddata.gz`;

/** All files one OCR run needs on this device. */
export function requiredUrls(langs = ['deu', 'eng']) {
  return [LIB_URL, WORKER_URL, coreUrl(), ...langs.map(langFileUrl)];
}
export function approxBytes(langs = ['deu', 'eng']) {
  return SIZES.lib + SIZES.worker + SIZES.core + langs.reduce((s, l) => s + (SIZES[l] || 1e6), 0);
}
export function mbLabel(bytes) {
  const mb = bytes / 1e6;
  return `${mb < 10 ? mb.toFixed(1).replace('.', ',') : Math.round(mb)} MB`;
}

function isNativeApp() {
  try { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); } catch { return false; }
}

/**
 * Status of the offline OCR data: {mode:'bundled'|'cached'|'missing'|'partial'|'unsupported', bytes, missing:[urls]}.
 * 'bundled' = Android app (files ship inside the app).
 */
export async function offlineStatus(langs = ['deu', 'eng']) {
  if (isNativeApp()) return { mode: 'bundled', bytes: approxBytes(langs), missing: [] };
  if (typeof caches === 'undefined') return { mode: 'unsupported', bytes: 0, missing: requiredUrls(langs) };
  let bytes = 0;
  const missing = [];
  try {
    const cache = await caches.open(OCR_CACHE);
    for (const url of requiredUrls(langs)) {
      const res = await cache.match(url, { ignoreSearch: true });
      if (!res) { missing.push(url); continue; }
      const len = +res.headers.get('content-length');
      bytes += len > 0 ? len : (await res.clone().blob()).size;
    }
  } catch { return { mode: 'unsupported', bytes: 0, missing: requiredUrls(langs) }; }
  const all = requiredUrls(langs).length;
  return { mode: !missing.length ? 'cached' : missing.length === all ? 'missing' : 'partial', bytes, missing };
}

/** True when an OCR run can start now (data cached/bundled, or we are online). */
export async function canRunNow(langs) {
  const st = await offlineStatus(langs);
  if (st.mode === 'bundled' || st.mode === 'cached') return { ok: true, status: st };
  return { ok: typeof navigator === 'undefined' || navigator.onLine !== false, status: st };
}

/** Download all OCR files into the offline cache. onProgress(doneBytes, totalBytes). */
export async function downloadForOffline(langs = ['deu', 'eng'], onProgress) {
  if (isNativeApp()) return offlineStatus(langs);
  if (typeof caches === 'undefined') throw Object.assign(new Error('nocache'), { userMessage: 'Dieser Browser kann keine Daten für die Offline-Nutzung speichern.' });
  const cache = await caches.open(OCR_CACHE);
  const urls = requiredUrls(langs);
  const total = approxBytes(langs);
  let done = 0;
  for (const url of urls) {
    if (await cache.match(url, { ignoreSearch: true })) { done += SIZES[keyOf(url)] || 0; onProgress && onProgress(Math.min(done, total), total); continue; }
    let res;
    try { res = await fetch(url, { cache: 'no-cache' }); } catch { throw Object.assign(new Error('offline'), { userMessage: 'Keine Internetverbindung – die OCR-Daten können gerade nicht geladen werden.' }); }
    if (!res.ok) throw Object.assign(new Error('http ' + res.status), { userMessage: 'Die OCR-Daten konnten nicht geladen werden.' });
    await cache.put(url, res.clone());
    done += (await res.blob()).size;
    onProgress && onProgress(Math.min(done, total), total);
  }
  return offlineStatus(langs);
}

/** Remove the offline OCR data again. */
export async function clearOffline() {
  if (typeof caches !== 'undefined') await caches.delete(OCR_CACHE);
}

function keyOf(url) {
  if (url === LIB_URL) return 'lib';
  if (url === WORKER_URL) return 'worker';
  if (/core/.test(url)) return 'core';
  const m = /lang\/(\w+)\.traineddata/.exec(url);
  return m ? m[1] : '';
}
