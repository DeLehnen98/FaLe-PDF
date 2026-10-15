// Tool: fill PDF forms on the phone. AcroForm fields (text, multi-line, checkbox, radio, dropdown, list)
// become a native form (big inputs, matching keyboard, grouped by page) next to a page preview that
// highlights the fields – tap a field on the preview to jump to its input. Appearances are regenerated
// with Helvetica, or with an embedded Unicode subset (lib/unifont.js) for values with Polish, Turkish, Greek,
// Cyrillic … characters; optional flattening. PDFs without fields: lines, boxes and
// "Label:" gaps are detected and what you type is written onto the page.
import { el, clear } from '../lib/dom.js';
import { loadPdfLib } from '../lib/pdf.js';
import { ensureCss, tr, ic, btn, userError, statusLine, pageNav, previewPage, wipeCanvas, stageWidth, saveLikeSource, pdfBlob, watchUnlock } from '../lib/sec-ui.js';
import { prepareText, cleanText, missingWarning } from '../lib/unifont.js';
import { flattenDoc } from '../lib/sec-flatten.js';
import { drawTextBox, drawMark, wrapText } from '../lib/sec-draw.js';

// current form (module scope)
const F = { inputId: null, pdf: null, fields: [], widgets: new Map(), values: new Map(), detected: [], mode: 'none', ui: null };

const KIND = { PDFTextField: 'text', PDFCheckBox: 'check', PDFRadioGroup: 'radio', PDFDropdown: 'dropdown', PDFOptionList: 'list', PDFSignature: 'signature', PDFButton: 'button' };

function kindOf(PDFLib, field) {
  for (const [cls, k] of Object.entries(KIND)) if (PDFLib[cls] && field instanceof PDFLib[cls]) return k;
  return 'other';
}

/** Keyboard / autofill hints from the field name. */
function hints(name) {
  const n = name.toLowerCase();
  if (/e-?mail/.test(n)) return { type: 'email', inputmode: 'email', autocomplete: 'email' };
  // "tel" only as its own word ("Tel.", "Tel-Nr") – not inside "Titel", "Hotel", "Stellung"
  if (/telefon|phone|mobil|handy|(^|[^a-z])fax|(^|[^a-z])tel(?![a-z])|(^|[^a-z])tel(nr|nummer)/.test(n)) return { type: 'tel', inputmode: 'tel', autocomplete: 'tel' };
  if (/plz|postleitzahl|zip|postal/.test(n)) return { inputmode: 'numeric', autocomplete: 'postal-code' };
  if (/iban/.test(n)) return { autocapitalize: 'characters', spellcheck: 'false' };
  if (/betrag|summe|preis|amount|total|euro|€/.test(n)) return { inputmode: 'decimal' };
  if (/(^|[^a-z])(nr|nummer|number|anzahl|alter|age)([^a-z]|$)/.test(n)) return { inputmode: 'numeric' };
  if (/vorname|first ?name|given/.test(n)) return { autocomplete: 'given-name', autocapitalize: 'words' };
  if (/nachname|familienname|last ?name|surname/.test(n)) return { autocomplete: 'family-name', autocapitalize: 'words' };
  if (/stra(ss|ß)e|street|anschrift|adresse|address/.test(n)) return { autocomplete: 'street-address' };
  if (/(^|[^a-z])(ort|stadt|city|wohnort)([^a-z]|$)/.test(n)) return { autocomplete: 'address-level2', autocapitalize: 'words' };
  // dates – but not "Geburtsort", "Geburtsname", "place of birth", "country of birth"
  if (/datum|date|geburtstag|birthday|(^|[^a-z])dob([^a-z]|$)/.test(n) || (/geburt|birth/.test(n) && !/ort|name|land|stadt|place|country|city|name/.test(n))) return { inputmode: 'numeric', placeholder: 'TT.MM.JJJJ', date: true };
  if (/(^|[^a-z])name([^a-z]|$)/.test(n)) return { autocomplete: 'name', autocapitalize: 'words' };
  return {};
}

/**
 * Make the text fit its box: fields with automatic size (0) or a size that is too big for the text get a
 * size at which the (wrapped) text fits.
 */
