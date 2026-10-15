// Shared UI of the "Vorlagen" pack (no file intake, a form on the stage, PDF via lib/tpl-pdf.js): stylesheet,
// bound form controls (big touch targets), repeatable entry lists with reorder, finger signature pad, copy
// text, opt-in "remember" (localStorage) and drafts (IndexedDB), live PDF preview rendered with pdf.js.
import { el, icon, clear } from './dom.js';
import { pick } from './strings.js';
import { ensureCss as ensureImgCss, newCanvas, ctx2d, release } from './img-core.js';
import { isoDate, fmtDate, addDays, parseNum, money } from './new-invoice.js';

export { el, icon, clear, isoDate, fmtDate, addDays, parseNum, money };
export const T = (lang, v) => pick(lang, v);
export const userError = (de, en) => Object.assign(new Error(en), { userMessage: { de, en } });
export const s = v => String(v ?? '').trim();

let cssReady = null;
export function ensureCss() {
  ensureImgCss();
  if (!cssReady) {
    cssReady = new Promise(resolve => {
      const href = new URL('./tpl.css', import.meta.url).href;
      if (document.querySelector(`link[href="${href}"]`)) { resolve(); return; }
      const link = el('link', { rel: 'stylesheet', href });
      link.addEventListener('load', () => resolve());
      link.addEventListener('error', () => resolve());
      document.head.append(link);
    });
  }
  return cssReady;
}

// ---------------------------------------------------------------- storage (opt-in)
export const local = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

/** "Remember on this device" checkbox: restores `fields` of v from localStorage[key] and keeps them in sync. */
export function remember({ key, fields, v, lang, label = { de: 'Absender auf diesem Gerät merken', en: 'Remember sender on this device' }, id = 'tpl-remember' }) {
  const saved = local.get(key);
  let on = !!(saved && typeof saved === 'object');
  if (on) for (const k of fields) if (typeof saved[k] === 'string' && !v[k]) v[k] = saved[k];
  const save = () => local.set(key, on ? Object.fromEntries(fields.map(k => [k, String(v[k] ?? '')])) : null);
  const box = checkRow({ id, label, checked: on, lang, hint: { de: 'Wird nur in diesem Browser gespeichert. Ausschalten löscht die gespeicherten Daten.', en: 'Stored only in this browser. Switching off deletes the stored data.' },
    onChange: x => { on = x; save(); } });
  return { box, save: () => { if (on) save(); }, fields };
}

/** Tiny IndexedDB key/value store for drafts (CV, cover letter). All methods fail soft. */
export const drafts = (() => {
  let dbp = null;
  const open = () => (dbp ||= new Promise((res, rej) => {
    try {
      const r = indexedDB.open('fale-wt-tpl', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('drafts');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    } catch (err) { rej(err); }
  }));
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => { const t = db.transaction('drafts', mode); const st = t.objectStore('drafts'); const q = fn(st); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); });
  };
  return {
    get: k => tx('readonly', st => st.get(k)).catch(() => null),
    set: (k, v) => tx('readwrite', st => st.put(v, k)).catch(err => { console.warn('draft', err); }),
    del: k => tx('readwrite', st => st.delete(k)).catch(() => {}),
  };
})();

// ---------------------------------------------------------------- form controls
let uid = 0;
export const nextId = p => `${p}-${++uid}`;

export function checkRow({ id, label, checked, lang, onChange, hint = null }) {
  const input = el('input', { id, type: 'checkbox', checked: !!checked, aria: { describedby: hint ? id + '-hint' : null }, onchange: e => onChange(e.target.checked) });
  return el('div', { class: 'img-check' }, el('label', { for: id }, input, el('span', {}, T(lang, label))),
    hint ? el('p', { class: 'wt-opt-hint', id: id + '-hint' }, T(lang, hint)) : null);
}

/**
 * Bound controls for one object. f = form(v, lang, changed, 'tpl') →
 *   f.field(key, label, {type, hint, placeholder, wide, autocomplete, inputmode, obj, id, maxLength, validate})
 *   f.area(key, label, {rows, hint, placeholder}), f.select(key, label, choices, {onChange}), f.check(key, label, {hint, onChange}),
 *   f.seg(key, label, choices, {onChange}), f.sec(id, title, ...kids), f.grid(...kids)
 * Ids: `${prefix}-${key}` (the first control of a key) – tests and labels rely on them.
 */
