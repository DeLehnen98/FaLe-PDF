import { encodeQR, byteCapacity } from '/home/claude/FalePDF/js/tools/qr.js';
const out = [];
const cases = [];
for (const ecc of ['L','M','Q','H']) for (const v of [1,2,5,6,7,9,10,14,20,27,32,40]) {
  const cap = byteCapacity(v, ecc);
  const len = Math.max(1, cap - (v % 3));
  let t = '';
  const base = 'Grüße aus Saarbrücken – FaLe PDF Test 0123456789 ';
  while (new TextEncoder().encode(t).length < len) t += base;
  let b = new TextEncoder().encode(t).slice(0, len);
  // keep valid utf8: strip partial chars at end
  let s = new TextDecoder('utf-8', {fatal:false}).decode(b).replace(/�$/,'');
  cases.push({ecc, v, s});
}
for (const m of [0,1,2,3,4,5,6,7]) cases.push({ecc:'M', v:3, s:'https://example.org/mask'+m, mask:m});
for (const c of cases) {
  const q = encodeQR(c.s, { ecc: c.ecc, minVersion: c.v, mask: c.mask ?? -1 });
  out.push({ text: c.s, ecc: c.ecc, version: q.version, want: c.v, mask: q.mask, size: q.size, mods: Array.from(q.modules).join('') });
}
console.log(JSON.stringify(out));
