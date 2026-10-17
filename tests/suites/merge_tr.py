"""Merge tr/*.tsv into js/i18n/en.js and scripts/i18n-ignore.txt."""
import glob, json, os, re, sys
ROOT = '/home/claude/FalePDF'
TR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tr')
entries = {}
ignore = []
defaults = {}
dupes = []
for f in sorted(glob.glob(os.path.join(TR, '*.tsv'))):
    for ln, line in enumerate(open(f, encoding='utf-8'), 1):
        line = line.rstrip('\n')
        if not line.strip() or line.startswith('## '):
            continue
        if '\t' not in line:
            print('NO TAB', os.path.basename(f), ln, line); continue
        k, v = line.split('\t', 1)
        k = re.sub(r'\s+', ' ', k).strip(); v = v.strip().replace('\\n', '\n')
        if os.path.basename(f).startswith('defaults'):
            defaults[k] = v; continue
        if v == '=':
            if k not in ignore: ignore.append(k)
            continue
        if k in entries and entries[k] != v:
            dupes.append((k, entries[k], v))
        entries[k] = v
head = '''// English UI dictionary for FaLe PDF: German source string → English.
// Used by js/i18n/index.js (runtime DOM translation) and scripts/i18n-extract.mjs (coverage report).
// {0}…{9} match any text (captures are translated again if they are known strings);
// {0|one|many} chooses singular/plural by the number in capture 0. Named {vars} are for t() calls.
// Keep the product name "FaLe PDF". German-law features keep German output and say so ("(Germany)").
export default {
'''
out = [head]
for k, v in entries.items():
    out.append(f'  {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)},\n')
out.append('};\n\n// Default values of text inputs (generated text the user may edit) – replaced once when shown.\nexport const defaultValues = {\n')
for k, v in defaults.items():
    out.append(f'  {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)},\n')
out.append('};\n')
open(os.path.join(ROOT, 'js/i18n/en.js'), 'w', encoding='utf-8').write(''.join(out))
open(os.path.join(ROOT, 'scripts/i18n-ignore.txt'), 'w', encoding='utf-8').write(
    '# Strings the extractor finds but that are not UI text (identifiers, PDF keys, debug messages,\n'
    '# German letter/document content that stays German on purpose). One per line.\n' + '\n'.join(ignore) + '\n')
print(f'{len(entries)} entries, {len(ignore)} ignored, {len(defaults)} defaults')
for d in dupes: print('DUPE', d)
