// German public holidays per federal state (incl. the Easter-based ones) and working-day counting for the
// leave request. Pure functions, unit-tested for 2025–2030 (scratchpad tpl_units.mjs).
// Only state-wide holidays are counted; purely local ones (Augsburger Friedensfest, Fronleichnam in some
// Saxon/Thuringian communities, Mariä Himmelfahrt only in Catholic communities of Bavaria) are named in NOTES.

export const STATES = {
  BW: 'Baden-Württemberg', BY: 'Bayern', BE: 'Berlin', BB: 'Brandenburg', HB: 'Bremen', HH: 'Hamburg', HE: 'Hessen',
  MV: 'Mecklenburg-Vorpommern', NI: 'Niedersachsen', NW: 'Nordrhein-Westfalen', RP: 'Rheinland-Pfalz', SL: 'Saarland',
  SN: 'Sachsen', ST: 'Sachsen-Anhalt', SH: 'Schleswig-Holstein', TH: 'Thüringen',
};
export const NOTES = {
  BY: 'Mariä Himmelfahrt (15.8.) ist in Bayern nur in Gemeinden mit überwiegend katholischer Bevölkerung Feiertag – hier mitgezählt. Das Augsburger Friedensfest (8.8.) gilt nur in Augsburg und ist nicht berücksichtigt.',
  SN: 'Fronleichnam ist in einigen Gemeinden Sachsens Feiertag – nicht berücksichtigt.',
  TH: 'Fronleichnam ist in einigen Gemeinden Thüringens Feiertag – nicht berücksichtigt.',
};

const pad = n => String(n).padStart(2, '0');
export const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const D = (y, m, d) => new Date(y, m - 1, d, 12);

/** Easter Sunday (Gregorian calendar, anonymous algorithm). */
export function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return D(y, month, day);
}
const plus = (date, days) => D(date.getFullYear(), date.getMonth() + 1, date.getDate() + days);

const ALL = Object.keys(STATES);
/**
 * Holidays of one year for one state: [{date: 'YYYY-MM-DD', de, en}], sorted.
 * Sunday-only holidays (Ostersonntag, Pfingstsonntag in BB/HE) are included for completeness.
 */
export function holidays(year, state = 'SL') {
  const e = easter(year);
  const list = [];
  const add = (date, de, en, states = ALL, from = 0, to = 9999) => {
    if (states.includes(state) && year >= from && year <= to) list.push({ date: iso(date), de, en });
  };
  add(D(year, 1, 1), 'Neujahr', 'New Year’s Day');
  add(D(year, 1, 6), 'Heilige Drei Könige', 'Epiphany', ['BW', 'BY', 'ST']);
  add(D(year, 3, 8), 'Internationaler Frauentag', 'International Women’s Day', ['BE'], 2019);
  add(D(year, 3, 8), 'Internationaler Frauentag', 'International Women’s Day', ['MV'], 2023);
  add(plus(e, -2), 'Karfreitag', 'Good Friday');
  add(e, 'Ostersonntag', 'Easter Sunday', ['BB', 'HE']);
  add(plus(e, 1), 'Ostermontag', 'Easter Monday');
  add(D(year, 5, 1), 'Tag der Arbeit', 'Labour Day');
  if (year === 2025) add(D(2025, 5, 8), '80. Jahrestag der Befreiung', '80th anniversary of liberation', ['BE']);
  add(plus(e, 39), 'Christi Himmelfahrt', 'Ascension Day');
  add(plus(e, 49), 'Pfingstsonntag', 'Whit Sunday', ['BB', 'HE']);
  add(plus(e, 50), 'Pfingstmontag', 'Whit Monday');
  add(plus(e, 60), 'Fronleichnam', 'Corpus Christi', ['BW', 'BY', 'HE', 'NW', 'RP', 'SL']);
  add(D(year, 8, 15), 'Mariä Himmelfahrt', 'Assumption Day', ['SL', 'BY']);
  add(D(year, 9, 20), 'Weltkindertag', 'World Children’s Day', ['TH'], 2019);
  add(D(year, 10, 3), 'Tag der Deutschen Einheit', 'German Unity Day');
  add(D(year, 10, 31), 'Reformationstag', 'Reformation Day', ['BB', 'MV', 'SN', 'ST', 'TH']);
  add(D(year, 10, 31), 'Reformationstag', 'Reformation Day', ['HB', 'HH', 'NI', 'SH'], 2018);
  if (year === 2017) add(D(2017, 10, 31), 'Reformationstag', 'Reformation Day', ['BW', 'BY', 'BE', 'HB', 'HH', 'HE', 'NI', 'NW', 'RP', 'SL', 'SH']);
  add(D(year, 11, 1), 'Allerheiligen', 'All Saints’ Day', ['BW', 'BY', 'NW', 'RP', 'SL']);
  // Buß- und Bettag: the Wednesday before 23 November
  const nov22 = D(year, 11, 22);
  add(plus(nov22, -((nov22.getDay() + 4) % 7)), 'Buß- und Bettag', 'Day of Repentance and Prayer', ['SN']);
  add(D(year, 12, 25), '1. Weihnachtstag', 'Christmas Day');
  add(D(year, 12, 26), '2. Weihnachtstag', 'St Stephen’s Day');
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

const cache = new Map();
function holidayMap(year, state) {
  const k = year + state;
  if (!cache.has(k)) cache.set(k, new Map(holidays(year, state).map(h => [h.date, h])));
  return cache.get(k);
}
export const parseIso = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? D(+m[1], +m[2], +m[3]) : null; };

/**
 * Working days from `from` to `to` (inclusive, ISO dates).
 * opts: state, days: 5 (Mon–Fri) or 6 (Mon–Sat, "Werktage"), halfDays: 24.12. and 31.12. count as ½.
 * → { days, calendar, weekend, holidays: [{date, de, en}], half: [...] } or null for invalid input.
 */
export function workingDays(from, to, { state = 'SL', days = 5, halfDays = false } = {}) {
  const a = parseIso(from), b = parseIso(to);
  if (!a || !b || b < a) return null;
  let n = 0, cal = 0, weekend = 0;
  const hit = [], half = [];
  for (let d = a; d <= b; d = plus(d, 1)) {
    cal++;
    if (cal > 3700) return null; // ~10 years: nonsense input
    const wd = d.getDay();
    const isWork = days === 6 ? wd !== 0 : wd !== 0 && wd !== 6;
    if (!isWork) { weekend++; continue; }
    const h = holidayMap(d.getFullYear(), state).get(iso(d));
    if (h) { hit.push(h); continue; }
    const md = iso(d).slice(5);
    if (halfDays && (md === '12-24' || md === '12-31')) { n += 0.5; half.push(iso(d)); continue; }
    n++;
  }
  return { days: n, calendar: cal, weekend, holidays: hit, half };
}
