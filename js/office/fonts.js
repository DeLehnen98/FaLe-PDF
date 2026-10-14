// Schriftarten für Dokumente und Tabellen: sichere System-Schriften mit Ersatzschriften (Fallback-Stacks)
// und Zuordnung für den PDF-Export (sans / serif / mono). Es werden keine Schriftdateien mitgeliefert.
export const FONTS = [
  { name: 'Arial', css: "Arial, 'Liberation Sans', Helvetica, sans-serif", kind: 'sans' },
  { name: 'Calibri', css: "Calibri, Carlito, 'Segoe UI', Arial, sans-serif", kind: 'sans' },
  { name: 'Helvetica', css: "Helvetica, 'Helvetica Neue', Arial, sans-serif", kind: 'sans' },
  { name: 'Verdana', css: 'Verdana, Geneva, sans-serif', kind: 'sans' },
  { name: 'Tahoma', css: 'Tahoma, Verdana, sans-serif', kind: 'sans' },
  { name: 'Trebuchet MS', css: "'Trebuchet MS', 'Lucida Grande', sans-serif", kind: 'sans' },
  { name: 'Segoe UI', css: "'Segoe UI', system-ui, sans-serif", kind: 'sans' },
  { name: 'Times New Roman', css: "'Times New Roman', 'Liberation Serif', Times, serif", kind: 'serif' },
  { name: 'Georgia', css: 'Georgia, serif', kind: 'serif' },
  { name: 'Cambria', css: 'Cambria, Caladea, Georgia, serif', kind: 'serif' },
  { name: 'Garamond', css: "Garamond, 'EB Garamond', Georgia, serif", kind: 'serif' },
  { name: 'Book Antiqua', css: "'Book Antiqua', Palatino, 'Palatino Linotype', serif", kind: 'serif' },
  { name: 'Courier New', css: "'Courier New', 'Liberation Mono', Courier, monospace", kind: 'mono' },
  { name: 'Consolas', css: "Consolas, 'Courier New', monospace", kind: 'mono' },
];
const BY_NAME = new Map(FONTS.map(f => [f.name.toLowerCase(), f]));
/** CSS font-family stack for a font name (unknown names get a generic fallback). */
export function fontCss(name) {
  if (!name) return null;
  const f = BY_NAME.get(String(name).toLowerCase().replace(/^['"]|['"]$/g, ''));
  if (f) return f.css;
  // font names come from imported files and end up in style="…": letters, digits, space, - _ . only
  const safe = String(name).replace(/[^\p{L}\p{N} ._-]+/gu, '').slice(0, 64).trim() || 'sans-serif';
  return `'${safe}', ${fontKind(name) === 'serif' ? 'serif' : fontKind(name) === 'mono' ? 'monospace' : 'sans-serif'}`;
}
/** sans | serif | mono for a font name or CSS font-family value. */
export function fontKind(name) {
  const s = String(name || '').toLowerCase();
  const f = BY_NAME.get(s.split(',')[0].trim().replace(/^['"]|['"]$/g, ''));
  if (f) return f.kind;
  if (/mono|courier|consol|menlo/.test(s)) return 'mono';
  if (/serif|times|georgia|garamond|cambria|book|palatino/.test(s) && !/sans/.test(s)) return 'serif';
  return 'sans';
}
/** First family name of a CSS font-family value ("'Times New Roman', serif" → "Times New Roman"). */
export function fontNameOf(css) {
  if (!css) return null;
  const first = String(css).split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  if (!first || /^(serif|sans-serif|monospace|system-ui|inherit|initial)$/i.test(first)) return null;
  const f = BY_NAME.get(first.toLowerCase());
  return f ? f.name : first;
}
