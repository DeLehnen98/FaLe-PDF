// Languages: German is the source language (every UI string is written in German and passed through t());
// English comes from the dictionary in i18n-en.js. Missing entries fall back to German and are caught by the
// test suite (scripts check that every t('…') literal has an English entry).
import EN from './i18n-en.js';

let lang = 'de';
export function initLang() {
  let pref = 'auto';
  try { pref = localStorage.getItem('fale-one-lang') || 'auto'; } catch {}
  if (pref === 'de' || pref === 'en') lang = pref;
  else {
    lang = 'en';
    const list = (navigator.languages && navigator.languages.length) ? navigator.languages : [navigator.language || 'de'];
    for (const l of list) { if (/^de\b/i.test(l)) { lang = 'de'; break; } if (/^en\b/i.test(l)) break; }
  }
  document.documentElement.lang = lang;
  return lang;
}
export const getLang = () => lang;
export function langPref() { try { return localStorage.getItem('fale-one-lang') || 'auto'; } catch { return 'auto'; } }
export function setLangPref(v) { try { if (v === 'auto') localStorage.removeItem('fale-one-lang'); else localStorage.setItem('fale-one-lang', v); } catch {} }

/** Translate a German UI string; {name} placeholders are filled from vars. */
export function t(de, vars) {
  let s = lang === 'en' ? (EN[de] ?? de) : de;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
  return s;
}
/** Plural: tp(n, '{n} Foto', '{n} Fotos') */
export function tp(n, one, many, vars = {}) { return t(n === 1 ? one : many, { n: fmtNum(n), ...vars }); }

const locale = () => (lang === 'en' ? 'en-GB' : 'de-DE');
export function fmtNum(n, digits = 0) { return Number(n || 0).toLocaleString(locale(), { maximumFractionDigits: digits, minimumFractionDigits: digits }); }
/** Bytes → "2,1 GB" (binary units, labelled like every phone does) */
export function fmtSize(b) {
  b = Number(b) || 0;
  if (b < 1024) return `${fmtNum(b)} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { b /= 1024; i++; } while (b >= 1024 && i < u.length - 1);
  return `${fmtNum(b, b < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}
export function fmtDate(d, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return x.toLocaleDateString(locale(), opts);
}
export function fmtDateTime(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return x.toLocaleString(locale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function fmtMonth(y, m) { return new Date(y, m - 1, 15).toLocaleDateString(locale(), { month: 'long', year: 'numeric' }); }
export function fmtDay(y, m, d) { return new Date(y, m - 1, d, 12).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'long' }); }
/** "vor 3 Min." / "3 min ago" */
export function ago(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((Date.now() - (typeof ts === 'number' ? ts : Date.parse(ts))) / 1000));
  if (s < 50) return t('gerade eben');
  const m = Math.round(s / 60);
  if (m < 60) return t('vor {n} Min.', { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t('vor {n} Std.', { n: h });
  const d = Math.round(h / 24);
  if (d < 14) return tp(d, 'vor {n} Tag', 'vor {n} Tagen');
  return t('am {date}', { date: fmtDate(typeof ts === 'number' ? ts : Date.parse(ts)) });
}
export function fmtDuration(ms) {
  const s = Math.round((ms || 0) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(r).padStart(2, '0')}`;
}
