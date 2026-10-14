// Page-range parser for inputs like "1-3, 5, 8-", "-4", "7-5" (descending) or "alle"/"all".
// Pages are 1-based in the text and 0-based in the result. Empty text = all pages.

export class PageRangeError extends Error {
  constructor(kind, detail) { super(kind); this.name = 'PageRangeError'; this.kind = kind; this.detail = detail; }
}

/**
 * @param {string} text
 * @param {number} count  number of pages in the document
 * @param {{unique?: boolean}} [opts]  unique: drop repeated pages (default false – "1,1" duplicates a page)
 * @returns {number[]} 0-based page indices in the given order
 * @throws {PageRangeError} kind 'syntax' | 'range' (detail = offending page number)
 */
export function parsePages(text, count, { unique = false } = {}) {
  const src = String(text ?? '').trim().toLowerCase();
  if (!src || src === 'alle' || src === 'all' || src === '*') return Array.from({ length: count }, (_, i) => i);
  const out = [];
  for (const raw of src.split(/[,;]+/)) {
    const part = raw.replace(/\s+/g, '').replace(/[–—]/g, '-');
    if (!part) continue;
    let m;
    if ((m = /^(\d+)$/.exec(part))) {
      push(+m[1], +m[1]);
    } else if ((m = /^(\d*)-(\d*)$/.exec(part)) && (m[1] || m[2])) {
      const a = m[1] ? +m[1] : 1, b = m[2] ? +m[2] : count;
      push(a, b);
    } else if (part === 'letzte' || part === 'last' || part === 'ende' || part === 'end') {
      push(count, count);
    } else {
      throw new PageRangeError('syntax', raw.trim());
    }
  }
  if (!out.length) throw new PageRangeError('syntax', src);
  return unique ? [...new Set(out)] : out;

  function push(a, b) {
    for (const p of [a, b]) if (p < 1 || p > count) throw new PageRangeError('range', p);
    if (a <= b) for (let i = a; i <= b; i++) out.push(i - 1);
    else for (let i = a; i >= b; i--) out.push(i - 1);
  }
}

/** Compact text for a list of 0-based indices, e.g. [0,1,2,4] → "1-3, 5". */
export function formatPages(indices) {
  const parts = [];
  for (let i = 0; i < indices.length;) {
    let j = i;
    while (j + 1 < indices.length && indices[j + 1] === indices[j] + 1) j++;
    parts.push(j > i ? `${indices[i] + 1}-${indices[j] + 1}` : `${indices[i] + 1}`);
    i = j + 1;
  }
  return parts.join(', ');
}
