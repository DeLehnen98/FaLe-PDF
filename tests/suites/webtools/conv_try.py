"""Ad-hoc: run one tool on one fixture and print/save the output. python3 conv_try.py <path> <fixture> [setup-js]"""
import sys
from wtlib import Suite
path, fx = sys.argv[1], sys.argv[2].split(',')
js = sys.argv[3] if len(sys.argv) > 3 else None
with Suite('conv-try') as s:
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, path)
    s.pick(page, *fx)
    s.wait_ready(page, len(fx), timeout=60000)
    if js:
        page.evaluate(js)
    if s.run(page, timeout=300000):
        n = page.locator('.wt-output').count()
        for i in range(n):
            o = s.download(page, i)
            print('OUT', o, o.stat().st_size)
        print('NOTES', page.locator('.wt-result').inner_text()[:1500])
