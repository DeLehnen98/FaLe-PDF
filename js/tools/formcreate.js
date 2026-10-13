// Tool: Formular erstellen — add real, fillable AcroForm fields to any PDF (text, multi-line,
// checkbox, radio group, dropdown, date, signature) by tapping/dragging on the page, with
// properties (name, required, default, options) and an automatic field detection
// ("Felder automatisch erkennen": underscores, label + colon, drawn boxes and lines).
import { icon } from '../icons.js';
import { h, esc, toast, errorToast, progress, baseName, openDialog } from '../ui.js';
import { resultCard } from '../components.js';
import { saveResult } from '../library.js';
import { loadPdf } from '../pdfcore.js';
import { loadEditable, loadPdfLib, saveDoc } from '../pdflib.js';
import { openToolDoc, PageStage, guardLeave, createPan, updateFoot, proBadge, makeSanitizer, tick } from './common.js';
import { pageShapes } from './pagegeom.js';

export const FIELD_TYPES = [
  { id: 'text', label: 'Textfeld', icon: 'textbox', w: 170, h: 22, base: 'Textfeld' },
  { id: 'multiline', label: 'Mehrzeilig', icon: 'note', w: 240, h: 72, base: 'Textbereich' },
  { id: 'check', label: 'Kästchen', icon: 'select', w: 14, h: 14, base: 'Kontrollkästchen' },
  { id: 'radio', label: 'Optionen', icon: 'circle', w: 130, h: 58, base: 'Optionsgruppe' },
  { id: 'dropdown', label: 'Auswahl', icon: 'chevronDown', w: 150, h: 22, base: 'Auswahlliste' },
  { id: 'date', label: 'Datum', icon: 'calendar', w: 100, h: 22, base: 'Datum' },
  { id: 'sign', label: 'Unterschrift', icon: 'sign', w: 190, h: 46, base: 'Unterschrift' },
];
const TYPE = Object.fromEntries(FIELD_TYPES.map(t => [t.id, t]));
const RADIO_ROW = 19;

