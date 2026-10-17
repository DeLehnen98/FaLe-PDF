import os
from playwright.sync_api import sync_playwright
SP = os.path.dirname(os.path.abspath(__file__))
with sync_playwright() as p:
    b = p.chromium.launch(); page = b.new_page(viewport={'width': 1366, 'height': 860})
    page.on('console', lambda m: print('LOG', m.type, m.text))
    page.on('pageerror', lambda e: print('ERR', e))
    page.goto('http://127.0.0.1:8792/')
    page.set_input_files('#pdf-input', [os.path.join(SP, 'testdata', 'bericht.pdf')])
    page.wait_for_function("location.hash.startsWith('#/ansicht/')"); page.wait_for_function("document.querySelector('[data-v=loading]').hidden")
    docid = page.evaluate("location.hash.split('/')[2].split('?')[0]")
    page.evaluate(f"location.hash = '#/werkzeug/wasserzeichen?doc={docid}'"); page.wait_for_selector('.pt-prev-overlay')
    page.locator('[name=text]').fill('ENTWURF')
    page.wait_for_timeout(300)
    print('btn disabled', page.locator('.screen-foot .btn-primary').is_disabled(), page.locator('.screen-foot').inner_text())
    page.evaluate("document.addEventListener('click', e => console.log('click on', e.target.outerHTML.slice(0, 80), e.defaultPrevented), true)")
    page.evaluate("window.addEventListener('unhandledrejection', e => console.log('UNHANDLED', e.reason && e.reason.stack))")
    print('elementFromPoint', page.evaluate("(() => { const b = document.querySelector('.screen-foot .btn-primary').getBoundingClientRect(); const e = document.elementFromPoint(b.x + b.width/2, b.y + b.height/2); return [b.x, b.y, b.width, b.height, e && e.outerHTML.slice(0, 100)]; })()"))
    page.evaluate("document.querySelector('.screen-foot .btn-primary').click()")
    for i in range(12):
        page.wait_for_timeout(500)
        print(i, repr(page.locator('#toasts').inner_text()), page.locator('[data-result]').count(), page.evaluate("document.querySelector('[data-result]') && document.querySelector('[data-result]').innerHTML.length"))
    print('result', page.locator('[data-result] .result-card').count())
    b.close()
