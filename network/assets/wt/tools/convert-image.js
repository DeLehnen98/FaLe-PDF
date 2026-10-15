// Tool: convert images between JPG, PNG, WebP and AVIF (AVIF/WebP only when the browser can encode them).
// Reads everything the browser decodes (incl. HEIC in Safari, GIF, BMP). Transparency → JPG gets a
// background colour. Metadata is removed; the capture date can be kept (for sorting in the gallery).
// The SEO pages png-to-jpg, jpg-to-png, webp-to-jpg and heic-to-jpg use makeConverter() with a fixed target.
import { el, icon } from '../lib/dom.js';
import { loadCanvas, encode, release, FORMATS, encodeSupport, ensureCss, resultCompare, imgProgress, uniqueNames, hasAlpha, T } from '../lib/img-core.js';
import { readMeta, isobmffExif, minimalTiff, insertSegment, detectFormat } from '../lib/img-meta.js';

const SUP = await encodeSupport();
ensureCss();

const TARGETS = [
  { value: 'jpg', label: 'JPG', hint: { de: 'Passt überall, für Fotos', en: 'Works everywhere, for photos' } },
  { value: 'png', label: 'PNG', hint: { de: 'Verlustfrei, mit Transparenz', en: 'Lossless, with transparency' } },
  ...(SUP.webp ? [{ value: 'webp', label: 'WebP', hint: { de: 'Klein, für Webseiten', en: 'Small, for websites' } }] : []),
  ...(SUP.avif ? [{ value: 'avif', label: 'AVIF', hint: { de: 'Sehr klein, nicht überall lesbar', en: 'Very small, not supported everywhere' } }] : []),
];
const LABEL = { jpeg: 'JPG', png: 'PNG', webp: 'WebP', avif: 'AVIF', heic: 'HEIC', gif: 'GIF', bmp: 'BMP' };

/** EXIF capture date of any supported input (header only). */
async function captureDate(input) {
  const head = new Uint8Array(await input.file.slice(0, 512 * 1024).arrayBuffer());
  const f = detectFormat(head);
  if (!f) return '';
  if (f === 'heif' && !isobmffExif(head)) {
    // the EXIF item may sit after a large image block – read the whole file once
    const all = new Uint8Array(await input.file.arrayBuffer());
    return readMeta(all).date.slice(0, 19);
  }
  return readMeta(head).date.slice(0, 19);
}

export function makeConverter({ to = null } = {}) {
  return {
    shareFirst: true,
    labels: { back_to_files: { de: 'Zurück zu den Bildern', en: 'Back to the images' } },
    options: [
      { id: 'to', type: 'radio', default: to || 'jpg', label: { de: 'Umwandeln in', en: 'Convert to' }, choices: TARGETS, when: () => !to },
      { id: 'quality', type: 'range', default: 92, min: 40, max: 100, step: 2, unit: '%', label: { de: 'Qualität', en: 'Quality' },
        hint: { de: '92 % ist kaum vom Original zu unterscheiden.', en: '92 % is hard to tell from the original.' },
        when: v => FORMATS[v.to]?.lossy },
      { id: 'background', type: 'color', default: '#ffffff', label: { de: 'Hintergrund für transparente Stellen', en: 'Background for transparent areas' },
        hint: { de: 'JPG kennt keine Transparenz.', en: 'JPG has no transparency.' },
        when: (v, inputs) => v.to === 'jpg' && (!inputs.length || inputs.some(i => ['png', 'webp', 'gif', 'avif'].includes(i.format))) },
      { id: 'keepDate', type: 'toggle', default: true, label: { de: 'Aufnahmedatum behalten', en: 'Keep the capture date' },
        hint: { de: 'Damit das Foto in der Galerie richtig einsortiert wird. Standort und Kameradaten werden immer entfernt.', en: 'So the photo is sorted correctly in your gallery. Location and camera data are always removed.' },
        when: v => v.to === 'jpg' },
    ],

    onResult(elm, res, ctx) { resultCompare(elm, res, ctx); },

    async run(inputs, opts, ctx) {
      const fmt = to || opts.to;
      const F = FORMATS[fmt];
      const outputs = [];
      let flattened = 0, same = 0, gif = 0;
      for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i];
        ctx.progress(i / inputs.length, imgProgress(i, inputs.length, input.name));
        await ctx.tick();
        if ((input.format === 'jpeg' ? 'jpg' : input.format) === fmt) same++;
        if (input.format === 'gif') gif++;
        const { canvas, width, height } = await loadCanvas(input);
        const cw = canvas.width, ch = canvas.height; // < width × height for very large photos (canvas limit)
        let blob;
        try {
          if (!F.alpha && hasAlpha(canvas)) flattened++;
          blob = await encode(canvas, { format: fmt, quality: (+opts.quality || 92) / 100, background: opts.background });
        } finally { release(canvas); }
        if (fmt === 'jpg' && opts.keepDate) {
          const date = await captureDate(input).catch(() => '');
          const tiff = date && minimalTiff({ date });
          if (tiff) {
            const seg = new Uint8Array(10 + tiff.length);
            const len = 8 + tiff.length;
            seg.set([0xff, 0xe1, len >> 8, len & 255, 0x45, 0x78, 0x69, 0x66, 0, 0]);
            seg.set(tiff, 10);
            blob = new Blob([insertSegment(new Uint8Array(await blob.arrayBuffer()), seg)], { type: F.mime });
          }
        }
        outputs.push({ name: ctx.fileName(input.name, '', F.ext), blob, before: input.size,
          note: `${LABEL[input.format] || input.format.toUpperCase()} → ${F.label} · ${cw} × ${ch} px` + (cw < width ? ctx.t({ de: ' · verkleinert, weil der Browser so große Bilder nicht am Stück bearbeiten kann', en: ' · reduced – the browser can’t process images this large in one piece' }) : ''),
          meta: { input, width: cw, height: ch } });
        await ctx.tick();
      }
      if (flattened) ctx.note({ de: `Transparente Stellen ${flattened === 1 ? 'hat das Bild' : `haben ${flattened} Bilder`} jetzt die gewählte Hintergrundfarbe.`, en: `Transparent areas ${flattened === 1 ? 'now have' : `of ${flattened} images now have`} the chosen background colour.` });
      if (gif) ctx.note({ de: 'Bei animierten GIFs wird nur das erste Bild umgewandelt.', en: 'For animated GIFs only the first frame is converted.' });
      if (same === inputs.length && !to) ctx.note({ de: `Die Bilder waren schon ${F.label} – sie wurden neu gespeichert.`, en: `The images were already ${F.label} – they were saved again.` });
      return { outputs: uniqueNames(outputs) };
    },
  };
}

/** Honest HEIC notice above the pick zone (heic-to-jpg page). */
export function heicNotice(lang) {
  ensureCss();
  const pick = document.querySelector('[data-wt-pick]');
  if (!pick || document.querySelector('.img-heic-note')) return;
  pick.after(el('p', { class: 'img-note img-info img-heic-note' }, icon('alert'), el('span', {}, T(lang, {
    de: 'HEIC kann nicht jeder Browser öffnen: Safari auf iPhone, iPad und Mac schafft es. Ob es bei dir klappt, siehst du direkt nach der Auswahl – falls nicht, bekommst du einen Tipp.',
    en: 'Not every browser can open HEIC: Safari on iPhone, iPad and Mac can. You’ll see right after choosing whether it works for you – if not, you get a tip.',
  }))));
}

export default makeConverter();