export async function mount(screen, { docId }) {
  const ctx = await openToolDoc(screen, docId, 'Formular erstellen');
  if (!ctx) return;
  const { doc, bytes } = ctx;
  const { pdf } = await loadPdf(bytes.slice(), { name: doc.name, key: docId });

  // existing fields (kept as they are)
  let existing = [];
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const pg = await pdf.getPage(n);
      const annots = await pg.getAnnotations({ intent: 'display' });
      annots.filter(a => a.subtype === 'Widget' && a.fieldName).forEach(a => existing.push({ page: n, name: a.fieldName, rect: a.rect }));
    }
  } catch { existing = []; }
  const existingNames = new Set(existing.map(e => e.name));

  let fields = [];
  let tool = 'select';
  let selected = null;
  const undoStack = [], redoStack = [];
  let seq = 0;
  let savedSnapshot = '[]';

  screen.body.classList.add('pt-shell');
  screen.body.style.cssText = 'display:flex;flex-direction:column;overflow:hidden';
  const toolbar = h('<div class="pt-toolbar" role="toolbar" aria-label="Feldtypen"></div>');
  const addTool = (id, label, ic) => {
    const b = h(`<button class="pt-tool" type="button" data-tool="${id}" aria-pressed="false" title="${esc(label)}">${icon(ic)}<span>${esc(label)}</span></button>`);
    b.addEventListener('click', () => setTool(id));
    toolbar.appendChild(b);
  };
  addTool('select', 'Auswählen', 'pointer');
  toolbar.appendChild(h('<span class="pt-sep" aria-hidden="true"></span>'));
  FIELD_TYPES.forEach(t => addTool(t.id, t.label, t.icon));
  toolbar.appendChild(h('<span class="pt-sep" aria-hidden="true"></span>'));
  const detectBtn = h(`<button class="pt-tool" type="button" title="Felder automatisch erkennen">${icon('magic')}<span>Erkennen</span></button>`);
  toolbar.appendChild(detectBtn);
  const propsBar = h('<div class="pt-props" aria-label="Eigenschaften"></div>');
  const stageEl = h('<div class="pt-stage fc-stage" tabindex="-1"></div>');
  const zoomBox = h(`<div class="pt-zoom"><button class="icon-btn" type="button" data-z="in" aria-label="Vergrößern">${icon('zoomIn')}</button><button class="icon-btn" type="button" data-z="out" aria-label="Verkleinern">${icon('zoomOut')}</button></div>`);
  const stageWrap = h('<div style="position:relative;flex:1;min-height:0;display:flex;flex-direction:column"></div>');
  stageWrap.append(stageEl, zoomBox);
  screen.body.append(toolbar, propsBar, stageWrap);

  const undoBtn = h(`<button class="icon-btn" type="button" aria-label="Rückgängig" title="Rückgängig (Strg+Z)" disabled>${icon('undo')}</button>`);
  const redoBtn = h(`<button class="icon-btn" type="button" aria-label="Wiederholen" title="Wiederholen (Strg+Y)" disabled>${icon('redo')}</button>`);
  screen.extra.append(undoBtn, redoBtn);
  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);

  const stage = new PageStage(stageEl, pdf, {
    onPageCreated: p => { p.layer = h('<div class="fc-layer"></div>'); p.overlay.appendChild(p.layer); },
    onScale: s => { stageEl.style.setProperty('--s', s); },
  });
  await stage.init();
  zoomBox.querySelector('[data-z="in"]').addEventListener('click', () => stage.setZoom(stage.zoom * 1.25));
  zoomBox.querySelector('[data-z="out"]').addEventListener('click', () => stage.setZoom(stage.zoom / 1.25));
  // existing widgets: grey outlines
  existing.forEach(e => {
    const p = stage.pages[e.page - 1];
    const [x1, y1] = p.base.convertToViewportPoint(e.rect[0], e.rect[1]);
    const [x2, y2] = p.base.convertToViewportPoint(e.rect[2], e.rect[3]);
    const el = h(`<div class="fc-existing" title="Vorhandenes Feld: ${esc(e.name)}"></div>`);
    Object.assign(el.style, { left: `calc(var(--s) * ${Math.min(x1, x2)}px)`, top: `calc(var(--s) * ${Math.min(y1, y2)}px)`, width: `calc(var(--s) * ${Math.abs(x2 - x1)}px)`, height: `calc(var(--s) * ${Math.abs(y2 - y1)}px)` });
    p.overlay.insertBefore(el, p.layer);
  });

  // ---------- model ----------
  const snapshot = () => JSON.stringify(fields);
  function commit() { undoStack.push(snapshot()); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; updateButtons(); }
  function restore(json) {
    const pagesBefore = new Set(fields.map(f => f.page));
    fields = JSON.parse(json);
    if (selected) selected = fields.find(f => f.id === selected.id) || null;
    new Set([...pagesBefore, ...fields.map(f => f.page)]).forEach(renderPage);
    renderProps(); updateButtons();
  }
  function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restore(undoStack.pop()); }
  function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restore(redoStack.pop()); }
  function uniqueName(base) {
    const taken = new Set([...existingNames, ...fields.map(f => f.name)]);
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
  }
  function addField(f, { select: sel = true, record = true } = {}) {
    if (record) commit();
    f.id = `f${++seq}`;
    f.name = uniqueName(f.name || TYPE[f.type].base);
    if (f.type === 'radio' && !f.options) f.options = ['Option 1', 'Option 2', 'Option 3'];
    if (f.type === 'dropdown' && !f.options) f.options = ['Auswahl 1', 'Auswahl 2'];
    if (f.type === 'radio') f.h = Math.max(f.h, f.options.length * RADIO_ROW);
    fields.push(f);
    renderPage(f.page);
    if (sel) select(f);
    updateButtons();
    return f;
  }
  function removeField(f) {
    commit();
    fields = fields.filter(x => x.id !== f.id);
    if (selected && selected.id === f.id) selected = null;
    renderPage(f.page); renderProps(); updateButtons();
  }
  function updateButtons() {
    undoBtn.disabled = !undoStack.length;
    redoBtn.disabled = !redoStack.length;
    saveBtn.disabled = !fields.length;
    const n = fields.length;
    updateFoot(screen, [saveBtn], n ? `${n} neue${n === 1 ? 's' : ''} Feld${n === 1 ? '' : 'er'}${existing.length ? ` · ${existing.length} vorhanden` : ''}` : (existing.length ? `${existing.length} vorhandene Felder` : 'Noch keine Felder'));
  }

  // ---------- rendering ----------
  function renderPage(num) {
    const p = stage.pages[num - 1];
    if (!p) return;
    p.layer.textContent = '';
    for (const f of fields) if (f.page === num) p.layer.appendChild(fieldEl(f));
  }
  function fieldEl(f) {
    const el = h(`<div class="fc-field fc-${f.type}${selected && selected.id === f.id ? ' sel' : ''}" data-id="${f.id}" role="button" tabindex="0" aria-label="${esc(TYPE[f.type].label)}: ${esc(f.name)}"></div>`);
    Object.assign(el.style, { left: `calc(var(--s) * ${f.x}px)`, top: `calc(var(--s) * ${f.y}px)`, width: `calc(var(--s) * ${f.w}px)`, height: `calc(var(--s) * ${f.h}px)` });
    let inner = '';
    if (f.type === 'radio') {
      inner = `<div class="fc-radios">${f.options.map((o, i) => `<span class="fc-ropt" style="height:calc(var(--s) * ${RADIO_ROW}px)"><i class="${String(f.def) === o ? 'on' : ''}"></i>${esc(o)}</span>`).join('')}</div>`;
    } else if (f.type === 'check') {
      inner = f.def ? icon('check') : '';
    } else {
      const ph = f.type === 'date' ? (f.def || 'TT.MM.JJJJ') : f.type === 'sign' ? 'Unterschrift' : (f.def || f.name);
      inner = `<span class="fc-label">${f.type === 'sign' ? icon('sign') : f.type === 'date' ? icon('calendar') : ''}<span>${esc(ph)}</span></span>${f.type === 'dropdown' ? `<span class="fc-chev">${icon('chevronDown')}</span>` : ''}`;
    }
    el.innerHTML = `${inner}${f.required ? '<b class="fc-req" title="Pflichtfeld">*</b>' : ''}
      <span class="fc-name">${esc(f.name)}</span>
      <button type="button" class="fc-x" aria-label="Feld löschen">${icon('close')}</button>
      <button type="button" class="fc-rs" aria-label="Größe ändern">${icon('resize')}</button>`;
    if (f.type !== 'check' && f.type !== 'radio' && (f.type !== 'sign')) el.style.fontSize = `calc(var(--s) * ${Math.min(f.fontSize || Math.max(7, Math.min(12, f.h * 0.6)), 14)}px)`;
    return el;
  }
  function select(f) {
    const prev = selected;
    selected = f;
    if (prev && (!f || prev.page !== f.page)) renderPage(prev.page);
    if (f) renderPage(f.page);
    renderProps();
  }

  // ---------- props ----------
  function renderProps() {
    propsBar.innerHTML = '';
    if (selected) {
      const f = selected;
      const name = h(`<label class="pt-range">Name <input class="input pt-mini fc-nameinput" value="${esc(f.name)}" maxlength="80" aria-label="Feldname"></label>`);
      const inp = name.querySelector('input');
      inp.addEventListener('change', () => {
        const v = inp.value.trim();
        if (!v) { inp.value = f.name; return; }
        if (v !== f.name && (existingNames.has(v) || fields.some(x => x !== f && x.name === v))) { toast('Diesen Feldnamen gibt es schon – Namen müssen eindeutig sein.', 'error'); inp.value = f.name; return; }
        commit(); f.name = v; renderPage(f.page);
      });
      const req = h(`<label class="check fc-reqchk"><input type="checkbox" ${f.required ? 'checked' : ''}><span>Pflichtfeld</span></label>`);
      req.querySelector('input').addEventListener('change', e => { commit(); f.required = e.target.checked; renderPage(f.page); });
      const more = h(`<button class="btn btn-ghost btn-sm" type="button">${icon('settings')} Eigenschaften</button>`);
      more.addEventListener('click', () => editProps(f));
      const dup = h(`<button class="btn btn-ghost btn-sm" type="button">${icon('copy')} Duplizieren</button>`);
      dup.addEventListener('click', () => {
        const p = stage.pages[f.page - 1];
        const c = JSON.parse(JSON.stringify(f));
        delete c.id; c.name = f.name.replace(/\s\d+$/, '');
        c.y = Math.min(p.base.height - c.h - 2, f.y + f.h + 8);
        addField(c);
      });
      const del = h(`<button class="btn btn-danger-ghost btn-sm" type="button">${icon('trash')} Löschen</button>`);
      del.addEventListener('click', () => removeField(f));
      propsBar.append(h(`<span class="fc-typechip">${icon(TYPE[f.type].icon)}${esc(TYPE[f.type].label)}</span>`), name, req, more, dup, del);
    } else {
      const hints = {
        select: fields.length ? 'Tippe auf ein Feld, um es zu bearbeiten. Ziehen verschiebt, der Griff unten rechts ändert die Größe.' : 'Wähle oben einen Feldtyp und tippe auf die Seite – oder lass Felder automatisch erkennen.',
      };
      const t = TYPE[tool];
      propsBar.appendChild(h(`<span class="pt-hint">${esc(t ? `${t.label}: Tippe auf die Seite oder ziehe einen Rahmen auf.` : hints.select)}</span>`));
      if (!t) propsBar.appendChild(h(`<span class="pt-hint" style="margin-left:auto">${proBadge()}</span>`));
    }
  }

  async function editProps(f) {
    const isOpt = f.type === 'radio' || f.type === 'dropdown';
    const r = await openDialog({
      title: `${TYPE[f.type].label} – Eigenschaften`,
      body: `<label class="field"><span class="field-label">Feldname (eindeutig)</span><input class="input" name="name" value="${esc(f.name)}" maxlength="80"></label>
        <label class="field"><span class="field-label">Hinweistext (Tooltip, optional)</span><input class="input" name="tip" value="${esc(f.tip || '')}" maxlength="160"></label>
        ${isOpt ? `<label class="field"><span class="field-label">Optionen (eine pro Zeile)</span><textarea class="input pt-textarea" name="opts" rows="4">${esc((f.options || []).join('\n'))}</textarea></label>` : ''}
        ${f.type === 'check' ? `<label class="check"><input type="checkbox" name="def" ${f.def ? 'checked' : ''}><span>Standardmäßig angekreuzt</span></label>`
          : f.type === 'sign' ? '' : `<label class="field"><span class="field-label">Standardwert${isOpt ? ' (muss einer Option entsprechen)' : ''}</span><input class="input" name="def" value="${esc(f.def || '')}" ${f.type === 'date' ? 'placeholder="TT.MM.JJJJ"' : ''}></label>`}
        ${f.type === 'text' || f.type === 'multiline' || f.type === 'date' || f.type === 'dropdown' ? `<label class="field"><span class="field-label">Schriftgröße (0 = automatisch)</span><input class="input" type="number" min="0" max="48" name="fs" value="${f.fontSize || 0}"></label>` : ''}
        ${f.type === 'text' ? `<label class="field"><span class="field-label">Maximale Zeichen (0 = unbegrenzt)</span><input class="input" type="number" min="0" max="9999" name="max" value="${f.maxLen || 0}"></label>` : ''}
        ${f.type === 'dropdown' ? `<label class="check"><input type="checkbox" name="edit" ${f.editable ? 'checked' : ''}><span>Eigene Eingabe erlauben</span></label>` : ''}
        <label class="check"><input type="checkbox" name="req" ${f.required ? 'checked' : ''}><span>Pflichtfeld</span></label>`,
      actions: [{ label: 'Abbrechen', value: 'cancel' }, { label: 'Übernehmen', value: 'ok', kind: 'btn-primary', default: true }],
      validate: (v, dlg) => {
        if (v !== 'ok') return true;
        const nm = dlg.querySelector('[name=name]').value.trim();
        if (!nm) { toast('Bitte gib einen Feldnamen ein.', 'error'); return false; }
        if (nm !== f.name && (existingNames.has(nm) || fields.some(x => x !== f && x.name === nm))) { toast('Diesen Feldnamen gibt es schon.', 'error'); return false; }
        if (isOpt) {
          const opts = dlg.querySelector('[name=opts]').value.split('\n').map(s => s.trim()).filter(Boolean);
          if (opts.length < 1) { toast('Bitte mindestens eine Option eintragen.', 'error'); return false; }
          if (new Set(opts).size !== opts.length) { toast('Optionen müssen unterschiedlich sein.', 'error'); return false; }
          const dv = dlg.querySelector('[name=def]').value.trim();
          if (dv && !opts.includes(dv) && !(f.type === 'dropdown' && dlg.querySelector('[name=edit]').checked)) { toast('Der Standardwert muss einer der Optionen entsprechen.', 'error'); return false; }
        }
        if (f.type === 'date') {
          const dv = dlg.querySelector('[name=def]').value.trim();
          if (dv && !/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(dv)) { toast('Datum bitte als TT.MM.JJJJ eingeben.', 'error'); return false; }
        }
        return true;
      },
      onMount: dlg => ({ collect: () => {
        const g = n => dlg.querySelector(`[name=${n}]`);
        return {
          name: g('name').value.trim(), tip: g('tip').value.trim(), required: g('req').checked,
          options: isOpt ? g('opts').value.split('\n').map(s => s.trim()).filter(Boolean) : undefined,
          def: f.type === 'check' ? g('def').checked : g('def') ? g('def').value.trim() : '',
          fontSize: g('fs') ? Math.max(0, Math.min(48, +g('fs').value || 0)) : 0,
          maxLen: g('max') ? Math.max(0, +g('max').value || 0) : 0,
          editable: g('edit') ? g('edit').checked : false,
        };
      } }),
    });
    if (r.value !== 'ok' || !r.data) return;
    commit();
    Object.assign(f, r.data);
    if (f.type === 'radio') f.h = Math.max(f.h, f.options.length * RADIO_ROW);
    renderPage(f.page); renderProps();
  }

  function setTool(t) {
    tool = t;
    toolbar.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
    stageEl.classList.toggle('drawing', t !== 'select');
    stageEl.dataset.mode = t;
    if (t !== 'select') select(null);
    renderProps();
  }

  // ---------- pointer ----------
  const pan = createPan(stageEl);
  let gest = null;
  stage.box.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    const p = stage.pageAt(e);
    if (!p) return;
    if (pan.down(e)) { gest = null; return; }
    const { x, y } = stage.pointIn(p, e);
    const fEl = e.target.closest('.fc-field');
    if (fEl) {
      const f = fields.find(z => z.id === fEl.dataset.id);
      if (!f) return;
      if (e.target.closest('.fc-x')) { e.preventDefault(); removeField(f); return; }
      e.preventDefault();
      const wasSel = !!(selected && selected.id === f.id);
      if (!wasSel) select(f);
      stage.box.setPointerCapture(e.pointerId);
      gest = { kind: e.target.closest('.fc-rs') ? 'resize' : 'move', f, p, sx: x, sy: y, o: { ...f }, before: snapshot(), moved: false, pid: e.pointerId, wasSel };
      return;
    }
    if (tool === 'select') { select(null); return; }
    e.preventDefault();
    stage.box.setPointerCapture(e.pointerId);
    gest = { kind: 'create', p, sx: x, sy: y, x, y, pid: e.pointerId, preview: null };
  });
  stage.box.addEventListener('pointermove', e => {
    if (pan.move(e)) return;
    if (!gest || e.pointerId !== gest.pid) return;
    const { x, y } = stage.pointIn(gest.p, e);
    const p = gest.p, W = p.base.width, H = p.base.height;
    if (gest.kind === 'create') {
      gest.x = x; gest.y = y;
      if (!gest.preview && Math.hypot(x - gest.sx, y - gest.sy) * stage.scale > 8) { gest.preview = h('<div class="fc-preview"></div>'); p.layer.appendChild(gest.preview); }
      if (gest.preview) Object.assign(gest.preview.style, { left: `calc(var(--s) * ${Math.min(x, gest.sx)}px)`, top: `calc(var(--s) * ${Math.min(y, gest.sy)}px)`, width: `calc(var(--s) * ${Math.abs(x - gest.sx)}px)`, height: `calc(var(--s) * ${Math.abs(y - gest.sy)}px)` });
      return;
    }
    const dx = x - gest.sx, dy = y - gest.sy;
    if (!gest.moved && Math.hypot(dx, dy) * stage.scale < 4) return;
    gest.moved = true;
    const f = gest.f, o = gest.o;
    if (gest.kind === 'move') {
      f.x = Math.max(0, Math.min(W - f.w, o.x + dx));
      f.y = Math.max(0, Math.min(H - f.h, o.y + dy));
    } else {
      const minH = f.type === 'radio' ? f.options.length * 12 : 8;
      if (f.type === 'check') { const s = Math.max(8, Math.min(60, o.w + Math.max(dx, dy))); f.w = f.h = s; }
      else { f.w = Math.max(16, Math.min(W - f.x, o.w + dx)); f.h = Math.max(minH, Math.min(H - f.y, o.h + dy)); }
    }
    const el = p.layer.querySelector(`[data-id="${f.id}"]`);
    if (el) Object.assign(el.style, { left: `calc(var(--s) * ${f.x}px)`, top: `calc(var(--s) * ${f.y}px)`, width: `calc(var(--s) * ${f.w}px)`, height: `calc(var(--s) * ${f.h}px)` });
  });
  const end = e => {
    if (pan.up(e) && !gest) return;
    if (!gest || e.pointerId !== gest.pid) return;
    const g = gest; gest = null;
    if (g.kind === 'create') {
      if (g.preview) g.preview.remove();
      if (e.type === 'pointercancel') return;
      const t = TYPE[tool];
      const p = g.p, W = p.base.width, H = p.base.height;
      let fx, fy, fw, fh;
      if (Math.hypot(g.x - g.sx, g.y - g.sy) * stage.scale > 8) {
        fx = Math.min(g.x, g.sx); fy = Math.min(g.y, g.sy); fw = Math.abs(g.x - g.sx); fh = Math.abs(g.y - g.sy);
        if (tool === 'check') { fw = fh = Math.max(8, Math.min(fw, fh, 40)); }
        fw = Math.max(fw, 16); fh = Math.max(fh, 8);
      } else {
        fw = t.w; fh = t.h; fx = g.sx - (tool === 'check' ? fw / 2 : 4); fy = g.sy - fh / 2;
      }
      fx = Math.max(0, Math.min(W - fw, fx)); fy = Math.max(0, Math.min(H - fh, fy));
      addField({ type: tool, page: p.num, x: fx, y: fy, w: fw, h: fh, required: false, def: tool === 'check' ? false : '' });
      setTool('select');
      select(fields[fields.length - 1]);
      return;
    }
    if (g.moved) { undoStack.push(g.before); redoStack.length = 0; updateButtons(); renderPage(g.f.page); }
    else if (g.kind === 'move' && selected && selected.id === g.f.id && e.type !== 'pointercancel' && g.wasSel) editProps(g.f);
  };
  stage.box.addEventListener('pointerup', end);
  stage.box.addEventListener('pointercancel', end);
  stage.box.addEventListener('dblclick', e => {
    const fEl = e.target.closest('.fc-field');
    if (!fEl) return;
    const f = fields.find(z => z.id === fEl.dataset.id);
    if (f) editProps(f);
  });
  stage.box.addEventListener('keydown', e => {
    const fEl = e.target.closest && e.target.closest('.fc-field');
    if (!fEl || e.key !== 'Enter') return;
    const f = fields.find(z => z.id === fEl.dataset.id);
    if (f) { select(f); editProps(f); }
  });

  const onKey = e => {
    if (e.target.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('dialog[open]')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); removeField(selected); }
    else if (e.key === 'Escape') { if (selected) select(null); else setTool('select'); }
    else if (selected && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      commit();
      if (e.key === 'ArrowLeft') selected.x -= d; if (e.key === 'ArrowRight') selected.x += d;
      if (e.key === 'ArrowUp') selected.y -= d; if (e.key === 'ArrowDown') selected.y += d;
      renderPage(selected.page);
    }
  };
  window.addEventListener('keydown', onKey);

  // ---------- auto detection ----------
  detectBtn.addEventListener('click', async () => {
    detectBtn.disabled = true;
    const prog = progress('Suche Formularfelder …');
    try {
      let found = [];
      for (const p of stage.pages) {
        prog.set(`Suche Formularfelder … Seite ${p.num}/${stage.pages.length}`);
        const c = await detectFields(p.page, p.base);
        const taken = [...fields.filter(f => f.page === p.num), ...existing.filter(e => e.page === p.num).map(e => {
          const [x1, y1] = p.base.convertToViewportPoint(e.rect[0], e.rect[1]);
          const [x2, y2] = p.base.convertToViewportPoint(e.rect[2], e.rect[3]);
          return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
        })];
        c.filter(f => !taken.some(t => overlap(t, f) > 0.25)).forEach(f => found.push({ ...f, page: p.num }));
        await tick();
      }
      if (!found.length) { toast('Keine weiteren Feldkandidaten gefunden. Füge Felder von Hand hinzu.', 'info', { timeout: 4500 }); return; }
      commit();
      found.forEach(f => addField(f, { select: false, record: false }));
      select(null);
      toast(`${found.length} Feld${found.length === 1 ? '' : 'er'} erkannt – bitte prüfen, überflüssige löschen und Namen anpassen.`, 'success', { timeout: 5200 });
      const first = fields.find(f => f.auto);
      if (first) stage.scrollToPage(first.page);
    } catch (e) { errorToast(e, 'Die Erkennung ist fehlgeschlagen.'); }
    finally { prog.done(); detectBtn.disabled = false; }
  });

  // ---------- save ----------
  const saveBtn = h(`<button class="btn btn-primary" type="button">${icon('check')} Formular speichern</button>`);
  saveBtn.addEventListener('click', async () => {
    if (!fields.length) return;
    saveBtn.disabled = true;
    const prog = progress('Erstelle Formular …');
    try {
      const PDFLib = await loadPdfLib();
      const pdfDoc = await loadEditable(bytes, doc.name, { key: docId });
      await writeFields(PDFLib, pdfDoc, fields, stage.pages);
      const outBytes = await saveDoc(pdfDoc);
      const res = await saveResult(outBytes, `${baseName(doc.name)} (Formular).pdf`);
      savedSnapshot = snapshot();
      stageEl.querySelectorAll('.pt-result').forEach(x => x.remove());
      const wrap = h('<div class="pt-result screen-inner"></div>');
      const card = resultCard(res, { title: 'Formular erstellt', note: `${fields.length} Feld${fields.length === 1 ? '' : 'er'}` });
      const fill = h(`<button class="btn btn-soft btn-sm" type="button">${icon('sign')} Jetzt ausfüllen</button>`);
      fill.addEventListener('click', () => { location.hash = `#/werkzeug/unterschreiben?doc=${res.id}`; });
      card.querySelector('.actions').appendChild(fill);
      const close = h(`<button class="icon-btn pt-result-x" type="button" aria-label="Hinweis schließen">${icon('close')}</button>`);
      close.addEventListener('click', () => wrap.remove());
      card.appendChild(close);
      wrap.appendChild(card);
      stageEl.prepend(wrap);
      stageEl.scrollTo({ top: 0, behavior: 'smooth' });
      toast('Formular gespeichert – die Felder lassen sich in jedem PDF-Programm ausfüllen.', 'success', { timeout: 4500 });
    } catch (e) { errorToast(e, 'Das Formular konnte nicht gespeichert werden.'); }
    finally { prog.done(); saveBtn.disabled = !fields.length; }
  });

  guardLeave(screen, () => fields.length > 0 && snapshot() !== savedSnapshot);
  setTool('select');
  updateButtons();

  return () => {
    window.removeEventListener('keydown', onKey);
    stage.destroy();
    pdf.destroy();
  };
}

