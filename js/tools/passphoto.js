// Tool: Passfoto — biometric passport photo (35 × 45 mm) and other photo formats with an overlay
// template (head height, chin, eye zone), pinch/drag/rotate positioning, brightness/contrast,
// optional background lightening for plain backgrounds, export as single JPEG (600 dpi) and as a
// 10 × 15 cm print sheet with cut marks (JPEG + PDF).
import { icon } from '../icons.js';
import { h, esc, toast, errorToast, progress, pickFiles, downloadBlob } from '../ui.js';
import { resultCard } from '../components.js';
import { saveResult } from '../library.js';
import { loadPdfLib, saveDoc } from '../pdflib.js';
import { ensureCss, fileResultCard, proBadge, updateFoot } from './common.js';
import { floodMask, replaceMasked, adjust } from './imgproc.js';
import { loadImageToCanvas } from './imagetools.js';

const DPI = 600;
const PPM = DPI / 25.4; // pixels per mm in the export
const MM = 72 / 25.4;   // PDF points per mm
const BG = [232, 232, 232]; // #E8E8E8

/** Formats with guide bands (mm from the top edge). */
export const TEMPLATES = [
  { id: 'de', label: 'Biometrisch (DE)', desc: 'Pass, Personalausweis, Schengen-Visum', w: 35, h: 45, crown: [3, 7.5], chin: [37, 41.5], eyes: [17.5, 23], head: [32, 36], bio: true },
  { id: 'us', label: 'Visum USA (2×2″)', desc: '51 × 51 mm, Kopf 25–35 mm', w: 50.8, h: 50.8, crown: [3.5, 10], chin: [31.5, 41], eyes: [15.9, 22.2], head: [25.4, 34.9], bio: true },
  { id: 'bew46', label: 'Bewerbung 4 × 6', desc: '40 × 60 mm', w: 40, h: 60, crown: [4, 9.5], chin: [28, 36], eyes: [15.5, 22], head: [24, 31] },
  { id: 'bew4560', label: 'Bewerbung 45 × 60', desc: '45 × 60 mm', w: 45, h: 60, crown: [4, 9.5], chin: [29, 37], eyes: [16, 22.5], head: [25, 32] },
];

const CHECKLIST = [
  'Neutraler Gesichtsausdruck, Mund geschlossen',
  'Augen offen und gut sichtbar, Blick direkt in die Kamera',
  'Kopf gerade und frontal, Gesicht mittig',
  'Gleichmäßiges Licht – keine Schatten im Gesicht oder auf dem Hintergrund',
  'Einfarbiger, heller Hintergrund ohne Muster',
  'Keine Spiegelungen auf der Brille, Rahmen verdeckt die Augen nicht',
  'Keine Kopfbedeckung (Ausnahmen nur aus religiösen Gründen)',
  'Scharf, natürliche Farben, keine Retusche am Gesicht',
];

/** Best grid of photos on a 10 × 15 cm sheet (either orientation), ≤ maxCount. */
export function sheetLayout(t, maxCount = 6) {
  let best = null;
  for (const [SW, SH] of [[150, 100], [100, 150]]) {
    for (const gap of [4, 3, 2]) {
      const cols = Math.floor((SW - 6 + gap) / (t.w + gap)), rows = Math.floor((SH - 6 + gap) / (t.h + gap));
      let n = cols * rows;
      if (n < 1) continue;
      let c = cols, r = rows;
      while (c * r > maxCount) { if (c >= r && c > 1) c--; else r--; }
      n = c * r;
      if (!best || n > best.n || (n === best.n && gap > best.gap)) best = { SW, SH, cols: c, rows: r, gap, n };
    }
  }
  return best;
}

