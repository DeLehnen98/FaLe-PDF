// Tool: copy an ID card – photos of the front and back → both sides at their real size on one A4 page (PDF or JPG).
// Edges are detected and straightened like in the document scanner (scan-to-pdf.js stage, reused); every side is
// then scaled to the exact card format (ID-1 85.6 × 54 mm: ID card, driving licence, bank/health card – or the
// ID-3 passport data page 125 × 88 mm). Privacy extras: black out numbers that are not needed (e.g. the access
// number and the serial number), a "KOPIE" mark burned into the picture with purpose and date, greyscale.
// Nothing leaves the device – an ID card is the last thing anyone should upload.
import { el, clear } from '../lib/dom.js';
import { loadPdfLib, saveDoc } from '../lib/pdf.js';
import { ensureCss, loadCanvas, encode, release, newCanvas, ctx2d, T } from '../lib/img-core.js';
import { scanStage, pageOpts, detect, processPage } from './scan-to-pdf.js';

ensureCss();

const MM = 72 / 25.4;
export const FORMATS = {
  id: { w: 85.6, h: 53.98, label: { de: 'Ausweis / Karte', en: 'ID card / card' } },
  passport: { w: 125, h: 88, label: { de: 'Reisepass (Datenseite)', en: 'Passport (data page)' } },
};
const DPI = 300;
let stageCtl = null, redactCtl = null;

/** Card picture in its exact format: warped side scaled to w × h mm (portrait if the photo is portrait). */
export async function cardCanvas(input, fmt, { maxSide = 1600, tick = async () => {} } = {}) {
  const { canvas: src } = await loadCanvas(input, { maxSide: Math.round(maxSide * 1.6) });
  const p = pageOpts(input);
  if (p.auto === null) await detect(input, src);
  let c;
  try { c = await processPage(src, p, maxSide, tick); } finally { release(src); }
  const F = FORMATS[fmt] || FORMATS.id;
  const portrait = c.height > c.width;
  const [wmm, hmm] = portrait ? [F.h, F.w] : [F.w, F.h];
  const W = Math.round(wmm / 25.4 * DPI), H = Math.round(hmm / 25.4 * DPI);
  const out = newCanvas(W, H);
  const g = ctx2d(out);
  g.imageSmoothingQuality = 'high';
  g.drawImage(c, 0, 0, W, H);
  release(c);
  return { canvas: out, wmm, hmm };
}

