// Tool: rotate / flip many images at once. All images or each one separately (90° steps, flips).
// JPEG: lossless by default – only the EXIF orientation tag is rewritten, the photo data stays bit for
// bit the same; "rotate pixels" re-encodes for programs that ignore the tag. PNG is rotated in pixels
// (lossless format), other formats are saved as PNG or in their format at high quality.
import { el, clear } from '../lib/dom.js';
import { loadCanvas, release, encode, encodeSupport, FORMATS } from '../lib/img-core.js';
import { ensureCss, T, iconBtn, ICON } from '../lib/new-ui.js';
import { composeOrientation, isIdentity, setJpegOrientation, jpegOrientation, drawTransformed, turnedSize } from '../lib/new-img.js';

ensureCss();

const tOf = input => (input.opts.turn ||= { rot: 0, flipH: false, flipV: false });
let stageApi = null;

export default {
  options: [
    { id: 'method', type: 'radio', default: 'lossless', label: { de: 'Bei JPG-Fotos', en: 'For JPG photos' },
      choices: [
        { value: 'lossless', label: { de: 'Verlustfrei drehen', en: 'Rotate losslessly' }, hint: { de: 'Ändert nur die Ausrichtungs-Angabe im Foto. Die Bildqualität bleibt exakt gleich; alle Metadaten bleiben erhalten.', en: 'Only changes the orientation flag in the photo. Image quality stays exactly the same; all metadata is kept.' } },
        { value: 'pixels', label: { de: 'Pixel drehen und neu speichern', en: 'Rotate pixels and re-save' }, hint: { de: 'Für Programme, die die Ausrichtungs-Angabe ignorieren. Speichert in sehr hoher Qualität neu, ohne Metadaten.', en: 'For programs that ignore the orientation flag. Re-saves at very high quality, without metadata.' } },
      ] },
  ],
  mountStage(stage, state, ctx) { stageApi = rotateStage(stage, state, ctx); },
  onInputs(inputs) { stageApi?.refresh(inputs); },
  status(values, inputs) {
    const n = inputs.filter(i => !isIdentity(tOf(i))).length;
    if (!n) return { ok: false, hint: { de: 'Dreh oder spiegel mindestens ein Bild.', en: 'Rotate or flip at least one image.' } };
    return { summary: { de: `${n} ${n === 1 ? 'Bild' : 'Bilder'} drehen`, en: `Rotate ${n} ${n === 1 ? 'image' : 'images'}` } };
  },

  async run(inputs, opts, ctx) {
    const support = await encodeSupport();
    const outputs = [];
    let lossless = 0, replacedExif = 0;
    const todo = inputs.filter(i => !isIdentity(tOf(i)));
    for (const [i, input] of todo.entries()) {
      ctx.progress(i / todo.length, { de: `Bild ${i + 1} von ${todo.length}`, en: `Image ${i + 1} of ${todo.length}` });
      const t = tOf(input);
      const suffix = ctx.t({ de: ' (gedreht)', en: ' (rotated)' });
      if (input.format === 'jpeg' && opts.method === 'lossless') {
        const bytes = await input.bytes();
        const r = setJpegOrientation(bytes, composeOrientation(jpegOrientation(bytes), t));
        if (r) {
          if (!r.kept) replacedExif++;
          lossless++;
          outputs.push({ name: ctx.fileName(input.name, suffix, 'jpg'), blob: new Blob([r.bytes], { type: 'image/jpeg' }), note: ctx.t({ de: 'verlustfrei', en: 'lossless' }) });
          await ctx.tick();
          continue;
        }
      }
      const { canvas, width: srcW } = await loadCanvas(input);
      const capped = canvas.width < srcW; // > 40 MP: reduced by the canvas limit
      const [W, H] = turnedSize(canvas.width, canvas.height, t.rot);
      const out = document.createElement('canvas');
      out.width = W; out.height = H;
      drawTransformed(out.getContext('2d'), canvas, canvas.width, canvas.height, t);
      release(canvas);
      let fmt = input.format === 'jpeg' || input.format === 'heic' ? 'jpg' : input.format === 'webp' && support.webp ? 'webp' : input.format === 'avif' && support.avif ? 'avif' : 'png';
      const blob = await encode(out, { format: fmt, quality: 0.95 });
      release(out);
      outputs.push({ name: ctx.fileName(input.name, suffix, FORMATS[fmt].ext), blob, note: (fmt === 'png' ? ctx.t({ de: 'verlustfrei (PNG)', en: 'lossless (PNG)' }) : ctx.t({ de: 'neu gespeichert', en: 're-saved' }))
        + (capped ? ctx.t({ de: ` · auf ${W} × ${H} px verkleinert (sehr großes Bild)`, en: ` · reduced to ${W} × ${H} px (very large image)` }) : '') });
      await ctx.tick();
    }
    if (lossless) ctx.note({ de: 'JPG-Fotos wurden verlustfrei über die Ausrichtungs-Angabe gedreht. Sehr alte Programme ignorieren sie manchmal – dann wähle „Pixel drehen und neu speichern“.', en: 'JPG photos were rotated losslessly via the orientation flag. Some very old programs ignore it – then choose “Rotate pixels and re-save”.' });
    if (replacedExif) ctx.note({ de: 'Bei Fotos ohne Ausrichtungs-Angabe wurde ein kleiner EXIF-Block (Ausrichtung und Aufnahmedatum) geschrieben; andere EXIF-Angaben dieser Fotos entfallen dabei.', en: 'For photos without an orientation flag a small EXIF block (orientation and capture date) was written; other EXIF data of these photos is dropped.' });
    const skipped = inputs.length - todo.length;
    if (skipped) ctx.note({ de: `${skipped} unveränderte ${skipped === 1 ? 'Bild wurde' : 'Bilder wurden'} übersprungen.`, en: `${skipped} unchanged ${skipped === 1 ? 'image was' : 'images were'} skipped.` });
    return { outputs };
  },
};

