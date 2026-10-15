// Module worker of the background remover: loads onnxruntime-web (WASM, single thread – no cross-origin
// isolation needed) and one segmentation model from the same origin (vendor/onnx, cached by the service
// worker after the first use), runs the model and turns its coarse mask into an edge-aware mask at the
// working size of the photo. Nothing leaves the device.
//
// in:  { type: 'load', model }                                    → progress…, { type: 'ready', model, ms }
//      { type: 'segment', id, model, w, h, rgba (ArrayBuffer) }    → { type: 'mask', id, w, h, mask (ArrayBuffer), ms }
// out: { type: 'progress', loaded, total } · { type: 'error', id?, code, message }
import { MODELS, RUNTIME_BYTES, inferSize, resizeRGBA, toTensor, normalizeMask, upsampleMask } from './bg-core.js';

const BASE = new URL('../vendor/onnx/', import.meta.url).href;
let ortP = null, wasmBinary = null;
const sessions = new Map(); // model → Promise<session>
const dl = { loaded: 0, total: 0 }; // download progress of the current load

function post(msg, transfer) { self.postMessage(msg, transfer || []); }

/** fetch with byte progress (content-length may be missing when compressed: the known size is used). */
async function fetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status + ' ' + url), { code: 'download' });
  if (!res.body || !res.body.getReader) { const b = new Uint8Array(await res.arrayBuffer()); dl.loaded += b.length; return b; }
  const reader = res.body.getReader(), parts = [];
  let n = 0, lastPost = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); n += value.length; dl.loaded += value.length;
    const now = Date.now();
    if (now - lastPost > 120) { lastPost = now; post({ type: 'progress', loaded: dl.loaded, total: Math.max(dl.total, dl.loaded) }); }
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function loadOrt() {
  if (!ortP) {
    ortP = (async () => {
      if (typeof WebAssembly !== 'object') throw Object.assign(new Error('no wasm'), { code: 'nowasm' });
      const ort = await import('../vendor/onnx/ort/ort.wasm.min.mjs');
      wasmBinary = await fetchBytes(BASE + 'ort/ort-wasm-simd-threaded.wasm');
      ort.env.wasm.wasmPaths = BASE + 'ort/';
      ort.env.wasm.wasmBinary = wasmBinary;
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.logLevel = 'error';
      return ort;
    })();
    ortP.catch(() => { ortP = null; });
  }
  return ortP;
}

function session(model) {
  if (!sessions.has(model)) {
    const p = (async () => {
      const m = MODELS[model];
      if (!m) throw Object.assign(new Error('unknown model ' + model), { code: 'model' });
      dl.loaded = 0; dl.total = (wasmBinary ? 0 : RUNTIME_BYTES) + m.bytes;
      const ort = await loadOrt();
      const bytes = await fetchBytes(BASE + 'models/' + m.file);
      post({ type: 'progress', loaded: dl.total, total: dl.total });
      const s = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      return { ort, s, m };
    })();
    p.catch(() => sessions.delete(model));
    sessions.set(model, p);
  }
  return sessions.get(model);
}

async function segment({ id, model, w, h, rgba }) {
  const { ort, s, m } = await session(model);
  const t0 = performance.now();
  const src = new Uint8ClampedArray(rgba);
  const [iw, ih] = inferSize(w, h, m.kind);
  const small = resizeRGBA(src, w, h, iw, ih);
  const input = new ort.Tensor('float32', toTensor(small, iw, ih, m.kind), [1, 3, ih, iw]);
  const out = await s.run({ [s.inputNames[0]]: input });
  const t = out[s.outputNames[0]];
  const dims = t.dims, oh = dims[dims.length - 2], ow = dims[dims.length - 1];
  const coarse = normalizeMask(t.data.subarray(0, ow * oh), m.kind);
  for (const v of Object.values(out)) v.dispose?.();
  input.dispose?.();
  const tInfer = performance.now() - t0;
  const mask = upsampleMask(coarse, ow, oh, src, w, h);
  post({ type: 'mask', id, w, h, mask: mask.buffer, ms: performance.now() - t0, inferMs: tInfer }, [mask.buffer]);
}

self.onmessage = async ev => {
  const msg = ev.data || {};
  try {
    if (msg.type === 'load') { const t0 = performance.now(); await session(msg.model); post({ type: 'ready', id: msg.id, model: msg.model, ms: performance.now() - t0 }); }
    else if (msg.type === 'segment') await segment(msg);
  } catch (err) {
    post({ type: 'error', id: msg.id, code: err?.code || 'run', message: String(err?.message || err) });
  }
};