export function form(v, lang, changed, prefix = 'tpl') {
  const used = new Set();
  const idFor = (key, obj, id) => {
    if (id) return id;
    // controls of the main object keep a stable id (re-rendered blocks replace the old control); others get a unique one
    const base = `${prefix}-${key}`;
    if (obj === v) { used.add(base); return base; }
    return nextId(base);
  };
  const f = {
    field(key, label, { type = 'text', hint = null, placeholder = '', wide = false, autocomplete = 'off', inputmode = null, obj = v, id = null, maxLength = 200, validate = null, onInput = null } = {}) {
      id = idFor(key, obj, id);
      const err = el('p', { class: 'tpl-err', id: id + '-err', hidden: true });
      const input = el('input', { id, class: 'wt-input', type, value: obj[key] ?? '', placeholder: T(lang, placeholder) || null, autocomplete, inputmode,
        maxlength: type === 'date' ? null : String(maxLength), aria: { describedby: [hint ? id + '-hint' : '', id + '-err'].filter(Boolean).join(' ') } });
      const check = () => { const m = validate ? validate(input.value) : ''; err.textContent = m ? T(lang, m) : ''; err.hidden = !m; input.setAttribute('aria-invalid', String(!!m)); };
      input.addEventListener('input', () => { obj[key] = input.value; check(); onInput?.(input.value); changed(key); });
      if (obj[key]) check();
      return el('div', { class: 'tpl-f' + (wide ? ' tpl-f-wide' : '') }, el('label', { for: id }, T(lang, label)), input,
        hint ? el('p', { class: 'wt-opt-hint', id: id + '-hint' }, T(lang, hint)) : null, err);
    },
    area(key, label, { rows = 4, hint = null, placeholder = '', obj = v, id = null, maxLength = 4000 } = {}) {
      id = idFor(key, obj, id);
      const ta = el('textarea', { id, class: 'tpl-area', rows: String(rows), placeholder: T(lang, placeholder) || null, maxlength: String(maxLength), aria: { describedby: hint ? id + '-hint' : null } });
      ta.value = obj[key] ?? '';
      ta.addEventListener('input', () => { obj[key] = ta.value; changed(key); });
      return el('div', { class: 'tpl-f tpl-f-wide' }, el('label', { for: id }, T(lang, label)), hint ? el('p', { class: 'wt-opt-hint tpl-hint-top', id: id + '-hint' }, T(lang, hint)) : null, ta);
    },
    select(key, label, choices, { obj = v, id = null, onChange = null, wide = false, hint = null } = {}) {
      id = idFor(key, obj, id);
      const sel = el('select', { id, class: 'wt-input', aria: { describedby: hint ? id + '-hint' : null } }, choices.map(c => el('option', { value: String(c.value), selected: String(obj[key]) === String(c.value) }, T(lang, c.label))));
      sel.addEventListener('change', () => { obj[key] = sel.value; onChange?.(sel.value); changed(key); });
      return el('div', { class: 'tpl-f' + (wide ? ' tpl-f-wide' : '') }, el('label', { for: id }, T(lang, label)), sel, hint ? el('p', { class: 'wt-opt-hint', id: id + '-hint' }, T(lang, hint)) : null);
    },
    check(key, label, { obj = v, id = null, hint = null, onChange = null } = {}) {
      id = idFor(key, obj, id);
      return checkRow({ id, label, checked: !!obj[key], lang, hint, onChange: x => { obj[key] = x; onChange?.(x); changed(key); } });
    },
    seg(key, label, choices, { obj = v, onChange = null } = {}) {
      const name = idFor(key, obj, null);
      return el('fieldset', { class: 'img-seg' }, el('legend', { class: 'img-seg-legend' }, T(lang, label)),
        el('div', { class: 'img-seg-row' }, choices.map(c => el('label', { class: 'img-seg-opt' },
          el('input', { type: 'radio', name, value: String(c.value), checked: String(c.value) === String(obj[key]), onchange: () => { obj[key] = c.value; onChange?.(c.value); changed(key); } }),
          el('span', {}, T(lang, c.label))))));
    },
    sec(id, title, ...kids) { return el('section', { class: 'img-box tpl-sec', aria: { labelledby: id } }, el('h2', { class: 'img-h', id }, T(lang, title)), ...kids); },
    grid(...kids) { return el('div', { class: 'tpl-grid' }, ...kids); },
  };
  return f;
}

/** Info / hint box (honest legal notes). */
export const note = (lang, text, cls = '') => el('p', { class: 'tpl-note ' + cls }, icon('alert'), el('span', {}, T(lang, text)));

/**
 * Repeatable entries with move up/down and remove (48 px buttons). items: array (mutated), render(item, i) → node,
 * make() → new item, labels {add, item(i)}. Returns { root, render() }.
 */