function overlap(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  return inter / Math.max(1, Math.min(a.w * a.h, b.w * b.h));
}

const cleanLabel = s => String(s || '').replace(/[_.…:]+$/g, '').replace(/^[\s_]+|[\s_:]+$/g, '').trim();
function typeFromLabel(label, fallback = 'text') {
  if (/unterschrift|signatur|signature|unterzeichn/i.test(label)) return 'sign';
  if (/datum|geburtstag|date\b|geb\.?\s*am/i.test(label)) return 'date';
  return fallback;
}

/**
 * Detect candidate form fields on a page (viewport@1 coordinates).
 * @returns {Promise<Array<{type, x, y, w, h, name, auto: true}>>}
 */
export async function detectFields(page, base) {
  const out = [];
  const W = base.width, H = base.height;
  const tc = await page.getTextContent();
  const items = [];
  for (const it of tc.items) {
    if (typeof it.str !== 'string' || !it.str.trim()) continue;
    const [a, b, c, d, e, f] = it.transform;
    if (Math.abs(b) > Math.abs(a) * 0.2) continue;
    const size = Math.hypot(c, d) || it.height || 10;
    const [x, y] = base.convertToViewportPoint(e, f);
    const [x2] = base.convertToViewportPoint(e + (it.width || 0) * (a / (Math.hypot(a, b) || 1)), f);
    items.push({ str: it.str, x: Math.min(x, x2), x1: Math.max(x, x2), y, size, w: Math.abs(x2 - x) });
  }
  const textBoxes = items.map(i => ({ x: i.x, y: i.y - i.size * 0.8, w: i.x1 - i.x, h: i.size, str: i.str }));
  const sameLine = (i, j) => Math.abs(i.y - j.y) < Math.max(i.size, j.size) * 0.5;
  const labelLeftOf = (x, y, hgt) => {
    let best = null;
    for (const it of items) {
      if (Math.abs(it.y - (y + hgt * 0.75)) > Math.max(it.size, hgt) * 0.8 && Math.abs(it.y - y - hgt) > it.size * 0.6) continue;
      if (it.x1 > x + 2 || x - it.x1 > 160) continue;
      if (!best || it.x1 > best.x1) best = it;
    }
    return best ? cleanLabel(best.str.replace(/_{3,}.*/, '')) : '';
  };
  const add = f => {
    f.w = Math.max(10, Math.min(W - f.x - 2, f.w));
    if (f.w < 10 || f.h < 6) return;
    if (out.some(o => overlap(o, f) > 0.3)) return;
    out.push({ ...f, auto: true, required: false, def: f.type === 'check' ? false : '' });
  };

  // 1) underscore runs: "Name: ________"
  for (const it of items) {
    const re = /_{4,}/g;
    let m;
    while ((m = re.exec(it.str))) {
      const n = it.str.length || 1;
      const x0 = it.x + (m.index / n) * (it.x1 - it.x), x1 = it.x + ((m.index + m[0].length) / n) * (it.x1 - it.x);
      let label = cleanLabel(it.str.slice(0, m.index));
      if (!label) {
        const left = items.filter(o => o !== it && sameLine(o, it) && o.x1 <= x0 + 2).sort((p, q) => q.x1 - p.x1)[0];
        if (left) label = cleanLabel(left.str);
      }
      const hgt = Math.max(14, it.size * 1.5);
      const type = typeFromLabel(label);
      add({ type, x: x0, y: it.y - hgt + it.size * 0.25, w: x1 - x0, h: type === 'sign' ? Math.max(hgt, 34) : hgt, name: label || (type === 'sign' ? 'Unterschrift' : 'Textfeld') });
    }
  }
  // 2) checkbox glyphs
  for (const it of items) {
    const idx = it.str.search(/[☐□❏▢◻]/);
    if (idx < 0) continue;
    const n = it.str.length || 1;
    const x0 = it.x + (idx / n) * (it.x1 - it.x);
    const s = it.size * 0.9;
    const rest = cleanLabel(it.str.slice(idx + 1)) || (items.find(o => o !== it && sameLine(o, it) && o.x >= x0) || {}).str || '';
    add({ type: 'check', x: x0, y: it.y - s * 0.95, w: s, h: s, name: cleanLabel(rest) || 'Kontrollkästchen' });
  }
  // 3) shapes: small squares → checkbox, boxes → text, lines → field above
  let shapes = { rects: [], lines: [] };
  try { shapes = await pageShapes(page, base); } catch {}
  const coversText = r => textBoxes.some(t => overlap(t, r) > 0.5 && !/^_+$/.test(t.str.trim()));
  for (const r of shapes.rects) {
    const w = r.x1 - r.x0, hh = r.y1 - r.y0;
    if (w > W * 0.9 && hh > H * 0.5) continue; // page frames
    const rect = { x: r.x0, y: r.y0, w, h: hh };
    if (coversText(rect)) continue;
    if (w >= 6 && w <= 24 && Math.abs(w - hh) < 3) {
      const right = items.filter(o => Math.abs(o.y - (r.y1 - hh * 0.1)) < Math.max(o.size, hh) && o.x >= r.x1 - 1 && o.x - r.x1 < 40).sort((p, q) => p.x - q.x)[0];
      add({ type: 'check', x: r.x0 + 1, y: r.y0 + 1, w: w - 2, h: hh - 2, name: right ? cleanLabel(right.str) : 'Kontrollkästchen' });
    } else if (w >= 40 && hh >= 10 && hh <= 200 && r.stroke) {
      const label = labelLeftOf(r.x0, r.y0, Math.min(hh, 20)) || (items.filter(o => o.y <= r.y0 + 2 && r.y0 - o.y < 20 && o.x >= r.x0 - 4 && o.x < r.x1).sort((p, q) => q.y - p.y)[0] || {}).str || '';
      const type = hh > 40 ? (typeFromLabel(label, 'multiline')) : typeFromLabel(label);
      add({ type, x: r.x0 + 1.5, y: r.y0 + 1.5, w: w - 3, h: hh - 3, name: cleanLabel(label) || (type === 'multiline' ? 'Textbereich' : 'Textfeld') });
    }
  }
  for (const l of shapes.lines) {
    const w = l.x1 - l.x0;
    if (w < 50 || w > W * 0.92) continue;
    const label = labelLeftOf(l.x0, l.y0 - 16, 16);
    const type = typeFromLabel(label);
    const hgt = type === 'sign' ? 36 : 18;
    const rect = { x: l.x0, y: l.y0 - hgt, w, h: hgt };
    if (textBoxes.some(t => overlap(t, rect) > 0.35)) continue;
    add({ type, ...rect, name: label || (type === 'sign' ? 'Unterschrift' : 'Textfeld') });
  }
  // 4) "Label:" followed by empty space on the same line
  for (const it of items) {
    const s = it.str.trim();
    if (!/[:]$/.test(s) || s.length > 40 || /_{3,}/.test(s)) continue;
    const label = cleanLabel(s);
    if (!label || /^\d/.test(label)) continue;
    const right = items.filter(o => o !== it && sameLine(o, it) && o.x > it.x1 - 1).sort((p, q) => p.x - q.x)[0];
    const x0 = it.x1 + 6;
    const x1 = right ? right.x - 8 : Math.min(W - 40, x0 + 260);
    if (x1 - x0 < 60) continue;
    const hgt = Math.max(14, it.size * 1.5);
    const type = typeFromLabel(label);
    const rect = { x: x0, y: it.y - hgt + it.size * 0.3, w: x1 - x0, h: type === 'sign' ? Math.max(hgt, 32) : hgt };
    if (type === 'sign') rect.y = it.y - rect.h + it.size * 0.3;
    if (out.some(o => overlap(o, rect) > 0.1)) continue;
    add({ type, ...rect, name: label });
  }
  return out;
}

