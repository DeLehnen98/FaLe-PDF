// Tool: calendar week (Kalenderwoche). Today's ISO week big, any date → week, week + year → Monday–Sunday,
// and the overview of a year with the current week marked. Primary: the year's weeks as a printable PDF.
import { el, clear } from '../lib/dom.js';
import { T, calcCss, parseNum, copyBtn, liveRegion, warn } from '../lib/calc-core.js';
import { iso, parse, today, isoWeek, weekRange, weeksInYear, longDate } from '../lib/date-calc.js';

calcCss();
const LOC = { de: 'de-DE', en: 'en-GB' };
const dm = (d, lang) => d.toLocaleDateString(LOC[lang], { day: '2-digit', month: '2-digit', year: 'numeric' });

export default {
  labels: { back_to_files: { de: 'Zurück zur Kalenderwoche', en: 'Back to the calendar week' } },
  mountStage(stage, state, ctx) { stage.append(build(state, ctx)); },
  status(v) { return { summary: { de: `Kalenderwochen ${v.kwYear} als PDF`, en: `Calendar weeks ${v.kwYear} as PDF` } }; },
  async run(inputs, opts, ctx) {
    const lang = ctx.lang, y = opts.kwYear;
    const { loadPdfLib, saveDoc } = await import('../lib/pdf.js');
    const PDFLib = await loadPdfLib();
    const doc = await PDFLib.PDFDocument.create();
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica), bold = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
    const n = weeksInYear(y);
    const page = doc.addPage([595.28, 841.89]);
    const ink = PDFLib.rgb(0.1, 0.1, 0.18), grey = PDFLib.rgb(0.45, 0.45, 0.5), line = PDFLib.rgb(0.86, 0.86, 0.9), band = PDFLib.rgb(0.95, 0.95, 0.98);
    // Helvetica (WinAnsi) has all German letters; keep the text plain
    page.drawText(lang === 'de' ? `Kalenderwochen ${y}` : `Calendar weeks ${y}`, { x: 48, y: 790, size: 22, font: bold, color: ink });
    page.drawText(lang === 'de' ? `ISO 8601 · Montag bis Sonntag · ${n} Wochen` : `ISO 8601 · Monday to Sunday · ${n} weeks`, { x: 48, y: 770, size: 10, font, color: grey });
    const colW = 250, rowH = (760 - 60) / Math.ceil(n / 2);
    for (let wk = 1; wk <= n; wk++) {
      const col = wk <= Math.ceil(n / 2) ? 0 : 1, row = col ? wk - Math.ceil(n / 2) - 1 : wk - 1;
      const x = 48 + col * (colW + 10), yy = 750 - (row + 1) * rowH;
      if (row % 2 === 0) page.drawRectangle({ x: x - 4, y: yy - 3, width: colW, height: rowH, color: band });
      const { from, to } = weekRange(y, wk);
      page.drawText(`${lang === 'de' ? 'KW' : 'Wk'} ${String(wk).padStart(2, '0')}`, { x, y: yy + rowH * 0.3, size: 10, font: bold, color: ink });
      page.drawText(`${dm(from, lang)} – ${dm(to, lang)}`, { x: x + 48, y: yy + rowH * 0.3, size: 10, font, color: ink });
    }
    page.drawLine({ start: { x: 48, y: 42 }, end: { x: 547, y: 42 }, thickness: 0.5, color: line });
    page.drawText('fale.network', { x: 48, y: 30, size: 8, font, color: grey });
    const bytes = await saveDoc(doc, { title: lang === 'de' ? `Kalenderwochen ${y}` : `Calendar weeks ${y}` });
    return { outputs: [{ name: lang === 'de' ? `Kalenderwochen ${y}.pdf` : `Calendar weeks ${y}.pdf`, blob: new Blob([bytes], { type: 'application/pdf' }) }] };
  },
};

