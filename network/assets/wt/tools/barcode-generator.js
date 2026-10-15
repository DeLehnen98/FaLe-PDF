// Tool: barcode generator (no file intake) – EAN-13, EAN-8, UPC-A (check digit added or verified),
// Code 128 (automatic B/C switching), Code 39 (optional mod-43 check), ITF-14 (optional bearer bars).
// Live preview, human-readable text, size in mm, colours, PNG (with print resolution) / SVG / PDF (vector).
// Every output is read back by a decoder (lib/seo-barcode.js) before it is offered.
import { el, icon, clear } from '../lib/dom.js';
import { loadPdfLib, saveDoc } from '../lib/pdf.js';
import { TYPES, LABEL, normalize, encode, decodeRow } from '../lib/seo-barcode.js';
import { seoCss } from '../lib/seo-ui.js';

seoCss();
const T = (lang, v) => (v == null ? '' : typeof v === 'string' ? v : v[lang] ?? v.de);
const userError = msg => Object.assign(new Error(msg.en), { userMessage: msg });

const EXAMPLES = { ean13: '400638133393', ean8: '9638507', upca: '03600029145', code128: 'FaLe-2024-0815', code39: 'ART-4711', itf14: '1540014128876' };
const NUMERIC = new Set(['ean13', 'ean8', 'upca', 'itf14']);
const TEXT_SIZE = 10, SMALL_SIZE = 7, CAP = 0.72, BEARER = 5;

// ---------------------------------------------------------------- model
function build(v) {
  const bc = v.bc || {};
  const type = TYPES.includes(bc.type) ? bc.type : 'ean13';
  if (!String(bc.value ?? '').trim()) return { empty: true, type };
  try {
    const n = normalize(type, bc.value, { check39: !!v.check39 });
    const sym = encode(type, n.data, { text: n.text, bearer: type === 'itf14' && v.bearer !== false });
    return { type, n, sym };
  } catch (err) {
    if (err.userMessage) return { type, error: err.userMessage };
    throw err;
  }
}

/** Geometry in module units: rects (dark), texts, total W × H and the y of a scanline through the bars. */
function layout(sym, v) {
  const mm = +v.module || 0.33;
  const barH = Math.max(5, +v.height || 22) / mm;
  const show = v.showText !== false;
  const ox = sym.bearer ? BEARER : 0;
  const y0 = sym.bearer ? BEARER : 2;
  const rects = [];
  const guardExt = sym.ean ? (show ? 5 : 0) : 0;
  for (const b of sym.bars) rects.push({ x: ox + b.x, y: y0, w: b.w, h: barH + (b.guard ? guardExt : 0) });
  let bottom = y0 + barH;
  if (sym.bearer) {
    const W = sym.width + 2 * ox;
    rects.push({ x: 0, y: 0, w: W, h: BEARER }, { x: 0, y: y0 + barH, w: W, h: BEARER }, { x: 0, y: 0, w: BEARER, h: y0 + barH + BEARER }, { x: W - BEARER, y: 0, w: BEARER, h: y0 + barH + BEARER });
    bottom += BEARER;
  }
  const texts = [];
  if (show) {
    const top = bottom + (sym.ean ? 1 : 2);
    for (const t of sym.text) {
      const size = t.small ? SMALL_SIZE : TEXT_SIZE;
      texts.push({ x: ox + t.x, y: top + size * CAP, s: t.s, size, anchor: t.anchor });
    }
    bottom = top + TEXT_SIZE * CAP + 2;
  } else bottom += guardExt + 2;
  return { W: sym.width + 2 * ox, H: bottom, rects, texts, scanY: y0 + barH / 2, mm };
}

// ---------------------------------------------------------------- renderers
const FONT = 'Helvetica, Arial, "Liberation Sans", sans-serif';
function toCanvas(g, mpx, v) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(g.W * mpx)); c.height = Math.max(1, Math.round(g.H * mpx));
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = v.light || '#ffffff'; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = v.dark || '#000000';
  for (const r of g.rects) x.fillRect(Math.round(r.x * mpx), Math.round(r.y * mpx), Math.round(r.w * mpx), Math.round(r.h * mpx));
  for (const t of g.texts) {
    x.font = `${t.size * mpx}px ${FONT}`;
    x.textAlign = t.anchor === 'middle' ? 'center' : t.anchor === 'end' ? 'right' : 'left';
    x.textBaseline = 'alphabetic';
    x.fillText(t.s, t.x * mpx, t.y * mpx);
  }
  return c;
}

