// Tool: compress images (JPG, PNG, WebP, AVIF where the browser encodes it) – by quality or to a target
// size in KB (binary search on the quality, then fewer pixels if needed), optional max. edge length,
// keep or convert the format, metadata removed by default (orientation applied), before/after slider.
// Never returns a file that is larger than the original without saying so.
import { loadCanvas, encode, encodeToTarget, scaleTo, release, keepFormat, FORMATS, encodeSupport, ensureCss, resultCompare, imgProgress, uniqueNames, hasAlpha } from '../lib/img-core.js';
import { stripMeta, exifSegmentUpright, insertSegment, detectFormat } from '../lib/img-meta.js';
import { formatSize } from '../lib/format.js';

const SUP = await encodeSupport();
ensureCss();

const fmtChoices = [
  { value: 'keep', label: { de: 'Wie das Original', en: 'Same as original' } },
  { value: 'jpg', label: 'JPG' },
  ...(SUP.webp ? [{ value: 'webp', label: { de: 'WebP (oft kleiner)', en: 'WebP (often smaller)' } }] : []),
  ...(SUP.avif ? [{ value: 'avif', label: { de: 'AVIF (am kleinsten, nicht überall lesbar)', en: 'AVIF (smallest, not supported everywhere)' } }] : []),
  { value: 'png', label: { de: 'PNG (verlustfrei)', en: 'PNG (lossless)' } },
];

const SUFFIX = { de: ' (komprimiert)', en: ' (compressed)' };

