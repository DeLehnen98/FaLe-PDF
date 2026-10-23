// Tool: Bild-Werkzeuge — one-tap sharpen, shadow removal, quality enhancement, moiré reduction,
// filters, adjustments, crop / rotate / straighten, resize; save as JPG/PNG/WebP (optionally to a
// target size in KB) or as PDF. Plus "Bilder komprimieren" for many photos at once.
import { icon } from '../icons.js';
import { h, esc, toast, errorToast, progress, pickFiles, formatSize, downloadBlob, openDialog, safeFileName } from '../ui.js';
import { resultCard } from '../components.js';
import { saveResult } from '../library.js';
import { createZip } from '../zip.js';
import { ensureCss, fileResultCard, proBadge, updateFoot, tick } from './common.js';
import { runOp, LOOKS, adjust } from './imgproc.js';
import { assertImageBlob } from '../security.js';

const MAX_WORK = 3200; // working resolution (long side)
const PROXY = 900; // live preview resolution
const FORMATS = { jpg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPG' }, png: { mime: 'image/png', ext: 'png', label: 'PNG' }, webp: { mime: 'image/webp', ext: 'webp', label: 'WebP' } };

const toBlob = (c, type, q) => new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Kodierung fehlgeschlagen'))), type, q));

export async function loadImageToCanvas(file, max = MAX_WORK) {
  await assertImageBlob(file); // dimension bombs are rejected before decoding
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    const url = URL.createObjectURL(file);
    try { bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('img')); i.src = url; }); }
    catch { throw Object.assign(new Error('decode'), { userMessage: 'Das Bild konnte nicht gelesen werden (Format nicht unterstützt?).' }); }
    finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
  }
  const w = bmp.width || bmp.naturalWidth, hh = bmp.height || bmp.naturalHeight;
  const f = Math.min(1, max / Math.max(w, hh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * f)); c.height = Math.max(1, Math.round(hh * f));
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  return c;
}

/** High-quality downscale (stepwise halving). */
export function resizeCanvas(src, w, hh) {
  let cur = src;
  while (cur.width / 2 >= w && cur.height / 2 >= hh) {
    const t = document.createElement('canvas');
    t.width = Math.round(cur.width / 2); t.height = Math.round(cur.height / 2);
    const g = t.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(cur, 0, 0, t.width, t.height);
    if (cur !== src) cur.width = 0;
    cur = t;
  }
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(w)); out.height = Math.max(1, Math.round(hh));
  const g = out.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high'; g.drawImage(cur, 0, 0, out.width, out.height);
  if (cur !== src) cur.width = 0;
  return out;
}

/**
 * Encode a canvas, optionally to a target size: binary search on quality, then shrink.
 * @returns {Promise<{blob: Blob, quality: number, width: number, height: number}>}
 */
export async function encodeCanvas(canvas, { format = 'jpg', quality = 0.85, targetKB = 0, onProgress = null } = {}) {
  const F = FORMATS[format] || FORMATS.jpg;
  let c = canvas;
  if (format === 'jpg') {
    // JPEG has no alpha: flatten on white
    const t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
    const g = t.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, t.width, t.height); g.drawImage(c, 0, 0);
    c = t;
  }
  if (!targetKB) return { blob: await toBlob(c, F.mime, quality), quality, width: c.width, height: c.height };
  const target = targetKB * 1024;
  for (let round = 0; round < 8; round++) {
    if (format === 'png') {
      const b = await toBlob(c, F.mime);
      if (b.size <= target || c.width < 64) return { blob: b, quality: 1, width: c.width, height: c.height };
    } else {
      let lo = 0.3, hi = 0.95, best = null;
      for (let i = 0; i < 7; i++) {
        const q = (lo + hi) / 2;
        const b = await toBlob(c, F.mime, q);
        if (onProgress) onProgress(`Suche passende Qualität … ${Math.round(q * 100)} %`);
        if (b.size <= target) { best = { blob: b, quality: q }; lo = q; } else hi = q;
      }
      if (best) return { ...best, width: c.width, height: c.height };
    }
    // still too large → shrink by 15 %
    const n = resizeCanvas(c, c.width * 0.85, c.height * 0.85);
    if (c !== canvas) c.width = 0;
    c = n;
    if (onProgress) onProgress(`Verkleinere auf ${c.width} × ${c.height} px …`);
  }
  return { blob: await toBlob(c, F.mime, 0.3), quality: 0.3, width: c.width, height: c.height };
}

const imgData = c => c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
function canvasFrom(data) {
  const c = document.createElement('canvas');
  c.width = data.width; c.height = data.height;
  c.getContext('2d', { willReadFrequently: true }).putImageData(data, 0, 0);
  return c;
}

const TOOLS = [
  { id: 'sharpen', label: 'Schärfen', icon: 'sharpen' },
  { id: 'shadow', label: 'Schatten', icon: 'shadow' },
  { id: 'enhance', label: 'Verbessern', icon: 'sparkle' },
  { id: 'moire', label: 'Moiré', icon: 'grid' },
  { id: 'filter', label: 'Filter', icon: 'filter' },
  { id: 'adjust', label: 'Anpassen', icon: 'sliders' },
  { id: 'crop', label: 'Zuschneiden', icon: 'crop' },
  { id: 'size', label: 'Größe', icon: 'resize' },
];