/** Black boxes (normalised to the card) and the "KOPIE" mark, burned into the picture. */
export function finishCard(canvas, { redact = [], mark = true, text = '', gray = false, lang = 'de' }) {
  const g = ctx2d(canvas);
  const W = canvas.width, H = canvas.height;
  g.fillStyle = '#000';
  for (const [x, y, w, h] of redact) g.fillRect(Math.round(x * W), Math.round(y * H), Math.ceil(w * W), Math.ceil(h * H));
  if (gray) {
    const d = g.getImageData(0, 0, W, H), a = d.data;
    for (let i = 0; i < a.length; i += 4) { const v = Math.round(a[i] * 0.299 + a[i + 1] * 0.587 + a[i + 2] * 0.114); a[i] = a[i + 1] = a[i + 2] = v; }
    g.putImageData(d, 0, 0);
  }
  if (mark) {
    g.save();
    g.translate(W / 2, H / 2);
    g.rotate(-Math.atan2(H, W));
    const word = lang === 'en' ? 'COPY' : 'KOPIE';
    const size = Math.round(Math.min(W, H) * 0.34);
    g.font = `800 ${size}px Arial, Helvetica, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.globalAlpha = 0.28;
    g.fillStyle = '#c8102e';
    g.fillText(word, 0, text ? -size * 0.25 : 0);
    if (text) {
      const line = text.slice(0, 90);
      let fs = Math.round(size * 0.24);
      g.font = `700 ${fs}px Arial, Helvetica, sans-serif`;
      const max = Math.hypot(W, H) * 0.8;   // along the diagonal
      while (fs > 10 && g.measureText(line).width > max) { fs -= 2; g.font = `700 ${fs}px Arial, Helvetica, sans-serif`; }
      g.fillText(line, 0, size * 0.45);
    }
    g.restore();
  }
  return canvas;
}

const today = lang => new Date().toLocaleDateString(lang === 'en' ? 'en-GB' : 'de-DE');
const RECIPIENTS = [
  { id: 'bank', label: { de: 'Bank / Sparkasse', en: 'Bank' } },
  { id: 'landlord', label: { de: 'Vermieter', en: 'Landlord' } },
  { id: 'employer', label: { de: 'Arbeitgeber', en: 'Employer' } },
  { id: 'hotel', label: { de: 'Hotel / Unterkunft', en: 'Hotel / accommodation' } },
  { id: 'office', label: { de: 'Behörde', en: 'Authority' } },
  { id: 'contract', label: { de: 'Vertrag / Anbieter', en: 'Contract / provider' } },
];
/** Mark text under "KOPIE": "Nur für Vermieter · eigener Text · Datum". */
export function markText(opts, lang) {
  const r = RECIPIENTS.find(x => x.id === opts.for);
  const who = r ? (lang === 'en' ? `Only for: ${r.label.en}` : `Nur für: ${r.label.de}`) : '';
  return [who, String(opts.purpose || '').trim(), opts.date ? today(lang) : ''].filter(Boolean).join(' · ');
}

export default {
  shareFirst: true,
  labels: { back_to_files: { de: 'Zurück zu den Seiten', en: 'Back to the sides' } },
  options: [
    { id: 'format', type: 'radio', default: 'id', label: { de: 'Was kopierst du?', en: 'What are you copying?' },
      choices: [
        { value: 'id', label: FORMATS.id.label, hint: { de: 'Personalausweis, Führerschein, Aufenthaltstitel, Bank- und Gesundheitskarte (85,6 × 54 mm)', en: 'ID card, driving licence, residence permit, bank and health card (85.6 × 54 mm)' } },
        { value: 'passport', label: FORMATS.passport.label, hint: { de: 'Die Seite mit Foto (125 × 88 mm)', en: 'The page with the photo (125 × 88 mm)' } },
      ] },
    { id: 'mark', type: 'toggle', default: true, label: { de: '„KOPIE“ ins Bild schreiben', en: 'Write “COPY” across the picture' },
      hint: { de: 'Macht klar, dass es eine Kopie ist – und erschwert Missbrauch.', en: 'Makes clear it is a copy – and makes misuse harder.' } },
    { id: 'for', type: 'select', default: '', when: v => v.mark, label: { de: 'Für wen ist die Kopie?', en: 'Who is the copy for?' },
      choices: [{ value: '', label: { de: '– nicht angeben –', en: '– don’t say –' } }, ...RECIPIENTS.map(r => ({ value: r.id, label: r.label }))] },
    { id: 'purpose', type: 'text', default: '', maxLength: 60, when: v => v.mark, label: { de: 'Eigener Text (optional)', en: 'Own text (optional)' },
      placeholder: { de: 'z. B. Nur für Mietvertrag Müller', en: 'e.g. Only for the Miller lease' } },
    { id: 'date', type: 'toggle', default: true, when: v => v.mark, label: { de: 'Heutiges Datum dazuschreiben', en: 'Add today’s date' } },
    { id: 'color', type: 'radio', default: 'color', label: { de: 'Farbe', en: 'Colour' },
      choices: [{ value: 'color', label: { de: 'Farbig', en: 'Colour' } }, { value: 'gray', label: { de: 'Graustufen', en: 'Greyscale' }, hint: { de: 'Oft verlangt – und weniger missbrauchbar', en: 'Often requested – and harder to misuse' } }] },
    { id: 'output', type: 'radio', default: 'pdf', label: { de: 'Speichern als', en: 'Save as' },
      choices: [{ value: 'pdf', label: { de: 'PDF (A4, Originalgröße)', en: 'PDF (A4, real size)' } }, { value: 'jpg', label: { de: 'JPG (ein Bild pro Seite)', en: 'JPG (one picture per side)' } }] },
  ],

  mountStage(stage, state, ctx) {
    stageCtl = scanStage(stage, state, ctx, {
      pageName: (i, n) => (n <= 2 ? (i === 0 ? { de: 'Vorderseite', en: 'Front' } : { de: 'Rückseite', en: 'Back' }) : { de: `Seite ${i + 1} von ${n}`, en: `Side ${i + 1} of ${n}` }),
    });
    redactCtl = redactBox(stage, state, ctx);
    stageCtl.refresh();
  },
  onInputs() { stageCtl?.refresh(); redactCtl?.reset(); },
  onOptionsChange() { redactCtl?.reset(); },

  status(v, inputs, lang) {
    const n = inputs.length;
    return {
      summary: n === 1 ? { de: 'Nur Vorderseite', en: 'Front only' } : n === 2 ? { de: 'Vorder- und Rückseite', en: 'Front and back' } : { de: `${n} Seiten`, en: `${n} sides` },
      hint: n === 1 && v.format === 'id' ? { de: 'Tipp: Füge auch ein Foto der Rückseite hinzu – beide kommen auf ein Blatt.', en: 'Tip: add a photo of the back too – both go on one sheet.' } : null,
    };
  },

  async run(inputs, opts, ctx) {
    const lang = ctx.lang;
    const cards = [];
    for (let i = 0; i < inputs.length; i++) {
      ctx.progress(i / (inputs.length + 1), { de: `Seite ${i + 1} von ${inputs.length} wird begradigt …`, en: `Straightening side ${i + 1} of ${inputs.length} …` });
      await ctx.tick();
      const c = await cardCanvas(inputs[i], opts.format, { tick: ctx.tick });
      finishCard(c.canvas, { redact: pageOpts(inputs[i]).redact || [], mark: opts.mark, text: markText(opts, lang), gray: opts.color === 'gray', lang });
      cards.push(c);
    }
    const name = ctx.t({ de: opts.format === 'passport' ? 'Reisepass Kopie' : 'Ausweis Kopie', en: opts.format === 'passport' ? 'Passport copy' : 'ID card copy' });
    const outputs = [];
    try {
      if (opts.output === 'jpg') {
        for (let i = 0; i < cards.length; i++) {
          const blob = await encode(cards[i].canvas, { format: 'jpg', quality: 0.9 });
          const side = cards.length === 2 ? ctx.t(i === 0 ? { de: 'Vorderseite', en: 'front' } : { de: 'Rückseite', en: 'back' }) : String(i + 1);
          outputs.push({ name: `${name} – ${side}.jpg`, blob });
        }
        return { outputs };
      }
      ctx.progress(inputs.length / (inputs.length + 1), { de: 'PDF wird erstellt …', en: 'Creating the PDF …' });
      const PDFLib = await loadPdfLib();
      const doc = await PDFLib.PDFDocument.create();
      const [PW, PH] = [595.28, 841.89];
      // two sides per A4 page, stacked with room to cut them out; real size (do not "fit to page" when printing)
      for (let i = 0; i < cards.length; i += 2) {
        const page = doc.addPage([PW, PH]);
        const pair = cards.slice(i, i + 2);
        const gap = 18 * MM;
        const total = pair.reduce((s, c) => s + c.hmm * MM, 0) + gap * (pair.length - 1);
        let y = PH - (PH - total) / 2.6;   // a little above the middle
        for (const c of pair) {
          const blob = await encode(c.canvas, { format: 'jpg', quality: 0.9 });
          const img = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
          const w = c.wmm * MM, h = c.hmm * MM;
          y -= h;
          page.drawImage(img, { x: (PW - w) / 2, y, width: w, height: h });
          page.drawRectangle({ x: (PW - w) / 2, y, width: w, height: h, borderColor: PDFLib.rgb(0.75, 0.75, 0.78), borderWidth: 0.4 });
          y -= gap;
          await ctx.tick();
        }
        const hint = ctx.t({ de: 'Beim Drucken „Tatsächliche Größe“ (100 %) wählen.', en: 'When printing, choose “Actual size” (100 %).' });
        const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
        page.drawText(hint, { x: 36, y: 30, size: 8, font, color: PDFLib.rgb(0.45, 0.45, 0.5) });
      }
      const bytes = await saveDoc(doc, { title: name });
      outputs.push({ name: `${name}.pdf`, blob: new Blob([bytes], { type: 'application/pdf' }), pages: Math.ceil(cards.length / 2) });
      ctx.note({ de: 'Drucke mit „Tatsächliche Größe“ / 100 % – dann ist die Kopie so groß wie das Original.', en: 'Print at “Actual size” / 100 % – then the copy is as big as the original.' });
      return { outputs };
    } finally { for (const c of cards) release(c.canvas); }
  },
};

// ---------------------------------------------------------------- black out numbers on the straightened sides
function redactBox(stage, state, ctx) {
  const lang = ctx.lang;
  const list = el('div', { class: 'id-redact-list' });
  const status = el('p', { class: 'img-muted', role: 'status' });
  const details = el('details', { class: 'img-box id-redact' },
    el('summary', {}, T(lang, { de: 'Nummern schwärzen (empfohlen)', en: 'Black out numbers (recommended)' })),
    el('p', { class: 'img-muted' }, T(lang, {
      de: 'Zieh mit dem Finger oder der Maus Kästen über alles, was der Empfänger nicht braucht – etwa die Zugangsnummer (CAN, 6 Ziffern) und die Seriennummer des Ausweises. Die Stellen werden fest schwarz eingebrannt.',
      en: 'Drag boxes with your finger or mouse over anything the recipient doesn’t need – such as the card access number (CAN, 6 digits) and the serial number. The areas are burned in solid black.',
    })),
    list, status);
  stage.append(details);
  const inputs = () => state.inputs.filter(i => !i.error);
  let busy = false;

  async function build() {
    if (busy) return;
    busy = true;
    clear(list);
    status.textContent = T(lang, { de: 'Vorschau wird erstellt …', en: 'Creating the preview …' });
    const fmt = state.values.format;
    const items = inputs();
    for (let i = 0; i < items.length; i++) {
      const inp = items[i];
      let card;
      try { card = await cardCanvas(inp, fmt, { maxSide: 900 }); } catch (err) { console.warn(err); continue; }
      list.append(editor(inp, card.canvas, items.length <= 2 ? (i === 0 ? { de: 'Vorderseite', en: 'Front' } : { de: 'Rückseite', en: 'Back' }) : { de: `Seite ${i + 1}`, en: `Side ${i + 1}` }));
    }
    status.textContent = items.length ? '' : T(lang, { de: 'Füge zuerst Fotos hinzu.', en: 'Add photos first.' });
    busy = false;
  }

  function editor(inp, canvas, label) {
    const p = pageOpts(inp);
    p.redact ||= [];
    const wrap = el('div', { class: 'id-redact-card' });
    const boxes = el('div', { class: 'id-redact-boxes' });
    const surface = el('div', { class: 'id-redact-surface', aria: { label: T(lang, { de: `${label.de}: Bereich zum Schwärzen ziehen`, en: `${label.en}: drag an area to black out` }) } }, canvas, boxes);
    const undo = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm', onclick: () => { p.redact.pop(); draw(); changed(); } }, T(lang, { de: 'Letzten Kasten entfernen', en: 'Remove last box' }));
    const count = el('span', { class: 'img-muted' });
    wrap.append(el('h3', { class: 'img-h' }, T(lang, label)), surface, el('div', { class: 'img-row' }, undo, count));
    canvas.classList.add('id-redact-canvas');
    function draw() {
      clear(boxes);
      for (const [x, y, w, h] of p.redact) {
        const b = el('span', { class: 'id-redact-rect' });
        b.style.left = x * 100 + '%'; b.style.top = y * 100 + '%'; b.style.width = w * 100 + '%'; b.style.height = h * 100 + '%';
        boxes.append(b);
      }
      undo.disabled = !p.redact.length;
      count.textContent = p.redact.length ? T(lang, { de: `${p.redact.length} geschwärzt`, en: `${p.redact.length} blacked out` }) : '';
    }
    surface.addEventListener('pointerdown', ev => {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      ev.preventDefault();
      const r = surface.getBoundingClientRect();
      const x0 = (ev.clientX - r.left) / r.width, y0 = (ev.clientY - r.top) / r.height;
      const live = el('span', { class: 'id-redact-rect is-live' });
      boxes.append(live);
      let rect = null;
      const move = e => {
        const x1 = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y1 = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
        rect = [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)];
        live.style.left = rect[0] * 100 + '%'; live.style.top = rect[1] * 100 + '%'; live.style.width = rect[2] * 100 + '%'; live.style.height = rect[3] * 100 + '%';
      };
      const up = () => {
        surface.removeEventListener('pointermove', move);
        surface.removeEventListener('pointerup', up);
        surface.removeEventListener('pointercancel', up);
        if (rect && rect[2] > 0.01 && rect[3] > 0.01) { p.redact.push(rect); changed(); }
        draw();
      };
      try { surface.setPointerCapture(ev.pointerId); } catch { /* optional */ }
      surface.addEventListener('pointermove', move);
      surface.addEventListener('pointerup', up);
      surface.addEventListener('pointercancel', up);
    });
    draw();
    return wrap;
  }
  function changed() { state.results.clear(); ctx.refresh(); }

  details.addEventListener('toggle', () => { if (details.open) build(); });
  return {
    reset() {
      // the straightened picture changed (new photo, format): rebuild when shown (opening it also rebuilds)
      if (details.open) build();
    },
  };
}