const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r4 = n => Math.round(n * 1e4) / 1e4;
function toSvg(g, v, title) {
  const d = g.rects.map(r => `M${r4(r.x)} ${r4(r.y)}h${r4(r.w)}v${r4(r.h)}h${r4(-r.w)}z`).join('');
  const texts = g.texts.map(t => `<text x="${r4(t.x)}" y="${r4(t.y)}" font-size="${t.size}" text-anchor="${t.anchor}">${xml(t.s)}</text>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${r4(g.W * g.mm)}mm" height="${r4(g.H * g.mm)}mm" viewBox="0 0 ${r4(g.W)} ${r4(g.H)}" shape-rendering="crispEdges">` +
    `<title>${xml(title)}</title><rect width="100%" height="100%" fill="${xml(v.light || '#ffffff')}"/>` +
    `<path fill="${xml(v.dark || '#000000')}" d="${d}"/>` +
    (texts ? `<g fill="${xml(v.dark || '#000000')}" font-family="${xml(FONT)}">${texts}</g>` : '') + '</svg>\n';
}

async function toPdf(g, v, title) {
  const PDFLib = await loadPdfLib();
  const { prepareText, measure } = await import('../lib/unifont.js');
  const doc = await PDFLib.PDFDocument.create();
  const k = g.mm * 72 / 25.4;   // pt per module
  const W = g.W * k, H = g.H * k;
  const page = doc.addPage([W, H]);
  const hex = h => { const n = parseInt(String(h || '#000000').slice(1), 16); return PDFLib.rgb((n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: hex(v.light || '#ffffff') });
  for (const r of g.rects) page.drawRectangle({ x: r.x * k, y: H - (r.y + r.h) * k, width: r.w * k, height: r.h * k, color: hex(v.dark) });
  for (const t of g.texts) {
    const { font, text } = await prepareText(doc, t.s, { family: 'sans' });
    const size = t.size * k;
    const w = measure(font, text, size);
    const x = t.anchor === 'middle' ? t.x * k - w / 2 : t.anchor === 'end' ? t.x * k - w : t.x * k;
    page.drawText(text, { x, y: H - t.y * k, size, font, color: hex(v.dark) });
  }
  return new Blob([await saveDoc(doc, { title })], { type: 'application/pdf' });
}

// PNG with a pHYs chunk, so office and print programs place it at the intended size
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = bytes => { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function withDpi(png, dpi) {
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4);   // 'pHYs'
  dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1;
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  const at = 8 + 25;   // signature + IHDR chunk
  const out = new Uint8Array(png.length + 21);
  out.set(png.subarray(0, at)); out.set(chunk, at); out.set(png.subarray(at), at + 21);
  return out;
}

// ---------------------------------------------------------------- self-test (read the pixels back)
function lum(hex) {
  const n = parseInt(String(hex || '#000000').slice(1), 16);
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}
function readCanvas(canvas, y, b, v) {
  const x = canvas.getContext('2d', { willReadFrequently: true });
  const row = x.getImageData(0, Math.min(canvas.height - 1, Math.max(0, Math.round(y))), canvas.width, 1).data;
  const ld = lum(v.dark), ll = lum(v.light);
  const th = (Math.sqrt(ld) + Math.sqrt(ll)) / 2;
  const dark = [];
  for (let i = 0; i < row.length; i += 4) {
    const l = Math.sqrt(lum('#' + ((row[i] << 16) | (row[i + 1] << 8) | row[i + 2]).toString(16).padStart(6, '0')));
    dark.push(ld < ll ? l < th : l > th);
  }
  return decodeRow(b.type, dark, { check39: !!v.check39 }) === b.n.data;
}
async function svgSelfTest(svgText, g, b, v) {
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const mpx = 3;
    const c = document.createElement('canvas');
    c.width = Math.round(g.W * mpx); c.height = Math.round(g.H * mpx);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const ok = readCanvas(c, g.scanY * mpx, b, v);
    c.width = c.height = 0;
    return ok;
  } catch { return false; } finally { URL.revokeObjectURL(url); }
}

function warnings(b, v) {
  const out = [];
  const a = lum(v.dark), c = lum(v.light);
  if (a > c) out.push({ de: 'Helle Striche auf dunklem Grund: Viele Scanner lesen nur dunkle Striche auf hellem Grund. Tausch die Farben.', en: 'Light bars on a dark background: many scanners only read dark bars on a light background. Swap the colours.' });
  else if ((c + 0.05) / (a + 0.05) < 4) out.push({ de: 'Wenig Kontrast zwischen Strichen und Hintergrund – das kann beim Scannen Probleme machen.', en: 'Low contrast between bars and background – this can cause scanning problems.' });
  if (b && ['ean13', 'ean8', 'upca'].includes(b.type) && (+v.module || 0.33) < 0.264) out.push({ de: 'Unter 80 % der Normgröße (0,264 mm pro Modul) lesen Kassenscanner EAN- und UPC-Codes oft nicht zuverlässig.', en: 'Below 80 % of the nominal size (0.264 mm per module) checkout scanners often can’t read EAN and UPC codes reliably.' });
  return out;
}

// ---------------------------------------------------------------- tool
let stageCtl = null;
const isType = (...t) => v => t.includes(v.bc?.type || 'ean13');

export default {
  shareFirst: false,
  labels: { back_to_files: { de: 'Zurück zum Bearbeiten', en: 'Back to editing' } },
  options: [
    { id: 'format', type: 'radio', default: 'png', label: { de: 'Speichern als', en: 'Save as' },
      choices: [
        { value: 'png', label: 'PNG', hint: { de: 'Bild für Office, Web, Etiketten', en: 'Image for office, web, labels' } },
        { value: 'svg', label: 'SVG', hint: { de: 'Vektor, beliebig skalierbar', en: 'Vector, scales to any size' } },
        { value: 'pdf', label: 'PDF', hint: { de: 'Vektor zum Drucken', en: 'Vector for printing' } },
      ] },
    { id: 'module', type: 'select', default: 0.33, label: { de: 'Strichbreite (Modul)', en: 'Bar width (module)' },
      hint: { de: 'Die schmalste Strichbreite. 0,33 mm ist die Normgröße für EAN und UPC.', en: 'The narrowest bar width. 0.33 mm is the nominal size for EAN and UPC.' },
      choices: [0.25, 0.3, 0.33, 0.4, 0.5, 0.66].map(m => ({ value: m, label: { de: `${String(m).replace('.', ',')} mm`, en: `${m} mm` } })) },
    { id: 'height', type: 'range', default: 22, min: 5, max: 60, step: 1, unit: 'mm', label: { de: 'Strichhöhe', en: 'Bar height' },
      format: (v, lang) => `${v} mm` },
    { id: 'showText', type: 'toggle', default: true, label: { de: 'Klartext unter dem Code', en: 'Human-readable text' } },
    { id: 'check39', type: 'toggle', default: false, label: { de: 'Prüfzeichen (Modulo 43)', en: 'Check character (modulo 43)' },
      hint: { de: 'Nur einschalten, wenn dein Scanner oder System es erwartet.', en: 'Only turn on if your scanner or system expects it.' }, when: isType('code39') },
    { id: 'bearer', type: 'toggle', default: true, label: { de: 'Rahmen (Bearer Bars)', en: 'Frame (bearer bars)' },
      hint: { de: 'Üblich bei ITF-14 auf Kartons: verhindert Fehllesungen, wenn der Scanner schräg über den Code fährt.', en: 'Common for ITF-14 on cartons: prevents misreads when the scanner crosses the code at an angle.' }, when: isType('itf14') },
    { id: 'dpi', type: 'select', default: 600, label: { de: 'Auflösung', en: 'Resolution' }, when: v => v.format === 'png',
      choices: [{ value: 300, label: '300 dpi' }, { value: 600, label: { de: '600 dpi (empfohlen)', en: '600 dpi (recommended)' } }, { value: 1200, label: '1200 dpi' }] },
    { id: 'dark', type: 'color', default: '#000000', label: { de: 'Farbe der Striche', en: 'Bar colour' } },
    { id: 'light', type: 'color', default: '#ffffff', label: { de: 'Hintergrund', en: 'Background' } },
  ],

  mountStage(stage, state, ctx) { stageCtl = bcStage(stage, state, ctx); },
  onOptionsChange() { stageCtl?.render(); },

  status(v) {
    const b = build(v);
    if (b.empty) return { ok: false, hint: { de: 'Gib oben ein, was im Barcode stehen soll.', en: 'Enter above what the barcode should contain.' } };
    if (b.error) return { ok: false, hint: b.error };
    const g = layout(b.sym, v);
    return { summary: { de: `${LABEL[b.type]} · ${(g.W * g.mm).toFixed(1).replace('.', ',')} × ${(g.H * g.mm).toFixed(1).replace('.', ',')} mm`, en: `${LABEL[b.type]} · ${(g.W * g.mm).toFixed(1)} × ${(g.H * g.mm).toFixed(1)} mm` } };
  },

  async run(inputs, opts, ctx) {
    const b = build(opts);
    if (b.empty) throw userError({ de: 'Kein Inhalt.', en: 'No content.' });
    if (b.error) throw userError(b.error);
    const g = layout(b.sym, opts);
    const title = `${LABEL[b.type]} ${b.n.text}`;
    const base = ctx.safeFileName(`Barcode ${title}`);
    let blob, name, ok;
    if (opts.format === 'svg') {
      const svg = toSvg(g, opts, title);
      ok = await svgSelfTest(svg, g, b, opts);
      blob = new Blob([svg], { type: 'image/svg+xml' }); name = `${base}.svg`;
    } else if (opts.format === 'pdf') {
      const test = toCanvas(g, 3, opts);
      ok = readCanvas(test, g.scanY * 3, b, opts);
      test.width = test.height = 0;
      blob = await toPdf(g, opts, title); name = `${base}.pdf`;
    } else {
      const dpi = +opts.dpi || 600;
      const mpx = Math.max(1, Math.round(g.mm / 25.4 * dpi));
      const c = toCanvas(g, mpx, opts);
      ok = readCanvas(c, g.scanY * mpx, b, opts);
      const png = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer());
      c.width = c.height = 0;
      // whole pixels per module: the real module width at this resolution
      const realMm = mpx * 25.4 / dpi;
      blob = new Blob([withDpi(png, dpi)], { type: 'image/png' }); name = `${base}.png`;
      if (Math.abs(realMm - g.mm) > 0.005) ctx.note({ de: `Bei ${dpi} dpi ist ein Modul ${realMm.toFixed(3).replace('.', ',')} mm breit (ganze Pixel bleiben scharf).`, en: `At ${dpi} dpi a module is ${realMm.toFixed(3)} mm wide (whole pixels stay sharp).` });
    }
    const note = ok ? ctx.t({ de: `Selbsttest bestanden: Der Barcode liest sich wieder als „${b.n.data}“.`, en: `Self-test passed: the barcode reads back as “${b.n.data}”.` })
      : ctx.t({ de: 'Achtung: Der Selbsttest konnte den Barcode nicht lesen. Prüf Farben und Größe.', en: 'Warning: the self-test could not read the barcode. Check the colours and size.' });
    for (const w of warnings(b, opts)) ctx.note(w);
    return { outputs: [{ name, blob, note }] };
  },
};

