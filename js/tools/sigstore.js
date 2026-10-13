// Unterschriften & Stempel: a local library of signatures, initials and stamps (IndexedDB, the
// existing "signatures" store of the app database), with a drawing pad, typed signatures in
// handwriting-like fonts, imported images and a stamp designer. Used by "Ausfüllen &
// unterschreiben", "Kommentieren" and as its own tool screen.
import { icon } from '../icons.js';
import { h, esc, toast, errorToast, openDialog, pickFiles, promptDialog, confirmDialog } from '../ui.js';
import { ensureCss } from './common.js';

export const KINDS = [
  { id: 'signature', label: 'Unterschriften', one: 'Unterschrift' },
  { id: 'initials', label: 'Initialen', one: 'Initialen' },
  { id: 'stamp', label: 'Stempel', one: 'Stempel' },
];
const KIND = Object.fromEntries(KINDS.map(k => [k.id, k]));

// ------------------------------------------------------------------ storage
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('falepdf');
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      if (!db.objectStoreNames.contains('signatures')) { db.close(); reject(new Error('Speicher nicht bereit')); return; }
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Datenbank blockiert'));
  });
}
async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction('signatures', mode);
      const st = t.objectStore('signatures');
      let result;
      Promise.resolve(fn(st)).then(r => { result = r; }, reject);
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('abgebrochen'));
    });
  } finally { db.close(); }
}
const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

/** All saved assets (newest first), optionally of one kind. Old entries without kind are signatures. */
export async function listAssets(kind = null) {
  let all = [];
  try { all = await withStore('readonly', st => reqP(st.getAll())); } catch (e) { console.warn(e); return []; }
  return all.map(a => ({ ...a, kind: a.kind || 'signature' }))
    .filter(a => a.blob && (!kind || a.kind === kind))
    .sort((a, b) => (b.usedAt || b.createdAt || 0) - (a.usedAt || a.createdAt || 0));
}
export async function addAsset({ blob, kind = 'signature', name = '', spec = null, w = 0, h: hh = 0 }) {
  return withStore('readwrite', st => reqP(st.add({ blob, kind, name, spec, w, h: hh, createdAt: Date.now() })));
}
export async function updateAsset(id, patch) {
  return withStore('readwrite', async st => {
    const cur = await reqP(st.get(id));
    if (cur) st.put({ ...cur, ...patch });
  });
}
export async function deleteAsset(id) { return withStore('readwrite', st => { st.delete(id); }); }

// ------------------------------------------------------------------ rendering helpers
const SCRIPT_FONTS = [
  { id: 'script', label: 'Schreibschrift', css: '"Segoe Script", "Brush Script MT", "Lucida Handwriting", "Snell Roundhand", "Apple Chancery", "Dancing Script", "URW Chancery L", "Z003", cursive', weight: 400, italic: false },
  { id: 'elegant', label: 'Elegant', css: '"Palatino Linotype", "Book Antiqua", Palatino, "URW Palladio L", Georgia, "Noto Serif", serif', weight: 400, italic: true },
  { id: 'kraeftig', label: 'Kräftig', css: '"Segoe Print", "Bradley Hand", "Comic Sans MS", "Chalkboard SE", "Noto Sans", sans-serif', weight: 700, italic: true },
];
export const SIG_COLORS = [{ c: '#14162E', n: 'Schwarz' }, { c: '#1F3A93', n: 'Blau' }, { c: '#0B5D3B', n: 'Grün' }];

/** Crop transparent borders of a canvas → PNG blob (+ size). */
export async function trimCanvas(canvas, pad = 8) {
  const { width, height } = canvas;
  const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] > 8) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1; out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  const blob = await new Promise(r => out.toBlob(r, 'image/png'));
  return { blob, w: out.width, h: out.height };
}

function typedCanvas(text, font, color, size = 120) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const f = `${font.italic ? 'italic ' : ''}${font.weight} ${size}px ${font.css}`;
  g.font = f;
  const w = Math.ceil(g.measureText(text).width) + size;
  c.width = Math.max(10, w); c.height = Math.round(size * 1.8);
  g.font = f;
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, size / 2, c.height / 2);
  return c;
}

