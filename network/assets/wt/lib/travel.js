// Travel expense maths for Germany (Reisekostenabrechnung), pure and unit-tested (travel_unit.mjs).
// Rates for domestic business trips (§ 9 Abs. 4a EStG, § 9 Abs. 1 Nr. 4a EStG), valid 2026:
//   meals: more than 8 h away on a single day 14 €, arrival and departure day of a trip with overnight stay
//   14 € each, every full day in between 28 €; provided meals reduce the day by 20 % (breakfast, 5,60 €) and
//   40 % (lunch, dinner, 11,20 € each) of the full-day rate, never below 0.
//   mileage with an own vehicle: car 0,30 €/km, other motor vehicles (motorbike, scooter, moped) 0,20 €/km.
//   overnight flat rate the employer may reimburse tax-free: 20 € per night.
export const RATES = { year: 2026, partial: 1400, full: 2800, breakfast: 560, lunch: 1120, dinner: 1120, car: 30, moto: 20, night: 2000 };

const pad = n => String(n).padStart(2, '0');
const isoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** "2026-03-02T07:30" → Date (local) or null. */
export function parseDT(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s || '');
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return Number.isNaN(+d) ? null : d;
}

/**
 * Days of a trip with their meal allowance. overnight: the trip includes an overnight stay away (default
 * when it spans several calendar days); without it, a trip across midnight counts as one day with the
 * total hours, booked on the day with the most hours.
 * → [{ date, hours, kind: 'single'|'arrival'|'full'|'departure', rate }] (rate in cents)
 */
export function mealDays(start, end, { overnight = true } = {}) {
  const a = parseDT(start), b = parseDT(end);
  if (!a || !b || b <= a) return [];
  const hours = (b - a) / 3600000;
  const sameDay = isoDay(a) === isoDay(b);
  if (sameDay || !overnight) {
    if (!sameDay) {
      // across midnight without a night away: one day, with the hours of both days
      const mid = new Date(b.getFullYear(), b.getMonth(), b.getDate());
      const h1 = (mid - a) / 3600000, h2 = (b - mid) / 3600000;
      return [{ date: isoDay(h1 >= h2 ? a : b), hours, kind: 'single', rate: hours > 8 ? RATES.partial : 0 }];
    }
    return [{ date: isoDay(a), hours, kind: 'single', rate: hours > 8 ? RATES.partial : 0 }];
  }
  const out = [];
  for (let d = new Date(a.getFullYear(), a.getMonth(), a.getDate()); d <= b; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const day = isoDay(d);
    const first = day === isoDay(a), last = day === isoDay(b);
    const dayStart = first ? a : d, dayEnd = last ? b : new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    out.push({ date: day, hours: (dayEnd - dayStart) / 3600000, kind: first ? 'arrival' : last ? 'departure' : 'full', rate: first || last ? RATES.partial : RATES.full });
  }
  return out;
}

/** Allowance of one day after provided meals (flags: { breakfast, lunch, dinner }). */
export function dayAllowance(day, meals = {}) {
  const cut = (meals.breakfast ? RATES.breakfast : 0) + (meals.lunch ? RATES.lunch : 0) + (meals.dinner ? RATES.dinner : 0);
  return Math.max(0, day.rate - cut);
}

const num = x => { const n = typeof x === 'number' ? x : parseFloat(String(x ?? '').trim().replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };
export const toCents = x => Math.round(num(x) * 100);

/** Mileage in cents: km × rate (car/moto); a custom rate per km in € if given. */
export function mileage(km, vehicle = 'car', custom = '') {
  const rate = vehicle === 'custom' ? Math.round(num(custom) * 100) : vehicle === 'moto' ? RATES.moto : RATES.car;
  return Math.round(num(km) * rate);
}

/**
 * Whole statement. trip: { start, end, overnight }, meals: { [date]: {breakfast, lunch, dinner} },
 * drives: [{ km, vehicle, rate }], receipts: [{ kind: 'travel'|'hotel'|'other', amount, breakfasts }],
 * nights: flat-rate nights (no hotel receipt), advance: amount already paid.
 * → { days: [{…, meals, allowance}], meal, drive, travel, hotel, other, flatNights, total, advance, payout }
 */
export function statement({ trip = {}, meals = {}, drives = [], receipts = [], nights = 0, advance = 0 }) {
  const days = mealDays(trip.start, trip.end, { overnight: trip.overnight !== false }).map(d => ({ ...d, meals: meals[d.date] || {}, allowance: dayAllowance(d, meals[d.date] || {}) }));
  const meal = days.reduce((a, d) => a + d.allowance, 0);
  const drive = drives.reduce((a, d) => a + mileage(d.km, d.vehicle, d.rate), 0);
  const sum = kind => receipts.filter(r => r.kind === kind).reduce((a, r) => a + toCents(r.amount), 0);
  // hotel bills that include breakfast: 5,60 € per breakfast are taken off (the meal allowance covers food)
  const breakfastCut = receipts.filter(r => r.kind === 'hotel').reduce((a, r) => a + Math.round(num(r.breakfasts)) * RATES.breakfast, 0);
  const hotel = Math.max(0, sum('hotel') - breakfastCut);
  const flatNights = Math.max(0, Math.round(num(nights))) * RATES.night;
  const travel = sum('travel'), other = sum('other');
  const total = meal + drive + travel + hotel + flatNights + other;
  const adv = toCents(advance);
  return { days, meal, drive, travel, hotel, breakfastCut, flatNights, other, total, advance: adv, payout: total - adv };
}