export default {
  shareFirst: true,
  options: [
    {
      id: 'mode', type: 'radio', default: 'quality',
      label: { de: 'Wie stark?', en: 'How much?' },
      choices: [
        { value: 'quality', label: { de: 'Nach Qualität', en: 'By quality' }, hint: { de: 'Du wählst die Qualität, die Größe ergibt sich', en: 'You pick the quality, the size follows' } },
        { value: 'target', label: { de: 'Auf Zielgröße', en: 'To a target size' }, hint: { de: 'Z. B. unter 500 KB für ein Upload-Formular', en: 'E.g. under 500 KB for an upload form' } },
      ],
    },
    {
      id: 'quality', type: 'range', default: 75, min: 10, max: 95, step: 5, live: true,
      label: { de: 'Qualität', en: 'Quality' },
      format: (v, lang) => `${v} %${v >= 85 ? (lang === 'de' ? ' · sehr gut' : ' · very good') : v >= 70 ? (lang === 'de' ? ' · gut' : ' · good') : v >= 50 ? (lang === 'de' ? ' · mittel' : ' · medium') : (lang === 'de' ? ' · niedrig' : ' · low')}`,
      hint: { de: '75 % sieht auf dem Handy fast immer aus wie das Original.', en: '75 % almost always looks like the original on a phone.' },
      when: v => v.mode === 'quality' && v.format !== 'png',
    },
    {
      id: 'target', type: 'number', default: 500, min: 10, max: 100000, step: 10, unit: 'KB',
      label: { de: 'Höchstens so groß (pro Bild)', en: 'At most this size (per image)' },
      hint: { de: 'FaLe sucht die beste Qualität, die passt. Reicht das nicht, wird das Bild etwas kleiner gerechnet.', en: 'FaLe finds the best quality that fits. If that isn’t enough, the image gets fewer pixels.' },
      when: v => v.mode === 'target',
      validate: (v, lang) => (!(+v >= 10) ? (lang === 'de' ? 'Bitte mindestens 10 KB angeben.' : 'Please enter at least 10 KB.') : ''),
    },
    {
      id: 'maxSide', type: 'select', default: 0,
      label: { de: 'Maximale Kantenlänge', en: 'Maximum edge length' },
      hint: { de: 'Weniger Pixel = viel kleinere Datei. 1920 px reicht für Bildschirme und Nachrichten.', en: 'Fewer pixels = a much smaller file. 1920 px is enough for screens and messages.' },
      choices: [
        { value: 0, label: { de: 'Original behalten', en: 'Keep original' } },
        { value: 3840, label: '3840 px (4K)' },
        { value: 2560, label: '2560 px' },
        { value: 1920, label: { de: '1920 px (Full HD)', en: '1920 px (Full HD)' } },
        { value: 1600, label: { de: '1600 px (E-Mail)', en: '1600 px (e-mail)' } },
        { value: 1280, label: '1280 px' },
        { value: 1024, label: '1024 px' },
      ],
    },
    { id: 'format', type: 'select', default: 'keep', label: { de: 'Format', en: 'Format' }, choices: fmtChoices },
    {
      id: 'background', type: 'color', default: '#ffffff',
      label: { de: 'Hintergrund für transparente Stellen', en: 'Background for transparent areas' },
      hint: { de: 'JPG kennt keine Transparenz.', en: 'JPG has no transparency.' },
      when: (v, inputs) => v.format === 'jpg' && inputs.some(i => ['png', 'webp', 'gif', 'avif'].includes(i.format)),
    },
    {
      id: 'strip', type: 'toggle', default: true,
      label: { de: 'Standort und Kameradaten entfernen', en: 'Remove location and camera data' },
      hint: { de: 'Empfohlen, wenn du Fotos teilst. Die Drehung wird vorher angewendet.', en: 'Recommended when you share photos. The rotation is applied first.' },
    },
  ],

  onResult(el, res, ctx) { resultCompare(el, res, ctx); },

  async run(inputs, opts, ctx) {
    const outputs = [];
    let notReached = 0, kept = 0, firstFrame = 0;
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      ctx.progress(i / inputs.length, imgProgress(i, inputs.length, input.name));
      await ctx.tick();
      const fmt = opts.format === 'keep' ? keepFormat(input) : opts.format;
      const F = FORMATS[fmt];
      const maxSide = +opts.maxSide || 0;
      const { canvas, width, height } = await loadCanvas(input, { maxSide });
      const resized = canvas.width !== width || canvas.height !== height;
      // very large photos (> 40 MP) are reduced by loadCanvas even without a size limit – say so
      const capped = canvas.width < Math.round(width * Math.min(1, maxSide ? maxSide / Math.max(width, height) : 1)) - 1;
      if (input.format === 'gif') firstFrame++;
      let blob, outW = canvas.width, outH = canvas.height, note = '';
      try {
        if (opts.mode === 'target') {
          const target = Math.max(10, +opts.target || 500) * 1024;
          const r = await encodeToTarget(canvas, { format: fmt, targetBytes: target, background: opts.background, tick: ctx.tick });
          blob = r.blob; outW = r.canvas.width; outH = r.canvas.height;
          if (r.canvas !== canvas) release(r.canvas);
          if (!r.reached) { notReached++; note = ctx.t({ de: 'Zielgröße nicht erreicht – das ist das Kleinste, was sinnvoll geht.', en: 'Target size not reached – this is the smallest that makes sense.' }); }
          else if (r.scaled) note = ctx.t({ de: `Auf ${outW} × ${outH} px verkleinert, um unter ${formatSize(target, ctx.lang)} zu bleiben.`, en: `Scaled to ${outW} × ${outH} px to stay under ${formatSize(target, ctx.lang)}.` });
        } else {
          if (!F.alpha && ['png', 'webp', 'gif', 'avif'].includes(input.format) && hasAlpha(canvas)) note = ctx.t({ de: 'Transparente Stellen haben jetzt die gewählte Hintergrundfarbe.', en: 'Transparent areas now have the chosen background colour.' });
          else if (capped) note = ctx.t({ de: `Auf ${canvas.width} × ${canvas.height} px verkleinert – so große Bilder kann der Browser nicht am Stück bearbeiten.`, en: `Reduced to ${canvas.width} × ${canvas.height} px – the browser can’t process images this large in one piece.` });
          blob = await encode(canvas, { format: fmt, quality: (+opts.quality || 75) / 100, background: opts.background });
        }
      } finally { release(canvas); }
      await ctx.tick();

      // keep metadata on request: carry the JPEG's EXIF over (orientation set to upright – pixels are rotated)
      if (!opts.strip && fmt === 'jpg' && input.format === 'jpeg') {
        const head = new Uint8Array(await input.file.slice(0, 256 * 1024).arrayBuffer());
        const seg = exifSegmentUpright(head);
        if (seg) blob = new Blob([insertSegment(new Uint8Array(await blob.arrayBuffer()), seg)], { type: 'image/jpeg' });
      }

      // never bigger than the original in the same format and size: keep the original (metadata stripped losslessly)
      const sameFormat = keepFormat(input) === fmt && input.format !== 'gif' && input.format !== 'bmp' && input.format !== 'heic';
      const targetOk = opts.mode !== 'target' || input.size <= Math.max(10, +opts.target || 500) * 1024;
      if (sameFormat && !resized && blob.size >= input.size && targetOk) {
        let bytes = await input.bytes();
        if (opts.strip && detectFormat(bytes)) bytes = stripMeta(bytes).bytes;
        blob = new Blob([bytes], { type: F.mime });
        input._bytes = null;
        kept++;
        note = ctx.t({ de: 'Das Original ist schon gut komprimiert – es wurde nicht neu berechnet.', en: 'The original is already well compressed – it was not re-encoded.' });
        outW = width; outH = height;
      }
      outputs.push({
        name: ctx.fileName(input.name, ctx.t(SUFFIX), F.ext), blob, before: input.size, note,
        meta: { input, width: outW, height: outH },
      });
    }
    if (firstFrame) ctx.note({ de: 'Bei animierten GIFs wird nur das erste Bild gespeichert.', en: 'For animated GIFs only the first frame is saved.' });
    if (notReached > 1) ctx.note({ de: `${notReached} Bilder sind noch größer als die Zielgröße. Wähle eine kleinere Kantenlänge oder WebP.`, en: `${notReached} images are still larger than the target. Pick a smaller edge length or WebP.` });
    if (kept && kept === inputs.length && opts.format === 'keep') ctx.note({ de: 'Tipp: Mit einer kleineren Kantenlänge oder dem Format WebP wird es deutlich kleiner.', en: 'Tip: a smaller edge length or the WebP format makes it much smaller.' });
    return { outputs: uniqueNames(outputs) };
  },
};
