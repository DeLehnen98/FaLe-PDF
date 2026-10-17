// Shared helpers for the calculators and text tools (vat-calculator, percent-calculator, working-days,
// date-difference, calendar-week, character-counter, compare-text): number input in German or English
// notation, formatting, copy buttons, the stylesheet. Pure DOM via el() – no HTML strings.
import { el, icon } from './dom.js';
import { copyText, svgIcon } from './seo-ui.js';

export const LANG = document.documentElement.lang === 'en' ? 'en' : 'de';
export const T = (v, lang = LANG) => (typeof v === 'string' ? v : v[lang] ?? v.de);
const LOCALE = { de: 'de-DE', en: 'en-GB' };

let cssReady = null;
export function calcCss() {
  if (!cssReady) {
    cssReady = Promise.all(['./img-tools.css', './seo.css', './calc.css'].map(f => new Promise(resolve => {
      const href = new URL(f, import.meta.url).href;
      if (document.querySelector(`link[href="${href}"]`)) { resolve(); return; }
      const link = el('link', { rel: 'stylesheet', href });
      link.addEventListener('load', () => resolve());
      link.addEventListener('error', () => resolve());
      document.head.append(link);
    })));
  }
  return cssReady;
}

/**
 * "1.234,56" / "1234,56" / "1,234.56" / "1234.56" / "12 %" → number (NaN when empty or not a number).
 * The last of "," and "." is the decimal mark; "1.234" with exactly three digits after a single dot is read
 * as thousands in German and as a decimal in English.
 */
export function parseNum(s, lang = LANG) {
  let t = String(s ?? '').trim().replace(/[\s  '’%€$£]|EUR|CHF/gi, '').replace(/^\+/, '').replace(/−/g, '-');
  if (!t) return NaN;
  const lc = t.lastIndexOf(','), ld = t.lastIndexOf('.');
  if (lc >= 0 && ld >= 0) {
    const dec = lc > ld ? ',' : '.';
    t = t.split(dec === ',' ? '.' : ',').join('').replace(dec, '.');
  } else if (lc >= 0) {
    t = (t.match(/,/g).length > 1) ? t.replace(/,/g, '') : t.replace(',', '.');
  } else if (ld >= 0 && (t.match(/\./g).length > 1 || (lang === 'de' && /^-?\d{1,3}\.\d{3}$/.test(t)))) {
    t = t.replace(/\./g, '');
  }
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return NaN;
  return Number(t);
}

export const fmt = (n, { min = 0, max = 2, lang = LANG } = {}) =>
  Number.isFinite(n) ? n.toLocaleString(LOCALE[lang], { minimumFractionDigits: min, maximumFractionDigits: max }) : '–';
export const money = (n, cur = 'EUR', lang = LANG) =>
  Number.isFinite(n) ? n.toLocaleString(LOCALE[lang], { style: 'currency', currency: cur }) : '–';
/** Round half away from zero to cents without binary surprises (1.005 → 1.01). */
export const cents = n => Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-7) / 100;

/** Labelled input; returns { wrap, input }. */
export function field({ id, label, value = '', type = 'text', inputmode = 'decimal', hint = null, suffix = null, onInput }) {
  const input = el('input', { id, type, class: 'wt-input calc-in', value, inputmode: type === 'text' ? inputmode : null, autocomplete: 'off', spellcheck: 'false',
    aria: { describedby: hint ? id + '-hint' : null } });
  input.addEventListener('input', () => onInput?.(input.value));
  const box = el('div', { class: 'calc-in-box' + (suffix ? ' has-suffix' : '') }, input, suffix ? el('span', { class: 'calc-suffix', aria: { hidden: 'true' } }, suffix) : null);
  const wrap = el('div', { class: 'calc-field' }, el('label', { for: id, class: 'calc-label' }, label), box,
    hint ? el('p', { class: 'calc-hint', id: id + '-hint' }, hint) : null);
  return { wrap, input };
}

/** Segmented choice (radio buttons that look like a toggle row). */
export function segmented({ name, label, choices, value, onChange }) {
  const box = el('div', { class: 'calc-seg', role: 'radiogroup', aria: { label } });
  for (const c of choices) {
    const id = `${name}-${c.value}`;
    const inp = el('input', { type: 'radio', name, id, value: c.value, checked: String(c.value) === String(value) });
    inp.addEventListener('change', () => { if (inp.checked) onChange(c.value); });
    box.append(el('span', { class: 'calc-seg-opt' }, inp, el('label', { for: id }, c.label)));
  }
  return box;
}

/** Copy button with a short "copied" state; text() is read when clicked. */
export function copyBtn(text, label, live) {
  const b = el('button', { type: 'button', class: 'wt-btn wt-btn-quiet wt-btn-sm calc-copy', aria: { label } }, svgIcon('copy'));
  b.addEventListener('click', async () => {
    const ok = await copyText(typeof text === 'function' ? text() : text);
    if (live) live.textContent = ok ? T({ de: 'Kopiert.', en: 'Copied.' }) : T({ de: 'Kopieren hat nicht geklappt.', en: 'Copying didn’t work.' });
    if (ok) { b.classList.add('is-done'); setTimeout(() => b.classList.remove('is-done'), 1200); }
  });
  return b;
}

export function liveRegion() { return el('p', { class: 'seo-sr calc-live', role: 'status', aria: { live: 'polite' } }); }
export const warn = text => el('p', { class: 'img-note calc-warn' }, icon('alert'), el('span', {}, text));
