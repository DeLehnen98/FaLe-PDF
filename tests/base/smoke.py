import sys, os
from playwright.sync_api import sync_playwright

SP = os.path.dirname(os.path.abspath(__file__))
URL = 'http://localhost:8791/'
TD = os.path.join(SP, 'testdata')

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1366, 'height': 860})
    page = ctx.new_page()
    logs = []
    page.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
    page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    page.goto(URL)
    page.wait_for_timeout(1500)
    page.set_input_files('#pdf-input', [os.path.join(TD, 'bericht.pdf')])
    page.wait_for_timeout(2500)
    page.screenshot(path=os.path.join(SP, 'smoke_1.png'))
    print('hash', page.evaluate('location.hash'))
    page.wait_for_timeout(1000)
    print('textLayer spans', page.locator('.textLayer span').count())
    page.screenshot(path=os.path.join(SP, 'smoke_2.png'))
    for l in logs: print(l)
    b.close()
