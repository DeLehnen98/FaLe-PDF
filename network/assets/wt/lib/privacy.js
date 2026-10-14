// Privacy proof: counts the network requests this page makes after the user chose a file, split into
// requests to this website (program files such as pdf.js, loaded on demand) and to other servers
// (must stay 0 – the CSP forbids them anyway). Uses the Resource Timing API, so it only reports what the
// browser itself recorded. Nothing is sent anywhere.
let since = null;
let own = 0, ext = 0;
const listeners = new Set();
const seen = new Set();

function record(entry) {
  if (since === null || entry.startTime < since || seen.has(entry)) return;
  seen.add(entry);
  let url;
  try { url = new URL(entry.name, location.href); } catch { return; }
  if (url.protocol === 'blob:' || url.protocol === 'data:') return;
  if (url.origin === location.origin) own++; else ext++;
  for (const fn of listeners) fn({ own, ext });
}

let observer = null;
export function startCounting() {
  if (since !== null) return;
  since = performance.now();
  if (typeof PerformanceObserver !== 'function') return;
  try {
    observer = new PerformanceObserver(list => list.getEntries().forEach(record));
    observer.observe({ type: 'resource', buffered: true });
  } catch { /* old browser – no live count, the static explanation stays */ }
}

export function onCount(fn) { listeners.add(fn); fn({ own, ext }); return () => listeners.delete(fn); }
export function counts() { return { own, ext, active: since !== null }; }
