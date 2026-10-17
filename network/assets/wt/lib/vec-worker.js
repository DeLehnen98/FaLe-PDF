// Module worker for tools/image-to-svg.js: traces pictures off the main thread (lib/vec-trace.js).
// In: { id, width, height, data (ArrayBuffer RGBA), opts } – out: { id, res, ms } or { id, error }.
import { vectorize } from './vec-trace.js';

self.onmessage = ev => {
  const { id, width, height, data, opts } = ev.data || {};
  const t0 = performance.now();
  try {
    const res = vectorize({ width, height, data: new Uint8ClampedArray(data) }, opts || {});
    self.postMessage({ id, res, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
