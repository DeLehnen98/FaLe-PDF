import sys
from playwright.sync_api import sync_playwright
from pplus_common import *
ensure_server()
with sync_playwright() as p:
    b = launch(p)
    for phone in (True, False):
        ctx = context(b, phone=phone)
        pg = ctx.new_page(); attach(pg, 'phone' if phone else 'desk')
        pg.goto(URL); pg.wait_for_timeout(800)
        import_pdfs(pg, [os.path.join(TDP, 'bericht_v1.pdf')])
        pg.locator('[data-v=reflow]').click()
        pg.wait_for_selector('.rf-doc p', timeout=15000)
        pg.wait_for_function("document.querySelector('[data-rf=more]').hidden", timeout=15000)
        pg.wait_for_timeout(800)
        shot(pg, 'dev_reflow_' + ('phone' if phone else 'desk'))
        print(pg.evaluate("Array.from(document.querySelectorAll('.rf-doc .rf-h, .rf-doc p')).slice(0,8).map(e=>e.className+': '+e.textContent.slice(0,80))"))
        print('figs', pg.evaluate("document.querySelectorAll('.rf-fig canvas').length"))
        ctx.close()
    b.close()
print('\n'.join(console))
