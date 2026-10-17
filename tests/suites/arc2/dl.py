import sys
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(accept_downloads=True); pg=ctx.new_page()
    pg.on('console', lambda m: print('console', m.type, m.text[:200]))
    pg.goto('http://127.0.0.1:8870/vorlagen/tabellen/'+sys.argv[1]+'/'); pg.wait_for_selector('[data-arc2-sheet][data-ready]')
    with pg.expect_download() as d: pg.click('[data-arc2-xlsx]')
    d.value.save_as(sys.argv[2]); print(d.value.suggested_filename)
    print(pg.evaluate("() => document.querySelector('[data-arc2-sheet]').arc2.values('I6')"))
