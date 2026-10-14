// Renders option controls from a tool's declarative schema.
//
// Schema entry: { id, type, label, hint?, default, when?(values, inputs), live?, perFile?, … }
//   type 'radio'   choices: [{value, label, hint?}]       → radio cards (fieldset)
//   type 'toggle'                                          → switch (checkbox)
//   type 'range'   min, max, step, unit?, format?(v)       → slider with live value
//   type 'select'  choices: [{value, label}]
//   type 'text'    placeholder?, maxLength?
//   type 'number'  min?, max?, step?, unit?
//   type 'pages'   placeholder?                            → page-range text ("1-3, 5"), validated by the shell
//   type 'color'
// Texts (label, hint, choice labels, placeholder, unit) are strings or {de, en}.
import { el } from './dom.js';
import { pick, t } from './strings.js';
import { parsePages, PageRangeError } from './ranges.js';

export function defaults(schema) {
  const v = {};
  for (const o of schema) v[o.id] = o.default ?? (o.type === 'toggle' ? false : o.type === 'radio' || o.type === 'select' ? o.choices?.[0]?.value : '');
  return v;
}

/**
 * @param {object[]} schema
 * @param {{lang: string, values: object, idPrefix: string, onChange: (id, value) => void, getInputs?: () => any[], pageCount?: () => number|null}} ctx
 * @returns {{root: HTMLElement, refresh: () => void, validate: () => boolean}}
 */