export async function mount(screen, opts = {}) {
  await ensureCss();
  screen.setTitle('Bild-Werkzeuge', 'Fotos und Scans verbessern');
  let file = null, work = null, original = null, proxy = null;
  const undo = [], redo = [];
  let tool = null;
  let alive = true;
  let busy = false;
  let previewCanvas = null; // shown canvas (proxy-size result of the live preview)
  let livePreview = null; // function returning a promise for the current tool's preview

  const undoBtn = h(`<button class="icon-btn" type="button" aria-label="Rückgängig" disabled>${icon('undo')}</button>`);
  const redoBtn = h(`<button class="icon-btn" type="button" aria-label="Wiederholen" disabled>${icon('redo')}</button>`);
  screen.extra.append(undoBtn, redoBtn);

  function showStart() {
    screen.body.innerHTML = '';
    screen.body.style.cssText = '';
    const wrap = h(`<div class="screen-inner pt-narrow">
      <div class="card intro"><span class="tile-ic">${icon('wand')}</span><div><strong>Fotos und Scans verbessern</strong>
        <p>Schärfen, Schatten von Dokumentfotos entfernen, Rauschen mindern, Moiré reduzieren, Filter, zuschneiden, Größe und Format ändern – alles auf deinem Gerät. ${proBadge()}</p></div></div>
      <div class="sc-fallback">
        <button class="btn btn-primary btn-block" type="button" data-cam>${icon('camera')} Foto aufnehmen</button>
        <button class="btn btn-soft btn-block" type="button" data-pick>${icon('gallery')} Bild wählen</button>
      </div>
      <p class="hint" style="text-align:center;margin-top:14px">JPG, PNG, WebP, HEIC (wenn dein Gerät es öffnen kann) · Tipp: Bilder auch per Ziehen &amp; Ablegen</p></div>`);
    screen.body.appendChild(wrap);
    wrap.querySelector('[data-cam]').addEventListener('click', async () => open((await pickFiles({ accept: 'image/*', multiple: false, capture: 'environment' }))[0]));
    wrap.querySelector('[data-pick]').addEventListener('click', async () => open((await pickFiles({ accept: 'image/*', multiple: false }))[0]));
    updateFoot(screen, []);
  }
  screen.onDropFiles = files => { const f = files.find(x => /^image\//.test(x.type)); if (f) open(f); };

  async function open(f) {
    if (!f) return;
    const prog = progress('Bild wird geladen …');
    try {
      const c = await loadImageToCanvas(f);
      file = f;
      work = c;
      // preview and „Vorher“ come straight from the file, decoded and scaled by the browser off the main thread
      // (copying the 3200 px working canvas froze the page for about a second on phones)
      if (original && original.close) original.close();
      original = null;
      undo.length = redo.length = 0;
      await makeProxyAsync(f);
      const of = f, pf = Math.min(1, 1600 / Math.max(c.width, c.height));
      createImageBitmap(f, { imageOrientation: 'from-image', resizeWidth: Math.max(1, Math.round(c.width * pf)), resizeHeight: Math.max(1, Math.round(c.height * pf)), resizeQuality: 'high' })
        .then(b => { if (file === of) original = b; else b.close(); })
        .catch(() => { if (file === of && work) try { original = imgData(work); } catch { /* no „Vorher“ */ } });
      showEditor();
    } catch (e) { errorToast(e, 'Das Bild konnte nicht geöffnet werden.'); }
    finally { prog.done(); }
  }
  function makeProxy() {
    const f = Math.min(1, PROXY / Math.max(work.width, work.height));
    if (proxy) proxy.width = 0;
    proxy = resizeCanvas(work, work.width * f, work.height * f);
  }
  // same, but scaled by the browser off the main thread (opening a big photo froze the page for a moment)
  async function makeProxyAsync(fromFile) {
    const f = Math.min(1, PROXY / Math.max(work.width, work.height));
    const w = Math.max(1, Math.round(work.width * f)), hh = Math.max(1, Math.round(work.height * f));
    let bmp = null;
    try { bmp = await createImageBitmap(fromFile || work, { imageOrientation: 'from-image', resizeWidth: w, resizeHeight: hh, resizeQuality: 'high' }); } catch { bmp = null; }
    if (!bmp) { makeProxy(); return; }
    if (proxy) proxy.width = 0;
    proxy = document.createElement('canvas');
    proxy.width = w; proxy.height = hh;
    proxy.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0);
    bmp.close();
  }

  // ---------- editor ----------
  let els = null;
  function showEditor() {
    screen.body.innerHTML = '';
    screen.body.style.cssText = 'display:flex;flex-direction:column;overflow:hidden';
    const root = h(`<div class="it">
      <div class="it-stage" data-stage>
        <div class="it-canvas-wrap" data-cw></div>
        <button class="it-before" type="button" data-before aria-label="Vorher anzeigen (gedrückt halten)">${icon('eye')}<span>Vorher</span></button>
        <div class="it-busy" data-busy hidden><span class="spinner"></span><span data-busytext>Wird berechnet …</span></div>
      </div>
      <div class="pt-toolbar it-tools" role="toolbar" aria-label="Werkzeuge">${TOOLS.map(t => `<button class="pt-tool" type="button" data-tool="${t.id}" aria-pressed="false">${icon(t.icon)}<span>${t.label}</span></button>`).join('')}</div>
      <div class="it-panel" data-panel></div>
    </div>`);
    screen.body.appendChild(root);
    els = { root, cw: root.querySelector('[data-cw]'), panel: root.querySelector('[data-panel]'), busy: root.querySelector('[data-busy]'), stage: root.querySelector('[data-stage]') };
    root.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => selectTool(tool === b.dataset.tool ? null : b.dataset.tool)));
    const before = root.querySelector('[data-before]');
    const showOrig = on => {
      const c = els.cw.querySelector('canvas');
      if (!c) return;
      if (on && !original) return;
      if (on) { const o = original instanceof ImageData ? canvasFrom(original) : original; const p = resizeCanvas(o, c.width, c.height); if (o !== original) o.width = 0; c._saved = c.getContext('2d').getImageData(0, 0, c.width, c.height); c.getContext('2d').drawImage(p, 0, 0); p.width = 0; }
      else if (c._saved) { c.getContext('2d').putImageData(c._saved, 0, 0); c._saved = null; }
      before.classList.toggle('on', on);
    };
    before.addEventListener('pointerdown', e => { e.preventDefault(); showOrig(true); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => before.addEventListener(ev, () => showOrig(false)));
    selectTool(null);
    showCanvas(proxy);
    ro.disconnect(); ro.observe(els.cw);
    const saveImg = h(`<button class="btn btn-ghost" type="button">${icon('download')} Bild</button>`);
    const savePdf = h(`<button class="btn btn-primary" type="button">${icon('file')} Als PDF</button>`);
    const other = h(`<button class="icon-btn" type="button" aria-label="Anderes Bild öffnen" title="Anderes Bild">${icon('gallery')}</button>`);
    saveImg.addEventListener('click', exportImage);
    savePdf.addEventListener('click', exportPdf);
    other.addEventListener('click', async () => open((await pickFiles({ accept: 'image/*', multiple: false }))[0]));
    updateFoot(screen, [other, saveImg, savePdf], `${work.width} × ${work.height} px`);
  }

  function showCanvas(c) {
    if (!els) return;
    const d = document.createElement('canvas');
    d.width = c.width; d.height = c.height;
    d.getContext('2d').drawImage(c, 0, 0);
    d.className = 'it-canvas';
    if (previewCanvas) previewCanvas.width = 0;
    previewCanvas = d;
    els.cw.innerHTML = '';
    els.cw.appendChild(d);
    if (tool === 'crop') setupCrop();
  }
  function setBusy(on, text = 'Wird berechnet …') {
    busy = on;
    if (!els) return;
    els.busy.hidden = !on;
    els.busy.querySelector('[data-busytext]').textContent = text;
  }

  function pushUndo() {
    undo.push(imgData(work));
    if (undo.length > 4) undo.shift();
    redo.length = 0;
    syncUndo();
  }
  function syncUndo() { undoBtn.disabled = !undo.length || busy; redoBtn.disabled = !redo.length || busy; }
  function replaceWork(c) {
    if (work && work !== c) work.width = 0;
    work = c;
    makeProxy();
    showCanvas(proxy);
    updateFoot(screen, Array.from(screen.foot.querySelectorAll('button')), `${work.width} × ${work.height} px`);
  }
  undoBtn.addEventListener('click', () => { if (!undo.length || busy) return; redo.push(imgData(work)); replaceWork(canvasFrom(undo.pop())); syncUndo(); selectTool(tool); });
  redoBtn.addEventListener('click', () => { if (!redo.length || busy) return; undo.push(imgData(work)); replaceWork(canvasFrom(redo.pop())); syncUndo(); selectTool(tool); });

  /** Run an op on the proxy (preview) or on the full image (apply). */
  async function runOn(c, op, params, label) {
    // radius-type parameters are given for a ~1200 px image and scale with the resolution
    params = { ...params, scale: Math.max(c.width, c.height) / 1200 };
    const r = await runOp(op, imgData(c), params, p => { if (label) setBusy(true, `${label} … ${Math.round(p * 100)} %`); });
    return canvasFrom(r);
  }

  let previewSeq = 0;
  async function preview(op, params) {
    const my = ++previewSeq;
    setBusy(true, 'Vorschau …');
    try {
      const c = await runOn(proxy, op, params);
      if (my !== previewSeq || !alive) { c.width = 0; return; }
      showCanvas(c);
      c.width = 0;
    } catch (e) { errorToast(e, 'Vorschau fehlgeschlagen.'); }
    finally { if (my === previewSeq) setBusy(false); }
  }
  async function applyFull(op, params, label) {
    if (busy) return;
    setBusy(true, `${label} …`);
    syncUndo();
    try {
      pushUndo();
      const c = await runOn(work, op, params, label);
      replaceWork(c);
      toast(`${label}: angewendet.`, 'success', { timeout: 1800 });
      selectTool(null);
    } catch (e) { undo.pop(); errorToast(e, 'Das hat nicht geklappt.'); }
    finally { setBusy(false); syncUndo(); }
  }

  function selectTool(t) {
    tool = t;
    if (!els) return;
    els.root.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
    const P = els.panel;
    P.innerHTML = '';
    livePreview = null;
    if (!t) { P.innerHTML = '<p class="pt-hint it-hint">Wähle ein Werkzeug. „Vorher“ gedrückt halten zeigt das Original.</p>'; showCanvas(proxy); return; }
    const slider = (name, label, min, max, step, val) => `<label class="pt-range it-range"><span>${label}</span><input type="range" name="${name}" min="${min}" max="${max}" step="${step}" value="${val}"><b data-v="${name}">${val}</b></label>`;
    const applyRow = (label) => `<div class="it-row"><button class="btn btn-ghost btn-sm" type="button" data-cancel>${icon('close')} Abbrechen</button><button class="btn btn-primary btn-sm" type="button" data-apply>${icon('check')} ${label}</button></div>`;
    const simple = (op, title, info, sliders, toParams) => {
      P.innerHTML = `<div class="it-opts"><p class="it-info"><b>${title}</b> ${info}</p><div class="it-sliders">${sliders}</div>${applyRow('Anwenden')}</div>`;
      const read = () => { const o = {}; P.querySelectorAll('input[type=range]').forEach(i => { o[i.name] = +i.value; P.querySelector(`[data-v="${i.name}"]`).textContent = i.value; }); return toParams(o); };
      let t2 = null;
      const run = () => { clearTimeout(t2); t2 = setTimeout(() => preview(op, read()), 160); };
      P.addEventListener('input', run);
      P.querySelector('[data-apply]').addEventListener('click', () => applyFull(op, read(), title));
      P.querySelector('[data-cancel]').addEventListener('click', () => selectTool(null));
      run();
    };
    if (t === 'sharpen') simple('sharpen', 'Ein-Klick-Schärfe', 'macht weiche Fotos und Texte knackiger (Unschärfemaske).', slider('a', 'Stärke', 0.2, 3, 0.1, 1.5) + slider('r', 'Radius', 0.6, 4, 0.1, 2), o => ({ amount: o.a, radius: o.r, threshold: 2 }));
    else if (t === 'shadow') simple('removeShadows', 'Schatten entfernen', 'gleicht ungleichmäßiges Licht auf Dokumentfotos aus – das Papier wird gleichmäßig hell.', slider('s', 'Stärke', 0.3, 1, 0.05, 1), o => ({ strength: o.s }));
    else if (t === 'enhance') simple('enhance', 'Bildqualität verbessern', 'reduziert Rauschen, optimiert Kontrast und schärft nach.', slider('s', 'Stärke', 0.4, 1.6, 0.1, 1), o => ({ strength: o.s }));
    else if (t === 'moire') simple('reduceMoire', 'Moiré reduzieren', 'mildert Streifen- und Rastermuster (z. B. bei abfotografierten Bildschirmen). Muster werden abgeschwächt, nicht immer ganz entfernt.', slider('s', 'Stärke', 0.4, 2, 0.1, 1), o => ({ strength: o.s }));
    else if (t === 'adjust') {
      P.innerHTML = `<div class="it-opts"><div class="it-sliders">${slider('brightness', 'Helligkeit', -60, 60, 1, 0)}${slider('contrast', 'Kontrast', -60, 60, 1, 0)}${slider('saturation', 'Sättigung', -100, 80, 1, 0)}${slider('warmth', 'Wärme', -60, 60, 1, 0)}</div>${applyRow('Anwenden')}</div>`;
      const read = () => { const o = {}; P.querySelectorAll('input[type=range]').forEach(i => { o[i.name] = +i.value; P.querySelector(`[data-v="${i.name}"]`).textContent = i.value; }); return o; };
      P.addEventListener('input', () => {
        const d = adjust(imgData(proxy), read());
        showCanvas(canvasFrom(new ImageData(d.data, d.width, d.height)));
      });
      P.querySelector('[data-apply]').addEventListener('click', () => applyFull('adjust', read(), 'Anpassen'));
      P.querySelector('[data-cancel]').addEventListener('click', () => selectTool(null));
    } else if (t === 'filter') {
      P.innerHTML = `<div class="it-opts"><div class="sc-filters it-looks" role="radiogroup" aria-label="Filter">${LOOKS.map(l => `<button type="button" class="sc-filter" role="radio" data-look="${l.id}" aria-checked="${l.id === 'original'}"><span class="sc-fthumb"><img alt=""></span><span>${l.label}</span></button>`).join('')}</div>${applyRow('Filter anwenden')}</div>`;
      let cur = 'original';
      (async () => {
        const f = Math.min(1, 120 / Math.max(proxy.width, proxy.height));
        const small = resizeCanvas(proxy, proxy.width * f, proxy.height * f);
        for (const l of LOOKS) {
          if (!alive || tool !== 'filter') break;
          const r = await runOn(small, 'look', { id: l.id });
          const img = P.querySelector(`[data-look="${l.id}"] img`);
          if (img) img.src = r.toDataURL('image/jpeg', 0.8);
          r.width = 0;
        }
        small.width = 0;
      })();
      P.querySelectorAll('[data-look]').forEach(b => b.addEventListener('click', () => {
        cur = b.dataset.look;
        P.querySelectorAll('[data-look]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
        preview('look', { id: cur });
      }));
      P.querySelector('[data-apply]').addEventListener('click', () => { if (cur === 'original') { selectTool(null); return; } applyFull('look', { id: cur }, `Filter „${LOOKS.find(l => l.id === cur).label}“`); });
      P.querySelector('[data-cancel]').addEventListener('click', () => selectTool(null));
    } else if (t === 'crop') {
      cropState = { x0: 0, y0: 0, x1: 1, y1: 1, angle: 0, ratio: 0 };
      P.innerHTML = `<div class="it-opts">
        <div class="it-row it-wrap"><div class="seg" role="group" aria-label="Seitenverhältnis">${[['0', 'Frei'], ['1', '1:1'], ['1.3333', '4:3'], ['1.5', '3:2'], ['1.7778', '16:9'], ['0.7071', 'A4']].map(([v, l]) => `<button type="button" data-ratio="${v}" aria-pressed="${v === '0'}">${l}</button>`).join('')}</div></div>
        <label class="pt-range it-range"><span>Begradigen</span><input type="range" name="angle" min="-15" max="15" step="0.5" value="0"><b data-v="angle">0°</b></label>
        <div class="it-row"><button class="btn btn-ghost btn-sm" type="button" data-rot="-90">${icon('rotateLeft')} Links</button><button class="btn btn-ghost btn-sm" type="button" data-rot="90">${icon('rotate')} Rechts</button><button class="btn btn-ghost btn-sm" type="button" data-flip>${icon('compare')} Spiegeln</button></div>
        ${applyRow('Zuschnitt anwenden')}</div>`;
      P.querySelectorAll('[data-ratio]').forEach(b => b.addEventListener('click', () => {
        P.querySelectorAll('[data-ratio]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        cropState.ratio = +b.dataset.ratio;
        fitRatio(); drawCrop();
      }));
      P.querySelector('[name=angle]').addEventListener('input', e => { cropState.angle = +e.target.value; P.querySelector('[data-v=angle]').textContent = `${e.target.value}°`; showStraightened(); });
      P.querySelectorAll('[data-rot]').forEach(b => b.addEventListener('click', () => transformFull(c => rotate90(c, +b.dataset.rot), 'Drehen')));
      P.querySelector('[data-flip]').addEventListener('click', () => transformFull(flipH, 'Spiegeln'));
      P.querySelector('[data-apply]').addEventListener('click', applyCrop);
      P.querySelector('[data-cancel]').addEventListener('click', () => selectTool(null));
      showCanvas(proxy);
    } else if (t === 'size') {
      const W = work.width, H = work.height;
      P.innerHTML = `<div class="it-opts"><div class="it-row it-wrap">
        <label class="field it-num"><span class="field-label">Breite (px)</span><input class="input" type="number" name="w" min="16" max="${W}" value="${W}"></label>
        <label class="field it-num"><span class="field-label">Höhe (px)</span><input class="input" type="number" name="h" min="16" max="${H}" value="${H}"></label>
        <div class="it-chips">${[75, 50, 33, 25].map(p => `<button type="button" class="pt-chip" data-pct="${p}">${p} %</button>`).join('')}</div></div>
        <p class="hint">Nur Verkleinern (Vergrößern bringt keine Details). Format und Dateigröße wählst du beim Speichern.</p>${applyRow('Größe ändern')}</div>`;
      const wI = P.querySelector('[name=w]'), hI = P.querySelector('[name=h]');
      wI.addEventListener('input', () => { hI.value = Math.max(1, Math.round(+wI.value * H / W)); });
      hI.addEventListener('input', () => { wI.value = Math.max(1, Math.round(+hI.value * W / H)); });
      P.querySelectorAll('[data-pct]').forEach(b => b.addEventListener('click', () => { wI.value = Math.round(W * b.dataset.pct / 100); hI.value = Math.round(H * b.dataset.pct / 100); }));
      P.querySelector('[data-apply]').addEventListener('click', () => {
        const nw = Math.max(16, Math.min(W, +wI.value || W)), nh = Math.max(16, Math.round(nw * H / W));
        if (nw >= W) { toast('Das Bild hat bereits diese Größe.', 'info'); return; }
        transformFull(c => resizeCanvas(c, nw, nh), 'Größe ändern');
      });
      P.querySelector('[data-cancel]').addEventListener('click', () => selectTool(null));
    }
  }

  // ---------- crop / rotate ----------
  let cropState = null;
  function transformFull(fn, label) {
    if (busy) return;
    pushUndo();
    const c = fn(work);
    replaceWork(c);
    toast(`${label}: angewendet.`, 'success', { timeout: 1500 });
    selectTool(tool);
  }
  function rotate90(c, deg) {
    const o = document.createElement('canvas');
    o.width = c.height; o.height = c.width;
    const g = o.getContext('2d', { willReadFrequently: true });
    g.translate(o.width / 2, o.height / 2); g.rotate(deg * Math.PI / 180); g.drawImage(c, -c.width / 2, -c.height / 2);
    return o;
  }
  function flipH(c) {
    const o = document.createElement('canvas');
    o.width = c.width; o.height = c.height;
    const g = o.getContext('2d', { willReadFrequently: true });
    g.translate(o.width, 0); g.scale(-1, 1); g.drawImage(c, 0, 0);
    return o;
  }
  /** Rotate by a small angle and crop to the largest axis-aligned rectangle without empty corners. */
  function straighten(c, angle) {
    if (!angle) return c;
    const a = Math.abs(angle) * Math.PI / 180;
    const W = c.width, H = c.height;
    const cos = Math.cos(a), sin = Math.sin(a);
    // largest inscribed rectangle with the same aspect ratio
    const s = Math.min(W / (W * cos + H * sin), H / (W * sin + H * cos));
    const ow = Math.round(W * s), oh = Math.round(H * s);
    const o = document.createElement('canvas');
    o.width = ow; o.height = oh;
    const g = o.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    g.translate(ow / 2, oh / 2); g.rotate(angle * Math.PI / 180); g.drawImage(c, -W / 2, -H / 2);
    return o;
  }
  function showStraightened() {
    const c = straighten(proxy, cropState.angle);
    showCanvas(c);
    if (c !== proxy) c.width = 0;
  }
  function fitRatio() {
    const r = cropState.ratio;
    const c = els.cw.querySelector('canvas');
    if (!r || !c) return;
    const W = c.width, H = c.height;
    let w = W, hh = W / r;
    if (hh > H) { hh = H; w = H * r; }
    const fx = w / W, fy = hh / H;
    cropState.x0 = (1 - fx) / 2; cropState.x1 = cropState.x0 + fx;
    cropState.y0 = (1 - fy) / 2; cropState.y1 = cropState.y0 + fy;
  }
  function setupCrop() {
    const c = els.cw.querySelector('canvas');
    if (!c || !cropState) return;
    els.cw.querySelectorAll('.it-crop').forEach(x => x.remove());
    const box = h(`<div class="it-crop"><div class="cr-dim" data-dim="t"></div><div class="cr-dim" data-dim="b"></div><div class="cr-dim" data-dim="l"></div><div class="cr-dim" data-dim="r"></div>
      <div class="cr-box" data-box>${['nw', 'ne', 'se', 'sw'].map(k => `<span class="cr-h cr-${k}" data-h="${k}"></span>`).join('')}<span class="it-thirds"></span></div></div>`);
    els.cw.appendChild(box);
    drawCrop();
    const b = box.querySelector('[data-box]');
    let g = null;
    b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); g = { k: e.target.dataset.h || 'move', x: e.clientX, y: e.clientY, o: { ...cropState } }; });
    b.addEventListener('pointermove', e => {
      if (!g) return;
      const r = c.getBoundingClientRect();
      const dx = (e.clientX - g.x) / r.width, dy = (e.clientY - g.y) / r.height;
      const o = g.o, cs = cropState, min = 0.05;
      if (g.k === 'move') {
        const ddx = Math.max(-o.x0, Math.min(1 - o.x1, dx)), ddy = Math.max(-o.y0, Math.min(1 - o.y1, dy));
        cs.x0 = o.x0 + ddx; cs.x1 = o.x1 + ddx; cs.y0 = o.y0 + ddy; cs.y1 = o.y1 + ddy;
      } else {
        if (g.k.includes('w')) cs.x0 = Math.max(0, Math.min(o.x1 - min, o.x0 + dx));
        if (g.k.includes('e')) cs.x1 = Math.min(1, Math.max(o.x0 + min, o.x1 + dx));
        if (g.k.includes('n')) cs.y0 = Math.max(0, Math.min(o.y1 - min, o.y0 + dy));
        if (g.k.includes('s')) cs.y1 = Math.min(1, Math.max(o.y0 + min, o.y1 + dy));
        if (cs.ratio) {
          // keep the aspect ratio: adjust height from width
          const W = c.width, H = c.height;
          const wpx = (cs.x1 - cs.x0) * W;
          let hpx = wpx / cs.ratio;
          if (g.k.includes('n')) cs.y0 = Math.max(0, cs.y1 - hpx / H); else cs.y1 = Math.min(1, cs.y0 + hpx / H);
          hpx = (cs.y1 - cs.y0) * H;
          const wFix = hpx * cs.ratio / W;
          if (g.k.includes('w')) cs.x0 = cs.x1 - wFix; else cs.x1 = cs.x0 + wFix;
        }
      }
      drawCrop();
    });
    const end = () => { g = null; };
    b.addEventListener('pointerup', end);
    b.addEventListener('pointercancel', end);
  }
  function drawCrop() {
    const box = els && els.cw.querySelector('.it-crop');
    const c = els && els.cw.querySelector('canvas');
    if (!box || !c) return;
    const r = c.getBoundingClientRect(), pr = els.cw.getBoundingClientRect();
    Object.assign(box.style, { left: `${r.left - pr.left}px`, top: `${r.top - pr.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const W = r.width, H = r.height, cs = cropState;
    const L = cs.x0 * W, T = cs.y0 * H, R = cs.x1 * W, B = cs.y1 * H;
    Object.assign(box.querySelector('[data-box]').style, { left: `${L}px`, top: `${T}px`, width: `${R - L}px`, height: `${B - T}px` });
    const dims = { t: [0, 0, W, T], b: [0, B, W, H - B], l: [0, T, L, B - T], r: [R, T, W - R, B - T] };
    box.querySelectorAll('[data-dim]').forEach(d => { const [x, y, w, hh] = dims[d.dataset.dim]; Object.assign(d.style, { left: `${x}px`, top: `${y}px`, width: `${Math.max(0, w)}px`, height: `${Math.max(0, hh)}px` }); });
  }
  function applyCrop() {
    const cs = cropState;
    if (!cs.angle && cs.x0 < 0.002 && cs.y0 < 0.002 && cs.x1 > 0.998 && cs.y1 > 0.998) { toast('Nichts zu tun – ziehe den Rahmen oder drehe das Bild.', 'info'); return; }
    transformFull(c => {
      const s = straighten(c, cs.angle);
      const x = Math.round(cs.x0 * s.width), y = Math.round(cs.y0 * s.height);
      const w = Math.max(8, Math.round((cs.x1 - cs.x0) * s.width)), hh = Math.max(8, Math.round((cs.y1 - cs.y0) * s.height));
      const o = document.createElement('canvas');
      o.width = w; o.height = hh;
      o.getContext('2d', { willReadFrequently: true }).drawImage(s, x, y, w, hh, 0, 0, w, hh);
      if (s !== c) s.width = 0;
      return o;
    }, 'Zuschneiden');
  }
  const ro = new ResizeObserver(() => drawCrop());

  // ---------- export ----------
  const baseNameOf = () => safeFileName((file && file.name ? file.name.replace(/\.[^.]+$/, '') : 'Bild') + ' (bearbeitet)');
  async function exportImage() {
    const r = await openDialog({
      title: 'Bild speichern',
      body: `<div class="field"><span class="field-label">Format</span><div class="seg pt-seg-full" role="group">${Object.entries(FORMATS).map(([k, f]) => `<button type="button" data-fmt="${k}" aria-pressed="${k === 'jpg'}">${f.label}</button>`).join('')}</div></div>
        <label class="field" data-qf><span class="field-label">Qualität: <b data-qv>88</b> %</span><input type="range" name="q" min="40" max="100" value="88"></label>
        <label class="field" data-tf><span class="field-label">Zielgröße in KB (optional)</span><input class="input" type="number" name="kb" min="10" placeholder="z. B. 500" inputmode="numeric"></label>
        <label class="check"><input type="checkbox" name="lib"><span>Auch in „Dateien“ speichern</span></label>
        <p class="hint">${work.width} × ${work.height} px. PNG ist verlustfrei (größer), WebP ist am kleinsten.</p>`,
      actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Speichern', value: 'ok', kind: 'btn-primary', default: true }],
      onMount: dlg => {
        let fmt = 'jpg';
        dlg.querySelectorAll('[data-fmt]').forEach(b => b.addEventListener('click', () => {
          fmt = b.dataset.fmt;
          dlg.querySelectorAll('[data-fmt]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
          dlg.querySelector('[data-qf]').hidden = fmt === 'png';
        }));
        dlg.querySelector('[name=q]').addEventListener('input', e => { dlg.querySelector('[data-qv]').textContent = e.target.value; });
        return { collect: () => ({ fmt, q: +dlg.querySelector('[name=q]').value / 100, kb: +dlg.querySelector('[name=kb]').value || 0, lib: dlg.querySelector('[name=lib]').checked }) };
      },
    });
    if (r.value !== 'ok' || !r.data) return;
    const prog = progress('Bild wird gespeichert …');
    try {
      const enc = await encodeCanvas(work, { format: r.data.fmt, quality: r.data.q, targetKB: r.data.kb, onProgress: t => prog.set(t) });
      const name = `${baseNameOf()}.${FORMATS[r.data.fmt].ext}`;
      if (r.data.lib) {
        const { importAny } = await import('../library.js');
        await importAny(new File([enc.blob], name, { type: enc.blob.type }), { source: 'Erstellt', silent: true });
      }
      showResult(fileResultCard(enc.blob, name, { title: 'Bild gespeichert', iconName: 'image', note: `${enc.width} × ${enc.height} px${r.data.kb ? ` · Qualität ${Math.round(enc.quality * 100)} %` : ''}`, type: enc.blob.type }));
      downloadBlob(enc.blob, name);
      if (r.data.kb && enc.blob.size > r.data.kb * 1024) toast(`Die Zielgröße wurde nicht ganz erreicht (${formatSize(enc.blob.size)}).`, 'info', { timeout: 5000 });
    } catch (e) { errorToast(e, 'Das Bild konnte nicht gespeichert werden.'); }
    finally { prog.done(); }
  }
  async function exportPdf() {
    const prog = progress('Erstelle PDF …');
    try {
      const enc = await encodeCanvas(work, { format: 'jpg', quality: 0.9 });
      const { imagesToPdf } = await import('./images.js');
      const f = new File([enc.blob], `${baseNameOf()}.jpg`, { type: 'image/jpeg' });
      const { bytes } = await imagesToPdf([f], { pageSize: 'a4', title: baseNameOf() });
      const res = await saveResult(bytes, `${baseNameOf()}.pdf`);
      showResult(resultCard(res, { title: 'PDF erstellt' }));
      toast('PDF gespeichert.', 'success');
    } catch (e) { errorToast(e, 'Die PDF konnte nicht erstellt werden.'); }
    finally { prog.done(); }
  }
  function showResult(card) {
    if (!els) return;
    els.root.querySelectorAll('.it-result').forEach(x => x.remove());
    const w = h('<div class="it-result"></div>');
    const close = h(`<button class="icon-btn pt-result-x" type="button" aria-label="Schließen">${icon('close')}</button>`);
    close.addEventListener('click', () => w.remove());
    card.appendChild(close);
    w.appendChild(card);
    els.stage.appendChild(w);
  }

  if (opts.file) await open(opts.file); else showStart();
  return () => { alive = false; ro.disconnect(); if (work) work.width = 0; if (proxy) proxy.width = 0; };
}

// ======================================================================= Bilder komprimieren
export async function mountCompress(screen) {
  await ensureCss();
  screen.setTitle('Bilder komprimieren', 'Fotos verkleinern – auf deinem Gerät');
  let items = [];
  let fmt = 'jpg';
  const wrap = h(`<div class="screen-inner">
    <div class="card intro"><span class="tile-ic">${icon('compress')}</span><div><strong>Fotos kleiner machen</strong>
      <p>Ideal für E-Mail, Bewerbungsportale und Formulare mit Größenlimit. Wähle eine Zielgröße – FaLe PDF sucht die beste Qualität, die passt.</p></div></div>
    <div class="toolbar"><button class="btn btn-soft" type="button" data-pick>${icon('gallery')} Bilder wählen</button><span class="grow"></span><span class="muted small" data-sum></span></div>
    <div class="img-grid" data-grid></div>
    <div class="card card-pad ic-settings">
      <div class="field"><span class="field-label">Format</span><div class="seg pt-seg-full" role="group">${Object.entries(FORMATS).map(([k, f]) => `<button type="button" data-fmt="${k}" aria-pressed="${k === 'jpg'}">${f.label}</button>`).join('')}</div></div>
      <div class="pt-two">
        <label class="field"><span class="field-label">Maximale Kantenlänge</span><select class="select" name="max"><option value="0">Original</option><option value="3000">3000 px</option><option value="2048" selected>2048 px</option><option value="1600">1600 px</option><option value="1280">1280 px</option><option value="1024">1024 px</option></select></label>
        <label class="field"><span class="field-label">Zielgröße je Bild (KB, optional)</span><input class="input" type="number" name="kb" min="10" placeholder="z. B. 300" inputmode="numeric"></label>
      </div>
      <label class="field" data-qf><span class="field-label">Qualität: <b data-qv>78</b> %</span><input type="range" name="q" min="30" max="95" value="78"></label>
      <label class="check"><input type="checkbox" name="lib"><span>Ergebnisse auch in „Dateien“ speichern</span></label>
    </div>
    <div data-result></div></div>`);
  screen.body.appendChild(wrap);
  const grid = wrap.querySelector('[data-grid]');
  const resultBox = wrap.querySelector('[data-result]');
  const runBtn = h(`<button class="btn btn-primary" type="button">${icon('compress')} Komprimieren</button>`);
  const add = files => {
    files.filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(f.name)).forEach(f => items.push({ file: f, url: URL.createObjectURL(f), out: null }));
    render();
  };
  wrap.querySelector('[data-pick]').addEventListener('click', async () => add(await pickFiles({ accept: 'image/*', multiple: true })));
  screen.onDropFiles = files => add(files);
  wrap.querySelectorAll('[data-fmt]').forEach(b => b.addEventListener('click', () => {
    fmt = b.dataset.fmt;
    wrap.querySelectorAll('[data-fmt]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    wrap.querySelector('[data-qf]').hidden = fmt === 'png';
  }));
  const qIn = wrap.querySelector('[name=q]');
  qIn.addEventListener('input', () => { wrap.querySelector('[data-qv]').textContent = qIn.value; });

  function render() {
    grid.innerHTML = '';
    if (!items.length) grid.appendChild(h(`<div class="empty" style="grid-column:1/-1"><div class="empty-art">${icon('image')}</div><h3>Noch keine Bilder</h3><p>Wähle Fotos aus oder ziehe sie hierher.</p></div>`));
    items.forEach((it, i) => {
      const card = h(`<div class="img-card"><div class="img-box"><img src="${it.url}" alt="${esc(it.file.name)}"></div>
        <div class="pcard-foot"><span class="ic-size">${formatSize(it.file.size)}${it.out ? ` → <b>${formatSize(it.out.size)}</b>` : ''}</span>
        <span class="pcard-actions"><button class="icon-btn" type="button" data-x aria-label="Entfernen">${icon('close')}</button></span></div></div>`);
      card.querySelector('[data-x]').addEventListener('click', () => { URL.revokeObjectURL(it.url); items.splice(i, 1); render(); });
      grid.appendChild(card);
    });
    const total = items.reduce((s, it) => s + it.file.size, 0);
    wrap.querySelector('[data-sum]').textContent = items.length ? `${items.length} Bild${items.length === 1 ? '' : 'er'} · ${formatSize(total)}` : '';
    runBtn.disabled = !items.length;
    updateFoot(screen, [runBtn], items.length ? `${items.length} Bild${items.length === 1 ? '' : 'er'}` : 'Keine Bilder gewählt');
  }

  runBtn.addEventListener('click', async () => {
    if (!items.length) return;
    runBtn.disabled = true;
    const prog = progress('Komprimiere …');
    const maxSide = +wrap.querySelector('[name=max]').value;
    const kb = +wrap.querySelector('[name=kb]').value || 0;
    const q = +qIn.value / 100;
    const lib = wrap.querySelector('[name=lib]').checked;
    const files = [];
    let before = 0, after = 0;
    try {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        prog.set(`Bild ${i + 1} von ${items.length} …`);
        try {
          let c = await loadImageToCanvas(it.file, maxSide || 12000);
          const enc = await encodeCanvas(c, { format: fmt, quality: q, targetKB: kb });
          c.width = 0;
          // never make a file bigger than the original (same format, no resize)
          const sameType = it.file.type === FORMATS[fmt].mime;
          const blob = sameType && !maxSide && enc.blob.size >= it.file.size ? it.file : enc.blob;
          it.out = blob;
          const name = `${safeFileName(it.file.name.replace(/\.[^.]+$/, ''))}.${FORMATS[fmt].ext}`;
          files.push({ name, data: blob });
          before += it.file.size; after += blob.size;
          if (lib) { const { importAny } = await import('../library.js'); await importAny(new File([blob], name, { type: blob.type || FORMATS[fmt].mime }), { source: 'Erstellt', silent: true }); }
        } catch (e) { console.warn(e); toast(`„${it.file.name}“ konnte nicht verarbeitet werden.`, 'error'); }
        await tick();
      }
      render();
      resultBox.innerHTML = '';
      if (files.length === 1) resultBox.appendChild(fileResultCard(files[0].data, files[0].name, { title: 'Komprimiert', iconName: 'image', note: `${formatSize(before)} → ${formatSize(after)}`, type: files[0].data.type }));
      else if (files.length) {
        // dedupe names inside the ZIP
        const seen = new Map();
        files.forEach(f => { const n = seen.get(f.name) || 0; seen.set(f.name, n + 1); if (n) f.name = f.name.replace(/(\.[^.]+)$/, ` (${n + 1})$1`); });
        const zip = await createZip(files);
        resultBox.appendChild(fileResultCard(zip, 'Bilder (komprimiert).zip', { title: `${files.length} Bilder komprimiert`, iconName: 'compress', note: `${formatSize(before)} → ${formatSize(after)} (−${Math.max(0, Math.round((1 - after / before) * 100))} %)`, type: 'application/zip' }));
      }
      resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) { errorToast(e, 'Komprimieren fehlgeschlagen.'); }
    finally { prog.done(); runBtn.disabled = !items.length; }
  });
  render();
  return () => items.forEach(it => URL.revokeObjectURL(it.url));
}
