// Tools: Wasserzeichen, Seitenzahlen, Kopf- & Fußzeile.
// One layout engine computes draw operations in "visual" page coordinates (as displayed, origin
// bottom-left); they drive both the live preview (canvas) and the PDF output (pdf-lib), so the
// preview matches the result. Page /Rotate and CropBox are respected.
import { icon } from '../icons.js';
import { h, esc, toast, errorToast, progress, baseName, pickFiles } from '../ui.js';
import { resultCard } from '../components.js';
import { saveResult } from '../library.js';
import { loadPdf, renderPage } from '../pdfcore.js';
import { loadEditable, loadPdfLib, saveDoc } from '../pdflib.js';
import { openToolDoc, parseRange, hexToRgb, makeSanitizer, readImageFile, swatches, tick, proBadge, updateFoot } from './common.js';

const STAMP_COLORS = [
  { c: '#9AA0B4', n: 'Grau' }, { c: '#1F2340', n: 'Schwarz' }, { c: '#E03131', n: 'Rot' },
  { c: '#1C64F2', n: 'Blau' }, { c: '#2F9E44', n: 'Grün' }, { c: '#F08C00', n: 'Orange' },
];
const today = () => new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

// ---------------------------------------------------------------- font metrics (pdf-lib)
let metricsPromise = null;
function metrics() {
  if (!metricsPromise) metricsPromise = (async () => {
    const { PDFDocument, StandardFonts } = await loadPdfLib();
    const d = await PDFDocument.create();
    return { regular: await d.embedFont(StandardFonts.Helvetica), bold: await d.embedFont(StandardFonts.HelveticaBold) };
  })();
  return metricsPromise;
}

// ---------------------------------------------------------------- layout
/**
 * @returns {Array<{kind:'text'|'image', text?, x, y, size?, w?, h?, rot, color?, opacity, bold?}>}
 *  x/y = origin (text baseline-left / image bottom-left) in visual coordinates; rot in degrees CCW.
 */
