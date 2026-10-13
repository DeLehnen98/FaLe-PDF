// Tool: Seiten zuschneiden — crop margins with a draggable box (one page, all pages or a range),
// numeric margins in mm, and "Ränder automatisch entfernen" (content bounding box detected on a
// rendered page). Writes /CropBox (optionally /MediaBox) with pdf-lib.
import { icon } from '../icons.js';
import { h, esc, toast, errorToast, progress, baseName } from '../ui.js';
import { resultCard } from '../components.js';
import { saveResult } from '../library.js';
import { loadPdf, renderPage } from '../pdfcore.js';
import { loadEditable, saveDoc } from '../pdflib.js';
import { openToolDoc, parseRange, proBadge, updateFoot, tick } from './common.js';

const MM = 72 / 25.4;

/** Content bounding box of a page in viewport@1 coordinates (null if blank). */
export async function contentBox(page, { pad = 6, threshold = 242 } = {}) {
  const base = page.getViewport({ scale: 1, rotation: page.rotate });
  const scale = Math.min(2, 700 / Math.max(base.width, base.height));
  const c = await renderPage(page, { scale });
  const g = c.getContext('2d', { willReadFrequently: true });
  const { width: W, height: H } = c;
  const d = g.getImageData(0, 0, W, H).data;
  const rows = new Uint32Array(H), cols = new Uint32Array(W);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114 < threshold) { rows[y]++; cols[x]++; }
  }
  c.width = c.height = 0;
  const first = (arr, from, step) => { for (let i = from; i >= 0 && i < arr.length; i += step) if (arr[i] >= 1) return i; return -1; };
  const y0 = first(rows, 0, 1), y1 = first(rows, H - 1, -1), x0 = first(cols, 0, 1), x1 = first(cols, W - 1, -1);
  if (y0 < 0 || x0 < 0) return null;
  const s = 1 / scale;
  return {
    x0: Math.max(0, x0 * s - pad), y0: Math.max(0, y0 * s - pad),
    x1: Math.min(base.width, (x1 + 1) * s + pad), y1: Math.min(base.height, (y1 + 1) * s + pad),
  };
}

