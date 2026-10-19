// Tool: PDF bearbeiten — add text and images, cover areas, and "Text überdecken & ersetzen"
// (tap existing text: it is covered with the background colour and re-typed in an editable box).
import { icon } from '../icons.js';
import { h, esc, toast, errorToast, progress, baseName, pickFiles } from '../ui.js';
import { resultCard } from '../components.js';
import { saveResult } from '../library.js';
import { loadPdf } from '../pdfcore.js';
import { loadEditable, loadPdfLib, saveDoc } from '../pdflib.js';
import { openToolDoc, PageStage, INK_COLORS, swatches, hexToRgb, makeSanitizer, readImageFile, guardLeave, proBadge, updateFoot } from './common.js';
import { pageChars, nearestChar } from './textgeom.js';
import { needsUnicode, fontForText, drawTextImage } from '../office/unifont.js';

const MODES = [
  { id: 'select', label: 'Auswählen', icon: 'pointer', hint: 'Elemente antippen zum Bearbeiten, ziehen zum Verschieben.' },
  { id: 'text', label: 'Text', icon: 'text', hint: 'Tippe auf die Seite, um Text einzufügen.' },
  { id: 'image', label: 'Bild', icon: 'image', hint: 'Tippe auf die Seite, um das gewählte Bild zu platzieren.' },
  { id: 'replace', label: 'Ersetzen', icon: 'edit', hint: 'Tippe auf vorhandenen Text, um ihn zu überdecken und neu zu schreiben.' },
  { id: 'cover', label: 'Abdecken', icon: 'square', hint: 'Bereich aufziehen, der mit Hintergrundfarbe abgedeckt wird.' },
];
const FONTS = { sans: 'Helvetica', serif: 'Times', mono: 'Courier' };
const CSS_FONT = { sans: 'Helvetica, Arial, sans-serif', serif: '"Times New Roman", Times, serif', mono: '"Courier New", Courier, monospace' };
const BASELINE = { sans: 0.946, serif: 0.938, mono: 0.866 };
const COLORS = [{ c: '#000000', n: 'Schwarz' }, ...INK_COLORS.slice(1)];

