import { lexJs, segmentsOf, looksGerman } from '/home/claude/FalePDF/scripts/i18n-extract.mjs';
import { readFileSync } from 'node:fs';
const f = process.argv[2];
const src = readFileSync(f, 'utf8');
for (const lit of lexJs(src)) for (const seg of segmentsOf(lit)) { const t = Date.now(); looksGerman(seg); if (Date.now() - t > 200) console.log('SLOW', f, lit.line, JSON.stringify(seg.slice(0, 120))); }
