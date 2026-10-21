// Formular-Lotse: reads a PDF form into a list of questions – one per field, in reading order.
// Each question knows where its field sits on the page (for the picture of the form), the label printed next to
// it (many forms only call their fields „Text1“, „Text2“ …), the glossary entry and the checks of
// „Prüfen vor dem Speichern“ (js/tools/formcheck.js). Ankreuzkästchen in one row or column („ledig / verheiratet /
// geschieden“) become one question. Everything runs on the device.
import { formatSpec, ruleFor, parseDate } from '../tools/formcheck.js';
import { readingOrder, cleanLabel } from '../tools/formfields.js';
import { lookup, prettyName, isGeneric } from './glossary.js';

const MAX_LABEL = 90;
const short = s => { const t = cleanLabel(String(s || '').replace(/\s+/g, ' ')); return t.length > MAX_LABEL ? t.slice(0, MAX_LABEL - 1).trimEnd() + '…' : t; };

/** Vertical overlap of a text item with a rectangle, relative to the smaller height (0…1). */
function lineOverlap(it, r) {
  const a0 = it.top, a1 = it.y, b0 = r.y, b1 = r.y + r.h;
  const ov = Math.min(a1, b1) - Math.max(a0, b0);
  return ov / Math.max(1, Math.min(a1 - a0, b1 - b0));
}

/**
 * The text printed next to a field.
 * items: [{str, x, x1, y (bottom), top, size}] in viewport@1 coordinates (js/tools/paperform.js textItems)
 * r: {x, y, w, h}; side: 'left' | 'right' | 'above' | 'inside'
 * opts.stopX: on 'right', stop before this x (the next box in the row); opts.exclude: Set of strings to skip
 */
export function nearbyLabel(items, r, side, { stopX = Infinity, exclude = null } = {}) {
  if (!items || !items.length || !r) return '';
  const ok = it => it.str.trim() && !(exclude && exclude.has(it.str.trim()));
  const join = list => short(list.map(it => it.str.trim()).join(' '));
  if (side === 'left') {
    const row = items.filter(it => ok(it) && lineOverlap(it, r) >= 0.4 && it.x1 <= r.x + 3).sort((a, b) => b.x1 - a.x1);
    if (!row.length || r.x - row[0].x1 > 160) return '';
    const out = [row[0]];
    for (let i = 1; i < row.length && out.length < 8; i++) {
      const cur = out[out.length - 1];
      if (cur.x - row[i].x1 > Math.max(4, cur.size * 1.6)) break;
      out.push(row[i]);
    }
    return join(out.reverse());
  }
  if (side === 'right') {
    const row = items.filter(it => ok(it) && lineOverlap(it, r) >= 0.4 && it.x >= r.x + r.w - 3 && it.x < stopX - 1).sort((a, b) => a.x - b.x);
    if (!row.length || row[0].x - (r.x + r.w) > 40) return '';
    const out = [row[0]];
    for (let i = 1; i < row.length && out.length < 8; i++) {
      const cur = out[out.length - 1];
      if (row[i].x - cur.x1 > Math.max(4, cur.size * 1.6) || row[i].x1 > stopX) break;
      out.push(row[i]);
    }
    return join(out);
  }
  if (side === 'above') {
    const cand = items.filter(it => ok(it) && r.y - it.y >= -3 && r.y - it.y <= 22 && it.x < r.x + r.w && it.x1 > r.x - 6 && it.x >= r.x - 40);
    if (!cand.length) return '';
    const best = cand.reduce((a, b) => (b.y > a.y ? b : a));
    return join(cand.filter(it => Math.abs(it.y - best.y) < 2).sort((a, b) => a.x - b.x));
  }
  if (side === 'inside') {
    // a small caption in the upper part of the box („Name“ printed in the corner of the field)
    const cand = items.filter(it => ok(it) && it.x >= r.x - 2 && it.x1 <= r.x + r.w + 2 && it.top >= r.y - 2 && it.y <= r.y + r.h * 0.6 && it.size < r.h * 0.6);
    if (!cand.length) return '';
    return join(cand.sort((a, b) => a.top - b.top || a.x - b.x));
  }
  return '';
}