export async function mount(screen) {
  await ensureCss();
  screen.setTitle('Passfoto', 'Passbild und Bewerbungsfoto zuschneiden');
  let tpl = TEMPLATES[0];
  let src = null; // source canvas (background edits are applied here)
  // what the frame shows: a smaller bitmap of src (made off the main thread by createImageBitmap), rebuilt when src
  // changes – drawing the full-size, CPU-backed source on every finger move made the photo stutter on phones
  let view = null, viewOf = null, srcVer = 0, viewVer = -1, pending = null;
  const viewSize = c => { const f = Math.min(1, 1600 / Math.max(c.width, c.height)); return { resizeWidth: Math.max(1, Math.round(c.width * f)), resizeHeight: Math.max(1, Math.round(c.height * f)), resizeQuality: 'high' }; };
  const makeView = c => createImageBitmap(c, viewSize(c)).catch(() => null);
  const currentView = () => (view && viewOf === src && viewVer === srcVer ? view : null);
  function setView(b, c, v) { if (view && view !== b && view.close) view.close(); view = b; viewOf = c; viewVer = v; }
  async function refreshView() {
    const c = src, v = srcVer;
    const b = await makeView(c);
    if (!b) return;
    if (c === src && v === srcVer) { setView(b, c, v); draw(); } else if (b.close) b.close();
  }
  const touched = () => { srcVer++; refreshView(); };
  const T = { cx: 0, cy: 0, s: 1, rot: 0 }; // image center (mm, frame coords), mm per source px, rotation (rad)
  let adj = { brightness: 0, contrast: 0 };
  let alive = true;
  const cam = { stream: null, facing: 'user' };
  const bgUndo = [];
  let bgMode = false;
  let tolerance = 22;

  // ------------------------------------------------------------- step 1: source
  function showStart() {
    stopCamera();
    screen.body.innerHTML = '';
    screen.body.style.cssText = '';
    const wrap = h(`<div class="screen-inner pt-narrow pp">
      <div class="card intro"><span class="tile-ic">${icon('portrait')}</span><div><strong>Passbild selbst machen</strong>
        <p>Foto aufnehmen oder wählen, mit der Schablone ausrichten und als Einzelbild oder Druckbogen 10 × 15 cm speichern – für den Fotoautomaten in der Drogerie. ${proBadge()}</p></div></div>
      <h2 class="section-title">Format</h2>
      <div class="pp-tpls" role="radiogroup" aria-label="Format">${TEMPLATES.map(t => `<button type="button" class="pp-tpl" role="radio" data-tpl="${t.id}" aria-checked="${t === tpl}"><span class="pp-tpl-box" style="aspect-ratio:${t.w}/${t.h}"></span><strong>${esc(t.label)}</strong><span>${esc(t.desc)}</span></button>`).join('')}</div>
      <div class="sc-fallback" style="margin-top:16px">
        <button class="btn btn-primary btn-block" type="button" data-cam>${icon('camera')} Kamera starten</button>
        <button class="btn btn-soft btn-block" type="button" data-pick>${icon('gallery')} Foto wählen</button>
      </div>
      <div class="notice">${icon('info')}<span>Für deutsche Personalausweise und Reisepässe verlangen die Behörden seit Mai 2025 in der Regel ein digital übermitteltes Foto (Fotostudio oder Automat im Bürgeramt). Ausgedruckte Fotos werden u. a. noch für Visa, Führerschein-Anträge oder Mitgliedsausweise genutzt – frag im Zweifel vorher nach.</span></div>
    </div>`);
    screen.body.appendChild(wrap);
    wrap.querySelectorAll('[data-tpl]').forEach(b => b.addEventListener('click', () => {
      tpl = TEMPLATES.find(t => t.id === b.dataset.tpl);
      wrap.querySelectorAll('[data-tpl]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    }));
    wrap.querySelector('[data-cam]').addEventListener('click', () => showCamera());
    wrap.querySelector('[data-pick]').addEventListener('click', async () => useFile((await pickFiles({ accept: 'image/*', multiple: false }))[0]));
    updateFoot(screen, []);
  }
  screen.onDropFiles = files => { const f = files.find(x => /^image\//.test(x.type)); if (f) useFile(f); };

  async function useFile(f) {
    if (!f) return;
    const prog = progress('Foto wird geladen …');
    try {
      const c = await loadImageToCanvas(f, 2400);
      // ready before the first frame, made from the file (decoded off the main thread, no copy of the big canvas)
      pending = { c, b: await createImageBitmap(f, { imageOrientation: 'from-image', ...viewSize(c) }).catch(() => makeView(c)) };
      setSource(c);
    } catch (e) { errorToast(e, 'Das Foto konnte nicht geöffnet werden.'); }
    finally { prog.done(); }
  }

  function stopCamera() {
    if (cam.stream) cam.stream.getTracks().forEach(t => t.stop());
    cam.stream = null;
  }
  async function showCamera() {
    stopCamera();
    screen.body.innerHTML = '';
    screen.body.style.cssText = 'display:flex;flex-direction:column;overflow:hidden';
    screen.body.classList.add('sc-body');
    const wrap = h(`<div class="sc-cap pp-cam sc-dark">
      <div class="sc-view"><video playsinline muted autoplay aria-label="Kamerabild"></video>
        <div class="pp-camguide" aria-hidden="true"><div class="pp-camframe" style="aspect-ratio:${tpl.w}/${tpl.h}"><svg class="pp-oval" viewBox="0 0 ${tpl.w} ${tpl.h}" preserveAspectRatio="none"></svg></div></div>
        <div class="sc-top"><span class="sc-label">${esc(tpl.label)}</span><button class="icon-btn sc-round" type="button" data-switch aria-label="Kamera wechseln">${icon('switchCam')}</button></div>
        <div class="sc-msg">Gesicht in das Oval, Kinn auf die untere Linie</div></div>
      <div class="sc-bar"><button class="sc-side" type="button" data-back>${icon('back')}<span>Zurück</span></button>
        <button class="sc-shutter" type="button" data-shoot aria-label="Foto aufnehmen"><span></span></button>
        <button class="sc-side" type="button" data-gallery>${icon('gallery')}<span>Foto wählen</span></button></div></div>`);
    screen.body.appendChild(wrap);
    drawGuides(wrap.querySelector('.pp-oval'), tpl, { simple: true });
    const video = wrap.querySelector('video');
    wrap.querySelector('[data-back]').addEventListener('click', () => { screen.body.classList.remove('sc-body'); showStart(); });
    wrap.querySelector('[data-gallery]').addEventListener('click', async () => useFile((await pickFiles({ accept: 'image/*', multiple: false }))[0]));
    wrap.querySelector('[data-switch]').addEventListener('click', () => { cam.facing = cam.facing === 'user' ? 'environment' : 'user'; start(); });
    wrap.querySelector('[data-shoot]').addEventListener('click', () => {
      if (!video.videoWidth) return;
      const c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      const g = c.getContext('2d', { willReadFrequently: true });
      // front camera previews are mirrored for the user; the photo itself must not be mirrored
      g.drawImage(video, 0, 0);
      stopCamera();
      screen.body.classList.remove('sc-body');
      setSource(c);
    });
    updateFoot(screen, []);
    async function start() {
      stopCamera();
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error('nocam'), { reason: 'Kein Kamerazugriff möglich (nur über HTTPS).' });
        const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: cam.facing }, width: { ideal: 1920 }, height: { ideal: 1440 } } });
        if (!alive || !document.body.contains(video)) { stream.getTracks().forEach(t => t.stop()); return; }
        cam.stream = stream;
        video.srcObject = stream;
        video.classList.toggle('mirror', cam.facing === 'user');
        await video.play().catch(() => {});
      } catch (e) {
        const reason = e.reason || (e.name === 'NotAllowedError' ? 'Der Kamerazugriff wurde nicht erlaubt.' : 'Die Kamera konnte nicht gestartet werden.');
        toast(`${reason} Du kannst ein vorhandenes Foto wählen.`, 'error', { timeout: 5000 });
        screen.body.classList.remove('sc-body');
        showStart();
      }
    }
    start();
  }

  function setSource(c) {
    if (src && src !== c) src.width = 0;
    src = c;
    srcVer++;
    if (pending && pending.c === c && pending.b) setView(pending.b, c, srcVer); else refreshView();
    pending = null;
    bgUndo.length = 0;
    adj = { brightness: 0, contrast: 0 };
    // cover the frame
    T.s = Math.max(tpl.w / src.width, tpl.h / src.height) * 1.05;
    T.cx = tpl.w / 2; T.cy = tpl.h / 2; T.rot = 0;
    showAdjust();
    autoAlign();
  }

  /** Progressive enhancement: use the browser's face detector (if any) to pre-align the head. */
  async function autoAlign() {
    if (!('FaceDetector' in window)) return;
    try {
      const fd = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
      const [face] = await fd.detect(src);
      if (!face || !face.boundingBox) return;
      const b = face.boundingBox;
      // face box ≈ eyebrows to chin; head (crown–chin) ≈ 1.45 × box height
      const headPx = b.height * 1.45;
      const targetHead = (tpl.head[0] + tpl.head[1]) / 2;
      T.s = targetHead / headPx;
      const chinMm = (tpl.chin[0] + tpl.chin[1]) / 2;
      const faceCx = b.x + b.width / 2, chinPx = b.y + b.height;
      T.cx = tpl.w / 2 - (faceCx - src.width / 2) * T.s;
      T.cy = chinMm - (chinPx - src.height / 2) * T.s;
      layout();
      toast('Gesicht erkannt und vorausgerichtet – bitte prüfen.', 'success', { timeout: 3000 });
    } catch { /* detector unavailable on this device */ }
  }

  // ------------------------------------------------------------- step 2: adjust
  let els = null, k = 8; // px per mm on screen
  function showAdjust() {
    screen.body.innerHTML = '';
    screen.body.className = 'screen-body';
    screen.body.style.cssText = 'display:flex;flex-direction:column;overflow:hidden';
    const root = h(`<div class="pp-edit">
      <div class="pp-stage" data-stage>
        <div class="pp-frame" data-frame><canvas class="pp-img" data-img></canvas><svg class="pp-guides" data-guides preserveAspectRatio="none"></svg></div>
        <div class="pp-legend"><span><i class="lg-head"></i>Kopf</span><span><i class="lg-eyes"></i>Augen</span><span><i class="lg-chin"></i>Kinn</span></div>
      </div>
      <div class="pp-panel">
        <div class="seg sc-steps pp-tabs" role="tablist"><button type="button" data-tab="pos">${icon('crop')} Ausrichten</button><button type="button" data-tab="light">${icon('sun')} Licht</button><button type="button" data-tab="bg">${icon('bucket')} Hintergrund</button><button type="button" data-tab="check">${icon('check')} Prüfen</button></div>
        <div data-pane="pos" class="pp-pane"><label class="pt-range it-range"><span>Zoom</span><input type="range" name="zoom" min="0.2" max="4" step="0.01"><b data-v="zoom"></b></label>
          <label class="pt-range it-range"><span>Drehen</span><input type="range" name="rot" min="-20" max="20" step="0.5" value="0"><b data-v="rot">0°</b></label>
          <p class="hint">Ziehen verschiebt, mit zwei Fingern zoomen und drehen. Oben den Scheitel zwischen die oberen Linien, das Kinn zwischen die unteren, die Augen in den grünen Bereich.</p></div>
        <div data-pane="light" class="pp-pane" hidden><label class="pt-range it-range"><span>Helligkeit</span><input type="range" name="brightness" min="-50" max="50" step="1" value="0"><b data-v="brightness">0</b></label>
          <label class="pt-range it-range"><span>Kontrast</span><input type="range" name="contrast" min="-40" max="40" step="1" value="0"><b data-v="contrast">0</b></label></div>
        <div data-pane="bg" class="pp-pane" hidden><p class="it-info"><b>Hintergrund aufhellen</b> – für einfarbige Hintergründe: tippe auf den Hintergrund neben dem Kopf. Er wird durch Hellgrau (#E8E8E8) ersetzt. Bei unruhigen Hintergründen bitte neu fotografieren.</p>
          <label class="pt-range it-range"><span>Toleranz</span><input type="range" name="tol" min="5" max="60" step="1" value="${tolerance}"><b data-v="tol">${tolerance}</b></label>
          <div class="it-row it-wrap"><button class="btn btn-soft btn-sm" type="button" data-bgmode aria-pressed="false">${icon('bucket')} Antippen zum Füllen</button><button class="btn btn-ghost btn-sm" type="button" data-bgundo disabled>${icon('undo')} Rückgängig</button></div></div>
        <div data-pane="check" class="pp-pane" hidden><ul class="pp-check">${CHECKLIST.map((c, i) => `<li><label class="check"><input type="checkbox" data-ck="${i}"><span>${esc(c)}</span></label></li>`).join('')}</ul>
          <p class="hint pp-disclaimer">FaLe PDF schneidet nach den Maßen der Vorlage zu. Ob ein Foto angenommen wird, entscheidet allein die Behörde bzw. Stelle, bei der du es einreichst.</p></div>
      </div></div>`);
    screen.body.appendChild(root);
    els = { root, stage: root.querySelector('[data-stage]'), frame: root.querySelector('[data-frame]'), img: root.querySelector('[data-img]'), guides: root.querySelector('[data-guides]') };
    const tabs = root.querySelectorAll('[data-tab]');
    const setTab = t => {
      tabs.forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
      root.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== t; });
      if (t !== 'bg') setBgMode(false);
    };
    tabs.forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
    setTab('pos');
    const zoom = root.querySelector('[name=zoom]'), rot = root.querySelector('[name=rot]');
    const baseS = Math.max(tpl.w / src.width, tpl.h / src.height);
    const syncSliders = () => {
      zoom.value = String(T.s / baseS); root.querySelector('[data-v=zoom]').textContent = `${Math.round((T.s / baseS) * 100)} %`;
      rot.value = String(T.rot * 180 / Math.PI); root.querySelector('[data-v=rot]').textContent = `${(T.rot * 180 / Math.PI).toFixed(1).replace('.', ',')}°`;
    };
    els.sync = syncSliders;
    zoom.addEventListener('input', () => { T.s = baseS * +zoom.value; draw(); syncSliders(); });
    rot.addEventListener('input', () => { T.rot = +rot.value * Math.PI / 180; draw(); syncSliders(); });
    ['brightness', 'contrast'].forEach(n => root.querySelector(`[name=${n}]`).addEventListener('input', e => { adj[n] = +e.target.value; root.querySelector(`[data-v=${n}]`).textContent = e.target.value; draw(); }));
    root.querySelector('[name=tol]').addEventListener('input', e => { tolerance = +e.target.value; root.querySelector('[data-v=tol]').textContent = e.target.value; });
    root.querySelector('[data-bgmode]').addEventListener('click', () => setBgMode(!bgMode));
    root.querySelector('[data-bgundo]').addEventListener('click', () => {
      const prev = bgUndo.pop();
      if (prev) { src.getContext('2d').putImageData(prev, 0, 0); touched(); draw(); }
      root.querySelector('[data-bgundo]').disabled = !bgUndo.length;
    });
    wirePointer();
    const back = h(`<button class="btn btn-ghost" type="button">${icon('camera')} Neues Foto</button>`);
    const next = h(`<button class="btn btn-primary" type="button">${icon('check')} Fertig</button>`);
    back.addEventListener('click', showStart);
    next.addEventListener('click', showExport);
    updateFoot(screen, [back, next], tpl.label);
    layout();
    syncSliders();
  }
  function setBgMode(on) {
    bgMode = on;
    if (!els) return;
    const b = els.root.querySelector('[data-bgmode]');
    if (b) b.setAttribute('aria-pressed', String(on));
    els.frame.classList.toggle('bucket', on);
  }

  function layout() {
    if (!els) return;
    const r = els.stage.getBoundingClientRect();
    k = Math.max(3, Math.min((r.width - 40) / tpl.w, (r.height - 70) / tpl.h));
    els.frame.style.width = `${tpl.w * k}px`;
    els.frame.style.height = `${tpl.h * k}px`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    els.img.width = Math.round(tpl.w * k * dpr); els.img.height = Math.round(tpl.h * k * dpr);
    els.guides.setAttribute('viewBox', `0 0 ${tpl.w} ${tpl.h}`);
    drawGuides(els.guides, tpl);
    draw();
  }
  function draw() {
    if (!els || !src) return;
    const c = els.img, g = c.getContext('2d');
    const ppm = c.width / tpl.w;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.translate(T.cx * ppm, T.cy * ppm); g.rotate(T.rot); g.scale(T.s * ppm, T.s * ppm);
    g.imageSmoothingQuality = 'high';
    g.drawImage(currentView() || src, -src.width / 2, -src.height / 2, src.width, src.height);
    c.style.filter = `brightness(${1 + adj.brightness / 100}) contrast(${1 + adj.contrast / 100})`;
  }

  function wirePointer() {
    const pts = new Map();
    let start = null;
    const el = els.frame;
    const snapshot = () => ({ ...T, pts: new Map([...pts].map(([id, p]) => [id, { ...p }])) });
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      start = snapshot();
      if (bgMode && pts.size === 1) { start.tap = { x: e.clientX, y: e.clientY, t: Date.now() }; }
    });
    el.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId) || !start) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (bgMode && pts.size === 1) return;
      const ids = [...pts.keys()];
      if (ids.length === 1) {
        const p0 = start.pts.get(ids[0]);
        if (!p0) return;
        const p = pts.get(ids[0]);
        T.cx = start.cx + (p.x - p0.x) / k; T.cy = start.cy + (p.y - p0.y) / k;
      } else if (ids.length >= 2) {
        const [a, b] = ids;
        const a0 = start.pts.get(a), b0 = start.pts.get(b);
        if (!a0 || !b0) { start = snapshot(); return; }
        const a1 = pts.get(a), b1 = pts.get(b);
        const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y), d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
        const ang0 = Math.atan2(b0.y - a0.y, b0.x - a0.x), ang1 = Math.atan2(b1.y - a1.y, b1.x - a1.x);
        const f = d1 / Math.max(1, d0);
        const r = el.getBoundingClientRect();
        const m0 = { x: ((a0.x + b0.x) / 2 - r.left) / k, y: ((a0.y + b0.y) / 2 - r.top) / k };
        const m1 = { x: ((a1.x + b1.x) / 2 - r.left) / k, y: ((a1.y + b1.y) / 2 - r.top) / k };
        const dr = ang1 - ang0;
        T.s = start.s * f; T.rot = start.rot + dr;
        // keep the point under the fingers fixed: rotate/scale the center around m0, then move to m1
        const vx = start.cx - m0.x, vy = start.cy - m0.y;
        const cos = Math.cos(dr), sin = Math.sin(dr);
        T.cx = m1.x + (vx * cos - vy * sin) * f; T.cy = m1.y + (vx * sin + vy * cos) * f;
      }
      draw(); if (els.sync) els.sync();
    });
    const end = e => {
      if (bgMode && start && start.tap && pts.size === 1) {
        const p = pts.get(e.pointerId);
        if (p && Math.hypot(p.x - start.tap.x, p.y - start.tap.y) < 10) fillAt(p.x, p.y);
      }
      pts.delete(e.pointerId);
      start = pts.size ? snapshot() : null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', e => { pts.delete(e.pointerId); start = pts.size ? snapshot() : null; });
    el.addEventListener('wheel', e => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const m = { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
      const f = Math.exp(-e.deltaY * 0.0015);
      T.cx = m.x + (T.cx - m.x) * f; T.cy = m.y + (T.cy - m.y) * f; T.s *= f;
      draw(); if (els.sync) els.sync();
    }, { passive: false });
  }

  /** Screen point → source pixel, then flood fill the background there. */
  function fillAt(x, y) {
    const r = els.frame.getBoundingClientRect();
    const fx = (x - r.left) / k - T.cx, fy = (y - r.top) / k - T.cy;
    const cos = Math.cos(-T.rot), sin = Math.sin(-T.rot);
    const sx = (fx * cos - fy * sin) / T.s + src.width / 2, sy = (fx * sin + fy * cos) / T.s + src.height / 2;
    if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) return;
    const g = src.getContext('2d', { willReadFrequently: true });
    const data = g.getImageData(0, 0, src.width, src.height);
    const mask = floodMask(data, [[sx, sy]], { tolerance });
    let n = 0; for (let i = 0; i < mask.length; i++) n += mask[i];
    if (n > mask.length * 0.85) { toast('Das hätte fast das ganze Bild erfasst – Toleranz verringern.', 'error'); return; }
    if (n < 30) { toast('Kaum etwas gefunden – Toleranz erhöhen oder woanders tippen.', 'info'); return; }
    bgUndo.push(data);
    if (bgUndo.length > 5) bgUndo.shift();
    const out = replaceMasked(data, mask, { color: BG, feather: Math.max(1.5, src.width / 900) });
    g.putImageData(new ImageData(out.data, out.width, out.height), 0, 0);
    touched();
    els.root.querySelector('[data-bgundo]').disabled = false;
    draw();
  }

  // ------------------------------------------------------------- export
  function renderPhoto() {
    const W = Math.round(tpl.w * PPM), H = Math.round(tpl.h * PPM);
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.translate(T.cx * PPM, T.cy * PPM); g.rotate(T.rot); g.scale(T.s * PPM, T.s * PPM);
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, -src.width / 2, -src.height / 2);
    if (adj.brightness || adj.contrast) {
      const d = adjust(g.getImageData(0, 0, W, H), { brightness: adj.brightness * 0.78, contrast: adj.contrast });
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.putImageData(new ImageData(d.data, d.width, d.height), 0, 0);
    }
    return c;
  }
  function renderSheet(photo, lay) {
    const c = document.createElement('canvas');
    c.width = Math.round(lay.SW * PPM); c.height = Math.round(lay.SH * PPM);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    const pos = sheetPositions(lay);
    pos.forEach(([x, y]) => g.drawImage(photo, Math.round(x * PPM), Math.round(y * PPM), Math.round(tpl.w * PPM), Math.round(tpl.h * PPM)));
    g.strokeStyle = '#9AA0B4'; g.lineWidth = Math.max(2, PPM * 0.15);
    cutMarks(lay).forEach(([x0, y0, x1, y1]) => { g.beginPath(); g.moveTo(x0 * PPM, y0 * PPM); g.lineTo(x1 * PPM, y1 * PPM); g.stroke(); });
    g.fillStyle = '#9AA0B4';
    g.font = `${Math.round(PPM * 2)}px sans-serif`;
    g.fillText(`${tpl.label} · ${String(tpl.w).replace('.', ',')} × ${String(tpl.h).replace('.', ',')} mm · in Originalgröße (100 %) drucken`, PPM * 3, c.height - PPM * 1.2);
    return c;
  }
  function sheetPositions(lay) {
    const totW = lay.cols * tpl.w + (lay.cols - 1) * lay.gap, totH = lay.rows * tpl.h + (lay.rows - 1) * lay.gap;
    const ox = (lay.SW - totW) / 2, oy = (lay.SH - totH) / 2 - 1;
    const out = [];
    for (let r = 0; r < lay.rows; r++) for (let c = 0; c < lay.cols; c++) out.push([ox + c * (tpl.w + lay.gap), oy + r * (tpl.h + lay.gap)]);
    return out;
  }
  function cutMarks(lay) {
    const L = 2.2, off = 0.6;
    const lines = [];
    sheetPositions(lay).forEach(([x, y]) => {
      const x1 = x + tpl.w, y1 = y + tpl.h;
      for (const [cx, cy, dx, dy] of [[x, y, -1, -1], [x1, y, 1, -1], [x, y1, -1, 1], [x1, y1, 1, 1]]) {
        lines.push([cx + dx * off, cy, cx + dx * (off + L), cy]);
        lines.push([cx, cy + dy * off, cx, cy + dy * (off + L)]);
      }
    });
    return lines;
  }

  function showExport() {
    const maxFit = sheetLayout(tpl, 99).n;
    let count = Math.min(6, maxFit);
    screen.body.innerHTML = '';
    screen.body.style.cssText = '';
    const photo = renderPhoto();
    const wrap = h(`<div class="screen-inner pp-export">
      <div class="pp-out">
        <div class="card card-pad pp-single"><h2 class="section-title" style="margin-top:0">Einzelfoto</h2><div class="pp-prevbox" data-single></div>
          <p class="muted small">${String(tpl.w).replace('.', ',')} × ${String(tpl.h).replace('.', ',')} mm · ${photo.width} × ${photo.height} px (${DPI} dpi)</p>
          <button class="btn btn-soft btn-block" type="button" data-dl1>${icon('download')} Foto als JPEG</button></div>
        <div class="card card-pad pp-sheet"><h2 class="section-title" style="margin-top:0">Druckbogen 10 × 15 cm</h2><div class="pp-prevbox" data-sheet></div>
          <div class="field"><span class="field-label">Anzahl Fotos</span><div class="seg" role="group" data-counts></div></div>
          <div class="pp-sheetbtns"><button class="btn btn-primary" type="button" data-dlsheet>${icon('image')} Bogen als JPEG</button><button class="btn btn-soft" type="button" data-pdf>${icon('file')} Bogen als PDF</button></div>
          <p class="hint">Am Fotoautomaten das Format 10 × 15 wählen und ohne Skalierung („Originalgröße“) drucken. Danach an den Schnittmarken ausschneiden.</p></div>
      </div>
      <div class="notice">${icon('info')}<span>Ob ein Foto angenommen wird, entscheidet die jeweilige Behörde oder Stelle. Für deutsche Ausweise und Pässe werden seit Mai 2025 in der Regel digital übermittelte Fotos verlangt.</span></div>
      <div data-result></div></div>`);
    screen.body.appendChild(wrap);
    const sp = wrap.querySelector('[data-single]');
    const pv = document.createElement('canvas');
    pv.width = 280; pv.height = Math.round(280 * tpl.h / tpl.w);
    pv.getContext('2d').drawImage(photo, 0, 0, pv.width, pv.height);
    sp.appendChild(pv);
    const counts = wrap.querySelector('[data-counts]');
    const options = [...new Set([Math.min(4, maxFit), Math.min(6, maxFit), ...(maxFit <= 8 ? [maxFit] : [])])].sort((a, b) => a - b);
    let sheet = null;
    const renderSheetPreview = () => {
      counts.innerHTML = options.map(n => `<button type="button" data-n="${n}" aria-pressed="${n === count}">${n}</button>`).join('');
      counts.querySelectorAll('[data-n]').forEach(b => b.addEventListener('click', () => { count = +b.dataset.n; renderSheetPreview(); }));
      if (sheet) sheet.width = 0;
      sheet = renderSheet(photo, sheetLayout(tpl, count));
      const box = wrap.querySelector('[data-sheet]');
      box.innerHTML = '';
      const p = document.createElement('canvas');
      const f = Math.min(420 / sheet.width, 300 / sheet.height);
      p.width = Math.round(sheet.width * f); p.height = Math.round(sheet.height * f);
      p.getContext('2d').drawImage(sheet, 0, 0, p.width, p.height);
      box.appendChild(p);
    };
    renderSheetPreview();
    const resBox = wrap.querySelector('[data-result]');
    const stamp = new Date().toLocaleDateString('de-DE').replace(/\./g, '-');
    const jpeg = c => new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('jpeg'))), 'image/jpeg', 0.95));
    wrap.querySelector('[data-dl1]').addEventListener('click', async () => {
      const b = await jpeg(photo);
      const name = `Passfoto ${String(tpl.w).replace('.', ',')}x${String(tpl.h).replace('.', ',')} mm ${stamp}.jpg`;
      resBox.innerHTML = '';
      resBox.appendChild(fileResultCard(b, name, { title: 'Einzelfoto', iconName: 'portrait', note: `${photo.width} × ${photo.height} px`, type: 'image/jpeg' }));
      downloadBlob(b, name);
    });
    wrap.querySelector('[data-dlsheet]').addEventListener('click', async () => {
      const b = await jpeg(sheet);
      const name = `Passfoto Druckbogen 10x15 ${stamp}.jpg`;
      resBox.innerHTML = '';
      resBox.appendChild(fileResultCard(b, name, { title: 'Druckbogen 10 × 15 cm', iconName: 'image', note: `${count} Fotos · ${sheet.width} × ${sheet.height} px`, type: 'image/jpeg' }));
      downloadBlob(b, name);
    });
    wrap.querySelector('[data-pdf]').addEventListener('click', async e => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const prog = progress('Erstelle PDF …');
      try {
        const lay = sheetLayout(tpl, count);
        const { PDFDocument, rgb } = await loadPdfLib();
        const doc = await PDFDocument.create();
        const page = doc.addPage([lay.SW * MM, lay.SH * MM]);
        const img = await doc.embedJpg(new Uint8Array(await (await jpeg(photo)).arrayBuffer()));
        sheetPositions(lay).forEach(([x, y]) => page.drawImage(img, { x: x * MM, y: (lay.SH - y - tpl.h) * MM, width: tpl.w * MM, height: tpl.h * MM }));
        cutMarks(lay).forEach(([x0, y0, x1, y1]) => page.drawLine({ start: { x: x0 * MM, y: (lay.SH - y0) * MM }, end: { x: x1 * MM, y: (lay.SH - y1) * MM }, thickness: 0.3, color: rgb(0.6, 0.62, 0.7) }));
        doc.setTitle(`Passfoto ${tpl.label}`);
        const res = await saveResult(await saveDoc(doc), `Passfoto Druckbogen ${stamp}.pdf`);
        resBox.innerHTML = '';
        resBox.appendChild(resultCard(res, { title: 'Druckbogen als PDF', note: `10 × 15 cm · ${count} Fotos` }));
        resBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (err) { errorToast(err, 'Die PDF konnte nicht erstellt werden.'); }
      finally { prog.done(); btn.disabled = false; }
    });
    const back = h(`<button class="btn btn-ghost" type="button">${icon('back')} Zurück zum Ausrichten</button>`);
    back.addEventListener('click', () => { photo.width = 0; if (sheet) sheet.width = 0; showAdjust(); });
    updateFoot(screen, [back], tpl.label);
  }

  const onResize = () => { if (els && document.body.contains(els.frame)) layout(); };
  window.addEventListener('resize', onResize);
  showStart();
  return () => { alive = false; stopCamera(); window.removeEventListener('resize', onResize); if (src) src.width = 0; };
}