// ------------------------------------------------------------------ stamp designer
export const STAMP_PRESETS = [
  { id: 'genehmigt', label: 'Genehmigt', lines: ['GENEHMIGT'], color: '#2F9E44', border: 'round', date: true },
  { id: 'entwurf', label: 'Entwurf', lines: ['ENTWURF'], color: '#E03131', border: 'double', date: false },
  { id: 'bezahlt', label: 'Bezahlt', lines: ['BEZAHLT'], color: '#1C64F2', border: 'rect', date: true },
  { id: 'eingang', label: 'Eingang', lines: ['EINGANG'], color: '#C92A2A', border: 'rect', date: true },
  { id: 'vertraulich', label: 'Vertraulich', lines: ['VERTRAULICH'], color: '#E03131', border: 'double', date: false },
  { id: 'geprueft', label: 'Geprüft', lines: ['GEPRÜFT'], color: '#2F9E44', border: 'oval', date: true },
  { id: 'erledigt', label: 'Erledigt', lines: ['ERLEDIGT'], color: '#5F3DC4', border: 'round', date: true },
  { id: 'kopie', label: 'Kopie', lines: ['KOPIE'], color: '#495057', border: 'rect', date: false },
  { id: 'firma', label: 'Firmenstempel', lines: ['Muster GmbH', 'Musterstraße 1', '66111 Saarbrücken', 'Tel. 0681 123456'], color: '#1F3A93', border: 'round', date: false },
];
const STAMP_COLORS = [{ c: '#E03131', n: 'Rot' }, { c: '#1C64F2', n: 'Blau' }, { c: '#2F9E44', n: 'Grün' }, { c: '#5F3DC4', n: 'Violett' }, { c: '#1F2340', n: 'Schwarz' }];
const BORDERS = [['rect', 'Rechteck'], ['round', 'Abgerundet'], ['double', 'Doppelt'], ['oval', 'Oval'], ['dashed', 'Gestrichelt'], ['none', 'Ohne']];
const today = () => new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** Render a stamp spec into a transparent canvas (scale = px per pt). */
export function renderStamp(spec, scale = 4) {
  const lines = (spec.lines || []).map(s => String(s)).filter(s => s.trim());
  if (spec.date) lines.push(spec.dateText || today());
  if (!lines.length) lines.push(' ');
  const first = spec.firstBig !== false && lines.length > 1;
  const sizes = lines.map((_, i) => (i === 0 ? (first ? 20 : 18) : 11.5));
  if (lines.length === 1) sizes[0] = 22;
  const meas = document.createElement('canvas').getContext('2d');
  const fontOf = (i, s) => `${i === 0 ? 800 : 600} ${s}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
  const widths = lines.map((l, i) => { meas.font = fontOf(i, sizes[i]); return meas.measureText(l).width + (i === 0 ? sizes[i] * 0.12 * l.length : 0); });
  const lh = sizes.map(s => s * 1.25);
  const textW = Math.max(...widths), textH = lh.reduce((a, b) => a + b, 0);
  const oval = spec.border === 'oval';
  const padX = oval ? 26 : 14, padY = oval ? 14 : 9;
  const W = textW + padX * 2, H = textH + padY * 2;
  const rot = spec.tilt ? -6 : 0;
  const rad = rot * Math.PI / 180;
  const BW = Math.abs(W * Math.cos(rad)) + Math.abs(H * Math.sin(rad)) + 6, BH = Math.abs(W * Math.sin(rad)) + Math.abs(H * Math.cos(rad)) + 6;
  const c = document.createElement('canvas');
  c.width = Math.ceil(BW * scale); c.height = Math.ceil(BH * scale);
  const g = c.getContext('2d');
  g.scale(scale, scale);
  g.translate(BW / 2, BH / 2);
  g.rotate(rad);
  g.translate(-W / 2, -H / 2);
  g.strokeStyle = g.fillStyle = spec.color || '#E03131';
  g.lineWidth = 2.2;
  const rr = (x, y, w, hh, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + hh, r); g.arcTo(x + w, y + hh, x, y + hh, r); g.arcTo(x, y + hh, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  if (spec.border === 'rect' || spec.border === 'dashed') { if (spec.border === 'dashed') g.setLineDash([6, 4]); g.strokeRect(1.5, 1.5, W - 3, H - 3); g.setLineDash([]); }
  else if (spec.border === 'round') { rr(1.5, 1.5, W - 3, H - 3, 9); g.stroke(); }
  else if (spec.border === 'double') { g.lineWidth = 2.4; g.strokeRect(1.5, 1.5, W - 3, H - 3); g.lineWidth = 1; g.strokeRect(5, 5, W - 10, H - 10); }
  else if (oval) { g.beginPath(); g.ellipse(W / 2, H / 2, W / 2 - 1.5, H / 2 - 1.5, 0, 0, Math.PI * 2); g.stroke(); }
  let y = padY;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((l, i) => {
    g.font = fontOf(i, sizes[i]);
    if ('letterSpacing' in g) g.letterSpacing = i === 0 ? `${(sizes[i] * 0.12).toFixed(1)}px` : '0px';
    g.fillText(l, W / 2, y + lh[i] / 2 + 0.5);
    y += lh[i];
  });
  // worn ink texture: punch tiny random holes (deterministic per text)
  if (spec.worn !== false) {
    let seed = 0;
    for (const ch of lines.join('|')) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'destination-out';
    const n = Math.round((c.width * c.height) / 900);
    for (let i = 0; i < n; i++) { g.globalAlpha = 0.25 + rnd() * 0.5; g.beginPath(); g.arc(rnd() * c.width, rnd() * c.height, 0.6 + rnd() * scale * 0.55, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
  return c;
}

/** Stamp designer dialog → {blob, w, h, spec, name} or null. */
export async function stampDesigner(initial = null) {
  await ensureCss();
  let spec = initial ? { ...initial } : { ...STAMP_PRESETS[0], lines: [...STAMP_PRESETS[0].lines], tilt: false, worn: true };
  let canvasApi = null;
  const r = await openDialog({
    title: initial ? 'Stempel bearbeiten' : 'Neuer Stempel',
    wide: true,
    body: `<div class="ss-presets" role="group" aria-label="Vorlagen">${STAMP_PRESETS.map(p => `<button type="button" class="pt-chip" data-preset="${p.id}">${esc(p.label)}</button>`).join('')}</div>
      <div class="ss-stamp-prev"><canvas aria-label="Vorschau"></canvas></div>
      <label class="field"><span class="field-label">Text (eine Zeile pro Zeile – die erste wird groß)</span><textarea class="input pt-textarea ss-lines" rows="3" name="lines"></textarea></label>
      <div class="ss-row"><label class="check"><input type="checkbox" name="date"><span>Datum</span></label><input class="input ss-date" name="dateText" placeholder="${today()}">
        <label class="check"><input type="checkbox" name="tilt"><span>Leicht schräg</span></label><label class="check"><input type="checkbox" name="worn"><span>Stempel-Optik</span></label></div>
      <div class="ss-row"><span class="field-label">Farbe</span><span data-colors class="pt-swatches"></span></div>
      <div class="ss-row"><span class="field-label">Rahmen</span><div class="seg ss-borders" role="group">${BORDERS.map(([v, l]) => `<button type="button" data-border="${v}">${l}</button>`).join('')}</div></div>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Stempel speichern', value: 'ok', kind: 'btn-primary', default: true }],
    validate: (v, dlg) => {
      if (v !== 'ok') return true;
      if (!dlg.querySelector('[name=lines]').value.trim() && !dlg.querySelector('[name=date]').checked) { toast('Bitte gib einen Stempeltext ein.', 'error'); return false; }
      return true;
    },
    onMount: dlg => {
      const prev = dlg.querySelector('.ss-stamp-prev canvas');
      const f = n => dlg.querySelector(`[name=${n}]`);
      const sync = () => {
        f('lines').value = (spec.lines || []).join('\n');
        f('date').checked = !!spec.date; f('tilt').checked = !!spec.tilt; f('worn').checked = spec.worn !== false;
        f('dateText').value = spec.dateText || ''; f('dateText').disabled = !spec.date;
        dlg.querySelectorAll('[data-border]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.border === spec.border)));
        dlg.querySelectorAll('[data-colors] .pt-swatch').forEach(b => b.setAttribute('aria-checked', String(b.dataset.c === spec.color)));
        draw();
      };
      const draw = () => {
        const c = renderStamp(spec, 3);
        prev.width = c.width; prev.height = c.height;
        prev.getContext('2d').drawImage(c, 0, 0);
        prev.style.width = `${Math.min(c.width / 3 * 1.4, 420)}px`;
        c.width = 0;
      };
      const colors = dlg.querySelector('[data-colors]');
      STAMP_COLORS.forEach(({ c, n }) => {
        const b = h(`<button type="button" class="pt-swatch" role="radio" data-c="${c}" aria-label="${n}" style="--sw:${c}"></button>`);
        b.addEventListener('click', () => { spec.color = c; sync(); });
        colors.appendChild(b);
      });
      dlg.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
        const p = STAMP_PRESETS.find(x => x.id === b.dataset.preset);
        spec = { ...spec, ...p, lines: [...p.lines], dateText: '' };
        sync();
      }));
      dlg.querySelectorAll('[data-border]').forEach(b => b.addEventListener('click', () => { spec.border = b.dataset.border; sync(); }));
      dlg.addEventListener('input', e => {
        if (e.target.name === 'lines') spec.lines = e.target.value.split('\n').slice(0, 6);
        if (e.target.name === 'dateText') spec.dateText = e.target.value;
        if (['date', 'tilt', 'worn'].includes(e.target.name)) { spec[e.target.name] = e.target.checked; f('dateText').disabled = !spec.date; }
        draw();
      });
      sync();
      canvasApi = { collect: () => spec };
      return canvasApi;
    },
  });
  if (r.value !== 'ok' || !r.data) return null;
  const s = { ...r.data, lines: (r.data.lines || []).map(l => l.trim()).filter(Boolean) };
  const c = renderStamp(s, 5);
  const t = await trimCanvas(c, 2);
  c.width = 0;
  if (!t) return null;
  return { ...t, spec: s, name: s.lines[0] || 'Stempel' };
}

