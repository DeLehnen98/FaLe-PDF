// Unit tests of the Vorlagen pack: number-to-words (de/en), German holidays 2025–2030 + working days, late interest.
import { amountWordsDe, amountWordsEn, numberWordsDe, numberWordsEn } from '/home/claude/FalePDF/network/assets/wt/lib/tpl-words.js';
import { holidays, easter, workingDays, iso } from '/home/claude/FalePDF/network/assets/wt/lib/tpl-holidays.js';
import { daysLate, interestCents, lateRate, reminderTotals } from '/home/claude/FalePDF/network/assets/wt/lib/tpl-interest.js';

let fail = 0, n = 0;
const eq = (a, b, msg) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) { fail++; console.log(`FAIL ${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); } };

// ---- German words
const W = {
  1: 'null Euro und ein Cent', 2: 'null Euro und zwei Cent', 99: 'null Euro und neunundneunzig Cent', 100: 'ein Euro', 101: 'ein Euro und ein Cent',
  200: 'zwei Euro', 1100: 'elf Euro', 1700: 'siebzehn Euro', 2100: 'einundzwanzig Euro', 3000: 'dreißig Euro', 9999: 'neunundneunzig Euro und neunundneunzig Cent',
  10000: 'einhundert Euro', 10100: 'einhundertein Euro', 12345: 'einhundertdreiundzwanzig Euro und fünfundvierzig Cent', 11100: 'einhundertelf Euro',
  25000: 'zweihundertfünfzig Euro', 100000: 'eintausend Euro', 100100: 'eintausendein Euro', 123456: 'eintausendzweihundertvierunddreißig Euro und sechsundfünfzig Cent',
  2000000: 'zwanzigtausend Euro', 2100000: 'einundzwanzigtausend Euro', 10100000: 'einhunderteintausend Euro', 99999999: 'neunhundertneunundneunzigtausendneunhundertneunundneunzig Euro und neunundneunzig Cent',
  100000000: 'eine Million Euro', 100000100: 'eine Million ein Euro', 200000000: 'zwei Millionen Euro', 2100000000: 'einundzwanzig Millionen Euro', 10100000000: 'einhunderteine Millionen Euro',
  123456789: 'eine Million zweihundertvierunddreißigtausendfünfhundertsiebenundsechzig Euro und neunundachtzig Cent', 100000000000: 'eine Milliarde Euro', 0: 'null Euro', 7000: 'siebzig Euro', 1600: 'sechzehn Euro', 60000: 'sechshundert Euro',
};
for (const [c, w] of Object.entries(W)) eq(amountWordsDe(+c), w, `de ${c}`);
eq(numberWordsDe(1), 'eins', 'bare eins'); eq(numberWordsDe(31), 'einunddreißig', '31'); eq(numberWordsDe(1001), 'eintausendeins', '1001');
eq(amountWordsDe(150, 'CHF'), 'ein Franken und fünfzig Rappen', 'CHF');
// ---- English words
const E = { 1: 'zero euros and one cent', 100: 'one euro', 12345: 'one hundred and twenty-three euros and forty-five cents', 100000000: 'one million euros',
  100500: 'one thousand and five euros', 2100000: 'twenty-one thousand euros', 11500: 'one hundred and fifteen euros', 4000: 'forty euros', 123456789: 'one million two hundred and thirty-four thousand five hundred and sixty-seven euros and eighty-nine cents' };
for (const [c, w] of Object.entries(E)) eq(amountWordsEn(+c), w, `en ${c}`);
eq(amountWordsEn(201, 'GBP'), 'two pounds and one penny', 'GBP penny'); eq(amountWordsEn(250, 'GBP'), 'two pounds and fifty pence', 'GBP pence');
eq(numberWordsEn(0), 'zero', '0');

// ---- Easter 2025–2030 (published dates)
const EASTER = { 2024: '2024-03-31', 2025: '2025-04-20', 2026: '2026-04-05', 2027: '2027-03-28', 2028: '2028-04-16', 2029: '2029-04-01', 2030: '2030-04-21', 2038: '2038-04-25', 2285: '2285-03-22' };
for (const [y, d] of Object.entries(EASTER)) eq(iso(easter(+y)), d, `easter ${y}`);
// ---- Saarland 2025–2030: 12 holidays (incl. Fronleichnam, Mariä Himmelfahrt, Allerheiligen)
const SL = {
  2025: ['2025-01-01', '2025-04-18', '2025-04-21', '2025-05-01', '2025-05-29', '2025-06-09', '2025-06-19', '2025-08-15', '2025-10-03', '2025-11-01', '2025-12-25', '2025-12-26'],
  2026: ['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-01', '2026-05-14', '2026-05-25', '2026-06-04', '2026-08-15', '2026-10-03', '2026-11-01', '2026-12-25', '2026-12-26'],
  2027: ['2027-01-01', '2027-03-26', '2027-03-29', '2027-05-01', '2027-05-06', '2027-05-17', '2027-05-27', '2027-08-15', '2027-10-03', '2027-11-01', '2027-12-25', '2027-12-26'],
  2028: ['2028-01-01', '2028-04-14', '2028-04-17', '2028-05-01', '2028-05-25', '2028-06-05', '2028-06-15', '2028-08-15', '2028-10-03', '2028-11-01', '2028-12-25', '2028-12-26'],
  2029: ['2029-01-01', '2029-03-30', '2029-04-02', '2029-05-01', '2029-05-10', '2029-05-21', '2029-05-31', '2029-08-15', '2029-10-03', '2029-11-01', '2029-12-25', '2029-12-26'],
  2030: ['2030-01-01', '2030-04-19', '2030-04-22', '2030-05-01', '2030-05-30', '2030-06-10', '2030-06-20', '2030-08-15', '2030-10-03', '2030-11-01', '2030-12-25', '2030-12-26'],
};
for (const [y, list] of Object.entries(SL)) eq(holidays(+y, 'SL').map(h => h.date), list, `SL ${y}`);
// counts per state (state-wide holidays, incl. Sunday-only ones in BB/HE)
const COUNT = { BW: 12, BY: 13, BE: 10, BB: 12, HB: 10, HH: 10, HE: 12, MV: 11, NI: 10, NW: 11, RP: 11, SL: 12, SN: 11, ST: 11, SH: 10, TH: 11 };
for (const [st, c] of Object.entries(COUNT)) for (let y = 2026; y <= 2030; y++) eq(holidays(y, st).length, c, `count ${st} ${y}`);
eq(holidays(2025, 'BE').length, 11, 'BE 2025 incl. 8 May');
// Buß- und Bettag (Saxony)
const BB = { 2025: '2025-11-19', 2026: '2026-11-18', 2027: '2027-11-17', 2028: '2028-11-22', 2029: '2029-11-21', 2030: '2030-11-20' };
for (const [y, d] of Object.entries(BB)) eq(holidays(+y, 'SN').find(h => h.de.startsWith('Buß')).date, d, `Buß- und Bettag ${y}`);
eq(holidays(2026, 'TH').some(h => h.date === '2026-09-20'), true, 'TH Weltkindertag');
eq(holidays(2026, 'BE').some(h => h.date === '2026-03-08'), true, 'BE Frauentag'); eq(holidays(2026, 'MV').some(h => h.date === '2026-03-08'), true, 'MV Frauentag');
eq(holidays(2026, 'NI').some(h => h.date === '2026-10-31'), true, 'NI Reformationstag'); eq(holidays(2026, 'SL').some(h => h.date === '2026-10-31'), false, 'SL no Reformationstag');

// ---- working days
eq(workingDays('2026-12-21', '2027-01-08', { state: 'SL' }).days, 13, 'Christmas 2026 SL (25/26 Fri/Sat, 1 Jan Fri)');
eq(workingDays('2026-05-11', '2026-05-15', { state: 'SL' }).days, 4, 'Ascension week');
eq(workingDays('2026-06-01', '2026-06-05', { state: 'SL' }).days, 4, 'Corpus Christi SL');
eq(workingDays('2026-06-01', '2026-06-05', { state: 'NI' }).days, 5, 'Corpus Christi NI');
eq(workingDays('2026-03-30', '2026-04-10', { state: 'SL' }).days, 8, 'Easter 2026');
eq(workingDays('2026-03-30', '2026-04-10', { state: 'SL', days: 6 }).days, 9, 'Easter 2026 six-day week');
eq(workingDays('2026-12-21', '2026-12-31', { state: 'SL', halfDays: true }).days, 7, 'half days 24/31 Dec');
eq(workingDays('2026-01-01', '2026-12-31', { state: 'SL' }).days, 253, 'SL 2026 working days');
eq(workingDays('2026-01-01', '2026-12-31', { state: 'BY' }).days, 252, 'BY 2026 (Epiphany Tue)');
eq(workingDays('2026-07-10', '2026-07-01'), null, 'reversed range');
eq(workingDays('2026-07-04', '2026-07-05').days, 0, 'weekend only');

// ---- interest
eq(daysLate('2026-01-31', '2026-03-02'), 30, 'days late'); eq(daysLate('2026-03-02', '2026-03-01'), 0, 'not overdue');
eq(lateRate(1.52, false), 6.52, 'B2C rate'); eq(lateRate(1.52, true), 10.52, 'B2B rate'); eq(lateRate(-0.88, false), 4.12, 'negative base');
eq(interestCents(100000, 6.52, 30), 536, '1000 € × 6.52 % × 30/365 = 5.36');
eq(interestCents(100000, 10.52, 365), 10520, 'one year');
const t = reminderTotals([{ cents: 119000, paidCents: 19000, due: '2026-08-01' }, { cents: 5000, due: '2026-10-20' }], { interest: true, rate: 10.52, until: '2026-10-15', flatFee: 4000, fee: 500 });
eq([t.open, t.rows[0].days, t.interest, t.flat, t.total], [105000, 75, 2162, 4000, 105000 + 2162 + 4000 + 500], 'reminder totals');

console.log(`${n - fail}/${n} unit checks passed`);
process.exit(fail ? 1 : 0);
