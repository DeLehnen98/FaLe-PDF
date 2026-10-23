// Tool: images (JPG/PNG/…) → PDF, including camera capture on phones.
import { icon } from '../icons.js';
import { h, esc, toast, errorToast, progress, pickFiles, formatSize } from '../ui.js';
import { resultCard, enableDragReorder, moveItem } from '../components.js';
import { saveResult } from '../library.js';
import { loadPdfLib, saveDoc } from '../pdflib.js';
import { handoff } from './index.js';
import { assertImageBlob } from '../security.js';

const A4 = [595.28, 841.89];
const MAX_DIM = 3000;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Bild konnte nicht gelesen werden'));
    img.src = url;
  });
}

// ---- photos are decoded, scaled and encoded in a worker (js/tools/imgprep-worker.js): a 12–50 MP phone photo
// blocked the app for seconds on the main thread. One photo at a time (memory on phones); main thread as fallback.
let worker = null, seq = 0, chain = Promise.resolve();
const waiting = new Map();
function prepWorker() {
  if (worker !== null) return worker;
  try {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function') return (worker = false);
    worker = new Worker(new URL('./imgprep-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => { const r = waiting.get(e.data && e.data.id); if (r) { waiting.delete(e.data.id); r(e.data); } };
    worker.onerror = () => { const w = worker; worker = false; try { w.terminate(); } catch { /* gone */ } waiting.forEach(r => r({ ok: false, error: 'worker' })); waiting.clear(); };
  } catch { worker = false; }
  return worker;
}
/** → { bytes: Uint8Array, w, h } (JPEG, longest side ≤ maxDim) or null when the worker can't do it */
export function prepInWorker(file, maxDim = MAX_DIM, quality = 0.9) {
  const run = () => new Promise(resolve => {
    const w = prepWorker();
    if (!w) { resolve(null); return; }
    const id = ++seq;
    const t = setTimeout(() => { if (waiting.delete(id)) resolve(null); }, 90000); // never hang: main thread takes over
    waiting.set(id, r => { clearTimeout(t); resolve(r.ok ? { bytes: new Uint8Array(r.bytes), w: r.w, h: r.h } : null); });
    try { w.postMessage({ id, file, maxDim, quality }); } catch { waiting.delete(id); clearTimeout(t); resolve(null); }
  });
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

/** Normalise an image: applies EXIF orientation, limits size; returns {bytes, type, w, h}.
 *  `straight`: a photo of paper → find the sheet and straighten it (js/tools/scanproc.js straighten). */
async function prepare(item, { straight = false } = {}) {
  let dims = null;
  if (item.file) dims = await assertImageBlob(item.file); // dimension bombs are rejected before decoding
  const isPng = item.file.type === 'image/png';
  if (isPng && dims && Math.max(dims.w, dims.h) <= MAX_DIM && !straight) {
    return { bytes: new Uint8Array(await item.file.arrayBuffer()), type: 'png', w: dims.w, h: dims.h };
  }
  const small = await prepInWorker(item.file, MAX_DIM, 0.9);
  if (small && !straight) return { ...small, type: 'jpg' };
  // straightening needs a canvas here – from the worker's smaller JPEG when there is one (much less to decode)
  const src = small ? URL.createObjectURL(new Blob([small.bytes], { type: 'image/jpeg' })) : item.url;
  try {
    const img = await loadImage(src);
    let w = img.naturalWidth, hgt = img.naturalHeight;
    if (!w || !hgt) throw new Error('leeres Bild');
    if (isPng && !small && Math.max(w, hgt) <= MAX_DIM && !straight) {
      return { bytes: new Uint8Array(await item.file.arrayBuffer()), type: 'png', w, h: hgt };
    }
    const f = Math.min(1, MAX_DIM / Math.max(w, hgt));
    w = Math.round(w * f); hgt = Math.round(hgt * f);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = hgt;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, hgt);
    ctx.drawImage(img, 0, 0, w, hgt);
    let outCanvas = canvas, how = 'none';
    if (straight) {
      const st = await (await import('./straighten.js')).straighten(canvas);
      outCanvas = st.canvas; how = st.how;
    }
    const blob = await new Promise(r => outCanvas.toBlob(r, 'image/jpeg', 0.9));
    const out = { w: outCanvas.width, h: outCanvas.height };
    canvas.width = 0; canvas.height = 0; outCanvas.width = 0; outCanvas.height = 0; // free the pixels (phones)
    if (!blob) throw new Error('Kodierung fehlgeschlagen');
    return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'jpg', w: out.w, h: out.h, how };
  } finally { if (small) URL.revokeObjectURL(src); }
}

/** Small preview of a photo for the list (decoded in the worker; null → use the original) */
async function thumbUrlOf(file) {
  const t = await prepInWorker(file, 480, 0.8).catch(() => null);
  return t ? URL.createObjectURL(new Blob([t.bytes], { type: 'image/jpeg' })) : null;
}

/**
 * Images → PDF (pure, reusable by the batch tool).
 * @param {File[]|Blob[]} files
 * @param {{pageSize?: 'fit'|'a4', onProgress?: (i:number, n:number) => void}} [opts]
 * @returns {Promise<{bytes: Uint8Array, skipped: number, pages: number}>}
 */
export async function imagesToPdf(files, { pageSize = 'fit', onProgress = null, title = 'Bilder', straight = false } = {}) {
  const { PDFDocument } = await loadPdfLib();
  const out = await PDFDocument.create();
  let skipped = 0, straightened = 0;
  for (let i = 0; i < files.length; i++) {
    if (onProgress) onProgress(i + 1, files.length);
    await new Promise(r => setTimeout(r, 0)); // let the progress paint
    const item = { file: files[i], url: URL.createObjectURL(files[i]) };
    let prep;
    try { prep = await prepare(item, { straight }); } catch (e) { console.warn(e); skipped++; continue; } finally { URL.revokeObjectURL(item.url); }
    if (prep.how && prep.how !== 'none') straightened++;
    const img = prep.type === 'png' ? await out.embedPng(prep.bytes) : await out.embedJpg(prep.bytes);
    if (pageSize === 'fit') {
      // 1 px = 0.75 pt (96 dpi), clamp to sensible page sizes
      let pw = prep.w * 0.75, ph = prep.h * 0.75;
      const maxSide = 1440;
      const f = Math.min(1, maxSide / Math.max(pw, ph));
      pw *= f; ph *= f;
      const page = out.addPage([pw, ph]);
      page.drawImage(img, { x: 0, y: 0, width: pw, height: ph });
    } else {
      const landscape = prep.w > prep.h;
      const [pw, ph] = landscape ? [A4[1], A4[0]] : A4;
      const margin = 28;
      const f = Math.min((pw - 2 * margin) / prep.w, (ph - 2 * margin) / prep.h);
      const w = prep.w * f, hh = prep.h * f;
      const page = out.addPage([pw, ph]);
      page.drawImage(img, { x: (pw - w) / 2, y: (ph - hh) / 2, width: w, height: hh });
    }
  }
  if (!out.getPageCount()) throw Object.assign(new Error('none'), { userMessage: 'Keines der Bilder konnte gelesen werden.' });
  out.setTitle(title);
  return { bytes: await saveDoc(out), skipped, pages: out.getPageCount(), straightened };
}

export async function mount(screen) {
  let items = [];
  let pageSize = 'fit';
  // small previews instead of the full photos (a page of 12 MP pictures made the list itself sluggish)
  const previewOf = it => it.thumbP || (it.thumbP = thumbUrlOf(it.file).then(u => { it.thumb = u || it.url; return it.thumb; }));
  const release = it => { URL.revokeObjectURL(it.url); if (it.thumb && it.thumb !== it.url) URL.revokeObjectURL(it.thumb); };
  const addFiles = files => {
    const imgs = files.filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name));
    if (imgs.length < files.length) toast('Nur Bilddateien können hinzugefügt werden.', 'error');
    imgs.forEach(file => items.push({ file, url: URL.createObjectURL(file) }));
    render();
  };

  const wrap = h(`<div class="screen-inner">
    <div class="card intro"><span class="tile-ic">${icon('image')}</span><div><strong>Bilder in PDF umwandeln</strong>
      <p>Wähle Fotos oder Scans aus (JPG, PNG, WebP). Jedes Bild wird zu einer Seite. Auf dem Handy kannst du direkt die Kamera nutzen.</p></div></div>
    <div class="toolbar">
      <button class="btn btn-soft" type="button" data-pick>${icon('image')} Bilder wählen</button>
      <button class="btn btn-soft" type="button" data-cam>${icon('camera')} Foto aufnehmen</button>
      <span class="grow"></span>
      <label class="check img-straight"><input type="checkbox" data-straight> <span>Fotos von Papier gerade ausrichten</span></label>
      <div class="seg" role="group" aria-label="Seitengröße">
        <button type="button" data-size="fit" aria-pressed="true">An Bild anpassen</button>
        <button type="button" data-size="a4" aria-pressed="false">A4</button>
      </div>
    </div>
    <div class="img-grid" data-grid></div>
    <div data-result></div></div>`);
  screen.body.appendChild(wrap);
  const grid = wrap.querySelector('[data-grid]');
  const resultBox = wrap.querySelector('[data-result]');
  const makeBtn = h(`<button class="btn btn-primary" type="button" data-make>${icon('file')} PDF erstellen</button>`);

  wrap.querySelector('[data-pick]').addEventListener('click', async () => addFiles(await pickFiles({ accept: 'image/*', multiple: true })));
  wrap.querySelector('[data-cam]').addEventListener('click', async () => addFiles(await pickFiles({ accept: 'image/*', multiple: false, capture: 'environment' })));
  const straightBox = wrap.querySelector('[data-straight]');
  try { straightBox.checked = localStorage.getItem('fale-img-straight') === '1'; } catch { /* private mode */ }
  straightBox.addEventListener('change', () => { try { localStorage.setItem('fale-img-straight', straightBox.checked ? '1' : '0'); } catch { /* private mode */ } });
  wrap.querySelectorAll('[data-size]').forEach(b => b.addEventListener('click', () => {
    pageSize = b.dataset.size;
    wrap.querySelectorAll('[data-size]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  }));
  screen.onDropFiles = files => addFiles(files);

  function render() {
    grid.innerHTML = '';
    if (!items.length) grid.appendChild(h(`<div class="empty" style="grid-column:1/-1"><div class="empty-art">${icon('image')}</div><h3>Noch keine Bilder</h3><p>Wähle Bilder aus oder ziehe sie hierher.</p></div>`));
    items.forEach((it, i) => {
      const card = h(`<div class="img-card" draggable="true"><div class="img-box${it.thumb ? '' : ' loading'}"><img ${it.thumb ? `src="${it.thumb}"` : ''} alt="${esc(it.file.name)}" decoding="async"></div>
        <div class="pcard-foot"><span class="pcard-num">${i + 1}</span><span class="pcard-actions">
          <button class="icon-btn" type="button" data-l aria-label="Nach vorne" ${i === 0 ? 'disabled' : ''}>${icon('arrowLeft')}</button>
          <button class="icon-btn" type="button" data-r aria-label="Nach hinten" ${i === items.length - 1 ? 'disabled' : ''}>${icon('arrowRight')}</button>
          <button class="icon-btn" type="button" data-x aria-label="Bild entfernen">${icon('trash')}</button></span></div></div>`);
      card.querySelector('[data-l]').addEventListener('click', () => { moveItem(items, i, i - 1); render(); });
      card.querySelector('[data-r]').addEventListener('click', () => { moveItem(items, i, i + 1); render(); });
      card.querySelector('[data-x]').addEventListener('click', () => { release(it); items.splice(i, 1); render(); });
      if (!it.thumb) previewOf(it).then(u => { const img = card.querySelector('img'); if (img && u) { img.src = u; img.parentElement.classList.remove('loading'); } });
      grid.appendChild(card);
    });
    makeBtn.disabled = !items.length;
    const total = items.reduce((s, it) => s + it.file.size, 0);
    screen.setFoot([makeBtn], items.length ? `${items.length} Bild${items.length === 1 ? '' : 'er'} · ${formatSize(total)}` : 'Keine Bilder gewählt');
  }
  enableDragReorder(grid, '.img-card', (from, to) => { moveItem(items, from, to); render(); });

  makeBtn.addEventListener('click', async () => {
    if (!items.length) return;
    makeBtn.disabled = true;
    const prog = progress('Erstelle PDF …');
    try {
      const straight = straightBox.checked;
      const { bytes, skipped, straightened } = await imagesToPdf(items.map(it => it.file), { pageSize, straight, onProgress: (i, n) => prog.set(`Erstelle PDF … Bild ${i}/${n}`) });
      const stamp = new Date().toLocaleDateString('de-DE').replace(/\./g, '-');
      const doc = await saveResult(bytes, `Bilder ${stamp}.pdf`);
      resultBox.innerHTML = '';
      const notes = [skipped ? `${skipped} Bild(er) übersprungen` : '', straight ? (straightened ? `${straightened} von ${items.length} gerade ausgerichtet` : 'Nichts auszurichten gefunden') : ''].filter(Boolean);
      const card = resultCard(doc, { title: 'PDF erstellt', note: notes.join(' · ') });
      // fine-tune by hand: the scanner with adjustable corners
      const fix = h(`<button class="btn btn-ghost btn-sm" type="button" data-fix>${icon('scan')} Ecken selbst anpassen</button>`);
      fix.addEventListener('click', () => { location.hash = `#/werkzeug/scannen?doc=${doc.id}`; });
      const acts = card.querySelector('.actions');
      if (acts) acts.appendChild(fix);
      resultBox.appendChild(card);
      resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      toast('PDF wurde erstellt.', 'success');
    } catch (e) { errorToast(e, 'PDF konnte nicht erstellt werden.'); }
    finally { prog.done(); makeBtn.disabled = !items.length; }
  });

  if (handoff.images.length) { const imgs = handoff.images.splice(0); addFiles(imgs); } else render();
  return () => items.forEach(release);
}
