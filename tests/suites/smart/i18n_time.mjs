import { lexJs } from '/home/claude/FalePDF/scripts/i18n-extract.mjs';
import { readFileSync } from 'node:fs';
for (const f of process.argv.slice(2)) {
  const t = Date.now();
  const src = readFileSync(f, 'utf8');
  const r = lexJs(src);
  console.log(f, src.length, r.length, Date.now() - t, 'ms');
}
