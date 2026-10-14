// Module worker: OCR image pre-processing off the main thread (see prep.js).
import { preprocess } from './prep.js';

self.onmessage = e => {
  const { id, image, opts } = e.data || {};
  try {
    const r = preprocess(image, opts || {});
    self.postMessage({ id, ok: true, result: r }, [r.gray.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
