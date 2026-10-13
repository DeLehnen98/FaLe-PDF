// Tool: Scanner — capture pages with the camera (or pick photos), automatic edge detection,
// adjustable corners with magnifier, perspective correction, filters, multi-page PDF.
// Mode "Ausweis": front + back of an ID card at real size (85.6 × 54 mm) on one A4 page.
import { icon } from '../icons.js';
import { h, esc, toast, errorToast, progress, pickFiles } from '../ui.js';
import { resultCard, enableDragReorder, moveItem } from '../components.js';
import { saveResult } from '../library.js';
import { loadPdfLib, saveDoc } from '../pdflib.js';
import { ensureCss, tick, proBadge, updateFoot } from './common.js';
import { detectDocument, smallImageData, warp, applyFilter, rotateCanvas, FULL_QUAD, orderQuad } from './scanproc.js';

const trackStat = (e, n = 1) => { import('../extras/stats.js').then(m => m.track(e, n)).catch(() => {}); };
import { getDetector, showResultSheet } from './qrscan.js';

const A4 = [595.28, 841.89];
const MM = 72 / 25.4;
const CARD = [85.6, 54];
const MAX_SRC = 3200;
const FILTERS = [
  { id: 'original', label: 'Original' },
  { id: 'enhance', label: 'Verbessert' },
  { id: 'gray', label: 'Graustufen' },
  { id: 'bw', label: 'Schwarzweiß' },
  { id: 'magic', label: 'Magie' },
  { id: 'photo', label: 'Foto' },
];
const QUALITY = { hoch: { max: 2600, q: 0.9, label: 'Hoch' }, mittel: { max: 2000, q: 0.82, label: 'Mittel' }, klein: { max: 1400, q: 0.7, label: 'Klein' } };

const canvasToBlobP = (c, type = 'image/jpeg', q = 0.9) => new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Bild konnte nicht erzeugt werden'))), type, q));

