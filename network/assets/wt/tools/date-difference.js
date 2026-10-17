// Tool: days between two dates (Tage zwischen zwei Daten) and date plus/minus days, weeks, months, years.
// Results in days, weeks + days, years/months/days and – handy for notice periods – with or without the end
// day. Age / anniversary falls out of the same maths. Nothing to save (noBar).
import { el, clear } from '../lib/dom.js';
import { T, calcCss, parseNum, fmt, field, segmented, copyBtn, liveRegion, warn } from '../lib/calc-core.js';
import { iso, parse, today, addDays, addMonths, daysBetween, ymd, isoWeek, longDate } from '../lib/date-calc.js';

calcCss();

export default {
  noBar: true,
  mountStage(stage, state, ctx) { stage.append(build(ctx.lang)); },
  status() { return { ok: false }; },
  async run() { throw Object.assign(new Error('nothing'), { userMessage: { de: 'Hier gibt es nichts zu speichern.', en: 'Nothing to save here.' } }); },
};

function build(lang) {
  const w = (de, en) => T({ de, en }, lang);
  const live = liveRegion();
  const t = today();
  // ---------------- between
  const a = el('input', { type: 'date', id: 'dd-a', class: 'wt-input calc-in', value: iso(t) });
  const b = el('input', { type: 'date', id: 'dd-b', class: 'wt-input calc-in', value: iso(new Date(t.getFullYear(), 11, 24, 12)) });
  const endChk = el('input', { type: 'checkbox', id: 'dd-end' });
  const big = el('p', { class: 'calc-big' }, '–');
  const sub = el('p', { class: 'calc-sub' });
  const rows = el('div', { class: 'calc-out' });
  const swap = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm', onclick: () => { [a.value, b.value] = [b.value, a.value]; between(); } }, w('Tauschen', 'Swap'));
  const todayBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm', onclick: () => { a.value = iso(today()); between(); } }, w('Heute als Start', 'Today as start'));
  [a, b].forEach(i => i.addEventListener('input', between));
  endChk.addEventListener('change', between);
  function between() {
    clear(rows);
    const A = parse(a.value), B = parse(b.value);
    if (!A || !B) { big.textContent = '–'; sub.textContent = ''; return; }
    const neg = B < A;
    const [x, y] = neg ? [B, A] : [A, B];
    const days = daysBetween(x, y) + (endChk.checked ? 1 : 0);
    const r = ymd(x, endChk.checked ? addDays(y, 1) : y);
    big.textContent = `${fmt(days, { max: 0 })} ${days === 1 ? w('Tag', 'day') : w('Tage', 'days')}`;
    sub.textContent = neg ? w('Das zweite Datum liegt vor dem ersten.', 'The second date is before the first.') : (endChk.checked ? w('Start- und Endtag mitgezählt', 'Start and end day counted') : w('ohne den Endtag (wie bei Fristen üblich: Differenz)', 'without the end day (the plain difference)'));
    const row = (l, val) => el('div', { class: 'calc-row' }, el('span', { class: 'calc-row-label' }, l), el('span', { class: 'calc-row-val' }, val));
    const parts = [];
    if (r.years) parts.push(`${r.years} ${r.years === 1 ? w('Jahr', 'year') : w('Jahre', 'years')}`);
    if (r.months) parts.push(`${r.months} ${r.months === 1 ? w('Monat', 'month') : w('Monate', 'months')}`);
    if (r.days || !parts.length) parts.push(`${r.days} ${r.days === 1 ? w('Tag', 'day') : w('Tage', 'days')}`);
    rows.append(row(w('In Jahren, Monaten, Tagen', 'In years, months, days'), parts.join(', ')),
      row(w('In Wochen', 'In weeks'), `${Math.floor(days / 7)} ${w('Wochen', 'weeks')}${days % 7 ? ` + ${days % 7} ${w('Tage', 'days')}` : ''}`),
      row(w('In Stunden', 'In hours'), fmt(days * 24, { max: 0 })),
      row(w('Wochentag Start', 'Start weekday'), longDate(x, lang)),
      row(w('Wochentag Ende', 'End weekday'), `${longDate(y, lang)} · ${w('KW', 'week')} ${isoWeek(y).week}`),
      el('div', { class: 'calc-row' }, el('span', { class: 'calc-row-label' }, w('Anzahl Tage kopieren', 'Copy number of days')), copyBtn(() => String(days), w('Tage kopieren', 'Copy days'), live)));
  }
  // ---------------- add
  const start = el('input', { type: 'date', id: 'dd-s', class: 'wt-input calc-in', value: iso(t) });
  const amount = field({ id: 'dd-n', label: w('Anzahl', 'Amount'), inputmode: 'numeric', value: '30', onInput: () => add() });
  let unit = 'd', sign = 1;
  const unitSeg = segmented({ name: 'dd-unit', label: w('Einheit', 'Unit'), value: unit, onChange: u => { unit = u; add(); },
    choices: [{ value: 'd', label: w('Tage', 'Days') }, { value: 'w', label: w('Wochen', 'Weeks') }, { value: 'm', label: w('Monate', 'Months') }, { value: 'y', label: w('Jahre', 'Years') }] });
  const signSeg = segmented({ name: 'dd-sign', label: w('Richtung', 'Direction'), value: '1', onChange: s => { sign = Number(s); add(); },
    choices: [{ value: '1', label: w('plus (später)', 'plus (later)') }, { value: '-1', label: w('minus (früher)', 'minus (earlier)') }] });
  const out = el('p', { class: 'calc-big calc-big-s' }, '–');
  const outSub = el('p', { class: 'calc-sub' });
  const err = el('div');
  start.addEventListener('input', add);
  function add() {
    clear(err);
    const s = parse(start.value), n = parseNum(amount.input.value, lang);
    if (!s || !Number.isFinite(n)) { out.textContent = '–'; outSub.textContent = ''; if (amount.input.value.trim() && !Number.isFinite(n)) err.append(warn(w('Bitte eine ganze Zahl eingeben.', 'Please enter a whole number.'))); return; }
    const k = Math.trunc(n) * sign;
    const d = unit === 'd' ? addDays(s, k) : unit === 'w' ? addDays(s, k * 7) : unit === 'm' ? addMonths(s, k) : addMonths(s, k * 12);
    out.textContent = longDate(d, lang);
    outSub.textContent = `${w('KW', 'Week')} ${isoWeek(d).week}` + ((unit === 'm' || unit === 'y') && d.getDate() !== s.getDate() ? w(' · Den Tag gibt es im Zielmonat nicht – es ist der Monatsletzte.', ' · That day doesn’t exist in the target month – it is the last day of the month.') : '');
  }
  const box1 = el('section', { class: 'img-box calc', aria: { labelledby: 'dd-h' } },
    el('h2', { class: 'img-h', id: 'dd-h' }, w('Tage zwischen zwei Daten', 'Days between two dates')),
    el('div', { class: 'calc-grid calc-grid-2' },
      el('div', { class: 'calc-field' }, el('label', { class: 'calc-label', for: 'dd-a' }, w('Startdatum', 'Start date')), a),
      el('div', { class: 'calc-field' }, el('label', { class: 'calc-label', for: 'dd-b' }, w('Enddatum', 'End date')), b)),
    el('div', { class: 'calc-actions' }, todayBtn, swap),
    el('label', { class: 'calc-check', for: 'dd-end' }, endChk, el('span', {}, w('Endtag mitzählen (z. B. Urlaub vom 1. bis 5. = 5 Tage)', 'Count the end day (e.g. holiday from the 1st to the 5th = 5 days)'))),
    el('div', { class: 'calc-out' }, big, sub), rows, live);
  const box2 = el('section', { class: 'img-box calc', aria: { labelledby: 'dd-h2' } },
    el('h2', { class: 'img-h', id: 'dd-h2' }, w('Datum plus oder minus', 'Date plus or minus')),
    el('div', { class: 'calc-grid calc-grid-2' }, el('div', { class: 'calc-field' }, el('label', { class: 'calc-label', for: 'dd-s' }, w('Ausgangsdatum', 'Starting date')), start), amount.wrap),
    unitSeg, signSeg, err, el('div', { class: 'calc-out' }, out, outSub));
  between(); add();
  return el('div', { class: 'calc' }, box1, box2);
}
