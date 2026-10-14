// GENERATED – synced copy of js/tools/imgworker.js by scripts/sync-webtools-vendor.mjs.
// Do not edit here: change the source in the app and run `node scripts/sync-webtools-vendor.mjs`.
// Module worker running image operations from imgproc.js off the main thread.
import { OPS } from './imgproc.js';

self.onmessage = async e => {
  const { id, op, params, image } = e.data || {};
  try {
    const fn = OPS[op];
    if (!fn) throw new Error(`Unbekannte Operation: ${op}`);
    let last = 0;
    const r = await fn(image, params || {}, p => {
      const now = Date.now();
      if (now - last > 120 || p >= 1) { last = now; self.postMessage({ id, type: 'progress', progress: p }); }
    });
    const data = r.data instanceof Uint8ClampedArray ? r.data : new Uint8ClampedArray(r.data);
    self.postMessage({ id, type: 'done', result: { data, width: r.width, height: r.height } }, [data.buffer]);
  } catch (err) {
    self.postMessage({ id, type: 'error', error: String(err && err.message || err) });
  }
};
