// Amounts in words for receipts ("in Worten"): German and English, euros/cents (and a few other
// currencies on the English page). Pure functions, unit-tested (scratchpad tpl_units.mjs).
//   amountWordsDe(12345)   → "einhundertdreiundzwanzig Euro und fünfundvierzig Cent"
//   amountWordsEn(12345, 'GBP') → "one hundred and twenty-three pounds and forty-five pence"

const ONES = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn',
  'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'];
const TENS = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];

/** 1–999 in German, "eins" at the end (as a bare number). */
function de999(n) {
  let out = '';
  const h = Math.floor(n / 100), r = n % 100;
  if (h) out += (h === 1 ? 'ein' : ONES[h]) + 'hundert';
  if (r) {
    if (r < 20) out += ONES[r];
    else {
      const o = r % 10, t = Math.floor(r / 10);
      out += (o ? (o === 1 ? 'ein' : ONES[o]) + 'und' : '') + TENS[t];
    }
  }
  return out;
}

/**
 * Whole number 0 … 999 999 999 999 in German words. `before` = 'noun' turns a final "eins" into "ein"
 * ("einhundertein Euro"), 'fem' into "eine" ("eine Million").
 */
export function numberWordsDe(n, before = null) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n === 0) return 'null';
  if (n > 999999999999) throw new RangeError('too large');
  const parts = [];
  const bil = Math.floor(n / 1e9), mil = Math.floor(n / 1e6) % 1000, th = Math.floor(n / 1000) % 1000, rest = n % 1000;
  const big = (k, one, many) => (k === 1 ? `eine ${one}` : `${fem(de999(k))} ${many}`);
  if (bil) parts.push(big(bil, 'Milliarde', 'Milliarden'));
  if (mil) parts.push(big(mil, 'Million', 'Millionen'));
  let small = '';
  if (th) small += (th === 1 ? 'ein' : endEin(de999(th))) + 'tausend';
  if (rest) small += de999(rest);
  if (small) parts.push(small);
  let s = parts.join(' ');
  if (before === 'noun') s = s.replace(/eins$/, 'ein');
  else if (before === 'fem') s = s.replace(/eins$/, 'eine');
  return s;
}
// "einundzwanzigtausend", "hunderteintausend": a final "eins" before -tausend becomes "ein"
const endEin = s => s.replace(/eins$/, 'ein');
// "einhunderteine Millionen" (feminine before Million/Milliarde)
const fem = s => s.replace(/eins$/, 'eine');

/** Cents (integer) → German words, e.g. 100 → "ein Euro", 1 → "null Euro und ein Cent". */
export function amountWordsDe(cents, currency = 'EUR') {
  cents = Math.round(Math.abs(Number(cents) || 0));
  const e = Math.floor(cents / 100), c = cents % 100;
  const unit = { EUR: ['Euro', 'Euro', 'Cent', 'Cent'], CHF: ['Franken', 'Franken', 'Rappen', 'Rappen'], USD: ['US-Dollar', 'US-Dollar', 'Cent', 'Cent'], GBP: ['Pfund', 'Pfund', 'Penny', 'Pence'] }[currency] || ['Euro', 'Euro', 'Cent', 'Cent'];
  const main = `${numberWordsDe(e, 'noun')} ${e === 1 ? unit[0] : unit[1]}`;
  return c ? `${main} und ${numberWordsDe(c, 'noun')} ${c === 1 ? unit[2] : unit[3]}` : main;
}

// ---------------------------------------------------------------- English (British style: "and")
const EN1 = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN10 = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function en999(n, and) {
  const h = Math.floor(n / 100), r = n % 100;
  const parts = [];
  if (h) parts.push(EN1[h] + ' hundred');
  if (r) {
    const w = r < 20 ? EN1[r] : EN10[Math.floor(r / 10)] + (r % 10 ? '-' + EN1[r % 10] : '');
    parts.push((h || and ? 'and ' : '') + w);
  }
  return parts.join(' ');
}
export function numberWordsEn(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n === 0) return 'zero';
  if (n > 999999999999) throw new RangeError('too large');
  const groups = [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand'], [1, '']];
  const parts = [];
  for (const [g, name] of groups) {
    const k = Math.floor(n / g) % 1000;
    if (!k) continue;
    // "one thousand and five": a last group below 100 after a bigger group gets "and"
    const w = en999(k, g === 1 && k < 100 && parts.length > 0);
    parts.push(name ? `${w} ${name}` : w);
  }
  return parts.join(' ').replace(/ {2,}/g, ' ');
}
const EN_UNITS = { EUR: ['euro', 'euros', 'cent', 'cents'], USD: ['dollar', 'dollars', 'cent', 'cents'], GBP: ['pound', 'pounds', 'penny', 'pence'], CHF: ['franc', 'francs', 'centime', 'centimes'] };
export function amountWordsEn(cents, currency = 'EUR') {
  cents = Math.round(Math.abs(Number(cents) || 0));
  const u = EN_UNITS[currency] || EN_UNITS.EUR;
  const e = Math.floor(cents / 100), c = cents % 100;
  const main = `${numberWordsEn(e)} ${e === 1 ? u[0] : u[1]}`;
  return c ? `${main} and ${numberWordsEn(c)} ${c === 1 ? u[2] : u[3]}` : main;
}

export const amountWords = (cents, lang, currency = 'EUR') => (lang === 'de' ? amountWordsDe(cents, currency) : amountWordsEn(cents, currency));
