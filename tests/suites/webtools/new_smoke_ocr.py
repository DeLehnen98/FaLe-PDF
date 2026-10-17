import os, time
os.environ.setdefault('WT_PORT', '8790')
from wtlib import Suite
with Suite('new-smoke-ocr') as s:
    ctx = s.context('desktop', 'de')
    page = s.open(ctx, '/werkzeuge/pdf-texterkennung/')
    page.on('console', lambda m: print('console', m.type, m.text[:200]))
    s.pick(page, 'new_scan_de.pdf')
    s.wait_ready(page, 1)
    t = time.time()
    out = s.run_and_download(page)
    print('took', time.time() - t)
    print(page.locator('.wt-result').inner_text()[:800])
    if out:
        print(s.pdf_text(out)[:1500])
    s.check_page(page)
