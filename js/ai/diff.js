// Word-level diff (LCS) for the Schreibhilfe preview: shows what the AI changed.
import { esc } from '../ui.js';

const toks = s => String(s).match(/\s+|[\p{L}\p{N}’'-]+|[^\s\p{L}\p{N}]/gu) || [];

/** → [{ op: '=', '+', '-', text }] */
export function diffWords(a, b) {
  const A = toks(a), B = toks(b);
  // keep it fast for long texts: trim common prefix/suffix first
  let pre = 0;
  while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
  let suf = 0;
  while (suf < A.length - pre && suf < B.length - pre && A[A.length - 1 - suf] === B[B.length - 1 - suf]) suf++;
  const a2 = A.slice(pre, A.length - suf), b2 = B.slice(pre, B.length - suf);
  const out = [];
  if (pre) out.push({ op: '=', text: A.slice(0, pre).join('') });
  if (a2.length * b2.length > 4e6) { // too big for LCS → whole block replace
    if (a2.length) out.push({ op: '-', text: a2.join('') });
    if (b2.length) out.push({ op: '+', text: b2.join('') });
  } else {
    const n = a2.length, m = b2.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a2[i] === b2[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0, j = 0;
    const push = (op, t) => { const l = out[out.length - 1]; if (l && l.op === op) l.text += t; else out.push({ op, text: t }); };
    while (i < n && j < m) {
      if (a2[i] === b2[j]) { push('=', a2[i]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { push('-', a2[i]); i++; }
      else { push('+', b2[j]); j++; }
    }
    while (i < n) push('-', a2[i++]);
    while (j < m) push('+', b2[j++]);
  }
  if (suf) { const l = out[out.length - 1]; const t = A.slice(A.length - suf).join(''); if (l && l.op === '=') l.text += t; else out.push({ op: '=', text: t }); }
  return out;
}

export function diffHtml(a, b) {
  return diffWords(a, b).map(p => p.op === '=' ? esc(p.text) : p.op === '+' ? `<ins>${esc(p.text)}</ins>` : `<del>${esc(p.text)}</del>`).join('').replace(/\n/g, '<br>');
}

export function diffStats(a, b) {
  const d = diffWords(a, b);
  const count = op => d.filter(p => p.op === op).reduce((s, p) => s + (p.text.match(/[\p{L}\p{N}]+/gu) || []).length, 0);
  return { added: count('+'), removed: count('-') };
}
