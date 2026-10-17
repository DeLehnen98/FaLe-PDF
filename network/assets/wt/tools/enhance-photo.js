// Tool: improve photos – one tap for blurry, dark, noisy or shadowy pictures and document photos. Classic image
// processing only (no generative AI): pixels are filtered, never invented – safe for receipts, contracts and
// IDs, where an "AI upscaler" may change letters. Modes: automatic (denoise + levels + sharpen), document
// (shadow removal + white paper + crisp text), sharpen, denoise, brighten, screen photo (moiré). Strength and
// fine-tuning (brightness, contrast, saturation, warmth) can be changed on the result and it is redone at once;
// before/after slider. Heavy work runs in a worker (lib/shared/imgproc.js, shared with the app).
import { loadCanvas, encode, release, keepFormat, encodeSupport, ensureCss, resultCompare, imgProgress, uniqueNames, ctx2d } from '../lib/img-core.js';
import { runOp } from '../lib/shared/imgproc.js';

const SUP = await encodeSupport();
ensureCss();

export const MODES = {
  auto: { label: { de: 'Automatisch', en: 'Automatic' }, hint: { de: 'Rauschen weg, Kontrast und Schärfe angepasst – für die meisten Fotos', en: 'Noise removed, contrast and sharpness adjusted – for most photos' } },
  document: { label: { de: 'Dokument / Beleg', en: 'Document / receipt' }, hint: { de: 'Schatten weg, Papier weiß, Text knackig', en: 'Shadows gone, paper white, text crisp' } },
  sharpen: { label: { de: 'Schärfen', en: 'Sharpen' }, hint: { de: 'Für leicht unscharfe Fotos – ohne Lichtsäume', en: 'For slightly blurry photos – without halos' } },
  denoise: { label: { de: 'Entrauschen', en: 'Denoise' }, hint: { de: 'Für körnige Fotos bei wenig Licht', en: 'For grainy low-light photos' } },
  brighten: { label: { de: 'Aufhellen', en: 'Brighten' }, hint: { de: 'Für zu dunkle Fotos – helle Stellen bleiben erhalten', en: 'For photos that are too dark – bright areas are kept' } },
  moire: { label: { de: 'Bildschirmfoto (Moiré)', en: 'Screen photo (moiré)' }, hint: { de: 'Streifen und Raster von abfotografierten Bildschirmen', en: 'Stripes and patterns from photographed screens' } },
};

/** The processing chain for a mode as [op, params] steps (strength 0..1). */
export function chain(mode, k) {
  switch (mode) {
    case 'document': return [['removeShadows', { strength: 0.6 + 0.4 * k }], ['levels', { low: 0.01, high: 0.02, keepWhite: false }], ['sharpen', { amount: 0.4 + 0.6 * k, radius: 1, threshold: 4 }]];
    case 'sharpen': return [['sharpen', { amount: 0.4 + 1.4 * k, radius: 1.3, threshold: 3 }]];
    case 'denoise': return [['denoise', { strength: 0.25 + 0.75 * k, radius: 2 }], ['sharpen', { amount: 0.25 * k, radius: 1, threshold: 6 }]];
    case 'brighten': return [['levels', { low: 0.002, high: 0.002, gamma: 1 - 0.45 * k }]];
    case 'moire': return [['reduceMoire', { strength: 0.4 + 0.6 * k }]];
    default: return [['enhance', { strength: 0.3 + 0.9 * k }]];
  }
}

const fmtChoices = [
  { value: 'keep', label: { de: 'Wie das Original', en: 'Same as original' } },
  { value: 'jpg', label: 'JPG' },
  { value: 'png', label: { de: 'PNG (verlustfrei)', en: 'PNG (lossless)' } },
  ...(SUP.webp ? [{ value: 'webp', label: 'WebP' }] : []),
];