function fitText(field, font, text, multiline) {
  let da = '';
  try { da = field.acroField.getWidgets()[0]?.getDefaultAppearance?.() || field.acroField.getDefaultAppearance() || ''; } catch { /* none */ }
  const m = /([\d.]+)\s+Tf/.exec(da);
  const w = field.acroField.getWidgets()[0];
  if (!w) return;
  const r = w.getRectangle();
  const safe = cleanText(text, font).text;
  const fits = size => (multiline
    ? wrapText(font, safe, size, r.width - 8).length * size * 1.2 <= r.height - 4
    : font.widthOfTextAtSize(safe, size) <= r.width - 6 && size <= r.height * 0.8);
  let size = m && +m[1] > 0 ? +m[1] : (multiline ? 12 : Math.min(14, r.height * 0.65));
  if (fits(size) && m && +m[1] > 0) return;
  while (size > 6 && !fits(size)) size -= 0.5;
  field.setFontSize(size);
  // widgets can carry their own /DA, which wins over the field's
  for (const wd of field.acroField.getWidgets()) {
    const own = wd.getDefaultAppearance?.();
    if (own && /Tf/.test(own)) wd.setDefaultAppearance(own.replace(/([\d.]+)(\s+Tf)/, `${size}$2`));
  }
}

const pretty = s => String(s || '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();

export default {
  options: [
    {
      id: 'flatten', type: 'toggle', default: false,
      label: { de: 'Formular danach glätten', en: 'Flatten the form afterwards' },
      hint: { de: 'Die Werte werden fest in die Seite übernommen und lassen sich nicht mehr ändern.', en: 'The values become part of the page and can no longer be changed.' },
    },
  ],

  mountStage(stage, state, ctx) {
    ensureCss();
    stage.classList.add('sec-stage');
    this._stage = stage; this._state = state; this._lang = ctx.lang;
    watchUnlock(stage, state, inputs => this.onInputs(inputs));
    this.onInputs(state.inputs.filter(i => !i.error && !i.locked));
  },

  async onInputs(inputs) {
    const stage = this._stage;
    if (!stage) return;
    const input = inputs.find(i => !i.locked);
    if (!input) { clear(stage); F.inputId = null; return; }
    if (F.inputId === input.id || this._loading === input.id) return;
    this._loading = input.id;
    const L = this._lang;
    let pdf, doc;
    try { pdf = await input.pdfjs(); doc = await input.pdfDoc(); } catch { this._loading = null; return; }
    clear(stage).append(el('p', { class: 'sec-status' }, tr(L, 'Formular wird gelesen …', 'Reading the form …')));
    const PDFLib = await loadPdfLib();
    Object.assign(F, { inputId: input.id, pdf, fields: [], widgets: new Map(), values: new Map(), detected: [], mode: 'none' });
    // widgets (page + rect) from pdf.js
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      let annots = [];
      try { annots = await page.getAnnotations({ intent: 'display' }); } catch { /* ignore */ }
      for (const a of annots) {
        if (a.subtype !== 'Widget' || !a.fieldName) continue;
        const [x0, y0] = vp.convertToViewportPoint(a.rect[0], a.rect[1]), [x1, y1] = vp.convertToViewportPoint(a.rect[2], a.rect[3]);
        const list = F.widgets.get(a.fieldName) || [];
        list.push({ page: p, x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1), exportValue: a.exportValue || a.buttonValue || null });
        F.widgets.set(a.fieldName, list);
      }
    }
    let form = null;
    try { form = doc.getForm(); } catch { form = null; }
    for (const field of form ? form.getFields() : []) {
      const kind = kindOf(PDFLib, field);
      if (kind === 'button' || kind === 'other') continue;
      const name = field.getName();
      const tu = field.acroField.dict.lookup(PDFLib.PDFName.of('TU'));
      const label = (tu && typeof tu.decodeText === 'function' ? tu.decodeText() : '') || pretty(name.split('.').pop());
      const f = { name, label, kind, readOnly: field.isReadOnly?.() || false, required: field.isRequired?.() || false, widgets: F.widgets.get(name) || [] };
      if (kind === 'text') { f.value = field.getText() || ''; f.multiline = field.isMultiline(); f.max = field.getMaxLength?.() || null; f.comb = field.isCombed?.() || false; }
      else if (kind === 'check') f.value = field.isChecked();
      else if (kind === 'radio') { f.options = field.getOptions(); f.value = field.getSelected() || ''; }
      else if (kind === 'dropdown') { f.options = field.getOptions(); f.value = (field.getSelected() || [])[0] || ''; f.editable = field.isEditable?.() || false; }
      else if (kind === 'list') { f.options = field.getOptions(); f.value = field.getSelected() || []; f.multi = field.isMultiselect?.() || false; }
      f.page = f.widgets[0]?.page || 1;
      F.fields.push(f);
    }
    if (F.fields.some(f => f.kind !== 'signature')) F.mode = 'acro';
    else {
      // no fields → detect lines/boxes
      const { detectFields } = await import('../lib/sec-detect.js');
      for (let p = 1; p <= pdf.numPages && p <= 30; p++) {
        const page = await pdf.getPage(p);
        const base = page.getViewport({ scale: 1 });
        for (const d of await detectFields(page, base)) F.detected.push({ ...d, page: p, id: `d${F.detected.length}`, value: d.type === 'check' ? false : '' });
      }
      F.mode = F.detected.length ? 'detected' : 'none';
    }
    this._loading = null;
    render(stage, this._state, L);
  },

  async run(inputs, opts, ctx) {
    const input = inputs[0];
    if (F.inputId !== input.id || F.mode === 'none') throw userError('Diese PDF hat keine ausfüllbaren Felder.', 'This PDF has no fillable fields.');
    const PDFLib = await loadPdfLib();
    ctx.progress(0.1, { de: 'Werte werden eingetragen …', en: 'Filling in the values …' });
    const doc = await input.pdfDoc();
    const lost = [], lostChars = [];
    // Helvetica when it can show the value, otherwise the Unicode font; `missing`: characters no font here has
    const usedFonts = new Map();
    const pick = async text => { const r = await prepareText(doc, text, { PDFLib }); lostChars.push(...r.missing); if (r.font?.ref) usedFonts.set(r.font.name, r.font.ref); return r; };
    let changed = 0;
    if (F.mode === 'acro') {
      const form = doc.getForm();
      plainDA(PDFLib, doc, form);
      for (const f of F.fields) {
        if (!F.values.has(f.name) || f.readOnly) continue;
        const v = F.values.get(f.name);
        let field;
        try { field = form.getField(f.name); } catch { continue; }
        try {
          if (f.kind === 'text') {
            let text = String(v);
            if (f.max && text.length > f.max) text = text.slice(0, f.max);
            field.setText(text || undefined);
            const { font, missing } = await pick(text);
            if (text) fitText(field, font, text, f.multiline);
            if (missing.length) lost.push(f.label);
            else field.updateAppearances(font);
          } else if (f.kind === 'check') { if (v) field.check(); else field.uncheck(); }
          else if (f.kind === 'radio') { if (v) field.select(v); else field.clear(); }
          else if (f.kind === 'dropdown') {
            if (v) field.select(v); else field.clear();
            const { font, missing } = await pick(v || '');
            if (missing.length) lost.push(f.label); else field.updateAppearances(font);
          } else if (f.kind === 'list') {
            const arr = Array.isArray(v) ? v : [v].filter(Boolean);
            if (arr.length) field.select(arr, false); else field.clear();
            const { font, missing } = await pick(arr.join('\n'));
            if (missing.length) lost.push(f.label); else field.updateAppearances(font);
          }
          changed++;
        } catch { lost.push(f.label); } // no logging: messages can contain field values
      }
      // pdf-lib must not regenerate appearances on save (it would use Helvetica and fail on other characters)
      for (const field of form.getFields()) { try { form.markFieldAsClean(field); } catch { /* ignore */ } }
      const acro = doc.catalog.lookup(PDFLib.PDFName.of('AcroForm'));
      if (lost.length) acro?.set?.(PDFLib.PDFName.of('NeedAppearances'), PDFLib.PDFBool.True);
      else if (acro instanceof PDFLib.PDFDict) fixNeedAppearances(PDFLib, doc, form, acro, usedFonts);
      await ctx.tick();
      if (opts.flatten) {
        ctx.progress(0.6, { de: 'Wird geglättet …', en: 'Flattening …' });
        await flattenDoc(PDFLib, doc, { forms: true, annots: false, keepLinks: true, tick: ctx.tick });
      }
    } else {
      // detected fields: write onto the pages
      const pages = doc.getPages();
      const keys = new Map();
      for (const d of F.detected) {
        const v = d.value;
        if (d.type === 'check' ? !v : !String(v || '').trim()) continue;
        const pdfPage = await F.pdf.getPage(d.page);
        const vp = pdfPage.getViewport({ scale: 1 });
        const page = pages[d.page - 1];
        const box = { cx: d.x + d.w / 2, cy: d.y + d.h / 2, w: d.w, h: d.h, rot: 0 };
        if (d.type === 'check') drawMark(PDFLib, page, vp, box, 'cross');
        else {
          const { font, text } = await pick(String(v));
          const fk = `${d.page}|${font.name}`;
          if (!keys.has(fk)) keys.set(fk, page.node.newFontDictionary(font.isUnicode ? 'FaLeUni' : 'FaLeHelv', font.ref));
          drawTextBox(PDFLib, page, vp, box, text, { font, fontKey: keys.get(fk), multiline: d.type === 'multiline', size: d.type === 'multiline' ? 11 : null });
        }
        changed++;
      }
    }
    ctx.progress(0.85, { de: 'Wird gespeichert …', en: 'Saving …' });
    const { bytes, protectedAgain } = await saveLikeSource(doc, input);
    const chars = lostChars.length ? ` (${[...new Set(lostChars)].slice(0, 12).join(' ')})` : '';
    if (F.mode === 'acro' && lost.length) ctx.note({
      de: `Einige Zeichen in „${lost.slice(0, 3).join('“, „')}“ kann die eingebettete Schrift nicht darstellen${chars}. Die Werte sind gespeichert; ihr Aussehen erzeugt das Programm, mit dem du die PDF öffnest.${opts.flatten ? ' Beim Glätten können sie fehlen.' : ''}`,
      en: `The embedded font cannot show some characters in “${lost.slice(0, 3).join('”, “')}”${chars}. The values are saved; the program that opens the PDF draws them.${opts.flatten ? ' They may be missing after flattening.' : ''}` });
    else if (F.mode !== 'acro' && lostChars.length) ctx.note(missingWarning(lostChars));
    if (F.mode === 'detected') ctx.note({ de: 'Die Einträge wurden direkt auf die Seite geschrieben.', en: 'The entries were written directly onto the page.' });
    if (protectedAgain) ctx.note({ de: 'Die Datei ist wieder mit demselben Passwort geschützt.', en: 'The file is protected again with the same password.' });
    const suffix = ctx.lang === 'de' ? ' (ausgefüllt)' : ' (filled)';
    return { outputs: [{ name: ctx.fileName(input.name, suffix, 'pdf'), blob: pdfBlob(bytes), pages: doc.getPageCount(),
      note: ctx.t({ de: `${changed} Feld(er) ausgefüllt${opts.flatten && F.mode === 'acro' ? ' · geglättet' : ''}`, en: `${changed} field(s) filled${opts.flatten && F.mode === 'acro' ? ' · flattened' : ''}` }) }] };
  },
};