/** Write the fields as AcroForm fields with pdf-lib. */
export async function writeFields(PDFLib, pdfDoc, fields, pageInfos) {
  const { rgb, degrees, StandardFonts, PDFName, PDFHexString, PDFString, PDFNumber } = PDFLib;
  const form = pdfDoc.getForm();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const clean = makeSanitizer(font);
  const pages = pdfDoc.getPages();
  const ctx = pdfDoc.context;
  const border = rgb(0.45, 0.47, 0.62), bg = rgb(0.93, 0.95, 1);
  for (const f of fields) {
    const info = pageInfos[f.page - 1];
    const page = pages[f.page - 1];
    const rot = ((info.page.rotate || 0) % 360 + 360) % 360;
    const [ax, ay] = info.base.convertToPdfPoint(f.x, f.y);
    const [bx, by] = info.base.convertToPdfPoint(f.x + f.w, f.y + f.h);
    const rect = { x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
    const name = clean(f.name).replace(/\./g, '_') || 'Feld';
    const common = { ...rect, borderColor: border, borderWidth: 0.8, backgroundColor: bg, rotate: degrees(rot), font };
    let field = null;
    if (f.type === 'text' || f.type === 'multiline' || f.type === 'date') {
      field = form.createTextField(name);
      if (f.type === 'multiline') field.enableMultiline();
      if (f.maxLen) field.setMaxLength(f.maxLen);
      if (f.type === 'date') field.setMaxLength(10);
      if (f.def) field.setText(clean(f.def));
      field.addToPage(page, common);
      if (f.fontSize) field.setFontSize(f.fontSize); else if (f.type !== 'multiline') field.setFontSize(Math.max(6, Math.min(12, rect.height * (rot % 180 ? rect.width / rect.height : 1) * 0.55)));
      if (f.type === 'date') {
        // date format/keystroke actions (Acrobat JavaScript), tooltip
        const fmt = 'dd.mm.yyyy';
        const js = s => ctx.obj({ S: 'JavaScript', JS: PDFString.of(s) });
        field.acroField.dict.set(PDFName.of('AA'), ctx.obj({ K: js(`AFDate_KeystrokeEx("${fmt}");`), F: js(`AFDate_FormatEx("${fmt}");`) }));
      }
    } else if (f.type === 'check') {
      field = form.createCheckBox(name);
      field.addToPage(page, { ...common, backgroundColor: rgb(1, 1, 1) });
      if (f.def) field.check();
    } else if (f.type === 'radio') {
      field = form.createRadioGroup(name);
      const opts = (f.options || []).map(o => clean(o));
      const row = f.h / Math.max(1, opts.length);
      const s = Math.min(12, row * 0.72);
      opts.forEach((o, i) => {
        const top = f.y + row * i + (row - s) / 2;
        const [p1x, p1y] = info.base.convertToPdfPoint(f.x + 1, top), [p2x, p2y] = info.base.convertToPdfPoint(f.x + 1 + s, top + s);
        field.addOptionToPage(o, page, { x: Math.min(p1x, p2x), y: Math.min(p1y, p2y), width: s, height: s, borderColor: border, borderWidth: 0.8, backgroundColor: rgb(1, 1, 1), rotate: degrees(rot) });
        // option label as page text
        const [tx, ty] = info.base.convertToPdfPoint(f.x + s + 5, f.y + row * i + (row - s) / 2 + s * 0.85);
        page.drawText(o, { x: tx, y: ty, size: Math.min(10, s * 0.95), font, color: rgb(0.12, 0.13, 0.2), rotate: degrees(rot) });
      });
      if (f.def && opts.includes(clean(f.def))) field.select(clean(f.def));
    } else if (f.type === 'dropdown') {
      field = form.createDropdown(name);
      field.addOptions((f.options || []).map(o => clean(o)));
      if (f.editable) field.enableEditing();
      if (f.def) { try { field.select(clean(f.def), !!f.editable); } catch {} }
      field.addToPage(page, common);
      if (f.fontSize) field.setFontSize(f.fontSize);
    } else if (f.type === 'sign') {
      // pdf-lib cannot create signature fields: build the field/widget dictionary directly
      const x0 = rect.x, y0 = rect.y, x1 = rect.x + rect.width, y1 = rect.y + rect.height;
      const ap = ctx.register(ctx.flateStream(
        `0.97 0.97 1 rg 0 0 ${rect.width.toFixed(2)} ${rect.height.toFixed(2)} re f 0.45 0.47 0.62 RG 0.8 w [3 2] 0 d 0.4 0.4 ${(rect.width - 0.8).toFixed(2)} ${(rect.height - 0.8).toFixed(2)} re S`,
        { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, +rect.width.toFixed(2), +rect.height.toFixed(2)] },
      ));
      const dict = ctx.obj({
        Type: 'Annot', Subtype: 'Widget', FT: 'Sig', Rect: [x0, y0, x1, y1].map(v => +v.toFixed(2)), F: 4, P: page.ref,
        MK: { BC: [0.45, 0.47, 0.62], BG: [0.97, 0.97, 1], R: rot }, AP: { N: ap },
      });
      dict.set(PDFName.of('T'), PDFHexString.fromText(name));
      if (f.required) dict.set(PDFName.of('Ff'), PDFNumber.of(2));
      if (f.tip) dict.set(PDFName.of('TU'), PDFHexString.fromText(clean(f.tip)));
      const ref = ctx.register(dict);
      page.node.addAnnot(ref);
      form.acroForm.addField(ref);
      continue;
    }
    if (!field) continue;
    if (f.required) field.enableRequired();
    if (f.tip || f.type === 'date') field.acroField.dict.set(PDFName.of('TU'), PDFHexString.fromText(clean(f.tip || 'Datum (TT.MM.JJJJ)')));
  }
  try { form.updateFieldAppearances(font); } catch (e) { console.warn('appearances', e); }
}
