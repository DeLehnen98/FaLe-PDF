// Signature creation for sign-pdf: draw (smooth, pressure/speed-sensitive strokes, full-screen landscape
// pad on phones), type (handwriting-like system fonts) or photo (background removed, ink recoloured).
// Optional, opt-in storage on this device (IndexedDB) – never uploaded. Adapted from the FaLe PDF app
// (js/tools/sigstore.js).
import { el, clear } from './dom.js';
import { tr, ic, btn } from './sec-ui.js';

// ---------------------------------------------------------------- storage (IndexedDB, this device only)
const DB = 'fale-wt-signatures', STORE = 'sigs';
function openDb() {
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB, 1); } catch (e) { reject(e); return; }
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const st = t.objectStore(STORE);
      let out;
      Promise.resolve(fn(st)).then(v => { out = v; });
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally { db.close(); }
}
const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function listSigs() {
  try { return await tx('readonly', st => reqP(st.getAll())) || []; } catch { return []; }
}
export async function saveSig({ kind, blob, w, h }) {
  try { await tx('readwrite', st => { st.add({ kind, blob, w, h, created: Date.now() }); }); return true; } catch { return false; }
}
export async function deleteSig(id) { try { await tx('readwrite', st => { st.delete(id); }); } catch { /* ignore */ } }
export async function clearSigs() { try { await tx('readwrite', st => { st.clear(); }); } catch { /* ignore */ } }

// ---------------------------------------------------------------- rendering helpers
export const FONTS = [
  { id: 'script', css: '"Segoe Script", "Brush Script MT", "Lucida Handwriting", "Snell Roundhand", "Apple Chancery", "Dancing Script", "URW Chancery L", "Z003", cursive', weight: 400, italic: false },
  { id: 'elegant', css: '"Palatino Linotype", "Book Antiqua", Palatino, "URW Palladio L", Georgia, "Noto Serif", serif', weight: 400, italic: true },
  { id: 'bold', css: '"Segoe Print", "Bradley Hand", "Comic Sans MS", "Chalkboard SE", "Noto Sans", sans-serif', weight: 700, italic: true },
];
export const INKS = [
  { c: '#14162E', de: 'Schwarz', en: 'Black' },
  { c: '#1F3A93', de: 'Blau', en: 'Blue' },
  { c: '#0B5D3B', de: 'Grün', en: 'Green' },
];

/** Crop transparent borders → {blob (PNG), w, h} or null when empty. */
export async function trimCanvas(canvas, pad = 6) {
  const { width, height } = canvas;
  const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] > 10) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
  }
  if (maxX < 0) return null;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1; out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  const blob = await new Promise(r => out.toBlob(r, 'image/png'));
  const res = { blob, w: out.width, h: out.height };
  out.width = out.height = 0;
  return res;
}

function typedCanvas(text, font, color, size = 120) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const f = `${font.italic ? 'italic ' : ''}${font.weight} ${size}px ${font.css}`;
  g.font = f;
  c.width = Math.max(10, Math.ceil(g.measureText(text).width) + size);
  c.height = Math.round(size * 1.8);
  g.font = f;
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, size / 2, c.height / 2);
  return c;
}