/** Two boxes on one line (or in one column) close to each other → one question. */
function belongs(a, b) {
  if (a.page !== b.page) return false;
  const sameRow = Math.abs(a.rect.y - b.rect.y) <= Math.max(a.rect.h, b.rect.h) && b.rect.x > a.rect.x && b.rect.x - (a.rect.x + a.rect.w) < 260;
  const sameCol = Math.abs(a.rect.x - b.rect.x) <= 8 && b.rect.y > a.rect.y && b.rect.y - (a.rect.y + a.rect.h) < Math.max(14, a.rect.h * 2.5);
  return sameRow || sameCol;
}
const choiceLike = q => !!q.optLabel && q.optLabel.length <= 40;

/**
 * Join runs of neighbouring check boxes with short labels into one 'checks' question.
 * qs: questions in reading order; items(page): text items of that page (for the label in front of the group)
 */
export function groupChecks(qs, items = () => []) {
  const out = [];
  for (let i = 0; i < qs.length; i++) {
    const q = qs[i];
    if (q.type !== 'check' || !choiceLike(q)) { out.push(q); continue; }
    const run = [q];
    while (i + 1 < qs.length && run.length < 10) {
      const n = qs[i + 1];
      if (n.type !== 'check' || !choiceLike(n) || !belongs(run[run.length - 1], n)) break;
      run.push(n); i++;
    }
    if (run.length < 2) { out.push(q); continue; }
    const first = run[0];
    const opts = new Set(run.map(x => x.optLabel));
    const row = Math.abs(run[1].rect.y - first.rect.y) <= Math.max(first.rect.h, run[1].rect.h);
    const its = items(first.page) || [];
    let label = nearbyLabel(its, first.rect, row ? 'left' : 'above', { exclude: opts });
    if (!label && row) label = nearbyLabel(its, first.rect, 'above', { exclude: opts });
    const gloss = label ? lookup(label) : null;
    out.push({
      id: 'grp:' + run.map(x => x.names[0]).join('|'), type: 'checks', names: run.map(x => x.names[0]), page: first.page,
      rect: union(run.map(x => x.rect)), label, near: label, tu: '', gloss, required: run.some(x => x.required),
      rule: { required: run.some(x => x.required), kind: null, pattern: '' },
      options: run.map(x => ({ value: x.names[0], label: x.optLabel, gloss: x.gloss, rect: x.rect })),
      value: run.filter(x => x.value).map(x => x.names[0]),
    });
    out[out.length - 1].initial = out[out.length - 1].value.slice();
  }
  return out;
}

