// Word diff (Myers O(ND) with patience anchors) – copied from the FaLe PDF app (js/tools/compare.js) for compare-pdf.
// ------------------------------------------------------------------------------- diff
/**
 * Myers O(ND) diff on token arrays (strings). Returns null when the edit distance exceeds maxD.
 * @returns {Array<{type:'eq'|'del'|'ins', a0, a1, b0, b1}>|null}
 */
function myers(a, b, maxD = 1500) {
  const n = a.length, m = b.length, max = n + m;
  const off = max + 1;
  let v = new Int32Array(2 * max + 3);
  const trace = [];
  let found = -1;
  for (let d = 0; d <= Math.min(max, maxD); d++) {
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) { found = d; break; }
    }
    if (found >= 0) break;
  }
  if (found < 0) return null;
  // backtrack
  const edits = [];
  let x = n, y = m;
  for (let d = found; d > 0; d--) {
    const vv = trace[d];
    const get = k => vv[k + d + 1];
    const k = x - y;
    const prevK = (k === -d || (k !== d && get(k - 1) < get(k + 1))) ? k + 1 : k - 1;
    const prevX = get(prevK), prevY = prevX - prevK;
    while (x > prevX && y > prevY) { edits.push(['eq', x - 1, y - 1]); x--; y--; }
    if (x === prevX) edits.push(['ins', x, y - 1]); else edits.push(['del', x - 1, y]);
    x = prevX; y = prevY;
  }
  while (x > 0 && y > 0) { edits.push(['eq', x - 1, y - 1]); x--; y--; }
  edits.reverse();
  // compress into runs
  const ops = [];
  for (const [t, i, j] of edits) {
    const last = ops[ops.length - 1];
    if (last && last.type === t) {
      if (t === 'eq') { last.a1 = i + 1; last.b1 = j + 1; } else if (t === 'del') last.a1 = i + 1; else last.b1 = j + 1;
    } else {
      ops.push(t === 'eq' ? { type: t, a0: i, a1: i + 1, b0: j, b1: j + 1 } : t === 'del' ? { type: t, a0: i, a1: i + 1, b0: j, b1: j } : { type: t, a0: i, a1: i, b0: j, b1: j + 1 });
    }
  }
  return ops;
}

/** Unique common tokens in increasing order on both sides (patience anchors). */
function anchors(a, b) {
  const ca = new Map(), cb = new Map();
  a.forEach((t, i) => { const e = ca.get(t); ca.set(t, e ? { n: e.n + 1, i } : { n: 1, i }); });
  b.forEach((t, i) => { const e = cb.get(t); cb.set(t, e ? { n: e.n + 1, i } : { n: 1, i }); });
  const pairs = [];
  ca.forEach((ea, t) => { const eb = cb.get(t); if (ea.n === 1 && eb && eb.n === 1) pairs.push([ea.i, eb.i]); });
  pairs.sort((p, q) => p[0] - q[0]);
  // longest increasing subsequence on b-index
  const tails = [], prev = new Int32Array(pairs.length).fill(-1), idx = [];
  pairs.forEach((p, i) => {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pairs[tails[mid]][1] < p[1]) lo = mid + 1; else hi = mid; }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
    idx[lo] = i;
  });
  const out = [];
  let k = tails.length ? tails[tails.length - 1] : -1;
  while (k >= 0) { out.push(pairs[k]); k = prev[k]; }
  return out.reverse();
}

export function diffTokens(a, b) {
  const ops = [];
  const push = (type, a0, a1, b0, b1) => {
    if (a1 - a0 <= 0 && b1 - b0 <= 0) return;
    const last = ops[ops.length - 1];
    if (last && last.type === type && last.a1 === a0 && last.b1 === b0) { last.a1 = a1; last.b1 = b1; return; }
    ops.push({ type, a0, a1, b0, b1 });
  };
  const rec = (a0, a1, b0, b1, depth) => {
    // common prefix / suffix
    let p = 0;
    while (a0 + p < a1 && b0 + p < b1 && a[a0 + p] === b[b0 + p]) p++;
    if (p) push('eq', a0, a0 + p, b0, b0 + p);
    a0 += p; b0 += p;
    let s = 0;
    while (a1 - s > a0 && b1 - s > b0 && a[a1 - 1 - s] === b[b1 - 1 - s]) s++;
    const tail = s ? [a1 - s, a1, b1 - s, b1] : null;
    a1 -= s; b1 -= s;
    if (a0 === a1 || b0 === b1) {
      push('del', a0, a1, b0, b0);
      push('ins', a1, a1, b0, b1);
    } else {
      const r = (a1 - a0) + (b1 - b0) < 60000 ? myers(a.slice(a0, a1), b.slice(b0, b1), 900) : null;
      if (r) r.forEach(o => push(o.type, o.a0 + a0, o.a1 + a0, o.b0 + b0, o.b1 + b0));
      else {
        const an = depth < 12 ? anchors(a.slice(a0, a1), b.slice(b0, b1)) : [];
        if (!an.length) { push('del', a0, a1, b0, b0); push('ins', a1, a1, b0, b1); }
        else {
          let pa = a0, pb = b0;
          for (const [ia, ib] of an) {
            rec(pa, a0 + ia, pb, b0 + ib, depth + 1);
            push('eq', a0 + ia, a0 + ia + 1, b0 + ib, b0 + ib + 1);
            pa = a0 + ia + 1; pb = b0 + ib + 1;
          }
          rec(pa, a1, pb, b1, depth + 1);
        }
      }
    }
    if (tail) push('eq', ...tail);
  };
  rec(0, a.length, 0, b.length, 0);
  return ops;
}