function build(state, ctx) {
  const lang = ctx.lang, v = state.values;
  const w = (de, en) => T({ de, en }, lang);
  const live = liveRegion();
  const t = today(), now = isoWeek(t);
  const range = weekRange(now.year, now.week);
  const hero = el('div', { class: 'calc-out' },
    el('p', { class: 'calc-sub' }, w('Heute ist', 'Today is')),
    el('p', { class: 'calc-big' }, `${w('KW', 'Week')} ${now.week}`),
    el('p', { class: 'calc-sub' }, `${longDate(t, lang)} · ${w('Woche vom', 'week from')} ${dm(range.from, lang)} ${w('bis', 'to')} ${dm(range.to, lang)}`),
    el('div', { class: 'calc-actions' }, copyBtn(() => String(now.week), w('Kalenderwoche kopieren', 'Copy calendar week'), live)));
  // date → week
  const dIn = el('input', { type: 'date', id: 'kw-date', class: 'wt-input calc-in', value: iso(t) });
  const dOut = el('p', { class: 'calc-big calc-big-s' });
  dIn.addEventListener('input', () => {
    const d = parse(dIn.value);
    if (!d) { dOut.textContent = '–'; return; }
    const k = isoWeek(d);
    dOut.textContent = `${w('KW', 'Week')} ${k.week}${k.year !== d.getFullYear() ? ` ${w('des Jahres', 'of')} ${k.year}` : ''}`;
  });
  dIn.dispatchEvent(new Event('input'));
  // week → range
  const wIn = el('input', { id: 'kw-week', class: 'wt-input calc-in', inputmode: 'numeric', value: String(now.week), aria: { label: w('Kalenderwoche', 'Calendar week') } });
  const yIn = el('input', { id: 'kw-year', class: 'wt-input calc-in', inputmode: 'numeric', value: String(now.year), aria: { label: w('Jahr', 'Year') } });
  const wOut = el('p', { class: 'calc-big calc-big-s' });
  const wErr = el('div');
  const weekToRange = () => {
    clear(wErr);
    const k = parseNum(wIn.value, lang), y = parseNum(yIn.value, lang);
    if (!Number.isInteger(k) || !Number.isInteger(y) || y < 1900 || y > 2200) { wOut.textContent = '–'; return; }
    if (k < 1 || k > weeksInYear(y)) { wOut.textContent = '–'; wErr.append(warn(w(`${y} hat ${weeksInYear(y)} Kalenderwochen.`, `${y} has ${weeksInYear(y)} calendar weeks.`))); return; }
    const r = weekRange(y, k);
    wOut.textContent = `${dm(r.from, lang)} – ${dm(r.to, lang)}`;
  };
  [wIn, yIn].forEach(i => i.addEventListener('input', weekToRange));
  weekToRange();
  // year overview
  const year = el('input', { id: 'kw-ylist', class: 'wt-input calc-in', inputmode: 'numeric', value: String(now.year) });
  const tbody = el('tbody');
  const table = el('div', { class: 'calc-table-wrap' }, el('table', { class: 'calc-table' },
    el('thead', {}, el('tr', {}, el('th', {}, w('KW', 'Week')), el('th', {}, w('Montag', 'Monday')), el('th', {}, w('Sonntag', 'Sunday')))), tbody));
  const list = () => {
    const y = parseNum(year.value, lang);
    clear(tbody);
    if (!Number.isInteger(y) || y < 1900 || y > 2200) return;
    v.kwYear = y;
    for (let k = 1; k <= weeksInYear(y); k++) {
      const r = weekRange(y, k);
      tbody.append(el('tr', { class: y === now.year && k === now.week ? 'is-current' : '' }, el('td', {}, String(k)), el('td', {}, dm(r.from, lang)), el('td', {}, dm(r.to, lang))));
    }
    state.results.clear(); ctx.refresh();
  };
  year.addEventListener('input', list);
  v.kwYear = now.year;
  list();
  return el('div', { class: 'calc' },
    el('section', { class: 'img-box calc', aria: { labelledby: 'kw-h' } }, el('h2', { class: 'img-h', id: 'kw-h' }, w('Aktuelle Kalenderwoche', 'Current calendar week')), hero, live),
    el('section', { class: 'img-box calc', aria: { labelledby: 'kw-h2' } }, el('h2', { class: 'img-h', id: 'kw-h2' }, w('Kalenderwoche für ein Datum', 'Calendar week of a date')),
      el('div', { class: 'calc-field' }, el('label', { class: 'calc-label', for: 'kw-date' }, w('Datum', 'Date')), dIn), el('div', { class: 'calc-out' }, dOut)),
    el('section', { class: 'img-box calc', aria: { labelledby: 'kw-h3' } }, el('h2', { class: 'img-h', id: 'kw-h3' }, w('Zeitraum einer Kalenderwoche', 'Dates of a calendar week')),
      el('div', { class: 'calc-sentence' }, w('KW', 'Week'), wIn, w('im Jahr', 'in'), yIn), wErr, el('div', { class: 'calc-out' }, wOut)),
    el('section', { class: 'img-box calc', aria: { labelledby: 'kw-h4' } }, el('h2', { class: 'img-h', id: 'kw-h4' }, w('Alle Kalenderwochen eines Jahres', 'All calendar weeks of a year')),
      el('div', { class: 'calc-sentence' }, el('label', { for: 'kw-ylist' }, w('Jahr', 'Year')), year), table));
}
