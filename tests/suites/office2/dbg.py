import sys, os, json
from playwright.sync_api import sync_playwright
URL = 'http://127.0.0.1:9202/'
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1366, 'height': 860}, locale='de-DE', bypass_csp=True)
    errs = []
    pg.on('console', lambda m: errs.append(f'[{m.type}] {m.text}'))
    pg.on('pageerror', lambda e: errs.append(f'[pageerror] {e}'))
    pg.goto(URL)
    pg.wait_for_selector('#view-start .hero')
    pg.evaluate("location.hash = '#/neu/dokument'")
    pg.wait_for_selector('.doc-page', timeout=10000)
    pg.wait_for_timeout(400)
    exec(open(sys.argv[1]).read())
    print('\n'.join(errs[-20:]))
    b.close()
