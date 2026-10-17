// Tool: QR code scanner (no file intake by the shell – the stage has its own camera, image, PDF and paste
// inputs). Decoding runs in a worker (lib/qr-worker.js → lib/qr-scan.js, our own decoder); where the browser
// has a built-in barcode detector it is asked first, which also reads product barcodes.
//
// Safety first: links are never opened by themselves. Every link gets a local check (lib/qr-content.js) that
// shows the real destination and the usual warning signs of "quishing" (QR phishing) before the user decides.
// Nothing is sent anywhere; the history stays in this browser and never contains two-factor keys.
import { el, icon, clear } from '../lib/dom.js';
import { download } from '../lib/download.js';
import { copyText } from '../lib/seo-ui.js';
import { parseContent, summaryOf, ibanGroups } from '../lib/qr-content.js';

const LANG = document.documentElement.lang === 'en' ? 'en' : 'de';
const T = (v, lang = LANG) => (typeof v === 'string' ? v : v[lang] ?? v.de);
const STORE = 'fale-wt-qr-scan';
const HISTORY_MAX = 50;

let cssReady = null;
function ensureCss() {
  if (!cssReady) {
    cssReady = Promise.all(['../lib/img-tools.css', '../lib/qr-scanner.css'].map(f => new Promise(resolve => {
      const href = new URL(f, import.meta.url).href;
      if (document.querySelector(`link[href="${href}"]`)) { resolve(); return; }
      const link = el('link', { rel: 'stylesheet', href });
      link.addEventListener('load', () => resolve());
      link.addEventListener('error', () => resolve());
      document.head.append(link);
    })));
  }
  return cssReady;
}

