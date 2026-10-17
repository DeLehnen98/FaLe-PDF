import os
from playwright.sync_api import sync_playwright
SP = os.path.dirname(os.path.abspath(__file__)); TD = os.path.join(SP, 'testdata')
with sync_playwright() as p:
    b = p.chromium.launch(); page = b.new_page(viewport={'width': 1366, 'height': 860})
    page.on('console', lambda m: print('LOG', m.type, m.text))
    page.goto('http://127.0.0.1:8792/')
    page.set_input_files('#pdf-input', [os.path.join(TD, 'struktur.pdf')])
    page.wait_for_function("location.hash.startsWith('#/ansicht/')"); page.wait_for_function("document.querySelector('[data-v=loading]').hidden")
    docid = page.evaluate("location.hash.split('/')[2].split('?')[0]")
    page.evaluate(f"location.hash = '#/werkzeug/bearbeiten?doc={docid}'"); page.wait_for_selector('.pt-page canvas')
    page.wait_for_timeout(500)
    bb = page.locator('.pt-tool[data-tool=image]').bounding_box()
    print('tool bb', bb, page.evaluate(f"document.elementFromPoint({bb['x']+20},{bb['y']+20}).outerHTML.slice(0,100)"))
    try:
        with page.expect_file_chooser(timeout=5000) as fc:
            page.locator('.pt-tool[data-tool=image]').click(timeout=5000)
        print('chooser ok')
        fc.value.set_files(os.path.join(TD, 'foto.jpg'))
    except Exception as e:
        print('ERR', str(e)[:300])
    page.screenshot(path=os.path.join(SP, 'out_protools', 'dev_editimg.png'))
    b.close()