/** Draw the template guides into an SVG (viewBox in mm). */
function drawGuides(svg, t, { simple = false } = {}) {
  const NS = 'http://www.w3.org/2000/svg';
  svg.innerHTML = '';
  svg.setAttribute('viewBox', `0 0 ${t.w} ${t.h}`);
  const el = (tag, a) => { const e = document.createElementNS(NS, tag); Object.entries(a).forEach(([k2, v]) => e.setAttribute(k2, v)); svg.appendChild(e); return e; };
  const sw = t.w / 140;
  const crownMid = (t.crown[0] + t.crown[1]) / 2, chinMid = (t.chin[0] + t.chin[1]) / 2;
  const headH = chinMid - crownMid, headW = headH * 0.74;
  if (!simple) {
    el('rect', { x: 0, y: t.eyes[0], width: t.w, height: t.eyes[1] - t.eyes[0], fill: 'rgba(45,212,191,.16)', stroke: 'none' });
    for (const y of t.crown) el('line', { x1: 0, x2: t.w, y1: y, y2: y, stroke: '#4DABF7', 'stroke-width': sw, 'stroke-dasharray': `${sw * 4} ${sw * 3}` });
    for (const y of t.chin) el('line', { x1: 0, x2: t.w, y1: y, y2: y, stroke: '#FFD43B', 'stroke-width': sw, 'stroke-dasharray': `${sw * 4} ${sw * 3}` });
    for (const y of t.eyes) el('line', { x1: 0, x2: t.w, y1: y, y2: y, stroke: '#2DD4BF', 'stroke-width': sw * 0.8 });
    el('line', { x1: t.w / 2, x2: t.w / 2, y1: 0, y2: t.h, stroke: 'rgba(255,255,255,.65)', 'stroke-width': sw * 0.7, 'stroke-dasharray': `${sw * 2} ${sw * 2}` });
  }
  el('ellipse', { cx: t.w / 2, cy: (crownMid + chinMid) / 2, rx: headW / 2, ry: headH / 2, fill: 'none', stroke: simple ? 'rgba(255,255,255,.9)' : 'rgba(255,255,255,.85)', 'stroke-width': sw * (simple ? 1.6 : 1.1) });
  if (simple) el('line', { x1: t.w * 0.3, x2: t.w * 0.7, y1: chinMid, y2: chinMid, stroke: '#FFD43B', 'stroke-width': sw * 1.4 });
}
