// Unit tests for the travel expense maths (lib/travel.js).  node tests/suites/webtools/travel_unit.mjs
const t = await import('../../../network/assets/wt/lib/travel.js');
let ok = 0, fail = 0;
const expect = (c, m) => { if (c) ok++; else { fail++; console.log('FAIL', m); } };
let d = t.mealDays('2026-03-02T07:30', '2026-03-02T15:00');
expect(d.length === 1 && d[0].rate === 0, '7.5 h → nothing');
d = t.mealDays('2026-03-02T07:00', '2026-03-02T15:30');
expect(d[0].rate === 1400 && d[0].kind === 'single', '8.5 h → 14 €');
d = t.mealDays('2026-03-02T08:00', '2026-03-05T18:00');
expect(d.length === 4 && d.map(x => x.rate).join() === '1400,2800,2800,1400' && d[0].kind === 'arrival' && d[3].kind === 'departure', `3 nights ${d.map(x => x.rate)}`);
d = t.mealDays('2026-03-02T17:00', '2026-03-03T03:00', { overnight: false });
expect(d.length === 1 && d[0].rate === 1400 && d[0].date === '2026-03-02', `night drive across midnight → one day, more hours on the 2nd (${JSON.stringify(d)})`);
d = t.mealDays('2026-03-02T22:00', '2026-03-03T07:00', { overnight: false });
expect(d[0].date === '2026-03-03' && d[0].rate === 1400, 'more hours on the 3rd');
d = t.mealDays('2026-03-02T22:00', '2026-03-03T05:00', { overnight: false });
expect(d[0].rate === 0, '7 h across midnight → nothing');
expect(t.mealDays('2026-03-02T10:00', '2026-03-02T09:00').length === 0 && t.mealDays('', '').length === 0, 'invalid');
// meals
const full = { rate: 2800 }, part = { rate: 1400 };
expect(t.dayAllowance(full, { breakfast: true }) === 2240, 'full day − breakfast = 22,40');
expect(t.dayAllowance(part, { breakfast: true }) === 840, 'arrival day − breakfast = 8,40');
expect(t.dayAllowance(part, { lunch: true, dinner: true }) === 0, 'never below 0');
expect(t.dayAllowance(full, { breakfast: true, lunch: true, dinner: true }) === 0, 'all meals → 0');
// mileage
expect(t.mileage(245, 'car') === 7350 && t.mileage('245,5', 'moto') === 4910 && t.mileage(100, 'custom', '0,35') === 3500, 'mileage');
// statement
const s = t.statement({
  trip: { start: '2026-03-02T08:00', end: '2026-03-04T18:00' },
  meals: { '2026-03-03': { breakfast: true }, '2026-03-04': { breakfast: true } },
  drives: [{ km: 300, vehicle: 'car' }, { km: '12,5', vehicle: 'car' }],
  receipts: [{ kind: 'hotel', amount: '238,00', breakfasts: 2 }, { kind: 'other', amount: '18,50' }, { kind: 'travel', amount: 0 }],
  nights: 0, advance: '100',
});
expect(s.meal === 1400 + 2240 + 840, `meals ${s.meal}`);
expect(s.drive === 9375, `drive ${s.drive}`);
expect(s.hotel === 23800 - 1120 && s.breakfastCut === 1120, `hotel minus breakfast ${s.hotel}`);
expect(s.total === s.meal + s.drive + s.hotel + 1850 && s.payout === s.total - 10000, `total ${s.total} payout ${s.payout}`);
expect(t.statement({ trip: {}, nights: 2 }).flatNights === 4000, 'flat nights');
console.log(`travel: ${ok} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
