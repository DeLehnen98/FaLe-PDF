import os, sys
from playwright.sync_api import sync_playwright
SP = os.path.dirname(os.path.abspath(__file__)); TD = os.path.join(SP, 'testdata')
files = sys.argv[1:]
with sync_playwright() as p:
    b = p.chromium.launch(); page = b.new_page(viewport={'width': 1366, 'height': 860})
    page.on('console', lambda m: print('LOG', m.type, m.text))
    page.on('pageerror', lambda e: print('ERR', e))
    page.goto('http://127.0.0.1:8792/'); page.wait_for_selector('#view-start .hero')
    page.set_input_files('#pdf-input', [os.path.join(TD, f) for f in files])
    for i in range(16):
        page.wait_for_timeout(500)
        t = page.locator('#toasts').inner_text().replace('\n', ' | ')
        print(i, t)
    b.close()
