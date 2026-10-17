// Tool: percentage calculator (Prozentrechner). Six everyday questions, each as a sentence with the result and
// the way to it: p % of a value, what percentage, the base value, the change from A to B, plus / minus p %,
// and the price before a discount. Nothing to save – the shell bar is hidden (noBar).
import { el } from '../lib/dom.js';
import { T, calcCss, parseNum, fmt, copyBtn, liveRegion } from '../lib/calc-core.js';

calcCss();
const n = x => fmt(x, { max: 4 });
const n2 = x => fmt(x, { max: 2 });   // amounts of money (mark-up, discount, price before)

/** Pure maths, exported for the unit test. All return NaN for unusable input. */
export const pct = {
  of: (p, g) => (p / 100) * g,
  share: (w, g) => (g ? (w / g) * 100 : NaN),
  base: (w, p) => (p ? (w / p) * 100 : NaN),
  change: (a, b) => (a ? ((b - a) / Math.abs(a)) * 100 : NaN),
  plus: (g, p) => g * (1 + p / 100),
  minus: (g, p) => g * (1 - p / 100),
  before: (x, p) => (p !== 100 ? x / (1 - p / 100) : NaN),
};

export default {
  noBar: true,
  mountStage(stage, state, ctx) { stage.append(build(ctx.lang)); },
  status() { return { ok: false }; },
  async run() { throw Object.assign(new Error('nothing'), { userMessage: { de: 'Hier gibt es nichts zu speichern.', en: 'Nothing to save here.' } }); },
};

function build(lang) {
  const live = liveRegion();
  let uid = 0;
  const inp = (label, val = '') => {
    const i = el('input', { class: 'wt-input calc-in', inputmode: 'decimal', value: val, id: `pc-${++uid}`, aria: { label }, autocomplete: 'off' });
    return i;
  };
  function card(title, parts, compute) {
    const res = el('p', { class: 'calc-big' }, '–');
    const way = el('p', { class: 'calc-way', hidden: true });
    const copy = copyBtn(() => res.textContent.replace(/[^\d,.\-]/g, ''), T({ de: 'Ergebnis kopieren', en: 'Copy result' }), live);
    const inputs = parts.filter(p => p instanceof HTMLInputElement);
    const update = () => {
      const vals = inputs.map(i => parseNum(i.value, lang));
      const r = vals.every(Number.isFinite) ? compute(...vals) : null;
      if (!r || !Number.isFinite(r.value)) { res.textContent = '–'; way.hidden = true; copy.disabled = true; return; }
      res.textContent = r.text; way.textContent = r.way; way.hidden = false; copy.disabled = false;
    };
    inputs.forEach(i => i.addEventListener('input', update));
    update();
    return el('section', { class: 'calc-card' }, el('h3', {}, title), el('div', { class: 'calc-sentence' }, parts),
      el('div', { class: 'calc-row' }, res, copy), way);
  }
  const w = (de, en) => T({ de, en }, lang);
  const p1 = inp(w('Prozentsatz', 'Percentage'), '19'), g1 = inp(w('Grundwert', 'Base value'), '250');
  const w2 = inp(w('Teilwert', 'Part'), '45'), g2 = inp(w('Grundwert', 'Base value'), '180');
  const w3 = inp(w('Teilwert', 'Part'), '30'), p3 = inp(w('Prozentsatz', 'Percentage'), '15');
  const a4 = inp(w('Alter Wert', 'Old value'), '80'), b4 = inp(w('Neuer Wert', 'New value'), '92');
  const g5 = inp(w('Wert', 'Value'), '100'), p5 = inp(w('Prozent', 'Percent'), '20');
  const g6 = inp(w('Wert', 'Value'), '100'), p6 = inp(w('Prozent', 'Percent'), '20');
  const x7 = inp(w('Preis nach Rabatt', 'Price after discount'), lang === 'de' ? '59,99' : '59.99'), p7 = inp(w('Rabatt in Prozent', 'Discount in percent'), '25');
  const box = el('section', { class: 'img-box calc', aria: { labelledby: 'pc-h' } },
    el('h2', { class: 'img-h', id: 'pc-h' }, w('Prozente berechnen', 'Calculate percentages')),
    el('div', { class: 'calc-grid calc-grid-2' },
      card(w('Wie viel sind p % von …?', 'What is p % of …?'), [p1, '% ' + w('von', 'of'), g1, '?'], (p, g) => {
        const v = pct.of(p, g); return { value: v, text: n(v), way: `${n(g)} × ${n(p)} ÷ 100 = ${n(v)}` };
      }),
      card(w('Wie viel Prozent sind …?', 'What percentage is …?'), [w2, w('von', 'of'), g2, w('sind wie viel %?', '= how many %?')], (x, g) => {
        const v = pct.share(x, g); return { value: v, text: `${n(v)} %`, way: `${n(x)} ÷ ${n(g)} × 100 = ${n(v)} %` };
      }),
      card(w('Grundwert: … sind p % von wie viel?', 'Base value: … is p % of what?'), [w3, w('sind', 'is'), p3, w('% von wie viel?', '% of what?')], (x, p) => {
        const v = pct.base(x, p); return { value: v, text: n(v), way: `${n(x)} ÷ ${n(p)} × 100 = ${n(v)}` };
      }),
      card(w('Prozentuale Veränderung', 'Percentage change'), [w('von', 'from'), a4, w('auf', 'to'), b4], (a, b) => {
        const v = pct.change(a, b);
        return { value: v, text: `${v > 0 ? '+' : ''}${n(v)} %`, way: `(${n(b)} − ${n(a)}) ÷ ${n(Math.abs(a))} × 100 = ${v > 0 ? '+' : ''}${n(v)} %` + (Math.abs(b - a) ? w(` · Differenz ${n(b - a)}`, ` · difference ${n(b - a)}`) : '') };
      }),
      card(w('Aufschlag: Wert plus p %', 'Mark-up: value plus p %'), [g5, '+', p5, '%'], (g, p) => {
        const v = pct.plus(g, p); return { value: v, text: n2(v), way: `${n(g)} × (1 + ${n(p)} ÷ 100) = ${n2(v)} · ${w('Aufschlag', 'mark-up')} ${n2(v - g)}` };
      }),
      card(w('Rabatt: Wert minus p %', 'Discount: value minus p %'), [g6, '−', p6, '%'], (g, p) => {
        const v = pct.minus(g, p); return { value: v, text: n2(v), way: `${n(g)} × (1 − ${n(p)} ÷ 100) = ${n2(v)} · ${w('Ersparnis', 'saving')} ${n2(g - v)}` };
      }),
      card(w('Preis vor dem Rabatt', 'Price before the discount'), [x7, w('nach', 'after'), p7, w('% Rabatt – vorher?', '% off – before?')], (x, p) => {
        const v = pct.before(x, p); return { value: v, text: n2(v), way: `${n(x)} ÷ (1 − ${n(p)} ÷ 100) = ${n2(v)}` };
      })),
    el('p', { class: 'calc-hint' }, w('Zahlen mit Komma oder Punkt – beides geht. Prozentpunkte sind etwas anderes als Prozent: Von 10 % auf 12 % sind es 2 Prozentpunkte, aber +20 %.',
      'Numbers with a comma or a point both work. Percentage points differ from percent: from 10 % to 12 % is 2 percentage points but +20 %.')),
    live);
  return box;
}
