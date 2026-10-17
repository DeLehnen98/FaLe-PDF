// Unit test of js/smart/extract.js against the synthetic corpus (text via pdftotext -layout or given JSON of texts).
//   node test_extract.mjs [texts.json] [--verbose]
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const X = await import(pathToFileURL('/home/claude/FalePDF/js/smart/extract.js').href);
const args = process.argv.slice(2);
const DIR = (args.find(a => a.startsWith('--dir=')) || '--dir=corpus').slice(6);
const truth = JSON.parse(readFileSync(join(HERE, DIR, 'truth.json'), 'utf8'));
const verbose = args.includes('--verbose');
const textsFile = args.find(a => a.endsWith('.json'));
const texts = textsFile ? JSON.parse(readFileSync(textsFile, 'utf8')) : null;
const label = (args.find(a => a.startsWith('--label=')) || '--label=PDF-Text (pdftotext)').slice(8);

export const normName = s => String(s || '').toLowerCase().replace(/gmbh|&\s*co\.?\s*kg|\bag\b|\bkg\b|e\.\s?v\.|ohg|e\.k\.|vvag|\bse\b/g, '').replace(/[^\p{L}\d ]/gu, ' ').replace(/\s+/g, ' ').trim();
function nameEq(a, b) {
  const x = normName(a), y = normName(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const A = new Set(x.split(' ')), B = new Set(y.split(' '));
  const inter = [...A].filter(t => B.has(t)).length;
  return inter / Math.max(A.size, B.size) >= 0.6;
}
const refN = s => String(s || '').toUpperCase().replace(/\s+/g, '');
const digits = s => String(s || '').replace(/\D/g, '');
const FIELDS = {
  type: [t => t.type, r => r.type, (a, b) => a === b],
  sender: [t => t.sender, r => r.sender && r.sender.name, nameEq],
  recipient: [t => t.recipient, r => r.recipient && r.recipient.name, nameEq],
  date: [t => t.date, r => r.date, (a, b) => a === b],
  kundennummer: [t => t.kundennummer, r => r.refs.kundennummer, (a, b) => refN(a) === refN(b)],
  rechnungsnummer: [t => t.rechnungsnummer, r => r.refs.rechnungsnummer, (a, b) => refN(a) === refN(b)],
  vertragsnummer: [t => t.vertragsnummer, r => r.refs.vertragsnummer, (a, b) => refN(a) === refN(b)],
  aktenzeichen: [t => t.aktenzeichen, r => r.refs.aktenzeichen, (a, b) => refN(a) === refN(b)],
  steuernummer: [t => t.steuernummer, r => r.refs.steuernummer, (a, b) => refN(a) === refN(b)],
  betrag: [t => t.betrag, r => r.amounts.main, (a, b) => Math.abs(a - b) < 0.005],
  iban: [t => t.iban, r => r.bank.iban, (a, b) => refN(a) === refN(b)],
  bic: [t => t.bic, r => r.bank.bic, (a, b) => refN(a) === refN(b)],
  frist: [t => t.due, r => r.due && r.due.date, (a, b) => a === b],
  telefon: [t => t.phone, r => r.contact.phone, (a, b) => digits(a) === digits(b)],
  email: [t => t.email, r => r.contact.email, (a, b) => String(a).toLowerCase() === String(b).toLowerCase()],
  // receipts / tax (only where truth.tax exists)
  'beleg.haendler': [t => t.tax && t.tax.merchant, r => r.receipt.merchant, nameEq, true],
  'beleg.datum': [t => t.tax && t.tax.date, r => r.receipt.date, (a, b) => a === b, true],
  'beleg.brutto': [t => t.tax && t.tax.total, r => r.receipt.total, (a, b) => Math.abs(a - b) < 0.005, true],
  'beleg.mwst19': [t => t.tax && t.tax.vat19, r => { const g = r.receipt.vat.find(v => v.rate === 19); return g ? g.tax : null; }, (a, b) => Math.abs(a - b) < 0.015, true],
  'beleg.mwst7': [t => t.tax && t.tax.vat7, r => { const g = r.receipt.vat.find(v => v.rate === 7); return g ? g.tax : null; }, (a, b) => Math.abs(a - b) < 0.015, true],
  'beleg.netto': [t => t.tax && t.tax.net, r => r.receipt.net, (a, b) => Math.abs(a - b) < 0.015, true],
  'beleg.zahlart': [t => t.tax && t.tax.payment, r => r.receipt.payment, (a, b) => a === b, true],
  'beleg.kategorie': [t => t.tax && t.tax.category, r => r.tax.id, (a, b) => a === b, true],
  'beleg.arbeitskosten': [t => t.tax && t.tax.labor, r => r.receipt.labor, (a, b) => Math.abs(a - b) < 0.015, true],
};
const stats = Object.fromEntries(Object.keys(FIELDS).map(k => [k, { tp: 0, fp: 0, fn: 0 }]));
const fails = [];
let n = 0;
for (const [id, t] of Object.entries(truth)) {
  let text;
  if (texts) { if (!(id in texts)) continue; text = texts[id]; }
  else text = execFileSync('pdftotext', ['-layout', join(HERE, DIR, id + '.pdf'), '-'], { encoding: 'utf8' });
  n++;
  const r = X.analyze(text, { today: '2026-10-14' });
  for (const [f, [gt, gp, eq, taxOnly]] of Object.entries(FIELDS)) {
    if (taxOnly && !t.tax) continue;
    const a = gt(t), b = gp(r);
    const has = a != null && a !== '', got = b != null && b !== '';
    const s = stats[f];
    if (got && has && eq(a, b)) s.tp++;
    else {
      if (got) s.fp++;
      if (has) s.fn++;
      if (got || has) fails.push(`${id} ${f}: erwartet ${JSON.stringify(a)} · erkannt ${JSON.stringify(b)}`);
    }
  }
  if (verbose) console.log(id, r.type, r.confidence, r.sender && r.sender.name, r.date, JSON.stringify(r.refs), r.amounts.main, r.bank.iban, r.due && r.due.date);
}
const pct = x => (x == null ? '   –  ' : (x * 100).toFixed(1).padStart(5) + ' %');
console.log(`\nExtractor accuracy – ${label} – ${n} Dokumente`);
console.log('Feld'.padEnd(22) + 'Präzision  Recall     TP  FP  FN');
let TP = 0, FP = 0, FN = 0;
const rows = [];
for (const [f, s] of Object.entries(stats)) {
  const P = s.tp + s.fp ? s.tp / (s.tp + s.fp) : null, R = s.tp + s.fn ? s.tp / (s.tp + s.fn) : null;
  TP += s.tp; FP += s.fp; FN += s.fn;
  rows.push({ field: f, precision: P, recall: R, ...s });
  console.log(f.padEnd(22) + pct(P) + '   ' + pct(R) + `   ${String(s.tp).padStart(3)} ${String(s.fp).padStart(3)} ${String(s.fn).padStart(3)}`);
}
console.log('GESAMT'.padEnd(22) + pct(TP / (TP + FP)) + '   ' + pct(TP / (TP + FN)) + `   ${TP} ${FP} ${FN}`);
if (fails.length) { console.log('\nAbweichungen:'); fails.forEach(f => console.log('  ' + f)); }
const out = args.find(a => a.startsWith('--out='));
if (out) (await import('node:fs')).writeFileSync(out.slice(6), JSON.stringify({ label, n, rows, total: { precision: TP / (TP + FP), recall: TP / (TP + FN) }, fails }, null, 1));
