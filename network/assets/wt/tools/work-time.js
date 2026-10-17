// Tool: working time calculator (Arbeitszeitrechner) with a timesheet. One row per day: start, end, break –
// across midnight, with the legal minimum break deducted if wanted (§ 4 ArbZG) and notes for more than 8 / 10
// hours and less than 11 hours of rest. Vacation, sick days and holidays count as target met. Totals in h:mm
// and decimal hours, overtime against a daily target, a h:mm ⇄ decimal converter. Saves the timesheet as PDF
// (to sign) or CSV. Entries stay in memory unless "remember on this device" is ticked.
import { el, clear } from '../lib/dom.js';
import { T, calcCss, fmt, copyBtn, liveRegion } from '../lib/calc-core.js';
import { iso, parse, today, addDays, D } from '../lib/date-calc.js';
import { parseTime, parseDuration, hhmm, decimal, sheetCalc } from '../lib/worktime.js';

calcCss();
const KEEP = 'fale-wt-worktime';
const KINDS = [
  { value: 'work', de: 'Arbeit', en: 'Work' }, { value: 'vacation', de: 'Urlaub', en: 'Vacation' },
  { value: 'sick', de: 'Krank', en: 'Sick' }, { value: 'holiday', de: 'Feiertag', en: 'Public holiday' }, { value: 'off', de: 'Frei', en: 'Day off' },
];
const kindLabel = (k, lang) => T(KINDS.find(x => x.value === k) || KINDS[0], lang);
const WD = { de: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'], en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] };
const dayLabel = (s, lang) => { const d = parse(s); return d ? `${WD[lang][d.getDay()]} ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.` : '–'; };
const dec = (min, lang) => fmt(decimal(min), { min: 2, max: 2, lang });

function weekRows(from) {
  const d = parse(from) || today();
  const mon = addDays(d, -((d.getDay() + 6) % 7));
  return [0, 1, 2, 3, 4].map(i => ({ date: iso(addDays(mon, i)), kind: 'work', start: '', end: '', pause: '' }));
}
function monthRows(y, m) {
  const rows = [];
  for (let d = D(y, m, 1); d.getMonth() === m - 1; d = addDays(d, 1)) if (d.getDay() % 6) rows.push({ date: iso(d), kind: 'work', start: '', end: '', pause: '' });
  return rows;
}

export default {
  labels: { back_to_files: { de: 'Zurück zum Rechner', en: 'Back to the calculator' } },
  options: [
    { id: 'format', type: 'radio', default: 'pdf', label: { de: 'Stundenzettel speichern als', en: 'Save timesheet as' },
      choices: [{ value: 'pdf', label: 'PDF', hint: { de: 'Zum Ausdrucken und Unterschreiben', en: 'To print and sign' } }, { value: 'csv', label: 'CSV', hint: { de: 'Für Tabellen-Programme', en: 'For spreadsheet apps' } }] },
  ],
  mountStage(stage, state, ctx) { stage.append(build(state, ctx)); },
  status(v) {
    const r = v.wtSheet;
    if (!r || !r.rows.some(x => x.res.ok || ['vacation', 'sick', 'holiday'].includes(x.kind))) return { ok: false, hint: { de: 'Trag mindestens einen Tag ein.', en: 'Enter at least one day.' } };
    return { summary: { de: `${hhmm(r.net)} Std. gearbeitet`, en: `${hhmm(r.net)} h worked` } };
  },
  async run(inputs, opts, ctx) {
    const r = opts.wtSheet, s = opts.wtSet, lang = ctx.lang;
    const dates = r.rows.map(x => x.date).filter(Boolean).sort();
    const period = dates.length ? (dates[0] === dates[dates.length - 1] ? dayLabel(dates[0], lang) : `${dmy(dates[0])} – ${dmy(dates[dates.length - 1])}`) : '';
    const who = String(s.name || '').trim();
    const base = ctx.safeFileName(`${T({ de: 'Stundenzettel', en: 'Timesheet' }, lang)}${who ? ' ' + who : ''}${dates.length ? ' ' + dates[0].slice(0, 7) : ''}`);
    if (opts.format === 'csv') {
      const q = x => (/[";\n]/.test(x) ? `"${String(x).replace(/"/g, '""')}"` : x);
      const L = lang === 'de';
      const lines = [[L ? 'Datum' : 'Date', L ? 'Tag' : 'Day', L ? 'Art' : 'Type', L ? 'Beginn' : 'Start', L ? 'Ende' : 'End', L ? 'Pause (Min.)' : 'Break (min)', L ? 'Arbeitszeit (h:mm)' : 'Working time (h:mm)', L ? 'Arbeitszeit (dezimal)' : 'Working time (decimal)', L ? 'Hinweise' : 'Notes']];
      for (const x of r.rows) {
        const ok = x.res.ok;
        lines.push([x.date, WD[lang][parse(x.date)?.getDay() ?? 0], kindLabel(x.kind, lang), ok ? hhmm(x.res.start) : '', ok ? hhmm(x.res.end % 1440) : '', ok ? String(x.res.pause) : '',
          ok ? hhmm(x.res.net) : '', ok ? dec(x.res.net, lang) : '', x.res.notes.map(n => n[lang]).join(' ')]);
      }
      lines.push([], [L ? 'Summe gearbeitet' : 'Total worked', '', '', '', '', '', hhmm(r.net), dec(r.net, lang)]);
      if (r.credited) lines.push([L ? 'Angerechnet (Urlaub, Krank, Feiertag)' : 'Credited (vacation, sick, holidays)', '', '', '', '', '', hhmm(r.credited), dec(r.credited, lang)]);
      lines.push([L ? 'Soll' : 'Target', '', '', '', '', '', hhmm(r.should), dec(r.should, lang)], [L ? 'Saldo' : 'Balance', '', '', '', '', '', hhmm(r.balance), dec(r.balance, lang)]);
      const csv = '﻿' + lines.map(l => l.map(c => q(String(c ?? ''))).join(';')).join('\r\n') + '\r\n';
      return { outputs: [{ name: `${base}.csv`, blob: new Blob([csv], { type: 'text/csv;charset=utf-8' }) }] };
    }
    const bytes = await timesheetPdf(r, s, lang, period, base);
    return { outputs: [{ name: `${base}.pdf`, blob: new Blob([bytes], { type: 'application/pdf' }) }] };
  },
};

const dmy = s => { const d = parse(s); return d ? `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}` : s; };

async function timesheetPdf(r, s, lang, period, title) {
  const { loadPdfLib, saveDoc } = await import('../lib/pdf.js');
  const { fontKit, safeText, needsUnicode } = await import('../lib/shared/office/pdftext.js');
  const PDFLib = await loadPdfLib();
  const doc = await PDFLib.PDFDocument.create();
  const fk = await fontKit(doc);
  const who = String(s.name || '').trim();
  if (needsUnicode(who)) await fk.ensureUnicode();
  const w = (de, en) => (lang === 'de' ? de : en);
  const ink = PDFLib.rgb(0.08, 0.09, 0.18), grey = PDFLib.rgb(0.42, 0.43, 0.5), line = PDFLib.rgb(0.84, 0.85, 0.9), band = PDFLib.rgb(0.95, 0.96, 0.98), warnC = PDFLib.rgb(0.62, 0.25, 0.05);
  const font = fk.sync('sans', false), bold = fk.sync('sans', true);
  const txt = (page, str, x, y, { size = 9, f = font, color = ink, right = false } = {}) => {
    const ff = needsUnicode(String(str)) ? fk.pick(String(str), 'sans', f === bold) : f;
    const t = safeText(str, ff);
    page.drawText(t, { x: right ? x - ff.widthOfTextAtSize(t, size) : x, y, size, font: ff, color });
  };
  const W = 595.28, H = 841.89, M = 42;
  // columns: day, type, start, end, break, worked, decimal, notes
  const C = [M, M + 62, M + 122, M + 168, M + 214, M + 274, M + 330, M + 350];
  const RIGHT = { 4: M + 254, 5: M + 312, 6: M + 350 };
  let page, y;
  const header = first => {
    page = doc.addPage([W, H]);
    y = H - M;
    if (first) {
      txt(page, w('Stundenzettel', 'Timesheet'), M, y - 20, { size: 20, f: bold });
      y -= 40;
      txt(page, `${w('Name', 'Name')}: ${who || '______________________________'}`, M, y, { size: 10.5 });
      txt(page, `${w('Zeitraum', 'Period')}: ${period}`, M + 280, y, { size: 10.5 });
      y -= 16;
      txt(page, `${w('Soll pro Arbeitstag', 'Target per working day')}: ${hhmm(s.target)} h · ${s.autoBreak ? w('gesetzliche Mindestpause berücksichtigt (§ 4 ArbZG)', 'legal minimum break applied (§ 4 German Working Hours Act)') : w('Pausen wie eingetragen', 'breaks as entered')}`, M, y, { size: 8.5, color: grey });
      y -= 22;
    }
    const heads = [w('Tag', 'Day'), w('Art', 'Type'), w('Beginn', 'Start'), w('Ende', 'End'), w('Pause', 'Break'), w('Arbeitszeit', 'Worked'), w('Dezimal', 'Decimal'), w('Hinweise', 'Notes')];
    page.drawRectangle({ x: M - 4, y: y - 5, width: W - 2 * M + 8, height: 18, color: band });
    heads.forEach((h, i) => (RIGHT[i] ? txt(page, h, RIGHT[i], y, { size: 8, f: bold, color: grey, right: true }) : txt(page, h, C[i] + (i === 7 ? 12 : 0), y, { size: 8, f: bold, color: grey })));
    y -= 18;
  };
  header(true);
  const rowH = 15.5;
  for (const x of r.rows) {
    if (y < M + 150) header(false);
    const ok = x.res.ok;
    txt(page, dayLabel(x.date, lang), C[0], y);
    txt(page, kindLabel(x.kind, lang), C[1], y, { color: x.kind === 'work' ? ink : grey });
    if (ok) {
      txt(page, hhmm(x.res.start).padStart(5, '0'), C[2], y);
      txt(page, hhmm(x.res.end % 1440).padStart(5, '0') + (x.res.overnight ? ' +1' : ''), C[3], y);
      txt(page, `${x.res.pause} min`, RIGHT[4], y, { right: true });
      txt(page, hhmm(x.res.net), RIGHT[5], y, { right: true, f: bold });
      txt(page, dec(x.res.net, lang), RIGHT[6], y, { right: true });
    }
    const warn = x.res.notes.find(n => n.level === 'warn');
    const note = warn || x.res.notes.find(n => /Mindestpause|minimum break/.test(n[lang]));
    if (note) {
      const short = note[lang].length > 46 ? note[lang].slice(0, 45) + '…' : note[lang];
      txt(page, short, C[7] + 12, y, { size: 7, color: warn ? warnC : grey });
    }
    page.drawLine({ start: { x: M - 4, y: y - 5 }, end: { x: W - M + 4, y: y - 5 }, thickness: 0.4, color: line });
    y -= rowH;
  }
  // totals
  y -= 8;
  const tot = (label, val, decVal, strong) => {
    txt(page, label, C[0], y, { size: 10, f: strong ? bold : font });
    txt(page, val, RIGHT[5], y, { size: 10, f: bold, right: true });
    txt(page, decVal, RIGHT[6], y, { size: 10, right: true });
    y -= 16;
  };
  tot(w('Gearbeitet', 'Worked'), hhmm(r.net), dec(r.net, lang));
  if (r.credited) tot(w('Angerechnet (Urlaub, Krank, Feiertag)', 'Credited (vacation, sick, holidays)'), hhmm(r.credited), dec(r.credited, lang));
  tot(w('Soll', 'Target'), hhmm(r.should), dec(r.should, lang));
  tot(r.balance >= 0 ? w('Überstunden', 'Overtime') : w('Minusstunden', 'Hours short'), hhmm(r.balance), dec(r.balance, lang), true);
  // signatures
  y = Math.min(y - 40, M + 70);
  for (const [i, lab] of [w('Datum, Unterschrift Mitarbeiter/in', 'Date, employee signature'), w('Datum, Unterschrift Arbeitgeber/in', 'Date, employer signature')].entries()) {
    const x0 = M + i * 270;
    page.drawLine({ start: { x: x0, y }, end: { x: x0 + 230, y }, thickness: 0.7, color: ink });
    txt(page, lab, x0, y - 12, { size: 8, color: grey });
  }
  doc.getPages().forEach((p, i, all) => txt(p, `fale.network · ${w('Seite', 'Page')} ${i + 1}/${all.length}`, W - M, 24, { size: 7.5, color: grey, right: true }));
  return saveDoc(doc, { title });
}

// ---------------------------------------------------------------- stage
function build(state, ctx) {
  const lang = ctx.lang, v = state.values;
  const w = (de, en) => T({ de, en }, lang);
  const live = liveRegion();
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEEP) || 'null'); } catch { /* private mode */ }
  const set = (v.wtSet ||= { target: 480, autoBreak: true, name: '', ...(saved?.set || {}) });
  let rows = Array.isArray(saved?.rows) && saved.rows.length ? saved.rows : weekRows(iso(today()));

  // settings
  const targetIn = el('input', { id: 'wt-target', class: 'wt-input calc-in', value: hhmm(set.target), inputmode: 'decimal', autocomplete: 'off' });
  const nameIn = el('input', { id: 'wt-name', class: 'wt-input calc-in', value: set.name, autocomplete: 'name', maxlength: '80' });
  const auto = el('input', { type: 'checkbox', id: 'wt-auto', checked: set.autoBreak });
  const keep = el('input', { type: 'checkbox', id: 'wt-keep', checked: !!saved });
  targetIn.addEventListener('input', () => { const t = parseDuration(targetIn.value.includes(':') ? targetIn.value : `${targetIn.value} h`); if (Number.isFinite(t) && t <= 1440) { set.target = t; calc(); } });
  targetIn.addEventListener('blur', () => { targetIn.value = hhmm(set.target); });
  nameIn.addEventListener('input', () => { set.name = nameIn.value; persist(); });
  auto.addEventListener('change', () => { set.autoBreak = auto.checked; calc(); });
  keep.addEventListener('change', () => { if (!keep.checked) try { localStorage.removeItem(KEEP); } catch { /* ignore */ } persist(); });

  // quick fills
  const t = today(), y = t.getFullYear(), m = t.getMonth() + 1;
  const monthName = (yy, mm) => D(yy, mm, 1).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-GB', { month: 'long', year: 'numeric' });
  const fill = (label, make) => el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm', onclick: () => {
    const filled = rows.some(r => r.start || r.end);
    rows = make();
    if (filled) live.textContent = w('Neue Tage eingesetzt.', 'New days inserted.');
    renderRows(); calc();
  } }, label);
  const prevM = m === 1 ? [y - 1, 12] : [y, m - 1];
  const quick = el('div', { class: 'calc-actions' },
    fill(w('Diese Woche', 'This week'), () => weekRows(iso(t))),
    fill(w('Letzte Woche', 'Last week'), () => weekRows(iso(addDays(t, -7)))),
    fill(monthName(y, m), () => monthRows(y, m)),
    fill(monthName(...prevM), () => monthRows(...prevM)));

  // rows
  const list = el('div', { class: 'wtm-list' });
  let refs = [];
  const fixTime = inp => { const n = parseTime(inp.value); if (Number.isFinite(n)) inp.value = hhmm(n % 1440).padStart(5, '0'); };
  function renderRows() {
    clear(list); refs = [];
    rows.forEach((r, i) => {
      const id = k => `wt-${k}-${i}`;
      const date = el('input', { type: 'date', id: id('date'), class: 'wt-input', value: r.date || '', aria: { label: w('Datum', 'Date') } });
      const kind = el('select', { id: id('kind'), class: 'wt-input', aria: { label: w('Art', 'Type') } }, KINDS.map(k => el('option', { value: k.value, selected: k.value === r.kind }, T(k, lang))));
      const ti = (k, label, ph) => el('input', { id: id(k), class: 'wt-input wtm-t', value: r[k] || '', inputmode: 'decimal', autocomplete: 'off', placeholder: ph, aria: { label } });
      const start = ti('start', w('Beginn', 'Start'), 'hh:mm'), end = ti('end', w('Ende', 'End'), 'hh:mm'), pause = ti('pause', w('Pause in Minuten', 'Break in minutes'), w('Min.', 'min'));
      const out = el('div', { class: 'wtm-out' }), notes = el('div', { class: 'wtm-notes' });
      const del = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm wtm-del', aria: { label: w(`Tag ${i + 1} entfernen`, `Remove day ${i + 1}`) }, onclick: () => { rows.splice(i, 1); renderRows(); calc(); } }, '×');
      const upd = () => { Object.assign(r, { date: date.value, kind: kind.value, start: start.value, end: end.value, pause: pause.value }); const work = kind.value === 'work'; [start, end, pause].forEach(x => { x.disabled = !work; }); calc(); };
      [date, start, end, pause].forEach(x => x.addEventListener('input', upd));
      kind.addEventListener('change', upd);
      [start, end].forEach(x => x.addEventListener('blur', () => { fixTime(x); r[x === start ? 'start' : 'end'] = x.value; }));
      [start, end, pause].forEach(x => { x.disabled = r.kind !== 'work'; });
      const lab = (txt, ctl) => el('label', { class: 'wtm-cell' }, el('span', { class: 'wtm-lab' }, txt), ctl);
      list.append(el('div', { class: 'wtm-row' },
        el('div', { class: 'wtm-head' }, lab(w('Datum', 'Date'), date), lab(w('Art', 'Type'), kind)),
        el('div', { class: 'wtm-times' }, lab(w('Beginn', 'Start'), start), lab(w('Ende', 'End'), end), lab(w('Pause (Min.)', 'Break (min)'), pause)),
        el('div', { class: 'wtm-foot' }, out, del),
        notes));
      refs.push({ out, notes });
    });
  }
  const add = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm', onclick: () => {
    const last = rows[rows.length - 1];
    let d = last ? addDays(parse(last.date) || today(), 1) : today();
    while (d.getDay() % 6 === 0) d = addDays(d, 1);
    rows.push({ date: iso(d), kind: 'work', start: last?.start || '', end: last?.end || '', pause: last?.pause || '' });
    renderRows(); calc();
    document.getElementById(`wt-start-${rows.length - 1}`)?.focus();
  } }, w('+ Tag hinzufügen', '+ Add day'));
  const clearBtn = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm', onclick: () => { rows.forEach(r => { r.start = r.end = r.pause = ''; r.kind = 'work'; }); renderRows(); calc(); } }, w('Zeiten leeren', 'Clear times'));

  // totals
  const sumBig = el('p', { class: 'calc-big', id: 'wt-total' }, '0:00');
  const sumSub = el('p', { class: 'calc-sub' });
  const bal = el('p', { class: 'calc-row-val', id: 'wt-balance' });
  const balLab = el('span', { class: 'calc-row-label' });
  const shouldV = el('p', { class: 'calc-row-val' }), credV = el('p', { class: 'calc-row-val' });
  const credRow = el('div', { class: 'calc-row' }, el('span', { class: 'calc-row-label' }, w('Angerechnet (Urlaub, Krank, Feiertag)', 'Credited (vacation, sick, holidays)')), credV);
  const totals = el('div', { class: 'calc-out', aria: { live: 'polite' } },
    el('p', { class: 'calc-sub' }, w('Gearbeitet', 'Worked')), sumBig, sumSub,
    credRow,
    el('div', { class: 'calc-row' }, el('span', { class: 'calc-row-label' }, w('Soll', 'Target')), shouldV),
    el('div', { class: 'calc-row is-main' }, balLab, bal),
    el('div', { class: 'calc-actions' }, copyBtn(() => dec(v.wtSheet?.net || 0, lang), w('Dezimalstunden kopieren', 'Copy decimal hours'), live)));

  function persist() {
    if (!keep.checked) return;
    try { localStorage.setItem(KEEP, JSON.stringify({ set, rows })); } catch { /* full / private */ }
  }
  function calc() {
    const r = sheetCalc(rows, { target: set.target, autoBreak: set.autoBreak });
    v.wtSheet = r;
    r.rows.forEach((x, i) => {
      const ref = refs[i];
      if (!ref) return;
      clear(ref.out); clear(ref.notes);
      if (x.res.ok) ref.out.append(el('b', {}, hhmm(x.res.net)), el('span', {}, `${dec(x.res.net, lang)} h`));
      else if (x.kind !== 'work') ref.out.append(el('span', {}, x.kind === 'off' ? '–' : w('Soll erfüllt', 'counts as target')));
      for (const n of x.res.notes) ref.notes.append(el('p', { class: 'wtm-note' + (n.level === 'warn' ? ' is-warn' : '') }, n[lang]));
    });
    sumBig.textContent = hhmm(r.net);
    sumSub.textContent = w(`${fmt(decimal(r.net), { min: 2, max: 2, lang })} Stunden dezimal · ${r.days} ${r.days === 1 ? 'Arbeitstag' : 'Arbeitstage'}${r.days ? ` · Ø ${hhmm(r.net / r.days)} pro Tag` : ''}`,
      `${fmt(decimal(r.net), { min: 2, max: 2, lang })} decimal hours · ${r.days} working ${r.days === 1 ? 'day' : 'days'}${r.days ? ` · avg ${hhmm(r.net / r.days)} a day` : ''}`);
    credRow.hidden = !r.credited; credV.textContent = hhmm(r.credited);
    shouldV.textContent = hhmm(r.should);
    balLab.textContent = r.balance >= 0 ? w('Überstunden', 'Overtime') : w('Minusstunden', 'Hours short');
    bal.textContent = (r.balance > 0 ? '+' : '') + hhmm(r.balance);
    persist();
    state.results.clear(); ctx.refresh();
  }

  // converter h:mm ⇄ decimal
  const cH = el('input', { id: 'wt-conv-h', class: 'wt-input calc-in', value: '7:45', inputmode: 'decimal', autocomplete: 'off', aria: { label: w('Stunden und Minuten', 'Hours and minutes') } });
  const cD = el('input', { id: 'wt-conv-d', class: 'wt-input calc-in', value: fmt(7.75, { min: 2, max: 2, lang }), inputmode: 'decimal', autocomplete: 'off', aria: { label: w('Dezimalstunden', 'Decimal hours') } });
  cH.addEventListener('input', () => { const n = parseDuration(cH.value.includes(':') ? cH.value : `${cH.value.replace(',', '.')} h`); cD.value = Number.isFinite(n) ? fmt(n / 60, { min: 2, max: 2, lang }) : ''; });
  cD.addEventListener('input', () => { const x = parseFloat(cD.value.replace(',', '.')); cH.value = Number.isFinite(x) ? hhmm(x * 60) : ''; });

  renderRows();
  calc();
  return el('section', { class: 'img-box calc', aria: { labelledby: 'wt-h' } },
    el('h2', { class: 'img-h', id: 'wt-h' }, w('Arbeitszeit berechnen', 'Calculate working time')),
    el('p', { class: 'calc-hint' }, w('Uhrzeiten wie 7:30, 730 oder 7,30 eintippen. Endet die Schicht nach Mitternacht, wird automatisch über Mitternacht gerechnet.', 'Type times like 7:30, 730 or 7.30. If a shift ends after midnight, it is counted across midnight automatically.')),
    quick, list, el('div', { class: 'calc-actions' }, add, clearBtn),
    el('div', { class: 'calc-grid calc-grid-2' },
      el('div', { class: 'calc-field' }, el('label', { class: 'calc-label', for: 'wt-target' }, w('Soll pro Arbeitstag (h:mm)', 'Target per working day (h:mm)')), targetIn),
      el('div', { class: 'calc-field' }, el('label', { class: 'calc-label', for: 'wt-name' }, w('Name auf dem Stundenzettel (optional)', 'Name on the timesheet (optional)')), nameIn)),
    el('label', { class: 'calc-check', for: 'wt-auto' }, auto, el('span', {}, w('Gesetzliche Mindestpause abziehen, wenn weniger eingetragen ist', 'Deduct the legal minimum break if less is entered'))),
    el('p', { class: 'calc-hint' }, w('Arbeitszeitgesetz § 4: Mehr als 6 Stunden Arbeit → 30 Minuten Pause, mehr als 9 Stunden → 45 Minuten. Bei 6:20 Std. Anwesenheit reichen 20 Minuten – dann bleiben genau 6 Stunden Arbeit.', 'German Working Hours Act § 4: more than 6 hours of work → 30 minutes break, more than 9 hours → 45 minutes. With 6:20 h at work, 20 minutes are enough – that leaves exactly 6 hours of work.')),
    totals,
    el('section', { class: 'calc-card', aria: { labelledby: 'wt-conv-hd' } }, el('h3', { id: 'wt-conv-hd' }, w('Stunden umrechnen: h:mm ⇄ dezimal', 'Convert hours: h:mm ⇄ decimal')),
      el('div', { class: 'calc-sentence' }, cH, '=', cD, w('Stunden', 'hours')),
      el('p', { class: 'calc-hint' }, w('Für die Lohnabrechnung zählen Dezimalstunden („Industrieminuten“): 45 Minuten sind 0,75 Stunden, nicht 0,45.', 'Payroll uses decimal hours: 45 minutes are 0.75 hours, not 0.45.'))),
    el('label', { class: 'calc-check', for: 'wt-keep' }, keep, el('span', {}, w('Einträge auf diesem Gerät merken', 'Remember the entries on this device'))),
    el('p', { class: 'calc-hint' }, w('Ohne Haken bleibt nichts gespeichert – beim Schließen der Seite sind die Zeiten weg. Mit Haken liegen sie nur in diesem Browser.', 'Without the tick nothing is kept – the times are gone when you close the page. With it they stay only in this browser.')),
    live);
}