// ---------------------------------------------------------------- stage
function bcStage(stage, state, ctx) {
  const lang = ctx.lang;
  const bc = (state.values.bc ||= { type: 'ean13', value: '' });
  const seg = el('fieldset', { class: 'img-seg' }, el('legend', { class: 'img-seg-legend' }, T(lang, { de: 'Barcode-Typ', en: 'Barcode type' })),
    el('div', { class: 'img-seg-row' }, TYPES.map(t => el('label', { class: 'img-seg-opt' },
      el('input', { type: 'radio', name: 'seo-bc-type', value: t, checked: t === bc.type, onchange: () => { bc.type = t; setInput(); changed(); } }),
      el('span', {}, LABEL[t])))));
  const input = el('input', { id: 'seo-bc-value', class: 'wt-input', type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: '80', aria: { describedby: 'seo-bc-hint' },
    oninput: e => { bc.value = e.target.value; changed(); } });
  const hint = el('p', { class: 'wt-opt-hint', id: 'seo-bc-hint' });
  const canvas = el('canvas', { class: 'seo-bc-canvas', width: 10, height: 10, role: 'img', aria: { label: T(lang, { de: 'Vorschau des Barcodes', en: 'Barcode preview' }) } });
  const empty = el('p', { class: 'img-qr-empty' });
  const info = el('p', { class: 'img-muted' });
  const test = el('p', { class: 'img-qr-test', role: 'status' });
  const warns = el('div', {});
  const box = el('section', { class: 'img-box seo-bc', aria: { labelledby: 'seo-bc-h' } },
    el('h2', { class: 'img-h', id: 'seo-bc-h' }, T(lang, { de: 'Inhalt', en: 'Content' })),
    seg, el('div', { class: 'img-field' }, el('label', { for: 'seo-bc-value' }, T(lang, { de: 'Nummer oder Text', en: 'Number or text' })), input, hint),
    el('div', { class: 'img-qr-preview' }, el('div', { class: 'seo-bc-frame' }, canvas, empty), info, test, warns));
  stage.append(box);

  const HINTS = {
    ean13: { de: '12 Ziffern – die Prüfziffer wird ergänzt. Mit 13 Ziffern wird sie geprüft.', en: '12 digits – the check digit is added. With 13 digits it is checked.' },
    ean8: { de: '7 Ziffern – die Prüfziffer wird ergänzt. Mit 8 Ziffern wird sie geprüft.', en: '7 digits – the check digit is added. With 8 digits it is checked.' },
    upca: { de: '11 Ziffern – die Prüfziffer wird ergänzt. Mit 12 Ziffern wird sie geprüft.', en: '11 digits – the check digit is added. With 12 digits it is checked.' },
    code128: { de: 'Buchstaben, Ziffern und Zeichen (ASCII, ohne Umlaute), bis 80 Zeichen.', en: 'Letters, digits and symbols (ASCII), up to 80 characters.' },
    code39: { de: 'A–Z, 0–9, Leerzeichen und - . $ / + %, bis 40 Zeichen.', en: 'A–Z, 0–9, space and - . $ / + %, up to 40 characters.' },
    itf14: { de: '13 Ziffern – die Prüfziffer wird ergänzt. Mit 14 Ziffern wird sie geprüft.', en: '13 digits – the check digit is added. With 14 digits it is checked.' },
  };
  function setInput() {
    input.inputMode = NUMERIC.has(bc.type) ? 'numeric' : 'text';
    input.placeholder = `${T(lang, { de: 'z. B.', en: 'e.g.' })} ${EXAMPLES[bc.type]}`;
    hint.textContent = T(lang, HINTS[bc.type]);
  }
  let timer = 0;
  function changed() { state.results.clear(); ctx.refresh(); clearTimeout(timer); timer = setTimeout(render, 80); }

  function render() {
    const v = state.values;
    const b = build(v);
    clear(warns);
    if (b.empty || b.error) {
      canvas.hidden = true; empty.hidden = false;
      empty.textContent = b.error ? T(lang, b.error) : T(lang, { de: 'Hier erscheint dein Barcode.', en: 'Your barcode appears here.' });
      empty.classList.toggle('is-error', !!b.error);
      input.setAttribute('aria-invalid', b.error ? 'true' : 'false');
      info.textContent = ''; test.textContent = ''; test.className = 'img-qr-test';
      ctx.refresh();
      return;
    }
    input.setAttribute('aria-invalid', 'false');
    const g = layout(b.sym, v);
    const cssW = Math.max(120, (box.clientWidth || 320) - 60);
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const mpx = Math.max(1, Math.floor(cssW * dpr / g.W));
    const c = toCanvas(g, mpx, v);
    canvas.width = c.width; canvas.height = c.height;
    canvas.getContext('2d').drawImage(c, 0, 0);
    const ok = readCanvas(c, g.scanY * mpx, b, v);
    c.width = c.height = 0;
    canvas.style.width = `${Math.min(cssW, canvas.width / dpr)}px`;
    canvas.hidden = false; empty.hidden = true;
    const size = lang === 'de' ? `${(g.W * g.mm).toFixed(1).replace('.', ',')} × ${(g.H * g.mm).toFixed(1).replace('.', ',')} mm` : `${(g.W * g.mm).toFixed(1)} × ${(g.H * g.mm).toFixed(1)} mm`;
    info.textContent = [LABEL[b.type], b.n.data, size, T(lang, b.n.note)].filter(Boolean).join(' · ');
    test.className = 'img-qr-test ' + (ok ? 'is-ok' : 'is-bad');
    clear(test).append(icon(ok ? 'check' : 'alert'), el('span', {}, T(lang, ok ? { de: 'Selbsttest: lesbar', en: 'Self-test: readable' } : { de: 'Selbsttest: nicht lesbar – prüf Farben und Größe', en: 'Self-test: not readable – check colours and size' })));
    for (const w of warnings(b, v)) warns.append(el('p', { class: 'img-note' }, icon('alert'), el('span', {}, T(lang, w))));
  }

  input.value = bc.value || '';
  setInput();
  render();
  return { render };
}