export function entryList({ items, render, make, lang, onChange, labels, min = 0, max = 50, cls = '' }) {
  const list = el('ol', { class: 'tpl-entries ' + cls });
  const addBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet tpl-add' }, icon('plus'), T(lang, labels.add));
  addBtn.addEventListener('click', () => { if (items.length >= max) return; items.push(make()); draw(); onChange(); list.lastElementChild?.querySelector('input, textarea, select')?.focus(); });
  function draw() {
    clear(list);
    items.forEach((it, i) => {
      const name = T(lang, labels.item(i, it));
      const btn = (ic, lab, fn, dis) => el('button', { type: 'button', class: 'wt-icon-btn tpl-ib', disabled: dis, aria: { label: lab }, title: lab, onclick: fn }, icon(ic));
      const de = lang === 'de';
      const move = d => { const j = i + d; [items[i], items[j]] = [items[j], items[i]]; draw(); onChange(); list.children[j]?.querySelector(d < 0 ? '.tpl-up' : '.tpl-down')?.focus(); };
      const up = btn('up', de ? `${name} nach oben` : `Move ${name} up`, () => move(-1), i === 0); up.classList.add('tpl-up');
      const down = btn('down', de ? `${name} nach unten` : `Move ${name} down`, () => move(1), i === items.length - 1); down.classList.add('tpl-down');
      const rm = btn('close', de ? `${name} entfernen` : `Remove ${name}`, () => { items.splice(i, 1); draw(); onChange(); (list.children[Math.min(i, items.length - 1)]?.querySelector('input') || addBtn).focus(); }, items.length <= min);
      list.append(el('li', { class: 'tpl-entry' }, el('div', { class: 'tpl-entry-head' }, el('span', { class: 'tpl-entry-name' }, name), el('span', { class: 'tpl-entry-btns' }, up, down, rm)), render(it, i)));
    });
    addBtn.hidden = items.length >= max;
  }
  draw();
  return { root: el('div', {}, list, addBtn), render: draw };
}

// ---------------------------------------------------------------- signature pad (finger / mouse)
export function signaturePad(lang, onChange, { label = { de: 'Unterschriftsfeld – mit Finger oder Maus unterschreiben', en: 'Signature field – sign with your finger or mouse' }, cls = '' } = {}) {
  const canvas = el('canvas', { class: 'img-sig-canvas', width: 900, height: 300, aria: { label: T(lang, label) }, role: 'img' });
  const g = ctx2d(canvas, true);
  let drawing = false, last = null, ink = false;
  const pos = ev => { const r = canvas.getBoundingClientRect(); return [(ev.clientX - r.left) * canvas.width / r.width, (ev.clientY - r.top) * canvas.height / r.height]; };
  const dot = p => { g.fillStyle = '#141a3a'; g.beginPath(); g.arc(p[0], p[1], 2.5, 0, Math.PI * 2); g.fill(); ink = true; };
  canvas.addEventListener('pointerdown', ev => { ev.preventDefault(); drawing = true; last = pos(ev); try { canvas.setPointerCapture(ev.pointerId); } catch { /* optional */ } dot(last); });
  canvas.addEventListener('pointermove', ev => {
    if (!drawing) return;
    const p = pos(ev);
    g.strokeStyle = '#141a3a'; g.lineWidth = 5; g.lineCap = 'round'; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(last[0], last[1]); g.lineTo(p[0], p[1]); g.stroke();
    last = p; ink = true;
  });
  const end = () => { if (drawing) { drawing = false; onChange(); } };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  const clearBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm', onclick: () => { g.clearRect(0, 0, canvas.width, canvas.height); ink = false; onChange(); } }, icon('close'), T(lang, { de: 'Löschen', en: 'Clear' }));
  let cached = null, cachedFor = -1, strokes = 0;
  canvas.addEventListener('pointerup', () => { strokes++; });
  clearBtn.addEventListener('click', () => { strokes++; });
  return {
    root: el('div', { class: 'img-sig ' + cls }, el('div', { class: 'img-sig-box' }, canvas, el('span', { class: 'img-sig-line', 'aria-hidden': 'true' })), el('div', { class: 'img-btn-row' }, clearBtn)),
    has: () => ink,
    /** PNG of the ink, cropped to its bounding box ({bytes, width, height}) or null. Cached until the next stroke. */
    async export() {
      if (!ink) return null;
      if (cached && cachedFor === strokes) return cached;
      const d = g.getImageData(0, 0, canvas.width, canvas.height).data;
      let x0 = canvas.width, y0 = canvas.height, x1 = 0, y1 = 0;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (d[(y * canvas.width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < x0) return null;
      const c = newCanvas(x1 - x0 + 9, y1 - y0 + 9);
      ctx2d(c).drawImage(canvas, x0 - 4, y0 - 4, c.width, c.height, 0, 0, c.width, c.height);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      cached = { bytes: new Uint8Array(await blob.arrayBuffer()), width: c.width, height: c.height };
      cachedFor = strokes;
      release(c);
      return cached;
    },
  };
}

// ---------------------------------------------------------------- copy text
export async function copyToClipboard(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
  const ta = el('textarea', { class: 'img-sr', 'aria-hidden': 'true' });
  ta.value = text; document.body.append(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}
/** "Copy text" button with a status line; getText() → string. */
export function copyButton(getText, lang, label = { de: 'Text kopieren', en: 'Copy text' }) {
  const msg = el('span', { class: 'img-muted tpl-copy-msg', role: 'status' });
  let timer = 0;
  const btn = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet', onclick: async () => {
    const ok = await copyToClipboard(getText());
    msg.textContent = T(lang, ok ? { de: 'Text kopiert.', en: 'Text copied.' } : { de: 'Kopieren nicht möglich – markiere den Text in der Vorschau.', en: 'Copying isn’t possible – select the text in the preview.' });
    clearTimeout(timer); timer = setTimeout(() => { msg.textContent = ''; }, 4000);
  } }, icon('file'), T(lang, label));
  return el('div', { class: 'img-btn-row' }, btn, msg);
}

