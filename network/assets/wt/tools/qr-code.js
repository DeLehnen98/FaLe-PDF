// Tool: QR code generator (no file intake) – URL, text, Wi-Fi, contact (vCard), e-mail, phone, SMS,
// location; colours, quiet zone, error correction, size; PNG / SVG / PDF (vector); live preview with a
// contrast warning and a self-test that reads the rendered image back (lib/img-qrdecode.js), plus the
// device's own barcode reader where the browser has one.
import { el, icon, clear } from '../lib/dom.js';
import { loadPdfLib, saveDoc } from '../lib/pdf.js';
import { ensureCss, newCanvas, ctx2d, release, T, segmented, field, check, userError } from '../lib/img-core.js';
import { encodeQR, drawQR, qrToSvg, wifiPayload, vcardPayload, mailPayload, QRTooLongError } from '../lib/shared/qr.js';
import { decodeRaster } from '../lib/img-qrdecode.js';

ensureCss();

const TYPES = [
  { value: 'url', label: { de: 'Link', en: 'Link' } }, { value: 'text', label: { de: 'Text', en: 'Text' } },
  { value: 'wifi', label: { de: 'WLAN', en: 'Wi-Fi' } }, { value: 'vcard', label: { de: 'Kontakt', en: 'Contact' } },
  { value: 'mail', label: { de: 'E-Mail', en: 'E-mail' } }, { value: 'tel', label: { de: 'Telefon', en: 'Phone' } },
  { value: 'sms', label: 'SMS' }, { value: 'geo', label: { de: 'Ort', en: 'Location' } },
];
const num = s => parseFloat(String(s ?? '').trim().replace(',', '.'));