async function decode(blob) {
  try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
  catch {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      await img.decode().catch(() => {});
      return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
}

export async function mount(screen, { idMode = false, qrMode = false } = {}) {
  await ensureCss();
  const isId = !!idMode;
  screen.setTitle(isId ? 'Ausweis scannen' : 'Scanner', isId ? 'Vorder- und Rückseite auf eine A4-Seite' : 'Dokumente mit der Kamera erfassen');
  screen.body.classList.add('sc-body');
  const stamp = new Date().toLocaleDateString('de-DE').replace(/\./g, '-');
  const S = {
    pages: [],
    size: 'a4',
    quality: 'mittel',
    name: isId ? `Ausweis ${stamp}` : `Scan ${stamp}`,
    replace: null,
    view: null,
  };
  let seq = 0;
  let alive = true;
  const cam = { stream: null, track: null, video: null, timer: null, qrTimer: null, torch: false, busy: false };
  let mode = qrMode && !isId ? 'qr' : 'doc'; // capture mode: document pages or QR/barcodes
  let qrDetector = null, qrSheet = null, qrBusy = false;
  if (qrMode) screen.setTitle('QR-Code scannen', 'QR- und Barcodes mit der Kamera lesen');

  // ------------------------------------------------------------------ pages
  async function addImage(blob, { replace = null, side = null } = {}) {
    let bmp = await decode(blob);
    let w = bmp.width || bmp.naturalWidth, hh = bmp.height || bmp.naturalHeight;
    let srcBlob = blob;
    // normalise: orientation applied, at most MAX_SRC pixels on the long side (memory)
    if (Math.max(w, hh) > MAX_SRC || !/jpe?g|png/.test(blob.type || '') || bmp instanceof ImageBitmap) {
      const f = Math.min(1, MAX_SRC / Math.max(w, hh));
      const c = document.createElement('canvas');
      c.width = Math.round(w * f); c.height = Math.round(hh * f);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      srcBlob = await canvasToBlobP(c, 'image/jpeg', 0.92);
      w = c.width; hh = c.height;
      if (bmp.close) bmp.close();
      bmp = c;
    }
    const det = detectDocument(smallImageData(bmp, 360));
    if (bmp.close) bmp.close(); else if (bmp instanceof HTMLCanvasElement) bmp.width = bmp.height = 0;
    const page = {
      id: `p${++seq}`, blob: srcBlob, w, h: hh,
      quad: det.quad || FULL_QUAD.map(p => p.slice()), auto: det.quad, detected: !!det.quad,
      filter: isId ? 'original' : 'enhance', rot: 0, thumb: null, side,
    };
    if (replace != null && S.pages[replace]) {
      const old = S.pages[replace];
      if (old.thumb) URL.revokeObjectURL(old.thumb);
      page.side = old.side;
      S.pages[replace] = page;
    } else S.pages.push(page);
    makeThumb(page);
    return page;
  }

  async function processPage(page, { maxSide = 2000 } = {}) {
    const bmp = await decode(page.blob);
    const sw = bmp.width || bmp.naturalWidth, sh = bmp.height || bmp.naturalHeight;
    // the source needs at most ~1.3× the output resolution
    const f = Math.min(1, (maxSide * 1.3) / Math.max(sw, sh));
    const src = document.createElement('canvas');
    src.width = Math.max(1, Math.round(sw * f)); src.height = Math.max(1, Math.round(sh * f));
    src.getContext('2d').drawImage(bmp, 0, 0, src.width, src.height);
    if (bmp.close) bmp.close();
    let aspect = null;
    if (isId) {
      const q = page.quad.map(([x, y]) => [x * src.width, y * src.height]);
      const qw = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]), qh = Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]);
      aspect = qw >= qh ? CARD[0] / CARD[1] : CARD[1] / CARD[0];
    }
    let out = await warp(src, page.quad, { maxSide, aspect });
    src.width = src.height = 0;
    out = await applyFilter(out, page.filter);
    out = rotateCanvas(out, page.rot);
    return out;
  }

  async function makeThumb(page) {
    try {
      const c = await processPage(page, { maxSide: 520 });
      const b = await canvasToBlobP(c, 'image/jpeg', 0.8);
      c.width = c.height = 0;
      if (page.thumb) URL.revokeObjectURL(page.thumb);
      page.thumb = URL.createObjectURL(b);
      page.tw = c.width; page.th = c.height;
      document.querySelectorAll(`[data-thumb="${page.id}"]`).forEach(img => { img.src = page.thumb; });
      if (S.view === 'capture') updateCaptureBar();
    } catch (e) { console.warn('thumb', e); }
  }

  // ------------------------------------------------------------------ camera
  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error('nocam'), { reason: 'Dieser Browser erlaubt hier keinen Kamerazugriff (nur über HTTPS möglich).' });
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
    });
    if (!alive || S.view !== 'capture') { stream.getTracks().forEach(t => t.stop()); return; }
    cam.stream = stream;
    cam.track = stream.getVideoTracks()[0];
    cam.video.srcObject = stream;
    await cam.video.play().catch(() => {});
    try {
      const caps = cam.track.getCapabilities ? cam.track.getCapabilities() : {};
      const tb = screen.body.querySelector('[data-torch]');
      if (tb) tb.hidden = !caps.torch;
    } catch {}
    cam.timer = setInterval(liveDetect, 650);
    if (mode === 'qr') startQr();
  }
  function stopCamera() {
    clearInterval(cam.timer);
    cam.timer = null;
    clearInterval(cam.qrTimer);
    cam.qrTimer = null;
    if (cam.stream) cam.stream.getTracks().forEach(t => t.stop());
    cam.stream = null; cam.track = null; cam.torch = false;
    if (cam.video) cam.video.srcObject = null;
  }
  function videoBox() {
    const v = cam.video, r = v.getBoundingClientRect();
    const vw = v.videoWidth, vh = v.videoHeight;
    const s = Math.max(r.width / vw, r.height / vh); // object-fit: cover
    return { s, ox: (r.width - vw * s) / 2, oy: (r.height - vh * s) / 2, w: r.width, h: r.height, vw, vh };
  }
  function liveDetect() {
    if (mode === 'qr') return;
    const v = cam.video;
    if (!v || v.readyState < 2 || !v.videoWidth || cam.busy) return;
    const canvas = screen.body.querySelector('.sc-live');
    if (!canvas) return;
    const det = detectDocument(smallImageData(v, 220));
    const b = videoBox();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(b.w * dpr); canvas.height = Math.round(b.h * dpr);
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, b.w, b.h);
    if (!det.quad) return;
    g.beginPath();
    det.quad.forEach(([x, y], i) => { const px = b.ox + x * b.vw * b.s, py = b.oy + y * b.vh * b.s; if (i) g.lineTo(px, py); else g.moveTo(px, py); });
    g.closePath();
    g.fillStyle = 'rgba(45, 212, 191, .18)';
    g.strokeStyle = '#2DD4BF';
    g.lineWidth = 3;
    g.fill(); g.stroke();
  }
  async function grabFrame() {
    if (cam.track && 'ImageCapture' in window) {
      try {
        const ic = new window.ImageCapture(cam.track);
        const blob = await Promise.race([ic.takePhoto(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3500))]);
        if (blob && blob.size > 1000) return blob;
      } catch { /* fall back to the video frame */ }
    }
    const v = cam.video;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    const b = await canvasToBlobP(c, 'image/jpeg', 0.93);
    c.width = c.height = 0;
    return b;
  }

  // ------------------------------------------------------------------ views
  function clearView() {
    stopCamera();
    screen.body.innerHTML = '';
    screen.body.className = 'screen-body sc-body';
    screen.onDropFiles = files => addFiles(files);
  }

  function nextSideLabel() {
    if (!isId) return `Seite ${S.replace != null ? S.replace + 1 : S.pages.length + 1}`;
    const idx = S.replace != null ? S.replace : S.pages.length;
    return idx === 0 ? 'Vorderseite' : 'Rückseite';
  }

  async function showCapture() {
    clearView();
    S.view = 'capture';
    updateFoot(screen, []);
    screen.body.classList.add('sc-dark');
    const wrap = h(`<div class="sc-cap">
      <div class="sc-view">
        <video playsinline muted autoplay aria-label="Kamerabild"></video>
        <canvas class="sc-live" aria-hidden="true"></canvas>
        ${isId ? '<div class="sc-guide" aria-hidden="true"><span></span></div>' : ''}
        <div class="sc-top"><span class="sc-label" data-label>${esc(nextSideLabel())}</span>
          <button class="icon-btn sc-round" type="button" data-torch hidden aria-label="Licht" aria-pressed="false">${icon('flash')}</button></div>
        <div class="sc-flash" aria-hidden="true"></div>
        <div class="sc-qrframe" aria-hidden="true" hidden><span></span></div>
        <div class="sc-modes" data-modes hidden><div class="seg" role="group" aria-label="Modus"><button type="button" data-cmode="doc">Dokument</button><button type="button" data-cmode="qr">${icon('qr')} QR-Code</button></div></div>
        <div class="sc-msg" data-msg hidden></div>
      </div>
      <div class="sc-bar">
        <button class="sc-side" type="button" data-gallery>${icon('gallery')}<span>Album / Dateien</span></button>
        <button class="sc-shutter" type="button" data-shoot aria-label="Foto aufnehmen"><span></span></button>
        <button class="sc-side" type="button" data-done><span class="sc-stack" data-stack></span><span data-donelabel>Fertig</span></button>
      </div></div>`);
    screen.body.appendChild(wrap);
    cam.video = wrap.querySelector('video');
    wrap.querySelector('[data-gallery]').addEventListener('click', async () => {
      if (mode === 'qr') { qrFromFile((await pickFiles({ accept: 'image/*', multiple: false }))[0]); return; }
      addFiles(await pickFiles({ accept: 'image/*', multiple: !isId && S.replace == null }));
    });
    wrap.querySelector('[data-done]').addEventListener('click', () => { if (mode === 'qr') { setMode('doc'); return; } if (S.pages.length) showReview(); else toast('Noch keine Seite erfasst.', 'info'); });
    wrap.querySelector('[data-torch]').addEventListener('click', async e => {
      const b = e.currentTarget;
      cam.torch = !cam.torch;
      try { await cam.track.applyConstraints({ advanced: [{ torch: cam.torch }] }); b.setAttribute('aria-pressed', String(cam.torch)); } catch { cam.torch = false; }
    });
    const shoot = wrap.querySelector('[data-shoot]');
    if (!isId) {
      getDetector().then(det => {
        qrDetector = det;
        if (!alive || S.view !== 'capture' || !document.body.contains(wrap)) return;
        if (!det) { if (mode === 'qr') showQrUnsupported(); return; }
        const box = wrap.querySelector('[data-modes]');
        box.hidden = false;
        box.querySelectorAll('[data-cmode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.cmode)));
        setMode(mode);
      });
    }
    shoot.addEventListener('click', async () => {
      if (cam.busy) return;
      if (mode === 'qr') return;
      if (!cam.stream) { addFiles(await pickFiles({ accept: 'image/*', multiple: false, capture: 'environment' })); return; }
      cam.busy = true;
      shoot.disabled = true;
      wrap.querySelector('.sc-flash').classList.remove('go'); void wrap.offsetWidth; wrap.querySelector('.sc-flash').classList.add('go');
      try {
        const blob = await grabFrame();
        await afterCapture(blob);
      } catch (e) { errorToast(e, 'Aufnahme fehlgeschlagen.'); }
      finally { cam.busy = false; shoot.disabled = false; }
    });
    updateCaptureBar();
    try {
      await startCamera();
    } catch (e) {
      if (!alive || S.view !== 'capture') return;
      const reason = e.reason || (e.name === 'NotAllowedError' ? 'Der Kamerazugriff wurde nicht erlaubt.' : e.name === 'NotFoundError' ? 'Es wurde keine Kamera gefunden.' : 'Die Kamera konnte nicht gestartet werden.');
      showCameraFallback(reason);
    }
  }

  // ------------------------------------------------------------------ QR mode
  function setMode(m) {
    mode = m;
    const wrap = screen.body.querySelector('.sc-cap');
    if (!wrap) return;
    wrap.querySelectorAll('[data-cmode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.cmode === m)));
    wrap.classList.toggle('qr', m === 'qr');
    wrap.querySelector('.sc-qrframe').hidden = m !== 'qr';
    wrap.querySelector('[data-shoot]').hidden = m === 'qr';
    const lbl = wrap.querySelector('[data-label]');
    if (lbl) lbl.textContent = m === 'qr' ? 'QR- / Barcode' : nextSideLabel();
    const dl = wrap.querySelector('[data-donelabel]');
    const stack = wrap.querySelector('[data-stack]');
    if (m === 'qr') { if (dl) dl.textContent = 'Dokument'; if (stack) stack.hidden = true; }
    else { if (stack) stack.hidden = false; updateCaptureBar(); }
    const live = wrap.querySelector('.sc-live');
    if (live) live.getContext('2d').clearRect(0, 0, live.width, live.height);
    const msg = wrap.querySelector('[data-msg]');
    if (m === 'qr') { msg.textContent = 'Halte die Kamera auf einen QR-Code oder Barcode'; msg.hidden = false; startQr(); }
    else { msg.hidden = true; clearInterval(cam.qrTimer); cam.qrTimer = null; if (qrSheet) { qrSheet.close(); qrSheet = null; } }
  }
  function startQr() {
    clearInterval(cam.qrTimer);
    if (!qrDetector || !cam.stream) return;
    cam.qrTimer = setInterval(qrTick, 250);
  }
  async function qrTick() {
    const v = cam.video;
    if (qrBusy || qrSheet || mode !== 'qr' || !v || v.readyState < 2) return;
    qrBusy = true;
    try {
      const codes = await qrDetector.detect(v);
      if (codes && codes.length && mode === 'qr' && !qrSheet) foundCode(codes[0]);
    } catch { /* frame not ready */ }
    finally { qrBusy = false; }
  }
  function foundCode(code) {
    const view = screen.body.querySelector('.sc-view');
    if (!view) return;
    const msg = view.querySelector('[data-msg]');
    if (msg) msg.hidden = true;
    // outline the code in the live overlay
    const canvas = view.querySelector('.sc-live');
    if (canvas && code.cornerPoints && code.cornerPoints.length === 4 && cam.video && cam.video.videoWidth) {
      const b = videoBox();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(b.w * dpr); canvas.height = Math.round(b.h * dpr);
      const g = canvas.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.beginPath();
      code.cornerPoints.forEach((pt, i) => { const x = b.ox + pt.x * b.s, y = b.oy + pt.y * b.s; if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.closePath(); g.lineWidth = 4; g.strokeStyle = '#2DD4BF'; g.stroke();
    }
    qrSheet = showResultSheet(view, code, { onClose: () => {
      qrSheet = null;
      if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
      if (msg && mode === 'qr') msg.hidden = false;
    } });
  }
  async function qrFromFile(file) {
    if (!file) return;
    if (!qrDetector) { toast('Dieser Browser kann QR-Codes nicht erkennen.', 'error'); return; }
    try {
      const bmp = await createImageBitmap(file);
      const codes = await qrDetector.detect(bmp);
      bmp.close && bmp.close();
      if (!codes.length) { toast('Auf dem Bild wurde kein QR-Code gefunden.', 'info'); return; }
      if (qrSheet) qrSheet.close();
      foundCode(codes[0]);
    } catch (e) { errorToast(e, 'Das Bild konnte nicht gelesen werden.'); }
  }
  function showQrUnsupported() {
    clearView();
    S.view = 'capture';
    screen.body.appendChild(h(`<div class="screen-inner pt-narrow"><div class="empty"><div class="empty-art">${icon('qr')}</div>
      <h3>QR-Codes erkennen ist hier nicht möglich</h3>
      <p>Dieser Browser bietet keine eingebaute Code-Erkennung. Auf Android klappt es in Chrome, auf anderen Geräten oft mit der Kamera-App.</p>
      <p><a class="btn btn-soft" href="#/werkzeug/qr-erstellen">${icon('qr')} QR-Code erstellen</a> <a class="btn btn-ghost" href="#/werkzeug/scannen">${icon('scan')} Dokument scannen</a></p></div></div>`));
    updateFoot(screen, []);
  }

  function showCameraFallback(reason) {
    if (mode === 'qr') {
      clearView();
      S.view = 'capture';
      const wrap = h(`<div class="screen-inner pt-narrow">
        <div class="card intro"><span class="tile-ic">${icon('qr')}</span><div><strong>QR-Code scannen</strong><p>${esc(reason)} Du kannst stattdessen ein Foto mit einem QR-Code auswählen.</p></div></div>
        <div class="sc-fallback"><button class="btn btn-primary btn-block" type="button" data-qrfile>${icon('gallery')} Bild mit QR-Code wählen</button>
        <button class="btn btn-ghost btn-block" type="button" data-retry>${icon('rotate')} Kamera erneut versuchen</button></div><div class="sc-view qr-static"></div></div>`);
      screen.body.appendChild(wrap);
      wrap.querySelector('[data-qrfile]').addEventListener('click', async () => {
        const [f] = await pickFiles({ accept: 'image/*', multiple: false });
        if (!f) return;
        qrFromFile(f);
      });
      wrap.querySelector('[data-retry]').addEventListener('click', () => showCapture());
      updateFoot(screen, []);
      return;
    }
    clearView();
    S.view = 'capture';
    const wrap = h(`<div class="screen-inner pt-narrow">
      <div class="card intro"><span class="tile-ic">${icon(isId ? 'idcard' : 'scan')}</span><div><strong>${isId ? 'Ausweis scannen' : 'Dokument scannen'}</strong>
        <p>${isId ? 'Fotografiere Vorder- und Rückseite. Die Karte wird automatisch erkannt, entzerrt und in Originalgröße auf eine A4-Seite gesetzt.' : 'Fotografiere deine Seiten – Kanten werden automatisch erkannt, die Seite entzerrt und lesbar gemacht.'} ${proBadge()}</p></div></div>
      <div class="notice">${icon('camera')}<span>${esc(reason)} Du kannst stattdessen ein Foto aufnehmen oder Bilder auswählen.</span></div>
      <div class="sc-fallback">
        <button class="btn btn-primary btn-block" type="button" data-photo>${icon('camera')} Foto aufnehmen${isId ? ` (${esc(nextSideLabel())})` : ''}</button>
        <button class="btn btn-soft btn-block" type="button" data-gallery>${icon('gallery')} Aus Album / Dateien</button>
        <button class="btn btn-ghost btn-block" type="button" data-retry>${icon('rotate')} Kamera erneut versuchen</button>
      </div>
      ${S.pages.length ? `<button class="btn btn-ghost btn-block" type="button" data-review style="margin-top:12px">${icon('pages')} Zur Übersicht (${S.pages.length})</button>` : ''}</div>`);
    screen.body.appendChild(wrap);
    wrap.querySelector('[data-photo]').addEventListener('click', async () => addFiles(await pickFiles({ accept: 'image/*', multiple: false, capture: 'environment' })));
    wrap.querySelector('[data-gallery]').addEventListener('click', async () => addFiles(await pickFiles({ accept: 'image/*', multiple: !isId && S.replace == null })));
    wrap.querySelector('[data-retry]').addEventListener('click', () => showCapture());
    const rv = wrap.querySelector('[data-review]');
    if (rv) rv.addEventListener('click', showReview);
    updateFoot(screen, []);
  }

  function updateCaptureBar() {
    const lbl = screen.body.querySelector('[data-label]');
    if (lbl) lbl.textContent = nextSideLabel();
    const stack = screen.body.querySelector('[data-stack]');
    if (!stack) return;
    const last = S.pages[S.pages.length - 1];
    stack.innerHTML = last && last.thumb ? `<img src="${last.thumb}" alt=""><b>${S.pages.length}</b>` : S.pages.length ? `<b>${S.pages.length}</b>` : '';
    const dl = screen.body.querySelector('[data-donelabel]');
    if (dl) dl.textContent = S.pages.length ? 'Weiter' : 'Fertig';
  }

  async function afterCapture(blob) {
    const replace = S.replace;
    const label = nextSideLabel();
    const page = await addImage(blob, { replace });
    if (!alive) return;
    const msg = screen.body.querySelector('[data-msg]');
    if (msg) {
      msg.textContent = page.detected ? `${label} erfasst – Kanten erkannt` : `${label} erfasst – keine Kanten erkannt, du kannst sie anpassen`;
      msg.hidden = false;
      clearTimeout(msg._t);
      msg._t = setTimeout(() => { msg.hidden = true; }, 1800);
    }
    if (replace != null) { S.replace = null; showReview(); return; }
    if (isId && S.pages.length >= 2) { showReview(); return; }
    updateCaptureBar();
  }

  async function addFiles(files) {
    const imgs = (files || []).filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(f.name));
    if (!imgs.length) { if (files && files.length) toast('Bitte wähle Bilddateien aus.', 'error'); return; }
    const prog = imgs.length > 1 ? progress('Bilder werden verarbeitet …') : null;
    try {
      for (let i = 0; i < imgs.length; i++) {
        if (isId && S.pages.length >= 2 && S.replace == null) break;
        prog && prog.set(`Bild ${i + 1} von ${imgs.length} …`);
        const replace = S.replace;
        await addImage(imgs[i], { replace });
        S.replace = null;
        await tick();
      }
    } catch (e) { errorToast(e, 'Das Bild konnte nicht gelesen werden (Format nicht unterstützt?).'); }
    finally { prog && prog.done(); }
    if (!alive) return;
    if (isId && S.pages.length < 2) { toast('Jetzt die Rückseite aufnehmen.', 'info'); if (S.view === 'capture') { if (cam.stream) updateCaptureBar(); else showCameraFallback('Rückseite fehlt noch.'); } return; }
    showReview();
  }

  // ---------- review ----------
  function showReview() {
    clearView();
    S.view = 'review';
    const wrap = h(`<div class="screen-inner">
      <div class="toolbar">
        ${!isId ? `<button class="btn btn-soft btn-sm" type="button" data-more>${icon('camera')} Seite hinzufügen</button>
        <button class="btn btn-ghost btn-sm" type="button" data-files>${icon('gallery')} Aus Dateien</button>` : ''}
        <span class="grow"></span>
        <span class="pt-hint" data-hint>${isId ? 'Tippe eine Seite an, um Ecken oder Filter anzupassen.' : 'Tippe eine Seite an, um sie zuzuschneiden oder zu verbessern.'}</span>
      </div>
      <div class="${isId ? 'sc-idgrid' : 'img-grid'}" data-grid></div>
      <h2 class="section-title">Für alle Seiten</h2>
      <div class="card card-pad sc-settings">
        <div class="field"><span class="field-label">Filter</span><div class="seg sc-seg" role="group" aria-label="Filter für alle Seiten">${FILTERS.map(f => `<button type="button" data-allf="${f.id}">${f.label}</button>`).join('')}</div></div>
        ${isId ? '' : `<div class="field"><span class="field-label">Seitenformat</span><div class="seg" role="group" aria-label="Seitenformat"><button type="button" data-size="a4">A4</button><button type="button" data-size="fit">Wie Scan</button></div></div>`}
        <div class="field"><span class="field-label">Qualität</span><div class="seg" role="group" aria-label="Qualität">${Object.entries(QUALITY).map(([k, v]) => `<button type="button" data-q="${k}">${v.label}</button>`).join('')}</div></div>
        <label class="field" style="margin-bottom:0"><span class="field-label">Dateiname</span><input class="input" data-name value="${esc(S.name)}" maxlength="120"></label>
      </div>
      <div data-result></div></div>`);
    screen.body.appendChild(wrap);
    const grid = wrap.querySelector('[data-grid]');
    const sync = () => {
      wrap.querySelectorAll('[data-size]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.size === S.size)));
      wrap.querySelectorAll('[data-q]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.q === S.quality)));
      const all = S.pages.length && S.pages.every(p => p.filter === S.pages[0].filter) ? S.pages[0].filter : null;
      wrap.querySelectorAll('[data-allf]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.allf === all)));
    };
    const renderGrid = () => {
      grid.innerHTML = '';
      if (isId) {
        ['Vorderseite', 'Rückseite'].forEach((label, i) => {
          const p = S.pages[i];
          const card = h(`<div class="card sc-idslot"><div class="sc-idhead"><strong>${label}</strong></div>
            ${p ? `<button class="sc-idimg" type="button" data-edit="${i}" aria-label="${label} bearbeiten"><img data-thumb="${p.id}" src="${p.thumb || ''}" alt=""></button>` : `<button class="sc-idempty" type="button" data-take="${i}">${icon('camera')}<span>${label} aufnehmen</span></button>`}
            ${p ? `<div class="sc-idact"><button class="btn btn-ghost btn-sm" type="button" data-edit="${i}">${icon('crop')} Anpassen</button><button class="btn btn-ghost btn-sm" type="button" data-retake="${i}">${icon('camera')} Neu aufnehmen</button></div>` : ''}</div>`);
          grid.appendChild(card);
        });
      } else {
        S.pages.forEach((p, i) => {
          const card = h(`<div class="img-card sc-card" draggable="true"><button class="img-box sc-open" type="button" data-edit="${i}" aria-label="Seite ${i + 1} bearbeiten"><img data-thumb="${p.id}" src="${p.thumb || ''}" alt="">${p.detected ? '' : `<span class="sc-warn" title="Keine Kanten erkannt">${icon('crop')}</span>`}</button>
            <div class="pcard-foot"><span class="pcard-num">${i + 1}</span><span class="pcard-actions">
              <button class="icon-btn" type="button" data-l aria-label="Nach vorne" ${i === 0 ? 'disabled' : ''}>${icon('arrowLeft')}</button>
              <button class="icon-btn" type="button" data-r aria-label="Nach hinten" ${i === S.pages.length - 1 ? 'disabled' : ''}>${icon('arrowRight')}</button>
              <button class="icon-btn" type="button" data-retake="${i}" aria-label="Seite ${i + 1} neu aufnehmen">${icon('camera')}</button>
              <button class="icon-btn" type="button" data-x aria-label="Seite ${i + 1} löschen">${icon('trash')}</button></span></div></div>`);
          card.querySelector('[data-l]').addEventListener('click', () => { moveItem(S.pages, i, i - 1); renderGrid(); });
          card.querySelector('[data-r]').addEventListener('click', () => { moveItem(S.pages, i, i + 1); renderGrid(); });
          card.querySelector('[data-x]').addEventListener('click', () => { const [p2] = S.pages.splice(i, 1); if (p2.thumb) URL.revokeObjectURL(p2.thumb); renderGrid(); });
          grid.appendChild(card);
        });
        if (!S.pages.length) grid.appendChild(h(`<div class="empty" style="grid-column:1/-1"><div class="empty-art">${icon('scan')}</div><h3>Keine Seiten</h3><p>Nimm eine Seite auf oder wähle Bilder aus.</p></div>`));
      }
      grid.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => showEdit(+b.dataset.edit)));
      grid.querySelectorAll('[data-retake]').forEach(b => b.addEventListener('click', () => { S.replace = +b.dataset.retake; showCapture(); }));
      grid.querySelectorAll('[data-take]').forEach(b => b.addEventListener('click', () => { S.replace = null; showCapture(); }));
      sync();
      refreshFoot();
    };
    if (!isId) enableDragReorder(grid, '.sc-card', (from, to) => { moveItem(S.pages, from, to); renderGrid(); });
    wrap.querySelectorAll('[data-size]').forEach(b => b.addEventListener('click', () => { S.size = b.dataset.size; sync(); }));
    wrap.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => { S.quality = b.dataset.q; sync(); }));
    wrap.querySelectorAll('[data-allf]').forEach(b => b.addEventListener('click', () => {
      S.pages.forEach(p => { if (p.filter !== b.dataset.allf) { p.filter = b.dataset.allf; makeThumb(p); } });
      sync();
    }));
    wrap.querySelector('[data-name]').addEventListener('input', e => { S.name = e.target.value; });
    const more = wrap.querySelector('[data-more]');
    if (more) more.addEventListener('click', () => { S.replace = null; showCapture(); });
    const files = wrap.querySelector('[data-files]');
    if (files) files.addEventListener('click', async () => { S.replace = null; await addFiles(await pickFiles({ accept: 'image/*', multiple: true })); });
    const saveBtn = h(`<button class="btn btn-primary" type="button">${icon('file')} PDF speichern</button>`);
    saveBtn.addEventListener('click', () => savePdf(saveBtn, wrap.querySelector('[data-result]')));
    function refreshFoot() {
      const n = S.pages.length;
      const ready = isId ? n === 2 : n > 0;
      saveBtn.disabled = !ready;
      updateFoot(screen, [saveBtn], isId ? (n === 2 ? 'Vorder- und Rückseite bereit' : `${n} von 2 Seiten`) : `${n} Seite${n === 1 ? '' : 'n'}`);
    }
    renderGrid();
  }

  // ---------- edit (crop + filter) ----------
  async function showEdit(index) {
    const page = S.pages[index];
    if (!page) return;
    clearView();
    S.view = 'edit';
    screen.body.classList.add('sc-dark');
    let quad = page.quad.map(p => p.slice());
    let filter = page.filter, rot = page.rot;
    const wrap = h(`<div class="sc-edit">
      <div class="sc-stage" data-stage><div class="sc-imgwrap" data-wrap>
        <canvas class="sc-src"></canvas>
        <svg class="sc-quad" preserveAspectRatio="none"><path class="sc-shade" fill-rule="evenodd"></path><polygon class="sc-poly"></polygon></svg>
        ${[0, 1, 2, 3].map(i => `<button type="button" class="sc-handle" data-h="${i}" aria-label="Ecke ${['oben links', 'oben rechts', 'unten rechts', 'unten links'][i]} verschieben"></button>`).join('')}
        <canvas class="sc-loupe" width="240" height="240" hidden></canvas>
      </div><div class="sc-preview" data-preview hidden><span class="spinner"></span></div></div>
      <div class="sc-panel">
        <div class="seg sc-steps" role="tablist"><button type="button" data-step="crop" role="tab">${icon('crop')} Zuschneiden</button><button type="button" data-step="filter" role="tab">${icon('filter')} Filter</button></div>
        <div data-cropbar class="sc-row">
          <button class="btn btn-ghost btn-sm" type="button" data-auto>${icon('magic')} Automatisch</button>
          <button class="btn btn-ghost btn-sm" type="button" data-full>${icon('fitPage')} Ganzes Bild</button>
        </div>
        <div data-filterbar class="sc-row" hidden>
          <div class="sc-filters" role="radiogroup" aria-label="Filter">${FILTERS.map(f => `<button type="button" class="sc-filter" role="radio" data-f="${f.id}" aria-checked="${f.id === filter}"><span class="sc-fthumb"><img alt=""></span><span>${f.label}</span></button>`).join('')}</div>
          <button class="btn btn-ghost btn-sm" type="button" data-rot>${icon('rotate')} Drehen</button>
        </div>
      </div></div>`);
    screen.body.appendChild(wrap);
    const stageEl = wrap.querySelector('[data-stage]');
    const iw = wrap.querySelector('[data-wrap]');
    const srcC = wrap.querySelector('.sc-src');
    const svg = wrap.querySelector('.sc-quad');
    const loupe = wrap.querySelector('.sc-loupe');
    const prevBox = wrap.querySelector('[data-preview]');
    const bmp = await decode(page.blob);
    const bw = bmp.width || bmp.naturalWidth, bh = bmp.height || bmp.naturalHeight;
    const dmax = 1600;
    const df = Math.min(1, dmax / Math.max(bw, bh));
    srcC.width = Math.round(bw * df); srcC.height = Math.round(bh * df);
    srcC.getContext('2d').drawImage(bmp, 0, 0, srcC.width, srcC.height);
    if (bmp.close) bmp.close();
    svg.setAttribute('viewBox', `0 0 ${srcC.width} ${srcC.height}`);

    const layout = () => {
      const r = stageEl.getBoundingClientRect();
      const pad = 26;
      const s = Math.min((r.width - pad * 2) / srcC.width, (r.height - pad * 2) / srcC.height);
      iw.style.width = `${Math.max(10, srcC.width * s)}px`;
      iw.style.height = `${Math.max(10, srcC.height * s)}px`;
      draw();
    };
    const draw = () => {
      const W = srcC.width, H = srcC.height;
      const pts = quad.map(([x, y]) => [x * W, y * H]);
      svg.querySelector('.sc-poly').setAttribute('points', pts.map(p => p.join(',')).join(' '));
      svg.querySelector('.sc-shade').setAttribute('d', `M0 0H${W}V${H}H0Z M${pts.map(p => p.join(' ')).join(' L')}Z`);
      wrap.querySelectorAll('.sc-handle').forEach((hd, i) => { hd.style.left = `${quad[i][0] * 100}%`; hd.style.top = `${quad[i][1] * 100}%`; });
    };
    const ro = new ResizeObserver(layout);
    ro.observe(stageEl);
    layout();

    // dragging corners with magnifier
    wrap.querySelectorAll('.sc-handle').forEach(hd => {
      let drag = null;
      hd.addEventListener('pointerdown', e => {
        e.preventDefault();
        hd.setPointerCapture(e.pointerId);
        const r = iw.getBoundingClientRect();
        const i = +hd.dataset.h;
        drag = { i, ox: e.clientX - (r.left + quad[i][0] * r.width), oy: e.clientY - (r.top + quad[i][1] * r.height) };
        hd.classList.add('active');
        loupe.hidden = false;
        moveLoupe(i);
      });
      hd.addEventListener('pointermove', e => {
        if (!drag) return;
        const r = iw.getBoundingClientRect();
        quad[drag.i] = [Math.max(0, Math.min(1, (e.clientX - drag.ox - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - drag.oy - r.top) / r.height))];
        draw();
        moveLoupe(drag.i);
      });
      const end = () => { if (!drag) return; drag = null; hd.classList.remove('active'); loupe.hidden = true; };
      hd.addEventListener('pointerup', end);
      hd.addEventListener('pointercancel', end);
      hd.addEventListener('keydown', e => {
        const i = +hd.dataset.h, step = e.shiftKey ? 0.02 : 0.004;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (!d) return;
        e.preventDefault();
        quad[i] = [Math.max(0, Math.min(1, quad[i][0] + d[0])), Math.max(0, Math.min(1, quad[i][1] + d[1]))];
        draw();
      });
    });
    function moveLoupe(i) {
      const r = iw.getBoundingClientRect();
      const size = 120, zoom = 2.6;
      const px = quad[i][0] * r.width, py = quad[i][1] * r.height;
      // place the loupe away from the finger (above, or below near the top edge)
      let lx = px - size / 2, ly = py - size - 46;
      if (ly < -r.top + 60) ly = py + 46;
      lx = Math.max(-20, Math.min(r.width - size + 20, lx));
      loupe.style.left = `${lx}px`; loupe.style.top = `${ly}px`;
      loupe.style.width = loupe.style.height = `${size}px`;
      const g = loupe.getContext('2d');
      const k = loupe.width / size;
      g.save();
      g.fillStyle = '#000';
      g.fillRect(0, 0, loupe.width, loupe.height);
      const sx = quad[i][0] * srcC.width, sy = quad[i][1] * srcC.height;
      const span = (size / zoom) * (srcC.width / r.width);
      g.drawImage(srcC, sx - span / 2, sy - span / 2, span, span, 0, 0, loupe.width, loupe.height);
      g.strokeStyle = '#2DD4BF'; g.lineWidth = 2 * k;
      g.beginPath(); g.moveTo(loupe.width / 2, 0); g.lineTo(loupe.width / 2, loupe.height); g.moveTo(0, loupe.height / 2); g.lineTo(loupe.width, loupe.height / 2); g.stroke();
      g.restore();
    }

    wrap.querySelector('[data-auto]').addEventListener('click', () => {
      const det = page.auto || detectDocument(smallImageData(srcC, 360)).quad;
      if (det) { quad = det.map(p => p.slice()); draw(); toast('Kanten automatisch erkannt.', 'success', { timeout: 1600 }); }
      else toast('Keine Dokumentkanten gefunden – bitte Ecken von Hand setzen.', 'info');
    });
    wrap.querySelector('[data-full]').addEventListener('click', () => { quad = FULL_QUAD.map(p => p.slice()); draw(); });

    // filter step
    let step = 'crop';
    let previewSeq = 0;
    const setStep = async st => {
      step = st;
      wrap.querySelectorAll('[data-step]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.step === st)));
      wrap.querySelector('[data-cropbar]').hidden = st !== 'crop';
      wrap.querySelector('[data-filterbar]').hidden = st !== 'filter';
      iw.hidden = st !== 'crop';
      prevBox.hidden = st !== 'filter';
      if (st === 'filter') { await renderPreview(); renderFilterThumbs(); }
      updateEditFoot();
    };
    wrap.querySelectorAll('[data-step]').forEach(b => b.addEventListener('click', () => setStep(b.dataset.step)));
    const tmpPage = () => ({ ...page, quad: orderQuad(quad.map(p => p.slice())), filter, rot });
    async function renderPreview() {
      const my = ++previewSeq;
      prevBox.innerHTML = '<span class="spinner"></span>';
      try {
        const c = await processPage(tmpPage(), { maxSide: 1400 });
        if (my !== previewSeq || !alive) { c.width = c.height = 0; return; }
        prevBox.innerHTML = '';
        c.className = 'sc-result';
        prevBox.appendChild(c);
      } catch (e) { errorToast(e, 'Vorschau fehlgeschlagen.'); }
    }
    let thumbBase = null;
    async function renderFilterThumbs() {
      // small warped version once, then the 4 filters on copies of it
      const tp = tmpPage();
      if (!thumbBase || thumbBase.key !== JSON.stringify([tp.quad, rot])) {
        const c = await processPage({ ...tp, filter: 'original' }, { maxSide: 200 });
        thumbBase = { key: JSON.stringify([tp.quad, rot]), c };
      }
      for (const f of FILTERS) {
        const copy = document.createElement('canvas');
        copy.width = thumbBase.c.width; copy.height = thumbBase.c.height;
        copy.getContext('2d').drawImage(thumbBase.c, 0, 0);
        await applyFilter(copy, f.id);
        const img = wrap.querySelector(`[data-f="${f.id}"] img`);
        if (img) img.src = copy.toDataURL('image/jpeg', 0.8);
        copy.width = copy.height = 0;
      }
    }
    wrap.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => {
      filter = b.dataset.f;
      wrap.querySelectorAll('[data-f]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
      renderPreview();
    }));
    wrap.querySelector('[data-rot]').addEventListener('click', () => { rot = (rot + 90) % 360; renderPreview(); renderFilterThumbs(); });

    const backBtn = h(`<button class="btn btn-ghost" type="button">${icon('back')} Abbrechen</button>`);
    const nextBtn = h(`<button class="btn btn-primary" type="button"></button>`);
    backBtn.addEventListener('click', () => { if (step === 'filter') setStep('crop'); else { cleanupEdit(); showReview(); } });
    nextBtn.addEventListener('click', () => {
      if (step === 'crop') { setStep('filter'); return; }
      page.quad = orderQuad(quad);
      page.filter = filter;
      page.rot = rot;
      makeThumb(page);
      cleanupEdit();
      showReview();
    });
    function updateEditFoot() {
      backBtn.innerHTML = step === 'filter' ? `${icon('back')} Zuschneiden` : `${icon('close')} Abbrechen`;
      nextBtn.innerHTML = step === 'crop' ? `Weiter ${icon('arrowRight')}` : `${icon('check')} Übernehmen`;
      updateFoot(screen, [backBtn, nextBtn], isId ? (index === 0 ? 'Vorderseite' : 'Rückseite') : `Seite ${index + 1} von ${S.pages.length}`);
    }
    function cleanupEdit() { ro.disconnect(); srcC.width = srcC.height = 0; if (thumbBase) thumbBase.c.width = 0; }
    setStep('crop');
  }

  // ------------------------------------------------------------------ PDF
  async function savePdf(btn, resultBox) {
    if (!S.pages.length) return;
    btn.disabled = true;
    const prog = progress('Erstelle PDF …');
    try {
      const { PDFDocument } = await loadPdfLib();
      const out = await PDFDocument.create();
      const Q = QUALITY[S.quality];
      if (isId) {
        const page = out.addPage(A4);
        const cw = CARD[0] * MM, ch = CARD[1] * MM;
        let cursor = A4[1] - 36 * MM;
        for (let i = 0; i < 2; i++) {
          prog.set(`Verarbeite ${i ? 'Rückseite' : 'Vorderseite'} …`);
          const c = await processPage(S.pages[i], { maxSide: Math.min(Q.max, 1600) });
          const blob = await canvasToBlobP(c, 'image/jpeg', Math.max(Q.q, 0.85));
          const portrait = c.height > c.width;
          c.width = c.height = 0;
          const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
          const w = portrait ? ch : cw, hh = portrait ? cw : ch;
          const y = cursor - hh;
          cursor = y - 18 * MM;
          page.drawImage(img, { x: (A4[0] - w) / 2, y, width: w, height: hh });
          await tick();
        }
      } else {
        for (let i = 0; i < S.pages.length; i++) {
          prog.set(`Seite ${i + 1} von ${S.pages.length} …`);
          const c = await processPage(S.pages[i], { maxSide: Q.max });
          const blob = await canvasToBlobP(c, 'image/jpeg', Q.q);
          const iw = c.width, ih = c.height;
          c.width = c.height = 0;
          const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
          if (S.size === 'a4') {
            const [pw, ph] = iw > ih ? [A4[1], A4[0]] : A4;
            const f = Math.min(pw / iw, ph / ih);
            const w = iw * f, hh = ih * f;
            const pg = out.addPage([pw, ph]);
            pg.drawImage(img, { x: (pw - w) / 2, y: (ph - hh) / 2, width: w, height: hh });
          } else {
            const long = A4[1];
            const [pw, ph] = iw > ih ? [long, long * ih / iw] : [long * iw / ih, long];
            const pg = out.addPage([pw, ph]);
            pg.drawImage(img, { x: 0, y: 0, width: pw, height: ph });
          }
          await tick();
        }
      }
      const name = (S.name || 'Scan').trim().replace(/[\\/:*?"<>|]+/g, ' ') || 'Scan';
      out.setTitle(name);
      out.setCreator('FaLe PDF Scanner');
      prog.set('Speichere …');
      const res = await saveResult(await saveDoc(out), `${name}.pdf`);
      trackStat('scans');
      resultBox.innerHTML = '';
      const card = resultCard(res, { title: isId ? 'Ausweis gespeichert' : 'Scan gespeichert', note: isId ? 'A4 · Originalgröße' : `${S.pages.length} Seite${S.pages.length === 1 ? '' : 'n'}` });
      const again = h(`<button class="btn btn-ghost btn-sm" type="button">${icon('scan')} Neuer Scan</button>`);
      again.addEventListener('click', () => { S.pages.forEach(p => p.thumb && URL.revokeObjectURL(p.thumb)); S.pages = []; S.replace = null; showCapture(); });
      card.querySelector('.actions').appendChild(again);
      resultBox.appendChild(card);
      resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      toast('PDF gespeichert.', 'success');
    } catch (e) { errorToast(e, 'Die PDF konnte nicht erstellt werden.'); }
    finally { prog.done(); btn.disabled = false; }
  }

  // start
  showCapture();
  return () => {
    alive = false;
    stopCamera();
    S.pages.forEach(p => p.thumb && URL.revokeObjectURL(p.thumb));
  };
}
