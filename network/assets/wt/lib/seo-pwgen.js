// Password / passphrase generation (pure, no DOM) for tools/password-generator.js.
// Randomness: crypto.getRandomValues with rejection sampling (no modulo bias). Strength = exact entropy of
// the generation method (the attacker is assumed to know the method, the character sets and the word list).

export const SETS = {
  lower: 'abcdefghijklmnopqrstuvwxyz',
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  digits: '0123456789',
  symbols: '!#$%&*+-=?@_.,:;/()[]{}^~',
};
export const LOOKALIKE = 'Il1O0o|';
export const SEPARATORS = ['-', ' ', '.', '_', ''];

/** Uniform random integer 0 … n-1 (n ≤ 2^32). */
export function randInt(n, rng = globalThis.crypto) {
  if (!(n >= 1) || n > 2 ** 32) throw new RangeError('randInt: n out of range');
  if (n === 1) return 0;
  const limit = Math.floor(2 ** 32 / n) * n;   // values ≥ limit would bias the result
  const buf = new Uint32Array(1);
  for (;;) {
    rng.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

/** The character groups actually in use (look-alikes removed if asked), as arrays of strings. */
export function groups({ lower = true, upper = true, digits = true, symbols = true, similar = false } = {}) {
  const on = { lower, upper, digits, symbols };
  return Object.keys(SETS).filter(k => on[k])
    .map(k => [...SETS[k]].filter(c => !similar || !LOOKALIKE.includes(c)).join(''))
    .filter(g => g.length);
}

/** Random password; every chosen group appears at least once (when the length allows it). */
export function makePassword(o = {}, rng = globalThis.crypto) {
  const gs = groups(o);
  const len = Math.max(1, Math.floor(o.length || 20));
  if (!gs.length) throw new RangeError('no character set');
  const pool = gs.join('');
  const need = len >= gs.length;
  for (let tries = 0; tries < 10000; tries++) {
    let s = '';
    for (let i = 0; i < len; i++) s += pool[randInt(pool.length, rng)];
    if (!need || gs.every(g => [...s].some(c => g.includes(c)))) return s;
  }
  throw new Error('makePassword: gave up');   // practically unreachable
}

/** Random passphrase from a word list. */
export function makePassphrase(words, o = {}, rng = globalThis.crypto) {
  const n = Math.max(1, Math.floor(o.words || 5));
  const parts = [];
  for (let i = 0; i < n; i++) {
    let w = words[randInt(words.length, rng)];
    if (o.capitalize) w = w[0].toUpperCase() + w.slice(1);
    parts.push(w);
  }
  if (o.digit) { const i = randInt(n, rng); parts[i] += String(randInt(10, rng)); }
  return parts.join(o.separator ?? '-');
}

/** log2 of a positive BigInt. */
export function log2Big(n) {
  if (n <= 0n) return -Infinity;
  const bits = n.toString(2).length;
  if (bits <= 52) return Math.log2(Number(n));
  const top = Number(n >> BigInt(bits - 52));
  return Math.log2(top) + (bits - 52);
}

/** Exact entropy (bits) of makePassword with these options. */
export function passwordBits(o = {}) {
  const gs = groups(o);
  const len = Math.max(1, Math.floor(o.length || 20));
  if (!gs.length) return 0;
  const U = gs.reduce((s, g) => s + g.length, 0);
  if (len < gs.length) return len * Math.log2(U);
  // inclusion–exclusion over the groups: strings that use every group at least once
  let total = 0n;
  const k = gs.length;
  for (let mask = 0; mask < 1 << k; mask++) {
    let without = 0, bitsSet = 0;
    for (let i = 0; i < k; i++) if (mask & (1 << i)) { without += gs[i].length; bitsSet++; }
    const term = BigInt(U - without) ** BigInt(len);
    total += bitsSet % 2 ? -term : term;
  }
  return log2Big(total);
}

/** Exact entropy (bits) of makePassphrase with a list of `listSize` distinct words. */
export function passphraseBits(listSize, o = {}) {
  const n = Math.max(1, Math.floor(o.words || 5));
  return n * Math.log2(listSize) + (o.digit ? Math.log2(10 * n) : 0);
}

/** Strength band for an entropy in bits. */
export function rating(bits) {
  if (bits < 40) return { level: 0, de: 'Sehr schwach', en: 'Very weak' };
  if (bits < 60) return { level: 1, de: 'Schwach', en: 'Weak' };
  if (bits < 80) return { level: 2, de: 'Gut', en: 'Good' };
  if (bits < 100) return { level: 3, de: 'Stark', en: 'Strong' };
  return { level: 4, de: 'Sehr stark', en: 'Very strong' };
}

export const GUESSES_PER_SECOND = 1e10;

/** Average time to guess (half the space) at GUESSES_PER_SECOND, as {de, en} text. */
export function crackTime(bits) {
  const sec = 2 ** (bits - 1) / GUESSES_PER_SECOND;
  const units = [[1, 'Sekunde', 'Sekunden', 'second', 'seconds'], [60, 'Minute', 'Minuten', 'minute', 'minutes'],
    [3600, 'Stunde', 'Stunden', 'hour', 'hours'], [86400, 'Tag', 'Tage', 'day', 'days'], [31557600, 'Jahr', 'Jahre', 'year', 'years']];
  if (sec < 1) return { de: 'weniger als eine Sekunde', en: 'less than a second' };
  let u = units[0];
  for (const x of units) if (sec >= x[0]) u = x;
  const v = sec / u[0];
  if (u[0] === 31557600 && v >= 1e6) {
    const big = [[1e15, 'Billiarden', 'quadrillion'], [1e12, 'Billionen', 'trillion'], [1e9, 'Milliarden', 'billion'], [1e6, 'Millionen', 'million']];
    if (v >= 1e18) return { de: 'mehr als eine Trillion Jahre', en: 'more than a quintillion years' };
    for (const [f, de, en] of big) if (v >= f) {
      const x = Math.floor(v / f);
      return { de: `etwa ${x.toLocaleString('de-DE')} ${de} Jahre`, en: `about ${x.toLocaleString('en-GB')} ${en} years` };
    }
  }
  const r = v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
  const one = r === 1;
  return { de: `etwa ${r.toLocaleString('de-DE')} ${one ? u[1] : u[2]}`, en: `about ${r.toLocaleString('en-GB')} ${one ? u[3] : u[4]}` };
}
