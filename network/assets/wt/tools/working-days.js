// Tool: working days calculator (Arbeitstage-Rechner). Range with quick picks (this month, next month, this
// year, next year), federal state, Saturday as working day, Christmas Eve / New Year's Eve as half days, local
// holidays (Augsburg, Corpus Christi in parts of Saxony/Thuringia), vacation days subtracted. Shows every
// holiday in the range. Second card: a date plus / minus N working days (deadlines). Primary: holidays as .ics.
import { el, clear } from '../lib/dom.js';
import { T, calcCss, parseNum, fmt, field, copyBtn, liveRegion, warn } from '../lib/calc-core.js';
import { STATES, NOTES } from '../lib/tpl-holidays.js';
import { iso, parse, today, addDays, D, workdays, addWorkdays, longDate, shortDate } from '../lib/date-calc.js';

calcCss();
const STORE = 'fale-wt-state';
const inState = code => (code === 'SL' ? 'im Saarland' : `in ${STATES[code]}`);   // only the chosen federal state is remembered, nothing else

export default {
  labels: { back_to_files: { de: 'Zurück zum Rechner', en: 'Back to the calculator' } },
  mountStage(stage, state, ctx) { stage.append(build(state, ctx)); },
  status(v) {
    const r = v.wdResult;
    if (!r) return { ok: false, hint: { de: 'Wähle einen Zeitraum.', en: 'Choose a period.' } };
    if (!r.holidays.length) return { ok: false, summary: { de: `${fmt(r.work, { max: 1 })} Arbeitstage`, en: `${fmt(r.work, { max: 1 }, 'en')} working days` }, hint: { de: 'Keine Feiertage im Zeitraum.', en: 'No public holidays in the period.' } };
    return { summary: { de: `${fmt(r.work, { max: 1 })} Arbeitstage`, en: `${fmt(r.work, { max: 1 })} working days` } };
  },
  async run(inputs, opts, ctx) {
    const r = opts.wdResult;
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const esc = s => String(s).replace(/([,;\\])/g, '\\$1');
    const ev = r.holidays.map(h => {
      const d = h.date.replace(/-/g, ''), next = iso(addDays(parse(h.date), 1)).replace(/-/g, '');
      return ['BEGIN:VEVENT', `UID:${d}-${opts.wdState}@fale.network`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next}`, `SUMMARY:${esc(ctx.lang === 'de' ? h.de : h.en)}`, 'TRANSP:TRANSPARENT', 'END:VEVENT'].join('\r\n');
    });
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FaleNetwork//Feiertage//DE', 'CALSCALE:GREGORIAN', ...ev, 'END:VCALENDAR'].join('\r\n') + '\r\n';
    const name = ctx.lang === 'de' ? `Feiertage ${STATES[opts.wdState]}.ics` : `Public holidays ${STATES[opts.wdState]}.ics`;
    return { outputs: [{ name, blob: new Blob([ics], { type: 'text/calendar;charset=utf-8' }) }] };
  },
};

function build(state, ctx) {
  const lang = ctx.lang, v = state.values;
  const w = (de, en) => T({ de, en }, lang);
  const live = liveRegion();
  let stateCode = 'SL';
  try { const s = localStorage.getItem(STORE); if (STATES[s]) stateCode = s; } catch { /* private mode */ }
  const t = today();
  const st = { from: iso(D(t.getFullYear(), 1, 1)), to: iso(D(t.getFullYear(), 12, 31)) };
  const fromIn = el('input', { type: 'date', id: 'wd-from', class: 'wt-input calc-in', value: st.from });
  const toIn = el('input', { type: 'date', id: 'wd-to', class: 'wt-input calc-in', value: st.to });
  const stateSel = el('select', { id: 'wd-state', class: 'wt-input' }, Object.entries(STATES).map(([k, n]) => el('option', { value: k, selected: k === stateCode }, n)));
  const chk = (id, label) => { const c = el('input', { type: 'checkbox', id }); return { c, row: el('label', { class: 'calc-check', for: id }, c, el('span', {}, label)) }; };
  const sat = chk('wd-sat', w('Samstag ist Arbeitstag (Werktage)', 'Saturday is a working day'));
  const half = chk('wd-half', w('24.12. und 31.12. als halbe Tage', '24 and 31 December as half days'));
  const local = chk('wd-local', '');
  const vac = field({ id: 'wd-vac', label: w('Urlaubstage abziehen', 'Subtract vacation days'), inputmode: 'numeric', value: '' , onInput: () => calc() });
  const quick = el('div', { class: 'calc-actions' });
  const q = (label, f, tt) => quick.append(el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm', onclick: () => { fromIn.value = iso(f); toIn.value = iso(tt); calc(); } }, label));
  const y = t.getFullYear(), m = t.getMonth() + 1;
  q(w('Dieser Monat', 'This month'), D(y, m, 1), addDays(D(y, m + 1, 1), -1));
  q(w('Nächster Monat', 'Next month'), D(y, m + 1, 1), addDays(D(y, m + 2, 1), -1));
  q(w(`Jahr ${y}`, `Year ${y}`), D(y, 1, 1), D(y, 12, 31));
  q(w(`Jahr ${y + 1}`, `Year ${y + 1}`), D(y + 1, 1, 1), D(y + 1, 12, 31));
  const big = el('p', { class: 'calc-big' }, '–');
  const sub = el('p', { class: 'calc-sub' });
  const details = el('div', { class: 'calc-out' });
  const note = el('div');
  const hol = el('div');
  [fromIn, toIn].forEach(i => i.addEventListener('input', () => calc()));
  stateSel.addEventListener('change', () => { try { localStorage.setItem(STORE, stateSel.value); } catch { /* ignore */ } calc(); });
  [sat.c, half.c, local.c].forEach(c => c.addEventListener('change', () => calc()));

  // deadline card
  const dStart = el('input', { type: 'date', id: 'wd-dstart', class: 'wt-input calc-in', value: iso(t) });
  const dN = field({ id: 'wd-dn', label: w('Arbeitstage (+ oder −)', 'Working days (+ or −)'), inputmode: 'numeric', value: '10', onInput: () => deadline() });
  const dOut = el('p', { class: 'calc-big calc-big-s' }, '–');
  const dWay = el('p', { class: 'calc-sub' });
  dStart.addEventListener('input', () => deadline());

  function calc() {
    const code = stateSel.value;
    const lab = local.row.querySelector('span');
    local.row.hidden = !['BY', 'SN', 'TH'].includes(code);
    lab.textContent = code === 'BY' ? w('Augsburger Friedensfest (8.8.) mitzählen – nur Stadt Augsburg', 'Count the Augsburg Peace Festival (8 Aug) – city of Augsburg only')
      : w('Fronleichnam mitzählen – nur in einigen Gemeinden', 'Count Corpus Christi – some municipalities only');
    clear(note);
    if (NOTES[code]) note.append(el('p', { class: 'calc-hint' }, NOTES[code]));
    const vacDays = parseNum(vac.input.value, lang);
    const r = workdays(fromIn.value, toIn.value, { state: code, saturday: sat.c.checked, halfDays: half.c.checked, augsburg: local.c.checked && code === 'BY', localCorpus: local.c.checked && code !== 'BY', vacation: Number.isFinite(vacDays) ? vacDays : 0 });
    clear(details); clear(hol);
    v.wdResult = r; v.wdState = code;
    if (!r) {
      big.textContent = '–'; sub.textContent = '';
      details.append(warn(w('Prüf die Daten: Das Ende muss nach dem Anfang liegen.', 'Check the dates: the end must be after the start.')));
      state.results.clear(); ctx.refresh(); return;
    }
    big.textContent = fmt(r.work, { max: 1 });
    sub.textContent = w(`${r.work === 1 ? 'Arbeitstag' : 'Arbeitstage'} ${inState(code)}${sat.c.checked ? ' (Mo–Sa)' : ' (Mo–Fr)'}`, `working days in ${STATES[code]}${sat.c.checked ? ' (Mon–Sat)' : ' (Mon–Fri)'}`);
    const row = (l, val) => el('div', { class: 'calc-row' }, el('span', { class: 'calc-row-label' }, l), el('span', { class: 'calc-row-val' }, val));
    details.append(row(w('Kalendertage', 'Calendar days'), fmt(r.calendar, { max: 0 })), row(w('Wochen', 'Weeks'), fmt(r.weeks, { max: 1 })),
      row(sat.c.checked ? w('Sonntage', 'Sundays') : w('Wochenendtage', 'Weekend days'), fmt(r.weekend, { max: 0 })),
      row(w('Feiertage an Arbeitstagen', 'Holidays on working days'), fmt(r.holidays.length, { max: 0 })));
    if (r.half.length) details.append(row(w('Halbe Tage', 'Half days'), fmt(r.half.length, { max: 0 })));
    if (r.vacation) details.append(row(w('Urlaub abgezogen', 'Vacation subtracted'), fmt(r.vacation, { max: 1 })));
    details.append(el('div', { class: 'calc-row' }, el('span', { class: 'calc-row-label' }, w('Ergebnis kopieren', 'Copy result')), copyBtn(() => fmt(r.work, { max: 1 }), w('Arbeitstage kopieren', 'Copy working days'), live)));
    if (r.holidays.length) {
      hol.append(el('h3', { class: 'img-h' }, w('Feiertage im Zeitraum (Mo–Fr)', 'Public holidays in the period (Mon–Fri)')),
        el('ul', { class: 'calc-list' }, r.holidays.map(h => el('li', {}, `${shortDate(parse(h.date), lang)} – ${lang === 'de' ? h.de : h.en}`))));
    }
    state.results.clear(); ctx.refresh();
    deadline();
  }
  function deadline() {
    const n = parseNum(dN.input.value, lang);
    const d = Number.isFinite(n) ? addWorkdays(dStart.value, n, { state: stateSel.value, saturday: sat.c.checked, augsburg: local.c.checked && stateSel.value === 'BY', localCorpus: local.c.checked && stateSel.value !== 'BY' }) : null;
    if (!d) { dOut.textContent = '–'; dWay.textContent = ''; return; }
    dOut.textContent = longDate(d, lang);
    dWay.textContent = w(`${fmt(Math.abs(n), { max: 0 })} Arbeitstage ${n < 0 ? 'vor' : 'nach'} dem ${shortDate(parse(dStart.value), lang)} – Wochenenden und Feiertage ${inState(stateSel.value)} übersprungen.`,
      `${fmt(Math.abs(n), { max: 0 })} working days ${n < 0 ? 'before' : 'after'} ${shortDate(parse(dStart.value), lang)} – weekends and holidays in ${STATES[stateSel.value]} skipped.`);
  }
  const box = el('section', { class: 'img-box calc', aria: { labelledby: 'wd-h' } },
    el('h2', { class: 'img-h', id: 'wd-h' }, w('Arbeitstage berechnen', 'Count working days')),
    el('div', { class: 'calc-grid calc-grid-3' },
      el('div', { class: 'calc-field' }, el('label', { class: 'calc-label', for: 'wd-from' }, w('Von', 'From')), fromIn),
      el('div', { class: 'calc-field' }, el('label', { class: 'calc-label', for: 'wd-to' }, w('Bis (einschließlich)', 'To (inclusive)')), toIn),
      el('div', { class: 'calc-field' }, el('label', { class: 'calc-label', for: 'wd-state' }, w('Bundesland', 'Federal state')), stateSel)),
    quick, sat.row, half.row, local.row, vac.wrap, note,
    el('div', { class: 'calc-out' }, big, sub), details, hol, live);
  const dl = el('section', { class: 'img-box calc', aria: { labelledby: 'wd-dh' } },
    el('h2', { class: 'img-h', id: 'wd-dh' }, w('Frist berechnen: Datum plus Arbeitstage', 'Deadline: date plus working days')),
    el('div', { class: 'calc-grid calc-grid-2' }, el('div', { class: 'calc-field' }, el('label', { class: 'calc-label', for: 'wd-dstart' }, w('Ab dem', 'Starting from')), dStart), dN.wrap),
    el('div', { class: 'calc-out' }, dOut, dWay));
  calc();
  return el('div', { class: 'calc' }, box, dl);
}
