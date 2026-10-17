// Unit tests for the calculators: VAT, percentages, date maths (ISO weeks, working days 2026 counted by hand),
// number parsing, character statistics and the text diff.  node tests/suites/webtools/calc_unit.mjs
// (The browser-only modules are imported with a tiny DOM stand-in.)
globalThis.document = { documentElement: { lang: 'de' }, createElement: () => ({ append() {}, addEventListener() {}, setAttribute() {}, classList: { add() {} } }), head: { append() {} }, querySelector: () => null, createElementNS: () => ({ setAttribute() {}, append() {} }), createTextNode: () => ({}) };
globalThis.HTMLInputElement = class {};
globalThis.Node = class {};

const { parseNum, cents } = await import('../../../network/assets/wt/lib/calc-core.js');
const { vat } = await import('../../../network/assets/wt/tools/vat-calculator.js');
const { pct } = await import('../../../network/assets/wt/tools/percent-calculator.js');
const dc = await import('../../../network/assets/wt/lib/date-calc.js');
const { stats } = await import('../../../network/assets/wt/tools/character-counter.js');
const { compare } = await import('../../../network/assets/wt/tools/compare-text.js');

let ok = 0, fail = 0;
const expect = (c, m) => { if (c) ok++; else { fail++; console.log('FAIL', m); } };
const eq = (a, b, m) => expect(Object.is(a, b) || (typeof a === 'number' && Math.abs(a - b) < 1e-9), `${m}: ${a} vs ${b}`);

// numbers
eq(parseNum('1.234,56', 'de'), 1234.56, 'de thousands + comma');
eq(parseNum('1,234.56', 'en'), 1234.56, 'en thousands + point');
eq(parseNum('1234,5'), 1234.5, 'comma decimal');
eq(parseNum('1.234', 'de'), 1234, 'de: 1.234 is a thousand');
eq(parseNum('1.234', 'en'), 1.234, 'en: 1.234 is a decimal');
eq(parseNum('19 %'), 19, 'percent sign');
eq(parseNum('−5'), -5, 'unicode minus');
expect(Number.isNaN(parseNum('abc')) && Number.isNaN(parseNum('')), 'not a number');
eq(cents(1.005), 1.01, 'cents half up');

// VAT
let r = vat(100, 19, 'net'); expect(r.tax === 19 && r.gross === 119, 'net 100 @19');
r = vat(119, 19, 'gross'); expect(r.net === 100 && r.tax === 19, 'gross 119 @19');
r = vat(9.99, 19, 'gross'); expect(r.net === 8.39 && r.tax === 1.6 && cents(r.net + r.tax) === 9.99, `gross 9.99 adds up ${JSON.stringify(r)}`);
r = vat(19, 19, 'tax'); expect(r.net === 100 && r.gross === 119, 'from tax');
r = vat(29, 10, 'gross'); expect(r.net === 26.36 && r.tax === 2.64, 'shopify example per line');
expect(vat(5, 0, 'tax') === null, 'from tax at 0 %');

// percentages
eq(pct.of(19, 250), 47.5, 'of'); eq(pct.share(45, 180), 25, 'share'); eq(pct.base(30, 15), 200, 'base');
eq(pct.change(80, 92), 15, 'change'); eq(pct.plus(100, 20), 120, 'plus'); eq(pct.minus(100, 20), 80, 'minus');
eq(cents(pct.before(59.99, 25)), 79.99, 'before discount');
expect(Number.isNaN(pct.share(1, 0)), 'share by zero');

// ISO weeks
const W = s => dc.isoWeek(dc.parse(s));
expect(W('2026-01-01').week === 1 && W('2026-01-01').year === 2026, '1 Jan 2026 = KW 1');
expect(W('2027-01-01').week === 53 && W('2027-01-01').year === 2026, '1 Jan 2027 = KW 53/2026');
expect(W('2021-01-03').week === 53 && W('2021-01-03').year === 2020, '3 Jan 2021 = KW 53/2020');
expect(W('2024-12-30').week === 1 && W('2024-12-30').year === 2025, '30 Dec 2024 = KW 1/2025');
expect(dc.weeksInYear(2026) === 53 && dc.weeksInYear(2025) === 52 && dc.weeksInYear(2020) === 53, 'weeks in year');
const wr = dc.weekRange(2026, 1); expect(dc.iso(wr.from) === '2025-12-29' && dc.iso(wr.to) === '2026-01-04', 'KW 1 2026 range');
expect(dc.iso(dc.addMonths(dc.parse('2026-01-31'), 1)) === '2026-02-28' && dc.iso(dc.addMonths(dc.parse('2028-01-31'), 1)) === '2028-02-29', 'month end clamp');
const y = dc.ymd(dc.parse('2020-02-29'), dc.parse('2026-10-18')); expect(y.years === 6 && y.months === 7 && y.days === 19, `ymd ${JSON.stringify(y)}`);
expect(dc.daysBetween(dc.parse('2026-03-28'), dc.parse('2026-03-30')) === 2, 'days across DST');

