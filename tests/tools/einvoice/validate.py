#!/usr/bin/env python3
"""validate.py <invoice.xml> [--xrechnung] – EN 16931 schematron (CEN) + optional XRechnung CIUS, via Saxon-HE.
Prints failed asserts (fatal/error) and warnings; exit 1 on errors."""
import subprocess, sys, re, os, tempfile
V = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'vendor')
SAX = ['java', '-cp', f'{V}/saxonjar/saxon-he-10.9.jar', 'net.sf.saxon.Transform']
def run(xml, xsl):
    out = tempfile.mktemp(suffix='.svrl')
    p = subprocess.run(SAX + [f'-s:{xml}', f'-xsl:{xsl}', f'-o:{out}'], capture_output=True, text=True)
    if p.returncode: print(p.stderr[-1500:]); sys.exit(2)
    s = open(out, encoding='utf-8').read(); os.unlink(out)
    res = []
    for m in re.finditer(r'<svrl:failed-assert\b([^>]*)>(.*?)</svrl:failed-assert>', s, re.S):
        attrs, body = m.group(1), m.group(2)
        flag = (re.search(r'flag="([^"]+)"', attrs) or [None, 'error'])[1]
        rid = (re.search(r'id="([^"]+)"', attrs) or [None, '?'])[1]
        text = re.sub(r'<[^>]+>', ' ', body); text = re.sub(r'\s+', ' ', text).strip()
        res.append((flag, rid, text))
    return res
f = sys.argv[1]
head = open(f, encoding='utf-8', errors='replace').read(3000)
syn = 'cii' if 'CrossIndustryInvoice' in head else 'ubl'
checks = [('EN16931', f'{V}/en16931/{syn}/xslt/EN16931-{syn.upper()}-validation.xslt')]
if '--xrechnung' in sys.argv: checks.append(('XRechnung', f'{V}/xr-{syn}.xsl'))
errors = 0
for name, xsl in checks:
    for flag, rid, text in run(f, xsl):
        bad = flag in ('fatal', 'error')
        errors += bad
        print(f'{name} {flag.upper():7} {rid}: {text[:220]}')
print(f'RESULT {"OK" if not errors else "INVALID"} ({errors} errors) {os.path.basename(f)}')
sys.exit(1 if errors else 0)