/** Photo of a signature: estimate the paper brightness, make it transparent, recolour the ink. */
export function processPhoto(src, color, sensitivity = 0.5) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0);
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  // local background (paper) level per 32 px tile → handles shadows across the photo
  const T = 32, tw = Math.ceil(c.width / T), th = Math.ceil(c.height / T);
  const bg = new Float32Array(tw * th);
  for (let ty = 0; ty < th; ty++) for (let tx2 = 0; tx2 < tw; tx2++) {
    const hist = new Uint32Array(32);
    let n = 0;
    for (let y = ty * T; y < Math.min(c.height, ty * T + T); y += 2) for (let x = tx2 * T; x < Math.min(c.width, tx2 * T + T); x += 2) {
      const i = (y * c.width + x) * 4;
      hist[((d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0) >> 3]++; n++;
    }
    let acc = 0, v = 28;
    for (let k = 31; k >= 0; k--) { acc += hist[k]; if (acc > n * 0.4) { v = k; break; } }
    bg[ty * tw + tx2] = v * 8 + 4;
  }
  const [cr, cg, cb] = [1, 3, 5].map(k => parseInt(color.slice(k, k + 2), 16));
  const thr = 10 + (1 - sensitivity) * 50;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const i = (y * c.width + x) * 4;
    const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    const b = bg[((y / T) | 0) * tw + ((x / T) | 0)];
    const a = Math.max(0, Math.min(1, (b - thr - l) / Math.max(30, b * 0.45)));
    d[i] = cr; d[i + 1] = cg; d[i + 2] = cb; d[i + 3] = Math.round(Math.pow(a, 0.75) * 255);
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ---------------------------------------------------------------- drawing pad
function createPad(lang) {
  const canvas = el('canvas', { aria: { label: tr(lang, 'Unterschriftsfeld – mit Finger, Stift oder Maus unterschreiben', 'Signature pad – sign with finger, pen or mouse') }, role: 'img' });
  const hint = el('p', { class: 'sec-pad-hint' }, tr(lang, 'Hier unterschreiben', 'Sign here'));
  const wrap = el('div', { class: 'sec-pad' }, el('div', { class: 'sec-pad-line' }), hint, canvas);
  const g = canvas.getContext('2d');
  const strokes = []; // [{pts: [[x, y, w], …]}] in CSS px
  let color = INKS[0].c, cur = null, last = null, lastW = 2.4, dpr = 2;
  const fit = () => {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    dpr = Math.max(2, Math.min(3, window.devicePixelRatio || 1));
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    redraw();
  };
  const seg = (p0, p1, p2) => { // quadratic through midpoints
    g.lineWidth = p1[2];
    g.beginPath();
    g.moveTo((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2);
    g.quadraticCurveTo(p1[0], p1[1], (p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2);
    g.stroke();
  };
  const dot = p => { g.beginPath(); g.arc(p[0], p[1], p[2] / 2, 0, Math.PI * 2); g.fill(); };
  function redraw() {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = g.fillStyle = color;
    for (const s of strokes) {
      const p = s.pts;
      if (p.length === 1) { dot(p[0]); continue; }
      g.lineWidth = p[0][2]; g.beginPath(); g.moveTo(p[0][0], p[0][1]); g.lineTo((p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2); g.stroke();
      for (let i = 1; i < p.length - 1; i++) seg(p[i - 1], p[i], p[i + 1]);
      const a = p[p.length - 2], b = p[p.length - 1];
      g.lineWidth = b[2]; g.beginPath(); g.moveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); g.lineTo(b[0], b[1]); g.stroke();
    }
    hint.hidden = strokes.length > 0;
  }
  const pos = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, t: e.timeStamp, p: e.pressure || 0.5 }; };
  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    last = pos(e); lastW = 2.6;
    cur = { pts: [[last.x, last.y, lastW]] };
    strokes.push(cur);
    redraw();
  });
  canvas.addEventListener('pointermove', e => {
    if (!cur) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const pe of evs.length ? evs : [e]) {
      const p = pos(pe);
      const dist = Math.hypot(p.x - last.x, p.y - last.y);
      if (dist < 0.8) continue;
      const v = dist / Math.max(1, p.t - last.t);
      const target = Math.max(1.2, Math.min(4, 3.6 - v * 1.2 + (pe.pointerType === 'pen' ? (p.p - 0.5) * 2.4 : 0)));
      lastW = lastW * 0.65 + target * 0.35;
      cur.pts.push([p.x, p.y, lastW]);
      const n = cur.pts.length;
      g.strokeStyle = color;
      if (n >= 3) seg(cur.pts[n - 3], cur.pts[n - 2], cur.pts[n - 1]);
      else if (n === 2) { const [a, b] = cur.pts; g.lineWidth = a[2]; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); g.stroke(); }
      last = p;
    }
  });
  const end = () => { cur = null; last = null; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  return {
    node: wrap, canvas, fit,
    isEmpty: () => strokes.length === 0,
    undo() { strokes.pop(); redraw(); },
    clear() { strokes.length = 0; redraw(); },
    setColor(c) { color = c; redraw(); },
    async export() { if (!strokes.length) return null; const r = await trimCanvas(canvas, 8); return r; },
  };
}

