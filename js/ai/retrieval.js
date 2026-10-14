// Client-side retrieval for "Chat mit Dokument": split pages into overlapping chunks and rank
// them with BM25 – so only the few most relevant passages (with page numbers) are sent.

const STOP = new Set(('der die das den dem des ein eine einer eines einem einen und oder aber nicht kein keine ist sind war waren wird werden wurde '
  + 'hat haben hatte zu zum zur im in an am auf aus bei mit nach von vor für über unter um durch als wie wo was wer wann warum welche welcher welches '
  + 'es er sie wir ihr ich du man sich so auch noch nur schon sehr mehr dass daß ob wenn dann denn doch ja nein bitte gibt steht stehen '
  + 'the a an and or but not no is are was were be been to of in on at for with by from as it this that these those what which who when where why how '
  + 'do does did can could would should will there their they we you i me my our your its into about').split(/\s+/));

export function normalizeText(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
}

function stem(w) {
  if (w.length <= 4) return w;
  for (const suf of ['ungen', 'heiten', 'keiten', 'ung', 'heit', 'keit', 'lich', 'isch', 'ern', 'en', 'er', 'es', 'em', 'e', 'n', 's']) {
    if (w.length - suf.length >= 4 && w.endsWith(suf)) return w.slice(0, -suf.length);
  }
  return w;
}

export function tokenize(s) {
  return (normalizeText(s).match(/[\p{L}\p{N}]+/gu) || []).filter(w => w.length > 1 && !STOP.has(w)).map(stem);
}

/** pages: string[] → chunks [{ page (1-based), text, idx }] of ~size chars with overlap. */
export function makeChunks(pages, { size = 900, overlap = 150 } = {}) {
  const out = [];
  (pages || []).forEach((raw, pi) => {
    const text = String(raw || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) return;
    if (text.length <= size * 1.2) { out.push({ page: pi + 1, text, idx: out.length }); return; }
    let start = 0;
    while (start < text.length) {
      let end = Math.min(text.length, start + size);
      if (end < text.length) {
        const cut = Math.max(text.lastIndexOf('\n', end), text.lastIndexOf('. ', end));
        if (cut > start + size * 0.5) end = cut + 1;
      }
      out.push({ page: pi + 1, text: text.slice(start, end).trim(), idx: out.length });
      if (end >= text.length) break;
      start = Math.max(end - overlap, start + 1);
    }
  });
  return out;
}

/** Build a BM25 index over chunks. */
export function buildIndex(chunks, { k1 = 1.4, b = 0.75 } = {}) {
  const docs = chunks.map(c => { const toks = tokenize(c.text); const tf = new Map(); toks.forEach(t => tf.set(t, (tf.get(t) || 0) + 1)); return { tf, len: toks.length }; });
  const df = new Map();
  docs.forEach(d => d.tf.forEach((_, t) => df.set(t, (df.get(t) || 0) + 1)));
  const N = docs.length || 1;
  const avg = docs.reduce((s, d) => s + d.len, 0) / N || 1;
  return {
    chunks,
    search(query, k = 8) {
      const q = [...new Set(tokenize(query))];
      const scored = docs.map((d, i) => {
        let s = 0;
        for (const t of q) {
          const f = d.tf.get(t);
          if (!f) continue;
          const n = df.get(t) || 0;
          const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
          s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / avg));
        }
        // small bonus for exact phrase hits (numbers, names)
        if (s > 0 && query.length > 3 && normalizeText(chunks[i].text).includes(normalizeText(query).trim())) s *= 1.3;
        return { i, s };
      }).filter(x => x.s > 0).sort((a, b2) => b2.s - a.s);
      return scored.slice(0, k).map(x => ({ ...chunks[x.i], score: x.s }));
    },
  };
}

/**
 * Pick the context for a question: best BM25 hits (plus the first chunk for "what is this about"
 * questions), within maxChars, in document order.
 */
export function selectContext(index, question, { k = 8, maxChars = 20000 } = {}) {
  let hits = index.search(question, k);
  const all = index.chunks;
  if (hits.length < 3) {
    // generic question ("Worum geht es?") → beginning + evenly spread chunks
    const want = Math.min(all.length, k);
    const step = Math.max(1, Math.floor(all.length / want));
    const extra = [];
    for (let i = 0; i < all.length && extra.length < want; i += step) extra.push(all[i]);
    const seen = new Set(hits.map(h => h.idx));
    hits = [...hits, ...extra.filter(c => !seen.has(c.idx))].slice(0, k);
  }
  const picked = [];
  let total = 0;
  for (const h of hits) {
    if (total + h.text.length > maxChars) continue;
    picked.push(h);
    total += h.text.length;
  }
  return picked.sort((a, b) => a.idx - b.idx);
}

/** Find citations like [S. 3], [S. 3, 5], [Folie 2] in an answer. */
export const CITE_RE = /\[(S\.|Seite|Folie|Blatt|Abschnitt)\s*(\d+(?:\s*(?:,|und|–|-)\s*\d+)*)\]/g;