export async function mount(screen, { docId }) {
  const ctx = await openToolDoc(screen, docId, 'PDF bearbeiten');
  if (!ctx) return;
  const { doc, bytes } = ctx;
  const { pdf } = await loadPdf(bytes.slice(), { name: doc.name, key: docId });
  let mode = 'text';
  let items = [];
  let selected = null;
  let seq = 0;
  const undoStack = [];
  const images = new Map(); // id → {bytes, type, w, h, url}
  let pendingImage = null;
  let savedSnapshot = '[]';
  const style = { font: 'sans', size: 14, bold: false, color: '#000000' };

  screen.body.style.cssText = 'display:flex;flex-direction:column;overflow:hidden';
  const toolbar = h('<div class="pt-toolbar" role="toolbar" aria-label="Bearbeiten"></div>');
  MODES.forEach(m => {
    const b = h(`<button class="pt-tool" type="button" data-tool="${m.id}" aria-pressed="false">${icon(m.icon)}<span>${esc(m.label)}</span></button>`);
    b.addEventListener('click', () => setMode(m.id));
    toolbar.appendChild(b);
  });
  const propsBar = h('<div class="pt-props"></div>');
  const stageEl = h('<div class="pt-stage pt-edit" tabindex="-1"></div>');
  screen.body.append(toolbar, propsBar, stageEl);
  const undoBtn = h(`<button class="icon-btn" type="button" aria-label="Rückgängig" disabled>${icon('undo')}</button>`);
  screen.extra.append(undoBtn);
  undoBtn.addEventListener('click', undo);

  const stage = new PageStage(stageEl, pdf, {
    onPageCreated: p => { p.layer = h('<div class="pt-html"></div>'); p.overlay.append(p.layer); },
    onScale: s => stageEl.style.setProperty('--s', s),
  });
  await stage.init();
  const charsOf = p => (p.chars || (p.chars = pageChars(p.page, p.base).catch(() => ({ chars: [], text: '', map: [] }))));

  // ---------- props ----------
  function renderProps() {
    propsBar.innerHTML = '';
    const t = selected && selected.type === 'text' ? selected : null;
    if (mode === 'text' || mode === 'replace' || t) {
      const cur = t || style;
      const fontSel = h(`<select class="select pt-mini" aria-label="Schriftart">${Object.entries(FONTS).map(([k, v]) => `<option value="${k}" ${k === cur.font ? 'selected' : ''}>${v}</option>`).join('')}</select>`);
      fontSel.addEventListener('change', () => apply({ font: fontSel.value }));
      // size: A− [14] A+ instead of a list of point sizes (same control as in Ausfüllen & unterschreiben)
      const SIZES = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64];
      const sizeSel = h(`<span class="pt-size" role="group" aria-label="Schriftgröße"><button class="icon-btn" type="button" data-sz="-1" aria-label="Kleiner"><span class="sb-a small">A</span>−</button><span class="pt-size-v" aria-live="polite">${Math.round(cur.size)}</span><button class="icon-btn" type="button" data-sz="1" aria-label="Größer"><span class="sb-a">A</span>+</button></span>`);
      sizeSel.querySelectorAll('[data-sz]').forEach(b => b.addEventListener('click', () => {
        const now = (selected && selected.type === 'text' ? selected : style).size;
        const up = b.dataset.sz === '1';
        const next = up ? (SIZES.find(v => v > now + 0.01) || SIZES[SIZES.length - 1]) : ([...SIZES].reverse().find(v => v < now - 0.01) || SIZES[0]);
        apply({ size: next });
        sizeSel.querySelector('.pt-size-v').textContent = String(Math.round(next));
      }));
      const boldBtn = h(`<button class="icon-btn pt-bold" type="button" aria-label="Fett" aria-pressed="${!!cur.bold}"><b>F</b></button>`);
      boldBtn.addEventListener('click', () => { const v = boldBtn.getAttribute('aria-pressed') !== 'true'; boldBtn.setAttribute('aria-pressed', String(v)); apply({ bold: v }); });
      const pal = COLORS.some(c => c.c.toLowerCase() === String(cur.color).toLowerCase()) ? COLORS : [{ c: cur.color, n: 'Erkannt' }, ...COLORS.slice(0, 5)];
      propsBar.append(fontSel, sizeSel, boldBtn, swatches(pal, cur.color, c => apply({ color: c })));
    }
    if (selected) {
      const del = h(`<button class="btn btn-danger-ghost btn-sm" type="button">${icon('trash')} Löschen</button>`);
      del.addEventListener('click', () => removeItem(selected));
      propsBar.appendChild(del);
    } else if (mode === 'image') {
      const pick = h(`<button class="btn btn-soft btn-sm" type="button">${icon('image')} ${pendingImage ? 'Anderes Bild' : 'Bild wählen'}</button>`);
      pick.addEventListener('click', chooseImage);
      propsBar.appendChild(pick);
      propsBar.appendChild(h(`<span class="pt-hint">${pendingImage ? 'Tippe auf die Seite, um das Bild zu platzieren.' : 'Wähle zuerst ein Bild (JPG/PNG).'}</span>`));
    } else {
      const def = MODES.find(m => m.id === mode);
      propsBar.appendChild(h(`<span class="pt-hint">${esc(def.hint)}</span>`));
    }
    if (mode === 'replace' && !selected) propsBar.appendChild(h(`<span class="pt-hint pt-warn">${icon('info')} Überdeckter Text bleibt in der Datei – für sicheres Entfernen „Schwärzen“ nutzen.</span>`));
  }
  function apply(patch) {
    if (selected && selected.type === 'text') { commit(); Object.assign(selected, patch); place(selected); }
    else Object.assign(style, patch);
  }
  function setMode(m) {
    mode = m;
    toolbar.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === m)));
    stageEl.classList.toggle('drawing', m === 'cover');
    stageEl.dataset.mode = m;
    select(null);
    if (m === 'image' && !pendingImage) chooseImage();
  }
  async function chooseImage() {
    const [file] = await pickFiles({ accept: 'image/png,image/jpeg,image/webp,image/gif', multiple: false });
    if (!file) return;
    try {
      const img = await readImageFile(file, 2400);
      img.url = URL.createObjectURL(new Blob([img.bytes], { type: img.type === 'png' ? 'image/png' : 'image/jpeg' }));
      img.id = `img${++seq}`;
      images.set(img.id, img);
      pendingImage = img;
      renderProps();
    } catch (e) { errorToast(e, 'Das Bild konnte nicht gelesen werden.'); }
  }

  // ---------- model ----------
  const snapshot = () => JSON.stringify(items.map(({ el, ...rest }) => rest));
  function commit() { undoStack.push(snapshot()); if (undoStack.length > 80) undoStack.shift(); undoBtn.disabled = false; markDirty(); }
  function undo() {
    if (!undoStack.length) return;
    items.forEach(it => it.el && it.el.remove());
    items = JSON.parse(undoStack.pop());
    items.forEach(mountItem);
    selected = null;
    undoBtn.disabled = !undoStack.length;
    renderProps();
    markDirty();
  }
  function addItem(it) { commit(); it.id = `i${++seq}`; items.push(it); mountItem(it); markDirty(); return it; }
  function removeItem(it) {
    commit();
    const linked = items.filter(x => x === it || (it.link && x.id === it.link) || (x.link && x.link === it.id));
    linked.forEach(x => x.el && x.el.remove());
    items = items.filter(x => !linked.includes(x));
    if (selected && linked.includes(selected)) selected = null;
    renderProps();
    markDirty();
  }

  function mountItem(it) {
    const p = stage.pages[it.page - 1];
    let el;
    if (it.type === 'text') {
      el = h('<div class="pt-item pt-etext"><span class="pt-etext-in" spellcheck="false"></span></div>');
      el.querySelector('span').textContent = it.text;
    } else if (it.type === 'image') {
      const img = images.get(it.img);
      el = h(`<div class="pt-item pt-eimg"><img src="${img ? img.url : ''}" alt=""></div>`);
    } else {
      el = h('<div class="pt-item pt-ecover"></div>');
    }
    el.insertAdjacentHTML('beforeend', `<button type="button" class="pt-x" aria-label="Entfernen">${icon('close')}</button>${it.type !== 'cover' || true ? `<button type="button" class="pt-rs" aria-label="Größe ändern">${icon('resize')}</button>` : ''}`);
    el.dataset.id = it.id;
    it.el = el;
    el.querySelector('.pt-x').addEventListener('click', e => { e.stopPropagation(); removeItem(it); });
    enableDrag(it);
    p.layer.appendChild(el);
    place(it);
  }
  function place(it) {
    const el = it.el;
    if (!el) return;
    el.style.left = `calc(var(--s) * ${it.x}px)`;
    el.style.top = `calc(var(--s) * ${it.y}px)`;
    if (it.type === 'text') {
      const span = el.querySelector('span');
      Object.assign(span.style, { fontSize: `calc(var(--s) * ${it.size}px)`, fontFamily: CSS_FONT[it.font], fontWeight: it.bold ? '700' : '400', color: it.color });
    } else {
      el.style.width = `calc(var(--s) * ${it.w}px)`;
      el.style.height = `calc(var(--s) * ${it.h}px)`;
      if (it.type === 'cover') el.style.background = it.color;
    }
  }
  function select(it) {
    selected = it;
    items.forEach(x => x.el && x.el.classList.toggle('sel', x === it));
    renderProps();
  }
  function editText(it) {
    const span = it.el.querySelector('span');
    const before = snapshot();
    span.contentEditable = 'true';
    it.el.classList.add('editing');
    span.focus();
    const r = document.createRange(); r.selectNodeContents(span); if (!it.fresh) r.collapse(false);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    it.fresh = false;
    span.onkeydown = e => { if (e.key === 'Escape') span.blur(); e.stopPropagation(); };
    // keep the text (and the Save button) current while typing: on phones the field often never
    // loses focus (hiding the keyboard does not blur), so waiting for blur left "Speichern" disabled
    span.oninput = () => { it.text = span.innerText.replace(/\n+$/, ''); markDirty(); };
    span.onblur = () => {
      span.contentEditable = 'false';
      it.el.classList.remove('editing');
      it.text = span.innerText.replace(/\n+$/, '');
      if (snapshot() !== before) { undoStack.push(before); undoBtn.disabled = false; }
      if (!it.text.trim() && !it.link) { it.el.remove(); items = items.filter(x => x !== it); if (selected === it) selected = null; renderProps(); }
      markDirty();
    };
  }

  function enableDrag(it) {
    const el = it.el;
    let st = null;
    el.addEventListener('pointerdown', e => {
      if (e.target.closest('.pt-x')) return;
      if (it.type === 'text' && el.classList.contains('editing') && !e.target.closest('.pt-rs')) return;
      e.stopPropagation();
      e.preventDefault();
      const wasSel = selected === it;
      select(it);
      el.setPointerCapture(e.pointerId);
      st = { x: e.clientX, y: e.clientY, ix: it.x, iy: it.y, w: it.w, h: it.h, size: it.size, rs: !!e.target.closest('.pt-rs'), moved: false, wasSel, before: snapshot() };
    });
    el.addEventListener('pointermove', e => {
      if (!st) return;
      const dx = (e.clientX - st.x) / stage.scale, dy = (e.clientY - st.y) / stage.scale;
      if (!st.moved && Math.hypot(e.clientX - st.x, e.clientY - st.y) < 4) return;
      st.moved = true;
      const p = stage.pages[it.page - 1];
      if (st.rs) {
        if (it.type === 'text') it.size = Math.max(4, Math.min(120, st.size + dy * 0.5));
        else if (it.type === 'image') { const ratio = st.h / st.w; it.w = Math.max(12, st.w + dx); it.h = it.w * ratio; }
        else { it.w = Math.max(4, st.w + dx); it.h = Math.max(4, st.h + dy); }
      } else {
        it.x = Math.max(-20, Math.min(p.base.width - 10, st.ix + dx));
        it.y = Math.max(-20, Math.min(p.base.height - 10, st.iy + dy));
        // linked cover moves with its replacement text
        const cover = it.link && items.find(x => x.id === it.link);
        if (cover && cover._ox !== undefined) { /* keep cover in place: the cover hides the original */ }
      }
      place(it);
      if (it.type === 'text') renderProps();
    });
    const end = () => {
      if (!st) return;
      const s0 = st;
      st = null;
      if (s0.moved) { undoStack.push(s0.before); undoBtn.disabled = false; markDirty(); }
      else if (it.type === 'text' && (s0.wasSel || it.fresh)) editText(it);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  // ---------- page interaction ----------
  let gest = null;
  stage.box.addEventListener('pointerdown', async e => {
    if (e.button > 0 || e.target.closest('.pt-item')) return;
    const p = stage.pageAt(e);
    if (!p) return;
    const { x, y } = stage.pointIn(p, e);
    if (mode === 'select') { select(null); return; }
    if (mode === 'text') {
      e.preventDefault();
      const it = addItem({ type: 'text', page: p.num, x, y: y - style.size * 0.6, text: '', size: style.size, font: style.font, bold: style.bold, color: style.color });
      it.fresh = true;
      setMode('select');
      select(it);
      // Touch: focus only once the finger is lifted. A touch pointerdown carries no user activation, so
      // focus() 30 ms later put the caret in the field but Android never opened the keyboard.
      if (e.pointerType === 'mouse') setTimeout(() => editText(it), 30);
      else {
        let done = false;
        const go = () => { if (done) return; done = true; window.removeEventListener('pointerup', go, true); window.removeEventListener('pointercancel', go, true); editText(it); };
        window.addEventListener('pointerup', go, true);
        window.addEventListener('pointercancel', go, true);
        setTimeout(go, 1500); // safety net (pointerup lost)
      }
      return;
    }
    if (mode === 'image') {
      e.preventDefault();
      if (!pendingImage) { chooseImage(); return; }
      const img = pendingImage;
      const w = Math.min(p.base.width * 0.4, img.w * 0.75), hh = w * img.h / img.w;
      const it = addItem({ type: 'image', page: p.num, x: x - w / 2, y: y - hh / 2, w, h: hh, img: img.id });
      pendingImage = null;
      setMode('select');
      select(it);
      return;
    }
    if (mode === 'replace') {
      e.preventDefault();
      await replaceAt(p, x, y);
      return;
    }
    if (mode === 'cover') {
      e.preventDefault();
      stage.box.setPointerCapture(e.pointerId);
      const prev = h('<div class="pt-item pt-ecover pt-coverprev"></div>');
      p.layer.appendChild(prev);
      gest = { p, sx: x, sy: y, x, y, pid: e.pointerId, prev };
      drawCoverPrev();
    }
  });
  stage.box.addEventListener('pointermove', e => {
    if (!gest || e.pointerId !== gest.pid) return;
    const { x, y } = stage.pointIn(gest.p, e);
    gest.x = x; gest.y = y;
    drawCoverPrev();
  });
  const endCover = e => {
    if (!gest || e.pointerId !== gest.pid) return;
    const g = gest;
    gest = null;
    g.prev.remove();
    const x0 = Math.min(g.sx, g.x), y0 = Math.min(g.sy, g.y), w = Math.abs(g.x - g.sx), hh = Math.abs(g.y - g.sy);
    if (w < 3 || hh < 3 || e.type === 'pointercancel') return;
    const color = sampleBackground(g.p, x0, y0, x0 + w, y0 + hh) || '#ffffff';
    const it = addItem({ type: 'cover', page: g.p.num, x: x0, y: y0, w, h: hh, color });
    select(it);
  };
  stage.box.addEventListener('pointerup', endCover);
  stage.box.addEventListener('pointercancel', endCover);
  function drawCoverPrev() {
    const g = gest;
    Object.assign(g.prev.style, { left: `calc(var(--s) * ${Math.min(g.sx, g.x)}px)`, top: `calc(var(--s) * ${Math.min(g.sy, g.y)}px)`, width: `calc(var(--s) * ${Math.abs(g.x - g.sx)}px)`, height: `calc(var(--s) * ${Math.abs(g.y - g.sy)}px)` });
  }

  async function replaceAt(p, x, y) {
    const pt = await charsOf(p);
    if (!pt.chars.length) { toast('Hier gibt es keinen erkennbaren Text. Tipp: „Abdecken“ und „Text“ verwenden.', 'info', { timeout: 4500 }); return; }
    const i = nearestChar(pt.chars, x, y);
    const c = pt.chars[i];
    if (!(x >= c.x0 - c.fh && x <= c.x1 + c.fh && y >= c.y0 - c.fh * 0.6 && y <= c.y1 + c.fh * 0.6)) { toast('Tippe direkt auf den Text, den du ändern möchtest.', 'info'); return; }
    // extend to the run of characters on this line (items close together)
    let a = i, b = i;
    const near = (u, v) => u.line === v.line && Math.abs(u.fh - v.fh) < v.fh * 0.25 && (v.x0 - u.x1) < v.fh * 1.6;
    while (a > 0 && near(pt.chars[a - 1], pt.chars[a])) a--;
    while (b < pt.chars.length - 1 && near(pt.chars[b], pt.chars[b + 1])) b++;
    const run = pt.chars.slice(a, b + 1);
    const text = run.map(ch => ch.ch).join('').replace(/\s+/g, ' ').trim();
    const x0 = Math.min(...run.map(r => r.x0)), y0 = Math.min(...run.map(r => r.y0)), x1 = Math.max(...run.map(r => r.x1)), y1 = Math.max(...run.map(r => r.y1));
    const fh = c.fh;
    const f = fontOf(p, c.font);
    const bg = sampleBackground(p, x0, y0, x1, y1) || '#ffffff';
    const fg = sampleForeground(p, x0, y0, x1, y1, bg) || '#000000';
    const padX = fh * 0.08, padY = fh * 0.06;
    commit();
    const cover = { id: `i${++seq}`, type: 'cover', page: p.num, x: x0 - padX, y: y0 - padY, w: x1 - x0 + padX * 2, h: y1 - y0 + padY * 2, color: bg };
    items.push(cover); mountItem(cover);
    // place the new text on the same baseline: baseline (viewport) ≈ y of char base
    const [bx, by] = p.base.convertToViewportPoint(c.base[0], c.base[1]);
    const size = Math.round(fh * 2) / 2;
    const it = { id: `i${++seq}`, type: 'text', page: p.num, x: Math.min(...run.map(r => r.x0)), y: by - size * BASELINE[f.font], text, size, font: f.font, bold: f.bold, color: fg, link: cover.id };
    void bx;
    items.push(it); mountItem(it);
    it.fresh = true;
    markDirty();
    setMode('select');
    select(it);
    setTimeout(() => editText(it), 30);
  }

  function fontOf(p, fontId) {
    let name = '', bold = false;
    try { if (fontId && p.page.commonObjs.has(fontId)) { const fo = p.page.commonObjs.get(fontId); name = fo.name || ''; bold = !!(fo.bold || fo.black); } } catch {}
    if (/bold|black|heavy|semibold/i.test(name)) bold = true;
    const font = /courier|mono/i.test(name) ? 'mono' : /times|serif|roman|georgia|garamond|minion|cambria/i.test(name) && !/sans/i.test(name) ? 'serif' : 'sans';
    return { font, bold };
  }

  function canvasData(p, x0, y0, x1, y1, pad) {
    const c = p.canvasBox.querySelector('canvas');
    if (!c) return null;
    const k = c.width / p.base.width;
    const sx = Math.max(0, Math.floor((x0 - pad) * k)), sy = Math.max(0, Math.floor((y0 - pad) * k));
    const ex = Math.min(c.width, Math.ceil((x1 + pad) * k)), ey = Math.min(c.height, Math.ceil((y1 + pad) * k));
    if (ex - sx < 2 || ey - sy < 2) return null;
    try {
      // copy the region first: repeated readbacks from the page canvas would slow rendering down
      const tmp = document.createElement('canvas');
      tmp.width = ex - sx; tmp.height = ey - sy;
      const g = tmp.getContext('2d', { willReadFrequently: true });
      g.drawImage(c, sx, sy, ex - sx, ey - sy, 0, 0, ex - sx, ey - sy);
      const d = g.getImageData(0, 0, ex - sx, ey - sy);
      tmp.width = tmp.height = 0;
      return { d, k, sx, sy };
    } catch { return null; }
  }
  const hex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  /** Most common colour on the border around a box (paper colour). */
  function sampleBackground(p, x0, y0, x1, y1) {
    const r = canvasData(p, x0, y0, x1, y1, 3);
    if (!r) return null;
    const { data, width, height } = r.d;
    const hist = new Map();
    const add = (x, y) => { const i = (y * width + x) * 4; const key = (data[i] >> 3) << 10 | (data[i + 1] >> 3) << 5 | (data[i + 2] >> 3); const e = hist.get(key) || { n: 0, r: 0, g: 0, b: 0 }; e.n++; e.r += data[i]; e.g += data[i + 1]; e.b += data[i + 2]; hist.set(key, e); };
    for (let x = 0; x < width; x++) { add(x, 0); add(x, height - 1); }
    for (let y = 0; y < height; y++) { add(0, y); add(width - 1, y); }
    let best = null;
    hist.forEach(e => { if (!best || e.n > best.n) best = e; });
    return best ? hex(best.r / best.n, best.g / best.n, best.b / best.n) : null;
  }
  /** Average colour of the pixels that differ most from the background (text colour). */
  function sampleForeground(p, x0, y0, x1, y1, bgHex) {
    const r = canvasData(p, x0, y0, x1, y1, 0);
    if (!r) return null;
    const [br, bgc, bb] = hexToRgb(bgHex).map(v => v * 255);
    const { data } = r.d;
    let sum = [0, 0, 0], n = 0, maxD = 0;
    for (let i = 0; i < data.length; i += 4) maxD = Math.max(maxD, Math.abs(data[i] - br) + Math.abs(data[i + 1] - bgc) + Math.abs(data[i + 2] - bb));
    if (maxD < 60) return null;
    for (let i = 0; i < data.length; i += 4) {
      const d = Math.abs(data[i] - br) + Math.abs(data[i + 1] - bgc) + Math.abs(data[i + 2] - bb);
      if (d > maxD * 0.7) { sum[0] += data[i]; sum[1] += data[i + 1]; sum[2] += data[i + 2]; n++; }
    }
    if (!n) return null;
    const col = sum.map(v => v / n);
    // snap near-black to pure black for crisp output
    if (col.every(v => v < 70)) return '#000000';
    return hex(...col);
  }

  const onKey = e => {
    if (e.target.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('dialog[open]')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); removeItem(selected); }
    else if (e.key === 'Escape') select(null);
  };
  window.addEventListener('keydown', onKey);

  // ---------- save ----------
  const saveBtn = h(`<button class="btn btn-primary" type="button">${icon('check')} Speichern</button>`);
  function markDirty() {
    const n = items.filter(it => it.type !== 'text' || (it.text && it.text.trim())).length;
    saveBtn.disabled = !n;
    updateFoot(screen, [saveBtn], n ? `${n} Änderung${n === 1 ? '' : 'en'}` : 'Noch keine Änderungen');
  }
  saveBtn.addEventListener('click', async () => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    saveBtn.disabled = true;
    const prog = progress('Speichere …');
    try {
      const PDFLib = await loadPdfLib();
      const { StandardFonts, rgb, degrees } = PDFLib;
      const pdfDoc = await loadEditable(bytes, doc.name, { key: docId });
      const SF = {
        sans: [StandardFonts.Helvetica, StandardFonts.HelveticaBold], serif: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold], mono: [StandardFonts.Courier, StandardFonts.CourierBold],
      };
      const fontCache = new Map();
      const getFont = async (f, b) => { const k = f + (b ? 'b' : ''); if (!fontCache.has(k)) fontCache.set(k, await pdfDoc.embedFont(SF[f][b ? 1 : 0])); return fontCache.get(k); };
      const imgCache = new Map();
      const pages = pdfDoc.getPages();
      // covers first (below new text), then images, then text
      const order = { cover: 0, image: 1, text: 2 };
      for (const it of [...items].sort((a, b) => order[a.type] - order[b.type])) {
        const info = stage.pages[it.page - 1];
        const page = pages[it.page - 1];
        const V = (x, y) => info.base.convertToPdfPoint(x, y);
        const o = V(0, 0), ox = V(1, 0);
        const angle = Math.round(Math.atan2(ox[1] - o[1], ox[0] - o[0]) * 180 / Math.PI);
        if (it.type === 'cover') {
          const pts = [V(it.x, it.y), V(it.x + it.w, it.y), V(it.x, it.y + it.h), V(it.x + it.w, it.y + it.h)];
          const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
          const [r, g, b] = hexToRgb(it.color);
          page.drawRectangle({ x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys), color: rgb(r, g, b) });
        } else if (it.type === 'image') {
          const src = images.get(it.img);
          if (!src) continue;
          let emb = imgCache.get(it.img);
          if (!emb) { emb = src.type === 'png' ? await pdfDoc.embedPng(src.bytes) : await pdfDoc.embedJpg(src.bytes); imgCache.set(it.img, emb); }
          const [x, y] = V(it.x, it.y + it.h);
          page.drawImage(emb, { x, y, width: it.w, height: it.h, rotate: degrees(angle) });
        } else if (it.type === 'text') {
          if (!it.text || !it.text.trim()) continue;
          // Polish, Turkish, Cyrillic, Greek …: Liberation Sans (embedded subset) instead of a standard font
          const font = needsUnicode(it.text) ? await fontForText(pdfDoc, it.text, { family: it.font, bold: it.bold, PDFLib }) : await getFont(it.font, it.bold);
          const clean = makeSanitizer(font);
          const [r, g, b] = hexToRgb(it.color);
          const lines = it.text.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line) continue;
            const [x, y] = V(it.x, it.y + it.size * (i * 1.2 + BASELINE[it.font]));
            // Chinese, Hindi, Arabic … (no embedded font has them): drawn as a picture instead of "?"
            if (await drawTextImage(page, pdfDoc, line, { x, y, size: it.size, bold: it.bold, family: it.font, color: rgb(r, g, b), rotate: degrees(angle) })) continue;
            page.drawText(clean(line), { x, y, size: it.size, font, color: rgb(r, g, b), rotate: degrees(angle) });
          }
        }
      }
      const out = await saveDoc(pdfDoc);
      const res = await saveResult(out, `${baseName(doc.name)} (bearbeitet).pdf`);
      savedSnapshot = snapshot();
      stageEl.querySelectorAll('.pt-result').forEach(x => x.remove());
      const wrap = h('<div class="pt-result screen-inner"></div>');
      wrap.appendChild(resultCard(res, { from: docId, title: 'Gespeichert' }));
      stageEl.prepend(wrap);
      stageEl.scrollTo({ top: 0, behavior: 'smooth' });
      toast('Änderungen gespeichert.', 'success');
    } catch (e) { errorToast(e, 'Speichern fehlgeschlagen.'); }
    finally { prog.done(); markDirty(); }
  });

  guardLeave(screen, () => items.length > 0 && snapshot() !== savedSnapshot);
  // intro hint (once)
  const intro = h(`<div class="pt-result screen-inner"><div class="notice" style="margin:0">${icon('edit')}<span>Füge Text und Bilder hinzu oder tippe mit „Ersetzen“ auf vorhandenen Text, um ihn zu ändern. ${proBadge()}</span></div></div>`);
  stageEl.prepend(intro);
  setMode('text');
  markDirty();

  return () => {
    window.removeEventListener('keydown', onKey);
    images.forEach(img => img.url && URL.revokeObjectURL(img.url));
    stage.destroy();
    pdf.destroy();
  };
}
