// Formatting helpers (sizes, percentages, file names).
const nf = {};
function num(lang, digits) {
  const key = lang + digits;
  return nf[key] || (nf[key] = new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-GB', { maximumFractionDigits: digits, minimumFractionDigits: 0 }));
}

export function formatSize(bytes, lang = 'de') {
  const b = Math.max(0, Number(bytes) || 0);
  if (b < 1000) return `${b} B`;
  if (b < 1000 * 1000) return `${num(lang, b < 10e3 ? 1 : 0).format(b / 1e3)} KB`;
  if (b < 1e9) return `${num(lang, b < 10e6 ? 1 : 0).format(b / 1e6)} MB`;
  return `${num(lang, 2).format(b / 1e9)} GB`;
}

/** Saved percentage (integer, ≥ 0) or 0 when the result is not smaller. */
export function savedPercent(before, after) {
  if (!before || after >= before) return 0;
  return Math.max(1, Math.round((1 - after / before) * 100));
}

export function baseName(name) {
  const n = String(name || '').replace(/^.*[\\/]/, '');
  const i = n.lastIndexOf('.');
  return (i > 0 ? n.slice(0, i) : n) || 'Datei';
}

export function extension(name) {
  const m = /\.([a-z0-9]{1,8})$/i.exec(String(name || ''));
  return m ? m[1].toLowerCase() : '';
}

/** A file name that is safe on every OS (no path separators, control or reserved characters). */
export function safeFileName(name, fallback = 'Datei') {
  let n = String(name || '').normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  if (!n) n = fallback;
  if (n.length > 120) {
    const ext = extension(n);
    n = clip(n.slice(0, n.length - (ext ? ext.length + 1 : 0)), 120 - (ext ? ext.length + 1 : 0)) + (ext ? '.' + ext : '');
  }
  return n;
}

/** First `max` UTF-16 units without splitting an emoji / surrogate pair, no trailing space, dot or dash. */
function clip(s, max) {
  let out = '';
  for (const ch of s) { if (out.length + ch.length > max) break; out += ch; }
  return out.replace(/[\s.–-]+$/u, '');
}

/** "Rechnung" + suffix + ext, e.g. withSuffix('Rechnung.pdf', ' (komprimiert)', 'pdf'). A very long name is
 * shortened before the suffix, so " (komprimiert)" is never cut off (the result must not look like the input). */
export function withSuffix(name, suffix, ext) {
  const tail = `${suffix}.${ext}`;
  const base = safeFileName(baseName(name));
  return safeFileName(`${base.length + tail.length > 120 ? clip(clip(base, 119 - tail.length).replace(/\s\S{1,15}$/u, ''), 119 - tail.length) + '…' : base}${tail}`);
}

export function plural(lang, n, one, many) { return n === 1 ? one : many; }