function union(rects) {
  const x0 = Math.min(...rects.map(r => r.x)), y0 = Math.min(...rects.map(r => r.y));
  const x1 = Math.max(...rects.map(r => r.x + r.w)), y1 = Math.max(...rects.map(r => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Viewport rect (scale 1, page rotation applied) of a widget's PDF rect. */
function vrect(base, rect) {
  const [x1, y1] = base.convertToViewportPoint(rect[0], rect[1]);
  const [x2, y2] = base.convertToViewportPoint(rect[2], rect[3]);
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

/**
 * Read the form.
 * @param {object} o  { PDFLib, probe: pdf-lib document, pdf: pdf.js document, textItems: async (page, base) → items|null }
 * @returns {{questions, formLang: 'de'|'en'|null, sigFields: number, pages: [{page, base}], total: number}}
 */
export async function readForm({ PDFLib, probe, pdf, textItems }) {
  // 1) fields (pdf-lib: types, values, required, own formats) – the same reading as „Ausfüllen & unterschreiben“
  const fields = [];
  let sigFields = 0;
  const form = probe.getForm();
  for (const f of form.getFields()) {
    const name = f.getName();
    let tu = '';
    try { const v = f.acroField.dict.lookup(PDFLib.PDFName.of('TU')); if (v && v.decodeText) tu = v.decodeText(); } catch {}
    if (f instanceof PDFLib.PDFSignature) { sigFields++; continue; }
    let type = null, value = null, options = null, multiline = false, maxLen = 0, comb = false;
    if (f instanceof PDFLib.PDFTextField) {
      type = 'text'; value = f.getText() || '';
      try { multiline = f.isMultiline(); } catch {}
      try { maxLen = f.getMaxLength() || 0; } catch {}
      try { comb = f.isCombed(); } catch {}
    } else if (f instanceof PDFLib.PDFCheckBox) { type = 'check'; value = f.isChecked(); }
    else if (f instanceof PDFLib.PDFRadioGroup) { type = 'radio'; options = f.getOptions(); value = f.getSelected() || ''; }
    else if (f instanceof PDFLib.PDFDropdown || f instanceof PDFLib.PDFOptionList) { type = 'select'; options = f.getOptions(); value = (f.getSelected() || [])[0] || ''; }
    if (!type) continue;
    let readOnly = false;
    try { readOnly = f.isReadOnly(); } catch {}
    if (readOnly) continue;
    let fmt = formatSpec(PDFLib, f.acroField.dict);
    if (!fmt) { try { const w0 = f.acroField.getWidgets()[0]; if (w0) fmt = formatSpec(PDFLib, w0.dict); } catch {} }
    let required = false;
    try { required = f.isRequired(); } catch {}
    fields.push({ name, type, value, options, tu, fmt, required, multiline, maxLen, comb });
  }

  // 2) where the widgets are (pdf.js) and the text around them
  const pages = [];
  const widgets = new Map(); // name → [{page, rect, a}]
  const textCache = new Map();
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    pages.push({ page, base });
    let annots = [];
    try { annots = await page.getAnnotations({ intent: 'display' }); } catch {}
    for (const a of annots) {
      if (a.subtype !== 'Widget' || !a.fieldName || !a.rect) continue;
      if (!widgets.has(a.fieldName)) widgets.set(a.fieldName, []);
      widgets.get(a.fieldName).push({ page: n, rect: vrect(base, a.rect), a });
    }
  }
  const itemsOf = async n => {
    if (!textCache.has(n)) {
      let its = null;
      try { its = await textItems(pages[n - 1].page, pages[n - 1].base); } catch {}
      textCache.set(n, its || []);
    }
    return textCache.get(n);
  };
  // every box and round button per page – a label to the right of a box ends at the next one
  const boxesOnPage = new Map();
  for (const list of widgets.values()) for (const w of list) {
    if (!(w.a.checkBox || w.a.radioButton)) continue;
    if (!boxesOnPage.has(w.page)) boxesOnPage.set(w.page, []);
    boxesOnPage.get(w.page).push(w.rect);
  }
  const stopFor = (page, r) => {
    let s = Infinity;
    for (const o of boxesOnPage.get(page) || []) if (o !== r && o.x > r.x + r.w && Math.abs(o.y - r.y) < Math.max(o.h, r.h)) s = Math.min(s, o.x);
    return s;
  };

  // 3) questions
  const qs = [];
  for (const f of fields) {
    const ws = (widgets.get(f.name) || []).filter(w => w.rect.w > 0.5 && w.rect.h > 0.5);
    if (!ws.length) continue; // not on any page – nobody sees it
    const w0 = ws[0];
    const its = await itemsOf(w0.page);
    const tu = f.tu && !isGeneric(f.tu) ? short(f.tu) : '';
    const pretty = prettyName(f.name);
    let near = '';
    const q = {
      id: f.name, type: f.type, names: [f.name], page: w0.page, rect: w0.rect, tu, required: f.required,
      multiline: f.multiline, maxLen: f.maxLen, comb: f.comb,
      rule: ruleFor({ name: f.name, label: f.tu, type: f.type, required: f.required, fmt: f.fmt }),
      value: f.value, initial: f.value,
    };
    if (f.type === 'check') {
      near = nearbyLabel(its, w0.rect, 'right', { stopX: stopFor(w0.page, w0.rect) }) || nearbyLabel(its, w0.rect, 'left');
      q.optLabel = tu || near || pretty;
    } else if (f.type === 'radio') {
      const rws = ws.filter(w => w.a.buttonValue != null);
      const optLabels = new Map();
      for (const w of rws) {
        const wi = await itemsOf(w.page);
        optLabels.set(String(w.a.buttonValue), nearbyLabel(wi, w.rect, 'right', { stopX: stopFor(w.page, w.rect) }) || nearbyLabel(wi, w.rect, 'left'));
      }
      q.options = (f.options || []).map(v => {
        const lab = optLabels.get(String(v)) || (isGeneric(v) ? '' : String(v));
        return { value: v, label: lab || String(v), gloss: lab ? lookup(lab) : null, rect: (rws.find(w => String(w.a.buttonValue) === String(v)) || {}).rect };
      });
      const exclude = new Set(q.options.map(o => o.label));
      near = nearbyLabel(its, w0.rect, 'left', { exclude }) || nearbyLabel(its, w0.rect, 'above', { exclude });
      if (rws.length > 1) q.rect = union(rws.map(w => w.rect));
    } else if (f.type === 'select') {
      const disp = new Map(((w0.a && w0.a.options) || []).map(o => [String(o.exportValue), String(o.displayValue || o.exportValue)]));
      q.options = (f.options || []).map(v => { const lab = disp.get(String(v)) || String(v); return { value: v, label: lab, gloss: lookup(lab) }; });
      near = nearbyLabel(its, w0.rect, 'left') || nearbyLabel(its, w0.rect, 'above') || nearbyLabel(its, w0.rect, 'inside');
    } else {
      near = nearbyLabel(its, w0.rect, 'inside') || nearbyLabel(its, w0.rect, 'left');
      // the text above is a guess: a field with a known name („Ort, Datum“) keeps its name unless that text is known too
      // (otherwise a line of the letter above, or misread text in a photo, would become the question)
      if (!near) { const ab = nearbyLabel(its, w0.rect, 'above'); near = ab && !(pretty && !isGeneric(f.name) && lookup(pretty) && !lookup(ab)) ? ab : ''; }
    }
    q.near = near;
    q.label = tu || near || pretty || '';
    q.gloss = null;
    for (const cand of [tu, near, pretty]) { if (cand && (q.gloss = lookup(cand))) break; }
    if (f.type === 'check') q.gloss = q.optLabel ? lookup(q.optLabel) : null;
    // the label decides what is checked when the field has no own format („Geburtsdatum“ printed next to „Text3“)
    if (f.type === 'text' && !q.rule.kind && (near || pretty)) {
      const r2 = ruleFor({ name: pretty, label: near, type: 'text', required: f.required, fmt: f.fmt });
      if (r2.kind) q.rule = r2;
    }
    if (f.type === 'text' && !q.rule.kind && q.gloss) {
      const k = { date: 'date', zip: 'zip', iban: 'iban', mail: 'mail' }[q.gloss.kind];
      if (k) q.rule = { ...q.rule, kind: k };
    }
    qs.push(q);
  }
  const ordered = readingOrder(qs.map(q => Object.assign(q, { x: q.rect.x, y: q.rect.y, h: q.rect.h })));
  const textOf = n => textCache.get(n) || [];
  const questions = groupChecks(ordered, textOf);
  questions.forEach(q => { if (q.type === 'check' && !q.label) q.label = q.optLabel || ''; });

  // 4) the language of the form (from the labels the glossary knows)
  let de = 0, en = 0;
  for (const q of questions) {
    for (const g of [q.gloss, ...(q.options || []).map(o => o.gloss)]) { if (g && g.lang === 'de') de++; else if (g && g.lang === 'en') en++; }
  }
  const formLang = de || en ? (de >= en ? 'de' : 'en') : null;
  return { questions, formLang, sigFields, pages, total: questions.length };
}

/** „12.3.61“, „1961-03-12“ → the form's date format (dd.mm.yyyy unless the field says otherwise). */
export function formatDate(v, pattern = '') {
  const order = /^m/i.test(pattern) && !/^mmm/i.test(pattern) ? 'mdy' : 'dmy';
  const d = parseDate(String(v || '').trim(), order);
  if (!d || d.bad) return null;
  const p2 = n => String(n).padStart(2, '0');
  const p = String(pattern || 'dd.mm.yyyy');
  if (/mmm|h:|HH/.test(p)) return null;
  return p.replace(/yyyy/i, String(d.y)).replace(/yy/i, String(d.y).slice(-2)).replace(/mm/, p2(d.m)).replace(/dd/i, p2(d.d)).replace(/(^|[^a-z])m(?=[^a-z]|$)/, `$1${d.m}`).replace(/(^|[^a-z])d(?=[^a-z]|$)/i, `$1${d.d}`);
}
export const todayIn = pattern => { const d = new Date(); return formatDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, pattern || 'dd.mm.yyyy'); };
