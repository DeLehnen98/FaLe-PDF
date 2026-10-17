// Date maths for working-days, date-difference and calendar-week. Dates are local noon (no DST traps), ISO
// strings "YYYY-MM-DD" in and out. Public holidays come from lib/tpl-holidays.js (state-wide), plus the local
// ones people ask for as options (Augsburg peace festival, Corpus Christi in parts of Saxony/Thuringia).
import { holidays } from './tpl-holidays.js';

const pad = n => String(n).padStart(2, '0');
export const D = (y, m, d) => new Date(y, m - 1, d, 12);
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); if (!m) return null; const d = D(+m[1], +m[2], +m[3]); return d.getMonth() + 1 === +m[2] ? d : null; };
export const addDays = (d, n) => D(d.getFullYear(), d.getMonth() + 1, d.getDate() + n);
export const today = () => { const t = new Date(); return D(t.getFullYear(), t.getMonth() + 1, t.getDate()); };
const DAY = 86400000;
export const daysBetween = (a, b) => Math.round((b - a) / DAY);

/** Add months, clamped to the end of the month (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(d, n) {
  const y = d.getFullYear(), m = d.getMonth() + n;
  const last = new Date(y, m + 1, 0, 12).getDate();
  return new Date(y, m, Math.min(d.getDate(), last), 12);
}

/** Calendar difference a → b as { years, months, days } (b ≥ a). */
export function ymd(a, b) {
  let years = b.getFullYear() - a.getFullYear(), months = b.getMonth() - a.getMonth(), days = b.getDate() - a.getDate();
  if (days < 0) { months--; days += new Date(b.getFullYear(), b.getMonth(), 0).getDate(); }
  if (months < 0) { years--; months += 12; }
  return { years, months, days };
}

/** ISO 8601 week: { week, year } (weeks start on Monday; week 1 contains the first Thursday). */
export function isoWeek(d) {
  const t = D(d.getFullYear(), d.getMonth() + 1, d.getDate());
  const day = (t.getDay() + 6) % 7;   // Monday = 0
  const thu = addDays(t, 3 - day);
  const y = thu.getFullYear();
  const jan4 = D(y, 1, 4);
  const week = 1 + Math.round((thu - addDays(jan4, 3 - ((jan4.getDay() + 6) % 7))) / (7 * DAY));
  return { week, year: y };
}
/** Monday and Sunday of ISO week w in ISO year y. */
export function weekRange(y, w) {
  const jan4 = D(y, 1, 4);
  const mon = addDays(jan4, -((jan4.getDay() + 6) % 7) + (w - 1) * 7);
  return { from: mon, to: addDays(mon, 6) };
}
export const weeksInYear = y => isoWeek(D(y, 12, 28)).week;

/** Holidays of a year for a state, with the optional local ones. → Map iso → { de, en } */
export function holidayMap(year, state, { augsburg = false, localCorpus = false } = {}) {
  const map = new Map(holidays(year, state).map(h => [h.date, h]));
  if (augsburg && state === 'BY') map.set(`${year}-08-08`, { date: `${year}-08-08`, de: 'Augsburger Hohes Friedensfest', en: 'Augsburg Peace Festival' });
  if (localCorpus && (state === 'SN' || state === 'TH')) {
    const fr = holidays(year, 'BW').find(h => h.de === 'Fronleichnam');
    if (fr) map.set(fr.date, fr);
  }
  return map;
}

/**
 * Working days from..to inclusive. opts: state, saturday (Mon–Sat), halfDays (24. + 31.12. count ½),
 * augsburg, localCorpus, vacation (days to subtract). → { work, calendar, weekend, holidays: [...], half, weeks } or null.
 */
export function workdays(from, to, opts = {}) {
  const a = parse(from), b = parse(to);
  if (!a || !b || b < a) return null;
  const total = daysBetween(a, b) + 1;
  if (total > 366 * 30) return null;
  let work = 0, weekend = 0;
  const hit = [], half = [];
  const maps = new Map();
  for (let i = 0; i < total; i++) {
    const d = addDays(a, i);
    const wd = d.getDay();
    const isWork = opts.saturday ? wd !== 0 : wd !== 0 && wd !== 6;
    if (!isWork) { weekend++; continue; }
    const y = d.getFullYear();
    if (!maps.has(y)) maps.set(y, holidayMap(y, opts.state || 'SL', opts));
    const h = maps.get(y).get(iso(d));
    if (h) { hit.push({ ...h, date: iso(d) }); continue; }
    const md = iso(d).slice(5);
    if (opts.halfDays && (md === '12-24' || md === '12-31')) { work += 0.5; half.push(iso(d)); continue; }
    work++;
  }
  const vac = Math.max(0, Math.min(work, +opts.vacation || 0));
  return { work: work - vac, beforeVacation: work, vacation: vac, calendar: total, weekend, holidays: hit, half, weeks: total / 7 };
}

/** Add n working days to a date (n may be negative); the start day itself is not counted. */
export function addWorkdays(start, n, opts = {}) {
  const a = parse(start);
  if (!a || !Number.isFinite(n)) return null;
  const step = n < 0 ? -1 : 1;
  let d = a, left = Math.abs(Math.trunc(n)), guard = 0;
  const maps = new Map();
  while (left > 0 && guard++ < 40000) {
    d = addDays(d, step);
    const wd = d.getDay();
    if (opts.saturday ? wd === 0 : wd === 0 || wd === 6) continue;
    const y = d.getFullYear();
    if (!maps.has(y)) maps.set(y, holidayMap(y, opts.state || 'SL', opts));
    if (maps.get(y).has(iso(d))) continue;
    left--;
  }
  return d;
}

const LOC = { de: 'de-DE', en: 'en-GB' };
export const longDate = (d, lang) => d.toLocaleDateString(LOC[lang], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
export const shortDate = (d, lang) => d.toLocaleDateString(LOC[lang], { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