function layout(mode, s, ctx) {
  const { VW, VH, index, count, pageNum, total, fonts, docName } = ctx;
  const ops = [];
  const width = (t, size, bold) => (bold ? fonts.bold : fonts.regular).widthOfTextAtSize(t, size);
  if (mode === 'watermark') {
    const rad = (s.rotation * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    let w, hh;
    if (s.kind === 'image') {
      if (!s.image) return ops;
      w = VW * s.scale / 100; hh = w * s.image.h / s.image.w;
    } else {
      if (!s.text.trim()) return ops;
      w = width(s.text, s.size, s.bold); hh = s.size * 0.72;
    }
    const ex = (Math.abs(w * cos) + Math.abs(hh * sin)) / 2, ey = (Math.abs(w * sin) + Math.abs(hh * cos)) / 2;
    const m = 24;
    const anchors = [];
    if (s.position === 'tile') {
      const sx = ex * 2 + Math.max(40, s.size * 1.2), sy = ey * 2 + Math.max(40, s.size * 1.2);
      let row = 0;
      for (let y = sy / 2 - sy; y < VH + sy; y += sy, row++) {
        for (let x = (row % 2 ? sx / 2 : 0) - sx / 2; x < VW + sx; x += sx) anchors.push([x, y]);
      }
    } else {
      const [py, px] = s.position.split('-');
      const ax = px === 'l' ? m + ex : px === 'r' ? VW - m - ex : VW / 2;
      const ay = py === 't' ? VH - m - ey : py === 'b' ? m + ey : VH / 2;
      anchors.push([ax, ay]);
    }
    for (const [ax, ay] of anchors) {
      // origin = anchor − R·(w/2, h/2)
      const ox = ax - (cos * w / 2 - sin * hh / 2), oy = ay - (sin * w / 2 + cos * hh / 2);
      if (s.kind === 'image') ops.push({ kind: 'image', x: ox, y: oy, w, h: hh, rot: s.rotation, opacity: s.opacity / 100 });
      else ops.push({ kind: 'text', text: s.text, x: ox, y: oy, size: s.size, rot: s.rotation, color: s.color, opacity: s.opacity / 100, bold: s.bold });
    }
    return ops;
  }
  // page numbers / header-footer: text slots
  const fill = t => String(t || '')
    .replace(/\{seite\}/gi, String(pageNum))
    .replace(/\{seiten\}/gi, String(total))
    .replace(/\{datum\}/gi, today())
    .replace(/\{datei\}/gi, docName);
  const slots = [];
  if (mode === 'numbers') {
    const fmt = { n: '{seite}', s: 'Seite {seite}', sv: 'Seite {seite} von {seiten}', slash: '{seite} / {seiten}', dash: '– {seite} –' }[s.format] || '{seite}';
    const [py, px] = s.position.split('-');
    slots.push({ v: py, hpos: px, text: fill(fmt) });
  } else {
    [['t', 'l', s.hl], ['t', 'c', s.hc], ['t', 'r', s.hr], ['b', 'l', s.fl], ['b', 'c', s.fc], ['b', 'r', s.fr]].forEach(([v, hp, t]) => {
      if (t && t.trim()) slots.push({ v, hpos: hp, text: fill(t) });
    });
  }
  for (const sl of slots) {
    const w = width(sl.text, s.size, s.bold);
    const x = sl.hpos === 'l' ? s.margin : sl.hpos === 'r' ? VW - s.margin - w : (VW - w) / 2;
    const y = sl.v === 't' ? VH - s.margin - s.size * 0.72 : s.margin;
    ops.push({ kind: 'text', text: sl.text, x, y, size: s.size, rot: 0, color: s.color, opacity: 1, bold: s.bold });
  }
  if (s.line && mode === 'header') {
    const hasTop = slots.some(x => x.v === 't'), hasBottom = slots.some(x => x.v === 'b');
    if (hasTop) ops.push({ kind: 'line', x0: s.margin, x1: VW - s.margin, y: VH - s.margin - s.size * 0.72 - 5, color: s.color });
    if (hasBottom) ops.push({ kind: 'line', x0: s.margin, x1: VW - s.margin, y: s.margin + s.size + 3, color: s.color });
  }
  return ops;
}

/** visual (as displayed) → PDF user space for a page with CropBox c and rotation R. */
function toUser(R, c, vx, vy) {
  switch (R) {
    case 90: return [c.x + c.width - vy, c.y + vx];
    case 180: return [c.x + c.width - vx, c.y + c.height - vy];
    case 270: return [c.x + vy, c.y + c.height - vx];
    default: return [c.x + vx, c.y + vy];
  }
}

// ---------------------------------------------------------------- pure apply (also used by the batch tool)
/**
 * Apply watermark / page numbers / header-footer to a PDF.
 * @param {Uint8Array} bytes
 * @param {'watermark'|'numbers'|'header'} mode
 * @param {object} settings  partial settings (merged with the defaults of the mode)
 * @returns {Promise<Uint8Array>}
 */
export async function stampPdf(bytes, mode, settings = {}, { name = 'Dokument', key = null, onProgress = null } = {}) {
  const s = { ...defaults(mode), ...settings };
  const PDFLib = await loadPdfLib();
  const { StandardFonts, rgb, degrees } = PDFLib;
  const fonts = await metrics();
  const pdfDoc = await loadEditable(bytes, name, { key });
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const clean = makeSanitizer(font);
  let image = null;
  if (mode === 'watermark' && s.kind === 'image' && s.image) image = s.image.type === 'png' ? await pdfDoc.embedPng(s.image.bytes) : await pdfDoc.embedJpg(s.image.bytes);
  const pages = pdfDoc.getPages();
  const list = parseRange(s.range, pages.length);
  if (!list || !list.length) throw Object.assign(new Error('range'), { userMessage: 'Bitte gib einen gültigen Seitenbereich ein.' });
  const startN = mode === 'watermark' ? 1 : s.start;
  for (let k = 0; k < list.length; k++) {
    const n = list[k];
    if (k % 10 === 0) { if (onProgress) onProgress(k + 1, list.length); await tick(); }
    const page = pages[n - 1];
    const R = ((page.getRotation().angle % 360) + 360) % 360;
    const crop = page.getCropBox();
    const VW = R % 180 ? crop.height : crop.width, VH = R % 180 ? crop.width : crop.height;
    const ops = layout(mode, s, { VW, VH, index: k, count: list.length, fonts, docName: baseName(name), pageNum: startN + k, total: startN - 1 + list.length });
    for (const op of ops) {
      if (op.kind === 'line') {
        const [x0, y0] = toUser(R, crop, op.x0, op.y), [x1, y1] = toUser(R, crop, op.x1, op.y);
        const [r, g, b] = hexToRgb(op.color);
        page.drawLine({ start: { x: x0, y: y0 }, end: { x: x1, y: y1 }, thickness: 0.6, color: rgb(r, g, b) });
        continue;
      }
      const [x, y] = toUser(R, crop, op.x, op.y);
      const rot = degrees((op.rot || 0) + R);
      if (op.kind === 'text') {
        const [r, g, b] = hexToRgb(op.color);
        page.drawText(clean(op.text), { x, y, size: op.size, font: op.bold ? bold : font, color: rgb(r, g, b), opacity: op.opacity, rotate: rot });
      } else if (op.kind === 'image' && image) {
        page.drawImage(image, { x, y, width: op.w, height: op.h, opacity: op.opacity, rotate: rot });
      }
    }
  }
  return saveDoc(pdfDoc);
}
export const stampDefaults = mode => defaults(mode);

// ---------------------------------------------------------------- shared UI
const CONFIG = {
  watermark: { title: 'Wasserzeichen', icon: 'watermark', suffix: 'Wasserzeichen', okLabel: 'Wasserzeichen einfügen',
    intro: 'Schütze Entwürfe und vertrauliche Unterlagen mit einem Text- oder Bild-Wasserzeichen.' },
  numbers: { title: 'Seitenzahlen', icon: 'hash', suffix: 'nummeriert', okLabel: 'Seitenzahlen einfügen',
    intro: 'Nummeriere die Seiten – Position, Format und Startnummer frei wählbar.' },
  header: { title: 'Kopf- & Fußzeile', icon: 'header', suffix: 'Kopf- und Fußzeile', okLabel: 'Einfügen',
    intro: 'Text oben und unten auf jeder Seite – mit Platzhaltern für Seitenzahl, Datum und Dateiname.' },
};
const STORE = 'fale-stamp-';

export const mountWatermark = (screen, opts) => mountStamp(screen, opts, 'watermark');
export const mountPageNumbers = (screen, opts) => mountStamp(screen, opts, 'numbers');
export const mountHeaderFooter = (screen, opts) => mountStamp(screen, opts, 'header');

function defaults(mode) {
  if (mode === 'watermark') return { kind: 'text', text: 'VERTRAULICH', size: 64, bold: true, color: '#E03131', opacity: 25, rotation: 45, position: 'm-c', scale: 50, range: '', image: null };
  if (mode === 'numbers') return { position: 'b-c', format: 'sv', start: 1, size: 11, margin: 28, color: '#1F2340', bold: false, range: '' };
  return { hl: '', hc: '', hr: '{datum}', fl: '{datei}', fc: '', fr: 'Seite {seite} von {seiten}', size: 9, margin: 24, color: '#4F5475', bold: false, line: false, start: 1, range: '' };
}

async function mountStamp(screen, { docId }, mode) {
  const cfg = CONFIG[mode];
  const ctx = await openToolDoc(screen, docId, cfg.title);
  if (!ctx) return;
  const { doc, bytes } = ctx;
  const { pdf } = await loadPdf(bytes.slice(), { name: doc.name, key: docId });
  const fonts = await metrics();
  let s = defaults(mode);
  try { const saved = JSON.parse(localStorage.getItem(STORE + mode) || 'null'); if (saved) s = { ...s, ...saved, image: null, range: '' }; } catch {}
  if (mode === 'watermark' && s.kind === 'image') s.kind = 'text';
  const persist = () => { try { const { image, range, ...rest } = s; localStorage.setItem(STORE + mode, JSON.stringify(rest)); } catch {} };
  let previewPage = 1;
  let alive = true;
  let ready = false;

  const wrap = h(`<div class="screen-inner pt-stamp">
    <div class="card intro"><span class="tile-ic">${icon(cfg.icon)}</span><div><strong>${esc(doc.name)}</strong><p>${esc(cfg.intro)} ${proBadge()}</p></div></div>
    <div class="pt-stamp-grid">
      <div class="pt-preview-col">
        <div class="pt-preview" data-preview><div class="pt-prev-page"><span class="spinner dark"></span></div></div>
        <div class="pt-prev-nav">
          <button class="icon-btn" type="button" data-prev aria-label="Vorherige Seite">${icon('chevronLeft')}</button>
          <span data-pinfo>Seite 1 von ${pdf.numPages}</span>
          <button class="icon-btn" type="button" data-next aria-label="Nächste Seite">${icon('chevronRight')}</button>
        </div>
      </div>
      <form class="card card-pad pt-settings" data-form novalidate></form>
    </div>
    <div data-result></div></div>`);
  screen.body.appendChild(wrap);
  const form = wrap.querySelector('[data-form]');
  const prevBox = wrap.querySelector('.pt-prev-page');
  const resultBox = wrap.querySelector('[data-result]');
  form.addEventListener('submit', e => e.preventDefault());
  const btn = h(`<button class="btn btn-primary" type="button">${icon('check')} ${esc(cfg.okLabel)}</button>`);

  // ---------- settings form ----------
  const posGrid = (opts, cur, name) => `<div class="pt-posgrid ${opts.length === 6 ? 'six' : ''}" role="radiogroup" aria-label="Position">${opts.map(([v, label]) =>
    `<button type="button" role="radio" data-${name}="${v}" aria-checked="${v === cur}" aria-label="${esc(label)}" title="${esc(label)}"><span></span></button>`).join('')}</div>`;
  const rangeField = `<label class="field"><span class="field-label">Seiten (leer = alle)</span><input class="input" name="range" placeholder="z. B. 2-${pdf.numPages}" value="${esc(s.range)}"></label>`;
  if (mode === 'watermark') {
    form.innerHTML = `
      <div class="seg pt-seg-full" role="group" aria-label="Art"><button type="button" data-kind="text">Text</button><button type="button" data-kind="image">Bild</button></div>
      <div data-k="text">
        <label class="field"><span class="field-label">Text</span><input class="input" name="text" value="${esc(s.text)}" maxlength="80"></label>
        <label class="field"><span class="field-label">Schriftgröße: <b data-v="size">${s.size}</b> pt</span><input type="range" name="size" min="12" max="160" step="2" value="${s.size}"></label>
        <div class="pt-row"><span class="field-label">Farbe</span><span data-colors></span></div>
        <label class="check"><input type="checkbox" name="bold" ${s.bold ? 'checked' : ''}><span>Fett</span></label>
      </div>
      <div data-k="image" hidden>
        <button class="btn btn-soft btn-block" type="button" data-pickimg>${icon('image')} Bild wählen</button>
        <p class="hint" data-imgname>PNG mit transparentem Hintergrund eignet sich am besten.</p>
        <label class="field"><span class="field-label">Größe: <b data-v="scale">${s.scale}</b> % der Seitenbreite</span><input type="range" name="scale" min="10" max="100" step="5" value="${s.scale}"></label>
      </div>
      <label class="field"><span class="field-label">Deckkraft: <b data-v="opacity">${s.opacity}</b> %</span><input type="range" name="opacity" min="5" max="100" step="5" value="${s.opacity}"></label>
      <label class="field"><span class="field-label">Drehung: <b data-v="rotation">${s.rotation}</b>°</span><input type="range" name="rotation" min="-90" max="90" step="5" value="${s.rotation}"></label>
      <div class="field"><span class="field-label">Position</span>
        <div class="pt-posrow">${posGrid([['t-l', 'Oben links'], ['t-c', 'Oben Mitte'], ['t-r', 'Oben rechts'], ['m-l', 'Mitte links'], ['m-c', 'Mitte'], ['m-r', 'Mitte rechts'], ['b-l', 'Unten links'], ['b-c', 'Unten Mitte'], ['b-r', 'Unten rechts']], s.position, 'pos')}
        <button type="button" class="btn btn-ghost btn-sm" data-pos="tile" aria-pressed="${s.position === 'tile'}">Kacheln</button></div></div>
      ${rangeField}`;
  } else if (mode === 'numbers') {
    form.innerHTML = `
      <div class="field"><span class="field-label">Position</span>${posGrid([['t-l', 'Oben links'], ['t-c', 'Oben Mitte'], ['t-r', 'Oben rechts'], ['b-l', 'Unten links'], ['b-c', 'Unten Mitte'], ['b-r', 'Unten rechts']], s.position, 'pos')}</div>
      <label class="field"><span class="field-label">Format</span><select class="select" name="format">
        <option value="n">1</option><option value="s">Seite 1</option><option value="sv">Seite 1 von N</option><option value="slash">1 / N</option><option value="dash">– 1 –</option></select></label>
      <div class="pt-two">
        <label class="field"><span class="field-label">Erste Nummer</span><input class="input" type="number" name="start" min="0" max="99999" value="${s.start}"></label>
        <label class="field"><span class="field-label">Schriftgröße</span><input class="input" type="number" name="size" min="6" max="36" value="${s.size}"></label>
      </div>
      <label class="field"><span class="field-label">Abstand zum Rand: <b data-v="margin">${s.margin}</b> pt</span><input type="range" name="margin" min="12" max="72" step="2" value="${s.margin}"></label>
      <div class="pt-row"><span class="field-label">Farbe</span><span data-colors></span></div>
      <label class="check"><input type="checkbox" name="bold" ${s.bold ? 'checked' : ''}><span>Fett</span></label>
      ${rangeField}
      <p class="hint">Tipp: Für ein Deckblatt ohne Nummer „2-${pdf.numPages}“ eintragen.</p>`;
    form.format.value = s.format;
  } else {
    const fld = (n, l) => `<label class="field"><span class="field-label">${l}</span><input class="input" name="${n}" value="${esc(s[n])}" data-slot></label>`;
    form.innerHTML = `
      <div class="pt-chips" aria-label="Platzhalter einfügen"><span class="field-label">Einfügen:</span>
        <button type="button" class="pt-chip" data-ph="{seite}">Seite</button><button type="button" class="pt-chip" data-ph="{seiten}">Seitenzahl gesamt</button>
        <button type="button" class="pt-chip" data-ph="{datum}">Datum</button><button type="button" class="pt-chip" data-ph="{datei}">Dateiname</button></div>
      <fieldset class="pt-fieldset"><legend>Kopfzeile</legend><div class="pt-three">${fld('hl', 'Links')}${fld('hc', 'Mitte')}${fld('hr', 'Rechts')}</div></fieldset>
      <fieldset class="pt-fieldset"><legend>Fußzeile</legend><div class="pt-three">${fld('fl', 'Links')}${fld('fc', 'Mitte')}${fld('fr', 'Rechts')}</div></fieldset>
      <div class="pt-two">
        <label class="field"><span class="field-label">Schriftgröße</span><input class="input" type="number" name="size" min="6" max="30" value="${s.size}"></label>
        <label class="field"><span class="field-label">Erste Seitenzahl</span><input class="input" type="number" name="start" min="0" max="99999" value="${s.start}"></label>
      </div>
      <label class="field"><span class="field-label">Abstand zum Rand: <b data-v="margin">${s.margin}</b> pt</span><input type="range" name="margin" min="10" max="72" step="2" value="${s.margin}"></label>
      <div class="pt-row"><span class="field-label">Farbe</span><span data-colors></span></div>
      <label class="check"><input type="checkbox" name="line" ${s.line ? 'checked' : ''}><span>Trennlinie</span></label>
      ${rangeField}`;
    let lastSlot = form.querySelector('[name=hr]');
    form.querySelectorAll('[data-slot]').forEach(i => i.addEventListener('focus', () => { lastSlot = i; }));
    form.querySelectorAll('[data-ph]').forEach(b => b.addEventListener('click', () => {
      const i = lastSlot;
      const at = i.selectionStart ?? i.value.length;
      i.value = i.value.slice(0, at) + b.dataset.ph + i.value.slice(i.selectionEnd ?? at);
      i.focus();
      i.setSelectionRange(at + b.dataset.ph.length, at + b.dataset.ph.length);
      i.dispatchEvent(new Event('input', { bubbles: true }));
    }));
  }
  const colorsBox = form.querySelector('[data-colors]');
  if (colorsBox) colorsBox.appendChild(swatches(STAMP_COLORS, s.color, c => { s.color = c; changed(); }));

  function readForm() {
    const v = n => form.elements[n];
    for (const n of ['text', 'hl', 'hc', 'hr', 'fl', 'fc', 'fr', 'format', 'range']) if (v(n)) s[n] = v(n).value;
    for (const n of ['size', 'opacity', 'rotation', 'scale', 'margin', 'start']) {
      if (!v(n)) continue;
      let num = parseFloat(v(n).value);
      if (!Number.isFinite(num)) num = defaults(mode)[n];
      if (n === 'size') num = Math.max(4, Math.min(200, num));
      if (n === 'start') num = Math.max(0, Math.round(num));
      s[n] = num;
      const lab = form.querySelector(`[data-v="${n}"]`);
      if (lab) lab.textContent = String(num);
    }
    for (const n of ['bold', 'line']) if (v(n)) s[n] = v(n).checked;
  }
  form.addEventListener('input', () => { readForm(); changed(); });
  form.addEventListener('change', () => { readForm(); changed(); });
  form.querySelectorAll('[data-pos]').forEach(b => b.addEventListener('click', () => {
    s.position = b.dataset.pos;
    form.querySelectorAll('[data-pos]').forEach(x => {
      if (x.getAttribute('role') === 'radio') x.setAttribute('aria-checked', String(x.dataset.pos === s.position));
      else x.setAttribute('aria-pressed', String(x.dataset.pos === s.position));
    });
    changed();
  }));
  if (mode === 'watermark') {
    const setKind = k => {
      s.kind = k;
      form.querySelectorAll('[data-kind]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === k)));
      form.querySelectorAll('[data-k]').forEach(x => { x.hidden = x.dataset.k !== k; });
      changed();
    };
    form.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => {
      setKind(b.dataset.kind);
      if (b.dataset.kind === 'image' && !s.image) form.querySelector('[data-pickimg]').click();
    }));
    form.querySelector('[data-pickimg]').addEventListener('click', async () => {
      const [file] = await pickFiles({ accept: 'image/png,image/jpeg,image/webp', multiple: false });
      if (!file) return;
      try {
        const img = await readImageFile(file, 2000);
        if (s.image && s.image.url) URL.revokeObjectURL(s.image.url);
        img.url = URL.createObjectURL(new Blob([img.bytes], { type: img.type === 'png' ? 'image/png' : 'image/jpeg' }));
        img.el = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = img.url; });
        s.image = img;
        form.querySelector('[data-imgname]').textContent = `${file.name} · ${img.w} × ${img.h} px`;
        changed();
      } catch (e) { errorToast(e, 'Das Bild konnte nicht gelesen werden.'); }
    });
    setKind(s.kind);
  }

  // ---------- preview ----------
  let pageCanvas = null, overlay = null, prevScale = 1, prevVW = 0, prevVH = 0;
  let renderSeq = 0;
  async function showPage(n) {
    previewPage = n;
    wrap.querySelector('[data-pinfo]').textContent = `Seite ${n} von ${pdf.numPages}`;
    wrap.querySelector('[data-prev]').disabled = n <= 1;
    wrap.querySelector('[data-next]').disabled = n >= pdf.numPages;
    const seq = ++renderSeq;
    const page = await pdf.getPage(n);
    const vp = page.getViewport({ scale: 1, rotation: page.rotate });
    const avail = Math.min(prevBox.parentElement.clientWidth || 360, 520);
    const maxH = window.matchMedia('(max-width: 720px)').matches ? 360 : 640;
    const sc = Math.min(avail / vp.width, maxH / vp.height);
    const c = await renderPage(page, { scale: sc, dpr: Math.min(2, window.devicePixelRatio || 1) });
    if (!alive || seq !== renderSeq) { c.width = c.height = 0; return; }
    if (pageCanvas) { pageCanvas.width = pageCanvas.height = 0; }
    prevBox.innerHTML = '';
    pageCanvas = c;
    c.style.width = `${Math.round(vp.width * sc)}px`;
    c.style.height = `${Math.round(vp.height * sc)}px`;
    overlay = document.createElement('canvas');
    overlay.className = 'pt-prev-overlay';
    overlay.width = c.width; overlay.height = c.height;
    overlay.style.width = c.style.width; overlay.style.height = c.style.height;
    prevBox.append(c, overlay);
    prevScale = c.width / vp.width;
    prevVW = vp.width; prevVH = vp.height;
    drawOverlay();
  }

  function selectedPages() { return parseRange(s.range, pdf.numPages); }

  function opsFor(pageNum, VW, VH) {
    const list = selectedPages() || [];
    const idx = list.indexOf(pageNum);
    if (idx < 0) return [];
    const startN = mode === 'watermark' ? 1 : s.start;
    return layout(mode, s, {
      VW, VH, index: idx, count: list.length, fonts, docName: baseName(doc.name),
      pageNum: startN + idx, total: startN - 1 + list.length,
    });
  }

  function drawOverlay() {
    if (!overlay) return;
    const g = overlay.getContext('2d');
    g.clearRect(0, 0, overlay.width, overlay.height);
    const ops = opsFor(previewPage, prevVW, prevVH);
    const k = prevScale;
    for (const op of ops) {
      g.save();
      g.translate(op.x * k, (prevVH - op.y) * k);
      g.rotate((-(op.rot || 0) * Math.PI) / 180);
      g.globalAlpha = op.opacity ?? 1;
      if (op.kind === 'text') {
        g.fillStyle = op.color;
        g.font = `${op.bold ? 'bold ' : ''}${op.size * k}px Helvetica, Arial, sans-serif`;
        g.textBaseline = 'alphabetic';
        g.fillText(op.text, 0, 0);
      } else if (op.kind === 'image' && s.image && s.image.el) {
        g.drawImage(s.image.el, 0, -op.h * k, op.w * k, op.h * k);
      } else if (op.kind === 'line') {
        g.restore(); g.save();
        g.strokeStyle = op.color; g.lineWidth = 0.6 * k;
        g.beginPath(); g.moveTo(op.x0 * k, (prevVH - op.y) * k); g.lineTo(op.x1 * k, (prevVH - op.y) * k); g.stroke();
      }
      g.restore();
    }
  }

  wrap.querySelector('[data-prev]').addEventListener('click', () => showPage(Math.max(1, previewPage - 1)));
  wrap.querySelector('[data-next]').addEventListener('click', () => showPage(Math.min(pdf.numPages, previewPage + 1)));

  function changed() {
    if (!ready) return;
    persist();
    const list = selectedPages();
    const rangeIn = form.elements.range;
    if (rangeIn) rangeIn.classList.toggle('invalid', !list);
    let ok = !!(list && list.length);
    if (mode === 'watermark') ok = ok && (s.kind === 'image' ? !!s.image : !!s.text.trim());
    if (mode === 'header') ok = ok && ['hl', 'hc', 'hr', 'fl', 'fc', 'fr'].some(k => s[k] && s[k].trim());
    btn.disabled = !ok;
    updateFoot(screen, [btn], list ? `${list.length} von ${pdf.numPages} Seite${pdf.numPages === 1 ? '' : 'n'}` : 'Ungültiger Seitenbereich');
    drawOverlay();
  }

  // ---------- apply ----------
  btn.addEventListener('click', async () => {
    readForm();
    const list = selectedPages();
    if (!list || !list.length) { toast('Bitte gib einen gültigen Seitenbereich ein.', 'error'); return; }
    btn.disabled = true;
    const prog = progress('Wird erstellt …');
    try {
      const out = await stampPdf(bytes, mode, s, { name: doc.name, key: docId, onProgress: (k, n) => prog.set(`Seite ${k} von ${n} …`) });
      prog.set('Speichere …');
      const res = await saveResult(out, `${baseName(doc.name)} (${cfg.suffix}).pdf`);
      resultBox.innerHTML = '';
      resultBox.appendChild(resultCard(res, { title: 'Fertig' }));
      resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      toast('Gespeichert.', 'success');
    } catch (e) { errorToast(e, 'Das hat nicht geklappt.'); }
    finally { prog.done(); changed(); }
  });

  let lastW = 0;
  const ro = new ResizeObserver(entries => {
    const w = Math.round(entries[0].contentRect.width);
    if (pageCanvas && Math.abs(w - lastW) > 8) { lastW = w; showPage(previewPage); }
  });
  lastW = Math.round(prevBox.parentElement.clientWidth);
  ready = true;
  await showPage(1);
  ro.observe(prevBox.parentElement);
  changed();

  return () => {
    alive = false;
    ro.disconnect();
    if (s.image && s.image.url) URL.revokeObjectURL(s.image.url);
    if (pageCanvas) pageCanvas.width = pageCanvas.height = 0;
    pdf.destroy();
  };
}
