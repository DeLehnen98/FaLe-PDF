// Unit tests for lib/seo-barcode.js and lib/seo-pwgen.js (node). Run: node seo_units.mjs
import { webcrypto } from 'node:crypto';
const LIB = '/home/claude/FalePDF/network/assets/wt/lib/';
const bc = await import(LIB + 'seo-barcode.js');
const pg = await import(LIB + 'seo-pwgen.js');
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };

// --- tables
ok(bc.C128.length === 107, 'code128 107 patterns');
bc.C128.forEach((p, v) => {
  const w = [...p].map(Number);
  ok(w.reduce((a, b) => a + b, 0) === (v === 106 ? 13 : 11), `c128 ${v} sum`);
  ok(w.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0) % 2 === (v === 106 ? 0 : 0), `c128 ${v} even bar modules`);
});
ok(new Set(bc.C128).size === 107, 'c128 unique');
ok(bc.gs1Check('400638133393') === 1, 'EAN check 4006381333931');
ok(bc.gs1Check('03600029145') === 2, 'UPC check 036000291452');
ok(bc.gs1Check('9638507') === 4, 'EAN-8 check 96385074');
ok(bc.gs1Check('1540014128876') === 3, 'ITF-14 check 15400141288763');
ok(bc.mod43('CODE39') === 'W', 'mod43 CODE39 → W: ' + bc.mod43('CODE39'));
// code 128: known optimal value sequences
const v = t => bc.code128Values(t).slice(0, -2);
ok(JSON.stringify(v('123456')) === '[105,12,34,56]', 'c128 all C ' + v('123456'));
ok(JSON.stringify(v('AB')) === '[104,33,34]', 'c128 B');
ok(v('X12345678')[0] === 104 && v('X12345678').includes(99), 'c128 switches to C for long digit run ' + v('X12345678'));
ok(!v('A12B').includes(99), 'c128 stays in B for short digit run');
ok(v('12345').length === 5, 'c128 odd digits: C C switch B char → ' + v('12345'));
// Wikipedia example: "PJJ123C" → start B, P J J, Code C, 12, Code B? (shortest)
// --- round trip every type through a rendered boolean row
function row(sym, px = 3) {
  const r = new Array(sym.width * px).fill(false);
  for (const b of sym.bars) for (let x = b.x * px; x < (b.x + b.w) * px; x++) r[x] = true;
  if (sym.bearer) { const t = 3 * px; return [...new Array(t).fill(true), ...r, ...new Array(t).fill(true)]; }
  return r;
}
const cases = [['ean13', '400638133393'], ['ean13', '5901234123457'], ['ean8', '9638507'], ['upca', '03600029145'], ['upca', '012345678905'],
  ['code128', 'Hello, World! 123'], ['code128', '0123456789012'], ['code128', 'A'], ['code128', 'abc123456XYZ~{}'], ['code39', 'Code-39 $/+%'], ['itf14', '1540014128876'], ['itf14', '00012345678905']];
for (const [type, input] of cases) for (const check39 of [false, true]) for (const bearer of [false, true]) {
  const n = bc.normalize(type, input, { check39 });
  const sym = bc.encode(type, n.data, { text: n.text, bearer });
  for (const px of [1, 2, 3, 4]) {
    const got = bc.decodeRow(type, row(sym, px), { check39 });
    ok(got === n.data, `${type} ${input} px${px} check39=${check39} bearer=${bearer}: ${got} vs ${n.data}`);
  }
  if (type === 'ean13' || type === 'upca') ok(sym.width === 113 && sym.bars.at(-1).x + sym.bars.at(-1).w === sym.width - sym.quiet[1], `${type} width`);
}
// cross-type rejection: an EAN-13 row must not decode as Code 128 etc.
const e = bc.encode('ean13', '4006381333931');
ok(bc.decodeRow('code128', row(e)) === null && bc.decodeRow('ean8', row(e)) === null, 'cross-type null');
// validation
const err = (t, s, o) => { try { bc.normalize(t, s, o); return null; } catch (x) { return x.userMessage; } };
ok(err('ean13', '4006381333932')?.de.includes('Richtig wäre 1'), 'wrong EAN check digit message');
ok(err('ean13', '12345')?.en.includes('you entered 5'), 'EAN length message');
ok(err('code128', 'Grüße')?.de.includes('ü'), 'code128 non-ASCII');
ok(err('code39', 'a_b')?.de.includes('_'), 'code39 bad char');
ok(bc.normalize('code39', 'abc').data === 'ABC', 'code39 upper');
ok(bc.normalize('ean13', '4006381333931').note.en.includes('correct'), 'valid check');

// --- passwords
const rng = webcrypto;
const counts = new Array(7).fill(0);
for (let i = 0; i < 70000; i++) counts[pg.randInt(7, rng)]++;
ok(counts.every(c => Math.abs(c - 10000) < 500), 'randInt uniform ' + counts);
for (let i = 0; i < 200; i++) {
  const p = pg.makePassword({ length: 12, similar: true }, rng);
  ok(p.length === 12 && /[A-Z]/.test(p) && /[a-z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p) && !/[Il1O0o]/.test(p), 'password sets ' + p);
}
ok(pg.makePassword({ length: 30, upper: false, lower: false, digits: true, symbols: false }, rng).match(/^\d{30}$/), 'digits only');
ok(Math.abs(pg.passwordBits({ length: 10, upper: false, lower: false, symbols: false }) - 10 * Math.log2(10)) < 1e-9, 'bits digits');
// inclusion-exclusion vs brute force on tiny case: length 3, digits + lower
{
  const U = 36; let cnt = 0;
  for (let a = 0; a < U; a++) for (let b = 0; b < U; b++) for (let c = 0; c < U; c++) { const d = [a, b, c]; if (d.some(x => x < 10) && d.some(x => x >= 10)) cnt++; }
  ok(Math.abs(pg.passwordBits({ length: 3, upper: false, symbols: false }) - Math.log2(cnt)) < 1e-9, 'inclusion-exclusion exact');
}
ok(pg.passwordBits({ length: 64 }) > 380, 'big lengths ' + pg.passwordBits({ length: 64 }));
const words = (await import(LIB + 'seo-words-de.js')).default, wen = (await import(LIB + 'seo-words-en.js')).default;
ok(words.length > 1900 && wen.length > 2000 && new Set(words).size === words.length && new Set(wen).size === wen.length, 'word lists');
ok(words.every(w => /^[a-z]{3,10}$/.test(w)) && wen.every(w => /^[a-z]{3,10}$/.test(w)), 'word list charset');
const ph = pg.makePassphrase(words, { words: 5, separator: '-', capitalize: true, digit: true }, rng);
ok(/^([A-Z][a-z]+\d?-){4}[A-Z][a-z]+\d?$/.test(ph) && (ph.match(/\d/g) || []).length === 1, 'passphrase ' + ph);
ok(Math.abs(pg.passphraseBits(2048, { words: 5 }) - 55) < 1e-9, 'phrase bits');
ok(pg.rating(39).level === 0 && pg.rating(100).level === 4, 'rating');
ok(pg.crackTime(20).de === 'weniger als eine Sekunde', 'crack small');
ok(/Jahre/.test(pg.crackTime(80).de) && /years/.test(pg.crackTime(80).en), 'crack 80: ' + pg.crackTime(80).de);
ok(pg.crackTime(200).de.startsWith('mehr als'), 'crack huge');
console.log(fails ? `${fails} failures` : 'seo units ok');
process.exit(fails ? 1 : 0);