// ------------------------------------------------------------------ signature creation
/** Create a signature or initials: draw, type or import. → {blob, w, h, name} or null */
export async function createSignature(kind = 'signature') {
  await ensureCss();
  let mode = 'draw';
  let color = SIG_COLORS[0].c;
  let font = SCRIPT_FONTS[0];
  let imported = null;
  let pad = null;
  const label = KIND[kind] ? KIND[kind].one : 'Unterschrift';
  const r = await openDialog({
    title: kind === 'initials' ? 'Initialen erstellen' : 'Unterschrift erstellen',
    wide: true,
    body: `<div class="seg pt-seg-full ss-modes" role="tablist"><button type="button" data-mode="draw">${icon('pen')} Zeichnen</button><button type="button" data-mode="type">${icon('text')} Tippen</button><button type="button" data-mode="image">${icon('image')} Bild</button></div>
      <div data-pane="draw">
        <div class="sig-pad-wrap ss-pad ${kind === 'initials' ? 'ss-pad-small' : ''}"><canvas class="sig-pad" aria-label="Zeichenfläche"></canvas><div class="sig-pad-line"></div><div class="sig-pad-hint">Mit Finger, Stift oder Maus ${kind === 'initials' ? 'Initialen schreiben' : 'unterschreiben'}</div></div>
        <div class="ss-row"><button type="button" class="btn btn-ghost btn-sm" data-clear>${icon('undo')} Neu zeichnen</button></div>
      </div>
      <div data-pane="type" hidden>
        <label class="field"><span class="field-label">${kind === 'initials' ? 'Initialen' : 'Dein Name'}</span><input class="input" name="typed" maxlength="60" placeholder="${kind === 'initials' ? 'z. B. M. M.' : 'z. B. Max Mustermann'}"></label>
        <div class="ss-fonts" role="radiogroup" aria-label="Schriftstil"></div>
        <p class="hint">Die Schrift kommt von deinem Gerät – je nach System sieht sie etwas anders aus.</p>
      </div>
      <div data-pane="image" hidden>
        <button type="button" class="btn btn-soft btn-block" data-pickimg>${icon('image')} Foto oder Scan der Unterschrift wählen</button>
        <label class="check"><input type="checkbox" name="clearbg" checked><span>Weißen Hintergrund entfernen</span></label>
        <div class="ss-imgprev" data-imgprev hidden><canvas></canvas></div>
      </div>
      <div class="ss-row"><span class="field-label">Farbe</span><span data-colors class="pt-swatches"></span><span class="grow"></span>
        <label class="check"><input type="checkbox" name="keep" checked><span>Speichern (nur auf diesem Gerät)</span></label></div>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Übernehmen', value: 'ok', kind: 'btn-primary', default: true }],
    validate: (v, dlg) => {
      if (v !== 'ok') return true;
      if (mode === 'draw' && pad.isEmpty()) { toast(`Bitte zeichne zuerst ${kind === 'initials' ? 'deine Initialen' : 'deine Unterschrift'}.`, 'error'); return false; }
      if (mode === 'type' && !dlg.querySelector('[name=typed]').value.trim()) { toast('Bitte gib einen Text ein.', 'error'); return false; }
      if (mode === 'image' && !imported) { toast('Bitte wähle zuerst ein Bild.', 'error'); return false; }
      return true;
    },
    onMount: dlg => {
      const setMode = m => {
        mode = m;
        dlg.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
        dlg.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== m; });
        if (m === 'draw') requestAnimationFrame(() => pad.fit());
        if (m === 'type') setTimeout(() => dlg.querySelector('[name=typed]').focus(), 30);
      };
      dlg.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
      const colors = dlg.querySelector('[data-colors]');
      SIG_COLORS.forEach(({ c, n }) => {
        const b = h(`<button type="button" class="pt-swatch" role="radio" aria-checked="${c === color}" aria-label="${n}" style="--sw:${c}"></button>`);
        b.addEventListener('click', () => { color = c; colors.querySelectorAll('.pt-swatch').forEach(x => x.setAttribute('aria-checked', String(x === b))); pad.setColor(c); renderFonts(); renderImg(); });
        colors.appendChild(b);
      });
      // typed
      const fontsBox = dlg.querySelector('.ss-fonts');
      const typed = dlg.querySelector('[name=typed]');
      const renderFonts = () => {
        fontsBox.innerHTML = '';
        const text = typed.value.trim() || (kind === 'initials' ? 'M. M.' : 'Max Mustermann');
        SCRIPT_FONTS.forEach(f => {
          const b = h(`<button type="button" class="ss-font" role="radio" aria-checked="${f === font}" aria-label="${esc(f.label)}"><span class="ss-font-sample" style="font-family:${esc(f.css)};font-weight:${f.weight};font-style:${f.italic ? 'italic' : 'normal'};color:${color}">${esc(text)}</span><small>${esc(f.label)}</small></button>`);
          b.addEventListener('click', () => { font = f; renderFonts(); });
          fontsBox.appendChild(b);
        });
      };
      typed.addEventListener('input', renderFonts);
      renderFonts();
      // image
      const renderImg = () => {
        if (!imported) return;
        const box = dlg.querySelector('[data-imgprev]');
        const c = box.querySelector('canvas');
        const out = processImported(imported, dlg.querySelector('[name=clearbg]').checked, color);
        c.width = out.width; c.height = out.height;
        c.getContext('2d').drawImage(out, 0, 0);
        box.hidden = false;
      };
      dlg.querySelector('[name=clearbg]').addEventListener('change', renderImg);
      dlg.querySelector('[data-pickimg]').addEventListener('click', async () => {
        const [file] = await pickFiles({ accept: 'image/*', multiple: false, parent: dlg });
        if (!file) return;
        try {
          const bmp = await createImageBitmap(file);
          const f = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
          const c = document.createElement('canvas');
          c.width = Math.round(bmp.width * f); c.height = Math.round(bmp.height * f);
          c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
          bmp.close && bmp.close();
          imported = c;
          renderImg();
        } catch (e) { errorToast(e, 'Das Bild konnte nicht gelesen werden.'); }
      });
      pad = setupPad(dlg.querySelector('.ss-pad'), color);
      dlg.querySelector('[data-clear]').addEventListener('click', () => pad.clear());
      setMode('draw');
      return {
        collect: () => ({
          keep: dlg.querySelector('[name=keep]').checked,
          make: async () => {
            if (mode === 'draw') return trimCanvas(pad.canvas, 8);
            if (mode === 'type') { const c = typedCanvas(typed.value.trim(), font, color, kind === 'initials' ? 110 : 120); const t = await trimCanvas(c, 10); c.width = 0; return t; }
            const c = processImported(imported, dlg.querySelector('[name=clearbg]').checked, color);
            return trimCanvas(c, 6);
          },
          name: mode === 'type' ? typed.value.trim() : '',
        }),
      };
    },
  });
  if (r.value !== 'ok' || !r.data) return null;
  const made = await r.data.make();
  if (!made) return null;
  const res = { ...made, kind, name: r.data.name || label };
  if (r.data.keep) {
    try { res.id = await addAsset({ blob: made.blob, kind, name: res.name, w: made.w, h: made.h }); }
    catch (e) { console.warn(e); toast('Konnte nicht gespeichert werden – wird nur jetzt verwendet.', 'info'); }
  }
  return res;
}

/** Imported photo of a signature: make light background transparent, recolour ink. */
function processImported(src, clearBg, color) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  if (!clearBg) return c;
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  // background level from the brighter pixels
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 16) hist[(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0]++;
  let total = 0; for (const v of hist) total += v;
  let acc = 0, bg = 230;
  for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > total * 0.5) { bg = i; break; } }
  const [cr, cg, cb] = [1, 3, 5].map(k => parseInt(color.slice(k, k + 2), 16));
  for (let i = 0; i < d.length; i += 4) {
    const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    const a = Math.max(0, Math.min(1, (bg - 18 - l) / Math.max(30, bg * 0.5)));
    d[i] = cr; d[i + 1] = cg; d[i + 2] = cb; d[i + 3] = Math.round(Math.pow(a, 0.8) * 255);
  }
  g.putImageData(img, 0, 0);
  return c;
}

function setupPad(wrap, initialColor) {
  const canvas = wrap.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  let color = initialColor;
  let strokes = 0, last = null, lastW = 2.2;
  const fit = () => {
    const r = canvas.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.max(2, window.devicePixelRatio || 1);
    const snap = strokes ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null;
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (snap) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.putImageData(snap, 0, 0); ctx.restore(); }
  };
  requestAnimationFrame(fit);
  const pos = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, p: e.pressure || 0.5, t: e.timeStamp }; };
  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    last = pos(e); lastW = 2.2;
    strokes++;
    wrap.querySelector('.sig-pad-hint').hidden = true;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(last.x, last.y, 1.2, 0, Math.PI * 2); ctx.fill();
  });
  canvas.addEventListener('pointermove', e => {
    if (!last) return;
    const pts = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const pe of (pts.length ? pts : [e])) {
      const p = pos(pe);
      const d = Math.hypot(p.x - last.x, p.y - last.y);
      if (d < 0.6) continue;
      const v = d / Math.max(1, p.t - last.t);
      // faster strokes → thinner line; pen pressure → thicker
      const target = Math.max(1.1, Math.min(3.6, 3.3 - v * 1.1 + (e.pointerType === 'pen' ? (p.p - 0.5) * 2 : 0)));
      lastW = lastW * 0.7 + target * 0.3;
      ctx.strokeStyle = color;
      ctx.lineWidth = lastW;
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.quadraticCurveTo(last.x, last.y, (last.x + p.x) / 2, (last.y + p.y) / 2);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
    }
  });
  const stop = () => { last = null; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  return {
    canvas, fit,
    isEmpty: () => strokes === 0,
    clear: () => { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.restore(); strokes = 0; wrap.querySelector('.sig-pad-hint').hidden = false; },
    setColor: c => {
      color = c;
      // recolour what is already drawn
      if (!strokes) return;
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const [r, g, b] = [1, 3, 5].map(k => parseInt(c.slice(k, k + 2), 16));
      for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3]) { img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; }
      ctx.putImageData(img, 0, 0);
    },
  };
}

// ------------------------------------------------------------------ picker (one tap to use)
/**
 * Choose a saved signature / initials / stamp or create a new one.
 * @param {{tab?: 'signature'|'initials'|'stamp', kinds?: string[], title?: string}} [opts]
 * @returns {Promise<{blob, url, w, h, kind, name}|null>}  url is an object URL (caller revokes when done)
 */
export async function pickAsset({ tab = 'signature', kinds = ['signature', 'initials', 'stamp'], title = 'Unterschrift oder Stempel' } = {}) {
  await ensureCss();
  let chosen = null, createKind = null;
  const urls = [];
  let current = kinds.includes(tab) ? tab : kinds[0];
  // nothing saved yet for this kind: go straight to creating one (one tap less)
  if (!(await listAssets(current)).length) {
    const made = current === 'stamp' ? await stampDesigner() : await createSignature(current);
    if (!made) return null;
    if (current === 'stamp') {
      try { made.id = await addAsset({ blob: made.blob, kind: 'stamp', name: made.name, spec: made.spec, w: made.w, h: made.h }); } catch (e) { console.warn(e); }
    }
    made.kind = current;
    made.url = URL.createObjectURL(made.blob);
    return made;
  }
  const r = await openDialog({
    title,
    wide: true,
    body: `<div class="tabs ss-tabs" role="tablist">${kinds.map(k => `<button class="tab" role="tab" type="button" data-tab="${k}">${KIND[k].label}</button>`).join('')}</div>
      <div class="ss-grid" data-grid></div>
      <button type="submit" value="pick" hidden data-picksubmit></button><button type="submit" value="new" hidden data-newsubmit></button>`,
    actions: [{ label: 'Abbrechen', value: 'cancel' }],
    onMount: dlg => {
      const grid = dlg.querySelector('[data-grid]');
      const render = async () => {
        dlg.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === current)));
        grid.innerHTML = '<span class="spinner dark"></span>';
        const items = await listAssets(current);
        grid.innerHTML = '';
        const add = h(`<button type="button" class="ss-item ss-new">${icon('plus')}<span>${current === 'stamp' ? 'Neuer Stempel' : current === 'initials' ? 'Neue Initialen' : 'Neue Unterschrift'}</span></button>`);
        add.addEventListener('click', () => { createKind = current; dlg.querySelector('form').requestSubmit(dlg.querySelector('[data-newsubmit]')); });
        grid.appendChild(add);
        items.forEach(a => {
          const url = URL.createObjectURL(a.blob);
          urls.push(url);
          const el = h(`<div class="ss-item sig-saved-item" role="button" tabindex="0" aria-label="${esc(a.name || KIND[a.kind].one)} verwenden"><img src="${url}" alt=""><button type="button" class="icon-btn ss-del" aria-label="Löschen">${icon('trash')}</button></div>`);
          const use = () => { chosen = a; dlg.querySelector('form').requestSubmit(dlg.querySelector('[data-picksubmit]')); };
          el.addEventListener('click', e => { if (!e.target.closest('.ss-del')) use(); });
          el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); use(); } });
          el.querySelector('.ss-del').addEventListener('click', async e => {
            e.stopPropagation();
            await deleteAsset(a.id);
            el.remove();
            toast(`${KIND[a.kind].one} gelöscht`);
          });
          grid.appendChild(el);
        });
        if (!items.length) grid.appendChild(h(`<p class="muted small ss-emptyhint">Noch nichts gespeichert – lege ${current === 'stamp' ? 'einen Stempel' : current === 'initials' ? 'deine Initialen' : 'deine Unterschrift'} an. Sie bleiben nur auf diesem Gerät.</p>`));
      };
      dlg.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { current = b.dataset.tab; render(); }));
      render();
      return null;
    },
  });
  urls.forEach(u => URL.revokeObjectURL(u));
  let res = null;
  if (r.value === 'pick' && chosen) {
    res = { blob: chosen.blob, w: chosen.w, h: chosen.h, kind: chosen.kind, name: chosen.name, id: chosen.id };
    updateAsset(chosen.id, { usedAt: Date.now() }).catch(() => {});
  } else if (r.value === 'new' && createKind) {
    res = createKind === 'stamp' ? await stampDesigner() : await createSignature(createKind);
    if (res && createKind === 'stamp') {
      try { res.id = await addAsset({ blob: res.blob, kind: 'stamp', name: res.name, spec: res.spec, w: res.w, h: res.h }); } catch (e) { console.warn(e); }
      res.kind = 'stamp';
    }
  }
  if (!res) return null;
  if (!res.w || !res.h) {
    const bmp = await createImageBitmap(res.blob);
    res.w = bmp.width; res.h = bmp.height;
    bmp.close && bmp.close();
  }
  res.url = URL.createObjectURL(res.blob);
  return res;
}

// ------------------------------------------------------------------ tool screen
export async function mount(screen) {
  await ensureCss();
  screen.setTitle('Unterschriften & Stempel', 'Deine Bibliothek – nur auf diesem Gerät');
  const urls = [];
  const wrap = h(`<div class="screen-inner ss-screen">
    <div class="card intro"><span class="tile-ic">${icon('stamp')}</span><div><strong>Einmal anlegen, mit einem Tipp einsetzen</strong>
      <p>Gespeicherte Unterschriften, Initialen und Stempel stehen in „Ausfüllen &amp; unterschreiben“ und „Kommentieren“ bereit. Alles bleibt auf deinem Gerät.</p></div></div>
    <div data-sections></div></div>`);
  screen.body.appendChild(wrap);
  const box = wrap.querySelector('[data-sections]');
  async function render() {
    urls.splice(0).forEach(u => URL.revokeObjectURL(u));
    box.innerHTML = '';
    for (const k of KINDS) {
      const items = await listAssets(k.id);
      const sec = h(`<section class="ss-section"><div class="ss-sechead"><h2 class="section-title">${k.label}</h2><span class="muted small">${items.length || ''}</span></div><div class="ss-grid"></div></section>`);
      const grid = sec.querySelector('.ss-grid');
      const add = h(`<button type="button" class="ss-item ss-new">${icon('plus')}<span>${k.id === 'stamp' ? 'Stempel gestalten' : k.id === 'initials' ? 'Initialen anlegen' : 'Unterschrift anlegen'}</span></button>`);
      add.addEventListener('click', async () => {
        if (k.id === 'stamp') {
          const s = await stampDesigner();
          if (s) { await addAsset({ blob: s.blob, kind: 'stamp', name: s.name, spec: s.spec, w: s.w, h: s.h }); toast('Stempel gespeichert.', 'success'); }
        } else {
          const s = await createSignature(k.id);
          if (s && !s.id) toast('Nicht gespeichert (Häkchen „Speichern“ war aus).', 'info');
          else if (s) toast(`${k.one} gespeichert.`, 'success');
        }
        render();
      });
      grid.appendChild(add);
      items.forEach(a => {
        const url = URL.createObjectURL(a.blob);
        urls.push(url);
        const el = h(`<div class="ss-item ss-manage"><img src="${url}" alt="${esc(a.name || k.one)}"><span class="ss-foot"><span class="ss-name">${esc(a.name || k.one)}</span>
          <span class="ss-acts">${a.kind === 'stamp' && a.spec ? `<button type="button" class="icon-btn" data-edit aria-label="Bearbeiten">${icon('edit')}</button>` : `<button type="button" class="icon-btn" data-ren aria-label="Umbenennen">${icon('edit')}</button>`}
          <button type="button" class="icon-btn" data-del aria-label="Löschen">${icon('trash')}</button></span></span></div>`);
        const del = el.querySelector('[data-del]');
        del.addEventListener('click', async () => {
          if (!(await confirmDialog(`${k.one} löschen?`, 'Das kann nicht rückgängig gemacht werden.', { okLabel: 'Löschen', danger: true }))) return;
          await deleteAsset(a.id); render();
        });
        const ren = el.querySelector('[data-ren]');
        if (ren) ren.addEventListener('click', async () => {
          const n = await promptDialog('Umbenennen', 'Name', a.name || k.one);
          if (n == null) return;
          await updateAsset(a.id, { name: n.trim() || k.one }); render();
        });
        const ed = el.querySelector('[data-edit]');
        if (ed) ed.addEventListener('click', async () => {
          const s = await stampDesigner(a.spec);
          if (!s) return;
          await updateAsset(a.id, { blob: s.blob, spec: s.spec, name: s.name, w: s.w, h: s.h });
          render();
        });
        grid.appendChild(el);
      });
      box.appendChild(sec);
    }
  }
  await render();
  screen.setFoot([]);
  return () => urls.forEach(u => URL.revokeObjectURL(u));
}
