import os, subprocess
from playwright.sync_api import sync_playwright
SP = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(SP, 'out_protools')
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={'width': 1366, 'height': 860}, accept_downloads=True)
    page = ctx.new_page()
    page.on('console', lambda m: print('LOG', m.type, m.text) if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: print('ERR', e))
    page.goto('http://127.0.0.1:8792/')
    page.set_input_files('#pdf-input', [os.path.join(SP, 'testdata', 'struktur.pdf')])
    page.wait_for_function("location.hash.startsWith('#/ansicht/')"); page.wait_for_function("document.querySelector('[data-v=loading]').hidden")
    docid = page.evaluate("location.hash.split('/')[2].split('?')[0]")
    page.evaluate(f"location.hash = '#/werkzeug/bearbeiten?doc={docid}'"); page.wait_for_selector('.pt-page canvas')
    page.wait_for_function("!document.querySelector('.toast')", timeout=8000)
    pg = page.locator('.pt-page').first
    bb = pg.bounding_box(); s = bb['width'] / 595.27
    at = lambda x, y: (bb['x'] + x * s, bb['y'] + y * s)
    # add text
    page.mouse.click(*at(400, 60)); page.wait_for_timeout(200); page.keyboard.type('Neuer Text 123'); page.mouse.click(*at(500, 30))
    # replace "Einleitung" heading (around y=140?) find via text layer: use pageChars coords => approximate positions from reportlab: Title y≈ 72pt from top
    page.locator('.pt-tool[data-tool=replace]').click()
    # find 'Einleitung' position using pdf text via evaluate on struct
    page.mouse.click(*at(110, 128)); page.wait_for_timeout(500)
    print('active:', page.evaluate("document.activeElement && document.activeElement.textContent"))
    page.keyboard.press('Control+A'); page.keyboard.type('Vorwort'); page.mouse.click(*at(500, 300)) 
    page.wait_for_timeout(200)
    page.screenshot(path=os.path.join(OUT, 'dev_edit.png'))
    print('foot', page.locator('.screen-foot .foot-info').inner_text())
    page.locator('.screen-foot .btn-primary').click()
    page.wait_for_selector('.result-card', timeout=20000)
    with page.expect_download() as d: page.locator('.result-card [data-r=dl]').click()
    out = os.path.join(OUT, 'edited.pdf'); d.value.save_as(out)
    b.close()
print(subprocess.run(['pdftotext', '-l', '1', out, '-'], capture_output=True, text=True).stdout[:400])
subprocess.run(['pdftoppm', '-r', '50', '-f', '1', '-l', '1', '-png', out, os.path.join(OUT, 'edited_render')])