// ---------------------------------------------------------------- decoding (worker, main-thread fallback)
let worker = null, workerBroken = false, seq = 0;
const pending = new Map();
function getWorker() {
  if (worker || workerBroken) return worker;
  try {
    worker = new Worker(new URL('../lib/qr-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ev => { const p = pending.get(ev.data.id); if (p) { pending.delete(ev.data.id); p(ev.data); } };
    worker.onerror = () => { workerBroken = true; worker = null; for (const p of pending.values()) p({ error: 'worker' }); pending.clear(); };
  } catch { workerBroken = true; worker = null; }
  return worker;
}
/** Decode RGBA pixels → [{ text, format, points }]. Never blocks the page for long. */
async function decodePixels(img, max = 4) {
  const w = getWorker();
  if (w) {
    const id = ++seq;
    const res = await new Promise(resolve => {
      pending.set(id, resolve);
      const buf = img.data.buffer.slice(0);   // copy: the caller may keep using its pixels
      w.postMessage({ id, width: img.width, height: img.height, data: buf, max }, [buf]);
    });
    if (!res.error) return res.results;
  }
  const { scanImageData } = await import('../lib/qr-scan.js');
  await new Promise(r => setTimeout(r, 0));
  return scanImageData(img, { max });
}

let detectorP = null;
/** The browser's own barcode detector (Chromium on Android, macOS, ChromeOS) or null. */
function getDetector() {
  if (!detectorP) {
    detectorP = (async () => {
      try {
        if (typeof window.BarcodeDetector !== 'function') return null;
        const have = await window.BarcodeDetector.getSupportedFormats();
        const want = ['qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar', 'data_matrix', 'aztec', 'pdf417'].filter(f => have.includes(f));
        return want.length ? new window.BarcodeDetector({ formats: want }) : null;
      } catch { return null; }
    })();
  }
  return detectorP;
}

// ---------------------------------------------------------------- history (this browser only)
function loadStore() {
  try { const s = JSON.parse(localStorage.getItem(STORE) || 'null'); if (s && Array.isArray(s.items)) return s; } catch { /* private mode */ }
  return { items: [] };
}
function saveStore(s) { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* full or blocked */ } }

const FORMAT_NAMES = { qr_code: 'QR', ean_13: 'EAN-13', ean_8: 'EAN-8', upc_a: 'UPC-A', upc_e: 'UPC-E', code_128: 'Code 128', code_39: 'Code 39', code_93: 'Code 93',
  itf: 'ITF', codabar: 'Codabar', data_matrix: 'Data Matrix', aztec: 'Aztec', pdf417: 'PDF417' };
const TYPE_NAMES = {
  link: { de: 'Link', en: 'Link' }, wifi: { de: 'WLAN', en: 'Wi-Fi' }, contact: { de: 'Kontakt', en: 'Contact' }, event: { de: 'Termin', en: 'Event' },
  payment: { de: 'Überweisung', en: 'Bank transfer' }, email: { de: 'E-Mail', en: 'Email' }, sms: { de: 'SMS', en: 'Text message' }, phone: { de: 'Telefon', en: 'Phone' },
  geo: { de: 'Ort', en: 'Location' }, otp: { de: 'Zwei-Faktor-Schlüssel', en: 'Two-factor key' }, crypto: { de: 'Krypto-Zahlung', en: 'Crypto payment' },
  product: { de: 'Produktnummer', en: 'Product number' }, text: { de: 'Text', en: 'Text' },
};
const TYPE_ICON = {
  link: ['M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1', 'M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1'],
  wifi: ['M5 12.5a10 10 0 0 1 14 0', 'M8.5 16a5 5 0 0 1 7 0', 'M12 19.5h.01', 'M2 9a15 15 0 0 1 20 0'],
  contact: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4 21a8 8 0 0 1 16 0'],
  event: ['M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
  payment: ['M3 10h18', 'M5 10v8', 'M9.5 10v8', 'M14.5 10v8', 'M19 10v8', 'M3 21h18', 'M12 3l9 5H3z'],
  email: ['M4 6h16v12H4z', 'M4 7l8 6 8-6'],
  sms: ['M4 5h16v11H9l-5 4z'], phone: ['M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2'],
  geo: ['M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z', 'M12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
  otp: ['M6.5 10.5h11a2.5 2.5 0 0 1 2.5 2.5v5.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5V13a2.5 2.5 0 0 1 2.5-2.5z', 'M8 10.5V7a4 4 0 0 1 8 0v3.5'],
  crypto: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M9.5 8h4a2 2 0 0 1 0 4h-4z', 'M9.5 12h4.5a2 2 0 0 1 0 4H9.5z', 'M9.5 8v8', 'M11 6.5V8', 'M11 16v1.5'],
  product: ['M4 5v14', 'M7 5v14', 'M10 5v14', 'M14 5v14', 'M16 5v14', 'M20 5v14'],
  text: ['M5 6h14', 'M5 10h14', 'M5 14h10', 'M5 18h7'],
  camera: ['M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z', 'M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  torch: ['M8 3h8v4l-2 3v11h-4V10L8 7z', 'M12 13v2'],
  flip: ['M4 12a8 8 0 0 1 14-5.3', 'M18 3v4h-4', 'M20 12a8 8 0 0 1-14 5.3', 'M6 21v-4h4'],
  stop: ['M7 7h10v10H7z'],
  paste: ['M9 4h6v3H9z', 'M8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2'],
  copy: ['M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z', 'M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1'],
  open: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  shield: ['M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z'],
};
const NS = 'http://www.w3.org/2000/svg';
function svg(name, cls = 'wt-i') {
  const s = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', class: cls })) s.setAttribute(k, v);
  for (const d of TYPE_ICON[name] || []) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); s.append(p); }
  return s;
}

/** Premium-rate and service numbers people get tricked into calling or texting (DE + AT/CH prefixes). */
const premium = n => /^(\+49|0049|0)?\s*(900|137|138|180|118|190)|^(\+43|0043)\s*9\d{2}|^(\+41|0041)\s*90\d/.test(String(n).replace(/[\s\-/()]/g, ''));

const csvCell = v => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;   // spreadsheet formula injection
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

let stageCtl = null;

export default {
  labels: { back_to_files: { de: 'Zurück zum Scanner', en: 'Back to the scanner' } },
  options: [
    { id: 'series', type: 'toggle', default: false, label: { de: 'Serienscan', en: 'Continuous scanning' },
      hint: { de: 'Nach einem Treffer weiterscannen – für viele Codes nacheinander.', en: 'Keep scanning after a hit – for many codes in a row.' } },
    { id: 'beep', type: 'toggle', default: true, label: { de: 'Ton und Vibration bei Treffer', en: 'Sound and vibration on a hit' } },
    { id: 'remember', type: 'toggle', default: true, label: { de: 'Verlauf auf diesem Gerät merken', en: 'Keep a history on this device' },
      hint: { de: 'Bleibt nur in diesem Browser. Zwei-Faktor-Schlüssel werden nie gespeichert.', en: 'Stays in this browser only. Two-factor keys are never stored.' } },
  ],

  mountStage(stage, state, ctx) { ensureCss(); stageCtl = scannerStage(stage, state, ctx); },
  takeFiles(files) { stageCtl?.readFiles(files); },
  onOptionsChange(values) { stageCtl?.optionsChanged(values); },

  status(v) {
    const n = (v.found || []).length;
    if (!n) return { ok: false, hint: { de: 'Noch kein Code gescannt.', en: 'No code scanned yet.' } };
    return { summary: n === 1 ? { de: '1 Code gefunden', en: '1 code found' } : { de: `${n} Codes gefunden`, en: `${n} codes found` } };
  },

  async run(inputs, opts, ctx) {
    stageCtl?.stopCamera();
    const found = opts.found || [];
    if (!found.length) throw Object.assign(new Error('empty'), { userMessage: { de: 'Noch kein Code gescannt.', en: 'No code scanned yet.' } });
    const de = ctx.lang === 'de';
    const rows = [[de ? 'Zeit' : 'Time', 'Format', de ? 'Art' : 'Type', de ? 'Kurzfassung' : 'Summary', de ? 'Inhalt' : 'Content']];
    for (const f of found) {
      const c = parseContent(f.text, f.format);
      rows.push([new Date(f.at).toLocaleString(de ? 'de-DE' : 'en-GB'), FORMAT_NAMES[f.format] || f.format, T(TYPE_NAMES[c.type], ctx.lang), summaryOf(c, ctx.lang),
        c.type === 'otp' ? (de ? '(geheimer Schlüssel – nicht exportiert)' : '(secret key – not exported)') : f.text]);
    }
    const csv = '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
    return { outputs: [{ name: de ? 'QR-Codes.csv' : 'QR-codes.csv', blob: new Blob([csv], { type: 'text/csv;charset=utf-8' }) }] };
  },
};

// ---------------------------------------------------------------- stage
function scannerStage(stage, state, ctx) {
  const lang = ctx.lang;
  const v = state.values;
  v.found = v.found || [];

  // --- start panel
  const fileIn = el('input', { type: 'file', accept: 'image/*,application/pdf,.pdf,.heic,.heif', multiple: true, hidden: true, class: 'qs-file',
    onchange: () => { const f = [...fileIn.files]; fileIn.value = ''; readFiles(f); } });
  const photoIn = el('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, class: 'qs-photo',
    onchange: () => { const f = [...photoIn.files]; photoIn.value = ''; readFiles(f); } });
  const startBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-primary wt-btn-lg qs-start-btn', onclick: () => startCamera() },
    svg('camera'), el('span', {}, T({ de: 'Kamera starten', en: 'Start camera' })));
  const fileBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet', onclick: () => fileIn.click() },
    icon('image'), el('span', {}, T({ de: 'Bild oder PDF wählen', en: 'Choose image or PDF' })));
  const photoBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet qs-photo-btn', hidden: !(window.matchMedia && matchMedia('(pointer: coarse)').matches), onclick: () => photoIn.click() },
    svg('camera'), el('span', {}, T({ de: 'Foto aufnehmen', en: 'Take a photo' })));
  const pasteBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet', hidden: !(navigator.clipboard && typeof navigator.clipboard.read === 'function'), onclick: () => pasteImage() },
    svg('paste'), el('span', {}, T({ de: 'Bild einfügen', en: 'Paste image' })));
  const startHint = el('p', { class: 'img-muted qs-hint' }, T({
    de: 'Du kannst ein Bild auch hierher ziehen oder mit Strg+V einfügen – zum Beispiel einen Screenshot oder eine Rechnung als PDF.',
    en: 'You can also drag an image here or paste it with Ctrl+V – a screenshot, say, or an invoice as a PDF.' }));
  const start = el('div', { class: 'qs-start' }, startBtn, el('div', { class: 'qs-start-row' }, fileBtn, photoBtn, pasteBtn), startHint, fileIn, photoIn);

  // --- camera view
  const video = el('video', { class: 'qs-video', playsinline: true, muted: true, autoplay: true, aria: { label: T({ de: 'Kamerabild', en: 'Camera view' }) } });
  video.muted = true; video.setAttribute('playsinline', '');
  const marks = el('canvas', { class: 'qs-marks', aria: { hidden: 'true' } });
  const aim = el('div', { class: 'qs-aim', aria: { hidden: 'true' } });
  const torchBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm qs-torch', hidden: true, aria: { pressed: 'false' }, onclick: () => toggleTorch() },
    svg('torch'), el('span', {}, T({ de: 'Licht', en: 'Light' })));
  const flipBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm', hidden: true, onclick: () => switchCamera() },
    svg('flip'), el('span', {}, T({ de: 'Kamera wechseln', en: 'Switch camera' })));
  const stopBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm qs-stop', onclick: () => stopCamera(true) },
    svg('stop'), el('span', {}, T({ de: 'Stopp', en: 'Stop' })));
  const zoom = el('input', { type: 'range', class: 'qs-zoom-in', min: 1, max: 1, step: 0.1, value: 1, aria: { label: T({ de: 'Zoom', en: 'Zoom' }) } });
  const zoomWrap = el('label', { class: 'qs-zoom', hidden: true }, el('span', {}, T({ de: 'Zoom', en: 'Zoom' })), zoom);
  const camCtl = el('div', { class: 'qs-cam-ctl' }, torchBtn, flipBtn, stopBtn);
  const view = el('div', { class: 'qs-view', hidden: true }, video, marks, aim);
  const camBox = el('div', { class: 'qs-cam', hidden: true }, view, zoomWrap, camCtl);
  const againBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-primary qs-again', hidden: true, onclick: () => startCamera() },
    svg('camera'), el('span', {}, T({ de: 'Weiter scannen', en: 'Scan another' })));

  const status = el('p', { class: 'qs-status', role: 'status', aria: { live: 'polite' } });
  const cancelBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-text wt-btn-sm', hidden: true, onclick: () => { readAbort = true; } }, T({ de: 'Abbrechen', en: 'Cancel' }));
  const err = el('div', { class: 'img-note qs-err', hidden: true, role: 'alert' });

  const scanBox = el('section', { class: 'img-box qs', aria: { labelledby: 'qs-h' } },
    el('h2', { class: 'img-h', id: 'qs-h' }, T({ de: 'Code scannen', en: 'Scan a code' })),
    start, camBox, againBtn, el('div', { class: 'qs-status-row' }, status, cancelBtn), err);

  // --- results + history
  const resultsList = el('div', { class: 'qs-list' });
  const resultsH = el('h2', { class: 'img-h', id: 'qs-res-h' }, T({ de: 'Gefunden', en: 'Found' }));
  const results = el('section', { class: 'qs-results', hidden: true, aria: { labelledby: 'qs-res-h' } }, resultsH, resultsList);
  const histList = el('ol', { class: 'qs-hist-list' });
  const histCount = el('span', { class: 'qs-hist-n' });
  const histClear = el('button', { type: 'button', class: 'wt-btn wt-btn-text wt-btn-sm', onclick: () => { saveStore({ items: [] }); renderHistory(); say(T({ de: 'Verlauf gelöscht.', en: 'History cleared.' })); } },
    T({ de: 'Verlauf löschen', en: 'Clear history' }));
  const hist = el('details', { class: 'img-box qs-hist' }, el('summary', {}, T({ de: 'Verlauf', en: 'History' }), ' ', histCount), histList, histClear);

  stage.append(scanBox, results, hist);
  renderHistory();

  function say(text) { status.textContent = text; }
  function showError(text) { clear(err); if (!text) { err.hidden = true; return; } err.append(icon('alert'), el('span', {}, text)); err.hidden = false; }

  // ---------------------------------------------------------------- camera
  let stream = null, track = null, running = false, loopTimer = 0, devices = [], deviceIdx = -1, audio = null, starting = false;
  const supportsCamera = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext !== false;
  if (!supportsCamera) {
    startBtn.hidden = true;
    photoBtn.hidden = false;
    startHint.textContent = T({ de: 'Dieser Browser erlaubt hier keinen direkten Kamerazugriff. Nimm stattdessen ein Foto vom Code auf oder wähle ein Bild.',
      en: 'This browser doesn’t allow direct camera access here. Take a photo of the code instead or choose an image.' });
  }

  async function startCamera(deviceId = null) {
    if (starting) return;
    starting = true;
    showError('');
    againBtn.hidden = true;
    if (v.beep !== false && !audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { audio = null; } }
    say(T({ de: 'Kamera wird gestartet …', en: 'Starting the camera …' }));
    stopCamera(false);
    try {
      const constraints = { audio: false, video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      track = stream.getVideoTracks()[0];
      video.srcObject = stream;
      start.hidden = true; camBox.hidden = false; view.hidden = false;
      await video.play().catch(() => {});
      await new Promise(r => { if (video.readyState >= 2) r(); else video.addEventListener('loadeddata', r, { once: true }); setTimeout(r, 3000); });
      running = true;
      setupTrackControls();
      try { devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'); } catch { devices = []; }
      flipBtn.hidden = devices.length < 2;
      if (deviceId) deviceIdx = devices.findIndex(d => d.deviceId === deviceId);
      say(T({ de: 'Halte die Kamera auf den Code.', en: 'Point the camera at the code.' }));
      loop();
    } catch (e) {
      stopCamera(true);
      const name = e && e.name;
      showError(name === 'NotAllowedError' || name === 'SecurityError'
        ? T({ de: 'Der Kamerazugriff wurde nicht erlaubt. Erlaube die Kamera in den Website-Einstellungen deines Browsers (Symbol links neben der Adresse) – oder nimm ein Foto vom Code auf.',
          en: 'Camera access was not allowed. Allow the camera in your browser’s site settings (icon left of the address) – or take a photo of the code.' })
        : name === 'NotFoundError' || name === 'OverconstrainedError'
          ? T({ de: 'Keine Kamera gefunden. Wähle stattdessen ein Bild vom Code.', en: 'No camera found. Choose an image of the code instead.' })
          : name === 'NotReadableError' || name === 'AbortError'
            ? T({ de: 'Die Kamera wird gerade von einer anderen App benutzt. Schließ die App und versuch es noch einmal.', en: 'The camera is being used by another app. Close it and try again.' })
            : T({ de: 'Die Kamera ließ sich nicht starten. Nimm stattdessen ein Foto vom Code auf oder wähle ein Bild.', en: 'The camera could not be started. Take a photo of the code or choose an image instead.' }));
      photoBtn.hidden = false;
      say('');
    } finally { starting = false; }
  }

  function setupTrackControls() {
    let caps = {};
    try { caps = track.getCapabilities ? track.getCapabilities() : {}; } catch { caps = {}; }
    torchBtn.hidden = !caps.torch;
    torchBtn.setAttribute('aria-pressed', 'false');
    if (caps.zoom && caps.zoom.max > caps.zoom.min) {
      zoom.min = caps.zoom.min; zoom.max = Math.min(caps.zoom.max, caps.zoom.min * 8); zoom.step = caps.zoom.step || 0.1;
      const cur = track.getSettings ? track.getSettings().zoom : caps.zoom.min;
      zoom.value = cur || caps.zoom.min;
      zoomWrap.hidden = false;
      zoom.oninput = () => { track.applyConstraints({ advanced: [{ zoom: +zoom.value }] }).catch(() => {}); };
    } else zoomWrap.hidden = true;
  }
  async function toggleTorch() {
    if (!track) return;
    const on = torchBtn.getAttribute('aria-pressed') !== 'true';
    try { await track.applyConstraints({ advanced: [{ torch: on }] }); torchBtn.setAttribute('aria-pressed', String(on)); } catch { torchBtn.hidden = true; }
  }
  function switchCamera() {
    if (devices.length < 2) return;
    const cur = track?.getSettings?.().deviceId;
    let i = devices.findIndex(d => d.deviceId === cur);
    i = (i + 1) % devices.length;
    deviceIdx = i;
    startCamera(devices[i].deviceId);
  }

  function stopCamera(showStart = true) {
    running = false;
    clearTimeout(loopTimer);
    if (stream) for (const t of stream.getTracks()) t.stop();
    stream = null; track = null;
    video.srcObject = null;
    const c = marks.getContext('2d'); c && c.clearRect(0, 0, marks.width, marks.height);
    if (showStart) { camBox.hidden = true; view.hidden = true; start.hidden = false; }
  }

  // one frame at a time: grab → decode → wait a little → next (no backlog, no freeze on slow phones)
  const grab = document.createElement('canvas');
  let busy = false;
  async function loop() {
    if (!running || busy) return;
    busy = true;
    const t0 = performance.now();
    try {
      const hits = await scanVideoFrame();
      if (running && hits.length) handleHits(hits, 'camera');
    } catch (e) { console.warn('scan', e); }
    busy = false;
    if (running) loopTimer = setTimeout(loop, Math.max(60, 160 - (performance.now() - t0)));
  }

  async function scanVideoFrame() {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return [];
    const det = await getDetector();
    if (det) {
      try {
        const codes = await det.detect(video);
        if (codes.length) return codes.map(c => ({ text: c.rawValue, format: c.format, corners: c.cornerPoints, w: vw, h: vh }));
      } catch { /* fall through to our decoder */ }
    }
    const s = Math.min(1, 1280 / Math.max(vw, vh));
    const w = Math.round(vw * s), h = Math.round(vh * s);
    grab.width = w; grab.height = h;
    const g = grab.getContext('2d', { willReadFrequently: true });
    g.drawImage(video, 0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    const res = await decodePixels(img, 4);
    return res.map(r => ({ text: r.text, format: r.format, corners: r.points, w, h }));
  }

  function drawMarks(hits) {
    const r = view.getBoundingClientRect();
    marks.width = Math.round(r.width); marks.height = Math.round(r.height);
    const c = marks.getContext('2d');
    if (!c) return;
    c.clearRect(0, 0, marks.width, marks.height);
    const css = getComputedStyle(marks);
    c.strokeStyle = css.color || '#0a8'; c.lineWidth = 4; c.lineJoin = 'round';
    for (const hit of hits) {
      if (!hit.corners || !hit.corners.length) continue;
      // video uses object-fit: cover
      const sc = Math.max(marks.width / hit.w, marks.height / hit.h);
      const ox = (marks.width - hit.w * sc) / 2, oy = (marks.height - hit.h * sc) / 2;
      const pts = hit.corners.map(p => [p.x * sc + ox, p.y * sc + oy]);
      c.beginPath();
      pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      if (pts.length > 3) c.closePath();
      c.stroke();
      if (pts.length === 3) for (const [x, y] of pts) { c.beginPath(); c.arc(x, y, 9, 0, Math.PI * 2); c.stroke(); }
    }
  }

  function feedback() {
    if (v.beep === false) return;
    try { navigator.vibrate && navigator.vibrate(60); } catch { /* not allowed */ }
    if (!audio) return;
    try {
      if (audio.state === 'suspended') audio.resume();
      const o = audio.createOscillator(), gn = audio.createGain();
      o.frequency.value = 1320; gn.gain.value = 0.06;
      o.connect(gn); gn.connect(audio.destination);
      o.start(); o.stop(audio.currentTime + 0.08);
    } catch { /* audio blocked */ }
  }

  const recent = new Map();   // text → time (series mode: don't list the same code twice in a row)
  function handleHits(hits, source) {
    drawMarks(hits);
    const now = Date.now();
    const fresh = hits.filter(h => h.text != null && h.text !== '' && !(recent.has(h.text) && now - recent.get(h.text) < 4000));
    for (const h of hits) recent.set(h.text, now);
    if (!fresh.length) return;
    feedback();
    for (const h of fresh) addResult(h.text, h.format || 'qr_code', source);
    if (!v.series) {
      stopCamera(false);
      camBox.hidden = true; start.hidden = true;
      againBtn.hidden = false;
      setTimeout(() => againBtn.focus(), 50);
    }
  }

  // ---------------------------------------------------------------- images, PDFs, paste
  let readAbort = false, reading = false;
  async function readFiles(files) {
    if (reading || !files.length) return;
    reading = true; readAbort = false;
    showError('');
    stopCamera(true);
    againBtn.hidden = true;
    let total = 0;
    try {
      for (const f of files) {
        if (readAbort) break;
        const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
        const n = isPdf ? await readPdf(f) : await readImage(f);
        if (n < 0) continue;
        total += n;
      }
      if (!readAbort) say(total ? T(total === 1 ? { de: '1 Code gefunden.', en: '1 code found.' } : { de: `${total} Codes gefunden.`, en: `${total} codes found.` })
        : T({ de: 'Kein Code gefunden. Tipp: Der Code sollte scharf und nicht zu klein im Bild sein.', en: 'No code found. Tip: the code should be sharp and not too small in the picture.' }));
      else say(T({ de: 'Abgebrochen.', en: 'Cancelled.' }));
    } finally { reading = false; cancelBtn.hidden = true; }
  }

  async function bitmapOf(file) {
    try { return await createImageBitmap(file); } catch { /* try an <img> (some formats) */ }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }

  async function scanCanvasSource(src, w, h, name) {
    // full size (capped), then smaller (blurry or huge photos), then larger (tiny screenshots)
    const long = Math.max(w, h);
    const scales = [Math.min(1, 2400 / long)];
    if (long > 1300) scales.push(1200 / long);
    if (long < 900) scales.push(Math.min(3, 1600 / long));
    const det = await getDetector();
    if (det) {
      try {
        const codes = await det.detect(src);
        if (codes.length) return codes.map(c => ({ text: c.rawValue, format: c.format }));
      } catch { /* own decoder below */ }
    }
    for (const s of scales) {
      if (readAbort) return [];
      const cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
      const c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.fillStyle = '#fff'; g.fillRect(0, 0, cw, ch);   // transparent PNGs: codes on white
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, 0, 0, cw, ch);
      const res = await decodePixels(g.getImageData(0, 0, cw, ch), 8);
      if (res.length) return res;
    }
    return [];
  }

  async function readImage(file) {
    say(T({ de: `Lese „${file.name}“ …`, en: `Reading “${file.name}” …` }));
    let bmp;
    try { bmp = await bitmapOf(file); } catch {
      showError(T({ de: `„${file.name}“ ließ sich nicht als Bild öffnen. Nutze JPG, PNG oder WebP – oder ein PDF.`, en: `“${file.name}” could not be opened as an image. Use JPG, PNG or WebP – or a PDF.` }));
      return -1;
    }
    const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
    const hits = await scanCanvasSource(bmp, w, h, file.name);
    bmp.close?.();
    for (const h2 of hits) addResult(h2.text, h2.format || 'qr_code', file.name);
    if (hits.length) feedback();
    return hits.length;
  }

  async function readPdf(file) {
    const { openPdfjs, renderPage, PasswordError } = await import('../lib/pdf.js');
    let doc;
    try { doc = await openPdfjs(new Uint8Array(await file.arrayBuffer())); } catch (e) {
      showError(e instanceof PasswordError
        ? T({ de: `„${file.name}“ ist mit einem Passwort geschützt. Entsperre die Datei zuerst.`, en: `“${file.name}” is password-protected. Unlock it first.` })
        : T({ de: `„${file.name}“ ließ sich nicht als PDF öffnen.`, en: `“${file.name}” could not be opened as a PDF.` }));
      return -1;
    }
    const MAX = 40;
    const pages = Math.min(doc.numPages, MAX);
    cancelBtn.hidden = pages < 3;
    let n = 0;
    try {
      for (let p = 1; p <= pages && !readAbort; p++) {
        say(T({ de: `„${file.name}“: Seite ${p} von ${pages} …`, en: `“${file.name}”: page ${p} of ${pages} …` }));
        const page = await doc.getPage(p);
        const base = page.getViewport({ scale: 1 });
        const canvas = await renderPage(page, { scale: Math.min(4, 2200 / Math.max(base.width, base.height)) });
        page.cleanup?.();
        const hits = await scanCanvasSource(canvas, canvas.width, canvas.height, file.name);
        canvas.width = canvas.height = 1;
        for (const h of hits) { addResult(h.text, h.format || 'qr_code', T({ de: `${file.name}, Seite ${p}`, en: `${file.name}, page ${p}` })); n++; }
        await new Promise(r => setTimeout(r, 0));
      }
      if (doc.numPages > MAX) showError(T({ de: `Nur die ersten ${MAX} Seiten wurden durchsucht.`, en: `Only the first ${MAX} pages were searched.` }));
    } finally { doc.destroy?.(); }
    if (n) feedback();
    return n;
  }

  async function pasteImage() {
    try {
      const items = await navigator.clipboard.read();
      const files = [];
      for (const item of items) {
        const type = item.types.find(t => t.startsWith('image/') || t === 'application/pdf');
        if (type) files.push(new File([await item.getType(type)], type === 'application/pdf' ? 'clipboard.pdf' : T({ de: 'Zwischenablage', en: 'Clipboard' }), { type }));
      }
      if (files.length) readFiles(files);
      else showError(T({ de: 'In der Zwischenablage ist kein Bild.', en: 'There is no image on the clipboard.' }));
    } catch { showError(T({ de: 'Der Browser hat den Zugriff auf die Zwischenablage nicht erlaubt. Drück stattdessen Strg+V.', en: 'The browser did not allow clipboard access. Press Ctrl+V instead.' })); }
  }

  // ---------------------------------------------------------------- results
  function addResult(text, format, source) {
    const at = Date.now();
    const known = v.found.find(f => f.text === text && f.format === format);
    if (known) { known.at = at; moveToTop(known); }
    else { const f = { text, format, at, source }; v.found.unshift(f); resultsList.prepend(card(f)); }
    results.hidden = false;
    const c = parseContent(text, format);
    say(T({ de: `Gefunden: ${T(TYPE_NAMES[c.type], 'de')} – ${summaryOf(c, 'de')}`, en: `Found: ${T(TYPE_NAMES[c.type], 'en')} – ${summaryOf(c, 'en')}` }));
    if (v.remember !== false && c.type !== 'otp') {
      const s = loadStore();
      s.items = [{ text, format, at }, ...s.items.filter(i => !(i.text === text && i.format === format))].slice(0, HISTORY_MAX);
      saveStore(s);
      renderHistory();
    }
    state.results.clear();
    ctx.refresh();
  }
  function moveToTop(f) {
    const node = [...resultsList.children].find(n => n._found === f);
    if (node) { resultsList.prepend(node); node.classList.remove('qs-flash'); void node.offsetWidth; node.classList.add('qs-flash'); }
  }

  function renderHistory() {
    const items = loadStore().items;
    histCount.textContent = items.length ? `(${items.length})` : '';
    hist.hidden = !items.length;
    clear(histList);
    for (const it of items) {
      const c = parseContent(it.text, it.format);
      const when = new Date(it.at).toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' });
      histList.append(el('li', {}, el('button', { type: 'button', class: 'qs-hist-item', onclick: () => {
        const known = v.found.find(f => f.text === it.text && f.format === it.format);
        if (known) moveToTop(known);
        else { const f = { text: it.text, format: it.format, at: it.at, source: 'history' }; v.found.unshift(f); resultsList.prepend(card(f)); results.hidden = false; state.results.clear(); ctx.refresh(); }
        results.scrollIntoView({ block: 'start', behavior: 'smooth' });
      } }, svg(c.type, 'wt-i qs-hist-ic'), el('span', { class: 'qs-hist-t' }, summaryOf(c, lang)), el('span', { class: 'qs-hist-when' }, when))));
    }
  }

  // ---------------------------------------------------------------- one result card
  function card(f) {
    const c = parseContent(f.text, f.format);
    const head = el('div', { class: 'qs-card-head' },
      el('span', { class: `qs-type qs-type-${c.type}` }, svg(c.type), el('span', {}, T(TYPE_NAMES[c.type]))),
      f.format !== 'qr_code' ? el('span', { class: 'qs-chip' }, FORMAT_NAMES[f.format] || f.format) : null,
      el('span', { class: 'qs-when' }, new Date(f.at).toLocaleTimeString(lang === 'de' ? 'de-DE' : 'en-GB', { hour: '2-digit', minute: '2-digit' })),
      el('button', { type: 'button', class: 'wt-rm qs-rm', aria: { label: T({ de: 'Aus der Liste entfernen', en: 'Remove from the list' }) }, onclick: () => {
        v.found.splice(v.found.indexOf(f), 1); node.remove(); results.hidden = !v.found.length; state.results.clear(); ctx.refresh();
      } }, icon('close')));
    const body = el('div', { class: 'qs-card-body' });
    const actions = el('div', { class: 'qs-actions' });
    const node = el('article', { class: `qs-card qs-card-${c.type}` }, head, body, actions);
    node._found = f;
    const copyBtn = (label, text) => {
      const b = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm', onclick: async () => {
        const ok = await copyText(text);
        say(ok ? T({ de: 'Kopiert.', en: 'Copied.' }) : T({ de: 'Kopieren hat nicht geklappt – markiere den Text von Hand.', en: 'Copying didn’t work – select the text by hand.' }));
        if (ok) { b.classList.add('is-done'); setTimeout(() => b.classList.remove('is-done'), 1400); }
      } }, svg('copy'), el('span', {}, T(label)));
      return b;
    };
    const row = (label, value, cls = '') => value ? el('div', { class: 'qs-row ' + cls }, el('dt', {}, T(label)), el('dd', {}, value)) : null;
    const dl = (...rows) => el('dl', { class: 'qs-dl' }, rows);
    const fileBtn = (label, name, content, type) => el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm', onclick: () => download(new Blob([content], { type }), name) },
      icon('download'), el('span', {}, T(label)));
    const appLink = (label, href, ic) => el('a', { class: 'wt-btn wt-btn-quiet wt-btn-sm', href, rel: 'noopener noreferrer' }, svg(ic), el('span', {}, T(label)));
    const note = (level, text) => el('p', { class: `qs-note qs-lvl-${level}` }, level === 'ok' ? svg('shield') : icon('alert'), el('span', {}, T(text)));
    const fmtDate = d => d ? (d.allDay ? d.date.toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'full' })
      : d.date.toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB', { dateStyle: 'full', timeStyle: 'short' })) : '';

    switch (c.type) {
      case 'link': body.append(...linkBlock(c, actions)); actions.append(copyBtn({ de: 'Link kopieren', en: 'Copy link' }, c.url)); break;
      case 'wifi': {
        const pw = el('code', { class: 'qs-secret', translate: 'no' }, c.password ? '•'.repeat(Math.min(12, c.password.length)) : '–');
        let shown = false;
        const showBtn = c.password ? el('button', { type: 'button', class: 'wt-btn wt-btn-text wt-btn-sm', aria: { pressed: 'false' }, onclick: () => {
          shown = !shown; pw.textContent = shown ? c.password : '•'.repeat(Math.min(12, c.password.length)); showBtn.setAttribute('aria-pressed', String(shown));
          showBtn.lastChild.textContent = T(shown ? { de: 'Verbergen', en: 'Hide' } : { de: 'Anzeigen', en: 'Show' });
        } }, svg('eye'), el('span', {}, T({ de: 'Anzeigen', en: 'Show' }))) : null;
        body.append(dl(row({ de: 'Netzwerk', en: 'Network' }, c.ssid), row({ de: 'Sicherheit', en: 'Security' }, c.security === 'nopass' ? T({ de: 'Offen (ohne Passwort)', en: 'Open (no password)' }) : c.security),
          c.password ? el('div', { class: 'qs-row' }, el('dt', {}, T({ de: 'Passwort', en: 'Password' })), el('dd', {}, pw, showBtn)) : null,
          c.hidden ? row({ de: 'Sichtbarkeit', en: 'Visibility' }, T({ de: 'Verstecktes Netz', en: 'Hidden network' })) : null),
        el('p', { class: 'img-muted' }, T({ de: 'Zum Verbinden: WLAN-Einstellungen öffnen, das Netz wählen und das Passwort einfügen.', en: 'To connect: open your Wi-Fi settings, choose the network and paste the password.' })));
        if (c.security === 'nopass') body.append(note('note', { de: 'Offene Netze sind unverschlüsselt. Erledige dort nichts Vertrauliches ohne VPN.', en: 'Open networks are unencrypted. Don’t do anything confidential there without a VPN.' }));
        if (c.password) actions.append(copyBtn({ de: 'Passwort kopieren', en: 'Copy password' }, c.password));
        actions.append(copyBtn({ de: 'Netzname kopieren', en: 'Copy network name' }, c.ssid));
        break;
      }
      case 'contact': {
        const tels = c.tel.map(t => el('a', { href: 'tel:' + t.replace(/[^\d+]/g, ''), rel: 'noopener' }, t));
        const mails = c.email.map(m => el('a', { href: 'mailto:' + encodeURIComponent(m).replace(/%40/g, '@'), rel: 'noopener' }, m));
        body.append(dl(row({ de: 'Name', en: 'Name' }, c.name), row({ de: 'Firma', en: 'Company' }, c.org), row({ de: 'Position', en: 'Title' }, c.title),
          tels.length ? el('div', { class: 'qs-row' }, el('dt', {}, T({ de: 'Telefon', en: 'Phone' })), el('dd', { class: 'qs-multi' }, tels)) : null,
          mails.length ? el('div', { class: 'qs-row' }, el('dt', {}, T({ de: 'E-Mail', en: 'Email' })), el('dd', { class: 'qs-multi' }, mails)) : null,
          row({ de: 'Web', en: 'Web' }, c.url.join(', ')), row({ de: 'Adresse', en: 'Address' }, c.adr.join(' · ')), row({ de: 'Notiz', en: 'Note' }, c.note)));
        if (c.tel.some(premium)) body.append(note('warn', { de: 'Eine der Nummern ist eine kostenpflichtige Sondernummer.', en: 'One of the numbers is a premium-rate number.' }));
        actions.append(fileBtn({ de: 'Kontakt speichern (.vcf)', en: 'Save contact (.vcf)' }, `${(c.name || 'Kontakt').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Kontakt'}.vcf`, c.vcard, 'text/vcard;charset=utf-8'));
        break;
      }
      case 'event':
        body.append(dl(row({ de: 'Titel', en: 'Title' }, c.title), row({ de: 'Beginn', en: 'Starts' }, fmtDate(c.start)), row({ de: 'Ende', en: 'Ends' }, fmtDate(c.end)),
          row({ de: 'Ort', en: 'Place' }, c.location), row({ de: 'Beschreibung', en: 'Description' }, c.description)));
        actions.append(fileBtn({ de: 'In den Kalender (.ics)', en: 'Add to calendar (.ics)' }, `${(c.title || 'Termin').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Termin'}.ics`, c.ics, 'text/calendar;charset=utf-8'));
        break;
      case 'payment': {
        const amount = c.amount != null ? c.amount.toLocaleString(lang === 'de' ? 'de-DE' : 'en-GB', { style: 'currency', currency: c.currency || 'EUR' }) : T({ de: 'nicht angegeben – trägst du selbst ein', en: 'not given – you enter it yourself' });
        body.append(dl(row({ de: 'Empfänger', en: 'Recipient' }, c.name),
          el('div', { class: 'qs-row' }, el('dt', {}, 'IBAN'), el('dd', {}, el('code', { translate: 'no' }, ibanGroups(c.iban)), ' ',
            el('span', { class: c.ibanOk ? 'qs-ok' : 'qs-bad' }, T(c.ibanOk ? { de: 'Prüfziffer stimmt', en: 'check digits OK' } : { de: 'Prüfziffer falsch!', en: 'check digits wrong!' })))),
          row('BIC', c.bic), row({ de: 'Betrag', en: 'Amount' }, amount), row({ de: 'Referenz', en: 'Reference' }, c.reference), row({ de: 'Verwendungszweck', en: 'Purpose' }, c.text), row({ de: 'Hinweis', en: 'Note' }, c.info)));
        body.append(note(c.ibanOk ? 'note' : 'danger', c.ibanOk
          ? { de: 'Prüf vor dem Bezahlen, ob Empfänger und Betrag stimmen. Bei Codes auf Parkautomaten, Ladesäulen, Plakaten oder in unerwarteten Briefen: Achte darauf, ob ein Aufkleber über den echten Code geklebt wurde.',
            en: 'Before paying, check that recipient and amount are right. With codes on parking meters, chargers, posters or in unexpected letters: look out for a sticker placed over the real code.' }
          : { de: 'Die IBAN ist fehlerhaft. Überweise nicht und frag beim Empfänger nach.', en: 'The IBAN is invalid. Don’t pay and check with the recipient.' }));
        actions.append(copyBtn({ de: 'IBAN kopieren', en: 'Copy IBAN' }, c.iban));
        if (c.amount != null) actions.append(copyBtn({ de: 'Betrag kopieren', en: 'Copy amount' }, c.amount.toFixed(2).replace('.', lang === 'de' ? ',' : '.')));
        if (c.reference || c.text) actions.append(copyBtn({ de: 'Verwendungszweck kopieren', en: 'Copy reference' }, c.reference || c.text));
        break;
      }
      case 'email': {
        body.append(dl(row({ de: 'An', en: 'To' }, c.to), row({ de: 'Betreff', en: 'Subject' }, c.subject), row({ de: 'Text', en: 'Text' }, c.body)));
        const q = new URLSearchParams(); if (c.subject) q.set('subject', c.subject); if (c.body) q.set('body', c.body);
        actions.append(appLink({ de: 'E-Mail schreiben', en: 'Write email' }, `mailto:${encodeURIComponent(c.to).replace(/%40/g, '@')}${q.toString() ? '?' + q.toString().replace(/\+/g, '%20') : ''}`, 'email'),
          copyBtn({ de: 'Adresse kopieren', en: 'Copy address' }, c.to));
        break;
      }
      case 'sms':
        body.append(dl(row({ de: 'Nummer', en: 'Number' }, c.number), row({ de: 'Text', en: 'Text' }, c.body)));
        if (premium(c.number)) body.append(note('warn', { de: 'Das ist eine kostenpflichtige Sondernummer – eine SMS dorthin kann teuer werden.', en: 'This is a premium-rate number – texting it can be expensive.' }));
        actions.append(appLink({ de: 'SMS schreiben', en: 'Write text' }, `sms:${c.number.replace(/[^\d+]/g, '')}${c.body ? '?body=' + encodeURIComponent(c.body) : ''}`, 'sms'),
          copyBtn({ de: 'Nummer kopieren', en: 'Copy number' }, c.number));
        break;
      case 'phone':
        body.append(dl(row({ de: 'Nummer', en: 'Number' }, c.number)));
        if (premium(c.number)) body.append(note('warn', { de: 'Das ist eine kostenpflichtige Sondernummer.', en: 'This is a premium-rate number.' }));
        actions.append(appLink({ de: 'Anrufen', en: 'Call' }, 'tel:' + c.number.replace(/[^\d+]/g, ''), 'phone'), copyBtn({ de: 'Nummer kopieren', en: 'Copy number' }, c.number));
        break;
      case 'geo':
        body.append(dl(row({ de: 'Koordinaten', en: 'Coordinates' }, `${c.lat}, ${c.lon}`), row({ de: 'Bezeichnung', en: 'Label' }, c.label)));
        actions.append(el('a', { class: 'wt-btn wt-btn-quiet wt-btn-sm', href: `https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lon}#map=17/${c.lat}/${c.lon}`, target: '_blank', rel: 'noopener noreferrer' },
          svg('geo'), el('span', {}, T({ de: 'Auf Karte zeigen', en: 'Show on map' }))), copyBtn({ de: 'Koordinaten kopieren', en: 'Copy coordinates' }, `${c.lat}, ${c.lon}`));
        break;
      case 'otp':
        body.append(dl(row({ de: 'Dienst', en: 'Service' }, c.issuer), row({ de: 'Konto', en: 'Account' }, c.account)),
          note('danger', { de: 'Das ist ein geheimer Schlüssel für die Zwei-Faktor-Anmeldung. Scanne ihn nur mit deiner Authenticator-App und zeig ihn niemandem: Wer ihn hat, kann deine Anmeldecodes erzeugen. Er wird hier weder angezeigt noch gespeichert.',
            en: 'This is a secret key for two-factor sign-in. Only scan it with your authenticator app and never show it to anyone: whoever has it can create your sign-in codes. It is neither shown nor stored here.' }));
        break;
      case 'crypto':
        body.append(dl(row({ de: 'Währung', en: 'Currency' }, c.coin), el('div', { class: 'qs-row' }, el('dt', {}, T({ de: 'Adresse', en: 'Address' })), el('dd', {}, el('code', { class: 'qs-break', translate: 'no' }, c.address))),
          row({ de: 'Betrag', en: 'Amount' }, c.amount), row({ de: 'Bezeichnung', en: 'Label' }, c.label)),
          note('warn', { de: 'Krypto-Zahlungen lassen sich nicht zurückholen. Betrüger nutzen solche Codes gern – zahl nur, wenn du den Empfänger sicher kennst.', en: 'Crypto payments can’t be reversed. Scammers like such codes – only pay if you are sure who the recipient is.' }));
        actions.append(copyBtn({ de: 'Adresse kopieren', en: 'Copy address' }, c.address));
        break;
      case 'product':
        body.append(dl(row({ de: 'Nummer', en: 'Number' }, el('code', { translate: 'no' }, c.code)), row({ de: 'Prüfziffer', en: 'Check digit' }, T(c.valid ? { de: 'stimmt', en: 'correct' } : { de: 'falsch', en: 'wrong' }))));
        actions.append(copyBtn({ de: 'Nummer kopieren', en: 'Copy number' }, c.code));
        break;
      default: {
        const pre = el('pre', { class: 'qs-text', translate: 'no' }, c.text);
        body.append(pre);
        const m = String(c.text).match(/\bhttps?:\/\/[^\s<>"']+/i);
        if (m) {
          const lc = parseContent(m[0]);
          if (lc.type === 'link') body.append(el('div', { class: 'qs-inner-link' }, el('p', { class: 'qs-sub' }, T({ de: 'Enthaltener Link', en: 'Link inside' })), ...linkBlock(lc, actions)));
        }
        actions.append(copyBtn({ de: 'Text kopieren', en: 'Copy text' }, c.text));
      }
    }
    if (c.type !== 'otp' && c.type !== 'text') {
      body.append(el('details', { class: 'qs-raw' }, el('summary', {}, T({ de: 'Rohinhalt', en: 'Raw content' })), el('pre', { class: 'qs-text', translate: 'no' }, f.text)));
    }
    if (f.source && f.source !== 'camera' && f.source !== 'history') body.append(el('p', { class: 'img-muted qs-src' }, T({ de: 'Aus: ', en: 'From: ' }), f.source));
    return node;
  }

  /** Destination, verdict and the open button of a link – never opened without a tap, risky ones need a second one. */
  function linkBlock(c, actions) {
    const out = [];
    const dest = el('div', { class: 'qs-dest' },
      el('p', { class: 'qs-sub' }, T({ de: 'Ziel', en: 'Destination' })),
      c.site ? el('p', { class: 'qs-site', translate: 'no' }, c.site) : null,
      el('p', { class: 'qs-url', translate: 'no' }, c.display ? c.url.replace(c.host, c.display) : c.url));
    out.push(dest);
    const head = {
      ok: { de: 'Keine typischen Warnzeichen gefunden', en: 'No typical warning signs found' },
      note: { de: 'Bitte genau hinsehen', en: 'Please look closely' },
      warn: { de: 'Vorsicht', en: 'Careful' },
      danger: { de: 'Nicht öffnen', en: 'Don’t open' },
    }[c.level];
    const verdict = el('div', { class: `qs-verdict qs-lvl-${c.level}` },
      el('p', { class: 'qs-verdict-h' }, c.level === 'ok' ? svg('shield') : icon('alert'), el('strong', {}, T(head))),
      c.notes.length ? el('ul', {}, c.notes.map(n => el('li', {}, T(n)))) : el('p', {}, T({
        de: `Das ist keine Garantie: Prüfe, ob ${c.site || 'die Adresse'} zu dem passt, was du erwartest – zum Beispiel zum Absender des Briefs oder zum Ort, an dem der Code hängt.`,
        en: `This is no guarantee: check that ${c.site || 'the address'} matches what you expect – for example the sender of the letter or the place where the code is.` })));
    out.push(verdict);
    if (c.href) {
      const risky = c.level === 'warn' || c.level === 'danger';
      const label = el('span', {}, T({ de: 'Link öffnen', en: 'Open link' }));
      let armed = !risky;
      const b = el('button', { type: 'button', class: 'wt-btn wt-btn-sm ' + (risky ? 'wt-btn-quiet qs-open-risky' : 'wt-btn-primary'), onclick: () => {
        if (!armed) {
          armed = true;
          label.textContent = T({ de: 'Trotzdem öffnen', en: 'Open anyway' });
          b.classList.add('is-armed');
          say(T({ de: 'Noch einmal tippen, um den Link trotz der Warnung zu öffnen.', en: 'Tap again to open the link despite the warning.' }));
          return;
        }
        window.open(c.href, '_blank', 'noopener,noreferrer');
      } }, svg('open'), label);
      actions.append(b);
    }
    return out;
  }

  function optionsChanged(values) {
    if (values.remember === false) renderHistory();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && running) { stopCamera(false); camBox.hidden = true; start.hidden = true; againBtn.hidden = false; say(T({ de: 'Kamera pausiert.', en: 'Camera paused.' })); }
  });
  window.addEventListener('pagehide', () => stopCamera(false));

  return { readFiles, stopCamera: () => stopCamera(true), optionsChanged };
}