export async function mount(screen, { docId }) {
  const ctx = await openToolDoc(screen, docId, 'Seiten zuschneiden');
  if (!ctx) return;
  const { doc, bytes } = ctx;
  const { pdf } = await loadPdf(bytes.slice(), { name: doc.name, key: docId });
  const N = pdf.numPages;
  let cur = 1;
  let alive = true;
  // margins in pt (visual, as displayed): top, right, bottom, left
  let m = { t: 0, r: 0, b: 0, l: 0 };
  let scope = 'all';
  const perPageAuto = new Map(); // page → margins detected automatically (used with "jede Seite einzeln")
  let base = null, scale = 1, pageCanvas = null;

  const wrap = h(`<div class="screen-inner pt-stamp">
    <div class="card intro"><span class="tile-ic">${icon('crop')}</span><div><strong>${esc(doc.name)}</strong>
      <p>Ziehe den Rahmen oder die Ecken, um weiße Ränder oder Bereiche abzuschneiden. ${proBadge()}</p></div></div>
    <div class="pt-stamp-grid">
      <div class="pt-preview-col">
        <div class="pt-preview cr-preview"><div class="cr-page" data-page><span class="spinner dark"></span></div></div>
        <div class="pt-prev-nav">
          <button class="icon-btn" type="button" data-prev aria-label="Vorherige Seite">${icon('chevronLeft')}</button>
          <span data-pinfo></span>
          <button class="icon-btn" type="button" data-next aria-label="Nächste Seite">${icon('chevronRight')}</button>
        </div>
      </div>
      <form class="card card-pad pt-settings" data-form novalidate>
        <button class="btn btn-soft btn-block" type="button" data-auto>${icon('magic')} Ränder automatisch entfernen</button>
        <label class="check"><input type="checkbox" name="each"><span>Für jede Seite einzeln erkennen</span></label>
        <fieldset class="pt-fieldset"><legend>Ränder (mm)</legend>
          <div class="cr-margins">
            <label class="field"><span class="field-label">Oben</span><input class="input" type="number" step="0.5" min="0" name="t" inputmode="decimal"></label>
            <label class="field"><span class="field-label">Unten</span><input class="input" type="number" step="0.5" min="0" name="b" inputmode="decimal"></label>
            <label class="field"><span class="field-label">Links</span><input class="input" type="number" step="0.5" min="0" name="l" inputmode="decimal"></label>
            <label class="field"><span class="field-label">Rechts</span><input class="input" type="number" step="0.5" min="0" name="r" inputmode="decimal"></label>
          </div>
          <button class="btn btn-ghost btn-sm" type="button" data-reset>${icon('undo')} Zurücksetzen</button>
        </fieldset>
        <div class="field"><span class="field-label">Anwenden auf</span>
          <div class="seg pt-seg-full" role="group" aria-label="Seiten"><button type="button" data-scope="all">Alle Seiten</button><button type="button" data-scope="one">Diese Seite</button><button type="button" data-scope="range">Bereich</button></div>
          <input class="input" name="range" placeholder="z. B. 2-${N}" hidden></div>
        <label class="check"><input type="checkbox" name="media"><span>Auch das Seitenformat (MediaBox) verkleinern – z. B. für Druckereien</span></label>
        <p class="hint" data-size></p>
      </form>
    </div>
    <div data-result></div></div>`);
  screen.body.appendChild(wrap);
  const form = wrap.querySelector('[data-form]');
  const pageBox = wrap.querySelector('[data-page]');
  const resultBox = wrap.querySelector('[data-result]');
  form.addEventListener('submit', e => e.preventDefault());
  const btn = h(`<button class="btn btn-primary" type="button">${icon('crop')} Zuschneiden</button>`);

  // ---------- preview ----------
  let renderSeq = 0;
  async function showPage(n) {
    cur = n;
    wrap.querySelector('[data-pinfo]').textContent = `Seite ${n} von ${N}`;
    wrap.querySelector('[data-prev]').disabled = n <= 1;
    wrap.querySelector('[data-next]').disabled = n >= N;
    const seq = ++renderSeq;
    const page = await pdf.getPage(n);
    base = page.getViewport({ scale: 1, rotation: page.rotate });
    const avail = Math.min(pageBox.parentElement.clientWidth - 36 || 340, 520);
    const maxH = window.matchMedia('(max-width: 720px)').matches ? 420 : Math.max(280, Math.min(620, window.innerHeight - 300));
    scale = Math.min(avail / base.width, maxH / base.height);
    const c = await renderPage(page, { scale, dpr: Math.min(2, window.devicePixelRatio || 1) });
    if (!alive || seq !== renderSeq) { c.width = c.height = 0; return; }
    if (pageCanvas) pageCanvas.width = pageCanvas.height = 0;
    pageCanvas = c;
    c.style.width = `${Math.round(base.width * scale)}px`;
    c.style.height = `${Math.round(base.height * scale)}px`;
    pageBox.innerHTML = '';
    pageBox.style.width = c.style.width; pageBox.style.height = c.style.height;
    pageBox.appendChild(c);
    ['t', 'b', 'l', 'r'].forEach(k => pageBox.appendChild(h(`<div class="cr-dim" data-dim="${k}"></div>`)));
    pageBox.appendChild(h(`<div class="cr-box" data-box tabindex="0" aria-label="Zuschnittbereich">
      ${['nw', 'ne', 'se', 'sw', 'n', 'e', 's', 'w'].map(k => `<span class="cr-h cr-${k}" data-h="${k}"></span>`).join('')}</div>`));
    wireBox();
    if (form.each.checked && perPageAuto.has(n)) m = { ...perPageAuto.get(n) };
    draw();
  }

  function clampM() {
    const minW = 20, minH = 20;
    for (const k of ['t', 'r', 'b', 'l']) m[k] = Math.max(0, m[k]);
    if (base) {
      if (m.l + m.r > base.width - minW) { const ex = m.l + m.r - (base.width - minW); m.r = Math.max(0, m.r - ex); m.l = Math.min(m.l, base.width - minW); }
      if (m.t + m.b > base.height - minH) { const ex = m.t + m.b - (base.height - minH); m.b = Math.max(0, m.b - ex); m.t = Math.min(m.t, base.height - minH); }
    }
  }
  function draw() {
    clampM();
    const box = pageBox.querySelector('[data-box]');
    if (!box || !base) return;
    Object.assign(box.style, { left: `${m.l * scale}px`, top: `${m.t * scale}px`, width: `${(base.width - m.l - m.r) * scale}px`, height: `${(base.height - m.t - m.b) * scale}px` });
    const W = base.width * scale, H = base.height * scale, L = m.l * scale, T = m.t * scale, R = W - m.r * scale, B = H - m.b * scale;
    const dims = { t: [0, 0, W, T], b: [0, B, W, H - B], l: [0, T, L, B - T], r: [R, T, W - R, B - T] };
    pageBox.querySelectorAll('[data-dim]').forEach(d => { const [x, y, w, hh] = dims[d.dataset.dim]; Object.assign(d.style, { left: `${x}px`, top: `${y}px`, width: `${Math.max(0, w)}px`, height: `${Math.max(0, hh)}px` }); });
    for (const k of ['t', 'r', 'b', 'l']) { const inp = form.elements[k]; if (document.activeElement !== inp) inp.value = String(Math.round((m[k] / MM) * 2) / 2); }
    const w = (base.width - m.l - m.r) / MM, hh = (base.height - m.t - m.b) / MM;
    wrap.querySelector('[data-size]').textContent = `Neue Größe: ${w.toFixed(0)} × ${hh.toFixed(0)} mm (vorher ${(base.width / MM).toFixed(0)} × ${(base.height / MM).toFixed(0)} mm)`;
    refresh();
  }
  function wireBox() {
    const box = pageBox.querySelector('[data-box]');
    let g = null;
    box.addEventListener('pointerdown', e => {
      e.preventDefault();
      box.setPointerCapture(e.pointerId);
      g = { k: e.target.dataset.h || 'move', x: e.clientX, y: e.clientY, o: { ...m } };
      if (form.each.checked) form.each.checked = false;
    });
    box.addEventListener('pointermove', e => {
      if (!g) return;
      const dx = (e.clientX - g.x) / scale, dy = (e.clientY - g.y) / scale;
      const o = g.o;
      m = { ...o };
      if (g.k === 'move') {
        const ddx = Math.max(-o.l, Math.min(o.r, dx)), ddy = Math.max(-o.t, Math.min(o.b, dy));
        m.l = o.l + ddx; m.r = o.r - ddx; m.t = o.t + ddy; m.b = o.b - ddy;
      } else {
        if (g.k.includes('n')) m.t = o.t + dy;
        if (g.k.includes('s')) m.b = o.b - dy;
        if (g.k.includes('w')) m.l = o.l + dx;
        if (g.k.includes('e')) m.r = o.r - dx;
      }
      draw();
    });
    const end = () => { g = null; };
    box.addEventListener('pointerup', end);
    box.addEventListener('pointercancel', end);
    box.addEventListener('keydown', e => {
      const step = (e.shiftKey ? 5 : 1) * MM;
      const map = { ArrowUp: ['t', -1], ArrowDown: ['t', 1], ArrowLeft: ['l', -1], ArrowRight: ['l', 1] };
      const a = map[e.key];
      if (!a) return;
      e.preventDefault();
      const opp = { t: 'b', l: 'r' }[a[0]];
      const d = a[1] * step;
      m[a[0]] = Math.max(0, m[a[0]] + d); m[opp] = Math.max(0, m[opp] - d);
      draw();
    });
  }

  // ---------- settings ----------
  form.addEventListener('input', e => {
    const k = e.target.name;
    if (['t', 'r', 'b', 'l'].includes(k)) {
      const v = parseFloat(String(e.target.value).replace(',', '.'));
      if (Number.isFinite(v)) { m[k] = Math.max(0, v * MM); form.each.checked = false; draw(); }
    } else refresh();
  });
  form.addEventListener('change', () => refresh());
  wrap.querySelector('[data-reset]').addEventListener('click', () => { m = { t: 0, r: 0, b: 0, l: 0 }; form.each.checked = false; perPageAuto.clear(); draw(); });
  wrap.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => { scope = b.dataset.scope; refresh(); }));
  wrap.querySelector('[data-prev]').addEventListener('click', () => showPage(Math.max(1, cur - 1)));
  wrap.querySelector('[data-next]').addEventListener('click', () => showPage(Math.min(N, cur + 1)));
  wrap.querySelector('[data-auto]').addEventListener('click', async e => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      const page = await pdf.getPage(cur);
      const bx = await contentBox(page);
      if (!bx) { toast('Auf dieser Seite wurde kein Inhalt gefunden.', 'info'); return; }
      m = { t: bx.y0, l: bx.x0, b: base.height - bx.y1, r: base.width - bx.x1 };
      perPageAuto.set(cur, { ...m });
      draw();
      toast(`Inhalt erkannt – ${((m.t + m.b) / MM).toFixed(0)} mm (oben/unten) und ${((m.l + m.r) / MM).toFixed(0)} mm (links/rechts) werden entfernt.`, 'success', { timeout: 4200 });
    } catch (err) { errorToast(err, 'Die Ränder konnten nicht erkannt werden.'); }
    finally { b.disabled = false; }
  });

  function targets() {
    if (scope === 'one') return [cur];
    if (scope === 'range') return parseRange(form.range.value, N);
    return Array.from({ length: N }, (_, i) => i + 1);
  }
  function refresh() {
    wrap.querySelectorAll('[data-scope]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.scope === scope)));
    form.range.hidden = scope !== 'range';
    const list = targets();
    form.range.classList.toggle('invalid', scope === 'range' && !list);
    const none = !form.each.checked && m.t + m.r + m.b + m.l < 0.5;
    btn.disabled = !list || !list.length || none;
    updateFoot(screen, [btn], !list ? 'Ungültiger Seitenbereich' : none ? 'Noch kein Zuschnitt' : `${list.length} von ${N} Seite${N === 1 ? '' : 'n'}`);
  }

  // ---------- apply ----------
  btn.addEventListener('click', async () => {
    const list = targets();
    if (!list || !list.length) return;
    btn.disabled = true;
    const prog = progress('Schneide zu …');
    try {
      const pdfDoc = await loadEditable(bytes, doc.name, { key: docId });
      const pages = pdfDoc.getPages();
      const each = form.each.checked;
      let skipped = 0;
      for (let k = 0; k < list.length; k++) {
        const n = list[k];
        if (k % 5 === 0) { prog.set(`Seite ${k + 1} von ${list.length} …`); await tick(); }
        const pg = await pdf.getPage(n);
        const vb = pg.getViewport({ scale: 1, rotation: pg.rotate });
        let mm = m;
        if (each) {
          let bx = perPageAuto.get(n) ? null : await contentBox(pg);
          if (perPageAuto.get(n)) mm = perPageAuto.get(n);
          else if (bx) mm = { t: bx.y0, l: bx.x0, b: vb.height - bx.y1, r: vb.width - bx.x1 };
          else { skipped++; continue; }
        }
        const x0 = Math.min(mm.l, vb.width - 20), y0 = Math.min(mm.t, vb.height - 20);
        const x1 = Math.max(x0 + 20, vb.width - mm.r), y1 = Math.max(y0 + 20, vb.height - mm.b);
        const [ax, ay] = vb.convertToPdfPoint(x0, y0), [bx2, by2] = vb.convertToPdfPoint(x1, y1);
        const X = Math.min(ax, bx2), Y = Math.min(ay, by2), W = Math.abs(bx2 - ax), H = Math.abs(by2 - ay);
        const target = pages[n - 1];
        target.setCropBox(X, Y, W, H);
        if (form.media.checked) { target.setMediaBox(X, Y, W, H); target.setTrimBox(X, Y, W, H); target.setBleedBox(X, Y, W, H); }
        else {
          // keep trim/bleed boxes inside the new crop box (avoids odd print previews)
          try { target.setTrimBox(X, Y, W, H); } catch {}
        }
      }
      prog.set('Speichere …');
      const out = await saveDoc(pdfDoc);
      const res = await saveResult(out, `${baseName(doc.name)} (zugeschnitten).pdf`);
      resultBox.innerHTML = '';
      resultBox.appendChild(resultCard(res, { title: 'Zugeschnitten', note: `${list.length - skipped} Seite${list.length - skipped === 1 ? '' : 'n'}` }));
      resultBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      toast(skipped ? `Zugeschnitten – ${skipped} leere Seite(n) unverändert.` : 'Seiten zugeschnitten.', 'success');
    } catch (e) { errorToast(e, 'Zuschneiden fehlgeschlagen.'); }
    finally { prog.done(); refresh(); }
  });

  let lastW = 0;
  const ro = new ResizeObserver(entries => {
    const w = Math.round(entries[0].contentRect.width);
    if (pageCanvas && Math.abs(w - lastW) > 8) { lastW = w; showPage(cur); }
  });
  await showPage(1);
  lastW = Math.round(pageBox.parentElement.clientWidth);
  ro.observe(pageBox.parentElement);
  refresh();
  return () => { alive = false; ro.disconnect(); if (pageCanvas) pageCanvas.width = pageCanvas.height = 0; pdf.destroy(); };
}
