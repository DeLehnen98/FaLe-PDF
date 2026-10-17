// Applies the "headers" rules of /home/claude/FalePDF/vercel.json to a node:http response (local
// emulation of Vercel's path-to-regexp matching for the patterns used there). Re-read on every call,
// so edits to vercel.json are picked up without restarting the servers.
import { readFileSync } from 'node:fs';
const VC = process.env.FALE_VERCEL_JSON || '/home/claude/FalePDF/vercel.json';
function toRegex(src) {
  let out = '', i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length) { out += '\\' + src[i + 1]; i += 2; continue; }
    if (ch === '(') { let depth = 0, j = i; for (; j < src.length; j++) { if (src[j] === '(') depth++; else if (src[j] === ')') { depth--; if (!depth) break; } } out += src.slice(i, j + 1); i = j + 1; continue; }
    out += ch.replace(/[.*+?^${}|[\]]/g, '\\$&'); i++;
  }
  return new RegExp('^' + out + '$');
}
export function headersFor(pathname) {
  let rules = [];
  try { rules = JSON.parse(readFileSync(VC, 'utf8')).headers || []; } catch {}
  const out = {};
  for (const r of rules) if (toRegex(r.source).test(pathname)) for (const h of r.headers) out[h.key] = h.value; // later rules win (like Vercel)
  return out;
}
export function applyVercelHeaders(pathname, res) {
  if (process.env.FALE_NO_CSP === '1') return;
  for (const [k, v] of Object.entries(headersFor(pathname))) res.setHeader(k, v);
}
