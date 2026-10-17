import os
from playwright.sync_api import sync_playwright
import csp_compat
TD = os.path.realpath('testdata')
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(); page = ctx.new_page(); errs=[]
    page.on('pageerror', lambda e: errs.append(str(e) + ' || ' + (e.stack or '')[:900]))
    page.goto('http://127.0.0.1:9408/'); page.wait_for_selector('#view-start .hero')
    for i in range(3):
        page.set_input_files('#pdf-input', [os.path.join(TD, 'bericht.pdf')])
        page.wait_for_function("location.hash.startsWith('#/ansicht/')", timeout=20000)
        page.evaluate("location.hash = '#/start'"); page.wait_for_timeout(400)
        page.set_input_files('#pdf-input', [os.path.join(TD, 'unkomprimiert.pdf')])
        page.wait_for_function("location.hash.startsWith('#/ansicht/')", timeout=20000)
        page.wait_for_timeout(1500)
        page.evaluate("location.hash = '#/start'"); page.wait_for_timeout(800)
    print('\n'.join(errs) or 'no errors'); b.close()