/**
 * Some producers write /DA with escaped characters ("\\057Helv 0 Tf" for "/Helv 0 Tf"). pdf-lib reads the raw
 * string, finds no Tf operator and refuses to resize or redraw such a field – store the decoded text instead.
 */
function plainDA(PDFLib, doc, form) {
  const { PDFName, PDFString, PDFHexString, PDFDict } = PDFLib;
  const fix = dict => {
    if (!(dict instanceof PDFDict)) return;
    const da = dict.lookup(PDFName.of('DA'));
    if ((da instanceof PDFString && da.asString().includes('\\')) || da instanceof PDFHexString) {
      try { dict.set(PDFName.of('DA'), PDFString.of(da.decodeText())); } catch { /* leave it */ }
    }
  };
  fix(doc.catalog.lookup(PDFName.of('AcroForm')));
  for (const f of form.getFields()) {
    try { fix(f.acroField.dict); for (const w of f.acroField.getWidgets()) fix(w.dict); } catch { /* ignore */ }
  }
}

/**
 * Many forms come with NeedAppearances = true: viewers then redraw every field from its /DA font name, which
 * must be in the form's /DR – the fonts written here (Helvetica, the Unicode subset) are not, so Greek or
 * Cyrillic values and dropdown texts came out empty or garbled in such viewers. Register the fonts and, when
 * every widget has its own appearance now, switch the flag off so all viewers show what was drawn here.
 */
