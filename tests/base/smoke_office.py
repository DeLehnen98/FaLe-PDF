import os, sys
from playwright.sync_api import sync_playwright
SP = os.path.dirname(os.path.abspath(__file__)); D = os.path.join(SP, 'officedata'); O = os.path.join(SP, 'out_office')
URL = 'http://127.0.0.1:8793/'
probs = []
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1366, 'height': 860}, locale='de-DE')
    pg = ctx.new_page()
    pg.on('console', lambda m: probs.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
    pg.on('pageerror', lambda e: probs.append(f'[pageerror] {e}'))
    pg.goto(URL); pg.wait_for_selector('#view-start .hero')
    pg.screenshot(path=os.path.join(O, 'smoke_home.png'))
    with pg.expect_file_chooser() as fc:
        pg.locator('#view-start [data-action="open-file"]').first.click()
    fc.value.set_files([os.path.join(D, f) for f in ['bericht.docx', 'umsatz.xlsx', 'praesentation.pptx', 'liste.csv', 'notiz.txt', 'readme.md', 'bild.png']])
    pg.wait_for_function("document.querySelectorAll('#view-start .doc').length >= 7", timeout=20000)
    pg.wait_for_timeout(3000)
    pg.screenshot(path=os.path.join(O, 'smoke_home2.png'))
    for name in ['bericht.docx', 'umsatz.xlsx', 'praesentation.pptx', 'liste.csv', 'notiz.txt', 'readme.md', 'bild.png']:
        pg.locator('#view-start .doc', has_text=name).first.locator('.doc-open').click()
        pg.wait_for_timeout(2500)
        pg.screenshot(path=os.path.join(O, f'smoke_{name}.png'))
        pg.locator('.screen-head [data-back]').click()
        pg.wait_for_timeout(600)
    print('\n'.join(probs))
    b.close()
