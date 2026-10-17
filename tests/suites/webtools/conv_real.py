"""Robustness: run conversion tools on the real-world fixtures (no assertions on content, only: no error, time)."""
import time, sys
from wtlib import Suite
TOOLS = {'text': '/werkzeuge/pdf-in-text/', 'md': '/werkzeuge/pdf-in-markdown/', 'word': '/werkzeuge/pdf-in-word/', 'excel': '/werkzeuge/pdf-in-excel/', 'img': '/werkzeuge/bilder-aus-pdf-extrahieren/', 'pptx': '/werkzeuge/pdf-in-powerpoint/', 'jpg': '/werkzeuge/pdf-in-jpg/'}
files = sys.argv[2].split(',')
with Suite('conv-real') as s:
    ctx = s.context('desktop', 'de')
    for tool in sys.argv[1].split(','):
        for f in files:
            page = s.open(ctx, TOOLS[tool])
            s.pick(page, 'real/' + f) if not f.startswith('conv_') else s.pick(page, f)
            s.wait_ready(page, 1, timeout=60000)
            t0 = time.time()
            s.primary(page).click()
            page.wait_for_selector('.wt-result:not([hidden]), .wt-error:not([hidden])', timeout=600000)
            ok = page.locator('.wt-result:not([hidden])').count() > 0
            msg = '' if ok else page.locator('.wt-error').inner_text()[:160].replace('\n', ' ')
            print(f'{tool:6} {f:28} {"OK " if ok else "ERR"} {time.time() - t0:6.1f}s {msg}')
            s.check_page(page)
            page.close()