function rotateStage(stage, state, ctx) {
  const lang = ctx.lang;
  const grid = el('ul', { class: 'new-rot-grid' });
  const all = (de, en, icn, fn) => iconBtn(icn, T(lang, { de, en }), () => { for (const i of state.inputs) if (!i.error) fn(tOf(i)); paintAll(); changed(); }, { text: T(lang, { de, en }) });
  const allRow = el('div', { class: 'new-tools' },
    all('Alle links', 'All left', ICON.rotL, t => { t.rot = (t.rot + 3) % 4; }),
    all('Alle rechts', 'All right', ICON.rotR, t => { t.rot = (t.rot + 1) % 4; }),
    all('Alle spiegeln', 'Flip all', ICON.flipH, t => { t.flipH = !t.flipH; }),
    iconBtn(ICON.reset, T(lang, { de: 'Zurücksetzen', en: 'Reset' }), () => { for (const i of state.inputs) i.opts.turn = { rot: 0, flipH: false, flipV: false }; paintAll(); changed(); }, { text: T(lang, { de: 'Zurücksetzen', en: 'Reset' }) }));
  stage.append(el('section', { class: 'new-box', aria: { labelledby: 'new-rot-h' } },
    el('h2', { id: 'new-rot-h' }, T(lang, { de: 'Drehen und spiegeln', en: 'Rotate and flip' })),
    allRow, grid,
    el('p', { class: 'new-muted' }, T(lang, { de: 'Tipp: Mit den Knöpfen unter einem Bild drehst du nur dieses eine. Für schräge Fotos nimm „Bild zuschneiden“ – dort kannst du begradigen.', en: 'Tip: the buttons under an image rotate only that one. For tilted photos use “Crop image” – it can straighten them.' }))));
  function changed() { state.results.clear(); ctx.refresh(); }
  const tiles = new Map();
  function paint(input) {
    const tile = tiles.get(input);
    if (!tile) return;
    const t = tOf(input);
    tile.img.style.transform = cssTransform(t);
    const deg = t.rot * 90;
    tile.tag.textContent = isIdentity(t) ? T(lang, { de: 'unverändert', en: 'unchanged' }) : `${deg ? deg + '°' : ''}${t.flipH ? ' ⇋' : ''}${t.flipV ? ' ⇵' : ''}`.trim();
  }
  const paintAll = () => tiles.forEach((_, i) => paint(i));
  function refresh(inputs = state.inputs.filter(i => !i.error)) {
    clear(grid);
    tiles.clear();
    for (const input of inputs) {
      const img = el('img', { alt: '' });
      const tag = el('span', { class: 'new-tag' });
      const one = (icn, de, en, fn) => iconBtn(icn, T(lang, { de: `${de}: ${input.name}`, en: `${en}: ${input.name}` }), () => { fn(tOf(input)); paint(input); changed(); });
      const li = el('li', { class: 'new-rot-tile' },
        el('div', { class: 'new-rot-img' }, img),
        el('p', { class: 'new-rot-name' }, input.name), tag,
        el('div', { class: 'new-tools' },
          one(ICON.rotL, 'Links drehen', 'Rotate left', t => { t.rot = (t.rot + 3) % 4; }),
          one(ICON.rotR, 'Rechts drehen', 'Rotate right', t => { t.rot = (t.rot + 1) % 4; }),
          one(ICON.flipH, 'Spiegeln', 'Flip', t => { t.flipH = !t.flipH; })));
      tiles.set(input, { img, tag });
      grid.append(li);
      input.thumbnail(140).then(c => c.toBlob(bl => { if (bl) { img.src = URL.createObjectURL(bl); img.onload = () => URL.revokeObjectURL(img.src); } })).catch(() => {});
      paint(input);
    }
  }
  refresh();
  return { refresh };
}

/** CSS transform equal to the tool's transform (quarter turns first, then flips in display space). */
function cssTransform(t) {
  return `scale(${t.flipH ? -1 : 1}, ${t.flipV ? -1 : 1}) rotate(${t.rot * 90}deg)`;
}
