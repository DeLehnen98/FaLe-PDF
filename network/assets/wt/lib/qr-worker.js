// Module worker for tools/qr-scanner.js: decodes camera frames and images off the main thread, so the page
// never stutters while a frame is analysed. Message in: { id, width, height, data (ArrayBuffer RGBA), max }
// – out: { id, results, ms } or { id, error }.
import { scanImageData } from './qr-scan.js';

self.onmessage = ev => {
  const { id, width, height, data, max } = ev.data || {};
  const t0 = performance.now();
  try {
    const results = scanImageData({ width, height, data: new Uint8ClampedArray(data) }, { max: max || 4 })
      .map(r => ({ text: r.text, format: r.format, version: r.version, ecc: r.ecc, points: r.points }));
    self.postMessage({ id, results, ms: Math.round(performance.now() - t0) });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