export default {
  shareFirst: true,
  options: [
    { id: 'mode', type: 'radio', default: 'auto', live: true, label: { de: 'Was soll besser werden?', en: 'What should get better?' },
      choices: Object.entries(MODES).map(([value, m]) => ({ value, label: m.label, hint: m.hint })) },
    { id: 'strength', type: 'range', default: 60, min: 10, max: 100, step: 10, live: true, label: { de: 'Stärke', en: 'Strength' },
      format: (v, lang) => `${v} %${v >= 90 ? (lang === 'de' ? ' · kräftig' : ' · strong') : v <= 30 ? (lang === 'de' ? ' · sanft' : ' · gentle') : ''}` },
    { id: 'brightness', type: 'range', default: 0, min: -40, max: 40, step: 5, live: true, label: { de: 'Helligkeit', en: 'Brightness' }, format: v => (v > 0 ? `+${v}` : String(v)) },
    { id: 'contrast', type: 'range', default: 0, min: -40, max: 40, step: 5, live: true, label: { de: 'Kontrast', en: 'Contrast' }, format: v => (v > 0 ? `+${v}` : String(v)) },
    { id: 'saturation', type: 'range', default: 0, min: -50, max: 50, step: 5, live: true, label: { de: 'Farbsättigung', en: 'Saturation' }, format: v => (v > 0 ? `+${v}` : String(v)) },
    { id: 'warmth', type: 'range', default: 0, min: -50, max: 50, step: 5, live: true, label: { de: 'Farbtemperatur', en: 'Warmth' },
      format: (v, lang) => (v > 0 ? `+${v} ${lang === 'de' ? 'wärmer' : 'warmer'}` : v < 0 ? `${v} ${lang === 'de' ? 'kühler' : 'cooler'}` : '0') },
    { id: 'format', type: 'select', default: 'keep', label: { de: 'Format', en: 'Format' }, choices: fmtChoices },
  ],

  onResult(el, res, ctx) { resultCompare(el, res, ctx); },

  async run(inputs, opts, ctx) {
    const outputs = [];
    const steps = chain(opts.mode, (opts.strength || 60) / 100);
    const fine = { brightness: +opts.brightness || 0, contrast: +opts.contrast || 0, saturation: +opts.saturation || 0, warmth: +opts.warmth || 0 };
    if (Object.values(fine).some(Boolean)) steps.push(['adjust', fine]);
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      const pre = imgProgress(i, inputs.length, input.name);
      ctx.progress(i / inputs.length, pre);
      const { canvas, width, height } = await loadCanvas(input, { maxPixels: 24e6 });
      try {
        const g = ctx2d(canvas, true);
        let img = g.getImageData(0, 0, canvas.width, canvas.height);
        for (let k = 0; k < steps.length; k++) {
          const [op, params] = steps[k];
          ctx.throwIfAborted();
          img = await runOp(op, img, params, p => ctx.progress((i + (k + (p || 0)) / steps.length) / inputs.length, pre));
          await ctx.tick();
        }
        g.putImageData(img, 0, 0);
        const fmt = opts.format === 'keep' ? keepFormat(input) : opts.format;
        const blob = await encode(canvas, { format: fmt, quality: 0.92 });
        const ext = { jpg: 'jpg', png: 'png', webp: 'webp', avif: 'avif' }[fmt] || 'jpg';
        outputs.push({ name: ctx.fileName(input.name, ctx.lang === 'en' ? ' (improved)' : ' (verbessert)', ext), blob, meta: { input, width: canvas.width, height: canvas.height } });
        if (canvas.width < width) ctx.note({ de: `${input.name}: sehr großes Bild, mit ${canvas.width} × ${canvas.height} px bearbeitet.`, en: `${input.name}: very large image, processed at ${canvas.width} × ${canvas.height} px.` });
      } finally { release(canvas); }
      await ctx.tick();
    }
    ctx.note({ de: 'Ohne KI-Generierung: Es werden keine Details erfunden – Schrift und Zahlen bleiben, was sie sind.', en: 'No generative AI: no details are invented – text and numbers stay what they are.' });
    return { outputs: uniqueNames(outputs) };
  },
};
