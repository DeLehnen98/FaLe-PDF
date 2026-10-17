import os, json, sys
from playwright.sync_api import sync_playwright
SP = os.path.dirname(os.path.abspath(__file__))
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1366, 'height': 860}, accept_downloads=True, locale='de-DE')
    page = ctx.new_page()
    logs = []
    page.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    page.goto('http://127.0.0.1:8792/')
    page.set_input_files('#pdf-input', [os.path.join(SP, 'testdata', 'bericht.pdf')])
    page.wait_for_function("location.hash.startsWith('#/ansicht/')")
    page.wait_for_function("document.querySelector('[data-v=loading]').hidden")
    docid = page.evaluate("location.hash.split('/')[2].split('?')[0]")
    page.evaluate(f"location.hash = '#/werkzeug/kommentieren?doc={docid}'")
    page.wait_for_selector('.pt-page canvas')
    page.wait_for_function("!document.querySelector('.toast')", timeout=8000)
    pg = page.locator('.pt-page').first
    bb = pg.bounding_box()
    s = page.evaluate("parseFloat(getComputedStyle(document.querySelector('.pt-stage')).getPropertyValue('--s'))")
    print('scale', s, bb)
    # line 1 baseline around y = 72 + ... use text positions: drag across "Zeile 1 ... Datenschutz"
    def at(x, y): return (bb['x'] + x * s, bb['y'] + y * s)
    # find first body line location via page text
    x0, y0 = at(85, 166); x1, y1 = at(300, 166)
    page.mouse.move(x0, y0); page.mouse.down(); page.mouse.move((x0+x1)/2, y1, steps=5); page.mouse.move(x1, y1, steps=5); page.mouse.up()
    page.wait_for_timeout(300)
    print('annots after highlight', page.locator('.pt-page').first.locator('svg polygon').count())
    # underline: tap on word
    page.locator('.pt-tool[data-tool=underline]').click()
    page.mouse.click(*at(150, 180))
    page.locator('.pt-tool[data-tool=strike]').click()
    x0, y0 = at(85, 197); x1, y1 = at(250, 197)
    page.mouse.move(x0, y0); page.mouse.down(); page.mouse.move(x1, y1, steps=8); page.mouse.up()
    # pen
    page.locator('.pt-tool[data-tool=pen]').click()
    page.mouse.move(*at(380, 200)); page.mouse.down()
    for i in range(20): page.mouse.move(*at(380 + i * 5, 200 + (i % 5) * 4))
    page.mouse.up()
    # rect, ellipse, arrow, line
    for t, a, bpt in [('rect', (80, 250), (200, 300)), ('ellipse', (220, 250), (330, 300)), ('arrow', (360, 250), (480, 300)), ('line', (360, 320), (480, 340))]:
        page.locator(f'.pt-tool[data-tool={t}]').click()
        page.mouse.move(*at(*a)); page.mouse.down(); page.mouse.move(*at(*bpt), steps=6); page.mouse.up()
    # text
    page.locator('.pt-tool[data-tool=text]').click()
    page.mouse.click(*at(60, 225))
    page.wait_for_timeout(200)
    page.keyboard.type('Hallo Welt – Prüfung')
    page.mouse.click(*at(520, 330))  # blur
    # note
    page.locator('.pt-tool[data-tool=note]').click()
    page.mouse.click(*at(500, 100))
    page.locator('dialog textarea').fill('Bitte prüfen!')
    page.locator('dialog .btn-primary').click()
    page.wait_for_timeout(300)
    print('foot', page.locator('.screen-foot .foot-info').inner_text())
    # undo + redo
    page.locator('[aria-label="Rückgängig"]').click(); print('after undo', page.locator('.screen-foot .foot-info').inner_text())
    page.locator('[aria-label="Wiederholen"]').click(); print('after redo', page.locator('.screen-foot .foot-info').inner_text())
    page.screenshot(path=os.path.join(SP, 'out_protools', 'dev_annot_drawn.png'))
    page.locator('.screen-foot .btn-primary').click()
    page.wait_for_selector('.result-card', timeout=20000)
    with page.expect_download() as d:
        page.locator('.result-card [data-r="dl"]').click()
    out = os.path.join(SP, 'out_protools', 'annotated.pdf'); d.value.save_as(out)
    print('\n'.join(logs) or 'no console problems')
    b.close()
from pypdf import PdfReader
r = PdfReader(out)
for i, pg in enumerate(r.pages):
    ann = pg.get('/Annots')
    if ann: print(i, [a.get_object()['/Subtype'] for a in ann])
