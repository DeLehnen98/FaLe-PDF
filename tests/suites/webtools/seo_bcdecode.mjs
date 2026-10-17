// stdin: {type, check39, rows: ["0101…", …]} → stdout: first row that decodes, or "null"
import { decodeRow } from '/home/claude/FalePDF/network/assets/wt/lib/seo-barcode.js';
let s = ''; process.stdin.on('data', d => { s += d; }).on('end', () => {
  const j = JSON.parse(s);
  for (const r of j.rows) { const got = decodeRow(j.type, [...r].map(c => c === '1'), { check39: j.check39 }); if (got) { console.log(got); return; } }
  console.log('null');
});
