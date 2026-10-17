from playwright.sync_api import sync_playwright
from pplus_common import *
ensure_server()
with sync_playwright() as p:
    b = launch(p)
    ctx = context(b); pg = ctx.new_page(); attach(pg, 'desk')
    pg.goto(URL); pg.wait_for_timeout(800)
    import_pdfs(pg, [os.path.join(TDP, 'antrag.pdf')])
    a = doc_id(pg, 'antrag.pdf')
    goto(pg, f'#/werkzeug/formular-erstellen?doc={a}', '.pt-page canvas')
    pg.locator('.pt-tool', has_text='Erkennen').click()
    pg.wait_for_selector('.fc-field', timeout=15000)
    pg.wait_for_timeout(600)
    print(pg.evaluate("Array.from(document.querySelectorAll('.fc-field')).map(e => e.className.split(' ')[1] + ':' + e.querySelector('.fc-name').textContent)"))
    shot(pg, 'dev_form_detect')
    pg.locator('.screen-foot .btn-primary').click()
    pg.wait_for_selector('.pt-result .result-card', timeout=20000)
    path = download_from(pg, pg.locator('.pt-result [data-r=dl]'), 'form.pdf')
    from pypdf import PdfReader
    r = PdfReader(path)
    f = r.get_fields()
    print({k: (v.get('/FT'), v.get('/Ff')) for k, v in f.items()})
    ctx.close(); b.close()
print('\n'.join(console))
