import { lexJs, segmentsOf, looksGerman } from '/home/claude/FalePDF/scripts/i18n-extract.mjs';
import { readFileSync, writeSync } from 'node:fs';
const f = process.argv[2];
const src = readFileSync(f, 'utf8');
for (const lit of lexJs(src)) for (const seg of segmentsOf(lit)) { writeSync(2, 'L' + lit.line + ' ' + JSON.stringify(seg.slice(0, 200)) + '\n'); looksGerman(seg); }