function fixNeedAppearances(PDFLib, doc, form, acro, usedFonts) {
  const { PDFName, PDFDict } = PDFLib;
  if (usedFonts.size) {
    let dr = acro.lookup(PDFName.of('DR'));
    if (!(dr instanceof PDFDict)) { dr = doc.context.obj({}); acro.set(PDFName.of('DR'), dr); }
    let fonts = dr.lookup(PDFName.of('Font'));
    if (!(fonts instanceof PDFDict)) { fonts = doc.context.obj({}); dr.set(PDFName.of('Font'), fonts); }
    for (const [name, ref] of usedFonts) if (!fonts.has(PDFName.of(name))) fonts.set(PDFName.of(name), ref);
  }
  if (!acro.has(PDFName.of('NeedAppearances'))) return;
  try {
    const all = form.getFields().every(f => f.acroField.getWidgets().every(w => {
      const ap = w.dict.lookup(PDFName.of('AP'));
      return ap instanceof PDFDict && ap.has(PDFName.of('N'));
    }));
    if (all) acro.delete(PDFName.of('NeedAppearances'));
  } catch { /* keep the flag */ }
}

// ---------------------------------------------------------------- UI
function render(stage, state, L) {
  const bump = () => { state.values.formRev = (state.values.formRev || 0) + 1; };
  const status = statusLine();
  const items = F.mode === 'acro'
    ? F.fields.filter(f => f.kind !== 'signature').map(f => ({ id: f.name, page: f.page, f, boxes: f.widgets }))
    : F.detected.map(d => ({ id: d.id, page: d.page, d, boxes: [{ page: d.page, x0: d.x, y0: d.y, x1: d.x + d.w, y1: d.y + d.h }] }));
  if (F.mode === 'none') {
    clear(stage).append(el('div', { class: 'sec-card' }, el('h3', { class: 'sec-h' }, ic('form'), tr(L, 'Keine Formularfelder gefunden', 'No form fields found')),
      el('p', { class: 'sec-sub' }, tr(L, 'Diese PDF hat keine ausfüllbaren Felder, und es wurden auch keine Linien oder Kästchen zum Ausfüllen erkannt.', 'This PDF has no fillable fields, and no lines or boxes to fill in were detected either.'))));
    return;
  }
  const nodes = new Map(); // id → {wrap, focus, describe}
  const groups = new Map();
  for (const it of items) { if (!groups.has(it.page)) groups.set(it.page, []); groups.get(it.page).push(it); }
  const form = el('div', { class: 'sec-form' });
  let n = 0;
  for (const [page, list] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => (a.boxes[0]?.y0 ?? 0) - (b.boxes[0]?.y0 ?? 0) || (a.boxes[0]?.x0 ?? 0) - (b.boxes[0]?.x0 ?? 0));
    const fs = el('fieldset', { class: 'sec-fieldset' }, el('legend', {}, tr(L, `Seite ${page}`, `Page ${page}`)));
    for (const it of list) fs.append(control(it, ++n));
    form.append(fs);
  }

  function setVal(it, v) {
    if (it.f) F.values.set(it.f.name, v); else it.d.value = v;
    bump();
    paintBoxes();
  }
  function valueOf(it) { return it.f ? (F.values.has(it.f.name) ? F.values.get(it.f.name) : it.f.value) : it.d.value; }

  function control(it, idx) {
    const id = `sec-ff-${idx}`;
    const f = it.f, d = it.d;
    const label = f ? f.label : (d.name || tr(L, 'Feld', 'Field'));
    const kind = f ? f.kind : (d.type === 'check' ? 'check' : d.type === 'multiline' ? 'multi' : 'text');
    const wrap = el('div', { class: 'sec-field', dataset: { id: it.id } });
    let focusEl;
    const req = f?.required ? el('span', { class: 'sec-ro' }, tr(L, ' (Pflichtfeld)', ' (required)')) : null;
    if (kind === 'check') {
      const box = el('input', { type: 'checkbox', id, checked: !!valueOf(it), disabled: f?.readOnly, onchange: () => setVal(it, box.checked) });
      wrap.append(el('label', { class: 'sec-check', for: id }, box, el('span', {}, label), req));
      focusEl = box;
    } else if (kind === 'radio') {
      const fsr = el('fieldset', { class: 'sec-fieldset' }, el('legend', { class: 'sec-flabel' }, label, req));
      const opts = el('div', { class: 'sec-choices' });
      f.options.forEach((o, k) => {
        const rid = `${id}-${k}`;
        const r = el('input', { type: 'radio', id: rid, name: id, value: o, checked: valueOf(it) === o, disabled: f.readOnly, onchange: () => setVal(it, o) });
        opts.append(el('label', { class: 'sec-check', for: rid }, r, el('span', {}, pretty(o))));
        if (!k) focusEl = r;
      });
      const clearBtn = btn('close', tr(L, 'Auswahl aufheben', 'Clear choice'), () => { opts.querySelectorAll('input').forEach(x => { x.checked = false; }); setVal(it, ''); }, { cls: 'wt-btn wt-btn-text wt-btn-sm' });
      fsr.append(opts, clearBtn);
      wrap.append(fsr);
    } else if (kind === 'dropdown' || kind === 'list') {
      const multi = kind === 'list' && f.multi;
      const cur = valueOf(it);
      const sel = el('select', { id, class: 'wt-input', multiple: multi, size: kind === 'list' ? String(Math.min(6, Math.max(2, f.options.length))) : null, disabled: f.readOnly,
        onchange: () => setVal(it, multi ? [...sel.selectedOptions].map(o => o.value) : sel.value) },
        kind === 'dropdown' ? el('option', { value: '' }, tr(L, '– bitte wählen –', '– please choose –')) : null,
        f.options.map(o => el('option', { value: o, selected: Array.isArray(cur) ? cur.includes(o) : cur === o }, o)));
      wrap.append(el('label', { for: id }, label, req), sel);
      if (multi) wrap.append(el('p', { class: 'wt-opt-hint' }, tr(L, 'Mehrfachauswahl möglich.', 'Several choices possible.')));
      focusEl = sel;
    } else {
      const h = hints(label + ' ' + (f?.name || ''));
      const multiline = kind === 'multi' || f?.multiline;
      const attrs = { id, class: 'wt-input', value: String(valueOf(it) ?? ''), disabled: f?.readOnly, maxlength: f?.max ? String(f.max) : null, autocomplete: h.autocomplete || 'off',
        inputmode: h.inputmode || null, autocapitalize: h.autocapitalize || null, spellcheck: h.spellcheck || null, placeholder: h.date ? tr(L, 'TT.MM.JJJJ', 'DD/MM/YYYY') : null,
        enterkeyhint: multiline ? null : 'next', oninput: e => setVal(it, e.target.value) };
      const input = multiline ? el('textarea', { ...attrs, rows: '4' }, String(valueOf(it) ?? '')) : el('input', { ...attrs, type: h.type || 'text' });
      if (!multiline) input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const all = [...form.querySelectorAll('input:not([type=hidden]), select, textarea')]; all[all.indexOf(input) + 1]?.focus(); } });
      wrap.append(el('label', { for: id }, label, req), input);
      if (f?.max) wrap.append(el('p', { class: 'wt-opt-hint' }, tr(L, `Höchstens ${f.max} Zeichen.`, `At most ${f.max} characters.`)));
      focusEl = input;
    }
    if (f?.readOnly) wrap.append(el('p', { class: 'sec-ro' }, tr(L, 'Schreibgeschützt', 'Read-only')));
    wrap.addEventListener('focusin', () => { if (nav.page !== it.page) { nav.set(it.page); showPage(it.page).then(() => paintBoxes(it.id)); } else paintBoxes(it.id); });
    nodes.set(it.id, { wrap, focus: () => focusEl?.focus({ preventScroll: true }) });
    return wrap;
  }

  // preview
  const nav = pageNav(L, p => showPage(p));
  const pageBox = el('div', { class: 'sec-page' });
  const overlay = el('div', { class: 'sec-overlay' });
  const previewCard = el('div', { class: 'sec-card sec-sticky' }, el('h3', { class: 'sec-h' }, ic('file'), tr(L, 'Vorschau', 'Preview')), nav.node,
    el('div', { class: 'sec-page-wrap' }, pageBox), el('p', { class: 'sec-hint-row' }, tr(L, 'Tippe auf ein Feld, um es auszufüllen.', 'Tap a field to fill it in.')));
  let cur = null, seq = 0, active = null;
  async function showPage(p) {
    const my = ++seq;
    const r = await previewPage(F.pdf, p, Math.max(200, stageWidth(previewCard, 640) - 30));
    if (my !== seq) { wipeCanvas(r.canvas); return; }
    if (cur) wipeCanvas(cur.canvas);
    cur = r;
    pageBox.style.width = r.canvas.style.width;
    clear(pageBox).append(r.canvas, overlay);
    paintBoxes(active);
  }
  function paintBoxes(activeId = active) {
    active = activeId;
    if (!cur) return;
    clear(overlay);
    const s = cur.scale;
    for (const it of items) {
      const v = valueOf(it);
      const filled = Array.isArray(v) ? v.length : !!v;
      it.boxes.filter(b => b.page === nav.page).forEach((b, k) => {
        const name = it.f ? it.f.label : it.d.name;
        // the form on the left is the accessible way in; the boxes are a pointer shortcut
        const btnEl = el('div', { class: 'sec-fbox' + (filled ? ' is-filled' : '') + (it.id === activeId ? ' is-active' : ''), 'aria-hidden': 'true', title: name,
          onclick: () => { const nd = nodes.get(it.id); nd.wrap.scrollIntoView({ block: 'center', behavior: 'smooth' }); nd.focus(); nd.wrap.classList.add('is-flash'); setTimeout(() => nd.wrap.classList.remove('is-flash'), 900); } });
        Object.assign(btnEl.style, { left: `${b.x0 * s}px`, top: `${b.y0 * s}px`, width: `${Math.max(6, (b.x1 - b.x0) * s)}px`, height: `${Math.max(6, (b.y1 - b.y0) * s)}px` });
        overlay.append(btnEl);
      });
    }
  }
  const counts = el('p', { class: 'sec-sub' }, F.mode === 'acro'
    ? tr(L, `${items.length} Felder auf ${groups.size} ${groups.size === 1 ? 'Seite' : 'Seiten'}.`, `${items.length} fields on ${groups.size} page${groups.size === 1 ? '' : 's'}.`)
    : tr(L, `Diese PDF hat keine echten Formularfelder. ${items.length} Stellen zum Ausfüllen wurden automatisch erkannt (Linien, Kästchen, „Name:“). Was du einträgst, wird direkt auf die Seite geschrieben – prüfe die Vorschau im Ergebnis.`,
      `This PDF has no real form fields. ${items.length} places to fill in were detected automatically (lines, boxes, “Name:”). What you type is written directly onto the page – check the result.`));
  const sig = F.fields.filter(f => f.kind === 'signature').length;
  const formCard = el('div', { class: 'sec-card' }, el('h3', { class: 'sec-h' }, ic('form'), tr(L, 'Ausfüllen', 'Fill in')), counts,
    sig ? el('p', { class: 'sec-info' }, ic('pen'), tr(L, 'Unterschriftsfelder lassen sich hier nicht ausfüllen – nutze dafür „PDF unterschreiben“.', 'Signature fields cannot be filled here – use “Sign PDF” for that.')) : null,
    form);
  clear(stage).append(el('div', { class: 'sec-split' }, formCard, previewCard), status.node);
  nav.set(1, F.pdf.numPages);
  requestAnimationFrame(() => showPage(1));
}