/** Payload text for the current content, or { error }. */
export function payload(q) {
  const v = q || {};
  switch (v.type || 'url') {
    case 'url': {
      let u = String(v.url || '').trim();
      if (!u) return { empty: true };
      if (!/^[a-z][a-z0-9+.-]*:/i.test(u) && /^[^\s]+\.[^\s]{2,}/.test(u)) u = 'https://' + u;
      return { text: u };
    }
    case 'text': return String(v.text || '') ? { text: String(v.text) } : { empty: true };
    case 'wifi': return v.ssid ? { text: wifiPayload({ ssid: v.ssid, password: v.password || '', security: v.security || 'WPA', hidden: !!v.hidden }) } : { empty: true };
    case 'vcard': {
      const c = { vorname: v.first, nachname: v.last, firma: v.org, titel: v.title, telefon: v.phone, email: v.email, web: v.web, strasse: v.street, plz: v.zip, ort: v.city, land: v.country };
      return Object.values(c).some(x => x && String(x).trim()) ? { text: vcardPayload(c) } : { empty: true };
    }
    case 'mail': return v.to ? { text: mailPayload({ to: String(v.to).trim(), subject: v.subject || '', body: v.body || '' }) } : { empty: true };
    case 'tel': return v.number ? { text: 'tel:' + String(v.number).replace(/[^\d+*#]/g, '') } : { empty: true };
    case 'sms': return v.number ? { text: `SMSTO:${String(v.number).replace(/[^\d+]/g, '')}:${v.message || ''}` } : { empty: true };
    case 'geo': {
      if (!String(v.lat ?? '').trim() && !String(v.lon ?? '').trim()) return { empty: true };
      const la = num(v.lat), lo = num(v.lon);
      if (!(la >= -90 && la <= 90) || !(lo >= -180 && lo <= 180)) return { error: { de: 'Breite −90 bis 90 und Länge −180 bis 180 eingeben (z. B. 52.5200 und 13.4050).', en: 'Enter latitude −90 to 90 and longitude −180 to 180 (e.g. 51.5072 and −0.1276).' } };
      return { text: `geo:${+la.toFixed(6)},${+lo.toFixed(6)}` };
    }
    default: return { empty: true };
  }
}

function label(q, lang) {
  const v = q || {};
  const s = { url: () => String(v.url || '').replace(/^https?:\/\//, '').split('/')[0], wifi: () => `${T(lang, { de: 'WLAN', en: 'Wi-Fi' })} ${v.ssid || ''}`,
    vcard: () => [v.first, v.last].filter(Boolean).join(' ') || v.org || 'vCard', mail: () => v.to, tel: () => v.number, sms: () => `SMS ${v.number || ''}`, geo: () => T(lang, { de: 'Ort', en: 'Location' }), text: () => 'Text' }[v.type || 'url'];
  return String((s && s()) || '').trim().slice(0, 40);
}

// relative luminance (WCAG)
function lumOf(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(n >> 16) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}
export function designWarnings(v) {
  const out = [];
  const a = lumOf(v.dark), b = lumOf(v.light);
  if (a > b) out.push({ de: 'Heller Code auf dunklem Grund: Viele Scanner lesen nur dunkle Punkte auf hellem Grund. Tausch die Farben.', en: 'Light code on a dark background: many scanners only read dark modules on a light background. Swap the colours.' });
  else if ((b + 0.05) / (a + 0.05) < 4) out.push({ de: 'Wenig Kontrast zwischen Code und Hintergrund – das kann beim Scannen Probleme machen.', en: 'Low contrast between code and background – this can cause scanning problems.' });
  if (+v.margin < 2) out.push({ de: 'Der Rand ist sehr schmal. Ohne hellen Rand finden manche Scanner den Code nicht – lass beim Drucken Platz drumherum.', en: 'The margin is very narrow. Without a light border some scanners can’t find the code – leave space around it when printing.' });
  return out;
}

function build(values) {
  const p = payload(values.qr);
  if (p.empty || p.error) return p;
  try { return { ...p, qr: encodeQR(p.text, { ecc: values.ecc || 'M' }) }; } catch (err) {
    if (err instanceof QRTooLongError) return { error: { de: 'Der Inhalt ist zu lang für einen QR-Code. Kürze ihn oder wähle eine niedrigere Fehlerkorrektur.', en: 'The content is too long for a QR code. Shorten it or choose a lower error correction.' } };
    throw err;
  }
}

/** Render to a canvas of exactly targetPx (module edges snapped to whole pixels by drawQR → crisp). */
function renderCanvas(qr, v, targetPx) {
  const border = +v.margin;
  const px = Math.max(qr.size + border * 2, Math.round(targetPx));
  const c = newCanvas(px, px);
  drawQR(ctx2d(c), qr, 0, 0, px, { border, dark: v.dark, light: v.light });
  return c;
}

/** Self-test: read the rendered pixels back. */
function selfTest(canvas, qr, v, text) {
  const g = ctx2d(canvas, true);
  const got = decodeRaster(g.getImageData(0, 0, canvas.width, canvas.height), qr.size, +v.margin);
  return got === text;
}
async function deviceTest(canvas, text) {
  if (!('BarcodeDetector' in window)) return null;
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats?.();
    if (formats && !formats.includes('qr_code')) return null;
    const res = await new window.BarcodeDetector({ formats: ['qr_code'] }).detect(canvas);
    return res.some(r => r.rawValue === text);
  } catch { return null; }
}

let stageCtl = null;

export default {
  shareFirst: true,
  labels: { back_to_files: { de: 'Zurück zum Bearbeiten', en: 'Back to editing' } },
  options: [
    { id: 'format', type: 'radio', default: 'png', label: { de: 'Speichern als', en: 'Save as' },
      choices: [
        { value: 'png', label: 'PNG', hint: { de: 'Bild für Handy, Web, Office', en: 'Image for phone, web, office' } },
        { value: 'svg', label: 'SVG', hint: { de: 'Vektor, beliebig skalierbar', en: 'Vector, scales to any size' } },
        { value: 'pdf', label: 'PDF', hint: { de: 'Vektor zum Drucken', en: 'Vector for printing' } },
      ] },
    { id: 'size', type: 'select', default: 1024, label: { de: 'Bildgröße', en: 'Image size' }, when: v => v.format === 'png',
      choices: [{ value: 512, label: '512 px' }, { value: 1024, label: '1024 px' }, { value: 2048, label: '2048 px' }, { value: 4096, label: { de: '4096 px (Plakat)', en: '4096 px (poster)' } }] },
    { id: 'pdfSize', type: 'select', default: 50, label: { de: 'Druckgröße', en: 'Print size' }, when: v => v.format === 'pdf',
      choices: [{ value: 25, label: '25 × 25 mm' }, { value: 40, label: '40 × 40 mm' }, { value: 50, label: '50 × 50 mm' }, { value: 80, label: '80 × 80 mm' }, { value: 120, label: '120 × 120 mm' }] },
    { id: 'dark', type: 'color', default: '#000000', label: { de: 'Farbe des Codes', en: 'Code colour' } },
    { id: 'light', type: 'color', default: '#ffffff', label: { de: 'Hintergrund', en: 'Background' } },
    { id: 'margin', type: 'range', default: 4, min: 0, max: 8, step: 1, label: { de: 'Rand (Ruhezone)', en: 'Margin (quiet zone)' },
      format: (v, lang) => `${v} ${lang === 'de' ? (v === 1 ? 'Modul' : 'Module') : (v === 1 ? 'module' : 'modules')}`,
      hint: { de: 'Empfohlen sind 4 Module.', en: '4 modules are recommended.' } },
    { id: 'ecc', type: 'select', default: 'M', label: { de: 'Fehlerkorrektur', en: 'Error correction' },
      hint: { de: 'Höher = robuster gegen Schmutz und Knicke, aber dichter.', en: 'Higher = more robust against dirt and creases, but denser.' },
      choices: [{ value: 'L', label: { de: 'L – niedrig (7 %)', en: 'L – low (7 %)' } }, { value: 'M', label: { de: 'M – mittel (15 %)', en: 'M – medium (15 %)' } },
        { value: 'Q', label: { de: 'Q – hoch (25 %)', en: 'Q – high (25 %)' } }, { value: 'H', label: { de: 'H – sehr hoch (30 %)', en: 'H – very high (30 %)' } }] },
  ],

  mountStage(stage, state, ctx) { stageCtl = qrStage(stage, state, ctx); },
  onOptionsChange() { stageCtl?.render(); },

  status(v) {
    const b = build(v);
    if (b.empty) return { ok: false, hint: { de: 'Gib oben ein, was im Code stehen soll.', en: 'Enter above what the code should contain.' } };
    if (b.error) return { ok: false, hint: b.error };
    return { summary: { de: `QR-Code · ${b.qr.size} × ${b.qr.size} Module`, en: `QR code · ${b.qr.size} × ${b.qr.size} modules` } };
  },

  async run(inputs, opts, ctx) {
    const b = build(opts);
    if (b.empty || b.error) throw userError(T('de', b.error || { de: 'Kein Inhalt.' }), T('en', b.error || { en: 'No content.' }));
    const { qr, text } = b;
    const base = ctx.safeFileName(`QR-Code ${label(opts.qr, ctx.lang)}`.trim());
    const border = +opts.margin;
    // self-test on a raster of the exact matrix and colours (PNG: the file itself)
    const test = renderCanvas(qr, opts, Math.max(256, (qr.size + border * 2) * 4));
    let ok = selfTest(test, qr, opts, text);
    const dev = await deviceTest(test, text);
    release(test);
    let blob, name, note;
    if (opts.format === 'svg') {
      blob = new Blob([qrToSvg(qr, { border, dark: opts.dark, light: opts.light })], { type: 'image/svg+xml' });
      name = `${base}.svg`;
      ok = ok && await svgSelfTest(blob, qr, opts, text);
    } else if (opts.format === 'pdf') {
      const PDFLib = await loadPdfLib();
      const doc = await PDFLib.PDFDocument.create();
      const sizePt = (+opts.pdfSize || 50) * 72 / 25.4;
      const page = doc.addPage([sizePt, sizePt]);
      const hex = h => { const n = parseInt(String(h).slice(1), 16); return PDFLib.rgb((n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
      page.drawRectangle({ x: 0, y: 0, width: sizePt, height: sizePt, color: hex(opts.light) });
      const n = qr.size + border * 2;
      const svg = qrToSvg(qr, { border, dark: opts.dark, light: null });
      const d = /<path d="([^"]*)"/.exec(svg)[1];
      page.drawSvgPath(d, { x: 0, y: sizePt, scale: sizePt / n, color: hex(opts.dark), borderWidth: 0 });
      blob = new Blob([await saveDoc(doc, { title: base })], { type: 'application/pdf' });
      name = `${base}.pdf`;
    } else {
      const c = renderCanvas(qr, opts, +opts.size || 1024);
      ok = ok && selfTest(c, qr, opts, text);
      blob = await new Promise(r => c.toBlob(r, 'image/png'));
      release(c);
      name = `${base}.png`;
    }
    note = ok ? ctx.t({ de: 'Selbsttest bestanden: Der Code liest sich wieder genau als dein Inhalt.', en: 'Self-test passed: the code reads back exactly as your content.' })
      : ctx.t({ de: 'Achtung: Der Selbsttest konnte den Code nicht lesen. Prüf Farben und Rand.', en: 'Warning: the self-test could not read the code. Check the colours and margin.' });
    if (dev === true) note += ' ' + ctx.t({ de: 'Auch der Barcode-Leser deines Geräts erkennt ihn.', en: 'Your device’s barcode reader recognises it, too.' });
    for (const w of designWarnings(opts)) ctx.note(w);
    return { outputs: [{ name, blob, note }] };
  },
};

async function svgSelfTest(blob, qr, v, text) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const n = qr.size + (+v.margin) * 2;
    const c = newCanvas(n * 6, n * 6);
    ctx2d(c).drawImage(img, 0, 0, c.width, c.height);
    const ok = selfTest(c, qr, v, text);
    release(c);
    return ok;
  } catch { return false; } finally { URL.revokeObjectURL(url); }
}

// ---------------------------------------------------------------- stage: content + live preview
function qrStage(stage, state, ctx) {
  const lang = ctx.lang;
  const q = (state.values.qr ||= { type: 'url', security: 'WPA' });
  const fieldsBox = el('div', { class: 'img-fields' });
  const typeSeg = segmented({ name: 'img-qr-type', label: { de: 'Was soll in den Code?', en: 'What goes into the code?' }, lang, value: q.type, choices: TYPES,
    onChange: v => { q.type = v; renderFields(); changed(); } });
  const canvas = el('canvas', { class: 'img-qr-canvas', width: 10, height: 10, role: 'img', aria: { label: T(lang, { de: 'Vorschau des QR-Codes', en: 'QR code preview' }) } });
  const empty = el('p', { class: 'img-qr-empty' }, T(lang, { de: 'Hier erscheint dein QR-Code.', en: 'Your QR code appears here.' }));
  const info = el('p', { class: 'img-muted img-qr-info' });
  const test = el('p', { class: 'img-qr-test', role: 'status' });
  const warns = el('div', {});
  const preview = el('div', { class: 'img-qr-preview' }, el('div', { class: 'img-qr-frame' }, canvas, empty), info, test, warns);
  const box = el('section', { class: 'img-box img-qr', aria: { labelledby: 'img-qr-h' } },
    el('h2', { class: 'img-h', id: 'img-qr-h' }, T(lang, { de: 'Inhalt', en: 'Content' })),
    typeSeg.root, fieldsBox, preview);
  stage.append(box);

  let timer = 0;
  function changed() { state.results.clear(); ctx.refresh(); clearTimeout(timer); timer = setTimeout(render, 90); }

  const f = (key, label, opts = {}) => field({ id: `img-qr-${key}`, label, value: q[key] ?? '', lang, onInput: v => { q[key] = v; changed(); }, ...opts });
  function renderFields() {
    clear(fieldsBox);
    switch (q.type) {
      case 'url': fieldsBox.append(f('url', { de: 'Adresse (Link)', en: 'Address (link)' }, { type: 'url', placeholder: 'https://', inputmode: 'url', maxLength: 2000 })); break;
      case 'text': {
        const ta = el('textarea', { id: 'img-qr-text', class: 'wt-input img-qr-ta', rows: '4', maxlength: '2500', oninput: e => { q.text = e.target.value; changed(); } });
        ta.value = q.text || '';
        fieldsBox.append(el('div', { class: 'img-field' }, el('label', { for: 'img-qr-text' }, T(lang, { de: 'Text', en: 'Text' })), ta));
        break;
      }
      case 'wifi': {
        fieldsBox.append(f('ssid', { de: 'Netzwerkname (SSID)', en: 'Network name (SSID)' }, { autocomplete: 'off' }));
        const sec = segmented({ name: 'img-qr-sec', label: { de: 'Verschlüsselung', en: 'Security' }, lang, value: q.security || 'WPA',
          choices: [{ value: 'WPA', label: 'WPA/WPA2/WPA3' }, { value: 'WEP', label: 'WEP' }, { value: 'nopass', label: { de: 'Offen', en: 'Open' } }],
          onChange: v => { q.security = v; renderFields(); changed(); } });
        fieldsBox.append(sec.root);
        if (q.security !== 'nopass') fieldsBox.append(f('password', { de: 'Passwort', en: 'Password' }, { autocomplete: 'off', hint: { de: 'Das Passwort steht lesbar im Code – teile ihn nur mit Gästen, denen du es auch sagen würdest.', en: 'The password is readable in the code – only share it with guests you’d tell it to anyway.' } }));
        fieldsBox.append(check({ id: 'img-qr-hidden', label: { de: 'Verstecktes Netzwerk', en: 'Hidden network' }, checked: q.hidden, lang, onChange: v => { q.hidden = v; changed(); } }));
        break;
      }
      case 'vcard':
        fieldsBox.append(f('first', { de: 'Vorname', en: 'First name' }, { wide: false, autocomplete: 'given-name' }), f('last', { de: 'Nachname', en: 'Last name' }, { wide: false, autocomplete: 'family-name' }),
          f('org', { de: 'Firma', en: 'Company' }, { wide: false, autocomplete: 'organization' }), f('title', { de: 'Position', en: 'Job title' }, { wide: false }),
          f('phone', { de: 'Telefon', en: 'Phone' }, { type: 'tel', wide: false, autocomplete: 'tel' }), f('email', { de: 'E-Mail', en: 'E-mail' }, { type: 'email', wide: false, autocomplete: 'email' }),
          f('web', { de: 'Webseite', en: 'Website' }, { type: 'url', autocomplete: 'url' }), f('street', { de: 'Straße und Hausnummer', en: 'Street' }, { autocomplete: 'street-address' }),
          f('zip', { de: 'PLZ', en: 'Postcode' }, { wide: false, autocomplete: 'postal-code' }), f('city', { de: 'Ort', en: 'City' }, { wide: false, autocomplete: 'address-level2' }),
          f('country', { de: 'Land', en: 'Country' }, { autocomplete: 'country-name' }));
        break;
      case 'mail':
        fieldsBox.append(f('to', { de: 'E-Mail-Adresse', en: 'E-mail address' }, { type: 'email', autocomplete: 'email' }), f('subject', { de: 'Betreff (optional)', en: 'Subject (optional)' }),
          f('body', { de: 'Text (optional)', en: 'Message (optional)' }, { maxLength: 1000 }));
        break;
      case 'tel': fieldsBox.append(f('number', { de: 'Telefonnummer', en: 'Phone number' }, { type: 'tel', placeholder: '+49 …', inputmode: 'tel' })); break;
      case 'sms': fieldsBox.append(f('number', { de: 'Telefonnummer', en: 'Phone number' }, { type: 'tel', inputmode: 'tel' }), f('message', { de: 'Nachricht (optional)', en: 'Message (optional)' }, { maxLength: 500 })); break;
      case 'geo':
        fieldsBox.append(f('lat', { de: 'Breitengrad', en: 'Latitude' }, { wide: false, inputmode: 'decimal', placeholder: '52.5200' }), f('lon', { de: 'Längengrad', en: 'Longitude' }, { wide: false, inputmode: 'decimal', placeholder: '13.4050' }),
          el('p', { class: 'img-muted' }, T(lang, { de: 'Koordinaten in Dezimalgrad, z. B. aus deiner Karten-App kopiert. Es wird keine Karte geladen.', en: 'Coordinates in decimal degrees, e.g. copied from your maps app. No map is loaded.' })));
        break;
    }
  }

  async function render() {
    const v = state.values;
    const b = build(v);
    clear(warns);
    if (b.empty || b.error) {
      canvas.hidden = true; empty.hidden = false;
      empty.textContent = b.error ? T(lang, b.error) : T(lang, { de: 'Hier erscheint dein QR-Code.', en: 'Your QR code appears here.' });
      info.textContent = ''; test.textContent = ''; test.className = 'img-qr-test';
      return;
    }
    const css = Math.min(260, (box.clientWidth || 300) - 40);
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const c = renderCanvas(b.qr, v, css * dpr);
    canvas.width = c.width; canvas.height = c.height;
    ctx2d(canvas).drawImage(c, 0, 0);
    release(c);
    canvas.style.width = css + 'px';
    canvas.hidden = false; empty.hidden = true;
    info.textContent = T(lang, { de: `Version ${b.qr.version} · ${b.qr.size} × ${b.qr.size} Module · Fehlerkorrektur ${b.qr.ecc}`, en: `Version ${b.qr.version} · ${b.qr.size} × ${b.qr.size} modules · error correction ${b.qr.ecc}` });
    const ok = selfTest(canvas, b.qr, v, b.text);
    test.className = 'img-qr-test ' + (ok ? 'is-ok' : 'is-bad');
    clear(test).append(icon(ok ? 'check' : 'alert'), el('span', {}, T(lang, ok ? { de: 'Selbsttest: lesbar', en: 'Self-test: readable' } : { de: 'Selbsttest: nicht lesbar – prüf Farben und Rand', en: 'Self-test: not readable – check colours and margin' })));
    for (const w of designWarnings(v)) warns.append(el('p', { class: 'img-note' }, icon('alert'), el('span', {}, T(lang, w))));
  }

  renderFields();
  render();
  return { render };
}