// ---------------------------------------------------------------- dialog
/**
 * @returns {Promise<{blob, w, h}|null>}
 */
export function createSignature({ lang, kind = 'signature', mode = 'draw' }) {
  return new Promise(resolve => {
    const L = lang;
    const initials = kind === 'initials';
    let ink = INKS[0].c, tab = mode;
    const dlg = el('dialog', { class: 'sec-dlg', aria: { labelledby: 'sec-dlg-title' } });
    const title = el('h2', { id: 'sec-dlg-title' }, initials ? tr(L, 'Initialen erstellen', 'Create initials') : tr(L, 'Unterschrift erstellen', 'Create your signature'));
    const close = btn('close', '', () => finish(null), { cls: 'wt-icon-btn', label: tr(L, 'Schließen', 'Close') });
    const tabs = [['draw', 'pen', tr(L, 'Zeichnen', 'Draw')], ['type', 'type', tr(L, 'Tippen', 'Type')], ['photo', 'camera', tr(L, 'Foto', 'Photo')]];
    const tabBtns = tabs.map(([id, icn, label]) => el('button', { type: 'button', class: 'sec-tab', role: 'tab', id: `sec-tab-${id}`, aria: { selected: String(id === tab), controls: `sec-panel-${id}` }, onclick: () => setTab(id) }, ic(icn), label));
    const tabList = el('div', { class: 'sec-tabs', role: 'tablist', aria: { label: tr(L, 'Art der Unterschrift', 'Signature type') } }, tabBtns);
    // colours
    const colorBtns = INKS.map(k => el('button', { type: 'button', class: 'sec-color', aria: { pressed: String(k.c === ink), label: tr(L, `Farbe ${k.de}`, `Colour ${k.en}`) }, onclick: () => setInk(k.c) }, el('span')));
    colorBtns.forEach((b, i) => { b.firstChild.style.background = INKS[i].c; });
    const colors = el('div', { class: 'sec-colors', role: 'group', aria: { label: tr(L, 'Farbe', 'Colour') } }, colorBtns);
    // draw panel
    const pad = createPad(L);
    const full = (window.matchMedia?.('(pointer: coarse)').matches && document.fullscreenEnabled)
      ? btn('expand', tr(L, 'Quer & Vollbild', 'Landscape & full screen'), async () => {
        try {
          if (!document.fullscreenElement) { await dlg.requestFullscreen(); await screen.orientation?.lock?.('landscape').catch(() => {}); dlg.classList.add('is-full'); }
          else { await document.exitFullscreen(); dlg.classList.remove('is-full'); }
        } catch { /* not allowed */ }
        setTimeout(() => pad.fit(), 250);
      }) : null;
    const drawPanel = el('div', { id: 'sec-panel-draw', role: 'tabpanel', aria: { labelledby: 'sec-tab-draw' }, class: 'sec-stage' },
      pad.node,
      el('div', { class: 'sec-row' }, btn('undo', tr(L, 'Rückgängig', 'Undo'), () => pad.undo()), btn('trash', tr(L, 'Neu', 'Clear'), () => pad.clear()), full),
      el('p', { class: 'sec-small sec-land-hint' }, tr(L, 'Tipp: Halte dein Handy quer – dann hast du mehr Platz.', 'Tip: turn your phone sideways for more room.')));
    // type panel
    const typeInput = el('input', { id: 'sec-sig-text', class: 'wt-input', type: 'text', autocomplete: initials ? 'off' : 'name', autocapitalize: 'words', spellcheck: 'false', maxlength: '60',
      placeholder: initials ? tr(L, 'z. B. E. M.', 'e.g. J. D.') : tr(L, 'Dein Name', 'Your name') });
    let font = FONTS[0];
    const fontBtns = FONTS.map(f => {
      const c = el('canvas', { width: '600', height: '104' });
      const b = el('button', { type: 'button', class: 'sec-font', aria: { pressed: String(f === font), label: tr(L, `Schriftart ${FONTS.indexOf(f) + 1}`, `Font ${FONTS.indexOf(f) + 1}`) }, onclick: () => { font = f; fontBtns.forEach((x, i) => x.setAttribute('aria-pressed', String(FONTS[i] === f))); } }, c);
      b._c = c;
      return b;
    });
    const paintFonts = () => {
      const text = typeInput.value.trim() || (initials ? 'E. M.' : tr(L, 'Erika Muster', 'Jane Doe'));
      fontBtns.forEach((b, i) => {
        const c = b._c, g = c.getContext('2d');
        g.clearRect(0, 0, c.width, c.height);
        const f = FONTS[i];
        let size = 64;
        g.font = `${f.italic ? 'italic ' : ''}${f.weight} ${size}px ${f.css}`;
        while (g.measureText(text).width > c.width - 20 && size > 20) { size -= 4; g.font = `${f.italic ? 'italic ' : ''}${f.weight} ${size}px ${f.css}`; }
        g.fillStyle = ink; g.textBaseline = 'middle';
        g.fillText(text, 10, c.height / 2);
      });
    };
    typeInput.addEventListener('input', paintFonts);
    const typePanel = el('div', { id: 'sec-panel-type', role: 'tabpanel', aria: { labelledby: 'sec-tab-type' }, class: 'sec-stage' },
      el('div', { class: 'wt-opt' }, el('label', { for: 'sec-sig-text' }, initials ? tr(L, 'Deine Initialen', 'Your initials') : tr(L, 'Dein Name', 'Your name')), typeInput),
      el('div', { class: 'sec-fonts' }, fontBtns),
      el('p', { class: 'sec-small' }, tr(L, 'Die Schriften kommen von deinem Gerät und sehen je nach Gerät etwas anders aus.', 'The fonts come from your device and look a little different on each device.')));
    // photo panel
    let photo = null, processed = null;
    const sens = el('input', { type: 'range', id: 'sec-sig-sens', min: '0', max: '1', step: '0.05', value: '0.5' });
    const photoPrev = el('div', { class: 'sec-photo-prev' }, el('p', { class: 'sec-small' }, tr(L, 'Unterschreibe auf weißem Papier und fotografiere sie gerade von oben.', 'Sign on white paper and take a straight photo from above.')));
    const fileIn = el('input', { type: 'file', accept: 'image/*', class: 'wt-picker', tabindex: '-1' });
    const camIn = el('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'wt-picker', tabindex: '-1' });
    const pickBtn = el('label', { class: 'wt-btn wt-btn-quiet wt-btn-sm' }, ic('image'), tr(L, 'Bild wählen', 'Choose image'), fileIn);
    const camBtn = window.matchMedia?.('(pointer: coarse)').matches ? el('label', { class: 'wt-btn wt-btn-quiet wt-btn-sm' }, ic('camera'), tr(L, 'Foto aufnehmen', 'Take photo'), camIn) : null;
    const reprocess = () => {
      if (!photo) return;
      if (processed) processed.width = processed.height = 0;
      processed = processPhoto(photo, ink, +sens.value);
      clear(photoPrev).append(processed);
    };
    sens.addEventListener('input', reprocess);
    const loadPhoto = async file => {
      if (!file) return;
      try {
        const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
        const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
        const c = document.createElement('canvas');
        c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
        c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
        bmp.close?.();
        if (photo) photo.width = photo.height = 0;
        photo = c;
        reprocess();
      } catch (err) {
        console.warn(err);
        clear(photoPrev).append(el('p', { class: 'wt-opt-err' }, tr(L, 'Dieses Bild konnte nicht geöffnet werden.', 'This image could not be opened.')));
      }
    };
    fileIn.addEventListener('change', () => loadPhoto(fileIn.files[0]));
    camIn.addEventListener('change', () => loadPhoto(camIn.files[0]));
    const photoPanel = el('div', { id: 'sec-panel-photo', role: 'tabpanel', aria: { labelledby: 'sec-tab-photo' }, class: 'sec-stage' },
      el('div', { class: 'sec-row' }, camBtn, pickBtn), photoPrev,
      el('div', { class: 'wt-opt wt-opt-range' }, el('label', { for: 'sec-sig-sens' }, tr(L, 'Empfindlichkeit (mehr = auch helle Striche)', 'Sensitivity (more = include light strokes)')), sens));
    const panels = { draw: drawPanel, type: typePanel, photo: photoPanel };
    // footer
    const remember = el('input', { type: 'checkbox', id: 'sec-sig-remember' });
    const err = el('p', { class: 'wt-opt-err', hidden: true, role: 'alert' });
    const ok = el('button', { type: 'button', class: 'wt-btn wt-btn-primary' }, ic('check'), tr(L, 'Übernehmen', 'Use'));
    ok.addEventListener('click', async () => {
      let res = null;
      if (tab === 'draw') res = await pad.export();
      else if (tab === 'type') {
        const text = typeInput.value.trim();
        if (text) { const c = typedCanvas(text, font, ink); res = await trimCanvas(c, 8); c.width = c.height = 0; }
      } else if (processed) res = await trimCanvas(processed, 8);
      if (!res) {
        err.textContent = tab === 'draw' ? tr(L, 'Unterschreibe zuerst im Feld.', 'Sign in the pad first.') : tab === 'type' ? tr(L, 'Tippe zuerst deinen Namen ein.', 'Type your name first.') : tr(L, 'Wähle zuerst ein Foto mit deiner Unterschrift.', 'Choose a photo of your signature first.');
        err.hidden = false;
        return;
      }
      res.remember = remember.checked;
      finish(res);
    });
    const foot = el('div', { class: 'sec-dlg-foot' },
      el('label', { class: 'sec-check sec-remember', for: 'sec-sig-remember' }, remember, el('span', {}, tr(L, 'Auf diesem Gerät merken', 'Remember on this device'))),
      btn('', tr(L, 'Abbrechen', 'Cancel'), () => finish(null), { cls: 'wt-btn wt-btn-quiet' }), ok);
    dlg.append(el('div', { class: 'sec-dlg-in' }, el('div', { class: 'sec-dlg-head' }, title, close), tabList, colors, drawPanel, typePanel, photoPanel, err, foot,
      el('p', { class: 'sec-small' }, tr(L, 'Gemerkte Unterschriften bleiben nur in diesem Browser auf diesem Gerät und lassen sich jederzeit löschen.', 'Remembered signatures stay only in this browser on this device and can be deleted at any time.'))));

    function setTab(id) {
      tab = id;
      tabBtns.forEach((b, i) => b.setAttribute('aria-selected', String(tabs[i][0] === id)));
      for (const [k, p] of Object.entries(panels)) p.hidden = k !== id;
      err.hidden = true;
      if (id === 'draw') requestAnimationFrame(() => pad.fit());
      if (id === 'type') { paintFonts(); typeInput.focus(); }
    }
    function setInk(c) {
      ink = c;
      colorBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(INKS[i].c === c)));
      pad.setColor(c); paintFonts(); reprocess();
    }
    let done = false;
    function finish(v) {
      if (done) return;
      done = true;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      try { screen.orientation?.unlock?.(); } catch { /* ignore */ }
      dlg.close();
      dlg.remove();
      pad.clear();
      if (photo) photo.width = photo.height = 0;
      if (processed) processed.width = processed.height = 0;
      window.removeEventListener('resize', onResize);
      resolve(v);
    }
    const onResize = () => { if (tab === 'draw') pad.fit(); };
    window.addEventListener('resize', onResize);
    dlg.addEventListener('cancel', e => { e.preventDefault(); finish(null); });
    document.body.append(dlg);
    dlg.showModal();
    setTab(tab);
  });
}