export function renderOptions(schema, ctx) {
  const { lang, values, idPrefix, onChange } = ctx;
  const root = el('div', { class: 'wt-opts' });
  const rows = [];
  for (const o of schema) {
    const row = control(o);
    rows.push([o, row]);
    root.append(row.node);
  }
  function refresh() {
    const inputs = ctx.getInputs ? ctx.getInputs() : [];
    for (const [o, row] of rows) row.node.hidden = typeof o.when === 'function' ? !o.when(values, inputs) : false;
  }
  function validate() {
    let ok = true;
    for (const [o, row] of rows) if (!row.node.hidden && row.validate && !row.validate()) ok = false;
    return ok;
  }
  refresh();
  return { root, refresh, validate };

  function set(o, v) { values[o.id] = v; onChange?.(o.id, v); refresh(); }

  function hintEl(o, id) { const h = pick(lang, o.hint); return h ? el('p', { class: 'wt-opt-hint', id }, h) : null; }

  function control(o) {
    const id = `${idPrefix}-${o.id}`;
    const label = pick(lang, o.label);
    const hint = hintEl(o, id + '-hint');
    const describedby = hint ? id + '-hint' : null;
    switch (o.type) {
      case 'radio': {
        const cards = (o.choices || []).map(c => {
          const input = el('input', { type: 'radio', name: id, value: String(c.value), checked: String(values[o.id]) === String(c.value), onchange: () => set(o, c.value) });
          const h = pick(lang, c.hint);
          return el('label', { class: 'wt-radio' }, input, el('span', { class: 'wt-radio-body' }, el('strong', {}, pick(lang, c.label)), h ? el('span', {}, h) : null));
        });
        const node = el('fieldset', { class: 'wt-opt wt-opt-radio', aria: { describedby } }, el('legend', {}, label), el('div', { class: 'wt-radios' + ((o.choices || []).length > 3 ? ' wt-radios-many' : '') }, cards), hint);
        return { node };
      }
      case 'toggle': {
        const input = el('input', { type: 'checkbox', id, role: 'switch', checked: !!values[o.id], aria: { describedby }, onchange: e => set(o, e.target.checked) });
        return { node: el('div', { class: 'wt-opt wt-opt-toggle' }, el('label', { class: 'wt-switch', for: id }, el('span', { class: 'wt-switch-text' }, label), input, el('span', { class: 'wt-switch-ui', 'aria-hidden': 'true' })), hint) };
      }
      case 'range': {
        const fmt = v => (o.format ? o.format(v, lang) : `${v}${pick(lang, o.unit) ? ' ' + pick(lang, o.unit) : ''}`);
        const out = el('output', { for: id, class: 'wt-range-val' }, fmt(values[o.id]));
        const input = el('input', { type: 'range', id, min: String(o.min ?? 0), max: String(o.max ?? 100), step: String(o.step ?? 1), value: String(values[o.id]), aria: { describedby },
          oninput: e => { out.textContent = fmt(+e.target.value); input.setAttribute('aria-valuetext', fmt(+e.target.value)); },
          onchange: e => set(o, +e.target.value) });
        input.setAttribute('aria-valuetext', fmt(values[o.id]));
        return { node: el('div', { class: 'wt-opt wt-opt-range' }, el('div', { class: 'wt-opt-row' }, el('label', { for: id }, label), out), input, hint) };
      }
      case 'select': {
        const sel = el('select', { id, class: 'wt-input', aria: { describedby }, onchange: e => set(o, coerce(o, e.target.value)) },
          (o.choices || []).map(c => el('option', { value: String(c.value), selected: String(values[o.id]) === String(c.value) }, pick(lang, c.label))));
        return { node: el('div', { class: 'wt-opt' }, el('label', { for: id }, label), sel, hint) };
      }
      case 'color': {
        const input = el('input', { type: 'color', id, value: String(values[o.id] || '#000000'), class: 'wt-color', aria: { describedby }, onchange: e => set(o, e.target.value) });
        return { node: el('div', { class: 'wt-opt wt-opt-inline' }, el('label', { for: id }, label), input, hint) };
      }
      default: { // text, number, pages
        const err = el('p', { class: 'wt-opt-err', id: id + '-err', hidden: true, role: 'alert' });
        const input = el('input', {
          id, class: 'wt-input', type: o.type === 'number' ? 'number' : 'text', value: String(values[o.id] ?? ''),
          placeholder: pick(lang, o.placeholder) || (o.type === 'pages' ? t(lang, 'pages_ph') : null),
          inputmode: o.type === 'pages' ? 'text' : (o.type === 'number' ? 'decimal' : null), autocomplete: 'off',
          maxlength: o.maxLength ? String(o.maxLength) : null, min: o.min != null ? String(o.min) : null, max: o.max != null ? String(o.max) : null, step: o.step != null ? String(o.step) : null,
          aria: { describedby: [describedby, id + '-err'].filter(Boolean).join(' ') },
          oninput: e => { values[o.id] = coerce(o, e.target.value); onChange?.(o.id, values[o.id]); if (!err.hidden) validate(); },
          onchange: () => validate(),
        });
        const validate = () => {
          let msg = '';
          if (o.type === 'pages' && String(values[o.id] || '').trim()) {
            const count = ctx.pageCount ? ctx.pageCount() : null;
            try { parsePages(values[o.id], count ?? 100000); } catch (e) {
              msg = e instanceof PageRangeError && e.kind === 'range' && count ? t(lang, 'pages_range', { n: count }) : t(lang, 'pages_invalid');
            }
          }
          if (typeof o.validate === 'function') msg = msg || o.validate(values[o.id], lang) || '';
          err.textContent = msg;
          err.hidden = !msg;
          input.setAttribute('aria-invalid', msg ? 'true' : 'false');
          return !msg;
        };
        const unit = pick(lang, o.unit);
        return { node: el('div', { class: 'wt-opt' }, el('label', { for: id }, label), unit ? el('div', { class: 'wt-input-unit' }, input, el('span', {}, unit)) : input, hint, err), validate };
      }
    }
  }
}

function coerce(o, v) {
  if (o.type === 'number') return v === '' ? '' : Number(v);
  if (o.type === 'select' && o.choices?.length && typeof o.choices[0].value === 'number') return Number(v);
  return v;
}