// ---------------------------------------------------------------- live PDF preview
/**
 * Rendered preview of the PDF the tool will create. pv = pdfPreview(lang); pv.schedule(build) with
 * build() → Promise<Uint8Array>; renders all pages (max 4) at the container width, drops stale renders.
 */
export function pdfPreview(lang, { maxPages = 4 } = {}) {
  const pages = el('div', { class: 'tpl-pv-pages' });
  const status = el('p', { class: 'img-muted tpl-pv-status', role: 'status', aria: { live: 'polite' } });
  const root = el('div', { class: 'tpl-pv' }, pages, status);
  let seq = 0, timer = 0, build = null, busy = false, again = false, waiting = false;
  async function render() {
    if (busy) { again = true; return; }
    busy = true;
    const my = ++seq;
    try {
      const bytes = await build();
      if (my !== seq) return;
      const { openPdfjs, renderPage } = await import('./pdf.js');
      const pdf = await openPdfjs(bytes);
      const n = pdf.numPages;
      const width = Math.max(240, Math.min(720, pages.clientWidth || root.clientWidth || 360));
      const canvases = [];
      for (let i = 1; i <= Math.min(n, maxPages); i++) {
        const page = await pdf.getPage(i);
        const c = await renderPage(page, { width, dpr: Math.min(2, window.devicePixelRatio || 1) });
        c.className = 'tpl-pv-page';
        c.setAttribute('role', 'img');
        c.setAttribute('aria-label', T(lang, { de: `Vorschau Seite ${i} von ${n}`, en: `Preview page ${i} of ${n}` }));
        canvases.push(c);
        page.cleanup?.();
      }
      pdf.destroy();
      if (my !== seq) { canvases.forEach(c => release(c)); return; }
      [...pages.children].forEach(c => release(c));
      clear(pages).append(...canvases);
      status.textContent = n > maxPages ? T(lang, { de: `${n} Seiten – die Vorschau zeigt die ersten ${maxPages}.`, en: `${n} pages – the preview shows the first ${maxPages}.` })
        : T(lang, n === 1 ? { de: '1 Seite', en: '1 page' } : { de: `${n} Seiten`, en: `${n} pages` });
      root.dataset.pages = String(n);
    } catch (err) {
      console.warn('preview', err);
      status.textContent = T(lang, { de: 'Vorschau gerade nicht möglich.', en: 'Preview not available right now.' });
    } finally {
      busy = false;
      if (again) { again = false; render(); } else if (!waiting) root.dataset.state = 'ready';
    }
  }
  return {
    root,
    schedule(fn, delay = 450) { build = fn; clearTimeout(timer); root.dataset.state = 'pending'; waiting = true; timer = setTimeout(() => { waiting = false; render(); }, delay); },
  };
}

/** Text preview (pre) – for letters, next to the copy button. */
export const textPreview = (lang, label = { de: 'Vorschau des Brieftexts', en: 'Preview of the letter text' }) =>
  el('pre', { class: 'img-lt-preview', tabindex: '0', aria: { label: T(lang, label) } });

/** Date of a letter line: "Saarbrücken, 15.10.2026" / "Saarbrücken, 15 October 2026". */
export const dateLine = (place, iso, lang) => `${s(place) ? s(place) + ', ' : ''}${fmtDate(iso || isoDate(), lang)}`;

/** Bar status helper: required fields → {ok, hint} for the shell's status hook. */
export function required(list, summary) {
  const miss = list.filter(r => !r.ok);
  if (!miss.length) return { summary };
  return { ok: false, summary, hint: { de: `Noch nötig: ${miss.map(x => x.de).join(', ')}.`, en: `Still needed: ${miss.map(x => x.en).join(', ')}.` } };
}

/** Standard result notes: replaced characters (font) – shared by all tools of the pack. */
export function fontNote(ctx, missing, missingWarning) {
  const mw = missingWarning(missing);
  if (mw) ctx.note(mw);
}