// working days 2026 – counted by hand: 261 weekdays; Saarland 8 holidays on weekdays (15.8., 3.10., 1.11., 26.12. fall on weekends), Berlin 7
expect(dc.workdays('2026-01-01', '2026-12-31', { state: 'SL' }).work === 253, 'SL 2026 = 253');
expect(dc.workdays('2026-01-01', '2026-12-31', { state: 'BE' }).work === 254, 'BE 2026 = 254');
const half = dc.workdays('2026-12-01', '2026-12-31', { state: 'SL', halfDays: true });
expect(half.half.length === 2 && half.work === 21, `December 2026 SL with half days ${half.work}`);   // 23 weekdays − 25.12. − 2 × ½
expect(dc.workdays('2026-01-01', '2026-12-31', { state: 'SL', vacation: 30 }).work === 223, 'vacation subtracted');
expect(dc.iso(dc.addWorkdays('2026-04-02', 1, { state: 'SL' })) === '2026-04-07', 'Easter skipped');
expect(dc.iso(dc.addWorkdays('2026-04-07', -1, { state: 'SL' })) === '2026-04-02', 'Easter skipped backwards');
expect(dc.workdays('2026-08-01', '2026-08-31', { state: 'BY', augsburg: true }).holidays.some(h => h.date === '2026-08-10') === false, 'Augsburg on a Saturday in 2026 → not a weekday');
expect(dc.holidayMap(2026, 'BY', { augsburg: true }).has('2026-08-08'), 'Augsburg date present');
expect(dc.holidayMap(2026, 'SN', { localCorpus: true }).has('2026-06-04') && !dc.holidayMap(2026, 'SN').has('2026-06-04'), 'local Corpus Christi Saxony');

// character stats
let s = stats('Hallo Welt! 👋🏽 Wie geht’s?\n\nZweiter Absatz.', 'de');
expect(s.words === 6, `words ${s.words}`);
expect(s.sentences === 3, `sentences ${s.sentences}`);
expect(s.paragraphs === 2 && s.lines === 3, 'paragraphs + lines');
expect(s.smsUnicode && s.sms === 1, 'emoji → unicode SMS');
s = stats('👋🏽', 'de'); expect(s.chars === 1, `emoji with skin tone = 1 (${s.chars})`);
s = stats('a'.repeat(161), 'de'); expect(s.sms === 2 && !s.smsUnicode, '161 chars = 2 SMS');
s = stats('€'.repeat(80), 'de'); expect(s.smsLen === 160 && s.sms === 1, '€ costs two units');
s = stats('Ä'.repeat(1800), 'de'); expect(Math.abs(s.pages - 1) < 1e-9, 'one standard page');

// text diff
let c = compare('Der Vertrag beginnt am 1. Mai.', 'Der Vertrag beginnt am 1. Juni.');
expect(c.del === 1 && c.ins === 1 && c.ops.some(o => o.type === 'del' && o.text === 'Mai') && c.ops.some(o => o.type === 'ins' && o.text === 'Juni'), 'word diff');
c = compare('Hallo  Welt', 'hallo welt', { ignoreCase: true, ignoreSpace: true });
expect(c.del === 0 && c.ins === 0, 'ignore case + space');
c = compare('abc', 'abd', { mode: 'chars' }); expect(c.del === 1 && c.ins === 1, 'char diff');
c = compare('a\nb\nc\n', 'a\nc\n', { mode: 'lines' }); expect(c.del === 1 && c.ins === 0, 'line diff');

console.log(`calc: ${ok} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
