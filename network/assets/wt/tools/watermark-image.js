// Tool: watermark photos (Bild mit Wasserzeichen). Text once in a corner / the centre or repeated diagonally
// over the whole photo, colour, opacity, size, a thin contrasting outline so it reads on light and dark parts,
// many photos at once with the same look (sizes relative to each photo). Live preview of the chosen photo.
// Optional smaller copy for the web (a stolen copy then isn't print quality). Saved in the original format;
// re-encoding drops location and camera data.
import { el, clear } from '../lib/dom.js';
import { loadCanvas, encode, release, keepFormat, FORMATS, ensureCss, imgProgress, uniqueNames, T } from '../lib/img-core.js';

ensureCss();
const YEAR = new Date().getFullYear();
const LANG = document.documentElement.lang === 'en' ? 'en' : 'de';
const POS = ['tl', 'tc', 'tr', 'cl', 'cc', 'cr', 'bl', 'bc', 'br'];

/**
 * Draw the watermark onto a 2D context of size W × H. o: { text, layout 'single'|'tiled', position, size
 * (text height in % of the shorter side), opacity (%), color, outline, angle (deg, tiled) }.
 */
export function drawWatermark(g, W, H, o) {
  const text = String(o.text || '').trim();
  if (!text) return;
  // relative to the shorter side, but panoramas (very wide or tall) use a third of the long side
  const short = Math.max(Math.min(W, H), Math.max(W, H) * 0.35);
  const fs = Math.max(8, Math.min(Math.min(W, H) * 0.8, short * (+o.size || 5) / 100));
  g.save();
  g.globalAlpha = Math.min(1, Math.max(0.05, (+o.opacity || 50) / 100));
  g.font = `700 ${fs}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  const color = o.color || '#ffffff';
  const dark = lum(color) < 0.45;
  const stroke = dark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.6)';
  const tw = g.measureText(text).width;
  const put = (x, y) => {
    if (o.outline !== false) { g.lineWidth = Math.max(1, fs * 0.08); g.strokeStyle = stroke; g.strokeText(text, x, y); }
    g.fillStyle = color; g.fillText(text, x, y);
  };
  if (o.layout === 'tiled') {
    const a = (-(+o.angle || 30) * Math.PI) / 180;
    g.translate(W / 2, H / 2); g.rotate(a);
    const diag = Math.hypot(W, H);
    const sx = tw + fs * 3, sy = fs * 4;
    g.textAlign = 'left';
    let row = 0;
    for (let y = -diag / 2; y <= diag / 2 + sy; y += sy, row++) {
      const off = (row % 2) * sx / 2;
      for (let x = -diag / 2 - sx + off; x <= diag / 2; x += sx) put(x, y);
    }
  } else {
    const m = fs * 0.9;
    const p = POS.includes(o.position) ? o.position : 'br';
    const x = p[1] === 'l' ? m : p[1] === 'r' ? W - m : W / 2;
    const y = p[0] === 't' ? m + fs / 2 : p[0] === 'b' ? H - m - fs / 2 : H / 2;
    g.textAlign = p[1] === 'l' ? 'left' : p[1] === 'r' ? 'right' : 'center';
    // never wider than the photo: shrink a long text
    if (tw > W - 2 * m) { const k = (W - 2 * m) / tw; g.font = `700 ${fs * k}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`; }
    put(x, y);
  }
  g.restore();
}
function lum(hex) {
  const n = parseInt(String(hex).replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return (0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

let stageApi = null;

export default {
  shareFirst: true,
  stageAfterOptions: true,
  options: [
    { id: 'text', type: 'text', default: `© ${YEAR}`, maxLength: 80, label: { de: 'Text', en: 'Text' },
      placeholder: { de: '© Dein Name', en: '© Your name' }, hint: { de: 'Z. B. dein Name, deine Website oder „Nur für Kleinanzeigen“.', en: 'E.g. your name, your website or “For this listing only”.' } },
    { id: 'layout', type: 'radio', default: 'single', label: { de: 'Anordnung', en: 'Layout' },
      choices: [
        { value: 'single', label: { de: 'Einmal', en: 'Once' }, hint: { de: 'Dezent in einer Ecke', en: 'Discreetly in a corner' } },
        { value: 'tiled', label: { de: 'Über das ganze Bild', en: 'All over the photo' }, hint: { de: 'Schwer wegzuschneiden', en: 'Hard to crop away' } },
      ] },
    { id: 'position', type: 'select', default: 'br', when: v => v.layout === 'single', label: { de: 'Position', en: 'Position' },
      choices: [
        { value: 'br', label: { de: 'Unten rechts', en: 'Bottom right' } }, { value: 'bl', label: { de: 'Unten links', en: 'Bottom left' } }, { value: 'bc', label: { de: 'Unten Mitte', en: 'Bottom centre' } },
        { value: 'cc', label: { de: 'Mitte', en: 'Centre' } }, { value: 'tr', label: { de: 'Oben rechts', en: 'Top right' } }, { value: 'tl', label: { de: 'Oben links', en: 'Top left' } }, { value: 'tc', label: { de: 'Oben Mitte', en: 'Top centre' } },
      ] },
    { id: 'angle', type: 'select', default: 30, when: v => v.layout === 'tiled', label: { de: 'Neigung', en: 'Angle' },
      choices: [{ value: 0, label: { de: 'Waagerecht', en: 'Horizontal' } }, { value: 30, label: '30°' }, { value: 45, label: '45°' }] },
    { id: 'size', type: 'range', default: 5, min: 2, max: 20, step: 1, unit: '%', live: true, label: { de: 'Schriftgröße', en: 'Text size' },
      hint: { de: 'Im Verhältnis zur kürzeren Bildseite – sieht auf großen und kleinen Fotos gleich aus.', en: 'Relative to the shorter side – looks the same on large and small photos.' } },
    { id: 'opacity', type: 'range', default: 60, min: 10, max: 100, step: 5, unit: '%', live: true, label: { de: 'Deckkraft', en: 'Opacity' } },
    { id: 'color', type: 'color', default: '#ffffff', label: { de: 'Farbe', en: 'Colour' } },
    { id: 'outline', type: 'toggle', default: true, label: { de: 'Feine Kontur für helle und dunkle Stellen', en: 'Thin outline for light and dark areas' } },
    { id: 'maxSide', type: 'select', default: 0, label: { de: 'Bildgröße', en: 'Image size' },
      hint: { de: 'Fürs Internet reicht eine kleinere Kopie – wer sie kopiert, hat dann keine Druckqualität.', en: 'A smaller copy is enough online – anyone who copies it won’t get print quality.' },
      choices: [{ value: 0, label: { de: 'Original behalten', en: 'Keep original' } }, { value: 2048, label: '2048 px' }, { value: 1600, label: { de: '1600 px (Kleinanzeigen, Web)', en: '1600 px (listings, web)' } }, { value: 1080, label: '1080 px (Social Media)' }] },
  ],
  status(v) {
    if (!String(v.text || '').trim()) return { ok: false, hint: { de: 'Gib einen Text für das Wasserzeichen ein.', en: 'Enter a text for the watermark.' } };
    return {};
  },
  mountStage(stage, state, ctx) { stageApi = preview(stage, state, ctx); },
  onInputs() { stageApi?.render(); },
  onOptionsChange() { stageApi?.render(); },

  async run(inputs, opts, ctx) {
    const outputs = [];
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];
      ctx.progress(i / inputs.length, imgProgress(i, inputs.length, input.name));
      await ctx.tick();
      const { canvas, width } = await loadCanvas(input, { maxSide: +opts.maxSide || 0 });
      drawWatermark(canvas.getContext('2d'), canvas.width, canvas.height, opts);
      const fmt = keepFormat(input);
      const blob = await encode(canvas, { format: fmt, quality: 0.92 });
      const note = canvas.width < width ? ctx.t({ de: `${canvas.width} × ${canvas.height} px`, en: `${canvas.width} × ${canvas.height} px` }) : '';
      release(canvas);
      outputs.push({ name: ctx.fileName(input.name, ctx.t({ de: ' (Wasserzeichen)', en: ' (watermark)' }), FORMATS[fmt].ext), blob, note });
    }
    ctx.note({ de: 'Standort- und Kameradaten sind in den neuen Dateien nicht mehr enthalten.', en: 'Location and camera data are no longer in the new files.' });
    return { outputs: uniqueNames(outputs) };
  },
};

function preview(stage, state, ctx) {
  const lang = ctx.lang || LANG;
  const canvas = el('canvas', { class: 'img-wm-canvas', width: 10, height: 10, role: 'img', aria: { label: T(lang, { de: 'Vorschau mit Wasserzeichen', en: 'Preview with watermark' }) } });
  const pick = el('select', { class: 'wt-input', id: 'img-wm-pick', aria: { label: T(lang, { de: 'Vorschau für', en: 'Preview for' }) } });
  const pickRow = el('div', { class: 'img-field' }, el('label', { for: 'img-wm-pick' }, T(lang, { de: 'Vorschau für', en: 'Preview for' })), pick);
  stage.append(el('section', { class: 'img-box', aria: { labelledby: 'img-wm-h' } },
    el('h2', { class: 'img-h', id: 'img-wm-h' }, T(lang, { de: 'Vorschau', en: 'Preview' })), pickRow,
    el('div', { class: 'img-wm-frame' }, canvas)));
  pick.addEventListener('change', () => { base = null; render(); });
  let base = null, baseFor = null, timer = 0, token = 0;
  async function draw() {
    const inputs = state.inputs.filter(i => !i.error);
    const names = inputs.map(i => i.name).join('\n');
    if (pick.dataset.names !== names) {
      clear(pick); inputs.forEach((inp, i) => pick.append(el('option', { value: String(i) }, inp.name)));
      pick.dataset.names = names;
    }
    pickRow.hidden = inputs.length < 2;
    const input = inputs[+pick.value || 0];
    if (!input) return;
    const my = ++token;
    if (baseFor !== input || !base) {
      const w = Math.min(900, Math.max(320, stage.clientWidth || 600));
      base = await input.thumbnail(w); baseFor = input;
      if (my !== token) return;
    }
    canvas.width = base.width; canvas.height = base.height;
    const g = canvas.getContext('2d');
    g.drawImage(base, 0, 0);
    drawWatermark(g, canvas.width, canvas.height, state.values);
  }
  function render() { clearTimeout(timer); timer = setTimeout(() => { draw().catch(() => {}); }, 60); }
  render();
  return { render };
}
